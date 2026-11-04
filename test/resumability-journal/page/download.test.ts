import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createJournalDownloader,
  DOWNLOAD_LATE_MS,
  DOWNLOAD_SEARCH_MS,
  DOWNLOAD_TIMEOUT_MS,
} from '../../../src/resumability-journal/page/download';
import { deferred } from '../../snapshot-catalog/fixtures';

const bytes = new TextEncoder().encode('{"schema":"liska-resumability-journal/1"}\n');
let listener: (delta: chrome.downloads.DownloadDelta) => void;
let callback: (id?: number) => void;
const emit = (id: number, state: string) =>
  listener({ id, state: { current: state } } as chrome.downloads.DownloadDelta);
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(chrome.downloads.onChanged.addListener).mockImplementation(value => {
    listener = value;
  });
  vi.mocked(chrome.downloads.download).mockImplementation((_options, value) => {
    callback = value!;
    return undefined as never;
  });
  vi.mocked(chrome.downloads.search).mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('journal exact browser download states', () => {
  it('snapshots exact private bytes, uses fixed filename and counts only the matching terminal ID', async () => {
    const downloader = createJournalDownloader();
    const input = bytes.slice();
    const pending = downloader.save(input);
    input.fill(0);
    const options = vi.mocked(chrome.downloads.download).mock.calls[0][0];
    expect(options).toMatchObject({
      filename: 'liska-resumability-journal.json',
      saveAs: true,
      conflictAction: 'uniquify',
    });
    expect(atob(options.url.split(',')[1])).toBe(new TextDecoder().decode(bytes));
    callback(42);
    emit(41, 'complete');
    emit(42, 'in_progress');
    emit(42, 'complete');
    expect(await pending).toBe('confirmed');
    expect(chrome.downloads.onChanged.removeListener).toHaveBeenCalledWith(listener);
    await downloader.save(bytes);
    expect(chrome.downloads.download).toHaveBeenCalledOnce();
  });
  it('handles early matching complete/interrupted events without trusting unrelated IDs', async () => {
    for (const state of ['complete', 'interrupted']) {
      const downloader = createJournalDownloader();
      const pending = downloader.save(bytes);
      emit(8, 'complete');
      emit(9, state);
      callback(9);
      expect(await pending).toBe(state === 'complete' ? 'confirmed' : 'failure');
      downloader.reset();
    }
  });
  it('uses exact-ID search for already completed downloads', async () => {
    vi.mocked(chrome.downloads.search).mockResolvedValue([
      { id: 2, state: 'complete' },
      { id: 1, state: 'interrupted' },
    ] as chrome.downloads.DownloadItem[]);
    const downloader = createJournalDownloader();
    const pending = downloader.save(bytes);
    callback(1);
    expect(await pending).toBe('failure');
    expect(chrome.downloads.search).toHaveBeenCalledWith({ id: 1 });
  });
  it('reports unknown after timeout without retry, and accepts only a late exact terminal', async () => {
    const late = vi.fn();
    const downloader = createJournalDownloader(late);
    const pending = downloader.save(bytes);
    callback(5);
    await vi.advanceTimersByTimeAsync(DOWNLOAD_TIMEOUT_MS + DOWNLOAD_SEARCH_MS);
    expect(await pending).toBe('unknown');
    expect(chrome.downloads.download).toHaveBeenCalledOnce();
    emit(7, 'complete');
    expect(late).not.toHaveBeenCalled();
    emit(5, 'complete');
    expect(late).toHaveBeenCalledWith('confirmed');
    await downloader.save(bytes);
    expect(chrome.downloads.download).toHaveBeenCalledOnce();
  });
  it('has bounded late observers and bounds a stalled search', async () => {
    vi.mocked(chrome.downloads.search).mockImplementation(() => new Promise(() => {}));
    const downloader = createJournalDownloader();
    const pending = downloader.save(bytes);
    callback(5);
    await vi.advanceTimersByTimeAsync(DOWNLOAD_TIMEOUT_MS + DOWNLOAD_SEARCH_MS);
    expect(await pending).toBe('unknown');
    await vi.advanceTimersByTimeAsync(DOWNLOAD_LATE_MS);
    expect(chrome.downloads.onChanged.removeListener).toHaveBeenCalledOnce();
  });
  it('does not trust ID assignment, missing IDs, runtime errors or native dispatch exceptions', async () => {
    let downloader = createJournalDownloader();
    let pending = downloader.save(bytes);
    callback(undefined);
    expect(await pending).toBe('failure');
    downloader.reset();
    downloader = createJournalDownloader();
    pending = downloader.save(bytes);
    Object.defineProperty(chrome.runtime, 'lastError', {
      value: { message: 'PRIVATE_NATIVE_ERROR' },
      writable: true,
      configurable: true,
    });
    callback(3);
    expect(await pending).toBe('failure');
    downloader.reset();
    chrome.runtime.lastError = undefined;
    vi.mocked(chrome.downloads.download).mockImplementation(() => {
      throw new Error('PRIVATE_NATIVE_ERROR');
    });
    downloader = createJournalDownloader();
    expect(await downloader.save(bytes)).toBe('unknown');
    await downloader.save(bytes);
    downloader.reset();
  });
  it('reset/dispose resolves pending unknown, removes listeners and fences late callback/search', async () => {
    const search = deferred<chrome.downloads.DownloadItem[]>();
    vi.mocked(chrome.downloads.search).mockImplementation(() => search.promise);
    const late = vi.fn();
    const downloader = createJournalDownloader(late);
    const pending = downloader.save(bytes);
    callback(9);
    const previous = listener;
    downloader.reset();
    expect(await pending).toBe('unknown');
    previous({ id: 9, state: { current: 'complete' } });
    callback(9);
    search.resolve([{ id: 9, state: 'complete' }] as chrome.downloads.DownloadItem[]);
    await Promise.resolve();
    expect(late).not.toHaveBeenCalled();
  });
  it('bounds bytes and synchronous exception handling without dispatch or retry', async () => {
    const downloader = createJournalDownloader();
    expect(await downloader.save(new Uint8Array())).toBe('failure');
    expect(await downloader.save(new Uint8Array(8 * 1024 * 1024 + 1))).toBe('failure');
    expect(chrome.downloads.download).not.toHaveBeenCalled();
    const pending = downloader.save(bytes);
    await vi.advanceTimersByTimeAsync(DOWNLOAD_TIMEOUT_MS);
    expect(await pending).toBe('unknown');
    downloader.reset();
  });
});
