import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireLease: vi.fn(),
}));

vi.mock('../../src/background/output-handlers', () => ({
  acquireOffscreenLeaseForStagedBinaryAsset: (...args: unknown[]) => mocks.acquireLease(...args),
}));

const RECOVERY_STORAGE_KEY = 'binary-stage-download-recovery-v1';
const stageId = `stage-${'A'.repeat(32)}`;
const record = {
  downloadId: 71,
  stageId,
  blobUrl: 'blob:chrome-extension://test-extension-id/recovery-stage',
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

describe('staged binary download recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireLease.mockReset();
    vi.mocked(chrome.runtime.sendMessage).mockReset();
    vi.mocked(chrome.downloads.search).mockReset();
  });

  it('cleans a provisional record after worker reload loses its Downloads callback', async () => {
    const store = installRecoveryStorage();
    const firstWorker = await import('../../src/background/binary-download-recovery');
    const provisional = { ...record, downloadId: null };
    await expect(firstWorker.rememberStagedBinaryDownloadRecovery(provisional)).resolves.toBe(true);
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([provisional]);

    vi.resetModules();
    let onChanged: ((delta: chrome.downloads.DownloadDelta) => void) | undefined;
    vi.mocked(chrome.downloads.onChanged.addListener).mockImplementation(listener => {
      onChanged = listener;
    });
    const release = installLease();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: true });

    const restartedWorker = await import('../../src/background/binary-download-recovery');
    restartedWorker.startStagedBinaryDownloadRecovery();

    await vi.waitFor(() =>
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'binaryStageRelease',
          stageId,
          url: provisional.blobUrl,
        })
      )
    );
    expect(onChanged).toBeDefined();
    expect(chrome.downloads.search).not.toHaveBeenCalled();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('atomically assigns the Downloads ID before a later worker reconciles terminal cleanup', async () => {
    const store = installRecoveryStorage();
    const provisional = { ...record, downloadId: null };
    const firstWorker = await import('../../src/background/binary-download-recovery');
    await firstWorker.rememberStagedBinaryDownloadRecovery(provisional);

    const assigned = await firstWorker.assignStagedBinaryDownloadRecoveryId(
      provisional,
      record.downloadId
    );
    expect(assigned).toEqual(record);
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([record]);
    expect(chrome.storage.local.set).toHaveBeenNthCalledWith(1, {
      [RECOVERY_STORAGE_KEY]: [provisional],
    });
    expect(chrome.storage.local.set).toHaveBeenNthCalledWith(2, {
      [RECOVERY_STORAGE_KEY]: [record],
    });

    vi.resetModules();
    installLease();
    vi.mocked(chrome.downloads.search).mockResolvedValue([
      { id: record.downloadId, state: 'complete' } as chrome.downloads.DownloadItem,
    ]);
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: true });
    const restartedWorker = await import('../../src/background/binary-download-recovery');

    await restartedWorker.reconcileStagedBinaryDownloadRecovery();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'binaryStageRelease', stageId, url: record.blobUrl })
    );
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([]);
  });

  it('retains an in-progress record but cleans a missing download after a terminal delta', async () => {
    const store = installRecoveryStorage();
    const firstWorker = await import('../../src/background/binary-download-recovery');
    await firstWorker.rememberStagedBinaryDownloadRecovery(record);

    vi.resetModules();
    let onChanged: ((delta: chrome.downloads.DownloadDelta) => void) | undefined;
    vi.mocked(chrome.downloads.onChanged.addListener).mockImplementation(listener => {
      onChanged = listener;
    });
    vi.mocked(chrome.downloads.search).mockResolvedValue([
      { id: record.downloadId, state: 'in_progress' } as chrome.downloads.DownloadItem,
    ]);
    const restartedWorker = await import('../../src/background/binary-download-recovery');
    restartedWorker.startStagedBinaryDownloadRecovery();
    await restartedWorker.reconcileStagedBinaryDownloadRecovery();

    expect(store[RECOVERY_STORAGE_KEY]).toEqual([record]);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();

    const release = installLease();
    vi.mocked(chrome.downloads.search).mockResolvedValue([]);
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(request => {
      return Promise.resolve({
        success: (request as { action?: string }).action === 'binaryStageAbort',
      });
    });
    onChanged?.({ id: record.downloadId, state: { current: 'complete' } });

    await vi.waitFor(() =>
      expect(chrome.runtime.sendMessage).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ action: 'binaryStageRelease', stageId })
      )
    );
    await vi.waitFor(() =>
      expect(chrome.runtime.sendMessage).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ action: 'binaryStageAbort', stageId })
      )
    );
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('does not retain an already-failed in-progress download beyond one day', async () => {
    const stale = { ...record, createdAt: Date.now() - 24 * 60 * 60 * 1000 - 1 };
    const store = installRecoveryStorage({ [RECOVERY_STORAGE_KEY]: [stale] });
    const release = installLease();
    vi.mocked(chrome.downloads.search).mockResolvedValue([
      { id: stale.downloadId, state: 'in_progress' } as chrome.downloads.DownloadItem,
    ]);
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: true });
    const recovery = await import('../../src/background/binary-download-recovery');

    await recovery.reconcileStagedBinaryDownloadRecovery();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'binaryStageRelease', stageId: stale.stageId })
    );
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('fails closed for malformed stored data and leaves it untouched', async () => {
    const malformed = { ...record, providerUrl: 'https://example.invalid/private' };
    const store = installRecoveryStorage({ [RECOVERY_STORAGE_KEY]: [malformed] });
    const recovery = await import('../../src/background/binary-download-recovery');

    await recovery.reconcileStagedBinaryDownloadRecovery();

    expect(chrome.downloads.search).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([malformed]);
  });

  it('returns false rather than claiming recovery after a storage write failure', async () => {
    installRecoveryStorage();
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(
      new Error('local storage unavailable')
    );
    const recovery = await import('../../src/background/binary-download-recovery');

    await expect(recovery.rememberStagedBinaryDownloadRecovery(record)).resolves.toBe(false);
  });

  it('ignores unrelated terminal deltas while this worker owns a fresh provisional stage', async () => {
    const store = installRecoveryStorage();
    const provisional = { ...record, downloadId: null };
    vi.resetModules();
    let onChanged: ((delta: chrome.downloads.DownloadDelta) => void) | undefined;
    vi.mocked(chrome.downloads.onChanged.addListener).mockImplementation(listener => {
      onChanged = listener;
    });
    const recovery = await import('../../src/background/binary-download-recovery');
    await recovery.rememberStagedBinaryDownloadRecovery(provisional);
    recovery.startStagedBinaryDownloadRecovery();
    await recovery.reconcileStagedBinaryDownloadRecovery();

    onChanged?.({ id: 999, state: { current: 'complete' } });
    await Promise.resolve();
    await Promise.resolve();

    expect(chrome.downloads.search).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([provisional]);
  });

  it('feature-detects the browser-startup event and registers bounded reconciliation', async () => {
    let startupListener: (() => void) | undefined;
    const onStartup = {
      addListener: vi.fn((listener: () => void) => {
        startupListener = listener;
      }),
    };
    Object.defineProperty(chrome.runtime, 'onStartup', {
      configurable: true,
      value: onStartup,
    });
    try {
      installRecoveryStorage();
      vi.resetModules();
      const recovery = await import('../../src/background/binary-download-recovery');

      recovery.startStagedBinaryDownloadRecovery();

      expect(onStartup.addListener).toHaveBeenCalledOnce();
      startupListener?.();
      await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalled());
    } finally {
      delete (chrome.runtime as unknown as { onStartup?: unknown }).onStartup;
    }
  });

  it('rejects unsafe records, ownership collisions, and invalid assignment inputs', async () => {
    installRecoveryStorage();
    vi.resetModules();
    const recovery = await import('../../src/background/binary-download-recovery');
    const getUrl = vi.spyOn(chrome.runtime, 'getURL').mockImplementation(() => {
      throw new Error('extension origin unavailable');
    });
    try {
      expect(recovery.isStagedBinaryDownloadRecoveryRecord(record)).toBe(false);
    } finally {
      getUrl.mockRestore();
    }

    await expect(recovery.rememberStagedBinaryDownloadRecovery(record)).resolves.toBe(true);
    await expect(
      recovery.rememberStagedBinaryDownloadRecovery({ ...record, downloadId: 72 })
    ).resolves.toBe(false);
    await expect(
      recovery.assignStagedBinaryDownloadRecoveryId(record, 73)
    ).resolves.toBeUndefined();
    await expect(
      recovery.forgetStagedBinaryDownloadRecovery({
        ...record,
        blobUrl: 'blob:https://evil.test/x',
      })
    ).resolves.toBe(false);
    await recovery.forgetStagedBinaryDownloadRecovery(record);
  });

  it('falls back to exact abort for an invalid Blob URL and fails closed without a lease', async () => {
    installRecoveryStorage();
    vi.resetModules();
    const recovery = await import('../../src/background/binary-download-recovery');
    installLease();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: true });

    await expect(
      recovery.releaseStagedBinaryStage(stageId, 'https://invalid.test/blob')
    ).resolves.toBe(true);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'binaryStageAbort', stageId })
    );

    mocks.acquireLease.mockRejectedValueOnce(new Error('offscreen unavailable'));
    await expect(recovery.releaseStagedBinaryStage(stageId, record.blobUrl)).resolves.toBe(false);
  });

  it('retains assigned ownership when Downloads lookup fails and rejects duplicate stored stages', async () => {
    const duplicate = { ...record, downloadId: 72 };
    const store = installRecoveryStorage({ [RECOVERY_STORAGE_KEY]: [record] });
    vi.resetModules();
    const recovery = await import('../../src/background/binary-download-recovery');
    vi.mocked(chrome.downloads.search).mockRejectedValueOnce(new Error('history unavailable'));

    await recovery.reconcileStagedBinaryDownloadRecovery();
    expect(store[RECOVERY_STORAGE_KEY]).toEqual([record]);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();

    store[RECOVERY_STORAGE_KEY] = [record, duplicate];
    await recovery.reconcileStagedBinaryDownloadRecovery();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
