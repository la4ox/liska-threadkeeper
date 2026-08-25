/**
 * Content-side composition of a verified ChatGPT capture into the legacy
 * current-branch renderer contract.
 *
 * The background boundary already validates its response. This module repeats
 * the safety-critical checks before turning base64 text into bytes, then uses
 * the archive normalizer as the sole parser of the provider payload.
 */

import {
  buildCaptureManifest,
  ChatGptNormalizationError,
  normalizeChatGptCapture,
  validateCaptureBundleShape,
  verifyCaptureBundleIntegrity,
  type RawCaptureArtifact,
  type RawCaptureAsset,
  type RawCaptureAssetRecord,
  type RawCaptureArtifactRecord,
  type RawCaptureBundle,
  type LiskaThreadArchive,
} from '../../archive';
import { inventoryChatGptRawAssets } from '../../archive/normalizers/chatgpt/inventory';
import { projectArchiveBranch, type ArchiveProjectionResult } from '../archive-projection';
import {
  CHATGPT_CAPTURE_ENDPOINT,
  CHATGPT_CAPTURE_ERROR_CODES,
  CHATGPT_CAPTURE_ERROR_MESSAGES,
  CHATGPT_CAPTURE_MAX_BYTES,
  isChatGptCaptureResponse,
  isChatGptConversationId,
  type ChatGptCaptureResponse,
  type ChatGptTransientAssetResolver,
} from '../../lib/chatgpt-capture-contract';
import { bytesToBase64 } from '../../lib/image-utils';
import { canonicalBase64ByteLength } from '../../lib/base64';
import {
  ARCHIVE_COMPANION_RELATIVE_PATHS,
  type ArchiveCompanionArtifact,
  type ArchiveCompanionBundle,
  type ChatGptAssetExportContext,
} from '../../lib/types';
import { hashCaptureManifest, sha256Hex } from './response';
import { requestChatGptConversationCapture } from './chatgpt-request';
import {
  extractChatGptActiveResolverPlan,
  matchChatGptPageOwnedAssetResolvers,
  type ChatGptPageOwnedAssetCandidate,
} from './chatgpt-asset-resolver';
import { requestChatGptOpaqueResolverObservation } from './chatgpt-opaque-resolver-request';
import type { ChatGptOpaqueResolverResponse } from '../../lib/chatgpt-opaque-resolver-contract';
import { CHATGPT_ACTIVE_RESOLVER_MAX_COUNT } from '../../lib/chatgpt-active-resolver-contract';
import { probeChatGptActiveAssetResolvers } from './chatgpt-active-resolver-request';

const ARTIFACT_ID = 'conversation';
const ARTIFACT_PATH = 'responses/conversation.json';
const CAPTURE_ID_PREFIX = 'capture-chatgpt-';

export const CHATGPT_CURRENT_BRANCH_ERROR_CODES = [
  'invalid-conversation-id',
  'capture-failed',
  'capture-response-invalid',
  'capture-payload-invalid',
  'capture-id-unavailable',
  'capture-id-invalid',
  'runtime-message-failed',
  'capture-integrity-failed',
  'normalization-failed',
  'projection-failed',
] as const;

export type ChatGptCurrentBranchErrorCode =
  | (typeof CHATGPT_CURRENT_BRANCH_ERROR_CODES)[number]
  | (typeof CHATGPT_CAPTURE_ERROR_CODES)[number];

/** Stable, credential-free messages for failures local to this composition. */
export const CHATGPT_CURRENT_BRANCH_ERROR_MESSAGES: Readonly<
  Record<ChatGptCurrentBranchErrorCode, string>
> = {
  ...CHATGPT_CAPTURE_ERROR_MESSAGES,
  'invalid-conversation-id': 'ChatGPT conversation ID is invalid.',
  'capture-failed': 'Could not capture the complete ChatGPT conversation.',
  'capture-response-invalid': 'The ChatGPT capture response could not be verified.',
  'capture-payload-invalid': 'The ChatGPT capture payload could not be verified.',
  'capture-id-unavailable': 'Could not create a unique ChatGPT capture identifier.',
  'capture-id-invalid': 'Could not create a safe ChatGPT capture identifier.',
  'runtime-message-failed': 'The ChatGPT capture request could not reach the extension background.',
  'capture-integrity-failed': 'The ChatGPT capture integrity could not be verified.',
  'normalization-failed': 'The captured ChatGPT conversation could not be normalized.',
  'projection-failed': 'The captured ChatGPT conversation could not be projected.',
};

/** A bounded local error that never carries raw provider data or diagnostics. */
export class ChatGptCurrentBranchError extends Error {
  readonly code: ChatGptCurrentBranchErrorCode;
  readonly archiveCompanion?: ArchiveCompanionBundle;
  readonly detailCode?: string;

  constructor(
    code: ChatGptCurrentBranchErrorCode,
    options: { archiveCompanion?: ArchiveCompanionBundle; detailCode?: string } = {}
  ) {
    super(CHATGPT_CURRENT_BRANCH_ERROR_MESSAGES[code]);
    this.name = 'ChatGptCurrentBranchError';
    this.code = code;
    this.archiveCompanion = options.archiveCompanion;
    this.detailCode = options.detailCode;
  }
}

export interface ChatGptCurrentBranchDependencies {
  /** Injectable only for focused tests; production uses the runtime bridge. */
  requestCapture?: (
    conversationId: string,
    observeAssetResolvers?: boolean
  ) => Promise<ChatGptCaptureResponse>;
  /** Explicitly opt in only when the caller will consume transient candidates. */
  observeAssetResolvers?: boolean;
  /** Injectable only for focused tests; production uses crypto.randomUUID(). */
  createCaptureId?: () => string;
  /** Injectable clock keeps evidence metadata reproducible in focused tests. */
  now?: () => Date;
  /** Injectable only for focused tests; production uses the ChatGPT normalizer. */
  normalizeCapture?: typeof normalizeChatGptCapture;
}

/** A verified complete canonical archive plus its durable raw companions. */
export interface ChatGptArchiveCapture {
  archive: LiskaThreadArchive;
  archiveCompanion: ArchiveCompanionBundle;
  /** Runtime-only original evidence for a later opt-in attachment export pass. */
  assetExportContext?: ChatGptAssetExportContext;
  /** Ephemeral only: never serialized into raw, manifest, canonical, or Markdown. */
  transientAssetCandidates: ChatGptPageOwnedAssetCandidate[];
}

export const CHATGPT_ASSET_RECAPTURE_FAILED_WARNING =
  'ChatGPT attachment resolver recapture failed; attachments were not attempted.';
export const CHATGPT_ASSET_RECAPTURE_MISMATCH_WARNING =
  'ChatGPT attachment resolver recapture did not match the original capture; attachments were not attempted.';

export function chatGptActiveResolverProbeWarning(
  observedCount: number,
  requestedCount: number
): string {
  return `ChatGPT active resolver observed ${observedCount}/${requestedCount}; binary acquisition remains disabled.`;
}

function activeResolverProbeOnly(
  observedCount: number,
  requestedCount: number
): Extract<ChatGptAssetResolverObservation, { kind: 'probe-only' }> {
  const warning = chatGptActiveResolverProbeWarning(observedCount, requestedCount);
  // Count-only audit evidence survives the short toast lifetime without
  // exposing provider IDs, response bodies, URLs, or conversation content.
  console.info(`[G2O] ${warning}`);
  return { kind: 'probe-only', observedCount, requestedCount, warning };
}

export interface ChatGptActiveResolverMetric {
  observedCount: number;
  requestedCount: number;
}

function activeResolverMetricWarning(
  metric: ChatGptActiveResolverMetric | undefined
): string | undefined {
  if (metric === undefined) return undefined;
  if (
    !Number.isSafeInteger(metric.observedCount) ||
    !Number.isSafeInteger(metric.requestedCount) ||
    metric.observedCount < 0 ||
    metric.requestedCount < 0 ||
    metric.observedCount > metric.requestedCount ||
    metric.requestedCount > CHATGPT_ACTIVE_RESOLVER_MAX_COUNT
  ) {
    throw new ChatGptCurrentBranchError('capture-integrity-failed');
  }
  return chatGptActiveResolverProbeWarning(metric.observedCount, metric.requestedCount);
}

/**
 * Decode only canonical standard base64 without Node Buffer or an argument
 * spread. The btoa round-trip rejects decoder normalization such as missing
 * padding or alternate alphabets.
 */
function strictCanonicalBase64Bytes(value: string): Uint8Array | undefined {
  const expectedLength = canonicalBase64ByteLength(value);
  if (
    expectedLength === undefined ||
    expectedLength > CHATGPT_CAPTURE_MAX_BYTES ||
    typeof globalThis.atob !== 'function' ||
    typeof globalThis.btoa !== 'function'
  ) {
    return undefined;
  }

  try {
    const binary = globalThis.atob(value);
    if (binary.length !== expectedLength || globalThis.btoa(binary) !== value) return undefined;

    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return undefined;
  }
}

function captureTimestamp(now: (() => Date) | undefined): string {
  try {
    const value = (now ?? (() => new Date()))();
    const timestamp = value.toISOString();
    if (Number.isNaN(value.getTime())) throw new Error('invalid date');
    return timestamp;
  } catch {
    throw new ChatGptCurrentBranchError('capture-integrity-failed');
  }
}

function defaultCaptureId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new ChatGptCurrentBranchError('capture-id-unavailable');
  }
  return `${CAPTURE_ID_PREFIX}${globalThis.crypto.randomUUID()}`;
}

function captureId(createCaptureId: (() => string) | undefined): string {
  let value: string;
  try {
    value = (createCaptureId ?? defaultCaptureId)();
  } catch (error) {
    if (error instanceof ChatGptCurrentBranchError) throw error;
    throw new ChatGptCurrentBranchError('capture-id-unavailable');
  }

  if (
    typeof value !== 'string' ||
    !/^capture-chatgpt-[A-Za-z0-9][A-Za-z0-9_-]{0,239}$/.test(value)
  ) {
    throw new ChatGptCurrentBranchError('capture-id-invalid');
  }
  return value;
}

interface CapturedArtifact {
  artifact: RawCaptureArtifact;
  /** The raw provider string is retained verbatim for eventual archive persistence. */
  bodyBase64: string;
  /** Validated by the runtime contract; consumed only by the transient matcher. */
  transientAssetResolvers: ChatGptTransientAssetResolver[];
}

function captureArtifact(response: ChatGptCaptureResponse): CapturedArtifact {
  if (!isChatGptCaptureResponse(response)) {
    throw new ChatGptCurrentBranchError('capture-response-invalid');
  }
  if (!response.success) throw new ChatGptCurrentBranchError(response.code);

  const data = response.data;
  const bytes = strictCanonicalBase64Bytes(data.bodyBase64);
  if (
    !bytes ||
    bytes.byteLength !== data.byteLength ||
    bytes.byteLength > CHATGPT_CAPTURE_MAX_BYTES ||
    !/^[a-f0-9]{64}$/.test(data.sha256) ||
    data.endpoint.method !== CHATGPT_CAPTURE_ENDPOINT.method ||
    data.endpoint.pathPattern !== CHATGPT_CAPTURE_ENDPOINT.pathPattern
  ) {
    throw new ChatGptCurrentBranchError('capture-payload-invalid');
  }

  const record: RawCaptureArtifactRecord = {
    id: ARTIFACT_ID,
    relativePath: ARTIFACT_PATH,
    // The validated response may include JSON parameters such as charset;
    // archive companions use the canonical JSON media type for exact binding.
    mediaType: 'application/json',
    byteLength: bytes.byteLength,
    sha256: data.sha256,
    endpoint: CHATGPT_CAPTURE_ENDPOINT,
  };
  return {
    artifact: { record, bytes },
    bodyBase64: data.bodyBase64,
    transientAssetResolvers: data.transientAssetResolvers.map(resolver => ({ ...resolver })),
  };
}

async function verifyCapturedArtifactIntegrity(artifact: RawCaptureArtifact): Promise<void> {
  try {
    if ((await sha256Hex(artifact.bytes)) !== artifact.record.sha256.toLowerCase()) {
      throw new Error('hash mismatch');
    }
  } catch {
    throw new ChatGptCurrentBranchError('capture-integrity-failed');
  }
}

function isScriptingPermission(value: unknown): boolean {
  return Array.isArray(value) && value.includes('scripting');
}

/**
 * Content scripts can synchronously inspect their own static manifest. A
 * missing test/runtime API or a thrown manifest read means "not available".
 */
export function manifestAllowsChatGptStructuredCapture(): boolean {
  try {
    const manifest = globalThis.chrome?.runtime?.getManifest?.();
    return isScriptingPermission(manifest?.permissions);
  } catch {
    return false;
  }
}

async function requestCaptureResponse(
  conversationId: string,
  requestCapture: ChatGptCurrentBranchDependencies['requestCapture'],
  observeAssetResolvers: boolean
): Promise<ChatGptCaptureResponse> {
  try {
    return await (requestCapture ?? requestChatGptConversationCapture)(
      conversationId,
      observeAssetResolvers
    );
  } catch {
    throw new ChatGptCurrentBranchError('runtime-message-failed');
  }
}

function parseRawForInventory(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

async function buildCaptureBundle(
  conversationId: string,
  artifact: RawCaptureArtifact,
  transientAssetResolvers: readonly ChatGptTransientAssetResolver[],
  createCaptureId: (() => string) | undefined,
  now: (() => Date) | undefined
): Promise<{
  bundle: RawCaptureBundle;
  transientAssetCandidates: ChatGptPageOwnedAssetCandidate[];
}> {
  const raw = parseRawForInventory(artifact.bytes);
  const inventory = await inventoryChatGptRawAssets({
    raw,
    artifactId: ARTIFACT_ID,
    sha256: sha256Hex,
  });
  const manifest = buildCaptureManifest({
    captureId: captureId(createCaptureId),
    provider: 'chatgpt',
    conversationId,
    capturedAt: captureTimestamp(now),
    method: 'same-origin-api',
    artifacts: [artifact.record],
    assets: inventory.assets,
    completeness: {
      graph: 'complete',
      messages: 'complete',
      branches: 'complete',
      assets: inventory.completeness,
    },
    warnings: inventory.warnings,
  });
  const bundle: RawCaptureBundle = {
    manifest,
    artifacts: [{ record: manifest.artifacts[0], bytes: artifact.bytes }],
    assets: [],
  };
  const transientAssetCandidates = await matchChatGptPageOwnedAssetResolvers({
    raw,
    assets: manifest.assets,
    resolvers: transientAssetResolvers,
    sha256: sha256Hex,
  });
  return { bundle, transientAssetCandidates };
}

async function captureManifestSha256(bundle: RawCaptureBundle): Promise<string> {
  try {
    return await hashCaptureManifest(bundle.manifest);
  } catch {
    throw new ChatGptCurrentBranchError('capture-integrity-failed');
  }
}

function serializeJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}

async function archiveCompanionArtifact(
  kind: ArchiveCompanionArtifact['kind'],
  relativePath: string,
  bytes: Uint8Array,
  bodyBase64?: string
): Promise<ArchiveCompanionArtifact> {
  const base64 = bodyBase64 ?? bytesToBase64(bytes);
  return {
    kind,
    relativePath,
    mediaType: 'application/json',
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    bodyBase64: base64,
  };
}

/**
 * Assemble the durable evidence available before provider normalization.
 * The raw provider base64 is passed through unchanged, so a failed normalizer
 * never destroys the source snapshot needed for an offline repair.
 */
async function buildRawManifestCompanionBundle(
  bundle: RawCaptureBundle,
  rawBodyBase64: string
): Promise<ArchiveCompanionBundle> {
  const [raw] = bundle.artifacts;
  if (!raw) throw new ChatGptCurrentBranchError('capture-integrity-failed');
  assertJsonOnlyArchiveCompanionSafe(bundle);

  const manifestBytes = serializeJsonBytes(bundle.manifest);
  const conversationKey = await sha256Hex(new TextEncoder().encode(bundle.manifest.conversationId));
  const artifacts = await Promise.all([
    archiveCompanionArtifact('raw', ARCHIVE_COMPANION_RELATIVE_PATHS.raw, raw.bytes, rawBodyBase64),
    archiveCompanionArtifact('manifest', ARCHIVE_COMPANION_RELATIVE_PATHS.manifest, manifestBytes),
  ]);

  return {
    captureId: bundle.manifest.captureId,
    conversationKey,
    artifacts: artifacts as readonly [ArchiveCompanionArtifact, ArchiveCompanionArtifact],
  };
}

/** @internal Safety seam for the current JSON-only durable companion route. */
export function assertJsonOnlyArchiveCompanionSafe(bundle: RawCaptureBundle): void {
  try {
    validateCaptureBundleShape(bundle);
  } catch {
    throw new ChatGptCurrentBranchError('capture-integrity-failed');
  }
  // The current durable companion route writes JSON only. Fail closed if a
  // future acquisition path supplies verified asset bytes before binary
  // companion persistence is wired, rather than publishing dangling fetched
  // claims in manifest/canonical output.
  if (bundle.assets.length > 0 || bundle.manifest.assets.some(asset => asset.state === 'fetched')) {
    throw new ChatGptCurrentBranchError('capture-integrity-failed');
  }
}

async function appendCanonicalCompanion(
  companion: ArchiveCompanionBundle,
  archive: Awaited<ReturnType<typeof normalizeChatGptCapture>>['archive']
): Promise<ArchiveCompanionBundle> {
  const canonical = await archiveCompanionArtifact(
    'canonical',
    ARCHIVE_COMPANION_RELATIVE_PATHS.canonical,
    serializeJsonBytes(archive)
  );
  const [raw, manifest] = companion.artifacts;
  return {
    ...companion,
    artifacts: [raw, manifest, canonical],
  };
}

function safeNormalizerCode(error: unknown): string | undefined {
  return error instanceof ChatGptNormalizationError && /^[a-z0-9-]{1,64}$/.test(error.code)
    ? error.code
    : undefined;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function destinationAssetCompleteness(
  original: RawCaptureBundle['manifest']['completeness']['assets'],
  assets: readonly RawCaptureAssetRecord[]
): RawCaptureBundle['manifest']['completeness']['assets'] {
  if (original === 'unknown') return 'unknown';
  if (assets.every(asset => asset.state === 'not-attempted')) return 'not-attempted';
  return assets.every(asset => asset.state !== 'not-attempted') ? 'complete' : 'partial';
}

async function verifiedOriginalRaw(
  context: ChatGptAssetExportContext
): Promise<RawCaptureArtifact> {
  try {
    if (
      !isChatGptConversationId(context.conversationId) ||
      context.conversationId !== context.rawCaptureBundle.manifest.conversationId ||
      context.rawCaptureBundle.manifest.provider !== 'chatgpt'
    ) {
      throw new Error('context identity');
    }
    assertJsonOnlyArchiveCompanionSafe(context.rawCaptureBundle);
    if (context.rawCaptureBundle.artifacts.length !== 1) throw new Error('context artifact count');
    const raw = context.rawCaptureBundle.artifacts[0];
    if (!raw || bytesToBase64(raw.bytes) !== context.rawBodyBase64) {
      throw new Error('context raw body');
    }
    if (raw.record.id !== ARTIFACT_ID || raw.record.relativePath !== ARTIFACT_PATH) {
      throw new Error('context raw identity');
    }
    await verifyCaptureBundleIntegrity(context.rawCaptureBundle, sha256Hex);
    return raw;
  } catch {
    throw new ChatGptCurrentBranchError('capture-integrity-failed');
  }
}

/** Verify the original runtime-only source context before a later persistence binding. */
export async function verifyChatGptAssetExportContext(
  context: ChatGptAssetExportContext
): Promise<RawCaptureArtifact> {
  return verifiedOriginalRaw(context);
}

export type ChatGptAssetResolverObservation =
  | { kind: 'matched'; candidates: ChatGptPageOwnedAssetCandidate[] }
  | {
      kind: 'probe-only';
      observedCount: number;
      requestedCount: number;
      warning: string;
    }
  | { kind: 'recapture-failed'; warning: typeof CHATGPT_ASSET_RECAPTURE_FAILED_WARNING }
  | { kind: 'recapture-mismatch'; warning: typeof CHATGPT_ASSET_RECAPTURE_MISMATCH_WARNING };

export interface ChatGptAssetResolverObservationDependencies {
  /** Injectable only for focused tests; production uses the runtime bridge. */
  requestCapture?: ChatGptCurrentBranchDependencies['requestCapture'];
  /**
   * Explicit post-persistence opaque observer.  When supplied it is the only
   * resolver route: this path must never fall back to legacy raw recapture.
   */
  requestResolvers?: (conversationId: string) => Promise<ChatGptOpaqueResolverResponse>;
}

/**
 * Observe page-owned resolver responses only after the original raw companion
 * has reached a durable destination. Resolver URLs stay in this return value
 * only and are discarded before every persistence operation.
 */
// eslint-disable-next-line max-lines-per-function -- Both isolated resolver routes share one committed-raw verification boundary.
export async function observeChatGptAssetResolvers(
  context: ChatGptAssetExportContext,
  dependencies: ChatGptAssetResolverObservationDependencies = {}
): Promise<ChatGptAssetResolverObservation> {
  let original: RawCaptureArtifact;
  try {
    original = await verifiedOriginalRaw(context);
  } catch {
    return { kind: 'recapture-failed', warning: CHATGPT_ASSET_RECAPTURE_FAILED_WARNING };
  }

  try {
    if (dependencies.requestResolvers !== undefined) {
      const response = await dependencies.requestResolvers(context.conversationId);
      if (!response.success) {
        return { kind: 'recapture-failed', warning: CHATGPT_ASSET_RECAPTURE_FAILED_WARNING };
      }
      return {
        kind: 'matched',
        candidates: await matchChatGptPageOwnedAssetResolvers({
          raw: parseRawForInventory(original.bytes),
          assets: context.rawCaptureBundle.manifest.assets,
          resolvers: response.data.transientAssetResolvers,
          sha256: sha256Hex,
        }),
      };
    }
    const response = await requestCaptureResponse(
      context.conversationId,
      dependencies.requestCapture,
      true
    );
    const recaptured = captureArtifact(response);
    await verifyCapturedArtifactIntegrity(recaptured.artifact);
    if (
      recaptured.artifact.record.byteLength !== original.record.byteLength ||
      recaptured.artifact.record.sha256 !== original.record.sha256 ||
      recaptured.bodyBase64 !== context.rawBodyBase64 ||
      !bytesEqual(recaptured.artifact.bytes, original.bytes)
    ) {
      return { kind: 'recapture-mismatch', warning: CHATGPT_ASSET_RECAPTURE_MISMATCH_WARNING };
    }

    return {
      kind: 'matched',
      candidates: await matchChatGptPageOwnedAssetResolvers({
        raw: parseRawForInventory(original.bytes),
        assets: context.rawCaptureBundle.manifest.assets,
        resolvers: recaptured.transientAssetResolvers,
        sha256: sha256Hex,
      }),
    };
  } catch {
    return { kind: 'recapture-failed', warning: CHATGPT_ASSET_RECAPTURE_FAILED_WARNING };
  }
}

/**
 * Post-persistence route-C composition.  It verifies the original committed
 * raw context and correlates opaque resolver keys at exact raw pointers; it
 * does not request a second raw conversation capture.
 */
export async function observeChatGptAssetResolversViaOpaqueSource(
  context: ChatGptAssetExportContext
): Promise<ChatGptAssetResolverObservation> {
  return observeChatGptAssetResolvers(context, {
    requestResolvers: requestChatGptOpaqueResolverObservation,
  });
}

/**
 * Active resolver checkpoint for the raw-first attachment path. It extracts
 * IDs solely from ledger pointers and returns aggregate metrics, never
 * candidates or URLs, so callers cannot acquire or stage attachment bytes.
 */
export async function observeChatGptActiveAssetResolvers(
  context: ChatGptAssetExportContext
): Promise<ChatGptAssetResolverObservation> {
  let original: RawCaptureArtifact;
  try {
    original = await verifiedOriginalRaw(context);
  } catch {
    return { kind: 'recapture-failed', warning: CHATGPT_ASSET_RECAPTURE_FAILED_WARNING };
  }
  const plan = extractChatGptActiveResolverPlan(
    parseRawForInventory(original.bytes),
    context.rawCaptureBundle.manifest.assets
  );
  if (plan.providerFileIds.length === 0) {
    return activeResolverProbeOnly(0, 0);
  }
  try {
    const response = await probeChatGptActiveAssetResolvers(
      context.conversationId,
      plan.providerFileIds
    );
    const observedCount = response.success ? response.data.observedCount : 0;
    return activeResolverProbeOnly(observedCount, plan.providerFileIds.length);
  } catch {
    return activeResolverProbeOnly(0, plan.providerFileIds.length);
  }
}

/**
 * Rebuild one destination's manifest and canonical archive from the original
 * raw artifact and only those runtime binary bytes that completed in that
 * destination. Unlike the initial JSON-only builder, this accepts fetched
 * runtime assets and validates their byte/hash evidence before normalization.
 */
// eslint-disable-next-line max-lines-per-function -- One explicit validation-to-normalization path prevents fetched-byte claims from bypassing the archive contract.
export async function buildChatGptBinaryAwareArchiveCompanion(
  context: ChatGptAssetExportContext,
  assetRecords: readonly RawCaptureAssetRecord[],
  runtimeAssets: readonly RawCaptureAsset[],
  activeResolverMetric?: ChatGptActiveResolverMetric
): Promise<ArchiveCompanionBundle> {
  const originalRaw = await verifiedOriginalRaw(context);
  try {
    const originalManifest = context.rawCaptureBundle.manifest;
    const metricWarning = activeResolverMetricWarning(activeResolverMetric);
    const manifest = buildCaptureManifest({
      captureId: originalManifest.captureId,
      provider: originalManifest.provider,
      conversationId: originalManifest.conversationId,
      capturedAt: originalManifest.capturedAt,
      method: originalManifest.method,
      artifacts: originalManifest.artifacts,
      assets: [...assetRecords],
      completeness: {
        ...originalManifest.completeness,
        assets: destinationAssetCompleteness(originalManifest.completeness.assets, assetRecords),
      },
      warnings:
        metricWarning === undefined
          ? originalManifest.warnings
          : [...new Set([...originalManifest.warnings, metricWarning])],
      observedUnknownContentTypes: originalManifest.observedUnknownContentTypes,
    });
    const destinationRecords = new Map(manifest.assets.map(asset => [asset.id, asset]));
    const bundle: RawCaptureBundle = {
      manifest,
      artifacts: [
        {
          record: manifest.artifacts.find(record => record.id === ARTIFACT_ID)!,
          bytes: originalRaw.bytes,
        },
      ],
      assets: runtimeAssets.map(asset => {
        const record = destinationRecords.get(asset.record.id);
        if (!record) throw new Error('unknown runtime asset');
        return { record, bytes: asset.bytes };
      }),
    };
    validateCaptureBundleShape(bundle);
    await verifyCaptureBundleIntegrity(bundle, sha256Hex);
    const manifestSha256 = await captureManifestSha256(bundle);
    const rawManifest = await buildBinaryAwareRawManifestCompanionBundle(
      bundle,
      context.rawBodyBase64
    );
    const normalized = await normalizeChatGptCapture({
      bundle,
      artifactId: ARTIFACT_ID,
      manifestSha256,
      sha256: sha256Hex,
    });
    return appendCanonicalCompanion(rawManifest, normalized.archive);
  } catch {
    throw new ChatGptCurrentBranchError('capture-integrity-failed');
  }
}

async function buildBinaryAwareRawManifestCompanionBundle(
  bundle: RawCaptureBundle,
  rawBodyBase64: string
): Promise<ArchiveCompanionBundle> {
  const raw = bundle.artifacts.find(artifact => artifact.record.id === ARTIFACT_ID);
  if (!raw) throw new Error('missing raw');
  const manifestBytes = serializeJsonBytes(bundle.manifest);
  const conversationKey = await sha256Hex(new TextEncoder().encode(bundle.manifest.conversationId));
  const artifacts = await Promise.all([
    archiveCompanionArtifact('raw', ARCHIVE_COMPANION_RELATIVE_PATHS.raw, raw.bytes, rawBodyBase64),
    archiveCompanionArtifact('manifest', ARCHIVE_COMPANION_RELATIVE_PATHS.manifest, manifestBytes),
  ]);
  return {
    captureId: bundle.manifest.captureId,
    conversationKey,
    artifacts: artifacts as readonly [ArchiveCompanionArtifact, ArchiveCompanionArtifact],
  };
}

/**
 * Capture and integrity-check the complete ChatGPT graph, retaining raw,
 * manifest, and canonical companions before any presentation is selected.
 */
// eslint-disable-next-line max-lines-per-function -- Keep capture verification, raw preservation, and canonical normalization in their trust-boundary order.
export async function captureChatGptArchive(
  conversationId: string,
  dependencies: ChatGptCurrentBranchDependencies = {}
): Promise<ChatGptArchiveCapture> {
  if (!isChatGptConversationId(conversationId)) {
    throw new ChatGptCurrentBranchError('invalid-conversation-id');
  }

  const response = await requestCaptureResponse(
    conversationId,
    dependencies.requestCapture,
    dependencies.observeAssetResolvers === true
  );
  const captured = captureArtifact(response);
  await verifyCapturedArtifactIntegrity(captured.artifact);
  const { bundle, transientAssetCandidates } = await buildCaptureBundle(
    conversationId,
    captured.artifact,
    captured.transientAssetResolvers,
    dependencies.createCaptureId,
    dependencies.now
  );
  const manifestSha256 = await captureManifestSha256(bundle);
  let archiveCompanion: ArchiveCompanionBundle;
  try {
    archiveCompanion = await buildRawManifestCompanionBundle(bundle, captured.bodyBase64);
  } catch {
    throw new ChatGptCurrentBranchError('capture-integrity-failed');
  }

  let normalized: Awaited<ReturnType<typeof normalizeChatGptCapture>>;
  try {
    normalized = await (dependencies.normalizeCapture ?? normalizeChatGptCapture)({
      bundle,
      artifactId: ARTIFACT_ID,
      manifestSha256,
      sha256: sha256Hex,
    });
  } catch (error) {
    throw new ChatGptCurrentBranchError('normalization-failed', {
      archiveCompanion,
      detailCode: safeNormalizerCode(error),
    });
  }

  try {
    archiveCompanion = await appendCanonicalCompanion(archiveCompanion, normalized.archive);
  } catch {
    throw new ChatGptCurrentBranchError('capture-integrity-failed', { archiveCompanion });
  }

  return {
    archive: normalized.archive,
    archiveCompanion,
    assetExportContext: {
      conversationId,
      rawCaptureBundle: bundle,
      rawBodyBase64: captured.bodyBase64,
    },
    transientAssetCandidates,
  };
}

/**
 * Project one active ChatGPT graph branch through the established legacy
 * renderer contract. Complete canonical capture remains available to callers
 * of captureChatGptArchive.
 */
export async function captureChatGptCurrentBranch(
  conversationId: string,
  includeToolContent: boolean,
  dependencies: ChatGptCurrentBranchDependencies = {}
): Promise<ArchiveProjectionResult> {
  const { archive, archiveCompanion, assetExportContext } = await captureChatGptArchive(
    conversationId,
    dependencies
  );

  try {
    return {
      ...projectArchiveBranch(archive, { includeToolContent }),
      archiveCompanion,
      chatGptAssetExportContext: assetExportContext,
    };
  } catch {
    throw new ChatGptCurrentBranchError('projection-failed', { archiveCompanion });
  }
}
