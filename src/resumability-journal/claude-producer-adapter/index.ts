/** Unwired, capability-free adapter. Consistency is not provenance authentication or settlement. */
import {
  admitNewCaptureOperation,
  assessNewCaptureEvidence,
  EVIDENCE_SCHEMA,
  FILE_ASSURANCE,
  FILE_PATH_BASIS,
  OBSIDIAN_ASSURANCE,
  STRICT_COMPLETENESS,
  type ArtifactObservation,
  type CaptureBinding,
  type DestinationEvidence,
  type EvidenceAssessment,
  type NewCaptureEvidence,
  type NewCaptureOperation,
} from '../purpose';
import {
  CLAUDE_PRODUCER_SCHEMA,
  snapshotClaudeProducerReceipt,
  type ClaudeProducerReceipt,
} from '../../lib/claude-producer-evidence';
import type { ProducerArtifactObservation } from '../../lib/chatgpt-producer-evidence';
import {
  detachProducerData,
  freezeProducerData,
  producerList,
} from '../../lib/producer-evidence-data';
import { conversationKeyInput } from '../../archive/catalog/conversation-key';

/** Structurally the same pure result as the existing ChatGPT adapter; no dependency on it. */
export interface ProducerAdaptation {
  readonly evidence?: NewCaptureEvidence;
  readonly assessment: EvidenceAssessment;
  readonly adapterCode?:
    | 'unsupported-producer-receipt'
    | 'invalid-producer-evidence'
    | 'hash-failed'
    | 'identity-conflict'
    | 'destination-conflict';
}
export type ProducerSha256 = (bytes: Uint8Array) => string | Promise<string>;
const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
function binding(receipt: ClaudeProducerReceipt): CaptureBinding | undefined {
  const value = receipt.intent;
  return (
    value && {
      purpose: 'new-capture',
      operationId: value.operationId,
      attemptId: value.attemptId,
      captureId: receipt.captureId,
      admission: {
        provider: receipt.provider,
        conversationId: receipt.conversationId,
        conversationKey: value.conversationKey,
      },
      sourceSelection: { catalogSha256: value.catalogSha256 },
    }
  );
}
function observation(item: ProducerArtifactObservation): ArtifactObservation {
  const fact = item.observation;
  return {
    commitment: item.commitment,
    ...(fact?.kind === FILE_ASSURANCE && {
      file: {
        basis: FILE_PATH_BASIS,
        state: 'complete' as const,
        observedRelativePath: fact.observedRelativePath,
      },
    }),
    ...(fact?.kind === OBSIDIAN_ASSURANCE && {
      readback: { byteLength: fact.byteLength, sha256: fact.sha256 },
    }),
  };
}
function destination(receipt: ClaudeProducerReceipt): DestinationEvidence {
  const bound = binding(receipt);
  const state = (value: string) =>
    value === 'complete' || value === 'partial' ? value : 'unknown';
  return {
    destination: receipt.destination,
    raw: receipt.raw,
    manifest: receipt.manifest,
    canonical: receipt.canonical,
    completeness: {
      policy: STRICT_COMPLETENESS,
      graph: state(receipt.completeness.graph),
      messages: state(receipt.completeness.messages),
      branches: state(receipt.completeness.branches),
      assetInventory: state(receipt.completeness.assets),
    },
    assets: receipt.assets.map(asset => ({
      assetId: asset.assetId,
      state:
        asset.state === 'fetched'
          ? 'fetched'
          : asset.state === 'not-attempted'
            ? 'unknown'
            : 'missing',
      ...(asset.commitment && { commitment: asset.commitment }),
    })),
    assurance: {
      kind: receipt.destination === 'file' ? FILE_ASSURANCE : OBSIDIAN_ASSURANCE,
      destination: receipt.destination,
      ...(bound && { binding: bound }),
      manifest: receipt.manifest,
      artifacts: receipt.observations.map(observation),
    },
  };
}
function identityMatches(receipt: ClaudeProducerReceipt, operation: NewCaptureOperation): boolean {
  const intent = receipt.intent;
  return (
    receipt.provider === operation.admission.provider &&
    receipt.conversationId === operation.admission.conversationId &&
    receipt.captureId === operation.captureId &&
    (!intent ||
      (intent.provider === receipt.provider &&
        intent.conversationId === receipt.conversationId &&
        intent.captureId === receipt.captureId &&
        intent.operationId === operation.operationId &&
        intent.attemptId === operation.attemptId &&
        intent.conversationKey === operation.admission.conversationKey &&
        intent.catalogSha256 === operation.sourceSelection.catalogSha256))
  );
}
function conflict(code: 'identity-conflict' | 'destination-conflict'): ProducerAdaptation {
  return freezeProducerData({ adapterCode: code, assessment: { kind: 'conflict', codes: [code] } });
}
function rejected(code: 'invalid-producer-evidence' | 'hash-failed'): ProducerAdaptation {
  return freezeProducerData({
    adapterCode: code,
    assessment: { kind: 'rejected', codes: ['invalid-evidence'] },
  });
}

/** Explicit pre-write intent is required for consistency; legacy/manual facts are never promoted. */
// eslint-disable-next-line max-lines-per-function, complexity -- Snapshot, await hash and relational assessment form one bounded adapter transaction.
export async function adaptClaudeProducerEvidence(
  operationValue: unknown,
  receiptValues: unknown,
  sha256: ProducerSha256
): Promise<ProducerAdaptation> {
  let operation: NewCaptureOperation;
  let receipts: readonly ClaudeProducerReceipt[];
  try {
    operation = admitNewCaptureOperation(operationValue);
    if (operation.admission.provider !== 'claude') return rejected('invalid-producer-evidence');
    const values = producerList(detachProducerData(receiptValues), 2);
    if (
      values.some(
        value =>
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          value.schema !== CLAUDE_PRODUCER_SCHEMA
      )
    )
      return freezeProducerData({
        adapterCode: 'unsupported-producer-receipt',
        assessment: assessNewCaptureEvidence(operation),
      });
    receipts = freezeProducerData(values.map(snapshotClaudeProducerReceipt));
  } catch {
    return rejected('invalid-producer-evidence');
  }
  let hash: string;
  let legacyHash: string;
  try {
    hash = await sha256(
      conversationKeyInput(operation.admission.provider, operation.admission.conversationId)
    );
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/u.test(hash)) return rejected('hash-failed');
    legacyHash = await sha256(new TextEncoder().encode(operation.admission.conversationId));
    if (typeof legacyHash !== 'string' || !/^[a-f0-9]{64}$/u.test(legacyHash))
      return rejected('hash-failed');
  } catch {
    return rejected('hash-failed');
  }
  if (operation.admission.conversationKey !== `liska-conversation-key/1:${hash}`)
    return conflict('identity-conflict');
  const required = operation.destinations.map(value => value.destination);
  for (const receipt of receipts) {
    if (!identityMatches(receipt, operation) || receipt.legacyRoutingDigest !== legacyHash)
      return conflict('identity-conflict');
    if (
      !same(receipt.requestedDestinations, required) ||
      (receipt.intent && !same(receipt.intent.requiredDestinations, required)) ||
      receipt.observations.some(item => item.destination !== receipt.destination)
    )
      return conflict('destination-conflict');
  }
  if (receipts.length > 1 && !same(receipts[0].raw, receipts[1].raw))
    return freezeProducerData({ assessment: { kind: 'conflict', codes: ['commitment-conflict'] } });
  const bound = receipts[0] && binding(receipts[0]);
  const evidence: NewCaptureEvidence = freezeProducerData({
    schema: EVIDENCE_SCHEMA,
    ...(bound && { binding: bound }),
    destinations: receipts.map(destination),
  });
  return freezeProducerData({
    evidence,
    assessment: assessNewCaptureEvidence(operation, evidence),
  });
}
