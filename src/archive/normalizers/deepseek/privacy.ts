import type { JsonValue, SourceReference } from '../../types';
import { DEEPSEEK_SOURCE_FORMAT, deepSeekFail, type DeepSeekJsonRecord } from './contracts';

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_DEPTH = 16;
const MAX_ENTRIES = 512;
const MAX_STRING_LENGTH = 32_768;
const UNSAFE_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const SENSITIVE_FIELD =
  /^(?:authorization|cookie|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|api[_-]?key|x[_-]?api[_-]?key|secret|client[_-]?secret|private[_-]?key|password|signature|signed[_-]?path|credential|credentials)$/i;
const SENSITIVE_QUERY =
  /^(?:token|access[_-]?token|session[_-]?token|api[_-]?key|auth|authorization|jwt|credential|signature|sig|x-amz-.+|x-goog-.+)$/i;
const URL_CANDIDATE = /https?:\/\/[^\s<>"']+/gi;
const CREDENTIAL_TEXT =
  /\bauthorization\s*:\s*(?:bearer\s+)?[A-Za-z0-9._~+/=-]+|\bcookie\s*:\s*[^\s,;}]+|\bbearer\s+[A-Za-z0-9._~+/=-]+/gi;

export interface DeepSeekPrivacyRedaction {
  code: string;
  message: string;
  pointer: string;
}

export interface DeepSeekPrivacyTracker {
  redactions: DeepSeekPrivacyRedaction[];
}

interface CloneState {
  entries: number;
  redacted: boolean;
  truncated: boolean;
}

export function isPlainRecord(value: unknown): value is DeepSeekJsonRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function hasOwn(record: DeepSeekJsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function pointerAt(base: string, ...segments: string[]): string {
  const suffix = segments
    .map(segment => segment.replace(/~/g, '~0').replace(/\//g, '~1'))
    .join('/');
  return base ? `${base}/${suffix}` : `/${suffix}`;
}

export function requireSafeIdentifier(value: unknown, label: string): string {
  const id =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : '';
  if (
    !id ||
    id.length > MAX_IDENTIFIER_LENGTH ||
    Array.from(id).some(character => (character.codePointAt(0) ?? 0) <= 0x1f) ||
    UNSAFE_IDS.has(id) ||
    /^https?:\/\//i.test(id)
  ) {
    deepSeekFail('unsafe-id', `${label} must be a bounded non-dangerous identifier.`);
  }
  return id;
}

export function sourceRef(
  artifactId: string,
  kind: string,
  id: string | null,
  rawPointer: string,
  format: string = DEEPSEEK_SOURCE_FORMAT
): SourceReference {
  return { format, kind, id, artifactId, rawPointer };
}

export function normalizeTimestamp(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  const date =
    typeof value === 'number'
      ? new Date(Math.abs(value) < 100_000_000_000 ? value * 1000 : value)
      : typeof value === 'string'
        ? new Date(value)
        : null;
  if (!date || Number.isNaN(date.getTime())) {
    deepSeekFail('invalid-timestamp', `${label} must be an ISO timestamp or Unix time.`);
  }
  return date.toISOString();
}

export function sanitizeJson(
  value: unknown,
  tracker: DeepSeekPrivacyTracker,
  pointer: string
): JsonValue {
  const state: CloneState = { entries: 0, redacted: false, truncated: false };
  const sanitized = cloneJson(value, tracker, pointer, state, 0);
  if (!state.redacted && !state.truncated) return sanitized;
  if (isPlainRecord(sanitized)) {
    if (state.redacted) sanitized._liskaRedactedSensitiveValue = true;
    if (state.truncated) sanitized._liskaTruncated = true;
    return sanitized as JsonValue;
  }
  return {
    value: sanitized,
    _liskaRedactedSensitiveValue: state.redacted,
    _liskaTruncated: state.truncated,
  };
}

// eslint-disable-next-line max-lines-per-function, complexity -- One bounded walk keeps redaction, entry, and depth limits coupled.
function cloneJson(
  value: unknown,
  tracker: DeepSeekPrivacyTracker,
  pointer: string,
  state: CloneState,
  depth: number
): JsonValue {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) deepSeekFail('malformed-json', 'Provider JSON is non-finite.');
    return value;
  }
  if (typeof value === 'string') return sanitizeString(value, tracker, pointer, state);
  if (depth >= MAX_DEPTH) {
    state.truncated = true;
    return '[truncated-depth]';
  }
  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    for (let index = 0; index < value.length && state.entries < MAX_ENTRIES; index += 1) {
      state.entries += 1;
      result.push(
        cloneJson(value[index], tracker, pointerAt(pointer, String(index)), state, depth + 1)
      );
    }
    if (result.length < value.length) state.truncated = true;
    return result;
  }
  if (!isPlainRecord(value)) deepSeekFail('malformed-json', 'Provider data is not JSON-safe.');
  const result: Record<string, JsonValue> = {};
  const keys = Object.keys(value);
  for (const key of keys) {
    if (state.entries >= MAX_ENTRIES) break;
    state.entries += 1;
    if (isSensitiveField(key)) {
      state.redacted = true;
      recordRedaction(tracker, isSignedPathField(key) ? pointer : pointerAt(pointer, key));
      continue;
    }
    if (UNSAFE_IDS.has(key)) {
      state.redacted = true;
      recordRedaction(tracker, pointerAt(pointer, key));
      continue;
    }
    result[key] = cloneJson(value[key], tracker, pointerAt(pointer, key), state, depth + 1);
  }
  if (Object.keys(result).length < keys.length && state.entries >= MAX_ENTRIES) {
    state.truncated = true;
  }
  return result;
}

function isSensitiveField(key: string): boolean {
  const compact = key.replace(/[-_]/g, '').toLowerCase();
  return (
    SENSITIVE_FIELD.test(key) ||
    compact.startsWith('authorization') ||
    compact.startsWith('cookie') ||
    compact.startsWith('credential') ||
    compact.endsWith('token') ||
    compact.endsWith('secret') ||
    compact.endsWith('password') ||
    compact.endsWith('signature') ||
    compact.endsWith('signedpath') ||
    compact.endsWith('url') ||
    compact.endsWith('uri')
  );
}

function isSignedPathField(key: string): boolean {
  return key.replace(/[-_]/g, '').toLowerCase().endsWith('signedpath');
}

function sanitizeString(
  value: string,
  tracker: DeepSeekPrivacyTracker,
  pointer: string,
  state: CloneState
): string {
  const redacted = redactSensitiveText(value, tracker, pointer, () => {
    state.redacted = true;
  });
  if (redacted.length <= MAX_STRING_LENGTH) return redacted;
  state.truncated = true;
  return `${redacted.slice(0, MAX_STRING_LENGTH)}…[truncated]`;
}

/** Redact credential text and signed/temporary URLs without truncating visible content. */
export function redactSensitiveText(
  value: string,
  tracker: DeepSeekPrivacyTracker,
  pointer: string,
  onRedaction?: () => void
): string {
  const withoutCredentials = value.replace(CREDENTIAL_TEXT, () => {
    onRedaction?.();
    recordRedaction(tracker, pointer);
    return '[redacted-credential]';
  });
  return withoutCredentials.replace(URL_CANDIDATE, candidate => {
    if (!isSensitiveUrl(candidate)) return candidate;
    onRedaction?.();
    recordRedaction(tracker, pointer);
    return '[redacted-sensitive-url]';
  });
}

function isSensitiveUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      Boolean(parsed.username || parsed.password) ||
      [...parsed.searchParams.keys()].some(key => SENSITIVE_QUERY.test(key))
    );
  } catch {
    return true;
  }
}

function recordRedaction(tracker: DeepSeekPrivacyTracker, pointer: string): void {
  if (tracker.redactions.some(entry => entry.pointer === pointer)) return;
  tracker.redactions.push({
    code: 'privacy-redacted-sensitive-extension-field',
    message: 'A sensitive DeepSeek provider value was omitted from canonical extensions.',
    pointer,
  });
}
