/**
 * Chrome storage wrapper for extension settings
 *
 * Storage separation strategy (C-01):
 * - storage.local: Secure settings (API Key) - no cloud sync
 * - storage.sync: Non-sensitive settings - synced across devices
 */

import type { ExtensionSettings, SecureSettings, SyncSettings } from './types';
import {
  DEFAULT_TEMPLATE_OPTIONS,
  DEFAULT_OUTPUT_OPTIONS,
  DEFAULT_SYNC_SETTINGS,
  normalizeSyncSettings,
} from './settings-schema';

const DEFAULT_SECURE_SETTINGS: SecureSettings = {
  obsidianApiKey: '',
};

const DEFAULT_SETTINGS: ExtensionSettings = {
  ...DEFAULT_SECURE_SETTINGS,
  ...DEFAULT_SYNC_SETTINGS,
};

const SYNC_PASS_THROUGH_KEYS = [
  'obsidianUrl',
  'vaultPath',
  'imageVaultPath',
  'enableAutoScroll',
  'enableAppendMode',
  'enableToolContent',
  'enableImageExport',
  'enableChatGptOpaqueProbe',
  'enableChatGptOpaqueReplay',
  'flattenLargeCallouts',
  'maxCalloutLines',
] as const;

type StorageRecord = Record<string, unknown>;

let settingsMutationTail: Promise<void> = Promise.resolve();

function isStorageRecord(value: unknown): value is StorageRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function storageRecord(value: unknown): StorageRecord {
  return isStorageRecord(value) ? value : {};
}

function hasOwn(record: StorageRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function withoutLegacyApiKey(record: StorageRecord): StorageRecord {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'obsidianApiKey'));
}

function enqueueSettingsMutation(operation: () => Promise<void>): Promise<void> {
  const result = settingsMutationTail.then(operation, operation);
  settingsMutationTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

interface LocalApiKeyState {
  present: boolean;
  value: string;
}

function localApiKeyState(value: unknown): LocalApiKeyState {
  const secureSettings = storageRecord(value);
  return typeof secureSettings.obsidianApiKey === 'string'
    ? { present: true, value: secureSettings.obsidianApiKey }
    : { present: false, value: DEFAULT_SECURE_SETTINGS.obsidianApiKey };
}

function localApiKey(value: unknown): string {
  return localApiKeyState(value).value;
}

function syncUpdates(
  settings: Partial<ExtensionSettings>,
  syncBase: StorageRecord
): Partial<SyncSettings> {
  const updates: Partial<SyncSettings> = {};
  for (const key of SYNC_PASS_THROUGH_KEYS) {
    if (settings[key] !== undefined) {
      (updates[key] as SyncSettings[typeof key]) = settings[key] as SyncSettings[typeof key];
    }
  }
  if (settings.templateOptions !== undefined) {
    updates.templateOptions = {
      ...DEFAULT_TEMPLATE_OPTIONS,
      ...storageRecord(syncBase.templateOptions),
      ...settings.templateOptions,
    };
  }
  if (settings.outputOptions !== undefined) {
    updates.outputOptions = {
      ...DEFAULT_OUTPUT_OPTIONS,
      ...storageRecord(syncBase.outputOptions),
      ...settings.outputOptions,
    };
  }
  return updates;
}

/**
 * Get extension settings from chrome.storage (local + sync)
 *
 * Retrieves secure settings from local storage and non-sensitive
 * settings from sync storage, combining them into a unified object.
 */
export async function getSettings(): Promise<ExtensionSettings> {
  try {
    const [localResult, syncResult] = await Promise.all([
      chrome.storage.local.get('secureSettings'),
      chrome.storage.sync.get('settings'),
    ]);

    const stored = storageRecord(syncResult.settings);

    // Schema-validate/normalize untrusted sync values (L-1): corrupted fields
    // fall back to defaults; valid fields are preserved. Also resolves the
    // legacy obsidianPort → obsidianUrl migration.
    const sync = normalizeSyncSettings(stored);

    // The legacy sync value is migration input only. Runtime use fails closed
    // until the key has been verified in local storage.
    const obsidianApiKey = localApiKey(localResult.secureSettings);

    return {
      obsidianApiKey,
      ...sync,
    };
  } catch {
    console.error('[G2O] Failed to get settings');
    return DEFAULT_SETTINGS;
  }
}

/**
 * Save extension settings to chrome.storage
 *
 * Separates secure settings (API Key) to local storage
 * and non-sensitive settings to sync storage.
 */
export function saveSettings(settings: Partial<ExtensionSettings>): Promise<void> {
  return enqueueSettingsMutation(async () => {
    try {
      const explicitKey = settings.obsidianApiKey;
      let mayRemoveLegacyKey = false;
      if (explicitKey !== undefined) {
        await chrome.storage.local.set({
          secureSettings: { obsidianApiKey: explicitKey },
        });
        const verifyResult = await chrome.storage.local.get('secureSettings');
        const verified = localApiKeyState(verifyResult.secureSettings);
        if (!verified.present || verified.value !== explicitKey) {
          throw new Error('settings-save-verification-failed');
        }
        mayRemoveLegacyKey = true;
      } else {
        try {
          const localResult = await chrome.storage.local.get('secureSettings');
          mayRemoveLegacyKey = localApiKeyState(localResult.secureSettings).present;
        } catch {
          mayRemoveLegacyKey = false;
        }
      }

      // Read sync only after every local-storage await. The immediately
      // following merge and write therefore preserve the freshest available
      // non-secret state while removing at most the obsolete legacy key.
      const syncResult = await chrome.storage.sync.get('settings');
      const currentSync = storageRecord(syncResult.settings);
      const hasLegacyKey = hasOwn(currentSync, 'obsidianApiKey');
      const syncBase =
        hasLegacyKey && mayRemoveLegacyKey ? withoutLegacyApiKey(currentSync) : currentSync;

      // Save non-sensitive data to sync storage. Simple scalar fields pass
      // through directly; templateOptions/outputOptions merge with defaults.
      const syncData = syncUpdates(settings, syncBase);

      if (Object.keys(syncData).length > 0 || (hasLegacyKey && mayRemoveLegacyKey)) {
        await chrome.storage.sync.set({
          settings: { ...syncBase, ...syncData },
        });
      }
    } catch (error) {
      console.error('[G2O] Failed to save settings');
      throw error;
    }
  });
}

/**
 * Migrate settings from old format (sync only) to new format (local + sync)
 *
 * Transaction-safe migration:
 * 1. Write to local storage first
 * 2. Verify write success
 * 3. Remove from sync only after verification
 * 4. On failure, keep sync intact (no data loss)
 *
 * Should be called on service worker startup.
 */
export function migrateSettings(): Promise<void> {
  return enqueueSettingsMutation(async () => {
    try {
      const [syncResult, localResult] = await Promise.all([
        chrome.storage.sync.get('settings'),
        chrome.storage.local.get('secureSettings'),
      ]);
      const initialSync = storageRecord(syncResult.settings);
      if (!hasOwn(initialSync, 'obsidianApiKey')) return;
      const legacyKey = initialSync.obsidianApiKey;
      if (typeof legacyKey !== 'string') {
        console.warn('[G2O] Secure settings migration deferred');
        return;
      }

      const existingLocal = localApiKeyState(localResult.secureSettings);
      const targetKey = existingLocal.present ? existingLocal.value : legacyKey;
      if (!existingLocal.present) {
        await chrome.storage.local.set({ secureSettings: { obsidianApiKey: targetKey } });
      }

      const verifyResult = await chrome.storage.local.get('secureSettings');
      const verifiedLocal = localApiKeyState(verifyResult.secureSettings);
      if (!verifiedLocal.present || verifiedLocal.value !== targetKey) {
        throw new Error('migration-verification-failed');
      }

      // Re-read sync after local verification so concurrent non-secret updates
      // are preserved and only the obsolete secret field is removed.
      const freshSyncResult = await chrome.storage.sync.get('settings');
      const freshSync = storageRecord(freshSyncResult.settings);
      if (hasOwn(freshSync, 'obsidianApiKey')) {
        await chrome.storage.sync.set({ settings: withoutLegacyApiKey(freshSync) });
      }
      console.info('[G2O] Secure settings migration completed');
    } catch {
      // Keep the sync value solely for a later migration retry. Runtime reads
      // never use it as an API credential.
      console.warn('[G2O] Secure settings migration deferred');
    }
  });
}
