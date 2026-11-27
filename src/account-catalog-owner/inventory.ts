import {
  decodeOwner,
  decodeOwnerKey,
  decodeSlot,
  isSlotId,
  MAX_OWNERS,
  MAX_SLOTS,
  ownerKey,
  type AccountCatalogOwnerLocator,
} from './codec';
import { AccountCatalogError } from './errors';
import type { CatalogTransaction } from './transaction';

interface Inventory {
  readonly slots: readonly string[];
  readonly owners: readonly AccountCatalogOwnerLocator[];
}

function scan<Output, Entry>(
  context: CatalogTransaction<Output>,
  store: IDBObjectStore,
  limit: number,
  parse: (key: IDBValidKey) => Entry,
  use: (entries: readonly Entry[]) => void
): void {
  const entries: Entry[] = [];
  context.request(store.openKeyCursor(), cursor => {
    if (!cursor) return use(entries);
    if (entries.length === limit) throw new AccountCatalogError('corrupt');
    entries.push(parse(cursor.primaryKey));
    cursor.continue();
  });
}

/** Check the whole bounded key inventory before any value read; no unbounded getAll(). */
export function inventory<Output>(
  context: CatalogTransaction<Output>,
  use: (entries: Inventory) => void
): void {
  scan(
    context,
    context.slots,
    MAX_SLOTS,
    key => {
      if (!isSlotId(key)) throw new AccountCatalogError('corrupt');
      return key;
    },
    slots =>
      scan(
        context,
        context.owners,
        MAX_OWNERS,
        key => {
          const owner = decodeOwnerKey(key);
          if (!slots.includes(owner.slotId)) throw new AccountCatalogError('corrupt');
          return owner;
        },
        owners => use({ slots, owners })
      )
  );
}

export function findOwner(entries: Inventory, wanted: AccountCatalogOwnerLocator) {
  return entries.owners.find(
    key =>
      key.provider === wanted.provider &&
      key.slotId === wanted.slotId &&
      key.scopeKey === wanted.scopeKey
  );
}

export function loadSlot<Output>(
  context: CatalogTransaction<Output>,
  slotId: string,
  use: (entry: ReturnType<typeof decodeSlot>) => void
): void {
  context.request(context.slots.get(slotId), input => use(decodeSlot(input, slotId)));
}

export function loadOwner<Output>(
  context: CatalogTransaction<Output>,
  owner: AccountCatalogOwnerLocator,
  use: (entry: ReturnType<typeof decodeOwner>) => void
): void {
  context.request(context.owners.get(ownerKey(owner)), input => use(decodeOwner(input, owner)));
}

export function loadList<Key, Entry>(
  keys: readonly Key[],
  load: (key: Key, use: (entry: Entry) => void) => void,
  use: (entries: readonly Entry[]) => void
): void {
  const entries: Entry[] = [];
  const next = () => {
    if (entries.length === keys.length) return use(Object.freeze(entries));
    load(keys[entries.length], entry => {
      entries.push(entry);
      next();
    });
  };
  next();
}
