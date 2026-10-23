import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as archiveModule from '../../src/archive';
import * as branchBundle from '../../src/content/archive-branch-bundle';
import { getArchiveBranchCatalog, type LiskaThreadArchive } from '../../src/archive';
import {
  persistAllBranchesPresentation,
  prepareAllBranchesPersistence,
  type AllBranchesPersistenceDependencies,
} from '../../src/content/archive-branch-persistence';
import type { ChatGptDestinationArchiveReceipt } from '../../src/lib/chatgpt-archive-receipt';
import * as receiptBuilder from '../../src/content/chatgpt-destination-receipt';
import type {
  AllBranchesPresentationPlan,
  ArchiveCompanionBundle,
  TemplateOptions,
  PersistentOutputDestination,
  ObsidianNote,
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
const fingerprintNote = async (note: ObsidianNote) => {
  const text = JSON.stringify(note);
  return {
    byteLength: new TextEncoder().encode(text).byteLength,
    sha256: createHash('sha256').update(text).digest('hex'),
  };
};

function receipts(): ChatGptDestinationArchiveReceipt[] {
  return (['file', 'obsidian'] as const).map(destination => ({
    destination,
    captureId,
    conversationKey: companion.conversationKey,
    manifestSha256: companion.artifacts[1].sha256,
    archiveByteLengths: { raw: 2, manifest: 2, canonical: 2 },
    assets: [],
  }));
}

function persistSuccess() {
  return vi
    .fn()
    .mockImplementation(
      async (_bundle, _name, _source, outputs: PersistentOutputDestination[]) => ({
        activeOutputs: outputs,
        warnings: [],
      })
    );
}

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
    const persistArtifacts = persistSuccess();
    const writeNote = vi.fn().mockResolvedValue('confirmed');
    const onProgress = vi.fn();

    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file', 'obsidian', 'clipboard'],
      { persistArtifacts, writeNote, fingerprintNote, onProgress }
    );

    expect(persistArtifacts).toHaveBeenCalledTimes(2);
    expect(persistArtifacts.mock.calls.map(call => call[3])).toEqual([['file'], ['obsidian']]);
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
    const persistArtifacts = vi.fn();
    const writeNote = vi.fn();

    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['clipboard'],
      { persistArtifacts, writeNote, fingerprintNote }
    );

    expect(persistArtifacts).not.toHaveBeenCalled();
    expect(writeNote).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      branchCount: 2,
      clipboardSkipped: true,
      destinations: [],
      allSuccessful: false,
    });
  });

  it('does not write branch notes to a destination whose archive bundle failed', async () => {
    const persistArtifacts = vi
      .fn()
      .mockImplementation(async (_bundle, _name, _source, outputs: string[]) => ({
        activeOutputs: outputs[0] === 'obsidian' ? [] : outputs,
        warnings: [],
      }));
    const writeNote = vi.fn().mockResolvedValue('confirmed');

    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file', 'obsidian'],
      { persistArtifacts, writeNote, fingerprintNote }
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
    const persistArtifacts = vi.fn();
    const writeNote = vi.fn().mockResolvedValue('confirmed');

    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file'],
      { persistArtifacts, writeNote, fingerprintNote, destinationReceipts: receipts() }
    );

    expect(persistArtifacts).not.toHaveBeenCalled();
    expect(writeNote).toHaveBeenCalledTimes(3);
    expect(summary.destinations).toMatchObject([
      { destination: 'file', archiveSaved: true, branchFilesSaved: 2, indexSaved: true },
    ]);
  });

  it('continues remaining leaves but withholds the index after one note write fails', async () => {
    const persistArtifacts = persistSuccess();
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
      { persistArtifacts, writeNote, fingerprintNote }
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
        persistArtifacts: vi.fn(),
        writeNote: vi.fn(),
        fingerprintNote,
      })
    ).rejects.toThrow('complete canonical archive companion');
  });

  it('exports eighty short sibling leaves without a branch-count ceiling', async () => {
    const persistArtifacts = persistSuccess();
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
      { persistArtifacts, writeNote, fingerprintNote, onProgress }
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
      const persistArtifacts = persistSuccess();
      const writeNote = vi.fn().mockResolvedValue('confirmed');
      await expect(
        persistAllBranchesPresentation(value, companion, templateOptions, false, ['file'], {
          persistArtifacts,
          writeNote,
          fingerprintNote,
        })
      ).rejects.toThrow();
      expect(persistArtifacts).not.toHaveBeenCalled();
      expect(writeNote).not.toHaveBeenCalled();
    }
  );

  it('does not retain or reuse a rendered sibling body while persisting later leaves', async () => {
    const persistArtifacts = persistSuccess();
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
      { persistArtifacts, writeNote, fingerprintNote }
    );
    expect(summary.allSuccessful).toBe(true);
    expect(new Set(filenames).size).toBe(81);
  });

  it('rejects an over-wide graph before companions or presentation writes', async () => {
    const persistArtifacts = vi.fn();
    const writeNote = vi.fn();
    const summary = await persistAllBranchesPresentation(
      widePlan(513),
      companion,
      templateOptions,
      false,
      ['file'],
      { persistArtifacts, writeNote, fingerprintNote }
    );
    expect(summary).toMatchObject({
      status: 'rejected',
      phase: 'structural-preflight',
      budgetKind: 'leaves',
      measuredLeaves: 0,
      renderedLeaves: 0,
    });
    expect(persistArtifacts).not.toHaveBeenCalled();
    expect(writeNote).not.toHaveBeenCalled();
  });

  it('retains companion evidence but writes no presentation after exact dry measurement rejection', async () => {
    const persistArtifacts = persistSuccess();
    const writeNote = vi.fn();
    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file'],
      {
        persistArtifacts,
        writeNote,
        fingerprintNote: async () => ({ byteLength: 16 * 1024 ** 2 + 1, sha256: 'f'.repeat(64) }),
      }
    );
    expect(summary).toMatchObject({
      status: 'rejected',
      phase: 'measurement',
      budgetKind: 'individual-note-bytes',
      measuredLeaves: 1,
      destinations: [{ archiveSaved: true, branchFilesSaved: 0, indexSaved: false }],
    });
    expect(persistArtifacts).toHaveBeenCalledTimes(1);
    expect(writeNote).not.toHaveBeenCalled();
  });

  it('performs zero writes when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const persistArtifacts = vi.fn();
    const writeNote = vi.fn();
    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file'],
      { persistArtifacts, writeNote, fingerprintNote, signal: controller.signal }
    );
    expect(summary).toMatchObject({ status: 'cancelled', cancelRequested: true });
    expect(persistArtifacts).not.toHaveBeenCalled();
    expect(writeNote).not.toHaveBeenCalled();
  });

  it('stops during measurement and schedules no Markdown', async () => {
    const controller = new AbortController();
    let yields = 0;
    const persistArtifacts = persistSuccess();
    const writeNote = vi.fn();
    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file'],
      {
        persistArtifacts,
        writeNote,
        fingerprintNote,
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
        persistArtifacts: vi.fn(),
        destinationReceipts: receipts(),
        writeNote,
        fingerprintNote,
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
        persistArtifacts: vi.fn(),
        destinationReceipts: receipts(),
        writeNote,
        fingerprintNote,
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
        persistArtifacts: vi.fn(),
        destinationReceipts: receipts(),
        writeNote,
        fingerprintNote,
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
        persistArtifacts: vi.fn(),
        destinationReceipts: receipts(),
        writeNote,
        fingerprintNote,
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
        persistArtifacts: vi.fn(),
        destinationReceipts: receipts(),
        writeNote,
        fingerprintNote,
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

describe('all-branches destination receipts and exact parity', () => {
  const outputs = ['file', 'obsidian'] as const;

  function run(dependencies: Partial<AllBranchesPersistenceDependencies> = {}) {
    return persistAllBranchesPresentation(plan(), companion, templateOptions, false, [...outputs], {
      persistArtifacts: persistSuccess(),
      writeNote: vi.fn().mockResolvedValue('confirmed'),
      fingerprintNote,
      destinationReceipts: receipts(),
      yieldTask: async () => {},
      ...dependencies,
    });
  }

  function distinctReceipts(): ChatGptDestinationArchiveReceipt[] {
    return receipts().map((receipt, index) => {
      const hash = (index === 0 ? 'e' : 'f').repeat(64);
      return {
        ...receipt,
        manifestSha256: (index === 0 ? '1' : '2').repeat(64),
        archiveByteLengths: { raw: 2, manifest: 20 + index, canonical: 30 + index },
        assets: [
          {
            sha256: hash,
            relativePath: `assets/${hash}.pdf`,
            mediaType: 'application/pdf',
            byteLength: index + 1,
          },
        ],
      };
    });
  }

  it('withholds every note for an explicitly empty finalized receipt set', async () => {
    const persistArtifacts = vi.fn();
    const writeNote = vi.fn();
    const summary = await run({ destinationReceipts: [], persistArtifacts, writeNote });
    expect(summary).toMatchObject({ status: 'failed', phase: 'archive' });
    expect(summary.destinations.every(destination => !destination.archiveSaved)).toBe(true);
    expect(persistArtifacts).not.toHaveBeenCalled();
    expect(writeNote).not.toHaveBeenCalled();
  });

  it('counts destination-finalized trios and binaries once per destination across many branches', async () => {
    const destinationReceipts = distinctReceipts();
    // Both destinations retain identical binary bytes at the same archive path.
    destinationReceipts[1].assets = structuredClone(destinationReceipts[0].assets);
    const writeNote = vi.fn().mockResolvedValue('confirmed');
    const summary = await persistAllBranchesPresentation(
      widePlan(80),
      companion,
      templateOptions,
      false,
      [...outputs],
      {
        persistArtifacts: vi.fn(),
        destinationReceipts,
        writeNote,
        fingerprintNote: async () => ({ byteLength: 10, sha256: '0'.repeat(64) }),
        yieldTask: async () => {},
      }
    );
    // File seed: 2+20+30+1=53; Obsidian seed: 2+21+31+1=55.
    expect(summary).toMatchObject({
      status: 'complete',
      plannedPhysicalBytes: 53 + 55 + 81 * 10 * 2,
      destinations: [
        { dispatchedBytes: 53 + 810, confirmedBytes: 53 + 810 },
        { dispatchedBytes: 55 + 810, confirmedBytes: 55 + 810 },
      ],
    });
    expect(writeNote).toHaveBeenCalledTimes(162);
  });

  it.each([0, 1])(
    'checks an initial retained-byte seed at physical cap + %i before fingerprints',
    async extra => {
      const cap = 2 * 1024 ** 3;
      const destinationReceipts = receipts();
      destinationReceipts[0].archiveByteLengths.canonical = cap - 4 + extra;
      const writeNote = vi.fn().mockResolvedValue('confirmed');
      const fingerprint = vi.fn().mockResolvedValue({ byteLength: 0, sha256: '0'.repeat(64) });
      const summary = await persistAllBranchesPresentation(
        plan(),
        companion,
        templateOptions,
        false,
        ['file'],
        {
          persistArtifacts: vi.fn(),
          destinationReceipts,
          writeNote,
          fingerprintNote: fingerprint,
          yieldTask: async () => {},
        }
      );
      expect(summary.plannedPhysicalBytes).toBe(cap + extra);
      expect(summary.destinations[0]).toMatchObject({
        archiveSaved: true,
        dispatchedBytes: cap + extra,
        confirmedBytes: cap + extra,
      });
      if (extra === 0) {
        expect(summary.status).toBe('complete');
        expect(fingerprint).toHaveBeenCalledTimes(6);
        expect(writeNote).toHaveBeenCalledTimes(3);
      } else {
        expect(summary).toMatchObject({
          status: 'rejected',
          phase: 'measurement',
          budgetKind: 'physical-planned-bytes',
          measuredLeaves: 0,
          renderedLeaves: 0,
        });
        expect(fingerprint).not.toHaveBeenCalled();
        expect(writeNote).not.toHaveBeenCalled();
      }
    }
  );

  it('returns a physical-budget rejection when safe destination totals overflow in aggregate', async () => {
    const destinationReceipts = distinctReceipts().map(receipt => ({
      ...receipt,
      archiveByteLengths: {
        raw: 2,
        manifest: 0,
        canonical: Number.MAX_SAFE_INTEGER - 2,
      },
      assets: [],
    }));
    const fingerprint = vi.fn();
    const writeNote = vi.fn();
    const summary = await run({ destinationReceipts, fingerprintNote: fingerprint, writeNote });
    expect(summary).toMatchObject({
      status: 'rejected',
      phase: 'measurement',
      budgetKind: 'physical-planned-bytes',
      plannedPhysicalBytes: 2 * 1024 ** 3 + 1,
      measuredLeaves: 0,
      renderedLeaves: 0,
    });
    expect(fingerprint).not.toHaveBeenCalled();
    expect(writeNote).not.toHaveBeenCalled();
  });

  it('retains only confirmed archive seeds if Stop arrives before measurement', async () => {
    const controller = new AbortController();
    const fingerprint = vi.fn();
    const writeNote = vi.fn();
    const summary = await run({
      destinationReceipts: undefined,
      signal: controller.signal,
      persistArtifacts: vi.fn(async (_bundle, _name, _source, outputs) => {
        controller.abort();
        return { activeOutputs: outputs as PersistentOutputDestination[], warnings: [] };
      }),
      fingerprintNote: fingerprint,
      writeNote,
    });
    expect(summary).toMatchObject({
      status: 'cancelled',
      phase: 'archive',
      plannedPhysicalBytes: 6,
      destinations: [
        { archiveSaved: true, dispatchedBytes: 6, confirmedBytes: 6 },
        { archiveSaved: false, dispatchedBytes: 0, confirmedBytes: 0 },
      ],
    });
    expect(fingerprint).not.toHaveBeenCalled();
    expect(writeNote).not.toHaveBeenCalled();
  });

  it('also binds canonical-only stubs without asserting branch asset membership', async () => {
    const value = plan();
    value.archive.graph.nodes['node-user'].message!.author.role = 'system';
    const alternate = value.archive.graph.nodes['node-alternate'].message!;
    alternate.author.role = 'tool';
    alternate.blocks = [
      {
        id: 'tool-only',
        type: 'tool_result',
        toolName: 'synthetic',
        result: { hidden: true },
        sourceRefs: alternate.sourceRefs,
        extensions: {},
      },
    ];
    value.catalog = getArchiveBranchCatalog(value.archive);
    const writeNote = vi.fn().mockResolvedValue('confirmed');
    const summary = await persistAllBranchesPresentation(
      value,
      companion,
      templateOptions,
      false,
      ['file'],
      {
        persistArtifacts: vi.fn(),
        destinationReceipts: distinctReceipts(),
        fingerprintNote,
        writeNote,
        yieldTask: async () => {},
      }
    );
    expect(summary.canonicalOnlyCount).toBe(1);
    const stub = writeNote.mock.calls.find(
      call => call[0].frontmatter.branch_ordinal === 2
    )![0] as ObsidianNote;
    expect(stub.frontmatter.message_count).toBe(0);
    expect(stub.frontmatter.archive_manifest_sha256).toBe('1'.repeat(64));
    expect(stub.body).toContain('Its canonical archive record remains available');
    expect(stub.body).toContain('Capture-level files; branch membership is not asserted.');
    expect(stub.body).toContain(distinctReceipts()[0].assets[0].relativePath);
  });

  it('binds every leaf and index to its destination manifest and capture-level asset links', async () => {
    const destinationReceipts = distinctReceipts();
    const writeNote = vi.fn().mockResolvedValue('confirmed');
    const fingerprint = vi.fn(fingerprintNote);
    const summary = await run({ destinationReceipts, writeNote, fingerprintNote: fingerprint });
    expect(summary.allSuccessful).toBe(true);
    expect(writeNote).toHaveBeenCalledTimes(6);
    expect(fingerprint).toHaveBeenCalledTimes(12);
    for (const receipt of destinationReceipts) {
      const notes = writeNote.mock.calls
        .filter(call => call[1] === receipt.destination)
        .map(call => call[0] as ObsidianNote);
      expect(notes).toHaveLength(3);
      for (const note of notes) {
        expect(note.frontmatter.archive_manifest_sha256).toBe(receipt.manifestSha256);
        expect(note.frontmatter.archive_capture_id).toBe(captureId);
        expect(note.body).toContain(
          `_liska-archive/${receipt.conversationKey}/${captureId}/${receipt.assets[0].relativePath}`
        );
        expect(note.body).not.toContain(
          receipt.destination === 'file' ? 'f'.repeat(64) : 'e'.repeat(64)
        );
        expect(note.fileName).toContain(captureId.slice(-36));
        expect(note.fileName).not.toContain('--capture-');
      }
      const index = notes[2];
      for (const leaf of notes.slice(0, 2)) {
        expect(index.body).toContain(`](${leaf.fileName})`);
      }
    }
    expect(JSON.stringify(summary)).not.toContain(destinationReceipts[0].manifestSha256);
    expect(JSON.stringify(summary)).not.toContain(destinationReceipts[0].assets[0].relativePath);
  });

  it.each([
    'missing',
    'duplicate',
    'malformed',
    'wrong-destination',
    'wrong-capture',
    'wrong-conversation',
    'raw-length-mismatch',
    'invalid-archive-lengths',
    'overflowing-retained-bytes',
    'nested-accessor',
    'accessor',
  ])(
    'withholds only File for a %s receipt and never falls back to unbound Markdown',
    async mutation => {
      const input: unknown[] = distinctReceipts();
      const file = input[0] as ChatGptDestinationArchiveReceipt;
      if (mutation === 'missing') input.shift();
      if (mutation === 'duplicate') input.push({ ...file, manifestSha256: 'invalid' });
      if (mutation === 'malformed') file.manifestSha256 = 'invalid';
      if (mutation === 'wrong-destination') input[0] = { ...file, destination: 'clipboard' };
      if (mutation === 'wrong-capture') file.captureId += '-other';
      if (mutation === 'wrong-conversation') file.conversationKey = '0'.repeat(64);
      if (mutation === 'raw-length-mismatch') file.archiveByteLengths.raw += 1;
      if (mutation === 'invalid-archive-lengths') file.archiveByteLengths.canonical = -1;
      if (mutation === 'overflowing-retained-bytes') {
        file.archiveByteLengths.canonical = Number.MAX_SAFE_INTEGER;
      }
      const getter = vi.fn(() => []);
      if (mutation === 'accessor') Object.defineProperty(file, 'assets', { get: getter });
      if (mutation === 'nested-accessor') {
        Object.defineProperty(file.archiveByteLengths, 'manifest', { get: getter });
      }
      const persistArtifacts = vi.fn();
      const writeNote = vi.fn().mockResolvedValue('confirmed');
      const summary = await run({ destinationReceipts: input, persistArtifacts, writeNote });
      expect(persistArtifacts).not.toHaveBeenCalled();
      expect(writeNote).toHaveBeenCalledTimes(3);
      expect(writeNote.mock.calls.every(call => call[1] === 'obsidian')).toBe(true);
      expect(summary.destinations[0]).toMatchObject({
        archiveSaved: false,
        branchFilesSaved: 0,
        indexSaved: false,
        dispatchedBytes: 0,
        confirmedBytes: 0,
      });
      expect(summary.destinations[1].indexSaved).toBe(true);
      expect(getter).not.toHaveBeenCalled();
    }
  );

  it('snapshots receipt objects and arrays before caller mutation can change either pass', async () => {
    const destinationReceipts = distinctReceipts();
    const before = structuredClone(destinationReceipts);
    const writeNote = vi.fn().mockResolvedValue('confirmed');
    const pending = run({ destinationReceipts, writeNote });
    destinationReceipts[0].manifestSha256 = '9'.repeat(64);
    destinationReceipts[0].archiveByteLengths.manifest = 999;
    destinationReceipts[0].assets[0].relativePath = 'mutated';
    destinationReceipts[1].assets.length = 0;
    destinationReceipts.push(destinationReceipts[0]);
    const summary = await pending;
    expect(summary.allSuccessful).toBe(true);
    for (const [note, destination] of writeNote.mock.calls) {
      const receipt = before.find(receipt => receipt.destination === destination)!;
      expect(note.frontmatter.archive_manifest_sha256).toBe(receipt.manifestSha256);
      expect(note.body).toContain(receipt.assets[0].relativePath);
      expect(note.body).not.toContain('mutated');
    }
  });

  it.each(['indexed-accessor', 'custom-filter', 'hole', 'abnormal-prototype'])(
    'rejects a hostile outer receipt array without invoking it: %s',
    async mutation => {
      const input: unknown[] = distinctReceipts();
      const getter = vi.fn(() => input[0]);
      if (mutation === 'indexed-accessor') {
        Object.defineProperty(input, '0', { enumerable: true, get: getter });
      }
      if (mutation === 'custom-filter') {
        Object.defineProperty(input, 'filter', {
          enumerable: true,
          value: vi.fn(() => [input[1]]),
        });
      }
      if (mutation === 'hole') delete input[0];
      if (mutation === 'abnormal-prototype') Object.setPrototypeOf(input, null);
      const persistArtifacts = vi.fn();
      const writeNote = vi.fn();
      const summary = await run({ destinationReceipts: input, persistArtifacts, writeNote });
      expect(summary).toMatchObject({ status: 'failed', phase: 'archive' });
      expect(summary.destinations.every(destination => !destination.archiveSaved)).toBe(true);
      expect(persistArtifacts).not.toHaveBeenCalled();
      expect(writeNote).not.toHaveBeenCalled();
      expect(getter).not.toHaveBeenCalled();
    }
  );

  it('builds empty-assets receipts only after each original full trio is confirmed active', async () => {
    const build = vi.spyOn(receiptBuilder, 'buildChatGptDestinationArchiveReceipt');
    const persistArtifacts = vi
      .fn()
      .mockImplementation(async (bundle, _name, _source, destinations) => {
        expect(bundle.artifacts.map((artifact: { kind: string }) => artifact.kind)).toEqual([
          'raw',
          'manifest',
          'canonical',
        ]);
        expect(build).toHaveBeenCalledTimes(destinations[0] === 'file' ? 0 : 1);
        return { activeOutputs: destinations[0] === 'file' ? destinations : [], warnings: [] };
      });
    const writeNote = vi.fn().mockResolvedValue('confirmed');
    const summary = await run({ destinationReceipts: undefined, persistArtifacts, writeNote });
    expect(build).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ captureId }), 'file', []);
    expect(writeNote).toHaveBeenCalledTimes(3);
    for (const [note, destination] of writeNote.mock.calls) {
      expect(destination).toBe('file');
      expect(note.frontmatter.archive_manifest_sha256).toBe(companion.artifacts[1].sha256);
      expect(note.body).not.toContain('## Local archive attachments');
    }
    expect(summary.destinations[1].archiveSaved).toBe(false);
  });

  it('retains archive evidence but writes no Markdown when provenance pushes the exact pass over cap', async () => {
    const value = plan();
    const prepared = prepareAllBranchesPersistence(value, companion, templateOptions, false, [
      ...outputs,
    ]);
    const originalRender = prepared.session.renderLeaf;
    const cap = 16 * 1024 ** 2;
    const session = {
      ...prepared.session,
      renderLeaf(ordinal: number) {
        const leaf = originalRender(ordinal);
        leaf.note.body = '';
        leaf.note.body = 'x'.repeat(
          cap - new TextEncoder().encode(JSON.stringify(leaf.note)).byteLength - 1
        );
        expect(new TextEncoder().encode(JSON.stringify(leaf.note)).byteLength).toBe(cap - 1);
        return leaf;
      },
    };
    const writeNote = vi.fn();
    const summary = await run({
      prepared: { ...prepared, session },
      destinationReceipts: undefined,
      writeNote,
    });
    expect(summary).toMatchObject({
      status: 'rejected',
      phase: 'measurement',
      budgetKind: 'individual-note-bytes',
    });
    expect(summary.destinations.every(destination => destination.archiveSaved)).toBe(true);
    expect(writeNote).not.toHaveBeenCalled();
  });

  it.each(['content', 'receipt', 'filename'])(
    'stops File before dispatch on same-length %s drift while Obsidian completes',
    async mutation => {
      const destinationReceipts = distinctReceipts();
      const counts = new Map<string, number>();
      const writeNote = vi.fn().mockResolvedValue('confirmed');
      const fingerprint = vi.fn().mockImplementation(async (note: ObsidianNote, destination) => {
        const key = `${destination}:${note.frontmatter.presentation_mode}:${note.frontmatter.branch_ordinal}`;
        const seen = (counts.get(key) ?? 0) + 1;
        counts.set(key, seen);
        if (destination === 'file' && seen === 2 && note.frontmatter.branch_ordinal === 1) {
          if (mutation === 'content') note.body = `X${note.body.slice(1)}`;
          if (mutation === 'receipt') note.frontmatter.archive_manifest_sha256 = '3'.repeat(64);
          if (mutation === 'filename') note.fileName = `X${note.fileName.slice(1)}`;
        }
        return fingerprintNote(note);
      });
      const summary = await run({ destinationReceipts, writeNote, fingerprintNote: fingerprint });
      expect(writeNote.mock.calls.map(call => call[1])).toEqual([
        'obsidian',
        'obsidian',
        'obsidian',
      ]);
      expect(summary.destinations[0]).toMatchObject({
        archiveSaved: true,
        branchWrites: { failed: 1 },
        indexSaved: false,
        dispatchedBytes: 53,
        confirmedBytes: 53,
      });
      expect(summary.destinations[1].indexSaved).toBe(true);
    }
  );

  it('withholds only the drifting index with no dispatched byte claim', async () => {
    const counts = new Map<string, number>();
    const writeNote = vi.fn().mockResolvedValue('confirmed');
    const summary = await run({
      writeNote,
      fingerprintNote: async (note, destination) => {
        const count = (counts.get(destination) ?? 0) + 1;
        counts.set(destination, count);
        const result = await fingerprintNote(note);
        if (destination === 'file' && count === 6) result.sha256 = '0'.repeat(64);
        return result;
      },
    });
    expect(writeNote).toHaveBeenCalledTimes(5);
    expect(summary.destinations[0]).toMatchObject({
      branchFilesSaved: 2,
      indexState: 'failed',
      indexSaved: false,
    });
    expect(summary.destinations[1].indexSaved).toBe(true);
    const fileLeaves = writeNote.mock.calls.filter(call => call[1] === 'file');
    const bytes = await Promise.all(fileLeaves.map(call => fingerprintNote(call[0])));
    expect(summary.destinations[0].dispatchedBytes).toBe(
      6 + bytes.reduce((sum, value) => sum + value.byteLength, 0)
    );
  });

  it('honors Stop while the fingerprint is in flight and dispatches no Markdown', async () => {
    const controller = new AbortController();
    let count = 0;
    const writeNote = vi.fn();
    const summary = await run({
      signal: controller.signal,
      writeNote,
      fingerprintNote: async note => {
        count += 1;
        if (count === 7) controller.abort();
        return fingerprintNote(note);
      },
    });
    expect(summary.status).toBe('cancelled');
    expect(writeNote).not.toHaveBeenCalled();
  });
});
