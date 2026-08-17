import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHATGPT_RENDERED_BRANCH_FALLBACK_WARNING,
  ChatGPTExtractor,
} from '../../src/content/extractors/chatgpt';
import type { ArchiveProjectionResult } from '../../src/content/archive-projection';
import {
  clearFixture,
  createChatGPTPage,
  loadFixture,
  resetLocation,
  setChatGPTLocation,
} from '../fixtures/dom-helpers';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';

function projection(toolContent?: string): ArchiveProjectionResult {
  return {
    data: {
      id: CONVERSATION_ID,
      title: 'API-first title',
      url: `https://chatgpt.com/c/${CONVERSATION_ID}`,
      source: 'chatgpt',
      messages: [
        { id: 'user', role: 'user', content: 'API question', index: 0 },
        {
          id: 'assistant',
          role: 'assistant',
          content: 'API answer',
          contentFormat: 'markdown',
          ...(toolContent ? { toolContent } : {}),
          index: 1,
        },
      ],
      extractedAt: new Date('2026-08-17T12:00:00.000Z'),
      metadata: {
        messageCount: 2,
        userMessageCount: 1,
        assistantMessageCount: 1,
        hasCodeBlocks: false,
      },
    },
    selectedNodeIds: ['root', 'current'],
    warnings: ['A canonical projection warning.'],
  };
}

function renderedConversation(): void {
  createChatGPTPage(CONVERSATION_ID, [
    { role: 'user', content: 'Rendered question' },
    { role: 'assistant', content: '<p>Rendered answer</p>' },
  ]);
}

describe('ChatGPTExtractor API-first bridge', () => {
  beforeEach(() => {
    clearFixture();
  });

  afterEach(() => {
    clearFixture();
    resetLocation();
  });

  it('returns the verified projection and skips rendered-DOM extraction', async () => {
    renderedConversation();
    const captureCurrentBranch = vi
      .fn()
      .mockResolvedValue(projection('**Reasoning**\nAPI tool data'));
    const extractor = new ChatGPTExtractor({
      captureCurrentBranch,
      manifestAllowsStructuredCapture: () => true,
    });
    extractor.extractMessages = vi.fn(() => {
      throw new Error('DOM extraction must not run after a verified projection');
    });
    extractor.applySettings({ enableToolContent: true } as never);

    const result = await extractor.extract();

    expect(captureCurrentBranch).toHaveBeenCalledWith(CONVERSATION_ID, true);
    expect(result.success).toBe(true);
    expect(result.data?.messages[1]?.content).toBe('API answer');
    expect(result.data?.messages[1]?.toolContent).toContain('API tool data');
    expect(result.warnings).toEqual(['A canonical projection warning.']);
  });

  it('falls back to the rendered current branch and adds one stable warning after a capture error', async () => {
    renderedConversation();
    const captureCurrentBranch = vi.fn().mockRejectedValue(new Error('raw provider diagnostic'));
    const extractor = new ChatGPTExtractor({
      captureCurrentBranch,
      manifestAllowsStructuredCapture: () => true,
    });

    const result = await extractor.extract();

    expect(captureCurrentBranch).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.data?.messages.map(message => message.content).join('\n')).toContain(
      'Rendered answer'
    );
    expect(result.warnings).toContain(CHATGPT_RENDERED_BRANCH_FALLBACK_WARNING);
    expect(result.warnings?.join(' ')).not.toContain('raw provider diagnostic');
  });

  it('refuses a user-only canonical projection when a Deep Research iframe is detected', async () => {
    setChatGPTLocation(CONVERSATION_ID);
    loadFixture(
      '<iframe title="internal://deep-research" src="https://example.invalid/deep-research"></iframe>'
    );
    const userOnlyProjection = projection();
    userOnlyProjection.data.messages = [userOnlyProjection.data.messages[0]];
    const captureCurrentBranch = vi.fn().mockResolvedValue(userOnlyProjection);
    const extractor = new ChatGPTExtractor({
      captureCurrentBranch,
      manifestAllowsStructuredCapture: () => true,
    });

    const result = await extractor.extract();

    expect(captureCurrentBranch).toHaveBeenCalledOnce();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/deep research/i);
    expect(result.data).toBeUndefined();
  });

  it('does not request a structured capture when permission is absent', async () => {
    renderedConversation();
    const captureCurrentBranch = vi.fn().mockResolvedValue(projection());
    const extractor = new ChatGPTExtractor({
      captureCurrentBranch,
      manifestAllowsStructuredCapture: () => false,
    });

    const result = await extractor.extract();

    expect(captureCurrentBranch).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.warnings ?? []).not.toContain(CHATGPT_RENDERED_BRANCH_FALLBACK_WARNING);
  });

  it('does not request a structured capture on a non-UUID ChatGPT route', async () => {
    setChatGPTLocation('not-a-uuid');
    createChatGPTPage('not-a-uuid', [
      { role: 'user', content: 'Rendered question' },
      { role: 'assistant', content: '<p>Rendered answer</p>' },
    ]);
    const captureCurrentBranch = vi.fn().mockResolvedValue(projection());
    const extractor = new ChatGPTExtractor({
      captureCurrentBranch,
      manifestAllowsStructuredCapture: () => true,
    });

    const result = await extractor.extract();

    expect(captureCurrentBranch).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.warnings ?? []).not.toContain(CHATGPT_RENDERED_BRANCH_FALLBACK_WARNING);
  });

  it('passes the settings-controlled tool-content flag to the capture composition', async () => {
    renderedConversation();
    const captureCurrentBranch = vi.fn().mockResolvedValue(projection());
    const extractor = new ChatGPTExtractor({
      captureCurrentBranch,
      manifestAllowsStructuredCapture: () => true,
    });
    extractor.applySettings({ enableToolContent: false } as never);

    await extractor.extract();

    expect(captureCurrentBranch).toHaveBeenCalledWith(CONVERSATION_ID, false);
  });
});
