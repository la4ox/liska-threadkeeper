import { describe, expect, it } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { neutralizeActiveProviderMarkdown } from '../../src/content/markdown-safety';

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
      `&#91;target](${destination})`
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
