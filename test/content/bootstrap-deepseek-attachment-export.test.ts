import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCaptureManifest,
  inventoryDeepSeekRawAssets,
  normalizeDeepSeekCapture,
  type RawCaptureBundle,
} from '../../src/archive';
import {
  appendJsonCanonicalCompanion,
  buildJsonRawManifestCompanion,
} from '../../src/content/capture/json-archive-companion';
import { hashCaptureManifest, sha256Hex } from '../../src/content/capture/response';
import { conversationToNote } from '../../src/content/markdown';
import type {
  ArchiveCompanionBundle,
  ContentScriptSettings,
  DeepSeekAssetExportContext,
  ExtractionResult,
  MultiOutputResponse,
  OutputDestination,
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

let companion: ArchiveCompanionBundle;
let context: DeepSeekAssetExportContext;

async function capture(fileMode: 'present' | 'empty' | 'malformed' = 'present'): Promise<{
  companion: ArchiveCompanionBundle;
  context: DeepSeekAssetExportContext;
}> {
  const file = {
    id: fileMode === 'malformed' ? null : 'file-bootstrap-synthetic',
    file_name: 'synthetic.txt',
    file_size: 9,
    status: 'SUCCESS',
    signed_path: '/file?file_id=bootstrap-synthetic&state=synthetic-bootstrap-state',
  };
  const raw = {
    code: 0,
    data: {
      biz_code: 0,
      biz_data: {
        cache_control: 'REPLACE',
        chat_session: {
          id: 'synthetic-deepseek-conversation',
          title: 'Synthetic DeepSeek attachment',
          current_message_id: 'one',
        },
        chat_messages: [
          {
            message_id: 'one',
            parent_id: null,
            role: 'USER',
            fragments: [{ type: 'REQUEST', content: 'Synthetic' }],
            files: fileMode === 'empty' ? [] : [file],
          },
        ],
      },
    },
  };
  const bytes = new TextEncoder().encode(JSON.stringify(raw));
  const artifact = {
    id: 'conversation',
    relativePath: 'responses/conversation.json',
    mediaType: 'application/json',
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    endpoint: { method: 'GET' as const, pathPattern: '/api/v0/chat/history_messages' },
  };
  const inventory = await inventoryDeepSeekRawAssets({
    raw,
    artifactId: 'conversation',
    sha256: sha256Hex,
  });
  const manifest = buildCaptureManifest({
    captureId: 'capture-deepseek-synthetic-bootstrap',
    provider: 'deepseek',
    conversationId: 'synthetic-deepseek-conversation',
    capturedAt: '2026-09-19T10:00:00.000Z',
    method: 'same-origin-api',
    artifacts: [artifact],
    assets: inventory.assets,
    completeness: {
      graph: 'complete',
      messages: 'complete',
      branches: 'complete',
      assets: inventory.completeness,
    },
    warnings: inventory.warnings,
  });
  const bundle: RawCaptureBundle = {
    manifest,
    artifacts: [{ record: artifact, bytes }],
    assets: [],
  };
  const original = await buildJsonRawManifestCompanion(bundle, sha256Hex, 'deepseek');
  const normalized = await normalizeDeepSeekCapture({
    bundle,
    artifactId: 'conversation',
    manifestSha256: await hashCaptureManifest(manifest),
    sha256: sha256Hex,
  });
  const companion = await appendJsonCanonicalCompanion(
    original,
    normalized.archive,
    sha256Hex,
    'deepseek'
  );
  return {
    companion,
    context: { rawCaptureBundle: bundle, rawArtifact: companion.artifacts[0] },
  };
}

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

function mockMessages(): void {
  mocks.sendMessage.mockImplementation(
    (message: { action: string; outputs?: OutputDestination[] }) => {
      if (message.action === 'getSettings') return Promise.resolve(settings);
      if (message.action === 'testConnection') return Promise.resolve({ success: true });
      if (
        message.action === 'saveToOutputs' ||
        message.action === 'persistArchiveCompanion' ||
        message.action === 'commitStagedArchiveCompanion'
      ) {
        const outputs = message.outputs ?? ['file'];
        return Promise.resolve({
          results: outputs.map(destination => ({ destination, success: true })),
          allSuccessful: true,
          anySuccessful: true,
        } satisfies MultiOutputResponse);
      }
      return Promise.reject(new Error(`unexpected background message: ${message.action}`));
    }
  );
}

describe('DeepSeek attachment bootstrap gate', () => {
  beforeEach(async () => {
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
    ({ companion, context } = await capture());
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

  it.each(['file', 'obsidian'] as const)(
    'saves the original companion and Markdown without an attachment rebuild for an empty ledger: %s',
    async destination => {
      ({ companion, context } = await capture('empty'));
      const empty = result();
      settings.outputOptions = {
        obsidian: destination === 'obsidian',
        file: destination === 'file',
        clipboard: false,
      };
      mocks.extract.mockResolvedValue(empty);

      vi.useFakeTimers();
      try {
        const note = conversationToNote(empty.data!, settings.templateOptions);
        await handleSync();

        expect(context.rawCaptureBundle.manifest.assets).toEqual([]);
        expect(mocks.attachmentExport).not.toHaveBeenCalled();
        expect(mocks.sendMessage.mock.calls.map(call => call[0])).toEqual([
          { action: 'getSettings' },
          ...(destination === 'obsidian' ? [{ action: 'testConnection' }] : []),
          ...companion.artifacts.map(artifact => ({
            action: 'persistArchiveCompanion',
            noteFileName: note.fileName,
            source: 'deepseek',
            captureId: companion.captureId,
            conversationKey: companion.conversationKey,
            artifact,
            outputs: [destination],
          })),
          { action: 'saveToOutputs', data: note, outputs: [destination] },
        ]);
        expect(mocks.showErrorToast).not.toHaveBeenCalled();
        expect(mocks.showWarningToast).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it('retains the inventory warning when an empty ledger has unknown completeness', async () => {
    ({ companion, context } = await capture('malformed'));
    const unknown = result();
    unknown.warnings = [...context.rawCaptureBundle.manifest.warnings];
    mocks.extract.mockResolvedValue(unknown);
    vi.useFakeTimers();
    try {
      const note = conversationToNote(unknown.data!, settings.templateOptions);
      await handleSync();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(context.rawCaptureBundle.manifest.assets).toEqual([]);
      expect(context.rawCaptureBundle.manifest.completeness.assets).toBe('unknown');
      expect(mocks.attachmentExport).not.toHaveBeenCalled();
      expect(mocks.sendMessage).toHaveBeenCalledWith({
        action: 'saveToOutputs',
        data: note,
        outputs: ['file'],
      });
      expect(mocks.showWarningToast).toHaveBeenCalledWith(
        'deepseek-attachment-inventory-unavailable'
      );
      expect(mocks.showErrorToast).not.toHaveBeenCalled();
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

  it.each(['inline', 'staged'] as const)(
    'persists %s failed-extraction evidence as DeepSeek before validation, without Markdown/binary',
    async transport => {
      const raw =
        transport === 'inline'
          ? companion.artifacts[0]
          : {
              transport: 'staged' as const,
              kind: 'raw' as const,
              stageId: `archive-stage-${'D'.repeat(32)}`,
              relativePath: 'responses/conversation.json',
              mediaType: 'application/json' as const,
              byteLength: 20 * 1024 * 1024,
              sha256: 'b'.repeat(64),
            };
      const partial: ArchiveCompanionBundle = {
        ...companion,
        artifacts: [raw, companion.artifacts[1]],
      };
      mocks.extract.mockResolvedValue({
        success: false,
        error: 'No messages found in conversation',
        archiveCompanion: partial,
      } satisfies ExtractionResult);
      mocks.validate.mockReturnValue({
        isValid: false,
        warnings: [],
        errors: ['No messages found in conversation'],
      });

      await handleSync();

      expect(mocks.sendMessage.mock.calls.map(call => call[0])).toEqual([
        { action: 'getSettings' },
        expect.objectContaining({
          action:
            transport === 'staged' ? 'commitStagedArchiveCompanion' : 'persistArchiveCompanion',
          source: 'deepseek',
          noteFileName: 'deepseek-capture.md',
          artifact: raw,
          outputs: ['file'],
        }),
        expect.objectContaining({
          action: 'persistArchiveCompanion',
          source: 'deepseek',
          noteFileName: 'deepseek-capture.md',
          artifact: companion.artifacts[1],
          outputs: ['file'],
        }),
      ]);
      expect(mocks.sendMessage.mock.invocationCallOrder.at(-1)).toBeLessThan(
        mocks.validate.mock.invocationCallOrder[0]
      );
      expect(mocks.attachmentExport).not.toHaveBeenCalled();
      expect(mocks.showErrorToast).toHaveBeenCalledWith(
        'No messages found in conversation. Verified raw capture evidence was saved locally.'
      );
    }
  );
});

afterAll(() => resetLocation());
