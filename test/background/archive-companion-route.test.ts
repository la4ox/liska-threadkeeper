import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  migrateSettings: vi.fn(),
  saveSettings: vi.fn(),
  persist: vi.fn(),
  multiOutput: vi.fn(),
}));

vi.mock('../../src/lib/storage', () => ({
  getSettings: () => mocks.getSettings(),
  migrateSettings: () => mocks.migrateSettings(),
  saveSettings: (...args: unknown[]) => mocks.saveSettings(...args),
}));

vi.mock('../../src/background/output-handlers', () => ({
  handleMultiOutput: (...args: unknown[]) => mocks.multiOutput(...args),
  handlePersistArchiveCompanion: (...args: unknown[]) => mocks.persist(...args),
}));

let listener: (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean | undefined;

function message(source: 'chatgpt' | 'deepseek' = 'chatgpt') {
  return {
    action: 'persistArchiveCompanion' as const,
    noteFileName: 'note.md',
    source,
    captureId: `capture-${source}-11111111-2222-4333-8444-555555555555`,
    conversationKey: 'a'.repeat(64),
    artifact: {
      transport: 'inline' as const,
      kind: 'manifest' as const,
      relativePath: 'manifest.json',
      mediaType: 'application/json' as const,
      byteLength: 2,
      sha256: 'b'.repeat(64),
      bodyBase64: 'e30=',
    },
    outputs: ['file' as const],
  };
}

describe('archive companion service-worker route', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.migrateSettings.mockResolvedValue(undefined);
    mocks.saveSettings.mockResolvedValue(undefined);
    mocks.getSettings.mockResolvedValue({
      obsidianApiKey: '',
      outputOptions: { obsidian: false, file: true, clipboard: false },
    });
    mocks.persist.mockResolvedValue({
      results: [{ destination: 'file', success: true }],
      allSuccessful: true,
      anySuccessful: true,
    });
    vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation(candidate => {
      listener = candidate;
    });
    vi.resetModules();
    await import('../../src/background/service-worker');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes exactly one companion to its dedicated durable-output handler', async () => {
    const request = message();
    const sendResponse = vi.fn();
    const returned = listener(
      request,
      {
        tab: { url: 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd' },
        frameId: 0,
        url: 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd',
      } as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(returned).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(mocks.persist).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        outputOptions: { obsidian: false, file: true, clipboard: false },
      })
    );
    expect(mocks.multiOutput).not.toHaveBeenCalled();
  });

  it('routes a DeepSeek companion only from the matching signed-in conversation tab', async () => {
    const request = message('deepseek');
    const sendResponse = vi.fn();
    const sender = {
      tab: { url: 'https://chat.deepseek.com/a/chat/s/deepseek-chat-123' },
      frameId: 0,
      url: 'https://chat.deepseek.com/a/chat/s/deepseek-chat-123',
    } as chrome.runtime.MessageSender;

    expect(listener(request, sender, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(mocks.persist).toHaveBeenCalledWith(request, expect.any(Object));

    vi.clearAllMocks();
    const rejected = vi.fn();
    expect(
      listener(
        request,
        {
          tab: { url: 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd' },
          frameId: 0,
          url: 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd',
        } as chrome.runtime.MessageSender,
        rejected
      )
    ).toBe(false);
    expect(rejected).toHaveBeenCalledWith({ success: false, error: 'Unauthorized' });
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('applies a popup output update immediately while storage persistence is pending', async () => {
    let finishSave!: () => void;
    mocks.saveSettings.mockReturnValueOnce(
      new Promise<void>(resolve => {
        finishSave = resolve;
      })
    );
    mocks.getSettings.mockResolvedValue({
      obsidianApiKey: '',
      outputOptions: { obsidian: true, file: false, clipboard: false },
    });
    const updateResponse = vi.fn();
    listener(
      {
        action: 'updateOutputOptions',
        outputOptions: { obsidian: false, file: true, clipboard: false },
      },
      {
        id: chrome.runtime.id,
        url: chrome.runtime.getURL('src/popup/index.html'),
      } as chrome.runtime.MessageSender,
      updateResponse
    );

    const settingsResponse = vi.fn();
    listener(
      { action: 'getSettings' },
      { tab: { url: 'https://chatgpt.com/c/test' } } as chrome.runtime.MessageSender,
      settingsResponse
    );
    await vi.waitFor(() => expect(settingsResponse).toHaveBeenCalledOnce());
    expect(settingsResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        outputOptions: { obsidian: false, file: true, clipboard: false },
      })
    );
    expect(updateResponse).not.toHaveBeenCalled();

    finishSave();
    await vi.waitFor(() => expect(updateResponse).toHaveBeenCalledWith({ success: true }));
  });

  it('rejects output-setting updates from content scripts', () => {
    const sendResponse = vi.fn();
    const returned = listener(
      {
        action: 'updateOutputOptions',
        outputOptions: { obsidian: false, file: true, clipboard: false },
      },
      { tab: { url: 'https://chatgpt.com/c/test' } } as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(returned).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Unauthorized' });
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('rejects output-setting updates from other extension pages', () => {
    const sendResponse = vi.fn();
    const returned = listener(
      {
        action: 'updateOutputOptions',
        outputOptions: { obsidian: false, file: true, clipboard: false },
      },
      {
        id: chrome.runtime.id,
        url: chrome.runtime.getURL('src/offscreen/offscreen.html'),
      } as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(returned).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Unauthorized' });
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('keeps the safer in-memory output state when sync storage rejects the update', async () => {
    mocks.saveSettings.mockRejectedValueOnce(new Error('sync storage unavailable'));
    mocks.getSettings.mockResolvedValue({
      obsidianApiKey: '',
      outputOptions: { obsidian: true, file: false, clipboard: false },
    });
    const updateResponse = vi.fn();
    listener(
      {
        action: 'updateOutputOptions',
        outputOptions: { obsidian: false, file: true, clipboard: false },
      },
      {
        id: chrome.runtime.id,
        url: chrome.runtime.getURL('src/popup/index.html'),
      } as chrome.runtime.MessageSender,
      updateResponse
    );
    await vi.waitFor(() =>
      expect(updateResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Could not save output settings',
      })
    );

    const settingsResponse = vi.fn();
    listener(
      { action: 'getSettings' },
      { tab: { url: 'https://chatgpt.com/c/test' } } as chrome.runtime.MessageSender,
      settingsResponse
    );
    await vi.waitFor(() => expect(settingsResponse).toHaveBeenCalledOnce());
    expect(settingsResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        outputOptions: { obsidian: false, file: true, clipboard: false },
      })
    );
  });
});
