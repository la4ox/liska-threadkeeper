import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeItem,
  activeSuccess,
  ACTIVE_CONVERSATION_ID,
} from '../fixtures/chatgpt-active-asset';
const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('../../src/lib/messaging', () => ({ sendMessage: mocks.sendMessage }));
import { resolveChatGptActiveAsset } from '../../src/content/capture/chatgpt-active-asset-request';
describe('single-item active content bridge', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([
    'source-http-4xx',
    'source-http-5xx',
    'source-http-other',
    'source-response-processing-rejected',
    'source-http-error',
  ] as const)('propagates exact %s but sanitizes added source details', async code => {
    const response = { success: false, code };
    mocks.sendMessage.mockResolvedValue(response);
    expect(await resolveChatGptActiveAsset(ACTIVE_CONVERSATION_ID, activeItem())).toEqual(response);
    for (const extra of [
      { status: 500 },
      { statusText: 'private' },
      { error: 'private' },
      { url: 'https://private.invalid/' },
      { headers: 'private' },
      { body: 'private' },
    ]) {
      mocks.sendMessage.mockResolvedValue({ ...response, ...extra });
      expect(await resolveChatGptActiveAsset(ACTIVE_CONVERSATION_ID, activeItem())).toEqual({
        success: false,
        code: 'resolver-result-invalid',
      });
    }
  });
  it('sends only a copied one-item plan through the separate action', async () => {
    mocks.sendMessage.mockResolvedValue(activeSuccess());
    const item = activeItem();
    expect(await resolveChatGptActiveAsset(ACTIVE_CONVERSATION_ID, item)).toEqual(activeSuccess());
    expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith({
      action: 'resolveChatGptActiveAsset',
      conversationId: ACTIVE_CONVERSATION_ID,
      item,
    });
    expect(mocks.sendMessage.mock.calls[0][0].item).not.toBe(item);
  });
  it.each([null, [], [activeItem()], { ...activeItem(), extra: true }])(
    'rejects invalid item %# before send',
    async item => {
      expect(await resolveChatGptActiveAsset(ACTIVE_CONVERSATION_ID, item as never)).toEqual({
        success: false,
        code: 'invalid-provider-file-ids',
      });
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    }
  );
  it('rejects malformed, extra-data and differently bound responses with fixed failures', async () => {
    for (const response of [
      activeSuccess(activeItem('b')),
      { ...activeSuccess(), headers: 'private' },
      null,
    ]) {
      mocks.sendMessage.mockResolvedValue(response);
      expect(await resolveChatGptActiveAsset(ACTIVE_CONVERSATION_ID, activeItem())).toEqual({
        success: false,
        code: 'resolver-result-invalid',
      });
    }
    mocks.sendMessage.mockRejectedValue(new Error('private'));
    expect(await resolveChatGptActiveAsset(ACTIVE_CONVERSATION_ID, activeItem())).toEqual({
      success: false,
      code: 'resolver-result-invalid',
    });
  });
});
