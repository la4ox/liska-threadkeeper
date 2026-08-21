import { webcrypto } from 'node:crypto';
import { URL as NodeURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readChatGptTemporaryCaptureState } from '../../src/background/chatgpt-capture';
import { startChatGptDocumentStartCapture } from '../../src/content/capture/chatgpt-document-start';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const OTHER_CONVERSATION_ID = '11111111-2222-3333-4444-555555555555';
const NONCE = 'f8c1f0a5-b3dd-4d2a-9a11-8e915f6c3e72';
const STATE_KEY = `__liskaChatGptCapture_${NONCE}`;
const ENDPOINT = `/backend-api/conversation/${CONVERSATION_ID}`;
const CAPTURE_HASH = 'd423c7d662b356d3bcfb768944ff3b5f3f89b7086bb16e6a5afba362da09acb3';
const RESOLVER_FILE_ID = 'file-abc_123';
const RESOLVER_ENDPOINT =
  `/backend-api/files/download/${RESOLVER_FILE_ID}` +
  `?inline=true&conversation_id=${CONVERSATION_ID}`;

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

function fakePage(
  href: string,
  fetchImplementation: (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => Promise<Response> = async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
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
    Request: TestRequest as unknown as typeof globalThis.Request,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
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
});
