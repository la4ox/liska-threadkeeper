import { createHash } from 'node:crypto';
import { encodeSnapshotCatalog } from '../../../src/archive/catalog';
import { conversationKeyInput } from '../../../src/archive/catalog/conversation-key';
import { catalog as originalCatalog } from '../purpose-persistence-v2/fixtures';
import {
  FILE_ASSURANCE,
  OBSIDIAN_ASSURANCE,
  OPERATION_SCHEMA,
  STRICT_COMPLETENESS,
} from '../../../src/resumability-journal/purpose';
import {
  ADAPTER_VERSION,
  RECORD_SCHEMA,
  snapshotRecord,
  type OperationRecord,
} from '../../../src/resumability-journal/purpose-persistence-v2/core/record';
import { adaptChatGptProducerEvidence } from '../../../src/resumability-journal/producer-adapter';
import {
  CHATGPT_PRODUCER_SCHEMA,
  type ChatGptProducerReceipt,
} from '../../../src/lib/chatgpt-producer-evidence';
import {
  createBaselinePlan,
  createBaselineCheckpoint,
  reduceBaselineCheckpoint,
  type AdmittedBaselinePlan,
  type BaselineCheckpoint,
  type BaselinePlanRequest,
  type CheckpointCommand,
  type Identity,
} from '../../../src/resumability-journal/baseline-plan';

export const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const sha256 = async (bytes: Uint8Array) => hash(bytes);
export const dependencies = () => ({ sha256, signal: new AbortController().signal });
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function identity(index: number, provider = 'chatgpt'): Identity {
  const conversationId = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  return {
    provider,
    conversationId,
    conversationKey: `liska-conversation-key/1:${hash(conversationKeyInput(provider, conversationId))}`,
  };
}
export async function catalogBytes(selection: readonly Identity[]) {
  const catalog = await originalCatalog();
  const template = catalog.entries[0];
  catalog.entries = selection.map((item, index) => ({
    ...clone(template),
    ...item,
    captureId: 'previous-' + index,
    manifestSha256: hash(new TextEncoder().encode(JSON.stringify(item))),
  }));
  catalog.selectedManifestCount = selection.length;
  catalog.selectedFileCount = selection.length * template.associatedFileCount;
  return encodeSnapshotCatalog(catalog);
}
export const requirements = {
  purpose: 'new-capture' as const,
  destinations: [{ destination: 'file', assurance: FILE_ASSURANCE }],
  completenessPolicy: STRICT_COMPLETENESS,
} satisfies Omit<BaselinePlanRequest, 'selection'>;
export const bothDestinations = [
  { destination: 'file', assurance: FILE_ASSURANCE },
  { destination: 'obsidian', assurance: OBSIDIAN_ASSURANCE },
] as const;
export async function fixture(count = 3, slots = 16, selected?: readonly Identity[]) {
  const selection = selected ?? Array.from({ length: count }, (_, index) => identity(index));
  const bytes = await catalogBytes(selection);
  const plan = await createBaselinePlan(bytes, { ...requirements, selection }, dependencies());
  const checkpoint = await createBaselineCheckpoint(
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
  const admission = { provider, conversationId, conversationKey };
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
      captureId: 'capture-chatgpt-' + suffix,
      admission,
      sourceSelection: { catalogSha256: plan.plan.catalogSha256 },
      destinations: plan.plan.destinations,
      completenessPolicy: STRICT_COMPLETENESS,
    },
  });
}
export async function command(
  plan: AdmittedBaselinePlan,
  checkpoint: BaselineCheckpoint,
  fields: Omit<CheckpointCommand, 'expectedRevision' | 'now'> | Record<string, unknown>,
  now = checkpoint.observedAt + 1
) {
  return reduceBaselineCheckpoint(
    plan,
    checkpoint,
    { ...fields, expectedRevision: checkpoint.revision, now } as CheckpointCommand,
    dependencies()
  );
}
export async function linked(
  plan: AdmittedBaselinePlan,
  checkpoint: BaselineCheckpoint,
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
  const commitment = (relativePath: string) => ({
    relativePath,
    byteLength: 2,
    sha256: hash(new TextEncoder().encode('{}')),
  });
  const raw = commitment('raw.json'),
    manifest = commitment('manifest.json'),
    canonical = commitment('canonical.json');
  let receipts: readonly ChatGptProducerReceipt[] = [
    {
      schema: CHATGPT_PRODUCER_SCHEMA,
      provider: 'chatgpt',
      conversationId: operation.admission.conversationId,
      captureId: kind === 'conflict' ? 'capture-chatgpt-foreign' : operation.captureId,
      legacyRoutingDigest: hash(new TextEncoder().encode(operation.admission.conversationId)),
      requestedDestinations: ['file'],
      destination: 'file',
      raw,
      manifest,
      canonical,
      intent: {
        ...operation.admission,
        provider: 'chatgpt',
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
  if (kind === 'insufficient') receipts = [];
  const hashOutcome = kind === 'rejected' ? 'failed' : 'available';
  const adaptation = await adaptChatGptProducerEvidence(
    operation,
    receipts,
    kind === 'rejected'
      ? () => {
          throw new Error('synthetic');
        }
      : sha256
  );
  return snapshotRecord({
    ...record,
    revision: record.revision + 1,
    phase: 'awaiting-resolution',
    observation: { adapterVersion: ADAPTER_VERSION, hashOutcome, receipts, adaptation },
  });
}
