import { describe, expect, it } from 'vitest';
import { getArchiveBranchCatalog, type LiskaThreadArchive } from '../../src/archive';
import {
  renderArchiveBranchIndex,
  renderArchiveBranchLeaf,
  type ArchiveBranchIndexEntry,
  type ArchiveBranchLeafRender,
} from '../../src/content/archive-branch-bundle';
import { generateNoteContent } from '../../src/lib/note-generator';
import type { ExtensionSettings, TemplateOptions } from '../../src/lib/types';
import branchingFixture from '../fixtures/archive/branching-chatgpt-thread.json';

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

const captureId = 'capture-chatgpt-01234567-89ab-4cde-8f01-23456789abcd';

const settings = {
  templateOptions,
} as ExtensionSettings;

function archive(): LiskaThreadArchive {
  return JSON.parse(JSON.stringify(branchingFixture)) as LiskaThreadArchive;
}

function indexEntry(render: ArchiveBranchLeafRender): ArchiveBranchIndexEntry {
  return {
    ordinal: render.ordinal,
    fileName: render.note.fileName,
    canonicalMessageCount: render.canonicalMessageCount,
    renderedMessageCount: render.renderedMessageCount,
    uniqueMessageCount: render.uniqueMessageCount,
    isCurrent: render.isCurrent,
    status: render.status,
  };
}

function renderedLeaves(value: LiskaThreadArchive): {
  catalog: ReturnType<typeof getArchiveBranchCatalog>;
  renders: ArchiveBranchLeafRender[];
} {
  const catalog = getArchiveBranchCatalog(value);
  return {
    catalog,
    renders: catalog.branches.map(branch =>
      renderArchiveBranchLeaf(value, catalog, branch, templateOptions, captureId)
    ),
  };
}

describe('all-branches archive presentation renderer', () => {
  it('renders the current and alternate leaves separately with complete capture provenance', () => {
    const value = archive();
    const { renders } = renderedLeaves(value);

    expect(renders).toHaveLength(2);
    expect(renders[0]).toMatchObject({
      ordinal: 1,
      canonicalMessageCount: 2,
      renderedMessageCount: 2,
      uniqueMessageCount: 1,
      isCurrent: true,
      status: 'rendered',
    });
    expect(renders[0].note).toMatchObject({
      frontmatter: {
        id: 'chatgpt_01234567-89ab-4cde-8f01-23456789abcd',
        title: 'Synthetic branch fixture — Branch 1 (current)',
        capture_mode: 'structured-api',
        capture_completeness: 'complete',
        presentation_mode: 'all-branches-leaf',
        branch_ordinal: 1,
        branch_count: 2,
        archive_capture_id: captureId,
      },
    });
    expect(renders[0].note.body).toContain('Current answer starts here.');
    expect(renders[0].note.body).not.toContain('Alternate **answer** remains a separate leaf.');
    expect(renders[1].note.body).toContain('Alternate **answer** remains a separate leaf.');
    expect(renders[1].note.body).not.toContain('Current answer starts here.');
  });

  it('honors the tool-content setting for each lazily rendered leaf', () => {
    const value = archive();
    const catalog = getArchiveBranchCatalog(value);

    const result = renderArchiveBranchLeaf(
      value,
      catalog,
      catalog.branches[0],
      templateOptions,
      captureId,
      true
    );

    expect(result.note.body).toContain('Reasoning');
    expect(result.note.body).toContain('Tool call: synthetic_search');
  });

  it('retains a canonical-only leaf as an explicit local stub', () => {
    const value = archive();
    value.graph.nodes['node-user'].message!.author.role = 'system';
    const alternate = value.graph.nodes['node-alternate'].message!;
    alternate.author.role = 'tool';
    alternate.blocks = [
      {
        id: 'synthetic-tool-only',
        type: 'tool_result',
        toolName: 'synthetic',
        result: { hidden: true },
        sourceRefs: alternate.sourceRefs,
        extensions: {},
      },
    ];
    const catalog = getArchiveBranchCatalog(value);
    const branch = catalog.branches.find(candidate => candidate.ordinal === 2)!;

    const result = renderArchiveBranchLeaf(value, catalog, branch, templateOptions, captureId);

    expect(result).toMatchObject({
      ordinal: 2,
      canonicalMessageCount: 2,
      renderedMessageCount: 0,
      uniqueMessageCount: 1,
      status: 'canonical-only',
    });
    expect(result.warnings).toEqual([
      'Branch 2 has no legacy-renderable user or assistant content; a canonical-only Markdown stub was created.',
    ]);
    expect(result.note.frontmatter.message_count).toBe(0);
    expect(result.note.body).toContain('no user or assistant content');
    expect(result.note.body).not.toContain('node-alternate');
  });

  it('writes a deterministic, content-free index with safe links and a current badge', () => {
    const value = archive();
    const { catalog, renders } = renderedLeaves(value);
    const note = renderArchiveBranchIndex(
      value,
      catalog,
      renders.map(indexEntry),
      templateOptions,
      captureId
    );

    expect(note.fileName).toContain('--branches--');
    expect(note.frontmatter).toMatchObject({
      title: 'Synthetic branch fixture — All branches',
      capture_mode: 'structured-api',
      capture_completeness: 'complete',
      presentation_mode: 'all-branches-index',
      branch_count: 2,
      branch_point_count: 1,
    });
    expect(note.body).toContain('[Branch 1 — current](' + renders[0].note.fileName + ')');
    expect(note.body).toContain('[Branch 2](' + renders[1].note.fileName + ')');
    expect(note.body.indexOf('[Branch 1')).toBeLessThan(note.body.indexOf('[Branch 2]'));
    expect(note.body).toContain('2 canonical, 2 rendered, 1 unique message');
    expect(note.body).not.toContain('node-current');
    expect(note.body).not.toContain('/mapping/');
    expect(note.body).not.toContain('Current answer starts here.');
    expect(note.body).not.toContain('Alternate **answer** remains a separate leaf.');
    const serialized = generateNoteContent(note, settings);
    expect(serialized).not.toContain(value.conversation.id);
    expect(serialized).not.toContain(value.conversation.url);
    expect(serialized).toContain('url: "https://chatgpt.com"');
    for (const render of renders) {
      expect(render.note.fileName).not.toContain(value.conversation.id);
      expect(note.body).not.toContain(value.conversation.id);
    }
  });

  it('uses distinct capture-scoped filenames for otherwise identical leaves', () => {
    const value = archive();
    const catalog = getArchiveBranchCatalog(value);
    const branch = catalog.branches[0];

    const first = renderArchiveBranchLeaf(value, catalog, branch, templateOptions, captureId);
    const second = renderArchiveBranchLeaf(
      value,
      catalog,
      branch,
      templateOptions,
      'capture-chatgpt-fedcba98-7654-4321-8fed-cba987654321'
    );

    expect(first.note.fileName).not.toBe(second.note.fileName);
    expect(first.note.fileName).toContain('--branch-001--');
    expect(second.note.fileName).toContain('--branch-001--');
  });

  it('fails closed for invalid, missing, duplicate, or non-deterministic index entries', () => {
    const value = archive();
    const { catalog, renders } = renderedLeaves(value);
    const entries = renders.map(indexEntry);

    expect(() =>
      renderArchiveBranchIndex(
        value,
        catalog,
        [{ ...entries[0], fileName: '../outside.md' }, entries[1]],
        templateOptions,
        captureId
      )
    ).toThrow('unsafe leaf filename');
    expect(() =>
      renderArchiveBranchIndex(value, catalog, [entries[0]], templateOptions, captureId)
    ).toThrow('cover every catalog leaf exactly once');
    expect(() =>
      renderArchiveBranchIndex(
        value,
        catalog,
        [entries[0], { ...entries[0], ordinal: 1 }],
        templateOptions,
        captureId
      )
    ).toThrow('deterministic catalog ordinal order');
    expect(() =>
      renderArchiveBranchIndex(value, catalog, [entries[1], entries[0]], templateOptions, captureId)
    ).toThrow('deterministic catalog ordinal order');
  });

  it('fails closed when capture, catalog, projection, or index provenance drifts', () => {
    const value = archive();
    const { catalog, renders } = renderedLeaves(value);
    const entries = renders.map(indexEntry);

    expect(() =>
      renderArchiveBranchLeaf(value, catalog, catalog.branches[0], templateOptions, '../capture')
    ).toThrow('Invalid archive presentation capture ID');

    const emptyCatalog = { ...catalog, branches: [] };
    expect(() =>
      renderArchiveBranchLeaf(value, emptyCatalog, catalog.branches[0], templateOptions, captureId)
    ).toThrow('must contain at least one leaf');

    const unorderedCatalog = JSON.parse(JSON.stringify(catalog)) as typeof catalog;
    unorderedCatalog.branches[0].ordinal = 7;
    expect(() =>
      renderArchiveBranchLeaf(
        value,
        unorderedCatalog,
        unorderedCatalog.branches[0],
        templateOptions,
        captureId
      )
    ).toThrow('ordinals must be contiguous');

    const duplicateSuffix = JSON.parse(JSON.stringify(catalog)) as typeof catalog;
    duplicateSuffix.branches[0].uniqueNodeIds = ['node-current', 'node-current'];
    expect(() =>
      renderArchiveBranchLeaf(
        value,
        duplicateSuffix,
        duplicateSuffix.branches[0],
        templateOptions,
        captureId
      )
    ).toThrow('invalid unique branch suffix');

    const wrongCounts = JSON.parse(JSON.stringify(catalog)) as typeof catalog;
    wrongCounts.branches[0].messageCount = 999;
    expect(() =>
      renderArchiveBranchLeaf(
        value,
        wrongCounts,
        wrongCounts.branches[0],
        templateOptions,
        captureId
      )
    ).toThrow('catalog counts do not match');

    const staleCurrent = archive();
    const staleCatalog = getArchiveBranchCatalog(staleCurrent);
    staleCurrent.conversation.currentNodeId = 'node-alternate';
    expect(() =>
      renderArchiveBranchLeaf(
        staleCurrent,
        staleCatalog,
        staleCatalog.branches[0],
        templateOptions,
        captureId
      )
    ).toThrow('current-leaf status');

    const wrongContainsCurrent = JSON.parse(JSON.stringify(catalog)) as typeof catalog;
    wrongContainsCurrent.branches[0].containsCurrentNode = false;
    expect(() =>
      renderArchiveBranchLeaf(
        value,
        wrongContainsCurrent,
        wrongContainsCurrent.branches[0],
        templateOptions,
        captureId
      )
    ).toThrow('current-node status');

    expect(() =>
      renderArchiveBranchIndex(
        value,
        catalog,
        [entries[0], { ...entries[1], status: 'future' as never }],
        templateOptions,
        captureId
      )
    ).toThrow('invalid rendering status');
    expect(() =>
      renderArchiveBranchIndex(
        value,
        catalog,
        [entries[0], { ...entries[1], fileName: 'different-safe-name.md' }],
        templateOptions,
        captureId
      )
    ).toThrow('filename does not match');

    const unsupported = archive();
    const unsupportedCatalog = getArchiveBranchCatalog(unsupported);
    const unsupportedEntries = renderedLeaves(unsupported).renders.map(indexEntry);
    unsupported.conversation.provider = 'future-provider';
    expect(() =>
      renderArchiveBranchIndex(
        unsupported,
        unsupportedCatalog,
        unsupportedEntries,
        templateOptions,
        captureId
      )
    ).toThrow('provider is unsupported');

    const invalidArchive = archive() as LiskaThreadArchive & { schema: string };
    invalidArchive.schema = 'future-schema';
    expect(() =>
      renderArchiveBranchIndex(invalidArchive, catalog, entries, templateOptions, captureId)
    ).toThrow('Canonical archive is invalid');
  });
});
