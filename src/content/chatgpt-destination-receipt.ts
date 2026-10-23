/** Destination-specific reconciliation and safe snapshots for ChatGPT archives. */
import type { RawCaptureAsset, RawCaptureAssetRecord } from '../archive';
import {
  snapshotChatGptDestinationArchiveReceipt,
  type ChatGptDestinationArchiveReceipt,
} from '../lib/chatgpt-archive-receipt';
import {
  ARCHIVE_COMPANION_RELATIVE_PATHS,
  type ArchiveCompanionBundle,
  type PersistentOutputDestination,
  type StagedBinaryAssetDescriptor,
  type StagedBinaryAssetResult,
} from '../lib/types';

export const CHATGPT_ASSET_DESTINATION_WRITE_FAILED_DETAIL = 'destination-write-failed';

interface AcquiredAssets {
  records: readonly RawCaptureAssetRecord[];
  runtimeAssets: readonly RawCaptureAsset[];
}

interface DestinationAssetState {
  records: RawCaptureAssetRecord[];
  runtimeAssets: RawCaptureAsset[];
  binaryFailed: boolean;
}

function cloneRecord(record: RawCaptureAssetRecord): RawCaptureAssetRecord {
  return { ...record, sourceRefs: record.sourceRefs.map(sourceRef => ({ ...sourceRef })) };
}

function destinationWriteFailure(record: RawCaptureAssetRecord): RawCaptureAssetRecord {
  return {
    ...cloneRecord(record),
    state: 'failed',
    relativePath: null,
    byteLength: null,
    sha256: null,
    detail: CHATGPT_ASSET_DESTINATION_WRITE_FAILED_DETAIL,
  };
}

function recordsMatch(
  expected: Pick<
    RawCaptureAssetRecord,
    'id' | 'relativePath' | 'sha256' | 'byteLength' | 'mediaType'
  >,
  actual: Pick<RawCaptureAssetRecord, 'id' | 'relativePath' | 'sha256' | 'byteLength' | 'mediaType'>
): boolean {
  return (
    expected.id === actual.id &&
    expected.relativePath === actual.relativePath &&
    expected.sha256 === actual.sha256 &&
    expected.byteLength === actual.byteLength &&
    expected.mediaType === actual.mediaType
  );
}

function descriptorMatchesRuntime(
  descriptor: StagedBinaryAssetDescriptor,
  runtime: RawCaptureAsset
): boolean {
  return (
    descriptor.assetId === runtime.record.id &&
    descriptor.relativePath === runtime.record.relativePath &&
    descriptor.sha256 === runtime.record.sha256 &&
    descriptor.byteLength === runtime.record.byteLength &&
    descriptor.mediaType === runtime.record.mediaType
  );
}

function hasExactSuccessfulDestination(
  result: StagedBinaryAssetResult,
  destination: PersistentOutputDestination
): boolean {
  const destinationResults = result.results.filter(item => item.destination === destination);
  return destinationResults.length === 1 && destinationResults[0].success;
}

function binarySucceeded(
  record: RawCaptureAssetRecord,
  runtime: RawCaptureAsset,
  destination: PersistentOutputDestination,
  results: readonly StagedBinaryAssetResult[]
): boolean {
  const matching = results.filter(result => result.assetId === record.id);
  const descriptor = matching[0]?.descriptor;
  return (
    matching.length === 1 &&
    descriptor !== undefined &&
    descriptorMatchesRuntime(descriptor, runtime) &&
    recordsMatch(record, runtime.record) &&
    hasExactSuccessfulDestination(matching[0], destination)
  );
}

/** Only exact runtime/descriptor matches with one successful destination remain fetched. */
export function reconcileChatGptDestinationAssets(
  acquired: AcquiredAssets,
  binaryResults: readonly StagedBinaryAssetResult[],
  destination: PersistentOutputDestination
): DestinationAssetState {
  const runtimes = new Map(acquired.runtimeAssets.map(asset => [asset.record.id, asset]));
  const records: RawCaptureAssetRecord[] = [];
  const runtimeAssets: RawCaptureAsset[] = [];
  let binaryFailed = false;

  for (const record of acquired.records) {
    const runtime = runtimes.get(record.id);
    if (record.state !== 'fetched') {
      records.push(cloneRecord(record));
      continue;
    }
    if (runtime && binarySucceeded(record, runtime, destination, binaryResults)) {
      records.push(cloneRecord(record));
      runtimeAssets.push({ record: cloneRecord(record), bytes: runtime.bytes });
      continue;
    }
    records.push(destinationWriteFailure(record));
    binaryFailed = true;
  }
  return { records, runtimeAssets, binaryFailed };
}

/** Validate and detach all receipt values before any final archive write can complete. */
export function buildChatGptDestinationArchiveReceipt(
  companion: ArchiveCompanionBundle,
  destination: PersistentOutputDestination,
  assets: readonly RawCaptureAsset[]
): ChatGptDestinationArchiveReceipt {
  const manifests = companion.artifacts.filter(artifact => artifact.kind === 'manifest');
  const manifest = manifests[0];
  if (
    manifests.length !== 1 ||
    manifest.relativePath !== ARCHIVE_COMPANION_RELATIVE_PATHS.manifest ||
    manifest.mediaType !== 'application/json'
  ) {
    throw new Error('ChatGPT final manifest artifact is invalid.');
  }
  const receipt = snapshotChatGptDestinationArchiveReceipt({
    destination,
    captureId: companion.captureId,
    conversationKey: companion.conversationKey,
    manifestSha256: manifest.sha256,
    assets: assets.map(({ record }) => {
      if (record.state !== 'fetched') throw new Error('ChatGPT finalized asset is not fetched.');
      return {
        sha256: record.sha256,
        relativePath: record.relativePath,
        mediaType: record.mediaType,
        byteLength: record.byteLength,
      };
    }),
  });
  if (!receipt) throw new Error('ChatGPT finalized archive receipt is invalid.');
  receipt.assets.sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  );
  return receipt;
}
