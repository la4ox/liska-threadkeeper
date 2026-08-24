import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AllBranchesPresentationPlan,
  ArchiveCompanionBundle,
  ChatGptAssetExportContext,
  ContentScriptSettings,
  ExtractionResult,
  MultiOutputResponse,
} from '../../src/lib/types';
import { resetLocation, setChatGPTLocation } from '../fixtures/dom-helpers';

const mocks = vi.hoisted(() => ({
  applySettings: vi.fn(),
  attachmentExport: vi.fn(),
  extract: vi.fn(),
  persistAllBranchesPresentation: vi.fn(),
  sendMessage: vi.fn(),
  setBranchExportMode: vi.fn(),
  showErrorToast: vi.fn(),
  showToast: vi.fn(),
  showWarningToast: vi.fn(),
  setButtonLoading: vi.fn(),
  validate: vi.fn(),
}));

vi.mock('../../src/content/extractors/chatgpt', () => ({
  ChatGPTExtractor: class ChatGPTExtractor {
    readonly platform = 'chatgpt' as const;
    canExtract = () => true;
    extract = () => mocks.extract();
    getConversationId = () => '01234567-89ab-4cde-8f01-23456789abcd';
    getTitle = () => 'Synthetic attachment export';
    extractMessages = () => [];
    validate = (result: ExtractionResult) => mocks.validate(result);
    applySettings = (settings: ContentScriptSettings) => mocks.applySettings(settings);
    setBranchExportMode = (mode: 'current' | 'selected') => mocks.setBranchExportMode(mode);
  },
}));

vi.mock('../../src/content/chatgpt-asset-export', () => ({
  persistChatGptDestinationHonestAttachments: mocks.attachmentExport,
}));

vi.mock('../../src/content/archive-branch-persistence', () => ({
  persistAllBranchesPresentation: mocks.persistAllBranchesPresentation,
}));

vi.mock('../../src/content/ui', () => ({
  injectBranchExportButton: vi.fn(),
  injectSyncButton: vi.fn(),
  setButtonLoading: mocks.setButtonLoading,
  showErrorToast: mocks.showErrorToast,
  showToast: mocks.showToast,
  showWarningToast: mocks.showWarningToast,
}));

vi.mock('../../src/lib/messaging', () => ({ sendMessage: mocks.sendMessage }));

import { handleSync } from '../../src/content/bootstrap';

const settings: ContentScriptSettings = {
  obsidianUrl: 'http://127.0.0.1:27123',
  vaultPath: 'AI/{platform}',
  isApiKeyConfigured: true,
  enableAutoScroll: false,
  enableAppendMode: false,
  enableToolContent: false,
  enableImageExport: true,
  enableChatGptOpaqueProbe: false,
  enableChatGptOpaqueReplay: false,
  imageVaultPath: 'AI/{platform}/images',
  flattenLargeCallouts: true,
  maxCalloutLines: 200,
  outputOptions: { obsidian: false, file: true, clipboard: false },
  templateOptions: {
    includeId: true,
    includeTitle: true,
    includeTags: true,
    includeSource: true,
    includeDates: true,
    includeMessageCount: true,
    messageFormat: 'callout',
    userCalloutType: 'QUESTION',
    assistantCalloutType: 'NOTE',
  },
};

const companion: ArchiveCompanionBundle = {
  captureId: 'capture-chatgpt-01234567-89ab-4cde-8f01-23456789abcd',
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

const context = {} as ChatGptAssetExportContext;

const noteResult: ExtractionResult = {
  success: true,
  data: {
    id: '01234567-89ab-4cde-8f01-23456789abcd',
    title: 'Synthetic attachment export',
    url: 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd',
    source: 'chatgpt',
    messages: [
      {
        id: 'message-1',
        role: 'user',
        content: 'Question',
        timestamp: new Date('2026-08-21T12:00:00.000Z'),
      },
    ],
    extractedAt: new Date('2026-08-21T12:00:00.000Z'),
    metadata: {
      messageCount: 1,
      userMessageCount: 1,
      assistantMessageCount: 0,
      hasCodeBlocks: false,
    },
  },
  archiveCompanion: companion,
  chatGptAssetExportContext: context,
};

const successfulSave: MultiOutputResponse = {
  results: [{ destination: 'file', success: true }],
  allSuccessful: true,
  anySuccessful: true,
};

function mockSettingsAndSave(): void {
  mocks.sendMessage.mockImplementation((message: { action: string }) => {
    if (message.action === 'getSettings') return Promise.resolve(settings);
    if (message.action === 'saveToOutputs') return Promise.resolve(successfulSave);
    return Promise.reject(new Error(`unexpected background message: ${message.action}`));
  });
}

describe('ChatGPT opt-in attachment bootstrap orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setChatGPTLocation('01234567-89ab-4cde-8f01-23456789abcd');
    mockSettingsAndSave();
    mocks.validate.mockReturnValue({ isValid: true, warnings: [], errors: [] });
    mocks.attachmentExport.mockResolvedValue({
      rawSuccessfulDestinations: ['file'],
      completeDestinations: ['file'],
      warnings: ['ChatGPT attachment export recorded one destination caveat.'],
    });
  });

  it('runs attachment finalization before the current-branch Markdown note and propagates its caveat', async () => {
    vi.useFakeTimers();
    try {
      mocks.extract.mockResolvedValue(noteResult);

      await handleSync();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(mocks.attachmentExport).toHaveBeenCalledWith(
        context,
        companion,
        expect.stringMatching(/\.md$/),
        ['file'],
        expect.objectContaining({ persistArtifacts: expect.any(Function) })
      );
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'saveToOutputs', outputs: ['file'] })
      );
      expect(mocks.showWarningToast).toHaveBeenCalledWith(
        'ChatGPT attachment export recorded one destination caveat.'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('injects the post-raw opaque resolver observer only for opaque replay mode', async () => {
    settings.enableChatGptOpaqueReplay = true;
    mocks.extract.mockResolvedValue(noteResult);

    await handleSync();

    expect(mocks.attachmentExport).toHaveBeenCalledWith(
      context,
      companion,
      expect.stringMatching(/\.md$/),
      ['file'],
      expect.objectContaining({
        persistArtifacts: expect.any(Function),
        observeResolvers: expect.any(Function),
      })
    );
    settings.enableChatGptOpaqueReplay = false;
  });

  it('writes the all-branches presentation only to attachment-complete destinations and retains caveats', async () => {
    const allBranchesResult: ExtractionResult = {
      success: true,
      archiveCompanion: companion,
      chatGptAssetExportContext: context,
      allBranches: {} as AllBranchesPresentationPlan,
    };
    mocks.extract.mockResolvedValue(allBranchesResult);
    mocks.persistAllBranchesPresentation.mockResolvedValue({
      branchCount: 2,
      omissionBranchCount: 0,
      canonicalOnlyCount: 0,
      clipboardSkipped: false,
      allSuccessful: true,
      destinations: [
        { destination: 'file', archiveSaved: true, branchFilesSaved: 2, indexSaved: true },
      ],
    });

    await handleSync('selected');

    expect(mocks.setBranchExportMode).toHaveBeenCalledWith('selected');
    expect(mocks.attachmentExport).toHaveBeenCalledWith(
      context,
      companion,
      'chatgpt-all-branches.md',
      ['file'],
      expect.objectContaining({ persistArtifacts: expect.any(Function) })
    );
    expect(mocks.persistAllBranchesPresentation).toHaveBeenCalledWith(
      allBranchesResult.allBranches,
      companion,
      settings.templateOptions,
      settings.enableToolContent,
      ['file'],
      expect.objectContaining({ archiveAlreadyPersisted: true })
    );
    expect(mocks.showWarningToast).toHaveBeenCalledWith(
      expect.stringContaining('ChatGPT attachment export recorded one destination caveat.')
    );
  });

  it('withholds all-branches Markdown when no destination completed its archive companions', async () => {
    mocks.extract.mockResolvedValue({
      success: true,
      archiveCompanion: companion,
      chatGptAssetExportContext: context,
      allBranches: {} as AllBranchesPresentationPlan,
    } satisfies ExtractionResult);
    mocks.attachmentExport.mockResolvedValue({
      rawSuccessfulDestinations: ['file'],
      completeDestinations: [],
      warnings: ['ChatGPT original raw archive companion could not be finalized.'],
    });

    await handleSync();

    expect(mocks.persistAllBranchesPresentation).not.toHaveBeenCalled();
    expect(mocks.showWarningToast).toHaveBeenCalledWith(
      'ChatGPT original raw archive companion could not be finalized.'
    );
  });

  it('fails closed when a successful extractor result has no presentation data', async () => {
    mocks.extract.mockResolvedValue({ success: true, archiveCompanion: companion });

    await handleSync();

    expect(mocks.showErrorToast).toHaveBeenCalledWith('No conversation data extracted');
    expect(mocks.attachmentExport).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'saveToOutputs' })
    );
  });
});

afterAll(() => {
  resetLocation();
});
