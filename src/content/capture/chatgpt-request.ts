import {
  createChatGptCaptureFailure,
  isChatGptCaptureResponse,
} from '../../lib/chatgpt-capture-contract';
import type { ChatGptCaptureResponse } from '../../lib/chatgpt-capture-contract';
import { sendMessage } from '../../lib/messaging';

/** Ask the background bridge to capture the conversation represented by this page. */
export async function requestChatGptConversationCapture(
  conversationId: string,
  observeAssetResolvers = false
): Promise<ChatGptCaptureResponse> {
  const response: unknown = await sendMessage({
    action: 'captureChatGptConversation',
    conversationId,
    ...(observeAssetResolvers ? { observeAssetResolvers: true } : {}),
  });
  const validated = isChatGptCaptureResponse(response)
    ? response
    : createChatGptCaptureFailure('unexpected-capture-result');
  if (!validated.success) {
    console.warn('[G2O] ChatGPT structured capture unavailable:', validated.code);
  }
  return validated;
}
