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
import { CHATGPT_CAPTURE_MAX_BYTES } from '../lib/chatgpt-capture-contract';
import { canonicalBase64ByteLength } from '../lib/base64';
import type {
  ArchiveBlobCreateResponse,
  ArchiveCompanionArtifact,
  ExtensionMessage,
  ExtensionSettings,
  ObsidianNote,
  OffscreenArchiveBlobRevokeMessage,
  OutputDestination,
  OutputResult,
  MultiOutputResponse,
  OffscreenClipboardMessage,
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

interface OffscreenLease {
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
 * Save to Obsidian and return OutputResult with optional messagesAppended
 */
async function handleSaveToObsidian(
  note: ObsidianNote,
  settings: ExtensionSettings
): Promise<OutputResult> {
  try {
    const result = await handleSave(settings, note);
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

async function sha256Hex(bytes: Uint8Array): Promise<string | undefined> {
  try {
    const exact = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', exact);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

/** Verify the independently validated envelope immediately before persistence. */
async function verifyArchiveCompanion(
  artifact: ArchiveCompanionArtifact
): Promise<Uint8Array | null> {
  const bytes = decodeCanonicalBase64(artifact.bodyBase64);
  const maxBytes = artifact.kind === 'raw' ? CHATGPT_CAPTURE_MAX_BYTES : MAX_CONTENT_SIZE;
  if (!bytes || bytes.byteLength !== artifact.byteLength || bytes.byteLength > maxBytes)
    return null;
  return (await sha256Hex(bytes)) === artifact.sha256 ? bytes : null;
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

async function revokeArchiveBlobUrl(url: string): Promise<void> {
  const message: OffscreenArchiveBlobRevokeMessage = {
    action: 'archiveBlobRevoke',
    target: 'offscreen',
    url,
  };
  try {
    await withTimeout(
      chrome.runtime.sendMessage(message),
      OFFSCREEN_TIMEOUT_MS,
      'Archive Blob release timed out'
    );
  } catch {
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
  artifact: ArchiveCompanionArtifact
): Promise<ArchiveBlobCreateOutcome> {
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
interface ArchiveDownloadOutcome {
  error: string | null;
  /** Blob may be released only after Downloads has reached a terminal state. */
  terminal: boolean;
}

function isTerminalDownloadState(state: string | undefined): state is 'complete' | 'interrupted' {
  return state === 'complete' || state === 'interrupted';
}

function terminalDownloadOutcome(state: 'complete' | 'interrupted'): ArchiveDownloadOutcome {
  return state === 'complete'
    ? { error: null, terminal: true }
    : { error: 'Archive download was interrupted', terminal: true };
}

async function inspectArchiveDownload(
  downloadId: number
): Promise<chrome.downloads.DownloadState | undefined> {
  try {
    const downloads = await chrome.downloads.search({ id: downloadId });
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
function downloadArchiveBlob(
  url: string,
  filename: string,
  onLateTerminal: () => Promise<void>
): Promise<ArchiveDownloadOutcome> {
  return new Promise(resolve => {
    let downloadId: number | undefined;
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
    const onChanged = (delta: chrome.downloads.DownloadDelta): void => {
      const state = delta.state?.current;
      if (!isTerminalDownloadState(state)) return;
      if (downloadId === undefined) {
        pendingTerminalDeltas.push({ id: delta.id, state });
        return;
      }
      if (delta.id === downloadId) void finishTerminal(terminalDownloadOutcome(state));
    };

    const reconcileDownloadState = async (): Promise<void> => {
      if (downloadId === undefined || terminal) return;
      // Always query after callback assignment: onChanged can race the
      // callback, while search gives Downloads' authoritative current state.
      const statePromise = inspectArchiveDownload(downloadId);
      const pending = pendingTerminalDeltas.find(delta => delta.id === downloadId);
      if (pending) {
        void statePromise;
        await finishTerminal(terminalDownloadOutcome(pending.state));
        return;
      }
      const state = await statePromise;
      if (isTerminalDownloadState(state)) await finishTerminal(terminalDownloadOutcome(state));
    };

    const returnUnconfirmedFailure = (error: string): void => {
      settleCaller({ error, terminal: false }, true);
    };
    const cancelAndConfirm = async (): Promise<void> => {
      if (terminal || callerSettled) return;
      if (downloadId === undefined) {
        // A late callback can still name this download; leave listener and
        // lease ownership intact until it reconciles a terminal state.
        returnUnconfirmedFailure('Archive download did not complete');
        return;
      }
      const state = await inspectArchiveDownload(downloadId);
      if (isTerminalDownloadState(state)) {
        await finishTerminal(terminalDownloadOutcome(state));
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
        void reconcileDownloadState();
      }
    });
  });
}
/* eslint-enable max-lines-per-function */

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

async function handleArchiveDownload(
  message: Extract<ExtensionMessage, { action: 'persistArchiveCompanion' }>
): Promise<OutputResult> {
  let blobUrl: string | null = null;
  let lease: OffscreenLease | undefined;
  let leaseTransferred = false;
  try {
    lease = await acquireOffscreenLease();
    const blobCreate = await createArchiveBlobUrl(message.artifact);
    blobUrl = blobCreate.url;
    if (!blobUrl) {
      if (blobCreate.lateCleanup) {
        leaseTransferred = true;
        void blobCreate.lateCleanup.finally(() => lease?.release());
      }
      return { destination: 'file', success: false, error: 'Archive download setup failed' };
    }
    const outcome = await downloadArchiveBlob(
      blobUrl,
      archiveCompanionDownloadPath(message),
      async () => {
        try {
          await revokeArchiveBlobUrl(blobUrl!);
        } finally {
          lease?.release();
        }
      }
    );
    if (!outcome.terminal) leaseTransferred = true;
    return outcome.error
      ? { destination: 'file', success: false, error: outcome.error }
      : { destination: 'file', success: true };
  } catch {
    return { destination: 'file', success: false, error: 'Archive download setup failed' };
  } finally {
    if (!leaseTransferred) {
      if (blobUrl) await revokeArchiveBlobUrl(blobUrl);
      lease?.release();
    }
  }
}

async function handleArchiveSaveToObsidian(
  message: Extract<ExtensionMessage, { action: 'persistArchiveCompanion' }>,
  settings: ExtensionSettings,
  bytes: Uint8Array
): Promise<OutputResult> {
  const result = await handleSaveArchiveCompanion(settings, {
    source: message.source,
    captureId: message.captureId,
    conversationKey: message.conversationKey,
    artifact: message.artifact,
    bytes,
  });
  return {
    destination: 'obsidian',
    success: result.success,
    ...(result.error && { error: result.error }),
  };
}

/**
 * Persist exactly one verified archive companion to the selected durable
 * outputs. Clipboard is intentionally absent from this dedicated route.
 */
export async function handlePersistArchiveCompanion(
  message: Extract<ExtensionMessage, { action: 'persistArchiveCompanion' }>,
  settings: ExtensionSettings
): Promise<MultiOutputResponse> {
  const bytes = await verifyArchiveCompanion(message.artifact);
  if (!bytes) {
    const results = message.outputs.map(destination => ({
      destination,
      success: false,
      error: 'Archive companion integrity verification failed',
    })) as OutputResult[];
    return { results, allSuccessful: false, anySuccessful: false };
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
    return {
      destination: message.outputs[index],
      success: false,
      error: 'Archive companion write failed',
    };
  });
  return {
    results,
    allSuccessful: results.every(result => result.success),
    anySuccessful: results.some(result => result.success),
  };
}

/**
 * Download note as a file, plus each captured image as a separate file.
 * The markdown references images by filename only (issue #186).
 */
async function handleDownloadToFile(
  note: ObsidianNote,
  settings: ExtensionSettings
): Promise<OutputResult> {
  try {
    const images = settings.enableImageExport ? (note.images ?? []) : [];
    const { body, files } =
      images.length > 0
        ? resolveImagesForFile(note.body, images, noteBaseName(note.fileName))
        : { body: stripImagePlaceholders(note.body), files: [] };

    const content = generateNoteContent({ ...note, body }, settings);
    const mdError = await downloadDataUrl(
      `data:text/markdown;charset=utf-8;base64,${stringToBase64(content)}`,
      note.fileName
    );
    if (mdError) {
      return { destination: 'file', success: false, error: mdError };
    }

    for (const file of files) {
      const imgError = await downloadDataUrl(
        `data:${file.mimeType};base64,${file.data}`,
        file.fileName
      );
      if (imgError) {
        return {
          destination: 'file',
          success: false,
          error: 'Image download failed (1 image)',
        };
      }
    }

    return { destination: 'file', success: true };
  } catch (error) {
    return {
      destination: 'file',
      success: false,
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
  settings: ExtensionSettings
): Promise<MultiOutputResponse> {
  const promises = outputs.map(dest => {
    switch (dest) {
      case 'obsidian':
        return handleSaveToObsidian(note, settings);
      case 'file':
        return handleDownloadToFile(note, settings);
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
