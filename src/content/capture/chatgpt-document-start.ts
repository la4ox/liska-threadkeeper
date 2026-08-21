/* eslint-disable max-lines-per-function, complexity, max-lines -- The marker-gated document-start entry snapshots page primordials before host code runs; keeping each trust-boundary operation linear avoids late page-global lookups. */
/**
 * MAIN-world document-start observer for ChatGPT's page-native conversation
 * request. This entry deliberately has no extension imports or messaging:
 * background can only read its small nonce-scoped state after the page has
 * issued the request itself.
 */

const CHATGPT_ORIGIN = 'https://chatgpt.com';
const CAPTURE_FRAGMENT_PATTERN =
  /^#liska-capture=([a-z0-9-]{16,128})(?:&liska-observe-asset-resolvers=(1))?$/i;
const CONVERSATION_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_RESOLVER_DISCOVERY_WINDOW_MS = 2_000;
const DEFAULT_RESOLVER_MAX_BYTES = 64 * 1024;
const DEFAULT_RESOLVER_MAX_OBSERVATIONS = 32;
const RESOLVER_PATH_PREFIX = '/backend-api/files/download/';
const PAYLOAD_TOO_LARGE = {};
const PRIMORDIAL_UNAVAILABLE = {};
const HEX_DIGITS = '0123456789abcdef';

type HookErrorCode =
  | 'hook-state-failed'
  | 'request-failed'
  | 'response-http-error'
  | 'response-media-type-invalid'
  | 'response-processing-failed'
  | 'conversation-request-timeout'
  | 'conversation-response-timeout'
  | 'payload-too-large';

type HookResult =
  | { kind: 'ready' }
  | {
      kind: 'captured';
      conversationId: string;
      capture: {
        bodyBase64: string;
        byteLength: number;
        sha256: string;
        mediaType: string;
      };
      resolverObservations: ResolverObservation[];
    }
  | { kind: 'error'; code: HookErrorCode };

type ResolverObservation = {
  providerFileId: string;
  bodyBase64: string;
  byteLength: number;
  sha256: string;
  mediaType: string;
};

type CapturedCallable = CallableFunction;

type DocumentPrimordials = {
  reflectApply: typeof Reflect.apply | undefined;
  URL: typeof URL | undefined;
  objectDefineProperty: typeof Object.defineProperty | undefined;
  objectGetOwnPropertyDescriptor: typeof Object.getOwnPropertyDescriptor | undefined;
  responseClone: CapturedCallable | undefined;
  responseArrayBuffer: CapturedCallable | undefined;
  responseStatus: CapturedCallable | undefined;
  responseHeaders: CapturedCallable | undefined;
  responseBody: CapturedCallable | undefined;
  headersGet: CapturedCallable | undefined;
  streamGetReader: CapturedCallable | undefined;
  readerRead: CapturedCallable | undefined;
  readerCancel: CapturedCallable | undefined;
  requestUrl: CapturedCallable | undefined;
  requestMethod: CapturedCallable | undefined;
  urlHref: CapturedCallable | undefined;
  urlOrigin: CapturedCallable | undefined;
  urlUsername: CapturedCallable | undefined;
  urlPassword: CapturedCallable | undefined;
  urlPathname: CapturedCallable | undefined;
  urlSearch: CapturedCallable | undefined;
  urlHash: CapturedCallable | undefined;
  promiseThen: CapturedCallable | undefined;
  arrayPush: CapturedCallable | undefined;
  uint8Array: typeof Uint8Array | undefined;
  uint8ArraySet: CapturedCallable | undefined;
  uint8ArraySubarray: CapturedCallable | undefined;
  arrayBufferSlice: CapturedCallable | undefined;
  stringFromCharCode: CapturedCallable | undefined;
  stringCharCodeAt: CapturedCallable | undefined;
  stringIndexOf: CapturedCallable | undefined;
  stringSlice: CapturedCallable | undefined;
  stringTrim: CapturedCallable | undefined;
  stringToLowerCase: CapturedCallable | undefined;
  stringToUpperCase: CapturedCallable | undefined;
  stringEndsWith: CapturedCallable | undefined;
};

type PagePrimordials = {
  document: DocumentPrimordials;
  btoa: CapturedCallable | undefined;
  btoaReceiver: unknown;
  subtleDigest: CapturedCallable | undefined;
  subtleReceiver: unknown;
  setTimeout: CapturedCallable | undefined;
  clearTimeout: CapturedCallable | undefined;
};

type PageState = {
  primordials: PagePrimordials;
  originalFetch: typeof window.fetch;
  wrappedFetch: typeof window.fetch | undefined;
  timeoutId: ReturnType<typeof window.setTimeout> | undefined;
  resolverDiscoveryTimeoutId: ReturnType<typeof window.setTimeout> | undefined;
  settled: boolean;
  claimed: boolean;
  resolverDiscoveryActive: boolean;
  resolverDiscoveryExpired: boolean;
  resolverClaims: number;
  conversationCapture:
    | {
        bodyBase64: string;
        byteLength: number;
        sha256: string;
        mediaType: string;
      }
    | undefined;
  resolverObservations: ResolverObservation[];
  result: HookResult;
};

export type ChatGptDocumentStartResult =
  | { kind: 'inert' }
  | { kind: 'ready' }
  | { kind: 'error'; code: 'hook-state-failed' };

type PageWindow = Window & typeof globalThis;

type MarkerTarget = {
  conversationId: string;
  nonce: string;
  observeAssetResolvers: boolean;
};

function methodAt(prototype: object | undefined, property: string): CapturedCallable | undefined {
  try {
    const method = (prototype as Record<string, unknown> | undefined)?.[property];
    return typeof method === 'function' ? (method as CapturedCallable) : undefined;
  } catch {
    return undefined;
  }
}

function getterAt(
  getOwnPropertyDescriptor: typeof Object.getOwnPropertyDescriptor | undefined,
  prototype: object | undefined,
  property: string
): CapturedCallable | undefined {
  try {
    if (getOwnPropertyDescriptor === undefined) return undefined;
    const descriptor = getOwnPropertyDescriptor(prototype ?? {}, property);
    return typeof descriptor?.get === 'function' ? (descriptor.get as CapturedCallable) : undefined;
  } catch {
    return undefined;
  }
}

/** Capture every later-used page primitive while document_start still wins the race. */
function snapshotDocumentPrimordials(pageWindow: PageWindow): DocumentPrimordials {
  const NativeObject = pageWindow.Object;
  const getOwnPropertyDescriptor = NativeObject?.getOwnPropertyDescriptor;
  const NativeResponse = pageWindow.Response;
  const NativeHeaders = pageWindow.Headers;
  const NativeRequest = pageWindow.Request;
  const NativeURL = pageWindow.URL;
  const NativeReadableStream = pageWindow.ReadableStream;
  const NativeReader = pageWindow.ReadableStreamDefaultReader;
  const NativePromise = pageWindow.Promise;
  const NativeArray = pageWindow.Array;
  const NativeUint8Array = pageWindow.Uint8Array;
  const NativeArrayBuffer = pageWindow.ArrayBuffer;
  const NativeString = pageWindow.String;
  const responsePrototype = NativeResponse?.prototype;
  const headersPrototype = NativeHeaders?.prototype;
  const requestPrototype = NativeRequest?.prototype;
  const urlPrototype = NativeURL?.prototype;
  const streamPrototype =
    typeof NativeReadableStream === 'function' ? NativeReadableStream.prototype : undefined;
  const readerPrototype = typeof NativeReader === 'function' ? NativeReader.prototype : undefined;

  return {
    reflectApply:
      typeof pageWindow.Reflect?.apply === 'function' ? pageWindow.Reflect.apply : undefined,
    URL: typeof NativeURL === 'function' ? NativeURL : undefined,
    objectDefineProperty:
      typeof NativeObject?.defineProperty === 'function' ? NativeObject.defineProperty : undefined,
    objectGetOwnPropertyDescriptor:
      typeof getOwnPropertyDescriptor === 'function' ? getOwnPropertyDescriptor : undefined,
    responseClone: methodAt(responsePrototype, 'clone'),
    responseArrayBuffer: methodAt(responsePrototype, 'arrayBuffer'),
    responseStatus: getterAt(getOwnPropertyDescriptor, responsePrototype, 'status'),
    responseHeaders: getterAt(getOwnPropertyDescriptor, responsePrototype, 'headers'),
    responseBody: getterAt(getOwnPropertyDescriptor, responsePrototype, 'body'),
    headersGet: methodAt(headersPrototype, 'get'),
    streamGetReader: methodAt(streamPrototype, 'getReader'),
    readerRead: methodAt(readerPrototype, 'read'),
    readerCancel: methodAt(readerPrototype, 'cancel'),
    requestUrl: getterAt(getOwnPropertyDescriptor, requestPrototype, 'url'),
    requestMethod: getterAt(getOwnPropertyDescriptor, requestPrototype, 'method'),
    urlHref: getterAt(getOwnPropertyDescriptor, urlPrototype, 'href'),
    urlOrigin: getterAt(getOwnPropertyDescriptor, urlPrototype, 'origin'),
    urlUsername: getterAt(getOwnPropertyDescriptor, urlPrototype, 'username'),
    urlPassword: getterAt(getOwnPropertyDescriptor, urlPrototype, 'password'),
    urlPathname: getterAt(getOwnPropertyDescriptor, urlPrototype, 'pathname'),
    urlSearch: getterAt(getOwnPropertyDescriptor, urlPrototype, 'search'),
    urlHash: getterAt(getOwnPropertyDescriptor, urlPrototype, 'hash'),
    promiseThen: methodAt(NativePromise?.prototype, 'then'),
    arrayPush: methodAt(NativeArray?.prototype, 'push'),
    uint8Array: typeof NativeUint8Array === 'function' ? NativeUint8Array : undefined,
    uint8ArraySet: methodAt(NativeUint8Array?.prototype, 'set'),
    uint8ArraySubarray: methodAt(NativeUint8Array?.prototype, 'subarray'),
    arrayBufferSlice:
      typeof NativeArrayBuffer === 'function'
        ? methodAt(NativeArrayBuffer.prototype, 'slice')
        : undefined,
    stringFromCharCode:
      typeof NativeString?.fromCharCode === 'function' ? NativeString.fromCharCode : undefined,
    stringCharCodeAt: methodAt(NativeString?.prototype, 'charCodeAt'),
    stringIndexOf: methodAt(NativeString?.prototype, 'indexOf'),
    stringSlice: methodAt(NativeString?.prototype, 'slice'),
    stringTrim: methodAt(NativeString?.prototype, 'trim'),
    stringToLowerCase: methodAt(NativeString?.prototype, 'toLowerCase'),
    stringToUpperCase: methodAt(NativeString?.prototype, 'toUpperCase'),
    stringEndsWith: methodAt(NativeString?.prototype, 'endsWith'),
  };
}

function applyCaptured<T>(
  primordials: PagePrimordials,
  callback: CapturedCallable | undefined,
  receiver: unknown,
  argumentsList: ArrayLike<unknown>
): T {
  if (primordials.document.reflectApply === undefined || callback === undefined) {
    throw PRIMORDIAL_UNAVAILABLE;
  }
  return primordials.document.reflectApply(callback, receiver, argumentsList) as T;
}

function markerTargetFromHref(href: string): MarkerTarget | undefined {
  try {
    const url = new URL(href);
    if (
      url.origin !== CHATGPT_ORIGIN ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== ''
    ) {
      return undefined;
    }

    const marker = CAPTURE_FRAGMENT_PATTERN.exec(url.hash);
    const nonce = marker?.[1];
    if (nonce === undefined) return undefined;

    const standard = /^\/c\/([^/]+)\/?$/.exec(url.pathname);
    const custom = /^\/g\/[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?\/c\/([^/]+)\/?$/i.exec(
      url.pathname
    );
    const conversationId = standard?.[1] ?? custom?.[1];
    return conversationId !== undefined && CONVERSATION_ID_PATTERN.test(conversationId)
      ? { conversationId, nonce, observeAssetResolvers: marker?.[2] === '1' }
      : undefined;
  } catch {
    return undefined;
  }
}

function pagePrimordials(pageWindow: PageWindow): PagePrimordials | undefined {
  try {
    const document = snapshotDocumentPrimordials(pageWindow);
    const btoa = pageWindow.btoa;
    const subtle = pageWindow.crypto?.subtle;
    const digest = subtle?.digest;
    const setTimeout = pageWindow.setTimeout;
    const clearTimeout = pageWindow.clearTimeout;
    return {
      document,
      btoa: typeof btoa === 'function' ? (btoa as CapturedCallable) : undefined,
      btoaReceiver: pageWindow,
      subtleDigest: typeof digest === 'function' ? (digest as CapturedCallable) : undefined,
      subtleReceiver: subtle,
      setTimeout: typeof setTimeout === 'function' ? (setTimeout as CapturedCallable) : undefined,
      clearTimeout:
        typeof clearTimeout === 'function' ? (clearTimeout as CapturedCallable) : undefined,
    };
  } catch {
    return undefined;
  }
}

function hasArmingPrimordials(primordials: PagePrimordials): boolean {
  const document = primordials.document;
  return (
    document.reflectApply !== undefined &&
    document.URL !== undefined &&
    document.objectDefineProperty !== undefined &&
    document.objectGetOwnPropertyDescriptor !== undefined &&
    document.stringToUpperCase !== undefined &&
    document.promiseThen !== undefined &&
    primordials.setTimeout !== undefined &&
    primordials.clearTimeout !== undefined
  );
}

function isJsonMediaType(primordials: PagePrimordials, value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 255) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = applyCaptured<number>(primordials, primordials.document.stringCharCodeAt, value, [
      index,
    ]);
    if (code <= 0x1f) return false;
  }
  const separator = applyCaptured<number>(primordials, primordials.document.stringIndexOf, value, [
    ';',
  ]);
  const source =
    separator < 0
      ? value
      : applyCaptured<string>(primordials, primordials.document.stringSlice, value, [0, separator]);
  const essence = applyCaptured<string>(
    primordials,
    primordials.document.stringToLowerCase,
    applyCaptured<string>(primordials, primordials.document.stringTrim, source, []),
    []
  );
  return (
    essence === 'application/json' ||
    applyCaptured<boolean>(primordials, primordials.document.stringEndsWith, essence, ['+json'])
  );
}

function pageOwnedGetUrl(
  primordials: PagePrimordials,
  input: RequestInfo | URL,
  init: RequestInit | undefined
): URL | undefined {
  try {
    let rawUrl: string;
    let requestMethod: unknown = 'GET';
    if (typeof input === 'string') {
      rawUrl = input;
    } else {
      try {
        rawUrl = applyCaptured<string>(primordials, primordials.document.urlHref, input, []);
      } catch {
        // Request.url and Request.method are the only Request fields read here.
        // In particular, request headers, cookies, and body are never inspected.
        rawUrl = applyCaptured<string>(primordials, primordials.document.requestUrl, input, []);
        requestMethod = applyCaptured<unknown>(
          primordials,
          primordials.document.requestMethod,
          input,
          []
        );
      }
    }

    // Do not inspect init.headers; an init method merely controls fetch's
    // effective method and is needed to reject POST/other calls precisely.
    const initMethod = init?.method;
    const method = typeof initMethod === 'string' ? initMethod : requestMethod;
    const URLConstructor = primordials.document.URL;
    if (URLConstructor === undefined || typeof method !== 'string') return undefined;
    const url = new URLConstructor(rawUrl, CHATGPT_ORIGIN);
    return applyCaptured<string>(
      primordials,
      primordials.document.stringToUpperCase,
      method,
      []
    ) === 'GET' &&
      applyCaptured<string>(primordials, primordials.document.urlOrigin, url, []) ===
        CHATGPT_ORIGIN &&
      applyCaptured<string>(primordials, primordials.document.urlUsername, url, []) === '' &&
      applyCaptured<string>(primordials, primordials.document.urlPassword, url, []) === ''
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function targetRequest(
  primordials: PagePrimordials,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  conversationId: string
): boolean {
  const url = pageOwnedGetUrl(primordials, input, init);
  return (
    url !== undefined &&
    applyCaptured<string>(primordials, primordials.document.urlPathname, url, []) ===
      `/backend-api/conversation/${conversationId}` &&
    applyCaptured<string>(primordials, primordials.document.urlSearch, url, []) === '' &&
    applyCaptured<string>(primordials, primordials.document.urlHash, url, []) === ''
  );
}

function isSafeResolverFileId(primordials: PagePrimordials, value: string): boolean {
  if (value.length === 0 || value.length > 256) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = applyCaptured<number>(primordials, primordials.document.stringCharCodeAt, value, [
      index,
    ]);
    const isAsciiLetter = (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
    const isDigit = code >= 0x30 && code <= 0x39;
    if (!isAsciiLetter && !isDigit && code !== 0x2d && code !== 0x5f) return false;
  }
  return true;
}

/**
 * Return only the bounded path segment needed to bind a resolver observation.
 * URL/method are the sole request fields inspected; headers, cookies, and body
 * remain entirely page-private.
 */
function resolverTargetFileId(
  primordials: PagePrimordials,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  conversationId: string
): string | undefined {
  const url = pageOwnedGetUrl(primordials, input, init);
  if (url === undefined) return undefined;
  const pathname = applyCaptured<string>(primordials, primordials.document.urlPathname, url, []);
  const pathPrefixIndex = applyCaptured<number>(
    primordials,
    primordials.document.stringIndexOf,
    pathname,
    [RESOLVER_PATH_PREFIX]
  );
  if (pathPrefixIndex !== 0) return undefined;
  const providerFileId = applyCaptured<string>(
    primordials,
    primordials.document.stringSlice,
    pathname,
    [RESOLVER_PATH_PREFIX.length]
  );
  if (!isSafeResolverFileId(primordials, providerFileId)) return undefined;

  const query = applyCaptured<string>(primordials, primordials.document.urlSearch, url, []);
  const expectedFirst = `?conversation_id=${conversationId}&inline=true`;
  const expectedSecond = `?inline=true&conversation_id=${conversationId}`;
  return (query === expectedFirst || query === expectedSecond) &&
    applyCaptured<string>(primordials, primordials.document.urlHash, url, []) === ''
    ? providerFileId
    : undefined;
}

function responseBody(
  primordials: PagePrimordials,
  response: Response
): ReadableStream<Uint8Array> | null {
  return applyCaptured<ReadableStream<Uint8Array> | null>(
    primordials,
    primordials.document.responseBody,
    response,
    []
  );
}

async function cancelClone(
  primordials: PagePrimordials,
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<void> {
  try {
    if (primordials.document.readerCancel !== undefined) {
      await applyCaptured<Promise<void>>(
        primordials,
        primordials.document.readerCancel,
        reader,
        []
      );
    }
  } catch {
    // Keep the size error stable even when a cloned transport cannot cancel.
  }
}

async function readBoundedClone(
  primordials: PagePrimordials,
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  const NativeUint8Array = primordials.document.uint8Array;
  if (NativeUint8Array === undefined) throw PRIMORDIAL_UNAVAILABLE;

  const body = responseBody(primordials, response);
  if (body === null) {
    const buffer = await applyCaptured<ArrayBuffer>(
      primordials,
      primordials.document.responseArrayBuffer,
      response,
      []
    );
    const bytes = new NativeUint8Array(buffer);
    if (bytes.byteLength > maxBytes) throw PAYLOAD_TOO_LARGE;
    return bytes;
  }

  const reader = applyCaptured<ReadableStreamDefaultReader<Uint8Array>>(
    primordials,
    primordials.document.streamGetReader,
    body,
    []
  );
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const next = await applyCaptured<ReadableStreamReadResult<Uint8Array>>(
      primordials,
      primordials.document.readerRead,
      reader,
      []
    );
    if (next.done) break;
    const chunk = next.value;
    if (chunk === undefined || typeof chunk.byteLength !== 'number') {
      throw PRIMORDIAL_UNAVAILABLE;
    }
    byteLength += chunk.byteLength;
    if (byteLength > maxBytes) {
      await cancelClone(primordials, reader);
      throw PAYLOAD_TOO_LARGE;
    }
    applyCaptured<void>(primordials, primordials.document.arrayPush, chunks, [chunk]);
  }

  const bytes = new NativeUint8Array(byteLength);
  let offset = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    applyCaptured<void>(primordials, primordials.document.uint8ArraySet, bytes, [chunk, offset]);
    offset += chunk.byteLength;
  }
  return bytes;
}

function base64FromBytes(primordials: PagePrimordials, bytes: Uint8Array): string {
  if (primordials.btoa === undefined) throw PRIMORDIAL_UNAVAILABLE;
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = applyCaptured<Uint8Array>(
      primordials,
      primordials.document.uint8ArraySubarray,
      bytes,
      [offset, offset + chunkSize]
    );
    binary += applyCaptured<string>(
      primordials,
      primordials.document.stringFromCharCode,
      undefined,
      chunk as unknown as ArrayLike<unknown>
    );
  }
  return applyCaptured<string>(primordials, primordials.btoa, primordials.btoaReceiver, [binary]);
}

async function sha256FromBytes(primordials: PagePrimordials, bytes: Uint8Array): Promise<string> {
  const exactBuffer = applyCaptured<ArrayBuffer>(
    primordials,
    primordials.document.arrayBufferSlice,
    bytes.buffer,
    [bytes.byteOffset, bytes.byteOffset + bytes.byteLength]
  );
  const digest = await applyCaptured<ArrayBuffer>(
    primordials,
    primordials.subtleDigest,
    primordials.subtleReceiver,
    ['SHA-256', exactBuffer]
  );
  const NativeUint8Array = primordials.document.uint8Array;
  if (NativeUint8Array === undefined) throw PRIMORDIAL_UNAVAILABLE;
  const digestBytes = new NativeUint8Array(digest);
  let sha256 = '';
  for (let index = 0; index < digestBytes.byteLength; index += 1) {
    const byte = digestBytes[index];
    sha256 += HEX_DIGITS[(byte >>> 4) & 0x0f] + HEX_DIGITS[byte & 0x0f];
  }
  return sha256;
}

function stateKeyFor(nonce: string): string {
  return `__liskaChatGptCapture_${nonce}`;
}

function snapshotHookResult(result: HookResult): HookResult {
  if (result.kind === 'ready') return { kind: 'ready' };
  if (result.kind === 'error') return { kind: 'error', code: result.code };
  const resolverObservations: ResolverObservation[] = [];
  for (let index = 0; index < result.resolverObservations.length; index += 1) {
    const observation = result.resolverObservations[index];
    resolverObservations[index] = {
      providerFileId: observation.providerFileId,
      bodyBase64: observation.bodyBase64,
      byteLength: observation.byteLength,
      sha256: observation.sha256,
      mediaType: observation.mediaType,
    };
  }
  return {
    kind: 'captured',
    conversationId: result.conversationId,
    capture: {
      bodyBase64: result.capture.bodyBase64,
      byteLength: result.capture.byteLength,
      sha256: result.capture.sha256,
      mediaType: result.capture.mediaType,
    },
    resolverObservations,
  };
}

function publishResultSnapshot(
  primordials: PagePrimordials,
  windowRecord: Record<string, unknown>,
  stateKey: string,
  state: PageState
): boolean {
  try {
    const defineProperty = primordials.document.objectDefineProperty;
    if (defineProperty === undefined) return false;
    defineProperty(windowRecord, stateKey, {
      configurable: false,
      enumerable: false,
      get: () => snapshotHookResult(state.result),
    });
    return true;
  } catch {
    return false;
  }
}

function createPageState(
  pageWindow: PageWindow,
  primordials: PagePrimordials
): PageState | undefined {
  try {
    const originalFetch = pageWindow.fetch;
    if (typeof originalFetch !== 'function') return undefined;
    return {
      primordials,
      originalFetch,
      wrappedFetch: undefined,
      timeoutId: undefined,
      resolverDiscoveryTimeoutId: undefined,
      settled: false,
      claimed: false,
      resolverDiscoveryActive: false,
      resolverDiscoveryExpired: false,
      resolverClaims: 0,
      conversationCapture: undefined,
      resolverObservations: [],
      result: { kind: 'ready' },
    };
  } catch {
    return undefined;
  }
}

function finishCapture(pageWindow: PageWindow, state: PageState, result: HookResult): void {
  if (state.settled) return;
  state.settled = true;
  state.result = result;

  if (state.timeoutId !== undefined) {
    try {
      applyCaptured<void>(state.primordials, state.primordials.clearTimeout, pageWindow, [
        state.timeoutId,
      ]);
    } catch {
      // The result is still terminal even if a hostile page shim rejects clearTimeout.
    }
    state.timeoutId = undefined;
  }

  if (state.resolverDiscoveryTimeoutId !== undefined) {
    try {
      applyCaptured<void>(state.primordials, state.primordials.clearTimeout, pageWindow, [
        state.resolverDiscoveryTimeoutId,
      ]);
    } catch {
      // The result is still terminal even if a hostile page shim rejects clearTimeout.
    }
    state.resolverDiscoveryTimeoutId = undefined;
  }
  state.resolverDiscoveryActive = false;

  try {
    if (state.wrappedFetch !== undefined && pageWindow.fetch === state.wrappedFetch) {
      pageWindow.fetch = state.originalFetch;
    }
  } catch {
    // Never overwrite a later page-owned wrapper after an assignment failure.
  }
}

function completeCapturedConversation(
  pageWindow: PageWindow,
  state: PageState,
  conversationId: string
): void {
  const capture = state.conversationCapture;
  if (capture === undefined) {
    finishCapture(pageWindow, state, { kind: 'error', code: 'response-processing-failed' });
    return;
  }
  finishCapture(pageWindow, state, {
    kind: 'captured',
    conversationId,
    capture,
    resolverObservations: state.resolverObservations,
  });
}

function armResolverDiscoveryWindow(
  pageWindow: PageWindow,
  state: PageState,
  target: MarkerTarget
): void {
  if (
    !target.observeAssetResolvers ||
    state.settled ||
    state.resolverDiscoveryActive ||
    state.resolverDiscoveryExpired
  ) {
    return;
  }
  state.resolverDiscoveryActive = true;
  try {
    state.resolverDiscoveryTimeoutId = applyCaptured<ReturnType<typeof pageWindow.setTimeout>>(
      state.primordials,
      state.primordials.setTimeout,
      pageWindow,
      [
        () => {
          state.resolverDiscoveryTimeoutId = undefined;
          state.resolverDiscoveryActive = false;
          state.resolverDiscoveryExpired = true;
          if (state.conversationCapture !== undefined) {
            completeCapturedConversation(pageWindow, state, target.conversationId);
          }
        },
        DEFAULT_RESOLVER_DISCOVERY_WINDOW_MS,
      ]
    );
  } catch {
    state.resolverDiscoveryActive = false;
    state.resolverDiscoveryExpired = true;
  }
}

function beginResolverDiscovery(
  pageWindow: PageWindow,
  state: PageState,
  target: MarkerTarget,
  capture: NonNullable<PageState['conversationCapture']>
): void {
  if (state.settled) return;
  state.conversationCapture = capture;

  if (state.timeoutId !== undefined) {
    try {
      applyCaptured<void>(state.primordials, state.primordials.clearTimeout, pageWindow, [
        state.timeoutId,
      ]);
    } catch {
      // A verified capture remains valid even if a hostile timer shim rejects cleanup.
    }
    state.timeoutId = undefined;
  }

  if (
    !target.observeAssetResolvers ||
    state.resolverDiscoveryExpired ||
    !state.resolverDiscoveryActive
  ) {
    completeCapturedConversation(pageWindow, state, target.conversationId);
  }
}

async function captureNativeResponse(
  pageWindow: PageWindow,
  state: PageState,
  response: Response,
  maxBytes: number,
  target: MarkerTarget
): Promise<void> {
  const primordials = state.primordials;
  try {
    const status = applyCaptured<number>(
      primordials,
      primordials.document.responseStatus,
      response,
      []
    );
    if (status !== 200) {
      finishCapture(pageWindow, state, { kind: 'error', code: 'response-http-error' });
      return;
    }

    const headers = applyCaptured<Headers>(
      primordials,
      primordials.document.responseHeaders,
      response,
      []
    );
    const rawMediaType = applyCaptured<string | null>(
      primordials,
      primordials.document.headersGet,
      headers,
      ['content-type']
    );
    const mediaType =
      typeof rawMediaType === 'string'
        ? applyCaptured<string>(primordials, primordials.document.stringTrim, rawMediaType, [])
        : '';
    if (!isJsonMediaType(primordials, mediaType)) {
      finishCapture(pageWindow, state, { kind: 'error', code: 'response-media-type-invalid' });
      return;
    }

    // The page receives the original response promise and may begin resolver
    // requests while our large conversation clone is still being read. The
    // single hard two-second window starts before that await and is never
    // extended by clone/hash work.
    armResolverDiscoveryWindow(pageWindow, state, target);

    // The page receives the original response promise unchanged. Only this
    // exact native request gets a clone, which is consumed under the byte cap.
    const clone = applyCaptured<Response>(
      primordials,
      primordials.document.responseClone,
      response,
      []
    );
    const bytes = await readBoundedClone(primordials, clone, maxBytes);
    const sha256 = await sha256FromBytes(primordials, bytes);
    beginResolverDiscovery(pageWindow, state, target, {
      bodyBase64: base64FromBytes(primordials, bytes),
      byteLength: bytes.byteLength,
      sha256,
      mediaType,
    });
  } catch (error) {
    finishCapture(pageWindow, state, {
      kind: 'error',
      code: error === PAYLOAD_TOO_LARGE ? 'payload-too-large' : 'response-processing-failed',
    });
  }
}

async function captureResolverResponse(
  pageWindow: PageWindow,
  state: PageState,
  response: Response,
  providerFileId: string
): Promise<void> {
  const primordials = state.primordials;
  try {
    if (!state.resolverDiscoveryActive) return;
    const status = applyCaptured<number>(
      primordials,
      primordials.document.responseStatus,
      response,
      []
    );
    if (status < 200 || status >= 300) return;

    const headers = applyCaptured<Headers>(
      primordials,
      primordials.document.responseHeaders,
      response,
      []
    );
    const rawMediaType = applyCaptured<string | null>(
      primordials,
      primordials.document.headersGet,
      headers,
      ['content-type']
    );
    const mediaType =
      typeof rawMediaType === 'string'
        ? applyCaptured<string>(primordials, primordials.document.stringTrim, rawMediaType, [])
        : '';
    if (!isJsonMediaType(primordials, mediaType)) return;

    const clone = applyCaptured<Response>(
      primordials,
      primordials.document.responseClone,
      response,
      []
    );
    const bytes = await readBoundedClone(primordials, clone, DEFAULT_RESOLVER_MAX_BYTES);
    if (!state.resolverDiscoveryActive) return;
    const sha256 = await sha256FromBytes(primordials, bytes);
    if (!state.resolverDiscoveryActive) return;
    state.resolverObservations[state.resolverObservations.length] = {
      providerFileId,
      bodyBase64: base64FromBytes(primordials, bytes),
      byteLength: bytes.byteLength,
      sha256,
      mediaType,
    };
  } catch {
    // Resolver observations are optional and never downgrade a verified
    // conversation capture. Malformed, oversized, and late responses vanish.
  }
}

function observeNativeResponse(
  pageWindow: PageWindow,
  state: PageState,
  responsePromise: Promise<Response>,
  target: MarkerTarget
): void {
  try {
    const observation = applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      responsePromise,
      [
        (response: Response) =>
          captureNativeResponse(pageWindow, state, response, DEFAULT_MAX_BYTES, target),
        () => finishCapture(pageWindow, state, { kind: 'error', code: 'request-failed' }),
      ]
    );
    void applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      observation,
      [
        () => undefined,
        () =>
          finishCapture(pageWindow, state, { kind: 'error', code: 'response-processing-failed' }),
      ]
    );
  } catch {
    finishCapture(pageWindow, state, { kind: 'error', code: 'response-processing-failed' });
  }
}

function observeResolverResponse(
  pageWindow: PageWindow,
  state: PageState,
  responsePromise: Promise<Response>,
  providerFileId: string
): void {
  try {
    const observation = applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      responsePromise,
      [
        (response: Response) =>
          captureResolverResponse(pageWindow, state, response, providerFileId),
        () => undefined,
      ]
    );
    void applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      observation,
      [() => undefined, () => undefined]
    );
  } catch {
    // Resolver observations are opportunistic and must stay fail-silent.
  }
}

function createWrappedFetch(
  pageWindow: PageWindow,
  state: PageState,
  target: MarkerTarget
): typeof pageWindow.fetch {
  return function (
    this: PageWindow,
    ...args: Parameters<typeof pageWindow.fetch>
  ): ReturnType<typeof pageWindow.fetch> {
    const shouldCaptureConversation =
      !state.settled &&
      !state.claimed &&
      targetRequest(state.primordials, args[0], args[1], target.conversationId);
    if (shouldCaptureConversation) state.claimed = true;

    const resolverFileId =
      !state.settled &&
      state.resolverDiscoveryActive &&
      state.resolverClaims < DEFAULT_RESOLVER_MAX_OBSERVATIONS
        ? resolverTargetFileId(state.primordials, args[0], args[1], target.conversationId)
        : undefined;
    if (resolverFileId !== undefined) state.resolverClaims += 1;

    let responsePromise: ReturnType<typeof pageWindow.fetch>;
    try {
      responsePromise = applyCaptured<ReturnType<typeof pageWindow.fetch>>(
        state.primordials,
        state.originalFetch,
        this,
        args
      );
    } catch (error) {
      if (shouldCaptureConversation) {
        finishCapture(pageWindow, state, { kind: 'error', code: 'request-failed' });
      }
      throw error;
    }

    if (shouldCaptureConversation)
      observeNativeResponse(pageWindow, state, responsePromise, target);
    if (resolverFileId !== undefined) {
      observeResolverResponse(pageWindow, state, responsePromise, resolverFileId);
    }
    return responsePromise;
  } as typeof pageWindow.fetch;
}

function armNativeFetchObserver(
  pageWindow: PageWindow,
  state: PageState,
  target: MarkerTarget
): void {
  const wrappedFetch = createWrappedFetch(pageWindow, state, target);
  try {
    state.wrappedFetch = wrappedFetch;
    pageWindow.fetch = wrappedFetch;
    state.timeoutId = applyCaptured<ReturnType<typeof pageWindow.setTimeout>>(
      state.primordials,
      state.primordials.setTimeout,
      pageWindow,
      [
        () =>
          finishCapture(pageWindow, state, {
            kind: 'error',
            code: state.claimed ? 'conversation-response-timeout' : 'conversation-request-timeout',
          }),
        DEFAULT_TIMEOUT_MS,
      ]
    );
  } catch {
    finishCapture(pageWindow, state, { kind: 'error', code: 'hook-state-failed' });
  }
}

/**
 * Arm a single document before ChatGPT application code starts. URLs without
 * an exact route and nonce marker return inert before touching fetch, DOM, or
 * page state.
 */
export function startChatGptDocumentStartCapture(
  pageWindow: PageWindow = window
): ChatGptDocumentStartResult {
  const target = markerTargetFromHref(pageWindow.location.href);
  if (target === undefined) return { kind: 'inert' };

  const primordials = pagePrimordials(pageWindow);
  if (primordials === undefined || !hasArmingPrimordials(primordials)) {
    return { kind: 'error', code: 'hook-state-failed' };
  }

  const stateKey = stateKeyFor(target.nonce);
  const windowRecord = pageWindow as unknown as Record<string, unknown>;
  try {
    const getOwnPropertyDescriptor = primordials.document.objectGetOwnPropertyDescriptor;
    if (
      getOwnPropertyDescriptor === undefined ||
      getOwnPropertyDescriptor(windowRecord, stateKey) !== undefined
    ) {
      return { kind: 'error', code: 'hook-state-failed' };
    }
  } catch {
    return { kind: 'error', code: 'hook-state-failed' };
  }

  const state = createPageState(pageWindow, primordials);
  if (state === undefined) {
    return { kind: 'error', code: 'hook-state-failed' };
  }
  if (!publishResultSnapshot(primordials, windowRecord, stateKey, state)) {
    return { kind: 'error', code: 'hook-state-failed' };
  }
  armNativeFetchObserver(pageWindow, state, target);
  return { kind: 'ready' };
}

if (typeof window !== 'undefined') {
  startChatGptDocumentStartCapture();
}
