import type { OperationRecord } from '../purpose-persistence-v3/core/record';
import {
  PROVIDER_BASELINE_LIMITS,
  MAX_PROVIDER_OPERATIONS,
  type AdmittedBaselinePlan,
  type ProviderBaselineCheckpoint,
  type ProviderBaselineProgress,
  type ItemProgress,
  type NextProviderBaselineDecision,
  type PlanDependencies,
} from './contracts';
import type { ProgressCategory, StopReason } from '../baseline-plan/contracts';
import { check, freeze, hashDependency, integer } from '../baseline-plan/data';
import { assertProviderCheckpointPlan, snapshotProviderBaselineCheckpoint } from './checkpoint';
import { snapshotAdmittedPlan, verifyPlan } from '../baseline-plan/plan';
import {
  assertProviderFresh,
  latestProviderObservation,
  matchesProviderItem,
  providerRecordDigest,
  snapshotProviderOperations,
  providerOperationDigest,
} from './operation';

function category(record: OperationRecord): ProgressCategory {
  // Even paused/abandoned unknown outcomes retain their unresolved external-effect fence.
  if (record.phase === 'in-flight' || record.phase === 'unknown') return 'in-flight-or-unknown';
  if (record.phase === 'awaiting-resolution') return 'awaiting-resolution';
  if (record.control === 'paused' || record.disposition === 'abandoned')
    return 'paused-or-abandoned';
  return 'reserved';
}
interface Reconciliation {
  conflict: boolean;
  unresolvedEffect: boolean;
  readonly byItem: Map<number, OperationRecord>;
  readonly conflicted: Set<number>;
}
function identities(
  plan: AdmittedBaselinePlan,
  records: readonly OperationRecord[]
): Reconciliation {
  const state: Reconciliation = {
    conflict: false,
    unresolvedEffect: false,
    byItem: new Map(),
    conflicted: new Set(),
  };
  const seen = {
    operationId: new Set<string>(),
    attemptId: new Set<string>(),
    captureId: new Set<string>(),
  };
  for (const record of records) {
    const item = plan.plan.items.find(item => matchesProviderItem(plan.plan, item, record));
    for (const field of ['operationId', 'attemptId', 'captureId'] as const) {
      if (seen[field].has(record.operation[field])) state.conflict = true;
      seen[field].add(record.operation[field]);
    }
    if (!item) state.conflict = true;
    else if (state.byItem.has(item.ordinal)) {
      state.conflict = true;
      state.conflicted.add(item.ordinal);
    } else state.byItem.set(item.ordinal, record);
  }
  return state;
}
async function reconcileLinks(
  checkpoint: ProviderBaselineCheckpoint,
  records: readonly OperationRecord[],
  state: Reconciliation,
  hashes: ReadonlyMap<string, string>,
  hash: (bytes: Uint8Array) => Promise<string>
) {
  for (const link of checkpoint.links) {
    const record = records.find(record => record.operation.operationId === link.operationId);
    let valid =
      record &&
      state.byItem.get(link.itemOrdinal) === record &&
      record.operation.attemptId === link.attemptId &&
      record.operation.captureId === link.captureId;
    if (valid && record) {
      valid = (await providerOperationDigest(record, hash)) === link.operationSha256;
      try {
        assertProviderFresh(
          record,
          hashes.get(link.operationId)!,
          latestProviderObservation(checkpoint.observations, link.operationId)
        );
      } catch {
        valid = false;
      }
    }
    if (!valid) {
      state.conflict = true;
      state.conflicted.add(link.itemOrdinal);
    }
  }
  for (const [ordinal, record] of state.byItem)
    if (
      !checkpoint.links.some(
        link => link.operationId === record.operation.operationId && link.itemOrdinal === ordinal
      )
    )
      state.unresolvedEffect = true;
}
/** All inputs, including every record, are detached before the first asynchronous dependency. */
async function analyze(
  planInput: AdmittedBaselinePlan,
  checkpointInput: ProviderBaselineCheckpoint,
  operationInputs: readonly OperationRecord[],
  nowInput: number,
  dependencies: PlanDependencies
) {
  const plan = snapshotAdmittedPlan(planInput);
  const checkpoint = snapshotProviderBaselineCheckpoint(checkpointInput);
  const records = snapshotProviderOperations(operationInputs);
  const now = integer(nowInput);
  assertProviderCheckpointPlan(plan, checkpoint);
  const signal = dependencies.signal;
  const hash = hashDependency(dependencies);
  await verifyPlan(plan, hash);
  const hashes = new Map<string, string>();
  for (const record of records)
    hashes.set(record.operation.operationId, await providerRecordDigest(record, hash));
  const state = identities(plan, records);
  await reconcileLinks(checkpoint, records, state, hashes, hash);
  check(!signal.aborted, 'hash-failed');
  const items: ItemProgress[] = plan.plan.items.map(item => {
    const record = state.byItem.get(item.ordinal);
    return {
      item,
      category: state.conflicted.has(item.ordinal)
        ? 'conflict'
        : record
          ? category(record)
          : 'untouched',
      resolutionRequired: !!record || state.conflicted.has(item.ordinal),
      ...(record && { operationId: record.operation.operationId }),
    };
  });
  const progress: ProviderBaselineProgress = freeze({
    executionAuthorized: false,
    items,
    conflict: state.conflict,
    unresolvedEffect:
      state.unresolvedEffect ||
      records.some(record => ['in-flight', 'unknown'].includes(record.phase)),
    clockRegressed: now < checkpoint.observedAt,
    recordCount: records.length,
    currentWindowCharges: checkpoint.charges.filter(
      charge => charge.windowId === checkpoint.budget.windowId
    ).length,
  });
  return { progress, checkpoint, now };
}
/**
 * Supplied records must be the caller's complete detached journal/3 snapshot, not a filtered subset.
 * Completeness of that external read cannot be proven here. Missing known links and any orphan
 * reservation fail closed; this module never silently adopts or writes an operation.
 * Every observation assessment, including `consistent`, remains awaiting resolution.
 */
export async function projectProviderBaselineProgress(
  plan: AdmittedBaselinePlan,
  checkpoint: ProviderBaselineCheckpoint,
  operations: readonly OperationRecord[],
  now: number,
  dependencies: PlanDependencies
): Promise<ProviderBaselineProgress> {
  return (await analyze(plan, checkpoint, operations, now, dependencies)).progress;
}
function stop(reason: StopReason): NextProviderBaselineDecision {
  return freeze({ executionAuthorized: false, kind: 'stop', reason });
}
/**
 * A candidate is an untouched catalog triple, NOT execution capability or a baseline-complete claim.
 * Reserved links and uncertain effects fence progression. Awaiting-resolution (all assessments)
 * and safely non-in-flight paused/abandoned records remain touched but permit a different item.
 * Budgets are charged once, never refunded by an observation, clock jump, pause or restart.
 * Stop precedence: conflict, regressed clock, paused, unresolved effect, reserved link,
 * cooldown, no untouched item, window budget, lifetime journal/3/checkpoint-history capacity.
 */
export async function nextProviderBaselineDecision(
  plan: AdmittedBaselinePlan,
  checkpointInput: ProviderBaselineCheckpoint,
  operations: readonly OperationRecord[],
  nowInput: number,
  dependencies: PlanDependencies
): Promise<NextProviderBaselineDecision> {
  try {
    const { progress, checkpoint, now } = await analyze(
      plan,
      checkpointInput,
      operations,
      nowInput,
      dependencies
    );
    if (progress.conflict) return stop('conflict');
    if (progress.clockRegressed) return stop('clock-regressed');
    if (checkpoint.control === 'paused') return stop('paused');
    if (progress.unresolvedEffect) return stop('unresolved-effect');
    if (progress.items.some(item => item.category === 'reserved'))
      return stop('linked-operation-pending');
    if (checkpoint.cooldown && now < checkpoint.cooldown.until) return stop('cooldown');
    const candidate = progress.items.find(item => item.category === 'untouched');
    if (!candidate) return stop('no-unattempted-items');
    if (progress.currentWindowCharges >= checkpoint.budget.maxReservationSlots)
      return stop('budget-exhausted');
    if (
      progress.recordCount >= MAX_PROVIDER_OPERATIONS ||
      checkpoint.observations.length >= PROVIDER_BASELINE_LIMITS.maxObservations
    )
      return stop('capacity-unavailable');
    return freeze({ executionAuthorized: false, kind: 'candidate', item: candidate.item });
  } catch {
    return stop('conflict');
  }
}
