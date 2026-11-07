import {
  BASELINE_LIMITS,
  BaselinePlanError,
  type BaselineErrorCode,
  type PlanDependencies,
} from './contracts';

export type Data = null | boolean | number | string | Data[] | { [key: string]: Data };
export function check(value: unknown, code: BaselineErrorCode = 'invalid-data'): asserts value {
  if (!value) throw new BaselinePlanError(code);
}
export function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  check(Number.isSafeInteger(value) && !Object.is(value, -0));
  check((value as number) >= 0 && (value as number) <= maximum);
  return value as number;
}
export function identifier(value: unknown): string {
  check(typeof value === 'string' && value.length > 0 && value.length <= 256);
  check(
    value === value.trim() &&
      [...value].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
  );
  return value;
}
export function digest(value: unknown): string {
  check(typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value));
  return value;
}
/** Own enumerable data only; no getters/serializers. Transparent Proxy traps cannot be authenticated. */
export function own(input: unknown): Record<string, unknown> {
  check(input && typeof input === 'object' && !Array.isArray(input));
  const prototype: unknown = Object.getPrototypeOf(input);
  check(prototype === Object.prototype || prototype === null);
  const keys = Reflect.ownKeys(input);
  check(keys.length <= BASELINE_LIMITS.maxNodes, 'limit-exceeded');
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    check(typeof key === 'string' && key.length <= 256);
    check(!['__proto__', 'prototype', 'constructor', 'toJSON'].includes(key));
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    check('value' in descriptor && descriptor.enumerable);
    result[key] = descriptor.value;
  }
  return result;
}
export function exact(
  input: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): Record<string, unknown> {
  const result = own(input);
  check(required.every(key => key in result));
  check(Object.keys(result).every(key => required.includes(key) || optional.includes(key)));
  return result;
}
export function list(input: unknown, maximum: number = BASELINE_LIMITS.maxPlanItems): unknown[] {
  check(Array.isArray(input) && Object.getPrototypeOf(input) === Array.prototype);
  const ds = Object.getOwnPropertyDescriptors(input as object);
  const keys = Reflect.ownKeys(input);
  const length = ds.length.value as number;
  check(length <= maximum, 'limit-exceeded');
  check(keys.length === length + 1);
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = ds[index];
    check(descriptor && 'value' in descriptor && descriptor.enumerable);
    result.push(descriptor.value);
  }
  return result;
}
export function detach(input: unknown): Data {
  let nodes = 0;
  let strings = 0;
  const ancestors = new Set<object>();
  const text = (value: string) => {
    strings += value.length;
    check(
      value.length <= BASELINE_LIMITS.maxStringCodeUnits &&
        strings <= BASELINE_LIMITS.maxTotalStringCodeUnits,
      'limit-exceeded'
    );
  };
  const visit = (value: unknown, depth: number): Data => {
    check(
      ++nodes <= BASELINE_LIMITS.maxNodes && depth <= BASELINE_LIMITS.maxDepth,
      'limit-exceeded'
    );
    if (typeof value === 'string') {
      text(value);
      return value;
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return integer(value);
    check(value && typeof value === 'object' && !ancestors.has(value));
    ancestors.add(value);
    let result: Data;
    if (Array.isArray(value)) result = list(value).map(child => visit(child, depth + 1));
    else {
      result = Object.create(null) as Record<string, Data>;
      const fields = own(value);
      for (const key of Object.keys(fields).sort()) {
        text(key);
        result[key] = visit(fields[key], depth + 1);
      }
    }
    ancestors.delete(value);
    return result;
  };
  try {
    return visit(input, 0);
  } catch (error) {
    if (error instanceof BaselinePlanError) throw error;
    throw new BaselinePlanError('invalid-data');
  }
}
export function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export function canonical(input: unknown): string {
  return JSON.stringify(detach(input));
}
export function encode(input: unknown, maximum: number): Uint8Array {
  const bytes = new TextEncoder().encode(canonical(input));
  check(bytes.length <= maximum, 'limit-exceeded');
  return bytes;
}
export function readBytes(input: unknown, maximum: number): Uint8Array {
  check(input instanceof Uint8Array && input.length > 0 && input.length <= maximum);
  return new Uint8Array(input);
}
export function decode(input: unknown, maximum: number): { bytes: Uint8Array; data: unknown } {
  const bytes = readBytes(input, maximum);
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const data: unknown = JSON.parse(text);
    check(canonical(data) === text);
    return { bytes, data };
  } catch {
    throw new BaselinePlanError('invalid-data');
  }
}
/** Trusted algorithm only: receives a private copy; mutation, failure and cancellation fail closed. */
export function hashDependency(dependencies: PlanDependencies) {
  const { signal, sha256 } = dependencies;
  check(typeof sha256 === 'function' && signal && typeof signal.aborted === 'boolean');
  return async (input: Uint8Array): Promise<string> => {
    try {
      check(!signal.aborted);
      const expected = new Uint8Array(input);
      const supplied = expected.slice();
      const hash = digest(await sha256(supplied, signal));
      check(!signal.aborted && supplied.length === expected.length);
      check(expected.every((byte, index) => supplied[index] === byte));
      return hash;
    } catch {
      throw new BaselinePlanError('hash-failed');
    }
  };
}
