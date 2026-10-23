/**
 * Message formatting for Obsidian notes
 *
 * Formats conversation messages into Obsidian callout, blockquote,
 * or plain text format. Also handles tool-use content rendering.
 */

import { htmlToMarkdown, escapeAngleBrackets, escapeUserText } from './markdown-rules';
import { markdownCodeFence } from './markdown-code';
import { neutralizeActiveProviderMarkdown } from './markdown-safety';
import { PLATFORM_LABELS } from '../lib/constants';
import type { AIPlatform, TemplateOptions } from '../lib/types';
import { neutralizeMessageBoundaryMarkers } from '../lib/message-counter';

/**
 * Maximum visible length of an auto-generated question header (issue #187).
 * Includes the trailing ellipsis when truncation occurs.
 */
const QUESTION_HEADER_MAX_LENGTH = 60;

/**
 * Strip markdown-significant characters that could corrupt heading structure
 * if left unclosed after truncation (issue #203).
 *
 * Removes: backticks, asterisks, underscores, tildes, square brackets, and
 * `$` (so a pasted `$var` never renders as math inside the heading).
 * These are harmless to remove from a TOC header label.
 * @internal Exported for testing
 */
export function stripMarkdownChars(text: string): string {
  return text.replace(/[`*_~[\]$]/g, '');
}

function questionHeaderLine(label: string): string {
  const literal = label.replace(/[\\<>]/g, character => {
    if (character === '\\') return '&#92;';
    return character === '<' ? '&#60;' : '&#62;';
  });
  return `## ${literal}`;
}

/**
 * Build a `## ` header line from a user message for TOC navigation (issue #187).
 *
 * - Normalizes all whitespace (including newlines) to single spaces.
 * - Strips markdown-significant characters to prevent unclosed syntax (issue #203).
 * - Truncates to {@link QUESTION_HEADER_MAX_LENGTH} characters total, preferring
 *   word-boundary breaks past the halfway mark and appending an ellipsis.
 * - Returns an empty string for empty/whitespace-only content so callers can
 *   fall back to the unheaded format.
 *
 * @internal Exported for testing
 */
export function buildQuestionHeader(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  const cleaned = stripMarkdownChars(normalized).replace(/ {2,}/g, ' ').trim();
  if (!cleaned) return '';

  if (cleaned.length <= QUESTION_HEADER_MAX_LENGTH) {
    return questionHeaderLine(cleaned);
  }

  // Reserve one character for the ellipsis so total visible length stays within budget.
  const sliceEnd = QUESTION_HEADER_MAX_LENGTH - 1;
  const slice = cleaned.substring(0, sliceEnd);
  const lastSpace = slice.lastIndexOf(' ');
  const truncated = lastSpace > sliceEnd / 2 ? slice.substring(0, lastSpace) : slice;
  return questionHeaderLine(`${truncated}…`);
}

function messageMarkdown(
  content: string,
  role: 'user' | 'assistant',
  contentFormat: 'html' | 'markdown',
  trustedMarkdownDestinations: readonly string[]
): string {
  if (role === 'user') return neutralizeActiveProviderMarkdown(escapeUserText(content));
  return contentFormat === 'markdown'
    ? neutralizeActiveProviderMarkdown(escapeAngleBrackets(content), trustedMarkdownDestinations)
    : htmlToMarkdown(content);
}

/**
 * Format a single message according to template options
 */
export function formatMessage(
  content: string,
  role: 'user' | 'assistant',
  options: TemplateOptions,
  source: AIPlatform,
  contentFormat: 'html' | 'markdown' = 'html',
  trustedMarkdownDestinations: readonly string[] = []
): string {
  // Convert HTML to Markdown for assistant messages; escape angle brackets and
  // `$` (Obsidian math) for user messages, which are plain pasted text.
  const markdown = neutralizeMessageBoundaryMarkers(
    messageMarkdown(content, role, contentFormat, trustedMarkdownDestinations)
  );
  const assistantLabel = PLATFORM_LABELS[source];

  let formatted: string;
  switch (options.messageFormat) {
    case 'callout': {
      const calloutType = role === 'user' ? options.userCalloutType : options.assistantCalloutType;
      const label = role === 'user' ? 'User' : assistantLabel;
      // Format as Obsidian callout with proper line handling
      const lines = markdown.split('\n');
      const formattedLines = lines.map((line, i) =>
        i === 0 ? `> [!${calloutType}] ${label}\n> ${line}` : `> ${line}`
      );
      formatted = formattedLines.join('\n');
      break;
    }

    case 'blockquote': {
      const label = role === 'user' ? '**User:**' : `**${assistantLabel}:**`;
      const lines = markdown.split('\n').map(line => `> ${line}`);
      formatted = `${label}\n${lines.join('\n')}`;
      break;
    }

    case 'plain':
    default: {
      const label = role === 'user' ? '**User:**' : `**${assistantLabel}:**`;
      formatted = `${label}\n\n${markdown}`;
      break;
    }
  }

  // Optional: prepend `##` question header for user messages (issue #187).
  // Uses the raw (pre-escape) content for a more readable TOC entry.
  if (role === 'user' && options.includeQuestionHeaders) {
    const header = buildQuestionHeader(content);
    if (header) {
      formatted = `${header}\n\n${formatted}`;
    }
  }

  return formatted;
}

function trimOuterBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end);
}

function literalToolTitle(title: string): string {
  let literal = '';
  for (const character of title) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isAsciiPunctuation =
      (codePoint >= 0x21 && codePoint <= 0x2f) ||
      (codePoint >= 0x3a && codePoint <= 0x40) ||
      (codePoint >= 0x5b && codePoint <= 0x60) ||
      (codePoint >= 0x7b && codePoint <= 0x7e);
    literal += isAsciiPunctuation ? `&#${codePoint};` : character;
  }
  return literal;
}

function toolPresentation(toolContent: string): { title: string; fencedBody: string } {
  const lines = trimOuterBlankLines(toolContent.replace(/\r\n?|[\u2028\u2029]/g, '\n').split('\n'));
  const hasPromotedTitle = lines[0]?.startsWith('**') && lines[0]?.endsWith('**');
  const title = hasPromotedTitle ? lines[0].slice(2, -2).replace(/\s+/g, ' ').trim() : '';
  const bodyLines = trimOuterBlankLines(hasPromotedTitle ? lines.slice(1) : lines);
  const literalTitle = literalToolTitle(title);

  return {
    title: literalTitle ? `Tool Activity — ${literalTitle}` : 'Tool Activity',
    fencedBody:
      bodyLines.length > 0
        ? markdownCodeFence(neutralizeMessageBoundaryMarkers(bodyLines.join('\n')), 'text')
        : '',
  };
}

/**
 * Format tool-use content as a collapsible callout or equivalent format
 *
 * Renders tool content (web search, code interpreter) as a separate block
 * before the assistant response message.
 *
 * @param toolContent Raw tool content string (may contain bold summary, queries, results)
 * @param options Template options for format selection
 */
export function formatToolContent(toolContent: string, options: TemplateOptions): string {
  const { title, fencedBody } = toolPresentation(toolContent);

  switch (options.messageFormat) {
    case 'callout': {
      // Collapsible callout: [!ABSTRACT]- collapsed by default
      if (!fencedBody) {
        return `> [!ABSTRACT]- ${title}`;
      }
      const formatted = fencedBody.split('\n').map(line => `> ${line}`);
      return `> [!ABSTRACT]- ${title}\n${formatted.join('\n')}`;
    }

    case 'blockquote': {
      const header = `**${title}**`;
      const quoted = fencedBody ? fencedBody.split('\n').map(line => `> ${line}`) : [];
      return quoted.length > 0 ? `${header}\n${quoted.join('\n')}` : header;
    }

    case 'plain':
    default: {
      return fencedBody ? `**${title}**\n${fencedBody}` : `**${title}**`;
    }
  }
}
