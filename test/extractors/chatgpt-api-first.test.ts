import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHATGPT_RENDERED_BRANCH_FALLBACK_WARNING,
  ChatGPTExtractor,
} from '../../src/content/extractors/chatgpt';
import { ChatGptCurrentBranchError } from '../../src/content/capture/chatgpt-current-branch';
import type { ArchiveProjectionResult } from '../../src/content/archive-projection';
import type { ArchiveCompanionBundle } from '../../src/lib/types';
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

function setUnsupportedChatGptPath(pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: {
      hostname: 'chatgpt.com',
      pathname,
      href: `https://chatgpt.com${pathname}`,
      origin: 'https://chatgpt.com',
      protocol: 'https:',
      host: 'chatgpt.com',
      search: '',
      hash: '',
    },
    writable: true,
    configurable: true,
  });
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
    expect(result.data?.capture).toEqual({ mode: 'structured-api', completeness: 'complete' });
  });

  it('carries the complete archive companion only after a structured capture', async () => {
    renderedConversation();
    const structured = projection();
    structured.archiveCompanion = {
      captureId: 'capture-chatgpt-11111111-2222-4333-8444-555555555555',
      conversationKey: 'a'.repeat(64),
      artifacts: [
        {
          kind: 'raw',
          relativePath: 'responses/conversation.json',
          mediaType: 'application/json',
          byteLength: 2,
          sha256: 'b'.repeat(64),
          bodyBase64: 'e30=',
        },
        {
          kind: 'manifest',
          relativePath: 'manifest.json',
          mediaType: 'application/json',
          byteLength: 2,
          sha256: 'c'.repeat(64),
          bodyBase64: 'e30=',
        },
        {
          kind: 'canonical',
          relativePath: 'canonical/liska-thread-1.json',
          mediaType: 'application/json',
          byteLength: 2,
          sha256: 'd'.repeat(64),
          bodyBase64: 'e30=',
        },
      ],
    };
    const extractor = new ChatGPTExtractor({
      captureCurrentBranch: vi.fn().mockResolvedValue(structured),
      manifestAllowsStructuredCapture: () => true,
    });

    const result = await extractor.extract();

    expect(result.archiveCompanion?.artifacts).toHaveLength(3);
    expect(result.data?.capture).toEqual({ mode: 'structured-api', completeness: 'complete' });
  });

  it('falls back to the rendered current branch and adds one stable warning after a capture error', async () => {
    renderedConversation();
    const captureCurrentBranch = vi
      .fn()
      .mockRejectedValue(new ChatGptCurrentBranchError('timed-out'));
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
    expect(result.warnings?.[0]).toBe(
      `${CHATGPT_RENDERED_BRANCH_FALLBACK_WARNING} (timed-out); partial rendered current branch exported; raw/canonical archive was not saved.`
    );
    expect(result.warnings?.join(' ')).not.toContain('provider diagnostic');
    expect(result.data?.capture).toEqual({ mode: 'dom-fallback', completeness: 'partial' });
  });

  it('carries raw and manifest through a normalization fallback', async () => {
    renderedConversation();
    const partialCompanion: ArchiveCompanionBundle = {
      captureId: 'capture-chatgpt-11111111-2222-4333-8444-555555555555',
      conversationKey: 'a'.repeat(64),
      artifacts: [
        {
          kind: 'raw',
          relativePath: 'responses/conversation.json',
          mediaType: 'application/json',
          byteLength: 2,
          sha256: 'b'.repeat(64),
          bodyBase64: 'e30=',
        },
        {
          kind: 'manifest',
          relativePath: 'manifest.json',
          mediaType: 'application/json',
          byteLength: 2,
          sha256: 'c'.repeat(64),
          bodyBase64: 'e30=',
        },
      ],
    };
    const captureCurrentBranch = vi.fn().mockRejectedValue(
      new ChatGptCurrentBranchError('normalization-failed', {
        archiveCompanion: partialCompanion,
        detailCode: 'missing-graph',
      })
    );
    const extractor = new ChatGPTExtractor({
      captureCurrentBranch,
      manifestAllowsStructuredCapture: () => true,
    });

    const result = await extractor.extract();

    expect(result.success).toBe(true);
    expect(result.archiveCompanion).toBe(partialCompanion);
    expect(result.archiveCompanion?.artifacts.map(artifact => artifact.kind)).toEqual([
      'raw',
      'manifest',
    ]);
    expect(result.warnings).toContain(
      `${CHATGPT_RENDERED_BRANCH_FALLBACK_WARNING} (normalization-failed:missing-graph); partial rendered current branch exported; raw capture and manifest were preserved for local saving; canonical archive was not created.`
    );
  });

  it('keeps raw and manifest when the rendered fallback has no usable messages', async () => {
    setChatGPTLocation(CONVERSATION_ID);
    loadFixture('<main></main>');
    const partialCompanion: ArchiveCompanionBundle = {
      captureId: 'capture-chatgpt-11111111-2222-4333-8444-555555555555',
      conversationKey: 'a'.repeat(64),
      artifacts: [
        {
          kind: 'raw',
          relativePath: 'responses/conversation.json',
          mediaType: 'application/json',
          byteLength: 2,
          sha256: 'b'.repeat(64),
          bodyBase64: 'e30=',
        },
        {
          kind: 'manifest',
          relativePath: 'manifest.json',
          mediaType: 'application/json',
          byteLength: 2,
          sha256: 'c'.repeat(64),
          bodyBase64: 'e30=',
        },
      ],
    };
    const extractor = new ChatGPTExtractor({
      captureCurrentBranch: vi.fn().mockRejectedValue(
        new ChatGptCurrentBranchError('normalization-failed', {
          archiveCompanion: partialCompanion,
          detailCode: 'missing-graph',
        })
      ),
      manifestAllowsStructuredCapture: () => true,
    });

    const result = await extractor.extract();

    expect(result.success).toBe(false);
    expect(result.archiveCompanion).toBe(partialCompanion);
    expect(result.warnings).toContain(
      `${CHATGPT_RENDERED_BRANCH_FALLBACK_WARNING} (normalization-failed:missing-graph); partial rendered current branch exported; raw capture and manifest were preserved for local saving; canonical archive was not created.`
    );
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

  it('uses an explicit partial fallback when a valid route lacks structured permission', async () => {
    renderedConversation();
    const captureCurrentBranch = vi.fn().mockResolvedValue(projection());
    const extractor = new ChatGPTExtractor({
      captureCurrentBranch,
      manifestAllowsStructuredCapture: () => false,
    });

    const result = await extractor.extract();

    expect(captureCurrentBranch).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data?.capture).toEqual({ mode: 'dom-fallback', completeness: 'partial' });
    expect(result.archiveCompanion).toBeUndefined();
    expect(result.warnings).toEqual([
      `${CHATGPT_RENDERED_BRANCH_FALLBACK_WARNING} (permission-unavailable); partial rendered current branch exported; raw/canonical archive was not saved.`,
    ]);
  });

  it('marks a malformed supported ChatGPT route as a partial DOM fallback', async () => {
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
    expect(result.data?.capture).toEqual({ mode: 'dom-fallback', completeness: 'partial' });
    expect(result.archiveCompanion).toBeUndefined();
    expect(result.warnings).toEqual([
      `${CHATGPT_RENDERED_BRANCH_FALLBACK_WARNING} (invalid-conversation-id); partial rendered current branch exported; raw/canonical archive was not saved.`,
    ]);
  });

  it('treats the custom-GPT conversation route shape the same way when its UUID is malformed', async () => {
    createChatGPTPage(
      'not-a-uuid',
      [
        { role: 'user', content: 'Rendered question' },
        { role: 'assistant', content: '<p>Rendered answer</p>' },
      ],
      'g'
    );
    const captureCurrentBranch = vi.fn().mockResolvedValue(projection());
    const extractor = new ChatGPTExtractor({
      captureCurrentBranch,
      manifestAllowsStructuredCapture: () => true,
    });

    const result = await extractor.extract();

    expect(captureCurrentBranch).not.toHaveBeenCalled();
    expect(result.data?.capture).toEqual({ mode: 'dom-fallback', completeness: 'partial' });
    expect(result.warnings?.[0]).toContain('(invalid-conversation-id)');
  });

  it('keeps unrelated ChatGPT paths on the ordinary DOM route', async () => {
    renderedConversation();
    setUnsupportedChatGptPath('/share/not-a-conversation');
    const captureCurrentBranch = vi.fn().mockResolvedValue(projection());
    const extractor = new ChatGPTExtractor({
      captureCurrentBranch,
      manifestAllowsStructuredCapture: () => true,
    });

    const result = await extractor.extract();

    expect(captureCurrentBranch).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data?.capture).toBeUndefined();
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
