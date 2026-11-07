import { MAX_RECORDS } from '../purpose-persistence-v2/core/data';
import {
  encodeRecord,
  snapshotRecord,
  validateObservation,
  type OperationRecord,
} from '../purpose-persistence-v2/core/record';
import type { BaselinePlan, OperationObservation, PlanItem } from './contracts';
import { canonical, check, list } from './data';
import { sameIdentity } from './plan';

export { MAX_RECORDS };
export function snapshotOperations(input: unknown): readonly OperationRecord[] {
  return list(input, MAX_RECORDS).map(value => {
    const record = snapshotRecord(value);
    encodeRecord(record); // Also enforce the existing v2 byte limit, not only structural validity.
    return record;
  });
}
export async function validateOperation(
  record: OperationRecord,
  hash: (bytes: Uint8Array) => Promise<string>
) {
  await validateObservation(record, hash);
}
export function matchesItem(plan: BaselinePlan, item: PlanItem, record: OperationRecord): boolean {
  const operation = record.operation;
  return (
    sameIdentity(item, operation.admission) &&
    operation.purpose === plan.purpose &&
    operation.sourceSelection.catalogSha256 === plan.catalogSha256 &&
    operation.completenessPolicy === plan.completenessPolicy &&
    canonical(operation.destinations) === canonical(plan.destinations)
  );
}
export function latestObservation(history: readonly OperationObservation[], operationId: string) {
  const matching = history.filter(item => item.operationId === operationId);
  return matching[matching.length - 1];
}
export async function recordDigest(
  record: OperationRecord,
  hash: (bytes: Uint8Array) => Promise<string>
) {
  await validateOperation(record, hash);
  return hash(encodeRecord(record));
}
export function assertFresh(record: OperationRecord, hash: string, latest?: OperationObservation) {
  if (!latest) return;
  check(record.revision >= latest.recordRevision, 'operation-conflict');
  check(
    record.revision !== latest.recordRevision || hash === latest.recordSha256,
    'operation-conflict'
  );
}
