import { fail } from './privacy';

/** Embedded Canmore JSON is optional canonical enrichment; exact bytes remain in raw capture. */
export const MAX_CANMORE_JSON_TEXT_LENGTH = 4 * 1024 * 1024;
/** Four times the canonical sanitizer depth keeps existing truncate-and-succeed behavior bounded. */
export const MAX_CANMORE_JSON_NESTING = 64;
/** Eight times the canonical entry budget bounds parse allocation before sanitization. */
export const MAX_CANMORE_JSON_TOKENS = 4_096;

function isJsonWhitespace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\r' || character === '\n';
}

function trimmedJsonBounds(value: string): { start: number; end: number } | null {
  let start = 0;
  while (start < value.length && isJsonWhitespace(value[start])) start += 1;
  if (start === value.length) return null;
  let end = value.length - 1;
  while (end > start && isJsonWhitespace(value[end])) end -= 1;
  return { start, end };
}

function isJsonParseCandidate(value: string): boolean {
  const bounds = trimmedJsonBounds(value);
  if (!bounds) return false;
  const first = value[bounds.start];
  const length = bounds.end - bounds.start + 1;
  if (first === '{' || first === '[' || first === '"') return true;
  if (first === '-' || /[0-9]/.test(first)) return true;
  if (first === 't') return length === 4 && value.startsWith('true', bounds.start);
  if (first === 'f') return length === 5 && value.startsWith('false', bounds.start);
  if (first === 'n') return length === 4 && value.startsWith('null', bounds.start);
  return false;
}

function failCanmoreJsonBudget(): never {
  fail('canmore-json-budget-exceeded', 'Canmore JSON payload exceeds the bounded parse limits.');
}

// eslint-disable-next-line complexity -- Quote, escape, depth, and token state form one non-materializing JSON preflight.
function assertCanmoreJsonParseBudget(value: string): void {
  if (value.length > MAX_CANMORE_JSON_TEXT_LENGTH) failCanmoreJsonBudget();

  let depth = 0;
  let tokens = 0;
  let inString = false;
  let escaped = false;
  for (const character of value) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{' || character === '[') {
      depth += 1;
      tokens += 1;
      if (depth > MAX_CANMORE_JSON_NESTING || tokens > MAX_CANMORE_JSON_TOKENS) {
        failCanmoreJsonBudget();
      }
      continue;
    }
    if (character === '}' || character === ']') {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (character === ',' || character === ':') {
      tokens += 1;
      if (tokens > MAX_CANMORE_JSON_TOKENS) failCanmoreJsonBudget();
    }
  }
}

/** Parse one JSON-looking Canmore string only after a non-materializing structural preflight. */
export function parseCanmoreJsonString(value: unknown): unknown {
  if (typeof value !== 'string' || !isJsonParseCandidate(value)) return value;
  assertCanmoreJsonParseBudget(value);
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
