/**
 * DeepSeek Extractor
 *
 * Extracts the active DeepSeek conversation from chat.deepseek.com.
 * Signed-in chats use DeepSeek's same-origin history endpoint first, avoiding
 * the virtual list entirely. DOM accumulation remains the compatibility path.
 */

import { BaseExtractor, type ScrollConfig } from './base';
import { MAX_CONVERSATION_TITLE_LENGTH } from '../../lib/constants';
import { sanitizeHtml } from '../../lib/sanitize';
import { generateHash } from '../../lib/hash';
import type { HarvestEntry } from '../../lib/scroll-manager';
import type { ConversationMessage, ExtractionResult, SyncSettings } from '../../lib/types';
import { SELECTORS } from './selectors/deepseek';
import { fetchDeepSeekConversation } from './deepseek-api';

type MessageRole = 'user' | 'assistant';

/**
 * DeepSeek conversation extractor.
 *
 * The history response can contain alternative descendants. Its
 * chat_session.current_message_id identifies the leaf selected in DeepSeek;
 * following parent_id back to the root exports that active branch only.
 */
export class DeepSeekExtractor extends BaseExtractor {
  readonly platform = 'deepseek';

  /** Include DeepSeek's expanded reasoning text as a collapsed tool callout. */
  enableToolContent = false;

  /** Apply user-controlled auto-scroll and reasoning-content settings. */
  applySettings(settings: SyncSettings): void {
    this.enableAutoScroll = settings.enableAutoScroll ?? false;
    this.enableToolContent = settings.enableToolContent ?? false;
  }

  /**
   * Prefer the structured same-origin history response for complete signed-in
   * conversations. It is local to the already-authenticated DeepSeek tab: the
   * token is read only to call chat.deepseek.com and is never persisted or
   * included in logs. Any API/schema/auth failure falls back to the existing
   * DOM path, including user-controlled virtual-list auto-scroll.
   */
  async extract(): Promise<ExtractionResult> {
    if (this.isSignedInConversationRoute()) {
      try {
        const conversationId = this.getConversationId();
        const apiConversation = conversationId
          ? await fetchDeepSeekConversation(conversationId, this.enableToolContent)
          : null;
        if (apiConversation) {
          if (conversationId) {
            console.info('[G2O] Extracted DeepSeek conversation from local session history');
            return this.buildConversationResult(
              apiConversation.messages,
              conversationId,
              apiConversation.title ?? this.getTitle(),
              this.platform
            );
          }
        }
      } catch (error) {
        console.warn(
          '[G2O] DeepSeek history API unavailable; falling back to rendered conversation:',
          error instanceof Error ? error.message : 'unknown error'
        );
      }
    }

    return super.extract();
  }

  // ========== ID & Title Extraction ==========

  /**
   * DeepSeek conversation routes:
   * - /a/chat/s/{id} for a signed-in conversation
   * - /share/{id} for a shared conversation
   */
  getConversationId(): string | null {
    const match = window.location.pathname.match(/\/(?:a\/chat\/s|share)\/([a-z0-9-]+)/i);
    return match ? match[1] : null;
  }

  /**
   * Prefer the page title, then the first active user query.
   */
  getTitle(): string {
    return this.getPageTitle() ?? this.getFirstUserTitle() ?? 'Untitled DeepSeek Conversation';
  }

  /** Full history is an authenticated-chat feature, not a public-share API. */
  private isSignedInConversationRoute(): boolean {
    return /^\/a\/chat\/s\/[a-z0-9-]+\/?$/i.test(window.location.pathname);
  }

  /**
   * Title fallback from the rendered user-query child, not the whole message
   * root. DeepSeek keeps raw duplicate query nodes and controls beside it.
   */
  private getFirstUserTitle(): string | null {
    const userRoot = this.queryWithFallback<HTMLElement>(SELECTORS.userMessage);
    if (!userRoot) return null;

    const query = this.queryWithFallback<HTMLElement>(SELECTORS.userContent, userRoot);
    const title = query ? this.extractCleanText(query) : this.extractUserContent(userRoot);
    return title ? title.substring(0, MAX_CONVERSATION_TITLE_LENGTH) : null;
  }

  // ========== Message Extraction ==========

  /**
   * Extract only the messages mounted in the active page DOM. When auto-scroll
   * is enabled, BaseExtractor invokes harvestWindow() to accumulate all mounted
   * virtual-list windows instead.
   */
  extractMessages(): ConversationMessage[] {
    const messages: ConversationMessage[] = [];

    for (const messageElement of this.collectMessageElements()) {
      const message = this.buildMessage(messageElement, messages.length);
      if (message) messages.push(message);
    }

    return messages;
  }

  /** DeepSeek virtualizes long conversations. */
  protected getScrollConfig(): ScrollConfig {
    return {
      container: SELECTORS.scrollContainer,
      harvest: () => this.harvestWindow(),
    };
  }

  /**
   * Harvest the currently mounted virtual-list window.
   *
   * DeepSeek may retain a small overlap while the list scrolls. Prefer a
   * message id when supplied; otherwise use the virtual row's monotonic
   * data-index and finally a role/content hash. This keeps de-duplication
   * stable even when DOM nodes are mounted and evicted between passes.
   */
  private harvestWindow(): HarvestEntry<ConversationMessage>[] {
    const entries: HarvestEntry<ConversationMessage>[] = [];

    for (const messageElement of this.collectMessageElements()) {
      const role = this.messageRole(messageElement);
      const message = this.buildMessage(messageElement, 0, role);
      if (!message) continue;

      const dataIndex = messageElement.closest<HTMLElement>('[data-index]')?.dataset.index;
      const parsedIndex = dataIndex === undefined ? NaN : Number(dataIndex);
      const messageId = this.getMessageId(messageElement);
      const key =
        messageId ??
        (dataIndex ? `idx-${dataIndex}-${role}` : `${role}-${generateHash(message.content)}`);

      entries.push({
        key,
        value: { ...message, id: key },
        order: Number.isFinite(parsedIndex) ? parsedIndex : undefined,
      });
    }

    return entries;
  }

  /** Return top-level message roots in active DOM order. */
  private collectMessageElements(): HTMLElement[] {
    const messages = this.queryAllWithFallback<HTMLElement>(SELECTORS.message);

    // A quoted/embedded DeepSeek response can theoretically contain another
    // `.ds-message`. Only actual conversation roots belong to this export.
    return messages.filter(
      message =>
        !message.parentElement?.closest('.ds-message') &&
        message.closest('[inert], [aria-hidden="true"]') === null
    );
  }

  /** Determine role from an explicit attribute when present, then markdown. */
  private messageRole(messageElement: HTMLElement): MessageRole {
    const explicitRole =
      messageElement.getAttribute('data-role') ??
      messageElement.getAttribute('data-message-role') ??
      messageElement.getAttribute('data-author-role') ??
      messageElement.querySelector<HTMLElement>('[data-role]')?.dataset.role;

    if (explicitRole === 'assistant' || explicitRole === 'ai') return 'assistant';
    if (explicitRole === 'user' || explicitRole === 'human') return 'user';

    return messageElement.querySelector(SELECTORS.markdownContent[0]) ? 'assistant' : 'user';
  }

  /** Build one conversation message without mutating page DOM. */
  private buildMessage(
    messageElement: HTMLElement,
    index: number,
    role = this.messageRole(messageElement)
  ): ConversationMessage | null {
    const content =
      role === 'user'
        ? this.extractUserContent(messageElement)
        : this.extractAssistantContent(messageElement);
    if (!content) return null;

    const message: ConversationMessage = {
      id: `${role}-${index}`,
      role,
      content,
      htmlContent: role === 'assistant' ? content : undefined,
      index,
    };

    if (role === 'assistant' && this.enableToolContent) {
      const toolContent = this.extractThoughtContent(messageElement);
      if (toolContent) return { ...message, toolContent };
    }

    return message;
  }

  /**
   * Extract a user query as text. DeepSeek can show a raw duplicate and UI
   * controls alongside the rendered query, so clone and strip those before
   * reading text.
   */
  private extractUserContent(messageElement: HTMLElement): string {
    const candidate = this.queryWithFallback<HTMLElement>(SELECTORS.userContent, messageElement);
    return this.extractCleanText(candidate ?? messageElement);
  }

  /**
   * Extract the rendered final answer, explicitly excluding thinking blocks.
   * DeepSeek can retain multiple markdown nodes while generating; the last
   * non-thinking block is the currently rendered answer body.
   */
  private extractAssistantContent(messageElement: HTMLElement): string {
    const answerBlocks = this.getAnswerMarkdownBlocks(messageElement);
    const answer = answerBlocks[answerBlocks.length - 1];
    if (!answer) return '';

    const clone = this.cloneWithoutControls(answer);
    return sanitizeHtml(clone.innerHTML);
  }

  /** Include expanded DeepSeek reasoning only when the setting enabled it. */
  private extractThoughtContent(messageElement: HTMLElement): string | undefined {
    const thoughts = this.queryAllWithFallback<HTMLElement>(
      SELECTORS.thoughtContent,
      messageElement
    );
    const parts = thoughts
      .map(thought => this.extractCleanText(thought))
      .filter((thought): thought is string => thought.length > 0);

    return parts.length > 0 ? `**DeepSeek reasoning**\n${parts.join('\n\n')}` : undefined;
  }

  /** Markdown body nodes that are part of the answer rather than reasoning. */
  private getAnswerMarkdownBlocks(messageElement: HTMLElement): HTMLElement[] {
    const blocks = this.queryAllWithFallback<HTMLElement>(
      SELECTORS.markdownContent,
      messageElement
    ).filter(block => block.closest(SELECTORS.thoughtContent[0]) === null);

    // A fallback selector can match a wrapper and its child. Keeping the
    // outermost node prevents duplicate answer text before selecting the final
    // response block.
    return blocks.filter(block => !blocks.some(other => other !== block && other.contains(block)));
  }

  /** Stable DeepSeek message identity if the page exposes one. */
  private getMessageId(messageElement: HTMLElement): string | null {
    return (
      messageElement.getAttribute('data-message-id') ??
      messageElement.getAttribute('data-id') ??
      messageElement.querySelector('[data-message-id]')?.getAttribute('data-message-id') ??
      messageElement.querySelector('[data-id]')?.getAttribute('data-id') ??
      null
    );
  }

  /** Clone a UI node and remove controls/duplicate invisible content safely. */
  private cloneWithoutControls(element: Element): HTMLElement {
    const clone = element.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll(
        'button, [role="button"], svg, textarea, input, select, [aria-hidden="true"]'
      )
      .forEach(control => control.remove());
    return clone;
  }

  /** Read normalized text from a cloned content node without UI controls. */
  private extractCleanText(element: Element): string {
    const clone = this.cloneWithoutControls(element);
    return this.extractPlainText(clone);
  }
}
