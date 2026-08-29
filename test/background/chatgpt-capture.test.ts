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
const OTHER_CONVERSATION_ID = '11111111-2222-3333-4444-555555555555';
const NONCE = 'f8c1f0a5-b3dd-4d2a-9a11-8e915f6c3e72';
const STATE_KEY = `__liskaChatGptCapture_${NONCE}`;
const CAPTURE_HASH = 'd423c7d662b356d3bcfb768944ff3b5f3f89b7086bb16e6a5afba362da09acb3';
const RESOLVER_FILE_ID = 'file-abc_123';
const RESOLVER_DOWNLOAD_URL =
  `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
  '&id=signed-transport-id&p=path&sig=signature&ts=123&v=1';
const RESOLVER_RESPONSE_BASE64 =
  'eyJzdGF0dXMiOiJTdWNjZXNzIiwiZG93bmxvYWRfdXJsIjoiaHR0cHM6Ly9jaGF0Z3B0LmNvbS9iYWNrZW5kLWFwaS9lc3R1YXJ5L2NvbnRlbnQ/Y2lkPTAxMjM0NTY3LTg5YWItNGNkZS04ZjAxLTIzNDU2Nzg5YWJjZCZpZD1zaWduZWQtdHJhbnNwb3J0LWlkJnA9cGF0aCZzaWc9c2lnbmF0dXJlJnRzPTEyMyZ2PTEiLCJleHBpcmVzX2F0IjoiMjAyNi0wOC0yMVQxMjowMDowMFoifQ==';
const RESOLVER_RESPONSE_HASH = '5a688d0bba29fa9cc48f23e6a0ff84adf037acc533137f25364ebc7e9e6f79aa';
const RESOLVER_KEY = '7404723b52ebe964b6ac76965f76009f8edb166d7b5ebeb8619b05b0d53033ff';

type FakeTab = { status?: string; url?: string };
type ScriptResult = { result?: unknown };

const READY_TARGET_TAB: FakeTab = {
  status: 'complete',
  url: `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}`,
};

function capturedResult() {
  return {
    kind: 'captured' as const,
    conversationId: CONVERSATION_ID,
    capture: {
      bodyBase64: 'AP8BgCo=',
      byteLength: 5,
      sha256: CAPTURE_HASH,
      mediaType: 'application/json; charset=utf-8',
    },
    resolverObservations: [],
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

async function actualDigest(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const digest = await webcrypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function base64Bytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function resolverObservation(value: unknown) {
  const source = typeof value === 'string' ? value : JSON.stringify(value);
  const bytes = new TextEncoder().encode(source);
  return {
    providerFileId: RESOLVER_FILE_ID,
    bodyBase64: base64Bytes(bytes),
    byteLength: bytes.byteLength,
    sha256: await actualDigest(bytes),
    mediaType: 'application/json',
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
    expect(result).toEqual({
      ...capturedResult().capture,
      endpoint: CHATGPT_CAPTURE_ENDPOINT,
      transientAssetResolvers: [],
    });
    expect(Object.keys(result)).toEqual([
      'bodyBase64',
      'byteLength',
      'sha256',
      'mediaType',
      'transientAssetResolvers',
      'endpoint',
    ]);
  });

  it('keeps resolver discovery opt-in while retaining the default fast capture path', async () => {
    const chromeApi = fakeChrome();

    await captureChatGptInTemporaryTab(CONVERSATION_ID, {
      ...captureDependencies(chromeApi),
      observeAssetResolvers: true,
    });

    expect(chromeApi.tabs.create).toHaveBeenCalledWith({
      url: `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-observe-asset-resolvers=1`,
      active: false,
    });
  });

  it('keeps a verified capture when exact temporary-tab cleanup throws synchronously', async () => {
    const chromeApi = fakeChrome();
    chromeApi.tabs.remove.mockImplementation(() => {
      throw new Error('browser cleanup unavailable');
    });

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(chromeApi))
    ).resolves.toMatchObject({ endpoint: CHATGPT_CAPTURE_ENDPOINT });
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
  });

  it('binds the captured snapshot to the requested conversation before accepting it', async () => {
    const chromeApi = fakeChrome([{ ...capturedResult(), conversationId: OTHER_CONVERSATION_ID }]);

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(chromeApi))
    ).rejects.toMatchObject({ code: 'captured-conversation-id-mismatch' });
  });

  it.each([
    ['malformed', 'not-an-observation-array'],
    ['over-cap', Array.from({ length: 33 }, () => null)],
  ])(
    'drops %s resolver observations without downgrading a verified conversation',
    async (_label, observations) => {
      const chromeApi = fakeChrome([{ ...capturedResult(), resolverObservations: observations }]);

      await expect(
        captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(chromeApi))
      ).resolves.toMatchObject({ transientAssetResolvers: [] });
    }
  );

  it('returns only deduplicated opaque resolver keys with independently validated URLs', async () => {
    const resolverObservation = {
      providerFileId: RESOLVER_FILE_ID,
      bodyBase64: RESOLVER_RESPONSE_BASE64,
      byteLength: 217,
      sha256: RESOLVER_RESPONSE_HASH,
      mediaType: 'application/json',
    };
    const chromeApi = fakeChrome([
      {
        ...capturedResult(),
        resolverObservations: [
          resolverObservation,
          resolverObservation,
          { ...resolverObservation, providerFileId: 'file-other', sha256: '0'.repeat(64) },
        ],
      },
    ]);

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        ...captureDependencies(chromeApi),
        digestSha256: actualDigest,
        observeAssetResolvers: true,
      })
    ).resolves.toMatchObject({
      transientAssetResolvers: [{ resolverKey: RESOLVER_KEY, downloadUrl: RESOLVER_DOWNLOAD_URL }],
    });
  });

  it('drops malformed resolver records and unapproved resolver response bodies', async () => {
    const valid = await resolverObservation({
      status: 'Success',
      download_url: RESOLVER_DOWNLOAD_URL,
    });
    const bodies = [
      { ...valid, unexpected: true },
      await resolverObservation({ status: 'Success', download_url: '' }),
      await resolverObservation({
        status: 'Success',
        download_url: RESOLVER_DOWNLOAD_URL.replace('https://chatgpt.com', 'https://evil.example'),
      }),
      await resolverObservation({
        status: 'Success',
        download_url: RESOLVER_DOWNLOAD_URL.replace('&sig=signature', '&unknown=value'),
      }),
      await resolverObservation({ status: 'Success', download_url: 'not a valid absolute URL' }),
      await resolverObservation({ status: 'Success', detail: 'missing download URL' }),
      await resolverObservation({ status: 'Error', download_url: RESOLVER_DOWNLOAD_URL }),
      await resolverObservation({ download_url: RESOLVER_DOWNLOAD_URL }),
      await resolverObservation('not-json'),
    ];

    for (const observation of bodies) {
      const chromeApi = fakeChrome([{ ...capturedResult(), resolverObservations: [observation] }]);
      await expect(
        captureChatGptInTemporaryTab(CONVERSATION_ID, {
          ...captureDependencies(chromeApi),
          digestSha256: actualDigest,
          observeAssetResolvers: true,
        })
      ).resolves.toMatchObject({ transientAssetResolvers: [] });
    }
  });

  it('drops resolver observations when response or opaque-key hashing is unavailable', async () => {
    const observation = await resolverObservation({
      status: 'Success',
      download_url: RESOLVER_DOWNLOAD_URL,
    });
    const responseDigestFailure = fakeChrome([
      { ...capturedResult(), resolverObservations: [observation] },
    ]);
    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        ...captureDependencies(responseDigestFailure),
        digestSha256: bytes =>
          bytes.byteLength === 5
            ? actualDigest(bytes)
            : Promise.reject(new Error('resolver digest unavailable')),
        observeAssetResolvers: true,
      })
    ).resolves.toMatchObject({ transientAssetResolvers: [] });

    let digestCalls = 0;
    const keyDigestFailure = fakeChrome([
      { ...capturedResult(), resolverObservations: [observation] },
    ]);
    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, {
        ...captureDependencies(keyDigestFailure),
        digestSha256: bytes => {
          digestCalls += 1;
          return digestCalls < 3
            ? actualDigest(bytes)
            : Promise.reject(new Error('key digest unavailable'));
        },
        observeAssetResolvers: true,
      })
    ).resolves.toMatchObject({ transientAssetResolvers: [] });
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
    ).rejects.toMatchObject({ code: 'capture-result-timeout' });

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
    ).rejects.toMatchObject({ code: 'capture-result-timeout' });

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
    ).rejects.toMatchObject({ code: 'capture-result-timeout' });

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
    ).rejects.toMatchObject({ code: 'unexpected-path' });
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
    ).resolves.toEqual({
      ...capturedResult().capture,
      endpoint: CHATGPT_CAPTURE_ENDPOINT,
      transientAssetResolvers: [],
    });

    const mismatchedHash = fakeChrome([
      {
        ...capturedResult(),
        capture: { ...capturedResult().capture, sha256: '0'.repeat(64) },
      },
    ]);
    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(mismatchedHash))
    ).rejects.toMatchObject({ code: 'response-integrity-invalid' });
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
    ).rejects.toMatchObject({ code: 'nonce-unavailable' });
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
        ...capturedResult(),
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
      code: 'nonce-unavailable',
    });
    expect(noIdentity.tabs.create).not.toHaveBeenCalled();

    const noDigest = fakeChrome();
    vi.stubGlobal('chrome', noDigest);
    vi.stubGlobal('crypto', { randomUUID: () => NONCE });
    await expect(captureChatGptInTemporaryTab(CONVERSATION_ID)).rejects.toMatchObject({
      code: 'hash-unavailable',
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
        ...capturedResult(),
        capture: { ...capturedResult().capture, bodyBase64: 'not base64!', byteLength: 11 },
      },
    ]);
    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(malformed))
    ).rejects.toMatchObject({ code: 'unexpected-capture-result' });

    const unsafeMedia = fakeChrome([
      {
        ...capturedResult(),
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
    ).rejects.toMatchObject({ code: 'hash-unavailable' });
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
    ).rejects.toMatchObject({ code: 'nonce-invalid' });
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

  it('preserves success when a Chromium fork exposes callback-style void cleanup', async () => {
    const chromeApi = fakeChrome();
    chromeApi.tabs.remove.mockReturnValueOnce(undefined as never);

    await expect(
      captureChatGptInTemporaryTab(CONVERSATION_ID, captureDependencies(chromeApi))
    ).resolves.toMatchObject({ bodyBase64: capturedResult().capture.bodyBase64 });
    expect(chromeApi.tabs.remove).toHaveBeenCalledWith(73);
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
    ).rejects.toMatchObject({ code: 'temporary-tab-ready-timeout' });
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
      conversationId: snapshot.conversationId,
      capture: { ...snapshot.capture },
      resolverObservations: [],
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
        conversationId: CONVERSATION_ID,
        resolverObservations: [],
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

  it('copies only complete primitive resolver observations from a captured snapshot', () => {
    const valid = {
      providerFileId: RESOLVER_FILE_ID,
      bodyBase64: RESOLVER_RESPONSE_BASE64,
      byteLength: 217,
      sha256: RESOLVER_RESPONSE_HASH,
      mediaType: 'application/json',
    };
    const fakeWindow = {
      [STATE_KEY]: {
        ...capturedResult(),
        resolverObservations: [null, { providerFileId: RESOLVER_FILE_ID }, valid],
      },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', fakeWindow);

    expect(readChatGptTemporaryCaptureState(NONCE)).toEqual({
      ...capturedResult(),
      resolverObservations: [valid],
    });
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
