/** Closed names shared by the pure renderer and the derived-artifact transport. */
export const HTML_BRANCH_MAX_ORDINAL = 999999;
export type HtmlBranchTarget = { role: 'leaf'; ordinal: number } | { role: 'index' };
export type HtmlBranchRelativePath = `branch-${string}.html` | 'branches.html';

function targetRecord(value: unknown): object | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value : undefined;
}

function leafOrdinal(value: object): number | undefined {
  const ordinal = Object.getOwnPropertyDescriptor(value, 'ordinal');
  if (
    !ordinal?.enumerable ||
    !('value' in ordinal) ||
    !Number.isInteger(ordinal.value) ||
    ordinal.value < 1 ||
    ordinal.value > HTML_BRANCH_MAX_ORDINAL
  )
    return undefined;
  return ordinal.value as number;
}

/** Snapshot only own enumerable data. No getters, coercion, or caller paths. */
export function snapshotHtmlBranchTarget(value: unknown): HtmlBranchTarget | undefined {
  try {
    const record = targetRecord(value);
    if (!record) return undefined;
    const keys = Reflect.ownKeys(record);
    if (!keys.includes('role') || keys.some(key => key !== 'role' && key !== 'ordinal'))
      return undefined;
    const role = Object.getOwnPropertyDescriptor(record, 'role');
    if (!role?.enumerable || !('value' in role)) return undefined;
    if (role.value === 'index') return keys.length === 1 ? { role: 'index' } : undefined;
    if (role.value !== 'leaf' || keys.length !== 2 || !keys.includes('ordinal')) return undefined;
    const ordinal = leafOrdinal(record);
    return ordinal === undefined ? undefined : { role: 'leaf', ordinal };
  } catch {
    return undefined;
  }
}

/** Undefined is the value-free invalid-target result; no arbitrary paths are accepted. */
export function htmlBranchRelativePath(value: unknown): HtmlBranchRelativePath | undefined {
  const target = snapshotHtmlBranchTarget(value);
  if (!target) return undefined;
  return target.role === 'index'
    ? 'branches.html'
    : `branch-${String(target.ordinal).padStart(6, '0')}.html`;
}
