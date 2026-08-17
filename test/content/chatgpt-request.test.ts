import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatGptCaptureFailure } from '../../src/lib/chatgpt-capture-contract';

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock('../../src/lib/messaging', () => ({ sendMessage: mocks.sendMessage }));

import { requestChatGptConversationCapture } from '../../src/content/capture/chatgpt-request';

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
