import {
  CLAUDE_BASELINE_HARD_LIMITS,
  CLAUDE_BASELINE_REJECTION_REASONS,
  type ClaudeBaselineLimits,
  type ClaudeBaselineRejectionReason,
} from './contracts';

export function fail(reason: ClaudeBaselineRejectionReason = 'invalid-input'): never {
  throw reason;
}

export function rejectionReason(error: unknown): ClaudeBaselineRejectionReason {
  return typeof error === 'string' &&
    CLAUDE_BASELINE_REJECTION_REASONS.includes(error as ClaudeBaselineRejectionReason)
    ? (error as ClaudeBaselineRejectionReason)
    : 'invalid-input';
}

/**
 * Closed own-data records only. Unknown values and getters are never evaluated.
 * Transparent Proxies cannot be detected portably: callers must own their data;
 * observable trap failures become fixed rejections, never exception prose.
 */
export function fields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  limits: ClaudeBaselineLimits
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length > limits.maxObjectKeys) fail('limit-exceeded');
  const allowed = [...required, ...optional];
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string') fail();
    if (key.length > limits.maxKeyCodeUnits) fail('limit-exceeded');
    if (!allowed.includes(key)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail();
    output[key] = descriptor.value;
  }
  if (required.some(key => !(key in output))) fail();
  return output;
}

export function arrayData(value: unknown, limits: ClaudeBaselineLimits): unknown[] {
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

export function resolveLimits(value: unknown): ClaudeBaselineLimits {
  const limits: ClaudeBaselineLimits = { ...CLAUDE_BASELINE_HARD_LIMITS };
  if (value === undefined) return limits;
  try {
    const names = Object.keys(limits) as (keyof ClaudeBaselineLimits)[];
    const data = fields(value, [], names, limits);
    for (const key of names) {
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

export function isScopeKey(value: string): boolean {
  return (
    value.length === 'claude-list-scope/1:'.length + 64 &&
    /^claude-list-scope\/1:[a-f0-9]{64}$/u.test(value)
  );
}
