import {
  PURPOSE_HARD_LIMITS,
  PurposeContractError,
  type PurposeLimits,
  type RejectionCode,
} from './contracts';

export type Data = null | boolean | number | string | Data[] | { [key: string]: Data };
export type RecordData = { [key: string]: Data };
export const fail = (code: ConstructorParameters<typeof PurposeContractError>[0]): never => {
  throw new PurposeContractError(code);
};

/** Even a throwing Proxy cannot inject exception text or an arbitrary result code. */
export function rejectionCode(error: unknown): RejectionCode {
  try {
    if (!(error instanceof PurposeContractError)) return 'invalid-data';
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    const code: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    return [
      'invalid-data',
      'invalid-limits',
      'limit-exceeded',
      'invalid-operation',
      'invalid-evidence',
    ].includes(code as string)
      ? (code as RejectionCode)
      : 'invalid-data';
  } catch {
    return 'invalid-data';
  }
}

function descriptors(value: object, maxKeys: number): PropertyDescriptorMap {
  const keys = Reflect.ownKeys(value);
  if (keys.length > maxKeys) fail('limit-exceeded');
  if (keys.some(key => typeof key !== 'string')) fail('invalid-data');
  const result = Object.getOwnPropertyDescriptors(value);
  for (const key of keys as string[]) {
    if (
      !('value' in result[key]) ||
      (!(Array.isArray(value) && key === 'length') && !result[key].enumerable)
    )
      fail('invalid-data');
  }
  return result;
}

/** Only own data is inspected. Proxy traps cannot be authenticated or made side-effect-free. */
export function limitsFrom(input: unknown): PurposeLimits {
  if (input === undefined) return PURPOSE_HARD_LIMITS;
  try {
    if (!input || typeof input !== 'object') return fail('invalid-limits');
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) return fail('invalid-limits');
    const ds = descriptors(input, Object.keys(PURPOSE_HARD_LIMITS).length);
    const result: { -readonly [K in keyof PurposeLimits]: number } = { ...PURPOSE_HARD_LIMITS };
    for (const key of Object.keys(ds)) {
      if (!Object.prototype.hasOwnProperty.call(result, key)) return fail('invalid-limits');
      const value = ds[key].value;
      const name = key as keyof PurposeLimits;
      if (!Number.isSafeInteger(value) || value < 1 || value > PURPOSE_HARD_LIMITS[name])
        return fail('invalid-limits');
      result[name] = value;
    }
    return Object.freeze(result);
  } catch {
    return fail('invalid-limits');
  }
}

interface DetachContext {
  readonly limits: PurposeLimits;
  readonly ancestors: Set<object>;
  nodes: number;
  strings: number;
}

function stringBudget(context: DetachContext, value: string): void {
  context.strings += value.length;
  if (
    value.length > context.limits.maxStringCodeUnits ||
    context.strings > context.limits.maxTotalStringCodeUnits
  )
    fail('limit-exceeded');
}

function copyArray(context: DetachContext, ds: PropertyDescriptorMap, depth: number): Data[] {
  const length = ds.length.value as number;
  if (length > context.limits.maxArrayItems) return fail('limit-exceeded');
  if (Object.keys(ds).length !== length + 1) return fail('invalid-data');
  const entries: Data[] = [];
  for (let index = 0; index < length; index++) {
    if (!Object.prototype.hasOwnProperty.call(ds, String(index))) return fail('invalid-data');
    entries.push(visit(context, ds[index].value, depth + 1));
  }
  return entries;
}

function copyRecord(context: DetachContext, ds: PropertyDescriptorMap, depth: number): RecordData {
  const record: RecordData = Object.create(null);
  for (const key of Object.keys(ds).sort()) {
    stringBudget(context, key);
    if (['__proto__', 'prototype', 'constructor', 'toJSON'].includes(key))
      return fail('invalid-data');
    record[key] = visit(context, ds[key].value, depth + 1);
  }
  return record;
}

function copyObject(context: DetachContext, value: object, depth: number): Data {
  const array = Array.isArray(value);
  const proto = Object.getPrototypeOf(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
    return fail('invalid-data');
  const ds = descriptors(value, context.limits.maxNodes - context.nodes + 1);
  context.ancestors.add(value);
  const result = array ? copyArray(context, ds, depth) : copyRecord(context, ds, depth);
  context.ancestors.delete(value);
  return result;
}

function visit(context: DetachContext, value: unknown, depth: number): Data {
  if (++context.nodes > context.limits.maxNodes || depth > context.limits.maxDepth)
    return fail('limit-exceeded');
  if (typeof value === 'string') {
    stringBudget(context, value);
    return value;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || context.ancestors.has(value))
    return fail('invalid-data');
  return copyObject(context, value, depth);
}

/** Bounded, descriptor-safe detached copy, never JSON.stringify on caller-owned data. */
export function detach(input: unknown, limits: PurposeLimits): Data {
  try {
    return visit({ limits, ancestors: new Set(), nodes: 0, strings: 0 }, input, 0);
  } catch (error) {
    return fail(rejectionCode(error));
  }
}

export function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
