import {
  JOURNAL_HARD_LIMITS,
  ResumabilityJournalError,
  type JournalCode,
  type JournalLimits,
} from './contracts';

const ownedErrors = new WeakMap<object, JournalCode>();

export function fail(code: JournalCode): never {
  const error = new ResumabilityJournalError(code);
  ownedErrors.set(error, code);
  throw error;
}

/** Exception prose and forged error objects never cross the pure boundary. */
export function guarded<T>(fallback: JournalCode, action: () => T): T {
  try {
    return action();
  } catch (error) {
    const code = error && typeof error === 'object' ? ownedErrors.get(error) : undefined;
    fail(code ?? fallback);
  }
}

/**
 * Plain own enumerable data only; no getters/toJSON/inherited fields are read.
 * Transparent object/array Proxies cannot be distinguished in portable JS.
 * Callers must supply UI-owned plain data; observably hostile traps fail closed.
 */
export function fields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
  code: JournalCode = 'invalid-journal'
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) fail(code);
  const allowed = [...required, ...optional];
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || !allowed.includes(key))) fail(code);
  const output: Record<string, unknown> = Object.create(null);
  for (const key of allowed) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) {
      if (required.includes(key)) fail(code);
    } else {
      if (!('value' in descriptor) || !descriptor.enumerable) fail(code);
      output[key] = descriptor.value;
    }
  }
  return output;
}

export function arrayData(value: unknown, max: number, code: JournalCode): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(code);
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0) fail(code);
  if (length > max) fail('limit-exceeded');
  if (Reflect.ownKeys(value).length !== length + 1) fail(code);
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail(code);
    output.push(descriptor.value);
  }
  return output;
}

export function resolveLimits(value: unknown): JournalLimits {
  const output: JournalLimits = { ...JOURNAL_HARD_LIMITS };
  if (value === undefined) return output;
  const data = fields(value, [], Object.keys(output), 'invalid-limits');
  for (const [name, limit] of Object.entries(data)) {
    const key = name as keyof JournalLimits;
    if (!Number.isSafeInteger(limit) || (limit as number) < 0 || (limit as number) > output[key])
      fail('invalid-limits');
    output[key] = limit as number;
  }
  return output;
}

export function integer(value: unknown, code: JournalCode = 'invalid-journal'): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    Object.is(value, -0)
  )
    fail(code);
  return value;
}

export function increment(value: number): number {
  const next = value + 1;
  if (!Number.isSafeInteger(next)) fail('limit-exceeded');
  return next;
}

export function identifier(
  value: unknown,
  limits: JournalLimits,
  code: JournalCode = 'invalid-journal'
): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) fail(code);
  if (value.length > limits.maxIdentifierCodeUnits) fail('limit-exceeded');
  return value;
}

export function digest(value: unknown, code: JournalCode = 'invalid-journal'): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail(code);
  return value;
}

export function enumValue<T extends string>(
  value: unknown,
  choices: readonly T[],
  code: JournalCode = 'invalid-journal'
): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) fail(code);
  return value as T;
}

export function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** All fixed-schema strings are ASCII. JSON output therefore has exact UTF-8 byte length. */
export function assertOutputSize(value: unknown, limits: JournalLimits): void {
  if (JSON.stringify(value).length + 1 > limits.maxOutputBytes) fail('limit-exceeded');
}
