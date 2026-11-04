// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore, IDBDatabase, IDBVersionChangeEvent } from 'fake-indexeddb';
import {
  createJournal,
  encodeJournal,
  transitionJournal,
  ResumabilityJournalError,
  type ResumabilityJournal,
} from '../../src/resumability-journal/core';
import {
  createJournalStore,
  JournalStorageError,
  JOURNAL_DATABASE_NAME,
  JOURNAL_DATABASE_VERSION,
  JOURNAL_STORE_NAME,
  type JournalStore,
  type JournalStoreOptions,
  type JournalTimers,
} from '../../src/resumability-journal/idb';

function fixture(runId = 'run-1'): ResumabilityJournal {
  return createJournal({
    runId,
    catalogSha256: 'a'.repeat(64),
    items: [
      {
        itemId: 'item-1',
        provider: 'chatgpt',
        conversationId: 'conversation-1',
        conversationKey: 'liska-conversation-key/1:' + 'b'.repeat(64),
      },
    ],
  });
}

const activate = (journal: ResumabilityJournal) =>
  transitionJournal(journal, {
    type: 'activate',
    expectedRunRevision: journal.revision,
  }).journal;

class ManualTimers implements JournalTimers {
  pending = new Map<number, () => void>();
  private sequence = 0;
  setTimeout(callback: () => void) {
    const handle = ++this.sequence;
    this.pending.set(handle, callback);
    return handle;
  }
  clearTimeout(handle: unknown) {
    this.pending.delete(handle as number);
  }
  fire() {
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const callback of callbacks) callback();
  }
}

function fenceTransaction(
  transaction: IDBTransaction,
  fence: 'timeout' | 'close' | 'versionchange',
  value: JournalStore,
  timers: ManualTimers
): void {
  if (fence === 'timeout') timers.fire();
  else if (fence === 'close') value.close();
  else
    transaction.db.dispatchEvent(
      new IDBVersionChangeEvent('versionchange', {
        oldVersion: JOURNAL_DATABASE_VERSION,
        newVersion: JOURNAL_DATABASE_VERSION + 1,
      })
    );
}

let factory: IDBFactory;
let stores: JournalStore[];
let databases: IDBDatabase[];

function store(options: JournalStoreOptions = {}) {
  const value = createJournalStore({ indexedDB: factory, ...options });
  stores.push(value);
  return value;
}

function rawOpen(version = 1, upgrade?: (database: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(JOURNAL_DATABASE_NAME, version);
    request.onupgradeneeded = () => upgrade?.(request.result);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      databases.push(request.result);
      resolve(request.result);
    };
  });
}

function rawWrite(database: IDBDatabase, key: IDBValidKey, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(JOURNAL_STORE_NAME, 'readwrite');
    transaction.objectStore(JOURNAL_STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

async function rawRead(database: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(JOURNAL_STORE_NAME, 'readonly');
    const request = transaction.objectStore(JOURNAL_STORE_NAME).get(key);
    let value: unknown;
    request.onsuccess = () => {
      value = request.result;
    };
    transaction.oncomplete = () => resolve(value);
    transaction.onabort = () => reject(transaction.error);
  });
}

beforeEach(() => {
  factory = new IDBFactory();
  stores = [];
  databases = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const value of stores) value.close();
  for (const database of databases) database.close();
});

describe('dedicated schema-v1 journal store', () => {
  it('does nothing until explicit open and creates exactly the dedicated out-of-line store', async () => {
    const opening = vi.spyOn(factory, 'open');
    const value = store();
    expect(opening).not.toHaveBeenCalled();
    await expect(value.list()).rejects.toMatchObject({ code: 'not-open' });
    await Promise.all([value.open(), value.open()]);
    expect(opening).toHaveBeenCalledTimes(1);
    expect(opening).toHaveBeenCalledWith(JOURNAL_DATABASE_NAME, JOURNAL_DATABASE_VERSION);
    const database = await rawOpen();
    expect([...database.objectStoreNames]).toEqual([JOURNAL_STORE_NAME]);
    const objectStore = database.transaction(JOURNAL_STORE_NAME).objectStore(JOURNAL_STORE_NAME);
    expect(objectStore.keyPath).toBeNull();
    expect(objectStore.autoIncrement).toBe(false);
    expect(objectStore.indexNames.length).toBe(0);
    await value.open();
    expect(opening).toHaveBeenCalledTimes(2); // The only other open was the independent inspection.
  });

  it('creates, reads, and lists detached canonical records in primary-key order', async () => {
    const value = store();
    await value.open();
    const second = fixture('run-2');
    const first = fixture();
    expect(await value.create(second)).toEqual(second);
    expect(await value.create(first)).toEqual(first);
    expect(await value.read('missing')).toBeUndefined();
    const read = await value.read(first.runId);
    expect(read).toEqual(first);
    expect(read).not.toBe(first);
    const summaries = await value.list();
    expect(summaries).toEqual(
      ['run-1', 'run-2'].map(runId => ({
        runId,
        revision: 0,
        control: 'paused',
        itemCount: 1,
        attemptCount: 0,
        itemStates: {
          pending: 1,
          running: 0,
          recorded: 0,
          deferred: 0,
          failed: 0,
          unknown: 0,
          cancelled: 0,
        },
      }))
    );
    expect(JSON.stringify(summaries)).not.toContain('conversation-1');
    const database = await rawOpen();
    expect(await rawRead(database, first.runId)).toEqual(encodeJournal(first));
  });

  it('refuses collisions and a seventeenth run without pruning or changing existing records', async () => {
    const value = store();
    await value.open();
    await Promise.all(
      Array.from({ length: 16 }, (_, index) => value.create(fixture('run-' + index)))
    );
    await expect(value.create(fixture('run-0'))).rejects.toMatchObject({ code: 'run-exists' });
    await expect(value.create(fixture('run-16'))).rejects.toMatchObject({ code: 'run-limit' });
    expect(await value.list()).toHaveLength(16);
    expect(await value.read('run-0')).toEqual(fixture('run-0'));
    expect(await value.read('run-16')).toBeUndefined();
  });

  it('closes explicitly and allows an explicit reopen without recovery or mutation', async () => {
    const value = store();
    await value.open();
    const active = activate(fixture());
    await value.create(active);
    value.close();
    await expect(value.read(active.runId)).rejects.toMatchObject({ code: 'closed' });
    await value.open();
    expect(await value.read(active.runId)).toEqual(active);
  });

  it('rejects unavailable native IDB with only a fixed error', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const value = createJournalStore();
    try {
      await expect(value.open()).rejects.toMatchObject({
        code: 'unavailable',
        message: 'unavailable',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    [
      'missing store',
      (database: IDBDatabase) => {
        database.createObjectStore('unrelated');
      },
    ],
    [
      'extra store',
      (database: IDBDatabase) => {
        database.createObjectStore(JOURNAL_STORE_NAME);
        database.createObjectStore('other');
      },
    ],
    [
      'inline key',
      (database: IDBDatabase) => {
        database.createObjectStore(JOURNAL_STORE_NAME, { keyPath: 'runId' });
      },
    ],
    [
      'auto increment',
      (database: IDBDatabase) => {
        database.createObjectStore(JOURNAL_STORE_NAME, { autoIncrement: true });
      },
    ],
    [
      'index',
      (database: IDBDatabase) => {
        database.createObjectStore(JOURNAL_STORE_NAME).createIndex('other', 'other');
      },
    ],
  ])('rejects %s without replacing the schema', async (_, upgrade) => {
    const database = await rawOpen(1, upgrade);
    const originalStores = [...database.objectStoreNames];
    const value = store();
    await expect(value.open()).rejects.toMatchObject({ code: 'invalid-schema' });
    expect([...database.objectStoreNames]).toEqual(originalStores);
  });

  it('refuses unknown newer versions without delete/reset', async () => {
    const database = await rawOpen(2, database => database.createObjectStore(JOURNAL_STORE_NAME));
    await rawWrite(database, 'run-1', encodeJournal(fixture()));
    await expect(store().open()).rejects.toMatchObject({ code: 'unsupported-version' });
    expect(database.version).toBe(2);
    expect(await rawRead(database, 'run-1')).toEqual(encodeJournal(fixture()));
  });

  it('closes on real versionchange, fences subsequent operations and permits the external upgrade', async () => {
    const value = store();
    await value.open();
    await value.create(fixture());
    const upgraded = await rawOpen(2);
    await expect(value.list()).rejects.toMatchObject({ code: 'version-changed' });
    expect(await rawRead(upgraded, 'run-1')).toEqual(encodeJournal(fixture()));
    await expect(value.open()).rejects.toMatchObject({ code: 'unsupported-version' });
  });
});

describe('atomic expected-revision mutation and explicit recovery', () => {
  it('serializes two page instances: exactly one wins the same revision and the other conflicts', async () => {
    const first = store();
    const second = store();
    await Promise.all([first.open(), second.open()]);
    await first.create(fixture());
    const reducer = vi.fn(activate);
    const outcomes = await Promise.allSettled([
      first.mutate('run-1', 0, reducer),
      second.mutate('run-1', 0, reducer),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'revision-conflict' });
    expect(reducer).toHaveBeenCalledTimes(1);
    expect(await second.read('run-1')).toEqual(activate(fixture()));
  });

  it('refuses stale/missing mutations without calling their reducer', async () => {
    const value = store();
    await value.open();
    await value.create(fixture());
    const reducer = vi.fn(activate);
    await expect(value.mutate('missing', 0, reducer)).rejects.toMatchObject({
      code: 'run-not-found',
    });
    await expect(value.mutate('run-1', 3, reducer)).rejects.toMatchObject({
      code: 'revision-conflict',
    });
    expect(reducer).not.toHaveBeenCalled();
    expect(await value.read('run-1')).toEqual(fixture());
  });

  it('enforces the sixteenth-run cap across two competing page instances', async () => {
    const first = store();
    const second = store();
    await Promise.all([first.open(), second.open()]);
    for (let index = 0; index < 15; index++) await first.create(fixture('run-' + index));
    const outcomes = await Promise.allSettled([
      first.create(fixture('run-a')),
      second.create(fixture('run-b')),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failed = outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: 'run-limit' });
    expect(await first.list()).toHaveLength(16);
  });

  it('does not rewrite bytes for identical mutation or already-paused recovery', async () => {
    const value = store();
    await value.open();
    await value.create(fixture());
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    expect(await value.mutate('run-1', 0, current => current)).toEqual(fixture());
    expect(await value.recoverAll()).toEqual([fixture()]);
    expect(put).not.toHaveBeenCalled();
    expect(await rawRead(await rawOpen(), 'run-1')).toEqual(encodeJournal(fixture()));
  });

  it('allows byte-identical no-op only, rejecting identity changes, wrong revisions and async reducers', async () => {
    const value = store();
    await value.open();
    await value.create(fixture());
    expect(await value.mutate('run-1', 0, current => current)).toEqual(fixture());
    for (const reducer of [
      (current: ResumabilityJournal) => ({ ...current, runId: 'run-2', revision: 1 }),
      (current: ResumabilityJournal) => ({ ...current, revision: 2 }),
      (current: ResumabilityJournal) => ({ ...current, catalogSha256: 'c'.repeat(64) }),
    ]) {
      await expect(value.mutate('run-1', 0, reducer)).rejects.toMatchObject({
        code: 'transition-failed',
      });
    }
    const asyncReducer = (async (current: ResumabilityJournal) =>
      activate(current)) as unknown as typeof activate;
    await expect(value.mutate('run-1', 0, asyncReducer)).rejects.toBeInstanceOf(
      ResumabilityJournalError
    );
    expect(await value.read('run-1')).toEqual(fixture());
  });

  it('preserves safe core errors but never native reducer text', async () => {
    const value = store();
    await value.open();
    await value.create(fixture());
    const error = new ResumabilityJournalError('invalid-transition');
    await expect(
      value.mutate('run-1', 0, () => {
        throw error;
      })
    ).rejects.toBe(error);
    await expect(
      value.mutate('run-1', 0, () => {
        throw new Error('private content');
      })
    ).rejects.toEqual(new JournalStorageError('transition-failed'));
    expect(await value.read('run-1')).toEqual(fixture());
  });

  it('preserves committed running state on open and recovers it to exact paused/unknown only on explicit recovery', async () => {
    const first = store();
    await first.open();
    await first.create(fixture());
    const active = await first.mutate('run-1', 0, activate);
    const running = await first.mutate(
      'run-1',
      active.revision,
      current =>
        transitionJournal(current, {
          type: 'begin-attempt',
          expectedRunRevision: current.revision,
          itemId: 'item-1',
          expectedItemRevision: current.items[0].revision,
          attemptId: 'attempt-1',
          captureId: 'capture-1',
        }).journal
    );
    first.close();
    const restarted = store();
    await restarted.open();
    expect(await restarted.read('run-1')).toEqual(running);
    const expected = transitionJournal(running, {
      type: 'recover-after-restart',
      expectedRunRevision: running.revision,
    }).journal;
    expect(await restarted.recoverAll()).toEqual([expected]);
    expect(expected.control).toBe('paused');
    expect(expected.items[0].attempts[0]).toMatchObject({
      attemptId: 'attempt-1',
      captureId: 'capture-1',
      revision: 1,
      state: 'settled',
      outcome: { kind: 'unknown', reason: 'interrupted-by-restart' },
    });
    expect(await restarted.recoverAll()).toEqual([expected]);
    expect(await restarted.read('run-1')).toEqual(expected);
    expect(await rawRead(await rawOpen(), 'run-1')).toEqual(encodeJournal(expected));
  });
});

describe('strict persisted record validation', () => {
  it.each([
    ['text instead of bytes', () => new TextDecoder().decode(encodeJournal(fixture()))],
    ['invalid json', () => new TextEncoder().encode('{')],
    [
      'unknown fields',
      () => new TextEncoder().encode(JSON.stringify({ ...fixture(), title: 'private' })),
    ],
    [
      'noncanonical bytes',
      () => new TextEncoder().encode(' ' + new TextDecoder().decode(encodeJournal(fixture()))),
    ],
    ['undefined', () => undefined],
    ['oversize bytes', () => new Uint8Array(8 * 1024 * 1024 + 1)],
    ['key mismatch', () => encodeJournal(fixture('different-run'))],
  ])('refuses %s without changing or dropping the corrupt record', async (_, makeValue) => {
    const value = store();
    await value.open();
    const database = await rawOpen();
    const malformed = makeValue();
    await rawWrite(database, 'run-1', malformed);
    for (const operation of [
      () => value.read('run-1'),
      () => value.list(),
      () => value.mutate('run-1', 0, activate),
      () => value.recoverAll(),
      () => value.create(fixture('new-run')),
    ])
      await expect(operation()).rejects.toMatchObject({ code: 'corrupt-record' });
    const retained = await rawRead(database, 'run-1');
    if (malformed instanceof Uint8Array) {
      expect(retained).toBeInstanceOf(Uint8Array);
      expect(Buffer.compare(Buffer.from(retained as Uint8Array), Buffer.from(malformed))).toBe(0);
    } else expect(retained).toEqual(malformed);
    expect(await rawRead(database, 'new-run')).toBeUndefined();
  });

  it('rejects a non-string key even when its journal bytes are valid', async () => {
    const value = store();
    await value.open();
    await rawWrite(await rawOpen(), 1, encodeJournal(fixture()));
    await expect(value.list()).rejects.toMatchObject({ code: 'corrupt-record' });
  });

  it('does not partially recover earlier records when a later record is malformed', async () => {
    const value = store();
    await value.open();
    const active = activate(fixture('run-a'));
    await value.create(active);
    const database = await rawOpen();
    await rawWrite(database, 'run-z', 'malformed');
    await expect(value.recoverAll()).rejects.toMatchObject({ code: 'corrupt-record' });
    expect(await value.read('run-a')).toEqual(active);
    expect(await rawRead(database, 'run-z')).toBe('malformed');
  });
});

describe('bounded failures and atomic rollback', () => {
  it.each([
    ['QuotaExceededError', 'quota-exceeded'],
    ['DataCloneError', 'write-failed'],
  ])(
    'maps native %s without private text and leaves committed bytes unchanged',
    async (name, code) => {
      const value = store();
      await value.open();
      await value.create(fixture());
      const write = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
        throw new DOMException('private native message', name);
      });
      await expect(value.mutate('run-1', 0, activate)).rejects.toMatchObject({
        code,
        message: code,
      });
      write.mockRestore();
      expect(await value.read('run-1')).toEqual(fixture());
    }
  );

  it('handles an asynchronous native write request failure without changing the existing record', async () => {
    const value = store();
    await value.open();
    await value.create(fixture());
    const nativeAdd = IDBObjectStore.prototype.add;
    const add = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (record) {
      return nativeAdd.call(this, record, 'run-1');
    });
    await expect(value.create(fixture('run-2'))).rejects.toMatchObject({ code: 'write-failed' });
    add.mockRestore();
    expect(await value.read('run-1')).toEqual(fixture());
    expect(await value.read('run-2')).toBeUndefined();
  });

  it('reports transaction abort and never returns success for a queued write', async () => {
    const value = store();
    await value.open();
    await value.create(fixture());
    const nativePut = IDBObjectStore.prototype.put;
    const put = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (record, key) {
        const request = nativePut.call(this, record, key);
        this.transaction.abort();
        return request;
      });
    await expect(value.mutate('run-1', 0, activate)).rejects.toMatchObject({
      code: 'transaction-aborted',
    });
    put.mockRestore();
    expect(await value.read('run-1')).toEqual(fixture());
  });

  it('aborts all multi-run recovery writes when one write fails', async () => {
    const value = store();
    await value.open();
    const first = activate(fixture('run-a'));
    const second = activate(fixture('run-b'));
    await value.create(first);
    await value.create(second);
    const nativePut = IDBObjectStore.prototype.put;
    const put = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (record, key) {
        if (key === 'run-b') throw new DOMException('private quota', 'QuotaExceededError');
        return nativePut.call(this, record, key);
      });
    await expect(value.recoverAll()).rejects.toMatchObject({ code: 'quota-exceeded' });
    put.mockRestore();
    expect(await value.read('run-a')).toEqual(first);
    expect(await value.read('run-b')).toEqual(second);
  });

  it('aborts a pending local write when explicitly closed', async () => {
    const value = store();
    await value.open();
    await value.create(fixture());
    let aborted = false;
    const nativePut = IDBObjectStore.prototype.put;
    const put = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (record, key) {
        const request = nativePut.call(this, record, key);
        this.transaction.addEventListener('abort', () => {
          aborted = true;
        });
        value.close();
        return request;
      });
    await expect(value.mutate('run-1', 0, activate)).rejects.toMatchObject({ code: 'closed' });
    expect(aborted).toBe(true);
    put.mockRestore();
    await value.open();
    expect(await value.read('run-1')).toEqual(fixture());
  });

  it('bounds transaction lifetime with injected timers, aborting queued changes', async () => {
    const timers = new ManualTimers();
    const value = store({ timers });
    await value.open();
    await value.create(fixture());
    let aborted = false;
    const nativePut = IDBObjectStore.prototype.put;
    const put = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (record, key) {
        const request = nativePut.call(this, record, key);
        this.transaction.addEventListener('abort', () => {
          aborted = true;
        });
        timers.fire();
        return request;
      });
    await expect(value.mutate('run-1', 0, activate)).rejects.toMatchObject({
      code: 'transaction-timeout',
    });
    expect(aborted).toBe(true);
    put.mockRestore();
    expect(await value.read('run-1')).toEqual(fixture());
    expect(timers.pending.size).toBe(0);
  });

  it.each(['timeout', 'close', 'versionchange'] as const)(
    'waits for committed success when %s tries to abort a committing transaction',
    async fence => {
      const timers = new ManualTimers();
      const value = store({ timers });
      const reader = store();
      await Promise.all([value.open(), reader.open()]);
      await value.create(fixture());
      let completed = false;
      let abort: ReturnType<typeof vi.spyOn> | undefined;
      const nativePut = IDBObjectStore.prototype.put;
      const put = vi
        .spyOn(IDBObjectStore.prototype, 'put')
        .mockImplementation(function (record, key) {
          const request = nativePut.call(this, record, key);
          this.transaction.addEventListener('complete', () => {
            completed = true;
          });
          this.transaction.commit();
          abort = vi.spyOn(this.transaction, 'abort');
          fenceTransaction(this.transaction, fence, value, timers);
          return request;
        });
      const committed = await value.mutate('run-1', 0, activate);
      put.mockRestore();
      expect(abort).toHaveBeenCalledOnce();
      expect(abort!.mock.results[0]).toMatchObject({
        type: 'throw',
        value: { name: 'InvalidStateError' },
      });
      expect(completed).toBe(true);
      expect(committed).toEqual(activate(fixture()));
      expect(await reader.read('run-1')).toEqual(committed);
      expect(await rawRead(await rawOpen(), 'run-1')).toEqual(encodeJournal(committed));
      expect(timers.pending.size).toBe(0);
      if (fence !== 'timeout')
        await expect(value.list()).rejects.toMatchObject({
          code: fence === 'close' ? 'closed' : 'version-changed',
        });
    }
  );

  it('still receives create request success after a committing timeout rejected abort', async () => {
    const timers = new ManualTimers();
    const value = store({ timers });
    await value.open();
    let completed = false;
    const nativeAdd = IDBObjectStore.prototype.add;
    const add = vi
      .spyOn(IDBObjectStore.prototype, 'add')
      .mockImplementation(function (record, key) {
        const request = nativeAdd.call(this, record, key);
        this.transaction.addEventListener('complete', () => {
          completed = true;
        });
        this.transaction.commit();
        timers.fire();
        return request;
      });
    const committed = await value.create(fixture());
    add.mockRestore();
    expect(completed).toBe(true);
    expect(committed).toEqual(fixture());
    expect(await value.read('run-1')).toEqual(committed);
    expect(await rawRead(await rawOpen(), 'run-1')).toEqual(encodeJournal(committed));
    expect(timers.pending.size).toBe(0);
  });

  it('waits for accepted versionchange abort and leaves committed bytes unchanged', async () => {
    const timers = new ManualTimers();
    const value = store({ timers });
    const reader = store();
    await Promise.all([value.open(), reader.open()]);
    await value.create(fixture());
    let aborted = false;
    const nativePut = IDBObjectStore.prototype.put;
    const put = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (record, key) {
        const request = nativePut.call(this, record, key);
        this.transaction.addEventListener('abort', () => {
          aborted = true;
        });
        fenceTransaction(this.transaction, 'versionchange', value, timers);
        return request;
      });
    await expect(value.mutate('run-1', 0, activate)).rejects.toMatchObject({
      code: 'version-changed',
    });
    put.mockRestore();
    expect(aborted).toBe(true);
    expect(await reader.read('run-1')).toEqual(fixture());
    expect(await rawRead(await rawOpen(), 'run-1')).toEqual(encodeJournal(fixture()));
    expect(timers.pending.size).toBe(0);
  });

  it('reports only outcome-unknown if terminal events never arrive, even when bytes did commit', async () => {
    const timers = new ManualTimers();
    const value = store({ timers });
    await value.open();
    await value.create(fixture());
    let observeCommit!: () => void;
    const nativeCommitted = new Promise<void>(resolve => {
      observeCommit = resolve;
    });
    const nativePut = IDBObjectStore.prototype.put;
    const put = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (record, key) {
        const request = nativePut.call(this, record, key);
        this.transaction.oncomplete = null; // Deliberately hide the terminal event from the adapter.
        this.transaction.addEventListener('complete', observeCommit);
        this.transaction.commit();
        timers.fire(); // Primary deadline: abort throws, so the outcome must remain pending.
        return request;
      });
    const mutation = value.mutate('run-1', 0, activate);
    let settled = false;
    void mutation.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await nativeCommitted;
    put.mockRestore();
    expect(settled).toBe(false);
    const expected = activate(fixture());
    expect(await rawRead(await rawOpen(), 'run-1')).toEqual(encodeJournal(expected));
    const assertion = expect(mutation).rejects.toMatchObject({
      code: 'transaction-outcome-unknown',
    });
    timers.fire(); // Secondary bound communicates uncertainty, never rollback/no-mutation.
    await assertion;
    expect(await value.read('run-1')).toEqual(expected);
    expect(timers.pending.size).toBe(0);
  });

  it('times out a hanging open without waiting forever and closes late successes', async () => {
    const timers = new ManualTimers();
    const request = {} as IDBOpenDBRequest;
    const openingFactory = { open: () => request } as unknown as IDBFactory;
    const value = store({ indexedDB: openingFactory, timers });
    const opening = value.open();
    const assertion = expect(opening).rejects.toMatchObject({ code: 'open-timeout' });
    timers.fire();
    await assertion;
    const late = await rawOpen(1, database => database.createObjectStore(JOURNAL_STORE_NAME));
    const close = vi.spyOn(late, 'close');
    Object.defineProperty(request, 'result', { value: late });
    request.onsuccess?.call(request, new Event('success'));
    expect(close).toHaveBeenCalledOnce();
    expect(timers.pending.size).toBe(0);
  });

  it('fails closed immediately on blocked open and aborts a later upgrade instead of creating a schema', async () => {
    const timers = new ManualTimers();
    const request = {} as IDBOpenDBRequest;
    const openingFactory = { open: () => request } as unknown as IDBFactory;
    const value = store({ indexedDB: openingFactory, timers });
    const opening = value.open();
    const assertion = expect(opening).rejects.toMatchObject({ code: 'open-blocked' });
    request.onblocked?.call(request, {} as IDBVersionChangeEvent);
    await assertion;
    const abort = vi.fn();
    Object.defineProperty(request, 'transaction', { value: { abort } });
    request.onupgradeneeded?.call(request, { oldVersion: 0 } as IDBVersionChangeEvent);
    expect(abort).toHaveBeenCalledOnce();
    expect(timers.pending.size).toBe(0);
  });

  it('cancels an in-flight open when explicitly closed', async () => {
    const timers = new ManualTimers();
    const request = {} as IDBOpenDBRequest;
    const value = store({ indexedDB: { open: () => request } as unknown as IDBFactory, timers });
    const opening = value.open();
    const assertion = expect(opening).rejects.toMatchObject({ code: 'closed' });
    value.close();
    await assertion;
    expect(timers.pending.size).toBe(0);
  });

  it('maps a throwing native open to a fixed failure without native text', async () => {
    const value = store({
      indexedDB: {
        open: () => {
          throw new Error('private native open');
        },
      } as unknown as IDBFactory,
    });
    await expect(value.open()).rejects.toMatchObject({
      code: 'open-failed',
      message: 'open-failed',
    });
  });

  it('maps schema-creation quota errors without leaving a replacement database', async () => {
    const create = vi.spyOn(IDBDatabase.prototype, 'createObjectStore').mockImplementation(() => {
      throw new DOMException('private quota', 'QuotaExceededError');
    });
    await expect(store().open()).rejects.toMatchObject({ code: 'quota-exceeded' });
    create.mockRestore();
    const value = store();
    await value.open();
    expect(await value.list()).toEqual([]);
  });
});
