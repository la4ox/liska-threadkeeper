import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHATGPT_RENDERED_BRANCH_FALLBACK_WARNING,
  ChatGPTExtractor,
} from '../../src/content/extractors/chatgpt';
import {
  ChatGptCurrentBranchError,
  type ChatGptArchiveCapture,
} from '../../src/content/capture/chatgpt-current-branch';
import type { ArchiveProjectionResult } from '../../src/content/archive-projection';
import type { ArchiveCompanionBundle } from '../../src/lib/types';
import type { LiskaThreadArchive } from '../../src/archive';
import branchingFixture from '../fixtures/archive/branching-chatgpt-thread.json';
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

function completeCompanion(): ArchiveCompanionBundle {
  return {
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
}

function branchCapture(): ChatGptArchiveCapture {
  const archive = JSON.parse(JSON.stringify(branchingFixture)) as LiskaThreadArchive;
  archive.conversation.id = CONVERSATION_ID;
  archive.conversation.url = `https://chatgpt.com/c/${CONVERSATION_ID}`;
  return { archive, archiveCompanion: completeCompanion() };
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

  it('runs only the metadata probe when the experimental setting is enabled', async () => {
    renderedConversation();
    const captureCurrentBranch = vi.fn();
    const captureArchive = vi.fn();
    const requestOpaqueProbe = vi.fn().mockResolvedValue({
      success: false,
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
    const extractor = new ChatGPTExtractor({
      captureCurrentBranch,
      captureArchive,
      requestOpaqueProbe,
      manifestAllowsStructuredCapture: () => true,
    });
    extractor.extractMessages = vi.fn(() => {
      throw new Error('DOM extraction must not run for the opaque probe');
    });
    extractor.applySettings({ enableChatGptOpaqueProbe: true } as never);

    const result = await extractor.extract();

    expect(requestOpaqueProbe).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(captureCurrentBranch).not.toHaveBeenCalled();
    expect(captureArchive).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: 'ChatGPT experimental metadata-only probe: eligible. No conversation was exported.',
    });
  });

  it('uses only the explicit replay current-branch route when replay is enabled', async () => {
    renderedConversation();
    const captureCurrentBranch = vi.fn();
    const captureReplayCurrentBranch = vi.fn().mockResolvedValue(projection());
    const requestOpaqueProbe = vi.fn();
    const extractor = new ChatGPTExtractor({
      captureCurrentBranch,
      captureReplayCurrentBranch,
      requestOpaqueProbe,
      manifestAllowsStructuredCapture: () => true,
    });
    extractor.extractMessages = vi.fn(() => {
      throw new Error('explicit replay must not enter DOM fallback');
    });
    extractor.applySettings({ enableChatGptOpaqueReplay: true } as never);

    const result = await extractor.extract();

    expect(captureReplayCurrentBranch).toHaveBeenCalledWith(CONVERSATION_ID, false);
    expect(captureCurrentBranch).not.toHaveBeenCalled();
    expect(requestOpaqueProbe).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data?.capture).toEqual({ mode: 'structured-api', completeness: 'complete' });
  });

  it('keeps the zero-dispatch metadata probe ahead of replay when stale settings enable both', async () => {
    renderedConversation();
    const requestOpaqueProbe = vi.fn().mockResolvedValue({
      success: false,
      data: {
        observedTargetRequest: true,
        sourceIsNativeRequest: true,
        initAbsent: false,
        exactTarget: true,
        authorizationPresent: true,
        credentialsAccepted: true,
        sourceStatus: 200,
        sourceJson: true,
        singularDispatchCount: 0,
        outcome: 'eligible-init-empty',
      },
    });
    const captureReplayCurrentBranch = vi.fn();
    const extractor = new ChatGPTExtractor({
      requestOpaqueProbe,
      captureReplayCurrentBranch,
      manifestAllowsStructuredCapture: () => true,
    });
    extractor.applySettings({
      enableChatGptOpaqueProbe: true,
      enableChatGptOpaqueReplay: true,
    } as never);

    const result = await extractor.extract();

    expect(requestOpaqueProbe).toHaveBeenCalledOnce();
    expect(captureReplayCurrentBranch).not.toHaveBeenCalled();
    expect(result.error).toContain('eligible-init-empty');
  });

  it('fails explicit replay closed without rendered fallback and retains available evidence', async () => {
    renderedConversation();
    const partialCompanion = completeCompanion();
    partialCompanion.artifacts = partialCompanion.artifacts.filter(
      artifact => artifact.kind !== 'canonical'
    );
    const captureReplayCurrentBranch = vi.fn().mockRejectedValue(
      new ChatGptCurrentBranchError('normalization-failed', {
        archiveCompanion: partialCompanion,
        detailCode: 'opaque-replay-missing-graph',
      })
    );
    const extractor = new ChatGPTExtractor({
      captureReplayCurrentBranch,
      manifestAllowsStructuredCapture: () => true,
    });
    extractor.extractMessages = vi.fn(() => {
      throw new Error('explicit replay failure must not enter DOM fallback');
    });
    extractor.applySettings({ enableChatGptOpaqueReplay: true } as never);

    const result = await extractor.extract();

    expect(result).toMatchObject({
      success: false,
      error:
        'ChatGPT experimental A-strict replay failed (normalization-failed:opaque-replay-missing-graph); no fallback export was created.',
      archiveCompanion: partialCompanion,
    });
    expect(result.data).toBeUndefined();
  });

  it('uses the replay archive once for explicit selected-branch mode', async () => {
    renderedConversation();
    const captureReplayArchive = vi.fn().mockResolvedValue(branchCapture());
    const captureArchive = vi.fn();
    const extractor = new ChatGPTExtractor({
      captureArchive,
      captureReplayArchive,
      selectBranch: vi.fn().mockResolvedValue(2),
      manifestAllowsStructuredCapture: () => true,
    });
    extractor.setBranchExportMode('selected');
    extractor.applySettings({ enableChatGptOpaqueReplay: true } as never);

    const result = await extractor.extract();

    expect(captureReplayArchive).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(captureArchive).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data?.presentation).toMatchObject({ mode: 'selected-branch', branchOrdinal: 2 });
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

  it('captures once, asks locally, and projects one explicitly selected leaf', async () => {
    renderedConversation();
    const captureCurrentBranch = vi.fn();
    const captureArchive = vi.fn().mockResolvedValue(branchCapture());
    const selectBranch = vi.fn().mockResolvedValue(2);
    const extractor = new ChatGPTExtractor({
      captureCurrentBranch,
      captureArchive,
      selectBranch,
      manifestAllowsStructuredCapture: () => true,
    });
    extractor.setBranchExportMode('selected');

    const result = await extractor.extract();

    expect(captureArchive).toHaveBeenCalledOnce();
    expect(captureCurrentBranch).not.toHaveBeenCalled();
    expect(selectBranch).toHaveBeenCalledWith([
      expect.objectContaining({ ordinal: 1, isCurrent: true }),
      expect.objectContaining({ ordinal: 2, isCurrent: false }),
    ]);
    expect(result.success).toBe(true);
    const messages = result.data?.messages ?? [];
    expect(messages[messages.length - 1]?.content).toContain('Alternate **answer**');
    expect(result.data?.presentation).toEqual({
      mode: 'selected-branch',
      captureId: 'capture-chatgpt-11111111-2222-4333-8444-555555555555',
      branchOrdinal: 2,
      branchCount: 2,
      branchPointCount: 1,
    });
    expect(result.archiveCompanion?.artifacts).toHaveLength(3);
  });

  it('returns one complete graph plan when the local picker chooses all branches', async () => {
    renderedConversation();
    const capture = branchCapture();
    const captureArchive = vi.fn().mockResolvedValue(capture);
    const extractor = new ChatGPTExtractor({
      captureArchive,
      selectBranch: vi.fn().mockResolvedValue('all'),
      manifestAllowsStructuredCapture: () => true,
    });
    extractor.setBranchExportMode('selected');

    const result = await extractor.extract();

    expect(captureArchive).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      success: true,
      archiveCompanion: capture.archiveCompanion,
      allBranches: {
        archive: capture.archive,
        catalog: { branchPointCount: 1 },
      },
    });
    expect(result.data).toBeUndefined();
    expect(result.allBranches?.catalog.branches).toHaveLength(2);
  });

  it('cancels a branch choice without saving evidence or falling back to rendered DOM', async () => {
    renderedConversation();
    const extractor = new ChatGPTExtractor({
      captureArchive: vi.fn().mockResolvedValue(branchCapture()),
      selectBranch: vi.fn().mockResolvedValue(null),
      manifestAllowsStructuredCapture: () => true,
    });
    extractor.setBranchExportMode('selected');
    extractor.extractMessages = vi.fn(() => {
      throw new Error('cancel must not trigger rendered fallback');
    });

    const result = await extractor.extract();

    expect(result).toEqual({ success: false, cancelled: true });
  });

  it('fails closed in selected mode when complete capture fails', async () => {
    renderedConversation();
    const partialCompanion = completeCompanion();
    partialCompanion.artifacts = partialCompanion.artifacts.filter(
      artifact => artifact.kind !== 'canonical'
    );
    const extractor = new ChatGPTExtractor({
      captureArchive: vi.fn().mockRejectedValue(
        new ChatGptCurrentBranchError('normalization-failed', {
          archiveCompanion: partialCompanion,
          detailCode: 'missing-graph',
        })
      ),
      manifestAllowsStructuredCapture: () => true,
    });
    extractor.setBranchExportMode('selected');
    extractor.extractMessages = vi.fn(() => {
      throw new Error('selected capture failure must not trigger rendered fallback');
    });

    const result = await extractor.extract();

    expect(result).toMatchObject({
      success: false,
      error:
        'ChatGPT complete graph is unavailable for branch selection (normalization-failed:missing-graph).',
      archiveCompanion: partialCompanion,
    });
    expect(result.data).toBeUndefined();
  });

  it('fails closed in selected mode when structured permission is unavailable', async () => {
    renderedConversation();
    const captureArchive = vi.fn();
    const extractor = new ChatGPTExtractor({
      captureArchive,
      manifestAllowsStructuredCapture: () => false,
    });
    extractor.setBranchExportMode('selected');
    extractor.extractMessages = vi.fn(() => {
      throw new Error('permission failure must not trigger rendered fallback');
    });

    const result = await extractor.extract();

    expect(captureArchive).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: 'ChatGPT complete graph is unavailable for branch selection (permission-unavailable).',
    });
  });

  it('fails closed in selected mode on an unsupported ChatGPT route', async () => {
    renderedConversation();
    setUnsupportedChatGptPath('/share/not-a-conversation');
    const extractor = new ChatGPTExtractor({ manifestAllowsStructuredCapture: () => true });
    extractor.setBranchExportMode('selected');
    extractor.extractMessages = vi.fn(() => {
      throw new Error('unsupported route must not trigger rendered fallback');
    });

    const result = await extractor.extract();

    expect(result).toEqual({
      success: false,
      error: 'ChatGPT complete graph is unavailable for branch selection (route-unavailable).',
    });
  });

  it('refuses an invalid local branch ordinal without exporting the rendered current branch', async () => {
    renderedConversation();
    const capture = branchCapture();
    const extractor = new ChatGPTExtractor({
      captureArchive: vi.fn().mockResolvedValue(capture),
      selectBranch: vi.fn().mockResolvedValue(999),
      manifestAllowsStructuredCapture: () => true,
    });
    extractor.setBranchExportMode('selected');
    extractor.extractMessages = vi.fn(() => {
      throw new Error('selection failure must not trigger rendered fallback');
    });

    const result = await extractor.extract();

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Selected ChatGPT branch could not be projected from the complete archive.'
    );
    expect(result.data).toBeUndefined();
    expect(result.archiveCompanion).toBe(capture.archiveCompanion);
    expect(result.warnings).toBeUndefined();
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
    userOnlyProjection.archiveCompanion = completeCompanion();
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
    expect(result.archiveCompanion).toBe(userOnlyProjection.archiveCompanion);
  });

  it('does not apply the currently rendered Deep Research iframe to another selected leaf', async () => {
    setChatGPTLocation(CONVERSATION_ID);
    loadFixture(
      '<iframe title="internal://deep-research" src="https://example.invalid/deep-research"></iframe>'
    );
    const extractor = new ChatGPTExtractor({
      captureArchive: vi.fn().mockResolvedValue(branchCapture()),
      selectBranch: vi.fn().mockResolvedValue(2),
      manifestAllowsStructuredCapture: () => true,
    });
    extractor.setBranchExportMode('selected');

    const result = await extractor.extract();

    expect(result.success).toBe(true);
    expect(result.data?.presentation).toMatchObject({
      mode: 'selected-branch',
      branchOrdinal: 2,
    });
    expect(result.warnings?.join(' ') ?? '').not.toMatch(/Deep Research frame/i);
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
