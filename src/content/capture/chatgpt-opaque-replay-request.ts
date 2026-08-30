import {
  createChatGptOpaqueReplayFailure,
  isChatGptOpaqueReplayResponse,
  type ChatGptOpaqueReplayResponse,
} from '../../lib/chatgpt-opaque-replay-contract';
import {
  isChatGptCaptureResponse,
  type ChatGptCaptureResponse,
} from '../../lib/chatgpt-capture-contract';
import { sendMessage } from '../../lib/messaging';
import {
  captureChatGptArchive,
  captureChatGptCurrentBranch,
  ChatGptCurrentBranchError,
  type ChatGptArchiveCapture,
} from './chatgpt-current-branch';
import type { ArchiveProjectionResult } from '../archive-projection';

/** Request only the explicit one-shot A-strict replay route. */
export async function requestChatGptOpaqueReplayCapture(
  conversationId: string
): Promise<ChatGptOpaqueReplayResponse> {
  const response: unknown = await sendMessage({
    action: 'captureChatGptConversationViaOpaqueReplay',
    conversationId,
  });
  return isChatGptOpaqueReplayResponse(response)
    ? response
    : createChatGptOpaqueReplayFailure('replay-result-invalid');
}

function replayFailure(code: string): ChatGptCurrentBranchError {
  return new ChatGptCurrentBranchError('capture-failed', {
    detailCode: `opaque-replay-${code}`,
  });
}

async function replayAsCaptureResponse(conversationId: string): Promise<ChatGptCaptureResponse> {
  let replay: ChatGptOpaqueReplayResponse;
  try {
    replay = await requestChatGptOpaqueReplayCapture(conversationId);
  } catch {
    throw replayFailure('runtime-message-failed');
  }
  if (!replay.success) throw replayFailure(replay.code);
  const response: ChatGptCaptureResponse = { success: true, data: replay.data };
  if (!isChatGptCaptureResponse(response)) throw replayFailure('capture-response-invalid');
  return response;
}

/** Compose replay bytes through the existing verified current-branch pipeline. */
export async function captureChatGptCurrentBranchViaOpaqueReplay(
  conversationId: string,
  includeToolContent: boolean
): Promise<ArchiveProjectionResult> {
  const response = await replayAsCaptureResponse(conversationId);
  return captureChatGptCurrentBranch(conversationId, includeToolContent, {
    requestCapture: async () => response,
  });
}

/** Compose replay bytes through the existing verified complete-archive pipeline. */
export async function captureChatGptArchiveViaOpaqueReplay(
  conversationId: string
): Promise<ChatGptArchiveCapture> {
  const response = await replayAsCaptureResponse(conversationId);
  return captureChatGptArchive(conversationId, {
    requestCapture: async () => response,
  });
}
