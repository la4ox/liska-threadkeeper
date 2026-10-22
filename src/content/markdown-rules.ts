/**
 * Turndown HTML-to-Markdown engine with custom rules
 *
 * Configures Turndown with custom rules for code blocks, inline code,
 * footnote references, math expressions, and tables.
 */

import TurndownService from 'turndown';
import { MAX_LANG_HINT_LENGTH, MAX_MATH_LENGTH } from '../lib/constants';
import { markdownBlockquotePrefix } from '../archive/markdown-syntax';
import { markdownCodeFence } from './markdown-code';

/** Angle brackets, including backslash-escaped forms (`\<`, `\>`). */
const ANGLE_BRACKET_PATTERN = /\\[<>]|[<>]/g;
/**
 * Angle brackets plus `$`. Used for user text so pasted shell/YAML (`$VAR`,
 * `$$TMP`) is not parsed by Obsidian as `$...$` / `$$...$$` math — dozens of
 * stray `$` otherwise create giant "math" spans that blank the note and hang
 * the KaTeX/MathJax renderer.
 */
const ANGLE_BRACKET_DOLLAR_PATTERN = /\\[<>]|[<>$]/g;

interface CodeSpanRange {
  start: number;
  end: number;
}

interface BacktickRun {
  start: number;
  end: number;
  length: number;
  escaped: boolean;
}

interface FenceState {
  marker: '`' | '~';
  length: number;
  blockquoteDepth: number;
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

/** Find only complete code spans whose opening and closing runs have equal length. */
function inlineCodeRanges(text: string): CodeSpanRange[] {
  const runs: BacktickRun[] = [];
  for (let cursor = 0; cursor < text.length; ) {
    if (text[cursor] !== '`') {
      cursor += 1;
      continue;
    }
    let end = cursor + 1;
    while (text[end] === '`') end += 1;
    runs.push({ start: cursor, end, length: end - cursor, escaped: isEscaped(text, cursor) });
    cursor = end;
  }

  const indicesByLength = new Map<number, number[]>();
  runs.forEach((run, index) => {
    const indices = indicesByLength.get(run.length) ?? [];
    indices.push(index);
    indicesByLength.set(run.length, indices);
  });

  const nextRunOfLength = (length: number, afterIndex: number): number => {
    const indices = indicesByLength.get(length) ?? [];
    let low = 0;
    let high = indices.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (indices[middle] <= afterIndex) low = middle + 1;
      else high = middle;
    }
    return indices[low] ?? -1;
  };

  const openerFor = (run: BacktickRun): { start: number; length: number } | null => {
    if (!run.escaped) return { start: run.start, length: run.length };
    // Outside code, a backslash escapes only the first backtick in a run.
    return run.length > 1 ? { start: run.start + 1, length: run.length - 1 } : null;
  };

  const ranges: CodeSpanRange[] = [];
  for (let index = 0; index < runs.length; ) {
    const opener = openerFor(runs[index]);
    if (!opener) {
      index += 1;
      continue;
    }
    // Inside a code span backslashes are literal, so a physical run closes
    // only when its full length equals the opener length.
    const closingIndex = nextRunOfLength(opener.length, index);
    if (closingIndex < 0) {
      index += 1;
      continue;
    }
    ranges.push({ start: opener.start, end: runs[closingIndex].end });
    index = closingIndex + 1;
  }
  return ranges;
}

function escapeTextSegment(text: string, pattern: RegExp): string {
  return text.replace(pattern, match => {
    if (match.length === 2) {
      return '\\\\' + '\\' + match[1];
    }
    return '\\' + match;
  });
}

/** Escape special characters while preserving only complete inline code spans. */
function escapeSpecialCharsInLine(line: string, pattern: RegExp): string {
  const blockquote = markdownBlockquotePrefix(line);
  const prefix = line.slice(0, blockquote.length);
  const rest = line.slice(blockquote.length);
  const ranges = inlineCodeRanges(rest);
  let cursor = 0;
  let escaped = '';
  for (const range of ranges) {
    escaped += escapeTextSegment(rest.slice(cursor, range.start), pattern);
    escaped += rest.slice(range.start, range.end);
    cursor = range.end;
  }
  escaped += escapeTextSegment(rest.slice(cursor), pattern);
  return prefix + escaped;
}

function fenceMarker(
  line: string
): { marker: '`' | '~'; length: number; tail: string; blockquoteDepth: number } | null {
  const blockquote = markdownBlockquotePrefix(line);
  const stripped = line.slice(blockquote.length);
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(stripped);
  if (!match) return null;
  return {
    marker: match[1][0] as '`' | '~',
    length: match[1].length,
    tail: match[2],
    blockquoteDepth: blockquote.depth,
  };
}

/** Escape text outside complete, length-matched CommonMark fenced blocks. */
function escapeByLine(text: string, pattern: RegExp): string {
  const lines = text.split('\n');
  let fence: FenceState | null = null;

  const result = lines.map(line => {
    const marker = fenceMarker(line);
    const lineBlockquoteDepth = markdownBlockquotePrefix(line).depth;
    if (fence && fence.blockquoteDepth > 0 && lineBlockquoteDepth < fence.blockquoteDepth) {
      fence = null;
    }
    if (fence) {
      if (
        marker &&
        marker.marker === fence.marker &&
        marker.length >= fence.length &&
        marker.blockquoteDepth === fence.blockquoteDepth &&
        marker.tail.trim() === ''
      ) {
        fence = null;
      }
      return line;
    }
    if (marker && !(marker.marker === '`' && marker.tail.includes('`'))) {
      fence = {
        marker: marker.marker,
        length: marker.length,
        blockquoteDepth: marker.blockquoteDepth,
      };
      return line;
    }
    return escapeSpecialCharsInLine(line, pattern);
  });

  return result.join('\n');
}

/**
 * Escape angle brackets in Markdown text for safe Obsidian rendering.
 * Preserves brackets inside fenced code blocks, inline code, and
 * blockquote markers. Leaves `$` untouched so assistant KaTeX math survives.
 *
 * CommonMark §2.4: \< and \> are valid backslash escapes.
 */
export function escapeAngleBrackets(text: string): string {
  return escapeByLine(text, ANGLE_BRACKET_PATTERN);
}

/**
 * Escape user-message text for safe Obsidian rendering: angle brackets AND
 * `$`. User prompts are plain text that frequently contains pasted shell/YAML
 * `$`, which must not be interpreted as math. Fenced/inline code is preserved.
 */
export function escapeUserText(text: string): string {
  return escapeByLine(text, ANGLE_BRACKET_DOLLAR_PATTERN);
}

// ============================================================
// Turndown Configuration
// ============================================================

// Initialize Turndown with custom rules
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
});

// Custom rule for code blocks with language detection
turndown.addRule('codeBlocks', {
  filter: node => {
    return node.nodeName === 'PRE' && node.querySelector('code') !== null;
  },
  replacement: (content, node) => {
    const codeElement = (node as HTMLElement).querySelector('code');
    if (!codeElement) return content;

    // Try to detect language from class
    const className = codeElement.className || '';
    const langMatch = className.match(/language-(\w+)/);
    const lang = langMatch ? langMatch[1] : '';

    const code = codeElement.textContent || '';
    return `\n${markdownCodeFence(code.trim(), lang)}\n`;
  },
});

// Custom rule for ChatGPT CodeMirror code blocks (2026-03 DOM change)
// ChatGPT replaced <pre><code> with <pre> containing a CodeMirror editor (.cm-content)
// Code is in <span> elements with <br> for line breaks; header has language + Copy/Run buttons
turndown.addRule('codemirrorCodeBlocks', {
  filter: node => {
    return (
      node.nodeName === 'PRE' &&
      node.querySelector('code') === null &&
      node.querySelector('.cm-content') !== null
    );
  },
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const cmContent = el.querySelector('.cm-content');
    if (!cmContent) return _content;

    // Extract code: walk .cm-content children, <br> → newline
    let code = '';
    cmContent.childNodes.forEach(child => {
      if (child.nodeName === 'BR') {
        code += '\n';
      } else {
        code += child.textContent || '';
      }
    });

    // Extract language from header (text before cm-editor, not inside buttons)
    let lang = '';
    const buttons = el.querySelectorAll('button');
    const buttonTexts = new Set<string>();
    buttons.forEach(btn => {
      const text = btn.textContent?.trim();
      if (text) buttonTexts.add(text.toLowerCase());
    });

    // Find short text elements that aren't button text or code
    const allElements = el.querySelectorAll('div');
    for (const div of allElements) {
      if (cmContent.contains(div) || div.contains(cmContent)) continue;
      if (div.querySelector('button, .cm-content, .cm-editor')) continue;
      const text = div.textContent?.trim();
      if (text && text.length > 0 && text.length < MAX_LANG_HINT_LENGTH) {
        const lower = text.toLowerCase();
        if (!buttonTexts.has(lower)) {
          lang = lower;
          break;
        }
      }
    }

    return `\n${markdownCodeFence(code.trim(), lang)}\n`;
  },
});

/** Serialize inline code with a delimiter longer than every payload backtick run. */
function markdownInlineCode(content: string): string {
  if (!content) return '';
  const normalized = content.replace(/\r?\n|\r/g, ' ');
  const padding = /^`|^ .*?[^ ].* $|`$/.test(normalized) ? ' ' : '';
  let delimiter = '`';
  const runs: string[] = normalized.match(/`+/g) ?? [];
  while (runs.includes(delimiter)) delimiter += '`';
  return `${delimiter}${padding}${normalized}${padding}${delimiter}`;
}

// Custom rule for inline code
turndown.addRule('inlineCode', {
  filter: node => {
    return node.nodeName === 'CODE' && node.parentNode?.nodeName !== 'PRE';
  },
  replacement: content => {
    return markdownInlineCode(content);
  },
});

// Custom rule for image placeholders.
// Converts <img data-g2o-image="ID" alt="A"> to a stable placeholder link
// `![A](g2o-image://ID)`, resolved per output destination in the background
// (Obsidian embed, downloaded file, or stripped for clipboard). Emitted on its
// own paragraph so the image renders as a block, not inline with prose.
turndown.addRule('g2oImage', {
  filter: node => {
    return node.nodeName === 'IMG' && (node as HTMLElement).hasAttribute('data-g2o-image');
  },
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const id = el.getAttribute('data-g2o-image');
    if (!id) return '';
    const alt = el.getAttribute('alt') ?? '';
    return `\n\n![${alt}](g2o-image://${id})\n\n`;
  },
});

// Custom rule for footnote reference placeholders
// Converts <span data-footnote-ref="N">REF</span> to [^N]
turndown.addRule('footnoteRef', {
  filter: node => {
    return node.nodeName === 'SPAN' && (node as HTMLElement).hasAttribute('data-footnote-ref');
  },
  replacement: (_content, node) => {
    const index = (node as HTMLElement).getAttribute('data-footnote-ref');
    return `[^${index}]`;
  },
});

// Custom rule for footnote definitions (NotebookLM citations)
// Converts <p data-footnote-def>[^label]: title</p> to a literal footnote
// definition line. Bypasses Turndown's default text-escaping so the
// `[^label]:` syntax survives intact.
turndown.addRule('footnoteDef', {
  filter: node => {
    return node.nodeName === 'P' && (node as HTMLElement).hasAttribute('data-footnote-def');
  },
  replacement: (_content, node) => {
    const text = (node.textContent ?? '').trim();
    return text ? `\n\n${text}` : '';
  },
});

/**
 * Render a page-derived LaTeX value as Markdown math, or fall back to plain
 * text when the value would degrade or break Obsidian's math rendering:
 * - longer than {@link MAX_MATH_LENGTH} (malformed/abusive input), or
 * - contains a literal `$` (breaks the `$…$` / `$$…$$` delimiters).
 *
 * Multi-line LaTeX is left intact — real KaTeX inline formulas (e.g. matrices
 * with `\\` row breaks) legitimately span lines.
 *
 * On fallback, backslashes are escaped first, then `$` → `\$`, so the plain
 * text is not re-parsed as math (escaping the escape character prevents a
 * preceding `\` from pairing with the inserted one and re-opening a delimiter).
 */
function formatMath(latex: string, display: boolean): string {
  if (latex.length > MAX_MATH_LENGTH || latex.includes('$')) {
    const plain = latex.replace(/\\/g, '\\\\').replace(/\$/g, '\\$');
    return display ? `\n${plain}\n` : plain;
  }
  return display ? `\n$$\n${latex}\n$$\n` : `$${latex}$`;
}

// Custom rule for display math blocks (Gemini KaTeX: <div data-math="...">)
turndown.addRule('mathBlock', {
  filter: node => {
    return node.nodeName === 'DIV' && (node as HTMLElement).hasAttribute('data-math');
  },
  replacement: (_content, node) => {
    const latex = (node as HTMLElement).getAttribute('data-math');
    if (!latex) return _content;
    return formatMath(latex, true);
  },
});

// Custom rule for inline math (Gemini KaTeX: <span data-math="...">)
turndown.addRule('mathInline', {
  filter: node => {
    return (
      node.nodeName === 'SPAN' &&
      (node as HTMLElement).hasAttribute('data-math') &&
      !(node as HTMLElement).hasAttribute('data-footnote-ref')
    );
  },
  replacement: (_content, node) => {
    const latex = (node as HTMLElement).getAttribute('data-math');
    if (!latex) return _content;
    return formatMath(latex, false);
  },
});

// Extract a table cell's text. Cells are serialized via textContent (inline
// Turndown rules do not run inside the custom table rule), so footnote-ref
// placeholder spans must be converted to `[^label]` here or their marker
// text would leak into the cell verbatim.
function tableCellText(cell: Element): string {
  if (!cell.querySelector('[data-footnote-ref]')) {
    return cell.textContent?.trim() || '';
  }
  const clone = cell.cloneNode(true) as Element;
  clone.querySelectorAll('[data-footnote-ref]').forEach(ref => {
    const label = ref.getAttribute('data-footnote-ref');
    ref.replaceWith(label ? `[^${label}]` : '');
  });
  return clone.textContent?.trim() || '';
}

// Custom rule for tables
turndown.addRule('tables', {
  filter: 'table',
  replacement: (content, node) => {
    const table = node as HTMLTableElement;
    const rows: string[][] = [];

    // Extract headers
    const headerRow = table.querySelector('thead tr, tr:first-child');
    if (headerRow) {
      const headers: string[] = [];
      headerRow.querySelectorAll('th, td').forEach(cell => {
        headers.push(tableCellText(cell));
      });
      if (headers.length > 0) {
        rows.push(headers);
      }
    }

    // Extract body rows
    const bodyRows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
    bodyRows.forEach(row => {
      const cells: string[] = [];
      row.querySelectorAll('td, th').forEach(cell => {
        cells.push(tableCellText(cell));
      });
      if (cells.length > 0) {
        rows.push(cells);
      }
    });

    if (rows.length === 0) return '';

    // Build markdown table
    const lines: string[] = [];
    rows.forEach((row, index) => {
      lines.push('| ' + row.join(' | ') + ' |');
      if (index === 0) {
        // Add separator after header
        lines.push('| ' + row.map(() => '---').join(' | ') + ' |');
      }
    });

    return '\n' + lines.join('\n') + '\n';
  },
});

/**
 * Convert HTML content to Markdown without escaping angle brackets.
 *
 * Use this when the caller will apply {@link escapeAngleBrackets} later
 * (e.g. via {@link formatMessage} in markdown-formatting.ts), to avoid
 * double-escaping `<` and `>` characters.
 */
export function htmlToMarkdownRaw(html: string): string {
  // Clean up HTML before conversion
  const cleaned = html.replace(/<br\s*\/?>/gi, '\n').replace(/&nbsp;/g, ' ');

  return turndown.turndown(cleaned);
}

/**
 * Convert HTML content to Markdown with angle brackets escaped for safe
 * Obsidian rendering. Use this when the result is the final markdown and
 * no further escaping will be applied.
 */
export function htmlToMarkdown(html: string): string {
  return escapeAngleBrackets(htmlToMarkdownRaw(html));
}
