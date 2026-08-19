/**
 * Offscreen document tests
 *
 * Tests sender validation and clipboard operations
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture the message listener
let capturedListener: (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean | undefined;

// Mock the textarea element for clipboard operations
const mockTextarea = {
  value: '',
  select: vi.fn(),
};

describe('offscreen/offscreen', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockTextarea.value = '';

    // Mock document.querySelector to return our mock textarea
    vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
      if (selector === '#clipboard-textarea') {
        return mockTextarea as unknown as HTMLTextAreaElement;
      }
      return null;
    });

    // Mock document.execCommand (deprecated but used in offscreen for clipboard)
    // jsdom does not define execCommand, so use Object.defineProperty
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn(() => true),
      writable: true,
      configurable: true,
    });

    // Capture message listener
    vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation(listener => {
      capturedListener = listener;
    });

    // Import fresh
    vi.resetModules();
    await import('../../src/offscreen/offscreen');
  });

  it('registers message listener', () => {
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    expect(capturedListener).toBeDefined();
  });

  it('rejects messages from different extension IDs', () => {
    const sendResponse = vi.fn();
    const result = capturedListener(
      { action: 'clipboardWrite', target: 'offscreen', content: 'test' },
      { id: 'different-extension-id' } as chrome.runtime.MessageSender,
      sendResponse
    );

    // Should return false (not handled) and not call sendResponse
    expect(result).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('rejects messages when sender.id is undefined', () => {
    const sendResponse = vi.fn();
    const result = capturedListener(
      { action: 'clipboardWrite', target: 'offscreen', content: 'test' },
      {} as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(result).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('rejects messages from content scripts (sender.tab defined) (SEC-03)', () => {
    const sendResponse = vi.fn();
    const result = capturedListener(
      { action: 'clipboardWrite', target: 'offscreen', content: 'test' },
      {
        id: chrome.runtime.id,
        tab: {
          id: 1,
          index: 0,
          highlighted: false,
          active: true,
          pinned: false,
        } as chrome.tabs.Tab,
      } as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(result).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('accepts messages from background service worker (no sender.tab) (SEC-03)', () => {
    const sendResponse = vi.fn();
    capturedListener(
      { action: 'clipboardWrite', target: 'offscreen', content: 'hello' },
      { id: chrome.runtime.id } as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('handles clipboard write from valid sender', () => {
    const sendResponse = vi.fn();
    capturedListener(
      { action: 'clipboardWrite', target: 'offscreen', content: 'test content' },
      { id: chrome.runtime.id } as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(mockTextarea.value).toBe(''); // Cleared after copy
    expect(mockTextarea.select).toHaveBeenCalled();
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('creates and revokes an exact archive Blob URL without a data URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:chrome-extension://test/archive');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      writable: true,
      configurable: true,
    });
    const createResponse = vi.fn();
    capturedListener(
      {
        action: 'archiveBlobCreate',
        target: 'offscreen',
        bodyBase64: 'AP8=',
        mediaType: 'application/json',
      },
      { id: chrome.runtime.id } as chrome.runtime.MessageSender,
      createResponse
    );

    expect(createResponse).toHaveBeenCalledWith({
      success: true,
      url: 'blob:chrome-extension://test/archive',
    });
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('application/json');
    expect(blob.size).toBe(2);

    const revokeResponse = vi.fn();
    capturedListener(
      {
        action: 'archiveBlobRevoke',
        target: 'offscreen',
        url: 'blob:chrome-extension://test/archive',
      },
      { id: chrome.runtime.id } as chrome.runtime.MessageSender,
      revokeResponse
    );
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:chrome-extension://test/archive');
    expect(revokeResponse).toHaveBeenCalledWith({ success: true });
  });

  it('rejects non-canonical archive bytes before creating a Blob URL', () => {
    const sendResponse = vi.fn();

    capturedListener(
      {
        action: 'archiveBlobCreate',
        target: 'offscreen',
        bodyBase64: 'not-base64',
        mediaType: 'application/json',
      },
      { id: chrome.runtime.id } as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Could not prepare archive download',
    });
  });

  it('rejects an archive whose base64 decoder does not round-trip canonically', () => {
    const btoa = vi.spyOn(globalThis, 'btoa').mockReturnValue('AAAA');
    const sendResponse = vi.fn();

    try {
      capturedListener(
        {
          action: 'archiveBlobCreate',
          target: 'offscreen',
          bodyBase64: 'AP8=',
          mediaType: 'application/json',
        },
        { id: chrome.runtime.id } as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Could not prepare archive download',
      });
    } finally {
      btoa.mockRestore();
    }
  });

  it('rejects archive Blob creation for non-JSON media types', () => {
    const sendResponse = vi.fn();

    capturedListener(
      {
        action: 'archiveBlobCreate',
        target: 'offscreen',
        bodyBase64: 'e30=',
        mediaType: 'text/plain',
      },
      { id: chrome.runtime.id } as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Could not prepare archive download',
    });
  });

  it('does not report a revoked archive URL when URL release throws', () => {
    const createObjectURL = vi.fn(() => 'blob:chrome-extension://test/release-error');
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      writable: true,
      configurable: true,
    });
    const createResponse = vi.fn();
    capturedListener(
      {
        action: 'archiveBlobCreate',
        target: 'offscreen',
        bodyBase64: 'e30=',
        mediaType: 'application/json',
      },
      { id: chrome.runtime.id } as chrome.runtime.MessageSender,
      createResponse
    );
    expect(createResponse).toHaveBeenCalledWith({
      success: true,
      url: 'blob:chrome-extension://test/release-error',
    });

    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
      throw new Error('release denied');
    });
    const revokeResponse = vi.fn();
    try {
      capturedListener(
        {
          action: 'archiveBlobRevoke',
          target: 'offscreen',
          url: 'blob:chrome-extension://test/release-error',
        },
        { id: chrome.runtime.id } as chrome.runtime.MessageSender,
        revokeResponse
      );

      expect(revokeResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Could not release archive download',
      });
    } finally {
      revokeObjectURL.mockRestore();
    }
  });

  it('responds with error when execCommand copy fails', () => {
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn(() => false),
      writable: true,
      configurable: true,
    });

    const sendResponse = vi.fn();
    capturedListener(
      { action: 'clipboardWrite', target: 'offscreen', content: 'test' },
      { id: chrome.runtime.id } as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'execCommand copy failed',
    });
  });

  it('responds with error when clipboard textarea is missing', () => {
    vi.spyOn(document, 'querySelector').mockReturnValue(null);

    const sendResponse = vi.fn();
    capturedListener(
      { action: 'clipboardWrite', target: 'offscreen', content: 'test' },
      { id: chrome.runtime.id } as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Clipboard textarea element not found',
    });
  });

  it('ignores messages with a different action or target', () => {
    const sendResponse = vi.fn();
    const result = capturedListener(
      { action: 'getSettings' },
      { id: chrome.runtime.id } as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(result).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
