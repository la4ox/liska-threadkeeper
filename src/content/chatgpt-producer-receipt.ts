import type { RawCaptureManifest } from '../archive/capture';
import type { ArchiveCompanionBundle, StagedBinaryAssetResult } from '../lib/types';
import {
  CHATGPT_PRODUCER_SCHEMA,
  observeProducerArtifact,
  producerCommitment,
  snapshotProducerObservations,
  snapshotChatGptProducerReceipt,
  type ChatGptProducerIntent,
  type ChatGptProducerReceipt,
  type ProducerArtifactObservation,
  type ProducerDestination,
} from '../lib/chatgpt-producer-evidence';

/** Facts come from the exact serialized destination manifest and earlier/later sink results. */
export function buildChatGptProducerReceipt(
  companion: ArchiveCompanionBundle,
  manifest: RawCaptureManifest,
  destination: ProducerDestination,
  requestedDestinations: readonly ProducerDestination[],
  rawObservations: readonly ProducerArtifactObservation[],
  binaryObservations: readonly ProducerArtifactObservation[],
  intent?: ChatGptProducerIntent
): ChatGptProducerReceipt {
  if (companion.captureId !== manifest.captureId) throw new Error('invalid-producer-evidence');
  const artifact = (kind: 'raw' | 'manifest' | 'canonical') => {
    const values = companion.artifacts.filter(item => item.kind === kind);
    if (values.length !== 1) throw new Error('invalid-producer-evidence');
    return producerCommitment(values[0]);
  };
  const observations = [...rawObservations, ...binaryObservations].filter(
    item => item.destination === destination
  );
  if (rawObservations.some(item => item.commitment.relativePath !== artifact('raw').relativePath))
    throw new Error('invalid-producer-evidence');
  return snapshotChatGptProducerReceipt({
    schema: CHATGPT_PRODUCER_SCHEMA,
    provider: manifest.provider,
    conversationId: manifest.conversationId,
    captureId: manifest.captureId,
    legacyRoutingDigest: companion.conversationKey,
    requestedDestinations: [...requestedDestinations],
    destination,
    ...(intent && { intent }),
    raw: artifact('raw'),
    manifest: artifact('manifest'),
    canonical: artifact('canonical'),
    completeness: { ...manifest.completeness },
    assets: manifest.assets.map(record => ({
      assetId: record.id,
      state: record.state,
      ...(record.relativePath !== null &&
        record.byteLength !== null &&
        record.sha256 !== null && {
          commitment: {
            relativePath: record.relativePath,
            byteLength: record.byteLength,
            sha256: record.sha256,
          },
        }),
    })),
    observations,
  });
}

/** Consume only the already detached persistence results, before destination construction. */
export function snapshotChatGptBinaryObservations(
  results: readonly StagedBinaryAssetResult[]
): readonly ProducerArtifactObservation[] {
  const observations: ProducerArtifactObservation[] = [];
  for (const result of results) {
    if (!result.descriptor) continue;
    for (const output of result.results) {
      if (output.destination === 'file' || output.destination === 'obsidian')
        observations.push(observeProducerArtifact(output.destination, result.descriptor, output));
    }
  }
  return snapshotProducerObservations(observations);
}

/** Finalization cannot supply or replace the earlier raw/binary observations. */
export function completeChatGptProducerReceipt(
  receipt: ChatGptProducerReceipt,
  input: unknown
): ChatGptProducerReceipt {
  const observations = snapshotProducerObservations(input);
  if (
    observations.some(
      item =>
        item.destination !== receipt.destination ||
        ![receipt.manifest.relativePath, receipt.canonical.relativePath].includes(
          item.commitment.relativePath
        )
    )
  )
    throw new Error('invalid-producer-evidence');
  return snapshotChatGptProducerReceipt({
    ...receipt,
    observations: [...receipt.observations, ...observations],
  });
}
