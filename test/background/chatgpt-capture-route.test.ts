import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHATGPT_CAPTURE_ENDPOINT,
  createChatGptCaptureFailure,
} from '../../src/lib/chatgpt-capture-contract';
import { createChatGptOpaqueProbeResult } from '../../src/lib/chatgpt-opaque-probe-contract';
import { createChatGptOpaqueReplayFailure } from '../../src/lib/chatgpt-opaque-replay-contract';
import { createChatGptActiveResolverFailure } from '../../src/lib/chatgpt-active-resolver-contract';
import { createChatGptInterpreterResolverFailure } from '../../src/lib/chatgpt-interpreter-resolver-contract';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  probe: vi.fn(),
  replay: vi.fn(),
  resolver: vi.fn(),
  activeResolver: vi.fn(),
  interpreterResolver: vi.fn(),
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

vi.mock('../../src/background/chatgpt-opaque-probe', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/background/chatgpt-opaque-probe')>();
  return {
    ...actual,
    probeChatGptOpaqueRequest: (...args: unknown[]) => mocks.probe(...args),
  };
});

vi.mock('../../src/background/chatgpt-opaque-replay', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/background/chatgpt-opaque-replay')>();
  return {
    ...actual,
    captureChatGptConversationViaOpaqueReplay: (...args: unknown[]) => mocks.replay(...args),
  };
});

vi.mock('../../src/background/chatgpt-opaque-resolver', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/background/chatgpt-opaque-resolver')>();
  return {
    ...actual,
    observeChatGptAssetResolversViaOpaqueSource: (...args: unknown[]) => mocks.resolver(...args),
  };
});

vi.mock('../../src/background/chatgpt-active-resolver', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/background/chatgpt-active-resolver')>();
  return {
    ...actual,
    probeChatGptActiveAssetResolvers: (...args: unknown[]) => mocks.activeResolver(...args),
  };
});

vi.mock('../../src/background/chatgpt-interpreter-resolver', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/background/chatgpt-interpreter-resolver')>();
  return {
    ...actual,
    resolveChatGptInterpreterAssets: (...args: unknown[]) => mocks.interpreterResolver(...args),
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
    transientAssetResolvers: [],
  };
}

function invokeCapture(sendResponse = vi.fn()): ReturnType<typeof vi.fn> {
  const returned = capturedListener(
    {
      action: 'captureChatGptConversation',
      conversationId: CONVERSATION_ID,
    },
    { tab: { url: `https://chatgpt.com/c/${CONVERSATION_ID}` } } as chrome.runtime.MessageSender,
    sendResponse
  );
  expect(returned).toBe(true);
  return sendResponse;
}

function invokeOpaqueProbe(sendResponse = vi.fn()): ReturnType<typeof vi.fn> {
  const returned = capturedListener(
    { action: 'probeChatGptOpaqueRequest', conversationId: CONVERSATION_ID },
    { tab: { url: `https://chatgpt.com/c/${CONVERSATION_ID}` } } as chrome.runtime.MessageSender,
    sendResponse
  );
  expect(returned).toBe(true);
  return sendResponse;
}

function invokeOpaqueReplay(sendResponse = vi.fn()): ReturnType<typeof vi.fn> {
  const returned = capturedListener(
    {
      action: 'captureChatGptConversationViaOpaqueReplay',
      conversationId: CONVERSATION_ID,
    },
    { tab: { url: `https://chatgpt.com/c/${CONVERSATION_ID}` } } as chrome.runtime.MessageSender,
    sendResponse
  );
  expect(returned).toBe(true);
  return sendResponse;
}

function invokeOpaqueResolver(sendResponse = vi.fn()): ReturnType<typeof vi.fn> {
  const returned = capturedListener(
    {
      action: 'observeChatGptAssetResolversViaOpaqueSource',
      conversationId: CONVERSATION_ID,
    },
    { tab: { url: `https://chatgpt.com/c/${CONVERSATION_ID}` } } as chrome.runtime.MessageSender,
    sendResponse
  );
  expect(returned).toBe(true);
  return sendResponse;
}

function invokeActiveResolver(sendResponse = vi.fn()): ReturnType<typeof vi.fn> {
  const returned = capturedListener(
    {
      action: 'probeChatGptActiveAssetResolvers',
      conversationId: CONVERSATION_ID,
      providerFileIds: ['file_abc'],
    },
    { tab: { url: `https://chatgpt.com/c/${CONVERSATION_ID}` } } as chrome.runtime.MessageSender,
    sendResponse
  );
  expect(returned).toBe(true);
  return sendResponse;
}

function invokeInterpreterResolver(sendResponse = vi.fn()): ReturnType<typeof vi.fn> {
  const returned = capturedListener(
    {
      action: 'resolveChatGptInterpreterAssets',
      conversationId: CONVERSATION_ID,
      candidates: [
        {
          assetId: `chatgpt-asset-${'a'.repeat(64)}`,
          messageId: 'msg_one',
          sandboxPath: '/mnt/data/one.txt',
        },
      ],
    },
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
    mocks.probe.mockResolvedValue(createChatGptOpaqueProbeResult('eligible'));
    mocks.replay.mockResolvedValue({ success: true, data: captureArtifact() });
    mocks.resolver.mockResolvedValue({ success: true, data: { transientAssetResolvers: [] } });
    mocks.activeResolver.mockResolvedValue({
      success: true,
      data: {
        requestedCount: 1,
        dispatchCount: 1,
        observedCount: 1,
        outcomes: ['observed'],
        attemptedAt: '2026-08-24T12:00:00.000Z',
      },
    });
    mocks.interpreterResolver.mockResolvedValue({
      success: true,
      data: {
        resolved: [
          {
            assetId: `chatgpt-asset-${'a'.repeat(64)}`,
            downloadUrl:
              `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
              '&id=private&p=p&sig=s&ts=1&v=1',
          },
        ],
      },
    });
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
    expect(mocks.capture).toHaveBeenCalledWith(CONVERSATION_ID, {
      observeAssetResolvers: false,
    });
    expect(mocks.getSettings).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: true, data: captureArtifact() });
  });

  it('routes the exact opaque probe through the same sender and scripting checks without capture', async () => {
    const sendResponse = invokeOpaqueProbe();

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(mocks.probe).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      data: createChatGptOpaqueProbeResult('eligible'),
    });
    expect(JSON.stringify(sendResponse.mock.calls[0][0])).not.toContain(CONVERSATION_ID);
  });

  it('fails the opaque probe before dispatch when scripting is unavailable', async () => {
    setScriptingPermission(false);
    const sendResponse = invokeOpaqueProbe();

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      data: createChatGptOpaqueProbeResult('probe-failed'),
    });
  });

  it('routes the exact one-shot opaque replay without settings or ordinary capture', async () => {
    const sendResponse = invokeOpaqueReplay();

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(mocks.replay).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(mocks.getSettings).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: true, data: captureArtifact() });
  });

  it('fails opaque replay before dispatch when scripting is unavailable', async () => {
    setScriptingPermission(false);
    const sendResponse = invokeOpaqueReplay();

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(mocks.replay).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(
      createChatGptOpaqueReplayFailure('permission-unavailable')
    );
  });

  it('routes the exact post-persistence resolver observer without ordinary capture or replay', async () => {
    const sendResponse = invokeOpaqueResolver();

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(mocks.resolver).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.replay).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      data: { transientAssetResolvers: [] },
    });
  });

  it('routes the active metric resolver through the same sender and permission gate only', async () => {
    const sendResponse = invokeActiveResolver();
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(mocks.activeResolver).toHaveBeenCalledWith(CONVERSATION_ID, ['file_abc']);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.replay).not.toHaveBeenCalled();
    expect(mocks.resolver).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      data: {
        requestedCount: 1,
        dispatchCount: 1,
        observedCount: 1,
        outcomes: ['observed'],
        attemptedAt: '2026-08-24T12:00:00.000Z',
      },
    });
    expect(JSON.stringify(sendResponse.mock.calls[0][0])).not.toContain('file_abc');
  });

  it('rejects the active route before dispatch when scripting is unavailable', async () => {
    setScriptingPermission(false);
    const sendResponse = invokeActiveResolver();
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(mocks.activeResolver).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(
      createChatGptActiveResolverFailure('permission-unavailable')
    );
  });

  it('routes the separate interpreter resolver through the same sender and permission gate only', async () => {
    const sendResponse = invokeInterpreterResolver();
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(mocks.interpreterResolver).toHaveBeenCalledWith(CONVERSATION_ID, [
      {
        assetId: `chatgpt-asset-${'a'.repeat(64)}`,
        messageId: 'msg_one',
        sandboxPath: '/mnt/data/one.txt',
      },
    ]);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.activeResolver).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      data: {
        resolved: [
          {
            assetId: `chatgpt-asset-${'a'.repeat(64)}`,
            downloadUrl:
              `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
              '&id=private&p=p&sig=s&ts=1&v=1',
          },
        ],
      },
    });
  });

  it('rejects custom-GPT interpreter resolution before permission or tab transport dispatch', () => {
    const sendResponse = vi.fn();
    const returned = capturedListener(
      {
        action: 'resolveChatGptInterpreterAssets',
        conversationId: CONVERSATION_ID,
        candidates: [
          {
            assetId: `chatgpt-asset-${'a'.repeat(64)}`,
            messageId: 'msg_one',
            sandboxPath: '/mnt/data/one.txt',
          },
        ],
      },
      {
        tab: { url: `https://chatgpt.com/g/my-custom-gpt/c/${CONVERSATION_ID}` },
      } as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(returned).toBe(false);
    expect(mocks.interpreterResolver).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(
      createChatGptInterpreterResolverFailure('interpreter-result-invalid')
    );
  });

  it('contains interpreter transport exceptions in the typed failure envelope', async () => {
    mocks.interpreterResolver.mockRejectedValueOnce(new Error('synthetic interpreter failure'));
    const sendResponse = invokeInterpreterResolver();

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(sendResponse).toHaveBeenCalledWith(
      createChatGptInterpreterResolverFailure('interpreter-result-invalid')
    );
    expect(JSON.stringify(sendResponse.mock.calls)).not.toContain('synthetic interpreter failure');
  });

  it('rejects the interpreter route before dispatch when scripting is unavailable', async () => {
    setScriptingPermission(false);
    const sendResponse = invokeInterpreterResolver();
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(mocks.interpreterResolver).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(
      createChatGptInterpreterResolverFailure('permission-unavailable')
    );
  });

  it('authorizes the current conversation after same-origin SPA navigation', async () => {
    const sendResponse = vi.fn();
    const returned = capturedListener(
      {
        action: 'captureChatGptConversation',
        conversationId: CONVERSATION_ID,
        observeAssetResolvers: true,
      },
      {
        tab: { url: `https://chatgpt.com/g/my-custom-gpt/c/${CONVERSATION_ID}` },
        url: 'https://chatgpt.com/c/11111111-2222-3333-4444-555555555555',
      } as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(returned).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(mocks.capture).toHaveBeenCalledWith(CONVERSATION_ID, {
      observeAssetResolvers: true,
    });
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
    expect(mocks.capture).toHaveBeenCalledWith(CONVERSATION_ID, {
      observeAssetResolvers: false,
    });
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
      {
        action: 'captureChatGptConversation',
        conversationId: CONVERSATION_ID,
        observeAssetResolvers: false,
      },
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
        {
          action: 'captureChatGptConversation',
          conversationId: CONVERSATION_ID,
          observeAssetResolvers: false,
        },
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
          observeAssetResolvers: false,
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

  it('uses the replay failure envelope for untrusted replay messages rejected early', () => {
    const unauthorizedResponse = vi.fn();
    const malformedResponse = vi.fn();

    expect(
      capturedListener(
        {
          action: 'captureChatGptConversationViaOpaqueReplay',
          conversationId: CONVERSATION_ID,
        },
        {
          tab: { url: `https://evil.example/c/${CONVERSATION_ID}` },
        } as chrome.runtime.MessageSender,
        unauthorizedResponse
      )
    ).toBe(false);
    expect(unauthorizedResponse).toHaveBeenCalledWith(
      createChatGptOpaqueReplayFailure('replay-result-invalid')
    );

    expect(
      capturedListener(
        {
          action: 'captureChatGptConversationViaOpaqueReplay',
          conversationId: CONVERSATION_ID,
          authorization: 'must-not-cross-the-boundary',
        },
        {
          tab: { url: `https://chatgpt.com/c/${CONVERSATION_ID}` },
        } as chrome.runtime.MessageSender,
        malformedResponse
      )
    ).toBe(false);
    expect(malformedResponse).toHaveBeenCalledWith(
      createChatGptOpaqueReplayFailure('replay-result-invalid')
    );
    expect(mocks.replay).not.toHaveBeenCalled();
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
