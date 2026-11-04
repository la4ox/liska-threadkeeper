import {
  CLAUDE_LIST_HARD_LIMITS,
  CLAUDE_LIST_REJECTION_REASONS,
  CLAUDE_LIST_SCOPE_PREFIX,
  type ClaudeListLimits,
  type ClaudeListRejectionReason,
} from './contracts';

export function fail(reason: ClaudeListRejectionReason = 'invalid-input'): never {
  throw reason;
}

/** Only allowlisted primitive failure codes cross the boundary, never exception objects or prose. */
export function rejectionReason(error: unknown): ClaudeListRejectionReason {
  return typeof error === 'string' &&
    CLAUDE_LIST_REJECTION_REASONS.includes(error as ClaudeListRejectionReason)
    ? (error as ClaudeListRejectionReason)
    : 'invalid-input';
}

/**
 * Read only selected own enumerable data descriptors, never unknown values.
 * Portable JS cannot identify transparent Proxies; observable trap failures are rejected.
 * Inputs must therefore be caller-owned data, not arbitrary executable objects.
 */
export function fields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  limits: ClaudeListLimits
): { data: Record<string, unknown>; keys: readonly string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length > limits.maxObjectKeys) fail('limit-exceeded');
  if (keys.some(key => typeof key !== 'string')) fail();
  if (keys.some(key => (key as string).length > limits.maxKeyCodeUnits)) fail('limit-exceeded');
  const data: Record<string, unknown> = Object.create(null);
  for (const key of [...required, ...optional]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) {
      if (required.includes(key)) fail();
    } else {
      if (!('value' in descriptor) || !descriptor.enumerable) fail();
      data[key] = descriptor.value;
    }
  }
  return { data, keys: keys as string[] };
}

export function arrayData(value: unknown, limits: ClaudeListLimits): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0) fail();
  if (length > limits.maxRecords) fail('limit-exceeded');
  if (Reflect.ownKeys(value).length !== length + 1) fail();
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail();
    output.push(descriptor.value);
  }
  return output;
}

export function resolveLimits(value: unknown): ClaudeListLimits {
  const limits: ClaudeListLimits = { ...CLAUDE_LIST_HARD_LIMITS };
  if (value === undefined) return limits;
  try {
    const names = Object.keys(limits);
    const { data, keys } = fields(value, [], names, limits);
    if (keys.some(key => !names.includes(key))) fail();
    for (const key of names as (keyof ClaudeListLimits)[]) {
      if (!(key in data)) continue;
      const limit = data[key];
      if (
        !Number.isSafeInteger(limit) ||
        (limit as number) < 0 ||
        Object.is(limit, -0) ||
        (limit as number) > limits[key]
      )
        fail();
      limits[key] = limit as number;
    }
    return limits;
  } catch {
    fail('invalid-limits');
  }
}

export function nonemptyString(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0) fail();
  if (value.length > max) fail('limit-exceeded');
  return value;
}

export function natural(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || Object.is(value, -0)) fail();
  return value as number;
}

export function isScopeKey(value: string): boolean {
  return (
    value.startsWith(CLAUDE_LIST_SCOPE_PREFIX) &&
    /^[a-f0-9]{64}$/u.test(value.slice(CLAUDE_LIST_SCOPE_PREFIX.length))
  );
}

/** Lower-case UUID spelling is a conservative policy, not a provider identity guarantee. */
export function isConversationId(value: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
}
