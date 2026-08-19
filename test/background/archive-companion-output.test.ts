import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bytesToBase64 } from '../../src/lib/image-utils';
import type { ArchiveCompanionArtifact, ExtensionSettings } from '../../src/lib/types';

const mocks = vi.hoisted(() => ({
  saveNote: vi.fn(),
  saveArchive: vi.fn(),
}));

vi.mock('../../src/background/obsidian-handlers', () => ({
  handleSave: (...args: unknown[]) => mocks.saveNote(...args),
  handleSaveArchiveCompanion: (...args: unknown[]) => mocks.saveArchive(...args),
}));

import {
  handleMultiOutput,
  handlePersistArchiveCompanion,
  resetOffscreenStateForTesting,
} from '../../src/background/output-handlers';

const CAPTURE_ID = 'capture-chatgpt-11111111-2222-4333-8444-555555555555';
const CONVERSATION_KEY = 'a'.repeat(64);
const settings = {} as ExtensionSettings;
const clipboardSettings: ExtensionSettings = {
  templateOptions: {
    includeId: true,
    includeTitle: true,
    includeSource: true,
    includeDates: true,
    includeTags: true,
    includeMessageCount: true,
    messageFormat: 'callout',
    userCalloutType: 'QUESTION',
    assistantCalloutType: 'NOTE',
  },
} as ExtensionSettings;
const clipboardNote = {
  fileName: 'note.md',
  body: 'body',
  contentHash: 'hash',
  frontmatter: {
    id: 'id',
    title: 'title',
    source: 'chatgpt',
    url: 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd',
    created: '2026-08-19T00:00:00.000Z',
    modified: '2026-08-19T00:00:00.000Z',
    tags: [],
    message_count: 1,
  },
};

async function artifact(kind: ArchiveCompanionArtifact['kind']): Promise<ArchiveCompanionArtifact> {
  const bytes = new TextEncoder().encode(`{"kind":"${kind}"}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), value =>
    value.toString(16).padStart(2, '0')
  ).join('');
  const relativePath =
    kind === 'raw'
      ? 'responses/conversation.json'
      : kind === 'manifest'
        ? 'manifest.json'
        : 'canonical/liska-thread-1.json';
  return {
    kind,
    relativePath,
    mediaType: 'application/json',
    byteLength: bytes.byteLength,
    sha256,
    bodyBase64: bytesToBase64(bytes),
  };
}

async function message(kind: ArchiveCompanionArtifact['kind'], outputs: ('file' | 'obsidian')[]) {
  return {
    action: 'persistArchiveCompanion' as const,
    noteFileName: 'local-note.md',
    source: 'chatgpt' as const,
    captureId: CAPTURE_ID,
    conversationKey: CONVERSATION_KEY,
    artifact: await artifact(kind),
    outputs,
  };
}

describe('archive companion durable outputs', () => {
  let onChanged: ((delta: chrome.downloads.DownloadDelta) => void) | undefined;

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    resetOffscreenStateForTesting();
    vi.clearAllMocks();
    onChanged = undefined;
    mocks.saveNote.mockResolvedValue({ success: true });
    mocks.saveArchive.mockResolvedValue({ success: true });
    vi.mocked(chrome.runtime.getContexts).mockResolvedValue([]);
    vi.mocked(chrome.offscreen.createDocument).mockResolvedValue();
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((request: unknown) => {
      const action = (request as { action?: string }).action;
      if (action === 'archiveBlobCreate') {
        return Promise.resolve({ success: true, url: 'blob:chrome-extension://test/archive' });
      }
      if (action === 'archiveBlobRevoke') return Promise.resolve({ success: true });
      return Promise.resolve(undefined);
    });
    vi.mocked(chrome.downloads.onChanged.addListener).mockImplementation(listener => {
      onChanged = listener;
    });
    vi.mocked(chrome.downloads.download).mockImplementation((_options, callback) => {
      callback?.(17);
      setTimeout(() => {
        onChanged?.({ id: 17, state: { current: 'complete' } } as chrome.downloads.DownloadDelta);
      }, 0);
      return 17 as unknown as ReturnType<typeof chrome.downloads.download>;
    });
  });

  function searchState(
    id: number,
    state: chrome.downloads.DownloadState
  ): chrome.downloads.DownloadItem[] {
    return [{ id, state } as chrome.downloads.DownloadItem];
  }

  async function waitForDownloadStart(): Promise<void> {
    await vi.waitFor(() => expect(chrome.downloads.download).toHaveBeenCalled());
  }

  it('downloads all three companion files through Blob URLs with opaque nested paths', async () => {
    for (const kind of ['raw', 'manifest', 'canonical'] as const) {
      const result = await handlePersistArchiveCompanion(await message(kind, ['file']), settings);
      expect(result.allSuccessful).toBe(true);
    }

    const downloads = vi.mocked(chrome.downloads.download).mock.calls.map(call => call[0]);
    expect(downloads).toHaveLength(3);
    expect(downloads.map(download => download.url)).toEqual([
      'blob:chrome-extension://test/archive',
      'blob:chrome-extension://test/archive',
      'blob:chrome-extension://test/archive',
    ]);
    expect(downloads.map(download => download.filename)).toEqual([
      `_liska-archive/${CONVERSATION_KEY}/${CAPTURE_ID}/responses/conversation.json`,
      `_liska-archive/${CONVERSATION_KEY}/${CAPTURE_ID}/manifest.json`,
      `_liska-archive/${CONVERSATION_KEY}/${CAPTURE_ID}/canonical/liska-thread-1.json`,
    ]);
    expect(downloads.every(download => !download.url.startsWith('data:'))).toBe(true);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archiveBlobCreate', bodyBase64: expect.any(String) })
    );
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archiveBlobRevoke', url: expect.stringMatching(/^blob:/) })
    );
  });

  it('writes the same verified companion to both selected durable outputs', async () => {
    const request = await message('canonical', ['file', 'obsidian']);
    const result = await handlePersistArchiveCompanion(request, settings);

    expect(result.allSuccessful).toBe(true);
    expect(mocks.saveArchive).toHaveBeenCalledWith(
      settings,
      expect.objectContaining({
        source: 'chatgpt',
        captureId: CAPTURE_ID,
        conversationKey: CONVERSATION_KEY,
        artifact: request.artifact,
      })
    );
    expect(chrome.downloads.download).toHaveBeenCalledOnce();
  });

  it('keeps a successful destination when its sibling companion write fails', async () => {
    mocks.saveArchive.mockResolvedValueOnce({
      success: false,
      error: 'Archive companion write failed',
    });
    const result = await handlePersistArchiveCompanion(
      await message('manifest', ['file', 'obsidian']),
      settings
    );

    expect(result.anySuccessful).toBe(true);
    expect(result.allSuccessful).toBe(false);
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ destination: 'file', success: true }),
        expect.objectContaining({ destination: 'obsidian', success: false }),
      ])
    );
  });

  it('reconciles a terminal download event delivered before the download callback ID', async () => {
    vi.mocked(chrome.downloads.download).mockImplementation((_options, callback) => {
      onChanged?.({ id: 29, state: { current: 'complete' } } as chrome.downloads.DownloadDelta);
      callback?.(29);
      return 29 as unknown as ReturnType<typeof chrome.downloads.download>;
    });

    const result = await handlePersistArchiveCompanion(await message('raw', ['file']), settings);

    expect(result.results).toEqual([{ destination: 'file', success: true }]);
    expect(chrome.downloads.search).toHaveBeenCalledWith({ id: 29 });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archiveBlobRevoke' })
    );
  });

  it('cancels a timed-out active download and waits for an interrupted confirmation before Blob release', async () => {
    vi.useFakeTimers();
    vi.mocked(chrome.downloads.download).mockImplementation((_options, callback) => {
      callback?.(31);
      return 31 as unknown as ReturnType<typeof chrome.downloads.download>;
    });
    const states: chrome.downloads.DownloadState[] = ['in_progress', 'in_progress', 'interrupted'];
    vi.mocked(chrome.downloads.search).mockImplementation(async () =>
      searchState(31, states.shift()!)
    );

    const pending = handlePersistArchiveCompanion(await message('raw', ['file']), settings);
    await waitForDownloadStart();
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await pending;

    expect(chrome.downloads.cancel).toHaveBeenCalledWith(31);
    expect(result.results).toEqual([
      { destination: 'file', success: false, error: 'Archive download was interrupted' },
    ]);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archiveBlobRevoke' })
    );
    vi.useRealTimers();
  });

  it('keeps the Blob observer and lease after unconfirmed cancellation, then releases on a later terminal event', async () => {
    vi.useFakeTimers();
    vi.mocked(chrome.downloads.download).mockImplementation((_options, callback) => {
      callback?.(37);
      return 37 as unknown as ReturnType<typeof chrome.downloads.download>;
    });
    vi.mocked(chrome.downloads.search).mockResolvedValue(searchState(37, 'in_progress'));

    const pending = handlePersistArchiveCompanion(await message('raw', ['file']), settings);
    await waitForDownloadStart();
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await pending;

    expect(chrome.downloads.cancel).toHaveBeenCalledWith(37);
    expect(result.results).toEqual([
      {
        destination: 'file',
        success: false,
        error: 'Archive download cancellation was not confirmed',
      },
    ]);
    expect(
      vi
        .mocked(chrome.runtime.sendMessage)
        .mock.calls.some(call => (call[0] as { action?: string }).action === 'archiveBlobRevoke')
    ).toBe(false);
    expect(chrome.downloads.onChanged.removeListener).not.toHaveBeenCalled();

    onChanged?.({ id: 37, state: { current: 'interrupted' } } as chrome.downloads.DownloadDelta);
    await vi.advanceTimersByTimeAsync(0);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archiveBlobRevoke' })
    );
    expect(chrome.downloads.onChanged.removeListener).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(chrome.offscreen.closeDocument).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('keeps the observer and lease when the download callback is late, then reconciles its terminal event', async () => {
    vi.useFakeTimers();
    let callback: ((downloadId: number | undefined) => void) | undefined;
    vi.mocked(chrome.downloads.download).mockImplementation((_options, nextCallback) => {
      callback = nextCallback;
      return 43 as unknown as ReturnType<typeof chrome.downloads.download>;
    });

    const pending = handlePersistArchiveCompanion(await message('raw', ['file']), settings);
    await waitForDownloadStart();
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await pending;

    expect(result.results[0]).toMatchObject({
      success: false,
      error: 'Archive download did not complete',
    });
    expect(chrome.downloads.onChanged.removeListener).not.toHaveBeenCalled();

    callback?.(43);
    onChanged?.({ id: 43, state: { current: 'complete' } } as chrome.downloads.DownloadDelta);
    await vi.advanceTimersByTimeAsync(0);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archiveBlobRevoke' })
    );
    expect(chrome.downloads.onChanged.removeListener).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('revokes a late Blob URL after creation timeout before releasing its lease', async () => {
    vi.useFakeTimers();
    let resolveCreate!: (response: unknown) => void;
    let markCreateStarted!: () => void;
    const createStarted = new Promise<void>(resolve => {
      markCreateStarted = resolve;
    });
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((request: unknown) => {
      const action = (request as { action?: string }).action;
      if (action === 'archiveBlobCreate') {
        markCreateStarted();
        return new Promise(resolve => {
          resolveCreate = resolve;
        });
      }
      if (action === 'archiveBlobRevoke') return Promise.resolve({ success: true });
      return Promise.resolve(undefined);
    });

    const pending = handlePersistArchiveCompanion(await message('raw', ['file']), settings);
    await createStarted;
    await vi.advanceTimersByTimeAsync(5_000);
    await pending;
    resolveCreate({ success: true, url: 'blob:chrome-extension://test/late-archive' });
    await Promise.resolve();
    await Promise.resolve();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'archiveBlobRevoke',
      target: 'offscreen',
      url: 'blob:chrome-extension://test/late-archive',
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(chrome.offscreen.closeDocument).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('cancels a pending offscreen close while a later Blob creation is in flight', async () => {
    vi.useFakeTimers();
    let createCalls = 0;
    let resolveSecondCreate!: (response: unknown) => void;
    let markSecondCreateStarted!: () => void;
    const secondCreateStarted = new Promise<void>(resolve => {
      markSecondCreateStarted = resolve;
    });
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((request: unknown) => {
      const action = (request as { action?: string }).action;
      if (action === 'archiveBlobCreate') {
        createCalls += 1;
        if (createCalls === 1) {
          return Promise.resolve({ success: true, url: 'blob:chrome-extension://test/first' });
        }
        markSecondCreateStarted();
        return new Promise(resolve => {
          resolveSecondCreate = resolve;
        });
      }
      if (action === 'archiveBlobRevoke') return Promise.resolve({ success: true });
      return Promise.resolve(undefined);
    });
    vi.mocked(chrome.downloads.download).mockImplementation((_options, callback) => {
      callback?.(41);
      onChanged?.({ id: 41, state: { current: 'complete' } } as chrome.downloads.DownloadDelta);
      return 41 as unknown as ReturnType<typeof chrome.downloads.download>;
    });

    await handlePersistArchiveCompanion(await message('raw', ['file']), settings);
    await vi.advanceTimersByTimeAsync(4_000);
    const second = handlePersistArchiveCompanion(await message('manifest', ['file']), settings);
    await secondCreateStarted;
    await vi.advanceTimersByTimeAsync(1_001);

    expect(chrome.offscreen.closeDocument).not.toHaveBeenCalled();
    resolveSecondCreate({ success: true, url: 'blob:chrome-extension://test/second' });
    await second;
    vi.useRealTimers();
  });

  it('does not close the shared offscreen document while a clipboard lease remains after archive release', async () => {
    vi.useFakeTimers();
    let resolveClipboard!: (response: unknown) => void;
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((request: unknown) => {
      const action = (request as { action?: string }).action;
      if (action === 'archiveBlobCreate') {
        return Promise.resolve({ success: true, url: 'blob:chrome-extension://test/archive' });
      }
      if (action === 'archiveBlobRevoke') return Promise.resolve({ success: true });
      if (action === 'clipboardWrite') {
        return new Promise(resolve => {
          resolveClipboard = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    vi.mocked(chrome.downloads.download).mockImplementation((_options, callback) => {
      callback?.(47);
      onChanged?.({ id: 47, state: { current: 'complete' } } as chrome.downloads.DownloadDelta);
      return 47 as unknown as ReturnType<typeof chrome.downloads.download>;
    });

    const clipboard = handleMultiOutput(clipboardNote, ['clipboard'], clipboardSettings);
    await vi.advanceTimersByTimeAsync(0);
    await handlePersistArchiveCompanion(await message('raw', ['file']), settings);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(chrome.offscreen.closeDocument).not.toHaveBeenCalled();

    resolveClipboard({ success: true });
    await clipboard;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(chrome.offscreen.closeDocument).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('reports a note-save exception as an Obsidian output failure', async () => {
    mocks.saveNote.mockRejectedValueOnce(new Error('vault write unavailable'));

    const result = await handleMultiOutput(clipboardNote, ['obsidian'], clipboardSettings);

    expect(result.results).toEqual([
      { destination: 'obsidian', success: false, error: 'vault write unavailable' },
    ]);
  });

  it('rejects an archive whose decoded byte length disagrees with its envelope', async () => {
    const request = await message('raw', ['file', 'obsidian']);
    request.artifact.byteLength += 1;

    const result = await handlePersistArchiveCompanion(request, settings);

    expect(result).toEqual({
      results: [
        {
          destination: 'file',
          success: false,
          error: 'Archive companion integrity verification failed',
        },
        {
          destination: 'obsidian',
          success: false,
          error: 'Archive companion integrity verification failed',
        },
      ],
      allSuccessful: false,
      anySuccessful: false,
    });
    expect(chrome.downloads.download).not.toHaveBeenCalled();
    expect(mocks.saveArchive).not.toHaveBeenCalled();
  });

  it('fails closed when the integrity digest is unavailable', async () => {
    const request = await message('manifest', ['file']);
    const digest = vi
      .spyOn(crypto.subtle, 'digest')
      .mockRejectedValueOnce(new Error('digest error'));

    try {
      const result = await handlePersistArchiveCompanion(request, settings);

      expect(result.results).toEqual([
        {
          destination: 'file',
          success: false,
          error: 'Archive companion integrity verification failed',
        },
      ]);
      expect(chrome.downloads.download).not.toHaveBeenCalled();
    } finally {
      digest.mockRestore();
    }
  });

  it('rejects a decoder exception without exposing archive output details', async () => {
    const request = await message('canonical', ['file', 'obsidian']);
    const originalAtob = globalThis.atob;
    Object.defineProperty(globalThis, 'atob', {
      value: vi.fn(() => {
        throw new Error('decoder failure');
      }),
      configurable: true,
      writable: true,
    });

    try {
      const result = await handlePersistArchiveCompanion(request, settings);

      expect(result.allSuccessful).toBe(false);
      expect(result.results).toEqual([
        expect.objectContaining({
          destination: 'file',
          success: false,
          error: 'Archive companion integrity verification failed',
        }),
        expect.objectContaining({
          destination: 'obsidian',
          success: false,
          error: 'Archive companion integrity verification failed',
        }),
      ]);
    } finally {
      Object.defineProperty(globalThis, 'atob', {
        value: originalAtob,
        configurable: true,
        writable: true,
      });
    }
  });

  it('turns an Obsidian companion rejection into a settled output failure', async () => {
    mocks.saveArchive.mockRejectedValueOnce(new Error('vault rejected write'));

    const result = await handlePersistArchiveCompanion(
      await message('canonical', ['obsidian']),
      settings
    );

    expect(result).toEqual({
      results: [
        { destination: 'obsidian', success: false, error: 'Archive companion write failed' },
      ],
      allSuccessful: false,
      anySuccessful: false,
    });
  });

  it('reports a download-start failure and still releases the Blob lease', async () => {
    vi.mocked(chrome.downloads.download).mockImplementation((_options, callback) => {
      chrome.runtime.lastError = { message: 'downloads permission denied' };
      callback?.(undefined);
      return undefined as unknown as ReturnType<typeof chrome.downloads.download>;
    });

    const result = await handlePersistArchiveCompanion(await message('raw', ['file']), settings);

    expect(result.results).toEqual([
      { destination: 'file', success: false, error: 'Archive download could not be started' },
    ]);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archiveBlobRevoke' })
    );
  });

  it('handles an offscreen setup failure as a file output error', async () => {
    vi.mocked(chrome.runtime.getContexts).mockRejectedValueOnce(new Error('offscreen unavailable'));

    const result = await handlePersistArchiveCompanion(await message('raw', ['file']), settings);

    expect(result.results).toEqual([
      { destination: 'file', success: false, error: 'Archive download setup failed' },
    ]);
    expect(chrome.downloads.download).not.toHaveBeenCalled();
  });

  it('reconciles a terminal search result after an initial Downloads search error', async () => {
    vi.useFakeTimers();
    vi.mocked(chrome.downloads.download).mockImplementation((_options, callback) => {
      callback?.(53);
      return 53 as unknown as ReturnType<typeof chrome.downloads.download>;
    });
    vi.mocked(chrome.downloads.search)
      .mockRejectedValueOnce(new Error('search unavailable'))
      .mockResolvedValueOnce(searchState(53, 'complete'));

    const pending = handlePersistArchiveCompanion(await message('raw', ['file']), settings);
    await waitForDownloadStart();
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await pending;

    expect(result.results).toEqual([{ destination: 'file', success: true }]);
    expect(chrome.downloads.search).toHaveBeenCalledTimes(2);
    expect(chrome.downloads.cancel).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('keeps ownership when cancellation finds a non-terminal download state', async () => {
    vi.useFakeTimers();
    vi.mocked(chrome.downloads.download).mockImplementation((_options, callback) => {
      callback?.(59);
      return 59 as unknown as ReturnType<typeof chrome.downloads.download>;
    });
    vi.mocked(chrome.downloads.search).mockResolvedValue([]);

    const pending = handlePersistArchiveCompanion(await message('raw', ['file']), settings);
    await waitForDownloadStart();
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await pending;

    expect(result.results).toEqual([
      { destination: 'file', success: false, error: 'Archive download did not complete' },
    ]);
    expect(chrome.downloads.onChanged.removeListener).not.toHaveBeenCalled();

    onChanged?.({ id: 59, state: { current: 'interrupted' } } as chrome.downloads.DownloadDelta);
    await vi.advanceTimersByTimeAsync(0);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'archiveBlobRevoke' })
    );
    vi.useRealTimers();
  });

  it('ignores a rejected close of an already-gone offscreen document', async () => {
    vi.useFakeTimers();
    vi.mocked(chrome.downloads.download).mockImplementation((_options, callback) => {
      callback?.(61);
      onChanged?.({ id: 61, state: { current: 'complete' } } as chrome.downloads.DownloadDelta);
      return 61 as unknown as ReturnType<typeof chrome.downloads.download>;
    });
    vi.mocked(chrome.offscreen.closeDocument).mockRejectedValueOnce(new Error('already closed'));

    const result = await handlePersistArchiveCompanion(await message('raw', ['file']), settings);
    expect(result.allSuccessful).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(chrome.offscreen.closeDocument).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('releases the lease after a Blob creation timeout whose late response rejects', async () => {
    vi.useFakeTimers();
    let rejectCreate!: (error: unknown) => void;
    let markCreateStarted!: () => void;
    const createStarted = new Promise<void>(resolve => {
      markCreateStarted = resolve;
    });
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((request: unknown) => {
      const action = (request as { action?: string }).action;
      if (action === 'archiveBlobCreate') {
        markCreateStarted();
        return new Promise((_resolve, reject) => {
          rejectCreate = reject;
        });
      }
      if (action === 'archiveBlobRevoke') return Promise.resolve({ success: true });
      return Promise.resolve(undefined);
    });

    const pending = handlePersistArchiveCompanion(await message('raw', ['file']), settings);
    await createStarted;
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await pending;

    expect(result.results).toEqual([
      { destination: 'file', success: false, error: 'Archive download setup failed' },
    ]);
    rejectCreate(new Error('late create failed'));
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(chrome.offscreen.closeDocument).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
