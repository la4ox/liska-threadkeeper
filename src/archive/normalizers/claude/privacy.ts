import type { JsonValue, NamespacedExtensions, SourceReference } from '../../types';
import { CLAUDE_SOURCE_FORMAT, fail, type ClaudeContext, type ClaudeRecord } from './contracts';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SENSITIVE_KEY =
  /account|organization|organisation|owner|email|phone|telephone|mobilenumber|authorization|authentication|cookie|credential|password|secret|signature|signed|headers|session|token$|apikey|clientid|transport|^(?:auth|identity|user|creator|createdby|updatedby)$|^auth(?:key|token|data|info|value|scheme|method)|(?:user|creator|createdby|updatedby)(?:id|uuid|name|email|phone|mobile|profile|identity|details|info|metadata)(?:value|hash)?$|^(?:access|refresh|id|auth|bearer|csrf|xsrf|security)?token(?:value|key|id|hash|expiry|expires|expiration)$/i;
const SENSITIVE_QUERY =
  /^(?:.*token|api[_-]?key|auth|authorization|jwt|credential|signature|sig|state|expires|policy|key-pair-id|x-amz-.+|x-goog-.+)$/i;
const URL_CANDIDATE =
  /(?:https?:)?\/\/[^\s<>"'`]+|(?:^|[^\w/])(?:\/(?!\/)[^\s<>"'`]*\?|&(?:#\d{1,7}|#x[0-9a-f]{1,6}|amp|sol);)[^\s<>"'`]*/gi;
const CREDENTIAL =
  /\bauthorization\s*:\s*(?:bearer\s+)?[^\s,;}]+|\bcookie\s*:\s*[^\s,;}]+|\bbearer\s+[A-Za-z0-9._~+/=-]+/gi;
const LABELED_SENSITIVE_VALUE =
  /\b(?:auth[_-]?(?:key|token)|api[_-]?key|(?:access|refresh|id|session|csrf|xsrf)[_-]?token|token|(?:user|account|session)[_-]?(?:id|uuid)|(?:e[_-]?mail|phone|telephone|mobile)(?:[_-]?(?:address|number))?|password|secret)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi;

/** Collapse snake/camel/hyphen aliases without removing structural counters such as token_usage. */
function sensitiveField(key: string): boolean {
  const compact = key.replace(/[-_.\s]/g, '');
  return UNSAFE_KEYS.has(key) || SENSITIVE_KEY.test(compact) || /(?:url|uri)$/i.test(compact);
}

export function isRecord(value: unknown): value is ClaudeRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function at(base: string, ...parts: string[]): string {
  return `${base}/${parts.map(part => part.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;
}

export function identifier(value: unknown, pointer: string): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/.test(value) ||
    UNSAFE_KEYS.has(value)
  ) {
    fail('unsafe-id', `${pointer} must be a bounded safe identifier.`);
  }
  return value;
}

export function ref(
  context: Pick<ClaudeContext, 'artifactId'>,
  kind: string,
  pointer: string,
  id: string | null = null
): SourceReference {
  return {
    format: CLAUDE_SOURCE_FORMAT,
    kind,
    id,
    artifactId: context.artifactId,
    rawPointer: pointer,
  };
}

export function diagnostic(
  context: ClaudeContext,
  code: string,
  pointer: string,
  message: string,
  severity: 'info' | 'warning' = 'warning'
): void {
  const key = `${code}\u0000${pointer}`;
  if (context.diagnosticKeys.has(key)) return;
  context.diagnosticKeys.add(key);
  context.diagnostics.push({
    severity,
    code,
    message,
    path: null,
    sourceRefs: [ref(context, 'diagnostic', pointer)],
    extensions: {},
  });
}

function redacted(context: ClaudeContext, pointer: string): void {
  diagnostic(
    context,
    'privacy-redacted-sensitive-field',
    pointer,
    'A sensitive Claude provider value remains raw-only.'
  );
}

/** Visible text is not truncated; only obvious credentials and temporary capabilities are removed. */
export function text(value: string, context: ClaudeContext, pointer: string): string {
  return value
    .replace(LABELED_SENSITIVE_VALUE, () => {
      redacted(context, pointer);
      return '[redacted-credential]';
    })
    .replace(CREDENTIAL, () => {
      redacted(context, pointer);
      return '[redacted-credential]';
    })
    .replace(URL_CANDIDATE, candidate => {
      const token = candidate.replace(/^[^\w/&]*(?=\/|&)/, '');
      const prefix = candidate.slice(0, candidate.length - token.length);
      if (!sensitiveUrl(token)) return candidate;
      redacted(context, pointer);
      return `${prefix}[redacted-sensitive-url]`;
    });
}

function sensitiveUrl(value: string): boolean {
  try {
    const decoded = decodeCharacterReferences(value);
    const url = new URL(decoded, 'https://claude.ai');
    return (
      Boolean(url.username || url.password) ||
      [...url.searchParams.keys()].some(key => SENSITIVE_QUERY.test(key) || sensitiveField(key))
    );
  } catch {
    return true;
  }
}

function decodeCharacterReferences(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 3; pass += 1) {
    const previous = decoded;
    decoded = decoded.replace(
      /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(amp|sol|quest|equals));/gi,
      (
        reference,
        decimal: string | undefined,
        hex: string | undefined,
        named: string | undefined
      ) => {
        if (decimal !== undefined || hex !== undefined) {
          const codepoint = Number.parseInt(decimal ?? hex!, decimal === undefined ? 16 : 10);
          return codepoint > 0 && codepoint <= 0x10ffff
            ? String.fromCodePoint(codepoint)
            : reference;
        }
        return (
          ({ amp: '&', sol: '/', quest: '?', equals: '=' } as Record<string, string>)[
            named?.toLowerCase() ?? ''
          ] ?? reference
        );
      }
    );
    if (decoded === previous) break;
  }
  return decoded;
}

export function citationUrl(
  value: unknown,
  context: ClaudeContext,
  pointer: string
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && /^https?:\/\//i.test(value) && !sensitiveUrl(value))
    return value;
  redacted(context, pointer);
  return null;
}

/** One bounded JSON clone preserves unknown evidence without credential, identity or binary payloads. */
export function sanitize(value: unknown, context: ClaudeContext, pointer: string): JsonValue {
  const state = { entries: 0, truncated: false };
  function clone(current: unknown, location: string, depth: number): JsonValue {
    if (current === null || typeof current === 'boolean') return current;
    if (typeof current === 'number' && Number.isFinite(current)) return current;
    if (typeof current === 'string') {
      const cleaned = text(current, context, location);
      if (cleaned.length <= 32_768) return cleaned;
      state.truncated = true;
      return `${cleaned.slice(0, 32_768)}…[truncated]`;
    }
    if (depth >= 16 || state.entries >= 512) {
      state.truncated = true;
      return '[truncated]';
    }
    if (Array.isArray(current)) {
      const items: JsonValue[] = [];
      for (let index = 0; index < current.length && state.entries < 512; index += 1) {
        state.entries += 1;
        items.push(clone(current[index], at(location, String(index)), depth + 1));
      }
      if (items.length < current.length) state.truncated = true;
      return items;
    }
    if (!isRecord(current)) return null;
    const result: Record<string, JsonValue> = {};
    const keys = Object.keys(current);
    for (const key of keys) {
      if (state.entries >= 512) {
        state.truncated = true;
        break;
      }
      state.entries += 1;
      const binary = key === 'data' && (current.type === 'base64' || current.encoding === 'base64');
      if (sensitiveField(key) || binary) {
        redacted(context, at(location, key));
        continue;
      }
      result[key] = clone(current[key], at(location, key), depth + 1);
    }
    return result;
  }
  const result = clone(value, pointer, 0);
  if (!state.truncated) return result;
  diagnostic(
    context,
    'bounded-provider-value',
    pointer,
    'A provider extension or unknown block was bounded; exact evidence remains in the raw artifact.'
  );
  return isRecord(result)
    ? { ...(result as Record<string, JsonValue>), _liskaTruncated: true }
    : { value: result, _liskaTruncated: true };
}

export function residual(
  record: ClaudeRecord,
  excluded: readonly string[],
  context: ClaudeContext,
  pointer: string
): NamespacedExtensions {
  const selected = Object.fromEntries(
    Object.entries(record).filter(([key]) => !excluded.includes(key))
  );
  const cleaned = sanitize(selected, context, pointer);
  if (Object.keys(selected).length)
    diagnostic(
      context,
      'retained-provider-fields',
      pointer,
      'Unmapped Claude fields were retained in bounded, sanitized extensions.',
      'info'
    );
  return { claude: cleaned };
}

export function nullableText(
  value: unknown,
  context: ClaudeContext,
  pointer: string
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail('malformed-string-field', `${pointer} must be a string.`);
  return text(value, context, pointer);
}

export function timestamp(value: unknown, pointer: string): string | null {
  if (value === undefined || value === null) return null;
  const parsed =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : null;
  if (!parsed || !Number.isFinite(parsed.getTime()))
    fail('invalid-timestamp', `${pointer} must be an ISO timestamp.`);
  return parsed.toISOString();
}
