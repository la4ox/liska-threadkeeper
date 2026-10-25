import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadReconciliationZip,
  type ReconciliationDownloadsApi,
} from '../../src/reconcile/download';

const BUNDLE_ID = 'a'.repeat(64);
const ZIP = new Uint8Array([
  0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

function harness() {
  let listener: ((delta: { id: number; state?: { current?: string } }) => void) | undefined;
  let callback: ((id: number | undefined) => void) | undefined;
  const downloads: ReconciliationDownloadsApi = {
    download: vi.fn((_options, next) => {
      callback = next;
    }),
    search: vi.fn(async () => []),
    onChanged: {
      addListener: vi.fn(next => {
        listener = next;
      }),
      removeListener: vi.fn(),
    },
  };
  const objectUrls = {
    createObjectURL: vi.fn(() => 'blob:test'),
    revokeObjectURL: vi.fn(),
  };
  return {
    downloads,
    objectUrls,
    callback: (id: number | undefined) => callback?.(id),
    change: (id: number, state: string) => listener?.({ id, state: { current: state } }),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('downloadReconciliationZip', () => {
  it('uses one explicit Save-As download and confirms terminal completion', async () => {
    const h = harness();
    vi.mocked(h.downloads.search).mockResolvedValue([
      { id: 7, state: 'complete', filename: 'D:\\Archive\\chosen.zip' },
    ]);
    const pending = downloadReconciliationZip({
      bytes: ZIP,
      bundleId: BUNDLE_ID,
      downloads: h.downloads,
      runtime: {},
      objectUrls: h.objectUrls,
    });
    h.callback(7);
    h.change(7, 'complete');
    await expect(pending).resolves.toEqual({
      status: 'confirmed',
      downloadId: 7,
      observedFileName: null,
    });
    expect(h.downloads.download).toHaveBeenCalledWith(
      {
        url: 'blob:test',
        filename: `liska-chatgpt-reconciliation-${BUNDLE_ID}.zip`,
        saveAs: true,
        conflictAction: 'uniquify',
      },
      expect.any(Function)
    );
    expect(h.objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:test');
    expect(h.downloads.onChanged.removeListener).toHaveBeenCalledOnce();
  });

  it('reports a terminal interruption without retrying', async () => {
    const h = harness();
    const pending = downloadReconciliationZip({
      bytes: ZIP,
      bundleId: BUNDLE_ID,
      downloads: h.downloads,
      runtime: {},
      objectUrls: h.objectUrls,
    });
    h.callback(9);
    h.change(9, 'interrupted');
    await expect(pending).resolves.toEqual({
      status: 'failed',
      downloadId: 9,
      error: 'interrupted',
    });
    expect(h.downloads.download).toHaveBeenCalledOnce();
    expect(h.objectUrls.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('reconciles an early terminal event from authoritative download state', async () => {
    const h = harness();
    vi.mocked(h.downloads.search).mockResolvedValue([
      { id: 8, state: 'complete', filename: 'bundle.zip' },
    ]);
    const pending = downloadReconciliationZip({
      bytes: ZIP,
      bundleId: BUNDLE_ID,
      downloads: h.downloads,
      runtime: {},
      objectUrls: h.objectUrls,
    });
    h.change(8, 'complete');
    h.callback(8);
    await expect(pending).resolves.toMatchObject({ status: 'confirmed', downloadId: 8 });
    expect(h.downloads.search).toHaveBeenCalledWith({ id: 8 });
  });

  it('fails closed when the browser refuses or throws before dispatch', async () => {
    let h = harness();
    const refused = downloadReconciliationZip({
      bytes: ZIP,
      bundleId: BUNDLE_ID,
      downloads: h.downloads,
      runtime: { lastError: { message: 'private browser text' } },
      objectUrls: h.objectUrls,
    });
    h.callback(undefined);
    await expect(refused).resolves.toEqual({
      status: 'failed',
      downloadId: null,
      error: 'start-failed',
    });

    h = harness();
    vi.mocked(h.downloads.download).mockImplementation(() => {
      throw new Error('private browser text');
    });
    await expect(
      downloadReconciliationZip({
        bytes: ZIP,
        bundleId: BUNDLE_ID,
        downloads: h.downloads,
        runtime: {},
        objectUrls: h.objectUrls,
      })
    ).resolves.toMatchObject({ status: 'failed', error: 'start-failed' });
  });

  it('returns an honest unknown result and defers cleanup until a late terminal event', async () => {
    vi.useFakeTimers();
    const h = harness();
    vi.mocked(h.downloads.search).mockResolvedValue([{ id: 11, state: 'in_progress' }]);
    const pending = downloadReconciliationZip({
      bytes: ZIP,
      bundleId: BUNDLE_ID,
      downloads: h.downloads,
      runtime: {},
      objectUrls: h.objectUrls,
      terminalTimeoutMs: 10,
      deferredCleanupMs: 100,
    });
    h.callback(11);
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toEqual({
      status: 'unknown',
      downloadId: 11,
      error: 'completion-unconfirmed',
    });
    expect(h.objectUrls.revokeObjectURL).not.toHaveBeenCalled();
    h.change(11, 'complete');
    await vi.runAllTimersAsync();
    expect(h.objectUrls.revokeObjectURL).toHaveBeenCalledOnce();
    expect(h.downloads.download).toHaveBeenCalledOnce();
  });

  it('confirms completion first observed by the timeout reconciliation', async () => {
    vi.useFakeTimers();
    const h = harness();
    vi.mocked(h.downloads.search)
      .mockResolvedValueOnce([{ id: 12, state: 'in_progress' }])
      .mockResolvedValueOnce([{ id: 12, state: 'complete', filename: 'finished.zip' }]);
    const pending = downloadReconciliationZip({
      bytes: ZIP,
      bundleId: BUNDLE_ID,
      downloads: h.downloads,
      runtime: {},
      objectUrls: h.objectUrls,
      terminalTimeoutMs: 10,
      deferredCleanupMs: 100,
    });
    h.callback(12);
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toEqual({
      status: 'confirmed',
      downloadId: 12,
      observedFileName: 'finished.zip',
    });
    expect(h.downloads.search).toHaveBeenCalledTimes(2);
    expect(h.objectUrls.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('does not let an older timeout search downgrade a concurrent complete event', async () => {
    vi.useFakeTimers();
    const h = harness();
    let resolveTimeoutSearch!: (
      value: Array<{ id: number; state: string; filename?: string }>
    ) => void;
    const timeoutSearch = new Promise<Array<{ id: number; state: string; filename?: string }>>(
      resolve => {
        resolveTimeoutSearch = resolve;
      }
    );
    const unexpectedSearch = new Promise<Array<{ id: number; state: string }>>(() => {});
    vi.mocked(h.downloads.search)
      .mockResolvedValueOnce([{ id: 13, state: 'in_progress' }])
      .mockReturnValueOnce(timeoutSearch)
      .mockReturnValue(unexpectedSearch);
    const pending = downloadReconciliationZip({
      bytes: ZIP,
      bundleId: BUNDLE_ID,
      downloads: h.downloads,
      runtime: {},
      objectUrls: h.objectUrls,
      terminalTimeoutMs: 10,
      deferredCleanupMs: 100,
    });
    h.callback(13);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10);
    h.change(13, 'complete');
    resolveTimeoutSearch([{ id: 13, state: 'in_progress' }]);

    await expect(pending).resolves.toEqual({
      status: 'confirmed',
      downloadId: 13,
      observedFileName: null,
    });
    expect(h.objectUrls.revokeObjectURL).toHaveBeenCalledOnce();
    expect(h.downloads.search).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed bundle IDs, ZIP bytes and raised timeouts before dispatch', async () => {
    const h = harness();
    for (const input of [
      { bytes: ZIP, bundleId: 'bad' },
      { bytes: new Uint8Array(22), bundleId: BUNDLE_ID },
      { bytes: ZIP, bundleId: BUNDLE_ID, terminalTimeoutMs: 120_001 },
    ]) {
      await expect(
        downloadReconciliationZip({
          ...input,
          downloads: h.downloads,
          runtime: {},
          objectUrls: h.objectUrls,
        })
      ).resolves.toMatchObject({ status: 'failed', error: 'start-failed' });
    }
    expect(h.downloads.download).not.toHaveBeenCalled();
  });
});
