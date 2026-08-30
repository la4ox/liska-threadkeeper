import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ExtensionMessage,
  ExtensionSettings,
  StagedBinaryAssetDescriptor,
} from '../../src/lib/types';

const mocks = vi.hoisted(() => ({
  acquireLease: vi.fn(),
  downloadArchiveBlob: vi.fn(),
  saveStagedBinaryAsset: vi.fn(),
}));

vi.mock('../../src/background/output-handlers', () => ({
  acquireOffscreenLeaseForStagedBinaryAsset: (...args: unknown[]) => mocks.acquireLease(...args),
  downloadArchiveBlob: (...args: unknown[]) => mocks.downloadArchiveBlob(...args),
}));

vi.mock('../../src/background/obsidian-handlers', () => ({
  handleSaveStagedBinaryAsset: (...args: unknown[]) => mocks.saveStagedBinaryAsset(...args),
}));

import { handleStagedBinaryAssetMessage } from '../../src/background/binary-asset-handlers';
import {
  reconcileStagedBinaryDownloadRecovery,
  startStagedBinaryDownloadRecovery,
} from '../../src/background/binary-download-recovery';

const stageId = `stage-${'A'.repeat(32)}`;
const descriptor: StagedBinaryAssetDescriptor = {
  assetId: `chatgpt-asset-${'a'.repeat(64)}`,
  byteLength: 3,
  sha256: 'a'.repeat(64),
  mediaType: 'application/octet-stream',
  relativePath: `assets/${'a'.repeat(64)}.bin`,
};
const settings = {} as ExtensionSettings;
const RECOVERY_STORAGE_KEY = 'binary-stage-download-recovery-v1';
let recoveryOnChanged: ((delta: chrome.downloads.DownloadDelta) => void) | undefined;

function commitMessage(
  outputs: ('file' | 'obsidian')[]
): Extract<ExtensionMessage, { action: 'commitStagedBinaryAsset' }> {
  return {
    action: 'commitStagedBinaryAsset',
    source: 'chatgpt',
    stageId,
    captureId: 'capture-chatgpt-11111111-2222-4333-8444-555555555555',
    conversationKey: 'c'.repeat(64),
    descriptor,
    outputs,
  };
}

function shortMessage(
  action: 'beginStagedBinaryAsset' | 'appendStagedBinaryAsset' | 'abortStagedBinaryAsset'
): Extract<ExtensionMessage, { action: typeof action }> {
  if (action === 'beginStagedBinaryAsset') {
    return { action, source: 'chatgpt', stageId, descriptor } as Extract<
      ExtensionMessage,
      { action: typeof action }
    >;
  }
  if (action === 'appendStagedBinaryAsset') {
    return { action, source: 'chatgpt', stageId, offset: 0, chunkBase64: 'AQ==' } as Extract<
      ExtensionMessage,
      { action: typeof action }
    >;
  }
  return { action, source: 'chatgpt', stageId } as Extract<
    ExtensionMessage,
    { action: typeof action }
  >;
}

function installLease(): ReturnType<typeof vi.fn> {
  const release = vi.fn();
  mocks.acquireLease.mockResolvedValue({ release });
  return release;
}

function installRecoveryStorage(): Record<string, unknown> {
  const store: Record<string, unknown> = {};
  vi.mocked(chrome.storage.local.get).mockImplementation(
    (key: string | string[] | Record<string, unknown> | null) => {
      if (typeof key === 'string') return Promise.resolve({ [key]: store[key] });
      return Promise.resolve({});
    }
  );
  vi.mocked(chrome.storage.local.set).mockImplementation((items: Record<string, unknown>) => {
    Object.assign(store, items);
    return Promise.resolve();
  });
  return store;
}

function finalizedResponses(release: unknown = { success: true }): void {
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(request => {
    switch ((request as { action?: string }).action) {
      case 'binaryStageFinalize':
        return Promise.resolve({
          success: true,
          url: 'blob:chrome-extension://test-extension-id/stage',
        });
      case 'binaryStageRelease':
        return Promise.resolve(release);
      case 'binaryStageAbort':
        return Promise.resolve({ success: true });
      default:
        return Promise.resolve(undefined);
    }
  });
}

describe('staged binary background handler coverage', () => {
  beforeEach(() => {
    mocks.acquireLease.mockReset();
    mocks.downloadArchiveBlob.mockReset();
    mocks.saveStagedBinaryAsset.mockReset();
    vi.mocked(chrome.runtime.sendMessage).mockReset();
    vi.mocked(chrome.downloads.search).mockReset();
    installRecoveryStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails closed for malformed begin and append replies, while releasing each short lease', async () => {
    const release = installLease();
    vi.mocked(chrome.runtime.sendMessage)
      .mockResolvedValueOnce({ success: 'yes' })
      .mockRejectedValueOnce(new Error('offscreen disconnected'));

    await expect(
      handleStagedBinaryAssetMessage(shortMessage('beginStagedBinaryAsset'), settings)
    ).resolves.toEqual({ success: false, error: 'Binary stage operation failed' });
    await expect(
      handleStagedBinaryAssetMessage(shortMessage('appendStagedBinaryAsset'), settings)
    ).resolves.toEqual({ success: false, error: 'Binary stage operation failed' });

    expect(release).toHaveBeenCalledTimes(2);
    expect(chrome.runtime.sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ action: 'binaryStageBegin', stageId, descriptor })
    );
    expect(chrome.runtime.sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'binaryStageAppend',
        stageId,
        offset: 0,
        chunkBase64: 'AQ==',
      })
    );
  });

  it('bounds a stalled stage request by its message timeout and releases the short lease', async () => {
    vi.useFakeTimers();
    const release = installLease();
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      () => new Promise<never>(() => undefined)
    );

    const pending = handleStagedBinaryAssetMessage(
      shortMessage('beginStagedBinaryAsset'),
      settings
    );
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toEqual({
      success: false,
      error: 'Binary stage operation failed',
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it('reports an abort whose exact cleanup was not confirmed', async () => {
    const release = installLease();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: false, error: 'busy' });

    await expect(
      handleStagedBinaryAssetMessage(shortMessage('abortStagedBinaryAsset'), settings)
    ).resolves.toEqual({ success: false, error: 'binary-stage-cleanup-deferred' });
    expect(release).toHaveBeenCalledOnce();
  });

  it('persists file and Obsidian siblings independently after finalization', async () => {
    const release = installLease();
    finalizedResponses();
    mocks.downloadArchiveBlob.mockResolvedValue({ error: null, terminal: true, downloadId: 71 });
    mocks.saveStagedBinaryAsset.mockResolvedValue({ success: true });
    vi.mocked(chrome.downloads.search).mockResolvedValue([
      {
        id: 71,
        filename: `Downloads/_liska-archive/${'c'.repeat(64)}/capture-chatgpt-11111111-2222-4333-8444-555555555555/${descriptor.relativePath}`,
      } as chrome.downloads.DownloadItem,
    ]);

    await expect(
      handleStagedBinaryAssetMessage(commitMessage(['file', 'obsidian']), settings)
    ).resolves.toEqual({
      results: [
        { destination: 'file', success: true },
        { destination: 'obsidian', success: true },
      ],
      allSuccessful: true,
      anySuccessful: true,
    });
    expect(mocks.downloadArchiveBlob).toHaveBeenCalledWith(
      'blob:chrome-extension://test-extension-id/stage',
      expect.stringContaining(descriptor.relativePath),
      expect.any(Function),
      expect.any(Function)
    );
    expect(mocks.saveStagedBinaryAsset).toHaveBeenCalledWith(
      settings,
      expect.objectContaining({
        descriptor,
        blobUrl: 'blob:chrome-extension://test-extension-id/stage',
      })
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it('keeps sibling failures specific for an interrupted download and rejected Obsidian write', async () => {
    installLease();
    finalizedResponses();
    mocks.downloadArchiveBlob.mockResolvedValue({
      error: 'Archive download was interrupted',
      terminal: true,
      downloadId: 72,
    });
    mocks.saveStagedBinaryAsset.mockRejectedValue(new Error('vault unavailable'));

    await expect(
      handleStagedBinaryAssetMessage(commitMessage(['file', 'obsidian']), settings)
    ).resolves.toEqual({
      results: [
        { destination: 'file', success: false, error: 'binary-download-interrupted' },
        { destination: 'obsidian', success: false, error: 'binary-obsidian-write-failed' },
      ],
      allSuccessful: false,
      anySuccessful: false,
    });
  });

  it('latches a late terminal download callback until destinations finish, then releases its exact stage', async () => {
    const release = installLease();
    finalizedResponses();
    mocks.downloadArchiveBlob.mockImplementation(async (_url, _path, onLateTerminal) => {
      await onLateTerminal();
      return { error: null, terminal: false, downloadId: 72 };
    });
    vi.mocked(chrome.downloads.search).mockResolvedValue([
      {
        id: 72,
        filename: `Downloads/_liska-archive/${'c'.repeat(64)}/capture-chatgpt-11111111-2222-4333-8444-555555555555/${descriptor.relativePath}`,
      } as chrome.downloads.DownloadItem,
    ]);

    await expect(
      handleStagedBinaryAssetMessage(commitMessage(['file']), settings)
    ).resolves.toEqual({
      results: [{ destination: 'file', success: false, error: 'binary-download-path-unconfirmed' }],
      allSuccessful: false,
      anySuccessful: false,
    });
    expect(release).toHaveBeenCalledOnce();
    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({ [RECOVERY_STORAGE_KEY]: [] });
  });

  it('warns when an unconfirmed download cannot durably register cleanup ownership', async () => {
    installLease();
    finalizedResponses();
    mocks.downloadArchiveBlob.mockResolvedValue({ error: null, terminal: false, downloadId: 74 });
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(
      handleStagedBinaryAssetMessage(commitMessage(['file']), settings)
    ).resolves.toEqual({
      results: [
        {
          destination: 'file',
          success: false,
          error: 'binary-download-path-unconfirmed',
          warning: 'binary-stage-cleanup-deferred',
        },
      ],
      allSuccessful: false,
      anySuccessful: false,
    });
  });

  it('persists provisional ownership before a timeout returns without a Downloads ID', async () => {
    const store = installRecoveryStorage();
    installLease();
    finalizedResponses();
    mocks.downloadArchiveBlob.mockImplementation(async () => {
      expect(store[RECOVERY_STORAGE_KEY]).toEqual([
        expect.objectContaining({
          downloadId: null,
          stageId,
          blobUrl: 'blob:chrome-extension://test-extension-id/stage',
        }),
      ]);
      return { error: 'Archive download did not complete', terminal: false };
    });

    await expect(
      handleStagedBinaryAssetMessage(commitMessage(['file']), settings)
    ).resolves.toEqual({
      results: [{ destination: 'file', success: false, error: 'binary-download-failed' }],
      allSuccessful: false,
      anySuccessful: false,
    });
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([expect.objectContaining({ downloadId: null })]);
    expect(mocks.downloadArchiveBlob).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('atomically assigns the callback ID before a late terminal cleanup', async () => {
    const store = installRecoveryStorage();
    const release = installLease();
    finalizedResponses();
    mocks.downloadArchiveBlob.mockImplementation(
      async (_url, _path, onLateTerminal, onDownloadId) => {
        await onDownloadId(76);
        await onLateTerminal();
        return { error: null, terminal: false, downloadId: 76 };
      }
    );

    await expect(
      handleStagedBinaryAssetMessage(commitMessage(['file']), settings)
    ).resolves.toEqual({
      results: [{ destination: 'file', success: false, error: 'binary-download-path-unconfirmed' }],
      allSuccessful: false,
      anySuccessful: false,
    });
    const writes = vi.mocked(chrome.storage.local.set).mock.calls;
    expect(writes[0]).toEqual([
      { [RECOVERY_STORAGE_KEY]: [expect.objectContaining({ downloadId: null, stageId })] },
    ]);
    expect(writes[1]).toEqual([
      { [RECOVERY_STORAGE_KEY]: [expect.objectContaining({ downloadId: 76, stageId })] },
    ]);
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('keeps numeric recovery active while a terminal delta races a blocked Obsidian sibling', async () => {
    const store = installRecoveryStorage();
    const release = installLease();
    finalizedResponses();
    let finishObsidian!: () => void;
    mocks.saveStagedBinaryAsset.mockImplementation(
      () =>
        new Promise(resolve => {
          finishObsidian = () => resolve({ success: true });
        })
    );
    vi.mocked(chrome.downloads.onChanged.addListener).mockImplementation(listener => {
      recoveryOnChanged = listener;
    });
    startStagedBinaryDownloadRecovery();
    vi.mocked(chrome.downloads.search).mockResolvedValue([
      {
        id: 81,
        filename: `Downloads/_liska-archive/${'c'.repeat(64)}/capture-chatgpt-11111111-2222-4333-8444-555555555555/${descriptor.relativePath}`,
      } as chrome.downloads.DownloadItem,
    ]);
    mocks.downloadArchiveBlob.mockImplementation(
      async (_url, _path, _onLateTerminal, onDownloadId) => {
        await onDownloadId(81);
        recoveryOnChanged?.({ id: 81, state: { current: 'complete' } });
        await Promise.resolve();
        await Promise.resolve();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
          expect.objectContaining({ action: 'binaryStageRelease' })
        );
        return { error: null, terminal: true, downloadId: 81 };
      }
    );

    const pending = handleStagedBinaryAssetMessage(commitMessage(['file', 'obsidian']), settings);
    await vi.waitFor(() => expect(mocks.saveStagedBinaryAsset).toHaveBeenCalledOnce());
    expect(release).not.toHaveBeenCalled();

    finishObsidian();

    await expect(pending).resolves.toEqual({
      results: [
        { destination: 'file', success: true },
        { destination: 'obsidian', success: true },
      ],
      allSuccessful: true,
      anySuccessful: true,
    });
    expect(release).toHaveBeenCalledOnce();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([]);
  });

  it('keeps a failed ID assignment active through unrelated terminal reconciliation, then cleans directly', async () => {
    const store = installRecoveryStorage();
    let storageWrites = 0;
    vi.mocked(chrome.storage.local.set).mockImplementation((items: Record<string, unknown>) => {
      storageWrites += 1;
      if (storageWrites === 2) return Promise.reject(new Error('assignment storage unavailable'));
      Object.assign(store, items);
      return Promise.resolve();
    });
    const release = installLease();
    finalizedResponses();
    mocks.downloadArchiveBlob.mockImplementation(
      async (_url, _path, onLateTerminal, onDownloadId) => {
        await onDownloadId(82);
        if (recoveryOnChanged) {
          recoveryOnChanged({ id: 999, state: { current: 'complete' } });
        } else {
          await reconcileStagedBinaryDownloadRecovery();
        }
        await Promise.resolve();
        await Promise.resolve();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
          expect.objectContaining({ action: 'binaryStageRelease' })
        );
        await onLateTerminal();
        return { error: null, terminal: false, downloadId: 82 };
      }
    );

    await expect(
      handleStagedBinaryAssetMessage(commitMessage(['file']), settings)
    ).resolves.toEqual({
      results: [
        {
          destination: 'file',
          success: false,
          error: 'binary-download-path-unconfirmed',
          warning: 'binary-stage-cleanup-deferred',
        },
      ],
      allSuccessful: false,
      anySuccessful: false,
    });
    expect(release).toHaveBeenCalledOnce();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([]);
  });

  it('relinquishes durable ownership after unconfirmed terminal cleanup so recovery can retry', async () => {
    const store = installRecoveryStorage();
    const firstLeaseRelease = installLease();
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(request => {
      const action = (request as { action?: string }).action;
      if (action === 'binaryStageFinalize') {
        return Promise.resolve({
          success: true,
          url: 'blob:chrome-extension://test-extension-id/stage',
        });
      }
      return Promise.resolve({ success: false });
    });
    vi.mocked(chrome.downloads.search).mockResolvedValue([
      {
        id: 83,
        state: 'complete',
        filename: `Downloads/_liska-archive/${'c'.repeat(64)}/capture-chatgpt-11111111-2222-4333-8444-555555555555/${descriptor.relativePath}`,
      } as chrome.downloads.DownloadItem,
    ]);
    mocks.downloadArchiveBlob.mockImplementation(
      async (_url, _path, _onLateTerminal, onDownloadId) => {
        await onDownloadId(83);
        return { error: null, terminal: true, downloadId: 83 };
      }
    );

    await expect(
      handleStagedBinaryAssetMessage(commitMessage(['file']), settings)
    ).resolves.toEqual({
      results: [
        {
          destination: 'file',
          success: true,
          warning: 'binary-stage-cleanup-deferred',
        },
      ],
      allSuccessful: true,
      anySuccessful: true,
    });
    expect(firstLeaseRelease).toHaveBeenCalledOnce();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([
      expect.objectContaining({ downloadId: 83, stageId }),
    ]);

    const retryRelease = vi.fn();
    mocks.acquireLease.mockResolvedValue({ release: retryRelease });
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(request => {
      return Promise.resolve({
        success: (request as { action?: string }).action === 'binaryStageRelease',
      });
    });
    await reconcileStagedBinaryDownloadRecovery();

    expect(store[RECOVERY_STORAGE_KEY]).toEqual([]);
    expect(retryRelease).toHaveBeenCalledOnce();
  });

  it('fails a download start and an unconfirmed download path without claiming persistence', async () => {
    installLease();
    finalizedResponses();
    mocks.downloadArchiveBlob.mockRejectedValueOnce(new Error('start refused'));

    await expect(
      handleStagedBinaryAssetMessage(commitMessage(['file']), settings)
    ).resolves.toEqual({
      results: [{ destination: 'file', success: false, error: 'binary-download-start-failed' }],
      allSuccessful: false,
      anySuccessful: false,
    });

    installLease();
    finalizedResponses();
    mocks.downloadArchiveBlob.mockResolvedValueOnce({
      error: null,
      terminal: true,
      downloadId: 73,
    });
    vi.mocked(chrome.downloads.search).mockRejectedValueOnce(new Error('search unavailable'));

    await expect(
      handleStagedBinaryAssetMessage(commitMessage(['file']), settings)
    ).resolves.toEqual({
      results: [{ destination: 'file', success: false, error: 'binary-download-path-unconfirmed' }],
      allSuccessful: false,
      anySuccessful: false,
    });
  });

  it('uses the exact abort fallback after a failed release and warns only when fallback is unconfirmed', async () => {
    const release = installLease();
    finalizedResponses({ success: false });
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(request => {
      const action = (request as { action?: string }).action;
      if (action === 'binaryStageFinalize') {
        return Promise.resolve({
          success: true,
          url: 'blob:chrome-extension://test-extension-id/stage',
        });
      }
      if (action === 'binaryStageRelease' || action === 'binaryStageAbort') {
        return Promise.resolve({ success: false });
      }
      return Promise.resolve(undefined);
    });
    mocks.saveStagedBinaryAsset.mockResolvedValue({ success: true });

    await expect(
      handleStagedBinaryAssetMessage(commitMessage(['obsidian']), settings)
    ).resolves.toEqual({
      results: [
        {
          destination: 'obsidian',
          success: true,
          warning: 'binary-stage-cleanup-deferred',
        },
      ],
      allSuccessful: true,
      anySuccessful: true,
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'binaryStageAbort', stageId })
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it('returns destination failures when finalization is malformed and bounded abort cleanup also fails', async () => {
    const release = installLease();
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(request => {
      return Promise.resolve(
        (request as { action?: string }).action === 'binaryStageFinalize'
          ? { success: true, url: 'https://not-an-extension-blob' }
          : { success: false }
      );
    });

    await expect(
      handleStagedBinaryAssetMessage(commitMessage(['file', 'obsidian']), settings)
    ).resolves.toEqual({
      results: [
        {
          destination: 'file',
          success: false,
          error: 'binary-stage-finalization-failed',
          warning: 'binary-stage-cleanup-deferred',
        },
        {
          destination: 'obsidian',
          success: false,
          error: 'binary-stage-finalization-failed',
          warning: 'binary-stage-cleanup-deferred',
        },
      ],
      allSuccessful: false,
      anySuccessful: false,
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it('turns an unexpected lease-release exception into a bounded finalization failure', async () => {
    const release = vi.fn(() => {
      throw new Error('lease bookkeeping failed');
    });
    mocks.acquireLease.mockResolvedValue({ release });
    finalizedResponses();
    mocks.saveStagedBinaryAsset.mockResolvedValue({ success: true });

    await expect(
      handleStagedBinaryAssetMessage(commitMessage(['obsidian']), settings)
    ).resolves.toEqual({
      results: [
        {
          destination: 'obsidian',
          success: false,
          error: 'binary-stage-finalization-failed',
          warning: 'binary-stage-cleanup-deferred',
        },
      ],
      allSuccessful: false,
      anySuccessful: false,
    });
    expect(release).toHaveBeenCalledOnce();
  });
});
