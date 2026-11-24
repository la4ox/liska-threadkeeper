// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBDatabase, IDBFactory, IDBObjectStore, IDBVersionChangeEvent } from 'fake-indexeddb';
import { openClaudeAccountBaselineOwner } from '../../src/claude-account-baseline-owner';
import { prepareClaudeAccountBaseline } from '../../src/claude-account-baseline-owner/codec';
import {
  CLAUDE_ACCOUNT_BASELINE_OWNER_DATABASE as databaseName,
  CLAUDE_ACCOUNT_BASELINE_OWNER_KEY as key,
  CLAUDE_ACCOUNT_BASELINE_OWNER_STORE as store,
} from '../../src/claude-account-baseline-owner/database';
import {
  admitted,
  collectionA,
  collectionB,
} from '../browser/claude-account-baseline-owner/fixture';

afterEach(() => vi.restoreAllMocks());

function observeTerminal(transaction: IDBTransaction): Promise<'complete' | 'abort'> {
  return new Promise(resolve => {
    transaction.addEventListener('complete', () => resolve('complete'), { once: true });
    transaction.addEventListener('abort', () => resolve('abort'), { once: true });
  });
}

function afterInsert(action: (transaction: IDBTransaction) => void) {
  const add = IDBObjectStore.prototype.add;
  return vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
    this: IDBObjectStore,
    value,
    recordKey
  ) {
    const request = add.call(this, value, recordKey);
    request.addEventListener('success', () => action(this.transaction), { once: true });
    return request;
  });
}

async function openRaw(
  factory: IDBFactory,
  version = 1,
  initialize?: (database: IDBDatabase) => void
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, version);
    request.onupgradeneeded = () => initialize?.(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function inspectRaw(factory: IDBFactory) {
  const database = await openRaw(factory);
  try {
    const transaction = database.transaction(store, 'readonly');
    const keys = transaction.objectStore(store).getAllKeys();
    const data = transaction.objectStore(store).getAll();
    expect(await observeTerminal(transaction)).toBe('complete');
    return keys.result.map((recordKey, index) => [recordKey, data.result[index]]);
  } finally {
    database.close();
  }
}

async function insertRaw(
  factory: IDBFactory,
  entries: ReadonlyArray<readonly [IDBValidKey, unknown]>
) {
  const database = await openRaw(factory);
  try {
    const transaction = database.transaction(store, 'readwrite');
    for (const [recordKey, value] of entries) transaction.objectStore(store).add(value, recordKey);
    expect(await observeTerminal(transaction)).toBe('complete');
  } finally {
    database.close();
  }
}

describe('isolated Claude paused owner IndexedDB contract', () => {
  it('creates, reads canonical bytes, reopens for inspection, and reconciles exactly the same seed', async () => {
    const factory = new IDBFactory();
    const owner = await openClaudeAccountBaselineOwner({ indexedDB: factory });
    expect(Object.keys(owner).sort()).toEqual(['close', 'createPaused', 'read']);
    expect(await owner.read()).toBeNull();
    const input = admitted(12);
    const created = await owner.createPaused(collectionA, input);
    expect(created.kind).toBe('created');
    const expected = prepareClaudeAccountBaseline(collectionA, input);
    expect(created.baseline).toEqual(expected.value);
    expect(await inspectRaw(factory)).toEqual([[key, expected.bytes]]);
    await owner.close();
    const reopened = await openClaudeAccountBaselineOwner({ indexedDB: factory });
    expect(await reopened.read()).toEqual(created.baseline);
    const add = vi.spyOn(IDBObjectStore.prototype, 'add');
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    await expect(reopened.createPaused(collectionA, admitted(12))).resolves.toEqual({
      kind: 'already-created',
      baseline: created.baseline,
    });
    await expect(reopened.createPaused(collectionB, input)).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(
      reopened.createPaused(collectionA, admitted(12, 'different'))
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(add).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(await inspectRaw(factory)).toEqual([[key, expected.bytes]]);
    expect(await factory.databases()).toEqual([{ name: databaseName, version: 1 }]);
    await reopened.close();
  });

  it('allows one writer across two handles without overwrite or a second key', async () => {
    const factory = new IDBFactory();
    const handles = await Promise.all([
      openClaudeAccountBaselineOwner({ indexedDB: factory }),
      openClaudeAccountBaselineOwner({ indexedDB: factory }),
    ]);
    const results = await Promise.allSettled([
      handles[0].createPaused(collectionA, admitted(12)),
      handles[1].createPaused(collectionB, admitted(30)),
    ]);
    const winner = results.find(result => result.status === 'fulfilled')!;
    const loser = results.find(result => result.status === 'rejected')!;
    expect(winner.value.kind).toBe('created');
    expect(loser.reason).toMatchObject({ code: 'conflict' });
    expect(await handles[1].read()).toEqual(winner.value.baseline);
    expect(await inspectRaw(factory)).toEqual([
      [
        key,
        prepareClaudeAccountBaseline(
          winner.value.baseline.collectionId,
          winner.value.baseline.admission
        ).bytes,
      ],
    ]);
    await Promise.all(handles.map(handle => handle.close()));
  });

  it('waits for observed abort after successful add, leaving no record', async () => {
    const factory = new IDBFactory();
    const owner = await openClaudeAccountBaselineOwner({ indexedDB: factory });
    const signal = new AbortController();
    let terminal: Promise<'complete' | 'abort'> | undefined;
    afterInsert(transaction => {
      terminal = observeTerminal(transaction);
      signal.abort('not-logged');
    });
    await expect(owner.createPaused(collectionA, admitted(), signal.signal)).rejects.toMatchObject({
      code: 'transaction-aborted',
      message: 'transaction-aborted',
    });
    expect(terminal).toBeDefined();
    expect(await terminal).toBe('abort');
    expect(await owner.read()).toBeNull();
    expect(await inspectRaw(factory)).toEqual([]);
    await owner.close();
  });

  it('returns committed paused state when commit wins against a late cancellation', async () => {
    const factory = new IDBFactory();
    const owner = await openClaudeAccountBaselineOwner({ indexedDB: factory });
    const controller = new AbortController();
    let terminal: Promise<'complete' | 'abort'> | undefined;
    afterInsert(transaction => {
      terminal = observeTerminal(transaction);
      transaction.commit();
      controller.abort();
    });
    const result = await owner.createPaused(collectionA, admitted(), controller.signal);
    expect(controller.signal.aborted).toBe(true);
    expect(await terminal).toBe('complete');
    expect(result.kind).toBe('created');
    expect(await owner.read()).toEqual(result.baseline);
    await owner.close();
  });

  it.each(['close', 'versionchange', 'timeout'] as const)(
    'waits for transaction abort when %s is requested after add success',
    async event => {
      const factory = new IDBFactory();
      const timeoutMs = 139;
      const owner = await openClaudeAccountBaselineOwner({ indexedDB: factory, timeoutMs });
      let terminal: Promise<'complete' | 'abort'> | undefined;
      let closing: Promise<void> | undefined;
      let invokeTimeout: (() => void) | undefined;
      const schedule = globalThis.setTimeout;
      const clock = vi
        .spyOn(globalThis, 'setTimeout')
        .mockImplementation((callback, milliseconds, ...args) => {
          if (milliseconds === timeoutMs && !invokeTimeout) invokeTimeout = () => callback(...args);
          return schedule(callback, milliseconds, ...args);
        });
      afterInsert(transaction => {
        terminal = observeTerminal(transaction);
        if (event === 'close') closing = owner.close();
        else if (event === 'versionchange')
          transaction.db.dispatchEvent(
            new IDBVersionChangeEvent('versionchange', { oldVersion: 1, newVersion: 2 })
          );
        else invokeTimeout?.();
      });
      await expect(owner.createPaused(collectionA, admitted())).rejects.toMatchObject({
        code: 'transaction-aborted',
      });
      expect(await terminal).toBe('abort');
      await closing;
      clock.mockRestore();
      if (event === 'close') await expect(owner.read()).rejects.toMatchObject({ code: 'closed' });
      if (event === 'versionchange')
        await expect(owner.read()).rejects.toMatchObject({ code: 'version-changed' });
      const reopened = await openClaudeAccountBaselineOwner({ indexedDB: factory });
      expect(await reopened.read()).toBeNull();
      await Promise.all([owner.close(), reopened.close()]);
    }
  );

  it.each(['complete', 'abort'] as const)(
    'fences the handle when the %s observation is lost; a fresh read determines stored truth',
    async actual => {
      const factory = new IDBFactory();
      const owner = await openClaudeAccountBaselineOwner({ indexedDB: factory, timeoutMs: 100 });
      const controller = new AbortController();
      let terminal: Promise<'complete' | 'abort'> | undefined;
      const inserted = afterInsert(transaction => {
        terminal = observeTerminal(transaction);
        if (actual === 'complete') transaction.oncomplete = null;
        else {
          transaction.onabort = null;
          controller.abort();
        }
      });
      await expect(
        owner.createPaused(collectionA, admitted(), controller.signal)
      ).rejects.toMatchObject({
        code: 'transaction-outcome-unknown',
      });
      expect(await terminal).toBe(actual);
      inserted.mockRestore();
      await expect(owner.read()).rejects.toMatchObject({ code: 'transaction-outcome-unknown' });
      await expect(owner.createPaused(collectionB, admitted())).rejects.toMatchObject({
        code: 'transaction-outcome-unknown',
      });
      const fresh = await openClaudeAccountBaselineOwner({ indexedDB: factory });
      const truth = await fresh.read();
      expect(truth).toEqual(
        actual === 'complete' ? prepareClaudeAccountBaseline(collectionA, admitted()).value : null
      );
      await Promise.all([owner.close(), fresh.close()]);
    }
  );

  it('opens no write transaction for an invalid admission or pre-aborted signal', async () => {
    const factory = new IDBFactory();
    const owner = await openClaudeAccountBaselineOwner({ indexedDB: factory });
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');
    await expect(owner.createPaused(collectionA, {})).rejects.toMatchObject({
      code: 'invalid-input',
    });
    await expect(
      owner.createPaused(collectionA, admitted(), AbortSignal.abort())
    ).rejects.toMatchObject({ code: 'transaction-aborted' });
    expect(transaction).not.toHaveBeenCalled();
    await owner.close();
  });

  it('uses strict durability and retries only an unsupported options signature', async () => {
    const factory = new IDBFactory();
    const owner = await openClaudeAccountBaselineOwner({ indexedDB: factory });
    const original = IDBDatabase.prototype.transaction;
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
      this: IDBDatabase,
      names,
      mode,
      options
    ) {
      if (options) throw new TypeError('legacy signature');
      return original.call(this, names, mode);
    });
    expect((await owner.createPaused(collectionA, admitted(0))).kind).toBe('created');
    expect(transaction.mock.calls).toEqual([
      [store, 'readwrite', { durability: 'strict' }],
      [store, 'readwrite'],
    ]);
    await owner.close();
  });

  it.each([
    { entries: [['alien', 'foreign']] },
    { entries: [[key, { schema: 'invalid and untouched' }]] },
    { entries: [[key, new Uint8Array(65537)]] },
    {
      entries: [
        [key, prepareClaudeAccountBaseline(collectionA, admitted()).bytes],
        ['zzz', 'foreign-after-valid-key'],
      ],
    },
  ] as const)('does not change corrupt inventory (%#)', async ({ entries }) => {
    const factory = new IDBFactory();
    const owner = await openClaudeAccountBaselineOwner({ indexedDB: factory });
    await insertRaw(factory, entries);
    const before = await inspectRaw(factory);
    await expect(owner.read()).rejects.toMatchObject({ code: 'corrupt' });
    await expect(owner.createPaused(collectionA, admitted())).rejects.toMatchObject({
      code: 'corrupt',
    });
    expect(await inspectRaw(factory)).toEqual(before);
    await owner.close();
  });

  it('does not adopt a foreign record version or alter a foreign physical schema', async () => {
    const factory = new IDBFactory();
    const owner = await openClaudeAccountBaselineOwner({ indexedDB: factory });
    const { value } = prepareClaudeAccountBaseline(collectionA, admitted());
    const foreign = new TextEncoder().encode(JSON.stringify({ ...value, schema: 'foreign/2' }));
    await insertRaw(factory, [[key, foreign]]);
    await expect(owner.read()).rejects.toMatchObject({ code: 'unsupported' });
    await expect(owner.createPaused(collectionA, admitted())).rejects.toMatchObject({
      code: 'unsupported',
    });
    expect(await inspectRaw(factory)).toEqual([[key, foreign]]);
    await owner.close();
    for (const [version, names] of [
      [1, ['extra']],
      [1, [store, 'extra']],
      [2, [store]],
    ] as const) {
      const wrong = new IDBFactory();
      const db = await openRaw(wrong, version, database =>
        names.forEach(name => database.createObjectStore(name))
      );
      db.close();
      await expect(openClaudeAccountBaselineOwner({ indexedDB: wrong })).rejects.toMatchObject({
        code: 'unsupported',
      });
      const unchanged = await openRaw(wrong, version);
      expect(Array.from(unchanged.objectStoreNames)).toEqual([...names].sort());
      unchanged.close();
    }
  });

  it('leaves older domain databases untouched', async () => {
    const indexedDB = new IDBFactory();
    const olderName = 'liska-baseline-owner-v2';
    const untouched = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(olderName);
      request.onupgradeneeded = () => request.result.createObjectStore('older-domain');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    untouched.onversionchange = () => expect.fail('older domain received a versionchange');
    const open = vi.spyOn(indexedDB, 'open');
    const owner = await openClaudeAccountBaselineOwner({ indexedDB });
    await owner.createPaused(collectionA, admitted(0));
    expect(open.mock.calls).toEqual([[databaseName, 1]]);
    expect(Array.from(untouched.objectStoreNames)).toEqual(['older-domain']);
    await owner.close();
    untouched.close();
  });
});
