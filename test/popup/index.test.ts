/**
 * Popup application tests
 *
 * Drives the REAL src/popup/app.ts module: initPopup() queries a fixture DOM,
 * populates it from mocked storage, and wires the save/test flows. The
 * index.ts entry shim stays a DOMContentLoaded one-liner.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ExtensionSettings, PopupSettingsUpdate } from '../../src/lib/types';

vi.mock('../../src/lib/storage', () => ({
  getSettingsOrThrow: vi.fn(),
}));

vi.mock('../../src/lib/messaging', () => ({
  sendMessage: vi.fn(),
}));

import { getSettingsOrThrow } from '../../src/lib/storage';
import { sendMessage } from '../../src/lib/messaging';
import { snapshotClaudeListProbeResult } from '../../src/lib/claude-list-probe-contract';
import { collectorSummary } from '../../src/lib/claude-account-collector-contract';
import {
  handleCollectorClick,
  handleTrustedClaudeListProbeClick,
  handleTrustedDotsSchemaProbeClick,
  initPopup,
  runClaudeListProbe,
  runDotsSchemaProbe,
} from '../../src/popup/app';
import { validateMessageContent } from '../../src/background/validation';

const collectorClickSource = {
  tabId: 17,
  windowId: 3,
  url: 'https://claude.ai/chat/11111111-1111-4111-8111-111111111111',
};
function installCollectorTab() {
  chrome.tabs.query = vi.fn(async () => [
    {
      id: collectorClickSource.tabId,
      windowId: collectorClickSource.windowId,
      url: collectorClickSource.url,
      active: true,
    },
  ]) as never;
}
const VALID_API_KEY = 'a'.repeat(32);
const CLAUDE_FINGERPRINT_PREFIX = 'claude-probe-scope-run-v1-sha256:';
const CLAUDE_FINGERPRINT = `${CLAUDE_FINGERPRINT_PREFIX}${'a'.repeat(64)}`;
const OTHER_CLAUDE_FINGERPRINT = `${CLAUDE_FINGERPRINT_PREFIX}${'b'.repeat(64)}`;

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
  enableHtmlExport: false,
  enableTextExport: false,
  enableInertCodeBlocks: true,
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
  'enableInertCodeBlocks',
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
    <label class="toggle-row" id="htmlExportRow">
      <span class="toggle-label">
        <span data-i18n="settings_enableHtmlExport">Canonical HTML reading view</span>
        <span class="toggle-sublabel" data-i18n="settings_htmlExportHelp">
          Add an offline HTML companion alongside Markdown for structured ChatGPT and DeepSeek File snapshots only. Not PDF, Obsidian, or Clipboard.
        </span>
      </span>
      <span class="toggle-switch">
        <input type="checkbox" id="enableHtmlExport" role="switch" aria-checked="false" aria-disabled="true" disabled />
        <span class="slider" aria-hidden="true"></span>
      </span>
    </label>
    <label class="toggle-row" id="textExportRow">
      <span class="toggle-label">
        <span data-i18n="settings_enableTextExport">Canonical plain-text reading view</span>
        <span class="toggle-sublabel" data-i18n="settings_textExportHelp">Plain-text help</span>
      </span>
      <span class="toggle-switch">
        <input type="checkbox" id="enableTextExport" role="switch" aria-checked="false" aria-disabled="true" disabled />
      </span>
    </label>
    <span data-i18n="settings_enableInertCodeBlocks">Show tagged code blocks as literal source</span>
    <span data-i18n="settings_inertCodeBlocksHelp">Tagged fence help</span>
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
    <button id="openReconciliationBtn"></button>
    <button id="probeDotsSchemaBtn"></button>
    <button id="probeClaudeListsBtn"></button>
    <button id="collectClaudeAccountCatalogBtn"></button>
    <div id="claudeListEvidence" hidden></div>
    <div id="status" class="status"></div>
  `;
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function statusEl(): HTMLDivElement {
  return el<HTMLDivElement>('status');
}

function claudeListProbeFixture() {
  return {
    success: true,
    data: {
      schema: 'liska-claude-list-probe/5',
      status: 'stopped',
      code: 'scope-observed',
      verificationPresent: true,
      routeOrganizationEvidence: 'verification-link',
      counts: {
        dispatch: 2,
        page: 2,
        record: 7,
        validUuid: 7,
        marker: 6,
        archivedFlag: 5,
        duplicate: 0,
        overlap: 0,
        archivedMismatch: 1,
      },
      pages: [
        {
          partition: 'active',
          offset: 0,
          hasMore: false,
          terminal: true,
          scopeFingerprint: CLAUDE_FINGERPRINT,
          counts: { record: 4, validUuid: 4, marker: 3, archivedFlag: 2, archivedMismatch: 1 },
        },
        {
          partition: 'archived',
          offset: 0,
          hasMore: false,
          terminal: true,
          scopeFingerprint: CLAUDE_FINGERPRINT,
          counts: { record: 3, validUuid: 3, marker: 3, archivedFlag: 3, archivedMismatch: 0 },
        },
      ],
      pagination: {
        exercised: false,
        hypothesis: 'not-exercised',
        unfinished: false,
      },
      scope: {
        observed: true,
        fingerprint: CLAUDE_FINGERPRINT,
        relevantHeaderNames: [
          'anthropic-organization-id',
          'anthropic-workspace-id',
          'x-organization-workspace-id',
        ],
      },
    },
  } as const;
}

function useClaudeEvidenceMessages(locale: 'en' | 'ja' = 'en'): void {
  const messages = JSON.parse(
    readFileSync(`src/_locales/${locale}/messages.json`, 'utf8')
  ) as Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;
  vi.mocked(chrome.i18n.getMessage).mockImplementation((key, substitutions) => {
    if (!key.startsWith('claudeListEvidence') && !key.startsWith('status_claudeListProbe'))
      return key;
    const entry = messages[key];
    if (!entry) return '';
    const values = typeof substitutions === 'string' ? [substitutions] : (substitutions ?? []);
    return entry.message.replace(/\$([A-Z]+)\$/gu, (_match, placeholder: string) => {
      const content = entry.placeholders?.[placeholder.toLowerCase()]?.content ?? '';
      return values[Number(content.slice(1)) - 1] ?? '';
    });
  });
}

function expectNoSensitiveProbeValues(values: readonly string[]): void {
  const elements = [...document.querySelectorAll('*')];
  const attributes = elements.flatMap(element =>
    [...element.attributes].map(attribute => `${attribute.name}=${attribute.value}`)
  );
  const accessibilityMarkup = elements.flatMap(element => [
    element.textContent ?? '',
    element.getAttribute('title') ?? '',
    ...[...element.attributes]
      .filter(attribute => attribute.name.startsWith('aria-'))
      .map(attribute => attribute.value),
  ]);
  for (const value of values) {
    expect(document.body.textContent).not.toContain(value);
    expect(document.body.innerHTML).not.toContain(value);
    expect(document.documentElement.outerHTML).not.toContain(value);
    expect(attributes.join('\n')).not.toContain(value);
    expect(accessibilityMarkup.join('\n')).not.toContain(value);
    expect(JSON.stringify(vi.mocked(chrome.i18n.getMessage).mock.calls)).not.toContain(value);
  }
}

async function initWithDefaults(settings: ExtensionSettings = storedSettings): Promise<void> {
  buildPopupDom();
  vi.mocked(getSettingsOrThrow).mockResolvedValue(settings);
  await initPopup();
}

function settingsSaveAt(index: number): PopupSettingsUpdate {
  const message = vi.mocked(sendMessage).mock.calls[index]?.[0];
  if (message?.action !== 'saveSettings') throw new Error('Expected a settings-save message');
  return message.settings;
}

describe('canonical HTML popup setting markup', () => {
  it('places the initially hidden Claude evidence in the scrollable archive tools', () => {
    const popup = new DOMParser().parseFromString(
      readFileSync('src/popup/index.html', 'utf8'),
      'text/html'
    );
    const probe = popup.getElementById('probeClaudeListsBtn');
    const evidence = popup.getElementById('claudeListEvidence');
    expect(probe?.nextElementSibling).toBe(evidence);
    expect(evidence?.hasAttribute('hidden')).toBe(true);
    expect(evidence?.closest('.archive-tools')).not.toBeNull();
    expect(evidence?.closest('#settingsPanel.settings')).not.toBeNull();
    expect(evidence?.closest('footer')).toBeNull();
    expect(evidence?.querySelector('button')).toBeNull();

    for (const locale of ['en', 'ja']) {
      const messages = JSON.parse(
        readFileSync(`src/_locales/${locale}/messages.json`, 'utf8')
      ) as Record<string, { message: string }>;
      for (const key of [
        'claudeListEvidencePage',
        'claudeListEvidenceDuplicates',
        'claudeListEvidencePagination',
        'claudeListEvidencePaginationNotExercised',
        'claudeListEvidencePaginationOffsetPlus30',
        'claudeListEvidenceHeaderPairObserved',
        'claudeListEvidenceHeaderPairNotObserved',
        'claudeListEvidenceHeaders',
        'claudeListEvidenceNoneObserved',
        'status_claudeListProbeHeaderPairObserved',
        'status_claudeListProbeHeaderPairNotObserved',
      ]) {
        expect(messages[key]?.message).toBeTruthy();
      }
    }
  });

  it('provides a localized opt-in toggle and help text in English and Japanese', () => {
    const html = readFileSync('src/popup/index.html', 'utf8');
    const popup = new DOMParser().parseFromString(html, 'text/html');
    const english = JSON.parse(readFileSync('src/_locales/en/messages.json', 'utf8')) as Record<
      string,
      { message: string }
    >;
    const japanese = JSON.parse(readFileSync('src/_locales/ja/messages.json', 'utf8')) as Record<
      string,
      { message: string }
    >;

    const toggle = popup.getElementById('enableHtmlExport');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('role')).toBe('switch');
    expect(toggle?.hasAttribute('checked')).toBe(false);
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
    expect(popup.querySelector('[data-i18n="settings_enableHtmlExport"]')).not.toBeNull();
    expect(popup.querySelector('[data-i18n="settings_htmlExportHelp"]')).not.toBeNull();
    expect(english.settings_enableHtmlExport.message).toBe('Canonical HTML reading view');
    expect(english.settings_htmlExportHelp.message).toContain('alongside Markdown');
    expect(english.settings_htmlExportHelp.message).toContain(
      'ChatGPT and DeepSeek File snapshots only'
    );
    expect(english.settings_htmlExportHelp.message).toContain('Not PDF, Obsidian, or Clipboard');
    expect(japanese.settings_enableHtmlExport.message).toContain('HTML');
    expect(japanese.settings_htmlExportHelp.message).toContain('Markdown');
    expect(japanese.settings_htmlExportHelp.message).toContain('ChatGPT / DeepSeek');
    expect(japanese.settings_htmlExportHelp.message).toContain('PDF');
    expect(japanese.settings_htmlExportHelp.message).toContain('クリップボード');

    const textToggle = popup.getElementById('enableTextExport');
    expect(textToggle?.getAttribute('role')).toBe('switch');
    expect(textToggle?.hasAttribute('checked')).toBe(false);
    expect(popup.querySelector('[data-i18n="settings_enableTextExport"]')).not.toBeNull();
    expect(english.settings_enableTextExport.message).toContain('plain-text');
    expect(english.settings_textExportHelp.message).toContain('current or selected');
    expect(english.settings_textExportHelp.message).toContain('Not all branches');
    expect(japanese.settings_textExportHelp.message).toContain('全ブランチ');
  });

  it('provides an always-available default-on tagged-fence switch with honest limits', () => {
    const html = readFileSync('src/popup/index.html', 'utf8');
    const popup = new DOMParser().parseFromString(html, 'text/html');
    const english = JSON.parse(readFileSync('src/_locales/en/messages.json', 'utf8')) as Record<
      string,
      { message: string }
    >;
    const toggle = popup.getElementById('enableInertCodeBlocks');

    expect(toggle?.getAttribute('role')).toBe('switch');
    expect(toggle?.hasAttribute('checked')).toBe(true);
    expect(toggle?.hasAttribute('disabled')).toBe(false);
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    expect(english.settings_enableInertCodeBlocks.message).toBe(
      'Show tagged code blocks as literal source'
    );
    for (const phrase of [
      'every language-tagged Markdown fence',
      'original fence, info string, content, and closing fence visible',
      'Ambiguous fence-like syntax is refused instead of saved',
      'syntax highlighting and special rendering',
      'Raw/canonical archives and canonical HTML stay unchanged',
      'Append refuses a pre-existing tagged block',
      'inline syntax, raw HTML, general postprocessors, or plugins that read files',
    ]) {
      expect(english.settings_inertCodeBlocksHelp.message).toContain(phrase);
    }
  });
});

describe('popup/app', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(chrome.i18n.getMessage).mockImplementation(key => key);
    vi.mocked(sendMessage).mockResolvedValue({ success: true } as never);
  });

  describe('initPopup', () => {
    it('retains Settings Test, Dots and Reconcile in a fallback-window URL', async () => {
      const previous = window.location.href;
      window.history.replaceState(null, '', '?surface=11111111-1111-4111-8111-111111111111');
      try {
        await initWithDefaults();
        expect(el<HTMLButtonElement>('testBtn').disabled).toBe(false);
        expect(el<HTMLButtonElement>('probeDotsSchemaBtn').disabled).toBe(false);
        el<HTMLButtonElement>('openReconciliationBtn').click();
        expect(chrome.tabs.create).toHaveBeenCalledWith({
          url: chrome.runtime.getURL('src/reconcile/index.html'),
        });
        el<HTMLButtonElement>('testBtn').click();
        await vi.waitFor(() =>
          expect(sendMessage).toHaveBeenCalledWith({ action: 'testConnection' })
        );
        await vi.waitFor(() => expect(el<HTMLButtonElement>('testBtn').disabled).toBe(false));
        vi.mocked(sendMessage).mockResolvedValueOnce({
          success: true,
          fileName: 'liska-dots-schema-probe.json',
        } as never);
        handleTrustedDotsSchemaProbeClick({ isTrusted: true } as Event, () => {
          void runDotsSchemaProbe();
        });
        await vi.waitFor(() =>
          expect(sendMessage).toHaveBeenCalledWith({ action: 'probeDotsSchema' })
        );
      } finally {
        window.history.replaceState(null, '', previous);
      }
    });
    it('populates the form from stored settings', async () => {
      await initWithDefaults();

      expect(el<HTMLInputElement>('apiKey').value).toBe(VALID_API_KEY);
      expect(el<HTMLInputElement>('obsidianUrl').value).toBe('http://127.0.0.1:27123');
      expect(el<HTMLInputElement>('vaultPath').value).toBe('AI/Gemini');
      expect(el<HTMLInputElement>('outputObsidian').checked).toBe(true);
      expect(el<HTMLInputElement>('outputClipboard').checked).toBe(true);
      expect(el<HTMLInputElement>('outputFile').checked).toBe(false);
      expect(el<HTMLInputElement>('enableHtmlExport').checked).toBe(false);
      expect(el<HTMLInputElement>('enableHtmlExport').disabled).toBe(true);
      expect(el<HTMLInputElement>('enableTextExport').checked).toBe(false);
      expect(el<HTMLInputElement>('enableTextExport').disabled).toBe(true);
      expect(el<HTMLInputElement>('enableInertCodeBlocks').checked).toBe(true);
      expect(el<HTMLInputElement>('enableInertCodeBlocks').disabled).toBe(false);
      expect(el<HTMLInputElement>('enableAutoScroll').checked).toBe(true);
      expect(el<HTMLInputElement>('enableChatGptOpaqueProbe').checked).toBe(false);
      expect(el<HTMLInputElement>('enableChatGptOpaqueReplay').checked).toBe(false);
      expect(el<HTMLInputElement>('includeTags').checked).toBe(false);
      expect(el<HTMLSelectElement>('messageFormat').value).toBe('callout');
    });

    it('opens the dedicated local reconciliation page', async () => {
      await initWithDefaults();

      el<HTMLButtonElement>('openReconciliationBtn').click();

      expect(chrome.runtime.getURL).toHaveBeenCalledWith('src/reconcile/index.html');
      expect(chrome.tabs.create).toHaveBeenCalledWith({
        url: 'chrome-extension://test-extension-id/src/reconcile/index.html',
      });
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('ignores a programmatic Dots probe click', async () => {
      await initWithDefaults();

      el<HTMLButtonElement>('probeDotsSchemaBtn').click();

      expect(sendMessage).not.toHaveBeenCalled();
      expect(statusEl().textContent).toBe('');
    });

    it('runs one trusted Dots probe and reports the fixed local-save result', async () => {
      await initWithDefaults();
      vi.mocked(sendMessage).mockResolvedValueOnce({
        success: true,
        fileName: 'liska-dots-schema-probe.json',
      } as never);

      handleTrustedDotsSchemaProbeClick({ isTrusted: true } as Event, () => {
        void runDotsSchemaProbe();
      });

      await vi.waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith({ action: 'probeDotsSchema' })
      );
      await vi.waitFor(() => expect(statusEl().textContent).toBe('status_dotsSchemaProbeSaved'));
      expect(statusEl().className).toBe('status success');
      expect(el<HTMLButtonElement>('probeDotsSchemaBtn').disabled).toBe(false);
    });

    it('ignores a programmatic Claude list probe click and sends nothing during initialization', async () => {
      await initWithDefaults();
      expect(sendMessage).not.toHaveBeenCalled();

      el<HTMLButtonElement>('probeClaudeListsBtn').click();

      expect(sendMessage).not.toHaveBeenCalled();
      expect(statusEl().textContent).toBe('');
    });

    it('renders only the validated saved counts, terminal facts and committed retention', async () => {
      installCollectorTab();
      await initWithDefaults();
      vi.mocked(sendMessage).mockResolvedValueOnce(
        collectorSummary('saved', { dispatch: 2, page: 2, target: 3, marker: 2 })
      );
      await handleCollectorClick({ isTrusted: true } as Event);
      expect(statusEl().textContent).toBe('status_collectorSaved status_collectorFacts');
      expect(chrome.i18n.getMessage).toHaveBeenCalledWith('status_collectorSaved', [
        'saved',
        '2',
        '2',
        '3',
        '2',
      ]);
      expect(chrome.i18n.getMessage).toHaveBeenCalledWith('status_collectorFacts', [
        'true',
        'true',
        'true',
        'owner-committed',
      ]);
    });

    it('sends nothing if the popup closes before resolving click-bound selection', async () => {
      await initWithDefaults();
      let finish!: (v: unknown) => void;
      chrome.tabs.query = vi.fn(
        () =>
          new Promise(resolve => {
            finish = resolve;
          })
      ) as never;
      const pending = handleCollectorClick({ isTrusted: true } as Event);
      window.dispatchEvent(new Event('pagehide'));
      finish([{ id: 17, windowId: 3, url: collectorClickSource.url, active: true }]);
      await pending;
      expect(sendMessage).not.toHaveBeenCalled();
    });
    it('refuses unbound, pending and nonexact popup selection without echoing its route', async () => {
      await initWithDefaults();
      const tab = { id: 17, windowId: 3, url: collectorClickSource.url, active: true };
      for (const tabs of [
        [],
        [tab, tab],
        [{ ...tab, active: false }],
        [{ ...tab, pendingUrl: tab.url + '?other' }],
        [{ ...tab, url: tab.url + '#fragment' }],
      ]) {
        chrome.tabs.query = vi.fn(async () => tabs) as never;
        await handleCollectorClick({ isTrusted: true } as Event);
        expect(sendMessage).not.toHaveBeenCalled();
        expect(statusEl().textContent).not.toContain(tab.url);
      }
    });
    it('discloses the one-click personal assertion and stores no content or settings', async () => {
      await initWithDefaults();
      const html = new DOMParser().parseFromString(
        readFileSync('src/popup/index.html', 'utf8'),
        'text/html'
      );
      expect(html.querySelector('#collectClaudeAccountCatalogBtn')?.textContent).toMatch(
        /current personal Claude context/i
      );
      for (const lang of ['en', 'ja']) {
        const messages = JSON.parse(
          readFileSync('src/_locales/' + lang + '/messages.json', 'utf8')
        );
        for (const key of [
          'settings_collectClaudeCatalog',
          'settings_collectClaudeCatalogHelp',
          'status_collectorRunning',
          'status_collectorSaved',
          'status_collectorCommittedStop',
          'status_collectorStopped',
          'status_collectorUnavailable',
        ])
          expect(messages[key]?.message).toBeTruthy();
      }
      installCollectorTab();
      el<HTMLButtonElement>('collectClaudeAccountCatalogBtn').click();
      expect(chrome.tabs.query).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
      let resolve!: (value: unknown) => void;
      vi.mocked(sendMessage).mockReturnValueOnce(
        new Promise(r => {
          resolve = r;
        }) as never
      );
      const pending = handleCollectorClick({ isTrusted: true } as Event);
      for (const id of [
        'collectClaudeAccountCatalogBtn',
        'probeClaudeListsBtn',
        'probeDotsSchemaBtn',
        'saveBtn',
        'testBtn',
      ])
        expect(el<HTMLButtonElement>(id).disabled).toBe(true);
      await runClaudeListProbe();
      await runDotsSchemaProbe();
      await handleCollectorClick({ isTrusted: true } as Event);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
      expect(sendMessage).toHaveBeenCalledWith({
        action: 'collectClaudeAccountCatalog',
        source: collectorClickSource,
      });
      resolve({ code: 'private header', active: [{ uuid: 'private target' }] });
      await pending;
      expect(statusEl().textContent).toBe('status_collectorStopped status_collectorFacts');
      expect(JSON.stringify(vi.mocked(chrome.i18n.getMessage).mock.calls)).not.toMatch(
        /private header|private target/
      );
      for (const id of [
        'collectClaudeAccountCatalogBtn',
        'probeClaudeListsBtn',
        'probeDotsSchemaBtn',
        'saveBtn',
        'testBtn',
      ])
        expect(el<HTMLButtonElement>(id).disabled).toBe(false);
    });

    it('keeps all conflicting controls busy for one trusted Claude list probe and renders safe counts', async () => {
      await initWithDefaults();
      let resolveProbe!: (value: unknown) => void;
      vi.mocked(sendMessage).mockReturnValueOnce(
        new Promise(resolve => {
          resolveProbe = resolve;
        }) as never
      );

      handleTrustedClaudeListProbeClick({ isTrusted: true } as Event, () => {
        void runClaudeListProbe();
      });
      await vi.waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith({ action: 'probeClaudeLists' })
      );
      expect(el<HTMLButtonElement>('probeClaudeListsBtn').disabled).toBe(true);
      expect(el<HTMLButtonElement>('probeDotsSchemaBtn').disabled).toBe(true);
      expect(el<HTMLButtonElement>('saveBtn').disabled).toBe(true);
      expect(el<HTMLButtonElement>('testBtn').disabled).toBe(true);
      await runClaudeListProbe();
      expect(sendMessage).toHaveBeenCalledOnce();

      resolveProbe(claudeListProbeFixture());
      await vi.waitFor(() => expect(statusEl().textContent).toBe('status_claudeListProbeResult'));
      expect(chrome.i18n.getMessage).toHaveBeenCalledWith(
        'status_claudeListProbeVerificationYes',
        undefined
      );
      expect(chrome.i18n.getMessage).toHaveBeenCalledWith(
        'status_claudeListProbeRouteVerificationLink',
        undefined
      );
      expect(chrome.i18n.getMessage).toHaveBeenCalledWith('status_claudeListProbeResult', [
        'stopped',
        'scope-observed',
        '2',
        '2',
        '7',
        'status_claudeListProbeHeaderPairObserved',
        'status_claudeListProbeVerificationYes',
        'status_claudeListProbeRouteVerificationLink',
      ]);
      expect(statusEl().className).toBe('status warning');
      expect(el<HTMLButtonElement>('probeClaudeListsBtn').disabled).toBe(false);
      expect(el<HTMLButtonElement>('probeDotsSchemaBtn').disabled).toBe(false);
      expect(el<HTMLButtonElement>('saveBtn').disabled).toBe(false);
      expect(el<HTMLButtonElement>('testBtn').disabled).toBe(false);
    });

    it.each([
      {
        locale: 'en' as const,
        observed: true,
        pair: 'header pair observed',
        verification: 'yes',
        route: 'verification link',
        line: 'Response header pair matched across this diagnostic. Account completeness is not established.',
        summary:
          'Claude list diagnostic: stopped (scope-observed); 2 requests, 2 pages, 7 records; header pair observed; verification banner observed yes; route evidence verification link.',
      },
      {
        locale: 'en' as const,
        observed: false,
        pair: 'header pair not observed',
        verification: 'yes',
        route: 'verification link',
        line: 'Response header pair was not established across this diagnostic. Account completeness is not established.',
        summary:
          'Claude list diagnostic: stopped (deadline-exceeded); 1 requests, 1 pages, 4 records; header pair not observed; verification banner observed yes; route evidence verification link.',
      },
      {
        locale: 'ja' as const,
        observed: true,
        pair: 'ヘッダーの組を観測',
        verification: 'あり',
        route: '検証リンク',
        line: 'この診断では応答ヘッダーの組が一貫して一致しました。アカウント全体の網羅性は確認されていません。',
        summary:
          'Claude リスト診断: stopped（scope-observed）、リクエスト 2 件、ページ 2 件、レコード 7 件、ヘッダーの組を観測、検証バナーの観測 あり、ルート根拠 検証リンク。',
      },
      {
        locale: 'ja' as const,
        observed: false,
        pair: 'ヘッダーの組は未観測',
        verification: 'あり',
        route: '検証リンク',
        line: 'この診断では応答ヘッダーの組の一貫した一致は確認されませんでした。アカウント全体の網羅性は確認されていません。',
        summary:
          'Claude リスト診断: stopped（deadline-exceeded）、リクエスト 1 件、ページ 1 件、レコード 4 件、ヘッダーの組は未観測、検証バナーの観測 あり、ルート根拠 検証リンク。',
      },
    ])(
      'shows only localized $locale pair evidence when observed=$observed',
      async ({ locale, observed, pair, verification, route, line, summary }) => {
        await initWithDefaults();
        useClaudeEvidenceMessages(locale);
        const fixture = claudeListProbeFixture();
        const firstPage = { ...fixture.data.pages[0], scopeFingerprint: OTHER_CLAUDE_FINGERPRINT };
        const result = observed
          ? fixture.data
          : {
              ...fixture.data,
              code: 'deadline-exceeded',
              counts: {
                ...firstPage.counts,
                dispatch: 1,
                page: 1,
                duplicate: 0,
                overlap: 0,
              },
              pages: [firstPage],
              scope: { ...fixture.data.scope, observed: false, fingerprint: null },
            };
        expect(snapshotClaudeListProbeResult(result)).toBeDefined();

        // The actual contract rejects these extra raw fields. Include them in a
        // mocked response to verify the renderer never serializes the payload.
        const rawOrganization = 'RAW-ORGANIZATION-VALUE-TEST';
        const rawWorkspace = 'RAW-WORKSPACE-VALUE-TEST';
        const ownerToken = 'OWNER-TOKEN-TEST';
        const response = {
          success: true,
          data: {
            ...result,
            ownerToken,
            scope: { ...result.scope, rawOrganization },
            pages: result.pages.map(page => ({ ...page, rawWorkspace })),
          },
        };
        const consoleSpies = (
          ['log', 'warn', 'error', 'info', 'debug', 'trace', 'dir', 'table'] as const
        ).map(method => vi.spyOn(console, method).mockImplementation(() => {}));
        const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        const writeText = vi.fn();
        const write = vi.fn();
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText, write },
        });
        try {
          vi.mocked(sendMessage).mockResolvedValueOnce(response as never);
          await runClaudeListProbe();

          expect(statusEl().textContent).toBe(summary);
          expect(statusEl().className).toBe('status warning');
          expect(el<HTMLElement>('claudeListEvidence').textContent?.split('\n')).toContain(line);
          expect(chrome.i18n.getMessage).toHaveBeenCalledWith('status_claudeListProbeResult', [
            'stopped',
            observed ? 'scope-observed' : 'deadline-exceeded',
            observed ? '2' : '1',
            observed ? '2' : '1',
            observed ? '7' : '4',
            pair,
            verification,
            route,
          ]);
          const sensitiveValues = [
            CLAUDE_FINGERPRINT_PREFIX,
            CLAUDE_FINGERPRINT,
            OTHER_CLAUDE_FINGERPRINT,
            'a'.repeat(64),
            'b'.repeat(64),
            rawOrganization,
            rawWorkspace,
            ownerToken,
          ];
          expectNoSensitiveProbeValues(sensitiveValues);
          expect(document.title).not.toContain(CLAUDE_FINGERPRINT_PREFIX);
          for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
          expect(writeText).not.toHaveBeenCalled();
          expect(write).not.toHaveBeenCalled();
          expect(sendMessage).toHaveBeenCalledOnce();
          expect(sendMessage).toHaveBeenCalledWith({ action: 'probeClaudeLists' });
        } finally {
          for (const spy of consoleSpies) spy.mockRestore();
          if (clipboardDescriptor)
            Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
          else Reflect.deleteProperty(navigator, 'clipboard');
        }
      }
    );

    it('renders admitted page evidence and the offset pagination hypothesis', async () => {
      await initWithDefaults();
      useClaudeEvidenceMessages();
      const fixture = claudeListProbeFixture();
      const result = {
        ...fixture.data,
        code: 'pagination-unfinished',
        scope: { ...fixture.data.scope, observed: false, fingerprint: null },
        counts: { ...fixture.data.counts, dispatch: 3, page: 3, duplicate: 2, overlap: 1 },
        pages: [
          { ...fixture.data.pages[0], hasMore: true, terminal: false },
          fixture.data.pages[1],
          {
            partition: 'active',
            offset: 30,
            hasMore: true,
            terminal: false,
            scopeFingerprint: CLAUDE_FINGERPRINT,
            counts: { record: 0, validUuid: 0, marker: 0, archivedFlag: 0, archivedMismatch: 0 },
          },
        ],
        pagination: { exercised: true, hypothesis: 'offset-plus-30', unfinished: true },
      } as const;
      expect(snapshotClaudeListProbeResult(result)).toBeDefined();
      vi.mocked(sendMessage).mockResolvedValueOnce({ success: true, data: result } as never);

      await runClaudeListProbe();

      const evidence = el<HTMLElement>('claudeListEvidence');
      expect(evidence.hidden).toBe(false);
      expect(evidence.textContent).toContain(
        'active · offset 0: 4 records; valid UUIDs 4; markers 3; boolean archive flags 2/4; mismatches 1; has more.'
      );
      expect(evidence.textContent).toContain(
        'active · offset 30: 0 records; valid UUIDs 0; markers 0; boolean archive flags 0/0; mismatches 0; has more.'
      );
      expect(evidence.textContent).toContain(
        'archived · offset 0: 3 records; valid UUIDs 3; markers 3; boolean archive flags 3/3; mismatches 0; terminal.'
      );
      expect(evidence.textContent).toContain('Duplicates 2; cross-partition overlap 1.');
      expect(evidence.textContent).toContain(
        'Pagination: offset + 30 hypothesis. Observed continuation still pending: yes.'
      );
      expect(evidence.textContent).toContain(
        'Response header pair was not established across this diagnostic. Account completeness is not established.'
      );
      expect(evidence.textContent).toContain(
        'Observed candidate header names — not scope proof: anthropic-organization-id, anthropic-workspace-id, x-organization-workspace-id.'
      );
      expect(sendMessage).toHaveBeenCalledOnce();
      expect(sendMessage).toHaveBeenCalledWith({ action: 'probeClaudeLists' });
    });

    it('never interprets candidate names as HTML even if a mocked response bypasses admission', async () => {
      await initWithDefaults();
      useClaudeEvidenceMessages();
      const fixture = claudeListProbeFixture();
      const unsafeName = '<img src=x onerror=alert(1)>';
      const result = {
        ...fixture.data,
        scope: { ...fixture.data.scope, relevantHeaderNames: [unsafeName] },
      };
      expect(snapshotClaudeListProbeResult(result)).toBeUndefined();
      vi.mocked(sendMessage).mockResolvedValueOnce({ success: true, data: result } as never);

      await runClaudeListProbe();

      const evidence = el<HTMLElement>('claudeListEvidence');
      expect(evidence.textContent).toContain(
        `Observed candidate header names — not scope proof: ${unsafeName}.`
      );
      expect(evidence.children).toHaveLength(0);
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    it('labels unexercised pagination and an empty candidate-name list as observations', async () => {
      await initWithDefaults();
      useClaudeEvidenceMessages();
      const fixture = claudeListProbeFixture();
      expect(snapshotClaudeListProbeResult(fixture.data)).toBeDefined();
      const page = fixture.data.pages[0];
      vi.mocked(sendMessage).mockResolvedValueOnce({
        ...fixture,
        data: {
          ...fixture.data,
          code: 'deadline-exceeded',
          counts: { ...page.counts, dispatch: 1, page: 1, duplicate: 0, overlap: 0 },
          pages: [page],
          scope: { observed: false, fingerprint: null, relevantHeaderNames: [] },
        },
      } as never);

      await runClaudeListProbe();

      const evidence = el<HTMLElement>('claudeListEvidence');
      expect(evidence.textContent).toContain(
        'Pagination: not exercised. Observed continuation still pending: no.'
      );
      expect(evidence.textContent).toContain(
        'Observed candidate header names — not scope proof: none observed.'
      );
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    it('keeps a no-pending result scoped to observed continuations with zero or partial pages', async () => {
      await initWithDefaults();
      useClaudeEvidenceMessages();
      const fixture = claudeListProbeFixture();
      const page = fixture.data.pages[0];
      const cases = [
        {
          ...fixture.data,
          code: 'deadline-exceeded',
          counts: {
            dispatch: 0,
            page: 0,
            record: 0,
            validUuid: 0,
            marker: 0,
            archivedFlag: 0,
            duplicate: 0,
            overlap: 0,
            archivedMismatch: 0,
          },
          pages: [],
          scope: { observed: false, fingerprint: null, relevantHeaderNames: [] },
        },
        {
          ...fixture.data,
          code: 'deadline-exceeded',
          scope: { ...fixture.data.scope, observed: false, fingerprint: null },
          counts: { ...page.counts, dispatch: 1, page: 1, duplicate: 0, overlap: 0 },
          pages: [page],
        },
      ];
      for (const result of cases) {
        expect(snapshotClaudeListProbeResult(result)).toBeDefined();
        vi.mocked(sendMessage).mockResolvedValueOnce({ success: true, data: result } as never);
        await runClaudeListProbe();
        expect(el<HTMLElement>('claudeListEvidence').textContent).toContain(
          'Pagination: not exercised. Observed continuation still pending: no.'
        );
      }
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    it('renders localized Japanese page and scope evidence', async () => {
      await initWithDefaults();
      useClaudeEvidenceMessages('ja');
      const fixture = claudeListProbeFixture();
      const page = fixture.data.pages[0];
      vi.mocked(sendMessage).mockResolvedValueOnce({
        ...fixture,
        data: {
          ...fixture.data,
          code: 'deadline-exceeded',
          counts: { ...page.counts, dispatch: 1, page: 1, duplicate: 0, overlap: 0 },
          pages: [page],
          scope: { observed: false, fingerprint: null, relevantHeaderNames: [] },
        },
      } as never);

      await runClaudeListProbe();

      const evidence = el<HTMLElement>('claudeListEvidence');
      expect(evidence.textContent).toContain('アクティブ・オフセット 0');
      expect(evidence.textContent).toContain('真偽値のアーカイブフラグ 2/4');
      expect(evidence.textContent).toContain(
        'ページネーション: 未実行。観測された続きは未取得: いいえ。'
      );
      expect(evidence.textContent).toContain(
        'この診断では応答ヘッダーの組の一貫した一致は確認されませんでした。アカウント全体の網羅性は確認されていません。'
      );
      expect(evidence.textContent).toContain(
        '候補ヘッダー名（スコープの証明ではありません）: 観測なし。'
      );
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    it('clears previous evidence on a new run and after result or transport failure', async () => {
      await initWithDefaults();
      useClaudeEvidenceMessages();
      const evidence = el<HTMLElement>('claudeListEvidence');
      vi.mocked(sendMessage).mockResolvedValueOnce(claudeListProbeFixture() as never);
      await runClaudeListProbe();
      expect(evidence.hidden).toBe(false);
      expect(evidence.textContent).not.toBe('');

      let resolveProbe!: (value: unknown) => void;
      vi.mocked(sendMessage).mockReturnValueOnce(
        new Promise(resolve => {
          resolveProbe = resolve;
        }) as never
      );
      const pending = runClaudeListProbe();
      expect(evidence.hidden).toBe(true);
      expect(evidence.textContent).toBe('');
      resolveProbe({ success: false, code: 'result-invalid' });
      await pending;
      expect(evidence.hidden).toBe(true);
      expect(evidence.textContent).toBe('');
      expect(statusEl().className).toBe('status error');

      vi.mocked(sendMessage).mockResolvedValueOnce(claudeListProbeFixture() as never);
      await runClaudeListProbe();
      expect(evidence.hidden).toBe(false);
      vi.mocked(sendMessage).mockRejectedValueOnce(new Error('transport unavailable'));
      await runClaudeListProbe();
      expect(evidence.hidden).toBe(true);
      expect(evidence.textContent).toBe('');
      expect(statusEl().className).toBe('status error');
      expect(sendMessage).toHaveBeenCalledTimes(4);
      for (const [message] of vi.mocked(sendMessage).mock.calls) {
        expect(message).toEqual({ action: 'probeClaudeLists' });
      }
    });

    it('keeps settings actions disabled until the strict read succeeds', async () => {
      buildPopupDom();
      let resolveSettings!: (settings: ExtensionSettings) => void;
      vi.mocked(getSettingsOrThrow).mockReturnValue(
        new Promise(resolve => {
          resolveSettings = resolve;
        })
      );

      const initialization = initPopup();

      expect(el<HTMLButtonElement>('saveBtn').disabled).toBe(true);
      expect(el<HTMLButtonElement>('testBtn').disabled).toBe(true);
      expect(el<HTMLInputElement>('vaultPath').value).toBe('');
      expect(sendMessage).not.toHaveBeenCalled();

      resolveSettings(storedSettings);
      await initialization;

      expect(el<HTMLButtonElement>('saveBtn').disabled).toBe(false);
      expect(el<HTMLButtonElement>('testBtn').disabled).toBe(false);
      expect(el<HTMLInputElement>('vaultPath').value).toBe('AI/Gemini');
    });

    it('initializes an editable default form for genuinely empty storage', async () => {
      buildPopupDom();
      const storage =
        await vi.importActual<typeof import('../../src/lib/storage')>('../../src/lib/storage');
      vi.mocked(getSettingsOrThrow).mockImplementation(storage.getSettingsOrThrow);
      vi.mocked(chrome.storage.local.get).mockResolvedValue({});
      vi.mocked(chrome.storage.sync.get).mockResolvedValue({});

      await initPopup();

      expect(el<HTMLInputElement>('apiKey').value).toBe('');
      expect(el<HTMLInputElement>('vaultPath').value).toBe('AI/{platform}');
      expect(el<HTMLInputElement>('outputObsidian').checked).toBe(true);
      expect(el<HTMLButtonElement>('saveBtn').disabled).toBe(false);
      expect(el<HTMLButtonElement>('testBtn').disabled).toBe(false);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
      expect(chrome.storage.sync.set).not.toHaveBeenCalled();

      const file = el<HTMLInputElement>('outputFile');
      file.checked = true;
      file.dispatchEvent(new Event('change'));
      await vi.waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith({
          action: 'updateOutputOptions',
          outputOptions: { obsidian: true, file: true, clipboard: false },
        })
      );
    });

    it('canonicalizes stale dual experiment settings to probe-only before saving', async () => {
      buildPopupDom();
      vi.mocked(getSettingsOrThrow).mockResolvedValue({
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
        enableHtmlExport: undefined,
        enableInertCodeBlocks: undefined,
        templateOptions: { messageFormat: '', userCalloutType: '', assistantCalloutType: '' },
      } as unknown as ExtensionSettings;
      vi.mocked(getSettingsOrThrow).mockResolvedValue(partial);

      await initPopup();

      expect(el<HTMLInputElement>('outputObsidian').checked).toBe(true); // default on
      expect(el<HTMLInputElement>('outputFile').checked).toBe(false);
      expect(el<HTMLInputElement>('enableAutoScroll').checked).toBe(false);
      expect(el<HTMLInputElement>('enableHtmlExport').checked).toBe(false);
      expect(el<HTMLInputElement>('enableInertCodeBlocks').checked).toBe(true);
      expect(el<HTMLInputElement>('obsidianUrl').value).toBe('http://127.0.0.1:27123');
      expect(el<HTMLSelectElement>('messageFormat').value).toBe('callout');
      expect(el<HTMLInputElement>('userCallout').value).toBe('QUESTION');
      expect(el<HTMLInputElement>('assistantCallout').value).toBe('NOTE');
      expect(el<HTMLInputElement>('includeId').checked).toBe(true); // ?? true default
      expect(el<HTMLSelectElement>('timezone').value).toBe('UTC');
    });

    it('keeps an injected invalid truthy plain-text setting unchecked', async () => {
      await initWithDefaults({
        ...storedSettings,
        enableTextExport: 'true' as unknown as boolean,
      });
      const toggle = el<HTMLInputElement>('enableTextExport');
      expect(toggle.checked).toBe(false);
      expect(toggle.getAttribute('aria-checked')).toBe('false');
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
      vi.mocked(getSettingsOrThrow).mockResolvedValue(storedSettings);

      try {
        await initPopup();

        expect(document.getElementById('i18nLabel')!.textContent).toBe('T_settings_title');
        expect((document.getElementById('i18nInput') as HTMLInputElement).placeholder).toBe(
          'T_settings_apiKeyPlaceholder'
        );
        expect(document.querySelector('[data-i18n="settings_enableHtmlExport"]')!.textContent).toBe(
          'T_settings_enableHtmlExport'
        );
        expect(document.querySelector('[data-i18n="settings_htmlExportHelp"]')!.textContent).toBe(
          'T_settings_htmlExportHelp'
        );
        expect(
          document.querySelector('[data-i18n="settings_enableInertCodeBlocks"]')!.textContent
        ).toBe('T_settings_enableInertCodeBlocks');
        expect(
          document.querySelector('[data-i18n="settings_inertCodeBlocksHelp"]')!.textContent
        ).toBe('T_settings_inertCodeBlocksHelp');
        expect(document.title).toBe('T_extName');
      } finally {
        vi.mocked(chrome.i18n.getMessage).mockImplementation((key: string) => key);
        document.head.querySelector('title[data-i18n]')?.remove();
      }
    });

    it('rejects when a required element is missing from the DOM', async () => {
      buildPopupDom();
      document.getElementById('saveBtn')!.remove();
      vi.mocked(getSettingsOrThrow).mockResolvedValue(storedSettings);

      await expect(initPopup()).rejects.toThrow('Missing element: #saveBtn');
    });

    it('does not repopulate the timezone dropdown on re-init', async () => {
      await initWithDefaults();
      const countAfterFirst = el<HTMLSelectElement>('timezone').options.length;

      await initPopup(); // same DOM, second run hits the early-return guard

      expect(el<HTMLSelectElement>('timezone').options.length).toBe(countAfterFirst);
    });

    it.each(['local', 'sync'] as const)(
      'fails closed without writes, listeners, or actions after a %s read failure',
      async area => {
        buildPopupDom();
        const storage =
          await vi.importActual<typeof import('../../src/lib/storage')>('../../src/lib/storage');
        vi.mocked(getSettingsOrThrow).mockImplementation(storage.getSettingsOrThrow);
        vi.mocked(chrome.storage.local.get).mockResolvedValue({
          secureSettings: { obsidianApiKey: VALID_API_KEY },
        });
        vi.mocked(chrome.storage.sync.get).mockResolvedValue({ settings: storedSettings });
        vi.mocked(chrome.storage[area].get).mockRejectedValue(
          new Error('synthetic-sensitive-storage-error-detail')
        );
        const listenerSpies = [...document.querySelectorAll('input, select, button')].map(target =>
          vi.spyOn(target, 'addEventListener')
        );
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        try {
          await initPopup();

          expect(statusEl().textContent).toBe('toast_error_connectionFailed');
          expect(statusEl().className).toBe('status error');
          expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
            '[G2O Popup] Failed to initialize settings'
          );
          expect(el<HTMLButtonElement>('saveBtn').disabled).toBe(true);
          expect(el<HTMLButtonElement>('testBtn').disabled).toBe(true);
          expect(el<HTMLInputElement>('apiKey').value).toBe('');
          expect(el<HTMLInputElement>('vaultPath').value).toBe('');
          expect(document.querySelector('.api-key-toggle')).toBeNull();
          for (const listenerSpy of listenerSpies) expect(listenerSpy).not.toHaveBeenCalled();

          // Dispatch directly so disabled buttons cannot conceal an attached handler.
          el<HTMLButtonElement>('saveBtn').dispatchEvent(new Event('click'));
          el<HTMLButtonElement>('testBtn').dispatchEvent(new Event('click'));
          for (const id of SWITCH_IDS) {
            const toggle = el<HTMLInputElement>(id);
            toggle.checked = true;
            toggle.dispatchEvent(new Event('change'));
          }
          await new Promise(resolve => setTimeout(resolve, 0));

          expect(sendMessage).not.toHaveBeenCalled();
          expect(chrome.storage.local.set).not.toHaveBeenCalled();
          expect(chrome.storage.sync.set).not.toHaveBeenCalled();
          expect(statusEl().textContent).toBe('toast_error_connectionFailed');
          expect(el<HTMLButtonElement>('saveBtn').disabled).toBe(true);
          expect(el<HTMLButtonElement>('testBtn').disabled).toBe(true);
        } finally {
          errorSpy.mockRestore();
          for (const listenerSpy of listenerSpies) listenerSpy.mockRestore();
        }
      }
    );
  });

  describe('section visibility', () => {
    it('disables HTML export when File output is off without discarding its selected value', async () => {
      await initWithDefaults({
        ...storedSettings,
        enableHtmlExport: true,
        outputOptions: { obsidian: true, file: false, clipboard: true },
      });

      const htmlExport = el<HTMLInputElement>('enableHtmlExport');
      expect(htmlExport.checked).toBe(true);
      expect(htmlExport.disabled).toBe(true);
      expect(htmlExport.getAttribute('aria-checked')).toBe('true');
      expect(htmlExport.getAttribute('aria-disabled')).toBe('true');
      expect(el('htmlExportRow').style.opacity).toBe('0.5');
    });

    it('updates HTML export availability immediately as File output changes', async () => {
      await initWithDefaults({
        ...storedSettings,
        enableHtmlExport: true,
        outputOptions: { obsidian: true, file: false, clipboard: true },
      });
      const htmlExport = el<HTMLInputElement>('enableHtmlExport');
      const fileOutput = el<HTMLInputElement>('outputFile');

      fileOutput.checked = true;
      fileOutput.dispatchEvent(new Event('change'));
      expect(htmlExport.disabled).toBe(false);
      expect(htmlExport.checked).toBe(true);
      expect(htmlExport.getAttribute('aria-disabled')).toBe('false');
      expect(el('htmlExportRow').style.opacity).toBe('');

      fileOutput.checked = false;
      fileOutput.dispatchEvent(new Event('change'));
      expect(htmlExport.disabled).toBe(true);
      expect(htmlExport.checked).toBe(true);
      expect(htmlExport.getAttribute('aria-disabled')).toBe('true');
      expect(el('htmlExportRow').style.opacity).toBe('0.5');

      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
      expect(vi.mocked(sendMessage).mock.calls).toEqual([
        [
          {
            action: 'updateOutputOptions',
            outputOptions: { obsidian: true, file: true, clipboard: true },
          },
        ],
        [
          {
            action: 'updateOutputOptions',
            outputOptions: { obsidian: true, file: false, clipboard: true },
          },
        ],
      ]);
      expect(sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'saveSettings' })
      );
    });

    it('keeps the plain-text opt-in selected while File availability changes', async () => {
      await initWithDefaults({
        ...storedSettings,
        enableTextExport: true,
        outputOptions: { obsidian: true, file: false, clipboard: true },
      });
      const textExport = el<HTMLInputElement>('enableTextExport');
      const fileOutput = el<HTMLInputElement>('outputFile');
      expect(textExport.checked).toBe(true);
      expect(textExport.disabled).toBe(true);
      fileOutput.checked = true;
      fileOutput.dispatchEvent(new Event('change'));
      expect(textExport.checked).toBe(true);
      expect(textExport.disabled).toBe(false);
      expect(textExport.getAttribute('aria-disabled')).toBe('false');
    });

    it('disables the Obsidian section when Obsidian output is off', async () => {
      buildPopupDom();
      vi.mocked(getSettingsOrThrow).mockResolvedValue({
        ...storedSettings,
        outputOptions: { obsidian: false, file: true, clipboard: false },
      });
      await initPopup();

      expect(el('obsidianSettings').classList.contains('disabled')).toBe(true);
    });

    it('re-enables the Obsidian section when the toggle is switched on', async () => {
      buildPopupDom();
      vi.mocked(getSettingsOrThrow).mockResolvedValue({
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
    it('collects and saves the selected HTML option with the rest of the settings', async () => {
      await initWithDefaults({
        ...storedSettings,
        outputOptions: { obsidian: true, file: true, clipboard: true },
      });

      const htmlExport = el<HTMLInputElement>('enableHtmlExport');
      expect(htmlExport.disabled).toBe(false);
      htmlExport.checked = true;
      htmlExport.dispatchEvent(new Event('change'));
      expect(htmlExport.getAttribute('aria-checked')).toBe('true');
      el<HTMLButtonElement>('saveBtn').click();

      await vi.waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith({
          action: 'saveSettings',
          settings: expect.objectContaining({ enableHtmlExport: true }),
        })
      );
      const message = vi.mocked(sendMessage).mock.calls.at(-1)?.[0];
      expect(message?.action).toBe('saveSettings');
      expect(validateMessageContent(structuredClone(message))).toBe(true);
      expect(validateMessageContent(JSON.parse(JSON.stringify(message)))).toBe(true);
    });

    it('preserves the configured HTML choice when saving while File output is disabled', async () => {
      await initWithDefaults({
        ...storedSettings,
        enableHtmlExport: true,
        outputOptions: { obsidian: true, file: false, clipboard: true },
      });

      expect(el<HTMLInputElement>('enableHtmlExport').disabled).toBe(true);
      el<HTMLButtonElement>('saveBtn').click();

      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
      expect(settingsSaveAt(0)).toHaveProperty('enableHtmlExport', true);
    });

    it('collects and saves the selected plain-text option', async () => {
      await initWithDefaults({
        ...storedSettings,
        outputOptions: { obsidian: true, file: true, clipboard: true },
      });
      const textExport = el<HTMLInputElement>('enableTextExport');
      textExport.checked = true;
      textExport.dispatchEvent(new Event('change'));
      el<HTMLButtonElement>('saveBtn').click();
      await vi.waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith({
          action: 'saveSettings',
          settings: expect.objectContaining({ enableTextExport: true }),
        })
      );
      expect(
        validateMessageContent(structuredClone(vi.mocked(sendMessage).mock.calls.at(-1)?.[0]))
      ).toBe(true);
    });

    it('populates, exposes, and saves the tagged-fence setting independently of destinations', async () => {
      await initWithDefaults({
        ...storedSettings,
        enableInertCodeBlocks: false,
        outputOptions: { obsidian: false, file: false, clipboard: true },
      });
      const inert = el<HTMLInputElement>('enableInertCodeBlocks');
      expect(inert.checked).toBe(false);
      expect(inert.disabled).toBe(false);
      inert.checked = true;
      inert.dispatchEvent(new Event('change'));
      expect(inert.getAttribute('aria-checked')).toBe('true');
      el<HTMLButtonElement>('saveBtn').click();

      await vi.waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith({
          action: 'saveSettings',
          settings: expect.objectContaining({ enableInertCodeBlocks: true }),
        })
      );
    });

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
      const { obsidianApiKey, ...syncSettings } = storedSettings;
      expect(obsidianApiKey).toBe(VALID_API_KEY);

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
      vi.mocked(getSettingsOrThrow).mockResolvedValue({
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
