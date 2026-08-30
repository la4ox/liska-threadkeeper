import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireLease: vi.fn(),
}));

vi.mock('../../src/background/output-handlers', () => ({
  acquireOffscreenLeaseForArchiveStage: (...args: unknown[]) => mocks.acquireLease(...args),
}));

const RECOVERY_STORAGE_KEY = 'archive-stage-download-recovery-v1';
const stageId = `archive-stage-${'A'.repeat(32)}`;
const record = {
  downloadId: 71,
  stageId,
  blobUrl: 'blob:chrome-extension://test-extension-id/archive-stage',
  createdAt: Date.now(),
};

function installRecoveryStorage(initial: Record<string, unknown> = {}): Record<string, unknown> {
  const store = { ...initial };
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

function installLease(): ReturnType<typeof vi.fn> {
  const release = vi.fn();
  mocks.acquireLease.mockResolvedValue({ release });
  return release;
}

describe('archive-stage download recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireLease.mockReset();
    vi.mocked(chrome.runtime.sendMessage).mockReset();
    vi.mocked(chrome.downloads.search).mockReset();
  });

  it('persists provisional ownership, atomically assigns an ID, then cleans that exact stage', async () => {
    const store = installRecoveryStorage();
    const provisional = { ...record, downloadId: null };
    const firstWorker = await import('../../src/background/archive-stage-download-recovery');

    await expect(firstWorker.rememberArchiveStageDownloadRecovery(provisional)).resolves.toBe(true);
    await expect(
      firstWorker.assignArchiveStageDownloadRecoveryId(provisional, record.downloadId)
    ).resolves.toEqual(record);
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([record]);
    expect(Object.keys((store[RECOVERY_STORAGE_KEY] as (typeof record)[])[0]).sort()).toEqual([
      'blobUrl',
      'createdAt',
      'downloadId',
      'stageId',
    ]);

    vi.resetModules();
    const release = installLease();
    vi.mocked(chrome.downloads.search).mockResolvedValue([
      { id: record.downloadId, state: 'complete' } as chrome.downloads.DownloadItem,
    ]);
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: true });
    const restartedWorker = await import('../../src/background/archive-stage-download-recovery');

    await restartedWorker.reconcileArchiveStageDownloadRecovery();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'archiveStageRelease',
      target: 'offscreen',
      stageId,
      url: record.blobUrl,
    });
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('registers a fresh-worker terminal listener synchronously and reconciles its event', async () => {
    const store = installRecoveryStorage({ [RECOVERY_STORAGE_KEY]: [record] });
    vi.resetModules();
    let onChanged: ((delta: chrome.downloads.DownloadDelta) => void) | undefined;
    vi.mocked(chrome.downloads.onChanged.addListener).mockImplementation(listener => {
      onChanged = listener;
    });
    installLease();
    vi.mocked(chrome.downloads.search).mockResolvedValue([
      { id: record.downloadId, state: 'in_progress' } as chrome.downloads.DownloadItem,
    ]);
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: true });
    const recovery = await import('../../src/background/archive-stage-download-recovery');

    recovery.startArchiveStageDownloadRecovery();
    expect(onChanged).toBeDefined();
    await vi.waitFor(() => expect(chrome.downloads.search).toHaveBeenCalled());
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([record]);

    vi.mocked(chrome.downloads.search).mockResolvedValue([
      { id: record.downloadId, state: 'complete' } as chrome.downloads.DownloadItem,
    ]);
    onChanged?.({ id: record.downloadId, state: { current: 'complete' } });

    await vi.waitFor(() => expect(store[RECOVERY_STORAGE_KEY]).toEqual([]));
  });

  it('quarantines a fresh null-ID record but cleans missing and aged ownership', async () => {
    const provisional = { ...record, downloadId: null };
    const store = installRecoveryStorage({ [RECOVERY_STORAGE_KEY]: [provisional] });
    vi.resetModules();
    const recovery = await import('../../src/background/archive-stage-download-recovery');

    await recovery.reconcileArchiveStageDownloadRecovery();

    expect(chrome.downloads.search).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([provisional]);

    const stale = { ...provisional, createdAt: Date.now() - 24 * 60 * 60 * 1000 - 1 };
    store[RECOVERY_STORAGE_KEY] = [stale];
    const release = installLease();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: true });

    await recovery.reconcileArchiveStageDownloadRecovery();

    expect(chrome.downloads.search).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archiveStageRelease', stageId: stale.stageId })
    );
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([]);
    expect(release).toHaveBeenCalledOnce();

    store[RECOVERY_STORAGE_KEY] = [record];
    const missingRelease = installLease();
    vi.mocked(chrome.downloads.search).mockResolvedValue([]);
    await recovery.reconcileArchiveStageDownloadRecovery();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([]);
    expect(missingRelease).toHaveBeenCalledOnce();
  });

  it('fails closed for malformed or sensitive stored fields and falls back to exact abort', async () => {
    const malformed = { ...record, conversationKey: 'must-not-be-stored' };
    const store = installRecoveryStorage({ [RECOVERY_STORAGE_KEY]: [malformed] });
    const recovery = await import('../../src/background/archive-stage-download-recovery');

    await recovery.reconcileArchiveStageDownloadRecovery();

    expect(chrome.downloads.search).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([malformed]);

    installLease();
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(request => {
      const action = (request as { action?: string }).action;
      return Promise.resolve({ success: action === 'archiveStageAbort' });
    });
    await expect(
      recovery.releaseArchiveStageDownloadRecovery(stageId, record.blobUrl)
    ).resolves.toBe(true);
    expect(chrome.runtime.sendMessage).toHaveBeenNthCalledWith(1, {
      action: 'archiveStageRelease',
      target: 'offscreen',
      stageId,
      url: record.blobUrl,
    });
    expect(chrome.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
      action: 'archiveStageAbort',
      target: 'offscreen',
      stageId,
    });
  });

  it('keeps failed storage registration from claiming durable ownership', async () => {
    installRecoveryStorage();
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('storage unavailable'));
    const recovery = await import('../../src/background/archive-stage-download-recovery');

    await expect(recovery.rememberArchiveStageDownloadRecovery(record)).resolves.toBe(false);
  });

  it('registers startup and install reconciliation when those runtime events exist', async () => {
    let startupListener: (() => void) | undefined;
    let installListener: (() => void) | undefined;
    const onStartup = {
      addListener: vi.fn((listener: () => void) => (startupListener = listener)),
    };
    const onInstalled = {
      addListener: vi.fn((listener: () => void) => (installListener = listener)),
    };
    Object.defineProperty(chrome.runtime, 'onStartup', { configurable: true, value: onStartup });
    Object.defineProperty(chrome.runtime, 'onInstalled', {
      configurable: true,
      value: onInstalled,
    });
    try {
      installRecoveryStorage();
      vi.resetModules();
      const recovery = await import('../../src/background/archive-stage-download-recovery');

      recovery.startArchiveStageDownloadRecovery();

      expect(onStartup.addListener).toHaveBeenCalledOnce();
      expect(onInstalled.addListener).toHaveBeenCalledOnce();
      startupListener?.();
      installListener?.();
      await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalled());
    } finally {
      delete (chrome.runtime as unknown as { onStartup?: unknown }).onStartup;
      delete (chrome.runtime as unknown as { onInstalled?: unknown }).onInstalled;
    }
  });
});
