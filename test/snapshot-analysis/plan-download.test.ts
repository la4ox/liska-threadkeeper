import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createReportDownloader,
  PLAN_DOWNLOAD_TIMEOUT_MS,
  PLAN_DOWNLOAD_SEARCH_MS,
  PLAN_DOWNLOAD_LATE_MS,
} from '../../src/snapshot-analysis/plan-download';
import { encodeSnapshotAnalysisPlan } from '../../src/archive/snapshots';
import { plan, deferred, CANARY } from './fixtures';

let listener: (delta: chrome.downloads.DownloadDelta) => void;
let callback: (id: number | undefined) => void;
const change = (id: number, state: string) =>
  listener({ id, state: { current: state } } as chrome.downloads.DownloadDelta);
const bytes = () => encodeSnapshotAnalysisPlan(plan());

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(chrome.downloads.search).mockReset().mockResolvedValue([]);
  vi.mocked(chrome.downloads.download)
    .mockReset()
    .mockImplementation((_options, cb) => {
      callback = cb!;
      return undefined as never;
    });
  vi.mocked(chrome.downloads.onChanged.addListener).mockImplementation(value => {
    listener = value;
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('snapshot report Save As', () => {
  it('sends exact once-prepared JSON bytes, fixed filename and explicit Save As; ID is not completion', async () => {
    const saver = createReportDownloader();
    const source = bytes();
    const before = source.slice();
    const result = saver.save(source);
    const settled = vi.fn();
    void result.then(settled);
    const options = vi.mocked(chrome.downloads.download).mock.calls[0][0];
    expect(options).toMatchObject({
      filename: 'liska-snapshot-analysis.json',
      saveAs: true,
      conflictAction: 'uniquify',
    });
    const base64 = options.url.split(',')[1];
    expect(Array.from(atob(base64), c => c.charCodeAt(0))).toEqual(Array.from(before));
    source.fill(1);
    callback(7);
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    change(7, 'complete');
    await expect(result).resolves.toBe('confirmed');
    expect(chrome.downloads.onChanged.removeListener).toHaveBeenCalledWith(listener);
  });

  it('observes listener-before-dispatch and terminal-before-ID', async () => {
    vi.mocked(chrome.downloads.download).mockImplementation((_options, cb) => {
      expect(chrome.downloads.onChanged.addListener).toHaveBeenCalledOnce();
      change(4, 'complete');
      cb!(4);
      return undefined as never;
    });
    await expect(createReportDownloader().save(bytes())).resolves.toBe('confirmed');
  });

  it('ignores unrelated IDs and tolerates many early events via exact-ID search', async () => {
    const result = createReportDownloader().save(bytes());
    for (let i = 0; i < 50; i++) change(i, 'complete');
    vi.mocked(chrome.downloads.search).mockResolvedValue([
      { id: 99, state: 'complete' },
    ] as chrome.downloads.DownloadItem[]);
    callback(99);
    await expect(result).resolves.toBe('confirmed');
    expect(chrome.downloads.search).toHaveBeenCalledWith({ id: 99 });
  });

  it('ignores wrong-ID search records and unrelated in-progress changes', async () => {
    vi.mocked(chrome.downloads.search).mockResolvedValue([
      { id: 8, state: 'complete' },
    ] as chrome.downloads.DownloadItem[]);
    const result = createReportDownloader().save(bytes());
    callback(7);
    change(8, 'complete');
    change(7, 'in_progress');
    await vi.advanceTimersByTimeAsync(PLAN_DOWNLOAD_TIMEOUT_MS + 1);
    await expect(result).resolves.toBe('unknown');
  });

  it.each(['interrupted', 'no-id', 'last-error'])(
    'reports explicit %s as failure without retry',
    async mode => {
      const result = createReportDownloader().save(bytes());
      if (mode === 'interrupted') {
        callback(7);
        change(7, 'interrupted');
      } else if (mode === 'no-id') callback(undefined);
      else {
        Object.assign(chrome.runtime, { lastError: { message: CANARY } });
        callback(undefined);
        Object.assign(chrome.runtime, { lastError: null });
      }
      await expect(result).resolves.toBe('failure');
      expect(chrome.downloads.download).toHaveBeenCalledOnce();
    }
  );

  it('reports thrown dispatch uncertainty as unknown and blocks duplicate attempts', async () => {
    vi.mocked(chrome.downloads.download).mockImplementation(() => {
      throw new Error(CANARY);
    });
    const saver = createReportDownloader();
    await expect(saver.save(bytes())).resolves.toBe('unknown');
    await expect(saver.save(bytes())).resolves.toBe('unknown');
    expect(chrome.downloads.download).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(PLAN_DOWNLOAD_LATE_MS);
    expect(chrome.downloads.onChanged.removeListener).toHaveBeenCalledOnce();
    saver.reset();
  });

  it('times out callback uncertainty but preserves bounded late-ID completion ownership', async () => {
    const late = vi.fn();
    const saver = createReportDownloader(late);
    const result = saver.save(bytes());
    await vi.advanceTimersByTimeAsync(PLAN_DOWNLOAD_TIMEOUT_MS);
    await expect(result).resolves.toBe('unknown');
    callback(7);
    change(7, 'complete');
    expect(late).toHaveBeenCalledExactlyOnceWith('confirmed');
    expect(chrome.downloads.download).toHaveBeenCalledOnce();
  });

  it.each(['rejected', 'stalled'])(
    'bounds %s search and returns unknown without retry',
    async mode => {
      if (mode === 'rejected')
        vi.mocked(chrome.downloads.search).mockRejectedValue(new Error(CANARY));
      else vi.mocked(chrome.downloads.search).mockReturnValue(new Promise(() => {}));
      const saver = createReportDownloader();
      const result = saver.save(bytes());
      callback(7);
      await vi.advanceTimersByTimeAsync(PLAN_DOWNLOAD_TIMEOUT_MS + PLAN_DOWNLOAD_SEARCH_MS + 1);
      await expect(result).resolves.toBe('unknown');
      await expect(saver.save(bytes())).resolves.toBe('unknown');
      expect(chrome.downloads.download).toHaveBeenCalledOnce();
      saver.reset();
    }
  );

  it('accepts terminal completion found by timeout reconciliation', async () => {
    vi.mocked(chrome.downloads.search)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 7, state: 'complete' }] as chrome.downloads.DownloadItem[]);
    const result = createReportDownloader().save(bytes());
    callback(7);
    await vi.advanceTimersByTimeAsync(PLAN_DOWNLOAD_TIMEOUT_MS);
    await expect(result).resolves.toBe('confirmed');
  });

  it('does not downgrade a terminal event during a delayed timeout search', async () => {
    const pending = deferred<chrome.downloads.DownloadItem[]>();
    vi.mocked(chrome.downloads.search)
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(pending.promise);
    const result = createReportDownloader().save(bytes());
    callback(7);
    await vi.advanceTimersByTimeAsync(PLAN_DOWNLOAD_TIMEOUT_MS);
    change(7, 'complete');
    pending.resolve([]);
    await expect(result).resolves.toBe('confirmed');
  });

  it('does not let old late callbacks contaminate a deliberate reset/new attempt', async () => {
    const late = vi.fn();
    const saver = createReportDownloader(late);
    const first = saver.save(bytes());
    const oldCallback = callback;
    const oldListener = listener;
    saver.reset();
    await expect(first).resolves.toBe('unknown');
    const second = saver.save(bytes());
    callback(8);
    oldCallback(7);
    oldListener({ id: 7, state: { current: 'complete' } });
    expect(late).not.toHaveBeenCalled();
    change(8, 'complete');
    await expect(second).resolves.toBe('confirmed');
  });

  it('consumes callback-scoped lastError even after reset makes the attempt stale', async () => {
    const saver = createReportDownloader();
    const result = saver.save(bytes());
    const staleCallback = callback;
    saver.reset();
    await expect(result).resolves.toBe('unknown');
    const original = Object.getOwnPropertyDescriptor(chrome.runtime, 'lastError');
    const getter = vi.fn(() => ({ message: CANARY }));
    Object.defineProperty(chrome.runtime, 'lastError', {
      configurable: true,
      get: getter,
    });

    try {
      staleCallback(undefined);
      expect(getter).toHaveBeenCalledOnce();
    } finally {
      if (original) Object.defineProperty(chrome.runtime, 'lastError', original);
      else delete (chrome.runtime as { lastError?: unknown }).lastError;
    }
  });

  it('ignores double Save before completion and enforces report bytes bound', async () => {
    const saver = createReportDownloader();
    const first = saver.save(bytes());
    await expect(saver.save(bytes())).resolves.toBe('unknown');
    expect(chrome.downloads.download).toHaveBeenCalledOnce();
    callback(7);
    change(7, 'complete');
    await first;
    await expect(saver.save(new Uint8Array(256 * 1024 + 1))).resolves.toBe('failure');
    await expect(saver.save(new Uint8Array())).resolves.toBe('failure');
    expect(chrome.downloads.download).toHaveBeenCalledOnce();
  });
});
