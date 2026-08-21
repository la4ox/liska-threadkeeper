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
  type RawCaptureArtifact,
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
} from '../../lib/types';
import { hashCaptureManifest, sha256Hex } from './response';
import { requestChatGptConversationCapture } from './chatgpt-request';
import {
  matchChatGptPageOwnedAssetResolvers,
  type ChatGptPageOwnedAssetCandidate,
} from './chatgpt-asset-resolver';

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
  /** Ephemeral only: never serialized into raw, manifest, canonical, or Markdown. */
  transientAssetCandidates: ChatGptPageOwnedAssetCandidate[];
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
    mediaType: data.mediaType,
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

/**
 * Capture and integrity-check the complete ChatGPT graph, retaining raw,
 * manifest, and canonical companions before any presentation is selected.
 */
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

  return { archive: normalized.archive, archiveCompanion, transientAssetCandidates };
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
  const { archive, archiveCompanion } = await captureChatGptArchive(conversationId, dependencies);

  try {
    return {
      ...projectArchiveBranch(archive, { includeToolContent }),
      archiveCompanion,
    };
  } catch {
    throw new ChatGptCurrentBranchError('projection-failed', { archiveCompanion });
  }
}
