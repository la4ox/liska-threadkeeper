import {
  decodeClaudeAccountBaseline,
  prepareClaudeAccountBaseline,
  sameBytes,
  type ClaudeAccountBaseline,
} from './codec';
import {
  CLAUDE_ACCOUNT_BASELINE_OWNER_KEY,
  openClaudeAccountOwnerDatabase,
  type ClaudeAccountBaselineOwnerOptions,
} from './database';
import { ClaudeAccountBaselineOwnerError } from './errors';
import { OwnerConnection, type OwnerTransaction } from './transaction';

export type { ClaudeAccountBaseline } from './codec';
export type { ClaudeAccountBaselineOwnerOptions } from './database';
export {
  ClaudeAccountBaselineOwnerError,
  type ClaudeAccountBaselineOwnerErrorCode,
} from './errors';

export interface ClaudeAccountBaselineCreateResult {
  readonly kind: 'created' | 'already-created';
  readonly baseline: ClaudeAccountBaseline;
}

export interface ClaudeAccountBaselineOwner {
  createPaused(
    collectionId: string,
    admittedResult: unknown,
    signal?: AbortSignal
  ): Promise<ClaudeAccountBaselineCreateResult>;
  read(): Promise<ClaudeAccountBaseline | null>;
  close(): Promise<void>;
}

type Occupied = { value: ClaudeAccountBaseline; bytes: Uint8Array };
type Inventory = Occupied | null | ClaudeAccountBaselineOwnerError;

function decodeStored(input: unknown): Exclude<Inventory, null> {
  try {
    return { value: decodeClaudeAccountBaseline(input), bytes: input as Uint8Array };
  } catch (error) {
    return new ClaudeAccountBaselineOwnerError(
      error instanceof ClaudeAccountBaselineOwnerError && error.code === 'unsupported'
        ? 'unsupported'
        : 'corrupt'
    );
  }
}

/** Keys first: only read a value after the whole eligible inventory is known. */
function inventory<Output>(
  context: OwnerTransaction<Output>,
  use: (found: Inventory) => void
): void {
  let found = false;
  const request = context.store.openKeyCursor();
  context.request(request, cursor => {
    if (!cursor) {
      if (!found) use(null);
      else
        context.request(context.store.get(CLAUDE_ACCOUNT_BASELINE_OWNER_KEY), bytes =>
          use(decodeStored(bytes))
        );
      return;
    }
    if (found || cursor.primaryKey !== CLAUDE_ACCOUNT_BASELINE_OWNER_KEY) {
      use(new ClaudeAccountBaselineOwnerError('corrupt'));
      return;
    }
    found = true;
    cursor.continue();
  });
}

async function createPaused(
  connection: OwnerConnection,
  collectionId: string,
  admittedResult: unknown,
  signal?: AbortSignal
): Promise<ClaudeAccountBaselineCreateResult> {
  const prepared = prepareClaudeAccountBaseline(collectionId, admittedResult);
  const result = await connection.run<
    ClaudeAccountBaselineCreateResult | ClaudeAccountBaselineOwnerError
  >(
    'readwrite',
    context =>
      inventory(context, stored => {
        if (stored instanceof ClaudeAccountBaselineOwnerError) return context.finish(stored);
        if (stored) {
          const sameSeed =
            stored.value.collectionId === collectionId && sameBytes(stored.bytes, prepared.bytes);
          return context.finish(
            sameSeed
              ? Object.freeze({ kind: 'already-created', baseline: stored.value })
              : new ClaudeAccountBaselineOwnerError('conflict')
          );
        }
        if (!context.isAborting())
          context.request(
            context.store.add(prepared.bytes, CLAUDE_ACCOUNT_BASELINE_OWNER_KEY),
            () => context.finish(Object.freeze({ kind: 'created', baseline: prepared.value }))
          );
      }),
    signal
  );
  if (result instanceof ClaudeAccountBaselineOwnerError) throw result;
  return result;
}

async function read(connection: OwnerConnection): Promise<ClaudeAccountBaseline | null> {
  const stored = await connection.run<Inventory>('readonly', context =>
    inventory(context, context.finish)
  );
  if (stored instanceof ClaudeAccountBaselineOwnerError) throw stored;
  return stored?.value ?? null;
}

/** Reopening gives inspection, never continuation or execution authority. */
export async function openClaudeAccountBaselineOwner(
  options: ClaudeAccountBaselineOwnerOptions = {}
): Promise<ClaudeAccountBaselineOwner> {
  const { database, timeoutMs } = await openClaudeAccountOwnerDatabase(options);
  const connection = new OwnerConnection(database, timeoutMs);
  return Object.freeze({
    createPaused: (collectionId: string, admittedResult: unknown, signal?: AbortSignal) =>
      createPaused(connection, collectionId, admittedResult, signal),
    read: () => read(connection),
    close: () => connection.close(),
  });
}
