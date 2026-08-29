import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatGptInterpreterResolverFailure } from '../../src/lib/chatgpt-interpreter-resolver-contract';

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock('../../src/lib/messaging', () => ({ sendMessage: mocks.sendMessage }));

import { resolveChatGptInterpreterAssets } from '../../src/content/capture/chatgpt-interpreter-resolver-request';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const FIRST_ASSET_ID = `chatgpt-asset-${'a'.repeat(64)}`;
const SECOND_ASSET_ID = `chatgpt-asset-${'b'.repeat(64)}`;
const candidates = [
  { assetId: FIRST_ASSET_ID, messageId: 'msg_one', sandboxPath: '/mnt/data/one.txt' },
  { assetId: SECOND_ASSET_ID, messageId: 'msg_two', sandboxPath: '/mnt/data/two.txt' },
];

function signedUrl() {
  return (
    `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
    '&id=private&p=p&sig=s&ts=1&v=1'
  );
}

describe('ChatGPT interpreter resolver content bridge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends only the exact plan and preserves a validated deterministic input subset', async () => {
    const response = {
      success: true as const,
      data: { resolved: [{ assetId: SECOND_ASSET_ID, downloadUrl: signedUrl() }] },
    };
    mocks.sendMessage.mockResolvedValue(response);

    await expect(resolveChatGptInterpreterAssets(CONVERSATION_ID, candidates)).resolves.toEqual(
      response
    );
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      action: 'resolveChatGptInterpreterAssets',
      conversationId: CONVERSATION_ID,
      candidates,
    });
    expect(Object.keys(mocks.sendMessage.mock.calls[0][0])).toEqual([
      'action',
      'conversationId',
      'candidates',
    ]);
  });

  it('rejects invalid candidates and malformed/non-subset response before use', async () => {
    await expect(
      resolveChatGptInterpreterAssets('not-a-conversation', candidates)
    ).resolves.toEqual(createChatGptInterpreterResolverFailure('invalid-conversation-id'));
    await expect(
      resolveChatGptInterpreterAssets(CONVERSATION_ID, [
        { ...candidates[0], sandboxPath: '/tmp/x' },
      ])
    ).resolves.toEqual(createChatGptInterpreterResolverFailure('invalid-interpreter-candidates'));
    expect(mocks.sendMessage).not.toHaveBeenCalled();

    mocks.sendMessage.mockResolvedValue({
      success: true,
      data: {
        resolved: [{ assetId: `chatgpt-asset-${'c'.repeat(64)}`, downloadUrl: signedUrl() }],
      },
    });
    await expect(resolveChatGptInterpreterAssets(CONVERSATION_ID, candidates)).resolves.toEqual(
      createChatGptInterpreterResolverFailure('interpreter-result-invalid')
    );

    mocks.sendMessage.mockResolvedValue({
      success: true,
      data: {
        resolved: [
          {
            assetId: FIRST_ASSET_ID,
            downloadUrl:
              'https://chatgpt.com/backend-api/estuary/content?cid=11111111-2222-3333-4444-555555555555&id=private&p=p&sig=s&ts=1&v=1',
          },
        ],
      },
    });
    await expect(resolveChatGptInterpreterAssets(CONVERSATION_ID, candidates)).resolves.toEqual(
      createChatGptInterpreterResolverFailure('interpreter-result-invalid')
    );

    mocks.sendMessage.mockResolvedValue({
      success: true,
      data: {
        resolved: [
          { assetId: SECOND_ASSET_ID, downloadUrl: signedUrl() },
          { assetId: FIRST_ASSET_ID, downloadUrl: signedUrl() },
        ],
      },
    });
    await expect(resolveChatGptInterpreterAssets(CONVERSATION_ID, candidates)).resolves.toEqual(
      createChatGptInterpreterResolverFailure('interpreter-result-invalid')
    );

    mocks.sendMessage.mockResolvedValue({ success: true, data: { resolved: 'not-an-array' } });
    await expect(resolveChatGptInterpreterAssets(CONVERSATION_ID, candidates)).resolves.toEqual(
      createChatGptInterpreterResolverFailure('interpreter-result-invalid')
    );

    mocks.sendMessage.mockResolvedValue({ success: false, code: 'source-http-error' });
    await expect(resolveChatGptInterpreterAssets(CONVERSATION_ID, candidates)).resolves.toEqual({
      success: false,
      code: 'source-http-error',
    });

    mocks.sendMessage.mockRejectedValue(new Error('synthetic runtime rejection'));
    await expect(resolveChatGptInterpreterAssets(CONVERSATION_ID, candidates)).resolves.toEqual(
      createChatGptInterpreterResolverFailure('interpreter-result-invalid')
    );
  });
});
