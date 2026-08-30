/**
 * Disposable-tab runtime for the experimental A-strict ChatGPT opaque probe.
 * It only polls the MAIN-world metadata result; it never recreates a provider
 * request or receives a response body.
 */

import { isChatGptConversationId } from '../lib/chatgpt-capture-contract';
import {
  createChatGptOpaqueProbeResult,
  isChatGptOpaqueProbeResult,
  type ChatGptOpaqueProbeResult,
} from '../lib/chatgpt-opaque-probe-contract';

export const CHATGPT_OPAQUE_PROBE_TIMEOUT_MS = 50_000;

const CHATGPT_ORIGIN = 'https://chatgpt.com';
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const CLEANUP_STEP_TIMEOUT_MS = 500;

interface ProbeScriptInjection {
  target: { tabId: number };
  world: 'MAIN';
  func: (...args: never[]) => unknown;
  args: unknown[];
}

interface ProbeChromeApi {
  tabs: {
    create: (createProperties: { url: string; active: boolean }) => Promise<{ id?: number }>;
    get: (tabId: number) => Promise<{ status?: string; url?: string }>;
    remove: (tabId: number) => Promise<void>;
  };
  scripting: {
    executeScript: (injection: ProbeScriptInjection) => Promise<Array<{ result?: unknown }>>;
  };
}

export interface ChatGptOpaqueProbeDependencies {
  chromeApi?: ProbeChromeApi;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  createNonce?: () => string;
}

type HookState =
  | { kind: 'ready' }
  | { kind: 'result'; result: ChatGptOpaqueProbeResult }
  | { kind: 'missing' };

type Readiness = 'ready' | 'waiting' | 'origin-rejected' | 'path-rejected';

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return CHATGPT_OPAQUE_PROBE_TIMEOUT_MS;
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

function targetUrl(conversationId: string, nonce: string): string {
  return `${CHATGPT_ORIGIN}${targetPath(conversationId)}#liska-capture=${nonce}&liska-opaque-probe=1`;
}

function deadlineRemaining(deadline: number, now: () => number): number {
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

function dependencies(overrides: ChatGptOpaqueProbeDependencies) {
  return {
    chromeApi: overrides.chromeApi ?? { tabs: chrome.tabs, scripting: chrome.scripting },
    now: overrides.now ?? Date.now,
    sleep: overrides.sleep ?? defaultSleep,
    timeoutMs: normalizeTimeout(overrides.timeoutMs),
    pollIntervalMs: normalizePollInterval(overrides.pollIntervalMs),
    createNonce: overrides.createNonce ?? defaultNonce,
  };
}

async function removeTab(chromeApi: ProbeChromeApi, tabId: number | undefined): Promise<void> {
  if (tabId === undefined) return;
  try {
    const removal = chromeApi.tabs.remove(tabId);
    if (typeof (removal as PromiseLike<void>)?.then === 'function') {
      await withinDeadline(Promise.resolve(removal), CLEANUP_STEP_TIMEOUT_MS).catch(
        () => undefined
      );
    }
  } catch {
    // The only permitted cleanup is best effort.
  }
}

async function waitForTarget(
  chromeApi: ProbeChromeApi,
  tabId: number,
  conversationId: string,
  deadline: number,
  now: () => number,
  sleep: (milliseconds: number) => Promise<void>,
  pollIntervalMs: number
): Promise<Readiness> {
  while (now() <= deadline) {
    let readiness: Readiness = 'waiting';
    try {
      const tab = await withinDeadline(chromeApi.tabs.get(tabId), deadlineRemaining(deadline, now));
      if (tab.status === 'complete' && typeof tab.url === 'string' && tab.url !== 'about:blank') {
        const url = new URL(tab.url);
        readiness =
          url.origin !== CHATGPT_ORIGIN || url.username !== '' || url.password !== ''
            ? 'origin-rejected'
            : url.pathname === targetPath(conversationId) && url.search === ''
              ? 'ready'
              : 'path-rejected';
      }
    } catch {
      readiness = 'waiting';
    }
    if (readiness !== 'waiting') return readiness;
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining));
  }
  return 'waiting';
}

async function readState(
  chromeApi: ProbeChromeApi,
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
        func: readChatGptOpaqueProbeState,
        args: [nonce],
      }),
      deadlineRemaining(deadline, now)
    );
    const value = execution[0]?.result;
    if (typeof value !== 'object' || value === null) return { kind: 'missing' };
    const state = value as Record<string, unknown>;
    if (state.kind === 'ready' && Object.keys(state).length === 1) return { kind: 'ready' };
    if (
      state.kind === 'result' &&
      Object.keys(state).length === 2 &&
      isChatGptOpaqueProbeResult(state.result)
    ) {
      return { kind: 'result', result: state.result };
    }
    return { kind: 'missing' };
  } catch {
    return { kind: 'missing' };
  }
}

async function waitForProbeResult(
  resolved: ReturnType<typeof dependencies>,
  tabId: number,
  nonce: string,
  deadline: number
): Promise<ChatGptOpaqueProbeResult> {
  while (resolved.now() <= deadline) {
    const state = await readState(resolved.chromeApi, tabId, nonce, deadline, resolved.now);
    if (state.kind === 'result') return state.result;
    const remaining = deadline - resolved.now();
    if (remaining <= 0) break;
    await resolved.sleep(Math.min(resolved.pollIntervalMs, remaining));
  }
  // This is intentionally not an ordinary capture timeout: no target was
  // observed, and no request was generated by the extension.
  return createChatGptOpaqueProbeResult('target-not-observed');
}

async function probeReadinessFailure(
  resolved: ReturnType<typeof dependencies>,
  tabId: number,
  conversationId: string,
  deadline: number
): Promise<ChatGptOpaqueProbeResult | undefined> {
  const readiness = await waitForTarget(
    resolved.chromeApi,
    tabId,
    conversationId,
    deadline,
    resolved.now,
    resolved.sleep,
    resolved.pollIntervalMs
  );
  if (readiness === 'ready') return undefined;
  return createChatGptOpaqueProbeResult(
    readiness === 'waiting' ? 'target-not-observed' : 'probe-failed'
  );
}

/** Run only the marker-gated metadata observer in a tab created for this probe. */
export async function probeChatGptOpaqueRequest(
  conversationId: string,
  overrides: ChatGptOpaqueProbeDependencies = {}
): Promise<ChatGptOpaqueProbeResult> {
  if (!isChatGptConversationId(conversationId))
    return createChatGptOpaqueProbeResult('probe-failed');
  const resolved = dependencies(overrides);
  const nonce = safeNonce(resolved.createNonce);
  if (nonce === undefined) return createChatGptOpaqueProbeResult('probe-failed');
  const deadline = resolved.now() + resolved.timeoutMs;
  let tabId: number | undefined;
  let cleanLateCreatedTab = false;
  try {
    const createPromise = Promise.resolve(
      resolved.chromeApi.tabs.create({ url: targetUrl(conversationId, nonce), active: false })
    );
    void createPromise.then(
      tab => {
        if (cleanLateCreatedTab && Number.isSafeInteger(tab.id) && tab.id !== undefined) {
          void removeTab(resolved.chromeApi, tab.id);
        }
      },
      () => undefined
    );
    let tab: { id?: number };
    try {
      tab = await withinDeadline(createPromise, deadlineRemaining(deadline, resolved.now));
    } catch {
      cleanLateCreatedTab = true;
      return createChatGptOpaqueProbeResult('probe-failed');
    }
    if (!Number.isSafeInteger(tab.id) || tab.id === undefined)
      return createChatGptOpaqueProbeResult('probe-failed');
    const createdTabId: number = tab.id;
    tabId = createdTabId;
    const readinessFailure = await probeReadinessFailure(
      resolved,
      createdTabId,
      conversationId,
      deadline
    );
    if (readinessFailure !== undefined) return readinessFailure;
    return await waitForProbeResult(resolved, createdTabId, nonce, deadline);
  } catch {
    return createChatGptOpaqueProbeResult('probe-failed');
  } finally {
    cleanLateCreatedTab = true;
    await removeTab(resolved.chromeApi, tabId);
  }
}

/** Serialized MAIN-world state reader with primitive-only exact shape checks. */
// eslint-disable-next-line complexity, max-lines-per-function -- Chrome serializes this reader into MAIN world, so its exact primitive-only gate must stay self-contained.
export function readChatGptOpaqueProbeState(nonce: string): HookState {
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
    const snapshot = pageWindow[`__liskaChatGptOpaqueProbe_${nonce}`];
    if (typeof snapshot !== 'object' || snapshot === null) return { kind: 'missing' };
    const state = snapshot as Record<string, unknown>;
    if (state.kind === 'ready' && hasExactStringKeys(state, ['kind'])) return { kind: 'ready' };
    if (state.kind !== 'result' || !hasExactStringKeys(state, ['kind', 'result'])) {
      return { kind: 'missing' };
    }
    const result = state.result;
    if (typeof result !== 'object' || result === null) return { kind: 'missing' };
    const record = result as Record<string, unknown>;
    const expected = [
      'authorizationPresent',
      'credentialsAccepted',
      'exactTarget',
      'initAbsent',
      'observedTargetRequest',
      'outcome',
      'singularDispatchCount',
      'sourceIsNativeRequest',
      'sourceJson',
      'sourceStatus',
    ];
    if (!hasExactStringKeys(record, expected)) return { kind: 'missing' };
    const outcomes = [
      'target-not-observed',
      'source-not-native-request',
      'init-present',
      'init-security-sensitive',
      'init-unsupported',
      'target-mismatch',
      'clone-failed',
      'authorization-absent',
      'credentials-rejected',
      'source-rejected',
      'source-http-unauthorized',
      'source-http-forbidden',
      'source-http-rate-limited',
      'source-http-redirect',
      'source-http-error',
      'source-non-json',
      'eligible',
      'eligible-init-empty',
      'eligible-init-signal-only',
      'hook-state-failed',
      'probe-failed',
    ];
    let outcomeAccepted = false;
    for (let index = 0; index < outcomes.length; index += 1) {
      if (record.outcome === outcomes[index]) {
        outcomeAccepted = true;
        break;
      }
    }
    const safe =
      typeof record.observedTargetRequest === 'boolean' &&
      typeof record.sourceIsNativeRequest === 'boolean' &&
      typeof record.initAbsent === 'boolean' &&
      typeof record.exactTarget === 'boolean' &&
      typeof record.authorizationPresent === 'boolean' &&
      typeof record.credentialsAccepted === 'boolean' &&
      (record.sourceStatus === null ||
        (typeof record.sourceStatus === 'number' &&
          Number.isInteger(record.sourceStatus) &&
          record.sourceStatus >= 100 &&
          record.sourceStatus <= 599)) &&
      typeof record.sourceJson === 'boolean' &&
      record.singularDispatchCount === 0 &&
      typeof record.outcome === 'string' &&
      outcomeAccepted;
    return safe
      ? { kind: 'result', result: record as unknown as ChatGptOpaqueProbeResult }
      : { kind: 'missing' };
  } catch {
    return { kind: 'missing' };
  }
}
