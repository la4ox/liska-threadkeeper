/**
 * Shared footnote-placeholder helpers for citation transforms
 *
 * Platform extractors (NotebookLM, Perplexity) rewrite their inline citation
 * DOM into placeholder elements BEFORE sanitization:
 *   - <span data-footnote-ref="label">REF</span>   → `[^label]`   (footnoteRef rule)
 *   - <p data-footnote-def>[^label]: title</p>     → literal line (footnoteDef rule)
 * Both attributes are allow-listed in sanitizeHtml() and converted to Obsidian
 * footnote syntax by the Turndown rules in markdown-rules.ts.
 */

import { isHttpUrl } from '../../lib/validation';
import {
  FOOTNOTE_DEF_ATTR,
  FOOTNOTE_PROVENANCE_TOKEN,
  FOOTNOTE_REF_ATTR,
  FOOTNOTE_TOKEN_ATTR,
  isValidFootnoteLabel,
  markTrustedFootnote,
} from '../../lib/footnote-contract';

export interface CitationTransformResult {
  /** HTML with citation elements replaced by footnote-ref placeholder spans. */
  html: string;
  /** Per-message footnote definition lines (`[^label]: title`), deduped. */
  footnotes: string[];
}

/**
 * Platform hooks for {@link transformCitations}.
 * The skeleton owns parsing and serialization; hooks own the DOM specifics.
 */
export interface CitationTransformHooks {
  /** True when the parsed document contains citations worth transforming. */
  hasCitations(doc: Document): boolean;
  /**
   * Replace citation nodes with footnote-ref placeholders (mutating `doc`)
   * and return the deduped footnote definition lines.
   */
  collectFootnotes(doc: Document): string[];
}

/**
 * Shared citation→footnote transform skeleton (parse → detect → transform →
 * serialize). Platform DOM shapes differ (NotebookLM buttons vs Perplexity
 * pills), but the surrounding lifecycle is identical — a fix to it applies
 * to every platform at once.
 */
export function transformCitations(
  html: string,
  hooks: CitationTransformHooks
): CitationTransformResult {
  if (!html) {
    return { html, footnotes: [] };
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Return the original string untouched when there is nothing to transform,
  // avoiding parse→serialize normalization differences for plain messages.
  if (!hooks.hasCitations(doc)) {
    return { html, footnotes: [] };
  }

  const footnotes = hooks.collectFootnotes(doc);
  return { html: doc.body.innerHTML, footnotes };
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => HTML_ESCAPE_MAP[ch] ?? ch);
}

/**
 * Encode an untrusted citation title as one literal Markdown line.
 * Newlines cannot create another footnote, backticks cannot open code spans,
 * and angle brackets remain entities instead of becoming raw HTML.
 */
export function escapeMarkdownLink(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[<>]/g, character => (character === '<' ? '&lt;' : '&gt;'))
    .replace(/[\\[\]()`]/g, '\\$&');
}

/**
 * Create a footnote-ref placeholder span for the given label.
 *
 * The non-empty 'REF' text is required — Turndown skips empty inline
 * elements, so an empty span would never reach the footnoteRef rule.
 */
export function createFootnoteRef(doc: Document, label: string): HTMLSpanElement {
  const placeholder = doc.createElement('span');
  if (!isValidFootnoteLabel(label)) return placeholder;
  placeholder.setAttribute(FOOTNOTE_REF_ATTR, label);
  markTrustedFootnote(placeholder);
  placeholder.textContent = 'REF';
  return placeholder;
}

/** HTML form for regex-based Deep Research citation replacement. */
export function footnoteRefToHtml(label: string): string {
  if (!isValidFootnoteLabel(label)) return '';
  return `<span ${FOOTNOTE_REF_ATTR}="${label}" ${FOOTNOTE_TOKEN_ATTR}="${FOOTNOTE_PROVENANCE_TOKEN}">REF</span>`;
}

/**
 * Wrap footnote definition lines in `<p data-footnote-def>` paragraphs so the
 * footnoteDef Turndown rule emits them as literal `[^label]: title` lines.
 */
export function footnoteDefsToHtml(footnotes: string[]): string {
  return footnotes
    .filter(line => {
      const match = /^\[\^([^\]]+)\]:(?:\s|$)/.exec(line);
      return match !== null && isValidFootnoteLabel(match[1]);
    })
    .map(
      line =>
        `<p ${FOOTNOTE_DEF_ATTR}="" ${FOOTNOTE_TOKEN_ATTR}="${FOOTNOTE_PROVENANCE_TOKEN}">${escapeHtml(line)}</p>`
    )
    .join('');
}

/** Canonical HTTP(S) URL serialized as one Markdown link destination. */
export function toMarkdownSafeHttpUrl(value: string): string {
  const trimmed = value.trim();
  if (!isHttpUrl(trimmed)) return '';
  return new URL(trimmed).href.replace(/\\/g, '%5C').replace(/\(/g, '%28').replace(/\)/g, '%29');
}
