import { afterEach, describe, expect, it, vi } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
vi.mock(import('mdast-util-from-markdown'), { spy: true });
import { neutralizeActiveProviderMarkdown } from '../../src/content/markdown-safety';
import { MARKDOWN_WORK_LIMITS, MarkdownWorkBudget } from '../../src/lib/markdown-work-budget';
import { MAX_CONTENT_SIZE } from '../../src/lib/constants';
import {
  MESSAGE_BOUNDARY_FORMAT_MARKER,
  MESSAGE_BOUNDARY_MARKER,
} from '../../src/lib/message-counter';

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(fromMarkdown).mockReset();
});

function activeNodeTypes(markdown: string): string[] {
  const pending: Array<{ type: string; children?: unknown[] }> = [fromMarkdown(markdown)];
  const activeNodes: string[] = [];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (['image', 'imageReference', 'link', 'linkReference', 'definition'].includes(node.type)) {
      activeNodes.push(node.type);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (typeof child === 'object' && child !== null && 'type' in child) {
          pending.push(child as { type: string; children?: unknown[] });
        }
      }
    }
  }
  return activeNodes;
}

function htmlNodeValues(markdown: string): string[] {
  const pending: Array<{ type: string; value?: string; children?: unknown[] }> = [
    fromMarkdown(markdown),
  ];
  const values: string[] = [];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.type === 'html') values.push(node.value ?? '');
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (typeof child === 'object' && child !== null && 'type' in child) {
          pending.push(child as { type: string; value?: string; children?: unknown[] });
        }
      }
    }
  }
  return values;
}

describe('neutralizeActiveProviderMarkdown', () => {
  it('keeps public links but makes every provider-authored image literal', () => {
    const input = [
      '[docs](https://example.com/a_(b)?x=1&y=2)',
      '[public IP](http://8.8.8.8/path)',
      '[section](#details)',
      '![remote](https://example.com/pixel.png)',
      '![protocol relative](//example.com/pixel.png)',
      '![reference][image-id]',
      '',
      '[image-id]: https://example.com/pixel.png',
    ].join('\n');

    expect(neutralizeActiveProviderMarkdown(input)).toBe(
      [
        '[docs](https://example.com/a_(b)?x=1&y=2)',
        '[public IP](http://8.8.8.8/path)',
        '[section](#details)',
        '&#33;&#91;remote](https://example.com/pixel.png)',
        '&#33;&#91;protocol relative](//example.com/pixel.png)',
        '&#33;&#91;reference]&#91;image-id]',
        '',
        '[image-id]: https://example.com/pixel.png',
      ].join('\n')
    );
  });

  it.each([
    'javascript:alert(1)',
    'java&#x73;cript:alert(1)',
    'data:text/html,hello',
    'file:///private/note.md',
    'obsidian://open?vault=private',
    'mailto:tracker@example.com',
    '//example.com/path',
    '../private-note.md',
    'https://user:secret@example.com/private',
    'http://localhost:43199/admin',
    'http://local&#104;ost/admin',
    'http://service.local/admin',
    'http://127.0.0.1/admin',
    'http://127&#46;0.0.1/admin',
    'http://127.1/admin',
    'http://2130706433/admin',
    'http://10.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data',
    'http://172.16.0.1/admin',
    'http://192.168.1.1/admin',
    'http://[::1]/admin',
    'http://[fd00::1]/admin',
    'http://[fe80::1]/admin',
    'http://[::ffff:127.0.0.1]/admin',
  ])('neutralizes unsupported or private link destination %s', destination => {
    expect(neutralizeActiveProviderMarkdown(`[target](${destination})`)).toBe(
      `&#91;target](${destination.replaceAll('[', '&#91;')})`
    );
  });

  it('fails closed for incomplete and multiline destinations', () => {
    expect(neutralizeActiveProviderMarkdown('[target](javascript:alert(1)')).toBe(
      '[target](javascript:alert(1)'
    );
    expect(neutralizeActiveProviderMarkdown('[target](\njavascript:alert(1))')).toBe(
      '&#91;target](\njavascript:alert(1))'
    );
    expect(neutralizeActiveProviderMarkdown('[target]:\n javascript:alert(1)')).toBe(
      '&#91;target]:\n javascript:alert(1)'
    );
    expect(neutralizeActiveProviderMarkdown('[target\n](http://127.0.0.1/admin)')).toBe(
      '&#91;target\n](http://127.0.0.1/admin)'
    );
    expect(
      neutralizeActiveProviderMarkdown('[target][private]\n\n- [private]: http://127.0.0.1/admin')
    ).toBe('[target][private]\n\n- &#91;private]: http://127.0.0.1/admin');
  });

  it('uses the renderer-decoded destination while preserving valid source spelling', () => {
    expect(neutralizeActiveProviderMarkdown('[safe](https://example.com/a\\(b\\))')).toBe(
      '[safe](https://example.com/a\\(b\\))'
    );
  });

  it('still finds active syntax inside malformed outer links', () => {
    const input =
      '[x](https://example.com a ![remote](https://attacker.example/pixel) ' +
      '[probe](http://127.0.0.1/admin) [[Private]])';
    expect(neutralizeActiveProviderMarkdown(input)).toBe(
      '[x](https://example.com a &#33;&#91;remote](https://attacker.example/pixel) ' +
        '&#91;probe](http://127.0.0.1/admin) &#91;[Private]])'
    );
  });

  it('neutralizes Markdown exposed by rejecting an unsafe link title', () => {
    const output = neutralizeActiveProviderMarkdown(
      '[blocked](file:///private "![pixel](https://attacker.example/pixel)")'
    );
    expect(output).toBe(
      '&#91;blocked](file:///private "!&#91;pixel](https://attacker.example/pixel)")'
    );
    expect(activeNodeTypes(output)).not.toContain('image');
  });

  it('neutralizes hidden syntax throughout a rejected definition', () => {
    const output = neutralizeActiveProviderMarkdown(
      '[x]: javascript:blocked "![probe](http://127.0.0.1:43199/admin)"'
    );
    expect(output).toBe('&#91;x]: javascript:blocked "!&#91;probe](http://127.0.0.1:43199/admin)"');
    expect(activeNodeTypes(output)).not.toContain('image');
  });

  it('does not expose nested image syntax when the outer image becomes literal', () => {
    const output = neutralizeActiveProviderMarkdown(
      '![![pixel](https://attacker.example/pixel)](https://example.com/outer)'
    );
    expect(output).toBe(
      '&#33;&#91;!&#91;pixel](https://attacker.example/pixel)](https://example.com/outer)'
    );
    expect(activeNodeTypes(output)).toEqual([]);
  });

  it('neutralizes unresolved image references before later messages can define them', () => {
    const first = neutralizeActiveProviderMarkdown('![pixel][tracking]');
    const second = neutralizeActiveProviderMarkdown('[tracking]: https://attacker.example/pixel');
    expect(first).toBe('&#33;&#91;pixel][tracking]');
    const activeNodes = activeNodeTypes(`${first}\n\n${second}`);
    expect(activeNodes).not.toContain('image');
    expect(activeNodes).not.toContain('imageReference');
  });

  it('preserves footnotes while sanitizing active content inside them', () => {
    const input = [
      'Answer with a footnote.[^detail]',
      '',
      '[^detail]: Read [the public source](https://example.com/source).',
      '[^unsafe]: ![pixel](https://attacker.example/pixel)',
      '[^single]: Explanation.',
      '[^wiki]: [[Private note]]',
      '[^link]: [bad](javascript:alert%281%29)',
    ].join('\n');

    expect(neutralizeActiveProviderMarkdown(input)).toBe(
      [
        'Answer with a footnote.[^detail]',
        '',
        '[^detail]: Read [the public source](https://example.com/source).',
        '[^unsafe]: &#33;&#91;pixel](https://attacker.example/pixel)',
        '[^single]: Explanation.',
        '[^wiki]: &#91;[Private note]]',
        '[^link]: &#91;bad](javascript:alert%281%29)',
      ].join('\n')
    );
  });

  it('handles isolated footnotes that CommonMark classifies as definitions', () => {
    expect(neutralizeActiveProviderMarkdown('[^note]: Explanation.')).toBe('[^note]: Explanation.');
    expect(
      neutralizeActiveProviderMarkdown('[^note]: ![pixel](https://attacker.example/pixel)')
    ).toBe('[^note]: &#33;&#91;pixel](https://attacker.example/pixel)');
  });

  it('preserves Obsidian inline and display math containing double brackets', () => {
    const math = ['$\\mathbb{Z}[[t]]$', '$$', 'A[[i]] + B[[j]]', '$$'].join('\n');
    expect(neutralizeActiveProviderMarkdown(math)).toBe(math);
  });

  it('neutralizes Obsidian links and embeds while keeping literal examples intact', () => {
    const input = [
      '[[Private note]] and ![[private.pdf]]',
      '`[[inline example]] ![image](https://example.com/pixel)`',
      '> ~~~markdown',
      '> [[fenced example]]',
      '> ![fenced image](http://127.0.0.1/private)',
      '> ~~~',
      '    ![indented example](https://example.com/pixel)',
      '- item',
      '  ```markdown',
      '  ![list fence example](https://example.com/pixel)',
      '  ```',
    ].join('\n');

    expect(neutralizeActiveProviderMarkdown(input)).toBe(
      [
        '&#91;[Private note]] and &#33;&#91;[private.pdf]]',
        '`[[inline example]] ![image](https://example.com/pixel)`',
        '> ~~~markdown',
        '> [[fenced example]]',
        '> ![fenced image](http://127.0.0.1/private)',
        '> ~~~',
        '    ![indented example](https://example.com/pixel)',
        '- item',
        '  ```markdown',
        '  ![list fence example](https://example.com/pixel)',
        '  ```',
      ].join('\n')
    );
  });

  it('neutralizes parser-confirmed HTML while preserving code and exact Liska markers', () => {
    const input = [
      MESSAGE_BOUNDARY_FORMAT_MARKER,
      '',
      '<iframe src=x></iframe>',
      '',
      '`<span>inline</span>`',
      '',
      '- ```html',
      '  <script>literal()</script>',
      '  ```',
      '',
      '![![pixel](https://attacker.example/pixel)](https://example.com/outer)',
      '',
      '<!-- liska-message:v1 --x>',
      '',
      MESSAGE_BOUNDARY_MARKER,
    ].join('\n');

    const trustedHtmlRanges = [
      { start: 0, end: MESSAGE_BOUNDARY_FORMAT_MARKER.length },
      {
        start: input.lastIndexOf(MESSAGE_BOUNDARY_MARKER),
        end: input.lastIndexOf(MESSAGE_BOUNDARY_MARKER) + MESSAGE_BOUNDARY_MARKER.length,
      },
    ];
    const output = neutralizeActiveProviderMarkdown(input, [], trustedHtmlRanges);
    expect(output).toContain('&lt;iframe src=x&gt;&lt;/iframe&gt;');
    expect(output).toContain('`<span>inline</span>`');
    expect(output).toContain('  <script>literal()</script>');
    expect(output).toContain('&#33;&#91;!&#91;pixel]');
    expect(output).toContain('&lt;!-- liska-message:v1 --x&gt;');
    expect(htmlNodeValues(output).sort()).toEqual(
      [MESSAGE_BOUNDARY_FORMAT_MARKER, MESSAGE_BOUNDARY_MARKER].sort()
    );
  });

  it('does not trust a marker-shaped provider string without composer-owned ranges', () => {
    expect(neutralizeActiveProviderMarkdown(MESSAGE_BOUNDARY_MARKER)).toBe(
      '&lt;!-- liska-message:v1 --&gt;'
    );
  });

  it('rejects a trusted HTML range that does not identify an exact generated marker', () => {
    const input = '<iframe src=x></iframe>';
    expect(neutralizeActiveProviderMarkdown(input, [], [{ start: 0, end: input.length }])).toBe(
      '&lt;iframe src=x&gt;&lt;/iframe&gt;'
    );
  });

  it('reparses after outer neutralization so newly exposed HTML cannot stay active', () => {
    const input = '[blocked](file:///private "<iframe src=x></iframe>")';
    const output = neutralizeActiveProviderMarkdown(input);

    expect(output).toContain('&#91;blocked]');
    expect(htmlNodeValues(output)).toEqual([]);
  });

  it('keeps Markdown that was opaque inside raw HTML literal after the HTML is neutralized', () => {
    const input = [
      '<div>',
      '![track](https://attacker.example/pixel)',
      '[private](http://127.0.0.1/admin)',
      '[[Local note]]',
      '</div>',
    ].join('\n');
    const output = neutralizeActiveProviderMarkdown(input);

    expect(output).toContain('&lt;div&gt;');
    expect(output).toContain('!&#91;track](https://attacker.example/pixel)');
    expect(output).toContain('&#91;private](http://127.0.0.1/admin)');
    expect(output).toContain('&#91;&#91;Local note]]');
    expect(activeNodeTypes(output)).toEqual([]);
    expect(htmlNodeValues(output)).toEqual([]);
  });

  it('distinguishes unmatched backticks from complete multiline inline code', () => {
    expect(neutralizeActiveProviderMarkdown('`unfinished [[not protected]]')).toBe(
      '`unfinished &#91;[not protected]]'
    );
    const multiline = '`line one\n![multiline example](https://example.com/pixel)`';
    expect(neutralizeActiveProviderMarkdown(multiline)).toBe(multiline);
  });

  it('allows only exact receipt-proven ChatGPT archive targets', () => {
    const trusted = `_liska-archive/${'a'.repeat(64)}/capture-chatgpt-11111111-2222-4333-8444-555555555555/assets/${'b'.repeat(64)}.pdf`;
    expect(neutralizeActiveProviderMarkdown(`[document](${trusted})`)).toBe(
      `&#91;document](${trusted})`
    );
    expect(neutralizeActiveProviderMarkdown(`[document](${trusted})`, [trusted])).toBe(
      `[document](${trusted})`
    );
    expect(neutralizeActiveProviderMarkdown(`![preview](${trusted})`, [trusted])).toBe(
      `![preview](${trusted})`
    );
    expect(
      neutralizeActiveProviderMarkdown(
        `[traversal](_liska-archive/${'a'.repeat(64)}/capture-chatgpt-safe/assets/../private.pdf)`,
        [trusted]
      )
    ).toContain('&#91;traversal]');
  });

  it('handles long escape runs without changing ordinary text', () => {
    const input = `${'\\'.repeat(32_768)} [[visible wiki]]`;
    expect(neutralizeActiveProviderMarkdown(input)).toBe(
      `${'\\'.repeat(32_768)} &#91;[visible wiki]]`
    );
  });

  it('keeps source edits aligned across Unicode and CRLF', () => {
    const input =
      'Привет, 🦊\r\n![像](https://attacker.example/pixel)\r\n[источник](https://example.com/资料)';
    expect(neutralizeActiveProviderMarkdown(input)).toBe(
      'Привет, 🦊\r\n&#33;&#91;像](https://attacker.example/pixel)\r\n[источник](https://example.com/资料)'
    );
  });

  it('removes the reproduced active nodes on a second CommonMark parse', () => {
    const output = neutralizeActiveProviderMarkdown(
      [
        '![track](https://attacker.example/pixel)',
        '![probe](http://127.0.0.1/admin)',
        '[unsafe](javascript:alert%281%29)',
        '[private](http://192.168.1.1/admin)',
      ].join('\n')
    );
    expect(activeNodeTypes(output)).toEqual([]);
  });
});

describe('shared Markdown work budget', () => {
  it('never resets an upstream admission failure before the composed safety pass', () => {
    const budget = new MarkdownWorkBudget();
    expect(() =>
      budget.admitParse('*\n'.repeat(MARKDOWN_WORK_LIMITS.structuralUnits / 2) + '*')
    ).toThrow('Markdown work budget exceeded');
    expect(() => budget.admitParse('small')).toThrow('Markdown work budget exceeded');
    const source = `${MESSAGE_BOUNDARY_FORMAT_MARKER}\n![pixel](https://example.com/pixel)`;
    const parser = vi.mocked(fromMarkdown);
    parser.mockClear();
    expect(
      neutralizeActiveProviderMarkdown(
        source,
        [],
        [{ start: 0, end: MESSAGE_BOUNDARY_FORMAT_MARKER.length }],
        budget
      )
    ).toBe(`${MESSAGE_BOUNDARY_FORMAT_MARKER}\n!&#91;pixel](https://example.com/pixel)`);
    expect(parser).not.toHaveBeenCalled();
  });

  it('returns an explicit inert diagnostic if original-source expansion cannot fit the output limit', () => {
    // About 6.4 Mi code units, not a 32 Mi fixture. No parser or oversized
    // inert output is built; block byte accounting stops the expansion.
    const source = '['.repeat(Math.floor(MAX_CONTENT_SIZE / '&#91;'.length) + 1);
    const parser = vi.mocked(fromMarkdown);
    parser.mockClear();
    expect(neutralizeActiveProviderMarkdown(source)).toBe(
      'Reading view unavailable: Markdown safety work or output limit exceeded. Raw and canonical archives are unchanged.'
    );
    expect(parser).not.toHaveBeenCalled();
  });

  it('keeps surrogate pairs and escape parity intact across fallback blocks', () => {
    const source = `${'a'.repeat(8191)}😀\\[literal] <tag>`;
    vi.mocked(fromMarkdown).mockImplementationOnce(() => {
      throw new Error('parser failure');
    });
    expect(neutralizeActiveProviderMarkdown(source)).toBe(
      `${'a'.repeat(8191)}😀\\[literal] &lt;tag&gt;`
    );
  });
  it.each([
    ['input length', `${'a'.repeat(MARKDOWN_WORK_LIMITS.lineLength - 1)}\n`.repeat(16)],
    ['physical line', 'a'.repeat(MARKDOWN_WORK_LIMITS.lineLength)],
    ['structural units', '*\n'.repeat(MARKDOWN_WORK_LIMITS.structuralUnits / 2)],
  ])('admits the exact %s boundary and refuses +1 before the parser', (_label, boundary) => {
    const source = `[${boundary.slice(1)}`;
    const parser = vi.mocked(fromMarkdown);
    parser.mockClear();
    parser.mockReturnValueOnce({ type: 'root', children: [] });
    expect(neutralizeActiveProviderMarkdown(source)).toBe(source);
    expect(parser).toHaveBeenCalledTimes(1);
    parser.mockClear();
    expect(neutralizeActiveProviderMarkdown(`${source}*`)).toBe(`&#91;${boundary.slice(1)}*`);
    expect(parser).not.toHaveBeenCalled();
  });

  it('aggregates parser input across calls instead of resetting the 16 Mi allowance', () => {
    const budget = new MarkdownWorkBudget();
    const source = `${'a'.repeat(MARKDOWN_WORK_LIMITS.lineLength - 1)}\n`.repeat(16);
    for (let index = 0; index < 4; index += 1) budget.admitParse(source);
    expect(() => budget.admitParse('x')).toThrow('Markdown work budget exceeded');
  });

  it('debits each aggregate range scan and unique edit before work begins', () => {
    const budget = new MarkdownWorkBudget();
    budget.scan(MARKDOWN_WORK_LIMITS.rangeScan);
    expect(() => budget.scan(1)).toThrow('Markdown work budget exceeded');
    const editBudget = new MarkdownWorkBudget();
    for (let index = 0; index < MARKDOWN_WORK_LIMITS.edits; index += 1) editBudget.newEdit();
    expect(() => editBudget.newEdit()).toThrow('Markdown work budget exceeded');
  });

  it('rejects a wide parser tree before iterating or pushing any child', () => {
    const children = new Array(MARKDOWN_WORK_LIMITS.traversalNodes);
    const iterate = vi.fn(() => {
      throw new Error('oversized child iterator entered');
    });
    Object.defineProperty(children, Symbol.iterator, { value: iterate });
    vi.mocked(fromMarkdown).mockReturnValueOnce({ type: 'root', children });
    expect(neutralizeActiveProviderMarkdown('[x](https://example.com)')).toBe(
      '&#91;x](https://example.com)'
    );
    expect(iterate).not.toHaveBeenCalled();
  });

  it('shares one parse-call allowance with every nested footnote parse', () => {
    const parser = vi.mocked(fromMarkdown);
    const admissions = vi.spyOn(MarkdownWorkBudget.prototype, 'admitParse');
    parser.mockClear();
    const source = Array.from(
      { length: MARKDOWN_WORK_LIMITS.parseCalls },
      (_, index) => `[^f${index}]: [[x]]`
    ).join('\n');
    const output = neutralizeActiveProviderMarkdown(source);
    expect(parser).toHaveBeenCalledTimes(MARKDOWN_WORK_LIMITS.parseCalls);
    expect(admissions).toHaveBeenCalledTimes(MARKDOWN_WORK_LIMITS.parseCalls + 1);
    expect(new Set(admissions.mock.contexts).size).toBe(1);
    expect(output).toBe(source.replaceAll('[', '&#91;'));
  });

  it('shares aggregate node work across every walk and all expanded reparses', async () => {
    const { fromMarkdown: actualParser } = await vi.importActual<
      typeof import('mdast-util-from-markdown')
    >('mdast-util-from-markdown');
    const parser = vi.mocked(fromMarkdown);
    parser.mockClear();
    const admissions = vi.spyOn(MarkdownWorkBudget.prototype, 'admitParse');
    const padding = Array.from({ length: 89_999 }, () => ({ type: 'text' as const, value: '' }));
    parser.mockImplementation(input => {
      const tree = actualParser(input);
      tree.children.push(...padding.slice(0, 40_000));
      tree.children.push(...padding.slice(40_000));
      return tree;
    });
    const source =
      '![image](https://example.com/pixel)\n\n[blocked](file:///private "<iframe src=x></iframe>")';
    const output = neutralizeActiveProviderMarkdown(source);
    expect(parser).toHaveBeenCalledTimes(3);
    expect(new Set(admissions.mock.contexts).size).toBe(1);
    // Original-source fallback differs from retaining the first pass's image edit.
    expect(output).toBe(
      '!&#91;image](https://example.com/pixel)\n\n&#91;blocked](file:///private "&lt;iframe src=x&gt;&lt;/iframe&gt;")'
    );
  });

  it('discards partial edits after a later parser failure and preserves only original owned markers', async () => {
    const { fromMarkdown: actualParser } = await vi.importActual<
      typeof import('mdast-util-from-markdown')
    >('mdast-util-from-markdown');
    const source = [
      MESSAGE_BOUNDARY_FORMAT_MARKER,
      MESSAGE_BOUNDARY_MARKER,
      '![image](https://example.com/pixel)',
      '[public](https://example.com)',
      MESSAGE_BOUNDARY_MARKER,
    ].join('\n');
    vi.mocked(fromMarkdown)
      .mockImplementationOnce(actualParser)
      .mockImplementationOnce(() => {
        throw new Error('private parser detail');
      });
    const markerStart = source.indexOf(MESSAGE_BOUNDARY_MARKER);
    const output = neutralizeActiveProviderMarkdown(
      source,
      [],
      [
        { start: 0, end: MESSAGE_BOUNDARY_FORMAT_MARKER.length },
        { start: markerStart, end: markerStart + MESSAGE_BOUNDARY_MARKER.length },
      ]
    );
    expect(output).toBe(
      [
        MESSAGE_BOUNDARY_FORMAT_MARKER,
        MESSAGE_BOUNDARY_MARKER,
        '!&#91;image](https://example.com/pixel)',
        '&#91;public](https://example.com)',
        '&lt;!-- liska-message:v1 --&gt;',
      ].join('\n')
    );
  });
});
