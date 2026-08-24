/**
 * Disposable-tab runtime for the post-persistence opaque resolver observer.
 * It dispatches no provider request: MAIN world observes one page-owned plural
 * source request, then only bounded resolver response clones for two seconds.
 */

import { isChatGptConversationId } from '../lib/chatgpt-capture-contract';
import {
  createChatGptOpaqueResolverFailure,
  isChatGptOpaqueResolverHookResult,
  type ChatGptOpaqueResolverErrorCode,
  type ChatGptOpaqueResolverHookResult,
  type ChatGptOpaqueResolverResponse,
} from '../lib/chatgpt-opaque-resolver-contract';
import { validateChatGptResolverObservations } from './chatgpt-capture';

export const CHATGPT_OPAQUE_RESOLVER_TIMEOUT_MS = 190_000;

const CHATGPT_ORIGIN = 'https://chatgpt.com';
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 195_000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const CLEANUP_STEP_TIMEOUT_MS = 500;

interface ResolverScriptInjection {
  target: { tabId: number };
  world: 'MAIN';
  func: (...args: never[]) => unknown;
  args: unknown[];
}

interface ResolverChromeApi {
  tabs: {
    create: (createProperties: { url: string; active: boolean }) => Promise<{ id?: number }>;
    get: (tabId: number) => Promise<{ status?: string; url?: string }>;
    remove: (tabId: number) => Promise<void>;
  };
  scripting: {
    executeScript: (injection: ResolverScriptInjection) => Promise<Array<{ result?: unknown }>>;
  };
}

export interface ChatGptOpaqueResolverDependencies {
  chromeApi?: ResolverChromeApi;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  createNonce?: () => string;
  digestSha256?: (bytes: Uint8Array) => Promise<string>;
}

type HookState = ChatGptOpaqueResolverHookResult | { kind: 'missing' };
type Readiness = 'ready' | 'waiting' | 'unexpected-origin' | 'unexpected-path';

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return CHATGPT_OPAQUE_RESOLVER_TIMEOUT_MS;
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
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
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
  return `#liska-capture=${nonce}&liska-opaque-resolver-observer=1`;
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

function resolvedDependencies(overrides: ChatGptOpaqueResolverDependencies) {
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
  chromeApi: ResolverChromeApi,
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
    // Best-effort cleanup is the only permitted side effect after a timeout.
  }
}

async function waitForTemporaryTarget(
  chromeApi: ResolverChromeApi,
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
  chromeApi: ResolverChromeApi,
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
        func: readChatGptOpaqueResolverState,
        args: [nonce],
      }),
      remainingTimeout(deadline, now)
    );
    const result = execution[0]?.result;
    return isChatGptOpaqueResolverHookResult(result) ? result : { kind: 'missing' };
  } catch {
    return { kind: 'missing' };
  }
}

async function waitForObserverResult(
  resolved: ReturnType<typeof resolvedDependencies>,
  tabId: number,
  nonce: string,
  conversationId: string,
  deadline: number
): Promise<ChatGptOpaqueResolverResponse> {
  while (resolved.now() <= deadline) {
    const state = await readHookState(resolved.chromeApi, tabId, nonce, deadline, resolved.now);
    if (state.kind === 'error') return createChatGptOpaqueResolverFailure(state.code);
    if (state.kind === 'observed') {
      if (state.conversationId !== conversationId || state.singularDispatchCount !== 0) {
        return createChatGptOpaqueResolverFailure('observer-result-invalid');
      }
      try {
        const transientAssetResolvers = await withinDeadline(
          validateChatGptResolverObservations(
            state.resolverObservations,
            conversationId,
            resolved.digestSha256
          ),
          remainingTimeout(deadline, resolved.now)
        );
        return { success: true, data: { transientAssetResolvers } };
      } catch {
        return createChatGptOpaqueResolverFailure('observer-result-invalid');
      }
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
  return createChatGptOpaqueResolverFailure('observer-result-timeout');
}

/**
 * Observe resolvers in an isolated marker-gated tab after raw persistence.
 * It is intentionally independent from opaque replay: singular dispatch count
 * is structurally zero throughout this route.
 */
// eslint-disable-next-line max-lines-per-function -- Keep lifecycle and late-tab cleanup in one auditable boundary.
export async function observeChatGptAssetResolversViaOpaqueSource(
  conversationId: string,
  overrides: ChatGptOpaqueResolverDependencies = {}
): Promise<ChatGptOpaqueResolverResponse> {
  if (!isChatGptConversationId(conversationId)) {
    return createChatGptOpaqueResolverFailure('invalid-conversation-id');
  }
  const resolved = resolvedDependencies(overrides);
  const nonce = safeNonce(resolved.createNonce);
  if (nonce === undefined) return createChatGptOpaqueResolverFailure('nonce-invalid');
  let deadline: number;
  try {
    deadline = resolved.now() + resolved.timeoutMs;
  } catch {
    return createChatGptOpaqueResolverFailure('observer-result-invalid');
  }
  let tabId: number | undefined;
  let cleanLateCreatedTab = false;
  try {
    let creation: Promise<{ id?: number }>;
    try {
      creation = Promise.resolve(
        // ChatGPT defers attachment rendering and resolver requests in hidden
        // documents. This post-click observer is briefly foregrounded, then
        // its exact tab is removed by the same bounded lifecycle.
        resolved.chromeApi.tabs.create({ url: targetUrl(conversationId, nonce), active: true })
      );
    } catch {
      return createChatGptOpaqueResolverFailure('temporary-tab-create-failed');
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
      return createChatGptOpaqueResolverFailure('temporary-tab-create-failed');
    }
    if (!Number.isSafeInteger(tab.id) || tab.id === undefined) {
      return createChatGptOpaqueResolverFailure('temporary-tab-missing-id');
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
    if (readiness === 'unexpected-origin')
      return createChatGptOpaqueResolverFailure('unexpected-origin');
    if (readiness === 'unexpected-path')
      return createChatGptOpaqueResolverFailure('unexpected-path');
    if (readiness !== 'ready')
      return createChatGptOpaqueResolverFailure('temporary-tab-ready-timeout');
    return await waitForObserverResult(resolved, tabId, nonce, conversationId, deadline);
  } catch {
    return createChatGptOpaqueResolverFailure('observer-result-invalid');
  } finally {
    cleanLateCreatedTab = true;
    await removeTemporaryTab(resolved.chromeApi, tabId);
  }
}

/** Serialized MAIN-world reader with strict shape checks and no parsing. */
// eslint-disable-next-line complexity, max-lines-per-function -- This function is serialized into MAIN world and must stay self-contained.
export function readChatGptOpaqueResolverState(nonce: string): HookState {
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
    if (typeof nonce !== 'string' || !/^[a-z0-9-]{16,128}$/i.test(nonce)) {
      return { kind: 'missing' };
    }
    const pageWindow = window as unknown as Record<string, unknown>;
    const snapshot = pageWindow[`__liskaChatGptOpaqueResolver_${nonce}`];
    if (typeof snapshot !== 'object' || snapshot === null) return { kind: 'missing' };
    const state = snapshot as Record<string, unknown>;
    if (state.kind === 'ready' && hasExactStringKeys(state, ['kind'])) return { kind: 'ready' };
    const codes = [
      'hook-state-failed',
      'target-not-observed',
      'source-not-eligible',
      'source-rejected',
      'source-http-error',
      'source-non-json',
    ];
    if (
      state.kind === 'error' &&
      hasExactStringKeys(state, ['kind', 'code', 'singularDispatchCount']) &&
      typeof state.code === 'string' &&
      (() => {
        for (let index = 0; index < codes.length; index += 1) {
          if (codes[index] === state.code) return true;
        }
        return false;
      })() &&
      state.singularDispatchCount === 0
    ) {
      return {
        kind: 'error',
        code: state.code as ChatGptOpaqueResolverErrorCode,
        singularDispatchCount: 0,
      };
    }
    if (
      state.kind !== 'observed' ||
      !hasExactStringKeys(state, [
        'kind',
        'conversationId',
        'resolverObservations',
        'singularDispatchCount',
      ]) ||
      typeof state.conversationId !== 'string' ||
      !Array.isArray(state.resolverObservations) ||
      state.resolverObservations.length > 32 ||
      state.singularDispatchCount !== 0
    ) {
      return { kind: 'missing' };
    }
    const observations = [] as Array<{
      providerFileId: string;
      bodyBase64: string;
      byteLength: number;
      sha256: string;
      mediaType: string;
    }>;
    for (let index = 0; index < state.resolverObservations.length; index += 1) {
      const value = state.resolverObservations[index];
      if (typeof value !== 'object' || value === null) return { kind: 'missing' };
      const record = value as Record<string, unknown>;
      if (
        !hasExactStringKeys(record, [
          'providerFileId',
          'bodyBase64',
          'byteLength',
          'sha256',
          'mediaType',
        ]) ||
        typeof record.providerFileId !== 'string' ||
        typeof record.bodyBase64 !== 'string' ||
        typeof record.byteLength !== 'number' ||
        typeof record.sha256 !== 'string' ||
        typeof record.mediaType !== 'string'
      ) {
        return { kind: 'missing' };
      }
      observations[observations.length] = {
        providerFileId: record.providerFileId,
        bodyBase64: record.bodyBase64,
        byteLength: record.byteLength,
        sha256: record.sha256,
        mediaType: record.mediaType,
      };
    }
    return {
      kind: 'observed',
      conversationId: state.conversationId,
      resolverObservations: observations,
      singularDispatchCount: 0,
    };
  } catch {
    return { kind: 'missing' };
  }
}
