import { describe, expect, it } from 'vitest';
import {
  createChatGptOpaqueProbeResult,
  isChatGptOpaqueProbeResponse,
  isChatGptOpaqueProbeResult,
} from '../../src/lib/chatgpt-opaque-probe-contract';

describe('ChatGPT opaque probe contract', () => {
  it('creates a bounded zero-dispatch result with no request values', () => {
    const result = createChatGptOpaqueProbeResult('eligible', {
      observedTargetRequest: true,
      sourceIsNativeRequest: true,
      initAbsent: true,
      exactTarget: true,
      authorizationPresent: true,
      credentialsAccepted: true,
      sourceStatus: 200,
      sourceJson: true,
    });

    expect(result).toEqual({
      observedTargetRequest: true,
      sourceIsNativeRequest: true,
      initAbsent: true,
      exactTarget: true,
      authorizationPresent: true,
      credentialsAccepted: true,
      sourceStatus: 200,
      sourceJson: true,
      singularDispatchCount: 0,
      outcome: 'eligible',
    });
    expect(JSON.stringify(result)).not.toContain('authorization:');
  });

  it('requires exact own keys and a bounded HTTP status', () => {
    const valid = createChatGptOpaqueProbeResult('source-http-forbidden', {
      sourceStatus: 403,
    });
    expect(isChatGptOpaqueProbeResult(valid)).toBe(true);
    expect(isChatGptOpaqueProbeResult({ ...valid, secret: 'synthetic-secret' })).toBe(false);
    const nonEnumerableExtra = { ...valid };
    Object.defineProperty(nonEnumerableExtra, 'secret', {
      configurable: true,
      enumerable: false,
      value: 'synthetic-secret',
    });
    expect(isChatGptOpaqueProbeResult(nonEnumerableExtra)).toBe(false);
    expect(isChatGptOpaqueProbeResult({ ...valid, [Symbol('secret')]: true })).toBe(false);
    expect(isChatGptOpaqueProbeResult({ ...valid, singularDispatchCount: 1 })).toBe(false);
    expect(isChatGptOpaqueProbeResult({ ...valid, sourceStatus: 600 })).toBe(false);
    expect(isChatGptOpaqueProbeResponse({ success: false, data: valid })).toBe(true);
    expect(isChatGptOpaqueProbeResponse({ success: false, data: valid, extra: true })).toBe(false);
  });

  it.each([
    'eligible-init-empty',
    'eligible-init-signal-only',
    'init-security-sensitive',
    'init-unsupported',
  ] as const)('accepts the bounded RequestInit classification outcome %s', outcome => {
    expect(isChatGptOpaqueProbeResult(createChatGptOpaqueProbeResult(outcome))).toBe(true);
  });
});
