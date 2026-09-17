import { describe, expect, it } from 'vitest';
import {
  CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT,
  CHATGPT_ACTIVE_RESOLVER_MAX_BYTES,
  createChatGptActiveResolverFailure,
  isChatGptActiveResolverObservedCapture,
  isChatGptActiveResolverHookResult,
  isChatGptActiveResolverProviderFileId,
  isChatGptActiveResolverResponse,
} from '../../src/lib/chatgpt-active-resolver-contract';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';

function completeHook() {
  return {
    kind: 'complete' as const,
    conversationId: CONVERSATION_ID,
    requestedCount: 1,
    dispatchCount: 1,
    outcomes: [
      {
        state: 'observed' as const,
        capture: {
          bodyBase64: 'e30=',
          byteLength: 2,
          sha256: '0'.repeat(64),
          mediaType: 'application/json',
        },
      },
    ],
  };
}

describe('ChatGPT active resolver metric contract', () => {
  it('rejects malformed primitives before inspecting any nested shape', () => {
    for (const value of [null, undefined, '', 0, false, [], Symbol('private')]) {
      expect(isChatGptActiveResolverObservedCapture(value)).toBe(false);
      expect(isChatGptActiveResolverHookResult(value)).toBe(false);
      expect(isChatGptActiveResolverResponse(value)).toBe(false);
    }
  });

  it('enforces bounded capture measurements and the exact capture field shape', () => {
    const capture = completeHook().outcomes[0].capture;
    expect(isChatGptActiveResolverObservedCapture(capture)).toBe(true);

    const malformed = [
      { ...capture, bodyBase64: 'x'.repeat(96 * 1024 + 1) },
      { ...capture, byteLength: -1 },
      { ...capture, byteLength: CHATGPT_ACTIVE_RESOLVER_MAX_BYTES + 1 },
      { ...capture, byteLength: 1.5 },
      { ...capture, byteLength: Number.NaN },
      { ...capture, sha256: 'x'.repeat(129) },
      { ...capture, mediaType: 'x'.repeat(256) },
      { ...capture, providerFileId: 'must-not-cross' },
    ];
    for (const value of malformed) {
      expect(isChatGptActiveResolverObservedCapture(value)).toBe(false);
    }
  });

  it('accepts only strict grammar, bounded terminal records, and metric-only responses', () => {
    expect(isChatGptActiveResolverProviderFileId('file_abc-123')).toBe(true);
    expect(isChatGptActiveResolverProviderFileId('dot.is-not-accepted')).toBe(false);
    expect(isChatGptActiveResolverProviderFileId('a'.repeat(257))).toBe(false);
    expect(isChatGptActiveResolverHookResult(completeHook())).toBe(true);
    const response = {
      success: true as const,
      data: {
        requestedCount: 1,
        dispatchCount: 1,
        observedCount: 1,
        outcomes: ['observed'],
        attemptedAt: '2026-08-24T12:00:00.000Z',
      },
    };
    expect(isChatGptActiveResolverResponse(response)).toBe(true);
    expect(JSON.stringify(response)).not.toContain('download_url');
  });

  it('rejects extra enumerable, non-enumerable, and symbol data at either boundary', () => {
    expect(isChatGptActiveResolverHookResult({ ...completeHook(), secret: 'no' })).toBe(false);
    const nonEnumerable = completeHook();
    Object.defineProperty(nonEnumerable.outcomes[0], 'providerFileId', {
      configurable: true,
      enumerable: false,
      value: 'private-file',
    });
    expect(isChatGptActiveResolverHookResult(nonEnumerable)).toBe(false);
    expect(
      isChatGptActiveResolverResponse({
        success: true,
        data: {
          requestedCount: 1,
          dispatchCount: 1,
          observedCount: 1,
          outcomes: ['observed'],
          attemptedAt: '2026-08-24T12:00:00.000Z',
          [Symbol('private')]: true,
        },
      })
    ).toBe(false);

    const readyWithHidden = { kind: 'ready' } as { kind: string } & Record<string, unknown>;
    Object.defineProperty(readyWithHidden, 'providerFileId', {
      configurable: true,
      enumerable: false,
      value: 'private-file',
    });
    expect(isChatGptActiveResolverHookResult(readyWithHidden)).toBe(false);

    const readyWithSymbol = { kind: 'ready', [Symbol('private')]: true };
    expect(isChatGptActiveResolverHookResult(readyWithSymbol)).toBe(false);

    const responseWithHidden = {
      success: true as const,
      data: {
        requestedCount: 0,
        dispatchCount: 0,
        observedCount: 0,
        outcomes: [],
        attemptedAt: '2026-08-24T12:00:00.000Z',
      },
    };
    Object.defineProperty(responseWithHidden.data, 'downloadUrl', {
      configurable: true,
      enumerable: false,
      value: 'https://private.example/signed',
    });
    expect(isChatGptActiveResolverResponse(responseWithHidden)).toBe(false);
  });

  it('accepts ready and error hook states while rejecting unknown error codes', () => {
    expect(isChatGptActiveResolverHookResult({ kind: 'ready' })).toBe(true);
    expect(isChatGptActiveResolverHookResult({ kind: 'error', code: 'source-http-error' })).toBe(
      true
    );
    expect(isChatGptActiveResolverHookResult({ kind: 'error', code: 'private-error' })).toBe(false);
    expect(
      isChatGptActiveResolverHookResult({ kind: 'error', code: 'source-http-error', detail: 'no' })
    ).toBe(false);
  });

  it('allows only the exact diagnostic outcome codes and one requested ordinal', () => {
    expect(
      isChatGptActiveResolverHookResult({ ...completeHook(), outcomes: [{ state: 'rejected' }] })
    ).toBe(false);
    expect(
      isChatGptActiveResolverHookResult({
        ...completeHook(),
        outcomes: [{ state: 'fetch-rejected' }],
      })
    ).toBe(true);
    expect(
      isChatGptActiveResolverHookResult({
        ...completeHook(),
        outcomes: [{ state: 'response-processing-rejected' }],
      })
    ).toBe(true);
    for (const state of [
      'payload-integrity-rejected',
      'download-url-missing',
      'download-url-binding-rejected',
    ] as const) {
      expect(isChatGptActiveResolverHookResult({ ...completeHook(), outcomes: [{ state }] })).toBe(
        false
      );
    }
    expect(
      isChatGptActiveResolverHookResult({
        ...completeHook(),
        requestedCount: 1,
        dispatchCount: 0,
        outcomes: [{ state: 'not-dispatched' }],
      })
    ).toBe(true);
    expect(
      isChatGptActiveResolverHookResult({
        ...completeHook(),
        requestedCount: CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT + 1,
        dispatchCount: 1,
        outcomes: [{ state: 'http-error' }, { state: 'not-dispatched' }],
      })
    ).toBe(false);
    const failure = createChatGptActiveResolverFailure('source-non-json');
    expect(failure).toEqual({ success: false, code: 'source-non-json' });
    expect(isChatGptActiveResolverResponse(failure)).toBe(true);
  });

  it('keeps metric counts, observed cardinality, and timestamps internally consistent', () => {
    const base = {
      success: true as const,
      data: {
        requestedCount: 1,
        dispatchCount: 1,
        observedCount: 1,
        outcomes: ['observed'],
        attemptedAt: '2026-08-24T12:00:00.000Z',
      },
    };
    expect(isChatGptActiveResolverResponse(base)).toBe(true);

    const malformed = [
      { ...base, data: { ...base.data, requestedCount: -1 } },
      {
        ...base,
        data: {
          ...base.data,
          requestedCount: CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT + 1,
          outcomes: ['observed', 'not-dispatched'],
        },
      },
      { ...base, data: { ...base.data, requestedCount: 2.5 } },
      { ...base, data: { ...base.data, dispatchCount: 2 } },
      {
        ...base,
        data: { ...base.data, dispatchCount: 0, outcomes: ['observed'] },
      },
      {
        ...base,
        data: { ...base.data, dispatchCount: 1, outcomes: ['not-dispatched'] },
      },
      {
        ...base,
        data: { ...base.data, dispatchCount: 0, observedCount: 1 },
      },
      { ...base, data: { ...base.data, observedCount: 2 } },
      { ...base, data: { ...base.data, outcomes: [] } },
      { ...base, data: { ...base.data, outcomes: ['rejected'] } },
      { ...base, data: { ...base.data, outcomes: ['private'] } },
      { ...base, data: { ...base.data, attemptedAt: 'not-a-timestamp' } },
      { ...base, data: { ...base.data, attemptedAt: '2026-99-99T12:00:00.000Z' } },
      { ...base, data: { ...base.data, observedCount: 0 } },
    ];
    for (const value of malformed) {
      expect(isChatGptActiveResolverResponse(value)).toBe(false);
    }

    expect(isChatGptActiveResolverResponse({ success: false, code: 'source-http-error' })).toBe(
      true
    );
    expect(isChatGptActiveResolverResponse({ success: false, code: 'private-error' })).toBe(false);
    expect(
      isChatGptActiveResolverResponse({
        success: false,
        code: 'source-http-error',
        error: 'private diagnostics',
      })
    ).toBe(false);
    const hostile = new Proxy(completeHook(), {
      ownKeys() {
        throw new Error('synthetic ownKeys failure');
      },
    });
    expect(isChatGptActiveResolverHookResult(hostile)).toBe(false);
  });
});
