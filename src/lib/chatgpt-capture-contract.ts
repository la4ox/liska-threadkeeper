/**
 * Serializable boundary contract for a bounded ChatGPT conversation capture.
 *
 * This module intentionally has no Chrome dependency so both the background
 * capture primitive and content-to-background bridge share one exact shape.
 */

import { canonicalBase64ByteLength } from './base64';

/** Hard byte ceiling for the exact response captured from ChatGPT. */
export const CHATGPT_CAPTURE_MAX_BYTES = 16 * 1024 * 1024;

/** A capture can surface at most this many transient, page-observed resolvers. */
export const CHATGPT_TRANSIENT_ASSET_RESOLVERS_MAX_COUNT = 32;

const CHATGPT_TRANSIENT_ASSET_DOWNLOAD_URL_MAX_LENGTH = 8 * 1024;
const CHATGPT_TRANSIENT_ASSET_DOWNLOAD_URL_BASE = 'https://chatgpt.com/backend-api/estuary/content';
const CHATGPT_TRANSIENT_ASSET_DOWNLOAD_URL_QUERY_KEYS = [
  'cid',
  'id',
  'p',
  'sig',
  'ts',
  'v',
] as const;

/** The only provider endpoint represented by this capture bridge. */
export const CHATGPT_CAPTURE_ENDPOINT = {
  method: 'GET' as const,
  pathPattern: '/backend-api/conversation/{conversationId}' as const,
};

export const CHATGPT_CAPTURE_ERROR_CODES = [
  'invalid-conversation-id',
  'permission-unavailable',
  'temporary-tab-create-failed',
  'temporary-tab-missing-id',
  'unexpected-origin',
  'unexpected-path',
  'unexpected-readiness',
  'nonce-unavailable',
  'nonce-invalid',
  'hash-unavailable',
  'response-integrity-invalid',
  'captured-conversation-id-mismatch',
  'background-capture-exception',
  'capture-response-validation-exception',
  'temporary-tab-ready-timeout',
  'conversation-request-timeout',
  'conversation-response-timeout',
  'capture-result-timeout',
  'hook-injection-rejected',
  'hook-result-invalid',
  'hook-install-failed',
  'hook-state-failed',
  'request-failed',
  'response-http-error',
  'response-media-type-invalid',
  'response-processing-failed',
  'timed-out',
  'payload-too-large',
  'capture-failed',
  'unexpected-capture-result',
] as const;

export type ChatGptCaptureErrorCode = (typeof CHATGPT_CAPTURE_ERROR_CODES)[number];

/** Stable, non-diagnostic text safe to cross the extension message boundary. */
export const CHATGPT_CAPTURE_ERROR_MESSAGES: Readonly<Record<ChatGptCaptureErrorCode, string>> = {
  'invalid-conversation-id': 'ChatGPT conversation ID is invalid.',
  'permission-unavailable':
    'ChatGPT capture is unavailable because the required extension permission is missing.',
  'temporary-tab-create-failed': 'Could not create the temporary ChatGPT tab.',
  'temporary-tab-missing-id': 'The temporary ChatGPT tab has no usable ID.',
  'unexpected-origin': 'The temporary tab is not on the ChatGPT origin.',
  'unexpected-path': 'The temporary tab did not remain on the requested ChatGPT conversation.',
  'unexpected-readiness': 'The temporary ChatGPT tab returned an invalid readiness state.',
  'nonce-unavailable': 'A safe temporary ChatGPT capture identifier could not be created.',
  'nonce-invalid': 'The temporary ChatGPT capture identifier was invalid.',
  'hash-unavailable': 'SHA-256 verification was unavailable for the ChatGPT capture.',
  'response-integrity-invalid': 'The captured ChatGPT response failed integrity verification.',
  'captured-conversation-id-mismatch':
    'The captured ChatGPT conversation did not match the requested conversation.',
  'background-capture-exception': 'The ChatGPT background capture failed unexpectedly.',
  'capture-response-validation-exception':
    'The ChatGPT capture response could not be validated by the extension background.',
  'temporary-tab-ready-timeout': 'Timed out waiting for the temporary ChatGPT tab to load.',
  'conversation-request-timeout':
    'Timed out waiting for ChatGPT to request the conversation graph.',
  'conversation-response-timeout':
    'Timed out while ChatGPT was returning or processing the conversation graph.',
  'capture-result-timeout': 'Timed out waiting for the verified ChatGPT capture result.',
  'hook-injection-rejected': 'The browser rejected the temporary ChatGPT capture script.',
  'hook-result-invalid': 'The temporary ChatGPT capture script returned an invalid result.',
  'hook-install-failed': 'Could not install the temporary ChatGPT capture hook.',
  'hook-state-failed': 'Could not initialize the temporary ChatGPT capture state.',
  'request-failed': 'The temporary ChatGPT conversation request failed.',
  'response-http-error': 'The temporary ChatGPT conversation request was unsuccessful.',
  'response-media-type-invalid': 'The temporary ChatGPT conversation response was not JSON.',
  'response-processing-failed':
    'The temporary ChatGPT conversation response could not be verified.',
  'timed-out': 'Timed out waiting for the ChatGPT conversation response.',
  'payload-too-large': 'The ChatGPT conversation response exceeds the safety limit.',
  'capture-failed': 'Could not capture the ChatGPT conversation response.',
  'unexpected-capture-result': 'The temporary ChatGPT capture returned an invalid result.',
};

export interface ChatGptCaptureArtifact {
  bodyBase64: string;
  byteLength: number;
  sha256: string;
  mediaType: string;
  endpoint: typeof CHATGPT_CAPTURE_ENDPOINT;
  transientAssetResolvers: ChatGptTransientAssetResolver[];
}

/**
 * An ephemeral, page-observed resolver that is safe to pass onward without
 * exposing a provider file ID or the resolver response body.
 */
export interface ChatGptTransientAssetResolver {
  resolverKey: string;
  downloadUrl: string;
}

export type ChatGptCaptureResponse =
  | { success: true; data: ChatGptCaptureArtifact }
  | { success: false; code: ChatGptCaptureErrorCode; error: string };

/** Strict ChatGPT conversation UUID validation for untrusted extension messages. */
export function isChatGptConversationId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

function isJsonMediaType(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (
    value.length === 0 ||
    value.length > 255 ||
    Array.from(value).some(character => (character.codePointAt(0) ?? 0) <= 0x1f)
  ) {
    return false;
  }
  const essence = value.split(';', 1)[0]?.trim().toLowerCase();
  return essence === 'application/json' || essence?.endsWith('+json') === true;
}

function isExactEndpoint(value: unknown): value is typeof CHATGPT_CAPTURE_ENDPOINT {
  return (
    typeof value === 'object' &&
    value !== null &&
    hasExactKeys(value, ['method', 'pathPattern']) &&
    (value as { method?: unknown }).method === CHATGPT_CAPTURE_ENDPOINT.method &&
    (value as { pathPattern?: unknown }).pathPattern === CHATGPT_CAPTURE_ENDPOINT.pathPattern
  );
}

// eslint-disable-next-line complexity, max-lines-per-function -- Keep the exact raw and parsed URL grammar together at both runtime boundaries.
export function isChatGptTransientDownloadUrl(
  value: unknown,
  expectedConversationId?: string
): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > CHATGPT_TRANSIENT_ASSET_DOWNLOAD_URL_MAX_LENGTH
  ) {
    return false;
  }

  const querySeparator = value.indexOf('?');
  if (
    querySeparator !== CHATGPT_TRANSIENT_ASSET_DOWNLOAD_URL_BASE.length ||
    value.slice(0, querySeparator) !== CHATGPT_TRANSIENT_ASSET_DOWNLOAD_URL_BASE
  ) {
    return false;
  }
  const url = new URL(value);
  if (
    url.origin !== 'https://chatgpt.com' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/backend-api/estuary/content' ||
    url.hash !== ''
  ) {
    return false;
  }

  const rawPairs = url.search.length === 0 ? [] : url.search.slice(1).split('&');
  if (rawPairs.length !== CHATGPT_TRANSIENT_ASSET_DOWNLOAD_URL_QUERY_KEYS.length) return false;

  const seen = new Set<string>();
  for (const rawPair of rawPairs) {
    const separator = rawPair.indexOf('=');
    if (separator <= 0) return false;
    const key = rawPair.slice(0, separator);
    if (
      !CHATGPT_TRANSIENT_ASSET_DOWNLOAD_URL_QUERY_KEYS.includes(
        key as (typeof CHATGPT_TRANSIENT_ASSET_DOWNLOAD_URL_QUERY_KEYS)[number]
      ) ||
      seen.has(key)
    ) {
      return false;
    }
    seen.add(key);
  }

  const conversationId = url.searchParams.get('cid');
  return (
    CHATGPT_TRANSIENT_ASSET_DOWNLOAD_URL_QUERY_KEYS.every(key => {
      const parameter = url.searchParams.get(key);
      return parameter !== null && parameter.length > 0 && parameter.length <= 2_048;
    }) &&
    isChatGptConversationId(conversationId) &&
    (expectedConversationId === undefined || conversationId === expectedConversationId)
  );
}

/** Strict transient resolver boundary: opaque key plus one allowlisted URL only. */
export function isChatGptTransientAssetResolver(
  value: unknown
): value is ChatGptTransientAssetResolver {
  if (typeof value !== 'object' || value === null) return false;
  if (!hasExactKeys(value, ['resolverKey', 'downloadUrl'])) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.resolverKey === 'string' &&
    /^[a-f0-9]{64}$/.test(record.resolverKey) &&
    isChatGptTransientDownloadUrl(record.downloadUrl)
  );
}

function isChatGptTransientAssetResolvers(
  value: unknown
): value is ChatGptTransientAssetResolver[] {
  if (!Array.isArray(value) || value.length > CHATGPT_TRANSIENT_ASSET_RESOLVERS_MAX_COUNT) {
    return false;
  }
  const resolverKeys = new Set<string>();
  return value.every(resolver => {
    if (!isChatGptTransientAssetResolver(resolver) || resolverKeys.has(resolver.resolverKey)) {
      return false;
    }
    resolverKeys.add(resolver.resolverKey);
    return true;
  });
}

/** Validate the exact, credential-free artifact shape allowed over runtime messaging. */
export function isChatGptCaptureArtifact(value: unknown): value is ChatGptCaptureArtifact {
  if (typeof value !== 'object' || value === null) return false;
  if (
    !hasExactKeys(value, [
      'bodyBase64',
      'byteLength',
      'sha256',
      'mediaType',
      'endpoint',
      'transientAssetResolvers',
    ])
  ) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.bodyBase64 === 'string' &&
    Number.isSafeInteger(record.byteLength) &&
    (record.byteLength as number) >= 0 &&
    (record.byteLength as number) <= CHATGPT_CAPTURE_MAX_BYTES &&
    canonicalBase64ByteLength(record.bodyBase64) === record.byteLength &&
    typeof record.sha256 === 'string' &&
    /^[a-f0-9]{64}$/i.test(record.sha256) &&
    isJsonMediaType(record.mediaType) &&
    isExactEndpoint(record.endpoint) &&
    isChatGptTransientAssetResolvers(record.transientAssetResolvers)
  );
}

/** Build an exact failure response with only stable, safe diagnostic text. */
export function createChatGptCaptureFailure(code: ChatGptCaptureErrorCode): ChatGptCaptureResponse {
  return { success: false, code, error: CHATGPT_CAPTURE_ERROR_MESSAGES[code] };
}

/** Validate the complete response shape accepted by the content-side bridge. */
export function isChatGptCaptureResponse(value: unknown): value is ChatGptCaptureResponse {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.success === true) {
    return hasExactKeys(value, ['success', 'data']) && isChatGptCaptureArtifact(record.data);
  }
  if (record.success === false) {
    return (
      hasExactKeys(value, ['success', 'code', 'error']) &&
      typeof record.code === 'string' &&
      (CHATGPT_CAPTURE_ERROR_CODES as readonly string[]).includes(record.code) &&
      typeof record.error === 'string' &&
      record.error === CHATGPT_CAPTURE_ERROR_MESSAGES[record.code as ChatGptCaptureErrorCode]
    );
  }
  return false;
}
