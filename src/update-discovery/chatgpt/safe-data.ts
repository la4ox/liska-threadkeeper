import {
  CHATGPT_CONVERSATION_LIST_HARD_LIMITS,
  CHATGPT_CONVERSATION_LIST_REJECTION_REASONS,
  type ChatGptConversationListLimits,
  type ChatGptConversationListRejectionReason,
} from './contracts';

export function fail(reason: ChatGptConversationListRejectionReason = 'invalid-input'): never {
  throw reason;
}

/** Exception objects, coercions and caught prose never cross this boundary. */
export function rejectionReason(error: unknown): ChatGptConversationListRejectionReason {
  return typeof error === 'string' &&
    CHATGPT_CONVERSATION_LIST_REJECTION_REASONS.includes(
      error as ChatGptConversationListRejectionReason
    )
    ? (error as ChatGptConversationListRejectionReason)
    : 'invalid-input';
}

/**
 * Inspect only selected own enumerable data descriptors, never unknown field values.
 * Portable JavaScript cannot detect transparent Proxies: caller-owned detached data is required.
 * Observable descriptor/prototype trap failures are caught at the public boundary.
 */
export function fields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  limits: ChatGptConversationListLimits
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

export function exactKeys(keys: readonly string[], names: readonly string[]): boolean {
  return keys.length === names.length && keys.every(key => names.includes(key));
}

export function arrayData(value: unknown, limits: ChatGptConversationListLimits): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!descriptor || !('value' in descriptor)) fail();
  const length = natural(descriptor.value);
  if (length > limits.maxRecords) fail('limit-exceeded');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || keys.some(key => typeof key !== 'string')) fail();
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    if (!item || !('value' in item) || !item.enumerable) fail();
    output.push(item.value);
  }
  return output;
}

export function resolveLimits(value: unknown): ChatGptConversationListLimits {
  const limits: ChatGptConversationListLimits = { ...CHATGPT_CONVERSATION_LIST_HARD_LIMITS };
  if (value === undefined) return limits;
  try {
    const names = Object.keys(limits);
    const { data, keys } = fields(value, [], names, limits);
    if (keys.some(key => !names.includes(key))) fail();
    for (const key of names as (keyof ChatGptConversationListLimits)[]) {
      if (!(key in data)) continue;
      const limit = natural(data[key]);
      if (limit > limits[key]) fail();
      limits[key] = limit;
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

/** Conservative lowercase 8-4-4-4-12 hexadecimal spelling; no UUID version claim. */
export function isConversationId(value: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
}
