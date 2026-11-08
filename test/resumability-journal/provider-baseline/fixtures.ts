import {
  clone,
  hash,
  sha256,
  dependencies,
  identity,
  catalogBytes,
  requirements,
  bothDestinations,
} from '../baseline-plan/fixtures';
import { createBaselinePlan } from '../../../src/resumability-journal/baseline-plan/plan';
import type {
  Identity,
  AdmittedBaselinePlan,
} from '../../../src/resumability-journal/baseline-plan/contracts';
import {
  createProviderBaselineCheckpoint,
  reduceProviderBaselineCheckpoint,
  type ProviderBaselineCheckpoint,
  type ProviderCheckpointCommand,
} from '../../../src/resumability-journal/provider-baseline';
import {
  snapshotRecord,
  RECORD_SCHEMA,
  CHATGPT_ADAPTER_VERSION,
  CLAUDE_ADAPTER_VERSION,
  type OperationRecord,
  type Provider,
} from '../../../src/resumability-journal/purpose-persistence-v3/core/record';
import { OPERATION_SCHEMA, STRICT_COMPLETENESS } from '../../../src/resumability-journal/purpose';
import {
  CHATGPT_PRODUCER_SCHEMA,
  type ChatGptProducerReceipt,
} from '../../../src/lib/chatgpt-producer-evidence';
import {
  CLAUDE_PRODUCER_SCHEMA,
  type ClaudeProducerReceipt,
} from '../../../src/lib/claude-producer-evidence';
import { adaptChatGptProducerEvidence } from '../../../src/resumability-journal/producer-adapter';
import { adaptClaudeProducerEvidence } from '../../../src/resumability-journal/claude-producer-adapter';
export {
  clone,
  hash,
  sha256,
  dependencies,
  identity,
  catalogBytes,
  requirements,
  bothDestinations,
};

export async function fixture(
  count = 3,
  slots = 16,
  selected?: readonly Identity[],
  provider: Provider = 'chatgpt'
) {
  const selection =
    selected ?? Array.from({ length: count }, (_, index) => identity(index, provider));
  const bytes = await catalogBytes(selection);
  const plan = await createBaselinePlan(bytes, { ...requirements, selection }, dependencies());
  const checkpoint = await createProviderBaselineCheckpoint(
    plan,
    { now: 100, windowId: 'window-a', maxReservationSlots: slots },
    dependencies()
  );
  return { plan, checkpoint, bytes, selection };
}
export function reserved(
  plan: AdmittedBaselinePlan,
  ordinal = 0,
  suffix = String(ordinal)
): OperationRecord {
  const { provider, conversationId, conversationKey } = plan.plan.items[ordinal];
  return snapshotRecord({
    schema: RECORD_SCHEMA,
    revision: 0,
    phase: 'reserved',
    control: 'active',
    disposition: 'open',
    operation: {
      schema: OPERATION_SCHEMA,
      purpose: 'new-capture',
      operationId: 'operation-' + suffix,
      attemptId: 'attempt-' + suffix,
      captureId: 'capture-' + provider + '-' + suffix,
      admission: { provider, conversationId, conversationKey },
      sourceSelection: { catalogSha256: plan.plan.catalogSha256 },
      destinations: plan.plan.destinations,
      completenessPolicy: STRICT_COMPLETENESS,
    },
  });
}
export async function command(
  plan: AdmittedBaselinePlan,
  checkpoint: ProviderBaselineCheckpoint,
  fields: Record<string, unknown>,
  now = checkpoint.observedAt + 1
) {
  return reduceProviderBaselineCheckpoint(
    plan,
    checkpoint,
    { ...fields, expectedRevision: checkpoint.revision, now } as ProviderCheckpointCommand,
    dependencies()
  );
}
export async function linked(
  plan: AdmittedBaselinePlan,
  checkpoint: ProviderBaselineCheckpoint,
  record = reserved(plan),
  ordinal = 0
) {
  return command(plan, checkpoint, { kind: 'observe-operation', itemOrdinal: ordinal, record });
}
export async function observed(
  record: OperationRecord,
  kind: 'consistent' | 'insufficient' | 'conflict' | 'rejected' = 'insufficient'
): Promise<OperationRecord> {
  const operation = record.operation;
  const provider = operation.admission.provider;
  const commitment = (relativePath: string) => ({
    relativePath,
    byteLength: 2,
    sha256: hash(new TextEncoder().encode('{}')),
  });
  const raw = commitment('raw.json'),
    manifest = commitment('manifest.json'),
    canonical = commitment('canonical.json');
  const receipts =
    kind === 'insufficient'
      ? []
      : [
          {
            schema: provider === 'chatgpt' ? CHATGPT_PRODUCER_SCHEMA : CLAUDE_PRODUCER_SCHEMA,
            provider,
            conversationId: operation.admission.conversationId,
            captureId:
              kind === 'conflict' ? 'capture-' + provider + '-foreign' : operation.captureId,
            legacyRoutingDigest: hash(new TextEncoder().encode(operation.admission.conversationId)),
            requestedDestinations: ['file'],
            destination: 'file',
            raw,
            manifest,
            canonical,
            intent: {
              ...operation.admission,
              operationId: operation.operationId,
              attemptId: operation.attemptId,
              captureId: operation.captureId,
              catalogSha256: operation.sourceSelection.catalogSha256,
              requiredDestinations: ['file'],
            },
            completeness: {
              graph: 'complete',
              messages: 'complete',
              branches: 'complete',
              assets: 'complete',
            },
            assets: [],
            observations: [raw, manifest, canonical].map(commitment => ({
              destination: 'file',
              commitment,
              observation: {
                kind: 'browser-download-complete-path-confirmed',
                observedRelativePath: commitment.relativePath,
              },
            })),
          },
        ];
  const hashOutcome = kind === 'rejected' ? 'failed' : 'available';
  const digest =
    kind === 'rejected'
      ? () => {
          throw new Error('synthetic');
        }
      : sha256;
  const adaptation =
    provider === 'chatgpt'
      ? await adaptChatGptProducerEvidence(operation, receipts as ChatGptProducerReceipt[], digest)
      : await adaptClaudeProducerEvidence(operation, receipts as ClaudeProducerReceipt[], digest);
  return snapshotRecord({
    ...record,
    revision: record.revision + 1,
    phase: 'awaiting-resolution',
    observation: {
      provider,
      adapterVersion: provider === 'chatgpt' ? CHATGPT_ADAPTER_VERSION : CLAUDE_ADAPTER_VERSION,
      hashOutcome,
      receipts,
      adaptation,
    },
  });
}
