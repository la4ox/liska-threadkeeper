/**
 * One user-initiated, selected-tab Dots transport-schema observation.
 *
 * The page's own requests remain authoritative. Background code reloads the
 * already-selected Dots tab once, reads only the nonce-scoped content-free
 * projection, validates it again, removes only its marker, and writes one
 * local diagnostic JSON file.
 */

import {
  DOTS_SCHEMA_PROBE_ERROR_CODES,
  DOTS_SCHEMA_PROBE_FILE_NAME,
  DOTS_SCHEMA_PROBE_MAX_BYTES,
  DOTS_SCHEMA_PROBE_TIMEOUT_MS,
  createDotsSchemaProbeFailure,
  snapshotDotsSchemaProbeEvidence,
  type DotsSchemaProbeErrorCode,
  type DotsSchemaProbeEvidence,
  type DotsSchemaProbeResponse,
} from '../lib/dots-schema-probe-contract';
import { readDotsSchemaProbeState } from '../content/capture/dots-schema-document-start';
import { downloadArchiveBlob } from './output-handlers';

const DOTS_ORIGIN = 'https://chatgpt.com';
// Deliberately narrower than the page observer: every admitted route is
// observer-compatible, while no trailing-slash/dotted variant is guessed.
const DOTS_PATH_PATTERN = /^\/dots(?:\/[A-Za-z0-9][A-Za-z0-9_~-]{0,511})?$/;
const DOTS_MARKER_PREFIX = '#liska-dots-schema=';
const NONCE_PATTERN = /^[A-Za-z0-9-]{16,128}$/;
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,256}$/;
const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_BACKGROUND_TIMEOUT_MS = DOTS_SCHEMA_PROBE_TIMEOUT_MS + 5_000;
const MIN_TIMEOUT_MS = 50;
const MAX_TIMEOUT_MS = 30_000;
const CLEANUP_TIMEOUT_MS = 1_000;
const BASE64_CHUNK_BYTES = 8192;

type ProbeTarget = { tabId: number; frameIds?: [0]; documentIds?: [string] };

interface DotsSchemaProbeChromeApi {
  tabs: {
    query: (queryInfo: { active: true; currentWindow: true }) => Promise<chrome.tabs.Tab[]>;
    update: (tabId: number, updateProperties: { url: string }) => Promise<chrome.tabs.Tab>;
    reload: (tabId: number) => Promise<void>;
    get: (tabId: number) => Promise<chrome.tabs.Tab>;
  };
  scripting: {
    executeScript: (injection: {
      target: ProbeTarget;
      world: 'MAIN';
      func: (...args: never[]) => unknown;
      args: unknown[];
    }) => Promise<Array<{ result?: unknown; documentId?: string; frameId?: number }>>;
  };
}

export interface DotsSchemaProbeDependencies {
  chromeApi?: DotsSchemaProbeChromeApi;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  createNonce?: () => string;
  operations?: Set<number>;
  downloadEvidence?: (compactJson: string) => Promise<boolean>;
}

/** Keep this popup-only diagnostic out of content-script and other extension senders. */
export function isAuthorizedDotsSchemaProbeSender(
  sender: chrome.runtime.MessageSender,
  runtimeId: string,
  popupUrl: string
): boolean {
  return sender.tab === undefined && sender.id === runtimeId && sender.url === popupUrl;
}

type HookState =
  | { kind: 'missing' }
  | { kind: 'ready' }
  | { kind: 'completed'; projection: unknown }
  | { kind: 'error'; code: DotsSchemaProbeErrorCode };

type StateRead = {
  state: HookState;
  documentId?: string;
  unavailable: boolean;
};

type ObservationResult =
  | { success: true; evidence: DotsSchemaProbeEvidence; documentId: string }
  | { success: false; code: DotsSchemaProbeErrorCode; documentId?: string };

type MarkerUpdate = { promise: Promise<chrome.tabs.Tab>; settled: boolean };

const activeOperations = new Set<number>();
const hookErrorCodes = new Set<string>([
  'hook-state-failed',
  'request-failed',
  'response-http-error',
  'response-route-mismatch',
  'response-media-type-invalid',
  'response-processing-failed',
  'payload-too-large',
  'schema-limit-exceeded',
  'schema-invalid',
  'ambiguous-room',
  'duplicate-endpoint',
  'target-not-observed',
  'request-init-present',
  'timed-out',
  'navigation-changed',
]);

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function defaultNonce(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('nonce');
  return globalThis.crypto.randomUUID();
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_BACKGROUND_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(value)));
}

function normalizePollInterval(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_POLL_INTERVAL_MS;
  return Math.min(1_000, Math.max(1, Math.floor(value)));
}

function remaining(deadline: number, now: () => number): number {
  return Math.max(1, deadline - now());
}

function withinDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('deadline')), timeoutMs);
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

function compactStringToBase64(value: string): string | undefined {
  try {
    const bytes = new TextEncoder().encode(value);
    if (bytes.byteLength > DOTS_SCHEMA_PROBE_MAX_BYTES) return undefined;
    const parts: string[] = [];
    for (let offset = 0; offset < bytes.byteLength; offset += BASE64_CHUNK_BYTES) {
      parts.push(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES)));
    }
    return btoa(parts.join(''));
  } catch {
    return undefined;
  }
}

async function defaultDownloadEvidence(compactJson: string): Promise<boolean> {
  const bodyBase64 = compactStringToBase64(compactJson);
  if (bodyBase64 === undefined) return false;
  try {
    const outcome = await downloadArchiveBlob(
      `data:application/json;base64,${bodyBase64}`,
      DOTS_SCHEMA_PROBE_FILE_NAME,
      async () => undefined
    );
    return outcome.terminal && outcome.error === null;
  } catch {
    return false;
  }
}

function dependencies(overrides: DotsSchemaProbeDependencies) {
  return {
    chromeApi: overrides.chromeApi ?? { tabs: chrome.tabs, scripting: chrome.scripting },
    now: overrides.now ?? Date.now,
    sleep: overrides.sleep ?? defaultSleep,
    timeoutMs: normalizeTimeout(overrides.timeoutMs),
    pollIntervalMs: normalizePollInterval(overrides.pollIntervalMs),
    createNonce: overrides.createNonce ?? defaultNonce,
    operations: overrides.operations ?? activeOperations,
    downloadEvidence: overrides.downloadEvidence ?? defaultDownloadEvidence,
  };
}

function safeNonce(createNonce: () => string): string | undefined {
  try {
    const nonce = createNonce();
    return NONCE_PATTERN.test(nonce) ? nonce : undefined;
  } catch {
    return undefined;
  }
}

function safeDocumentId(value: unknown): value is string {
  return typeof value === 'string' && DOCUMENT_ID_PATTERN.test(value);
}

function ownDataRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expectedKeys.length) return undefined;
    const record: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string' || !expectedKeys.includes(key)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return undefined;
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return undefined;
  }
}

// eslint-disable-next-line complexity -- Exact hostile-state key/code validation is intentionally linear.
function hookState(value: unknown): HookState {
  const kindDescriptor =
    typeof value === 'object' && value !== null
      ? Object.getOwnPropertyDescriptor(value, 'kind')
      : undefined;
  if (!kindDescriptor || !('value' in kindDescriptor) || !kindDescriptor.enumerable) {
    return { kind: 'missing' };
  }
  if (kindDescriptor.value === 'ready') {
    return ownDataRecord(value, ['kind'])?.kind === 'ready'
      ? { kind: 'ready' }
      : { kind: 'missing' };
  }
  if (kindDescriptor.value === 'completed') {
    const record = ownDataRecord(value, ['kind', 'projection']);
    return record?.kind === 'completed'
      ? { kind: 'completed', projection: record.projection }
      : { kind: 'missing' };
  }
  if (kindDescriptor.value === 'error') {
    const record = ownDataRecord(value, ['kind', 'code']);
    return record?.kind === 'error' &&
      typeof record.code === 'string' &&
      hookErrorCodes.has(record.code)
      ? { kind: 'error', code: record.code as DotsSchemaProbeErrorCode }
      : { kind: 'missing' };
  }
  return ownDataRecord(value, ['kind'])?.kind === 'missing'
    ? { kind: 'missing' }
    : { kind: 'missing' };
}

/** Only exact Dots pages without query/fragment are eligible for the probe. */
export function dotsSchemaProbeTargetUrl(rawUrl: unknown, nonce: string): string | undefined {
  if (typeof rawUrl !== 'string' || !NONCE_PATTERN.test(nonce)) return undefined;
  try {
    const url = new URL(rawUrl);
    if (
      url.origin !== DOTS_ORIGIN ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      url.search !== '' ||
      url.hash !== '' ||
      !DOTS_PATH_PATTERN.test(url.pathname)
    ) {
      return undefined;
    }
    url.hash = `${DOTS_MARKER_PREFIX.slice(1)}${nonce}`;
    return url.href;
  } catch {
    return undefined;
  }
}

function exactMarkerUrl(rawUrl: unknown, expectedUrl: string): boolean {
  return rawUrl === expectedUrl;
}

/** After arming, the host may remove only our fragment in the same document. */
function probeDocumentUrl(rawUrl: unknown, markerUrl: string): boolean {
  return exactMarkerUrl(rawUrl, markerUrl) || rawUrl === markerUrl.slice(0, markerUrl.indexOf('#'));
}

async function readState(
  chromeApi: DotsSchemaProbeChromeApi,
  target: ProbeTarget,
  nonce: string,
  deadline: number,
  now: () => number
): Promise<StateRead> {
  try {
    const execution = await withinDeadline(
      chromeApi.scripting.executeScript({
        target,
        world: 'MAIN',
        func: readDotsSchemaProbeState,
        args: [nonce],
      }),
      remaining(deadline, now)
    );
    if (execution.length !== 1) return { state: { kind: 'missing' }, unavailable: false };
    const entry = execution[0];
    if (entry?.frameId !== 0) {
      return { state: { kind: 'missing' }, unavailable: false };
    }
    return {
      state: hookState(entry?.result),
      documentId: safeDocumentId(entry?.documentId) ? entry.documentId : undefined,
      unavailable: false,
    };
  } catch {
    return { state: { kind: 'missing' }, unavailable: true };
  }
}

// eslint-disable-next-line complexity, max-lines-per-function -- Route, document and state ownership share one bounded polling loop.
async function observeProjection(
  chromeApi: DotsSchemaProbeChromeApi,
  tabId: number,
  markerUrl: string,
  nonce: string,
  deadline: number,
  now: () => number,
  sleep: (milliseconds: number) => Promise<void>,
  pollIntervalMs: number
): Promise<ObservationResult> {
  let documentId: string | undefined;
  while (now() <= deadline) {
    let tab: chrome.tabs.Tab;
    try {
      tab = await withinDeadline(chromeApi.tabs.get(tabId), remaining(deadline, now));
    } catch {
      return { success: false, code: 'document-unavailable', documentId };
    }
    if (!probeDocumentUrl(tab.url, markerUrl)) {
      return { success: false, code: 'navigation-changed', documentId };
    }
    const target: ProbeTarget = documentId
      ? { tabId, documentIds: [documentId] }
      : { tabId, frameIds: [0] };
    const read = await readState(chromeApi, target, nonce, deadline, now);
    if (documentId && (read.unavailable || read.documentId !== documentId)) {
      return { success: false, code: 'document-replaced', documentId };
    }
    if (read.state.kind !== 'missing') {
      if (!read.documentId) return { success: false, code: 'document-unavailable', documentId };
      if (documentId && read.documentId !== documentId) {
        return { success: false, code: 'document-replaced', documentId };
      }
      documentId ??= read.documentId;
      if (read.state.kind === 'error') {
        return { success: false, code: read.state.code, documentId };
      }
      if (read.state.kind === 'completed') {
        const evidence = snapshotDotsSchemaProbeEvidence(read.state.projection);
        return evidence
          ? { success: true, evidence, documentId }
          : { success: false, code: 'result-invalid', documentId };
      }
    }
    const wait = deadline - now();
    if (wait <= 0) break;
    try {
      await withinDeadline(
        Promise.resolve(sleep(Math.min(pollIntervalMs, wait))),
        remaining(deadline, now)
      );
    } catch {
      break;
    }
  }
  return { success: false, code: 'timed-out', documentId };
}

/** Serialized into the selected page document; removes only this exact owned URL marker. */
export function removeDotsSchemaProbeMarker(nonce: string, markerUrl: string): boolean {
  try {
    if (typeof nonce !== 'string' || !/^[A-Za-z0-9-]{16,128}$/.test(nonce)) return false;
    const expected = `#liska-dots-schema=${nonce}`;
    if (typeof markerUrl !== 'string') return false;
    const url = new URL(markerUrl);
    if (url.href !== markerUrl || url.hash !== expected) return false;
    url.hash = '';
    const baseUrl = url.href;
    // A same-document host cleanup is already complete; never touch history.
    if (window.location.href === baseUrl && window.location.hash === '') return true;
    if (window.location.href !== markerUrl || window.location.hash !== expected) return false;
    window.history.replaceState(window.history.state, '', url.href);
    return window.location.href === baseUrl && window.location.hash === '';
  } catch {
    return false;
  }
}

// eslint-disable-next-line complexity -- Pinned cleanup and its exact-URL fallback share one independent deadline.
async function cleanupMarker(
  chromeApi: DotsSchemaProbeChromeApi,
  tabId: number,
  documentId: string | undefined,
  nonce: string,
  markerUrl: string,
  now: () => number,
  requirePinnedResult: boolean
): Promise<boolean> {
  try {
    // Observation may already have exhausted its budget. Cleanup is a distinct,
    // small operation and must still be able to remove the marker on failure.
    const deadline = now() + CLEANUP_TIMEOUT_MS;
    const targets: ProbeTarget[] = documentId ? [{ tabId, documentIds: [documentId] }] : [];
    targets.push({ tabId, frameIds: [0] });
    for (const target of targets) {
      if (now() >= deadline) return false;
      const tab = await withinDeadline(chromeApi.tabs.get(tabId), remaining(deadline, now));
      if (!probeDocumentUrl(tab.url, markerUrl)) return false;
      let execution: Array<{ result?: unknown; documentId?: string; frameId?: number }>;
      try {
        execution = await withinDeadline(
          chromeApi.scripting.executeScript({
            target,
            world: 'MAIN',
            func: removeDotsSchemaProbeMarker,
            args: [nonce, markerUrl],
          }),
          remaining(deadline, now)
        );
      } catch {
        continue;
      }
      if (
        execution.length === 1 &&
        safeDocumentId(execution[0]?.documentId) &&
        (target.documentIds === undefined || execution[0].documentId === documentId) &&
        execution[0]?.frameId === 0 &&
        execution[0]?.result === true
      )
        // An unpinned fallback may clear a stranded marker, but it cannot
        // authorize downloading evidence captured from a replaced document.
        return !requirePinnedResult || target.documentIds !== undefined;
    }
    return false;
  } catch {
    return false;
  }
}

function issueMarkerUpdate(
  chromeApi: DotsSchemaProbeChromeApi,
  tabId: number,
  markerUrl: string
): MarkerUpdate {
  const update: MarkerUpdate = {
    promise: chromeApi.tabs.update(tabId, { url: markerUrl }),
    settled: false,
  };
  void update.promise.then(
    () => {
      update.settled = true;
    },
    () => {
      update.settled = true;
    }
  );
  return update;
}

async function reconcileLateMarkerCommit(
  chromeApi: DotsSchemaProbeChromeApi,
  tabId: number,
  nonce: string,
  markerUrl: string,
  now: () => number,
  sleep: (milliseconds: number) => Promise<void>
): Promise<void> {
  try {
    const deadline = now() + CLEANUP_TIMEOUT_MS;
    const originalUrl = markerUrl.slice(0, markerUrl.indexOf('#'));
    while (now() < deadline) {
      const tab = await withinDeadline(chromeApi.tabs.get(tabId), remaining(deadline, now));
      if (exactMarkerUrl(tab.url, markerUrl)) {
        await cleanupMarker(chromeApi, tabId, undefined, nonce, markerUrl, now, false);
        return;
      }
      // Chrome can settle update before the fragment commit becomes visible,
      // or the host may already have removed it. A stable exact base URL needs
      // no mutation; wait only through this bounded reconciliation window.
      // Never wait on or alter any later path, query or fragment.
      if (tab.url !== originalUrl) return;
      const wait = deadline - now();
      if (wait <= 0) return;
      await withinDeadline(
        Promise.resolve(sleep(Math.min(DEFAULT_POLL_INTERVAL_MS, wait))),
        remaining(deadline, now)
      );
    }
  } catch {
    // Late cleanup has no user-facing result and never repeats the mutation.
  }
}

/** A timeout cancels our wait, not the issued tab mutation or its cleanup ownership. */
function deferPendingMarkerCleanup(
  update: MarkerUpdate,
  chromeApi: DotsSchemaProbeChromeApi,
  tabId: number,
  nonce: string,
  markerUrl: string,
  now: () => number,
  sleep: (milliseconds: number) => Promise<void>,
  operations: Set<number>
): void {
  let reconciled = false;
  const reconcile = async (): Promise<void> => {
    if (reconciled) return;
    reconciled = true;
    try {
      await reconcileLateMarkerCommit(chromeApi, tabId, nonce, markerUrl, now, sleep);
    } finally {
      operations.delete(tabId);
    }
  };
  // Both outcomes may follow an uncertain commit. Neither reissues update or
  // reload; only the exact nonce URL can be cleaned. Keep the tab locked until
  // Chrome settles the original mutation, including beyond the caller timeout.
  void update.promise.then(reconcile, reconcile).catch(() => operations.delete(tabId));
}

/**
 * Probe the active current-window Dots tab and download one content-free JSON
 * schema. No provider request is generated by background code.
 */
// eslint-disable-next-line complexity, max-lines-per-function -- The tab/document/download ownership is one bounded lifecycle.
export async function probeDotsSchemaInActiveTab(
  overrides: DotsSchemaProbeDependencies = {}
): Promise<DotsSchemaProbeResponse> {
  const resolved = dependencies(overrides);
  let deadline: number;
  try {
    deadline = resolved.now() + resolved.timeoutMs;
  } catch {
    return createDotsSchemaProbeFailure('result-invalid');
  }
  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await withinDeadline(
      resolved.chromeApi.tabs.query({ active: true, currentWindow: true }),
      remaining(deadline, resolved.now)
    );
  } catch {
    return createDotsSchemaProbeFailure('active-tab-required');
  }
  if (tabs.length !== 1 || !Number.isSafeInteger(tabs[0]?.id) || tabs[0]?.id === undefined) {
    return createDotsSchemaProbeFailure('active-tab-required');
  }
  const tabId = tabs[0].id;
  if (resolved.operations.has(tabId)) {
    return createDotsSchemaProbeFailure('operation-in-progress');
  }
  if (typeof tabs[0].url === 'string') {
    try {
      if (new URL(tabs[0].url).hash !== '') {
        return createDotsSchemaProbeFailure('conflicting-fragment');
      }
    } catch {
      return createDotsSchemaProbeFailure('dots-route-required');
    }
  }
  const nonce = safeNonce(resolved.createNonce);
  if (!nonce) return createDotsSchemaProbeFailure('nonce-invalid');
  const markerUrl = dotsSchemaProbeTargetUrl(tabs[0].url, nonce);
  if (!markerUrl) return createDotsSchemaProbeFailure('dots-route-required');

  resolved.operations.add(tabId);
  let documentId: string | undefined;
  let markerUpdate: MarkerUpdate | undefined;
  let markerUpdateAttempted = false;
  let cleanupAttempted = false;
  try {
    try {
      markerUpdateAttempted = true;
      markerUpdate = issueMarkerUpdate(resolved.chromeApi, tabId, markerUrl);
      const updated = await withinDeadline(markerUpdate.promise, remaining(deadline, resolved.now));
      if (updated.id !== undefined && updated.id !== tabId) {
        return createDotsSchemaProbeFailure('tab-update-failed');
      }
      await withinDeadline(
        resolved.chromeApi.tabs.reload(tabId),
        remaining(deadline, resolved.now)
      );
    } catch {
      return createDotsSchemaProbeFailure('tab-update-failed');
    }

    const observation = await observeProjection(
      resolved.chromeApi,
      tabId,
      markerUrl,
      nonce,
      deadline,
      resolved.now,
      resolved.sleep,
      resolved.pollIntervalMs
    );
    documentId = observation.documentId;
    if (!observation.success) return createDotsSchemaProbeFailure(observation.code);

    cleanupAttempted = true;
    const cleanupSucceeded = await cleanupMarker(
      resolved.chromeApi,
      tabId,
      observation.documentId,
      nonce,
      markerUrl,
      resolved.now,
      true
    );
    if (!cleanupSucceeded) return createDotsSchemaProbeFailure('cleanup-failed');

    let compactJson: string;
    try {
      compactJson = JSON.stringify(observation.evidence);
    } catch {
      return createDotsSchemaProbeFailure('result-invalid');
    }
    if (
      compactJson.length > DOTS_SCHEMA_PROBE_MAX_BYTES ||
      !(await resolved.downloadEvidence(compactJson).catch(() => false))
    ) {
      return createDotsSchemaProbeFailure('download-failed');
    }
    return { success: true, fileName: DOTS_SCHEMA_PROBE_FILE_NAME };
  } finally {
    if (markerUpdate && !markerUpdate.settled) {
      deferPendingMarkerCleanup(
        markerUpdate,
        resolved.chromeApi,
        tabId,
        nonce,
        markerUrl,
        resolved.now,
        resolved.sleep,
        resolved.operations
      );
    } else {
      if (markerUpdateAttempted && !cleanupAttempted) {
        await cleanupMarker(
          resolved.chromeApi,
          tabId,
          documentId,
          nonce,
          markerUrl,
          resolved.now,
          false
        ).catch(() => false);
      }
      resolved.operations.delete(tabId);
    }
  }
}

/** Runtime guard used at the worker boundary after every error mapping. */
export function isDotsSchemaProbeFailureCode(value: unknown): value is DotsSchemaProbeErrorCode {
  return (
    typeof value === 'string' &&
    (DOTS_SCHEMA_PROBE_ERROR_CODES as readonly string[]).includes(value)
  );
}
