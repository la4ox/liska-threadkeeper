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
const OPAQUE_PROBE_FRAGMENT_PATTERN = /^#liska-capture=([a-z0-9-]{16,128})&liska-opaque-probe=1$/i;
const OPAQUE_REPLAY_FRAGMENT_PATTERN =
  /^#liska-capture=([a-z0-9-]{16,128})&liska-opaque-replay=1$/i;
const OPAQUE_RESOLVER_FRAGMENT_PATTERN =
  /^#liska-capture=([a-z0-9-]{16,128})&liska-opaque-resolver-observer=1$/i;
const ACTIVE_RESOLVER_FRAGMENT_PATTERN =
  /^#liska-capture=([a-z0-9-]{16,128})&liska-active-resolver=1$/i;
const CONVERSATION_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_OPAQUE_PROBE_TIMEOUT_MS = 45_000;
const DEFAULT_RESOLVER_DISCOVERY_WINDOW_MS = 2_000;
const DEFAULT_OPAQUE_RESOLVER_DISCOVERY_WINDOW_MS = 8_000;
const DEFAULT_RESOLVER_MAX_BYTES = 64 * 1024;
const DEFAULT_RESOLVER_MAX_OBSERVATIONS = 32;
const DEFAULT_ACTIVE_RESOLVER_MAX_OBSERVATIONS = 20;
const DEFAULT_ACTIVE_RESOLVER_MAX_BYTES = 64 * 1024;
const DEFAULT_ACTIVE_RESOLVER_MAX_TOTAL_BYTES =
  DEFAULT_ACTIVE_RESOLVER_MAX_OBSERVATIONS * DEFAULT_ACTIVE_RESOLVER_MAX_BYTES;
const DEFAULT_ACTIVE_RESOLVER_PER_ID_TIMEOUT_MS = 12_000;
const RESOLVER_PATH_PREFIX = '/backend-api/files/download/';
const CALPICO_RESOLVER_PATH_PREFIX = '/backend-api/calpico/chatgpt/files/';
const PAYLOAD_TOO_LARGE = {};
const PRIMORDIAL_UNAVAILABLE = {};
const HEX_DIGITS = '0123456789abcdef';
const REQUEST_INIT_MEMBER_NAMES = [
  'attributionReporting',
  'body',
  'browsingTopics',
  'cache',
  'credentials',
  'duplex',
  'headers',
  'integrity',
  'keepalive',
  'method',
  'mode',
  'priority',
  'redirect',
  'referrer',
  'referrerPolicy',
  'signal',
  'window',
] as const;

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
  objectGetPrototypeOf: typeof Object.getPrototypeOf | undefined;
  objectPrototype: object | undefined;
  reflectOwnKeys: typeof Reflect.ownKeys | undefined;
  responseClone: CapturedCallable | undefined;
  responseArrayBuffer: CapturedCallable | undefined;
  responseStatus: CapturedCallable | undefined;
  responseHeaders: CapturedCallable | undefined;
  responseBody: CapturedCallable | undefined;
  headersGet: CapturedCallable | undefined;
  headersHas: CapturedCallable | undefined;
  streamGetReader: CapturedCallable | undefined;
  readerRead: CapturedCallable | undefined;
  readerCancel: CapturedCallable | undefined;
  requestUrl: CapturedCallable | undefined;
  requestMethod: CapturedCallable | undefined;
  requestHeaders: CapturedCallable | undefined;
  requestCredentials: CapturedCallable | undefined;
  requestClone: CapturedCallable | undefined;
  requestConstructor: typeof Request | undefined;
  abortControllerConstructor: typeof AbortController | undefined;
  abortControllerAbort: CapturedCallable | undefined;
  abortControllerSignal: CapturedCallable | undefined;
  urlHref: CapturedCallable | undefined;
  urlOrigin: CapturedCallable | undefined;
  urlUsername: CapturedCallable | undefined;
  urlPassword: CapturedCallable | undefined;
  urlPathname: CapturedCallable | undefined;
  urlSearch: CapturedCallable | undefined;
  urlHash: CapturedCallable | undefined;
  promiseThen: CapturedCallable | undefined;
  arrayIsArray: CapturedCallable | undefined;
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
  mode: 'capture' | 'opaque-probe' | 'opaque-replay' | 'opaque-resolver' | 'active-resolver';
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
  const NativeAbortController = pageWindow.AbortController;
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
  const abortControllerPrototype = NativeAbortController?.prototype;
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
    objectGetPrototypeOf:
      typeof NativeObject?.getPrototypeOf === 'function' ? NativeObject.getPrototypeOf : undefined,
    objectPrototype: NativeObject?.prototype,
    reflectOwnKeys:
      typeof pageWindow.Reflect?.ownKeys === 'function' ? pageWindow.Reflect.ownKeys : undefined,
    responseClone: methodAt(responsePrototype, 'clone'),
    responseArrayBuffer: methodAt(responsePrototype, 'arrayBuffer'),
    responseStatus: getterAt(getOwnPropertyDescriptor, responsePrototype, 'status'),
    responseHeaders: getterAt(getOwnPropertyDescriptor, responsePrototype, 'headers'),
    responseBody: getterAt(getOwnPropertyDescriptor, responsePrototype, 'body'),
    headersGet: methodAt(headersPrototype, 'get'),
    headersHas: methodAt(headersPrototype, 'has'),
    streamGetReader: methodAt(streamPrototype, 'getReader'),
    readerRead: methodAt(readerPrototype, 'read'),
    readerCancel: methodAt(readerPrototype, 'cancel'),
    requestUrl: getterAt(getOwnPropertyDescriptor, requestPrototype, 'url'),
    requestMethod: getterAt(getOwnPropertyDescriptor, requestPrototype, 'method'),
    requestHeaders: getterAt(getOwnPropertyDescriptor, requestPrototype, 'headers'),
    requestCredentials: getterAt(getOwnPropertyDescriptor, requestPrototype, 'credentials'),
    requestClone: methodAt(requestPrototype, 'clone'),
    requestConstructor: typeof NativeRequest === 'function' ? NativeRequest : undefined,
    abortControllerConstructor:
      typeof NativeAbortController === 'function' ? NativeAbortController : undefined,
    abortControllerAbort: methodAt(abortControllerPrototype, 'abort'),
    abortControllerSignal: getterAt(getOwnPropertyDescriptor, abortControllerPrototype, 'signal'),
    urlHref: getterAt(getOwnPropertyDescriptor, urlPrototype, 'href'),
    urlOrigin: getterAt(getOwnPropertyDescriptor, urlPrototype, 'origin'),
    urlUsername: getterAt(getOwnPropertyDescriptor, urlPrototype, 'username'),
    urlPassword: getterAt(getOwnPropertyDescriptor, urlPrototype, 'password'),
    urlPathname: getterAt(getOwnPropertyDescriptor, urlPrototype, 'pathname'),
    urlSearch: getterAt(getOwnPropertyDescriptor, urlPrototype, 'search'),
    urlHash: getterAt(getOwnPropertyDescriptor, urlPrototype, 'hash'),
    promiseThen: methodAt(NativePromise?.prototype, 'then'),
    arrayIsArray:
      typeof NativeArray?.isArray === 'function'
        ? (NativeArray.isArray as CapturedCallable)
        : undefined,
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

    const activeResolverMarker = ACTIVE_RESOLVER_FRAGMENT_PATTERN.exec(url.hash);
    const replayMarker =
      activeResolverMarker === null ? OPAQUE_REPLAY_FRAGMENT_PATTERN.exec(url.hash) : null;
    const resolverMarker =
      activeResolverMarker === null && replayMarker === null
        ? OPAQUE_RESOLVER_FRAGMENT_PATTERN.exec(url.hash)
        : null;
    const probeMarker =
      activeResolverMarker === null && replayMarker === null && resolverMarker === null
        ? OPAQUE_PROBE_FRAGMENT_PATTERN.exec(url.hash)
        : null;
    const marker =
      activeResolverMarker ??
      replayMarker ??
      resolverMarker ??
      probeMarker ??
      CAPTURE_FRAGMENT_PATTERN.exec(url.hash);
    const nonce = marker?.[1];
    if (nonce === undefined) return undefined;

    const standard = /^\/c\/([^/]+)\/?$/.exec(url.pathname);
    const custom = /^\/g\/[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?\/c\/([^/]+)\/?$/i.exec(
      url.pathname
    );
    const conversationId = standard?.[1] ?? custom?.[1];
    return conversationId !== undefined && CONVERSATION_ID_PATTERN.test(conversationId)
      ? {
          conversationId,
          nonce,
          observeAssetResolvers: marker?.[2] === '1',
          mode:
            activeResolverMarker !== null
              ? 'active-resolver'
              : replayMarker !== null
                ? 'opaque-replay'
                : resolverMarker !== null
                  ? 'opaque-resolver'
                  : probeMarker !== null
                    ? 'opaque-probe'
                    : 'capture',
        }
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
  const legacyPathPrefixIndex = applyCaptured<number>(
    primordials,
    primordials.document.stringIndexOf,
    pathname,
    [RESOLVER_PATH_PREFIX]
  );
  const calpicoPathPrefixIndex = applyCaptured<number>(
    primordials,
    primordials.document.stringIndexOf,
    pathname,
    [CALPICO_RESOLVER_PATH_PREFIX]
  );
  const pathPrefix =
    legacyPathPrefixIndex === 0
      ? RESOLVER_PATH_PREFIX
      : calpicoPathPrefixIndex === 0
        ? CALPICO_RESOLVER_PATH_PREFIX
        : undefined;
  if (pathPrefix === undefined) return undefined;
  const providerFileId = applyCaptured<string>(
    primordials,
    primordials.document.stringSlice,
    pathname,
    [pathPrefix.length]
  );
  if (!isSafeResolverFileId(primordials, providerFileId)) return undefined;

  const query = applyCaptured<string>(primordials, primordials.document.urlSearch, url, []);
  if (applyCaptured<string>(primordials, primordials.document.urlHash, url, []) !== '') {
    return undefined;
  }
  if (pathPrefix === CALPICO_RESOLVER_PATH_PREFIX) {
    return query === '' ? providerFileId : undefined;
  }

  const conversation = `conversation_id=${conversationId}`;
  const inline = 'inline=true';
  const scopedConversation = `check_context_scopes_for_conversation_id=${conversationId}`;
  const expectedQueries = [
    `?${conversation}&${inline}`,
    `?${inline}&${conversation}`,
    `?${conversation}&${inline}&${scopedConversation}`,
    `?${conversation}&${scopedConversation}&${inline}`,
    `?${inline}&${conversation}&${scopedConversation}`,
    `?${inline}&${scopedConversation}&${conversation}`,
    `?${scopedConversation}&${conversation}&${inline}`,
    `?${scopedConversation}&${inline}&${conversation}`,
  ];
  for (let index = 0; index < expectedQueries.length; index += 1) {
    if (query === expectedQueries[index]) return providerFileId;
  }
  return undefined;
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

type ResolverObservationState = Pick<
  PageState,
  'primordials' | 'resolverDiscoveryActive' | 'resolverObservations'
>;

async function captureResolverResponse(
  pageWindow: PageWindow,
  state: ResolverObservationState,
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
  state: ResolverObservationState,
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

/*
 * The opaque probe deliberately has a separate state machine from ordinary
 * capture. It never reads a response body, never issues a request, and never
 * shares a result shape with the capture bridge.
 */
type OpaqueProbeOutcome =
  | 'target-not-observed'
  | 'source-not-native-request'
  | 'init-present'
  | 'init-security-sensitive'
  | 'init-unsupported'
  | 'target-mismatch'
  | 'clone-failed'
  | 'authorization-absent'
  | 'credentials-rejected'
  | 'source-rejected'
  | 'source-http-unauthorized'
  | 'source-http-forbidden'
  | 'source-http-rate-limited'
  | 'source-http-redirect'
  | 'source-http-error'
  | 'source-non-json'
  | 'eligible'
  | 'eligible-init-empty'
  | 'eligible-init-signal-only'
  | 'hook-state-failed'
  | 'probe-failed';

type OpaqueProbeInitKind =
  | 'absent'
  | 'empty'
  | 'signal-only'
  | 'security-sensitive'
  | 'unsupported';

type OpaqueProbeResult = {
  observedTargetRequest: boolean;
  sourceIsNativeRequest: boolean;
  initAbsent: boolean;
  exactTarget: boolean;
  authorizationPresent: boolean;
  credentialsAccepted: boolean;
  sourceStatus: number | null;
  sourceJson: boolean;
  singularDispatchCount: 0;
  outcome: OpaqueProbeOutcome;
};

type OpaqueProbeHookResult = { kind: 'ready' } | { kind: 'result'; result: OpaqueProbeResult };

type OpaqueProbePageState = {
  primordials: PagePrimordials;
  originalFetch: typeof window.fetch;
  wrappedFetch: typeof window.fetch | undefined;
  timeoutId: ReturnType<typeof window.setTimeout> | undefined;
  settled: boolean;
  claimed: boolean;
  result: OpaqueProbeHookResult;
};

type OpaqueProbeCandidate = Omit<
  OpaqueProbeResult,
  'sourceStatus' | 'sourceJson' | 'singularDispatchCount' | 'outcome'
> & {
  methodAccepted: boolean;
  cloneFailed: boolean;
  initKind: OpaqueProbeInitKind;
  sourceClone: Request | undefined;
};

function opaqueProbeResult(
  outcome: OpaqueProbeOutcome,
  overrides: Partial<Omit<OpaqueProbeResult, 'outcome' | 'singularDispatchCount'>> = {}
): OpaqueProbeResult {
  return {
    observedTargetRequest: false,
    sourceIsNativeRequest: false,
    initAbsent: false,
    exactTarget: false,
    authorizationPresent: false,
    credentialsAccepted: false,
    sourceStatus: null,
    sourceJson: false,
    singularDispatchCount: 0,
    ...overrides,
    outcome,
  };
}

function opaqueProbeStateKeyFor(nonce: string): string {
  return `__liskaChatGptOpaqueProbe_${nonce}`;
}

function snapshotOpaqueProbeResult(result: OpaqueProbeHookResult): OpaqueProbeHookResult {
  if (result.kind === 'ready') return { kind: 'ready' };
  const value = result.result;
  return {
    kind: 'result',
    result: {
      observedTargetRequest: value.observedTargetRequest,
      sourceIsNativeRequest: value.sourceIsNativeRequest,
      initAbsent: value.initAbsent,
      exactTarget: value.exactTarget,
      authorizationPresent: value.authorizationPresent,
      credentialsAccepted: value.credentialsAccepted,
      sourceStatus: value.sourceStatus,
      sourceJson: value.sourceJson,
      singularDispatchCount: 0,
      outcome: value.outcome,
    },
  };
}

function hasOpaqueProbeArmingPrimordials(primordials: PagePrimordials): boolean {
  const document = primordials.document;
  return (
    document.reflectApply !== undefined &&
    document.URL !== undefined &&
    document.objectDefineProperty !== undefined &&
    document.objectGetOwnPropertyDescriptor !== undefined &&
    document.objectGetPrototypeOf !== undefined &&
    document.objectPrototype !== undefined &&
    document.reflectOwnKeys !== undefined &&
    document.requestClone !== undefined &&
    document.requestUrl !== undefined &&
    document.requestMethod !== undefined &&
    document.requestHeaders !== undefined &&
    document.requestCredentials !== undefined &&
    document.headersHas !== undefined &&
    document.urlHref !== undefined &&
    document.urlOrigin !== undefined &&
    document.urlUsername !== undefined &&
    document.urlPassword !== undefined &&
    document.urlPathname !== undefined &&
    document.urlSearch !== undefined &&
    document.urlHash !== undefined &&
    document.responseStatus !== undefined &&
    document.responseHeaders !== undefined &&
    document.headersGet !== undefined &&
    document.stringToUpperCase !== undefined &&
    document.stringCharCodeAt !== undefined &&
    document.stringIndexOf !== undefined &&
    document.stringSlice !== undefined &&
    document.stringTrim !== undefined &&
    document.stringToLowerCase !== undefined &&
    document.stringEndsWith !== undefined &&
    document.promiseThen !== undefined &&
    primordials.setTimeout !== undefined &&
    primordials.clearTimeout !== undefined
  );
}

function opaqueProbeUrl(primordials: PagePrimordials, input: RequestInfo | URL): URL | undefined {
  try {
    let rawUrl: string;
    if (typeof input === 'string') {
      rawUrl = input;
    } else {
      try {
        rawUrl = applyCaptured<string>(primordials, primordials.document.urlHref, input, []);
      } catch {
        rawUrl = applyCaptured<string>(primordials, primordials.document.requestUrl, input, []);
      }
    }
    const URLConstructor = primordials.document.URL;
    return URLConstructor === undefined ? undefined : new URLConstructor(rawUrl, CHATGPT_ORIGIN);
  } catch {
    return undefined;
  }
}

function hasExactOpaqueProbeQuery(primordials: PagePrimordials, url: URL): boolean {
  const search = applyCaptured<string>(primordials, primordials.document.urlSearch, url, []);
  // Compare the raw query verbatim rather than decoding keys or values. The
  // two allowed orderings are the whole grammar, so duplicates, extras, and
  // percent-encoded lookalikes cannot slip through.
  return (
    search === '?include_has_versions=true&num_turns=10' ||
    search === '?num_turns=10&include_has_versions=true'
  );
}

/**
 * Classify RequestInit without reading any property value.  Only an ordinary
 * empty object (or explicit null/undefined) and an ordinary signal-only object
 * are structurally safe enough for a later replay experiment that drops init.
 * Any credential-, header-, body-, or method-bearing init fails closed.
 */
function opaqueProbeInitKind(
  primordials: PagePrimordials,
  args: Parameters<typeof window.fetch>
): OpaqueProbeInitKind {
  if (args.length === 1) return 'absent';
  if (args.length !== 2) return 'unsupported';
  const init: unknown = args[1];
  if (init === undefined || init === null) return 'empty';
  if (typeof init !== 'object') return 'unsupported';
  try {
    const prototype = applyCaptured<unknown>(
      primordials,
      primordials.document.objectGetPrototypeOf,
      undefined,
      [init]
    );
    if (prototype !== null && prototype !== primordials.document.objectPrototype) {
      return 'unsupported';
    }
    if (prototype === primordials.document.objectPrototype) {
      const getOwnPropertyDescriptor = primordials.document.objectGetOwnPropertyDescriptor;
      const objectPrototype = primordials.document.objectPrototype;
      for (let index = 0; index < REQUEST_INIT_MEMBER_NAMES.length; index += 1) {
        const descriptor = applyCaptured<PropertyDescriptor | undefined>(
          primordials,
          getOwnPropertyDescriptor,
          undefined,
          [objectPrototype, REQUEST_INIT_MEMBER_NAMES[index]]
        );
        if (descriptor !== undefined) return 'unsupported';
      }
    }
    const keys = applyCaptured<Array<string | symbol>>(
      primordials,
      primordials.document.reflectOwnKeys,
      undefined,
      [init]
    );
    if (keys.length === 0) return 'empty';
    if (keys.length === 1 && keys[0] === 'signal') return 'signal-only';
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (key === 'headers' || key === 'body' || key === 'method' || key === 'credentials') {
        return 'security-sensitive';
      }
    }
    return 'unsupported';
  } catch {
    return 'unsupported';
  }
}

function opaqueProbeCandidate(
  primordials: PagePrimordials,
  args: Parameters<typeof window.fetch>,
  conversationId: string
): OpaqueProbeCandidate | undefined {
  const input = args[0];
  const url = opaqueProbeUrl(primordials, input);
  if (url === undefined) return undefined;
  const path = applyCaptured<string>(primordials, primordials.document.urlPathname, url, []);
  if (path !== `/backend-api/conversations/${conversationId}`) return undefined;

  const exactTarget =
    applyCaptured<string>(primordials, primordials.document.urlOrigin, url, []) ===
      CHATGPT_ORIGIN &&
    applyCaptured<string>(primordials, primordials.document.urlUsername, url, []) === '' &&
    applyCaptured<string>(primordials, primordials.document.urlPassword, url, []) === '' &&
    applyCaptured<string>(primordials, primordials.document.urlHash, url, []) === '' &&
    hasExactOpaqueProbeQuery(primordials, url);
  const initKind = opaqueProbeInitKind(primordials, args);
  const structurallySafeInit =
    initKind === 'absent' || initKind === 'empty' || initKind === 'signal-only';
  let sourceIsNativeRequest = false;
  let methodAccepted = false;
  let sourceClone: Request | undefined;
  let cloneFailed = false;
  if (typeof input === 'object' && input !== null && exactTarget && structurallySafeInit) {
    try {
      const method = applyCaptured<unknown>(
        primordials,
        primordials.document.requestMethod,
        input,
        []
      );
      sourceIsNativeRequest = true;
      methodAccepted =
        typeof method === 'string' &&
        applyCaptured<string>(primordials, primordials.document.stringToUpperCase, method, []) ===
          'GET';
      if (methodAccepted) {
        try {
          sourceClone = applyCaptured<Request>(
            primordials,
            primordials.document.requestClone,
            input,
            []
          );
        } catch {
          cloneFailed = true;
        }
      }
    } catch {
      sourceIsNativeRequest = false;
      methodAccepted = false;
    }
  }
  return {
    observedTargetRequest: true,
    sourceIsNativeRequest,
    initAbsent: initKind === 'absent',
    exactTarget,
    authorizationPresent: false,
    credentialsAccepted: false,
    methodAccepted,
    cloneFailed,
    initKind,
    sourceClone,
  };
}

function finishOpaqueProbe(
  pageWindow: PageWindow,
  state: OpaqueProbePageState,
  result: OpaqueProbeResult
): void {
  if (state.settled) return;
  state.settled = true;
  state.result = { kind: 'result', result };
  if (state.timeoutId !== undefined) {
    try {
      applyCaptured<void>(state.primordials, state.primordials.clearTimeout, pageWindow, [
        state.timeoutId,
      ]);
    } catch {
      // A terminal bounded result is retained even if timer cleanup is poisoned.
    }
    state.timeoutId = undefined;
  }
  try {
    if (state.wrappedFetch !== undefined && pageWindow.fetch === state.wrappedFetch) {
      pageWindow.fetch = state.originalFetch;
    }
  } catch {
    // Never overwrite a later page-owned wrapper.
  }
}

function preliminaryOpaqueProbeResult(
  primordials: PagePrimordials,
  candidate: OpaqueProbeCandidate
): OpaqueProbeResult | undefined {
  const base = {
    observedTargetRequest: candidate.observedTargetRequest,
    sourceIsNativeRequest: candidate.sourceIsNativeRequest,
    initAbsent: candidate.initAbsent,
    exactTarget: candidate.exactTarget,
  };
  if (candidate.initKind === 'security-sensitive') {
    return opaqueProbeResult('init-security-sensitive', base);
  }
  if (candidate.initKind === 'unsupported') return opaqueProbeResult('init-unsupported', base);
  if (!candidate.exactTarget) return opaqueProbeResult('target-mismatch', base);
  if (!candidate.sourceIsNativeRequest) {
    return opaqueProbeResult('source-not-native-request', base);
  }
  if (!candidate.methodAccepted) return opaqueProbeResult('target-mismatch', base);
  if (candidate.cloneFailed || candidate.sourceClone === undefined) {
    return opaqueProbeResult('clone-failed', base);
  }
  try {
    const clone = candidate.sourceClone;
    const credentials = applyCaptured<unknown>(
      primordials,
      primordials.document.requestCredentials,
      clone,
      []
    );
    const credentialsAccepted = credentials === 'include' || credentials === 'same-origin';
    const headers = applyCaptured<Headers>(
      primordials,
      primordials.document.requestHeaders,
      clone,
      []
    );
    const authorizationPresent = applyCaptured<boolean>(
      primordials,
      primordials.document.headersHas,
      headers,
      ['authorization']
    );
    const verified = { ...base, credentialsAccepted, authorizationPresent };
    if (!credentialsAccepted) return opaqueProbeResult('credentials-rejected', verified);
    if (!authorizationPresent) return opaqueProbeResult('authorization-absent', verified);
    return undefined;
  } catch {
    return opaqueProbeResult('clone-failed', base);
  }
}

function observeOpaqueProbeResponse(
  pageWindow: PageWindow,
  state: OpaqueProbePageState,
  responsePromise: Promise<Response>,
  candidate: OpaqueProbeCandidate
): void {
  const base = {
    observedTargetRequest: candidate.observedTargetRequest,
    sourceIsNativeRequest: candidate.sourceIsNativeRequest,
    initAbsent: candidate.initAbsent,
    exactTarget: candidate.exactTarget,
    authorizationPresent: true,
    credentialsAccepted: true,
  };
  try {
    const observation = applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      responsePromise,
      [
        (response: Response) => {
          try {
            const status = applyCaptured<number>(
              state.primordials,
              state.primordials.document.responseStatus,
              response,
              []
            );
            const headers = applyCaptured<Headers>(
              state.primordials,
              state.primordials.document.responseHeaders,
              response,
              []
            );
            const contentType = applyCaptured<string | null>(
              state.primordials,
              state.primordials.document.headersGet,
              headers,
              ['content-type']
            );
            const sourceJson =
              typeof contentType === 'string' && isJsonMediaType(state.primordials, contentType);
            const shared = { ...base, sourceStatus: status, sourceJson };
            if (status === 401)
              finishOpaqueProbe(
                pageWindow,
                state,
                opaqueProbeResult('source-http-unauthorized', shared)
              );
            else if (status === 403)
              finishOpaqueProbe(
                pageWindow,
                state,
                opaqueProbeResult('source-http-forbidden', shared)
              );
            else if (status === 429)
              finishOpaqueProbe(
                pageWindow,
                state,
                opaqueProbeResult('source-http-rate-limited', shared)
              );
            else if (status >= 300 && status < 400)
              finishOpaqueProbe(
                pageWindow,
                state,
                opaqueProbeResult('source-http-redirect', shared)
              );
            else if (status !== 200)
              finishOpaqueProbe(pageWindow, state, opaqueProbeResult('source-http-error', shared));
            else if (!sourceJson)
              finishOpaqueProbe(pageWindow, state, opaqueProbeResult('source-non-json', shared));
            else {
              const eligibleOutcome: OpaqueProbeOutcome =
                candidate.initKind === 'empty'
                  ? 'eligible-init-empty'
                  : candidate.initKind === 'signal-only'
                    ? 'eligible-init-signal-only'
                    : 'eligible';
              finishOpaqueProbe(pageWindow, state, opaqueProbeResult(eligibleOutcome, shared));
            }
          } catch {
            finishOpaqueProbe(pageWindow, state, opaqueProbeResult('probe-failed', base));
          }
        },
        () => finishOpaqueProbe(pageWindow, state, opaqueProbeResult('source-rejected', base)),
      ]
    );
    void applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      observation,
      [
        () => undefined,
        () => finishOpaqueProbe(pageWindow, state, opaqueProbeResult('probe-failed', base)),
      ]
    );
  } catch {
    finishOpaqueProbe(pageWindow, state, opaqueProbeResult('probe-failed', base));
  }
}

function armOpaqueProbe(
  pageWindow: PageWindow,
  primordials: PagePrimordials,
  target: MarkerTarget,
  windowRecord: Record<string, unknown>
): ChatGptDocumentStartResult {
  const originalFetch = pageWindow.fetch;
  if (typeof originalFetch !== 'function') return { kind: 'error', code: 'hook-state-failed' };
  const state: OpaqueProbePageState = {
    primordials,
    originalFetch,
    wrappedFetch: undefined,
    timeoutId: undefined,
    settled: false,
    claimed: false,
    result: { kind: 'ready' },
  };
  const stateKey = opaqueProbeStateKeyFor(target.nonce);
  try {
    const getOwnPropertyDescriptor = primordials.document.objectGetOwnPropertyDescriptor;
    const defineProperty = primordials.document.objectDefineProperty;
    if (
      getOwnPropertyDescriptor === undefined ||
      defineProperty === undefined ||
      getOwnPropertyDescriptor(windowRecord, stateKey) !== undefined
    ) {
      return { kind: 'error', code: 'hook-state-failed' };
    }
    defineProperty(windowRecord, stateKey, {
      configurable: false,
      enumerable: false,
      get: () => snapshotOpaqueProbeResult(state.result),
    });
    const wrappedFetch = function (
      this: PageWindow,
      ...args: Parameters<typeof pageWindow.fetch>
    ): ReturnType<typeof pageWindow.fetch> {
      let candidate: OpaqueProbeCandidate | undefined;
      let preliminary: OpaqueProbeResult | undefined;
      try {
        candidate =
          !state.settled && !state.claimed
            ? opaqueProbeCandidate(state.primordials, args, target.conversationId)
            : undefined;
        if (candidate !== undefined) state.claimed = true;
        preliminary =
          candidate === undefined
            ? undefined
            : preliminaryOpaqueProbeResult(state.primordials, candidate);
        if (preliminary !== undefined) finishOpaqueProbe(pageWindow, state, preliminary);
      } catch {
        if (!state.settled) state.claimed = false;
        candidate = undefined;
        preliminary = undefined;
      }
      let responsePromise: ReturnType<typeof pageWindow.fetch>;
      try {
        responsePromise = applyCaptured<ReturnType<typeof pageWindow.fetch>>(
          state.primordials,
          state.originalFetch,
          this,
          args
        );
      } catch (error) {
        if (candidate !== undefined && !state.settled) {
          finishOpaqueProbe(
            pageWindow,
            state,
            opaqueProbeResult('source-rejected', {
              observedTargetRequest: candidate.observedTargetRequest,
              sourceIsNativeRequest: candidate.sourceIsNativeRequest,
              initAbsent: candidate.initAbsent,
              exactTarget: candidate.exactTarget,
              authorizationPresent: true,
              credentialsAccepted: true,
            })
          );
        }
        throw error;
      }
      if (candidate !== undefined && preliminary === undefined) {
        observeOpaqueProbeResponse(pageWindow, state, responsePromise, candidate);
      }
      return responsePromise;
    } as typeof pageWindow.fetch;
    state.wrappedFetch = wrappedFetch;
    pageWindow.fetch = wrappedFetch;
    state.timeoutId = applyCaptured<ReturnType<typeof pageWindow.setTimeout>>(
      primordials,
      primordials.setTimeout,
      pageWindow,
      [
        () => finishOpaqueProbe(pageWindow, state, opaqueProbeResult('target-not-observed')),
        DEFAULT_OPAQUE_PROBE_TIMEOUT_MS,
      ]
    );
    return { kind: 'ready' };
  } catch {
    finishOpaqueProbe(pageWindow, state, opaqueProbeResult('hook-state-failed'));
    return { kind: 'error', code: 'hook-state-failed' };
  }
}

/*
 * The post-persistence resolver observer is deliberately separate from both
 * ordinary capture and A-strict replay.  After at least one destination has
 * durably re-verified initial replay raw bytes, a fresh marker-gated tab may
 * observe exact page-owned plural metadata and bounded resolver responses.
 * It performs zero singular dispatches and never reads the plural source
 * body.  Safe records are usable only if their domain-separated key uniquely
 * matches a provider identifier at an exact pointer in committed raw: this is
 * committed-raw identifier correlation, not raw recapture equality.
 */
type OpaqueResolverErrorCode =
  | 'hook-state-failed'
  | 'target-not-observed'
  | 'source-not-eligible'
  | 'source-rejected'
  | 'source-http-error'
  | 'source-non-json';

type OpaqueResolverHookResult =
  | { kind: 'ready' }
  | {
      kind: 'observed';
      conversationId: string;
      resolverObservations: ResolverObservation[];
      singularDispatchCount: 0;
    }
  | { kind: 'error'; code: OpaqueResolverErrorCode; singularDispatchCount: 0 };

type OpaqueResolverPageState = {
  primordials: PagePrimordials;
  originalFetch: typeof window.fetch;
  wrappedFetch: typeof window.fetch | undefined;
  timeoutId: ReturnType<typeof window.setTimeout> | undefined;
  resolverDiscoveryTimeoutId: ReturnType<typeof window.setTimeout> | undefined;
  settled: boolean;
  claimed: boolean;
  resolverDiscoveryActive: boolean;
  resolverDiscoveryExpired: boolean;
  sourceValidated: boolean;
  resolverClaims: number;
  resolverObservations: ResolverObservation[];
  result: OpaqueResolverHookResult;
};

function opaqueResolverStateKeyFor(nonce: string): string {
  return `__liskaChatGptOpaqueResolver_${nonce}`;
}

function snapshotOpaqueResolverResult(result: OpaqueResolverHookResult): OpaqueResolverHookResult {
  if (result.kind === 'ready') return { kind: 'ready' };
  if (result.kind === 'error') {
    return { kind: 'error', code: result.code, singularDispatchCount: 0 };
  }
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
    kind: 'observed',
    conversationId: result.conversationId,
    resolverObservations,
    singularDispatchCount: 0,
  };
}

function hasOpaqueResolverArmingPrimordials(primordials: PagePrimordials): boolean {
  const document = primordials.document;
  return (
    hasOpaqueProbeArmingPrimordials(primordials) &&
    document.responseClone !== undefined &&
    document.responseBody !== undefined &&
    document.streamGetReader !== undefined &&
    document.readerRead !== undefined &&
    document.readerCancel !== undefined &&
    document.uint8Array !== undefined &&
    document.uint8ArraySet !== undefined &&
    document.uint8ArraySubarray !== undefined &&
    document.arrayBufferSlice !== undefined &&
    document.stringFromCharCode !== undefined &&
    primordials.btoa !== undefined &&
    primordials.subtleDigest !== undefined
  );
}

function finishOpaqueResolver(
  pageWindow: PageWindow,
  state: OpaqueResolverPageState,
  result: OpaqueResolverHookResult
): void {
  if (state.settled) return;
  state.settled = true;
  if (result.kind === 'error') state.resolverObservations = [];
  state.result = result;
  const timeoutId = state.timeoutId;
  if (timeoutId !== undefined) {
    try {
      applyCaptured<void>(state.primordials, state.primordials.clearTimeout, pageWindow, [
        timeoutId,
      ]);
    } catch {
      // A terminal result remains available when page timer cleanup is poisoned.
    }
    state.timeoutId = undefined;
  }
  const resolverDiscoveryTimeoutId = state.resolverDiscoveryTimeoutId;
  if (resolverDiscoveryTimeoutId !== undefined) {
    try {
      applyCaptured<void>(state.primordials, state.primordials.clearTimeout, pageWindow, [
        resolverDiscoveryTimeoutId,
      ]);
    } catch {
      // The bounded observer is terminal even when its timer cannot be cleared.
    }
    state.resolverDiscoveryTimeoutId = undefined;
  }
  state.resolverDiscoveryActive = false;
  try {
    if (state.wrappedFetch !== undefined && pageWindow.fetch === state.wrappedFetch) {
      pageWindow.fetch = state.originalFetch;
    }
  } catch {
    // Never overwrite a later page-owned wrapper during cleanup.
  }
}

function finishOpaqueResolverObserved(
  pageWindow: PageWindow,
  state: OpaqueResolverPageState,
  conversationId: string
): void {
  finishOpaqueResolver(pageWindow, state, {
    kind: 'observed',
    conversationId,
    resolverObservations: state.resolverObservations,
    singularDispatchCount: 0,
  });
}

/**
 * Reuse the probe's safe source classification.  It reads only Request URL,
 * method, credentials and boolean authorization membership; no header value,
 * request body, cookie, storage, DOM, or source response body is observed.
 */
function opaqueResolverSourceEligible(
  primordials: PagePrimordials,
  candidate: OpaqueProbeCandidate
): boolean {
  const preparation = prepareOpaqueReplay(primordials, candidate);
  return typeof preparation !== 'string';
}

function armOpaqueResolverWindow(
  pageWindow: PageWindow,
  state: OpaqueResolverPageState,
  conversationId: string
): void {
  if (state.settled || state.resolverDiscoveryActive || state.resolverDiscoveryExpired) return;
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
          if (state.sourceValidated) {
            finishOpaqueResolverObserved(pageWindow, state, conversationId);
          }
        },
        DEFAULT_OPAQUE_RESOLVER_DISCOVERY_WINDOW_MS,
      ]
    );
  } catch {
    state.resolverDiscoveryActive = false;
    state.resolverDiscoveryExpired = true;
    finishOpaqueResolver(pageWindow, state, {
      kind: 'error',
      code: 'hook-state-failed',
      singularDispatchCount: 0,
    });
  }
}

function observeOpaqueResolverSourceResponse(
  pageWindow: PageWindow,
  state: OpaqueResolverPageState,
  responsePromise: Promise<Response>,
  conversationId: string
): void {
  try {
    const observation = applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      responsePromise,
      [
        (response: Response) => {
          try {
            const status = applyCaptured<number>(
              state.primordials,
              state.primordials.document.responseStatus,
              response,
              []
            );
            const headers = applyCaptured<Headers>(
              state.primordials,
              state.primordials.document.responseHeaders,
              response,
              []
            );
            const contentType = applyCaptured<string | null>(
              state.primordials,
              state.primordials.document.headersGet,
              headers,
              ['content-type']
            );
            if (status !== 200) {
              finishOpaqueResolver(pageWindow, state, {
                kind: 'error',
                code: 'source-http-error',
                singularDispatchCount: 0,
              });
            } else if (
              typeof contentType !== 'string' ||
              !isJsonMediaType(state.primordials, contentType)
            ) {
              finishOpaqueResolver(pageWindow, state, {
                kind: 'error',
                code: 'source-non-json',
                singularDispatchCount: 0,
              });
            } else {
              // Deliberately no clone/arrayBuffer/text/json source operation.
              state.sourceValidated = true;
              if (state.resolverDiscoveryExpired) {
                finishOpaqueResolverObserved(pageWindow, state, conversationId);
              }
            }
          } catch {
            finishOpaqueResolver(pageWindow, state, {
              kind: 'error',
              code: 'source-http-error',
              singularDispatchCount: 0,
            });
          }
        },
        () =>
          finishOpaqueResolver(pageWindow, state, {
            kind: 'error',
            code: 'source-rejected',
            singularDispatchCount: 0,
          }),
      ]
    );
    void applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      observation,
      [() => undefined, () => undefined]
    );
  } catch {
    finishOpaqueResolver(pageWindow, state, {
      kind: 'error',
      code: 'source-http-error',
      singularDispatchCount: 0,
    });
  }
}

function armOpaqueResolver(
  pageWindow: PageWindow,
  primordials: PagePrimordials,
  target: MarkerTarget,
  windowRecord: Record<string, unknown>
): ChatGptDocumentStartResult {
  const originalFetch = pageWindow.fetch;
  if (typeof originalFetch !== 'function') return { kind: 'error', code: 'hook-state-failed' };
  const state: OpaqueResolverPageState = {
    primordials,
    originalFetch,
    wrappedFetch: undefined,
    timeoutId: undefined,
    resolverDiscoveryTimeoutId: undefined,
    settled: false,
    claimed: false,
    resolverDiscoveryActive: false,
    resolverDiscoveryExpired: false,
    sourceValidated: false,
    resolverClaims: 0,
    resolverObservations: [],
    result: { kind: 'ready' },
  };
  const stateKey = opaqueResolverStateKeyFor(target.nonce);
  try {
    const getOwnPropertyDescriptor = primordials.document.objectGetOwnPropertyDescriptor;
    const defineProperty = primordials.document.objectDefineProperty;
    if (
      getOwnPropertyDescriptor === undefined ||
      defineProperty === undefined ||
      getOwnPropertyDescriptor(windowRecord, stateKey) !== undefined
    ) {
      return { kind: 'error', code: 'hook-state-failed' };
    }
    defineProperty(windowRecord, stateKey, {
      configurable: false,
      enumerable: false,
      get: () => snapshotOpaqueResolverResult(state.result),
    });
    const wrappedFetch = function (
      this: PageWindow,
      ...args: Parameters<typeof pageWindow.fetch>
    ): ReturnType<typeof pageWindow.fetch> {
      let sourceCandidate: OpaqueProbeCandidate | undefined;
      let sourceEligible = false;
      try {
        sourceCandidate =
          !state.settled && !state.claimed
            ? opaqueProbeCandidate(state.primordials, args, target.conversationId)
            : undefined;
        if (sourceCandidate !== undefined) {
          state.claimed = true;
          if (!opaqueResolverSourceEligible(state.primordials, sourceCandidate)) {
            finishOpaqueResolver(pageWindow, state, {
              kind: 'error',
              code: 'source-not-eligible',
              singularDispatchCount: 0,
            });
          } else {
            sourceEligible = true;
          }
        }
      } catch {
        if (!state.settled) state.claimed = false;
        sourceCandidate = undefined;
      }
      const resolverFileId =
        !state.settled &&
        state.resolverDiscoveryActive &&
        state.resolverClaims < DEFAULT_RESOLVER_MAX_OBSERVATIONS
          ? resolverTargetFileId(state.primordials, args[0], args[1], target.conversationId)
          : undefined;
      if (resolverFileId !== undefined) state.resolverClaims += 1;
      if (sourceEligible) {
        // Resolver dispatch can begin from cached UI state before the matching
        // source Response settles. The hard, non-extendable window therefore
        // begins immediately before this exact source request is handed to the
        // page's original fetch.
        armOpaqueResolverWindow(pageWindow, state, target.conversationId);
      }
      let responsePromise: ReturnType<typeof pageWindow.fetch>;
      try {
        responsePromise = applyCaptured<ReturnType<typeof pageWindow.fetch>>(
          state.primordials,
          state.originalFetch,
          this,
          args
        );
      } catch (error) {
        if (sourceCandidate !== undefined && !state.settled) {
          finishOpaqueResolver(pageWindow, state, {
            kind: 'error',
            code: 'source-rejected',
            singularDispatchCount: 0,
          });
        }
        throw error;
      }
      if (sourceCandidate !== undefined && !state.settled) {
        observeOpaqueResolverSourceResponse(
          pageWindow,
          state,
          responsePromise,
          target.conversationId
        );
      }
      if (resolverFileId !== undefined) {
        observeResolverResponse(pageWindow, state, responsePromise, resolverFileId);
      }
      return responsePromise;
    } as typeof pageWindow.fetch;
    state.wrappedFetch = wrappedFetch;
    pageWindow.fetch = wrappedFetch;
    state.timeoutId = applyCaptured<ReturnType<typeof pageWindow.setTimeout>>(
      primordials,
      primordials.setTimeout,
      pageWindow,
      [
        () =>
          finishOpaqueResolver(pageWindow, state, {
            kind: 'error',
            code: 'target-not-observed',
            singularDispatchCount: 0,
          }),
        DEFAULT_OPAQUE_PROBE_TIMEOUT_MS,
      ]
    );
    return { kind: 'ready' };
  } catch {
    finishOpaqueResolver(pageWindow, state, {
      kind: 'error',
      code: 'hook-state-failed',
      singularDispatchCount: 0,
    });
    return { kind: 'error', code: 'hook-state-failed' };
  }
}

/*
 * The opaque replay is intentionally separate from the metadata probe and
 * ordinary capture.  A source Request clone remains closure-private; only a
 * freshly constructed singular Request is dispatched, exactly once, after the
 * page-owned plural response is known to be a 200 JSON response.
 */
type OpaqueReplayErrorCode =
  | 'hook-state-failed'
  | 'permission-unavailable'
  | 'target-not-observed'
  | 'source-not-native-request'
  | 'init-security-sensitive'
  | 'init-unsupported'
  | 'target-mismatch'
  | 'clone-failed'
  | 'authorization-absent'
  | 'credentials-rejected'
  | 'source-rejected'
  | 'source-http-error'
  | 'source-non-json'
  | 'replay-construction-failed'
  | 'replay-dispatch-failed'
  | 'replay-rejected'
  | 'replay-http-error'
  | 'replay-non-json'
  | 'response-processing-failed'
  | 'payload-too-large'
  | 'timed-out';

type OpaqueReplayCapture = {
  bodyBase64: string;
  byteLength: number;
  sha256: string;
  mediaType: string;
};

type OpaqueReplayHookResult =
  | { kind: 'ready' }
  | {
      kind: 'captured';
      conversationId: string;
      capture: OpaqueReplayCapture;
      singularDispatchCount: 1;
    }
  | { kind: 'error'; code: OpaqueReplayErrorCode; singularDispatchCount: 0 | 1 };

type OpaqueReplayPageState = {
  primordials: PagePrimordials;
  originalFetch: typeof window.fetch;
  wrappedFetch: typeof window.fetch | undefined;
  timeoutId: ReturnType<typeof window.setTimeout> | undefined;
  abortController: AbortController | undefined;
  settled: boolean;
  claimed: boolean;
  singularDispatchCount: 0 | 1;
  result: OpaqueReplayHookResult;
};

type OpaqueReplayPreparation = {
  headers: Headers;
  credentials: RequestCredentials;
};

function opaqueReplayStateKeyFor(nonce: string): string {
  return `__liskaChatGptOpaqueReplay_${nonce}`;
}

function snapshotOpaqueReplayResult(result: OpaqueReplayHookResult): OpaqueReplayHookResult {
  if (result.kind === 'ready') return { kind: 'ready' };
  if (result.kind === 'error') {
    return {
      kind: 'error',
      code: result.code,
      singularDispatchCount: result.singularDispatchCount,
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
    singularDispatchCount: 1,
  };
}

function hasOpaqueReplayArmingPrimordials(primordials: PagePrimordials): boolean {
  const document = primordials.document;
  return (
    hasOpaqueProbeArmingPrimordials(primordials) &&
    document.requestConstructor !== undefined &&
    document.abortControllerConstructor !== undefined &&
    document.abortControllerAbort !== undefined &&
    document.abortControllerSignal !== undefined &&
    document.responseClone !== undefined &&
    document.responseBody !== undefined &&
    document.streamGetReader !== undefined &&
    document.readerRead !== undefined &&
    document.readerCancel !== undefined &&
    document.uint8Array !== undefined &&
    document.uint8ArraySet !== undefined &&
    document.uint8ArraySubarray !== undefined &&
    document.arrayBufferSlice !== undefined &&
    document.stringFromCharCode !== undefined &&
    primordials.btoa !== undefined &&
    primordials.subtleDigest !== undefined
  );
}

function opaqueReplayError(
  state: OpaqueReplayPageState,
  code: OpaqueReplayErrorCode
): OpaqueReplayHookResult {
  return { kind: 'error', code, singularDispatchCount: state.singularDispatchCount };
}

function abortOpaqueReplay(state: OpaqueReplayPageState): void {
  if (state.abortController === undefined) return;
  try {
    applyCaptured<void>(
      state.primordials,
      state.primordials.document.abortControllerAbort,
      state.abortController,
      []
    );
  } catch {
    // The deadline/result is terminal even if the page cannot observe abort.
  }
  state.abortController = undefined;
}

function finishOpaqueReplay(
  pageWindow: PageWindow,
  state: OpaqueReplayPageState,
  result: OpaqueReplayHookResult
): void {
  if (state.settled) return;
  state.settled = true;
  state.result = result;
  if (state.timeoutId !== undefined) {
    try {
      applyCaptured<void>(state.primordials, state.primordials.clearTimeout, pageWindow, [
        state.timeoutId,
      ]);
    } catch {
      // The terminal result remains available when timer cleanup is poisoned.
    }
    state.timeoutId = undefined;
  }
  abortOpaqueReplay(state);
  try {
    if (state.wrappedFetch !== undefined && pageWindow.fetch === state.wrappedFetch) {
      pageWindow.fetch = state.originalFetch;
    }
  } catch {
    // Do not replace a page wrapper installed after this observer.
  }
}

function prepareOpaqueReplay(
  primordials: PagePrimordials,
  candidate: OpaqueProbeCandidate
): OpaqueReplayPreparation | OpaqueReplayErrorCode {
  if (candidate.initKind === 'security-sensitive') return 'init-security-sensitive';
  if (candidate.initKind === 'unsupported') return 'init-unsupported';
  if (!candidate.exactTarget || !candidate.methodAccepted) return 'target-mismatch';
  if (!candidate.sourceIsNativeRequest) return 'source-not-native-request';
  if (candidate.cloneFailed || candidate.sourceClone === undefined) return 'clone-failed';
  try {
    const credentials = applyCaptured<unknown>(
      primordials,
      primordials.document.requestCredentials,
      candidate.sourceClone,
      []
    );
    if (credentials !== 'include' && credentials !== 'same-origin') return 'credentials-rejected';
    const headers = applyCaptured<Headers>(
      primordials,
      primordials.document.requestHeaders,
      candidate.sourceClone,
      []
    );
    // This boolean-only membership check is the sole header operation.  No
    // header values are read, iterated, serialized, logged, or stored.
    if (
      !applyCaptured<boolean>(primordials, primordials.document.headersHas, headers, [
        'authorization',
      ])
    ) {
      return 'authorization-absent';
    }
    return { headers, credentials };
  } catch {
    return 'clone-failed';
  }
}

/**
 * The direct replay response is never returned to page code.  Cancel its
 * unconsumed tee branch after cloning so it cannot apply backpressure to the
 * bounded clone reader (and it still never exposes or reads response bytes).
 */
function discardOpaqueReplayOriginalBody(primordials: PagePrimordials, response: Response): void {
  try {
    const body = applyCaptured<ReadableStream<Uint8Array> | null>(
      primordials,
      primordials.document.responseBody,
      response,
      []
    );
    if (body === null) return;
    const reader = applyCaptured<ReadableStreamDefaultReader<Uint8Array>>(
      primordials,
      primordials.document.streamGetReader,
      body,
      []
    );
    const cancellation = applyCaptured<Promise<void>>(
      primordials,
      primordials.document.readerCancel,
      reader,
      []
    );
    void applyCaptured<Promise<unknown>>(
      primordials,
      primordials.document.promiseThen,
      cancellation,
      [() => undefined, () => undefined]
    );
  } catch {
    // Backpressure avoidance is best-effort; the core deadline remains hard.
  }
}

async function captureOpaqueReplayResponse(
  pageWindow: PageWindow,
  state: OpaqueReplayPageState,
  response: Response,
  conversationId: string
): Promise<void> {
  try {
    const status = applyCaptured<number>(
      state.primordials,
      state.primordials.document.responseStatus,
      response,
      []
    );
    if (status !== 200) {
      finishOpaqueReplay(pageWindow, state, opaqueReplayError(state, 'replay-http-error'));
      return;
    }
    const headers = applyCaptured<Headers>(
      state.primordials,
      state.primordials.document.responseHeaders,
      response,
      []
    );
    const rawMediaType = applyCaptured<string | null>(
      state.primordials,
      state.primordials.document.headersGet,
      headers,
      ['content-type']
    );
    const mediaType =
      typeof rawMediaType === 'string'
        ? applyCaptured<string>(
            state.primordials,
            state.primordials.document.stringTrim,
            rawMediaType,
            []
          )
        : '';
    if (!isJsonMediaType(state.primordials, mediaType)) {
      finishOpaqueReplay(pageWindow, state, opaqueReplayError(state, 'replay-non-json'));
      return;
    }
    const clone = applyCaptured<Response>(
      state.primordials,
      state.primordials.document.responseClone,
      response,
      []
    );
    discardOpaqueReplayOriginalBody(state.primordials, response);
    const bytes = await readBoundedClone(state.primordials, clone, DEFAULT_MAX_BYTES);
    const sha256 = await sha256FromBytes(state.primordials, bytes);
    if (state.settled) return;
    finishOpaqueReplay(pageWindow, state, {
      kind: 'captured',
      conversationId,
      capture: {
        bodyBase64: base64FromBytes(state.primordials, bytes),
        byteLength: bytes.byteLength,
        sha256,
        mediaType,
      },
      singularDispatchCount: 1,
    });
  } catch (error) {
    finishOpaqueReplay(
      pageWindow,
      state,
      opaqueReplayError(
        state,
        error === PAYLOAD_TOO_LARGE ? 'payload-too-large' : 'response-processing-failed'
      )
    );
  }
}

function observeOpaqueReplayResponse(
  pageWindow: PageWindow,
  state: OpaqueReplayPageState,
  responsePromise: Promise<Response>,
  conversationId: string
): void {
  try {
    const observation = applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      responsePromise,
      [
        (response: Response) =>
          captureOpaqueReplayResponse(pageWindow, state, response, conversationId),
        () => finishOpaqueReplay(pageWindow, state, opaqueReplayError(state, 'replay-rejected')),
      ]
    );
    void applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      observation,
      [
        () => undefined,
        () =>
          finishOpaqueReplay(
            pageWindow,
            state,
            opaqueReplayError(state, 'response-processing-failed')
          ),
      ]
    );
  } catch {
    finishOpaqueReplay(pageWindow, state, opaqueReplayError(state, 'response-processing-failed'));
  }
}

function dispatchOpaqueReplay(
  pageWindow: PageWindow,
  state: OpaqueReplayPageState,
  target: MarkerTarget,
  preparation: OpaqueReplayPreparation
): void {
  if (state.settled || state.singularDispatchCount !== 0) return;
  try {
    const AbortControllerConstructor = state.primordials.document.abortControllerConstructor;
    const RequestConstructor = state.primordials.document.requestConstructor;
    if (AbortControllerConstructor === undefined || RequestConstructor === undefined) {
      throw PRIMORDIAL_UNAVAILABLE;
    }
    const controller = new AbortControllerConstructor();
    const signal = applyCaptured<AbortSignal>(
      state.primordials,
      state.primordials.document.abortControllerSignal,
      controller,
      []
    );
    // Headers is deliberately passed as the exact opaque source Headers object.
    // Native Request copies it internally; no original RequestInit is replayed.
    const replayRequest = new RequestConstructor(
      `${CHATGPT_ORIGIN}/backend-api/conversation/${target.conversationId}`,
      {
        method: 'GET',
        headers: preparation.headers,
        credentials: preparation.credentials,
        redirect: 'error',
        cache: 'no-store',
        signal,
      }
    );
    state.abortController = controller;
    // This transition happens immediately before the sole direct dispatch.
    state.singularDispatchCount = 1;
    let responsePromise: ReturnType<typeof pageWindow.fetch>;
    try {
      responsePromise = applyCaptured<ReturnType<typeof pageWindow.fetch>>(
        state.primordials,
        state.originalFetch,
        pageWindow,
        [replayRequest]
      );
    } catch {
      finishOpaqueReplay(pageWindow, state, opaqueReplayError(state, 'replay-dispatch-failed'));
      return;
    }
    observeOpaqueReplayResponse(pageWindow, state, responsePromise, target.conversationId);
  } catch {
    finishOpaqueReplay(pageWindow, state, opaqueReplayError(state, 'replay-construction-failed'));
  }
}

function observeOpaqueReplaySourceResponse(
  pageWindow: PageWindow,
  state: OpaqueReplayPageState,
  responsePromise: Promise<Response>,
  target: MarkerTarget,
  preparation: OpaqueReplayPreparation
): void {
  try {
    const observation = applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      responsePromise,
      [
        (response: Response) => {
          try {
            if (state.settled) return;
            const status = applyCaptured<number>(
              state.primordials,
              state.primordials.document.responseStatus,
              response,
              []
            );
            if (status !== 200) {
              finishOpaqueReplay(pageWindow, state, opaqueReplayError(state, 'source-http-error'));
              return;
            }
            const headers = applyCaptured<Headers>(
              state.primordials,
              state.primordials.document.responseHeaders,
              response,
              []
            );
            const contentType = applyCaptured<string | null>(
              state.primordials,
              state.primordials.document.headersGet,
              headers,
              ['content-type']
            );
            if (
              typeof contentType !== 'string' ||
              !isJsonMediaType(state.primordials, contentType)
            ) {
              finishOpaqueReplay(pageWindow, state, opaqueReplayError(state, 'source-non-json'));
              return;
            }
            // Source response body is intentionally neither cloned nor read.
            dispatchOpaqueReplay(pageWindow, state, target, preparation);
          } catch {
            finishOpaqueReplay(pageWindow, state, opaqueReplayError(state, 'source-http-error'));
          }
        },
        () => finishOpaqueReplay(pageWindow, state, opaqueReplayError(state, 'source-rejected')),
      ]
    );
    void applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      observation,
      [
        () => undefined,
        () => finishOpaqueReplay(pageWindow, state, opaqueReplayError(state, 'source-http-error')),
      ]
    );
  } catch {
    finishOpaqueReplay(pageWindow, state, opaqueReplayError(state, 'source-http-error'));
  }
}

function armOpaqueReplay(
  pageWindow: PageWindow,
  primordials: PagePrimordials,
  target: MarkerTarget,
  windowRecord: Record<string, unknown>
): ChatGptDocumentStartResult {
  const originalFetch = pageWindow.fetch;
  if (typeof originalFetch !== 'function') return { kind: 'error', code: 'hook-state-failed' };
  const state: OpaqueReplayPageState = {
    primordials,
    originalFetch,
    wrappedFetch: undefined,
    timeoutId: undefined,
    abortController: undefined,
    settled: false,
    claimed: false,
    singularDispatchCount: 0,
    result: { kind: 'ready' },
  };
  const stateKey = opaqueReplayStateKeyFor(target.nonce);
  try {
    const getOwnPropertyDescriptor = primordials.document.objectGetOwnPropertyDescriptor;
    const defineProperty = primordials.document.objectDefineProperty;
    if (
      getOwnPropertyDescriptor === undefined ||
      defineProperty === undefined ||
      getOwnPropertyDescriptor(windowRecord, stateKey) !== undefined
    ) {
      return { kind: 'error', code: 'hook-state-failed' };
    }
    defineProperty(windowRecord, stateKey, {
      configurable: false,
      enumerable: false,
      get: () => snapshotOpaqueReplayResult(state.result),
    });
    const wrappedFetch = function (
      this: PageWindow,
      ...args: Parameters<typeof pageWindow.fetch>
    ): ReturnType<typeof pageWindow.fetch> {
      let candidate: OpaqueProbeCandidate | undefined;
      let preparation: OpaqueReplayPreparation | OpaqueReplayErrorCode | undefined;
      try {
        candidate =
          !state.settled && !state.claimed
            ? opaqueProbeCandidate(state.primordials, args, target.conversationId)
            : undefined;
        if (candidate !== undefined) {
          state.claimed = true;
          preparation = prepareOpaqueReplay(state.primordials, candidate);
          if (typeof preparation === 'string') {
            finishOpaqueReplay(pageWindow, state, opaqueReplayError(state, preparation));
          }
        }
      } catch {
        // The original page call must still happen even when a hostile input
        // defeats the observer/classifier.
        if (!state.settled) state.claimed = false;
        candidate = undefined;
        preparation = undefined;
      }
      let responsePromise: ReturnType<typeof pageWindow.fetch>;
      try {
        responsePromise = applyCaptured<ReturnType<typeof pageWindow.fetch>>(
          state.primordials,
          state.originalFetch,
          this,
          args
        );
      } catch (error) {
        if (candidate !== undefined && !state.settled) {
          finishOpaqueReplay(pageWindow, state, opaqueReplayError(state, 'source-rejected'));
        }
        throw error;
      }
      if (candidate !== undefined && preparation !== undefined && typeof preparation !== 'string') {
        observeOpaqueReplaySourceResponse(pageWindow, state, responsePromise, target, preparation);
      }
      return responsePromise;
    } as typeof pageWindow.fetch;
    state.wrappedFetch = wrappedFetch;
    pageWindow.fetch = wrappedFetch;
    state.timeoutId = applyCaptured<ReturnType<typeof pageWindow.setTimeout>>(
      primordials,
      primordials.setTimeout,
      pageWindow,
      [
        () => finishOpaqueReplay(pageWindow, state, opaqueReplayError(state, 'timed-out')),
        DEFAULT_TIMEOUT_MS,
      ]
    );
    return { kind: 'ready' };
  } catch {
    finishOpaqueReplay(pageWindow, state, opaqueReplayError(state, 'hook-state-failed'));
    return { kind: 'error', code: 'hook-state-failed' };
  }
}

/*
 * Active resolver checkpoint. The source Request clone's Headers and
 * credentials stay only in this closure. The published state is metric-safe:
 * it contains neither provider IDs nor the source request/response.
 */
type ActiveResolverOutcome =
  | { state: 'http-error' | 'rejected' | 'non-json' | 'oversized' | 'timed-out' | 'not-dispatched' }
  | {
      state: 'observed';
      capture: { bodyBase64: string; byteLength: number; sha256: string; mediaType: string };
    };

type ActiveResolverHookResult =
  | { kind: 'ready' }
  | {
      kind: 'complete';
      conversationId: string;
      requestedCount: number;
      dispatchCount: number;
      outcomes: ActiveResolverOutcome[];
    }
  | {
      kind: 'error';
      code:
        | 'hook-state-failed'
        | 'source-not-eligible'
        | 'source-rejected'
        | 'source-http-error'
        | 'source-non-json'
        | 'resolver-result-timeout';
    };

type ActiveResolverPageState = {
  primordials: PagePrimordials;
  originalFetch: typeof window.fetch;
  armedHref: string;
  wrappedFetch: typeof window.fetch | undefined;
  globalTimeoutId: ReturnType<typeof window.setTimeout> | undefined;
  perIdTimeoutId: ReturnType<typeof window.setTimeout> | undefined;
  abortController: AbortController | undefined;
  settled: boolean;
  claimed: boolean;
  commandAccepted: boolean;
  sourceReady: boolean;
  dispatchStarted: boolean;
  preparation: OpaqueReplayPreparation | undefined;
  providerFileIds: string[] | undefined;
  outcomes: ActiveResolverOutcome[];
  dispatchCount: number;
  result: ActiveResolverHookResult;
};

function activeResolverStateKeyFor(nonce: string): string {
  return `__liskaChatGptActiveResolver_${nonce}`;
}

function activeResolverCommandKeyFor(nonce: string): string {
  return `__liskaChatGptActiveResolverCommand_${nonce}`;
}

function hasActiveResolverArmingPrimordials(primordials: PagePrimordials): boolean {
  return (
    hasOpaqueReplayArmingPrimordials(primordials) && primordials.document.arrayIsArray !== undefined
  );
}

function snapshotActiveResolverResult(result: ActiveResolverHookResult): ActiveResolverHookResult {
  if (result.kind === 'ready') return { kind: 'ready' };
  if (result.kind === 'error') return { kind: 'error', code: result.code };
  const outcomes: ActiveResolverOutcome[] = [];
  for (const outcome of result.outcomes) {
    if (outcome.state === 'observed') {
      outcomes[outcomes.length] = { state: 'observed', capture: { ...outcome.capture } };
    } else {
      outcomes[outcomes.length] = { state: outcome.state };
    }
  }
  return {
    kind: 'complete',
    conversationId: result.conversationId,
    requestedCount: result.requestedCount,
    dispatchCount: result.dispatchCount,
    outcomes,
  };
}

function appendActiveResolverOutcome(
  state: ActiveResolverPageState,
  outcome: ActiveResolverOutcome
): void {
  applyCaptured<void>(state.primordials, state.primordials.document.arrayPush, state.outcomes, [
    outcome,
  ]);
}

function abortActiveResolver(state: ActiveResolverPageState): void {
  if (state.abortController === undefined) return;
  try {
    applyCaptured<void>(
      state.primordials,
      state.primordials.document.abortControllerAbort,
      state.abortController,
      []
    );
  } catch {
    // The terminal metric state is authoritative even when cancellation fails.
  }
  state.abortController = undefined;
}

function clearActiveResolverTimer(
  pageWindow: PageWindow,
  state: ActiveResolverPageState,
  field: 'globalTimeoutId' | 'perIdTimeoutId'
): void {
  const timeoutId = state[field];
  if (timeoutId === undefined) return;
  try {
    applyCaptured<void>(state.primordials, state.primordials.clearTimeout, pageWindow, [timeoutId]);
  } catch {
    // Timer cleanup does not change an already-complete result.
  }
  state[field] = undefined;
}

function finishActiveResolver(
  pageWindow: PageWindow,
  state: ActiveResolverPageState,
  result: ActiveResolverHookResult
): void {
  if (state.settled) return;
  state.settled = true;
  state.result = result;
  clearActiveResolverTimer(pageWindow, state, 'globalTimeoutId');
  clearActiveResolverTimer(pageWindow, state, 'perIdTimeoutId');
  abortActiveResolver(state);
  try {
    if (state.wrappedFetch !== undefined && pageWindow.fetch === state.wrappedFetch) {
      pageWindow.fetch = state.originalFetch;
    }
  } catch {
    // A later page wrapper is never replaced.
  }
}

function activeResolverComplete(
  pageWindow: PageWindow,
  state: ActiveResolverPageState,
  target: MarkerTarget
): void {
  const requestedCount = state.providerFileIds?.length ?? 0;
  // A direct request increments dispatchCount immediately before fetch. On a
  // global timeout it is therefore a dispatched (timed-out) ordinal, never a
  // fictitious not-dispatched one; only the remaining queue is unstarted.
  if (state.outcomes.length < state.dispatchCount) {
    appendActiveResolverOutcome(state, { state: 'timed-out' });
  }
  while (state.outcomes.length < requestedCount) {
    appendActiveResolverOutcome(state, { state: 'not-dispatched' });
  }
  finishActiveResolver(pageWindow, state, {
    kind: 'complete',
    conversationId: target.conversationId,
    requestedCount,
    dispatchCount: state.dispatchCount,
    outcomes: state.outcomes,
  });
}

function activeResolverSourceFailure(
  pageWindow: PageWindow,
  state: ActiveResolverPageState,
  target: MarkerTarget,
  code: Extract<ActiveResolverHookResult, { kind: 'error' }>['code']
): void {
  if (state.commandAccepted) {
    activeResolverComplete(pageWindow, state, target);
  } else {
    finishActiveResolver(pageWindow, state, { kind: 'error', code });
  }
}

function activeResolverTimeout(
  pageWindow: PageWindow,
  state: ActiveResolverPageState,
  target: MarkerTarget
): void {
  if (state.commandAccepted) {
    activeResolverComplete(pageWindow, state, target);
  } else {
    finishActiveResolver(pageWindow, state, { kind: 'error', code: 'resolver-result-timeout' });
  }
}

function activeResolverRequestUrl(target: MarkerTarget, providerFileId: string): string {
  return (
    `${CHATGPT_ORIGIN}/backend-api/files/download/${providerFileId}` +
    `?conversation_id=${target.conversationId}&inline=true` +
    `&check_context_scopes_for_conversation_id=${target.conversationId}`
  );
}

function activeResolverContainsId(providerFileIds: readonly string[], candidate: string): boolean {
  for (let index = 0; index < providerFileIds.length; index += 1) {
    if (providerFileIds[index] === candidate) return true;
  }
  return false;
}

function activeResolverObservedBytes(outcomes: readonly ActiveResolverOutcome[]): number {
  let total = 0;
  for (let index = 0; index < outcomes.length; index += 1) {
    const outcome = outcomes[index];
    if (outcome.state === 'observed') total += outcome.capture.byteLength;
  }
  return total;
}

function activeResolverHrefStillExact(
  pageWindow: PageWindow,
  state: ActiveResolverPageState
): boolean {
  try {
    return pageWindow.location.href === state.armedHref;
  } catch {
    return false;
  }
}

async function captureActiveResolverResponse(
  state: ActiveResolverPageState,
  response: Response
): Promise<ActiveResolverOutcome> {
  try {
    const status = applyCaptured<number>(
      state.primordials,
      state.primordials.document.responseStatus,
      response,
      []
    );
    if (status !== 200) return { state: 'http-error' };
    const headers = applyCaptured<Headers>(
      state.primordials,
      state.primordials.document.responseHeaders,
      response,
      []
    );
    const mediaType = applyCaptured<string | null>(
      state.primordials,
      state.primordials.document.headersGet,
      headers,
      ['content-type']
    );
    if (typeof mediaType !== 'string' || !isJsonMediaType(state.primordials, mediaType)) {
      return { state: 'non-json' };
    }
    const clone = applyCaptured<Response>(
      state.primordials,
      state.primordials.document.responseClone,
      response,
      []
    );
    discardOpaqueReplayOriginalBody(state.primordials, response);
    const bytes = await readBoundedClone(
      state.primordials,
      clone,
      DEFAULT_ACTIVE_RESOLVER_MAX_BYTES
    );
    const currentBytes = activeResolverObservedBytes(state.outcomes);
    if (currentBytes + bytes.byteLength > DEFAULT_ACTIVE_RESOLVER_MAX_TOTAL_BYTES) {
      return { state: 'oversized' };
    }
    return {
      state: 'observed',
      capture: {
        bodyBase64: base64FromBytes(state.primordials, bytes),
        byteLength: bytes.byteLength,
        sha256: await sha256FromBytes(state.primordials, bytes),
        mediaType,
      },
    };
  } catch (error) {
    return { state: error === PAYLOAD_TOO_LARGE ? 'oversized' : 'rejected' };
  }
}

async function dispatchActiveResolverQueue(
  pageWindow: PageWindow,
  state: ActiveResolverPageState,
  target: MarkerTarget
): Promise<void> {
  const providerFileIds = state.providerFileIds;
  const preparation = state.preparation;
  if (state.settled || providerFileIds === undefined || preparation === undefined) return;
  const AbortControllerConstructor = state.primordials.document.abortControllerConstructor;
  const RequestConstructor = state.primordials.document.requestConstructor;
  if (AbortControllerConstructor === undefined || RequestConstructor === undefined) {
    activeResolverSourceFailure(pageWindow, state, target, 'hook-state-failed');
    return;
  }
  state.dispatchStarted = true;
  for (let ordinal = 0; ordinal < providerFileIds.length; ordinal += 1) {
    if (state.settled) return;
    if (!activeResolverHrefStillExact(pageWindow, state)) {
      activeResolverComplete(pageWindow, state, target);
      return;
    }
    let timedOut = false;
    try {
      const controller = new AbortControllerConstructor();
      const signal = applyCaptured<AbortSignal>(
        state.primordials,
        state.primordials.document.abortControllerSignal,
        controller,
        []
      );
      state.abortController = controller;
      state.perIdTimeoutId = applyCaptured<ReturnType<typeof pageWindow.setTimeout>>(
        state.primordials,
        state.primordials.setTimeout,
        pageWindow,
        [
          () => {
            timedOut = true;
            abortActiveResolver(state);
          },
          DEFAULT_ACTIVE_RESOLVER_PER_ID_TIMEOUT_MS,
        ]
      );
      const request = new RequestConstructor(
        activeResolverRequestUrl(target, providerFileIds[ordinal]),
        {
          method: 'GET',
          headers: preparation.headers,
          credentials: preparation.credentials,
          redirect: 'error',
          cache: 'no-store',
          signal,
        }
      );
      state.dispatchCount += 1;
      const response = await applyCaptured<Promise<Response>>(
        state.primordials,
        state.originalFetch,
        pageWindow,
        [request]
      );
      clearActiveResolverTimer(pageWindow, state, 'perIdTimeoutId');
      state.abortController = undefined;
      if (state.settled) return;
      const outcome = timedOut
        ? { state: 'timed-out' as const }
        : await captureActiveResolverResponse(state, response);
      // The non-extendable global deadline may settle while clone/hash work is
      // pending. Never mutate the terminal result after that point.
      if (state.settled) return;
      appendActiveResolverOutcome(state, outcome);
    } catch {
      clearActiveResolverTimer(pageWindow, state, 'perIdTimeoutId');
      state.abortController = undefined;
      if (state.settled) return;
      appendActiveResolverOutcome(state, { state: timedOut ? 'timed-out' : 'rejected' });
    }
  }
  if (!state.settled) activeResolverComplete(pageWindow, state, target);
}

function maybeDispatchActiveResolver(
  pageWindow: PageWindow,
  state: ActiveResolverPageState,
  target: MarkerTarget
): void {
  if (
    state.settled ||
    state.dispatchStarted ||
    !state.commandAccepted ||
    !state.sourceReady ||
    state.providerFileIds === undefined ||
    state.preparation === undefined
  ) {
    return;
  }
  if (!activeResolverHrefStillExact(pageWindow, state)) {
    activeResolverComplete(pageWindow, state, target);
    return;
  }
  void dispatchActiveResolverQueue(pageWindow, state, target);
}

function observeActiveResolverSourceResponse(
  pageWindow: PageWindow,
  state: ActiveResolverPageState,
  responsePromise: Promise<Response>,
  target: MarkerTarget,
  preparation: OpaqueReplayPreparation
): void {
  try {
    const observation = applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      responsePromise,
      [
        (response: Response) => {
          try {
            if (state.settled) return;
            const status = applyCaptured<number>(
              state.primordials,
              state.primordials.document.responseStatus,
              response,
              []
            );
            if (status !== 200) {
              activeResolverSourceFailure(pageWindow, state, target, 'source-http-error');
              return;
            }
            const headers = applyCaptured<Headers>(
              state.primordials,
              state.primordials.document.responseHeaders,
              response,
              []
            );
            const contentType = applyCaptured<string | null>(
              state.primordials,
              state.primordials.document.headersGet,
              headers,
              ['content-type']
            );
            if (
              typeof contentType !== 'string' ||
              !isJsonMediaType(state.primordials, contentType)
            ) {
              activeResolverSourceFailure(pageWindow, state, target, 'source-non-json');
              return;
            }
            state.sourceReady = true;
            state.preparation = preparation;
            maybeDispatchActiveResolver(pageWindow, state, target);
          } catch {
            activeResolverSourceFailure(pageWindow, state, target, 'source-http-error');
          }
        },
        () => activeResolverSourceFailure(pageWindow, state, target, 'source-rejected'),
      ]
    );
    void applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      observation,
      [
        () => undefined,
        () => activeResolverSourceFailure(pageWindow, state, target, 'source-http-error'),
      ]
    );
  } catch {
    activeResolverSourceFailure(pageWindow, state, target, 'source-http-error');
  }
}

function armActiveResolver(
  pageWindow: PageWindow,
  primordials: PagePrimordials,
  target: MarkerTarget,
  windowRecord: Record<string, unknown>
): ChatGptDocumentStartResult {
  const originalFetch = pageWindow.fetch;
  if (typeof originalFetch !== 'function') return { kind: 'error', code: 'hook-state-failed' };
  let armedHref: string;
  try {
    armedHref = pageWindow.location.href;
  } catch {
    return { kind: 'error', code: 'hook-state-failed' };
  }
  const state: ActiveResolverPageState = {
    primordials,
    originalFetch,
    armedHref,
    wrappedFetch: undefined,
    globalTimeoutId: undefined,
    perIdTimeoutId: undefined,
    abortController: undefined,
    settled: false,
    claimed: false,
    commandAccepted: false,
    sourceReady: false,
    dispatchStarted: false,
    preparation: undefined,
    providerFileIds: undefined,
    outcomes: [],
    dispatchCount: 0,
    result: { kind: 'ready' },
  };
  const stateKey = activeResolverStateKeyFor(target.nonce);
  const commandKey = activeResolverCommandKeyFor(target.nonce);
  try {
    const getOwnPropertyDescriptor = primordials.document.objectGetOwnPropertyDescriptor;
    const defineProperty = primordials.document.objectDefineProperty;
    if (
      getOwnPropertyDescriptor === undefined ||
      defineProperty === undefined ||
      getOwnPropertyDescriptor(windowRecord, stateKey) !== undefined ||
      getOwnPropertyDescriptor(windowRecord, commandKey) !== undefined
    ) {
      return { kind: 'error', code: 'hook-state-failed' };
    }
    defineProperty(windowRecord, stateKey, {
      configurable: false,
      enumerable: false,
      get: () => snapshotActiveResolverResult(state.result),
    });
    defineProperty(windowRecord, commandKey, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: (providerFileIds: unknown): boolean => {
        try {
          if (
            state.settled ||
            state.commandAccepted ||
            !activeResolverHrefStillExact(pageWindow, state) ||
            !applyCaptured<boolean>(primordials, primordials.document.arrayIsArray, undefined, [
              providerFileIds,
            ])
          )
            return false;
          const providerFileIdList = providerFileIds as unknown[];
          if (
            providerFileIdList.length === 0 ||
            providerFileIdList.length > DEFAULT_ACTIVE_RESOLVER_MAX_OBSERVATIONS
          ) {
            return false;
          }
          const safeIds: string[] = [];
          for (let index = 0; index < providerFileIdList.length; index += 1) {
            const providerFileId = providerFileIdList[index];
            if (
              typeof providerFileId !== 'string' ||
              !isSafeResolverFileId(primordials, providerFileId)
            ) {
              return false;
            }
            if (activeResolverContainsId(safeIds, providerFileId)) return false;
            applyCaptured<void>(primordials, primordials.document.arrayPush, safeIds, [
              providerFileId,
            ]);
          }
          state.providerFileIds = safeIds;
          state.commandAccepted = true;
          maybeDispatchActiveResolver(pageWindow, state, target);
          return true;
        } catch {
          return false;
        }
      },
    });
    const wrappedFetch = function (
      this: PageWindow,
      ...args: Parameters<typeof pageWindow.fetch>
    ): ReturnType<typeof pageWindow.fetch> {
      let candidate: OpaqueProbeCandidate | undefined;
      let preparation: OpaqueReplayPreparation | OpaqueReplayErrorCode | undefined;
      try {
        candidate =
          !state.settled && !state.claimed
            ? opaqueProbeCandidate(state.primordials, args, target.conversationId)
            : undefined;
        if (candidate !== undefined) {
          state.claimed = true;
          preparation = prepareOpaqueReplay(state.primordials, candidate);
          if (typeof preparation === 'string') {
            activeResolverSourceFailure(pageWindow, state, target, 'source-not-eligible');
          }
        }
      } catch {
        candidate = undefined;
        preparation = undefined;
      }
      let responsePromise: ReturnType<typeof pageWindow.fetch>;
      try {
        responsePromise = applyCaptured<ReturnType<typeof pageWindow.fetch>>(
          state.primordials,
          state.originalFetch,
          this,
          args
        );
      } catch (error) {
        if (candidate !== undefined && !state.settled) {
          activeResolverSourceFailure(pageWindow, state, target, 'source-rejected');
        }
        throw error;
      }
      if (candidate !== undefined && preparation !== undefined && typeof preparation !== 'string') {
        observeActiveResolverSourceResponse(
          pageWindow,
          state,
          responsePromise,
          target,
          preparation
        );
      }
      return responsePromise;
    } as typeof pageWindow.fetch;
    state.wrappedFetch = wrappedFetch;
    pageWindow.fetch = wrappedFetch;
    state.globalTimeoutId = applyCaptured<ReturnType<typeof pageWindow.setTimeout>>(
      primordials,
      primordials.setTimeout,
      pageWindow,
      [() => activeResolverTimeout(pageWindow, state, target), DEFAULT_TIMEOUT_MS]
    );
    return { kind: 'ready' };
  } catch {
    finishActiveResolver(pageWindow, state, { kind: 'error', code: 'hook-state-failed' });
    return { kind: 'error', code: 'hook-state-failed' };
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
  if (
    primordials === undefined ||
    (target.mode === 'capture'
      ? !hasArmingPrimordials(primordials)
      : target.mode === 'opaque-probe'
        ? !hasOpaqueProbeArmingPrimordials(primordials)
        : target.mode === 'opaque-resolver'
          ? !hasOpaqueResolverArmingPrimordials(primordials)
          : target.mode === 'active-resolver'
            ? !hasActiveResolverArmingPrimordials(primordials)
            : !hasOpaqueReplayArmingPrimordials(primordials))
  ) {
    return { kind: 'error', code: 'hook-state-failed' };
  }

  const windowRecord = pageWindow as unknown as Record<string, unknown>;
  if (target.mode === 'opaque-probe') {
    return armOpaqueProbe(pageWindow, primordials, target, windowRecord);
  }
  if (target.mode === 'opaque-resolver') {
    return armOpaqueResolver(pageWindow, primordials, target, windowRecord);
  }
  if (target.mode === 'active-resolver') {
    return armActiveResolver(pageWindow, primordials, target, windowRecord);
  }
  if (target.mode === 'opaque-replay') {
    return armOpaqueReplay(pageWindow, primordials, target, windowRecord);
  }

  const stateKey = stateKeyFor(target.nonce);
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
