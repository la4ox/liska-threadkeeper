import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHATGPT_CAPTURE_ENDPOINT } from '../../src/lib/chatgpt-capture-contract';
import { createChatGptOpaqueReplayFailure } from '../../src/lib/chatgpt-opaque-replay-contract';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  captureCurrentBranch: vi.fn(),
  captureArchive: vi.fn(),
  abortStage: vi.fn(),
  validateCaptureResponse: vi.fn(),
}));

vi.mock('../../src/lib/messaging', () => ({ sendMessage: mocks.sendMessage }));
vi.mock('../../src/content/archive-stage', () => ({
  abortStagedArchiveArtifact: (...args: unknown[]) => mocks.abortStage(...args),
}));
vi.mock('../../src/lib/chatgpt-capture-contract', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/chatgpt-capture-contract')>();
  return {
    ...actual,
    isChatGptCaptureResponse: (value: unknown) =>
      mocks.validateCaptureResponse(value) ?? actual.isChatGptCaptureResponse(value),
  };
});

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
const STAGE_ID = `archive-stage-${'A'.repeat(32)}`;

function stagedReplaySuccess() {
  return {
    success: true as const,
    data: {
      transport: 'staged' as const,
      stageId: STAGE_ID,
      kind: 'raw' as const,
      relativePath: 'responses/conversation.json' as const,
      byteLength: 16 * 1024 * 1024 + 1,
      sha256: 'a'.repeat(64),
      mediaType: 'application/json' as const,
      endpoint: CHATGPT_CAPTURE_ENDPOINT,
      routeFamily: 'standard' as const,
      transientAssetResolvers: [] as [],
    },
  };
}

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

function mockPipelines(consume: (requestCapture: () => Promise<unknown>) => unknown): void {
  mocks.captureArchive.mockImplementation((_id, dependencies) =>
    consume(dependencies.requestCapture)
  );
  mocks.captureCurrentBranch.mockImplementation((_id, _tools, dependencies) =>
    consume(dependencies.requestCapture)
  );
}

describe('ChatGPT opaque replay content bridge', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.sendMessage.mockResolvedValue(replaySuccess());
    mocks.abortStage.mockResolvedValue(undefined);
  });

  it.each(
    capturePaths.flatMap(path =>
      (['standard', 'custom-gpt', 'project'] as const).map(routeFamily => ({
        ...path,
        routeFamily,
      }))
    )
  )('transfers only exact staged capture keys through $name/$routeFamily', async testCase => {
    const replay = stagedReplaySuccess();
    const data = { ...replay.data, routeFamily: testCase.routeFamily };
    mocks.sendMessage.mockResolvedValue({ success: true, data });
    const result = { archiveCompanion: { stageId: STAGE_ID } };
    mockPipelines(async requestCapture => {
      const response = await requestCapture();
      expect(response).toEqual({
        success: true,
        data: {
          transport: 'staged',
          stageId: STAGE_ID,
          routeFamily: testCase.routeFamily,
          byteLength: data.byteLength,
          sha256: data.sha256,
          mediaType: data.mediaType,
          endpoint: data.endpoint,
          transientAssetResolvers: [],
        },
      });
      expect(Object.keys((response as { data: object }).data).sort()).toEqual([
        'byteLength',
        'endpoint',
        'mediaType',
        'routeFamily',
        'sha256',
        'stageId',
        'transientAssetResolvers',
        'transport',
      ]);
      return result;
    });

    await expect(testCase.capture()).resolves.toBe(result);
    expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith({
      action: 'captureChatGptConversationViaOpaqueReplay',
      conversationId: CONVERSATION_ID,
    });
    expect(mocks.abortStage).not.toHaveBeenCalled();
  });

  it.each(capturePaths)(
    'retains downstream raw-companion errors after $name ownership transfer',
    async ({ capture }) => {
      mocks.sendMessage.mockResolvedValue(stagedReplaySuccess());
      const companion = { artifacts: [stagedReplaySuccess().data] };
      const failure = Object.assign(new ChatGptCurrentBranchError('normalization-failed'), {
        archiveCompanion: companion,
      });
      mockPipelines(async requestCapture => {
        await requestCapture();
        throw failure;
      });

      await expect(capture()).rejects.toBe(failure);
      expect(failure.archiveCompanion).toBe(companion);
      expect(mocks.abortStage).not.toHaveBeenCalled();
      expect(mocks.sendMessage).toHaveBeenCalledOnce();
    }
  );

  it.each(
    capturePaths.flatMap(path =>
      (['return', 'throw'] as const).map(outcome => ({ ...path, outcome }))
    )
  )(
    'aborts an unconsumed stage on $name $outcome before transfer',
    async ({ capture, outcome }) => {
      mocks.sendMessage.mockResolvedValue(stagedReplaySuccess());
      const result = { retained: false };
      const failure = new Error('injection failed');
      mockPipelines(() => {
        if (outcome === 'throw') throw failure;
        return result;
      });

      if (outcome === 'throw') await expect(capture()).rejects.toBe(failure);
      else await expect(capture()).resolves.toBe(result);
      expect(mocks.abortStage).toHaveBeenCalledExactlyOnceWith(STAGE_ID);
      expect(mocks.sendMessage).toHaveBeenCalledOnce();
    }
  );

  it.each(
    capturePaths.flatMap(path =>
      (['reject', 'throw'] as const).map(validation => ({ ...path, validation }))
    )
  )('aborts staged adaptation $validation through $name', async ({ capture, validation }) => {
    mocks.sendMessage.mockResolvedValue(stagedReplaySuccess());
    mocks.validateCaptureResponse.mockImplementation(() => {
      if (validation === 'throw') throw new Error('private validator diagnostic');
      return false;
    });

    await expect(capture()).rejects.toMatchObject({
      detailCode: 'opaque-replay-capture-response-invalid',
    });
    expect(mocks.abortStage).toHaveBeenCalledExactlyOnceWith(STAGE_ID);
    expect(mocks.captureArchive).not.toHaveBeenCalled();
    expect(mocks.captureCurrentBranch).not.toHaveBeenCalled();
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

    it.each(capturePaths)(
      'claims the $name timeout before a same-turn staged fulfillment',
      async ({ capture }) => {
        const message = pendingMessage();
        mocks.sendMessage.mockReturnValueOnce(message.promise);
        const result = capture().catch((error: unknown) => error);

        // No promise continuation runs between the deadline and this fulfillment.
        vi.advanceTimersByTime(205_000);
        message.resolve(stagedReplaySuccess());
        await vi.advanceTimersByTimeAsync(500);

        await expect(result).resolves.toMatchObject({
          detailCode: 'opaque-replay-runtime-message-timeout',
        });
        expect(mocks.abortStage).toHaveBeenCalledExactlyOnceWith(STAGE_ID);
        expect(mocks.sendMessage).toHaveBeenCalledOnce();
        expect(mocks.captureArchive).not.toHaveBeenCalled();
        expect(mocks.captureCurrentBranch).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      }
    );

    it.each(
      capturePaths.flatMap(path =>
        (['success', 'throw', 'reject', 'pending'] as const).map(cleanup => ({
          ...path,
          cleanup,
        }))
      )
    )('aborts a late staged $name success exactly once with $cleanup cleanup', async testCase => {
      const message = pendingMessage();
      mocks.sendMessage.mockReturnValueOnce(message.promise);
      mocks.abortStage.mockImplementation(() => {
        if (testCase.cleanup === 'throw') throw new Error('private cleanup diagnostic');
        if (testCase.cleanup === 'reject')
          return Promise.reject(new Error('private cleanup diagnostic'));
        if (testCase.cleanup === 'pending') return new Promise(() => {});
        return Promise.resolve();
      });
      const settled = vi.fn();
      const result = testCase.capture().then(
        response => settled('resolved', response),
        error => settled('rejected', error)
      );
      await vi.advanceTimersByTimeAsync(205_000);
      await result;
      const timeout = settled.mock.calls[0][1];

      message.resolve(stagedReplaySuccess());
      await vi.advanceTimersByTimeAsync(500);

      expect(settled).toHaveBeenCalledExactlyOnceWith('rejected', timeout);
      expect(timeout).toMatchObject({ detailCode: 'opaque-replay-runtime-message-timeout' });
      expect(mocks.abortStage).toHaveBeenCalledExactlyOnceWith(STAGE_ID);
      expect(mocks.sendMessage).toHaveBeenCalledOnce();
      expect(mocks.captureArchive).not.toHaveBeenCalled();
      expect(mocks.captureCurrentBranch).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each(
      capturePaths.flatMap(path =>
        [
          { outcome: 'inline', response: replaySuccess() },
          { outcome: 'failure', response: createChatGptOpaqueReplayFailure('target-not-observed') },
          {
            outcome: 'malformed staged envelope',
            response: { ...stagedReplaySuccess(), extra: true },
          },
          {
            outcome: 'naked stage',
            response: { success: true, data: { stageId: STAGE_ID, transport: 'staged' } },
          },
          {
            outcome: 'validator exception',
            response: new Proxy(
              {},
              {
                getOwnPropertyDescriptor() {
                  throw new Error('private late validator diagnostic');
                },
              }
            ),
          },
          { outcome: 'rejection', response: undefined },
        ].map(outcome => ({ ...path, ...outcome }))
      )
    )(
      'ignores late $outcome through $name without cleanup',
      async ({ capture, outcome, response }) => {
        const message = pendingMessage();
        mocks.sendMessage.mockReturnValueOnce(message.promise);
        const result = capture().catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(205_000);
        await result;

        if (outcome === 'rejection') message.reject(new Error('private late runtime diagnostic'));
        else message.resolve(response);
        await vi.advanceTimersByTimeAsync(500);

        expect(mocks.abortStage).not.toHaveBeenCalled();
        expect(mocks.sendMessage).toHaveBeenCalledOnce();
        expect(mocks.captureArchive).not.toHaveBeenCalled();
        expect(mocks.captureCurrentBranch).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      }
    );

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
