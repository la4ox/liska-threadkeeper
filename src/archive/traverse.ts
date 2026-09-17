import type { LiskaThreadArchive } from './types';

export type ArchiveTraversalErrorCode =
  | 'archive-structure-invalid'
  | 'target-node-missing'
  | 'node-reference-missing'
  | 'node-structure-invalid'
  | 'parent-reference-missing'
  | 'root-not-declared'
  | 'parent-child-asymmetry'
  | 'child-parent-asymmetry'
  | 'graph-cycle'
  | 'duplicate-reachable-node';

/** A stable, inspectable failure for callers that ask to traverse malformed data. */
export class ArchiveTraversalError extends Error {
  readonly code: ArchiveTraversalErrorCode;

  constructor(code: ArchiveTraversalErrorCode, message: string) {
    super(message);
    this.name = 'ArchiveTraversalError';
    this.code = code;
  }
}

type UnknownRecord = Record<string, unknown>;

interface TraversalNode {
  parentId: string | null;
  childIds: string[];
}

interface TraversalGraph {
  rootIds: string[];
  nodes: UnknownRecord;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireGraph(archive: unknown): TraversalGraph {
  if (!isRecord(archive) || !isRecord(archive.graph)) {
    throw new ArchiveTraversalError(
      'archive-structure-invalid',
      'Archive graph must be an object.'
    );
  }
  const { rootIds, nodes } = archive.graph;
  if (
    !Array.isArray(rootIds) ||
    !rootIds.every(rootId => typeof rootId === 'string' && rootId.length > 0) ||
    !isRecord(nodes)
  ) {
    throw new ArchiveTraversalError(
      'archive-structure-invalid',
      'Archive roots and node map must have canonical shapes.'
    );
  }
  return { rootIds, nodes };
}

function requireNode(graph: TraversalGraph, nodeId: string): TraversalNode {
  const value = graph.nodes[nodeId];
  if (!isRecord(value)) {
    throw new ArchiveTraversalError('node-reference-missing', `Node ${nodeId} does not exist.`);
  }
  if (
    (value.parentId !== null && typeof value.parentId !== 'string') ||
    !Array.isArray(value.childIds) ||
    !value.childIds.every(childId => typeof childId === 'string' && childId.length > 0)
  ) {
    throw new ArchiveTraversalError(
      'node-structure-invalid',
      `Node ${nodeId} has an invalid parent or child list.`
    );
  }
  return { parentId: value.parentId, childIds: value.childIds };
}

/**
 * Returns the root-to-target path through parent links. Structural nodes are
 * intentionally retained; consumers decide later whether to render them.
 */
export function getNodePath(archive: LiskaThreadArchive, targetNodeId: string | null): string[] {
  const graph = requireGraph(archive);
  if (typeof targetNodeId !== 'string' || targetNodeId.length === 0) {
    throw new ArchiveTraversalError('target-node-missing', 'A target node ID is required.');
  }

  const reversedPath: string[] = [];
  const seen = new Set<string>();
  let nodeId: string | null = targetNodeId;

  while (nodeId !== null) {
    if (seen.has(nodeId)) {
      throw new ArchiveTraversalError('graph-cycle', `Parent links cycle at node ${nodeId}.`);
    }
    seen.add(nodeId);
    const node = requireNode(graph, nodeId);
    reversedPath.push(nodeId);

    if (node.parentId === null) {
      if (!graph.rootIds.includes(nodeId)) {
        throw new ArchiveTraversalError(
          'root-not-declared',
          `Node ${nodeId} has no parent but is not a declared root.`
        );
      }
      break;
    }

    const parent = requireNode(graph, node.parentId);
    if (!parent.childIds.includes(nodeId)) {
      throw new ArchiveTraversalError(
        'parent-child-asymmetry',
        `Parent ${node.parentId} does not list child ${nodeId}.`
      );
    }
    nodeId = node.parentId;
  }

  return reversedPath.reverse();
}

/** Returns the root-to-current-node path, including empty structural nodes. */
export function getCurrentNodePath(archive: LiskaThreadArchive): string[] {
  if (!isRecord(archive) || !isRecord(archive.conversation)) {
    throw new ArchiveTraversalError(
      'archive-structure-invalid',
      'Archive conversation must be an object.'
    );
  }
  const currentNodeId = archive.conversation.currentNodeId;
  return getNodePath(archive, typeof currentNodeId === 'string' ? currentNodeId : null);
}

interface LeafTraversalFrame {
  nodeId: string;
  node?: TraversalNode;
  nextChildIndex: number;
}

function leaveLeafFrame(stack: LeafTraversalFrame[], path: string[], active: Set<string>): void {
  const frame = stack.pop();
  if (!frame) return;
  active.delete(frame.nodeId);
  path.pop();
}

/**
 * Visit one declared root without recursive calls. Real ChatGPT threads can
 * contain thousands of nodes, so call-stack depth must not be a graph-size
 * limit for branch enumeration.
 */
function visitRootLeaves(
  graph: TraversalGraph,
  rootId: string,
  active: Set<string>,
  visited: Set<string>,
  leaves: string[][]
): void {
  const path: string[] = [];
  const stack: LeafTraversalFrame[] = [{ nodeId: rootId, nextChildIndex: 0 }];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];

    if (!frame.node) {
      if (active.has(frame.nodeId)) {
        throw new ArchiveTraversalError(
          'graph-cycle',
          `Child links cycle at node ${frame.nodeId}.`
        );
      }
      if (visited.has(frame.nodeId)) {
        throw new ArchiveTraversalError(
          'duplicate-reachable-node',
          `Node ${frame.nodeId} is reached more than once from declared roots.`
        );
      }

      frame.node = requireNode(graph, frame.nodeId);
      active.add(frame.nodeId);
      visited.add(frame.nodeId);
      path.push(frame.nodeId);

      if (frame.node.childIds.length === 0) {
        leaves.push([...path]);
        leaveLeafFrame(stack, path, active);
      }
      continue;
    }

    if (frame.nextChildIndex < frame.node.childIds.length) {
      const childId = frame.node.childIds[frame.nextChildIndex++];
      const child = requireNode(graph, childId);
      if (child.parentId !== frame.nodeId) {
        throw new ArchiveTraversalError(
          'child-parent-asymmetry',
          `Child ${childId} does not identify ${frame.nodeId} as its parent.`
        );
      }
      stack.push({ nodeId: childId, nextChildIndex: 0 });
      continue;
    }

    leaveLeafFrame(stack, path, active);
  }
}

/**
 * Enumerates every declared-root-to-leaf path in root order and each node's
 * ordered child sequence. It does not infer branches from object key order.
 */
export function getLeafNodePaths(archive: LiskaThreadArchive): string[][] {
  const graph = requireGraph(archive);
  const leaves: string[][] = [];
  const active = new Set<string>();
  const visited = new Set<string>();

  graph.rootIds.forEach(rootId => {
    const root = requireNode(graph, rootId);
    if (root.parentId !== null) {
      throw new ArchiveTraversalError(
        'root-not-declared',
        `Declared root ${rootId} has a non-null parent.`
      );
    }
    visitRootLeaves(graph, rootId, active, visited, leaves);
  });

  return leaves;
}

/** Deterministic leaf IDs, preserving root and child order. */
export function getLeafNodeIds(archive: LiskaThreadArchive): string[] {
  return getLeafNodePaths(archive).map(path => path[path.length - 1]);
}
