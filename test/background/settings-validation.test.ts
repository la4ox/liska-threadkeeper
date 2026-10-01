import { describe, expect, it } from 'vitest';
import { validateSettingsUpdate } from '../../src/background/settings-validation';
import type { ExtensionSettings } from '../../src/lib/types';

const validSettings: ExtensionSettings = {
  obsidianApiKey: 'synthetic-test-key',
  obsidianUrl: 'http://127.0.0.1:27123',
  vaultPath: 'AI/deepseek',
  templateOptions: {
    includeId: true,
    includeTitle: true,
    includeTags: true,
    includeSource: true,
    includeDates: true,
    includeMessageCount: true,
    messageFormat: 'callout',
    userCalloutType: 'QUESTION',
    assistantCalloutType: 'NOTE',
  },
  outputOptions: { obsidian: true, file: true, clipboard: false },
  enableAutoScroll: false,
  enableAppendMode: false,
  enableToolContent: false,
  enableImageExport: true,
  enableChatGptOpaqueProbe: false,
  enableChatGptOpaqueReplay: false,
  imageVaultPath: 'AI/deepseek/images',
  flattenLargeCallouts: true,
  maxCalloutLines: 200,
};

describe('popup settings transport validation', () => {
  it('accepts exact valid settings, optional template fields, and an intentionally empty local key', () => {
    expect(validateSettingsUpdate(validSettings)).toBe(true);
    expect(
      validateSettingsUpdate({
        ...validSettings,
        obsidianApiKey: '',
        templateOptions: {
          ...validSettings.templateOptions,
          includeQuestionHeaders: false,
          timezone: 'UTC',
          filenameScheme: 'title-date',
        },
      })
    ).toBe(true);
  });

  it('accepts an omitted API key without making other settings optional', () => {
    const { obsidianApiKey: _unchangedKey, ...settings } = validSettings;
    expect(validateSettingsUpdate(settings)).toBe(true);
  });

  it.each([null, undefined, false, [], 'settings'])('rejects a non-record root: %s', value => {
    expect(validateSettingsUpdate(value)).toBe(false);
  });

  it.each(Object.keys(validSettings).filter(key => key !== 'obsidianApiKey'))(
    'rejects a missing required root setting: %s',
    missingKey => {
      const settings = Object.fromEntries(
        Object.entries(validSettings).filter(([key]) => key !== missingKey)
      );
      expect(validateSettingsUpdate(settings)).toBe(false);
    }
  );

  it('rejects extra and symbol keys at the root even when the API key is omitted', () => {
    const { obsidianApiKey: _unchangedKey, ...settings } = validSettings;
    expect(validateSettingsUpdate({ ...validSettings, unexpected: true })).toBe(false);
    expect(validateSettingsUpdate({ ...validSettings, [Symbol('extra')]: true })).toBe(false);
    expect(validateSettingsUpdate({ ...settings, unexpected: true })).toBe(false);
    expect(validateSettingsUpdate({ ...settings, [Symbol('extra')]: true })).toBe(false);
  });

  it.each([
    ['no template', null],
    ['array template', []],
    [
      'missing required field',
      Object.fromEntries(
        Object.entries(validSettings.templateOptions).filter(([key]) => key !== 'includeTitle')
      ),
    ],
    ['extra field', { ...validSettings.templateOptions, unexpected: true }],
    ['symbol field', { ...validSettings.templateOptions, [Symbol('extra')]: true }],
    ['wrong boolean', { ...validSettings.templateOptions, includeId: 'yes' }],
    ['wrong format', { ...validSettings.templateOptions, messageFormat: 'unknown' }],
    ['wrong callout type', { ...validSettings.templateOptions, userCalloutType: 2 }],
    ['wrong optional boolean', { ...validSettings.templateOptions, includeQuestionHeaders: 1 }],
    ['wrong timezone', { ...validSettings.templateOptions, timezone: false }],
    ['wrong filename scheme', { ...validSettings.templateOptions, filenameScheme: 'id' }],
  ])('rejects %s', (_label, templateOptions) => {
    expect(validateSettingsUpdate({ ...validSettings, templateOptions })).toBe(false);
  });

  it.each([
    null,
    [],
    { ...validSettings.outputOptions, file: 1 },
    { ...validSettings.outputOptions, extra: true },
  ])('rejects malformed output options: %s', outputOptions => {
    expect(validateSettingsUpdate({ ...validSettings, outputOptions })).toBe(false);
  });

  it.each([
    ['obsidianApiKey', 123],
    ['obsidianApiKey', undefined],
    ['obsidianApiKey', null],
    ['obsidianApiKey', false],
    ['obsidianApiKey', []],
    ['obsidianApiKey', {}],
    ['obsidianUrl', false],
    ['vaultPath', null],
    ['enableAutoScroll', 'false'],
    ['enableAppendMode', 1],
    ['enableToolContent', null],
    ['enableImageExport', undefined],
    ['enableChatGptOpaqueProbe', 'true'],
    ['enableChatGptOpaqueReplay', 0],
    ['imageVaultPath', false],
    ['flattenLargeCallouts', 'true'],
    ['maxCalloutLines', 0],
    ['maxCalloutLines', 1.5],
    ['maxCalloutLines', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects invalid %s', (key, value) => {
    expect(validateSettingsUpdate({ ...validSettings, [key]: value })).toBe(false);
  });
});
