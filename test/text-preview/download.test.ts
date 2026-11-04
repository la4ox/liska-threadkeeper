import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadSelectedText, textPreviewFilename } from '../../src/text-preview/download';

let changed: (delta: chrome.downloads.DownloadDelta) => void;
let callback: (id?: number) => void;
const originalURL = URL;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:private-preview');
      static revokeObjectURL = vi.fn();
    }
  );
  vi.mocked(chrome.downloads.onChanged.addListener).mockImplementation(listener => {
    changed = listener;
  });
  vi.mocked(chrome.downloads.search).mockResolvedValue([]);
  vi.mocked(chrome.downloads.download).mockImplementation((_options, done) => {
    callback = done!;
    return undefined as never;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('URL', originalURL);
  vi.useRealTimers();
});
function terminal(id: number, state: 'complete' | 'interrupted') {
  changed({ id, state: { current: state } });
}

describe('selected Text Blob downloads', () => {
  it('uses a private Blob, saveAs and an onChanged-confirmed terminal completion', async () => {
    const attempt = downloadSelectedText('exact text 🦊\n', 'Test / title');
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(blob.size).toBe(new TextEncoder().encode('exact text 🦊\n').byteLength);
    expect(chrome.downloads.download).toHaveBeenCalledWith(
      { url: 'blob:private-preview', filename: 'Test _ title-selection.txt', saveAs: true },
      expect.any(Function)
    );
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    callback(23);
    terminal(99, 'complete');
    await vi.advanceTimersByTimeAsync(0);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    terminal(23, 'complete');
    await expect(attempt.result).resolves.toBe('success');
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:private-preview');
    expect(chrome.downloads.onChanged.removeListener).toHaveBeenCalledExactlyOnceWith(changed);
    attempt.dispose();
    terminal(23, 'interrupted');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
  it('reports interruption and cleans up without retry', async () => {
    const attempt = downloadSelectedText('text', null);
    callback(1);
    terminal(1, 'interrupted');
    await expect(attempt.result).resolves.toBe('failure');
    expect(chrome.downloads.download).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
  it.each(['callback', 'terminal'] as const)(
    'reports an unknown missing %s outcome and releases ownership',
    async missing => {
      const attempt = downloadSelectedText('text', null);
      if (missing === 'terminal') callback(1);
      await vi.advanceTimersByTimeAsync(120_000);
      await expect(attempt.result).resolves.toBe('unknown');
      expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
      expect(chrome.downloads.onChanged.removeListener).toHaveBeenCalledOnce();
      callback(1);
      terminal(1, 'complete');
      expect(chrome.downloads.download).toHaveBeenCalledOnce();
    }
  );
  it('does not claim a saved file for callback errors or invalid IDs', async () => {
    const attempt = downloadSelectedText('text', null);
    callback();
    await expect(attempt.result).resolves.toBe('unknown');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
  it('releases the Blob and listener when the browser rejects download synchronously', async () => {
    vi.mocked(chrome.downloads.download).mockImplementation(() => {
      throw new Error('private browser detail');
    });

    const attempt = downloadSelectedText('text', null);
    await expect(attempt.result).resolves.toBe('unknown');
    expect(chrome.downloads.onChanged.removeListener).toHaveBeenCalledExactlyOnceWith(changed);
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(chrome.downloads.search).not.toHaveBeenCalled();
    expect(chrome.downloads.download).toHaveBeenCalledOnce();
  });
  it('reads back only its exact ID to reconcile an event before the callback', async () => {
    vi.mocked(chrome.downloads.search).mockResolvedValue([
      { id: 9, state: 'complete' } as chrome.downloads.DownloadItem,
    ]);
    const attempt = downloadSelectedText('text', null);
    terminal(9, 'complete');
    callback(9);
    await expect(attempt.result).resolves.toBe('success');
    expect(chrome.downloads.search).toHaveBeenCalledExactlyOnceWith({ id: 9 });
  });
  it('disposes a live attempt when its page lease is cleared', async () => {
    const attempt = downloadSelectedText('text', null);
    callback(7);
    attempt.dispose();
    await expect(attempt.result).resolves.toBe('unknown');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(chrome.downloads.onChanged.removeListener).toHaveBeenCalledOnce();
  });
  it('cleans up a failed browser read-back without an unhandled callback error or retry', async () => {
    vi.mocked(chrome.downloads.search).mockImplementation(() => {
      throw new Error('browser gone');
    });
    const attempt = downloadSelectedText('text', null);
    callback(8);
    await expect(attempt.result).resolves.toBe('unknown');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(chrome.downloads.download).toHaveBeenCalledOnce();
  });
  it.each([null, '', '...', 'CON', 'aux.txt', 'LPT1', ' NUL '])(
    'uses a fixed fallback for %s',
    title => {
      expect(textPreviewFilename(title)).toBe('liska-selected-text-selection.txt');
    }
  );
  it('is title-derived, deterministic, bounded and never contains path separators or controls', () => {
    const title = '../secret\\file:"<>|?*\u0000\n';
    expect(textPreviewFilename(title)).toBe(textPreviewFilename(title));
    expect(textPreviewFilename(title)).not.toMatch(/[\\/:\u0000\n]/);
    expect(textPreviewFilename('x'.repeat(300))).toHaveLength(114);
    expect(textPreviewFilename('🦊')).toBe('🦊-selection.txt');
  });
});
