/** Metric-only content bridge for the active opaque ChatGPT resolver. */

import {
  CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT,
  createChatGptActiveResolverFailure,
  isChatGptActiveResolverResponse,
  isChatGptActiveResolverProviderFileId,
  type ChatGptActiveResolverResponse,
} from '../../lib/chatgpt-active-resolver-contract';
import { isChatGptConversationId } from '../../lib/chatgpt-capture-contract';
import { sendMessage } from '../../lib/messaging';

/** Provider IDs are transient message arguments and never returned by this bridge. */
export async function probeChatGptActiveAssetResolvers(
  conversationId: string,
  providerFileIds: string[]
): Promise<ChatGptActiveResolverResponse> {
  try {
    if (!isChatGptConversationId(conversationId)) {
      return createChatGptActiveResolverFailure('invalid-conversation-id');
    }
    if (
      !Array.isArray(providerFileIds) ||
      providerFileIds.length !== CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT
    ) {
      return createChatGptActiveResolverFailure('invalid-provider-file-ids');
    }
    const providerFileId = providerFileIds[0];
    if (!isChatGptActiveResolverProviderFileId(providerFileId)) {
      return createChatGptActiveResolverFailure('invalid-provider-file-ids');
    }
    const exactProviderFileIds = [providerFileId];
    const response: unknown = await sendMessage({
      action: 'probeChatGptActiveAssetResolvers',
      conversationId,
      providerFileIds: exactProviderFileIds,
    });
    return isChatGptActiveResolverResponse(response)
      ? response
      : createChatGptActiveResolverFailure('resolver-result-invalid');
  } catch {
    return createChatGptActiveResolverFailure('resolver-result-invalid');
  }
}
