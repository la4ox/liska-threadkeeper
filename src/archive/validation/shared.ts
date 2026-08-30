import type { ArchiveValidationIssue, ArchiveValidationSeverity, UnknownRecord } from './contracts';

const HASH_PATTERN = /^[a-fA-F0-9]{64}$/;
const EXTENSION_NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

export const hasOwn: (object: object, key: PropertyKey) => boolean =
  (Object as { hasOwn?: (object: object, key: PropertyKey) => boolean }).hasOwn ??
  ((object, key) => Object.prototype.hasOwnProperty.call(object, key));

export function isPlainObject(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  try {
    return Object.getPrototypeOf(value) === Object.prototype;
  } catch {
    return false;
  }
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function pointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function addIssue(
  issues: ArchiveValidationIssue[],
  severity: ArchiveValidationSeverity,
  code: string,
  path: string,
  message: string
): void {
  issues.push({ severity, code, path, message });
}

export function expectExactObject(
  value: unknown,
  path: string,
  required: readonly string[],
  allowed: readonly string[],
  issues: ArchiveValidationIssue[],
  notObjectCode: string
): UnknownRecord | null {
  if (!isPlainObject(value)) {
    addIssue(issues, 'error', notObjectCode, path, 'Value must be a plain JSON object.');
    return null;
  }
  addMissingFields(value, path, required, issues);
  addUnexpectedFields(value, path, allowed, issues);
  return value;
}

function addMissingFields(
  value: UnknownRecord,
  path: string,
  required: readonly string[],
  issues: ArchiveValidationIssue[]
): void {
  required.forEach(field => {
    if (!hasOwn(value, field)) {
      addIssue(
        issues,
        'error',
        'required-field-missing',
        `${path}/${field}`,
        `${field} is required.`
      );
    }
  });
}

function addUnexpectedFields(
  value: UnknownRecord,
  path: string,
  allowed: readonly string[],
  issues: ArchiveValidationIssue[]
): void {
  const allowedFields = new Set(allowed);
  Object.keys(value).forEach(field => {
    if (!allowedFields.has(field)) {
      addIssue(
        issues,
        'error',
        'unexpected-property',
        `${path}/${pointerSegment(field)}`,
        'Property is not part of liska-thread/1 at this location.'
      );
    }
  });
}

export function validateJsonValue(
  value: unknown,
  path: string,
  issues: ArchiveValidationIssue[],
  ancestors = new WeakSet<object>()
): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    validateJsonNumber(value, path, issues);
  } else if (Array.isArray(value)) {
    validateJsonArray(value, path, issues, ancestors);
  } else {
    validateJsonObject(value, path, issues, ancestors);
  }
}

function validateJsonNumber(value: number, path: string, issues: ArchiveValidationIssue[]): void {
  if (!Number.isFinite(value)) {
    addIssue(issues, 'error', 'json-number-not-finite', path, 'JSON numbers must be finite.');
  }
}

function validateJsonArray(
  value: unknown[],
  path: string,
  issues: ArchiveValidationIssue[],
  ancestors: WeakSet<object>
): void {
  if (ancestors.has(value)) {
    addIssue(
      issues,
      'error',
      'json-value-cycle',
      path,
      'JSON values cannot contain reference cycles.'
    );
    return;
  }
  ancestors.add(value);
  value.forEach((child, index) => validateJsonValue(child, `${path}/${index}`, issues, ancestors));
  ancestors.delete(value);
}

function validateJsonObject(
  value: unknown,
  path: string,
  issues: ArchiveValidationIssue[],
  ancestors: WeakSet<object>
): void {
  if (!isPlainObject(value)) {
    addIssue(
      issues,
      'error',
      'json-value-not-safe',
      path,
      'Value must be a JSON primitive, array, or plain object.'
    );
    return;
  }
  if (ancestors.has(value)) {
    addIssue(
      issues,
      'error',
      'json-value-cycle',
      path,
      'JSON values cannot contain reference cycles.'
    );
    return;
  }
  ancestors.add(value);
  Object.keys(value).forEach(key => {
    validateJsonValue(value[key], `${path}/${pointerSegment(key)}`, issues, ancestors);
  });
  ancestors.delete(value);
}

export function validateNullableString(
  value: unknown,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (value !== null && typeof value !== 'string') {
    addIssue(issues, 'error', 'nullable-string-invalid', path, 'Value must be a string or null.');
  }
}

export function validateTimestamp(
  value: unknown,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (value === null) {
    return;
  }
  if (typeof value !== 'string' || !isValidTimestamp(value)) {
    addIssue(
      issues,
      'error',
      'timestamp-invalid',
      path,
      'Timestamp must be an ISO 8601 date-time string or null.'
    );
  }
}

function isValidTimestamp(value: string): boolean {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
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
  const lengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1] ?? 0;
}

export function validateHash(
  value: unknown,
  path: string,
  issues: ArchiveValidationIssue[],
  nullable: boolean
): void {
  if (nullable && value === null) {
    return;
  }
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    addIssue(
      issues,
      'error',
      'sha256-invalid',
      path,
      'SHA-256 must be exactly 64 hexadecimal characters.'
    );
  }
}

export function validateExtensions(
  value: unknown,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (!isPlainObject(value)) {
    addIssue(issues, 'error', 'extensions-not-object', path, 'Extensions must be a plain object.');
    return;
  }
  Object.keys(value).forEach(key => validateExtension(key, value, path, issues));
}

function validateExtension(
  key: string,
  value: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  const keyPath = `${path}/${pointerSegment(key)}`;
  if (!EXTENSION_NAMESPACE_PATTERN.test(key)) {
    addIssue(
      issues,
      'error',
      'extension-namespace-invalid',
      keyPath,
      'Extension keys must use lowercase provider or feature namespaces.'
    );
  }
  validateJsonValue(value[key], keyPath, issues);
}

export function validateMetadata(
  value: unknown,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (!isPlainObject(value)) {
    addIssue(issues, 'error', 'metadata-not-object', path, 'Metadata must be a plain JSON object.');
    return;
  }
  Object.keys(value).forEach(key => {
    validateJsonValue(value[key], `${path}/${pointerSegment(key)}`, issues);
  });
}

export function validateSourceReferences(
  value: unknown,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (!Array.isArray(value)) {
    addIssue(issues, 'error', 'source-refs-not-array', path, 'Source references must be an array.');
    return;
  }
  if (value.length === 0) {
    addIssue(
      issues,
      'error',
      'source-refs-missing',
      path,
      'This value must retain at least one source reference.'
    );
  }
  value.forEach((sourceRef, index) =>
    validateSourceReference(sourceRef, `${path}/${index}`, issues)
  );
}

function validateSourceReference(
  value: unknown,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  const sourceRef = expectExactObject(
    value,
    path,
    ['format', 'kind', 'id', 'artifactId', 'rawPointer'],
    ['format', 'kind', 'id', 'artifactId', 'rawPointer'],
    issues,
    'source-ref-not-object'
  );
  if (!sourceRef) {
    return;
  }
  validateSourceIdentity(sourceRef, path, issues);
  validateNullableString(sourceRef.id, `${path}/id`, issues);
  validateNullableString(sourceRef.artifactId, `${path}/artifactId`, issues);
  validateRawPointer(sourceRef.rawPointer, `${path}/rawPointer`, issues);
}

function validateSourceIdentity(
  sourceRef: UnknownRecord,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (!isNonEmptyString(sourceRef.format)) {
    addIssue(
      issues,
      'error',
      'source-ref-format-invalid',
      `${path}/format`,
      'Format must be non-empty.'
    );
  }
  if (!isNonEmptyString(sourceRef.kind)) {
    addIssue(issues, 'error', 'source-ref-kind-invalid', `${path}/kind`, 'Kind must be non-empty.');
  }
}

function validateRawPointer(value: unknown, path: string, issues: ArchiveValidationIssue[]): void {
  if (value === null || (typeof value === 'string' && (value === '' || value.startsWith('/')))) {
    return;
  }
  addIssue(
    issues,
    'error',
    'source-ref-pointer-invalid',
    path,
    'Raw JSON Pointer must be null, empty, or start with a slash.'
  );
}
