/** Work limits are independent of the final 32 MiB reading-output limit. */
export const MARKDOWN_WORK_LIMITS = Object.freeze({
  parseLength: 4 * 1024 * 1024,
  lineLength: 256 * 1024,
  structuralUnits: 250_000,
  parserInput: 16 * 1024 * 1024,
  parseCalls: 1_024,
  traversalNodes: 200_000,
  nodeWork: 1_000_000,
  rangeScan: 64 * 1024 * 1024,
  edits: 200_000,
});

export const INERT_READING_DIAGNOSTIC =
  'Reading view unavailable: Markdown safety work or output limit exceeded. Raw and canonical archives are unchanged.';

/** One instance belongs to one complete reading view, including every nested parse. */
export class MarkdownWorkBudget {
  private parserInput = 0;
  private parseCalls = 0;
  private nodeWork = 0;
  private rangeScan = 0;
  private edits = 0;
  private exhausted = false;

  private within(value: number, limit: number): void {
    if (this.exhausted || !Number.isSafeInteger(value) || value < 0 || value > limit) {
      this.exhausted = true;
      throw new Error('Markdown work budget exceeded.');
    }
  }

  assertAvailable(): void {
    this.within(0, 0);
  }

  /** Debit and structurally admit input BEFORE invoking the Markdown parser. */
  admitParse(source: string): void {
    this.within(source.length, MARKDOWN_WORK_LIMITS.parseLength);
    this.within(this.parseCalls + 1, MARKDOWN_WORK_LIMITS.parseCalls);
    this.within(this.parserInput + source.length, MARKDOWN_WORK_LIMITS.parserInput);
    this.parseCalls += 1;
    this.parserInput += source.length;
    this.scan(source.length);

    // A deliberately conservative lexical upper bound: punctuation, physical
    // line breaks, and plain-text runs each consume a unit. Delimiter/list
    // bombs are rejected before the parser can allocate their AST/tokens.
    let units = 0;
    let lineLength = 0;
    let inTextRun = false;
    for (let index = 0; index < source.length; index += 1) {
      const code = source.charCodeAt(index);
      const newline = code === 10 || code === 13;
      if (newline) lineLength = 0;
      else this.within(++lineLength, MARKDOWN_WORK_LIMITS.lineLength);
      const whitespace = code === 32 || code === 9 || newline;
      const punctuation =
        (code >= 33 && code <= 47) ||
        (code >= 58 && code <= 64) ||
        (code >= 91 && code <= 96) ||
        (code >= 123 && code <= 126);
      if (newline || punctuation || (!whitespace && !inTextRun)) {
        this.within(++units, MARKDOWN_WORK_LIMITS.structuralUnits);
      }
      inTextRun = !whitespace && !punctuation;
    }
  }

  scan(length: number): void {
    this.within(length, MARKDOWN_WORK_LIMITS.rangeScan);
    this.within(this.rangeScan + length, MARKDOWN_WORK_LIMITS.rangeScan);
    this.rangeScan += length;
  }

  newEdit(): void {
    this.within(this.edits + 1, MARKDOWN_WORK_LIMITS.edits);
    this.edits += 1;
  }

  private nodes(count: number): void {
    this.within(this.nodeWork + count, MARKDOWN_WORK_LIMITS.nodeWork);
    this.nodeWork += count;
  }

  /** Check a wide child array BEFORE iterating or pushing any of its entries. */
  *walk<T>(root: T, childrenOf: (node: T) => readonly T[]): Generator<T> {
    this.nodes(1);
    let scheduled = 1;
    const pending: T[] = [root];
    while (pending.length > 0) {
      this.nodes(1);
      const node = pending.pop()!;
      yield node;
      const children = childrenOf(node);
      this.within(scheduled + children.length, MARKDOWN_WORK_LIMITS.traversalNodes);
      this.nodes(children.length);
      scheduled += children.length;
      for (const child of children) pending.push(child);
    }
  }
}

/** Stream LF lines without retaining one split-array entry per physical line. */
export function* markdownLines(source: string): Generator<{ text: string; start: number }> {
  let start = 0;
  while (start <= source.length) {
    const end = source.indexOf('\n', start);
    if (end < 0) {
      yield { text: source.slice(start), start };
      return;
    }
    yield { text: source.slice(start, end), start };
    start = end + 1;
  }
}

/** Output-sized blocks, not one retained array entry per token or line. */
export class MarkdownChunks {
  private readonly blocks: string[] = [];
  private parts: string[] = [];
  private length = 0;

  append(part: string): void {
    if (!part) return;
    this.parts.push(part);
    this.length += part.length;
    if (this.length >= 8192) this.flush();
  }

  private flush(): void {
    this.blocks.push(this.parts.join(''));
    this.parts = [];
    this.length = 0;
  }

  toString(): string {
    this.flush();
    return this.blocks.join('');
  }
}
