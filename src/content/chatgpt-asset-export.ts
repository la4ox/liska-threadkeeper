/* eslint-disable max-lines -- Keep destination-honest acquisition, finalization, and evidence handoff auditable in one provider boundary. */
/**
 * Destination-honest optional ChatGPT attachment export.
 *
 * The ordinary structured capture remains the fast path. This module is
 * called only after its original raw companion is known and the existing
 * image/attachment export gate is enabled for a durable destination. Resolver URLs enter only the
 * observation/acquisition calls below and are never returned or persisted.
 */

import type { RawCaptureAsset, RawCaptureAssetRecord } from '../archive';
import type { OperationWriteLedger } from '../lib/operation-write-ledger';
import type { ChatGptDestinationArchiveReceipt } from '../lib/chatgpt-archive-receipt';
import {
  buildChatGptSandboxLocalizationEvidence,
  type ChatGptSandboxLocalizationEvidence,
} from './chatgpt-sandbox-localization';
import {
  buildChatGptDestinationArchiveReceipt,
  reconcileChatGptDestinationAssets,
} from './chatgpt-destination-receipt';
import {
  acquireChatGptPageOwnedAssets,
  createChatGptPageOwnedAssetAcquisitionBudget,
  type ChatGptPageOwnedAssetAcquisitionBudget,
} from './capture/chatgpt-asset-acquisition';
import {
  buildChatGptBinaryAwareArchiveCompanion,
  buildChatGptBinaryAwareDestinationArchive,
  CHATGPT_ASSET_RECAPTURE_FAILED_WARNING,
  CHATGPT_INTERPRETER_RESOLUTION_FAILED_WARNING,
  observeChatGptAssetResolvers,
  planChatGptActiveImageAsset,
  planChatGptLibraryJpegAsset,
  planChatGptLibraryCsvAsset,
  planChatGptInterpreterAssetIds,
  verifyChatGptAssetExportContext,
  type ChatGptAssetResolverObservation,
} from './capture/chatgpt-current-branch';
import {
  buildFinalizedFileArchivePresentationEvidence,
  buildFinalizedFilePresentationEvidence,
  type FinalizedFileArchivePresentationEvidence,
  type FinalizedFilePresentationEvidence,
} from './finalized-html-assets';
import {
  chatGptActiveResolverAuditWarning,
  chatGptActiveResolverMetricFromResponse,
  CHATGPT_ACTIVE_IMAGE_BATCH_MAX_COUNT,
  type ChatGptActiveResolverAudit,
  type ChatGptActiveResolverMetric,
} from './capture/chatgpt-active-resolver-audit';
import {
  activeAssetFailure,
  isBoundChatGptActiveAssetResponse,
  type ChatGptActiveAssetPlanItem,
  type ChatGptActiveAssetResponse,
} from '../lib/chatgpt-active-asset-contract';
import {
  applyChatGptActiveAssetFailure,
  applyChatGptActiveAcquisitionFailure,
} from './capture/chatgpt-active-asset-diagnostics';
import type { ChatGptPageOwnedAssetCandidate } from './capture/chatgpt-asset-resolver';
import { applyInterpreterResolverDetails } from './capture/chatgpt-interpreter-resolver-diagnostics';
import { sha256Hex } from './capture/response';
import {
  persistVerifiedBinaryAssets,
  stagedBinaryCleanupWarnings,
} from './staged-binary-persistence';
import { ARCHIVE_COMPANION_RELATIVE_PATHS } from '../lib/types';
import { allowsChatGptAttachmentAcquisitionFromJsonBytes } from '../lib/chatgpt-owner-context';
import type {
  ArchiveCompanionBundle,
  ArchiveCompanionKind,
  ChatGptAssetExportContext,
  OutputDestination,
  PersistentOutputDestination,
  StagedBinaryAssetResult,
  StructuredArchivePresentationContext,
  StructuredPresentationContext,
} from '../lib/types';

export { CHATGPT_ASSET_DESTINATION_WRITE_FAILED_DETAIL } from './chatgpt-destination-receipt';

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
export const CHATGPT_ASSET_OWNER_CONTEXT_SKIPPED_WARNING =
  'ChatGPT attachment acquisition was skipped because the original raw capture has an unsupported or ambiguous owner context; attachment records remain not attempted.';

export interface ArchiveCompanionPersistenceOutcome {
  activeOutputs: PersistentOutputDestination[];
  warnings: string[];
}

export interface ChatGptAssetExportDependencies {
  writeLedger?: OperationWriteLedger;
  /** Original runtime-only guard, shared by every durable write in this operation. */
  expectedSyncSettingsSnapshot?: string;
  persistArtifacts: (
    companion: ArchiveCompanionBundle,
    noteFileName: string,
    source: 'chatgpt',
    outputs: OutputDestination[],
    artifactKinds: readonly ArchiveCompanionKind[],
    expectedSyncSettingsSnapshot?: string,
    writeLedger?: OperationWriteLedger
  ) => Promise<ArchiveCompanionPersistenceOutcome>;
  observeResolvers?: (
    context: ChatGptAssetExportContext,
    eligibleAssetIds: readonly string[]
  ) => Promise<ChatGptAssetResolverObservation>;
  observeInterpreterResolvers?: (
    context: ChatGptAssetExportContext
  ) => Promise<ChatGptAssetResolverObservation>;
  /** Strict replay only: a metric probe before passive observation, never acquisition. */
  observeActiveResolvers?: (
    context: ChatGptAssetExportContext,
    eligibleAssetIds: readonly string[]
  ) => Promise<ChatGptAssetResolverObservation>;
  /** Separate single-item route, called sequentially at most four times in strict replay. */
  resolveActiveAsset?: (
    context: ChatGptAssetExportContext,
    item: ChatGptActiveAssetPlanItem
  ) => Promise<ChatGptActiveAssetResponse>;
  /** Separate evidence-gated Library JPEG route; shares one of the four active slots. */
  resolveLibraryAsset?: (
    context: ChatGptAssetExportContext,
    item: ChatGptActiveAssetPlanItem
  ) => Promise<ChatGptActiveAssetResponse>;
  /** Separate one-CSV Library route; consumes one of the same four active slots. */
  resolveLibraryCsvAsset?: (
    context: ChatGptAssetExportContext,
    item: ChatGptActiveAssetPlanItem
  ) => Promise<ChatGptActiveAssetResponse>;
  acquireAssets?: typeof acquireChatGptPageOwnedAssets;
  persistBinaryAssets?: typeof persistVerifiedBinaryAssets;
  buildDestinationCompanion?: typeof buildChatGptBinaryAwareArchiveCompanion;
  buildDestinationArchive?: typeof buildChatGptBinaryAwareDestinationArchive;
  buildFileArchivePresentationEvidence?: typeof buildFinalizedFileArchivePresentationEvidence;
  buildFilePresentationEvidence?: typeof buildFinalizedFilePresentationEvidence;
  /** Present only for an opt-in all-branches File HTML run. */
  archivePresentationContext?: StructuredArchivePresentationContext;
  /** Present only for an opt-in File HTML run; never authorizes another destination. */
  presentationContext?: StructuredPresentationContext;
}

export interface ChatGptAssetExportResult {
  rawSuccessfulDestinations: PersistentOutputDestination[];
  completeDestinations: PersistentOutputDestination[];
  destinationReceipts: ChatGptDestinationArchiveReceipt[];
  /** Private detached proof, never a durable receipt field or output payload. */
  destinationLocalizationEvidence?: ChatGptSandboxLocalizationEvidence[];
  fileArchivePresentation?: FinalizedFileArchivePresentationEvidence;
  filePresentation?: FinalizedFilePresentationEvidence;
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
  archiveWarnings?: readonly string[];
  activeResolverMetric?: ChatGptActiveResolverAudit;
}

interface FinalizedDestination {
  complete: boolean;
  receipt?: ChatGptDestinationArchiveReceipt;
  localizationEvidence?: ChatGptSandboxLocalizationEvidence;
  fileArchivePresentation?: FinalizedFileArchivePresentationEvidence;
  filePresentation?: FinalizedFilePresentationEvidence;
  warnings: string[];
}

interface ChatGptAssetCandidateResolution {
  candidates: ChatGptPageOwnedAssetCandidate[];
  warnings: string[];
  matched: boolean;
  activeResolverMetric?: ChatGptActiveResolverAudit;
}

interface ResolvedAssetAcquisition {
  resolution: ChatGptAssetCandidateResolution;
  acquired: AcquiredAssets;
  acquisitionFailed: boolean;
}

interface ActiveAssetAttempt {
  assetId: string;
  response: ChatGptActiveAssetResponse;
  metric: ChatGptActiveResolverMetric;
}

/**
 * Bind the runtime-only source context to the exact raw companion selected
 * for persistence. This runs before the first raw write, so a stale or mixed
 * capture cannot create a durable partial archive.
 */
async function verifiedBoundRawBytes(
  context: ChatGptAssetExportContext,
  companion: ArchiveCompanionBundle
): Promise<Uint8Array | undefined> {
  try {
    const originalRaw = await verifyChatGptAssetExportContext(context);
    const expectedConversationKey = await sha256Hex(
      new TextEncoder().encode(context.conversationId)
    );
    const rawArtifacts = companion.artifacts.filter(artifact => artifact.kind === 'raw');
    if (companion.captureId !== context.rawCaptureBundle.manifest.captureId) return undefined;
    if (companion.conversationKey !== expectedConversationKey) return undefined;
    if (rawArtifacts.length !== 1) return undefined;
    const raw = rawArtifacts[0];
    const contextRaw = context.rawArtifact;
    const matches =
      raw.relativePath === ARCHIVE_COMPANION_RELATIVE_PATHS.raw &&
      raw.relativePath === originalRaw.record.relativePath &&
      raw.mediaType === originalRaw.record.mediaType &&
      raw.byteLength === originalRaw.record.byteLength &&
      raw.sha256 === originalRaw.record.sha256 &&
      raw.transport === contextRaw.transport &&
      (raw.transport === 'inline'
        ? contextRaw.transport === 'inline' && raw.bodyBase64 === contextRaw.bodyBase64
        : contextRaw.transport === 'staged' && raw.stageId === contextRaw.stageId);
    return matches ? originalRaw.bytes : undefined;
  } catch {
    return undefined;
  }
}

export async function validateChatGptAssetExportBinding(
  context: ChatGptAssetExportContext,
  companion: ArchiveCompanionBundle
): Promise<boolean> {
  return (await verifiedBoundRawBytes(context, companion)) !== undefined;
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

async function observeOneUnattemptedPng(
  context: ChatGptAssetExportContext,
  dependencies: ChatGptAssetExportDependencies,
  acquired: AcquiredAssets,
  candidates: ReadonlyMap<string, ChatGptPageOwnedAssetCandidate>,
  excludedAssetIds: ReadonlySet<string>,
  resolution: ChatGptAssetCandidateResolution
): Promise<void> {
  // Probe one unresolved PNG independently of the later passive observer's
  // source compatibility or candidate acquisition outcome.
  if (dependencies.observeActiveResolvers === undefined) return;
  const selectedId = acquired.records
    .filter(
      record =>
        record.state === 'not-attempted' &&
        record.mediaType === 'image/png' &&
        /^chatgpt-asset-[a-f0-9]{64}$/.test(record.id) &&
        !excludedAssetIds.has(record.id) &&
        !candidates.has(record.id)
    )
    .map(record => record.id)
    .sort()[0];
  if (selectedId === undefined) return;
  try {
    const observation = await dependencies.observeActiveResolvers(context, [selectedId]);
    // Even a substituted dependency cannot turn this seam into acquisition.
    if (observation.kind === 'probe-only') {
      resolution.activeResolverMetric = observation.metric;
      addWarning(resolution.warnings, observation.warning);
    } else if (observation.kind !== 'matched') {
      addWarning(resolution.warnings, observation.warning);
    }
  } catch {
    addWarning(resolution.warnings, CHATGPT_ASSET_RECAPTURE_FAILED_WARNING);
  }
}

const ACTIVE_ASSET_PLANNERS = {
  ordinary: planChatGptActiveImageAsset,
  'library-jpeg': planChatGptLibraryJpegAsset,
  'library-csv': planChatGptLibraryCsvAsset,
};

async function resolveOneUnattemptedAsset(
  context: ChatGptAssetExportContext,
  dependencies: ChatGptAssetExportDependencies,
  records: readonly RawCaptureAssetRecord[],
  candidates: ReadonlyMap<string, ChatGptPageOwnedAssetCandidate>,
  excludedAssetIds: ReadonlySet<string>,
  activeOwnedAssetIds: Set<string>,
  resolution: ChatGptAssetCandidateResolution,
  family: keyof typeof ACTIVE_ASSET_PLANNERS = 'ordinary'
): Promise<ActiveAssetAttempt | undefined> {
  const resolver = {
    ordinary: dependencies.resolveActiveAsset,
    'library-jpeg': dependencies.resolveLibraryAsset,
    'library-csv': dependencies.resolveLibraryCsvAsset,
  }[family];
  if (resolver === undefined) return undefined;
  let item: ChatGptActiveAssetPlanItem | undefined;
  try {
    const planner = ACTIVE_ASSET_PLANNERS[family];
    item = await planner(
      context,
      records
        .filter(
          record =>
            record.state === 'not-attempted' &&
            !candidates.has(record.id) &&
            !excludedAssetIds.has(record.id) &&
            !activeOwnedAssetIds.has(record.id)
        )
        .map(record => record.id)
    );
  } catch {
    addWarning(resolution.warnings, CHATGPT_ASSET_BINDING_FAILED_WARNING);
  }
  if (!item) return undefined;
  const bound = { ...item };
  // Ownership begins before dispatch, including helper/run/binary failures.
  activeOwnedAssetIds.add(bound.assetId);
  const response = await resolveBoundActiveAsset(context, bound, resolver);
  return {
    assetId: bound.assetId,
    response,
    metric: chatGptActiveResolverMetricFromResponse(
      response.success ? { success: true, data: response.data.metrics } : response,
      1
    ),
  };
}

async function resolveBoundActiveAsset(
  context: ChatGptAssetExportContext,
  bound: ChatGptActiveAssetPlanItem,
  resolver: NonNullable<ChatGptAssetExportDependencies['resolveActiveAsset']>
): Promise<ChatGptActiveAssetResponse> {
  try {
    const result = await resolver(context, { ...bound });
    return (await isBoundChatGptActiveAssetResponse(result, bound, context.conversationId))
      ? result
      : activeAssetFailure('resolver-result-invalid');
  } catch {
    return activeAssetFailure('resolver-result-invalid');
  }
}

function hasAssetBudget(budget: ChatGptPageOwnedAssetAcquisitionBudget): boolean {
  return budget.attemptsRemaining > 0 && budget.bytesRemaining > 0;
}

function addActiveBatchAudit(
  resolution: ChatGptAssetCandidateResolution,
  attempts: ChatGptActiveResolverMetric[],
  libraryJpegAttemptCount: 0 | 1,
  libraryCsvAttemptCount: 0 | 1
): void {
  if (attempts.length === 0) return;
  resolution.activeResolverMetric = libraryCsvAttemptCount
    ? {
        acquisitionMode: 'asset-batch-4',
        attempts,
        libraryJpegAttemptCount,
        libraryCsvAttemptCount,
      }
    : { acquisitionMode: 'image-batch-4', attempts, libraryJpegAttemptCount };
  addWarning(
    resolution.warnings,
    chatGptActiveResolverAuditWarning(resolution.activeResolverMetric)
  );
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
  const allowedAssetIds = new Set(
    context.rawCaptureBundle.manifest.assets
      .filter(asset => asset.state === 'not-attempted')
      .map(asset => asset.id)
  );
  const candidates = new Map<string, ChatGptPageOwnedAssetCandidate>();
  const budget = createChatGptPageOwnedAssetAcquisitionBudget();
  let acquired = acquisitionFailure(context);
  let acquisitionFailed = false;
  if (allowedAssetIds.size === 0) return { resolution, acquired, acquisitionFailed };
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
  let interpreterPlanIds: string[] = [];
  if (dependencies.observeInterpreterResolvers !== undefined) {
    try {
      interpreterPlanIds = await planChatGptInterpreterAssetIds(context);
    } catch {
      addWarning(resolution.warnings, CHATGPT_ASSET_BINDING_FAILED_WARNING);
      return { resolution, acquired, acquisitionFailed };
    }
  }
  const interpreter = await observeInterpreterResolvers(context, dependencies);
  if (interpreter !== undefined) {
    addObservation(resolution, interpreter, candidates, allowedAssetIds, true);
  }
  const interpreterAssetIds = new Set([...interpreterPlanIds, ...candidates.keys()]);
  await acquireBatch(
    [...candidates.values()].sort((left, right) =>
      left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0
    )
  );
  const activeOwnedAssetIds = new Set<string>();
  const activeMetrics: ChatGptActiveResolverMetric[] = [];
  const applyActiveAttempt = async (active: ActiveAssetAttempt): Promise<void> => {
    activeMetrics.push(active.metric);
    acquired.records = applyChatGptActiveAssetFailure(
      acquired.records,
      active.assetId,
      active.response
    );
    if (active.response.success && active.response.data.candidate !== null) {
      const candidate = active.response.data.candidate;
      candidates.set(active.assetId, candidate);
      resolution.matched = true;
      await acquireBatch([candidate]);
      acquired.records = applyChatGptActiveAcquisitionFailure(acquired.records, active.assetId);
    }
  };
  const applyLibraryFamily = async (family: 'library-csv' | 'library-jpeg'): Promise<0 | 1> => {
    if (!hasAssetBudget(budget)) return 0;
    const active = await resolveOneUnattemptedAsset(
      context,
      dependencies,
      acquired.records,
      candidates,
      interpreterAssetIds,
      activeOwnedAssetIds,
      resolution,
      family
    );
    if (!active) return 0;
    await applyActiveAttempt(active);
    return 1;
  };
  const libraryCsvAttemptCount = await applyLibraryFamily('library-csv');
  const libraryJpegAttemptCount = await applyLibraryFamily('library-jpeg');
  if (dependencies.resolveActiveAsset !== undefined) {
    while (activeMetrics.length < CHATGPT_ACTIVE_IMAGE_BATCH_MAX_COUNT) {
      if (!hasAssetBudget(budget)) break;
      const active = await resolveOneUnattemptedAsset(
        context,
        dependencies,
        acquired.records,
        candidates,
        interpreterAssetIds,
        activeOwnedAssetIds,
        resolution
      );
      if (!active) break;
      await applyActiveAttempt(active);
    }
  } else if (activeMetrics.length === 0) {
    await observeOneUnattemptedPng(
      context,
      dependencies,
      acquired,
      candidates,
      interpreterAssetIds,
      resolution
    );
  }
  addActiveBatchAudit(resolution, activeMetrics, libraryJpegAttemptCount, libraryCsvAttemptCount);

  const remainingAssetIds = [...allowedAssetIds]
    .filter(
      assetId =>
        !interpreterAssetIds.has(assetId) &&
        !candidates.has(assetId) &&
        !activeOwnedAssetIds.has(assetId)
    )
    .sort();
  const hasUnresolvedAsset = remainingAssetIds.length > 0;
  if (hasUnresolvedAsset) {
    const legacy = await observeLegacyResolvers(context, dependencies, remainingAssetIds);
    addObservation(resolution, legacy, candidates, new Set(remainingAssetIds), false);
    await acquireBatch(
      [...candidates.values()]
        .filter(
          candidate =>
            !interpreterAssetIds.has(candidate.assetId) &&
            !activeOwnedAssetIds.has(candidate.assetId)
        )
        .sort((left, right) =>
          left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0
        )
    );
  }
  resolution.candidates = [...candidates.values()].sort((left, right) =>
    left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0
  );
  return {
    resolution,
    acquired: {
      ...acquired,
      records: applyInterpreterResolverDetails(
        acquired.records,
        interpreter && 'interpreterDetails' in interpreter ? interpreter.interpreterDetails : []
      ),
    },
    acquisitionFailed,
  };
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
      ...(companion.capturedAt !== undefined && { capturedAt: companion.capturedAt }),
      ...(dependencies.expectedSyncSettingsSnapshot !== undefined && {
        expectedSyncSettingsSnapshot: dependencies.expectedSyncSettingsSnapshot,
      }),
      assets,
      outputs,
      ...(dependencies.writeLedger && { writeLedger: dependencies.writeLedger }),
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
  const binaryResults = await persistAcquiredBinaries(
    companion,
    acquired.runtimeAssets,
    rawSuccessfulDestinations,
    dependencies
  );
  return {
    acquired,
    binaryResults,
    warnings: [
      ...resolution.warnings,
      ...(acquisitionFailed ? [CHATGPT_ASSET_ACQUISITION_FAILED_WARNING] : []),
      ...acquisitionOutcomeWarnings(acquired.records),
      ...stagedBinaryCleanupWarnings(binaryResults),
    ],
    activeResolverMetric: resolution.activeResolverMetric,
  };
}

// eslint-disable-next-line max-lines-per-function, complexity -- Snapshot evidence before final writes, expose it only after the same destination succeeds.
async function finalizeDestination(
  context: ChatGptAssetExportContext,
  noteFileName: string,
  destination: PersistentOutputDestination,
  acquired: AcquiredAssets,
  binaryResults: readonly StagedBinaryAssetResult[],
  activeResolverMetric: ChatGptActiveResolverAudit | undefined,
  archiveWarnings: readonly string[],
  dependencies: ChatGptAssetExportDependencies
): Promise<FinalizedDestination> {
  const state = reconcileChatGptDestinationAssets(acquired, binaryResults, destination);
  const warnings: string[] = [];
  if (state.binaryFailed) {
    warnings.push(
      `One or more ChatGPT attachments were not saved to ${destination}; the archive manifest records them as failed.`
    );
  }
  try {
    const builtDestination = dependencies.buildDestinationArchive
      ? await dependencies.buildDestinationArchive(
          context,
          state.records,
          state.runtimeAssets,
          activeResolverMetric,
          archiveWarnings
        )
      : dependencies.buildDestinationCompanion
        ? undefined
        : await buildChatGptBinaryAwareDestinationArchive(
            context,
            state.records,
            state.runtimeAssets,
            activeResolverMetric,
            archiveWarnings
          );
    const destinationCompanion = builtDestination
      ? builtDestination.companion
      : await dependencies.buildDestinationCompanion!(
          context,
          state.records,
          state.runtimeAssets,
          activeResolverMetric,
          archiveWarnings
        );
    const receipt = buildChatGptDestinationArchiveReceipt(
      destinationCompanion,
      destination,
      state.runtimeAssets
    );
    const localizationEvidence = await buildChatGptSandboxLocalizationEvidence(
      destinationCompanion,
      receipt
    );
    const outcome = await dependencies.persistArtifacts(
      destinationCompanion,
      noteFileName,
      'chatgpt',
      [destination],
      ['manifest', 'canonical'],
      dependencies.expectedSyncSettingsSnapshot,
      ...(dependencies.writeLedger ? [dependencies.writeLedger] : [])
    );
    const complete = outcome.activeOutputs.includes(destination);
    let fileArchivePresentation: FinalizedFileArchivePresentationEvidence | undefined;
    let filePresentation: FinalizedFilePresentationEvidence | undefined;
    if (
      complete &&
      destination === 'file' &&
      builtDestination &&
      dependencies.archivePresentationContext
    ) {
      try {
        fileArchivePresentation = await (
          dependencies.buildFileArchivePresentationEvidence ??
          buildFinalizedFileArchivePresentationEvidence
        )(
          dependencies.archivePresentationContext,
          builtDestination.archive,
          destinationCompanion,
          state.records.filter(record => record.state === 'fetched')
        );
      } catch {
        // Archive completion remains authoritative; HTML receives no weaker evidence.
      }
    }
    if (
      complete &&
      destination === 'file' &&
      builtDestination &&
      dependencies.presentationContext
    ) {
      try {
        filePresentation = await (
          dependencies.buildFilePresentationEvidence ?? buildFinalizedFilePresentationEvidence
        )(
          dependencies.presentationContext,
          builtDestination.archive,
          destinationCompanion,
          state.records.filter(record => record.state === 'fetched')
        );
      } catch {
        // Archive completion remains authoritative; HTML receives no weaker evidence.
      }
    }
    return {
      complete,
      ...(complete && { receipt }),
      ...(complete && localizationEvidence && { localizationEvidence }),
      ...(fileArchivePresentation && { fileArchivePresentation }),
      ...(filePresentation && { filePresentation }),
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
// eslint-disable-next-line max-lines-per-function, complexity -- The durable raw -> observe -> acquire -> per-destination finalization sequence is intentionally auditable end-to-end.
export async function persistChatGptDestinationHonestAttachments(
  context: ChatGptAssetExportContext,
  companion: ArchiveCompanionBundle,
  noteFileName: string,
  outputs: OutputDestination[],
  dependencies: ChatGptAssetExportDependencies
): Promise<ChatGptAssetExportResult> {
  const requested = persistentOutputs(outputs);
  if (requested.length === 0) {
    return {
      rawSuccessfulDestinations: [],
      completeDestinations: [],
      destinationReceipts: [],
      warnings: [],
    };
  }
  const originalRawBytes = await verifiedBoundRawBytes(context, companion);
  if (originalRawBytes === undefined) {
    return {
      rawSuccessfulDestinations: [],
      completeDestinations: [],
      destinationReceipts: [],
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
      ['raw'],
      dependencies.expectedSyncSettingsSnapshot,
      ...(dependencies.writeLedger ? [dependencies.writeLedger] : [])
    );
  } catch {
    return {
      rawSuccessfulDestinations: [],
      completeDestinations: [],
      destinationReceipts: [],
      warnings: [CHATGPT_ASSET_RAW_PERSISTENCE_FAILED_WARNING],
    };
  }
  const rawSuccessfulDestinations = rawOutcome.activeOutputs;
  const warnings = [...rawOutcome.warnings];
  if (rawSuccessfulDestinations.length === 0) {
    return {
      rawSuccessfulDestinations,
      completeDestinations: [],
      destinationReceipts: [],
      warnings,
    };
  }

  const assetAttempt: AssetAttempt = allowsChatGptAttachmentAcquisitionFromJsonBytes(
    originalRawBytes,
    context.routeFamily
  )
    ? await attemptAssets(context, companion, rawSuccessfulDestinations, dependencies)
    : {
        acquired: {
          records: context.rawCaptureBundle.manifest.assets.map(cloneRecord),
          runtimeAssets: [],
        },
        binaryResults: [],
        warnings: [CHATGPT_ASSET_OWNER_CONTEXT_SKIPPED_WARNING],
        archiveWarnings: [CHATGPT_ASSET_OWNER_CONTEXT_SKIPPED_WARNING],
      };
  const { acquired, binaryResults, activeResolverMetric, archiveWarnings = [] } = assetAttempt;
  warnings.push(...assetAttempt.warnings);

  const completeDestinations: PersistentOutputDestination[] = [];
  const destinationReceipts: ChatGptDestinationArchiveReceipt[] = [];
  const destinationLocalizationEvidence: ChatGptSandboxLocalizationEvidence[] = [];
  let fileArchivePresentation: FinalizedFileArchivePresentationEvidence | undefined;
  let filePresentation: FinalizedFilePresentationEvidence | undefined;
  for (const destination of rawSuccessfulDestinations) {
    const finalized = await finalizeDestination(
      context,
      noteFileName,
      destination,
      acquired,
      binaryResults,
      activeResolverMetric,
      archiveWarnings,
      dependencies
    );
    warnings.push(...finalized.warnings);
    if (finalized.complete) completeDestinations.push(destination);
    if (finalized.receipt && requested.includes(destination)) {
      destinationReceipts.push(finalized.receipt);
      if (finalized.localizationEvidence)
        destinationLocalizationEvidence.push(finalized.localizationEvidence);
    }
    if (destination === 'file' && finalized.filePresentation) {
      filePresentation = finalized.filePresentation;
    }
    if (destination === 'file' && finalized.fileArchivePresentation) {
      fileArchivePresentation = finalized.fileArchivePresentation;
    }
  }
  destinationReceipts.sort(
    (left, right) => requested.indexOf(left.destination) - requested.indexOf(right.destination)
  );
  return {
    rawSuccessfulDestinations,
    completeDestinations,
    destinationReceipts,
    ...(destinationLocalizationEvidence.length > 0 && { destinationLocalizationEvidence }),
    ...(fileArchivePresentation && { fileArchivePresentation }),
    ...(filePresentation && { filePresentation }),
    warnings,
  };
}
