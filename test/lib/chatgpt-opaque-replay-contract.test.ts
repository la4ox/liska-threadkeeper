import { describe, expect, it } from 'vitest';
import { CHATGPT_CAPTURE_ENDPOINT } from '../../src/lib/chatgpt-capture-contract';
import {
  CHATGPT_OPAQUE_REPLAY_ERROR_CODES,
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
    routeFamily: 'standard' as const,
    transientAssetResolvers: [] as [],
  };
}

describe('ChatGPT opaque replay contract', () => {
  it('requires only a fixed route family and never accepts owner route fields', () => {
    for (const routeFamily of ['standard', 'custom-gpt', 'project']) {
      expect(isChatGptOpaqueReplayArtifact({ ...artifact(), routeFamily })).toBe(true);
    }
    const { routeFamily: _route, ...missing } = artifact();
    expect(isChatGptOpaqueReplayArtifact(missing)).toBe(false);
    for (const routeFamily of [null, '', 'owner', 'STANDARD', '/g/private']) {
      expect(isChatGptOpaqueReplayArtifact({ ...artifact(), routeFamily })).toBe(false);
    }
    for (const extra of ['pathname', 'slug', 'target']) {
      expect(isChatGptOpaqueReplayArtifact({ ...artifact(), [extra]: '/g/private' })).toBe(false);
    }
  });
  it.each(['source-response-timeout', 'replay-response-timeout', 'timed-out'] as const)(
    'accepts only the exact timeout code %s with bounded observed counts',
    code => {
      for (const singularDispatchCount of [0, 1] as const) {
        expect(
          isChatGptOpaqueReplayHookResult({ kind: 'error', code, singularDispatchCount })
        ).toBe(true);
        expect(
          isChatGptOpaqueReplayResponse(
            createChatGptOpaqueReplayFailure(code, singularDispatchCount)
          )
        ).toBe(true);
      }
      for (const singularDispatchCount of [-1, 2, '1', undefined]) {
        expect(
          isChatGptOpaqueReplayHookResult({ kind: 'error', code, singularDispatchCount })
        ).toBe(false);
        expect(isChatGptOpaqueReplayResponse({ success: false, code, singularDispatchCount })).toBe(
          false
        );
      }
      const suffixedCode = `${code}:synthetic-secret`;
      expect(
        isChatGptOpaqueReplayHookResult({
          kind: 'error',
          code: suffixedCode,
          singularDispatchCount: 0,
        })
      ).toBe(false);
      expect(
        isChatGptOpaqueReplayResponse({
          success: false,
          code: suffixedCode,
          singularDispatchCount: 0,
        })
      ).toBe(false);
    }
  );

  it.each([
    'shape',
    'prototype',
    'inherited',
    'symbol',
    'descriptor',
    'accessor',
    'limit',
    'entry',
    'unstable',
    'reflection',
  ] as const)('accepts the fixed header rejection reason %s', reason => {
    const code = `init-security-sensitive-headers-unbranded-${reason}` as const;
    expect(isChatGptOpaqueReplayHookResult({ kind: 'error', code, singularDispatchCount: 0 })).toBe(
      true
    );
    expect(isChatGptOpaqueReplayResponse(createChatGptOpaqueReplayFailure(code))).toBe(true);
  });

  it.each([
    'init-security-sensitive-headers-unbranded',
    'init-security-sensitive-headers-unbranded-synthetic-secret',
    'init-security-sensitive-headers-unbranded-entry-synthetic-secret',
    'init-security-sensitive-headers-unbranded-ENTRY',
  ])('rejects the non-allowlisted header reason %s', code => {
    expect(isChatGptOpaqueReplayHookResult({ kind: 'error', code, singularDispatchCount: 0 })).toBe(
      false
    );
    expect(isChatGptOpaqueReplayResponse({ success: false, code, singularDispatchCount: 0 })).toBe(
      false
    );
  });

  it('accepts only exact bounded error codes at hook and response boundaries', () => {
    for (const code of CHATGPT_OPAQUE_REPLAY_ERROR_CODES) {
      expect(
        isChatGptOpaqueReplayHookResult({ kind: 'error', code, singularDispatchCount: 0 })
      ).toBe(true);
      expect(isChatGptOpaqueReplayResponse(createChatGptOpaqueReplayFailure(code))).toBe(true);
    }
    const code = 'init-security-sensitive-headers:synthetic-secret';
    expect(isChatGptOpaqueReplayHookResult({ kind: 'error', code, singularDispatchCount: 0 })).toBe(
      false
    );
    expect(isChatGptOpaqueReplayResponse({ success: false, code, singularDispatchCount: 0 })).toBe(
      false
    );
  });

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
