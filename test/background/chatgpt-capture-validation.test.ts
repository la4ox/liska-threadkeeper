import { describe, expect, it } from 'vitest';
import {
  validateChatGptCaptureSender,
  validateChatGptStandardConversationSender,
  validateMessageContent,
} from '../../src/background/validation';
import {
  deriveChatGptCaptureTarget,
  isChatGptCaptureTarget,
  parseChatGptCaptureTarget,
} from '../../src/background/chatgpt-route-target';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const OTHER_CONVERSATION_ID = '11111111-2222-3333-4444-555555555555';

function contentSender(tabUrl: string, senderUrl?: string): chrome.runtime.MessageSender {
  return {
    tab: { url: tabUrl },
    ...(senderUrl === undefined ? {} : { url: senderUrl }),
  } as chrome.runtime.MessageSender;
}

describe('ChatGPT capture message validation', () => {
  it.each([
    ['/c/', 'standard'],
    ['/g/my-custom-gpt/c/', 'custom-gpt'],
    ['/g/g-p-private-project/c/', 'project'],
  ] as const)('preserves exact %s routes including trailing slashes', (prefix, routeFamily) => {
    for (const trailing of ['', '/']) {
      const pathname = `${prefix}${CONVERSATION_ID}${trailing}`;
      const target = deriveChatGptCaptureTarget(
        contentSender(
          `https://chatgpt.com${pathname}`,
          `https://chatgpt.com/c/${OTHER_CONVERSATION_ID}`
        ),
        CONVERSATION_ID
      );
      expect(target).toEqual({ conversationId: CONVERSATION_ID, pathname, routeFamily });
      expect(Object.isFrozen(target)).toBe(true);
    }
  });

  it('rejects URL normalization, malformed owners, and mismatched UUIDs', () => {
    const paths = [
      `/c/${OTHER_CONVERSATION_ID}`,
      `/c/${CONVERSATION_ID}?`,
      `/c/${CONVERSATION_ID}#`,
      `/g/Owner/c/${CONVERSATION_ID}`,
      `/g/%6fwner/c/${CONVERSATION_ID}`,
      `/g/g-p-/c/${CONVERSATION_ID}`,
      `/g/-owner/c/${CONVERSATION_ID}`,
      `/g/owner-/c/${CONVERSATION_ID}`,
      `/g/${'a'.repeat(129)}/c/${CONVERSATION_ID}`,
      `/g/owner/../owner/c/${CONVERSATION_ID}`,
      `/g/owner/c/%30${CONVERSATION_ID.slice(1)}`,
      `/c/${CONVERSATION_ID}/\n`,
    ];
    const urls = [
      ...paths.map(path => `https://chatgpt.com${path}`),
      `https://chatgpt.com:443/c/${CONVERSATION_ID}`,
      `https://user@chatgpt.com/c/${CONVERSATION_ID}`,
      `https://CHATGPT.com/c/${CONVERSATION_ID}`,
      ` https://chatgpt.com/c/${CONVERSATION_ID}`,
      `https://chatgpt.com/g/owner/c/${CONVERSATION_ID}?query=value`,
      `https://chatgpt.com/g/owner/c/${CONVERSATION_ID}#fragment`,
    ];
    for (const url of urls) expect(parseChatGptCaptureTarget(url, CONVERSATION_ID)).toBeUndefined();
    expect(
      deriveChatGptCaptureTarget(
        contentSender(`https://chatgpt.com/c/${CONVERSATION_ID}`, 'https://example.com/'),
        CONVERSATION_ID
      )
    ).toBeUndefined();
    expect(
      parseChatGptCaptureTarget(
        `https://chatgpt.com/g/${'a'.repeat(128)}/c/${CONVERSATION_ID}`,
        CONVERSATION_ID
      )?.routeFamily
    ).toBe('custom-gpt');
  });

  it('accepts only exact own-data capture targets without invoking accessors', () => {
    const target = {
      conversationId: CONVERSATION_ID,
      pathname: `/c/${CONVERSATION_ID}`,
      routeFamily: 'standard',
    } as const;
    expect(isChatGptCaptureTarget(target)).toBe(true);
    expect(isChatGptCaptureTarget(Object.assign(Object.create(null), target))).toBe(true);
    expect(isChatGptCaptureTarget({ ...target, extra: true })).toBe(false);
    expect(isChatGptCaptureTarget(Object.create(target))).toBe(false);
    expect(isChatGptCaptureTarget({ ...target, [Symbol('extra')]: true })).toBe(false);
    expect(isChatGptCaptureTarget({ ...target, routeFamily: 'project' })).toBe(false);

    const accessor = { ...target } as Record<string, unknown>;
    Object.defineProperty(accessor, 'pathname', {
      enumerable: true,
      get() {
        throw new Error('must not be invoked');
      },
    });
    expect(() => isChatGptCaptureTarget(accessor)).not.toThrow();
    expect(isChatGptCaptureTarget(accessor)).toBe(false);
  });

  it('validates only the separate one-item active asset action with exact keys', () => {
    const message = {
      action: 'resolveChatGptActiveAsset',
      conversationId: CONVERSATION_ID,
      item: { assetId: `chatgpt-asset-${'a'.repeat(64)}`, providerFileId: 'file_a' },
    };
    expect(validateMessageContent(message)).toBe(true);
    for (const malformed of [
      { ...message, providerFileId: 'extra' },
      { ...message, conversationId: 'bad' },
      { ...message, item: [message.item] },
      { ...message, item: { ...message.item, secret: 'extra' } },
      { ...message, item: { ...message.item, assetId: 'file_a' } },
      { ...message, item: { ...message.item, providerFileId: 'file.a' } },
    ])
      expect(validateMessageContent(malformed)).toBe(false);
  });
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
