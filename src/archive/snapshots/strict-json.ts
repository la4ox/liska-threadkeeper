import type { JsonValue } from '../types';
import type { SnapshotAnalysisLimits } from './contracts';
import { fail } from './safe-input';

export interface SnapshotJsonBudget {
  values: number;
  stringCodeUnits: number;
  work: number;
}

const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);

/** A grammar/duplicate-key pass precedes JSON.parse; byte parsing never calls input code. */
class JsonScanner {
  private offset = 0;

  constructor(
    private readonly source: string,
    private readonly limits: SnapshotAnalysisLimits,
    private readonly budget: SnapshotJsonBudget
  ) {}

  scan(): void {
    this.whitespace();
    this.value(0);
    this.whitespace();
    if (this.offset !== this.source.length) fail('invalid-json');
  }

  private whitespace(): void {
    while (this.offset < this.source.length && /[\t\n\r ]/u.test(this.source[this.offset]))
      this.offset += 1;
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
      if (unsafeKeys.has(key)) fail('unsafe-json-key');
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
      const hex = this.source.slice(this.offset, this.offset + 4);
      if (!/^[a-fA-F0-9]{4}$/u.test(hex)) fail('invalid-json');
      this.offset += 4;
    } else if (!escaped || !'"\\/bfnrt'.includes(escaped)) fail('invalid-json');
  }

  private literal(value: string): void {
    if (!this.source.startsWith(value, this.offset)) fail('invalid-json');
    this.offset += value.length;
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

/** Rejects BOM, malformed UTF-8, duplicate decoded/unsafe keys and bounded-work violations. */
export function parseSnapshotJson(
  bytes: Uint8Array,
  limits: SnapshotAnalysisLimits,
  budget: SnapshotJsonBudget = { values: 0, stringCodeUnits: 0, work: 0 }
): JsonValue {
  if (bytes.byteLength > limits.maxFileBytes) fail('limit-exceeded');
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
