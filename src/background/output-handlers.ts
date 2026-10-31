/* eslint-disable max-lines -- Durable and Markdown outputs share one offscreen lease/Downloads lifecycle; splitting it would hide ownership transfers. */
/**
 * Output handlers for background service worker
 *
 * Handles file download, clipboard copy, and multi-output orchestration
 */

import { extractErrorMessage } from '../lib/error-utils';
import { generateNoteContent } from '../lib/note-generator';
import { handleSave, handleSaveArchiveCompanion } from './obsidian-handlers';
import { resolveImagesForFile, stripImagePlaceholders } from '../lib/image-output';
import { MAX_CONTENT_SIZE } from '../lib/constants';
import { CHATGPT_INLINE_CAPTURE_MAX_BYTES } from '../lib/chatgpt-capture-contract';
import { canonicalBase64ByteLength } from '../lib/base64';
import {
  durableWriteOutcomeFromResult,
  withDurableWriteOutcome,
} from '../lib/operation-write-ledger';
import { sha256Hex } from '../lib/sha256';
import { bytesToBase64 } from '../lib/image-utils';
import {
  buildDerivedOutputReceipt,
  buildDerivedOutputReceiptBytes,
  DERIVED_HTML_RECEIPT_RELATIVE_PATH,
  verifyDerivedHtmlArtifact,
  type DerivedHtmlArtifact,
  type DerivedOutputIdentity,
} from '../lib/derived-presentation-contract';
import {
  buildDerivedBranchOutputReceipt,
  buildDerivedBranchOutputReceiptBytes,
  deriveBranchHtmlReceiptRelativePath,
  matchDerivedBranchOutputReceipt,
  verifyDerivedBranchHtmlArtifact,
  type DerivedBranchHtmlArtifact,
} from '../lib/derived-branch-presentation-contract';
import {
  buildDerivedBranchHtmlPersistResponse,
  type DerivedBranchHtmlPersistResponse,
} from '../lib/derived-branch-persistence-contract';
import type {
  ArchiveBlobCreateResponse,
  ArchiveCompanionArtifact,
  ExtensionMessage,
  ExtensionSettings,
  ObsidianNote,
  OffscreenArchiveBlobRevokeMessage,
  OutputDestination,
  OutputResult,
  DurableWriteState,
  DurableWriteOutcome,
  MultiOutputResponse,
  OffscreenClipboardMessage,
  StructuredArchiveSource,
} from '../lib/types';

/** Note filename without its `.md` extension — the base for image filenames. */
function noteBaseName(fileName: string): string {
  return fileName.replace(/\.md$/i, '');
}

/** Runtime type guard for offscreen clipboard response */
function isClipboardWriteResponse(value: unknown): value is { success: boolean; error?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    typeof (value as Record<string, unknown>).success === 'boolean'
  );
}

/** Offscreen document close timeout (milliseconds) */
const OFFSCREEN_TIMEOUT_MS = 5000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    // Promise executors run synchronously, so the timer is always assigned
    // before Promise.race starts waiting.
    clearTimeout(timer);
  }
}

/** Timer for closing the idle offscreen document after its final lease releases. */
let offscreenCloseTimer: ReturnType<typeof setTimeout> | null = null;
let offscreenLeaseCount = 0;

function cancelScheduledOffscreenClose(): void {
  if (offscreenCloseTimer) {
    clearTimeout(offscreenCloseTimer);
    offscreenCloseTimer = null;
  }
}

/**
 * Schedule close only after every active owner releases its lease.
 */
function scheduleOffscreenClose(): void {
  if (offscreenLeaseCount > 0) return;
  cancelScheduledOffscreenClose();

  offscreenCloseTimer = setTimeout(async () => {
    if (offscreenLeaseCount > 0) {
      offscreenCloseTimer = null;
      return;
    }
    try {
      await chrome.offscreen.closeDocument();
    } catch (error) {
      // Already closed or doesn't exist - safe to ignore
      console.debug('[G2O Background] Offscreen close skipped:', extractErrorMessage(error));
    }
    offscreenCloseTimer = null;
  }, OFFSCREEN_TIMEOUT_MS);
}

/** Singleton promise to prevent concurrent offscreen document creation */
let offscreenCreationPromise: Promise<void> | null = null;

/** @internal Reset module-owned timer/lease state between isolated unit tests. */
export function resetOffscreenStateForTesting(): void {
  cancelScheduledOffscreenClose();
  offscreenLeaseCount = 0;
  offscreenCreationPromise = null;
}

/**
 * Ensure one offscreen document exists for clipboard and private Blob work.
 * Uses a singleton promise to prevent race conditions when
 * multiple clipboard operations are triggered concurrently.
 */
async function ensureOffscreenDocument(): Promise<void> {
  if (offscreenCreationPromise) {
    return offscreenCreationPromise;
  }

  offscreenCreationPromise = (async () => {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });

    if (existingContexts.length > 0) {
      return;
    }

    await chrome.offscreen.createDocument({
      url: 'src/offscreen/offscreen.html',
      reasons: [chrome.offscreen.Reason.CLIPBOARD, chrome.offscreen.Reason.BLOBS],
      justification: 'Copy Markdown and create private Blob URLs for archive downloads',
    });
  })();

  try {
    await offscreenCreationPromise;
  } finally {
    offscreenCreationPromise = null;
  }
}

export interface OffscreenLease {
  release(): void;
}

/** Acquire a shared offscreen document lease for one clipboard or Blob operation. */
async function acquireOffscreenLease(): Promise<OffscreenLease> {
  cancelScheduledOffscreenClose();
  await ensureOffscreenDocument();
  offscreenLeaseCount += 1;
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      offscreenLeaseCount = Math.max(0, offscreenLeaseCount - 1);
      if (offscreenLeaseCount === 0) scheduleOffscreenClose();
    },
  };
}

/**
 * Keep the existing offscreen lifecycle authoritative for staged binary
 * assets too. The caller transfers this lease to a late Downloads observer
 * when necessary, then releases it only after the exact stage is cleaned.
 */
export async function acquireOffscreenLeaseForStagedBinaryAsset(): Promise<OffscreenLease> {
  return acquireOffscreenLease();
}

/** Share the same authoritative offscreen lifecycle with raw/canonical stages. */
export async function acquireOffscreenLeaseForArchiveStage(): Promise<OffscreenLease> {
  return acquireOffscreenLease();
}

/**
 * Save to Obsidian and return OutputResult with optional messagesAppended
 */
async function handleSaveToObsidian(
  note: ObsidianNote,
  settings: ExtensionSettings,
  capturedAt?: string
): Promise<OutputResult> {
  try {
    const result = await handleSave(settings, note, capturedAt);
    return {
      destination: 'obsidian',
      success: result.success,
      error: result.error,
      messagesAppended: result.messagesAppended,
      savedAs: result.savedAs,
      warning: result.warning,
    };
  } catch (error) {
    return {
      destination: 'obsidian',
      success: false,
      error: extractErrorMessage(error),
    };
  }
}

/** Chunk size for base64 conversion — bounds String.fromCharCode argument count. */
const BASE64_CHUNK_SIZE = 8192;

/**
 * Convert string to base64 with proper Unicode handling
 * Service Worker doesn't support Blob/URL.createObjectURL.
 * Converts in chunks: per-byte concatenation is quadratic on MB-sized notes,
 * while a single spread of the whole array would overflow the call stack.
 */
function stringToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_SIZE)));
  }
  return btoa(parts.join(''));
}

/**
 * Download a data URL as a file. Resolves with an error message on failure,
 * or null on success.
 */
function downloadDataUrl(url: string, filename: string): Promise<string | null> {
  return new Promise(resolve => {
    chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' }, id => {
      if (chrome.runtime.lastError) {
        resolve(chrome.runtime.lastError.message ?? 'Download failed');
      } else if (id === undefined) {
        resolve('Download failed');
      } else {
        resolve(null);
      }
    });
  });
}

const ARCHIVE_DOWNLOAD_TIMEOUT_MS = 30_000;
const DOWNLOAD_SEARCH_TIMEOUT_MS = 5_000;

function decodeCanonicalBase64(value: string): Uint8Array | undefined {
  const expectedLength = canonicalBase64ByteLength(value);
  if (expectedLength === undefined) return undefined;
  try {
    const binary = atob(value);
    if (binary.length !== expectedLength || btoa(binary) !== value) return undefined;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return undefined;
  }
}

/** Verify the independently validated envelope immediately before persistence. */
async function verifyArchiveCompanion(
  artifact: ArchiveCompanionArtifact,
  source: StructuredArchiveSource
): Promise<Uint8Array | null> {
  if (artifact.transport !== 'inline') return null;
  const bytes = decodeCanonicalBase64(artifact.bodyBase64);
  const maxBytes =
    artifact.kind === 'raw' && (source === 'chatgpt' || source === 'claude')
      ? CHATGPT_INLINE_CAPTURE_MAX_BYTES
      : MAX_CONTENT_SIZE;
  if (!bytes || bytes.byteLength !== artifact.byteLength || bytes.byteLength > maxBytes)
    return null;
  try {
    return (await sha256Hex(bytes)) === artifact.sha256 ? bytes : null;
  } catch {
    return null;
  }
}

function isArchiveBlobCreateResponse(value: unknown): value is ArchiveBlobCreateResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { success?: unknown }).success === 'boolean' &&
    ((value as { success?: unknown }).success === false ||
      (typeof (value as { url?: unknown }).url === 'string' &&
        (value as { url: string }).url.startsWith('blob:')))
  );
}

async function revokeArchiveBlobUrl(url: string, onDeferred?: () => void): Promise<void> {
  const message: OffscreenArchiveBlobRevokeMessage = {
    action: 'archiveBlobRevoke',
    target: 'offscreen',
    url,
  };
  try {
    const response: unknown = await withTimeout(
      chrome.runtime.sendMessage(message),
      OFFSCREEN_TIMEOUT_MS,
      'Archive Blob release timed out'
    );
    if (
      !response ||
      typeof response !== 'object' ||
      (response as { success?: unknown }).success !== true
    )
      onDeferred?.();
  } catch {
    onDeferred?.();
    // The document will also be closed shortly; never expose Blob URLs in logs.
  }
}

/**
 * Send a Blob creation request after the caller has acquired the offscreen
 * document. If the timeout wins, the late response remains observable so an
 * extension-owned URL is never orphaned.
 */
interface ArchiveBlobCreateOutcome {
  url: string | null;
  /** Settles after a creation response that arrived too late for the caller. */
  lateCleanup?: Promise<void>;
}

async function createArchiveBlobUrl(
  artifact: InlineDownloadArtifact
): Promise<ArchiveBlobCreateOutcome> {
  if (artifact.transport !== 'inline') return { url: null };
  const createResponse = chrome.runtime.sendMessage({
    action: 'archiveBlobCreate',
    target: 'offscreen',
    bodyBase64: artifact.bodyBase64,
    mediaType: artifact.mediaType,
  });

  try {
    const response: unknown = await withTimeout(
      createResponse,
      OFFSCREEN_TIMEOUT_MS,
      'Archive Blob creation timed out'
    );
    return {
      url: isArchiveBlobCreateResponse(response) && response.success ? response.url : null,
    };
  } catch {
    // The sender can time out while the offscreen document has already made a
    // URL. Keep the lease until the original response can revoke only a URL
    // owned by this document.
    const lateCleanup = createResponse.then(
      async response => {
        if (isArchiveBlobCreateResponse(response) && response.success) {
          await revokeArchiveBlobUrl(response.url);
        }
      },
      () => undefined
    );
    return { url: null, lateCleanup };
  }
}

/** Wait for Downloads to report a terminal state before releasing the Blob URL. */
export interface ArchiveDownloadOutcome {
  error: string | null;
  /** Blob may be released only after Downloads has reached a terminal state. */
  terminal: boolean;
  /** Present only after Chrome assigned a Downloads item to this Blob URL. */
  downloadId?: number;
}

function archiveDownloadPathMatches(filename: unknown, expectedRelativePath: string): boolean {
  if (typeof filename !== 'string') return false;
  const normalized = filename.replace(/\\/g, '/');
  return normalized.endsWith(`/${expectedRelativePath}`);
}

type ArchiveDownloadPathStatus = 'confirmed' | 'mismatch' | 'unconfirmed';

/** A completed download is owned only when Chrome retained the exact requested archive path. */
export function confirmArchiveDownloadPath(
  outcome: ArchiveDownloadOutcome,
  expectedRelativePath: string
): Promise<boolean>;
export function confirmArchiveDownloadPath(
  outcome: ArchiveDownloadOutcome,
  expectedRelativePath: string,
  detailed: true
): Promise<ArchiveDownloadPathStatus>;
export async function confirmArchiveDownloadPath(
  outcome: ArchiveDownloadOutcome,
  expectedRelativePath: string,
  detailed?: true
): Promise<boolean | ArchiveDownloadPathStatus> {
  let status: ArchiveDownloadPathStatus = 'unconfirmed';
  if (outcome.terminal && outcome.error === null && outcome.downloadId !== undefined) {
    try {
      const downloads = await withTimeout(
        chrome.downloads.search({ id: outcome.downloadId }),
        DOWNLOAD_SEARCH_TIMEOUT_MS,
        'Download path lookup timed out'
      );
      const item = downloads.find(download => download.id === outcome.downloadId);
      if (typeof item?.filename === 'string') {
        status = archiveDownloadPathMatches(item.filename, expectedRelativePath)
          ? 'confirmed'
          : 'mismatch';
      }
    } catch {
      // Terminal ownership is known, but filename ownership is not.
    }
  }
  return detailed ? status : status === 'confirmed';
}

function isTerminalDownloadState(state: string | undefined): state is 'complete' | 'interrupted' {
  return state === 'complete' || state === 'interrupted';
}

function terminalDownloadOutcome(
  state: 'complete' | 'interrupted',
  downloadId: number
): ArchiveDownloadOutcome {
  return state === 'complete'
    ? { error: null, terminal: true, downloadId }
    : { error: 'Archive download was interrupted', terminal: true, downloadId };
}

async function inspectArchiveDownload(
  downloadId: number
): Promise<chrome.downloads.DownloadState | undefined> {
  try {
    const downloads = await withTimeout(
      chrome.downloads.search({ id: downloadId }),
      DOWNLOAD_SEARCH_TIMEOUT_MS,
      'Download state lookup timed out'
    );
    return downloads.find(download => download.id === downloadId)?.state;
  } catch {
    return undefined;
  }
}

/**
 * Wait through callback/event races. If the caller times out before a
 * terminal state, its observer intentionally stays live and invokes
 * `onLateTerminal` once Downloads eventually resolves the private Blob.
 */
/* eslint-disable max-lines-per-function -- callback, event, and timeout state share one lifecycle. */
export function downloadArchiveBlob(
  url: string,
  filename: string,
  onLateTerminal: () => Promise<void>,
  onDownloadId?: (downloadId: number) => Promise<void>
): Promise<ArchiveDownloadOutcome> {
  return new Promise(resolve => {
    let downloadId: number | undefined;
    let downloadIdContinuation: Promise<void> | undefined;
    let callerSettled = false;
    let terminal = false;
    let retainObserver = false;
    const pendingTerminalDeltas: Array<{
      id: number;
      state: 'complete' | 'interrupted';
    }> = [];
    let cancellationTimer: ReturnType<typeof setTimeout> | null = null;
    const removeObserver = (): void => chrome.downloads.onChanged.removeListener(onChanged);
    const settleCaller = (outcome: ArchiveDownloadOutcome, keepObserver = false): void => {
      if (callerSettled) return;
      callerSettled = true;
      retainObserver = keepObserver;
      clearTimeout(timer);
      if (cancellationTimer) clearTimeout(cancellationTimer);
      if (!keepObserver) removeObserver();
      resolve(outcome);
    };
    const finishTerminal = async (outcome: ArchiveDownloadOutcome): Promise<void> => {
      if (terminal) return;
      terminal = true;
      clearTimeout(timer);
      if (cancellationTimer) clearTimeout(cancellationTimer);
      removeObserver();
      if (callerSettled) {
        if (retainObserver) await onLateTerminal();
        return;
      }
      callerSettled = true;
      resolve(outcome);
    };
    const waitForDownloadIdContinuation = async (): Promise<void> => {
      await downloadIdContinuation;
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta): void => {
      const state = delta.state?.current;
      if (!isTerminalDownloadState(state)) return;
      if (downloadId === undefined) {
        pendingTerminalDeltas.push({ id: delta.id, state });
        return;
      }
      if (delta.id === downloadId) {
        void (async () => {
          await waitForDownloadIdContinuation();
          await finishTerminal(terminalDownloadOutcome(state, delta.id));
        })();
      }
    };

    const reconcileDownloadState = async (waitForOwnership = true): Promise<void> => {
      if (downloadId === undefined || terminal) return;
      if (waitForOwnership) await waitForDownloadIdContinuation();
      if (downloadId === undefined || terminal) return;
      // Always query after callback assignment: onChanged can race the
      // callback, while search gives Downloads' authoritative current state.
      const statePromise = inspectArchiveDownload(downloadId);
      const pending = pendingTerminalDeltas.find(delta => delta.id === downloadId);
      if (pending) {
        void statePromise;
        await finishTerminal(terminalDownloadOutcome(pending.state, downloadId));
        return;
      }
      const state = await statePromise;
      if (isTerminalDownloadState(state))
        await finishTerminal(terminalDownloadOutcome(state, downloadId));
    };

    const returnUnconfirmedFailure = (error: string): void => {
      settleCaller(
        { error, terminal: false, ...(downloadId !== undefined && { downloadId }) },
        true
      );
    };
    const cancelAndConfirm = async (): Promise<void> => {
      if (terminal || callerSettled) return;
      if (downloadId === undefined) {
        // A late callback can still name this download; leave listener and
        // lease ownership intact until it reconciles a terminal state.
        returnUnconfirmedFailure('Archive download did not complete');
        return;
      }
      await waitForDownloadIdContinuation();
      if (downloadId === undefined || terminal || callerSettled) return;
      const state = await inspectArchiveDownload(downloadId);
      if (isTerminalDownloadState(state)) {
        await finishTerminal(terminalDownloadOutcome(state, downloadId));
        return;
      }
      if (state !== 'in_progress') {
        returnUnconfirmedFailure('Archive download did not complete');
        return;
      }

      // Start the confirmation deadline before awaiting Chrome. Besides making
      // the bound cover a slow `cancel()` call, this keeps timer scheduling
      // deterministic when the service worker is under heavy test/runtime
      // load and the promise continuation is delayed.
      cancellationTimer = setTimeout(() => {
        void (async () => {
          await reconcileDownloadState();
          if (!terminal)
            returnUnconfirmedFailure('Archive download cancellation was not confirmed');
        })();
      }, OFFSCREEN_TIMEOUT_MS);

      try {
        await chrome.downloads.cancel(downloadId);
      } catch {
        // A terminal event or follow-up search can still establish ownership.
      }
      await reconcileDownloadState();
    };

    chrome.downloads.onChanged.addListener(onChanged);
    const timer = setTimeout(() => void cancelAndConfirm(), ARCHIVE_DOWNLOAD_TIMEOUT_MS);
    chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' }, id => {
      if (chrome.runtime.lastError || id === undefined) {
        const outcome = { error: 'Archive download could not be started', terminal: true };
        if (callerSettled) {
          void finishTerminal(outcome);
        } else {
          settleCaller(outcome);
        }
      } else {
        downloadId = id;
        downloadIdContinuation = (async () => {
          try {
            await onDownloadId?.(id);
          } catch {
            // Ownership persistence reports its own bounded failure to the caller.
          }
          await reconcileDownloadState(false);
        })();
        void downloadIdContinuation;
      }
    });
  });
}
/* eslint-enable max-lines-per-function */

interface InlineDownloadArtifact {
  transport: 'inline';
  bodyBase64: string;
  mediaType: 'application/json' | 'text/html';
}

function archiveCompanionDownloadPath(
  message: Extract<ExtensionMessage, { action: 'persistArchiveCompanion' }>
): string {
  return [
    '_liska-archive',
    message.conversationKey,
    message.captureId,
    ...message.artifact.relativePath.split('/'),
  ].join('/');
}

// eslint-disable-next-line max-lines-per-function -- Blob lease transfer, the terminal sink observation, and cleanup reporting must retain one ownership lifecycle.
async function handleVerifiedInlineDownload(
  artifact: InlineDownloadArtifact,
  expectedPath: string,
  reportDurableWriteOutcome: boolean | undefined
): Promise<OutputResult> {
  let blobUrl: string | null = null;
  let lease: OffscreenLease | undefined;
  let leaseTransferred = false;
  let state: DurableWriteState = 'not-dispatched';
  let cleanupDeferred = false;
  let result: OutputResult = {
    destination: 'file',
    success: false,
    error: 'Archive download setup failed',
  };
  try {
    lease = await acquireOffscreenLease();
    const blobCreate = await createArchiveBlobUrl(artifact);
    blobUrl = blobCreate.url;
    if (!blobUrl) {
      if (blobCreate.lateCleanup) {
        leaseTransferred = true;
        void blobCreate.lateCleanup.finally(() => lease?.release());
      }
    } else {
      state = 'unknown';
      const outcome = await downloadArchiveBlob(blobUrl, expectedPath, async () => {
        try {
          await revokeArchiveBlobUrl(blobUrl!);
        } finally {
          lease?.release();
        }
      });
      if (!outcome.terminal) leaseTransferred = true;
      if (outcome.error === 'Archive download could not be started') state = 'not-dispatched';
      if (outcome.error) result = { destination: 'file', success: false, error: outcome.error };
      else if (await confirmArchiveDownloadPath(outcome, expectedPath)) {
        state = 'confirmed';
        result = { destination: 'file', success: true };
      } else
        result = {
          destination: 'file',
          success: false,
          error: 'archive-download-path-unconfirmed',
        };
    }
  } catch {
    // The pre-cleanup observation survives cleanup/bookkeeping failures.
  } finally {
    if (!leaseTransferred) {
      try {
        if (blobUrl)
          await revokeArchiveBlobUrl(blobUrl, () => {
            cleanupDeferred = true;
          });
      } catch {
        cleanupDeferred = true;
      }
      try {
        lease?.release();
      } catch {
        cleanupDeferred = true;
      }
    }
  }
  return withDurableWriteOutcome(
    { ...result, ...(cleanupDeferred && { warning: 'archive-stage-cleanup-deferred' }) },
    state,
    reportDurableWriteOutcome,
    cleanupDeferred
  );
}

async function handleArchiveDownload(
  message: Extract<ExtensionMessage, { action: 'persistArchiveCompanion' }>
): Promise<OutputResult> {
  if (message.artifact.transport !== 'inline')
    return withDurableWriteOutcome(
      { destination: 'file', success: false, error: 'Archive download setup failed' },
      'not-dispatched',
      message.reportDurableWriteOutcome
    );
  return handleVerifiedInlineDownload(
    message.artifact,
    archiveCompanionDownloadPath(message),
    message.reportDurableWriteOutcome
  );
}

function derivedHtmlResponse(result: OutputResult): MultiOutputResponse {
  return { results: [result], allSuccessful: result.success, anySuccessful: result.success };
}

function derivedHtmlFailure(error: string): MultiOutputResponse {
  return derivedHtmlResponse(
    withDurableWriteOutcome({ destination: 'file', success: false, error }, 'not-dispatched', true)
  );
}

async function persistDerivedHtmlReceipt(
  message: Extract<ExtensionMessage, { action: 'persistDerivedHtmlPresentation' }>,
  artifact: DerivedHtmlArtifact,
  prefix: string
): Promise<OutputResult> {
  try {
    const bytes = buildDerivedOutputReceiptBytes(
      buildDerivedOutputReceipt(
        {
          source: message.source,
          captureId: message.captureId,
          conversationKey: message.conversationKey,
        },
        artifact
      )
    );
    const bodyBase64 = bytesToBase64(bytes);
    const sha256 = await sha256Hex(bytes);
    const decoded = decodeCanonicalBase64(bodyBase64);
    if (
      !decoded ||
      decoded.byteLength !== bytes.byteLength ||
      (await sha256Hex(decoded)) !== sha256
    )
      throw new Error();
    return await handleVerifiedInlineDownload(
      { transport: 'inline', bodyBase64, mediaType: 'application/json' },
      `${prefix}${DERIVED_HTML_RECEIPT_RELATIVE_PATH}`,
      true
    );
  } catch {
    return { destination: 'file', success: false };
  }
}

/** Only a verified HTML write can authorize the deterministic local receipt. */
export async function handlePersistDerivedHtmlPresentation(
  message: Extract<ExtensionMessage, { action: 'persistDerivedHtmlPresentation' }>
): Promise<MultiOutputResponse> {
  const verified = await verifyDerivedHtmlArtifact(message.artifact, sha256Hex);
  if (!verified) return derivedHtmlFailure('derived-html-integrity-verification-failed');
  const prefix = `_liska-archive/${message.conversationKey}/${message.captureId}/`;
  const html = await handleVerifiedInlineDownload(
    verified.artifact,
    `${prefix}${verified.artifact.relativePath}`,
    true
  );
  if (!html.success)
    return derivedHtmlResponse({ ...html, error: 'derived-html-download-unconfirmed' });
  const receipt = await persistDerivedHtmlReceipt(message, verified.artifact, prefix);
  const cleanupDeferred =
    durableWriteOutcomeFromResult(html)?.cleanupDeferred === true ||
    durableWriteOutcomeFromResult(receipt)?.cleanupDeferred === true;
  return derivedHtmlResponse(
    withDurableWriteOutcome(
      {
        destination: 'file',
        success: receipt.success,
        ...(!receipt.success && {
          error: 'derived-html-receipt-unconfirmed',
          warning: 'HTML may exist without a confirmed receipt; no retry was attempted.',
        }),
        ...(receipt.success && cleanupDeferred && { warning: 'archive-stage-cleanup-deferred' }),
      },
      'confirmed',
      true,
      cleanupDeferred
    )
  );
}

/** Each dispatch owns its observation; malformed post-dispatch evidence is unknown. */
async function branchHtmlDownload(
  artifact: InlineDownloadArtifact,
  path: string
): Promise<DurableWriteOutcome> {
  try {
    const result = await handleVerifiedInlineDownload(artifact, path, true);
    return durableWriteOutcomeFromResult(result) ?? { state: 'unknown' };
  } catch {
    return { state: 'unknown' };
  }
}

async function persistDerivedBranchHtmlReceipt(
  identity: DerivedOutputIdentity,
  artifact: DerivedBranchHtmlArtifact,
  prefix: string
): Promise<DurableWriteOutcome> {
  let bodyBase64: string;
  let relativePath: string;
  try {
    const receipt = buildDerivedBranchOutputReceipt(identity, artifact);
    if (!matchDerivedBranchOutputReceipt(receipt, identity, artifact)) throw new Error();
    const bytes = buildDerivedBranchOutputReceiptBytes(receipt);
    bodyBase64 = bytesToBase64(bytes);
    const sha256 = await sha256Hex(bytes);
    const decoded = decodeCanonicalBase64(bodyBase64);
    if (
      !decoded ||
      decoded.byteLength !== bytes.byteLength ||
      (await sha256Hex(decoded)) !== sha256 ||
      !matchDerivedBranchOutputReceipt(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded)),
        identity,
        artifact
      )
    )
      throw new Error();
    relativePath = deriveBranchHtmlReceiptRelativePath(
      artifact.role === 'leaf' ? { role: 'leaf', ordinal: artifact.ordinal } : { role: 'index' }
    );
  } catch {
    return { state: 'not-dispatched' };
  }
  return branchHtmlDownload(
    { transport: 'inline', bodyBase64, mediaType: 'application/json' },
    `${prefix}${relativePath}`
  );
}

/** One verified branch artifact, then its locally built receipt. No retry or bundle inference. */
export async function handlePersistDerivedBranchHtmlPresentation(
  message: Extract<ExtensionMessage, { action: 'persistDerivedBranchHtmlPresentation' }>
): Promise<DerivedBranchHtmlPersistResponse> {
  const identity = {
    source: message.source,
    captureId: message.captureId,
    conversationKey: message.conversationKey,
  };
  const verified = await verifyDerivedBranchHtmlArtifact(message.artifact, sha256Hex);
  if (!verified)
    return buildDerivedBranchHtmlPersistResponse(
      { state: 'not-dispatched' },
      { state: 'not-dispatched' }
    );
  const prefix = `_liska-archive/${identity.conversationKey}/${identity.captureId}/`;
  const html = await branchHtmlDownload(
    verified.artifact,
    `${prefix}${verified.artifact.relativePath}`
  );
  const receipt =
    html.state === 'confirmed'
      ? await persistDerivedBranchHtmlReceipt(identity, verified.artifact, prefix)
      : ({ state: 'not-dispatched' } as const);
  return buildDerivedBranchHtmlPersistResponse(html, receipt);
}

async function handleArchiveSaveToObsidian(
  message: Extract<ExtensionMessage, { action: 'persistArchiveCompanion' }>,
  settings: ExtensionSettings,
  bytes: Uint8Array
): Promise<OutputResult> {
  let state: DurableWriteState = 'not-dispatched';
  try {
    const result = await handleSaveArchiveCompanion(
      settings,
      {
        source: message.source,
        captureId: message.captureId,
        conversationKey: message.conversationKey,
        ...(message.capturedAt !== undefined && { capturedAt: message.capturedAt }),
        artifact: message.artifact,
        bytes,
      },
      ...(message.reportDurableWriteOutcome === true
        ? [
            (observed: DurableWriteState) => {
              state = observed;
            },
          ]
        : [])
    );
    return withDurableWriteOutcome(
      {
        destination: 'obsidian',
        success: result.success,
        ...(result.error && { error: result.error }),
      },
      state,
      message.reportDurableWriteOutcome
    );
  } catch {
    return withDurableWriteOutcome(
      { destination: 'obsidian', success: false, error: 'Archive companion write failed' },
      state,
      message.reportDurableWriteOutcome
    );
  }
}

/** A fixed pre-dispatch rejection, without borrowing ordinary Markdown semantics. */
function archivePreflightFailure(
  message: Extract<ExtensionMessage, { action: 'persistArchiveCompanion' }>,
  error: string
): MultiOutputResponse {
  return {
    results: message.outputs.map(destination =>
      withDurableWriteOutcome(
        { destination, success: false, error },
        'not-dispatched',
        message.reportDurableWriteOutcome
      )
    ),
    allSuccessful: false,
    anySuccessful: false,
  };
}

/** Persist exactly one verified artifact to durable outputs; Clipboard is intentionally absent. */
export async function handlePersistArchiveCompanion(
  message: Extract<ExtensionMessage, { action: 'persistArchiveCompanion' }>,
  settings: ExtensionSettings
): Promise<MultiOutputResponse> {
  if (
    message.source !== 'chatgpt' &&
    message.source !== 'deepseek' &&
    message.source !== 'claude'
  ) {
    return archivePreflightFailure(message, 'Archive companion source is unsupported');
  }
  const bytes = await verifyArchiveCompanion(message.artifact, message.source);
  if (!bytes) {
    return archivePreflightFailure(message, 'Archive companion integrity verification failed');
  }

  const settled = await Promise.allSettled(
    message.outputs.map(destination =>
      destination === 'file'
        ? handleArchiveDownload(message)
        : handleArchiveSaveToObsidian(message, settings, bytes)
    )
  );
  const results = settled.map((result, index): OutputResult => {
    if (result.status === 'fulfilled') return result.value;
    return withDurableWriteOutcome(
      {
        destination: message.outputs[index],
        success: false,
        error: 'Archive companion write failed',
      },
      'unknown',
      message.reportDurableWriteOutcome
    );
  });
  return {
    results,
    allSuccessful: results.every(result => result.success),
    anySuccessful: results.some(result => result.success),
  };
}

/** In-worker admission only: service-worker restarts do not retain this gate. */
let strictFileDownloadOwner: symbol | undefined;

function releaseStrictFileDownload(owner: symbol): void {
  if (strictFileDownloadOwner === owner) strictFileDownloadOwner = undefined;
}

async function downloadStrictMarkdown(url: string, filename: string): Promise<OutputResult> {
  if (strictFileDownloadOwner !== undefined) {
    return {
      destination: 'file',
      success: false,
      strictFileOutcome: 'blocked',
      error: 'strict-file-download-busy',
    };
  }
  const owner = Symbol('strict-file-download');
  strictFileDownloadOwner = owner;
  try {
    const outcome = await downloadArchiveBlob(url, filename, async () => {
      releaseStrictFileDownload(owner);
    });
    // Only this download's terminal evidence can release admission. A failed
    // post-terminal filename lookup is still unconfirmed, but cannot leave an
    // already-finished transfer permanently holding the gate.
    if (outcome.terminal) releaseStrictFileDownload(owner);
    if (!outcome.terminal || outcome.error !== null) {
      return {
        destination: 'file',
        success: false,
        strictFileOutcome: outcome.terminal ? 'confirmed-failure' : 'unconfirmed',
        error: outcome.terminal
          ? 'strict-file-download-failed'
          : 'strict-file-download-unconfirmed',
      };
    }
    const path = await confirmArchiveDownloadPath(outcome, filename, true);
    if (path === 'confirmed') {
      return {
        destination: 'file',
        success: true,
        strictFileOutcome: 'confirmed-success',
        savedAs: filename,
      };
    }
    return {
      destination: 'file',
      success: false,
      strictFileOutcome: path === 'mismatch' ? 'confirmed-failure' : 'unconfirmed',
      error: `strict-file-download-path-${path === 'mismatch' ? 'mismatch' : 'unconfirmed'}`,
    };
  } catch {
    // A thrown Downloads channel can have started a transfer. Its exact late
    // terminal callback, not a subsequent operation, owns gate release.
    return {
      destination: 'file',
      success: false,
      strictFileOutcome: 'unconfirmed',
      error: 'strict-file-download-unconfirmed',
    };
  }
}

/** Download Markdown and then each captured image; ordinary images retain their existing behavior. */
async function handleDownloadToFile(
  note: ObsidianNote,
  settings: ExtensionSettings,
  strictFileDownload?: true
): Promise<OutputResult> {
  let markdownResult: OutputResult | undefined;
  try {
    const images = settings.enableImageExport ? (note.images ?? []) : [];
    const { body, files } =
      images.length > 0
        ? resolveImagesForFile(note.body, images, noteBaseName(note.fileName))
        : { body: stripImagePlaceholders(note.body), files: [] };

    const content = generateNoteContent({ ...note, body }, settings);
    const url = `data:text/markdown;charset=utf-8;base64,${stringToBase64(content)}`;
    const mdError = strictFileDownload ? null : await downloadDataUrl(url, note.fileName);
    markdownResult = strictFileDownload
      ? await downloadStrictMarkdown(url, note.fileName)
      : {
          destination: 'file',
          success: !mdError,
          ...(mdError && { error: mdError }),
        };
    if (!markdownResult.success) return markdownResult;

    for (const file of files) {
      const imgError = await downloadDataUrl(
        `data:${file.mimeType};base64,${file.data}`,
        file.fileName
      );
      if (imgError) {
        return {
          ...markdownResult,
          success: false,
          error: 'Image download failed (1 image)',
        };
      }
    }

    return markdownResult;
  } catch (error) {
    return {
      ...markdownResult,
      destination: 'file',
      success: false,
      ...(strictFileDownload &&
        !markdownResult && { strictFileOutcome: 'confirmed-failure' as const }),
      error: extractErrorMessage(error),
    };
  }
}

/**
 * Copy note content to clipboard via offscreen document
 */
async function handleCopyToClipboard(
  note: ObsidianNote,
  settings: ExtensionSettings
): Promise<OutputResult> {
  let lease: OffscreenLease | undefined;
  try {
    // Clipboard output never references images: strip any placeholders so the
    // copied markdown stays clean (issue #186).
    const clipboardNote = { ...note, body: stripImagePlaceholders(note.body) };
    const content = generateNoteContent(clipboardNote, settings);

    lease = await acquireOffscreenLease();

    const clipboardMessage: OffscreenClipboardMessage = {
      action: 'clipboardWrite',
      target: 'offscreen',
      content,
    };
    const response: unknown = await withTimeout(
      chrome.runtime.sendMessage(clipboardMessage),
      OFFSCREEN_TIMEOUT_MS,
      'Clipboard write timed out'
    );

    if (isClipboardWriteResponse(response) && response.success) {
      return { destination: 'clipboard', success: true };
    } else {
      const error = isClipboardWriteResponse(response)
        ? (response.error ?? 'Clipboard write failed')
        : 'Clipboard write failed';
      return { destination: 'clipboard', success: false, error };
    }
  } catch (error) {
    return {
      destination: 'clipboard',
      success: false,
      error: extractErrorMessage(error),
    };
  } finally {
    lease?.release();
  }
}

/**
 * Handle multi-output operation
 * Executes all outputs in parallel, aggregates results
 */
export async function handleMultiOutput(
  note: ObsidianNote,
  outputs: OutputDestination[],
  settings: ExtensionSettings,
  capturedAt?: string,
  strictFileDownload?: true
): Promise<MultiOutputResponse> {
  const promises = outputs.map(dest => {
    switch (dest) {
      case 'obsidian':
        return handleSaveToObsidian(note, settings, capturedAt);
      case 'file':
        return handleDownloadToFile(note, settings, strictFileDownload);
      case 'clipboard':
        return handleCopyToClipboard(note, settings);
    }
  });

  // Promise.allSettled: one failure does not block others
  const settled = await Promise.allSettled(promises);

  const results: OutputResult[] = settled.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return {
        destination: outputs[index],
        success: false,
        error: String(result.reason),
      };
    }
  });

  // Extract messagesAppended from obsidian result (append mode)
  const messagesAppended = results.find(r => r.destination === 'obsidian')?.messagesAppended;

  return {
    results,
    allSuccessful: results.every(r => r.success),
    anySuccessful: results.some(r => r.success),
    messagesAppended,
  };
}
