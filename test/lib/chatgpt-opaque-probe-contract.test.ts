import { describe, expect, it } from 'vitest';
import {
  createChatGptOpaqueProbeResult,
  isChatGptOpaqueProbeResponse,
  isChatGptOpaqueProbeResult,
} from '../../src/lib/chatgpt-opaque-probe-contract';

describe('ChatGPT opaque probe contract', () => {
  it.each([
    'init-security-sensitive-headers-unbranded',
    'init-security-sensitive-headers-unbranded-synthetic-secret',
    'init-security-sensitive-headers-unbranded-entry-synthetic-secret',
    'init-security-sensitive-headers-unbranded-ENTRY',
  ])('rejects the non-allowlisted header reason %s', outcome => {
    const result = { ...createChatGptOpaqueProbeResult('probe-failed'), outcome };
    expect(isChatGptOpaqueProbeResult(result)).toBe(false);
    expect(isChatGptOpaqueProbeResponse({ success: false, data: result })).toBe(false);
  });

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
    expect(
      isChatGptOpaqueProbeResult({ ...valid, outcome: 'eligible-init-compatible:synthetic-secret' })
    ).toBe(false);
  });

  it.each([
    'eligible-init-empty',
    'eligible-init-signal-only',
    'eligible-init-compatible',
    'eligible-init-plain-headers',
    'init-security-sensitive',
    'init-security-sensitive-headers',
    'init-security-sensitive-headers-distinct',
    'init-security-sensitive-headers-native-distinct',
    'init-security-sensitive-headers-unbranded-shape',
    'init-security-sensitive-headers-unbranded-prototype',
    'init-security-sensitive-headers-unbranded-inherited',
    'init-security-sensitive-headers-unbranded-symbol',
    'init-security-sensitive-headers-unbranded-descriptor',
    'init-security-sensitive-headers-unbranded-accessor',
    'init-security-sensitive-headers-unbranded-limit',
    'init-security-sensitive-headers-unbranded-entry',
    'init-security-sensitive-headers-unbranded-unstable',
    'init-security-sensitive-headers-unbranded-reflection',
    'init-security-sensitive-body',
    'init-security-sensitive-method',
    'init-security-sensitive-credentials',
    'init-security-sensitive-multiple',
    'init-unsupported',
    'init-unsupported-prototype',
    'init-unsupported-inherited',
    'init-unsupported-symbol',
    'init-unsupported-member',
    'init-unsupported-accessor',
    'init-unsupported-reflection',
  ] as const)('accepts the bounded RequestInit classification outcome %s', outcome => {
    expect(isChatGptOpaqueProbeResult(createChatGptOpaqueProbeResult(outcome))).toBe(true);
  });
});
