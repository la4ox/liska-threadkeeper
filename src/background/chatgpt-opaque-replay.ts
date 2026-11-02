/**
 * Disposable-tab runtime for the experimental, marker-gated ChatGPT opaque
 * replay.  It reads only the nonce-scoped credential-free result produced in
 * MAIN world; this module has no service-worker registration or UI route.
 */

import { canonicalBase64ByteLength } from '../lib/base64';
import { CHATGPT_CAPTURE_ENDPOINT } from '../lib/chatgpt-capture-contract';
import {
  ARCHIVE_STAGE_CHUNK_BYTES,
  ARCHIVE_STAGE_RELATIVE_PATHS,
  isSafeArchiveStageId,
  type ArchiveStageDescriptor,
} from '../lib/archive-stage-contract';
import {
  abortArchiveStage,
  appendArchiveStage,
  beginArchiveStage,
  sealArchiveStage,
} from './archive-stage-handlers';
import {
  isChatGptCaptureTarget,
  isEquivalentChatGptCaptureTargetUrl,
  type ChatGptCaptureTarget,
} from './chatgpt-route-target';
import {
  createChatGptOpaqueReplayFailure,
  isChatGptOpaqueReplayHookResult,
  type ChatGptOpaqueReplayArtifact,
  type ChatGptOpaqueReplayHookResult,
  type ChatGptOpaqueReplayResponse,
} from '../lib/chatgpt-opaque-replay-contract';

export const CHATGPT_OPAQUE_REPLAY_TIMEOUT_MS = 190_000;

const CHATGPT_ORIGIN = 'https://chatgpt.com';
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 195_000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const CLEANUP_STEP_TIMEOUT_MS = 500;
const REPLAY_WIRE_PREFIX = 'liska-opaque-replay-wire:1:';
const REPLAY_METADATA_WIRE_MAX_CHARS = 4_096;
// Canonical base64 expansion plus bounded nonce/conversation/hash/media metadata.
const REPLAY_INLINE_WIRE_MAX_CHARS = 4 * Math.ceil((16 * 1024 * 1024) / 3) + 4_096;
const REPLAY_CHUNK_WIRE_MAX_CHARS = 4 * Math.ceil(ARCHIVE_STAGE_CHUNK_BYTES / 3) + 4_096;

interface ReplayScriptInjection {
  target: { tabId: number; documentIds?: string[] };
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
    executeScript: (
      injection: ReplayScriptInjection
    ) => Promise<Array<{ result?: unknown; frameId?: number; documentId?: string }>>;
  };
}

export type ChatGptOpaqueReplayTransportMode = 'legacy-inline' | 'staged-v2';

export interface ChatGptOpaqueReplayDependencies {
  chromeApi?: ReplayChromeApi;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  createNonce?: () => string;
  digestSha256?: (bytes: Uint8Array) => Promise<string>;
  /** Explicit route selector; callers that omit it retain the byte-for-byte legacy v1 path. */
  transportMode?: ChatGptOpaqueReplayTransportMode;
  archiveStage?: {
    begin: typeof beginArchiveStage;
    append: typeof appendArchiveStage;
    seal: typeof sealArchiveStage;
    abort: typeof abortArchiveStage;
  };
}

type HookState = ChatGptOpaqueReplayHookResult | { kind: 'missing' };
type Readiness = 'ready' | 'waiting' | 'unexpected-origin' | 'unexpected-path';
type PinnedDocument = { frameId: 0; documentId: string };
type HookRead = {
  state: HookState;
  wire?: string;
  document?: PinnedDocument;
  documentMismatch?: true;
};

function exactWireKeys(
  value: unknown,
  expected: readonly string[]
): value is Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every(key => keys.includes(key));
}

function parseReplayWire(value: unknown, variant: string, limit: number): unknown {
  const prefix = REPLAY_WIRE_PREFIX + variant + ':';
  if (typeof value !== 'string' || value.length > limit || !value.startsWith(prefix))
    return undefined;
  try {
    // Extension-realm only. No reviver, page objects, coercion or object transfer.
    return JSON.parse(value.slice(prefix.length)) as unknown;
  } catch {
    return undefined;
  }
}

/** Decode the internal primitive wire into the unchanged public hook contract. */
export function parseChatGptOpaqueReplayStateWire(
  value: unknown,
  nonce: string,
  mode: ChatGptOpaqueReplayTransportMode
): HookState {
  if (typeof value !== 'string' || value.length > REPLAY_INLINE_WIRE_MAX_CHARS)
    return { kind: 'missing' };
  for (const variant of ['ready', 'error', 'inline', 'staged']) {
    const envelope = parseReplayWire(
      value,
      variant,
      variant === 'inline' ? REPLAY_INLINE_WIRE_MAX_CHARS : REPLAY_METADATA_WIRE_MAX_CHARS
    );
    const keys =
      variant === 'ready'
        ? ['nonce', 'mode', 'kind']
        : variant === 'error'
          ? ['nonce', 'mode', 'kind', 'code', 'singularDispatchCount']
          : ['nonce', 'mode', 'kind', 'conversationId', 'capture', 'singularDispatchCount'];
    if (
      !exactWireKeys(envelope, keys) ||
      envelope.nonce !== nonce ||
      envelope.mode !== mode ||
      envelope.kind !== variant
    )
      continue;
    const candidate =
      variant === 'ready'
        ? { kind: 'ready' }
        : variant === 'error'
          ? {
              kind: 'error',
              code: envelope.code,
              singularDispatchCount: envelope.singularDispatchCount,
            }
          : {
              kind: 'captured',
              conversationId: envelope.conversationId,
              capture: envelope.capture,
              singularDispatchCount: envelope.singularDispatchCount,
            };
    if (!isChatGptOpaqueReplayHookResult(candidate)) return { kind: 'missing' };
    if (candidate.kind === 'captured') {
      const staged = 'transport' in candidate.capture;
      if (staged !== (variant === 'staged') || (staged && mode !== 'staged-v2'))
        return { kind: 'missing' };
      if (
        !('transport' in candidate.capture) &&
        canonicalReplayBase64ByteLength(candidate.capture.bodyBase64) === undefined
      )
        return { kind: 'missing' };
    }
    return candidate;
  }
  return { kind: 'missing' };
}

class ReplayDeadlineError extends Error {}

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

function marker(nonce: string, transportMode: ChatGptOpaqueReplayTransportMode): string {
  return `#liska-capture=${nonce}&liska-opaque-replay=${transportMode === 'staged-v2' ? '2' : '1'}`;
}

function targetUrl(
  target: ChatGptCaptureTarget,
  nonce: string,
  transportMode: ChatGptOpaqueReplayTransportMode
): string {
  return `${CHATGPT_ORIGIN}${target.pathname}${marker(nonce, transportMode)}`;
}

function remainingTimeout(deadline: number, now: () => number): number {
  return Math.max(1, deadline - now());
}

function withinDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ReplayDeadlineError('timed out')), timeoutMs);
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
    transportMode: overrides.transportMode ?? ('legacy-inline' as const),
    archiveStage: overrides.archiveStage ?? {
      begin: beginArchiveStage,
      append: appendArchiveStage,
      seal: sealArchiveStage,
      abort: abortArchiveStage,
    },
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
  target: ChatGptCaptureTarget,
  nonce: string,
  transportMode: ChatGptOpaqueReplayTransportMode,
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
          isEquivalentChatGptCaptureTargetUrl(tab.url, target, marker(nonce, transportMode))
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
  now: () => number,
  mode: ChatGptOpaqueReplayTransportMode,
  pinnedDocument?: PinnedDocument
): Promise<HookRead> {
  try {
    const execution = await withinDeadline(
      chromeApi.scripting.executeScript({
        target: {
          tabId,
          ...(pinnedDocument && { documentIds: [pinnedDocument.documentId] }),
        },
        world: 'MAIN',
        func: readChatGptOpaqueReplayState,
        args: [nonce],
      }),
      remainingTimeout(deadline, now)
    );
    const entry = execution.length === 1 ? execution[0] : undefined;
    if (pinnedDocument) {
      if (entry?.frameId !== 0 || entry.documentId !== pinnedDocument.documentId) {
        return { state: { kind: 'missing' }, documentMismatch: true };
      }
    }
    const document =
      entry?.frameId === 0 && typeof entry.documentId === 'string' && entry.documentId.length > 0
        ? { frameId: 0 as const, documentId: entry.documentId }
        : undefined;
    const result = entry?.result;
    return {
      state: parseChatGptOpaqueReplayStateWire(result, nonce, mode),
      ...(typeof result === 'string' && { wire: result }),
      ...(document && { document }),
    };
  } catch {
    return { state: { kind: 'missing' }, ...(pinnedDocument && { documentMismatch: true }) };
  }
}

function canonicalReplayBase64ByteLength(value: string): number | undefined {
  const length = canonicalBase64ByteLength(value);
  if (length === undefined) return undefined;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (value.endsWith('==') && alphabet.indexOf(value[value.length - 3]) % 16 !== 0)
    return undefined;
  if (
    !value.endsWith('==') &&
    value.endsWith('=') &&
    alphabet.indexOf(value[value.length - 2]) % 4 !== 0
  )
    return undefined;
  return length;
}

function strictBase64Bytes(value: string): Uint8Array | undefined {
  if (
    canonicalReplayBase64ByteLength(value) === undefined ||
    typeof globalThis.atob !== 'function'
  ) {
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
  target: ChatGptCaptureTarget,
  digestSha256: (bytes: Uint8Array) => Promise<string>
): Promise<ChatGptOpaqueReplayArtifact | undefined> {
  if ('transport' in result.capture) return undefined;
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
    routeFamily: target.routeFamily,
    bodyBase64: result.capture.bodyBase64,
    byteLength: result.capture.byteLength,
    sha256: result.capture.sha256.toLowerCase(),
    mediaType: result.capture.mediaType,
    endpoint: CHATGPT_CAPTURE_ENDPOINT,
    transientAssetResolvers: [],
  };
}

type StagedHookCapture = Extract<
  Extract<ChatGptOpaqueReplayHookResult, { kind: 'captured' }>['capture'],
  { transport: 'staged' }
>;

type ValidatedReplayChunk = { offset: number; byteLength: number; chunkBase64: string };

function validateReplayChunk(
  value: unknown,
  nonce: string,
  capture: StagedHookCapture,
  index: number
): ValidatedReplayChunk | undefined {
  const chunk = parseReplayWire(value, 'chunk', REPLAY_CHUNK_WIRE_MAX_CHARS);
  if (!exactWireKeys(chunk, ['kind', 'nonce', 'index', 'offset', 'byteLength', 'chunkBase64']))
    return undefined;
  const expectedOffset = index * ARCHIVE_STAGE_CHUNK_BYTES;
  const expectedLength = Math.min(ARCHIVE_STAGE_CHUNK_BYTES, capture.byteLength - expectedOffset);
  if (
    chunk.kind !== 'chunk' ||
    chunk.nonce !== nonce ||
    chunk.index !== index ||
    chunk.offset !== expectedOffset ||
    chunk.byteLength !== expectedLength ||
    typeof chunk.chunkBase64 !== 'string'
  ) {
    return undefined;
  }
  const bytes = strictBase64Bytes(chunk.chunkBase64);
  return bytes?.byteLength === expectedLength
    ? { offset: expectedOffset, byteLength: expectedLength, chunkBase64: chunk.chunkBase64 }
    : undefined;
}

async function readPinnedReplayChunk(
  resolved: ReturnType<typeof resolvedDependencies>,
  tabId: number,
  pinnedDocument: PinnedDocument,
  nonce: string,
  capture: StagedHookCapture,
  index: number,
  deadline: number
): Promise<ValidatedReplayChunk | undefined> {
  try {
    const execution = await withinDeadline(
      resolved.chromeApi.scripting.executeScript({
        target: { tabId, documentIds: [pinnedDocument.documentId] },
        world: 'MAIN',
        func: readChatGptOpaqueReplayChunkState,
        args: [nonce, index],
      }),
      remainingTimeout(deadline, resolved.now)
    );
    const entry = execution.length === 1 ? execution[0] : undefined;
    if (entry?.frameId !== 0 || entry.documentId !== pinnedDocument.documentId) return undefined;
    return validateReplayChunk(entry.result, nonce, capture, index);
  } catch {
    return undefined;
  }
}

async function releasePinnedReplayChunks(
  resolved: ReturnType<typeof resolvedDependencies>,
  tabId: number,
  pinnedDocument: PinnedDocument,
  nonce: string
): Promise<void> {
  try {
    await withinDeadline(
      resolved.chromeApi.scripting.executeScript({
        target: { tabId, documentIds: [pinnedDocument.documentId] },
        world: 'MAIN',
        func: releaseChatGptOpaqueReplayChunkState,
        args: [nonce],
      }),
      CLEANUP_STEP_TIMEOUT_MS
    );
  } catch {
    // Navigation or tab cleanup also destroys the nonce-scoped reader.
  }
}

async function abortOwnedReplayStage(
  resolved: ReturnType<typeof resolvedDependencies>,
  stageId: string
): Promise<boolean> {
  if (!isSafeArchiveStageId(stageId)) return false;
  let operation: Promise<boolean>;
  try {
    operation = Promise.resolve(resolved.archiveStage.abort(stageId)).catch(() => false);
  } catch {
    return false;
  }
  try {
    return await withinDeadline(operation, CLEANUP_STEP_TIMEOUT_MS);
  } catch {
    // The observed operation remains attached and may still finish cleanup.
    return false;
  }
}

async function stageReplayCapture(
  resolved: ReturnType<typeof resolvedDependencies>,
  tabId: number,
  pinnedDocument: PinnedDocument,
  nonce: string,
  target: ChatGptCaptureTarget,
  capture: StagedHookCapture,
  initialWire: string,
  deadline: number
): Promise<ChatGptOpaqueReplayArtifact | undefined> {
  const descriptor: ArchiveStageDescriptor & {
    kind: 'raw';
    relativePath: typeof ARCHIVE_STAGE_RELATIVE_PATHS.raw;
  } = {
    kind: 'raw',
    mediaType: 'application/json',
    relativePath: ARCHIVE_STAGE_RELATIVE_PATHS.raw,
    byteLength: capture.byteLength,
    sha256: capture.sha256,
  };
  let allocatedStageId: string | undefined;
  let stageId: string | undefined;
  let handedOff = false;
  let ownsBegin = true;
  let beginPromise: Promise<string | undefined> | undefined;
  try {
    beginPromise = Promise.resolve(
      resolved.archiveStage.begin(descriptor, id => {
        if (isSafeArchiveStageId(id)) allocatedStageId = id;
      })
    );
    void beginPromise.then(
      lateStageId => {
        if (!ownsBegin && isSafeArchiveStageId(lateStageId)) {
          void abortOwnedReplayStage(resolved, lateStageId);
        }
      },
      () => undefined
    );
    stageId = await withinDeadline(beginPromise, remainingTimeout(deadline, resolved.now));
    if (!isSafeArchiveStageId(stageId)) return undefined;
    if (allocatedStageId !== undefined && allocatedStageId !== stageId) return undefined;
    allocatedStageId = stageId;

    for (let index = 0; index < capture.chunkCount; index += 1) {
      const readiness = await waitForTemporaryTarget(
        resolved.chromeApi,
        tabId,
        target,
        nonce,
        resolved.transportMode,
        deadline,
        resolved.now,
        resolved.sleep,
        resolved.pollIntervalMs
      );
      if (readiness !== 'ready') return undefined;
      const chunk = await readPinnedReplayChunk(
        resolved,
        tabId,
        pinnedDocument,
        nonce,
        capture,
        index,
        deadline
      );
      if (!chunk) return undefined;
      let outerAppendTimedOut = false;
      const appendPromise = Promise.resolve(
        resolved.archiveStage.append(stageId, chunk.offset, chunk.chunkBase64)
      );
      const abortAfterOuterTimeout = (): void => {
        if (outerAppendTimedOut) {
          void abortOwnedReplayStage(resolved, stageId!);
        }
      };
      void appendPromise.then(abortAfterOuterTimeout, abortAfterOuterTimeout);
      let appended: boolean;
      try {
        appended = await withinDeadline(appendPromise, remainingTimeout(deadline, resolved.now));
      } catch (error) {
        if (error instanceof ReplayDeadlineError) outerAppendTimedOut = true;
        throw error;
      }
      if (!appended) return undefined;
    }
    const sealPromise = Promise.resolve(resolved.archiveStage.seal(stageId, descriptor));
    void sealPromise.then(
      () => {
        if (!ownsBegin && !handedOff) {
          void abortOwnedReplayStage(resolved, stageId!);
        }
      },
      () => undefined
    );
    const sealed = await withinDeadline(sealPromise, remainingTimeout(deadline, resolved.now));
    if (!sealed) return undefined;
    const finalReadiness = await waitForTemporaryTarget(
      resolved.chromeApi,
      tabId,
      target,
      nonce,
      resolved.transportMode,
      deadline,
      resolved.now,
      resolved.sleep,
      resolved.pollIntervalMs
    );
    if (finalReadiness !== 'ready') return undefined;
    const postSeal = await readHookState(
      resolved.chromeApi,
      tabId,
      nonce,
      deadline,
      resolved.now,
      resolved.transportMode,
      pinnedDocument
    );
    if (
      postSeal.documentMismatch ||
      postSeal.wire !== initialWire ||
      postSeal.document?.documentId !== pinnedDocument.documentId ||
      postSeal.state.kind !== 'captured' ||
      postSeal.state.conversationId !== target.conversationId ||
      postSeal.state.singularDispatchCount !== 1 ||
      !('transport' in postSeal.state.capture) ||
      postSeal.state.capture.transportVersion !== capture.transportVersion ||
      postSeal.state.capture.transport !== capture.transport ||
      postSeal.state.capture.byteLength !== capture.byteLength ||
      postSeal.state.capture.sha256 !== capture.sha256 ||
      postSeal.state.capture.mediaType !== capture.mediaType ||
      postSeal.state.capture.chunkCount !== capture.chunkCount
    ) {
      return undefined;
    }
    handedOff = true;
    return {
      transport: 'staged',
      routeFamily: target.routeFamily,
      stageId,
      ...descriptor,
      endpoint: CHATGPT_CAPTURE_ENDPOINT,
      transientAssetResolvers: [],
    };
  } catch (error) {
    if (error instanceof ReplayDeadlineError) throw error;
    return undefined;
  } finally {
    ownsBegin = false;
    await releasePinnedReplayChunks(resolved, tabId, pinnedDocument, nonce);
    const ownedIds = new Set([allocatedStageId, stageId].filter(isSafeArchiveStageId));
    if (!handedOff) {
      for (const ownedId of ownedIds) {
        await abortOwnedReplayStage(resolved, ownedId);
      }
    }
  }
}

async function verifiedReplayResponse(
  resolved: ReturnType<typeof resolvedDependencies>,
  tabId: number,
  nonce: string,
  target: ChatGptCaptureTarget,
  state: Extract<ChatGptOpaqueReplayHookResult, { kind: 'captured' }>,
  deadline: number,
  terminalWire: string,
  pinnedDocument?: PinnedDocument
): Promise<ChatGptOpaqueReplayResponse> {
  if (state.conversationId !== target.conversationId || state.singularDispatchCount !== 1) {
    if ('transport' in state.capture && pinnedDocument) {
      await releasePinnedReplayChunks(resolved, tabId, pinnedDocument, nonce);
    }
    return createChatGptOpaqueReplayFailure('replay-result-invalid', 1);
  }
  let artifact: ChatGptOpaqueReplayArtifact | undefined;
  try {
    artifact =
      'transport' in state.capture
        ? resolved.transportMode === 'staged-v2' && pinnedDocument
          ? await stageReplayCapture(
              resolved,
              tabId,
              pinnedDocument,
              nonce,
              target,
              state.capture,
              terminalWire,
              deadline
            )
          : undefined
        : await withinDeadline(
            artifactFromHookResult(state, target, resolved.digestSha256),
            remainingTimeout(deadline, resolved.now)
          );
  } catch {
    return createChatGptOpaqueReplayFailure('replay-result-timeout', 1);
  }
  const readiness = await waitForTemporaryTarget(
    resolved.chromeApi,
    tabId,
    target,
    nonce,
    resolved.transportMode,
    deadline,
    resolved.now,
    resolved.sleep,
    resolved.pollIntervalMs
  );
  if (readiness !== 'ready') {
    if (artifact && 'transport' in artifact && artifact.transport === 'staged') {
      await abortOwnedReplayStage(resolved, artifact.stageId);
    }
    return createChatGptOpaqueReplayFailure(
      readiness === 'waiting' ? 'temporary-tab-ready-timeout' : readiness,
      1
    );
  }
  return artifact === undefined
    ? createChatGptOpaqueReplayFailure('replay-result-invalid', 1)
    : { success: true, data: artifact };
}

async function waitForReplayResult(
  resolved: ReturnType<typeof resolvedDependencies>,
  tabId: number,
  nonce: string,
  target: ChatGptCaptureTarget,
  deadline: number
): Promise<ChatGptOpaqueReplayResponse> {
  let pinnedDocument: PinnedDocument | undefined;
  while (resolved.now() <= deadline) {
    const readiness = await waitForTemporaryTarget(
      resolved.chromeApi,
      tabId,
      target,
      nonce,
      resolved.transportMode,
      deadline,
      resolved.now,
      resolved.sleep,
      resolved.pollIntervalMs
    );
    if (readiness !== 'ready')
      return createChatGptOpaqueReplayFailure(
        readiness === 'waiting' ? 'temporary-tab-ready-timeout' : readiness
      );
    const read = await readHookState(
      resolved.chromeApi,
      tabId,
      nonce,
      deadline,
      resolved.now,
      resolved.transportMode,
      pinnedDocument
    );
    if (read.documentMismatch) {
      return createChatGptOpaqueReplayFailure('replay-result-invalid');
    }
    if (resolved.transportMode === 'staged-v2' && read.document) {
      if (pinnedDocument && pinnedDocument.documentId !== read.document.documentId) {
        return createChatGptOpaqueReplayFailure('replay-result-invalid');
      }
      pinnedDocument = read.document;
    }
    const state = read.state;
    if (state.kind === 'error') {
      return createChatGptOpaqueReplayFailure(state.code, state.singularDispatchCount);
    }
    if (state.kind === 'captured') {
      return verifiedReplayResponse(
        resolved,
        tabId,
        nonce,
        target,
        state,
        deadline,
        read.wire!,
        pinnedDocument
      );
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
  // No terminal page result was observed. The fallback count of 0 cannot prove
  // that the page never dispatched, so this deadline never authorizes a retry.
  return createChatGptOpaqueReplayFailure('replay-result-timeout');
}

/**
 * Run the isolated opaque replay core. The explicit runtime route opts in to
 * staged-v2; other callers retain the legacy-inline default.
 */
// eslint-disable-next-line max-lines-per-function -- Lifecycle cleanup stays linear so each deadline exit has one bounded, auditable path.
export async function captureChatGptConversationViaOpaqueReplay(
  target: ChatGptCaptureTarget,
  overrides: ChatGptOpaqueReplayDependencies = {}
): Promise<ChatGptOpaqueReplayResponse> {
  if (!isChatGptCaptureTarget(target)) {
    return createChatGptOpaqueReplayFailure('invalid-conversation-id');
  }
  const immutableTarget = Object.freeze({
    conversationId: target.conversationId,
    pathname: target.pathname,
    routeFamily: target.routeFamily,
  });
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
        resolved.chromeApi.tabs.create({
          url: targetUrl(immutableTarget, nonce, resolved.transportMode),
          active: false,
        })
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
      immutableTarget,
      nonce,
      resolved.transportMode,
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
    return await waitForReplayResult(resolved, tabId, nonce, immutableTarget, deadline);
  } catch {
    return createChatGptOpaqueReplayFailure('replay-result-invalid');
  } finally {
    cleanLateCreatedTab = true;
    await removeTemporaryTab(resolved.chromeApi, tabId);
  }
}

/**
 * Synchronous serialized MAIN thunks. No page-realm validation/copying: even a
 * fresh object is unsafe because Chromium Promise-assimilates script returns
 * (including inherited thenables). Only the early immutable hook emits wire.
 */
export function readChatGptOpaqueReplayState(nonce: string): string {
  try {
    const wire = (window as unknown as Record<string, unknown>)[
      `__liskaChatGptOpaqueReplay_${nonce}`
    ];
    return typeof wire === 'string' ? wire : 'liska-opaque-replay-wire:missing';
  } catch {
    return 'liska-opaque-replay-wire:missing';
  }
}

/** Direct-call the early nonwritable reader; return only a primitive string. */
export function readChatGptOpaqueReplayChunkState(nonce: string, index: number): string {
  try {
    const reader = (window as unknown as Record<string, unknown>)[
      `__liskaChatGptOpaqueReplayChunkReader_${nonce}`
    ];
    if (typeof reader !== 'function') return 'liska-opaque-replay-wire:missing';
    const wire = reader(index);
    return typeof wire === 'string' ? wire : 'liska-opaque-replay-wire:missing';
  } catch {
    return 'liska-opaque-replay-wire:missing';
  }
}

/** Serialized one-way release; primitive boolean cannot be Promise-assimilated. */
export function releaseChatGptOpaqueReplayChunkState(nonce: string): boolean {
  try {
    const release = (window as unknown as Record<string, unknown>)[
      `__liskaChatGptOpaqueReplayChunkRelease_${nonce}`
    ];
    return typeof release === 'function' && release() === true;
  } catch {
    return false;
  }
}
