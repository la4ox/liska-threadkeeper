import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ArchiveCompanionBundle,
  ContentScriptSettings,
  ExtractionResult,
} from '../../src/lib/types';
import type { ClaimedContentExport } from '../../src/content/export-operation-client';
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
vi.mock('../../src/content/archive-stage', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/content/archive-stage')>()),
  abortStagedArchiveArtifact: vi.fn(),
}));

import { handleSync } from '../../src/content/bootstrap';
import { ChatGPTExtractor } from '../../src/content/extractors/chatgpt';
import { DeepSeekExtractor } from '../../src/content/extractors/deepseek';
import { claimedContentExport } from '../../src/content/export-operation-client';
import { abortStagedArchiveArtifact } from '../../src/content/archive-stage';
import {
  setButtonLoading,
  showErrorToast,
  showToast,
  showWarningToast,
} from '../../src/content/ui';
import { sendMessage } from '../../src/lib/messaging';
import { INFO_TOAST_DURATION } from '../../src/lib/constants';

const conversationId = '01234567-89ab-4cde-8f01-23456789abcd';
const settings: ContentScriptSettings = {
  obsidianUrl: 'http://127.0.0.1:27123',
  vaultPath: 'AI/{platform}',
  isApiKeyConfigured: true,
  enableAutoScroll: false,
  enableAppendMode: false,
  enableToolContent: false,
  outputOptions: { obsidian: true, file: false, clipboard: false },
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
  captureId: 'synthetic-capture',
  conversationKey: 'a'.repeat(64),
  artifacts: [
    {
      transport: 'staged',
      stageId: 'synthetic-stage',
      kind: 'raw',
      relativePath: 'responses/conversation.json',
      mediaType: 'application/json',
      byteLength: 2,
      sha256: 'b'.repeat(64),
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

function operation(): ClaimedContentExport {
  return {
    scope: {
      id: 'synthetic-operation',
      route: window.location.href,
      abort: new AbortController(),
      closed: false,
    },
    settings,
    selected: true,
  };
}

function actions(): string[] {
  return vi.mocked(sendMessage).mock.calls.map(([message]) => message.action);
}

describe('handleSync capture boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setChatGPTLocation(conversationId);
    vi.mocked(sendMessage).mockImplementation(message => {
      if (message.action === 'getSettings') return Promise.resolve(settings);
      if (message.action === 'testConnection') return Promise.resolve({ success: true });
      if (
        message.action === 'persistArchiveCompanion' ||
        message.action === 'commitStagedArchiveCompanion'
      )
        return Promise.resolve({
          results: [{ destination: 'obsidian', success: true }],
          allSuccessful: true,
          anySuccessful: true,
        });
      throw new Error(`Unexpected message: ${message.action}`);
    });
    vi.mocked(abortStagedArchiveArtifact).mockResolvedValue(undefined);
    vi.spyOn(ChatGPTExtractor.prototype, 'canExtract').mockReturnValue(true);
    vi.spyOn(ChatGPTExtractor.prototype, 'setBranchExportMode').mockImplementation(() => {});
    vi.spyOn(ChatGPTExtractor.prototype, 'applySettings').mockImplementation(() => {});
    vi.spyOn(ChatGPTExtractor.prototype, 'extract').mockResolvedValue({ success: false });
    vi.spyOn(ChatGPTExtractor.prototype, 'validate').mockReturnValue({
      isValid: false,
      errors: ['Synthetic validation failure'],
      warnings: [],
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetLocation();
  });

  it.each([undefined, 'selected'] as const)(
    'keeps preflight, mode, toast, settings, extraction and validation ordered for %s',
    async mode => {
      await handleSync(mode);

      const canExtract = vi.mocked(ChatGPTExtractor.prototype.canExtract);
      const setMode = vi.mocked(ChatGPTExtractor.prototype.setBranchExportMode);
      const applySettings = vi.mocked(ChatGPTExtractor.prototype.applySettings);
      const extract = vi.mocked(ChatGPTExtractor.prototype.extract);
      const validate = vi.mocked(ChatGPTExtractor.prototype.validate);
      expect(actions()).toEqual(['getSettings', 'testConnection']);
      expect(setMode).toHaveBeenCalledExactlyOnceWith(mode ?? 'current');
      expect(showToast).toHaveBeenCalledExactlyOnceWith(
        'Extracting conversation...',
        'info',
        INFO_TOAST_DURATION
      );
      expect(applySettings).toHaveBeenCalledExactlyOnceWith(settings);
      const snapshot = applySettings.mock.calls[0][0];
      expect(snapshot).not.toBe(settings);
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.templateOptions)).toBe(true);
      expect(Object.isFrozen(snapshot.outputOptions)).toBe(true);
      expect(extract).toHaveBeenCalledExactlyOnceWith();
      expect(validate).toHaveBeenCalledExactlyOnceWith({ success: false });
      const order = [
        vi.mocked(sendMessage).mock.invocationCallOrder[1],
        canExtract.mock.invocationCallOrder[1],
        setMode.mock.invocationCallOrder[0],
        vi.mocked(showToast).mock.invocationCallOrder[0],
        applySettings.mock.invocationCallOrder[0],
        extract.mock.invocationCallOrder[0],
        validate.mock.invocationCallOrder[0],
      ];
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(setButtonLoading).toHaveBeenNthCalledWith(1, true);
      expect(setButtonLoading).toHaveBeenLastCalledWith(false);
    }
  );

  it('does not start capture after a failed output preflight', async () => {
    vi.mocked(sendMessage).mockResolvedValueOnce(settings).mockResolvedValueOnce({
      success: false,
      error: 'Synthetic connection failure',
    });

    await handleSync('selected');

    expect(actions()).toEqual(['getSettings', 'testConnection']);
    expect(ChatGPTExtractor.prototype.setBranchExportMode).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(ChatGPTExtractor.prototype.applySettings).not.toHaveBeenCalled();
    expect(ChatGPTExtractor.prototype.extract).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalledExactlyOnceWith('Synthetic connection failure');
  });

  it.each(['abort', 'route'] as const)(
    'keeps the claimed-operation %s check after preflight and before capture',
    async reason => {
      const claimed = operation();
      vi.mocked(claimedContentExport).mockReturnValue(claimed);
      if (reason === 'abort') claimed.scope.abort.abort();
      else claimed.scope.route = 'https://chatgpt.com/c/another-conversation';

      await handleSync();

      expect(actions()).toEqual(['testConnection']);
      expect(ChatGPTExtractor.prototype.applySettings).not.toHaveBeenCalled();
      expect(ChatGPTExtractor.prototype.extract).not.toHaveBeenCalled();
      expect(showToast).not.toHaveBeenCalled();
      expect(showErrorToast).not.toHaveBeenCalled();
      expect(setButtonLoading).toHaveBeenLastCalledWith(false);
    }
  );

  it.each(['settings', 'synchronous extraction', 'rejected extraction'] as const)(
    'preserves the error stage for %s failure',
    async failure => {
      const error = new Error('Synthetic capture failure');
      if (failure === 'settings')
        vi.mocked(ChatGPTExtractor.prototype.applySettings).mockImplementation(() => {
          throw error;
        });
      else if (failure === 'synchronous extraction')
        vi.mocked(ChatGPTExtractor.prototype.extract).mockImplementation(() => {
          throw error;
        });
      else vi.mocked(ChatGPTExtractor.prototype.extract).mockRejectedValue(error);

      await handleSync();

      const stage =
        failure === 'settings' ? 'checking output configuration' : 'extracting the conversation';
      expect(actions()).toEqual(['getSettings', 'testConnection']);
      expect(showErrorToast).toHaveBeenCalledExactlyOnceWith(
        `Failed while ${stage}: Synthetic capture failure`
      );
      expect(console.error).toHaveBeenCalledWith(`[G2O] Sync error while ${stage}:`, error);
      expect(ChatGPTExtractor.prototype.validate).not.toHaveBeenCalled();
      expect(setButtonLoading).toHaveBeenLastCalledWith(false);
    }
  );

  it.each(['cancelled result', 'abort', 'route', 'unselected', 'failed selection'] as const)(
    'discards staged capture without persistence or validation after %s',
    async reason => {
      const claimed = operation();
      vi.mocked(claimedContentExport).mockReturnValue(claimed);
      const result: ExtractionResult = {
        success: reason !== 'failed selection',
        archiveCompanion: companion,
        ...(reason === 'cancelled result' && { cancelled: true }),
      };
      let resolveExtraction!: (value: ExtractionResult) => void;
      vi.mocked(ChatGPTExtractor.prototype.extract).mockImplementation(
        () => new Promise(resolve => (resolveExtraction = resolve))
      );
      const selected = reason === 'unselected' || reason === 'failed selection';
      const pending = handleSync(selected ? 'selected' : 'current');
      await vi.waitFor(() => expect(ChatGPTExtractor.prototype.extract).toHaveBeenCalledOnce());
      if (reason === 'abort') claimed.scope.abort.abort();
      if (reason === 'route') setChatGPTLocation('another-conversation');
      if (reason === 'unselected') claimed.selected = false;
      let finishCleanup!: () => void;
      vi.mocked(abortStagedArchiveArtifact).mockImplementation(
        () => new Promise(resolve => (finishCleanup = resolve))
      );
      resolveExtraction(result);
      await vi.waitFor(() => expect(abortStagedArchiveArtifact).toHaveBeenCalledOnce());
      expect(setButtonLoading).not.toHaveBeenCalledWith(false);
      expect(showWarningToast).not.toHaveBeenCalled();
      finishCleanup();
      await pending;

      expect(abortStagedArchiveArtifact).toHaveBeenCalledExactlyOnceWith(
        'synthetic-stage',
        'chatgpt'
      );
      expect(actions()).toEqual(['testConnection']);
      expect(ChatGPTExtractor.prototype.validate).not.toHaveBeenCalled();
      expect(showErrorToast).not.toHaveBeenCalled();
      if (selected)
        expect(showWarningToast).toHaveBeenCalledExactlyOnceWith(
          'Branch preparation ended without an export choice. Nothing was saved.'
        );
      else expect(showWarningToast).not.toHaveBeenCalled();
      expect(setButtonLoading).toHaveBeenLastCalledWith(false);
    }
  );

  it('still preserves failed raw/manifest evidence before validating the same extraction result', async () => {
    const result: ExtractionResult = { success: false, archiveCompanion: companion };
    vi.mocked(ChatGPTExtractor.prototype.extract).mockResolvedValue(result);

    await handleSync();

    expect(actions()).toEqual([
      'getSettings',
      'testConnection',
      'commitStagedArchiveCompanion',
      'persistArchiveCompanion',
    ]);
    expect(
      vi
        .mocked(sendMessage)
        .mock.calls.slice(2)
        .map(([message]) => message)
    ).toEqual([
      expect.objectContaining({
        source: 'chatgpt',
        artifact: companion.artifacts[0],
        outputs: ['obsidian'],
      }),
      expect.objectContaining({
        source: 'chatgpt',
        artifact: companion.artifacts[1],
        outputs: ['obsidian'],
      }),
    ]);
    expect(ChatGPTExtractor.prototype.validate).toHaveBeenCalledExactlyOnceWith(result);
    expect(vi.mocked(sendMessage).mock.invocationCallOrder[3]).toBeLessThan(
      vi.mocked(ChatGPTExtractor.prototype.validate).mock.invocationCallOrder[0]
    );
    expect(abortStagedArchiveArtifact).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalledExactlyOnceWith(
      'Synthetic validation failure. Verified raw capture evidence was saved locally.'
    );
  });

  it('snapshots DeepSeek identity after settings and before extraction, then rejects navigation before cancellation', async () => {
    setNonGeminiLocation('chat.deepseek.com', '/a/chat/s/synthetic-conversation');
    vi.spyOn(DeepSeekExtractor.prototype, 'canExtract').mockReturnValue(true);
    const applySettings = vi
      .spyOn(DeepSeekExtractor.prototype, 'applySettings')
      .mockImplementation(() => {});
    const identity = vi
      .spyOn(DeepSeekExtractor.prototype, 'getConversationId')
      .mockReturnValue('synthetic-conversation');
    const validate = vi.spyOn(DeepSeekExtractor.prototype, 'validate');
    const extract = vi
      .spyOn(DeepSeekExtractor.prototype, 'extract')
      .mockImplementation(async () => {
        expect(identity).toHaveBeenCalledOnce();
        setNonGeminiLocation('chat.deepseek.com', '/a/chat/s/another-conversation');
        return { success: false, cancelled: true, archiveCompanion: companion };
      });

    await handleSync();

    expect(applySettings.mock.invocationCallOrder[0]).toBeLessThan(
      identity.mock.invocationCallOrder[0]
    );
    expect(identity.mock.invocationCallOrder[0]).toBeLessThan(extract.mock.invocationCallOrder[0]);
    expect(ChatGPTExtractor.prototype.setBranchExportMode).not.toHaveBeenCalled();
    expect(abortStagedArchiveArtifact).toHaveBeenCalledExactlyOnceWith(
      'synthetic-stage',
      'deepseek'
    );
    expect(showErrorToast).toHaveBeenCalledExactlyOnceWith(
      'Conversation changed during extraction. No output was created.'
    );
    expect(validate).not.toHaveBeenCalled();
    expect(actions()).toEqual(['getSettings', 'testConnection']);
  });
});
