/** Credential-free content bridge for the post-persistence resolver observer. */

import {
  createChatGptOpaqueResolverFailure,
  isChatGptOpaqueResolverResponse,
  type ChatGptOpaqueResolverResponse,
} from '../../lib/chatgpt-opaque-resolver-contract';
import { sendMessage } from '../../lib/messaging';

/** Send only the conversation identifier; resolver bodies and IDs never enter a request field. */
export async function requestChatGptOpaqueResolverObservation(
  conversationId: string
): Promise<ChatGptOpaqueResolverResponse> {
  try {
    const response: unknown = await sendMessage({
      action: 'observeChatGptAssetResolversViaOpaqueSource',
      conversationId,
    });
    return isChatGptOpaqueResolverResponse(response)
      ? response
      : createChatGptOpaqueResolverFailure('observer-result-invalid');
  } catch {
    return createChatGptOpaqueResolverFailure('observer-result-invalid');
  }
}
