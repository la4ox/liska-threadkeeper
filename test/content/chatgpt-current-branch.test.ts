import { describe, expect, it, afterEach, vi } from 'vitest';
import rawFixture from '../fixtures/archive/chatgpt-raw/branching-mixed-content.json';
import {
  CHATGPT_CAPTURE_ENDPOINT,
  createChatGptCaptureFailure,
  type ChatGptCaptureResponse,
} from '../../src/lib/chatgpt-capture-contract';
import {
  ChatGptCurrentBranchError,
  captureChatGptArchive,
  captureChatGptCurrentBranch,
  manifestAllowsChatGptStructuredCapture,
} from '../../src/content/capture/chatgpt-current-branch';
import { normalizeChatGptCapture } from '../../src/archive';
import { sha256Hex } from '../../src/content/capture/response';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const CAPTURE_TIME = '2026-08-17T12:00:00.000Z';

const originalManifestDescriptor = Object.getOwnPropertyDescriptor(chrome.runtime, 'getManifest');
const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalAtobDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'atob');

function restoreGlobal(name: 'crypto' | 'atob', descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete (globalThis as unknown as Record<string, unknown>)[name];
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  restoreGlobal('crypto', originalCryptoDescriptor);
  restoreGlobal('atob', originalAtobDescriptor);
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

  it('captures the complete canonical graph and all companions exactly once', async () => {
    const requestCapture = vi.fn().mockResolvedValue(await successfulResponse());
    const normalizeCapture = vi.fn(normalizeChatGptCapture);

    const capture = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture,
      normalizeCapture,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });

    expect(requestCapture).toHaveBeenCalledOnce();
    expect(normalizeCapture).toHaveBeenCalledOnce();
    expect(capture.archive.graph.nodes['node/alternate']?.message?.id).toBe('message/alternate');
    expect(capture.archiveCompanion.artifacts.map(artifact => artifact.kind)).toEqual([
      'raw',
      'manifest',
      'canonical',
    ]);
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

  it('returns exactly three deterministic archive companions and preserves raw base64 verbatim', async () => {
    const response = await successfulResponse();
    const first = await captureChatGptCurrentBranch(CONVERSATION_ID, true, {
      requestCapture: async () => response,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });
    const second = await captureChatGptCurrentBranch(CONVERSATION_ID, true, {
      requestCapture: async () => response,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });

    const companions = first.archiveCompanion;
    expect(companions?.artifacts.map(artifact => [artifact.kind, artifact.relativePath])).toEqual([
      ['raw', 'responses/conversation.json'],
      ['manifest', 'manifest.json'],
      ['canonical', 'canonical/liska-thread-1.json'],
    ]);
    expect(companions?.artifacts).toHaveLength(3);
    expect(companions?.artifacts[0]?.bodyBase64).toBe(
      response.success ? response.data.bodyBase64 : undefined
    );
    expect(companions?.artifacts).toEqual(second.archiveCompanion?.artifacts);
    for (const artifact of companions?.artifacts ?? []) {
      const bytes = new Uint8Array(
        atob(artifact.bodyBase64)
          .split('')
          .map(character => character.charCodeAt(0))
      );
      expect(bytes.byteLength).toBe(artifact.byteLength);
      expect(await sha256Hex(bytes)).toBe(artifact.sha256);
      expect(artifact.mediaType).toBe('application/json');
    }
  });

  it('projects the same verified branch without tool content when disabled', async () => {
    const projection = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: () => successfulResponse(),
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });

    expect(projection.data.messages[1]?.toolContent).toBeUndefined();
  });

  it('rejects an invalid conversation ID before requesting private data', async () => {
    const requestCapture = vi.fn();

    const error = await captureChatGptCurrentBranch('../not-a-conversation', false, {
      requestCapture,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('invalid-conversation-id');
    expect(requestCapture).not.toHaveBeenCalled();
  });

  it('maps a rejected runtime request to a stable messaging failure', async () => {
    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: () => Promise.reject(new Error('private runtime diagnostic')),
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('runtime-message-failed');
    expect(String((error as Error).message)).not.toContain('private runtime diagnostic');
  });

  it('fails closed when capture time cannot be serialized', async () => {
    const response = await successfulResponse();
    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: async () => response,
      createCaptureId: fixedCaptureId,
      now: () => new Date(Number.NaN),
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('capture-integrity-failed');
  });

  it('uses Web Crypto randomUUID for production capture provenance', async () => {
    const cryptoApi = globalThis.crypto;
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555' as const);
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { subtle: cryptoApi.subtle, randomUUID },
    });

    await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: () => successfulResponse(),
      now: fixedNow,
    });

    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('fails closed when Web Crypto cannot create a unique capture ID', async () => {
    const response = await successfulResponse();
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { subtle: globalThis.crypto.subtle },
    });

    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: async () => response,
      now: fixedNow,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('capture-id-unavailable');
  });

  it('fails closed when manifest hashing is unavailable', async () => {
    const response = await successfulResponse();
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });

    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: async () => response,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('capture-integrity-failed');
  });

  it.each([
    ['missing base64 decoder', undefined],
    [
      'throwing base64 decoder',
      () => {
        throw new Error('decoder failed');
      },
    ],
  ])(
    'rejects a verified response when the %s prevents a local byte check',
    async (_label, atob) => {
      const response = await successfulResponse();
      Object.defineProperty(globalThis, 'atob', { configurable: true, value: atob });

      const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
        requestCapture: async () => response,
        createCaptureId: fixedCaptureId,
        now: fixedNow,
      }).catch(reason => reason);

      expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
      expect((error as ChatGptCurrentBranchError).code).toBe('capture-payload-invalid');
    }
  );

  it('rejects a non-canonical uppercase artifact digest at the local trust boundary', async () => {
    const response = await successfulResponse();
    if (response.success) response.data.sha256 = response.data.sha256.toUpperCase();

    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: async () => response,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('capture-payload-invalid');
  });

  it('fails safely when the verified current branch has no legacy-renderable messages', async () => {
    const response = await successfulResponse(payload => {
      const mapping = payload.mapping as Record<
        string,
        { message?: { author?: { role?: string } } }
      >;
      if (mapping['node/user']?.message?.author) {
        mapping['node/user'].message.author.role = 'system';
      }
      if (mapping['node/current']?.message?.author) {
        mapping['node/current'].message.author.role = 'system';
      }
    });

    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: async () => response,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('projection-failed');
    expect((error as ChatGptCurrentBranchError).archiveCompanion?.artifacts).toHaveLength(3);
  });

  it('preserves raw and manifest when archive normalization fails', async () => {
    const response = await successfulResponse(payload => {
      delete payload.mapping;
    });

    const error = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture: async () => response,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('normalization-failed');
    expect((error as ChatGptCurrentBranchError).detailCode).toBe('missing-graph');
    expect(
      (error as ChatGptCurrentBranchError).archiveCompanion?.artifacts.map(
        artifact => artifact.kind
      )
    ).toEqual(['raw', 'manifest']);
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
      'capture-integrity-failed',
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

  it('retains a safe structured-capture failure code without provider diagnostics', async () => {
    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: async () => createChatGptCaptureFailure('timed-out'),
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('timed-out');
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

  it('rejects capture IDs with Windows-unsafe path punctuation', async () => {
    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: () => successfulResponse(),
      createCaptureId: () => 'capture-chatgpt-2026:08:19',
      now: fixedNow,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('capture-id-invalid');
  });
});
