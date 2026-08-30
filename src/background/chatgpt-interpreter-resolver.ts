/**
 * Foreground-tab transport for transient ChatGPT interpreter download URLs.
 * Candidate values cross into MAIN exactly once and never leave it again;
 * MAIN returns ordinal response captures only, which this module correlates to
 * its original in-memory candidate plan.
 */

import { canonicalBase64ByteLength } from '../lib/base64';
import {
  isChatGptConversationId,
  isChatGptTransientDownloadUrl,
} from '../lib/chatgpt-capture-contract';
import {
  createChatGptInterpreterResolverFailure,
  isChatGptInterpreterCandidates,
  isChatGptInterpreterResolverHookResult,
  type ChatGptInterpreterAssetCandidate,
  type ChatGptInterpreterResolverCapture,
  type ChatGptInterpreterResolverHookResult,
  type ChatGptInterpreterResolverResponse,
} from '../lib/chatgpt-interpreter-resolver-contract';

export const CHATGPT_INTERPRETER_RESOLVER_TIMEOUT_MS = 190_000;

const CHATGPT_ORIGIN = 'https://chatgpt.com';
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 195_000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const CLEANUP_STEP_TIMEOUT_MS = 500;

interface InterpreterResolverTarget {
  tabId: number;
  documentIds?: string[];
}

interface InterpreterResolverScriptInjection {
  target: InterpreterResolverTarget;
  world: 'MAIN';
  func: (...args: never[]) => unknown;
  args: unknown[];
}

interface InterpreterResolverChromeApi {
  tabs: {
    create: (createProperties: { url: string; active: boolean }) => Promise<{ id?: number }>;
    get: (tabId: number) => Promise<{ status?: string; url?: string }>;
    remove: (tabId: number) => Promise<void>;
  };
  scripting: {
    executeScript: (
      injection: InterpreterResolverScriptInjection
    ) => Promise<Array<{ result?: unknown; documentId?: string }>>;
  };
}

export interface ChatGptInterpreterResolverDependencies {
  chromeApi?: InterpreterResolverChromeApi;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  createNonce?: () => string;
  digestSha256?: (bytes: Uint8Array) => Promise<string>;
}

type Readiness = 'ready' | 'waiting' | 'unexpected-origin' | 'unexpected-path';
type HookState = ChatGptInterpreterResolverHookResult | { kind: 'missing' };
type StateRead = { state: HookState; documentId?: string };

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value))
    return CHATGPT_INTERPRETER_RESOLVER_TIMEOUT_MS;
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
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

function resolvedDependencies(overrides: ChatGptInterpreterResolverDependencies) {
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
  return `#liska-capture=${nonce}&liska-interpreter-resolver=1`;
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

function isExactTargetUrl(value: unknown, conversationId: string, nonce: string): Readiness {
  if (typeof value !== 'string' || value === 'about:blank') return 'waiting';
  try {
    const url = new URL(value);
    if (url.origin !== CHATGPT_ORIGIN || url.username !== '' || url.password !== '') {
      return 'unexpected-origin';
    }
    return url.pathname === targetPath(conversationId) &&
      url.search === '' &&
      url.hash === marker(nonce)
      ? 'ready'
      : 'unexpected-path';
  } catch {
    return 'unexpected-origin';
  }
}

async function removeTemporaryTab(
  chromeApi: InterpreterResolverChromeApi,
  tabId: number | undefined
) {
  if (tabId === undefined) return;
  try {
    await withinDeadline(
      Promise.resolve(chromeApi.tabs.remove(tabId)),
      CLEANUP_STEP_TIMEOUT_MS
    ).catch(() => undefined);
  } catch {
    // Cleanup remains best effort and carries no page-derived diagnostics.
  }
}

async function waitForTemporaryTarget(
  chromeApi: InterpreterResolverChromeApi,
  tabId: number,
  conversationId: string,
  nonce: string,
  deadline: number,
  now: () => number,
  sleep: (milliseconds: number) => Promise<void>,
  pollIntervalMs: number
): Promise<Readiness> {
  while (now() <= deadline) {
    try {
      const tab = await withinDeadline(chromeApi.tabs.get(tabId), remainingTimeout(deadline, now));
      if (tab.status === 'complete') {
        const readiness = isExactTargetUrl(tab.url, conversationId, nonce);
        if (readiness !== 'waiting') return readiness;
      }
    } catch {
      // A transient tab read remains one bounded wait, never a transport retry.
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    try {
      await withinDeadline(Promise.resolve(sleep(Math.min(pollIntervalMs, remaining))), remaining);
    } catch {
      break;
    }
  }
  return 'waiting';
}

function isDocumentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,256}$/.test(value);
}

async function readHookState(
  chromeApi: InterpreterResolverChromeApi,
  target: InterpreterResolverTarget,
  nonce: string,
  deadline: number,
  now: () => number
): Promise<StateRead> {
  try {
    const execution = await withinDeadline(
      chromeApi.scripting.executeScript({
        target,
        world: 'MAIN',
        func: readChatGptInterpreterResolverState,
        args: [nonce],
      }),
      remainingTimeout(deadline, now)
    );
    if (execution.length !== 1) return { state: { kind: 'missing' } };
    const entry = execution[0];
    return {
      state: isChatGptInterpreterResolverHookResult(entry?.result)
        ? entry.result
        : { kind: 'missing' },
      documentId: isDocumentId(entry?.documentId) ? entry.documentId : undefined,
    };
  } catch {
    return { state: { kind: 'missing' } };
  }
}

function isCommandAccepted(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    return (
      Reflect.ownKeys(value).length === 1 && (value as Record<string, unknown>).accepted === true
    );
  } catch {
    return false;
  }
}

async function commandHook(
  chromeApi: InterpreterResolverChromeApi,
  target: InterpreterResolverTarget,
  nonce: string,
  candidates: readonly ChatGptInterpreterAssetCandidate[],
  deadline: number,
  now: () => number
): Promise<boolean> {
  try {
    const execution = await withinDeadline(
      chromeApi.scripting.executeScript({
        target,
        world: 'MAIN',
        func: commandChatGptInterpreterResolver,
        // Candidate details cross the extension/MAIN boundary only here.
        args: [nonce, candidates.map(candidate => ({ ...candidate }))],
      }),
      remainingTimeout(deadline, now)
    );
    return (
      execution.length === 1 &&
      execution[0]?.documentId === target.documentIds?.[0] &&
      isCommandAccepted(execution[0]?.result)
    );
  } catch {
    return false;
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

function isJsonResolverMediaType(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) return false;
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) <= 0x1f) return false;
  }
  const essence = value.split(';', 1)[0]?.trim().toLowerCase();
  return essence === 'application/json' || essence?.endsWith('+json') === true;
}

/**
 * Accept the live success envelope's own status/download_url fields while
 * discarding its descriptive metadata. Legacy minimal envelopes remain
 * supported for captured conversations that still emit them.
 */
function downloadUrlFromInterpreterBody(bytes: Uint8Array): string | undefined {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    const keys = Reflect.ownKeys(parsed);
    const exactDownload = keys.length === 1 && keys[0] === 'download_url';
    const successfulEnvelope =
      Object.prototype.hasOwnProperty.call(record, 'status') &&
      Object.prototype.hasOwnProperty.call(record, 'download_url') &&
      (record.status === 'Success' || record.status === 'success');
    return (exactDownload || successfulEnvelope) && typeof record.download_url === 'string'
      ? record.download_url
      : undefined;
  } catch {
    return undefined;
  }
}

async function validatedDownloadUrl(
  capture: ChatGptInterpreterResolverCapture,
  conversationId: string,
  digestSha256: (bytes: Uint8Array) => Promise<string>
): Promise<string | undefined> {
  if (!isJsonResolverMediaType(capture.mediaType)) return undefined;
  const bytes = strictBase64Bytes(capture.bodyBase64);
  if (bytes === undefined || bytes.byteLength !== capture.byteLength) return undefined;
  try {
    const digest = (await digestSha256(bytes)).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(digest) || digest !== capture.sha256.toLowerCase()) return undefined;
  } catch {
    return undefined;
  }
  const url = downloadUrlFromInterpreterBody(bytes);
  return isChatGptTransientDownloadUrl(url, conversationId) ? url : undefined;
}

async function responseFromState(
  state: Extract<ChatGptInterpreterResolverHookResult, { kind: 'complete' }>,
  conversationId: string,
  candidates: readonly ChatGptInterpreterAssetCandidate[],
  digestSha256: (bytes: Uint8Array) => Promise<string>
): Promise<ChatGptInterpreterResolverResponse | undefined> {
  if (
    state.conversationId !== conversationId ||
    state.requestedCount !== candidates.length ||
    state.dispatchCount > state.requestedCount ||
    state.outcomes.length !== candidates.length
  ) {
    return undefined;
  }
  const resolved: Array<{ assetId: string; downloadUrl: string }> = [];
  for (let ordinal = 0; ordinal < state.outcomes.length; ordinal += 1) {
    const outcome = state.outcomes[ordinal];
    if (ordinal >= state.dispatchCount || outcome.state !== 'observed') continue;
    const downloadUrl = await validatedDownloadUrl(outcome.capture, conversationId, digestSha256);
    if (downloadUrl !== undefined) {
      resolved.push({ assetId: candidates[ordinal].assetId, downloadUrl });
    }
  }
  return { success: true, data: { resolved } };
}

/**
 * One foreground, document-pinned, no-retry interpreter resolver transport.
 * Completion permits an empty/partial resolved subset; malformed item payloads
 * are omitted rather than disclosed as per-candidate diagnostics.
 */
// eslint-disable-next-line max-lines-per-function, complexity -- This tab/document state machine is one security boundary.
export async function resolveChatGptInterpreterAssets(
  conversationId: string,
  candidates: readonly ChatGptInterpreterAssetCandidate[],
  overrides: ChatGptInterpreterResolverDependencies = {}
): Promise<ChatGptInterpreterResolverResponse> {
  if (!isChatGptConversationId(conversationId)) {
    return createChatGptInterpreterResolverFailure('invalid-conversation-id');
  }
  if (!isChatGptInterpreterCandidates(candidates)) {
    return createChatGptInterpreterResolverFailure('invalid-interpreter-candidates');
  }
  const resolved = resolvedDependencies(overrides);
  const nonce = safeNonce(resolved.createNonce);
  if (nonce === undefined) return createChatGptInterpreterResolverFailure('nonce-invalid');
  let deadline: number;
  try {
    deadline = resolved.now() + resolved.timeoutMs;
  } catch {
    return createChatGptInterpreterResolverFailure('interpreter-result-invalid');
  }
  let tabId: number | undefined;
  let cleanLateCreatedTab = false;
  try {
    let creation: Promise<{ id?: number }>;
    try {
      creation = Promise.resolve(
        resolved.chromeApi.tabs.create({ url: targetUrl(conversationId, nonce), active: true })
      );
    } catch {
      return createChatGptInterpreterResolverFailure('temporary-tab-create-failed');
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
      return createChatGptInterpreterResolverFailure('temporary-tab-create-failed');
    }
    if (!Number.isSafeInteger(tab.id) || tab.id === undefined) {
      return createChatGptInterpreterResolverFailure('temporary-tab-missing-id');
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
      return createChatGptInterpreterResolverFailure('unexpected-origin');
    if (readiness === 'unexpected-path')
      return createChatGptInterpreterResolverFailure('unexpected-path');
    if (readiness !== 'ready')
      return createChatGptInterpreterResolverFailure('temporary-tab-ready-timeout');

    const initial = await readHookState(
      resolved.chromeApi,
      { tabId },
      nonce,
      deadline,
      resolved.now
    );
    if (initial.documentId === undefined)
      return createChatGptInterpreterResolverFailure('document-id-missing');
    if (initial.state.kind === 'error')
      return createChatGptInterpreterResolverFailure(initial.state.code);
    if (initial.state.kind !== 'ready')
      return createChatGptInterpreterResolverFailure('interpreter-result-invalid');
    const pinnedTarget = { tabId, documentIds: [initial.documentId] };
    const current = await withinDeadline(
      resolved.chromeApi.tabs.get(tabId),
      remainingTimeout(deadline, resolved.now)
    );
    const currentReadiness = isExactTargetUrl(current.url, conversationId, nonce);
    if (currentReadiness === 'unexpected-origin')
      return createChatGptInterpreterResolverFailure('unexpected-origin');
    if (currentReadiness !== 'ready')
      return createChatGptInterpreterResolverFailure('unexpected-path');
    if (
      !(await commandHook(
        resolved.chromeApi,
        pinnedTarget,
        nonce,
        candidates,
        deadline,
        resolved.now
      ))
    ) {
      return createChatGptInterpreterResolverFailure('command-rejected');
    }
    while (resolved.now() <= deadline) {
      const read = await readHookState(
        resolved.chromeApi,
        pinnedTarget,
        nonce,
        deadline,
        resolved.now
      );
      if (read.documentId !== initial.documentId) {
        return createChatGptInterpreterResolverFailure('interpreter-result-invalid');
      }
      if (read.state.kind === 'error')
        return createChatGptInterpreterResolverFailure(read.state.code);
      if (read.state.kind === 'complete') {
        try {
          const response = await withinDeadline(
            responseFromState(read.state, conversationId, candidates, resolved.digestSha256),
            remainingTimeout(deadline, resolved.now)
          );
          return response ?? createChatGptInterpreterResolverFailure('interpreter-result-invalid');
        } catch {
          return createChatGptInterpreterResolverFailure('interpreter-result-timeout');
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
    return createChatGptInterpreterResolverFailure('interpreter-result-timeout');
  } catch {
    return createChatGptInterpreterResolverFailure('interpreter-result-invalid');
  } finally {
    cleanLateCreatedTab = true;
    await removeTemporaryTab(resolved.chromeApi, tabId);
  }
}

/** Strict MAIN snapshot reader. It reconstructs ordinal-only state, never candidates. */
// eslint-disable-next-line complexity, max-lines-per-function -- Serialized MAIN validation must remain self-contained and closure-free.
export function readChatGptInterpreterResolverState(nonce: string): HookState {
  try {
    const exact = (value: object, expected: readonly string[]): boolean => {
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
    const allowed = (value: string, options: readonly string[]): boolean => {
      for (let index = 0; index < options.length; index += 1) {
        if (options[index] === value) return true;
      }
      return false;
    };
    if (typeof nonce !== 'string' || !/^[a-z0-9-]{16,128}$/i.test(nonce))
      return { kind: 'missing' };
    const snapshot = (window as unknown as Record<string, unknown>)[
      `__liskaChatGptInterpreterResolver_${nonce}`
    ];
    if (typeof snapshot !== 'object' || snapshot === null) return { kind: 'missing' };
    const state = snapshot as Record<string, unknown>;
    if (state.kind === 'ready' && exact(state, ['kind'])) return { kind: 'ready' };
    if (
      state.kind === 'error' &&
      exact(state, ['kind', 'code']) &&
      typeof state.code === 'string'
    ) {
      const codes = [
        'source-not-eligible',
        'source-rejected',
        'source-http-error',
        'source-non-json',
        'interpreter-result-timeout',
        'interpreter-result-invalid',
      ];
      return allowed(state.code, codes)
        ? {
            kind: 'error',
            code: state.code as Extract<
              ChatGptInterpreterResolverHookResult,
              { kind: 'error' }
            >['code'],
          }
        : { kind: 'missing' };
    }
    if (
      state.kind !== 'complete' ||
      !exact(state, ['kind', 'conversationId', 'requestedCount', 'dispatchCount', 'outcomes']) ||
      typeof state.conversationId !== 'string' ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(state.conversationId) ||
      !Number.isSafeInteger(state.requestedCount) ||
      !Number.isSafeInteger(state.dispatchCount) ||
      (state.requestedCount as number) < 0 ||
      (state.requestedCount as number) > 20 ||
      (state.dispatchCount as number) < 0 ||
      (state.dispatchCount as number) > (state.requestedCount as number) ||
      !Array.isArray(state.outcomes) ||
      state.outcomes.length !== (state.requestedCount as number)
    ) {
      return { kind: 'missing' };
    }
    const outcomes: unknown[] = [];
    for (let index = 0; index < state.outcomes.length; index += 1) {
      const outcome = state.outcomes[index];
      if (typeof outcome !== 'object' || outcome === null) return { kind: 'missing' };
      const value = outcome as Record<string, unknown>;
      if (value.state === 'observed') {
        if (
          !exact(value, ['state', 'capture']) ||
          typeof value.capture !== 'object' ||
          value.capture === null
        ) {
          return { kind: 'missing' };
        }
        const capture = value.capture as Record<string, unknown>;
        if (
          !exact(capture, ['bodyBase64', 'byteLength', 'sha256', 'mediaType']) ||
          typeof capture.bodyBase64 !== 'string' ||
          capture.bodyBase64.length > 96 * 1024 ||
          !Number.isSafeInteger(capture.byteLength) ||
          (capture.byteLength as number) < 0 ||
          (capture.byteLength as number) > 64 * 1024 ||
          typeof capture.sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/i.test(capture.sha256) ||
          typeof capture.mediaType !== 'string' ||
          capture.mediaType.length === 0 ||
          capture.mediaType.length > 255
        ) {
          return { kind: 'missing' };
        }
        outcomes[outcomes.length] = {
          state: 'observed',
          capture: {
            bodyBase64: capture.bodyBase64,
            byteLength: capture.byteLength,
            sha256: capture.sha256,
            mediaType: capture.mediaType,
          },
        };
      } else if (
        exact(value, ['state']) &&
        typeof value.state === 'string' &&
        allowed(value.state, [
          'http-error',
          'fetch-rejected',
          'response-processing-rejected',
          'non-json',
          'oversized',
          'timed-out',
          'not-dispatched',
        ])
      ) {
        outcomes[outcomes.length] = { state: value.state };
      } else {
        return { kind: 'missing' };
      }
      if (
        (index < (state.dispatchCount as number) && value.state === 'not-dispatched') ||
        (index >= (state.dispatchCount as number) && value.state !== 'not-dispatched')
      ) {
        return { kind: 'missing' };
      }
    }
    return {
      kind: 'complete',
      conversationId: state.conversationId,
      requestedCount: state.requestedCount as number,
      dispatchCount: state.dispatchCount as number,
      outcomes: outcomes as Extract<
        ChatGptInterpreterResolverHookResult,
        { kind: 'complete' }
      >['outcomes'],
    };
  } catch {
    return { kind: 'missing' };
  }
}

/** One-shot candidate command. Its result exposes no candidate value. */
export function commandChatGptInterpreterResolver(
  nonce: string,
  candidates: ChatGptInterpreterAssetCandidate[]
): { accepted: boolean } {
  try {
    if (typeof nonce !== 'string' || !/^[a-z0-9-]{16,128}$/i.test(nonce)) {
      return { accepted: false };
    }
    const command = (window as unknown as Record<string, unknown>)[
      `__liskaChatGptInterpreterResolverCommand_${nonce}`
    ];
    return typeof command === 'function' && command(candidates) === true
      ? { accepted: true }
      : { accepted: false };
  } catch {
    return { accepted: false };
  }
}
