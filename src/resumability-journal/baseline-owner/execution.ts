/** Pure binding/transition helpers. Dispatch authority lives only on BaselineOwner. */
import { canonical, detach, exact, integer } from '../baseline-plan/data';
import {
  reduceBaselineCheckpoint,
  BaselinePlanError,
  type PlanDependencies,
} from '../baseline-plan';
import { adaptChatGptProducerEvidence } from '../producer-adapter';
import {
  ADAPTER_VERSION,
  revise,
  type snapshotReceipts,
  type OperationRecord,
} from '../purpose-persistence-v2/core/record';
import { PurposePersistenceError } from '../purpose-persistence-v2/core/errors';
import { ExecutionStoreError } from '../execution-coordinator/store-port';
import { OwnerStorageError, requireOwner } from './errors';
import { assertHeadroom, type ValidatedOwner } from './envelope';
import type { ReservationIdentity } from './index';

export function snapshotIdentity(input: ReservationIdentity): ReservationIdentity {
  const fields = exact(detach(input), [
    'planSha256',
    'item',
    'operationId',
    'attemptId',
    'captureId',
  ]);
  exact(fields.item, ['ordinal', 'provider', 'conversationId', 'conversationKey']);
  return fields as unknown as ReservationIdentity;
}
export function boundRecord(
  owner: ValidatedOwner | undefined,
  identity: ReservationIdentity,
  id = identity.operationId,
  revision?: number
): OperationRecord {
  requireOwner(owner && owner.plan.planSha256 === identity.planSha256, 'corrupt-owner');
  requireOwner(id === identity.operationId, 'invalid-input');
  const item = owner.plan.plan.items[integer(identity.item.ordinal)];
  requireOwner(item && canonical(item) === canonical(identity.item), 'invalid-input');
  const record = owner.operations.find(record => record.operation.operationId === id);
  requireOwner(record, 'owner-not-found');
  const link = owner.checkpoint.links.find(link => link.operationId === id);
  requireOwner(
    link &&
      link.itemOrdinal === item.ordinal &&
      link.attemptId === identity.attemptId &&
      link.captureId === identity.captureId &&
      record.operation.attemptId === identity.attemptId &&
      record.operation.captureId === identity.captureId &&
      owner.checkpoint.charges.some(
        charge =>
          charge.operationId === id &&
          charge.itemOrdinal === item.ordinal &&
          charge.windowId === link.windowId
      ),
    'corrupt-owner'
  );
  if (revision !== undefined)
    requireOwner(integer(revision) === record.revision, 'revision-conflict');
  return record;
}
export async function observeRecord(
  owner: ValidatedOwner,
  record: OperationRecord,
  now: number,
  dependencies: PlanDependencies
): Promise<ValidatedOwner> {
  const link = owner.checkpoint.links.find(
    link => link.operationId === record.operation.operationId
  );
  requireOwner(link, 'corrupt-owner');
  const checkpoint = await reduceBaselineCheckpoint(
    owner.plan,
    owner.checkpoint,
    {
      kind: 'observe-operation',
      expectedRevision: owner.checkpoint.revision,
      now,
      itemOrdinal: link.itemOrdinal,
      record,
    },
    dependencies
  );
  assertHeadroom(checkpoint);
  return {
    ...owner,
    checkpoint,
    operations: Object.freeze(
      owner.operations.map(current =>
        current.operation.operationId === record.operation.operationId ? record : current
      )
    ),
  };
}
export async function evidenceRecord(
  record: OperationRecord,
  receipts: ReturnType<typeof snapshotReceipts>,
  dependencies: PlanDependencies
): Promise<OperationRecord> {
  if (
    record.disposition !== 'open' ||
    record.observation ||
    !['in-flight', 'unknown'].includes(record.phase)
  )
    throw new ExecutionStoreError('transition-failed');
  const adaptation = await adaptChatGptProducerEvidence(record.operation, receipts, bytes =>
    dependencies.sha256(bytes, dependencies.signal)
  );
  return revise(record, {
    phase: 'awaiting-resolution',
    observation: {
      adapterVersion: ADAPTER_VERSION,
      hashOutcome: adaptation.adapterCode === 'hash-failed' ? 'failed' : 'available',
      receipts,
      adaptation,
    },
  });
}
/** Closed mapping; neither arbitrary exception text nor caller-provided codes cross the port. */
export async function ownerResult<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    return ownerFailure(error);
  }
}
// eslint-disable-next-line complexity -- Closed fixed-code translation deliberately lists every storage outcome.
export function ownerFailure(error: unknown): never {
  if (error instanceof ExecutionStoreError) throw error;
  if (error instanceof PurposePersistenceError) throw new ExecutionStoreError(error.code);
  if (error instanceof BaselinePlanError) throw new ExecutionStoreError('transition-failed');
  if (error instanceof OwnerStorageError) {
    switch (error.code) {
      case 'open-outcome-unknown':
      case 'transaction-outcome-unknown':
      case 'closed':
      case 'not-open':
      case 'version-changed':
      case 'unavailable':
      case 'transaction-aborted':
      case 'transaction-timeout':
      case 'read-failed':
      case 'write-failed':
      case 'quota-exceeded':
      case 'revision-conflict':
      case 'open-failed':
      case 'open-timeout':
      case 'open-blocked':
      case 'invalid-schema':
      case 'unsupported-version':
        throw new ExecutionStoreError(error.code);
      case 'owner-not-found':
        throw new ExecutionStoreError('operation-not-found');
      case 'corrupt-owner':
        throw new ExecutionStoreError('corrupt-record');
      default:
        throw new ExecutionStoreError('transition-failed');
    }
  }
  throw new ExecutionStoreError('write-failed');
}
