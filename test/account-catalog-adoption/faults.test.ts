// @vitest-environment node
import {
  IDBDatabase,
  IDBFactory,
  IDBObjectStore,
  IDBOpenDBRequest,
  IDBVersionChangeEvent,
} from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adoptLegacyClaudeCatalog } from '../../src/account-catalog-adoption';
import {
  ACCOUNT_CATALOG_DATABASE as DESTINATION,
  OWNERS,
} from '../../src/account-catalog-owner/database';
import { bytes, openRaw, snapshot, terminal } from '../account-catalog-owner/fixture';
import { collectionB } from '../browser/claude-account-baseline-owner/fixture';
import { baseline, input, KEY, seed, SOURCE, sourceSnapshot } from './fixture';

afterEach(() => vi.restoreAllMocks());

function requestEnd(request: IDBOpenDBRequest) {
  return new Promise<'success' | 'error'>(resolve => {
    request.addEventListener('success', () => resolve('success'), { once: true });
    request.addEventListener('error', () => resolve('error'), { once: true });
  });
}

function onSourceRow(action: (tx: IDBTransaction) => void) {
  const get = IDBObjectStore.prototype.get;
  return vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (
    this: IDBObjectStore,
    key
  ) {
    const request = get.call(this, key);
    if (this.transaction.db.name === SOURCE && key === KEY)
      request.addEventListener('success', () => action(this.transaction), { once: true });
    return request;
  });
}

function onDestinationAdd(action: (tx: IDBTransaction) => void) {
  const add = IDBObjectStore.prototype.add;
  return vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
    this: IDBObjectStore,
    value,
    key
  ) {
    const request = add.call(this, value, key);
    if (this.name === OWNERS)
      request.addEventListener('success', () => action(this.transaction), { once: true });
    return request;
  });
}

describe('legacy discovery and open truth', () => {
  it('does not fall back to opening when databases() is unavailable', async () => {
    const factory = new IDBFactory();
    Object.defineProperty(factory, 'databases', { value: undefined });
    const open = vi.spyOn(factory, 'open');
    await expect(adoptLegacyClaudeCatalog(input(factory))).resolves.toEqual({
      kind: 'failed',
      stage: 'source',
      code: 'unsupported',
    });
    expect(open).not.toHaveBeenCalled();
  });

  it.each(['throws', 'rejects', 'hangs'] as const)(
    'does not open if discovery %s',
    async failure => {
      const factory = new IDBFactory();
      const discover = vi.spyOn(factory, 'databases');
      const open = vi.spyOn(factory, 'open');
      switch (failure) {
        case 'throws':
          discover.mockImplementationOnce(() => {
            throw Error('private details');
          });
          break;
        case 'rejects':
          discover.mockRejectedValueOnce(Error('private details'));
          break;
        case 'hangs':
          discover.mockReturnValueOnce(new Promise(() => {}));
      }
      await expect(adoptLegacyClaudeCatalog({ ...input(factory), timeoutMs: 25 })).resolves.toEqual(
        {
          kind: 'failed',
          stage: 'source',
          code: failure === 'hangs' ? 'discovery-timeout' : 'discovery-failed',
        }
      );
      expect(open).not.toHaveBeenCalled();
      expect(await factory.databases()).toEqual([]);
    }
  );

  it('observes blocked open and closes its eventual late handle without reading it', async () => {
    const factory = new IDBFactory();
    await seed(factory);
    const lateDatabase = await openRaw(factory, 1, undefined, SOURCE);
    const stalled = new IDBOpenDBRequest();
    const open = vi.spyOn(factory, 'open').mockImplementationOnce(() => {
      queueMicrotask(() =>
        stalled.dispatchEvent(
          new IDBVersionChangeEvent('blocked', { oldVersion: 0, newVersion: 1 })
        )
      );
      return stalled;
    });
    const close = vi.spyOn(IDBDatabase.prototype, 'close');
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
    await expect(adoptLegacyClaudeCatalog(input(factory))).resolves.toEqual({
      kind: 'failed',
      stage: 'source',
      code: 'open-blocked',
    });
    Object.defineProperty(stalled, 'result', { value: lateDatabase });
    stalled.onsuccess?.call(stalled, new Event('success'));
    expect(close.mock.contexts).toEqual([lateDatabase]);
    expect(transactions).not.toHaveBeenCalled();
    expect(open.mock.calls).toEqual([[SOURCE, 1]]);
  });

  it.each(['before-open', 'after-timeout'] as const)(
    'aborts the real creation race %s and leaves no persisted legacy or destination DB',
    async timing => {
      const factory = new IDBFactory();
      await seed(factory);
      const blocker =
        timing === 'after-timeout' ? await openRaw(factory, 1, undefined, SOURCE) : undefined;
      const discard = vi.spyOn(factory, 'deleteDatabase');
      const discover = factory.databases.bind(factory);
      let deletion: ReturnType<typeof requestEnd> | undefined;
      vi.spyOn(factory, 'databases').mockImplementationOnce(async () => {
        const evidence = await discover();
        deletion = requestEnd(factory.deleteDatabase(SOURCE));
        if (!blocker) expect(await deletion).toBe('success');
        return evidence;
      });
      const open = factory.open.bind(factory);
      let tryOpen: IDBOpenDBRequest | undefined;
      let event: ReturnType<typeof requestEnd> | undefined;
      let upgraded: IDBDatabase | undefined;
      vi.spyOn(factory, 'open').mockImplementationOnce((...args) => {
        tryOpen = open(...args);
        event = requestEnd(tryOpen);
        tryOpen.addEventListener('upgradeneeded', () => {
          upgraded = tryOpen!.result;
        });
        return tryOpen;
      });
      const close = vi.spyOn(IDBDatabase.prototype, 'close');
      try {
        await expect(
          adoptLegacyClaudeCatalog({ ...input(factory), timeoutMs: blocker ? 25 : 500 })
        ).resolves.toEqual({
          kind: 'failed',
          stage: 'source',
          code: blocker ? 'open-timeout' : 'legacy-changed',
        });
      } finally {
        blocker?.close();
      }
      expect(await deletion).toBe('success');
      expect(await event).toBe('error');
      expect(tryOpen?.error?.name).toBe('AbortError');
      expect(upgraded).toBeDefined();
      expect(close.mock.contexts).toContain(upgraded);
      expect(discard.mock.calls).toEqual([[SOURCE]]); // Only the test's concurrent deletion.
      expect(await factory.databases()).toEqual([]);
    }
  );
});

describe('readonly terminal and cancellation truth', () => {
  it('never opens the destination before the readonly transaction actually completes', async () => {
    const factory = new IDBFactory();
    await seed(factory);
    const events: string[] = [];
    onSourceRow(tx => {
      events.push('row');
      tx.addEventListener('complete', () => events.push('complete'), { once: true });
    });
    const open = factory.open.bind(factory);
    vi.spyOn(factory, 'open').mockImplementation((name, version) => {
      if (name === DESTINATION) events.push('destination-open');
      return open(name, version);
    });
    await expect(adoptLegacyClaudeCatalog(input(factory))).resolves.toMatchObject({
      kind: 'created',
      verification: 'verified',
    });
    expect(events).toEqual(['row', 'complete', 'destination-open']);
  });

  it.each(['abort', 'unknown'] as const)(
    'returns readonly %s without opening the destination',
    async failure => {
      const factory = new IDBFactory();
      await seed(factory);
      const before = await sourceSnapshot(factory);
      let end: ReturnType<typeof terminal> | undefined;
      const interceptor = onSourceRow(tx => {
        end = terminal(tx);
        if (failure === 'abort') tx.abort();
        else tx.oncomplete = null;
      });
      const open = vi.spyOn(factory, 'open');
      const close = vi.spyOn(IDBDatabase.prototype, 'close');
      await expect(
        adoptLegacyClaudeCatalog({ ...input(factory), timeoutMs: 100 })
      ).resolves.toEqual({
        kind: 'failed',
        stage: 'source',
        code: failure === 'abort' ? 'transaction-aborted' : 'transaction-outcome-unknown',
      });
      expect(await end).toBe(failure === 'abort' ? 'abort' : 'complete');
      expect(open.mock.calls).toEqual([[SOURCE, 1]]);
      expect(close.mock.contexts.map(db => db.name)).toEqual([SOURCE]);
      interceptor.mockRestore();
      expect(await sourceSnapshot(factory)).toEqual(before);
    }
  );

  it('honors pre-cancellation and mid-discovery cancellation without an open', async () => {
    const factory = new IDBFactory();
    await seed(factory);
    const open = vi.spyOn(factory, 'open');
    let discovering!: () => void;
    const started = new Promise<void>(resolve => {
      discovering = resolve;
    });
    let evidence!: (value: IDBDatabaseInfo[]) => void;
    const discover = vi.spyOn(factory, 'databases').mockImplementationOnce(() => {
      discovering();
      return new Promise(resolve => {
        evidence = resolve;
      });
    });
    const error = { kind: 'failed', stage: 'source', code: 'cancelled' };
    await expect(
      adoptLegacyClaudeCatalog({ ...input(factory), signal: AbortSignal.abort('private') })
    ).resolves.toEqual(error);
    expect(discover).not.toHaveBeenCalled();
    const controller = new AbortController();
    const pending = adoptLegacyClaudeCatalog({ ...input(factory), signal: controller.signal });
    await started;
    controller.abort('private');
    await expect(pending).resolves.toEqual(error);
    evidence([{ name: SOURCE, version: 1 }]);
    await Promise.resolve();
    expect(open).not.toHaveBeenCalled();
  });

  it('observes an actual readonly abort on cancellation and closes the source', async () => {
    const factory = new IDBFactory();
    await seed(factory);
    const controller = new AbortController();
    let end: ReturnType<typeof terminal> | undefined;
    onSourceRow(tx => {
      end = terminal(tx);
      controller.abort('private');
    });
    const close = vi.spyOn(IDBDatabase.prototype, 'close');
    await expect(
      adoptLegacyClaudeCatalog({ ...input(factory), signal: controller.signal })
    ).resolves.toEqual({
      kind: 'failed',
      stage: 'source',
      code: 'cancelled',
    });
    expect(await end).toBe('abort');
    expect(await factory.databases()).toEqual([{ name: SOURCE, version: 1 }]);
    expect(close.mock.contexts.map(db => db.name)).toEqual([SOURCE]);
  });

  it('does not open the destination if closing the source fails', async () => {
    const factory = new IDBFactory();
    await seed(factory);
    const close = IDBDatabase.prototype.close;
    const open = vi.spyOn(factory, 'open');
    const closing = vi.spyOn(IDBDatabase.prototype, 'close').mockImplementation(function (
      this: IDBDatabase
    ) {
      close.call(this);
      if (this.name === SOURCE) throw Error('private cleanup details');
    });
    await expect(adoptLegacyClaudeCatalog(input(factory))).resolves.toEqual({
      kind: 'failed',
      stage: 'source',
      code: 'close-failed',
    });
    expect(closing.mock.contexts.map(db => db.name)).toEqual([SOURCE]);
    expect(open.mock.calls).toEqual([[SOURCE, 1]]);
    expect(await factory.databases()).toEqual([{ name: SOURCE, version: 1 }]);
  });
});

describe('destination commit and recovery truth', () => {
  it('does not write a slot or owner when cancelled during the bounded destination open', async () => {
    const factory = new IDBFactory();
    await seed(factory);
    const controller = new AbortController();
    const open = factory.open.bind(factory);
    vi.spyOn(factory, 'open').mockImplementation((name, version) => {
      if (name === DESTINATION) controller.abort('private');
      return open(name, version);
    });
    const close = vi.spyOn(IDBDatabase.prototype, 'close');
    const add = vi.spyOn(IDBObjectStore.prototype, 'add');
    await expect(
      adoptLegacyClaudeCatalog({ ...input(factory), signal: controller.signal })
    ).resolves.toEqual({
      kind: 'failed',
      stage: 'destination',
      code: 'cancelled',
      cleanup: 'closed',
    });
    expect(close.mock.contexts.map(db => db.name)).toEqual([SOURCE, DESTINATION]);
    expect(add).not.toHaveBeenCalled();
    expect(await snapshot(factory)).toEqual({ slots: [], owners: [] });
  });

  it('reports quota only after abort and never retries or leaves a slot behind', async () => {
    const factory = new IDBFactory();
    await seed(factory);
    const add = IDBObjectStore.prototype.add;
    let end: ReturnType<typeof terminal> | undefined;
    const failing = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
      this: IDBObjectStore,
      value,
      key
    ) {
      if (this.name === OWNERS) {
        end = terminal(this.transaction);
        throw new DOMException('private details', 'QuotaExceededError');
      }
      return add.call(this, value, key);
    });
    await expect(adoptLegacyClaudeCatalog(input(factory))).resolves.toEqual({
      kind: 'failed',
      stage: 'destination',
      code: 'quota-exceeded',
      cleanup: 'closed',
    });
    expect(await end).toBe('abort');
    expect(failing).toHaveBeenCalledTimes(2);
    expect(await snapshot(factory)).toEqual({ slots: [], owners: [] });
  });

  it.each(['complete', 'abort'] as const)(
    'reports unobserved destination %s as unknown and converges only on a manual exact rerun',
    async outcome => {
      const factory = new IDBFactory();
      await seed(factory);
      const controller = new AbortController();
      let end: ReturnType<typeof terminal> | undefined;
      const intercept = onDestinationAdd(tx => {
        end = terminal(tx);
        if (outcome === 'complete') tx.oncomplete = null;
        else {
          tx.onabort = null;
          controller.abort('private');
        }
      });
      await expect(
        adoptLegacyClaudeCatalog({ ...input(factory), timeoutMs: 100, signal: controller.signal })
      ).resolves.toEqual({
        kind: 'failed',
        stage: 'destination',
        code: 'transaction-outcome-unknown',
        cleanup: 'closed',
      });
      expect(await end).toBe(outcome);
      expect(intercept).toHaveBeenCalledTimes(2);
      intercept.mockRestore();
      await expect(adoptLegacyClaudeCatalog(input(factory))).resolves.toMatchObject({
        kind: outcome === 'complete' ? 'already-created' : 'created',
        verification: 'verified',
        cleanup: 'closed',
      });
    }
  );

  it.each(['abort', 'complete'] as const)(
    'distinguishes observed destination %s when cancellation arrives during create',
    async terminalEvent => {
      const factory = new IDBFactory();
      await seed(factory);
      let end: ReturnType<typeof terminal> | undefined;
      const controller = new AbortController();
      onDestinationAdd(tx => {
        end = terminal(tx);
        if (terminalEvent === 'complete') tx.commit();
        controller.abort('private');
      });
      const result = await adoptLegacyClaudeCatalog({
        ...input(factory),
        signal: controller.signal,
      });
      expect(await end).toBe(terminalEvent);
      expect(result).toMatchObject(
        terminalEvent === 'complete'
          ? { kind: 'created', verification: 'verified', cleanup: 'closed' }
          : { kind: 'failed', stage: 'destination', code: 'cancelled', cleanup: 'closed' }
      );
      const stored = await snapshot(factory);
      expect(stored.owners).toHaveLength(terminalEvent === 'complete' ? 1 : 0);
    }
  );

  it.each(['readback', 'close', 'both'] as const)(
    'preserves a known commit if postcommit %s fails',
    async failure => {
      const factory = new IDBFactory();
      await seed(factory);
      const before = await sourceSnapshot(factory);
      const transaction = IDBDatabase.prototype.transaction;
      const close = IDBDatabase.prototype.close;
      let complete = false;
      const intercept = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
        this: IDBDatabase,
        names,
        mode,
        options
      ) {
        if (this.name === DESTINATION && complete && failure !== 'close')
          throw Error('private readback details');
        const tx = transaction.call(this, names, mode, options);
        if (this.name === DESTINATION && mode === 'readwrite')
          tx.addEventListener(
            'complete',
            () => {
              complete = true;
            },
            { once: true }
          );
        return tx;
      });
      const closing = vi.spyOn(IDBDatabase.prototype, 'close').mockImplementation(function (
        this: IDBDatabase
      ) {
        close.call(this);
        if (this.name === DESTINATION && failure !== 'readback')
          throw Error('private cleanup details');
      });
      const result = await adoptLegacyClaudeCatalog(input(factory));
      expect(result).toMatchObject({
        kind: 'created',
        verification: failure === 'close' ? 'verified' : 'readback-unavailable',
        cleanup: failure === 'readback' ? 'closed' : 'close-failed',
      });
      expect(complete).toBe(true);
      expect(closing.mock.contexts.map(db => db.name)).toEqual([SOURCE, DESTINATION]);
      intercept.mockRestore();
      closing.mockRestore();
      expect(await sourceSnapshot(factory)).toEqual(before);
      expect((await snapshot(factory)).owners).toHaveLength(1);
      await expect(adoptLegacyClaudeCatalog(input(factory))).resolves.toMatchObject({
        kind: 'already-created',
        verification: 'verified',
        cleanup: 'closed',
      });
    }
  );

  it('does not confirm a readback that is canonical but not the committed owner', async () => {
    const factory = new IDBFactory();
    await seed(factory);
    const get = IDBObjectStore.prototype.get;
    const intercept = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (
      this: IDBObjectStore,
      key
    ) {
      const request = get.call(this, key);
      if (this.name === OWNERS) {
        request.addEventListener(
          'success',
          () => {
            const parsed = JSON.parse(new TextDecoder().decode(request.result as Uint8Array));
            Object.defineProperty(request, 'result', {
              value: bytes({ ...parsed, collectionId: collectionB }),
            });
          },
          { once: true }
        );
      }
      return request;
    });
    const result = await adoptLegacyClaudeCatalog(input(factory));
    expect(result).toMatchObject({
      kind: 'created',
      verification: 'owner-mismatch',
      cleanup: 'closed',
      owner: { collectionId: baseline.value.collectionId },
    });
    intercept.mockRestore();
    await expect(adoptLegacyClaudeCatalog(input(factory))).resolves.toMatchObject({
      kind: 'already-created',
      verification: 'verified',
    });
  });
});
