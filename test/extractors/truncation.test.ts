import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseExtractor } from '../../src/content/extractors/base';
import { GeminiExtractor } from '../../src/content/extractors/gemini';
import { ChatGPTExtractor } from '../../src/content/extractors/chatgpt';
import { DeepSeekExtractor } from '../../src/content/extractors/deepseek';
import type { ConversationData, ConversationMessage } from '../../src/lib/types';
import {
  createGeminiConversationDOM,
  createGeminiScrollableDOM,
  createDeepResearchDOM,
  loadFixture,
  resetLocation,
  setGeminiLocation,
  setChatGPTLocation,
} from '../fixtures/dom-helpers';

const mocks = vi.hoisted(() => ({
  accumulate: vi.fn(),
  ensure: vi.fn(),
  image: vi.fn(),
  history: vi.fn(),
}));
vi.mock('../../src/lib/scroll-manager', () => ({
  accumulateWhileScrolling: mocks.accumulate,
  ensureAllElementsLoaded: mocks.ensure,
}));
vi.mock('../../src/content/image-capture', () => ({ captureImage: mocks.image }));
vi.mock('../../src/content/extractors/deepseek-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/content/extractors/deepseek-api')>()),
  fetchDeepSeekConversation: mocks.history,
}));

const messages: ConversationMessage[] = [{ id: 'u', role: 'user', content: 'question', index: 0 }];
const data: ConversationData = {
  id: '01234567-89ab-4cde-8f01-23456789abcd',
  title: 'Structured title',
  url: 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd',
  source: 'chatgpt',
  messages,
  extractedAt: new Date('2026-01-01'),
  metadata: {
    messageCount: 1,
    userMessageCount: 1,
    assistantMessageCount: 0,
    hasCodeBlocks: false,
  },
};

class ScrollingExtractor extends BaseExtractor {
  readonly platform = 'claude';
  configured = true;
  canExtract() {
    return true;
  }
  getConversationId() {
    return 'test-id';
  }
  getTitle() {
    return 'title';
  }
  extractMessages() {
    return messages;
  }
  protected getScrollConfig() {
    return this.configured ? { container: ['#scroll'], harvest: () => [] } : null;
  }
}

class ChatGptFallbackExtractor extends ChatGPTExtractor {
  protected getScrollConfig() {
    return { container: ['#scroll'], harvest: () => [] };
  }
}
class DeepSeekFallbackExtractor extends DeepSeekExtractor {
  protected getScrollConfig() {
    return { container: ['#scroll'], harvest: () => [] };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="scroll"></div>';
  mocks.accumulate.mockResolvedValue({
    items: messages,
    fullyLoaded: false,
    skipped: false,
    itemCount: 1,
    iterations: 1,
  });
  mocks.ensure.mockResolvedValue({
    fullyLoaded: false,
    skipped: false,
    elementCount: 1,
    scrollIterations: 1,
  });
  mocks.history.mockResolvedValue(null);
});
afterEach(() => {
  resetLocation();
  document.body.innerHTML = '';
});

describe('BaseExtractor typed deadline evidence', () => {
  it.each([
    { fullyLoaded: false, skipped: false, expected: true },
    { fullyLoaded: true, skipped: false, expected: undefined },
    { fullyLoaded: true, skipped: true, expected: undefined },
    { fullyLoaded: false, skipped: true, expected: undefined },
  ])(
    'marks only incomplete and not-skipped results: $fullyLoaded / $skipped',
    async ({ fullyLoaded, skipped, expected }) => {
      mocks.accumulate.mockResolvedValue({
        items: messages,
        fullyLoaded,
        skipped,
        itemCount: 1,
        iterations: 1,
      });
      const extractor = new ScrollingExtractor();
      extractor.enableAutoScroll = true;
      const result = await extractor.extract();
      expect(result.success).toBe(true);
      expect(result.data?.truncated).toBe(expected);
      expect(result).not.toHaveProperty('truncated');
    }
  );

  it.each(['disabled', 'unconfigured', 'missing-container'])('leaves %s unmarked', async mode => {
    const extractor = new ScrollingExtractor();
    extractor.enableAutoScroll = mode !== 'disabled';
    extractor.configured = mode !== 'unconfigured';
    if (mode === 'missing-container') document.body.innerHTML = '';
    expect((await extractor.extract()).data).not.toHaveProperty('truncated');
    expect(mocks.accumulate).not.toHaveBeenCalled();
  });

  it('does not mark Deep Research intercepted before DOM collection', async () => {
    class ResearchExtractor extends ScrollingExtractor {
      protected isDeepResearchVisible() {
        return true;
      }
      protected extractDeepResearchContent() {
        return '<p>Report</p>';
      }
    }
    const extractor = new ResearchExtractor();
    extractor.enableAutoScroll = true;
    const result = await extractor.extract();
    expect(result.data?.type).toBe('deep-research');
    expect(result.data).not.toHaveProperty('truncated');
    expect(mocks.accumulate).not.toHaveBeenCalled();
  });
});

describe('Gemini override preserves typed evidence and images', () => {
  const img =
    '<div class="attachment-container generated-images"><generated-image><single-image><div class="image-container"><button class="image-button"><img class="image" alt="image" src="blob:synthetic"></button></div></single-image></generated-image></div>';
  it('preserves images and earlier image/model warnings alongside the timeout flag', async () => {
    setGeminiLocation('test');
    loadFixture(
      createGeminiScrollableDOM(
        `<div class="conversation-container"><model-response><div class="markdown markdown-main-panel"><p>answer</p>${img}${img}</div></model-response></div>`
      )
    );
    const image = { id: 'img-1', mimeType: 'image/png', data: 'UE5H', alt: 'image' };
    mocks.image
      .mockResolvedValueOnce({ image })
      .mockResolvedValueOnce({ image: null, reason: 'synthetic capture failure' });
    const extractor = new GeminiExtractor();
    extractor.enableAutoScroll = true;
    const result = await extractor.extract();
    expect(result.data?.truncated).toBe(true);
    expect(result.data?.images).toEqual([image]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'No user messages found',
        expect.stringContaining('1 image(s) could not be captured'),
        expect.stringContaining('Auto-scroll timed out'),
      ])
    );
  });

  it.each([
    { fullyLoaded: true, skipped: false },
    { fullyLoaded: true, skipped: true },
    { fullyLoaded: false, skipped: true },
  ])('leaves complete/skipped results unmarked: $fullyLoaded / $skipped', async state => {
    setGeminiLocation('test');
    loadFixture(
      createGeminiScrollableDOM(
        createGeminiConversationDOM([{ role: 'user', content: 'question' }])
      )
    );
    mocks.ensure.mockResolvedValue({ ...state, elementCount: 1, scrollIterations: 1 });
    const extractor = new GeminiExtractor();
    extractor.enableAutoScroll = true;
    expect((await extractor.extract()).data).not.toHaveProperty('truncated');
  });

  it.each(['disabled', 'missing-container', 'deep-research'])(
    'leaves %s unmarked without scrolling',
    async mode => {
      setGeminiLocation('test');
      loadFixture(
        mode === 'deep-research'
          ? createDeepResearchDOM('Report', '<p>report</p>')
          : createGeminiConversationDOM([{ role: 'user', content: 'question' }])
      );
      const extractor = new GeminiExtractor();
      extractor.enableAutoScroll = mode !== 'disabled';
      expect((await extractor.extract()).data).not.toHaveProperty('truncated');
      expect(mocks.ensure).not.toHaveBeenCalled();
    }
  );
});

describe('structured-provider DOM fallbacks retain data evidence', () => {
  it('ChatGPT fallback retains timeout evidence, not just partial capture metadata', async () => {
    setChatGPTLocation(data.id);
    const extractor = new ChatGptFallbackExtractor({
      manifestAllowsStructuredCapture: () => false,
    });
    extractor.enableAutoScroll = true;
    const result = await extractor.extract();
    expect(result.success).toBe(true);
    expect(result.data?.truncated).toBe(true);
    expect(result.data?.capture).toEqual({ mode: 'dom-fallback', completeness: 'partial' });
  });

  it('DeepSeek fallback retains timeout evidence', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        hostname: 'chat.deepseek.com',
        pathname: '/a/chat/s/test',
        href: 'https://chat.deepseek.com/a/chat/s/test',
      },
    });
    const extractor = new DeepSeekFallbackExtractor();
    extractor.enableAutoScroll = true;
    const result = await extractor.extract();
    expect(result.success).toBe(true);
    expect(result.data?.truncated).toBe(true);
    expect(result.data?.capture).toEqual({ mode: 'dom-fallback', completeness: 'partial' });
  });

  it('ChatGPT complete structured capture bypasses DOM deadline evidence', async () => {
    setChatGPTLocation(data.id);
    const extractor = new ChatGPTExtractor({
      manifestAllowsStructuredCapture: () => true,
      captureCurrentBranch: async () => ({ data, warnings: [], selectedNodeIds: ['u'] }),
    });
    extractor.enableAutoScroll = true;
    const result = await extractor.extract();
    expect(result.data?.capture?.completeness).toBe('complete');
    expect(result.data).not.toHaveProperty('truncated');
    expect(mocks.accumulate).not.toHaveBeenCalled();
  });

  it('DeepSeek complete structured capture bypasses DOM deadline evidence', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        hostname: 'chat.deepseek.com',
        pathname: '/a/chat/s/test',
        href: 'https://chat.deepseek.com/a/chat/s/test',
      },
    });
    mocks.history.mockResolvedValue({
      data: {
        ...data,
        source: 'deepseek',
        capture: { mode: 'structured-api', completeness: 'complete' },
      },
      warnings: [],
      archiveCompanion: undefined,
    });
    const extractor = new DeepSeekFallbackExtractor();
    extractor.enableAutoScroll = true;
    const result = await extractor.extract();
    expect(result.data?.capture?.completeness).toBe('complete');
    expect(result.data).not.toHaveProperty('truncated');
    expect(mocks.accumulate).not.toHaveBeenCalled();
  });
});
