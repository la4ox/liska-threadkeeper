import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHATGPT_CAPTURE_MAX_BYTES,
  CHATGPT_CAPTURE_ENDPOINT,
  ChatGptTemporaryCaptureError,
  captureChatGptInTemporaryTab,
  cleanupChatGptTemporaryCaptureHook,
  installChatGptTemporaryCaptureHook,
  probeChatGptTemporaryCaptureReadiness,
  readChatGptTemporaryCaptureState,
} from '../../src/background/chatgpt-capture';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const OTHER_CONVERSATION_ID = '11111111-2222-3333-4444-555555555555';
const NONCE = 'f8c1f0a5-b3dd-4d2a-9a11-8e915f6c3e72';

type HookResult = ReturnType<typeof installChatGptTemporaryCaptureHook>;

function capturedResult(): HookResult {
  return {
    kind: 'captured',
    capture: {
      bodyBase64: 'AP8BgCo=',
      byteLength: 5,
      sha256: 'd423c7d662b356d3bcfb768944ff3b5f3f89b7086bb16e6a5afba362da09acb3',
      mediaType: 'application/json; charset=utf-8',
    },
  };
}

function fakeChrome(
  results: HookResult[],
  readinessResults: ReturnType<typeof probeChatGptTemporaryCaptureReadiness>[] = [{ kind: 'ready' }]
) {
  const tabs = {
    create: vi.fn().mockResolvedValue({ id: 73 }),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const reads = [...results];
  const readiness = [...readinessResults];
  const executeScript = vi.fn().mockImplementation(async injection => {
    if (injection.func === probeChatGptTemporaryCaptureReadiness) {
      return [{ result: readiness.shift() ?? { kind: 'ready' } }];
    }
    if (injection.func === installChatGptTemporaryCaptureHook)
      return [{ result: { kind: 'ready' } }];
    if (injection.func === readChatGptTemporaryCaptureState) {
      return [{ result: reads.shift() ?? { kind: 'ready' } }];
    }
    if (injection.func === cleanupChatGptTemporaryCaptureHook) {
      return [{ result: { kind: 'cleaned' } }];
    }
    return [];
  });
  return { tabs, scripting: { executeScript } };
}

function installFakeMainWorld(options: {
  onAnchorClick?: () => void;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}) {
  const originalFetch = vi.fn(
    options.fetch ?? (() => Promise.resolve(new Response('{}', { status: 200 })))
  );
  const anchor = {
    href: '',
    hidden: false,
    tabIndex: 0,
    setAttribute: vi.fn(),
    click: vi.fn(() => options.onAnchorClick?.()),
    remove: vi.fn(),
  };
  const parent = { append: vi.fn() };
  const fakeDocument = {
    body: parent,
    documentElement: parent,
    readyState: 'complete',
    createElement: vi.fn(() => anchor),
    querySelector: vi.fn(() => parent),
  };

  const fakeWindow = {
    location: { origin: 'https://chatgpt.com', href: 'https://chatgpt.com/' },
    fetch: originalFetch,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    crypto: webcrypto,
    btoa: globalThis.btoa,
  } as unknown as Window & typeof globalThis;

  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', fakeDocument);
  return { anchor, fakeWindow, originalFetch, fakeDocument };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('captureChatGptInTemporaryTab', () => {
  it('creates an inactive root tab, installs the MAIN-world hook, and returns only the raw artifact', async () => {
    const pageResult = capturedResult();
    if (pageResult.kind !== 'captured') throw new Error('Synthetic capture must be captured.');
    Object.assign(pageResult.capture, { accountId: 'must-not-cross-the-boundary' });
    const chromeApi = fakeChrome([pageResult]);

    const result = await captureChatGptInTemporaryTab(CONVERSATION_ID, {
      chromeApi,
      now: () => 0,
      createNonce: () => NONCE,
    });

    expect(chromeApi.tabs.create).toHaveBeenCalledWith({
      url: 'https://chatgpt.com/',
      active: false,
    });
    expect(chromeApi.scripting.executeScript.mock.calls[0][0]).toMatchObject({
      target: { tabId: 73 },
      world: 'MAIN',
      func: probeChatGptTemporaryCaptureReadiness,
    });
    expect(chromeApi.scripting.executeScript.mock.calls[1][0]).toMatchObject({
      target: { tabId: 73 },
      world: 'MAIN',
      func: installChatGptTemporaryCaptureHook,
      args: [CONVERSATION_ID, NONCE, expect.objectContaining({ maxBytes: 16 * 1024 * 1024 })],
    });
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
    expect(result).toEqual({ ...capturedResult().capture, endpoint: CHATGPT_CAPTURE_ENDPOINT });
    expect(Object.keys(result)).toEqual([
      'bodyBase64',
      'byteLength',
      'sha256',
      'mediaType',
      'endpoint',
    ]);
  });

  it('waits for the hydrated ChatGPT document before installing or navigating', async () => {
    const chromeApi = fakeChrome(
      [capturedResult()],
      [{ kind: 'waiting' }, { kind: 'waiting' }, { kind: 'ready' }]
    );
    let now = 0;

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        chromeApi,
        now: () => now,
        sleep: async milliseconds => {
          now += milliseconds;
        },
        timeoutMs: 1_000,
        pollIntervalMs: 100,
        createNonce: () => NONCE,
      })
    ).resolves.toMatchObject({ bodyBase64: 'AP8BgCo=' });

    expect(
      chromeApi.scripting.executeScript.mock.calls.slice(0, 4).map(([call]) => call.func)
    ).toEqual([
      probeChatGptTemporaryCaptureReadiness,
      probeChatGptTemporaryCaptureReadiness,
      probeChatGptTemporaryCaptureReadiness,
      installChatGptTemporaryCaptureHook,
    ]);
  });

  it('rejects a completed foreign origin before installing the hook', async () => {
    const chromeApi = fakeChrome([], [{ kind: 'origin-rejected' }]);

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, { chromeApi, createNonce: () => NONCE })
    ).rejects.toMatchObject({ code: 'unexpected-origin' });
    expect(chromeApi.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(chromeApi.scripting.executeScript.mock.calls[0][0].func).toBe(
      probeChatGptTemporaryCaptureReadiness
    );
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });

  it('closes its created tab on a rejected redirect/login origin', async () => {
    const chromeApi = fakeChrome([]);
    chromeApi.scripting.executeScript.mockImplementation(async injection => {
      if (injection.func === probeChatGptTemporaryCaptureReadiness) {
        return [{ result: { kind: 'ready' } }];
      }
      if (injection.func === installChatGptTemporaryCaptureHook) {
        return [{ result: { kind: 'origin-rejected' } }];
      }
      return [{ result: { kind: 'cleaned' } }];
    });

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        chromeApi,
        createNonce: () => NONCE,
      })
    ).rejects.toMatchObject({ code: 'unexpected-origin' });
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });

  it('closes its created tab after a bounded timeout and removes the hook', async () => {
    const chromeApi = fakeChrome([]);
    let now = 0;

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        chromeApi,
        now: () => now,
        sleep: async milliseconds => {
          now += milliseconds;
        },
        timeoutMs: 1_000,
        pollIntervalMs: 500,
        createNonce: () => NONCE,
      })
    ).rejects.toMatchObject({ code: 'timed-out' });

    expect(chromeApi.scripting.executeScript.mock.calls.at(-1)?.[0].func).toBe(
      cleanupChatGptTemporaryCaptureHook
    );
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });

  it('rejects invalid IDs before opening a tab and keeps the error free of the supplied value', async () => {
    const chromeApi = fakeChrome([]);
    const invalid = '../not-a-conversation-id';

    await expect(captureChatGptInTemporaryTab(invalid, { chromeApi })).rejects.toEqual(
      new ChatGptTemporaryCaptureError('invalid-conversation-id')
    );
    await expect(captureChatGptInTemporaryTab(invalid, { chromeApi })).rejects.not.toThrow(invalid);
    expect(chromeApi.tabs.create).not.toHaveBeenCalled();
    expect(chromeApi.tabs.remove).not.toHaveBeenCalled();
  });

  it('closes a created tab when the hook cannot be installed', async () => {
    const chromeApi = fakeChrome([]);
    chromeApi.scripting.executeScript.mockImplementation(async injection => {
      if (injection.func === probeChatGptTemporaryCaptureReadiness) {
        return [{ result: { kind: 'ready' } }];
      }
      throw new Error('browser failure');
    });

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        chromeApi,
        createNonce: () => NONCE,
      })
    ).rejects.toMatchObject({ code: 'hook-install-failed' });
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });

  it('uses the native Chrome and random-nonce dependencies without exposing the nonce', async () => {
    const chromeApi = fakeChrome([capturedResult()]);
    vi.stubGlobal('chrome', chromeApi);
    vi.stubGlobal('crypto', webcrypto);

    await expect(captureChatGptInTemporaryTab(CONVERSATION_ID)).resolves.toMatchObject({
      bodyBase64: 'AP8BgCo=',
      endpoint: CHATGPT_CAPTURE_ENDPOINT,
    });
    expect(chromeApi.scripting.executeScript.mock.calls[1][0].args[1]).not.toBe(NONCE);
  });

  it('maps a hook size failure to a stable error and still closes the tab', async () => {
    const chromeApi = fakeChrome([{ kind: 'error', code: 'payload-too-large' }]);

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, { chromeApi, createNonce: () => NONCE })
    ).rejects.toMatchObject({ code: 'payload-too-large' });
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });

  it('sanitizes a nonce-generation failure and closes the already-created tab', async () => {
    const chromeApi = fakeChrome([]);

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        chromeApi,
        createNonce: () => {
          throw new Error(`sensitive ${CONVERSATION_ID}`);
        },
      })
    ).rejects.toMatchObject({ code: 'capture-failed' });
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });

  it('rejects malformed capture data rather than forwarding an unbounded message payload', async () => {
    const chromeApi = fakeChrome([
      {
        kind: 'captured',
        capture: {
          ...capturedResult().capture,
          bodyBase64: 'not base64!',
        },
      },
    ]);

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, { chromeApi, createNonce: () => NONCE })
    ).rejects.toMatchObject({ code: 'unexpected-capture-result' });
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });

  it('recomputes the base64 payload hash instead of trusting the page claim', async () => {
    const chromeApi = fakeChrome([
      {
        kind: 'captured',
        capture: { ...capturedResult().capture, sha256: '0'.repeat(64) },
      },
    ]);

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        chromeApi,
        createNonce: () => NONCE,
        digestSha256: async () => capturedResult().capture.sha256,
      })
    ).rejects.toMatchObject({ code: 'unexpected-capture-result' });
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });

  it('fails closed when extension-side digesting or page media metadata is invalid', async () => {
    const digestFailure = fakeChrome([capturedResult()]);
    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        chromeApi: digestFailure,
        createNonce: () => NONCE,
        digestSha256: () => Promise.reject(new Error('synthetic digest failure')),
      })
    ).rejects.toMatchObject({ code: 'capture-failed' });

    const unsafeMediaType = capturedResult();
    if (unsafeMediaType.kind !== 'captured') throw new Error('Synthetic capture must be captured.');
    unsafeMediaType.capture.mediaType = 'application/json\u0000';
    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        chromeApi: fakeChrome([unsafeMediaType]),
        createNonce: () => NONCE,
      })
    ).rejects.toMatchObject({ code: 'unexpected-capture-result' });
  });

  it('fails safely when the extension runtime cannot create a random nonce', async () => {
    vi.stubGlobal('crypto', { subtle: webcrypto.subtle });
    const chromeApi = fakeChrome([capturedResult()]);

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, { chromeApi })
    ).rejects.toMatchObject({ code: 'capture-failed' });
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });

  it('strictly decodes and bounds page data before hashing', async () => {
    const digestSha256 = vi.fn(async () => capturedResult().capture.sha256);
    const nonCanonicalChrome = fakeChrome([
      {
        kind: 'captured',
        capture: { ...capturedResult().capture, bodyBase64: 'AB==', byteLength: 1 },
      },
    ]);

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        chromeApi: nonCanonicalChrome,
        createNonce: () => NONCE,
        digestSha256,
      })
    ).rejects.toMatchObject({ code: 'unexpected-capture-result' });
    expect(digestSha256).not.toHaveBeenCalled();

    const oversizedChrome = fakeChrome([
      {
        kind: 'captured',
        capture: {
          ...capturedResult().capture,
          byteLength: CHATGPT_CAPTURE_MAX_BYTES + 1,
        },
      },
    ]);
    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        chromeApi: oversizedChrome,
        createNonce: () => NONCE,
        digestSha256,
      })
    ).rejects.toMatchObject({ code: 'unexpected-capture-result' });
    expect(digestSha256).not.toHaveBeenCalled();
  });

  it('fails safely if client navigation replaces the hooked document before capture', async () => {
    const chromeApi = fakeChrome([{ kind: 'missing' }]);

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, { chromeApi, createNonce: () => NONCE })
    ).rejects.toMatchObject({ code: 'capture-failed' });
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });

  it('normalizes a browser tab-creation rejection before any tab can be removed', async () => {
    const chromeApi = fakeChrome([]);
    chromeApi.tabs.create.mockRejectedValueOnce(new Error('browser failure'));

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, { chromeApi, createNonce: () => NONCE })
    ).rejects.toMatchObject({ code: 'temporary-tab-create-failed' });
    expect(chromeApi.tabs.remove).not.toHaveBeenCalled();
  });

  it('rejects an unexpected hook-install result and removes the tab', async () => {
    const chromeApi = fakeChrome([]);
    chromeApi.scripting.executeScript.mockImplementation(async injection => {
      if (injection.func === probeChatGptTemporaryCaptureReadiness) {
        return [{ result: { kind: 'ready' } }];
      }
      if (injection.func === installChatGptTemporaryCaptureHook)
        return [{ result: { kind: 'missing' } }];
      return [{ result: { kind: 'cleaned' } }];
    });

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, { chromeApi, createNonce: () => NONCE })
    ).rejects.toMatchObject({ code: 'hook-install-failed' });
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });

  it('rejects an unsafe readiness nonce without installing a hook and closes the tab', async () => {
    const chromeApi = fakeChrome([]);

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        chromeApi,
        createNonce: () => 'unsafe nonce',
      })
    ).rejects.toMatchObject({ code: 'capture-failed' });
    expect(chromeApi.scripting.executeScript.mock.calls.map(([call]) => call.func)).not.toContain(
      installChatGptTemporaryCaptureHook
    );
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });

  it('rejects a created tab with no usable ID before any scripting call', async () => {
    const chromeApi = fakeChrome([]);
    chromeApi.tabs.create.mockResolvedValueOnce({});

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, { chromeApi, createNonce: () => NONCE })
    ).rejects.toMatchObject({ code: 'temporary-tab-missing-id' });
    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled();
    expect(chromeApi.tabs.remove).not.toHaveBeenCalled();
  });

  it('preserves a completed capture when cleanup calls fail', async () => {
    const chromeApi = fakeChrome([capturedResult()]);
    chromeApi.scripting.executeScript.mockImplementation(async injection => {
      if (injection.func === probeChatGptTemporaryCaptureReadiness) {
        return [{ result: { kind: 'ready' } }];
      }
      if (injection.func === cleanupChatGptTemporaryCaptureHook) {
        throw new Error('tab already closing');
      }
      if (injection.func === installChatGptTemporaryCaptureHook)
        return [{ result: { kind: 'ready' } }];
      return [{ result: capturedResult() }];
    });
    chromeApi.tabs.remove.mockRejectedValueOnce(new Error('tab already closed'));

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, { chromeApi, createNonce: () => NONCE })
    ).resolves.toMatchObject({ bodyBase64: 'AP8BgCo=' });
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });

  it('sanitizes an invalid hook error code instead of forwarding it', async () => {
    const chromeApi = fakeChrome([{ kind: 'error', code: 'unexpected-page-detail' } as HookResult]);

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, { chromeApi, createNonce: () => NONCE })
    ).rejects.toMatchObject({ code: 'unexpected-capture-result' });
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });

  it('returns a stable capture failure when polling the page state throws', async () => {
    const chromeApi = fakeChrome([]);
    chromeApi.scripting.executeScript.mockImplementation(async injection => {
      if (injection.func === probeChatGptTemporaryCaptureReadiness) {
        return [{ result: { kind: 'ready' } }];
      }
      if (injection.func === installChatGptTemporaryCaptureHook)
        return [{ result: { kind: 'ready' } }];
      if (injection.func === readChatGptTemporaryCaptureState) throw new Error('page detail');
      return [{ result: { kind: 'cleaned' } }];
    });

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, { chromeApi, createNonce: () => NONCE })
    ).rejects.toMatchObject({ code: 'capture-failed' });
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });
});

describe('installChatGptTemporaryCaptureHook', () => {
  it('captures the exact binary response produced by client-side anchor navigation', async () => {
    const bytes = new Uint8Array([0, 255, 1, 128, 42]);
    const page = installFakeMainWorld({
      onAnchorClick: () => {
        void page.fakeWindow.fetch(
          `https://chatgpt.com/backend-api/conversation/${CONVERSATION_ID}`
        );
      },
      fetch: async () =>
        new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        }),
    });

    expect(
      installChatGptTemporaryCaptureHook(CONVERSATION_ID, NONCE, { maxBytes: 32, timeoutMs: 500 })
    ).toEqual({
      kind: 'ready',
    });
    await vi.waitFor(() =>
      expect(readChatGptTemporaryCaptureState(NONCE)).toEqual(capturedResult())
    );

    expect(page.anchor.href).toBe(`https://chatgpt.com/c/${CONVERSATION_ID}`);
    expect(page.anchor.hidden).toBe(true);
    expect(page.anchor.remove).toHaveBeenCalledOnce();
    expect(page.originalFetch).toHaveBeenCalledWith(
      `https://chatgpt.com/backend-api/conversation/${CONVERSATION_ID}`
    );
    expect(page.fakeWindow.fetch).toBe(page.originalFetch);
  });

  it('ignores unrelated requests, non-JSON responses, and non-200 responses until timeout', async () => {
    vi.useFakeTimers();
    const targetResponses = [
      new Response('{}', {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    ];
    const page = installFakeMainWorld({
      fetch: async (input, init) => {
        if (String(input).endsWith(CONVERSATION_ID) && init?.method !== 'POST') {
          return targetResponses.shift()!;
        }
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    installChatGptTemporaryCaptureHook(CONVERSATION_ID, NONCE, { maxBytes: 32, timeoutMs: 10 });
    await page.fakeWindow.fetch(
      `https://chatgpt.com/backend-api/conversation/${OTHER_CONVERSATION_ID}`
    );
    await page.fakeWindow.fetch(`https://chatgpt.com/backend-api/conversation/${CONVERSATION_ID}`, {
      method: 'POST',
    });
    await page.fakeWindow.fetch(`https://chatgpt.com/backend-api/conversation/${CONVERSATION_ID}`);
    await page.fakeWindow.fetch(`https://chatgpt.com/backend-api/conversation/${CONVERSATION_ID}`);

    expect(readChatGptTemporaryCaptureState(NONCE)).toEqual({ kind: 'ready' });
    await vi.advanceTimersByTimeAsync(10);
    expect(readChatGptTemporaryCaptureState(NONCE)).toEqual({
      kind: 'error',
      code: 'timed-out',
    });
    expect(page.fakeWindow.fetch).toBe(page.originalFetch);
  });

  it('cancels a clone stream that exceeds the byte cap', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const clone = {
      headers: new Headers({ 'content-type': 'application/json' }),
      body: {
        getReader: () => ({
          read: vi.fn().mockResolvedValue({ done: false, value: new Uint8Array(33) }),
          cancel,
        }),
      },
    } as unknown as Response;
    const response = {
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      clone: () => clone,
    } as unknown as Response;
    const page = installFakeMainWorld({
      onAnchorClick: () => {
        void page.fakeWindow.fetch(
          `https://chatgpt.com/backend-api/conversation/${CONVERSATION_ID}`
        );
      },
      fetch: async () => response,
    });

    installChatGptTemporaryCaptureHook(CONVERSATION_ID, NONCE, { maxBytes: 32, timeoutMs: 500 });
    await vi.waitFor(() =>
      expect(readChatGptTemporaryCaptureState(NONCE)).toEqual({
        kind: 'error',
        code: 'payload-too-large',
      })
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects a declared oversized response before reading its body', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const clone = {
      headers: new Headers({ 'content-type': 'application/json', 'content-length': '33' }),
      body: { cancel },
      arrayBuffer: vi.fn(),
    } as unknown as Response;
    const response = {
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      clone: () => clone,
    } as unknown as Response;
    const page = installFakeMainWorld({
      onAnchorClick: () => {
        void page.fakeWindow.fetch(
          `https://chatgpt.com/backend-api/conversation/${CONVERSATION_ID}`
        );
      },
      fetch: async () => response,
    });

    installChatGptTemporaryCaptureHook(CONVERSATION_ID, NONCE, { maxBytes: 32, timeoutMs: 500 });
    await vi.waitFor(() =>
      expect(readChatGptTemporaryCaptureState(NONCE)).toEqual({
        kind: 'error',
        code: 'payload-too-large',
      })
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(clone.arrayBuffer).not.toHaveBeenCalled();
  });

  it('supports a JSON-suffix MIME type and a response without a readable stream', async () => {
    const clone = {
      headers: new Headers({ 'content-type': 'application/ld+json' }),
      body: null,
      arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
    } as unknown as Response;
    const response = {
      status: 200,
      headers: new Headers({ 'content-type': 'application/ld+json' }),
      clone: () => clone,
    } as unknown as Response;
    const page = installFakeMainWorld({
      onAnchorClick: () => {
        void page.fakeWindow.fetch(
          `https://chatgpt.com/backend-api/conversation/${CONVERSATION_ID}`
        );
      },
      fetch: async () => response,
    });

    installChatGptTemporaryCaptureHook(CONVERSATION_ID, NONCE, { maxBytes: 32, timeoutMs: 500 });
    await vi.waitFor(() =>
      expect(readChatGptTemporaryCaptureState(NONCE)).toMatchObject({
        kind: 'captured',
        capture: { bodyBase64: 'AQI=', byteLength: 2, mediaType: 'application/ld+json' },
      })
    );
  });

  it('restores fetch, clears its timeout, and deletes nonce-scoped page state', () => {
    const page = installFakeMainWorld({});
    const clearTimeout = vi.spyOn(page.fakeWindow, 'clearTimeout');

    installChatGptTemporaryCaptureHook(CONVERSATION_ID, NONCE, { maxBytes: 32, timeoutMs: 500 });
    expect(page.fakeWindow.fetch).not.toBe(page.originalFetch);

    expect(cleanupChatGptTemporaryCaptureHook(NONCE)).toEqual({ kind: 'cleaned' });
    expect(page.fakeWindow.fetch).toBe(page.originalFetch);
    expect(clearTimeout).toHaveBeenCalledOnce();
    expect(readChatGptTemporaryCaptureState(NONCE)).toEqual({ kind: 'missing' });
    expect(cleanupChatGptTemporaryCaptureHook(NONCE)).toEqual({ kind: 'missing' });
  });

  it('does not clobber a page wrapper installed after the capture hook', () => {
    const page = installFakeMainWorld({});
    installChatGptTemporaryCaptureHook(CONVERSATION_ID, NONCE, { maxBytes: 32, timeoutMs: 500 });
    const laterWrapper = vi.fn();
    page.fakeWindow.fetch = laterWrapper as unknown as typeof window.fetch;

    expect(cleanupChatGptTemporaryCaptureHook(NONCE)).toEqual({ kind: 'cleaned' });
    expect(page.fakeWindow.fetch).toBe(laterWrapper);
    expect(cleanupChatGptTemporaryCaptureHook(NONCE)).toEqual({ kind: 'missing' });
  });

  it('fails safely if an ephemeral anchor cannot be created', () => {
    const page = installFakeMainWorld({});
    page.fakeDocument.createElement.mockImplementation(() => {
      throw new Error('document failure');
    });

    expect(
      installChatGptTemporaryCaptureHook(CONVERSATION_ID, NONCE, { maxBytes: 32, timeoutMs: 500 })
    ).toEqual({ kind: 'ready' });
    expect(readChatGptTemporaryCaptureState(NONCE)).toEqual({
      kind: 'error',
      code: 'capture-failed',
    });
  });

  it('ignores malformed request-like values and swallows only its observer rejection', async () => {
    const page = installFakeMainWorld({
      fetch: async () => {
        throw new Error('network failure');
      },
    });
    installChatGptTemporaryCaptureHook(CONVERSATION_ID, NONCE, { maxBytes: 32, timeoutMs: 500 });
    const poisonedRequest = {
      get url() {
        throw new Error('poisoned URL getter');
      },
    };

    await expect(page.fakeWindow.fetch(poisonedRequest as unknown as RequestInfo)).rejects.toThrow(
      'network failure'
    );
    await expect(
      page.fakeWindow.fetch(`https://chatgpt.com/backend-api/conversation/${CONVERSATION_ID}`)
    ).rejects.toThrow('network failure');
    await Promise.resolve();
    expect(readChatGptTemporaryCaptureState(NONCE)).toEqual({ kind: 'ready' });
  });

  it('rejects a directly injected hook when the temporary page is not ChatGPT', () => {
    const page = installFakeMainWorld({});
    Object.assign(page.fakeWindow.location, { origin: 'https://auth.openai.com' });

    expect(
      installChatGptTemporaryCaptureHook(CONVERSATION_ID, NONCE, { maxBytes: 32, timeoutMs: 500 })
    ).toEqual({
      kind: 'origin-rejected',
    });
    expect(page.fakeWindow.fetch).toBe(page.originalFetch);
  });
});

describe('probeChatGptTemporaryCaptureReadiness', () => {
  it('waits for about:blank/loading and rejects a completed foreign document', () => {
    const page = installFakeMainWorld({});
    Object.assign(page.fakeWindow.location, { href: 'about:blank', origin: 'null' });
    expect(probeChatGptTemporaryCaptureReadiness()).toEqual({ kind: 'waiting' });

    Object.assign(page.fakeWindow.location, {
      href: 'https://auth.openai.com/login',
      origin: 'https://auth.openai.com',
    });
    expect(probeChatGptTemporaryCaptureReadiness()).toEqual({ kind: 'origin-rejected' });

    Object.assign(page.fakeWindow.location, {
      href: 'https://chatgpt.com/',
      origin: 'https://chatgpt.com',
    });
    Object.assign(page.fakeDocument, { readyState: 'loading' });
    expect(probeChatGptTemporaryCaptureReadiness()).toEqual({ kind: 'waiting' });
  });

  it('requires a complete public app shell before readiness', () => {
    const page = installFakeMainWorld({});
    page.fakeDocument.querySelector.mockReturnValueOnce(null);
    expect(probeChatGptTemporaryCaptureReadiness()).toEqual({ kind: 'waiting' });
    expect(probeChatGptTemporaryCaptureReadiness()).toEqual({ kind: 'ready' });
  });
});
