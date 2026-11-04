import { requireSafeHtmlBody } from '../archive/presentation/preview-safety';
import { pdfFail, type PdfLimits, type PdfSemanticCounts } from './pdf-contract';
import { requirePdfGlyphs, routePdfText } from './pdf-font';

export interface PdfRun {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
  placeholder: boolean;
  font: 'Roboto' | 'NotoEmoji';
  atomic?: true;
}
export interface PdfParagraph {
  runs: PdfRun[];
  heading?: 1 | 2 | 3 | 4 | 5 | 6;
  quoteDepth: number;
  listDepth: number;
  pre: boolean;
  rule?: true;
}
interface PdfList {
  ordered: boolean;
  next: number;
}
interface Frame {
  tag: string;
  preserve: boolean;
  placeholder: boolean;
  href?: string;
  list?: PdfList;
  item?: { used: boolean; list: PdfList };
}
type MutableCounts = { -readonly [K in keyof PdfSemanticCounts]: number };
const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre']);
const WRAPPERS = new Set(['section', 'blockquote', 'aside', 'footer', 'ul', 'ol', 'li']);
const INLINE = new Set(['em', 'strong', 'code', 'span', 'a']);
const LISTS = new Set(['ul', 'ol']);
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

export function decodePdfEntities(text: string): string {
  if (text.replace(/&(amp|lt|gt|quot|#39);/g, '').includes('&')) pdfFail('pdf-html-invalid');
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (_match, entity: string) => ENTITIES[entity]);
}

/** Iterative exact-grammar mapper; all counters cover the complete selected document. */
export class PdfHtmlBuilder {
  readonly paragraphs: PdfParagraph[] = [];
  readonly counts: MutableCounts = {
    messageCount: 0,
    htmlChars: 0,
    codePoints: 0,
    tokens: 0,
    maxDepth: 0,
    maxListDepth: 0,
    layoutNodes: 0,
    layoutVisits: 0,
    blocks: 0,
    runs: 0,
    maxPreCodePoints: 0,
    maxPreLineCodePoints: 0,
    links: 0,
    placeholders: 0,
    tabs: 0,
    emojiClusters: 0,
  };
  private stack: Frame[] = [];
  private current: PdfParagraph | undefined;
  private pre: { points: number; line: number } | undefined;
  private column = 0;
  constructor(readonly limits: Readonly<PdfLimits>) {}

  private node(): void {
    if (++this.counts.layoutNodes > this.limits.maxLayoutNodes) pdfFail('pdf-layout-node-limit');
  }
  private sourceText(text: string): void {
    this.counts.codePoints += requirePdfGlyphs(text, this.limits.maxAtomicGraphemeCodePoints);
    if (this.counts.codePoints > this.limits.maxCodePoints) pdfFail('pdf-code-point-limit');
    if (this.pre) this.preText(text);
  }
  private preText(text: string): void {
    const pre = this.pre!;
    for (const character of text) {
      pre.points++;
      if (pre.points > this.limits.maxPreCodePoints) pdfFail('pdf-pre-limit');
      if (character === '\n' || character === '\r') pre.line = 0;
      else if (++pre.line > this.limits.maxPreLineCodePoints) pdfFail('pdf-pre-line-limit');
      this.counts.maxPreLineCodePoints = Math.max(this.counts.maxPreLineCodePoints, pre.line);
    }
    this.counts.maxPreCodePoints = Math.max(this.counts.maxPreCodePoints, pre.points);
  }
  private begin(heading?: PdfParagraph['heading'], pre = false): PdfParagraph {
    if (++this.counts.blocks > this.limits.maxBlocks) pdfFail('pdf-block-limit');
    this.node();
    this.column = 0;
    const paragraph: PdfParagraph = {
      runs: [],
      heading,
      pre,
      quoteDepth: this.stack.filter(frame => frame.tag === 'blockquote').length,
      listDepth: this.stack.filter(frame => frame.list).length,
    };
    this.paragraphs.push(paragraph);
    this.current = paragraph;
    const item = [...this.stack].reverse().find(frame => frame.item)?.item;
    if (item && !item.used) {
      item.used = true;
      const marker = item.list.ordered ? `${item.list.next}. ` : '• ';
      if (item.list.ordered) {
        if (!Number.isSafeInteger(item.list.next)) pdfFail('pdf-html-invalid');
        item.list.next++;
      }
      this.sourceText(marker);
      this.run(marker, { bold: false, italic: false, code: false, placeholder: false });
      this.column = 0; // Synthetic list markers do not move source-code tab stops.
    }
    return paragraph;
  }
  private flush(): void {
    this.current = undefined;
    this.column = 0;
  }
  framing(text: string, heading?: PdfParagraph['heading']): void {
    this.flush();
    this.begin(heading);
    this.append(text, true);
    this.flush();
  }
  private style(paragraph: PdfParagraph): Omit<PdfRun, 'text' | 'font'> {
    return {
      bold: this.stack.some(frame => frame.tag === 'strong'),
      italic: this.stack.some(frame => ['em', 'aside', 'footer'].includes(frame.tag)),
      code:
        paragraph.pre ||
        this.stack.some(frame => frame.tag === 'code' || (frame.preserve && frame.tag === 'span')),
      placeholder: this.stack.some(frame => frame.placeholder),
    };
  }
  private run(text: string, style: Omit<PdfRun, 'text' | 'font'>): void {
    for (const character of text) if (character === '\n') this.node();
    for (const run of routePdfText(text, this.limits.maxAtomicGraphemeCodePoints)) {
      if (++this.counts.runs > this.limits.maxRuns) pdfFail('pdf-run-limit');
      this.node();
      this.counts.emojiClusters += run.emojiClusters;
      this.current!.runs.push({
        text: run.text,
        font: run.font,
        ...(run.atomic ? { atomic: true as const } : {}),
        ...style,
      });
    }
    const lines = text.split('\n');
    this.column =
      lines.length > 1 ? [...lines[lines.length - 1]].length : this.column + [...text].length;
  }
  private whitespace(text: string, preserve: boolean): string {
    if (!preserve) {
      const runs = this.current?.runs;
      const last = runs?.[runs.length - 1]?.text;
      const collapsed = text.replace(/[ \t\r\n\f]+/g, ' ');
      return !last || last.endsWith(' ') || last.endsWith('\n')
        ? collapsed.replace(/^ /, '')
        : collapsed;
    }
    let column = this.column;
    return text.replace(/\r\n|\r|\n|\t|[^\r\n\t]+/g, part => {
      if (/^[\r\n]/.test(part)) {
        column = 0;
        return '\n';
      }
      if (part !== '\t') {
        column += [...part].length;
        return part;
      }
      const spaces = 4 - (column % 4);
      column += spaces;
      this.counts.tabs++;
      this.counts.codePoints += spaces - 1;
      if (this.counts.codePoints > this.limits.maxCodePoints) pdfFail('pdf-code-point-limit');
      return ' '.repeat(spaces);
    });
  }
  private append(text: string, preserve: boolean): void {
    this.sourceText(text);
    text = this.whitespace(text, preserve);
    if (!text) return;
    const paragraph = this.current ?? this.begin();
    this.run(text, this.style(paragraph));
  }
  private validateOpening(tag: string): void {
    const parent = this.stack[this.stack.length - 1]?.tag ?? '';
    const block = BLOCKS.has(tag) || WRAPPERS.has(tag) || tag === 'hr';
    if ((LISTS.has(parent) && tag !== 'li') || (tag === 'li' && !LISTS.has(parent)))
      pdfFail('pdf-html-invalid');
    if (block && this.stack.some(frame => BLOCKS.has(frame.tag) || INLINE.has(frame.tag)))
      pdfFail('pdf-html-invalid');
    if (
      (parent === 'pre' && tag !== 'code') ||
      (tag === 'a' && this.stack.some(frame => frame.tag === 'a'))
    )
      pdfFail('pdf-html-invalid');
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
      frame.href = decodePdfEntities(/^ href="([^"]*)"/.exec(attributes)![1]);
      this.counts.links++;
    }
    if (LISTS.has(tag)) {
      const depth = this.stack.filter(item => item.list).length + 1;
      if (depth > this.limits.maxListDepth) pdfFail('pdf-list-depth-limit');
      this.counts.maxListDepth = Math.max(this.counts.maxListDepth, depth);
      frame.list = {
        ordered: tag === 'ol',
        next: attributes ? Number(/^ start="(-?\d+)"$/.exec(attributes)![1]) : 1,
      };
    }
    if (tag === 'li') frame.item = { used: false, list: this.stack[this.stack.length - 1].list! };
    return frame;
  }
  private open(tag: string, attributes: string): void {
    this.validateOpening(tag);
    if (tag === 'br') {
      this.append('\n', true);
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
    if (LISTS.has(tag) && parent?.item && !parent.item.used) {
      this.begin();
      this.flush();
    }
    this.stack.push(this.frame(tag, attributes));
    if (tag === 'pre') this.pre = { points: 0, line: 0 };
    if (BLOCKS.has(tag))
      this.begin(
        /^h[1-6]$/.test(tag) ? (Number(tag[1]) as PdfParagraph['heading']) : undefined,
        tag === 'pre'
      );
  }
  private close(tag: string): void {
    const frame = this.stack[this.stack.length - 1];
    if (!frame || frame.tag !== tag) pdfFail('pdf-html-invalid');
    if (frame.href !== undefined) this.append(` (${frame.href})`, true);
    if (frame.item && !frame.item.used) this.begin();
    if (BLOCKS.has(tag) || WRAPPERS.has(tag)) this.flush();
    if (tag === 'pre') this.pre = undefined;
    this.stack.pop();
  }
  private text(text: string): void {
    const decoded = decodePdfEntities(text);
    if (LISTS.has(this.stack[this.stack.length - 1]?.tag ?? '')) {
      if (decoded.trim()) pdfFail('pdf-html-invalid');
      return;
    }
    this.append(
      decoded,
      this.stack.some(frame => frame.preserve)
    );
  }
  private preflight(source: string): void {
    let depth = 0,
      cursor = 0;
    while (cursor < source.length) {
      if (++this.counts.tokens > this.limits.maxTokens) pdfFail('pdf-token-limit');
      if (source[cursor] !== '<') {
        const next = source.indexOf('<', cursor);
        cursor = next < 0 ? source.length : next;
        continue;
      }
      const end = source.indexOf('>', cursor + 1);
      if (end < 0) pdfFail('pdf-html-invalid');
      const token = source.slice(cursor + 1, end);
      if (token.startsWith('/')) depth--;
      else if (!/^(?:br|hr)$/.test(token)) depth++;
      if (depth < 0) pdfFail('pdf-html-invalid');
      if (depth > this.limits.maxDepth) pdfFail('pdf-depth-limit');
      this.counts.maxDepth = Math.max(this.counts.maxDepth, depth);
      cursor = end + 1;
    }
    try {
      requireSafeHtmlBody(source);
    } catch {
      pdfFail('pdf-html-invalid');
    }
  }
  body(source: string): void {
    this.counts.htmlChars += source.length;
    if (this.counts.htmlChars > this.limits.maxHtmlChars) pdfFail('pdf-html-char-limit');
    this.preflight(source);
    this.flush();
    let cursor = 0;
    while (cursor < source.length) {
      if (source[cursor] !== '<') {
        const end = source.indexOf('<', cursor);
        this.text(source.slice(cursor, end < 0 ? source.length : end));
        cursor = end < 0 ? source.length : end;
      } else {
        const end = source.indexOf('>', cursor + 1);
        const token = source.slice(cursor + 1, end);
        const close = /^\/([a-z][a-z0-9]*)$/.exec(token);
        if (close) this.close(close[1]);
        else {
          const open = /^([a-z][a-z0-9]*)([^<>]*)$/.exec(token)!;
          this.open(open[1], open[2]);
        }
        cursor = end + 1;
      }
    }
    if (this.stack.length) pdfFail('pdf-html-invalid');
    this.flush();
  }
}
