import { PurposePersistenceError, requireCondition } from './errors';

export const MAX_RECORD_BYTES = 64 * 1024;
export type Data = null | boolean | number | string | Data[] | { [key: string]: Data };

/** Own enumerable data only. No getters/toJSON, capabilities, cycles or unsafe keys. */
// eslint-disable-next-line max-lines-per-function -- Shared traversal budget and fixed-error normalization stay in one snapshot scope.
export function detach(input: unknown): Data {
  let nodes = 0;
  let strings = 0;
  const ancestors = new Set<object>();
  // eslint-disable-next-line complexity -- Explicit descriptor and budget gates share one traversal scope.
  const visit = (value: unknown, depth: number): Data => {
    requireCondition(++nodes <= 150000 && depth <= 24);
    if (typeof value === 'string') {
      strings += value.length;
      requireCondition(strings <= MAX_RECORD_BYTES && value.length <= 4096);
      return value;
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      requireCondition(Number.isSafeInteger(value) && !Object.is(value, -0));
      return value;
    }
    requireCondition(value && typeof value === 'object' && !ancestors.has(value));
    const array = Array.isArray(value);
    const proto: unknown = Object.getPrototypeOf(value);
    requireCondition(
      array ? proto === Array.prototype : proto === Object.prototype || proto === null
    );
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(value);
    requireCondition(keys.length <= 150000 - nodes && keys.every(key => typeof key === 'string'));
    const result: Data[] | Record<string, Data> = array ? [] : Object.create(null);
    ancestors.add(value);
    for (const key of (keys as string[]).sort()) {
      const descriptor = descriptors[key];
      requireCondition('value' in descriptor);
      if (array && key === 'length') continue;
      requireCondition(
        descriptor.enumerable && !['__proto__', 'prototype', 'constructor', 'toJSON'].includes(key)
      );
      requireCondition(key.length <= 256 && (!array || /^(0|[1-9][0-9]*)$/u.test(key)));
      (result as Record<string, Data>)[key] = visit(descriptor.value, depth + 1);
    }
    if (array)
      requireCondition(
        descriptors.length.value <= 4096 &&
          keys.length === descriptors.length.value + 1 &&
          result.length === descriptors.length.value
      );
    ancestors.delete(value);
    return result;
  };
  try {
    return visit(input, 0);
  } catch {
    throw new PurposePersistenceError('corrupt-record');
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
export function exactObject(
  input: Data | undefined,
  required: string[],
  optional: string[] = []
): Record<string, Data> {
  requireCondition(input && typeof input === 'object' && !Array.isArray(input));
  requireCondition(
    required.every(key => key in input) &&
      Object.keys(input).every(key => required.includes(key) || optional.includes(key))
  );
  return input;
}
