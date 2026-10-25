import type { ChatGptReconciliationDeliveryErrorCode } from './contracts';

export type DeliveryFail = (code: ChatGptReconciliationDeliveryErrorCode) => never;

interface Container {
  closer: string;
  keys: Set<string> | null;
  expectKey: boolean;
}

interface ScanState {
  stack: Container[];
  inString: boolean;
  escaped: boolean;
  inScalar: boolean;
  keyStart: number | null;
  values: number;
}

function stringEnd(text: string, index: number, state: ScanState, fail: DeliveryFail): void {
  state.inString = false;
  if (state.keyStart === null) return;
  let key: unknown;
  try {
    key = JSON.parse(text.slice(state.keyStart, index + 1));
  } catch {
    fail('web-invalid-json');
  }
  const frame = state.stack[state.stack.length - 1];
  if (!frame?.keys || typeof key !== 'string') fail('web-invalid-json');
  if (frame.keys.has(key)) fail('web-duplicate-key');
  frame.keys.add(key);
  frame.expectKey = false;
  state.keyStart = null;
}

function inString(text: string, index: number, state: ScanState, fail: DeliveryFail): void {
  const char = text[index];
  if (state.escaped) state.escaped = false;
  else if (char === '\\') state.escaped = true;
  else if (char === '"') stringEnd(text, index, state, fail);
}

function addValue(state: ScanState, maximum: number, fail: DeliveryFail): void {
  state.values += 1;
  if (state.values > maximum) fail('web-json-limit');
}

function startString(index: number, state: ScanState, maximum: number, fail: DeliveryFail): void {
  state.inString = true;
  const frame = state.stack[state.stack.length - 1];
  if (frame?.keys && frame.expectKey) state.keyStart = index;
  else addValue(state, maximum, fail);
}

function punctuation(char: string, state: ScanState, fail: DeliveryFail): boolean {
  if (char === '}' || char === ']') {
    if (state.stack.pop()?.closer !== char) fail('web-invalid-json');
  } else if (char === ',') {
    const frame = state.stack[state.stack.length - 1];
    if (frame?.keys) frame.expectKey = true;
  } else if (char !== ':' && !/\s/.test(char)) return false;
  state.inScalar = false;
  return true;
}

/** Reject duplicate decoded keys and excessive nesting before JSON.parse allocates the tree. */
function inspectJson(text: string, maxDepth: number, maxValues: number, fail: DeliveryFail): void {
  const state: ScanState = {
    stack: [],
    inString: false,
    escaped: false,
    inScalar: false,
    keyStart: null,
    values: 0,
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (state.inString) inString(text, index, state, fail);
    else if (char === '"') startString(index, state, maxValues, fail);
    else if (char === '{' || char === '[') {
      addValue(state, maxValues, fail);
      state.stack.push({
        closer: char === '{' ? '}' : ']',
        keys: char === '{' ? new Set() : null,
        expectKey: true,
      });
      if (state.stack.length > maxDepth) fail('web-json-limit');
      state.inScalar = false;
    } else if (!punctuation(char, state, fail) && !state.inScalar) {
      addValue(state, maxValues, fail);
      state.inScalar = true;
    }
  }
  if (state.inString || state.stack.length) fail('web-invalid-json');
}

export function parseWebCanonicalJson(
  bytes: Uint8Array,
  maxDepth: number,
  maxValues: number,
  fail: DeliveryFail
): unknown {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail('web-bom-not-supported');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('web-invalid-utf8');
  }
  if (!text.trimStart().startsWith('{')) fail('web-invalid-json');
  inspectJson(text, maxDepth, maxValues, fail);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail('web-invalid-json');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('web-invalid-json');
  return value;
}

export function serializeJsonArtifact(
  value: unknown,
  maxBytes: number,
  code: ChatGptReconciliationDeliveryErrorCode,
  fail: DeliveryFail,
  pretty = false
): Uint8Array {
  const text = pretty ? JSON.stringify(value, null, 2) : `${JSON.stringify(value)}\n`;
  if (text.length > maxBytes) fail(code);
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > maxBytes) fail(code);
  return bytes;
}
