import {
  HTML_PRESENTATION_LIMITS,
  HtmlPresentationError,
  type HtmlDiagnosticCode,
  type HtmlPresentationDiagnostic,
  type HtmlPresentationErrorCode,
  type HtmlPresentationLimits,
} from './contracts';

export const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
export const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export function fail(code: HtmlPresentationErrorCode): never {
  throw new HtmlPresentationError(code);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}

export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => hasOwn(value, key));
}

export function resolveLimits(value: unknown): HtmlPresentationLimits {
  const limits: HtmlPresentationLimits = { ...HTML_PRESENTATION_LIMITS };
  if (value === undefined) return limits;
  if (!isRecord(value)) fail('html-limits-invalid');
  for (const key of Object.keys(value)) {
    if (!hasOwn(limits, key)) fail('html-limits-invalid');
    const field = key as keyof HtmlPresentationLimits;
    const number = value[key];
    if (
      !Number.isSafeInteger(number) ||
      (number as number) <= 0 ||
      (number as number) > limits[field]
    ) {
      fail('html-limits-invalid');
    }
    limits[field] = number as number;
  }
  return limits;
}

interface JsonFrame {
  value: unknown;
  depth: number;
  leave?: boolean;
}
interface JsonBudget {
  chars: number;
  scheduledNodes: number;
}

function jsonChildren(
  current: object,
  frame: JsonFrame,
  stack: JsonFrame[],
  budget: JsonBudget,
  limits: HtmlPresentationLimits
): void {
  const array = Array.isArray(current);
  const keys = Reflect.ownKeys(current);
  budget.scheduledNodes += keys.length - (array ? 1 : 0);
  if (budget.scheduledNodes > limits.maxInputJsonNodes) fail('html-input-node-limit');
  for (let index = keys.length - 1; index >= 0; index--) {
    const key = keys[index];
    if (typeof key !== 'string') fail('html-input-invalid');
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
    if (!hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('html-input-invalid');
    if (array && !/^(0|[1-9]\d*)$/.test(key)) fail('html-input-invalid');
    budget.chars += key.length;
    stack.push({ value: descriptor.value, depth: frame.depth + 1 });
  }
  if (array && Object.keys(current).length !== current.length) fail('html-input-invalid');
}

function isJsonPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/**
 * Bound JSON work before the core validator's recursive JSON extension checks.
 * Reject accessors/toJSON/functions/cycles without invoking them. The traversal
 * is iterative; the validator never receives a depth beyond this ceiling.
 */
export function preflightJson(value: unknown, limits: HtmlPresentationLimits): void {
  const active = new Set<object>();
  const stack: JsonFrame[] = [{ value, depth: 0 }];
  let nodes = 0;
  const budget = { chars: 0, scheduledNodes: 1 };
  while (stack.length) {
    const frame = stack.pop()!;
    if (frame.leave) {
      active.delete(frame.value as object);
      continue;
    }
    if (++nodes > limits.maxInputJsonNodes) fail('html-input-node-limit');
    if (frame.depth > limits.maxInputJsonDepth) fail('html-input-depth-limit');
    const current = frame.value;
    if (typeof current === 'string') {
      budget.chars += current.length;
    } else if (current !== null && typeof current === 'object') {
      const array = Array.isArray(current);
      if (
        (array && Object.getPrototypeOf(current) !== Array.prototype) ||
        (!array && !isRecord(current)) ||
        active.has(current)
      ) {
        fail('html-input-invalid');
      }
      active.add(current);
      stack.push({ value: current, depth: frame.depth, leave: true });
      jsonChildren(current, frame, stack, budget, limits);
    } else if (!isJsonPrimitive(current)) {
      fail('html-input-invalid');
    }
    if (budget.chars > limits.maxInputChars) fail('html-input-char-limit');
  }
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  );
}

/** No base URL, relative resolution, whitespace trimming, credentials, or protocol coercion. */
export function isSafeUserLink(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 32 || code === 127 || char === '\\') return false;
  }
  try {
    const url = new URL(value);
    const authority = value.slice(value.indexOf('//') + 2).split(/[/?#]/, 1)[0];
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname.length > 0 &&
      url.username === '' &&
      url.password === '' &&
      !authority.includes('@')
    );
  } catch {
    return false;
  }
}

export class PresentationContext {
  private outputChars = 0;
  private outputBytes = 0;
  private sourceChars = 0;
  private markdownNodes = 0;
  private markdownContainerTokens = 0;
  private serializationChars = 0;
  private readonly counts = new Map<HtmlDiagnosticCode, number>();

  constructor(readonly limits: HtmlPresentationLimits) {}

  diagnostic(code: HtmlDiagnosticCode): void {
    this.counts.set(code, (this.counts.get(code) ?? 0) + 1);
  }

  diagnostics(): HtmlPresentationDiagnostic[] {
    return [...this.counts]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([code, count]) => ({ code, count }));
  }

  source(value: string): void {
    this.sourceChars += value.length;
    if (this.sourceChars > this.limits.maxSourceChars) fail('html-source-char-limit');
  }

  markdownNode(depth: number): void {
    if (++this.markdownNodes > this.limits.maxMarkdownNodes) fail('html-markdown-node-limit');
    if (depth > this.limits.maxMarkdownDepth) fail('html-markdown-depth-limit');
  }

  markdownContainers(count: number): void {
    this.markdownContainerTokens += count;
    if (this.markdownContainerTokens > this.limits.maxMarkdownContainerTokens)
      fail('html-markdown-container-limit');
  }

  /** Count emitted fragments once, before joining; no repeated growing-string copies. */
  emit(parts: string[], value: string): void {
    this.outputChars += value.length;
    this.outputBytes += utf8ByteLength(value);
    if (this.outputChars > this.limits.maxHtmlChars) fail('html-output-limit');
    if (this.outputBytes > this.limits.maxHtmlBytes) fail('html-output-limit');
    parts.push(value);
  }

  json(value: unknown): string {
    // Preflight excludes getters/toJSON/cycles. Serialize incrementally rather
    // than materializing an unbounded JSON string and checking its size later.
    const parts: string[] = [];
    const stack: { value?: unknown; literal?: string }[] = [{ value }];
    const append = (text: string): void => {
      this.serializationChars += text.length;
      if (this.serializationChars > this.limits.maxJsonSerializationChars)
        fail('html-json-serialization-limit');
      parts.push(text);
    };
    while (stack.length) {
      const frame = stack.pop()!;
      if (frame.literal !== undefined) {
        append(frame.literal);
      } else if (frame.value !== null && typeof frame.value === 'object') {
        const current = frame.value;
        const array = Array.isArray(current);
        const keys = Object.keys(current);
        append(array ? '[' : '{');
        stack.push({ literal: array ? ']' : '}' });
        for (let index = keys.length - 1; index >= 0; index--) {
          if (index < keys.length - 1) stack.push({ literal: ',' });
          stack.push({ value: (current as Record<string, unknown>)[keys[index]] });
          if (!array) {
            stack.push({ literal: ':' });
            stack.push({ value: keys[index] });
          }
        }
      } else {
        if (
          typeof frame.value === 'string' &&
          frame.value.length > this.limits.maxJsonSerializationChars - this.serializationChars
        ) {
          fail('html-json-serialization-limit');
        }
        append(JSON.stringify(frame.value));
      }
    }
    return parts.join('');
  }
}

/** Exact TextEncoder-compatible byte count without allocating another full output buffer. */
function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}
