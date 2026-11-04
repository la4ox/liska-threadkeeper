import type { JsonValue } from '../types';
import type { SnapshotCatalogLimits } from './contracts';
import { fail } from './safe-input';

export interface CatalogJsonBudget {
  values: number;
  stringCodeUnits: number;
  work: number;
}

/** Independent scanner: catalog budgets never borrow pairwise-analysis limits. */
class JsonScanner {
  private offset = 0;

  constructor(
    private readonly source: string,
    private readonly limits: SnapshotCatalogLimits,
    private readonly budget: CatalogJsonBudget
  ) {}

  scan(): void {
    this.whitespace();
    this.value(0);
    this.whitespace();
    if (this.offset !== this.source.length) fail('invalid-json');
  }

  private whitespace(): void {
    while (/[\t\n\r ]/u.test(this.source[this.offset] ?? '')) this.offset += 1;
  }

  private spendValue(): void {
    this.budget.values += 1;
    if (this.budget.values > this.limits.maxJsonValues) fail('limit-exceeded');
  }

  private value(depth: number): void {
    this.spendValue();
    const token = this.source[this.offset];
    if (token === '{' || token === '[') {
      if (depth >= this.limits.maxJsonDepth) fail('limit-exceeded');
      if (token === '{') this.object(depth + 1);
      else this.array(depth + 1);
    } else if (token === '"') this.string(false);
    else if (token === 't') this.literal('true');
    else if (token === 'f') this.literal('false');
    else if (token === 'n') this.literal('null');
    else this.number();
  }

  private object(depth: number): void {
    this.offset += 1;
    this.whitespace();
    const keys = new Set<string>();
    if (this.source[this.offset] === '}') {
      this.offset += 1;
      return;
    }
    while (this.offset < this.source.length) {
      this.spendValue();
      const key = this.string(true)!;
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('unsafe-json-key');
      if (keys.has(key)) fail('duplicate-json-key');
      keys.add(key);
      this.whitespace();
      if (this.source[this.offset++] !== ':') fail('invalid-json');
      this.whitespace();
      this.value(depth);
      this.whitespace();
      const separator = this.source[this.offset++];
      if (separator === '}') return;
      if (separator !== ',') fail('invalid-json');
      this.whitespace();
    }
    fail('invalid-json');
  }

  private array(depth: number): void {
    this.offset += 1;
    this.whitespace();
    if (this.source[this.offset] === ']') {
      this.offset += 1;
      return;
    }
    while (this.offset < this.source.length) {
      this.value(depth);
      this.whitespace();
      const separator = this.source[this.offset++];
      if (separator === ']') return;
      if (separator !== ',') fail('invalid-json');
      this.whitespace();
    }
    fail('invalid-json');
  }

  private string(key: boolean): string | null {
    const start = this.offset;
    if (this.source[this.offset++] !== '"') fail('invalid-json');
    let length = 0;
    while (this.offset < this.source.length) {
      const character = this.source[this.offset++];
      if (character === '"') {
        this.budget.stringCodeUnits += length;
        if (this.budget.stringCodeUnits > this.limits.maxJsonStringCodeUnits)
          fail('limit-exceeded');
        return key ? (JSON.parse(this.source.slice(start, this.offset)) as string) : null;
      }
      if (character.charCodeAt(0) < 0x20) fail('invalid-json');
      if (character === '\\') this.escape();
      length += 1;
      if (length > this.limits.maxJsonStringCodeUnits - this.budget.stringCodeUnits)
        fail('limit-exceeded');
    }
    fail('invalid-json');
  }

  private escape(): void {
    const escaped = this.source[this.offset++];
    if (escaped === 'u') {
      if (!/^[a-fA-F0-9]{4}$/u.test(this.source.slice(this.offset, this.offset + 4)))
        fail('invalid-json');
      this.offset += 4;
    } else if (!escaped || !'"\\/bfnrt'.includes(escaped)) fail('invalid-json');
  }

  private literal(token: string): void {
    if (!this.source.startsWith(token, this.offset)) fail('invalid-json');
    this.offset += token.length;
  }

  private digits(): number {
    const start = this.offset;
    while (
      this.offset < this.source.length &&
      this.source[this.offset] >= '0' &&
      this.source[this.offset] <= '9'
    )
      this.offset += 1;
    return this.offset - start;
  }

  private number(): void {
    const start = this.offset;
    if (this.source[this.offset] === '-') this.offset += 1;
    if (this.source[this.offset] === '0') this.offset += 1;
    else if (this.digits() === 0) fail('invalid-json');
    if (this.source[this.offset] === '.') {
      this.offset += 1;
      if (this.digits() === 0) fail('invalid-json');
    }
    if (this.source[this.offset] === 'e' || this.source[this.offset] === 'E') {
      this.offset += 1;
      if (this.source[this.offset] === '+' || this.source[this.offset] === '-') this.offset += 1;
      if (this.digits() === 0) fail('invalid-json');
    }
    if (!Number.isFinite(Number(this.source.slice(start, this.offset)))) fail('invalid-json');
  }
}

/** Fatal UTF-8; no BOM, duplicate decoded keys, unsafe keys or unbounded work. */
export function parseCatalogJson(
  bytes: Uint8Array,
  limits: SnapshotCatalogLimits,
  budget: CatalogJsonBudget
): JsonValue {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail('invalid-json');
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    fail('invalid-json');
  }
  budget.work += source.length;
  if (budget.work > limits.maxJsonWork) fail('limit-exceeded');
  new JsonScanner(source, limits, budget).scan();
  try {
    return JSON.parse(source) as JsonValue;
  } catch {
    fail('invalid-json');
  }
}
