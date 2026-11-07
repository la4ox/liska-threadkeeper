// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import {
  createExecutionStorePort,
  snapshotExecutionStore,
  ExecutionStoreError,
  executionStoreFailure,
  type ExecutionStorePort,
} from '../../../src/resumability-journal/execution-coordinator/store-port';
import { createChatGptExecution } from '../../../src/resumability-journal/execution-coordinator';
import { OwnerStorageError } from '../../../src/resumability-journal/baseline-owner';
import { ownerResult } from '../../../src/resumability-journal/baseline-owner/execution';
import { setup } from './fixtures';
afterEach(() => vi.restoreAllMocks());
it('admits only branded frozen ports and never invokes arbitrary accessors', async () => {
  const ctx = await setup();
  const port = snapshotExecutionStore(ctx.store);
  expect(Object.isFrozen(port)).toBe(true);
  expect(Object.keys(port).sort()).toEqual(
    [
      'read',
      'claimDispatch',
      'consumeDispatch',
      'markExecutionUnknown',
      'recordProducerReceipts',
    ].sort()
  );
  const getter = vi.fn(() => port.read);
  for (const candidate of [
    { ...port },
    Object.freeze({ ...port }),
    {
      ...port,
      get read() {
        return getter();
      },
    },
    Object.create(port),
  ]) {
    expect(() =>
      createChatGptExecution({ ...ctx.input, store: candidate }, ctx.dependencies)
    ).toThrow();
  }
  expect(getter).not.toHaveBeenCalled();
  expect(snapshotExecutionStore(port)).toBe(port);
  ctx.store.close();
});
it('captures native and factory method refs synchronously, rejecting method accessors without reading them', async () => {
  const ctx = await setup();
  const port = snapshotExecutionStore(ctx.store);
  const changed = vi.spyOn(ctx.store, 'read').mockRejectedValue(new Error('must not call'));
  expect(await port.read('operation-1')).toBeDefined();
  expect(changed).not.toHaveBeenCalled();
  changed.mockRestore();
  const getter = vi.fn(() => vi.fn());
  Object.defineProperty(ctx.store, 'read', { configurable: true, get: getter });
  expect(() => snapshotExecutionStore(ctx.store)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  const mutable = { ...port };
  const captured = createExecutionStorePort(mutable);
  mutable.read = vi.fn(async () => undefined);
  expect(await captured.read('operation-1')).toBeDefined();
  expect(() => createExecutionStorePort({ ...port, extra: true } as ExecutionStorePort)).toThrow();
  expect(() =>
    createExecutionStorePort({
      ...port,
      get read() {
        return getter();
      },
    })
  ).toThrow();
  expect(getter).not.toHaveBeenCalled();
  ctx.store.close();
});
it.each(['open-outcome-unknown', 'transaction-outcome-unknown'] as const)(
  'preserves %s as uncertainty without arbitrary exception text',
  async code => {
    let error: unknown;
    try {
      await ownerResult(async () => {
        throw new OwnerStorageError(code);
      });
    } catch (caught) {
      error = caught;
    }
    expect(executionStoreFailure(error)).toEqual({ state: 'outcome-unknown', code });
    expect(executionStoreFailure({ code, message: 'private' })).toEqual({
      state: 'failed',
      code: 'write-failed',
    });
    expect(executionStoreFailure(new ExecutionStoreError('PRIVATE' as never))).toEqual({
      state: 'failed',
      code: 'write-failed',
    });
  }
);
