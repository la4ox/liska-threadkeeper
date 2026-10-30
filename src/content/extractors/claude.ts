/**
 * Claude Extractor
 *
 * Extracts conversations from Claude AI (claude.ai)
 * Supports both normal chat and Deep Research (Extended Thinking) modes
 *
 */

import { BaseExtractor, type ScrollConfig } from './base';
import { sanitizeHtml } from '../../lib/sanitize';
import { htmlToMarkdownRaw } from '../markdown-rules';
import {
  ClaudeToolConversionBudget,
  appendClaudeToolPart,
  claudeToolHtmlToMarkdown,
} from './claude-tool-markdown';
import { generateHash } from '../../lib/hash';
import { mergeLiskaLossDiagnostics } from '../../lib/loss-diagnostics';
import type { HarvestEntry } from '../../lib/scroll-manager';
import type {
  ConversationMessage,
  DeepResearchSource,
  ExtractionResult,
  SyncSettings,
} from '../../lib/types';
import {
  SELECTORS,
  DEEP_RESEARCH_SELECTORS,
  CURRENT_ARTIFACT_SELECTORS,
  JOINED_SELECTORS,
} from './selectors/claude';

// October assistant roots wrap answer text, accessibility/action chrome and
// step rows. Strip these only on a detached clone, before every content path.
const STEP_ROW_SELECTOR = '[data-cds="TurnStatus"]';
const ANSWER_CHROME_SELECTOR = `h2.sr-only, [data-testid="message-actions"], ${STEP_ROW_SELECTOR}`;
const ARTIFACT_CONTENT_OMITTED_WARNING =
  'Visible Claude Artifact content was not included because the isolated frame layout is unsupported.';

/**
 * Claude conversation and Deep Research extractor
 *
 * Implements IConversationExtractor interface
 * @see src/lib/types.ts
 */
export class ClaudeExtractor extends BaseExtractor {
  readonly platform = 'claude';
  /** Include tool-use / intermediate content (web search, code interpreter, etc.) */
  enableToolContent = false;

  /**
   * Apply user settings: enable/disable tool content extraction and auto-scroll
   */
  applySettings(settings: SyncSettings): void {
    this.enableToolContent = settings.enableToolContent ?? false;
    this.enableAutoScroll = settings.enableAutoScroll ?? false;
  }

  /** Preserve the existing transcript/report path and record only observed loss. */
  async extract(): Promise<ExtractionResult> {
    // A user can start export while the Artifact is visible and Claude can then
    // rerender or dismiss that pane during asynchronous history scrolling. Keep
    // the initial positive observation; a later observation may add evidence,
    // but provider churn must not erase an already observed omission.
    const artifactFrameObserved = this.hasUnsupportedArtifactFrame();
    const result = await super.extract();
    if (
      !result.success ||
      !result.data ||
      (!artifactFrameObserved && !this.hasUnsupportedArtifactFrame())
    ) {
      return result;
    }

    return {
      ...result,
      data: {
        ...result.data,
        liskaLossDiagnostics: mergeLiskaLossDiagnostics(result.data.liskaLossDiagnostics, [
          'claude-artifact-content-omitted',
        ]),
      },
      warnings: result.warnings?.includes(ARTIFACT_CONTENT_OMITTED_WARNING)
        ? result.warnings
        : [...(result.warnings ?? []), ARTIFACT_CONTENT_OMITTED_WARNING],
    };
  }

  /** Inspect top-document frame presence only; never access the isolated document. */
  private hasUnsupportedArtifactFrame(): boolean {
    return Array.from(document.querySelectorAll(CURRENT_ARTIFACT_SELECTORS.frame[0])).some(
      frame => {
        if (this.isInDismissedPanel(frame) || frame.closest('[hidden]')) return false;
        const frameStyle = window.getComputedStyle(frame);
        if (
          frameStyle.display === 'none' ||
          frameStyle.visibility === 'hidden' ||
          frameStyle.visibility === 'collapse'
        ) {
          return false;
        }

        // Claude keeps the panel visibly selected (with a loading surface) while
        // the inner document iframe can be transiently transparent. Evaluate
        // rendering suppression from the panel boundary outward, not from that
        // implementation-detail frame, so loading still records the omission.
        const panel = frame.closest('[role="region"]') ?? frame;
        for (let ancestor: Element | null = panel; ancestor; ancestor = ancestor.parentElement) {
          if (ancestor.matches('details:not([open])')) {
            const summary = ancestor.querySelector(':scope > summary');
            if (!summary?.contains(frame)) return false;
          }
          const style = window.getComputedStyle(ancestor);
          if (
            style.display === 'none' ||
            style.contentVisibility === 'hidden' ||
            Number.parseFloat(style.opacity) === 0
          ) {
            return false;
          }
        }
        return true;
      }
    );
  }

  // ========== Platform Detection ==========

  /**
   * Check if a Deep Research / Artifact report is the actively-viewed panel.
   *
   * Detects the #markdown-artifact element, but presence alone is not enough:
   * Claude keeps the artifact mounted after the panel is closed, moving the
   * off-screen panel into an `inert` + `aria-hidden="true"` subtree (verified
   * live 2026-07-16, w/h collapse to 0 and x is pushed past the viewport). A
   * presence-only check therefore hijacked every save after the user had ever
   * opened a report — returning the stale report and dropping the conversation
   * (issue #352 follow-up). Treat an inert / aria-hidden subtree as "closed".
   *
   * @see FR-003-3 in design document
   */
  isDeepResearchVisible(): boolean {
    const artifact = this.queryWithFallback<HTMLElement>(DEEP_RESEARCH_SELECTORS.artifact);
    if (!artifact) return false;
    return !this.isInDismissedPanel(artifact);
  }

  /**
   * Whether an element sits inside a dismissed (closed) panel subtree.
   *
   * Claude does not unmount a closed Deep Research / Artifact panel — it moves
   * the off-screen subtree into `inert` + `aria-hidden="true"` (verified live
   * 2026-07-16). Such content is neither the active view nor a real conversation
   * turn. Keep this guard strict for DR detection and artifact messages; normal
   * conversation rows separately allow collapsed inert-only content below a row.
   */
  private isInDismissedPanel(element: Element): boolean {
    return element.closest('[inert], [aria-hidden="true"]') !== null;
  }

  /**
   * Conversation turns can keep their collapsed long content under an inert
   * wrapper INSIDE a virtual row (upstream #452). Only that inert-only shape
   * is exempt: a hidden/inert row or enclosing panel is still dismissed.
   * Walk the full ancestor chain so a nearer collapsed wrapper cannot mask a
   * closed outer panel. Artifact visibility retains the stricter panel guard.
   */
  private isInDismissedConversationPanel(element: Element): boolean {
    if (
      DEEP_RESEARCH_SELECTORS.artifact.some(selector => element.closest(selector)) &&
      this.isInDismissedPanel(element)
    ) {
      return true;
    }

    const row = element.closest(SELECTORS.conversationRow[0]);
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.matches('[aria-hidden="true"], [hidden]')) return true;
      if (ancestor.hasAttribute('inert') && (row === null || ancestor.contains(row))) return true;
    }
    return false;
  }

  // ========== ID & Title Extraction ==========

  /**
   * Extract conversation ID from URL
   *
   * URL format: https://claude.ai/chat/{uuid}
   * @returns UUID string or null if not found
   */
  getConversationId(): string | null {
    const match = window.location.pathname.match(/\/chat\/([a-f0-9-]{36})/i);
    return match ? match[1] : null;
  }

  /**
   * Get conversation title
   *
   * Priority:
   * 1. Deep Research h1 title (if Deep Research visible)
   * 2. document.title (via getPageTitle())
   * 3. First user message content (truncated)
   * 4. Default title
   */
  getTitle(): string {
    if (this.isDeepResearchVisible()) {
      return this.getDeepResearchTitle();
    }

    return (
      this.getPageTitle() ??
      this.getFirstMessageTitle(SELECTORS.userMessage, 'Untitled Claude Conversation')
    );
  }

  /** Expose platform selectors to BaseExtractor's DR title/content helpers. */
  protected getDeepResearchSelectors() {
    return DEEP_RESEARCH_SELECTORS;
  }

  // ========== Message Extraction ==========

  /**
   * Extract all messages from conversation
   *
   * Extracts User/Assistant messages in DOM order
   * @see FR-002 in design document
   */
  extractMessages(): ConversationMessage[] {
    const toolBudget = new ClaudeToolConversionBudget();
    const sortedElements = this.collectSortedElements();

    // Pre-extract tool content keyed by message ID (matches buildMessagesFromElements format)
    const toolContentById = new Map<string, string>();
    if (this.enableToolContent) {
      sortedElements.forEach((item, index) => {
        if (item.type === 'assistant') {
          const tc = this.extractToolContentFromElement(item.element, toolBudget);
          if (tc) toolContentById.set(`assistant-${index}`, tc);
        }
      });
    }

    const messages = this.buildMessagesFromElements(
      sortedElements,
      el => this.extractUserContent(el),
      el => this.extractAssistantContent(el)
    );

    // Attach tool content to corresponding assistant messages without mutating existing messages.
    if (toolContentById.size === 0) return messages;

    return messages.map(msg => {
      const tc = toolContentById.get(msg.id);
      return tc ? { ...msg, toolContent: tc } : msg;
    });
  }

  /**
   * Collect user/assistant message elements in DOM order.
   *
   * User messages nested inside an assistant response (e.g. quoted content) are
   * skipped, as is anything inside a dismissed artifact panel (a closed report
   * lingers with `.font-claude-response`; see {@link isInDismissedConversationPanel}).
   * Shared by extractMessages() (single pass) and harvestWindow() (per-scroll-
   * window pass for virtualized conversations).
   */
  private collectSortedElements(): Array<{ element: Element; type: 'user' | 'assistant' }> {
    const allElements: Array<{ element: Element; type: 'user' | 'assistant' }> = [];
    const userMessages = this.collectUserElements();
    const assistantResponses = this.collectAssistantElements(userMessages);

    userMessages.forEach(el => {
      if (!assistantResponses.some(assistant => assistant.contains(el))) {
        allElements.push({ element: el, type: 'user' });
      }
    });

    assistantResponses.forEach(el => {
      allElements.push({ element: el, type: 'assistant' });
    });

    return this.sortByDomPosition(allElements);
  }

  /** Keep disjoint primary/legacy users, collapsing only overlapping wrappers. */
  private collectUserElements(): Element[] {
    const candidates = SELECTORS.userMessage
      .flatMap(selector => Array.from(document.querySelectorAll(selector)))
      .filter(element => !this.isInDismissedConversationPanel(element));
    return this.distinctElements(candidates);
  }

  /** Prefer strong identities without discarding separate lower-priority turns. */
  private collectAssistantElements(userCandidates: Element[]): Element[] {
    const strong = this.distinctElements(
      SELECTORS.assistantResponse
        .slice(0, -1)
        .flatMap(selector => Array.from(document.querySelectorAll(selector)))
        .filter(element => !this.isInDismissedConversationPanel(element))
    );
    const users = userCandidates.filter(
      user => !strong.some(assistant => assistant.contains(user))
    );
    // Streaming alone is not a role identity: user content and its layout can
    // carry it too. A genuine user root wins either direction of overlap.
    const weak = SELECTORS.assistantResponse
      .slice(-1)
      .flatMap(selector => Array.from(document.querySelectorAll(selector)))
      .filter(
        element =>
          !this.isInDismissedConversationPanel(element) &&
          !users.some(user => user.contains(element) || element.contains(user))
      );
    return this.distinctElements([...strong, ...weak]);
  }

  /** Candidates are already in identity-priority order; text is never a key. */
  private distinctElements(candidates: Element[], budget?: ClaudeToolConversionBudget): Element[] {
    const selected: Element[] = [];
    const selectedSet = new Set<Element>();
    const ancestorsWithSelectedDescendant = new Set<Element>();
    for (const candidate of candidates) {
      if (selectedSet.has(candidate) || ancestorsWithSelectedDescendant.has(candidate)) continue;

      let hasSelectedAncestor = false;
      for (let ancestor = candidate.parentElement; ancestor; ancestor = ancestor.parentElement) {
        budget?.addDomNodes(1);
        if (selectedSet.has(ancestor)) {
          hasSelectedAncestor = true;
          break;
        }
      }
      if (hasSelectedAncestor) continue;

      selected.push(candidate);
      selectedSet.add(candidate);
      for (let ancestor = candidate.parentElement; ancestor; ancestor = ancestor.parentElement) {
        budget?.addDomNodes(1);
        ancestorsWithSelectedDescendant.add(ancestor);
      }
    }
    return selected;
  }

  /**
   * Auto-scroll config: Claude virtualizes the conversation (ADR-017).
   */
  protected getScrollConfig(): ScrollConfig {
    const toolBudget = new ClaudeToolConversionBudget();
    return {
      container: SELECTORS.scrollContainer,
      harvest: () => this.harvestWindow(toolBudget),
    };
  }

  /**
   * Harvest the currently-mounted window as keyed messages.
   *
   * The key is the virtual-row `data-index` (stable per turn across windows),
   * falling back to a content hash when the wrapper is absent, so turns are
   * de-duplicated correctly as windows overlap during scrolling.
   */
  private harvestWindow(
    toolBudget: ClaudeToolConversionBudget
  ): HarvestEntry<ConversationMessage>[] {
    const entries: HarvestEntry<ConversationMessage>[] = [];
    this.collectSortedElements().forEach(item => {
      const content =
        item.type === 'user'
          ? this.extractUserContent(item.element)
          : this.extractAssistantContent(item.element);
      if (!content) return;

      // `data-index` is monotonic in conversation order; use it both as the
      // stable de-dup key and as the ordering signal so accumulation can sort by
      // it (robust against mergeWindow scramble — issue #352).
      const row = item.element.closest(SELECTORS.conversationRow[0]);
      const dataIndex = row?.getAttribute('data-index');
      const parsed = dataIndex !== undefined && dataIndex !== null ? Number(dataIndex) : NaN;
      const key = dataIndex ? `idx-${dataIndex}` : `${item.type}-${generateHash(content)}`;
      const order = Number.isFinite(parsed) ? parsed : undefined;
      const message: ConversationMessage = {
        id: key,
        role: item.type,
        content,
        htmlContent: item.type === 'assistant' ? content : undefined,
        index: 0, // re-indexed after accumulation
      };

      if (this.enableToolContent && item.type === 'assistant') {
        const tc = this.extractToolContentFromElement(item.element, toolBudget);
        if (tc) {
          entries.push({ key, value: { ...message, toolContent: tc }, order });
          return;
        }
      }
      entries.push({ key, value: message, order });
    });
    return entries;
  }

  /**
   * Extract user message content as markdown.
   *
   * Sanitizes the grid container's innerHTML via DOMPurify and converts it
   * to markdown (without angle-bracket escaping — {@link formatMessage}
   * applies that step later). This preserves paragraph breaks and
   * `<pre>`/`<code>` blocks that a plain `textContent` extraction would
   * flatten or drop entirely (see issue #200).
   *
   * Falls back to sanitized plain text for elements that produce no
   * markdown output (e.g. bare text nodes without block structure).
   */
  private extractUserContent(element: Element): string {
    const rawHtml = element.innerHTML;
    if (rawHtml) {
      const markdown = htmlToMarkdownRaw(sanitizeHtml(rawHtml)).trim();
      if (markdown) return markdown;
    }

    // Defensive fallback: preserve prior behavior for elements that have
    // only a text node and no convertible HTML structure.
    const textContent = element.textContent?.trim();
    if (textContent) {
      return this.sanitizeText(textContent);
    }
    return '';
  }

  /**
   * Extract assistant response content (HTML for markdown conversion)
   *
   * All HTML is sanitized via DOMPurify to prevent XSS
   * @see NFR-001-2 in design document
   */
  private extractAssistantContent(element: Element): string {
    if (element.matches(ANSWER_CHROME_SELECTOR)) return '';
    const answer = element.cloneNode(true) as Element;
    answer.querySelectorAll(ANSWER_CHROME_SELECTOR).forEach(chrome => chrome.remove());
    // Keep the legacy header/body distinction: a nested .row-start-1 inside
    // .row-start-2 is answer content, not a status header.
    this.collectStatusHeaders(answer).forEach(header => header.remove());

    const parts = this.collectResponseMarkdown(answer);
    if (parts.length > 0) {
      return parts.join('\n');
    }

    // The fallback uses the SAME cleaned clone. Empty wrappers left by a
    // thinking-only turn are not an answer; image-only content still survives.
    // This also keeps provider tool metadata out of ordinary message content
    // while the explicit tool-content setting is disabled.
    const html = sanitizeHtml(answer.innerHTML);
    return htmlToMarkdownRaw(html).trim() ? html : '';
  }

  /**
   * Collect the response body's markdown sections, in DOM order.
   *
   * A single response interleaves two content shapes. Thinking / tool-use steps
   * put their text inside a grid block's `.row-start-2`, while the final answer
   * is emitted as top-level `.standard-markdown` blocks that sit inside NO grid
   * section. Earlier revisions read only `.row-start-2` and fell back to a
   * whole-element search solely when every section came back empty, so a
   * response that had both shapes returned just the step preambles and dropped
   * the entire answer.
   *
   * `querySelectorAll` walks in document order, so one sweep yields both shapes
   * already in conversation order.
   */
  private collectResponseMarkdown(element: Element): string[] {
    const sections = this.queryAllWithFallback<HTMLElement>(SELECTORS.markdownContent, element);
    const parts: string[] = [];

    for (const section of sections) {
      if (this.isInStatusHeader(section)) continue;
      // A lower-priority selector such as [class*="markdown"] can match both a
      // wrapper and the node inside it; emitting both would repeat the shared
      // text, so keep only the outermost match.
      if (sections.some(other => other !== section && other.contains(section))) continue;
      const html = sanitizeHtml(section.innerHTML);
      if (html.trim()) parts.push(html);
    }

    return parts;
  }

  /**
   * Whether a markdown section belongs to a step's status header rather than to
   * the response body.
   *
   * Claude reuses `.row-start-1` / `.row-start-2` at two nesting levels: the
   * OUTER `.row-start-1` is the status header, whose tool output is surfaced
   * separately by {@link extractToolContentFromElement}, while a step's own text
   * sits under `.row-start-2` — wrapped in a SECOND, nested `.row-start-1`.
   * Skipping everything beneath any `.row-start-1` would therefore discard the
   * step text as well. A header also requires its paired `.row-start-2` sibling:
   * the class alone can be ordinary visible answer layout.
   */
  private isInStatusHeader(element: Element): boolean {
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.matches('.row-start-2')) return false;
      if (this.isLegacyStatusHeader(ancestor)) return true;
    }
    return false;
  }

  /** A legacy step has header/body siblings in the SAME step container. */
  private isLegacyStatusHeader(element: Element): boolean {
    return (
      element.matches('.row-start-1') &&
      element.closest('.row-start-2') === null &&
      Boolean(element.parentElement?.querySelector(':scope > .row-start-2'))
    );
  }

  /**
   * Merge October label-only tools and legacy rich grid tools in DOM order.
   *
   * October rows take priority over overlapping legacy-shaped wrappers. Their
   * expanded details must not be re-read through the old grid extractor.
   */
  private extractToolContentFromElement(
    element: Element,
    budget: ClaudeToolConversionBudget
  ): string | null {
    const octoberRows = Array.from(element.querySelectorAll(SELECTORS.toolStatus[0])).filter(
      row => !this.isInDismissedConversationPanel(row)
    );
    const legacyHeaders = this.collectStatusHeaders(element).filter(
      header => !header.closest(STEP_ROW_SELECTOR)
    );
    const toolCandidates = [...octoberRows, ...legacyHeaders];
    budget.assertSectionCapacity(toolCandidates.length);
    const candidates = this.distinctElements(toolCandidates, budget);
    const ordered = this.sortByDomPosition(candidates.map(element => ({ element })));

    const parts: string[] = [];
    for (const { element: header } of ordered) {
      if (header.matches(SELECTORS.toolStatus[0])) {
        budget.beginSection(header.innerHTML);
        const label = this.sanitizeText(
          header.querySelector(':scope > [data-cds-row] bdi')?.textContent ?? ''
        );
        if (label) {
          budget.addMetadataEntries(1);
          appendClaudeToolPart(parts, `**${label}**`, budget);
        }
        continue;
      }
      // Extended Thinking is presented separately from tool activity. Skip just
      // that block: a thinking step early in the response must not suppress the
      // tool content of every step after it.
      if (header.querySelector('[class*="group/thinking"]')) continue;

      const toolContent = this.extractToolContent(header, budget);
      appendClaudeToolPart(parts, toolContent, budget, true);
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }

  /**
   * Status headers of a response's grid step blocks, in DOM order.
   *
   * A response can carry several sequential steps, each with its own header.
   * Only the OUTER `.row-start-1` is a header — see {@link isInStatusHeader}
   * for why the nested one under `.row-start-2` must not be treated as such.
   */
  private collectStatusHeaders(element: Element): HTMLElement[] {
    return Array.from(element.querySelectorAll<HTMLElement>('.row-start-1')).filter(header =>
      this.isLegacyStatusHeader(header)
    );
  }

  /**
   * Extract tool content from .row-start-1 section
   *
   * Extracts:
   * 1. Summary button text (e.g., "Searched the web") as bold
   * 2. Search queries (group/row buttons with query text and result count)
   * 3. Search result items (identified by favicon images)
   * 4. .standard-markdown content (code interpreter, file analysis)
   */
  private extractToolContent(toolSection: Element, budget: ClaudeToolConversionBudget): string {
    budget.beginSection(toolSection.innerHTML);
    const parts: string[] = [];
    this.extractToolSummary(toolSection, parts, budget);
    this.extractToolQueries(toolSection, parts, budget);
    this.extractToolResults(toolSection, parts, budget);
    this.extractToolMarkdown(toolSection, parts, budget);
    return parts.join('\n\n');
  }

  /** Summary button text (e.g., "Searched the web") as bold */
  private extractToolSummary(
    toolSection: Element,
    parts: string[],
    budget: ClaudeToolConversionBudget
  ): void {
    const summaryButton = toolSection.querySelector('button span.truncate');
    if (summaryButton?.textContent) {
      appendClaudeToolPart(
        parts,
        '**' + this.sanitizeText(summaryButton.textContent) + '**',
        budget
      );
    }
  }

  /** Search queries (group/row buttons with query text and result count) */
  private extractToolQueries(
    toolSection: Element,
    parts: string[],
    budget: ClaudeToolConversionBudget
  ): void {
    const queryButtons = toolSection.querySelectorAll('[class*="group/row"]');
    queryButtons.forEach(btn => {
      budget.addMetadataEntries(1);
      const queryEl = btn.querySelector('.truncate');
      const countEl = btn.querySelector('p');
      if (queryEl?.textContent?.trim()) {
        let text = this.sanitizeText(queryEl.textContent);
        if (countEl?.textContent?.trim()) {
          text += ' (' + this.sanitizeText(countEl.textContent) + ')';
        }
        appendClaudeToolPart(parts, text, budget);
      }
    });
  }

  /** Search result items (identified by favicon images) */
  private extractToolResults(
    toolSection: Element,
    parts: string[],
    budget: ClaudeToolConversionBudget
  ): void {
    const favicons = toolSection.querySelectorAll('img[alt="favicon"]');
    if (favicons.length === 0) return;

    const items: string[] = [];
    const seenRows = new Set<Element>();
    favicons.forEach(img => {
      // Navigate: img → container div → result row div
      const row = img.parentElement?.parentElement;
      if (!row || row.children.length < 2) return;
      if (seenRows.has(row)) return;
      seenRows.add(row);
      budget.addMetadataEntries(1);
      // Children: [0]=favicon container, [1]=title, [2]=domain (optional)
      const title = row.children[1]?.textContent?.trim();
      const domain = row.children.length > 2 ? row.children[2]?.textContent?.trim() : undefined;
      if (title) {
        const text = domain ? '- ' + title + ' (' + domain + ')' : '- ' + title;
        if (items.length > 0) budget.addMarkdownBytes(1);
        budget.addMarkdown(text);
        items.push(text);
      }
    });
    if (items.length > 0) {
      appendClaudeToolPart(parts, items.join('\n'), budget, true);
    }
  }

  /** .standard-markdown content (code interpreter, file analysis) */
  private extractToolMarkdown(
    toolSection: Element,
    parts: string[],
    budget: ClaudeToolConversionBudget
  ): void {
    const markdownEls = toolSection.querySelectorAll('.standard-markdown');
    markdownEls.forEach(el => {
      const markdown = claudeToolHtmlToMarkdown(el.innerHTML, budget);
      appendClaudeToolPart(parts, markdown, budget, true);
    });
  }

  // ========== Deep Research Extraction ==========

  /**
   * Extract source list from Deep Research inline citations
   *
   * Deduplicates by URL and maintains DOM order
   * @see FR-003-4 in design document
   */
  extractSourceList(): DeepResearchSource[] {
    const sources: DeepResearchSource[] = [];
    const seenUrls = new Map<string, number>(); // URL -> index mapping for deduplication

    // Find all inline citation links
    const citationLinks = document.querySelectorAll<HTMLAnchorElement>(
      JOINED_SELECTORS.inlineCitation
    );

    citationLinks.forEach(link => {
      const url = link.href;
      if (!url || !url.startsWith('http')) return;

      // Skip duplicates
      if (seenUrls.has(url)) return;

      // Extract title from link text or parent
      let title = link.textContent?.trim() || '';
      if (!title || title.includes('+')) {
        // Try to get a better title from aria-label or title attribute
        title = link.getAttribute('aria-label') || link.getAttribute('title') || '';
      }
      if (!title) {
        title = 'Unknown Title';
      }

      const domain = this.extractDomain(url);

      const index = sources.length;
      seenUrls.set(url, index);

      sources.push({
        index,
        url,
        title: this.sanitizeText(title),
        domain,
      });
    });

    return sources;
  }
}
