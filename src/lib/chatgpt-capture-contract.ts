/**
 * Serializable boundary contract for a bounded ChatGPT conversation capture.
 *
 * This module intentionally has no Chrome dependency so both the background
 * capture primitive and content-to-background bridge share one exact shape.
 */

/** Hard byte ceiling for the exact response captured from ChatGPT. */
export const CHATGPT_CAPTURE_MAX_BYTES = 16 * 1024 * 1024;

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

function base64ByteLength(value: string): number | undefined {
  if (!/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i.test(value)) {
    return undefined;
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
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

/** Validate the exact, credential-free artifact shape allowed over runtime messaging. */
export function isChatGptCaptureArtifact(value: unknown): value is ChatGptCaptureArtifact {
  if (typeof value !== 'object' || value === null) return false;
  if (!hasExactKeys(value, ['bodyBase64', 'byteLength', 'sha256', 'mediaType', 'endpoint'])) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.bodyBase64 === 'string' &&
    Number.isSafeInteger(record.byteLength) &&
    (record.byteLength as number) >= 0 &&
    (record.byteLength as number) <= CHATGPT_CAPTURE_MAX_BYTES &&
    base64ByteLength(record.bodyBase64) === record.byteLength &&
    typeof record.sha256 === 'string' &&
    /^[a-f0-9]{64}$/i.test(record.sha256) &&
    isJsonMediaType(record.mediaType) &&
    isExactEndpoint(record.endpoint)
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
