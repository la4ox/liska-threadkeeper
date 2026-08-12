import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeepSeekExtractor } from '../../src/content/extractors/deepseek';
import { clearFixture, loadFixture, resetLocation } from '../fixtures/dom-helpers';
import type { SyncSettings } from '../../src/lib/types';

interface DeepSeekMessage {
  role: 'user' | 'assistant';
  content: string;
  id?: string;
  thought?: string;
}

function setDeepSeekLocation(id: string, route: 'chat' | 'share' = 'chat'): void {
  const pathname = route === 'chat' ? `/a/chat/s/${id}` : `/share/${id}`;
  Object.defineProperty(window, 'location', {
    value: {
      hostname: 'chat.deepseek.com',
      pathname,
      href: `https://chat.deepseek.com${pathname}`,
      origin: 'https://chat.deepseek.com',
      protocol: 'https:',
      host: 'chat.deepseek.com',
      search: '',
      hash: '',
    },
    writable: true,
    configurable: true,
  });
}

function setNonDeepSeekLocation(hostname: string, pathname = '/'): void {
  Object.defineProperty(window, 'location', {
    value: {
      hostname,
      pathname,
      href: `https://${hostname}${pathname}`,
      origin: `https://${hostname}`,
      protocol: 'https:',
      host: hostname,
      search: '',
      hash: '',
    },
    writable: true,
    configurable: true,
  });
}

function escapeHtml(text: string): string {
  const element = document.createElement('div');
  element.textContent = text;
  return element.innerHTML;
}

function renderMessage(message: DeepSeekMessage, index: number): string {
  const id = message.id ?? `message-${index}`;
  if (message.role === 'user') {
    return `
      <div class="ds-message" data-message-id="${id}" data-role="user">
        <div class="ds-focus-ring">Copy</div>
        <div class="gh-user-query-raw">Duplicate raw query</div>
        <div class="gh-user-query-markdown">${escapeHtml(message.content)}</div>
      </div>`;
  }

  const thought = message.thought
    ? `<div class="ds-think-content"><button>Collapse</button><div class="ds-markdown"><p>${message.thought}</p></div></div>`
    : '';
  return `
    <div class="ds-message" data-message-id="${id}" data-role="assistant">
      ${thought}
      <div class="ds-markdown">${message.content}</div>
    </div>`;
}

function createDeepSeekPage(
  id: string,
  messages: DeepSeekMessage[],
  route: 'chat' | 'share' = 'chat'
): void {
  setDeepSeekLocation(id, route);
  loadFixture(`
    <main>
      <div class="ds-scroll-area">
        <div class="ds-virtual-list">
          <div class="ds-virtual-list-items">
            ${messages.map(renderMessage).join('\n')}
          </div>
        </div>
      </div>
    </main>`);
}

describe('DeepSeekExtractor', () => {
  let extractor: DeepSeekExtractor;

  beforeEach(() => {
    extractor = new DeepSeekExtractor();
    clearFixture();
    localStorage.clear();
    document.title = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    clearFixture();
    resetLocation();
    document.title = '';
  });

  describe('platform detection', () => {
    it('identifies chat.deepseek.com', () => {
      setDeepSeekLocation('chat-123');
      expect(extractor.platform).toBe('deepseek');
      expect(extractor.canExtract()).toBe(true);
    });

    it('rejects lookalike subdomains', () => {
      setNonDeepSeekLocation('chat.deepseek.com.attacker.example', '/a/chat/s/chat-123');
      expect(extractor.canExtract()).toBe(false);
    });
  });

  describe('conversation identity', () => {
    it('extracts a signed-in conversation id from /a/chat/s/{id}', () => {
      setDeepSeekLocation('2e2f7ec4-49e3-4c49-b00a-a49a6e6db1d9');
      expect(extractor.getConversationId()).toBe('2e2f7ec4-49e3-4c49-b00a-a49a6e6db1d9');
    });

    it('extracts a shared conversation id from /share/{id}', () => {
      setDeepSeekLocation('shared-chat-42', 'share');
      expect(extractor.getConversationId()).toBe('shared-chat-42');
    });

    it('returns null for a non-conversation DeepSeek route', () => {
      setNonDeepSeekLocation('chat.deepseek.com', '/a/chat');
      expect(extractor.getConversationId()).toBeNull();
    });
  });

  describe('message extraction', () => {
    it('fetches the complete active API branch without scrolling', async () => {
      createDeepSeekPage('chat-123', [
        { role: 'user', content: 'Only the latest mounted question' },
        { role: 'assistant', content: '<p>Only the latest mounted answer</p>' },
      ]);
      localStorage.setItem('userToken', JSON.stringify({ value: 'local-test-token' }));
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              biz_data: {
                cache_control: 'REPLACE',
                chat_session: {
                  id: 'chat-123',
                  title: 'Complete API conversation',
                  current_message_id: 4,
                },
                chat_messages: [
                  {
                    message_id: 5,
                    parent_id: 1,
                    role: 'ASSISTANT',
                    fragments: [{ type: 'RESPONSE', content: 'Inactive alternative' }],
                  },
                  {
                    message_id: 3,
                    parent_id: 2,
                    role: 'USER',
                    fragments: [{ type: 'REQUEST', content: 'Second question' }],
                  },
                  {
                    message_id: 1,
                    parent_id: null,
                    role: 'USER',
                    fragments: [{ type: 'REQUEST', content: 'First question' }],
                  },
                  {
                    message_id: 4,
                    parent_id: 3,
                    role: 'ASSISTANT',
                    fragments: [{ type: 'RESPONSE', content: 'Second answer' }],
                  },
                  {
                    message_id: 2,
                    parent_id: 1,
                    role: 'ASSISTANT',
                    fragments: [{ type: 'RESPONSE', content: '**First answer**' }],
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
      extractor.applySettings({ enableAutoScroll: true } as SyncSettings);

      const result = await extractor.extract();

      expect(result.success).toBe(true);
      expect(result.data?.title).toBe('Complete API conversation');
      expect(result.data?.messages.map(message => message.content)).toEqual([
        'First question',
        '**First answer**',
        'Second question',
        'Second answer',
      ]);
      expect(result.data?.messages.map(message => message.id)).toEqual(['1', '2', '3', '4']);
      expect(result.data?.messages[1]?.contentFormat).toBe('markdown');
      expect(result.data?.messages.some(message => message.content.includes('Inactive'))).toBe(
        false
      );
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
        '/api/v0/chat/history_messages?chat_session_id=chat-123'
      );
    });

    it('uses the API fast path even when DOM auto-scroll is disabled', async () => {
      createDeepSeekPage('chat-123', [
        { role: 'user', content: 'Mounted question' },
        { role: 'assistant', content: '<p>Mounted answer</p>' },
      ]);
      localStorage.setItem('userToken', JSON.stringify({ value: 'local-test-token' }));
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              biz_code: 0,
              biz_data: {
                cache_control: 'REPLACE',
                chat_session: { id: 'chat-123', current_message_id: 2 },
                chat_messages: [
                  { message_id: 1, parent_id: null, role: 'USER', content: 'API question' },
                  { message_id: 2, parent_id: 1, role: 'ASSISTANT', content: 'API answer' },
                ],
              },
            },
          }),
          { status: 200 }
        )
      );
      extractor.applySettings({ enableAutoScroll: false } as SyncSettings);

      const result = await extractor.extract();

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(result.data?.messages.map(message => message.content)).toEqual([
        'API question',
        'API answer',
      ]);
    });

    it('extracts a 600-message active chain from one bounded API response', async () => {
      createDeepSeekPage('chat-123', []);
      localStorage.setItem('userToken', JSON.stringify({ value: 'local-test-token' }));
      const chatMessages = Array.from({ length: 600 }, (_, index) => ({
        message_id: String(index + 1),
        parent_id: index === 0 ? null : String(index),
        role: index % 2 === 0 ? 'USER' : 'ASSISTANT',
        fragments: [
          {
            type: index % 2 === 0 ? 'REQUEST' : 'RESPONSE',
            content: `Message ${index + 1}`,
          },
        ],
      }));
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              biz_data: {
                cache_control: 'REPLACE',
                chat_session: { id: 'chat-123', current_message_id: '600' },
                chat_messages: chatMessages,
              },
            },
          }),
          { status: 200 }
        )
      );

      const result = await extractor.extract();

      expect(result.success).toBe(true);
      expect(result.data?.messages).toHaveLength(600);
      expect(result.data?.messages[0]?.content).toBe('Message 1');
      expect(result.data?.messages[599]?.content).toBe('Message 600');
    });

    it('includes API reasoning only when tool content is enabled', async () => {
      createDeepSeekPage('chat-123', []);
      localStorage.setItem('userToken', JSON.stringify({ value: 'local-test-token' }));
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              biz_data: {
                cache_control: 'REPLACE',
                chat_session: { id: 'chat-123', current_message_id: '2' },
                chat_messages: [
                  {
                    message_id: '1',
                    parent_id: null,
                    role: 'USER',
                    fragments: [{ type: 'REQUEST', content: 'Question' }],
                  },
                  {
                    message_id: '2',
                    parent_id: '1',
                    role: 'ASSISTANT',
                    fragments: [
                      { type: 'THINK', content: 'Reasoning from API' },
                      { type: 'RESPONSE', content: 'Final answer' },
                    ],
                  },
                ],
              },
            },
          }),
          { status: 200 }
        )
      );
      extractor.applySettings({ enableAutoScroll: true, enableToolContent: true } as SyncSettings);

      const result = await extractor.extract();

      expect(result.data?.messages[1]?.content).toBe('Final answer');
      expect(result.data?.messages[1]?.toolContent).toContain('Reasoning from API');
    });

    it('falls back to the mounted DOM when the history request fails', async () => {
      createDeepSeekPage('chat-123', [
        { role: 'user', content: 'Fallback question' },
        { role: 'assistant', content: '<p>Fallback answer</p>' },
      ]);
      localStorage.setItem('userToken', JSON.stringify({ value: 'local-test-token' }));
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
      extractor.applySettings({ enableAutoScroll: true } as SyncSettings);

      const result = await extractor.extract();

      expect(result.success).toBe(true);
      expect(result.data?.messages.map(message => message.content).join('\n')).toContain(
        'Fallback answer'
      );
    });

    it.each([{}, 1.5])(
      'falls back instead of treating malformed parent id %j as a root',
      async malformedParent => {
        createDeepSeekPage('chat-123', [
          { role: 'user', content: 'Safe fallback question' },
          { role: 'assistant', content: '<p>Safe fallback answer</p>' },
        ]);
        localStorage.setItem('userToken', JSON.stringify({ value: 'local-test-token' }));
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          new Response(
            JSON.stringify({
              code: 0,
              data: {
                biz_data: {
                  cache_control: 'REPLACE',
                  chat_session: { id: 'chat-123', current_message_id: 2 },
                  chat_messages: [
                    { message_id: 1, parent_id: null, role: 'USER', content: 'API question' },
                    {
                      message_id: 2,
                      parent_id: malformedParent,
                      role: 'ASSISTANT',
                      content: 'Truncated API answer',
                    },
                  ],
                },
              },
            }),
            { status: 200 }
          )
        );

        const result = await extractor.extract();
        const body = result.data?.messages.map(message => message.content).join('\n') ?? '';

        expect(result.success).toBe(true);
        expect(body).toContain('Safe fallback answer');
        expect(body).not.toContain('Truncated API answer');
      }
    );

    it('extracts rendered user and assistant messages in DOM order', async () => {
      createDeepSeekPage('chat-123', [
        { role: 'user', content: 'Explain virtual scrolling.' },
        { role: 'assistant', content: '<p>It mounts only a window of rows.</p>' },
        { role: 'user', content: 'Thank you!' },
      ]);

      const result = await extractor.extract();

      expect(result.success).toBe(true);
      expect(result.data?.messages.map(message => message.role)).toEqual([
        'user',
        'assistant',
        'user',
      ]);
      expect(result.data?.messages[0]?.content).toBe('Explain virtual scrolling.');
      expect(result.data?.messages[1]?.content).toContain('It mounts only a window of rows.');
      expect(result.data?.messages[2]?.content).toBe('Thank you!');
    });

    it('uses the first user query as a title fallback', () => {
      createDeepSeekPage('chat-123', [
        { role: 'user', content: 'A title from the first question' },
        { role: 'assistant', content: '<p>Answer</p>' },
      ]);

      expect(extractor.getTitle()).toBe('A title from the first question');
    });

    it('sanitizes assistant HTML before returning it', async () => {
      createDeepSeekPage('chat-123', [
        { role: 'user', content: 'Test' },
        {
          role: 'assistant',
          content: '<script>alert("xss")</script><img src="x" onerror="alert(1)"><p>Safe</p>',
        },
      ]);

      const result = await extractor.extract();
      const assistant = result.data?.messages.find(message => message.role === 'assistant');

      expect(assistant?.content).toContain('Safe');
      expect(assistant?.content).not.toContain('<script>');
      expect(assistant?.content).not.toContain('onerror');
    });

    it('does not include DeepSeek thinking by default', async () => {
      createDeepSeekPage('chat-123', [
        { role: 'user', content: 'Question' },
        {
          role: 'assistant',
          thought: 'Hidden reasoning detail',
          content: '<p>Visible final answer</p>',
        },
      ]);

      const result = await extractor.extract();
      const assistant = result.data?.messages.find(message => message.role === 'assistant');

      expect(assistant?.content).toContain('Visible final answer');
      expect(assistant?.content).not.toContain('Hidden reasoning detail');
      expect(assistant?.toolContent).toBeUndefined();
    });

    it('adds DeepSeek thinking as tool content only when enabled', async () => {
      extractor.applySettings({ enableToolContent: true } as SyncSettings);
      createDeepSeekPage('chat-123', [
        { role: 'user', content: 'Question' },
        {
          role: 'assistant',
          thought: 'Useful reasoning detail',
          content: '<p>Visible final answer</p>',
        },
      ]);

      const result = await extractor.extract();
      const assistant = result.data?.messages.find(message => message.role === 'assistant');

      expect(assistant?.content).toContain('Visible final answer');
      expect(assistant?.toolContent).toContain('DeepSeek reasoning');
      expect(assistant?.toolContent).toContain('Useful reasoning detail');
      expect(assistant?.toolContent).not.toContain('Collapse');
    });

    it('exports the active rendered view and ignores hidden alternative branches', async () => {
      setDeepSeekLocation('chat-123');
      loadFixture(`
        <main>
          <div class="ds-scroll-area">
            <div class="ds-message" data-role="user"><div>Active question</div></div>
            <div class="ds-message" data-role="assistant"><div class="ds-markdown"><p>Active answer</p></div></div>
            <div aria-hidden="true">
              <div class="ds-message" data-role="assistant"><div class="ds-markdown"><p>Unselected branch</p></div></div>
            </div>
          </div>
        </main>`);

      const result = await extractor.extract();
      const body = result.data?.messages.map(message => message.content).join('\n') ?? '';

      expect(result.success).toBe(true);
      expect(body).toContain('Active answer');
      expect(body).not.toContain('Unselected branch');
    });
  });
});
