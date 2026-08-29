import { describe, expect, it } from 'vitest';
import {
  validateChatGptCaptureSender,
  validateChatGptStandardConversationSender,
  validateMessageContent,
} from '../../src/background/validation';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const OTHER_CONVERSATION_ID = '11111111-2222-3333-4444-555555555555';

function contentSender(tabUrl: string, senderUrl?: string): chrome.runtime.MessageSender {
  return {
    tab: { url: tabUrl },
    ...(senderUrl === undefined ? {} : { url: senderUrl }),
  } as chrome.runtime.MessageSender;
}

describe('ChatGPT capture message validation', () => {
  it('accepts only a strict UUID payload', () => {
    expect(
      validateMessageContent({
        action: 'captureChatGptConversation',
        conversationId: CONVERSATION_ID,
        observeAssetResolvers: false,
      })
    ).toBe(true);
    expect(
      validateMessageContent({
        action: 'captureChatGptConversation',
        conversationId: '../not-a-conversation-id',
        observeAssetResolvers: false,
      })
    ).toBe(false);
    expect(
      validateMessageContent({
        action: 'captureChatGptConversation',
        conversationId: CONVERSATION_ID,
      })
    ).toBe(true);
    expect(
      validateMessageContent({
        action: 'captureChatGptConversation',
        conversationId: CONVERSATION_ID,
        observeAssetResolvers: 'yes',
      })
    ).toBe(false);
  });

  it('accepts only the exact opaque-probe message shape', () => {
    expect(
      validateMessageContent({
        action: 'probeChatGptOpaqueRequest',
        conversationId: CONVERSATION_ID,
      })
    ).toBe(true);
    expect(
      validateMessageContent({
        action: 'probeChatGptOpaqueRequest',
        conversationId: CONVERSATION_ID,
        authorization: 'synthetic-secret',
      })
    ).toBe(false);
    expect(
      validateMessageContent({
        action: 'probeChatGptOpaqueRequest',
        conversationId: 'not-a-conversation-id',
      })
    ).toBe(false);
  });

  it('accepts only the exact opaque-replay message shape', () => {
    expect(
      validateMessageContent({
        action: 'captureChatGptConversationViaOpaqueReplay',
        conversationId: CONVERSATION_ID,
      })
    ).toBe(true);
    expect(
      validateMessageContent({
        action: 'captureChatGptConversationViaOpaqueReplay',
        conversationId: 'not-a-conversation-id',
      })
    ).toBe(false);
    expect(
      validateMessageContent({
        action: 'captureChatGptConversationViaOpaqueReplay',
        conversationId: CONVERSATION_ID,
        headers: 'must-not-cross-the-boundary',
      })
    ).toBe(false);
  });

  it('accepts only the exact post-persistence opaque resolver message shape', () => {
    expect(
      validateMessageContent({
        action: 'observeChatGptAssetResolversViaOpaqueSource',
        conversationId: CONVERSATION_ID,
      })
    ).toBe(true);
    expect(
      validateMessageContent({
        action: 'observeChatGptAssetResolversViaOpaqueSource',
        conversationId: CONVERSATION_ID,
        rawBodyBase64: 'must-not-cross',
      })
    ).toBe(false);
    expect(
      validateMessageContent({
        action: 'observeChatGptAssetResolversViaOpaqueSource',
        conversationId: 'not-a-conversation-id',
      })
    ).toBe(false);
  });

  it('accepts exactly one active resolver diagnostic ID and rejects plural message requests', () => {
    const message = {
      action: 'probeChatGptActiveAssetResolvers',
      conversationId: CONVERSATION_ID,
      providerFileIds: ['file_one'],
    };
    expect(validateMessageContent(message)).toBe(true);
    expect(validateMessageContent({ ...message, providerFileIds: ['file_one', 'file-two'] })).toBe(
      false
    );
    expect(validateMessageContent({ ...message, providerFileIds: ['file_one', 'file_one'] })).toBe(
      false
    );
    expect(validateMessageContent({ ...message, conversationId: 'not-a-conversation' })).toBe(
      false
    );
    expect(validateMessageContent({ ...message, providerFileIds: 'file_one' })).toBe(false);
    expect(validateMessageContent({ ...message, providerFileIds: ['file.with-dot'] })).toBe(false);
    expect(validateMessageContent({ ...message, secret: 'must-not-cross' })).toBe(false);
    const withSymbol = { ...message, [Symbol('private')]: true };
    expect(validateMessageContent(withSymbol)).toBe(false);
  });

  it('accepts the strict bounded interpreter candidate plan only', () => {
    const message = {
      action: 'resolveChatGptInterpreterAssets',
      conversationId: CONVERSATION_ID,
      candidates: [
        {
          assetId: `chatgpt-asset-${'a'.repeat(64)}`,
          messageId: 'msg_one',
          sandboxPath: '/mnt/data/100% & = файл.txt',
        },
      ],
    };
    expect(validateMessageContent(message)).toBe(true);
    expect(
      validateMessageContent({
        ...message,
        candidates: [{ ...message.candidates[0], sandboxPath: '/mnt/data/../secret.txt' }],
      })
    ).toBe(false);
    expect(
      validateMessageContent({
        ...message,
        candidates: [{ ...message.candidates[0], secret: 'no' }],
      })
    ).toBe(false);
    expect(validateMessageContent({ ...message, candidates: [] })).toBe(false);
    expect(validateMessageContent({ ...message, headers: 'must-not-cross' })).toBe(false);
  });

  it.each(['apiKey', 'headers', 'accountId'])('rejects the extra own key %s', extraKey => {
    expect(
      validateMessageContent({
        action: 'captureChatGptConversation',
        conversationId: CONVERSATION_ID,
        observeAssetResolvers: false,
        [extraKey]: 'must-not-cross-the-boundary',
      })
    ).toBe(false);
  });

  it('rejects non-enumerable and symbol extras on ChatGPT bridge messages', () => {
    const nonEnumerableExtra = {
      action: 'captureChatGptConversationViaOpaqueReplay',
      conversationId: CONVERSATION_ID,
    };
    Object.defineProperty(nonEnumerableExtra, 'secret', {
      configurable: true,
      enumerable: false,
      value: 'must-not-cross-the-boundary',
    });
    expect(validateMessageContent(nonEnumerableExtra)).toBe(false);
    expect(
      validateMessageContent({
        action: 'captureChatGptConversationViaOpaqueReplay',
        conversationId: CONVERSATION_ID,
        [Symbol('secret')]: true,
      })
    ).toBe(false);
  });

  it('accepts the matching standard and custom GPT conversation routes', () => {
    expect(
      validateChatGptCaptureSender(
        contentSender(
          `https://chatgpt.com/c/${CONVERSATION_ID}`,
          `https://chatgpt.com/c/${CONVERSATION_ID}`
        ),
        CONVERSATION_ID
      )
    ).toBe(true);
    expect(
      validateChatGptCaptureSender(
        contentSender(`https://chatgpt.com/g/my-custom-gpt/c/${CONVERSATION_ID}/`),
        CONVERSATION_ID
      )
    ).toBe(true);
  });

  it('keeps interpreter resolution on standard conversation routes only', () => {
    expect(
      validateChatGptStandardConversationSender(
        contentSender(`https://chatgpt.com/c/${CONVERSATION_ID}`),
        CONVERSATION_ID
      )
    ).toBe(true);
    expect(
      validateChatGptStandardConversationSender(
        contentSender(`https://chatgpt.com/g/my-custom-gpt/c/${CONVERSATION_ID}`),
        CONVERSATION_ID
      )
    ).toBe(false);
  });

  it('rejects a route with a different conversation ID', () => {
    expect(
      validateChatGptCaptureSender(
        contentSender(`https://chatgpt.com/c/${OTHER_CONVERSATION_ID}`),
        CONVERSATION_ID
      )
    ).toBe(false);
  });

  it('accepts a stale same-origin sender URL after ChatGPT SPA navigation', () => {
    expect(
      validateChatGptCaptureSender(
        contentSender(
          `https://chatgpt.com/g/my-custom-gpt/c/${CONVERSATION_ID}`,
          `https://chatgpt.com/c/${OTHER_CONVERSATION_ID}`
        ),
        CONVERSATION_ID
      )
    ).toBe(true);
    expect(
      validateChatGptCaptureSender(
        contentSender(
          `https://chatgpt.com/c/${CONVERSATION_ID}`,
          'https://chatgpt.com/?model=legacy#old-document-route'
        ),
        CONVERSATION_ID
      )
    ).toBe(true);
  });

  it('rejects query/hash route variants and extension popup senders', () => {
    expect(
      validateChatGptCaptureSender(
        contentSender(`https://chatgpt.com/c/${CONVERSATION_ID}?share=1`),
        CONVERSATION_ID
      )
    ).toBe(false);
    expect(
      validateChatGptCaptureSender(
        contentSender(`https://chatgpt.com/c/${CONVERSATION_ID}#latest`),
        CONVERSATION_ID
      )
    ).toBe(false);
    expect(
      validateChatGptCaptureSender(
        {
          url: `chrome-extension://${chrome.runtime.id}/popup.html`,
        } as chrome.runtime.MessageSender,
        CONVERSATION_ID
      )
    ).toBe(false);
  });

  it('rejects other origins and unbounded custom GPT slugs', () => {
    expect(
      validateChatGptCaptureSender(
        contentSender(`https://evil.example/c/${CONVERSATION_ID}`),
        CONVERSATION_ID
      )
    ).toBe(false);
    expect(
      validateChatGptCaptureSender(
        contentSender(`https://chatgpt.com/g/${'a'.repeat(129)}/c/${CONVERSATION_ID}`),
        CONVERSATION_ID
      )
    ).toBe(false);
    expect(
      validateChatGptCaptureSender(
        contentSender(
          `https://chatgpt.com/c/${CONVERSATION_ID}`,
          `https://evil.example/c/${CONVERSATION_ID}`
        ),
        CONVERSATION_ID
      )
    ).toBe(false);
    expect(
      validateChatGptCaptureSender(
        contentSender(
          `https://chatgpt.com/c/${CONVERSATION_ID}`,
          `https://attacker@chatgpt.com/c/${OTHER_CONVERSATION_ID}`
        ),
        CONVERSATION_ID
      )
    ).toBe(false);
  });
});
