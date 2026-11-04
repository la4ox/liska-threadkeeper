import { requireSafeHtmlBody } from '../archive/presentation/preview-safety';
import { docxFail, type DocxLimits, type DocxSemanticCounts } from './docx-contract';

export interface DocxRun {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
  placeholder: boolean;
  break?: true;
}
export interface DocxParagraph {
  runs: DocxRun[];
  heading?: 1 | 2 | 3 | 4 | 5 | 6;
  quoteDepth: number;
  listDepth: number;
  numbering?: { reference: string; level: number };
  pre: boolean;
  rule?: true;
}
export interface DocxNumbering {
  reference: string;
  ordered: boolean;
  start: number;
  level: number;
}
type MutableCounts = { -readonly [K in keyof DocxSemanticCounts]: number };
interface Frame {
  tag: string;
  preserve: boolean;
  placeholder: boolean;
  href?: string;
  list?: DocxNumbering;
  item?: { used: boolean; list: DocxNumbering };
}
const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre']);
const WRAPPERS = new Set(['section', 'blockquote', 'aside', 'footer', 'ul', 'ol', 'li']);
const INLINE = new Set(['em', 'strong', 'code', 'span', 'a']);
const LISTS = new Set(['ul', 'ol']);
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

/** The generator emits these five entities. Replacement is deliberately single-pass. */
export function decodeDocxEntities(text: string): string {
  // Bare ampersands do not occur in generated safe fragments.
  if (text.replace(/&(amp|lt|gt|quot|#39);/g, '').includes('&')) docxFail('docx-html-invalid');
  const decoded = text.replace(
    /&(amp|lt|gt|quot|#39);/g,
    (_match, entity: string) => ENTITIES[entity]
  );
  requireDocxText(decoded);
  return decoded;
}
function requireDocxText(decoded: string): void {
  // Reject unpaired surrogates rather than silently changing editable source text.
  for (let index = 0; index < decoded.length; index++) {
    const unit = decoded.charCodeAt(index);
    if (
      (unit < 32 && unit !== 9 && unit !== 10 && unit !== 13) ||
      unit === 0xfffe ||
      unit === 0xffff
    )
      docxFail('docx-html-invalid');
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = decoded.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) docxFail('docx-html-invalid');
    } else if (unit >= 0xdc00 && unit <= 0xdfff) docxFail('docx-html-invalid');
  }
}

/** Shared counters cover the entire document, including synthetic framing paragraphs. */
export class DocxHtmlBuilder {
  readonly paragraphs: DocxParagraph[] = [];
  readonly numbering: DocxNumbering[] = [];
  readonly counts: MutableCounts = {
    messageCount: 0,
    htmlChars: 0,
    tokens: 0,
    maxDepth: 0,
    maxListDepth: 0,
    blocks: 0,
    runs: 0,
    numberingDefinitions: 0,
    links: 0,
    placeholders: 0,
  };
  private stack: Frame[] = [];
  private current: DocxParagraph | undefined;
  constructor(readonly limits: Readonly<DocxLimits>) {}

  private increment(
    key: 'tokens' | 'blocks' | 'runs',
    max: number,
    code: 'docx-token-limit' | 'docx-block-limit' | 'docx-run-limit'
  ): void {
    if (++this.counts[key] > max) docxFail(code);
  }
  private begin(heading?: DocxParagraph['heading'], pre = false): DocxParagraph {
    this.increment('blocks', this.limits.maxBlocks, 'docx-block-limit');
    const lists = this.stack.filter(frame => frame.list);
    const item = [...this.stack].reverse().find(frame => frame.item)?.item;
    const paragraph: DocxParagraph = {
      runs: [],
      quoteDepth: this.stack.filter(frame => frame.tag === 'blockquote').length,
      listDepth: lists.length,
      pre,
      ...(heading ? { heading } : {}),
    };
    if (item && !item.used) {
      paragraph.numbering = { reference: item.list.reference, level: item.list.level };
      item.used = true;
    }
    this.paragraphs.push(paragraph);
    this.current = paragraph;
    return paragraph;
  }
  private flush(): void {
    this.current = undefined;
  }
  framing(text: string, heading?: DocxParagraph['heading']): void {
    requireDocxText(text);
    this.flush();
    this.begin(heading);
    this.append(text, true);
    this.flush();
  }
  private collapseWhitespace(text: string): string {
    text = text.replace(/[ \t\r\n\f]+/g, ' ');
    const runs = this.current?.runs ?? [];
    const previous = runs[runs.length - 1];
    if (!runs.length || previous.text.endsWith(' ') || previous.break)
      return text.replace(/^ /, '');
    return text;
  }
  private append(text: string, preserve: boolean, lineBreak = false): void {
    if (!preserve) text = this.collapseWhitespace(text);
    if (!text && !lineBreak) return;
    const paragraph = this.current ?? this.begin();
    const style = this.runStyle(paragraph);
    const parts = lineBreak ? ['\n'] : text.split(/(\r\n|\r|\n|\t)/).filter(Boolean);
    for (const part of parts) {
      this.increment('runs', this.limits.maxRuns, 'docx-run-limit');
      const isBreak = /^(?:\r\n|\r|\n)$/.test(part);
      paragraph.runs.push({
        ...style,
        text: isBreak ? '' : part,
        ...(isBreak ? { break: true as const } : {}),
      });
    }
  }
  private runStyle(paragraph: DocxParagraph): Omit<DocxRun, 'text' | 'break'> {
    return {
      bold: this.stack.some(frame => frame.tag === 'strong'),
      italic: this.stack.some(
        frame => frame.tag === 'em' || frame.tag === 'aside' || frame.tag === 'footer'
      ),
      code:
        paragraph.pre ||
        this.stack.some(frame => frame.tag === 'code' || (frame.preserve && frame.tag === 'span')),
      placeholder: this.stack.some(frame => frame.placeholder),
    };
  }
  private validateOpening(tag: string): void {
    const parentTag = this.stack[this.stack.length - 1]?.tag ?? '';
    const isBlock = BLOCKS.has(tag) || WRAPPERS.has(tag) || tag === 'hr';
    if (LISTS.has(parentTag) && tag !== 'li') docxFail('docx-html-invalid');
    if (tag === 'li' && !LISTS.has(parentTag)) docxFail('docx-html-invalid');
    if (isBlock && this.stack.some(frame => BLOCKS.has(frame.tag) || INLINE.has(frame.tag)))
      docxFail('docx-html-invalid');
    if (parentTag === 'pre' && tag !== 'code') docxFail('docx-html-invalid');
    if (tag === 'a' && this.stack.some(frame => frame.tag === 'a')) docxFail('docx-html-invalid');
  }
  private list(tag: string, attributes: string): DocxNumbering {
    const level = this.stack.filter(frame => frame.list).length;
    if (level + 1 > this.limits.maxListDepth) docxFail('docx-list-depth-limit');
    this.counts.maxListDepth = Math.max(this.counts.maxListDepth, level + 1);
    if (++this.counts.numberingDefinitions > this.limits.maxNumberingDefinitions)
      docxFail('docx-numbering-limit');
    const list = {
      reference: `list-${this.numbering.length + 1}`,
      ordered: tag === 'ol',
      start: attributes ? Number(/^ start="(-?\d+)"$/.exec(attributes)![1]) : 1,
      level,
    };
    this.numbering.push(list);
    return list;
  }
  private frame(tag: string, attributes: string): Frame {
    const frame: Frame = {
      tag,
      preserve:
        tag === 'pre' ||
        attributes.includes('class="text"') ||
        attributes.includes('class="inert-html"'),
      placeholder: attributes.includes('class="placeholder"'),
    };
    if (frame.placeholder) this.counts.placeholders++;
    if (tag === 'a') {
      frame.href = decodeDocxEntities(/^ href="([^"]*)"/.exec(attributes)![1]);
      this.counts.links++;
    }
    if (tag === 'ul' || tag === 'ol') frame.list = this.list(tag, attributes);
    if (tag === 'li') frame.item = { used: false, list: this.stack[this.stack.length - 1].list! };
    return frame;
  }
  private open(tag: string, attributes: string): void {
    this.validateOpening(tag);
    if (tag === 'br') {
      this.append('', true, true);
      return;
    }
    if (tag === 'hr') {
      this.flush();
      this.begin().rule = true;
      this.flush();
      return;
    }
    if (BLOCKS.has(tag) || WRAPPERS.has(tag)) this.flush();
    const parent = this.stack[this.stack.length - 1];
    if ((tag === 'ul' || tag === 'ol') && parent?.item && !parent.item.used) {
      this.begin(); // An item whose only child is a nested list still has a native marker.
      this.flush();
    }
    this.stack.push(this.frame(tag, attributes));
    if (this.stack.length > this.limits.maxDepth) docxFail('docx-depth-limit');
    this.counts.maxDepth = Math.max(this.counts.maxDepth, this.stack.length);
    if (BLOCKS.has(tag))
      this.begin(
        /^h[1-6]$/.test(tag) ? (Number(tag[1]) as DocxParagraph['heading']) : undefined,
        tag === 'pre'
      );
  }
  private close(tag: string): void {
    const frame = this.stack[this.stack.length - 1];
    if (!frame || frame.tag !== tag) docxFail('docx-html-invalid');
    if (frame.href !== undefined) this.append(` (${frame.href})`, true);
    if (frame.item && !frame.item.used) this.begin();
    if (BLOCKS.has(tag) || WRAPPERS.has(tag)) this.flush();
    this.stack.pop();
  }
  private text(source: string): void {
    const text = decodeDocxEntities(source);
    const parentTag = this.stack[this.stack.length - 1]?.tag ?? '';
    if (LISTS.has(parentTag)) {
      if (text.trim()) docxFail('docx-html-invalid');
    } else
      this.append(
        text,
        this.stack.some(frame => frame.preserve)
      );
  }
  body(source: string): void {
    this.counts.htmlChars += source.length;
    if (this.counts.htmlChars > this.limits.maxHtmlChars) docxFail('docx-html-char-limit');
    try {
      requireSafeHtmlBody(source);
    } catch {
      docxFail('docx-html-invalid');
    }
    this.flush();
    let cursor = 0;
    // One cursor, one bounded stack; no recursive parsing or browser HTML correction.
    while (cursor < source.length) {
      this.increment('tokens', this.limits.maxTokens, 'docx-token-limit');
      if (source[cursor] !== '<') {
        const end = source.indexOf('<', cursor);
        this.text(source.slice(cursor, end < 0 ? source.length : end));
        cursor = end < 0 ? source.length : end;
      } else {
        const end = source.indexOf('>', cursor);
        const token = source.slice(cursor + 1, end);
        const closing = /^\/([a-z][a-z0-9]*)$/.exec(token);
        if (closing) this.close(closing[1]);
        else {
          const opening = /^([a-z][a-z0-9]*)([^<>]*)$/.exec(token)!;
          this.open(opening[1], opening[2]);
        }
        cursor = end + 1;
      }
    }
    if (this.stack.length) docxFail('docx-html-invalid');
    this.flush();
  }
}
