/**
 * Safe capture of ChatGPT's own conversation request in a disposable tab.
 *
 * The extension never recreates ChatGPT's authenticated request. A manifest-
 * declared MAIN-world script is armed by a nonce marker before page JavaScript
 * starts, then observes the page's own exact conversation fetch. Background
 * code only opens the temporary route, reads a tiny nonce-scoped result, and
 * closes the tab it created.
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
const CAPTURE_FRAGMENT_PREFIX = '#liska-capture=';
const MIN_TIMEOUT_MS = 1_000;
// Reserve one second for serial state/tab cleanup plus scheduler tolerance.
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
    get: (tabId: number) => Promise<{ status?: string; url?: string }>;
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

type HookErrorCode =
  | 'hook-state-failed'
  | 'request-failed'
  | 'response-http-error'
  | 'response-media-type-invalid'
  | 'response-processing-failed'
  | 'timed-out'
  | 'payload-too-large'
  | 'capture-failed';

type HookResult =
  | { kind: 'ready' }
  | { kind: 'captured'; capture: Omit<ChatGptCaptureArtifact, 'endpoint'> }
  | { kind: 'error'; code: HookErrorCode }
  | { kind: 'missing' };

type ReadinessResult =
  | { kind: 'ready' }
  | { kind: 'waiting' }
  | { kind: 'origin-rejected' }
  | { kind: 'path-rejected' };

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

function temporaryTargetUrl(conversationId: string, nonce: string): string {
  return `${CHATGPT_ORIGIN}/c/${encodeURIComponent(conversationId)}${CAPTURE_FRAGMENT_PREFIX}${nonce}`;
}

function temporaryTargetPath(conversationId: string): string {
  return `/c/${encodeURIComponent(conversationId)}`;
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
  if (
    code === 'hook-state-failed' ||
    code === 'request-failed' ||
    code === 'response-http-error' ||
    code === 'response-media-type-invalid' ||
    code === 'response-processing-failed' ||
    code === 'timed-out' ||
    code === 'payload-too-large' ||
    code === 'capture-failed'
  ) {
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

type ResolvedCaptureDependencies = ReturnType<typeof makeDependencies>;

function createSafeNonce(createNonce: () => string): string {
  let nonce: string;
  try {
    nonce = createNonce();
  } catch {
    throw new ChatGptTemporaryCaptureError('capture-failed');
  }
  if (!isSafeNonce(nonce)) {
    throw new ChatGptTemporaryCaptureError('capture-failed');
  }
  return nonce;
}

async function removeTemporaryTab(
  chromeApi: ChatGptCaptureChromeApi,
  tabId: number
): Promise<void> {
  await withinTimeout(
    chromeApi.tabs.remove(tabId),
    CLEANUP_STEP_TIMEOUT_MS,
    'capture-failed'
  ).catch(() => undefined);
}

async function createTemporaryTab(
  chromeApi: ChatGptCaptureChromeApi,
  conversationId: string,
  nonce: string,
  deadline: number,
  now: () => number
): Promise<number> {
  let creation: Promise<{ id?: number }>;
  try {
    creation = chromeApi.tabs.create({
      url: temporaryTargetUrl(conversationId, nonce),
      active: false,
    });
  } catch {
    throw new ChatGptTemporaryCaptureError('temporary-tab-create-failed');
  }

  let creationTimedOut = false;
  let lateRemovalScheduled = false;
  void creation.then(
    temporaryTab => {
      if (
        creationTimedOut &&
        !lateRemovalScheduled &&
        Number.isSafeInteger(temporaryTab.id) &&
        temporaryTab.id !== undefined
      ) {
        lateRemovalScheduled = true;
        void removeTemporaryTab(chromeApi, temporaryTab.id);
      }
    },
    () => undefined
  );

  let temporaryTab: { id?: number };
  try {
    temporaryTab = await withinTimeout(
      creation,
      remainingTimeout(deadline, now),
      'temporary-tab-create-failed'
    );
  } catch {
    creationTimedOut = true;
    throw new ChatGptTemporaryCaptureError('temporary-tab-create-failed');
  }

  if (!Number.isSafeInteger(temporaryTab.id) || temporaryTab.id === undefined) {
    throw new ChatGptTemporaryCaptureError('temporary-tab-missing-id');
  }
  return temporaryTab.id;
}

async function readTemporaryTabReadiness(
  chromeApi: ChatGptCaptureChromeApi,
  tabId: number,
  conversationId: string
): Promise<ReadinessResult> {
  try {
    const tab = await chromeApi.tabs.get(tabId);
    if (tab.status !== 'complete' || typeof tab.url !== 'string' || tab.url === 'about:blank') {
      return { kind: 'waiting' };
    }

    try {
      const url = new URL(tab.url);
      if (url.origin !== CHATGPT_ORIGIN || url.username !== '' || url.password !== '') {
        return { kind: 'origin-rejected' };
      }
      return url.pathname === temporaryTargetPath(conversationId) && url.search === ''
        ? { kind: 'ready' }
        : { kind: 'path-rejected' };
    } catch {
      return { kind: 'waiting' };
    }
  } catch {
    // A just-created tab may be unavailable briefly. Treat it as unready; the
    // caller keeps retrying under the existing bounded capture deadline.
    return { kind: 'waiting' };
  }
}

async function waitForTemporaryTarget(
  chromeApi: ChatGptCaptureChromeApi,
  tabId: number,
  conversationId: string,
  deadline: number,
  now: () => number,
  sleep: (milliseconds: number) => Promise<void>,
  pollIntervalMs: number
): Promise<void> {
  while (now() <= deadline) {
    const readiness = await withinTimeout(
      readTemporaryTabReadiness(chromeApi, tabId, conversationId),
      remainingTimeout(deadline, now),
      'timed-out'
    );
    if (isReadinessResult(readiness, 'ready')) return;
    if (isReadinessResult(readiness, 'origin-rejected')) {
      throw new ChatGptTemporaryCaptureError('unexpected-origin');
    }
    if (isReadinessResult(readiness, 'path-rejected')) {
      throw new ChatGptTemporaryCaptureError('capture-failed');
    }
    if (!isReadinessResult(readiness, 'waiting')) {
      throw new ChatGptTemporaryCaptureError('capture-failed');
    }

    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining));
  }

  throw new ChatGptTemporaryCaptureError('timed-out');
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
    const result = firstScriptResult(results);
    return result === undefined ? { kind: 'missing' } : (result as HookResult);
  } catch {
    // A browser that lacks the static MAIN-world entry (or a document that is
    // still starting) looks exactly like a missing state until the deadline.
    return { kind: 'missing' };
  }
}

async function waitForCapturedResult(
  dependencies: ResolvedCaptureDependencies,
  tabId: number,
  nonce: string,
  deadline: number
): Promise<ChatGptCaptureArtifact> {
  while (dependencies.now() <= deadline) {
    const state = await withinTimeout(
      readHookState(dependencies.chromeApi, tabId, nonce),
      remainingTimeout(deadline, dependencies.now),
      'timed-out'
    );
    const capture = await validateCapturedResult(state, dependencies.digestSha256);
    if (capture !== undefined) {
      return { ...capture, endpoint: CHATGPT_CAPTURE_ENDPOINT };
    }
    if (isHookErrorResult(state)) {
      throw new ChatGptTemporaryCaptureError(mapHookError(state.code));
    }
    if (!isHookResult(state, 'ready') && !isHookResult(state, 'missing')) {
      throw new ChatGptTemporaryCaptureError('unexpected-capture-result');
    }

    // The static document-start entry may not have run yet, may be blocked on
    // an older browser, or may have been removed by an external redirect.
    // Missing state is therefore a bounded wait, not a retry or injection.
    const remaining = deadline - dependencies.now();
    if (remaining <= 0) break;
    await dependencies.sleep(Math.min(dependencies.pollIntervalMs, remaining));
  }
  throw new ChatGptTemporaryCaptureError('timed-out');
}

async function cleanupTemporaryTab(
  chromeApi: ChatGptCaptureChromeApi,
  tabId: number | undefined
): Promise<void> {
  if (tabId === undefined) return;
  await removeTemporaryTab(chromeApi, tabId);
}

/**
 * Capture the response from ChatGPT's own page-native conversation request in
 * a fresh inactive tab. The tab is always closed; no existing user tab is
 * touched, and background code never issues a provider request.
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
    nonce = createSafeNonce(dependencies.createNonce);
    temporaryTabId = await createTemporaryTab(
      dependencies.chromeApi,
      conversationId,
      nonce,
      deadline,
      dependencies.now
    );

    await waitForTemporaryTarget(
      dependencies.chromeApi,
      temporaryTabId,
      conversationId,
      deadline,
      dependencies.now,
      dependencies.sleep,
      dependencies.pollIntervalMs
    );
    return await waitForCapturedResult(dependencies, temporaryTabId, nonce, deadline);
  } finally {
    await cleanupTemporaryTab(dependencies.chromeApi, temporaryTabId);
  }
}

/**
 * Read the document-start getter through ordinary property access. This is
 * serialized into MAIN world, where Object/Function/Number built-ins are page
 * mutable; the extension-world validator checks all non-primitive invariants.
 */
// eslint-disable-next-line complexity -- Chrome serializes this allowlist reader into MAIN world, so its primitive-only validation must stay self-contained.
export function readChatGptTemporaryCaptureState(nonce: string): HookResult {
  const stateKey = `__liskaChatGptCapture_${nonce}`;
  try {
    const pageWindow = window as unknown as Record<string, unknown>;
    const snapshot = pageWindow[stateKey];
    if (typeof snapshot !== 'object' || snapshot === null) return { kind: 'missing' };
    const result = snapshot as Record<string, unknown>;
    if (result.kind === 'ready') return { kind: 'ready' };

    if (result.kind === 'error') {
      const code = result.code;
      if (
        code === 'hook-state-failed' ||
        code === 'request-failed' ||
        code === 'response-http-error' ||
        code === 'response-media-type-invalid' ||
        code === 'response-processing-failed' ||
        code === 'timed-out' ||
        code === 'payload-too-large' ||
        code === 'capture-failed'
      ) {
        return { kind: 'error', code };
      }
      return { kind: 'missing' };
    }

    if (result.kind !== 'captured') return { kind: 'missing' };
    const capture = result.capture;
    if (typeof capture !== 'object' || capture === null) return { kind: 'missing' };
    const record = capture as Record<string, unknown>;
    if (
      typeof record.bodyBase64 !== 'string' ||
      typeof record.byteLength !== 'number' ||
      typeof record.sha256 !== 'string' ||
      typeof record.mediaType !== 'string'
    ) {
      return { kind: 'missing' };
    }
    return {
      kind: 'captured',
      capture: {
        bodyBase64: record.bodyBase64,
        byteLength: record.byteLength,
        sha256: record.sha256,
        mediaType: record.mediaType,
      },
    };
  } catch {
    return { kind: 'missing' };
  }
}
