// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import {
  createPurposePersistenceStore,
  JOURNAL_DATABASE_NAME,
  JOURNAL_STORE_NAME,
  type PurposePersistenceStore,
  type PurposeDispatchToken,
} from '../../../src/resumability-journal/purpose-persistence-v2/idb';
import {
  decodeRecord,
  encodeRecord,
} from '../../../src/resumability-journal/purpose-persistence-v2/core/record';
import {
  canonical,
  MAX_RECORD_BYTES,
} from '../../../src/resumability-journal/purpose-persistence-v2/core/data';
import { createJournalStore } from '../../../src/resumability-journal/idb';
import { createJournal } from '../../../src/resumability-journal/core';
import { encodeSnapshotCatalog } from '../../../src/archive/catalog';
import { catalog, request, reserve, receipts, sha256, clone, signal, hash } from './fixtures';
import { deferred } from '../../snapshot-catalog/fixtures';

let factory: IDBFactory;
let stores: PurposePersistenceStore[];
let raw: IDBDatabase[];
function store(digest = sha256) {
  const value = createPurposePersistenceStore({ indexedDB: factory, sha256: digest });
  stores.push(value);
  return value;
}
async function openRaw() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(JOURNAL_DATABASE_NAME, 1);
    request.onsuccess = () => {
      raw.push(request.result);
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}
async function writeRaw(db: IDBDatabase, key: IDBValidKey, value: unknown) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(JOURNAL_STORE_NAME, 'readwrite');
    tx.objectStore(JOURNAL_STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}
beforeEach(() => {
  factory = new IDBFactory();
  stores = [];
  raw = [];
});
afterEach(() => {
  vi.restoreAllMocks();
  stores.forEach(value => value.close());
  raw.forEach(value => value.close());
});

describe('purpose-aware v2 retained operations', () => {
  it('rejects divergent per-call hash overrides without reserving or poisoning retained data', async () => {
    const value = store();
    await value.open();
    const first = await reserve(value);
    const bytes = encodeSnapshotCatalog(await catalog());
    const diverging = vi.fn(async () => 'f'.repeat(64));
    await expect(
      value.reserveChatGpt(bytes, request('2'), { signal: signal(), sha256: diverging } as never)
    ).rejects.toMatchObject({ code: 'transition-failed' });
    expect(await value.list()).toEqual([first.record]);
    const { record, token } = await value.claimDispatch('operation-1', 0);
    await expect(
      Reflect.apply(value.recordProducerReceipts, value, [
        'operation-1',
        1,
        receipts(first.prepared),
        { sha256: diverging, assessment: { kind: 'consistent' } },
      ])
    ).rejects.toMatchObject({ code: 'invalid-receipts' });
    expect(diverging).not.toHaveBeenCalled();
    expect(await value.read('operation-1')).toEqual(record);
    expect(await value.checkCurrent(token)).toBe(true);
    const observed = await value.recordProducerReceipts('operation-1', 1, receipts(first.prepared));
    expect(observed.observation?.adaptation.assessment.kind).toBe('consistent');
    expect(await value.read('operation-1')).toEqual(observed);
  });
  it('fails a temporarily unavailable read verifier without rewriting or condemning an available observation', async () => {
    let available = true;
    const value = createPurposePersistenceStore({
      indexedDB: factory,
      sha256: bytes => {
        if (!available) throw new Error('private');
        return sha256(bytes);
      },
    });
    stores.push(value);
    await value.open();
    await reserve(value);
    await value.claimDispatch('operation-1', 0);
    const observed = await value.recordProducerReceipts('operation-1', 1, []);
    available = false;
    await expect(value.read('operation-1')).rejects.toMatchObject({ code: 'read-failed' });
    available = true;
    expect(await value.read('operation-1')).toEqual(observed);
  });
  it('keeps token registry and generic mutation primitives runtime-private and rejects absent/unsafe CAS revisions', async () => {
    const value = store();
    await value.open();
    await reserve(value);
    expect(Object.keys(value)).toEqual([]);
    for (const name of ['tokens', 'change', 'commit', 'connection', 'run'])
      expect(value).not.toHaveProperty(name);
    for (const revision of [undefined, null, NaN, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])
      await expect(value.claimDispatch('operation-1', revision as number)).rejects.toMatchObject({
        code: 'revision-conflict',
      });
    expect(await value.read('operation-1')).toMatchObject({ phase: 'reserved', revision: 0 });
  });

  it('owns receipt snapshots and hash dependency before async adaptation, ignoring later caller mutation', async () => {
    const digest = vi.fn(sha256);
    const value = store(digest);
    await value.open();
    const { prepared } = await reserve(value);
    await value.claimDispatch('operation-1', 0);
    const input = clone(receipts(prepared));
    const expected = clone(input);
    const entered = deferred<void>();
    const pending = deferred<string>();
    let calls = 0;
    digest.mockImplementation(async (bytes: Uint8Array) => {
      if (++calls === 1) {
        entered.resolve();
        return pending.promise;
      }
      return hash(bytes);
    });
    const running = value.recordProducerReceipts('operation-1', 1, input);
    await entered.promise;
    Object.assign(input[0], { captureId: 'capture-chatgpt-changed' });
    pending.resolve(request().selection.conversationKey.split(':').at(-1)!);
    const result = await running;
    expect(result.observation?.receipts).toEqual(expected);
    expect(result.observation?.adaptation.assessment.kind).toBe('consistent');
  });
  it('opens inert exact separate schema and preserves reservation after close/reopen without tokens', async () => {
    const value = store();
    const opening = vi.spyOn(factory, 'open');
    expect(opening).not.toHaveBeenCalled();
    await expect(value.list()).rejects.toMatchObject({ code: 'not-open' });
    await Promise.all([value.open(), value.open()]);
    expect(opening).toHaveBeenCalledTimes(1);
    const reserved = await reserve(value);
    expect(reserved).not.toHaveProperty('token');
    const db = await openRaw();
    const table = db.transaction(JOURNAL_STORE_NAME).objectStore(JOURNAL_STORE_NAME);
    expect([...db.objectStoreNames]).toEqual(['operations']);
    expect(table.keyPath).toBeNull();
    expect(table.autoIncrement).toBe(false);
    expect(table.indexNames.length).toBe(0);
    value.close();
    const reopened = store();
    await reopened.open();
    expect(await reopened.read('operation-1')).toEqual(reserved.record);
    expect(await reopened.checkCurrent({} as PurposeDispatchToken)).toBe(false);
    const stored = await reopened.read('operation-1');
    expect(stored).not.toBe(reserved.record);
    expect(Object.isFrozen(stored?.operation)).toBe(true);
  });

  it('detaches bytes, requests, prepared inputs and dependency references before awaits', async () => {
    const bytes = encodeSnapshotCatalog(await catalog());
    const original = bytes.slice();
    const chosen = request();
    const pending = deferred<string>();
    let calls = 0;
    const options = {
      sha256: async (input: Uint8Array) => (++calls === 1 ? pending.promise : hash(input)),
      indexedDB: factory,
    };
    const value = createPurposePersistenceStore(options);
    stores.push(value);
    await value.open();
    const deps = { signal: signal() };
    const running = value.reserveChatGpt(bytes, chosen, deps);
    bytes.fill(0);
    Object.assign(chosen, { operationId: 'changed' });
    options.sha256 = vi.fn();
    deps.signal = signal();
    pending.resolve(hash(original));
    const result = await running;
    expect(result.record.operation.operationId).toBe('operation-1');
    expect(result.record.operation.sourceSelection.catalogSha256).toBe(hash(original));
    expect(() => Object.assign(result.prepared.operation, { captureId: 'changed' })).toThrow();
    expect(await value.read('operation-1')).toEqual(result.record);
  });

  it.each(['operationId', 'attemptId', 'captureId'] as const)(
    'atomically reserves unique %s across concurrent handles and retains it after abandon',
    async field => {
      const a = store(),
        b = store();
      await Promise.all([a.open(), b.open()]);
      const bytes = encodeSnapshotCatalog(await catalog());
      const first = request('1'),
        second = { ...request('2'), [field]: first[field] };
      const results = await Promise.allSettled([
        a.reserveChatGpt(bytes, first, { signal: signal() }),
        b.reserveChatGpt(bytes, second, { signal: signal() }),
      ]);
      expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
      const [record] = await a.list();
      await a.abandon(record.operation.operationId, 0);
      await expect(reserve(a, '3', { [field]: record.operation[field] })).rejects.toMatchObject({
        code: 'identity-exists',
      });
      expect(await a.list()).toHaveLength(1);
    }
  );

  it('has one concurrent claim winner; rejects forged, copied, cross-session and stale tokens without redispatch', async () => {
    const a = store(),
      b = store();
    await Promise.all([a.open(), b.open()]);
    await reserve(a);
    const results = await Promise.allSettled([
      a.claimDispatch('operation-1', 0),
      b.claimDispatch('operation-1', 0),
    ]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    const winner = results[0].status === 'fulfilled' ? a : b;
    const loser = winner === a ? b : a;
    const success = results.find(x => x.status === 'fulfilled')!;
    if (success.status !== 'fulfilled') throw new Error();
    const token = success.value.token;
    expect(await winner.checkCurrent(token)).toBe(true);
    expect(await loser.checkCurrent(token)).toBe(false);
    expect(await winner.checkCurrent({ ...token })).toBe(false);
    await expect(winner.claimDispatch('operation-1', 1)).rejects.toMatchObject({
      code: 'transition-failed',
    });
    await reserve(a, '2');
    await a.claimDispatch('operation-2', 0);
    await loser.pause('operation-1', 1);
    expect(await winner.checkCurrent(token)).toBe(false);
    expect(await winner.read('operation-1')).toMatchObject({
      phase: 'unknown',
      control: 'paused',
      interruptionReason: 'pause',
      revision: 2,
    });
  });

  it.each(['consistent', 'insufficient', 'conflict', 'rejected'] as const)(
    'retains %s assessment and factual receipts without settlement',
    async kind => {
      const digest = vi.fn(sha256);
      const value = store(digest);
      await value.open();
      const { prepared } = await reserve(value);
      const { token } = await value.claimDispatch('operation-1', 0);
      const factual = clone(receipts(prepared));
      if (kind === 'insufficient')
        Object.assign(factual[0].completeness, { assets: 'not-attempted' });
      if (kind === 'conflict') Object.assign(factual[0], { captureId: 'capture-chatgpt-other' });
      if (kind === 'rejected') digest.mockRejectedValueOnce(new Error('private'));
      const result = await value.recordProducerReceipts('operation-1', 1, factual);
      expect(result.phase).toBe('awaiting-resolution');
      expect(result.observation).not.toHaveProperty('assessment');
      expect(result.observation?.adaptation.assessment.kind).toBe(kind);
      expect(result.observation?.receipts).toEqual(factual);
      expect(await value.checkCurrent(token)).toBe(false);
      if (kind === 'conflict')
        expect(result.observation?.adaptation).not.toHaveProperty('evidence');
      if (kind === 'rejected')
        expect(result.observation).toMatchObject({
          hashOutcome: 'failed',
          adaptation: { adapterCode: 'hash-failed' },
        });
      factual.length = 0;
      expect((await value.read('operation-1'))?.observation?.receipts).toHaveLength(1);
      await expect(value.recordProducerReceipts('operation-1', 2, [])).rejects.toMatchObject({
        code: 'transition-failed',
      });
      await expect(value.claimDispatch('operation-1', 2)).rejects.toMatchObject({
        code: 'transition-failed',
      });
      const paused = await value.pause('operation-1', 2);
      const abandoned = await value.abandon('operation-1', 3);
      expect(paused.observation).toEqual(result.observation);
      expect(abandoned.observation).toEqual(result.observation);
      expect(abandoned.phase).toBe('awaiting-resolution');
    }
  );

  it('replays available observations on every read and preserves historical hash failure without calling recovered hash', async () => {
    const digest = vi.fn(sha256);
    const value = createPurposePersistenceStore({ indexedDB: factory, sha256: digest });
    stores.push(value);
    await value.open();
    await reserve(value);
    await value.claimDispatch('operation-1', 0);
    digest.mockRejectedValueOnce(new Error('private'));
    await value.recordProducerReceipts('operation-1', 1, []);
    digest.mockClear();
    expect((await value.read('operation-1'))?.observation?.adaptation.adapterCode).toBe(
      'hash-failed'
    );
    expect(digest).not.toHaveBeenCalled();
    await reserve(value, '2');
    await value.claimDispatch('operation-2', 0);
    await value.recordProducerReceipts('operation-2', 1, []);
    digest.mockClear();
    await value.read('operation-2');
    expect(digest).toHaveBeenCalledTimes(2);
  });

  it.each(['pause', 'restart'] as const)(
    'rejects evidence CAS if %s changes revision while its hash is pending',
    async mode => {
      const digest = vi.fn(sha256);
      const value = store(digest);
      await value.open();
      await reserve(value);
      await value.claimDispatch('operation-1', 0);
      const entered = deferred<void>(),
        pending = deferred<string>();
      let count = 0;
      digest.mockImplementation(async bytes => {
        if (++count === 1) {
          entered.resolve();
          return pending.promise;
        }
        return hash(bytes);
      });
      const mutation = value.recordProducerReceipts('operation-1', 1, []);
      const assertion = expect(mutation).rejects.toMatchObject({ code: 'revision-conflict' });
      await entered.promise;
      if (mode === 'pause') await value.pause('operation-1', 1);
      else await value.recoverAfterRestart();
      pending.resolve(request().selection.conversationKey.split(':').at(-1)!);
      await assertion;
      expect(await value.read('operation-1')).toMatchObject({ phase: 'unknown', revision: 2 });
      expect(await value.read('operation-1')).not.toHaveProperty('observation');
    }
  );

  it('recovery fences in-flight, preserves reserved and observations, invalidates tokens and performs no idempotent writes', async () => {
    const value = store();
    await value.open();
    await reserve(value);
    const { token } = await value.claimDispatch('operation-1', 0);
    await reserve(value, '2');
    await reserve(value, '3');
    await value.claimDispatch('operation-3', 0);
    await value.recordProducerReceipts('operation-3', 1, []);
    const recovered = await value.recoverAfterRestart();
    expect(recovered.map(x => x.phase)).toEqual(['unknown', 'reserved', 'awaiting-resolution']);
    expect(await value.checkCurrent(token)).toBe(false);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    expect(await value.recoverAfterRestart()).toEqual(recovered);
    expect(put).not.toHaveBeenCalled();
    expect(await value.recordProducerReceipts('operation-1', 2, [])).toMatchObject({
      phase: 'awaiting-resolution',
      interruptionReason: 'restart',
      revision: 3,
    });
  });

  it('opening does not recover in-flight; restart fencing and abandonment never make identities reusable', async () => {
    const value = store();
    await value.open();
    await reserve(value);
    const { token } = await value.claimDispatch('operation-1', 0);
    value.close();
    const next = store();
    await next.open();
    expect(await next.read('operation-1')).toMatchObject({ phase: 'in-flight', revision: 1 });
    expect(await next.checkCurrent(token)).toBe(false);
    await next.abandon('operation-1', 1);
    expect(await next.read('operation-1')).toMatchObject({
      disposition: 'abandoned',
      phase: 'unknown',
      interruptionReason: 'abandon',
    });
    await expect(reserve(next)).rejects.toMatchObject({ code: 'identity-exists' });
  });

  it('pauses a reservation without dispatch, resume or retry capability', async () => {
    const value = store();
    await value.open();
    await reserve(value);
    expect(await value.pause('operation-1', 0)).toMatchObject({
      phase: 'reserved',
      control: 'paused',
      revision: 1,
    });
    await expect(value.claimDispatch('operation-1', 1)).rejects.toMatchObject({
      code: 'transition-failed',
    });
    expect(value).not.toHaveProperty('resume');
  });

  it('rejects malformed receipts before storage, including getters and unsupported caller assessment', async () => {
    const value = store();
    await value.open();
    await reserve(value);
    await value.claimDispatch('operation-1', 0);
    const getter = vi.fn();
    const bad = Object.defineProperty({}, 'schema', { enumerable: true, get: getter });
    for (const input of [[{}], [bad], { assessment: { kind: 'consistent' } }, Array(3).fill({})])
      await expect(value.recordProducerReceipts('operation-1', 1, input)).rejects.toMatchObject({
        code: 'invalid-receipts',
      });
    expect(getter).not.toHaveBeenCalled();
    expect(await value.read('operation-1')).toMatchObject({ phase: 'in-flight', revision: 1 });
  });

  it.each(['assessment', 'evidence', 'adapterCode', 'version', 'receipt'] as const)(
    'rejects cached %s tampering on read and recovery before any writes',
    async mode => {
      const value = store();
      await value.open();
      const { prepared } = await reserve(value);
      await value.claimDispatch('operation-1', 0);
      const observed = await value.recordProducerReceipts('operation-1', 1, receipts(prepared));
      await reserve(value, '2');
      await value.claimDispatch('operation-2', 0);
      const changed = clone(observed);
      const observation = changed.observation!;
      if (mode === 'assessment')
        Object.assign(observation.adaptation.assessment, { kind: 'insufficient' });
      if (mode === 'evidence')
        Object.assign(observation.adaptation.evidence!, { destinations: [] });
      if (mode === 'adapterCode')
        Object.assign(observation.adaptation, { adapterCode: 'identity-conflict' });
      if (mode === 'version') Object.assign(observation, { adapterVersion: 'unsupported' });
      if (mode === 'receipt')
        Object.assign(observation.receipts[0], { captureId: 'capture-chatgpt-other' });
      await writeRaw(await openRaw(), 'operation-1', new TextEncoder().encode(canonical(changed)));
      const put = vi.spyOn(IDBObjectStore.prototype, 'put');
      await expect(value.read('operation-1')).rejects.toMatchObject({ code: 'corrupt-record' });
      await expect(value.recoverAfterRestart()).rejects.toMatchObject({ code: 'corrupt-record' });
      expect(put).not.toHaveBeenCalled();
    }
  );

  it('rejects noncanonical/duplicate/unsafe keys, mismatched storage key, invalid UTF8 and record limits', async () => {
    const value = store();
    await value.open();
    const { record } = await reserve(value);
    const bytes = encodeRecord(record);
    const text = new TextDecoder().decode(bytes);
    for (const [key, data] of [
      ['other', bytes],
      ['operation-1', new TextEncoder().encode(' ' + text)],
      ['operation-1', new TextEncoder().encode(text.replace('{', '{"schema":"duplicate",'))],
      ['operation-1', new TextEncoder().encode(text.replace('{', '{"__proto__":{},'))],
      ['operation-1', new Uint8Array([255])],
      ['operation-1', new Uint8Array(MAX_RECORD_BYTES + 1)],
    ] as const)
      expect(() => decodeRecord(data, key)).toThrow('corrupt-record');
    for (let i = 2; i <= 16; i++) await reserve(value, String(i));
    await expect(reserve(value, '17')).rejects.toMatchObject({ code: 'record-limit' });
    expect(await value.list()).toHaveLength(16);
  });

  it('keeps the exact unchanged v1 database independently usable with no cross records', async () => {
    const legacy = createJournalStore({ indexedDB: factory });
    await legacy.open();
    const old = createJournal({
      runId: 'legacy-run',
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
    await legacy.create(old);
    const value = store();
    await value.open();
    await reserve(value);
    expect(await legacy.read('legacy-run')).toEqual(old);
    expect(await legacy.read('operation-1')).toBeUndefined();
    expect(await value.read('legacy-run')).toBeUndefined();
    legacy.close();
    expect(() =>
      createPurposePersistenceStore({
        indexedDB: factory,
        sha256,
        databaseName: 'liska-resumability-journal',
      })
    ).toThrow('invalid-schema');
  });
});
