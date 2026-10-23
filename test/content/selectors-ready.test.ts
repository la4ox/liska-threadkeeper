import { describe, it, expect } from 'vitest';
import { CONVERSATION_READY_SELECTORS } from '../../src/content/extractors/selectors/ready';
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
