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
  CHATGPT_TRANSIENT_ASSET_RESOLVERS_MAX_COUNT,
  isChatGptConversationId,
  isChatGptTransientDownloadUrl,
} from '../lib/chatgpt-capture-contract';
import type {
  ChatGptCaptureArtifact,
  ChatGptCaptureErrorCode,
  ChatGptTransientAssetResolver,
} from '../lib/chatgpt-capture-contract';
import { canonicalBase64ByteLength } from '../lib/base64';

export {
  CHATGPT_CAPTURE_ENDPOINT,
  CHATGPT_CAPTURE_MAX_BYTES,
} from '../lib/chatgpt-capture-contract';
export type {
  ChatGptCaptureArtifact as ChatGptTemporaryCaptureResult,
  ChatGptCaptureErrorCode as ChatGptTemporaryCaptureErrorCode,
} from '../lib/chatgpt-capture-contract';

export const CHATGPT_CAPTURE_TIMEOUT_MS = 190_000;

const CHATGPT_ORIGIN = 'https://chatgpt.com';
const CAPTURE_FRAGMENT_PREFIX = '#liska-capture=';
const RESOLVER_OBSERVATION_FRAGMENT = '&liska-observe-asset-resolvers=1';
const MIN_TIMEOUT_MS = 1_000;
// Let the page-owned 180-second timeout win before background cleanup.
const MAX_TIMEOUT_MS = 195_000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const CLEANUP_STEP_TIMEOUT_MS = 500;
const CHATGPT_RESOLVER_MAX_BYTES = 64 * 1024;
const CHATGPT_RESOLVER_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const CHATGPT_RESOLVER_KEY_DOMAIN = 'liska-chatgpt-resolver/1\u0000';

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
  /** Defaults to false so ordinary conversation capture stays on the fast path. */
  observeAssetResolvers?: boolean;
}

type HookErrorCode =
  | 'hook-state-failed'
  | 'request-failed'
  | 'response-http-error'
  | 'response-media-type-invalid'
  | 'response-processing-failed'
  | 'conversation-request-timeout'
  | 'conversation-response-timeout'
  | 'timed-out'
  | 'payload-too-large'
  | 'capture-failed';

type HookResult =
  | { kind: 'ready' }
  | {
      kind: 'captured';
      conversationId: string;
      capture: Omit<ChatGptCaptureArtifact, 'endpoint' | 'transientAssetResolvers'>;
      resolverObservations: RawResolverObservation[];
    }
  | { kind: 'error'; code: HookErrorCode }
  | { kind: 'missing' };

type RawResolverObservation = {
  providerFileId: string;
  bodyBase64: string;
  byteLength: number;
  sha256: string;
  mediaType: string;
};

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
    throw new ChatGptTemporaryCaptureError('nonce-unavailable');
  }
  return globalThis.crypto.randomUUID();
}

function isSafeNonce(value: string): boolean {
  return /^[a-z0-9-]{16,128}$/i.test(value);
}

function temporaryTargetUrl(
  conversationId: string,
  nonce: string,
  observeAssetResolvers: boolean
): string {
  return `${CHATGPT_ORIGIN}/c/${encodeURIComponent(conversationId)}${CAPTURE_FRAGMENT_PREFIX}${nonce}${observeAssetResolvers ? RESOLVER_OBSERVATION_FRAGMENT : ''}`;
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

/** Decode only canonical standard base64, so page data cannot be lossy-normalized by a decoder. */
function strictBase64Bytes(value: string): Uint8Array | undefined {
  if (canonicalBase64ByteLength(value) === undefined || typeof globalThis.atob !== 'function') {
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
    throw new ChatGptTemporaryCaptureError('hash-unavailable');
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
    code === 'conversation-request-timeout' ||
    code === 'conversation-response-timeout' ||
    code === 'timed-out' ||
    code === 'payload-too-large' ||
    code === 'capture-failed'
  ) {
    return code;
  }
  return 'unexpected-capture-result';
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

function isCaptureRecord(value: unknown, maxBytes: number): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.bodyBase64 === 'string' &&
    Number.isSafeInteger(record.byteLength) &&
    (record.byteLength as number) >= 0 &&
    (record.byteLength as number) <= maxBytes &&
    canonicalBase64ByteLength(record.bodyBase64) === record.byteLength &&
    typeof record.sha256 === 'string' &&
    /^[a-f0-9]{64}$/i.test(record.sha256) &&
    isJsonMediaType(record.mediaType)
  );
}

function isCapturedResult(value: unknown): value is Extract<HookResult, { kind: 'captured' }> {
  if (
    !isHookResult(value, 'captured') ||
    !hasExactKeys(value as object, ['kind', 'conversationId', 'capture', 'resolverObservations'])
  ) {
    return false;
  }
  const result = value as Record<string, unknown>;
  const capture = (value as { capture?: unknown }).capture;
  return (
    typeof result.conversationId === 'string' && isCaptureRecord(capture, CHATGPT_CAPTURE_MAX_BYTES)
  );
}

function isRawResolverObservation(value: unknown): value is RawResolverObservation {
  if (typeof value !== 'object' || value === null) return false;
  if (!hasExactKeys(value, ['providerFileId', 'bodyBase64', 'byteLength', 'sha256', 'mediaType'])) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.providerFileId === 'string' &&
    CHATGPT_RESOLVER_FILE_ID_PATTERN.test(record.providerFileId) &&
    isCaptureRecord(
      {
        bodyBase64: record.bodyBase64,
        byteLength: record.byteLength,
        sha256: record.sha256,
        mediaType: record.mediaType,
      },
      CHATGPT_RESOLVER_MAX_BYTES
    )
  );
}

function parseResolverDownloadUrl(bytes: Uint8Array): string | undefined {
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(source);
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      !Object.prototype.hasOwnProperty.call(value, 'status') ||
      (value as { status?: unknown }).status !== 'Success' ||
      !Object.prototype.hasOwnProperty.call(value, 'download_url') ||
      typeof (value as { download_url?: unknown }).download_url !== 'string'
    ) {
      return undefined;
    }
    return (value as { download_url: string }).download_url;
  } catch {
    return undefined;
  }
}

async function validateResolverObservation(
  value: unknown,
  conversationId: string,
  digestSha256: (bytes: Uint8Array) => Promise<string>
): Promise<ChatGptTransientAssetResolver | undefined> {
  if (!isRawResolverObservation(value)) return undefined;
  const bytes = strictBase64Bytes(value.bodyBase64);
  if (bytes === undefined || bytes.byteLength !== value.byteLength) return undefined;

  let responseSha256: string;
  try {
    responseSha256 = (await digestSha256(bytes)).toLowerCase();
  } catch {
    return undefined;
  }
  if (!/^[a-f0-9]{64}$/.test(responseSha256) || responseSha256 !== value.sha256.toLowerCase()) {
    return undefined;
  }

  const downloadUrl = parseResolverDownloadUrl(bytes);
  if (downloadUrl === undefined || !isChatGptTransientDownloadUrl(downloadUrl, conversationId)) {
    return undefined;
  }

  let resolverKey: string;
  try {
    const resolverKeyBytes = new TextEncoder().encode(
      `${CHATGPT_RESOLVER_KEY_DOMAIN}${value.providerFileId}`
    );
    resolverKey = (await digestSha256(resolverKeyBytes)).toLowerCase();
  } catch {
    return undefined;
  }
  return /^[a-f0-9]{64}$/.test(resolverKey) ? { resolverKey, downloadUrl } : undefined;
}

/**
 * Validate bounded resolver JSON clones before their provider identifiers are
 * domain-separated into runtime-only resolver keys.  This is shared by the
 * legacy capture bridge and the post-persistence opaque observer; neither
 * caller may persist or log the raw observation values.
 */
export async function validateChatGptResolverObservations(
  observations: unknown[],
  conversationId: string,
  digestSha256: (bytes: Uint8Array) => Promise<string>
): Promise<ChatGptTransientAssetResolver[]> {
  if (observations.length > CHATGPT_TRANSIENT_ASSET_RESOLVERS_MAX_COUNT) return [];
  const result: ChatGptTransientAssetResolver[] = [];
  const resolverKeys = new Set<string>();
  for (const observation of observations) {
    if (!isRawResolverObservation(observation)) continue;
    const resolver = await validateResolverObservation(observation, conversationId, digestSha256);
    if (resolver === undefined || resolverKeys.has(resolver.resolverKey)) continue;
    resolverKeys.add(resolver.resolverKey);
    result.push(resolver);
  }
  return result;
}

async function validateCapturedResult(
  value: unknown,
  expectedConversationId: string,
  digestSha256: (bytes: Uint8Array) => Promise<string>
): Promise<Omit<ChatGptCaptureArtifact, 'endpoint'> | undefined> {
  if (!isCapturedResult(value)) return undefined;
  if (value.conversationId !== expectedConversationId) {
    throw new ChatGptTemporaryCaptureError('captured-conversation-id-mismatch');
  }

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
    throw new ChatGptTemporaryCaptureError('hash-unavailable');
  }
  const normalizedSha256 = actualSha256.toLowerCase();
  if (
    !/^[a-f0-9]{64}$/.test(normalizedSha256) ||
    normalizedSha256 !== capture.sha256.toLowerCase()
  ) {
    throw new ChatGptTemporaryCaptureError('response-integrity-invalid');
  }

  return {
    bodyBase64: capture.bodyBase64,
    byteLength: capture.byteLength,
    sha256: normalizedSha256,
    mediaType: capture.mediaType,
    transientAssetResolvers: await validateChatGptResolverObservations(
      Array.isArray(value.resolverObservations) ? value.resolverObservations : [],
      expectedConversationId,
      digestSha256
    ),
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
    observeAssetResolvers: overrides.observeAssetResolvers === true,
  };
}

type ResolvedCaptureDependencies = ReturnType<typeof makeDependencies>;

function createSafeNonce(createNonce: () => string): string {
  let nonce: string;
  try {
    nonce = createNonce();
  } catch (error) {
    throw error instanceof ChatGptTemporaryCaptureError
      ? error
      : new ChatGptTemporaryCaptureError('nonce-unavailable');
  }
  if (!isSafeNonce(nonce)) {
    throw new ChatGptTemporaryCaptureError('nonce-invalid');
  }
  return nonce;
}

async function removeTemporaryTab(
  chromeApi: ChatGptCaptureChromeApi,
  tabId: number
): Promise<void> {
  let removal: unknown;
  try {
    // Chromium forks may expose only the legacy callback/void form. The
    // callback is optional, so a void return still means removal was started.
    removal = chromeApi.tabs.remove(tabId);
  } catch {
    return;
  }
  if (
    typeof removal !== 'object' ||
    removal === null ||
    typeof (removal as PromiseLike<void>).then !== 'function'
  ) {
    return;
  }
  await withinTimeout(
    Promise.resolve(removal as PromiseLike<void>),
    CLEANUP_STEP_TIMEOUT_MS,
    'capture-failed'
  ).catch(() => undefined);
}

async function createTemporaryTab(
  chromeApi: ChatGptCaptureChromeApi,
  conversationId: string,
  nonce: string,
  observeAssetResolvers: boolean,
  deadline: number,
  now: () => number
): Promise<number> {
  let creation: Promise<{ id?: number }>;
  try {
    creation = chromeApi.tabs.create({
      url: temporaryTargetUrl(conversationId, nonce, observeAssetResolvers),
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
      'temporary-tab-ready-timeout'
    );
    if (isReadinessResult(readiness, 'ready')) return;
    if (isReadinessResult(readiness, 'origin-rejected')) {
      throw new ChatGptTemporaryCaptureError('unexpected-origin');
    }
    if (isReadinessResult(readiness, 'path-rejected')) {
      throw new ChatGptTemporaryCaptureError('unexpected-path');
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining));
  }

  throw new ChatGptTemporaryCaptureError('temporary-tab-ready-timeout');
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
  conversationId: string,
  deadline: number
): Promise<ChatGptCaptureArtifact> {
  while (dependencies.now() <= deadline) {
    const state = await withinTimeout(
      readHookState(dependencies.chromeApi, tabId, nonce),
      remainingTimeout(deadline, dependencies.now),
      'capture-result-timeout'
    );
    const capture = await validateCapturedResult(state, conversationId, dependencies.digestSha256);
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
  throw new ChatGptTemporaryCaptureError('capture-result-timeout');
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
      dependencies.observeAssetResolvers,
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
    return await waitForCapturedResult(
      dependencies,
      temporaryTabId,
      nonce,
      conversationId,
      deadline
    );
  } finally {
    await cleanupTemporaryTab(dependencies.chromeApi, temporaryTabId);
  }
}

/**
 * Read the document-start getter through ordinary property access. This is
 * serialized into MAIN world, where Object/Function/Number built-ins are page
 * mutable; the extension-world validator checks all non-primitive invariants.
 */
// eslint-disable-next-line complexity, max-lines-per-function -- Chrome serializes this allowlist reader into MAIN world, so its primitive-only validation must stay self-contained.
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
        code === 'conversation-request-timeout' ||
        code === 'conversation-response-timeout' ||
        code === 'timed-out' ||
        code === 'payload-too-large' ||
        code === 'capture-failed'
      ) {
        return { kind: 'error', code };
      }
      return { kind: 'missing' };
    }

    if (result.kind !== 'captured') return { kind: 'missing' };
    const conversationId = result.conversationId;
    const capture = result.capture;
    const rawObservations = Array.isArray(result.resolverObservations)
      ? result.resolverObservations
      : [];
    if (typeof conversationId !== 'string' || typeof capture !== 'object' || capture === null) {
      return { kind: 'missing' };
    }
    const record = capture as Record<string, unknown>;
    if (
      typeof record.bodyBase64 !== 'string' ||
      typeof record.byteLength !== 'number' ||
      typeof record.sha256 !== 'string' ||
      typeof record.mediaType !== 'string'
    ) {
      return { kind: 'missing' };
    }
    const resolverObservations: RawResolverObservation[] = [];
    if (rawObservations.length <= CHATGPT_TRANSIENT_ASSET_RESOLVERS_MAX_COUNT) {
      for (let index = 0; index < rawObservations.length; index += 1) {
        const observation = rawObservations[index];
        if (typeof observation !== 'object' || observation === null) continue;
        const resolver = observation as Record<string, unknown>;
        if (
          typeof resolver.providerFileId !== 'string' ||
          typeof resolver.bodyBase64 !== 'string' ||
          typeof resolver.byteLength !== 'number' ||
          typeof resolver.sha256 !== 'string' ||
          typeof resolver.mediaType !== 'string'
        ) {
          continue;
        }
        resolverObservations[resolverObservations.length] = {
          providerFileId: resolver.providerFileId,
          bodyBase64: resolver.bodyBase64,
          byteLength: resolver.byteLength,
          sha256: resolver.sha256,
          mediaType: resolver.mediaType,
        };
      }
    }
    return {
      kind: 'captured',
      conversationId,
      capture: {
        bodyBase64: record.bodyBase64,
        byteLength: record.byteLength,
        sha256: record.sha256,
        mediaType: record.mediaType,
      },
      resolverObservations,
    };
  } catch {
    return { kind: 'missing' };
  }
}
