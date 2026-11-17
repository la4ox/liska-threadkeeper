/** One selected-tab, content-free Claude active/archived list diagnostic. */
/* eslint-disable max-lines -- Serialized page code and its background owner stay auditable together. */

import {
  createClaudeListProbeFailure,
  snapshotClaudeListProbeResult,
  type ClaudeListProbeFailureCode,
  type ClaudeListProbeOutcomeCode,
  type ClaudeListProbeResponse,
  type ClaudeListProbeResult,
} from '../lib/claude-list-probe-contract';

const CLAUDE_ORIGIN = 'https://claude.ai';
const CLAUDE_CHAT_PATH =
  /^\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u;
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,256}$/u;
const DEFAULT_PAGE_TIMEOUT_MS = 20_000;
const DEFAULT_BACKGROUND_TIMEOUT_MS = 25_000;
const MIN_TIMEOUT_MS = 50;
const MAX_PAGE_TIMEOUT_MS = 20_000;
const MAX_BACKGROUND_TIMEOUT_MS = 30_000;
const OWNER_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type ProbeTarget = { tabId: number; frameIds?: [0]; documentIds?: [string] };

interface ClaudeListProbeChromeApi {
  tabs: {
    query: (queryInfo: { active: true; currentWindow: true }) => Promise<chrome.tabs.Tab[]>;
    get: (tabId: number) => Promise<chrome.tabs.Tab>;
    onUpdated?: {
      addListener: (
        callback: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void
      ) => void;
      removeListener: (
        callback: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void
      ) => void;
    };
  };
  scripting: {
    executeScript: (injection: {
      target: ProbeTarget;
      world: 'ISOLATED';
      func: (...args: never[]) => unknown;
      args: unknown[];
    }) => Promise<Array<{ result?: unknown; documentId?: string; frameId?: number }>>;
  };
}

export interface ClaudeListProbeDependencies {
  chromeApi?: ClaudeListProbeChromeApi;
  now?: () => number;
  epochNow?: () => number;
  createOwnerToken?: () => string;
  pageTimeoutMs?: number;
  backgroundTimeoutMs?: number;
  operations?: Set<number>;
}

class ProbeFailure extends Error {
  constructor(readonly code: ClaudeListProbeFailureCode) {
    super(code);
  }
}

class PendingProbeTimeout extends ProbeFailure {
  constructor(readonly pending: Promise<unknown>) {
    super('background-timeout');
  }
}

const activeOperations = new Set<number>();

/** Exact popup only: no content script or fallback extension page can start this probe. */
export function isAuthorizedClaudeListProbeSender(
  sender: chrome.runtime.MessageSender,
  runtimeId: string,
  popupUrl: string
): boolean {
  return sender.tab === undefined && sender.id === runtimeId && sender.url === popupUrl;
}

function timeout(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(MIN_TIMEOUT_MS, Math.floor(value)));
}

function remaining(deadline: number, now: () => number): number {
  const value = deadline - now();
  if (value <= 0) throw new ProbeFailure('background-timeout');
  return value;
}

function withinDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProbeFailure('background-timeout')), timeoutMs);
    operation.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function exactClaudeChat(urlValue: unknown): string | undefined {
  if (typeof urlValue !== 'string') return undefined;
  try {
    const url = new URL(urlValue);
    if (
      url.origin !== CLAUDE_ORIGIN ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !CLAUDE_CHAT_PATH.test(url.pathname)
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function validDocumentId(value: unknown): value is string {
  return typeof value === 'string' && DOCUMENT_ID_PATTERN.test(value);
}

function readyResult(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const keys = Reflect.ownKeys(value);
    return (
      keys.length === 1 &&
      keys[0] === 'ready' &&
      Object.getOwnPropertyDescriptor(value, 'ready')?.value === true
    );
  } catch {
    return false;
  }
}

function dependencies(overrides: ClaudeListProbeDependencies) {
  return {
    chromeApi: overrides.chromeApi ?? { tabs: chrome.tabs, scripting: chrome.scripting },
    now: overrides.now ?? Date.now,
    epochNow: overrides.epochNow ?? Date.now,
    createOwnerToken:
      overrides.createOwnerToken ??
      (() => {
        if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('owner-token');
        return globalThis.crypto.randomUUID();
      }),
    pageTimeoutMs: timeout(overrides.pageTimeoutMs, DEFAULT_PAGE_TIMEOUT_MS, MAX_PAGE_TIMEOUT_MS),
    backgroundTimeoutMs: timeout(
      overrides.backgroundTimeoutMs,
      DEFAULT_BACKGROUND_TIMEOUT_MS,
      MAX_BACKGROUND_TIMEOUT_MS
    ),
    operations: overrides.operations ?? activeOperations,
  };
}

interface NavigationLatch {
  changed: () => boolean;
  bind: (documentId: string, ownerToken: string) => void;
  close: () => { pending: boolean; settled: Promise<void> };
}

function markerAccepted(execution: unknown, documentId: string): boolean {
  try {
    const item = Array.isArray(execution) ? execution[0] : undefined;
    const result =
      typeof item === 'object' && item !== null
        ? Object.getOwnPropertyDescriptor(item, 'result')?.value
        : undefined;
    return (
      Array.isArray(execution) &&
      execution.length === 1 &&
      Object.getOwnPropertyDescriptor(item as object, 'documentId')?.value === documentId &&
      typeof result === 'object' &&
      result !== null &&
      Reflect.ownKeys(result).length === 1 &&
      Object.getOwnPropertyDescriptor(result, 'marked')?.value === true
    );
  } catch {
    return false;
  }
}

// eslint-disable-next-line max-lines-per-function -- Sticky listener, pinned signal and settlement tracking share one lifecycle.
function navigationLatch(
  chromeApi: ClaudeListProbeChromeApi,
  source: { tabId: number; url: string }
): NavigationLatch {
  let changed = false;
  let installed = false;
  let closed = false;
  let binding: { documentId: string; ownerToken: string } | undefined;
  const signals = new Set<Promise<void>>();
  const signal = (attempt = 0): void => {
    if (!binding || closed) return;
    const target = binding;
    let pending: Promise<unknown>;
    try {
      pending = chromeApi.scripting.executeScript({
        target: { tabId: source.tabId, documentIds: [target.documentId] },
        world: 'ISOLATED',
        func: markClaudeListProbeNavigationChanged,
        args: [target.ownerToken],
      });
    } catch {
      return;
    }
    const tracked = pending.then(
      execution => {
        if (!markerAccepted(execution, target.documentId) && attempt === 0 && !closed) signal(1);
      },
      () => undefined
    );
    signals.add(tracked);
    void tracked.finally(() => signals.delete(tracked));
  };
  const listener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo): void => {
    if (
      !changed &&
      tabId === source.tabId &&
      typeof changeInfo.url === 'string' &&
      changeInfo.url !== source.url
    ) {
      changed = true;
      signal();
    }
  };
  try {
    if (chromeApi.tabs.onUpdated) {
      chromeApi.tabs.onUpdated.addListener(listener);
      installed = true;
    }
  } catch {
    installed = false;
  }
  return {
    changed: () => changed,
    bind: (documentId, ownerToken) => {
      binding = { documentId, ownerToken };
      if (changed) signal();
    },
    close: () => {
      closed = true;
      if (installed) {
        installed = false;
        try {
          chromeApi.tabs.onUpdated?.removeListener(listener);
        } catch {
          // The sticky flag already protected the operation; cleanup is best effort.
        }
      }
      const snapshot = [...signals];
      return {
        pending: snapshot.length > 0,
        settled: snapshot.length ? Promise.all(snapshot).then(() => undefined) : Promise.resolve(),
      };
    },
  };
}

function requireStableNavigation(latch: NavigationLatch): void {
  if (latch.changed()) throw new ProbeFailure('navigation-changed');
}

async function selectedSource(
  chromeApi: ClaudeListProbeChromeApi,
  deadline: number,
  now: () => number
): Promise<{ tabId: number; url: string }> {
  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await withinDeadline(
      chromeApi.tabs.query({ active: true, currentWindow: true }),
      remaining(deadline, now)
    );
  } catch (error) {
    if (error instanceof ProbeFailure) throw error;
    throw new ProbeFailure('active-tab-required');
  }
  const tab = tabs[0];
  if (tabs.length !== 1 || !Number.isSafeInteger(tab?.id) || tab?.id === undefined)
    throw new ProbeFailure('active-tab-required');
  const url = exactClaudeChat(tab.url);
  if (!url) throw new ProbeFailure('claude-route-required');
  return { tabId: tab.id, url };
}

async function sourceStillSelected(
  source: { tabId: number; url: string },
  chromeApi: ClaudeListProbeChromeApi,
  deadline: number,
  now: () => number
): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await withinDeadline(chromeApi.tabs.get(source.tabId), remaining(deadline, now));
  } catch (error) {
    if (error instanceof ProbeFailure) throw error;
    throw new ProbeFailure('document-unavailable');
  }
  if (tab.id !== source.tabId || exactClaudeChat(tab.url) !== source.url)
    throw new ProbeFailure('navigation-changed');
  let selected: { tabId: number; url: string };
  try {
    selected = await selectedSource(chromeApi, deadline, now);
  } catch (error) {
    if (error instanceof ProbeFailure && error.code === 'background-timeout') throw error;
    throw new ProbeFailure('navigation-changed');
  }
  if (selected.tabId !== source.tabId || selected.url !== source.url)
    throw new ProbeFailure('navigation-changed');
}

async function documentCheck(
  source: { tabId: number; url: string },
  target: ProbeTarget,
  chromeApi: ClaudeListProbeChromeApi,
  deadline: number,
  now: () => number
): Promise<string> {
  let execution: Array<{ result?: unknown; documentId?: string; frameId?: number }>;
  try {
    execution = await withinDeadline(
      chromeApi.scripting.executeScript({
        target,
        world: 'ISOLATED',
        func: inspectClaudeListProbeDocument,
        args: [source.url],
      }),
      remaining(deadline, now)
    );
  } catch (error) {
    if (error instanceof ProbeFailure) throw error;
    throw new ProbeFailure(target.documentIds ? 'document-replaced' : 'document-unavailable');
  }
  const item = execution[0];
  if (
    execution.length !== 1 ||
    item?.frameId !== 0 ||
    !validDocumentId(item.documentId) ||
    !readyResult(item.result)
  )
    throw new ProbeFailure(target.documentIds ? 'document-replaced' : 'document-unavailable');
  if (target.documentIds && item.documentId !== target.documentIds[0])
    throw new ProbeFailure('document-replaced');
  return item.documentId;
}

async function executePinnedProbe(
  source: { tabId: number; url: string },
  documentId: string,
  pageDeadlineEpochMs: number,
  ownerToken: string,
  navigationAlreadyChanged: boolean,
  chromeApi: ClaudeListProbeChromeApi,
  deadline: number,
  now: () => number
): Promise<ClaudeListProbeResult> {
  const pending = chromeApi.scripting.executeScript({
    target: { tabId: source.tabId, documentIds: [documentId] },
    world: 'ISOLATED',
    func: runClaudeListProbeInPage,
    args: [source.url, pageDeadlineEpochMs, ownerToken, navigationAlreadyChanged],
  });
  let execution: Array<{ result?: unknown; documentId?: string; frameId?: number }>;
  try {
    execution = await withinDeadline(pending, remaining(deadline, now));
  } catch (error) {
    if (error instanceof ProbeFailure && error.code === 'background-timeout')
      throw new PendingProbeTimeout(pending);
    if (error instanceof ProbeFailure) throw error;
    throw new ProbeFailure('document-replaced');
  }
  const item = execution[0];
  if (execution.length !== 1 || item?.frameId !== 0 || item.documentId !== documentId)
    throw new ProbeFailure('document-replaced');
  const result = snapshotClaudeListProbeResult(item.result);
  if (!result) throw new ProbeFailure('result-invalid');
  return result;
}

/**
 * Probe only the exact tab selected when the trusted popup request arrives.
 * The first execution only obtains a document ID; every later execution is pinned.
 */
// eslint-disable-next-line max-lines-per-function -- Source, document and lock checks form one indivisible lifecycle.
export async function probeClaudeListsInActiveTab(
  overrides: ClaudeListProbeDependencies = {}
): Promise<ClaudeListProbeResponse> {
  const resolved = dependencies(overrides);
  const deadline = resolved.now() + resolved.backgroundTimeoutMs;
  let source: { tabId: number; url: string };
  try {
    source = await selectedSource(resolved.chromeApi, deadline, resolved.now);
  } catch (error) {
    return createClaudeListProbeFailure(
      error instanceof ProbeFailure ? error.code : 'active-tab-required'
    );
  }
  let ownerToken: string;
  try {
    ownerToken = resolved.createOwnerToken();
    if (!OWNER_TOKEN_PATTERN.test(ownerToken)) throw new Error('owner-token');
  } catch {
    return createClaudeListProbeFailure('result-invalid');
  }
  if (resolved.operations.size > 0 || resolved.operations.has(source.tabId))
    return createClaudeListProbeFailure('operation-in-progress');
  resolved.operations.add(source.tabId);
  const latch = navigationLatch(resolved.chromeApi, source);
  let released = false;
  let releaseOnReturn = true;
  let releaseRequested = false;
  const releaseLock = (): void => {
    if (released) return;
    released = true;
    resolved.operations.delete(source.tabId);
  };
  const requestRelease = (): void => {
    if (releaseRequested) return;
    releaseRequested = true;
    const closing = latch.close();
    if (closing.pending) void closing.settled.then(releaseLock, releaseLock);
    else releaseLock();
  };
  try {
    requireStableNavigation(latch);
    await sourceStillSelected(source, resolved.chromeApi, deadline, resolved.now);
    requireStableNavigation(latch);
    const documentId = await documentCheck(
      source,
      { tabId: source.tabId, frameIds: [0] },
      resolved.chromeApi,
      deadline,
      resolved.now
    );
    latch.bind(documentId, ownerToken);
    requireStableNavigation(latch);
    await sourceStillSelected(source, resolved.chromeApi, deadline, resolved.now);
    requireStableNavigation(latch);
    const pageDeadlineEpochMs =
      resolved.epochNow() + Math.min(resolved.pageTimeoutMs, remaining(deadline, resolved.now));
    const result = await executePinnedProbe(
      source,
      documentId,
      pageDeadlineEpochMs,
      ownerToken,
      latch.changed(),
      resolved.chromeApi,
      deadline,
      resolved.now
    );
    requireStableNavigation(latch);
    await sourceStillSelected(source, resolved.chromeApi, deadline, resolved.now);
    requireStableNavigation(latch);
    await documentCheck(
      source,
      { tabId: source.tabId, documentIds: [documentId] },
      resolved.chromeApi,
      deadline,
      resolved.now
    );
    requireStableNavigation(latch);
    await sourceStillSelected(source, resolved.chromeApi, deadline, resolved.now);
    requireStableNavigation(latch);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof PendingProbeTimeout) {
      releaseOnReturn = false;
      void error.pending.then(requestRelease, requestRelease).catch(requestRelease);
    }
    return createClaudeListProbeFailure(
      error instanceof ProbeFailure ? error.code : 'result-invalid'
    );
  } finally {
    if (releaseOnReturn) requestRelease();
  }
}

/** Same-document ISOLATED marker: sticky navigation plus active request cancellation. */
// eslint-disable-next-line complexity -- Serialized marker validates and mutates one private state defensively.
export function markClaudeListProbeNavigationChanged(ownerToken: string): { marked: boolean } {
  try {
    if (
      typeof ownerToken !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(ownerToken)
    )
      return { marked: false };
    const privateKey = '__liskaClaudeListProbeNavigation_v1';
    const root = globalThis as unknown as Record<string, unknown>;
    const candidate = root[privateKey];
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate))
      return { marked: false };
    const owner = Object.getOwnPropertyDescriptor(candidate, 'ownerToken');
    const changed = Object.getOwnPropertyDescriptor(candidate, 'changed');
    const cancel = Object.getOwnPropertyDescriptor(candidate, 'cancel');
    if (
      !owner ||
      !('value' in owner) ||
      owner.value !== ownerToken ||
      !changed ||
      !('value' in changed) ||
      typeof changed.value !== 'boolean' ||
      !cancel ||
      !('value' in cancel)
    )
      return { marked: false };
    (candidate as { changed: boolean }).changed = true;
    if (typeof cancel.value === 'function') {
      try {
        cancel.value();
      } catch {
        // The sticky bit is authoritative even when cancellation itself throws.
      }
    }
    return { marked: true };
  } catch {
    return { marked: false };
  }
}

/** Safe no-request page check used before and after the pinned diagnostic. */
export function inspectClaudeListProbeDocument(expectedUrl: string): { ready: boolean } {
  try {
    return {
      ready:
        typeof expectedUrl === 'string' &&
        window.top === window &&
        window.location.href === expectedUrl,
    };
  } catch {
    return { ready: false };
  }
}

/**
 * Self-contained ISOLATED-world function. Raw response values and identifiers
 * remain inside this invocation; only fixed booleans, counts and bounded header names return.
 */
// eslint-disable-next-line complexity, max-lines-per-function -- The serialized trust boundary is deliberately self-contained.
export async function runClaudeListProbeInPage(
  expectedUrl: string,
  deadlineEpochMs: number,
  ownerToken: string,
  navigationAlreadyChanged: boolean
): Promise<unknown> {
  const schema = 'liska-claude-list-probe/2';
  const privateKey = '__liskaClaudeListProbeNavigation_v1';
  const root = globalThis as unknown as Record<string, unknown>;
  const ownerValid =
    typeof ownerToken === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(ownerToken);
  const state: {
    ownerToken: string;
    changed: boolean;
    cancel: (() => void) | null;
  } = {
    ownerToken,
    changed: !ownerValid || navigationAlreadyChanged === true,
    cancel: null,
  };
  if (ownerValid) root[privateKey] = state;
  const maxDispatches = 4;
  const maxBodyBytes = 512 * 1024;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
  const chatPathPattern =
    /^\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u;
  const listPathPattern =
    /^\/api\/organizations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/chat_conversations_v2$/u;
  const detailPathPattern =
    /^\/api\/organizations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/chat_conversations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u;
  const deadline =
    Number.isSafeInteger(deadlineEpochMs) && deadlineEpochMs > 0 ? deadlineEpochMs : Date.now();
  const pages: Array<{
    partition: 'active' | 'archived';
    offset: 0 | 30;
    hasMore: boolean;
    terminal: boolean;
  }> = [];
  const counts = {
    dispatch: 0,
    page: 0,
    record: 0,
    validUuid: 0,
    marker: 0,
    duplicate: 0,
    overlap: 0,
    archivedMismatch: 0,
  };
  const activeIds = new Set<string>();
  const archivedIds = new Set<string>();
  const relevantHeaderNames = new Set<string>();
  let routeOrganization = '';
  let verificationObserved = false;

  const observeVerificationBanner = (): void => {
    if (verificationObserved) return;
    try {
      verificationObserved = document.querySelector('[data-organization-banners]') !== null;
    } catch {
      // Unreadable DOM is not positive evidence that the banner exists.
    }
  };

  const navigationMatches = (): boolean => {
    try {
      return window.top === window && window.location.href === expectedUrl;
    } catch {
      return false;
    }
  };
  const navigationChanged = (): boolean => state.changed || !navigationMatches();
  const checkpoint = (): boolean => {
    observeVerificationBanner();
    return navigationChanged();
  };
  const setActiveCancel = (cancel: (() => void) | null): void => {
    if (root[privateKey] === state) state.cancel = cancel;
  };
  const unfinished = (): boolean => {
    for (const partition of ['active', 'archived'] as const) {
      const partitionPages = pages.filter(page => page.partition === partition);
      if (partitionPages[partitionPages.length - 1]?.hasMore) return true;
    }
    return false;
  };
  const headerNames = (): string[] => [...relevantHeaderNames].sort().slice(0, 8);
  const finish = (code: ClaudeListProbeOutcomeCode): unknown => {
    const paginationUnfinished = unfinished();
    return {
      schema,
      status: code === 'ok' ? 'complete' : 'stopped',
      code,
      verificationPresent: verificationObserved,
      counts: { ...counts, page: pages.length },
      pages: pages.map(page => ({ ...page })),
      pagination: {
        exercised: pages.some(page => page.offset === 30),
        hypothesis: pages.some(page => page.offset === 30) ? 'offset-plus-30' : 'not-exercised',
        unfinished: paginationUnfinished,
      },
      scope: {
        organizationResolved: false,
        workspaceResolved: false,
        consistent: false,
        routeOrganizationMatched: false,
        fingerprint: null,
        relevantHeaderNames: headerNames(),
      },
    };
  };
  const deadlinePromise = <T>(promise: Promise<T>, onTimeout: () => void): Promise<T> =>
    new Promise((resolve, reject) => {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        onTimeout();
        reject(new Error('deadline'));
        return;
      }
      const timer = setTimeout(() => {
        onTimeout();
        reject(new Error('deadline'));
      }, remainingMs);
      promise.then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        error => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  const exactDataObject = (
    value: unknown,
    requiredKeys: readonly string[]
  ): Record<string, unknown> | undefined => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== requiredKeys.length ||
      keys.some(key => typeof key !== 'string' || !requiredKeys.includes(key))
    )
      return undefined;
    const output: Record<string, unknown> = Object.create(null);
    for (const key of requiredKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return undefined;
      output[key] = descriptor.value;
    }
    return output;
  };
  const recordObject = (value: unknown): Record<string, unknown> | undefined => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.length > 64 || keys.some(key => typeof key !== 'string')) return undefined;
    const output: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return undefined;
      if (key === 'uuid' || key === 'updated_at' || key === 'is_archived')
        output[key] = descriptor.value;
    }
    return output;
  };
  const resolveRouteOrganization = (conversationId: string): string | undefined => {
    const candidates = new Set<string>();
    let entries: PerformanceEntry[];
    try {
      entries = performance.getEntriesByType('resource').slice(-128);
    } catch {
      return undefined;
    }
    for (const entry of entries) {
      let url: URL;
      try {
        url = new URL(entry.name);
      } catch {
        continue;
      }
      if (url.origin !== 'https://claude.ai' || url.username || url.password || url.hash) continue;
      const listMatch = listPathPattern.exec(url.pathname);
      const detailMatch = detailPathPattern.exec(url.pathname);
      if (listMatch && uuidPattern.test(listMatch[1])) candidates.add(listMatch[1]);
      if (detailMatch && detailMatch[2] === conversationId && uuidPattern.test(detailMatch[1]))
        candidates.add(detailMatch[1]);
      if (candidates.size > 1) return undefined;
    }
    return candidates.size === 1 ? [...candidates][0] : undefined;
  };
  const readBody = async (response: Response, controller: AbortController): Promise<unknown> => {
    const contentLength = response.headers.get('content-length');
    if (
      contentLength !== null &&
      (!/^\d{1,10}$/u.test(contentLength) || Number(contentLength) > maxBodyBytes)
    )
      throw new Error('too-large');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('schema');
    const cancelReader = (): void => {
      controller.abort();
      void reader.cancel().catch(() => undefined);
    };
    setActiveCancel(cancelReader);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await deadlinePromise(reader.read(), cancelReader);
        if (checkpoint()) throw new Error('navigation');
        if (next.done) break;
        if (
          !ArrayBuffer.isView(next.value) ||
          Object.prototype.toString.call(next.value) !== '[object Uint8Array]'
        )
          throw new Error('schema');
        const chunk = new Uint8Array(
          next.value.buffer as ArrayBuffer,
          next.value.byteOffset,
          next.value.byteLength
        );
        size += chunk.byteLength;
        if (size > maxBodyBytes) throw new Error('too-large');
        chunks.push(chunk);
      }
    } finally {
      if (state.cancel === cancelReader) setActiveCancel(null);
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  };
  const cancelUnreadBody = (response: Response, controller: AbortController): void => {
    controller.abort();
    try {
      const cancellation = response.body?.cancel();
      if (cancellation) void cancellation.catch(() => undefined);
    } catch {
      // Abort is already signalled; cancellation support differs across body states.
    }
  };
  const collectRelevantHeaderNames = (response: Response): void => {
    for (const rawName of response.headers.keys()) {
      const name = rawName.toLowerCase();
      if (!/(?:^|-)(?:organization|org|workspace)(?:-|$)/u.test(name)) continue;
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || name.length > 64) continue;
      relevantHeaderNames.add(name);
      if (relevantHeaderNames.size >= 8) break;
    }
  };
  const admitPage = (
    value: unknown,
    partition: 'active' | 'archived',
    offset: 0 | 30
    // eslint-disable-next-line complexity -- One bounded pass keeps every privacy count co-located.
  ): boolean | undefined => {
    const envelope = exactDataObject(value, ['data', 'has_more']);
    if (!envelope || typeof envelope.has_more !== 'boolean' || !Array.isArray(envelope.data))
      return undefined;
    if (
      envelope.data.length > 30 ||
      Reflect.ownKeys(envelope.data).length !== envelope.data.length + 1
    )
      return undefined;
    const seen = partition === 'active' ? activeIds : archivedIds;
    const other = partition === 'active' ? archivedIds : activeIds;
    for (let index = 0; index < envelope.data.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(envelope.data, String(index));
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return undefined;
      const item = recordObject(descriptor.value);
      if (!item) return undefined;
      counts.record += 1;
      const id = item.uuid;
      if (typeof id === 'string' && uuidPattern.test(id)) {
        counts.validUuid += 1;
        if (seen.has(id)) counts.duplicate += 1;
        else {
          seen.add(id);
          if (other.has(id)) counts.overlap += 1;
        }
      }
      if (
        typeof item.updated_at === 'string' &&
        item.updated_at.length > 0 &&
        item.updated_at.length <= 256
      )
        counts.marker += 1;
      if (typeof item.is_archived === 'boolean' && item.is_archived !== (partition === 'archived'))
        counts.archivedMismatch += 1;
    }
    pages.push({
      partition,
      offset,
      hasMore: envelope.has_more,
      terminal: !envelope.has_more,
    });
    return envelope.has_more;
  };
  const requestPage = async (
    partition: 'active' | 'archived',
    offset: 0 | 30
    // eslint-disable-next-line complexity, max-lines-per-function -- One request lifecycle owns dispatch, transport, scope and body admission.
  ): Promise<{ hasMore?: boolean; code?: ClaudeListProbeOutcomeCode }> => {
    if (checkpoint()) return { code: 'navigation-changed' };
    if (Date.now() >= deadline) return { code: 'deadline-exceeded' };
    if (counts.dispatch >= maxDispatches) return { code: 'budget-exhausted' };
    const requestUrl =
      `https://claude.ai/api/organizations/${routeOrganization}/chat_conversations_v2` +
      `?limit=30&offset=${offset}&archived=${partition === 'archived'}&consistency=strong`;
    const controller = new AbortController();
    setActiveCancel(() => controller.abort());
    counts.dispatch += 1;
    let response: Response;
    let pendingFetch: Promise<Response> | undefined;
    try {
      pendingFetch = fetch(requestUrl, {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      response = await deadlinePromise(pendingFetch, () => controller.abort());
    } catch (error) {
      controller.abort();
      if (pendingFetch)
        void pendingFetch.then(
          lateResponse => cancelUnreadBody(lateResponse, controller),
          () => undefined
        );
      if (checkpoint()) return { code: 'navigation-changed' };
      return {
        code:
          error instanceof Error && error.message === 'deadline'
            ? 'deadline-exceeded'
            : 'request-failed',
      };
    }
    setActiveCancel(() => cancelUnreadBody(response, controller));
    if (checkpoint()) {
      cancelUnreadBody(response, controller);
      return { code: 'navigation-changed' };
    }
    if (response.status === 401 || response.status === 403) {
      cancelUnreadBody(response, controller);
      return { code: 'auth-required' };
    }
    if (response.status === 429) {
      cancelUnreadBody(response, controller);
      return { code: 'rate-limited' };
    }
    if (response.status !== 200) {
      cancelUnreadBody(response, controller);
      return { code: 'unexpected-status' };
    }
    if (response.redirected || response.url !== requestUrl) {
      cancelUnreadBody(response, controller);
      return { code: 'unexpected-redirect' };
    }
    if (
      response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !==
      'application/json'
    ) {
      cancelUnreadBody(response, controller);
      return { code: 'unexpected-media-type' };
    }
    try {
      collectRelevantHeaderNames(response);
    } catch {
      cancelUnreadBody(response, controller);
      return { code: 'response-schema-invalid' };
    }
    let body: unknown;
    try {
      body = await readBody(response, controller);
    } catch (error) {
      cancelUnreadBody(response, controller);
      if (checkpoint() || (error instanceof Error && error.message === 'navigation'))
        return { code: 'navigation-changed' };
      if (error instanceof Error && error.message === 'deadline')
        return { code: 'deadline-exceeded' };
      if (error instanceof Error && error.message === 'too-large')
        return { code: 'response-too-large' };
      return { code: 'response-schema-invalid' };
    }
    if (Date.now() >= deadline) {
      controller.abort();
      return { code: 'deadline-exceeded' };
    }
    if (checkpoint()) {
      controller.abort();
      return { code: 'navigation-changed' };
    }
    const hasMore = admitPage(body, partition, offset);
    return hasMore === undefined ? { code: 'response-schema-invalid' } : { hasMore };
  };

  try {
    if (checkpoint()) return finish('navigation-changed');
    const pageUrl = new URL(expectedUrl);
    const chatMatch = chatPathPattern.exec(pageUrl.pathname);
    if (pageUrl.origin !== 'https://claude.ai' || pageUrl.search || pageUrl.hash || !chatMatch)
      return finish('navigation-changed');
    routeOrganization = resolveRouteOrganization(chatMatch[1]) ?? '';
    if (!routeOrganization) return finish('route-organization-unresolved');

    const pending: Array<'active' | 'archived'> = [];
    for (const partition of ['active', 'archived'] as const) {
      const page = await requestPage(partition, 0);
      if (checkpoint()) return finish('navigation-changed');
      if (page.code) return finish(page.code);
      if (page.hasMore) pending.push(partition);
    }
    for (const partition of pending) {
      if (counts.dispatch >= maxDispatches) return finish('budget-exhausted');
      const page = await requestPage(partition, 30);
      if (checkpoint()) return finish('navigation-changed');
      if (page.code) return finish(page.code);
    }
    if (unfinished())
      return finish(
        counts.dispatch >= maxDispatches ? 'budget-exhausted' : 'pagination-unfinished'
      );
    return finish('scope-unresolved');
  } catch {
    return finish(Date.now() >= deadline ? 'deadline-exceeded' : 'response-schema-invalid');
  } finally {
    state.cancel = null;
    if (root[privateKey] === state) delete root[privateKey];
  }
}
