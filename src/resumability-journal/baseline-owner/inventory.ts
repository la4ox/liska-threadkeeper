import { MAX_OWNER_BYTES, sameBytes, type Entry, type Inventory } from './envelope';
import { OWNER_KEY } from './database';
import { requireOwner } from './errors';
import type { OwnerTransaction } from './transaction';

/** Both bounded inventories are read in the SAME transaction, including unknown keys. */
export function scan<Output>(
  context: OwnerTransaction<Output>,
  done: (inventory: Inventory) => void
): void {
  const owner: Entry[] = [],
    operations: Entry[] = [];
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
      if (store === context.owner) requireOwner(cursor.key === OWNER_KEY, 'corrupt-owner');
      entries.push({ key: cursor.key, bytes: new Uint8Array(cursor.value as Uint8Array) });
      cursor.continue();
    });
  };
  scanStore(context.owner, owner, 1, MAX_OWNER_BYTES, () =>
    scanStore(context.operations, operations, 16, 8 * 1024 * 1024, () =>
      done({ owner, operations })
    )
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
