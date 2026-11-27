import {
  AccountCatalogError,
  openAccountCatalog,
  type AccountCatalog,
  type AccountCatalogErrorCode,
  type CreatePausedClaudeResult,
} from '../account-catalog-owner';
import { CLAUDE_BASELINE_HARD_LIMITS } from '../claude-baseline/contracts';
import { fields } from '../claude-baseline/data';
import {
  isAborted,
  LegacySourceError,
  readLegacyCatalog,
  type LegacySourceErrorCode,
} from './legacy-source';

const MAX_TIMEOUT_MS = 5000;
const MAX_LABEL_SCALARS = 80;
const MAX_LABEL_BYTES = 256;

export interface AdoptLegacyClaudeCatalogInput {
  readonly slotId: string;
  readonly label: string;
  /** Trusted platform or test dependency, not persisted input. */
  readonly indexedDB?: IDBFactory;
  /** Per-stage wait bound; the destination owner also bounds its abort grace period. */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

type Verification = 'verified' | 'readback-unavailable' | 'owner-mismatch';
type Cleanup = 'closed' | 'close-failed';
type DestinationErrorCode = AccountCatalogErrorCode | 'unexpected-failure' | 'cancelled';
type CopyOutcome =
  | { readonly kind: 'failed'; readonly stage: 'destination'; readonly code: DestinationErrorCode }
  | (CreatePausedClaudeResult & { readonly verification: Verification });

export type AdoptLegacyClaudeCatalogResult =
  | { readonly kind: 'legacy-absent' | 'legacy-empty' }
  | { readonly kind: 'failed'; readonly stage: 'input'; readonly code: 'invalid-input' }
  | {
      readonly kind: 'failed';
      readonly stage: 'source';
      readonly code: LegacySourceErrorCode | 'unavailable';
    }
  | (Extract<CopyOutcome, { kind: 'failed' }> & { readonly cleanup: Cleanup | 'not-opened' })
  | (Exclude<CopyOutcome, { kind: 'failed' }> & { readonly cleanup: Cleanup });

function isDisplayLabel(value: unknown): value is string {
  // Match the owner's display bounds before performing any storage operation.
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_LABEL_SCALARS * 2 &&
    value === value.trim() &&
    value === value.normalize('NFC') &&
    !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value) &&
    [...value].length <= MAX_LABEL_SCALARS &&
    new TextEncoder().encode(value).length <= MAX_LABEL_BYTES
  );
}

function isFactory(value: unknown): value is IDBFactory {
  if (value === null || typeof value !== 'object') return false;
  let candidate: object | null = value;
  // Accept platform/test methods, never a factory `open` accessor.
  for (let depth = 0; candidate !== null && depth < 8; depth++) {
    const method = Object.getOwnPropertyDescriptor(candidate, 'open');
    if (method) return typeof method.value === 'function';
    candidate = Object.getPrototypeOf(candidate);
  }
  return false;
}

function snapshotInput(input: unknown) {
  const data = fields(
    input,
    ['slotId', 'label'],
    ['indexedDB', 'timeoutMs', 'signal'],
    CLAUDE_BASELINE_HARD_LIMITS
  );
  const { slotId, label } = data;
  const timeoutMs = 'timeoutMs' in data ? data.timeoutMs : MAX_TIMEOUT_MS;
  const factory = data.indexedDB;
  if (
    typeof slotId !== 'string' ||
    !/^account-slot\/1:[a-f0-9]{32}$/u.test(slotId) ||
    !isDisplayLabel(label) ||
    typeof timeoutMs !== 'number' ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_TIMEOUT_MS ||
    (factory !== undefined && !isFactory(factory))
  )
    throw new TypeError('invalid-input');
  const signal = data.signal as AbortSignal | undefined;
  return {
    slotId,
    label,
    timeoutMs,
    factory,
    signal,
    aborted: isAborted(signal),
  };
}

type Options = ReturnType<typeof snapshotInput>;
type Legacy = Awaited<ReturnType<typeof readLegacyCatalog>>;
type Baseline = Extract<Legacy, { kind: 'found' }>['baseline'];

function platformFactory(injected: IDBFactory | undefined): IDBFactory | undefined {
  try {
    return injected ?? globalThis.indexedDB;
  } catch {
    return undefined;
  }
}

function destinationFailure(code: DestinationErrorCode): Extract<CopyOutcome, { kind: 'failed' }> {
  return { kind: 'failed', stage: 'destination', code };
}

function destinationCode(error: unknown, signal: AbortSignal | undefined): DestinationErrorCode {
  if (!(error instanceof AccountCatalogError)) return 'unexpected-failure';
  return error.code === 'transaction-aborted' && isAborted(signal) ? 'cancelled' : error.code;
}

async function copyInto(
  catalog: AccountCatalog,
  { slotId, label, signal }: Options,
  { collectionId, admission }: Baseline
): Promise<CopyOutcome> {
  if (isAborted(signal)) return destinationFailure('cancelled');
  let committed: CreatePausedClaudeResult;
  try {
    committed = await catalog.createPausedClaudeSingleScope(
      { slotId, label, collectionId, admission },
      signal
    );
  } catch (error) {
    return destinationFailure(destinationCode(error, signal));
  }
  let verification: Verification = 'readback-unavailable';
  try {
    const readback = await catalog.readOwner({
      provider: 'claude',
      slotId,
      scopeKey: admission.catalog.scopeKey,
    });
    // Both owner objects are closed and canonicalized by the owner codec.
    verification =
      JSON.stringify(readback) === JSON.stringify(committed.owner) ? 'verified' : 'owner-mismatch';
  } catch {
    // The owner already reported its terminal result; no readback can undo it.
  }
  return { ...committed, verification };
}

async function writeDestination(factory: IDBFactory, options: Options, baseline: Baseline) {
  let catalog: AccountCatalog;
  try {
    catalog = await openAccountCatalog({ indexedDB: factory, timeoutMs: options.timeoutMs });
  } catch (error) {
    return {
      ...destinationFailure(destinationCode(error, options.signal)),
      cleanup: 'not-opened',
    } as const;
  }
  let cleanup: Cleanup = 'closed';
  let outcome: CopyOutcome;
  try {
    outcome = await copyInto(catalog, options, baseline);
  } finally {
    try {
      await catalog.close();
    } catch {
      cleanup = 'close-failed';
    }
  }
  return Object.freeze({ ...outcome, cleanup });
}

/**
 * Offline, non-atomic copy of the legacy singleton seed into an explicit local
 * display slot. A slot and a scope do not establish provider identity.
 * Rerun the same slot/label/seed to reconcile an unknown outcome. A different
 * explicit slot may copy the same scope; there is no global deduplication.
 */
export async function adoptLegacyClaudeCatalog(
  input: AdoptLegacyClaudeCatalogInput
): Promise<AdoptLegacyClaudeCatalogResult> {
  let options: Options;
  try {
    options = snapshotInput(input);
  } catch {
    return { kind: 'failed', stage: 'input', code: 'invalid-input' };
  }
  const { timeoutMs, signal } = options;
  if (options.aborted) return { kind: 'failed', stage: 'source', code: 'cancelled' };
  const factory = platformFactory(options.factory);
  if (!factory) return { kind: 'failed', stage: 'source', code: 'unavailable' };
  let legacy: Legacy;
  try {
    legacy = await readLegacyCatalog({ factory, timeoutMs, signal });
  } catch (error) {
    const code = error instanceof LegacySourceError ? error.code : 'read-failed';
    return { kind: 'failed', stage: 'source', code };
  }
  if (isAborted(signal)) return { kind: 'failed', stage: 'source', code: 'cancelled' };
  return legacy.kind === 'found' ? writeDestination(factory, options, legacy.baseline) : legacy;
}
