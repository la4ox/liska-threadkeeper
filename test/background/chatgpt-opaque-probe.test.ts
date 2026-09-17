import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatGptOpaqueProbeResult } from '../../src/lib/chatgpt-opaque-probe-contract';
import {
  probeChatGptOpaqueRequest,
  readChatGptOpaqueProbeState,
} from '../../src/background/chatgpt-opaque-probe';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const NONCE = 'f8c1f0a5-b3dd-4d2a-9a11-8e915f6c3e72';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ChatGPT opaque probe temporary-tab runtime', () => {
  it('opens only the marker-gated route, returns metadata, and closes its disposable tab', async () => {
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
    const create = vi.fn().mockResolvedValue({ id: 123 });
    const remove = vi.fn().mockResolvedValue(undefined);
    const executeScript = vi.fn().mockResolvedValue([{ result: { kind: 'result', result } }]);
    const response = await probeChatGptOpaqueRequest(CONVERSATION_ID, {
      chromeApi: {
        tabs: {
          create,
          get: vi.fn().mockResolvedValue({
            status: 'complete',
            url: `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-probe=1`,
          }),
          remove,
        },
        scripting: { executeScript },
      },
      createNonce: () => NONCE,
    });

    expect(response).toEqual(result);
    expect(create).toHaveBeenCalledWith({
      url: `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-probe=1`,
      active: false,
    });
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 123 }, world: 'MAIN', args: [NONCE] })
    );
    expect(remove).toHaveBeenCalledWith(123);
    expect(JSON.stringify(response)).not.toContain('synthetic-secret');
  });

  it('returns target-not-observed after the bounded wait rather than a capture timeout', async () => {
    let now = 0;
    const create = vi.fn().mockResolvedValue({ id: 123 });
    const response = await probeChatGptOpaqueRequest(CONVERSATION_ID, {
      chromeApi: {
        tabs: {
          create,
          get: vi.fn().mockResolvedValue({
            status: 'complete',
            url: `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-probe=1`,
          }),
          remove: vi.fn().mockResolvedValue(undefined),
        },
        scripting: { executeScript: vi.fn().mockResolvedValue([{ result: { kind: 'ready' } }]) },
      },
      createNonce: () => NONCE,
      timeoutMs: 1_000,
      now: () => now,
      sleep: async () => {
        now = 1_001;
      },
    });

    expect(response).toEqual(createChatGptOpaqueProbeResult('target-not-observed'));
    expect(create).toHaveBeenCalledOnce();
  });

  it('returns target-not-observed and closes the tab when readiness never completes', async () => {
    let now = 0;
    const remove = vi.fn().mockResolvedValue(undefined);
    const response = await probeChatGptOpaqueRequest(CONVERSATION_ID, {
      chromeApi: {
        tabs: {
          create: vi.fn().mockResolvedValue({ id: 123 }),
          get: vi.fn().mockResolvedValue({ status: 'loading' }),
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

    expect(response).toEqual(createChatGptOpaqueProbeResult('target-not-observed'));
    expect(remove).toHaveBeenCalledWith(123);
  });

  it('uses the bounded default sleep while a created tab remains loading', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const remove = vi.fn().mockResolvedValue(undefined);
    const pending = probeChatGptOpaqueRequest(CONVERSATION_ID, {
      chromeApi: {
        tabs: {
          create: vi.fn().mockResolvedValue({ id: 123 }),
          get: vi.fn().mockResolvedValue({ status: 'loading' }),
          remove,
        },
        scripting: { executeScript: vi.fn() },
      },
      createNonce: () => NONCE,
      timeoutMs: 1_000,
      pollIntervalMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toEqual(createChatGptOpaqueProbeResult('target-not-observed'));
    expect(remove).toHaveBeenCalledWith(123);
  });

  it('fails closed and removes the tab when the injected readiness sleep rejects', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const response = await probeChatGptOpaqueRequest(CONVERSATION_ID, {
      chromeApi: {
        tabs: {
          create: vi.fn().mockResolvedValue({ id: 123 }),
          get: vi.fn().mockResolvedValue({ status: 'loading' }),
          remove,
        },
        scripting: { executeScript: vi.fn() },
      },
      createNonce: () => NONCE,
      timeoutMs: 1_000,
      now: () => 0,
      sleep: async () => {
        throw new Error('synthetic sleep failure');
      },
    });

    expect(response).toEqual(createChatGptOpaqueProbeResult('probe-failed'));
    expect(remove).toHaveBeenCalledWith(123);
  });

  it('bounds a never-settling state read and still closes the disposable tab', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const remove = vi.fn().mockResolvedValue(undefined);
    const pending = probeChatGptOpaqueRequest(CONVERSATION_ID, {
      chromeApi: {
        tabs: {
          create: vi.fn().mockResolvedValue({ id: 123 }),
          get: vi.fn().mockResolvedValue({
            status: 'complete',
            url: `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-probe=1`,
          }),
          remove,
        },
        scripting: { executeScript: vi.fn(() => new Promise(() => undefined)) },
      },
      createNonce: () => NONCE,
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toEqual(createChatGptOpaqueProbeResult('target-not-observed'));
    expect(remove).toHaveBeenCalledWith(123);
  });

  it('cleans a tab whose create promise resolves only after the probe deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let resolveCreate: ((tab: { id?: number }) => void) | undefined;
    const create = vi.fn(
      () =>
        new Promise<{ id?: number }>(resolve => {
          resolveCreate = resolve;
        })
    );
    const remove = vi.fn().mockResolvedValue(undefined);
    const pending = probeChatGptOpaqueRequest(CONVERSATION_ID, {
      chromeApi: {
        tabs: { create, get: vi.fn(), remove },
        scripting: { executeScript: vi.fn() },
      },
      createNonce: () => NONCE,
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toEqual(createChatGptOpaqueProbeResult('probe-failed'));
    resolveCreate?.({ id: 456 });
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(456));
  });

  it('does not create a tab for an invalid conversation identifier', async () => {
    const create = vi.fn();
    const response = await probeChatGptOpaqueRequest('not-a-conversation-id', {
      chromeApi: {
        tabs: { create, get: vi.fn(), remove: vi.fn() },
        scripting: { executeScript: vi.fn() },
      },
    });

    expect(response).toEqual(createChatGptOpaqueProbeResult('probe-failed'));
    expect(create).not.toHaveBeenCalled();
  });

  it('uses a generated safe nonce when no nonce dependency is supplied', async () => {
    let createdUrl = '';
    const result = createChatGptOpaqueProbeResult('eligible');
    const create = vi.fn(async ({ url }: { url: string }) => {
      createdUrl = url;
      return { id: 123 };
    });
    const response = await probeChatGptOpaqueRequest(CONVERSATION_ID, {
      chromeApi: {
        tabs: {
          create,
          get: vi.fn(async () => ({ status: 'complete', url: createdUrl })),
          remove: vi.fn().mockResolvedValue(undefined),
        },
        scripting: {
          executeScript: vi.fn(async injection => {
            const nonce = injection.args[0];
            expect(typeof nonce).toBe('string');
            expect(createdUrl).toContain(`#liska-capture=${nonce}&liska-opaque-probe=1`);
            return [{ result: { kind: 'result', result } }];
          }),
        },
      },
    });

    expect(response).toEqual(result);
  });

  it.each([
    ['an unsafe generated nonce', () => 'short'],
    [
      'a throwing nonce generator',
      () => {
        throw new Error('synthetic nonce failure');
      },
    ],
  ])('fails before tab creation for %s', async (_label, createNonce) => {
    const create = vi.fn();
    const response = await probeChatGptOpaqueRequest(CONVERSATION_ID, {
      chromeApi: {
        tabs: { create, get: vi.fn(), remove: vi.fn() },
        scripting: { executeScript: vi.fn() },
      },
      createNonce,
    });

    expect(response).toEqual(createChatGptOpaqueProbeResult('probe-failed'));
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['a rejected create operation', () => Promise.reject(new Error('create failed'))],
    ['a created tab without a safe id', () => Promise.resolve({})],
  ])('fails closed for %s', async (_label, create) => {
    const response = await probeChatGptOpaqueRequest(CONVERSATION_ID, {
      chromeApi: {
        tabs: { create: vi.fn(create), get: vi.fn(), remove: vi.fn() },
        scripting: { executeScript: vi.fn() },
      },
      createNonce: () => NONCE,
      timeoutMs: 1_000,
    });

    expect(response).toEqual(createChatGptOpaqueProbeResult('probe-failed'));
  });

  it('treats failed readiness reads and malformed hook states as not observed', async () => {
    let now = 0;
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error('synthetic tab read failure'))
      .mockResolvedValue({
        status: 'complete',
        url: `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-probe=1`,
      });
    const response = await probeChatGptOpaqueRequest(CONVERSATION_ID, {
      chromeApi: {
        tabs: {
          create: vi.fn().mockResolvedValue({ id: 123 }),
          get,
          remove: vi.fn().mockResolvedValue(undefined),
        },
        scripting: { executeScript: vi.fn().mockResolvedValue([{ result: { kind: 'unknown' } }]) },
      },
      createNonce: () => NONCE,
      timeoutMs: 1_000,
      pollIntervalMs: 0,
      now: () => now,
      sleep: async () => {
        now = now === 0 ? 1 : 1_001;
      },
    });

    expect(response).toEqual(createChatGptOpaqueProbeResult('target-not-observed'));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('bounds a never-settling tab removal after a completed probe', async () => {
    vi.useFakeTimers();
    const result = createChatGptOpaqueProbeResult('eligible');
    const pending = probeChatGptOpaqueRequest(CONVERSATION_ID, {
      chromeApi: {
        tabs: {
          create: vi.fn().mockResolvedValue({ id: 123 }),
          get: vi.fn().mockResolvedValue({
            status: 'complete',
            url: `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-probe=1`,
          }),
          remove: vi.fn(() => new Promise(() => undefined)),
        },
        scripting: {
          executeScript: vi.fn().mockResolvedValue([{ result: { kind: 'result', result } }]),
        },
      },
      createNonce: () => NONCE,
    });

    await vi.advanceTimersByTimeAsync(501);
    await expect(pending).resolves.toEqual(result);
  });

  it('rejects malformed or throwing MAIN-world probe snapshots', () => {
    expect(readChatGptOpaqueProbeState('bad')).toEqual({ kind: 'missing' });
    vi.stubGlobal('window', {
      get [`__liskaChatGptOpaqueProbe_${NONCE}`]() {
        throw new Error('synthetic snapshot failure');
      },
    });
    expect(readChatGptOpaqueProbeState(NONCE)).toEqual({ kind: 'missing' });

    vi.stubGlobal('window', {
      [`__liskaChatGptOpaqueProbe_${NONCE}`]: {
        kind: 'result',
        result: { ...createChatGptOpaqueProbeResult('eligible'), extra: true },
      },
    });
    expect(readChatGptOpaqueProbeState(NONCE)).toEqual({ kind: 'missing' });

    const nonEnumerableExtra = createChatGptOpaqueProbeResult('eligible');
    Object.defineProperty(nonEnumerableExtra, 'secret', {
      configurable: true,
      enumerable: false,
      value: 'synthetic-secret',
    });
    vi.stubGlobal('window', {
      [`__liskaChatGptOpaqueProbe_${NONCE}`]: {
        kind: 'result',
        result: nonEnumerableExtra,
      },
    });
    expect(readChatGptOpaqueProbeState(NONCE)).toEqual({ kind: 'missing' });

    vi.stubGlobal('window', {
      [`__liskaChatGptOpaqueProbe_${NONCE}`]: {
        kind: 'result',
        result: { ...createChatGptOpaqueProbeResult('eligible'), [Symbol('secret')]: true },
      },
    });
    expect(readChatGptOpaqueProbeState(NONCE)).toEqual({ kind: 'missing' });
  });
});
