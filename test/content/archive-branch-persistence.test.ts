import { afterEach, describe, expect, it, vi } from 'vitest';
import * as archiveModule from '../../src/archive';
import * as branchBundle from '../../src/content/archive-branch-bundle';
import { getArchiveBranchCatalog, type LiskaThreadArchive } from '../../src/archive';
import { persistAllBranchesPresentation } from '../../src/content/archive-branch-persistence';
import type {
  AllBranchesPresentationPlan,
  ArchiveCompanionBundle,
  TemplateOptions,
} from '../../src/lib/types';
import branchingFixture from '../fixtures/archive/branching-chatgpt-thread.json';

const captureId = 'capture-chatgpt-11111111-2222-4333-8444-555555555555';
const companion: ArchiveCompanionBundle = {
  captureId,
  conversationKey: 'a'.repeat(64),
  artifacts: [
    {
      kind: 'raw',
      relativePath: 'responses/conversation.json',
      mediaType: 'application/json',
      byteLength: 2,
      sha256: 'b'.repeat(64),
      bodyBase64: 'e30=',
    },
    {
      kind: 'manifest',
      relativePath: 'manifest.json',
      mediaType: 'application/json',
      byteLength: 2,
      sha256: 'c'.repeat(64),
      bodyBase64: 'e30=',
    },
    {
      kind: 'canonical',
      relativePath: 'canonical/liska-thread-1.json',
      mediaType: 'application/json',
      byteLength: 2,
      sha256: 'd'.repeat(64),
      bodyBase64: 'e30=',
    },
  ],
};

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
};
const measureNoteBytes = (note: { body: string }): number =>
  new TextEncoder().encode(note.body).byteLength;

function plan(): AllBranchesPresentationPlan {
  const archive = JSON.parse(JSON.stringify(branchingFixture)) as LiskaThreadArchive;
  return { archive, catalog: getArchiveBranchCatalog(archive) };
}

function widePlan(leafCount: number): AllBranchesPresentationPlan {
  const archive = JSON.parse(JSON.stringify(branchingFixture)) as LiskaThreadArchive;
  const parent = archive.graph.nodes['node-user'];
  const template = archive.graph.nodes['node-alternate'];
  parent.childIds = [];
  delete archive.graph.nodes['node-current'];
  delete archive.graph.nodes['node-alternate'];
  archive.assets = {};

  for (let index = 1; index <= leafCount; index += 1) {
    const nodeId = `wide-leaf-${index}`;
    const message = JSON.parse(JSON.stringify(template.message!));
    message.id = `wide-message-${index}`;
    message.blocks = [
      {
        id: `wide-block-${index}`,
        type: 'text',
        text: `Synthetic branch ${index}`,
        sourceRefs: message.sourceRefs,
        extensions: {},
      },
    ];
    archive.graph.nodes[nodeId] = {
      ...JSON.parse(JSON.stringify(template)),
      id: nodeId,
      parentId: parent.id,
      childIds: [],
      message,
    };
    parent.childIds.push(nodeId);
  }
  archive.conversation.currentNodeId = `wide-leaf-${leafCount}`;
  return { archive, catalog: getArchiveBranchCatalog(archive) };
}

afterEach(() => vi.restoreAllMocks());

describe('all-branches sequential persistence', () => {
  it('writes companions once per durable destination, then every leaf and one index', async () => {
    const persistCompanions = vi.fn().mockResolvedValue([]);
    const writeNote = vi.fn().mockResolvedValue('confirmed');
    const onProgress = vi.fn();

    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file', 'obsidian', 'clipboard'],
      { persistCompanions, writeNote, measureNoteBytes, onProgress }
    );

    expect(persistCompanions).toHaveBeenCalledTimes(2);
    expect(persistCompanions.mock.calls.map(call => call[3])).toEqual([['file'], ['obsidian']]);
    expect(writeNote).toHaveBeenCalledTimes(6);
    expect(writeNote.mock.calls.map(call => call[1])).toEqual([
      'file',
      'obsidian',
      'file',
      'obsidian',
      'file',
      'obsidian',
    ]);
    expect(writeNote.mock.calls.map(call => call[0].frontmatter.presentation_mode)).toEqual([
      'all-branches-leaf',
      'all-branches-leaf',
      'all-branches-leaf',
      'all-branches-leaf',
      'all-branches-index',
      'all-branches-index',
    ]);
    expect(onProgress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(summary).toMatchObject({
      branchCount: 2,
      clipboardSkipped: true,
      allSuccessful: true,
      destinations: [
        { destination: 'file', archiveSaved: true, branchFilesSaved: 2, indexSaved: true },
        { destination: 'obsidian', archiveSaved: true, branchFilesSaved: 2, indexSaved: true },
      ],
    });
  });

  it('skips every presentation write when no durable destination is enabled', async () => {
    const persistCompanions = vi.fn();
    const writeNote = vi.fn();

    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['clipboard'],
      { persistCompanions, writeNote, measureNoteBytes }
    );

    expect(persistCompanions).not.toHaveBeenCalled();
    expect(writeNote).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      branchCount: 2,
      clipboardSkipped: true,
      destinations: [],
      allSuccessful: false,
    });
  });

  it('does not write branch notes to a destination whose archive bundle failed', async () => {
    const persistCompanions = vi
      .fn()
      .mockImplementation(async (_bundle, _name, _source, outputs: string[]) =>
        outputs[0] === 'obsidian' ? ['canonical failed'] : []
      );
    const writeNote = vi.fn().mockResolvedValue('confirmed');

    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file', 'obsidian'],
      { persistCompanions, writeNote, measureNoteBytes }
    );

    expect(writeNote).toHaveBeenCalledTimes(3);
    expect(writeNote.mock.calls.every(call => call[1] === 'file')).toBe(true);
    expect(summary.allSuccessful).toBe(false);
    expect(summary.destinations).toMatchObject([
      { destination: 'file', archiveSaved: true, branchFilesSaved: 2, indexSaved: true },
      { destination: 'obsidian', archiveSaved: false, branchFilesSaved: 0, indexSaved: false },
    ]);
  });

  it('writes all-branches Markdown without rewriting companions already finalized per destination', async () => {
    const persistCompanions = vi.fn();
    const writeNote = vi.fn().mockResolvedValue('confirmed');

    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file'],
      { persistCompanions, writeNote, measureNoteBytes, archiveAlreadyPersisted: true }
    );

    expect(persistCompanions).not.toHaveBeenCalled();
    expect(writeNote).toHaveBeenCalledTimes(3);
    expect(summary.destinations).toMatchObject([
      { destination: 'file', archiveSaved: true, branchFilesSaved: 2, indexSaved: true },
    ]);
  });

  it('continues remaining leaves but withholds the index after one note write fails', async () => {
    const persistCompanions = vi.fn().mockResolvedValue([]);
    const writeNote = vi
      .fn()
      .mockResolvedValueOnce('failed')
      .mockResolvedValueOnce('confirmed')
      .mockResolvedValueOnce('confirmed');

    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file'],
      { persistCompanions, writeNote, measureNoteBytes }
    );

    expect(writeNote).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({
      allSuccessful: false,
      destinations: [
        { destination: 'file', archiveSaved: true, branchFilesSaved: 1, indexSaved: false },
      ],
    });
  });

  it('refuses all-branches presentation without a canonical companion', async () => {
    const partial: ArchiveCompanionBundle = {
      ...companion,
      artifacts: [companion.artifacts[0], companion.artifacts[1]],
    };

    await expect(
      persistAllBranchesPresentation(plan(), partial, templateOptions, false, ['file'], {
        persistCompanions: vi.fn(),
        writeNote: vi.fn(),
        measureNoteBytes,
      })
    ).rejects.toThrow('complete canonical archive companion');
  });

  it('exports eighty short sibling leaves without a branch-count ceiling', async () => {
    const persistCompanions = vi.fn().mockResolvedValue([]);
    const writeNote = vi.fn().mockResolvedValue('confirmed');
    const onProgress = vi.fn();

    const value = widePlan(80);
    const validate = vi.spyOn(archiveModule, 'validateLiskaThreadArchive');
    const prepare = vi.spyOn(branchBundle, 'prepareArchiveBranchPresentation');
    const defensiveLeaf = vi.spyOn(branchBundle, 'renderArchiveBranchLeaf');
    const defensiveIndex = vi.spyOn(branchBundle, 'renderArchiveBranchIndex');
    const summary = await persistAllBranchesPresentation(
      value,
      companion,
      templateOptions,
      false,
      ['file'],
      { persistCompanions, writeNote, measureNoteBytes, onProgress }
    );

    expect(summary).toMatchObject({ branchCount: 80, allSuccessful: true });
    expect(writeNote).toHaveBeenCalledTimes(81);
    expect(
      writeNote.mock.calls
        .slice(0, 80)
        .every(call => call[0].frontmatter.presentation_mode === 'all-branches-leaf')
    ).toBe(true);
    expect(writeNote.mock.calls[80][0].frontmatter.presentation_mode).toBe('all-branches-index');
    expect(onProgress).toHaveBeenLastCalledWith(80, 80);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(defensiveLeaf).not.toHaveBeenCalled();
    expect(defensiveIndex).not.toHaveBeenCalled();
  });

  it.each(['forged-count', 'forged-suffix', 'stale-current', 'mutated-role', 'invalid-graph'])(
    'rejects %s before companion persistence or presentation writes',
    async mutation => {
      const value = plan();
      if (mutation === 'forged-count') value.catalog.branches[1].messageCount = 999;
      if (mutation === 'forged-suffix') value.catalog.branches[1].uniqueNodeIds = ['node-user'];
      if (mutation === 'stale-current') value.archive.conversation.currentNodeId = 'node-alternate';
      if (mutation === 'mutated-role') {
        value.archive.graph.nodes['node-alternate'].message!.author.role = 'system';
      }
      if (mutation === 'invalid-graph') value.archive.graph.nodes['node-user'].childIds = [];
      const persistCompanions = vi.fn().mockResolvedValue([]);
      const writeNote = vi.fn().mockResolvedValue('confirmed');
      await expect(
        persistAllBranchesPresentation(value, companion, templateOptions, false, ['file'], {
          persistCompanions,
          writeNote,
          measureNoteBytes,
        })
      ).rejects.toThrow();
      expect(persistCompanions).not.toHaveBeenCalled();
      expect(writeNote).not.toHaveBeenCalled();
    }
  );

  it('does not retain or reuse a rendered sibling body while persisting later leaves', async () => {
    const persistCompanions = vi.fn().mockResolvedValue([]);
    const filenames: string[] = [];
    const writeNote = vi.fn().mockImplementation(async note => {
      filenames.push(note.fileName);
      // The destination owns this note after its write. Later leaves/index
      // must use private content-free facts, not read the prior rendered body.
      note.body = 'Destination discarded its body';
      return 'confirmed';
    });
    const summary = await persistAllBranchesPresentation(
      widePlan(80),
      companion,
      templateOptions,
      false,
      ['file'],
      { persistCompanions, writeNote, measureNoteBytes }
    );
    expect(summary.allSuccessful).toBe(true);
    expect(new Set(filenames).size).toBe(81);
  });

  it('rejects an over-wide graph before companions or presentation writes', async () => {
    const persistCompanions = vi.fn();
    const writeNote = vi.fn();
    const summary = await persistAllBranchesPresentation(
      widePlan(513),
      companion,
      templateOptions,
      false,
      ['file'],
      { persistCompanions, writeNote, measureNoteBytes }
    );
    expect(summary).toMatchObject({
      status: 'rejected',
      phase: 'structural-preflight',
      budgetKind: 'leaves',
      measuredLeaves: 0,
      renderedLeaves: 0,
    });
    expect(persistCompanions).not.toHaveBeenCalled();
    expect(writeNote).not.toHaveBeenCalled();
  });

  it('retains companion evidence but writes no presentation after exact dry measurement rejection', async () => {
    const persistCompanions = vi.fn().mockResolvedValue([]);
    const writeNote = vi.fn();
    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file'],
      {
        persistCompanions,
        writeNote,
        measureNoteBytes: () => 16 * 1024 ** 2 + 1,
      }
    );
    expect(summary).toMatchObject({
      status: 'rejected',
      phase: 'measurement',
      budgetKind: 'individual-note-bytes',
      measuredLeaves: 1,
      destinations: [{ archiveSaved: true, branchFilesSaved: 0, indexSaved: false }],
    });
    expect(persistCompanions).toHaveBeenCalledTimes(1);
    expect(writeNote).not.toHaveBeenCalled();
  });

  it('performs zero writes when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const persistCompanions = vi.fn();
    const writeNote = vi.fn();
    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file'],
      { persistCompanions, writeNote, measureNoteBytes, signal: controller.signal }
    );
    expect(summary).toMatchObject({ status: 'cancelled', cancelRequested: true });
    expect(persistCompanions).not.toHaveBeenCalled();
    expect(writeNote).not.toHaveBeenCalled();
  });

  it('stops during measurement and schedules no Markdown', async () => {
    const controller = new AbortController();
    let yields = 0;
    const persistCompanions = vi.fn().mockResolvedValue([]);
    const writeNote = vi.fn();
    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file'],
      {
        persistCompanions,
        writeNote,
        measureNoteBytes,
        signal: controller.signal,
        yieldTask: async () => {
          yields += 1;
          if (yields === 2) controller.abort();
        },
      }
    );
    expect(summary).toMatchObject({
      status: 'cancelled',
      phase: 'measurement',
      cancelRequested: true,
      measuredLeaves: 1,
    });
    expect(writeNote).not.toHaveBeenCalled();
  });

  it('counts a completed delayed write after Stop and starts nothing new', async () => {
    const controller = new AbortController();
    const writeNote = vi.fn().mockImplementation(async () => {
      controller.abort();
      await Promise.resolve();
      return 'confirmed';
    });
    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file'],
      {
        persistCompanions: vi.fn(),
        archiveAlreadyPersisted: true,
        writeNote,
        measureNoteBytes,
        signal: controller.signal,
      }
    );
    expect(writeNote).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({
      status: 'cancelled',
      cancelRequested: true,
      destinations: [{ branchFilesSaved: 1, branchWrites: { confirmed: 1 } }],
    });
  });

  it('never writes an index when stopped after the final leaf', async () => {
    const controller = new AbortController();
    const writeNote = vi.fn().mockImplementation(async note => {
      if (note.frontmatter.branch_ordinal === 2) controller.abort();
      return 'confirmed';
    });
    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['obsidian'],
      {
        persistCompanions: vi.fn(),
        archiveAlreadyPersisted: true,
        writeNote,
        measureNoteBytes,
        signal: controller.signal,
      }
    );
    expect(writeNote).toHaveBeenCalledTimes(2);
    expect(
      writeNote.mock.calls.some(
        call => call[0].frontmatter.presentation_mode === 'all-branches-index'
      )
    ).toBe(false);
    expect(summary).toMatchObject({ status: 'cancelled', destinations: [{ indexSaved: false }] });
  });

  it('does not relabel a completed export when Stop arrives during the final index write', async () => {
    const controller = new AbortController();
    const writeNote = vi.fn().mockImplementation(async note => {
      if (note.frontmatter.presentation_mode === 'all-branches-index') controller.abort();
      return 'confirmed';
    });
    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file'],
      {
        persistCompanions: vi.fn(),
        archiveAlreadyPersisted: true,
        writeNote,
        measureNoteBytes,
        signal: controller.signal,
      }
    );
    expect(writeNote).toHaveBeenCalledTimes(3);
    expect(summary).toMatchObject({
      status: 'complete',
      allSuccessful: true,
      cancelRequested: false,
      destinations: [{ indexSaved: true }],
    });
  });

  it('yields a real task so a timer can stop eighty immediate leaves', async () => {
    const controller = new AbortController();
    const writeNote = vi.fn();
    setTimeout(() => controller.abort(), 0);
    const summary = await persistAllBranchesPresentation(
      widePlan(80),
      companion,
      templateOptions,
      false,
      ['file'],
      {
        persistCompanions: vi.fn(),
        archiveAlreadyPersisted: true,
        writeNote,
        measureNoteBytes,
        signal: controller.signal,
      }
    );
    expect(summary.status).toBe('cancelled');
    expect(summary.measuredLeaves).toBeGreaterThan(0);
    expect(summary.measuredLeaves).toBeLessThan(80);
    expect(writeNote).not.toHaveBeenCalled();
  });

  it('blocks future unknown File writes while Obsidian completes and indexes', async () => {
    const writeNote = vi
      .fn()
      .mockImplementation(async (_note, destination) =>
        destination === 'file' ? 'unknown' : 'confirmed'
      );
    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file', 'obsidian'],
      {
        persistCompanions: vi.fn(),
        archiveAlreadyPersisted: true,
        writeNote,
        measureNoteBytes,
      }
    );
    expect(writeNote.mock.calls.filter(call => call[1] === 'file')).toHaveLength(1);
    expect(writeNote.mock.calls.filter(call => call[1] === 'obsidian')).toHaveLength(3);
    expect(summary).toMatchObject({
      status: 'partial',
      allSuccessful: false,
      destinations: [
        {
          destination: 'file',
          branchWrites: { confirmed: 0, failed: 0, unknown: 1 },
          indexSaved: false,
        },
        {
          destination: 'obsidian',
          branchFilesSaved: 2,
          indexSaved: true,
        },
      ],
    });
  });
});
