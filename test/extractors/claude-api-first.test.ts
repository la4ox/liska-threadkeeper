import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeExtractor } from '../../src/content/extractors/claude';
import * as claudeApi from '../../src/content/extractors/claude-api';
import { BaseExtractor } from '../../src/content/extractors/base';
import type {
  ArchiveCompanionBundle,
  ConversationData,
  ExtractionResult,
} from '../../src/lib/types';
import {
  clearFixture,
  createClaudeConversationDOM,
  createClaudeDeepResearchDOM,
  loadFixture,
  resetLocation,
  setClaudeLocation,
} from '../fixtures/dom-helpers';

const CONVERSATION_ID = '12345678-1234-4abc-8def-1234567890ab';

function companion(): ArchiveCompanionBundle {
  return {
    captureId: 'capture-claude-synthetic-extractor',
    conversationKey: 'a'.repeat(64),
    capturedAt: '2026-10-31T08:00:00.000Z',
    artifacts: [
      {
        transport: 'inline',
        kind: 'raw',
        relativePath: 'responses/conversation.json',
        mediaType: 'application/json',
        byteLength: 2,
        sha256: 'b'.repeat(64),
        bodyBase64: 'e30=',
      },
      {
        transport: 'inline',
        kind: 'manifest',
        relativePath: 'manifest.json',
        mediaType: 'application/json',
        byteLength: 2,
        sha256: 'c'.repeat(64),
        bodyBase64: 'e30=',
      },
      {
        transport: 'inline',
        kind: 'canonical',
        relativePath: 'canonical/liska-thread-1.json',
        mediaType: 'application/json',
        byteLength: 2,
        sha256: 'd'.repeat(64),
        bodyBase64: 'e30=',
      },
    ],
  };
}

function stagedCompanion(): ArchiveCompanionBundle {
  return {
    captureId: 'capture-claude-staged-navigation',
    conversationKey: 'e'.repeat(64),
    capturedAt: '2026-10-31T08:00:00.000Z',
    artifacts: [
      {
        transport: 'staged',
        kind: 'raw',
        stageId: `archive-stage-${'A'.repeat(32)}`,
        relativePath: 'responses/conversation.json',
        mediaType: 'application/json',
        byteLength: 20 * 1024 * 1024,
        sha256: 'f'.repeat(64),
      },
      {
        transport: 'inline',
        kind: 'manifest',
        relativePath: 'manifest.json',
        mediaType: 'application/json',
        byteLength: 2,
        sha256: '1'.repeat(64),
        bodyBase64: 'e30=',
      },
    ],
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function apiData(title = 'Structured Claude title'): ConversationData {
  return {
    id: CONVERSATION_ID,
    title,
    url: `https://claude.ai/chat/${CONVERSATION_ID}`,
    source: 'claude',
    messages: [
      { id: 'api-user', role: 'user', content: 'API question', index: 0 },
      {
        id: 'api-assistant',
        role: 'assistant',
        content: 'API answer',
        contentFormat: 'markdown',
        index: 1,
      },
    ],
    extractedAt: new Date('2026-10-31T08:00:00.000Z'),
    metadata: {
      messageCount: 2,
      userMessageCount: 1,
      assistantMessageCount: 1,
      hasCodeBlocks: false,
    },
    capture: { mode: 'structured-api', completeness: 'partial' },
  };
}

function apiResult(title?: string): Awaited<ReturnType<typeof claudeApi.fetchClaudeConversation>> {
  return {
    data: apiData(title),
    archive: {} as never,
    archiveCompanion: companion(),
    warnings: [claudeApi.CLAUDE_SCOPE_UNVERIFIED_WARNING],
  };
}

function renderConversation(): void {
  setClaudeLocation(CONVERSATION_ID);
  loadFixture(
    createClaudeConversationDOM([
      { role: 'user', content: 'DOM question' },
      { role: 'assistant', content: '<p>DOM answer</p>' },
    ])
  );
}

describe('Claude structured detail preference', () => {
  let extractor: ClaudeExtractor;

  beforeEach(() => {
    extractor = new ClaudeExtractor();
    clearFixture();
    localStorage.clear();
    vi.mocked(chrome.runtime.sendMessage).mockReset();
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((_message, callback) => {
      if (typeof callback === 'function') callback({ success: true });
      return Promise.resolve({ success: true });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearFixture();
    localStorage.clear();
    resetLocation();
  });

  it('uses structured detail without reading the rendered transcript', async () => {
    renderConversation();
    const fetchDetail = vi
      .spyOn(claudeApi, 'fetchClaudeConversation')
      .mockResolvedValue(apiResult());

    const result = await extractor.extract();

    expect(fetchDetail).toHaveBeenCalledWith(CONVERSATION_ID, false);
    expect(result.success).toBe(true);
    expect(result.data?.messages.map(message => message.content)).toEqual([
      'API question',
      'API answer',
    ]);
    expect(result.data?.capture).toEqual({ mode: 'structured-api', completeness: 'partial' });
    expect(result.archiveCompanion).toEqual(companion());
    expect(result.structuredPresentationContext).toBeUndefined();
  });

  it('uses the page title only when the structured title is blank', async () => {
    renderConversation();
    document.title = 'Rendered title - Claude';
    vi.spyOn(claudeApi, 'fetchClaudeConversation').mockResolvedValue(apiResult('  '));

    expect((await extractor.extract()).data?.title).toBe('Rendered title');
  });

  it('keeps the established DOM path when no organization capability is available', async () => {
    renderConversation();
    vi.spyOn(claudeApi, 'fetchClaudeConversation').mockResolvedValue(null);

    const result = await extractor.extract();

    expect(result.data?.messages.map(message => message.content).join('\n')).toContain(
      'DOM answer'
    );
    expect(result.data?.capture).toBeUndefined();
    expect(result.warnings ?? []).not.toContain(claudeApi.CLAUDE_DOM_FALLBACK_WARNING);
  });

  it('marks a failed structured attempt as partial rendered fallback', async () => {
    renderConversation();
    vi.spyOn(claudeApi, 'fetchClaudeConversation').mockRejectedValue(
      new claudeApi.ClaudeStructuredCaptureError('request-failed')
    );

    const result = await extractor.extract();

    expect(result.success).toBe(true);
    expect(result.data?.capture).toEqual({ mode: 'dom-fallback', completeness: 'partial' });
    expect(result.warnings).toContain(claudeApi.CLAUDE_DOM_FALLBACK_WARNING);
    expect(result.archiveCompanion).toBeUndefined();
  });

  it('retains verified raw and manifest evidence after post-capture failure', async () => {
    renderConversation();
    const retained = companion();
    vi.spyOn(claudeApi, 'fetchClaudeConversation').mockRejectedValue(
      new claudeApi.ClaudeStructuredCaptureError('normalization-failed', retained)
    );

    const result = await extractor.extract();

    expect(result.data?.capture).toEqual({ mode: 'dom-fallback', completeness: 'partial' });
    expect(result.archiveCompanion).toBe(retained);
    expect(result.warnings).toContain(claudeApi.CLAUDE_STRUCTURED_EVIDENCE_FALLBACK_WARNING);
    expect(result.warnings).not.toContain(claudeApi.CLAUDE_DOM_FALLBACK_WARNING);
  });

  it('retains raw evidence even when both structured and rendered extraction fail', async () => {
    setClaudeLocation(CONVERSATION_ID);
    loadFixture('<main></main>');
    const retained = companion();
    vi.spyOn(claudeApi, 'fetchClaudeConversation').mockRejectedValue(
      new claudeApi.ClaudeStructuredCaptureError('normalization-failed', retained)
    );

    const result: ExtractionResult = await extractor.extract();

    expect(result.success).toBe(false);
    expect(result.archiveCompanion).toBe(retained);
  });

  it('cancels a successful structured result when SPA navigation changes the conversation', async () => {
    renderConversation();
    const pending = deferred<Awaited<ReturnType<typeof claudeApi.fetchClaudeConversation>>>();
    vi.spyOn(claudeApi, 'fetchClaudeConversation').mockReturnValue(pending.promise);

    const extraction = extractor.extract();
    setClaudeLocation('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    pending.resolve(apiResult());

    await expect(extraction).resolves.toEqual({
      success: false,
      error: 'Conversation changed during extraction. No output was created.',
    });
  });

  it('cancels fallback after navigation and releases a staged raw companion', async () => {
    renderConversation();
    const pending = deferred<Awaited<ReturnType<typeof claudeApi.fetchClaudeConversation>>>();
    vi.spyOn(claudeApi, 'fetchClaudeConversation').mockReturnValue(pending.promise);
    const retained = stagedCompanion();

    const extraction = extractor.extract();
    setClaudeLocation('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    pending.reject(new claudeApi.ClaudeStructuredCaptureError('normalization-failed', retained));

    await expect(extraction).resolves.toEqual({
      success: false,
      error: 'Conversation changed during extraction. No output was created.',
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        action: 'abortStagedArchiveArtifact',
        source: 'claude',
        stageId: retained.artifacts[0].transport === 'staged' ? retained.artifacts[0].stageId : '',
      },
      expect.any(Function)
    );
  });

  it('does not reattach A evidence when navigation happens during DOM fallback', async () => {
    renderConversation();
    const retained = stagedCompanion();
    vi.spyOn(claudeApi, 'fetchClaudeConversation').mockRejectedValue(
      new claudeApi.ClaudeStructuredCaptureError('normalization-failed', retained)
    );
    const fallback = deferred<ExtractionResult>();
    const domExtract = vi
      .spyOn(BaseExtractor.prototype, 'extract')
      .mockReturnValue(fallback.promise);

    const extraction = extractor.extract();
    await vi.waitFor(() => expect(domExtract).toHaveBeenCalledOnce());
    setClaudeLocation('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    fallback.resolve({
      success: false,
      error: 'Conversation changed during extraction. No output was created.',
    });

    await expect(extraction).resolves.toEqual({
      success: false,
      error: 'Conversation changed during extraction. No output was created.',
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        action: 'abortStagedArchiveArtifact',
        source: 'claude',
        stageId: retained.artifacts[0].transport === 'staged' ? retained.artifacts[0].stageId : '',
      },
      expect.any(Function)
    );
  });

  it('cancels a successful legacy-report fallback when its original chat changes', async () => {
    renderConversation();
    const retained = stagedCompanion();
    vi.spyOn(claudeApi, 'fetchClaudeConversation').mockRejectedValue(
      new claudeApi.ClaudeStructuredCaptureError('normalization-failed', retained)
    );
    const fallback = deferred<ExtractionResult>();
    const domExtract = vi
      .spyOn(BaseExtractor.prototype, 'extract')
      .mockReturnValue(fallback.promise);

    const extraction = extractor.extract();
    await vi.waitFor(() => expect(domExtract).toHaveBeenCalledOnce());
    setClaudeLocation('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    fallback.resolve({ success: true, data: apiData('Synthetic fallback report') });

    await expect(extraction).resolves.toEqual({
      success: false,
      error: 'Conversation changed during extraction. No output was created.',
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        action: 'abortStagedArchiveArtifact',
        source: 'claude',
        stageId: retained.artifacts[0].transport === 'staged' ? retained.artifacts[0].stageId : '',
      },
      expect.any(Function)
    );
  });

  it('keeps the visible legacy Deep Research export ahead of structured detail', async () => {
    setClaudeLocation(CONVERSATION_ID);
    loadFixture(createClaudeDeepResearchDOM('Legacy report', '<p>Legacy body</p>'));
    const fetchDetail = vi.spyOn(claudeApi, 'fetchClaudeConversation');

    const result = await extractor.extract();

    expect(fetchDetail).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data?.type).toBe('deep-research');
    expect(result.data?.messages[0]?.content).toContain('Legacy body');
  });
});
