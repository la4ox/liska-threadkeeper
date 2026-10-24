/** The branch action is a distinct own-data envelope, checked before JSON sizing. */
import { snapshotDerivedBranchHtmlArtifact } from '../lib/derived-branch-presentation-contract';
import { isSerializedSyncSettingsSnapshot } from '../lib/sync-settings-snapshot';
import type { ExtensionMessage } from '../lib/types';

type BranchHtmlMessage = Extract<
  ExtensionMessage,
  { action: 'persistDerivedBranchHtmlPresentation' }
>;

function snapshotOwnData(value: unknown, expected: readonly string[]) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  const keys = Reflect.ownKeys(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== expected.length ||
    keys.some(key => typeof key !== 'string' || !expected.includes(key))
  )
    return undefined;
  const data: Record<string, unknown> = Object.create(null);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return undefined;
    data[key] = descriptor.value;
  }
  return data;
}

function snapshotFileOnly(value: unknown): ['file'] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('0') || !keys.includes('length')) return undefined;
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  const item = Object.getOwnPropertyDescriptor(value, '0');
  return !!length &&
    'value' in length &&
    length.enumerable === false &&
    length.value === 1 &&
    !!item &&
    'value' in item &&
    item.enumerable === true &&
    item.value === 'file'
    ? ['file']
    : undefined;
}

/** Detach every caller-owned object before sizing, authorization or asynchronous work. */
export function snapshotPersistDerivedBranchHtmlMessage(
  value: unknown
): BranchHtmlMessage | undefined {
  try {
    const data = snapshotOwnData(value, [
      'action',
      'reportDurableWriteOutcome',
      'source',
      'captureId',
      'conversationKey',
      'expectedSyncSettingsSnapshot',
      'artifact',
      'outputs',
    ]);
    if (!data || (data.source !== 'chatgpt' && data.source !== 'deepseek')) return undefined;
    const capturePattern =
      data.source === 'chatgpt'
        ? /^capture-chatgpt-[A-Za-z0-9][A-Za-z0-9_-]{0,239}$/
        : /^capture-deepseek-[A-Za-z0-9][A-Za-z0-9_-]{0,235}$/;
    if (
      data.action !== 'persistDerivedBranchHtmlPresentation' ||
      data.reportDurableWriteOutcome !== true ||
      typeof data.captureId !== 'string' ||
      !capturePattern.test(data.captureId) ||
      typeof data.conversationKey !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data.conversationKey) ||
      !isSerializedSyncSettingsSnapshot(data.expectedSyncSettingsSnapshot)
    )
      return undefined;
    const artifact = snapshotDerivedBranchHtmlArtifact(data.artifact);
    const outputs = snapshotFileOnly(data.outputs);
    if (!artifact || !outputs) return undefined;
    return {
      action: 'persistDerivedBranchHtmlPresentation',
      reportDurableWriteOutcome: true,
      source: data.source,
      captureId: data.captureId,
      conversationKey: data.conversationKey,
      expectedSyncSettingsSnapshot: data.expectedSyncSettingsSnapshot,
      artifact,
      outputs,
    };
  } catch {
    return undefined;
  }
}

export function validatePersistDerivedBranchHtmlMessage(message: unknown): boolean {
  return snapshotPersistDerivedBranchHtmlMessage(message) !== undefined;
}
