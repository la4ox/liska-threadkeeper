import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatGptOpaqueResolverFailure } from '../../src/lib/chatgpt-opaque-resolver-contract';

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock('../../src/lib/messaging', () => ({ sendMessage: mocks.sendMessage }));

import { requestChatGptOpaqueResolverObservation } from '../../src/content/capture/chatgpt-opaque-resolver-request';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';

describe('ChatGPT opaque resolver content bridge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends only the exact conversation identifier and accepts an empty observation', async () => {
    mocks.sendMessage.mockResolvedValue({ success: true, data: { transientAssetResolvers: [] } });
    await expect(requestChatGptOpaqueResolverObservation(CONVERSATION_ID)).resolves.toEqual({
      success: true,
      data: { transientAssetResolvers: [] },
    });
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      action: 'observeChatGptAssetResolversViaOpaqueSource',
      conversationId: CONVERSATION_ID,
    });
  });

  it('fails closed on an invalid response or runtime rejection', async () => {
    mocks.sendMessage.mockResolvedValueOnce({
      success: true,
      data: { transientAssetResolvers: [], x: 1 },
    });
    await expect(requestChatGptOpaqueResolverObservation(CONVERSATION_ID)).resolves.toEqual(
      createChatGptOpaqueResolverFailure('observer-result-invalid')
    );
    mocks.sendMessage.mockRejectedValueOnce(new Error('private diagnostic'));
    await expect(requestChatGptOpaqueResolverObservation(CONVERSATION_ID)).resolves.toEqual(
      createChatGptOpaqueResolverFailure('observer-result-invalid')
    );
  });
});
