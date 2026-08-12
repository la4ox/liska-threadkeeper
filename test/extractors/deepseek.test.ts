import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    document.title = '';
  });

  afterEach(() => {
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
