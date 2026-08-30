/**
 * Destination-honest optional ChatGPT attachment export.
 *
 * The ordinary structured capture remains the fast path. This module is
 * called only after its original raw companion is known and the existing
 * image/attachment export gate is enabled for a durable destination. Resolver URLs enter only the
 * observation/acquisition calls below and are never returned or persisted.
 */

import type { RawCaptureAsset, RawCaptureAssetRecord } from '../archive';
import {
  acquireChatGptPageOwnedAssets,
  createChatGptPageOwnedAssetAcquisitionBudget,
  type ChatGptPageOwnedAssetAcquisitionBudget,
} from './capture/chatgpt-asset-acquisition';
import {
  buildChatGptBinaryAwareArchiveCompanion,
  CHATGPT_ASSET_RECAPTURE_FAILED_WARNING,
  CHATGPT_INTERPRETER_RESOLUTION_FAILED_WARNING,
  observeChatGptAssetResolvers,
  verifyChatGptAssetExportContext,
  type ChatGptAssetResolverObservation,
} from './capture/chatgpt-current-branch';
import type { ChatGptActiveResolverMetric } from './capture/chatgpt-active-resolver-audit';
import type { ChatGptPageOwnedAssetCandidate } from './capture/chatgpt-asset-resolver';
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
  'ChatGPT attachment acquisition was incomplete; final attachment states are recorded in the archive manifest.';
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
    context: ChatGptAssetExportContext,
    eligibleAssetIds: readonly string[]
  ) => Promise<ChatGptAssetResolverObservation>;
  observeInterpreterResolvers?: (
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
  activeResolverMetric?: ChatGptActiveResolverMetric;
}

interface ChatGptAssetCandidateResolution {
  candidates: ChatGptPageOwnedAssetCandidate[];
  warnings: string[];
  matched: boolean;
  activeResolverMetric?: ChatGptActiveResolverMetric;
}

interface ResolvedAssetAcquisition {
  resolution: ChatGptAssetCandidateResolution;
  acquired: AcquiredAssets;
  acquisitionFailed: boolean;
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
  assets: readonly RawCaptureAssetRecord[],
  candidates: readonly ChatGptPageOwnedAssetCandidate[],
  dependencies: ChatGptAssetExportDependencies,
  budget: ChatGptPageOwnedAssetAcquisitionBudget
): Promise<AcquiredAssets | undefined> {
  try {
    return await (dependencies.acquireAssets ?? acquireChatGptPageOwnedAssets)({
      conversationId: context.conversationId,
      assets,
      candidates,
      budget,
    });
  } catch {
    return undefined;
  }
}

function combineAcquiredAssets(prior: AcquiredAssets, next: AcquiredAssets): AcquiredAssets {
  const runtimes = new Map(prior.runtimeAssets.map(asset => [asset.record.id, asset]));
  for (const asset of next.runtimeAssets) runtimes.set(asset.record.id, asset);
  return { records: next.records, runtimeAssets: [...runtimes.values()] };
}

async function observeLegacyResolvers(
  context: ChatGptAssetExportContext,
  dependencies: ChatGptAssetExportDependencies,
  eligibleAssetIds: readonly string[]
): Promise<ChatGptAssetResolverObservation> {
  try {
    return dependencies.observeResolvers === undefined
      ? await observeChatGptAssetResolvers(context, {}, eligibleAssetIds)
      : await dependencies.observeResolvers(context, eligibleAssetIds);
  } catch {
    return {
      kind: 'recapture-failed',
      warning: CHATGPT_ASSET_RECAPTURE_FAILED_WARNING,
    };
  }
}

async function observeInterpreterResolvers(
  context: ChatGptAssetExportContext,
  dependencies: ChatGptAssetExportDependencies
): Promise<ChatGptAssetResolverObservation | undefined> {
  if (dependencies.observeInterpreterResolvers === undefined) return undefined;
  try {
    return await dependencies.observeInterpreterResolvers(context);
  } catch {
    return {
      kind: 'interpreter-failed',
      warning: CHATGPT_INTERPRETER_RESOLUTION_FAILED_WARNING,
    };
  }
}

function addWarning(warnings: string[], warning: string | undefined): void {
  if (warning !== undefined && !warnings.includes(warning)) warnings.push(warning);
}

function addObservation(
  resolution: ChatGptAssetCandidateResolution,
  observation: ChatGptAssetResolverObservation,
  candidates: Map<string, ChatGptPageOwnedAssetCandidate>,
  allowedAssetIds: ReadonlySet<string>,
  interpreterPrecedence: boolean
): void {
  if (observation.kind === 'matched') {
    resolution.matched = true;
    addWarning(resolution.warnings, observation.warning);
    for (const candidate of observation.candidates) {
      if (!allowedAssetIds.has(candidate.assetId)) continue;
      if (interpreterPrecedence || !candidates.has(candidate.assetId)) {
        candidates.set(candidate.assetId, { ...candidate });
      }
    }
    return;
  }
  if (observation.kind === 'probe-only') {
    resolution.activeResolverMetric = observation.metric;
  }
  addWarning(resolution.warnings, observation.warning);
}

// eslint-disable-next-line max-lines-per-function -- The interpreter-fetch-before-legacy ordering stays explicit so signed URLs cannot age behind another resolver family.
async function resolveAndAcquireAssetCandidates(
  context: ChatGptAssetExportContext,
  dependencies: ChatGptAssetExportDependencies
): Promise<ResolvedAssetAcquisition> {
  const resolution: ChatGptAssetCandidateResolution = {
    candidates: [],
    warnings: [],
    matched: false,
  };
  const allowedAssetIds = new Set(context.rawCaptureBundle.manifest.assets.map(asset => asset.id));
  const candidates = new Map<string, ChatGptPageOwnedAssetCandidate>();
  const budget = createChatGptPageOwnedAssetAcquisitionBudget();
  let acquired = acquisitionFailure(context);
  let acquisitionFailed = false;
  const acquireBatch = async (batch: readonly ChatGptPageOwnedAssetCandidate[]): Promise<void> => {
    if (batch.length === 0) return;
    const next = await acquireObservedAssets(
      context,
      acquired.records,
      batch,
      dependencies,
      budget
    );
    if (!next) {
      acquisitionFailed = true;
      return;
    }
    acquired = combineAcquiredAssets(acquired, next);
  };
  const interpreter = await observeInterpreterResolvers(context, dependencies);
  if (interpreter !== undefined) {
    addObservation(resolution, interpreter, candidates, allowedAssetIds, true);
  }
  const interpreterAssetIds = new Set(candidates.keys());
  await acquireBatch(
    [...candidates.values()].sort((left, right) =>
      left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0
    )
  );

  const hasUnresolvedAsset = [...allowedAssetIds].some(assetId => !candidates.has(assetId));
  if (hasUnresolvedAsset) {
    const remainingAssetIds = [...allowedAssetIds]
      .filter(assetId => !candidates.has(assetId))
      .sort();
    const legacy = await observeLegacyResolvers(context, dependencies, remainingAssetIds);
    addObservation(resolution, legacy, candidates, allowedAssetIds, false);
    await acquireBatch(
      [...candidates.values()]
        .filter(candidate => !interpreterAssetIds.has(candidate.assetId))
        .sort((left, right) =>
          left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0
        )
    );
  }
  resolution.candidates = [...candidates.values()].sort((left, right) =>
    left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0
  );
  return { resolution, acquired, acquisitionFailed };
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
  const { resolution, acquired, acquisitionFailed } = await resolveAndAcquireAssetCandidates(
    context,
    dependencies
  );
  if (!resolution.matched) {
    const acquired = acquisitionFailure(context);
    return {
      acquired,
      binaryResults: [],
      warnings:
        resolution.activeResolverMetric === undefined
          ? [...resolution.warnings, ...acquisitionOutcomeWarnings(acquired.records)]
          : resolution.warnings,
      activeResolverMetric: resolution.activeResolverMetric,
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
    warnings: [
      ...resolution.warnings,
      ...(acquisitionFailed ? [CHATGPT_ASSET_ACQUISITION_FAILED_WARNING] : []),
      ...acquisitionOutcomeWarnings(acquired.records),
    ],
    activeResolverMetric: resolution.activeResolverMetric,
  };
}

async function finalizeDestination(
  context: ChatGptAssetExportContext,
  companion: ArchiveCompanionBundle,
  noteFileName: string,
  destination: PersistentOutputDestination,
  acquired: AcquiredAssets,
  binaryResults: readonly StagedBinaryAssetResult[],
  activeResolverMetric: ChatGptActiveResolverMetric | undefined,
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
    )(context, destinationState.records, destinationState.runtimeAssets, activeResolverMetric);
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
  const { acquired, binaryResults, activeResolverMetric } = assetAttempt;
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
      activeResolverMetric,
      dependencies
    );
    warnings.push(...finalized.warnings);
    if (finalized.complete) completeDestinations.push(destination);
  }
  return { rawSuccessfulDestinations, completeDestinations, warnings };
}
