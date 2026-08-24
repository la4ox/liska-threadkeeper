import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureChatGptConversationViaOpaqueReplay,
  readChatGptOpaqueReplayState,
} from '../../src/background/chatgpt-opaque-replay';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const OTHER_CONVERSATION_ID = '11111111-2222-3333-4444-555555555555';
const NONCE = 'f8c1f0a5-b3dd-4d2a-9a11-8e915f6c3e72';
const MARKER = `#liska-capture=${NONCE}&liska-opaque-replay=1`;
const SHA256 = '0'.repeat(64);

function capturedState(conversationId = CONVERSATION_ID) {
  return {
    kind: 'captured',
    conversationId,
    capture: {
      bodyBase64: 'AP8B',
      byteLength: 3,
      sha256: SHA256,
      mediaType: 'application/json; charset=utf-8',
    },
    singularDispatchCount: 1,
  };
}

function chromeApi(result: unknown, url?: string) {
  const create = vi.fn().mockResolvedValue({ id: 123 });
  const remove = vi.fn().mockResolvedValue(undefined);
  return {
    create,
    remove,
    api: {
      tabs: {
        create,
        get: vi.fn().mockResolvedValue({
          status: 'complete',
          url: url ?? `https://chatgpt.com/c/${CONVERSATION_ID}${MARKER}`,
        }),
        remove,
      },
      scripting: { executeScript: vi.fn().mockResolvedValue([{ result }]) },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ChatGPT opaque replay temporary-tab core', () => {
  it('uses the bounded default nonce, sleep, and SHA-256 implementation', async () => {
    const bytes = new Uint8Array([0, 255, 1]);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const sha256 = Array.from(new Uint8Array(digest), byte =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    let createdUrl = '';
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([{ result: { kind: 'ready' } }])
      .mockResolvedValueOnce([
        {
          result: {
            ...capturedState(),
            capture: { ...capturedState().capture, sha256 },
          },
        },
      ]);
    const response = await captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: {
        tabs: {
          create: vi.fn(async ({ url }) => {
            createdUrl = url;
            return { id: 123 };
          }),
          get: vi.fn(async () => ({ status: 'complete', url: createdUrl })),
          remove: vi.fn().mockResolvedValue(undefined),
        },
        scripting: { executeScript },
      },
    });

    expect(response).toMatchObject({ success: true, data: { sha256 } });
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it('opens only the exact marker route, validates bytes/hash, and removes the disposable tab', async () => {
    const chrome = chromeApi(capturedState());
    const response = await captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      digestSha256: async () => SHA256,
    });

    expect(response).toEqual({
      success: true,
      data: {
        bodyBase64: 'AP8B',
        byteLength: 3,
        sha256: SHA256,
        mediaType: 'application/json; charset=utf-8',
        endpoint: { method: 'GET', pathPattern: '/backend-api/conversation/{conversationId}' },
        transientAssetResolvers: [],
      },
    });
    expect(chrome.create).toHaveBeenCalledWith({
      url: `https://chatgpt.com/c/${CONVERSATION_ID}${MARKER}`,
      active: false,
    });
    expect(chrome.remove).toHaveBeenCalledWith(123);
    expect(JSON.stringify(response)).not.toContain('synthetic-authorization-sentinel');
  });

  it('clamps explicit timeout and polling bounds without changing a valid result', async () => {
    const chrome = chromeApi(capturedState());
    const response = await captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      digestSha256: async () => SHA256,
      timeoutMs: Number.POSITIVE_INFINITY,
      pollIntervalMs: -10,
    });
    expect(response.success).toBe(true);
  });

  it.each([
    ['wrong conversation state', capturedState(OTHER_CONVERSATION_ID), 'replay-result-invalid', 1],
    [
      'noncanonical base64',
      {
        ...capturedState(),
        capture: { ...capturedState().capture, bodyBase64: 'AP8B=' },
      },
      'replay-result-timeout',
      0,
    ],
  ])('rejects %s without adapting response bytes', async (_label, result, expectedCode, count) => {
    let now = 0;
    const chrome = chromeApi(result);
    const response = await captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      digestSha256: async () => SHA256,
      timeoutMs: 1_000,
      now: () => now,
      sleep: async () => {
        now = 1_001;
      },
    });

    expect(response).toEqual({
      success: false,
      code: expectedCode,
      singularDispatchCount: count,
    });
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('fails closed on marker/path mismatch before reading MAIN-world state', async () => {
    const chrome = chromeApi(
      capturedState(),
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-probe=1`
    );
    const response = await captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
    });

    expect(response).toEqual({ success: false, code: 'unexpected-path', singularDispatchCount: 0 });
    expect(chrome.api.scripting.executeScript).not.toHaveBeenCalled();
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('returns the stable one-count failure from MAIN world without a retry', async () => {
    const chrome = chromeApi({
      kind: 'error',
      code: 'replay-rejected',
      singularDispatchCount: 1,
    });
    const response = await captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
    });

    expect(response).toEqual({ success: false, code: 'replay-rejected', singularDispatchCount: 1 });
    expect(chrome.api.scripting.executeScript).toHaveBeenCalledOnce();
  });

  it('bounds a hanging script read and still closes the tab', async () => {
    vi.useFakeTimers();
    const chrome = chromeApi({ kind: 'ready' });
    chrome.api.scripting.executeScript = vi.fn(() => new Promise(() => undefined));
    const pending = captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toEqual({
      success: false,
      code: 'replay-result-timeout',
      singularDispatchCount: 0,
    });
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('bounds a hanging post-capture digest and still closes the tab', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const chrome = chromeApi(capturedState());
    const pending = captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      digestSha256: () => new Promise<string>(() => undefined),
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(1_001);

    await expect(pending).resolves.toEqual({
      success: false,
      code: 'replay-result-timeout',
      singularDispatchCount: 1,
    });
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('cleans a late-created tab after the deadline and bounds a hanging remove', async () => {
    vi.useFakeTimers();
    let resolveCreate: ((value: { id?: number }) => void) | undefined;
    const create = vi.fn(
      () =>
        new Promise<{ id?: number }>(resolve => {
          resolveCreate = resolve;
        })
    );
    const remove = vi.fn(() => new Promise<void>(() => undefined));
    const pending = captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: {
        tabs: { create, get: vi.fn(), remove },
        scripting: { executeScript: vi.fn() },
      },
      createNonce: () => NONCE,
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toEqual({
      success: false,
      code: 'temporary-tab-create-failed',
      singularDispatchCount: 0,
    });
    resolveCreate?.({ id: 456 });
    await vi.advanceTimersByTimeAsync(501);
    expect(remove).toHaveBeenCalledWith(456);
  });

  it('does not create a tab for an invalid conversation identifier', async () => {
    const create = vi.fn();
    const response = await captureChatGptConversationViaOpaqueReplay('not-a-uuid', {
      chromeApi: {
        tabs: { create, get: vi.fn(), remove: vi.fn() },
        scripting: { executeScript: vi.fn() },
      },
    });
    expect(response).toEqual({
      success: false,
      code: 'invalid-conversation-id',
      singularDispatchCount: 0,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['an invalid nonce', () => 'bad'],
    [
      'a throwing nonce source',
      () => {
        throw new Error('synthetic nonce failure');
      },
    ],
  ])('fails before tab creation for %s', async (_label, createNonce) => {
    const create = vi.fn();
    const response = await captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: {
        tabs: { create, get: vi.fn(), remove: vi.fn() },
        scripting: { executeScript: vi.fn() },
      },
      createNonce,
    });
    expect(response).toEqual({
      success: false,
      code: 'nonce-invalid',
      singularDispatchCount: 0,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a synchronous create failure',
      () => {
        throw new Error('synthetic create failure');
      },
      'temporary-tab-create-failed',
    ],
    ['a missing tab id', () => Promise.resolve({}), 'temporary-tab-missing-id'],
  ])('fails closed for %s', async (_label, create, code) => {
    const response = await captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: {
        tabs: { create: vi.fn(create), get: vi.fn(), remove: vi.fn() },
        scripting: { executeScript: vi.fn() },
      },
      createNonce: () => NONCE,
    });
    expect(response).toEqual({ success: false, code, singularDispatchCount: 0 });
  });

  it('rejects a redirected temporary tab on another origin', async () => {
    const chrome = chromeApi(capturedState(), `https://evil.example/c/${CONVERSATION_ID}${MARKER}`);
    const response = await captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
    });
    expect(response).toEqual({
      success: false,
      code: 'unexpected-origin',
      singularDispatchCount: 0,
    });
    expect(chrome.api.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('turns repeated tab-read failures into a bounded readiness timeout', async () => {
    let now = 0;
    const remove = vi.fn().mockResolvedValue(undefined);
    const response = await captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: {
        tabs: {
          create: vi.fn().mockResolvedValue({ id: 123 }),
          get: vi.fn().mockRejectedValue(new Error('synthetic tab read failure')),
          remove,
        },
        scripting: { executeScript: vi.fn() },
      },
      createNonce: () => NONCE,
      timeoutMs: 1_000,
      now: () => now,
      sleep: async () => {
        now = 1_001;
      },
    });
    expect(response).toEqual({
      success: false,
      code: 'temporary-tab-ready-timeout',
      singularDispatchCount: 0,
    });
    expect(remove).toHaveBeenCalledWith(123);
  });

  it('contains an unexpected lifecycle clock failure and still removes the exact tab', async () => {
    let calls = 0;
    const remove = vi.fn().mockResolvedValue(undefined);
    const response = await captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: {
        tabs: {
          create: vi.fn().mockResolvedValue({ id: 123 }),
          get: vi.fn(),
          remove,
        },
        scripting: { executeScript: vi.fn() },
      },
      createNonce: () => NONCE,
      now: () => {
        calls += 1;
        if (calls >= 3) throw new Error('synthetic clock failure');
        return 0;
      },
    });
    expect(response).toEqual({
      success: false,
      code: 'replay-result-invalid',
      singularDispatchCount: 0,
    });
    expect(remove).toHaveBeenCalledWith(123);
  });

  it('bounds rejected readiness and result sleeps without leaking the tab', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const readiness = await captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: {
        tabs: {
          create: vi.fn().mockResolvedValue({ id: 123 }),
          get: vi.fn().mockResolvedValue({ status: 'loading' }),
          remove,
        },
        scripting: { executeScript: vi.fn() },
      },
      createNonce: () => NONCE,
      sleep: () => Promise.reject(new Error('synthetic sleep failure')),
    });
    expect(readiness).toEqual({
      success: false,
      code: 'temporary-tab-ready-timeout',
      singularDispatchCount: 0,
    });

    const chrome = chromeApi({ kind: 'ready' });
    const result = await captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      sleep: () => Promise.reject(new Error('synthetic sleep failure')),
    });
    expect(result).toEqual({
      success: false,
      code: 'replay-result-timeout',
      singularDispatchCount: 0,
    });
    expect(remove).toHaveBeenCalledWith(123);
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it.each([
    ['a digest mismatch', async () => 'f'.repeat(64)],
    [
      'a rejected digest',
      async () => {
        throw new Error('synthetic digest failure');
      },
    ],
  ])('rejects %s after one captured dispatch and cleans the tab', async (_label, digestSha256) => {
    const chrome = chromeApi(capturedState());
    const response = await captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      digestSha256,
    });
    expect(response).toEqual({
      success: false,
      code: 'replay-result-invalid',
      singularDispatchCount: 1,
    });
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it.each([
    [
      'an unavailable decoder',
      () => {
        vi.stubGlobal('atob', undefined);
      },
    ],
    [
      'a noncanonical encoder round-trip',
      () => {
        vi.stubGlobal('btoa', () => 'different');
      },
    ],
    [
      'a throwing decoder',
      () => {
        vi.stubGlobal('atob', () => {
          throw new Error('synthetic decoder failure');
        });
      },
    ],
  ])('rejects captured bytes with %s', async (_label, arrange) => {
    arrange();
    const chrome = chromeApi(capturedState());
    const response = await captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      digestSha256: async () => SHA256,
    });
    expect(response).toEqual({
      success: false,
      code: 'replay-result-invalid',
      singularDispatchCount: 1,
    });
  });

  it('handles an asynchronously rejected tab creation without an unhandled error', async () => {
    const response = await captureChatGptConversationViaOpaqueReplay(CONVERSATION_ID, {
      chromeApi: {
        tabs: {
          create: vi.fn().mockRejectedValue(new Error('synthetic async create failure')),
          get: vi.fn(),
          remove: vi.fn(),
        },
        scripting: { executeScript: vi.fn() },
      },
      createNonce: () => NONCE,
    });
    expect(response).toEqual({
      success: false,
      code: 'temporary-tab-create-failed',
      singularDispatchCount: 0,
    });
  });

  it('rejects exact-state extras including non-enumerable and symbol keys in MAIN world', () => {
    expect(readChatGptOpaqueReplayState('bad')).toEqual({ kind: 'missing' });
    const withNonEnumerableExtra = capturedState();
    Object.defineProperty(withNonEnumerableExtra, 'secret', {
      configurable: true,
      enumerable: false,
      value: 'synthetic-secret',
    });
    vi.stubGlobal('window', { [`__liskaChatGptOpaqueReplay_${NONCE}`]: withNonEnumerableExtra });
    expect(readChatGptOpaqueReplayState(NONCE)).toEqual({ kind: 'missing' });

    vi.stubGlobal('window', {
      [`__liskaChatGptOpaqueReplay_${NONCE}`]: {
        ...capturedState(),
        [Symbol('secret')]: true,
      },
    });
    expect(readChatGptOpaqueReplayState(NONCE)).toEqual({ kind: 'missing' });
  });

  it('reads exact ready, error, and captured MAIN-world states and rejects malformed capture values', () => {
    vi.stubGlobal('window', { [`__liskaChatGptOpaqueReplay_${NONCE}`]: { kind: 'ready' } });
    expect(readChatGptOpaqueReplayState(NONCE)).toEqual({ kind: 'ready' });

    vi.stubGlobal('window', {
      [`__liskaChatGptOpaqueReplay_${NONCE}`]: {
        kind: 'error',
        code: 'target-not-observed',
        singularDispatchCount: 0,
      },
    });
    expect(readChatGptOpaqueReplayState(NONCE)).toEqual({
      kind: 'error',
      code: 'target-not-observed',
      singularDispatchCount: 0,
    });

    vi.stubGlobal('window', { [`__liskaChatGptOpaqueReplay_${NONCE}`]: capturedState() });
    expect(readChatGptOpaqueReplayState(NONCE)).toEqual(capturedState());

    vi.stubGlobal('window', {
      [`__liskaChatGptOpaqueReplay_${NONCE}`]: {
        ...capturedState(),
        capture: { ...capturedState().capture, byteLength: '3' },
      },
    });
    expect(readChatGptOpaqueReplayState(NONCE)).toEqual({ kind: 'missing' });

    vi.stubGlobal('window', {
      [`__liskaChatGptOpaqueReplay_${NONCE}`]: {
        ...capturedState(),
        capture: { bodyBase64: 'AP8B' },
      },
    });
    expect(readChatGptOpaqueReplayState(NONCE)).toEqual({ kind: 'missing' });

    vi.stubGlobal('window', {
      get [`__liskaChatGptOpaqueReplay_${NONCE}`]() {
        throw new Error('synthetic state getter failure');
      },
    });
    expect(readChatGptOpaqueReplayState(NONCE)).toEqual({ kind: 'missing' });
  });
});
