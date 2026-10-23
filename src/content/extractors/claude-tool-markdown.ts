import { sanitizeHtml } from '../../lib/sanitize';
import { htmlToMarkdownRaw } from '../markdown-rules';
import { safeMarkdownLanguageHint } from '../markdown-code';

/** @internal Hard ceilings for one extraction, including repeated scroll-window work. */
export const CLAUDE_TOOL_LIMITS = Object.freeze({
  sectionHtmlBytes: 2 * 1024 ** 2,
  rawHtmlBytes: 16 * 1024 ** 2,
  sectionMarkupDelimiters: 20_000,
  markupDelimiters: 100_000,
  sections: 4096,
  codeBlocks: 4096,
  domNodes: 100_000,
  tableNestingDepth: 1,
  metadataEntries: 4096,
  orderedListSiblingWork: 2048 ** 2,
  structureWorkUnits: 64 * 1024 ** 2,
  markdownBytes: 32 * 1024 ** 2,
});

const encoder = new TextEncoder();
const STRUCTURE_LINE_WEIGHT = 16;

function limitExceeded(label: string): Error {
  // Never include provider text, markup, URLs, or exception details in this error.
  return new Error(`Claude tool conversion limit exceeded: ${label}.`);
}

function checkedTotal(current: number, increment: number, limit: number, label: string): number {
  if (!Number.isSafeInteger(increment) || increment < 0) {
    throw new Error('Invalid Claude tool conversion accounting.');
  }
  if (increment > limit - current) throw limitExceeded(label);
  return current + increment;
}

/** @internal Mutable operation-local accounting; never stored on an extractor. */
export class ClaudeToolConversionBudget {
  private rawHtmlBytes = 0;
  private markupDelimiters = 0;
  private sections = 0;
  private codeBlocks = 0;
  private domNodes = 0;
  private metadataEntries = 0;
  private orderedListSiblingWork = 0;
  private structureWorkUnits = 0;
  private markdownBytes = 0;

  /** Count every inspected header or converted fragment, even an empty one. */
  beginSection(rawHtml: string): number {
    this.sections = checkedTotal(this.sections, 1, CLAUDE_TOOL_LIMITS.sections, 'tool sections');
    return this.consumeHtml(rawHtml);
  }

  /**
   * Count input work, not unique source bytes. Header inspection and each HTML
   * conversion both consume input, including nested/overlapping fragments.
   */
  consumeHtml(rawHtml: string): number {
    // UTF-8 is at least as long as UTF-16 code units. Reject obvious excess
    // before allocating an encoded copy or letting sanitization parse the HTML.
    if (rawHtml.length > CLAUDE_TOOL_LIMITS.sectionHtmlBytes) {
      throw limitExceeded('section HTML bytes');
    }
    const remaining = CLAUDE_TOOL_LIMITS.rawHtmlBytes - this.rawHtmlBytes;
    if (rawHtml.length > remaining) throw limitExceeded('aggregate HTML bytes');
    const delimiters = countOccurrences(rawHtml, 60);
    if (delimiters > CLAUDE_TOOL_LIMITS.sectionMarkupDelimiters) {
      throw limitExceeded('section HTML markup delimiters');
    }
    this.markupDelimiters = checkedTotal(
      this.markupDelimiters,
      delimiters,
      CLAUDE_TOOL_LIMITS.markupDelimiters,
      'aggregate HTML markup delimiters'
    );
    const bytes = encoder.encode(rawHtml).byteLength;
    if (bytes > CLAUDE_TOOL_LIMITS.sectionHtmlBytes) throw limitExceeded('section HTML bytes');
    this.rawHtmlBytes = checkedTotal(
      this.rawHtmlBytes,
      bytes,
      CLAUDE_TOOL_LIMITS.rawHtmlBytes,
      'aggregate HTML bytes'
    );
    return bytes;
  }

  addCodeBlocks(count: number): void {
    this.codeBlocks = checkedTotal(
      this.codeBlocks,
      count,
      CLAUDE_TOOL_LIMITS.codeBlocks,
      'code blocks'
    );
  }

  addDomNodes(count: number): void {
    this.domNodes = checkedTotal(this.domNodes, count, CLAUDE_TOOL_LIMITS.domNodes, 'DOM nodes');
  }

  addMetadataEntries(count: number): void {
    this.metadataEntries = checkedTotal(
      this.metadataEntries,
      count,
      CLAUDE_TOOL_LIMITS.metadataEntries,
      'tool metadata entries'
    );
  }

  addOrderedListSiblingWork(work: number): void {
    this.orderedListSiblingWork = checkedTotal(
      this.orderedListSiblingWork,
      work,
      CLAUDE_TOOL_LIMITS.orderedListSiblingWork,
      'ordered-list sibling work'
    );
  }

  addStructureWorkUnits(units: number): void {
    this.structureWorkUnits = checkedTotal(
      this.structureWorkUnits,
      units,
      CLAUDE_TOOL_LIMITS.structureWorkUnits,
      'HTML structure work'
    );
  }

  addMarkdownBytes(bytes: number): void {
    this.markdownBytes = checkedTotal(
      this.markdownBytes,
      bytes,
      CLAUDE_TOOL_LIMITS.markdownBytes,
      'Markdown bytes'
    );
  }

  addMarkdown(markdown: string): void {
    if (markdown.length > CLAUDE_TOOL_LIMITS.markdownBytes - this.markdownBytes) {
      throw limitExceeded('Markdown bytes');
    }
    this.addMarkdownBytes(encoder.encode(markdown).byteLength);
  }
}

function countOccurrences(value: string, charCode: number): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === charCode) count += 1;
  }
  return count;
}

function countLineBreaks(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029) count += 1;
  }
  return count;
}

interface DomWorkFrame {
  readonly node: Node;
  readonly depth: number;
  readonly tableDepth: number;
}

function pushChildren(stack: DomWorkFrame[], node: Node, depth: number, tableDepth: number): void {
  for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
    stack.push({ node: node.childNodes[index], depth: depth + 1, tableDepth });
  }
}

function nodeLineUnits(node: Node, element: Element | null): number {
  if (node.nodeType === 3) return 1 + countLineBreaks(node.nodeValue ?? '');
  if (!element) return 0;
  let units = 4;
  for (let index = 0; index < element.attributes.length; index += 1) {
    units += 1 + countLineBreaks(element.attributes[index].value);
  }
  return units;
}

function orderedListSiblingWork(element: Element | null): number {
  if (element?.tagName !== 'OL') return 0;
  let listItems = 0;
  for (let index = 0; index < element.children.length; index += 1) {
    if (element.children[index].tagName === 'LI') listItems += 1;
  }
  const work = listItems * element.children.length;
  if (!Number.isSafeInteger(work)) throw limitExceeded('ordered-list sibling work');
  return work;
}

function structureWorkTotal(rawHtmlBytes: number, lineUnits: number, maxDepth: number): number {
  const weightedLines = lineUnits * maxDepth * STRUCTURE_LINE_WEIGHT;
  const ancestorCopies = rawHtmlBytes * maxDepth;
  const total = rawHtmlBytes + ancestorCopies + weightedLines;
  if (
    !Number.isSafeInteger(weightedLines) ||
    !Number.isSafeInteger(ancestorCopies) ||
    !Number.isSafeInteger(total)
  ) {
    throw limitExceeded('HTML structure work');
  }
  return total;
}

/**
 * Bound ancestor-sensitive Turndown expansion before it allocates the output.
 *
 * Blockquotes prefix each generated line; nested list items indent every line.
 * Raw bytes alone therefore do not bound conversion work. The complete input
 * is charged once per ancestor because Turndown materializes parent content;
 * each text/attribute line and a conservative four line-boundary units per
 * element are weighted by the deepest container. Attributes matter because
 * custom rules such as `data-math` can promote decoded line breaks into
 * Markdown. Nested tables are rejected separately because the custom table
 * rule performs descendant selector scans and duplicates cell text. The metric
 * intentionally overestimates ordinary markup.
 */
function chargeDomStructure(
  container: HTMLElement,
  rawHtmlBytes: number,
  budget: ClaudeToolConversionBudget
): void {
  const stack: DomWorkFrame[] = [];
  pushChildren(stack, container, 0, 0);
  let maxDepth = 0;
  let lineUnits = 0;

  while (stack.length > 0) {
    const { node, depth, tableDepth: parentTableDepth } = stack.pop()!;
    budget.addDomNodes(1);
    maxDepth = Math.max(maxDepth, depth);
    const element = node.nodeType === 1 ? (node as Element) : null;
    const tableDepth = parentTableDepth + (element?.tagName === 'TABLE' ? 1 : 0);
    if (tableDepth > CLAUDE_TOOL_LIMITS.tableNestingDepth) {
      throw limitExceeded('nested table depth');
    }
    lineUnits += nodeLineUnits(node, element);
    if (!Number.isSafeInteger(lineUnits)) throw limitExceeded('HTML structure work');
    const siblingWork = orderedListSiblingWork(element);
    if (siblingWork > 0) budget.addOrderedListSiblingWork(siblingWork);
    pushChildren(stack, node, depth, tableDepth);
  }

  budget.addStructureWorkUnits(structureWorkTotal(rawHtmlBytes, lineUnits, maxDepth));
}

/** Append a final tool part, counting its separator and its bytes exactly once. */
export function appendClaudeToolPart(
  parts: string[],
  part: string,
  budget: ClaudeToolConversionBudget,
  alreadyCounted = false
): void {
  if (!part) return;
  if (parts.length > 0) budget.addMarkdownBytes(2);
  if (!alreadyCounted) budget.addMarkdown(part);
  parts.push(part);
}

function whitespacePreservingCodeFence(
  content: string,
  language: string,
  budget: ClaudeToolConversionBudget
): string {
  let longestRun = 0;
  for (const match of content.matchAll(/`+/g)) {
    longestRun = Math.max(longestRun, match[0].length);
  }
  const fenceLength = Math.max(3, longestRun + 1);
  const hint = safeMarkdownLanguageHint(language);
  const closingSeparator = content.endsWith('\n') ? '' : '\n';
  // Reserve generated output before allocating potentially long fence strings.
  budget.addMarkdownBytes(
    encoder.encode(content).byteLength + 2 * fenceLength + hint.length + 1 + closingSeparator.length
  );
  const fence = '`'.repeat(fenceLength);
  return `${fence}${hint}\n${content}${closingSeparator}${fence}`;
}

/** @internal HTML is sanitized before a fresh, conversion-scoped capability is generated. */
export function claudeToolHtmlToMarkdown(
  rawHtml: string,
  budget: ClaudeToolConversionBudget
): string {
  const rawHtmlBytes = budget.beginSection(rawHtml);
  const container = document.createElement('div');
  container.innerHTML = sanitizeHtml(rawHtml);

  // Provider HTML is now fixed in a detached tree. A 128-bit isolated-world
  // capability makes placeholders unforgeable without any full-source scans.
  const random = new Uint8Array(16);
  globalThis.crypto.getRandomValues(random);
  const token = Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('');
  const prefix = `\uE000LISKATOOLCODE${token}:`;
  const replacements: string[] = [];
  const pres = container.querySelectorAll('pre');
  // Count every pre candidate, even one without code, before subtree queries.
  budget.addCodeBlocks(pres.length);
  for (const pre of pres) {
    const code = pre.querySelector('code');
    if (!code) continue;
    const language = code.className.match(/language-(\w+)/)?.[1] ?? '';
    const marker = `${prefix}${replacements.length}\uE001`;
    replacements.push(whitespacePreservingCodeFence(code.textContent ?? '', language, budget));
    const placeholder = document.createElement('div');
    placeholder.textContent = marker;
    pre.replaceWith(placeholder);
  }

  chargeDomStructure(container, rawHtmlBytes, budget);

  const markdown = htmlToMarkdownRaw(container.innerHTML).trim();
  let end = 0;
  let restored = 0;
  // Exactly one restoration pass: the callback returns literal strings, so
  // replacement tokens and marker-like text inside code are never reinterpreted.
  const result = markdown.replace(
    new RegExp(`${prefix}(\\d+)\uE001`, 'g'),
    (marker: string, index: string, offset: number) => {
      const replacement = replacements[Number(index)];
      if (replacement === undefined || Number(index) !== restored) {
        throw new Error('Claude tool conversion failed: code markers.');
      }
      budget.addMarkdown(markdown.slice(end, offset));
      end = offset + marker.length;
      restored += 1;
      return replacement;
    }
  );
  budget.addMarkdown(markdown.slice(end));
  if (restored !== replacements.length) {
    throw new Error('Claude tool conversion failed: code markers.');
  }
  return result;
}
