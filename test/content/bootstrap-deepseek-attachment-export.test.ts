import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ArchiveCompanionBundle,
  ContentScriptSettings,
  DeepSeekAssetExportContext,
  ExtractionResult,
  MultiOutputResponse,
} from '../../src/lib/types';
import { resetLocation } from '../fixtures/dom-helpers';

const mocks = vi.hoisted(() => ({
  applySettings: vi.fn(),
  attachmentExport: vi.fn(),
  extract: vi.fn(),
  sendMessage: vi.fn(),
  setButtonLoading: vi.fn(),
  showErrorToast: vi.fn(),
  showToast: vi.fn(),
  showWarningToast: vi.fn(),
  validate: vi.fn(),
}));

vi.mock('../../src/content/extractors/deepseek', () => ({
  DeepSeekExtractor: class DeepSeekExtractor {
    readonly platform = 'deepseek' as const;
    canExtract = () => true;
    extract = () => mocks.extract();
    getConversationId = () => 'synthetic-deepseek-conversation';
    getTitle = () => 'Synthetic DeepSeek attachment';
    extractMessages = () => [];
    validate = (result: ExtractionResult) => mocks.validate(result);
    applySettings = (settings: ContentScriptSettings) => mocks.applySettings(settings);
  },
}));

vi.mock('../../src/content/deepseek-asset-export', () => ({
  persistDeepSeekDestinationHonestAttachments: mocks.attachmentExport,
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

const companion = {
  captureId: 'capture-deepseek-synthetic-bootstrap',
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
} satisfies ArchiveCompanionBundle;

const context = {} as DeepSeekAssetExportContext;

function result(): ExtractionResult {
  return {
    success: true,
    data: {
      id: 'synthetic-deepseek-conversation',
      title: 'Synthetic DeepSeek attachment',
      url: 'https://chat.deepseek.com/a/chat/s/synthetic-deepseek-conversation',
      source: 'deepseek',
      capture: { mode: 'structured-api', completeness: 'complete' },
      messages: [{ id: 'one', role: 'user', content: 'Synthetic', index: 0 }],
      extractedAt: new Date('2026-09-19T10:00:00.000Z'),
      metadata: {
        messageCount: 1,
        userMessageCount: 1,
        assistantMessageCount: 0,
        hasCodeBlocks: false,
      },
    },
    archiveCompanion: companion,
    deepSeekAssetExportContext: context,
  };
}

const successfulSave: MultiOutputResponse = {
  results: [{ destination: 'file', success: true }],
  allSuccessful: true,
  anySuccessful: true,
};

function mockMessages(): void {
  mocks.sendMessage.mockImplementation((message: { action: string; outputs?: string[] }) => {
    if (message.action === 'getSettings') return Promise.resolve(settings);
    if (message.action === 'saveToOutputs') {
      const outputs = message.outputs ?? ['file'];
      return Promise.resolve({
        results: outputs.map(destination => ({ destination, success: true })),
        allSuccessful: true,
        anySuccessful: true,
      });
    }
    if (message.action === 'persistArchiveCompanion') return Promise.resolve(successfulSave);
    return Promise.reject(new Error(`unexpected background message: ${message.action}`));
  });
}

describe('DeepSeek attachment bootstrap gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'chat.deepseek.com',
        pathname: '/a/chat/s/synthetic-deepseek-conversation',
        href: 'https://chat.deepseek.com/a/chat/s/synthetic-deepseek-conversation',
        origin: 'https://chat.deepseek.com',
        protocol: 'https:',
        host: 'chat.deepseek.com',
        search: '',
        hash: '',
      },
      writable: true,
      configurable: true,
    });
    settings.enableImageExport = true;
    settings.outputOptions = { obsidian: false, file: true, clipboard: false };
    mocks.extract.mockResolvedValue(result());
    mocks.validate.mockReturnValue({ isValid: true, warnings: [], errors: [] });
    mocks.attachmentExport.mockResolvedValue({
      rawSuccessfulDestinations: ['file'],
      completeDestinations: ['file'],
      warnings: ['Synthetic DeepSeek attachment caveat.'],
    });
    mockMessages();
  });

  it('runs only for a structured DeepSeek result with a durable output', async () => {
    vi.useFakeTimers();
    try {
      await handleSync();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.attachmentExport).toHaveBeenCalledWith(
        context,
        companion,
        expect.stringMatching(/\.md$/),
        ['file'],
        { persistArtifacts: expect.any(Function) }
      );
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'saveToOutputs', outputs: ['file'] })
      );
      expect(mocks.showWarningToast).toHaveBeenCalledWith('Synthetic DeepSeek attachment caveat.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not request attachment export when the toggle is off', async () => {
    settings.enableImageExport = false;
    await handleSync();
    expect(mocks.attachmentExport).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'saveToOutputs', outputs: ['file'] })
    );
  });

  it('does not request attachment export for clipboard-only output', async () => {
    settings.outputOptions = { obsidian: false, file: false, clipboard: true };
    await handleSync();
    expect(mocks.attachmentExport).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'saveToOutputs', outputs: ['clipboard'] })
    );
  });

  it('does not request attachment export for a DOM fallback result', async () => {
    const fallback = result();
    fallback.data = {
      ...fallback.data!,
      capture: { mode: 'dom-fallback', completeness: 'partial' },
    };
    mocks.extract.mockResolvedValue(fallback);
    await handleSync();
    expect(mocks.attachmentExport).not.toHaveBeenCalled();
  });
});

afterAll(() => resetLocation());
