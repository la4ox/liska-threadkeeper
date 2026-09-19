/** Destination-honest optional DeepSeek attachment export. */

import {
  buildCaptureManifest,
  normalizeDeepSeekCapture,
  preflightDeepSeekHistoryArtifact,
  validateCaptureBundleShape,
  verifyCaptureBundleIntegrity,
  type RawCaptureArtifact,
  type RawCaptureAsset,
  type RawCaptureAssetRecord,
  type RawCaptureBundle,
} from '../archive';
import { bytesToBase64 } from '../lib/image-utils';
import {
  ARCHIVE_COMPANION_RELATIVE_PATHS,
  type ArchiveCompanionArtifact,
  type ArchiveCompanionBundle,
  type ArchiveCompanionKind,
  type DeepSeekAssetExportContext,
  type InlineArchiveCompanionArtifact,
  type OutputDestination,
  type PersistentOutputDestination,
  type StagedBinaryAssetDescriptor,
  type StagedBinaryAssetResult,
} from '../lib/types';
import {
  acquireDeepSeekSignedAssets,
  type DeepSeekAssetAcquisition,
} from './capture/deepseek-asset-acquisition';
import { deriveDeepSeekAssetCandidates } from './capture/deepseek-asset-resolver';
import { appendJsonCanonicalCompanion } from './capture/json-archive-companion';
import { hashCaptureManifest, sha256Hex } from './capture/response';
import { persistVerifiedBinaryAssets } from './staged-binary-persistence';
import { DEEPSEEK_ASSETS_NOT_ATTEMPTED_WARNING } from './extractors/deepseek-api';

const ARTIFACT_ID = 'conversation';
const ARTIFACT_PATH = 'responses/conversation.json';

export const DEEPSEEK_ASSET_BINDING_FAILED_WARNING =
  'DeepSeek attachment export could not verify the original capture; attachments were not exported.';
export const DEEPSEEK_ASSET_RAW_PERSISTENCE_FAILED_WARNING =
  'DeepSeek original raw archive companion could not be saved.';
export const DEEPSEEK_ASSET_FETCH_FAILURE_WARNING =
  'One or more DeepSeek attachments could not be fetched; the archive manifest records the failures.';
export const DEEPSEEK_ASSET_UNRESOLVED_WARNING =
  'Some DeepSeek attachments had no valid current signed path and remain not attempted.';
export const DEEPSEEK_ASSET_FINALIZATION_FAILED_WARNING =
  'DeepSeek attachment archive finalization failed; the original raw capture remains available.';
export const DEEPSEEK_ASSET_DESTINATION_WRITE_FAILED_DETAIL = 'deepseek-destination-write-failed';

export interface ArchiveCompanionPersistenceOutcome {
  activeOutputs: PersistentOutputDestination[];
  warnings: string[];
}

export interface DeepSeekAssetExportDependencies {
  persistArtifacts: (
    companion: ArchiveCompanionBundle,
    noteFileName: string,
    source: 'deepseek',
    outputs: OutputDestination[],
    artifactKinds: readonly ArchiveCompanionKind[]
  ) => Promise<ArchiveCompanionPersistenceOutcome>;
  deriveCandidates?: typeof deriveDeepSeekAssetCandidates;
  acquireAssets?: typeof acquireDeepSeekSignedAssets;
  persistBinaryAssets?: typeof persistVerifiedBinaryAssets;
  buildDestinationCompanion?: typeof buildDeepSeekBinaryAwareArchiveCompanion;
}

export interface DeepSeekAssetExportResult {
  rawSuccessfulDestinations: PersistentOutputDestination[];
  completeDestinations: PersistentOutputDestination[];
  warnings: string[];
}

function cloneRecord(record: RawCaptureAssetRecord): RawCaptureAssetRecord {
  return { ...record, sourceRefs: record.sourceRefs.map(sourceRef => ({ ...sourceRef })) };
}

function persistentOutputs(outputs: readonly OutputDestination[]): PersistentOutputDestination[] {
  return outputs.filter(
    (output): output is PersistentOutputDestination => output === 'file' || output === 'obsidian'
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function sameArchiveTransport(
  left: ArchiveCompanionArtifact,
  right: ArchiveCompanionArtifact
): boolean {
  if (left.transport !== right.transport) return false;
  return left.transport === 'inline'
    ? right.transport === 'inline' && left.bodyBase64 === right.bodyBase64
    : right.transport === 'staged' && left.stageId === right.stageId;
}

/** Verify the immutable runtime context before any durable write. */
// eslint-disable-next-line complexity -- Raw identity, endpoint, descriptor, transport, and byte integrity are one indivisible trust check.
export async function verifyDeepSeekAssetExportContext(
  context: DeepSeekAssetExportContext
): Promise<RawCaptureArtifact> {
  const bundle = context.rawCaptureBundle;
  if (
    bundle.manifest.provider !== 'deepseek' ||
    bundle.artifacts.length !== 1 ||
    bundle.assets.length !== 0 ||
    bundle.manifest.assets.some(asset => asset.state !== 'not-attempted')
  ) {
    throw new Error('deepseek asset context identity');
  }
  validateCaptureBundleShape(bundle);
  await verifyCaptureBundleIntegrity(bundle, sha256Hex);
  const raw = bundle.artifacts[0];
  if (
    raw.record.id !== ARTIFACT_ID ||
    raw.record.relativePath !== ARTIFACT_PATH ||
    raw.record.endpoint.method !== 'GET' ||
    raw.record.endpoint.pathPattern !== '/api/v0/chat/history_messages' ||
    context.rawArtifact.kind !== 'raw' ||
    context.rawArtifact.relativePath !== raw.record.relativePath ||
    context.rawArtifact.mediaType !== raw.record.mediaType ||
    context.rawArtifact.byteLength !== raw.record.byteLength ||
    context.rawArtifact.sha256 !== raw.record.sha256 ||
    (context.rawArtifact.transport === 'inline' &&
      !bytesEqual(
        raw.bytes,
        Uint8Array.from(atob(context.rawArtifact.bodyBase64), char => char.charCodeAt(0))
      ))
  ) {
    throw new Error('deepseek asset context raw binding');
  }
  preflightDeepSeekHistoryArtifact(raw.bytes, bundle.manifest.conversationId);
  return raw;
}

/** Bind capture ID, opaque conversation key, raw transport, and initial manifest. */
// eslint-disable-next-line complexity -- The pre-write companion binding intentionally checks every immutable field in one boundary.
export async function validateDeepSeekAssetExportBinding(
  context: DeepSeekAssetExportContext,
  companion: ArchiveCompanionBundle
): Promise<boolean> {
  try {
    const raw = await verifyDeepSeekAssetExportContext(context);
    const expectedConversationKey = await sha256Hex(
      new TextEncoder().encode(context.rawCaptureBundle.manifest.conversationId)
    );
    const rawArtifacts = companion.artifacts.filter(artifact => artifact.kind === 'raw');
    const manifests = companion.artifacts.filter(artifact => artifact.kind === 'manifest');
    if (
      companion.captureId !== context.rawCaptureBundle.manifest.captureId ||
      companion.conversationKey !== expectedConversationKey ||
      rawArtifacts.length !== 1 ||
      manifests.length !== 1
    ) {
      return false;
    }
    const companionRaw = rawArtifacts[0];
    const contextRaw = context.rawArtifact;
    const manifestBytes = new TextEncoder().encode(
      JSON.stringify(context.rawCaptureBundle.manifest, null, 2)
    );
    const manifest = manifests[0];
    return (
      companionRaw.relativePath === raw.record.relativePath &&
      companionRaw.mediaType === raw.record.mediaType &&
      companionRaw.byteLength === raw.record.byteLength &&
      companionRaw.sha256 === raw.record.sha256 &&
      sameArchiveTransport(companionRaw, contextRaw) &&
      manifest.transport === 'inline' &&
      manifest.relativePath === ARCHIVE_COMPANION_RELATIVE_PATHS.manifest &&
      manifest.mediaType === 'application/json' &&
      manifest.byteLength === manifestBytes.byteLength &&
      manifest.sha256 === (await sha256Hex(manifestBytes)) &&
      bytesEqual(
        manifestBytes,
        Uint8Array.from(atob(manifest.bodyBase64), char => char.charCodeAt(0))
      )
    );
  } catch {
    return false;
  }
}

function destinationAssetCompleteness(
  original: RawCaptureBundle['manifest']['completeness']['assets'],
  assets: readonly RawCaptureAssetRecord[]
): RawCaptureBundle['manifest']['completeness']['assets'] {
  if (original === 'unknown') return 'unknown';
  if (assets.every(asset => asset.state === 'not-attempted')) return 'not-attempted';
  return assets.every(asset => asset.state !== 'not-attempted') ? 'complete' : 'partial';
}

async function inlineJsonArtifact(
  kind: InlineArchiveCompanionArtifact['kind'],
  relativePath: string,
  value: unknown
): Promise<InlineArchiveCompanionArtifact> {
  const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2));
  return {
    transport: 'inline',
    kind,
    relativePath,
    mediaType: 'application/json',
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    bodyBase64: bytesToBase64(bytes),
  };
}

/** Rebuild one destination only from bytes that actually succeeded there. */
// eslint-disable-next-line max-lines-per-function -- Manifest overlay, runtime-byte verification, normalization, and companion rebuild stay in evidence order.
export async function buildDeepSeekBinaryAwareArchiveCompanion(
  context: DeepSeekAssetExportContext,
  assetRecords: readonly RawCaptureAssetRecord[],
  runtimeAssets: readonly RawCaptureAsset[]
): Promise<ArchiveCompanionBundle> {
  const originalRaw = await verifyDeepSeekAssetExportContext(context);
  const originalManifest = context.rawCaptureBundle.manifest;
  const warnings = originalManifest.warnings.filter(
    warning =>
      warning !== DEEPSEEK_ASSETS_NOT_ATTEMPTED_WARNING ||
      assetRecords.every(asset => asset.state === 'not-attempted')
  );
  if (assetRecords.some(asset => asset.state === 'failed')) {
    warnings.push(DEEPSEEK_ASSET_FETCH_FAILURE_WARNING);
  }
  if (assetRecords.some(asset => asset.state === 'not-attempted')) {
    warnings.push(DEEPSEEK_ASSET_UNRESOLVED_WARNING);
  }
  const manifest = buildCaptureManifest({
    captureId: originalManifest.captureId,
    provider: originalManifest.provider,
    conversationId: originalManifest.conversationId,
    capturedAt: originalManifest.capturedAt,
    method: originalManifest.method,
    artifacts: originalManifest.artifacts,
    assets: assetRecords.map(cloneRecord),
    completeness: {
      ...originalManifest.completeness,
      assets: destinationAssetCompleteness(originalManifest.completeness.assets, assetRecords),
    },
    warnings: [...new Set(warnings)],
    observedUnknownContentTypes: originalManifest.observedUnknownContentTypes,
  });
  const byId = new Map(manifest.assets.map(asset => [asset.id, asset]));
  const bundle: RawCaptureBundle = {
    manifest,
    artifacts: [{ record: manifest.artifacts[0], bytes: originalRaw.bytes }],
    assets: runtimeAssets.map(runtime => {
      const record = byId.get(runtime.record.id);
      if (!record) throw new Error('unknown DeepSeek runtime asset');
      return { record, bytes: runtime.bytes };
    }),
  };
  validateCaptureBundleShape(bundle);
  await verifyCaptureBundleIntegrity(bundle, sha256Hex);
  const normalized = await normalizeDeepSeekCapture({
    bundle,
    artifactId: ARTIFACT_ID,
    manifestSha256: await hashCaptureManifest(manifest),
    sha256: sha256Hex,
  });
  const rawManifest: ArchiveCompanionBundle = {
    captureId: manifest.captureId,
    conversationKey: await sha256Hex(new TextEncoder().encode(manifest.conversationId)),
    artifacts: [
      { ...context.rawArtifact },
      await inlineJsonArtifact('manifest', ARCHIVE_COMPANION_RELATIVE_PATHS.manifest, manifest),
    ],
  };
  return appendJsonCanonicalCompanion(rawManifest, normalized.archive, sha256Hex, 'deepseek');
}

function recordsMatch(record: RawCaptureAssetRecord, runtime: RawCaptureAsset): boolean {
  return (
    runtime.record.id === record.id &&
    runtime.record.relativePath === record.relativePath &&
    runtime.record.mediaType === record.mediaType &&
    runtime.record.byteLength === record.byteLength &&
    runtime.record.sha256 === record.sha256
  );
}

function descriptorMatches(
  descriptor: StagedBinaryAssetDescriptor,
  runtime: RawCaptureAsset
): boolean {
  return (
    descriptor.assetId === runtime.record.id &&
    descriptor.relativePath === runtime.record.relativePath &&
    descriptor.mediaType === runtime.record.mediaType &&
    descriptor.byteLength === runtime.record.byteLength &&
    descriptor.sha256 === runtime.record.sha256
  );
}

function destinationSucceeded(
  record: RawCaptureAssetRecord,
  runtime: RawCaptureAsset,
  destination: PersistentOutputDestination,
  binaryResults: readonly StagedBinaryAssetResult[]
): boolean {
  const matching = binaryResults.filter(result => result.assetId === record.id);
  if (matching.length !== 1 || !matching[0].descriptor) return false;
  const destinations = matching[0].results.filter(result => result.destination === destination);
  return (
    destinations.length === 1 &&
    destinations[0].success &&
    recordsMatch(record, runtime) &&
    descriptorMatches(matching[0].descriptor, runtime)
  );
}

function destinationAssets(
  acquisition: DeepSeekAssetAcquisition,
  binaryResults: readonly StagedBinaryAssetResult[],
  destination: PersistentOutputDestination
): { records: RawCaptureAssetRecord[]; runtimeAssets: RawCaptureAsset[]; binaryFailed: boolean } {
  const runtimes = new Map(acquisition.runtimeAssets.map(asset => [asset.record.id, asset]));
  const records: RawCaptureAssetRecord[] = [];
  const runtimeAssets: RawCaptureAsset[] = [];
  let binaryFailed = false;
  for (const record of acquisition.records) {
    const runtime = runtimes.get(record.id);
    if (record.state !== 'fetched') {
      records.push(cloneRecord(record));
    } else if (runtime && destinationSucceeded(record, runtime, destination, binaryResults)) {
      records.push(cloneRecord(record));
      runtimeAssets.push({ record: cloneRecord(record), bytes: runtime.bytes });
    } else {
      records.push({
        ...cloneRecord(record),
        state: 'failed',
        relativePath: null,
        mediaType: null,
        byteLength: null,
        sha256: null,
        detail: DEEPSEEK_ASSET_DESTINATION_WRITE_FAILED_DETAIL,
      });
      binaryFailed = true;
    }
  }
  return { records, runtimeAssets, binaryFailed };
}

async function acquireAssets(
  context: DeepSeekAssetExportContext,
  dependencies: DeepSeekAssetExportDependencies
): Promise<DeepSeekAssetAcquisition> {
  const candidates = await (dependencies.deriveCandidates ?? deriveDeepSeekAssetCandidates)(
    context.rawCaptureBundle
  );
  return (dependencies.acquireAssets ?? acquireDeepSeekSignedAssets)({
    assets: context.rawCaptureBundle.manifest.assets,
    candidates,
  });
}

async function persistBinaries(
  companion: ArchiveCompanionBundle,
  acquisition: DeepSeekAssetAcquisition,
  outputs: PersistentOutputDestination[],
  dependencies: DeepSeekAssetExportDependencies
): Promise<StagedBinaryAssetResult[]> {
  if (acquisition.runtimeAssets.length === 0) return [];
  return (dependencies.persistBinaryAssets ?? persistVerifiedBinaryAssets)({
    source: 'deepseek',
    captureId: companion.captureId,
    conversationKey: companion.conversationKey,
    assets: acquisition.runtimeAssets,
    outputs,
  });
}

/** Raw first, one bounded acquisition pass, then destination-specific manifest/canonical. */
// eslint-disable-next-line max-lines-per-function -- The durable ordering and per-destination evidence stay explicit at this trust boundary.
export async function persistDeepSeekDestinationHonestAttachments(
  context: DeepSeekAssetExportContext,
  companion: ArchiveCompanionBundle,
  noteFileName: string,
  outputs: OutputDestination[],
  dependencies: DeepSeekAssetExportDependencies
): Promise<DeepSeekAssetExportResult> {
  const requested = persistentOutputs(outputs);
  if (requested.length === 0) {
    return { rawSuccessfulDestinations: [], completeDestinations: [], warnings: [] };
  }
  if (!(await validateDeepSeekAssetExportBinding(context, companion))) {
    return {
      rawSuccessfulDestinations: [],
      completeDestinations: [],
      warnings: [DEEPSEEK_ASSET_BINDING_FAILED_WARNING],
    };
  }

  let rawOutcome: ArchiveCompanionPersistenceOutcome;
  try {
    rawOutcome = await dependencies.persistArtifacts(
      companion,
      noteFileName,
      'deepseek',
      requested,
      ['raw']
    );
  } catch {
    return {
      rawSuccessfulDestinations: [],
      completeDestinations: [],
      warnings: [DEEPSEEK_ASSET_RAW_PERSISTENCE_FAILED_WARNING],
    };
  }
  const rawSuccessfulDestinations = rawOutcome.activeOutputs;
  const warnings = [...rawOutcome.warnings];
  if (rawSuccessfulDestinations.length === 0) {
    return { rawSuccessfulDestinations, completeDestinations: [], warnings };
  }

  let acquisition: DeepSeekAssetAcquisition;
  try {
    acquisition = await acquireAssets(context, dependencies);
  } catch {
    acquisition = {
      records: context.rawCaptureBundle.manifest.assets.map(cloneRecord),
      runtimeAssets: [],
      completeness: context.rawCaptureBundle.manifest.completeness.assets,
    };
    warnings.push(DEEPSEEK_ASSET_FETCH_FAILURE_WARNING);
  }
  if (acquisition.records.some(record => record.state === 'failed')) {
    warnings.push(DEEPSEEK_ASSET_FETCH_FAILURE_WARNING);
  }
  if (acquisition.records.some(record => record.state === 'not-attempted')) {
    warnings.push(DEEPSEEK_ASSET_UNRESOLVED_WARNING);
  }
  let binaryResults: StagedBinaryAssetResult[] = [];
  try {
    binaryResults = await persistBinaries(
      companion,
      acquisition,
      rawSuccessfulDestinations,
      dependencies
    );
  } catch {
    // Destination finalization below converts every fetched claim to a failed write.
  }

  const completeDestinations: PersistentOutputDestination[] = [];
  for (const destination of rawSuccessfulDestinations) {
    const destinationState = destinationAssets(acquisition, binaryResults, destination);
    if (destinationState.binaryFailed) {
      warnings.push(
        `One or more DeepSeek attachments were not saved to ${destination}; the archive manifest records them as failed.`
      );
    }
    try {
      const destinationCompanion = await (
        dependencies.buildDestinationCompanion ?? buildDeepSeekBinaryAwareArchiveCompanion
      )(context, destinationState.records, destinationState.runtimeAssets);
      const outcome = await dependencies.persistArtifacts(
        destinationCompanion,
        noteFileName,
        'deepseek',
        [destination],
        ['manifest', 'canonical']
      );
      warnings.push(...outcome.warnings);
      if (outcome.activeOutputs.includes(destination)) completeDestinations.push(destination);
    } catch {
      warnings.push(DEEPSEEK_ASSET_FINALIZATION_FAILED_WARNING);
    }
  }
  return {
    rawSuccessfulDestinations,
    completeDestinations,
    warnings: [...new Set(warnings)],
  };
}
