/** Durable, bounded recovery for a raw/canonical archive download outliving MV3. */

import { isSafeArchiveStageId } from '../lib/archive-stage-contract';
import type {
  ArchiveStageResponse,
  OffscreenArchiveStageAbortMessage,
  OffscreenArchiveStageReleaseMessage,
} from '../lib/types';
import { acquireOffscreenLeaseForArchiveStage, type OffscreenLease } from './output-handlers';

const ARCHIVE_STAGE_MESSAGE_TIMEOUT_MS = 10_000;
const RECOVERY_STORAGE_KEY = 'archive-stage-download-recovery-v1';
const RECOVERY_REGISTRY_LIMIT = 20;
const RECOVERY_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;
const RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface ArchiveStageDownloadRecoveryRecord {
  /** Null only until Chrome invokes Downloads' callback with its numeric ID. */
  downloadId: number | null;
  stageId: string;
  blobUrl: string;
  createdAt: number;
}

let registryMutationTail: Promise<void> = Promise.resolve();
let reconciliation: Promise<void> | undefined;
let recoveryListenerRegistered = false;
let recoveryStartupListenerRegistered = false;
let recoveryInstallListenerRegistered = false;
// A live commit retains its stage throughout its output lifecycle. A fresh
// MV3 worker has no marker and therefore owns only durable records.
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
  record: ArchiveStageDownloadRecoveryRecord
): ArchiveStageDownloadRecoveryRecord {
  return {
    downloadId: record.downloadId,
    stageId: record.stageId,
    blobUrl: record.blobUrl,
    createdAt: record.createdAt,
  };
}

export function isArchiveStageDownloadRecoveryRecord(
  value: unknown
): value is ArchiveStageDownloadRecoveryRecord {
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
      isSafeArchiveStageId(record.stageId) &&
      isCurrentExtensionBlobUrl(record.blobUrl) &&
      hasSafeRecoveryTimestamp(record.createdAt)
    );
  } catch {
    return false;
  }
}

function hasDuplicateOwnership(records: readonly ArchiveStageDownloadRecoveryRecord[]): boolean {
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

async function readRecoveryRegistry(): Promise<ArchiveStageDownloadRecoveryRecord[] | undefined> {
  try {
    const stored = await chrome.storage.local.get(RECOVERY_STORAGE_KEY);
    if (!isRecord(stored)) return undefined;
    const raw = Object.getOwnPropertyDescriptor(stored, RECOVERY_STORAGE_KEY)?.value;
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > RECOVERY_REGISTRY_LIMIT) return undefined;
    if (!raw.every(isArchiveStageDownloadRecoveryRecord)) return undefined;
    const records = raw.map(copyRecord);
    return hasDuplicateOwnership(records) ? undefined : records;
  } catch {
    return undefined;
  }
}

async function writeRecoveryRegistry(
  records: readonly ArchiveStageDownloadRecoveryRecord[]
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
  left: ArchiveStageDownloadRecoveryRecord,
  right: ArchiveStageDownloadRecoveryRecord
): boolean {
  return (
    left.downloadId === right.downloadId &&
    left.stageId === right.stageId &&
    left.blobUrl === right.blobUrl &&
    left.createdAt === right.createdAt
  );
}

/** Persist only the exact ownership needed to finish future OPFS cleanup. */
export async function rememberArchiveStageDownloadRecovery(
  record: ArchiveStageDownloadRecoveryRecord
): Promise<boolean> {
  if (!isArchiveStageDownloadRecoveryRecord(record)) return false;
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
    return remembered;
  } catch {
    return false;
  }
}

/** Atomically replace the exact provisional record after Chrome assigns its ID. */
export async function assignArchiveStageDownloadRecoveryId(
  provisional: ArchiveStageDownloadRecoveryRecord,
  downloadId: number
): Promise<ArchiveStageDownloadRecoveryRecord | undefined> {
  if (
    provisional.downloadId !== null ||
    !isArchiveStageDownloadRecoveryRecord(provisional) ||
    !Number.isSafeInteger(downloadId) ||
    downloadId <= 0
  ) {
    return undefined;
  }
  try {
    return await queueRegistryMutation(async () => {
      const records = await readRecoveryRegistry();
      if (!records || records.some(record => record.downloadId === downloadId)) return undefined;
      const index = records.findIndex(record => sameRecord(record, provisional));
      if (index < 0) return undefined;
      const next = { ...copyRecord(provisional), downloadId };
      await writeRecoveryRegistry([...records.slice(0, index), next, ...records.slice(index + 1)]);
      return next;
    });
  } catch {
    return undefined;
  } finally {
    activeOwnedStageIds.add(provisional.stageId);
  }
}

/** Remove a record only after its exact stage cleanup has been confirmed. */
export async function forgetArchiveStageDownloadRecovery(
  record: ArchiveStageDownloadRecoveryRecord
): Promise<boolean> {
  if (!isArchiveStageDownloadRecoveryRecord(record)) return false;
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

/** Hand durable ownership back to top-level recovery once this handler is done. */
export function relinquishArchiveStageDownloadRecovery(stageId: string): void {
  if (isSafeArchiveStageId(stageId)) activeOwnedStageIds.delete(stageId);
}

function isStageResponse(value: unknown): value is ArchiveStageResponse {
  if (!isRecord(value)) return false;
  return value.success === true
    ? hasExactOwnDataKeys(value, ['success'])
    : value.success === false &&
        hasExactOwnDataKeys(value, ['success', 'error']) &&
        typeof value.error === 'string';
}

async function sendStageMessage(
  message: OffscreenArchiveStageReleaseMessage | OffscreenArchiveStageAbortMessage
): Promise<ArchiveStageResponse | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response: unknown = await Promise.race([
      chrome.runtime.sendMessage(message),
      new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), ARCHIVE_STAGE_MESSAGE_TIMEOUT_MS);
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
      lease = await acquireOffscreenLeaseForArchiveStage();
      ownsLease = true;
    }
    return await operation(lease);
  } finally {
    if (ownsLease) lease?.release();
  }
}

/** Abort one validated archive stage; an optional borrowed lease remains caller-owned. */
export async function abortArchiveStageDownloadRecovery(
  stageId: string,
  borrowedLease?: OffscreenLease
): Promise<boolean> {
  if (!isSafeArchiveStageId(stageId)) return false;
  try {
    return await withRecoveryLease(borrowedLease, async () => {
      const message: OffscreenArchiveStageAbortMessage = {
        action: 'archiveStageAbort',
        target: 'offscreen',
        stageId,
      };
      return (await sendStageMessage(message))?.success === true;
    });
  } catch {
    return false;
  }
}

/** Release one exact extension Blob, then fall back to the exact stage abort. */
export async function releaseArchiveStageDownloadRecovery(
  stageId: string,
  blobUrl: string,
  borrowedLease?: OffscreenLease
): Promise<boolean> {
  if (!isSafeArchiveStageId(stageId)) return false;
  if (!isCurrentExtensionBlobUrl(blobUrl)) {
    return abortArchiveStageDownloadRecovery(stageId, borrowedLease);
  }
  try {
    return await withRecoveryLease(borrowedLease, async lease => {
      const message: OffscreenArchiveStageReleaseMessage = {
        action: 'archiveStageRelease',
        target: 'offscreen',
        stageId,
        url: blobUrl,
      };
      const released = (await sendStageMessage(message))?.success === true;
      return released || (await abortArchiveStageDownloadRecovery(stageId, lease));
    });
  } catch {
    return false;
  }
}

function isTerminalDownloadState(state: string | undefined): state is 'complete' | 'interrupted' {
  return state === 'complete' || state === 'interrupted';
}

async function downloadReachedTerminalOrIsMissing(
  record: ArchiveStageDownloadRecoveryRecord
): Promise<boolean | undefined> {
  // A null callback ID is deliberately quarantined. It is neither proof of a
  // missing download nor authority to release private OPFS data before age-out.
  if (Date.now() - record.createdAt >= RECOVERY_MAX_AGE_MS) return true;
  if (activeOwnedStageIds.has(record.stageId)) return false;
  if (record.downloadId === null) return false;
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
    if (await releaseArchiveStageDownloadRecovery(record.stageId, record.blobUrl)) {
      activeOwnedStageIds.delete(record.stageId);
      await forgetArchiveStageDownloadRecovery(record);
    }
  }
}

/** Bounded per-worker reconciliation; failures retain ownership for another worker. */
export function reconcileArchiveStageDownloadRecovery(): Promise<void> {
  if (reconciliation) return reconciliation;
  reconciliation = reconcileRecoveryRegistry().finally(() => {
    reconciliation = undefined;
  });
  return reconciliation;
}

function onDownloadChanged(delta: chrome.downloads.DownloadDelta): void {
  if (isTerminalDownloadState(delta.state?.current)) void reconcileArchiveStageDownloadRecovery();
}

function onBrowserStartup(): void {
  void reconcileArchiveStageDownloadRecovery();
}

function onExtensionInstalled(): void {
  void reconcileArchiveStageDownloadRecovery();
}

/** Register synchronously during service-worker evaluation so terminal events wake MV3. */
export function startArchiveStageDownloadRecovery(): void {
  if (!recoveryListenerRegistered) {
    chrome.downloads.onChanged.addListener(onDownloadChanged);
    recoveryListenerRegistered = true;
  }
  const startup = chrome.runtime.onStartup;
  if (!recoveryStartupListenerRegistered && startup && typeof startup.addListener === 'function') {
    startup.addListener(onBrowserStartup);
    recoveryStartupListenerRegistered = true;
  }
  const installed = chrome.runtime.onInstalled;
  if (
    !recoveryInstallListenerRegistered &&
    installed &&
    typeof installed.addListener === 'function'
  ) {
    installed.addListener(onExtensionInstalled);
    recoveryInstallListenerRegistered = true;
  }
  void reconcileArchiveStageDownloadRecovery();
}
