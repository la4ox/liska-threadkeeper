/** Strict content bridge for one transient ChatGPT interpreter resolver run. */

import {
  createChatGptInterpreterResolverFailure,
  isChatGptInterpreterCandidates,
  isChatGptInterpreterResolverResponse,
  type ChatGptInterpreterAssetCandidate,
  type ChatGptInterpreterResolverResponse,
} from '../../lib/chatgpt-interpreter-resolver-contract';
import {
  isChatGptConversationId,
  isChatGptTransientDownloadUrl,
} from '../../lib/chatgpt-capture-contract';
import { sendMessage } from '../../lib/messaging';

/**
 * Resolve only the exact caller-supplied candidate plan. This bridge rechecks
 * a background response against its original input before returning it.
 */
export async function resolveChatGptInterpreterAssets(
  conversationId: string,
  candidates: ChatGptInterpreterAssetCandidate[]
): Promise<ChatGptInterpreterResolverResponse> {
  try {
    if (!isChatGptConversationId(conversationId)) {
      return createChatGptInterpreterResolverFailure('invalid-conversation-id');
    }
    if (!isChatGptInterpreterCandidates(candidates)) {
      return createChatGptInterpreterResolverFailure('invalid-interpreter-candidates');
    }
    const exactCandidates = candidates.map(candidate => ({
      assetId: candidate.assetId,
      messageId: candidate.messageId,
      sandboxPath: candidate.sandboxPath,
    }));
    const response: unknown = await sendMessage({
      action: 'resolveChatGptInterpreterAssets',
      conversationId,
      candidates: exactCandidates,
    });
    if (!isChatGptInterpreterResolverResponse(response)) {
      return createChatGptInterpreterResolverFailure('interpreter-result-invalid');
    }
    if (!response.success) return response;
    const positions = new Map(
      exactCandidates.map((candidate, index) => [candidate.assetId, index])
    );
    let previousIndex = -1;
    for (const resolved of response.data.resolved) {
      const index = positions.get(resolved.assetId);
      if (
        index === undefined ||
        index <= previousIndex ||
        !isChatGptTransientDownloadUrl(resolved.downloadUrl, conversationId)
      ) {
        return createChatGptInterpreterResolverFailure('interpreter-result-invalid');
      }
      previousIndex = index;
    }
    return response;
  } catch {
    return createChatGptInterpreterResolverFailure('interpreter-result-invalid');
  }
}
