/**
 * Shared disposable foreground-tab runtime for the active ChatGPT resolver.
 * The metric wrapper drops all transient candidates; the separate one-item
 * data wrapper returns only a verified, ledger-bound candidate and counts.
 */

import { canonicalBase64ByteLength } from '../lib/base64';
import {
  activeAssetFailure,
  isChatGptActiveAssetPlanItem,
  type ChatGptActiveAssetPlanItem,
  type ChatGptActiveAssetCandidate,
  type ChatGptActiveAssetResponse,
} from '../lib/chatgpt-active-asset-contract';
import {
  getChatGptNumericResolverFileId,
  CHATGPT_RESOLVER_KEY_DOMAIN,
  isChatGptConversationId,
  isChatGptTransientDownloadUrl,
} from '../lib/chatgpt-capture-contract';
import {
  CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT,
  isChatGptActiveResolverHookResult,
  isChatGptActiveResolverProviderFileId,
  type ChatGptActiveResolverHookResult,
  type ChatGptActiveResolverOutcomeCode,
  type ChatGptActiveResolverResponse,
  type ChatGptActiveResolverMetrics,
} from '../lib/chatgpt-active-resolver-contract';

export const CHATGPT_ACTIVE_RESOLVER_TIMEOUT_MS = 190_000;

const CHATGPT_ORIGIN = 'https://chatgpt.com';
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 195_000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const CLEANUP_STEP_TIMEOUT_MS = 500;

interface ActiveResolverTarget {
  tabId: number;
  documentIds?: string[];
}

interface ActiveResolverScriptInjection {
  target: ActiveResolverTarget;
  world: 'MAIN';
  func: (...args: never[]) => unknown;
  args: unknown[];
}

interface ActiveResolverChromeApi {
  tabs: {
    create: (createProperties: { url: string; active: boolean }) => Promise<{ id?: number }>;
    get: (tabId: number) => Promise<{ status?: string; url?: string }>;
    remove: (tabId: number) => Promise<void>;
  };
  scripting: {
    executeScript: (
      injection: ActiveResolverScriptInjection
    ) => Promise<Array<{ result?: unknown; documentId?: string }>>;
  };
}

export interface ChatGptActiveResolverDependencies {
  chromeApi?: ActiveResolverChromeApi;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  createNonce?: () => string;
  digestSha256?: (bytes: Uint8Array) => Promise<string>;
}

type Readiness = 'ready' | 'waiting' | 'unexpected-origin' | 'unexpected-path';
type HookState = ChatGptActiveResolverHookResult | { kind: 'missing' };
type StateRead = { state: HookState; documentId?: string };

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return CHATGPT_ACTIVE_RESOLVER_TIMEOUT_MS;
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

function resolvedDependencies(overrides: ChatGptActiveResolverDependencies) {
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
  return `#liska-capture=${nonce}&liska-active-resolver=1`;
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

async function removeTemporaryTab(chromeApi: ActiveResolverChromeApi, tabId: number | undefined) {
  if (tabId === undefined) return;
  try {
    await withinDeadline(
      Promise.resolve(chromeApi.tabs.remove(tabId)),
      CLEANUP_STEP_TIMEOUT_MS
    ).catch(() => undefined);
  } catch {
    // Cleanup is best effort and never exposes a page-provided error.
  }
}

async function waitForTemporaryTarget(
  chromeApi: ActiveResolverChromeApi,
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
      // A transient tab read remains a bounded wait, never a retrying request.
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
  chromeApi: ActiveResolverChromeApi,
  target: ActiveResolverTarget,
  nonce: string,
  deadline: number,
  now: () => number
): Promise<StateRead> {
  try {
    const execution = await withinDeadline(
      chromeApi.scripting.executeScript({
        target,
        world: 'MAIN',
        func: readChatGptActiveResolverState,
        args: [nonce],
      }),
      remainingTimeout(deadline, now)
    );
    if (execution.length !== 1) return { state: { kind: 'missing' } };
    const entry = execution[0];
    return {
      state: isChatGptActiveResolverHookResult(entry?.result) ? entry.result : { kind: 'missing' },
      documentId: isDocumentId(entry?.documentId) ? entry.documentId : undefined,
    };
  } catch {
    return { state: { kind: 'missing' } };
  }
}

function isCommandAccepted(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  try {
    return Reflect.ownKeys(value).length === 1 && record.accepted === true;
  } catch {
    return false;
  }
}

async function commandHook(
  chromeApi: ActiveResolverChromeApi,
  target: ActiveResolverTarget,
  nonce: string,
  providerFileIds: readonly string[],
  deadline: number,
  now: () => number
): Promise<boolean> {
  try {
    const execution = await withinDeadline(
      chromeApi.scripting.executeScript({
        target,
        world: 'MAIN',
        func: commandChatGptActiveResolver,
        // IDs cross this boundary once, as transient executeScript arguments.
        args: [nonce, [...providerFileIds]],
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

function resolverEnvelope(
  bytes: Uint8Array
):
  | { kind: 'download'; url: string }
  | { kind: 'terminal'; code: ChatGptActiveResolverOutcomeCode } {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { kind: 'terminal', code: 'provider-status-other' };
    }
    const record = parsed as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, 'status'))
      return { kind: 'terminal', code: 'provider-status-absent' };
    if (typeof record.status !== 'string')
      return { kind: 'terminal', code: 'provider-status-non-string' };
    if (record.status === 'file_not_found') return { kind: 'terminal', code: 'file-not-found' };
    if (record.status === 'file_expired') return { kind: 'terminal', code: 'file-expired' };
    if (record.status === 'Retry') return { kind: 'terminal', code: 'provider-retry' };
    if (record.status !== 'Success' && record.status !== 'success')
      return { kind: 'terminal', code: 'provider-status-other' };
    if (
      !Object.prototype.hasOwnProperty.call(record, 'download_url') ||
      typeof record.download_url !== 'string'
    ) {
      return { kind: 'terminal', code: 'success-without-download-url' };
    }
    return { kind: 'download', url: record.download_url };
  } catch {
    return { kind: 'terminal', code: 'payload-integrity-rejected' };
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

async function analyzeOutcome(
  outcome: Extract<ChatGptActiveResolverHookResult, { kind: 'complete' }>['outcomes'][number],
  conversationId: string,
  providerFileId: string,
  digestSha256: (bytes: Uint8Array) => Promise<string>
): Promise<
  | ChatGptActiveResolverOutcomeCode
  | { code: 'observed'; candidate: Omit<ChatGptActiveAssetCandidate, 'assetId'> }
> {
  if (outcome.state !== 'observed') return outcome.state;
  const capture = outcome.capture;
  if (!isJsonResolverMediaType(capture.mediaType)) return 'payload-integrity-rejected';
  const bytes = strictBase64Bytes(capture.bodyBase64);
  if (bytes === undefined || bytes.byteLength !== capture.byteLength)
    return 'payload-integrity-rejected';
  let digest: string;
  try {
    digest = (await digestSha256(bytes)).toLowerCase();
  } catch {
    return 'payload-integrity-rejected';
  }
  if (!/^[a-f0-9]{64}$/.test(digest) || digest !== capture.sha256.toLowerCase())
    return 'payload-integrity-rejected';
  const envelope = resolverEnvelope(bytes);
  if (envelope.kind === 'terminal') return envelope.code;
  const numericFileId = getChatGptNumericResolverFileId(envelope.url);
  const candidate: Omit<ChatGptActiveAssetCandidate, 'assetId'> = { downloadUrl: envelope.url };
  if (numericFileId !== undefined) {
    if (numericFileId !== providerFileId) return 'download-url-binding-rejected';
    try {
      const key = await digestSha256(
        new TextEncoder().encode(`${CHATGPT_RESOLVER_KEY_DOMAIN}${providerFileId}`)
      );
      if (!/^[a-f0-9]{64}$/.test(key)) return 'payload-integrity-rejected';
      candidate.resolverKey = key;
    } catch {
      return 'payload-integrity-rejected';
    }
  } else if (!isChatGptTransientDownloadUrl(envelope.url, conversationId)) {
    return 'download-url-binding-rejected';
  }
  return { code: 'observed', candidate };
}

function attemptedAt(now: () => number): string | undefined {
  try {
    const value = new Date(now()).toISOString();
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

interface ActiveResolverAnalysis {
  metrics: ChatGptActiveResolverMetrics;
  candidates: (Omit<ChatGptActiveAssetCandidate, 'assetId'> | undefined)[];
}
type ActiveResolverRunResponse =
  | { success: true; data: ActiveResolverAnalysis }
  | Extract<ChatGptActiveAssetResponse, { success: false }>;

async function analyzeState(
  state: Extract<ChatGptActiveResolverHookResult, { kind: 'complete' }>,
  conversationId: string,
  providerFileIds: readonly string[],
  digestSha256: (bytes: Uint8Array) => Promise<string>,
  batchAttemptedAt: string
): Promise<ActiveResolverRunResponse | undefined> {
  // Expected IDs bind both ordinal and numeric signed-URL identity. They never
  // appear in the metric response, including for malformed MAIN values.
  if (
    state.conversationId !== conversationId ||
    state.requestedCount !== providerFileIds.length ||
    state.dispatchCount > state.requestedCount ||
    state.outcomes.length !== providerFileIds.length
  ) {
    return undefined;
  }
  const outcomes: ChatGptActiveResolverOutcomeCode[] = [];
  const candidates: ActiveResolverAnalysis['candidates'] = [];
  for (let ordinal = 0; ordinal < state.outcomes.length; ordinal += 1) {
    const outcome = await analyzeOutcome(
      state.outcomes[ordinal],
      conversationId,
      providerFileIds[ordinal],
      digestSha256
    );
    outcomes.push(typeof outcome === 'string' ? outcome : outcome.code);
    candidates.push(typeof outcome === 'string' ? undefined : outcome.candidate);
  }
  return {
    success: true,
    data: {
      candidates,
      metrics: {
        requestedCount: state.requestedCount,
        dispatchCount: state.dispatchCount,
        observedCount: outcomes.filter(outcome => outcome === 'observed').length,
        outcomes,
        attemptedAt: batchAttemptedAt,
      },
    },
  };
}

/**
 * One foreground, marker-gated resolver. It never performs binary acquisition.
 * Internal analyzed URLs remain private until the separate data wrapper binds
 * its one opaque ledger item; the metric wrapper discards them.
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Tab lifecycle and document-id pinning form one boundary.
async function runChatGptActiveResolvers(
  conversationId: string,
  providerFileIds: readonly string[],
  overrides: ChatGptActiveResolverDependencies = {}
): Promise<ActiveResolverRunResponse> {
  if (!isChatGptConversationId(conversationId)) {
    return activeAssetFailure('invalid-conversation-id');
  }
  if (
    !Array.isArray(providerFileIds) ||
    providerFileIds.length === 0 ||
    providerFileIds.length > CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT ||
    providerFileIds.some(fileId => !isChatGptActiveResolverProviderFileId(fileId)) ||
    new Set(providerFileIds).size !== providerFileIds.length
  ) {
    return activeAssetFailure('invalid-provider-file-ids');
  }
  const resolved = resolvedDependencies(overrides);
  const nonce = safeNonce(resolved.createNonce);
  if (nonce === undefined) return activeAssetFailure('nonce-invalid');
  const batchAttemptedAt = attemptedAt(resolved.now);
  if (batchAttemptedAt === undefined) {
    return activeAssetFailure('resolver-result-invalid');
  }
  let deadline: number;
  try {
    deadline = resolved.now() + resolved.timeoutMs;
  } catch {
    return activeAssetFailure('resolver-result-invalid');
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
      return activeAssetFailure('temporary-tab-create-failed');
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
      return activeAssetFailure('temporary-tab-create-failed');
    }
    if (!Number.isSafeInteger(tab.id) || tab.id === undefined) {
      return activeAssetFailure('temporary-tab-missing-id');
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
    if (readiness === 'unexpected-origin') return activeAssetFailure('unexpected-origin');
    if (readiness === 'unexpected-path') return activeAssetFailure('unexpected-path');
    if (readiness !== 'ready') return activeAssetFailure('temporary-tab-ready-timeout');

    // The initial unpinned read is the only one permitted. All later command
    // and state reads target exactly the document that produced this result.
    const initial = await readHookState(
      resolved.chromeApi,
      { tabId },
      nonce,
      deadline,
      resolved.now
    );
    if (initial.documentId === undefined) return activeAssetFailure('document-id-missing');
    if (initial.state.kind === 'error')
      return activeAssetFailure(initial.state.code, initial.state.sourceHttpStatus);
    if (initial.state.kind !== 'ready') return activeAssetFailure('resolver-result-invalid');
    const pinnedTarget = { tabId, documentIds: [initial.documentId] };
    // Check the route once more immediately before the sole ID-bearing command.
    const current = await withinDeadline(
      resolved.chromeApi.tabs.get(tabId),
      remainingTimeout(deadline, resolved.now)
    );
    const currentReadiness = isExactTargetUrl(current.url, conversationId, nonce);
    if (currentReadiness === 'unexpected-origin') return activeAssetFailure('unexpected-origin');
    if (currentReadiness !== 'ready') return activeAssetFailure('unexpected-path');
    if (
      !(await commandHook(
        resolved.chromeApi,
        pinnedTarget,
        nonce,
        providerFileIds,
        deadline,
        resolved.now
      ))
    ) {
      return activeAssetFailure('command-rejected');
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
        return activeAssetFailure('resolver-result-invalid');
      }
      if (read.state.kind === 'error')
        return activeAssetFailure(read.state.code, read.state.sourceHttpStatus);
      if (read.state.kind === 'complete') {
        let metrics: ActiveResolverRunResponse | undefined;
        try {
          metrics = await withinDeadline(
            analyzeState(
              read.state,
              conversationId,
              providerFileIds,
              resolved.digestSha256,
              batchAttemptedAt
            ),
            remainingTimeout(deadline, resolved.now)
          );
        } catch {
          return activeAssetFailure('resolver-result-timeout');
        }
        return metrics ?? activeAssetFailure('resolver-result-invalid');
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
    return activeAssetFailure('resolver-result-timeout');
  } catch {
    return activeAssetFailure('resolver-result-invalid');
  } finally {
    cleanLateCreatedTab = true;
    await removeTemporaryTab(resolved.chromeApi, tabId);
  }
}

/** Existing metric-only boundary discards all transient data from shared analysis. */
export async function probeChatGptActiveAssetResolvers(
  conversationId: string,
  providerFileIds: readonly string[],
  overrides: ChatGptActiveResolverDependencies = {}
): Promise<ChatGptActiveResolverResponse> {
  const result = await runChatGptActiveResolvers(conversationId, providerFileIds, overrides);
  return result.success ? { success: true, data: result.data.metrics } : result;
}

/** Separate one-item data boundary; no alternative network route or retry. */
export async function resolveChatGptActiveAsset(
  conversationId: string,
  item: ChatGptActiveAssetPlanItem,
  overrides: ChatGptActiveResolverDependencies = {}
): Promise<ChatGptActiveAssetResponse> {
  try {
    if (!isChatGptActiveAssetPlanItem(item)) return activeAssetFailure('invalid-provider-file-ids');
    const boundItem = { assetId: item.assetId, providerFileId: item.providerFileId };
    const result = await runChatGptActiveResolvers(
      conversationId,
      [boundItem.providerFileId],
      overrides
    );
    if (!result.success) return result;
    const resolved = result.data.candidates[0];
    const candidate = resolved === undefined ? null : { assetId: boundItem.assetId, ...resolved };
    return {
      success: true,
      data: { assetId: boundItem.assetId, metrics: result.data.metrics, candidate },
    };
  } catch {
    return activeAssetFailure('resolver-result-invalid');
  }
}

/** Serialized, strict MAIN reader. It returns no command arguments or IDs. */
// eslint-disable-next-line complexity, max-lines-per-function -- Self-contained code is serialized into MAIN.
export function readChatGptActiveResolverState(nonce: string): HookState {
  try {
    // executeScript serializes this function without imported module bindings.
    // Keep this local cap aligned with the public diagnostic contract (tested).
    const diagnosticMaxCount = 1;
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
        const descriptor = Object.getOwnPropertyDescriptor(value, expected[expectedIndex]);
        if (!found || descriptor === undefined || !('value' in descriptor)) return false;
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
      `__liskaChatGptActiveResolver_${nonce}`
    ];
    if (typeof snapshot !== 'object' || snapshot === null) return { kind: 'missing' };
    const state = snapshot as Record<string, unknown>;
    const hasSourceHttpStatus = Object.prototype.hasOwnProperty.call(state, 'sourceHttpStatus');
    if (!hasSourceHttpStatus && 'sourceHttpStatus' in state) return { kind: 'missing' };
    if (state.kind === 'ready' && exact(state, ['kind'])) return { kind: 'ready' };
    if (
      state.kind === 'error' &&
      exact(state, ['kind', 'code', ...(hasSourceHttpStatus ? ['sourceHttpStatus'] : [])]) &&
      typeof state.code === 'string'
    ) {
      const codes = [
        'hook-state-failed',
        'source-not-eligible',
        'source-rejected',
        'source-http-4xx',
        'source-http-5xx',
        'source-http-other',
        'source-response-processing-rejected',
        'source-http-error',
        'source-non-json',
        'resolver-result-timeout',
      ];
      if (!allowed(state.code, codes)) return { kind: 'missing' };
      if (hasSourceHttpStatus) {
        const status = state.sourceHttpStatus;
        return state.code === 'source-http-4xx' &&
          typeof status === 'number' &&
          (status as number) >= 400 &&
          (status as number) <= 499 &&
          (status as number) % 1 === 0
          ? { kind: 'error', code: 'source-http-4xx', sourceHttpStatus: status as number }
          : { kind: 'missing' };
      }
      return {
        kind: 'error',
        code: state.code as Extract<ChatGptActiveResolverHookResult, { kind: 'error' }>['code'],
      };
    }
    if (
      state.kind !== 'complete' ||
      !exact(state, ['kind', 'conversationId', 'requestedCount', 'dispatchCount', 'outcomes']) ||
      typeof state.conversationId !== 'string' ||
      !Number.isSafeInteger(state.requestedCount) ||
      !Number.isSafeInteger(state.dispatchCount) ||
      (state.requestedCount as number) < 0 ||
      (state.requestedCount as number) > diagnosticMaxCount ||
      (state.dispatchCount as number) < 0 ||
      (state.dispatchCount as number) > (state.requestedCount as number) ||
      !Array.isArray(state.outcomes)
    ) {
      return { kind: 'missing' };
    }
    const outcomes: unknown[] = [];
    if (state.outcomes.length !== (state.requestedCount as number)) return { kind: 'missing' };
    for (const outcome of state.outcomes) {
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
          typeof capture.byteLength !== 'number' ||
          typeof capture.sha256 !== 'string' ||
          typeof capture.mediaType !== 'string'
        ) {
          return { kind: 'missing' };
        }
        outcomes.push({
          state: 'observed',
          capture: {
            bodyBase64: capture.bodyBase64,
            byteLength: capture.byteLength,
            sha256: capture.sha256,
            mediaType: capture.mediaType,
          },
        });
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
        outcomes.push({ state: value.state });
      } else {
        return { kind: 'missing' };
      }
    }
    return {
      kind: 'complete',
      conversationId: state.conversationId,
      requestedCount: state.requestedCount as number,
      dispatchCount: state.dispatchCount as number,
      outcomes: outcomes as Extract<
        ChatGptActiveResolverHookResult,
        { kind: 'complete' }
      >['outcomes'],
    };
  } catch {
    return { kind: 'missing' };
  }
}

/** One-shot command invoked by executeScript; no ID leaves its return value. */
export function commandChatGptActiveResolver(
  nonce: string,
  providerFileIds: string[]
): { accepted: boolean } {
  try {
    if (typeof nonce !== 'string' || !/^[a-z0-9-]{16,128}$/i.test(nonce))
      return { accepted: false };
    const command = (window as unknown as Record<string, unknown>)[
      `__liskaChatGptActiveResolverCommand_${nonce}`
    ];
    return typeof command === 'function' && command(providerFileIds) === true
      ? { accepted: true }
      : { accepted: false };
  } catch {
    return { accepted: false };
  }
}
