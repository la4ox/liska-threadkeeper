import { describe, expect, it } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Node } from 'unist';
import { prepareAppendTailWrite } from '../../src/background/obsidian-append-images';
import { INERT_CODE_BLOCKS_FAILURE_CODE } from '../../src/lib/inert-code-blocks';
import { MESSAGE_BOUNDARY_MARKER } from '../../src/lib/message-counter';
import { MARKDOWN_WORK_LIMITS } from '../../src/lib/markdown-work-budget';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import type { ExtensionSettings } from '../../src/lib/types';

interface TestNode extends Node {
  readonly lang?: string | null;
  readonly children?: readonly TestNode[];
}

const settings: ExtensionSettings = {
  ...DEFAULT_SYNC_SETTINGS,
  obsidianApiKey: 'test-key',
  flattenLargeCallouts: false,
};

function input(existingBody: string, newMessages: string) {
  return {
    content: `---\nid: example\n---\n${existingBody}\n\n${newMessages}`,
    newMessages,
    existingBody,
    messagesAppended: 1,
    updatedFrontmatter: '---\nid: example\n---',
  };
}

function taggedNodes(source: string): TestNode[] {
  const root = fromMarkdown(source) as TestNode;
  const pending = [root];
  const result: TestNode[] = [];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.type === 'code' && typeof node.lang === 'string') result.push(node);
    if (node.children) pending.push(...node.children);
  }
  return result;
}

describe('append inert tagged-code seam', () => {
  const footnoteBypass = [
    'a[^x]',
    '',
    '[^x]:',
    '    ```dataviewjs',
    '    dv.pages()',
    '    ```',
  ].join('\n');
  const commentBypass = ['%%', 'ignored', '%%```dataviewjs', 'dv.pages()', '```'].join('\n');
  const sameLineFootnoteBypass = [
    'a[^x]',
    '',
    '[^x]: ```dataviewjs',
    '    dv.pages()',
    '    ```',
  ].join('\n');
  const textCommentBypass = ['%% ignored', 'more', '%%```dataviewjs', 'dv.pages()', '```'].join(
    '\n'
  );
  const quotedCommentBypass = [
    '> %%',
    '> ignored',
    '> %%```dataviewjs',
    '> dv.pages()',
    '> ```',
  ].join('\n');
  const spacedFootnoteBypass = [
    'a[^x]',
    '',
    '[^x]:    ```dataviewjs',
    '    dv.pages()',
    '    ```',
  ].join('\n');
  const tabFootnoteBypass = ['a[^x]', '', '[^x]:\t```dataviewjs', '\tdv.pages()', '\t```'].join(
    '\n'
  );
  const listCommentBypass = [
    '- %% ignored',
    '  more',
    '  %%```dataviewjs',
    '  dv.pages()',
    '  ```',
  ].join('\n');
  const escapedCloseBypass = ['%% ignored', 'more', '\\%%```dataviewjs', 'dv.pages()', '```'].join(
    '\n'
  );
  const multilineInlineFootnoteBypass = [
    'a[^x]',
    '',
    '[^x]: ```dataviewjs option',
    '    dv.pages()',
    '    ```',
  ].join('\n');

  it('neutralizes only the transformed new tail and recomputes marker ranges', () => {
    const existingBody = 'Old user-owned body 🦊';
    const tail = `${MESSAGE_BOUNDARY_MARKER}\n\n\`\`\`dataviewjs\ndv.pages()\n\`\`\``;

    const result = prepareAppendTailWrite(input(existingBody, tail), settings);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.content).toContain(`${existingBody}\n\n${MESSAGE_BOUNDARY_MARKER}`);
    expect(result.content).toContain('~~~\n```dataviewjs\ndv.pages()\n```\n~~~');
    expect(taggedNodes(result.content)).toEqual([]);
  });

  it.each([
    ['closed in the old prefix', '```js\nold()\n```'],
    ['unclosed across the seam', '```js\nold()'],
    ['inside an old Obsidian footnote', footnoteBypass],
    ['after an old Obsidian block comment', commentBypass],
    ['inside an old same-line Obsidian footnote', sameLineFootnoteBypass],
    ['after an old text-opening Obsidian block comment', textCommentBypass],
    ['after an old quoted Obsidian block comment', quotedCommentBypass],
    ['inside an old spaced same-line footnote', spacedFootnoteBypass],
    ['inside an old tab same-line footnote', tabFootnoteBypass],
    ['after an old list-contained comment', listCommentBypass],
    ['after an old escaped-looking comment close', escapedCloseBypass],
    ['inside an old multiline-inline footnote', multilineInlineFootnoteBypass],
  ])('refuses a tagged block %s', (_label, existingBody) => {
    const tail = `${MESSAGE_BOUNDARY_MARKER}\nnew message`;
    expect(prepareAppendTailWrite(input(existingBody, tail), settings)).toEqual({
      ok: false,
      code: INERT_CODE_BLOCKS_FAILURE_CODE,
    });
  });

  it.each([
    ['Obsidian footnote', footnoteBypass],
    ['Obsidian block-comment remainder', commentBypass],
    ['same-line Obsidian footnote', sameLineFootnoteBypass],
    ['text-opening Obsidian block comment', textCommentBypass],
    ['quoted Obsidian block comment', quotedCommentBypass],
    ['spaced same-line footnote', spacedFootnoteBypass],
    ['tab same-line footnote', tabFootnoteBypass],
    ['list-contained comment', listCommentBypass],
    ['escaped-looking comment close', escapedCloseBypass],
    ['multiline-inline footnote', multilineInlineFootnoteBypass],
  ])('refuses a new tail containing the %s bypass', (_label, dialect) => {
    const tail = `${MESSAGE_BOUNDARY_MARKER}\n\n${dialect}`;
    expect(prepareAppendTailWrite(input('old', tail), settings)).toEqual({
      ok: false,
      code: INERT_CODE_BLOCKS_FAILURE_CODE,
    });
  });

  it('also refuses tagged old content on a diagnostics-only update', () => {
    const existingBody = '~~~custom\nold\n~~~';
    const result = prepareAppendTailWrite(
      {
        ...input(existingBody, ''),
        diagnosticsOnly: true,
        messagesAppended: 0,
        content: `---\nid: example\nliska_loss_diagnostics_schema: 1\n---\n${existingBody}`,
      },
      settings
    );

    expect(result).toEqual({ ok: false, code: INERT_CODE_BLOCKS_FAILURE_CODE });
  });

  it('accepts a >4 MiB candidate-free diagnostics prefix without parser admission', () => {
    const existingBody = 'x'.repeat(MARKDOWN_WORK_LIMITS.parseLength + 1);
    const content = `---\nid: example\nliska_loss_diagnostics_schema: 1\n---\n${existingBody}`;
    expect(
      prepareAppendTailWrite(
        {
          ...input(existingBody, ''),
          diagnosticsOnly: true,
          messagesAppended: 0,
          content,
        },
        settings
      )
    ).toEqual({ ok: true, content });
  });

  it.each([
    footnoteBypass,
    commentBypass,
    sameLineFootnoteBypass,
    textCommentBypass,
    quotedCommentBypass,
    spacedFootnoteBypass,
    tabFootnoteBypass,
    listCommentBypass,
    escapedCloseBypass,
    multilineInlineFootnoteBypass,
  ])('refuses an old Obsidian dialect bypass on a diagnostics-only update', existingBody => {
    const result = prepareAppendTailWrite(
      {
        ...input(existingBody, ''),
        diagnosticsOnly: true,
        messagesAppended: 0,
        content: `---\nid: example\nliska_loss_diagnostics_schema: 1\n---\n${existingBody}`,
      },
      settings
    );
    expect(result).toEqual({ ok: false, code: INERT_CODE_BLOCKS_FAILURE_CODE });
  });

  it('keeps comment/fence lookalikes literal inside a new untagged outer block', () => {
    const literal = ['~~~~', ...commentBypass.split('\n'), '~~~~'].join('\n');
    const tail = `${MESSAGE_BOUNDARY_MARKER}\n\n${literal}`;
    const result = prepareAppendTailWrite(input('old', tail), settings);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.content).toContain(literal);
  });

  it('keeps the legacy append rendering when the setting is explicitly false', () => {
    const existingBody = '```js\nold()\n```';
    const tail = `${MESSAGE_BOUNDARY_MARKER}\n\n~~~custom\nnew\n~~~`;
    const result = prepareAppendTailWrite(input(existingBody, tail), {
      ...settings,
      enableInertCodeBlocks: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.content).toContain(existingBody);
    expect(result.content).toContain('~~~custom\nnew\n~~~');
    expect(taggedNodes(result.content)).toHaveLength(2);
  });

  it.each([
    footnoteBypass,
    commentBypass,
    sameLineFootnoteBypass,
    textCommentBypass,
    quotedCommentBypass,
    spacedFootnoteBypass,
    tabFootnoteBypass,
    listCommentBypass,
    escapedCloseBypass,
    multilineInlineFootnoteBypass,
  ])('preserves an Obsidian dialect bypass only when the setting is explicitly false', dialect => {
    const tail = `${MESSAGE_BOUNDARY_MARKER}\n\n${dialect}`;
    const result = prepareAppendTailWrite(input('old', tail), {
      ...settings,
      enableInertCodeBlocks: false,
    });
    expect(result.ok).toBe(true);
  });
});
