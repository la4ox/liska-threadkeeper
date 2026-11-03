import { describe, expect, it } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Node } from 'unist';
import {
  INERT_CODE_BLOCKS_FAILURE_CODE,
  InertCodeBlocksError,
  assertNoTaggedCodeBlocksBeforeOffset,
  makeTaggedCodeBlocksInert,
} from '../../src/lib/inert-code-blocks';
import { MARKDOWN_WORK_LIMITS } from '../../src/lib/markdown-work-budget';

interface TestNode extends Node {
  readonly lang?: string | null;
  readonly value?: string;
  readonly children?: readonly TestNode[];
}

function codeNodes(source: string): TestNode[] {
  const root = fromMarkdown(source) as TestNode;
  const pending = [root];
  const result: TestNode[] = [];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.type === 'code') result.push(node);
    if (node.children) pending.push(...node.children);
  }
  return result;
}

function expectNoTaggedCode(source: string): void {
  expect(codeNodes(source).filter(node => typeof node.lang === 'string')).toEqual([]);
}

describe('makeTaggedCodeBlocksInert', () => {
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

  it.each([
    ['Obsidian footnote deindentation', footnoteBypass],
    ['Obsidian block-comment close remainder', commentBypass],
    ['same-line Obsidian footnote body', sameLineFootnoteBypass],
    ['Obsidian block-comment opener text', textCommentBypass],
    ['quoted Obsidian block-comment container', quotedCommentBypass],
    [
      'footnote colon plus four spaces',
      ['a[^x]', '', '[^x]:    ```dataviewjs', '    dv.pages()', '    ```'].join('\n'),
    ],
    [
      'footnote colon plus tab',
      ['a[^x]', '', '[^x]:\t```dataviewjs', '\tdv.pages()', '\t```'].join('\n'),
    ],
    ['list-contained Obsidian block comment', listCommentBypass],
    ['escaped-looking Obsidian comment close', escapedCloseBypass],
    ['multiline-inline CommonMark footnote', multilineInlineFootnoteBypass],
  ])('fails closed on %s instead of returning an active dialect fence', (_label, input) => {
    expect(() => makeTaggedCodeBlocksInert(input)).toThrow(INERT_CODE_BLOCKS_FAILURE_CODE);
  });

  it.each([
    [
      'continued footnote',
      [
        'a[^x]',
        '',
        '[^x]:',
        '    first paragraph',
        '',
        '    ```custom',
        '    value',
        '    ```',
      ].join('\n'),
    ],
    [
      'nested blockquote footnote',
      ['> a[^x]', '>', '> [^x]:', '>     ```dataviewjs', '>     dv.pages()', '>     ```'].join(
        '\n'
      ),
    ],
    [
      'nested list footnote',
      ['- a[^x]', '', '  [^x]:', '      ```dataviewjs', '      dv.pages()', '      ```'].join('\n'),
    ],
  ])('fails closed on a %s dialect fence', (_label, input) => {
    expect(() => makeTaggedCodeBlocksInert(input)).toThrow(INERT_CODE_BLOCKS_FAILURE_CODE);
  });

  it.each([
    [
      'escaped percent pair without a fence candidate',
      ['\\%%', 'plain', '%%\\', 'plain'].join('\n'),
    ],
    [
      'tagged-looking source inside an untagged fence',
      ['~~~~', '%%', 'ignored', '%%```dataviewjs', 'dv.pages()', '```', '~~~~'].join('\n'),
    ],
    [
      'quoted comment source inside an untagged fence',
      ['> ~~~~', '> %% ignored', '> %%```dataviewjs', '> dv.pages()', '> ```', '> ~~~~'].join('\n'),
    ],
    ['ordinary double-backtick inline code', 'before ``inline value`` after'],
  ])('keeps a source-justified literal control unchanged: %s', (_label, input) => {
    expect(makeTaggedCodeBlocksInert(input)).toBe(input);
  });

  it.each([
    ['prose mid-line candidate', 'before ```dataviewjs after'],
    ['inline comment-shaped prose candidate', 'before %% ```dataviewjs %% after'],
    ['escaped-looking candidate', '\\```dataviewjs'],
    ['triple-fence-shaped inline syntax', 'before ```` ```dataviewjs value ```` after'],
    ['mixed-EOL physical candidate', 'before\r\ntext %%```dataviewjs\rvalue\n```'],
    ['candidate after a long physical prefix', `${'x'.repeat(200_000)}~~~custom`],
  ])('conservatively refuses %s', (_label, input) => {
    expect(() => makeTaggedCodeBlocksInert(input)).toThrow(INERT_CODE_BLOCKS_FAILURE_CODE);
  });

  it('keeps comments and tagged-looking fences literal after an ordinary tagged outer block is wrapped', () => {
    const input = [
      '````custom',
      '%%',
      'ignored',
      '%%```dataviewjs',
      'dv.pages()',
      '```',
      '````',
    ].join('\n');
    const output = makeTaggedCodeBlocksInert(input);
    expectNoTaggedCode(output);
    expect(codeNodes(output)[0].value).toBe(input);
    expect(makeTaggedCodeBlocksInert(output)).toBe(output);
  });

  it.each(['dataviewjs', 'text', 'custom-label'])('wraps %s as one unlabelled code node', lang => {
    const input = `\`\`\`${lang} option=value\nalert('visible');\n\`\`\``;
    const output = makeTaggedCodeBlocksInert(input);
    const nodes = codeNodes(output);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].lang).toBeNull();
    expect(nodes[0].value).toBe(input);
    expect(output).not.toBe(input);
    expectNoTaggedCode(output);
  });

  it('leaves untagged fenced, inline, and indented code byte-identical', () => {
    const input = ['```', 'plain fenced', '```', '', '`inline`', '', '    indented'].join('\n');
    expect(makeTaggedCodeBlocksInert(input)).toBe(input);
  });

  it.each([
    {
      name: 'blockquote',
      input: '> ```js\n> const fox = "🦊";\n> ```',
      visible: '```js\nconst fox = "🦊";\n```',
    },
    {
      name: 'list item',
      input: '- ~~~~custom meta\n  payload\n  ~~~~',
      visible: '~~~~custom meta\npayload\n~~~~',
    },
    {
      name: 'nested quote and ordered list',
      input: '> 10. ```python\n>     print("猫")\n>     ```',
      visible: '```python\nprint("猫")\n```',
    },
    {
      name: 'unclosed tilde fence with CRLF',
      input: '~~~dataviewjs\r\nconst x = "🦊";\r\nnot closed',
      visible: '~~~dataviewjs\r\nconst x = "🦊";\r\nnot closed',
    },
    {
      name: 'unclosed backtick fence with lone CR',
      input: '```ruby\rputs "fox"\rstill open',
      visible: '```ruby\rputs "fox"\rstill open',
    },
    {
      name: 'longer closing fence',
      input: '```js\nvalue\n``````',
      visible: '```js\nvalue\n``````',
    },
    {
      name: 'mismatched closing character',
      input: '```js\nvalue\n~~~',
      visible: '```js\nvalue\n~~~',
    },
    {
      name: 'long opener and fence-like payload',
      input: [
        '````````````js meta',
        '~~~~~~~~~~ fake tilde close with text',
        '`````````` fake short backtick close with text',
        '````````````',
      ].join('\n'),
      visible: [
        '````````````js meta',
        '~~~~~~~~~~ fake tilde close with text',
        '`````````` fake short backtick close with text',
        '````````````',
      ].join('\n'),
    },
  ])('preserves visible source for $name', ({ input, visible }) => {
    const output = makeTaggedCodeBlocksInert(input);
    const nodes = codeNodes(output);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].lang).toBeNull();
    expect(nodes[0].value).toBe(visible);
    expectNoTaggedCode(output);
  });

  it('neutralizes multiple disjoint tagged nodes and is idempotent', () => {
    const input = [
      'before',
      '```js',
      'one',
      '```',
      '',
      '> ~~~sql extra',
      '> select 1;',
      '> ~~~',
      '',
      'after',
    ].join('\n');
    const first = makeTaggedCodeBlocksInert(input);
    expect(codeNodes(first)).toHaveLength(2);
    expectNoTaggedCode(first);
    expect(makeTaggedCodeBlocksInert(first)).toBe(first);
    expect(input).toContain('```js');
  });

  it('returns the exact >4 MiB candidate-free input without parser admission', () => {
    const input = 'x'.repeat(MARKDOWN_WORK_LIMITS.parseLength + 1);
    expect(makeTaggedCodeBlocksInert(input)).toBe(input);
  });

  it('fails closed with one fixed typed code on parser, budget, and output failure', () => {
    const parserFailure = () =>
      makeTaggedCodeBlocksInert('```js\nx\n```', {
        parse: () => {
          throw new Error('parser detail must not escape');
        },
      });
    const budgetFailure = () =>
      makeTaggedCodeBlocksInert(`${'x'.repeat(MARKDOWN_WORK_LIMITS.parseLength + 1)}\`\`\`js`);
    const lineBudgetFailure = () =>
      makeTaggedCodeBlocksInert(`${'x'.repeat(MARKDOWN_WORK_LIMITS.lineLength + 1)}\`\`\`js`);
    const outputFailure = () => makeTaggedCodeBlocksInert('```js\nx\n```', { maxOutputBytes: 13 });

    for (const operation of [parserFailure, budgetFailure, lineBudgetFailure, outputFailure]) {
      expect(operation).toThrow(InertCodeBlocksError);
      expect(operation).toThrow(INERT_CODE_BLOCKS_FAILURE_CODE);
    }
  });
});

describe('assertNoTaggedCodeBlocksBeforeOffset', () => {
  it('refuses a closed old tagged node and one crossing the append seam', () => {
    const closed = '```js\nold\n```\n\nnew';
    expect(() => assertNoTaggedCodeBlocksBeforeOffset(closed, closed.indexOf('new'))).toThrow(
      INERT_CODE_BLOCKS_FAILURE_CODE
    );

    const crossing = '```js\nold\n\nnew';
    expect(() => assertNoTaggedCodeBlocksBeforeOffset(crossing, crossing.indexOf('new'))).toThrow(
      INERT_CODE_BLOCKS_FAILURE_CODE
    );
  });

  it('accepts a tagged node wholly after the seam', () => {
    const source = 'old\n\n```js\nnew\n```';
    expect(() => assertNoTaggedCodeBlocksBeforeOffset(source, source.indexOf('```'))).not.toThrow();
  });

  it('skips parser admission for a >4 MiB candidate-free prefix', () => {
    const prefix = 'x'.repeat(MARKDOWN_WORK_LIMITS.parseLength + 1);
    const source = `${prefix}\n\n\`\`\`js\nnew\n\`\`\``;
    expect(() => assertNoTaggedCodeBlocksBeforeOffset(source, prefix.length + 2)).not.toThrow();
  });

  it.each([
    [
      'footnote dialect block',
      ['a[^x]', '', '[^x]:', '    ```dataviewjs', '    old', '    ```', '', 'new'].join('\n'),
    ],
    [
      'comment close remainder',
      ['%%', 'old', '%%```dataviewjs', 'old', '```', '', 'new'].join('\n'),
    ],
    [
      'same-line footnote body',
      ['a[^x]', '', '[^x]: ```dataviewjs', '    old', '    ```', '', 'new'].join('\n'),
    ],
    [
      'comment opener text',
      ['%% old comment', 'old', '%%```dataviewjs', 'old', '```', '', 'new'].join('\n'),
    ],
    [
      'quoted comment close remainder',
      ['> %%', '> old', '> %%```dataviewjs', '> old', '> ```', '', 'new'].join('\n'),
    ],
  ])('refuses an old %s', (_label, source) => {
    expect(() => assertNoTaggedCodeBlocksBeforeOffset(source, source.lastIndexOf('new'))).toThrow(
      INERT_CODE_BLOCKS_FAILURE_CODE
    );
  });
});
