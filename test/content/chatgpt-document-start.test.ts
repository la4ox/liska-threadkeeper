import { webcrypto } from 'node:crypto';
import { URL as NodeURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readChatGptTemporaryCaptureState } from '../../src/background/chatgpt-capture';
import { readChatGptOpaqueProbeState } from '../../src/background/chatgpt-opaque-probe';
import { readChatGptOpaqueReplayState } from '../../src/background/chatgpt-opaque-replay';
import { readChatGptActiveResolverState } from '../../src/background/chatgpt-active-resolver';
import { startChatGptDocumentStartCapture } from '../../src/content/capture/chatgpt-document-start';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const OTHER_CONVERSATION_ID = '11111111-2222-3333-4444-555555555555';
const NONCE = 'f8c1f0a5-b3dd-4d2a-9a11-8e915f6c3e72';
const STATE_KEY = `__liskaChatGptCapture_${NONCE}`;
const OPAQUE_STATE_KEY = `__liskaChatGptOpaqueProbe_${NONCE}`;
const OPAQUE_REPLAY_STATE_KEY = `__liskaChatGptOpaqueReplay_${NONCE}`;
const OPAQUE_RESOLVER_STATE_KEY = `__liskaChatGptOpaqueResolver_${NONCE}`;
const ACTIVE_RESOLVER_STATE_KEY = `__liskaChatGptActiveResolver_${NONCE}`;
const ACTIVE_RESOLVER_COMMAND_KEY = `__liskaChatGptActiveResolverCommand_${NONCE}`;
const ENDPOINT = `/backend-api/conversation/${CONVERSATION_ID}`;
const CAPTURE_HASH = 'd423c7d662b356d3bcfb768944ff3b5f3f89b7086bb16e6a5afba362da09acb3';
const RESOLVER_FILE_ID = 'file-abc_123';
const RESOLVER_ENDPOINT =
  `/backend-api/files/download/${RESOLVER_FILE_ID}` +
  `?inline=true&conversation_id=${CONVERSATION_ID}`;
const SCOPED_RESOLVER_ENDPOINT =
  `/backend-api/files/download/${RESOLVER_FILE_ID}` +
  `?conversation_id=${CONVERSATION_ID}&inline=true` +
  `&check_context_scopes_for_conversation_id=${CONVERSATION_ID}`;
const CALPICO_RESOLVER_ENDPOINT = `/backend-api/calpico/chatgpt/files/${RESOLVER_FILE_ID}`;

class TestRequest {
  readonly #url: string;
  readonly #method: string;

  constructor(url: string, init?: { method?: string }) {
    this.#url = url;
    this.#method = init?.method ?? 'GET';
  }

  get url(): string {
    return this.#url;
  }

  get method(): string {
    return this.#method;
  }
}

class OpaqueTestRequest {
  readonly #url: string;
  readonly #method: string;
  readonly #credentials: RequestCredentials;
  readonly #headers: Headers;
  readonly #redirect: RequestRedirect | undefined;
  readonly #cache: RequestCache | undefined;
  readonly #signal: AbortSignal | undefined;

  constructor(
    url: string,
    init: {
      method?: string;
      credentials?: RequestCredentials;
      headers?: HeadersInit;
      redirect?: RequestRedirect;
      cache?: RequestCache;
      signal?: AbortSignal;
    } = {}
  ) {
    this.#url = url;
    this.#method = init.method ?? 'GET';
    this.#credentials = init.credentials ?? 'same-origin';
    // Browser-native Request clones/copies headers internally. Preserve an
    // existing opaque Headers object in this synthetic Request so a poisoned
    // public iterator can prove observer code never enumerates header values.
    this.#headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
    this.#redirect = init.redirect;
    this.#cache = init.cache;
    this.#signal = init.signal;
  }

  get url(): string {
    return this.#url;
  }

  get method(): string {
    return this.#method;
  }

  get credentials(): RequestCredentials {
    return this.#credentials;
  }

  get headers(): Headers {
    return this.#headers;
  }

  get redirect(): RequestRedirect | undefined {
    return this.#redirect;
  }

  get cache(): RequestCache | undefined {
    return this.#cache;
  }

  get signal(): AbortSignal | undefined {
    return this.#signal;
  }

  clone(): OpaqueTestRequest {
    return new OpaqueTestRequest(this.#url, {
      method: this.#method,
      credentials: this.#credentials,
      headers: this.#headers,
    });
  }
}

type FakePage = {
  pageWindow: Window & typeof globalThis;
  originalFetch: ReturnType<typeof vi.fn>;
  timers: Set<ReturnType<typeof globalThis.setTimeout>>;
};

const pages: FakePage[] = [];

function markedUrl(path = `/c/${CONVERSATION_ID}`, observeAssetResolvers = false): string {
  return `https://chatgpt.com${path}#liska-capture=${NONCE}${
    observeAssetResolvers ? '&liska-observe-asset-resolvers=1' : ''
  }`;
}

function markedOpaqueProbeUrl(path = `/c/${CONVERSATION_ID}`): string {
  return `https://chatgpt.com${path}#liska-capture=${NONCE}&liska-opaque-probe=1`;
}

function markedOpaqueResolverUrl(path = `/c/${CONVERSATION_ID}`): string {
  return `https://chatgpt.com${path}#liska-capture=${NONCE}&liska-opaque-resolver-observer=1`;
}

function markedActiveResolverUrl(path = `/c/${CONVERSATION_ID}`): string {
  return `https://chatgpt.com${path}#liska-capture=${NONCE}&liska-active-resolver=1`;
}

function fakePage(
  href: string,
  fetchImplementation: (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => Promise<Response> = async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  RequestConstructor: typeof TestRequest | typeof OpaqueTestRequest = TestRequest
): FakePage {
  const originalFetch = vi.fn(fetchImplementation);
  const timers = new Set<ReturnType<typeof globalThis.setTimeout>>();
  const setTimeout = ((callback, timeout, ...args) => {
    const timer = globalThis.setTimeout(callback, timeout, ...args);
    timers.add(timer);
    return timer;
  }) as typeof globalThis.setTimeout;
  const clearTimeout = ((timer: ReturnType<typeof globalThis.setTimeout>) => {
    timers.delete(timer);
    return globalThis.clearTimeout(timer);
  }) as typeof globalThis.clearTimeout;
  const pageWindow = {
    location: { href },
    fetch: originalFetch,
    setTimeout,
    clearTimeout,
    crypto: webcrypto,
    btoa: globalThis.btoa,
    Reflect: globalThis.Reflect,
    Object: globalThis.Object,
    URL: NodeURL as unknown as typeof globalThis.URL,
    Request: RequestConstructor as unknown as typeof globalThis.Request,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
    AbortController: globalThis.AbortController,
    ReadableStream: globalThis.ReadableStream,
    ReadableStreamDefaultReader: globalThis.ReadableStreamDefaultReader,
    Promise: globalThis.Promise,
    Array: globalThis.Array,
    Uint8Array: globalThis.Uint8Array,
    ArrayBuffer: globalThis.ArrayBuffer,
    String: globalThis.String,
  } as unknown as Window & typeof globalThis;
  const page = { pageWindow, originalFetch, timers };
  pages.push(page);
  return page;
}

function snapshotOf(page: FakePage): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(page.pageWindow, STATE_KEY);
  return descriptor?.get?.call(page.pageWindow);
}

function opaqueSnapshotOf(page: FakePage): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(page.pageWindow, OPAQUE_STATE_KEY);
  return descriptor?.get?.call(page.pageWindow);
}

function opaqueReplaySnapshotOf(page: FakePage): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(page.pageWindow, OPAQUE_REPLAY_STATE_KEY);
  return descriptor?.get?.call(page.pageWindow);
}

function opaqueResolverSnapshotOf(page: FakePage): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(page.pageWindow, OPAQUE_RESOLVER_STATE_KEY);
  return descriptor?.get?.call(page.pageWindow);
}

function activeResolverSnapshotOf(page: FakePage): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(page.pageWindow, ACTIVE_RESOLVER_STATE_KEY);
  return descriptor?.get?.call(page.pageWindow);
}

function releasePage(page: FakePage): void {
  for (const timer of page.timers) page.pageWindow.clearTimeout(timer);
}

function responseWithCloneSpy(bytes: Uint8Array): {
  response: Response;
  clone: ReturnType<typeof vi.fn>;
} {
  const response = new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
  const clone = vi.fn(response.clone.bind(response));
  Object.defineProperty(response, 'clone', { configurable: true, value: clone });
  return { response, clone };
}

afterEach(() => {
  for (const page of pages.splice(0)) releasePage(page);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('startChatGptDocumentStartCapture', () => {
  it('is inert without the exact marker before accessing fetch or creating state', () => {
    const inertWindow = {
      location: { href: `https://chatgpt.com/c/${CONVERSATION_ID}` },
      get fetch() {
        throw new Error('inert path must not read fetch');
      },
    } as unknown as Window & typeof globalThis;

    expect(startChatGptDocumentStartCapture(inertWindow)).toEqual({ kind: 'inert' });
    expect(Object.getOwnPropertyDescriptor(inertWindow, STATE_KEY)).toBeUndefined();
  });

  it.each([
    ['regular', `/c/${CONVERSATION_ID}`],
    ['regular trailing slash', `/c/${CONVERSATION_ID}/`],
    ['custom GPT', `/g/my-custom-gpt/c/${CONVERSATION_ID}`],
    ['custom GPT trailing slash', `/g/my-custom-gpt/c/${CONVERSATION_ID}/`],
  ])('arms only the exact %s conversation route', (_label, path) => {
    const page = fakePage(markedUrl(path));

    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    expect(page.pageWindow.fetch).not.toBe(page.originalFetch);
    const descriptor = Object.getOwnPropertyDescriptor(page.pageWindow, STATE_KEY);
    expect(descriptor).toMatchObject({ configurable: false, enumerable: false, set: undefined });
    expect(typeof descriptor?.get).toBe('function');
    expect('value' in (descriptor ?? {})).toBe(false);
    expect(Object.keys(page.pageWindow)).not.toContain(STATE_KEY);
  });

  it.each([
    'not a URL',
    `https://chatgpt.com/c/${CONVERSATION_ID}?share=1#liska-capture=${NONCE}`,
    `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}!`,
    `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=%66${NONCE.slice(1)}`,
    `https://chatgpt.com/c/${OTHER_CONVERSATION_ID}/extra#liska-capture=${NONCE}`,
    `https://chatgpt.com/g/${'a'.repeat(129)}/c/${CONVERSATION_ID}#liska-capture=${NONCE}`,
    `https://evil.example/c/${CONVERSATION_ID}#liska-capture=${NONCE}`,
  ])('leaves malformed marker or route input inert: %s', href => {
    const page = fakePage(href);

    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'inert' });
    expect(page.pageWindow.fetch).toBe(page.originalFetch);
    expect(snapshotOf(page)).toBeUndefined();
    expect(page.originalFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['relative string', () => ENDPOINT],
    ['URL', () => new NodeURL(`https://chatgpt.com${ENDPOINT}`) as unknown as URL],
    [
      'Request',
      () =>
        new TestRequest(`https://chatgpt.com${ENDPOINT}`, { method: 'GET' }) as unknown as Request,
    ],
  ])(
    'captures the page-native exact GET supplied as %s without consuming its response',
    async (_label, makeInput) => {
      const bytes = new Uint8Array([0, 255, 1, 128, 42]);
      const { response, clone } = responseWithCloneSpy(bytes);
      const page = fakePage(markedUrl(), async () => response);

      expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
      const pageResponse = await page.pageWindow.fetch(makeInput());

      expect(pageResponse).toBe(response);
      await expect(pageResponse.arrayBuffer()).resolves.toEqual(bytes.buffer);
      await vi.waitFor(() =>
        expect(snapshotOf(page)).toEqual({
          kind: 'captured',
          conversationId: CONVERSATION_ID,
          capture: {
            bodyBase64: 'AP8BgCo=',
            byteLength: 5,
            sha256: CAPTURE_HASH,
            mediaType: 'application/json; charset=utf-8',
          },
          resolverObservations: [],
        })
      );
      expect(clone).not.toHaveBeenCalled();
    }
  );

  it.each([
    [
      'rejected credentials',
      { credentials: 'omit', headers: { authorization: 'synthetic-sentinel' } },
      'application/json',
      'credentials-rejected',
    ],
    [
      'missing authorization',
      { credentials: 'include' },
      'application/json',
      'authorization-absent',
    ],
    [
      'a non-JSON source response',
      { credentials: 'include', headers: { authorization: 'synthetic-sentinel' } },
      'text/plain',
      'source-non-json',
    ],
  ] as const)(
    'stops before replay for %s',
    async (_label, requestInit, contentType, expectedCode) => {
      const sourceUrl =
        `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
        '?include_has_versions=true&num_turns=10';
      const page = fakePage(
        `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
        async () => new Response('{}', { headers: { 'content-type': contentType } }),
        OpaqueTestRequest
      );
      const request = new OpaqueTestRequest(sourceUrl, requestInit) as unknown as Request;
      startChatGptDocumentStartCapture(page.pageWindow);

      await page.pageWindow.fetch(request);

      await vi.waitFor(() =>
        expect(opaqueReplaySnapshotOf(page)).toEqual({
          kind: 'error',
          code: expectedCode,
          singularDispatchCount: 0,
        })
      );
      expect(page.originalFetch).toHaveBeenCalledOnce();
    }
  );

  it('stops after a rejected source request without singular replay', async () => {
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      async () => Promise.reject(new Error('synthetic source rejection')),
      OpaqueTestRequest
    );
    const request = new OpaqueTestRequest(sourceUrl, {
      credentials: 'include',
      headers: { authorization: 'synthetic-sentinel' },
    }) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await expect(page.pageWindow.fetch(request)).rejects.toThrow('synthetic source rejection');

    await vi.waitFor(() =>
      expect(opaqueReplaySnapshotOf(page)).toEqual({
        kind: 'error',
        code: 'source-rejected',
        singularDispatchCount: 0,
      })
    );
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('fails replay preparation closed when the cloned Headers brand is invalid', async () => {
    class InvalidReplayHeadersRequest extends OpaqueTestRequest {
      get url(): string {
        return super.url;
      }
      get method(): string {
        return super.method;
      }
      get credentials(): RequestCredentials {
        return super.credentials;
      }
      get headers(): Headers {
        return {} as Headers;
      }
      clone(): InvalidReplayHeadersRequest {
        return new InvalidReplayHeadersRequest(super.url, {
          credentials: super.credentials,
          headers: { authorization: 'synthetic-sentinel' },
        });
      }
    }
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
      InvalidReplayHeadersRequest
    );
    const request = new InvalidReplayHeadersRequest(sourceUrl, {
      credentials: 'include',
      headers: { authorization: 'synthetic-sentinel' },
    }) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await page.pageWindow.fetch(request);

    expect(opaqueReplaySnapshotOf(page)).toEqual({
      kind: 'error',
      code: 'clone-failed',
      singularDispatchCount: 0,
    });
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('collects only exact page-owned resolver responses during the opt-in discovery window', async () => {
    vi.useFakeTimers();
    const resolverDownloadUrl =
      `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
      `&id=${RESOLVER_FILE_ID}&p=path&sig=signature&ts=123&v=1`;
    const resolverBody = JSON.stringify({ download_url: resolverDownloadUrl });
    const clone = vi.spyOn(Response.prototype, 'clone');
    const { response: conversationResponse } = responseWithCloneSpy(new Uint8Array([1]));
    const { response: resolverResponse } = responseWithCloneSpy(
      new TextEncoder().encode(resolverBody)
    );
    const page = fakePage(markedUrl(`/c/${CONVERSATION_ID}`, true), async input => {
      if (input === ENDPOINT) return conversationResponse;
      if (input === RESOLVER_ENDPOINT) return resolverResponse;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    page.pageWindow.crypto = {
      subtle: { digest: async () => new Uint8Array(32).buffer },
    } as unknown as Crypto;

    startChatGptDocumentStartCapture(page.pageWindow);
    await page.pageWindow.fetch(ENDPOINT);
    // The page can begin resolving attachments while our conversation clone
    // is still being consumed. This first resolver must not be missed.
    await page.pageWindow.fetch(RESOLVER_ENDPOINT);
    await vi.advanceTimersByTimeAsync(1);
    expect(snapshotOf(page)).toEqual({ kind: 'ready' });

    await page.pageWindow.fetch(
      `/backend-api/files/download/${RESOLVER_FILE_ID}?conversation_id=${OTHER_CONVERSATION_ID}&inline=true`
    );
    for (let index = 0; index < 32; index += 1) {
      await page.pageWindow.fetch(RESOLVER_ENDPOINT);
    }
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(clone).toHaveBeenCalledTimes(33);
    const snapshot = snapshotOf(page) as {
      kind?: string;
      conversationId?: string;
      resolverObservations?: unknown[];
    };
    expect(snapshot).toMatchObject({
      kind: 'captured',
      conversationId: CONVERSATION_ID,
    });
    expect(snapshot.resolverObservations).toHaveLength(32);
    expect(snapshot.resolverObservations?.[0]).toMatchObject({
      providerFileId: RESOLVER_FILE_ID,
      bodyBase64: btoa(resolverBody),
      byteLength: new TextEncoder().encode(resolverBody).byteLength,
      mediaType: 'application/json; charset=utf-8',
    });
  });

  it('accepts only the bounded legacy, scoped, and Calpico resolver route grammars', async () => {
    vi.useFakeTimers();
    const scopedQueries = [
      `conversation_id=${CONVERSATION_ID}&inline=true&check_context_scopes_for_conversation_id=${CONVERSATION_ID}`,
      `conversation_id=${CONVERSATION_ID}&check_context_scopes_for_conversation_id=${CONVERSATION_ID}&inline=true`,
      `inline=true&conversation_id=${CONVERSATION_ID}&check_context_scopes_for_conversation_id=${CONVERSATION_ID}`,
      `inline=true&check_context_scopes_for_conversation_id=${CONVERSATION_ID}&conversation_id=${CONVERSATION_ID}`,
      `check_context_scopes_for_conversation_id=${CONVERSATION_ID}&conversation_id=${CONVERSATION_ID}&inline=true`,
      `check_context_scopes_for_conversation_id=${CONVERSATION_ID}&inline=true&conversation_id=${CONVERSATION_ID}`,
    ];
    const accepted = [
      `/backend-api/files/download/file-legacy-inline-first?inline=true&conversation_id=${CONVERSATION_ID}`,
      `/backend-api/files/download/file-legacy-conversation-first?conversation_id=${CONVERSATION_ID}&inline=true`,
      ...scopedQueries.map(
        (query, index) => `/backend-api/files/download/file-scoped-${index}?${query}`
      ),
      '/backend-api/calpico/chatgpt/files/file-calpico',
    ];
    const rejected = [
      `/backend-api/files/download/file-scoped-mismatched?conversation_id=${CONVERSATION_ID}&inline=true&check_context_scopes_for_conversation_id=${OTHER_CONVERSATION_ID}`,
      `/backend-api/files/download/file-scoped-missing-inline?conversation_id=${CONVERSATION_ID}&check_context_scopes_for_conversation_id=${CONVERSATION_ID}`,
      `/backend-api/files/download/file-scoped-missing-conversation?inline=true&check_context_scopes_for_conversation_id=${CONVERSATION_ID}`,
      `/backend-api/files/download/file-scoped-duplicate?conversation_id=${CONVERSATION_ID}&inline=true&check_context_scopes_for_conversation_id=${CONVERSATION_ID}&inline=true`,
      `/backend-api/files/download/file-scoped-extra?conversation_id=${CONVERSATION_ID}&inline=true&check_context_scopes_for_conversation_id=${CONVERSATION_ID}&pointer=raw`,
      `/backend-api/files/download/file-download-intent?conversation_id=${CONVERSATION_ID}&inline=true&download_intent=download`,
      `/backend-api/files/download/file-gizmo?conversation_id=${CONVERSATION_ID}&inline=true&gizmo_id=gizmo`,
      `/backend-api/files/download/file-post?conversation_id=${CONVERSATION_ID}&inline=true&post_id=post`,
      `/backend-api/files/download/file-encoded?inline=true&conversation_id=%3001234567-89ab-4cde-8f01-23456789abcd`,
      `/backend-api/files/download/file-fragment?inline=true&conversation_id=${CONVERSATION_ID}#fragment`,
      '/backend-api/calpico/chatgpt/files/file-calpico?inline=true',
      '/backend-api/calpico/chatgpt/files/file-calpico#fragment',
      '/backend-api/calpico/chatgpt/files/file-calpico/extra',
      `/backend-api/calpico/chatgpt/files/file%2Funsafe`,
    ];
    const clone = vi.spyOn(Response.prototype, 'clone');
    const { response: conversationResponse } = responseWithCloneSpy(new Uint8Array([1]));
    const resolverResponse = new Response(
      JSON.stringify({ download_url: 'safe-raw-observation' }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );
    const page = fakePage(markedUrl(`/c/${CONVERSATION_ID}`, true), async input =>
      input === ENDPOINT ? conversationResponse : resolverResponse
    );
    page.pageWindow.crypto = {
      subtle: { digest: async () => new Uint8Array(32).buffer },
    } as unknown as Crypto;

    startChatGptDocumentStartCapture(page.pageWindow);
    await page.pageWindow.fetch(ENDPOINT);
    for (let index = 0; index < accepted.length; index += 1) {
      await page.pageWindow.fetch(accepted[index]);
    }
    for (let index = 0; index < rejected.length; index += 1) {
      await page.pageWindow.fetch(rejected[index]);
    }
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);

    const snapshot = snapshotOf(page) as {
      resolverObservations: Array<{ providerFileId: string }>;
    };
    const expectedFileIds = [
      'file-legacy-inline-first',
      'file-legacy-conversation-first',
      ...scopedQueries.map((_, index) => `file-scoped-${index}`),
      'file-calpico',
    ];
    expect(snapshot.resolverObservations).toHaveLength(expectedFileIds.length);
    expect(new Set(snapshot.resolverObservations.map(value => value.providerFileId))).toEqual(
      new Set(expectedFileIds)
    );
    expect(clone).toHaveBeenCalledTimes(1 + expectedFileIds.length);
  });

  it('does not extend the two-second resolver window while a large capture is still hashing', async () => {
    vi.useFakeTimers();
    let releaseDigest: ((value: ArrayBuffer) => void) | undefined;
    const digest = new Promise<ArrayBuffer>(resolve => {
      releaseDigest = resolve;
    });
    const clone = vi.spyOn(Response.prototype, 'clone');
    const { response: conversationResponse } = responseWithCloneSpy(new Uint8Array([1]));
    const resolverResponse = new Response(JSON.stringify({ download_url: 'ignored' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const page = fakePage(markedUrl(`/c/${CONVERSATION_ID}`, true), async input =>
      input === ENDPOINT ? conversationResponse : resolverResponse
    );
    page.pageWindow.crypto = {
      subtle: { digest: () => digest },
    } as unknown as Crypto;

    startChatGptDocumentStartCapture(page.pageWindow);
    await page.pageWindow.fetch(ENDPOINT);
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshotOf(page)).toEqual({ kind: 'ready' });

    await vi.advanceTimersByTimeAsync(2_000);
    await page.pageWindow.fetch(RESOLVER_ENDPOINT);
    releaseDigest?.(new Uint8Array(32).buffer);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(snapshotOf(page)).toMatchObject({
      kind: 'captured',
      conversationId: CONVERSATION_ID,
      resolverObservations: [],
    });
    expect(clone).toHaveBeenCalledTimes(1);
  });

  it('keeps the verified conversation when the optional resolver timer cannot be armed', async () => {
    const { response } = responseWithCloneSpy(new Uint8Array([1]));
    const page = fakePage(markedUrl(`/c/${CONVERSATION_ID}`, true), async () => response);
    const nativeSetTimeout = page.pageWindow.setTimeout.bind(page.pageWindow);
    let timerCalls = 0;
    page.pageWindow.setTimeout = ((callback: TimerHandler, timeout?: number) => {
      timerCalls += 1;
      if (timerCalls === 2) throw new Error('optional timer unavailable');
      return nativeSetTimeout(callback, timeout);
    }) as typeof page.pageWindow.setTimeout;

    startChatGptDocumentStartCapture(page.pageWindow);
    await page.pageWindow.fetch(ENDPOINT);

    await vi.waitFor(() =>
      expect(snapshotOf(page)).toMatchObject({
        kind: 'captured',
        conversationId: CONVERSATION_ID,
        resolverObservations: [],
      })
    );
  });

  it('does not inspect request or init headers while matching a native Request', async () => {
    const { response } = responseWithCloneSpy(new Uint8Array([1]));
    const page = fakePage(markedUrl(), async () => response);
    const request = new TestRequest(`https://chatgpt.com${ENDPOINT}`, {
      method: 'GET',
    }) as unknown as Request;
    Object.defineProperty(request, 'headers', {
      configurable: true,
      get() {
        throw new Error('headers must not be read');
      },
    });
    const init = { method: 'GET' } as RequestInit;
    Object.defineProperty(init, 'headers', {
      configurable: true,
      get() {
        throw new Error('init headers must not be read');
      },
    });

    startChatGptDocumentStartCapture(page.pageWindow);
    await expect(page.pageWindow.fetch(request, init)).resolves.toBe(response);
    await vi.waitFor(() => expect(snapshotOf(page)).toMatchObject({ kind: 'captured' }));
  });

  it('keeps capture control state private despite page snapshot and property tampering', async () => {
    const bytes = new Uint8Array([0, 255, 1, 128, 42]);
    const { response } = responseWithCloneSpy(bytes);
    const page = fakePage(markedUrl(), async () => response);

    startChatGptDocumentStartCapture(page.pageWindow);
    await page.pageWindow.fetch(ENDPOINT);
    await vi.waitFor(() => expect(snapshotOf(page)).toMatchObject({ kind: 'captured' }));

    const first = snapshotOf(page) as {
      kind: string;
      capture?: { bodyBase64: string; sha256: string };
    };
    first.kind = 'error';
    if (first.capture !== undefined) {
      first.capture.bodyBase64 = 'forged';
      first.capture.sha256 = '0'.repeat(64);
    }
    expect(Reflect.set(page.pageWindow, STATE_KEY, { kind: 'error', code: 'request-failed' })).toBe(
      false
    );
    expect(Reflect.deleteProperty(page.pageWindow, STATE_KEY)).toBe(false);
    expect(() =>
      Object.defineProperty(page.pageWindow, STATE_KEY, {
        value: { kind: 'error', code: 'request-failed' },
      })
    ).toThrow();
    Object.setPrototypeOf(page.pageWindow, {
      [STATE_KEY]: { kind: 'error', code: 'request-failed' },
    });

    const expected = {
      kind: 'captured',
      conversationId: CONVERSATION_ID,
      capture: {
        bodyBase64: 'AP8BgCo=',
        byteLength: 5,
        sha256: CAPTURE_HASH,
        mediaType: 'application/json; charset=utf-8',
      },
      resolverObservations: [],
    };
    const second = snapshotOf(page);
    expect(second).not.toBe(first);
    expect(second).toEqual(expected);
    vi.stubGlobal('window', page.pageWindow);
    expect(readChatGptTemporaryCaptureState(NONCE)).toEqual(expected);
  });

  it('uses document-start primordials after page globals are replaced', async () => {
    const { response } = responseWithCloneSpy(new Uint8Array([0, 255, 1, 128, 42]));
    const page = fakePage(markedUrl(), async () => response);

    startChatGptDocumentStartCapture(page.pageWindow);
    Object.assign(page.pageWindow, {
      Reflect: {
        apply: () => {
          throw new Error('poisoned Reflect.apply');
        },
      },
      Object: {
        defineProperty: () => {
          throw new Error('poisoned Object');
        },
      },
      URL: class PoisonedURL {},
      Request: class PoisonedRequest {},
      Response: class PoisonedResponse {},
      Headers: class PoisonedHeaders {},
      ReadableStream: class PoisonedStream {},
      ReadableStreamDefaultReader: class PoisonedReader {},
      Promise: class PoisonedPromise {},
      Array: class PoisonedArray {},
      Uint8Array: class PoisonedBytes {},
      ArrayBuffer: class PoisonedBuffer {},
      String: class PoisonedString {},
      btoa: () => {
        throw new Error('poisoned btoa');
      },
      crypto: { subtle: { digest: () => Promise.reject(new Error('poisoned digest')) } },
      setTimeout: () => {
        throw new Error('poisoned setTimeout');
      },
      clearTimeout: () => {
        throw new Error('poisoned clearTimeout');
      },
    });

    await expect(page.pageWindow.fetch(ENDPOINT)).resolves.toBe(response);
    await vi.waitFor(() =>
      expect(snapshotOf(page)).toEqual({
        kind: 'captured',
        conversationId: CONVERSATION_ID,
        capture: {
          bodyBase64: 'AP8BgCo=',
          byteLength: 5,
          sha256: CAPTURE_HASH,
          mediaType: 'application/json; charset=utf-8',
        },
        resolverObservations: [],
      })
    );
  });

  it('leaves unrelated and later matching page requests untouched', async () => {
    let matchingCalls = 0;
    const laterResponse = responseWithCloneSpy(new Uint8Array([2]));
    const page = fakePage(markedUrl(), async (input, init) => {
      if (input === ENDPOINT && init?.method !== 'POST') {
        matchingCalls += 1;
        if (matchingCalls === 1) return new Promise<Response>(() => undefined);
      }
      return laterResponse.response;
    });

    startChatGptDocumentStartCapture(page.pageWindow);
    await expect(
      page.pageWindow.fetch(`/backend-api/conversation/${OTHER_CONVERSATION_ID}`)
    ).resolves.toBe(laterResponse.response);
    await expect(page.pageWindow.fetch(`${ENDPOINT}?share=1`)).resolves.toBe(
      laterResponse.response
    );
    await expect(page.pageWindow.fetch(ENDPOINT, { method: 'POST' })).resolves.toBe(
      laterResponse.response
    );
    void page.pageWindow.fetch(ENDPOINT);
    await expect(page.pageWindow.fetch(ENDPOINT)).resolves.toBe(laterResponse.response);

    expect(matchingCalls).toBe(2);
    expect(laterResponse.clone).not.toHaveBeenCalled();
    expect(snapshotOf(page)).toEqual({ kind: 'ready' });
  });

  it('clones only the matching response and cancels its clone stream over the 16 MiB cap', async () => {
    const maxBytes = 16 * 1024 * 1024;
    let pullCount = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        controller.enqueue(pullCount === 1 ? new Uint8Array(maxBytes) : new Uint8Array([1]));
        if (pullCount === 2) controller.close();
      },
    });
    const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel');
    const response = new Response(stream, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const page = fakePage(markedUrl(), async () => response);

    startChatGptDocumentStartCapture(page.pageWindow);
    await expect(page.pageWindow.fetch(ENDPOINT)).resolves.toBe(response);
    await vi.waitFor(() =>
      expect(snapshotOf(page)).toEqual({ kind: 'error', code: 'payload-too-large' })
    );

    expect(response.body?.locked).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('captures a streamless empty JSON response with its exact digest', async () => {
    const response = new Response(null, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const page = fakePage(markedUrl(), async () => response);

    startChatGptDocumentStartCapture(page.pageWindow);
    await expect(page.pageWindow.fetch(ENDPOINT)).resolves.toBe(response);
    await vi.waitFor(() =>
      expect(snapshotOf(page)).toEqual({
        kind: 'captured',
        conversationId: CONVERSATION_ID,
        capture: {
          bodyBase64: '',
          byteLength: 0,
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          mediaType: 'application/json',
        },
        resolverObservations: [],
      })
    );
  });

  it.each([
    [
      'HTTP status',
      async () =>
        new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } }),
      'response-http-error',
    ],
    [
      'response media type',
      async () => new Response('{}', { status: 200, headers: { 'content-type': 'text/plain' } }),
      'response-media-type-invalid',
    ],
    [
      'request rejection',
      async () => Promise.reject(new Error('network rejected')),
      'request-failed',
    ],
  ])('records the stable %s error stage', async (_label, fetchImplementation, code) => {
    const page = fakePage(markedUrl(), fetchImplementation);

    startChatGptDocumentStartCapture(page.pageWindow);
    await page.pageWindow.fetch(ENDPOINT).catch(() => undefined);
    await vi.waitFor(() => expect(snapshotOf(page)).toEqual({ kind: 'error', code }));
    expect(page.pageWindow.fetch).toBe(page.originalFetch);
  });

  it('records a processing error when cloning or hashing the native response fails', async () => {
    const cloningFailure = {
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      clone: vi.fn(() => {
        throw new Error('clone failed');
      }),
    } as unknown as Response;
    const clonePage = fakePage(markedUrl(), async () => cloningFailure);

    startChatGptDocumentStartCapture(clonePage.pageWindow);
    await clonePage.pageWindow.fetch(ENDPOINT);
    await vi.waitFor(() =>
      expect(snapshotOf(clonePage)).toEqual({
        kind: 'error',
        code: 'response-processing-failed',
      })
    );

    const { response } = responseWithCloneSpy(new Uint8Array([3]));
    const digestPage = fakePage(markedUrl(), async () => response);
    digestPage.pageWindow.crypto = {
      subtle: { digest: vi.fn().mockRejectedValue(new Error('digest failed')) },
    } as unknown as Crypto;

    startChatGptDocumentStartCapture(digestPage.pageWindow);
    await digestPage.pageWindow.fetch(ENDPOINT);
    await vi.waitFor(() =>
      expect(snapshotOf(digestPage)).toEqual({
        kind: 'error',
        code: 'response-processing-failed',
      })
    );
  });

  it('times out, restores only its own wrapper, and preserves a later page wrapper', async () => {
    vi.useFakeTimers();
    const page = fakePage(markedUrl());

    startChatGptDocumentStartCapture(page.pageWindow);
    const captureWrapper = page.pageWindow.fetch;
    expect(captureWrapper).not.toBe(page.originalFetch);
    const laterWrapper = vi.fn();
    page.pageWindow.fetch = laterWrapper as unknown as typeof page.pageWindow.fetch;

    await vi.advanceTimersByTimeAsync(180_000);

    expect(snapshotOf(page)).toEqual({ kind: 'error', code: 'conversation-request-timeout' });
    expect(page.pageWindow.fetch).toBe(laterWrapper);
    expect(captureWrapper).not.toBe(laterWrapper);
  });

  it('distinguishes a claimed request whose response never settles', async () => {
    vi.useFakeTimers();
    const page = fakePage(markedUrl(), () => new Promise<Response>(() => undefined));

    startChatGptDocumentStartCapture(page.pageWindow);
    void page.pageWindow.fetch(ENDPOINT);
    await vi.advanceTimersByTimeAsync(180_000);

    expect(snapshotOf(page)).toEqual({ kind: 'error', code: 'conversation-response-timeout' });
  });

  it('reports state initialization failure without issuing a request', () => {
    const page = fakePage(markedUrl());
    Object.preventExtensions(page.pageWindow);

    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });
    expect(page.originalFetch).not.toHaveBeenCalled();
  });

  it('fails closed for a throwing fetch getter and duplicate arming', () => {
    const inaccessibleFetch = fakePage(markedUrl());
    Object.defineProperty(inaccessibleFetch.pageWindow, 'fetch', {
      configurable: true,
      get() {
        throw new Error('fetch unavailable');
      },
    });
    expect(startChatGptDocumentStartCapture(inaccessibleFetch.pageWindow)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });

    const duplicate = fakePage(markedUrl());
    expect(startChatGptDocumentStartCapture(duplicate.pageWindow)).toEqual({ kind: 'ready' });
    expect(startChatGptDocumentStartCapture(duplicate.pageWindow)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });
  });

  it('preserves a synchronous native fetch throw and records request failure', () => {
    const page = fakePage(markedUrl());
    page.originalFetch.mockImplementation(() => {
      throw new Error('synchronous request failure');
    });

    startChatGptDocumentStartCapture(page.pageWindow);
    expect(() => page.pageWindow.fetch(ENDPOINT)).toThrow('synchronous request failure');
    expect(snapshotOf(page)).toEqual({ kind: 'error', code: 'request-failed' });
  });

  it('fails closed when document-start primordials cannot be captured', () => {
    const cryptoFailure = fakePage(markedUrl());
    Object.defineProperty(cryptoFailure.pageWindow, 'crypto', {
      configurable: true,
      get() {
        throw new Error('crypto unavailable');
      },
    });
    expect(startChatGptDocumentStartCapture(cryptoFailure.pageWindow)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });

    const missingReflect = fakePage(markedUrl());
    missingReflect.pageWindow.Reflect = {} as typeof Reflect;
    expect(startChatGptDocumentStartCapture(missingReflect.pageWindow)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });

    const descriptorFailure = fakePage(markedUrl());
    descriptorFailure.pageWindow.Object = {
      defineProperty: Object.defineProperty,
      getOwnPropertyDescriptor() {
        throw new Error('descriptor unavailable');
      },
    } as typeof Object;
    expect(startChatGptDocumentStartCapture(descriptorFailure.pageWindow)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });

    const methodFailure = fakePage(markedUrl());
    class ResponseWithPoisonedMethod {}
    Object.defineProperty(ResponseWithPoisonedMethod.prototype, 'clone', {
      get() {
        throw new Error('method unavailable');
      },
    });
    methodFailure.pageWindow.Response = ResponseWithPoisonedMethod as unknown as typeof Response;
    expect(startChatGptDocumentStartCapture(methodFailure.pageWindow)).toEqual({ kind: 'ready' });
  });

  it('ignores request lookalikes that fail native URL and Request brand checks', async () => {
    const response = new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const page = fakePage(markedUrl(), async () => response);

    startChatGptDocumentStartCapture(page.pageWindow);
    await expect(page.pageWindow.fetch(Symbol('not a request') as never)).resolves.toBe(response);
    expect(snapshotOf(page)).toEqual({ kind: 'ready' });
  });

  it('records state failure when the page rejects fetch replacement', () => {
    const page = fakePage(markedUrl());
    const originalFetch = page.pageWindow.fetch;
    Object.defineProperty(page.pageWindow, 'fetch', {
      configurable: true,
      get: () => originalFetch,
      set() {
        throw new Error('fetch is read-only');
      },
    });

    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    expect(snapshotOf(page)).toEqual({ kind: 'error', code: 'hook-state-failed' });
  });

  it('records processing failure when the captured Promise.then cannot observe the response', async () => {
    const response = new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const page = fakePage(markedUrl(), async () => response);
    class ThrowingPromise {
      then(): never {
        throw new Error('then unavailable');
      }
    }
    page.pageWindow.Promise = ThrowingPromise as unknown as PromiseConstructor;

    startChatGptDocumentStartCapture(page.pageWindow);
    await expect(page.pageWindow.fetch(ENDPOINT)).resolves.toBe(response);
    expect(snapshotOf(page)).toEqual({
      kind: 'error',
      code: 'response-processing-failed',
    });
  });

  it('runs the opaque probe only for a branded plural Request and keeps response metadata secret-free', async () => {
    const secret = 'synthetic-authorization-sentinel';
    const response = new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
    const originalPromise = Promise.resolve(response);
    const page = fakePage(markedOpaqueProbeUrl(), () => originalPromise, OpaqueTestRequest);
    const request = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: secret } }
    ) as unknown as Request;

    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    const originalGet = Headers.prototype.get;
    const originalEntries = Headers.prototype.entries;
    const originalForEach = Headers.prototype.forEach;
    const originalIterator = Headers.prototype[Symbol.iterator];
    const poisoned = vi.fn(() => {
      throw new Error('poisoned header method');
    });
    Object.defineProperties(Headers.prototype, {
      get: { configurable: true, value: poisoned },
      entries: { configurable: true, value: poisoned },
      forEach: { configurable: true, value: poisoned },
      [Symbol.iterator]: { configurable: true, value: poisoned },
    });
    try {
      const pagePromise = page.pageWindow.fetch(request);
      expect(pagePromise).toBe(originalPromise);
      await expect(pagePromise).resolves.toBe(response);
      await vi.waitFor(() =>
        expect(opaqueSnapshotOf(page)).toEqual({
          kind: 'result',
          result: {
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
          },
        })
      );
      expect(page.originalFetch).toHaveBeenCalledOnce();
      expect(poisoned).not.toHaveBeenCalled();
      expect(JSON.stringify(opaqueSnapshotOf(page))).not.toContain(secret);
      vi.stubGlobal('window', page.pageWindow);
      expect(readChatGptOpaqueProbeState(NONCE)).toEqual(opaqueSnapshotOf(page));
    } finally {
      Object.defineProperties(Headers.prototype, {
        get: { configurable: true, value: originalGet },
        entries: { configurable: true, value: originalEntries },
        forEach: { configurable: true, value: originalForEach },
        [Symbol.iterator]: { configurable: true, value: originalIterator },
      });
    }
  });

  it('uses the captured Request clone brand check without consulting Symbol.hasInstance', async () => {
    const response = new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const page = fakePage(markedOpaqueProbeUrl(), async () => response, OpaqueTestRequest);
    const request = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-sentinel' } }
    ) as unknown as Request;
    const ownHasInstance = Object.getOwnPropertyDescriptor(OpaqueTestRequest, Symbol.hasInstance);
    Object.defineProperty(OpaqueTestRequest, Symbol.hasInstance, {
      configurable: true,
      value: () => {
        throw new Error('Symbol.hasInstance must stay unused');
      },
    });
    try {
      startChatGptDocumentStartCapture(page.pageWindow);
      await page.pageWindow.fetch(request);
      await vi.waitFor(() =>
        expect(opaqueSnapshotOf(page)).toMatchObject({
          kind: 'result',
          result: { sourceIsNativeRequest: true, outcome: 'eligible', singularDispatchCount: 0 },
        })
      );
    } finally {
      if (ownHasInstance === undefined) {
        delete (OpaqueTestRequest as unknown as Record<PropertyKey, unknown>)[Symbol.hasInstance];
      } else Object.defineProperty(OpaqueTestRequest, Symbol.hasInstance, ownHasInstance);
    }
  });

  it.each([
    [
      'a matching string URL',
      () =>
        `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      undefined,
      'source-not-native-request',
    ],
    [
      'a branded Request with explicit undefined init',
      () =>
        new OpaqueTestRequest(
          `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
          { credentials: 'include', headers: { authorization: 'synthetic-sentinel' } }
        ) as unknown as Request,
      undefined,
      'eligible-init-empty',
    ],
    [
      'a malformed raw query',
      () =>
        new OpaqueTestRequest(
          `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10&extra=1`,
          { credentials: 'include', headers: { authorization: 'synthetic-sentinel' } }
        ) as unknown as Request,
      null,
      'target-mismatch',
    ],
    [
      'a URL with userinfo',
      () =>
        new OpaqueTestRequest(
          `https://user@chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
          { credentials: 'include', headers: { authorization: 'synthetic-sentinel' } }
        ) as unknown as Request,
      null,
      'target-mismatch',
    ],
    [
      'a URL with a fragment',
      () =>
        new OpaqueTestRequest(
          `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10#fragment`,
          { credentials: 'include', headers: { authorization: 'synthetic-sentinel' } }
        ) as unknown as Request,
      null,
      'target-mismatch',
    ],
  ])('claims one safe opaque result for %s', async (_label, makeInput, explicitInit, outcome) => {
    const response = new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const page = fakePage(markedOpaqueProbeUrl(), async () => response, OpaqueTestRequest);
    startChatGptDocumentStartCapture(page.pageWindow);
    const input = makeInput();
    if (explicitInit === undefined && outcome === 'eligible-init-empty') {
      await page.pageWindow.fetch(input, undefined);
    } else {
      await page.pageWindow.fetch(input);
    }
    expect(opaqueSnapshotOf(page)).toMatchObject({
      kind: 'result',
      result: { outcome, singularDispatchCount: 0 },
    });
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'cross-origin URL',
      `https://example.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      'GET',
    ],
    [
      'extra raw query',
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10&extra=1`,
      'GET',
    ],
    [
      'fragment',
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10#fragment`,
      'GET',
    ],
    [
      'POST method',
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      'POST',
    ],
  ])('rejects %s before Request.clone can tee a body', async (_label, url, method) => {
    const clone = vi.spyOn(OpaqueTestRequest.prototype, 'clone');
    try {
      const response = new Response('{}');
      const page = fakePage(markedOpaqueProbeUrl(), async () => response, OpaqueTestRequest);
      const request = new OpaqueTestRequest(url, {
        method,
        credentials: 'include',
        headers: { authorization: 'synthetic-sentinel' },
      }) as unknown as Request;
      startChatGptDocumentStartCapture(page.pageWindow);

      await expect(page.pageWindow.fetch(request)).resolves.toBe(response);

      expect(opaqueSnapshotOf(page)).toMatchObject({
        kind: 'result',
        result: { outcome: 'target-mismatch', singularDispatchCount: 0 },
      });
      expect(clone).not.toHaveBeenCalled();
      expect(page.originalFetch).toHaveBeenCalledOnce();
    } finally {
      clone.mockRestore();
    }
  });

  it.each([
    ['an empty object', {}, 'eligible-init-empty'],
    ['a signal-only object', { signal: new AbortController().signal }, 'eligible-init-signal-only'],
    ['a header-bearing object', { headers: {} }, 'init-security-sensitive'],
    ['a credential-bearing object', { credentials: 'include' }, 'init-security-sensitive'],
    ['an otherwise non-empty object', { cache: 'no-store' }, 'init-unsupported'],
  ] as const)('classifies %s without reading RequestInit values', async (_label, init, outcome) => {
    const response = new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const page = fakePage(markedOpaqueProbeUrl(), async () => response, OpaqueTestRequest);
    const request = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-sentinel' } }
    ) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await page.pageWindow.fetch(request, init as RequestInit);

    await vi.waitFor(() =>
      expect(opaqueSnapshotOf(page)).toMatchObject({
        kind: 'result',
        result: { outcome, singularDispatchCount: 0 },
      })
    );
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('fails a getter-bearing RequestInit closed without reading the getter value', async () => {
    const page = fakePage(
      markedOpaqueProbeUrl(),
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    const request = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-sentinel' } }
    ) as unknown as Request;
    const getter = vi.fn(() => {
      throw new Error('RequestInit value must stay unread');
    });
    const init = {};
    Object.defineProperty(init, 'headers', { configurable: true, get: getter });
    startChatGptDocumentStartCapture(page.pageWindow);

    await page.pageWindow.fetch(request, init);

    expect(opaqueSnapshotOf(page)).toMatchObject({
      kind: 'result',
      result: { outcome: 'init-security-sensitive', singularDispatchCount: 0 },
    });
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects inherited RequestInit members after Object.prototype pollution', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'headers');
    Object.defineProperty(Object.prototype, 'headers', {
      configurable: true,
      enumerable: false,
      value: { authorization: 'must-stay-unread' },
    });
    try {
      const page = fakePage(
        markedOpaqueProbeUrl(),
        async () => new Response('{}'),
        OpaqueTestRequest
      );
      const request = new OpaqueTestRequest(
        `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
        { credentials: 'include', headers: { authorization: 'synthetic-sentinel' } }
      ) as unknown as Request;
      startChatGptDocumentStartCapture(page.pageWindow);

      await page.pageWindow.fetch(request, {});

      expect(opaqueSnapshotOf(page)).toMatchObject({
        kind: 'result',
        result: { outcome: 'init-unsupported', singularDispatchCount: 0 },
      });
      expect(page.originalFetch).toHaveBeenCalledOnce();
    } finally {
      if (originalDescriptor === undefined) delete Object.prototype.headers;
      else Object.defineProperty(Object.prototype, 'headers', originalDescriptor);
    }
  });

  it('contains a throwing RequestInit Proxy and still calls the original page fetch once', async () => {
    const page = fakePage(
      markedOpaqueProbeUrl(),
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    const request = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-sentinel' } }
    ) as unknown as Request;
    const getPrototypeOf = vi.fn(() => {
      throw new Error('synthetic Proxy trap');
    });
    const init = new Proxy({}, { getPrototypeOf });
    startChatGptDocumentStartCapture(page.pageWindow);

    await expect(page.pageWindow.fetch(request, init)).resolves.toBeInstanceOf(Response);

    expect(opaqueSnapshotOf(page)).toMatchObject({
      kind: 'result',
      result: { outcome: 'init-unsupported', singularDispatchCount: 0 },
    });
    expect(getPrototypeOf).toHaveBeenCalledOnce();
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('refuses to arm when a required URL getter is unavailable', () => {
    class IncompleteURL extends NodeURL {}
    const page = fakePage(
      markedOpaqueProbeUrl(),
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    page.pageWindow.URL = IncompleteURL as unknown as typeof URL;

    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });
    expect(page.pageWindow.fetch).toBe(page.originalFetch);
  });

  it('keeps original page fetch behavior when a captured URL getter throws', async () => {
    class ThrowingPathURL extends NodeURL {}
    for (const property of [
      'href',
      'origin',
      'username',
      'password',
      'pathname',
      'search',
      'hash',
    ]) {
      const descriptor = Object.getOwnPropertyDescriptor(NodeURL.prototype, property);
      if (descriptor !== undefined) {
        Object.defineProperty(ThrowingPathURL.prototype, property, descriptor);
      }
    }
    Object.defineProperty(ThrowingPathURL.prototype, 'pathname', {
      configurable: true,
      get: () => {
        throw new Error('synthetic URL getter failure');
      },
    });
    const response = new Response('{}');
    const page = fakePage(markedOpaqueProbeUrl(), async () => response, OpaqueTestRequest);
    page.pageWindow.URL = ThrowingPathURL as unknown as typeof URL;
    const request = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-sentinel' } }
    ) as unknown as Request;

    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    await expect(page.pageWindow.fetch(request)).resolves.toBe(response);

    expect(opaqueSnapshotOf(page)).toEqual({ kind: 'ready' });
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('ignores a plural request for a different conversation until the bounded timeout', async () => {
    vi.useFakeTimers();
    const response = new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const page = fakePage(markedOpaqueProbeUrl(), async () => response, OpaqueTestRequest);
    const request = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${OTHER_CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-sentinel' } }
    ) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await page.pageWindow.fetch(request);
    expect(opaqueSnapshotOf(page)).toEqual({ kind: 'ready' });
    await vi.advanceTimersByTimeAsync(45_000);

    expect(opaqueSnapshotOf(page)).toMatchObject({
      kind: 'result',
      result: { outcome: 'target-not-observed', singularDispatchCount: 0 },
    });
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('reports target-not-observed without a synthetic singular request', async () => {
    vi.useFakeTimers();
    const page = fakePage(
      markedOpaqueProbeUrl(),
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    startChatGptDocumentStartCapture(page.pageWindow);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(opaqueSnapshotOf(page)).toEqual({
      kind: 'result',
      result: {
        observedTargetRequest: false,
        sourceIsNativeRequest: false,
        initAbsent: false,
        exactTarget: false,
        authorizationPresent: false,
        credentialsAccepted: false,
        sourceStatus: null,
        sourceJson: false,
        singularDispatchCount: 0,
        outcome: 'target-not-observed',
      },
    });
    expect(page.originalFetch).not.toHaveBeenCalled();
  });

  it('does not overwrite a later page-owned fetch wrapper during opaque-probe cleanup', async () => {
    vi.useFakeTimers();
    const page = fakePage(
      markedOpaqueProbeUrl(),
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    startChatGptDocumentStartCapture(page.pageWindow);
    const laterWrapper = vi.fn(page.originalFetch);
    page.pageWindow.fetch = laterWrapper;

    await vi.advanceTimersByTimeAsync(45_000);

    expect(opaqueSnapshotOf(page)).toMatchObject({
      kind: 'result',
      result: { outcome: 'target-not-observed', singularDispatchCount: 0 },
    });
    expect(page.pageWindow.fetch).toBe(laterWrapper);
  });

  it('observes only bounded resolver clones after an exact page-owned plural source without reading its body', async () => {
    vi.useFakeTimers();
    const sourceResponse = new Response('{"source":"unread"}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const resolverBody = JSON.stringify({
      download_url:
        `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
        '&id=file-abc_123&p=p&sig=private-signed-url&ts=1&v=1',
    });
    const page = fakePage(
      markedOpaqueResolverUrl(),
      input =>
        Promise.resolve(
          input instanceof OpaqueTestRequest
            ? sourceResponse
            : new Response(resolverBody, {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
        ),
      OpaqueTestRequest
    );
    const source = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-only' } }
    ) as unknown as Request;
    const clone = vi.spyOn(Response.prototype, 'clone');

    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    const sourcePromise = page.pageWindow.fetch(source);
    await expect(sourcePromise).resolves.toBe(sourceResponse);
    await Promise.resolve();
    await Promise.resolve();
    for (let index = 0; index < 33; index += 1) {
      await page.pageWindow.fetch(RESOLVER_ENDPOINT);
    }
    await vi.advanceTimersByTimeAsync(8_000);

    expect(opaqueResolverSnapshotOf(page)).toEqual(
      expect.objectContaining({
        kind: 'observed',
        conversationId: CONVERSATION_ID,
        singularDispatchCount: 0,
        resolverObservations: expect.arrayContaining([
          expect.objectContaining({
            providerFileId: RESOLVER_FILE_ID,
            bodyBase64: btoa(resolverBody),
          }),
        ]),
      })
    );
    const snapshot = opaqueResolverSnapshotOf(page) as {
      resolverObservations: unknown[];
      singularDispatchCount: number;
    };
    // Claiming happens before async clone processing. The 32nd exact resolver
    // is accepted and the 33rd never clones, even if a hard deadline later
    // leaves fewer completed optional observations in the snapshot.
    expect(clone).toHaveBeenCalledTimes(32);
    expect(snapshot.resolverObservations.length).toBeGreaterThan(0);
    expect(snapshot.resolverObservations.length).toBeLessThanOrEqual(32);
    expect(snapshot.singularDispatchCount).toBe(0);
    // The direct plural response is still available to page code: this proves
    // the observer did not clone, consume, or otherwise read its source body.
    await expect(sourceResponse.text()).resolves.toBe('{"source":"unread"}');
    expect(page.originalFetch).toHaveBeenCalledTimes(34);
  });

  it('observes accepted scoped resolver responses while rejecting adjacent variants without reading source body', async () => {
    vi.useFakeTimers();
    const sourceBody = '{"source":"unread"}';
    const sourceResponse = new Response(sourceBody, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const resolverBody = JSON.stringify({ download_url: 'safe-raw-observation' });
    const page = fakePage(
      markedOpaqueResolverUrl(),
      input =>
        Promise.resolve(
          input instanceof OpaqueTestRequest
            ? sourceResponse
            : new Response(resolverBody, {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
        ),
      OpaqueTestRequest
    );
    page.pageWindow.crypto = {
      subtle: { digest: async () => new Uint8Array(32).buffer },
    } as unknown as Crypto;
    const source = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-only' } }
    ) as unknown as Request;

    startChatGptDocumentStartCapture(page.pageWindow);
    await page.pageWindow.fetch(source);
    await Promise.resolve();
    await Promise.resolve();
    await page.pageWindow.fetch(SCOPED_RESOLVER_ENDPOINT);
    await page.pageWindow.fetch(`${SCOPED_RESOLVER_ENDPOINT}&download_intent=download`);
    await page.pageWindow.fetch(`${CALPICO_RESOLVER_ENDPOINT}?inline=true`);
    await vi.advanceTimersByTimeAsync(8_000);

    expect(opaqueResolverSnapshotOf(page)).toEqual({
      kind: 'observed',
      conversationId: CONVERSATION_ID,
      resolverObservations: [
        expect.objectContaining({
          providerFileId: RESOLVER_FILE_ID,
          bodyBase64: btoa(resolverBody),
        }),
      ],
      singularDispatchCount: 0,
    });
    await expect(sourceResponse.text()).resolves.toBe(sourceBody);
    expect(page.originalFetch).toHaveBeenCalledTimes(4);
  });

  it('observes a resolver dispatched before a deferred source response validates', async () => {
    vi.useFakeTimers();
    let resolveSource: (response: Response) => void = () => undefined;
    const deferredSource = new Promise<Response>(resolve => {
      resolveSource = resolve;
    });
    const sourceBody = '{"source":"unread"}';
    const { response: sourceResponse, clone: sourceClone } = responseWithCloneSpy(
      new TextEncoder().encode(sourceBody)
    );
    const resolverBody = JSON.stringify({ download_url: 'safe-raw-observation' });
    const page = fakePage(
      markedOpaqueResolverUrl(),
      input =>
        input instanceof OpaqueTestRequest
          ? deferredSource
          : Promise.resolve(
              new Response(resolverBody, {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
            ),
      OpaqueTestRequest
    );
    const source = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-only' } }
    ) as unknown as Request;
    page.pageWindow.crypto = {
      subtle: { digest: async () => new Uint8Array(32).buffer },
    } as unknown as Crypto;

    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    const sourcePromise = page.pageWindow.fetch(source);
    await page.pageWindow.fetch(RESOLVER_ENDPOINT);
    await Promise.resolve();
    await Promise.resolve();
    expect(opaqueResolverSnapshotOf(page)).toEqual({ kind: 'ready' });

    resolveSource(sourceResponse);
    await expect(sourcePromise).resolves.toBe(sourceResponse);
    await Promise.resolve();
    expect(opaqueResolverSnapshotOf(page)).toEqual({ kind: 'ready' });

    await vi.advanceTimersByTimeAsync(8_000);

    expect(opaqueResolverSnapshotOf(page)).toEqual(
      expect.objectContaining({
        kind: 'observed',
        conversationId: CONVERSATION_ID,
        singularDispatchCount: 0,
        resolverObservations: [
          expect.objectContaining({
            providerFileId: RESOLVER_FILE_ID,
            bodyBase64: btoa(resolverBody),
          }),
        ],
      })
    );
    expect(sourceClone).not.toHaveBeenCalled();
    await expect(sourceResponse.text()).resolves.toBe(sourceBody);
  });

  it('publishes immediately after a deferred source validates once the resolver window expired', async () => {
    vi.useFakeTimers();
    let resolveSource: (response: Response) => void = () => undefined;
    const deferredSource = new Promise<Response>(resolve => {
      resolveSource = resolve;
    });
    const resolverBody = JSON.stringify({ download_url: 'safe-raw-observation' });
    const page = fakePage(
      markedOpaqueResolverUrl(),
      input =>
        input instanceof OpaqueTestRequest
          ? deferredSource
          : Promise.resolve(
              new Response(resolverBody, {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
            ),
      OpaqueTestRequest
    );
    const source = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-only' } }
    ) as unknown as Request;
    page.pageWindow.crypto = {
      subtle: { digest: async () => new Uint8Array(32).buffer },
    } as unknown as Crypto;

    startChatGptDocumentStartCapture(page.pageWindow);
    const sourcePromise = page.pageWindow.fetch(source);
    await page.pageWindow.fetch(RESOLVER_ENDPOINT);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(opaqueResolverSnapshotOf(page)).toEqual({ kind: 'ready' });

    const sourceResponse = new Response('{"source":"unread"}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    resolveSource(sourceResponse);
    await expect(sourcePromise).resolves.toBe(sourceResponse);
    await Promise.resolve();

    expect(opaqueResolverSnapshotOf(page)).toEqual(
      expect.objectContaining({
        kind: 'observed',
        conversationId: CONVERSATION_ID,
        singularDispatchCount: 0,
        resolverObservations: [
          expect.objectContaining({
            providerFileId: RESOLVER_FILE_ID,
            bodyBase64: btoa(resolverBody),
          }),
        ],
      })
    );
  });

  it.each([
    ['source rejection', 'source-rejected'],
    ['non-JSON source response', 'source-non-json'],
  ] as const)('discards an early resolver observation after %s', async (sourceOutcome, code) => {
    vi.useFakeTimers();
    const failure = new Error('synthetic source rejection');
    let resolveSource: (response: Response) => void = () => undefined;
    let rejectSource: (reason: unknown) => void = () => undefined;
    const deferredSource = new Promise<Response>((resolve, reject) => {
      resolveSource = resolve;
      rejectSource = reject;
    });
    const resolverBody = JSON.stringify({ download_url: 'safe-raw-observation' });
    const resolverResponse = new Response(resolverBody, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const resolverClone = vi.spyOn(Response.prototype, 'clone');
    const page = fakePage(
      markedOpaqueResolverUrl(),
      input =>
        input instanceof OpaqueTestRequest ? deferredSource : Promise.resolve(resolverResponse),
      OpaqueTestRequest
    );
    const source = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-only' } }
    ) as unknown as Request;

    startChatGptDocumentStartCapture(page.pageWindow);
    const sourcePromise = page.pageWindow.fetch(source);
    await page.pageWindow.fetch(RESOLVER_ENDPOINT);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(resolverClone).toHaveBeenCalledOnce();

    if (sourceOutcome === 'source rejection') {
      rejectSource(failure);
      await expect(sourcePromise).rejects.toBe(failure);
    } else {
      const nonJsonSource = new Response('unread', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
      resolveSource(nonJsonSource);
      await expect(sourcePromise).resolves.toBe(nonJsonSource);
    }
    await Promise.resolve();

    const expected = { kind: 'error', code, singularDispatchCount: 0 };
    expect(opaqueResolverSnapshotOf(page)).toEqual(expected);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(opaqueResolverSnapshotOf(page)).toEqual(expected);
  });

  it('does not extend the eight-second opaque resolver window for a late resolver response', async () => {
    vi.useFakeTimers();
    let resolveResolver: (response: Response) => void = () => undefined;
    const deferredResolver = new Promise<Response>(resolve => {
      resolveResolver = resolve;
    });
    const { response: resolverResponse, clone: resolverClone } = responseWithCloneSpy(
      new TextEncoder().encode(JSON.stringify({ download_url: 'safe-raw-observation' }))
    );
    const sourceResponse = new Response('{"source":"unread"}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const page = fakePage(
      markedOpaqueResolverUrl(),
      input =>
        input instanceof OpaqueTestRequest ? Promise.resolve(sourceResponse) : deferredResolver,
      OpaqueTestRequest
    );
    const source = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-only' } }
    ) as unknown as Request;

    startChatGptDocumentStartCapture(page.pageWindow);
    await page.pageWindow.fetch(source);
    await Promise.resolve();
    await Promise.resolve();
    const resolverPromise = page.pageWindow.fetch(RESOLVER_ENDPOINT);
    await vi.advanceTimersByTimeAsync(8_000);

    expect(opaqueResolverSnapshotOf(page)).toEqual({
      kind: 'observed',
      conversationId: CONVERSATION_ID,
      resolverObservations: [],
      singularDispatchCount: 0,
    });
    resolveResolver(resolverResponse);
    await expect(resolverPromise).resolves.toBe(resolverResponse);
    await Promise.resolve();
    await Promise.resolve();

    expect(opaqueResolverSnapshotOf(page)).toEqual({
      kind: 'observed',
      conversationId: CONVERSATION_ID,
      resolverObservations: [],
      singularDispatchCount: 0,
    });
    expect(resolverClone).not.toHaveBeenCalled();
  });

  it('retains the 64KiB opaque resolver response limit', async () => {
    vi.useFakeTimers();
    const oversizedResolverResponse = new Response(new Uint8Array(64 * 1024 + 1), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const page = fakePage(
      markedOpaqueResolverUrl(),
      input =>
        Promise.resolve(
          input instanceof OpaqueTestRequest
            ? new Response('{"source":"unread"}', {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
            : oversizedResolverResponse
        ),
      OpaqueTestRequest
    );
    const source = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-only' } }
    ) as unknown as Request;

    startChatGptDocumentStartCapture(page.pageWindow);
    await page.pageWindow.fetch(source);
    await Promise.resolve();
    await Promise.resolve();
    await page.pageWindow.fetch(RESOLVER_ENDPOINT);
    await vi.advanceTimersByTimeAsync(8_000);

    expect(opaqueResolverSnapshotOf(page)).toEqual({
      kind: 'observed',
      conversationId: CONVERSATION_ID,
      resolverObservations: [],
      singularDispatchCount: 0,
    });
  });

  it.each([
    [500, 'application/json', 'source-http-error'],
    [200, 'text/plain', 'source-non-json'],
  ])(
    'keeps an ineligible opaque resolver source transparent for %s responses',
    async (status, mediaType, code) => {
      const page = fakePage(
        markedOpaqueResolverUrl(),
        async () => new Response('{}', { status, headers: { 'content-type': mediaType } }),
        OpaqueTestRequest
      );
      const source = new OpaqueTestRequest(
        `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
        { credentials: 'include', headers: { authorization: 'synthetic-only' } }
      ) as unknown as Request;
      startChatGptDocumentStartCapture(page.pageWindow);

      await expect(page.pageWindow.fetch(source)).resolves.toBeInstanceOf(Response);
      await vi.waitFor(() =>
        expect(opaqueResolverSnapshotOf(page)).toEqual({
          kind: 'error',
          code,
          singularDispatchCount: 0,
        })
      );
      expect(page.originalFetch).toHaveBeenCalledOnce();
    }
  );

  it('rejects a plural source without an authorization member but still returns the page promise', async () => {
    const page = fakePage(
      markedOpaqueResolverUrl(),
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    const source = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include' }
    ) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await expect(page.pageWindow.fetch(source)).resolves.toBeInstanceOf(Response);
    expect(opaqueResolverSnapshotOf(page)).toEqual({
      kind: 'error',
      code: 'source-not-eligible',
      singularDispatchCount: 0,
    });
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('ignores malformed resolver URLs inside the hard observer window', async () => {
    vi.useFakeTimers();
    const page = fakePage(
      markedOpaqueResolverUrl(),
      async () =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      OpaqueTestRequest
    );
    const source = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-only' } }
    ) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);
    await page.pageWindow.fetch(source);
    await Promise.resolve();
    await Promise.resolve();
    await page.pageWindow.fetch(`${RESOLVER_ENDPOINT}&unexpected=1`);
    await vi.advanceTimersByTimeAsync(8_000);

    expect(opaqueResolverSnapshotOf(page)).toEqual({
      kind: 'observed',
      conversationId: CONVERSATION_ID,
      resolverObservations: [],
      singularDispatchCount: 0,
    });
  });

  it('fails closed when the hard resolver timer cannot be armed', async () => {
    const page = fakePage(
      markedOpaqueResolverUrl(),
      async () =>
        Promise.resolve(
          new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
        ),
      OpaqueTestRequest
    );
    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, timeout, ...args) => {
      if (timeout === 8_000) throw new Error('synthetic resolver timer failure');
      return originalSetTimeout(callback, timeout, ...args);
    });
    const source = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-only' } }
    ) as unknown as Request;

    await page.pageWindow.fetch(source);
    await vi.waitFor(() =>
      expect(opaqueResolverSnapshotOf(page)).toEqual({
        kind: 'error',
        code: 'hook-state-failed',
        singularDispatchCount: 0,
      })
    );
    expect(page.originalFetch).toHaveBeenCalledOnce();
    expect(page.pageWindow.fetch).toBe(page.originalFetch);
  });

  it('contains invalid source response metadata without reading a body', async () => {
    const invalidResponse = {} as Response;
    const page = fakePage(
      markedOpaqueResolverUrl(),
      async () => invalidResponse,
      OpaqueTestRequest
    );
    const source = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-only' } }
    ) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await expect(page.pageWindow.fetch(source)).resolves.toBe(invalidResponse);
    await vi.waitFor(() =>
      expect(opaqueResolverSnapshotOf(page)).toEqual({
        kind: 'error',
        code: 'source-http-error',
        singularDispatchCount: 0,
      })
    );
  });

  it('keeps a rejected plural source promise transparent and terminal', async () => {
    const failure = new Error('synthetic source rejection');
    const page = fakePage(
      markedOpaqueResolverUrl(),
      async () => Promise.reject(failure),
      OpaqueTestRequest
    );
    const source = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-only' } }
    ) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await expect(page.pageWindow.fetch(source)).rejects.toBe(failure);
    await vi.waitFor(() =>
      expect(opaqueResolverSnapshotOf(page)).toEqual({
        kind: 'error',
        code: 'source-rejected',
        singularDispatchCount: 0,
      })
    );
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('contains a captured Promise.then failure without changing the page response', async () => {
    const sourceResponse = new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const page = fakePage(markedOpaqueResolverUrl(), async () => sourceResponse, OpaqueTestRequest);
    page.pageWindow.Promise = {
      prototype: {
        then() {
          throw new Error('synthetic captured then failure');
        },
      },
    } as unknown as PromiseConstructor;
    const source = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-only' } }
    ) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await expect(page.pageWindow.fetch(source)).resolves.toBe(sourceResponse);
    expect(opaqueResolverSnapshotOf(page)).toEqual({
      kind: 'error',
      code: 'source-http-error',
      singularDispatchCount: 0,
    });
  });

  it('reports one synchronous eligible source failure without retrying', () => {
    vi.useFakeTimers();
    const failure = new Error('synthetic synchronous source failure');
    const page = fakePage(
      markedOpaqueResolverUrl(),
      (() => {
        throw failure;
      }) as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
      OpaqueTestRequest
    );
    const source = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-only' } }
    ) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    expect(() => page.pageWindow.fetch(source)).toThrow(failure);
    expect(opaqueResolverSnapshotOf(page)).toEqual({
      kind: 'error',
      code: 'source-rejected',
      singularDispatchCount: 0,
    });
    expect(page.originalFetch).toHaveBeenCalledOnce();
    expect(page.timers).toHaveLength(0);
  });

  it('times out without dispatch when no eligible plural source appears', async () => {
    vi.useFakeTimers();
    const page = fakePage(
      markedOpaqueResolverUrl(),
      async () => new Response('{}'),
      OpaqueTestRequest
    );

    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    await vi.advanceTimersByTimeAsync(45_000);

    expect(opaqueResolverSnapshotOf(page)).toEqual({
      kind: 'error',
      code: 'target-not-observed',
      singularDispatchCount: 0,
    });
    expect(page.originalFetch).not.toHaveBeenCalled();
    expect(page.pageWindow.fetch).toBe(page.originalFetch);
  });

  it('refuses a pre-existing opaque resolver state key before wrapping fetch', () => {
    const page = fakePage(markedOpaqueResolverUrl(), undefined, OpaqueTestRequest);
    Object.defineProperty(page.pageWindow, OPAQUE_RESOLVER_STATE_KEY, {
      configurable: true,
      value: { kind: 'ready' },
    });

    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });
    expect(page.pageWindow.fetch).toBe(page.originalFetch);
  });

  it('contains an opaque resolver state publication failure before wrapping fetch', () => {
    const page = fakePage(markedOpaqueResolverUrl(), undefined, OpaqueTestRequest);
    const NativeObject = page.pageWindow.Object;
    page.pageWindow.Object = {
      prototype: NativeObject.prototype,
      getOwnPropertyDescriptor: NativeObject.getOwnPropertyDescriptor,
      getPrototypeOf: NativeObject.getPrototypeOf,
      defineProperty() {
        throw new Error('synthetic defineProperty failure');
      },
    } as unknown as ObjectConstructor;

    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });
    expect(page.pageWindow.fetch).toBe(page.originalFetch);
  });

  it.each([
    ['wrong method', { method: 'POST' }, OpaqueTestRequest, 'target-mismatch'],
    ['rejected credentials', { credentials: 'omit' }, OpaqueTestRequest, 'credentials-rejected'],
    [
      'missing authorization',
      { credentials: 'include' },
      OpaqueTestRequest,
      'authorization-absent',
    ],
  ] as const)(
    'returns a bounded terminal probe result for %s without replay',
    async (_label, init, RequestConstructor, outcome) => {
      const page = fakePage(
        markedOpaqueProbeUrl(),
        async () => new Response('{}'),
        RequestConstructor
      );
      const request = new RequestConstructor(
        `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
        init
      ) as unknown as Request;
      startChatGptDocumentStartCapture(page.pageWindow);

      await page.pageWindow.fetch(request);

      expect(opaqueSnapshotOf(page)).toMatchObject({
        kind: 'result',
        result: { outcome, singularDispatchCount: 0, sourceStatus: null, sourceJson: false },
      });
      expect(page.originalFetch).toHaveBeenCalledOnce();
    }
  );

  it('reports clone failure before one ordinary page fetch without retrying it', async () => {
    const originalClone = OpaqueTestRequest.prototype.clone;
    OpaqueTestRequest.prototype.clone = () => {
      throw new Error('synthetic clone failure');
    };
    try {
      const page = fakePage(
        markedOpaqueProbeUrl(),
        async () => new Response('{}'),
        OpaqueTestRequest
      );
      const request = new OpaqueTestRequest(
        `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
        { credentials: 'include', headers: { authorization: 'synthetic-sentinel' } }
      ) as unknown as Request;
      startChatGptDocumentStartCapture(page.pageWindow);

      await page.pageWindow.fetch(request);

      expect(opaqueSnapshotOf(page)).toMatchObject({
        kind: 'result',
        result: { outcome: 'clone-failed', singularDispatchCount: 0, sourceStatus: null },
      });
      expect(page.originalFetch).toHaveBeenCalledOnce();
    } finally {
      OpaqueTestRequest.prototype.clone = originalClone;
    }
  });

  it.each([
    [401, 'application/json', 'source-http-unauthorized'],
    [403, 'application/json', 'source-http-forbidden'],
    [429, 'application/json', 'source-http-rate-limited'],
    [302, 'application/json', 'source-http-redirect'],
    [500, 'application/json', 'source-http-error'],
    [200, 'text/plain', 'source-non-json'],
  ])('does not retry terminal source result %s', async (status, contentType, outcome) => {
    const response = new Response(status === 302 ? null : '{}', {
      status,
      headers: { 'content-type': contentType },
    });
    const page = fakePage(markedOpaqueProbeUrl(), async () => response, OpaqueTestRequest);
    const request = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-sentinel' } }
    ) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await page.pageWindow.fetch(request);

    await vi.waitFor(() =>
      expect(opaqueSnapshotOf(page)).toMatchObject({
        kind: 'result',
        result: { outcome, sourceStatus: status, singularDispatchCount: 0 },
      })
    );
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('reports a rejected page-native request without retrying it', async () => {
    const page = fakePage(
      markedOpaqueProbeUrl(),
      async () => Promise.reject(new Error('synthetic rejection')),
      OpaqueTestRequest
    );
    const request = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-sentinel' } }
    ) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await expect(page.pageWindow.fetch(request)).rejects.toThrow('synthetic rejection');

    await vi.waitFor(() =>
      expect(opaqueSnapshotOf(page)).toMatchObject({
        kind: 'result',
        result: { outcome: 'source-rejected', sourceStatus: null, singularDispatchCount: 0 },
      })
    );
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('reports a synchronous page-native fetch failure and rethrows it without retry', () => {
    const page = fakePage(
      markedOpaqueProbeUrl(),
      () => {
        throw new Error('synthetic synchronous fetch failure');
      },
      OpaqueTestRequest
    );
    const request = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-sentinel' } }
    ) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    expect(() => page.pageWindow.fetch(request)).toThrow('synthetic synchronous fetch failure');
    expect(opaqueSnapshotOf(page)).toMatchObject({
      kind: 'result',
      result: { outcome: 'source-rejected', sourceStatus: null, singularDispatchCount: 0 },
    });
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('fails closed when a page-native Promise resolves to a non-Response object', async () => {
    const malformed = {} as Response;
    const page = fakePage(markedOpaqueProbeUrl(), async () => malformed, OpaqueTestRequest);
    const request = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-sentinel' } }
    ) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await expect(page.pageWindow.fetch(request)).resolves.toBe(malformed);
    await vi.waitFor(() =>
      expect(opaqueSnapshotOf(page)).toMatchObject({
        kind: 'result',
        result: { outcome: 'probe-failed', sourceStatus: null, singularDispatchCount: 0 },
      })
    );
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('refuses a pre-existing metadata-probe state key without wrapping fetch', () => {
    const page = fakePage(
      markedOpaqueProbeUrl(),
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    Object.defineProperty(page.pageWindow, OPAQUE_STATE_KEY, {
      configurable: true,
      value: { kind: 'ready' },
    });

    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });
    expect(page.pageWindow.fetch).toBe(page.originalFetch);
  });

  it('contains a captured Promise.then failure in metadata-probe response observation', async () => {
    class ThrowingThenPromise {
      then(): never {
        throw new Error('synthetic captured then failure');
      }
    }
    const response = new Response('{}', {
      headers: { 'content-type': 'application/json' },
    });
    const page = fakePage(markedOpaqueProbeUrl(), async () => response, OpaqueTestRequest);
    page.pageWindow.Promise = ThrowingThenPromise as unknown as PromiseConstructor;
    const request = new OpaqueTestRequest(
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      { credentials: 'include', headers: { authorization: 'synthetic-sentinel' } }
    ) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await expect(page.pageWindow.fetch(request)).resolves.toBe(response);

    expect(opaqueSnapshotOf(page)).toMatchObject({
      kind: 'result',
      result: { outcome: 'probe-failed', singularDispatchCount: 0 },
    });
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it.each(['command-before-source', 'source-before-command'] as const)(
    'runs the active metric resolver only after both latches in %s order',
    async latchOrder => {
      const sourceUrl =
        `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
        '?include_has_versions=true&num_turns=10';
      const providerFileId = 'file_abc-123';
      const resolverBody = JSON.stringify({
        download_url:
          `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
          '&id=private&p=p&sig=s&ts=t&v=v',
      });
      const sourceResponse = new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      const resolverResponse = new Response(resolverBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      const page = fakePage(
        markedActiveResolverUrl(),
        async input =>
          (input as OpaqueTestRequest).url === sourceUrl ? sourceResponse : resolverResponse,
        OpaqueTestRequest
      );
      page.pageWindow.crypto = {
        subtle: { digest: async () => new Uint8Array(32).buffer },
      } as unknown as Crypto;
      const source = new OpaqueTestRequest(sourceUrl, {
        credentials: 'include',
        headers: { authorization: 'synthetic-authorization-sentinel' },
      }) as unknown as Request;
      expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
      const commandDescriptor = Object.getOwnPropertyDescriptor(
        page.pageWindow,
        ACTIVE_RESOLVER_COMMAND_KEY
      );
      expect(commandDescriptor).toMatchObject({
        configurable: false,
        enumerable: false,
        writable: false,
      });
      const command = commandDescriptor?.value as (providerFileIds: unknown) => boolean;

      if (latchOrder === 'command-before-source') expect(command([providerFileId])).toBe(true);
      await expect(page.pageWindow.fetch(source)).resolves.toBe(sourceResponse);
      if (latchOrder === 'source-before-command') expect(command([providerFileId])).toBe(true);

      await vi.waitFor(() =>
        expect(activeResolverSnapshotOf(page)).toMatchObject({
          kind: 'complete',
          conversationId: CONVERSATION_ID,
          requestedCount: 1,
          dispatchCount: 1,
          outcomes: [
            {
              state: 'observed',
              capture: { byteLength: new TextEncoder().encode(resolverBody).byteLength },
            },
          ],
        })
      );
      expect(page.originalFetch).toHaveBeenCalledTimes(2);
      const activeRequest = page.originalFetch.mock.calls[1]?.[0] as OpaqueTestRequest;
      expect(activeRequest).toMatchObject({
        url:
          `https://chatgpt.com/backend-api/files/download/${providerFileId}` +
          '?download_intent=true' +
          `&check_context_scopes_for_conversation_id=${CONVERSATION_ID}`,
        method: 'GET',
        credentials: 'include',
        redirect: 'error',
        cache: 'no-store',
      });
      vi.stubGlobal('window', page.pageWindow);
      expect(readChatGptActiveResolverState(NONCE)).toEqual(activeResolverSnapshotOf(page));
      expect(JSON.stringify(activeResolverSnapshotOf(page))).not.toContain(providerFileId);
      expect(JSON.stringify(activeResolverSnapshotOf(page))).not.toContain(
        'synthetic-authorization-sentinel'
      );
    }
  );

  it('fails closed for plural, duplicate, or malformed active command IDs without dispatch', async () => {
    const page = fakePage(
      markedActiveResolverUrl(),
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    const command = Object.getOwnPropertyDescriptor(page.pageWindow, ACTIVE_RESOLVER_COMMAND_KEY)
      ?.value as (providerFileIds: unknown) => boolean;
    expect(command(['file_one', 'file_two'])).toBe(false);
    expect(command(['file_one', 'file_one'])).toBe(false);
    expect(command(['file.with.dot'])).toBe(false);
    expect(command([])).toBe(false);
    expect(page.originalFetch).not.toHaveBeenCalled();
    expect(activeResolverSnapshotOf(page)).toEqual({ kind: 'ready' });
  });

  it('rejects an active command after same-document route drift', () => {
    const page = fakePage(
      markedActiveResolverUrl(),
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    const command = Object.getOwnPropertyDescriptor(page.pageWindow, ACTIVE_RESOLVER_COMMAND_KEY)
      ?.value as (providerFileIds: unknown) => boolean;
    page.pageWindow.location.href = `https://chatgpt.com/c/${CONVERSATION_ID}`;
    expect(command(['file_one'])).toBe(false);
    expect(page.originalFetch).not.toHaveBeenCalled();
    expect(activeResolverSnapshotOf(page)).toEqual({ kind: 'ready' });
  });

  it('keeps a command not-dispatched when the marker route drifts before source readiness', async () => {
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    let resolveSource: ((response: Response) => void) | undefined;
    const sourcePending = new Promise<Response>(resolve => {
      resolveSource = resolve;
    });
    const page = fakePage(
      markedActiveResolverUrl(),
      input =>
        (input as OpaqueTestRequest).url === sourceUrl
          ? sourcePending
          : Promise.reject(new Error('resolver fetch must stay not-dispatched')),
      OpaqueTestRequest
    );
    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    const command = Object.getOwnPropertyDescriptor(page.pageWindow, ACTIVE_RESOLVER_COMMAND_KEY)
      ?.value as (providerFileIds: unknown) => boolean;
    expect(command(['file_one'])).toBe(true);
    const sourceResult = page.pageWindow.fetch(
      new OpaqueTestRequest(sourceUrl, {
        credentials: 'include',
        headers: { authorization: 'synthetic-authorization-sentinel' },
      }) as unknown as Request
    );
    expect(page.originalFetch).toHaveBeenCalledOnce();
    page.pageWindow.location.href = `https://chatgpt.com/c/${CONVERSATION_ID}`;
    resolveSource?.(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    await sourceResult;

    await vi.waitFor(() =>
      expect(activeResolverSnapshotOf(page)).toEqual({
        kind: 'complete',
        conversationId: CONVERSATION_ID,
        requestedCount: 1,
        dispatchCount: 0,
        outcomes: [{ state: 'not-dispatched' }],
      })
    );
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('keeps a command-before-source route drift entirely not-dispatched', async () => {
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const page = fakePage(
      markedActiveResolverUrl(),
      async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
      OpaqueTestRequest
    );
    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    const command = Object.getOwnPropertyDescriptor(page.pageWindow, ACTIVE_RESOLVER_COMMAND_KEY)
      ?.value as (providerFileIds: unknown) => boolean;
    expect(command(['first', 'second'])).toBe(false);
    page.pageWindow.location.href = `https://chatgpt.com/c/${CONVERSATION_ID}`;
    await page.pageWindow.fetch(
      new OpaqueTestRequest(sourceUrl, {
        credentials: 'include',
        headers: { authorization: 'synthetic-authorization-sentinel' },
      }) as unknown as Request
    );
    await vi.waitFor(() => expect(activeResolverSnapshotOf(page)).toEqual({ kind: 'ready' }));
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('uses the document-start Array.isArray primordial and never invokes a supplied iterator', () => {
    const page = fakePage(
      markedActiveResolverUrl(),
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    const command = Object.getOwnPropertyDescriptor(page.pageWindow, ACTIVE_RESOLVER_COMMAND_KEY)
      ?.value as (providerFileIds: unknown) => boolean;
    const iterator = vi.fn(() => {
      throw new Error('iterator must stay unused');
    });
    const providerFileIds = ['file_one'];
    Object.defineProperty(providerFileIds, Symbol.iterator, {
      configurable: true,
      value: iterator,
    });
    page.pageWindow.Array = { isArray: () => false } as unknown as ArrayConstructor;
    expect(command(providerFileIds)).toBe(true);
    expect(iterator).not.toHaveBeenCalled();
  });

  it('contains an active command proxy that throws while exposing its length', () => {
    const page = fakePage(
      markedActiveResolverUrl(),
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    const command = Object.getOwnPropertyDescriptor(page.pageWindow, ACTIVE_RESOLVER_COMMAND_KEY)
      ?.value as (providerFileIds: unknown) => boolean;
    const hostile = new Proxy<string[]>([], {
      get(target, property, receiver) {
        if (property === 'length') throw new Error('synthetic length failure');
        return Reflect.get(target, property, receiver);
      },
    });
    expect(command(hostile)).toBe(false);
    expect(activeResolverSnapshotOf(page)).toEqual({ kind: 'ready' });
  });

  it('publishes a stable active timeout before any command is accepted', async () => {
    vi.useFakeTimers();
    const page = fakePage(
      markedActiveResolverUrl(),
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(activeResolverSnapshotOf(page)).toEqual({
      kind: 'error',
      code: 'resolver-result-timeout',
    });
  });

  it.each([
    [
      'non-json',
      () => new Response('{}', { status: 200, headers: { 'content-type': 'text/plain' } }),
      'non-json',
    ],
    [
      'oversized',
      () =>
        new Response(new Uint8Array(64 * 1024 + 1), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      'oversized',
    ],
  ] as const)(
    'records an active resolver %s response without retry',
    async (_label, response, state) => {
      const sourceUrl =
        `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
        '?include_has_versions=true&num_turns=10';
      const page = fakePage(
        markedActiveResolverUrl(),
        async input =>
          (input as OpaqueTestRequest).url === sourceUrl
            ? new Response('{}', { headers: { 'content-type': 'application/json' } })
            : response(),
        OpaqueTestRequest
      );
      expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
      const command = Object.getOwnPropertyDescriptor(page.pageWindow, ACTIVE_RESOLVER_COMMAND_KEY)
        ?.value as (providerFileIds: unknown) => boolean;
      expect(command(['file_one'])).toBe(true);
      await page.pageWindow.fetch(
        new OpaqueTestRequest(sourceUrl, {
          credentials: 'include',
          headers: { authorization: 'synthetic-authorization-sentinel' },
        }) as unknown as Request
      );
      await vi.waitFor(() =>
        expect(activeResolverSnapshotOf(page)).toMatchObject({
          kind: 'complete',
          dispatchCount: 1,
          outcomes: [{ state }],
        })
      );
      expect(page.originalFetch).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    ['a rejected fetch before a Response', 'fetch-rejected'],
    ['a Response clone failure', 'response-processing-rejected'],
  ] as const)('assigns %s only to its active resolver boundary', async (label, state) => {
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    if (label === 'a Response clone failure') {
      vi.spyOn(Response.prototype, 'clone').mockImplementation(() => {
        throw new Error('synthetic clone failure');
      });
    }
    const page = fakePage(
      markedActiveResolverUrl(),
      input =>
        (input as OpaqueTestRequest).url === sourceUrl
          ? Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }))
          : label === 'a rejected fetch before a Response'
            ? Promise.reject(new Error('synthetic fetch rejection'))
            : Promise.resolve(
                new Response('{}', { headers: { 'content-type': 'application/json' } })
              ),
      OpaqueTestRequest
    );
    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    const command = Object.getOwnPropertyDescriptor(page.pageWindow, ACTIVE_RESOLVER_COMMAND_KEY)
      ?.value as (providerFileIds: unknown) => boolean;
    expect(command(['file_one'])).toBe(true);
    await page.pageWindow.fetch(
      new OpaqueTestRequest(sourceUrl, {
        credentials: 'include',
        headers: { authorization: 'synthetic-authorization-sentinel' },
      }) as unknown as Request
    );
    await vi.waitFor(() =>
      expect(activeResolverSnapshotOf(page)).toMatchObject({
        kind: 'complete',
        dispatchCount: 1,
        outcomes: [{ state }],
      })
    );
    expect(page.originalFetch).toHaveBeenCalledTimes(2);
  });

  it('terminates before dispatch when active Request construction fails', async () => {
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    class ThrowingResolverRequest extends OpaqueTestRequest {
      constructor(url: string, init: ConstructorParameters<typeof OpaqueTestRequest>[1] = {}) {
        super(url, init);
        if (url.includes('/backend-api/files/download/')) {
          throw new Error('synthetic resolver Request construction failure');
        }
      }
    }
    for (const property of ['url', 'method', 'headers', 'credentials', 'clone'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(OpaqueTestRequest.prototype, property);
      if (descriptor !== undefined) {
        Object.defineProperty(ThrowingResolverRequest.prototype, property, descriptor);
      }
    }
    const sourceResponse = new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const page = fakePage(
      markedActiveResolverUrl(),
      async () => sourceResponse,
      ThrowingResolverRequest
    );
    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    const command = Object.getOwnPropertyDescriptor(page.pageWindow, ACTIVE_RESOLVER_COMMAND_KEY)
      ?.value as (providerFileIds: unknown) => boolean;
    expect(command(['file_one'])).toBe(true);

    await expect(
      page.pageWindow.fetch(
        new ThrowingResolverRequest(sourceUrl, {
          credentials: 'include',
          headers: { authorization: 'synthetic-authorization-sentinel' },
        }) as unknown as Request
      )
    ).resolves.toBe(sourceResponse);

    await vi.waitFor(() =>
      expect(activeResolverSnapshotOf(page)).toEqual({
        kind: 'error',
        code: 'hook-state-failed',
      })
    );
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('times out one active resolver with its one diagnostic signal', async () => {
    vi.useFakeTimers();
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const resolverSignals: AbortSignal[] = [];
    const page = fakePage(
      markedActiveResolverUrl(),
      input => {
        const request = input as OpaqueTestRequest;
        if (request.url === sourceUrl) {
          return Promise.resolve(
            new Response('{}', { headers: { 'content-type': 'application/json' } })
          );
        }
        resolverSignals.push(request.signal!);
        if (request.url.includes('/first?')) {
          return new Promise<Response>((_resolve, reject) => {
            request.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
          });
        }
        return Promise.resolve(
          new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } })
        );
      },
      OpaqueTestRequest
    );
    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    const command = Object.getOwnPropertyDescriptor(page.pageWindow, ACTIVE_RESOLVER_COMMAND_KEY)
      ?.value as (providerFileIds: unknown) => boolean;
    expect(command(['first'])).toBe(true);
    await page.pageWindow.fetch(
      new OpaqueTestRequest(sourceUrl, {
        credentials: 'include',
        headers: { authorization: 'synthetic-authorization-sentinel' },
      }) as unknown as Request
    );
    await vi.waitFor(() => expect(page.originalFetch).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(12_000);
    await vi.waitFor(() =>
      expect(activeResolverSnapshotOf(page)).toMatchObject({
        kind: 'complete',
        dispatchCount: 1,
        outcomes: [{ state: 'timed-out' }],
      })
    );
    expect(resolverSignals).toHaveLength(1);
    expect(resolverSignals[0].aborted).toBe(true);
  });

  it('accounts for one observed resolver body under the diagnostic cap', async () => {
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const page = fakePage(
      markedActiveResolverUrl(),
      async input =>
        (input as OpaqueTestRequest).url === sourceUrl
          ? new Response('{}', { headers: { 'content-type': 'application/json' } })
          : new Response('{}', { headers: { 'content-type': 'application/json' } }),
      OpaqueTestRequest
    );
    page.pageWindow.crypto = {
      subtle: { digest: async () => new Uint8Array(32).buffer },
    } as unknown as Crypto;
    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    const command = Object.getOwnPropertyDescriptor(page.pageWindow, ACTIVE_RESOLVER_COMMAND_KEY)
      ?.value as (providerFileIds: unknown) => boolean;
    expect(command(['first'])).toBe(true);
    await page.pageWindow.fetch(
      new OpaqueTestRequest(sourceUrl, {
        credentials: 'include',
        headers: { authorization: 'synthetic-authorization-sentinel' },
      }) as unknown as Request
    );
    await vi.waitFor(() =>
      expect(activeResolverSnapshotOf(page)).toMatchObject({
        kind: 'complete',
        dispatchCount: 1,
        outcomes: [{ state: 'observed' }],
      })
    );
    expect(page.originalFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps an already-commanded ineligible active source as not-dispatched', async () => {
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const page = fakePage(
      markedActiveResolverUrl(),
      async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
      OpaqueTestRequest
    );
    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    const command = Object.getOwnPropertyDescriptor(page.pageWindow, ACTIVE_RESOLVER_COMMAND_KEY)
      ?.value as (providerFileIds: unknown) => boolean;
    expect(command(['file_one'])).toBe(true);
    await page.pageWindow.fetch(
      new OpaqueTestRequest(sourceUrl, { credentials: 'include' }) as unknown as Request
    );
    await vi.waitFor(() =>
      expect(activeResolverSnapshotOf(page)).toEqual({
        kind: 'complete',
        conversationId: CONVERSATION_ID,
        requestedCount: 1,
        dispatchCount: 0,
        outcomes: [{ state: 'not-dispatched' }],
      })
    );
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('contains malformed active source responses and synchronous source throws', async () => {
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const malformedPage = fakePage(
      markedActiveResolverUrl(),
      async () => ({}) as Response,
      OpaqueTestRequest
    );
    expect(startChatGptDocumentStartCapture(malformedPage.pageWindow)).toEqual({ kind: 'ready' });
    const malformedCommand = Object.getOwnPropertyDescriptor(
      malformedPage.pageWindow,
      ACTIVE_RESOLVER_COMMAND_KEY
    )?.value as (providerFileIds: unknown) => boolean;
    expect(malformedCommand(['file_one'])).toBe(true);
    await malformedPage.pageWindow.fetch(
      new OpaqueTestRequest(sourceUrl, {
        credentials: 'include',
        headers: { authorization: 'synthetic-authorization-sentinel' },
      }) as unknown as Request
    );
    await vi.waitFor(() =>
      expect(activeResolverSnapshotOf(malformedPage)).toMatchObject({
        kind: 'complete',
        outcomes: [{ state: 'not-dispatched' }],
      })
    );

    const throwingPage = fakePage(
      markedActiveResolverUrl(),
      (() => {
        throw new Error('synthetic synchronous source failure');
      }) as never,
      OpaqueTestRequest
    );
    expect(startChatGptDocumentStartCapture(throwingPage.pageWindow)).toEqual({ kind: 'ready' });
    const throwingSource = new OpaqueTestRequest(sourceUrl, {
      credentials: 'include',
      headers: { authorization: 'synthetic-authorization-sentinel' },
    }) as unknown as Request;
    expect(() => throwingPage.pageWindow.fetch(throwingSource)).toThrow(
      'synthetic synchronous source failure'
    );
    expect(activeResolverSnapshotOf(throwingPage)).toEqual({
      kind: 'error',
      code: 'source-rejected',
    });
  });

  it('fails active arming for a second href read, a pre-existing key, or poisoned publication', () => {
    const hrefPage = fakePage(
      markedActiveResolverUrl(),
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    let hrefReads = 0;
    Object.defineProperty(hrefPage.pageWindow.location, 'href', {
      configurable: true,
      get() {
        hrefReads += 1;
        if (hrefReads === 1) return markedActiveResolverUrl();
        throw new Error('synthetic href failure');
      },
    });
    expect(startChatGptDocumentStartCapture(hrefPage.pageWindow)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });

    const collisionPage = fakePage(
      markedActiveResolverUrl(),
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    Object.defineProperty(collisionPage.pageWindow, ACTIVE_RESOLVER_STATE_KEY, {
      configurable: true,
      value: { kind: 'ready' },
    });
    expect(startChatGptDocumentStartCapture(collisionPage.pageWindow)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });

    const publicationPage = fakePage(
      markedActiveResolverUrl(),
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    publicationPage.pageWindow.Object = new Proxy(Object, {
      get(target, property, receiver) {
        if (property === 'defineProperty') {
          return () => {
            throw new Error('synthetic publication failure');
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as ObjectConstructor;
    expect(startChatGptDocumentStartCapture(publicationPage.pageWindow)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });
  });

  it.each([
    [
      'source rejection',
      () => Promise.reject(new Error('synthetic source rejection')),
      'source-rejected',
    ],
    [
      'non-json source',
      () => Promise.resolve(new Response('{}', { headers: { 'content-type': 'text/plain' } })),
      'source-non-json',
    ],
    [
      'http-error source',
      () =>
        Promise.resolve(
          new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } })
        ),
      'source-http-error',
    ],
  ] as const)(
    'keeps active source transparent and terminal on %s',
    async (_label, fetchImplementation, code) => {
      const sourceUrl =
        `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
        '?include_has_versions=true&num_turns=10';
      const page = fakePage(markedActiveResolverUrl(), fetchImplementation, OpaqueTestRequest);
      const source = new OpaqueTestRequest(sourceUrl, {
        credentials: 'include',
        headers: { authorization: 'synthetic-authorization-sentinel' },
      }) as unknown as Request;
      expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
      await page.pageWindow.fetch(source).catch(() => undefined);
      await vi.waitFor(() =>
        expect(activeResolverSnapshotOf(page)).toEqual({ kind: 'error', code })
      );
      expect(page.originalFetch).toHaveBeenCalledOnce();
    }
  );

  it('reports an already-commanded source failure as zero dispatch and all not-dispatched', async () => {
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const page = fakePage(
      markedActiveResolverUrl(),
      async () =>
        new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } }),
      OpaqueTestRequest
    );
    const command = (() => {
      startChatGptDocumentStartCapture(page.pageWindow);
      return Object.getOwnPropertyDescriptor(page.pageWindow, ACTIVE_RESOLVER_COMMAND_KEY)
        ?.value as (providerFileIds: unknown) => boolean;
    })();
    expect(command(['first'])).toBe(true);
    await page.pageWindow.fetch(
      new OpaqueTestRequest(sourceUrl, {
        credentials: 'include',
        headers: { authorization: 'synthetic-authorization-sentinel' },
      }) as unknown as Request
    );
    await vi.waitFor(() =>
      expect(activeResolverSnapshotOf(page)).toEqual({
        kind: 'complete',
        conversationId: CONVERSATION_ID,
        requestedCount: 1,
        dispatchCount: 0,
        outcomes: [{ state: 'not-dispatched' }],
      })
    );
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('keeps a settled global-timeout partial queue immutable after delayed capture hashing', async () => {
    vi.useFakeTimers();
    let resolveDigest: ((value: ArrayBuffer) => void) | undefined;
    const deferredDigest = new Promise<ArrayBuffer>(resolve => {
      resolveDigest = resolve;
    });
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const page = fakePage(
      markedActiveResolverUrl(),
      async input =>
        (input as OpaqueTestRequest).url === sourceUrl
          ? new Response('{}', { headers: { 'content-type': 'application/json' } })
          : new Response('{}', { headers: { 'content-type': 'application/json' } }),
      OpaqueTestRequest
    );
    page.pageWindow.crypto = { subtle: { digest: () => deferredDigest } } as unknown as Crypto;
    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    const command = Object.getOwnPropertyDescriptor(page.pageWindow, ACTIVE_RESOLVER_COMMAND_KEY)
      ?.value as (providerFileIds: unknown) => boolean;
    expect(command(['first'])).toBe(true);
    await page.pageWindow.fetch(
      new OpaqueTestRequest(sourceUrl, {
        credentials: 'include',
        headers: { authorization: 'synthetic-authorization-sentinel' },
      }) as unknown as Request
    );
    await vi.waitFor(() => expect(page.originalFetch).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(180_000);
    const settled = {
      kind: 'complete',
      conversationId: CONVERSATION_ID,
      requestedCount: 1,
      dispatchCount: 1,
      outcomes: [{ state: 'timed-out' }],
    };
    expect(activeResolverSnapshotOf(page)).toEqual(settled);
    resolveDigest?.(new Uint8Array(32).buffer);
    await Promise.resolve();
    await Promise.resolve();
    expect(activeResolverSnapshotOf(page)).toEqual(settled);
    expect(page.originalFetch).toHaveBeenCalledTimes(2);
  });

  it('replays one exact singular request only after a page-owned plural 200 JSON source', async () => {
    const sourceResponse = new Response('{"source":"unread"}', {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
    const replayResponse = new Response(new Uint8Array([0, 255, 1]), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
    const clone = vi.spyOn(Response.prototype, 'clone');
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      async input => {
        const url = (input as OpaqueTestRequest).url;
        return url === sourceUrl ? sourceResponse : replayResponse;
      },
      OpaqueTestRequest
    );
    page.pageWindow.crypto = {
      subtle: { digest: async () => new Uint8Array(32).buffer },
    } as unknown as Crypto;
    const sourceRequest = new OpaqueTestRequest(sourceUrl, {
      credentials: 'include',
      headers: { authorization: 'synthetic-authorization-sentinel' },
    }) as unknown as Request;

    try {
      expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
      await expect(page.pageWindow.fetch(sourceRequest)).resolves.toBe(sourceResponse);

      await vi.waitFor(() =>
        expect(opaqueReplaySnapshotOf(page)).toEqual({
          kind: 'captured',
          conversationId: CONVERSATION_ID,
          capture: {
            bodyBase64: 'AP8B',
            byteLength: 3,
            sha256: '0'.repeat(64),
            mediaType: 'application/json; charset=utf-8',
          },
          singularDispatchCount: 1,
        })
      );
      expect(page.originalFetch).toHaveBeenCalledTimes(2);
      const singular = page.originalFetch.mock.calls[1]?.[0] as OpaqueTestRequest;
      expect(singular).toMatchObject({
        url: `https://chatgpt.com/backend-api/conversation/${CONVERSATION_ID}`,
        method: 'GET',
        credentials: 'include',
        redirect: 'error',
        cache: 'no-store',
      });
      expect(singular.signal).toBeInstanceOf(AbortSignal);
      expect(sourceResponse.bodyUsed).toBe(false);
      expect(clone).toHaveBeenCalledTimes(1);
      vi.stubGlobal('window', page.pageWindow);
      expect(readChatGptOpaqueReplayState(NONCE)).toEqual(opaqueReplaySnapshotOf(page));
      expect(JSON.stringify(opaqueReplaySnapshotOf(page))).not.toContain(
        'synthetic-authorization-sentinel'
      );
    } finally {
      clone.mockRestore();
    }
  });

  it.each([
    ['ordinary empty init', {}],
    ['ordinary signal-only init', { signal: new AbortController().signal }],
  ] as const)('allows %s without reusing the original RequestInit', async (_label, init) => {
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?num_turns=10&include_has_versions=true';
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      async input =>
        (input as OpaqueTestRequest).url === sourceUrl
          ? new Response('{}', { headers: { 'content-type': 'application/json' } })
          : new Response('{}', { headers: { 'content-type': 'application/json' } }),
      OpaqueTestRequest
    );
    const request = new OpaqueTestRequest(sourceUrl, {
      credentials: 'same-origin',
      headers: { authorization: 'synthetic-sentinel' },
    }) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await page.pageWindow.fetch(request, init);

    await vi.waitFor(() =>
      expect(opaqueReplaySnapshotOf(page)).toMatchObject({
        kind: 'captured',
        singularDispatchCount: 1,
      })
    );
    const singular = page.originalFetch.mock.calls[1]?.[0] as OpaqueTestRequest;
    expect(singular.credentials).toBe('same-origin');
    expect(singular.signal).not.toBe(init.signal);
  });

  it.each([
    ['other conversation', OTHER_CONVERSATION_ID, 'GET', undefined, 'ready'],
    [CONVERSATION_ID, CONVERSATION_ID, 'POST', undefined, 'target-mismatch'],
    [CONVERSATION_ID, CONVERSATION_ID, 'GET', { headers: {} }, 'init-security-sensitive'],
    [CONVERSATION_ID, CONVERSATION_ID, 'GET', undefined, 'source-http-error'],
  ] as const)(
    'does not replay when source eligibility fails: %s',
    async (label, requestConversationId, method, init, expected) => {
      const sourceUrl =
        `https://chatgpt.com/backend-api/conversations/${requestConversationId}` +
        '?include_has_versions=true&num_turns=10';
      const clone = vi.spyOn(OpaqueTestRequest.prototype, 'clone');
      const page = fakePage(
        `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
        async () =>
          label === CONVERSATION_ID
            ? new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } })
            : new Response('{}', { headers: { 'content-type': 'application/json' } }),
        OpaqueTestRequest
      );
      const request = new OpaqueTestRequest(sourceUrl, {
        method,
        credentials: 'include',
        headers: { authorization: 'synthetic-sentinel' },
      }) as unknown as Request;
      try {
        startChatGptDocumentStartCapture(page.pageWindow);
        await page.pageWindow.fetch(request, init as RequestInit | undefined);

        if (expected === 'ready') expect(opaqueReplaySnapshotOf(page)).toEqual({ kind: 'ready' });
        else {
          await vi.waitFor(() =>
            expect(opaqueReplaySnapshotOf(page)).toMatchObject({
              kind: 'error',
              code: expected,
              singularDispatchCount: 0,
            })
          );
        }
        expect(page.originalFetch).toHaveBeenCalledOnce();
        if (method === 'POST' || requestConversationId !== CONVERSATION_ID) {
          expect(clone).not.toHaveBeenCalled();
        }
      } finally {
        clone.mockRestore();
      }
    }
  );

  it('uses no header-value operation while preparing an eligible source request', async () => {
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const sourceResponse = new Response('{}', { headers: { 'content-type': 'application/json' } });
    const replayResponse = new Response('{}', { headers: { 'content-type': 'application/json' } });
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      async input =>
        (input as OpaqueTestRequest).url === sourceUrl ? sourceResponse : replayResponse,
      OpaqueTestRequest
    );
    const request = new OpaqueTestRequest(sourceUrl, {
      credentials: 'include',
      headers: { authorization: 'synthetic-sentinel' },
    }) as unknown as Request;
    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });
    const originalGet = Headers.prototype.get;
    const originalEntries = Headers.prototype.entries;
    const originalIterator = Headers.prototype[Symbol.iterator];
    const poisoned = vi.fn(() => {
      throw new Error('header value or iteration must stay unread');
    });
    Object.defineProperties(Headers.prototype, {
      get: { configurable: true, value: poisoned },
      entries: { configurable: true, value: poisoned },
      [Symbol.iterator]: { configurable: true, value: poisoned },
    });
    try {
      await page.pageWindow.fetch(request);
      await vi.waitFor(() =>
        expect(opaqueReplaySnapshotOf(page)).toMatchObject({ kind: 'captured' })
      );
      expect(poisoned).not.toHaveBeenCalled();
    } finally {
      Object.defineProperties(Headers.prototype, {
        get: { configurable: true, value: originalGet },
        entries: { configurable: true, value: originalEntries },
        [Symbol.iterator]: { configurable: true, value: originalIterator },
      });
    }
  });

  it('does not retry a synchronous replay dispatch failure and preserves its one-count outcome', async () => {
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      input => {
        if ((input as OpaqueTestRequest).url === sourceUrl) {
          return Promise.resolve(
            new Response('{}', { headers: { 'content-type': 'application/json' } })
          );
        }
        throw new Error('synthetic singular dispatch failure');
      },
      OpaqueTestRequest
    );
    const request = new OpaqueTestRequest(sourceUrl, {
      credentials: 'include',
      headers: { authorization: 'synthetic-sentinel' },
    }) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await page.pageWindow.fetch(request);

    await vi.waitFor(() =>
      expect(opaqueReplaySnapshotOf(page)).toEqual({
        kind: 'error',
        code: 'replay-dispatch-failed',
        singularDispatchCount: 1,
      })
    );
    expect(page.originalFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'a cross-origin source URL',
      `https://example.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      'target-mismatch',
    ],
    [
      'a wrong source path',
      `https://chatgpt.com/backend-api/conversation/${CONVERSATION_ID}?include_has_versions=true&num_turns=10`,
      'ready',
    ],
    [
      'a duplicate source query key',
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}?include_has_versions=true&num_turns=10&num_turns=10`,
      'target-mismatch',
    ],
  ])('never clones or replays %s', async (_label, sourceUrl, expectedState) => {
    const clone = vi.spyOn(OpaqueTestRequest.prototype, 'clone');
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
      OpaqueTestRequest
    );
    const request = new OpaqueTestRequest(sourceUrl, {
      credentials: 'include',
      headers: { authorization: 'synthetic-sentinel' },
    }) as unknown as Request;
    try {
      startChatGptDocumentStartCapture(page.pageWindow);
      await page.pageWindow.fetch(request);
      if (expectedState === 'ready')
        expect(opaqueReplaySnapshotOf(page)).toEqual({ kind: 'ready' });
      else {
        expect(opaqueReplaySnapshotOf(page)).toEqual({
          kind: 'error',
          code: expectedState,
          singularDispatchCount: 0,
        });
      }
      expect(clone).not.toHaveBeenCalled();
      expect(page.originalFetch).toHaveBeenCalledOnce();
    } finally {
      clone.mockRestore();
    }
  });

  it.each([
    ['an asynchronously rejected singular replay', 'replay-rejected'],
    ['an oversized singular response', 'payload-too-large'],
  ] as const)('does not retry %s', async (label, expectedCode) => {
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const sourceResponse = new Response('{}', { headers: { 'content-type': 'application/json' } });
    const oversized = new Response(new Uint8Array(16 * 1024 * 1024 + 1), {
      headers: { 'content-type': 'application/json' },
    });
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      input => {
        if ((input as OpaqueTestRequest).url === sourceUrl) return Promise.resolve(sourceResponse);
        return label === 'an asynchronously rejected singular replay'
          ? Promise.reject(new Error('synthetic replay rejection'))
          : Promise.resolve(oversized);
      },
      OpaqueTestRequest
    );
    const request = new OpaqueTestRequest(sourceUrl, {
      credentials: 'include',
      headers: { authorization: 'synthetic-sentinel' },
    }) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await page.pageWindow.fetch(request);

    await vi.waitFor(
      () =>
        expect(opaqueReplaySnapshotOf(page)).toEqual({
          kind: 'error',
          code: expectedCode,
          singularDispatchCount: 1,
        }),
      { timeout: 5_000 }
    );
    expect(page.originalFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [500, 'application/json', 'replay-http-error'],
    [200, 'text/plain', 'replay-non-json'],
  ])(
    'rejects singular response metadata %s/%s without retry',
    async (status, contentType, code) => {
      const sourceUrl =
        `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
        '?include_has_versions=true&num_turns=10';
      const page = fakePage(
        `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
        async input =>
          (input as OpaqueTestRequest).url === sourceUrl
            ? new Response('{}', { headers: { 'content-type': 'application/json' } })
            : new Response(status === 200 ? '{}' : null, {
                status,
                headers: { 'content-type': contentType },
              }),
        OpaqueTestRequest
      );
      const request = new OpaqueTestRequest(sourceUrl, {
        credentials: 'include',
        headers: { authorization: 'synthetic-sentinel' },
      }) as unknown as Request;
      startChatGptDocumentStartCapture(page.pageWindow);

      await page.pageWindow.fetch(request);

      await vi.waitFor(() =>
        expect(opaqueReplaySnapshotOf(page)).toEqual({
          kind: 'error',
          code,
          singularDispatchCount: 1,
        })
      );
      expect(page.originalFetch).toHaveBeenCalledTimes(2);
    }
  );

  it('contains a replay response clone failure without retrying', async () => {
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const sourceResponse = new Response('{}', { headers: { 'content-type': 'application/json' } });
    const replayResponse = new Response('{}', { headers: { 'content-type': 'application/json' } });
    const originalClone = Response.prototype.clone;
    const clone = vi.spyOn(Response.prototype, 'clone').mockImplementation(function () {
      if (this === replayResponse) throw new Error('synthetic replay clone failure');
      return originalClone.call(this);
    });
    try {
      const page = fakePage(
        `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
        async input =>
          (input as OpaqueTestRequest).url === sourceUrl ? sourceResponse : replayResponse,
        OpaqueTestRequest
      );
      const request = new OpaqueTestRequest(sourceUrl, {
        credentials: 'include',
        headers: { authorization: 'synthetic-sentinel' },
      }) as unknown as Request;
      startChatGptDocumentStartCapture(page.pageWindow);

      await page.pageWindow.fetch(request);

      await vi.waitFor(() =>
        expect(opaqueReplaySnapshotOf(page)).toEqual({
          kind: 'error',
          code: 'response-processing-failed',
          singularDispatchCount: 1,
        })
      );
      expect(page.originalFetch).toHaveBeenCalledTimes(2);
    } finally {
      clone.mockRestore();
    }
  });

  it('contains a captured Promise.then failure while observing the source response', async () => {
    class ThrowingThenPromise {
      then(): never {
        throw new Error('synthetic captured then failure');
      }
    }
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const sourceResponse = new Response('{}', {
      headers: { 'content-type': 'application/json' },
    });
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      async () => sourceResponse,
      OpaqueTestRequest
    );
    page.pageWindow.Promise = ThrowingThenPromise as unknown as PromiseConstructor;
    const request = new OpaqueTestRequest(sourceUrl, {
      credentials: 'include',
      headers: { authorization: 'synthetic-sentinel' },
    }) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await expect(page.pageWindow.fetch(request)).resolves.toBe(sourceResponse);

    expect(opaqueReplaySnapshotOf(page)).toEqual({
      kind: 'error',
      code: 'source-http-error',
      singularDispatchCount: 0,
    });
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('contains a later captured Promise.then failure while observing replay', async () => {
    let thenCalls = 0;
    class ThirdThenThrows {
      then(this: Promise<unknown>, ...handlers: unknown[]): Promise<unknown> {
        thenCalls += 1;
        if (thenCalls === 3) throw new Error('synthetic replay then failure');
        return Reflect.apply(Promise.prototype.then, this, handlers) as Promise<unknown>;
      }
    }
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
      OpaqueTestRequest
    );
    page.pageWindow.Promise = ThirdThenThrows as unknown as PromiseConstructor;
    const request = new OpaqueTestRequest(sourceUrl, {
      credentials: 'include',
      headers: { authorization: 'synthetic-sentinel' },
    }) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await page.pageWindow.fetch(request);

    await vi.waitFor(() =>
      expect(opaqueReplaySnapshotOf(page)).toEqual({
        kind: 'error',
        code: 'response-processing-failed',
        singularDispatchCount: 1,
      })
    );
    expect(page.originalFetch).toHaveBeenCalledTimes(2);
  });

  it('contains a rejected secondary source observation without replay', async () => {
    let thenCalls = 0;
    class FirstObservationRejects {
      then(this: Promise<unknown>, ...handlers: unknown[]): Promise<unknown> {
        thenCalls += 1;
        if (thenCalls === 1) return Promise.reject(new Error('synthetic source observation'));
        return Reflect.apply(Promise.prototype.then, this, handlers) as Promise<unknown>;
      }
    }
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const sourceResponse = new Response('{}', {
      headers: { 'content-type': 'application/json' },
    });
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      async () => sourceResponse,
      OpaqueTestRequest
    );
    page.pageWindow.Promise = FirstObservationRejects as unknown as PromiseConstructor;
    const request = new OpaqueTestRequest(sourceUrl, {
      credentials: 'include',
      headers: { authorization: 'synthetic-sentinel' },
    }) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await expect(page.pageWindow.fetch(request)).resolves.toBe(sourceResponse);

    await vi.waitFor(() =>
      expect(opaqueReplaySnapshotOf(page)).toEqual({
        kind: 'error',
        code: 'source-http-error',
        singularDispatchCount: 0,
      })
    );
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('contains a rejected secondary replay observation without retry', async () => {
    let thenCalls = 0;
    class ReplayObservationRejects {
      then(this: Promise<unknown>, ...handlers: unknown[]): Promise<unknown> {
        thenCalls += 1;
        if (thenCalls === 3) return Promise.reject(new Error('synthetic replay observation'));
        return Reflect.apply(Promise.prototype.then, this, handlers) as Promise<unknown>;
      }
    }
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
      OpaqueTestRequest
    );
    page.pageWindow.Promise = ReplayObservationRejects as unknown as PromiseConstructor;
    const request = new OpaqueTestRequest(sourceUrl, {
      credentials: 'include',
      headers: { authorization: 'synthetic-sentinel' },
    }) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await page.pageWindow.fetch(request);

    await vi.waitFor(() =>
      expect(opaqueReplaySnapshotOf(page)).toEqual({
        kind: 'error',
        code: 'response-processing-failed',
        singularDispatchCount: 1,
      })
    );
    expect(page.originalFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps replay observer failures transparent to a synchronous source fetch error', () => {
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      () => {
        throw new Error('synthetic synchronous source failure');
      },
      OpaqueTestRequest
    );
    const request = new OpaqueTestRequest(sourceUrl, {
      credentials: 'include',
      headers: { authorization: 'synthetic-sentinel' },
    }) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    expect(() => page.pageWindow.fetch(request)).toThrow('synthetic synchronous source failure');
    expect(opaqueReplaySnapshotOf(page)).toEqual({
      kind: 'error',
      code: 'source-rejected',
      singularDispatchCount: 0,
    });
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('fails source metadata closed for a non-Response object without replay', async () => {
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const malformed = {} as Response;
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      async () => malformed,
      OpaqueTestRequest
    );
    const request = new OpaqueTestRequest(sourceUrl, {
      credentials: 'include',
      headers: { authorization: 'synthetic-sentinel' },
    }) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await expect(page.pageWindow.fetch(request)).resolves.toBe(malformed);
    await vi.waitFor(() =>
      expect(opaqueReplaySnapshotOf(page)).toEqual({
        kind: 'error',
        code: 'source-http-error',
        singularDispatchCount: 0,
      })
    );
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('reports a replay Request-construction failure without dispatching singular fetch', async () => {
    class ThrowingReplayRequest extends OpaqueTestRequest {
      constructor(url: string, init: ConstructorParameters<typeof OpaqueTestRequest>[1] = {}) {
        if (url.includes('/backend-api/conversation/')) {
          throw new Error('synthetic replay constructor failure');
        }
        super(url, init);
      }
    }
    for (const property of ['url', 'method', 'credentials', 'headers']) {
      const descriptor = Object.getOwnPropertyDescriptor(OpaqueTestRequest.prototype, property);
      if (descriptor !== undefined) {
        Object.defineProperty(ThrowingReplayRequest.prototype, property, descriptor);
      }
    }
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
      ThrowingReplayRequest
    );
    const request = new ThrowingReplayRequest(sourceUrl, {
      credentials: 'include',
      headers: { authorization: 'synthetic-sentinel' },
    }) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);

    await page.pageWindow.fetch(request);

    await vi.waitFor(() =>
      expect(opaqueReplaySnapshotOf(page)).toEqual({
        kind: 'error',
        code: 'replay-construction-failed',
        singularDispatchCount: 0,
      })
    );
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('refuses a pre-existing replay state key without wrapping page fetch', () => {
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    Object.defineProperty(page.pageWindow, OPAQUE_REPLAY_STATE_KEY, {
      configurable: true,
      value: { kind: 'ready' },
    });

    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });
    expect(page.pageWindow.fetch).toBe(page.originalFetch);
  });

  it('contains a replay-state publication failure before wrapping page fetch', () => {
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    const NativeObject = page.pageWindow.Object;
    page.pageWindow.Object = new Proxy(NativeObject, {
      get(target, property, receiver) {
        if (property === 'defineProperty') {
          return () => {
            throw new Error('synthetic defineProperty failure');
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });
    expect(page.pageWindow.fetch).toBe(page.originalFetch);
  });

  it('contains the same state-publication failure in zero-dispatch probe mode', () => {
    const page = fakePage(
      markedOpaqueProbeUrl(),
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    const NativeObject = page.pageWindow.Object;
    page.pageWindow.Object = new Proxy(NativeObject, {
      get(target, property, receiver) {
        if (property === 'defineProperty') {
          return () => {
            throw new Error('synthetic defineProperty failure');
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });
    expect(page.pageWindow.fetch).toBe(page.originalFetch);
  });

  it('keeps replay classification transparent when a captured URL getter throws', async () => {
    class ThrowingPathURL extends NodeURL {}
    for (const property of [
      'href',
      'origin',
      'username',
      'password',
      'pathname',
      'search',
      'hash',
    ]) {
      const descriptor = Object.getOwnPropertyDescriptor(NodeURL.prototype, property);
      if (descriptor !== undefined) {
        Object.defineProperty(ThrowingPathURL.prototype, property, descriptor);
      }
    }
    Object.defineProperty(ThrowingPathURL.prototype, 'pathname', {
      configurable: true,
      get: () => {
        throw new Error('synthetic URL getter failure');
      },
    });
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    const response = new Response('{}');
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      async () => response,
      OpaqueTestRequest
    );
    page.pageWindow.URL = ThrowingPathURL as unknown as typeof URL;
    const request = new OpaqueTestRequest(sourceUrl, {
      credentials: 'include',
      headers: { authorization: 'synthetic-sentinel' },
    }) as unknown as Request;
    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({ kind: 'ready' });

    await expect(page.pageWindow.fetch(request)).resolves.toBe(response);

    expect(opaqueReplaySnapshotOf(page)).toEqual({ kind: 'ready' });
    expect(page.originalFetch).toHaveBeenCalledOnce();
  });

  it('aborts a hanging singular replay at the bounded deadline without a retry', async () => {
    vi.useFakeTimers();
    const sourceUrl =
      `https://chatgpt.com/backend-api/conversations/${CONVERSATION_ID}` +
      '?include_has_versions=true&num_turns=10';
    let singular: OpaqueTestRequest | undefined;
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      input => {
        if ((input as OpaqueTestRequest).url === sourceUrl) {
          return Promise.resolve(
            new Response('{}', { headers: { 'content-type': 'application/json' } })
          );
        }
        singular = input as OpaqueTestRequest;
        return new Promise<Response>(() => undefined);
      },
      OpaqueTestRequest
    );
    const request = new OpaqueTestRequest(sourceUrl, {
      credentials: 'include',
      headers: { authorization: 'synthetic-sentinel' },
    }) as unknown as Request;
    startChatGptDocumentStartCapture(page.pageWindow);
    await page.pageWindow.fetch(request);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(180_000);

    expect(opaqueReplaySnapshotOf(page)).toEqual({
      kind: 'error',
      code: 'timed-out',
      singularDispatchCount: 1,
    });
    expect(singular?.signal?.aborted).toBe(true);
    expect(page.originalFetch).toHaveBeenCalledTimes(2);
  });

  it('fails before wrapping fetch when required replay primordials are unavailable', () => {
    const page = fakePage(
      `https://chatgpt.com/c/${CONVERSATION_ID}#liska-capture=${NONCE}&liska-opaque-replay=1`,
      async () => new Response('{}'),
      OpaqueTestRequest
    );
    page.pageWindow.AbortController = undefined as unknown as typeof AbortController;

    expect(startChatGptDocumentStartCapture(page.pageWindow)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });
    expect(page.pageWindow.fetch).toBe(page.originalFetch);
  });
});
