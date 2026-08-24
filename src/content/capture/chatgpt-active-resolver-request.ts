/** Metric-only content bridge for the active opaque ChatGPT resolver. */

import {
  createChatGptActiveResolverFailure,
  isChatGptActiveResolverResponse,
  type ChatGptActiveResolverResponse,
} from '../../lib/chatgpt-active-resolver-contract';
import { sendMessage } from '../../lib/messaging';

/** Provider IDs are transient message arguments and never returned by this bridge. */
export async function probeChatGptActiveAssetResolvers(
  conversationId: string,
  providerFileIds: string[]
): Promise<ChatGptActiveResolverResponse> {
  try {
    const response: unknown = await sendMessage({
      action: 'probeChatGptActiveAssetResolvers',
      conversationId,
      providerFileIds,
    });
    return isChatGptActiveResolverResponse(response)
      ? response
      : createChatGptActiveResolverFailure('resolver-result-invalid');
  } catch {
    return createChatGptActiveResolverFailure('resolver-result-invalid');
  }
}
