import { describe, expect, it, afterEach, vi } from 'vitest';
import rawFixture from '../fixtures/archive/chatgpt-raw/branching-mixed-content.json';
import {
  CHATGPT_CAPTURE_ENDPOINT,
  createChatGptCaptureFailure,
  type ChatGptCaptureResponse,
} from '../../src/lib/chatgpt-capture-contract';
import {
  ChatGptCurrentBranchError,
  captureChatGptCurrentBranch,
  manifestAllowsChatGptStructuredCapture,
} from '../../src/content/capture/chatgpt-current-branch';
import { sha256Hex } from '../../src/content/capture/response';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const CAPTURE_TIME = '2026-08-17T12:00:00.000Z';

const originalManifestDescriptor = Object.getOwnPropertyDescriptor(chrome.runtime, 'getManifest');

afterEach(() => {
  if (originalManifestDescriptor) {
    Object.defineProperty(chrome.runtime, 'getManifest', originalManifestDescriptor);
  } else {
    delete (chrome.runtime as { getManifest?: unknown }).getManifest;
  }
});

function setManifestReader(reader: () => unknown): void {
  Object.defineProperty(chrome.runtime, 'getManifest', {
    value: reader,
    configurable: true,
  });
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

async function successfulResponse(
  mutate?: (payload: Record<string, unknown>) => void
): Promise<ChatGptCaptureResponse> {
  const payload = JSON.parse(JSON.stringify(rawFixture)) as Record<string, unknown>;
  payload.conversation_id = CONVERSATION_ID;
  payload.url = `https://chatgpt.com/c/${CONVERSATION_ID}`;
  mutate?.(payload);

  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return {
    success: true,
    data: {
      bodyBase64: base64(bytes),
      byteLength: bytes.byteLength,
      sha256: await sha256Hex(bytes),
      mediaType: 'application/json',
      endpoint: CHATGPT_CAPTURE_ENDPOINT,
    },
  };
}

function fixedNow(): Date {
  return new Date(CAPTURE_TIME);
}

function fixedCaptureId(): string {
  return 'capture-chatgpt-01234567-89ab-4cde-8f01-23456789abcd';
}

describe('ChatGPT current-branch capture composition', () => {
  it('enables the structured bridge only when the static manifest declares scripting', () => {
    setManifestReader(() => ({ permissions: ['storage', 'scripting'] }));
    expect(manifestAllowsChatGptStructuredCapture()).toBe(true);

    setManifestReader(() => ({ permissions: ['storage'] }));
    expect(manifestAllowsChatGptStructuredCapture()).toBe(false);
  });

  it('fails closed when the manifest API is missing or throws', () => {
    delete (chrome.runtime as { getManifest?: unknown }).getManifest;
    expect(manifestAllowsChatGptStructuredCapture()).toBe(false);

    setManifestReader(() => {
      throw new Error('browser diagnostic must not cross the capture boundary');
    });
    expect(manifestAllowsChatGptStructuredCapture()).toBe(false);
  });

  it('verifies the synthetic graph, retaining its current branch projection and tool content', async () => {
    const requestCapture = vi.fn().mockResolvedValue(await successfulResponse());

    const projection = await captureChatGptCurrentBranch(CONVERSATION_ID, true, {
      requestCapture,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });

    expect(requestCapture).toHaveBeenCalledOnce();
    expect(requestCapture).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(projection.selectedNodeIds).toEqual([
      'node/root~structural',
      'node/user',
      'node/current',
    ]);
    expect(projection.selectedNodeIds).not.toContain('node/alternate');
    expect(projection.data.messages.map(message => message.id)).toEqual([
      'message/user',
      'message/current',
    ]);
    expect(projection.data.messages[1]?.content).toContain('First text part.');
    expect(projection.data.messages[1]?.toolContent).toContain('Synthetic recap.');
  });

  it('projects the same verified branch without tool content when disabled', async () => {
    const projection = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: () => successfulResponse(),
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });

    expect(projection.data.messages[1]?.toolContent).toBeUndefined();
  });

  it.each([
    [
      'a malformed response',
      async () => ({ success: true, data: { bodyBase64: 'malformed' } }) as ChatGptCaptureResponse,
      'capture-response-invalid',
    ],
    [
      'a tampered artifact hash',
      async () => {
        const response = await successfulResponse();
        if (response.success) response.data.sha256 = '0'.repeat(64);
        return response;
      },
      'normalization-failed',
    ],
    [
      'a safe background failure',
      async () => createChatGptCaptureFailure('capture-failed'),
      'capture-failed',
    ],
  ])('fails closed for %s', async (_label, makeResponse, expectedCode) => {
    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: makeResponse,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe(expectedCode);
    expect(String((error as Error).message)).not.toContain(CONVERSATION_ID);
  });

  it('obtains fresh capture provenance from the injected factory for every event', async () => {
    const createCaptureId = vi
      .fn()
      .mockReturnValueOnce('capture-chatgpt-11111111-2222-3333-4444-555555555555')
      .mockReturnValueOnce('capture-chatgpt-22222222-3333-4444-5555-666666666666');
    const dependencies = {
      requestCapture: () => successfulResponse(),
      createCaptureId,
      now: fixedNow,
    };

    await captureChatGptCurrentBranch(CONVERSATION_ID, false, dependencies);
    await captureChatGptCurrentBranch(CONVERSATION_ID, false, dependencies);

    expect(createCaptureId).toHaveBeenCalledTimes(2);
    expect(createCaptureId.mock.results.map(result => result.value)).toEqual([
      'capture-chatgpt-11111111-2222-3333-4444-555555555555',
      'capture-chatgpt-22222222-3333-4444-5555-666666666666',
    ]);
  });

  it('fails closed when the capture-id factory is unavailable', async () => {
    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: () => successfulResponse(),
      createCaptureId: () => {
        throw new Error('factory failed');
      },
      now: fixedNow,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('capture-id-unavailable');
  });

  it('fails closed when the capture-id factory returns an unsafe value', async () => {
    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: () => successfulResponse(),
      createCaptureId: () => 'capture-chatgpt-../unsafe',
      now: fixedNow,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('capture-id-invalid');
  });
});
