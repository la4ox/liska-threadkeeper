import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHATGPT_CAPTURE_ENDPOINT,
  createChatGptCaptureFailure,
} from '../../src/lib/chatgpt-capture-contract';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  getSettings: vi.fn(),
  migrateSettings: vi.fn(),
}));

vi.mock('../../src/lib/storage', () => ({
  getSettings: () => mocks.getSettings(),
  migrateSettings: () => mocks.migrateSettings(),
}));

vi.mock('../../src/background/chatgpt-capture', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/background/chatgpt-capture')>();
  return {
    ...actual,
    captureChatGptInTemporaryTab: (...args: unknown[]) => mocks.capture(...args),
  };
});

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';

let capturedListener: (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean | undefined;

function captureArtifact() {
  return {
    bodyBase64: 'AP8BgCo=',
    byteLength: 5,
    sha256: 'd423c7d662b356d3bcfb768944ff3b5f3f89b7086bb16e6a5afba362da09acb3',
    mediaType: 'application/json; charset=utf-8',
    endpoint: CHATGPT_CAPTURE_ENDPOINT,
  };
}

function invokeCapture(sendResponse = vi.fn()): ReturnType<typeof vi.fn> {
  const returned = capturedListener(
    { action: 'captureChatGptConversation', conversationId: CONVERSATION_ID },
    { tab: { url: `https://chatgpt.com/c/${CONVERSATION_ID}` } } as chrome.runtime.MessageSender,
    sendResponse
  );
  expect(returned).toBe(true);
  return sendResponse;
}

function setScriptingPermission(granted: boolean): ReturnType<typeof vi.fn> {
  const contains = vi.fn(
    (_permissions: { permissions: string[] }, callback: (result: boolean) => void) =>
      callback(granted)
  );
  Object.defineProperty(chrome, 'permissions', { configurable: true, value: { contains } });
  return contains;
}

function setPromiseScriptingPermission(result: Promise<boolean>): ReturnType<typeof vi.fn> {
  const contains = vi.fn(() => result);
  Object.defineProperty(chrome, 'permissions', { configurable: true, value: { contains } });
  return contains;
}

describe('ChatGPT capture service-worker route', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.migrateSettings.mockResolvedValue(undefined);
    mocks.getSettings.mockResolvedValue({ obsidianApiKey: 'must-not-be-read' });
    mocks.capture.mockResolvedValue(captureArtifact());
    setScriptingPermission(true);
    vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation(listener => {
      capturedListener = listener;
    });
    vi.resetModules();
    await import('../../src/background/service-worker');
  });

  afterEach(() => {
    delete (chrome as unknown as { permissions?: unknown }).permissions;
    vi.restoreAllMocks();
  });

  it('captures without reading settings and serializes only the allowlisted artifact', async () => {
    mocks.capture.mockResolvedValueOnce({ ...captureArtifact(), requestHeaders: 'must-not-cross' });
    const sendResponse = invokeCapture();

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(mocks.capture).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(mocks.getSettings).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: true, data: captureArtifact() });
  });

  it('serializes known and unknown capture failures without exception detail or settings reads', async () => {
    const { ChatGptTemporaryCaptureError } = await import('../../src/background/chatgpt-capture');
    mocks.capture.mockRejectedValueOnce(new ChatGptTemporaryCaptureError('timed-out'));
    const knownResponse = invokeCapture();

    await vi.waitFor(() => expect(knownResponse).toHaveBeenCalledOnce());
    expect(knownResponse).toHaveBeenCalledWith(createChatGptCaptureFailure('timed-out'));

    mocks.capture.mockRejectedValueOnce(new Error(`Bearer ${CONVERSATION_ID}`));
    const unknownResponse = invokeCapture();

    await vi.waitFor(() => expect(unknownResponse).toHaveBeenCalledOnce());
    expect(unknownResponse).toHaveBeenCalledWith(
      createChatGptCaptureFailure('background-capture-exception')
    );
    expect(JSON.stringify(unknownResponse.mock.calls[0][0])).not.toContain(CONVERSATION_ID);
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it('separates a response-envelope exception from the capture operation', async () => {
    const poisoned = captureArtifact() as Record<string, unknown>;
    Object.defineProperty(poisoned, 'bodyBase64', {
      enumerable: true,
      get() {
        throw new Error('private response getter');
      },
    });
    mocks.capture.mockResolvedValueOnce(poisoned as never);

    const sendResponse = invokeCapture();
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());

    expect(sendResponse).toHaveBeenCalledWith(
      createChatGptCaptureFailure('capture-response-validation-exception')
    );
  });

  it('fails closed without scripting permission before capture or settings access', async () => {
    const contains = setScriptingPermission(false);
    const sendResponse = invokeCapture();

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(contains).toHaveBeenCalledWith({ permissions: ['scripting'] }, expect.any(Function));
    expect(sendResponse).toHaveBeenCalledWith(
      createChatGptCaptureFailure('permission-unavailable')
    );
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it('fails closed when the permissions API is unavailable', async () => {
    Object.defineProperty(chrome, 'permissions', { configurable: true, value: undefined });
    const sendResponse = invokeCapture();

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(sendResponse).toHaveBeenCalledWith(
      createChatGptCaptureFailure('permission-unavailable')
    );
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it('supports the promise form of the scripting permission check', async () => {
    const contains = setPromiseScriptingPermission(Promise.resolve(true));
    const sendResponse = invokeCapture();

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(contains).toHaveBeenCalledWith({ permissions: ['scripting'] }, expect.any(Function));
    expect(mocks.capture).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(sendResponse).toHaveBeenCalledWith({ success: true, data: captureArtifact() });
  });

  it('fails closed when a promise-form permission check rejects', async () => {
    setPromiseScriptingPermission(Promise.reject(new Error('permission diagnostic')));
    const sendResponse = invokeCapture();

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(sendResponse).toHaveBeenCalledWith(
      createChatGptCaptureFailure('permission-unavailable')
    );
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('fails closed when the permissions API throws synchronously', async () => {
    const contains = vi.fn(() => {
      throw new Error('permission diagnostic');
    });
    Object.defineProperty(chrome, 'permissions', { configurable: true, value: { contains } });
    const sendResponse = invokeCapture();

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(sendResponse).toHaveBeenCalledWith(
      createChatGptCaptureFailure('permission-unavailable')
    );
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('rejects a popup sender before permission checks or capture handling', () => {
    const sendResponse = vi.fn();
    const returned = capturedListener(
      { action: 'captureChatGptConversation', conversationId: CONVERSATION_ID },
      { url: `chrome-extension://${chrome.runtime.id}/popup.html` } as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(returned).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith(createChatGptCaptureFailure('capture-failed'));
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it('uses the capture failure envelope for untrusted capture messages rejected early', () => {
    const unauthorizedResponse = vi.fn();
    const malformedResponse = vi.fn();

    expect(
      capturedListener(
        { action: 'captureChatGptConversation', conversationId: CONVERSATION_ID },
        {
          tab: { url: `https://evil.example/c/${CONVERSATION_ID}` },
        } as chrome.runtime.MessageSender,
        unauthorizedResponse
      )
    ).toBe(false);
    expect(unauthorizedResponse).toHaveBeenCalledWith(
      createChatGptCaptureFailure('capture-failed')
    );

    expect(
      capturedListener(
        {
          action: 'captureChatGptConversation',
          conversationId: CONVERSATION_ID,
          apiKey: 'must-not-cross-the-boundary',
        },
        {
          tab: { url: `https://chatgpt.com/c/${CONVERSATION_ID}` },
        } as chrome.runtime.MessageSender,
        malformedResponse
      )
    ).toBe(false);
    expect(malformedResponse).toHaveBeenCalledWith(createChatGptCaptureFailure('capture-failed'));
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it('does not invoke untrusted action getters while choosing an early reject envelope', () => {
    const message = {};
    Object.defineProperty(message, 'action', {
      enumerable: true,
      get() {
        throw new Error('untrusted getter');
      },
    });
    const sendResponse = vi.fn();

    expect(() =>
      capturedListener(
        message,
        {
          tab: { url: `https://chatgpt.com/c/${CONVERSATION_ID}` },
        } as chrome.runtime.MessageSender,
        sendResponse
      )
    ).not.toThrow();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Invalid message content' });
  });
});
