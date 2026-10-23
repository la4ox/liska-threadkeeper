import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionSettings, ObsidianNote, OutputDestination } from '../../src/lib/types';

const mocks = vi.hoisted(() => ({ saveNote: vi.fn() }));
vi.mock('../../src/background/obsidian-handlers', () => ({
  handleSave: (...args: unknown[]) => mocks.saveNote(...args),
  handleSaveArchiveCompanion: vi.fn(),
}));

const note: ObsidianNote = {
  fileName: 'branch-001.md',
  body: '# Привет, branch',
  contentHash: 'hash',
  frontmatter: {
    id: 'id',
    title: 'Branch',
    source: 'chatgpt',
    url: 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd',
    created: '2026-10-23T00:00:00.000Z',
    modified: '2026-10-23T00:00:00.000Z',
    tags: [],
    message_count: 1,
  },
};
const settings = {
  enableImageExport: false,
  templateOptions: {
    includeId: true,
    includeTitle: true,
    includeSource: true,
    includeDates: true,
    includeTags: true,
    includeMessageCount: true,
  },
} as ExtensionSettings;

describe('strict Markdown File downloads', () => {
  let handleMultiOutput: typeof import('../../src/background/output-handlers').handleMultiOutput;
  let listeners: Set<(delta: chrome.downloads.DownloadDelta) => void>;
  let items: Map<number, chrome.downloads.DownloadItem>;
  let nextId: number;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    listeners = new Set();
    items = new Map();
    nextId = 17;
    mocks.saveNote.mockResolvedValue({ success: true });
    vi.mocked(chrome.downloads.onChanged.addListener).mockImplementation(listener => {
      listeners.add(listener);
    });
    vi.mocked(chrome.downloads.onChanged.removeListener).mockImplementation(listener => {
      listeners.delete(listener);
    });
    vi.mocked(chrome.downloads.download).mockImplementation((options, callback) => {
      const id = nextId++;
      items.set(id, {
        id,
        state: 'in_progress',
        filename: `C:\\Downloads\\${options.filename}`,
      } as chrome.downloads.DownloadItem);
      callback?.(id);
      return id as unknown as ReturnType<typeof chrome.downloads.download>;
    });
    vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) => {
      const item = items.get(id!);
      return item ? [item] : [];
    });
    vi.mocked(chrome.downloads.cancel).mockResolvedValue();
    ({ handleMultiOutput } = await import('../../src/background/output-handlers'));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function saveStrict(outputs: OutputDestination[] = ['file']) {
    return handleMultiOutput(note, outputs, settings, undefined, true);
  }

  async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
  }

  function terminal(id: number, state: 'complete' | 'interrupted' = 'complete'): void {
    const item = items.get(id);
    if (item) item.state = state;
    for (const listener of [...listeners]) {
      listener({ id, state: { current: state } } as chrome.downloads.DownloadDelta);
    }
  }

  it('preserves ordinary File success on ID acceptance without terminal observation', async () => {
    const result = await handleMultiOutput(note, ['file'], settings);
    expect(result.results).toEqual([{ destination: 'file', success: true }]);
    expect(chrome.downloads.onChanged.addListener).not.toHaveBeenCalled();
    expect(chrome.downloads.search).not.toHaveBeenCalled();
  });

  it('preserves ordinary download failure details', async () => {
    vi.mocked(chrome.downloads.download).mockImplementation((_options, callback) => {
      chrome.runtime.lastError = { message: 'ordinary failure' };
      callback?.(undefined);
      chrome.runtime.lastError = undefined;
      return undefined as unknown as ReturnType<typeof chrome.downloads.download>;
    });
    expect((await handleMultiOutput(note, ['file'], settings)).results).toEqual([
      { destination: 'file', success: false, error: 'ordinary failure' },
    ]);
  });

  it('waits for exact terminal success, returns savedAs, and uses no offscreen lease', async () => {
    let settled = false;
    const pending = saveStrict().then(result => {
      settled = true;
      return result;
    });
    await flush();
    expect(settled).toBe(false);
    expect(chrome.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringMatching(/^data:text\/markdown;charset=utf-8;base64,/),
        filename: note.fileName,
        conflictAction: 'uniquify',
      }),
      expect.any(Function)
    );
    terminal(17);
    expect((await pending).results).toEqual([
      {
        destination: 'file',
        success: true,
        strictFileOutcome: 'confirmed-success',
        savedAs: note.fileName,
      },
    ]);
    expect(chrome.downloads.download).toHaveBeenCalledTimes(1);
    expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it('uses the same Markdown data URL as the ordinary path', async () => {
    await handleMultiOutput(note, ['file'], settings);
    const ordinaryUrl = vi.mocked(chrome.downloads.download).mock.calls[0][0].url;
    const pending = saveStrict();
    terminal(18);
    await pending;
    expect(vi.mocked(chrome.downloads.download).mock.calls[1][0].url).toBe(ordinaryUrl);
  });

  it('reconciles a terminal event before the download ID callback', async () => {
    vi.mocked(chrome.downloads.download).mockImplementation((options, callback) => {
      items.set(44, {
        id: 44,
        state: 'complete',
        filename: `C:\\Downloads\\${options.filename}`,
      } as chrome.downloads.DownloadItem);
      terminal(44);
      callback?.(44);
      return 44 as unknown as ReturnType<typeof chrome.downloads.download>;
    });
    expect((await saveStrict()).results[0]).toMatchObject({
      success: true,
      strictFileOutcome: 'confirmed-success',
      savedAs: note.fileName,
    });
  });

  it.each(['C:\\Downloads\\branch-001 (1).md', 'C:\\Downloads\\other-branch-001.md'])(
    'rejects a completed download at another path: %s',
    async filename => {
      const pending = saveStrict();
      items.get(17)!.filename = filename;
      terminal(17);
      expect((await pending).results[0]).toEqual({
        destination: 'file',
        success: false,
        strictFileOutcome: 'confirmed-failure',
        error: 'strict-file-download-path-mismatch',
      });
      const next = saveStrict();
      terminal(18);
      expect((await next).allSuccessful).toBe(true);
    }
  );

  it('releases admission after a confirmed interruption', async () => {
    const pending = saveStrict();
    terminal(17, 'interrupted');
    expect((await pending).results[0]).toMatchObject({
      success: false,
      strictFileOutcome: 'confirmed-failure',
    });
    const next = saveStrict();
    terminal(18);
    expect((await next).allSuccessful).toBe(true);
  });

  it('releases admission when the callback confirms that no download started', async () => {
    vi.mocked(chrome.downloads.download).mockImplementationOnce((_options, callback) => {
      callback?.(undefined);
      return undefined as unknown as ReturnType<typeof chrome.downloads.download>;
    });
    expect((await saveStrict()).results[0]).toMatchObject({
      success: false,
      strictFileOutcome: 'confirmed-failure',
    });
    const next = saveStrict();
    terminal(17);
    expect((await next).allSuccessful).toBe(true);
  });

  it('retains unresolved admission, blocks dispatch, and ignores old terminal callbacks', async () => {
    const old = saveStrict();
    const oldListener = [...listeners][0];
    await vi.advanceTimersByTimeAsync(35_000);
    expect((await old).results[0]).toMatchObject({ strictFileOutcome: 'unconfirmed' });
    expect((await saveStrict()).results[0]).toMatchObject({
      success: false,
      strictFileOutcome: 'blocked',
    });
    expect(chrome.downloads.download).toHaveBeenCalledTimes(1);
    terminal(999);
    expect((await saveStrict()).results[0].strictFileOutcome).toBe('blocked');
    terminal(17);
    await flush();
    const next = saveStrict();
    oldListener({ id: 17, state: { current: 'complete' } } as chrome.downloads.DownloadDelta);
    await flush();
    expect((await saveStrict()).results[0].strictFileOutcome).toBe('blocked');
    expect(chrome.downloads.download).toHaveBeenCalledTimes(2);
    terminal(18);
    expect((await next).allSuccessful).toBe(true);
  });

  it('retains admission when the download callback itself arrives after timeout', async () => {
    let lateCallback: ((id: number | undefined) => void) | undefined;
    vi.mocked(chrome.downloads.download).mockImplementationOnce((_options, callback) => {
      lateCallback = callback;
      return undefined as unknown as ReturnType<typeof chrome.downloads.download>;
    });
    const pending = saveStrict();
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await pending).results[0].strictFileOutcome).toBe('unconfirmed');
    expect((await saveStrict()).results[0].strictFileOutcome).toBe('blocked');
    terminal(55);
    lateCallback?.(55);
    await flush();
    const next = saveStrict();
    terminal(17);
    expect((await next).allSuccessful).toBe(true);
  });

  it('reports a Downloads channel exception as unconfirmed and does not retry', async () => {
    vi.mocked(chrome.downloads.download).mockImplementationOnce(() => {
      throw new Error('channel unavailable');
    });
    expect((await saveStrict()).results[0].strictFileOutcome).toBe('unconfirmed');
    expect((await saveStrict()).results[0].strictFileOutcome).toBe('blocked');
    expect(chrome.downloads.download).toHaveBeenCalledTimes(1);
  });

  it('keeps failed filename search unconfirmed but releases known terminal ownership', async () => {
    const pending = saveStrict();
    await flush();
    vi.mocked(chrome.downloads.search).mockRejectedValueOnce(new Error('search unavailable'));
    terminal(17);
    expect((await pending).results[0]).toMatchObject({
      success: false,
      strictFileOutcome: 'unconfirmed',
      error: 'strict-file-download-path-unconfirmed',
    });
    const next = saveStrict();
    terminal(18);
    expect((await next).allSuccessful).toBe(true);
  });

  it('retains the gate if search cannot confirm a terminal state', async () => {
    vi.mocked(chrome.downloads.search).mockRejectedValue(new Error('search unavailable'));
    const pending = saveStrict();
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await pending).results[0].strictFileOutcome).toBe('unconfirmed');
    expect((await saveStrict()).results[0].strictFileOutcome).toBe('blocked');
    terminal(17, 'interrupted');
    await flush();
  });

  it('bounds a stalled filename lookup after terminal completion', async () => {
    const pending = saveStrict();
    await flush();
    vi.mocked(chrome.downloads.search).mockImplementationOnce(() => new Promise(() => undefined));
    terminal(17);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await pending).results[0]).toMatchObject({
      success: false,
      strictFileOutcome: 'unconfirmed',
      error: 'strict-file-download-path-unconfirmed',
    });
    const next = saveStrict();
    terminal(18);
    expect((await next).allSuccessful).toBe(true);
  });

  it('bounds stalled state searches and retains unresolved terminal ownership', async () => {
    vi.mocked(chrome.downloads.search).mockImplementation(() => new Promise(() => undefined));
    const pending = saveStrict();
    await vi.advanceTimersByTimeAsync(35_000);
    expect((await pending).results[0].strictFileOutcome).toBe('unconfirmed');
    expect((await saveStrict()).results[0].strictFileOutcome).toBe('blocked');
    terminal(17, 'interrupted');
    await flush();
    expect(listeners.size).toBe(0);
  });

  it('keeps successful sibling outputs independent from an unresolved File result', async () => {
    const pending = saveStrict(['file', 'obsidian']);
    await vi.advanceTimersByTimeAsync(35_000);
    const result = await pending;
    expect(result.anySuccessful).toBe(true);
    expect(result.allSuccessful).toBe(false);
    expect(result.results).toEqual([
      expect.objectContaining({ destination: 'file', strictFileOutcome: 'unconfirmed' }),
      expect.objectContaining({ destination: 'obsidian', success: true }),
    ]);
    terminal(17);
    await flush();
  });

  it('keeps strict File success independent from a rejected sibling output', async () => {
    mocks.saveNote.mockRejectedValue(new Error('Obsidian unavailable'));
    const pending = saveStrict(['file', 'obsidian']);
    terminal(17);
    const result = await pending;
    expect(result.anySuccessful).toBe(true);
    expect(result.allSuccessful).toBe(false);
    expect(result.results).toEqual([
      expect.objectContaining({ destination: 'file', strictFileOutcome: 'confirmed-success' }),
      expect.objectContaining({ destination: 'obsidian', success: false }),
    ]);
  });
});
