import type { JsonValue } from '../../types';
import type { ChatGptComparisonErrorCode, ChatGptComparisonLimits } from './contracts';

export type ComparisonFail = (code: ChatGptComparisonErrorCode) => never;

export interface SnapshotBudget {
  limits: ChatGptComparisonLimits;
  values: number;
  stringCodeUnits: number;
}

interface CloneFrame {
  source: object;
  target: Record<string, JsonValue> | JsonValue[];
  keys: string[];
  array: boolean;
  index: number;
  depth: number;
}

export function plainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}

export function jsonPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/** Reads an own data descriptor without invoking its accessor or toJSON. */
function dataDescriptor(
  value: object,
  key: string,
  code: ChatGptComparisonErrorCode,
  fail: ComparisonFail
): PropertyDescriptor {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !('value' in descriptor)) fail(code);
  return descriptor;
}

export function dataFields(
  value: object,
  maxKeys: number,
  code: ChatGptComparisonErrorCode,
  fail: ComparisonFail
): Record<string, PropertyDescriptor> {
  const keys = Reflect.ownKeys(value);
  if (keys.length > maxKeys || keys.some(key => typeof key !== 'string')) fail(code);
  const descriptors = Object.create(null) as Record<string, PropertyDescriptor>;
  for (const key of keys as string[]) {
    Object.defineProperty(descriptors, key, {
      value: dataDescriptor(value, key, code, fail),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return descriptors;
}

function accountValue(
  value: unknown,
  depth: number,
  budget: SnapshotBudget,
  fail: ComparisonFail
): void {
  budget.values += 1;
  if (budget.values > budget.limits.maxJsonValues || depth > budget.limits.maxJsonDepth) {
    fail('limit-exceeded');
  }
  if (typeof value !== 'string') return;
  budget.stringCodeUnits += value.length;
  if (budget.stringCodeUnits > budget.limits.maxJsonStringCodeUnits) fail('limit-exceeded');
}

function ownStringKeys(source: object, fail: ComparisonFail): string[] {
  const keys = Reflect.ownKeys(source);
  if (keys.some(key => typeof key !== 'string')) fail('invalid-json');
  return keys as string[];
}

function validArrayIndex(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}

function arrayKeys(
  source: object,
  ownKeys: string[],
  remainingValues: number,
  fail: ComparisonFail
): string[] {
  const keys = ownKeys.filter(key => key !== 'length');
  if (keys.length > remainingValues) fail('limit-exceeded');
  const length = dataDescriptor(source, 'length', 'invalid-json', fail).value as unknown;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
    fail('invalid-json');
  }
  if (keys.length !== length || keys.some(key => !validArrayIndex(key, length))) {
    fail('invalid-json');
  }
  return keys;
}

function objectKeys(
  ownKeys: string[],
  remainingValues: number,
  budget: SnapshotBudget,
  fail: ComparisonFail
): string[] {
  if (ownKeys.length > remainingValues) fail('limit-exceeded');
  for (const key of ownKeys) {
    budget.stringCodeUnits += key.length;
    if (budget.stringCodeUnits > budget.limits.maxJsonStringCodeUnits) fail('limit-exceeded');
  }
  return ownKeys;
}

function cloneFrame(
  source: object,
  depth: number,
  budget: SnapshotBudget,
  fail: ComparisonFail
): CloneFrame {
  const array = Array.isArray(source);
  if (!array && !plainRecord(source)) fail('invalid-json');
  const ownKeys = ownStringKeys(source, fail);
  const remainingValues = budget.limits.maxJsonValues - budget.values;
  const keys = array
    ? arrayKeys(source, ownKeys, remainingValues, fail)
    : objectKeys(ownKeys, remainingValues, budget, fail);
  return { source, target: array ? [] : {}, keys, array, index: 0, depth };
}

/** Iterative detachment rejects sparse arrays, cycles and non-JSON values. */
export function snapshotJson(
  input: unknown,
  budget: SnapshotBudget,
  fail: ComparisonFail
): JsonValue {
  accountValue(input, 1, budget, fail);
  if (jsonPrimitive(input)) return input;
  if (typeof input !== 'object' || input === null) fail('invalid-json');
  const first = cloneFrame(input, 1, budget, fail);
  const ancestors = new Set<object>([input]);
  const stack = [first];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index === frame.keys.length) {
      ancestors.delete(frame.source);
      stack.pop();
      continue;
    }
    const key = frame.keys[frame.index++];
    const descriptor = dataDescriptor(frame.source, key, 'invalid-json', fail);
    if (!frame.array && !descriptor.enumerable) fail('invalid-json');
    const value: unknown = descriptor.value;
    accountValue(value, frame.depth + 1, budget, fail);
    let detached: JsonValue;
    if (jsonPrimitive(value)) detached = value;
    else {
      if (typeof value !== 'object' || value === null || ancestors.has(value)) fail('invalid-json');
      const child = cloneFrame(value, frame.depth + 1, budget, fail);
      detached = child.target;
      ancestors.add(value);
      stack.push(child);
    }
    Object.defineProperty(frame.target, key, {
      value: detached,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return first.target;
}
