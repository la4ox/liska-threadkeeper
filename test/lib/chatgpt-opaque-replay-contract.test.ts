import { describe, expect, it } from 'vitest';
import { CHATGPT_CAPTURE_ENDPOINT } from '../../src/lib/chatgpt-capture-contract';
import { ARCHIVE_STAGE_RELATIVE_PATHS } from '../../src/lib/archive-stage-contract';
import {
  CHATGPT_OPAQUE_REPLAY_ERROR_CODES,
  createChatGptOpaqueReplayFailure,
  isChatGptOpaqueReplayArtifact,
  isChatGptOpaqueReplayHookResult,
  isChatGptOpaqueReplayResponse,
} from '../../src/lib/chatgpt-opaque-replay-contract';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const SHA256 = '0'.repeat(64);
const STAGE_ID = `archive-stage-${'A'.repeat(32)}`;

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

function stagedHook(byteLength = 16 * 1024 * 1024 + 1) {
  return {
    kind: 'captured' as const,
    conversationId: CONVERSATION_ID,
    capture: {
      transportVersion: 1 as const,
      transport: 'staged' as const,
      byteLength,
      sha256: SHA256,
      mediaType: 'application/json',
      chunkCount: Math.ceil(byteLength / (512 * 1024)),
    },
    singularDispatchCount: 1 as const,
  };
}

function stagedArtifact() {
  return {
    transport: 'staged' as const,
    routeFamily: 'standard' as const,
    stageId: STAGE_ID,
    kind: 'raw' as const,
    relativePath: ARCHIVE_STAGE_RELATIVE_PATHS.raw,
    byteLength: 16 * 1024 * 1024 + 1,
    sha256: SHA256,
    mediaType: 'application/json' as const,
    endpoint: { ...CHATGPT_CAPTURE_ENDPOINT },
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
  it.each([
    'target-not-observed-singular-path-seen',
    'source-response-timeout',
    'replay-response-timeout',
    'timed-out',
  ] as const)('accepts only the exact deadline code %s with bounded observed counts', code => {
    for (const singularDispatchCount of [0, 1] as const) {
      expect(isChatGptOpaqueReplayHookResult({ kind: 'error', code, singularDispatchCount })).toBe(
        true
      );
      expect(
        isChatGptOpaqueReplayResponse(createChatGptOpaqueReplayFailure(code, singularDispatchCount))
      ).toBe(true);
    }
    for (const singularDispatchCount of [-1, 2, '1', undefined]) {
      expect(isChatGptOpaqueReplayHookResult({ kind: 'error', code, singularDispatchCount })).toBe(
        false
      );
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
  });

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

  it('accepts only exact version-1 staged metadata above 16 MiB through 64 MiB', () => {
    expect(isChatGptOpaqueReplayHookResult(stagedHook())).toBe(true);
    expect(isChatGptOpaqueReplayHookResult(stagedHook(64 * 1024 * 1024))).toBe(true);
    for (const capture of [
      { ...stagedHook().capture, transportVersion: 2 },
      { ...stagedHook().capture, byteLength: 16 * 1024 * 1024 },
      { ...stagedHook().capture, byteLength: 64 * 1024 * 1024 + 1, chunkCount: 129 },
      { ...stagedHook().capture, chunkCount: 32 },
      { ...stagedHook().capture, bodyBase64: 'AA==' },
      { ...capturedHook().capture, transport: 'staged', transportVersion: 1 },
    ]) {
      expect(isChatGptOpaqueReplayHookResult({ ...stagedHook(), capture })).toBe(false);
    }
  });

  it('rejects staged accessors, prototype tricks, and hidden or symbol members', () => {
    const accessor = stagedHook().capture as Record<string, unknown>;
    Object.defineProperty(accessor, 'chunkCount', {
      enumerable: true,
      get: () => 33,
    });
    expect(isChatGptOpaqueReplayHookResult({ ...stagedHook(), capture: accessor })).toBe(false);

    const malformedPrototype = Object.assign(
      Object.create({ inherited: true }),
      stagedHook().capture
    );
    expect(isChatGptOpaqueReplayHookResult({ ...stagedHook(), capture: malformedPrototype })).toBe(
      false
    );

    const hidden = stagedHook().capture;
    Object.defineProperty(hidden, 'hidden', { value: true });
    expect(isChatGptOpaqueReplayHookResult({ ...stagedHook(), capture: hidden })).toBe(false);
    expect(
      isChatGptOpaqueReplayHookResult({
        ...stagedHook(),
        capture: { ...stagedHook().capture, [Symbol('extra')]: true },
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

  it('accepts only the exact sealed extension-owned staged artifact', () => {
    expect(isChatGptOpaqueReplayArtifact(stagedArtifact())).toBe(true);
    for (const value of [
      { ...stagedArtifact(), bodyBase64: 'AA==' },
      { ...stagedArtifact(), stageId: 'page-stage' },
      { ...stagedArtifact(), byteLength: 16 * 1024 * 1024 },
      { ...stagedArtifact(), relativePath: 'page/selected.json' },
      { ...stagedArtifact(), kind: 'canonical' },
      { ...stagedArtifact(), transientAssetResolvers: [{}] },
    ]) {
      expect(isChatGptOpaqueReplayArtifact(value)).toBe(false);
    }
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

  it('keeps the singular-path diagnostic an exact code-only failure', () => {
    const code = 'target-not-observed-singular-path-seen';
    const hook = { kind: 'error', code, singularDispatchCount: 0 };
    const failure = createChatGptOpaqueReplayFailure(code);
    expect(failure).toEqual({ success: false, code, singularDispatchCount: 0 });
    expect(isChatGptOpaqueReplayHookResult(hook)).toBe(true);
    expect(isChatGptOpaqueReplayResponse(failure)).toBe(true);
    for (const extra of ['url', 'query', 'headers', 'body', 'singularPathSeen']) {
      expect(isChatGptOpaqueReplayHookResult({ ...hook, [extra]: 'synthetic-secret' })).toBe(false);
      expect(isChatGptOpaqueReplayResponse({ ...failure, [extra]: 'synthetic-secret' })).toBe(
        false
      );
    }
    expect(JSON.stringify(failure)).not.toContain('synthetic-secret');
  });
});
