import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AllBranchesPresentationPlan,
  ArchiveCompanionBundle,
  ChatGptAssetExportContext,
  ContentScriptSettings,
  ExtractionResult,
  MultiOutputResponse,
  ChatGptStructuredPresentationContext,
  StructuredArchivePresentationContext,
  StructuredPresentationContext,
} from '../../src/lib/types';
import { resetLocation, setChatGPTLocation } from '../fixtures/dom-helpers';

const mocks = vi.hoisted(() => {
  const state: { stopCallback?: () => void } = {};
  const stopDispose = vi.fn();
  return {
    state,
    stopDispose,
    applySettings: vi.fn(),
    attachmentExport: vi.fn(),
    html: vi.fn(),
    localize: vi.fn(),
    extract: vi.fn(),
    prepareAllBranchesPersistence: vi.fn(() => ({
      session: {},
      structural: { accepted: true, plannedArtifactWrites: 6 },
      requestedOutputs: ['file'],
    })),
    persistAllBranchesPresentation: vi.fn(),
    sendMessage: vi.fn(),
    setBranchExportMode: vi.fn(),
    showErrorToast: vi.fn(),
    showToast: vi.fn(),
    showWarningToast: vi.fn(),
    showAllBranchesStopControl: vi.fn((onStop: () => void) => {
      state.stopCallback = onStop;
      return { stopRequested: false, requestStop: vi.fn(), dispose: stopDispose };
    }),
    setButtonLoading: vi.fn(),
    validate: vi.fn(),
  };
});

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

vi.mock('../../src/content/derived-html-persistence', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/content/derived-html-persistence')>();
  return { ...actual, persistDerivedHtmlForFile: mocks.html };
});

vi.mock('../../src/content/chatgpt-sandbox-localization', () => ({
  localizeChatGptSandboxLinks: mocks.localize,
}));

vi.mock('../../src/content/archive-branch-persistence', () => ({
  prepareAllBranchesPersistence: mocks.prepareAllBranchesPersistence,
  persistAllBranchesPresentation: mocks.persistAllBranchesPresentation,
}));

vi.mock('../../src/content/ui', () => ({
  injectBranchExportButton: vi.fn(),
  injectSyncButton: vi.fn(),
  setButtonLoading: mocks.setButtonLoading,
  showErrorToast: mocks.showErrorToast,
  showToast: mocks.showToast,
  showWarningToast: mocks.showWarningToast,
  showAllBranchesStopControl: mocks.showAllBranchesStopControl,
}));

vi.mock('../../src/lib/messaging', () => ({ sendMessage: mocks.sendMessage }));

import { handleSync, persistArchiveCompanionArtifacts } from '../../src/content/bootstrap';
import { createOperationWriteLedger } from '../../src/lib/operation-write-ledger';
import { conversationToNote } from '../../src/content/markdown';
import { decorateChatGptArchiveNote } from '../../src/content/chatgpt-archive-links';
import { serializeSyncSettingsSnapshot } from '../../src/lib/sync-settings-snapshot';
import {
  observeChatGptAssetResolversViaOpaqueSource,
  resolveChatGptActiveImageAsset,
  resolveChatGptLibraryJpegAsset,
  observeChatGptInterpreterAssetResolvers,
} from '../../src/content/capture/chatgpt-current-branch';

const settings: ContentScriptSettings = {
  obsidianUrl: 'http://127.0.0.1:27123',
  vaultPath: 'AI/{platform}',
  isApiKeyConfigured: true,
  enableAutoScroll: false,
  enableAppendMode: false,
  enableToolContent: false,
  enableImageExport: true,
  enableHtmlExport: false,
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

const archivedDocxSha256 = 'd'.repeat(64);
const fileReceipt = {
  destination: 'file' as const,
  captureId: companion.captureId,
  conversationKey: companion.conversationKey,
  manifestSha256: 'e'.repeat(64),
  archiveByteLengths: { raw: companion.artifacts[0].byteLength, manifest: 2, canonical: 2 },
  assets: [
    {
      sha256: archivedDocxSha256,
      relativePath: `assets/${archivedDocxSha256}.docx`,
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      byteLength: 45_036,
    },
  ],
};

function mockSettingsAndSave(): void {
  mocks.sendMessage.mockImplementation((message: { action: string }) => {
    if (message.action === 'getSettings') return Promise.resolve(settings);
    if (message.action === 'testConnection') return Promise.resolve({ success: true });
    if (message.action === 'saveToOutputs') return Promise.resolve(successfulSave);
    return Promise.reject(new Error(`unexpected background message: ${message.action}`));
  });
}

describe('ChatGPT opt-in attachment bootstrap orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settings.enableImageExport = true;
    settings.enableHtmlExport = false;
    settings.enableChatGptOpaqueReplay = false;
    settings.outputOptions = { obsidian: false, file: true, clipboard: false };
    setChatGPTLocation('01234567-89ab-4cde-8f01-23456789abcd');
    mockSettingsAndSave();
    mocks.validate.mockReturnValue({ isValid: true, warnings: [], errors: [] });
    mocks.html.mockResolvedValue({ success: true, warnings: [] });
    mocks.localize.mockImplementation(async data => data);
    mocks.attachmentExport.mockResolvedValue({
      rawSuccessfulDestinations: ['file'],
      completeDestinations: ['file'],
      destinationReceipts: [fileReceipt],
      warnings: ['ChatGPT attachment export recorded one destination caveat.'],
    });
  });

  it('retains per-artifact facts when a later archive request loses its response', async () => {
    const ledger = createOperationWriteLedger(companion.captureId);
    mocks.sendMessage.mockImplementation(async message => {
      expect(message.reportDurableWriteOutcome).toBe(true);
      if (message.artifact.kind === 'manifest') throw new Error('lost reply');
      return {
        results: message.outputs.map((destination: string) => ({
          destination,
          success: true,
          writeOutcome: { state: 'confirmed' },
        })),
        allSuccessful: true,
        anySuccessful: true,
      };
    });
    const result = await persistArchiveCompanionArtifacts(
      companion,
      'test.md',
      'chatgpt',
      ['file', 'obsidian'],
      undefined,
      undefined,
      ledger
    );
    expect(result.activeOutputs).toEqual([]);
    expect(ledger.snapshot().valid).toBe(true);
    expect(
      ledger.snapshot().observations.map(entry => [entry.destination, entry.kind, entry.state])
    ).toEqual([
      ['file', 'raw', 'confirmed'],
      ['obsidian', 'raw', 'confirmed'],
      ['file', 'manifest', 'unknown'],
      ['obsidian', 'manifest', 'unknown'],
    ]);
  });

  it.each(['file', 'obsidian'] as const)(
    'localizes only verified %s text and keeps one rendering/settings identity across awaits',
    async destination => {
      vi.useFakeTimers();
      const previousTemplate = { ...settings.templateOptions };
      const renderedAt = new Date('2026-10-23T23:59:59.000Z');
      vi.setSystemTime(renderedAt);
      try {
        settings.templateOptions.filenameScheme = 'title-date';
        settings.outputOptions = { file: true, obsidian: true, clipboard: true };
        const frozenSettings = structuredClone(settings);
        const data = {
          ...noteResult.data!,
          capture: { mode: 'structured-api' as const, completeness: 'complete' as const },
          messages: [
            {
              id: 'assistant',
              role: 'assistant' as const,
              index: 0,
              contentFormat: 'markdown' as const,
              content: '[document](sandbox:/mnt/data/document.docx)',
            },
          ],
        };
        const retained = {} as ChatGptStructuredPresentationContext;
        const receipt = { ...fileReceipt, destination };
        const evidence = { receipt, records: [{ id: 'runtime-only-source-ref-must-not-leak' }] };
        mocks.extract.mockResolvedValue({
          ...noteResult,
          data,
          chatGptStructuredPresentationContext: retained,
        });
        mocks.attachmentExport.mockImplementationOnce(async () => {
          vi.setSystemTime(new Date('2026-10-24T00:05:00.000Z'));
          settings.templateOptions.filenameScheme = 'title-id';
          settings.vaultPath = 'Changed/{platform}';
          return {
            completeDestinations: [destination],
            rawSuccessfulDestinations: [destination],
            destinationReceipts: [receipt],
            destinationLocalizationEvidence: [evidence],
            warnings: [],
          };
        });
        mocks.localize.mockImplementationOnce(async original => ({
          ...original,
          messages: original.messages.map(message => ({
            ...message,
            content: `[document](_liska-archive/${receipt.conversationKey}/${receipt.captureId}/${receipt.assets[0].relativePath})`,
          })),
        }));
        mocks.sendMessage.mockImplementation(async message => {
          if (message.action === 'getSettings') return settings;
          if (message.action === 'testConnection') return { success: true };
          if (message.action === 'saveToOutputs')
            return {
              results: [{ destination: message.outputs[0], success: true }],
              allSuccessful: true,
              anySuccessful: true,
            };
          throw new Error('unexpected-message');
        });
        await handleSync();
        const writes = mocks.sendMessage.mock.calls
          .map(([message]) => message)
          .filter(message => message.action === 'saveToOutputs');
        expect(writes).toHaveLength(3);
        expect(mocks.localize).toHaveBeenCalledExactlyOnceWith(
          data,
          retained,
          evidence,
          receipt,
          destination
        );
        const baseNote = conversationToNote(data, frozenSettings.templateOptions, renderedAt);
        for (const write of writes) {
          expect(write.expectedSyncSettingsSnapshot).toBe(
            serializeSyncSettingsSnapshot(frozenSettings)
          );
          expect(write.data.frontmatter.modified).toBe(baseNote.frontmatter.modified);
          if (write.outputs[0] === destination) {
            expect(write.data.fileName).toBe(
              decorateChatGptArchiveNote(baseNote, receipt).fileName
            );
            expect(write.data.body).not.toContain('sandbox:');
            expect(write.data.body.match(/## Local archive attachments/g)).toHaveLength(1);
            expect(write.data.frontmatter).toEqual(
              decorateChatGptArchiveNote(baseNote, receipt).frontmatter
            );
          } else {
            expect(write.data).toEqual(baseNote);
            expect(write.data.body).toContain('sandbox:');
          }
          expect(JSON.stringify(write)).not.toContain('runtime-only-source-ref-must-not-leak');
        }
      } finally {
        settings.templateOptions = previousTemplate;
        settings.vaultPath = 'AI/{platform}';
        vi.useRealTimers();
      }
    }
  );

  it.each(['throws', 'changes-identity'] as const)(
    'keeps original text and the appendix if localization %s',
    async failure => {
      const retained = {} as ChatGptStructuredPresentationContext;
      mocks.extract.mockResolvedValue({
        ...noteResult,
        chatGptStructuredPresentationContext: retained,
      });
      mocks.attachmentExport.mockResolvedValue({
        completeDestinations: ['file'],
        rawSuccessfulDestinations: ['file'],
        destinationReceipts: [fileReceipt],
        destinationLocalizationEvidence: [{ receipt: fileReceipt }],
        warnings: [],
      });
      if (failure === 'throws')
        mocks.localize.mockRejectedValueOnce(new Error('private-diagnostic'));
      else
        mocks.localize.mockResolvedValueOnce({
          ...noteResult.data,
          title: 'unexpected-title',
          url: 'https://example.invalid',
        });
      await handleSync();
      const write = mocks.sendMessage.mock.calls
        .map(([message]) => message)
        .find(message => message.action === 'saveToOutputs');
      expect(write.data.frontmatter.title).toBe(noteResult.data!.title);
      expect(write.data.body).toContain('Question');
      expect(write.data.body.match(/## Local archive attachments/g)).toHaveLength(1);
      expect(mocks.showErrorToast).not.toHaveBeenCalled();
    }
  );

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
        expect.objectContaining({
          persistArtifacts: expect.any(Function),
          expectedSyncSettingsSnapshot: serializeSyncSettingsSnapshot(settings),
          observeInterpreterResolvers: observeChatGptInterpreterAssetResolvers,
        })
      );
      expect(mocks.attachmentExport.mock.calls[0][4]).not.toHaveProperty('observeResolvers');
      expect(mocks.attachmentExport.mock.calls[0][4]).not.toHaveProperty('resolveActiveAsset');
      expect(mocks.attachmentExport.mock.calls[0][4]).not.toHaveProperty('resolveLibraryAsset');
      expect(mocks.attachmentExport.mock.calls[0][4]).not.toHaveProperty('presentationContext');
      expect(mocks.html).not.toHaveBeenCalled();
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'saveToOutputs',
          outputs: ['file'],
          expectedSyncSettingsSnapshot: serializeSyncSettingsSnapshot(settings),
        })
      );
      const saveMessage = mocks.sendMessage.mock.calls
        .map(call => call[0])
        .find(message => message.action === 'saveToOutputs');
      expect(saveMessage.data.frontmatter).toMatchObject({
        archive_capture_id: companion.captureId,
        archive_manifest_sha256: fileReceipt.manifestSha256,
      });
      expect(saveMessage.data.body).toContain(
        `_liska-archive/${companion.conversationKey}/${companion.captureId}/assets/${archivedDocxSha256}.docx`
      );
      expect(mocks.showWarningToast).toHaveBeenCalledWith(
        'ChatGPT attachment export recorded one destination caveat.'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes finalized File HTML after attachment finalization and before Markdown', async () => {
    settings.enableHtmlExport = true;
    const presentationContext = {
      source: 'chatgpt',
      captureId: companion.captureId,
      conversationKey: companion.conversationKey,
    } as StructuredPresentationContext;
    const filePresentation = {
      context: presentationContext,
      assetBindings: { bindings: [], sha256: null },
    };
    mocks.extract.mockResolvedValue({
      ...noteResult,
      structuredPresentationContext: presentationContext,
    });
    mocks.attachmentExport.mockImplementationOnce(async (...args) => {
      expect(args[4]).toEqual(
        expect.objectContaining({
          presentationContext,
          expectedSyncSettingsSnapshot: serializeSyncSettingsSnapshot(settings),
        })
      );
      return {
        rawSuccessfulDestinations: ['file'],
        completeDestinations: ['file'],
        destinationReceipts: [fileReceipt],
        filePresentation,
        warnings: [],
      };
    });
    const order: string[] = [];
    mocks.html.mockImplementationOnce(async (...args) => {
      order.push('html');
      expect(args).toEqual([
        presentationContext,
        serializeSyncSettingsSnapshot(settings),
        filePresentation.assetBindings,
      ]);
      return { success: true, warnings: [] };
    });
    mocks.sendMessage.mockImplementation(async message => {
      if (message.action === 'getSettings') return settings;
      if (message.action === 'saveToOutputs') {
        order.push('markdown');
        return successfulSave;
      }
      throw new Error('unexpected-message');
    });

    await handleSync();

    expect(order).toEqual(['html', 'markdown']);
    expect(mocks.html).toHaveBeenCalledOnce();
  });

  it('writes per-destination archive provenance and never gives Clipboard a local archive link', async () => {
    settings.outputOptions = { obsidian: true, file: true, clipboard: true };
    const obsidianReceipt = {
      destination: 'obsidian' as const,
      captureId: companion.captureId,
      conversationKey: companion.conversationKey,
      manifestSha256: 'f'.repeat(64),
      archiveByteLengths: { raw: companion.artifacts[0].byteLength, manifest: 2, canonical: 2 },
      assets: [],
    };
    mocks.attachmentExport.mockResolvedValue({
      rawSuccessfulDestinations: ['obsidian', 'file'],
      completeDestinations: ['obsidian', 'file'],
      destinationReceipts: [obsidianReceipt, fileReceipt],
      warnings: [],
    });
    mocks.extract.mockResolvedValue(noteResult);
    mocks.sendMessage.mockImplementation(
      (message: { action: string; outputs?: Array<'obsidian' | 'file' | 'clipboard'> }) => {
        if (message.action === 'getSettings') return Promise.resolve(settings);
        if (message.action === 'testConnection') return Promise.resolve({ success: true });
        if (message.action === 'saveToOutputs') {
          const destination = message.outputs?.[0];
          return Promise.resolve({
            results: [{ destination, success: true }],
            allSuccessful: true,
            anySuccessful: true,
          });
        }
        return Promise.reject(new Error(`unexpected background message: ${message.action}`));
      }
    );

    await handleSync();

    const saveMessages = mocks.sendMessage.mock.calls
      .map(call => call[0])
      .filter(message => message.action === 'saveToOutputs');
    expect(saveMessages.map(message => message.outputs)).toEqual([
      ['obsidian'],
      ['file'],
      ['clipboard'],
    ]);
    const obsidianNote = saveMessages[0].data;
    const fileNote = saveMessages[1].data;
    const clipboardNote = saveMessages[2].data;
    expect(obsidianNote.frontmatter).toMatchObject({
      archive_capture_id: companion.captureId,
      archive_manifest_sha256: obsidianReceipt.manifestSha256,
    });
    expect(obsidianNote.body).not.toContain('## Local archive attachments');
    expect(fileNote.frontmatter).toMatchObject({
      archive_capture_id: companion.captureId,
      archive_manifest_sha256: fileReceipt.manifestSha256,
    });
    expect(fileNote.body).toContain('## Local archive attachments');
    expect(fileNote.body).toContain(`/assets/${archivedDocxSha256}.docx`);
    expect(clipboardNote.frontmatter).not.toHaveProperty('archive_capture_id');
    expect(clipboardNote.frontmatter).not.toHaveProperty('archive_manifest_sha256');
    expect(clipboardNote.body).not.toContain('_liska-archive/');
  });

  it('continues with later destinations when one destination note message rejects', async () => {
    vi.useFakeTimers();
    try {
      settings.outputOptions = { obsidian: true, file: true, clipboard: false };
      mocks.attachmentExport.mockResolvedValue({
        rawSuccessfulDestinations: ['obsidian', 'file'],
        completeDestinations: ['file'],
        destinationReceipts: [fileReceipt],
        warnings: [],
      });
      mocks.extract.mockResolvedValue(noteResult);
      mocks.sendMessage.mockImplementation(
        (message: { action: string; outputs?: Array<'obsidian' | 'file'> }) => {
          if (message.action === 'getSettings') return Promise.resolve(settings);
          if (message.action === 'testConnection') return Promise.resolve({ success: true });
          if (message.action === 'saveToOutputs' && message.outputs?.[0] === 'obsidian') {
            return Promise.reject(new Error('synthetic message transport failure'));
          }
          if (message.action === 'saveToOutputs' && message.outputs?.[0] === 'file') {
            return Promise.resolve({
              results: [{ destination: 'file', success: true }],
              allSuccessful: true,
              anySuccessful: true,
            });
          }
          return Promise.reject(new Error(`unexpected background message: ${message.action}`));
        }
      );

      await handleSync();
      await vi.advanceTimersByTimeAsync(10_000);

      const saveMessages = mocks.sendMessage.mock.calls
        .map(call => call[0])
        .filter(message => message.action === 'saveToOutputs');
      expect(saveMessages.map(message => message.outputs)).toEqual([['obsidian'], ['file']]);
      expect(mocks.showWarningToast).toHaveBeenCalledWith(
        'Saved to: file. Failed: obsidian: Note write failed'
      );
      expect(mocks.showWarningToast).toHaveBeenCalledTimes(1);
      expect(
        mocks.showWarningToast.mock.calls.some(call =>
          String(call[0]).includes('without finalized archive provenance')
        )
      ).toBe(false);
      expect(mocks.showErrorToast).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('injects passive observation and separate ordinary/Library image routes only for strict replay', async () => {
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
        observeInterpreterResolvers: observeChatGptInterpreterAssetResolvers,
        observeResolvers: observeChatGptAssetResolversViaOpaqueSource,
        resolveActiveAsset: resolveChatGptActiveImageAsset,
        resolveLibraryAsset: resolveChatGptLibraryJpegAsset,
      })
    );
  });

  it('wires the same passive observer and ordinary image data route for a selected replay branch', async () => {
    settings.enableChatGptOpaqueReplay = true;
    mocks.extract.mockResolvedValue(noteResult);

    await handleSync('selected');

    expect(mocks.setBranchExportMode).toHaveBeenCalledWith('selected');
    expect(mocks.attachmentExport.mock.calls[0][4]).toEqual(
      expect.objectContaining({
        observeInterpreterResolvers: observeChatGptInterpreterAssetResolvers,
        observeResolvers: observeChatGptAssetResolversViaOpaqueSource,
        resolveActiveAsset: resolveChatGptActiveImageAsset,
        resolveLibraryAsset: resolveChatGptLibraryJpegAsset,
      })
    );
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

    expect(mocks.stopDispose).toHaveBeenCalledTimes(1);
    expect(mocks.setBranchExportMode).toHaveBeenCalledWith('selected');
    expect(mocks.attachmentExport).toHaveBeenCalledWith(
      context,
      companion,
      'chatgpt-all-branches.md',
      ['file'],
      expect.objectContaining({
        persistArtifacts: expect.any(Function),
        observeInterpreterResolvers: observeChatGptInterpreterAssetResolvers,
      })
    );
    expect(mocks.attachmentExport.mock.calls[0][4]).not.toHaveProperty('observeResolvers');
    expect(mocks.attachmentExport.mock.calls[0][4]).not.toHaveProperty('resolveActiveAsset');
    expect(mocks.attachmentExport.mock.calls[0][4]).not.toHaveProperty('resolveLibraryAsset');
    expect(mocks.attachmentExport.mock.calls[0][4]).not.toHaveProperty(
      'archivePresentationContext'
    );
    expect(mocks.persistAllBranchesPresentation).toHaveBeenCalledWith(
      allBranchesResult.allBranches,
      companion,
      settings.templateOptions,
      settings.enableToolContent,
      ['file'],
      expect.objectContaining({
        destinationReceipts: [fileReceipt],
        signal: expect.any(AbortSignal),
        persistArtifacts: expect.any(Function),
        fingerprintNote: expect.any(Function),
      })
    );
    expect(mocks.showWarningToast).toHaveBeenCalledWith(
      expect.stringContaining('ChatGPT attachment export recorded one destination caveat.')
    );
  });

  it('passes archive presentation context only to an HTML-opted-in all-branches File finalization', async () => {
    settings.enableHtmlExport = true;
    const archivePresentationContext = {} as StructuredArchivePresentationContext;
    const allBranchesResult: ExtractionResult = {
      success: true,
      archiveCompanion: companion,
      chatGptAssetExportContext: context,
      allBranches: {
        structuredArchivePresentationContext: archivePresentationContext,
      } as AllBranchesPresentationPlan,
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

    expect(mocks.attachmentExport.mock.calls[0][4]).toEqual(
      expect.objectContaining({ archivePresentationContext })
    );
    expect(mocks.attachmentExport.mock.calls[0][4]).not.toHaveProperty('presentationContext');
    expect(mocks.html).not.toHaveBeenCalled();
  });

  it('withholds archive presentation context when all-branches File output is not requested', async () => {
    settings.enableHtmlExport = true;
    settings.outputOptions = { obsidian: true, file: false, clipboard: false };
    const archivePresentationContext = {} as StructuredArchivePresentationContext;
    mocks.extract.mockResolvedValue({
      success: true,
      archiveCompanion: companion,
      chatGptAssetExportContext: context,
      allBranches: {
        structuredArchivePresentationContext: archivePresentationContext,
      } as AllBranchesPresentationPlan,
    } satisfies ExtractionResult);
    mocks.attachmentExport.mockResolvedValueOnce({
      rawSuccessfulDestinations: ['obsidian'],
      completeDestinations: ['obsidian'],
      destinationReceipts: [],
      warnings: [],
    });
    mocks.persistAllBranchesPresentation.mockResolvedValue({
      branchCount: 2,
      omissionBranchCount: 0,
      canonicalOnlyCount: 0,
      clipboardSkipped: false,
      allSuccessful: true,
      destinations: [
        { destination: 'obsidian', archiveSaved: true, branchFilesSaved: 2, indexSaved: true },
      ],
    });

    await handleSync('selected');

    expect(mocks.attachmentExport.mock.calls[0][4]).not.toHaveProperty(
      'archivePresentationContext'
    );
    expect(mocks.html).not.toHaveBeenCalled();
  });

  it('wires the full-trio plain path without acquiring attachments when image export is disabled', async () => {
    settings.enableImageExport = false;
    mocks.extract.mockResolvedValue({
      success: true,
      archiveCompanion: companion,
      chatGptAssetExportContext: context,
      allBranches: {} as AllBranchesPresentationPlan,
    });
    mocks.persistAllBranchesPresentation.mockResolvedValue({
      status: 'complete',
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
    expect(mocks.attachmentExport).not.toHaveBeenCalled();
    expect(mocks.persistAllBranchesPresentation).toHaveBeenCalledWith(
      expect.any(Object),
      companion,
      settings.templateOptions,
      settings.enableToolContent,
      ['file'],
      expect.objectContaining({
        persistArtifacts: expect.any(Function),
        destinationReceipts: undefined,
        fingerprintNote: expect.any(Function),
      })
    );
    const options = mocks.persistAllBranchesPresentation.mock.calls[0][5];
    await options.persistArtifacts(companion, 'all.md', 'chatgpt', ['file']);
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'persistArchiveCompanion',
        expectedSyncSettingsSnapshot: serializeSyncSettingsSnapshot(settings),
      })
    );
    expect(mocks.stopDispose).toHaveBeenCalledTimes(1);
  });

  it('rejects structural over-budget work before the attachment pipeline writes anything', async () => {
    const allBranchesResult: ExtractionResult = {
      success: true,
      archiveCompanion: companion,
      chatGptAssetExportContext: context,
      allBranches: {} as AllBranchesPresentationPlan,
    };
    const rejectedPrepared = {
      session: {},
      structural: {
        accepted: false,
        budgetKind: 'leaves',
        plannedArtifactWrites: 600,
      },
      requestedOutputs: ['file'],
    };
    mocks.extract.mockResolvedValue(allBranchesResult);
    mocks.prepareAllBranchesPersistence.mockReturnValueOnce(rejectedPrepared);
    mocks.persistAllBranchesPresentation.mockResolvedValueOnce({
      version: 1,
      status: 'rejected',
      phase: 'structural-preflight',
      budgetKind: 'leaves',
      cancelRequested: false,
      metrics: {
        nodeCount: 600,
        leafCount: 513,
        branchPointCount: 1,
        pathVisits: 600,
        sourceWorkBytes: 600,
      },
      plannedArtifactWrites: 600,
      plannedPhysicalBytes: 0,
      measuredLeaves: 0,
      renderedLeaves: 0,
      branchCount: 513,
      omissionBranchCount: 0,
      canonicalOnlyCount: 0,
      clipboardSkipped: false,
      destinations: [
        {
          destination: 'file',
          archiveSaved: false,
          archiveState: 'not-attempted',
          branchFilesSaved: 0,
          branchWrites: { confirmed: 0, failed: 0, unknown: 0 },
          indexSaved: false,
          indexState: 'not-attempted',
          dispatchedBytes: 0,
          confirmedBytes: 0,
        },
      ],
      allSuccessful: false,
    });

    await handleSync('selected');

    expect(mocks.attachmentExport).not.toHaveBeenCalled();
    expect(mocks.persistAllBranchesPresentation).toHaveBeenCalledWith(
      allBranchesResult.allBranches,
      companion,
      settings.templateOptions,
      settings.enableToolContent,
      ['file'],
      expect.objectContaining({ prepared: rejectedPrepared })
    );
    expect(mocks.stopDispose).toHaveBeenCalledTimes(1);
  });

  it('disposes Stop once and schedules nothing when stopped before attachment work', async () => {
    mocks.extract.mockResolvedValue({
      success: true,
      archiveCompanion: companion,
      chatGptAssetExportContext: context,
      allBranches: {} as AllBranchesPresentationPlan,
    } satisfies ExtractionResult);
    mocks.showAllBranchesStopControl.mockImplementationOnce((onStop: () => void) => {
      mocks.state.stopCallback = onStop;
      onStop();
      return { stopRequested: true, requestStop: vi.fn(), dispose: mocks.stopDispose };
    });

    await handleSync('selected');

    expect(mocks.attachmentExport).not.toHaveBeenCalled();
    expect(mocks.persistAllBranchesPresentation).not.toHaveBeenCalled();
    expect(mocks.showWarningToast).toHaveBeenCalledWith(expect.stringContaining('was stopped'));
    expect(mocks.stopDispose).toHaveBeenCalledTimes(1);
    expect(mocks.setButtonLoading).toHaveBeenLastCalledWith(false);
  });

  it('lets an in-flight attachment pipeline finish, then schedules no Markdown after Stop', async () => {
    mocks.extract.mockResolvedValue({
      success: true,
      archiveCompanion: companion,
      chatGptAssetExportContext: context,
      allBranches: {} as AllBranchesPresentationPlan,
    } satisfies ExtractionResult);
    mocks.persistAllBranchesPresentation.mockResolvedValueOnce({
      status: 'cancelled',
      branchCount: 2,
      destinations: [
        { destination: 'file', archiveSaved: false, branchFilesSaved: 0, indexSaved: false },
      ],
      allSuccessful: false,
    });
    mocks.attachmentExport.mockImplementationOnce(
      async (_context, _companion, _name, _outputs, dependencies) => {
        const attempt = dependencies.writeLedger.begin('file', 'raw', 2);
        attempt.issue();
        attempt.observe({ state: 'confirmed' });
        mocks.state.stopCallback?.();
        return {
          rawSuccessfulDestinations: ['file'],
          completeDestinations: ['file'],
          destinationReceipts: [],
          warnings: [],
        };
      }
    );

    await handleSync('selected');

    expect(mocks.attachmentExport).toHaveBeenCalledTimes(1);
    expect(mocks.persistAllBranchesPresentation).toHaveBeenCalledOnce();
    const options = mocks.persistAllBranchesPresentation.mock.calls[0][5];
    expect(options.signal.aborted).toBe(true);
    expect(options.writeLedgerSnapshot().observations).toMatchObject([
      { kind: 'raw', state: 'confirmed', byteLength: 2 },
    ]);
    expect(mocks.showWarningToast).toHaveBeenCalledWith(expect.stringContaining('was stopped'));
    expect(mocks.stopDispose).toHaveBeenCalledTimes(1);
  });

  it('withholds all-branches Markdown when no destination completed its archive companions', async () => {
    mocks.persistAllBranchesPresentation.mockResolvedValueOnce({
      status: 'failed',
      phase: 'archive',
      branchCount: 2,
      destinations: [
        { destination: 'file', archiveSaved: false, branchFilesSaved: 0, indexSaved: false },
      ],
      allSuccessful: false,
    });
    mocks.extract.mockResolvedValue({
      success: true,
      archiveCompanion: companion,
      chatGptAssetExportContext: context,
      allBranches: {} as AllBranchesPresentationPlan,
    } satisfies ExtractionResult);
    mocks.attachmentExport.mockResolvedValue({
      rawSuccessfulDestinations: ['file'],
      completeDestinations: [],
      destinationReceipts: [],
      warnings: ['ChatGPT original raw archive companion could not be finalized.'],
    });

    await handleSync();

    expect(mocks.persistAllBranchesPresentation).toHaveBeenCalledOnce();
    expect(mocks.persistAllBranchesPresentation.mock.calls[0][5]).toMatchObject({
      destinationReceipts: [],
      writeLedgerSnapshot: expect.any(Function),
    });
    expect(mocks.showWarningToast).toHaveBeenCalledWith(
      expect.stringContaining('ChatGPT original raw archive companion could not be finalized.')
    );
  });

  it('uses the same passive candidate observer for an all-branches replay export', async () => {
    mocks.persistAllBranchesPresentation.mockResolvedValueOnce({
      status: 'failed',
      phase: 'archive',
      branchCount: 2,
      destinations: [
        { destination: 'file', archiveSaved: false, branchFilesSaved: 0, indexSaved: false },
      ],
      allSuccessful: false,
    });
    settings.enableChatGptOpaqueReplay = true;
    mocks.extract.mockResolvedValue({
      success: true,
      archiveCompanion: companion,
      chatGptAssetExportContext: context,
      allBranches: {} as AllBranchesPresentationPlan,
    } satisfies ExtractionResult);
    mocks.attachmentExport.mockResolvedValue({
      rawSuccessfulDestinations: ['file'],
      completeDestinations: [],
      destinationReceipts: [],
      warnings: ['Synthetic destination failure after resolver composition.'],
    });

    await handleSync('selected');

    expect(mocks.attachmentExport).toHaveBeenCalledWith(
      context,
      companion,
      'chatgpt-all-branches.md',
      ['file'],
      expect.objectContaining({
        observeInterpreterResolvers: observeChatGptInterpreterAssetResolvers,
        observeResolvers: observeChatGptAssetResolversViaOpaqueSource,
        resolveActiveAsset: resolveChatGptActiveImageAsset,
        resolveLibraryAsset: resolveChatGptLibraryJpegAsset,
      })
    );
    expect(mocks.persistAllBranchesPresentation).toHaveBeenCalledOnce();
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

  it('keeps ChatGPT failed-extraction evidence routing and withholds Markdown/binary export', async () => {
    mocks.extract.mockResolvedValue({
      success: false,
      error: 'Rendered fallback had no messages',
      archiveCompanion: companion,
    } satisfies ExtractionResult);
    mocks.validate.mockReturnValue({
      isValid: false,
      warnings: [],
      errors: ['Rendered fallback had no messages'],
    });
    mocks.sendMessage.mockImplementation((message: { action: string }) => {
      if (message.action === 'getSettings') return Promise.resolve(settings);
      if (message.action === 'persistArchiveCompanion') return Promise.resolve(successfulSave);
      return Promise.reject(new Error(`unexpected background message: ${message.action}`));
    });

    await handleSync();

    expect(mocks.sendMessage.mock.calls.map(call => call[0])).toEqual([
      { action: 'getSettings' },
      expect.objectContaining({
        action: 'persistArchiveCompanion',
        source: 'chatgpt',
        noteFileName: 'chatgpt-capture.md',
        artifact: companion.artifacts[0],
      }),
      expect.objectContaining({
        action: 'persistArchiveCompanion',
        source: 'chatgpt',
        noteFileName: 'chatgpt-capture.md',
        artifact: companion.artifacts[1],
      }),
    ]);
    expect(mocks.attachmentExport).not.toHaveBeenCalled();
    expect(mocks.showErrorToast).toHaveBeenCalledWith(
      'Rendered fallback had no messages. Verified raw capture evidence was saved locally.'
    );
  });
});

afterAll(() => {
  resetLocation();
});
