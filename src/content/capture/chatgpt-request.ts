import {
  createChatGptCaptureFailure,
  isChatGptCaptureResponse,
} from '../../lib/chatgpt-capture-contract';
import type { ChatGptCaptureResponse } from '../../lib/chatgpt-capture-contract';
import { sendMessage } from '../../lib/messaging';

/** Ask the background bridge to capture the conversation represented by this page. */
export async function requestChatGptConversationCapture(
  conversationId: string
): Promise<ChatGptCaptureResponse> {
  const response: unknown = await sendMessage({
    action: 'captureChatGptConversation',
    conversationId,
  });
  return isChatGptCaptureResponse(response)
    ? response
    : createChatGptCaptureFailure('unexpected-capture-result');
}
