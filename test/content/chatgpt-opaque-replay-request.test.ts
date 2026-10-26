import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
      routeFamily: 'standard' as const,
      transientAssetResolvers: [] as [],
    },
  };
}

function replayAsCaptureSuccess() {
  return {
    success: true,
    data: { transport: 'inline', ...replaySuccess().data },
  };
}

function pendingMessage() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((resolveMessage, rejectMessage) => {
    resolve = resolveMessage;
    reject = rejectMessage;
  });
  return { promise, resolve, reject };
}

const capturePaths = [
  {
    name: 'archive',
    capture: () => captureChatGptArchiveViaOpaqueReplay(CONVERSATION_ID),
  },
  {
    name: 'current branch',
    capture: () => captureChatGptCurrentBranchViaOpaqueReplay(CONVERSATION_ID, false),
  },
];

describe('ChatGPT opaque replay content bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendMessage.mockResolvedValue(replaySuccess());
  });

  it.each(['standard', 'custom-gpt', 'project'] as const)(
    'retains only %s route-family evidence through both adapters',
    async routeFamily => {
      const replay = { ...replaySuccess(), data: { ...replaySuccess().data, routeFamily } };
      mocks.sendMessage.mockResolvedValue(replay);
      const checkDependencies = async (dependencies: {
        requestCapture: () => Promise<unknown>;
      }) => {
        expect(await dependencies.requestCapture()).toEqual({
          success: true,
          data: { transport: 'inline', ...replay.data },
        });
      };
      mocks.captureArchive.mockImplementation(async (_id, dependencies) =>
        checkDependencies(dependencies)
      );
      mocks.captureCurrentBranch.mockImplementation(async (_id, _tools, dependencies) =>
        checkDependencies(dependencies)
      );
      await captureChatGptArchiveViaOpaqueReplay(CONVERSATION_ID);
      await captureChatGptCurrentBranchViaOpaqueReplay(CONVERSATION_ID, false);
      expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(mocks.sendMessage.mock.calls)).not.toContain('routeFamily');
    }
  );

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
        expect(await requestCapture()).toEqual(replayAsCaptureSuccess());
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
        expect(await requestCapture()).toEqual(replayAsCaptureSuccess());
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

  describe('runtime message deadline', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it('rejects a pending message exactly once at 205,000 ms', async () => {
      const message = pendingMessage();
      mocks.sendMessage.mockReturnValueOnce(message.promise);
      const settled = vi.fn();
      const result = requestChatGptOpaqueReplayCapture(CONVERSATION_ID).then(
        response => settled('resolved', response),
        error => settled('rejected', error)
      );

      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(204_999);
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await result;
      expect(settled).toHaveBeenCalledExactlyOnceWith('rejected', expect.any(Error));
      expect(vi.getTimerCount()).toBe(0);

      await vi.advanceTimersByTimeAsync(205_000);
      expect(settled).toHaveBeenCalledOnce();
      expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith({
        action: 'captureChatGptConversationViaOpaqueReplay',
        conversationId: CONVERSATION_ID,
      });
      expect(mocks.captureArchive).not.toHaveBeenCalled();
      expect(mocks.captureCurrentBranch).not.toHaveBeenCalled();
    });

    it.each(capturePaths)(
      'returns only the fixed timeout code through $name',
      async ({ capture }) => {
        mocks.sendMessage.mockReturnValueOnce(pendingMessage().promise);
        const result = capture().catch((error: unknown) => error);

        await vi.advanceTimersByTimeAsync(205_000);

        const error = await result;
        expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
        expect(error).toMatchObject({
          code: 'capture-failed',
          detailCode: 'opaque-replay-runtime-message-timeout',
        });
        expect(Object.keys(error as object).sort()).toEqual([
          'archiveCompanion',
          'code',
          'detailCode',
          'name',
        ]);
        expect(error).not.toHaveProperty('cause');
        expect((error as Error).message).toBe(
          new ChatGptCurrentBranchError('capture-failed').message
        );
        expect(mocks.sendMessage).toHaveBeenCalledOnce();
        expect(mocks.captureArchive).not.toHaveBeenCalled();
        expect(mocks.captureCurrentBranch).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      }
    );

    it.each(['resolve', 'reject'] as const)('clears the timer on early %s', async outcome => {
      const message = pendingMessage();
      mocks.sendMessage.mockReturnValueOnce(message.promise);
      const result = requestChatGptOpaqueReplayCapture(CONVERSATION_ID);
      const settled = vi.fn();
      const observed = result.then(
        response => settled('resolved', response),
        error => settled('rejected', error)
      );
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(204_999);
      const failure = new Error('private runtime diagnostic');
      if (outcome === 'resolve') message.resolve(replaySuccess());
      else message.reject(failure);
      await observed;

      expect(vi.getTimerCount()).toBe(0);
      if (outcome === 'resolve') {
        expect(settled).toHaveBeenCalledExactlyOnceWith('resolved', replaySuccess());
      } else {
        expect(settled).toHaveBeenCalledExactlyOnceWith('rejected', failure);
      }
      await vi.advanceTimersByTimeAsync(205_000);
      expect(settled).toHaveBeenCalledOnce();
      expect(mocks.sendMessage).toHaveBeenCalledOnce();
    });

    it.each(capturePaths)(
      'keeps ordinary timeout-shaped rejection diagnostics private through $name',
      async ({ capture }) => {
        const failure = new Error('ChatGPT opaque replay runtime message timed out.');
        failure.name = 'OpaqueReplayRuntimeMessageTimeout';
        Object.assign(failure, {
          detailCode: 'opaque-replay-runtime-message-timeout',
          diagnostic: 'private runtime diagnostic',
        });
        mocks.sendMessage.mockRejectedValueOnce(failure);

        const error = await capture().catch((error: unknown) => error);
        expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
        expect(error).toMatchObject({
          code: 'capture-failed',
          detailCode: 'opaque-replay-runtime-message-failed',
        });
        expect(error).not.toHaveProperty('cause');
        expect(JSON.stringify(error)).not.toContain('private runtime diagnostic');
        expect((error as Error).message).toBe(
          new ChatGptCurrentBranchError('capture-failed').message
        );
        expect(mocks.captureArchive).not.toHaveBeenCalled();
        expect(mocks.captureCurrentBranch).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      }
    );

    it.each(
      capturePaths.flatMap(path =>
        (['resolve', 'reject'] as const).map(outcome => ({ ...path, outcome }))
      )
    )('ignores late $outcome after the $name timeout', async ({ capture, outcome }) => {
      const message = pendingMessage();
      mocks.sendMessage.mockReturnValueOnce(message.promise);
      const settled = vi.fn();
      const result = capture().then(
        response => settled('resolved', response),
        error => settled('rejected', error)
      );
      await vi.advanceTimersByTimeAsync(205_000);
      await result;
      const timeout = settled.mock.calls[0][1];
      expect(timeout).toMatchObject({ detailCode: 'opaque-replay-runtime-message-timeout' });

      if (outcome === 'resolve') message.resolve(replaySuccess());
      else message.reject(new Error('private late runtime diagnostic'));
      // Async timer advancement also flushes promise handlers and unhandled-rejection checks.
      await vi.advanceTimersByTimeAsync(205_000);

      expect(settled).toHaveBeenCalledExactlyOnceWith('rejected', timeout);
      expect(JSON.stringify(timeout)).not.toContain('private late runtime diagnostic');
      expect(mocks.sendMessage).toHaveBeenCalledOnce();
      expect(mocks.captureArchive).not.toHaveBeenCalled();
      expect(mocks.captureCurrentBranch).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
