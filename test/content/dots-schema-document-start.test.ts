import { URL as NodeURL } from 'node:url';
import { TextDecoder, TextEncoder } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDotsSchemaDocumentStartProbe } from '../../src/content/capture/dots-schema-document-start';
import { isDotsSchemaProbeEvidence } from '../../src/lib/dots-schema-probe-contract';
import { readDotsSchemaProbeState } from '../../src/lib/dots-schema-probe-page-state';

const NONCE = '01234567-89ab-4cde-8f01-23456789abcd';
const STATE = `__liskaDotsSchemaProbe_${NONCE}`;
const ROOM = '/backend-api/messaging/rooms/room-abc_123';
const MESSAGES = `${ROOM}/messages?limit=100`;
const BASE = 'https://chatgpt.com/dots/home';
const MARKED = `${BASE}#liska-dots-schema=${NONCE}`;
const ENCODER = new TextEncoder();

class TestRequest {
  readonly #url: string;
  readonly #method: string;

  constructor(url: string, method = 'GET') {
    this.#url = url;
    this.#method = method;
  }
  get url(): string {
    return this.#url;
  }
  get method(): string {
    return this.#method;
  }
  get headers(): never {
    throw new Error('request headers must stay private');
  }
  get body(): never {
    throw new Error('request body must stay private');
  }
}

type ResponseOptions = {
  status?: number;
  redirected?: boolean;
  mediaType?: string;
  bytes?: Uint8Array;
  stream?: () => ReadableStream<Uint8Array>;
};

class TestResponse {
  readonly #url: string;
  readonly #status: number;
  readonly #redirected: boolean;
  readonly #headers: Headers;
  readonly #stream: () => ReadableStream<Uint8Array>;
  readonly #body: ReadableStream<Uint8Array>;
  cloneCount = 0;

  constructor(url: string, text = '{}', options: ResponseOptions = {}) {
    this.#url = url;
    this.#status = options.status ?? 200;
    this.#redirected = options.redirected ?? false;
    this.#headers = new Headers({ 'content-type': options.mediaType ?? 'application/json' });
    const bytes = options.bytes ?? ENCODER.encode(text);
    this.#stream =
      options.stream ??
      (() =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }));
    this.#body = this.#stream();
  }

  get url(): string {
    return this.#url;
  }
  get status(): number {
    return this.#status;
  }
  get redirected(): boolean {
    return this.#redirected;
  }
  get headers(): Headers {
    return this.#headers;
  }
  get body(): ReadableStream<Uint8Array> {
    return this.#body;
  }
  clone(): TestResponse {
    this.cloneCount += 1;
    return new TestResponse(this.#url, '', { stream: this.#stream });
  }
}

type Page = {
  window: Window & typeof globalThis;
  fetch: ReturnType<typeof vi.fn>;
  responses: TestResponse[];
};

const pages: Page[] = [];

function fakePage(
  href = MARKED,
  respond?: (input: RequestInfo | URL, init?: RequestInit) => Promise<TestResponse>
): Page {
  const responses: TestResponse[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? new NodeURL(input, 'https://chatgpt.com').href
        : input instanceof TestRequest
          ? input.url
          : String(input);
    const response = respond ? await respond(input, init) : new TestResponse(url);
    responses.push(response);
    return response as unknown as Response;
  });
  const pageDocument = document.implementation.createHTMLDocument();
  const base = pageDocument.createElement('base');
  base.href = href;
  pageDocument.head.append(base);
  const pageWindow = {
    location: { href },
    document: pageDocument,
    fetch,
    Object,
    Reflect,
    Array,
    JSON,
    URL: NodeURL,
    TextDecoder,
    Uint8Array,
    RegExp,
    Symbol,
    Promise,
    Request: TestRequest,
    Response: TestResponse,
    Headers,
    ReadableStream,
    ReadableStreamDefaultReader,
    Node,
    setTimeout: (callback: TimerHandler, delay: number) => globalThis.setTimeout(callback, delay),
    clearTimeout: (timer: number) => globalThis.clearTimeout(timer),
  } as unknown as Window & typeof globalThis;
  const page = { window: pageWindow, fetch, responses };
  pages.push(page);
  return page;
}

function snapshot(page: Page): unknown {
  return Object.getOwnPropertyDescriptor(page.window, STATE)?.get?.call(page.window);
}

async function tick(milliseconds = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(milliseconds);
}

async function pair(page: Page, first = ROOM, second = MESSAGES): Promise<void> {
  await page.window.fetch(first);
  await page.window.fetch(second);
  await tick();
}

function completed(page: Page): Record<string, unknown> {
  const state = snapshot(page) as { kind: string; projection: Record<string, unknown> };
  expect(state.kind).toBe('completed');
  return state.projection;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  pages.length = 0;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Dots schema document-start admission', () => {
  it('does not access fetch without the exact marker', () => {
    const page = {
      location: { href: 'https://chatgpt.com/dots/home' },
      get fetch() {
        throw new Error('inert entry must not inspect fetch');
      },
    } as unknown as Window & typeof globalThis;
    expect(startDotsSchemaDocumentStartProbe(page)).toEqual({ kind: 'inert' });
  });

  it.each([
    `http://chatgpt.com/dots/home#liska-dots-schema=${NONCE}`,
    `https://chatgpt.com:443/dots/home#liska-dots-schema=${NONCE}`,
    `https://user@chatgpt.com/dots/home#liska-dots-schema=${NONCE}`,
    `https://chatgpt.com.evil.test/dots/home#liska-dots-schema=${NONCE}`,
    `https://chatgpt.com/Dots/home#liska-dots-schema=${NONCE}`,
    `https://chatgpt.com/dots/home/extra#liska-dots-schema=${NONCE}`,
    `https://chatgpt.com/dots/home/#liska-dots-schema=${NONCE}`,
    `https://chatgpt.com/dots/%68ome#liska-dots-schema=${NONCE}`,
    `https://chatgpt.com/dots/home?x=1#liska-dots-schema=${NONCE}`,
    `https://chatgpt.com/dots/home#liska-dots-schema=${NONCE}&other=1`,
    'https://chatgpt.com/dots/home#liska-dots-schema=short',
    `https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd#liska-dots-schema=${NONCE}`,
  ])('rejects nonexact marked URL %s', href => {
    const page = fakePage(href);
    expect(startDotsSchemaDocumentStartProbe(page.window)).toEqual({ kind: 'inert' });
    expect(page.window.fetch).toBe(page.fetch);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['/dots', '/dots/home', '/dots/dot-123~user-456'])('admits exact %s once', path => {
    const page = fakePage(`https://chatgpt.com${path}#liska-dots-schema=${NONCE}`);
    expect(startDotsSchemaDocumentStartProbe(page.window)).toEqual({ kind: 'ready' });
    const first = page.window.fetch;
    expect(first).not.toBe(page.fetch);
    expect(snapshot(page)).toEqual({ kind: 'ready' });
    expect(startDotsSchemaDocumentStartProbe(page.window)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });
    expect(page.window.fetch).toBe(first);
    expect(vi.getTimerCount()).toBe(2);
  });

  it('refuses missing native stream/decoder primitives without replacing fetch', () => {
    const page = fakePage();
    Object.assign(page.window, { TextDecoder: undefined });
    expect(startDotsSchemaDocumentStartProbe(page.window)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });
    expect(page.window.fetch).toBe(page.fetch);
  });
});

describe('Dots exact route and pair observation', () => {
  it.each([
    [ROOM, MESSAGES],
    [MESSAGES, ROOM],
  ])('accepts either endpoint order, waits the full window', async (first, second) => {
    const page = fakePage();
    startDotsSchemaDocumentStartProbe(page.window);
    await pair(page, first, second);
    expect(snapshot(page)).toEqual({ kind: 'ready' });
    await tick(14_999);
    expect(snapshot(page)).toEqual({ kind: 'ready' });
    await tick(1);
    expect(completed(page)).toMatchObject({
      schema: 'liska-dots-schema-probe/1',
      scope: {
        pairing: 'same-room',
        historyCompleteness: 'unverified',
        currentConversationIdentity: 'unverified',
        valuesRetained: false,
      },
      endpoints: {
        roomMetadata: {
          method: 'GET',
          pathPattern: '/backend-api/messaging/rooms/{room}',
          mediaType: 'application/json',
        },
        roomMessages: {
          method: 'GET',
          pathPattern: '/backend-api/messaging/rooms/{room}/messages?limit={redacted}',
          mediaType: 'application/json',
        },
      },
    });
    expect(page.responses.map(response => response.cloneCount)).toEqual([1, 1]);
    expect(isDotsSchemaProbeEvidence(completed(page))).toBe(true);
    expect(page.window.fetch).toBe(page.fetch);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forwards the exact fetch receiver, arguments, response promise and rejection', async () => {
    const page = fakePage();
    const response = new TestResponse('https://chatgpt.com/unrelated');
    const promise = Promise.resolve(response as unknown as Response);
    page.fetch.mockImplementation(() => promise);
    startDotsSchemaDocumentStartProbe(page.window);
    const receiver = {};
    const input = 'https://chatgpt.com/unrelated';
    const init = { method: 'POST', headers: { private: 'not-inspected' } };
    expect(Reflect.apply(page.window.fetch, receiver, [input, init])).toBe(promise);
    expect(page.fetch).toHaveBeenCalledExactlyOnceWith(input, init);
    expect(page.fetch.mock.contexts[0]).toBe(receiver);
    const rejected = Promise.reject(new Error('original failure'));
    page.fetch.mockImplementation(() => rejected);
    const result = page.window.fetch('/unrelated');
    expect(result).toBe(rejected);
    await expect(result).rejects.toThrow('original failure');
    expect(snapshot(page)).toEqual({ kind: 'ready' });
  });

  it('accepts branded native Request URL and GET without reading its headers/body', async () => {
    const page = fakePage();
    startDotsSchemaDocumentStartProbe(page.window);
    await page.window.fetch(new TestRequest(`https://chatgpt.com${ROOM}`) as unknown as Request);
    await page.window.fetch(
      new TestRequest(`https://chatgpt.com${MESSAGES}`, 'get') as unknown as Request,
      null as unknown as RequestInit
    );
    await tick(15_000);
    completed(page);
  });

  it.each(['string', 'native Request'] as const)(
    'classifies present init on an exact %s route without inspecting the object',
    async kind => {
      const traps = vi.fn(() => {
        throw new Error('RequestInit stays untouched');
      });
      const init = new Proxy(
        {},
        {
          get: traps,
          ownKeys: traps,
          getOwnPropertyDescriptor: traps,
          getPrototypeOf: traps,
          has: traps,
        }
      );
      const page = fakePage();
      startDotsSchemaDocumentStartProbe(page.window);
      const input =
        kind === 'string'
          ? MESSAGES
          : (new TestRequest(`https://chatgpt.com${ROOM}`) as unknown as Request);
      await page.window.fetch(input, init);
      expect(snapshot(page)).toEqual({ kind: 'ready' });
      await tick(15_000);
      expect(traps).not.toHaveBeenCalled();
      // Deep mock-argument matchers may reflect a Proxy themselves; compare
      // only identity so the assertion cannot manufacture an init read.
      expect(page.fetch.mock.calls.length).toBe(1);
      expect(page.fetch.mock.calls[0][0] === input).toBe(true);
      expect(page.fetch.mock.calls[0][1] === init).toBe(true);
      expect(snapshot(page)).toEqual({ kind: 'error', code: 'request-init-present' });
      expect(page.responses[0].cloneCount).toBe(0);
      expect(page.window.fetch).toBe(page.fetch);
      expect(vi.getTimerCount()).toBe(0);
      expect(traps).not.toHaveBeenCalled();
    }
  );

  it('does not read hostile RequestInit getters while classifying its presence', async () => {
    const getter = vi.fn(() => {
      throw new Error('RequestInit getter must not run');
    });
    const init: RequestInit = {};
    for (const field of ['method', 'headers', 'body', 'credentials', 'signal'])
      Object.defineProperty(init, field, { get: getter, enumerable: true });
    const page = fakePage();
    startDotsSchemaDocumentStartProbe(page.window);
    await page.window.fetch(ROOM, init);
    await tick(15_000);
    expect(getter).not.toHaveBeenCalled();
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'request-init-present' });
    expect(page.responses[0].cloneCount).toBe(0);
  });

  it.each([undefined, null])('keeps the exact pair admitted with init=%s', async init => {
    const page = fakePage();
    startDotsSchemaDocumentStartProbe(page.window);
    await page.window.fetch(ROOM, init as RequestInit | undefined);
    await page.window.fetch(MESSAGES, init as RequestInit | undefined);
    await tick(15_000);
    completed(page);
    expect(page.responses.map(response => response.cloneCount)).toEqual([1, 1]);
  });

  it('does not classify an unrelated route or native POST as refused solely for init', async () => {
    const traps = vi.fn(() => {
      throw new Error('RequestInit stays untouched');
    });
    const init = new Proxy({}, { get: traps, ownKeys: traps, getPrototypeOf: traps });
    const page = fakePage();
    startDotsSchemaDocumentStartProbe(page.window);
    await page.window.fetch('/backend-api/tbo/by-thread/private', init);
    await page.window.fetch(
      new TestRequest(`https://chatgpt.com${ROOM}`, 'POST') as unknown as Request,
      init
    );
    await tick(15_000);
    expect(traps).not.toHaveBeenCalled();
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'target-not-observed' });
    expect(page.responses.map(response => response.cloneCount)).toEqual([0, 0]);
  });

  it('forwards a refused-init candidate receiver, arguments, promise and rejection unchanged', async () => {
    const page = fakePage();
    const response = new TestResponse(`https://chatgpt.com${ROOM}`);
    const promise = Promise.resolve(response as unknown as Response);
    const init = {};
    const receiver = {};
    page.fetch.mockImplementation(() => promise);
    startDotsSchemaDocumentStartProbe(page.window);
    expect(Reflect.apply(page.window.fetch, receiver, [ROOM, init])).toBe(promise);
    expect(page.fetch).toHaveBeenCalledExactlyOnceWith(ROOM, init);
    expect(page.fetch.mock.contexts[0]).toBe(receiver);
    await promise;
    expect(response.cloneCount).toBe(0);

    const rejected = Promise.reject(new Error('original init failure'));
    page.fetch.mockImplementation(() => rejected);
    const result = page.window.fetch(MESSAGES, init);
    expect(result).toBe(rejected);
    await expect(result).rejects.toThrow('original init failure');
    expect(page.fetch).toHaveBeenCalledTimes(2);
    expect(snapshot(page)).toEqual({ kind: 'ready' });
    await tick(15_000);
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'request-init-present' });
  });

  it('does not claim or bind init-present candidates when a strict pair later succeeds', async () => {
    const page = fakePage();
    startDotsSchemaDocumentStartProbe(page.window);
    await page.window.fetch('/backend-api/messaging/rooms/other-room', {});
    await page.window.fetch(ROOM, {});
    await pair(page);
    await tick(15_000);
    completed(page);
    expect(page.responses.map(response => response.cloneCount)).toEqual([0, 0, 1, 1]);
  });

  it.each([
    `${ROOM}?limit=100`,
    `${ROOM}/messages`,
    `${MESSAGES}&limit=10`,
    `${MESSAGES}&cursor=secret`,
    `${ROOM}/messages?%6cimit=100`,
    `${ROOM}/messages?limit=`,
    `${MESSAGES}#fragment`,
    `${ROOM}/messages?limit=100%20`,
    `${ROOM}/live`,
    `${ROOM}/aeon/prepare`,
    '/backend-api/tbo/by-thread/private',
    '/backend-api/tbo/dot~user/threads?include_hidden&limit=100',
    '/backend-api/messaging/rooms/room%2Fprivate',
    '/backend-api/messaging/rooms/room/../room-abc_123',
    `https://chatgpt.com:443${ROOM}`,
    `https://private@chatgpt.com${ROOM}`,
    `https://chatgpt.com.evil.test${ROOM}`,
    `http://chatgpt.com${ROOM}`,
    `${ROOM}/`,
    `${ROOM}/messages/`,
  ])('does not clone unrelated or inexact route %s', async route => {
    const page = fakePage();
    startDotsSchemaDocumentStartProbe(page.window);
    await page.window.fetch(route);
    await tick(15_000);
    expect(page.responses[0].cloneCount).toBe(0);
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'target-not-observed' });
  });

  it('ignores POST native Requests and coercible URL objects', async () => {
    const page = fakePage();
    startDotsSchemaDocumentStartProbe(page.window);
    await page.window.fetch(
      new TestRequest(`https://chatgpt.com${ROOM}`, 'POST') as unknown as Request
    );
    await page.window.fetch(new NodeURL(`https://chatgpt.com${ROOM}`) as unknown as URL);
    await tick(15_000);
    expect(page.responses.map(response => response.cloneCount)).toEqual([0, 0]);
  });

  it.each([false, true])(
    'second room is ambiguous before cloning, even after pair ready=%s',
    async afterPair => {
      const page = fakePage();
      startDotsSchemaDocumentStartProbe(page.window);
      if (afterPair) await pair(page);
      else await page.window.fetch(ROOM);
      await page.window.fetch('/backend-api/messaging/rooms/other-room/messages?limit=100');
      await tick();
      expect(snapshot(page)).toEqual({ kind: 'error', code: 'ambiguous-room' });
      expect(page.responses.at(-1)?.cloneCount).toBe(0);
      expect(page.window.fetch).toBe(page.fetch);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each([ROOM, MESSAGES])(
    'duplicate endpoint %s invalidates the result before another clone',
    async duplicate => {
      const page = fakePage();
      startDotsSchemaDocumentStartProbe(page.window);
      await pair(page);
      await page.window.fetch(duplicate);
      await tick();
      expect(snapshot(page)).toEqual({ kind: 'error', code: 'duplicate-endpoint' });
      expect(page.responses.at(-1)?.cloneCount).toBe(0);
    }
  );

  it('refuses a navigation instead of publishing schemas for another selected route', async () => {
    const page = fakePage();
    startDotsSchemaDocumentStartProbe(page.window);
    await pair(page);
    Object.assign(page.window.location, { href: 'https://chatgpt.com/dots/another' });
    await tick(15_000);
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'navigation-changed' });
  });

  it('completes the same-room pair after the host removes only the probe fragment', async () => {
    const page = fakePage();
    startDotsSchemaDocumentStartProbe(page.window);
    expect(snapshot(page)).toEqual({ kind: 'ready' });
    Object.assign(page.window.location, { href: BASE });
    await pair(page);
    await tick(15_000);
    expect(isDotsSchemaProbeEvidence(completed(page))).toBe(true);
    expect(page.responses.map(response => response.cloneCount)).toEqual([1, 1]);
    expect(page.window.fetch).toBe(page.fetch);
  });

  it.each([false, true])(
    'keeps the fixed refusal after host fragment removal with init present=%s',
    async initPresent => {
      const page = fakePage();
      startDotsSchemaDocumentStartProbe(page.window);
      Object.assign(page.window.location, { href: BASE });
      if (initPresent) await page.window.fetch(ROOM, {});
      await tick(15_000);
      expect(snapshot(page)).toEqual({
        kind: 'error',
        code: initPresent ? 'request-init-present' : 'target-not-observed',
      });
      expect(page.responses.every(response => response.cloneCount === 0)).toBe(true);
      expect(page.window.fetch).toBe(page.fetch);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each([
    `${BASE}#other`,
    `${BASE}#liska-dots-schema=other-operation-12345678`,
    `${BASE}?x=1`,
    `${BASE}/`,
    'https://chatgpt.com/dots/another',
    'https://other.test/dots/home',
  ])('does not treat another URL as host fragment cleanup: %s', async href => {
    const page = fakePage();
    startDotsSchemaDocumentStartProbe(page.window);
    await pair(page);
    Object.assign(page.window.location, { href });
    await tick(15_000);
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'navigation-changed' });
  });

  it('does not resolve relative requests against an unrelated document base', async () => {
    const page = fakePage();
    page.window.document.querySelector('base')!.href = 'https://other.test/';
    startDotsSchemaDocumentStartProbe(page.window);
    await page.window.fetch(ROOM);
    await tick(15_000);
    expect(page.responses[0].cloneCount).toBe(0);
  });
});

describe('Dots response and clone bounds', () => {
  it.each([
    [{ status: 403 }, 'response-http-error'],
    [{ redirected: true }, 'response-route-mismatch'],
    [{ mediaType: 'text/html' }, 'response-media-type-invalid'],
  ] as const)('rejects response metadata %s before cloning', async (options, code) => {
    const page = fakePage(
      MARKED,
      async () => new TestResponse(`https://chatgpt.com${ROOM}`, '{}', options)
    );
    startDotsSchemaDocumentStartProbe(page.window);
    await page.window.fetch(ROOM);
    await tick();
    expect(snapshot(page)).toEqual({ kind: 'error', code });
    expect(page.responses[0].cloneCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a differing final response URL before cloning', async () => {
    const page = fakePage(
      MARKED,
      async () => new TestResponse(`https://chatgpt.com${ROOM}/messages?limit=101`)
    );
    startDotsSchemaDocumentStartProbe(page.window);
    await page.window.fetch(MESSAGES);
    await tick();
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'response-route-mismatch' });
    expect(page.responses[0].cloneCount).toBe(0);
  });

  it.each([
    [ROOM, 256 * 1024],
    [MESSAGES, 2 * 1024 * 1024],
  ])('stream-enforces %s byte cap', async (route, maximum) => {
    const cancel = vi.fn();
    const page = fakePage(
      MARKED,
      async () =>
        new TestResponse(`https://chatgpt.com${route}`, '', {
          stream: () =>
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(maximum + 1));
              },
              cancel,
            }),
        })
    );
    startDotsSchemaDocumentStartProbe(page.window);
    await page.window.fetch(route);
    await tick();
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'payload-too-large' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(page.responses[0].body.locked).toBe(false);
    expect(page.window.fetch).toBe(page.fetch);
  });

  it('accepts the exact metadata byte boundary without relying on Content-Length', async () => {
    const text = `"${'x'.repeat(256 * 1024 - 2)}"`;
    const page = fakePage(
      MARKED,
      async input => new TestResponse(`https://chatgpt.com${input}`, input === ROOM ? text : '{}')
    );
    startDotsSchemaDocumentStartProbe(page.window);
    await pair(page);
    await tick(15_000);
    completed(page);
  });

  it('times out stalled clones, does not await cancellation, leaves originals untouched', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const page = fakePage(
      MARKED,
      async input =>
        new TestResponse(`https://chatgpt.com${input}`, '', {
          stream: () => new ReadableStream({ cancel }),
        })
    );
    startDotsSchemaDocumentStartProbe(page.window);
    await pair(page);
    await tick(15_000);
    expect(snapshot(page)).toEqual({ kind: 'ready' });
    expect(page.window.fetch).toBe(page.fetch);
    await tick(5_000);
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'observer-timed-out' });
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(page.responses.every(response => !response.body.locked)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['{"messages":', 'not json', '[NaN]'])('rejects invalid JSON %s', async text => {
    const page = fakePage(
      MARKED,
      async input => new TestResponse(`https://chatgpt.com${input}`, text)
    );
    startDotsSchemaDocumentStartProbe(page.window);
    await page.window.fetch(ROOM);
    await tick();
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'response-processing-failed' });
  });

  it('rejects malformed UTF-8 instead of replacement decoding', async () => {
    const page = fakePage(
      MARKED,
      async () =>
        new TestResponse(`https://chatgpt.com${ROOM}`, '', {
          bytes: new Uint8Array([0x22, 0xc3, 0x28, 0x22]),
        })
    );
    startDotsSchemaDocumentStartProbe(page.window);
    await page.window.fetch(ROOM);
    await tick();
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'response-processing-failed' });
  });

  it('bounds endless empty clone chunks independently of bytes and timers', async () => {
    const cancel = vi.fn();
    const page = fakePage(
      MARKED,
      async () =>
        new TestResponse(`https://chatgpt.com${ROOM}`, '', {
          stream: () =>
            new ReadableStream({
              pull(controller) {
                controller.enqueue(new Uint8Array(0));
              },
              cancel,
            }),
        })
    );
    startDotsSchemaDocumentStartProbe(page.window);
    await page.window.fetch(ROOM);
    await tick();
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'schema-limit-exceeded' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not clone or publish a response that arrives after terminal ambiguity', async () => {
    let resolveResponse!: (response: TestResponse) => void;
    const delayed = new Promise<TestResponse>(resolve => {
      resolveResponse = resolve;
    });
    const page = fakePage(MARKED, async () => delayed);
    startDotsSchemaDocumentStartProbe(page.window);
    const first = page.window.fetch(ROOM);
    const second = page.window.fetch('/backend-api/messaging/rooms/second-room');
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'ambiguous-room' });
    const response = new TestResponse(`https://chatgpt.com${ROOM}`);
    resolveResponse(response);
    await Promise.all([first, second]);
    await tick(20_000);
    expect(response.cloneCount).toBe(0);
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'ambiguous-room' });
  });

  it('leaves an observer timeout terminal when provider responses arrive after the hard deadline', async () => {
    let resolveMetadata!: (response: TestResponse) => void;
    let resolveMessages!: (response: TestResponse) => void;
    const metadata = new Promise<TestResponse>(resolve => {
      resolveMetadata = resolve;
    });
    const messages = new Promise<TestResponse>(resolve => {
      resolveMessages = resolve;
    });
    const page = fakePage(MARKED, input => (input === ROOM ? metadata : messages));
    startDotsSchemaDocumentStartProbe(page.window);
    const first = page.window.fetch(ROOM);
    const second = page.window.fetch(MESSAGES);
    await tick(20_000);
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'observer-timed-out' });
    const a = new TestResponse(`https://chatgpt.com${ROOM}`);
    const b = new TestResponse(`https://chatgpt.com${MESSAGES}`);
    resolveMetadata(a);
    resolveMessages(b);
    await Promise.all([first, second]);
    await tick();
    expect(a.cloneCount + b.cloneCount).toBe(0);
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'observer-timed-out' });
  });

  it('preserves the original rejection while exposing only a fixed hook code', async () => {
    const secret = new Error('private request details');
    const page = fakePage(MARKED, async () => {
      throw secret;
    });
    startDotsSchemaDocumentStartProbe(page.window);
    await expect(page.window.fetch(ROOM)).rejects.toBe(secret);
    await tick();
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'request-failed' });
    expect(JSON.stringify(snapshot(page))).not.toContain('private');
  });
});

describe('Dots schema privacy, work limits and cleanup', () => {
  it('retains only known field names and scalar types, with canonical unions', async () => {
    const metadata =
      '{"room_id":"private-room-id","unknown-secret-key":{"memory":"private"},"__proto__":{"text":"private"},"constructor":"private","status":"active"}';
    const messages = JSON.stringify({
      messages: [
        { text: 'private message', id: 'private-id', role: 'assistant', timestamp: 123456789 },
        { role: 'user', id: 'different-id', text: 'different text', timestamp: 987654321 },
        null,
        true,
        42,
        'private scalar',
        [],
      ],
    });
    const page = fakePage(
      MARKED,
      async input =>
        new TestResponse(`https://chatgpt.com${input}`, input === ROOM ? metadata : messages)
    );
    startDotsSchemaDocumentStartProbe(page.window);
    await pair(page);
    await tick(15_000);
    const projection = completed(page);
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toMatch(
      /private|active|assistant|different|123456789|987654321|unknown-secret-key|constructor|__proto__/
    );
    expect(serialized).not.toContain('room-abc_123');
    expect(serialized).not.toContain('limit=100');
    expect(projection).toMatchObject({
      endpoints: {
        roomMetadata: {
          shape: {
            type: 'object',
            unknownProperties: 'present',
            fields: [
              { name: 'room_id', shape: { type: 'string' } },
              { name: 'status', shape: { type: 'string' } },
            ],
          },
        },
      },
    });
    const itemShapes = (
      ((projection.endpoints as Record<string, unknown>).roomMessages as Record<string, unknown>)
        .shape as { fields: Array<{ shape: { itemShapes: unknown[] } }> }
    ).fields[0].shape.itemShapes;
    expect(itemShapes).toHaveLength(6);
    const encodings = itemShapes.map(shape => JSON.stringify(shape));
    expect(encodings).toEqual([...encodings].sort());
  });

  it('does not descend into unknown-key subtrees', async () => {
    let nested: unknown = 'sensitive';
    for (let index = 0; index < 100; index += 1) nested = { text: nested };
    const page = fakePage(
      MARKED,
      async input =>
        new TestResponse(`https://chatgpt.com${input}`, JSON.stringify({ unrelated: nested }))
    );
    startDotsSchemaDocumentStartProbe(page.window);
    await pair(page);
    await tick(15_000);
    expect(JSON.stringify(completed(page))).not.toContain('sensitive');
  });

  it.each([
    [
      'depth',
      () => {
        let x: unknown = null;
        for (let i = 0; i < 14; i += 1) x = { content: x };
        return x;
      },
    ],
    [
      'properties',
      () => Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`unknown-${i}`, null])),
    ],
    ['array items', () => ({ messages: Array.from({ length: 2_001 }, () => null) })],
    [
      'array shapes',
      () => ({
        messages: Array.from({ length: 33 }, (_, i) =>
          Object.fromEntries(
            ['id', 'text', 'role', 'content', 'parts', 'status']
              .filter((_, bit) => (i & (1 << bit)) !== 0)
              .map(key => [key, 'private'])
          )
        ),
      }),
    ],
    [
      'nodes',
      () => ({
        messages: Array.from({ length: 1_900 }, () => ({
          content: { parts: Array.from({ length: 10 }, () => null) },
        })),
      }),
    ],
    [
      'serialized output',
      () => {
        const keys = [
          'attachments',
          'author',
          'content',
          'created_at',
          'cursor',
          'data',
          'has_more',
          'hidden',
          'id',
          'items',
          'message',
          'message_id',
          'messages',
          'next_cursor',
          'pagination',
          'parent_id',
          'parts',
          'results',
          'role',
          'room',
          'room_id',
          'status',
          'text',
          'thread',
          'thread_id',
          'timestamp',
          'type',
          'updated_at',
        ];
        return Object.fromEntries(
          keys.map(key => [key, Object.fromEntries(keys.map(child => [child, 1]))])
        );
      },
    ],
  ] as const)('refuses %s over-budget evidence rather than truncating', async (_label, value) => {
    const page = fakePage(
      MARKED,
      async input => new TestResponse(`https://chatgpt.com${input}`, JSON.stringify(value()))
    );
    startDotsSchemaDocumentStartProbe(page.window);
    await pair(page);
    await tick(15_000);
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'schema-limit-exceeded' });
    expect(page.window.fetch).toBe(page.fetch);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses document-start snapshots when page globals are replaced later', async () => {
    const page = fakePage();
    startDotsSchemaDocumentStartProbe(page.window);
    Object.assign(page.window, {
      JSON: {
        parse: () => {
          throw new Error('late parse');
        },
      },
      TextDecoder: undefined,
      URL: undefined,
    });
    await pair(page);
    await tick(15_000);
    completed(page);
  });

  it('never overwrites a later page-owned fetch wrapper', async () => {
    const page = fakePage();
    startDotsSchemaDocumentStartProbe(page.window);
    const later = vi.fn();
    page.window.fetch = later;
    await tick(15_000);
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'target-not-observed' });
    expect(page.window.fetch).toBe(later);
  });

  it('preserves the original fetch property enumerability on cleanup', async () => {
    const page = fakePage();
    Object.defineProperty(page.window, 'fetch', {
      value: page.fetch,
      configurable: true,
      writable: true,
      enumerable: false,
    });
    startDotsSchemaDocumentStartProbe(page.window);
    await tick(15_000);
    expect(Object.getOwnPropertyDescriptor(page.window, 'fetch')).toEqual({
      value: page.fetch,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  });

  it('returns detached snapshots and its scripting reader is self-contained', async () => {
    const page = fakePage();
    startDotsSchemaDocumentStartProbe(page.window);
    await pair(page);
    await tick(15_000);
    const first = snapshot(page) as {
      kind: string;
      projection: { scope: { valuesRetained: boolean } };
    };
    first.projection.scope.valuesRetained = true;
    expect(snapshot(page)).toMatchObject({ projection: { scope: { valuesRetained: false } } });
    vi.stubGlobal('window', page.window);
    expect(readDotsSchemaProbeState(NONCE)).toEqual(snapshot(page));
    expect(readDotsSchemaProbeState('bad')).toEqual({ kind: 'missing' });
    const serializedReader = new Function(`return (${readDotsSchemaProbeState.toString()})`)() as (
      nonce: string
    ) => unknown;
    expect(serializedReader(NONCE)).toEqual(snapshot(page));
  });
});

describe('Dots observer native-boundary failures', () => {
  it('stays inert for an unparsable marker URL', () => {
    const page = fakePage('not a URL');
    expect(startDotsSchemaDocumentStartProbe(page.window)).toEqual({ kind: 'inert' });
    expect(page.window.fetch).toBe(page.fetch);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses a missing prototype method before installing a fetch wrapper', () => {
    const page = fakePage();
    Object.assign(page.window, { Response: class MissingResponseMethods {} });
    expect(startDotsSchemaDocumentStartProbe(page.window)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });
    expect(page.window.fetch).toBe(page.fetch);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses a noncallable captured primitive before reading any request', () => {
    const page = fakePage();
    Object.assign(page.window, {
      Reflect: { ...Reflect, apply: undefined, ownKeys: Reflect.ownKeys },
    });
    expect(startDotsSchemaDocumentStartProbe(page.window)).toEqual({
      kind: 'error',
      code: 'hook-state-failed',
    });
    expect(page.window.fetch).toBe(page.fetch);
    expect(page.fetch).not.toHaveBeenCalled();
  });

  it('does not classify a Request whose native method getter fails', async () => {
    class UnreadableMethodRequest {
      get url() {
        return `https://chatgpt.com${ROOM}`;
      }
      get method(): never {
        throw new Error('private method error');
      }
    }
    const page = fakePage();
    Object.assign(page.window, { Request: UnreadableMethodRequest });
    startDotsSchemaDocumentStartProbe(page.window);
    const input = new UnreadableMethodRequest() as unknown as Request;
    await page.window.fetch(input);
    await tick(15_000);
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'target-not-observed' });
    expect(page.responses[0].cloneCount).toBe(0);
    expect(page.fetch.mock.calls[0][0]).toBe(input);
  });

  it('refuses a throwing location read without leaking its exception', async () => {
    const page = fakePage();
    startDotsSchemaDocumentStartProbe(page.window);
    Object.defineProperty(page.window.location, 'href', {
      get() {
        throw new Error('private location detail');
      },
    });
    await tick(15_000);
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'navigation-changed' });
    expect(page.window.fetch).toBe(page.fetch);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves a synchronous native Fetch exception while settling the observed request', () => {
    const failure = new Error('private synchronous fetch detail');
    const page = fakePage();
    page.fetch.mockImplementation(() => {
      throw failure;
    });
    startDotsSchemaDocumentStartProbe(page.window);
    expect(() => page.window.fetch(ROOM)).toThrow(failure);
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'request-failed' });
    expect(page.window.fetch).toBe(page.fetch);
    expect(vi.getTimerCount()).toBe(0);
    expect(JSON.stringify(snapshot(page))).not.toContain('private');
  });

  it('preserves the original response promise when attaching observation fails', async () => {
    const page = fakePage();
    const response = new TestResponse(`https://chatgpt.com${ROOM}`);
    const original = Promise.resolve(response as unknown as Response);
    page.fetch.mockImplementation(() => original);
    Object.assign(page.window, {
      Promise: {
        prototype: {
          then() {
            throw new Error('private Promise hook detail');
          },
        },
      },
    });
    startDotsSchemaDocumentStartProbe(page.window);
    expect(page.window.fetch(ROOM)).toBe(original);
    await expect(original).resolves.toBe(response);
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'response-processing-failed' });
    expect(response.cloneCount).toBe(0);
    expect(page.window.fetch).toBe(page.fetch);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles rejection of the observation chain without changing native Fetch', async () => {
    const page = fakePage();
    const response = new TestResponse(`https://chatgpt.com${ROOM}`);
    const original = Promise.resolve(response as unknown as Response);
    page.fetch.mockImplementation(() => original);
    const nativeThen = Promise.prototype.then;
    Object.assign(page.window, {
      Promise: {
        prototype: {
          then(this: Promise<unknown>, ...args: Parameters<typeof nativeThen>) {
            if (this === original) return Promise.reject(new Error('private observation failure'));
            return Reflect.apply(nativeThen, this, args);
          },
        },
      },
    });
    startDotsSchemaDocumentStartProbe(page.window);
    expect(page.window.fetch(ROOM)).toBe(original);
    await tick();
    expect(snapshot(page)).toEqual({ kind: 'error', code: 'response-processing-failed' });
    expect(response.cloneCount).toBe(0);
    expect(page.window.fetch).toBe(page.fetch);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['custom prototype', 'known-field accessor'] as const)(
    'rejects a non-JSON parsed object with %s without invoking user content',
    async kind => {
      const getter = vi.fn(() => 'private');
      const invalid =
        kind === 'custom prototype'
          ? Object.assign(Object.create({ private: true }), { text: 'private' })
          : Object.defineProperty({}, 'text', { enumerable: true, get: getter });
      const text = '{"text":"private"}';
      const page = fakePage(
        MARKED,
        async input => new TestResponse(`https://chatgpt.com${input}`, text)
      );
      Object.assign(page.window, {
        JSON: {
          parse: (source: string) => (source === text ? invalid : JSON.parse(source)),
          stringify: JSON.stringify,
        },
      });
      startDotsSchemaDocumentStartProbe(page.window);
      await page.window.fetch(ROOM);
      await tick();
      expect(snapshot(page)).toEqual({ kind: 'error', code: 'response-processing-failed' });
      expect(getter).not.toHaveBeenCalled();
      expect(page.window.fetch).toBe(page.fetch);
      expect(vi.getTimerCount()).toBe(0);
    }
  );
});
