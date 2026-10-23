import { describe, expect, it } from 'vitest';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import {
  isSerializedSyncSettingsSnapshot,
  serializeSyncSettingsSnapshot,
} from '../../src/lib/sync-settings-snapshot';

describe('sync settings snapshot', () => {
  it.each(['conversationTags', 'deepResearchTags'] as const)(
    'binds %s to the canonical routing snapshot',
    key => {
      const before = serializeSyncSettingsSnapshot(DEFAULT_SYNC_SETTINGS);
      const after = serializeSyncSettingsSnapshot({
        ...DEFAULT_SYNC_SETTINGS,
        templateOptions: {
          ...DEFAULT_SYNC_SETTINGS.templateOptions,
          [key]: ['custom', '{platform}'],
        },
      });
      expect(after).not.toBe(before);
      expect(isSerializedSyncSettingsSnapshot(after)).toBe(true);
      expect(JSON.parse(after).templateOptions[key]).toEqual(['custom', '{platform}']);
      const malformed = JSON.parse(after);
      malformed.templateOptions[key] = ['a,b'];
      expect(isSerializedSyncSettingsSnapshot(JSON.stringify(malformed))).toBe(false);
      delete malformed.templateOptions[key];
      expect(isSerializedSyncSettingsSnapshot(JSON.stringify(malformed))).toBe(false);
    }
  );
  it.each(['scrollIdleTimeoutSec', 'scrollMaxTimeoutSec'] as const)(
    'includes %s in the canonical routing snapshot and detects a changed deadline',
    key => {
      const before = serializeSyncSettingsSnapshot(DEFAULT_SYNC_SETTINGS);
      const after = serializeSyncSettingsSnapshot({ ...DEFAULT_SYNC_SETTINGS, [key]: 60 });
      expect(JSON.parse(before)).toMatchObject({
        scrollIdleTimeoutSec: 15,
        scrollMaxTimeoutSec: 300,
      });
      expect(JSON.parse(after)[key]).toBe(60);
      expect(after).not.toBe(before);
      expect(isSerializedSyncSettingsSnapshot(after)).toBe(true);
      const old = JSON.parse(before);
      delete old[key];
      expect(isSerializedSyncSettingsSnapshot(JSON.stringify(old))).toBe(false);
    }
  );

  it('serializes a canonical secret-free snapshot deterministically', () => {
    const first = serializeSyncSettingsSnapshot(DEFAULT_SYNC_SETTINGS);
    const second = serializeSyncSettingsSnapshot(structuredClone(DEFAULT_SYNC_SETTINGS));
    expect(second).toBe(first);
    expect(isSerializedSyncSettingsSnapshot(first)).toBe(true);
    expect(first).not.toContain('obsidianApiKey');
    expect(
      serializeSyncSettingsSnapshot({
        ...DEFAULT_SYNC_SETTINGS,
        obsidianApiKey: 'secret-marker',
      } as never)
    ).toBe(first);
    expect(first).not.toContain('secret-marker');
  });

  it.each(['', 'not-json', '[]', '{}', '"text"'])('rejects a noncanonical value: %s', value => {
    expect(isSerializedSyncSettingsSnapshot(value)).toBe(false);
  });

  it('rejects reordered, unknown, and invalid settings instead of normalizing them silently', () => {
    const canonical = serializeSyncSettingsSnapshot(DEFAULT_SYNC_SETTINGS);
    const parsed = JSON.parse(canonical) as Record<string, unknown>;
    expect(isSerializedSyncSettingsSnapshot(JSON.stringify({ ...parsed, extra: true }))).toBe(
      false
    );
    expect(
      isSerializedSyncSettingsSnapshot(
        JSON.stringify({ maxCalloutLines: parsed.maxCalloutLines, ...parsed })
      )
    ).toBe(false);
    expect(
      isSerializedSyncSettingsSnapshot(JSON.stringify({ ...parsed, maxCalloutLines: 0 }))
    ).toBe(false);
  });
});
