import type { JsonValue, SourceReference } from '../../types';
import {
  ChatGptNormalizationError,
  MAX_IDENTIFIER_LENGTH,
  type AssetContext,
  type JsonRecord,
  type PrivacyTracker,
  type SanitizedJson,
} from './contracts';

const MAX_DEPTH = 16;
const MAX_ENTRIES = 512;
const MAX_STRING_LENGTH = 32_768;
const UNSAFE_MAP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SENSITIVE_QUERY_KEY =
  /^(?:access[_-]?token|token|session[_-]?token|api[_-]?key|auth|authorization|jwt|credential|credentials|sig|signature|x-goog-(?:signature|credential|algorithm|date|expires|signedheaders)|x-amz-(?:signature|credential|security-token|expires)|expires|se|sp)$/i;
const SENSITIVE_URI_PREFIX = /^(?:data:|blob:|file:|file-service:|attachment:)/i;
const URI_CANDIDATE = /(?:https?:\/\/|data:|blob:|file:|file-service:|attachment:)[^\s<>"']+/gi;

interface CloneState {
  entries: number;
  truncated: boolean;
  redacted: boolean;
  ancestors: WeakSet<object>;
}

export function fail(code: string, message: string): never {
  throw new ChatGptNormalizationError(code, message);
}

export function isPlainRecord(value: unknown): value is JsonRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function requireRecord(value: unknown, pointer: string, code: string): JsonRecord {
  if (!isPlainRecord(value)) fail(code, `${pointer} must be a plain JSON object.`);
  return value;
}

export function assertSafeIdentifier(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    hasControlChars(value) ||
    UNSAFE_MAP_KEYS.has(value) ||
    isSignedOrTemporaryUrl(value)
  ) {
    fail('unsafe-id', `${label} must be a bounded non-dangerous string identifier.`);
  }
}

export function requireBoundedString(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    hasControlChars(value)
  ) {
    fail('malformed-string-field', `${label} must be a bounded non-empty string.`);
  }
  return value;
}

export function pointerAt(base: string, ...segments: string[]): string {
  const suffix = segments.map(pointerSegment).join('/');
  return base === '' ? `/${suffix}` : `${base}/${suffix}`;
}

export function pointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function sourceRef(
  context: Pick<AssetContext, 'artifactId' | 'format'>,
  kind: string,
  id: string | null,
  rawPointer: string | null
): SourceReference {
  if (id !== null) assertSafeIdentifier(id, `source ${kind} id`);
  if (rawPointer !== null && rawPointer !== '' && !rawPointer.startsWith('/')) {
    fail('invalid-pointer', `Raw JSON Pointer ${rawPointer} is invalid.`);
  }
  return { format: context.format, kind, id, artifactId: context.artifactId, rawPointer };
}

export function normalizeTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value === 'number') return unixTimestamp(value, label);
  if (typeof value !== 'string' || !isStrictIsoTimestamp(value)) {
    fail('invalid-timestamp', `${label} must be an ISO 8601 timestamp, Unix seconds, or null.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail('invalid-timestamp', `${label} is not a valid timestamp.`);
  return date.toISOString();
}

export function optionalTimestamp(
  record: JsonRecord,
  fields: string[],
  pointer: string
): string | null {
  const present = fields.filter(field => hasOwn(record, field));
  if (present.length === 0) return null;
  const values = present.map(field => normalizeTimestamp(record[field], pointerAt(pointer, field)));
  if (new Set(values).size !== 1) {
    fail('ambiguous-timestamp', `Timestamp aliases at ${pointer} disagree.`);
  }
  return values[0] ?? null;
}

export function nullableString(record: JsonRecord, field: string, pointer: string): string | null {
  if (!hasOwn(record, field) || record[field] === null) return null;
  if (typeof record[field] !== 'string') {
    fail('malformed-string-field', `${pointer} must be a string or null.`);
  }
  return record[field];
}

export function nullableAliasedString(
  candidates: Array<[JsonRecord, string, string]>,
  ambiguityCode: string
): string | null {
  const present = candidates.filter(([record, field]) => hasOwn(record, field));
  if (present.length === 0) return null;
  const values = present.map(([record, field, pointer]) => {
    const value = record[field];
    if (value !== null && typeof value !== 'string') {
      fail('malformed-string-field', `${pointerAt(pointer, field)} must be a string or null.`);
    }
    return value;
  });
  if (new Set(values).size !== 1) fail(ambiguityCode, 'Provider aliases disagree.');
  return values[0] ?? null;
}

export function sanitizeJson(
  value: unknown,
  privacy?: PrivacyTracker,
  pointer = ''
): SanitizedJson {
  const state: CloneState = {
    entries: 0,
    truncated: false,
    redacted: false,
    ancestors: new WeakSet(),
  };
  const result = cloneJson(value, state, 0, privacy, pointer);
  return {
    value: annotateResult(result, state),
    redacted: state.redacted,
    truncated: state.truncated,
  };
}

/** Preserve only provider fields that have not already been mapped elsewhere. */
export function providerFields(
  record: JsonRecord,
  excluded: ReadonlySet<string>,
  privacy?: PrivacyTracker,
  pointer = ''
): JsonValue {
  const selected: Record<string, JsonValue> = {};
  for (const key of Object.keys(record)) {
    if (excluded.has(key)) continue;
    if (isSensitiveFieldName(key)) {
      recordPrivacyRedaction(
        privacy,
        'privacy-redacted-sensitive-extension-field',
        'A sensitive provider field was omitted from canonical extensions.',
        pointerAt(pointer, key)
      );
      continue;
    }
    defineOwn(selected, key, sanitizeJson(record[key], privacy, pointerAt(pointer, key)).value);
  }
  return selected;
}

export function sanitizedCitationUrl(
  value: unknown,
  pointer: string,
  context: Pick<AssetContext, 'privacy'>
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') fail('malformed-citation', `${pointer} must be a string or null.`);
  if (!isOrdinaryHttpUrl(value) || isSensitiveUrl(value)) {
    recordPrivacyRedaction(
      context.privacy,
      'privacy-redacted-signed-citation-url',
      'A signed, temporary, or unsafe citation URL was removed from the canonical archive.',
      pointer
    );
    return null;
  }
  return value;
}

export function isSignedOrTemporaryUrl(value: string): boolean {
  return isSensitiveUrl(value);
}

export function redactSensitiveUrls(value: string, privacy?: PrivacyTracker, pointer = ''): string {
  return value.replace(URI_CANDIDATE, candidate => {
    if (!isSensitiveUrl(candidate)) return candidate;
    recordPrivacyRedaction(
      privacy,
      'privacy-redacted-sensitive-url',
      'A sensitive URL or provider URI was redacted from canonical data.',
      pointer
    );
    return '[redacted-sensitive-url]';
  });
}

export function looksLikeUrl(value: string): boolean {
  return /^(?:https?:|data:|blob:|file:|file-service:|attachment:)/i.test(value);
}

export function recordPrivacyRedaction(
  privacy: PrivacyTracker | undefined,
  code: string,
  message: string,
  pointer: string
): void {
  if (!privacy) return;
  if (privacy.redactions.some(entry => entry.code === code && entry.pointer === pointer)) return;
  privacy.redactions.push({ code, message, pointer });
}

export function isFiniteSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function unixTimestamp(value: number, label: string): string {
  if (!Number.isFinite(value) || !Number.isSafeInteger(Math.trunc(value * 1000))) {
    fail('invalid-timestamp', `${label} must be a finite Unix timestamp.`);
  }
  const milliseconds = Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime()))
    fail('invalid-timestamp', `${label} is outside the Date range.`);
  return date.toISOString();
}

function cloneJson(
  value: unknown,
  state: CloneState,
  depth: number,
  privacy: PrivacyTracker | undefined,
  pointer: string
): JsonValue {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      fail('malformed-json', 'Provider data contains a non-finite number.');
    return value;
  }
  if (typeof value === 'string') return sanitizedString(value, state, privacy, pointer);
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    fail('malformed-json', 'Provider data must be JSON-safe.');
  }
  if (depth >= MAX_DEPTH) return truncate(state, '[truncated-depth]');
  if (state.ancestors.has(value))
    fail('malformed-json', 'Provider data contains a reference cycle.');
  state.ancestors.add(value);
  const result = Array.isArray(value)
    ? cloneArray(value, state, depth, privacy, pointer)
    : cloneObject(value, state, depth, privacy, pointer);
  state.ancestors.delete(value);
  return result;
}

function cloneArray(
  value: unknown[],
  state: CloneState,
  depth: number,
  privacy: PrivacyTracker | undefined,
  pointer: string
): JsonValue[] {
  const result: JsonValue[] = [];
  for (const entry of value) {
    if (state.entries >= MAX_ENTRIES) break;
    state.entries += 1;
    result.push(
      cloneJson(entry, state, depth + 1, privacy, pointerAt(pointer, String(result.length)))
    );
  }
  if (state.entries >= MAX_ENTRIES && value.length > result.length) state.truncated = true;
  return result;
}

function cloneObject(
  value: JsonRecord,
  state: CloneState,
  depth: number,
  privacy: PrivacyTracker | undefined,
  pointer: string
): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(value)) {
    if (state.entries >= MAX_ENTRIES) break;
    state.entries += 1;
    if (isSensitiveFieldName(key)) {
      state.redacted = true;
      recordPrivacyRedaction(
        privacy,
        'privacy-redacted-sensitive-value',
        'A sensitive provider value was omitted from canonical data.',
        pointerAt(pointer, key)
      );
      continue;
    }
    defineOwn(
      result,
      key,
      cloneJson(value[key], state, depth + 1, privacy, pointerAt(pointer, key))
    );
  }
  if (state.entries >= MAX_ENTRIES && Object.keys(value).length > Object.keys(result).length) {
    state.truncated = true;
  }
  return result;
}

function annotateResult(value: JsonValue, state: CloneState): JsonValue {
  if (!state.truncated && !state.redacted) return value;
  if (isPlainRecord(value)) {
    const annotated: Record<string, JsonValue> = {};
    Object.keys(value).forEach(key => defineOwn(annotated, key, value[key]));
    if (state.truncated) defineOwn(annotated, '_liskaTruncated', true);
    if (state.redacted) defineOwn(annotated, '_liskaRedactedSensitiveValue', true);
    return annotated;
  }
  return {
    value,
    _liskaTruncated: state.truncated,
    _liskaRedactedSensitiveValue: state.redacted,
  };
}

function sanitizedString(
  value: string,
  state: CloneState,
  privacy: PrivacyTracker | undefined,
  pointer: string
): string {
  const redactedValue = redactSensitiveUrls(value, privacy, pointer);
  if (redactedValue !== value) state.redacted = true;
  if (redactedValue.length <= MAX_STRING_LENGTH) return redactedValue;
  state.truncated = true;
  return `${redactedValue.slice(0, MAX_STRING_LENGTH)}…[truncated]`;
}

function truncate(state: CloneState, marker: string): string {
  state.truncated = true;
  return marker;
}

function isSensitiveFieldName(key: string): boolean {
  const compact = key.replace(/[_-]/g, '').toLowerCase();
  if (
    new Set([
      'authorization',
      'cookie',
      'accesstoken',
      'sessiontoken',
      'apikey',
      'secret',
      'signature',
      'xgoogsignature',
      'xamzsignature',
      'assetpointer',
      'data',
      'base64',
      'bytes',
      'inlinedata',
    ]).has(compact)
  ) {
    return true;
  }
  if (
    /^(?:correlation|account|user|request|session|organization|workspace|tenant)(?:id|identifier|uuid|token)?$/.test(
      compact
    )
  ) {
    return true;
  }
  return compact.endsWith('url') || compact.endsWith('uri');
}

function isSensitiveUrl(value: string): boolean {
  if (SENSITIVE_URI_PREFIX.test(value)) return true;
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return true;
    return [...parsed.searchParams.keys()].some(key => SENSITIVE_QUERY_KEY.test(key));
  } catch {
    return true;
  }
}

function isOrdinaryHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isStrictIsoTimestamp(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
      value
    );
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59
  );
}

function daysInMonth(year: number, month: number): number {
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

function hasControlChars(value: string): boolean {
  return Array.from(value).some(character => character.codePointAt(0)! <= 0x1f);
}

function defineOwn(record: Record<string, JsonValue>, key: string, value: JsonValue): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}
