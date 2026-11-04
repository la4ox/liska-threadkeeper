import type { JournalLimits, ResumabilityJournal } from './contracts';
import { fail, guarded, resolveLimits } from './safe-data';
import { readJournal } from './snapshot';

const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedLength = Object.getOwnPropertyDescriptor(typedPrototype, 'byteLength')!.get!;
const typedOffset = Object.getOwnPropertyDescriptor(typedPrototype, 'byteOffset')!.get!;
const typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, 'buffer')!.get!;
const typedTag = Object.getOwnPropertyDescriptor(typedPrototype, Symbol.toStringTag)!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const bufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;

function ownedBytes(value: unknown, limits: JournalLimits): Uint8Array {
  if (!value || typeof value !== 'object' || typedTag.call(value) !== 'Uint8Array')
    fail('invalid-request');
  const length = typedLength.call(value) as number;
  if (length > limits.maxOutputBytes) fail('limit-exceeded');
  const buffer = typedBuffer.call(value) as ArrayBuffer;
  bufferLength.call(buffer); // Native slots reject shared buffers and proxy receivers.
  if (bufferResizable?.call(buffer) === true || Reflect.ownKeys(value).length !== length)
    fail('invalid-request');
  return new Uint8Array(new Uint8Array(buffer, typedOffset.call(value), length));
}

/** Bounded independent syntax pass: JSON.parse alone silently accepts duplicate keys. */
class JsonScanner {
  private offset = 0;
  private values = 0;

  constructor(private readonly source: string) {}

  scan(): void {
    this.whitespace();
    this.value(0);
    this.whitespace();
    if (this.offset !== this.source.length) fail('invalid-json');
  }

  private whitespace(): void {
    while (/[\t\n\r ]/u.test(this.source[this.offset] ?? '')) this.offset += 1;
  }

  private value(depth: number): void {
    this.values += 1;
    if (this.values > 750_000 || depth > 12) fail('limit-exceeded');
    const token = this.source[this.offset];
    if (token === '{') this.object(depth + 1);
    else if (token === '[') this.array(depth + 1);
    else if (token === '"') this.string(false);
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
      const key = this.string(true)!;
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('unsafe-json-key');
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
    while (this.offset < this.source.length) {
      const character = this.source[this.offset++];
      if (character === '"')
        return key ? (JSON.parse(this.source.slice(start, this.offset)) as string) : null;
      if (character.charCodeAt(0) < 0x20) fail('invalid-json');
      if (character === '\\') {
        const escaped = this.source[this.offset++];
        if (escaped === 'u') {
          if (!/^[a-fA-F0-9]{4}$/u.test(this.source.slice(this.offset, this.offset + 4)))
            fail('invalid-json');
          this.offset += 4;
        } else if (!escaped || !'"\\/bfnrt'.includes(escaped)) fail('invalid-json');
      }
    }
    fail('invalid-json');
  }

  private literal(token: string): void {
    if (!this.source.startsWith(token, this.offset)) fail('invalid-json');
    this.offset += token.length;
  }

  private number(): void {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      this.source.slice(this.offset)
    );
    if (!match || !Number.isFinite(Number(match[0]))) fail('invalid-json');
    this.offset += match[0].length;
  }
}

/** Rebuilds every field; never serializes caller-owned objects or their hooks. */
export function encodeJournal(value: unknown, options?: Partial<JournalLimits>): Uint8Array {
  return guarded('invalid-journal', () => {
    const limits = resolveLimits(options);
    const journal = readJournal(value, limits);
    return new TextEncoder().encode(JSON.stringify(journal) + '\n');
  });
}

/** Fatal UTF-8, no BOM/duplicate decoded keys/prototype keys, strict schema revalidation. */
export function decodeJournal(
  bytes: Uint8Array,
  options?: Partial<JournalLimits>
): ResumabilityJournal {
  return guarded('invalid-json', () => {
    const limits = resolveLimits(options);
    const owned = ownedBytes(bytes, limits);
    if (owned[0] === 0xef && owned[1] === 0xbb && owned[2] === 0xbf) fail('invalid-json');
    const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(owned);
    new JsonScanner(source).scan();
    return readJournal(JSON.parse(source) as unknown, limits);
  });
}
