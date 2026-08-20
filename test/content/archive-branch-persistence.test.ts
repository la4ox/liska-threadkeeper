import { describe, expect, it, vi } from 'vitest';
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

describe('all-branches sequential persistence', () => {
  it('writes companions once per durable destination, then every leaf and one index', async () => {
    const persistCompanions = vi.fn().mockResolvedValue([]);
    const writeNote = vi.fn().mockResolvedValue(true);
    const onProgress = vi.fn();

    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file', 'obsidian', 'clipboard'],
      { persistCompanions, writeNote, onProgress }
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
      { persistCompanions, writeNote }
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
    const writeNote = vi.fn().mockResolvedValue(true);

    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file', 'obsidian'],
      { persistCompanions, writeNote }
    );

    expect(writeNote).toHaveBeenCalledTimes(3);
    expect(writeNote.mock.calls.every(call => call[1] === 'file')).toBe(true);
    expect(summary.allSuccessful).toBe(false);
    expect(summary.destinations).toEqual([
      { destination: 'file', archiveSaved: true, branchFilesSaved: 2, indexSaved: true },
      { destination: 'obsidian', archiveSaved: false, branchFilesSaved: 0, indexSaved: false },
    ]);
  });

  it('continues remaining leaves but withholds the index after one note write fails', async () => {
    const persistCompanions = vi.fn().mockResolvedValue([]);
    const writeNote = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    const summary = await persistAllBranchesPresentation(
      plan(),
      companion,
      templateOptions,
      false,
      ['file'],
      { persistCompanions, writeNote }
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
      })
    ).rejects.toThrow('complete canonical archive companion');
  });

  it('exports eighty short sibling leaves without a branch-count ceiling', async () => {
    const persistCompanions = vi.fn().mockResolvedValue([]);
    const writeNote = vi.fn().mockResolvedValue(true);
    const onProgress = vi.fn();

    const summary = await persistAllBranchesPresentation(
      widePlan(80),
      companion,
      templateOptions,
      false,
      ['file'],
      { persistCompanions, writeNote, onProgress }
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
  });
});
