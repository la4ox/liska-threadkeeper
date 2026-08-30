import { vi, beforeEach } from 'vitest';

// Mock chrome API with full support for background service worker testing
const chromeMock = {
  runtime: {
    sendMessage: vi.fn(() => Promise.resolve(undefined)),
    onMessage: {
      addListener: vi.fn(),
    },
    lastError: null as chrome.runtime.LastError | null,
    id: 'test-extension-id',
    getURL: vi.fn((path: string) => `chrome-extension://test-extension-id/${path}`),
    // For offscreen document detection
    getContexts: vi.fn(() => Promise.resolve([])),
    ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
    },
    sync: {
      get: vi.fn(),
      set: vi.fn(),
    },
  },
  i18n: {
    getMessage: vi.fn((key: string) => key),
  },
  // For file download testing
  downloads: {
    download: vi.fn(
      (
        _options: {
          url: string;
          filename: string;
          saveAs?: boolean;
          conflictAction?: string;
        },
        callback?: (downloadId: number | undefined) => void
      ) => {
        // Default: successful download with ID 1
        if (callback) {
          setTimeout(() => callback(1), 0);
        }
        return 1;
      }
    ),
    // Archive Blob downloads use these to confirm a terminal state before
    // their private Blob URL may be released.
    search: vi.fn(() => Promise.resolve([])),
    cancel: vi.fn(() => Promise.resolve()),
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  // For clipboard operations via offscreen document
  offscreen: {
    createDocument: vi.fn(() => Promise.resolve()),
    closeDocument: vi.fn(() => Promise.resolve()),
    Reason: { CLIPBOARD: 'CLIPBOARD', BLOBS: 'BLOBS' },
  },
};

vi.stubGlobal('chrome', chromeMock);

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
  // Reset lastError
  chromeMock.runtime.lastError = null;
  // Reset getContexts to return empty array (no existing offscreen documents)
  chromeMock.runtime.getContexts.mockResolvedValue([]);
});
