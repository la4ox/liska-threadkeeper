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
    expect(JSON.parse(first)).toHaveProperty('enableInertCodeBlocks', true);
    expect(JSON.parse(first)).toHaveProperty('enableTextExport', false);
    expect(first).not.toContain('obsidianApiKey');
    expect(
      serializeSyncSettingsSnapshot({
        ...DEFAULT_SYNC_SETTINGS,
        obsidianApiKey: 'secret-marker',
      } as never)
    ).toBe(first);
    expect(first).not.toContain('secret-marker');
  });

  it('binds canonical plain-text authorization to the synchronized toggle', () => {
    const disabled = serializeSyncSettingsSnapshot(DEFAULT_SYNC_SETTINGS);
    const enabled = serializeSyncSettingsSnapshot({
      ...DEFAULT_SYNC_SETTINGS,
      enableTextExport: true,
    });
    expect(enabled).not.toBe(disabled);
    expect(JSON.parse(enabled)).toHaveProperty('enableTextExport', true);
    expect(isSerializedSyncSettingsSnapshot(enabled)).toBe(true);
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
