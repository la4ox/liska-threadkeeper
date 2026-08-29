/**
 * Strict transient boundary for ChatGPT interpreter download resolution.
 * Candidate metadata exists only for the one foreground-tab request and is
 * never published by the MAIN-world hook. The response contains only a
 * deterministic subset of the caller's asset IDs and validated estuary URLs.
 */

import { canonicalBase64ByteLength } from './base64';
import { isChatGptConversationId, isChatGptTransientDownloadUrl } from './chatgpt-capture-contract';
import { isSafeStagedBinaryAssetId } from './binary-asset-contract';

export const CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT = 20;
export const CHATGPT_INTERPRETER_RESOLVER_MAX_BYTES = 64 * 1024;

export const CHATGPT_INTERPRETER_RESOLVER_ERROR_CODES = [
  'invalid-conversation-id',
  'invalid-interpreter-candidates',
  'permission-unavailable',
  'nonce-invalid',
  'temporary-tab-create-failed',
  'temporary-tab-missing-id',
  'unexpected-origin',
  'unexpected-path',
  'temporary-tab-ready-timeout',
  'document-id-missing',
  'command-rejected',
  'source-not-eligible',
  'source-rejected',
  'source-http-error',
  'source-non-json',
  'interpreter-result-timeout',
  'interpreter-result-invalid',
] as const;

export type ChatGptInterpreterResolverErrorCode =
  (typeof CHATGPT_INTERPRETER_RESOLVER_ERROR_CODES)[number];

export interface ChatGptInterpreterAssetCandidate {
  assetId: string;
  messageId: string;
  sandboxPath: string;
}

export interface ChatGptInterpreterResolvedAsset {
  assetId: string;
  downloadUrl: string;
}

export interface ChatGptInterpreterResolverCapture {
  bodyBase64: string;
  byteLength: number;
  sha256: string;
  mediaType: string;
}

export type ChatGptInterpreterResolverOutcome =
  | { state: 'observed'; capture: ChatGptInterpreterResolverCapture }
  | {
      state:
        | 'http-error'
        | 'fetch-rejected'
        | 'response-processing-rejected'
        | 'non-json'
        | 'oversized'
        | 'timed-out'
        | 'not-dispatched';
    };

/** MAIN-to-background only: ordinal captures/outcomes, never candidates. */
export type ChatGptInterpreterResolverHookResult =
  | { kind: 'ready' }
  | {
      kind: 'complete';
      conversationId: string;
      requestedCount: number;
      dispatchCount: number;
      outcomes: ChatGptInterpreterResolverOutcome[];
    }
  | { kind: 'error'; code: ChatGptInterpreterResolverErrorCode };

export type ChatGptInterpreterResolverResponse =
  | { success: true; data: { resolved: ChatGptInterpreterResolvedAsset[] } }
  | { success: false; code: ChatGptInterpreterResolverErrorCode };

const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const SANDBOX_PATH_PREFIX = '/mnt/data/';

function hasExactOwnKeys(value: object, expected: readonly string[]): boolean {
  try {
    const keys = Reflect.ownKeys(value);
    return (
      keys.length === expected.length &&
      expected.every(key => keys.some(valueKey => valueKey === key))
    );
  } catch {
    return false;
  }
}

export function isChatGptInterpreterMessageId(value: unknown): value is string {
  return typeof value === 'string' && MESSAGE_ID_PATTERN.test(value);
}

/** Retain raw Unicode query values, but reject controls, separators, and traversal. */
export function isChatGptInterpreterSandboxPath(value: unknown): value is string {
  const hasUnsafeCharacter =
    typeof value === 'string' &&
    Array.from(value).some(character => {
      const code = character.codePointAt(0) ?? 0;
      return (
        code <= 0x1f ||
        (code >= 0x7f && code <= 0x9f) ||
        (code >= 0xd800 && code <= 0xdfff) ||
        character === '\\'
      );
    });
  if (
    typeof value !== 'string' ||
    !value.startsWith(SANDBOX_PATH_PREFIX) ||
    value.length <= SANDBOX_PATH_PREFIX.length ||
    value.length > 4 * 1024 ||
    hasUnsafeCharacter
  ) {
    return false;
  }
  return value
    .slice(SANDBOX_PATH_PREFIX.length)
    .split('/')
    .every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

export function isChatGptInterpreterAssetCandidate(
  value: unknown
): value is ChatGptInterpreterAssetCandidate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!hasExactOwnKeys(value, ['assetId', 'messageId', 'sandboxPath'])) return false;
  const record = value as Record<string, unknown>;
  return (
    isSafeStagedBinaryAssetId(record.assetId) &&
    isChatGptInterpreterMessageId(record.messageId) &&
    isChatGptInterpreterSandboxPath(record.sandboxPath)
  );
}

export function isChatGptInterpreterCandidates(
  value: unknown
): value is ChatGptInterpreterAssetCandidate[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT
  ) {
    return false;
  }
  const assetIds = new Set<string>();
  const messagePaths = new Set<string>();
  for (const candidate of value) {
    if (!isChatGptInterpreterAssetCandidate(candidate) || assetIds.has(candidate.assetId))
      return false;
    const messagePath = `${candidate.messageId}\0${candidate.sandboxPath}`;
    if (messagePaths.has(messagePath)) return false;
    assetIds.add(candidate.assetId);
    messagePaths.add(messagePath);
  }
  return true;
}

export function isChatGptInterpreterResolverCapture(
  value: unknown
): value is ChatGptInterpreterResolverCapture {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!hasExactOwnKeys(value, ['bodyBase64', 'byteLength', 'sha256', 'mediaType'])) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.bodyBase64 === 'string' &&
    Number.isSafeInteger(record.byteLength) &&
    (record.byteLength as number) >= 0 &&
    (record.byteLength as number) <= CHATGPT_INTERPRETER_RESOLVER_MAX_BYTES &&
    canonicalBase64ByteLength(record.bodyBase64) === record.byteLength &&
    typeof record.sha256 === 'string' &&
    /^[a-f0-9]{64}$/i.test(record.sha256) &&
    typeof record.mediaType === 'string' &&
    record.mediaType.length > 0 &&
    record.mediaType.length <= 255
  );
}

function isOutcome(value: unknown): value is ChatGptInterpreterResolverOutcome {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.state === 'observed') {
    return (
      hasExactOwnKeys(value, ['state', 'capture']) &&
      isChatGptInterpreterResolverCapture(record.capture)
    );
  }
  return (
    hasExactOwnKeys(value, ['state']) &&
    typeof record.state === 'string' &&
    [
      'http-error',
      'fetch-rejected',
      'response-processing-rejected',
      'non-json',
      'oversized',
      'timed-out',
      'not-dispatched',
    ].includes(record.state)
  );
}

// eslint-disable-next-line complexity -- Exact untrusted hook-state validation is intentionally linear.
export function isChatGptInterpreterResolverHookResult(
  value: unknown
): value is ChatGptInterpreterResolverHookResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.kind === 'ready') return hasExactOwnKeys(value, ['kind']);
  if (record.kind === 'error') {
    return (
      hasExactOwnKeys(value, ['kind', 'code']) &&
      typeof record.code === 'string' &&
      (CHATGPT_INTERPRETER_RESOLVER_ERROR_CODES as readonly string[]).includes(record.code)
    );
  }
  if (
    record.kind !== 'complete' ||
    !hasExactOwnKeys(value, [
      'kind',
      'conversationId',
      'requestedCount',
      'dispatchCount',
      'outcomes',
    ]) ||
    !isChatGptConversationId(record.conversationId) ||
    !Number.isSafeInteger(record.requestedCount) ||
    !Number.isSafeInteger(record.dispatchCount) ||
    (record.requestedCount as number) < 0 ||
    (record.requestedCount as number) > CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT ||
    (record.dispatchCount as number) < 0 ||
    (record.dispatchCount as number) > (record.requestedCount as number) ||
    !Array.isArray(record.outcomes) ||
    record.outcomes.length !== record.requestedCount ||
    !record.outcomes.every(isOutcome)
  ) {
    return false;
  }
  return record.outcomes.every((outcome, ordinal) => {
    const state = (outcome as ChatGptInterpreterResolverOutcome).state;
    return ordinal < (record.dispatchCount as number)
      ? state !== 'not-dispatched'
      : state === 'not-dispatched';
  });
}

export function isChatGptInterpreterResolvedAsset(
  value: unknown,
  conversationId?: string
): value is ChatGptInterpreterResolvedAsset {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!hasExactOwnKeys(value, ['assetId', 'downloadUrl'])) return false;
  const record = value as Record<string, unknown>;
  return (
    isSafeStagedBinaryAssetId(record.assetId) &&
    isChatGptTransientDownloadUrl(record.downloadUrl, conversationId)
  );
}

export function createChatGptInterpreterResolverFailure(
  code: ChatGptInterpreterResolverErrorCode
): ChatGptInterpreterResolverResponse {
  return { success: false, code };
}

export function isChatGptInterpreterResolverResponse(
  value: unknown
): value is ChatGptInterpreterResolverResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.success === false) {
    return (
      hasExactOwnKeys(value, ['success', 'code']) &&
      typeof record.code === 'string' &&
      (CHATGPT_INTERPRETER_RESOLVER_ERROR_CODES as readonly string[]).includes(record.code)
    );
  }
  if (
    record.success !== true ||
    !hasExactOwnKeys(value, ['success', 'data']) ||
    typeof record.data !== 'object' ||
    record.data === null ||
    Array.isArray(record.data) ||
    !hasExactOwnKeys(record.data, ['resolved'])
  ) {
    return false;
  }
  const resolved = (record.data as Record<string, unknown>).resolved;
  if (!Array.isArray(resolved) || resolved.length > CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT)
    return false;
  const assetIds = new Set<string>();
  return resolved.every(asset => {
    if (!isChatGptInterpreterResolvedAsset(asset) || assetIds.has(asset.assetId)) return false;
    assetIds.add(asset.assetId);
    return true;
  });
}
