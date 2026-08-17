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
  normalizeChatGptCapture,
  type RawCaptureArtifact,
  type RawCaptureArtifactRecord,
  type RawCaptureBundle,
} from '../../archive';
import { projectArchiveBranch, type ArchiveProjectionResult } from '../archive-projection';
import {
  CHATGPT_CAPTURE_ENDPOINT,
  CHATGPT_CAPTURE_MAX_BYTES,
  isChatGptCaptureResponse,
  isChatGptConversationId,
  type ChatGptCaptureResponse,
} from '../../lib/chatgpt-capture-contract';
import { hashCaptureManifest, sha256Hex } from './response';
import { requestChatGptConversationCapture } from './chatgpt-request';

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
  'capture-integrity-failed',
  'normalization-failed',
  'projection-failed',
] as const;

export type ChatGptCurrentBranchErrorCode = (typeof CHATGPT_CURRENT_BRANCH_ERROR_CODES)[number];

/** Stable, credential-free messages for failures local to this composition. */
export const CHATGPT_CURRENT_BRANCH_ERROR_MESSAGES: Readonly<
  Record<ChatGptCurrentBranchErrorCode, string>
> = {
  'invalid-conversation-id': 'ChatGPT conversation ID is invalid.',
  'capture-failed': 'Could not capture the complete ChatGPT conversation.',
  'capture-response-invalid': 'The ChatGPT capture response could not be verified.',
  'capture-payload-invalid': 'The ChatGPT capture payload could not be verified.',
  'capture-id-unavailable': 'Could not create a unique ChatGPT capture identifier.',
  'capture-id-invalid': 'Could not create a safe ChatGPT capture identifier.',
  'capture-integrity-failed': 'The ChatGPT capture integrity could not be verified.',
  'normalization-failed': 'The captured ChatGPT conversation could not be normalized.',
  'projection-failed': 'The captured ChatGPT conversation could not be projected.',
};

/** A bounded local error that never carries raw provider data or diagnostics. */
export class ChatGptCurrentBranchError extends Error {
  readonly code: ChatGptCurrentBranchErrorCode;

  constructor(code: ChatGptCurrentBranchErrorCode) {
    super(CHATGPT_CURRENT_BRANCH_ERROR_MESSAGES[code]);
    this.name = 'ChatGptCurrentBranchError';
    this.code = code;
  }
}

export interface ChatGptCurrentBranchDependencies {
  /** Injectable only for focused tests; production uses the runtime bridge. */
  requestCapture?: (conversationId: string) => Promise<ChatGptCaptureResponse>;
  /** Injectable only for focused tests; production uses crypto.randomUUID(). */
  createCaptureId?: () => string;
  /** Injectable clock keeps evidence metadata reproducible in focused tests. */
  now?: () => Date;
}

function base64ByteLength(value: string): number | undefined {
  if (!/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i.test(value)) {
    return undefined;
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

/**
 * Decode only canonical standard base64 without Node Buffer or an argument
 * spread. The btoa round-trip rejects decoder normalization such as missing
 * padding or alternate alphabets.
 */
function strictCanonicalBase64Bytes(value: string): Uint8Array | undefined {
  const expectedLength = base64ByteLength(value);
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
    !/^capture-chatgpt-[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(value)
  ) {
    throw new ChatGptCurrentBranchError('capture-id-invalid');
  }
  return value;
}

function captureArtifact(response: ChatGptCaptureResponse): RawCaptureArtifact {
  if (!isChatGptCaptureResponse(response)) {
    throw new ChatGptCurrentBranchError('capture-response-invalid');
  }
  if (!response.success) throw new ChatGptCurrentBranchError('capture-failed');

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
  return { record, bytes };
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
  requestCapture: ChatGptCurrentBranchDependencies['requestCapture']
): Promise<ChatGptCaptureResponse> {
  try {
    return await (requestCapture ?? requestChatGptConversationCapture)(conversationId);
  } catch {
    throw new ChatGptCurrentBranchError('capture-failed');
  }
}

function buildCaptureBundle(
  conversationId: string,
  artifact: RawCaptureArtifact,
  createCaptureId: (() => string) | undefined,
  now: (() => Date) | undefined
): RawCaptureBundle {
  const manifest = buildCaptureManifest({
    captureId: captureId(createCaptureId),
    provider: 'chatgpt',
    conversationId,
    capturedAt: captureTimestamp(now),
    method: 'same-origin-api',
    artifacts: [artifact.record],
    assets: [],
    completeness: {
      graph: 'complete',
      messages: 'complete',
      branches: 'complete',
      assets: 'not-attempted',
    },
  });
  return {
    manifest,
    artifacts: [{ record: manifest.artifacts[0], bytes: artifact.bytes }],
  };
}

async function normalizeVerifiedBundle(bundle: RawCaptureBundle) {
  let manifestSha256: string;
  try {
    manifestSha256 = await hashCaptureManifest(bundle.manifest);
  } catch {
    throw new ChatGptCurrentBranchError('capture-integrity-failed');
  }

  try {
    return await normalizeChatGptCapture({
      bundle,
      artifactId: ARTIFACT_ID,
      manifestSha256,
      sha256: sha256Hex,
    });
  } catch {
    throw new ChatGptCurrentBranchError('normalization-failed');
  }
}

/**
 * Capture, integrity-check, normalize, and project exactly one active ChatGPT
 * graph branch. The complete graph remains in the ephemeral canonical archive;
 * callers receive only the established legacy projection contract.
 */
export async function captureChatGptCurrentBranch(
  conversationId: string,
  includeToolContent: boolean,
  dependencies: ChatGptCurrentBranchDependencies = {}
): Promise<ArchiveProjectionResult> {
  if (!isChatGptConversationId(conversationId)) {
    throw new ChatGptCurrentBranchError('invalid-conversation-id');
  }

  const response = await requestCaptureResponse(conversationId, dependencies.requestCapture);
  const artifact = captureArtifact(response);
  const bundle = buildCaptureBundle(
    conversationId,
    artifact,
    dependencies.createCaptureId,
    dependencies.now
  );
  const archive = await normalizeVerifiedBundle(bundle);

  try {
    return projectArchiveBranch(archive.archive, { includeToolContent });
  } catch {
    throw new ChatGptCurrentBranchError('projection-failed');
  }
}
