import { normalizeSyncSettings } from './settings-schema';
import type { SyncSettings } from './types';

const MAX_SYNC_SETTINGS_SNAPSHOT_LENGTH = 16_384;

/**
 * Canonical, secret-free routing guard. It binds message admission to the
 * original settings, not atomic cancellation or the physical identity of a vault.
 */
export function serializeSyncSettingsSnapshot(settings: SyncSettings): string {
  return JSON.stringify(normalizeSyncSettings(settings));
}

/** Accept only the exact canonical representation produced by this build. */
export function isSerializedSyncSettingsSnapshot(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_SYNC_SETTINGS_SNAPSHOT_LENGTH
  ) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return serializeSyncSettingsSnapshot(parsed as SyncSettings) === value;
  } catch {
    return false;
  }
}
