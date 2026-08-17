import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHATGPT_CAPTURE_ENDPOINT,
  CHATGPT_CAPTURE_MAX_BYTES,
  ChatGptTemporaryCaptureError,
  captureChatGptInTemporaryTab,
  readChatGptTemporaryCaptureState,
} from '../../src/background/chatgpt-capture';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const NONCE = 'f8c1f0a5-b3dd-4d2a-9a11-8e915f6c3e72';
const STATE_KEY = `__liskaChatGptCapture_${NONCE}`;
const CAPTURE_HASH = 'd423c7d662b356d3bcfb768944ff3b5f3f89b7086bb16e6a5afba362da09acb3';

type FakeTab = { status?: string; url?: string };
type ScriptResult = { result?: unknown };

const READY_TARGET_TAB: FakeTab = {
  status: 'complete',
  url: `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}`,
};

function capturedResult() {
  return {
    kind: 'captured' as const,
    capture: {
      bodyBase64: 'AP8BgCo=',
      byteLength: 5,
      sha256: CAPTURE_HASH,
      mediaType: 'application/json; charset=utf-8',
    },
  };
}

function fakeChrome(
  states: unknown[] = [capturedResult()],
  readiness: FakeTab[] = [READY_TARGET_TAB]
) {
  const pendingStates = [...states];
  const pendingReadiness = [...readiness];
  const tabs = {
    create: vi.fn().mockResolvedValue({ id: 73 }),
    get: vi.fn().mockImplementation(async () => pendingReadiness.shift() ?? READY_TARGET_TAB),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const executeScript = vi.fn().mockImplementation(async injection => {
    if (injection.func === readChatGptTemporaryCaptureState) {
      return [{ result: pendingStates.shift() ?? { kind: 'missing' } }] satisfies ScriptResult[];
    }
    return [] satisfies ScriptResult[];
  });
  return { tabs, scripting: { executeScript } };
}

function captureDependencies(chromeApi: ReturnType<typeof fakeChrome>) {
  return {
    chromeApi,
    createNonce: () => NONCE,
    digestSha256: async () => CAPTURE_HASH,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('captureChatGptInTemporaryTab', () => {
  it('creates a nonce-marked exact conversation tab and polls only the predeclared state', async () => {
    const chromeApi = fakeChrome();
    const extensionFetch = vi.fn();
    vi.stubGlobal('fetch', extensionFetch);

    const result = await captureChatGptInTemporaryTab(
      CONVERSATION_ID,
      captureDependencies(chromeApi)
    );

    expect(chromeApi.tabs.create).toHaveBeenCalledWith({
      url: `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}`,
      active: false,
    });
    expect(chromeApi.tabs.get).toHaveBeenCalledWith(73);
    expect(chromeApi.scripting.executeScript.mock.calls.map(([call]) => call.func)).toEqual([
      readChatGptTemporaryCaptureState,
    ]);
    expect(chromeApi.scripting.executeScript.mock.calls[0][0]).toMatchObject({
      target: { tabId: 73 },
      world: 'MAIN',
      func: readChatGptTemporaryCaptureState,
      args: [NONCE],
    });
    expect(chromeApi.tabs.remove).toHaveBeenCalledOnce();
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
    expect(extensionFetch).not.toHaveBeenCalled();
    expect(result).toEqual({ ...capturedResult().capture, endpoint: CHATGPT_CAPTURE_ENDPOINT });
    expect(Object.keys(result)).toEqual([
      'bodyBase64',
      'byteLength',
      'sha256',
      'mediaType',
      'endpoint',
    ]);
  });

  it('creates the nonce before creating a temporary tab', async () => {
    const chromeApi = fakeChrome();
    const order: string[] = [];
    chromeApi.tabs.create.mockImplementation(async properties => {
      order.push(properties.url);
      return { id: 73 };
    });

    await captureChatGptInTemporaryTab(CONVERSATION_ID, {
      ...captureDependencies(chromeApi),
      createNonce: () => {
        order.push('nonce');
        return NONCE;
      },
    });

    expect(order).toEqual([
      'nonce',
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}`,
    ]);
  });

  it('waits for a complete exact target route before reading capture state', async () => {
    const chromeApi = fakeChrome(
      [capturedResult()],
      [
        { status: 'loading', url: `https://chatgpt.com/c/${CONVERSATION_ID}` },
        { status: 'complete', url: 'about:blank' },
        READY_TARGET_TAB,
      ]
    );
    let now = 0;

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        ...captureDependencies(chromeApi),
        now: () => now,
        sleep: async milliseconds => {
          now += milliseconds;
        },
        timeoutMs: 1_000,
        pollIntervalMs: 100,
      })
    ).resolves.toMatchObject({ bodyBase64: 'AP8BgCo=' });

    expect(chromeApi.tabs.get).toHaveBeenCalledTimes(3);
    expect(chromeApi.scripting.executeScript.mock.calls.map(([call]) => call.func)).toEqual([
      readChatGptTemporaryCaptureState,
    ]);
  });

  it('treats missing state as startup waiting and later accepts the captured result', async () => {
    const chromeApi = fakeChrome([{ kind: 'missing' }, { kind: 'ready' }, capturedResult()]);
    let now = 0;

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        ...captureDependencies(chromeApi),
        now: () => now,
        sleep: async milliseconds => {
          now += milliseconds;
        },
        timeoutMs: 1_000,
        pollIntervalMs: 100,
      })
    ).resolves.toMatchObject({ byteLength: 5 });

    expect(chromeApi.scripting.executeScript.mock.calls.map(([call]) => call.func)).toEqual([
      readChatGptTemporaryCaptureState,
      readChatGptTemporaryCaptureState,
      readChatGptTemporaryCaptureState,
    ]);
  });

  it('times out and closes only its created tab when the document-start script is missing', async () => {
    const chromeApi = fakeChrome([]);
    let now = 0;

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        ...captureDependencies(chromeApi),
        now: () => now,
        sleep: async milliseconds => {
          now += milliseconds;
        },
        timeoutMs: 1_000,
        pollIntervalMs: 250,
      })
    ).rejects.toMatchObject({ code: 'timed-out' });

    expect(chromeApi.tabs.create).toHaveBeenCalledOnce();
    expect(chromeApi.tabs.remove).toHaveBeenCalledOnce();
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
    expect(chromeApi.scripting.executeScript.mock.calls.map(([call]) => call.func)).toEqual([
      readChatGptTemporaryCaptureState,
      readChatGptTemporaryCaptureState,
      readChatGptTemporaryCaptureState,
      readChatGptTemporaryCaptureState,
      readChatGptTemporaryCaptureState,
    ]);
  });

  it('treats an unsupported state-read injection as missing until timeout, then closes the tab', async () => {
    const chromeApi = fakeChrome([]);
    chromeApi.scripting.executeScript.mockImplementation(async injection => {
      if (injection.func === readChatGptTemporaryCaptureState) {
        throw new Error('unsupported world');
      }
      return [];
    });
    let now = 0;

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        ...captureDependencies(chromeApi),
        now: () => now,
        sleep: async milliseconds => {
          now += milliseconds;
        },
        timeoutMs: 1_000,
        pollIntervalMs: 500,
      })
    ).rejects.toMatchObject({ code: 'timed-out' });

    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
    expect(chromeApi.scripting.executeScript.mock.calls.map(([call]) => call.func)).toEqual([
      readChatGptTemporaryCaptureState,
      readChatGptTemporaryCaptureState,
      readChatGptTemporaryCaptureState,
    ]);
  });

  it('treats an empty state-read result as missing until timeout, then closes the tab', async () => {
    const chromeApi = fakeChrome([]);
    chromeApi.scripting.executeScript.mockImplementation(async injection => {
      if (injection.func === readChatGptTemporaryCaptureState) return [];
      return [];
    });
    let now = 0;

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        ...captureDependencies(chromeApi),
        now: () => now,
        sleep: async milliseconds => {
          now += milliseconds;
        },
        timeoutMs: 1_000,
        pollIntervalMs: 1_000,
      })
    ).rejects.toMatchObject({ code: 'timed-out' });

    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
    expect(chromeApi.scripting.executeScript.mock.calls.map(([call]) => call.func)).toEqual([
      readChatGptTemporaryCaptureState,
      readChatGptTemporaryCaptureState,
    ]);
  });

  it('rejects a completed foreign redirect before reading page state and closes its tab', async () => {
    const chromeApi = fakeChrome(
      [],
      [{ status: 'complete', url: 'https://auth.openai.com/login' }]
    );

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(chromeApi))
    ).rejects.toMatchObject({ code: 'unexpected-origin' });

    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled();
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });

  it('rejects a same-origin route change before reading state', async () => {
    const chromeApi = fakeChrome([], [{ status: 'complete', url: 'https://chatgpt.com/' }]);

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(chromeApi))
    ).rejects.toMatchObject({ code: 'capture-failed' });
    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled();
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });

  it('maps a stable page error, re-verifies capture bytes, and strips extra page fields', async () => {
    const pageError = fakeChrome([{ kind: 'error', code: 'response-http-error' }]);
    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(pageError))
    ).rejects.toMatchObject({ code: 'response-http-error' });

    const pageResult = capturedResult();
    Object.assign(pageResult.capture, { accountId: 'must-not-cross-the-boundary' });
    const captureChrome = fakeChrome([pageResult]);
    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(captureChrome))
    ).resolves.toEqual({ ...capturedResult().capture, endpoint: CHATGPT_CAPTURE_ENDPOINT });

    const mismatchedHash = fakeChrome([
      { kind: 'captured', capture: { ...capturedResult().capture, sha256: '0'.repeat(64) } },
    ]);
    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(mismatchedHash))
    ).rejects.toMatchObject({ code: 'unexpected-capture-result' });
  });

  it('rejects an invalid ID before nonce generation or tab creation', async () => {
    const chromeApi = fakeChrome();
    const createNonce = vi.fn(() => NONCE);

    await expect(
      captureChatGptInTemporaryTab('../not-a-conversation-id', { chromeApi, createNonce })
    ).rejects.toEqual(new ChatGptTemporaryCaptureError('invalid-conversation-id'));
    expect(createNonce).not.toHaveBeenCalled();
    expect(chromeApi.tabs.create).not.toHaveBeenCalled();
  });

  it('fails safely if nonce generation fails before a tab exists', async () => {
    const chromeApi = fakeChrome();

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        chromeApi,
        createNonce: () => {
          throw new Error(`sensitive ${CONVERSATION_ID}`);
        },
      })
    ).rejects.toMatchObject({ code: 'capture-failed' });
    expect(chromeApi.tabs.create).not.toHaveBeenCalled();
    expect(chromeApi.tabs.remove).not.toHaveBeenCalled();
  });

  it('removes an eventual safe tab ID after tab creation loses the timeout race', async () => {
    vi.useFakeTimers();
    const chromeApi = fakeChrome([]);
    let resolveCreation: ((tab: { id?: number }) => void) | undefined;
    const delayedCreation = new Promise<{ id?: number }>(resolve => {
      resolveCreation = resolve;
    });
    chromeApi.tabs.create.mockReturnValueOnce(delayedCreation);

    const capture = captureChatGptInTemporaryTab(CONVERSATION_ID, {
      ...captureDependencies(chromeApi),
      now: () => 0,
      timeoutMs: 1_000,
    });
    const captureExpectation = expect(capture).rejects.toMatchObject({
      code: 'temporary-tab-create-failed',
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await captureExpectation;
    expect(chromeApi.tabs.remove).not.toHaveBeenCalled();

    resolveCreation?.({ id: 97 });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(chromeApi.tabs.remove).toHaveBeenCalledTimes(1);
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(97);
  });

  it('bounds page-provided artifacts before hashing them', async () => {
    const digestSha256 = vi.fn(async () => CAPTURE_HASH);
    const oversized = fakeChrome([
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
        ...captureDependencies(oversized),
        digestSha256,
      })
    ).rejects.toMatchObject({ code: 'unexpected-capture-result' });
    expect(digestSha256).not.toHaveBeenCalled();
  });

  it('uses native nonce, sleep, and SHA dependencies when overrides are omitted', async () => {
    const chromeApi = fakeChrome(
      [capturedResult()],
      [{ status: 'loading', url: 'about:blank' }, READY_TARGET_TAB]
    );
    vi.stubGlobal('chrome', chromeApi);
    vi.stubGlobal('crypto', webcrypto);

    await expect(captureChatGptInTemporaryTab(CONVERSATION_ID)).resolves.toMatchObject({
      bodyBase64: capturedResult().capture.bodyBase64,
      sha256: CAPTURE_HASH,
    });
    expect(chromeApi.tabs.get).toHaveBeenCalledTimes(2);
  });

  it('fails closed when native capture identity or hashing is unavailable', async () => {
    const noIdentity = fakeChrome();
    vi.stubGlobal('chrome', noIdentity);
    vi.stubGlobal('crypto', { subtle: webcrypto.subtle });
    await expect(captureChatGptInTemporaryTab(CONVERSATION_ID)).rejects.toMatchObject({
      code: 'capture-failed',
    });
    expect(noIdentity.tabs.create).not.toHaveBeenCalled();

    const noDigest = fakeChrome();
    vi.stubGlobal('chrome', noDigest);
    vi.stubGlobal('crypto', { randomUUID: () => NONCE });
    await expect(captureChatGptInTemporaryTab(CONVERSATION_ID)).rejects.toMatchObject({
      code: 'capture-failed',
    });
    expect(noDigest.tabs.remove).toHaveBeenCalledWith(73);
  });

  it.each([
    ['missing decoder', undefined, globalThis.btoa],
    [
      'throwing decoder',
      () => {
        throw new Error('decoder failed');
      },
      globalThis.btoa,
    ],
    ['non-canonical encoder', globalThis.atob, () => 'different'],
  ])('rejects captured bytes with a %s', async (_label, atob, btoa) => {
    const chromeApi = fakeChrome();
    vi.stubGlobal('atob', atob);
    vi.stubGlobal('btoa', btoa);

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(chromeApi))
    ).rejects.toMatchObject({ code: 'unexpected-capture-result' });
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });

  it('rejects malformed base64, unsafe media type, and digest failures', async () => {
    const malformed = fakeChrome([
      {
        kind: 'captured',
        capture: { ...capturedResult().capture, bodyBase64: 'not base64!', byteLength: 11 },
      },
    ]);
    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(malformed))
    ).rejects.toMatchObject({ code: 'unexpected-capture-result' });

    const unsafeMedia = fakeChrome([
      {
        kind: 'captured',
        capture: { ...capturedResult().capture, mediaType: 'application/json\u0000' },
      },
    ]);
    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(unsafeMedia))
    ).rejects.toMatchObject({ code: 'unexpected-capture-result' });

    const digestFailure = fakeChrome();
    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        ...captureDependencies(digestFailure),
        digestSha256: async () => {
          throw new Error('digest failed');
        },
      })
    ).rejects.toMatchObject({ code: 'capture-failed' });
  });

  it('sanitizes an unknown page error code', async () => {
    const chromeApi = fakeChrome([{ kind: 'error', code: 'provider-secret' }]);

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(chromeApi))
    ).rejects.toMatchObject({ code: 'unexpected-capture-result' });
  });

  it('rejects unsafe nonce values and unusable tab creation results', async () => {
    const unsafeNonce = fakeChrome();
    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        ...captureDependencies(unsafeNonce),
        createNonce: () => 'unsafe nonce',
      })
    ).rejects.toMatchObject({ code: 'capture-failed' });
    expect(unsafeNonce.tabs.create).not.toHaveBeenCalled();

    const synchronousCreateFailure = fakeChrome();
    synchronousCreateFailure.tabs.create.mockImplementation(() => {
      throw new Error('create failed');
    });
    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(synchronousCreateFailure))
    ).rejects.toMatchObject({ code: 'temporary-tab-create-failed' });

    const rejectedCreate = fakeChrome();
    rejectedCreate.tabs.create.mockRejectedValueOnce(new Error('create rejected'));
    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(rejectedCreate))
    ).rejects.toMatchObject({ code: 'temporary-tab-create-failed' });

    const missingId = fakeChrome();
    missingId.tabs.create.mockResolvedValueOnce({});
    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(missingId))
    ).rejects.toMatchObject({ code: 'temporary-tab-missing-id' });
  });

  it('preserves success when cleanup removal rejects', async () => {
    const chromeApi = fakeChrome();
    chromeApi.tabs.remove.mockRejectedValueOnce(new Error('tab already closed'));

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(chromeApi))
    ).resolves.toMatchObject({ bodyBase64: capturedResult().capture.bodyBase64 });
  });

  it('waits through malformed and temporarily unavailable tab metadata', async () => {
    const chromeApi = fakeChrome(
      [capturedResult()],
      [{ status: 'complete', url: 'not a valid URL' }, READY_TARGET_TAB]
    );
    chromeApi.tabs.get.mockRejectedValueOnce(new Error('tab not ready'));
    let now = 0;

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        ...captureDependencies(chromeApi),
        now: () => now,
        sleep: async milliseconds => {
          now += milliseconds;
        },
        pollIntervalMs: 100,
      })
    ).resolves.toMatchObject({ sha256: CAPTURE_HASH });
    expect(chromeApi.tabs.get).toHaveBeenCalledTimes(3);
  });

  it('times out before page-state reads when the temporary tab never becomes ready', async () => {
    const chromeApi = fakeChrome([]);
    chromeApi.tabs.get.mockResolvedValue({ status: 'loading', url: 'about:blank' });
    let now = 0;

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        ...captureDependencies(chromeApi),
        now: () => now,
        sleep: async milliseconds => {
          now += milliseconds;
        },
        timeoutMs: 1_000,
        pollIntervalMs: 250,
      })
    ).rejects.toMatchObject({ code: 'timed-out' });
    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled();
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });
});

describe('temporary capture snapshot reader', () => {
  it('consumes only a non-enumerable, non-configurable own getter snapshot', () => {
    const fakeWindow = {} as Window & typeof globalThis;
    const snapshot = capturedResult();
    const getter = vi.fn(() => ({
      kind: snapshot.kind,
      capture: { ...snapshot.capture },
    }));
    Object.defineProperty(fakeWindow, STATE_KEY, {
      configurable: false,
      enumerable: false,
      get: getter,
    });
    vi.stubGlobal('window', fakeWindow);

    const first = readChatGptTemporaryCaptureState(NONCE);
    if (first.kind !== 'captured') throw new Error('Synthetic snapshot must be captured.');
    first.capture.bodyBase64 = 'forged';

    expect(readChatGptTemporaryCaptureState(NONCE)).toEqual(capturedResult());
    expect(getter).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed snapshot values and throwing getters', () => {
    const cases: unknown[] = [
      { kind: 'error', code: 'unknown-error' },
      { kind: 'captured', capture: null },
      {
        kind: 'captured',
        capture: { bodyBase64: 42, byteLength: '5', sha256: null, mediaType: [] },
      },
    ];

    for (const value of cases) {
      const fakeWindow = { [STATE_KEY]: value } as unknown as Window & typeof globalThis;
      vi.stubGlobal('window', fakeWindow);
      expect(readChatGptTemporaryCaptureState(NONCE)).toEqual({ kind: 'missing' });
    }

    const throwingWindow = {} as Window & typeof globalThis;
    Object.defineProperty(throwingWindow, STATE_KEY, {
      get() {
        throw new Error('getter failed');
      },
    });
    vi.stubGlobal('window', throwingWindow);
    expect(readChatGptTemporaryCaptureState(NONCE)).toEqual({ kind: 'missing' });
  });

  it('reconstructs an allowlisted primitive error snapshot', () => {
    const fakeWindow = {
      [STATE_KEY]: { kind: 'error', code: 'timed-out' },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', fakeWindow);

    expect(readChatGptTemporaryCaptureState(NONCE)).toEqual({
      kind: 'error',
      code: 'timed-out',
    });
  });
});
