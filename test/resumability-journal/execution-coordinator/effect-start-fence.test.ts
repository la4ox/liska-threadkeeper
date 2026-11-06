// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { IDBObjectStore } from 'fake-indexeddb';
import type { PurposePersistenceStore } from '../../../src/resumability-journal/purpose-persistence-v2/idb';
import { setup, assetResponse } from './fixtures';

const stores: PurposePersistenceStore[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  stores.splice(0).forEach(store => store.close());
});

it.each(['close', 'pause', 'recover', 'abandon'] as const)(
  'same-handle %s queued before the final store fence wins with zero request',
  async action => {
    await race(action, 'before');
  }
);
it.each(['close', 'pause', 'recover', 'abandon'] as const)(
  'effect begins before same-handle %s queued behind the final fence, with no microtask gap',
  async action => {
    await race(action, 'after');
  }
);

async function race(action: 'close' | 'pause' | 'recover' | 'abandon', order: 'before' | 'after') {
  const ctx = await setup();
  stores.push(ctx.store);
  const events: string[] = [];
  let armed = false;
  let completed = false;
  let invalidation: Promise<unknown> | undefined;
  const invalidate = () => {
    events.push('invalidate');
    if (action === 'close') ctx.store.close();
    else {
      invalidation =
        action === 'recover'
          ? ctx.store.recoverAfterRestart()
          : ctx.store[action]('operation-1', 1);
      // A later coordinator uncertainty write may win CAS; invocation already fenced the session.
      invalidation = invalidation.catch(() => {});
    }
  };
  const completion = () => {
    completed = true;
    events.push('complete');
    queueMicrotask(invalidate);
  };
  const consume = ctx.store.consumeDispatch.bind(ctx.store);
  vi.spyOn(ctx.store, 'consumeDispatch').mockImplementation((...args) => {
    armed = true;
    return consume(...args);
  });
  const cursor = IDBObjectStore.prototype.openCursor;
  vi.spyOn(IDBObjectStore.prototype, 'openCursor').mockImplementation(function (...args) {
    if (armed && this.transaction.mode === 'readwrite') {
      armed = false;
      const tx = this.transaction;
      const originalComplete = tx.oncomplete!;
      tx.oncomplete = event => {
        if (order === 'before') completion();
        originalComplete.call(tx, event);
        // Queue precisely after the store's commit promise resolves. The OLD coordinator
        // continuation would follow this invalidation; the new effect start cannot.
        if (order === 'after') completion();
      };
    }
    return cursor.apply(this, args);
  });
  const requestCapture = vi.fn(() => {
    expect(completed).toBe(true); // Callback is outside the completed IDB transaction.
    expect(events).not.toContain('invalidate');
    events.push('request');
    return Promise.resolve(assetResponse());
  });
  const outcome = await ctx.execute({ requestCapture }).run();
  await invalidation;
  expect(events).toEqual(
    order === 'before' ? ['complete', 'invalidate'] : ['complete', 'request', 'invalidate']
  );
  expect(requestCapture).toHaveBeenCalledTimes(order === 'before' ? 0 : 1);
  expect(outcome.request).toBe(order === 'before' ? 'not-invoked' : 'invoked');
  if (order === 'before') expect(outcome.code).toBe('dispatch-denied');
  else expect(outcome.capture).toBeDefined();
}
