/**
 * Perplexity Extractor
 *
 * Extracts conversations from Perplexity AI (www.perplexity.ai)
 * Supports normal chat mode and Deep Research reports
 *
 */

import { BaseExtractor } from './base';
import { sanitizeHtml } from '../../lib/sanitize';
import { isHttpUrl } from '../../lib/validation';
import { MAX_CONVERSATION_TITLE_LENGTH } from '../../lib/constants';
import type { ConversationMessage } from '../../lib/types';
import {
  createFootnoteRef,
  escapeMarkdownLink,
  footnoteDefsToHtml,
  transformCitations,
} from './footnotes';
import type { CitationTransformResult } from './footnotes';

import { SELECTORS } from './selectors/perplexity';

// Layout-specific detection stays outside the live selector contract: old
// placeholders/query spans no longer appear on current pages, and a collapsed
// Deep Research card has no report body until the user opens its preview.
const LEGACY_MARKDOWN_CONTENT: readonly string[] = ['div[id^="markdown-content-"]'];
const LEGACY_USER_QUERY: readonly string[] = ['span.select-text'];
const USER_QUERY_ANY_LAYOUT: readonly string[] = [...SELECTORS.userQuery, ...LEGACY_USER_QUERY];

// The report's outer prose wraps its own inline answer prose under both the
// old inline card and the open preview layout. Card styling is not a stable
// anchor, and matching the wrapper also lets us exclude nested answer prose.
const DEEP_RESEARCH_PROSE: readonly string[] = [
  '.prose.max-w-none',
  '.prose.dark\\:prose-invert.max-w-none',
];

// ========== Citation transformation (issue #291) ==========
//
// Perplexity renders inline source citations as "pill" spans:
//
//   <span class="citation inline" data-pplx-citation=""
//         data-pplx-citation-url="https://example.com/...">
//     <span class="group/trigger ...">          ← hover-trigger variant (no <a>)
//       ... <span>example.co</span><span>+1</span> ...
//   OR
//     <span class="inline-flex" aria-label="Source Title">  ← anchor variant
//       <a href="https://example.com/...">... <span>example.co</span> ...</a>
//
// Without transformation, DOMPurify strips the wrappers but keeps the pill
// text nodes, gluing "example.co+1" to the prose (the bug reported in #291).
// Every citation carries its source URL in data-pplx-citation-url, so each
// pill is rewritten into a footnote-ref placeholder span, with per-message
// footnote definitions linking title and URL (same pipeline as NotebookLM).

/** Attribute carrying the source URL on modern citation spans. */
const CITATION_URL_ATTR = 'data-pplx-citation-url';

/** A source collected from one message's citations. */
interface CitationSource {
  number: number;
  title: string;
  /** True when the title came from aria-label (richer than pill text). */
  hasRichTitle: boolean;
}

/**
 * Resolve a human-readable title for a citation.
 *
 * Priority: aria-label (anchor variant carries the source title) →
 * pill text with the trailing "+N" counter stripped → URL hostname.
 */
function parseCitationTitle(citation: Element, url: string): { title: string; rich: boolean } {
  const ariaLabel = citation.querySelector('[aria-label]')?.getAttribute('aria-label')?.trim();
  if (ariaLabel) return { title: ariaLabel, rich: true };

  const pillText = (citation.textContent ?? '').replace(/\+\d+\s*$/, '').trim();
  if (pillText) return { title: pillText, rich: false };

  return { title: new URL(url).hostname, rich: false };
}

/**
 * Normalize a citation URL for use inside `[title](url)` markdown syntax:
 * the URL constructor percent-encodes spaces and other raw characters, and
 * parentheses are escaped manually (they are valid in URLs but terminate
 * the markdown link target).
 */
function toMarkdownSafeUrl(url: string): string {
  return new URL(url).href.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/**
 * Rewrite modern citation pills into footnote-ref placeholder spans,
 * deduping by URL. The same source cited twice reuses one footnote label;
 * labels are `m{messageIndex}-{n}` so they stay unique across messages.
 * When a later duplicate carries a richer aria-label title, it upgrades
 * the stored title.
 */
function collectCitationSources(doc: Document, messageIndex: number): Map<string, CitationSource> {
  const sources = new Map<string, CitationSource>();

  for (const citation of doc.querySelectorAll(SELECTORS.citation.join(', '))) {
    // Guard against nested matches detached by an earlier replacement
    if (!citation.isConnected) continue;

    const url = citation.getAttribute(CITATION_URL_ATTR) ?? '';
    if (!isHttpUrl(url)) {
      // No usable URL. Keep the pill only if it embeds a working anchor
      // (Turndown converts it to a markdown link); otherwise remove it so
      // its text is not glued to the prose.
      if (!citation.querySelector('a[href]')) {
        citation.remove();
      }
      continue;
    }

    const parsed = parseCitationTitle(citation, url);
    const existing = sources.get(url);
    if (!existing) {
      sources.set(url, {
        number: sources.size + 1,
        title: parsed.title,
        hasRichTitle: parsed.rich,
      });
    } else if (parsed.rich && !existing.hasRichTitle) {
      sources.set(url, { ...existing, title: parsed.title, hasRichTitle: true });
    }

    const number = sources.get(url)!.number;
    citation.replaceWith(createFootnoteRef(doc, `m${messageIndex}-${number}`));
  }

  return sources;
}

/**
 * Remove citation artifacts that cannot be converted to footnotes:
 *
 * - Legacy pills (observed before 2026-07): rendered WITHOUT a
 *   data-pplx-citation-url ancestor — the source URL genuinely does not
 *   exist in the static DOM. Modern pills were already replaced, so any
 *   remaining `.citation` element is legacy. Pills embedding a working
 *   <a href> are kept (Turndown converts them to markdown links).
 * - Empty `citation-nbsp` spacer spans (contribute no whitespace).
 */
function removeCitationResidue(doc: Document): void {
  for (const residue of doc.querySelectorAll(SELECTORS.legacyCitationPill.join(', '))) {
    if (!residue.isConnected) continue;
    if (residue.querySelector('a[href]') || residue.closest('a[href]')) continue;
    residue.remove();
  }

  for (const spacer of doc.querySelectorAll(SELECTORS.citationSpacer.join(', '))) {
    spacer.remove();
  }
}

function transformCitationsToFootnotes(
  html: string,
  messageIndex: number
): CitationTransformResult {
  const citationGroups = [
    SELECTORS.citation,
    SELECTORS.legacyCitationPill,
    SELECTORS.citationSpacer,
  ];

  return transformCitations(html, {
    hasCitations: doc => citationGroups.some(group => doc.querySelector(group.join(', '))),
    collectFootnotes: doc => {
      const sources = collectCitationSources(doc, messageIndex);
      removeCitationResidue(doc);

      return [...sources.entries()].map(
        ([url, source]) =>
          `[^m${messageIndex}-${source.number}]: ` +
          `[${escapeMarkdownLink(source.title)}](${toMarkdownSafeUrl(url)})`
      );
    },
  });
}

/** Tagged element for DOM-order sorting */
type TaggedElement =
  | { type: 'user'; element: HTMLElement }
  | { type: 'response'; element: HTMLElement }
  | { type: 'report'; element: HTMLElement };

/**
 * Perplexity conversation extractor
 *
 * Implements IConversationExtractor interface
 * @see src/lib/types.ts
 */
export class PerplexityExtractor extends BaseExtractor {
  readonly platform = 'perplexity';

  // ========== ID & Title Extraction ==========

  /**
   * Extract conversation ID from URL
   *
   * URL format: https://www.perplexity.ai/search/{slug}
   * @returns Full slug string or null if not found
   */
  getConversationId(): string | null {
    const match = window.location.pathname.match(/\/search\/([^/]+)$/);
    return match ? match[1] : null;
  }

  /**
   * Get conversation title
   *
   * Priority:
   * 1. document.title (via getPageTitle())
   * 2. First user query text (truncated to MAX_CONVERSATION_TITLE_LENGTH)
   * 3. Default title
   */
  getTitle(): string {
    const pageTitle = this.getPageTitle();
    if (pageTitle) return pageTitle;
    for (const element of this.queryAllSelectorUnion<HTMLElement>(USER_QUERY_ANY_LAYOUT)) {
      const title = this.extractPlainText(element);
      if (title) return title.substring(0, MAX_CONVERSATION_TITLE_LENGTH);
    }
    return 'Untitled Perplexity Conversation';
  }

  // ========== Message Extraction ==========

  /**
   * Extract all messages from conversation
   *
   * Strategy: Collect all content elements (user queries, responses, Deep Research
   * reports), sort them by DOM position, and build messages in document order.
   * This ensures multi-turn conversations with Deep Research maintain correct ordering.
   */
  extractMessages(): ConversationMessage[] {
    const tagged = this.collectTaggedElements();

    if (tagged.length === 0) {
      console.warn('[G2O] No conversation content found with primary selectors');
      return [];
    }

    // Sort by DOM position to preserve visual ordering
    const sorted = this.sortByDomPosition(tagged);

    const messages: ConversationMessage[] = [];
    let userIdx = 0;
    let responseIdx = 0;
    let reportIdx = 0;

    for (const item of sorted) {
      if (item.type === 'user') {
        const content = this.extractPlainText(item.element);
        if (content) {
          messages.push({
            id: `user-${userIdx}`,
            role: 'user',
            content,
            index: messages.length,
          });
        }
        userIdx++;
      } else if (item.type === 'report') {
        const content = this.extractReportContent(item.element, messages.length);
        if (content) {
          messages.push({
            id: `report-${reportIdx}`,
            role: 'assistant',
            content,
            htmlContent: content,
            index: messages.length,
          });
        }
        reportIdx++;
      } else {
        const content = this.extractAssistantContent(item.element, messages.length);
        if (content) {
          messages.push({
            id: `assistant-${responseIdx}`,
            role: 'assistant',
            content,
            htmlContent: content,
            index: messages.length,
          });
        }
        responseIdx++;
      }
    }

    return messages;
  }

  /**
   * Collect all content elements tagged by type for DOM-order sorting
   */
  private collectTaggedElements(): TaggedElement[] {
    const tagged: TaggedElement[] = [];

    for (const el of this.queryAllSelectorUnion<HTMLElement>(SELECTORS.userQuery)) {
      tagged.push({ type: 'user', element: el });
    }

    // Transitional markup can carry a legacy span inside the renderer-backed
    // query already collected above. Keep the old layout without duplicating it.
    for (const el of this.queryAllSelectorUnion<HTMLElement>(LEGACY_USER_QUERY)) {
      if (this.isInside(el, SELECTORS.userQuery)) continue;
      tagged.push({ type: 'user', element: el });
    }

    for (const el of this.queryAllSelectorUnion<HTMLElement>(LEGACY_MARKDOWN_CONTENT)) {
      tagged.push({ type: 'response', element: el });
    }

    // New answers render beside an empty placeholder, or without one at all.
    // Old-layout answers and a report's nested inline prose already have owners.
    for (const prose of this.queryAllSelectorUnion<HTMLElement>(SELECTORS.answerProse)) {
      if (this.isInside(prose, USER_QUERY_ANY_LAYOUT)) continue;
      if (this.isInside(prose, LEGACY_MARKDOWN_CONTENT)) continue;
      if (this.isInside(prose, DEEP_RESEARCH_PROSE)) continue;
      tagged.push({ type: 'response', element: prose });
    }

    for (const prose of this.queryAllSelectorUnion<HTMLElement>(DEEP_RESEARCH_PROSE)) {
      if (this.isInside(prose, USER_QUERY_ANY_LAYOUT)) continue;
      if (this.isInside(prose, LEGACY_MARKDOWN_CONTENT)) continue;
      tagged.push({ type: 'report', element: prose });
    }

    return tagged;
  }

  /** True when `el` matches or sits inside any of the given selectors. */
  private isInside(el: HTMLElement, selectors: readonly string[]): boolean {
    return selectors.some(selector => {
      try {
        return el.closest(selector) !== null;
      } catch {
        return false;
      }
    });
  }

  /** Collect every rollout selector once, collapse nested aliases, then restore DOM order. */
  private queryAllSelectorUnion<T extends Element>(
    selectors: readonly string[],
    parent: Element | Document = document
  ): T[] {
    const seen = new Set<Element>();
    const candidates: T[] = [];
    for (const selector of selectors) {
      for (const element of this.queryAllWithFallback<T>([selector], parent)) {
        if (seen.has(element)) continue;
        seen.add(element);
        candidates.push(element);
      }
    }
    const outermost = candidates.filter(candidate => {
      let ancestor = candidate.parentElement;
      while (ancestor) {
        if (seen.has(ancestor)) return false;
        if (ancestor === parent) break;
        ancestor = ancestor.parentElement;
      }
      return true;
    });
    return outermost.sort((left, right) => {
      if (left === right) return 0;
      const position = left.compareDocumentPosition(right);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  /** True when `el` itself matches one of the selectors. */
  private matchesAny(el: HTMLElement, selectors: readonly string[]): boolean {
    return selectors.some(selector => {
      try {
        return el.matches(selector);
      } catch {
        return false;
      }
    });
  }

  /**
   * Extract assistant response content (HTML for markdown conversion)
   *
   * Perplexity uses two layouts for `#markdown-content-N`:
   *   (1) Legacy: a single `.prose` child wraps the whole answer.
   *   (2) New: multiple sibling `.has-inline-images > div > .prose` blocks,
   *       one per section (observed around 2026-04). Using querySelector
   *       here dropped every block after the first, truncating the answer.
   *
   * Strategy: collect all `.prose` descendants and concatenate their innerHTML
   * in document order. querySelectorAll already returns DOM order, so a single
   * matching selector covers both layouts.
   *
   * Inline citations (both hover-trigger pills and anchor pills) carry their
   * source URL in data-pplx-citation-url (observed 2026-07-02, issue #291)
   * and are rewritten to footnote-ref placeholders BEFORE sanitization so the
   * URLs survive DOMPurify's data-* attribute stripping.
   *
   * All HTML is sanitized via DOMPurify to prevent XSS.
   */
  private extractAssistantContent(contentElement: HTMLElement, messageIndex: number): string {
    const ownsProseContent = this.matchesAny(contentElement, SELECTORS.proseContent);
    const proseEls = ownsProseContent
      ? []
      : this.queryAllSelectorUnion<HTMLElement>(SELECTORS.proseContent, contentElement);

    // Fallback: use the content element's innerHTML directly
    const rawHtml =
      ownsProseContent || proseEls.length === 0
        ? contentElement.innerHTML
        : proseEls.map(el => el.innerHTML).join('\n');

    if (!rawHtml) {
      return '';
    }

    return this.toSanitizedHtmlWithFootnotes(rawHtml, messageIndex);
  }

  /**
   * Extract Deep Research report content from its outer prose element
   *
   * Both inline cards and opened preview panels wrap the actual content in
   * max-w-none prose. Prefer the inner prose when present. Citations use the
   * same footnote transformation as normal answers.
   */
  private extractReportContent(reportProse: HTMLElement, messageIndex: number): string {
    const innerProse = this.queryWithFallback<HTMLElement>(SELECTORS.proseContent, reportProse);
    const targetEl = innerProse ?? reportProse;
    const content = this.toSanitizedHtmlWithFootnotes(targetEl.innerHTML, messageIndex);
    return content.trim() ? content : '';
  }

  /**
   * Convert raw response HTML to sanitized HTML with citation footnotes
   * appended as `<p data-footnote-def>` paragraphs.
   */
  private toSanitizedHtmlWithFootnotes(rawHtml: string, messageIndex: number): string {
    const { html, footnotes } = transformCitationsToFootnotes(rawHtml, messageIndex);
    return sanitizeHtml(html + footnoteDefsToHtml(footnotes));
  }
}
