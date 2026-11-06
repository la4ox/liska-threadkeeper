// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBDatabase } from 'fake-indexeddb';
import {
  createPurposePersistenceStore,
  type PurposePersistenceStore,
  type PurposeDispatchToken,
} from '../../../src/resumability-journal/purpose-persistence-v2/idb';
import {
  EXECUTION_INTERRUPTION_REASONS,
  snapshotRecord,
} from '../../../src/resumability-journal/purpose-persistence-v2/core/record';
import { reserve, receipts, sha256 } from './fixtures';

const stores: PurposePersistenceStore[] = [];
async function opened(factory = new IDBFactory()) {
  const store = createPurposePersistenceStore({ indexedDB: factory, sha256 });
  stores.push(store);
  await store.open();
  return store;
}
afterEach(() => {
  vi.restoreAllMocks();
  stores.splice(0).forEach(store => store.close());
});

it('burns synchronously, admits exactly one parallel consume, and serializes the final check without writing', async () => {
  const store = await opened();
  const { prepared } = await reserve(store);
  const { token, record } = await store.claimDispatch('operation-1', 0);
  const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
  const begin = vi.fn(() => 'started');
  const first = store.consumeDispatch(token, prepared.operation, begin);
  await expect(store.consumeDispatch(token, prepared.operation, begin)).rejects.toMatchObject({
    code: 'transition-failed',
  });
  await expect(first).resolves.toBe('started');
  expect(begin).toHaveBeenCalledOnce();
  expect(transactions.mock.calls.map(call => call[1])).toEqual(['readonly', 'readwrite']);
  expect(await store.checkCurrent(token)).toBe(false);
  expect(await store.read('operation-1')).toEqual(record);
});

it('rejects forged, copied and cross-store tokens without consuming the owner token', async () => {
  const factory = new IDBFactory();
  const store = await opened(factory),
    other = await opened(factory);
  const { prepared } = await reserve(store);
  const { token } = await store.claimDispatch('operation-1', 0);
  for (const fake of [{}, { ...token }, Object.create(token), JSON.parse(JSON.stringify(token))])
    await expect(
      store.consumeDispatch(fake as PurposeDispatchToken, prepared.operation, () => {})
    ).rejects.toMatchObject({ code: 'transition-failed' });
  await expect(other.consumeDispatch(token, prepared.operation, () => {})).rejects.toMatchObject({
    code: 'transition-failed',
  });
  await expect(store.consumeDispatch(token, prepared.operation, () => {})).resolves.toBeUndefined();
});

it('burns a mismatched operation token permanently', async () => {
  const store = await opened();
  const first = await reserve(store),
    second = await reserve(store, '2');
  const { token } = await store.claimDispatch('operation-1', 0);
  await expect(
    store.consumeDispatch(token, second.prepared.operation, () => {})
  ).rejects.toMatchObject({
    code: 'transition-failed',
  });
  await expect(
    store.consumeDispatch(token, first.prepared.operation, () => {})
  ).rejects.toMatchObject({
    code: 'transition-failed',
  });
});

it.each(['throw', 'reject'] as const)(
  'effect %s burns the token without changing durable state',
  async failure => {
    const store = await opened();
    const { prepared } = await reserve(store);
    const { token, record } = await store.claimDispatch('operation-1', 0);
    const begin = vi.fn(() => {
      if (failure === 'throw') throw new Error('effect-failed');
      return Promise.reject(new Error('effect-failed'));
    });
    await expect(store.consumeDispatch(token, prepared.operation, begin)).rejects.toThrow(
      'effect-failed'
    );
    await expect(store.consumeDispatch(token, prepared.operation, begin)).rejects.toMatchObject({
      code: 'transition-failed',
    });
    expect(begin).toHaveBeenCalledOnce();
    expect(await store.read('operation-1')).toEqual(record);
  }
);

it('burns before rejecting a missing or malformed effect callback', async () => {
  const store = await opened();
  const { prepared } = await reserve(store);
  const { token } = await store.claimDispatch('operation-1', 0);
  await expect(
    store.consumeDispatch(token, prepared.operation, undefined as never)
  ).rejects.toMatchObject({ code: 'transition-failed' });
  const begin = vi.fn();
  await expect(store.consumeDispatch(token, prepared.operation, begin)).rejects.toMatchObject({
    code: 'transition-failed',
  });
  expect(begin).not.toHaveBeenCalled();
});

it.each(['pause', 'abandon', 'recover', 'close'] as const)(
  'fences %s during pending consume and never restores the token',
  async action => {
    const store = await opened();
    const { prepared } = await reserve(store);
    const { token } = await store.claimDispatch('operation-1', 0);
    const begin = vi.fn();
    const running = store.consumeDispatch(token, prepared.operation, begin);
    const assertion = expect(running).rejects.toThrow();
    if (action === 'close') store.close();
    else if (action === 'recover') await store.recoverAfterRestart();
    else await store[action]('operation-1', 1);
    await assertion;
    await expect(store.consumeDispatch(token, prepared.operation, begin)).rejects.toThrow();
    expect(begin).not.toHaveBeenCalled();
  }
);

it.each(EXECUTION_INTERRUPTION_REASONS)(
  'persists exact %s uncertainty, increments once and preserves it through evidence',
  async reason => {
    const store = await opened();
    const { prepared } = await reserve(store);
    await expect(store.markExecutionUnknown('operation-1', 0, reason)).rejects.toMatchObject({
      code: 'transition-failed',
    });
    const { token } = await store.claimDispatch('operation-1', 0);
    const record = await store.markExecutionUnknown('operation-1', 1, reason);
    expect(record).toMatchObject({ phase: 'unknown', revision: 2, interruptionReason: reason });
    expect(snapshotRecord(record)).toEqual(record);
    await expect(store.consumeDispatch(token, prepared.operation, () => {})).rejects.toThrow();
    await expect(store.markExecutionUnknown('operation-1', 2, reason)).rejects.toMatchObject({
      code: 'transition-failed',
    });
    const observed = await store.recordProducerReceipts('operation-1', 2, receipts(prepared));
    expect(observed.interruptionReason).toBe(reason);
    await expect(store.markExecutionUnknown('operation-1', 3, reason)).rejects.toMatchObject({
      code: 'transition-failed',
    });
    await store.abandon('operation-1', 3);
    await expect(store.markExecutionUnknown('operation-1', 4, reason)).rejects.toMatchObject({
      code: 'transition-failed',
    });
    expect(() => snapshotRecord({ ...record, interruptionReason: 'private-error' })).toThrow(
      'corrupt-record'
    );
  }
);
