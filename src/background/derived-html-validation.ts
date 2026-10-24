/** Exact derived transport checks run before JSON sizing can invoke getters. */
import { isDerivedHtmlArtifact } from '../lib/derived-presentation-contract';
import { isSerializedSyncSettingsSnapshot } from '../lib/sync-settings-snapshot';
import type { ExtensionMessage } from '../lib/types';

function hasExactOwnKeys(value: object, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && expected.every(key => keys.includes(key));
}

function hasExactOwnDataKeys(value: object, expected: readonly string[]): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    hasExactOwnKeys(value, expected) &&
    expected.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable;
    })
  );
}

function isDerivedHtmlFileOutput(outputs: unknown): boolean {
  if (
    !Array.isArray(outputs) ||
    Object.getPrototypeOf(outputs) !== Array.prototype ||
    !hasExactOwnKeys(outputs, ['0', 'length'])
  )
    return false;
  const output = Object.getOwnPropertyDescriptor(outputs, '0');
  return (
    outputs.length === 1 &&
    !!output &&
    'value' in output &&
    output.value === 'file' &&
    output.enumerable === true
  );
}

export function validatePersistDerivedHtmlMessage(
  message: Extract<ExtensionMessage, { action: 'persistDerivedHtmlPresentation' }>
): boolean {
  if (
    !hasExactOwnDataKeys(message, [
      'action',
      'reportDurableWriteOutcome',
      'source',
      'captureId',
      'conversationKey',
      'expectedSyncSettingsSnapshot',
      'artifact',
      'outputs',
    ])
  )
    return false;
  if (message.source !== 'chatgpt' && message.source !== 'deepseek') return false;
  const capturePattern =
    message.source === 'chatgpt'
      ? /^capture-chatgpt-[A-Za-z0-9][A-Za-z0-9_-]{0,239}$/
      : /^capture-deepseek-[A-Za-z0-9][A-Za-z0-9_-]{0,235}$/;
  return (
    message.reportDurableWriteOutcome === true &&
    typeof message.captureId === 'string' &&
    capturePattern.test(message.captureId) &&
    typeof message.conversationKey === 'string' &&
    /^[a-f0-9]{64}$/.test(message.conversationKey) &&
    isSerializedSyncSettingsSnapshot(message.expectedSyncSettingsSnapshot) &&
    isDerivedHtmlArtifact(message.artifact) &&
    isDerivedHtmlFileOutput(message.outputs)
  );
}
