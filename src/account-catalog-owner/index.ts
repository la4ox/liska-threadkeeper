import {
  demandLocator,
  demandSlotId,
  MAX_OWNERS,
  MAX_SLOTS,
  ownerKey,
  prepareClaude,
  sameBytes,
  type AccountCatalogOwner,
  type AccountCatalogOwnerLocator,
  type AccountCatalogSlot,
  type CreatePausedClaudeInput,
} from './codec';
import { openCatalogDatabase, type AccountCatalogOptions } from './database';
import { AccountCatalogError } from './errors';
import { findOwner, inventory, loadList, loadOwner, loadSlot } from './inventory';
import { CatalogConnection, type CatalogTransaction } from './transaction';

export type {
  AccountCatalogOwner,
  AccountCatalogOwnerLocator,
  AccountCatalogOwnerRef,
  AccountCatalogSlot,
  CreatePausedClaudeInput,
} from './codec';
export type { AccountCatalogOptions } from './database';
export { AccountCatalogError, type AccountCatalogErrorCode } from './errors';

export interface CreatePausedClaudeResult {
  readonly kind: 'created' | 'already-created';
  readonly slot: AccountCatalogSlot;
  readonly owner: AccountCatalogOwner;
}

export interface AccountCatalog {
  createPausedClaude(
    input: CreatePausedClaudeInput,
    signal?: AbortSignal
  ): Promise<CreatePausedClaudeResult>;
  /** Atomic first-owner path; an occupied slot can only reconcile identical bytes. */
  createPausedClaudeSingleScope(
    input: CreatePausedClaudeInput,
    signal?: AbortSignal
  ): Promise<CreatePausedClaudeResult>;
  readSlot(slotId: string): Promise<AccountCatalogSlot | null>;
  readOwner(key: AccountCatalogOwnerLocator): Promise<AccountCatalogOwner | null>;
  listSlots(): Promise<readonly AccountCatalogSlot[]>;
  listOwners(slotId?: string): Promise<readonly AccountCatalogOwner[]>;
  close(): Promise<void>;
}

type Prepared = ReturnType<typeof prepareClaude>;

function insert(
  context: CatalogTransaction<CreatePausedClaudeResult>,
  prepared: Prepared,
  createSlot: boolean
): void {
  const { slot, owner } = prepared;
  // Queue both add requests without yielding. No put: an occupied key cannot be overwritten.
  if (createSlot) context.request(context.slots.add(slot.bytes, slot.value.slotId), () => {});
  context.request(context.owners.add(owner.bytes, ownerKey(owner.value)), () =>
    context.finish(Object.freeze({ kind: 'created', slot: slot.value, owner: owner.value }))
  );
}

async function createPausedClaude(
  connection: CatalogConnection,
  input: CreatePausedClaudeInput,
  signal?: AbortSignal,
  singleScope = false
): Promise<CreatePausedClaudeResult> {
  const prepared = prepareClaude(input);
  const slotId = prepared.slot.value.slotId;
  return connection.run(
    'readwrite',
    context =>
      inventory(context, entries => {
        const slotExists = entries.slots.includes(slotId);
        const existing = findOwner(entries, prepared.owner.value);
        const insertMissing = () => {
          if (
            entries.owners.length === MAX_OWNERS ||
            (!slotExists && entries.slots.length === MAX_SLOTS)
          )
            throw new AccountCatalogError('capacity');
          insert(context, prepared, !slotExists);
        };
        if (!slotExists) return insertMissing();
        loadSlot(context, slotId, slot => {
          if (!sameBytes(slot.bytes, prepared.slot.bytes))
            throw new AccountCatalogError('conflict');
          if (!existing) {
            if (singleScope) throw new AccountCatalogError('conflict');
            return insertMissing();
          }
          loadOwner(context, existing, owner => {
            if (!sameBytes(owner.bytes, prepared.owner.bytes))
              throw new AccountCatalogError('conflict');
            context.finish(
              Object.freeze({ kind: 'already-created', slot: slot.value, owner: owner.value })
            );
          });
        });
      }),
    signal
  );
}

async function readSlot(connection: CatalogConnection, input: string) {
  const slotId = demandSlotId(input);
  return connection.run<AccountCatalogSlot | null>('readonly', context =>
    inventory(context, entries => {
      if (!entries.slots.includes(slotId)) return context.finish(null);
      loadSlot(context, slotId, entry => context.finish(entry.value));
    })
  );
}

async function readOwner(connection: CatalogConnection, input: AccountCatalogOwnerLocator) {
  const key = demandLocator(input);
  return connection.run<AccountCatalogOwner | null>('readonly', context =>
    inventory(context, entries => {
      const existing = findOwner(entries, key);
      if (!existing) return context.finish(null);
      loadSlot(context, existing.slotId, () =>
        loadOwner(context, existing, entry => context.finish(entry.value))
      );
    })
  );
}

function listSlots(connection: CatalogConnection) {
  return connection.run<readonly AccountCatalogSlot[]>('readonly', context =>
    inventory(context, entries =>
      loadList(
        entries.slots,
        (id, use) => loadSlot(context, id, entry => use(entry.value)),
        context.finish
      )
    )
  );
}

async function listOwners(connection: CatalogConnection, input?: string) {
  const slotId = input === undefined ? undefined : demandSlotId(input);
  return connection.run<readonly AccountCatalogOwner[]>('readonly', context =>
    inventory(context, entries => {
      const selected =
        slotId === undefined ? entries.owners : entries.owners.filter(key => key.slotId === slotId);
      const selectedSlots = [...new Set(selected.map(key => key.slotId))];
      loadList(
        selectedSlots,
        (id, use) => loadSlot(context, id, use),
        () =>
          loadList(
            selected,
            (key, use) => loadOwner(context, key, entry => use(entry.value)),
            context.finish
          )
      );
    })
  );
}

/** Storage-only owner. Opening, returning and listing records grants no provider authority. */
export async function openAccountCatalog(
  options: AccountCatalogOptions = {}
): Promise<AccountCatalog> {
  const { database, timeoutMs } = await openCatalogDatabase(options);
  const connection = new CatalogConnection(database, timeoutMs);
  return Object.freeze({
    createPausedClaude: (input: CreatePausedClaudeInput, signal?: AbortSignal) =>
      createPausedClaude(connection, input, signal),
    createPausedClaudeSingleScope: (input: CreatePausedClaudeInput, signal?: AbortSignal) =>
      createPausedClaude(connection, input, signal, true),
    readSlot: (slotId: string) => readSlot(connection, slotId),
    readOwner: (key: AccountCatalogOwnerLocator) => readOwner(connection, key),
    listSlots: () => listSlots(connection),
    listOwners: (slotId?: string) => listOwners(connection, slotId),
    close: () => connection.close(),
  });
}
