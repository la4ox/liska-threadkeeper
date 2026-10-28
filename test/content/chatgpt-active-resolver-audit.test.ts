import { describe, expect, it, vi } from 'vitest';
import {
  chatGptActiveResolverAuditWarning,
  chatGptActiveResolverFailureMetric,
  chatGptActiveResolverMetricFromResponse,
  chatGptActiveResolverProbeWarning,
  emptyChatGptActiveResolverMetric,
  type ChatGptActiveResolverMetric,
  type ChatGptActiveResolverAudit,
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
  it('counts text/plain separately within the same four-operation budget', () => {
    const warning = chatGptActiveResolverAuditWarning({
      acquisitionMode: 'asset-batch-4',
      libraryJpegAttemptCount: 1,
      libraryCsvAttemptCount: 1,
      libraryTextPlainAttemptCount: 1,
      attempts: Array.from({ length: 4 }, completeMetric),
    });
    expect(warning).toContain('selected=4/4; completed=4;');
    expect(warning).toContain(
      'library-jpeg-attempts=1; library-csv-attempts=1; library-text-plain-attempts=1; ordinary-image-attempts=1;'
    );
    expect(warning).toContain('at most one Library CSV and one Library text/plain.');
    expect(warning).not.toMatch(/private|file_library|https:|Bearer|cookie|sig=/i);
  });

  it.each([0, 1] as const)(
    'admits an explicit text/plain count of %s without phantom images',
    count => {
      const warning = chatGptActiveResolverAuditWarning({
        acquisitionMode: 'asset-batch-4',
        libraryJpegAttemptCount: 0,
        libraryCsvAttemptCount: 0,
        libraryTextPlainAttemptCount: count,
        attempts: [completeMetric()],
      });
      expect(warning).toContain(
        `library-text-plain-attempts=${count}; ordinary-image-attempts=${1 - count};`
      );
    }
  );

  it.each([undefined, null, -1, 2, 0.5, 'private', {}, NaN])(
    'rejects an unsafe present text/plain count %s',
    libraryTextPlainAttemptCount => {
      expect(() =>
        chatGptActiveResolverAuditWarning({
          acquisitionMode: 'asset-batch-4',
          libraryJpegAttemptCount: 0,
          libraryCsvAttemptCount: 0,
          libraryTextPlainAttemptCount,
          attempts: [completeMetric()],
        } as never)
      ).toThrow('invalid active resolver metric');
    }
  );

  it('rejects family totals above the attempt count, including text/plain', () => {
    expect(() =>
      chatGptActiveResolverAuditWarning({
        acquisitionMode: 'asset-batch-4',
        libraryJpegAttemptCount: 1,
        libraryCsvAttemptCount: 1,
        libraryTextPlainAttemptCount: 1,
        attempts: [completeMetric(), completeMetric()],
      })
    ).toThrow('invalid active resolver metric');
  });

  it.each(['getter', 'symbol', 'extra', 'image-mode'] as const)(
    'rejects non-exact text/plain audit %s without invoking getters',
    mode => {
      const getter = vi.fn(() => 1);
      const audit: Record<string | symbol, unknown> = {
        acquisitionMode: 'asset-batch-4',
        libraryJpegAttemptCount: 0,
        libraryCsvAttemptCount: 0,
        libraryTextPlainAttemptCount: 1,
        attempts: [completeMetric()],
      };
      if (mode === 'getter')
        Object.defineProperty(audit, 'libraryTextPlainAttemptCount', { get: getter });
      if (mode === 'symbol') audit[Symbol('private')] = 1;
      if (mode === 'extra') audit.providerId = 'private';
      if (mode === 'image-mode') audit.acquisitionMode = 'image-batch-4';
      expect(() => chatGptActiveResolverAuditWarning(audit as never)).toThrow(
        'invalid active resolver metric'
      );
      expect(getter).not.toHaveBeenCalled();
    }
  );

  it('counts a Library CSV and JPEG inside the unchanged four-operation budget', () => {
    const warning = chatGptActiveResolverAuditWarning({
      acquisitionMode: 'asset-batch-4',
      libraryJpegAttemptCount: 1,
      libraryCsvAttemptCount: 1,
      attempts: [
        chatGptActiveResolverFailureMetric(1, 'resolver-result-timeout'),
        completeMetric(),
        completeMetric(),
        completeMetric(),
      ],
    });
    expect(warning).toContain('selected=4/4; completed=3;');
    expect(warning).toContain('dispatch-unknown=1;');
    expect(warning).toContain(
      'library-jpeg-attempts=1; library-csv-attempts=1; ordinary-image-attempts=2;'
    );
    expect(warning).toContain(
      'four sequential PNG/JPEG/CSV assets, including at most one Library CSV.'
    );
    expect(warning).not.toMatch(/private|file_library|https:|Bearer|cookie|sig=/i);
  });

  it('admits a CSV-only batch without inventing image attempts', () => {
    const warning = chatGptActiveResolverAuditWarning({
      acquisitionMode: 'asset-batch-4',
      libraryJpegAttemptCount: 0,
      libraryCsvAttemptCount: 1,
      attempts: [completeMetric()],
    });
    expect(warning).toContain(
      'library-jpeg-attempts=0; library-csv-attempts=1; ordinary-image-attempts=0;'
    );
  });

  it.each([
    { libraryJpegAttemptCount: 1, libraryCsvAttemptCount: 1 },
    { libraryJpegAttemptCount: 0, libraryCsvAttemptCount: 2 },
    { libraryJpegAttemptCount: 0, libraryCsvAttemptCount: -1 },
    { libraryJpegAttemptCount: 0, libraryCsvAttemptCount: undefined },
    { libraryJpegAttemptCount: undefined, libraryCsvAttemptCount: 1 },
    { libraryJpegAttemptCount: 0, libraryCsvAttemptCount: 'private' },
  ])('rejects inconsistent or unsafe mixed family counts %#', counts => {
    expect(() =>
      chatGptActiveResolverAuditWarning({
        acquisitionMode: 'asset-batch-4',
        attempts: [completeMetric()],
        ...counts,
      } as never)
    ).toThrow('invalid active resolver metric');
  });

  it.each(['missing', 'getter', 'extra', 'symbol', 'image-mode'] as const)(
    'rejects a non-exact mixed audit (%s) without evaluating caller accessors',
    mode => {
      const getter = vi.fn(() => 1);
      const audit = {
        acquisitionMode: 'asset-batch-4',
        attempts: [completeMetric()],
        libraryJpegAttemptCount: 0,
        libraryCsvAttemptCount: 1,
      } as Record<string | symbol, unknown>;
      if (mode === 'missing') delete audit.libraryCsvAttemptCount;
      if (mode === 'getter')
        Object.defineProperty(audit, 'libraryCsvAttemptCount', { get: getter });
      if (mode === 'extra') audit.providerId = 'private';
      if (mode === 'symbol') audit[Symbol('private')] = 1;
      if (mode === 'image-mode') audit.acquisitionMode = 'image-batch-4';
      expect(() => chatGptActiveResolverAuditWarning(audit as never)).toThrow(
        'invalid active resolver metric'
      );
      expect(getter).not.toHaveBeenCalled();
    }
  );

  it.each(
    [
      [],
      Array.from({ length: 5 }, completeMetric),
      new Array(1),
      [{ ...completeMetric(), requestedCount: 0 }],
      [{ ...completeMetric(), downloadUrl: 'https://private' }],
    ].map(attempts => ({ attempts }))
  )('applies the same closed four-item attempt validation to mixed batches %#', ({ attempts }) => {
    expect(() =>
      chatGptActiveResolverAuditWarning({
        acquisitionMode: 'asset-batch-4',
        attempts,
        libraryJpegAttemptCount: 0,
        libraryCsvAttemptCount: 1,
      } as never)
    ).toThrow('invalid active resolver metric');
  });

  it('counts one Library JPEG within the same four-attempt audit without retaining provider values', () => {
    const warning = chatGptActiveResolverAuditWarning({
      acquisitionMode: 'image-batch-4',
      libraryJpegAttemptCount: 1,
      attempts: [
        chatGptActiveResolverFailureMetric(1, 'resolver-result-timeout'),
        completeMetric(),
      ],
    });
    expect(warning).toContain('selected=2/4;');
    expect(warning).toContain('dispatch-unknown=1;');
    expect(warning).toContain('library-jpeg-attempts=1; ordinary-image-attempts=1;');
    expect(warning).not.toMatch(/private|file_library|https:|Bearer|cookie|sig=/i);
  });

  it.each([undefined, null, -1, 2, 0.5, 'private-count', {}, NaN])(
    'rejects unsafe Library family count %s',
    libraryJpegAttemptCount => {
      expect(() =>
        chatGptActiveResolverAuditWarning({
          acquisitionMode: 'image-batch-4',
          attempts: [completeMetric()],
          libraryJpegAttemptCount,
        } as never)
      ).toThrow('invalid active resolver metric');
    }
  );

  it('rejects family getters, symbols, and extra private fields without evaluating them', () => {
    const getter = vi.fn(() => 'private-family');
    for (const mode of ['getter', 'symbol', 'private'] as const) {
      const audit = {
        acquisitionMode: 'image-batch-4' as const,
        attempts: [completeMetric()],
        libraryJpegAttemptCount: 1 as const,
      };
      if (mode === 'getter')
        Object.defineProperty(audit, 'libraryJpegAttemptCount', { get: getter });
      if (mode === 'symbol') Object.defineProperty(audit, Symbol('private'), { value: 'secret' });
      if (mode === 'private') Object.defineProperty(audit, 'providerId', { value: 'private-id' });
      expect(() => chatGptActiveResolverAuditWarning(audit)).toThrow(
        'invalid active resolver metric'
      );
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('never invokes a caller-owned inherited array iterator that changes its yielded metrics', () => {
    const metric = completeMetric();
    const fake = {
      ...metric,
      dispatchCount: 'private-dispatch',
      observedCount: 'private-observed',
    };
    const iterator = vi
      .fn()
      .mockImplementationOnce(() => [metric][Symbol.iterator]())
      .mockImplementation(() => [fake][Symbol.iterator]());
    const prototype = Object.create(Array.prototype);
    Object.defineProperty(prototype, Symbol.iterator, { value: iterator });
    const attempts = [metric];
    Object.setPrototypeOf(attempts, prototype);
    const expected = chatGptActiveResolverAuditWarning({
      acquisitionMode: 'image-batch-4',
      attempts: [completeMetric()],
    });
    const warning = chatGptActiveResolverAuditWarning({
      acquisitionMode: 'image-batch-4',
      attempts,
    });
    expect(warning).toBe(expected);
    expect(warning).not.toContain('private-');
    expect(iterator).not.toHaveBeenCalled();
  });

  it.each(['audit', 'attempts', 'metric', 'counts'] as const)(
    'never invokes a property-get trap on caller-owned %s',
    location => {
      const get = vi.fn(() => {
        throw new Error('private proxy value must not execute');
      });
      const metric = completeMetric();
      if (location === 'counts') metric.outcomeCounts = new Proxy(metric.outcomeCounts!, { get });
      const attempt = location === 'metric' ? new Proxy(metric, { get }) : metric;
      const attempts = location === 'attempts' ? new Proxy([attempt], { get }) : [attempt];
      const audit = { acquisitionMode: 'image-batch-4' as const, attempts };
      const input = location === 'audit' ? new Proxy(audit, { get }) : audit;
      const expected = chatGptActiveResolverAuditWarning({
        acquisitionMode: 'image-batch-4',
        attempts: [completeMetric()],
      });
      expect(chatGptActiveResolverAuditWarning(input)).toBe(expected);
      expect(get).not.toHaveBeenCalled();
    }
  );

  it('reads each caller-owned descriptor exactly once and aggregates only its first snapshot', () => {
    const reads = new Map<string, number>();
    const get = vi.fn(() => {
      throw new Error('private property get');
    });
    function once<T extends object>(target: T, path: string): T {
      return new Proxy(target, {
        get,
        ownKeys(value) {
          const key = `${path}:keys`;
          reads.set(key, (reads.get(key) ?? 0) + 1);
          return Reflect.ownKeys(value);
        },
        getOwnPropertyDescriptor(value, field) {
          const key = `${path}:${String(field)}`;
          const count = (reads.get(key) ?? 0) + 1;
          reads.set(key, count);
          const descriptor = Reflect.getOwnPropertyDescriptor(value, field);
          if (descriptor?.configurable && count > 1)
            return { ...descriptor, value: 'private-second-read' };
          return descriptor;
        },
      });
    }
    const metric = completeMetric();
    metric.outcomeCounts = once(metric.outcomeCounts!, 'counts');
    const sharedMetric = once(metric, 'metric');
    const attempts = once([sharedMetric, sharedMetric], 'attempts');
    const audit = once({ acquisitionMode: 'image-batch-4' as const, attempts }, 'audit');
    const expected = chatGptActiveResolverAuditWarning({
      acquisitionMode: 'image-batch-4',
      attempts: [completeMetric(), completeMetric()],
    });
    const warning = chatGptActiveResolverAuditWarning(audit);
    expect(warning).toBe(expected);
    expect(warning).not.toContain('private');
    expect(reads.size).toBeGreaterThan(20);
    expect([...reads.values()].every(count => count === 1)).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  it('aggregates a bounded batch without losing completed evidence behind run failures', () => {
    const notDispatched = completeMetric();
    notDispatched.dispatchCount = 0;
    notDispatched.observedCount = 0;
    notDispatched.outcomeCounts!.observed = 0;
    notDispatched.outcomeCounts!['not-dispatched'] = 1;
    const warning = chatGptActiveResolverAuditWarning({
      acquisitionMode: 'image-batch-4',
      attempts: [
        completeMetric(),
        notDispatched,
        chatGptActiveResolverFailureMetric(1, 'source-http-error'),
        chatGptActiveResolverFailureMetric(1, 'resolver-result-invalid'),
      ],
    });
    expect(warning).toContain(
      'selected=4/4; completed=2; dispatched-known=1; dispatch-unknown=2; observed=1;'
    );
    expect(warning).toContain('outcomes=observed:1,http-error:0,');
    expect(warning).toContain('not-dispatched:1;');
    expect(warning).toContain('run-failures=resolver-result-invalid:1,source-http-error:1;');
    expect(warning).toContain('acquisition is limited to four sequential PNG/JPEG images.');
    expect(warning).not.toContain(ATTEMPTED_AT);
  });

  it('represents a completed batch with no run failures explicitly', () => {
    expect(
      chatGptActiveResolverAuditWarning({
        acquisitionMode: 'image-batch-4',
        attempts: [completeMetric()],
      })
    ).toContain('selected=1/4; completed=1; dispatched-known=1; dispatch-unknown=0; observed=1;');
    expect(
      chatGptActiveResolverAuditWarning({
        acquisitionMode: 'image-batch-4',
        attempts: [completeMetric()],
      })
    ).toContain('run-failures=none;');
  });

  it('counts repeated unknown-dispatch failures without inventing completed outcomes', () => {
    const warning = chatGptActiveResolverAuditWarning({
      acquisitionMode: 'image-batch-4',
      attempts: Array.from({ length: 4 }, () =>
        chatGptActiveResolverFailureMetric(1, 'resolver-result-timeout')
      ),
    });
    expect(warning).toContain(
      'selected=4/4; completed=0; dispatched-known=0; dispatch-unknown=4; observed=0;'
    );
    expect(warning).toContain('outcomes=observed:0,http-error:0,');
    expect(warning).toContain('run-failures=resolver-result-timeout:4;');
  });

  it.each(['mode', 'attempts', 'entry', 'metric', 'outcome'] as const)(
    'rejects an accessor in the batch %s without evaluating it',
    location => {
      const metric = completeMetric();
      const attempts = [metric];
      const audit = { acquisitionMode: 'image-batch-4' as const, attempts };
      const accessor = {
        get: () => {
          throw new Error('private getter must not execute');
        },
      };
      if (location === 'mode') Object.defineProperty(audit, 'acquisitionMode', accessor);
      if (location === 'attempts') Object.defineProperty(audit, 'attempts', accessor);
      if (location === 'entry') Object.defineProperty(attempts, '0', accessor);
      if (location === 'metric') Object.defineProperty(metric, 'outcomeCounts', accessor);
      if (location === 'outcome')
        Object.defineProperty(metric.outcomeCounts!, 'observed', accessor);
      expect(() => chatGptActiveResolverAuditWarning(audit)).toThrow(
        'invalid active resolver metric'
      );
    }
  );

  it.each([
    { acquisitionMode: 'png-batch-4', attempts: [completeMetric()] },
    { acquisitionMode: 'image-batch-4', attempts: [] },
    { acquisitionMode: 'image-batch-4', attempts: Array.from({ length: 5 }, completeMetric) },
    { acquisitionMode: 'image-batch-4', attempts: [{ ...completeMetric(), requestedCount: 0 }] },
    {
      acquisitionMode: 'image-batch-4',
      attempts: [{ ...completeMetric(), acquisitionMode: 'one-png' }],
    },
    {
      acquisitionMode: 'image-batch-4',
      attempts: [{ ...completeMetric(), acquisitionMode: undefined }],
    },
    {
      acquisitionMode: 'image-batch-4',
      attempts: [{ ...completeMetric(), attemptedAt: ATTEMPTED_AT }],
    },
    { acquisitionMode: 'image-batch-4', attempts: [{ ...completeMetric(), outcomeCounts: null }] },
    { acquisitionMode: 'image-batch-4', attempts: new Array(1) },
    { acquisitionMode: 'image-batch-4', attempts: [completeMetric()], providerFileId: 'private' },
    {
      acquisitionMode: 'image-batch-4',
      attempts: [completeMetric()],
      downloadUrl: 'https://private',
    },
    {
      acquisitionMode: 'image-batch-4',
      attempts: [{ ...completeMetric(), providerFileId: 'private' }],
    },
    {
      acquisitionMode: 'image-batch-4',
      attempts: [{ ...completeMetric(), downloadUrl: 'https://private' }],
    },
    { acquisitionMode: 'image-batch-4', attempts: [completeMetric()], requestedCount: 1 },
  ])('rejects a non-exact or unsafe content batch %#', audit => {
    expect(() => chatGptActiveResolverAuditWarning(audit as ChatGptActiveResolverAudit)).toThrow(
      'invalid active resolver metric'
    );
  });

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
