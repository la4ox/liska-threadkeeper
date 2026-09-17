/**
 * Disposable-tab runtime for the experimental, marker-gated ChatGPT opaque
 * replay.  It reads only the nonce-scoped credential-free result produced in
 * MAIN world; this module has no service-worker registration or UI route.
 */

import { canonicalBase64ByteLength } from '../lib/base64';
import { CHATGPT_CAPTURE_ENDPOINT, isChatGptConversationId } from '../lib/chatgpt-capture-contract';
import {
  createChatGptOpaqueReplayFailure,
  isChatGptOpaqueReplayHookResult,
  type ChatGptOpaqueReplayArtifact,
  type ChatGptOpaqueReplayErrorCode,
  type ChatGptOpaqueReplayHookResult,
  type ChatGptOpaqueReplayResponse,
} from '../lib/chatgpt-opaque-replay-contract';

export const CHATGPT_OPAQUE_REPLAY_TIMEOUT_MS = 190_000;

const CHATGPT_ORIGIN = 'https://chatgpt.com';
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 195_000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const CLEANUP_STEP_TIMEOUT_MS = 500;

interface ReplayScriptInjection {
  target: { tabId: number };
  world: 'MAIN';
  func: (...args: never[]) => unknown;
  args: unknown[];
}

interface ReplayChromeApi {
  tabs: {
    create: (createProperties: { url: string; active: boolean }) => Promise<{ id?: number }>;
    get: (tabId: number) => Promise<{ status?: string; url?: string }>;
    remove: (tabId: number) => Promise<void>;
  };
  scripting: {
    executeScript: (injection: ReplayScriptInjection) => Promise<Array<{ result?: unknown }>>;
  };
}

export interface ChatGptOpaqueReplayDependencies {
  chromeApi?: ReplayChromeApi;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  createNonce?: () => string;
  digestSha256?: (bytes: Uint8Array) => Promise<string>;
}

type HookState = ChatGptOpaqueReplayHookResult | { kind: 'missing' };
type Readiness = 'ready' | 'waiting' | 'unexpected-origin' | 'unexpected-path';

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return CHATGPT_OPAQUE_REPLAY_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(value)));
}

function normalizePollInterval(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_POLL_INTERVAL_MS;
  return Math.min(1_000, Math.max(1, Math.floor(value)));
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function defaultNonce(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('nonce unavailable');
  return globalThis.crypto.randomUUID();
}

async function defaultDigestSha256(bytes: Uint8Array): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') throw new Error('hash unavailable');
  const exactBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', exactBuffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function safeNonce(createNonce: () => string): string | undefined {
  try {
    const nonce = createNonce();
    return /^[a-z0-9-]{16,128}$/i.test(nonce) ? nonce : undefined;
  } catch {
    return undefined;
  }
}

function targetPath(conversationId: string): string {
  return `/c/${encodeURIComponent(conversationId)}`;
}

function marker(nonce: string): string {
  return `#liska-capture=${nonce}&liska-opaque-replay=1`;
}

function targetUrl(conversationId: string, nonce: string): string {
  return `${CHATGPT_ORIGIN}${targetPath(conversationId)}${marker(nonce)}`;
}

function remainingTimeout(deadline: number, now: () => number): number {
  return Math.max(1, deadline - now());
}

function withinDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), timeoutMs);
    operation.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      reason => {
        clearTimeout(timer);
        reject(reason);
      }
    );
  });
}

function resolvedDependencies(overrides: ChatGptOpaqueReplayDependencies) {
  return {
    chromeApi: overrides.chromeApi ?? { tabs: chrome.tabs, scripting: chrome.scripting },
    now: overrides.now ?? Date.now,
    sleep: overrides.sleep ?? defaultSleep,
    timeoutMs: normalizeTimeout(overrides.timeoutMs),
    pollIntervalMs: normalizePollInterval(overrides.pollIntervalMs),
    createNonce: overrides.createNonce ?? defaultNonce,
    digestSha256: overrides.digestSha256 ?? defaultDigestSha256,
  };
}

async function removeTemporaryTab(
  chromeApi: ReplayChromeApi,
  tabId: number | undefined
): Promise<void> {
  if (tabId === undefined) return;
  try {
    const removal = chromeApi.tabs.remove(tabId);
    if (typeof (removal as PromiseLike<void>)?.then === 'function') {
      await withinDeadline(Promise.resolve(removal), CLEANUP_STEP_TIMEOUT_MS).catch(
        () => undefined
      );
    }
  } catch {
    // Best effort cleanup is intentionally fail-silent.
  }
}

async function waitForTemporaryTarget(
  chromeApi: ReplayChromeApi,
  tabId: number,
  conversationId: string,
  nonce: string,
  deadline: number,
  now: () => number,
  sleep: (milliseconds: number) => Promise<void>,
  pollIntervalMs: number
): Promise<Readiness> {
  while (now() <= deadline) {
    let readiness: Readiness = 'waiting';
    try {
      const tab = await withinDeadline(chromeApi.tabs.get(tabId), remainingTimeout(deadline, now));
      if (tab.status === 'complete' && typeof tab.url === 'string' && tab.url !== 'about:blank') {
        const url = new URL(tab.url);
        if (url.origin !== CHATGPT_ORIGIN || url.username !== '' || url.password !== '') {
          readiness = 'unexpected-origin';
        } else if (
          url.pathname === targetPath(conversationId) &&
          url.search === '' &&
          url.hash === marker(nonce)
        ) {
          readiness = 'ready';
        } else {
          readiness = 'unexpected-path';
        }
      }
    } catch {
      readiness = 'waiting';
    }
    if (readiness !== 'waiting') return readiness;
    const remaining = deadline - now();
    if (remaining <= 0) break;
    try {
      await withinDeadline(
        Promise.resolve(sleep(Math.min(pollIntervalMs, remaining))),
        remainingTimeout(deadline, now)
      );
    } catch {
      break;
    }
  }
  return 'waiting';
}

async function readHookState(
  chromeApi: ReplayChromeApi,
  tabId: number,
  nonce: string,
  deadline: number,
  now: () => number
): Promise<HookState> {
  try {
    const execution = await withinDeadline(
      chromeApi.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: readChatGptOpaqueReplayState,
        args: [nonce],
      }),
      remainingTimeout(deadline, now)
    );
    const result = execution[0]?.result;
    return isChatGptOpaqueReplayHookResult(result) ? result : { kind: 'missing' };
  } catch {
    return { kind: 'missing' };
  }
}

function strictBase64Bytes(value: string): Uint8Array | undefined {
  if (canonicalBase64ByteLength(value) === undefined || typeof globalThis.atob !== 'function') {
    return undefined;
  }
  try {
    const binary = globalThis.atob(value);
    if (typeof globalThis.btoa !== 'function' || globalThis.btoa(binary) !== value)
      return undefined;
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

async function artifactFromHookResult(
  result: Extract<ChatGptOpaqueReplayHookResult, { kind: 'captured' }>,
  conversationId: string,
  digestSha256: (bytes: Uint8Array) => Promise<string>
): Promise<ChatGptOpaqueReplayArtifact | undefined> {
  if (result.conversationId !== conversationId || result.singularDispatchCount !== 1)
    return undefined;
  const bytes = strictBase64Bytes(result.capture.bodyBase64);
  if (bytes === undefined || bytes.byteLength !== result.capture.byteLength) return undefined;
  try {
    const sha256 = (await digestSha256(bytes)).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256) || sha256 !== result.capture.sha256.toLowerCase()) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return {
    bodyBase64: result.capture.bodyBase64,
    byteLength: result.capture.byteLength,
    sha256: result.capture.sha256.toLowerCase(),
    mediaType: result.capture.mediaType,
    endpoint: CHATGPT_CAPTURE_ENDPOINT,
    transientAssetResolvers: [],
  };
}

async function waitForReplayResult(
  resolved: ReturnType<typeof resolvedDependencies>,
  tabId: number,
  nonce: string,
  conversationId: string,
  deadline: number
): Promise<ChatGptOpaqueReplayResponse> {
  while (resolved.now() <= deadline) {
    const state = await readHookState(resolved.chromeApi, tabId, nonce, deadline, resolved.now);
    if (state.kind === 'error') {
      return createChatGptOpaqueReplayFailure(state.code, state.singularDispatchCount);
    }
    if (state.kind === 'captured') {
      let artifact: ChatGptOpaqueReplayArtifact | undefined;
      try {
        artifact = await withinDeadline(
          artifactFromHookResult(state, conversationId, resolved.digestSha256),
          remainingTimeout(deadline, resolved.now)
        );
      } catch {
        return createChatGptOpaqueReplayFailure('replay-result-timeout', 1);
      }
      return artifact === undefined
        ? createChatGptOpaqueReplayFailure('replay-result-invalid', 1)
        : { success: true, data: artifact };
    }
    const remaining = deadline - resolved.now();
    if (remaining <= 0) break;
    try {
      await withinDeadline(
        Promise.resolve(resolved.sleep(Math.min(resolved.pollIntervalMs, remaining))),
        remainingTimeout(deadline, resolved.now)
      );
    } catch {
      break;
    }
  }
  return createChatGptOpaqueReplayFailure('replay-result-timeout');
}

/**
 * Run the isolated opaque replay core. It is intentionally not connected to
 * extension messages, UI, or normal capture; callers must opt in explicitly.
 */
// eslint-disable-next-line max-lines-per-function -- Lifecycle cleanup stays linear so each deadline exit has one bounded, auditable path.
export async function captureChatGptConversationViaOpaqueReplay(
  conversationId: string,
  overrides: ChatGptOpaqueReplayDependencies = {}
): Promise<ChatGptOpaqueReplayResponse> {
  if (!isChatGptConversationId(conversationId)) {
    return createChatGptOpaqueReplayFailure('invalid-conversation-id');
  }
  const resolved = resolvedDependencies(overrides);
  const nonce = safeNonce(resolved.createNonce);
  if (nonce === undefined) return createChatGptOpaqueReplayFailure('nonce-invalid');
  const deadline = resolved.now() + resolved.timeoutMs;
  let tabId: number | undefined;
  let cleanLateCreatedTab = false;
  try {
    let creation: Promise<{ id?: number }>;
    try {
      creation = Promise.resolve(
        resolved.chromeApi.tabs.create({ url: targetUrl(conversationId, nonce), active: false })
      );
    } catch {
      return createChatGptOpaqueReplayFailure('temporary-tab-create-failed');
    }
    void creation.then(
      tab => {
        if (cleanLateCreatedTab && Number.isSafeInteger(tab.id) && tab.id !== undefined) {
          void removeTemporaryTab(resolved.chromeApi, tab.id);
        }
      },
      () => undefined
    );
    let tab: { id?: number };
    try {
      tab = await withinDeadline(creation, remainingTimeout(deadline, resolved.now));
    } catch {
      cleanLateCreatedTab = true;
      return createChatGptOpaqueReplayFailure('temporary-tab-create-failed');
    }
    if (!Number.isSafeInteger(tab.id) || tab.id === undefined) {
      return createChatGptOpaqueReplayFailure('temporary-tab-missing-id');
    }
    tabId = tab.id;
    const readiness = await waitForTemporaryTarget(
      resolved.chromeApi,
      tabId,
      conversationId,
      nonce,
      deadline,
      resolved.now,
      resolved.sleep,
      resolved.pollIntervalMs
    );
    if (readiness === 'unexpected-origin') {
      return createChatGptOpaqueReplayFailure('unexpected-origin');
    }
    if (readiness === 'unexpected-path') {
      return createChatGptOpaqueReplayFailure('unexpected-path');
    }
    if (readiness !== 'ready') {
      return createChatGptOpaqueReplayFailure('temporary-tab-ready-timeout');
    }
    return await waitForReplayResult(resolved, tabId, nonce, conversationId, deadline);
  } catch {
    return createChatGptOpaqueReplayFailure('replay-result-invalid');
  } finally {
    cleanLateCreatedTab = true;
    await removeTemporaryTab(resolved.chromeApi, tabId);
  }
}

/**
 * Serialized MAIN-world state reader. It is deliberately self-contained: the
 * page may mutate globals, and background repeats the full strict validation.
 */
// eslint-disable-next-line complexity, max-lines-per-function -- This function is serialized into MAIN world and must retain its exact primitive gate.
export function readChatGptOpaqueReplayState(nonce: string): HookState {
  try {
    const hasExactStringKeys = (value: object, expected: readonly string[]): boolean => {
      const keys = Reflect.ownKeys(value);
      if (keys.length !== expected.length) return false;
      for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex += 1) {
        let found = false;
        for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
          if (keys[keyIndex] === expected[expectedIndex]) {
            found = true;
            break;
          }
        }
        if (!found) return false;
      }
      return true;
    };
    const codes = [
      'invalid-conversation-id',
      'permission-unavailable',
      'nonce-unavailable',
      'nonce-invalid',
      'temporary-tab-create-failed',
      'temporary-tab-missing-id',
      'unexpected-origin',
      'unexpected-path',
      'temporary-tab-ready-timeout',
      'replay-result-timeout',
      'hook-state-failed',
      'target-not-observed',
      'source-not-native-request',
      'init-security-sensitive',
      'init-unsupported',
      'target-mismatch',
      'clone-failed',
      'authorization-absent',
      'credentials-rejected',
      'source-rejected',
      'source-http-error',
      'source-non-json',
      'replay-construction-failed',
      'replay-dispatch-failed',
      'replay-rejected',
      'replay-http-error',
      'replay-non-json',
      'response-processing-failed',
      'payload-too-large',
      'timed-out',
      'replay-result-invalid',
      'response-integrity-invalid',
      'hash-unavailable',
    ];
    if (typeof nonce !== 'string' || !/^[a-z0-9-]{16,128}$/i.test(nonce)) {
      return { kind: 'missing' };
    }
    const pageWindow = window as unknown as Record<string, unknown>;
    const snapshot = pageWindow[`__liskaChatGptOpaqueReplay_${nonce}`];
    if (typeof snapshot !== 'object' || snapshot === null) return { kind: 'missing' };
    const state = snapshot as Record<string, unknown>;
    if (state.kind === 'ready' && hasExactStringKeys(state, ['kind'])) return { kind: 'ready' };
    if (
      state.kind === 'error' &&
      hasExactStringKeys(state, ['kind', 'code', 'singularDispatchCount']) &&
      typeof state.code === 'string' &&
      codes.includes(state.code) &&
      (state.singularDispatchCount === 0 || state.singularDispatchCount === 1)
    ) {
      return {
        kind: 'error',
        code: state.code as ChatGptOpaqueReplayErrorCode,
        singularDispatchCount: state.singularDispatchCount,
      };
    }
    if (
      state.kind !== 'captured' ||
      !hasExactStringKeys(state, ['kind', 'conversationId', 'capture', 'singularDispatchCount']) ||
      typeof state.conversationId !== 'string' ||
      state.singularDispatchCount !== 1 ||
      typeof state.capture !== 'object' ||
      state.capture === null
    ) {
      return { kind: 'missing' };
    }
    const capture = state.capture as Record<string, unknown>;
    if (!hasExactStringKeys(capture, ['bodyBase64', 'byteLength', 'sha256', 'mediaType'])) {
      return { kind: 'missing' };
    }
    if (
      typeof capture.bodyBase64 !== 'string' ||
      typeof capture.byteLength !== 'number' ||
      typeof capture.sha256 !== 'string' ||
      typeof capture.mediaType !== 'string'
    ) {
      return { kind: 'missing' };
    }
    return {
      kind: 'captured',
      conversationId: state.conversationId,
      capture: {
        bodyBase64: capture.bodyBase64,
        byteLength: capture.byteLength,
        sha256: capture.sha256,
        mediaType: capture.mediaType,
      },
      singularDispatchCount: 1,
    };
  } catch {
    return { kind: 'missing' };
  }
}
