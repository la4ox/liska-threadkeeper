/**
 * Selected-document Dots transport-schema probe. A fragment is correlation,
 * not authorization: only the extension background may accept its result.
 * This entry has no messaging, persistence, replay, or provider imports.
 */

const DOTS_ORIGIN = 'https://chatgpt.com';
const DOTS_MARKER = /^#liska-dots-schema=([a-z0-9-]{16,128})$/i;
const DOTS_ROUTE = /^\/dots(?:\/[A-Za-z0-9][A-Za-z0-9_~.-]{0,511})?$/;
const ROOM_ROUTE = /^\/backend-api\/messaging\/rooms\/([A-Za-z0-9_-]{1,256})(\/messages)?$/;
const LIMIT_QUERY = /^\?limit=[A-Za-z0-9_-]{1,32}$/;
const OBSERVATION_MS = 15_000;
const HARD_DEADLINE_MS = 20_000;
const ROOM_MAX_BYTES = 256 * 1024;
const MESSAGES_MAX_BYTES = 2 * 1024 * 1024;
const READER_MAX_CHUNKS = 4_096;
const SCHEMA_MAX_BYTES = 32 * 1024;
const SCHEMA_MAX_DEPTH = 12;
const SCHEMA_MAX_NODES = 20_000;
const SCHEMA_MAX_PROPERTIES = 128;
const SCHEMA_MAX_ITEMS = 2_000;
const SCHEMA_MAX_ITEM_SHAPES = 32;
const DOCUMENT_GUARD = '__liskaDotsSchemaProbeDocument';
const KNOWN_FIELDS = [
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
] as const;

type PageWindow = Window & typeof globalThis;
type CapturedCallable = CallableFunction;
type Endpoint = 'roomMetadata' | 'roomMessages';
type Shape =
  | { type: 'null' | 'boolean' | 'number' | 'string' }
  | {
      type: 'object';
      fields: Array<{ name: string; shape: Shape }>;
      unknownProperties: 'none' | 'present';
    }
  | { type: 'array'; itemShapes: 'unobserved' | Shape[] };
type Projection = {
  schema: 'liska-dots-schema-probe/1';
  scope: {
    provider: 'chatgpt-dots';
    pairing: 'same-room';
    historyCompleteness: 'unverified';
    currentConversationIdentity: 'unverified';
    valuesRetained: false;
    unknownPropertyNamesRetained: false;
    tboBodiesObserved: false;
    realtimeBodiesObserved: false;
  };
  endpoints: {
    roomMetadata: {
      method: 'GET';
      pathPattern: string;
      mediaType: 'application/json';
      shape: Shape;
    };
    roomMessages: {
      method: 'GET';
      pathPattern: string;
      mediaType: 'application/json';
      shape: Shape;
    };
  };
};
type HookCode =
  | 'hook-state-failed'
  | 'request-failed'
  | 'response-http-error'
  | 'response-route-mismatch'
  | 'response-media-type-invalid'
  | 'response-processing-failed'
  | 'payload-too-large'
  | 'schema-limit-exceeded'
  | 'schema-invalid'
  | 'ambiguous-room'
  | 'duplicate-endpoint'
  | 'target-not-observed'
  | 'request-init-present'
  | 'timed-out'
  | 'navigation-changed';
type HookResult =
  | { kind: 'ready' }
  | { kind: 'completed'; projection: Projection }
  | { kind: 'error'; code: HookCode };
type Primordials = {
  apply: typeof Reflect.apply;
  descriptor: typeof Object.getOwnPropertyDescriptor;
  define: typeof Object.defineProperty;
  prototypeOf: typeof Object.getPrototypeOf;
  objectPrototype: object;
  ownKeys: typeof Reflect.ownKeys;
  isArray: typeof Array.isArray;
  parse: typeof JSON.parse;
  stringify: typeof JSON.stringify;
  URL: typeof URL;
  decoder: typeof TextDecoder;
  decode: CapturedCallable;
  bytes: typeof Uint8Array;
  setBytes: CapturedCallable;
  exec: CapturedCallable;
  promiseThen: CapturedCallable;
  responseClone: CapturedCallable;
  responseStatus: CapturedCallable;
  responseUrl: CapturedCallable;
  responseRedirected: CapturedCallable;
  responseHeaders: CapturedCallable;
  responseBody: CapturedCallable;
  headersGet: CapturedCallable;
  streamReader: CapturedCallable;
  readerRead: CapturedCallable;
  readerCancel: CapturedCallable;
  requestUrl: CapturedCallable;
  requestMethod: CapturedCallable;
  urlHref: CapturedCallable;
  urlOrigin: CapturedCallable;
  urlUsername: CapturedCallable;
  urlPassword: CapturedCallable;
  urlPathname: CapturedCallable;
  urlSearch: CapturedCallable;
  urlHash: CapturedCallable;
  typedArrayByteLength: CapturedCallable;
  typedArrayTag: CapturedCallable;
  documentBase: CapturedCallable;
  setTimeout: typeof window.setTimeout;
  clearTimeout: typeof window.clearTimeout;
};
type ReaderSession = {
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  chunks: Uint8Array[];
  total: number;
  active: boolean;
};
type ProbeState = {
  page: PageWindow;
  p: Primordials;
  href: string;
  baseHref: string;
  originalFetch: typeof window.fetch;
  fetchEnumerable: boolean;
  wrapper: typeof window.fetch | undefined;
  observationTimer: number | undefined;
  hardTimer: number | undefined;
  settled: boolean;
  observationClosed: boolean;
  requestInitPresent: boolean;
  room: string | undefined;
  claimed: Record<Endpoint, boolean>;
  shapes: Partial<Record<Endpoint, Shape>>;
  readers: ReaderSession[];
  targets: RequestTarget[];
  shapeBudget: { nodes: number };
  result: HookResult;
};
type RequestTarget = { room: string; endpoint: Endpoint; href: string };
const INVALID_SCHEMA = {};
const SCHEMA_LIMIT = {};
const BYTE_LIMIT = {};
const CANCELLED = {};

function captured<T>(p: Primordials, fn: CapturedCallable, receiver: unknown, args: unknown[]): T {
  return p.apply(fn, receiver, args) as T;
}

function prototypeMember(
  descriptor: typeof Object.getOwnPropertyDescriptor,
  prototypeOf: typeof Object.getPrototypeOf,
  prototype: object,
  key: PropertyKey,
  getter = false
): CapturedCallable {
  let current: object | null = prototype;
  for (let depth = 0; current !== null && depth < 5; depth += 1) {
    const entry = descriptor(current, key);
    if (entry !== undefined) {
      const value = getter ? entry.get : entry.value;
      if (typeof value !== 'function') throw INVALID_SCHEMA;
      return value as CapturedCallable;
    }
    current = prototypeOf(current);
  }
  throw INVALID_SCHEMA;
}

// eslint-disable-next-line max-lines-per-function -- Capture each later-used native at the single document-start boundary.
function snapshotPrimordials(page: PageWindow): Primordials {
  const descriptor = page.Object.getOwnPropertyDescriptor;
  const prototypeOf = page.Object.getPrototypeOf;
  const member = (prototype: object, key: PropertyKey, getter = false) =>
    prototypeMember(descriptor, prototypeOf, prototype, key, getter);
  const p: Primordials = {
    apply: page.Reflect.apply,
    descriptor,
    define: page.Object.defineProperty,
    prototypeOf,
    objectPrototype: page.Object.prototype,
    ownKeys: page.Reflect.ownKeys,
    isArray: page.Array.isArray,
    parse: page.JSON.parse,
    stringify: page.JSON.stringify,
    URL: page.URL,
    decoder: page.TextDecoder,
    decode: member(page.TextDecoder.prototype, 'decode'),
    bytes: page.Uint8Array,
    setBytes: member(page.Uint8Array.prototype, 'set'),
    exec: member(page.RegExp.prototype, 'exec'),
    promiseThen: member(page.Promise.prototype, 'then'),
    responseClone: member(page.Response.prototype, 'clone'),
    responseStatus: member(page.Response.prototype, 'status', true),
    responseUrl: member(page.Response.prototype, 'url', true),
    responseRedirected: member(page.Response.prototype, 'redirected', true),
    responseHeaders: member(page.Response.prototype, 'headers', true),
    responseBody: member(page.Response.prototype, 'body', true),
    headersGet: member(page.Headers.prototype, 'get'),
    streamReader: member(page.ReadableStream.prototype, 'getReader'),
    readerRead: member(page.ReadableStreamDefaultReader.prototype, 'read'),
    readerCancel: member(page.ReadableStreamDefaultReader.prototype, 'cancel'),
    requestUrl: member(page.Request.prototype, 'url', true),
    requestMethod: member(page.Request.prototype, 'method', true),
    urlHref: member(page.URL.prototype, 'href', true),
    urlOrigin: member(page.URL.prototype, 'origin', true),
    urlUsername: member(page.URL.prototype, 'username', true),
    urlPassword: member(page.URL.prototype, 'password', true),
    urlPathname: member(page.URL.prototype, 'pathname', true),
    urlSearch: member(page.URL.prototype, 'search', true),
    urlHash: member(page.URL.prototype, 'hash', true),
    typedArrayByteLength: member(page.Uint8Array.prototype, 'byteLength', true),
    typedArrayTag: member(page.Uint8Array.prototype, page.Symbol.toStringTag, true),
    documentBase: member(page.Node.prototype, 'baseURI', true),
    setTimeout: page.setTimeout,
    clearTimeout: page.clearTimeout,
  };
  for (const key of p.ownKeys(p)) {
    if (key !== 'objectPrototype' && typeof p.descriptor(p, key)?.value !== 'function') {
      throw INVALID_SCHEMA;
    }
  }
  return p;
}

function markerFromHref(href: string): { nonce: string; baseHref: string } | undefined {
  try {
    const url = new URL(href);
    const marker = DOTS_MARKER.exec(url.hash);
    if (
      url.origin !== DOTS_ORIGIN ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      href !== `${DOTS_ORIGIN}${url.pathname}${url.hash}` ||
      !DOTS_ROUTE.test(url.pathname) ||
      marker === null
    )
      return undefined;
    return { nonce: marker[1], baseHref: `${DOTS_ORIGIN}${url.pathname}` };
  } catch {
    return undefined;
  }
}

function exactRequestMethod(p: Primordials, input: unknown): string | undefined {
  try {
    const method: unknown =
      typeof input === 'string' ? 'GET' : captured(p, p.requestMethod, input, []);
    // Native fetch normalizes method casing; no request values leave this closure.
    return typeof method === 'string' && captured(p, p.exec, /^get$/i, [method]) !== null
      ? 'GET'
      : undefined;
  } catch {
    return undefined;
  }
}

/** Recognize only the exact input route, independently of RequestInit admission. */
function requestTarget(state: ProbeState, input: unknown): RequestTarget | undefined {
  const p = state.p;
  try {
    // URL objects are intentionally not coerced: page-owned toString could retarget them.
    const raw = typeof input === 'string' ? input : captured<string>(p, p.requestUrl, input, []);
    const base = captured<string>(p, p.documentBase, state.page.document, []);
    const url = new p.URL(raw, base);
    const href = captured<string>(p, p.urlHref, url, []);
    if (
      captured(p, p.urlOrigin, url, []) !== DOTS_ORIGIN ||
      captured(p, p.urlUsername, url, []) !== '' ||
      captured(p, p.urlPassword, url, []) !== ''
    )
      return undefined;
    if (raw !== href && `${DOTS_ORIGIN}${raw}` !== href) return undefined;
    if (captured(p, p.urlHash, url, []) !== '') return undefined;
    const route = captured<RegExpExecArray | null>(p, p.exec, ROOM_ROUTE, [
      captured(p, p.urlPathname, url, []),
    ]);
    if (route === null) return undefined;
    const endpoint: Endpoint = route[2] === undefined ? 'roomMetadata' : 'roomMessages';
    const search = captured<string>(p, p.urlSearch, url, []);
    if (
      endpoint === 'roomMetadata'
        ? search !== ''
        : captured(p, p.exec, LIMIT_QUERY, [search]) === null
    ) {
      return undefined;
    }
    return { room: route[1], endpoint, href };
  } catch {
    return undefined;
  }
}

function restoreFetch(state: ProbeState): void {
  try {
    if (state.p.descriptor(state.page, 'fetch')?.value === state.wrapper) {
      state.p.define(state.page, 'fetch', {
        value: state.originalFetch,
        configurable: true,
        enumerable: state.fetchEnumerable,
        writable: true,
      });
    }
  } catch {
    /* A later page-owned wrapper must never be overwritten. */
  }
}

function releaseReader(state: ProbeState, session: ReaderSession): void {
  session.active = false;
  session.chunks.length = 0;
  session.total = 0;
  const reader = session.reader;
  session.reader = undefined;
  if (reader === undefined) return;
  try {
    const cancelled = captured<Promise<void>>(state.p, state.p.readerCancel, reader, []);
    captured(state.p, state.p.promiseThen, cancelled, [() => undefined, () => undefined]);
  } catch {
    /* Clone cancellation is best effort and never awaited indefinitely. */
  }
}

function clearTimer(state: ProbeState, timer: number | undefined): void {
  if (timer === undefined) return;
  try {
    captured(state.p, state.p.clearTimeout, state.page, [timer]);
  } catch {
    /* terminal */
  }
}

function finish(state: ProbeState, result: HookResult): void {
  if (state.settled) return;
  state.settled = true;
  state.result = result;
  clearTimer(state, state.observationTimer);
  clearTimer(state, state.hardTimer);
  state.observationTimer = undefined;
  state.hardTimer = undefined;
  restoreFetch(state);
  for (let index = 0; index < state.readers.length; index += 1)
    releaseReader(state, state.readers[index]);
  state.readers.length = 0;
  for (let index = 0; index < state.targets.length; index += 1) {
    state.targets[index].room = '';
    state.targets[index].href = '';
  }
  state.targets.length = 0;
  state.room = undefined;
  state.requestInitPresent = false;
  state.href = '';
  state.baseHref = '';
  state.shapes = {};
}

function fail(state: ProbeState, code: HookCode): void {
  finish(state, { kind: 'error', code });
}

function stillSameDocument(state: ProbeState): boolean {
  try {
    // The host may remove an unknown fragment after this document is armed.
    // No other path, query or hash is equivalent to the selected document URL.
    const href = state.page.location.href;
    return href === state.href || href === state.baseHref;
  } catch {
    return false;
  }
}

function makeProjection(roomMetadata: Shape, roomMessages: Shape): Projection {
  return {
    schema: 'liska-dots-schema-probe/1',
    scope: {
      provider: 'chatgpt-dots',
      pairing: 'same-room',
      historyCompleteness: 'unverified',
      currentConversationIdentity: 'unverified',
      valuesRetained: false,
      unknownPropertyNamesRetained: false,
      tboBodiesObserved: false,
      realtimeBodiesObserved: false,
    },
    endpoints: {
      roomMetadata: {
        method: 'GET',
        pathPattern: '/backend-api/messaging/rooms/{room}',
        mediaType: 'application/json',
        shape: roomMetadata,
      },
      roomMessages: {
        method: 'GET',
        pathPattern: '/backend-api/messaging/rooms/{room}/messages?limit={redacted}',
        mediaType: 'application/json',
        shape: roomMessages,
      },
    },
  };
}

function completeIfReady(state: ProbeState): void {
  if (state.settled || !state.observationClosed) return;
  if (!stillSameDocument(state)) return fail(state, 'navigation-changed');
  const metadata = state.shapes.roomMetadata;
  const messages = state.shapes.roomMessages;
  if (metadata === undefined || messages === undefined) return;
  const projection = makeProjection(metadata, messages);
  // Every persisted string is fixed ASCII, so code units equal UTF-8 bytes here.
  if (state.p.stringify(projection).length > SCHEMA_MAX_BYTES)
    return fail(state, 'schema-limit-exceeded');
  finish(state, { kind: 'completed', projection });
}

function knownField(name: string): boolean {
  for (let index = 0; index < KNOWN_FIELDS.length; index += 1)
    if (KNOWN_FIELDS[index] === name) return true;
  return false;
}

type ShapeBudget = { nodes: number };

function arrayShape(p: Primordials, value: unknown[], depth: number, budget: ShapeBudget): Shape {
  if (value.length > SCHEMA_MAX_ITEMS) throw SCHEMA_LIMIT;
  const shapes: Shape[] = [];
  const encodings: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = p.descriptor(value, `${index}`);
    if (descriptor === undefined || !('value' in descriptor)) throw INVALID_SCHEMA;
    const item = shapeOf(p, descriptor.value, depth + 1, budget);
    const encoding = p.stringify(item);
    let insertion = 0;
    while (insertion < encodings.length && encodings[insertion] < encoding) insertion += 1;
    if (encodings[insertion] === encoding) continue;
    if (shapes.length >= SCHEMA_MAX_ITEM_SHAPES) throw SCHEMA_LIMIT;
    for (let move = shapes.length; move > insertion; move -= 1) {
      shapes[move] = shapes[move - 1];
      encodings[move] = encodings[move - 1];
    }
    shapes[insertion] = item;
    encodings[insertion] = encoding;
  }
  return { type: 'array', itemShapes: shapes.length === 0 ? 'unobserved' : shapes };
}

function objectShape(p: Primordials, value: object, depth: number, budget: ShapeBudget): Shape {
  if (p.prototypeOf(value) !== p.objectPrototype && p.prototypeOf(value) !== null)
    throw INVALID_SCHEMA;
  const keys = p.ownKeys(value);
  if (keys.length > SCHEMA_MAX_PROPERTIES) throw SCHEMA_LIMIT;
  const fields: Array<{ name: string; shape: Shape }> = [];
  let unknownProperties: 'none' | 'present' = 'none';
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== 'string' || !knownField(key)) {
      unknownProperties = 'present';
      continue;
    }
    const descriptor = p.descriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable)
      throw INVALID_SCHEMA;
    const field = { name: key, shape: shapeOf(p, descriptor.value, depth + 1, budget) };
    let insertion = fields.length;
    while (insertion > 0 && fields[insertion - 1].name > key) {
      fields[insertion] = fields[insertion - 1];
      insertion -= 1;
    }
    fields[insertion] = field;
  }
  return { type: 'object', fields, unknownProperties };
}

function shapeOf(p: Primordials, value: unknown, depth: number, budget: ShapeBudget): Shape {
  budget.nodes += 1;
  if (depth > SCHEMA_MAX_DEPTH || budget.nodes > SCHEMA_MAX_NODES) throw SCHEMA_LIMIT;
  if (value === null) return { type: 'null' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (typeof value === 'number') return { type: 'number' };
  if (typeof value === 'string') return { type: 'string' };
  if (typeof value !== 'object') throw INVALID_SCHEMA;
  return p.isArray(value)
    ? arrayShape(p, value, depth, budget)
    : objectShape(p, value, depth, budget);
}

function jsonResponse(state: ProbeState, response: Response, target: RequestTarget): boolean {
  const p = state.p;
  if (captured<number>(p, p.responseStatus, response, []) !== 200)
    return (fail(state, 'response-http-error'), false);
  if (
    captured<boolean>(p, p.responseRedirected, response, []) ||
    captured<string>(p, p.responseUrl, response, []) !== target.href
  ) {
    return (fail(state, 'response-route-mismatch'), false);
  }
  const headers = captured<Headers>(p, p.responseHeaders, response, []);
  const mediaType = captured<unknown>(p, p.headersGet, headers, ['content-type']);
  if (
    typeof mediaType !== 'string' ||
    captured(p, p.exec, /^application\/json(?:[ \t]*;[\x20-\x7e]*)?$/i, [mediaType]) === null
  ) {
    return (fail(state, 'response-media-type-invalid'), false);
  }
  return true;
}

async function readClone(
  state: ProbeState,
  response: Response,
  maximum: number
): Promise<Uint8Array> {
  const p = state.p;
  const clone = captured<Response>(p, p.responseClone, response, []);
  const body = captured<ReadableStream<Uint8Array> | null>(p, p.responseBody, clone, []);
  if (body === null) throw INVALID_SCHEMA;
  const session: ReaderSession = {
    reader: captured(p, p.streamReader, body, []),
    chunks: [],
    total: 0,
    active: true,
  };
  state.readers[state.readers.length] = session;
  try {
    while (!state.settled && session.active && session.reader !== undefined) {
      const part = await captured<Promise<ReadableStreamReadResult<Uint8Array>>>(
        p,
        p.readerRead,
        session.reader,
        []
      );
      if (state.settled || !session.active) throw CANCELLED;
      if (part.done) {
        const bytes = new p.bytes(session.total);
        let offset = 0;
        for (let index = 0; index < session.chunks.length; index += 1) {
          captured(p, p.setBytes, bytes, [session.chunks[index], offset]);
          offset += captured<number>(p, p.typedArrayByteLength, session.chunks[index], []);
        }
        return bytes;
      }
      const chunk = part.value;
      if (captured(p, p.typedArrayTag, chunk, []) !== 'Uint8Array') throw INVALID_SCHEMA;
      if (session.chunks.length >= READER_MAX_CHUNKS) throw SCHEMA_LIMIT;
      session.total += captured<number>(p, p.typedArrayByteLength, chunk, []);
      if (session.total > maximum) throw BYTE_LIMIT;
      session.chunks[session.chunks.length] = chunk;
    }
    throw CANCELLED;
  } finally {
    releaseReader(state, session);
  }
}

async function observeResponse(
  state: ProbeState,
  response: Response,
  target: RequestTarget
): Promise<void> {
  if (state.settled) return;
  try {
    if (!stillSameDocument(state)) return fail(state, 'navigation-changed');
    if (!jsonResponse(state, response, target)) return;
    const bytes = await readClone(
      state,
      response,
      target.endpoint === 'roomMetadata' ? ROOM_MAX_BYTES : MESSAGES_MAX_BYTES
    );
    if (state.settled) return;
    const text = captured<string>(
      state.p,
      state.p.decode,
      new state.p.decoder('utf-8', { fatal: true }),
      [bytes]
    );
    const value: unknown = state.p.parse(text);
    // Match the background contract: the endpoint root occupies depth 1.
    const shape = shapeOf(state.p, value, 1, state.shapeBudget);
    if (state.settled) return;
    state.shapes[target.endpoint] = shape;
    completeIfReady(state);
  } catch (error) {
    if (state.settled || error === CANCELLED) return;
    fail(
      state,
      error === BYTE_LIMIT
        ? 'payload-too-large'
        : error === SCHEMA_LIMIT
          ? 'schema-limit-exceeded'
          : 'response-processing-failed'
    );
  }
}

function claimRequest(state: ProbeState, target: RequestTarget | undefined): boolean {
  if (target === undefined || state.settled || state.observationClosed) return false;
  if (!stillSameDocument(state)) return (fail(state, 'navigation-changed'), false);
  if (state.room !== undefined && state.room !== target.room)
    return (fail(state, 'ambiguous-room'), false);
  if (state.claimed[target.endpoint]) return (fail(state, 'duplicate-endpoint'), false);
  state.room = target.room;
  state.claimed[target.endpoint] = true;
  state.targets[state.targets.length] = target;
  return true;
}

function admittedRequestTarget(
  state: ProbeState,
  input: unknown,
  init: unknown
): RequestTarget | undefined {
  if (state.settled || state.observationClosed) return undefined;
  const target = requestTarget(state, input);
  if (target === undefined || exactRequestMethod(state.p, input) !== 'GET') return undefined;
  // Presence is the sole RequestInit observation. Never read, enumerate or
  // reflect its fields: native conversion could run getters or retarget fetch.
  if (init !== undefined && init !== null) {
    if (stillSameDocument(state)) state.requestInitPresent = true;
    return undefined;
  }
  return target;
}

function wrapFetch(state: ProbeState): typeof window.fetch {
  return function (
    this: unknown,
    ...args: Parameters<typeof window.fetch>
  ): ReturnType<typeof window.fetch> {
    const target = admittedRequestTarget(state, args[0], args[1]);
    const observe = claimRequest(state, target);
    let original: ReturnType<typeof window.fetch>;
    try {
      original = captured(state.p, state.originalFetch, this, args);
    } catch (error) {
      if (observe) fail(state, 'request-failed');
      throw error;
    }
    if (observe && target !== undefined) {
      try {
        const observation = captured<Promise<unknown>>(state.p, state.p.promiseThen, original, [
          (response: Response) => observeResponse(state, response, target),
          () => fail(state, 'request-failed'),
        ]);
        captured(state.p, state.p.promiseThen, observation, [
          () => undefined,
          () => fail(state, 'response-processing-failed'),
        ]);
      } catch {
        fail(state, 'response-processing-failed');
      }
    }
    return original;
  } as typeof window.fetch;
}

function armTimers(state: ProbeState): void {
  state.observationTimer = captured(state.p, state.p.setTimeout, state.page, [
    () => {
      if (state.settled) return;
      if (!stillSameDocument(state)) return fail(state, 'navigation-changed');
      state.observationClosed = true;
      restoreFetch(state);
      if (!state.claimed.roomMetadata || !state.claimed.roomMessages)
        return fail(
          state,
          state.requestInitPresent ? 'request-init-present' : 'target-not-observed'
        );
      completeIfReady(state);
    },
    OBSERVATION_MS,
  ]);
  state.hardTimer = captured(state.p, state.p.setTimeout, state.page, [
    () => fail(state, 'timed-out'),
    HARD_DEADLINE_MS,
  ]);
}

/** MAIN-world getter returns detached, content-free state only. */
function publishState(state: ProbeState, key: string): void {
  state.p.define(state.page, key, {
    configurable: false,
    enumerable: false,
    get: () => state.p.parse(state.p.stringify(state.result)) as HookResult,
  });
}

export type DotsSchemaDocumentStartResult =
  | { kind: 'inert' }
  | { kind: 'ready' }
  | { kind: 'error'; code: 'hook-state-failed' };

// eslint-disable-next-line max-lines-per-function -- Keep initial admission, one-time installation and rollback in one boundary.
export function startDotsSchemaDocumentStartProbe(
  page: PageWindow = window
): DotsSchemaDocumentStartResult {
  const marker = markerFromHref(page.location.href);
  if (marker === undefined) return { kind: 'inert' };
  let state: ProbeState | undefined;
  try {
    const p = snapshotPrimordials(page);
    const key = `__liskaDotsSchemaProbe_${marker.nonce}`;
    const descriptor = p.descriptor(page, 'fetch');
    if (
      p.descriptor(page, key) !== undefined ||
      p.descriptor(page, DOCUMENT_GUARD) !== undefined ||
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'function' ||
      !descriptor.writable ||
      !descriptor.configurable
    )
      throw INVALID_SCHEMA;
    state = {
      page,
      p,
      href: page.location.href,
      baseHref: marker.baseHref,
      originalFetch: descriptor.value as typeof window.fetch,
      fetchEnumerable: descriptor.enumerable === true,
      wrapper: undefined,
      observationTimer: undefined,
      hardTimer: undefined,
      settled: false,
      observationClosed: false,
      requestInitPresent: false,
      room: undefined,
      claimed: { roomMetadata: false, roomMessages: false },
      shapes: {},
      readers: [],
      targets: [],
      shapeBudget: { nodes: 0 },
      result: { kind: 'ready' },
    };
    p.define(page, DOCUMENT_GUARD, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    publishState(state, key);
    state.wrapper = wrapFetch(state);
    p.define(page, 'fetch', {
      value: state.wrapper,
      configurable: true,
      enumerable: descriptor.enumerable,
      writable: true,
    });
    armTimers(state);
    return { kind: 'ready' };
  } catch {
    if (state !== undefined) fail(state, 'hook-state-failed');
    return { kind: 'error', code: 'hook-state-failed' };
  }
}

/** Serialized by chrome.scripting; background independently validates every returned field. */
export function readDotsSchemaProbeState(nonce: string): unknown {
  try {
    if (typeof nonce !== 'string' || !/^[a-z0-9-]{16,128}$/i.test(nonce))
      return { kind: 'missing' };
    const result = (window as unknown as Record<string, unknown>)[
      `__liskaDotsSchemaProbe_${nonce}`
    ];
    return typeof result === 'object' && result !== null ? result : { kind: 'missing' };
  } catch {
    return { kind: 'missing' };
  }
}

if (typeof window !== 'undefined') startDotsSchemaDocumentStartProbe();
