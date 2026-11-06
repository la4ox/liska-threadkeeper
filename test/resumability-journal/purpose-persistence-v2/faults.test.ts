// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore, IDBDatabase, IDBVersionChangeEvent } from 'fake-indexeddb';
import {
  createPurposePersistenceStore,
  JOURNAL_DATABASE_NAME,
  JOURNAL_STORE_NAME,
  type PurposePersistenceStore,
  type PurposeStoreOptions,
  type JournalTimers,
} from '../../../src/resumability-journal/purpose-persistence-v2/idb';
import { reserve, sha256 } from './fixtures';
import { deferred } from '../../snapshot-catalog/fixtures';

class ManualTimers implements JournalTimers {
  pending = new Map<number, () => void>();
  sequence = 0;
  setTimeout(callback: () => void) {
    const id = ++this.sequence;
    this.pending.set(id, callback);
    return id;
  }
  clearTimeout(handle: unknown) {
    this.pending.delete(handle as number);
  }
  fire() {
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    callbacks.forEach(callback => callback());
  }
}
let factory: IDBFactory, stores: PurposePersistenceStore[];
function store(options: Partial<PurposeStoreOptions> = {}) {
  const value = createPurposePersistenceStore({ indexedDB: factory, sha256, ...options });
  stores.push(value);
  return value;
}
beforeEach(() => {
  factory = new IDBFactory();
  stores = [];
});
afterEach(() => {
  vi.restoreAllMocks();
  stores.forEach(value => value.close());
});
function fence(
  tx: IDBTransaction,
  mode: 'timeout' | 'close' | 'versionchange',
  value: PurposePersistenceStore,
  timers: ManualTimers
) {
  if (mode === 'timeout') timers.fire();
  else if (mode === 'close') value.close();
  else
    tx.db.dispatchEvent(
      new IDBVersionChangeEvent('versionchange', { oldVersion: 1, newVersion: 2 })
    );
}

describe('v2 commit ownership and bounded failure outcomes', () => {
  it('releases claim/token only after actual transaction completion, not put success', async () => {
    const value = store();
    await value.open();
    await reserve(value);
    let complete = false,
      requestSuccess = false;
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (record, key) {
      const request = put.call(this, record, key);
      request.addEventListener('success', () => {
        requestSuccess = true;
        expect(complete).toBe(false);
      });
      this.transaction.addEventListener('complete', () => {
        complete = true;
      });
      return request;
    });
    const result = await value.claimDispatch('operation-1', 0);
    expect(requestSuccess).toBe(true);
    expect(complete).toBe(true);
    expect(await value.checkCurrent(result.token)).toBe(true);
  });

  it.each([
    ['QuotaExceededError', 'quota-exceeded'],
    ['UnknownError', 'write-failed'],
  ] as const)('maps %s and rolls back without exposing native text', async (name, code) => {
    const value = store();
    await value.open();
    const reserved = await reserve(value);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('private', name);
    });
    await expect(value.claimDispatch('operation-1', 0)).rejects.toMatchObject({
      code,
      message: code,
    });
    put.mockRestore();
    expect(await value.read('operation-1')).toEqual(reserved.record);
  });

  it('rejects asynchronous request failure without partial insert or retry', async () => {
    const value = store();
    await value.open();
    await reserve(value);
    const add = IDBObjectStore.prototype.add;
    const failing = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (record) {
      return add.call(this, record, 'operation-1');
    });
    await expect(reserve(value, '2')).rejects.toMatchObject({ code: 'write-failed' });
    expect(failing).toHaveBeenCalledOnce();
    failing.mockRestore();
    expect(await value.list()).toHaveLength(1);
  });

  it('aborts a queued claim without issuing any token', async () => {
    const value = store();
    await value.open();
    const reserved = await reserve(value);
    const put = IDBObjectStore.prototype.put;
    const failing = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (record, key) {
        const request = put.call(this, record, key);
        this.transaction.abort();
        return request;
      });
    await expect(value.claimDispatch('operation-1', 0)).rejects.toMatchObject({
      code: 'transaction-aborted',
    });
    failing.mockRestore();
    expect(await value.read('operation-1')).toEqual(reserved.record);
  });

  it.each(['timeout', 'close', 'versionchange'] as const)(
    'waits for accepted %s abort and leaves committed record unchanged',
    async mode => {
      const timers = new ManualTimers();
      const value = store({ timers }),
        reader = store();
      await Promise.all([value.open(), reader.open()]);
      const reserved = await reserve(value);
      let aborted = false;
      const put = IDBObjectStore.prototype.put;
      const failing = vi
        .spyOn(IDBObjectStore.prototype, 'put')
        .mockImplementation(function (record, key) {
          const request = put.call(this, record, key);
          this.transaction.addEventListener('abort', () => {
            aborted = true;
          });
          fence(this.transaction, mode, value, timers);
          return request;
        });
      await expect(value.claimDispatch('operation-1', 0)).rejects.toMatchObject({
        code:
          mode === 'timeout'
            ? 'transaction-timeout'
            : mode === 'close'
              ? 'closed'
              : 'version-changed',
      });
      expect(aborted).toBe(true);
      failing.mockRestore();
      expect(await reader.read('operation-1')).toEqual(reserved.record);
      expect(timers.pending.size).toBe(0);
    }
  );

  it.each(['timeout', 'close', 'versionchange'] as const)(
    'observes late commit after refused %s abort; closed sessions never mint tokens',
    async mode => {
      const timers = new ManualTimers();
      const value = store({ timers }),
        reader = store();
      await Promise.all([value.open(), reader.open()]);
      await reserve(value);
      let completed = false;
      let abort: ReturnType<typeof vi.spyOn> | undefined;
      const put = IDBObjectStore.prototype.put;
      const failing = vi
        .spyOn(IDBObjectStore.prototype, 'put')
        .mockImplementation(function (record, key) {
          const request = put.call(this, record, key);
          this.transaction.addEventListener('complete', () => {
            completed = true;
          });
          this.transaction.commit();
          abort = vi.spyOn(this.transaction, 'abort');
          fence(this.transaction, mode, value, timers);
          return request;
        });
      const running = value.claimDispatch('operation-1', 0);
      if (mode === 'timeout') {
        const result = await running;
        expect(completed).toBe(true);
        expect(await value.checkCurrent(result.token)).toBe(true);
      } else await expect(running).rejects.toMatchObject({ code: 'closed' });
      expect(completed).toBe(true);
      expect(abort).toHaveBeenCalledOnce();
      expect(abort!.mock.results[0]).toMatchObject({
        type: 'throw',
        value: { name: 'InvalidStateError' },
      });
      failing.mockRestore();
      expect(await reader.read('operation-1')).toMatchObject({ phase: 'in-flight', revision: 1 });
      expect(timers.pending.size).toBe(0);
    }
  );

  it('missing terminal event returns outcome-unknown even if bytes committed, with no token or automatic retry', async () => {
    const timers = new ManualTimers();
    const value = store({ timers }),
      reader = store();
    await Promise.all([value.open(), reader.open()]);
    await reserve(value);
    const committed = deferred<void>();
    const put = IDBObjectStore.prototype.put;
    const failing = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (record, key) {
        const request = put.call(this, record, key);
        this.transaction.oncomplete = null;
        this.transaction.addEventListener('complete', () => committed.resolve());
        this.transaction.commit();
        timers.fire();
        return request;
      });
    const mutation = value.claimDispatch('operation-1', 0);
    let settled = false;
    void mutation.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await committed.promise;
    expect(settled).toBe(false);
    expect(failing).toHaveBeenCalledOnce();
    failing.mockRestore();
    expect(await reader.read('operation-1')).toMatchObject({ phase: 'in-flight' });
    const assertion = expect(mutation).rejects.toMatchObject({
      code: 'transaction-outcome-unknown',
    });
    timers.fire();
    await assertion;
    await expect(value.claimDispatch('operation-1', 1)).rejects.toMatchObject({
      code: 'transition-failed',
    });
    expect(timers.pending.size).toBe(0);
  });

  it('rolls back the entire recovery batch when a later write fails', async () => {
    const value = store();
    await value.open();
    await reserve(value);
    await reserve(value, '2');
    await value.claimDispatch('operation-1', 0);
    await value.claimDispatch('operation-2', 0);
    const before = await value.list();
    const put = IDBObjectStore.prototype.put;
    const failing = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (record, key) {
        if (key === 'operation-2') throw new DOMException('private', 'QuotaExceededError');
        return put.call(this, record, key);
      });
    await expect(value.recoverAfterRestart()).rejects.toMatchObject({ code: 'quota-exceeded' });
    failing.mockRestore();
    expect(await value.list()).toEqual(before);
  });

  it('commits no partial observation when the receipt+adaptation put fails', async () => {
    const value = store();
    await value.open();
    await reserve(value);
    const { record, token } = await value.claimDispatch('operation-1', 0);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('private', 'QuotaExceededError');
    });
    await expect(value.recordProducerReceipts('operation-1', 1, [])).rejects.toMatchObject({
      code: 'quota-exceeded',
    });
    put.mockRestore();
    expect(await value.read('operation-1')).toEqual(record);
    expect(await value.checkCurrent(token)).toBe(true);
  });

  it.each(['timeout', 'blocked', 'close'] as const)(
    'bounds %s open and rejects later schema creation',
    async mode => {
      const timers = new ManualTimers();
      const request = {} as IDBOpenDBRequest;
      const value = store({ indexedDB: { open: () => request } as unknown as IDBFactory, timers });
      const opening = value.open();
      const assertion = expect(opening).rejects.toMatchObject({
        code: mode === 'timeout' ? 'open-timeout' : mode === 'blocked' ? 'open-blocked' : 'closed',
      });
      if (mode === 'timeout') timers.fire();
      else if (mode === 'blocked') request.onblocked?.call(request, {} as IDBVersionChangeEvent);
      else value.close();
      await assertion;
      const abort = vi.fn();
      Object.defineProperty(request, 'transaction', { value: { abort } });
      request.onupgradeneeded?.call(request, { oldVersion: 0 } as IDBVersionChangeEvent);
      expect(abort).toHaveBeenCalledOnce();
      const close = vi.fn();
      Object.defineProperty(request, 'result', { value: { close } });
      request.onsuccess?.call(request, new Event('success'));
      expect(close).toHaveBeenCalledOnce();
      expect(timers.pending.size).toBe(0);
    }
  );

  it('maps throwing open and schema quota failure without leaking native text', async () => {
    await expect(
      store({
        indexedDB: {
          open: () => {
            throw new Error('private');
          },
        } as unknown as IDBFactory,
      }).open()
    ).rejects.toMatchObject({ code: 'open-failed', message: 'open-failed' });
    const create = vi.spyOn(IDBDatabase.prototype, 'createObjectStore').mockImplementation(() => {
      throw new DOMException('private', 'QuotaExceededError');
    });
    await expect(store().open()).rejects.toMatchObject({ code: 'quota-exceeded' });
    create.mockRestore();
    const value = store();
    await value.open();
    expect(await value.list()).toEqual([]);
  });

  it.each(['extra-store', 'key-path', 'index', 'auto-increment'] as const)(
    'rejects %s schema without replacement',
    async kind => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open(JOURNAL_DATABASE_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          const table = db.createObjectStore(JOURNAL_STORE_NAME, {
            ...(kind === 'key-path' && { keyPath: 'key' }),
            ...(kind === 'auto-increment' && { autoIncrement: true }),
          });
          if (kind === 'extra-store') db.createObjectStore('unexpected');
          if (kind === 'index') table.createIndex('extra', 'key');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await expect(store().open()).rejects.toMatchObject({ code: 'invalid-schema' });
      } finally {
        db.close();
      }
    }
  );
});
