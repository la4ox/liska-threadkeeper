import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGPTExtractor } from '../../src/content/extractors/chatgpt';
import {
  createPairedChatGptPage,
  renderPairedTurn,
  type PairedTurn,
} from '../fixtures/chatgpt-paired-dom';
import {
  clearFixture,
  loadFixture,
  resetLocation,
  setChatGPTLocation,
} from '../fixtures/dom-helpers';
import type { SyncSettings } from '../../src/lib/types';

function plainText(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '';
}

function mountVirtualizedPairedTurns(
  turns: readonly PairedTurn[],
  options: { windowSize: number; pages: readonly number[]; loadDelayMs: number }
): void {
  document.body.innerHTML = createPairedChatGptPage([]);
  const scroller = document.querySelector<HTMLElement>('[data-app-action-timeline-scroll]')!;
  const list = scroller.firstElementChild as HTMLElement;
  const clientHeight = 900;
  const turnHeight = 500;
  let loadedPages = 1;
  let loaded = options.pages[0];
  let scrollTop = 0;
  let atTopSince: number | null = null;

  const maxScroll = () => Math.max(0, loaded * turnHeight - clientHeight);
  const render = (): void => {
    const first = turns.length - loaded;
    const distance = scrollTop + maxScroll();
    const start = Math.min(
      Math.max(0, loaded - options.windowSize),
      Math.max(0, Math.floor(distance / turnHeight))
    );
    list.innerHTML = turns
      .slice(first + start, first + start + options.windowSize)
      .map(renderPairedTurn)
      .join('');
  };
  const maybeLoad = (): void => {
    const atTop = maxScroll() > 0 && scrollTop <= -maxScroll();
    if (!atTop) {
      atTopSince = null;
      return;
    }
    atTopSince ??= Date.now();
    if (loadedPages < options.pages.length && Date.now() - atTopSince >= options.loadDelayMs) {
      loaded += options.pages[loadedPages++];
      atTopSince = null;
      render();
    }
  };

  Object.defineProperty(scroller, 'scrollTop', {
    get: () => {
      maybeLoad();
      return scrollTop;
    },
    set: (value: number) => {
      scrollTop = Math.max(-maxScroll(), Math.min(0, value));
      maybeLoad();
      render();
    },
    configurable: true,
  });
  Object.defineProperty(scroller, 'clientHeight', { get: () => clientHeight, configurable: true });
  Object.defineProperty(scroller, 'scrollHeight', {
    get: () => maxScroll() + clientHeight,
    configurable: true,
  });
  render();
}

describe('ChatGPTExtractor paired DOM fallback', () => {
  let extractor: ChatGPTExtractor;

  beforeEach(() => {
    extractor = new ChatGPTExtractor();
    setChatGPTLocation('6789abcd-ef01-2345-6789-abcdef012345');
  });

  afterEach(() => {
    vi.useRealTimers();
    clearFixture();
    resetLocation();
  });

  it('emits prompt then answer for every paired turn in DOM order', () => {
    loadFixture(
      createPairedChatGptPage([
        { key: 'turn-1', user: 'First question', answers: ['<p>First answer</p>'] },
        { key: 'turn-2', user: 'Second question', answers: ['<p>Second answer</p>'] },
      ])
    );

    const messages = extractor.extractMessages();
    expect(messages.map(message => [message.role, plainText(message.content)])).toEqual([
      ['user', 'First question'],
      ['assistant', 'First answer'],
      ['user', 'Second question'],
      ['assistant', 'Second answer'],
    ]);
    expect(messages.map(message => message.index)).toEqual([0, 1, 2, 3]);
  });

  it('keeps a prompt-only turn and excludes separators and assistant role chrome', () => {
    loadFixture(
      createPairedChatGptPage([
        {
          key: 'turn-1',
          user: 'Prompt only',
          dateSeparator: 'Thu, Jan 29 at 4:47 PM',
        },
        {
          key: 'turn-2',
          user: 'Question',
          answers: ['<p>Part one</p>', '<p>Part two</p>'],
        },
      ])
    );

    const messages = extractor.extractMessages();
    expect(messages.map(message => plainText(message.content))).toEqual([
      'Prompt only',
      'Question',
      'Part one\n\nPart two',
    ]);
    expect(messages.map(message => message.content).join('\n')).not.toContain('ChatGPT said:');
    expect(messages.map(message => message.content).join('\n')).not.toContain('Thu, Jan 29');
  });

  it('does not fabricate a paired user message from assistant preformatted content', () => {
    loadFixture(`<div data-turn-key="assistant-only">
      <div data-chatgpt-search-message-ids="assistant-1">
        <h4 data-conversation-role="assistant">ChatGPT said:</h4>
        <div data-markdown-text-style="assistant-message">
          <pre class="whitespace-pre-wrap">assistant code</pre>
        </div>
      </div>
    </div>`);

    const messages = extractor.extractMessages();
    expect(messages.map(message => message.role)).toEqual(['assistant']);
    expect(plainText(messages[0].content)).toBe('assistant code');
  });

  it('uses exact child message ids when the paired turn key is empty', () => {
    loadFixture(
      createPairedChatGptPage([
        {
          key: '',
          userMessageId: 'user-1',
          assistantMessageId: 'assistant-1',
          user: 'Same question',
          answers: ['<p>Same answer</p>'],
        },
        {
          key: '',
          userMessageId: 'user-2',
          assistantMessageId: 'assistant-2',
          user: 'Same question',
          answers: ['<p>Same answer</p>'],
        },
      ])
    );

    const messages = extractor.extractMessages();
    expect(messages).toHaveLength(4);
    expect(new Set(messages.map(message => message.id)).size).toBe(4);
  });

  it('does not collapse keyless turns without child message ids in one mounted window', () => {
    loadFixture(`<div data-turn-key="">
      <div data-user-message-bubble><div class="whitespace-pre-wrap">Same question</div></div>
      <h4 data-conversation-role="assistant">ChatGPT said:</h4>
      <div data-markdown-text-style="assistant-message"><p>Same answer</p></div>
    </div>
    <div data-turn-key="">
      <div data-user-message-bubble><div class="whitespace-pre-wrap">Same question</div></div>
      <h4 data-conversation-role="assistant">ChatGPT said:</h4>
      <div data-markdown-text-style="assistant-message"><p>Same answer</p></div>
    </div>`);

    const messages = extractor.extractMessages();
    expect(messages).toHaveLength(4);
    expect(new Set(messages.map(message => message.id)).size).toBe(4);
  });

  it('keeps stable keys when child message ids arrive on a later remount', () => {
    loadFixture(`<div data-turn-key="stable-turn">
      <div data-user-message-bubble><div class="whitespace-pre-wrap">Question</div></div>
      <h4 data-conversation-role="assistant">ChatGPT said:</h4>
      <div data-markdown-text-style="assistant-message"><p>Partial answer</p></div>
    </div>`);
    const first = extractor['harvestWindow']();

    loadFixture(
      createPairedChatGptPage([
        {
          key: 'stable-turn',
          userMessageId: 'late-user-id',
          assistantMessageId: 'late-assistant-id',
          user: 'Question',
          answers: ['<p>Final answer</p>'],
        },
      ])
    );
    const second = extractor['harvestWindow']();

    expect(first.map(entry => entry.key)).toEqual(['stable-turn:user', 'stable-turn:assistant']);
    expect(second.map(entry => entry.key)).toEqual(first.map(entry => entry.key));
    expect(plainText(second[1].value.content)).toBe('Final answer');
  });

  it('retains distinct current and legacy turns on a mixed rollout page', () => {
    loadFixture(`${createPairedChatGptPage([
      { key: 'pair-1', user: 'Pair question', answers: ['<p>Pair answer</p>'] },
    ])}
      <section data-turn-id="legacy-user" data-turn="user">
        <div class="whitespace-pre-wrap">Legacy question</div>
      </section>
      <section data-testid="conversation-turn-3" data-turn="assistant">
        <div data-message-id="legacy-assistant" class="markdown prose"><p>Legacy answer</p></div>
      </section>`);

    expect(extractor.extractMessages().map(message => plainText(message.content))).toEqual([
      'Pair question',
      'Pair answer',
      'Legacy question',
      'Legacy answer',
    ]);
  });

  it('keeps a current pair once when a weaker legacy wrapper contains it', () => {
    loadFixture(`<section data-turn-id="legacy-wrapper" data-turn="assistant">
      ${renderPairedTurn(
        { key: 'pair-1', user: 'Pair question', answers: ['<p>Pair answer</p>'] },
        0
      )}
    </section>`);

    expect(extractor.extractMessages().map(message => plainText(message.content))).toEqual([
      'Pair question',
      'Pair answer',
    ]);
  });

  it('uses a current prompt for title fallback when the document title is bare', () => {
    document.title = 'ChatGPT';
    loadFixture(
      createPairedChatGptPage([{ key: 'pair-1', user: 'Plan a trip', answers: ['<p>Sure</p>'] }])
    );

    expect(extractor.getTitle()).toBe('Plan a trip');
  });

  it('accumulates a column-reverse thread and waits for late older pages', async () => {
    vi.useFakeTimers();
    const turns: PairedTurn[] = Array.from({ length: 12 }, (_, index) => ({
      key: `turn-${index}`,
      user: `Q${index}`,
      answers: [`<p>A${index}</p>`],
    }));
    mountVirtualizedPairedTurns(turns, {
      windowSize: 3,
      pages: [4, 4, 4],
      loadDelayMs: 1800,
    });
    extractor.applySettings({ enableAutoScroll: true } as SyncSettings);

    const pending = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.success).toBe(true);
    expect(result.data?.messages.map(message => plainText(message.content))).toEqual(
      turns.flatMap((_, index) => [`Q${index}`, `A${index}`])
    );
    expect(result.data?.domHistoryLoad).toBe('complete');
    expect(result.data?.capture).toEqual({ mode: 'dom-fallback', completeness: 'partial' });
  });

  it('keeps a hidden zero-range paired fallback runtime-partial', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    loadFixture(
      createPairedChatGptPage([
        { key: 'turn-1', user: 'Question', answers: ['<p>Visible answer</p>'] },
      ])
    );
    const scroller = document.querySelector<HTMLElement>('[data-app-action-timeline-scroll]')!;
    Object.defineProperty(scroller, 'clientHeight', { get: () => 500, configurable: true });
    Object.defineProperty(scroller, 'scrollHeight', { get: () => 500, configurable: true });
    Object.defineProperty(scroller, 'scrollTop', {
      get: () => 0,
      set: () => {},
      configurable: true,
    });
    extractor.applySettings({ enableAutoScroll: true } as SyncSettings);

    try {
      const pending = extractor.extract();
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result.success).toBe(true);
      expect(result.data?.domHistoryLoad).toBe('partial');
      expect(result.warnings?.some(warning => warning.includes('Auto-scroll timed out'))).toBe(
        true
      );
      expect(result.data?.capture).toEqual({ mode: 'dom-fallback', completeness: 'partial' });
    } finally {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    }
  });
});
