import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const RECOVERY_STORAGE_KEY = 'archive-stage-download-recovery-v1';
const stageId = `archive-stage-${'A'.repeat(32)}`;
const secondStageId = `archive-stage-${'B'.repeat(32)}`;
const settings = {} as ExtensionSettings;
const captureId = 'capture-chatgpt-11111111-2222-4333-8444-555555555555';
const conversationKey = 'c'.repeat(64);
const extensionBlobUrl = 'blob:chrome-extension://test-extension-id/archive-stage';

type RecoveryRecord = {
  downloadId: number | null;
  stageId: string;
  blobUrl: string;
  createdAt: number;
};

function descriptorFor(kind: 'raw' | 'canonical' = 'raw'): ArchiveStageDescriptor {
  return {
    kind,
    mediaType: 'application/json',
    relativePath: ARCHIVE_STAGE_RELATIVE_PATHS[kind],
    byteLength: 3,
    sha256: 'a'.repeat(64),
  };
}

function artifactFor(
  kind: 'raw' | 'canonical' = 'raw',
  currentStageId = stageId
): StagedArchiveCompanionArtifact {
  return { transport: 'staged', stageId: currentStageId, ...descriptorFor(kind) };
}

function commitMessage(
  outputs: ('file' | 'obsidian')[],
  kind: 'raw' | 'canonical' = 'raw',
  currentStageId = stageId
): Extract<ExtensionMessage, { action: 'commitStagedArchiveCompanion' }> {
  return {
    action: 'commitStagedArchiveCompanion',
    source: 'chatgpt',
    noteFileName: 'synthetic.md',
    captureId,
    conversationKey,
    artifact: artifactFor(kind, currentStageId),
    outputs,
  };
}

function makeRecord(index = 0, overrides: Partial<RecoveryRecord> = {}): RecoveryRecord {
  return {
    downloadId: 71 + index,
    stageId: `archive-stage-${String.fromCharCode(65 + (index % 26)).repeat(32)}`,
    blobUrl: extensionBlobUrl,
    createdAt: Date.now(),
    ...overrides,
  };
}

function installLease(release: () => void = vi.fn()): ReturnType<typeof vi.fn> {
  mocks.acquireLease.mockResolvedValue({ release });
  return release as ReturnType<typeof vi.fn>;
}

function installRecoveryStorage(initial: unknown = undefined): Record<string, unknown> {
  const store: Record<string, unknown> = {};
  if (initial !== undefined) store[RECOVERY_STORAGE_KEY] = initial;
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

function resetChromeMocks(): void {
  mocks.acquireLease.mockReset();
  mocks.downloadArchiveBlob.mockReset();
  mocks.saveStagedArchive.mockReset();
  vi.mocked(chrome.runtime.sendMessage).mockReset();
  vi.mocked(chrome.runtime.getURL).mockReset();
  vi.mocked(chrome.runtime.getURL).mockImplementation(
    (path: string) => `chrome-extension://test-extension-id/${path}`
  );
  vi.mocked(chrome.storage.local.get).mockReset();
  vi.mocked(chrome.storage.local.set).mockReset();
  vi.mocked(chrome.downloads.search).mockReset();
  vi.mocked(chrome.downloads.onChanged.addListener).mockReset();
  delete (chrome.runtime as unknown as { onStartup?: unknown }).onStartup;
  delete (chrome.runtime as unknown as { onInstalled?: unknown }).onInstalled;
}

async function loadHandlers() {
  vi.resetModules();
  return import('../../src/background/archive-stage-handlers');
}

async function loadRecovery() {
  vi.resetModules();
  return import('../../src/background/archive-stage-download-recovery');
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('archive-stage background handler coverage', () => {
  beforeEach(() => {
    resetChromeMocks();
    installRecoveryStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetChromeMocks();
  });

  it('routes successful short operations and preserves exact read envelopes', async () => {
    const handlers = await loadHandlers();
    const release = installLease();
    vi.mocked(chrome.runtime.sendMessage)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'seal rejected' })
      .mockResolvedValueOnce({
        success: true,
        data: { stageId, offset: 0, byteLength: 1, chunkBase64: 'AQ==' },
      })
      .mockResolvedValueOnce({ success: false, error: 'busy' });

    const begin = await handlers.handleArchiveStageMessage({
      action: 'beginStagedArchiveArtifact',
      source: 'chatgpt',
      descriptor: descriptorFor(),
    });
    expect(begin).toMatchObject({ success: true });
    expect((begin as { stageId: string }).stageId).toMatch(/^archive-stage-[A-Za-z0-9_-]{32}$/);

    await expect(
      handlers.handleArchiveStageMessage({
        action: 'appendStagedArchiveArtifact',
        source: 'chatgpt',
        stageId,
        offset: 0,
        chunkBase64: 'AQ==',
      })
    ).resolves.toEqual({ success: true });
    await expect(
      handlers.handleArchiveStageMessage({
        action: 'sealStagedArchiveArtifact',
        source: 'chatgpt',
        stageId,
        descriptor: descriptorFor(),
      })
    ).resolves.toEqual({ success: false, error: 'archive-stage-seal-failed' });
    await expect(
      handlers.handleArchiveStageMessage({
        action: 'readStagedArchiveArtifact',
        source: 'chatgpt',
        stageId,
        offset: 0,
        byteLength: 1,
      })
    ).resolves.toEqual({
      success: true,
      data: { stageId, offset: 0, byteLength: 1, chunkBase64: 'AQ==' },
    });
    await expect(
      handlers.handleArchiveStageMessage({
        action: 'abortStagedArchiveArtifact',
        source: 'chatgpt',
        stageId,
      })
    ).resolves.toEqual({ success: false, error: 'archive-stage-abort-failed' });

    expect(release).toHaveBeenCalledTimes(5);
    expect(chrome.runtime.sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ action: 'archiveStageBegin', descriptor: descriptorFor() })
    );
  });

  it('fails closed for invalid descriptors, IDs, extra responses, and rejected offscreen calls', async () => {
    const handlers = await loadHandlers();
    const release = installLease();
    const invalidDescriptor = { ...descriptorFor(), relativePath: 'responses/evil.json' };
    await expect(
      handlers.handleArchiveStageMessage({
        action: 'beginStagedArchiveArtifact',
        source: 'chatgpt',
        descriptor: invalidDescriptor,
      } as Extract<ExtensionMessage, { action: 'beginStagedArchiveArtifact' }>)
    ).resolves.toEqual({ success: false, error: 'archive-stage-begin-failed:invalid-descriptor' });
    await expect(
      handlers.handleArchiveStageMessage({
        action: 'abortStagedArchiveArtifact',
        source: 'chatgpt',
        stageId: 'unsafe-stage-id',
      })
    ).resolves.toEqual({ success: false, error: 'archive-stage-abort-failed' });
    expect(mocks.acquireLease).not.toHaveBeenCalled();

    vi.mocked(chrome.runtime.sendMessage)
      .mockRejectedValueOnce(new Error('offscreen rejected'))
      .mockResolvedValueOnce({ success: true, extra: true })
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true, data: null })
      .mockResolvedValueOnce({
        success: true,
        data: { stageId, offset: 0, byteLength: 2, chunkBase64: 'AQ==' },
      })
      .mockResolvedValueOnce(undefined);

    await expect(
      handlers.handleArchiveStageMessage({
        action: 'appendStagedArchiveArtifact',
        source: 'chatgpt',
        stageId,
        offset: 0,
        chunkBase64: 'AQ==',
      })
    ).resolves.toEqual({ success: false, error: 'archive-stage-append-failed' });
    await expect(
      handlers.handleArchiveStageMessage({
        action: 'appendStagedArchiveArtifact',
        source: 'chatgpt',
        stageId,
        offset: 0,
        chunkBase64: 'AQ==',
      })
    ).resolves.toEqual({ success: false, error: 'archive-stage-append-failed' });
    await expect(
      handlers.handleArchiveStageMessage({
        action: 'readStagedArchiveArtifact',
        source: 'chatgpt',
        stageId,
        offset: 0,
        byteLength: 1,
      })
    ).resolves.toEqual({ success: false, error: 'archive-stage-read-failed' });
    await expect(
      handlers.handleArchiveStageMessage({
        action: 'readStagedArchiveArtifact',
        source: 'chatgpt',
        stageId,
        offset: 0,
        byteLength: 1,
      })
    ).resolves.toEqual({ success: false, error: 'archive-stage-read-failed' });
    await expect(
      handlers.handleArchiveStageMessage({
        action: 'readStagedArchiveArtifact',
        source: 'chatgpt',
        stageId,
        offset: 0,
        byteLength: 2,
      })
    ).resolves.toEqual({ success: false, error: 'archive-stage-read-failed' });
    await expect(
      handlers.handleArchiveStageMessage({
        action: 'appendStagedArchiveArtifact',
        source: 'chatgpt',
        stageId,
        offset: 0,
        chunkBase64: 'AQ==',
      })
    ).resolves.toEqual({ success: false, error: 'archive-stage-append-failed' });
    expect(release).toHaveBeenCalledTimes(6);
  });

  it('bounds every short offscreen operation by its timeout', async () => {
    vi.useFakeTimers();
    const handlers = await loadHandlers();
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    mocks.acquireLease.mockImplementation(() => {
      const release = vi.fn();
      releases.push(release);
      return Promise.resolve({ release });
    });
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      () => new Promise<never>(() => undefined)
    );

    const pending = [
      handlers.handleArchiveStageMessage({
        action: 'beginStagedArchiveArtifact',
        source: 'chatgpt',
        descriptor: descriptorFor(),
      }),
      handlers.handleArchiveStageMessage({
        action: 'appendStagedArchiveArtifact',
        source: 'chatgpt',
        stageId,
        offset: 0,
        chunkBase64: 'AQ==',
      }),
      handlers.handleArchiveStageMessage({
        action: 'sealStagedArchiveArtifact',
        source: 'chatgpt',
        stageId,
        descriptor: descriptorFor(),
      }),
      handlers.handleArchiveStageMessage({
        action: 'readStagedArchiveArtifact',
        source: 'chatgpt',
        stageId,
        offset: 0,
        byteLength: 1,
      }),
      handlers.handleArchiveStageMessage({
        action: 'abortStagedArchiveArtifact',
        source: 'chatgpt',
        stageId,
      }),
    ];
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending[0]).resolves.toEqual({
      success: false,
      error: 'archive-stage-begin-failed:offscreen-timeout',
    });
    await expect(pending[1]).resolves.toEqual({
      success: false,
      error: 'archive-stage-append-failed',
    });
    await expect(pending[2]).resolves.toEqual({
      success: false,
      error: 'archive-stage-seal-failed',
    });
    await expect(pending[3]).resolves.toEqual({
      success: false,
      error: 'archive-stage-read-failed',
    });
    await expect(pending[4]).resolves.toEqual({
      success: false,
      error: 'archive-stage-abort-failed',
    });
    expect(releases).toHaveLength(5);
    releases.forEach(release => expect(release).toHaveBeenCalledOnce());
  });

  it('rejects malformed staged commits before ownership and reports missing settings', async () => {
    const handlers = await loadHandlers();
    const invalidArtifact = {
      ...artifactFor(),
      sha256: 'not-a-sha256',
    } as StagedArchiveCompanionArtifact;
    await expect(
      handlers.handleArchiveStageMessage(
        { ...commitMessage(['file', 'obsidian']), artifact: invalidArtifact },
        settings
      )
    ).resolves.toEqual({
      results: [
        { destination: 'file', success: false, error: 'archive-stage-descriptor-invalid' },
        { destination: 'obsidian', success: false, error: 'archive-stage-descriptor-invalid' },
      ],
      allSuccessful: false,
      anySuccessful: false,
    });
    await expect(
      handlers.handleArchiveStageMessage(commitMessage(['file', 'obsidian']))
    ).resolves.toEqual({
      results: [
        { destination: 'file', success: false, error: 'archive-stage-settings-unavailable' },
        { destination: 'obsidian', success: false, error: 'archive-stage-settings-unavailable' },
      ],
      allSuccessful: false,
      anySuccessful: false,
    });
    expect(mocks.acquireLease).not.toHaveBeenCalled();
  });

  it('aborts and releases the lease when URL creation or lease acquisition fails', async () => {
    const handlers = await loadHandlers();
    mocks.acquireLease.mockRejectedValueOnce(new Error('offscreen unavailable'));
    await expect(
      handlers.handleArchiveStageMessage(commitMessage(['file']), settings)
    ).resolves.toEqual({
      results: [{ destination: 'file', success: false, error: 'archive-stage-write-failed' }],
      allSuccessful: false,
      anySuccessful: false,
    });

    const firstRelease = vi.fn();
    const abortRelease = vi.fn();
    mocks.acquireLease
      .mockResolvedValueOnce({ release: firstRelease })
      .mockResolvedValueOnce({ release: abortRelease });
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(request => {
      const action = (request as { action?: string }).action;
      if (action === 'archiveStageCreateUrl')
        return Promise.resolve({ success: false, error: 'no' });
      if (action === 'archiveStageAbort') return Promise.resolve({ success: true });
      return Promise.resolve(undefined);
    });
    await expect(
      handlers.handleArchiveStageMessage(commitMessage(['file', 'obsidian']), settings)
    ).resolves.toEqual({
      results: [
        { destination: 'file', success: false, error: 'archive-stage-write-failed' },
        { destination: 'obsidian', success: false, error: 'archive-stage-write-failed' },
      ],
      allSuccessful: false,
      anySuccessful: false,
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'archiveStageAbort',
      target: 'offscreen',
      stageId,
    });
    expect(firstRelease).toHaveBeenCalledOnce();
    expect(abortRelease).toHaveBeenCalledOnce();
  });

  it('keeps durable ownership after a File start failure while reporting an Obsidian throw', async () => {
    const handlers = await loadHandlers();
    const store = installRecoveryStorage();
    const release = installLease();
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(request => {
      const action = (request as { action?: string }).action;
      if (action === 'archiveStageCreateUrl')
        return Promise.resolve({ success: true, url: extensionBlobUrl });
      return Promise.resolve({ success: true });
    });
    mocks.downloadArchiveBlob.mockRejectedValue(new Error('File start refused'));
    mocks.saveStagedArchive.mockRejectedValue(new Error('vault unavailable'));

    await expect(
      handlers.handleArchiveStageMessage(commitMessage(['file', 'obsidian']), settings)
    ).resolves.toEqual({
      results: [
        { destination: 'file', success: false, error: 'archive-stage-write-failed' },
        { destination: 'obsidian', success: false, error: 'archive-stage-write-failed' },
      ],
      allSuccessful: false,
      anySuccessful: false,
    });
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([
      expect.objectContaining({ downloadId: null, stageId, blobUrl: extensionBlobUrl }),
    ]);
    expect(release).not.toHaveBeenCalled();
  });

  it('keeps an Obsidian success independent from a File start failure', async () => {
    const handlers = await loadHandlers();
    installRecoveryStorage();
    const release = installLease();
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(request => {
      const action = (request as { action?: string }).action;
      if (action === 'archiveStageCreateUrl')
        return Promise.resolve({ success: true, url: extensionBlobUrl });
      return Promise.resolve({ success: true });
    });
    mocks.downloadArchiveBlob.mockRejectedValue(new Error('File start refused'));
    mocks.saveStagedArchive.mockResolvedValue({ success: true });

    await expect(
      handlers.handleArchiveStageMessage(commitMessage(['file', 'obsidian']), settings)
    ).resolves.toEqual({
      results: [
        { destination: 'file', success: false, error: 'archive-stage-write-failed' },
        { destination: 'obsidian', success: true },
      ],
      allSuccessful: false,
      anySuccessful: true,
    });
    expect(release).not.toHaveBeenCalled();
  });

  it('assigns a File download ID and falls back from failed release to abort', async () => {
    const handlers = await loadHandlers();
    const store = installRecoveryStorage();
    const release = installLease();
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(request => {
      const action = (request as { action?: string }).action;
      if (action === 'archiveStageCreateUrl')
        return Promise.resolve({ success: true, url: extensionBlobUrl });
      if (action === 'archiveStageRelease')
        return Promise.resolve({ success: false, error: 'busy' });
      if (action === 'archiveStageAbort') return Promise.resolve({ success: true });
      return Promise.resolve(undefined);
    });
    mocks.downloadArchiveBlob.mockImplementation(
      async (
        _url: string,
        _path: string,
        _onLateTerminal: () => Promise<void>,
        onDownloadId: (id: number) => Promise<void>
      ) => {
        await onDownloadId(0);
        await onDownloadId(91);
        await onDownloadId(92);
        return { error: null, terminal: true, downloadId: 91 };
      }
    );

    await expect(
      handlers.handleArchiveStageMessage(commitMessage(['file']), settings)
    ).resolves.toEqual({
      results: [{ destination: 'file', success: true }],
      allSuccessful: true,
      anySuccessful: true,
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archiveStageRelease', stageId, url: extensionBlobUrl })
    );
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archiveStageAbort', stageId })
    );
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('relinquishes deferred ownership when both release and abort remain unconfirmed', async () => {
    const handlers = await loadHandlers();
    const store = installRecoveryStorage();
    const release = installLease();
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(request => {
      const action = (request as { action?: string }).action;
      if (action === 'archiveStageCreateUrl')
        return Promise.resolve({ success: true, url: extensionBlobUrl });
      if (action === 'archiveStageRelease' || action === 'archiveStageAbort') {
        return Promise.resolve({ success: false });
      }
      return Promise.resolve(undefined);
    });
    mocks.downloadArchiveBlob.mockResolvedValue({ error: null, terminal: true, downloadId: 93 });

    await expect(
      handlers.handleArchiveStageMessage(commitMessage(['file']), settings)
    ).resolves.toEqual({
      results: [{ destination: 'file', success: true }],
      allSuccessful: true,
      anySuccessful: true,
    });
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([
      expect.objectContaining({ stageId, downloadId: null }),
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('waits for a late terminal callback before releasing a staged File', async () => {
    const handlers = await loadHandlers();
    const store = installRecoveryStorage();
    const release = installLease();
    let lateTerminal: (() => Promise<void>) | undefined;
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(request => {
      const action = (request as { action?: string }).action;
      if (action === 'archiveStageCreateUrl')
        return Promise.resolve({ success: true, url: extensionBlobUrl });
      return Promise.resolve({ success: true });
    });
    mocks.downloadArchiveBlob.mockImplementation(
      async (_url: string, _path: string, onLateTerminal: () => Promise<void>) => {
        lateTerminal = onLateTerminal;
        return { error: null, terminal: false, downloadId: 94 };
      }
    );

    await expect(
      handlers.handleArchiveStageMessage(commitMessage(['file']), settings)
    ).resolves.toEqual({
      results: [{ destination: 'file', success: true }],
      allSuccessful: true,
      anySuccessful: true,
    });
    expect(release).not.toHaveBeenCalled();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([
      expect.objectContaining({ stageId, downloadId: null }),
    ]);

    await lateTerminal?.();
    expect(release).toHaveBeenCalledOnce();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([]);
  });

  it('relinquishes ownership when the transferred lease release itself throws', async () => {
    const handlers = await loadHandlers();
    const store = installRecoveryStorage();
    const release = vi.fn(() => {
      throw new Error('lease release bookkeeping failed');
    });
    mocks.acquireLease.mockResolvedValue({ release });
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(request => {
      const action = (request as { action?: string }).action;
      if (action === 'archiveStageCreateUrl')
        return Promise.resolve({ success: true, url: extensionBlobUrl });
      return Promise.resolve({ success: true });
    });
    mocks.downloadArchiveBlob.mockResolvedValue({ error: null, terminal: true, downloadId: 92 });
    mocks.saveStagedArchive.mockResolvedValue({ success: true });

    await expect(
      handlers.handleArchiveStageMessage(commitMessage(['file']), settings)
    ).resolves.toEqual({
      results: [{ destination: 'file', success: false, error: 'archive-stage-write-failed' }],
      allSuccessful: false,
      anySuccessful: false,
    });
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([
      expect.objectContaining({ stageId, downloadId: null }),
    ]);
    expect(release).toHaveBeenCalled();
  });

  it('uses abort when a staged URL has a non-extension Blob origin', async () => {
    const handlers = await loadHandlers();
    installRecoveryStorage();
    const release = installLease();
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(request => {
      const action = (request as { action?: string }).action;
      if (action === 'archiveStageCreateUrl') {
        return Promise.resolve({ success: true, url: 'blob:https://evil.test/stage' });
      }
      if (action === 'archiveStageAbort') return Promise.resolve({ success: true });
      return Promise.resolve(undefined);
    });
    mocks.downloadArchiveBlob.mockReset();

    await expect(
      handlers.handleArchiveStageMessage(commitMessage(['file']), settings)
    ).resolves.toEqual({
      results: [{ destination: 'file', success: false, error: 'archive-stage-write-failed' }],
      allSuccessful: false,
      anySuccessful: false,
    });
    expect(mocks.downloadArchiveBlob).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archiveStageAbort', stageId })
    );
    expect(release).toHaveBeenCalledOnce();
  });
});

describe('archive-stage download recovery coverage', () => {
  beforeEach(() => {
    resetChromeMocks();
    installRecoveryStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetChromeMocks();
  });

  it('validates exact records, extension origins, timestamps, and throwing fields', async () => {
    const recovery = await loadRecovery();
    const valid = makeRecord();
    expect(recovery.isArchiveStageDownloadRecoveryRecord(valid)).toBe(true);
    expect(recovery.isArchiveStageDownloadRecoveryRecord(null)).toBe(false);
    expect(recovery.isArchiveStageDownloadRecoveryRecord([])).toBe(false);
    expect(recovery.isArchiveStageDownloadRecoveryRecord({ ...valid, extra: true })).toBe(false);
    expect(
      recovery.isArchiveStageDownloadRecoveryRecord({ ...valid, [Symbol('extra')]: true })
    ).toBe(false);
    const accessor = Object.defineProperties(
      {},
      {
        downloadId: { get: () => valid.downloadId, enumerable: true },
        stageId: { value: valid.stageId, enumerable: true },
        blobUrl: { value: valid.blobUrl, enumerable: true },
        createdAt: { value: valid.createdAt, enumerable: true },
      }
    );
    expect(recovery.isArchiveStageDownloadRecoveryRecord(accessor)).toBe(false);

    const throwing = new Proxy(valid, {
      get(target, property, receiver) {
        if (property === 'stageId') throw new Error('field unavailable');
        return Reflect.get(target, property, receiver);
      },
    });
    expect(recovery.isArchiveStageDownloadRecoveryRecord(throwing)).toBe(false);

    vi.mocked(chrome.runtime.getURL).mockImplementation(() => {
      throw new Error('extension origin unavailable');
    });
    expect(recovery.isArchiveStageDownloadRecoveryRecord(valid)).toBe(false);
    vi.mocked(chrome.runtime.getURL).mockImplementation(
      (path: string) => `chrome-extension://test-extension-id/${path}`
    );
    expect(
      recovery.isArchiveStageDownloadRecoveryRecord({
        ...valid,
        downloadId: 0,
      })
    ).toBe(false);
    expect(
      recovery.isArchiveStageDownloadRecoveryRecord({
        ...valid,
        stageId: 'archive-stage-too-short',
      })
    ).toBe(false);
    expect(
      recovery.isArchiveStageDownloadRecoveryRecord({
        ...valid,
        blobUrl: 'blob:https://evil.test/stage',
      })
    ).toBe(false);
    expect(
      recovery.isArchiveStageDownloadRecoveryRecord({
        ...valid,
        createdAt: Date.now() + 2 * 24 * 60 * 60 * 1000,
      })
    ).toBe(false);
    expect(
      recovery.isArchiveStageDownloadRecoveryRecord({
        ...valid,
        createdAt: -1,
      })
    ).toBe(false);
  });

  it('fails closed for malformed, duplicate, future, and oversized registries', async () => {
    const recovery = await loadRecovery();
    const malformedRegistries: unknown[] = [
      null,
      'not-an-array',
      Array.from({ length: 21 }, (_, index) => makeRecord(index)),
      [makeRecord(0, { createdAt: Date.now() + 2 * 24 * 60 * 60 * 1000 })],
      [makeRecord(0), { ...makeRecord(1), stageId: makeRecord(0).stageId }],
      [makeRecord(0), { ...makeRecord(1), downloadId: makeRecord(0).downloadId }],
    ];
    for (const malformed of malformedRegistries) {
      const store = installRecoveryStorage(malformed);
      await recovery.reconcileArchiveStageDownloadRecovery();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
      expect(store[RECOVERY_STORAGE_KEY]).toBe(malformed);
      vi.mocked(chrome.runtime.sendMessage).mockClear();
      vi.mocked(chrome.storage.local.set).mockClear();
    }

    vi.mocked(chrome.storage.local.get).mockResolvedValueOnce(null as never);
    await recovery.reconcileArchiveStageDownloadRecovery();

    const full = Array.from({ length: 20 }, (_, index) => makeRecord(index));
    const fullStore = installRecoveryStorage(full);
    await expect(recovery.rememberArchiveStageDownloadRecovery(makeRecord(20))).resolves.toBe(
      false
    );
    expect(fullStore[RECOVERY_STORAGE_KEY]).toEqual(full);

    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('storage unavailable'));
    await recovery.reconcileArchiveStageDownloadRecovery();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('deduplicates remembers and handles remember, assign, and forget failures', async () => {
    const recovery = await loadRecovery();
    const remembered = makeRecord();
    const sameStage = makeRecord(1, { stageId: remembered.stageId });
    const sameDownload = makeRecord(2, { downloadId: remembered.downloadId });
    const provisional = makeRecord(3, { downloadId: null });
    const store = installRecoveryStorage();

    await expect(
      recovery.rememberArchiveStageDownloadRecovery({ ...provisional, stageId: 'bad' })
    ).resolves.toBe(false);
    await expect(recovery.rememberArchiveStageDownloadRecovery(remembered)).resolves.toBe(true);
    await expect(recovery.rememberArchiveStageDownloadRecovery(remembered)).resolves.toBe(true);
    await expect(recovery.rememberArchiveStageDownloadRecovery(sameStage)).resolves.toBe(false);
    await expect(recovery.rememberArchiveStageDownloadRecovery(sameDownload)).resolves.toBe(false);
    await expect(recovery.rememberArchiveStageDownloadRecovery(provisional)).resolves.toBe(true);

    vi.mocked(chrome.storage.local.get).mockResolvedValueOnce(null as never);
    await expect(recovery.rememberArchiveStageDownloadRecovery(makeRecord(5))).resolves.toBe(false);

    await expect(
      recovery.assignArchiveStageDownloadRecoveryId(provisional, 0)
    ).resolves.toBeUndefined();
    await expect(
      recovery.assignArchiveStageDownloadRecoveryId(provisional, Number.MAX_SAFE_INTEGER + 1)
    ).resolves.toBeUndefined();
    await expect(
      recovery.assignArchiveStageDownloadRecoveryId({ ...provisional, downloadId: 73 }, 74)
    ).resolves.toBeUndefined();
    await expect(
      recovery.assignArchiveStageDownloadRecoveryId({ ...provisional, stageId: secondStageId }, 74)
    ).resolves.toBeUndefined();
    await expect(
      recovery.assignArchiveStageDownloadRecoveryId(provisional, remembered.downloadId as number)
    ).resolves.toBeUndefined();

    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('assignment failed'));
    await expect(
      recovery.assignArchiveStageDownloadRecoveryId(provisional, 74)
    ).resolves.toBeUndefined();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([remembered, provisional]);

    await expect(
      recovery.forgetArchiveStageDownloadRecovery({ ...provisional, blobUrl: 'blob:https://evil' })
    ).resolves.toBe(false);
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('read failed'));
    await expect(recovery.forgetArchiveStageDownloadRecovery(provisional)).resolves.toBe(false);
    vi.mocked(chrome.storage.local.get).mockImplementation(
      (key: string | string[] | Record<string, unknown> | null) =>
        typeof key === 'string' ? Promise.resolve({ [key]: store[key] }) : Promise.resolve({})
    );
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('forget failed'));
    await expect(recovery.forgetArchiveStageDownloadRecovery(provisional)).resolves.toBe(false);
    await expect(recovery.forgetArchiveStageDownloadRecovery(provisional)).resolves.toBe(true);
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('remember failed'));
    await expect(recovery.rememberArchiveStageDownloadRecovery(makeRecord(4))).resolves.toBe(false);
    await expect(recovery.forgetArchiveStageDownloadRecovery(remembered)).resolves.toBe(true);
    await expect(recovery.forgetArchiveStageDownloadRecovery(remembered)).resolves.toBe(true);
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([]);
    recovery.relinquishArchiveStageDownloadRecovery('bad');
    recovery.relinquishArchiveStageDownloadRecovery(provisional.stageId);
  });

  it('handles release and abort success, fallback, rejection, and timeout paths', async () => {
    const recovery = await loadRecovery();
    const borrowedRelease = vi.fn();
    const borrowedLease = { release: borrowedRelease };
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: true });

    await expect(recovery.abortArchiveStageDownloadRecovery(stageId, borrowedLease)).resolves.toBe(
      true
    );
    expect(mocks.acquireLease).not.toHaveBeenCalled();
    await expect(
      recovery.releaseArchiveStageDownloadRecovery(stageId, extensionBlobUrl, borrowedLease)
    ).resolves.toBe(true);
    expect(borrowedRelease).not.toHaveBeenCalled();

    vi.mocked(chrome.runtime.sendMessage).mockImplementation(request => {
      const action = (request as { action?: string }).action;
      return Promise.resolve({ success: action === 'archiveStageAbort' });
    });
    await expect(
      recovery.releaseArchiveStageDownloadRecovery(stageId, extensionBlobUrl, borrowedLease)
    ).resolves.toBe(true);
    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith({
      action: 'archiveStageAbort',
      target: 'offscreen',
      stageId,
    });

    await expect(
      recovery.releaseArchiveStageDownloadRecovery('unsafe', extensionBlobUrl, borrowedLease)
    ).resolves.toBe(false);

    vi.mocked(chrome.runtime.sendMessage).mockRejectedValue(new Error('release rejected'));
    await expect(
      recovery.releaseArchiveStageDownloadRecovery(stageId, extensionBlobUrl, borrowedLease)
    ).resolves.toBe(false);

    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: false });
    await expect(
      recovery.releaseArchiveStageDownloadRecovery(stageId, 'blob:https://evil.test/stage')
    ).resolves.toBe(false);
    expect(mocks.acquireLease).toHaveBeenCalledOnce();

    const throwingRelease = vi.fn(() => {
      throw new Error('release bookkeeping failed');
    });
    mocks.acquireLease.mockResolvedValueOnce({ release: throwingRelease });
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: true });
    await expect(
      recovery.releaseArchiveStageDownloadRecovery(stageId, extensionBlobUrl)
    ).resolves.toBe(false);
    expect(throwingRelease).toHaveBeenCalledOnce();

    mocks.acquireLease.mockRejectedValueOnce(new Error('lease unavailable'));
    await expect(recovery.abortArchiveStageDownloadRecovery(stageId)).resolves.toBe(false);
    await expect(recovery.abortArchiveStageDownloadRecovery('unsafe')).resolves.toBe(false);

    vi.useFakeTimers();
    installLease();
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      () => new Promise<never>(() => undefined)
    );
    const pending = recovery.abortArchiveStageDownloadRecovery(stageId);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toBe(false);
    expect(mocks.acquireLease).toHaveBeenCalled();
  });

  it('retains ownership for rejected and nonterminal Downloads searches', async () => {
    const recovery = await loadRecovery();
    const record = makeRecord();
    const store = installRecoveryStorage([record]);

    vi.mocked(chrome.downloads.search).mockResolvedValue([
      { id: record.downloadId, state: 'in_progress' } as chrome.downloads.DownloadItem,
    ]);
    await recovery.reconcileArchiveStageDownloadRecovery();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([record]);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();

    vi.mocked(chrome.downloads.search).mockResolvedValue([
      { id: record.downloadId, state: 'paused' } as chrome.downloads.DownloadItem,
    ]);
    await recovery.reconcileArchiveStageDownloadRecovery();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([record]);

    vi.mocked(chrome.downloads.search).mockRejectedValueOnce(new Error('history unavailable'));
    await recovery.reconcileArchiveStageDownloadRecovery();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([record]);

    const aged = makeRecord(1, { createdAt: Date.now() - 24 * 60 * 60 * 1000 - 1 });
    store[RECOVERY_STORAGE_KEY] = [aged];
    const agedRelease = installLease();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: true });
    await recovery.reconcileArchiveStageDownloadRecovery();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([]);
    expect(agedRelease).toHaveBeenCalledOnce();

    const nullId = makeRecord(2, { downloadId: null });
    store[RECOVERY_STORAGE_KEY] = [nullId];
    await recovery.reconcileArchiveStageDownloadRecovery();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([nullId]);

    store[RECOVERY_STORAGE_KEY] = [record];
    vi.mocked(chrome.runtime.sendMessage).mockClear();

    vi.mocked(chrome.downloads.search).mockResolvedValue([
      { id: 999, state: 'complete' } as chrome.downloads.DownloadItem,
    ]);
    const release = installLease();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: true });
    await recovery.reconcileArchiveStageDownloadRecovery();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([]);
    expect(release).toHaveBeenCalledOnce();

    const terminal = makeRecord(3);
    store[RECOVERY_STORAGE_KEY] = [terminal];
    vi.mocked(chrome.downloads.search).mockResolvedValue([
      { id: terminal.downloadId, state: 'complete' } as chrome.downloads.DownloadItem,
    ]);
    const terminalRelease = installLease();
    await recovery.reconcileArchiveStageDownloadRecovery();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([]);
    expect(terminalRelease).toHaveBeenCalledOnce();
  });

  it('quarantines active ownership and shares an in-flight reconciliation promise', async () => {
    const recovery = await loadRecovery();
    const record = makeRecord(0, { downloadId: null });
    const store = installRecoveryStorage([record]);
    await expect(recovery.rememberArchiveStageDownloadRecovery(record)).resolves.toBe(true);
    await recovery.reconcileArchiveStageDownloadRecovery();
    expect(chrome.downloads.search).not.toHaveBeenCalled();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([record]);

    let resolveGet!: (value: unknown) => void;
    vi.mocked(chrome.storage.local.get).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveGet = resolve;
        })
    );
    const first = recovery.reconcileArchiveStageDownloadRecovery();
    const second = recovery.reconcileArchiveStageDownloadRecovery();
    expect(second).toBe(first);
    resolveGet({ [RECOVERY_STORAGE_KEY]: undefined });
    await first;
  });

  it('registers terminal, startup, and install listeners exactly once', async () => {
    let onChanged: ((delta: chrome.downloads.DownloadDelta) => void) | undefined;
    let onStartup: (() => void) | undefined;
    let onInstalled: (() => void) | undefined;
    const startupEvent = {
      addListener: vi.fn((listener: () => void) => {
        onStartup = listener;
      }),
    };
    const installedEvent = {
      addListener: vi.fn((listener: () => void) => {
        onInstalled = listener;
      }),
    };
    Object.defineProperty(chrome.runtime, 'onStartup', {
      configurable: true,
      value: startupEvent,
    });
    Object.defineProperty(chrome.runtime, 'onInstalled', {
      configurable: true,
      value: installedEvent,
    });
    const store = installRecoveryStorage();
    const recovery = await loadRecovery();
    vi.mocked(chrome.downloads.onChanged.addListener).mockImplementation(listener => {
      onChanged = listener;
    });

    recovery.startArchiveStageDownloadRecovery();
    recovery.startArchiveStageDownloadRecovery();
    await flushMicrotasks();
    expect(chrome.downloads.onChanged.addListener).toHaveBeenCalledOnce();
    expect(startupEvent.addListener).toHaveBeenCalledOnce();
    expect(installedEvent.addListener).toHaveBeenCalledOnce();
    expect(store[RECOVERY_STORAGE_KEY]).toBeUndefined();

    const getCallsBefore = vi.mocked(chrome.storage.local.get).mock.calls.length;
    onChanged?.({ id: 1, state: { current: 'in_progress' } });
    await flushMicrotasks();
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(getCallsBefore);
    onChanged?.({ id: 1, state: { current: 'complete' } });
    onStartup?.();
    onInstalled?.();
    await flushMicrotasks();
    expect(chrome.storage.local.get.mock.calls.length).toBeGreaterThan(getCallsBefore);
  });

  it('feature-detects absent startup and install events', async () => {
    const recovery = await loadRecovery();
    installRecoveryStorage();
    recovery.startArchiveStageDownloadRecovery();
    await flushMicrotasks();
    expect(chrome.downloads.onChanged.addListener).toHaveBeenCalledOnce();
  });
});
