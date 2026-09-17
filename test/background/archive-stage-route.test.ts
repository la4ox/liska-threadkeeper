import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ARCHIVE_STAGE_RELATIVE_PATHS } from '../../src/lib/archive-stage-contract';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  migrateSettings: vi.fn(),
  handleArchiveStageMessage: vi.fn(),
  startArchiveStageDownloadRecovery: vi.fn(),
}));

vi.mock('../../src/lib/storage', () => ({
  getSettings: (...args: unknown[]) => mocks.getSettings(...args),
  migrateSettings: (...args: unknown[]) => mocks.migrateSettings(...args),
  saveSettings: vi.fn(),
}));

vi.mock('../../src/background/archive-stage-handlers', () => ({
  handleArchiveStageMessage: (...args: unknown[]) => mocks.handleArchiveStageMessage(...args),
}));

vi.mock('../../src/background/archive-stage-download-recovery', () => ({
  startArchiveStageDownloadRecovery: (...args: unknown[]) =>
    mocks.startArchiveStageDownloadRecovery(...args),
}));

let capturedListener: (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean | undefined;

const stageId = `archive-stage-${'A'.repeat(32)}`;
const beginMessage = {
  action: 'beginStagedArchiveArtifact' as const,
  source: 'chatgpt' as const,
  descriptor: {
    kind: 'raw' as const,
    mediaType: 'application/json' as const,
    relativePath: ARCHIVE_STAGE_RELATIVE_PATHS.raw,
    byteLength: 0,
    sha256: 'a'.repeat(64),
  },
};

describe('archive-stage service-worker route', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.migrateSettings.mockResolvedValue(undefined);
    mocks.handleArchiveStageMessage.mockResolvedValue({ success: true, stageId });
    vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation(listener => {
      capturedListener = listener;
    });
    vi.resetModules();
    await import('../../src/background/service-worker');
  });

  it('registers archive download recovery during synchronous worker evaluation', () => {
    expect(mocks.startArchiveStageDownloadRecovery).toHaveBeenCalledOnce();
  });

  it('routes a valid ChatGPT content-script stage request to the archive handler', async () => {
    const sendResponse = vi.fn();

    expect(
      capturedListener(
        beginMessage,
        {
          tab: { url: 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd' },
          frameId: 0,
          url: 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd',
        } as chrome.runtime.MessageSender,
        sendResponse
      )
    ).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ success: true, stageId }));

    expect(mocks.handleArchiveStageMessage).toHaveBeenCalledWith(beginMessage);
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it('rejects archive-stage requests from an extension page or a non-ChatGPT tab before dispatch', () => {
    const popupResponse = vi.fn();
    capturedListener(
      beginMessage,
      {
        id: chrome.runtime.id,
        url: chrome.runtime.getURL('src/popup/index.html'),
      } as chrome.runtime.MessageSender,
      popupResponse
    );
    expect(popupResponse).toHaveBeenCalledWith({ success: false, error: 'Unauthorized' });

    const foreignResponse = vi.fn();
    capturedListener(
      beginMessage,
      {
        tab: { url: 'https://example.test/c/synthetic' },
        frameId: 0,
        url: 'https://example.test/c/synthetic',
      } as chrome.runtime.MessageSender,
      foreignResponse
    );
    expect(foreignResponse).toHaveBeenCalledWith({ success: false, error: 'Unauthorized' });
    expect(mocks.handleArchiveStageMessage).not.toHaveBeenCalled();
  });

  it('keeps staged-binary capabilities unavailable to extension pages', () => {
    const sendResponse = vi.fn();
    const returned = capturedListener(
      {
        action: 'beginStagedBinaryAsset',
        source: 'chatgpt',
        stageId: `stage-${'A'.repeat(32)}`,
        descriptor: {
          assetId: `chatgpt-asset-${'a'.repeat(64)}`,
          byteLength: 0,
          sha256: 'b'.repeat(64),
          mediaType: 'application/octet-stream',
          relativePath: `assets/${'b'.repeat(64)}.bin`,
        },
      },
      {
        id: chrome.runtime.id,
        url: chrome.runtime.getURL('src/popup/index.html'),
      } as chrome.runtime.MessageSender,
      sendResponse
    );
    expect(returned).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Unauthorized' });
  });
});
