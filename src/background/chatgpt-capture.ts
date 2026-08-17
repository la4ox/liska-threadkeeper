/* eslint-disable max-lines-per-function -- The injected MAIN-world function must stay self-contained. */
/**
 * Safe capture of ChatGPT's own conversation request in a disposable tab.
 *
 * The background worker must never recreate the browser's authenticated
 * request: doing so would require handling cookies or short-lived page
 * protocol headers. Instead, an isolated inactive ChatGPT tab performs its
 * normal client-side navigation and a short-lived MAIN-world hook observes the
 * matching response. The hook has no access to, and never serializes, request
 * headers, cookies, account data, or unrelated responses.
 */

import {
  CHATGPT_CAPTURE_ENDPOINT,
  CHATGPT_CAPTURE_ERROR_MESSAGES,
  CHATGPT_CAPTURE_MAX_BYTES,
  isChatGptConversationId,
} from '../lib/chatgpt-capture-contract';
import type {
  ChatGptCaptureArtifact,
  ChatGptCaptureErrorCode,
} from '../lib/chatgpt-capture-contract';

export {
  CHATGPT_CAPTURE_ENDPOINT,
  CHATGPT_CAPTURE_MAX_BYTES,
} from '../lib/chatgpt-capture-contract';
export type {
  ChatGptCaptureArtifact as ChatGptTemporaryCaptureResult,
  ChatGptCaptureErrorCode as ChatGptTemporaryCaptureErrorCode,
} from '../lib/chatgpt-capture-contract';

export const CHATGPT_CAPTURE_TIMEOUT_MS = 25_000;

const CHATGPT_ORIGIN = 'https://chatgpt.com';
const CHATGPT_TEMPORARY_TAB_URL = `${CHATGPT_ORIGIN}/`;
const MIN_TIMEOUT_MS = 1_000;
// Reserve one second for serial hook/tab cleanup plus scheduler tolerance.
const MAX_TIMEOUT_MS = 28_000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const CLEANUP_STEP_TIMEOUT_MS = 500;

/** A stable, intentionally non-diagnostic error safe to show at the UI boundary. */
export class ChatGptTemporaryCaptureError extends Error {
  readonly code: ChatGptCaptureErrorCode;

  constructor(code: ChatGptCaptureErrorCode) {
    super(CHATGPT_CAPTURE_ERROR_MESSAGES[code]);
    this.name = 'ChatGptTemporaryCaptureError';
    this.code = code;
  }
}

interface ChatGptCaptureScriptInjection {
  target: { tabId: number };
  world: 'MAIN';
  func: (...args: never[]) => unknown;
  args: unknown[];
}

interface ChatGptCaptureChromeApi {
  tabs: {
    create: (createProperties: { url: string; active: boolean }) => Promise<{ id?: number }>;
    remove: (tabId: number) => Promise<void>;
  };
  scripting: {
    executeScript: (
      injection: ChatGptCaptureScriptInjection
    ) => Promise<Array<{ result?: unknown }>>;
  };
}

export interface ChatGptTemporaryCaptureDependencies {
  chromeApi?: ChatGptCaptureChromeApi;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  createNonce?: () => string;
  digestSha256?: (bytes: Uint8Array) => Promise<string>;
}

type HookErrorCode = 'timed-out' | 'payload-too-large' | 'capture-failed';

type HookResult =
  | { kind: 'ready' }
  | { kind: 'captured'; capture: Omit<ChatGptCaptureArtifact, 'endpoint'> }
  | { kind: 'error'; code: HookErrorCode }
  | { kind: 'origin-rejected' }
  | { kind: 'cleaned' }
  | { kind: 'missing' };

type ReadinessResult = { kind: 'ready' } | { kind: 'waiting' } | { kind: 'origin-rejected' };

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return CHATGPT_CAPTURE_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(value)));
}

function normalizePollInterval(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_POLL_INTERVAL_MS;
  return Math.min(1_000, Math.max(1, Math.floor(value)));
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function remainingTimeout(deadline: number, now: () => number): number {
  return Math.max(1, deadline - now());
}

function withinTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  errorCode: ChatGptCaptureErrorCode
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ChatGptTemporaryCaptureError(errorCode)), timeoutMs);
    operation.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      reason => {
        clearTimeout(timer);
        reject(
          reason instanceof ChatGptTemporaryCaptureError
            ? reason
            : new ChatGptTemporaryCaptureError(errorCode)
        );
      }
    );
  });
}

function defaultNonce(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new ChatGptTemporaryCaptureError('capture-failed');
  }
  return globalThis.crypto.randomUUID();
}

function isSafeNonce(value: string): boolean {
  return /^[a-z0-9-]{16,128}$/i.test(value);
}

function firstScriptResult(results: Array<{ result?: unknown }>): unknown {
  return results[0]?.result;
}

function isHookResult(value: unknown, kind: HookResult['kind']): boolean {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === kind;
}

function isReadinessResult(value: unknown, kind: ReadinessResult['kind']): boolean {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === kind;
}

function isHookErrorResult(value: unknown): value is Extract<HookResult, { kind: 'error' }> {
  return isHookResult(value, 'error') && typeof (value as { code?: unknown }).code === 'string';
}

function base64ByteLength(value: string): number | undefined {
  if (!/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i.test(value)) {
    return undefined;
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

/** Decode only canonical standard base64, so page data cannot be lossy-normalized by a decoder. */
function strictBase64Bytes(value: string): Uint8Array | undefined {
  if (base64ByteLength(value) === undefined || typeof globalThis.atob !== 'function') {
    return undefined;
  }

  try {
    const binary = globalThis.atob(value);
    if (typeof globalThis.btoa !== 'function' || globalThis.btoa(binary) !== value) {
      return undefined;
    }
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function isJsonMediaType(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (
    value.length === 0 ||
    value.length > 255 ||
    Array.from(value).some(character => (character.codePointAt(0) ?? 0) <= 0x1f)
  ) {
    return false;
  }
  const essence = value.split(';', 1)[0]?.trim().toLowerCase();
  return essence === 'application/json' || essence?.endsWith('+json') === true;
}

async function defaultDigestSha256(bytes: Uint8Array): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw new ChatGptTemporaryCaptureError('capture-failed');
  }
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function mapHookError(code: unknown): ChatGptCaptureErrorCode {
  if (code === 'timed-out' || code === 'payload-too-large' || code === 'capture-failed') {
    return code;
  }
  return 'unexpected-capture-result';
}

function isCapturedResult(value: unknown): value is Extract<HookResult, { kind: 'captured' }> {
  if (!isHookResult(value, 'captured')) return false;
  const capture = (value as { capture?: unknown }).capture;
  if (typeof capture !== 'object' || capture === null) return false;
  const record = capture as Record<string, unknown>;
  return (
    typeof record.bodyBase64 === 'string' &&
    Number.isSafeInteger(record.byteLength) &&
    (record.byteLength as number) >= 0 &&
    (record.byteLength as number) <= CHATGPT_CAPTURE_MAX_BYTES &&
    base64ByteLength(record.bodyBase64) === record.byteLength &&
    typeof record.sha256 === 'string' &&
    /^[a-f0-9]{64}$/i.test(record.sha256) &&
    isJsonMediaType(record.mediaType)
  );
}

async function validateCapturedResult(
  value: unknown,
  digestSha256: (bytes: Uint8Array) => Promise<string>
): Promise<Omit<ChatGptCaptureArtifact, 'endpoint'> | undefined> {
  if (!isCapturedResult(value)) return undefined;

  const capture = value.capture;
  const bytes = strictBase64Bytes(capture.bodyBase64);
  if (
    bytes === undefined ||
    bytes.byteLength !== capture.byteLength ||
    bytes.byteLength > CHATGPT_CAPTURE_MAX_BYTES
  ) {
    return undefined;
  }

  let actualSha256: string;
  try {
    actualSha256 = await digestSha256(bytes);
  } catch {
    throw new ChatGptTemporaryCaptureError('capture-failed');
  }
  const normalizedSha256 = actualSha256.toLowerCase();
  if (
    !/^[a-f0-9]{64}$/.test(normalizedSha256) ||
    normalizedSha256 !== capture.sha256.toLowerCase()
  ) {
    return undefined;
  }

  return {
    bodyBase64: capture.bodyBase64,
    byteLength: capture.byteLength,
    sha256: normalizedSha256,
    mediaType: capture.mediaType,
  };
}

function makeDependencies(overrides: ChatGptTemporaryCaptureDependencies) {
  return {
    chromeApi: overrides.chromeApi ?? {
      tabs: chrome.tabs,
      scripting: chrome.scripting,
    },
    now: overrides.now ?? Date.now,
    sleep: overrides.sleep ?? defaultSleep,
    timeoutMs: normalizeTimeout(overrides.timeoutMs),
    pollIntervalMs: normalizePollInterval(overrides.pollIntervalMs),
    createNonce: overrides.createNonce ?? defaultNonce,
    digestSha256: overrides.digestSha256 ?? defaultDigestSha256,
  };
}

async function readPageReadiness(
  chromeApi: ChatGptCaptureChromeApi,
  tabId: number
): Promise<ReadinessResult> {
  try {
    const results = await chromeApi.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: probeChatGptTemporaryCaptureReadiness,
      args: [],
    });
    return firstScriptResult(results) as ReadinessResult;
  } catch {
    throw new ChatGptTemporaryCaptureError('hook-install-failed');
  }
}

async function waitForPageReadiness(
  chromeApi: ChatGptCaptureChromeApi,
  tabId: number,
  deadline: number,
  now: () => number,
  sleep: (milliseconds: number) => Promise<void>,
  pollIntervalMs: number
): Promise<void> {
  while (now() <= deadline) {
    const readiness = await withinTimeout(
      readPageReadiness(chromeApi, tabId),
      remainingTimeout(deadline, now),
      'hook-install-failed'
    );
    if (isReadinessResult(readiness, 'ready')) return;
    if (isReadinessResult(readiness, 'origin-rejected')) {
      throw new ChatGptTemporaryCaptureError('unexpected-origin');
    }
    if (!isReadinessResult(readiness, 'waiting')) {
      throw new ChatGptTemporaryCaptureError('hook-install-failed');
    }

    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining));
  }

  throw new ChatGptTemporaryCaptureError('timed-out');
}

async function installHook(
  chromeApi: ChatGptCaptureChromeApi,
  tabId: number,
  conversationId: string,
  nonce: string,
  timeoutMs: number
): Promise<HookResult> {
  try {
    const results = await chromeApi.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: installChatGptTemporaryCaptureHook,
      args: [conversationId, nonce, { maxBytes: CHATGPT_CAPTURE_MAX_BYTES, timeoutMs }],
    });
    return firstScriptResult(results) as HookResult;
  } catch {
    throw new ChatGptTemporaryCaptureError('hook-install-failed');
  }
}

function assertHookInstalled(installation: HookResult): void {
  if (isHookResult(installation, 'origin-rejected')) {
    throw new ChatGptTemporaryCaptureError('unexpected-origin');
  }
  if (!isHookResult(installation, 'ready')) {
    throw new ChatGptTemporaryCaptureError('hook-install-failed');
  }
}

async function readHookState(
  chromeApi: ChatGptCaptureChromeApi,
  tabId: number,
  nonce: string
): Promise<HookResult> {
  try {
    const results = await chromeApi.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: readChatGptTemporaryCaptureState,
      args: [nonce],
    });
    return firstScriptResult(results) as HookResult;
  } catch {
    throw new ChatGptTemporaryCaptureError('capture-failed');
  }
}

async function cleanupTemporaryTab(
  chromeApi: ChatGptCaptureChromeApi,
  tabId: number | undefined,
  nonce: string | undefined
): Promise<void> {
  if (tabId === undefined) return;

  if (nonce !== undefined) {
    await withinTimeout(
      chromeApi.scripting
        .executeScript({
          target: { tabId },
          world: 'MAIN',
          func: cleanupChatGptTemporaryCaptureHook,
          args: [nonce],
        })
        .catch(() => undefined),
      CLEANUP_STEP_TIMEOUT_MS,
      'capture-failed'
    ).catch(() => undefined);
  }

  await withinTimeout(
    chromeApi.tabs.remove(tabId),
    CLEANUP_STEP_TIMEOUT_MS,
    'capture-failed'
  ).catch(() => undefined);
}

/**
 * Capture the response created by ChatGPT's own client navigation in a fresh,
 * inactive tab. The tab is always closed; no existing user tab is touched.
 */
export async function captureChatGptInTemporaryTab(
  conversationId: string,
  overrides: ChatGptTemporaryCaptureDependencies = {}
): Promise<ChatGptCaptureArtifact> {
  if (!isChatGptConversationId(conversationId)) {
    throw new ChatGptTemporaryCaptureError('invalid-conversation-id');
  }

  const dependencies = makeDependencies(overrides);
  const deadline = dependencies.now() + dependencies.timeoutMs;
  let temporaryTabId: number | undefined;
  let nonce: string | undefined;

  try {
    let temporaryTab: { id?: number };
    try {
      temporaryTab = await withinTimeout(
        dependencies.chromeApi.tabs.create({
          url: CHATGPT_TEMPORARY_TAB_URL,
          active: false,
        }),
        remainingTimeout(deadline, dependencies.now),
        'temporary-tab-create-failed'
      );
    } catch {
      throw new ChatGptTemporaryCaptureError('temporary-tab-create-failed');
    }

    if (!Number.isSafeInteger(temporaryTab.id) || temporaryTab.id === undefined) {
      throw new ChatGptTemporaryCaptureError('temporary-tab-missing-id');
    }
    temporaryTabId = temporaryTab.id;

    await waitForPageReadiness(
      dependencies.chromeApi,
      temporaryTabId,
      deadline,
      dependencies.now,
      dependencies.sleep,
      dependencies.pollIntervalMs
    );

    try {
      nonce = dependencies.createNonce();
    } catch {
      throw new ChatGptTemporaryCaptureError('capture-failed');
    }
    if (!isSafeNonce(nonce)) {
      nonce = undefined;
      throw new ChatGptTemporaryCaptureError('capture-failed');
    }

    const installation = await withinTimeout(
      installHook(
        dependencies.chromeApi,
        temporaryTabId,
        conversationId,
        nonce,
        remainingTimeout(deadline, dependencies.now)
      ),
      remainingTimeout(deadline, dependencies.now),
      'hook-install-failed'
    );
    assertHookInstalled(installation);

    while (dependencies.now() <= deadline) {
      const state = await withinTimeout(
        readHookState(dependencies.chromeApi, temporaryTabId, nonce),
        remainingTimeout(deadline, dependencies.now),
        'timed-out'
      );
      const capture = await validateCapturedResult(state, dependencies.digestSha256);
      if (capture !== undefined) {
        return {
          ...capture,
          endpoint: CHATGPT_CAPTURE_ENDPOINT,
        };
      }
      if (isHookErrorResult(state)) {
        throw new ChatGptTemporaryCaptureError(mapHookError(state.code));
      }
      if (isHookResult(state, 'missing')) {
        // A full document navigation drops the MAIN-world hook. Do not retry in
        // a new document, because it could issue a different request.
        throw new ChatGptTemporaryCaptureError('capture-failed');
      }
      if (!isHookResult(state, 'ready')) {
        throw new ChatGptTemporaryCaptureError('unexpected-capture-result');
      }

      const remaining = deadline - dependencies.now();
      if (remaining <= 0) break;
      await dependencies.sleep(Math.min(dependencies.pollIntervalMs, remaining));
    }

    throw new ChatGptTemporaryCaptureError('timed-out');
  } finally {
    await cleanupTemporaryTab(dependencies.chromeApi, temporaryTabId, nonce);
  }
}

/**
 * MAIN-world readiness probe. A tab creation acknowledges only tab allocation,
 * not the document that will issue the navigation request. Wait for a complete
 * ChatGPT shell before injecting the one-document fetch observer.
 */
export function probeChatGptTemporaryCaptureReadiness(): ReadinessResult {
  const expectedOrigin = 'https://chatgpt.com';
  const href = window.location.href;

  if (href === 'about:blank' || document.readyState === 'loading') {
    return { kind: 'waiting' };
  }
  if (window.location.origin !== expectedOrigin) {
    return { kind: 'origin-rejected' };
  }

  // An interactive document can still be replacing its shell. Requiring the
  // public app landmark/root makes the hidden-anchor navigation conservative
  // without coupling to ChatGPT's private JavaScript globals.
  if (
    document.readyState !== 'complete' ||
    document.body === null ||
    document.querySelector('main, [role="main"], #root, #__next') === null
  ) {
    return { kind: 'waiting' };
  }
  return { kind: 'ready' };
}

/**
 * MAIN-world-only code. Keep this function self-contained: Chrome serializes
 * it into the ChatGPT page, so it must not reference module variables or
 * imported helpers.
 */
export function installChatGptTemporaryCaptureHook(
  expectedConversationId: string,
  nonce: string,
  options: { maxBytes: number; timeoutMs: number }
): HookResult {
  const origin = 'https://chatgpt.com';
  const stateKey = `__liskaChatGptCapture_${nonce}`;
  const windowRecord = window as unknown as Record<string, unknown>;

  if (window.location.origin !== origin) return { kind: 'origin-rejected' };
  if (windowRecord[stateKey] !== undefined) return { kind: 'ready' };

  type PageState = {
    originalFetch: typeof window.fetch;
    wrappedFetch: typeof window.fetch | undefined;
    timeoutId: ReturnType<typeof window.setTimeout> | undefined;
    settled: boolean;
    result: HookResult;
  };

  const endpointPath = `/backend-api/conversation/${encodeURIComponent(expectedConversationId)}`;
  const originalFetch = window.fetch;
  const state: PageState = {
    originalFetch,
    wrappedFetch: undefined,
    timeoutId: undefined,
    settled: false,
    result: { kind: 'ready' },
  };

  const restore = (): void => {
    if (state.timeoutId !== undefined) {
      window.clearTimeout(state.timeoutId);
      state.timeoutId = undefined;
    }
    if (state.wrappedFetch !== undefined && window.fetch === state.wrappedFetch) {
      window.fetch = state.originalFetch;
    }
  };

  const finish = (result: HookResult): void => {
    if (state.settled) return;
    state.settled = true;
    state.result = result;
    restore();
  };

  const jsonMime = (contentType: string): boolean => {
    const essence = contentType.split(';', 1)[0]?.trim().toLowerCase();
    return essence === 'application/json' || essence?.endsWith('+json') === true;
  };

  const isTargetRequest = (input: unknown, init: unknown): boolean => {
    try {
      const requestLike = input as { url?: unknown; method?: unknown } | null;
      const initLike = init as { method?: unknown } | null;
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : typeof requestLike?.url === 'string'
              ? requestLike.url
              : '';
      const method =
        typeof initLike?.method === 'string'
          ? initLike.method
          : typeof requestLike?.method === 'string'
            ? requestLike.method
            : 'GET';
      const url = new URL(rawUrl, window.location.href);
      return (
        method.toUpperCase() === 'GET' &&
        url.origin === origin &&
        url.pathname === endpointPath &&
        url.search === '' &&
        url.hash === ''
      );
    } catch {
      return false;
    }
  };

  const toBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return window.btoa(binary);
  };

  const readBoundedBytes = async (response: Response): Promise<Uint8Array> => {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      try {
        await response.body?.cancel();
      } catch {
        // The stable size error remains valid even if the transport cannot cancel.
      }
      throw new Error('payload-too-large');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > options.maxBytes) throw new Error('payload-too-large');
      return bytes;
    }

    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      byteLength += next.value.byteLength;
      if (byteLength > options.maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the stable size error if cancellation itself fails.
        }
        throw new Error('payload-too-large');
      }
      chunks.push(next.value);
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  };

  const captureResponse = async (response: Response, mediaType: string): Promise<void> => {
    try {
      const bytes = await readBoundedBytes(response.clone());
      const exactBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;
      const digest = await window.crypto.subtle.digest('SHA-256', exactBuffer);
      const sha256 = Array.from(new Uint8Array(digest), byte =>
        byte.toString(16).padStart(2, '0')
      ).join('');
      finish({
        kind: 'captured',
        capture: {
          bodyBase64: toBase64(bytes),
          byteLength: bytes.byteLength,
          sha256,
          mediaType,
        },
      });
    } catch (error) {
      finish({
        kind: 'error',
        code:
          error instanceof Error && error.message === 'payload-too-large'
            ? 'payload-too-large'
            : 'capture-failed',
      });
    }
  };

  const wrappedFetch = function (
    this: typeof window,
    ...args: Parameters<typeof window.fetch>
  ): ReturnType<typeof window.fetch> {
    const responsePromise = originalFetch.apply(this, args);
    if (!state.settled && isTargetRequest(args[0], args[1])) {
      void responsePromise
        .then(response => {
          const mediaType = response.headers.get('content-type')?.trim() ?? '';
          if (response.status === 200 && jsonMime(mediaType)) {
            return captureResponse(response, mediaType);
          }
          return undefined;
        })
        .catch(() => undefined);
    }
    return responsePromise;
  };

  Object.defineProperty(windowRecord, stateKey, {
    value: state,
    configurable: true,
    enumerable: false,
    writable: false,
  });
  window.fetch = wrappedFetch;
  state.wrappedFetch = wrappedFetch;
  state.timeoutId = window.setTimeout(
    () => finish({ kind: 'error', code: 'timed-out' }),
    options.timeoutMs
  );

  try {
    const anchor = document.createElement('a');
    anchor.href = `${origin}/c/${encodeURIComponent(expectedConversationId)}`;
    anchor.hidden = true;
    anchor.tabIndex = -1;
    anchor.setAttribute('aria-hidden', 'true');
    const parent = document.body ?? document.documentElement;
    parent.append(anchor);
    anchor.click();
    anchor.remove();
  } catch {
    finish({ kind: 'error', code: 'capture-failed' });
  }

  return { kind: 'ready' };
}

/** Read a result without exposing any page state except the captured artifact. */
export function readChatGptTemporaryCaptureState(nonce: string): HookResult {
  const stateKey = `__liskaChatGptCapture_${nonce}`;
  const state = (window as unknown as Record<string, unknown>)[stateKey] as
    | { result?: unknown }
    | undefined;
  if (!state || typeof state.result !== 'object' || state.result === null) {
    return { kind: 'missing' };
  }
  return state.result as HookResult;
}

/** Restore page primitives and delete the nonce-scoped readiness state. */
export function cleanupChatGptTemporaryCaptureHook(nonce: string): HookResult {
  const stateKey = `__liskaChatGptCapture_${nonce}`;
  const windowRecord = window as unknown as Record<string, unknown>;
  const state = windowRecord[stateKey] as
    | {
        originalFetch?: typeof window.fetch;
        wrappedFetch?: typeof window.fetch;
        timeoutId?: ReturnType<typeof window.setTimeout>;
      }
    | undefined;
  if (!state) return { kind: 'missing' };

  if (state.timeoutId !== undefined) window.clearTimeout(state.timeoutId);
  if (
    typeof state.originalFetch === 'function' &&
    state.wrappedFetch !== undefined &&
    window.fetch === state.wrappedFetch
  ) {
    window.fetch = state.originalFetch;
  }
  delete windowRecord[stateKey];
  return { kind: 'cleaned' };
}
