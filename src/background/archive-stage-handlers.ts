/** Background orchestration for sealed raw/canonical OPFS archive stages. */

import {
  ARCHIVE_STAGE_CHUNK_BYTES,
  isArchiveStageDescriptor,
  isSafeArchiveStageId,
  type ArchiveStageDescriptor,
} from '../lib/archive-stage-contract';
import { canonicalBase64ByteLength } from '../lib/base64';
import { bytesToBase64 } from '../lib/image-utils';
import type {
  ArchiveStageReadResponse,
  ArchiveStageResponse,
  ArchiveStageUrlResponse,
  ExtensionMessage,
  ExtensionSettings,
  MultiOutputResponse,
  OffscreenArchiveStageAppendMessage,
  OffscreenArchiveStageBeginMessage,
  OffscreenArchiveStageReadMessage,
  OffscreenArchiveStageSealMessage,
  OutputResult,
  StagedArchiveCompanionArtifact,
} from '../lib/types';
import { handleSaveStagedArchiveCompanion } from './obsidian-handlers';
import {
  assignArchiveStageDownloadRecoveryId,
  forgetArchiveStageDownloadRecovery,
  isArchiveStageDownloadRecoveryRecord,
  releaseArchiveStageDownloadRecovery,
  relinquishArchiveStageDownloadRecovery,
  rememberArchiveStageDownloadRecovery,
  type ArchiveStageDownloadRecoveryRecord,
} from './archive-stage-download-recovery';
import {
  acquireOffscreenLeaseForArchiveStage,
  downloadArchiveBlob,
  type OffscreenLease,
} from './output-handlers';

type ArchiveStageContentMessage = Extract<
  ExtensionMessage,
  | { action: 'beginStagedArchiveArtifact' }
  | { action: 'appendStagedArchiveArtifact' }
  | { action: 'sealStagedArchiveArtifact' }
  | { action: 'readStagedArchiveArtifact' }
  | { action: 'commitStagedArchiveCompanion' }
  | { action: 'abortStagedArchiveArtifact' }
>;

const ARCHIVE_STAGE_MESSAGE_TIMEOUT_MS = 10_000;

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function safeStageId(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return `archive-stage-${bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_')}`;
}

function isStageResponse(value: unknown): value is ArchiveStageResponse {
  if (typeof value !== 'object' || value === null) return false;
  const response = value as Record<string, unknown>;
  return response.success === true
    ? hasExactKeys(value, ['success'])
    : response.success === false &&
        hasExactKeys(value, ['success', 'error']) &&
        typeof response.error === 'string';
}

// eslint-disable-next-line complexity -- Exact nested runtime-envelope validation stays local to this trust boundary.
function isStageReadResponse(value: unknown): value is ArchiveStageReadResponse {
  if (typeof value !== 'object' || value === null) return false;
  const response = value as Record<string, unknown>;
  if (response.success === false) {
    return hasExactKeys(value, ['success', 'error']) && typeof response.error === 'string';
  }
  if (response.success !== true || typeof response.data !== 'object' || response.data === null) {
    return false;
  }
  const data = response.data as Record<string, unknown>;
  const decodedLength =
    typeof data.chunkBase64 === 'string' ? canonicalBase64ByteLength(data.chunkBase64) : undefined;
  return (
    hasExactKeys(value, ['success', 'data']) &&
    hasExactKeys(data, ['stageId', 'offset', 'byteLength', 'chunkBase64']) &&
    isSafeArchiveStageId(data.stageId) &&
    Number.isSafeInteger(data.offset) &&
    (data.offset as number) >= 0 &&
    Number.isSafeInteger(data.byteLength) &&
    (data.byteLength as number) >= 0 &&
    (data.byteLength as number) <= ARCHIVE_STAGE_CHUNK_BYTES &&
    decodedLength === data.byteLength
  );
}

function isStageUrlResponse(value: unknown): value is ArchiveStageUrlResponse {
  if (typeof value !== 'object' || value === null) return false;
  const response = value as Record<string, unknown>;
  return response.success === false
    ? hasExactKeys(value, ['success', 'error']) && typeof response.error === 'string'
    : response.success === true &&
        hasExactKeys(value, ['success', 'url']) &&
        typeof response.url === 'string' &&
        response.url.startsWith('blob:');
}

async function sendOffscreen<T>(
  message: object,
  validate: (value: unknown) => value is T
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response: unknown = await Promise.race([
      chrome.runtime.sendMessage(message),
      new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), ARCHIVE_STAGE_MESSAGE_TIMEOUT_MS);
      }),
    ]);
    return validate(response) ? response : undefined;
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withShortLease<T>(operation: () => Promise<T>): Promise<T> {
  const lease = await acquireOffscreenLeaseForArchiveStage();
  try {
    return await operation();
  } finally {
    lease.release();
  }
}

export async function beginArchiveStage(
  descriptor: ArchiveStageDescriptor
): Promise<string | undefined> {
  if (!isArchiveStageDescriptor(descriptor)) return undefined;
  const stageId = safeStageId();
  const message: OffscreenArchiveStageBeginMessage = {
    action: 'archiveStageBegin',
    target: 'offscreen',
    stageId,
    descriptor,
  };
  const response = await withShortLease(() => sendOffscreen(message, isStageResponse));
  return response?.success ? stageId : undefined;
}

export async function appendArchiveStage(
  stageId: string,
  offset: number,
  chunkBase64: string
): Promise<boolean> {
  const message: OffscreenArchiveStageAppendMessage = {
    action: 'archiveStageAppend',
    target: 'offscreen',
    stageId,
    offset,
    chunkBase64,
  };
  const response = await withShortLease(() => sendOffscreen(message, isStageResponse));
  return response?.success === true;
}

export async function sealArchiveStage(
  stageId: string,
  descriptor: ArchiveStageDescriptor
): Promise<boolean> {
  const message: OffscreenArchiveStageSealMessage = {
    action: 'archiveStageSeal',
    target: 'offscreen',
    stageId,
    descriptor,
  };
  const response = await withShortLease(() => sendOffscreen(message, isStageResponse));
  return response?.success === true;
}

export async function readArchiveStage(
  stageId: string,
  offset: number,
  byteLength: number
): Promise<ArchiveStageReadResponse | undefined> {
  const message: OffscreenArchiveStageReadMessage = {
    action: 'archiveStageRead',
    target: 'offscreen',
    stageId,
    offset,
    byteLength,
  };
  return withShortLease(() => sendOffscreen(message, isStageReadResponse));
}

export async function abortArchiveStage(stageId: string): Promise<boolean> {
  if (!isSafeArchiveStageId(stageId)) return false;
  const response = await withShortLease(() =>
    sendOffscreen({ action: 'archiveStageAbort', target: 'offscreen', stageId }, isStageResponse)
  );
  return response?.success === true;
}

function descriptorFromArtifact(
  artifact: StagedArchiveCompanionArtifact
): ArchiveStageDescriptor | undefined {
  const descriptor: ArchiveStageDescriptor = {
    kind: artifact.kind,
    mediaType: artifact.mediaType,
    relativePath: artifact.relativePath,
    byteLength: artifact.byteLength,
    sha256: artifact.sha256,
  };
  return isArchiveStageDescriptor(descriptor) ? descriptor : undefined;
}

function archiveDownloadPath(
  message: Extract<ExtensionMessage, { action: 'commitStagedArchiveCompanion' }>
): string {
  return [
    '_liska-archive',
    message.conversationKey,
    message.captureId,
    ...message.artifact.relativePath.split('/'),
  ].join('/');
}

async function createStageUrl(
  stageId: string,
  descriptor: ArchiveStageDescriptor
): Promise<string | undefined> {
  const response = await sendOffscreen(
    {
      action: 'archiveStageCreateUrl',
      target: 'offscreen',
      stageId,
      descriptor,
    },
    isStageUrlResponse
  );
  return response?.success ? response.url : undefined;
}

interface ArchiveStageFileDownload {
  result: OutputResult;
  terminal: boolean;
  recovery?: ArchiveStageDownloadRecoveryRecord;
}

// eslint-disable-next-line max-lines-per-function -- durable registration and late terminal ownership share one lifecycle.
async function downloadStagedArchiveToFile(
  blobUrl: string,
  message: Extract<ExtensionMessage, { action: 'commitStagedArchiveCompanion' }>,
  onLateTerminal: () => Promise<void>,
  onRecoveryUpdate: (record: ArchiveStageDownloadRecoveryRecord | undefined) => void
): Promise<ArchiveStageFileDownload> {
  const provisional: ArchiveStageDownloadRecoveryRecord = {
    downloadId: null,
    stageId: message.artifact.stageId,
    blobUrl,
    createdAt: Date.now(),
  };
  if (
    !isArchiveStageDownloadRecoveryRecord(provisional) ||
    !(await rememberArchiveStageDownloadRecovery(provisional))
  ) {
    return {
      terminal: true,
      result: { destination: 'file', success: false, error: 'archive-stage-write-failed' },
    };
  }

  let recovery: ArchiveStageDownloadRecoveryRecord | undefined = provisional;
  onRecoveryUpdate(recovery);
  try {
    const outcome = await downloadArchiveBlob(
      blobUrl,
      archiveDownloadPath(message),
      onLateTerminal,
      async downloadId => {
        if (!recovery || recovery.downloadId !== null) return;
        const assigned = await assignArchiveStageDownloadRecoveryId(recovery, downloadId);
        if (!assigned) return;
        recovery = assigned;
        onRecoveryUpdate(recovery);
      }
    );
    return {
      terminal: outcome.terminal,
      recovery,
      result: outcome.error
        ? { destination: 'file', success: false, error: outcome.error }
        : { destination: 'file', success: true },
    };
  } catch {
    // Preserve durable ownership. The late terminal listener remains the only
    // authority allowed to release an already-started file download.
    return {
      terminal: false,
      recovery,
      result: { destination: 'file', success: false, error: 'archive-stage-write-failed' },
    };
  }
}

async function saveStagedArchiveToObsidian(
  blobUrl: string,
  message: Extract<ExtensionMessage, { action: 'commitStagedArchiveCompanion' }>,
  settings: ExtensionSettings,
  descriptor: ArchiveStageDescriptor
): Promise<OutputResult> {
  try {
    const saved = await handleSaveStagedArchiveCompanion(settings, {
      source: message.source,
      captureId: message.captureId,
      conversationKey: message.conversationKey,
      stageId: message.artifact.stageId,
      descriptor,
      blobUrl,
    });
    return {
      destination: 'obsidian',
      success: saved.success,
      ...(saved.error && { error: saved.error }),
    };
  } catch {
    return { destination: 'obsidian', success: false, error: 'archive-stage-write-failed' };
  }
}

async function releaseCommittedArchiveStage(
  stageId: string,
  blobUrl: string,
  lease: OffscreenLease
): Promise<boolean> {
  try {
    return await releaseArchiveStageDownloadRecovery(stageId, blobUrl, lease);
  } finally {
    lease.release();
  }
}

// eslint-disable-next-line max-lines-per-function -- Destination ordering and one-owner release remain visible as one auditable lifecycle.
async function commitStagedArchiveCompanion(
  message: Extract<ExtensionMessage, { action: 'commitStagedArchiveCompanion' }>,
  settings: ExtensionSettings
): Promise<MultiOutputResponse> {
  const descriptor = descriptorFromArtifact(message.artifact);
  if (!descriptor) {
    const results = message.outputs.map(destination => ({
      destination,
      success: false,
      error: 'archive-stage-descriptor-invalid',
    })) as OutputResult[];
    return { results, allSuccessful: false, anySuccessful: false };
  }

  let lease: OffscreenLease | undefined;
  let url: string | undefined;
  let destinationsFinished = false;
  let downloadTerminal = !message.outputs.includes('file');
  let fileDownloadStarted = false;
  let released = false;
  let cleanupConfirmed: boolean | undefined;
  let recoveryRecord: ArchiveStageDownloadRecoveryRecord | undefined;
  const clearRecoveryAfterConfirmedCleanup = async (): Promise<void> => {
    if (cleanupConfirmed === true && recoveryRecord) {
      await forgetArchiveStageDownloadRecovery(recoveryRecord);
    }
  };
  const relinquishDeferredRecovery = (): void => {
    if (cleanupConfirmed === false && recoveryRecord) {
      relinquishArchiveStageDownloadRecovery(recoveryRecord.stageId);
    }
  };
  const releaseWhenOwned = async (): Promise<boolean | undefined> => {
    if (released) {
      await clearRecoveryAfterConfirmedCleanup();
      return cleanupConfirmed;
    }
    if (!destinationsFinished || !downloadTerminal || !lease || !url) return undefined;
    released = true;
    try {
      cleanupConfirmed = await releaseCommittedArchiveStage(message.artifact.stageId, url, lease);
    } catch {
      cleanupConfirmed = false;
      if (recoveryRecord) relinquishArchiveStageDownloadRecovery(recoveryRecord.stageId);
      throw new Error('archive-stage-cleanup-failed');
    }
    await clearRecoveryAfterConfirmedCleanup();
    relinquishDeferredRecovery();
    return cleanupConfirmed;
  };

  try {
    lease = await acquireOffscreenLeaseForArchiveStage();
    url = await createStageUrl(message.artifact.stageId, descriptor);
    if (!url) {
      await abortArchiveStage(message.artifact.stageId);
      lease.release();
      lease = undefined;
      const results = message.outputs.map(destination => ({
        destination,
        success: false,
        error: 'archive-stage-write-failed',
      })) as OutputResult[];
      return { results, allSuccessful: false, anySuccessful: false };
    }

    const results = await Promise.all(
      message.outputs.map(async destination => {
        if (destination === 'obsidian') {
          return saveStagedArchiveToObsidian(url!, message, settings, descriptor);
        }
        const download = await downloadStagedArchiveToFile(
          url!,
          message,
          async () => {
            downloadTerminal = true;
            await releaseWhenOwned();
          },
          record => {
            recoveryRecord = record;
          }
        );
        fileDownloadStarted = download.recovery !== undefined;
        recoveryRecord = download.recovery ?? recoveryRecord;
        // A late terminal callback can race this outcome. Latch true forever.
        downloadTerminal = downloadTerminal || download.terminal;
        return download.result;
      })
    );
    destinationsFinished = true;
    await releaseWhenOwned();
    return {
      results,
      allSuccessful: results.every(result => result.success),
      anySuccessful: results.some(result => result.success),
    };
  } catch {
    destinationsFinished = true;
    if (!fileDownloadStarted) downloadTerminal = true;
    await releaseWhenOwned();
    const results = message.outputs.map(destination => ({
      destination,
      success: false,
      error: 'archive-stage-write-failed',
    })) as OutputResult[];
    return { results, allSuccessful: false, anySuccessful: false };
  } finally {
    if (destinationsFinished && downloadTerminal) await releaseWhenOwned();
  }
}

/** Route one validated content message through the exact archive-stage lifecycle. */
export async function handleArchiveStageMessage(
  message: ArchiveStageContentMessage,
  settings?: ExtensionSettings
): Promise<ArchiveStageResponse | ArchiveStageReadResponse | MultiOutputResponse> {
  if (message.action === 'beginStagedArchiveArtifact') {
    const stageId = await beginArchiveStage(message.descriptor);
    return stageId
      ? { success: true, stageId }
      : { success: false, error: 'archive-stage-begin-failed' };
  }
  if (message.action === 'appendStagedArchiveArtifact') {
    return (await appendArchiveStage(message.stageId, message.offset, message.chunkBase64))
      ? { success: true }
      : { success: false, error: 'archive-stage-append-failed' };
  }
  if (message.action === 'sealStagedArchiveArtifact') {
    return (await sealArchiveStage(message.stageId, message.descriptor))
      ? { success: true }
      : { success: false, error: 'archive-stage-seal-failed' };
  }
  if (message.action === 'readStagedArchiveArtifact') {
    return (
      (await readArchiveStage(message.stageId, message.offset, message.byteLength)) ?? {
        success: false,
        error: 'archive-stage-read-failed',
      }
    );
  }
  if (message.action === 'abortStagedArchiveArtifact') {
    return (await abortArchiveStage(message.stageId))
      ? { success: true }
      : { success: false, error: 'archive-stage-abort-failed' };
  }
  if (!settings) {
    return {
      results: message.outputs.map(destination => ({
        destination,
        success: false,
        error: 'archive-stage-settings-unavailable',
      })),
      allSuccessful: false,
      anySuccessful: false,
    };
  }
  return commitStagedArchiveCompanion(message, settings);
}
