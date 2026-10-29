import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  probe: vi.fn(),
  getSettings: vi.fn(),
  migrateSettings: vi.fn(),
}));

vi.mock('../../src/lib/storage', () => ({
  getSettings: () => mocks.getSettings(),
  migrateSettings: () => mocks.migrateSettings(),
  saveSettings: vi.fn(),
}));

vi.mock('../../src/background/dots-schema-probe', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/background/dots-schema-probe')>();
  return {
    ...actual,
    probeDotsSchemaInActiveTab: (...args: unknown[]) => mocks.probe(...args),
  };
});

let capturedListener: (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean | undefined;

function setScriptingPermission(granted: boolean): void {
  const contains = vi.fn(
    (_permissions: { permissions: string[] }, callback: (result: boolean) => void) =>
      callback(granted)
  );
  Object.defineProperty(chrome, 'permissions', { configurable: true, value: { contains } });
}

function popupSender(): chrome.runtime.MessageSender {
  return {
    id: chrome.runtime.id,
    url: chrome.runtime.getURL('src/popup/index.html'),
  };
}

describe('Dots schema service-worker route', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.migrateSettings.mockResolvedValue(undefined);
    mocks.getSettings.mockResolvedValue({ obsidianApiKey: 'must-not-be-read' });
    mocks.probe.mockResolvedValue({
      success: true,
      fileName: 'liska-dots-schema-probe.json',
    });
    setScriptingPermission(true);
    vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation(listener => {
      capturedListener = listener;
    });
    vi.resetModules();
    await import('../../src/background/service-worker');
  });

  it('admits the exact popup action without reading settings', async () => {
    const sendResponse = vi.fn();
    expect(capturedListener({ action: 'probeDotsSchema' }, popupSender(), sendResponse)).toBe(true);

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        fileName: 'liska-dots-schema-probe.json',
      })
    );
    expect(mocks.probe).toHaveBeenCalledOnce();
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'other', url: 'chrome-extension://other/src/popup/index.html' },
    {
      id: 'test-extension-id',
      url: 'chrome-extension://test-extension-id/src/other.html',
    },
    {
      id: 'test-extension-id',
      url: 'chrome-extension://test-extension-id/src/popup/index.html',
      tab: { id: 9 },
    },
  ])('rejects non-popup sender %#', sender => {
    const sendResponse = vi.fn();
    expect(
      capturedListener(
        { action: 'probeDotsSchema' },
        sender as chrome.runtime.MessageSender,
        sendResponse
      )
    ).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({ success: false, code: 'invalid-sender' });
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it('rejects extra message properties before dispatch', () => {
    const sendResponse = vi.fn();
    expect(
      capturedListener({ action: 'probeDotsSchema', extra: true }, popupSender(), sendResponse)
    ).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({ success: false, code: 'invalid-message' });
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it('returns a typed permission failure before probe dispatch', async () => {
    setScriptingPermission(false);
    const sendResponse = vi.fn();
    expect(capturedListener({ action: 'probeDotsSchema' }, popupSender(), sendResponse)).toBe(true);
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        code: 'permission-unavailable',
      })
    );
    expect(mocks.probe).not.toHaveBeenCalled();
  });
});
