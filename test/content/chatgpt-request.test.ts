import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatGptCaptureFailure } from '../../src/lib/chatgpt-capture-contract';
import { createChatGptOpaqueProbeResult } from '../../src/lib/chatgpt-opaque-probe-contract';

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock('../../src/lib/messaging', () => ({ sendMessage: mocks.sendMessage }));

import { requestChatGptConversationCapture } from '../../src/content/capture/chatgpt-request';
import { requestChatGptOpaqueProbe } from '../../src/content/capture/chatgpt-opaque-probe-request';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requestChatGptConversationCapture', () => {
  it('uses the literal capture action through the shared message sender', async () => {
    const response = createChatGptCaptureFailure('permission-unavailable');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.sendMessage.mockResolvedValueOnce(response);

    await expect(requestChatGptConversationCapture(CONVERSATION_ID)).resolves.toEqual(response);
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      action: 'captureChatGptConversation',
      conversationId: CONVERSATION_ID,
    });
    expect(warning).toHaveBeenCalledWith(
      '[G2O] ChatGPT structured capture unavailable:',
      'permission-unavailable'
    );
  });

  it('requires an explicit opt-in before asking the page to observe asset resolvers', async () => {
    const response = createChatGptCaptureFailure('permission-unavailable');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.sendMessage.mockResolvedValueOnce(response);

    await requestChatGptConversationCapture(CONVERSATION_ID, true);

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      action: 'captureChatGptConversation',
      conversationId: CONVERSATION_ID,
      observeAssetResolvers: true,
    });
  });

  it('replaces a malformed background value with a stable capture failure', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.sendMessage.mockResolvedValueOnce({
      success: true,
      data: { accountId: 'must-not-be-trusted' },
    });

    await expect(requestChatGptConversationCapture(CONVERSATION_ID)).resolves.toEqual(
      createChatGptCaptureFailure('unexpected-capture-result')
    );
    expect(warning).toHaveBeenCalledWith(
      '[G2O] ChatGPT structured capture unavailable:',
      'unexpected-capture-result'
    );
  });
});

describe('requestChatGptOpaqueProbe', () => {
  it('uses only the exact separate probe action and returns the bounded metadata result', async () => {
    const response = {
      success: false as const,
      data: createChatGptOpaqueProbeResult('eligible', {
        observedTargetRequest: true,
        sourceIsNativeRequest: true,
        initAbsent: true,
        exactTarget: true,
        authorizationPresent: true,
        credentialsAccepted: true,
        sourceStatus: 200,
        sourceJson: true,
      }),
    };
    mocks.sendMessage.mockResolvedValueOnce(response);

    await expect(requestChatGptOpaqueProbe(CONVERSATION_ID)).resolves.toEqual(response);
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      action: 'probeChatGptOpaqueRequest',
      conversationId: CONVERSATION_ID,
    });
    expect(JSON.stringify(mocks.sendMessage.mock.calls)).not.toContain('authorization');
  });

  it('replaces malformed probe responses with a stable secret-free diagnostic', async () => {
    mocks.sendMessage.mockResolvedValueOnce({
      success: false,
      data: { header: 'synthetic-secret' },
    });

    await expect(requestChatGptOpaqueProbe(CONVERSATION_ID)).resolves.toEqual({
      success: false,
      data: createChatGptOpaqueProbeResult('probe-failed'),
    });
  });
});
