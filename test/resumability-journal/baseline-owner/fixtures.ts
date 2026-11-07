import { IDBFactory } from 'fake-indexeddb';
import {
  createBaselineOwner,
  type BaselineOwnerOptions,
  type OwnerTimers,
} from '../../../src/resumability-journal/baseline-owner';
import { fixture, requirements, sha256 } from '../baseline-plan/fixtures';
export { fixture, requirements, sha256 };
export const signal = () => new AbortController().signal;
export const ids = (suffix = '1') => ({
  operationId: 'operation-' + suffix,
  attemptId: 'attempt-' + suffix,
  captureId: 'capture-chatgpt-' + suffix,
});
export async function setup(options: Partial<BaselineOwnerOptions> = {}) {
  const factory = options.indexedDB ?? new IDBFactory();
  const settings = { indexedDB: factory, sha256, ...options };
  const owner = createBaselineOwner(settings);
  await owner.open();
  const data = await fixture();
  const snapshot = await owner.create(
    data.bytes,
    { ...requirements, selection: data.selection },
    { now: 100, windowId: 'a', maxReservationSlots: 16 },
    signal()
  );
  return { owner, data, snapshot, factory, settings };
}
export async function active(options: Partial<BaselineOwnerOptions> = {}) {
  const result = await setup(options);
  await result.owner.applyControl(0, { kind: 'activate', now: 101 });
  return result;
}
export class ManualTimers implements OwnerTimers {
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
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
