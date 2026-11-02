import { afterEach, describe, it, expect, vi } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
vi.mock(import('mdast-util-from-markdown'), { spy: true });
import { neutralizeActiveProviderMarkdown } from '../../src/content/markdown-safety';
import { htmlToMarkdown } from '../../src/content/markdown-rules';
import {
  stripImagePlaceholders,
  resolveImagesToConfirmedPaths,
  resolveImagesForObsidianTail,
  inspectTrustedTailImages,
  trustedTailImageIds,
  inspectImagePlaceholders,
  imagePlaceholderInternals,
} from '../../src/lib/image-output';
import { MARKDOWN_WORK_LIMITS } from '../../src/lib/markdown-work-budget';
import type { ExtractedImage } from '../../src/lib/types';
import {
  MESSAGE_BOUNDARY_FORMAT_MARKER,
  MESSAGE_BOUNDARY_MARKER,
} from '../../src/lib/message-counter';
import { flattenLargeCallouts } from '../../src/lib/callout-flatten';

const img = (id: string, mimeType = 'image/png'): ExtractedImage => ({
  id,
  mimeType,
  data: 'UE5H',
  alt: '（AI 生成）',
});

const placeholder = (id: string, alt = '（AI 生成）') => `![${alt}](g2o-image://${id})`;
const neutralizedPlaceholder = (id: string, alt = '（AI 生成）') =>
  `&#33;&#91;${alt}](g2o-image://${id})`;
const confirmedPaths = new Map([
  ['img-1', `Images/liska-v1/sha256-${'a'.repeat(64)}.png`],
  ['img-2', `Images/liska-v1/sha256-${'b'.repeat(64)}.jpg`],
]);

afterEach(() => {
  vi.mocked(fromMarkdown).mockReset();
});

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}

function markdownNodes(markdown: string): MarkdownNode[] {
  const pending = [fromMarkdown(markdown) as MarkdownNode];
  const result: MarkdownNode[] = [];
  while (pending.length > 0) {
    const node = pending.pop()!;
    result.push(node);
    if (node.children) pending.push(...node.children);
  }
  return result;
}

describe('stripImagePlaceholders', () => {
  it('removes image placeholders and collapses surrounding blank lines', () => {
    const body = `> [!NOTE] Gemini\n> text\n\n${placeholder('img-1')}\n\nmore text`;
    const out = stripImagePlaceholders(body);
    expect(out).not.toContain('g2o-image://');
    expect(out).toContain('text');
    expect(out).toContain('more text');
    expect(out).not.toMatch(/\n{3,}/);
  });

  it('leaves placeholder-free bodies unchanged', () => {
    expect(stripImagePlaceholders('plain body')).toBe('plain body');
  });

  it('removes neutralized failed-image placeholders without removing surrounding text', () => {
    const body = `> before\n> ${neutralizedPlaceholder('img-2', 'lost')}\n> after`;
    expect(stripImagePlaceholders(body)).toBe('> before\n> \n> after');
  });

  it('does not consume a placeholder-shaped range spanning math delimiters', () => {
    const body = '$![x](g2o-image://missing$$)$';
    expect(stripImagePlaceholders(body)).toBe(body);
  });

  it('does not consume a neutralized placeholder-shaped range spanning math delimiters or lines', () => {
    const body = '$&#33;&#91;x](g2o-image://missing$$)$\n&#33;&#91;x\n](g2o-image://missing)';
    expect(stripImagePlaceholders(body)).toBe(body);
  });

  it('preserves service markers but neutralizes one synthesized by placeholder removal', () => {
    const body = [
      MESSAGE_BOUNDARY_FORMAT_MARKER,
      '',
      MESSAGE_BOUNDARY_MARKER,
      '> <!-- liska-message![x](g2o-image://missing):v1 -->',
    ].join('\n');
    const out = stripImagePlaceholders(body);

    expect(out.split('\n').filter(line => line === MESSAGE_BOUNDARY_FORMAT_MARKER)).toHaveLength(1);
    expect(out.split('\n').filter(line => line === MESSAGE_BOUNDARY_MARKER)).toHaveLength(1);
    expect(out).toContain('> <!-- liska-message&#58;v1 -->');
    expect(
      flattenLargeCallouts(out, 1)
        .split('\n')
        .filter(line => line === MESSAGE_BOUNDARY_MARKER)
    ).toHaveLength(1);
  });
});

describe.each([
  ['append', resolveImagesForObsidianTail],
  ['confirmed paths', resolveImagesToConfirmedPaths],
] as const)('neutralized image placeholders for %s', (_destination, resolveImages) => {
  it('strips a failed-image placeholder while resolving the successful image', () => {
    const body = `${placeholder('img-1', 'cat')}\n\n${neutralizedPlaceholder('img-2', 'lost')}`;
    const { body: out, files } = resolveImages(body, [img('img-1')], confirmedPaths);

    expect(out).not.toContain('g2o-image://');
    expect(out).not.toContain('lost');
    expect(out).toContain(confirmedPaths.get('img-1'));
    expect(files).toEqual([
      { fileName: confirmedPaths.get('img-1'), mimeType: 'image/png', data: 'UE5H' },
    ]);
  });

  it('never reactivates a neutralized placeholder even when its image id exists', () => {
    const { body, files } = resolveImages(
      neutralizedPlaceholder('img-1'),
      [img('img-1')],
      confirmedPaths
    );
    expect(body).toBe('');
    expect(files).toEqual([]);
  });

  it('does not resolve a placeholder composed by removing a neutralized placeholder', () => {
    const body = `![cat](${neutralizedPlaceholder('missing')}g2o-image://img-1)`;
    const safe = neutralizeActiveProviderMarkdown(body);
    const result = resolveImages(safe, [img('img-1')], confirmedPaths);
    expect(result.body).toBe(safe);
    expect(markdownNodes(result.body).some(node => node.type === 'image')).toBe(false);
    expect(result.files).toEqual([]);
  });

  it('neutralizes a boundary synthesized by neutralized-placeholder removal', () => {
    const body = [
      MESSAGE_BOUNDARY_FORMAT_MARKER,
      MESSAGE_BOUNDARY_MARKER,
      `<!-- liska-message${neutralizedPlaceholder('missing', 'x')}:v1 -->`,
    ].join('\n');
    const { body: out } = resolveImages(body, [], confirmedPaths);

    expect(out).toContain('<!-- liska-message&#58;v1 -->');
    expect(out.split('\n').filter(line => line === MESSAGE_BOUNDARY_MARKER)).toHaveLength(1);
  });
});

describe('trusted private image parser context', () => {
  it('keeps a multiline private-image title opaque in every output path', () => {
    const body = [
      '![safe](g2o-image://img-1 "',
      neutralizedPlaceholder('missing', 'x'),
      '![remote](https://attacker.example/pixel)',
      '")',
    ].join('\n');
    const safe = neutralizeActiveProviderMarkdown(body, ['g2o-image://img-1']);
    expect(safe).toBe(body);

    const outputs = [
      stripImagePlaceholders(safe),
      resolveImagesForObsidianTail(safe, [img('img-1')], confirmedPaths).body,
      resolveImagesToConfirmedPaths(safe, [img('img-1')], confirmedPaths).body,
    ];
    for (const output of outputs) {
      const images = markdownNodes(output).filter(node => node.type === 'image');
      expect(output).toBe(body);
      expect(images.map(node => node.url)).toEqual(['g2o-image://img-1']);
      expect(images).not.toContainEqual(
        expect.objectContaining({ url: 'https://attacker.example/pixel' })
      );
    }
  });
});

describe.each([
  ['strip', (body: string) => stripImagePlaceholders(body)],
  ['append', (body: string) => resolveImagesForObsidianTail(body, [], confirmedPaths).body],
  [
    'confirmed paths',
    (body: string) => resolveImagesToConfirmedPaths(body, [], confirmedPaths).body,
  ],
] as const)('non-composing placeholder removal for %s', (_destination, removeImages) => {
  it('removes actual unordered and ordered list-only producer markers', () => {
    for (const html of [
      '<ul><li><img data-g2o-image="missing" alt="x"></li></ul>',
      '<ol><li><img data-g2o-image="missing" alt="x"></li></ol>',
      '<ul><li><blockquote><img data-g2o-image="missing" alt="x"></blockquote></li></ul>',
      '<blockquote><ul><li><blockquote><img data-g2o-image="missing" alt="x"></blockquote></li></ul></blockquote>',
      '<ol><li><blockquote><ul><li><img data-g2o-image="missing" alt="x"></li></ul></blockquote></li></ol>',
    ]) {
      const produced = htmlToMarkdown(html);
      const safe = neutralizeActiveProviderMarkdown(produced);
      expect(safe).toContain('&#33;&#91;x](g2o-image://missing)');

      const output = removeImages(safe);
      expect(output).not.toContain('g2o-image://');
      expect(markdownNodes(output).some(node => node.type === 'image')).toBe(false);
    }
  });

  it('cannot assemble a remote image in plain, blockquote, or callout Markdown', () => {
    const unsafe = `!${placeholder('missing', 'x')}[remote](https://attacker.example/pixel)`;
    for (const body of [unsafe, `> ${unsafe}`, `> [!NOTE]\n> ${unsafe}`]) {
      const safe = neutralizeActiveProviderMarkdown(body);
      expect(safe).toContain('&#33;&#91;x](g2o-image://missing)');

      const output = removeImages(safe);
      expect(markdownNodes(output).some(node => node.type === 'image')).toBe(false);
      expect(output).not.toContain('![remote]');
    }
  });

  it('cannot assemble an active raw img tag', () => {
    const body = `<im${neutralizedPlaceholder('missing', 'x')}g src="https://attacker.example/pixel">`;
    const output = removeImages(body);
    const template = document.createElement('template');
    template.innerHTML = output;

    expect(output).toBe(body);
    expect(template.content.querySelector('img')).toBeNull();
  });

  it('cannot expose a closing fence with active content after it', () => {
    const body = [
      '```',
      `${neutralizedPlaceholder('missing', 'x')}\`\`\``,
      '![remote](https://attacker.example/pixel)',
      '<img src="https://attacker.example/pixel">',
    ].join('\n');
    const output = removeImages(body);
    const nodes = markdownNodes(output);

    expect(output).toBe(body);
    expect(nodes.some(node => node.type === 'image')).toBe(false);
    expect(nodes.filter(node => node.type === 'html')).toEqual([]);
  });

  it('does not delete a protected placeholder because its own alt contains a boundary marker', () => {
    const body = [
      '```',
      `${neutralizedPlaceholder('missing', MESSAGE_BOUNDARY_MARKER)}\`\`\``,
      '![remote](https://attacker.example/pixel)',
    ].join('\n');
    const output = removeImages(body);
    expect(output).toBe(body.replace(MESSAGE_BOUNDARY_MARKER, '<!-- liska-message&#58;v1 -->'));
    expect(output).toContain('g2o-image://missing)```');
    expect(markdownNodes(output).some(node => node.type === 'image')).toBe(false);
    expect(markdownNodes(output).filter(node => node.type === 'html')).toEqual([]);
  });

  it('does not remove a marker from an opaque multiline link title', () => {
    const body = [
      MESSAGE_BOUNDARY_FORMAT_MARKER,
      '',
      MESSAGE_BOUNDARY_MARKER,
      '',
      '**DeepSeek:**',
      '',
      '[safe](https://example.com "',
      neutralizedPlaceholder('missing', 'x'),
      '![remote](https://attacker.example/pixel)',
      '")',
    ].join('\n');
    const before = markdownNodes(body);
    expect(before.some(node => node.type === 'image')).toBe(false);

    const output = removeImages(body);
    const after = markdownNodes(output);
    expect(output).toBe(body);
    expect(after.some(node => node.type === 'image')).toBe(false);
    expect(after.filter(node => node.type === 'html')).toHaveLength(2);
  });

  it('does not remove a marker from an opaque multiline reference title', () => {
    const body = [
      '[safe][ref]',
      '',
      '[ref]: https://example.com "',
      neutralizedPlaceholder('missing', 'x'),
      '![remote](https://attacker.example/pixel)',
      '"',
    ].join('\n');
    const output = removeImages(body);

    expect(output).toBe(body);
    expect(markdownNodes(output).some(node => node.type === 'image')).toBe(false);
  });

  it('does not remove a marker that overlaps a multiline inline-code range', () => {
    const body = [
      '&#33;&#91;x](g2o-image://missing`)',
      '![remote](https://attacker.example/pixel)',
      '`',
    ].join('\n');
    const before = markdownNodes(body);
    expect(before.some(node => node.type === 'image')).toBe(false);
    expect(before.some(node => node.type === 'inlineCode')).toBe(true);

    const output = removeImages(body);
    expect(output).toBe(body);
    expect(markdownNodes(output).some(node => node.type === 'image')).toBe(false);
  });

  it('keeps a whitespace-adjacent malformed tag inert', () => {
    const body = `<img${neutralizedPlaceholder('missing', 'x')} src="https://attacker.example/pixel">`;
    const output = removeImages(body);
    const template = document.createElement('template');
    template.innerHTML = output;

    expect(output).toBe(body);
    expect(template.content.querySelector('img')).toBeNull();
  });
});

describe('resolveImagesToConfirmedPaths', () => {
  it('replaces placeholders with explicit standard paths and lists referenced files', () => {
    const body = `intro\n\n${placeholder('img-1')}\n\nmid\n\n${placeholder('img-2')}`;
    const images = [img('img-1'), img('img-2', 'image/jpeg')];
    const { body: out, files } = resolveImagesToConfirmedPaths(body, images, confirmedPaths);

    expect(out).toContain(`](<${confirmedPaths.get('img-1')}>)`);
    expect(out).toContain(`](<${confirmedPaths.get('img-2')}>)`);
    expect(out).not.toContain('g2o-image://');
    expect(files).toEqual([
      { fileName: confirmedPaths.get('img-1'), mimeType: 'image/png', data: 'UE5H' },
      { fileName: confirmedPaths.get('img-2'), mimeType: 'image/jpeg', data: 'UE5H' },
    ]);
  });

  it('strips placeholders whose image failed to capture (no matching image)', () => {
    const body = `a\n\n${placeholder('img-1')}\n\nb`;
    const { body: out, files } = resolveImagesToConfirmedPaths(body, [], confirmedPaths);
    expect(out).not.toContain('g2o-image://');
    expect(files).toHaveLength(0);
  });

  it('neutralizes a boundary synthesized while resolving a missing image', () => {
    const body = [
      MESSAGE_BOUNDARY_FORMAT_MARKER,
      MESSAGE_BOUNDARY_MARKER,
      '<!-- liska-message![x](g2o-image://missing):v1 -->',
    ].join('\n');
    const { body: out } = resolveImagesToConfirmedPaths(body, [], confirmedPaths);
    expect(out).toContain('<!-- liska-message&#58;v1 -->');
    expect(out.split('\n').filter(line => line === MESSAGE_BOUNDARY_MARKER)).toHaveLength(1);
  });

  it.each([
    ['inline code', `\`${placeholder('img-1')}\``],
    ['fenced code', `\`\`\`\n${placeholder('img-1')}\n\`\`\``],
    ['raw HTML', `<span title="${placeholder('img-1')}">literal</span>`],
    ['link title', `[safe](https://example.com "${placeholder('img-1')}")`],
  ])('never activates a matching placeholder inside %s', (_label, body) => {
    const resolved = resolveImagesToConfirmedPaths(body, [img('img-1')], confirmedPaths);
    expect(resolved.files).toEqual([]);
    expect(resolved.body).not.toContain(confirmedPaths.get('img-1'));
  });

  it('does not derive a filename when image data has no confirmed destination', () => {
    const resolved = resolveImagesToConfirmedPaths(placeholder('img-1'), [img('img-1')], new Map());
    expect(resolved).toEqual({ body: '', files: [] });
  });

  it('keeps explicit destinations independent of source-array order', () => {
    const body = `${placeholder('img-1', 'cat')}\n${placeholder('img-2', 'dog')}`;
    const images = [img('img-1'), img('img-2', 'image/jpeg')];
    expect(resolveImagesToConfirmedPaths(body, images, confirmedPaths)).toEqual(
      resolveImagesToConfirmedPaths(body, [...images].reverse(), confirmedPaths)
    );
  });
});

describe('trusted append-tail image resolution', () => {
  const names = new Map([['img-1', `sha256-${'a'.repeat(64)}.png`]]);

  it('preserves real tail markers and deduplicates repeated active occurrences', () => {
    const body = [
      MESSAGE_BOUNDARY_MARKER,
      placeholder('img-1', 'first'),
      '',
      MESSAGE_BOUNDARY_MARKER,
      placeholder('img-1', 'second'),
    ].join('\n');

    expect(trustedTailImageIds(body)).toEqual(['img-1', 'img-1']);
    const resolved = resolveImagesForObsidianTail(body, [img('img-1')], names);
    expect(resolved.body.split(MESSAGE_BOUNDARY_MARKER)).toHaveLength(3);
    expect(resolved.body.match(/!\[\[sha256-/g)).toHaveLength(2);
    expect(resolved.files).toEqual([
      { fileName: `sha256-${'a'.repeat(64)}.png`, mimeType: 'image/png', data: 'UE5H' },
    ]);
  });

  it('ignores protected, inline, and neutralized lookalikes', () => {
    const body = [
      MESSAGE_BOUNDARY_MARKER,
      `\`${placeholder('img-1')}\``,
      `prefix ${placeholder('img-1')} suffix`,
      neutralizedPlaceholder('img-1'),
    ].join('\n');

    expect(trustedTailImageIds(body)).toEqual([]);
    const resolved = resolveImagesForObsidianTail(body, [img('img-1')], names);
    expect(resolved.files).toEqual([]);
    expect(resolved.body).not.toContain('![[sha256-');
    expect(resolved.body.split(MESSAGE_BOUNDARY_MARKER)).toHaveLength(2);
  });

  it('reports parser uncertainty instead of authorizing a tail image', () => {
    vi.mocked(fromMarkdown).mockImplementationOnce(() => {
      throw new Error('private-parser-detail');
    });
    expect(inspectTrustedTailImages(`${MESSAGE_BOUNDARY_MARKER}\n${placeholder('img-1')}`)).toEqual(
      {
        ids: [],
        parserFailed: true,
      }
    );
  });
});

describe('bounded private image parsing and scanning', () => {
  const parseBoundary = `${'a'.repeat(MARKDOWN_WORK_LIMITS.lineLength - 1)}\n`.repeat(16);

  it.each([
    ['input length', parseBoundary],
    ['physical line', 'a'.repeat(MARKDOWN_WORK_LIMITS.lineLength)],
    ['structural units', '*\n'.repeat(MARKDOWN_WORK_LIMITS.structuralUnits / 2)],
  ])('admits the exact %s boundary and rejects +1 before parsing', (_label, boundary) => {
    const parser = vi.mocked(fromMarkdown);
    parser.mockClear();
    parser.mockReturnValueOnce({ type: 'root', children: [] });
    expect(inspectImagePlaceholders(boundary)).toEqual({ ids: [], parserFailed: false });
    expect(parser).toHaveBeenCalledTimes(1);
    parser.mockClear();
    expect(inspectImagePlaceholders(`${boundary}*`)).toEqual({ ids: [], parserFailed: true });
    expect(parser).not.toHaveBeenCalled();
  });

  it('rejects a wide AST before iterating or pushing its children', () => {
    const children = new Array(MARKDOWN_WORK_LIMITS.traversalNodes);
    const iterate = vi.fn(() => {
      throw new Error('must not iterate oversized children');
    });
    Object.defineProperty(children, Symbol.iterator, { value: iterate });
    vi.mocked(fromMarkdown).mockReturnValueOnce({ type: 'root', children });
    expect(inspectImagePlaceholders(placeholder('img-1'))).toEqual({ ids: [], parserFailed: true });
    expect(iterate).not.toHaveBeenCalled();
  });

  it('merges nested and overlapping intervals before half-open binary lookup', () => {
    const ranges = imagePlaceholderInternals.merge([
      { start: 20, end: 30 },
      { start: 2, end: 20 },
      { start: 4, end: 6 },
      { start: 40, end: 50 },
      { start: 1, end: 3 },
    ]);
    expect(ranges).toEqual([
      { start: 1, end: 30 },
      { start: 40, end: 50 },
    ]);
    for (const [offset, length, expected] of [
      [0, 1, false],
      [0, 2, true],
      [1, 1, true],
      [29, 1, true],
      [30, 1, false],
      [30, 10, false],
      [30, 11, true],
      [50, 1, false],
      [2, 0, false],
    ] as const) {
      expect(
        imagePlaceholderInternals.overlaps(offset, length, ranges),
        `${offset}/${length}`
      ).toBe(expected);
    }
  });

  it.each([
    ['literal', '!['],
    ['neutralized', '&#33;&#91;'],
  ])('inspects malformed repeated %s openers only once per forward run', (_label, opener) => {
    const n = 10_000;
    const first = imagePlaceholderInternals.scan(opener.repeat(n));
    const second = imagePlaceholderInternals.scan(opener.repeat(2 * n));
    expect(first.occurrences).toEqual([]);
    expect(second.occurrences).toEqual([]);
    expect(first.inspections).toBeLessThanOrEqual(opener.length * n + 3);
    expect(second.inspections).toBeLessThanOrEqual(first.inspections * 2);
  });

  it('keeps scanner semantics for failed candidates, nested openers, barriers and adjacent markers', () => {
    const pattern = /(!\[|&#33;&#91;)([^\]$\r\n]*)\]\(g2o-image:\/\/([^)$\r\n]*)\)/g;
    const samples = [
      '![broken ![still broken',
      '![broken]wrong ![ok](g2o-image://good)',
      '![outer ![inner](g2o-image://id)',
      '![x](g2o-image://a![y](g2o-image://b)',
      '![bad$![good](g2o-image://id)',
      '![bad](g2o-image://$![good](g2o-image://id)',
      `${placeholder('a')}${neutralizedPlaceholder('b')}`,
      '![x\n![good](g2o-image://id)',
    ];
    for (const source of samples) {
      expect(imagePlaceholderInternals.scan(source).occurrences).toEqual(
        [...source.matchAll(pattern)].map(match => ({
          offset: match.index,
          end: match.index! + match[0].length,
          match: match[0],
          opener: match[1],
          alt: match[2],
          id: match[3],
        }))
      );
    }
  });

  it('checks a synthesized sentinel before protected-range behavior even after admission failure', () => {
    const malformed = '<!-- liska-message![x](g2o-image://missing):v1 -->';
    const body = `${'a'.repeat(MARKDOWN_WORK_LIMITS.lineLength + 1)}\n${malformed}`;
    expect(stripImagePlaceholders(body).endsWith('<!-- liska-message&#58;v1 -->')).toBe(true);
    expect(resolveImagesToConfirmedPaths(body, [img('img-1')], confirmedPaths).files).toEqual([]);
  });

  it('streams more occurrences than the bounded test-capture seam without retaining occurrence strings', () => {
    const source = '![](g2o-image://)'.repeat(MARKDOWN_WORK_LIMITS.edits + 1);
    let seen = 0;
    const scan = imagePlaceholderInternals.visit(source, span => {
      seen += 1;
      if (seen === 1) {
        expect(span).not.toHaveProperty('match');
        expect(span).not.toHaveProperty('alt');
        expect(span).not.toHaveProperty('id');
      }
    });
    expect(seen).toBe(MARKDOWN_WORK_LIMITS.edits + 1);
    expect(scan.count).toBe(seen);
    expect(scan.only).toBeNull();
    expect(scan).not.toHaveProperty('occurrences');
    expect(scan.inspections).toBeLessThanOrEqual(source.length * 2);
  });

  it('rewrites an admission-failed dense line without an occurrence array or asset authorization', () => {
    const source = neutralizedPlaceholder('missing', 'x').repeat(10_001);
    const parser = vi.mocked(fromMarkdown);
    parser.mockClear();
    expect(source.length).toBeGreaterThan(MARKDOWN_WORK_LIMITS.lineLength);
    expect(resolveImagesToConfirmedPaths(source, [img('img-1')], confirmedPaths)).toEqual({
      body: source,
      files: [],
    });
    expect(inspectImagePlaceholders(source)).toEqual({ ids: [], parserFailed: true });
    expect(parser).not.toHaveBeenCalled();
  });
});
