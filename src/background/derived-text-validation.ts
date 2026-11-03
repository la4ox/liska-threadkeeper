/** Exact derived text transport checks before JSON sizing can invoke getters. */
import { isDerivedTextArtifact } from '../lib/derived-text-presentation-contract';
import { isSerializedSyncSettingsSnapshot } from '../lib/sync-settings-snapshot';
import type { ExtensionMessage } from '../lib/types';

function exactOwnData(value: object, expected: readonly string[]): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  const keys = Reflect.ownKeys(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    keys.length === expected.length &&
    expected.every(
      key =>
        keys.includes(key) &&
        Object.getOwnPropertyDescriptor(value, key)?.enumerable === true &&
        'value' in Object.getOwnPropertyDescriptor(value, key)!
    )
  );
}

function exactFileOutput(value: unknown): value is ['file'] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== 2 ||
    value.length !== 1
  )
    return false;
  const item = Object.getOwnPropertyDescriptor(value, '0');
  return !!item && item.enumerable === true && 'value' in item && item.value === 'file';
}

export function validatePersistDerivedTextMessage(
  message: Extract<ExtensionMessage, { action: 'persistDerivedTextPresentation' }>
): boolean {
  if (
    !exactOwnData(message, [
      'action',
      'reportDurableWriteOutcome',
      'source',
      'captureId',
      'conversationKey',
      'expectedSyncSettingsSnapshot',
      'artifact',
      'outputs',
    ]) ||
    (message.source !== 'chatgpt' && message.source !== 'deepseek')
  )
    return false;
  const capturePattern =
    message.source === 'chatgpt'
      ? /^capture-chatgpt-[A-Za-z0-9][A-Za-z0-9_-]{0,239}$/
      : /^capture-deepseek-[A-Za-z0-9][A-Za-z0-9_-]{0,235}$/;
  return (
    message.action === 'persistDerivedTextPresentation' &&
    message.reportDurableWriteOutcome === true &&
    capturePattern.test(message.captureId) &&
    /^[a-f0-9]{64}$/.test(message.conversationKey) &&
    isSerializedSyncSettingsSnapshot(message.expectedSyncSettingsSnapshot) &&
    isDerivedTextArtifact(message.artifact) &&
    exactFileOutput(message.outputs)
  );
}
