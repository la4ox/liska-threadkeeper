import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Definition, Nodes, Parent, Root } from 'mdast';
import { escapeHtml, fail, hasOwn, isSafeUserLink, type PresentationContext } from './safety';

const PARENT_TAGS = {
  paragraph: 'p',
  emphasis: 'em',
  strong: 'strong',
  blockquote: 'blockquote',
  listItem: 'li',
} as const;

function collectDefinitions(root: Root, context: PresentationContext): Map<string, Definition> {
  const definitions = new Map<string, Definition>();
  const pending: { node: Nodes; depth: number }[] = [{ node: root, depth: 0 }];
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    context.markdownNode(depth);
    if (node.type === 'definition' && !definitions.has(node.identifier))
      definitions.set(node.identifier, node);
    if ('children' in node) {
      for (let index = node.children.length - 1; index >= 0; index--)
        pending.push({ node: node.children[index], depth: depth + 1 });
    }
  }
  return definitions;
}

class MarkdownRenderer {
  constructor(
    readonly source: string,
    readonly context: PresentationContext,
    readonly parts: string[],
    readonly definitions: Map<string, Definition>
  ) {}

  emit(value: string): void {
    this.context.emit(this.parts, value);
  }
  text(value: string): void {
    this.emit(escapeHtml(value));
  }
  children(node: Parent): void {
    for (const child of node.children) this.node(child);
  }
  container(node: Parent, open: string, close: string): void {
    this.emit(open);
    this.children(node);
    this.emit(close);
  }

  link(url: string, node: Parent): void {
    if (isSafeUserLink(url)) {
      this.container(
        node,
        `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">`,
        '</a>'
      );
    } else {
      this.context.diagnostic('unsafe-link-inert');
      this.emit('<span class="inert-link">');
      this.children(node);
      this.text(` [Link: ${url}]`);
      this.emit('</span>');
    }
  }

  image(alt: string | null | undefined, url: string): void {
    this.context.diagnostic('markdown-image-reference');
    this.emit('<span class="placeholder">');
    this.text(`[Image reference: ${alt ?? ''}; ${url}]`);
    this.emit('</span>');
  }

  reference(
    node: Extract<Nodes, { type: 'linkReference' | 'imageReference' | 'definition' }>
  ): void {
    if (node.type === 'definition') {
      this.context.diagnostic('markdown-reference-definition');
      this.emit('<p class="placeholder">');
      this.text(`[Link definition: ${node.label ?? node.identifier}; ${node.url}]`);
      this.emit('</p>');
      return;
    }
    const definition = this.definitions.get(node.identifier);
    if (node.type === 'imageReference') {
      if (!definition) this.context.diagnostic('markdown-reference-unresolved');
      this.image(node.alt, definition?.url ?? '[unresolved]');
    } else if (definition) {
      this.link(definition.url, node);
    } else {
      this.context.diagnostic('markdown-reference-unresolved');
      this.container(node, '<span class="placeholder">[Unresolved link reference: ', ']</span>');
    }
  }

  literal(node: Extract<Nodes, { type: 'text' | 'inlineCode' | 'code' | 'html' }>): void {
    if (node.type === 'html') {
      this.context.diagnostic('provider-html-inert');
      this.emit('<span class="inert-html" aria-label="Inert provider HTML source">');
      this.text(node.value);
      this.emit('</span>');
    } else {
      const open =
        node.type === 'code' ? '<pre><code>' : node.type === 'inlineCode' ? '<code>' : '';
      const close =
        node.type === 'code' ? '</code></pre>' : node.type === 'inlineCode' ? '</code>' : '';
      this.emit(open);
      this.text(node.value);
      this.emit(close);
    }
  }

  unsupported(node: Nodes): void {
    // Future nodes retain exact source rather than silently vanishing.
    this.context.diagnostic('markdown-node-unsupported');
    const position = node.position;
    this.emit('<pre class="placeholder">[Unsupported Markdown structure]\n');
    this.text(
      position?.start.offset !== undefined && position.end.offset !== undefined
        ? this.source.slice(position.start.offset, position.end.offset)
        : this.source
    );
    this.emit('</pre>');
  }

  node(node: Nodes): void {
    if (hasOwn(PARENT_TAGS, node.type) && 'children' in node) {
      const tag = PARENT_TAGS[node.type as keyof typeof PARENT_TAGS];
      this.container(node, `<${tag}>`, `</${tag}>`);
    } else if (
      node.type === 'text' ||
      node.type === 'inlineCode' ||
      node.type === 'code' ||
      node.type === 'html'
    ) {
      this.literal(node);
    } else {
      this.structure(node);
    }
  }

  structure(node: Nodes): void {
    switch (node.type) {
      case 'root':
        this.children(node);
        break;
      case 'heading':
        this.container(node, `<h${node.depth}>`, `</h${node.depth}>`);
        break;
      case 'list': {
        const tag = node.ordered ? 'ol' : 'ul';
        const start =
          node.ordered && typeof node.start === 'number' && Number.isSafeInteger(node.start)
            ? ` start="${node.start}"`
            : '';
        this.container(node, `<${tag}${start}>`, `</${tag}>`);
        break;
      }
      case 'break':
        this.emit('<br>');
        break;
      case 'thematicBreak':
        this.emit('<hr>');
        break;
      case 'link':
        this.link(node.url, node);
        break;
      case 'image':
        this.image(node.alt, node.url);
        break;
      case 'linkReference':
      case 'imageReference':
      case 'definition':
        this.reference(node);
        break;
      default:
        this.unsupported(node);
    }
  }
}

interface MarkdownFence {
  marker: '`' | '~';
  length: number;
}

function fenceAt(line: string, existing: MarkdownFence | undefined): MarkdownFence | undefined {
  let cursor = 0;
  while (cursor < line.length && cursor < 4 && line[cursor] === ' ') cursor += 1;
  if (cursor > 3) return existing;
  const marker = line[cursor];
  if (marker !== '`' && marker !== '~') return existing;
  let end = cursor;
  while (line[end] === marker) end += 1;
  const length = end - cursor;
  if (length < 3) return existing;
  if (!existing) {
    // CommonMark forbids a backtick in a backtick fence's info string.
    if (marker === '`' && line.slice(end).includes('`')) return existing;
    return { marker, length };
  }
  if (existing.marker !== marker || length < existing.length || !/^[ \t]*$/.test(line.slice(end)))
    return existing;
  return undefined;
}

function listMarkerEnd(line: string, cursor: number): number | undefined {
  const marker = line[cursor];
  let end = cursor;
  if (marker === '-' || marker === '+' || marker === '*') {
    end += 1;
  } else {
    while (end < line.length && end - cursor < 9 && /\d/.test(line[end])) end += 1;
    if (end === cursor || (line[end] !== '.' && line[end] !== ')')) return undefined;
    end += 1;
  }
  if (end < line.length && line[end] !== ' ' && line[end] !== '\t') return undefined;
  if (line[end] === ' ' || line[end] === '\t') end += 1;
  return end;
}

function markdownContainerDepth(line: string, stopAfter: number): number {
  let cursor = 0;
  let depth = 0;
  while (cursor < line.length) {
    let spaces = 0;
    while (spaces < 4 && line[cursor] === ' ') {
      spaces += 1;
      cursor += 1;
    }
    if (spaces > 3) break;
    if (line[cursor] === '>') {
      cursor += 1;
      if (line[cursor] === ' ' || line[cursor] === '\t') cursor += 1;
    } else {
      const markerEnd = listMarkerEnd(line, cursor);
      if (markerEnd === undefined) break;
      cursor = markerEnd;
    }
    depth += 1;
    if (depth > stopAfter) break;
  }
  return depth;
}

function markdownLineAt(source: string, start: number): { line: string; nextStart: number | null } {
  let end = start;
  while (end < source.length && source[end] !== '\n' && source[end] !== '\r') end += 1;
  if (end === source.length) return { line: source.slice(start), nextStart: null };
  const nextStart = source[end] === '\r' && source[end + 1] === '\n' ? end + 2 : end + 1;
  return { line: source.slice(start, end), nextStart };
}

/**
 * Refuse obvious pathological blockquote nesting before micromark constructs
 * an AST. The full AST budgets still validate every accepted tree afterward.
 */
function preflightMarkdownNesting(source: string, context: PresentationContext): void {
  let lineStart = 0;
  let fence: MarkdownFence | undefined;
  while (true) {
    const { line, nextStart } = markdownLineAt(source, lineStart);
    const scanLimit = fence
      ? context.limits.maxMarkdownContainerRun
      : Math.min(context.limits.maxMarkdownDepth, context.limits.maxMarkdownContainerRun);
    const containerDepth = markdownContainerDepth(line, scanLimit);
    context.markdownContainers(containerDepth);
    if (!fence && containerDepth > context.limits.maxMarkdownDepth)
      fail('html-markdown-depth-limit');
    if (containerDepth > context.limits.maxMarkdownContainerRun)
      fail('html-markdown-container-limit');
    const nextFence = fenceAt(line, fence);
    if (nextFence !== fence) {
      fence = nextFence;
    }
    if (nextStart === null) break;
    lineStart = nextStart;
  }
}

/** Render a strict CommonMark allowlist; no provider HTML or image URL is loaded. */
export function renderSafeMarkdown(
  source: string,
  context: PresentationContext,
  parts: string[]
): void {
  if (source.length > context.limits.maxMarkdownChars) fail('html-markdown-char-limit');
  preflightMarkdownNesting(source, context);
  let root: Root;
  try {
    root = fromMarkdown(source);
  } catch {
    fail('html-markdown-invalid');
  }
  const definitions = collectDefinitions(root, context);
  new MarkdownRenderer(source, context, parts, definitions).node(root);
}
