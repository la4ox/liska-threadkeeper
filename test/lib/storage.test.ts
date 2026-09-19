import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSettings, saveSettings, migrateSettings } from '../../src/lib/storage';

describe('storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset storage state
    const localStore: Record<string, unknown> = {};
    const syncStore: Record<string, unknown> = {};

    vi.mocked(chrome.storage.local.get).mockImplementation(
      (keys: string | string[] | Record<string, unknown> | null) => {
        if (typeof keys === 'string') {
          return Promise.resolve({ [keys]: localStore[keys] });
        }
        return Promise.resolve(localStore);
      }
    );

    vi.mocked(chrome.storage.local.set).mockImplementation((items: Record<string, unknown>) => {
      Object.assign(localStore, items);
      return Promise.resolve();
    });

    vi.mocked(chrome.storage.sync.get).mockImplementation(
      (keys: string | string[] | Record<string, unknown> | null) => {
        if (typeof keys === 'string') {
          return Promise.resolve({ [keys]: syncStore[keys] });
        }
        return Promise.resolve(syncStore);
      }
    );

    vi.mocked(chrome.storage.sync.set).mockImplementation((items: Record<string, unknown>) => {
      Object.assign(syncStore, items);
      return Promise.resolve();
    });
  });

  describe('getSettings', () => {
    it('returns default settings when storage is empty', async () => {
      const settings = await getSettings();

      expect(settings.obsidianApiKey).toBe('');
      expect(settings.obsidianUrl).toBe('http://127.0.0.1:27123');
      expect(settings.vaultPath).toBe('AI/{platform}');
      expect(settings.templateOptions.messageFormat).toBe('callout');
      expect(settings.enableImageExport).toBe(true);
      expect(settings.enableChatGptOpaqueProbe).toBe(false);
      expect(settings.enableChatGptOpaqueReplay).toBe(false);
      expect(settings.imageVaultPath).toBe('AI/{platform}/images');
      expect(settings.flattenLargeCallouts).toBe(true);
      expect(settings.maxCalloutLines).toBe(200);
    });

    it('persists image export settings via saveSettings', async () => {
      await saveSettings({ enableImageExport: false, imageVaultPath: 'Attachments/{platform}' });
      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        settings: expect.objectContaining({
          enableImageExport: false,
          imageVaultPath: 'Attachments/{platform}',
        }),
      });
    });

    it('returns stored secure settings from local storage', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        secureSettings: { obsidianApiKey: 'test-api-key' },
      });

      const settings = await getSettings();
      expect(settings.obsidianApiKey).toBe('test-api-key');
    });

    it('returns stored sync settings from sync storage', async () => {
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({
        settings: { obsidianUrl: 'https://192.168.1.5:27123', vaultPath: 'Custom/Path' },
      });

      const settings = await getSettings();
      expect(settings.obsidianUrl).toBe('https://192.168.1.5:27123');
      expect(settings.vaultPath).toBe('Custom/Path');
    });

    it('migrates legacy obsidianPort to obsidianUrl', async () => {
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({
        settings: { obsidianPort: 28000 },
      });

      const settings = await getSettings();
      expect(settings.obsidianUrl).toBe('http://127.0.0.1:28000');
    });

    it('prefers obsidianUrl over legacy obsidianPort', async () => {
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({
        settings: { obsidianUrl: 'https://127.0.0.1:27123', obsidianPort: 28000 },
      });

      const settings = await getSettings();
      expect(settings.obsidianUrl).toBe('https://127.0.0.1:27123');
    });

    it('merges template options with defaults', async () => {
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({
        settings: {
          templateOptions: { messageFormat: 'blockquote' },
        },
      });

      const settings = await getSettings();
      expect(settings.templateOptions.messageFormat).toBe('blockquote');
      expect(settings.templateOptions.includeId).toBe(true); // default preserved
    });

    it('defaults filenameScheme to title-id (#328)', async () => {
      const settings = await getSettings();
      expect(settings.templateOptions.filenameScheme).toBe('title-id');
    });

    it('normalizes corrupted sync values to defaults (L-1)', async () => {
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({
        settings: {
          maxCalloutLines: 'not-a-number',
          enableAppendMode: 'yes',
          templateOptions: { messageFormat: 'weird' },
        },
      });

      const settings = await getSettings();
      expect(settings.maxCalloutLines).toBe(200);
      expect(settings.enableAppendMode).toBe(false);
      expect(settings.templateOptions.messageFormat).toBe('callout');
    });

    it('does not use the legacy sync API key before migration completes', async () => {
      // The legacy sync value is migration input only, never a runtime credential.
      vi.mocked(chrome.storage.local.get).mockResolvedValue({ secureSettings: undefined });
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({
        settings: { obsidianApiKey: 'legacy-sync-key' },
      });

      const settings = await getSettings();
      expect(settings.obsidianApiKey).toBe('');
    });

    it('uses the local API key even when sync contains a different legacy value', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        secureSettings: { obsidianApiKey: 'local-key' },
      });
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({
        settings: { obsidianApiKey: 'legacy-sync-key' },
      });

      const settings = await getSettings();
      expect(settings.obsidianApiKey).toBe('local-key');
    });

    it('returns an empty API key when neither store has one (L-2)', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({ secureSettings: undefined });
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({ settings: {} });

      const settings = await getSettings();
      expect(settings.obsidianApiKey).toBe('');
    });

    it('round-trips a stored title-date filenameScheme (#328)', async () => {
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({
        settings: { templateOptions: { filenameScheme: 'title-date' } },
      });
      const settings = await getSettings();
      expect(settings.templateOptions.filenameScheme).toBe('title-date');
      expect(settings.templateOptions.messageFormat).toBe('callout'); // default preserved
    });

    it('returns default enableToolContent false when empty', async () => {
      const settings = await getSettings();
      expect(settings.enableToolContent).toBe(false);
    });

    it('returns default settings on error', async () => {
      vi.mocked(chrome.storage.local.get).mockRejectedValue(new Error('Storage error'));

      const settings = await getSettings();
      expect(settings.obsidianApiKey).toBe('');
      expect(settings.obsidianUrl).toBe('http://127.0.0.1:27123');
    });
  });

  it('persists the non-sensitive opaque probe switch via saveSettings', async () => {
    await saveSettings({ enableChatGptOpaqueProbe: true });
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      settings: expect.objectContaining({ enableChatGptOpaqueProbe: true }),
    });
  });

  it('persists the non-sensitive opaque replay switch via saveSettings', async () => {
    await saveSettings({ enableChatGptOpaqueReplay: true });
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      settings: expect.objectContaining({ enableChatGptOpaqueReplay: true }),
    });
  });

  describe('saveSettings', () => {
    it('saves API key to local storage', async () => {
      await saveSettings({ obsidianApiKey: 'new-api-key' });

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        secureSettings: { obsidianApiKey: 'new-api-key' },
      });
    });

    it('saves obsidianUrl and vaultPath to sync storage', async () => {
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({ settings: {} });

      await saveSettings({ obsidianUrl: 'https://127.0.0.1:27123', vaultPath: 'New/Path' });

      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        settings: { obsidianUrl: 'https://127.0.0.1:27123', vaultPath: 'New/Path' },
      });
    });

    it('merges template options with current settings', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({});
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({
        settings: {
          templateOptions: { includeId: true, messageFormat: 'callout' },
        },
      });

      await saveSettings({
        templateOptions: { messageFormat: 'blockquote' } as never,
      });

      expect(chrome.storage.sync.set).toHaveBeenCalled();
      const callArgs = vi.mocked(chrome.storage.sync.set).mock.calls[0][0];
      expect(callArgs.settings.templateOptions.messageFormat).toBe('blockquote');
    });

    it('does not save to sync if only API key is provided', async () => {
      await saveSettings({ obsidianApiKey: 'key' });

      expect(chrome.storage.local.set).toHaveBeenCalled();
      expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    });

    it('removes a legacy sync key after explicitly saving an empty local key', async () => {
      let localWriteCompleted = false;
      let savedKey: string | undefined;
      vi.mocked(chrome.storage.local.set).mockImplementation(items => {
        localWriteCompleted = true;
        savedKey = (items.secureSettings as { obsidianApiKey: string }).obsidianApiKey;
        return Promise.resolve();
      });
      vi.mocked(chrome.storage.local.get).mockImplementation(() =>
        Promise.resolve({ secureSettings: { obsidianApiKey: savedKey } })
      );
      vi.mocked(chrome.storage.sync.get).mockImplementation(() => {
        expect(localWriteCompleted).toBe(true);
        return Promise.resolve({
          settings: { obsidianApiKey: 'legacy-key', vaultPath: 'Existing/Path' },
        });
      });

      await saveSettings({ obsidianApiKey: '' });

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        secureSettings: { obsidianApiKey: '' },
      });
      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        settings: { vaultPath: 'Existing/Path' },
      });
    });

    it('reads the freshest sync state only after checking local legacy-key authority', async () => {
      let syncSettings: Record<string, unknown> = {
        obsidianApiKey: 'legacy-key',
        vaultPath: 'AI/Before',
      };
      vi.mocked(chrome.storage.local.get).mockImplementation(() => {
        syncSettings = {
          obsidianApiKey: 'legacy-key',
          vaultPath: 'AI/After',
          enableImageExport: false,
        };
        return Promise.resolve({ secureSettings: { obsidianApiKey: '' } });
      });
      vi.mocked(chrome.storage.sync.get).mockImplementation(() =>
        Promise.resolve({ settings: { ...syncSettings } })
      );

      await saveSettings({ imageVaultPath: 'AI/{platform}/assets' });

      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        settings: {
          vaultPath: 'AI/After',
          enableImageExport: false,
          imageVaultPath: 'AI/{platform}/assets',
        },
      });
    });

    it('preserves a legacy sync key during a non-secret save when local storage is unavailable', async () => {
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({
        settings: { obsidianApiKey: 'legacy-key', obsidianUrl: 'http://127.0.0.1:27123' },
      });
      vi.mocked(chrome.storage.local.get).mockRejectedValue(new Error('local unavailable'));

      await saveSettings({ vaultPath: 'Updated/Path' });

      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        settings: {
          obsidianApiKey: 'legacy-key',
          obsidianUrl: 'http://127.0.0.1:27123',
          vaultPath: 'Updated/Path',
        },
      });
    });

    it('removes a legacy sync key during a non-secret save only after finding it locally', async () => {
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({
        settings: { obsidianApiKey: 'legacy-key', obsidianUrl: 'http://127.0.0.1:27123' },
      });
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        secureSettings: { obsidianApiKey: 'local-key' },
      });

      await saveSettings({ vaultPath: 'Updated/Path' });

      expect(chrome.storage.local.get).toHaveBeenCalledWith('secureSettings');
      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        settings: {
          obsidianUrl: 'http://127.0.0.1:27123',
          vaultPath: 'Updated/Path',
        },
      });
    });

    it('throws error on save failure', async () => {
      vi.mocked(chrome.storage.local.set).mockRejectedValue(new Error('Save failed'));

      await expect(saveSettings({ obsidianApiKey: 'key' })).rejects.toThrow('Save failed');
    });

    it('round-trips enableToolContent true', async () => {
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({ settings: {} });

      await saveSettings({ enableToolContent: true });

      expect(chrome.storage.sync.set).toHaveBeenCalled();
      const callArgs = vi.mocked(chrome.storage.sync.set).mock.calls[0][0];
      expect(callArgs.settings.enableToolContent).toBe(true);
    });

    it('merges outputOptions with current settings', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({});
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({
        settings: {
          outputOptions: { obsidian: true, file: false, clipboard: false },
        },
      });

      await saveSettings({
        outputOptions: { file: true } as never,
      });

      expect(chrome.storage.sync.set).toHaveBeenCalled();
      const callArgs = vi.mocked(chrome.storage.sync.set).mock.calls[0][0];
      expect(callArgs.settings.outputOptions.file).toBe(true);
      expect(callArgs.settings.outputOptions.obsidian).toBe(true);
    });
  });

  describe('migrateSettings', () => {
    it('writes the legacy key locally, verifies it, and then removes only the sync copy', async () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      vi.mocked(chrome.storage.sync.get)
        .mockResolvedValueOnce({
          settings: { obsidianApiKey: 'old-key', obsidianUrl: 'http://127.0.0.1:27123' },
        })
        .mockResolvedValueOnce({
          settings: { obsidianApiKey: 'old-key', obsidianUrl: 'http://127.0.0.1:27123' },
        });
      vi.mocked(chrome.storage.local.get)
        .mockResolvedValueOnce({ secureSettings: undefined })
        .mockResolvedValueOnce({ secureSettings: { obsidianApiKey: 'old-key' } });

      await migrateSettings();

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        secureSettings: { obsidianApiKey: 'old-key' },
      });
      expect(chrome.storage.local.get).toHaveBeenCalledTimes(2);
      expect(chrome.storage.sync.get).toHaveBeenCalledTimes(2);
      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        settings: { obsidianUrl: 'http://127.0.0.1:27123' },
      });
      expect(infoSpy).toHaveBeenCalledWith('[G2O] Secure settings migration completed');
      expect(infoSpy.mock.calls[0]).toHaveLength(1);
      infoSpy.mockRestore();
    });

    it('keeps the local key authoritative when sync contains a different legacy value', async () => {
      vi.mocked(chrome.storage.sync.get)
        .mockResolvedValueOnce({ settings: { obsidianApiKey: 'legacy-key', vaultPath: 'AI/Old' } })
        .mockResolvedValueOnce({ settings: { obsidianApiKey: 'legacy-key', vaultPath: 'AI/Old' } });
      vi.mocked(chrome.storage.local.get)
        .mockResolvedValueOnce({ secureSettings: { obsidianApiKey: 'local-key' } })
        .mockResolvedValueOnce({ secureSettings: { obsidianApiKey: 'local-key' } });

      await migrateSettings();

      expect(chrome.storage.local.set).not.toHaveBeenCalled();
      expect(chrome.storage.sync.set).toHaveBeenCalledWith({ settings: { vaultPath: 'AI/Old' } });
    });

    it('treats a present empty local key as authoritative and never resurrects sync legacy data', async () => {
      vi.mocked(chrome.storage.sync.get)
        .mockResolvedValueOnce({ settings: { obsidianApiKey: 'legacy-key', vaultPath: 'AI/Old' } })
        .mockResolvedValueOnce({ settings: { obsidianApiKey: 'legacy-key', vaultPath: 'AI/Old' } });
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        secureSettings: { obsidianApiKey: '' },
      });

      await migrateSettings();

      expect(chrome.storage.local.set).not.toHaveBeenCalled();
      expect(chrome.storage.sync.set).toHaveBeenCalledWith({ settings: { vaultPath: 'AI/Old' } });
    });

    it('serializes a queued save behind migration so the new popup key wins', async () => {
      let releaseInitialLocalRead: (() => void) | undefined;
      let initialReadReleased = false;
      let localKey: string | undefined;
      let syncSettings: Record<string, unknown> = { obsidianApiKey: 'legacy-key' };
      vi.mocked(chrome.storage.local.get).mockImplementation(async () => {
        if (!initialReadReleased) {
          await new Promise<void>(resolve => {
            releaseInitialLocalRead = () => {
              initialReadReleased = true;
              resolve();
            };
          });
        }
        return {
          secureSettings: localKey === undefined ? undefined : { obsidianApiKey: localKey },
        };
      });
      vi.mocked(chrome.storage.local.set).mockImplementation(items => {
        localKey = (items.secureSettings as { obsidianApiKey: string }).obsidianApiKey;
        return Promise.resolve();
      });
      vi.mocked(chrome.storage.sync.get).mockImplementation(() =>
        Promise.resolve({ settings: { ...syncSettings } })
      );
      vi.mocked(chrome.storage.sync.set).mockImplementation(items => {
        syncSettings = items.settings as Record<string, unknown>;
        return Promise.resolve();
      });

      const migration = migrateSettings();
      const save = saveSettings({ obsidianApiKey: 'new-popup-key' });
      await vi.waitFor(() => expect(releaseInitialLocalRead).toBeTypeOf('function'));
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
      releaseInitialLocalRead?.();
      await Promise.all([migration, save]);

      expect(localKey).toBe('new-popup-key');
      expect(syncSettings).not.toHaveProperty('obsidianApiKey');
      expect(chrome.storage.local.set).toHaveBeenNthCalledWith(1, {
        secureSettings: { obsidianApiKey: 'legacy-key' },
      });
      expect(chrome.storage.local.set).toHaveBeenNthCalledWith(2, {
        secureSettings: { obsidianApiKey: 'new-popup-key' },
      });
    });

    it('does nothing if no API key exists in sync storage', async () => {
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({
        settings: { obsidianUrl: 'http://127.0.0.1:27123' },
      });

      await migrateSettings();

      expect(chrome.storage.local.set).not.toHaveBeenCalled();
      expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    });

    it('keeps the sync copy and emits a fixed warning when the local write fails', async () => {
      const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({
        settings: { obsidianApiKey: 'legacy-key' },
      });
      vi.mocked(chrome.storage.local.set).mockRejectedValue(
        new Error('local write rejected for legacy-key')
      );

      await expect(migrateSettings()).resolves.toBeUndefined();

      expect(chrome.storage.sync.set).not.toHaveBeenCalled();
      expect(warningSpy).toHaveBeenCalledWith('[G2O] Secure settings migration deferred');
      expect(warningSpy.mock.calls[0]).toHaveLength(1);
      warningSpy.mockRestore();
    });

    it('keeps the sync copy when local readback does not match the verified target', async () => {
      const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({
        settings: { obsidianApiKey: 'old-key' },
      });
      vi.mocked(chrome.storage.local.get)
        .mockResolvedValueOnce({ secureSettings: undefined })
        .mockResolvedValueOnce({ secureSettings: { obsidianApiKey: 'different-key' } });

      await migrateSettings();

      expect(chrome.storage.sync.set).not.toHaveBeenCalled();
      expect(warningSpy).toHaveBeenCalledWith('[G2O] Secure settings migration deferred');
      expect(warningSpy.mock.calls[0]).toHaveLength(1);
      warningSpy.mockRestore();
    });

    it('retries successfully after a local write failure', async () => {
      const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      let localKey: string | undefined;
      let localWriteFails = true;
      let syncSettings: Record<string, unknown> = { obsidianApiKey: 'legacy-key' };
      vi.mocked(chrome.storage.local.get).mockImplementation(() =>
        Promise.resolve({
          secureSettings: localKey === undefined ? undefined : { obsidianApiKey: localKey },
        })
      );
      vi.mocked(chrome.storage.local.set).mockImplementation(items => {
        if (localWriteFails) {
          localWriteFails = false;
          return Promise.reject(new Error('first write failed'));
        }
        localKey = (items.secureSettings as { obsidianApiKey: string }).obsidianApiKey;
        return Promise.resolve();
      });
      vi.mocked(chrome.storage.sync.get).mockImplementation(() =>
        Promise.resolve({ settings: { ...syncSettings } })
      );
      vi.mocked(chrome.storage.sync.set).mockImplementation(items => {
        syncSettings = items.settings as Record<string, unknown>;
        return Promise.resolve();
      });

      await migrateSettings();
      expect(syncSettings).toHaveProperty('obsidianApiKey', 'legacy-key');

      await migrateSettings();

      expect(localKey).toBe('legacy-key');
      expect(syncSettings).not.toHaveProperty('obsidianApiKey');
      expect(chrome.storage.local.set).toHaveBeenCalledTimes(2);
      expect(warningSpy).toHaveBeenCalledWith('[G2O] Secure settings migration deferred');
      warningSpy.mockRestore();
    });

    it('retries sync cleanup after a cleanup failure without rewriting the local key', async () => {
      const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      let localKey: string | undefined;
      let cleanupFails = true;
      let syncSettings: Record<string, unknown> = {
        obsidianApiKey: 'legacy-key',
        vaultPath: 'AI/Existing',
      };
      vi.mocked(chrome.storage.local.get).mockImplementation(() =>
        Promise.resolve({
          secureSettings: localKey === undefined ? undefined : { obsidianApiKey: localKey },
        })
      );
      vi.mocked(chrome.storage.local.set).mockImplementation(items => {
        localKey = (items.secureSettings as { obsidianApiKey: string }).obsidianApiKey;
        return Promise.resolve();
      });
      vi.mocked(chrome.storage.sync.get).mockImplementation(() =>
        Promise.resolve({ settings: { ...syncSettings } })
      );
      vi.mocked(chrome.storage.sync.set).mockImplementation(items => {
        if (cleanupFails) {
          cleanupFails = false;
          return Promise.reject(new Error('cleanup failed'));
        }
        syncSettings = items.settings as Record<string, unknown>;
        return Promise.resolve();
      });

      await migrateSettings();
      expect(syncSettings).toHaveProperty('obsidianApiKey', 'legacy-key');

      await migrateSettings();

      expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
      expect(syncSettings).toEqual({ vaultPath: 'AI/Existing' });
      expect(chrome.storage.sync.set).toHaveBeenCalledTimes(2);
      expect(warningSpy).toHaveBeenCalledWith('[G2O] Secure settings migration deferred');
      warningSpy.mockRestore();
    });

    it('preserves fresh concurrent sync settings when removing the legacy key', async () => {
      vi.mocked(chrome.storage.sync.get)
        .mockResolvedValueOnce({
          settings: { obsidianApiKey: 'legacy-key', vaultPath: 'AI/Before' },
        })
        .mockResolvedValueOnce({
          settings: {
            obsidianApiKey: 'legacy-key',
            vaultPath: 'AI/After',
            enableImageExport: false,
          },
        });
      vi.mocked(chrome.storage.local.get)
        .mockResolvedValueOnce({ secureSettings: undefined })
        .mockResolvedValueOnce({ secureSettings: { obsidianApiKey: 'legacy-key' } });

      await migrateSettings();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        settings: { vaultPath: 'AI/After', enableImageExport: false },
      });
    });

    it('defers malformed legacy values without overwriting local or sync storage', async () => {
      const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({
        settings: { obsidianApiKey: { malformed: true }, vaultPath: 'AI/Existing' },
      });

      await migrateSettings();

      expect(chrome.storage.local.set).not.toHaveBeenCalled();
      expect(chrome.storage.sync.set).not.toHaveBeenCalled();
      expect(warningSpy).toHaveBeenCalledWith('[G2O] Secure settings migration deferred');
      expect(warningSpy.mock.calls[0]).toHaveLength(1);
      warningSpy.mockRestore();
    });
  });
});
