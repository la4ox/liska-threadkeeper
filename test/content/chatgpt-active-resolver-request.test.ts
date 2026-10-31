import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatGptActiveResolverFailure } from '../../src/lib/chatgpt-active-resolver-contract';

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock('../../src/lib/messaging', () => ({ sendMessage: mocks.sendMessage }));

import { probeChatGptActiveAssetResolvers } from '../../src/content/capture/chatgpt-active-resolver-request';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';

function metricResponse() {
  return {
    success: true as const,
    data: {
      requestedCount: 1,
      dispatchCount: 1,
      observedCount: 1,
      outcomes: ['observed'] as const,
      attemptedAt: '2026-08-24T12:00:00.000Z',
    },
  };
}

describe('ChatGPT active resolver content bridge', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([400, 403, 404, 429, 499])(
    'preserves exact source 4xx status %s through the metric bridge',
    async sourceHttpStatus => {
      const response = { success: false, code: 'source-http-4xx', sourceHttpStatus };
      mocks.sendMessage.mockResolvedValue(response);
      expect(
        await probeChatGptActiveAssetResolvers(CONVERSATION_ID, ['synthetic-file-one'])
      ).toEqual(response);
    }
  );

  it('sanitizes malformed, accessor and smuggled source statuses without invoking the getter', async () => {
    const getter = vi.fn(() => 403);
    const accessor = { success: false, code: 'source-http-4xx' };
    Object.defineProperty(accessor, 'sourceHttpStatus', { get: getter });
    for (const response of [
      accessor,
      Object.assign(Object.create({ sourceHttpStatus: 403 }), {
        success: false,
        code: 'source-http-4xx',
      }),
      ...[399, 500, '403', 403.5, NaN, Infinity, -Infinity, null, undefined].map(
        sourceHttpStatus => ({ success: false, code: 'source-http-4xx', sourceHttpStatus })
      ),
      ...['source-http-error', 'source-http-5xx', 'source-http-other'].map(code => ({
        success: false,
        code,
        sourceHttpStatus: 403,
      })),
      { success: false, code: 'source-http-4xx', sourceHttpStatus: 403, extra: true },
      { success: false, code: 'source-http-4xx', sourceHttpStatus: 403, [Symbol('private')]: true },
      { ...metricResponse(), sourceHttpStatus: 403 },
    ]) {
      mocks.sendMessage.mockResolvedValue(response);
      expect(
        await probeChatGptActiveAssetResolvers(CONVERSATION_ID, ['synthetic-file-one'])
      ).toEqual(createChatGptActiveResolverFailure('resolver-result-invalid'));
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    'source-http-4xx',
    'source-http-5xx',
    'source-http-other',
    'source-response-processing-rejected',
    'source-http-error',
  ] as const)('propagates exact %s but rejects provider details at the bridge', async code => {
    const response = { success: false, code };
    mocks.sendMessage.mockResolvedValue(response);
    expect(await probeChatGptActiveAssetResolvers(CONVERSATION_ID, ['synthetic-file-one'])).toEqual(
      response
    );
    for (const extra of [
      { status: 500 },
      { statusText: 'private' },
      { error: 'private' },
      { url: 'https://private.invalid/' },
      { headers: 'private' },
      { body: 'private' },
    ]) {
      mocks.sendMessage.mockResolvedValue({ ...response, ...extra });
      expect(
        await probeChatGptActiveAssetResolvers(CONVERSATION_ID, ['synthetic-file-one'])
      ).toEqual(createChatGptActiveResolverFailure('resolver-result-invalid'));
    }
  });

  it('sends the exact transient ID list and returns only validated metrics', async () => {
    const providerFileIds = ['synthetic-file-one'];
    const response = metricResponse();
    mocks.sendMessage.mockResolvedValue(response);

    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, providerFileIds)
    ).resolves.toEqual(response);

    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      action: 'probeChatGptActiveAssetResolvers',
      conversationId: CONVERSATION_ID,
      providerFileIds,
    });
    expect(Object.keys(mocks.sendMessage.mock.calls[0][0])).toEqual([
      'action',
      'conversationId',
      'providerFileIds',
    ]);
    const returned = JSON.stringify(response);
    expect(returned).not.toContain('synthetic-file-one');
    expect(returned).not.toContain('https://');
  });

  it.each([
    ['a plural list', ['synthetic-file-one', 'synthetic-file-two']],
    ['an empty list', []],
    ['an unsafe ID', ['../synthetic-private-id']],
  ])('rejects %s before runtime messaging', async (_label, providerFileIds) => {
    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, providerFileIds)
    ).resolves.toEqual(createChatGptActiveResolverFailure('invalid-provider-file-ids'));
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects an invalid conversation before runtime messaging', async () => {
    await expect(
      probeChatGptActiveAssetResolvers('not-a-conversation', ['synthetic-file-one'])
    ).resolves.toEqual(createChatGptActiveResolverFailure('invalid-conversation-id'));
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('replaces malformed responses with one stable metric-only failure', async () => {
    mocks.sendMessage.mockResolvedValue({
      success: true,
      data: metricResponse().data,
      providerFileId: 'synthetic-private-id',
      downloadUrl: 'https://chatgpt.com/synthetic-signed-url',
    });

    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, ['synthetic-file-one'])
    ).resolves.toEqual(createChatGptActiveResolverFailure('resolver-result-invalid'));
  });

  it('maps a rejected runtime sendMessage to the same stable failure', async () => {
    mocks.sendMessage.mockRejectedValue(new Error('private runtime diagnostic'));

    await expect(
      probeChatGptActiveAssetResolvers(CONVERSATION_ID, ['synthetic-file-one'])
    ).resolves.toEqual(createChatGptActiveResolverFailure('resolver-result-invalid'));
  });
});
