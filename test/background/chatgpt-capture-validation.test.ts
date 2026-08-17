import { describe, expect, it } from 'vitest';
import {
  validateChatGptCaptureSender,
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
      })
    ).toBe(true);
    expect(
      validateMessageContent({
        action: 'captureChatGptConversation',
        conversationId: '../not-a-conversation-id',
      })
    ).toBe(false);
  });

  it.each(['apiKey', 'headers', 'accountId'])('rejects the extra own key %s', extraKey => {
    expect(
      validateMessageContent({
        action: 'captureChatGptConversation',
        conversationId: CONVERSATION_ID,
        [extraKey]: 'must-not-cross-the-boundary',
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

  it('rejects a route with a different conversation ID', () => {
    expect(
      validateChatGptCaptureSender(
        contentSender(`https://chatgpt.com/c/${OTHER_CONVERSATION_ID}`),
        CONVERSATION_ID
      )
    ).toBe(false);
  });

  it('rejects a sender URL that does not match the validated tab route', () => {
    expect(
      validateChatGptCaptureSender(
        contentSender(
          `https://chatgpt.com/c/${CONVERSATION_ID}`,
          `https://chatgpt.com/c/${OTHER_CONVERSATION_ID}`
        ),
        CONVERSATION_ID
      )
    ).toBe(false);
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
  });
});
