import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeExtractor } from '../../src/content/extractors/claude';
import * as claudeApi from '../../src/content/extractors/claude-api';
import * as claudeRoute from '../../src/content/extractors/claude-detail-route';
import { ProviderContentLimitError } from '../../src/archive/normalizers/provider-block-work-budget';
import { registerProviderContentLimitEvidence } from '../../src/content/extractors/provider-content-limit-evidence';
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
const ORGANIZATION_ID = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const ARTIFACT_ID = 'fedcbafe-dcba-4abc-8def-fedcbafedcba';
const ARTIFACT_QUERY = `?artifact=${ARTIFACT_ID}`;
const ARTIFACT_HASH = '#a1234bcd-567e';

function setClaudeUrlSuffix(suffix: string): void {
  const search = suffix.split('#', 1)[0];
  Object.assign(window.location, {
    search,
    hash: suffix.slice(search.length),
    href: `${window.location.href}${suffix}`,
  });
}

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

function postCaptureFailure(
  kind: 'structured' | 'content-limit',
  retained: ArchiveCompanionBundle
): Error {
  return kind === 'structured'
    ? new claudeApi.ClaudeStructuredCaptureError('normalization-failed', retained)
    : registerProviderContentLimitEvidence(
        new ProviderContentLimitError('claude', 'work', 2_000_000, 2_000_001, {
          occurrences: 12,
          blocks: 5,
          workUnits: 2_000_001,
        }),
        retained
      );
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

class ClaudeWithControllableDom extends ClaudeExtractor {
  override extractConversation(): Promise<ExtractionResult> {
    return super.extractConversation();
  }
}

describe('Claude structured detail preference', () => {
  let extractor: ClaudeWithControllableDom;

  beforeEach(() => {
    extractor = new ClaudeWithControllableDom();
    clearFixture();
    localStorage.clear();
    vi.spyOn(claudeRoute, 'resolveClaudeOrganizationId').mockReturnValue(ORGANIZATION_ID);
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

    expect(fetchDetail).toHaveBeenCalledWith(
      CONVERSATION_ID,
      false,
      expect.objectContaining({ resolveOrganizationId: expect.any(Function) })
    );
    expect(result.success).toBe(true);
    expect(result.data?.messages.map(message => message.content)).toEqual([
      'API question',
      'API answer',
    ]);
    expect(result.data?.capture).toEqual({ mode: 'structured-api', completeness: 'partial' });
    expect(result.archiveCompanion).toEqual(companion());
    expect(result.structuredPresentationContext).toBeUndefined();
  });

  it.each([
    { observation: 'a visible isolated frame', suffix: '', frameAttributes: '' },
    {
      observation: 'a selected Artifact query with a hidden frame',
      suffix: ARTIFACT_QUERY,
      frameAttributes: ' hidden',
    },
    {
      observation: 'a selected Artifact query and fragment with a hidden frame',
      suffix: `${ARTIFACT_QUERY}${ARTIFACT_HASH}`,
      frameAttributes: ' hidden',
    },
  ])(
    'keeps structured detail and the conversation title for $observation despite the legacy marker',
    async ({ suffix, frameAttributes }) => {
      renderConversation();
      setClaudeUrlSuffix(suffix);
      document.title = 'Rendered conversation title - Claude';
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="markdown-artifact" role="region">
          <iframe src="https://artifact.example.invalid/code/artifact/synthetic"${frameAttributes}></iframe>
        </div>`
      );
      const fetchDetail = vi
        .spyOn(claudeApi, 'fetchClaudeConversation')
        .mockResolvedValue(apiResult('  '));

      const result = await extractor.extract();

      expect(fetchDetail).toHaveBeenCalledExactlyOnceWith(
        CONVERSATION_ID,
        false,
        expect.objectContaining({ resolveOrganizationId: expect.any(Function) })
      );
      expect(result.success).toBe(true);
      expect(result.data?.type).not.toBe('deep-research');
      expect(result.data?.title).toBe('Rendered conversation title');
      expect(result.data?.capture).toEqual({ mode: 'structured-api', completeness: 'partial' });
      expect(result.data?.liskaLossDiagnostics).toEqual(['claude-artifact-content-omitted']);
      expect(result.archiveCompanion).toEqual(companion());
      expect(result.warnings).toEqual([
        claudeApi.CLAUDE_SCOPE_UNVERIFIED_WARNING,
        'Selected Claude Artifact content was not included because the isolated Artifact representation is unsupported.',
      ]);
    }
  );

  it('uses the page title only when the structured title is blank', async () => {
    renderConversation();
    document.title = 'Rendered title - Claude';
    vi.spyOn(claudeApi, 'fetchClaudeConversation').mockResolvedValue(apiResult('  '));

    expect((await extractor.extract()).data?.title).toBe('Rendered title');
  });

  it.each([
    ['clean', ''],
    ['Artifact', `${ARTIFACT_QUERY}${ARTIFACT_HASH}`],
  ])(
    'keeps the established DOM path on the %s URL when no organization capability is available',
    async (_kind, suffix) => {
      renderConversation();
      setClaudeUrlSuffix(suffix);
      vi.mocked(claudeRoute.resolveClaudeOrganizationId).mockReturnValue(null);
      const fetchDetail = vi.spyOn(claudeApi, 'fetchClaudeConversation');

      const result = await extractor.extract();

      expect(result.data?.messages.map(message => message.content).join('\n')).toContain(
        'DOM answer'
      );
      expect(result.data?.capture).toBeUndefined();
      expect(result.warnings ?? []).not.toContain(claudeApi.CLAUDE_DOM_FALLBACK_WARNING);
      expect(fetchDetail).not.toHaveBeenCalled();
    }
  );

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

  it.each(['missing org', 'null detail', 'rejected detail'] as const)(
    'keeps a selected Artifact on the ordinary transcript after %s despite a report marker',
    async unavailable => {
      renderConversation();
      setClaudeUrlSuffix(`${ARTIFACT_QUERY}${ARTIFACT_HASH}`);
      document.title = unavailable === 'missing org' ? 'Claude' : 'Rendered chat title - Claude';
      document.body.insertAdjacentHTML(
        'afterbegin',
        createClaudeDeepResearchDOM('Not the chat title', '<p>Not a transcript message</p>')
      );
      const fetchDetail = vi.spyOn(claudeApi, 'fetchClaudeConversation');
      const waiting = deferred<Awaited<ReturnType<typeof claudeApi.fetchClaudeConversation>>>();
      if (unavailable === 'missing org') {
        vi.mocked(claudeRoute.resolveClaudeOrganizationId).mockReturnValue(null);
      } else if (unavailable === 'null detail') {
        fetchDetail.mockResolvedValue(null);
      } else {
        fetchDetail.mockReturnValue(waiting.promise);
      }

      const extraction = extractor.extract();
      if (unavailable === 'rejected detail') {
        await vi.waitFor(() => expect(fetchDetail).toHaveBeenCalledOnce());
        // Losing the query during the request must not cause the DOM fallback
        // to reclassify this export or discard the initial omission evidence.
        setClaudeLocation(CONVERSATION_ID);
        waiting.reject(new claudeApi.ClaudeStructuredCaptureError('request-failed'));
      }
      const result = await extraction;

      expect(fetchDetail).toHaveBeenCalledTimes(unavailable === 'missing org' ? 0 : 1);
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        id: CONVERSATION_ID,
        title: unavailable === 'missing org' ? 'DOM question' : 'Rendered chat title',
        liskaLossDiagnostics: ['claude-artifact-content-omitted'],
      });
      expect(result.data?.messages.map(message => message.role)).toEqual(['user', 'assistant']);
      expect(result.data?.messages[0]?.content).toBe('DOM question');
      expect(result.data?.messages[1]?.content).toContain('DOM answer');
      expect(result.data?.type).not.toBe('deep-research');
      expect(result.data?.capture).toEqual(
        unavailable === 'rejected detail'
          ? { mode: 'dom-fallback', completeness: 'partial' }
          : undefined
      );
      expect(result.warnings).toContain(
        'Selected Claude Artifact content was not included because the isolated Artifact representation is unsupported.'
      );
      expect(result.archiveCompanion).toBeUndefined();
    }
  );

  it.each(['structured', 'content-limit'] as const)(
    'retains verified raw and manifest evidence after %s failure',
    async kind => {
      renderConversation();
      const retained = { ...companion(), artifacts: companion().artifacts.slice(0, 2) };
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(claudeApi, 'fetchClaudeConversation').mockRejectedValue(
        postCaptureFailure(kind, retained)
      );

      const result = await extractor.extract();

      expect(result.data?.capture).toEqual({ mode: 'dom-fallback', completeness: 'partial' });
      expect(result.archiveCompanion).toBe(retained);
      expect(result.archiveCompanion?.artifacts.map(artifact => artifact.kind)).toEqual([
        'raw',
        'manifest',
      ]);
      expect(result.warnings).toContain(claudeApi.CLAUDE_STRUCTURED_EVIDENCE_FALLBACK_WARNING);
      expect(result.warnings).not.toContain(claudeApi.CLAUDE_DOM_FALLBACK_WARNING);
      expect(warn).toHaveBeenCalledWith(
        '[G2O] Claude detail API unavailable; falling back to rendered conversation:',
        kind === 'content-limit' ? 'provider-content-limit-exceeded' : 'normalization-failed'
      );
    }
  );

  it.each(['structured', 'content-limit'] as const)(
    'retains raw evidence when %s and rendered extraction both fail',
    async kind => {
      setClaudeLocation(CONVERSATION_ID);
      loadFixture('<main></main>');
      const retained = { ...companion(), artifacts: companion().artifacts.slice(0, 2) };
      vi.spyOn(claudeApi, 'fetchClaudeConversation').mockRejectedValue(
        postCaptureFailure(kind, retained)
      );

      const result: ExtractionResult = await extractor.extract();

      expect(result.success).toBe(false);
      expect(result.archiveCompanion).toBe(retained);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    }
  );

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

  it.each(['structured', 'content-limit'] as const)(
    'releases a staged raw companion after navigation during %s failure',
    async kind => {
      renderConversation();
      const pending = deferred<Awaited<ReturnType<typeof claudeApi.fetchClaudeConversation>>>();
      vi.spyOn(claudeApi, 'fetchClaudeConversation').mockReturnValue(pending.promise);
      const retained = stagedCompanion();

      const extraction = extractor.extract();
      setClaudeLocation('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
      pending.reject(postCaptureFailure(kind, retained));

      await expect(extraction).resolves.toEqual({
        success: false,
        error: 'Conversation changed during extraction. No output was created.',
      });
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        {
          action: 'abortStagedArchiveArtifact',
          source: 'claude',
          stageId:
            retained.artifacts[0].transport === 'staged' ? retained.artifacts[0].stageId : '',
        },
        expect.any(Function)
      );
    }
  );

  it('does not reattach A evidence when navigation happens during DOM fallback', async () => {
    renderConversation();
    const retained = stagedCompanion();
    vi.spyOn(claudeApi, 'fetchClaudeConversation').mockRejectedValue(
      new claudeApi.ClaudeStructuredCaptureError('normalization-failed', retained)
    );
    const fallback = deferred<ExtractionResult>();
    const domExtract = vi.spyOn(extractor, 'extractConversation').mockReturnValue(fallback.promise);

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

  it('cancels a successful DOM fallback when its original chat changes', async () => {
    renderConversation();
    const retained = stagedCompanion();
    vi.spyOn(claudeApi, 'fetchClaudeConversation').mockRejectedValue(
      new claudeApi.ClaudeStructuredCaptureError('normalization-failed', retained)
    );
    const fallback = deferred<ExtractionResult>();
    const domExtract = vi.spyOn(extractor, 'extractConversation').mockReturnValue(fallback.promise);

    const extraction = extractor.extract();
    await vi.waitFor(() => expect(domExtract).toHaveBeenCalledOnce());
    setClaudeLocation('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    fallback.resolve({ success: true, data: apiData('Synthetic fallback conversation') });

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

  it.each([
    { pathId: CONVERSATION_ID, suffix: '' },
    { pathId: CONVERSATION_ID, suffix: `?artifact=${ARTIFACT_ID.toUpperCase()}` },
    { pathId: CONVERSATION_ID, suffix: `${ARTIFACT_QUERY}&artifact=${ARTIFACT_ID}` },
    { pathId: CONVERSATION_ID, suffix: `${ARTIFACT_QUERY}&extra=1` },
    { pathId: CONVERSATION_ID, suffix: `?%61rtifact=${ARTIFACT_ID}` },
    { pathId: CONVERSATION_ID, suffix: `?artifact=%66${ARTIFACT_ID.slice(1)}` },
    { pathId: CONVERSATION_ID, suffix: `${ARTIFACT_QUERY}#not-a-provider-fragment` },
    { pathId: `${CONVERSATION_ID}/extra`, suffix: ARTIFACT_QUERY },
  ])(
    'keeps a legacy Deep Research report for /chat/$pathId with suffix $suffix',
    async ({ pathId, suffix }) => {
      setClaudeLocation(pathId);
      setClaudeUrlSuffix(suffix);
      loadFixture(createClaudeDeepResearchDOM('Legacy report', '<p>Legacy body</p>'));
      const fetchDetail = vi.spyOn(claudeApi, 'fetchClaudeConversation');

      const result = await extractor.extract();

      expect(fetchDetail).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data?.type).toBe('deep-research');
      expect(result.data?.title).toBe('Legacy report');
      expect(result.data?.messages[0]?.content).toContain('Legacy body');
      expect(result.data).not.toHaveProperty('liskaLossDiagnostics');
      expect(result.archiveCompanion).toBeUndefined();
    }
  );
});
