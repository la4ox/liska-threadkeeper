/** Durable outputs for one finalized OPFS binary stage. */

import type {
  BinaryStageFinalizeResponse,
  BinaryStageResponse,
  ExtensionMessage,
  ExtensionSettings,
  MultiOutputResponse,
  OffscreenBinaryStageAppendMessage,
  OffscreenBinaryStageBeginMessage,
  OffscreenBinaryStageFinalizeMessage,
  OutputResult,
} from '../lib/types';
import { handleSaveStagedBinaryAsset } from './obsidian-handlers';
import {
  abortStagedBinaryStage,
  assignStagedBinaryDownloadRecoveryId,
  forgetStagedBinaryDownloadRecovery,
  isStagedBinaryDownloadRecoveryRecord,
  rememberStagedBinaryDownloadRecovery,
  relinquishStagedBinaryDownloadRecovery,
  releaseStagedBinaryStage,
  type StagedBinaryDownloadRecoveryRecord,
} from './binary-download-recovery';
import {
  acquireOffscreenLeaseForStagedBinaryAsset,
  downloadArchiveBlob,
  type ArchiveDownloadOutcome,
  type OffscreenLease,
} from './output-handlers';

type BinaryStageContentMessage = Extract<
  ExtensionMessage,
  | { action: 'beginStagedBinaryAsset' }
  | { action: 'appendStagedBinaryAsset' }
  | { action: 'commitStagedBinaryAsset' }
  | { action: 'abortStagedBinaryAsset' }
>;

const BINARY_STAGE_MESSAGE_TIMEOUT_MS = 10_000;

function isStageResponse(value: unknown): value is BinaryStageResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { success?: unknown }).success === 'boolean'
  );
}

function isStageFinalizeResponse(value: unknown): value is BinaryStageFinalizeResponse {
  const candidate = value as { success?: unknown; error?: unknown; url?: unknown };
  return (
    isStageResponse(value) &&
    ((candidate.success === false && typeof candidate.error === 'string') ||
      (candidate.success === true &&
        typeof candidate.url === 'string' &&
        candidate.url.startsWith('blob:')))
  );
}

async function sendStageMessage<T extends BinaryStageResponse | BinaryStageFinalizeResponse>(
  message:
    | OffscreenBinaryStageBeginMessage
    | OffscreenBinaryStageAppendMessage
    | OffscreenBinaryStageFinalizeMessage,
  valid: (value: unknown) => value is T
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response: unknown = await Promise.race([
      chrome.runtime.sendMessage(message),
      new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), BINARY_STAGE_MESSAGE_TIMEOUT_MS);
      }),
    ]);
    return valid(response) ? response : undefined;
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withShortStageLease<T>(operation: () => Promise<T>): Promise<T> {
  let lease: OffscreenLease | undefined;
  try {
    lease = await acquireOffscreenLeaseForStagedBinaryAsset();
    return await operation();
  } finally {
    lease?.release();
  }
}

function archiveBinaryDownloadPath(
  message: Extract<ExtensionMessage, { action: 'commitStagedBinaryAsset' }>
): string {
  return [
    '_liska-archive',
    message.conversationKey,
    message.captureId,
    message.descriptor.relativePath,
  ].join('/');
}

function downloadPathMatches(filename: unknown, expectedRelativePath: string): boolean {
  if (typeof filename !== 'string') return false;
  const normalized = filename.replace(/\\/g, '/');
  return normalized.endsWith(`/${expectedRelativePath}`);
}

async function confirmBinaryDownloadPath(
  outcome: ArchiveDownloadOutcome,
  expectedRelativePath: string
): Promise<boolean> {
  if (outcome.downloadId === undefined) return false;
  try {
    const downloads = await chrome.downloads.search({ id: outcome.downloadId });
    const item = downloads.find(download => download.id === outcome.downloadId);
    return downloadPathMatches(item?.filename, expectedRelativePath);
  } catch {
    return false;
  }
}

interface BinaryDownloadResult {
  result: OutputResult;
  terminal: boolean;
  cleanupDeferred: boolean;
  recovery?: StagedBinaryDownloadRecoveryRecord;
}

// eslint-disable-next-line max-lines-per-function -- timeout, durable registration, and late callback share ownership.
async function downloadStagedBinaryAsset(
  blobUrl: string,
  message: Extract<ExtensionMessage, { action: 'commitStagedBinaryAsset' }>,
  onLateTerminal: () => Promise<void>,
  onRecoveryUpdate: (record: StagedBinaryDownloadRecoveryRecord | undefined) => void
): Promise<BinaryDownloadResult> {
  const expectedRelativePath = archiveBinaryDownloadPath(message);
  let outcome: ArchiveDownloadOutcome;
  let recovery: StagedBinaryDownloadRecoveryRecord | undefined;
  let cleanupDeferred = false;
  const provisional: StagedBinaryDownloadRecoveryRecord = {
    downloadId: null,
    stageId: message.stageId,
    blobUrl,
    createdAt: Date.now(),
  };
  const canRecoverDurably = isStagedBinaryDownloadRecoveryRecord(provisional);
  if (canRecoverDurably) {
    if (await rememberStagedBinaryDownloadRecovery(provisional)) {
      recovery = provisional;
      onRecoveryUpdate(recovery);
    } else {
      cleanupDeferred = true;
    }
  }
  try {
    outcome = await downloadArchiveBlob(
      blobUrl,
      expectedRelativePath,
      onLateTerminal,
      async downloadId => {
        if (!recovery || recovery.downloadId !== null) {
          cleanupDeferred = cleanupDeferred || canRecoverDurably;
          return;
        }
        const assigned = await assignStagedBinaryDownloadRecoveryId(recovery, downloadId);
        if (!assigned) {
          cleanupDeferred = true;
          return;
        }
        recovery = assigned;
        onRecoveryUpdate(recovery);
      }
    );
  } catch {
    return {
      terminal: true,
      cleanupDeferred,
      recovery,
      result: { destination: 'file', success: false, error: 'binary-download-start-failed' },
    };
  }
  if (outcome.error) {
    return {
      terminal: outcome.terminal,
      cleanupDeferred,
      recovery,
      result: {
        destination: 'file',
        success: false,
        error:
          outcome.error === 'Archive download was interrupted'
            ? 'binary-download-interrupted'
            : 'binary-download-failed',
      },
    };
  }
  if (!outcome.terminal || !(await confirmBinaryDownloadPath(outcome, expectedRelativePath))) {
    return {
      terminal: outcome.terminal,
      cleanupDeferred,
      recovery,
      result: {
        destination: 'file',
        success: false,
        error: 'binary-download-path-unconfirmed',
      },
    };
  }
  return {
    terminal: true,
    cleanupDeferred,
    recovery,
    result: { destination: 'file', success: true },
  };
}

async function saveStagedBinaryAssetToObsidian(
  blobUrl: string,
  message: Extract<ExtensionMessage, { action: 'commitStagedBinaryAsset' }>,
  settings: ExtensionSettings
): Promise<OutputResult> {
  try {
    const result = await handleSaveStagedBinaryAsset(settings, {
      source: message.source,
      captureId: message.captureId,
      conversationKey: message.conversationKey,
      descriptor: message.descriptor,
      blobUrl,
    });
    return {
      destination: 'obsidian',
      success: result.success,
      ...(result.error && { error: result.error }),
    };
  } catch {
    return { destination: 'obsidian', success: false, error: 'binary-obsidian-write-failed' };
  }
}

async function releaseBinaryStage(
  stageId: string,
  blobUrl: string,
  lease: OffscreenLease
): Promise<boolean> {
  try {
    return await releaseStagedBinaryStage(stageId, blobUrl, lease);
  } finally {
    lease.release();
  }
}

function withCleanupWarning(results: OutputResult[]): OutputResult[] {
  return results.map(result => ({ ...result, warning: 'binary-stage-cleanup-deferred' }));
}

interface FinalizedBinaryStage {
  lease: OffscreenLease;
  blobUrl: string;
}

async function finalizeBinaryStage(
  message: Extract<ExtensionMessage, { action: 'commitStagedBinaryAsset' }>
): Promise<{ stage?: FinalizedBinaryStage; cleanupDeferred: boolean }> {
  let lease: OffscreenLease | undefined;
  try {
    lease = await acquireOffscreenLeaseForStagedBinaryAsset();
    const request: OffscreenBinaryStageFinalizeMessage = {
      action: 'binaryStageFinalize',
      target: 'offscreen',
      stageId: message.stageId,
      descriptor: message.descriptor,
    };
    const finalized = await sendStageMessage(request, isStageFinalizeResponse);
    if (finalized?.success) {
      return { stage: { lease, blobUrl: finalized.url }, cleanupDeferred: false };
    }
  } catch {
    // The exact abort below remains the authoritative bounded cleanup attempt.
  }
  const cleaned = await abortStagedBinaryStage(message.stageId, lease);
  lease?.release();
  return { cleanupDeferred: !cleaned };
}

function binaryOutputResponse(results: OutputResult[]): MultiOutputResponse {
  return {
    results,
    allSuccessful: results.every(output => output.success),
    anySuccessful: results.some(output => output.success),
  };
}

/* The release gate and its late Downloads callback must share monotonic state. */
// eslint-disable-next-line max-lines-per-function -- destination, durable recovery, and release state are one lifecycle.
async function commitStagedBinaryAsset(
  message: Extract<ExtensionMessage, { action: 'commitStagedBinaryAsset' }>,
  settings: ExtensionSettings
): Promise<MultiOutputResponse> {
  const finalized = await finalizeBinaryStage(message);
  if (!finalized.stage) return failedBinaryCommit(message, finalized.cleanupDeferred);
  const { lease, blobUrl } = finalized.stage;
  let destinationsFinished = false;
  let downloadTerminal = !message.outputs.includes('file');
  let fileDownloadStarted = false;
  let released = false;
  let cleanupConfirmed: boolean | undefined;
  let recoveryRecord: StagedBinaryDownloadRecoveryRecord | undefined;
  let recoveryRegistrationFailed = false;
  const clearRecoveryAfterConfirmedCleanup = async (): Promise<void> => {
    if (cleanupConfirmed === true && recoveryRecord) {
      await forgetStagedBinaryDownloadRecovery(recoveryRecord);
    }
  };
  const relinquishDeferredRecovery = (): void => {
    if (cleanupConfirmed === false && recoveryRecord) {
      relinquishStagedBinaryDownloadRecovery(recoveryRecord.stageId);
    }
  };
  const releaseWhenOwned = async (): Promise<boolean | undefined> => {
    if (released) {
      await clearRecoveryAfterConfirmedCleanup();
      return cleanupConfirmed;
    }
    if (!destinationsFinished || !downloadTerminal || !lease || !blobUrl) return undefined;
    released = true;
    try {
      cleanupConfirmed = await releaseBinaryStage(message.stageId, blobUrl, lease);
    } catch (error) {
      cleanupConfirmed = false;
      if (recoveryRecord) relinquishStagedBinaryDownloadRecovery(recoveryRecord.stageId);
      throw error;
    }
    await clearRecoveryAfterConfirmedCleanup();
    relinquishDeferredRecovery();
    return cleanupConfirmed;
  };

  try {
    const outputs = await Promise.all(
      message.outputs.map(async destination => {
        if (destination === 'obsidian') {
          return saveStagedBinaryAssetToObsidian(blobUrl, message, settings);
        }
        fileDownloadStarted = true;
        const download = await downloadStagedBinaryAsset(
          blobUrl,
          message,
          async () => {
            downloadTerminal = true;
            await releaseWhenOwned();
          },
          record => {
            recoveryRecord = record;
          }
        );
        recoveryRecord = download.recovery ?? recoveryRecord;
        recoveryRegistrationFailed = recoveryRegistrationFailed || download.cleanupDeferred;
        // A terminal event can race the timeout result: once latched by the
        // late callback, never overwrite ownership with the earlier `false`.
        downloadTerminal = downloadTerminal || download.terminal;
        return download.result;
      })
    );
    destinationsFinished = true;
    const cleaned = await releaseWhenOwned();
    const reportedOutputs =
      cleaned === false || recoveryRegistrationFailed ? withCleanupWarning(outputs) : outputs;
    return binaryOutputResponse(reportedOutputs);
  } catch {
    destinationsFinished = true;
    if (!fileDownloadStarted) downloadTerminal = true;
    const cleaned = await releaseWhenOwned();
    return failedBinaryCommit(message, cleaned === false);
  } finally {
    if (destinationsFinished && downloadTerminal) await releaseWhenOwned();
  }
}
function failedBinaryCommit(
  message: Extract<ExtensionMessage, { action: 'commitStagedBinaryAsset' }>,
  cleanupDeferred = false
): MultiOutputResponse {
  const results = message.outputs.map(
    destination =>
      ({
        destination,
        success: false,
        error: 'binary-stage-finalization-failed',
        ...(cleanupDeferred && { warning: 'binary-stage-cleanup-deferred' }),
      }) as OutputResult
  );
  return { results, allSuccessful: false, anySuccessful: false };
}

/** Route one small content-stage message without embedding whole asset bytes. */
export async function handleStagedBinaryAssetMessage(
  message: BinaryStageContentMessage,
  settings: ExtensionSettings
): Promise<BinaryStageResponse | MultiOutputResponse> {
  if (message.action === 'beginStagedBinaryAsset') {
    const request: OffscreenBinaryStageBeginMessage = {
      action: 'binaryStageBegin',
      target: 'offscreen',
      stageId: message.stageId,
      descriptor: message.descriptor,
    };
    return withShortStageLease(async () => {
      return (
        (await sendStageMessage(request, isStageResponse)) ?? {
          success: false,
          error: 'Binary stage operation failed',
        }
      );
    });
  }
  if (message.action === 'appendStagedBinaryAsset') {
    const request: OffscreenBinaryStageAppendMessage = {
      action: 'binaryStageAppend',
      target: 'offscreen',
      stageId: message.stageId,
      offset: message.offset,
      chunkBase64: message.chunkBase64,
    };
    return withShortStageLease(async () => {
      return (
        (await sendStageMessage(request, isStageResponse)) ?? {
          success: false,
          error: 'Binary stage operation failed',
        }
      );
    });
  }
  if (message.action === 'abortStagedBinaryAsset') {
    const cleaned = await abortStagedBinaryStage(message.stageId);
    return cleaned ? { success: true } : { success: false, error: 'binary-stage-cleanup-deferred' };
  }
  return commitStagedBinaryAsset(message, settings).catch(() => failedBinaryCommit(message));
}
