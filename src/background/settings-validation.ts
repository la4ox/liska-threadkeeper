/** Exact popup settings transport validation before the worker accepts a save. */

import { VALID_MESSAGE_FORMATS } from '../lib/constants';
import type { PopupSettingsUpdate } from '../lib/types';

const REQUIRED_SETTINGS_UPDATE_KEYS = [
  'obsidianUrl',
  'vaultPath',
  'templateOptions',
  'outputOptions',
  'enableAutoScroll',
  'enableAppendMode',
  'enableToolContent',
  'enableImageExport',
  'enableChatGptOpaqueProbe',
  'enableChatGptOpaqueReplay',
  'imageVaultPath',
  'flattenLargeCallouts',
  'maxCalloutLines',
] as const;

const OPTIONAL_SETTINGS_UPDATE_KEYS = ['obsidianApiKey'] as const;

const REQUIRED_TEMPLATE_OPTION_KEYS = [
  'includeId',
  'includeTitle',
  'includeTags',
  'includeSource',
  'includeDates',
  'includeMessageCount',
  'messageFormat',
  'userCalloutType',
  'assistantCalloutType',
] as const;

const OPTIONAL_TEMPLATE_OPTION_KEYS = [
  'includeQuestionHeaders',
  'timezone',
  'filenameScheme',
] as const;

function hasExactOwnKeys(value: object, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length) return false;
  return expected.every(expectedKey => keys.some(key => key === expectedKey));
}

function hasRequiredAndAllowedOwnKeys(
  value: object,
  required: readonly string[],
  optional: readonly string[]
): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    required.every(requiredKey => keys.some(key => key === requiredKey)) &&
    keys.every(key => typeof key === 'string' && (required.includes(key) || optional.includes(key)))
  );
}

function validateOutputOptions(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!hasExactOwnKeys(value, ['obsidian', 'file', 'clipboard'])) return false;
  const options = value as Record<string, unknown>;
  return (
    typeof options.obsidian === 'boolean' &&
    typeof options.file === 'boolean' &&
    typeof options.clipboard === 'boolean'
  );
}

// eslint-disable-next-line complexity -- Keep the transport shape explicit at the message boundary.
function validateTemplateOptionsForSettingsUpdate(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (
    !hasRequiredAndAllowedOwnKeys(
      value,
      REQUIRED_TEMPLATE_OPTION_KEYS,
      OPTIONAL_TEMPLATE_OPTION_KEYS
    )
  ) {
    return false;
  }

  const options = value as Record<string, unknown>;
  return (
    typeof options.includeId === 'boolean' &&
    typeof options.includeTitle === 'boolean' &&
    typeof options.includeTags === 'boolean' &&
    typeof options.includeSource === 'boolean' &&
    typeof options.includeDates === 'boolean' &&
    typeof options.includeMessageCount === 'boolean' &&
    typeof options.messageFormat === 'string' &&
    VALID_MESSAGE_FORMATS.includes(
      options.messageFormat as (typeof VALID_MESSAGE_FORMATS)[number]
    ) &&
    typeof options.userCalloutType === 'string' &&
    typeof options.assistantCalloutType === 'string' &&
    (options.includeQuestionHeaders === undefined ||
      typeof options.includeQuestionHeaders === 'boolean') &&
    (options.timezone === undefined || typeof options.timezone === 'string') &&
    (options.filenameScheme === undefined ||
      options.filenameScheme === 'title-id' ||
      options.filenameScheme === 'title-date')
  );
}

// eslint-disable-next-line complexity -- Keep the transport shape explicit at the message boundary.
export function validateSettingsUpdate(value: unknown): value is PopupSettingsUpdate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (
    !hasRequiredAndAllowedOwnKeys(
      value,
      REQUIRED_SETTINGS_UPDATE_KEYS,
      OPTIONAL_SETTINGS_UPDATE_KEYS
    )
  ) {
    return false;
  }

  const settings = value as Record<string, unknown>;
  return (
    (!Object.prototype.hasOwnProperty.call(settings, 'obsidianApiKey') ||
      typeof settings.obsidianApiKey === 'string') &&
    typeof settings.obsidianUrl === 'string' &&
    typeof settings.vaultPath === 'string' &&
    validateTemplateOptionsForSettingsUpdate(settings.templateOptions) &&
    validateOutputOptions(settings.outputOptions) &&
    typeof settings.enableAutoScroll === 'boolean' &&
    typeof settings.enableAppendMode === 'boolean' &&
    typeof settings.enableToolContent === 'boolean' &&
    typeof settings.enableImageExport === 'boolean' &&
    typeof settings.enableChatGptOpaqueProbe === 'boolean' &&
    typeof settings.enableChatGptOpaqueReplay === 'boolean' &&
    typeof settings.imageVaultPath === 'string' &&
    typeof settings.flattenLargeCallouts === 'boolean' &&
    Number.isSafeInteger(settings.maxCalloutLines) &&
    (settings.maxCalloutLines as number) > 0
  );
}
