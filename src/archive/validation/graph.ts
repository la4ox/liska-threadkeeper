import type { AssetReference } from './blocks';
import { validateMessage } from './blocks';
import type { ArchiveValidationIssue, UnknownRecord } from './contracts';
import {
  addIssue,
  expectExactObject,
  hasOwn,
  isNonEmptyString,
  isPlainObject,
  pointerSegment,
  validateExtensions,
  validateNullableString,
  validateSourceReferences,
} from './shared';

interface NodeSnapshot {
  key: string;
  parentId: string | null | undefined;
  childIds: string[];
}

export function validateGraph(
  value: unknown,
  currentNodeId: unknown,
  shouldCheckCurrentNode: boolean,
  issues: ArchiveValidationIssue[],
  messageIds: Set<string>,
  assetReferences: AssetReference[]
): void {
  const graph = expectExactObject(
    value,
    '/graph',
    ['rootIds', 'nodes'],
    ['rootIds', 'nodes'],
    issues,
    'graph-not-object'
  );
  if (!graph) {
    return;
  }
  const graphNodes = collectNodes(graph.nodes, issues, messageIds, assetReferences);
  if (!graphNodes) {
    return;
  }
  const roots = validateRoots(graph.rootIds, graphNodes, issues);
  validateLinks(graphNodes, new Set(roots), issues);
  validateCycles(graphNodes, issues);
  validateReachability(graphNodes, roots, issues);
  validateCurrentNode(graph.nodes, currentNodeId, shouldCheckCurrentNode, issues);
}

function collectNodes(
  value: unknown,
  issues: ArchiveValidationIssue[],
  messageIds: Set<string>,
  assetReferences: AssetReference[]
): Map<string, NodeSnapshot> | null {
  if (!isPlainObject(value)) {
    addIssue(
      issues,
      'error',
      'graph-nodes-not-object',
      '/graph/nodes',
      'Nodes must be a plain object map.'
    );
    return null;
  }
  const nodes = new Map<string, NodeSnapshot>();
  Object.keys(value).forEach(key => {
    const node = validateNode(
      key,
      value[key],
      `/graph/nodes/${pointerSegment(key)}`,
      issues,
      messageIds,
      assetReferences
    );
    if (node) {
      nodes.set(key, node);
    }
  });
  return nodes;
}

function validateNode(
  key: string,
  value: unknown,
  path: string,
  issues: ArchiveValidationIssue[],
  messageIds: Set<string>,
  assetReferences: AssetReference[]
): NodeSnapshot | null {
  const node = expectExactObject(
    value,
    path,
    ['id', 'parentId', 'childIds', 'sourceRefs', 'extensions'],
    ['id', 'parentId', 'childIds', 'message', 'sourceRefs', 'extensions'],
    issues,
    'node-not-object'
  );
  if (!node) {
    return null;
  }
  validateNodeIdentity(node, key, path, issues);
  const childIds = collectChildIds(node.childIds, path, issues);
  validateSourceReferences(node.sourceRefs, `${path}/sourceRefs`, issues);
  validateExtensions(node.extensions, `${path}/extensions`, issues);
  if (hasOwn(node, 'message')) {
    validateMessage(node.message, `${path}/message`, issues, messageIds, assetReferences);
  }
  return { key, parentId: asNullableString(node.parentId), childIds };
}

function validateNodeIdentity(
  node: UnknownRecord,
  key: string,
  path: string,
  issues: ArchiveValidationIssue[]
): void {
  if (!isNonEmptyString(node.id)) {
    addIssue(issues, 'error', 'node-id-invalid', `${path}/id`, 'Node ID must be non-empty.');
  } else if (node.id !== key) {
    addIssue(
      issues,
      'error',
      'node-key-id-mismatch',
      `${path}/id`,
      'Node map key must equal node ID.'
    );
  }
  validateNullableString(node.parentId, `${path}/parentId`, issues);
}

function collectChildIds(value: unknown, path: string, issues: ArchiveValidationIssue[]): string[] {
  if (!Array.isArray(value)) {
    addIssue(
      issues,
      'error',
      'node-child-ids-not-array',
      `${path}/childIds`,
      'Child IDs must be an array.'
    );
    return [];
  }
  const seen = new Set<string>();
  const childIds: string[] = [];
  value.forEach((childId, index) => collectChildId(childId, index, path, seen, childIds, issues));
  return childIds;
}

function collectChildId(
  childId: unknown,
  index: number,
  path: string,
  seen: Set<string>,
  childIds: string[],
  issues: ArchiveValidationIssue[]
): void {
  const childPath = `${path}/childIds/${index}`;
  if (!isNonEmptyString(childId)) {
    addIssue(issues, 'error', 'child-id-invalid', childPath, 'Child ID must be non-empty.');
  } else if (seen.has(childId)) {
    addIssue(
      issues,
      'error',
      'child-id-duplicate',
      childPath,
      'Child IDs must be unique within a node.'
    );
  } else {
    seen.add(childId);
    childIds.push(childId);
  }
}

function asNullableString(value: unknown): string | null | undefined {
  return typeof value === 'string' || value === null ? value : undefined;
}

function validateRoots(
  value: unknown,
  nodes: Map<string, NodeSnapshot>,
  issues: ArchiveValidationIssue[]
): string[] {
  if (!Array.isArray(value)) {
    addIssue(issues, 'error', 'root-ids-not-array', '/graph/rootIds', 'Root IDs must be an array.');
    return [];
  }
  const roots: string[] = [];
  const seen = new Set<string>();
  value.forEach((rootId, index) => validateRoot(rootId, index, nodes, seen, roots, issues));
  return roots;
}

function validateRoot(
  rootId: unknown,
  index: number,
  nodes: Map<string, NodeSnapshot>,
  seen: Set<string>,
  roots: string[],
  issues: ArchiveValidationIssue[]
): void {
  const path = `/graph/rootIds/${index}`;
  if (!isNonEmptyString(rootId)) {
    addIssue(issues, 'error', 'root-id-invalid', path, 'Root ID must be non-empty.');
    return;
  }
  if (seen.has(rootId)) {
    addIssue(issues, 'error', 'root-id-duplicate', path, 'Root IDs must be unique.');
    return;
  }
  seen.add(rootId);
  roots.push(rootId);
  const node = nodes.get(rootId);
  if (!node) {
    addIssue(issues, 'error', 'root-reference-missing', path, 'Root ID does not reference a node.');
  } else if (node.parentId !== null) {
    addIssue(
      issues,
      'error',
      'root-parent-not-null',
      `/graph/nodes/${pointerSegment(rootId)}/parentId`,
      'A root node must have a null parent ID.'
    );
  }
}

function validateLinks(
  nodes: Map<string, NodeSnapshot>,
  roots: Set<string>,
  issues: ArchiveValidationIssue[]
): void {
  nodes.forEach(node => validateNodeLinks(node, nodes, roots, issues));
}

function validateNodeLinks(
  node: NodeSnapshot,
  nodes: Map<string, NodeSnapshot>,
  roots: Set<string>,
  issues: ArchiveValidationIssue[]
): void {
  const nodePath = `/graph/nodes/${pointerSegment(node.key)}`;
  validateParentLink(node, nodePath, nodes, roots, issues);
  node.childIds.forEach((childId, index) => {
    validateChildLink(node, childId, index, nodePath, nodes, issues);
  });
}

function validateParentLink(
  node: NodeSnapshot,
  nodePath: string,
  nodes: Map<string, NodeSnapshot>,
  roots: Set<string>,
  issues: ArchiveValidationIssue[]
): void {
  if (node.parentId === null && !roots.has(node.key)) {
    addIssue(
      issues,
      'error',
      'null-parent-not-root',
      `${nodePath}/parentId`,
      'A node with a null parent must be listed as a root.'
    );
  }
  if (typeof node.parentId !== 'string') {
    return;
  }
  const parent = nodes.get(node.parentId);
  if (!parent) {
    addIssue(
      issues,
      'error',
      'parent-reference-missing',
      `${nodePath}/parentId`,
      'Parent ID does not reference a node.'
    );
  } else if (!parent.childIds.includes(node.key)) {
    addIssue(
      issues,
      'error',
      'parent-child-asymmetry',
      `${nodePath}/parentId`,
      'Parent does not list this node among its ordered children.'
    );
  }
}

function validateChildLink(
  node: NodeSnapshot,
  childId: string,
  index: number,
  nodePath: string,
  nodes: Map<string, NodeSnapshot>,
  issues: ArchiveValidationIssue[]
): void {
  const child = nodes.get(childId);
  const childPath = `${nodePath}/childIds/${index}`;
  if (!child) {
    addIssue(
      issues,
      'error',
      'child-reference-missing',
      childPath,
      'Child ID does not reference a node.'
    );
  } else if (child.parentId !== node.key) {
    addIssue(
      issues,
      'error',
      'child-parent-asymmetry',
      childPath,
      'Child does not point back to this node as its parent.'
    );
  }
}

function validateCycles(nodes: Map<string, NodeSnapshot>, issues: ArchiveValidationIssue[]): void {
  const state = new Map<string, 'visiting' | 'visited'>();
  nodes.forEach((_node, nodeId) => visitForCycle(nodeId, nodes, state, issues));
}

function visitForCycle(
  nodeId: string,
  nodes: Map<string, NodeSnapshot>,
  state: Map<string, 'visiting' | 'visited'>,
  issues: ArchiveValidationIssue[]
): void {
  const node = nodes.get(nodeId);
  if (!node || state.get(nodeId) === 'visited') {
    return;
  }
  state.set(nodeId, 'visiting');
  node.childIds.forEach((childId, index) =>
    visitCycleChild(node, childId, index, nodes, state, issues)
  );
  state.set(nodeId, 'visited');
}

function visitCycleChild(
  node: NodeSnapshot,
  childId: string,
  index: number,
  nodes: Map<string, NodeSnapshot>,
  state: Map<string, 'visiting' | 'visited'>,
  issues: ArchiveValidationIssue[]
): void {
  if (!nodes.has(childId)) {
    return;
  }
  if (state.get(childId) === 'visiting') {
    addIssue(
      issues,
      'error',
      'graph-cycle',
      `/graph/nodes/${pointerSegment(node.key)}/childIds/${index}`,
      `Child ${childId} closes a graph cycle.`
    );
    return;
  }
  visitForCycle(childId, nodes, state, issues);
}

function validateReachability(
  nodes: Map<string, NodeSnapshot>,
  roots: string[],
  issues: ArchiveValidationIssue[]
): void {
  const reachable = new Set<string>();
  roots.forEach(root => collectReachable(root, nodes, reachable));
  nodes.forEach((_node, nodeId) => {
    if (!reachable.has(nodeId)) {
      addIssue(
        issues,
        'warning',
        'node-unreachable',
        `/graph/nodes/${pointerSegment(nodeId)}`,
        'Node is not reachable from any declared root.'
      );
    }
  });
}

function collectReachable(
  nodeId: string,
  nodes: Map<string, NodeSnapshot>,
  reachable: Set<string>
): void {
  if (reachable.has(nodeId) || !nodes.has(nodeId)) {
    return;
  }
  reachable.add(nodeId);
  nodes.get(nodeId)?.childIds.forEach(child => collectReachable(child, nodes, reachable));
}

function validateCurrentNode(
  graphNodes: unknown,
  currentNodeId: unknown,
  shouldCheckCurrentNode: boolean,
  issues: ArchiveValidationIssue[]
): void {
  if (
    shouldCheckCurrentNode &&
    typeof currentNodeId === 'string' &&
    isPlainObject(graphNodes) &&
    !hasOwn(graphNodes, currentNodeId)
  ) {
    addIssue(
      issues,
      'error',
      'current-node-reference-missing',
      '/conversation/currentNodeId',
      'Current node ID does not reference a node.'
    );
  }
}
