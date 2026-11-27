/** Destination-honest archive acquisition for Claude's ordinary attachments. */

import {
  buildCaptureManifest,
  verifyCaptureBundleIntegrity,
  type RawCaptureAsset,
  type RawCaptureAssetRecord,
} from '../archive';
import { normalizeClaudeCapture } from '../archive/normalizers/claude';
import {
  CLAUDE_ASSET_DETAIL,
  claudeAssetAttemptCompleteness,
  isClaudeAssetUuid,
} from '../archive/normalizers/claude/inventory';
import {
  assertProviderContentBytes,
  ProviderContentLimitError,
} from '../archive/normalizers/provider-block-work-budget';
import { bytesToBase64 } from '../lib/image-utils';
import { isSafeArchiveStageId } from '../lib/archive-stage-contract';
import {
  ARCHIVE_COMPANION_RELATIVE_PATHS,
  type ArchiveCompanionArtifact,
  type ArchiveCompanionBundle,
  type ArchiveCompanionKind,
  type ClaudeAssetExportContext,
  type OutputDestination,
  type PersistentOutputDestination,
  type StagedBinaryAssetResult,
} from '../lib/types';
import type { OperationWriteLedger } from '../lib/operation-write-ledger';
import { abortStagedArchiveArtifact } from './archive-stage';
import {
  acquireClaudeAssets,
  failedClaudeAssetRecord,
  type ClaudeAssetAcquisition,
} from './capture/claude-asset-acquisition';
import { deriveClaudeAssetCandidates } from './capture/claude-asset-resolver';
import {
  appendJsonCanonicalCompanion,
  buildJsonManifestArtifact,
} from './capture/json-archive-companion';
import { hashCaptureManifest, parseJsonArtifact, sha256Hex } from './capture/response';
import { isRecord } from '../archive/normalizers/claude/privacy';
import {
  CLAUDE_ASSETS_NOT_ATTEMPTED_WARNING,
  CLAUDE_DETAIL_ARTIFACT_ID,
  CLAUDE_DETAIL_PATH_PATTERN,
} from './extractors/claude-detail-contract';
import {
  persistVerifiedBinaryAssets,
  stagedBinaryCleanupWarnings,
} from './staged-binary-persistence';

export const CLAUDE_ASSET_BINDING_FAILED_WARNING =
  'Claude attachment export could not verify the original capture; attachment bytes were not attempted.';
export const CLAUDE_ASSET_RAW_PERSISTENCE_FAILED_WARNING =
  'Claude original raw archive companion could not be saved; attachment bytes were not attempted.';
export const CLAUDE_ASSET_FETCH_FAILURE_WARNING =
  'One or more Claude ordinary attachments could not be fetched.';
export const CLAUDE_ASSET_UNRESOLVED_WARNING =
  'Some Claude attachment records were unsupported, unresolved, or beyond export limits; their bytes were not attempted.';
export const CLAUDE_ASSET_FINALIZATION_FAILED_WARNING =
  'Claude attachment manifest or canonical archive could not be finalized for every raw-successful destination.';

export class ClaudeNavigationChangedError extends Error {
  constructor() {
    super('Claude conversation changed during export. Any output already saved was retained.');
    this.name = 'ClaudeNavigationChangedError';
  }
}

interface PersistenceOutcome {
  activeOutputs: PersistentOutputDestination[];
  warnings: string[];
}

export interface ClaudeAssetExportDependencies {
  expectedSyncSettingsSnapshot?: string;
  writeLedger?: OperationWriteLedger;
  isConversationCurrent: () => boolean;
  signal?: AbortSignal;
  persistArtifacts: (
    companion: ArchiveCompanionBundle,
    noteFileName: string,
    source: 'claude',
    outputs: OutputDestination[],
    artifactKinds: readonly ArchiveCompanionKind[],
    expectedSyncSettingsSnapshot?: string,
    writeLedger?: OperationWriteLedger,
    isOperationCurrent?: () => boolean
  ) => Promise<PersistenceOutcome>;
  acquireAssets?: typeof acquireClaudeAssets;
  persistBinaryAssets?: typeof persistVerifiedBinaryAssets;
}

export interface ClaudeAssetExportResult {
  rawSuccessfulDestinations: PersistentOutputDestination[];
  completeDestinations: PersistentOutputDestination[];
  warnings: string[];
}

function matchesArtifact(
  actual: ArchiveCompanionArtifact,
  expected: Readonly<ArchiveCompanionArtifact>
): boolean {
  return (
    actual.kind === expected.kind &&
    actual.relativePath === expected.relativePath &&
    actual.mediaType === expected.mediaType &&
    actual.byteLength === expected.byteLength &&
    actual.sha256 === expected.sha256 &&
    (actual.transport === 'inline'
      ? expected.transport === 'inline' && actual.bodyBase64 === expected.bodyBase64
      : expected.transport === 'staged' && actual.stageId === expected.stageId)
  );
}

/** Confirm exact original raw and manifest transport before any durable work. */
// eslint-disable-next-line complexity, max-lines-per-function -- Exact route, capture identity, provenance and transport are one admission boundary.
export async function verifyClaudeAssetExportBinding(
  context: ClaudeAssetExportContext,
  companion: ArchiveCompanionBundle
): Promise<boolean> {
  try {
    const { rawCaptureBundle: bundle, organizationId, conversationId, rawArtifact } = context;
    const { manifest } = bundle;
    const [raw] = bundle.artifacts;
    if (
      !isClaudeAssetUuid(organizationId) ||
      !isClaudeAssetUuid(conversationId) ||
      manifest.provider !== 'claude' ||
      manifest.method !== 'same-origin-api' ||
      manifest.conversationId !== conversationId ||
      manifest.completeness.assets !== 'not-attempted' ||
      bundle.artifacts.length !== 1 ||
      bundle.assets.length !== 0 ||
      manifest.assets.some(asset => asset.state !== 'not-attempted')
    )
      return false;
    assertProviderContentBytes('claude', raw.bytes, context.contentBudget);
    await verifyCaptureBundleIntegrity(bundle, sha256Hex);
    const detail = parseJsonArtifact(raw.bytes);
    if (!isRecord(detail) || detail.uuid !== conversationId) return false;
    if (
      raw.record.id !== CLAUDE_DETAIL_ARTIFACT_ID ||
      raw.record.relativePath !== ARCHIVE_COMPANION_RELATIVE_PATHS.raw ||
      raw.record.mediaType !== 'application/json' ||
      raw.record.endpoint?.method !== 'GET' ||
      raw.record.endpoint.pathPattern !== CLAUDE_DETAIL_PATH_PATTERN ||
      rawArtifact.kind !== 'raw' ||
      rawArtifact.relativePath !== raw.record.relativePath ||
      rawArtifact.mediaType !== raw.record.mediaType ||
      rawArtifact.byteLength !== raw.record.byteLength ||
      rawArtifact.sha256 !== raw.record.sha256 ||
      (rawArtifact.transport === 'inline'
        ? rawArtifact.bodyBase64 !== bytesToBase64(raw.bytes)
        : !isSafeArchiveStageId(rawArtifact.stageId))
    )
      return false;
    const raws = companion.artifacts.filter(artifact => artifact.kind === 'raw');
    const manifests = companion.artifacts.filter(artifact => artifact.kind === 'manifest');
    return (
      raws.length === 1 &&
      manifests.length === 1 &&
      companion.captureId === manifest.captureId &&
      companion.capturedAt === manifest.capturedAt &&
      companion.conversationKey === (await conversationKey(conversationId)) &&
      matchesArtifact(raws[0], rawArtifact) &&
      matchesArtifact(manifests[0], await buildJsonManifestArtifact(manifest, sha256Hex))
    );
  } catch (error) {
    if (error instanceof ProviderContentLimitError) throw error;
    return false;
  }
}

function conversationKey(conversationId: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(conversationId));
}

async function abortStages(companion: ArchiveCompanionBundle): Promise<void> {
  await Promise.all(
    companion.artifacts
      .filter(artifact => artifact.transport === 'staged')
      .map(artifact => abortStagedArchiveArtifact(artifact.stageId, 'claude'))
  );
}

function rethrowControlFlow(error: unknown): void {
  if (error instanceof ClaudeNavigationChangedError || error instanceof ProviderContentLimitError)
    throw error;
}

function destinationWarnings(assetRecords: readonly RawCaptureAssetRecord[]): string[] {
  const warnings: string[] = [];
  if (assetRecords.some(asset => asset.state === 'not-attempted'))
    warnings.push(CLAUDE_ASSET_UNRESOLVED_WARNING);
  if (
    assetRecords.some(
      asset =>
        asset.state === 'failed' &&
        asset.detail !== CLAUDE_ASSET_DETAIL.destinationFailed &&
        asset.detail !== CLAUDE_ASSET_DETAIL.duplicatePath
    )
  )
    warnings.push(CLAUDE_ASSET_FETCH_FAILURE_WARNING);
  if (assetRecords.some(asset => asset.detail === CLAUDE_ASSET_DETAIL.duplicatePath))
    warnings.push(
      'Some Claude attachments shared an archive path with a different file record and were not saved separately.'
    );
  if (assetRecords.some(asset => asset.detail === CLAUDE_ASSET_DETAIL.destinationFailed))
    warnings.push(
      'One or more Claude ordinary attachments could not be saved to this destination.'
    );
  return warnings;
}

export async function buildClaudeDestinationCompanion(
  context: ClaudeAssetExportContext,
  assetRecords: readonly RawCaptureAssetRecord[],
  runtimeAssets: readonly RawCaptureAsset[]
): Promise<ArchiveCompanionBundle> {
  const original = context.rawCaptureBundle;
  const manifest = buildCaptureManifest({
    ...original.manifest,
    assets: [...assetRecords],
    completeness: {
      ...original.manifest.completeness,
      assets: claudeAssetAttemptCompleteness(assetRecords),
    },
    warnings: [
      ...original.manifest.warnings.filter(
        warning => warning !== CLAUDE_ASSETS_NOT_ATTEMPTED_WARNING
      ),
      ...destinationWarnings(assetRecords),
    ],
  });
  const { archive } = await normalizeClaudeCapture({
    bundle: { manifest, artifacts: original.artifacts, assets: [...runtimeAssets] },
    artifactId: CLAUDE_DETAIL_ARTIFACT_ID,
    manifestSha256: await hashCaptureManifest(manifest),
    sha256: sha256Hex,
    contentBudget: context.contentBudget,
  });
  return appendJsonCanonicalCompanion(
    {
      captureId: manifest.captureId,
      conversationKey: await conversationKey(manifest.conversationId),
      capturedAt: manifest.capturedAt,
      artifacts: [{ ...context.rawArtifact }, await buildJsonManifestArtifact(manifest, sha256Hex)],
    },
    archive,
    sha256Hex,
    'claude'
  );
}

function binarySaved(
  asset: RawCaptureAsset,
  results: readonly StagedBinaryAssetResult[],
  destination: PersistentOutputDestination
): boolean {
  const matches = results.filter(item => item.assetId === asset.record.id);
  if (matches.length !== 1) return false;
  const { descriptor, results: receipts } = matches[0];
  const { record } = asset;
  const destinationReceipts = receipts.filter(receipt => receipt.destination === destination);
  return (
    descriptor !== undefined &&
    descriptor.assetId === record.id &&
    descriptor.relativePath === record.relativePath &&
    descriptor.byteLength === record.byteLength &&
    descriptor.mediaType === record.mediaType &&
    descriptor.sha256 === record.sha256 &&
    destinationReceipts.length === 1 &&
    destinationReceipts[0].success
  );
}

function assetsForDestination(
  acquisition: ClaudeAssetAcquisition,
  results: readonly StagedBinaryAssetResult[],
  destination: PersistentOutputDestination
): ClaudeAssetAcquisition {
  const runtimeAssets = acquisition.runtimeAssets.filter(asset =>
    binarySaved(asset, results, destination)
  );
  const available = new Map(runtimeAssets.map(asset => [asset.record.id, asset.record]));
  const records = acquisition.records.map(record =>
    record.state === 'fetched' &&
    JSON.stringify(available.get(record.id)) !== JSON.stringify(record)
      ? failedClaudeAssetRecord(record, record.attemptedAt, CLAUDE_ASSET_DETAIL.destinationFailed)
      : record
  );
  const retained = new Set(
    records.filter(record => record.state === 'fetched').map(record => record.id)
  );
  return { records, runtimeAssets: runtimeAssets.filter(asset => retained.has(asset.record.id)) };
}

function isPersistentOutput(output: OutputDestination): output is PersistentOutputDestination {
  return output === 'file' || output === 'obsidian';
}

/** Raw first, acquire once, confirm binary writes, then finalize each destination's claims. */
// eslint-disable-next-line max-lines-per-function, complexity -- Explicit phase ordering keeps destination and navigation evidence visible.
export async function persistClaudeDestinationHonestAttachments(
  context: ClaudeAssetExportContext,
  companion: ArchiveCompanionBundle,
  noteFileName: string,
  outputs: OutputDestination[],
  dependencies: ClaudeAssetExportDependencies
): Promise<ClaudeAssetExportResult> {
  const result: ClaudeAssetExportResult = {
    rawSuccessfulDestinations: [],
    completeDestinations: [],
    warnings: [],
  };
  const requested = [...new Set(outputs.filter(isPersistentOutput))];
  if (!requested.length) return result;
  const isCurrent = () => !dependencies.signal?.aborted && dependencies.isConversationCurrent();
  const requireCurrent = () => {
    if (!isCurrent()) throw new ClaudeNavigationChangedError();
  };
  const persist = (
    ownedCompanion: ArchiveCompanionBundle,
    outputs: OutputDestination[],
    kinds: readonly ArchiveCompanionKind[]
  ) =>
    dependencies.persistArtifacts(
      ownedCompanion,
      noteFileName,
      'claude',
      outputs,
      kinds,
      dependencies.expectedSyncSettingsSnapshot,
      dependencies.writeLedger,
      isCurrent
    );

  let originalHandedOff = false;
  try {
    requireCurrent();
    const valid = await verifyClaudeAssetExportBinding(context, companion);
    requireCurrent();
    if (!valid) {
      result.warnings.push(CLAUDE_ASSET_BINDING_FAILED_WARNING);
      return result;
    }
    let rawOutcome: PersistenceOutcome;
    try {
      originalHandedOff = true;
      rawOutcome = await persist(companion, requested, ['raw']);
    } catch (error) {
      rethrowControlFlow(error);
      requireCurrent();
      result.warnings.push(CLAUDE_ASSET_RAW_PERSISTENCE_FAILED_WARNING);
      return result;
    }
    requireCurrent();
    result.rawSuccessfulDestinations = requested.filter(output =>
      rawOutcome.activeOutputs.includes(output)
    );
    result.warnings.push(...rawOutcome.warnings);
    if (!result.rawSuccessfulDestinations.length) {
      result.warnings.push(CLAUDE_ASSET_RAW_PERSISTENCE_FAILED_WARNING);
      return result;
    }
  } finally {
    // Once handed off, the persistence boundary owns raw and unused stages.
    if (!originalHandedOff) await abortStages(companion);
  }

  requireCurrent();
  let acquisition: ClaudeAssetAcquisition;
  try {
    const candidates = await deriveClaudeAssetCandidates(context);
    requireCurrent();
    acquisition = await (dependencies.acquireAssets ?? acquireClaudeAssets)({
      assets: context.rawCaptureBundle.manifest.assets,
      candidates,
      signal: dependencies.signal,
      isConversationCurrent: isCurrent,
    });
  } catch (error) {
    rethrowControlFlow(error);
    requireCurrent();
    result.warnings.push(CLAUDE_ASSET_FETCH_FAILURE_WARNING);
    acquisition = { records: context.rawCaptureBundle.manifest.assets, runtimeAssets: [] };
  }
  requireCurrent();
  let binaryResults: StagedBinaryAssetResult[] = [];
  if (acquisition.runtimeAssets.length) {
    try {
      binaryResults = await (dependencies.persistBinaryAssets ?? persistVerifiedBinaryAssets)({
        source: 'claude',
        captureId: companion.captureId,
        conversationKey: companion.conversationKey,
        capturedAt: companion.capturedAt,
        expectedSyncSettingsSnapshot: dependencies.expectedSyncSettingsSnapshot,
        writeLedger: dependencies.writeLedger,
        assets: acquisition.runtimeAssets,
        outputs: result.rawSuccessfulDestinations,
      });
    } catch (error) {
      rethrowControlFlow(error);
      // With no confirmed receipt, all fetched claims downgrade below.
    }
  }
  requireCurrent();
  result.warnings.push(
    ...destinationWarnings(acquisition.records),
    ...stagedBinaryCleanupWarnings(binaryResults)
  );
  for (const destination of result.rawSuccessfulDestinations) {
    requireCurrent();
    const finalAssets = assetsForDestination(acquisition, binaryResults, destination);
    if (finalAssets.records.some(asset => asset.detail === CLAUDE_ASSET_DETAIL.destinationFailed)) {
      result.warnings.push(`One or more Claude attachments were not saved to ${destination}.`);
    }
    let finalCompanion: ArchiveCompanionBundle | undefined;
    try {
      const built = await buildClaudeDestinationCompanion(
        context,
        finalAssets.records,
        finalAssets.runtimeAssets
      );
      // Raw has already transferred to the writer. Do not present that stage
      // again for cleanup when handing off the destination's new companions.
      const [, manifest, canonical] = built.artifacts;
      if (!canonical) throw new Error('Claude canonical archive is missing.');
      const toPersist = { ...built, artifacts: [manifest, canonical] as const };
      finalCompanion = toPersist;
      requireCurrent();
      finalCompanion = undefined; // Persistence now owns the staged canonical artifact.
      const outcome = await persist(toPersist, [destination], ['manifest', 'canonical']);
      requireCurrent();
      result.warnings.push(...outcome.warnings);
      if (outcome.activeOutputs.includes(destination))
        result.completeDestinations.push(destination);
      else result.warnings.push(CLAUDE_ASSET_FINALIZATION_FAILED_WARNING);
    } catch (error) {
      rethrowControlFlow(error);
      requireCurrent();
      result.warnings.push(CLAUDE_ASSET_FINALIZATION_FAILED_WARNING);
    } finally {
      if (finalCompanion) await abortStages(finalCompanion);
    }
  }
  requireCurrent();
  return { ...result, warnings: [...new Set(result.warnings)] };
}
