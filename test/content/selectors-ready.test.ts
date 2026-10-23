import { describe, it, expect } from 'vitest';
import {
  CONVERSATION_READY_SELECTORS,
  CONVERSATION_CONTAINER_SELECTOR,
} from '../../src/content/extractors/selectors/ready';
import { SELECTORS as GEMINI } from '../../src/content/extractors/selectors/gemini';
import { SELECTORS as CLAUDE } from '../../src/content/extractors/selectors/claude';
import { SELECTORS as CHATGPT } from '../../src/content/extractors/selectors/chatgpt';
import { SELECTORS as PERPLEXITY } from '../../src/content/extractors/selectors/perplexity';
import { SELECTORS as DEEPSEEK } from '../../src/content/extractors/selectors/deepseek';
import { SELECTORS as NOTEBOOKLM } from '../../src/content/extractors/selectors/notebooklm';
import { PLATFORM_REGISTRY } from '../../src/lib/platform-registry';

describe('CONVERSATION_READY_SELECTORS', () => {
  it('has exactly one entry per registered logical platform, including DeepSeek', () => {
    expect(Object.keys(CONVERSATION_READY_SELECTORS).sort()).toEqual(
      Object.keys(PLATFORM_REGISTRY).sort()
    );
    expect(Object.keys(CONVERSATION_READY_SELECTORS)).toHaveLength(6);
  });

  it('uses the primary selector of each extractor group, not a loose fallback', () => {
    expect(CONVERSATION_READY_SELECTORS.gemini).toBe(GEMINI.conversationTurn[0]);
    expect(CONVERSATION_READY_SELECTORS.claude).toBe(CLAUDE.conversationRow[0]);
    expect(CONVERSATION_READY_SELECTORS.chatgpt).toBe(CHATGPT.conversationTurn[0]);
    expect(CONVERSATION_READY_SELECTORS.perplexity).toBe(PERPLEXITY.userQuery[0]);
    expect(CONVERSATION_READY_SELECTORS.deepseek).toBe(DEEPSEEK.message[0]);
    expect(CONVERSATION_READY_SELECTORS.notebooklm).toBe(NOTEBOOKLM.conversationTurn[0]);
  });

  it('joins exactly the nonempty primary selectors into the container hint', () => {
    const selectors = Object.values(CONVERSATION_READY_SELECTORS);
    expect(selectors.every(selector => selector.trim().length > 0)).toBe(true);
    expect(CONVERSATION_CONTAINER_SELECTOR).toBe(selectors.join(', '));
  });

  it('does not carry broad conversation classes or dead platform variants', () => {
    const selectors = CONVERSATION_CONTAINER_SELECTOR.split(', ');
    expect(selectors).not.toContain('.conversation');
    expect(selectors).not.toContain('[class*="conversation"]');
    expect(CONVERSATION_CONTAINER_SELECTOR).not.toContain('article[data-turn-id]');
    expect(CONVERSATION_CONTAINER_SELECTOR).not.toContain('threadContentWidth');
  });

  it('is a valid CSS selector list', () => {
    expect(() => document.querySelector(CONVERSATION_CONTAINER_SELECTOR)).not.toThrow();
  });
});
