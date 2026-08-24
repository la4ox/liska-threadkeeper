import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHATGPT_CAPTURE_ENDPOINT } from '../../src/lib/chatgpt-capture-contract';
import { createChatGptOpaqueReplayFailure } from '../../src/lib/chatgpt-opaque-replay-contract';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  captureCurrentBranch: vi.fn(),
  captureArchive: vi.fn(),
}));

vi.mock('../../src/lib/messaging', () => ({ sendMessage: mocks.sendMessage }));

vi.mock('../../src/content/capture/chatgpt-current-branch', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/content/capture/chatgpt-current-branch')>();
  return {
    ...actual,
    captureChatGptCurrentBranch: (...args: unknown[]) => mocks.captureCurrentBranch(...args),
    captureChatGptArchive: (...args: unknown[]) => mocks.captureArchive(...args),
  };
});

import {
  captureChatGptArchiveViaOpaqueReplay,
  captureChatGptCurrentBranchViaOpaqueReplay,
  requestChatGptOpaqueReplayCapture,
} from '../../src/content/capture/chatgpt-opaque-replay-request';
import { ChatGptCurrentBranchError } from '../../src/content/capture/chatgpt-current-branch';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';

function replaySuccess() {
  return {
    success: true as const,
    data: {
      bodyBase64: 'AP8B',
      byteLength: 3,
      sha256: '0'.repeat(64),
      mediaType: 'application/json',
      endpoint: CHATGPT_CAPTURE_ENDPOINT,
      transientAssetResolvers: [] as [],
    },
  };
}

describe('ChatGPT opaque replay content bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendMessage.mockResolvedValue(replaySuccess());
  });

  it('sends only the exact conversation identifier and validates the response', async () => {
    await expect(requestChatGptOpaqueReplayCapture(CONVERSATION_ID)).resolves.toEqual(
      replaySuccess()
    );
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      action: 'captureChatGptConversationViaOpaqueReplay',
      conversationId: CONVERSATION_ID,
    });

    mocks.sendMessage.mockResolvedValueOnce({ ...replaySuccess(), secret: 'must-not-cross' });
    await expect(requestChatGptOpaqueReplayCapture(CONVERSATION_ID)).resolves.toEqual(
      createChatGptOpaqueReplayFailure('replay-result-invalid')
    );
  });

  it('adapts one replay response into the existing current-branch verifier exactly once', async () => {
    const projection = { warnings: [] };
    mocks.captureCurrentBranch.mockImplementation(
      async (_conversationId: string, _includeTools: boolean, dependencies: never) => {
        const requestCapture = (dependencies as { requestCapture: () => Promise<unknown> })
          .requestCapture;
        expect(await requestCapture()).toEqual(replaySuccess());
        return projection;
      }
    );

    await expect(captureChatGptCurrentBranchViaOpaqueReplay(CONVERSATION_ID, true)).resolves.toBe(
      projection
    );
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    expect(mocks.captureCurrentBranch).toHaveBeenCalledWith(
      CONVERSATION_ID,
      true,
      expect.objectContaining({ requestCapture: expect.any(Function) })
    );
  });

  it('adapts one replay response into the complete-archive verifier exactly once', async () => {
    const archive = { archive: {} };
    mocks.captureArchive.mockImplementation(
      async (_conversationId: string, dependencies: never) => {
        const requestCapture = (dependencies as { requestCapture: () => Promise<unknown> })
          .requestCapture;
        expect(await requestCapture()).toEqual(replaySuccess());
        return archive;
      }
    );

    await expect(captureChatGptArchiveViaOpaqueReplay(CONVERSATION_ID)).resolves.toBe(archive);
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });

  it('surfaces a stable replay code without entering the archive verifier', async () => {
    mocks.sendMessage.mockResolvedValueOnce(createChatGptOpaqueReplayFailure('source-non-json'));

    await expect(captureChatGptArchiveViaOpaqueReplay(CONVERSATION_ID)).rejects.toMatchObject({
      name: ChatGptCurrentBranchError.name,
      code: 'capture-failed',
      detailCode: 'opaque-replay-source-non-json',
    });
    expect(mocks.captureArchive).not.toHaveBeenCalled();
  });

  it('maps a runtime-message rejection to one stable replay detail code', async () => {
    mocks.sendMessage.mockRejectedValueOnce(new Error('private runtime diagnostic'));

    await expect(captureChatGptArchiveViaOpaqueReplay(CONVERSATION_ID)).rejects.toMatchObject({
      code: 'capture-failed',
      detailCode: 'opaque-replay-runtime-message-failed',
    });
    expect(mocks.captureArchive).not.toHaveBeenCalled();
  });
});
