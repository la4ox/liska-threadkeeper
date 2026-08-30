import { describe, expect, it } from 'vitest';
import { CHATGPT_CAPTURE_ENDPOINT } from '../../src/lib/chatgpt-capture-contract';
import {
  createChatGptOpaqueReplayFailure,
  isChatGptOpaqueReplayArtifact,
  isChatGptOpaqueReplayHookResult,
  isChatGptOpaqueReplayResponse,
} from '../../src/lib/chatgpt-opaque-replay-contract';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const SHA256 = '0'.repeat(64);

function capturedHook() {
  return {
    kind: 'captured' as const,
    conversationId: CONVERSATION_ID,
    capture: {
      bodyBase64: 'AP8B',
      byteLength: 3,
      sha256: SHA256,
      mediaType: 'application/json; charset=utf-8',
    },
    singularDispatchCount: 1 as const,
  };
}

function artifact() {
  return {
    bodyBase64: 'AP8B',
    byteLength: 3,
    sha256: SHA256,
    mediaType: 'application/json',
    endpoint: { ...CHATGPT_CAPTURE_ENDPOINT },
    transientAssetResolvers: [] as [],
  };
}

describe('ChatGPT opaque replay contract', () => {
  it('accepts only an exact one-dispatch page capture shape', () => {
    expect(isChatGptOpaqueReplayHookResult(capturedHook())).toBe(true);
    expect(isChatGptOpaqueReplayHookResult({ ...capturedHook(), singularDispatchCount: 0 })).toBe(
      false
    );
    expect(
      isChatGptOpaqueReplayHookResult({
        ...capturedHook(),
        capture: { ...capturedHook().capture, bodyBase64: 'AP8B=' },
      })
    ).toBe(false);
  });

  it('rejects enumerable, non-enumerable, and symbol extras at the page boundary', () => {
    expect(isChatGptOpaqueReplayHookResult({ ...capturedHook(), secret: 'synthetic-secret' })).toBe(
      false
    );
    const nonEnumerableExtra = capturedHook();
    Object.defineProperty(nonEnumerableExtra, 'secret', {
      configurable: true,
      enumerable: false,
      value: 'synthetic-secret',
    });
    expect(isChatGptOpaqueReplayHookResult(nonEnumerableExtra)).toBe(false);
    expect(isChatGptOpaqueReplayHookResult({ ...capturedHook(), [Symbol('secret')]: true })).toBe(
      false
    );
  });

  it('keeps the core artifact compatible with capture but requires its exact endpoint and empty resolver list', () => {
    expect(isChatGptOpaqueReplayArtifact(artifact())).toBe(true);
    const missingEndpoint = { ...artifact() } as Record<string, unknown>;
    delete missingEndpoint.endpoint;
    expect(isChatGptOpaqueReplayArtifact(missingEndpoint)).toBe(false);
    expect(
      isChatGptOpaqueReplayArtifact({
        ...artifact(),
        endpoint: { ...CHATGPT_CAPTURE_ENDPOINT, extra: true },
      })
    ).toBe(false);
    expect(
      isChatGptOpaqueReplayArtifact({
        ...artifact(),
        transientAssetResolvers: [{ resolverKey: 'not-allowed' }],
      })
    ).toBe(false);
  });

  it('emits failures as an exact stable code plus a bounded dispatch count', () => {
    const failure = createChatGptOpaqueReplayFailure('replay-rejected', 1);
    expect(failure).toEqual({
      success: false,
      code: 'replay-rejected',
      singularDispatchCount: 1,
    });
    expect(isChatGptOpaqueReplayResponse(failure)).toBe(true);
    expect(isChatGptOpaqueReplayResponse({ ...failure, secret: 'synthetic-secret' })).toBe(false);
  });
});
