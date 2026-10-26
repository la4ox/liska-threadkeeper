/**
 * Strict, credential-free boundary for the experimental ChatGPT opaque replay.
 *
 * The page-side observer may hold an authenticated Request clone briefly, but
 * this contract intentionally accepts only replay response bytes and bounded
 * outcome codes.  It never represents request headers, cookies, tokens, or
 * provider error text.
 */

import { canonicalBase64ByteLength } from './base64';
import { isChatGptRouteFamily, type ChatGptRouteFamily } from './chatgpt-owner-context';
import {
  CHATGPT_CAPTURE_ENDPOINT,
  CHATGPT_INLINE_CAPTURE_MAX_BYTES,
  isChatGptConversationId,
} from './chatgpt-capture-contract';

export const CHATGPT_OPAQUE_REPLAY_ERROR_CODES = [
  'invalid-conversation-id',
  'permission-unavailable',
  'nonce-unavailable',
  'nonce-invalid',
  'temporary-tab-create-failed',
  'temporary-tab-missing-id',
  'unexpected-origin',
  'unexpected-path',
  'temporary-tab-ready-timeout',
  'replay-result-timeout',
  'hook-state-failed',
  // No eligible source was claimed; this is not proof of no network request.
  'target-not-observed',
  'target-not-observed-singular-path-seen',
  'source-not-native-request',
  'init-security-sensitive',
  'init-security-sensitive-headers',
  'init-security-sensitive-headers-distinct',
  'init-security-sensitive-headers-native-distinct',
  'init-security-sensitive-headers-unbranded-shape',
  'init-security-sensitive-headers-unbranded-prototype',
  'init-security-sensitive-headers-unbranded-inherited',
  'init-security-sensitive-headers-unbranded-symbol',
  'init-security-sensitive-headers-unbranded-descriptor',
  'init-security-sensitive-headers-unbranded-accessor',
  'init-security-sensitive-headers-unbranded-limit',
  'init-security-sensitive-headers-unbranded-entry',
  'init-security-sensitive-headers-unbranded-unstable',
  'init-security-sensitive-headers-unbranded-reflection',
  'init-security-sensitive-body',
  'init-security-sensitive-method',
  'init-security-sensitive-credentials',
  'init-security-sensitive-multiple',
  'init-unsupported',
  'init-unsupported-prototype',
  'init-unsupported-inherited',
  'init-unsupported-symbol',
  'init-unsupported-member',
  'init-unsupported-accessor',
  'init-unsupported-reflection',
  'target-mismatch',
  'document-target-mismatch',
  'source-request-target-mismatch',
  'source-request-method-mismatch',
  'source-response-target-mismatch',
  'clone-failed',
  'authorization-absent',
  'credentials-rejected',
  'source-rejected',
  'source-http-error',
  'source-non-json',
  'source-response-timeout',
  'replay-construction-failed',
  'replay-dispatch-failed',
  'replay-rejected',
  'replay-http-error',
  'replay-non-json',
  'replay-response-timeout',
  'response-processing-failed',
  'payload-too-large',
  // Legacy/unknown outcome compatibility only; current page code emits phases.
  'timed-out',
  'replay-result-invalid',
  'response-integrity-invalid',
  'hash-unavailable',
] as const;

export type ChatGptOpaqueReplayErrorCode = (typeof CHATGPT_OPAQUE_REPLAY_ERROR_CODES)[number];

export interface ChatGptOpaqueReplayCapture {
  bodyBase64: string;
  byteLength: number;
  sha256: string;
  mediaType: string;
}

export type ChatGptOpaqueReplayHookResult =
  | { kind: 'ready' }
  | {
      kind: 'captured';
      conversationId: string;
      capture: ChatGptOpaqueReplayCapture;
      singularDispatchCount: 1;
    }
  | { kind: 'error'; code: ChatGptOpaqueReplayErrorCode; singularDispatchCount: 0 | 1 };

/** Equivalent to the ordinary capture artifact, but replay never emits resolvers. */
export interface ChatGptOpaqueReplayArtifact {
  routeFamily: ChatGptRouteFamily;
  bodyBase64: string;
  byteLength: number;
  sha256: string;
  mediaType: string;
  endpoint: typeof CHATGPT_CAPTURE_ENDPOINT;
  transientAssetResolvers: [];
}

export type ChatGptOpaqueReplayResponse =
  | { success: true; data: ChatGptOpaqueReplayArtifact }
  // A background deadline's count of 0 is unobserved/ambiguous, not safe to retry.
  | { success: false; code: ChatGptOpaqueReplayErrorCode; singularDispatchCount: 0 | 1 };

function hasExactOwnKeys(value: object, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length) return false;
  for (const expectedKey of expected) {
    let found = false;
    for (const key of keys) {
      if (key === expectedKey) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

function isJsonMediaType(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) return false;
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) <= 0x1f) return false;
  }
  const essence = value.split(';', 1)[0]?.trim().toLowerCase();
  return essence === 'application/json' || essence?.endsWith('+json') === true;
}

export function isChatGptOpaqueReplayCapture(value: unknown): value is ChatGptOpaqueReplayCapture {
  if (typeof value !== 'object' || value === null) return false;
  if (!hasExactOwnKeys(value, ['bodyBase64', 'byteLength', 'sha256', 'mediaType'])) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.bodyBase64 === 'string' &&
    Number.isSafeInteger(record.byteLength) &&
    (record.byteLength as number) >= 0 &&
    (record.byteLength as number) <= CHATGPT_INLINE_CAPTURE_MAX_BYTES &&
    canonicalBase64ByteLength(record.bodyBase64) === record.byteLength &&
    typeof record.sha256 === 'string' &&
    /^[a-f0-9]{64}$/i.test(record.sha256) &&
    isJsonMediaType(record.mediaType)
  );
}

/** Validate the exact nonce-scoped state read from MAIN world. */
export function isChatGptOpaqueReplayHookResult(
  value: unknown
): value is ChatGptOpaqueReplayHookResult {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.kind === 'ready') return hasExactOwnKeys(value, ['kind']);
  if (record.kind === 'captured') {
    return (
      hasExactOwnKeys(value, ['kind', 'conversationId', 'capture', 'singularDispatchCount']) &&
      isChatGptConversationId(record.conversationId) &&
      isChatGptOpaqueReplayCapture(record.capture) &&
      record.singularDispatchCount === 1
    );
  }
  return (
    record.kind === 'error' &&
    hasExactOwnKeys(value, ['kind', 'code', 'singularDispatchCount']) &&
    typeof record.code === 'string' &&
    (CHATGPT_OPAQUE_REPLAY_ERROR_CODES as readonly string[]).includes(record.code) &&
    (record.singularDispatchCount === 0 || record.singularDispatchCount === 1)
  );
}

function isExactEndpoint(value: unknown): value is typeof CHATGPT_CAPTURE_ENDPOINT {
  return (
    typeof value === 'object' &&
    value !== null &&
    hasExactOwnKeys(value, ['method', 'pathPattern']) &&
    (value as { method?: unknown }).method === CHATGPT_CAPTURE_ENDPOINT.method &&
    (value as { pathPattern?: unknown }).pathPattern === CHATGPT_CAPTURE_ENDPOINT.pathPattern
  );
}

function isExactEmptyResolverList(value: unknown): value is [] {
  return Array.isArray(value) && value.length === 0 && hasExactOwnKeys(value, ['length']);
}

/** Validate the replay core result before it can be adapted by any future route. */
export function isChatGptOpaqueReplayArtifact(
  value: unknown
): value is ChatGptOpaqueReplayArtifact {
  if (typeof value !== 'object' || value === null) return false;
  if (
    !hasExactOwnKeys(value, [
      'bodyBase64',
      'byteLength',
      'sha256',
      'mediaType',
      'endpoint',
      'routeFamily',
      'transientAssetResolvers',
    ])
  ) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    isChatGptOpaqueReplayCapture({
      bodyBase64: record.bodyBase64,
      byteLength: record.byteLength,
      sha256: record.sha256,
      mediaType: record.mediaType,
    }) &&
    isExactEndpoint(record.endpoint) &&
    isChatGptRouteFamily(record.routeFamily) &&
    isExactEmptyResolverList(record.transientAssetResolvers)
  );
}

export function createChatGptOpaqueReplayFailure(
  code: ChatGptOpaqueReplayErrorCode,
  singularDispatchCount: 0 | 1 = 0
): ChatGptOpaqueReplayResponse {
  return { success: false, code, singularDispatchCount };
}

/** Exact response validation for future callers; no message/UI integration exists yet. */
export function isChatGptOpaqueReplayResponse(
  value: unknown
): value is ChatGptOpaqueReplayResponse {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.success === true) {
    return (
      hasExactOwnKeys(value, ['success', 'data']) && isChatGptOpaqueReplayArtifact(record.data)
    );
  }
  return (
    record.success === false &&
    hasExactOwnKeys(value, ['success', 'code', 'singularDispatchCount']) &&
    typeof record.code === 'string' &&
    (CHATGPT_OPAQUE_REPLAY_ERROR_CODES as readonly string[]).includes(record.code) &&
    (record.singularDispatchCount === 0 || record.singularDispatchCount === 1)
  );
}
