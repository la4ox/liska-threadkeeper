import { describe, it, expect } from 'vitest';
import {
  normalizeSyncSettings,
  DEFAULT_SYNC_SETTINGS,
  DEFAULT_TEMPLATE_OPTIONS,
  DEFAULT_OUTPUT_OPTIONS,
} from '../../src/lib/settings-schema';

describe('normalizeSyncSettings', () => {
  it('normalizes tag lists independently and never shares arrays', () => {
    const stored = {
      vaultPath: 'Keep',
      templateOptions: {
        conversationTags: ['a,b'],
        deepResearchTags: ['研究', '{platform}'],
        includeTags: false,
      },
    };
    const first = normalizeSyncSettings(stored);
    expect(first.vaultPath).toBe('Keep');
    expect(first.templateOptions).toMatchObject({
      conversationTags: ['ai-conversation', '{platform}'],
      deepResearchTags: ['研究', '{platform}'],
      includeTags: false,
    });
    first.templateOptions.deepResearchTags!.push('changed');
    first.templateOptions.conversationTags!.push('changed');
    expect(normalizeSyncSettings(stored).templateOptions.deepResearchTags).toEqual([
      '研究',
      '{platform}',
    ]);
    for (const raw of [
      undefined,
      {},
      { templateOptions: {} },
      { templateOptions: { conversationTags: [], deepResearchTags: [] } },
    ]) {
      const a = normalizeSyncSettings(raw);
      const b = normalizeSyncSettings(raw);
      expect(a.templateOptions.conversationTags).toEqual(['ai-conversation', '{platform}']);
      expect(a.templateOptions.conversationTags).not.toBe(b.templateOptions.conversationTags);
      expect(a.templateOptions.deepResearchTags).not.toBe(b.templateOptions.deepResearchTags);
    }
    expect(DEFAULT_TEMPLATE_OPTIONS.conversationTags).not.toBe(
      DEFAULT_TEMPLATE_OPTIONS.conversationTags
    );
  });

  it.each(
    [
      ['a,b'],
      ['A', 'a'],
      ['#tag'],
      ['two words'],
      ['{title}'],
      ['123'],
      ['x'.repeat(101)],
      Array(51).fill('tag'),
      'tag',
      [1],
    ].map(value => [value])
  )('resets malformed stored tags %j without resetting siblings', value => {
    const settings = normalizeSyncSettings({
      templateOptions: { conversationTags: value, deepResearchTags: ['valid'] },
    });
    expect(settings.templateOptions.conversationTags).toEqual(['ai-conversation', '{platform}']);
    expect(settings.templateOptions.deepResearchTags).toEqual(['valid']);
  });
  it('adds deadline defaults to old saved settings without changing sibling fields', () => {
    expect(normalizeSyncSettings({ vaultPath: 'Existing', enableAutoScroll: true })).toMatchObject({
      vaultPath: 'Existing',
      enableAutoScroll: true,
      scrollIdleTimeoutSec: 15,
      scrollMaxTimeoutSec: 300,
    });
  });

  it.each([
    [undefined, 15, 300],
    [null, 15, 300],
    ['60', 15, 300],
    [true, 15, 300],
    [{}, 15, 300],
    [[], 15, 300],
    [Number.NaN, 15, 300],
    [Number.POSITIVE_INFINITY, 15, 300],
    [Number.NEGATIVE_INFINITY, 15, 300],
    [0, 15, 300],
    [-10, 15, 300],
    [0.5, 15, 300],
    [60.5, 15, 300],
    [301.5, 15, 300],
    [1, 5, 30],
    [5, 5, 30],
    [29, 29, 30],
    [30, 30, 30],
    [120, 120, 120],
    [300, 300, 300],
    [301, 300, 300],
    [Number.MAX_VALUE, 300, 300],
  ])('normalizes stored deadline %s to idle=%s, max=%s', (value, idle, max) => {
    expect(
      normalizeSyncSettings({ scrollIdleTimeoutSec: value, scrollMaxTimeoutSec: value })
    ).toMatchObject({ scrollIdleTimeoutSec: idle, scrollMaxTimeoutSec: max });
  });

  it('permits an idle budget longer than the total budget', () => {
    expect(
      normalizeSyncSettings({ scrollIdleTimeoutSec: 120, scrollMaxTimeoutSec: 30 })
    ).toMatchObject({
      scrollIdleTimeoutSec: 120,
      scrollMaxTimeoutSec: 30,
    });
  });

  it('returns full defaults for an empty object', () => {
    expect(normalizeSyncSettings({})).toEqual(DEFAULT_SYNC_SETTINGS);
  });

  it('returns full defaults for a non-object input', () => {
    expect(normalizeSyncSettings(null)).toEqual(DEFAULT_SYNC_SETTINGS);
    expect(normalizeSyncSettings('corrupt')).toEqual(DEFAULT_SYNC_SETTINGS);
    expect(normalizeSyncSettings(undefined)).toEqual(DEFAULT_SYNC_SETTINGS);
  });

  it('preserves valid custom values', () => {
    const raw = {
      obsidianUrl: 'https://192.168.1.5:27123',
      vaultPath: 'Custom/Path',
      enableAppendMode: true,
      maxCalloutLines: 50,
    };
    const result = normalizeSyncSettings(raw);
    expect(result.obsidianUrl).toBe('https://192.168.1.5:27123');
    expect(result.vaultPath).toBe('Custom/Path');
    expect(result.enableAppendMode).toBe(true);
    expect(result.maxCalloutLines).toBe(50);
  });

  it('resets only the corrupted boolean field to its default', () => {
    const result = normalizeSyncSettings({
      enableAppendMode: 'yes',
      enableImageExport: false,
    });
    expect(result.enableAppendMode).toBe(DEFAULT_SYNC_SETTINGS.enableAppendMode); // false
    expect(result.enableImageExport).toBe(false); // valid → preserved
  });

  it('keeps the opaque probe disabled by default and preserves an explicit boolean opt-in', () => {
    expect(DEFAULT_SYNC_SETTINGS.enableChatGptOpaqueProbe).toBe(false);
    expect(normalizeSyncSettings({ enableChatGptOpaqueProbe: true }).enableChatGptOpaqueProbe).toBe(
      true
    );
    expect(
      normalizeSyncSettings({ enableChatGptOpaqueProbe: 'yes' }).enableChatGptOpaqueProbe
    ).toBe(false);
  });

  it('keeps opaque replay disabled by default and preserves only an explicit boolean opt-in', () => {
    expect(DEFAULT_SYNC_SETTINGS.enableChatGptOpaqueReplay).toBe(false);
    expect(
      normalizeSyncSettings({ enableChatGptOpaqueReplay: true }).enableChatGptOpaqueReplay
    ).toBe(true);
    expect(
      normalizeSyncSettings({ enableChatGptOpaqueReplay: 'yes' }).enableChatGptOpaqueReplay
    ).toBe(false);
    expect(
      normalizeSyncSettings({
        enableChatGptOpaqueProbe: true,
        enableChatGptOpaqueReplay: true,
      })
    ).toMatchObject({
      enableChatGptOpaqueProbe: true,
      enableChatGptOpaqueReplay: false,
    });
  });

  it('resets an out-of-range or non-integer maxCalloutLines to default', () => {
    expect(normalizeSyncSettings({ maxCalloutLines: 'abc' }).maxCalloutLines).toBe(200);
    expect(normalizeSyncSettings({ maxCalloutLines: -5 }).maxCalloutLines).toBe(200);
    expect(normalizeSyncSettings({ maxCalloutLines: 0 }).maxCalloutLines).toBe(200);
    expect(normalizeSyncSettings({ maxCalloutLines: 1.5 }).maxCalloutLines).toBe(200);
  });

  it('resets an invalid messageFormat enum but keeps sibling template fields', () => {
    const result = normalizeSyncSettings({
      templateOptions: { messageFormat: 'weird', userCalloutType: 'TIP' },
    });
    expect(result.templateOptions.messageFormat).toBe('callout');
    expect(result.templateOptions.userCalloutType).toBe('TIP');
  });

  it('resets an invalid filenameScheme enum to default', () => {
    const result = normalizeSyncSettings({ templateOptions: { filenameScheme: 'bogus' } });
    expect(result.templateOptions.filenameScheme).toBe('title-id');
  });

  it('falls back to default templateOptions when the value is not an object', () => {
    const result = normalizeSyncSettings({ templateOptions: 'corrupt' });
    expect(result.templateOptions).toEqual(DEFAULT_TEMPLATE_OPTIONS);
  });

  it('coerces corrupted outputOptions booleans to defaults', () => {
    const result = normalizeSyncSettings({ outputOptions: { obsidian: 'true', file: 1 } });
    expect(result.outputOptions).toEqual(DEFAULT_OUTPUT_OPTIONS);
  });

  it('migrates legacy obsidianPort into obsidianUrl', () => {
    const result = normalizeSyncSettings({ obsidianPort: 27124 });
    expect(result.obsidianUrl).toBe('http://127.0.0.1:27124');
  });

  it('preserves a valid optional timezone but drops a non-string one', () => {
    expect(
      normalizeSyncSettings({ templateOptions: { timezone: 'Asia/Tokyo' } }).templateOptions
        .timezone
    ).toBe('Asia/Tokyo');
    expect(
      normalizeSyncSettings({ templateOptions: { timezone: 123 } }).templateOptions.timezone
    ).toBeUndefined();
  });
});
