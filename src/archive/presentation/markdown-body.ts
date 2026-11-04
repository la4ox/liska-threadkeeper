import type { Definition, Nodes, Parent } from 'mdast';
import type { ArchiveBlock, ArchiveMessage } from '../types';
import { parseBoundedMarkdown } from './markdown';
import { isSafeUserLink, type PresentationContext } from './safety';
import { presentationFail } from './preview-safety';

/** Escape source data, not Markdown structure. No metadata can open HTML or Markdown syntax. */
export function markdownLiteral(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]{}()#+.!|~$-]/g, '\\$&');
}
function longestRun(value: string, marker: string): number {
  let longest = 0;
  let run = 0;
  for (const char of value) {
    run = char === marker ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}
export function markdownFence(value: string, language: string | null = null): string {
  const ticks = Math.max(3, longestRun(value, '`') + 1);
  const tildes = Math.max(3, longestRun(value, '~') + 1);
  const fence = ticks <= tildes ? '`'.repeat(ticks) : '~'.repeat(tildes);
  const hint = language !== null && /^[a-zA-Z0-9_+.-]{1,64}$/.test(language) ? language : '';
  const separator = value.endsWith('\r') ? '\r\n' : '\n';
  return `${fence}${hint}\n${value}${separator}${fence}`;
}
function quote(value: string): string {
  return '> ' + value.replace(/\r\n|\r|\n/g, lineEnding => `${lineEnding}> `);
}
function destination(value: string): string {
  return `<${value.replace(/&/g, '&amp;').replace(/</g, '%3C').replace(/>/g, '%3E')}>`;
}

/** New Markdown SOURCE renderer. The HTML Markdown renderer is used only for its bounded parser. */
class MarkdownSourceRenderer {
  readonly definitions = new Map<string, Definition>();
  constructor(
    readonly source: string,
    readonly context: PresentationContext
  ) {}

  children(node: Parent, separator = '', encodeTextNewlines = false): string {
    return node.children
      .map((child, index) => this.child(node, child, index, separator, encodeTextNewlines))
      .join(separator);
  }
  child(
    node: Parent,
    child: Nodes,
    index: number,
    separator: string,
    encodeTextNewlines: boolean
  ): string {
    if (separator !== '' || child.type !== 'text') return this.node(child, encodeTextNewlines);
    return this.text(
      child.value,
      this.textBoundaryStart(node, index, child.value, encodeTextNewlines),
      this.textBoundaryEnd(node, index, child.value, encodeTextNewlines),
      encodeTextNewlines
    );
  }
  protectedBoundaryParent(node: Parent): boolean {
    return (
      node.type === 'paragraph' ||
      node.type === 'strong' ||
      node.type === 'emphasis' ||
      node.type === 'heading'
    );
  }
  textBoundaryStart(
    node: Parent,
    index: number,
    value: string,
    encodeTextNewlines: boolean
  ): boolean {
    const previous = node.children[index - 1];
    return (
      this.hasEmphasisMarker(previous) ||
      (encodeTextNewlines && previous?.type === 'break' && this.boundaryWhitespace(value, true)) ||
      (this.protectedBoundaryParent(node) && index === 0 && this.boundaryWhitespace(value, true))
    );
  }
  textBoundaryEnd(
    node: Parent,
    index: number,
    value: string,
    encodeTextNewlines: boolean
  ): boolean {
    const next = node.children[index + 1];
    return (
      this.hasEmphasisMarker(next) ||
      (encodeTextNewlines && next?.type === 'break' && this.boundaryWhitespace(value, false)) ||
      (this.protectedBoundaryParent(node) &&
        index === node.children.length - 1 &&
        this.boundaryWhitespace(value, false))
    );
  }
  emphasisMarker(node: Extract<Nodes, { type: 'strong' | 'emphasis' }>): string {
    const width = node.type === 'strong' ? 2 : 1;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined || end - start < width * 2)
      presentationFail('presentation-markdown-invalid');
    const opening = this.source.slice(start, start + width);
    const closing = this.source.slice(end - width, end);
    if (opening !== closing || (opening !== '*'.repeat(width) && opening !== '_'.repeat(width)))
      presentationFail('presentation-markdown-invalid');
    return opening;
  }
  hasEmphasisMarker(node: Nodes | undefined): boolean {
    return node?.type === 'strong' || node?.type === 'emphasis';
  }
  boundaryWhitespace(value: string, start: boolean): boolean {
    const characters = Array.from(value);
    const character = start ? characters[0] : characters[characters.length - 1];
    return character !== undefined && /\p{White_Space}/u.test(character);
  }
  numericReferencePreservesIdentity(code: number): boolean {
    const low = code % 0x1_0000;
    return !(
      code < 0x09 ||
      code === 0x0b ||
      (code > 0x0d && code < 0x20) ||
      (code > 0x7e && code < 0xa0) ||
      (code > 0xd7ff && code < 0xe000) ||
      (code > 0xfdcf && code < 0xfdf0) ||
      low === 0xfffe ||
      low === 0xffff ||
      code > 0x10_ffff
    );
  }
  characterReference(character: string): string {
    const code = character.codePointAt(0)!;
    if (!this.numericReferencePreservesIdentity(code)) return character;
    return `&#x${code.toString(16).toUpperCase()};`;
  }
  literalText(value: string): string {
    let result = '';
    let literal = '';
    for (const character of value) {
      if (character !== ' ' && /\p{White_Space}/u.test(character)) {
        result += markdownLiteral(literal) + this.characterReference(character);
        literal = '';
      } else literal += character;
    }
    return result + markdownLiteral(literal);
  }
  encodedNewlines(value: string, enabled: boolean): string {
    return enabled ? value.replace(/\n/g, '&#xA;') : value;
  }
  text(value: string, encodeStart = false, encodeEnd = false, encodeNewlines = false): string {
    const characters = Array.from(value);
    let start = 0;
    let end = characters.length;
    let prefix = '';
    let suffix = '';
    if (encodeStart && start < end) {
      prefix = this.characterReference(characters[start]);
      start++;
    }
    if (encodeEnd && start < end) {
      end--;
      suffix = this.characterReference(characters[end]);
    }
    return this.encodedNewlines(
      prefix + this.literalText(characters.slice(start, end).join('')) + suffix,
      encodeNewlines
    );
  }
  literal(value: string, encodeNewlines = false): string {
    return this.text(
      value,
      this.boundaryWhitespace(value, true),
      this.boundaryWhitespace(value, false),
      encodeNewlines
    );
  }
  link(url: string, label: string, encodeNewlines = false): string {
    if (isSafeUserLink(url)) return `[${label}](${destination(url)})`;
    this.context.diagnostic('unsafe-link-inert');
    return `${label} ${this.literal(`[Link: ${url}]`, encodeNewlines)}`;
  }
  image(alt: string | null | undefined, url: string, encodeNewlines = false): string {
    this.context.diagnostic('markdown-image-reference');
    return this.literal(`[Image reference: ${alt ?? ''}; ${url}]`, encodeNewlines);
  }
  reference(
    node: Extract<Nodes, { type: 'linkReference' | 'imageReference' | 'definition' }>,
    encodeNewlines = false
  ): string {
    if (node.type === 'definition') {
      this.context.diagnostic('markdown-reference-definition');
      return this.literal(`[Link definition: ${node.label ?? node.identifier}; ${node.url}]`);
    }
    const definition = this.definitions.get(node.identifier);
    if (!definition) this.context.diagnostic('markdown-reference-unresolved');
    if (node.type === 'imageReference')
      return this.image(node.alt, definition?.url ?? '[unresolved]', encodeNewlines);
    return definition
      ? this.link(definition.url, this.children(node, '', encodeNewlines), encodeNewlines)
      : this.literal(
          `[Unresolved link reference: ${node.label ?? node.identifier}]`,
          encodeNewlines
        );
  }
  list(node: Extract<Nodes, { type: 'list' }>): string {
    const start = node.position?.start.offset;
    if (start === undefined) presentationFail('presentation-markdown-invalid');
    const source = this.source.slice(start);
    const delimiter = node.ordered
      ? /^ {0,3}\d{1,9}([.)])(?:[ \t\r\n]|$)/.exec(source)?.[1]
      : /^ {0,3}([-+*])(?:[ \t\r\n]|$)/.exec(source)?.[1];
    if (delimiter === undefined) presentationFail('presentation-markdown-invalid');
    return node.children
      .map((item, index) => {
        const marker = node.ordered
          ? `${index === 0 ? (node.start ?? 1) : 1}${delimiter} `
          : `${delimiter} `;
        const body = this.children(item, '\n\n');
        const indentation = ' '.repeat(marker.length);
        return marker + body.replace(/\r\n|\r|\n/g, lineEnding => `${lineEnding}${indentation}`);
      })
      .join('\n\n');
  }
  heading(node: Extract<Nodes, { type: 'heading' }>): string {
    const body = this.children(node, '', true);
    if (!body.includes('\n')) return '#'.repeat(node.depth) + ' ' + body;
    if (node.depth <= 2) return `${body}\n${node.depth === 1 ? '===' : '---'}`;
    return '#'.repeat(node.depth) + ' ' + body.replace(/\n/g, '&#xA;');
  }
  thematicBreak(node: Extract<Nodes, { type: 'thematicBreak' }>): string {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) presentationFail('presentation-markdown-invalid');
    const markers = Array.from(this.source.slice(start, end)).filter(character =>
      ['*', '_', '-'].includes(character)
    );
    if (markers.length < 3 || markers.some(marker => marker !== markers[0]))
      presentationFail('presentation-markdown-invalid');
    return markers[0].repeat(3);
  }
  node(node: Nodes, encodeTextNewlines = false): string {
    switch (node.type) {
      case 'root':
        return this.children(node, '\n\n');
      case 'paragraph':
        return this.children(node);
      case 'heading':
        return this.heading(node);
      case 'text':
        return this.text(node.value, false, false, encodeTextNewlines);
      case 'strong': {
        const marker = this.emphasisMarker(node);
        return `${marker}${this.children(node, '', encodeTextNewlines)}${marker}`;
      }
      case 'emphasis': {
        const marker = this.emphasisMarker(node);
        return `${marker}${this.children(node, '', encodeTextNewlines)}${marker}`;
      }
      case 'blockquote':
        return quote(this.children(node, '\n\n'));
      case 'list':
        return this.list(node);
      case 'listItem':
        return this.children(node, '\n\n');
      case 'break':
        return '  \n';
      case 'thematicBreak':
        return this.thematicBreak(node);
      default:
        return this.structure(node, encodeTextNewlines);
    }
  }
  structure(node: Nodes, encodeTextNewlines = false): string {
    switch (node.type) {
      case 'code':
        return this.code(node);
      case 'inlineCode': {
        return this.inlineCode(node.value);
      }
      case 'html':
        this.context.diagnostic('provider-html-inert');
        return this.literal(node.value, encodeTextNewlines);
      case 'link':
        return this.link(node.url, this.children(node, '', encodeTextNewlines), encodeTextNewlines);
      case 'image':
        return this.image(node.alt, node.url, encodeTextNewlines);
      case 'definition':
      case 'linkReference':
      case 'imageReference':
        return this.reference(node, encodeTextNewlines);
      default:
        this.context.diagnostic('markdown-node-unsupported');
        return markdownFence(
          this.source.slice(
            node.position?.start.offset ?? 0,
            node.position?.end.offset ?? this.source.length
          )
        );
    }
  }
  inlineCode(source: string): string {
    const fence = '`'.repeat(Math.max(1, longestRun(source, '`') + 1));
    const value = source.replace(/\r\n?|\n/g, ' ');
    const pad = /[^ ]/.test(value) && /^[ `]|[ `]$/.test(value) ? ' ' : '';
    return `${fence}${pad}${value}${pad}${fence}`;
  }
  code(node: Extract<Nodes, { type: 'code' }>): string {
    const language = node.lang ?? null;
    const literalInfo =
      node.meta || (language !== null && !/^[a-zA-Z0-9_+.-]{1,64}$/.test(language));
    const info = literalInfo
      ? `Code info: ${this.literal([language, node.meta].filter(value => value !== null && value !== undefined).join(' '))}\n\n`
      : '';
    return info + markdownFence(node.value, language);
  }
  render(): string {
    const root = parseBoundedMarkdown(this.source, this.context);
    const pending: Nodes[] = [root];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.type === 'definition' && !this.definitions.has(node.identifier))
        this.definitions.set(node.identifier, node);
      if ('children' in node)
        for (let index = node.children.length - 1; index >= 0; index--)
          pending.push(node.children[index]);
    }
    return this.node(root);
  }
}

class CanonicalMarkdownRenderer {
  readonly parts: string[] = [];
  constructor(
    readonly context: PresentationContext,
    readonly filenames: ReadonlyMap<string, string | null>,
    readonly includeToolContent: boolean
  ) {}
  emit(value: string): void {
    this.context.emit(this.parts, value);
  }
  sourceLiteral(value: string): string {
    return new MarkdownSourceRenderer('', this.context).literal(value);
  }
  literal(value: string): string {
    if (value === '') this.context.diagnostic('block-empty');
    return /(?:^|[\r\n])(?: {4}| {0,3}\t)/.test(value)
      ? markdownFence(value)
      : this.sourceLiteral(value);
  }
  code(label: string, value: string, language: string | null = null): string {
    if (value === '') this.context.diagnostic('block-empty');
    return `**${this.sourceLiteral(label)}**\n\n${markdownFence(value, language)}`;
  }
  citation(block: Extract<ArchiveBlock, { type: 'citation' }>): string {
    if (block.label === null) this.context.diagnostic('citation-label-absent');
    else if (block.label === '') this.context.diagnostic('citation-label-empty');
    const label = this.sourceLiteral(
      block.label === '' ? '[Empty citation label]' : (block.label ?? 'Citation')
    );
    let result = label;
    if (block.url === null) this.context.diagnostic('citation-url-absent');
    else result = new MarkdownSourceRenderer('', this.context).link(block.url, label);
    if (block.content === null) this.context.diagnostic('citation-content-absent');
    else if (typeof block.content === 'string') result += '\n\n' + this.literal(block.content);
    else {
      this.context.diagnostic('citation-content-unsupported');
      result += '\n\nStructured citation content is retained in the canonical archive.';
    }
    return quote(result);
  }
  attachment(id: string): string {
    const name = this.filenames.get(id);
    if (name === null || name === undefined) this.context.diagnostic('attachment-name-absent');
    else if (name === '') this.context.diagnostic('attachment-name-empty');
    this.context.diagnostic('attachment-unbound');
    return this.sourceLiteral(
      `Attachment reference: ${name || 'Unnamed attachment'} [local bytes are not bound to this presentation]`
    );
  }
  technical(block: ArchiveBlock): string | undefined {
    if (
      !['reasoning', 'tool_call', 'tool_result', 'execution_output', 'error'].includes(block.type)
    )
      return undefined;
    if (!this.includeToolContent) {
      this.context.diagnostic('technical-content-omitted');
      return 'Technical content omitted by the presentation profile.';
    }
    switch (block.type) {
      case 'reasoning':
        return this.code('Reasoning', block.text);
      case 'tool_call':
        return this.code(`Tool call (${block.toolName})`, this.context.json(block.arguments));
      case 'tool_result':
        return this.code(
          block.toolName === null ? 'Tool result' : `Tool result (${block.toolName})`,
          this.context.json(block.result)
        );
      case 'execution_output':
        return this.code('Execution output', this.context.json(block.output));
      case 'error':
        return this.code(
          block.code === null ? 'Provider error' : `Provider error (${block.code})`,
          block.message
        );
    }
  }
  block(block: ArchiveBlock): string {
    const technical = this.technical(block);
    if (technical !== undefined) return technical;
    switch (block.type) {
      case 'markdown':
        if (block.markdown === '') {
          this.context.diagnostic('block-empty');
          return 'Empty Markdown block.';
        }
        return new MarkdownSourceRenderer(block.markdown, this.context).render();
      case 'text':
        return this.literal(block.text);
      case 'code':
        return this.code(
          block.language === null ? 'Code' : `Code (${block.language})`,
          block.code,
          block.language
        );
      case 'html':
        this.context.diagnostic('provider-html-inert');
        return this.code('Inert provider HTML source', block.html);
      case 'quote':
        return quote(
          this.literal(block.text) +
            (block.attribution === null ? '' : '\n\n— ' + this.sourceLiteral(block.attribution))
        );
      case 'citation':
        return this.citation(block);
      case 'attachment':
        return this.attachment(block.assetId);
      case 'canvas_event':
        this.context.diagnostic('canvas-unsupported');
        return 'Canvas event: presentation unsupported; retained in the canonical archive.';
      case 'unknown':
        this.context.diagnostic('unknown-unsupported');
        return 'Unknown provider block: presentation unsupported; retained in the canonical archive.';
      default:
        presentationFail('presentation-input-invalid');
    }
  }
}

export function renderCanonicalMarkdownBody(
  message: ArchiveMessage,
  filenames: ReadonlyMap<string, string | null>,
  includeToolContent: boolean,
  context: PresentationContext
): string {
  const renderer = new CanonicalMarkdownRenderer(context, filenames, includeToolContent);
  if (message.blocks.length === 0) {
    context.diagnostic('message-empty');
    renderer.emit('Empty message: no content blocks.');
  }
  message.blocks.forEach((block, index) => {
    // The thematic break also terminates list/quote containers between canonical blocks.
    if (index > 0) renderer.emit('\n\n---\n\n');
    renderer.emit(renderer.block(block));
  });
  // Bodies always terminate in a blank line; selected assembly also inserts a thematic break.
  renderer.emit('\n\n');
  return renderer.parts.join('');
}

function closedFence(source: string, node: Extract<Nodes, { type: 'code' }>): boolean {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return false;
  const fragment = source.slice(start, end);
  const opening = /^(`{3,}|~{3,})[^\r\n]*(?:\r\n|\r|\n)/.exec(fragment);
  // Indented code is terminated by the blank-line + unindented thematic-break seam.
  if (!opening) return !/^[`~]{3}/.test(fragment);
  const lines = fragment.split(/\r\n|\r|\n/);
  if (lines.length < 2) return false;
  // Derive the actual list/quote continuation prefix. Accepting arbitrary `>`
  // here would mistake literal quoted fence text inside an UNclosed root fence
  // for a closer, allowing the following selected row to be consumed.
  const physicalStart =
    Math.max(source.lastIndexOf('\n', start - 1), source.lastIndexOf('\r', start - 1)) + 1;
  const prefix = source.slice(physicalStart, start).replace(/[^> \t]/g, ' ');
  const lastLine = lines[lines.length - 1];
  if (!lastLine.startsWith(prefix)) return false;
  const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lastLine.slice(prefix.length));
  return (
    closing !== null && closing[1][0] === opening[1][0] && closing[1].length >= opening[1].length
  );
}

/** @internal One caller-owned context spans ALL adopted rows, never a fresh parser budget per row. */
export function requireSelfContainedMarkdownBody(
  source: string,
  context: PresentationContext,
  maxSourceChars: number
): void {
  if (!source.endsWith('\n\n')) presentationFail('presentation-markdown-invalid');
  try {
    const pending: Nodes[] = [parseBoundedMarkdown(source, context, maxSourceChars)];
    while (pending.length) {
      const node = pending.pop()!;
      if (
        node.type === 'html' ||
        node.type === 'definition' ||
        node.type === 'linkReference' ||
        node.type === 'imageReference' ||
        node.type === 'image'
      )
        presentationFail('presentation-markdown-invalid');
      if (node.type === 'link' && !isSafeUserLink(node.url))
        presentationFail('presentation-markdown-invalid');
      if (node.type === 'code' && !closedFence(source, node))
        presentationFail('presentation-markdown-invalid');
      if ('children' in node)
        for (let index = node.children.length - 1; index >= 0; index--)
          pending.push(node.children[index]);
    }
  } catch {
    presentationFail('presentation-markdown-invalid');
  }
}
