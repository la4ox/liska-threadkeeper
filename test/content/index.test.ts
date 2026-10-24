/**
 * Content script bootstrap tests
 *
 * Drives the REAL src/content/bootstrap.ts module (initialize, handleSync,
 * getExtractor, startContentScript) with mocked ui/messaging layers and
 * fixture DOM. The index.ts entry shim stays a 3-line side effect.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ContentScriptSettings, MultiOutputResponse } from '../../src/lib/types';
import {
  loadFixture,
  clearFixture,
  createGeminiConversationDOM,
  createClaudeConversationDOM,
  createPerplexityConversationDOM,
  createChatGPTPage,
  setChatGPTLocation,
  setGeminiLocation,
  setNonGeminiLocation,
  resetLocation,
} from '../fixtures/dom-helpers';

vi.mock('../../src/content/ui', () => ({
  injectBranchExportButton: vi.fn(),
  injectSyncButton: vi.fn(),
  removeExportControls: vi.fn(),
  showArchiveBranchPicker: vi.fn(),
  setButtonLoading: vi.fn(),
  showSuccessToast: vi.fn(),
  showErrorToast: vi.fn(),
  showWarningToast: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../src/lib/messaging', () => ({
  sendMessage: vi.fn(),
}));

import {
  injectBranchExportButton,
  injectSyncButton,
  removeExportControls,
  setButtonLoading,
  showSuccessToast,
  showErrorToast,
  showWarningToast,
  showToast,
} from '../../src/content/ui';
import { sendMessage } from '../../src/lib/messaging';
import {
  initialize,
  handleSync,
  getExtractor,
  startContentScript,
  stopRouteAdmissionObserver,
} from '../../src/content/bootstrap';
import { GeminiExtractor } from '../../src/content/extractors/gemini';
import { ClaudeExtractor } from '../../src/content/extractors/claude';
import { ChatGPTExtractor } from '../../src/content/extractors/chatgpt';
import { PerplexityExtractor } from '../../src/content/extractors/perplexity';
import { DeepSeekExtractor } from '../../src/content/extractors/deepseek';
import { NotebookLMExtractor } from '../../src/content/extractors/notebooklm';
import { CONVERSATION_READY_SELECTORS } from '../../src/content/extractors/selectors/ready';
import { PLATFORM_REGISTRY, platformForHost } from '../../src/lib/platform-registry';

const readinessSurfaces = [
  {
    host: 'gemini.google.com',
    platform: 'gemini',
    extractor: GeminiExtractor,
    html: '<div class="conversation-container"></div>',
  },
  {
    host: 'claude.ai',
    platform: 'claude',
    extractor: ClaudeExtractor,
    html: '<div data-index="0"><div data-testid="user-message">Question</div></div>',
  },
  {
    host: 'chatgpt.com',
    platform: 'chatgpt',
    extractor: ChatGPTExtractor,
    html: '<section data-turn-id="ready"></section>',
  },
  {
    host: 'www.perplexity.ai',
    platform: 'perplexity',
    extractor: PerplexityExtractor,
    html: '<div class="group/user-bubble"><div data-renderer="lm"></div></div>',
  },
  {
    host: 'chat.deepseek.com',
    platform: 'deepseek',
    extractor: DeepSeekExtractor,
    html: '<div class="ds-message"></div>',
  },
  {
    host: 'notebook.google.com',
    platform: 'notebooklm',
    extractor: NotebookLMExtractor,
    html: '<div class="chat-message-pair"></div>',
  },
  {
    host: 'notebooklm.google.com',
    platform: 'notebooklm',
    extractor: NotebookLMExtractor,
    html: '<div class="chat-message-pair"></div>',
  },
] as const;

const legacyReadinessSurfaces = [
  {
    name: 'Gemini root fallback',
    host: 'gemini.google.com',
    platform: 'gemini',
    extractor: GeminiExtractor,
    html: `<div class="conversation-thread">
      <user-query><p class="query-text-line">Root fallback question</p></user-query>
      <model-response><div class="markdown markdown-main-panel"><p>Root fallback answer</p></div></model-response>
    </div>`,
  },
  {
    name: 'Perplexity legacy query',
    host: 'www.perplexity.ai',
    platform: 'perplexity',
    extractor: PerplexityExtractor,
    html: createPerplexityConversationDOM([{ role: 'user', content: 'Legacy question' }]),
  },
  {
    name: 'Claude rowless transcript',
    host: 'claude.ai',
    platform: 'claude',
    extractor: ClaudeExtractor,
    html: createClaudeConversationDOM([
      { role: 'user', content: 'Legacy question' },
      { role: 'assistant', content: '<p>Legacy answer</p>' },
    ]),
  },
] as const;

const baseSettings: ContentScriptSettings = {
  obsidianUrl: 'http://127.0.0.1:27123',
  vaultPath: 'AI/{platform}',
  isApiKeyConfigured: true,
  enableAutoScroll: false,
  enableAppendMode: false,
  enableToolContent: false,
  enableChatGptOpaqueProbe: false,
  enableChatGptOpaqueReplay: false,
  outputOptions: { obsidian: true, file: false, clipboard: false },
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
};

const okSave: MultiOutputResponse = {
  results: [{ destination: 'obsidian', success: true }],
  allSuccessful: true,
  anySuccessful: true,
  messagesAppended: undefined,
};

/** Route mocked sendMessage responses by action */
function mockMessaging(overrides: {
  settings?: Partial<ContentScriptSettings>;
  connection?: { success: boolean; error?: string };
  save?:
    | MultiOutputResponse
    | { success: false; error: string }
    | { results: unknown[]; allSuccessful: boolean; anySuccessful: boolean };
}): void {
  vi.mocked(sendMessage).mockImplementation(message => {
    switch ((message as { action: string }).action) {
      case 'getSettings':
        return Promise.resolve({ ...baseSettings, ...overrides.settings });
      case 'testConnection':
        return Promise.resolve(overrides.connection ?? { success: true });
      case 'probeChatGptOpaqueRequest':
        return Promise.resolve({
          success: true,
          data: {
            observedTargetRequest: true,
            sourceIsNativeRequest: true,
            initAbsent: true,
            exactTarget: true,
            authorizationPresent: true,
            credentialsAccepted: true,
            sourceStatus: 200,
            sourceJson: true,
            singularDispatchCount: 0,
            outcome: 'eligible',
          },
        });
      case 'saveToOutputs':
        return Promise.resolve(overrides.save ?? okSave);
      default:
        return Promise.reject(new Error('unexpected action'));
    }
  });
}

function loadGeminiConversation(): void {
  setGeminiLocation('abc123def456');
  loadFixture(
    createGeminiConversationDOM([
      { role: 'user', content: 'Hello Gemini' },
      { role: 'assistant', content: '<p>Hi there!</p>' },
    ])
  );
}

describe('content/bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopRouteAdmissionObserver();
    clearFixture();
    resetLocation();
  });

  describe('getExtractor', () => {
    it('covers every registered host in the readiness surface cases', () => {
      expect(readinessSurfaces.map(surface => surface.host).sort()).toEqual(
        Object.values(PLATFORM_REGISTRY)
          .flatMap(platform => platform.hosts)
          .sort()
      );
    });

    it.each(readinessSurfaces)(
      'routes $host to its expected extractor and readiness hint',
      ({ host, platform, extractor, html }) => {
        setNonGeminiLocation(host);
        loadFixture(html);

        expect(platformForHost(host)).toBe(platform);
        expect(getExtractor()).toBeInstanceOf(extractor);
        expect(getExtractor()?.platform).toBe(platform);
        expect(document.querySelector(CONVERSATION_READY_SELECTORS[platform])).not.toBeNull();
      }
    );

    it('returns the Gemini extractor on gemini.google.com', () => {
      setGeminiLocation('abc123');
      expect(getExtractor()?.platform).toBe('gemini');
    });

    it('returns null on unsupported hostnames', () => {
      setNonGeminiLocation('example.com');
      expect(getExtractor()).toBeNull();
    });

    it('rejects malicious subdomains embedding a platform hostname', () => {
      setNonGeminiLocation('gemini.google.com.attacker.com');
      expect(getExtractor()).toBeNull();
    });

    it('returns null on the distinct Dots product surface', () => {
      setNonGeminiLocation('chatgpt.com', '/dots/home');
      expect(getExtractor()).toBeNull();
    });
  });

  describe('initialize', () => {
    it('skips initialization on unsupported pages', async () => {
      setNonGeminiLocation('example.com');
      await initialize();
      expect(injectSyncButton).not.toHaveBeenCalled();
    });

    it('injects the sync button on a Gemini conversation page', async () => {
      loadGeminiConversation();
      await initialize();
      expect(injectSyncButton).toHaveBeenCalledTimes(1);
      expect(injectSyncButton).toHaveBeenCalledWith(expect.any(Function));
    });

    it('adds the explicit branch entry point only on ChatGPT', async () => {
      setChatGPTLocation('01234567-89ab-4cde-8f01-23456789abcd');
      createChatGPTPage('01234567-89ab-4cde-8f01-23456789abcd', [
        { role: 'user', content: 'Question' },
        { role: 'assistant', content: '<p>Answer</p>' },
      ]);

      await initialize();

      expect(injectSyncButton).toHaveBeenCalledWith(expect.any(Function));
      expect(injectBranchExportButton).toHaveBeenCalledWith(expect.any(Function));
    });

    it('does not inject misleading ChatGPT controls on Dots', async () => {
      setNonGeminiLocation('chatgpt.com', '/dots/home');
      loadFixture('<main><section data-turn-id="dots-visible"></section></main>');

      await initialize();

      expect(injectSyncButton).not.toHaveBeenCalled();
      expect(injectBranchExportButton).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('conversation container waiting', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it.each(legacyReadinessSurfaces)(
      'injects immediately for the supported $name without starting extraction',
      async ({ host, extractor, html }) => {
        setNonGeminiLocation(host);
        loadFixture(`<main>${html}</main>`);
        const extract = vi.spyOn(extractor.prototype, 'extract');
        const fetch = vi
          .spyOn(globalThis, 'fetch')
          .mockRejectedValue(new Error('Unexpected fetch during initialization'));
        const pending = initialize();

        await vi.advanceTimersByTimeAsync(0);
        expect(injectSyncButton).toHaveBeenCalledTimes(1);
        await pending;

        expect(sendMessage).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(extract).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      }
    );

    it.each(legacyReadinessSurfaces)(
      'injects after 100ms when the supported $name arrives',
      async ({ host, extractor, html }) => {
        setNonGeminiLocation(host);
        loadFixture('<main></main>');
        const extract = vi.spyOn(extractor.prototype, 'extract');
        const pending = initialize();

        document.querySelector('main')!.innerHTML = html;
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(99);
        expect(injectSyncButton).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(injectSyncButton).toHaveBeenCalledTimes(1);
        await pending;

        expect(sendMessage).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(extract).not.toHaveBeenCalled();
      }
    );

    it('ignores rowless Claude message identities outside the transcript root', async () => {
      setNonGeminiLocation('claude.ai');
      loadFixture(`
        <aside><div data-index="0"><a>Older chat</a></div></aside>
        <main>
          <div data-testid="user-message">Unrelated message-like content</div>
          <div class="font-claude-response">Unrelated answer-like content</div>
          <div class="conversation-thread"></div>
        </main>
      `);
      const pending = initialize();
      await vi.advanceTimersByTimeAsync(100);
      expect(injectSyncButton).not.toHaveBeenCalled();

      document.querySelector('.conversation-thread')!.innerHTML =
        '<div data-testid="user-message">Transcript question</div>';
      await vi.advanceTimersByTimeAsync(100);
      await pending;

      expect(injectSyncButton).toHaveBeenCalledTimes(1);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it.each(
      legacyReadinessSurfaces.flatMap(legacy =>
        readinessSurfaces
          .filter(surface => surface.platform !== legacy.platform)
          .map(surface => ({ ...surface, legacyName: legacy.name, legacyHtml: legacy.html }))
      )
    )(
      'ignores $legacyName on the other provider host $host',
      async ({ host, html, legacyHtml }) => {
        setNonGeminiLocation(host);
        loadFixture(`<main>${legacyHtml}</main>`);
        const pending = initialize();
        await vi.advanceTimersByTimeAsync(100);
        expect(injectSyncButton).not.toHaveBeenCalled();

        document.querySelector('main')!.insertAdjacentHTML('beforeend', html);
        await vi.advanceTimersByTimeAsync(100);
        await pending;

        expect(injectSyncButton).toHaveBeenCalledTimes(1);
        expect(sendMessage).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
      }
    );

    it.each(readinessSurfaces)(
      'injects immediately on $host without messaging, extraction, or capture',
      async ({ host, platform, extractor, html }) => {
        setNonGeminiLocation(host);
        loadFixture(`<main>${html}</main>`);
        const extract = vi.spyOn(extractor.prototype, 'extract');
        const fetch = vi
          .spyOn(globalThis, 'fetch')
          .mockRejectedValue(new Error('Unexpected fetch during initialization'));

        await initialize();

        expect(injectSyncButton).toHaveBeenCalledTimes(1);
        expect(injectBranchExportButton).toHaveBeenCalledTimes(platform === 'chatgpt' ? 1 : 0);
        expect(sendMessage).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(extract).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      }
    );

    it('injects immediately for a ChatGPT data-testid-only conversation turn', async () => {
      setChatGPTLocation('01234567-89ab-4cde-8f01-23456789abcd');
      loadFixture('<main><section data-testid="conversation-turn-1"></section></main>');
      const extract = vi.spyOn(ChatGPTExtractor.prototype, 'extract');
      const pending = initialize();

      await vi.advanceTimersByTimeAsync(0);
      expect(injectSyncButton).toHaveBeenCalledTimes(1);
      expect(injectBranchExportButton).toHaveBeenCalledTimes(1);
      await pending;

      expect(sendMessage).not.toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
      expect(extract).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('rechecks ChatGPT route admission after a pending readiness wait', async () => {
      setChatGPTLocation('01234567-89ab-4cde-8f01-23456789abcd');
      loadFixture('<main></main>');
      const pending = initialize();

      setNonGeminiLocation('chatgpt.com', '/dots/home');
      document.querySelector('main')!.innerHTML =
        '<section data-testid="conversation-turn-1"></section>';
      await vi.advanceTimersByTimeAsync(100);
      await pending;

      expect(removeExportControls).toHaveBeenCalled();
      expect(injectSyncButton).not.toHaveBeenCalled();
      expect(injectBranchExportButton).not.toHaveBeenCalled();
    });

    it('removes stale controls on Dots SPA navigation and restores them on return', async () => {
      setChatGPTLocation('01234567-89ab-4cde-8f01-23456789abcd');
      loadFixture('<main><section data-testid="conversation-turn-1"></section></main>');
      await initialize();
      expect(injectSyncButton).toHaveBeenCalledTimes(1);

      setNonGeminiLocation('chatgpt.com', '/dots/home');
      document.querySelector('main')!.appendChild(document.createElement('div'));
      await vi.advanceTimersByTimeAsync(0);
      expect(removeExportControls).toHaveBeenCalledTimes(1);
      expect(injectSyncButton).toHaveBeenCalledTimes(1);

      setChatGPTLocation('11111111-2222-4333-8444-555555555555');
      document.querySelector('main')!.innerHTML =
        '<section data-testid="conversation-turn-2"></section>';
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(injectSyncButton).toHaveBeenCalledTimes(2));
      expect(injectBranchExportButton).toHaveBeenCalledTimes(2);
    });

    it('keeps existing controls across ordinary ChatGPT route changes', async () => {
      setChatGPTLocation('01234567-89ab-4cde-8f01-23456789abcd');
      loadFixture('<main><section data-testid="conversation-turn-1"></section></main>');
      await initialize();

      setChatGPTLocation('11111111-2222-4333-8444-555555555555');
      document.querySelector('main')!.innerHTML =
        '<section data-testid="conversation-turn-2"></section>';
      await vi.advanceTimersByTimeAsync(0);

      expect(removeExportControls).not.toHaveBeenCalled();
      expect(injectSyncButton).toHaveBeenCalledTimes(1);
      expect(injectBranchExportButton).toHaveBeenCalledTimes(1);
    });

    it('restores Dots-return controls as busy while the original export is active', async () => {
      setChatGPTLocation('01234567-89ab-4cde-8f01-23456789abcd');
      loadFixture('<main><section data-testid="conversation-turn-1"></section></main>');
      await initialize();

      let resolveSettings!: (settings: ContentScriptSettings) => void;
      const pendingSettings = new Promise<ContentScriptSettings>(resolve => {
        resolveSettings = resolve;
      });
      vi.mocked(sendMessage).mockImplementation(message => {
        if ((message as { action: string }).action === 'getSettings') return pendingSettings;
        return Promise.resolve(okSave);
      });
      const activeExport = handleSync();
      expect(setButtonLoading).toHaveBeenCalledWith(true);

      setNonGeminiLocation('chatgpt.com', '/dots/home');
      document.querySelector('main')!.appendChild(document.createElement('div'));
      await vi.advanceTimersByTimeAsync(0);
      setChatGPTLocation('11111111-2222-4333-8444-555555555555');
      document.querySelector('main')!.innerHTML =
        '<section data-testid="conversation-turn-2"></section>';
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(injectSyncButton).toHaveBeenCalledTimes(2));

      expect(setButtonLoading.mock.calls.filter(call => call[0] === true)).toHaveLength(2);
      setNonGeminiLocation('chatgpt.com', '/dots/home');
      document.querySelector('main')!.appendChild(document.createElement('div'));
      await vi.advanceTimersByTimeAsync(0);
      resolveSettings({
        ...baseSettings,
        outputOptions: { obsidian: false, file: true, clipboard: false },
      });
      await activeExport;
      expect(setButtonLoading).toHaveBeenLastCalledWith(false);
    });

    it('injects after 100ms when a ChatGPT data-testid-only conversation turn arrives', async () => {
      setChatGPTLocation('01234567-89ab-4cde-8f01-23456789abcd');
      loadFixture('<main></main>');
      const pending = initialize();

      document.querySelector('main')!.innerHTML =
        '<section data-testid="conversation-turn-1"></section>';
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(99);
      expect(injectSyncButton).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(injectSyncButton).toHaveBeenCalledTimes(1);
      await pending;

      expect(sendMessage).not.toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it.each([
      ['current user', '<div data-testid="user-message">Question</div>'],
      ['current assistant', '<div data-cds="AssistantMessage">Answer</div>'],
      ['legacy user', '<p class="whitespace-pre-wrap break-words">Question</p>'],
      ['legacy assistant', '<div class="font-claude-response">Answer</div>'],
    ])('rejects an indexed sidebar until a Claude %s row arrives', async (_variant, content) => {
      setNonGeminiLocation('claude.ai', '/chat/01234567-89ab-4cde-8f01-23456789abcd');
      loadFixture('<aside><div data-index="0"><a>Older chat</a></div></aside><main></main>');
      const extract = vi.spyOn(ClaudeExtractor.prototype, 'extract');
      const pending = initialize();
      await vi.advanceTimersByTimeAsync(0);
      expect(injectSyncButton).not.toHaveBeenCalled();

      // An unrelated observed mutation must not make the global query accept the sidebar.
      document.querySelector('main')!.append(document.createElement('span'));
      await vi.advanceTimersByTimeAsync(100);
      expect(injectSyncButton).not.toHaveBeenCalled();

      document.querySelector('main')!.innerHTML = `<div data-index="1">${content}</div>`;
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(99);
      expect(injectSyncButton).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await pending;

      expect(injectSyncButton).toHaveBeenCalledTimes(1);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
      expect(extract).not.toHaveBeenCalled();
    });

    it('keeps the 10s escape when Claude has only an indexed sidebar', async () => {
      setNonGeminiLocation('claude.ai');
      loadFixture('<aside><div data-index="0"><a>Older chat</a></div></aside><main></main>');
      const pending = initialize();

      await vi.advanceTimersByTimeAsync(9_999);
      expect(injectSyncButton).not.toHaveBeenCalled();
      document.querySelector('main')!.append(document.createElement('span'));
      await vi.advanceTimersByTimeAsync(1);
      await pending;

      expect(injectSyncButton).toHaveBeenCalledTimes(1);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each(readinessSurfaces)(
      'injects on $host after its readiness hint arrives and the 100ms debounce ends',
      async ({ host, html }) => {
        setNonGeminiLocation(host);
        loadFixture('<main></main>');
        const observe = vi.spyOn(MutationObserver.prototype, 'observe');
        const pending = initialize();
        expect(injectSyncButton).not.toHaveBeenCalled();
        expect(observe).toHaveBeenCalledWith(document.querySelector('main'), {
          childList: true,
          subtree: true,
        });

        document.querySelector('main')!.innerHTML = html;
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(99);
        expect(injectSyncButton).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await pending;

        expect(injectSyncButton).toHaveBeenCalledTimes(1);
        expect(sendMessage).not.toHaveBeenCalled();
      }
    );

    it.each(readinessSurfaces)(
      'does not treat another provider readiness hint as ready on $host',
      async ({ host, platform, html }) => {
        setNonGeminiLocation(host);
        const foreignHtml = readinessSurfaces
          .filter(surface => surface.platform !== platform)
          .map(surface => surface.html)
          .join('');
        loadFixture(`<main>${foreignHtml}</main>`);
        expect(document.querySelector(CONVERSATION_READY_SELECTORS[platform])).toBeNull();
        const pending = initialize();
        await vi.advanceTimersByTimeAsync(100);
        expect(injectSyncButton).not.toHaveBeenCalled();

        // Neither the immediate query nor the observer may use foreign hints.
        document.querySelector('main')!.innerHTML = foreignHtml;
        await vi.advanceTimersByTimeAsync(100);
        expect(injectSyncButton).not.toHaveBeenCalled();

        document.querySelector('main')!.insertAdjacentHTML('beforeend', html);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(99);
        expect(injectSyncButton).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await pending;

        expect(injectSyncButton).toHaveBeenCalledTimes(1);
        expect(sendMessage).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
      }
    );

    it('waits until the 10s deadline on Gemini when only a Claude row is present', async () => {
      setGeminiLocation('abc123def456');
      loadFixture('<main><div data-index="0"></div></main>');
      const pending = initialize();

      await vi.advanceTimersByTimeAsync(9_999);
      expect(injectSyncButton).not.toHaveBeenCalled();
      document.querySelector('main')!.insertAdjacentHTML('beforeend', '<div data-index="1"></div>');
      await vi.advanceTimersByTimeAsync(1);
      await pending;

      expect(injectSyncButton).toHaveBeenCalledTimes(1);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
      '<div class="conversation"></div>',
      '<div class="conversation-preview"></div>',
      '<article data-turn-id="dead"></article>',
      '<div class="threadContentWidth"></div>',
    ])('does not inject early for a broad or dead selector: %s', async html => {
      setGeminiLocation('abc123def456');
      loadFixture(`<main>${html}</main>`);
      const pending = initialize();
      await vi.advanceTimersByTimeAsync(100);
      expect(injectSyncButton).not.toHaveBeenCalled();

      document.querySelector('main')!.insertAdjacentHTML('beforeend', html);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(injectSyncButton).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(9_800);
      await pending;
      expect(injectSyncButton).toHaveBeenCalledTimes(1);
    });

    it.each(readinessSurfaces.filter(({ platform }) => ['chatgpt', 'deepseek'].includes(platform)))(
      'still injects on empty $host at 10s without starting structured capture',
      async ({ host, platform, extractor }) => {
        const conversationId = '01234567-89ab-4cde-8f01-23456789abcd';
        const routePrefix = platform === 'chatgpt' ? '/c' : '/a/chat/s';
        setNonGeminiLocation(host, `${routePrefix}/${conversationId}`);
        loadFixture('<main></main>');
        expect(getExtractor()?.getConversationId()).toBe(conversationId);
        const extract = vi.spyOn(extractor.prototype, 'extract');
        const fetch = vi
          .spyOn(globalThis, 'fetch')
          .mockRejectedValue(new Error('Unexpected fetch during initialization'));
        const pending = initialize();

        await vi.advanceTimersByTimeAsync(9_999);
        expect(injectSyncButton).not.toHaveBeenCalled();
        // A mutation just before the deadline must not extend the escape timeout.
        document.querySelector('main')!.append(document.createElement('div'));
        await vi.advanceTimersByTimeAsync(1);
        await pending;

        expect(injectSyncButton).toHaveBeenCalledTimes(1);
        expect(injectBranchExportButton).toHaveBeenCalledTimes(platform === 'chatgpt' ? 1 : 0);
        expect(sendMessage).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(extract).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      }
    );

    it('initializes once the container appears via MutationObserver', async () => {
      setGeminiLocation('abc123def456');
      // Observation root (main) exists, but no conversation container yet
      loadFixture('<main id="root"></main>');

      const pending = initialize();
      expect(injectSyncButton).not.toHaveBeenCalled();

      // Container arrives later (lazy render)
      document.querySelector('main')!.innerHTML = createGeminiConversationDOM([
        { role: 'user', content: 'late' },
      ]);

      await vi.advanceTimersByTimeAsync(100);
      await pending;
      expect(injectSyncButton).toHaveBeenCalledTimes(1);
    });

    it('falls back to document.body observation without a platform root', async () => {
      setGeminiLocation('abc123def456');
      loadFixture('<div id="no-main"></div>'); // no <main>, no #app-container

      const pending = initialize();
      document.body.insertAdjacentHTML(
        'beforeend',
        createGeminiConversationDOM([{ role: 'user', content: 'late' }])
      );

      await vi.advanceTimersByTimeAsync(100);
      await pending;
      expect(injectSyncButton).toHaveBeenCalledTimes(1);
    });

    it('gives up waiting after the fallback timeout', async () => {
      setGeminiLocation('abc123def456');
      loadFixture('<main></main>'); // container never appears

      const pending = initialize();
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;

      // Initialization still completes (button injected on a bare page)
      expect(injectSyncButton).toHaveBeenCalledTimes(1);
    });
  });

  describe('startContentScript', () => {
    it('initializes immediately when the DOM is already ready', async () => {
      loadGeminiConversation();
      startContentScript();
      await vi.waitFor(() => expect(injectSyncButton).toHaveBeenCalled());
    });

    it('waits for DOMContentLoaded while the document is loading', async () => {
      loadGeminiConversation();
      Object.defineProperty(document, 'readyState', {
        value: 'loading',
        configurable: true,
      });
      try {
        startContentScript();
        expect(injectSyncButton).not.toHaveBeenCalled();

        document.dispatchEvent(new Event('DOMContentLoaded'));
        await vi.waitFor(() => expect(injectSyncButton).toHaveBeenCalled());
      } finally {
        Object.defineProperty(document, 'readyState', {
          value: 'complete',
          configurable: true,
        });
      }
    });

    it('logs initialization failures instead of throwing', async () => {
      loadGeminiConversation();
      vi.mocked(injectSyncButton).mockImplementation(() => {
        throw new Error('inject failed');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      startContentScript();
      await vi.waitFor(() =>
        expect(errorSpy).toHaveBeenCalledWith(
          '[G2O] Content script initialization failed:',
          expect.any(Error)
        )
      );
      errorSpy.mockRestore();
    });
  });

  describe('handleSync', () => {
    it('shows an error when no output destination is enabled', async () => {
      loadGeminiConversation();
      mockMessaging({
        settings: { outputOptions: { obsidian: false, file: false, clipboard: false } },
      });

      await handleSync();

      expect(showErrorToast).toHaveBeenCalledWith(
        'Please select at least one output destination in settings'
      );
      expect(setButtonLoading).toHaveBeenLastCalledWith(false);
    });

    it('shows an error when Obsidian is enabled without an API key', async () => {
      loadGeminiConversation();
      mockMessaging({ settings: { isApiKeyConfigured: false } });

      await handleSync();

      expect(showErrorToast).toHaveBeenCalledWith(
        'Please configure your Obsidian API key in the extension settings'
      );
    });

    it('shows the connection error when the connection test fails', async () => {
      loadGeminiConversation();
      mockMessaging({ connection: { success: false, error: 'Obsidian is not running' } });

      await handleSync();

      expect(showErrorToast).toHaveBeenCalledWith('Obsidian is not running');
    });

    it('runs the ChatGPT metadata-only probe without output or Obsidian preflight', async () => {
      const conversationId = '01234567-89ab-4cde-8f01-23456789abcd';
      setChatGPTLocation(conversationId);
      createChatGPTPage(conversationId, [
        { role: 'user', content: 'Question' },
        { role: 'assistant', content: '<p>Answer</p>' },
      ]);
      mockMessaging({
        settings: { enableChatGptOpaqueProbe: true },
        connection: { success: false, error: 'Obsidian is not running' },
      });

      await handleSync();

      const actions = vi
        .mocked(sendMessage)
        .mock.calls.map(call => (call[0] as { action: string }).action);
      expect(actions).toContain('probeChatGptOpaqueRequest');
      expect(actions).not.toContain('testConnection');
      expect(actions).not.toContain('saveToOutputs');
      expect(showErrorToast).toHaveBeenCalledWith(
        'ChatGPT experimental metadata-only probe: eligible. No conversation was exported.'
      );
    });

    it('keeps ordinary output and Obsidian preflight for the active replay experiment', async () => {
      const conversationId = '01234567-89ab-4cde-8f01-23456789abcd';
      setChatGPTLocation(conversationId);
      createChatGPTPage(conversationId, [
        { role: 'user', content: 'Question' },
        { role: 'assistant', content: '<p>Answer</p>' },
      ]);
      mockMessaging({
        settings: { enableChatGptOpaqueReplay: true },
        connection: { success: false, error: 'Obsidian is not running' },
      });

      await handleSync();

      const actions = vi
        .mocked(sendMessage)
        .mock.calls.map(call => (call[0] as { action: string }).action);
      expect(actions).toContain('testConnection');
      expect(actions).not.toContain('captureChatGptConversationViaOpaqueReplay');
      expect(showErrorToast).toHaveBeenCalledWith('Obsidian is not running');
    });

    it('skips the connection test when Obsidian output is disabled', async () => {
      loadGeminiConversation();
      mockMessaging({
        settings: { outputOptions: { obsidian: false, file: true, clipboard: false } },
        save: {
          results: [{ destination: 'file', success: true }],
          allSuccessful: true,
          anySuccessful: true,
        },
      });

      await handleSync();

      const actions = vi
        .mocked(sendMessage)
        .mock.calls.map(call => (call[0] as { action: string }).action);
      expect(actions).not.toContain('testConnection');
      expect(showToast).toHaveBeenCalledWith('Saved locally', 'success');
    });

    it('shows an error on unsupported pages', async () => {
      setNonGeminiLocation('example.com');
      mockMessaging({});

      await handleSync();

      expect(showErrorToast).toHaveBeenCalledWith('Not on a valid conversation page');
    });

    it('refuses Dots without dispatching any output', async () => {
      setNonGeminiLocation('chatgpt.com', '/dots/home');
      loadFixture('<main><section data-turn-id="dots-visible"></section></main>');
      mockMessaging({});

      await handleSync();

      expect(showErrorToast).toHaveBeenCalledWith('Not on a valid conversation page');
      expect(sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'saveToOutputs' })
      );
    });

    it('refuses a second export while the first operation is still active', async () => {
      setNonGeminiLocation('chatgpt.com', '/dots/home');
      let resolveSettings!: (settings: ContentScriptSettings) => void;
      const pendingSettings = new Promise<ContentScriptSettings>(resolve => {
        resolveSettings = resolve;
      });
      vi.mocked(sendMessage).mockImplementation(message => {
        if ((message as { action: string }).action === 'getSettings') return pendingSettings;
        return Promise.resolve(okSave);
      });

      const first = handleSync();
      await handleSync();

      expect(showWarningToast).toHaveBeenCalledWith('An export is already in progress.');
      expect(
        vi
          .mocked(sendMessage)
          .mock.calls.filter(call => (call[0] as { action: string }).action === 'getSettings')
      ).toHaveLength(1);
      resolveSettings({
        ...baseSettings,
        outputOptions: { obsidian: false, file: true, clipboard: false },
      });
      await first;
    });

    it('shows an error when the page has no extractable conversation', async () => {
      setGeminiLocation('abc123def456');
      loadFixture('<div id="empty"></div>');
      mockMessaging({});

      await handleSync();

      expect(showErrorToast).toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'saveToOutputs' })
      );
    });

    it('extracts, saves, and shows success on the happy path', async () => {
      loadGeminiConversation();
      mockMessaging({});

      await handleSync();

      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'saveToOutputs',
          outputs: ['obsidian'],
          data: expect.objectContaining({ fileName: expect.stringMatching(/\.md$/) }),
        })
      );
      expect(showToast).toHaveBeenCalledWith('Saved locally', 'success');
      expect(setButtonLoading).toHaveBeenNthCalledWith(1, true);
      expect(setButtonLoading).toHaveBeenLastCalledWith(false);
    });

    it.each([
      {
        outcome: 'success',
        successes: [true, true, true],
        allSuccessful: true,
        anySuccessful: true,
      },
      {
        outcome: 'partial',
        successes: [true, false, true],
        allSuccessful: false,
        anySuccessful: true,
      },
      {
        outcome: 'failure',
        successes: [false, false, false],
        allSuccessful: false,
        anySuccessful: false,
      },
    ])('logs one fresh fixed-schema note write $outcome summary', async testCase => {
      vi.useFakeTimers();
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      try {
        loadGeminiConversation();
        const destinations = ['obsidian', 'file', 'clipboard'] as const;
        const saveResponse = {
          allSuccessful: testCase.allSuccessful,
          anySuccessful: testCase.anySuccessful,
          results: destinations.map((destination, index) => ({
            destination,
            success: testCase.successes[index],
            error: 'PRIVATE_ERROR',
            warning: 'PRIVATE_WARNING',
            savedAs: 'PRIVATE_FILENAME.md',
            path: 'PRIVATE_PATH',
            extra: 'PRIVATE_RESULT_EXTRA',
          })),
          note: { body: 'PRIVATE_NOTE_BODY' },
          fileName: 'PRIVATE_NOTE_FILENAME.md',
          capturedAt: 'PRIVATE_CAPTURED_AT',
          extra: 'PRIVATE_RESPONSE_EXTRA',
        };
        mockMessaging({
          settings: { outputOptions: { obsidian: true, file: true, clipboard: true } },
          save: saveResponse,
        });

        await handleSync();

        const resultCalls = infoSpy.mock.calls.filter(([message]) =>
          message.startsWith('[G2O] Note write')
        );
        expect(resultCalls).toStrictEqual([
          [
            '[G2O] Note write result:',
            {
              allSuccessful: testCase.allSuccessful,
              anySuccessful: testCase.anySuccessful,
              results: destinations.map((destination, index) => ({
                destination,
                success: testCase.successes[index],
              })),
            },
          ],
        ]);
        const summary = resultCalls[0][1] as MultiOutputResponse;
        expect(summary).not.toBe(saveResponse);
        expect(summary.results).not.toBe(saveResponse.results);
        summary.results.forEach((result, index) => {
          expect(result).not.toBe(saveResponse.results[index]);
        });
        expect(JSON.stringify(infoSpy.mock.calls)).not.toMatch(
          /PRIVATE_|error|warning|savedAs|fileName|path|capturedAt/
        );
        if (testCase.allSuccessful) {
          expect(showToast).toHaveBeenCalledWith('Saved locally', 'success');
          expect(showErrorToast).not.toHaveBeenCalled();
        } else if (testCase.anySuccessful) {
          expect(showWarningToast).toHaveBeenCalledWith(
            'Saved to: obsidian, clipboard. Failed: file: PRIVATE_ERROR'
          );
          expect(showErrorToast).not.toHaveBeenCalled();
        } else {
          expect(showErrorToast).toHaveBeenCalledWith(
            'PRIVATE_ERROR; PRIVATE_ERROR; PRIVATE_ERROR'
          );
        }
        expect(setButtonLoading).toHaveBeenLastCalledWith(false);
      } finally {
        infoSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('keeps a collision-resolved filename out of the generic success toast', async () => {
      loadGeminiConversation();
      mockMessaging({
        save: {
          results: [{ destination: 'obsidian', success: true, savedAs: 'hello-a1b2c3d4.md' }],
          allSuccessful: true,
          anySuccessful: true,
        },
      });

      await handleSync();

      expect(showToast).toHaveBeenCalledWith('Saved locally', 'success');
      expect(showSuccessToast).not.toHaveBeenCalled();
    });

    it('shows the appended-message toast when messages were appended', async () => {
      loadGeminiConversation();
      mockMessaging({ save: { ...okSave, messagesAppended: 2 } });

      await handleSync();

      expect(showToast).toHaveBeenCalledWith('2 new message(s) appended', 'success');
    });

    it('shows the no-new-messages toast when nothing was appended', async () => {
      loadGeminiConversation();
      mockMessaging({ save: { ...okSave, messagesAppended: 0 } });

      await handleSync();

      expect(showToast).toHaveBeenCalledWith(
        'No new messages to append',
        'info',
        expect.any(Number)
      );
    });

    it('shows a warning when only some outputs succeed', async () => {
      loadGeminiConversation();
      mockMessaging({
        settings: { outputOptions: { obsidian: true, file: false, clipboard: true } },
        save: {
          results: [
            { destination: 'obsidian', success: true },
            { destination: 'clipboard', success: false, error: 'copy failed' },
          ],
          allSuccessful: false,
          anySuccessful: true,
        },
      });

      await handleSync();

      expect(showWarningToast).toHaveBeenCalledWith(
        'Saved to: obsidian. Failed: clipboard: copy failed'
      );
    });

    it('surfaces a save warning after the success toast (issue #376)', async () => {
      vi.useFakeTimers();
      try {
        loadGeminiConversation();
        mockMessaging({
          save: {
            results: [
              {
                destination: 'obsidian',
                success: true,
                warning: '1 image could not be saved',
              },
            ],
            allSuccessful: true,
            anySuccessful: true,
          },
        });

        const pending = handleSync();
        await vi.advanceTimersByTimeAsync(10_000);
        await pending;

        expect(showToast).toHaveBeenCalledWith('Saved locally', 'success');
        expect(showWarningToast).toHaveBeenCalledWith('1 image could not be saved');
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows an error when every output fails', async () => {
      loadGeminiConversation();
      mockMessaging({
        save: {
          results: [{ destination: 'obsidian', success: false, error: 'disk full' }],
          allSuccessful: false,
          anySuccessful: false,
        },
      });

      await handleSync();

      expect(showErrorToast).toHaveBeenCalledWith('disk full');
    });

    it('shows a generic error when failures carry no message', async () => {
      loadGeminiConversation();
      mockMessaging({
        save: {
          results: [{ destination: 'obsidian', success: false }],
          allSuccessful: false,
          anySuccessful: false,
        },
      });

      await handleSync();

      expect(showErrorToast).toHaveBeenCalledWith('Failed to save');
    });

    it('surfaces a background rejection instead of reading results.map', async () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      try {
        loadGeminiConversation();
        mockMessaging({
          save: { success: false, error: 'PRIVATE_BACKGROUND_ERROR' },
        });

        await handleSync();

        expect(showErrorToast).toHaveBeenCalledWith('PRIVATE_BACKGROUND_ERROR');
        expect(
          infoSpy.mock.calls.filter(([message]) => message.startsWith('[G2O] Note write'))
        ).toStrictEqual([['[G2O] Note write response invalid']]);
        expect(JSON.stringify(infoSpy.mock.calls)).not.toContain('PRIVATE_BACKGROUND_ERROR');
      } finally {
        infoSpy.mockRestore();
      }
    });

    it('rejects malformed result entries instead of passing them to results.map', async () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      try {
        loadGeminiConversation();
        mockMessaging({
          save: { results: [null], allSuccessful: true, anySuccessful: true },
        });

        await handleSync();

        expect(showErrorToast).toHaveBeenCalledWith('Invalid response from extension background');
        expect(
          infoSpy.mock.calls.filter(([message]) => message.startsWith('[G2O] Note write'))
        ).toStrictEqual([['[G2O] Note write response invalid']]);
      } finally {
        infoSpy.mockRestore();
      }
    });

    it('catches messaging errors and resets the button state', async () => {
      loadGeminiConversation();
      vi.mocked(sendMessage).mockRejectedValue(new Error('Extension context invalidated.'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await handleSync();

      expect(showErrorToast).toHaveBeenCalledWith(
        'Failed while loading extension settings: Extension context invalidated.'
      );
      expect(setButtonLoading).toHaveBeenLastCalledWith(false);
      errorSpy.mockRestore();
    });
  });
});
