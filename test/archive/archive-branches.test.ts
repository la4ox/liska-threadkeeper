import { describe, expect, it } from 'vitest';
import {
  ArchiveBranchCatalogError,
  getArchiveBranchCatalog,
  type ArchiveMessage,
  type ArchiveNode,
  type LiskaThreadArchive,
  type SourceReference,
} from '../../src/archive';
import branchingFixture from '../fixtures/archive/branching-chatgpt-thread.json';

const sourceRef: SourceReference = {
  format: 'synthetic/1',
  kind: 'node',
  id: 'synthetic-source',
  artifactId: 'synthetic-artifact',
  rawPointer: null,
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function message(nodeId: string, role: string): ArchiveMessage {
  return {
    id: `message-${nodeId}`,
    author: { role, name: null },
    recipient: null,
    channel: null,
    createdAt: null,
    updatedAt: null,
    status: null,
    model: null,
    visibility: null,
    blocks: [],
    sourceRefs: [sourceRef],
    extensions: {},
  };
}

function node(id: string, parentId: string | null, childIds: string[], role?: string): ArchiveNode {
  return {
    id,
    parentId,
    childIds,
    ...(role === undefined ? {} : { message: message(id, role) }),
    sourceRefs: [sourceRef],
    extensions: {},
  };
}

function archive(
  rootIds: string[],
  nodes: Record<string, ArchiveNode>,
  currentNodeId: string | null
): LiskaThreadArchive {
  const result = clone(branchingFixture) as LiskaThreadArchive;
  result.graph = { rootIds, nodes };
  result.assets = {};
  result.conversation.currentNodeId = currentNodeId;
  return result;
}

describe('archive branch catalog', () => {
  it('catalogs one path while retaining empty structural nodes', () => {
    const result = getArchiveBranchCatalog(
      archive(
        ['root'],
        {
          root: node('root', null, ['user']),
          user: node('user', 'root', ['tool'], 'user'),
          tool: node('tool', 'user', ['assistant'], 'tool'),
          assistant: node('assistant', 'tool', [], 'assistant'),
        },
        'assistant'
      )
    );

    expect(result).toMatchObject({
      currentNodeId: 'assistant',
      currentNodeIds: ['root', 'user', 'tool', 'assistant'],
      branchPointCount: 0,
      branchPointNodeIds: [],
    });
    expect(result.branches).toEqual([
      {
        ordinal: 1,
        targetNodeId: 'assistant',
        nodeCount: 4,
        uniqueNodeIds: ['root', 'user', 'tool', 'assistant'],
        messageCount: 3,
        userMessageCount: 1,
        assistantMessageCount: 1,
        isCurrentLeaf: true,
        containsCurrentNode: true,
      },
    ]);
  });

  it('preserves sibling leaf order and flags only the current leaf', () => {
    const result = getArchiveBranchCatalog(
      archive(
        ['root'],
        {
          root: node('root', null, ['prompt']),
          prompt: node('prompt', 'root', ['answer-a', 'answer-b'], 'user'),
          'answer-a': node('answer-a', 'prompt', [], 'assistant'),
          'answer-b': node('answer-b', 'prompt', [], 'assistant'),
        },
        'answer-a'
      )
    );

    expect(result.branchPointNodeIds).toEqual(['prompt']);
    expect(result.branches.map(branch => branch.targetNodeId)).toEqual(['answer-a', 'answer-b']);
    expect(result.branches.map(branch => branch.uniqueNodeIds)).toEqual([
      ['answer-a'],
      ['answer-b'],
    ]);
    expect(
      result.branches.map(branch => [branch.isCurrentLeaf, branch.containsCurrentNode])
    ).toEqual([
      [true, true],
      [false, false],
    ]);
  });

  it('uses the deepest shared branch point to form nested unique suffixes', () => {
    const result = getArchiveBranchCatalog(
      archive(
        ['root'],
        {
          root: node('root', null, ['intro']),
          intro: node('intro', 'root', ['left', 'fork'], 'user'),
          left: node('left', 'intro', [], 'assistant'),
          fork: node('fork', 'intro', ['middle']),
          middle: node('middle', 'fork', ['deep-left', 'deep-right'], 'assistant'),
          'deep-left': node('deep-left', 'middle', [], 'user'),
          'deep-right': node('deep-right', 'middle', [], 'assistant'),
        },
        'deep-right'
      )
    );

    expect(result.branchPointNodeIds).toEqual(['intro', 'middle']);
    expect(result.branches.map(branch => branch.targetNodeId)).toEqual([
      'left',
      'deep-left',
      'deep-right',
    ]);
    expect(result.branches.map(branch => branch.uniqueNodeIds)).toEqual([
      ['left'],
      ['deep-left'],
      ['deep-right'],
    ]);
    expect(result.branches[1]).toMatchObject({
      messageCount: 3,
      userMessageCount: 2,
      assistantMessageCount: 1,
    });
  });

  it('retains multiple declared roots in their declared order', () => {
    const result = getArchiveBranchCatalog(
      archive(
        ['first-root', 'second-root'],
        {
          'first-root': node('first-root', null, []),
          'second-root': node('second-root', null, ['answer']),
          answer: node('answer', 'second-root', [], 'assistant'),
        },
        'answer'
      )
    );

    expect(result.branches.map(branch => branch.nodeCount)).toEqual([1, 2]);
    expect(result.branches.map(branch => branch.uniqueNodeIds)).toEqual([
      ['first-root'],
      ['second-root', 'answer'],
    ]);
    expect(result.branches.map(branch => branch.containsCurrentNode)).toEqual([false, true]);
  });

  it('keeps the authoritative current path when current node is internal', () => {
    const result = getArchiveBranchCatalog(
      archive(
        ['root'],
        {
          root: node('root', null, ['choice']),
          choice: node('choice', 'root', ['left', 'right']),
          left: node('left', 'choice', [], 'user'),
          right: node('right', 'choice', [], 'assistant'),
        },
        'choice'
      )
    );

    expect(result.currentNodeIds).toEqual(['root', 'choice']);
    expect(result.branches.map(branch => branch.isCurrentLeaf)).toEqual([false, false]);
    expect(result.branches.map(branch => branch.containsCurrentNode)).toEqual([true, true]);
  });

  it('does not use the JavaScript call stack for a 12,000-node path', () => {
    const depth = 12_000;
    const nodes: Record<string, ArchiveNode> = {};
    for (let index = 0; index < depth; index += 1) {
      const id = `deep-${index}`;
      nodes[id] = node(
        id,
        index === 0 ? null : `deep-${index - 1}`,
        index + 1 === depth ? [] : [`deep-${index + 1}`],
        index + 1 === depth ? 'assistant' : undefined
      );
    }

    const result = getArchiveBranchCatalog(archive(['deep-0'], nodes, `deep-${depth - 1}`));

    expect(result.currentNodeIds).toHaveLength(depth);
    expect(result.branches).toHaveLength(1);
    expect(result.branches[0]).toMatchObject({
      targetNodeId: `deep-${depth - 1}`,
      nodeCount: depth,
      messageCount: 1,
      assistantMessageCount: 1,
    });
    expect(result.branches[0].uniqueNodeIds).toHaveLength(depth);
  });

  it('catalogs imported metadata without a declared current target', () => {
    const result = getArchiveBranchCatalog(
      archive(
        ['root'],
        {
          root: node('root', null, ['answer']),
          answer: node('answer', 'root', [], 'assistant'),
        },
        null
      )
    );

    expect(result.currentNodeId).toBeNull();
    expect(result.currentNodeIds).toEqual([]);
    expect(result.branches[0]).toMatchObject({
      isCurrentLeaf: false,
      containsCurrentNode: false,
    });
  });

  it('stores only unique tails for hundreds of leaves after a long shared prefix', () => {
    const sharedPrefixLength = 2_000;
    const leafCount = 400;
    const nodes: Record<string, ArchiveNode> = {};
    const leafIds = Array.from({ length: leafCount }, (_, index) => `leaf-${index}`);

    for (let index = 0; index < sharedPrefixLength; index += 1) {
      const id = `shared-${index}`;
      nodes[id] = node(
        id,
        index === 0 ? null : `shared-${index - 1}`,
        index + 1 === sharedPrefixLength ? leafIds : [`shared-${index + 1}`]
      );
    }
    for (const leafId of leafIds) {
      nodes[leafId] = node(leafId, `shared-${sharedPrefixLength - 1}`, [], 'assistant');
    }

    const result = getArchiveBranchCatalog(archive(['shared-0'], nodes, 'leaf-123'));
    const totalStoredUniqueNodeIds = result.branches.reduce(
      (count, branch) => count + branch.uniqueNodeIds.length,
      0
    );

    expect(result.branches).toHaveLength(leafCount);
    expect(result.branches.map(branch => branch.targetNodeId)).toEqual(leafIds);
    expect(result.branches.every(branch => branch.nodeCount === sharedPrefixLength + 1)).toBe(true);
    expect(totalStoredUniqueNodeIds).toBe(leafCount);
    expect(totalStoredUniqueNodeIds).toBeLessThan(sharedPrefixLength * leafCount);
    for (const branch of result.branches) {
      expect(branch.uniqueNodeIds).toHaveLength(1);
      expect(branch).not.toHaveProperty('nodeIds');
    }
  });

  it('fails closed with a stable code for an invalid canonical archive', () => {
    const invalid = clone(branchingFixture) as Record<string, unknown>;
    invalid.schema = 'not-liska-thread/1';

    expect(() => getArchiveBranchCatalog(invalid)).toThrow(ArchiveBranchCatalogError);
    try {
      getArchiveBranchCatalog(invalid);
    } catch (error) {
      expect(error).toMatchObject({ code: 'archive-invalid' });
    }
  });
});
