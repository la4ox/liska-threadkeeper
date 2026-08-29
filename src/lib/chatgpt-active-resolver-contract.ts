/**
 * Safe, metric-only boundary for the active ChatGPT attachment resolver
 * experiment. Provider IDs, resolver bodies, and signed URLs are deliberately
 * absent from the response accepted by content scripts.
 */

import { isChatGptConversationId } from './chatgpt-capture-contract';

export const CHATGPT_ACTIVE_RESOLVER_MAX_COUNT = 20;
/**
 * The metric-only active attachment diagnostic may request one exact ledger
 * pointer. The wider count remains the pure inventory-plan bound.
 */
export const CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT = 1;
export const CHATGPT_ACTIVE_RESOLVER_MAX_BYTES = 64 * 1024;

export const CHATGPT_ACTIVE_RESOLVER_OUTCOME_CODES = [
  'observed',
  'http-error',
  'fetch-rejected',
  'response-processing-rejected',
  'payload-integrity-rejected',
  'download-url-missing',
  'download-url-binding-rejected',
  'non-json',
  'oversized',
  'timed-out',
  'not-dispatched',
] as const;
export type ChatGptActiveResolverOutcomeCode =
  (typeof CHATGPT_ACTIVE_RESOLVER_OUTCOME_CODES)[number];

/** Page-observable outcomes only; payload validation is background-owned. */
export const CHATGPT_ACTIVE_RESOLVER_HOOK_OUTCOME_CODES = [
  'http-error',
  'fetch-rejected',
  'response-processing-rejected',
  'non-json',
  'oversized',
  'timed-out',
  'not-dispatched',
] as const;
export type ChatGptActiveResolverHookOutcomeCode =
  (typeof CHATGPT_ACTIVE_RESOLVER_HOOK_OUTCOME_CODES)[number];

export const CHATGPT_ACTIVE_RESOLVER_ERROR_CODES = [
  'invalid-conversation-id',
  'invalid-provider-file-ids',
  'permission-unavailable',
  'nonce-invalid',
  'temporary-tab-create-failed',
  'temporary-tab-missing-id',
  'unexpected-origin',
  'unexpected-path',
  'temporary-tab-ready-timeout',
  'document-id-missing',
  'command-rejected',
  'resolver-result-timeout',
  'resolver-result-invalid',
  'hook-state-failed',
  'source-not-eligible',
  'source-rejected',
  'source-http-error',
  'source-non-json',
] as const;
export type ChatGptActiveResolverErrorCode = (typeof CHATGPT_ACTIVE_RESOLVER_ERROR_CODES)[number];

export interface ChatGptActiveResolverObservedCapture {
  bodyBase64: string;
  byteLength: number;
  sha256: string;
  mediaType: string;
}

/** MAIN-to-background only; bodies are dropped before background responds. */
export type ChatGptActiveResolverHookOutcome =
  | { state: ChatGptActiveResolverHookOutcomeCode }
  | { state: 'observed'; capture: ChatGptActiveResolverObservedCapture };

export type ChatGptActiveResolverHookResult =
  | { kind: 'ready' }
  | {
      kind: 'complete';
      conversationId: string;
      requestedCount: number;
      dispatchCount: number;
      outcomes: ChatGptActiveResolverHookOutcome[];
    }
  | { kind: 'error'; code: ChatGptActiveResolverErrorCode };

export interface ChatGptActiveResolverMetrics {
  requestedCount: number;
  dispatchCount: number;
  observedCount: number;
  outcomes: ChatGptActiveResolverOutcomeCode[];
  attemptedAt: string;
}

export type ChatGptActiveResolverResponse =
  | { success: true; data: ChatGptActiveResolverMetrics }
  | { success: false; code: ChatGptActiveResolverErrorCode };

export function isChatGptActiveResolverProviderFileId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
}

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

export function isChatGptActiveResolverObservedCapture(
  value: unknown
): value is ChatGptActiveResolverObservedCapture {
  if (typeof value !== 'object' || value === null) return false;
  if (!hasExactOwnKeys(value, ['bodyBase64', 'byteLength', 'sha256', 'mediaType'])) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.bodyBase64 === 'string' &&
    record.bodyBase64.length <= 96 * 1024 &&
    Number.isSafeInteger(record.byteLength) &&
    (record.byteLength as number) >= 0 &&
    (record.byteLength as number) <= CHATGPT_ACTIVE_RESOLVER_MAX_BYTES &&
    typeof record.sha256 === 'string' &&
    record.sha256.length <= 128 &&
    typeof record.mediaType === 'string' &&
    record.mediaType.length <= 255
  );
}

function isHookOutcome(value: unknown): value is ChatGptActiveResolverHookOutcome {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.state === 'observed') {
    return (
      hasExactOwnKeys(value, ['state', 'capture']) &&
      isChatGptActiveResolverObservedCapture(record.capture)
    );
  }
  return (
    hasExactOwnKeys(value, ['state']) &&
    typeof record.state === 'string' &&
    (CHATGPT_ACTIVE_RESOLVER_HOOK_OUTCOME_CODES as readonly string[]).includes(record.state)
  );
}

function hasSequentialOrdinalMapping(
  outcomes: readonly ChatGptActiveResolverHookOutcome[],
  dispatchCount: number
): boolean {
  return outcomes.every((outcome, ordinal) =>
    ordinal < dispatchCount
      ? outcome.state !== 'not-dispatched'
      : outcome.state === 'not-dispatched'
  );
}

function hasSequentialMetricMapping(
  outcomes: readonly ChatGptActiveResolverOutcomeCode[],
  dispatchCount: number
): boolean {
  return outcomes.every((outcome, ordinal) =>
    ordinal < dispatchCount ? outcome !== 'not-dispatched' : outcome === 'not-dispatched'
  );
}

// eslint-disable-next-line complexity -- Exact untrusted shape validation is intentionally linear.
export function isChatGptActiveResolverHookResult(
  value: unknown
): value is ChatGptActiveResolverHookResult {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.kind === 'ready') return hasExactOwnKeys(value, ['kind']);
  if (record.kind === 'error') {
    return (
      hasExactOwnKeys(value, ['kind', 'code']) &&
      typeof record.code === 'string' &&
      (CHATGPT_ACTIVE_RESOLVER_ERROR_CODES as readonly string[]).includes(record.code)
    );
  }
  return (
    record.kind === 'complete' &&
    hasExactOwnKeys(value, [
      'kind',
      'conversationId',
      'requestedCount',
      'dispatchCount',
      'outcomes',
    ]) &&
    isChatGptConversationId(record.conversationId) &&
    Number.isSafeInteger(record.requestedCount) &&
    (record.requestedCount as number) >= 0 &&
    (record.requestedCount as number) <= CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT &&
    Number.isSafeInteger(record.dispatchCount) &&
    (record.dispatchCount as number) >= 0 &&
    (record.dispatchCount as number) <= (record.requestedCount as number) &&
    Array.isArray(record.outcomes) &&
    record.outcomes.length === record.requestedCount &&
    record.outcomes.every(isHookOutcome) &&
    hasSequentialOrdinalMapping(
      record.outcomes as ChatGptActiveResolverHookOutcome[],
      record.dispatchCount as number
    )
  );
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return false;
  return !Number.isNaN(new Date(value).getTime());
}

// eslint-disable-next-line complexity -- Exact untrusted shape validation is intentionally linear.
function isMetrics(value: unknown): value is ChatGptActiveResolverMetrics {
  if (typeof value !== 'object' || value === null) return false;
  if (
    !hasExactOwnKeys(value, [
      'requestedCount',
      'dispatchCount',
      'observedCount',
      'outcomes',
      'attemptedAt',
    ])
  )
    return false;
  const record = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(record.requestedCount) &&
    (record.requestedCount as number) >= 0 &&
    (record.requestedCount as number) <= CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT &&
    Number.isSafeInteger(record.dispatchCount) &&
    (record.dispatchCount as number) >= 0 &&
    (record.dispatchCount as number) <= (record.requestedCount as number) &&
    Number.isSafeInteger(record.observedCount) &&
    (record.observedCount as number) >= 0 &&
    (record.observedCount as number) <= (record.dispatchCount as number) &&
    Array.isArray(record.outcomes) &&
    record.outcomes.length === (record.requestedCount as number) &&
    record.outcomes.every(
      outcome =>
        typeof outcome === 'string' &&
        (CHATGPT_ACTIVE_RESOLVER_OUTCOME_CODES as readonly string[]).includes(outcome)
    ) &&
    hasSequentialMetricMapping(
      record.outcomes as ChatGptActiveResolverOutcomeCode[],
      record.dispatchCount as number
    ) &&
    record.observedCount === record.outcomes.filter(outcome => outcome === 'observed').length &&
    isIsoTimestamp(record.attemptedAt)
  );
}

export function createChatGptActiveResolverFailure(
  code: ChatGptActiveResolverErrorCode
): ChatGptActiveResolverResponse {
  return { success: false, code };
}

export function isChatGptActiveResolverResponse(
  value: unknown
): value is ChatGptActiveResolverResponse {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.success === true)
    return hasExactOwnKeys(value, ['success', 'data']) && isMetrics(record.data);
  return (
    record.success === false &&
    hasExactOwnKeys(value, ['success', 'code']) &&
    typeof record.code === 'string' &&
    (CHATGPT_ACTIVE_RESOLVER_ERROR_CODES as readonly string[]).includes(record.code)
  );
}
