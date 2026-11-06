// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { IDBObjectStore } from 'fake-indexeddb';
import {
  createPurposePersistenceStore,
  PurposePersistenceError,
  type PurposePersistenceStore,
} from '../../../src/resumability-journal/purpose-persistence-v2/idb';
import { decodeRecord } from '../../../src/resumability-journal/purpose-persistence-v2/core/record';
import { sha256 } from '../purpose-persistence-v2/fixtures';
import { deferred } from '../../snapshot-catalog/fixtures';
import { setup, sink, assetResponse, ManualTimers } from './fixtures';

const stores: PurposePersistenceStore[] = [];
async function fixture(...args: Parameters<typeof setup>) {
  const ctx = await setup(...args);
  stores.push(ctx.store);
  return ctx;
}
afterEach(() => {
  vi.restoreAllMocks();
  stores.splice(0).forEach(store => store.close());
});

it.each(['pause', 'recover', 'abandon'] as const)(
  'retains late capture/producer facts after external %s, without overwriting existing control',
  async action => {
    const ctx = await fixture();
    const result = await ctx
      .execute({
        requestCapture: async () => {
          if (action === 'recover') await ctx.store.recoverAfterRestart();
          else await ctx.store[action]('operation-1', 1);
          return assetResponse();
        },
      })
      .run();
    expect(result.capture).toBeDefined();
    expect(result.producer?.producerRaw).toBeDefined();
    expect(result.evidence.state).toBe(action === 'abandon' ? 'failed' : 'committed');
    const retained = await ctx.store.read('operation-1');
    expect(retained?.interruptionReason).toBe(action === 'recover' ? 'restart' : action);
    if (action === 'abandon') {
      expect(retained?.disposition).toBe('abandoned');
      expect(retained?.observation).toBeUndefined();
    }
  }
);

it('pause before token consumption denies request and preserves the pause reason', async () => {
  const ctx = await fixture();
  const consume = ctx.store.consumeDispatch.bind(ctx.store);
  vi.spyOn(ctx.store, 'consumeDispatch').mockImplementationOnce(async (...args) => {
    await ctx.store.pause('operation-1', 1);
    return consume(...args);
  });
  const result = await ctx.execute().run();
  expect(result.request).toBe('not-invoked');
  expect(ctx.requestCapture).not.toHaveBeenCalled();
  expect(result.code).toBe('dispatch-denied');
  expect(result.uncertainty.state).toBe('failed');
  expect((await ctx.store.read('operation-1'))?.interruptionReason).toBe('pause');
});

it.each(['pause', 'recover', 'abandon', 'observe'] as const)(
  'does one evidence CAS when %s races adapter hashing and retains receipts after conflict',
  async action => {
    const entered = deferred<void>(),
      release = deferred<void>();
    let gate = false;
    const ctx = await fixture(['file'], {
      sha256: async bytes => {
        if (gate) {
          gate = false;
          entered.resolve();
          await release.promise;
        }
        return sha256(bytes);
      },
    });
    const peer = createPurposePersistenceStore({ indexedDB: ctx.factory, sha256 });
    stores.push(peer);
    await peer.open();
    const record = ctx.store.recordProducerReceipts.bind(ctx.store);
    const writes = vi
      .spyOn(ctx.store, 'recordProducerReceipts')
      .mockImplementationOnce((...args) => {
        gate = true;
        return record(...args);
      });
    const running = ctx.execute().run();
    await entered.promise;
    if (action === 'recover') await peer.recoverAfterRestart();
    else if (action === 'observe') await peer.recordProducerReceipts('operation-1', 1, []);
    else await peer[action]('operation-1', 1);
    release.resolve();
    const result = await running;
    expect(result.evidence).toMatchObject({ state: 'failed', code: 'revision-conflict' });
    expect(result.producer?.producerReceipts).toHaveLength(1);
    expect(writes).toHaveBeenCalledOnce();
    expect(ctx.requestCapture).toHaveBeenCalledOnce();
    const retained = await peer.read('operation-1');
    expect(retained?.revision).toBe(2);
    expect(retained?.phase).toBe(action === 'observe' ? 'awaiting-resolution' : 'unknown');
    if (action === 'observe') expect(retained?.observation?.receipts).toEqual([]);
    else expect(retained?.interruptionReason).toBe(action === 'recover' ? 'restart' : action);
  }
);

it.each(['quota', 'close'] as const)(
  'retains receipts and capture when evidence %s fails',
  async mode => {
    const ctx = await fixture();
    const record = ctx.store.recordProducerReceipts.bind(ctx.store);
    vi.spyOn(ctx.store, 'recordProducerReceipts').mockImplementationOnce((...args) => {
      if (mode === 'close') ctx.store.close();
      else {
        const put = IDBObjectStore.prototype.put;
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (bytes, key) {
          if (decodeRecord(bytes, key).observation)
            throw new DOMException('private quota', 'QuotaExceededError');
          return put.call(this, bytes, key);
        });
      }
      return record(...args);
    });
    const result = await ctx.execute().run();
    expect(result.evidence).toMatchObject({
      state: 'failed',
      code: mode === 'quota' ? 'quota-exceeded' : 'closed',
    });
    expect(result.capture).toBeDefined();
    expect(result.producer?.producerReceipts).toHaveLength(1);
    if (mode === 'quota')
      expect(result.uncertainty.record?.interruptionReason).toBe('evidence-persistence-failed');
    else expect(result.uncertainty.state).toBe('failed');
    expect(JSON.stringify(result)).not.toContain('private quota');
  }
);

it('returns real committed-but-unobserved evidence as outcome-unknown, without compensation or redispatch', async () => {
  const timers = new ManualTimers();
  const ctx = await fixture(['file'], { timers });
  const peer = createPurposePersistenceStore({ indexedDB: ctx.factory, sha256 });
  stores.push(peer);
  await peer.open();
  const committed = deferred<void>();
  const put = IDBObjectStore.prototype.put;
  const writes = vi
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementation(function (bytes, key) {
      const request = put.call(this, bytes, key);
      if (decodeRecord(bytes, key).observation) {
        this.transaction.oncomplete = null;
        this.transaction.addEventListener('complete', () => committed.resolve());
        this.transaction.commit();
        timers.fire();
      }
      return request;
    });
  const marker = vi.spyOn(ctx.store, 'markExecutionUnknown');
  const record = vi.spyOn(ctx.store, 'recordProducerReceipts');
  const handle = ctx.execute();
  const running = handle.run();
  await committed.promise;
  expect((await peer.read('operation-1'))?.observation).toBeDefined();
  timers.fire();
  const result = await running;
  expect(result.evidence).toEqual({
    state: 'outcome-unknown',
    code: 'transaction-outcome-unknown',
  });
  expect(result.capture).toBeDefined();
  expect(result.producer?.producerReceipts).toHaveLength(1);
  expect(marker).not.toHaveBeenCalled();
  expect(record).toHaveBeenCalledOnce();
  expect(writes).toHaveBeenCalledTimes(2);
  expect(handle.run()).toBe(running);
  expect(ctx.requestCapture).toHaveBeenCalledOnce();
  expect(timers.pending.size).toBe(0);
});

it.each(['consume', 'marker'] as const)(
  'never performs another write after %s outcome-unknown',
  async boundary => {
    const ctx = await fixture();
    const unknown = new PurposePersistenceError('transaction-outcome-unknown');
    if (boundary === 'consume')
      vi.spyOn(ctx.store, 'consumeDispatch').mockRejectedValueOnce(unknown);
    else vi.spyOn(ctx.store, 'markExecutionUnknown').mockRejectedValueOnce(unknown);
    const marker = vi.spyOn(ctx.store, 'markExecutionUnknown');
    const record = vi.spyOn(ctx.store, 'recordProducerReceipts');
    const result = await ctx
      .execute(
        boundary === 'marker'
          ? {
              persistArtifacts: async (...args) => {
                const value = await sink(...args);
                ctx.abort.abort();
                return value;
              },
            }
          : {}
      )
      .run();
    expect(record).not.toHaveBeenCalled();
    if (boundary === 'consume') {
      expect(marker).not.toHaveBeenCalled();
      expect(ctx.requestCapture).not.toHaveBeenCalled();
      expect(result.consumption.state).toBe('outcome-unknown');
    } else {
      expect(marker).toHaveBeenCalledOnce();
      expect(result.producer?.producerRaw).toBeDefined();
      expect(result.uncertainty.state).toBe('outcome-unknown');
    }
  }
);

it('keeps the store adapter authoritative when its identity hash fails', async () => {
  let fail = false;
  const ctx = await fixture(['file'], {
    sha256: async bytes => {
      if (fail) throw new Error('private hash');
      return sha256(bytes);
    },
  });
  const record = ctx.store.recordProducerReceipts.bind(ctx.store);
  vi.spyOn(ctx.store, 'recordProducerReceipts').mockImplementationOnce((...args) => {
    fail = true;
    return record(...args);
  });
  const result = await ctx.execute().run();
  expect(result.evidence.state).toBe('committed');
  expect(result.evidence.record?.observation).toMatchObject({
    hashOutcome: 'failed',
    adaptation: { adapterCode: 'hash-failed', assessment: { kind: 'rejected' } },
  });
  expect(result.producer?.producerReceipts).toHaveLength(1);
});
