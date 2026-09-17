/** Durable, bounded recovery for a staged binary download outliving an MV3 worker. */

import { isSafeBinaryStageId } from '../lib/binary-asset-contract';
import type {
  BinaryStageResponse,
  OffscreenBinaryStageAbortMessage,
  OffscreenBinaryStageReleaseMessage,
} from '../lib/types';
import { acquireOffscreenLeaseForStagedBinaryAsset, type OffscreenLease } from './output-handlers';

const BINARY_STAGE_MESSAGE_TIMEOUT_MS = 10_000;
const RECOVERY_STORAGE_KEY = 'binary-stage-download-recovery-v1';
const RECOVERY_REGISTRY_LIMIT = 32;
const RECOVERY_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;
const RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface StagedBinaryDownloadRecoveryRecord {
  /** Null only until Chrome invokes the Downloads callback with its numeric ID. */
  downloadId: number | null;
  stageId: string;
  blobUrl: string;
  createdAt: number;
}

let registryMutationTail: Promise<void> = Promise.resolve();
let reconciliation: Promise<void> | undefined;
let recoveryListenerRegistered = false;
let recoveryStartupListenerRegistered = false;
// A live handler retains the stage through its whole destination lifecycle.
// A restarted MV3 worker gets a fresh empty set and can recover durable records.
const activeOwnedStageIds = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactOwnDataKeys(value: object, expected: readonly string[]): boolean {
  const ownKeys = Object.getOwnPropertyNames(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    ownKeys.length !== sortedExpected.length ||
    ownKeys.some((key, index) => key !== sortedExpected[index]) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return false;
  }
  return sortedExpected.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor;
  });
}

function extensionBlobPrefix(): string | undefined {
  try {
    const extensionRoot = chrome.runtime.getURL('');
    return typeof extensionRoot === 'string' && extensionRoot.startsWith('chrome-extension://')
      ? `blob:${extensionRoot}`
      : undefined;
  } catch {
    return undefined;
  }
}

function hasSafeRecoveryTimestamp(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= Date.now() + RECOVERY_FUTURE_SKEW_MS
  );
}

function isCurrentExtensionBlobUrl(value: unknown): value is string {
  const blobPrefix = extensionBlobPrefix();
  return typeof value === 'string' && blobPrefix !== undefined && value.startsWith(blobPrefix);
}

function copyRecord(
  record: StagedBinaryDownloadRecoveryRecord
): StagedBinaryDownloadRecoveryRecord {
  return {
    downloadId: record.downloadId,
    stageId: record.stageId,
    blobUrl: record.blobUrl,
    createdAt: record.createdAt,
  };
}

export function isStagedBinaryDownloadRecoveryRecord(
  value: unknown
): value is StagedBinaryDownloadRecoveryRecord {
  if (
    !isRecord(value) ||
    !hasExactOwnDataKeys(value, ['downloadId', 'stageId', 'blobUrl', 'createdAt'])
  ) {
    return false;
  }
  try {
    const record = value as Record<string, unknown>;
    return (
      (record.downloadId === null ||
        (Number.isSafeInteger(record.downloadId) && (record.downloadId as number) > 0)) &&
      isSafeBinaryStageId(record.stageId) &&
      isCurrentExtensionBlobUrl(record.blobUrl) &&
      hasSafeRecoveryTimestamp(record.createdAt)
    );
  } catch {
    return false;
  }
}

function hasDuplicateOwnership(records: readonly StagedBinaryDownloadRecoveryRecord[]): boolean {
  const downloadIds = new Set<number>();
  const stageIds = new Set<string>();
  for (const record of records) {
    if (
      (record.downloadId !== null && downloadIds.has(record.downloadId)) ||
      stageIds.has(record.stageId)
    ) {
      return true;
    }
    if (record.downloadId !== null) downloadIds.add(record.downloadId);
    stageIds.add(record.stageId);
  }
  return false;
}

async function readRecoveryRegistry(): Promise<StagedBinaryDownloadRecoveryRecord[] | undefined> {
  try {
    const stored = await chrome.storage.local.get(RECOVERY_STORAGE_KEY);
    if (!isRecord(stored)) return undefined;
    const raw = Object.getOwnPropertyDescriptor(stored, RECOVERY_STORAGE_KEY)?.value;
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > RECOVERY_REGISTRY_LIMIT) return undefined;
    if (!raw.every(isStagedBinaryDownloadRecoveryRecord)) return undefined;
    const records = raw.map(copyRecord);
    return hasDuplicateOwnership(records) ? undefined : records;
  } catch {
    return undefined;
  }
}

async function writeRecoveryRegistry(
  records: readonly StagedBinaryDownloadRecoveryRecord[]
): Promise<void> {
  if (records.length > RECOVERY_REGISTRY_LIMIT) throw new Error('recovery registry limit exceeded');
  await chrome.storage.local.set({ [RECOVERY_STORAGE_KEY]: records.map(copyRecord) });
}

function queueRegistryMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const operation = registryMutationTail.then(mutation, mutation);
  registryMutationTail = operation.then(
    () => undefined,
    () => undefined
  );
  return operation;
}

function sameRecord(
  left: StagedBinaryDownloadRecoveryRecord,
  right: StagedBinaryDownloadRecoveryRecord
): boolean {
  return (
    left.downloadId === right.downloadId &&
    left.stageId === right.stageId &&
    left.blobUrl === right.blobUrl &&
    left.createdAt === right.createdAt
  );
}

/** Persist only the exact ownership needed to finish a future OPFS cleanup. */
export async function rememberStagedBinaryDownloadRecovery(
  record: StagedBinaryDownloadRecoveryRecord
): Promise<boolean> {
  if (!isStagedBinaryDownloadRecoveryRecord(record)) return false;
  activeOwnedStageIds.add(record.stageId);
  try {
    const remembered = await queueRegistryMutation(async () => {
      const records = await readRecoveryRegistry();
      if (!records) return false;
      if (records.some(existing => sameRecord(existing, record))) return true;
      if (
        records.length >= RECOVERY_REGISTRY_LIMIT ||
        records.some(
          existing =>
            (existing.downloadId !== null &&
              record.downloadId !== null &&
              existing.downloadId === record.downloadId) ||
            existing.stageId === record.stageId
        )
      ) {
        return false;
      }
      await writeRecoveryRegistry([...records, copyRecord(record)]);
      return true;
    });
    if (remembered) activeOwnedStageIds.add(record.stageId);
    if (!remembered) activeOwnedStageIds.delete(record.stageId);
    return remembered;
  } catch {
    activeOwnedStageIds.delete(record.stageId);
    return false;
  }
}

/** Atomically replace the exact provisional record after Chrome assigns its Downloads ID. */
export async function assignStagedBinaryDownloadRecoveryId(
  provisional: StagedBinaryDownloadRecoveryRecord,
  downloadId: number
): Promise<StagedBinaryDownloadRecoveryRecord | undefined> {
  if (
    provisional.downloadId !== null ||
    !isStagedBinaryDownloadRecoveryRecord(provisional) ||
    !Number.isSafeInteger(downloadId) ||
    downloadId <= 0
  ) {
    return undefined;
  }
  try {
    const assigned = await queueRegistryMutation(async () => {
      const records = await readRecoveryRegistry();
      if (!records || records.some(record => record.downloadId === downloadId)) return undefined;
      const index = records.findIndex(record => sameRecord(record, provisional));
      if (index < 0) return undefined;
      const next = { ...copyRecord(provisional), downloadId };
      await writeRecoveryRegistry([...records.slice(0, index), next, ...records.slice(index + 1)]);
      return next;
    });
    return assigned;
  } catch {
    return undefined;
  } finally {
    activeOwnedStageIds.add(provisional.stageId);
  }
}

/** Remove a record only after its exact stage cleanup has been confirmed. */
export async function forgetStagedBinaryDownloadRecovery(
  record: StagedBinaryDownloadRecoveryRecord
): Promise<boolean> {
  if (!isStagedBinaryDownloadRecoveryRecord(record)) return false;
  try {
    return await queueRegistryMutation(async () => {
      const records = await readRecoveryRegistry();
      if (!records) return false;
      const remaining = records.filter(existing => !sameRecord(existing, record));
      if (remaining.length === records.length) return true;
      await writeRecoveryRegistry(remaining);
      return true;
    });
  } catch {
    return false;
  } finally {
    activeOwnedStageIds.delete(record.stageId);
  }
}

/** Hand durable ownership back to top-level recovery once this handler no longer owns the Blob. */
export function relinquishStagedBinaryDownloadRecovery(stageId: string): void {
  if (isSafeBinaryStageId(stageId)) activeOwnedStageIds.delete(stageId);
}

function isStageResponse(value: unknown): value is BinaryStageResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { success?: unknown }).success === 'boolean'
  );
}

async function sendStageMessage(
  message: OffscreenBinaryStageReleaseMessage | OffscreenBinaryStageAbortMessage
): Promise<BinaryStageResponse | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response: unknown = await Promise.race([
      chrome.runtime.sendMessage(message),
      new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), BINARY_STAGE_MESSAGE_TIMEOUT_MS);
      }),
    ]);
    return isStageResponse(response) ? response : undefined;
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withRecoveryLease<T>(
  borrowedLease: OffscreenLease | undefined,
  operation: (lease: OffscreenLease) => Promise<T>
): Promise<T> {
  let lease = borrowedLease;
  let ownsLease = false;
  try {
    if (!lease) {
      lease = await acquireOffscreenLeaseForStagedBinaryAsset();
      ownsLease = true;
    }
    return await operation(lease);
  } finally {
    if (ownsLease) lease?.release();
  }
}

/** Abort one validated stage; an optional borrowed lease remains caller-owned. */
export async function abortStagedBinaryStage(
  stageId: string,
  borrowedLease?: OffscreenLease
): Promise<boolean> {
  if (!isSafeBinaryStageId(stageId)) return false;
  try {
    return await withRecoveryLease(borrowedLease, async () => {
      const message: OffscreenBinaryStageAbortMessage = {
        action: 'binaryStageAbort',
        target: 'offscreen',
        stageId,
      };
      return (await sendStageMessage(message))?.success === true;
    });
  } catch {
    return false;
  }
}

/** Release an exact Blob stage, retaining the existing abort fallback semantics. */
export async function releaseStagedBinaryStage(
  stageId: string,
  blobUrl: string,
  borrowedLease?: OffscreenLease
): Promise<boolean> {
  if (!isSafeBinaryStageId(stageId)) return false;
  if (typeof blobUrl !== 'string' || !blobUrl.startsWith('blob:')) {
    return abortStagedBinaryStage(stageId, borrowedLease);
  }
  try {
    return await withRecoveryLease(borrowedLease, async lease => {
      const message: OffscreenBinaryStageReleaseMessage = {
        action: 'binaryStageRelease',
        target: 'offscreen',
        stageId,
        url: blobUrl,
      };
      const released = (await sendStageMessage(message))?.success === true;
      return released || (await abortStagedBinaryStage(stageId, lease));
    });
  } catch {
    return false;
  }
}

function isTerminalDownloadState(state: string | undefined): state is 'complete' | 'interrupted' {
  return state === 'complete' || state === 'interrupted';
}

async function downloadReachedTerminalOrIsMissing(
  record: StagedBinaryDownloadRecoveryRecord
): Promise<boolean | undefined> {
  // The original download has already failed its bounded confirmation path.
  // A 64 MiB asset cannot legitimately require another full day, so an aged
  // in-progress record must not retain private OPFS bytes indefinitely.
  if (Date.now() - record.createdAt >= RECOVERY_MAX_AGE_MS) return true;
  if (activeOwnedStageIds.has(record.stageId)) return false;
  // A live worker with no ownership marker is no longer waiting for this
  // callback; after a worker restart a null ID therefore proves callback loss.
  if (record.downloadId === null) return true;
  try {
    const downloads = await chrome.downloads.search({ id: record.downloadId });
    const download = downloads.find(item => item.id === record.downloadId);
    if (!download) return true;
    if (download.state === 'in_progress') return false;
    return isTerminalDownloadState(download.state) ? true : false;
  } catch {
    return undefined;
  }
}

async function reconcileRecoveryRegistry(): Promise<void> {
  const records = await readRecoveryRegistry();
  if (!records) return;
  for (const record of records) {
    const terminalOrMissing = await downloadReachedTerminalOrIsMissing(record);
    if (terminalOrMissing !== true) continue;
    if (await releaseStagedBinaryStage(record.stageId, record.blobUrl)) {
      activeOwnedStageIds.delete(record.stageId);
      await forgetStagedBinaryDownloadRecovery(record);
    }
  }
}

/** Bounded per-worker reconciliation; failures retain ownership for a later worker. */
export function reconcileStagedBinaryDownloadRecovery(): Promise<void> {
  if (reconciliation) return reconciliation;
  reconciliation = reconcileRecoveryRegistry().finally(() => {
    reconciliation = undefined;
  });
  return reconciliation;
}

function onDownloadChanged(delta: chrome.downloads.DownloadDelta): void {
  if (isTerminalDownloadState(delta.state?.current)) void reconcileStagedBinaryDownloadRecovery();
}

function onBrowserStartup(): void {
  void reconcileStagedBinaryDownloadRecovery();
}

/** Call synchronously during service-worker evaluation so terminal events wake a fresh worker. */
export function startStagedBinaryDownloadRecovery(): void {
  if (!recoveryListenerRegistered) {
    chrome.downloads.onChanged.addListener(onDownloadChanged);
    recoveryListenerRegistered = true;
  }
  const startup = chrome.runtime.onStartup;
  if (!recoveryStartupListenerRegistered && startup && typeof startup.addListener === 'function') {
    startup.addListener(onBrowserStartup);
    recoveryStartupListenerRegistered = true;
  }
  void reconcileStagedBinaryDownloadRecovery();
}
