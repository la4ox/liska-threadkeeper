import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  observeChatGptAssetResolversViaOpaqueSource,
  readChatGptOpaqueResolverState,
} from '../../src/background/chatgpt-opaque-resolver';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const NONCE = 'f8c1f0a5-b3dd-4d2a-9a11-8e915f6c3e72';
const DOWNLOAD_URL =
  'https://chatgpt.com/backend-api/estuary/content?cid=01234567-89ab-4cde-8f01-23456789abcd&id=file-abc&p=1&sig=2&ts=3&v=4';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function observedState(body = JSON.stringify({ download_url: DOWNLOAD_URL })) {
  const bytes = new TextEncoder().encode(body);
  return {
    kind: 'observed' as const,
    conversationId: CONVERSATION_ID,
    resolverObservations: [
      {
        providerFileId: 'file-abc',
        bodyBase64: btoa(body),
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
        mediaType: 'application/json',
      },
    ],
    singularDispatchCount: 0 as const,
  };
}

function chromeApi(state: unknown) {
  const remove = vi.fn().mockResolvedValue(undefined);
  return {
    remove,
    api: {
      tabs: {
        create: vi.fn().mockResolvedValue({ id: 123 }),
        get: vi.fn().mockResolvedValue({
          status: 'complete',
          url: `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-resolver-observer=1`,
        }),
        remove,
      },
      scripting: { executeScript: vi.fn().mockResolvedValue([{ result: state }]) },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ChatGPT opaque resolver observer runtime', () => {
  it('validates cloned resolver bytes and emits only a domain-separated safe record', async () => {
    const chrome = chromeApi(observedState());
    const response = await observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      digestSha256: async bytes => sha256(bytes),
    });

    expect(response).toEqual({
      success: true,
      data: {
        transientAssetResolvers: [
          {
            resolverKey: sha256(new TextEncoder().encode('liska-chatgpt-resolver/1\u0000file-abc')),
            downloadUrl: DOWNLOAD_URL,
          },
        ],
      },
    });
    expect(JSON.stringify(response)).not.toContain('file-abc"');
    expect(chrome.api.tabs.create).toHaveBeenCalledWith({
      url: `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-resolver-observer=1`,
      active: true,
    });
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('fails closed for malformed observations and never leaks a temporary tab', async () => {
    const malformed = observedState();
    malformed.resolverObservations[0].sha256 = 'f'.repeat(64);
    const chrome = chromeApi(malformed);
    const response = await observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
      chromeApi: chrome.api,
      createNonce: () => NONCE,
      digestSha256: async bytes => sha256(bytes),
    });

    expect(response).toEqual({ success: true, data: { transientAssetResolvers: [] } });
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('reads no state with non-enumerable or symbol extras from MAIN world', () => {
    const state = observedState();
    Object.defineProperty(state, 'secret', {
      configurable: true,
      enumerable: false,
      value: 'nope',
    });
    vi.stubGlobal('window', { [`__liskaChatGptOpaqueResolver_${NONCE}`]: state });
    expect(readChatGptOpaqueResolverState(NONCE)).toEqual({ kind: 'missing' });

    vi.stubGlobal('window', {
      [`__liskaChatGptOpaqueResolver_${NONCE}`]: { ...observedState(), [Symbol('secret')]: true },
    });
    expect(readChatGptOpaqueResolverState(NONCE)).toEqual({ kind: 'missing' });
  });

  it.each([
    [
      'an unexpected origin',
      'https://evil.example/c/01234567-89ab-4cde-8f01-23456789abcd#liska-capture=f8c1f0a5-b3dd-4d2a-9a11-8e915f6c3e72&liska-opaque-resolver-observer=1',
      'unexpected-origin',
    ],
    [
      'an unexpected marker path',
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      'unexpected-path',
    ],
  ])('fails closed and cleans the tab for %s', async (_label, url, code) => {
    const chrome = chromeApi({ kind: 'ready' });
    chrome.api.tabs.get.mockResolvedValue({ status: 'complete', url });

    await expect(
      observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
        chromeApi: chrome.api,
        createNonce: () => NONCE,
      })
    ).resolves.toEqual({ success: false, code, singularDispatchCount: 0 });
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('contains invalid identity, nonce, and temporary-tab creation outcomes', async () => {
    await expect(
      observeChatGptAssetResolversViaOpaqueSource('not-a-conversation-id')
    ).resolves.toEqual({
      success: false,
      code: 'invalid-conversation-id',
      singularDispatchCount: 0,
    });
    const chrome = chromeApi({ kind: 'ready' });
    await expect(
      observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
        chromeApi: chrome.api,
        createNonce: () => 'short',
      })
    ).resolves.toEqual({ success: false, code: 'nonce-invalid', singularDispatchCount: 0 });
    chrome.api.tabs.create.mockRejectedValueOnce(new Error('synthetic create failure'));
    await expect(
      observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
        chromeApi: chrome.api,
        createNonce: () => NONCE,
      })
    ).resolves.toEqual({
      success: false,
      code: 'temporary-tab-create-failed',
      singularDispatchCount: 0,
    });
    await expect(
      observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
        chromeApi: chrome.api,
        createNonce: () => {
          throw new Error('synthetic nonce failure');
        },
      })
    ).resolves.toEqual({ success: false, code: 'nonce-invalid', singularDispatchCount: 0 });
    chrome.api.tabs.create.mockResolvedValueOnce({});
    await expect(
      observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
        chromeApi: chrome.api,
        createNonce: () => NONCE,
      })
    ).resolves.toEqual({
      success: false,
      code: 'temporary-tab-missing-id',
      singularDispatchCount: 0,
    });
  });

  it('returns an observer source failure and handles an invalid page state without dispatching', async () => {
    const sourceFailure = chromeApi({
      kind: 'error',
      code: 'source-non-json',
      singularDispatchCount: 0,
    });
    await expect(
      observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
        chromeApi: sourceFailure.api,
        createNonce: () => NONCE,
      })
    ).resolves.toEqual({ success: false, code: 'source-non-json', singularDispatchCount: 0 });

    let now = 0;
    const invalidState = chromeApi({ kind: 'observed', resolverObservations: [] });
    await expect(
      observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
        chromeApi: invalidState.api,
        createNonce: () => NONCE,
        timeoutMs: 1_000,
        now: () => now,
        sleep: async () => {
          now = 1_001;
        },
      })
    ).resolves.toEqual({
      success: false,
      code: 'observer-result-timeout',
      singularDispatchCount: 0,
    });

    const wrongConversation = chromeApi({
      ...observedState(),
      conversationId: '11111111-2222-3333-4444-555555555555',
    });
    await expect(
      observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
        chromeApi: wrongConversation.api,
        createNonce: () => NONCE,
      })
    ).resolves.toEqual({
      success: false,
      code: 'observer-result-invalid',
      singularDispatchCount: 0,
    });
  });

  it('bounds failed polling and best-effort cleanup without leaking a tab', async () => {
    let now = 0;
    const chrome = chromeApi({ kind: 'ready' });
    chrome.api.tabs.get.mockRejectedValue(new Error('synthetic tab get failure'));
    chrome.remove.mockRejectedValueOnce(new Error('synthetic remove failure'));
    await expect(
      observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
        chromeApi: chrome.api,
        createNonce: () => NONCE,
        timeoutMs: 1_000,
        pollIntervalMs: 1,
        now: () => now,
        sleep: async () => {
          now = 1_001;
        },
      })
    ).resolves.toEqual({
      success: false,
      code: 'temporary-tab-ready-timeout',
      singularDispatchCount: 0,
    });
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('contains a lifecycle clock exception before any tab is opened', async () => {
    const chrome = chromeApi({ kind: 'ready' });
    await expect(
      observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
        chromeApi: chrome.api,
        createNonce: () => NONCE,
        now: () => {
          throw new Error('synthetic clock failure');
        },
      })
    ).resolves.toEqual({
      success: false,
      code: 'observer-result-invalid',
      singularDispatchCount: 0,
    });
    expect(chrome.api.tabs.create).not.toHaveBeenCalled();
  });

  it('reads exact ready, error, and observed states and rejects malformed records', () => {
    expect(readChatGptOpaqueResolverState('bad')).toEqual({ kind: 'missing' });
    vi.stubGlobal('window', { [`__liskaChatGptOpaqueResolver_${NONCE}`]: { kind: 'ready' } });
    expect(readChatGptOpaqueResolverState(NONCE)).toEqual({ kind: 'ready' });
    vi.stubGlobal('window', {
      [`__liskaChatGptOpaqueResolver_${NONCE}`]: {
        kind: 'error',
        code: 'source-rejected',
        singularDispatchCount: 0,
      },
    });
    expect(readChatGptOpaqueResolverState(NONCE)).toEqual({
      kind: 'error',
      code: 'source-rejected',
      singularDispatchCount: 0,
    });
    vi.stubGlobal('window', { [`__liskaChatGptOpaqueResolver_${NONCE}`]: observedState() });
    expect(readChatGptOpaqueResolverState(NONCE)).toEqual(observedState());
    vi.stubGlobal('window', {
      [`__liskaChatGptOpaqueResolver_${NONCE}`]: {
        ...observedState(),
        resolverObservations: [{ providerFileId: 'file-abc' }],
      },
    });
    expect(readChatGptOpaqueResolverState(NONCE)).toEqual({ kind: 'missing' });
    vi.stubGlobal('window', {
      get [`__liskaChatGptOpaqueResolver_${NONCE}`]() {
        throw new Error('synthetic getter failure');
      },
    });
    expect(readChatGptOpaqueResolverState(NONCE)).toEqual({ kind: 'missing' });
  });

  it('uses browser defaults for nonce and SHA-256 while preserving the exact created marker', async () => {
    const state = observedState();
    const remove = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue({ id: 123 });
    const get = vi.fn().mockImplementation(async () => ({
      status: 'complete',
      url: create.mock.calls[0]?.[0].url,
    }));
    const response = await observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
      chromeApi: {
        tabs: { create, get, remove },
        scripting: { executeScript: vi.fn().mockResolvedValue([{ result: state }]) },
      },
    });

    expect(response).toMatchObject({
      success: true,
      data: { transientAssetResolvers: [expect.any(Object)] },
    });
    expect(create.mock.calls[0]?.[0].url).toMatch(
      /^https:\/\/chatgpt\.com\/c\/01234567-89ab-4cde-8f01-23456789abcd#liska-capture=[a-z0-9-]{16,128}&liska-opaque-resolver-observer=1$/i
    );
    expect(remove).toHaveBeenCalledWith(123);
  });

  it('uses the default polling sleep when the temporary tab is initially loading', async () => {
    const state = observedState();
    const remove = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue({ id: 123 });
    const get = vi
      .fn()
      .mockResolvedValueOnce({ status: 'loading' })
      .mockResolvedValueOnce({
        status: 'complete',
        url: `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-resolver-observer=1`,
      });
    const response = await observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
      chromeApi: {
        tabs: { create, get, remove },
        scripting: { executeScript: vi.fn().mockResolvedValue([{ result: state }]) },
      },
      createNonce: () => NONCE,
      pollIntervalMs: 1,
      digestSha256: async bytes => sha256(bytes),
    });

    expect(response.success).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledWith(123);
  });

  it('stops readiness polling when sleep rejects and still removes the temporary tab', async () => {
    const chrome = chromeApi({ kind: 'ready' });
    chrome.api.tabs.get.mockResolvedValue({ status: 'loading' });

    await expect(
      observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
        chromeApi: chrome.api,
        createNonce: () => NONCE,
        sleep: () => Promise.reject(new Error('synthetic readiness sleep failure')),
      })
    ).resolves.toEqual({
      success: false,
      code: 'temporary-tab-ready-timeout',
      singularDispatchCount: 0,
    });
    expect(chrome.api.scripting.executeScript).not.toHaveBeenCalled();
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('contains a rejected script read and a rejected observer-result sleep without dispatching', async () => {
    const scriptRejected = chromeApi({ kind: 'ready' });
    scriptRejected.api.scripting.executeScript.mockRejectedValue(
      new Error('synthetic executeScript failure')
    );
    await expect(
      observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
        chromeApi: scriptRejected.api,
        createNonce: () => NONCE,
        sleep: () => Promise.reject(new Error('synthetic result sleep failure')),
      })
    ).resolves.toEqual({
      success: false,
      code: 'observer-result-timeout',
      singularDispatchCount: 0,
    });
    expect(scriptRejected.api.scripting.executeScript).toHaveBeenCalledOnce();
    expect(scriptRejected.remove).toHaveBeenCalledWith(123);
  });

  it('bounds a hanging script read and a hanging digest while closing the temporary tab', async () => {
    vi.useFakeTimers();
    const scriptHanging = chromeApi({ kind: 'ready' });
    scriptHanging.api.scripting.executeScript.mockImplementation(
      () => new Promise(() => undefined)
    );
    const scriptPending = observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
      chromeApi: scriptHanging.api,
      createNonce: () => NONCE,
      timeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(scriptPending).resolves.toEqual({
      success: false,
      code: 'observer-result-timeout',
      singularDispatchCount: 0,
    });
    expect(scriptHanging.remove).toHaveBeenCalledWith(123);

    vi.setSystemTime(0);
    const digestHanging = chromeApi(observedState());
    const digestPending = observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
      chromeApi: digestHanging.api,
      createNonce: () => NONCE,
      timeoutMs: 1_000,
      digestSha256: () => new Promise<string>(() => undefined),
    });
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(digestPending).resolves.toEqual({
      success: false,
      code: 'observer-result-invalid',
      singularDispatchCount: 0,
    });
    expect(digestHanging.remove).toHaveBeenCalledWith(123);
  });

  it('cleans a late-created tab after creation timeout and bounds its hanging removal', async () => {
    vi.useFakeTimers();
    let resolveCreate: ((value: { id?: number }) => void) | undefined;
    const create = vi.fn(
      () =>
        new Promise<{ id?: number }>(resolve => {
          resolveCreate = resolve;
        })
    );
    const remove = vi.fn(() => new Promise<void>(() => undefined));
    const pending = observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
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

  it('contains a lifecycle clock failure after tab creation and removes that exact tab', async () => {
    let calls = 0;
    const remove = vi.fn().mockResolvedValue(undefined);
    const response = await observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
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
      code: 'observer-result-invalid',
      singularDispatchCount: 0,
    });
    expect(remove).toHaveBeenCalledWith(123);
  });

  it('contains a synchronous temporary-tab create failure without dispatching', async () => {
    const create = vi.fn(() => {
      throw new Error('synthetic synchronous create failure');
    });
    const remove = vi.fn();
    const response = await observeChatGptAssetResolversViaOpaqueSource(CONVERSATION_ID, {
      chromeApi: {
        tabs: { create, get: vi.fn(), remove },
        scripting: { executeScript: vi.fn() },
      },
      createNonce: () => NONCE,
    });

    expect(response).toEqual({
      success: false,
      code: 'temporary-tab-create-failed',
      singularDispatchCount: 0,
    });
    expect(create).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
  });
});
