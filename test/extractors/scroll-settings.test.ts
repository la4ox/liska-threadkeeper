import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseExtractor, type ScrollConfig } from '../../src/content/extractors/base';
import { ClaudeExtractor } from '../../src/content/extractors/claude';
import { ChatGPTExtractor } from '../../src/content/extractors/chatgpt';
import { DeepSeekExtractor } from '../../src/content/extractors/deepseek';
import { GeminiExtractor } from '../../src/content/extractors/gemini';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import * as scrollManager from '../../src/lib/scroll-manager';
import type { ScrollDeadlines } from '../../src/lib/scroll-deadlines';
import type { ConversationMessage, SyncSettings } from '../../src/lib/types';
import { clearFixture, resetLocation, setGeminiLocation } from '../fixtures/dom-helpers';

const configured: SyncSettings = {
  ...DEFAULT_SYNC_SETTINGS,
  enableAutoScroll: true,
  scrollIdleTimeoutSec: 120,
  scrollMaxTimeoutSec: 30,
  enableToolContent: true,
  enableImageExport: false,
  enableChatGptOpaqueProbe: true,
  enableChatGptOpaqueReplay: false,
};
const deadlines = { idleTimeoutMs: 120_000, maxTimeoutMs: 30_000 };

// Inspect protected seams without adding production accessors for test-only state.
interface SettingsSeams {
  scrollDeadlines: Readonly<ScrollDeadlines>;
  applyPlatformSettings(settings: SyncSettings): void;
  getScrollConfig(): ScrollConfig | null;
  collectMessages(): Promise<{ messages: ConversationMessage[] }>;
}
function seams(extractor: BaseExtractor): SettingsSeams {
  return extractor as unknown as SettingsSeams;
}

describe('common extractor scroll settings', () => {
  beforeEach(() => clearFixture());
  afterEach(() => {
    vi.restoreAllMocks();
    clearFixture();
    resetLocation();
  });

  it.each([ClaudeExtractor, ChatGPTExtractor, DeepSeekExtractor, GeminiExtractor])(
    '%s inherits the common settings owner and invokes its provider hook after common state',
    Provider => {
      const extractor = new Provider();
      const originalHook = seams(extractor).applyPlatformSettings.bind(extractor);
      const hook = vi
        .spyOn(seams(extractor), 'applyPlatformSettings')
        .mockImplementation(settings => {
          expect(extractor.enableAutoScroll).toBe(settings.enableAutoScroll);
          expect(seams(extractor).scrollDeadlines).toEqual(deadlines);
          originalHook(settings);
        });
      expect(extractor.applySettings).toBe(BaseExtractor.prototype.applySettings);
      extractor.applySettings(configured);
      expect(hook).toHaveBeenCalledExactlyOnceWith(configured);
      if (extractor instanceof GeminiExtractor) expect(extractor.enableImageExport).toBe(false);
      else expect(extractor.enableToolContent).toBe(true);
      if (extractor instanceof ChatGPTExtractor) {
        expect(extractor).toMatchObject({
          enableChatGptOpaqueProbe: true,
          enableChatGptOpaqueReplay: false,
        });
      }
      hook.mockRestore();
      extractor.applySettings(DEFAULT_SYNC_SETTINGS);
      expect(extractor.enableAutoScroll).toBe(false);
      expect(seams(extractor).scrollDeadlines).toEqual({
        idleTimeoutMs: 15_000,
        maxTimeoutMs: 300_000,
      });
    }
  );

  it.each([ClaudeExtractor, ChatGPTExtractor, DeepSeekExtractor])(
    '%s passes resolved deadlines through Base to the virtualized manager',
    async Provider => {
      document.body.innerHTML = '<div id="scroll"></div>';
      const extractor = new Provider();
      const harvest = vi.fn(() => []);
      vi.spyOn(seams(extractor), 'getScrollConfig').mockReturnValue({
        container: ['#scroll'],
        harvest,
      });
      const accumulate = vi.spyOn(scrollManager, 'accumulateWhileScrolling').mockResolvedValue({
        items: [],
        itemCount: 0,
        iterations: 1,
        fullyLoaded: true,
        skipped: false,
        stopReason: 'stable',
      });
      extractor.applySettings(configured);
      await seams(extractor).collectMessages();
      expect(accumulate).toHaveBeenCalledExactlyOnceWith(
        document.getElementById('scroll'),
        expect.any(Function),
        deadlines
      );
      accumulate.mock.calls[0][1]();
      expect(harvest).toHaveBeenCalledOnce();
    }
  );

  it('passes resolved deadlines through the existing Gemini extract override', async () => {
    setGeminiLocation('settings-test');
    document.body.innerHTML = '<infinite-scroller></infinite-scroller>';
    const ensure = vi.spyOn(scrollManager, 'ensureAllElementsLoaded').mockResolvedValue({
      stopReason: 'stable',
      fullyLoaded: true,
      elementCount: 2,
      scrollIterations: 1,
      skipped: false,
    });
    const extractor = new GeminiExtractor();
    vi.spyOn(extractor, 'extractMessages').mockReturnValue([
      { id: 'u', role: 'user', content: 'Question', index: 0 },
      { id: 'a', role: 'assistant', content: 'Answer', index: 1 },
    ]);
    extractor.applySettings(configured);
    expect((await extractor.extract()).success).toBe(true);
    expect(ensure).toHaveBeenCalledExactlyOnceWith(
      document.querySelector('infinite-scroller'),
      expect.any(String),
      deadlines
    );
    expect(GeminiExtractor.prototype.extract).not.toBe(BaseExtractor.prototype.extract);
  });
});
