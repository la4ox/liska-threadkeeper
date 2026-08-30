import {
  createChatGptOpaqueProbeResult,
  isChatGptOpaqueProbeResponse,
  type ChatGptOpaqueProbeResponse,
} from '../../lib/chatgpt-opaque-probe-contract';
import { sendMessage } from '../../lib/messaging';

/** Request only the bounded experimental metadata probe; no archive is returned. */
export async function requestChatGptOpaqueProbe(
  conversationId: string
): Promise<ChatGptOpaqueProbeResponse> {
  const response: unknown = await sendMessage({
    action: 'probeChatGptOpaqueRequest',
    conversationId,
  });
  return isChatGptOpaqueProbeResponse(response)
    ? response
    : { success: false, data: createChatGptOpaqueProbeResult('probe-failed') };
}
