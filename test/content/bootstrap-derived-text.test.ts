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
  extract: vi.fn(),
  text: vi.fn(),
  sendMessage: vi.fn(),
  showWarningToast: vi.fn(),
  validate: vi.fn(),
}));

vi.mock('../../src/content/extractors/chatgpt', () => ({
  ChatGPTExtractor: class ChatGPTExtractor {
    readonly platform = 'chatgpt' as const;
    canExtract = () => true;
    extract = () => mocks.extract();
    getConversationId = () => '01234567-89ab-4cde-8f01-23456789abcd';
    getTitle = () => 'Synthetic text export';
    extractMessages = () => [];
    validate = (result: ExtractionResult) => mocks.validate(result);
    applySettings = vi.fn();
    setBranchExportMode = vi.fn();
  },
}));

vi.mock('../../src/content/derived-text-persistence', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/content/derived-text-persistence')>();
  return { ...actual, persistDerivedTextForFile: mocks.text };
});

vi.mock('../../src/content/ui', () => ({
  injectBranchExportButton: vi.fn(),
  injectExportLauncher: vi.fn(),
  setButtonLoading: vi.fn(),
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
  showToast: vi.fn(),
  showWarningToast: mocks.showWarningToast,
}));
vi.mock('../../src/lib/messaging', () => ({ sendMessage: mocks.sendMessage }));

import { handleSync } from '../../src/content/bootstrap';
import { DERIVED_TEXT_UNAVAILABLE_WARNING } from '../../src/content/derived-text-persistence';

const settings: ContentScriptSettings = {
  obsidianUrl: 'http://127.0.0.1:27123',
  vaultPath: 'AI/{platform}',
  isApiKeyConfigured: true,
  enableAutoScroll: false,
  enableAppendMode: false,
  enableToolContent: false,
  enableImageExport: false,
  enableHtmlExport: false,
  enableTextExport: true,
  enableInertCodeBlocks: true,
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
      title: 'Synthetic text export',
      url: 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd',
      source: 'chatgpt',
      messages: [{ id: 'm1', role: 'user', content: 'Hello', index: 0 }],
      extractedAt: new Date('2026-11-03T00:00:00.000Z'),
      metadata: {
        messageCount: 1,
        userMessageCount: 1,
        assistantMessageCount: 0,
        hasCodeBlocks: false,
      },
    },
    archiveCompanion: companion,
    ...(withContext && { structuredPresentationContext: structured }),
  };
}

const output = (success: boolean): MultiOutputResponse => ({
  results: [{ destination: 'file', success }],
  allSuccessful: success,
  anySuccessful: success,
});

describe('bootstrap canonical plain-text delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
    setChatGPTLocation('01234567-89ab-4cde-8f01-23456789abcd');
    mocks.extract.mockResolvedValue(extraction());
    mocks.validate.mockReturnValue({ isValid: true, warnings: [], errors: [] });
    mocks.text.mockImplementation(async () => {
      mocks.order.push('text');
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

  it('writes text only after confirmed raw/manifest/canonical and before Markdown', async () => {
    await handleSync('selected');
    expect(mocks.order).toEqual([
      'archive:raw',
      'archive:manifest',
      'archive:canonical',
      'text',
      'markdown',
    ]);
    expect(mocks.text).toHaveBeenCalledWith(structured, expect.any(String));
  });

  it('keeps Markdown but skips text when the File archive trio is incomplete', async () => {
    mocks.sendMessage.mockImplementation(
      (message: { action: string; artifact?: { kind?: string } }) => {
        if (message.action === 'getSettings') return Promise.resolve(settings);
        if (message.action === 'persistArchiveCompanion')
          return Promise.resolve(output(message.artifact?.kind !== 'manifest'));
        if (message.action === 'saveToOutputs') {
          mocks.order.push('markdown');
          return Promise.resolve(output(true));
        }
        return Promise.reject(new Error('unexpected action'));
      }
    );
    await handleSync();
    expect(mocks.text).not.toHaveBeenCalled();
    expect(mocks.order).toContain('markdown');
  });

  it('warns instead of reconstructing text from rendered Markdown fallback', async () => {
    vi.useFakeTimers();
    try {
      mocks.extract.mockResolvedValue(extraction(false));
      await handleSync();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.text).not.toHaveBeenCalled();
      expect(mocks.showWarningToast).toHaveBeenCalledWith(
        expect.stringContaining(DERIVED_TEXT_UNAVAILABLE_WARNING)
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

afterAll(() => resetLocation());
