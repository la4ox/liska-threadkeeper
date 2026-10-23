import type {
  DurableWriteOutcome,
  DurableOutputResult,
  DurableWriteState,
  OutputResult,
  PersistentOutputDestination,
} from './types';

/** Runtime accounting only. This is never archive, asset, path or provenance evidence. */
export const OPERATION_WRITE_LEDGER_MAX_ATTEMPTS = 8192;
export type DurableArtifactKind = 'raw' | 'manifest' | 'canonical' | 'binary';

export interface OperationWriteObservation extends DurableWriteOutcome {
  readonly attempt: number;
  readonly destination: PersistentOutputDestination;
  readonly kind: DurableArtifactKind;
  readonly byteLength: number;
}

export interface OperationWriteLedgerSnapshot {
  readonly version: 1;
  readonly operationId: string;
  readonly valid: boolean;
  readonly observations: readonly OperationWriteObservation[];
}

export interface OperationWriteAttempt {
  /** Call immediately before handing the durable request to messaging. */
  issue(): void;
  /** Missing or malformed sink evidence after issue is conservatively unknown. */
  observe(outcome?: unknown): void;
}

export interface OperationWriteLedger {
  begin(
    destination: PersistentOutputDestination,
    kind: DurableArtifactKind,
    byteLength: number
  ): OperationWriteAttempt;
  snapshot(): OperationWriteLedgerSnapshot;
}

function ownData(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  if (typeof value !== 'object' || value === null) return undefined;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (
    required.some(key => !Object.prototype.hasOwnProperty.call(descriptors, key)) ||
    keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key)) ||
    keys.some(key => {
      const descriptor = descriptors[key as string];
      return !descriptor || !('value' in descriptor) || !descriptor.enumerable;
    })
  )
    return undefined;
  return Object.fromEntries(keys.map(key => [key, descriptors[key as string].value]));
}

function safeBytes(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validOperationId(value: unknown): value is string {
  return (
    typeof value === 'string' && /^capture-(?:chatgpt|deepseek)-[a-zA-Z0-9_-]{1,128}$/.test(value)
  );
}

export function snapshotDurableWriteOutcome(value: unknown): DurableWriteOutcome | undefined {
  try {
    const data = ownData(value, ['state'], ['cleanupDeferred']);
    if (
      !data ||
      !['confirmed', 'unknown', 'not-dispatched'].includes(data.state as string) ||
      (Object.prototype.hasOwnProperty.call(data, 'cleanupDeferred') &&
        data.cleanupDeferred !== true)
    )
      return undefined;
    return Object.freeze({
      state: data.state as DurableWriteState,
      ...(data.cleanupDeferred === true && { cleanupDeferred: true as const }),
    });
  } catch {
    return undefined;
  }
}

/** Opt-in envelope: ordinary Markdown and legacy durable callers keep their old shapes. */
export function withDurableWriteOutcome(
  result: OutputResult,
  state: DurableWriteState,
  report: boolean | undefined,
  cleanupDeferred = false
): OutputResult | DurableOutputResult {
  return report === true
    ? ({
        ...result,
        writeOutcome: { state, ...(cleanupDeferred && { cleanupDeferred: true }) },
      } as DurableOutputResult)
    : result;
}

/** Read only the exact sink fact; neither success nor an error string substitutes for it. */
export function durableWriteOutcomeFromResult(value: unknown): DurableWriteOutcome | undefined {
  try {
    const data = ownData(value, ['destination', 'success', 'writeOutcome'], ['error', 'warning']);
    if (
      !data ||
      !['file', 'obsidian'].includes(data.destination as string) ||
      typeof data.success !== 'boolean'
    )
      return undefined;
    const outcome = snapshotDurableWriteOutcome(data.writeOutcome);
    return outcome && data.success === (outcome.state === 'confirmed') ? outcome : undefined;
  } catch {
    return undefined;
  }
}

interface LedgerEntry {
  attempt: number;
  destination: PersistentOutputDestination;
  kind: DurableArtifactKind;
  byteLength: number;
  issued: boolean;
  outcome?: DurableWriteOutcome;
}

function ownedAttempt(entry: LedgerEntry, invalidate: () => void): OperationWriteAttempt {
  return Object.freeze({
    issue() {
      if (entry.issued || entry.outcome) invalidate();
      entry.issued = true;
    },
    observe(value?: unknown) {
      const outcome = snapshotDurableWriteOutcome(value) ?? {
        state: entry.issued ? 'unknown' : 'not-dispatched',
      };
      if (!entry.issued && outcome.state !== 'not-dispatched') invalidate();
      if (entry.outcome) {
        if (
          entry.outcome.state !== outcome.state ||
          entry.outcome.cleanupDeferred !== outcome.cleanupDeferred
        )
          invalidate();
      } else entry.outcome = Object.freeze({ ...outcome });
    },
  });
}

/** Closure-owned attempts cannot import provider identity or alter prior observations. */
export function createOperationWriteLedger(operationId: string): OperationWriteLedger {
  let valid = validOperationId(operationId);
  const entries: LedgerEntry[] = [];
  return Object.freeze({
    begin(destination: PersistentOutputDestination, kind: DurableArtifactKind, byteLength: number) {
      if (
        !['file', 'obsidian'].includes(destination) ||
        !['raw', 'manifest', 'canonical', 'binary'].includes(kind) ||
        !safeBytes(byteLength) ||
        entries.length >= OPERATION_WRITE_LEDGER_MAX_ATTEMPTS
      ) {
        valid = false;
        return Object.freeze({ issue() {}, observe() {} });
      }
      const entry = {
        attempt: entries.length + 1,
        destination,
        kind,
        byteLength,
        issued: false,
      } as (typeof entries)[number];
      entries.push(entry);
      return ownedAttempt(entry, () => {
        valid = false;
      });
    },
    snapshot() {
      const observations = entries.map(({ issued, outcome, ...entry }) =>
        Object.freeze({
          ...entry,
          ...(outcome ?? { state: issued ? ('unknown' as const) : ('not-dispatched' as const) }),
        })
      );
      const snapshot = {
        version: 1 as const,
        operationId,
        valid,
        observations: Object.freeze(observations),
      };
      return Object.freeze(snapshot);
    },
  });
}

function observationFromValue(value: unknown): OperationWriteObservation | undefined {
  const entry = ownData(
    value,
    ['attempt', 'destination', 'kind', 'byteLength', 'state'],
    ['cleanupDeferred']
  );
  if (
    !entry ||
    !safeBytes(entry.attempt) ||
    entry.attempt < 1 ||
    entry.attempt > OPERATION_WRITE_LEDGER_MAX_ATTEMPTS ||
    !['file', 'obsidian'].includes(entry.destination as string) ||
    !['raw', 'manifest', 'canonical', 'binary'].includes(entry.kind as string) ||
    !safeBytes(entry.byteLength)
  )
    return undefined;
  const outcome = snapshotDurableWriteOutcome({
    state: entry.state,
    ...(Object.prototype.hasOwnProperty.call(entry, 'cleanupDeferred') && {
      cleanupDeferred: entry.cleanupDeferred,
    }),
  });
  return outcome
    ? Object.freeze({
        attempt: entry.attempt,
        destination: entry.destination as PersistentOutputDestination,
        kind: entry.kind as DurableArtifactKind,
        byteLength: entry.byteLength,
        ...outcome,
      })
    : undefined;
}

function observationValues(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (
    !safeBytes(length) ||
    length > OPERATION_WRITE_LEDGER_MAX_ATTEMPTS ||
    Reflect.ownKeys(value).length !== length + 1
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const values: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return undefined;
    values.push(descriptor.value);
  }
  return values;
}

function uniqueObservations(
  values: readonly unknown[]
): readonly OperationWriteObservation[] | undefined {
  const observations = new Map<number, OperationWriteObservation>();
  const totals = { file: 0, obsidian: 0 };
  for (const value of values) {
    const observation = observationFromValue(value);
    if (!observation) return undefined;
    const previous = observations.get(observation.attempt);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(observation)) return undefined;
      continue;
    }
    observations.set(observation.attempt, observation);
    if (observation.state !== 'not-dispatched') {
      const total = totals[observation.destination] + observation.byteLength;
      if (!Number.isSafeInteger(total)) return undefined;
      totals[observation.destination] = total;
    }
  }
  const ordered = [...observations.values()].sort((left, right) => left.attempt - right.attempt);
  return ordered.some((entry, index) => entry.attempt !== index + 1) ||
    !Number.isSafeInteger(totals.file + totals.obsidian)
    ? undefined
    : Object.freeze(ordered);
}

/** Exact detached snapshot; duplicates are idempotent, conflicts and unsafe sums fail closed. */
export function snapshotOperationWriteLedger(
  value: unknown,
  operationId: string
): OperationWriteLedgerSnapshot | undefined {
  try {
    const data = ownData(value, ['version', 'operationId', 'valid', 'observations']);
    if (
      !data ||
      data.version !== 1 ||
      data.valid !== true ||
      data.operationId !== operationId ||
      !validOperationId(operationId)
    )
      return undefined;
    const values = observationValues(data.observations);
    const observations = values && uniqueObservations(values);
    if (!observations) return undefined;
    return Object.freeze({
      version: 1,
      operationId,
      valid: true,
      observations,
    });
  } catch {
    return undefined;
  }
}
