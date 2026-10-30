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
import { abortStagedArchiveArtifact } from '../archive-stage';
import {
  captureChatGptArchive,
  captureChatGptCurrentBranch,
  ChatGptCurrentBranchError,
  type ChatGptArchiveCapture,
} from './chatgpt-current-branch';
import type { ArchiveProjectionResult } from '../archive-projection';

const RUNTIME_MESSAGE_TIMEOUT_MS = 205_000;
const STAGE_CLEANUP_TIMEOUT_MS = 500;
const runtimeMessageTimeouts = new WeakSet<object>();

/** Cleanup is exact, bounded, and never replaces the replay/pipeline outcome. */
async function abortReplayStage(stageId: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => abortStagedArchiveArtifact(stageId)),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, STAGE_CLEANUP_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // The existing stale-stage cleanup retains ownership if this attempt fails.
  } finally {
    clearTimeout(timer);
  }
}

function abortLateStagedReplay(response: unknown): void {
  try {
    if (
      isChatGptOpaqueReplayResponse(response) &&
      response.success &&
      'transport' in response.data &&
      response.data.transport === 'staged'
    ) {
      void abortReplayStage(response.data.stageId);
    }
  } catch {
    // Late malformed responses and validator exceptions cannot revive the request.
  }
}

/** Request only the explicit one-shot A-strict replay route. */
export async function requestChatGptOpaqueReplayCapture(
  conversationId: string
): Promise<ChatGptOpaqueReplayResponse> {
  const response: unknown = await new Promise((resolve, reject) => {
    let state: 'pending' | 'settled' | 'timed-out' = 'pending';
    const message = sendMessage({
      action: 'captureChatGptConversationViaOpaqueReplay',
      conversationId,
    });
    const timer = setTimeout(() => {
      state = 'timed-out';
      const error = new Error('ChatGPT opaque replay runtime message timed out.');
      runtimeMessageTimeouts.add(error);
      reject(error);
    }, RUNTIME_MESSAGE_TIMEOUT_MS);
    // Observe both late outcomes without retrying or cancelling the background request.
    void message.then(
      response => {
        if (state === 'timed-out') {
          abortLateStagedReplay(response);
          return;
        }
        state = 'settled';
        clearTimeout(timer);
        resolve(response);
      },
      error => {
        if (state === 'timed-out') return;
        state = 'settled';
        clearTimeout(timer);
        reject(error);
      }
    );
  });
  try {
    if (isChatGptOpaqueReplayResponse(response)) return response;
  } catch {
    // Keep malformed runtime responses inside the fixed replay failure boundary.
  }
  return createChatGptOpaqueReplayFailure('replay-result-invalid');
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
  } catch (error) {
    const timedOut =
      typeof error === 'object' && error !== null && runtimeMessageTimeouts.has(error);
    throw replayFailure(timedOut ? 'runtime-message-timeout' : 'runtime-message-failed');
  }
  if (!replay.success) throw replayFailure(replay.code);
  const data = replay.data;
  try {
    const common = {
      routeFamily: data.routeFamily,
      byteLength: data.byteLength,
      sha256: data.sha256,
      mediaType: data.mediaType,
      endpoint: data.endpoint,
      transientAssetResolvers: data.transientAssetResolvers,
    };
    const response: ChatGptCaptureResponse = {
      success: true,
      data:
        'transport' in data
          ? { transport: 'staged', stageId: data.stageId, ...common }
          : { transport: 'inline', bodyBase64: data.bodyBase64, ...common },
    };
    if (isChatGptCaptureResponse(response)) return response;
  } catch {
    // Adaptation/validation cannot transfer ownership of the replay stage.
  }
  if ('transport' in data) await abortReplayStage(data.stageId);
  throw replayFailure('capture-response-invalid');
}

async function withReplayCaptureResponse<T>(
  conversationId: string,
  capture: (requestCapture: () => Promise<ChatGptCaptureResponse>) => Promise<T>
): Promise<T> {
  const response = await replayAsCaptureResponse(conversationId);
  let transferred = false;
  try {
    return await capture(async () => {
      // The existing pipeline now owns cleanup and any retained raw companion.
      transferred = true;
      return response;
    });
  } finally {
    if (!transferred && response.success && response.data.transport === 'staged') {
      await abortReplayStage(response.data.stageId);
    }
  }
}

/** Compose replay bytes through the existing verified current-branch pipeline. */
export async function captureChatGptCurrentBranchViaOpaqueReplay(
  conversationId: string,
  includeToolContent: boolean
): Promise<ArchiveProjectionResult> {
  return withReplayCaptureResponse(conversationId, requestCapture =>
    captureChatGptCurrentBranch(conversationId, includeToolContent, { requestCapture })
  );
}

/** Compose replay bytes through the existing verified complete-archive pipeline. */
export async function captureChatGptArchiveViaOpaqueReplay(
  conversationId: string
): Promise<ChatGptArchiveCapture> {
  return withReplayCaptureResponse(conversationId, requestCapture =>
    captureChatGptArchive(conversationId, { requestCapture })
  );
}
