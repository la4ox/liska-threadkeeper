import { describe, expect, it } from 'vitest';
import {
  chatGptActiveResolverAuditWarning,
  chatGptActiveResolverFailureMetric,
  chatGptActiveResolverMetricFromResponse,
  chatGptActiveResolverProbeWarning,
  emptyChatGptActiveResolverMetric,
  type ChatGptActiveResolverMetric,
} from '../../src/content/capture/chatgpt-active-resolver-audit';

const ATTEMPTED_AT = '2026-08-25T12:00:00.000Z';

function completeMetric(): ChatGptActiveResolverMetric {
  return chatGptActiveResolverMetricFromResponse(
    {
      success: true,
      data: {
        requestedCount: 7,
        dispatchCount: 6,
        observedCount: 1,
        outcomes: [
          'observed',
          'http-error',
          'rejected',
          'non-json',
          'oversized',
          'timed-out',
          'not-dispatched',
        ],
        attemptedAt: ATTEMPTED_AT,
      },
    },
    7
  );
}

describe('ChatGPT active resolver durable audit', () => {
  it('builds one exact aggregate histogram without retaining the batch timestamp', () => {
    const metric = completeMetric();

    expect(metric).toEqual({
      requestedCount: 7,
      dispatchCount: 6,
      observedCount: 1,
      outcomeCounts: {
        observed: 1,
        'http-error': 1,
        rejected: 1,
        'non-json': 1,
        oversized: 1,
        'timed-out': 1,
        'not-dispatched': 1,
      },
      failureCode: null,
    });
    expect(chatGptActiveResolverAuditWarning(metric)).toBe(
      'ChatGPT active resolver audit: requested=7; dispatched=6; observed=1; outcomes=observed:1,http-error:1,rejected:1,non-json:1,oversized:1,timed-out:1,not-dispatched:1; failure=none; binary acquisition remains disabled.'
    );
    expect(chatGptActiveResolverProbeWarning(metric)).toBe(
      'ChatGPT active resolver observed 1/7; binary acquisition remains disabled.'
    );
    expect(JSON.stringify(metric)).not.toContain(ATTEMPTED_AT);
  });

  it('records a safe failure code while leaving dispatch and outcomes explicitly unknown', () => {
    const metric = chatGptActiveResolverMetricFromResponse(
      { success: false, code: 'source-http-error' },
      16
    );

    expect(metric).toEqual(chatGptActiveResolverFailureMetric(16, 'source-http-error'));
    expect(chatGptActiveResolverAuditWarning(metric)).toBe(
      'ChatGPT active resolver audit: requested=16; dispatched=unknown; observed=0; outcomes=unavailable; failure=source-http-error; binary acquisition remains disabled.'
    );
    expect(chatGptActiveResolverProbeWarning(metric)).toBe(
      'ChatGPT active resolver diagnostic failed (source-http-error); binary acquisition remains disabled.'
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
    { ...completeMetric(), requestedCount: 21 },
    { ...completeMetric(), requestedCount: -1 },
    { ...completeMetric(), observedCount: 8 },
    { ...completeMetric(), observedCount: -1 },
    { ...completeMetric(), dispatchCount: 8 },
    { ...completeMetric(), dispatchCount: -1 },
    { ...completeMetric(), dispatchCount: null },
    { ...completeMetric(), failureCode: 'source-http-error' },
    { ...completeMetric(), outcomeCounts: { ...validCounts, observed: 2 } },
    { ...completeMetric(), outcomeCounts: { ...validCounts, 'not-dispatched': 0 } },
    { ...completeMetric(), outcomeCounts: { ...validCounts, rejected: -1 } },
    { ...completeMetric(), outcomeCounts: { ...validCounts, extra: 0 } },
    {
      ...completeMetric(),
      outcomeCounts: Object.fromEntries(
        Object.entries(validCounts).filter(([key]) => key !== 'oversized')
      ),
    },
    { ...chatGptActiveResolverFailureMetric(2, 'source-http-error'), dispatchCount: 0 },
    { ...chatGptActiveResolverFailureMetric(2, 'source-http-error'), observedCount: 1 },
    { ...chatGptActiveResolverFailureMetric(2, 'source-http-error'), failureCode: null },
    { ...chatGptActiveResolverFailureMetric(2, 'source-http-error'), requestedCount: 21 },
    { ...chatGptActiveResolverFailureMetric(2, 'source-http-error'), failureCode: 'private' },
  ])('rejects malformed or internally inconsistent metric %#', metric => {
    expect(() => chatGptActiveResolverAuditWarning(metric as ChatGptActiveResolverMetric)).toThrow(
      'invalid active resolver metric'
    );
  });
});
