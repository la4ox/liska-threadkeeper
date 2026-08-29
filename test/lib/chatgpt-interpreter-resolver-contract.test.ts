import { describe, expect, it } from 'vitest';
import {
  CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT,
  createChatGptInterpreterResolverFailure,
  isChatGptInterpreterAssetCandidate,
  isChatGptInterpreterCandidates,
  isChatGptInterpreterResolverHookResult,
  isChatGptInterpreterResolverResponse,
  isChatGptInterpreterSandboxPath,
} from '../../src/lib/chatgpt-interpreter-resolver-contract';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const ASSET_ID = `chatgpt-asset-${'a'.repeat(64)}`;

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    assetId: ASSET_ID,
    messageId: 'msg_ABC-123',
    sandboxPath: '/mnt/data/100% & = файл.txt',
    ...overrides,
  };
}

describe('ChatGPT interpreter resolver contract', () => {
  it('accepts only strict bounded candidates with unique asset and message/path identities', () => {
    expect(isChatGptInterpreterCandidates([candidate()])).toBe(true);
    expect(isChatGptInterpreterSandboxPath('/mnt/data/100% & = файл.txt')).toBe(true);
    expect(isChatGptInterpreterSandboxPath('/mnt/data/query?#name.txt')).toBe(true);
    for (const malformed of [
      candidate({ assetId: 'provider-private-id' }),
      candidate({ messageId: 'message/with/slash' }),
      candidate({ sandboxPath: '/mnt/data/../secret.txt' }),
      candidate({ sandboxPath: '/mnt/data/control\u0085.txt' }),
      candidate({ sandboxPath: '/mnt/data/unpaired\ud800.txt' }),
      { ...candidate(), extra: 'must-not-cross' },
    ]) {
      expect(isChatGptInterpreterCandidates([malformed])).toBe(false);
    }
    expect(isChatGptInterpreterCandidates([])).toBe(false);
    expect(
      isChatGptInterpreterCandidates([
        candidate(),
        candidate({ assetId: `chatgpt-asset-${'b'.repeat(64)}` }),
      ])
    ).toBe(false);
    expect(
      isChatGptInterpreterCandidates(
        Array.from({ length: CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT + 1 }, (_, index) =>
          candidate({ assetId: `chatgpt-asset-${index.toString(16).padStart(64, '0')}` })
        )
      )
    ).toBe(false);
  });

  it('allows MAIN state to carry only ordinal captures/outcomes, not candidates', () => {
    const hook = {
      kind: 'complete' as const,
      conversationId: CONVERSATION_ID,
      requestedCount: 2,
      dispatchCount: 1,
      outcomes: [
        {
          state: 'observed' as const,
          capture: {
            bodyBase64: 'e30=',
            byteLength: 2,
            sha256: '0'.repeat(64),
            mediaType: 'application/json',
          },
        },
        { state: 'not-dispatched' as const },
      ],
    };
    expect(isChatGptInterpreterResolverHookResult(hook)).toBe(true);
    expect(isChatGptInterpreterResolverHookResult({ ...hook, candidates: [candidate()] })).toBe(
      false
    );
    expect(
      isChatGptInterpreterResolverHookResult({
        ...hook,
        outcomes: [
          { state: 'not-dispatched' },
          { state: 'observed', capture: hook.outcomes[0].capture },
        ],
      })
    ).toBe(false);
  });

  it('accepts the exact resolved response envelope and rejects extra or malformed signed URLs', () => {
    const downloadUrl =
      `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
      '&id=private&p=p&sig=s&ts=1&v=1';
    const response = {
      success: true as const,
      data: { resolved: [{ assetId: ASSET_ID, downloadUrl }] },
    };
    expect(isChatGptInterpreterResolverResponse(response)).toBe(true);
    expect(isChatGptInterpreterResolverResponse({ ...response, detail: 'private' })).toBe(false);
    expect(
      isChatGptInterpreterResolverResponse({
        success: true,
        data: { resolved: [{ assetId: ASSET_ID, downloadUrl: 'https://example.test/private' }] },
      })
    ).toBe(false);
    expect(createChatGptInterpreterResolverFailure('source-http-error')).toEqual({
      success: false,
      code: 'source-http-error',
    });
    expect(
      isChatGptInterpreterResolverResponse({ success: false, code: 'source-http-error' })
    ).toBe(true);
    expect(
      isChatGptInterpreterResolverResponse({
        success: true,
        data: {
          resolved: [
            { assetId: ASSET_ID, downloadUrl },
            { assetId: ASSET_ID, downloadUrl },
          ],
        },
      })
    ).toBe(false);
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('synthetic ownKeys failure');
        },
      }
    );
    expect(isChatGptInterpreterAssetCandidate(hostile)).toBe(false);
    expect(isChatGptInterpreterResolverResponse(hostile)).toBe(false);
  });
});
