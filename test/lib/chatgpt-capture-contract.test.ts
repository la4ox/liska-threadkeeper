import { describe, expect, it } from 'vitest';
import {
  CHATGPT_CAPTURE_ENDPOINT,
  createChatGptCaptureFailure,
  isChatGptCaptureResponse,
  isChatGptConversationId,
  isChatGptTransientDownloadUrl,
  isChatGptTransientAssetResolver,
} from '../../src/lib/chatgpt-capture-contract';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const TRANSIENT_RESOLVER = {
  resolverKey: '7404723b52ebe964b6ac76965f76009f8edb166d7b5ebeb8619b05b0d53033ff',
  downloadUrl:
    `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
    '&id=file-abc_123&p=path&sig=signature&ts=123&v=1',
};

function captureResponse() {
  return {
    success: true as const,
    data: {
      bodyBase64: 'AP8BgCo=',
      byteLength: 5,
      sha256: 'd423c7d662b356d3bcfb768944ff3b5f3f89b7086bb16e6a5afba362da09acb3',
      mediaType: 'application/json; charset=utf-8',
      endpoint: { ...CHATGPT_CAPTURE_ENDPOINT },
      transientAssetResolvers: [],
    },
  };
}

describe('ChatGPT capture runtime contract', () => {
  it('accepts only strict UUID conversation IDs', () => {
    expect(isChatGptConversationId(CONVERSATION_ID)).toBe(true);
    expect(isChatGptConversationId(CONVERSATION_ID.toUpperCase())).toBe(true);
    expect(isChatGptConversationId(`${CONVERSATION_ID}/`)).toBe(false);
    expect(isChatGptConversationId('../not-a-conversation-id')).toBe(false);
    expect(isChatGptConversationId(undefined)).toBe(false);
  });

  it('accepts the exact allowlisted success response only', () => {
    const response = captureResponse();

    expect(isChatGptCaptureResponse(response)).toBe(true);
    expect(Object.keys(response)).toEqual(['success', 'data']);
    expect(Object.keys(response.data)).toEqual([
      'bodyBase64',
      'byteLength',
      'sha256',
      'mediaType',
      'endpoint',
      'transientAssetResolvers',
    ]);
  });

  it('rejects extra or malformed capture response fields', () => {
    expect(isChatGptCaptureResponse(null)).toBe(false);
    expect(
      isChatGptCaptureResponse({
        ...captureResponse(),
        requestHeaders: 'must-not-cross-the-boundary',
      })
    ).toBe(false);
    expect(
      isChatGptCaptureResponse({
        success: true,
        data: { ...captureResponse().data, accountId: 'must-not-cross-the-boundary' },
      })
    ).toBe(false);
    expect(
      isChatGptCaptureResponse({
        success: true,
        data: { ...captureResponse().data, endpoint: { method: 'POST', pathPattern: 'wrong' } },
      })
    ).toBe(false);
    expect(
      isChatGptCaptureResponse({
        success: true,
        data: { ...captureResponse().data, bodyBase64: 'not base64!', byteLength: 11 },
      })
    ).toBe(false);
    expect(
      isChatGptCaptureResponse({
        success: true,
        data: { ...captureResponse().data, mediaType: 'application/json\u0000' },
      })
    ).toBe(false);
    expect(
      isChatGptCaptureResponse({
        success: true,
        data: { ...captureResponse().data, mediaType: null },
      })
    ).toBe(false);
    expect(
      isChatGptCaptureResponse({
        success: true,
        data: { ...captureResponse().data, mediaType: 'x'.repeat(256) },
      })
    ).toBe(false);
    expect(isChatGptCaptureResponse({ success: 'unknown' })).toBe(false);
  });

  it('accepts only exact, bounded transient resolver records', () => {
    expect(isChatGptTransientAssetResolver(TRANSIENT_RESOLVER)).toBe(true);
    expect(
      isChatGptTransientDownloadUrl(
        TRANSIENT_RESOLVER.downloadUrl,
        '11111111-2222-3333-4444-555555555555'
      )
    ).toBe(false);
    expect(
      isChatGptCaptureResponse({
        ...captureResponse(),
        data: { ...captureResponse().data, transientAssetResolvers: [TRANSIENT_RESOLVER] },
      })
    ).toBe(true);
    expect(
      isChatGptCaptureResponse({
        ...captureResponse(),
        data: {
          ...captureResponse().data,
          transientAssetResolvers: [TRANSIENT_RESOLVER, TRANSIENT_RESOLVER],
        },
      })
    ).toBe(false);
    expect(
      isChatGptTransientAssetResolver({
        ...TRANSIENT_RESOLVER,
        providerFileId: 'must-not-cross-the-boundary',
      })
    ).toBe(false);
    expect(
      isChatGptTransientAssetResolver({
        ...TRANSIENT_RESOLVER,
        downloadUrl: `${TRANSIENT_RESOLVER.downloadUrl}&cid=${CONVERSATION_ID}`,
      })
    ).toBe(false);
    expect(isChatGptTransientAssetResolver(null)).toBe(false);
    expect(
      isChatGptTransientAssetResolver({
        ...TRANSIENT_RESOLVER,
        downloadUrl: '',
      })
    ).toBe(false);
    expect(
      isChatGptTransientAssetResolver({
        ...TRANSIENT_RESOLVER,
        downloadUrl: 'https://evil.example/backend-api/estuary/content?cid=x',
      })
    ).toBe(false);
    expect(
      isChatGptTransientAssetResolver({
        ...TRANSIENT_RESOLVER,
        downloadUrl: 'not a valid absolute URL',
      })
    ).toBe(false);
    expect(
      isChatGptTransientAssetResolver({
        ...TRANSIENT_RESOLVER,
        downloadUrl: TRANSIENT_RESOLVER.downloadUrl.replace('&sig=signature', '&unknown=value'),
      })
    ).toBe(false);
    expect(
      isChatGptTransientAssetResolver({
        ...TRANSIENT_RESOLVER,
        downloadUrl: TRANSIENT_RESOLVER.downloadUrl.replace('?cid=', '?%63id='),
      })
    ).toBe(false);
    expect(
      isChatGptTransientAssetResolver({
        ...TRANSIENT_RESOLVER,
        downloadUrl: TRANSIENT_RESOLVER.downloadUrl.replace('/estuary/', '/%65stuary/'),
      })
    ).toBe(false);
    expect(
      isChatGptTransientAssetResolver({
        ...TRANSIENT_RESOLVER,
        downloadUrl: TRANSIENT_RESOLVER.downloadUrl.replace(
          '/estuary/content?',
          '/estuary/x/../content?'
        ),
      })
    ).toBe(false);
    expect(
      isChatGptTransientAssetResolver({
        ...TRANSIENT_RESOLVER,
        downloadUrl: `${TRANSIENT_RESOLVER.downloadUrl}#fragment`,
      })
    ).toBe(false);
    expect(
      isChatGptCaptureResponse({
        ...captureResponse(),
        data: {
          ...captureResponse().data,
          transientAssetResolvers: Array.from({ length: 33 }, (_, index) => ({
            ...TRANSIENT_RESOLVER,
            resolverKey: index.toString(16).padStart(64, '0'),
          })),
        },
      })
    ).toBe(false);
  });

  it('accepts the current signed estuary grammar without treating opaque cid as a conversation UUID', () => {
    const currentUrl =
      'https://chatgpt.com/backend-api/estuary/content?' +
      new URLSearchParams({
        id: 'file_00000000synthetic',
        fn: 'synthetic-guide.docx',
        cd: 'attachment',
        ts: '123456',
        p: 'fs',
        cid: '1',
        sig: 'a'.repeat(64),
        v: '0',
      }).toString();

    expect(isChatGptTransientDownloadUrl(currentUrl)).toBe(true);
    expect(isChatGptTransientDownloadUrl(currentUrl, CONVERSATION_ID)).toBe(true);
    expect(
      isChatGptTransientAssetResolver({ ...TRANSIENT_RESOLVER, downloadUrl: currentUrl })
    ).toBe(true);
    for (const invalid of [
      currentUrl.replace('cd=attachment', 'cd=inline'),
      currentUrl.replace('p=fs', 'p=other'),
      currentUrl.replace('cid=1', 'cid=0'),
      currentUrl.replace(`sig=${'a'.repeat(64)}`, 'sig=short'),
      currentUrl.replace('fn=synthetic-guide.docx', 'fn=folder%2Fsynthetic-guide.docx'),
      `${currentUrl}&extra=value`,
    ]) {
      expect(isChatGptTransientDownloadUrl(invalid)).toBe(false);
    }
  });

  it('serializes failures from the stable error allowlist only', () => {
    const failure = createChatGptCaptureFailure('permission-unavailable');
    const injectionFailure = createChatGptCaptureFailure('hook-injection-rejected');
    const resultFailure = createChatGptCaptureFailure('hook-result-invalid');
    const providerFailure = createChatGptCaptureFailure('response-media-type-invalid');

    expect(failure).toEqual({
      success: false,
      code: 'permission-unavailable',
      error: 'ChatGPT capture is unavailable because the required extension permission is missing.',
    });
    expect(isChatGptCaptureResponse(failure)).toBe(true);
    expect(injectionFailure).toEqual({
      success: false,
      code: 'hook-injection-rejected',
      error: 'The browser rejected the temporary ChatGPT capture script.',
    });
    expect(isChatGptCaptureResponse(injectionFailure)).toBe(true);
    expect(resultFailure).toEqual({
      success: false,
      code: 'hook-result-invalid',
      error: 'The temporary ChatGPT capture script returned an invalid result.',
    });
    expect(isChatGptCaptureResponse(resultFailure)).toBe(true);
    expect(providerFailure).toEqual({
      success: false,
      code: 'response-media-type-invalid',
      error: 'The temporary ChatGPT conversation response was not JSON.',
    });
    expect(isChatGptCaptureResponse(providerFailure)).toBe(true);
    expect(
      isChatGptCaptureResponse({
        ...failure,
        error: 'sensitive browser exception detail',
      })
    ).toBe(false);
  });
});
