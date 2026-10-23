import type { ArchiveBranchCatalog, ArchiveBranchDescriptor, LiskaThreadArchive } from '../archive';
import { utf8ByteLength } from '../lib/byte-size';
import { checkedAdd, type ArchiveBranchWorkMetrics } from './archive-branch-budget';
import { prepareArchiveProjection, type PreparedArchiveProjection } from './archive-projection';

interface PreparedBranch {
  descriptor: ArchiveBranchDescriptor;
  canonicalMessageCount: number;
  uniqueMessageCount: number;
}

/** Module-internal preparation result, consumed only by the owned presentation session. */
export interface PreparedArchiveBranchGraph {
  archive: LiskaThreadArchive;
  catalog: ArchiveBranchCatalog;
  branches: PreparedBranch[];
  projection: PreparedArchiveProjection;
  metrics: ArchiveBranchWorkMetrics;
}

interface CatalogFrame {
  nodeId: string;
  nextChild: number;
  entered: boolean;
  lastBranchIndex: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  containsCurrentNode: boolean;
  cumulativeSourceBytes: number;
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((nodeId, index) => nodeId === right[index]);
}

function snapshotArchive(archive: LiskaThreadArchive): LiskaThreadArchive {
  return {
    ...archive,
    conversation: { ...archive.conversation },
    inputs: archive.inputs.map(input => ({ ...input })),
    graph: {
      rootIds: [...archive.graph.rootIds],
      nodes: Object.fromEntries(
        Object.entries(archive.graph.nodes).map(([nodeId, node]) => [
          nodeId,
          { ...node, childIds: [...node.childIds] },
        ])
      ),
    },
  };
}

function frame(nodeId: string): CatalogFrame {
  return {
    nodeId,
    nextChild: 0,
    entered: false,
    lastBranchIndex: -1,
    messageCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    containsCurrentNode: false,
    cumulativeSourceBytes: 0,
  };
}

function enterFrame(
  current: CatalogFrame,
  parent: CatalogFrame | undefined,
  archive: LiskaThreadArchive,
  path: string[],
  branchPoints: string[],
  messageByteLengths: Map<string, number>
): void {
  const node = archive.graph.nodes[current.nodeId];
  const message = node.message;
  const inherited = parent ?? frame('');
  const role = message?.author.role;
  current.entered = true;
  path.push(current.nodeId);
  current.messageCount = inherited.messageCount + (message ? 1 : 0);
  current.userMessageCount = inherited.userMessageCount + (role === 'user' ? 1 : 0);
  current.assistantMessageCount = inherited.assistantMessageCount + (role === 'assistant' ? 1 : 0);
  current.containsCurrentNode =
    inherited.containsCurrentNode || current.nodeId === archive.conversation.currentNodeId;
  current.lastBranchIndex = inherited.lastBranchIndex;
  let messageBytes = 0;
  if (message) {
    const cached = messageByteLengths.get(current.nodeId);
    messageBytes = cached ?? utf8ByteLength(JSON.stringify(message));
    if (cached === undefined) messageByteLengths.set(current.nodeId, messageBytes);
  }
  current.cumulativeSourceBytes = checkedAdd(
    inherited.cumulativeSourceBytes,
    messageBytes,
    'archive source work bytes'
  );
  if (node.childIds.length > 1) {
    current.lastBranchIndex = path.length - 1;
    branchPoints.push(current.nodeId);
  }
}

function requireMatchingDescriptor(
  supplied: ArchiveBranchDescriptor | undefined,
  expected: ArchiveBranchDescriptor
): void {
  if (
    !supplied ||
    supplied.ordinal !== expected.ordinal ||
    supplied.targetNodeId !== expected.targetNodeId ||
    supplied.nodeCount !== expected.nodeCount ||
    supplied.messageCount !== expected.messageCount ||
    supplied.userMessageCount !== expected.userMessageCount ||
    supplied.assistantMessageCount !== expected.assistantMessageCount ||
    supplied.isCurrentLeaf !== expected.isCurrentLeaf ||
    supplied.containsCurrentNode !== expected.containsCurrentNode ||
    !sameIds(supplied.uniqueNodeIds, expected.uniqueNodeIds)
  ) {
    throw new Error('Archive branch catalog does not match the canonical archive.');
  }
}

function appendBranch(
  archive: LiskaThreadArchive,
  catalog: ArchiveBranchCatalog,
  current: CatalogFrame,
  path: string[],
  branches: PreparedBranch[]
): void {
  const descriptor: ArchiveBranchDescriptor = {
    ordinal: branches.length + 1,
    targetNodeId: current.nodeId,
    nodeCount: path.length,
    uniqueNodeIds: path.slice(current.lastBranchIndex + 1),
    messageCount: current.messageCount,
    userMessageCount: current.userMessageCount,
    assistantMessageCount: current.assistantMessageCount,
    isCurrentLeaf: current.nodeId === archive.conversation.currentNodeId,
    containsCurrentNode: current.containsCurrentNode,
  };
  requireMatchingDescriptor(catalog.branches[branches.length], descriptor);
  branches.push({
    descriptor,
    canonicalMessageCount: descriptor.messageCount,
    uniqueMessageCount: descriptor.uniqueNodeIds.reduce(
      (count, nodeId) => count + (archive.graph.nodes[nodeId].message ? 1 : 0),
      0
    ),
  });
}

/** One iterative verification pass; it never retains a complete path for every leaf. */
// eslint-disable-next-line max-lines-per-function -- One explicit iterative DFS keeps metrics and catalog verification in the same traversal.
function verifyCatalog(
  archive: LiskaThreadArchive,
  catalog: ArchiveBranchCatalog
): {
  branches: PreparedBranch[];
  branchPoints: string[];
  pathVisits: number;
  sourceWorkBytes: number;
} {
  const branches: PreparedBranch[] = [];
  const branchPoints: string[] = [];
  const path: string[] = [];
  const messageByteLengths = new Map<string, number>();
  let pathVisits = 0;
  let sourceWorkBytes = 0;
  for (const rootId of archive.graph.rootIds) {
    const stack = [frame(rootId)];
    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const node = archive.graph.nodes[current.nodeId];
      if (!current.entered) {
        enterFrame(
          current,
          stack[stack.length - 2],
          archive,
          path,
          branchPoints,
          messageByteLengths
        );
        if (
          current.nodeId === archive.conversation.currentNodeId &&
          !sameIds(catalog.currentNodeIds, path)
        ) {
          throw new Error(
            'Archive branch catalog current path does not match the canonical archive.'
          );
        }
        if (node.childIds.length === 0) {
          pathVisits = checkedAdd(pathVisits, path.length, 'archive path visits');
          sourceWorkBytes = checkedAdd(
            sourceWorkBytes,
            current.cumulativeSourceBytes,
            'archive source work bytes'
          );
          appendBranch(archive, catalog, current, path, branches);
        }
      }
      if (current.nextChild < node.childIds.length) {
        stack.push(frame(node.childIds[current.nextChild++]));
      } else {
        stack.pop();
        path.pop();
      }
    }
  }
  return { branches, branchPoints, pathVisits, sourceWorkBytes };
}

/**
 * Mandatory validation followed by exact whole-catalog verification. The owned
 * session may retain message references, but callers must not mutate message
 * bodies during it. Structure and compact catalog facts are copied privately.
 */
export function prepareArchiveBranchGraph(
  archive: LiskaThreadArchive,
  catalog: ArchiveBranchCatalog
): PreparedArchiveBranchGraph {
  const projection = prepareArchiveProjection(archive);
  const snapshot = snapshotArchive(archive);
  const { branches, branchPoints, pathVisits, sourceWorkBytes } = verifyCatalog(snapshot, catalog);
  if (
    branches.length === 0 ||
    branches.length !== catalog.branches.length ||
    catalog.currentNodeId !== snapshot.conversation.currentNodeId ||
    (catalog.currentNodeId === null && catalog.currentNodeIds.length !== 0) ||
    catalog.branchPointCount !== branchPoints.length ||
    !sameIds(catalog.branchPointNodeIds, branchPoints)
  ) {
    throw new Error('Archive branch catalog does not match the canonical archive.');
  }
  return {
    archive: snapshot,
    catalog: {
      currentNodeId: catalog.currentNodeId,
      currentNodeIds: [...catalog.currentNodeIds],
      branches: branches.map(branch => branch.descriptor),
      branchPointNodeIds: branchPoints,
      branchPointCount: branchPoints.length,
    },
    branches,
    projection,
    metrics: Object.freeze({
      nodeCount: Object.keys(snapshot.graph.nodes).length,
      leafCount: branches.length,
      branchPointCount: branchPoints.length,
      pathVisits,
      sourceWorkBytes,
    }),
  };
}
