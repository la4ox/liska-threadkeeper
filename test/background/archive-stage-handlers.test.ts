import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARCHIVE_STAGE_RELATIVE_PATHS,
  type ArchiveStageDescriptor,
} from '../../src/lib/archive-stage-contract';
import type {
  ExtensionMessage,
  ExtensionSettings,
  StagedArchiveCompanionArtifact,
} from '../../src/lib/types';

const mocks = vi.hoisted(() => ({
  acquireLease: vi.fn(),
  downloadArchiveBlob: vi.fn(),
  saveStagedArchive: vi.fn(),
}));

vi.mock('../../src/background/output-handlers', () => ({
  acquireOffscreenLeaseForArchiveStage: (...args: unknown[]) => mocks.acquireLease(...args),
  downloadArchiveBlob: (...args: unknown[]) => mocks.downloadArchiveBlob(...args),
}));

vi.mock('../../src/background/obsidian-handlers', () => ({
  handleSaveStagedArchiveCompanion: (...args: unknown[]) => mocks.saveStagedArchive(...args),
}));

import { handleArchiveStageMessage } from '../../src/background/archive-stage-handlers';
import { startArchiveStageDownloadRecovery } from '../../src/background/archive-stage-download-recovery';

const stageId = `archive-stage-${'A'.repeat(32)}`;
const settings = {} as ExtensionSettings;
const captureId = 'capture-chatgpt-11111111-2222-4333-8444-555555555555';
const conversationKey = 'c'.repeat(64);

function descriptorFor(kind: 'raw' | 'canonical'): ArchiveStageDescriptor {
  return {
    kind,
    mediaType: 'application/json',
    relativePath: ARCHIVE_STAGE_RELATIVE_PATHS[kind],
    byteLength: 3,
    sha256: 'a'.repeat(64),
  };
}

function artifactFor(kind: 'raw' | 'canonical'): StagedArchiveCompanionArtifact {
  return { transport: 'staged', stageId, ...descriptorFor(kind) };
}

function commitMessage(
  kind: 'raw' | 'canonical',
  outputs: ('file' | 'obsidian')[]
): Extract<ExtensionMessage, { action: 'commitStagedArchiveCompanion' }> {
  return {
    action: 'commitStagedArchiveCompanion',
    source: 'chatgpt',
    noteFileName: 'synthetic.md',
    captureId,
    conversationKey,
    artifact: artifactFor(kind),
    outputs,
  };
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

function installStageUrlResponses(
  url = 'blob:chrome-extension://test-extension-id/archive-stage'
): void {
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(request => {
    const action = (request as { action?: string }).action;
    if (action === 'archiveStageCreateUrl') return Promise.resolve({ success: true, url });
    if (action === 'archiveStageRelease') return Promise.resolve({ success: true });
    if (action === 'archiveStageAbort') return Promise.resolve({ success: true });
    return Promise.resolve(undefined);
  });
}

describe('archive-stage background handlers', () => {
  beforeEach(() => {
    mocks.acquireLease.mockReset();
    mocks.downloadArchiveBlob.mockReset();
    mocks.saveStagedArchive.mockReset();
    vi.mocked(chrome.runtime.sendMessage).mockReset();
    vi.mocked(chrome.downloads.onChanged.addListener).mockReset();
    installRecoveryStorage();
  });

  it('returns exact failures for malformed begin, read, and abort offscreen responses while releasing each short lease', async () => {
    const release = installLease();
    vi.mocked(chrome.runtime.sendMessage)
      .mockResolvedValueOnce({ success: true, stageId: 'invalid' })
      .mockResolvedValueOnce({
        success: true,
        data: { stageId, offset: 0, byteLength: 2, chunkBase64: 'AQ==' },
      })
      .mockResolvedValueOnce({ success: false });

    await expect(
      handleArchiveStageMessage(
        {
          action: 'beginStagedArchiveArtifact',
          source: 'chatgpt',
          descriptor: descriptorFor('raw'),
        },
        settings
      )
    ).resolves.toEqual({ success: false, error: 'archive-stage-begin-failed' });
    await expect(
      handleArchiveStageMessage(
        {
          action: 'readStagedArchiveArtifact',
          source: 'chatgpt',
          stageId,
          offset: 0,
          byteLength: 2,
        },
        settings
      )
    ).resolves.toEqual({ success: false, error: 'archive-stage-read-failed' });
    await expect(
      handleArchiveStageMessage(
        { action: 'abortStagedArchiveArtifact', source: 'chatgpt', stageId },
        settings
      )
    ).resolves.toEqual({ success: false, error: 'archive-stage-abort-failed' });

    expect(release).toHaveBeenCalledTimes(3);
  });

  it.each(['raw', 'canonical'] as const)(
    'commits staged %s to File and Obsidian, then releases exactly that stage',
    async kind => {
      const release = installLease();
      installStageUrlResponses();
      mocks.saveStagedArchive.mockResolvedValue({ success: true });
      mocks.downloadArchiveBlob.mockResolvedValue({ error: null, terminal: true, downloadId: 71 });

      await expect(
        handleArchiveStageMessage(commitMessage(kind, ['file', 'obsidian']), settings)
      ).resolves.toEqual({
        results: [
          { destination: 'file', success: true },
          { destination: 'obsidian', success: true },
        ],
        allSuccessful: true,
        anySuccessful: true,
      });

      const descriptor = descriptorFor(kind);
      const url = 'blob:chrome-extension://test-extension-id/archive-stage';
      expect(mocks.saveStagedArchive).toHaveBeenCalledWith(
        settings,
        expect.objectContaining({ stageId, descriptor, blobUrl: url })
      );
      expect(mocks.downloadArchiveBlob).toHaveBeenCalledWith(
        url,
        `_liska-archive/${conversationKey}/${captureId}/${descriptor.relativePath}`,
        expect.any(Function),
        expect.any(Function)
      );
      expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith({
        action: 'archiveStageRelease',
        target: 'offscreen',
        stageId,
        url,
      });
      expect(release).toHaveBeenCalledOnce();
    }
  );

  it('keeps the exact stage lease until a nonterminal download reports its late terminal callback', async () => {
    const release = installLease();
    installStageUrlResponses();
    let lateTerminal: (() => Promise<void>) | undefined;
    mocks.downloadArchiveBlob.mockImplementation(
      async (_url: string, _path: string, onLateTerminal: () => Promise<void>) => {
        lateTerminal = onLateTerminal;
        return { error: null, terminal: false, downloadId: 73 };
      }
    );

    await expect(
      handleArchiveStageMessage(commitMessage('raw', ['file']), settings)
    ).resolves.toEqual({
      results: [{ destination: 'file', success: true }],
      allSuccessful: true,
      anySuccessful: true,
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archiveStageCreateUrl', stageId })
    );
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archiveStageRelease' })
    );
    expect(release).not.toHaveBeenCalled();

    await lateTerminal?.();

    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith({
      action: 'archiveStageRelease',
      target: 'offscreen',
      stageId,
      url: 'blob:chrome-extension://test-extension-id/archive-stage',
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it('does not start File when durable provisional ownership cannot be persisted', async () => {
    installLease();
    installStageUrlResponses();
    mocks.saveStagedArchive.mockResolvedValue({ success: true });
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(
      handleArchiveStageMessage(commitMessage('raw', ['file', 'obsidian']), settings)
    ).resolves.toEqual({
      results: [
        { destination: 'file', success: false, error: 'archive-stage-write-failed' },
        { destination: 'obsidian', success: true },
      ],
      allSuccessful: false,
      anySuccessful: true,
    });

    expect(mocks.downloadArchiveBlob).not.toHaveBeenCalled();
    expect(mocks.saveStagedArchive).toHaveBeenCalledOnce();
  });

  it('does not let global terminal recovery release while the Obsidian sibling is still active', async () => {
    const store = installRecoveryStorage();
    const release = installLease();
    installStageUrlResponses();
    let onChanged: ((delta: chrome.downloads.DownloadDelta) => void) | undefined;
    vi.mocked(chrome.downloads.onChanged.addListener).mockImplementation(listener => {
      onChanged = listener;
    });
    startArchiveStageDownloadRecovery();

    let finishObsidian!: () => void;
    mocks.saveStagedArchive.mockImplementation(
      () =>
        new Promise(resolve => {
          finishObsidian = () => resolve({ success: true });
        })
    );
    mocks.downloadArchiveBlob.mockImplementation(
      async (_url, _path, _onLateTerminal, onDownloadId) => {
        await onDownloadId(81);
        onChanged?.({ id: 81, state: { current: 'complete' } });
        await Promise.resolve();
        await Promise.resolve();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
          expect.objectContaining({ action: 'archiveStageRelease' })
        );
        return { error: null, terminal: true, downloadId: 81 };
      }
    );

    const pending = handleArchiveStageMessage(commitMessage('raw', ['file', 'obsidian']), settings);
    await vi.waitFor(() => expect(mocks.saveStagedArchive).toHaveBeenCalledOnce());
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
    expect(store['archive-stage-download-recovery-v1']).toEqual([]);
  });
});
