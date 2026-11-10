/** Pure identity, observation and evidence transitions for the provider-bound execution port. */
import { adaptClaudeProducerEvidence } from '../claude-producer-adapter';
import { canonical, detach, digest, exact, identifier, integer } from '../baseline-plan/data';
import type { PlanDependencies } from '../baseline-plan/contracts';
import { reduceProviderBaselineCheckpoint } from '../provider-baseline/checkpoint';
import { latestProviderObservation, matchesProviderItem } from '../provider-baseline/operation';
import { adaptChatGptProducerEvidence } from '../producer-adapter';
import {
  CHATGPT_ADAPTER_VERSION,
  CLAUDE_ADAPTER_VERSION,
  revise,
  type OperationRecord,
  type Provider,
  type snapshotReceipts,
} from '../purpose-persistence-v3/core/record';
import { requireOwner } from './errors';
import { assertProviderExecutionHeadroom, type ValidatedProviderOwner } from './envelope';
import type { ProviderReservationIdentity } from './index';

export function snapshotProviderIdentity(
  input: ProviderReservationIdentity
): ProviderReservationIdentity {
  const fields = exact(detach(input), [
    'planSha256',
    'item',
    'operationId',
    'attemptId',
    'captureId',
  ]);
  const item = exact(fields.item, ['ordinal', 'provider', 'conversationId', 'conversationKey']);
  requireOwner(item.provider === 'chatgpt' || item.provider === 'claude', 'invalid-input');
  return Object.freeze({
    planSha256: digest(fields.planSha256),
    item: Object.freeze({
      ordinal: integer(item.ordinal),
      provider: item.provider,
      conversationId: identifier(item.conversationId),
      conversationKey: identifier(item.conversationKey),
    }),
    operationId: identifier(fields.operationId),
    attemptId: identifier(fields.attemptId),
    captureId: identifier(fields.captureId),
  }) as ProviderReservationIdentity;
}

// eslint-disable-next-line complexity -- Full immutable identity, link, charge, item and latest-revision binding is intentionally explicit.
export function boundProviderRecord(
  owner: ValidatedProviderOwner | undefined,
  identity: ProviderReservationIdentity,
  revision?: number
): OperationRecord {
  requireOwner(owner && owner.plan.planSha256 === identity.planSha256, 'corrupt-owner');
  const item = owner.plan.plan.items[identity.item.ordinal];
  requireOwner(item && canonical(item) === canonical(identity.item), 'invalid-input');
  const record = owner.operations.find(
    candidate => candidate.operation.operationId === identity.operationId
  );
  requireOwner(record, 'owner-not-found');
  const link = owner.checkpoint.links.find(
    candidate => candidate.operationId === identity.operationId
  );
  const charge = owner.checkpoint.charges.find(
    candidate => candidate.operationId === identity.operationId
  );
  const operation = record.operation;
  requireOwner(
    link &&
      charge &&
      link.itemOrdinal === item.ordinal &&
      link.attemptId === identity.attemptId &&
      link.captureId === identity.captureId &&
      charge.itemOrdinal === item.ordinal &&
      charge.windowId === link.windowId &&
      charge.chargedAt === link.linkedAt &&
      operation.attemptId === identity.attemptId &&
      operation.captureId === identity.captureId &&
      operation.admission.provider === item.provider &&
      operation.admission.conversationId === item.conversationId &&
      operation.admission.conversationKey === item.conversationKey &&
      matchesProviderItem(owner.plan.plan, item, record) &&
      latestProviderObservation(owner.checkpoint.observations, identity.operationId)
        ?.recordRevision === record.revision,
    'corrupt-owner'
  );
  if (revision !== undefined)
    requireOwner(integer(revision) === record.revision, 'revision-conflict');
  return record;
}

export async function observeProviderRecord(
  owner: ValidatedProviderOwner,
  record: OperationRecord,
  now: number,
  dependencies: PlanDependencies
): Promise<ValidatedProviderOwner> {
  const link = owner.checkpoint.links.find(
    candidate => candidate.operationId === record.operation.operationId
  );
  requireOwner(link, 'corrupt-owner');
  const checkpoint = await reduceProviderBaselineCheckpoint(
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
  const updated = {
    ...owner,
    checkpoint,
    operations: Object.freeze(
      owner.operations.map(current =>
        current.operation.operationId === record.operation.operationId ? record : current
      )
    ),
  };
  assertProviderExecutionHeadroom(updated);
  return updated;
}

export async function providerEvidenceRecord(
  record: OperationRecord,
  receipts: ReturnType<typeof snapshotReceipts>,
  dependencies: PlanDependencies
): Promise<OperationRecord> {
  requireOwner(
    record.disposition === 'open' &&
      !record.observation &&
      (record.phase === 'in-flight' || record.phase === 'unknown'),
    'invalid-input'
  );
  const provider: Provider = record.operation.admission.provider;
  const adaptation =
    provider === 'chatgpt'
      ? await adaptChatGptProducerEvidence(record.operation, receipts, bytes =>
          dependencies.sha256(bytes, dependencies.signal)
        )
      : await adaptClaudeProducerEvidence(record.operation, receipts, bytes =>
          dependencies.sha256(bytes, dependencies.signal)
        );
  return revise(record, {
    phase: 'awaiting-resolution',
    observation: {
      provider,
      adapterVersion: provider === 'chatgpt' ? CHATGPT_ADAPTER_VERSION : CLAUDE_ADAPTER_VERSION,
      hashOutcome: adaptation.adapterCode === 'hash-failed' ? 'failed' : 'available',
      receipts,
      adaptation,
    } as OperationRecord['observation'],
  });
}
