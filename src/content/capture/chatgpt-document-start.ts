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
const INTERPRETER_RESOLVER_FRAGMENT_PATTERN =
  /^#liska-capture=([a-z0-9-]{16,128})&liska-interpreter-resolver=1$/i;
const CONVERSATION_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const STANDARD_CONVERSATION_ROUTE_PATTERN = /^\/c\/([^/]+)\/?$/;
const OWNER_CONVERSATION_ROUTE_PATTERN =
  /^\/g\/([a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?)\/c\/([^/]+)\/?$/;
const INLINE_CAPTURE_MAX_BYTES = 16 * 1024 * 1024;
const STAGED_CAPTURE_MAX_BYTES = 64 * 1024 * 1024;
const STAGED_CAPTURE_CHUNK_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RESPONSE_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
const DEFAULT_OPAQUE_PROBE_TIMEOUT_MS = 45_000;
const DEFAULT_RESOLVER_DISCOVERY_WINDOW_MS = 2_000;
const DEFAULT_OPAQUE_RESOLVER_DISCOVERY_WINDOW_MS = 8_000;
const DEFAULT_RESOLVER_MAX_BYTES = 64 * 1024;
const DEFAULT_RESOLVER_MAX_OBSERVATIONS = 32;
const DEFAULT_ACTIVE_RESOLVER_MAX_OBSERVATIONS = 1;
const DEFAULT_ACTIVE_RESOLVER_MAX_BYTES = 64 * 1024;
const DEFAULT_ACTIVE_RESOLVER_PER_ID_TIMEOUT_MS = 12_000;
const DEFAULT_INTERPRETER_RESOLVER_MAX_OBSERVATIONS = 20;
const DEFAULT_INTERPRETER_RESOLVER_MAX_BYTES = 64 * 1024;
const DEFAULT_INTERPRETER_RESOLVER_PER_ITEM_TIMEOUT_MS = 12_000;
const RESOLVER_PATH_PREFIX = '/backend-api/files/download/';
const CALPICO_RESOLVER_PATH_PREFIX = '/backend-api/calpico/chatgpt/files/';
const PAYLOAD_TOO_LARGE = {};
const PRIMORDIAL_UNAVAILABLE = {};
const HEX_DIGITS = '0123456789abcdef';
// Work/size bounds for closure-private header snapshots, never diagnostic data.
const REPLAY_HEADER_MAX_COUNT = 64;
const REPLAY_HEADER_MAX_NAME = 128;
const REPLAY_HEADER_MAX_VALUE = 8192;
const REPLAY_HEADER_MAX_TOTAL = 32768;
const INVALID_REPLAY_HEADERS = {};
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

function isRequestInitMemberName(value: string | symbol): value is string {
  if (typeof value !== 'string') return false;
  for (let index = 0; index < REQUEST_INIT_MEMBER_NAMES.length; index += 1) {
    if (REQUEST_INIT_MEMBER_NAMES[index] === value) return true;
  }
  return false;
}

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
      capture: ConversationCapture;
      resolverObservations: ResolverObservation[];
    }
  | { kind: 'error'; code: HookErrorCode };

type InlineConversationCapture = {
  transport: 'inline';
  bodyBase64: string;
  byteLength: number;
  sha256: string;
  mediaType: string;
};

type StagedConversationCapture = {
  transport: 'staged';
  byteLength: number;
  sha256: string;
  mediaType: string;
  chunkCount: number;
};

type ConversationCapture = InlineConversationCapture | StagedConversationCapture;

type CaptureChunk = {
  kind: 'chunk';
  index: number;
  offset: number;
  byteLength: number;
  chunkBase64: string;
};

type CaptureChunkReader = (index: number) => CaptureChunk | { kind: 'missing' };

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
  documentReceiver: Document | undefined;
  documentBaseURI: CapturedCallable | undefined;
  objectCreate: typeof Object.create | undefined;
  objectDefineProperty: typeof Object.defineProperty | undefined;
  objectGetOwnPropertyDescriptor: typeof Object.getOwnPropertyDescriptor | undefined;
  objectGetPrototypeOf: typeof Object.getPrototypeOf | undefined;
  objectPrototype: object | undefined;
  reflectOwnKeys: typeof Reflect.ownKeys | undefined;
  responseClone: CapturedCallable | undefined;
  responseArrayBuffer: CapturedCallable | undefined;
  responseStatus: CapturedCallable | undefined;
  responseUrl: CapturedCallable | undefined;
  responseRedirected: CapturedCallable | undefined;
  responseHeaders: CapturedCallable | undefined;
  responseBody: CapturedCallable | undefined;
  headersGet: CapturedCallable | undefined;
  headersHas: CapturedCallable | undefined;
  headersForEach: CapturedCallable | undefined;
  streamGetReader: CapturedCallable | undefined;
  readerRead: CapturedCallable | undefined;
  readerCancel: CapturedCallable | undefined;
  requestUrl: CapturedCallable | undefined;
  requestMethod: CapturedCallable | undefined;
  requestHeaders: CapturedCallable | undefined;
  requestCredentials: CapturedCallable | undefined;
  requestClone: CapturedCallable | undefined;
  requestConstructor: typeof Request | undefined;
  URLSearchParams: typeof URLSearchParams | undefined;
  urlSearchParamsSet: CapturedCallable | undefined;
  urlSearchParamsToString: CapturedCallable | undefined;
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
  regExpExec: CapturedCallable | undefined;
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
  conversationCapture: ConversationCapture | undefined;
  stagedCaptureReader: CaptureChunkReader | undefined;
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
  routeFamily: 'standard' | 'custom-gpt' | 'project';
  mode:
    | 'capture'
    | 'opaque-probe'
    | 'opaque-replay'
    | 'opaque-resolver'
    | 'active-resolver'
    | 'interpreter-resolver';
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
  const NativeURLSearchParams = pageWindow.URLSearchParams;
  const NativeReadableStream = pageWindow.ReadableStream;
  const NativeReader = pageWindow.ReadableStreamDefaultReader;
  const NativePromise = pageWindow.Promise;
  const NativeArray = pageWindow.Array;
  const NativeUint8Array = pageWindow.Uint8Array;
  const NativeArrayBuffer = pageWindow.ArrayBuffer;
  const NativeString = pageWindow.String;
  const NativeRegExp = pageWindow.RegExp;
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
    documentReceiver: pageWindow.document,
    documentBaseURI: getterAt(getOwnPropertyDescriptor, pageWindow.Node?.prototype, 'baseURI'),
    objectCreate: typeof NativeObject?.create === 'function' ? NativeObject.create : undefined,
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
    responseUrl: getterAt(getOwnPropertyDescriptor, responsePrototype, 'url'),
    responseRedirected: getterAt(getOwnPropertyDescriptor, responsePrototype, 'redirected'),
    responseHeaders: getterAt(getOwnPropertyDescriptor, responsePrototype, 'headers'),
    responseBody: getterAt(getOwnPropertyDescriptor, responsePrototype, 'body'),
    headersGet: methodAt(headersPrototype, 'get'),
    headersHas: methodAt(headersPrototype, 'has'),
    headersForEach: methodAt(headersPrototype, 'forEach'),
    streamGetReader: methodAt(streamPrototype, 'getReader'),
    readerRead: methodAt(readerPrototype, 'read'),
    readerCancel: methodAt(readerPrototype, 'cancel'),
    requestUrl: getterAt(getOwnPropertyDescriptor, requestPrototype, 'url'),
    requestMethod: getterAt(getOwnPropertyDescriptor, requestPrototype, 'method'),
    requestHeaders: getterAt(getOwnPropertyDescriptor, requestPrototype, 'headers'),
    requestCredentials: getterAt(getOwnPropertyDescriptor, requestPrototype, 'credentials'),
    requestClone: methodAt(requestPrototype, 'clone'),
    requestConstructor: typeof NativeRequest === 'function' ? NativeRequest : undefined,
    URLSearchParams:
      typeof NativeURLSearchParams === 'function' ? NativeURLSearchParams : undefined,
    urlSearchParamsSet: methodAt(NativeURLSearchParams?.prototype, 'set'),
    urlSearchParamsToString: methodAt(NativeURLSearchParams?.prototype, 'toString'),
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
    regExpExec: methodAt(NativeRegExp?.prototype, 'exec'),
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

    const interpreterResolverMarker = INTERPRETER_RESOLVER_FRAGMENT_PATTERN.exec(url.hash);
    const activeResolverMarker =
      interpreterResolverMarker === null ? ACTIVE_RESOLVER_FRAGMENT_PATTERN.exec(url.hash) : null;
    const replayMarker =
      interpreterResolverMarker === null && activeResolverMarker === null
        ? OPAQUE_REPLAY_FRAGMENT_PATTERN.exec(url.hash)
        : null;
    const resolverMarker =
      interpreterResolverMarker === null && activeResolverMarker === null && replayMarker === null
        ? OPAQUE_RESOLVER_FRAGMENT_PATTERN.exec(url.hash)
        : null;
    const probeMarker =
      interpreterResolverMarker === null &&
      activeResolverMarker === null &&
      replayMarker === null &&
      resolverMarker === null
        ? OPAQUE_PROBE_FRAGMENT_PATTERN.exec(url.hash)
        : null;
    const marker =
      interpreterResolverMarker ??
      activeResolverMarker ??
      replayMarker ??
      resolverMarker ??
      probeMarker ??
      CAPTURE_FRAGMENT_PATTERN.exec(url.hash);
    const nonce = marker?.[1];
    if (nonce === undefined) return undefined;

    const standard = STANDARD_CONVERSATION_ROUTE_PATTERN.exec(url.pathname);
    const owner = OWNER_CONVERSATION_ROUTE_PATTERN.exec(url.pathname);
    const ownerSlug = owner?.[1];
    const conversationId = standard?.[1] ?? owner?.[2];
    return conversationId !== undefined && CONVERSATION_ID_PATTERN.test(conversationId)
      ? {
          conversationId,
          nonce,
          observeAssetResolvers: marker?.[2] === '1',
          routeFamily:
            standard !== null
              ? 'standard'
              : ownerSlug?.toLowerCase().startsWith('g-p-')
                ? 'project'
                : 'custom-gpt',
          mode:
            interpreterResolverMarker !== null
              ? 'interpreter-resolver'
              : activeResolverMarker !== null
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
 * Accept the observed native image helper grammar in any of its 24 key
 * orders, but only with each literal key-value pair exactly once. Parsing is
 * deliberately primitive-only because this runs in the page's MAIN world.
 */
function isExactNativeImageResolverQuery(
  primordials: PagePrimordials,
  query: string,
  conversationId: string
): boolean {
  if (query.length === 0 || query[0] !== '?') return false;
  const conversation = `conversation_id=${conversationId}`;
  const inline = 'inline=false';
  const downloadIntent = 'download_intent=false';
  const libraryState = 'include_library_file_state=true';
  let seenConversation = false;
  let seenInline = false;
  let seenDownloadIntent = false;
  let seenLibraryState = false;
  let start = 1;

  for (let count = 0; count < 4; count += 1) {
    const separator = applyCaptured<number>(
      primordials,
      primordials.document.stringIndexOf,
      query,
      ['&', start]
    );
    const end = separator === -1 ? query.length : separator;
    const component = applyCaptured<string>(primordials, primordials.document.stringSlice, query, [
      start,
      end,
    ]);
    if (component === conversation && !seenConversation) {
      seenConversation = true;
    } else if (component === inline && !seenInline) {
      seenInline = true;
    } else if (component === downloadIntent && !seenDownloadIntent) {
      seenDownloadIntent = true;
    } else if (component === libraryState && !seenLibraryState) {
      seenLibraryState = true;
    } else {
      return false;
    }
    if (separator === -1) {
      return (
        count === 3 && seenConversation && seenInline && seenDownloadIntent && seenLibraryState
      );
    }
    start = separator + 1;
  }
  return false;
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

  if (isExactNativeImageResolverQuery(primordials, query, conversationId)) {
    return providerFileId;
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

function chunkReaderKeyFor(nonce: string): string {
  return `__liskaChatGptCaptureChunkReader_${nonce}`;
}

function stagedCaptureReader(
  primordials: PagePrimordials,
  bytes: Uint8Array
): { chunkCount: number; reader: CaptureChunkReader } {
  let chunkCount = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += STAGED_CAPTURE_CHUNK_BYTES) {
    chunkCount += 1;
  }

  return {
    chunkCount,
    reader: (index: number): CaptureChunk | { kind: 'missing' } => {
      if (
        typeof index !== 'number' ||
        index !== index ||
        index < 0 ||
        index >= chunkCount ||
        index % 1 !== 0
      ) {
        return { kind: 'missing' };
      }
      try {
        const offset = index * STAGED_CAPTURE_CHUNK_BYTES;
        const chunk = applyCaptured<Uint8Array>(
          primordials,
          primordials.document.uint8ArraySubarray,
          bytes,
          [offset, offset + STAGED_CAPTURE_CHUNK_BYTES]
        );
        return {
          kind: 'chunk',
          index,
          offset,
          byteLength: chunk.byteLength,
          chunkBase64: base64FromBytes(primordials, chunk),
        };
      } catch {
        return { kind: 'missing' };
      }
    },
  };
}

function conversationCaptureFromBytes(
  primordials: PagePrimordials,
  bytes: Uint8Array,
  sha256: string,
  mediaType: string
): { capture: ConversationCapture; stagedReader: CaptureChunkReader | undefined } {
  if (bytes.byteLength <= INLINE_CAPTURE_MAX_BYTES) {
    return {
      capture: {
        transport: 'inline',
        bodyBase64: base64FromBytes(primordials, bytes),
        byteLength: bytes.byteLength,
        sha256,
        mediaType,
      },
      stagedReader: undefined,
    };
  }

  const staged = stagedCaptureReader(primordials, bytes);
  return {
    capture: {
      transport: 'staged',
      byteLength: bytes.byteLength,
      sha256,
      mediaType,
      chunkCount: staged.chunkCount,
    },
    stagedReader: staged.reader,
  };
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
  const capture =
    result.capture.transport === 'inline'
      ? {
          transport: 'inline' as const,
          bodyBase64: result.capture.bodyBase64,
          byteLength: result.capture.byteLength,
          sha256: result.capture.sha256,
          mediaType: result.capture.mediaType,
        }
      : {
          transport: 'staged' as const,
          byteLength: result.capture.byteLength,
          sha256: result.capture.sha256,
          mediaType: result.capture.mediaType,
          chunkCount: result.capture.chunkCount,
        };
  return {
    kind: 'captured',
    conversationId: result.conversationId,
    capture,
    resolverObservations,
  };
}

function publishResultSnapshot(
  primordials: PagePrimordials,
  windowRecord: Record<string, unknown>,
  stateKey: string,
  chunkReaderKey: string,
  state: PageState
): boolean {
  try {
    const defineProperty = primordials.document.objectDefineProperty;
    if (defineProperty === undefined) return false;
    defineProperty(windowRecord, chunkReaderKey, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: (index: number): CaptureChunk | { kind: 'missing' } => {
        const reader = state.stagedCaptureReader;
        return reader === undefined ? { kind: 'missing' } : reader(index);
      },
    });
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
      stagedCaptureReader: undefined,
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

function armCaptureTimeout(
  pageWindow: PageWindow,
  state: PageState,
  code: 'conversation-request-timeout' | 'conversation-response-timeout',
  timeoutMs: number
): void {
  if (state.timeoutId !== undefined) {
    try {
      applyCaptured<void>(state.primordials, state.primordials.clearTimeout, pageWindow, [
        state.timeoutId,
      ]);
    } catch {
      // A replacement timer still provides the bounded terminal result.
    }
    state.timeoutId = undefined;
  }
  try {
    state.timeoutId = applyCaptured<ReturnType<typeof pageWindow.setTimeout>>(
      state.primordials,
      state.primordials.setTimeout,
      pageWindow,
      [() => finishCapture(pageWindow, state, { kind: 'error', code }), timeoutMs]
    );
  } catch {
    finishCapture(pageWindow, state, { kind: 'error', code: 'hook-state-failed' });
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
  capture: NonNullable<PageState['conversationCapture']>,
  stagedReader: CaptureChunkReader | undefined
): void {
  if (state.settled) return;
  state.conversationCapture = capture;
  state.stagedCaptureReader = stagedReader;

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
    const captured = conversationCaptureFromBytes(primordials, bytes, sha256, mediaType);
    beginResolverDiscovery(pageWindow, state, target, captured.capture, captured.stagedReader);
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
          captureNativeResponse(pageWindow, state, response, STAGED_CAPTURE_MAX_BYTES, target),
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
    if (shouldCaptureConversation) {
      state.claimed = true;
      armCaptureTimeout(
        pageWindow,
        state,
        'conversation-response-timeout',
        DEFAULT_RESPONSE_TIMEOUT_MS
      );
    }

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
    armCaptureTimeout(
      pageWindow,
      state,
      'conversation-request-timeout',
      DEFAULT_REQUEST_TIMEOUT_MS
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
  | 'init-security-sensitive-headers'
  | 'init-security-sensitive-headers-distinct'
  | 'init-security-sensitive-headers-native-distinct'
  | `init-security-sensitive-headers-unbranded-${ReplayHeadersRejectReason}`
  | 'init-security-sensitive-body'
  | 'init-security-sensitive-method'
  | 'init-security-sensitive-credentials'
  | 'init-security-sensitive-multiple'
  | 'init-unsupported'
  | 'init-unsupported-prototype'
  | 'init-unsupported-inherited'
  | 'init-unsupported-symbol'
  | 'init-unsupported-member'
  | 'init-unsupported-accessor'
  | 'init-unsupported-reflection'
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
  | 'eligible-init-compatible'
  | 'eligible-init-plain-headers'
  | 'hook-state-failed'
  | 'probe-failed';

type OpaqueProbeInitKind =
  | 'absent'
  | 'empty'
  | 'signal-only'
  | 'compatible'
  | 'plain-headers'
  | 'security-sensitive'
  | 'security-sensitive-headers'
  | 'security-sensitive-headers-distinct'
  | 'security-sensitive-headers-native-distinct'
  | `security-sensitive-headers-unbranded-${ReplayHeadersRejectReason}`
  | 'security-sensitive-body'
  | 'security-sensitive-method'
  | 'security-sensitive-credentials'
  | 'security-sensitive-multiple'
  | 'unsupported'
  | 'unsupported-prototype'
  | 'unsupported-inherited'
  | 'unsupported-symbol'
  | 'unsupported-member'
  | 'unsupported-accessor'
  | 'unsupported-reflection';

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
  credentialsOverride: 'include' | 'same-origin' | undefined;
  sourceClone: Request | undefined;
  sourceCredentials: RequestCredentials | undefined;
  plainHeaders: Record<string, string> | undefined;
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
    document.responseUrl !== undefined &&
    document.responseRedirected !== undefined &&
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

function isNetworkPathReference(primordials: PagePrimordials, input: string): boolean {
  let slashes = 0;
  for (let index = 0; index < input.length; index += 1) {
    const code = applyCaptured<number>(primordials, primordials.document.stringCharCodeAt, input, [
      index,
    ]);
    // The URL parser trims leading C0/space and removes tab/newline everywhere.
    if ((slashes === 0 && code <= 32) || code === 9 || code === 10 || code === 13) continue;
    if (code !== 47 && code !== 92) return false;
    slashes += 1;
    if (slashes === 2) return true;
  }
  return false;
}

function opaqueProbeUrl(primordials: PagePrimordials, input: RequestInfo | URL): URL | undefined {
  try {
    let rawUrl: string;
    let baseUrl: string = CHATGPT_ORIGIN;
    if (typeof input === 'string') {
      rawUrl = input;
      if (isNetworkPathReference(primordials, input)) return undefined;
      const base = applyCaptured<unknown>(
        primordials,
        primordials.document.documentBaseURI,
        primordials.document.documentReceiver,
        []
      );
      // Never consult a page-owned document.baseURI or coerce a failed getter.
      if (typeof base !== 'string') return undefined;
      baseUrl = base;
    } else {
      try {
        rawUrl = applyCaptured<string>(primordials, primordials.document.urlHref, input, []);
      } catch {
        rawUrl = applyCaptured<string>(primordials, primordials.document.requestUrl, input, []);
      }
    }
    const URLConstructor = primordials.document.URL;
    return URLConstructor === undefined ? undefined : new URLConstructor(rawUrl, baseUrl);
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

function isExactOpaqueSourceResponse(
  primordials: PagePrimordials,
  response: Response,
  conversationId: string
): boolean {
  try {
    const rawUrl = applyCaptured<unknown>(
      primordials,
      primordials.document.responseUrl,
      response,
      []
    );
    if (
      typeof rawUrl !== 'string' ||
      applyCaptured<unknown>(primordials, primordials.document.responseRedirected, response, []) !==
        false
    ) {
      return false;
    }
    const URLConstructor = primordials.document.URL;
    if (URLConstructor === undefined) return false;
    // Response.url is already absolute. Never resolve an empty/relative value
    // against document <base> or coerce a rejected getter result.
    const url = new URLConstructor(rawUrl);
    return (
      applyCaptured<string>(primordials, primordials.document.urlOrigin, url, []) ===
        CHATGPT_ORIGIN &&
      applyCaptured<string>(primordials, primordials.document.urlUsername, url, []) === '' &&
      applyCaptured<string>(primordials, primordials.document.urlPassword, url, []) === '' &&
      applyCaptured<string>(primordials, primordials.document.urlHash, url, []) === '' &&
      applyCaptured<string>(primordials, primordials.document.urlPathname, url, []) ===
        `/backend-api/conversations/${conversationId}` &&
      hasExactOpaqueProbeQuery(primordials, url)
    );
  } catch {
    return false;
  }
}

function isHeaderPrototypeMember(name: string): boolean {
  return (
    name === 'constructor' ||
    name === '__defineGetter__' ||
    name === '__defineSetter__' ||
    name === 'hasOwnProperty' ||
    name === '__lookupGetter__' ||
    name === '__lookupSetter__' ||
    name === 'isPrototypeOf' ||
    name === 'propertyIsEnumerable' ||
    name === 'toString' ||
    name === 'valueOf' ||
    name === '__proto__' ||
    name === 'toLocaleString'
  );
}

type ReplayHeadersRejectReason =
  | 'shape'
  | 'prototype'
  | 'inherited'
  | 'symbol'
  | 'descriptor'
  | 'accessor'
  | 'limit'
  | 'entry'
  | 'unstable'
  | 'reflection';

type ReplayHeadersSnapshot =
  | { kind: 'accepted'; headers: Record<string, string> }
  | { kind: 'rejected'; reason: ReplayHeadersRejectReason };

/**
 * No public iterator, accessor or coercion participates in this snapshot.
 * Captured reflection can still execute Proxy traps: browsers have no reliable
 * isProxy check. Throwing/inconsistent reflection fails closed, but a forwarding
 * Proxy is indistinguishable from a record and its own work cannot be bounded.
 */
function snapshotReplayHeaders(
  primordials: PagePrimordials,
  value: unknown,
  native: boolean
): ReplayHeadersSnapshot {
  let rejectReason: ReplayHeadersRejectReason = 'reflection';
  const reject: (reason: ReplayHeadersRejectReason) => never = reason => {
    rejectReason = reason;
    throw INVALID_REPLAY_HEADERS;
  };
  try {
    const document = primordials.document;
    const snapshot = applyCaptured<Record<string, string>>(
      primordials,
      document.objectCreate,
      undefined,
      [null]
    );
    let count = 0;
    let total = 0;
    const add = (headerValue: unknown, name: unknown): void => {
      if (typeof name !== 'string' || typeof headerValue !== 'string') reject('entry');
      if (
        name.length === 0 ||
        name.length > REPLAY_HEADER_MAX_NAME ||
        headerValue.length > REPLAY_HEADER_MAX_VALUE ||
        ++count > REPLAY_HEADER_MAX_COUNT
      ) {
        reject('limit');
      }
      total += name.length + headerValue.length;
      if (total > REPLAY_HEADER_MAX_TOTAL) reject('limit');
      for (let index = 0; index < name.length; index += 1) {
        const code = applyCaptured<number>(primordials, document.stringCharCodeAt, name, [index]);
        // RFC token (ASCII tchar), not whitespace, separators or control bytes.
        if (
          !(
            (code >= 48 && code <= 57) ||
            (code >= 65 && code <= 90) ||
            (code >= 97 && code <= 122) ||
            code === 33 ||
            code === 35 ||
            code === 36 ||
            code === 37 ||
            code === 38 ||
            code === 39 ||
            code === 42 ||
            code === 43 ||
            code === 45 ||
            code === 46 ||
            code === 94 ||
            code === 95 ||
            code === 96 ||
            code === 124 ||
            code === 126
          )
        )
          reject('entry');
      }
      for (let index = 0; index < headerValue.length; index += 1) {
        const code = applyCaptured<number>(primordials, document.stringCharCodeAt, headerValue, [
          index,
        ]);
        // Request's HeadersInit requires ByteStrings. Reject C0/C1, not just CR/LF.
        if (code < 32 || (code >= 127 && code <= 159) || code > 255) {
          reject('entry');
        }
      }
      const lowerName = applyCaptured<string>(primordials, document.stringToLowerCase, name, []);
      if (
        lowerName === '__proto__' ||
        lowerName === 'prototype' ||
        lowerName === 'constructor' ||
        isHeaderPrototypeMember(name) ||
        applyCaptured<PropertyDescriptor | undefined>(
          primordials,
          document.objectGetOwnPropertyDescriptor,
          undefined,
          [snapshot, lowerName]
        ) !== undefined
      )
        reject('entry');
      // This object is ours and has no prototype, setters or public iterator.
      snapshot[lowerName] = headerValue;
    };
    if (native) {
      applyCaptured<void>(primordials, document.headersForEach, value, [add]);
      return { kind: 'accepted', headers: snapshot };
    }
    if (typeof value !== 'object' || value === null) return { kind: 'rejected', reason: 'shape' };
    const prototype = applyCaptured<unknown>(
      primordials,
      document.objectGetPrototypeOf,
      undefined,
      [value]
    );
    if (prototype !== null && prototype !== document.objectPrototype)
      return { kind: 'rejected', reason: 'prototype' };
    // Even the captured Object.prototype must remain rooted and unextended;
    // inherited header/iterator additions are not silently ignored.
    if (
      applyCaptured<unknown>(primordials, document.objectGetPrototypeOf, undefined, [
        document.objectPrototype,
      ]) !== null
    )
      return { kind: 'rejected', reason: 'inherited' };
    if (prototype !== null) {
      const inherited = applyCaptured<Array<string | symbol>>(
        primordials,
        document.reflectOwnKeys,
        undefined,
        [prototype]
      );
      if (inherited.length > 16) return { kind: 'rejected', reason: 'inherited' };
      for (let index = 0; index < inherited.length; index += 1) {
        const key = inherited[index];
        if (typeof key !== 'string' || !isHeaderPrototypeMember(key))
          return { kind: 'rejected', reason: 'inherited' };
        const descriptor = applyCaptured<PropertyDescriptor | undefined>(
          primordials,
          document.objectGetOwnPropertyDescriptor,
          undefined,
          [prototype, key]
        );
        if (descriptor === undefined || descriptor.enumerable !== false)
          return { kind: 'rejected', reason: 'inherited' };
      }
    }
    const keys = applyCaptured<Array<string | symbol>>(
      primordials,
      document.reflectOwnKeys,
      undefined,
      [value]
    );
    if (keys.length > REPLAY_HEADER_MAX_COUNT) return { kind: 'rejected', reason: 'limit' };
    for (let index = 0; index < keys.length; index += 1) {
      const name = keys[index];
      if (typeof name !== 'string') return { kind: 'rejected', reason: 'symbol' };
      const descriptor = applyCaptured<PropertyDescriptor | undefined>(
        primordials,
        document.objectGetOwnPropertyDescriptor,
        undefined,
        [value, name]
      );
      if (descriptor === undefined || descriptor.enumerable !== true)
        return { kind: 'rejected', reason: 'descriptor' };
      if (
        applyCaptured<PropertyDescriptor | undefined>(
          primordials,
          document.objectGetOwnPropertyDescriptor,
          undefined,
          [descriptor, 'value']
        ) === undefined
      )
        return { kind: 'rejected', reason: 'accessor' };
      add(descriptor.value, name);
    }
    // Detect disappearing/reordered keys and prototype changes without ever
    // comparing header values. A deliberately consistent Proxy remains opaque.
    const finalKeys = applyCaptured<Array<string | symbol>>(
      primordials,
      document.reflectOwnKeys,
      undefined,
      [value]
    );
    if (
      finalKeys.length !== keys.length ||
      applyCaptured<unknown>(primordials, document.objectGetPrototypeOf, undefined, [value]) !==
        prototype
    ) {
      return { kind: 'rejected', reason: 'unstable' };
    }
    for (let index = 0; index < keys.length; index += 1) {
      if (keys[index] !== finalKeys[index]) return { kind: 'rejected', reason: 'unstable' };
    }
    return { kind: 'accepted', headers: snapshot };
  } catch (error) {
    return {
      kind: 'rejected',
      reason: error === INVALID_REPLAY_HEADERS ? rejectReason : 'reflection',
    };
  }
}

/**
 * Own descriptors only. All compatibility expansion (not only plain headers)
 * is opt-in. Passive/active resolver modes accept absent/empty/signal-only init;
 * interpreter transport separately gates plain headers on native Requests/strings.
 */
function opaqueProbeInitKind(
  primordials: PagePrimordials,
  args: Parameters<typeof window.fetch>,
  allowPlainHeaders = false
): {
  kind: OpaqueProbeInitKind;
  credentialsOverride: 'include' | 'same-origin' | undefined;
  plainHeaders?: Record<string, string>;
} {
  const result: {
    kind: OpaqueProbeInitKind;
    credentialsOverride: 'include' | 'same-origin' | undefined;
  } = { kind: 'unsupported', credentialsOverride: undefined };
  if (args.length === 1) return { ...result, kind: 'absent' };
  if (args.length !== 2) return result;
  const init: unknown = args[1];
  if (init === undefined || init === null) return { ...result, kind: 'empty' };
  if (typeof init !== 'object') return result;
  try {
    const prototype = applyCaptured<unknown>(
      primordials,
      primordials.document.objectGetPrototypeOf,
      undefined,
      [init]
    );
    if (prototype !== null && prototype !== primordials.document.objectPrototype) {
      return { ...result, kind: 'unsupported-prototype' };
    }
    if (prototype === primordials.document.objectPrototype) {
      const getOwnPropertyDescriptor = primordials.document.objectGetOwnPropertyDescriptor;
      const objectPrototype = primordials.document.objectPrototype;
      if (
        applyCaptured<unknown>(primordials, primordials.document.objectGetPrototypeOf, undefined, [
          objectPrototype,
        ]) !== null
      ) {
        return { ...result, kind: 'unsupported-inherited' };
      }
      for (let index = 0; index < REQUEST_INIT_MEMBER_NAMES.length; index += 1) {
        const descriptor = applyCaptured<PropertyDescriptor | undefined>(
          primordials,
          getOwnPropertyDescriptor,
          undefined,
          [objectPrototype, REQUEST_INIT_MEMBER_NAMES[index]]
        );
        if (descriptor !== undefined) return { ...result, kind: 'unsupported-inherited' };
      }
    }
    const keys = applyCaptured<Array<string | symbol>>(
      primordials,
      primordials.document.reflectOwnKeys,
      undefined,
      [init]
    );
    if (keys.length > REQUEST_INIT_MEMBER_NAMES.length)
      return { ...result, kind: 'unsupported-member' };
    if (keys.length === 0) return { ...result, kind: 'empty' };
    if (!allowPlainHeaders && (keys.length !== 1 || keys[0] !== 'signal')) {
      return { ...result, kind: 'unsupported-member' };
    }
    let sensitiveKind:
      | 'security-sensitive-headers'
      | 'security-sensitive-headers-distinct'
      | 'security-sensitive-headers-native-distinct'
      | `security-sensitive-headers-unbranded-${ReplayHeadersRejectReason}`
      | 'security-sensitive-body'
      | 'security-sensitive-method'
      | 'security-sensitive-credentials'
      | 'security-sensitive-multiple'
      | undefined;
    let credentialsOverride: 'include' | 'same-origin' | undefined;
    let plainHeaders: Record<string, string> | undefined;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== 'string') return { ...result, kind: 'unsupported-symbol' };
      if (!isRequestInitMemberName(key)) return { ...result, kind: 'unsupported-member' };
      const descriptor = applyCaptured<PropertyDescriptor | undefined>(
        primordials,
        primordials.document.objectGetOwnPropertyDescriptor,
        undefined,
        [init, key]
      );
      // Inspect the descriptor's own shape too: Object.prototype may have been
      // poisoned, and accessor descriptors have no own data-value member.
      if (
        descriptor === undefined ||
        applyCaptured<PropertyDescriptor | undefined>(
          primordials,
          primordials.document.objectGetOwnPropertyDescriptor,
          undefined,
          [descriptor, 'value']
        ) === undefined
      ) {
        return {
          ...result,
          kind: descriptor === undefined ? 'unsupported-reflection' : 'unsupported-accessor',
        };
      }
      if (key !== 'headers' && key !== 'body' && key !== 'method' && key !== 'credentials') {
        // These standard RequestInit members cannot replace request headers,
        // credentials, method, or body. The page-owned source request must
        // still complete as 200 JSON before replay, so their values are neither
        // needed nor read here.
        continue;
      }
      const value: unknown = descriptor.value;
      if (
        value === undefined ||
        (key === 'body' && value === null) ||
        (key === 'method' && value === 'GET')
      ) {
        continue;
      }
      if (key === 'headers') {
        let inputHeaders: Headers | undefined;
        try {
          inputHeaders = applyCaptured<Headers>(
            primordials,
            primordials.document.requestHeaders,
            args[0],
            []
          );
        } catch {
          inputHeaders = undefined;
        }
        // Reusing the exact Headers object already owned by the input Request
        // is a redundant override. Identity is sufficient here; no header name
        // or value is read, iterated, copied, logged, or persisted.
        if (inputHeaders !== undefined && value === inputHeaders) continue;
        let nativeHeaders = false;
        try {
          applyCaptured<boolean>(primordials, primordials.document.headersHas, value, [
            'authorization',
          ]);
          nativeHeaders = true;
        } catch {
          nativeHeaders = false;
        }
        const snapshot =
          !nativeHeaders && allowPlainHeaders
            ? snapshotReplayHeaders(primordials, value, false)
            : undefined;
        if (snapshot?.kind === 'accepted') {
          plainHeaders = snapshot.headers;
          continue;
        }
        const headerRejectReason = snapshot?.kind === 'rejected' ? snapshot.reason : 'shape';
        sensitiveKind =
          sensitiveKind === undefined
            ? nativeHeaders
              ? 'security-sensitive-headers-native-distinct'
              : `security-sensitive-headers-unbranded-${headerRejectReason}`
            : 'security-sensitive-multiple';
        continue;
      }
      if (key === 'credentials' && (value === 'include' || value === 'same-origin')) {
        credentialsOverride = value;
        continue;
      }
      const nextKind =
        key === 'body'
          ? 'security-sensitive-body'
          : key === 'method'
            ? 'security-sensitive-method'
            : key === 'credentials'
              ? 'security-sensitive-credentials'
              : undefined;
      sensitiveKind = sensitiveKind === undefined ? nextKind : 'security-sensitive-multiple';
    }
    if (sensitiveKind !== undefined) return { ...result, kind: sensitiveKind };
    return {
      kind:
        plainHeaders !== undefined
          ? 'plain-headers'
          : keys.length === 1 && keys[0] === 'signal'
            ? 'signal-only'
            : 'compatible',
      credentialsOverride,
      plainHeaders,
    };
  } catch {
    return { ...result, kind: 'unsupported-reflection' };
  }
}

function opaqueProbeCandidate(
  primordials: PagePrimordials,
  args: Parameters<typeof window.fetch>,
  conversationId: string,
  allowPlainHeaders = false
): OpaqueProbeCandidate | undefined {
  const input = args[0];
  const url = opaqueProbeUrl(primordials, input);
  if (url === undefined) return undefined;
  const path = applyCaptured<string>(primordials, primordials.document.urlPathname, url, []);
  if (path !== `/backend-api/conversations/${conversationId}`) return undefined;

  let exactTarget =
    applyCaptured<string>(primordials, primordials.document.urlOrigin, url, []) ===
      CHATGPT_ORIGIN &&
    applyCaptured<string>(primordials, primordials.document.urlUsername, url, []) === '' &&
    applyCaptured<string>(primordials, primordials.document.urlPassword, url, []) === '' &&
    applyCaptured<string>(primordials, primordials.document.urlHash, url, []) === '' &&
    hasExactOpaqueProbeQuery(primordials, url);
  const init = opaqueProbeInitKind(primordials, args, allowPlainHeaders);
  // Init/header descriptor reflection can run Proxy traps that change <base>.
  // Recheck only the URL, not the already-snapshotted page-owned init/headers.
  if (typeof input === 'string' && exactTarget) {
    const verifiedUrl = opaqueProbeUrl(primordials, input);
    exactTarget =
      verifiedUrl !== undefined &&
      applyCaptured<string>(primordials, primordials.document.urlHref, verifiedUrl, []) ===
        applyCaptured<string>(primordials, primordials.document.urlHref, url, []);
  }
  const initKind = init.kind;
  const structurallySafeInit =
    initKind === 'absent' ||
    initKind === 'empty' ||
    initKind === 'signal-only' ||
    initKind === 'compatible' ||
    initKind === 'plain-headers';
  let sourceIsNativeRequest = false;
  let methodAccepted = false;
  let sourceClone: Request | undefined;
  let sourceCredentials: RequestCredentials | undefined;
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
      methodAccepted = method === 'GET';
      if (init.plainHeaders !== undefined) {
        sourceCredentials = applyCaptured<RequestCredentials>(
          primordials,
          primordials.document.requestCredentials,
          input,
          []
        );
      }
      if (methodAccepted && init.plainHeaders === undefined) {
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
  // Only primitive strings can use the non-Request compatibility path. Even a
  // branded URL may have a page-owned toString/Symbol.toPrimitive that native
  // fetch coerces to a different target than our captured URL.href getter.
  // GET is the default; inspection rejected any non-GET init method.
  if (typeof input === 'string' && exactTarget && init.plainHeaders !== undefined)
    methodAccepted = true;
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
    credentialsOverride: init.credentialsOverride,
    sourceClone,
    sourceCredentials,
    plainHeaders: init.plainHeaders,
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
  candidate: OpaqueProbeCandidate,
  conversationId: string
): OpaqueProbeResult | undefined {
  const base = {
    observedTargetRequest: candidate.observedTargetRequest,
    sourceIsNativeRequest: candidate.sourceIsNativeRequest,
    initAbsent: candidate.initAbsent,
    exactTarget: candidate.exactTarget,
  };
  if (candidate.initKind === 'plain-headers') {
    const prepared = prepareOpaqueReplayRequest(primordials, candidate, conversationId);
    if (typeof prepared === 'string') {
      return opaqueProbeResult(
        prepared === 'authorization-absent' ||
          prepared === 'credentials-rejected' ||
          prepared === 'target-mismatch'
          ? prepared
          : 'probe-failed',
        base
      );
    }
    // No dispatch: the metadata probe only validates native construction.
    applyCaptured<void>(
      primordials,
      primordials.document.abortControllerAbort,
      prepared.controller,
      []
    );
    return undefined;
  }
  if (
    applyCaptured<number>(primordials, primordials.document.stringIndexOf, candidate.initKind, [
      'security-sensitive',
    ]) === 0
  ) {
    return opaqueProbeResult(`init-${candidate.initKind}` as OpaqueProbeOutcome, base);
  }
  if (
    applyCaptured<number>(primordials, primordials.document.stringIndexOf, candidate.initKind, [
      'unsupported',
    ]) === 0
  ) {
    return opaqueProbeResult(`init-${candidate.initKind}` as OpaqueProbeOutcome, base);
  }
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
    const credentials =
      candidate.credentialsOverride ??
      applyCaptured<unknown>(primordials, primordials.document.requestCredentials, clone, []);
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
  candidate: OpaqueProbeCandidate,
  conversationId: string
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
            if (!isExactOpaqueSourceResponse(state.primordials, response, conversationId)) {
              finishOpaqueProbe(pageWindow, state, opaqueProbeResult('target-mismatch', base));
              return;
            }
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
                    : candidate.initKind === 'plain-headers'
                      ? 'eligible-init-plain-headers'
                      : candidate.initKind === 'compatible'
                        ? 'eligible-init-compatible'
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
    let preparing = false;
    const wrappedFetch = function (
      this: PageWindow,
      ...args: Parameters<typeof pageWindow.fetch>
    ): ReturnType<typeof pageWindow.fetch> {
      if (preparing) return applyCaptured(state.primordials, state.originalFetch, this, args);
      preparing = true;
      let candidate: OpaqueProbeCandidate | undefined;
      let preliminary: OpaqueProbeResult | undefined;
      try {
        candidate =
          !state.settled && !state.claimed
            ? opaqueProbeCandidate(state.primordials, args, target.conversationId, true)
            : undefined;
        if (candidate !== undefined) state.claimed = true;
        preliminary =
          candidate === undefined
            ? undefined
            : preliminaryOpaqueProbeResult(state.primordials, candidate, target.conversationId);
        if (preliminary !== undefined) finishOpaqueProbe(pageWindow, state, preliminary);
      } catch {
        if (!state.settled) state.claimed = false;
        candidate = undefined;
        preliminary = undefined;
      } finally {
        preparing = false;
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
        observeOpaqueProbeResponse(
          pageWindow,
          state,
          responsePromise,
          candidate,
          target.conversationId
        );
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
  | 'init-security-sensitive-headers'
  | 'init-security-sensitive-headers-distinct'
  | 'init-security-sensitive-headers-native-distinct'
  | `init-security-sensitive-headers-unbranded-${ReplayHeadersRejectReason}`
  | 'init-security-sensitive-body'
  | 'init-security-sensitive-method'
  | 'init-security-sensitive-credentials'
  | 'init-security-sensitive-multiple'
  | 'init-unsupported'
  | 'init-unsupported-prototype'
  | 'init-unsupported-inherited'
  | 'init-unsupported-symbol'
  | 'init-unsupported-member'
  | 'init-unsupported-accessor'
  | 'init-unsupported-reflection'
  | 'target-mismatch'
  | 'document-target-mismatch'
  | 'source-request-target-mismatch'
  | 'source-request-method-mismatch'
  | 'source-response-target-mismatch'
  | 'clone-failed'
  | 'authorization-absent'
  | 'credentials-rejected'
  | 'source-rejected'
  | 'source-http-error'
  | 'source-non-json'
  | 'source-response-timeout'
  | 'replay-construction-failed'
  | 'replay-dispatch-failed'
  | 'replay-rejected'
  | 'replay-http-error'
  | 'replay-non-json'
  | 'replay-response-timeout'
  | 'response-processing-failed'
  | 'payload-too-large';

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
  armedHref: string;
  target: MarkerTarget;
  wrappedFetch: typeof window.fetch | undefined;
  timeoutId: ReturnType<typeof window.setTimeout> | undefined;
  abortController: AbortController | undefined;
  prebuiltRequest: Request | undefined;
  settled: boolean;
  claimed: boolean;
  singularDispatchCount: 0 | 1;
  result: OpaqueReplayHookResult;
};

type OpaqueReplayPreparation = {
  headers: Headers;
  credentials: RequestCredentials;
};

type PrebuiltOpaqueReplay = { request: Request; controller: AbortController };

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
    document.objectCreate !== undefined &&
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

function opaqueReplayTargetStillExact(
  pageWindow: PageWindow,
  state: OpaqueReplayPageState
): boolean {
  if (state.settled) return false;
  try {
    const currentHref = pageWindow.location.href;
    if (currentHref === state.armedHref) return true;
    const URLConstructor = state.primordials.document.URL;
    if (URLConstructor === undefined || typeof currentHref !== 'string') throw new Error();
    const current = new URLConstructor(currentHref);
    const armed = new URLConstructor(state.armedHref);
    const currentOrigin = applyCaptured<string>(
      state.primordials,
      state.primordials.document.urlOrigin,
      current,
      []
    );
    const currentUsername = applyCaptured<string>(
      state.primordials,
      state.primordials.document.urlUsername,
      current,
      []
    );
    const currentPassword = applyCaptured<string>(
      state.primordials,
      state.primordials.document.urlPassword,
      current,
      []
    );
    const currentSearch = applyCaptured<string>(
      state.primordials,
      state.primordials.document.urlSearch,
      current,
      []
    );
    const currentHash = applyCaptured<string>(
      state.primordials,
      state.primordials.document.urlHash,
      current,
      []
    );
    const armedHash = applyCaptured<string>(
      state.primordials,
      state.primordials.document.urlHash,
      armed,
      []
    );
    const currentPath = applyCaptured<string>(
      state.primordials,
      state.primordials.document.urlPathname,
      current,
      []
    );
    if (
      currentOrigin === CHATGPT_ORIGIN &&
      currentUsername === '' &&
      currentPassword === '' &&
      currentSearch === '' &&
      currentHash === armedHash &&
      opaqueReplayRouteFamily(state.primordials, currentPath, state.target.conversationId) ===
        state.target.routeFamily
    ) {
      return true;
    }
  } catch {
    // An unreadable href cannot authorize this old document's replay.
  }
  finishOpaqueReplay(pageWindow, state, opaqueReplayError(state, 'document-target-mismatch'));
  return false;
}

function opaqueReplayRouteFamily(
  primordials: PagePrimordials,
  pathname: string,
  conversationId: string
): MarkerTarget['routeFamily'] | undefined {
  const exec = primordials.document.regExpExec;
  const standard = applyCaptured<RegExpExecArray | null>(
    primordials,
    exec,
    STANDARD_CONVERSATION_ROUTE_PATTERN,
    [pathname]
  );
  if (standard?.[1] === conversationId) return 'standard';
  const owner = applyCaptured<RegExpExecArray | null>(
    primordials,
    exec,
    OWNER_CONVERSATION_ROUTE_PATTERN,
    [pathname]
  );
  if (owner?.[2] !== conversationId || typeof owner[1] !== 'string') return undefined;
  const slug = applyCaptured<string>(
    primordials,
    primordials.document.stringToLowerCase,
    owner[1],
    []
  );
  return applyCaptured<number>(primordials, primordials.document.stringIndexOf, slug, ['g-p-']) ===
    0
    ? 'project'
    : 'custom-gpt';
}

function opaqueReplayTimeout(state: OpaqueReplayPageState): OpaqueReplayHookResult {
  // These are observer phases, not proof about all page network activity.
  // In particular, target-not-observed means no eligible source was claimed.
  const code =
    state.singularDispatchCount === 1
      ? 'replay-response-timeout'
      : state.claimed
        ? 'source-response-timeout'
        : 'target-not-observed';
  return opaqueReplayError(state, code);
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
  state.prebuiltRequest = undefined;
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
  if (
    applyCaptured<number>(primordials, primordials.document.stringIndexOf, candidate.initKind, [
      'security-sensitive',
    ]) === 0
  ) {
    return `init-${candidate.initKind}` as OpaqueReplayErrorCode;
  }
  if (
    applyCaptured<number>(primordials, primordials.document.stringIndexOf, candidate.initKind, [
      'unsupported',
    ]) === 0
  ) {
    return `init-${candidate.initKind}` as OpaqueReplayErrorCode;
  }
  if (!candidate.exactTarget) return 'source-request-target-mismatch';
  if (!candidate.methodAccepted) return 'source-request-method-mismatch';
  if (!candidate.sourceIsNativeRequest) return 'source-not-native-request';
  if (candidate.cloneFailed || candidate.sourceClone === undefined) return 'clone-failed';
  try {
    const credentials =
      candidate.credentialsOverride ??
      applyCaptured<unknown>(
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
 * Replay-only preparation. Passive/active resolvers retain prepareOpaqueReplay's
 * strict native-Request contract. No headers escape this MAIN-world work;
 * only a native Request and its fresh abort controller survive preparation.
 */
function prepareOpaqueReplayRequest(
  primordials: PagePrimordials,
  candidate: OpaqueProbeCandidate,
  conversationId: string
): PrebuiltOpaqueReplay | OpaqueReplayErrorCode {
  let controller: AbortController | undefined;
  try {
    let headers: Record<string, string> | undefined;
    let credentials: RequestCredentials;
    if (candidate.initKind === 'plain-headers') {
      if (!candidate.exactTarget) return 'source-request-target-mismatch';
      if (!candidate.methodAccepted) return 'source-request-method-mismatch';
      const effective =
        candidate.credentialsOverride ??
        (candidate.sourceIsNativeRequest ? candidate.sourceCredentials : 'same-origin');
      if (effective !== 'include' && effective !== 'same-origin') return 'credentials-rejected';
      credentials = effective;
      headers = candidate.plainHeaders;
    } else {
      const native = prepareOpaqueReplay(primordials, candidate);
      if (typeof native === 'string') return native;
      credentials = native.credentials;
      // The genuine native forEach bypasses a page-owned Headers iterator.
      const snapshot = snapshotReplayHeaders(primordials, native.headers, true);
      if (snapshot.kind === 'accepted') headers = snapshot.headers;
    }
    if (headers === undefined) return 'init-security-sensitive-headers';
    const document = primordials.document;
    const RequestConstructor = document.requestConstructor;
    const AbortControllerConstructor = document.abortControllerConstructor;
    if (RequestConstructor === undefined || AbortControllerConstructor === undefined) {
      return 'replay-construction-failed';
    }
    controller = new AbortControllerConstructor();
    const init = applyCaptured<RequestInit>(primordials, document.objectCreate, undefined, [null]);
    init.method = 'GET';
    init.headers = headers;
    init.credentials = credentials;
    init.redirect = 'error';
    init.cache = 'no-store';
    init.signal = applyCaptured<AbortSignal>(
      primordials,
      document.abortControllerSignal,
      controller,
      []
    );
    const request = new RequestConstructor(
      `${CHATGPT_ORIGIN}/backend-api/conversation/${conversationId}`,
      init
    );
    const nativeHeaders = applyCaptured<Headers>(primordials, document.requestHeaders, request, []);
    if (
      !applyCaptured<boolean>(primordials, document.headersHas, nativeHeaders, ['authorization'])
    ) {
      applyCaptured<void>(primordials, document.abortControllerAbort, controller, []);
      return 'authorization-absent';
    }
    return { request, controller };
  } catch {
    if (controller !== undefined) {
      try {
        applyCaptured<void>(primordials, primordials.document.abortControllerAbort, controller, []);
      } catch {
        // No network occurred; construction failure remains value-free.
      }
    }
    return 'replay-construction-failed';
  } finally {
    candidate.plainHeaders = undefined;
    candidate.sourceClone = undefined;
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
  if (!opaqueReplayTargetStillExact(pageWindow, state)) return;
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
    const bytes = await readBoundedClone(state.primordials, clone, INLINE_CAPTURE_MAX_BYTES);
    if (!opaqueReplayTargetStillExact(pageWindow, state)) return;
    const sha256 = await sha256FromBytes(state.primordials, bytes);
    if (!opaqueReplayTargetStillExact(pageWindow, state)) return;
    const bodyBase64 = base64FromBytes(state.primordials, bytes);
    if (!opaqueReplayTargetStillExact(pageWindow, state)) return;
    finishOpaqueReplay(pageWindow, state, {
      kind: 'captured',
      conversationId,
      capture: {
        bodyBase64,
        byteLength: bytes.byteLength,
        sha256,
        mediaType,
      },
      singularDispatchCount: 1,
    });
  } catch (error) {
    if (!opaqueReplayTargetStillExact(pageWindow, state)) return;
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
  target: MarkerTarget
): void {
  if (state.settled || state.singularDispatchCount !== 0) return;
  const replayRequest = state.prebuiltRequest;
  if (replayRequest === undefined) return;
  if (!opaqueReplayTargetStillExact(pageWindow, state)) return;
  state.prebuiltRequest = undefined;
  // Construction already happened before the unchanged page call. Never
  // re-read headers or RequestInit (or construct another Request) after it.
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
}

function observeOpaqueReplaySourceResponse(
  pageWindow: PageWindow,
  state: OpaqueReplayPageState,
  responsePromise: Promise<Response>,
  target: MarkerTarget
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
            if (!isExactOpaqueSourceResponse(state.primordials, response, target.conversationId)) {
              finishOpaqueReplay(
                pageWindow,
                state,
                opaqueReplayError(state, 'source-response-target-mismatch')
              );
              return;
            }
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
            dispatchOpaqueReplay(pageWindow, state, target);
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
  let armedHref: string;
  try {
    armedHref = pageWindow.location.href;
  } catch {
    return { kind: 'error', code: 'hook-state-failed' };
  }
  const state: OpaqueReplayPageState = {
    primordials,
    originalFetch,
    armedHref,
    target,
    wrappedFetch: undefined,
    timeoutId: undefined,
    abortController: undefined,
    prebuiltRequest: undefined,
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
    let preparing = false;
    const wrappedFetch = function (
      this: PageWindow,
      ...args: Parameters<typeof pageWindow.fetch>
    ): ReturnType<typeof pageWindow.fetch> {
      // Reflection on an undetectable Proxy may re-enter fetch. That page call
      // still passes through unchanged, but cannot claim a second preparation.
      if (preparing) return applyCaptured(state.primordials, state.originalFetch, this, args);
      preparing = true;
      let candidate: OpaqueProbeCandidate | undefined;
      let preparation: PrebuiltOpaqueReplay | OpaqueReplayErrorCode | undefined;
      try {
        candidate =
          !state.settled && !state.claimed
            ? opaqueProbeCandidate(state.primordials, args, target.conversationId, true)
            : undefined;
        if (candidate !== undefined) {
          state.claimed = true;
          preparation = prepareOpaqueReplayRequest(
            state.primordials,
            candidate,
            target.conversationId
          );
          if (typeof preparation === 'string') {
            finishOpaqueReplay(pageWindow, state, opaqueReplayError(state, preparation));
          } else {
            state.abortController = preparation.controller;
            state.prebuiltRequest = preparation.request;
          }
        }
      } catch {
        // The original page call must still happen even when a hostile input
        // defeats the observer/classifier.
        if (!state.settled) state.claimed = false;
        candidate = undefined;
        preparation = undefined;
      } finally {
        preparing = false;
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
        observeOpaqueReplaySourceResponse(pageWindow, state, responsePromise, target);
      }
      return responsePromise;
    } as typeof pageWindow.fetch;
    state.wrappedFetch = wrappedFetch;
    pageWindow.fetch = wrappedFetch;
    state.timeoutId = applyCaptured<ReturnType<typeof pageWindow.setTimeout>>(
      primordials,
      primordials.setTimeout,
      pageWindow,
      [() => finishOpaqueReplay(pageWindow, state, opaqueReplayTimeout(state)), DEFAULT_TIMEOUT_MS]
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
  | {
      state:
        | 'http-error'
        | 'fetch-rejected'
        | 'response-processing-rejected'
        | 'non-json'
        | 'oversized'
        | 'timed-out'
        | 'not-dispatched';
    }
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
  preparation: ResolverTransportPreparation | undefined;
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
  // Best-effort release; no sensitive source transport remains in published state.
  state.preparation = undefined;
  state.providerFileIds = undefined;
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
  if (state.settled) return;
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
  if (state.dispatchCount > 0) {
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
  if (state.dispatchCount > 0) {
    activeResolverComplete(pageWindow, state, target);
  } else {
    finishActiveResolver(pageWindow, state, { kind: 'error', code: 'resolver-result-timeout' });
  }
}

function activeResolverRequestUrl(target: MarkerTarget, providerFileId: string): string {
  return (
    `${CHATGPT_ORIGIN}/backend-api/files/download/${providerFileId}` +
    `?conversation_id=${target.conversationId}` +
    '&inline=false&download_intent=false&include_library_file_state=true'
  );
}

function activeResolverContainsId(providerFileIds: readonly string[], candidate: string): boolean {
  for (let index = 0; index < providerFileIds.length; index += 1) {
    if (providerFileIds[index] === candidate) return true;
  }
  return false;
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
  response: Response,
  controller: AbortController
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
    if (state.settled || state.abortController !== controller)
      return { state: 'response-processing-rejected' };
    const sha256 = await sha256FromBytes(state.primordials, bytes);
    if (state.settled || state.abortController !== controller)
      return { state: 'response-processing-rejected' };
    return {
      state: 'observed',
      capture: {
        bodyBase64: base64FromBytes(state.primordials, bytes),
        byteLength: bytes.byteLength,
        sha256,
        mediaType,
      },
    };
  } catch (error) {
    return {
      state: error === PAYLOAD_TOO_LARGE ? 'oversized' : 'response-processing-rejected',
    };
  }
}

function completeActiveResolverItem(
  pageWindow: PageWindow,
  state: ActiveResolverPageState,
  target: MarkerTarget,
  controller: AbortController,
  outcome: ActiveResolverOutcome
): void {
  // One owner across fetch, body, and hash. Late work cannot mutate a terminal
  // result or clear a newer item's controller/timer.
  if (state.settled || state.abortController !== controller) return;
  clearActiveResolverTimer(pageWindow, state, 'perIdTimeoutId');
  abortActiveResolver(state);
  appendActiveResolverOutcome(state, outcome);
  dispatchActiveResolverQueue(pageWindow, state, target);
}

function observeActiveResolverItem(
  pageWindow: PageWindow,
  state: ActiveResolverPageState,
  target: MarkerTarget,
  controller: AbortController,
  responsePromise: Promise<Response>
): void {
  try {
    const observation = applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      responsePromise,
      [
        async (response: Response) => {
          if (state.settled || state.abortController !== controller) return;
          const outcome = await captureActiveResolverResponse(state, response, controller);
          completeActiveResolverItem(pageWindow, state, target, controller, outcome);
        },
        () =>
          completeActiveResolverItem(pageWindow, state, target, controller, {
            state: 'fetch-rejected',
          }),
      ]
    );
    void applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      observation,
      [
        () => undefined,
        () =>
          completeActiveResolverItem(pageWindow, state, target, controller, {
            state: 'response-processing-rejected',
          }),
      ]
    );
  } catch {
    completeActiveResolverItem(pageWindow, state, target, controller, {
      state: 'fetch-rejected',
    });
  }
}

function dispatchActiveResolverQueue(
  pageWindow: PageWindow,
  state: ActiveResolverPageState,
  target: MarkerTarget
): void {
  const document = state.primordials.document;
  const AbortControllerConstructor = document.abortControllerConstructor;
  const RequestConstructor = document.requestConstructor;
  if (
    state.settled ||
    state.providerFileIds === undefined ||
    state.preparation === undefined ||
    AbortControllerConstructor === undefined ||
    RequestConstructor === undefined
  ) {
    if (!state.settled) activeResolverSourceFailure(pageWindow, state, target, 'hook-state-failed');
    return;
  }
  if (state.outcomes.length === state.providerFileIds.length) {
    activeResolverComplete(pageWindow, state, target);
    return;
  }
  if (!activeResolverHrefStillExact(pageWindow, state)) {
    activeResolverSourceFailure(pageWindow, state, target, 'source-not-eligible');
    return;
  }
  try {
    const controller = new AbortControllerConstructor();
    state.abortController = controller;
    const init = applyCaptured<RequestInit>(state.primordials, document.objectCreate, undefined, [
      null,
    ]);
    init.method = 'GET';
    init.headers = state.preparation.headers;
    init.credentials = state.preparation.credentials;
    init.redirect = 'error';
    init.cache = 'no-store';
    init.signal = applyCaptured<AbortSignal>(
      state.primordials,
      document.abortControllerSignal,
      controller,
      []
    );
    const request = new RequestConstructor(
      activeResolverRequestUrl(target, state.providerFileIds[state.outcomes.length]),
      init
    );
    const headers = applyCaptured<Headers>(state.primordials, document.requestHeaders, request, []);
    if (!applyCaptured<boolean>(state.primordials, document.headersHas, headers, ['authorization']))
      throw PRIMORDIAL_UNAVAILABLE;
    if (!activeResolverHrefStillExact(pageWindow, state)) {
      activeResolverSourceFailure(pageWindow, state, target, 'source-not-eligible');
      return;
    }
    state.perIdTimeoutId = applyCaptured<ReturnType<typeof pageWindow.setTimeout>>(
      state.primordials,
      state.primordials.setTimeout,
      pageWindow,
      [
        () =>
          completeActiveResolverItem(pageWindow, state, target, controller, {
            state: 'timed-out',
          }),
        DEFAULT_ACTIVE_RESOLVER_PER_ID_TIMEOUT_MS,
      ]
    );
    state.dispatchCount += 1;
    try {
      const responsePromise = applyCaptured<Promise<Response>>(
        state.primordials,
        state.originalFetch,
        pageWindow,
        [request]
      );
      observeActiveResolverItem(pageWindow, state, target, controller, responsePromise);
    } catch {
      completeActiveResolverItem(pageWindow, state, target, controller, {
        state: 'fetch-rejected',
      });
    }
  } catch {
    activeResolverSourceFailure(pageWindow, state, target, 'hook-state-failed');
  }
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
    activeResolverSourceFailure(pageWindow, state, target, 'source-not-eligible');
    return;
  }
  state.dispatchStarted = true;
  dispatchActiveResolverQueue(pageWindow, state, target);
}

function observeActiveResolverSourceResponse(
  pageWindow: PageWindow,
  state: ActiveResolverPageState,
  responsePromise: Promise<Response>,
  target: MarkerTarget
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
            if (!isExactOpaqueSourceResponse(state.primordials, response, target.conversationId)) {
              activeResolverSourceFailure(pageWindow, state, target, 'source-not-eligible');
              return;
            }
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
      get: () => {
        if (!state.settled && !activeResolverHrefStillExact(pageWindow, state)) {
          activeResolverSourceFailure(pageWindow, state, target, 'source-not-eligible');
        }
        return snapshotActiveResolverResult(state.result);
      },
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
    let preparing = false;
    const wrappedFetch = function (
      this: PageWindow,
      ...args: Parameters<typeof pageWindow.fetch>
    ): ReturnType<typeof pageWindow.fetch> {
      if (preparing) return applyCaptured(state.primordials, state.originalFetch, this, args);
      preparing = true;
      let candidate: OpaqueProbeCandidate | undefined;
      try {
        candidate =
          !state.settled && !state.claimed
            ? opaqueProbeCandidate(state.primordials, args, target.conversationId, true)
            : undefined;
        if (candidate !== undefined) {
          state.claimed = true;
          state.preparation = prepareResolverTransport(
            state.primordials,
            candidate,
            typeof args[0] === 'string'
          );
          if (state.preparation === undefined) {
            activeResolverSourceFailure(pageWindow, state, target, 'source-not-eligible');
          }
        }
      } catch {
        if (candidate !== undefined && !state.settled)
          activeResolverSourceFailure(pageWindow, state, target, 'source-not-eligible');
        candidate = undefined;
      } finally {
        preparing = false;
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
      if (candidate !== undefined && state.preparation !== undefined && !state.settled) {
        observeActiveResolverSourceResponse(pageWindow, state, responsePromise, target);
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

/*
 * Interpreter resolver transport. This is deliberately separate from the
 * file-ID active resolver: it has a distinct marker, state/command keys,
 * candidate grammar, endpoint, and response contract. Only the closure-local
 * source Request Headers/credentials preparation is shared.
 */
type InterpreterResolverOutcome =
  | {
      state:
        | 'fetch-rejected'
        | 'response-processing-rejected'
        | 'non-json'
        | 'oversized'
        | 'timed-out'
        | 'not-dispatched';
    }
  | { state: 'http-error'; httpStatus?: number }
  | {
      state: 'observed';
      capture: { bodyBase64: string; byteLength: number; sha256: string; mediaType: string };
    };

type InterpreterResolverHookResult =
  | { kind: 'ready' }
  | {
      kind: 'complete';
      conversationId: string;
      requestedCount: number;
      dispatchCount: number;
      outcomes: InterpreterResolverOutcome[];
    }
  | {
      kind: 'error';
      code:
        | 'source-not-eligible'
        | 'source-rejected'
        | 'source-http-error'
        | 'source-non-json'
        | 'interpreter-result-timeout'
        | 'interpreter-result-invalid';
    };

type InterpreterResolverCandidate = {
  assetId: string;
  messageId: string;
  sandboxPath: string;
};

// Closure-private, extension-owned transport only: never retain native Headers
// or publish this bounded, null-prototype snapshot through the result getter.
type ResolverTransportPreparation = {
  headers: Record<string, string>;
  credentials: 'include' | 'same-origin';
};

function prepareResolverTransport(
  primordials: PagePrimordials,
  candidate: OpaqueProbeCandidate,
  primitiveStringInput: boolean
): ResolverTransportPreparation | undefined {
  try {
    if (!candidate.exactTarget || !candidate.methodAccepted) return undefined;
    let headers: Record<string, string> | undefined;
    let credentials: RequestCredentials | undefined;
    if (candidate.initKind === 'plain-headers') {
      if (!primitiveStringInput && !candidate.sourceIsNativeRequest) return undefined;
      headers = candidate.plainHeaders;
      credentials =
        candidate.credentialsOverride ??
        (candidate.sourceIsNativeRequest ? candidate.sourceCredentials : 'same-origin');
    } else {
      // Classification's compatibility flag must not expand the old native
      // path (including redundant Headers/credentials/cache overrides).
      if (
        candidate.initKind !== 'absent' &&
        candidate.initKind !== 'empty' &&
        candidate.initKind !== 'signal-only'
      ) {
        return undefined;
      }
      const native = prepareOpaqueReplay(primordials, candidate);
      if (typeof native === 'string') return undefined;
      credentials = native.credentials;
      const snapshot = snapshotReplayHeaders(primordials, native.headers, true);
      if (snapshot.kind === 'accepted') headers = snapshot.headers;
    }
    if (
      headers === undefined ||
      (credentials !== 'include' && credentials !== 'same-origin') ||
      applyCaptured<PropertyDescriptor | undefined>(
        primordials,
        primordials.document.objectGetOwnPropertyDescriptor,
        undefined,
        [headers, 'authorization']
      ) === undefined
    ) {
      return undefined;
    }
    // Authorization is membership only; never inspect its normalized value.
    return { headers, credentials };
  } finally {
    candidate.plainHeaders = undefined;
    candidate.sourceClone = undefined;
  }
}

type InterpreterResolverPageState = {
  primordials: PagePrimordials;
  originalFetch: typeof window.fetch;
  armedHref: string;
  wrappedFetch: typeof window.fetch | undefined;
  globalTimeoutId: ReturnType<typeof window.setTimeout> | undefined;
  perItemTimeoutId: ReturnType<typeof window.setTimeout> | undefined;
  abortController: AbortController | undefined;
  settled: boolean;
  claimed: boolean;
  commandAccepted: boolean;
  sourceReady: boolean;
  dispatchStarted: boolean;
  preparation: ResolverTransportPreparation | undefined;
  candidates: InterpreterResolverCandidate[] | undefined;
  outcomes: InterpreterResolverOutcome[];
  dispatchCount: number;
  result: InterpreterResolverHookResult;
};

function interpreterResolverStateKeyFor(nonce: string): string {
  return `__liskaChatGptInterpreterResolver_${nonce}`;
}

function interpreterResolverCommandKeyFor(nonce: string): string {
  return `__liskaChatGptInterpreterResolverCommand_${nonce}`;
}

function hasInterpreterResolverArmingPrimordials(primordials: PagePrimordials): boolean {
  const document = primordials.document;
  return (
    hasActiveResolverArmingPrimordials(primordials) &&
    document.headersForEach !== undefined &&
    document.URLSearchParams !== undefined &&
    document.urlSearchParamsSet !== undefined &&
    document.urlSearchParamsToString !== undefined
  );
}

function snapshotInterpreterResolverResult(
  result: InterpreterResolverHookResult,
  primordials: PagePrimordials
): InterpreterResolverHookResult {
  if (result.kind === 'ready') return { kind: 'ready' };
  if (result.kind === 'error') return { kind: 'error', code: result.code };
  const outcomes: InterpreterResolverOutcome[] = [];
  for (let index = 0; index < result.outcomes.length; index += 1) {
    const outcome = result.outcomes[index];
    const snapshot: InterpreterResolverOutcome =
      outcome.state === 'observed'
        ? {
            state: 'observed',
            capture: {
              bodyBase64: outcome.capture.bodyBase64,
              byteLength: outcome.capture.byteLength,
              sha256: outcome.capture.sha256,
              mediaType: outcome.capture.mediaType,
            },
          }
        : outcome.state === 'http-error' && isCapturedHttpErrorStatus(outcome.httpStatus)
          ? { state: 'http-error', httpStatus: outcome.httpStatus }
          : { state: outcome.state };
    applyCaptured<void>(primordials, primordials.document.arrayPush, outcomes, [snapshot]);
  }
  return {
    kind: 'complete',
    conversationId: result.conversationId,
    requestedCount: result.requestedCount,
    dispatchCount: result.dispatchCount,
    outcomes,
  };
}

function appendInterpreterResolverOutcome(
  state: InterpreterResolverPageState,
  outcome: InterpreterResolverOutcome
): void {
  applyCaptured<void>(state.primordials, state.primordials.document.arrayPush, state.outcomes, [
    outcome,
  ]);
}

function abortInterpreterResolver(state: InterpreterResolverPageState): void {
  if (state.abortController === undefined) return;
  try {
    applyCaptured<void>(
      state.primordials,
      state.primordials.document.abortControllerAbort,
      state.abortController,
      []
    );
  } catch {
    // A terminal result remains authoritative if page-visible abort fails.
  }
  state.abortController = undefined;
}

function clearInterpreterResolverTimer(
  pageWindow: PageWindow,
  state: InterpreterResolverPageState,
  field: 'globalTimeoutId' | 'perItemTimeoutId'
): void {
  const timeoutId = state[field];
  if (timeoutId === undefined) return;
  try {
    applyCaptured<void>(state.primordials, state.primordials.clearTimeout, pageWindow, [timeoutId]);
  } catch {
    // Timer cleanup cannot change a terminal state.
  }
  state[field] = undefined;
}

function finishInterpreterResolver(
  pageWindow: PageWindow,
  state: InterpreterResolverPageState,
  result: InterpreterResolverHookResult
): void {
  if (state.settled) return;
  state.settled = true;
  state.result = result;
  // Best-effort reference release, not a claim of secure memory erasure.
  state.preparation = undefined;
  state.candidates = undefined;
  clearInterpreterResolverTimer(pageWindow, state, 'globalTimeoutId');
  clearInterpreterResolverTimer(pageWindow, state, 'perItemTimeoutId');
  abortInterpreterResolver(state);
  try {
    if (state.wrappedFetch !== undefined && pageWindow.fetch === state.wrappedFetch) {
      pageWindow.fetch = state.originalFetch;
    }
  } catch {
    // Never replace a later page wrapper.
  }
}

function interpreterResolverComplete(
  pageWindow: PageWindow,
  state: InterpreterResolverPageState,
  target: MarkerTarget
): void {
  if (state.settled) return;
  const requestedCount = state.candidates?.length ?? 0;
  if (state.outcomes.length < state.dispatchCount) {
    appendInterpreterResolverOutcome(state, { state: 'timed-out' });
  }
  while (state.outcomes.length < requestedCount) {
    appendInterpreterResolverOutcome(state, { state: 'not-dispatched' });
  }
  finishInterpreterResolver(pageWindow, state, {
    kind: 'complete',
    conversationId: target.conversationId,
    requestedCount,
    dispatchCount: state.dispatchCount,
    outcomes: state.outcomes,
  });
}

function interpreterResolverSourceFailure(
  pageWindow: PageWindow,
  state: InterpreterResolverPageState,
  target: MarkerTarget,
  code: Extract<InterpreterResolverHookResult, { kind: 'error' }>['code']
): void {
  if (state.dispatchCount > 0) interpreterResolverComplete(pageWindow, state, target);
  else finishInterpreterResolver(pageWindow, state, { kind: 'error', code });
}

function interpreterResolverTimeout(
  pageWindow: PageWindow,
  state: InterpreterResolverPageState,
  target: MarkerTarget
): void {
  if (state.dispatchCount > 0) interpreterResolverComplete(pageWindow, state, target);
  else
    finishInterpreterResolver(pageWindow, state, {
      kind: 'error',
      code: 'interpreter-result-timeout',
    });
}

function capturedStringCharacterCode(
  primordials: PagePrimordials,
  value: string,
  index: number
): number {
  return applyCaptured<number>(primordials, primordials.document.stringCharCodeAt, value, [index]);
}

function capturedStringSlice(
  primordials: PagePrimordials,
  value: string,
  start: number,
  end?: number
): string {
  return applyCaptured<string>(primordials, primordials.document.stringSlice, value, [start, end]);
}

function isSafeInterpreterAssetId(primordials: PagePrimordials, value: string): boolean {
  const suffixLength = '-asset-'.length + 64;
  const prefixLength = value.length - suffixLength;
  if (prefixLength < 1 || prefixLength > 32) return false;
  if (capturedStringSlice(primordials, value, prefixLength, prefixLength + 7) !== '-asset-') {
    return false;
  }
  for (let index = 0; index < prefixLength; index += 1) {
    const code = capturedStringCharacterCode(primordials, value, index);
    const lower = code >= 0x61 && code <= 0x7a;
    const digit = code >= 0x30 && code <= 0x39;
    if (!lower && !(index > 0 && (digit || code === 0x2d))) return false;
  }
  for (let index = prefixLength + 7; index < value.length; index += 1) {
    const code = capturedStringCharacterCode(primordials, value, index);
    const digit = code >= 0x30 && code <= 0x39;
    const lowerHex = code >= 0x61 && code <= 0x66;
    if (!digit && !lowerHex) return false;
  }
  return true;
}

function isSafeInterpreterMessageId(primordials: PagePrimordials, value: string): boolean {
  if (value.length < 1 || value.length > 256) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = capturedStringCharacterCode(primordials, value, index);
    const upper = code >= 0x41 && code <= 0x5a;
    const lower = code >= 0x61 && code <= 0x7a;
    const digit = code >= 0x30 && code <= 0x39;
    if (!upper && !lower && !digit && code !== 0x5f && code !== 0x2d) return false;
  }
  return true;
}

function isSafeInterpreterSandboxPath(primordials: PagePrimordials, value: string): boolean {
  const prefix = '/mnt/data/';
  if (
    value.length <= prefix.length ||
    value.length > 4 * 1024 ||
    capturedStringSlice(primordials, value, 0, prefix.length) !== prefix
  ) {
    return false;
  }
  let segmentStart = prefix.length;
  for (let index = 0; index <= value.length; index += 1) {
    if (index < value.length) {
      const code = capturedStringCharacterCode(primordials, value, index);
      if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x5c) return false;
      if (code >= 0xd800 && code <= 0xdbff) {
        const next =
          index + 1 < value.length
            ? capturedStringCharacterCode(primordials, value, index + 1)
            : -1;
        if (next < 0xdc00 || next > 0xdfff) return false;
        index += 1;
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff) return false;
      if (code !== 0x2f) continue;
    }
    if (index < prefix.length) continue;
    const segment = capturedStringSlice(primordials, value, segmentStart, index);
    if (segment.length === 0 || segment === '.' || segment === '..') return false;
    segmentStart = index + 1;
  }
  return true;
}

function interpreterResolverCandidate(
  primordials: PagePrimordials,
  value: unknown
): InterpreterResolverCandidate | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    applyCaptured<boolean>(primordials, primordials.document.arrayIsArray, undefined, [value])
  ) {
    return undefined;
  }
  try {
    const candidate = value as Record<string, unknown>;
    const keys = applyCaptured<PropertyKey[]>(
      primordials,
      primordials.document.reflectOwnKeys,
      undefined,
      [candidate]
    );
    if (keys.length !== 3) return undefined;
    let hasAssetId = false;
    let hasMessageId = false;
    let hasSandboxPath = false;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (key === 'assetId') hasAssetId = true;
      else if (key === 'messageId') hasMessageId = true;
      else if (key === 'sandboxPath') hasSandboxPath = true;
    }
    if (!hasAssetId || !hasMessageId || !hasSandboxPath) {
      return undefined;
    }
    const getOwnPropertyDescriptor = primordials.document.objectGetOwnPropertyDescriptor;
    const assetId = applyCaptured<PropertyDescriptor | undefined>(
      primordials,
      getOwnPropertyDescriptor,
      undefined,
      [candidate, 'assetId']
    )?.value;
    const messageId = applyCaptured<PropertyDescriptor | undefined>(
      primordials,
      getOwnPropertyDescriptor,
      undefined,
      [candidate, 'messageId']
    )?.value;
    const sandboxPath = applyCaptured<PropertyDescriptor | undefined>(
      primordials,
      getOwnPropertyDescriptor,
      undefined,
      [candidate, 'sandboxPath']
    )?.value;
    if (
      typeof assetId !== 'string' ||
      typeof messageId !== 'string' ||
      typeof sandboxPath !== 'string' ||
      !isSafeInterpreterAssetId(primordials, assetId) ||
      !isSafeInterpreterMessageId(primordials, messageId) ||
      !isSafeInterpreterSandboxPath(primordials, sandboxPath)
    ) {
      return undefined;
    }
    return { assetId, messageId, sandboxPath };
  } catch {
    return undefined;
  }
}

function interpreterResolverContainsCandidate(
  candidates: readonly InterpreterResolverCandidate[],
  candidate: InterpreterResolverCandidate
): boolean {
  for (let index = 0; index < candidates.length; index += 1) {
    const known = candidates[index];
    if (
      known.assetId === candidate.assetId ||
      (known.messageId === candidate.messageId && known.sandboxPath === candidate.sandboxPath)
    ) {
      return true;
    }
  }
  return false;
}

function interpreterResolverHrefStillExact(
  pageWindow: PageWindow,
  state: InterpreterResolverPageState
): boolean {
  try {
    return pageWindow.location.href === state.armedHref;
  } catch {
    return false;
  }
}

function interpreterResolverRequestUrl(
  primordials: PagePrimordials,
  target: MarkerTarget,
  candidate: InterpreterResolverCandidate
): string | undefined {
  try {
    const Constructor = primordials.document.URLSearchParams;
    if (Constructor === undefined) return undefined;
    const query = new Constructor();
    // Raw, already-validated values are passed once each to captured native set;
    // they are neither decoded nor pre-encoded by this hook.
    applyCaptured<void>(primordials, primordials.document.urlSearchParamsSet, query, [
      'message_id',
      candidate.messageId,
    ]);
    applyCaptured<void>(primordials, primordials.document.urlSearchParamsSet, query, [
      'sandbox_path',
      candidate.sandboxPath,
    ]);
    const encoded = applyCaptured<string>(
      primordials,
      primordials.document.urlSearchParamsToString,
      query,
      []
    );
    return `${CHATGPT_ORIGIN}/backend-api/conversation/${target.conversationId}/interpreter/download?${encoded}`;
  } catch {
    return undefined;
  }
}

function isCapturedHttpErrorStatus(value: unknown): value is number {
  return (
    typeof value === 'number' && value % 1 === 0 && value >= 100 && value <= 599 && value !== 200
  );
}

async function captureInterpreterResolverResponse(
  state: InterpreterResolverPageState,
  response: Response,
  controller: AbortController
): Promise<InterpreterResolverOutcome> {
  try {
    const status = applyCaptured<number>(
      state.primordials,
      state.primordials.document.responseStatus,
      response,
      []
    );
    if (status !== 200) {
      return isCapturedHttpErrorStatus(status)
        ? { state: 'http-error', httpStatus: status }
        : { state: 'http-error' };
    }
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
      DEFAULT_INTERPRETER_RESOLVER_MAX_BYTES
    );
    if (state.settled || state.abortController !== controller)
      return { state: 'response-processing-rejected' };
    const sha256 = await sha256FromBytes(state.primordials, bytes);
    if (state.settled || state.abortController !== controller)
      return { state: 'response-processing-rejected' };
    return {
      state: 'observed',
      capture: {
        bodyBase64: base64FromBytes(state.primordials, bytes),
        byteLength: bytes.byteLength,
        sha256,
        mediaType,
      },
    };
  } catch (error) {
    return { state: error === PAYLOAD_TOO_LARGE ? 'oversized' : 'response-processing-rejected' };
  }
}

function completeInterpreterResolverItem(
  pageWindow: PageWindow,
  state: InterpreterResolverPageState,
  target: MarkerTarget,
  controller: AbortController,
  outcome: InterpreterResolverOutcome
): void {
  // A late fetch/body/hash completion never owns the next item or terminal state.
  if (state.settled || state.abortController !== controller) return;
  clearInterpreterResolverTimer(pageWindow, state, 'perItemTimeoutId');
  abortInterpreterResolver(state);
  appendInterpreterResolverOutcome(state, outcome);
  dispatchInterpreterResolverQueue(pageWindow, state, target);
}

function observeInterpreterResolverItem(
  pageWindow: PageWindow,
  state: InterpreterResolverPageState,
  target: MarkerTarget,
  controller: AbortController,
  responsePromise: Promise<Response>
): void {
  try {
    const observation = applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      responsePromise,
      [
        async (response: Response) => {
          if (state.settled || state.abortController !== controller) return;
          const outcome = await captureInterpreterResolverResponse(state, response, controller);
          completeInterpreterResolverItem(pageWindow, state, target, controller, outcome);
        },
        () =>
          completeInterpreterResolverItem(pageWindow, state, target, controller, {
            state: 'fetch-rejected',
          }),
      ]
    );
    void applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      observation,
      [
        () => undefined,
        () =>
          completeInterpreterResolverItem(pageWindow, state, target, controller, {
            state: 'response-processing-rejected',
          }),
      ]
    );
  } catch {
    completeInterpreterResolverItem(pageWindow, state, target, controller, {
      state: 'fetch-rejected',
    });
  }
}

function dispatchInterpreterResolverQueue(
  pageWindow: PageWindow,
  state: InterpreterResolverPageState,
  target: MarkerTarget
): void {
  const document = state.primordials.document;
  const AbortControllerConstructor = document.abortControllerConstructor;
  const RequestConstructor = document.requestConstructor;
  if (
    state.settled ||
    state.candidates === undefined ||
    state.preparation === undefined ||
    AbortControllerConstructor === undefined ||
    RequestConstructor === undefined
  ) {
    if (!state.settled)
      finishInterpreterResolver(pageWindow, state, {
        kind: 'error',
        code: 'interpreter-result-invalid',
      });
    return;
  }
  if (
    state.outcomes.length === state.candidates.length ||
    !interpreterResolverHrefStillExact(pageWindow, state)
  ) {
    interpreterResolverComplete(pageWindow, state, target);
    return;
  }
  try {
    const controller = new AbortControllerConstructor();
    state.abortController = controller;
    const requestUrl = interpreterResolverRequestUrl(
      state.primordials,
      target,
      state.candidates[state.outcomes.length]
    );
    if (requestUrl === undefined) throw PRIMORDIAL_UNAVAILABLE;
    const init = applyCaptured<RequestInit>(state.primordials, document.objectCreate, undefined, [
      null,
    ]);
    init.method = 'GET';
    init.headers = state.preparation.headers;
    init.credentials = state.preparation.credentials;
    init.redirect = 'error';
    init.cache = 'no-store';
    init.signal = applyCaptured<AbortSignal>(
      state.primordials,
      document.abortControllerSignal,
      controller,
      []
    );
    const request = new RequestConstructor(requestUrl, init);
    const headers = applyCaptured<Headers>(state.primordials, document.requestHeaders, request, []);
    if (!applyCaptured<boolean>(state.primordials, document.headersHas, headers, ['authorization']))
      throw PRIMORDIAL_UNAVAILABLE;
    if (!interpreterResolverHrefStillExact(pageWindow, state)) {
      interpreterResolverComplete(pageWindow, state, target);
      return;
    }
    state.perItemTimeoutId = applyCaptured<ReturnType<typeof pageWindow.setTimeout>>(
      state.primordials,
      state.primordials.setTimeout,
      pageWindow,
      [
        () =>
          completeInterpreterResolverItem(pageWindow, state, target, controller, {
            state: 'timed-out',
          }),
        DEFAULT_INTERPRETER_RESOLVER_PER_ITEM_TIMEOUT_MS,
      ]
    );
    state.dispatchCount += 1;
    try {
      const responsePromise = applyCaptured<Promise<Response>>(
        state.primordials,
        state.originalFetch,
        pageWindow,
        [request]
      );
      observeInterpreterResolverItem(pageWindow, state, target, controller, responsePromise);
    } catch {
      completeInterpreterResolverItem(pageWindow, state, target, controller, {
        state: 'fetch-rejected',
      });
    }
  } catch {
    finishInterpreterResolver(pageWindow, state, {
      kind: 'error',
      code: 'interpreter-result-invalid',
    });
  }
}

function maybeDispatchInterpreterResolver(
  pageWindow: PageWindow,
  state: InterpreterResolverPageState,
  target: MarkerTarget
): void {
  if (
    state.settled ||
    state.dispatchStarted ||
    !state.commandAccepted ||
    !state.sourceReady ||
    state.candidates === undefined ||
    state.preparation === undefined
  ) {
    return;
  }
  if (!interpreterResolverHrefStillExact(pageWindow, state)) {
    interpreterResolverComplete(pageWindow, state, target);
    return;
  }
  state.dispatchStarted = true;
  dispatchInterpreterResolverQueue(pageWindow, state, target);
}

function observeInterpreterResolverSourceResponse(
  pageWindow: PageWindow,
  state: InterpreterResolverPageState,
  responsePromise: Promise<Response>,
  target: MarkerTarget
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
            if (!isExactOpaqueSourceResponse(state.primordials, response, target.conversationId)) {
              interpreterResolverSourceFailure(pageWindow, state, target, 'source-not-eligible');
              return;
            }
            const status = applyCaptured<number>(
              state.primordials,
              state.primordials.document.responseStatus,
              response,
              []
            );
            if (status !== 200) {
              interpreterResolverSourceFailure(pageWindow, state, target, 'source-http-error');
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
              interpreterResolverSourceFailure(pageWindow, state, target, 'source-non-json');
              return;
            }
            state.sourceReady = true;
            maybeDispatchInterpreterResolver(pageWindow, state, target);
          } catch {
            interpreterResolverSourceFailure(pageWindow, state, target, 'source-http-error');
          }
        },
        () => interpreterResolverSourceFailure(pageWindow, state, target, 'source-rejected'),
      ]
    );
    void applyCaptured<Promise<unknown>>(
      state.primordials,
      state.primordials.document.promiseThen,
      observation,
      [
        () => undefined,
        () => interpreterResolverSourceFailure(pageWindow, state, target, 'source-http-error'),
      ]
    );
  } catch {
    interpreterResolverSourceFailure(pageWindow, state, target, 'source-http-error');
  }
}

function armInterpreterResolver(
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
  const state: InterpreterResolverPageState = {
    primordials,
    originalFetch,
    armedHref,
    wrappedFetch: undefined,
    globalTimeoutId: undefined,
    perItemTimeoutId: undefined,
    abortController: undefined,
    settled: false,
    claimed: false,
    commandAccepted: false,
    sourceReady: false,
    dispatchStarted: false,
    preparation: undefined,
    candidates: undefined,
    outcomes: [],
    dispatchCount: 0,
    result: { kind: 'ready' },
  };
  const stateKey = interpreterResolverStateKeyFor(target.nonce);
  const commandKey = interpreterResolverCommandKeyFor(target.nonce);
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
      get: () => snapshotInterpreterResolverResult(state.result, primordials),
    });
    defineProperty(windowRecord, commandKey, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: (rawCandidates: unknown): boolean => {
        try {
          if (
            state.settled ||
            state.commandAccepted ||
            !interpreterResolverHrefStillExact(pageWindow, state) ||
            !applyCaptured<boolean>(primordials, primordials.document.arrayIsArray, undefined, [
              rawCandidates,
            ])
          ) {
            return false;
          }
          const candidateList = rawCandidates as unknown[];
          if (
            candidateList.length === 0 ||
            candidateList.length > DEFAULT_INTERPRETER_RESOLVER_MAX_OBSERVATIONS
          ) {
            return false;
          }
          const safeCandidates: InterpreterResolverCandidate[] = [];
          for (let index = 0; index < candidateList.length; index += 1) {
            const candidate = interpreterResolverCandidate(primordials, candidateList[index]);
            if (
              candidate === undefined ||
              interpreterResolverContainsCandidate(safeCandidates, candidate)
            ) {
              return false;
            }
            applyCaptured<void>(primordials, primordials.document.arrayPush, safeCandidates, [
              candidate,
            ]);
          }
          state.candidates = safeCandidates;
          state.commandAccepted = true;
          maybeDispatchInterpreterResolver(pageWindow, state, target);
          return true;
        } catch {
          return false;
        }
      },
    });
    let preparing = false;
    const wrappedFetch = function (
      this: PageWindow,
      ...args: Parameters<typeof pageWindow.fetch>
    ): ReturnType<typeof pageWindow.fetch> {
      // Proxy reflection may re-enter fetch, but may not claim another source.
      if (preparing) return applyCaptured(state.primordials, state.originalFetch, this, args);
      preparing = true;
      let candidate: OpaqueProbeCandidate | undefined;
      try {
        candidate =
          !state.settled && !state.claimed
            ? opaqueProbeCandidate(state.primordials, args, target.conversationId, true)
            : undefined;
        if (candidate !== undefined) {
          state.claimed = true;
          state.preparation = prepareResolverTransport(
            state.primordials,
            candidate,
            typeof args[0] === 'string'
          );
          if (state.preparation === undefined) {
            interpreterResolverSourceFailure(pageWindow, state, target, 'source-not-eligible');
          }
        }
      } catch {
        if (candidate !== undefined && !state.settled)
          interpreterResolverSourceFailure(pageWindow, state, target, 'source-not-eligible');
        candidate = undefined;
      } finally {
        preparing = false;
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
          interpreterResolverSourceFailure(pageWindow, state, target, 'source-rejected');
        }
        throw error;
      }
      if (candidate !== undefined && state.preparation !== undefined && !state.settled) {
        observeInterpreterResolverSourceResponse(pageWindow, state, responsePromise, target);
      }
      return responsePromise;
    } as typeof pageWindow.fetch;
    state.wrappedFetch = wrappedFetch;
    pageWindow.fetch = wrappedFetch;
    state.globalTimeoutId = applyCaptured<ReturnType<typeof pageWindow.setTimeout>>(
      primordials,
      primordials.setTimeout,
      pageWindow,
      [() => interpreterResolverTimeout(pageWindow, state, target), DEFAULT_TIMEOUT_MS]
    );
    return { kind: 'ready' };
  } catch {
    finishInterpreterResolver(pageWindow, state, {
      kind: 'error',
      code: 'interpreter-result-invalid',
    });
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
            : target.mode === 'interpreter-resolver'
              ? !hasInterpreterResolverArmingPrimordials(primordials)
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
  if (target.mode === 'interpreter-resolver') {
    return armInterpreterResolver(pageWindow, primordials, target, windowRecord);
  }
  if (target.mode === 'opaque-replay') {
    return armOpaqueReplay(pageWindow, primordials, target, windowRecord);
  }

  const stateKey = stateKeyFor(target.nonce);
  const chunkReaderKey = chunkReaderKeyFor(target.nonce);
  try {
    const getOwnPropertyDescriptor = primordials.document.objectGetOwnPropertyDescriptor;
    if (
      getOwnPropertyDescriptor === undefined ||
      getOwnPropertyDescriptor(windowRecord, stateKey) !== undefined ||
      getOwnPropertyDescriptor(windowRecord, chunkReaderKey) !== undefined
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
  if (!publishResultSnapshot(primordials, windowRecord, stateKey, chunkReaderKey, state)) {
    return { kind: 'error', code: 'hook-state-failed' };
  }
  armNativeFetchObserver(pageWindow, state, target);
  return { kind: 'ready' };
}

/**
 * Read one independently-encoded staged capture chunk from MAIN world. Chrome
 * serializes this function without module scope, so every validation here is
 * deliberately primitive-only and self-contained.
 */
export function readChatGptTemporaryCaptureChunk(
  nonce: string,
  index: number
): CaptureChunk | { kind: 'missing' } {
  const chunkBytes = 512 * 1024;
  const inlineBytes = 16 * 1024 * 1024;
  const stagedBytes = 64 * 1024 * 1024;
  const maxChunkBase64Length = 4 * ((chunkBytes + 2) / 3);
  try {
    if (
      typeof nonce !== 'string' ||
      nonce.length < 16 ||
      nonce.length > 128 ||
      typeof index !== 'number' ||
      index !== index ||
      index < 0 ||
      index % 1 !== 0
    ) {
      return { kind: 'missing' };
    }
    for (let nonceIndex = 0; nonceIndex < nonce.length; nonceIndex += 1) {
      const character = nonce[nonceIndex];
      if (
        character !== '-' &&
        !(
          (character >= 'a' && character <= 'z') ||
          (character >= 'A' && character <= 'Z') ||
          (character >= '0' && character <= '9')
        )
      ) {
        return { kind: 'missing' };
      }
    }

    const pageWindow = window as unknown as Record<string, unknown>;
    const state = pageWindow[`__liskaChatGptCapture_${nonce}`];
    if (typeof state !== 'object' || state === null) return { kind: 'missing' };
    const result = state as Record<string, unknown>;
    if (
      result.kind !== 'captured' ||
      typeof result.capture !== 'object' ||
      result.capture === null
    ) {
      return { kind: 'missing' };
    }
    const capture = result.capture as Record<string, unknown>;
    const byteLength = capture.byteLength;
    const chunkCount = capture.chunkCount;
    if (
      capture.transport !== 'staged' ||
      typeof byteLength !== 'number' ||
      byteLength <= inlineBytes ||
      byteLength > stagedBytes ||
      byteLength % 1 !== 0 ||
      typeof chunkCount !== 'number' ||
      chunkCount <= 0 ||
      chunkCount % 1 !== 0
    ) {
      return { kind: 'missing' };
    }
    let expectedChunkCount = 0;
    for (let offset = 0; offset < byteLength; offset += chunkBytes) expectedChunkCount += 1;
    if (chunkCount !== expectedChunkCount || index >= chunkCount) return { kind: 'missing' };

    const reader = pageWindow[`__liskaChatGptCaptureChunkReader_${nonce}`];
    if (typeof reader !== 'function') return { kind: 'missing' };
    const chunk = reader(index);
    if (typeof chunk !== 'object' || chunk === null) return { kind: 'missing' };
    const record = chunk as Record<string, unknown>;
    const offset = index * chunkBytes;
    const chunkLength = record.byteLength;
    const chunkBase64 = record.chunkBase64;
    if (
      record.kind !== 'chunk' ||
      record.index !== index ||
      record.offset !== offset ||
      typeof chunkLength !== 'number' ||
      chunkLength <= 0 ||
      chunkLength > chunkBytes ||
      chunkLength % 1 !== 0 ||
      chunkLength !== (index + 1 === chunkCount ? byteLength - offset : chunkBytes) ||
      typeof chunkBase64 !== 'string' ||
      chunkBase64.length > maxChunkBase64Length
    ) {
      return { kind: 'missing' };
    }
    const expectedBase64Length =
      4 * (chunkLength % 3 === 0 ? chunkLength / 3 : (chunkLength + (3 - (chunkLength % 3))) / 3);
    if (chunkBase64.length !== expectedBase64Length) return { kind: 'missing' };
    return { kind: 'chunk', index, offset, byteLength: chunkLength, chunkBase64 };
  } catch {
    return { kind: 'missing' };
  }
}

if (typeof window !== 'undefined') {
  startChatGptDocumentStartCapture();
}
