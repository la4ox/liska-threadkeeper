import { admitNewCaptureOperation, type NewCaptureOperation } from '../../purpose';
import {
  snapshotChatGptProducerReceipt,
  type ChatGptProducerReceipt,
} from '../../../lib/chatgpt-producer-evidence';
import {
  adaptChatGptProducerEvidence,
  type ProducerAdaptation,
  type ProducerSha256,
} from '../../producer-adapter';
import { canonical, detach, exactObject, freeze, MAX_RECORD_BYTES } from './data';
import { PurposePersistenceError, requireCondition } from './errors';

export const RECORD_SCHEMA = 'liska-resumability-journal/2' as const;
export const ADAPTER_VERSION = 'liska-chatgpt-producer-adapter/1' as const;
export const EXECUTION_INTERRUPTION_REASONS = [
  'execution-cancelled',
  'capture-failed',
  'producer-failed',
  'evidence-persistence-failed',
] as const;
export type ExecutionInterruptionReason = (typeof EXECUTION_INTERRUPTION_REASONS)[number];
export interface Observation {
  readonly adapterVersion: typeof ADAPTER_VERSION;
  /** Historical dependency outcome, not a claim about the currently available hash. */
  readonly hashOutcome: 'available' | 'failed';
  readonly receipts: readonly ChatGptProducerReceipt[];
  readonly adaptation: ProducerAdaptation;
}
export interface OperationRecord {
  readonly schema: typeof RECORD_SCHEMA;
  readonly revision: number;
  readonly operation: NewCaptureOperation;
  readonly phase: 'reserved' | 'in-flight' | 'awaiting-resolution' | 'unknown';
  readonly control: 'active' | 'paused';
  readonly disposition: 'open' | 'abandoned';
  readonly interruptionReason?: 'pause' | 'restart' | 'abandon' | ExecutionInterruptionReason;
  readonly observation?: Observation;
}

export function snapshotReceipts(input: unknown): readonly ChatGptProducerReceipt[] {
  try {
    const data = detach(input);
    requireCondition(Array.isArray(data) && data.length <= 2);
    return freeze(data.map(snapshotChatGptProducerReceipt));
  } catch {
    throw new PurposePersistenceError('invalid-receipts');
  }
}

/** Structural validation is synchronous; receipt-backed semantic replay follows outside IDB. */
// eslint-disable-next-line max-lines-per-function -- One exact versioned envelope with cross-field state constraints.
export function snapshotRecord(input: unknown): OperationRecord {
  try {
    const data = exactObject(
      detach(input),
      ['schema', 'revision', 'operation', 'phase', 'control', 'disposition'],
      ['interruptionReason', 'observation']
    );
    requireCondition(
      data.schema === RECORD_SCHEMA &&
        Number.isSafeInteger(data.revision) &&
        (data.revision as number) >= 0
    );
    requireCondition(
      ['reserved', 'in-flight', 'awaiting-resolution', 'unknown'].includes(data.phase as string)
    );
    requireCondition(
      ['active', 'paused'].includes(data.control as string) &&
        ['open', 'abandoned'].includes(data.disposition as string)
    );
    const operation = admitNewCaptureOperation(data.operation);
    requireCondition(operation.admission.provider === 'chatgpt');
    requireCondition(canonical(operation) === canonical(data.operation));
    if ('interruptionReason' in data)
      requireCondition(
        ['pause', 'restart', 'abandon', ...EXECUTION_INTERRUPTION_REASONS].includes(
          data.interruptionReason as string
        ) && ['unknown', 'awaiting-resolution'].includes(data.phase as string)
      );
    requireCondition(data.phase !== 'unknown' || 'interruptionReason' in data);
    requireCondition(
      data.phase !== 'in-flight' || (data.control === 'active' && data.disposition === 'open')
    );
    requireCondition((data.phase === 'awaiting-resolution') === 'observation' in data);
    if ('observation' in data) {
      const observed = exactObject(data.observation, [
        'adapterVersion',
        'hashOutcome',
        'receipts',
        'adaptation',
      ]);
      requireCondition(
        observed.adapterVersion === ADAPTER_VERSION &&
          ['available', 'failed'].includes(observed.hashOutcome as string)
      );
      requireCondition(
        canonical(snapshotReceipts(observed.receipts)) === canonical(observed.receipts)
      );
      const adapted = exactObject(observed.adaptation, ['assessment'], ['evidence', 'adapterCode']);
      const assessment = exactObject(adapted.assessment, ['kind', 'codes']);
      requireCondition(
        ['consistent', 'insufficient', 'conflict', 'rejected'].includes(
          assessment.kind as string
        ) && Array.isArray(assessment.codes)
      );
      requireCondition(
        (adapted.adapterCode === 'hash-failed') === (observed.hashOutcome === 'failed')
      );
    }
    return freeze({ ...data, operation }) as unknown as OperationRecord;
  } catch {
    throw new PurposePersistenceError('corrupt-record');
  }
}

export function encodeRecord(input: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(canonical(snapshotRecord(input)));
  requireCondition(bytes.byteLength <= MAX_RECORD_BYTES, 'record-too-large');
  return bytes;
}
export function decodeRecord(value: unknown, key: unknown): OperationRecord {
  try {
    requireCondition(value instanceof Uint8Array && value.byteLength <= MAX_RECORD_BYTES);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value);
    const record = snapshotRecord(JSON.parse(text));
    requireCondition(key === record.operation.operationId && canonical(record) === text);
    const bytes = new TextEncoder().encode(text);
    requireCondition(bytes.length === value.length && bytes.every((byte, i) => byte === value[i]));
    return record;
  } catch {
    throw new PurposePersistenceError('corrupt-record');
  }
}

/** Never trust the cached assessment, evidence or adapterCode, including conflicts without evidence. */
export async function validateObservation(
  record: OperationRecord,
  sha256: ProducerSha256
): Promise<void> {
  const observed = record.observation;
  if (!observed) return;
  const hash =
    observed.hashOutcome === 'failed'
      ? () => {
          throw new Error();
        }
      : sha256;
  const replay = await adaptChatGptProducerEvidence(record.operation, observed.receipts, hash);
  // A currently unavailable verifier is not proof that the historical record is corrupt.
  requireCondition(
    observed.hashOutcome === 'failed' || replay.adapterCode !== 'hash-failed',
    'read-failed'
  );
  requireCondition(canonical(replay) === canonical(observed.adaptation));
}

export function revise(
  record: OperationRecord,
  changes: Partial<OperationRecord>
): OperationRecord {
  requireCondition(record.revision < Number.MAX_SAFE_INTEGER, 'revision-conflict');
  return snapshotRecord({ ...record, ...changes, revision: record.revision + 1 });
}
