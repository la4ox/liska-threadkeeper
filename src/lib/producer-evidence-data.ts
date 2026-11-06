/** Bounded own-data snapshots for producer facts; no getters, toJSON or capabilities. */
export type ProducerData = null | boolean | number | string | ProducerData[] | ProducerRecord;
export interface ProducerRecord {
  [key: string]: ProducerData;
}
export const invalidProducerEvidence = (): never => {
  throw new Error('invalid-producer-evidence');
};

export function freezeProducerData<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeProducerData);
    Object.freeze(value);
  }
  return value;
}

/** Proxy traps are not authenticated; failures are fixed and never expose caller error text. */
// eslint-disable-next-line max-lines-per-function -- Shared traversal budget and ancestor identity must stay in one snapshot scope.
export function detachProducerData(value: unknown): ProducerData {
  let nodes = 0;
  let strings = 0;
  const ancestors = new Set<object>();
  // eslint-disable-next-line complexity -- Explicit data-kind and own-descriptor checks reject rather than execute hostile inputs.
  const visit = (input: unknown, depth: number): ProducerData => {
    if (++nodes > 50000 || depth > 16) return invalidProducerEvidence();
    if (typeof input === 'string') {
      strings += input.length;
      if (input.length > 1024 || strings > 2097152) return invalidProducerEvidence();
      return input;
    }
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (!input || typeof input !== 'object' || ancestors.has(input))
      return invalidProducerEvidence();
    const array = Array.isArray(input);
    const proto: unknown = Object.getPrototypeOf(input);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
      return invalidProducerEvidence();
    const keys = Reflect.ownKeys(input);
    if (keys.length > 50000 - nodes || keys.some(key => typeof key !== 'string'))
      return invalidProducerEvidence();
    const ds = Object.getOwnPropertyDescriptors(input);
    ancestors.add(input);
    const result: ProducerData[] | ProducerRecord = array ? [] : Object.create(null);
    for (const key of (keys as string[]).sort()) {
      strings += key.length;
      if (key.length > 1024 || strings > 2097152) return invalidProducerEvidence();
      const descriptor = ds[key];
      if (!('value' in descriptor)) return invalidProducerEvidence();
      if (array && key === 'length') continue;
      if (
        !descriptor.enumerable ||
        ['__proto__', 'prototype', 'constructor', 'toJSON'].includes(key)
      )
        return invalidProducerEvidence();
      if (array && !/^(0|[1-9][0-9]*)$/u.test(key)) return invalidProducerEvidence();
      (result as ProducerRecord)[key] = visit(descriptor.value, depth + 1);
    }
    if (
      array &&
      (ds.length.value > 4096 ||
        keys.length !== ds.length.value + 1 ||
        (result as ProducerData[]).length !== ds.length.value)
    )
      return invalidProducerEvidence();
    ancestors.delete(input);
    return result;
  };
  try {
    return visit(value, 0);
  } catch {
    return invalidProducerEvidence();
  }
}

export function producerRecord(
  value: ProducerData | undefined,
  required: string[],
  optional: string[] = []
): ProducerRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidProducerEvidence();
  if (
    required.some(key => !(key in value)) ||
    Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))
  )
    return invalidProducerEvidence();
  return value;
}
export function producerList(value: ProducerData | undefined, max = 1024): ProducerData[] {
  if (!Array.isArray(value) || value.length > max) return invalidProducerEvidence();
  return value;
}
export function producerId(value: ProducerData | undefined): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value))
    return invalidProducerEvidence();
  return value;
}
export function producerHash(value: ProducerData | undefined): void {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) invalidProducerEvidence();
}
export function producerBytes(value: ProducerData | undefined): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    invalidProducerEvidence();
}
export function producerPath(value: ProducerData | undefined): void {
  if (
    typeof value !== 'string' ||
    /[\\:*?"<>|]/u.test(value) ||
    [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    value.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/u.test(part))
  )
    invalidProducerEvidence();
}
