import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  commandChatGptInterpreterResolver,
  readChatGptInterpreterResolverState,
  resolveChatGptInterpreterAssets,
} from '../../src/background/chatgpt-interpreter-resolver';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const NONCE = 'f8c1f0a5-b3dd-4d2a-9a11-8e915f6c3e72';
const DOCUMENT_ID = 'a1b2c3d4e5f6';
const CANDIDATES = [
  {
    assetId: `chatgpt-asset-${'a'.repeat(64)}`,
    messageId: 'msg_one',
    sandboxPath: '/mnt/data/one.txt',
  },
  {
    assetId: `chatgpt-asset-${'b'.repeat(64)}`,
    messageId: 'msg_two',
    sandboxPath: '/mnt/data/two.txt',
  },
];
const MARKER = `#liska-capture=${NONCE}&liska-interpreter-resolver=1`;

function digest(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
}

function chromeApi(result: unknown) {
  const executeScript = vi
    .fn()
    .mockResolvedValueOnce([{ result: { kind: 'ready' }, documentId: DOCUMENT_ID }])
    .mockResolvedValueOnce([{ result: { accepted: true }, documentId: DOCUMENT_ID }])
    .mockResolvedValueOnce([{ result, documentId: DOCUMENT_ID }]);
  const remove = vi.fn().mockResolvedValue(undefined);
  return {
    executeScript,
    remove,
    api: {
      tabs: {
        create: vi.fn().mockResolvedValue({ id: 123 }),
        get: vi.fn().mockResolvedValue({
          status: 'complete',
          url: `https://chatgpt.com/c/${CONVERSATION_ID}${MARKER}`,
        }),
        remove,
      },
      scripting: { executeScript },
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('ChatGPT interpreter resolver background transport', () => {
  it('pins the separate marker/document and correlates ordinal captures to deterministic input assets', async () => {
    const url =
      `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
      '&id=private&p=p&sig=s&ts=1&v=1';
    const body = new TextEncoder().encode(JSON.stringify({ status: 'Success', download_url: url }));
    const result = {
      kind: 'complete',
      conversationId: CONVERSATION_ID,
      requestedCount: 2,
      dispatchCount: 2,
      outcomes: [
        {
          state: 'observed',
          capture: {
            bodyBase64: btoa(String.fromCharCode(...body)),
            byteLength: body.byteLength,
            sha256: await digest(body),
            mediaType: 'application/json',
          },
        },
        { state: 'http-error' },
      ],
    };
    const chrome = chromeApi(result);

    await expect(
      resolveChatGptInterpreterAssets(CONVERSATION_ID, CANDIDATES, {
        chromeApi: chrome.api,
        createNonce: () => NONCE,
        digestSha256: digest,
      })
    ).resolves.toEqual({
      success: true,
      data: { resolved: [{ assetId: CANDIDATES[0].assetId, downloadUrl: url }] },
    });
    expect(chrome.api.tabs.create).toHaveBeenCalledWith({
      url: `https://chatgpt.com/c/${CONVERSATION_ID}${MARKER}`,
      active: true,
    });
    expect(chrome.executeScript.mock.calls[0][0].target).toEqual({ tabId: 123 });
    expect(chrome.executeScript.mock.calls[1][0].target).toEqual({
      tabId: 123,
      documentIds: [DOCUMENT_ID],
    });
    expect(chrome.executeScript.mock.calls[1][0].args).toEqual([NONCE, CANDIDATES]);
    expect(JSON.stringify(chrome.executeScript.mock.calls[2][0].args)).not.toContain('msg_one');
    expect(chrome.remove).toHaveBeenCalledWith(123);
  });

  it('omits malformed/helper-invalid items while retaining completed partial success', async () => {
    const invalid = new TextEncoder().encode(
      JSON.stringify({
        status: 'error',
        download_url:
          `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
          '&id=private&p=p&sig=s&ts=1&v=1',
        extra: 'ignored-provider-metadata',
      })
    );
    const chrome = chromeApi({
      kind: 'complete',
      conversationId: CONVERSATION_ID,
      requestedCount: 2,
      dispatchCount: 2,
      outcomes: [
        {
          state: 'observed',
          capture: {
            bodyBase64: btoa(String.fromCharCode(...invalid)),
            byteLength: invalid.byteLength,
            sha256: await digest(invalid),
            mediaType: 'application/json',
          },
        },
        { state: 'fetch-rejected' },
      ],
    });
    await expect(
      resolveChatGptInterpreterAssets(CONVERSATION_ID, CANDIDATES, {
        chromeApi: chrome.api,
        createNonce: () => NONCE,
        digestSha256: digest,
      })
    ).resolves.toEqual({ success: true, data: { resolved: [] } });
  });

  it('rejects a document change between the pinned command and completion read', async () => {
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([{ result: { kind: 'ready' }, documentId: DOCUMENT_ID }])
      .mockResolvedValueOnce([{ result: { accepted: true }, documentId: DOCUMENT_ID }])
      .mockResolvedValueOnce([
        {
          result: {
            kind: 'complete',
            conversationId: CONVERSATION_ID,
            requestedCount: 2,
            dispatchCount: 2,
            outcomes: [{ state: 'http-error' }, { state: 'http-error' }],
          },
          documentId: 'different-document-id',
        },
      ]);
    const remove = vi.fn().mockResolvedValue(undefined);
    const chromeApi = {
      tabs: {
        create: vi.fn().mockResolvedValue({ id: 123 }),
        get: vi.fn().mockResolvedValue({
          status: 'complete',
          url: `https://chatgpt.com/c/${CONVERSATION_ID}${MARKER}`,
        }),
        remove,
      },
      scripting: { executeScript },
    };

    await expect(
      resolveChatGptInterpreterAssets(CONVERSATION_ID, CANDIDATES, {
        chromeApi,
        createNonce: () => NONCE,
      })
    ).resolves.toEqual({ success: false, code: 'interpreter-result-invalid' });
    expect(remove).toHaveBeenCalledWith(123);
  });

  it('rejects bad lifecycle/candidates before any second request and reads only ordinal state', async () => {
    const create = vi.fn();
    const api = {
      tabs: { create, get: vi.fn(), remove: vi.fn() },
      scripting: { executeScript: vi.fn() },
    };
    await expect(
      resolveChatGptInterpreterAssets('not-a-conversation', CANDIDATES, { chromeApi: api })
    ).resolves.toEqual({ success: false, code: 'invalid-conversation-id' });
    await expect(
      resolveChatGptInterpreterAssets(
        CONVERSATION_ID,
        [{ ...CANDIDATES[0], sandboxPath: '/tmp/x' }],
        {
          chromeApi: api,
        }
      )
    ).resolves.toEqual({ success: false, code: 'invalid-interpreter-candidates' });
    expect(create).not.toHaveBeenCalled();

    vi.stubGlobal('window', {
      [`__liskaChatGptInterpreterResolver_${NONCE}`]: {
        kind: 'complete',
        conversationId: CONVERSATION_ID,
        requestedCount: 1,
        dispatchCount: 1,
        outcomes: [{ state: 'http-error' }],
        candidates: CANDIDATES,
      },
      [`__liskaChatGptInterpreterResolverCommand_${NONCE}`]: (value: unknown) =>
        Array.isArray(value) && value.length === 1,
    });
    expect(readChatGptInterpreterResolverState(NONCE)).toEqual({ kind: 'missing' });
    expect(commandChatGptInterpreterResolver(NONCE, [CANDIDATES[0]])).toEqual({ accepted: true });
    expect(readChatGptInterpreterResolverState.toString()).not.toContain(
      'isChatGptInterpreterResolverHookResult'
    );
  });
});
