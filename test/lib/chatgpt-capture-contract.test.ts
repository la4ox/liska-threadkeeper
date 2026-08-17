import { describe, expect, it } from 'vitest';
import {
  CHATGPT_CAPTURE_ENDPOINT,
  createChatGptCaptureFailure,
  isChatGptCaptureResponse,
  isChatGptConversationId,
} from '../../src/lib/chatgpt-capture-contract';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';

function captureResponse() {
  return {
    success: true as const,
    data: {
      bodyBase64: 'AP8BgCo=',
      byteLength: 5,
      sha256: 'd423c7d662b356d3bcfb768944ff3b5f3f89b7086bb16e6a5afba362da09acb3',
      mediaType: 'application/json; charset=utf-8',
      endpoint: { ...CHATGPT_CAPTURE_ENDPOINT },
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
