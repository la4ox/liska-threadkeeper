/**
 * Durable, aggregate-only audit projection for the active ChatGPT resolver.
 * Provider IDs, URLs, bodies, header values, and conversation content are not
 * representable in this contract.
 */

import {
  CHATGPT_ACTIVE_RESOLVER_ERROR_CODES,
  CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT,
  CHATGPT_ACTIVE_RESOLVER_OUTCOME_CODES,
  type ChatGptActiveResolverErrorCode,
  type ChatGptActiveResolverOutcomeCode,
  type ChatGptActiveResolverResponse,
} from '../../lib/chatgpt-active-resolver-contract';

export type ChatGptActiveResolverOutcomeCounts = Record<ChatGptActiveResolverOutcomeCode, number>;

export interface ChatGptActiveResolverMetric {
  requestedCount: number;
  dispatchCount: number | null;
  observedCount: number;
  outcomeCounts: ChatGptActiveResolverOutcomeCounts | null;
  failureCode: ChatGptActiveResolverErrorCode | null;
}

export function emptyChatGptActiveResolverOutcomeCounts(): ChatGptActiveResolverOutcomeCounts {
  return {
    observed: 0,
    'http-error': 0,
    'fetch-rejected': 0,
    'response-processing-rejected': 0,
    'payload-validation-rejected': 0,
    'non-json': 0,
    oversized: 0,
    'timed-out': 0,
    'not-dispatched': 0,
  };
}

export function emptyChatGptActiveResolverMetric(): ChatGptActiveResolverMetric {
  return {
    requestedCount: 0,
    dispatchCount: 0,
    observedCount: 0,
    outcomeCounts: emptyChatGptActiveResolverOutcomeCounts(),
    failureCode: null,
  };
}

function outcomeCounts(
  outcomes: readonly ChatGptActiveResolverOutcomeCode[]
): ChatGptActiveResolverOutcomeCounts {
  const counts = emptyChatGptActiveResolverOutcomeCounts();
  for (const outcome of outcomes) counts[outcome] += 1;
  return counts;
}

export function chatGptActiveResolverFailureMetric(
  requestedCount: number,
  failureCode: ChatGptActiveResolverErrorCode
): ChatGptActiveResolverMetric {
  return {
    requestedCount,
    dispatchCount: null,
    observedCount: 0,
    outcomeCounts: null,
    failureCode,
  };
}

export function chatGptActiveResolverMetricFromResponse(
  response: ChatGptActiveResolverResponse,
  requestedCount: number
): ChatGptActiveResolverMetric {
  if (!response.success) return chatGptActiveResolverFailureMetric(requestedCount, response.code);
  if (response.data.requestedCount !== requestedCount) {
    return chatGptActiveResolverFailureMetric(requestedCount, 'resolver-result-invalid');
  }
  return {
    requestedCount,
    dispatchCount: response.data.dispatchCount,
    observedCount: response.data.observedCount,
    outcomeCounts: outcomeCounts(response.data.outcomes),
    failureCode: null,
  };
}

export function chatGptActiveResolverProbeWarning(metric: ChatGptActiveResolverMetric): string {
  return metric.failureCode === null
    ? `ChatGPT active resolver observed ${metric.observedCount}/${metric.requestedCount}; binary acquisition remains disabled.`
    : `ChatGPT active resolver diagnostic failed (${metric.failureCode}); binary acquisition remains disabled.`;
}

function invalidMetric(): never {
  throw new Error('invalid active resolver metric');
}

function validateMetricBase(metric: ChatGptActiveResolverMetric): void {
  if (
    !Number.isSafeInteger(metric.requestedCount) ||
    metric.requestedCount < 0 ||
    metric.requestedCount > CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT ||
    !Number.isSafeInteger(metric.observedCount) ||
    metric.observedCount < 0 ||
    metric.observedCount > metric.requestedCount ||
    (metric.failureCode !== null &&
      !(CHATGPT_ACTIVE_RESOLVER_ERROR_CODES as readonly string[]).includes(metric.failureCode))
  ) {
    invalidMetric();
  }
}

function validateFailureMetric(metric: ChatGptActiveResolverMetric): void {
  if (metric.dispatchCount !== null || metric.observedCount !== 0 || metric.failureCode === null) {
    invalidMetric();
  }
}

function validateOutcomeCountShape(counts: ChatGptActiveResolverOutcomeCounts): void {
  const keys = Reflect.ownKeys(counts);
  if (
    keys.length !== CHATGPT_ACTIVE_RESOLVER_OUTCOME_CODES.length ||
    !CHATGPT_ACTIVE_RESOLVER_OUTCOME_CODES.every(code => keys.includes(code))
  ) {
    invalidMetric();
  }
}

function outcomeCountTotal(counts: ChatGptActiveResolverOutcomeCounts): number {
  let total = 0;
  for (const code of CHATGPT_ACTIVE_RESOLVER_OUTCOME_CODES) {
    const count = counts[code];
    if (!Number.isSafeInteger(count) || count < 0) invalidMetric();
    total += count;
  }
  return total;
}

function validateSuccessMetric(
  metric: ChatGptActiveResolverMetric,
  counts: ChatGptActiveResolverOutcomeCounts
): void {
  if (
    metric.failureCode !== null ||
    !Number.isSafeInteger(metric.dispatchCount) ||
    metric.dispatchCount === null ||
    metric.dispatchCount < 0 ||
    metric.dispatchCount > metric.requestedCount
  ) {
    invalidMetric();
  }
  validateOutcomeCountShape(counts);
  if (
    outcomeCountTotal(counts) !== metric.requestedCount ||
    counts.observed !== metric.observedCount ||
    counts['not-dispatched'] !== metric.requestedCount - metric.dispatchCount
  ) {
    invalidMetric();
  }
}

function histogram(counts: ChatGptActiveResolverOutcomeCounts): string {
  return CHATGPT_ACTIVE_RESOLVER_OUTCOME_CODES.map(code => `${code}:${counts[code]}`).join(',');
}

export function chatGptActiveResolverAuditWarning(
  metric: ChatGptActiveResolverMetric | undefined
): string | undefined {
  if (metric === undefined) return undefined;
  validateMetricBase(metric);
  if (metric.outcomeCounts === null) {
    validateFailureMetric(metric);
    return `ChatGPT active resolver audit: requested=${metric.requestedCount}; dispatched=unknown; observed=0; outcomes=unavailable; failure=${metric.failureCode}; binary acquisition remains disabled.`;
  }
  validateSuccessMetric(metric, metric.outcomeCounts);
  return `ChatGPT active resolver audit: requested=${metric.requestedCount}; dispatched=${metric.dispatchCount}; observed=${metric.observedCount}; outcomes=${histogram(metric.outcomeCounts)}; failure=none; binary acquisition remains disabled.`;
}
