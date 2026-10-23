import { describe, expect, it } from 'vitest';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import {
  isSerializedSyncSettingsSnapshot,
  serializeSyncSettingsSnapshot,
} from '../../src/lib/sync-settings-snapshot';

describe('sync settings snapshot', () => {
  it('serializes a canonical secret-free snapshot deterministically', () => {
    const first = serializeSyncSettingsSnapshot(DEFAULT_SYNC_SETTINGS);
    const second = serializeSyncSettingsSnapshot(structuredClone(DEFAULT_SYNC_SETTINGS));
    expect(second).toBe(first);
    expect(isSerializedSyncSettingsSnapshot(first)).toBe(true);
    expect(first).not.toContain('obsidianApiKey');
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
