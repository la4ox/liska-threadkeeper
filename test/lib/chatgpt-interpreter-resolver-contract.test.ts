import { describe, expect, it } from 'vitest';
import {
  CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT,
  CHATGPT_INTERPRETER_RESOLVER_DIAGNOSTIC_CODES,
  createChatGptInterpreterResolverFailure,
  isChatGptInterpreterAssetCandidate,
  isChatGptInterpreterCandidates,
  isChatGptInterpreterResolverDiagnostic,
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

  it('allows a legacy unknown HTTP outcome but rejects malformed status placement', () => {
    const complete = (outcome: unknown) => ({
      kind: 'complete',
      conversationId: CONVERSATION_ID,
      requestedCount: 1,
      dispatchCount: 1,
      outcomes: [outcome],
    });
    expect(isChatGptInterpreterResolverHookResult(complete({ state: 'http-error' }))).toBe(true);
    expect(
      isChatGptInterpreterResolverHookResult(complete({ state: 'http-error', httpStatus: 404 }))
    ).toBe(true);
    for (const malformed of [
      { state: 'http-error', httpStatus: 200 },
      { state: 'http-error', httpStatus: 404.5 },
      { state: 'http-error', httpStatus: 700 },
      { state: 'fetch-rejected', httpStatus: 503 },
      { state: 'http-error', httpStatus: 404, extra: true },
    ]) {
      expect(isChatGptInterpreterResolverHookResult(complete(malformed))).toBe(false);
    }
  });

  it('accepts exact, reconciled diagnostics and rejects malformed response envelopes', () => {
    const downloadUrl =
      `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
      '&id=private&p=p&sig=s&ts=1&v=1';
    const response = {
      success: true as const,
      data: {
        resolved: [{ assetId: ASSET_ID, downloadUrl }],
        diagnostics: [{ assetId: ASSET_ID, code: 'resolved' }],
      },
    };
    expect(isChatGptInterpreterResolverResponse(response)).toBe(true);
    expect(isChatGptInterpreterResolverResponse({ ...response, detail: 'private' })).toBe(false);
    expect(
      isChatGptInterpreterResolverResponse({
        success: true,
        data: {
          resolved: [{ assetId: ASSET_ID, downloadUrl: 'https://example.test/private' }],
          diagnostics: [{ assetId: ASSET_ID, code: 'resolved' }],
        },
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
          diagnostics: [{ assetId: ASSET_ID, code: 'resolved' }],
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

  it('keeps diagnostic codes and optional HTTP statuses exact and content-safe', () => {
    const httpStatus = { assetId: ASSET_ID, code: 'http-error', httpStatus: 404 };
    expect(isChatGptInterpreterResolverDiagnostic(httpStatus)).toBe(true);
    expect(isChatGptInterpreterResolverDiagnostic({ assetId: ASSET_ID, code: 'http-error' })).toBe(
      true
    );
    expect(CHATGPT_INTERPRETER_RESOLVER_DIAGNOSTIC_CODES).toContain('payload-invalid-json');
    for (const malformed of [
      { assetId: ASSET_ID, code: 'http-error', httpStatus: 200 },
      { assetId: ASSET_ID, code: 'http-error', httpStatus: 99 },
      { assetId: ASSET_ID, code: 'http-error', httpStatus: 600 },
      { assetId: ASSET_ID, code: 'http-error', httpStatus: 404.5 },
      { assetId: ASSET_ID, code: 'http-error', httpStatus: Number.NaN },
      { assetId: ASSET_ID, code: 'fetch-rejected', httpStatus: 503 },
      { assetId: ASSET_ID, code: 'provider-private-detail' },
      { assetId: ASSET_ID, code: 'resolved', extra: 'forbidden' },
    ]) {
      expect(isChatGptInterpreterResolverDiagnostic(malformed)).toBe(false);
    }
  });

  it('rejects contradictory, cross-ID, non-enumerable, and symbolic diagnostics', () => {
    const downloadUrl =
      `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
      '&id=private&p=p&sig=s&ts=1&v=1';
    const secondAssetId = `chatgpt-asset-${'b'.repeat(64)}`;
    const valid = {
      success: true,
      data: {
        resolved: [{ assetId: ASSET_ID, downloadUrl }],
        diagnostics: [{ assetId: ASSET_ID, code: 'resolved' }],
      },
    };
    expect(
      isChatGptInterpreterResolverResponse({
        ...valid,
        data: { ...valid.data, diagnostics: [{ assetId: ASSET_ID, code: 'http-error' }] },
      })
    ).toBe(false);
    expect(
      isChatGptInterpreterResolverResponse({
        ...valid,
        data: {
          ...valid.data,
          diagnostics: [{ assetId: secondAssetId, code: 'resolved' }],
        },
      })
    ).toBe(false);
    expect(
      isChatGptInterpreterResolverResponse({
        success: true,
        data: {
          resolved: [
            { assetId: ASSET_ID, downloadUrl },
            { assetId: secondAssetId, downloadUrl },
          ],
          diagnostics: [
            { assetId: secondAssetId, code: 'resolved' },
            { assetId: ASSET_ID, code: 'resolved' },
          ],
        },
      })
    ).toBe(false);
    const nonEnumerable = structuredClone(valid);
    Object.defineProperty(nonEnumerable.data, 'diagnostics', {
      enumerable: false,
      value: nonEnumerable.data.diagnostics,
    });
    expect(isChatGptInterpreterResolverResponse(nonEnumerable)).toBe(false);
    const symbolic = {
      ...valid,
      data: { ...valid.data, diagnostics: [{ assetId: ASSET_ID, code: 'resolved' }] },
    };
    Object.defineProperty(symbolic.data.diagnostics[0], Symbol('extra'), {
      enumerable: true,
      value: true,
    });
    expect(isChatGptInterpreterResolverResponse(symbolic)).toBe(false);
  });
});
