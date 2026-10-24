import { describe, it, expect, afterEach } from 'vitest';
import { CONVERSATION_READY_SELECTORS } from '../../src/content/extractors/selectors/ready';
import { SELECTORS as GEMINI } from '../../src/content/extractors/selectors/gemini';
import { SELECTORS as CLAUDE } from '../../src/content/extractors/selectors/claude';
import { SELECTORS as CHATGPT } from '../../src/content/extractors/selectors/chatgpt';
import {
  SELECTORS as PERPLEXITY,
  LEGACY_USER_QUERY,
} from '../../src/content/extractors/selectors/perplexity';
import { SELECTORS as DEEPSEEK } from '../../src/content/extractors/selectors/deepseek';
import { SELECTORS as NOTEBOOKLM } from '../../src/content/extractors/selectors/notebooklm';
import { PLATFORM_REGISTRY } from '../../src/lib/platform-registry';
import {
  createClaudeConversationDOM,
  createPerplexityConversationDOM,
} from '../fixtures/dom-helpers';

const claudeContentCases = [
  { selector: CLAUDE.userMessage[0], html: '<div data-testid="user-message">Question</div>' },
  {
    selector: CLAUDE.userMessage[1],
    html: '<p class="whitespace-pre-wrap break-words">Question</p>',
  },
  {
    selector: CLAUDE.assistantResponse[0],
    html: '<div data-testid="assistant-message">Answer</div>',
  },
  { selector: CLAUDE.assistantResponse[1], html: '<div data-cds="AssistantMessage">Answer</div>' },
  { selector: CLAUDE.assistantResponse[2], html: '<div class="font-claude-response">Answer</div>' },
  {
    selector: CLAUDE.assistantResponse[3],
    html: '<div class="prefix-font-claude-response-suffix">Answer</div>',
  },
  { selector: CLAUDE.assistantResponse[4], html: '<div data-is-streaming="true">Answer</div>' },
] as const;

describe('CONVERSATION_READY_SELECTORS', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('has exactly one entry per registered logical platform, including DeepSeek', () => {
    expect(Object.keys(CONVERSATION_READY_SELECTORS).sort()).toEqual(
      Object.keys(PLATFORM_REGISTRY).sort()
    );
    expect(Object.keys(CONVERSATION_READY_SELECTORS)).toHaveLength(6);
  });

  it.each([
    ['gemini', [...GEMINI.conversationTurn, ...GEMINI.userQuery, ...GEMINI.modelResponse]],
    ['chatgpt', CHATGPT.conversationTurn],
    ['perplexity', [...PERPLEXITY.userQuery, ...LEGACY_USER_QUERY]],
    ['deepseek', DEEPSEEK.message],
    ['notebooklm', NOTEBOOKLM.conversationTurn],
  ] as const)('includes the full %s extractor group in priority order', (platform, selectors) => {
    expect(CONVERSATION_READY_SELECTORS[platform]).toBe(selectors.join(', '));
  });

  it('includes all owned Claude row and message selectors in its qualified hint', () => {
    for (const selector of [
      ...CLAUDE.conversationRow,
      ...CLAUDE.userMessage,
      ...CLAUDE.assistantResponse,
    ]) {
      expect(CONVERSATION_READY_SELECTORS.claude).toContain(selector);
    }
    expect(claudeContentCases.map(({ selector }) => selector)).toEqual([
      ...CLAUDE.userMessage,
      ...CLAUDE.assistantResponse,
    ]);
  });

  it.each(claudeContentCases)('accepts a Claude row containing $selector', ({ selector, html }) => {
    const row = document.createElement('div');
    row.dataset.index = '1';
    row.innerHTML = html;
    document.body.append(row);

    expect(row.matches(CLAUDE.conversationRow.join(', '))).toBe(true);
    expect(row.querySelector(selector)).not.toBeNull();
    expect(document.querySelector(CONVERSATION_READY_SELECTORS.claude)).toBe(row);
  });

  it.each(claudeContentCases)(
    'accepts the rowless transcript fallback containing $selector',
    ({ selector, html }) => {
      document.body.innerHTML = `<div class="conversation-thread">${html}</div>`;
      expect(document.querySelector(selector)).not.toBeNull();
      expect(document.querySelector(CLAUDE.conversationRow.join(', '))).toBeNull();
      expect(document.querySelector(CONVERSATION_READY_SELECTORS.claude)).not.toBeNull();
    }
  );

  it.each(claudeContentCases)(
    'rejects rowless $selector content outside the transcript root',
    ({ html }) => {
      document.body.innerHTML = `
        <aside><div data-index="0"><a>Older chat</a></div></aside>
        <main>${html}<div class="conversation-thread"></div></main>
      `;
      expect(document.querySelector(CONVERSATION_READY_SELECTORS.claude)).toBeNull();
    }
  );

  it('accepts the supported legacy Claude fixture without indexed rows', () => {
    document.body.innerHTML = createClaudeConversationDOM([
      { role: 'user', content: 'Legacy question' },
      { role: 'assistant', content: '<p>Legacy answer</p>' },
    ]);
    expect(document.querySelector(CLAUDE.conversationRow.join(', '))).toBeNull();
    expect(document.querySelector(CONVERSATION_READY_SELECTORS.claude)).not.toBeNull();
  });

  it('accepts the supported legacy Perplexity fixture without current query renderers', () => {
    document.body.innerHTML = createPerplexityConversationDOM([
      { role: 'user', content: 'Legacy question' },
    ]);
    expect(document.querySelector(PERPLEXITY.userQuery.join(', '))).toBeNull();
    expect(document.querySelector(CONVERSATION_READY_SELECTORS.perplexity)).not.toBeNull();
  });

  it('keeps supported Perplexity legacy detection outside the current live-selector contract', () => {
    for (const selector of LEGACY_USER_QUERY) {
      expect(Object.values(PERPLEXITY).flat()).not.toContain(selector);
      expect(CONVERSATION_READY_SELECTORS.perplexity).toContain(selector);
    }
  });

  it.each([
    '<user-query><p class="query-text-line">Question</p></user-query>',
    '<div class="legacy-user-query"><p class="query-text-line">Question</p></div>',
    '<model-response><div class="markdown markdown-main-panel"><p>Answer</p></div></model-response>',
    '<div class="legacy-model-response"><div class="model-response-text">Answer</div></div>',
  ])('accepts a Gemini root fallback without conversation turns: %s', html => {
    document.body.innerHTML = html;
    expect(document.querySelector(GEMINI.conversationTurn.join(', '))).toBeNull();
    expect(document.querySelector(CONVERSATION_READY_SELECTORS.gemini)).not.toBeNull();
  });

  it('rejects a bare indexed sidebar even when message content exists outside that row', () => {
    document.body.innerHTML = `
      <aside><div data-index="0"><a>Older chat</a></div></aside>
      <main><div data-testid="user-message">Not inside an indexed row</div></main>
      <div class="conversation-thread"></div>
    `;

    expect(document.querySelector(CLAUDE.conversationRow.join(', '))).not.toBeNull();
    expect(document.querySelector(CONVERSATION_READY_SELECTORS.claude)).toBeNull();
  });

  it('does not carry broad conversation classes or dead platform variants', () => {
    const selectors = Object.values(CONVERSATION_READY_SELECTORS);
    expect(selectors).not.toContain('.conversation');
    expect(selectors).not.toContain('[class*="conversation"]');
    for (const selector of selectors) {
      expect(selector).not.toContain('article[data-turn-id]');
      expect(selector).not.toContain('threadContentWidth');
    }
  });

  it.each(Object.entries(CONVERSATION_READY_SELECTORS))(
    'provides a nonempty valid CSS readiness hint for %s',
    (_platform, selector) => {
      expect(selector.trim().length).toBeGreaterThan(0);
      expect(() => document.querySelector(selector)).not.toThrow();
    }
  );
});
