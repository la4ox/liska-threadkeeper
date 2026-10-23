import { webcrypto } from 'node:crypto';
import { URL as NodeURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startChatGptDocumentStartCapture } from '../../src/content/capture/chatgpt-document-start';
import { readChatGptOpaqueProbeState } from '../../src/background/chatgpt-opaque-probe';
import { readChatGptOpaqueReplayState } from '../../src/background/chatgpt-opaque-replay';

const ID = '01234567-89ab-4cde-8f01-23456789abcd';
const NONCE = 'f8c1f0a5-b3dd-4d2a-9a11-8e915f6c3e72';
const SOURCE = `https://chatgpt.com/backend-api/conversations/${ID}?num_turns=10&include_has_versions=true`;
const SINGULAR = `https://chatgpt.com/backend-api/conversation/${ID}`;
const SENTINEL = 'synthetic-authorization-private-sentinel';
const responseMetadata = new WeakMap<object, { url: unknown; redirected: unknown }>();
// Constructed Responses have no network URL. This synthetic network double
// supplies the fields a real fetch response carries, without weakening the hook.
class Response extends globalThis.Response {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body, init);
    responseMetadata.set(this, { url: SOURCE, redirected: false });
  }

  get url(): string {
    return responseMetadata.get(this)!.url as string;
  }

  get redirected(): boolean {
    return responseMetadata.get(this)!.redirected as boolean;
  }
}
Object.defineProperties(Response.prototype, {
  status: Object.getOwnPropertyDescriptor(globalThis.Response.prototype, 'status')!,
  headers: Object.getOwnPropertyDescriptor(globalThis.Response.prototype, 'headers')!,
  body: Object.getOwnPropertyDescriptor(globalThis.Response.prototype, 'body')!,
});
const NativeRequest: typeof Request =
  Object.getOwnPropertyDescriptor(Request.prototype, 'url') === undefined
    ? Object.getPrototypeOf(Request.prototype).constructor
    : Request;

const timers = new Set<ReturnType<typeof setTimeout>>();
function jsonResponse(status = 200, type = 'application/json'): Response {
  return new Response('{"synthetic":true}', { status, headers: { 'content-type': type } });
}

function setup(
  implementation: typeof fetch = async () => jsonResponse(),
  mode = 'opaque-replay',
  pagePrimitives: Partial<Pick<typeof globalThis, 'Object' | 'Reflect' | 'Node' | 'document'>> = {}
) {
  const original = vi.fn(implementation);
  const constructed: Request[] = [];
  const requestInits: RequestInit[] = [];
  const initShapes: Array<{ nullInit: boolean; nullHeaders: boolean; stringsOnly: boolean }> = [];
  const RequestSpy = new Proxy(NativeRequest, {
    construct(target, args) {
      const init = args[1] as RequestInit;
      requestInits.push(init);
      initShapes.push({
        nullInit: Object.getPrototypeOf(init) === null,
        nullHeaders: Object.getPrototypeOf(init.headers) === null,
        stringsOnly: Object.values(init.headers as object).every(
          value => typeof value === 'string'
        ),
      });
      const request = Reflect.construct(target, args) as Request;
      constructed.push(request);
      return request;
    },
  });
  const href = `https://chatgpt.com/c/${ID}#liska-capture=${NONCE}&liska-${mode}=1`;
  const pageDocument = document.implementation.createHTMLDocument();
  const base = pageDocument.createElement('base');
  base.href = href;
  pageDocument.head.append(base);
  const page = {
    location: { href },
    document: pagePrimitives.document ?? pageDocument,
    Node: pagePrimitives.Node ?? Node,
    fetch: original,
    Request: RequestSpy,
    Response,
    Headers,
    AbortController,
    ReadableStream,
    ReadableStreamDefaultReader,
    Object: pagePrimitives.Object ?? Object,
    Reflect: pagePrimitives.Reflect ?? Reflect,
    URL: NodeURL,
    URLSearchParams,
    Promise,
    Array,
    Uint8Array,
    ArrayBuffer,
    String,
    crypto: webcrypto,
    btoa,
    setTimeout: (callback: () => void, milliseconds: number) => {
      const timer = setTimeout(callback, milliseconds);
      timers.add(timer);
      return timer;
    },
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => {
      timers.delete(timer);
      clearTimeout(timer);
    },
  } as unknown as Window & typeof globalThis;
  const key =
    mode === 'opaque-probe'
      ? 'OpaqueProbe'
      : mode === 'interpreter-resolver'
        ? 'InterpreterResolver'
        : mode === 'active-resolver'
          ? 'ActiveResolver'
          : 'OpaqueReplay';
  const snapshot = () =>
    Object.getOwnPropertyDescriptor(page, `__liskaChatGpt${key}_${NONCE}`)?.get?.();
  expect(startChatGptDocumentStartCapture(page)).toEqual({ kind: 'ready' });
  return { page, base, original, constructed, requestInits, initShapes, snapshot };
}

function interpreterCandidates(count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    assetId: `chatgpt-asset-${index.toString(16).padStart(64, '0')}`,
    messageId: `synthetic_message_${index}`,
    sandboxPath: `/mnt/data/synthetic ${index} % &.txt`,
  }));
}

function interpreterCommand(fixture: ReturnType<typeof setup>) {
  return Object.getOwnPropertyDescriptor(
    fixture.page,
    `__liskaChatGptInterpreterResolverCommand_${NONCE}`
  )?.value as (value: unknown) => boolean;
}

function activeCommand(fixture: ReturnType<typeof setup>) {
  return Object.getOwnPropertyDescriptor(
    fixture.page,
    `__liskaChatGptActiveResolverCommand_${NONCE}`
  )?.value as (value: unknown) => boolean;
}

function expectHeaderRejection(fixture: ReturnType<typeof setup>, mode: string, code: string) {
  const snapshot = fixture.snapshot();
  if (mode === 'interpreter-resolver' || mode === 'active-resolver') {
    expect(snapshot).toEqual({ kind: 'error', code: 'source-not-eligible' });
    expect(fixture.constructed).toHaveLength(0);
    expect(JSON.stringify(snapshot)).not.toContain(SENTINEL);
    return;
  }
  expect(snapshot).toEqual(
    mode === 'opaque-replay'
      ? { kind: 'error', code, singularDispatchCount: 0 }
      : {
          kind: 'result',
          result: {
            observedTargetRequest: true,
            sourceIsNativeRequest: false,
            initAbsent: false,
            exactTarget: true,
            authorizationPresent: false,
            credentialsAccepted: false,
            sourceStatus: null,
            sourceJson: false,
            singularDispatchCount: 0,
            outcome: code,
          },
        }
  );
  vi.stubGlobal('window', fixture.page);
  expect(
    mode === 'opaque-replay'
      ? readChatGptOpaqueReplayState(NONCE)
      : readChatGptOpaqueProbeState(NONCE)
  ).toEqual(snapshot);
  expect(JSON.stringify(snapshot)).not.toContain(SENTINEL);
}

afterEach(() => {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('interpreter-only owned transport', () => {
  it.each([
    ['command-first', SOURCE],
    ['source-first', SOURCE],
    ['command-first', SOURCE.slice('https://chatgpt.com'.length)],
    ['source-first', SOURCE.slice('https://chatgpt.com'.length)],
  ])('dispatches two exact sequential endpoints with %s and %s', async (order, input) => {
    let resolveFirst!: (response: Response) => void;
    const firstPending = new Promise<Response>(resolve => {
      resolveFirst = resolve;
    });
    let helperCalls = 0;
    const source = jsonResponse();
    const clone = vi.spyOn(source, 'clone');
    const fixture = setup(
      request =>
        request instanceof NativeRequest
          ? ++helperCalls === 1
            ? firstPending
            : Promise.resolve(jsonResponse())
          : Promise.resolve(source),
      'interpreter-resolver'
    );
    const candidates = interpreterCandidates();
    const command = interpreterCommand(fixture);
    if (order === 'command-first') expect(command(candidates)).toBe(true);
    const headers = { Authorization: SENTINEL, 'X-Synthetic': 'before' };
    const init = { headers, signal: new AbortController().signal };
    const receiver = { synthetic: true };
    const result = Reflect.apply(fixture.page.fetch, receiver, [input, init]);
    expect(result).toBe(fixture.original.mock.results[0].value);
    await result;
    if (order === 'source-first') {
      expect(fixture.constructed).toHaveLength(0);
      expect(command(candidates)).toBe(true);
    }
    expect(command(candidates)).toBe(false);
    expect(fixture.original.mock.contexts[0]).toBe(receiver);
    expect(fixture.original.mock.calls[0]).toEqual([input, init]);
    expect(fixture.constructed).toHaveLength(1);
    expect(helperCalls).toBe(1);
    headers.Authorization = 'late-mutation';
    headers['X-Synthetic'] = 'after';
    resolveFirst(jsonResponse());
    await vi.waitFor(() =>
      expect(fixture.snapshot()).toMatchObject({
        kind: 'complete',
        requestedCount: 2,
        dispatchCount: 2,
        outcomes: [{ state: 'observed' }, { state: 'observed' }],
      })
    );
    expect(fixture.original).toHaveBeenCalledTimes(3);
    expect(fixture.constructed).toHaveLength(2);
    for (let ordinal = 0; ordinal < 2; ordinal += 1) {
      const query = new URLSearchParams({
        message_id: candidates[ordinal].messageId,
        sandbox_path: candidates[ordinal].sandboxPath,
      });
      const request = fixture.constructed[ordinal];
      expect(request.url).toBe(`${SINGULAR}/interpreter/download?${query}`);
      expect(request.url).not.toBe(SINGULAR);
      expect(request.headers.get('authorization')).toBe(SENTINEL);
      expect(request.headers.get('x-synthetic')).toBe('before');
      expect(request.credentials).toBe('same-origin');
      expect(request.method).toBe('GET');
      expect(request.redirect).toBe('error');
      expect(request.cache).toBe('no-store');
      expect(request.signal.aborted).toBe(true);
      expect(request.signal).not.toBe(init.signal);
      expect(Object.keys(fixture.requestInits[ordinal]).sort()).toEqual([
        'cache',
        'credentials',
        'headers',
        'method',
        'redirect',
        'signal',
      ]);
    }
    expect(fixture.initShapes).toEqual([
      { nullInit: true, nullHeaders: true, stringsOnly: true },
      { nullInit: true, nullHeaders: true, stringsOnly: true },
    ]);
    expect(fixture.requestInits[0].headers).toBe(fixture.requestInits[1].headers);
    expect(fixture.constructed[0].signal).not.toBe(fixture.constructed[1].signal);
    expect(clone).not.toHaveBeenCalled();
    expect(source.bodyUsed).toBe(false);
    const serialized = JSON.stringify(fixture.snapshot());
    for (const secret of [SENTINEL, 'x-synthetic', SOURCE, ...Object.values(candidates[0])])
      expect(serialized).not.toContain(secret);
    expect(timers.size).toBe(0);
  });

  it.each([undefined, 'include', 'same-origin'] as const)(
    'accepts only primitive-string plain headers with credentials %s',
    async credentials => {
      const fixture = setup(undefined, 'interpreter-resolver');
      expect(interpreterCommand(fixture)(interpreterCandidates(1))).toBe(true);
      await fixture.page.fetch(SOURCE, { headers: { Authorization: SENTINEL }, credentials });
      await vi.waitFor(() => expect(fixture.snapshot()).toMatchObject({ dispatchCount: 1 }));
      expect(fixture.constructed[0].credentials).toBe(credentials ?? 'same-origin');
    }
  );

  it.each(['command-first', 'source-first'])(
    'uses the genuine native Request plain override without cloning with %s',
    async order => {
      const source = new NativeRequest(SOURCE, {
        headers: { authorization: 'synthetic-original-secret', 'x-original-only': 'original' },
        credentials: 'include',
      });
      const sourceClone = vi.spyOn(NativeRequest.prototype, 'clone');
      const sourceBody = vi.spyOn(source, 'body', 'get');
      const response = jsonResponse();
      const responseClone = vi.spyOn(Response.prototype, 'clone');
      const sourcePromise = Promise.resolve(response);
      const fixture = setup(
        input => (input === source ? sourcePromise : Promise.resolve(jsonResponse())),
        'interpreter-resolver'
      );
      const command = interpreterCommand(fixture);
      if (order === 'command-first') expect(command(interpreterCandidates())).toBe(true);
      const headers = { Authorization: SENTINEL, 'X-Override-Only': 'override' };
      const init = { headers };
      const receiver = { syntheticNativeReceiver: true };
      const result = Reflect.apply(fixture.page.fetch, receiver, [source, init]);
      expect(result).toBe(sourcePromise);
      expect(fixture.original.mock.calls[0]).toEqual([source, init]);
      expect(fixture.original.mock.contexts[0]).toBe(receiver);
      await result;
      if (order === 'source-first') expect(command(interpreterCandidates())).toBe(true);
      await vi.waitFor(() =>
        expect(fixture.snapshot()).toMatchObject({
          kind: 'complete',
          requestedCount: 2,
          dispatchCount: 2,
          outcomes: [{ state: 'observed' }, { state: 'observed' }],
        })
      );
      expect(fixture.original).toHaveBeenCalledTimes(3);
      for (const request of fixture.constructed) {
        expect(request.headers.get('authorization')).toBe(SENTINEL);
        expect(request.headers.get('x-override-only')).toBe('override');
        expect(request.headers.has('x-original-only')).toBe(false);
        expect(request.credentials).toBe('include');
      }
      expect(fixture.initShapes).toEqual([
        { nullInit: true, nullHeaders: true, stringsOnly: true },
        { nullInit: true, nullHeaders: true, stringsOnly: true },
      ]);
      expect(sourceClone).not.toHaveBeenCalled();
      expect(responseClone.mock.contexts).not.toContain(response);
      expect(sourceBody).not.toHaveBeenCalled();
      expect(source.bodyUsed).toBe(false);
      expect(response.bodyUsed).toBe(false);
      expect(JSON.stringify(fixture.snapshot())).not.toContain(SENTINEL);
      expect(JSON.stringify(fixture.snapshot())).not.toContain('synthetic-original-secret');
    }
  );

  it.each([
    ['include', undefined, 'include'],
    ['same-origin', undefined, 'same-origin'],
    ['omit', undefined, undefined],
    ['include', 'same-origin', 'same-origin'],
    ['same-origin', 'include', 'include'],
    ['omit', 'include', 'include'],
    ['omit', 'same-origin', 'same-origin'],
    ['include', 'omit', undefined],
  ] as const)(
    'uses native source credentials %s and explicit %s as %s for plain overrides',
    async (sourceCredentials, override, expected) => {
      const source = new NativeRequest(SOURCE, { credentials: sourceCredentials });
      const clone = vi.spyOn(NativeRequest.prototype, 'clone');
      const fixture = setup(undefined, 'interpreter-resolver');
      const command = interpreterCommand(fixture);
      expect(command(interpreterCandidates(1))).toBe(true);
      await fixture.page.fetch(source, {
        headers: { authorization: SENTINEL },
        credentials: override,
      });
      await vi.waitFor(() => {
        if (expected === undefined) {
          expect(fixture.snapshot()).toEqual({ kind: 'error', code: 'source-not-eligible' });
        } else {
          expect(fixture.snapshot()).toMatchObject({ kind: 'complete', dispatchCount: 1 });
        }
      });
      if (expected === undefined) expect(fixture.constructed).toHaveLength(0);
      else expect(fixture.constructed[0].credentials).toBe(expected);
      expect(clone).not.toHaveBeenCalled();
      expect(source.bodyUsed).toBe(false);
    }
  );

  it('never falls back to original native authorization when the plain override lacks it', async () => {
    const source = new NativeRequest(SOURCE, {
      headers: { authorization: SENTINEL },
      credentials: 'include',
    });
    const clone = vi.spyOn(NativeRequest.prototype, 'clone');
    const fixture = setup(undefined, 'interpreter-resolver');
    await fixture.page.fetch(source, { headers: { 'x-authorization': SENTINEL } });
    expect(fixture.snapshot()).toEqual({ kind: 'error', code: 'source-not-eligible' });
    expect(fixture.constructed).toHaveLength(0);
    expect(fixture.original).toHaveBeenCalledOnce();
    expect(clone).not.toHaveBeenCalled();
  });

  it.each([
    'URL',
    'boxed string',
    'duck-typed Request',
    'Proxy-wrapped Request',
    'inherited Request',
    'POST',
  ])('never dispatches a native plain override from a %s input', async kind => {
    const native = new NativeRequest(SOURCE, { credentials: 'include' });
    const callback = vi.fn(() => SOURCE);
    const input =
      kind === 'URL'
        ? new NodeURL(SOURCE)
        : kind === 'boxed string'
          ? new String(SOURCE)
          : kind === 'duck-typed Request'
            ? {
                url: SOURCE,
                method: 'GET',
                credentials: 'include',
                clone: callback,
                toString: callback,
              }
            : kind === 'Proxy-wrapped Request'
              ? new Proxy(native, {})
              : kind === 'inherited Request'
                ? Object.create(native)
                : new NativeRequest(SOURCE, { method: 'POST', body: 'synthetic-source-body' });
    const fixture = setup(undefined, 'interpreter-resolver');
    expect(interpreterCommand(fixture)(interpreterCandidates(1))).toBe(true);
    await fixture.page.fetch(input as RequestInfo, { headers: { authorization: SENTINEL } });
    expect(fixture.constructed).toHaveLength(0);
    expect(fixture.original).toHaveBeenCalledOnce();
    expect(callback).not.toHaveBeenCalled();
    expect(fixture.snapshot()).not.toMatchObject({ dispatchCount: 1 });
  });

  it.each(['synchronous throw', 'promise rejection'])(
    'preserves the genuine native plain source %s exactly',
    async failure => {
      const source = new NativeRequest(SOURCE, { credentials: 'include' });
      const clone = vi.spyOn(NativeRequest.prototype, 'clone');
      const error = new Error(SENTINEL);
      const sourcePromise = Promise.reject(error);
      void sourcePromise.catch(() => undefined);
      const fixture = setup(() => {
        if (failure === 'synchronous throw') throw error;
        return sourcePromise;
      }, 'interpreter-resolver');
      const init = { headers: { authorization: SENTINEL } };
      const receiver = { syntheticNativeReceiver: true };
      const invoke = () => Reflect.apply(fixture.page.fetch, receiver, [source, init]);
      if (failure === 'synchronous throw') expect(invoke).toThrow(error);
      else {
        const result = invoke();
        expect(result).toBe(sourcePromise);
        await expect(result).rejects.toBe(error);
      }
      expect(fixture.original).toHaveBeenCalledExactlyOnceWith(source, init);
      expect(fixture.original.mock.contexts[0]).toBe(receiver);
      expect(fixture.snapshot()).toEqual({ kind: 'error', code: 'source-rejected' });
      expect(clone).not.toHaveBeenCalled();
      expect(source.bodyUsed).toBe(false);
    }
  );
});

describe('one-PNG active owned transport', () => {
  it.each(['command-first', 'source-first'])(
    'preserves primitive/native source calls and one exact PNG dispatch in %s order',
    async order => {
      for (const inputKind of ['primitive', 'native']) {
        for (const credentials of ['include', 'same-origin'] as const) {
          const source =
            inputKind === 'primitive'
              ? SOURCE
              : new NativeRequest(SOURCE, {
                  credentials: 'include',
                  headers: {
                    authorization: 'synthetic-original-secret',
                    'x-original-only': 'original',
                  },
                });
          const response = jsonResponse();
          const responseClone = vi.spyOn(response, 'clone');
          const sourcePromise = Promise.resolve(response);
          const fixture = setup(
            input => (input === source ? sourcePromise : Promise.resolve(jsonResponse())),
            'active-resolver'
          );
          const command = activeCommand(fixture);
          if (order === 'command-first') expect(command(['synthetic-png-id'])).toBe(true);
          const init = { headers: { Authorization: SENTINEL }, credentials };
          const receiver = { syntheticReceiver: true };
          const result = Reflect.apply(fixture.page.fetch, receiver, [source, init]);
          expect(result).toBe(sourcePromise);
          await result;
          if (order === 'source-first') expect(command(['synthetic-png-id'])).toBe(true);
          await vi.waitFor(() =>
            expect(fixture.snapshot()).toMatchObject({
              kind: 'complete',
              requestedCount: 1,
              dispatchCount: 1,
              outcomes: [{ state: 'observed' }],
            })
          );
          expect(fixture.original.mock.contexts[0]).toBe(receiver);
          expect(fixture.original.mock.calls[0]).toEqual([source, init]);
          expect(fixture.original).toHaveBeenCalledTimes(2);
          expect(fixture.constructed).toHaveLength(1);
          const request = fixture.constructed[0];
          expect(request.url).toBe(
            `https://chatgpt.com/backend-api/files/download/synthetic-png-id?conversation_id=${ID}&inline=false&download_intent=false&include_library_file_state=true`
          );
          expect(request.url).not.toContain('check_context_scopes');
          expect(request.headers.get('authorization')).toBe(SENTINEL);
          expect(request.headers.has('x-original-only')).toBe(false);
          expect(request.credentials).toBe(credentials);
          expect(fixture.initShapes).toEqual([
            { nullInit: true, nullHeaders: true, stringsOnly: true },
          ]);
          expect(responseClone).not.toHaveBeenCalled();
          expect(response.bodyUsed).toBe(false);
          expect(command(['synthetic-png-id'])).toBe(false);
          expect(JSON.stringify(fixture.snapshot())).not.toContain(SENTINEL);
          expect(JSON.stringify(fixture.snapshot())).not.toContain('synthetic-png-id');
          expect(timers.size).toBe(0);
        }
      }
    }
  );

  it('never falls back from a missing plain override authorization to native source headers', async () => {
    const fixture = setup(undefined, 'active-resolver');
    activeCommand(fixture)(['synthetic-png-id']);
    const source = new NativeRequest(SOURCE, {
      headers: { authorization: SENTINEL },
      credentials: 'include',
    });
    await fixture.page.fetch(source, { headers: { 'x-unrelated': 'synthetic' } });
    expect(fixture.snapshot()).toEqual({ kind: 'error', code: 'source-not-eligible' });
    expect(fixture.constructed).toHaveLength(0);
    expect(fixture.original).toHaveBeenCalledOnce();
  });

  it.each(['fetch', 'body', 'hash'])(
    'bounds stalled %s at 12 seconds and ignores its late completion',
    async phase => {
      vi.useFakeTimers();
      let resolveFetch!: (response: Response) => void;
      const pendingFetch = new Promise<Response>(resolve => {
        resolveFetch = resolve;
      });
      let bodyController!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          bodyController = controller;
        },
      });
      let resolveHash!: (value: ArrayBuffer) => void;
      const pendingHash = new Promise<ArrayBuffer>(resolve => {
        resolveHash = resolve;
      });
      const digest = vi.spyOn(webcrypto.subtle, 'digest');
      if (phase === 'hash') digest.mockImplementation(() => pendingHash);
      const helperResponse =
        phase === 'body'
          ? new Response(stream, { headers: { 'content-type': 'application/json' } })
          : jsonResponse();
      const fixture = setup(
        input =>
          input === SOURCE
            ? Promise.resolve(jsonResponse())
            : phase === 'fetch'
              ? pendingFetch
              : Promise.resolve(helperResponse),
        'active-resolver'
      );
      activeCommand(fixture)(['synthetic-png-id']);
      await fixture.page.fetch(SOURCE, { headers: { authorization: SENTINEL } });
      await vi.waitFor(() => expect(fixture.original).toHaveBeenCalledTimes(2));
      if (phase === 'hash') await vi.waitFor(() => expect(digest).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(12_001);
      const terminal = {
        kind: 'complete',
        conversationId: ID,
        requestedCount: 1,
        dispatchCount: 1,
        outcomes: [{ state: 'timed-out' }],
      };
      expect(fixture.snapshot()).toEqual(terminal);
      expect(fixture.constructed[0].signal.aborted).toBe(true);
      expect(timers.size).toBe(0);
      if (phase === 'fetch') resolveFetch(jsonResponse());
      if (phase === 'body') {
        bodyController.enqueue(new TextEncoder().encode('{}'));
        bodyController.close();
      }
      if (phase === 'hash') resolveHash(new Uint8Array(32).buffer);
      await vi.advanceTimersByTimeAsync(100);
      expect(fixture.snapshot()).toEqual(terminal);
      expect(fixture.original).toHaveBeenCalledTimes(2);
    }
  );

  it('preserves the fixed global timeout before any source dispatch', async () => {
    vi.useFakeTimers();
    const fixture = setup(undefined, 'active-resolver');
    activeCommand(fixture)(['synthetic-png-id']);
    await vi.advanceTimersByTimeAsync(180_001);
    expect(fixture.snapshot()).toEqual({ kind: 'error', code: 'resolver-result-timeout' });
    expect(fixture.constructed).toHaveLength(0);
    expect(fixture.page.fetch).toBe(fixture.original);
  });

  it('aborts an in-flight item when a state read detects same-document navigation', async () => {
    const fixture = setup(
      input =>
        input === SOURCE ? Promise.resolve(jsonResponse()) : new Promise<Response>(() => undefined),
      'active-resolver'
    );
    activeCommand(fixture)(['synthetic-png-id']);
    await fixture.page.fetch(SOURCE, { headers: { authorization: SENTINEL } });
    await vi.waitFor(() => expect(fixture.constructed).toHaveLength(1));
    fixture.page.location.href = `https://chatgpt.com/c/${ID}`;
    expect(fixture.snapshot()).toMatchObject({
      kind: 'complete',
      dispatchCount: 1,
      outcomes: [{ state: 'timed-out' }],
    });
    expect(fixture.constructed[0].signal.aborted).toBe(true);
    expect(timers.size).toBe(0);
  });
});

describe.each(['interpreter-resolver', 'active-resolver'])(
  'owned resolver transport boundary in %s',
  mode => {
    const commandFor = (fixture: ReturnType<typeof setup>) =>
      mode === 'active-resolver' ? activeCommand(fixture) : interpreterCommand(fixture);
    const candidatesFor = (count = 2): unknown =>
      mode === 'active-resolver' ? ['synthetic-png-id'] : interpreterCandidates(count);
    it.each(['empty', 'redirected'])(
      'reports a native plain source with %s actual response metadata before dispatch',
      async kind => {
        const response = jsonResponse();
        responseMetadata.set(response, {
          url: kind === 'empty' ? '' : SOURCE,
          redirected: kind === 'redirected',
        });
        const clone = vi.spyOn(response, 'clone');
        const fixture = setup(async () => response, mode);
        expect(commandFor(fixture)(candidatesFor(1))).toBe(true);
        const source = new NativeRequest(SOURCE, { credentials: 'include' });
        await fixture.page.fetch(source, { headers: { authorization: SENTINEL } });
        expect(fixture.snapshot()).toEqual({ kind: 'error', code: 'source-not-eligible' });
        expect(fixture.constructed).toHaveLength(0);
        expect(clone).not.toHaveBeenCalled();
        expect(response.bodyUsed).toBe(false);
      }
    );

    it.each([
      ['missing authorization', SOURCE, { headers: { 'x-authorization': SENTINEL } }],
      ['omit', SOURCE, { headers: { authorization: SENTINEL }, credentials: 'omit' }],
      ['POST', SOURCE, { headers: { authorization: SENTINEL }, method: 'POST' }],
      ['body', SOURCE, { headers: { authorization: SENTINEL }, body: SENTINEL }],
      ['credentials only', SOURCE, { credentials: 'include' }],
      ['cache only', SOURCE, { cache: 'no-store' }],
      ['no init', SOURCE, undefined],
      ['native headers', SOURCE, { headers: new Headers({ authorization: SENTINEL }) }],
      ['URL object', new NodeURL(SOURCE), { headers: { authorization: SENTINEL } }],
    ] as const)('rejects %s before dispatch', async (_label, input, init) => {
      const fixture = setup(undefined, mode);
      await fixture.page.fetch(input as RequestInfo, init as RequestInit);
      expect(fixture.snapshot()).toEqual({ kind: 'error', code: 'source-not-eligible' });
      expect(fixture.constructed).toHaveLength(0);
      expect(fixture.original).toHaveBeenCalledExactlyOnceWith(input, init);
      expect(commandFor(fixture)(candidatesFor(1))).toBe(false);
    });

    it.each([
      ['empty', '', false],
      ['malformed', 'https://[', false],
      ['relative', SOURCE.slice('https://chatgpt.com'.length), false],
      ['cross-origin', SOURCE.replace('chatgpt.com', 'example.invalid'), false],
      ['wrong conversation', SOURCE.replace(ID, '11111111-2222-3333-4444-555555555555'), false],
      ['singular', SINGULAR, false],
      ['extra query', `${SOURCE}&extra=1`, false],
      ['duplicate query', `${SOURCE}&num_turns=10`, false],
      ['encoded query', SOURCE.replace('num_turns', '%6eum_turns'), false],
      ['missing query', SOURCE.split('?')[0], false],
      ['username', SOURCE.replace('https://', 'https://user@'), false],
      ['password', SOURCE.replace('https://', 'https://user:password@'), false],
      ['fragment', `${SOURCE}#fragment`, false],
      ['number', 42, false],
      ['undefined', undefined, false],
      ['null', null, false],
      ['redirected', SOURCE, true],
      ['undefined redirected', SOURCE, undefined],
      ['non-boolean redirected', SOURCE, 'false'],
    ] as const)(
      'rejects actual source %s before status/header/body access in both latch orders',
      async (_label, url, redirected) => {
        for (const commandFirst of [false, true]) {
          const source = jsonResponse();
          responseMetadata.set(source, { url, redirected });
          const status = vi.spyOn(Response.prototype, 'status', 'get');
          const headers = vi.spyOn(Response.prototype, 'headers', 'get');
          const clone = vi.spyOn(source, 'clone');
          const fixture = setup(async () => source, mode);
          const command = commandFor(fixture);
          if (commandFirst) expect(command(candidatesFor())).toBe(true);
          await fixture.page.fetch(SOURCE, { headers: { authorization: SENTINEL } });
          expect(fixture.snapshot()).toEqual({ kind: 'error', code: 'source-not-eligible' });
          expect(fixture.original).toHaveBeenCalledOnce();
          expect(fixture.constructed).toHaveLength(0);
          expect(status).not.toHaveBeenCalled();
          expect(headers).not.toHaveBeenCalled();
          expect(clone).not.toHaveBeenCalled();
          expect(source.bodyUsed).toBe(false);
          expect(command(candidatesFor())).toBe(false);
          status.mockRestore();
          headers.mockRestore();
        }
      }
    );

    it.each(['init', 'headers'])(
      'rejects a base change from forwarding %s Proxy reflection without reinspecting values',
      async kind => {
        const fixture = setup(undefined, mode);
        const headers = { authorization: SENTINEL };
        const descriptor = (target: object, key: PropertyKey) => {
          fixture.base.href = 'https://example.invalid/c/synthetic';
          return Reflect.getOwnPropertyDescriptor(target, key);
        };
        const init =
          kind === 'init'
            ? new Proxy({ headers }, { getOwnPropertyDescriptor: descriptor })
            : { headers: new Proxy(headers, { getOwnPropertyDescriptor: descriptor }) };
        await fixture.page.fetch(SOURCE.slice('https://chatgpt.com'.length), init);
        expect(fixture.snapshot()).toEqual({ kind: 'error', code: 'source-not-eligible' });
        expect(fixture.constructed).toHaveLength(0);
        expect(fixture.original).toHaveBeenCalledOnce();
      }
    );

    it.each(['body', 'method', 'credentials', 'headers', 'signal', 'cache'])(
      'rejects an init %s accessor without invoking it',
      async member => {
        const getter = vi.fn(() => SENTINEL);
        const init = { headers: { authorization: SENTINEL } };
        Object.defineProperty(init, member, { enumerable: true, get: getter });
        const fixture = setup(undefined, mode);
        await fixture.page.fetch(SOURCE, init);
        expect(getter).not.toHaveBeenCalled();
        expect(fixture.snapshot()).toEqual({ kind: 'error', code: 'source-not-eligible' });
        expect(fixture.constructed).toHaveLength(0);
        expect(fixture.original).toHaveBeenCalledExactlyOnceWith(SOURCE, init);
      }
    );

    it('bounds reentrant Proxy reflection to one private resolver preparation', async () => {
      const fixture = setup(undefined, mode);
      expect(commandFor(fixture)(candidatesFor(1))).toBe(true);
      let reentered = false;
      const headers = new Proxy(
        { authorization: SENTINEL },
        {
          getPrototypeOf(target) {
            if (!reentered) {
              reentered = true;
              void fixture.page.fetch(SOURCE, {
                headers: { authorization: 'synthetic-inner-sentinel' },
              });
            }
            return Reflect.getPrototypeOf(target);
          },
        }
      );
      await fixture.page.fetch(SOURCE, { headers });
      await vi.waitFor(() =>
        expect(fixture.snapshot()).toMatchObject({ kind: 'complete', dispatchCount: 1 })
      );
      expect(reentered).toBe(true);
      expect(fixture.constructed).toHaveLength(1);
      expect(fixture.constructed[0].headers.get('authorization')).toBe(SENTINEL);
      expect(fixture.original).toHaveBeenCalledTimes(3);
    });

    it.each(['synchronous throw', 'promise rejection'])(
      'preserves the original plain-header source %s exactly',
      async failure => {
        const error = new Error(SENTINEL);
        const sourcePromise = Promise.reject(error);
        // Attach immediately so the synchronous-throw case has no unused rejection.
        void sourcePromise.catch(() => undefined);
        const fixture = setup(() => {
          if (failure === 'synchronous throw') throw error;
          return sourcePromise;
        }, mode);
        const init = { headers: { authorization: SENTINEL } };
        if (failure === 'synchronous throw')
          expect(() => fixture.page.fetch(SOURCE, init)).toThrow(error);
        else {
          const result = fixture.page.fetch(SOURCE, init);
          expect(result).toBe(sourcePromise);
          await expect(result).rejects.toBe(error);
        }
        expect(fixture.snapshot()).toEqual({ kind: 'error', code: 'source-rejected' });
        expect(fixture.constructed).toHaveLength(0);
        expect(fixture.original).toHaveBeenCalledExactlyOnceWith(SOURCE, init);
        expect(JSON.stringify(fixture.snapshot())).not.toContain(SENTINEL);
      }
    );

    it.each(['plain', 'native', 'native-plain'])(
      'uses only captured primitives and owned records after late %s header iterator poisoning',
      async kind => {
        let resolveSource!: (response: Response) => void;
        const sourcePending = new Promise<Response>(resolve => {
          resolveSource = resolve;
        });
        const sourceResponse = jsonResponse();
        const helperResponse = jsonResponse();
        const fixture = setup(
          input =>
            input instanceof NativeRequest && input.url !== SOURCE
              ? Promise.resolve(helperResponse)
              : sourcePending,
          mode
        );
        const native = new NativeRequest(SOURCE, {
          headers: { authorization: SENTINEL },
          credentials: 'include',
        });
        const plain = { Authorization: SENTINEL };
        const result =
          kind === 'native'
            ? fixture.page.fetch(native)
            : fixture.page.fetch(kind === 'native-plain' ? native : SOURCE, { headers: plain });
        native.headers.set('authorization', 'late-native-mutation');
        plain.Authorization = 'late-plain-mutation';
        const poison = vi.fn(() => {
          throw new Error(SENTINEL);
        });
        const iterator = Object.getOwnPropertyDescriptor(Headers.prototype, Symbol.iterator)!;
        const forEach = Object.getOwnPropertyDescriptor(Headers.prototype, 'forEach')!;
        Object.defineProperty(Headers.prototype, Symbol.iterator, {
          configurable: true,
          value: poison,
        });
        Object.defineProperty(Headers.prototype, 'forEach', { configurable: true, value: poison });
        try {
          commandFor(fixture)(candidatesFor(1));
          resolveSource(sourceResponse);
          await result;
          await new Promise<void>(resolve => setTimeout(resolve, 25));
        } finally {
          Object.defineProperty(Headers.prototype, Symbol.iterator, iterator);
          Object.defineProperty(Headers.prototype, 'forEach', forEach);
        }
        await vi.waitFor(() =>
          expect(fixture.snapshot()).toMatchObject({
            kind: 'complete',
            dispatchCount: 1,
            outcomes: [{ state: 'observed' }],
          })
        );
        expect(poison).not.toHaveBeenCalled();
        expect(fixture.constructed[0].headers.get('authorization')).toBe(SENTINEL);
        expect(fixture.initShapes).toEqual([
          { nullInit: true, nullHeaders: true, stringsOnly: true },
        ]);
        expect(fixture.original).toHaveBeenCalledTimes(2);
      }
    );
  }
);

describe.each(['opaque-replay', 'opaque-probe'])('actual source response boundary in %s', mode => {
  const expectSourceMismatch = (fixture: ReturnType<typeof setup>) => {
    expect(fixture.snapshot()).toMatchObject(
      mode === 'opaque-replay'
        ? { kind: 'error', code: 'source-response-target-mismatch', singularDispatchCount: 0 }
        : {
            kind: 'result',
            result: {
              outcome: 'target-mismatch',
              sourceStatus: null,
              sourceJson: false,
              singularDispatchCount: 0,
            },
          }
    );
    expect(fixture.original).toHaveBeenCalledOnce();
    expect(fixture.constructed).toHaveLength(1);
    expect(fixture.constructed[0].signal.aborted).toBe(true);
    expect(JSON.stringify(fixture.snapshot())).not.toContain(SENTINEL);
  };

  it.each([
    ['empty URL', '', false],
    ['malformed URL', 'https://[', false],
    ['relative URL', SOURCE.slice('https://chatgpt.com'.length), false],
    ['cross-origin URL', SOURCE.replace('chatgpt.com', 'example.invalid'), false],
    ['wrong conversation', SOURCE.replace(ID, '11111111-2222-3333-4444-555555555555'), false],
    ['singular endpoint', SOURCE.replace('/conversations/', '/conversation/'), false],
    ['extra query', `${SOURCE}&extra=1`, false],
    ['duplicate query', `${SOURCE}&num_turns=10`, false],
    ['encoded query', SOURCE.replace('num_turns', '%6eum_turns'), false],
    ['missing query', SOURCE.split('?')[0], false],
    ['username', SOURCE.replace('https://', 'https://user@'), false],
    ['password', SOURCE.replace('https://', 'https://user:password@'), false],
    ['fragment', `${SOURCE}#fragment`, false],
    ['non-string URL', 42, false],
    ['undefined URL', undefined, false],
    ['null URL', null, false],
    ['redirected source', SOURCE, true],
    ['undefined redirected', SOURCE, undefined],
    ['non-boolean redirected', SOURCE, 'false'],
    ['numeric redirected', SOURCE, 0],
  ] as const)(
    'rejects %s before reading source status or headers',
    async (_label, url, redirected) => {
      const source = jsonResponse();
      responseMetadata.set(source, { url, redirected });
      const sourcePromise = Promise.resolve(source);
      const status = vi.spyOn(Response.prototype, 'status', 'get');
      const headers = vi.spyOn(Response.prototype, 'headers', 'get');
      const fixture = setup(() => sourcePromise, mode);
      const init = { headers: { authorization: SENTINEL } };
      const receiver = { syntheticReceiver: true };
      const result = Reflect.apply(fixture.page.fetch, receiver, [SOURCE, init]);
      expect(result).toBe(sourcePromise);
      await result;
      expectSourceMismatch(fixture);
      expect(fixture.original).toHaveBeenCalledExactlyOnceWith(SOURCE, init);
      expect(fixture.original.mock.contexts[0]).toBe(receiver);
      expect(status).not.toHaveBeenCalled();
      expect(headers).not.toHaveBeenCalled();
      expect(source.bodyUsed).toBe(false);
    }
  );

  it.each(['url', 'redirected'] as const)(
    'rejects an object from the %s getter without coercion',
    async property => {
      const coercion = vi.fn(() => SOURCE);
      const source = jsonResponse();
      responseMetadata.set(source, {
        url: SOURCE,
        redirected: false,
        [property]: { [Symbol.toPrimitive]: coercion, toString: coercion },
      });
      const sourcePromise = Promise.resolve(source);
      const fixture = setup(() => sourcePromise, mode);
      expect(fixture.page.fetch(SOURCE, { headers: { authorization: SENTINEL } })).toBe(
        sourcePromise
      );
      await sourcePromise;
      expectSourceMismatch(fixture);
      expect(coercion).not.toHaveBeenCalled();
    }
  );

  it.each(['url', 'redirected'] as const)(
    'fails closed when the captured %s getter throws',
    async property => {
      const sourcePromise = Promise.resolve(jsonResponse());
      const getter = vi.spyOn(Response.prototype, property, 'get').mockImplementation(() => {
        throw new Error(SENTINEL);
      });
      const fixture = setup(() => sourcePromise, mode);
      expect(fixture.page.fetch(SOURCE, { headers: { authorization: SENTINEL } })).toBe(
        sourcePromise
      );
      await sourcePromise;
      expectSourceMismatch(fixture);
      expect(getter).toHaveBeenCalledOnce();
    }
  );

  it.each(['cache.toString', 'forwarding Proxy get'])(
    'rejects a 200 JSON response after native-like init conversion mutates base via %s',
    async mutationKind => {
      const source = jsonResponse();
      const sourcePromise = Promise.resolve(source);
      const input = SOURCE.slice('https://chatgpt.com'.length);
      let resolvedUrl: string | undefined;
      const fixture = setup((pageInput, pageInit) => {
        expect(fixture.base.href).toContain('https://chatgpt.com/c/');
        expect(fixture.constructed).toHaveLength(1);
        // Native WebIDL dictionary/enum conversion runs before fetch resolves
        // its URL against the document base. Perform that conversion without
        // network, then return the response from the resulting effective URL.
        new NativeRequest(SOURCE, pageInit);
        resolvedUrl = new NodeURL(pageInput as string, fixture.base.href).href;
        responseMetadata.set(source, { url: resolvedUrl, redirected: false });
        return sourcePromise;
      }, mode);
      const mutateBase = vi.fn(() => {
        fixture.base.href = 'https://example.invalid/c/synthetic';
        return 'default';
      });
      const init =
        mutationKind === 'cache.toString'
          ? { headers: { authorization: SENTINEL }, cache: { toString: mutateBase } }
          : new Proxy(
              { headers: { authorization: SENTINEL }, cache: 'default' },
              {
                get(target, key, receiver) {
                  if (key === 'cache') mutateBase();
                  return Reflect.get(target, key, receiver);
                },
              }
            );
      const receiver = { syntheticReceiver: true };
      const result = Reflect.apply(fixture.page.fetch, receiver, [input, init]);
      expect(result).toBe(sourcePromise);
      await result;
      expect(mutateBase).toHaveBeenCalledOnce();
      expect(resolvedUrl).toBe(SOURCE.replace('chatgpt.com', 'example.invalid'));
      expectSourceMismatch(fixture);
      expect(fixture.original).toHaveBeenCalledExactlyOnceWith(input, init);
      expect(fixture.original.mock.contexts[0]).toBe(receiver);
      expect(source.bodyUsed).toBe(false);
    }
  );

  it.each([
    ['absolute string', SOURCE],
    ['root-relative string', SOURCE.slice('https://chatgpt.com'.length)],
    ['native Request', new NativeRequest(SOURCE, { headers: { authorization: SENTINEL } })],
  ] as const)('accepts an exact non-redirected response for %s', async (kind, input) => {
    const source = jsonResponse();
    const sourcePromise = Promise.resolve(source);
    const fixture = setup(
      pageInput => (pageInput === input ? sourcePromise : Promise.resolve(jsonResponse())),
      mode
    );
    const init = { headers: { authorization: SENTINEL } };
    const args = kind === 'native Request' ? [input] : [input, init];
    expect(Reflect.apply(fixture.page.fetch, fixture.page, args)).toBe(sourcePromise);
    await sourcePromise;
    await vi.waitFor(() =>
      expect(fixture.snapshot()).toMatchObject(
        mode === 'opaque-replay'
          ? { kind: 'captured', singularDispatchCount: 1 }
          : {
              kind: 'result',
              result: {
                outcome: kind === 'native Request' ? 'eligible' : 'eligible-init-plain-headers',
              },
            }
      )
    );
    expect(fixture.original.mock.calls[0]).toEqual(args);
    expect(fixture.original).toHaveBeenCalledTimes(mode === 'opaque-replay' ? 2 : 1);
    expect(source.bodyUsed).toBe(false);
  });

  it('accepts the other exact query ordering and ignores later public Response getter poisoning', async () => {
    const source = jsonResponse();
    responseMetadata.set(source, {
      url: SOURCE.replace(
        '?num_turns=10&include_has_versions=true',
        '?include_has_versions=true&num_turns=10'
      ),
      redirected: false,
    });
    const sourcePromise = Promise.resolve(source);
    const fixture = setup(
      input => (input === SOURCE ? sourcePromise : Promise.resolve(jsonResponse())),
      mode
    );
    const poison = vi.fn(() => {
      throw new Error(SENTINEL);
    });
    Object.defineProperties(source, { url: { get: poison }, redirected: { get: poison } });
    vi.spyOn(Response.prototype, 'url', 'get').mockImplementation(poison);
    vi.spyOn(Response.prototype, 'redirected', 'get').mockImplementation(poison);
    expect(fixture.page.fetch(SOURCE, { headers: { authorization: SENTINEL } })).toBe(
      sourcePromise
    );
    await sourcePromise;
    await vi.waitFor(() =>
      expect(fixture.snapshot()).toMatchObject(
        mode === 'opaque-replay'
          ? { kind: 'captured', singularDispatchCount: 1 }
          : { kind: 'result', result: { outcome: 'eligible-init-plain-headers' } }
      )
    );
    expect(poison).not.toHaveBeenCalled();
  });
});

describe('ChatGPT replay strict plain-header snapshots', () => {
  it.each(['absolute string', 'root-relative string', 'null record'])(
    'prebuilds one fixed Request for %s, leaving the original receiver/args/promise untouched',
    async kind => {
      let resolveSource!: (response: Response) => void;
      const sourcePromise = new Promise<Response>(resolve => {
        resolveSource = resolve;
      });
      const source = jsonResponse();
      const clone = vi.spyOn(source, 'clone');
      const replay = jsonResponse();
      const fixture = setup(input =>
        input instanceof NativeRequest ? Promise.resolve(replay) : sourcePromise
      );
      const headers =
        kind === 'null record'
          ? Object.assign(Object.create(null), {
              Authorization: SENTINEL,
              'X-Synthetic': 'primitive',
            })
          : { Authorization: SENTINEL, 'X-Synthetic': 'primitive' };
      const input =
        kind === 'root-relative string' ? SOURCE.slice('https://chatgpt.com'.length) : SOURCE;
      const init = {
        method: 'GET',
        headers,
        credentials: 'include',
        signal: new AbortController().signal,
      };
      const receiver = { synthetic: true };
      fixture.original.mockImplementationOnce(() => {
        expect(fixture.constructed).toHaveLength(1);
        return sourcePromise;
      });
      const result = Reflect.apply(fixture.page.fetch, receiver, [input, init]);
      expect(result).toBe(sourcePromise);
      expect(fixture.original).toHaveBeenCalledExactlyOnceWith(input, init);
      expect(fixture.original.mock.contexts[0]).toBe(receiver);
      expect(fixture.snapshot()).toEqual({ kind: 'ready' });
      expect(fixture.initShapes).toEqual([
        { nullInit: true, nullHeaders: true, stringsOnly: true },
      ]);
      const prebuilt = fixture.constructed[0];
      expect(prebuilt.url).toBe(SINGULAR);
      expect(prebuilt.method).toBe('GET');
      expect(prebuilt.credentials).toBe('include');
      expect(prebuilt.cache).toBe('no-store');
      expect(prebuilt.redirect).toBe('error');
      expect(prebuilt.signal).not.toBe(init.signal);
      headers.Authorization = 'synthetic-late-mutation';
      expect(prebuilt.headers.get('authorization')).toBe(SENTINEL);
      resolveSource(source);
      await result;
      await vi.waitFor(() =>
        expect(fixture.snapshot()).toMatchObject({ kind: 'captured', singularDispatchCount: 1 })
      );
      expect(fixture.original.mock.calls[1]).toEqual([prebuilt]);
      expect(fixture.constructed).toHaveLength(1);
      expect(fixture.original).toHaveBeenCalledTimes(2);
      expect(clone).not.toHaveBeenCalled();
      expect(source.bodyUsed).toBe(false);
      expect(prebuilt.signal.aborted).toBe(true);
      expect(timers.size).toBe(0);
      vi.stubGlobal('window', fixture.page);
      expect(readChatGptOpaqueReplayState(NONCE)).toEqual(fixture.snapshot());
      const serialized = JSON.stringify(fixture.snapshot());
      expect(serialized).not.toContain(SENTINEL);
      expect(serialized).not.toContain('x-synthetic');
    }
  );

  it.each([
    ['bare relative', SOURCE.slice('https://chatgpt.com/'.length), false, 'ready'],
    ['protocol-relative', SOURCE.slice('https:'.length), false, 'ready'],
    [
      'protocol-relative with URL whitespace',
      `\u0000 \t${SOURCE.slice('https:'.length)}`,
      false,
      'ready',
    ],
    ['protocol-relative backslashes', SOURCE.replace('https://', '\\\\'), false, 'ready'],
    ['cross-origin absolute', SOURCE.replace('chatgpt.com', 'example.invalid'), false, 'error'],
    ['cross-origin base', SOURCE.slice('https://chatgpt.com'.length), true, 'error'],
  ] as const)(
    'does not replay an off-target 200 JSON source: %s',
    async (_label, input, crossOriginBase, kind) => {
      const source = jsonResponse();
      const sourcePromise = Promise.resolve(source);
      let resolvedUrl: string | undefined;
      const fixture = setup(pageInput => {
        resolvedUrl = new NodeURL(pageInput as string, fixture.base.href).href;
        return sourcePromise;
      });
      if (crossOriginBase) fixture.base.href = 'https://example.invalid/c/synthetic';
      const init = { headers: { authorization: SENTINEL } };
      const receiver = { syntheticReceiver: true };
      const result = Reflect.apply(fixture.page.fetch, receiver, [input, init]);
      expect(result).toBe(sourcePromise);
      await result;
      expect(resolvedUrl).toBe(new NodeURL(input, fixture.base.href).href);
      if (_label === 'bare relative') {
        expect(resolvedUrl).toBe(SOURCE.replace('/backend-api/', '/c/backend-api/'));
      }
      expect(fixture.original).toHaveBeenCalledExactlyOnceWith(input, init);
      expect(fixture.original.mock.contexts[0]).toBe(receiver);
      expect(fixture.constructed).toHaveLength(0);
      expect(fixture.snapshot()).toMatchObject(
        kind === 'ready'
          ? { kind }
          : { kind, code: 'source-request-target-mismatch', singularDispatchCount: 0 }
      );
      expect(source.bodyUsed).toBe(false);
      expect(JSON.stringify(fixture.snapshot())).not.toContain(SENTINEL);
    }
  );

  it.each(['init', 'headers'])(
    'rechecks the native base after forwarding %s Proxy reflection, without reinspecting it',
    async reflectionTarget => {
      const input = SOURCE.slice('https://chatgpt.com'.length);
      const sourcePromise = Promise.resolve(jsonResponse());
      let resolvedUrl: string | undefined;
      const fixture = setup(pageInput => {
        resolvedUrl = new NodeURL(pageInput as string, fixture.base.href).href;
        return sourcePromise;
      });
      const reflectDescriptor = vi.fn((target: object, key: PropertyKey) => {
        fixture.base.href = 'https://example.invalid/c/synthetic';
        return Reflect.getOwnPropertyDescriptor(target, key);
      });
      const headers = { authorization: SENTINEL };
      const init =
        reflectionTarget === 'init'
          ? new Proxy({ headers }, { getOwnPropertyDescriptor: reflectDescriptor })
          : { headers: new Proxy(headers, { getOwnPropertyDescriptor: reflectDescriptor }) };
      const receiver = { syntheticReceiver: true };
      const result = Reflect.apply(fixture.page.fetch, receiver, [input, init]);
      expect(result).toBe(sourcePromise);
      await result;
      expect(resolvedUrl).toBe(SOURCE.replace('chatgpt.com', 'example.invalid'));
      expect(reflectDescriptor).toHaveBeenCalledExactlyOnceWith(
        reflectionTarget === 'init' ? { headers } : headers,
        reflectionTarget === 'init' ? 'headers' : 'authorization'
      );
      expect(fixture.original).toHaveBeenCalledExactlyOnceWith(input, init);
      expect(fixture.original.mock.contexts[0]).toBe(receiver);
      expect(fixture.constructed).toHaveLength(0);
      expect(fixture.snapshot()).toMatchObject({
        kind: 'error',
        code: 'source-request-target-mismatch',
        singularDispatchCount: 0,
      });
      expect(JSON.stringify(fixture.snapshot())).not.toContain(SENTINEL);
    }
  );

  it('uses the captured genuine baseURI getter and document receiver after page overrides', async () => {
    const fixture = setup();
    const poison = vi.fn(() => {
      throw new Error(SENTINEL);
    });
    Object.defineProperty(fixture.page.document, 'baseURI', { get: poison });
    Object.defineProperty(fixture.page, 'document', { get: poison });
    vi.spyOn(Node.prototype, 'baseURI', 'get').mockImplementation(poison);
    const input = SOURCE.slice('https://chatgpt.com'.length);
    await fixture.page.fetch(input, { headers: { authorization: SENTINEL } });
    await vi.waitFor(() => expect(fixture.snapshot()).toMatchObject({ kind: 'captured' }));
    expect(poison).not.toHaveBeenCalled();
    expect(fixture.constructed).toHaveLength(1);
    expect(fixture.original).toHaveBeenCalledTimes(2);
  });

  it.each(['unavailable getter', 'throwing genuine getter'])(
    'leaves string fetch promise and exception behavior untouched with an %s',
    async condition => {
      const primitives =
        condition === 'unavailable getter'
          ? { Node: class {} as unknown as typeof Node }
          : { document: {} as Document };
      const error = new Error(SENTINEL);
      const sourcePromise = Promise.resolve(jsonResponse());
      const fixture = setup(() => sourcePromise, 'opaque-replay', primitives);
      const receiver = { syntheticReceiver: true };
      const init = { headers: { authorization: SENTINEL } };
      expect(Reflect.apply(fixture.page.fetch, receiver, [SOURCE, init])).toBe(sourcePromise);
      await sourcePromise;
      expect(fixture.original.mock.contexts[0]).toBe(receiver);
      expect(fixture.original).toHaveBeenCalledExactlyOnceWith(SOURCE, init);
      fixture.original.mockImplementationOnce(() => {
        throw error;
      });
      expect(() => Reflect.apply(fixture.page.fetch, receiver, [SOURCE, init])).toThrow(error);
      expect(fixture.original.mock.contexts[1]).toBe(receiver);
      expect(fixture.original.mock.calls[1]).toEqual([SOURCE, init]);
      expect(fixture.constructed).toHaveLength(0);
      expect(fixture.snapshot()).toEqual({ kind: 'ready' });
    }
  );

  it.each([
    ['string', undefined, undefined, 'same-origin'],
    ['string', undefined, 'same-origin', 'same-origin'],
    ['string', undefined, 'include', 'include'],
    ['request', 'include', undefined, 'include'],
    ['request', 'omit', 'include', 'include'],
    ['request', 'include', 'same-origin', 'same-origin'],
    ['request', 'omit', undefined, 'credentials-rejected'],
    ['string', undefined, 'omit', 'init-security-sensitive-credentials'],
  ] as const)(
    'uses effective credentials for %s/%s/%s',
    async (kind, sourceCredentials, override, expected) => {
      const fixture = setup();
      const input =
        kind === 'request' ? new NativeRequest(SOURCE, { credentials: sourceCredentials }) : SOURCE;
      await fixture.page.fetch(input, {
        headers: { authorization: SENTINEL },
        credentials: override,
      });
      if (expected.includes('rejected') || expected.includes('sensitive')) {
        expect(fixture.snapshot()).toMatchObject({ code: expected, singularDispatchCount: 0 });
        expect(fixture.original).toHaveBeenCalledOnce();
      } else {
        await vi.waitFor(() => expect(fixture.snapshot()).toMatchObject({ kind: 'captured' }));
        expect(fixture.constructed[0].credentials).toBe(expected);
      }
    }
  );

  const snapshotModes = [
    'opaque-replay',
    'opaque-probe',
    'interpreter-resolver',
    'active-resolver',
  ];
  describe.each(snapshotModes)('rejection diagnostics in %s', mode => {
    it.each([
      ['null', () => null, 'shape'],
      ['primitive', () => SENTINEL, 'shape'],
      ['function', () => () => SENTINEL, 'shape'],
      ['array', () => [['authorization', SENTINEL]], 'prototype'],
      [
        'class instance',
        () =>
          new (class {
            authorization = SENTINEL;
          })(),
        'prototype',
      ],
      ['inherited headers', () => Object.create({ authorization: SENTINEL }), 'prototype'],
      [
        'native distinct Headers',
        () => new Headers({ authorization: SENTINEL }),
        'native-distinct',
      ],
      [
        'non-enumerable',
        () => Object.defineProperty({}, 'authorization', { value: SENTINEL }),
        'descriptor',
      ],
      [
        'missing descriptor',
        () => new Proxy({ authorization: SENTINEL }, { getOwnPropertyDescriptor: () => undefined }),
        'descriptor',
      ],
      ['symbol', () => ({ authorization: SENTINEL, [Symbol('private')]: 'value' }), 'symbol'],
      ['number', () => ({ authorization: 1 }), 'entry'],
      ['boolean', () => ({ authorization: false }), 'entry'],
      ['undefined', () => ({ authorization: undefined }), 'entry'],
      ['null value', () => ({ authorization: null }), 'entry'],
      ['bigint', () => ({ authorization: 1n }), 'entry'],
      ['boxed string', () => ({ authorization: new String(SENTINEL) }), 'entry'],
      ['function value', () => ({ authorization: () => SENTINEL }), 'entry'],
      [
        'duplicate authorization',
        () => ({ authorization: SENTINEL, Authorization: SENTINEL }),
        'entry',
      ],
      [
        'duplicate other key',
        () => ({ authorization: SENTINEL, 'x-synthetic': 'one', 'X-Synthetic': 'two' }),
        'entry',
      ],
      ['constructor', () => ({ authorization: SENTINEL, constructor: 'bad' }), 'entry'],
      ['prototype', () => ({ authorization: SENTINEL, prototype: 'bad' }), 'entry'],
      [
        '__proto__',
        () => Object.assign(Object.create(null), { authorization: SENTINEL, ['__proto__']: 'bad' }),
        'entry',
      ],
      ['empty name', () => ({ authorization: SENTINEL, '': 'bad' }), 'limit'],
      ['space name', () => ({ authorization: SENTINEL, 'x bad': 'bad' }), 'entry'],
      ['colon name', () => ({ authorization: SENTINEL, 'x:bad': 'bad' }), 'entry'],
      ['Unicode name', () => ({ authorization: SENTINEL, 'x-Ж': 'bad' }), 'entry'],
      ['CR value', () => ({ authorization: 'synthetic\rvalue' }), 'entry'],
      ['LF value', () => ({ authorization: 'synthetic\nvalue' }), 'entry'],
      ['TAB value', () => ({ authorization: 'synthetic\tvalue' }), 'entry'],
      ['NUL value', () => ({ authorization: 'synthetic\0value' }), 'entry'],
      ['DEL value', () => ({ authorization: 'synthetic\u007fvalue' }), 'entry'],
      ['C1 value', () => ({ authorization: 'synthetic\u0085value' }), 'entry'],
      ['non-ByteString', () => ({ authorization: 'synthetic-Ж' }), 'entry'],
      ['long name', () => ({ authorization: SENTINEL, ['x'.repeat(129)]: 'bad' }), 'limit'],
      ['long value', () => ({ authorization: 'x'.repeat(8193) }), 'limit'],
      [
        'too many headers',
        () =>
          Object.fromEntries([
            ['authorization', SENTINEL],
            ...Array.from({ length: 64 }, (_, i) => [`x-${i}`, 'value']),
          ]),
        'limit',
      ],
      [
        'total budget',
        () => ({
          authorization: SENTINEL,
          one: 'x'.repeat(8192),
          two: 'x'.repeat(8192),
          three: 'x'.repeat(8192),
          four: 'x'.repeat(8192),
        }),
        'limit',
      ],
    ] as const)(
      'fails closed for %s without exposing a value',
      async (_label, makeHeaders, reason) => {
        const fixture = setup(undefined, mode);
        const headers = makeHeaders();
        const result = fixture.page.fetch(SOURCE, { headers } as RequestInit);
        await result;
        expectHeaderRejection(
          fixture,
          mode,
          `init-security-sensitive-headers-${reason === 'native-distinct' ? reason : `unbranded-${reason}`}`
        );
        expect(fixture.original).toHaveBeenCalledExactlyOnceWith(SOURCE, { headers });
        expect(fixture.constructed).toHaveLength(0);
        expect(JSON.stringify(fixture.snapshot())).not.toContain(SENTINEL);
      }
    );

    it('rejects getters, coercions and custom iterators without invoking them', async () => {
      const pageCallback = vi.fn(() => {
        throw new Error(SENTINEL);
      });
      const badHeaders = [
        [
          Object.defineProperty({}, 'authorization', { enumerable: true, get: pageCallback }),
          'accessor',
        ],
        [
          { authorization: { toString: pageCallback, [Symbol.toPrimitive]: pageCallback } },
          'entry',
        ],
        [{ authorization: SENTINEL, [Symbol.iterator]: pageCallback }, 'symbol'],
        [
          Object.defineProperty({ authorization: SENTINEL }, Symbol.iterator, {
            get: pageCallback,
          }),
          'symbol',
        ],
        [
          Object.defineProperty({ authorization: SENTINEL }, 'constructor', {
            enumerable: true,
            get: pageCallback,
          }),
          'accessor',
        ],
        [
          Object.defineProperty({ authorization: SENTINEL }, Symbol.toStringTag, {
            get: pageCallback,
          }),
          'symbol',
        ],
      ] as const;
      for (const [headers, reason] of badHeaders) {
        const fixture = setup(undefined, mode);
        await fixture.page.fetch(SOURCE, { headers } as RequestInit);
        expectHeaderRejection(fixture, mode, `init-security-sensitive-headers-unbranded-${reason}`);
        expect(fixture.constructed).toHaveLength(0);
      }
      expect(pageCallback).not.toHaveBeenCalled();
    });

    it.each(['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor'] as const)(
      'fails closed when the unavoidable Proxy %s reflection trap throws',
      async name => {
        const inspectThrown = vi.fn(() => {
          throw new Error(SENTINEL);
        });
        const thrown = new Proxy(Object.create(null), {
          get: inspectThrown,
          ownKeys: inspectThrown,
          getPrototypeOf: inspectThrown,
          getOwnPropertyDescriptor: inspectThrown,
        });
        let trapCalls = 0;
        const trap = () => {
          trapCalls += 1;
          throw thrown;
        };
        const headers = new Proxy({ authorization: SENTINEL }, { [name]: trap });
        const fixture = setup(undefined, mode);
        await fixture.page.fetch(SOURCE, { headers });
        // Native Headers branding already checks the input prototype; the
        // snapshot then performs its one failing reflection, with no retry.
        expect(trapCalls).toBe(name === 'getPrototypeOf' ? 2 : 1);
        expect(inspectThrown).not.toHaveBeenCalled();
        expectHeaderRejection(
          fixture,
          mode,
          'init-security-sensitive-headers-unbranded-reflection'
        );
        expect(fixture.constructed).toHaveLength(0);
        expect(fixture.original).toHaveBeenCalledOnce();
      }
    );

    it('rejects inconsistent reflection but documents that a forwarding Proxy is indistinguishable', async () => {
      let reflections = 0;
      const inconsistent = new Proxy(
        { authorization: SENTINEL },
        { ownKeys: () => (++reflections === 1 ? ['authorization'] : []) }
      );
      const bad = setup(undefined, mode);
      await bad.page.fetch(SOURCE, { headers: inconsistent });
      expect(reflections).toBe(2);
      expectHeaderRejection(bad, mode, 'init-security-sensitive-headers-unbranded-unstable');
      const forwarding = new Proxy({ authorization: SENTINEL }, {});
      const good = setup(undefined, mode);
      await good.page.fetch(SOURCE, { headers: forwarding });
      await vi.waitFor(() =>
        expect(good.snapshot()).toMatchObject(
          mode === 'opaque-replay'
            ? { kind: 'captured' }
            : mode === 'interpreter-resolver' || mode === 'active-resolver'
              ? { kind: 'ready' }
              : { kind: 'result', result: { outcome: 'eligible-init-plain-headers' } }
        )
      );
    });

    it('rejects inherited Object.prototype headers without invoking an inherited getter', async () => {
      const fixture = setup(undefined, mode);
      const getter = vi.fn(() => SENTINEL);
      Object.defineProperty(Object.prototype, 'authorization', {
        configurable: true,
        enumerable: true,
        get: getter,
      });
      let result: Promise<Response>;
      try {
        result = fixture.page.fetch(SOURCE, { headers: { 'x-synthetic': 'value' } });
      } finally {
        delete (Object.prototype as Record<string, unknown>).authorization;
      }
      await result!;
      expect(getter).not.toHaveBeenCalled();
      expectHeaderRejection(fixture, mode, 'init-security-sensitive-headers-unbranded-inherited');
    });

    it.each(['headers-first', 'headers-last'])(
      'keeps multiple-sensitive-member precedence with %s',
      async order => {
        const fixture = setup(undefined, mode);
        const init =
          order === 'headers-first'
            ? { headers: null, body: SENTINEL }
            : { body: SENTINEL, headers: null };
        await fixture.page.fetch(SOURCE, init as unknown as RequestInit);
        expectHeaderRejection(fixture, mode, 'init-security-sensitive-multiple');
        expect(fixture.constructed).toHaveLength(0);
        expect(fixture.original).toHaveBeenCalledOnce();
      }
    );

    it.each(['reordered keys', 'changed prototype'])(
      'classifies %s as unstable without another snapshot pass',
      async change => {
        let keyCalls = 0;
        let prototypeCalls = 0;
        const target = { authorization: SENTINEL, 'x-synthetic': 'value' };
        const headers = new Proxy(target, {
          ownKeys() {
            keyCalls += 1;
            return change === 'reordered keys' && keyCalls === 2
              ? ['x-synthetic', 'authorization']
              : ['authorization', 'x-synthetic'];
          },
          getPrototypeOf() {
            prototypeCalls += 1;
            // The first call is native Headers branding, the next two are
            // the snapshot's existing initial/final stability checks.
            return change === 'changed prototype' && prototypeCalls === 3 ? null : Object.prototype;
          },
        });
        const fixture = setup(undefined, mode);
        await fixture.page.fetch(SOURCE, { headers });
        expectHeaderRejection(fixture, mode, 'init-security-sensitive-headers-unbranded-unstable');
        expect(keyCalls).toBe(2);
        expect(prototypeCalls).toBe(3);
        expect(fixture.constructed).toHaveLength(0);
      }
    );

    it.each([
      'root',
      'missing inherited descriptor',
      'enumerable inherited descriptor',
      'symbol inherited key',
      'inherited key limit',
    ])('classifies captured Object.prototype %s failures as inherited', async failure => {
      const pageObject = new Proxy(Object, {
        get(target, key) {
          if (key === 'getPrototypeOf' && failure === 'root') {
            return (value: object) =>
              value === Object.prototype ? {} : Object.getPrototypeOf(value);
          }
          if (key === 'getOwnPropertyDescriptor' && failure.includes('descriptor')) {
            return (value: object, name: PropertyKey) => {
              if (value === Object.prototype && name === 'toString') {
                return failure === 'missing inherited descriptor'
                  ? undefined
                  : { enumerable: true };
              }
              return Object.getOwnPropertyDescriptor(value, name);
            };
          }
          return Reflect.get(target, key);
        },
      });
      const pageReflect = new Proxy(Reflect, {
        get(target, key) {
          if (key === 'ownKeys') {
            return (value: object) =>
              value === Object.prototype && failure === 'symbol inherited key'
                ? [Symbol('private')]
                : value === Object.prototype && failure === 'inherited key limit'
                  ? Array.from({ length: 17 }, () => 'toString')
                  : Reflect.ownKeys(value);
          }
          return Reflect.get(target, key);
        },
      });
      const fixture = setup(undefined, mode, { Object: pageObject, Reflect: pageReflect });
      // Keep the outer RequestInit independent of Object.prototype so its
      // separate inherited-member gate does not mask the header rejection.
      const init = Object.assign(Object.create(null), { headers: { authorization: SENTINEL } });
      await fixture.page.fetch(SOURCE, init);
      expectHeaderRejection(fixture, mode, 'init-security-sensitive-headers-unbranded-inherited');
      expect(fixture.constructed).toHaveLength(0);
    });
  });

  it('retains the generic native-source header snapshot failure', async () => {
    const source = new NativeRequest(SOURCE, {
      headers: { authorization: 'x'.repeat(8193) },
      credentials: 'include',
    });
    const fixture = setup();
    await fixture.page.fetch(source);
    expect(fixture.snapshot()).toEqual({
      kind: 'error',
      code: 'init-security-sensitive-headers',
      singularDispatchCount: 0,
    });
    expect(fixture.constructed).toHaveLength(0);
    expect(fixture.original).toHaveBeenCalledExactlyOnceWith(source);
  });

  it.each(['opaque-replay', 'opaque-probe'])(
    'bounds reentrant reflection in %s to one preparation',
    async mode => {
      const fixture = setup(undefined, mode);
      let reentered = false;
      const headers = new Proxy(
        { authorization: SENTINEL },
        {
          getPrototypeOf(target) {
            if (!reentered) {
              reentered = true;
              void fixture.page.fetch(SOURCE, { headers: { authorization: SENTINEL } });
            }
            return Reflect.getPrototypeOf(target);
          },
        }
      );
      await fixture.page.fetch(SOURCE, { headers });
      await vi.waitFor(() =>
        expect(fixture.snapshot()).toMatchObject({
          kind: mode === 'opaque-replay' ? 'captured' : 'result',
        })
      );
      expect(reentered).toBe(true);
      expect(fixture.constructed).toHaveLength(1);
      expect(fixture.original).toHaveBeenCalledTimes(mode === 'opaque-replay' ? 3 : 2);
    }
  );

  it.each([
    [
      SOURCE.replace('https://chatgpt.com', 'https://example.invalid'),
      'source-request-target-mismatch',
    ],
    [SOURCE + '&num_turns=10', 'source-request-target-mismatch'],
    [SOURCE + '#synthetic', 'source-request-target-mismatch'],
    [SOURCE.replace('/conversations/', '/conversation/'), 'ready'],
  ])(
    'does not prepare a plain-header replay outside the exact target: %s',
    async (url, expected) => {
      const fixture = setup();
      await fixture.page.fetch(url, { headers: { authorization: SENTINEL } });
      expect(fixture.constructed).toHaveLength(0);
      expect(fixture.original).toHaveBeenCalledOnce();
      expect(fixture.snapshot()).toMatchObject(
        expected === 'ready' ? { kind: 'ready' } : { code: expected, singularDispatchCount: 0 }
      );
    }
  );

  it('rejects URL-like and branded URL inputs without invoking their own accessors/coercions', async () => {
    const callback = vi.fn(() => SOURCE);
    const spoof = Object.defineProperty({ toString: callback }, 'href', { get: callback });
    const first = setup();
    await first.page.fetch(spoof as unknown as URL, { headers: { authorization: SENTINEL } });
    expect(first.constructed).toHaveLength(0);
    const branded = new NodeURL(SOURCE);
    Object.defineProperty(branded, 'href', { get: callback });
    Object.defineProperty(branded, 'toString', { value: callback });
    const second = setup();
    await second.page.fetch(branded as unknown as URL, { headers: { authorization: SENTINEL } });
    expect(second.constructed).toHaveLength(0);
    expect(second.snapshot()).toMatchObject({
      code: 'source-request-method-mismatch',
      singularDispatchCount: 0,
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it.each(['unmodified', 'toString', 'Symbol.toPrimitive'])(
    'never replays a URL object even when native conversion uses %s',
    async conversion => {
      const actualTarget =
        conversion === 'unmodified' ? SOURCE : 'https://example.invalid/synthetic';
      const coercion = vi.fn(() => actualTarget);
      const input = new NodeURL(SOURCE);
      if (conversion !== 'unmodified') {
        Object.defineProperty(input, conversion === 'toString' ? 'toString' : Symbol.toPrimitive, {
          value: coercion,
        });
      }
      let convertedTarget: string | undefined;
      const sourcePromise = Promise.resolve(jsonResponse());
      const fixture = setup((pageInput, init) => {
        // Native Request performs the same RequestInfo string conversion as
        // fetch, without network. Captured URL.href alone cannot establish it.
        convertedTarget = new NativeRequest(pageInput as RequestInfo, init).url;
        return sourcePromise;
      });
      const init = { headers: { authorization: SENTINEL } };
      expect(fixture.page.fetch(input as unknown as URL, init)).toBe(sourcePromise);
      await sourcePromise;
      expect(convertedTarget).toBe(actualTarget);
      expect(coercion).toHaveBeenCalledTimes(conversion === 'unmodified' ? 0 : 1);
      expect(fixture.constructed).toHaveLength(0);
      expect(fixture.original).toHaveBeenCalledExactlyOnceWith(input, init);
      expect(fixture.snapshot()).toMatchObject({
        code: 'source-request-method-mismatch',
        singularDispatchCount: 0,
      });
    }
  );

  it.each(['body', 'method', 'credentials', 'headers', 'signal', 'cache'])(
    'does not call a RequestInit %s accessor',
    async member => {
      const getter = vi.fn(() => SENTINEL);
      const init = { headers: { authorization: SENTINEL } };
      Object.defineProperty(init, member, { enumerable: true, get: getter });
      const fixture = setup();
      await fixture.page.fetch(SOURCE, init);
      expect(getter).not.toHaveBeenCalled();
      expect(fixture.snapshot()).toMatchObject({
        code: 'init-unsupported-accessor',
        singularDispatchCount: 0,
      });
    }
  );

  it.each([
    [{ method: 'POST' }, 'init-security-sensitive-method'],
    [{ body: 'synthetic-body' }, 'init-security-sensitive-body'],
    [{ credentials: 'omit' }, 'init-security-sensitive-credentials'],
    [{ arbitrary: true }, 'init-unsupported-member'],
    [{ [Symbol('private')]: true }, 'init-unsupported-symbol'],
  ] as const)('rejects unsafe init members alongside plain headers: %o', async (extra, code) => {
    const fixture = setup();
    await fixture.page.fetch(SOURCE, {
      headers: { authorization: SENTINEL },
      ...extra,
    } as RequestInit);
    expect(fixture.snapshot()).toMatchObject({ code, singularDispatchCount: 0 });
    expect(fixture.constructed).toHaveLength(0);
  });

  it('requires native authorization membership, not a lookalike key', async () => {
    const fixture = setup();
    await fixture.page.fetch(SOURCE, { headers: { 'x-authorization': SENTINEL } });
    expect(fixture.constructed).toHaveLength(1);
    expect(fixture.constructed[0].signal.aborted).toBe(true);
    expect(fixture.snapshot()).toMatchObject({
      code: 'authorization-absent',
      singularDispatchCount: 0,
    });
  });

  it.each([
    [500, 'application/json', 'source-http-error'],
    [200, 'text/plain', 'source-non-json'],
  ] as const)(
    'does not dispatch after source %s/%s and aborts the prebuilt Request',
    async (status, type, code) => {
      const source = jsonResponse(status, type);
      const fixture = setup(() => Promise.resolve(source));
      await fixture.page.fetch(SOURCE, { headers: { authorization: SENTINEL } });
      await vi.waitFor(() =>
        expect(fixture.snapshot()).toMatchObject({ code, singularDispatchCount: 0 })
      );
      expect(fixture.constructed[0].signal.aborted).toBe(true);
      expect(fixture.original).toHaveBeenCalledOnce();
      expect(source.bodyUsed).toBe(false);
    }
  );

  it.each(['source-throw', 'source-reject', 'replay-throw', 'replay-reject'])(
    'preserves the original result and never retries %s',
    async failure => {
      const error = new Error(SENTINEL);
      const sourcePromise = Promise.resolve(jsonResponse());
      const fixture = setup(input => {
        const isReplay = input instanceof NativeRequest;
        if (failure === (isReplay ? 'replay-throw' : 'source-throw')) throw error;
        if (failure === (isReplay ? 'replay-reject' : 'source-reject'))
          return Promise.reject(error);
        return sourcePromise;
      });
      if (failure === 'source-throw') {
        expect(() => fixture.page.fetch(SOURCE, { headers: { authorization: SENTINEL } })).toThrow(
          error
        );
      } else {
        const result = fixture.page.fetch(SOURCE, { headers: { authorization: SENTINEL } });
        if (failure === 'source-reject') await expect(result).rejects.toBe(error);
        else {
          expect(result).toBe(sourcePromise);
          await result;
        }
      }
      const code = failure.startsWith('source')
        ? 'source-rejected'
        : failure === 'replay-throw'
          ? 'replay-dispatch-failed'
          : 'replay-rejected';
      const count = failure.startsWith('source') ? 0 : 1;
      await vi.waitFor(() =>
        expect(fixture.snapshot()).toMatchObject({ code, singularDispatchCount: count })
      );
      expect(fixture.original).toHaveBeenCalledTimes(count + 1);
      expect(fixture.constructed).toHaveLength(1);
      expect(fixture.constructed[0].signal.aborted).toBe(true);
      expect(JSON.stringify(fixture.snapshot())).not.toContain(SENTINEL);
    }
  );

  it.each(['source', 'replay'])(
    'aborts a prebuilt Request on %s timeout without a later retry',
    async stage => {
      vi.useFakeTimers();
      let resolvePending!: (response: Response) => void;
      const pending = new Promise<Response>(resolve => {
        resolvePending = resolve;
      });
      const fixture = setup(input =>
        input instanceof NativeRequest || stage === 'source'
          ? pending
          : Promise.resolve(jsonResponse())
      );
      const result = fixture.page.fetch(SOURCE, { headers: { authorization: SENTINEL } });
      await vi.advanceTimersByTimeAsync(180_000);
      const count = stage === 'source' ? 0 : 1;
      const code = stage === 'source' ? 'source-response-timeout' : 'replay-response-timeout';
      expect(fixture.snapshot()).toMatchObject({ code, singularDispatchCount: count });
      expect(fixture.constructed[0].signal.aborted).toBe(true);
      expect(timers.size).toBe(0);
      resolvePending(jsonResponse());
      await result;
      await vi.advanceTimersByTimeAsync(1);
      expect(fixture.original).toHaveBeenCalledTimes(count + 1);
      expect(fixture.snapshot()).toMatchObject({ code, singularDispatchCount: count });
    }
  );

  it('dispatches the exact prebuilt Request after late prototype, iterator and reflection poisoning', async () => {
    let resolveSource!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => {
      resolveSource = resolve;
    });
    const source = jsonResponse();
    const replay = jsonResponse();
    const fixture = setup(input =>
      input instanceof NativeRequest ? Promise.resolve(replay) : pending
    );
    const result = fixture.page.fetch(SOURCE, { headers: { authorization: SENTINEL } });
    const prebuilt = fixture.constructed[0];
    const poison = vi.fn(() => {
      throw new Error(SENTINEL);
    });
    const oldIterator = Object.getOwnPropertyDescriptor(Headers.prototype, Symbol.iterator)!;
    const oldForEach = Object.getOwnPropertyDescriptor(Headers.prototype, 'forEach')!;
    const oldCreate = Object.create;
    const oldOwnKeys = Reflect.ownKeys;
    Object.defineProperty(Object.prototype, 'mode', { configurable: true, get: poison });
    Object.defineProperty(Headers.prototype, Symbol.iterator, {
      configurable: true,
      value: poison,
    });
    Object.defineProperty(Headers.prototype, 'forEach', { configurable: true, value: poison });
    Object.create = poison;
    Reflect.ownKeys = poison;
    try {
      resolveSource(source);
      await result;
      await new Promise<void>(resolve => setTimeout(resolve, 25));
    } finally {
      Object.create = oldCreate;
      Reflect.ownKeys = oldOwnKeys;
      delete (Object.prototype as Record<string, unknown>).mode;
      Object.defineProperty(Headers.prototype, Symbol.iterator, oldIterator);
      Object.defineProperty(Headers.prototype, 'forEach', oldForEach);
    }
    await vi.waitFor(() => expect(fixture.snapshot()).toMatchObject({ kind: 'captured' }));
    expect(poison).not.toHaveBeenCalled();
    expect(fixture.constructed).toEqual([prebuilt]);
    expect(fixture.original.mock.calls[1]).toEqual([prebuilt]);
  });

  it('preserves native Request/no-override using captured native forEach even with hostile public iterators', async () => {
    const source = new NativeRequest(SOURCE, {
      headers: { authorization: SENTINEL },
      credentials: 'include',
    });
    const poison = vi.fn(() => {
      throw new Error(SENTINEL);
    });
    Object.defineProperty(source.headers, Symbol.iterator, { get: poison });
    const fixture = setup();
    const oldForEach = Object.getOwnPropertyDescriptor(Headers.prototype, 'forEach')!;
    const oldIterator = Object.getOwnPropertyDescriptor(Headers.prototype, Symbol.iterator)!;
    Object.defineProperty(Headers.prototype, 'forEach', { configurable: true, value: poison });
    Object.defineProperty(Headers.prototype, Symbol.iterator, {
      configurable: true,
      value: poison,
    });
    try {
      await fixture.page.fetch(source, { headers: source.headers });
      await vi.waitFor(() => expect(fixture.snapshot()).toMatchObject({ kind: 'captured' }));
    } finally {
      Object.defineProperty(Headers.prototype, 'forEach', oldForEach);
      Object.defineProperty(Headers.prototype, Symbol.iterator, oldIterator);
    }
    expect(poison).not.toHaveBeenCalled();
    expect(fixture.constructed).toHaveLength(1);
    expect(fixture.initShapes[0].nullHeaders).toBe(true);
  });

  it('reports only fixed metadata for strict plain headers, with zero probe dispatch', async () => {
    const fixture = setup(undefined, 'opaque-probe');
    await fixture.page.fetch(SOURCE, { headers: { Authorization: SENTINEL } });
    await vi.waitFor(() =>
      expect(fixture.snapshot()).toMatchObject({
        kind: 'result',
        result: {
          outcome: 'eligible-init-plain-headers',
          sourceIsNativeRequest: false,
          authorizationPresent: true,
          credentialsAccepted: true,
          singularDispatchCount: 0,
        },
      })
    );
    expect(fixture.original).toHaveBeenCalledOnce();
    expect(fixture.constructed[0].signal.aborted).toBe(true);
    vi.stubGlobal('window', fixture.page);
    expect(readChatGptOpaqueProbeState(NONCE)).toEqual(fixture.snapshot());
    const serialized = JSON.stringify(fixture.snapshot());
    expect(serialized).not.toContain(SENTINEL);
    expect(serialized).not.toContain('headerCount');
    expect(serialized).not.toContain('Authorization');
  });

  it.each(['opaque-resolver-observer'])(
    'does not expand %s to plain header eligibility',
    async mode => {
      const fixture = setup(undefined, mode);
      await fixture.page.fetch(SOURCE, { headers: { authorization: SENTINEL } });
      expect(fixture.constructed).toHaveLength(0);
      expect(fixture.original).toHaveBeenCalledOnce();
      const stateName =
        mode === 'opaque-resolver-observer'
          ? 'OpaqueResolver'
          : mode === 'active-resolver'
            ? 'ActiveResolver'
            : 'InterpreterResolver';
      const state = Object.getOwnPropertyDescriptor(
        fixture.page,
        `__liskaChatGpt${stateName}_${NONCE}`
      )?.get?.();
      expect(state).toMatchObject({ kind: 'error', code: 'source-not-eligible' });
    }
  );

  it.each(['opaque-resolver-observer', 'active-resolver', 'interpreter-resolver'])(
    'retains absent/empty/signal-only eligibility and rejects all compatible overrides in %s',
    async mode => {
      const cases: Array<{
        label: string;
        sourceCredentials?: RequestCredentials;
        init?: RequestInit | null;
        absent?: boolean;
        eligible: boolean;
      }> = [
        { label: 'absent init', absent: true, eligible: true },
        { label: 'undefined init', init: undefined, eligible: true },
        { label: 'null init', init: null, eligible: true },
        { label: 'empty init', init: {}, eligible: true },
        { label: 'null-prototype empty init', init: Object.create(null), eligible: true },
        {
          label: 'signal-only init',
          init: { signal: new AbortController().signal },
          eligible: true,
        },
        { label: 'undefined signal-only init', init: { signal: undefined }, eligible: true },
        { label: 'GET override', init: { method: 'GET' }, eligible: false },
        { label: 'null body override', init: { body: null }, eligible: false },
        { label: 'undefined headers override', init: { headers: undefined }, eligible: false },
        { label: 'same native Headers override', eligible: false },
        {
          label: 'distinct native Headers override',
          init: { headers: new Headers({ authorization: SENTINEL }) },
          eligible: false,
        },
        {
          label: 'plain override on native Request',
          init: { headers: { authorization: SENTINEL } },
          eligible: mode === 'interpreter-resolver' || mode === 'active-resolver',
        },
        {
          label: 'include credentials override',
          init: { credentials: 'include' },
          eligible: false,
        },
        {
          label: 'same-origin credentials override',
          init: { credentials: 'same-origin' },
          eligible: false,
        },
        {
          label: 'undefined credentials override',
          init: { credentials: undefined },
          eligible: false,
        },
        { label: 'standard cache member', init: { cache: 'no-store' }, eligible: false },
        {
          label: 'signal plus standard member',
          init: { signal: undefined, cache: 'no-store' },
          eligible: false,
        },
        {
          label: 'omit source cannot gain include credentials',
          sourceCredentials: 'omit',
          init: { credentials: 'include' },
          eligible: false,
        },
        {
          label: 'omit source remains rejected with no init',
          sourceCredentials: 'omit',
          absent: true,
          eligible: false,
        },
      ];
      for (const entry of cases) {
        // 500 proves that accepted source candidates reach response eligibility
        // without starting resolver observation/queues or issuing any request.
        const fixture = setup(async () => jsonResponse(500), mode);
        const source = new NativeRequest(SOURCE, {
          credentials: entry.sourceCredentials ?? 'include',
          headers: { authorization: SENTINEL },
        });
        const init =
          entry.label === 'same native Headers override' ? { headers: source.headers } : entry.init;
        const args = entry.absent ? [source] : [source, init];
        await Reflect.apply(fixture.page.fetch, fixture.page, args);
        const stateName =
          mode === 'opaque-resolver-observer'
            ? 'OpaqueResolver'
            : mode === 'active-resolver'
              ? 'ActiveResolver'
              : 'InterpreterResolver';
        const state = Object.getOwnPropertyDescriptor(
          fixture.page,
          `__liskaChatGpt${stateName}_${NONCE}`
        )?.get?.();
        expect(state, entry.label).toMatchObject({
          kind: 'error',
          code: entry.eligible ? 'source-http-error' : 'source-not-eligible',
        });
        expect(fixture.constructed, entry.label).toHaveLength(0);
        expect(fixture.original, entry.label).toHaveBeenCalledExactlyOnceWith(...args);
      }
    }
  );
});
