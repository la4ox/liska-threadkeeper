/**
 * Popup application tests
 *
 * Drives the REAL src/popup/app.ts module: initPopup() queries a fixture DOM,
 * populates it from mocked storage, and wires the save/test flows. The
 * index.ts entry shim stays a DOMContentLoaded one-liner.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ExtensionSettings, PopupSettingsUpdate } from '../../src/lib/types';

vi.mock('../../src/lib/storage', () => ({
  getSettings: vi.fn(),
}));

vi.mock('../../src/lib/messaging', () => ({
  sendMessage: vi.fn(),
}));

import { getSettings } from '../../src/lib/storage';
import { sendMessage } from '../../src/lib/messaging';
import { initPopup } from '../../src/popup/app';

const VALID_API_KEY = 'a'.repeat(32);

const storedSettings: ExtensionSettings = {
  obsidianApiKey: VALID_API_KEY,
  obsidianUrl: 'http://127.0.0.1:27123',
  vaultPath: 'AI/Gemini',
  imageVaultPath: 'AI/Gemini/images',
  maxCalloutLines: 200,
  enableAutoScroll: true,
  enableAppendMode: false,
  enableToolContent: false,
  enableImageExport: true,
  enableChatGptOpaqueProbe: false,
  enableChatGptOpaqueReplay: false,
  flattenLargeCallouts: true,
  outputOptions: { obsidian: true, file: false, clipboard: true },
  templateOptions: {
    messageFormat: 'callout',
    userCalloutType: 'QUESTION',
    assistantCalloutType: 'NOTE',
    includeQuestionHeaders: false,
    includeId: true,
    includeTitle: true,
    includeTags: false,
    includeSource: true,
    includeDates: true,
    includeMessageCount: true,
    timezone: 'UTC',
  },
};

const SWITCH_IDS = [
  'outputObsidian',
  'outputFile',
  'outputClipboard',
  'includeQuestionHeaders',
  'includeId',
  'includeTitle',
  'includeTags',
  'includeSource',
  'includeDates',
  'includeMessageCount',
  'enableAutoScroll',
  'enableAppendMode',
  'enableToolContent',
  'enableImageExport',
  'enableChatGptOpaqueProbe',
  'enableChatGptOpaqueReplay',
  'flattenLargeCallouts',
];

function buildPopupDom(): void {
  const switches = SWITCH_IDS.map(
    id => `<input type="checkbox" id="${id}" role="switch" aria-checked="false" />`
  ).join('\n');

  document.body.innerHTML = `
    <section id="obsidianSettings">
      <div class="api-key-wrapper">
        <input type="password" id="apiKey" />
      </div>
      <input type="text" id="obsidianUrl" />
      <input type="text" id="vaultPath" />
      <input type="text" id="imageVaultPath" />
      <input type="number" id="maxCalloutLines" />
    </section>
    ${switches}
    <select id="messageFormat">
      <option value="callout">callout</option>
      <option value="plain">plain</option>
      <option value="blockquote">blockquote</option>
    </select>
    <select id="filenameScheme">
      <option value="title-id">title-id</option>
      <option value="title-date">title-date</option>
    </select>
    <div id="calloutSettingsGroup">
      <input type="text" id="userCallout" />
      <input type="text" id="assistantCallout" />
    </div>
    <div id="timezoneGroup">
      <select id="timezone"><option value="UTC">UTC</option></select>
    </div>
    <button id="testBtn"></button>
    <button id="saveBtn"></button>
    <div id="status" class="status"></div>
  `;
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function statusEl(): HTMLDivElement {
  return el<HTMLDivElement>('status');
}

async function initWithDefaults(settings: ExtensionSettings = storedSettings): Promise<void> {
  buildPopupDom();
  vi.mocked(getSettings).mockResolvedValue(settings);
  await initPopup();
}

function settingsSaveAt(index: number): PopupSettingsUpdate {
  const message = vi.mocked(sendMessage).mock.calls[index]?.[0];
  if (message?.action !== 'saveSettings') throw new Error('Expected a settings-save message');
  return message.settings;
}

describe('popup/app', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendMessage).mockResolvedValue({ success: true } as never);
  });

  describe('initPopup', () => {
    it('populates the form from stored settings', async () => {
      await initWithDefaults();

      expect(el<HTMLInputElement>('apiKey').value).toBe(VALID_API_KEY);
      expect(el<HTMLInputElement>('obsidianUrl').value).toBe('http://127.0.0.1:27123');
      expect(el<HTMLInputElement>('vaultPath').value).toBe('AI/Gemini');
      expect(el<HTMLInputElement>('outputObsidian').checked).toBe(true);
      expect(el<HTMLInputElement>('outputClipboard').checked).toBe(true);
      expect(el<HTMLInputElement>('outputFile').checked).toBe(false);
      expect(el<HTMLInputElement>('enableAutoScroll').checked).toBe(true);
      expect(el<HTMLInputElement>('enableChatGptOpaqueProbe').checked).toBe(false);
      expect(el<HTMLInputElement>('enableChatGptOpaqueReplay').checked).toBe(false);
      expect(el<HTMLInputElement>('includeTags').checked).toBe(false);
      expect(el<HTMLSelectElement>('messageFormat').value).toBe('callout');
    });

    it('canonicalizes stale dual experiment settings to probe-only before saving', async () => {
      buildPopupDom();
      vi.mocked(getSettings).mockResolvedValue({
        ...storedSettings,
        enableChatGptOpaqueProbe: true,
        enableChatGptOpaqueReplay: true,
      });
      await initPopup();

      expect(el<HTMLInputElement>('enableChatGptOpaqueProbe').checked).toBe(true);
      expect(el<HTMLInputElement>('enableChatGptOpaqueReplay').checked).toBe(false);
      el<HTMLButtonElement>('saveBtn').click();

      await vi.waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith({
          action: 'saveSettings',
          settings: expect.objectContaining({
            enableChatGptOpaqueProbe: true,
            enableChatGptOpaqueReplay: false,
          }),
        })
      );
    });

    it('populates the timezone dropdown with IANA zones', async () => {
      await initWithDefaults();

      const timezone = el<HTMLSelectElement>('timezone');
      expect(timezone.options.length).toBeGreaterThan(1);
      expect(timezone.value).toBe('UTC');
    });

    it('syncs aria-checked with the populated checkbox state', async () => {
      await initWithDefaults();

      expect(el<HTMLInputElement>('outputObsidian').getAttribute('aria-checked')).toBe('true');
      expect(el<HTMLInputElement>('outputFile').getAttribute('aria-checked')).toBe('false');
    });

    it('keeps aria-checked in sync when a switch changes', async () => {
      await initWithDefaults();

      const toggle = el<HTMLInputElement>('outputFile');
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change'));

      expect(toggle.getAttribute('aria-checked')).toBe('true');
    });

    it('applies defaults when stored settings have missing optional fields', async () => {
      buildPopupDom();
      const partial = {
        ...storedSettings,
        obsidianApiKey: '',
        obsidianUrl: '',
        outputOptions: undefined,
        enableAutoScroll: undefined,
        enableAppendMode: undefined,
        enableToolContent: undefined,
        templateOptions: { messageFormat: '', userCalloutType: '', assistantCalloutType: '' },
      } as unknown as ExtensionSettings;
      vi.mocked(getSettings).mockResolvedValue(partial);

      await initPopup();

      expect(el<HTMLInputElement>('outputObsidian').checked).toBe(true); // default on
      expect(el<HTMLInputElement>('outputFile').checked).toBe(false);
      expect(el<HTMLInputElement>('enableAutoScroll').checked).toBe(false);
      expect(el<HTMLInputElement>('obsidianUrl').value).toBe('http://127.0.0.1:27123');
      expect(el<HTMLSelectElement>('messageFormat').value).toBe('callout');
      expect(el<HTMLInputElement>('userCallout').value).toBe('QUESTION');
      expect(el<HTMLInputElement>('assistantCallout').value).toBe('NOTE');
      expect(el<HTMLInputElement>('includeId').checked).toBe(true); // ?? true default
      expect(el<HTMLSelectElement>('timezone').value).toBe('UTC');
    });

    it('translates data-i18n elements when a translation exists', async () => {
      buildPopupDom();
      document.body.insertAdjacentHTML(
        'beforeend',
        '<span id="i18nLabel" data-i18n="settings_title"></span>' +
          '<input id="i18nInput" data-i18n-placeholder="settings_apiKeyPlaceholder" />'
      );
      // Ensure the data-i18n title is the FIRST <title> the app queries
      document.querySelectorAll('title').forEach(t => t.remove());
      document.head.insertAdjacentHTML('beforeend', '<title data-i18n="extName"></title>');
      vi.mocked(chrome.i18n.getMessage).mockImplementation((key: string) => `T_${key}`);
      vi.mocked(getSettings).mockResolvedValue(storedSettings);

      try {
        await initPopup();

        expect(document.getElementById('i18nLabel')!.textContent).toBe('T_settings_title');
        expect((document.getElementById('i18nInput') as HTMLInputElement).placeholder).toBe(
          'T_settings_apiKeyPlaceholder'
        );
        expect(document.title).toBe('T_extName');
      } finally {
        vi.mocked(chrome.i18n.getMessage).mockImplementation((key: string) => key);
        document.head.querySelector('title[data-i18n]')?.remove();
      }
    });

    it('rejects when a required element is missing from the DOM', async () => {
      buildPopupDom();
      document.getElementById('saveBtn')!.remove();
      vi.mocked(getSettings).mockResolvedValue(storedSettings);

      await expect(initPopup()).rejects.toThrow('Missing element: #saveBtn');
    });

    it('does not repopulate the timezone dropdown on re-init', async () => {
      await initWithDefaults();
      const countAfterFirst = el<HTMLSelectElement>('timezone').options.length;

      await initPopup(); // same DOM, second run hits the early-return guard

      expect(el<HTMLSelectElement>('timezone').options.length).toBe(countAfterFirst);
    });

    it('shows an error status when settings cannot be loaded', async () => {
      buildPopupDom();
      vi.mocked(getSettings).mockRejectedValue(new Error('storage down'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await initPopup();

      expect(statusEl().textContent).toBe('toast_error_connectionFailed');
      expect(statusEl().className).toBe('status error');
      errorSpy.mockRestore();
    });
  });

  describe('section visibility', () => {
    it('disables the Obsidian section when Obsidian output is off', async () => {
      buildPopupDom();
      vi.mocked(getSettings).mockResolvedValue({
        ...storedSettings,
        outputOptions: { obsidian: false, file: true, clipboard: false },
      });
      await initPopup();

      expect(el('obsidianSettings').classList.contains('disabled')).toBe(true);
    });

    it('re-enables the Obsidian section when the toggle is switched on', async () => {
      buildPopupDom();
      vi.mocked(getSettings).mockResolvedValue({
        ...storedSettings,
        outputOptions: { obsidian: false, file: true, clipboard: false },
      });
      await initPopup();

      const toggle = el<HTMLInputElement>('outputObsidian');
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change'));

      expect(el('obsidianSettings').classList.contains('disabled')).toBe(false);
    });

    it('hides callout settings for non-callout formats', async () => {
      await initWithDefaults();

      const format = el<HTMLSelectElement>('messageFormat');
      format.value = 'plain';
      format.dispatchEvent(new Event('change'));

      expect(el('calloutSettingsGroup').style.display).toBe('none');
    });

    it('hides the timezone group when dates are excluded', async () => {
      await initWithDefaults();

      const includeDates = el<HTMLInputElement>('includeDates');
      includeDates.checked = false;
      includeDates.dispatchEvent(new Event('change'));

      expect(el('timezoneGroup').style.display).toBe('none');
    });
  });

  describe('API key visibility toggle', () => {
    it('appends a toggle button that reveals and hides the key', async () => {
      await initWithDefaults();

      const toggleBtn = document.querySelector<HTMLButtonElement>('.api-key-toggle');
      expect(toggleBtn).not.toBeNull();

      const apiKey = el<HTMLInputElement>('apiKey');
      expect(apiKey.type).toBe('password');

      toggleBtn!.click();
      expect(apiKey.type).toBe('text');

      toggleBtn!.click();
      expect(apiKey.type).toBe('password');
    });
  });

  describe('save flow', () => {
    it('saves the experimental opaque-probe switch with an explicit default-off value', async () => {
      await initWithDefaults();

      const probe = el<HTMLInputElement>('enableChatGptOpaqueProbe');
      probe.checked = true;
      el<HTMLButtonElement>('saveBtn').click();

      await vi.waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith({
          action: 'saveSettings',
          settings: expect.objectContaining({ enableChatGptOpaqueProbe: true }),
        })
      );
    });

    it('saves the experimental opaque-replay switch with an explicit default-off value', async () => {
      await initWithDefaults();

      const replay = el<HTMLInputElement>('enableChatGptOpaqueReplay');
      replay.checked = true;
      replay.dispatchEvent(new Event('change'));
      el<HTMLButtonElement>('saveBtn').click();

      await vi.waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith({
          action: 'saveSettings',
          settings: expect.objectContaining({
            enableChatGptOpaqueProbe: false,
            enableChatGptOpaqueReplay: true,
          }),
        })
      );
    });

    it('keeps metadata probe and active replay mutually exclusive', async () => {
      await initWithDefaults();
      const probe = el<HTMLInputElement>('enableChatGptOpaqueProbe');
      const replay = el<HTMLInputElement>('enableChatGptOpaqueReplay');

      probe.checked = true;
      probe.dispatchEvent(new Event('change'));
      replay.checked = true;
      replay.dispatchEvent(new Event('change'));
      expect(probe.checked).toBe(false);
      expect(replay.checked).toBe(true);

      probe.checked = true;
      probe.dispatchEvent(new Event('change'));
      expect(probe.checked).toBe(true);
      expect(replay.checked).toBe(false);
    });

    it('persists output destination switches immediately', async () => {
      await initWithDefaults();

      const obsidian = el<HTMLInputElement>('outputObsidian');
      obsidian.checked = false;
      obsidian.dispatchEvent(new Event('change'));

      await vi.waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith({
          action: 'updateOutputOptions',
          outputOptions: { obsidian: false, file: false, clipboard: true },
        })
      );
      expect(statusEl().textContent).toBe('status_settingsSaved');
    });

    it('serializes rapid output changes so the final selection wins', async () => {
      await initWithDefaults();

      const obsidian = el<HTMLInputElement>('outputObsidian');
      const file = el<HTMLInputElement>('outputFile');
      obsidian.checked = false;
      obsidian.dispatchEvent(new Event('change'));
      file.checked = true;
      file.dispatchEvent(new Event('change'));

      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
      expect(vi.mocked(sendMessage).mock.calls).toEqual([
        [
          {
            action: 'updateOutputOptions',
            outputOptions: { obsidian: false, file: false, clipboard: true },
          },
        ],
        [
          {
            action: 'updateOutputOptions',
            outputOptions: { obsidian: false, file: true, clipboard: true },
          },
        ],
      ]);
    });

    it('saves other collected settings without resending an unchanged loaded key', async () => {
      await initWithDefaults();
      const { obsidianApiKey: _unchangedKey, ...syncSettings } = storedSettings;

      el<HTMLInputElement>('vaultPath').value = '  AI/Claude  ';
      el<HTMLButtonElement>('saveBtn').click();

      await vi.waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith({
          action: 'saveSettings',
          settings: {
            ...syncSettings,
            vaultPath: 'AI/Claude',
            outputOptions: { obsidian: true, file: false, clipboard: true },
            templateOptions: {
              ...storedSettings.templateOptions,
              filenameScheme: 'title-id',
            },
          },
        })
      );
      expect(statusEl().textContent).toBe('status_settingsSaved');
      expect(statusEl().className).toBe('status success');
      expect(el<HTMLButtonElement>('saveBtn').disabled).toBe(false);
    });

    it('omits an unchanged blank key while saving other settings', async () => {
      await initWithDefaults({
        ...storedSettings,
        obsidianApiKey: '',
        outputOptions: { obsidian: false, file: true, clipboard: false },
      });

      el<HTMLInputElement>('vaultPath').value = 'AI/Updated';
      el<HTMLButtonElement>('saveBtn').click();

      await vi.waitFor(() => expect(statusEl().textContent).toBe('status_settingsSaved'));
      expect(settingsSaveAt(0)).not.toHaveProperty('obsidianApiKey');
      expect(settingsSaveAt(0).vaultPath).toBe('AI/Updated');
    });

    it('preserves a key migrated after the popup opened with a blank field', async () => {
      await initWithDefaults({
        ...storedSettings,
        obsidianApiKey: '',
        outputOptions: { obsidian: false, file: true, clipboard: false },
      });

      // Migration finishes after the popup's initial local-only read. Model
      // the background's explicit-key write authority without repopulating UI.
      let backgroundApiKey = VALID_API_KEY;
      vi.mocked(sendMessage).mockImplementation(async message => {
        if (message.action === 'saveSettings' && message.settings.obsidianApiKey !== undefined) {
          backgroundApiKey = message.settings.obsidianApiKey;
        }
        return { success: true } as never;
      });

      el<HTMLInputElement>('vaultPath').value = 'AI/AfterMigration';
      el<HTMLButtonElement>('saveBtn').click();

      await vi.waitFor(() => expect(statusEl().textContent).toBe('status_settingsSaved'));
      expect(el<HTMLInputElement>('apiKey').value).toBe('');
      expect(settingsSaveAt(0)).not.toHaveProperty('obsidianApiKey');
      expect(settingsSaveAt(0).vaultPath).toBe('AI/AfterMigration');
      expect(backgroundApiKey).toBe(VALID_API_KEY);
    });

    it('includes a newly entered key instead of treating an initially blank field as a clear', async () => {
      await initWithDefaults({ ...storedSettings, obsidianApiKey: '' });

      el<HTMLInputElement>('apiKey').value = `  ${VALID_API_KEY}  `;
      el<HTMLButtonElement>('saveBtn').click();

      await vi.waitFor(() => expect(statusEl().textContent).toBe('status_settingsSaved'));
      expect(settingsSaveAt(0)).toHaveProperty('obsidianApiKey', VALID_API_KEY);
    });

    it('includes an explicit clear when a loaded key is erased with Obsidian output disabled', async () => {
      await initWithDefaults();

      el<HTMLInputElement>('outputObsidian').checked = false;
      el<HTMLInputElement>('apiKey').value = '';
      el<HTMLButtonElement>('saveBtn').click();

      await vi.waitFor(() => expect(statusEl().textContent).toBe('status_settingsSaved'));
      expect(settingsSaveAt(0)).toHaveProperty('obsidianApiKey', '');
    });

    it('updates the key baseline only after a successful explicit save, including a later revert', async () => {
      await initWithDefaults();
      const replacementKey = 'b'.repeat(32);
      el<HTMLInputElement>('apiKey').value = replacementKey;
      el<HTMLButtonElement>('saveBtn').click();

      await vi.waitFor(() => expect(statusEl().textContent).toBe('status_settingsSaved'));
      expect(settingsSaveAt(0)).toHaveProperty('obsidianApiKey', replacementKey);

      el<HTMLButtonElement>('saveBtn').click();
      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(el<HTMLButtonElement>('saveBtn').disabled).toBe(false));
      expect(settingsSaveAt(1)).not.toHaveProperty('obsidianApiKey');

      el<HTMLInputElement>('apiKey').value = VALID_API_KEY;
      el<HTMLButtonElement>('saveBtn').click();
      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(3));
      expect(settingsSaveAt(2)).toHaveProperty('obsidianApiKey', VALID_API_KEY);
    });

    it('retries an explicit key write after a failed save without advancing the baseline', async () => {
      await initWithDefaults();
      const replacementKey = 'b'.repeat(32);
      vi.mocked(sendMessage).mockResolvedValueOnce({ success: false } as never);

      el<HTMLInputElement>('apiKey').value = replacementKey;
      el<HTMLButtonElement>('saveBtn').click();
      await vi.waitFor(() => expect(statusEl().textContent).toBe('toast_error_saveFailed'));

      el<HTMLButtonElement>('saveBtn').click();
      await vi.waitFor(() => expect(statusEl().textContent).toBe('status_settingsSaved'));
      expect(settingsSaveAt(0)).toHaveProperty('obsidianApiKey', replacementKey);
      expect(settingsSaveAt(1)).toHaveProperty('obsidianApiKey', replacementKey);
    });

    it('restores the displayed key after a rejected save may have partially committed another key', async () => {
      await initWithDefaults();
      const replacementKey = 'b'.repeat(32);
      let backgroundApiKey = VALID_API_KEY;
      let rejectAfterLocalWrite = true;
      vi.mocked(sendMessage).mockImplementation(async message => {
        if (message.action !== 'saveSettings') return { success: true } as never;
        if (message.settings.obsidianApiKey !== undefined) {
          backgroundApiKey = message.settings.obsidianApiKey;
        }
        if (rejectAfterLocalWrite) {
          rejectAfterLocalWrite = false;
          return { success: false, error: 'sync write failed after local key write' } as never;
        }
        return { success: true } as never;
      });

      el<HTMLInputElement>('apiKey').value = replacementKey;
      el<HTMLButtonElement>('saveBtn').click();
      await vi.waitFor(() =>
        expect(statusEl().textContent).toBe('sync write failed after local key write')
      );
      expect(backgroundApiKey).toBe(replacementKey);

      el<HTMLInputElement>('apiKey').value = VALID_API_KEY;
      el<HTMLButtonElement>('saveBtn').click();
      await vi.waitFor(() => expect(statusEl().textContent).toBe('status_settingsSaved'));
      expect(settingsSaveAt(1)).toHaveProperty('obsidianApiKey', VALID_API_KEY);
      expect(backgroundApiKey).toBe(VALID_API_KEY);
    });

    it('collects the selected filename scheme into templateOptions (#328)', async () => {
      await initWithDefaults();

      el<HTMLSelectElement>('filenameScheme').value = 'title-date';
      el<HTMLButtonElement>('saveBtn').click();

      await vi.waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith({
          action: 'saveSettings',
          settings: expect.objectContaining({
            templateOptions: expect.objectContaining({ filenameScheme: 'title-date' }),
          }),
        })
      );
    });

    it('rejects saving when no output destination is selected', async () => {
      await initWithDefaults();

      for (const id of ['outputObsidian', 'outputFile', 'outputClipboard']) {
        el<HTMLInputElement>(id).checked = false;
      }
      el<HTMLButtonElement>('saveBtn').click();

      await vi.waitFor(() => expect(statusEl().textContent).toBe('error_noOutputSelected'));
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('rejects an API key shorter than the security minimum', async () => {
      await initWithDefaults();

      el<HTMLInputElement>('apiKey').value = 'short';
      el<HTMLButtonElement>('saveBtn').click();

      await vi.waitFor(() => expect(statusEl().className).toBe('status error'));
      expect(statusEl().textContent).toContain('too short');
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('skips Obsidian validation when Obsidian output is disabled', async () => {
      buildPopupDom();
      vi.mocked(getSettings).mockResolvedValue({
        ...storedSettings,
        obsidianApiKey: '',
        outputOptions: { obsidian: false, file: true, clipboard: false },
      });
      await initPopup();

      el<HTMLButtonElement>('saveBtn').click();

      await vi.waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'saveSettings' })
        )
      );
      expect(statusEl().textContent).toBe('status_settingsSaved');
    });

    it('shows an error status when persisting settings fails', async () => {
      await initWithDefaults();
      vi.mocked(sendMessage).mockResolvedValue({ success: false } as never);

      el<HTMLButtonElement>('saveBtn').click();

      await vi.waitFor(() => expect(statusEl().className).toBe('status error'));
      expect(statusEl().textContent).toBe('toast_error_saveFailed');
      expect(el<HTMLButtonElement>('saveBtn').disabled).toBe(false);
    });

    it('does not make the key uncertain when a key-omitting settings save fails', async () => {
      await initWithDefaults();
      vi.mocked(sendMessage).mockResolvedValueOnce({ success: false } as never);

      el<HTMLButtonElement>('saveBtn').click();
      await vi.waitFor(() => expect(statusEl().textContent).toBe('toast_error_saveFailed'));
      expect(settingsSaveAt(0)).not.toHaveProperty('obsidianApiKey');

      el<HTMLButtonElement>('saveBtn').click();
      await vi.waitFor(() => expect(statusEl().textContent).toBe('status_settingsSaved'));
      expect(settingsSaveAt(1)).not.toHaveProperty('obsidianApiKey');
    });
  });

  describe('test connection flow', () => {
    it('saves settings then reports a successful connection', async () => {
      await initWithDefaults();
      vi.mocked(sendMessage).mockResolvedValue({ success: true });

      el<HTMLButtonElement>('testBtn').click();

      await vi.waitFor(() => expect(statusEl().textContent).toBe('status_connectionSuccess'));
      expect(sendMessage).toHaveBeenCalledWith({
        action: 'saveSettings',
        settings: expect.objectContaining({ obsidianApiKey: VALID_API_KEY }),
      });
      expect(sendMessage).toHaveBeenCalledWith({ action: 'testConnection' });
      expect(el<HTMLButtonElement>('testBtn').disabled).toBe(false);
    });

    it('explicitly saves the entered validated key and advances the baseline before a later ordinary save', async () => {
      await initWithDefaults();
      const replacementKey = 'b'.repeat(32);

      el<HTMLInputElement>('apiKey').value = `  ${replacementKey}  `;
      el<HTMLButtonElement>('testBtn').click();
      await vi.waitFor(() => expect(statusEl().textContent).toBe('status_connectionSuccess'));
      expect(settingsSaveAt(0)).toHaveProperty('obsidianApiKey', replacementKey);
      expect(sendMessage).toHaveBeenNthCalledWith(2, { action: 'testConnection' });

      el<HTMLButtonElement>('saveBtn').click();
      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(3));
      expect(settingsSaveAt(2)).not.toHaveProperty('obsidianApiKey');
    });

    it('prevents a reverted ordinary save from racing a pending connection-key write', async () => {
      await initWithDefaults();
      const replacementKey = 'b'.repeat(32);
      let resolveKeySave: ((value: { success: true }) => void) | undefined;
      const pendingKeySave = new Promise<{ success: true }>(resolve => {
        resolveKeySave = resolve;
      });
      vi.mocked(sendMessage).mockImplementation(message =>
        message.action === 'saveSettings'
          ? (pendingKeySave as never)
          : Promise.resolve({ success: true } as never)
      );

      el<HTMLInputElement>('apiKey').value = replacementKey;
      el<HTMLButtonElement>('testBtn').click();
      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
      expect(settingsSaveAt(0)).toHaveProperty('obsidianApiKey', replacementKey);
      expect(el<HTMLButtonElement>('testBtn').disabled).toBe(true);
      expect(el<HTMLButtonElement>('saveBtn').disabled).toBe(true);

      el<HTMLInputElement>('apiKey').value = VALID_API_KEY;
      el<HTMLButtonElement>('saveBtn').click();
      await Promise.resolve();
      expect(sendMessage).toHaveBeenCalledTimes(1);

      resolveKeySave?.({ success: true });
      await vi.waitFor(() => expect(statusEl().textContent).toBe('status_connectionSuccess'));
      expect(sendMessage).toHaveBeenNthCalledWith(2, { action: 'testConnection' });
      expect(el<HTMLButtonElement>('testBtn').disabled).toBe(false);
      expect(el<HTMLButtonElement>('saveBtn').disabled).toBe(false);

      el<HTMLButtonElement>('saveBtn').click();
      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(3));
      expect(settingsSaveAt(2)).toHaveProperty('obsidianApiKey', VALID_API_KEY);
    });

    it('forces the displayed key after the connection settings save is rejected', async () => {
      await initWithDefaults();
      const replacementKey = 'b'.repeat(32);
      vi.mocked(sendMessage).mockResolvedValueOnce({ success: false } as never);

      el<HTMLInputElement>('apiKey').value = replacementKey;
      el<HTMLButtonElement>('testBtn').click();
      await vi.waitFor(() => expect(statusEl().textContent).toBe('toast_error_saveFailed'));

      el<HTMLInputElement>('apiKey').value = VALID_API_KEY;
      el<HTMLButtonElement>('saveBtn').click();
      await vi.waitFor(() => expect(statusEl().textContent).toBe('status_settingsSaved'));
      expect(settingsSaveAt(0)).toHaveProperty('obsidianApiKey', replacementKey);
      expect(settingsSaveAt(1)).toHaveProperty('obsidianApiKey', VALID_API_KEY);
      expect(sendMessage).not.toHaveBeenCalledWith({ action: 'testConnection' });
    });

    it('reports the backend error when the connection test fails', async () => {
      await initWithDefaults();
      vi.mocked(sendMessage)
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'Invalid API key' });

      el<HTMLButtonElement>('testBtn').click();

      await vi.waitFor(() => expect(statusEl().textContent).toBe('Invalid API key'));
      expect(statusEl().className).toBe('status error');

      el<HTMLButtonElement>('saveBtn').click();
      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(3));
      expect(settingsSaveAt(2)).not.toHaveProperty('obsidianApiKey');
    });

    it('does not test the connection after the settings route rejects the save', async () => {
      await initWithDefaults();
      vi.mocked(sendMessage).mockResolvedValue({
        success: false,
        error: 'Could not save settings',
      } as never);

      el<HTMLButtonElement>('testBtn').click();

      await vi.waitFor(() => expect(statusEl().textContent).toBe('Could not save settings'));
      expect(vi.mocked(sendMessage).mock.calls).toEqual([
        [
          {
            action: 'saveSettings',
            settings: expect.objectContaining({ obsidianApiKey: VALID_API_KEY }),
          },
        ],
      ]);
    });

    it('warns and skips the test when no API key is entered', async () => {
      await initWithDefaults();

      el<HTMLInputElement>('apiKey').value = '';
      el<HTMLButtonElement>('testBtn').click();

      await vi.waitFor(() => expect(statusEl().textContent).toBe('toast_error_noApiKey'));
      expect(statusEl().className).toBe('status warning');
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('rejects invalid Obsidian settings before testing', async () => {
      await initWithDefaults();

      el<HTMLInputElement>('obsidianUrl').value = 'ftp://example.com';
      el<HTMLButtonElement>('testBtn').click();

      await vi.waitFor(() => expect(statusEl().className).toBe('status error'));
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('shows the thrown message when the test itself errors', async () => {
      await initWithDefaults();
      vi.mocked(sendMessage)
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(new Error('port closed'));

      el<HTMLButtonElement>('testBtn').click();

      await vi.waitFor(() => expect(statusEl().textContent).toBe('toast_error_connectionFailed'));
      expect(statusEl().className).toBe('status error');
    });
  });
});
