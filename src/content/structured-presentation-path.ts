/** Descriptor-only selected-path proof shared by retention and byte authorization. */
import { HTML_PRESENTATION_LIMITS } from '../archive/presentation/contracts';

function invalid(): never {
  throw new Error('structured-presentation-path-invalid');
}

function plainRecord(value: unknown): object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  return value;
}

/** Read no property through [[Get]]; accessor values and unrelated bodies are never visited. */
function ownValue(value: unknown, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(plainRecord(value), key);
  if (!descriptor?.enumerable || !('value' in descriptor)) invalid();
  return descriptor.value;
}

function arrayId(value: object, index: number): string {
  const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
  if (
    !descriptor?.enumerable ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'string' ||
    descriptor.value.length === 0
  )
    invalid();
  return descriptor.value;
}

function denseIds(value: unknown, maximum: number, budget: { remaining: number }): string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  const length: unknown = lengthDescriptor?.value;
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > maximum ||
    length > budget.remaining
  )
    invalid();
  budget.remaining -= length;
  if (Reflect.ownKeys(value).length !== length + 1) invalid();
  const result: string[] = [];
  for (let index = 0; index < length; index++) {
    result.push(arrayId(value, index));
  }
  return result;
}

function validSelectedLimit(value: number): boolean {
  return (
    Number.isSafeInteger(value) && value >= 1 && value <= HTML_PRESENTATION_LIMITS.maxSelectedNodes
  );
}

function appearsOnce(ids: readonly string[], expected: string): boolean {
  let count = 0;
  for (const id of ids) if (id === expected && ++count > 1) return false;
  return count === 1;
}

/**
 * Snapshot a complete root-to-target path without reading message bodies or walking siblings.
 * The first parent is null; each following parent is exactly the previous distinct path node,
 * and that parent names the child exactly once. Thus the reverse walk reaches null with no
 * cycles, missing/extra ancestors or undeclared root. The target need not be a leaf.
 * Array work is bounded by the existing JSON-node ceiling, never a new raised budget.
 * Malformed descriptors and hostile traps return only undefined, with no native/input values.
 */
export function snapshotStructuredPresentationPath(
  archive: unknown,
  targetNodeId: unknown,
  selectedNodeIds: unknown,
  maxSelectedNodes: number = HTML_PRESENTATION_LIMITS.maxSelectedNodes
): readonly string[] | undefined {
  try {
    if (
      typeof targetNodeId !== 'string' ||
      !targetNodeId.length ||
      !validSelectedLimit(maxSelectedNodes)
    )
      return undefined;
    const budget = { remaining: HTML_PRESENTATION_LIMITS.maxInputJsonNodes };
    const selected = denseIds(selectedNodeIds, maxSelectedNodes, budget);
    if (
      !selected.length ||
      selected[selected.length - 1] !== targetNodeId ||
      new Set(selected).size !== selected.length
    )
      return undefined;
    const graph = ownValue(archive, 'graph');
    const nodes = plainRecord(ownValue(graph, 'nodes'));
    const roots = denseIds(ownValue(graph, 'rootIds'), budget.remaining, budget);
    if (!appearsOnce(roots, selected[0])) return undefined;
    let previous: string | null = null;
    let previousChildren: readonly string[] | undefined;
    for (const id of selected) {
      const node = ownValue(nodes, id);
      if (
        ownValue(node, 'parentId') !== previous ||
        (previousChildren !== undefined && !appearsOnce(previousChildren, id))
      )
        return undefined;
      previousChildren = denseIds(ownValue(node, 'childIds'), budget.remaining, budget);
      previous = id;
    }
    return Object.freeze(selected);
  } catch {
    return undefined;
  }
}
