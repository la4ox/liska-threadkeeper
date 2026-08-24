/**
 * Destination-honest optional ChatGPT attachment export.
 *
 * The ordinary structured capture remains the fast path. This module is
 * called only after its original raw companion is known and the existing
 * image/attachment export gate is enabled for a durable destination. Resolver URLs enter only the
 * observation/acquisition calls below and are never returned or persisted.
 */

import type { RawCaptureAsset, RawCaptureAssetRecord } from '../archive';
import { acquireChatGptPageOwnedAssets } from './capture/chatgpt-asset-acquisition';
import {
  buildChatGptBinaryAwareArchiveCompanion,
  CHATGPT_ASSET_RECAPTURE_FAILED_WARNING,
  observeChatGptAssetResolvers,
  verifyChatGptAssetExportContext,
  type ChatGptAssetResolverObservation,
} from './capture/chatgpt-current-branch';
import { sha256Hex } from './capture/response';
import { persistVerifiedBinaryAssets } from './staged-binary-persistence';
import { ARCHIVE_COMPANION_RELATIVE_PATHS } from '../lib/types';
import type {
  ArchiveCompanionBundle,
  ArchiveCompanionKind,
  ChatGptAssetExportContext,
  OutputDestination,
  PersistentOutputDestination,
  StagedBinaryAssetDescriptor,
  StagedBinaryAssetResult,
} from '../lib/types';

export const CHATGPT_ASSET_DESTINATION_WRITE_FAILED_DETAIL = 'destination-write-failed';
export const CHATGPT_ASSET_ACQUISITION_FAILED_WARNING =
  'ChatGPT attachment acquisition failed; attachments were not attempted.';
export const CHATGPT_ASSET_FINALIZATION_FAILED_WARNING =
  'ChatGPT attachment archive finalization failed; the original raw capture remains available.';
export const CHATGPT_ASSET_RAW_PERSISTENCE_FAILED_WARNING =
  'ChatGPT original raw archive companion could not be saved.';
export const CHATGPT_ASSET_BINDING_FAILED_WARNING =
  'ChatGPT attachment export could not verify the original capture; attachments were not exported.';
export const CHATGPT_ASSET_FETCH_FAILURE_WARNING =
  'One or more ChatGPT attachments could not be fetched; the archive manifest records the failures.';
export const CHATGPT_ASSET_UNRESOLVED_WARNING =
  'Some ChatGPT attachments were not resolved during this export attempt; the archive manifest records them as not attempted.';

export interface ArchiveCompanionPersistenceOutcome {
  activeOutputs: PersistentOutputDestination[];
  warnings: string[];
}

export interface ChatGptAssetExportDependencies {
  persistArtifacts: (
    companion: ArchiveCompanionBundle,
    noteFileName: string,
    source: 'chatgpt',
    outputs: OutputDestination[],
    artifactKinds: readonly ArchiveCompanionKind[]
  ) => Promise<ArchiveCompanionPersistenceOutcome>;
  observeResolvers?: (
    context: ChatGptAssetExportContext
  ) => Promise<ChatGptAssetResolverObservation>;
  acquireAssets?: typeof acquireChatGptPageOwnedAssets;
  persistBinaryAssets?: typeof persistVerifiedBinaryAssets;
  buildDestinationCompanion?: typeof buildChatGptBinaryAwareArchiveCompanion;
}

export interface ChatGptAssetExportResult {
  rawSuccessfulDestinations: PersistentOutputDestination[];
  completeDestinations: PersistentOutputDestination[];
  warnings: string[];
}

interface AcquiredAssets {
  records: RawCaptureAssetRecord[];
  runtimeAssets: RawCaptureAsset[];
}

interface AssetAttempt {
  acquired: AcquiredAssets;
  binaryResults: StagedBinaryAssetResult[];
  warnings: string[];
}

/**
 * Bind the runtime-only source context to the exact raw companion selected
 * for persistence. This runs before the first raw write, so a stale or mixed
 * capture cannot create a durable partial archive.
 */
export async function validateChatGptAssetExportBinding(
  context: ChatGptAssetExportContext,
  companion: ArchiveCompanionBundle
): Promise<boolean> {
  try {
    const originalRaw = await verifyChatGptAssetExportContext(context);
    const expectedConversationKey = await sha256Hex(
      new TextEncoder().encode(context.conversationId)
    );
    const rawArtifacts = companion.artifacts.filter(artifact => artifact.kind === 'raw');
    if (companion.captureId !== context.rawCaptureBundle.manifest.captureId) return false;
    if (companion.conversationKey !== expectedConversationKey) return false;
    if (rawArtifacts.length !== 1) return false;
    const raw = rawArtifacts[0];
    return (
      raw.relativePath === ARCHIVE_COMPANION_RELATIVE_PATHS.raw &&
      raw.relativePath === originalRaw.record.relativePath &&
      raw.mediaType === originalRaw.record.mediaType &&
      raw.byteLength === originalRaw.record.byteLength &&
      raw.sha256 === originalRaw.record.sha256 &&
      raw.bodyBase64 === context.rawBodyBase64
    );
  } catch {
    return false;
  }
}

function persistentOutputs(outputs: readonly OutputDestination[]): PersistentOutputDestination[] {
  return outputs.filter(
    (output): output is PersistentOutputDestination => output === 'file' || output === 'obsidian'
  );
}

function cloneRecord(record: RawCaptureAssetRecord): RawCaptureAssetRecord {
  return {
    ...record,
    sourceRefs: record.sourceRefs.map(sourceRef => ({ ...sourceRef })),
  };
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

function destinationAssets(
  acquired: AcquiredAssets,
  binaryResults: readonly StagedBinaryAssetResult[],
  destination: PersistentOutputDestination
): { records: RawCaptureAssetRecord[]; runtimeAssets: RawCaptureAsset[]; binaryFailed: boolean } {
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

function acquisitionFailure(context: ChatGptAssetExportContext): AcquiredAssets {
  return {
    records: context.rawCaptureBundle.manifest.assets.map(cloneRecord),
    runtimeAssets: [],
  };
}

function acquisitionOutcomeWarnings(records: readonly RawCaptureAssetRecord[]): string[] {
  const warnings: string[] = [];
  if (records.some(record => record.state === 'failed')) {
    warnings.push(CHATGPT_ASSET_FETCH_FAILURE_WARNING);
  }
  if (records.some(record => record.state === 'not-attempted')) {
    warnings.push(CHATGPT_ASSET_UNRESOLVED_WARNING);
  }
  return warnings;
}

async function acquireObservedAssets(
  context: ChatGptAssetExportContext,
  observation: Extract<ChatGptAssetResolverObservation, { kind: 'matched' }>,
  dependencies: ChatGptAssetExportDependencies
): Promise<AcquiredAssets | undefined> {
  try {
    return await (dependencies.acquireAssets ?? acquireChatGptPageOwnedAssets)({
      conversationId: context.conversationId,
      assets: context.rawCaptureBundle.manifest.assets,
      candidates: observation.candidates,
    });
  } catch {
    return undefined;
  }
}

async function observeResolvers(
  context: ChatGptAssetExportContext,
  dependencies: ChatGptAssetExportDependencies
): Promise<ChatGptAssetResolverObservation> {
  try {
    return await (dependencies.observeResolvers ?? observeChatGptAssetResolvers)(context);
  } catch {
    return {
      kind: 'recapture-failed',
      warning: CHATGPT_ASSET_RECAPTURE_FAILED_WARNING,
    };
  }
}

async function persistAcquiredBinaries(
  companion: ArchiveCompanionBundle,
  assets: readonly RawCaptureAsset[],
  outputs: PersistentOutputDestination[],
  dependencies: ChatGptAssetExportDependencies
): Promise<StagedBinaryAssetResult[]> {
  if (assets.length === 0) return [];
  try {
    return await (dependencies.persistBinaryAssets ?? persistVerifiedBinaryAssets)({
      source: 'chatgpt',
      captureId: companion.captureId,
      conversationKey: companion.conversationKey,
      assets,
      outputs,
    });
  } catch {
    return [];
  }
}

async function attemptAssets(
  context: ChatGptAssetExportContext,
  companion: ArchiveCompanionBundle,
  rawSuccessfulDestinations: PersistentOutputDestination[],
  dependencies: ChatGptAssetExportDependencies
): Promise<AssetAttempt> {
  if (context.rawCaptureBundle.manifest.assets.length === 0) {
    return { acquired: { records: [], runtimeAssets: [] }, binaryResults: [], warnings: [] };
  }
  const observation = await observeResolvers(context, dependencies);
  if (observation.kind === 'probe-only') {
    return {
      acquired: acquisitionFailure(context),
      binaryResults: [],
      // A metric checkpoint is intentionally the sole attachment warning: all
      // source ledger records remain honestly not-attempted.
      warnings: [observation.warning],
    };
  }
  if (observation.kind !== 'matched') {
    const acquired = acquisitionFailure(context);
    return {
      acquired,
      binaryResults: [],
      warnings: [observation.warning, ...acquisitionOutcomeWarnings(acquired.records)],
    };
  }
  const acquired = await acquireObservedAssets(context, observation, dependencies);
  if (!acquired) {
    const failedAcquisition = acquisitionFailure(context);
    return {
      acquired: failedAcquisition,
      binaryResults: [],
      warnings: [
        CHATGPT_ASSET_ACQUISITION_FAILED_WARNING,
        ...acquisitionOutcomeWarnings(failedAcquisition.records),
      ],
    };
  }
  return {
    acquired,
    binaryResults: await persistAcquiredBinaries(
      companion,
      acquired.runtimeAssets,
      rawSuccessfulDestinations,
      dependencies
    ),
    warnings: acquisitionOutcomeWarnings(acquired.records),
  };
}

async function finalizeDestination(
  context: ChatGptAssetExportContext,
  companion: ArchiveCompanionBundle,
  noteFileName: string,
  destination: PersistentOutputDestination,
  acquired: AcquiredAssets,
  binaryResults: readonly StagedBinaryAssetResult[],
  dependencies: ChatGptAssetExportDependencies
): Promise<{ complete: boolean; warnings: string[] }> {
  const destinationState = destinationAssets(acquired, binaryResults, destination);
  const warnings: string[] = [];
  if (destinationState.binaryFailed) {
    warnings.push(
      `One or more ChatGPT attachments were not saved to ${destination}; the archive manifest records them as failed.`
    );
  }
  try {
    const destinationCompanion = await (
      dependencies.buildDestinationCompanion ?? buildChatGptBinaryAwareArchiveCompanion
    )(context, destinationState.records, destinationState.runtimeAssets);
    const outcome = await dependencies.persistArtifacts(
      destinationCompanion,
      noteFileName,
      'chatgpt',
      [destination],
      ['manifest', 'canonical']
    );
    return {
      complete: outcome.activeOutputs.includes(destination),
      warnings: [...warnings, ...outcome.warnings],
    };
  } catch {
    return {
      complete: false,
      warnings: [...warnings, CHATGPT_ASSET_FINALIZATION_FAILED_WARNING],
    };
  }
}

/**
 * Persist one original raw companion, observe and acquire assets once, then
 * produce manifest/canonical companions separately for every raw-successful
 * destination. Markdown callers retain control of their own non-fatal write.
 */
// eslint-disable-next-line max-lines-per-function -- The durable raw -> observe -> acquire -> per-destination finalization sequence is intentionally auditable end-to-end.
export async function persistChatGptDestinationHonestAttachments(
  context: ChatGptAssetExportContext,
  companion: ArchiveCompanionBundle,
  noteFileName: string,
  outputs: OutputDestination[],
  dependencies: ChatGptAssetExportDependencies
): Promise<ChatGptAssetExportResult> {
  const requested = persistentOutputs(outputs);
  if (requested.length === 0) {
    return { rawSuccessfulDestinations: [], completeDestinations: [], warnings: [] };
  }
  if (!(await validateChatGptAssetExportBinding(context, companion))) {
    return {
      rawSuccessfulDestinations: [],
      completeDestinations: [],
      warnings: [CHATGPT_ASSET_BINDING_FAILED_WARNING],
    };
  }

  let rawOutcome: ArchiveCompanionPersistenceOutcome;
  try {
    rawOutcome = await dependencies.persistArtifacts(
      companion,
      noteFileName,
      'chatgpt',
      requested,
      ['raw']
    );
  } catch {
    return {
      rawSuccessfulDestinations: [],
      completeDestinations: [],
      warnings: [CHATGPT_ASSET_RAW_PERSISTENCE_FAILED_WARNING],
    };
  }
  const rawSuccessfulDestinations = rawOutcome.activeOutputs;
  const warnings = [...rawOutcome.warnings];
  if (rawSuccessfulDestinations.length === 0) {
    return { rawSuccessfulDestinations, completeDestinations: [], warnings };
  }

  const assetAttempt = await attemptAssets(
    context,
    companion,
    rawSuccessfulDestinations,
    dependencies
  );
  const { acquired, binaryResults } = assetAttempt;
  warnings.push(...assetAttempt.warnings);

  const completeDestinations: PersistentOutputDestination[] = [];
  for (const destination of rawSuccessfulDestinations) {
    const finalized = await finalizeDestination(
      context,
      companion,
      noteFileName,
      destination,
      acquired,
      binaryResults,
      dependencies
    );
    warnings.push(...finalized.warnings);
    if (finalized.complete) completeDestinations.push(destination);
  }
  return { rawSuccessfulDestinations, completeDestinations, warnings };
}
