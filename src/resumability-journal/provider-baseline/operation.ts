import type {
  AdmittedBaselinePlan,
  BaselinePlan,
  OperationObservation,
  PlanItem,
} from '../baseline-plan/contracts';
import { canonical, check, freeze, list } from '../baseline-plan/data';
import { sameIdentity, snapshotAdmittedPlan } from '../baseline-plan/plan';
import { canonical as canonicalRecord } from '../purpose-persistence-v3/core/data';
import {
  encodeRecord,
  snapshotRecord,
  validateObservation,
  type OperationRecord,
} from '../purpose-persistence-v3/core/record';
import { MAX_PROVIDER_OPERATIONS } from './contracts';

/** The accepted plan remains unchanged; this layer is deliberately closed to two providers. */
export function assertProviderPlan(plan: AdmittedBaselinePlan): void {
  const current = snapshotAdmittedPlan(plan);
  check(
    current.plan.items.every(item => item.provider === 'chatgpt' || item.provider === 'claude'),
    'invalid-plan'
  );
}
export function snapshotProviderOperations(input: unknown): readonly OperationRecord[] {
  return freeze(
    list(input, MAX_PROVIDER_OPERATIONS).map(value => {
      const record = snapshotRecord(value);
      encodeRecord(record);
      return record;
    })
  );
}
export function matchesProviderItem(
  plan: BaselinePlan,
  item: PlanItem,
  record: OperationRecord
): boolean {
  const operation = record.operation;
  return (
    (item.provider === 'chatgpt' || item.provider === 'claude') &&
    sameIdentity(item, operation.admission) &&
    operation.purpose === plan.purpose &&
    operation.sourceSelection.catalogSha256 === plan.catalogSha256 &&
    operation.completenessPolicy === plan.completenessPolicy &&
    canonical(operation.destinations) === canonical(plan.destinations)
  );
}
export function latestProviderObservation(
  history: readonly OperationObservation[],
  operationId: string
) {
  const matching = history.filter(item => item.operationId === operationId);
  return matching[matching.length - 1];
}
/** Snapshot through journal/3 before yielding; never send a whole record through plan detach. */
export async function providerRecordDigest(
  recordInput: OperationRecord,
  hash: (bytes: Uint8Array) => Promise<string>
) {
  const record = snapshotRecord(recordInput);
  const bytes = encodeRecord(record);
  await validateObservation(record, hash);
  return hash(bytes);
}
export async function providerOperationDigest(
  recordInput: OperationRecord,
  hash: (bytes: Uint8Array) => Promise<string>
) {
  const record = snapshotRecord(recordInput);
  return hash(new TextEncoder().encode(canonicalRecord(record.operation)));
}
export function assertProviderFresh(
  record: OperationRecord,
  hash: string,
  latest?: OperationObservation
) {
  if (!latest) return;
  check(record.revision >= latest.recordRevision, 'operation-conflict');
  check(
    record.revision !== latest.recordRevision || hash === latest.recordSha256,
    'operation-conflict'
  );
}
