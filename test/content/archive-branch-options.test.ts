import { describe, expect, it } from 'vitest';
import { getArchiveBranchCatalog, type LiskaThreadArchive } from '../../src/archive';
import { buildArchiveBranchPickerOptions } from '../../src/content/archive-branch-options';
import branchingFixture from '../fixtures/archive/branching-chatgpt-thread.json';

function archive(): LiskaThreadArchive {
  return JSON.parse(JSON.stringify(branchingFixture)) as LiskaThreadArchive;
}

describe('archive branch picker options', () => {
  it('pins the current leaf while preserving canonical ordinals and local previews', () => {
    const value = archive();
    const catalog = getArchiveBranchCatalog(value);

    const options = buildArchiveBranchPickerOptions(value, catalog);

    expect(options.map(option => option.ordinal)).toEqual([1, 2]);
    expect(options[0]).toMatchObject({
      ordinal: 1,
      isCurrent: true,
      messageCount: 2,
      uniqueMessageCount: 1,
      preview: 'Current answer starts here.',
    });
    expect(options[1]).toMatchObject({
      ordinal: 2,
      isCurrent: false,
      messageCount: 2,
      uniqueMessageCount: 1,
      preview: 'Alternate **answer** remains a separate leaf.',
    });
  });

  it('sanitizes HTML previews and never serializes provider node IDs into choices', () => {
    const value = archive();
    const alternate = value.graph.nodes['node-alternate'].message!;
    alternate.blocks = [
      {
        id: 'html-preview',
        type: 'html',
        html: '<p>Safe label</p><script>window.evil = true</script>',
        sourceRefs: alternate.sourceRefs,
        extensions: {},
      },
    ];

    const options = buildArchiveBranchPickerOptions(value, getArchiveBranchCatalog(value));
    const serialized = JSON.stringify(options);

    expect(options.find(option => option.ordinal === 2)?.preview).toBe('Safe label');
    expect(serialized).not.toContain('node-alternate');
    expect(serialized).not.toContain('window.evil');
  });

  it('supports technical-only unique suffixes without inventing a preview', () => {
    const value = archive();
    const alternate = value.graph.nodes['node-alternate'].message!;
    alternate.author.role = 'tool';
    alternate.blocks = [
      {
        id: 'tool-only',
        type: 'tool_result',
        toolName: 'synthetic',
        result: { ok: true },
        sourceRefs: alternate.sourceRefs,
        extensions: {},
      },
    ];

    const options = buildArchiveBranchPickerOptions(value, getArchiveBranchCatalog(value));

    expect(options.find(option => option.ordinal === 2)).toMatchObject({
      messageCount: 2,
      uniqueMessageCount: 1,
      isCurrent: false,
    });
    expect(options.find(option => option.ordinal === 2)).not.toHaveProperty('preview');
  });

  it('never exposes system or tool text as a user-facing branch preview', () => {
    const value = archive();
    const alternate = value.graph.nodes['node-alternate'].message!;
    alternate.author.role = 'system';
    alternate.blocks = [
      {
        id: 'system-text',
        type: 'text',
        text: 'internal system instructions',
        sourceRefs: alternate.sourceRefs,
        extensions: {},
      },
    ];

    const options = buildArchiveBranchPickerOptions(value, getArchiveBranchCatalog(value));

    expect(options.find(option => option.ordinal === 2)).not.toHaveProperty('preview');
  });

  it('does not surface canonically hidden messages as picker previews', () => {
    const value = archive();
    value.graph.nodes['node-alternate'].message!.visibility = 'hidden';

    const options = buildArchiveBranchPickerOptions(value, getArchiveBranchCatalog(value));

    expect(options.find(option => option.ordinal === 2)).not.toHaveProperty('preview');
  });

  it.each([
    { type: 'code' as const, payload: { code: 'const fox = 1;', language: 'js' } },
    { type: 'quote' as const, payload: { text: 'A quoted branch', attribution: null } },
  ])('uses bounded visible $type blocks for local previews', ({ type, payload }) => {
    const value = archive();
    const alternate = value.graph.nodes['node-alternate'].message!;
    alternate.blocks = [
      {
        id: `${type}-preview`,
        type,
        ...payload,
        sourceRefs: alternate.sourceRefs,
        extensions: {},
      },
    ];

    const options = buildArchiveBranchPickerOptions(value, getArchiveBranchCatalog(value));

    expect(options.find(option => option.ordinal === 2)?.preview).toBe(
      type === 'code' ? 'const fox = 1;' : 'A quoted branch'
    );
  });
});
