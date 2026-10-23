import { afterEach, describe, expect, it, vi } from 'vitest';
import * as archiveModule from '../../src/archive';
import { getArchiveBranchCatalog, type LiskaThreadArchive } from '../../src/archive';
import {
  prepareArchiveBranchPresentation,
  renderArchiveBranchIndex,
  renderArchiveBranchLeaf,
  type ArchiveBranchIndexEntry,
  type ArchiveBranchLeafRender,
} from '../../src/content/archive-branch-bundle';
import { prepareArchiveProjection } from '../../src/content/archive-projection';
import { generateNoteContent } from '../../src/lib/note-generator';
import type { ExtensionSettings, TemplateOptions } from '../../src/lib/types';
import branchingFixture from '../fixtures/archive/branching-chatgpt-thread.json';

const captureId = 'capture-chatgpt-01234567-89ab-4cde-8f01-23456789abcd';
const templateOptions: TemplateOptions = {
  includeId: true,
  includeTitle: true,
  includeTags: true,
  includeSource: true,
  includeDates: true,
  includeMessageCount: true,
  messageFormat: 'callout',
  userCalloutType: 'QUESTION',
  assistantCalloutType: 'NOTE',
  timezone: 'UTC',
  filenameScheme: 'title-id',
};

function archive(): LiskaThreadArchive {
  return JSON.parse(JSON.stringify(branchingFixture)) as LiskaThreadArchive;
}

function entry(leaf: ArchiveBranchLeafRender): ArchiveBranchIndexEntry {
  return {
    ordinal: leaf.ordinal,
    fileName: leaf.note.fileName,
    canonicalMessageCount: leaf.canonicalMessageCount,
    renderedMessageCount: leaf.renderedMessageCount,
    uniqueMessageCount: leaf.uniqueMessageCount,
    isCurrent: leaf.isCurrent,
    status: leaf.status,
  };
}

function mixedArchive(): LiskaThreadArchive {
  const value = archive();
  value.graph.nodes['node-user'].message!.author.role = 'system';
  value.graph.nodes['node-alternate'].message!.author.role = 'tool';
  value.conversation.url = null;
  value.inputs.forEach(input => {
    input.capturedAt = null;
  });
  value.conversation.createdAt = null;
  value.conversation.updatedAt = null;
  return value;
}

function wideArchive(leafCount: number): LiskaThreadArchive {
  const value = archive();
  const parent = value.graph.nodes['node-user'];
  const template = value.graph.nodes['node-alternate'];
  parent.childIds = [];
  delete value.graph.nodes['node-current'];
  delete value.graph.nodes['node-alternate'];
  value.assets = {};
  for (let ordinal = 1; ordinal <= leafCount; ordinal += 1) {
    const nodeId = `wide-leaf-${ordinal}`;
    const message = structuredClone(template.message!);
    message.id = `wide-message-${ordinal}`;
    message.blocks[0].id = `wide-block-${ordinal}`;
    value.graph.nodes[nodeId] = { ...template, id: nodeId, parentId: parent.id, message };
    parent.childIds.push(nodeId);
  }
  value.conversation.currentNodeId = `wide-leaf-${leafCount}`;
  return value;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('prepared all-branches render session', () => {
  it('exposes immutable content-free exact traversal work metrics', () => {
    const value = archive();
    value.graph.nodes['node-user'].message!.blocks[0].text = 'мяу 🐾';
    const catalog = getArchiveBranchCatalog(value);
    const session = prepareArchiveBranchPresentation(value, catalog, templateOptions, captureId);
    const expectedSourceWorkBytes = catalog.branches.reduce((total, branch) => {
      let nodeId: string | null = branch.targetNodeId;
      let branchBytes = 0;
      while (nodeId) {
        const node = value.graph.nodes[nodeId];
        if (node.message) {
          branchBytes += new TextEncoder().encode(JSON.stringify(node.message)).byteLength;
        }
        nodeId = node.parentId;
      }
      return total + branchBytes;
    }, 0);
    expect(session.metrics).toEqual({
      nodeCount: Object.keys(value.graph.nodes).length,
      leafCount: catalog.branches.length,
      branchPointCount: catalog.branchPointCount,
      pathVisits: catalog.branches.reduce((total, branch) => total + branch.nodeCount, 0),
      sourceWorkBytes: expectedSourceWorkBytes,
    });
    expect(Object.isFrozen(session.metrics)).toBe(true);
    expect(Object.keys(session.metrics)).toEqual([
      'nodeCount',
      'leafCount',
      'branchPointCount',
      'pathVisits',
      'sourceWorkBytes',
    ]);
  });

  it.each([false, true])(
    'is byte- and fact-equivalent to defensive wrappers for rendered and canonical-only leaves (tools %s)',
    includeToolContent => {
      const value = mixedArchive();
      const catalog = getArchiveBranchCatalog(value);
      const session = prepareArchiveBranchPresentation(
        value,
        catalog,
        templateOptions,
        captureId,
        includeToolContent
      );
      const leaves = catalog.branches.map(branch => session.renderLeaf(branch.ordinal));
      const settings = { templateOptions } as ExtensionSettings;
      for (const [index, leaf] of leaves.entries()) {
        const defensive = renderArchiveBranchLeaf(
          value,
          catalog,
          catalog.branches[index],
          templateOptions,
          captureId,
          includeToolContent
        );
        expect(leaf).toEqual(defensive);
        expect(generateNoteContent(leaf.note, settings)).toBe(
          generateNoteContent(defensive.note, settings)
        );
      }
      expect(leaves.map(leaf => leaf.status)).toEqual(['rendered', 'canonical-only']);
      const entries = leaves.map(entry);
      expect(session.renderIndex(entries)).toEqual(
        renderArchiveBranchIndex(value, catalog, entries, templateOptions, captureId)
      );
    }
  );

  it('keeps prepared parent paths independent of wide child-array scans and catalog membership searches', () => {
    const value = wideArchive(80);
    const catalog = getArchiveBranchCatalog(value);
    const session = prepareArchiveBranchPresentation(value, catalog, templateOptions, captureId);
    const includes = Array.prototype.includes;
    const every = Array.prototype.every;
    const filter = Array.prototype.filter;
    const find = Array.prototype.find;
    const isWideChildren = (values: unknown[]) => values[0] === 'wide-leaf-1';
    const isCatalog = (values: unknown[]) =>
      typeof values[0] === 'object' && values[0] !== null && 'ordinal' in values[0];
    vi.spyOn(Array.prototype, 'includes').mockImplementation(function (this: unknown[], ...args) {
      if (isWideChildren(this)) throw new Error('Unexpected wide child includes scan');
      return includes.apply(this, args);
    });
    vi.spyOn(Array.prototype, 'every').mockImplementation(function (this: unknown[], ...args) {
      if (isWideChildren(this)) throw new Error('Unexpected wide child every scan');
      return every.apply(this, args);
    });
    vi.spyOn(Array.prototype, 'filter').mockImplementation(function (this: unknown[], ...args) {
      if (isCatalog(this)) throw new Error('Unexpected catalog filter scan');
      return filter.apply(this, args);
    });
    vi.spyOn(Array.prototype, 'find').mockImplementation(function (this: unknown[], ...args) {
      if (isCatalog(this)) throw new Error('Unexpected catalog find scan');
      return find.apply(this, args);
    });
    const entries: ArchiveBranchIndexEntry[] = [];
    for (let ordinal = 1; ordinal <= 80; ordinal += 1) {
      entries.push(entry(session.renderLeaf(ordinal)));
    }
    const index = session.renderIndex(entries);
    vi.restoreAllMocks();
    expect(entries).toHaveLength(80);
    expect(index.body).toContain('80 declared leaf branches');
  });

  it('does not rewalk the public defensive path for an empty legacy projection', () => {
    const value = mixedArchive();
    const catalog = getArchiveBranchCatalog(value);
    const session = prepareArchiveBranchPresentation(value, catalog, templateOptions, captureId);
    const projection = prepareArchiveProjection(value);
    const defensivePath = vi.spyOn(archiveModule, 'getNodePath');
    const empty = projection.project({ targetNodeId: 'node-alternate' });
    expect(empty.selectedNodeIds).toEqual(['node-root', 'node-user', 'node-alternate']);
    expect(empty.data.messages).toEqual([]);
    expect(session.renderLeaf(2).status).toBe('canonical-only');
    expect(defensivePath).not.toHaveBeenCalled();
    expect(() => projection.project({ targetNodeId: 'toString' })).toThrow(
      'target node is missing'
    );
  });

  it('rejects forged catalogs and archive drift before creating any render session', () => {
    const mutations = [
      (catalog: ReturnType<typeof getArchiveBranchCatalog>) => (catalog.branches[0].ordinal = 2),
      (catalog: ReturnType<typeof getArchiveBranchCatalog>) =>
        (catalog.branches[0].nodeCount = 999),
      (catalog: ReturnType<typeof getArchiveBranchCatalog>) =>
        (catalog.branches[0].messageCount = 999),
      (catalog: ReturnType<typeof getArchiveBranchCatalog>) =>
        (catalog.branches[0].uniqueNodeIds = ['node-current', 'node-current']),
      (catalog: ReturnType<typeof getArchiveBranchCatalog>) => catalog.branches.pop(),
      (catalog: ReturnType<typeof getArchiveBranchCatalog>) => catalog.branches.reverse(),
      (catalog: ReturnType<typeof getArchiveBranchCatalog>) => (catalog.branchPointCount = 99),
      (catalog: ReturnType<typeof getArchiveBranchCatalog>) => (catalog.branchPointNodeIds = []),
      (catalog: ReturnType<typeof getArchiveBranchCatalog>) => (catalog.currentNodeIds = []),
      (catalog: ReturnType<typeof getArchiveBranchCatalog>) => (catalog.currentNodeId = null),
    ];
    for (const mutate of mutations) {
      const value = archive();
      const catalog = getArchiveBranchCatalog(value);
      mutate(catalog);
      expect(() =>
        prepareArchiveBranchPresentation(value, catalog, templateOptions, captureId)
      ).toThrow('catalog');
    }
    const value = archive();
    const catalog = getArchiveBranchCatalog(value);
    value.graph.nodes['node-user'].message!.author.role = 'system';
    expect(() =>
      prepareArchiveBranchPresentation(value, catalog, templateOptions, captureId)
    ).toThrow('catalog');
    value.graph.nodes['node-user'].childIds = [];
    expect(() =>
      prepareArchiveBranchPresentation(value, catalog, templateOptions, captureId)
    ).toThrow('Canonical archive is invalid');
  });

  it('uses copied structural metadata and compact catalog facts during the owned session', () => {
    const value = archive();
    const catalog = getArchiveBranchCatalog(value);
    const session = prepareArchiveBranchPresentation(value, catalog, templateOptions, captureId);
    const expected = catalog.branches.map(branch =>
      renderArchiveBranchLeaf(value, catalog, branch, templateOptions, captureId)
    );
    value.conversation.currentNodeId = 'node-alternate';
    value.conversation.title = 'Changed after preparation';
    value.graph.nodes['node-current'].parentId = null;
    value.graph.nodes['node-user'].childIds.length = 0;
    catalog.branches.reverse();
    catalog.branchPointCount = 99;
    expect(session.renderLeaf(1)).toEqual(expected[0]);
    expect(session.renderLeaf(2)).toEqual(expected[1]);
    const index = session.renderIndex(expected.map(entry));
    expect(index.frontmatter.branch_point_count).toBe(1);
    expect(index.frontmatter.title).toBe('Synthetic branch fixture — All branches');
  });

  it('retains strict ordinal, complete-index, filename and exact produced-fact checks', () => {
    const value = archive();
    const session = prepareArchiveBranchPresentation(
      value,
      getArchiveBranchCatalog(value),
      templateOptions,
      captureId
    );
    for (const ordinal of [0, -1, 1.5, 3, NaN]) {
      expect(() => session.renderLeaf(ordinal)).toThrow('exact member');
    }
    const first = entry(session.renderLeaf(1));
    expect(() => session.renderIndex([first])).toThrow('cover every catalog leaf');
    const second = entry(session.renderLeaf(2));
    expect(() => session.renderIndex([second, first])).toThrow(
      'deterministic catalog ordinal order'
    );
    expect(() => session.renderIndex([first, { ...second, fileName: '../outside.md' }])).toThrow(
      'unsafe leaf filename'
    );
    for (const change of [
      { fileName: 'different-safe-name.md' },
      { canonicalMessageCount: 99 },
      { renderedMessageCount: 99 },
      { uniqueMessageCount: 99 },
      { isCurrent: true },
      { status: 'canonical-only' as const },
    ]) {
      expect(() => session.renderIndex([first, { ...second, ...change }])).toThrow(
        'does not match its prepared leaf'
      );
    }
  });

  it('freezes title-date filenames and modified timestamps across the two render passes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 23, 59, 59));
    const value = archive();
    const session = prepareArchiveBranchPresentation(
      value,
      getArchiveBranchCatalog(value),
      { ...templateOptions, filenameScheme: 'title-date', timezone: 'UTC' },
      captureId
    );
    const measured = [session.renderLeaf(1), session.renderLeaf(2)];

    vi.setSystemTime(new Date(2026, 0, 2, 0, 0, 1));
    const written = [session.renderLeaf(1), session.renderLeaf(2)];

    expect(written.map(leaf => leaf.note.fileName)).toEqual(
      measured.map(leaf => leaf.note.fileName)
    );
    expect(written.map(leaf => leaf.note.frontmatter.modified)).toEqual(
      measured.map(leaf => leaf.note.frontmatter.modified)
    );
    expect(session.renderIndex(measured.map(entry)).fileName).toContain('2026-01-01');
  });
});
