import { IDBFactory } from 'fake-indexeddb';
import {
  createProviderBaselineOwner,
  type ProviderBaselineOwnerOptions,
  type ProviderOwnerTimers,
} from '../../../src/resumability-journal/provider-baseline-owner';
import { catalogBytes, identity, requirements, sha256 } from '../provider-baseline/fixtures';

export { catalogBytes, identity, requirements, sha256 };
export const signal = () => new AbortController().signal;
export const ids = (suffix = '1') => ({
  operationId: 'operation-' + suffix,
  attemptId: 'attempt-' + suffix,
  captureId: 'capture-' + suffix,
});

export async function setup(
  options: Partial<ProviderBaselineOwnerOptions> = {},
  selection = [identity(0, 'chatgpt'), identity(1, 'claude')]
) {
  const factory = options.indexedDB ?? new IDBFactory();
  const settings = { indexedDB: factory, sha256, ...options };
  const owner = createProviderBaselineOwner(settings);
  await owner.open();
  const bytes = await catalogBytes(selection);
  const snapshot = await owner.create(
    bytes,
    { ...requirements, selection },
    { now: 100, windowId: 'window-a', maxReservationSlots: 16 },
    signal()
  );
  return { owner, bytes, selection, snapshot, factory, settings };
}

export async function active(
  options: Partial<ProviderBaselineOwnerOptions> = {},
  selection = [identity(0, 'chatgpt'), identity(1, 'claude')]
) {
  const result = await setup(options, selection);
  await result.owner.applyControl(0, { kind: 'activate', now: 101 });
  return result;
}

export class ManualTimers implements ProviderOwnerTimers {
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
