import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ArchiveCompanionBundle,
  ContentScriptSettings,
  ExtractionResult,
  MultiOutputResponse,
  StructuredPresentationContext,
} from '../../src/lib/types';
import { resetLocation, setChatGPTLocation } from '../fixtures/dom-helpers';

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  applySettings: vi.fn(),
  extract: vi.fn(),
  html: vi.fn(),
  sendMessage: vi.fn(),
  setButtonLoading: vi.fn(),
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
  showToast: vi.fn(),
  showWarningToast: vi.fn(),
  validate: vi.fn(),
}));

vi.mock('../../src/content/extractors/chatgpt', () => ({
  ChatGPTExtractor: class ChatGPTExtractor {
    readonly platform = 'chatgpt' as const;
    canExtract = () => true;
    extract = () => mocks.extract();
    getConversationId = () => '01234567-89ab-4cde-8f01-23456789abcd';
    getTitle = () => 'Synthetic HTML export';
    extractMessages = () => [];
    validate = (result: ExtractionResult) => mocks.validate(result);
    applySettings = (settings: ContentScriptSettings) => mocks.applySettings(settings);
    setBranchExportMode = vi.fn();
  },
}));

vi.mock('../../src/content/derived-html-persistence', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/content/derived-html-persistence')>();
  return { ...actual, persistDerivedHtmlForFile: mocks.html };
});

vi.mock('../../src/content/ui', () => ({
  injectBranchExportButton: vi.fn(),
  injectSyncButton: vi.fn(),
  setButtonLoading: mocks.setButtonLoading,
  showErrorToast: mocks.showErrorToast,
  showSuccessToast: mocks.showSuccessToast,
  showToast: mocks.showToast,
  showWarningToast: mocks.showWarningToast,
}));

vi.mock('../../src/lib/messaging', () => ({ sendMessage: mocks.sendMessage }));

import { handleSync } from '../../src/content/bootstrap';
import { DERIVED_HTML_UNAVAILABLE_WARNING } from '../../src/content/derived-html-persistence';

const settings: ContentScriptSettings = {
  obsidianUrl: 'http://127.0.0.1:27123',
  vaultPath: 'AI/{platform}',
  isApiKeyConfigured: true,
  enableAutoScroll: false,
  enableAppendMode: false,
  enableToolContent: false,
  enableImageExport: true,
  enableHtmlExport: true,
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
    messageFormat: 'plain',
    userCalloutType: 'QUESTION',
    assistantCalloutType: 'NOTE',
  },
};

const companion: ArchiveCompanionBundle = {
  captureId: 'capture-chatgpt-01234567-89ab-4cde-8f01-23456789abcd',
  conversationKey: 'a'.repeat(64),
  artifacts: (['raw', 'manifest', 'canonical'] as const).map((kind, index) => ({
    transport: 'inline' as const,
    kind,
    relativePath:
      kind === 'raw'
        ? 'responses/conversation.json'
        : kind === 'manifest'
          ? 'manifest.json'
          : 'canonical/liska-thread-1.json',
    mediaType: 'application/json' as const,
    byteLength: 2,
    sha256: String(index + 1).repeat(64),
    bodyBase64: 'e30=',
  })) as ArchiveCompanionBundle['artifacts'],
};

const structured = {
  source: 'chatgpt',
  captureId: companion.captureId,
  conversationKey: companion.conversationKey,
} as StructuredPresentationContext;

function extraction(withContext = true): ExtractionResult {
  return {
    success: true,
    data: {
      id: 'conversation',
      title: 'Synthetic HTML export',
      url: 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd',
      source: 'chatgpt',
      messages: [{ id: 'm1', role: 'user', content: 'Hello', index: 0 }],
      extractedAt: new Date('2026-10-24T00:00:00.000Z'),
      metadata: {
        messageCount: 1,
        userMessageCount: 1,
        assistantMessageCount: 0,
        hasCodeBlocks: false,
      },
    },
    archiveCompanion: companion,
    chatGptAssetExportContext: {
      rawCaptureBundle: { manifest: { assets: [] } },
    } as NonNullable<ExtractionResult['chatGptAssetExportContext']>,
    ...(withContext && { structuredPresentationContext: structured }),
  };
}

function output(success: boolean): MultiOutputResponse {
  return {
    results: [{ destination: 'file', success }],
    allSuccessful: success,
    anySuccessful: success,
  };
}

describe('bootstrap canonical HTML delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
    setChatGPTLocation('01234567-89ab-4cde-8f01-23456789abcd');
    mocks.extract.mockResolvedValue(extraction());
    mocks.validate.mockReturnValue({ isValid: true, warnings: [], errors: [] });
    mocks.html.mockImplementation(async () => {
      mocks.order.push('html');
      return { success: true, warnings: [] };
    });
    mocks.sendMessage.mockImplementation(
      (message: { action: string; artifact?: { kind?: string } }) => {
        if (message.action === 'getSettings') return Promise.resolve(settings);
        if (message.action === 'persistArchiveCompanion') {
          mocks.order.push(`archive:${message.artifact?.kind}`);
          return Promise.resolve(output(true));
        }
        if (message.action === 'saveToOutputs') {
          mocks.order.push('markdown');
          return Promise.resolve(output(true));
        }
        return Promise.reject(new Error(`unexpected action ${message.action}`));
      }
    );
  });

  it('writes HTML only after the exact File archive trio and before Markdown', async () => {
    await handleSync();
    expect(mocks.order).toEqual([
      'archive:raw',
      'archive:manifest',
      'archive:canonical',
      'html',
      'markdown',
    ]);
    expect(mocks.html).toHaveBeenCalledWith(structured, expect.any(String));
  });

  it('keeps Markdown but skips HTML when the File archive trio is incomplete', async () => {
    mocks.sendMessage.mockImplementation(
      (message: { action: string; artifact?: { kind?: string } }) => {
        if (message.action === 'getSettings') return Promise.resolve(settings);
        if (message.action === 'persistArchiveCompanion') {
          const success = message.artifact?.kind !== 'manifest';
          mocks.order.push(`archive:${message.artifact?.kind}`);
          return Promise.resolve(output(success));
        }
        if (message.action === 'saveToOutputs') {
          mocks.order.push('markdown');
          return Promise.resolve(output(true));
        }
        return Promise.reject(new Error('unexpected action'));
      }
    );

    await handleSync();
    expect(mocks.html).not.toHaveBeenCalled();
    expect(mocks.order.at(-1)).toBe('markdown');
  });

  it('warns instead of fabricating HTML for a rendered fallback', async () => {
    vi.useFakeTimers();
    try {
      mocks.extract.mockResolvedValue(extraction(false));
      await handleSync();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.html).not.toHaveBeenCalled();
      expect(mocks.showWarningToast).toHaveBeenCalledWith(
        expect.stringContaining(DERIVED_HTML_UNAVAILABLE_WARNING)
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

afterAll(() => resetLocation());
