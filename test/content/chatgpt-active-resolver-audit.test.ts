import { describe, expect, it } from 'vitest';
import {
  chatGptActiveResolverAuditWarning,
  chatGptActiveResolverFailureMetric,
  chatGptActiveResolverMetricFromResponse,
  chatGptActiveResolverProbeWarning,
  emptyChatGptActiveResolverMetric,
  type ChatGptActiveResolverMetric,
} from '../../src/content/capture/chatgpt-active-resolver-audit';
import {
  CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT,
  CHATGPT_ACTIVE_RESOLVER_OUTCOME_CODES,
} from '../../src/lib/chatgpt-active-resolver-contract';

const ATTEMPTED_AT = '2026-08-25T12:00:00.000Z';

function completeMetric(): ChatGptActiveResolverMetric {
  return chatGptActiveResolverMetricFromResponse(
    {
      success: true,
      data: {
        requestedCount: 1,
        dispatchCount: 1,
        observedCount: 1,
        outcomes: ['observed'],
        attemptedAt: ATTEMPTED_AT,
      },
    },
    1
  );
}

describe('ChatGPT active resolver durable audit', () => {
  it('keeps the metric route disabled and admits only the fixed one-png data capability', () => {
    expect(chatGptActiveResolverAuditWarning(completeMetric())).toContain(
      'file-ID binary acquisition remains disabled.'
    );
    expect(
      chatGptActiveResolverAuditWarning({ ...completeMetric(), acquisitionMode: 'one-png' })
    ).toContain('file-ID binary acquisition is limited to one PNG.');
    expect(() =>
      chatGptActiveResolverAuditWarning({
        ...completeMetric(),
        acquisitionMode: 'arbitrary',
      } as never)
    ).toThrow('invalid active resolver metric');
    expect(() =>
      chatGptActiveResolverAuditWarning({ ...completeMetric(), url: 'private' } as never)
    ).toThrow('invalid active resolver metric');
    const metric = completeMetric();
    Object.defineProperty(metric, 'acquisitionMode', {
      get: () => {
        throw new Error('must-not-evaluate');
      },
    });
    expect(() => chatGptActiveResolverAuditWarning(metric)).toThrow(
      'invalid active resolver metric'
    );
  });
  it.each(['provider-status-absent', 'provider-status-non-string'] as const)(
    'persists only the fixed %s category with observed zero',
    code => {
      const metric = chatGptActiveResolverMetricFromResponse(
        {
          success: true,
          data: {
            requestedCount: 1,
            dispatchCount: 1,
            observedCount: 0,
            outcomes: [code],
            attemptedAt: ATTEMPTED_AT,
          },
        },
        1
      );
      expect(metric.observedCount).toBe(0);
      expect(metric.outcomeCounts?.[code]).toBe(1);
      expect(chatGptActiveResolverAuditWarning(metric)).toContain(`${code}:1`);
      expect(chatGptActiveResolverAuditWarning(metric)).toContain(
        'file-ID binary acquisition remains disabled.'
      );
    }
  );
  it('builds the exact revised allowlisted histogram without retaining the batch timestamp', () => {
    const metric = completeMetric();

    expect(metric).toEqual({
      requestedCount: 1,
      dispatchCount: 1,
      observedCount: 1,
      outcomeCounts: {
        observed: 1,
        'http-error': 0,
        'fetch-rejected': 0,
        'response-processing-rejected': 0,
        'payload-integrity-rejected': 0,
        'download-url-missing': 0,
        'download-url-binding-rejected': 0,
        'file-not-found': 0,
        'file-expired': 0,
        'provider-retry': 0,
        'success-without-download-url': 0,
        'provider-status-absent': 0,
        'provider-status-non-string': 0,
        'provider-status-other': 0,
        'non-json': 0,
        oversized: 0,
        'timed-out': 0,
        'not-dispatched': 0,
      },
      failureCode: null,
    });
    expect(chatGptActiveResolverAuditWarning(metric)).toBe(
      'ChatGPT active resolver audit: requested=1; dispatched=1; observed=1; outcomes=observed:1,http-error:0,fetch-rejected:0,response-processing-rejected:0,payload-integrity-rejected:0,download-url-missing:0,download-url-binding-rejected:0,file-not-found:0,file-expired:0,provider-retry:0,success-without-download-url:0,provider-status-absent:0,provider-status-non-string:0,provider-status-other:0,non-json:0,oversized:0,timed-out:0,not-dispatched:0; failure=none; file-ID binary acquisition remains disabled.'
    );
    expect(chatGptActiveResolverProbeWarning(metric)).toBe(
      'ChatGPT active resolver observed 1/1; file-ID binary acquisition remains disabled.'
    );
    expect(JSON.stringify(metric)).not.toContain(ATTEMPTED_AT);
  });

  it('keeps the zero histogram in the contract-defined stable order', () => {
    expect(CHATGPT_ACTIVE_RESOLVER_OUTCOME_CODES).toEqual([
      'observed',
      'http-error',
      'fetch-rejected',
      'response-processing-rejected',
      'payload-integrity-rejected',
      'download-url-missing',
      'download-url-binding-rejected',
      'file-not-found',
      'file-expired',
      'provider-retry',
      'success-without-download-url',
      'provider-status-absent',
      'provider-status-non-string',
      'provider-status-other',
      'non-json',
      'oversized',
      'timed-out',
      'not-dispatched',
    ]);
    expect(chatGptActiveResolverAuditWarning(emptyChatGptActiveResolverMetric())).toBe(
      'ChatGPT active resolver audit: requested=0; dispatched=0; observed=0; outcomes=observed:0,http-error:0,fetch-rejected:0,response-processing-rejected:0,payload-integrity-rejected:0,download-url-missing:0,download-url-binding-rejected:0,file-not-found:0,file-expired:0,provider-retry:0,success-without-download-url:0,provider-status-absent:0,provider-status-non-string:0,provider-status-other:0,non-json:0,oversized:0,timed-out:0,not-dispatched:0; failure=none; file-ID binary acquisition remains disabled.'
    );
  });

  it('records a safe failure code while leaving dispatch and outcomes explicitly unknown', () => {
    const metric = chatGptActiveResolverMetricFromResponse(
      { success: false, code: 'source-http-error' },
      1
    );

    expect(metric).toEqual(chatGptActiveResolverFailureMetric(1, 'source-http-error'));
    expect(chatGptActiveResolverAuditWarning(metric)).toBe(
      'ChatGPT active resolver audit: requested=1; dispatched=unknown; observed=0; outcomes=unavailable; failure=source-http-error; file-ID binary acquisition remains disabled.'
    );
    expect(chatGptActiveResolverProbeWarning(metric)).toBe(
      'ChatGPT active resolver diagnostic failed (source-http-error); file-ID binary acquisition remains disabled.'
    );
  });

  it('fails closed on a response count that is not bound to the exact request plan', () => {
    const metric = chatGptActiveResolverMetricFromResponse(
      {
        success: true,
        data: {
          requestedCount: 1,
          dispatchCount: 1,
          observedCount: 0,
          outcomes: ['http-error'],
          attemptedAt: ATTEMPTED_AT,
        },
      },
      2
    );

    expect(metric).toEqual(chatGptActiveResolverFailureMetric(2, 'resolver-result-invalid'));
  });

  it('represents the zero-ID skip as a complete zero histogram', () => {
    const metric = emptyChatGptActiveResolverMetric();
    expect(chatGptActiveResolverAuditWarning(metric)).toContain(
      'requested=0; dispatched=0; observed=0'
    );
    expect(chatGptActiveResolverAuditWarning(undefined)).toBeUndefined();
  });

  const validCounts = completeMetric().outcomeCounts!;
  it.each([
    {
      ...completeMetric(),
      requestedCount: CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT + 1,
    },
    { ...completeMetric(), requestedCount: -1 },
    { ...completeMetric(), observedCount: 8 },
    { ...completeMetric(), observedCount: -1 },
    { ...completeMetric(), dispatchCount: 8 },
    { ...completeMetric(), dispatchCount: -1 },
    { ...completeMetric(), dispatchCount: null },
    { ...completeMetric(), failureCode: 'source-http-error' },
    { ...completeMetric(), outcomeCounts: { ...validCounts, observed: 2 } },
    { ...completeMetric(), outcomeCounts: { ...validCounts, 'not-dispatched': 1 } },
    { ...completeMetric(), outcomeCounts: { ...validCounts, 'fetch-rejected': -1 } },
    { ...completeMetric(), outcomeCounts: { ...validCounts, rejected: 0 } },
    { ...completeMetric(), outcomeCounts: { ...validCounts, extra: 0 } },
    {
      ...completeMetric(),
      outcomeCounts: Object.fromEntries(
        Object.entries(validCounts).filter(([key]) => key !== 'oversized')
      ),
    },
    { ...chatGptActiveResolverFailureMetric(1, 'source-http-error'), dispatchCount: 0 },
    { ...chatGptActiveResolverFailureMetric(1, 'source-http-error'), observedCount: 1 },
    { ...chatGptActiveResolverFailureMetric(1, 'source-http-error'), failureCode: null },
    {
      ...chatGptActiveResolverFailureMetric(1, 'source-http-error'),
      requestedCount: CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT + 1,
    },
    { ...chatGptActiveResolverFailureMetric(1, 'source-http-error'), failureCode: 'private' },
  ])('rejects malformed or internally inconsistent metric %#', metric => {
    expect(() => chatGptActiveResolverAuditWarning(metric as ChatGptActiveResolverMetric)).toThrow(
      'invalid active resolver metric'
    );
  });
});
