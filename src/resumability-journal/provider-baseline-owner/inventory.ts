import { PROVIDER_OWNER_KEY } from './database';
import { MAX_PROVIDER_OWNER_BYTES, sameBytes, type Entry, type Inventory } from './envelope';
import { requireOwner } from './errors';
import type { ProviderOwnerTransaction } from './transaction';

/** Both complete bounded inventories are read in the same transaction, including unknown keys. */
export function scan<Output>(
  context: ProviderOwnerTransaction<Output>,
  done: (inventory: Inventory) => void
): void {
  const owner: Entry[] = [];
  const operations: Entry[] = [];
  const scanStore = (
    store: IDBObjectStore,
    entries: Entry[],
    maxRecords: number,
    maxBytes: number,
    next: () => void
  ) => {
    context.request(store.openCursor(), cursor => {
      if (!cursor) return next();
      requireOwner(entries.length < maxRecords && typeof cursor.key === 'string', 'corrupt-owner');
      requireOwner(
        cursor.value instanceof Uint8Array &&
          cursor.value.length > 0 &&
          cursor.value.length <= maxBytes,
        'corrupt-owner'
      );
      if (store === context.owner) requireOwner(cursor.key === PROVIDER_OWNER_KEY, 'corrupt-owner');
      entries.push({ key: cursor.key, bytes: new Uint8Array(cursor.value as Uint8Array) });
      cursor.continue();
    });
  };
  scanStore(context.owner, owner, 1, MAX_PROVIDER_OWNER_BYTES, () =>
    scanStore(context.operations, operations, 16, 64 * 1024, () => done({ owner, operations }))
  );
}

export function assertUnchanged(before: Inventory, actual: Inventory): void {
  for (const store of ['owner', 'operations'] as const)
    requireOwner(
      before[store].length === actual[store].length &&
        before[store].every(
          (entry, index) =>
            entry.key === actual[store][index].key &&
            sameBytes(entry.bytes, actual[store][index].bytes)
        ),
      'revision-conflict'
    );
}
