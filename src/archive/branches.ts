import { getCurrentNodePath } from './traverse';
import type { ArchiveNode, LiskaThreadArchive } from './types';
import { validateLiskaThreadArchive } from './validate';

export type ArchiveBranchCatalogErrorCode = 'archive-invalid';

/** Stable failure for consumers that require a complete, validated branch catalog. */
export class ArchiveBranchCatalogError extends Error {
  readonly code: ArchiveBranchCatalogErrorCode;

  constructor(code: ArchiveBranchCatalogErrorCode, message: string) {
    super(message);
    this.name = 'ArchiveBranchCatalogError';
    this.code = code;
  }
}

/** Compact summary of one declared root-to-leaf path. */
export interface ArchiveBranchDescriptor {
  /** One-based, deterministic position in declared root and child order. */
  ordinal: number;
  /** The provider-owned leaf node ID used to select this branch later. */
  targetNodeId: string;
  /** Count of all nodes on this path, including empty structural nodes. */
  nodeCount: number;
  /** Suffix after the longest prefix shared with any other declared leaf. */
  uniqueNodeIds: string[];
  /** Count of all nodes on this path that retain a canonical message. */
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  /** True only when this leaf is the archive's declared current node. */
  isCurrentLeaf: boolean;
  /** True when the authoritative current path ends at a node on this branch. */
  containsCurrentNode: boolean;
}

/**
 * Pure presentation-neutral summary of all complete paths retained by a
 * validated `liska-thread/1` graph.
 */
export interface ArchiveBranchCatalog {
  /** Declared provider current node; it may be absent in imported metadata. */
  currentNodeId: string | null;
  /** Authoritative root-to-current path, or empty when no current node is declared. */
  currentNodeIds: string[];
  /** Declared root-to-leaf branches in root and ordered-child traversal order. */
  branches: ArchiveBranchDescriptor[];
  /** Every node with more than one ordered child, in graph traversal order. */
  branchPointNodeIds: string[];
  branchPointCount: number;
}

interface TraversalFrame {
  nodeId: string;
  nextChildIndex: number;
  entered: boolean;
  lastBranchPointIndex: number;
  nodeCount: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  containsCurrentNode: boolean;
}

type CumulativeFrameMetrics = Pick<
  TraversalFrame,
  | 'nodeCount'
  | 'messageCount'
  | 'userMessageCount'
  | 'assistantMessageCount'
  | 'containsCurrentNode'
>;

const EMPTY_CUMULATIVE_FRAME_METRICS: CumulativeFrameMetrics = {
  nodeCount: 0,
  messageCount: 0,
  userMessageCount: 0,
  assistantMessageCount: 0,
  containsCurrentNode: false,
};

interface EnumeratedBranchGraph {
  branches: ArchiveBranchDescriptor[];
  branchPointNodeIds: string[];
}

function requireValidArchive(input: unknown): LiskaThreadArchive {
  const validation = validateLiskaThreadArchive(input);
  if (validation.valid) return input as LiskaThreadArchive;

  const firstError = validation.issues.find(issue => issue.severity === 'error');
  throw new ArchiveBranchCatalogError(
    'archive-invalid',
    `Canonical archive is invalid${firstError ? ` (${firstError.code} at ${firstError.path})` : ''}.`
  );
}

function requireNode(archive: LiskaThreadArchive, nodeId: string): ArchiveNode {
  const node = archive.graph.nodes[nodeId];
  if (!node) {
    throw new Error(`Validated graph unexpectedly omits node ${nodeId}.`);
  }
  return node;
}

/**
 * Enumerate leaves without recursive calls: real conversations can exceed
 * normal JavaScript call-stack depth. Validation has already established the
 * graph's tree invariants, so a node is entered at most once.
 */
function enumerateBranchGraph(archive: LiskaThreadArchive): EnumeratedBranchGraph {
  const branches: ArchiveBranchDescriptor[] = [];
  const branchPointNodeIds: string[] = [];
  const path: string[] = [];
  const activeNodeIds = new Set<string>();
  const visitedNodeIds = new Set<string>();
  const { currentNodeId } = archive.conversation;

  for (const rootId of archive.graph.rootIds) {
    enumerateRootLeaves(
      archive,
      rootId,
      branches,
      branchPointNodeIds,
      path,
      activeNodeIds,
      visitedNodeIds,
      currentNodeId
    );
  }

  return { branches, branchPointNodeIds };
}

function enumerateRootLeaves(
  archive: LiskaThreadArchive,
  rootId: string,
  branches: ArchiveBranchDescriptor[],
  branchPointNodeIds: string[],
  path: string[],
  activeNodeIds: Set<string>,
  visitedNodeIds: Set<string>,
  currentNodeId: string | null
): void {
  const stack: TraversalFrame[] = [createTraversalFrame(rootId)];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const node = requireNode(archive, frame.nodeId);

    if (!frame.entered) {
      const parentFrame = stack.length > 1 ? stack[stack.length - 2] : undefined;
      enterFrame(
        frame,
        parentFrame,
        node,
        path,
        activeNodeIds,
        visitedNodeIds,
        branchPointNodeIds,
        currentNodeId
      );
      if (node.childIds.length > 0) continue;
      appendLeafDescriptor(branches, frame, path, currentNodeId);
    } else if (pushNextChild(frame, node, stack)) {
      continue;
    }

    leaveFrame(frame, path, activeNodeIds, stack);
  }
}

function enterFrame(
  frame: TraversalFrame,
  parentFrame: TraversalFrame | undefined,
  node: ArchiveNode,
  path: string[],
  activeNodeIds: Set<string>,
  visitedNodeIds: Set<string>,
  branchPointNodeIds: string[],
  currentNodeId: string | null
): void {
  if (activeNodeIds.has(frame.nodeId) || visitedNodeIds.has(frame.nodeId)) {
    throw new Error(`Validated graph unexpectedly revisits node ${frame.nodeId}.`);
  }
  frame.entered = true;
  activeNodeIds.add(frame.nodeId);
  visitedNodeIds.add(frame.nodeId);
  path.push(frame.nodeId);
  accumulateFrameMetrics(frame, parentFrame, node, currentNodeId);
  setLastBranchPoint(frame, parentFrame, node, path, branchPointNodeIds);
}

function accumulateFrameMetrics(
  frame: TraversalFrame,
  parentFrame: TraversalFrame | undefined,
  node: ArchiveNode,
  currentNodeId: string | null
): void {
  const parentMetrics = getParentMetrics(parentFrame);
  const message = node.message;
  frame.nodeCount = parentMetrics.nodeCount + 1;
  frame.messageCount = parentMetrics.messageCount;
  frame.userMessageCount = parentMetrics.userMessageCount;
  frame.assistantMessageCount = parentMetrics.assistantMessageCount;
  frame.containsCurrentNode = parentMetrics.containsCurrentNode;
  if (frame.nodeId === currentNodeId) frame.containsCurrentNode = true;
  if (!message) return;

  frame.messageCount += 1;
  if (message.author.role === 'user') frame.userMessageCount += 1;
  if (message.author.role === 'assistant') frame.assistantMessageCount += 1;
}

function getParentMetrics(parentFrame: TraversalFrame | undefined): CumulativeFrameMetrics {
  return parentFrame ?? EMPTY_CUMULATIVE_FRAME_METRICS;
}

function setLastBranchPoint(
  frame: TraversalFrame,
  parentFrame: TraversalFrame | undefined,
  node: ArchiveNode,
  path: string[],
  branchPointNodeIds: string[]
): void {
  frame.lastBranchPointIndex = parentFrame?.lastBranchPointIndex ?? -1;
  if (node.childIds.length > 1) {
    frame.lastBranchPointIndex = path.length - 1;
    branchPointNodeIds.push(frame.nodeId);
  }
}

function appendLeafDescriptor(
  branches: ArchiveBranchDescriptor[],
  frame: TraversalFrame,
  path: string[],
  currentNodeId: string | null
): void {
  branches.push({
    ordinal: branches.length + 1,
    targetNodeId: frame.nodeId,
    nodeCount: frame.nodeCount,
    uniqueNodeIds: path.slice(frame.lastBranchPointIndex + 1),
    messageCount: frame.messageCount,
    userMessageCount: frame.userMessageCount,
    assistantMessageCount: frame.assistantMessageCount,
    isCurrentLeaf: frame.nodeId === currentNodeId,
    containsCurrentNode: frame.containsCurrentNode,
  });
}

function leaveFrame(
  frame: TraversalFrame,
  path: string[],
  activeNodeIds: Set<string>,
  stack: TraversalFrame[]
): void {
  activeNodeIds.delete(frame.nodeId);
  path.pop();
  stack.pop();
}

function pushNextChild(frame: TraversalFrame, node: ArchiveNode, stack: TraversalFrame[]): boolean {
  if (frame.nextChildIndex >= node.childIds.length) return false;
  const childId = node.childIds[frame.nextChildIndex];
  frame.nextChildIndex += 1;
  stack.push(createTraversalFrame(childId));
  return true;
}

function createTraversalFrame(nodeId: string): TraversalFrame {
  return {
    nodeId,
    nextChildIndex: 0,
    entered: false,
    lastBranchPointIndex: -1,
    nodeCount: 0,
    messageCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    containsCurrentNode: false,
  };
}

/**
 * Build a validated, deterministic branch catalog without rendering or
 * inspecting message content. The canonical archive remains the authority.
 */
export function getArchiveBranchCatalog(input: unknown): ArchiveBranchCatalog {
  const archive = requireValidArchive(input);
  const { currentNodeId } = archive.conversation;

  try {
    const currentNodeIds = currentNodeId === null ? [] : getCurrentNodePath(archive);
    const { branches, branchPointNodeIds } = enumerateBranchGraph(archive);
    return {
      currentNodeId,
      currentNodeIds,
      branches,
      branchPointNodeIds,
      branchPointCount: branchPointNodeIds.length,
    };
  } catch (error) {
    if (error instanceof ArchiveBranchCatalogError) throw error;
    throw new ArchiveBranchCatalogError(
      'archive-invalid',
      'Canonical archive could not be traversed as a complete branch graph.'
    );
  }
}
