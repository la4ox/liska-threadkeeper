/** Single-item transient bridge; provider IDs never appear in its response. */
import {
  activeAssetFailure,
  isChatGptActiveAssetPlanItem,
  isChatGptActiveAssetResponse,
  type ChatGptActiveAssetPlanItem,
  type ChatGptActiveAssetResponse,
} from '../../lib/chatgpt-active-asset-contract';
import { isChatGptConversationId } from '../../lib/chatgpt-capture-contract';
import { sendMessage } from '../../lib/messaging';

export async function resolveChatGptActiveAsset(
  conversationId: string,
  item: ChatGptActiveAssetPlanItem
): Promise<ChatGptActiveAssetResponse> {
  try {
    if (!isChatGptConversationId(conversationId))
      return activeAssetFailure('invalid-conversation-id');
    if (!isChatGptActiveAssetPlanItem(item)) return activeAssetFailure('invalid-provider-file-ids');
    const bound = { assetId: item.assetId, providerFileId: item.providerFileId };
    const response: unknown = await sendMessage({
      action: 'resolveChatGptActiveAsset',
      conversationId,
      item: bound,
    });
    return isChatGptActiveAssetResponse(response) &&
      (!response.success || response.data.assetId === bound.assetId)
      ? response
      : activeAssetFailure('resolver-result-invalid');
  } catch {
    return activeAssetFailure('resolver-result-invalid');
  }
}
