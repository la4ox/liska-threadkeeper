import { describe, expect, it } from 'vitest';
import {
  createChatGptOpaqueResolverFailure,
  isChatGptOpaqueResolverObservation,
  isChatGptOpaqueResolverHookResult,
  isChatGptOpaqueResolverResponse,
} from '../../src/lib/chatgpt-opaque-resolver-contract';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const DOWNLOAD_URL =
  'https://chatgpt.com/backend-api/estuary/content?cid=01234567-89ab-4cde-8f01-23456789abcd&id=file-abc&p=1&sig=2&ts=3&v=4';

function observedHook() {
  return {
    kind: 'observed' as const,
    conversationId: CONVERSATION_ID,
    resolverObservations: [
      {
        providerFileId: 'file-abc_123',
        bodyBase64: 'e30=',
        byteLength: 2,
        sha256: '0'.repeat(64),
        mediaType: 'application/json',
      },
    ],
    singularDispatchCount: 0 as const,
  };
}

describe('ChatGPT opaque resolver contract', () => {
  it('accepts only zero-dispatch, bounded exact hook observations', () => {
    expect(isChatGptOpaqueResolverHookResult(observedHook())).toBe(true);
    expect(isChatGptOpaqueResolverHookResult({ ...observedHook(), singularDispatchCount: 1 })).toBe(
      false
    );
    expect(
      isChatGptOpaqueResolverHookResult({
        ...observedHook(),
        resolverObservations: [{ ...observedHook().resolverObservations[0], byteLength: 3 }],
      })
    ).toBe(false);
  });

  it('rejects enumerable, non-enumerable, and symbol extras at the page boundary', () => {
    expect(isChatGptOpaqueResolverHookResult({ ...observedHook(), secret: 'nope' })).toBe(false);
    const nonEnumerableExtra = observedHook();
    Object.defineProperty(nonEnumerableExtra, 'secret', {
      configurable: true,
      enumerable: false,
      value: 'nope',
    });
    expect(isChatGptOpaqueResolverHookResult(nonEnumerableExtra)).toBe(false);
    expect(isChatGptOpaqueResolverHookResult({ ...observedHook(), [Symbol('secret')]: true })).toBe(
      false
    );
  });

  it('allows an honest empty success but no malformed resolver response shape', () => {
    const success = { success: true as const, data: { transientAssetResolvers: [] } };
    expect(isChatGptOpaqueResolverResponse(success)).toBe(true);
    expect(isChatGptOpaqueResolverResponse({ ...success, secret: 'nope' })).toBe(false);
    const failure = createChatGptOpaqueResolverFailure('source-non-json');
    expect(failure).toEqual({ success: false, code: 'source-non-json', singularDispatchCount: 0 });
    expect(isChatGptOpaqueResolverResponse(failure)).toBe(true);
  });

  it('rejects primitive or extra-key observations and duplicate opaque resolver keys', () => {
    expect(isChatGptOpaqueResolverObservation(null)).toBe(false);
    expect(isChatGptOpaqueResolverObservation('not-an-observation')).toBe(false);
    expect(
      isChatGptOpaqueResolverObservation({
        ...observedHook().resolverObservations[0],
        secret: 'synthetic-secret',
      })
    ).toBe(false);

    const duplicateResolver = {
      resolverKey: 'a'.repeat(64),
      downloadUrl: DOWNLOAD_URL,
    };
    expect(
      isChatGptOpaqueResolverResponse({
        success: true,
        data: { transientAssetResolvers: [duplicateResolver, { ...duplicateResolver }] },
      })
    ).toBe(false);
  });

  it('accepts only bounded JSON media types in raw resolver observations', () => {
    const observation = observedHook().resolverObservations[0];
    expect(
      isChatGptOpaqueResolverObservation({
        ...observation,
        mediaType: 'application/problem+json; charset=utf-8',
      })
    ).toBe(true);
    for (const mediaType of [null, '', 'a'.repeat(256), 'application/json\u0001', 'text/plain']) {
      expect(isChatGptOpaqueResolverObservation({ ...observation, mediaType })).toBe(false);
    }
  });

  it('validates exact ready/error hook states and rejects non-object boundaries', () => {
    expect(isChatGptOpaqueResolverHookResult(null)).toBe(false);
    expect(isChatGptOpaqueResolverHookResult('ready')).toBe(false);
    expect(isChatGptOpaqueResolverHookResult({ kind: 'ready' })).toBe(true);
    expect(isChatGptOpaqueResolverHookResult({ kind: 'ready', extra: true })).toBe(false);
    expect(
      isChatGptOpaqueResolverHookResult({
        kind: 'error',
        code: 'source-rejected',
        singularDispatchCount: 0,
      })
    ).toBe(true);
    expect(
      isChatGptOpaqueResolverHookResult({
        kind: 'error',
        code: 'unknown-code',
        singularDispatchCount: 0,
      })
    ).toBe(false);
  });

  it('rejects primitive and malformed success/failure response boundaries', () => {
    expect(isChatGptOpaqueResolverResponse(null)).toBe(false);
    expect(isChatGptOpaqueResolverResponse('success')).toBe(false);
    expect(isChatGptOpaqueResolverResponse({ success: true, data: null })).toBe(false);
    expect(
      isChatGptOpaqueResolverResponse({
        success: true,
        data: { transientAssetResolvers: 'not-an-array' },
      })
    ).toBe(false);
    expect(
      isChatGptOpaqueResolverResponse({
        success: false,
        code: 'source-rejected',
        singularDispatchCount: 1,
      })
    ).toBe(false);
  });
});
