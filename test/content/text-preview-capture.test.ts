import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractionResult, StructuredPresentationContext } from '../../src/lib/types';
import { resetLocation, setChatGPTLocation, setNonGeminiLocation } from '../fixtures/dom-helpers';

vi.mock('../../src/content/ui', () => ({
  injectExportLauncher: vi.fn(),
  removeExportControls: vi.fn(),
  setButtonLoading: vi.fn(),
  showErrorToast: vi.fn(),
  showWarningToast: vi.fn(),
  showToast: vi.fn(),
}));
vi.mock('../../src/lib/messaging', () => ({ sendMessage: vi.fn() }));
vi.mock('../../src/content/export-operation-client', () => ({
  claimedContentExport: vi.fn(),
  installExportOperationClient: vi.fn(),
  openExportSurface: vi.fn(),
  selectExportBranch: vi.fn(),
}));
vi.mock('../../src/content/text-preview-client', () => ({
  checkTextPreviewCaptureLease: vi.fn(),
  installTextPreviewClient: vi.fn(),
  publishTextPreview: vi.fn(),
  selectTextPreviewBranch: vi.fn(),
}));
vi.mock('../../src/content/archive-stage', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/content/archive-stage')>()),
  abortStagedArchiveArtifact: vi.fn(),
}));
vi.mock('../../src/content/derived-html-authorization', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/content/derived-html-authorization')>()),
  authorizeDerivedHtmlContext: vi.fn(),
}));
vi.mock('../../src/archive/presentation', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/archive/presentation')>()),
  prepareArchivePresentationPreview: vi.fn(),
}));

import { handleTextPreviewCapture } from '../../src/content/bootstrap';
import { ChatGPTExtractor } from '../../src/content/extractors/chatgpt';
import { DeepSeekExtractor } from '../../src/content/extractors/deepseek';
import { sendMessage } from '../../src/lib/messaging';
import { abortStagedArchiveArtifact } from '../../src/content/archive-stage';
import { authorizeDerivedHtmlContext } from '../../src/content/derived-html-authorization';
import {
  prepareArchivePresentationPreview,
  PRESENTATION_RENDERER_VERSIONS,
} from '../../src/archive/presentation';
import {
  checkTextPreviewCaptureLease,
  publishTextPreview,
} from '../../src/content/text-preview-client';
import { showErrorToast, showToast } from '../../src/content/ui';

const settings = {
  enableAutoScroll: true,
  enableToolContent: false,
  enableInertCodeBlocks: true,
  enableChatGptOpaqueReplay: true,
};
const context = {
  source: 'chatgpt',
  archive: { privateCanonical: true },
  targetNodeId: 'assistant-1',
  includeToolContent: false,
} as unknown as StructuredPresentationContext;
const companion = {
  captureId: 'capture-chatgpt-test',
  conversationKey: 'a'.repeat(64),
  artifacts: [
    {
      transport: 'staged',
      stageId: `archive-stage-${'A'.repeat(32)}`,
      kind: 'raw',
      relativePath: 'responses/conversation.json',
      mediaType: 'application/json',
      byteLength: 2,
      sha256: 'b'.repeat(64),
    },
  ],
} as const;
const preview = {
  schema: 'liska-presentation-preview/1',
  sourceCanonicalSha256: 'c'.repeat(64),
  branchTargetNodeId: 'assistant-1',
  title: null,
  profile: {
    schema: 'liska-presentation-profile/1',
    includeToolContent: false,
    inertTaggedCodeBlocks: true,
  },
  rendererVersions: PRESENTATION_RENDERER_VERSIONS,
  rows: [],
} as const;

function structuredResult(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    success: true,
    archiveCompanion: companion,
    structuredPresentationContext: context,
    ...overrides,
  };
}

describe('capture-only text preview handler', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setChatGPTLocation('01234567-89ab-4cde-8f01-23456789abcd');
    vi.spyOn(ChatGPTExtractor.prototype, 'canExtract').mockReturnValue(true);
    vi.spyOn(ChatGPTExtractor.prototype, 'setBranchExportMode').mockImplementation(() => {});
    vi.spyOn(ChatGPTExtractor.prototype, 'applySettings').mockImplementation(() => {});
    vi.spyOn(ChatGPTExtractor.prototype, 'extract').mockResolvedValue(structuredResult());
    vi.spyOn(ChatGPTExtractor.prototype, 'validate');
    vi.mocked(checkTextPreviewCaptureLease).mockResolvedValue(true);
    vi.mocked(authorizeDerivedHtmlContext).mockResolvedValue({
      context,
      canonicalSha256: 'c'.repeat(64),
      assetBindingSha256: null,
    });
    vi.mocked(prepareArchivePresentationPreview).mockReturnValue(preview);
    vi.mocked(publishTextPreview).mockResolvedValue(true);
    vi.mocked(abortStagedArchiveArtifact).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetLocation();
  });

  it('authorizes exact canonical bytes, prepares pure preview, cleans stages, then publishes once', async () => {
    await expect(handleTextPreviewCapture('current', settings)).resolves.toBe(true);
    expect(ChatGPTExtractor.prototype.setBranchExportMode).toHaveBeenCalledExactlyOnceWith(
      'current'
    );
    expect(ChatGPTExtractor.prototype.applySettings).toHaveBeenCalledExactlyOnceWith({
      ...settings,
      enableChatGptOpaqueProbe: false,
    });
    expect(authorizeDerivedHtmlContext).toHaveBeenCalledExactlyOnceWith(
      context,
      undefined,
      'selected'
    );
    expect(prepareArchivePresentationPreview).toHaveBeenCalledExactlyOnceWith({
      archive: context.archive,
      canonicalSha256: 'c'.repeat(64),
      targetNodeId: 'assistant-1',
      profile: { includeToolContent: false, inertTaggedCodeBlocks: true },
    });
    expect(abortStagedArchiveArtifact).toHaveBeenCalledExactlyOnceWith(
      companion.artifacts[0].stageId,
      'chatgpt'
    );
    expect(publishTextPreview).toHaveBeenCalledExactlyOnceWith(preview);
    expect(vi.mocked(abortStagedArchiveArtifact).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(publishTextPreview).mock.invocationCallOrder[0]
    );
    expect(ChatGPTExtractor.prototype.validate).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(showErrorToast).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'forwards the frozen inert-code choice %s into the presentation profile',
    async enabled => {
      await expect(
        handleTextPreviewCapture('current', { ...settings, enableInertCodeBlocks: enabled })
      ).resolves.toBe(true);
      expect(prepareArchivePresentationPreview).toHaveBeenCalledExactlyOnceWith({
        archive: context.archive,
        canonicalSha256: 'c'.repeat(64),
        targetNodeId: 'assistant-1',
        profile: { includeToolContent: false, inertTaggedCodeBlocks: enabled },
      });
    }
  );

  it.each([1, 2])(
    'stops before preparation when capture lease check %s expires, and cleans stages',
    async check => {
      vi.mocked(checkTextPreviewCaptureLease)
        .mockReset()
        .mockResolvedValueOnce(check !== 1)
        .mockResolvedValueOnce(false);
      await expect(handleTextPreviewCapture('current', settings)).resolves.toBe(false);
      expect(prepareArchivePresentationPreview).not.toHaveBeenCalled();
      expect(publishTextPreview).not.toHaveBeenCalled();
      expect(abortStagedArchiveArtifact).toHaveBeenCalledExactlyOnceWith(
        companion.artifacts[0].stageId,
        'chatgpt'
      );
    }
  );

  it.each([
    [
      'DOM fallback / missing context',
      structuredResult({ structuredPresentationContext: undefined }),
    ],
    ['all branches', structuredResult({ allBranches: {} as never })],
    ['cancelled', structuredResult({ cancelled: true })],
    ['capture failure', structuredResult({ success: false })],
  ])('fails closed and cleans every staged companion for %s', async (_label, result) => {
    vi.mocked(ChatGPTExtractor.prototype.extract).mockResolvedValueOnce(result);
    await expect(handleTextPreviewCapture('current', settings)).resolves.toBe(false);
    expect(abortStagedArchiveArtifact).toHaveBeenCalledExactlyOnceWith(
      companion.artifacts[0].stageId,
      'chatgpt'
    );
    expect(prepareArchivePresentationPreview).not.toHaveBeenCalled();
    expect(publishTextPreview).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('rejects canonical authorization drift before preparation or publication and still cleans', async () => {
    vi.mocked(authorizeDerivedHtmlContext).mockRejectedValueOnce(
      new Error('derived-html-canonical-hash-mismatch')
    );
    await expect(handleTextPreviewCapture('current', settings)).rejects.toThrow(
      'derived-html-canonical-hash-mismatch'
    );
    expect(abortStagedArchiveArtifact).toHaveBeenCalledExactlyOnceWith(
      companion.artifacts[0].stageId,
      'chatgpt'
    );
    expect(prepareArchivePresentationPreview).not.toHaveBeenCalled();
    expect(publishTextPreview).not.toHaveBeenCalled();
  });

  it('rechecks the source lease after canonical authorization and does not prepare stale capture', async () => {
    vi.mocked(checkTextPreviewCaptureLease)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await expect(handleTextPreviewCapture('current', settings)).resolves.toBe(false);
    expect(authorizeDerivedHtmlContext).toHaveBeenCalledOnce();
    expect(prepareArchivePresentationPreview).not.toHaveBeenCalled();
    expect(publishTextPreview).not.toHaveBeenCalled();
    expect(abortStagedArchiveArtifact).toHaveBeenCalledOnce();
  });

  it('supports DeepSeek current structured capture but rejects DeepSeek selected without extraction', async () => {
    setNonGeminiLocation('chat.deepseek.com', '/a/chat/s/thread');
    vi.spyOn(DeepSeekExtractor.prototype, 'canExtract').mockReturnValue(true);
    vi.spyOn(DeepSeekExtractor.prototype, 'getConversationId').mockReturnValue('thread');
    vi.spyOn(DeepSeekExtractor.prototype, 'applySettings').mockImplementation(() => {});
    vi.spyOn(DeepSeekExtractor.prototype, 'extract').mockResolvedValue(
      structuredResult({
        structuredPresentationContext: { ...context, source: 'deepseek' } as never,
      })
    );
    vi.mocked(authorizeDerivedHtmlContext).mockResolvedValueOnce({
      context: { ...context, source: 'deepseek' } as never,
      canonicalSha256: 'c'.repeat(64),
      assetBindingSha256: null,
    });
    await expect(handleTextPreviewCapture('current', settings)).resolves.toBe(true);
    expect(abortStagedArchiveArtifact).toHaveBeenCalledWith(
      companion.artifacts[0].stageId,
      'deepseek'
    );
    vi.clearAllMocks();
    await expect(handleTextPreviewCapture('selected', settings)).resolves.toBe(false);
    expect(DeepSeekExtractor.prototype.extract).not.toHaveBeenCalled();
    expect(authorizeDerivedHtmlContext).not.toHaveBeenCalled();
    expect(publishTextPreview).not.toHaveBeenCalled();
  });
});
