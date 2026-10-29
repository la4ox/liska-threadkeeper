import { describe, it, expect } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { neutralizeActiveProviderMarkdown } from '../../src/content/markdown-safety';
import { htmlToMarkdown } from '../../src/content/markdown-rules';
import {
  imageFileName,
  stripImagePlaceholders,
  resolveImagesForFile,
  resolveImagesForObsidian,
} from '../../src/lib/image-output';
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

describe('imageFileName', () => {
  it('builds a deterministic name from note base, index and extension', () => {
    expect(imageFileName('my-note', img('img-1'), 0)).toBe('my-note-img-1.png');
    expect(imageFileName('my-note', img('img-2', 'image/jpeg'), 1)).toBe('my-note-img-2.jpg');
  });

  it('falls back to png for unknown MIME types', () => {
    expect(imageFileName('n', img('img-1', 'application/octet-stream'), 0)).toBe('n-img-1.png');
  });
});

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
  ['Obsidian', resolveImagesForObsidian],
  ['File', resolveImagesForFile],
] as const)('neutralized image placeholders for %s', (_destination, resolveImages) => {
  it('strips a failed-image placeholder while resolving the successful image', () => {
    const body = `${placeholder('img-1', 'cat')}\n\n${neutralizedPlaceholder('img-2', 'lost')}`;
    const { body: out, files } = resolveImages(body, [img('img-1')], 'base');

    expect(out).not.toContain('g2o-image://');
    expect(out).not.toContain('lost');
    expect(out).toContain('base-img-1.png');
    expect(files).toEqual([{ fileName: 'base-img-1.png', mimeType: 'image/png', data: 'UE5H' }]);
  });

  it('never reactivates a neutralized placeholder even when its image id exists', () => {
    const { body, files } = resolveImages(neutralizedPlaceholder('img-1'), [img('img-1')], 'base');
    expect(body).toBe('');
    expect(files).toEqual([]);
  });

  it('does not resolve a placeholder composed by removing a neutralized placeholder', () => {
    const body = `![cat](${neutralizedPlaceholder('missing')}g2o-image://img-1)`;
    const safe = neutralizeActiveProviderMarkdown(body);
    const result = resolveImages(safe, [img('img-1')], 'base');
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
    const { body: out } = resolveImages(body, [], 'base');

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
      resolveImagesForObsidian(safe, [img('img-1')], 'base').body,
      resolveImagesForFile(safe, [img('img-1')], 'base').body,
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
  ['Obsidian', (body: string) => resolveImagesForObsidian(body, [], 'base').body],
  ['File', (body: string) => resolveImagesForFile(body, [], 'base').body],
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

describe('resolveImagesForObsidian', () => {
  it('replaces placeholders with wikilink embeds and lists files to write', () => {
    const body = `intro\n\n${placeholder('img-1')}\n\nmid\n\n${placeholder('img-2')}`;
    const images = [img('img-1'), img('img-2', 'image/jpeg')];
    const { body: out, files } = resolveImagesForObsidian(body, images, 'note-base');

    expect(out).toContain('![[note-base-img-1.png]]');
    expect(out).toContain('![[note-base-img-2.jpg]]');
    expect(out).not.toContain('g2o-image://');
    expect(files).toEqual([
      { fileName: 'note-base-img-1.png', mimeType: 'image/png', data: 'UE5H' },
      { fileName: 'note-base-img-2.jpg', mimeType: 'image/jpeg', data: 'UE5H' },
    ]);
  });

  it('strips placeholders whose image failed to capture (no matching image)', () => {
    const body = `a\n\n${placeholder('img-1')}\n\nb`;
    const { body: out, files } = resolveImagesForObsidian(body, [], 'base');
    expect(out).not.toContain('g2o-image://');
    expect(files).toHaveLength(0);
  });

  it('neutralizes a boundary synthesized while resolving a missing image', () => {
    const body = [
      MESSAGE_BOUNDARY_FORMAT_MARKER,
      MESSAGE_BOUNDARY_MARKER,
      '<!-- liska-message![x](g2o-image://missing):v1 -->',
    ].join('\n');
    const { body: out } = resolveImagesForObsidian(body, [], 'base');
    expect(out).toContain('<!-- liska-message&#58;v1 -->');
    expect(out.split('\n').filter(line => line === MESSAGE_BOUNDARY_MARKER)).toHaveLength(1);
  });
});

describe('resolveImagesForFile', () => {
  it('replaces placeholders with filename-only markdown links and lists files', () => {
    const body = `${placeholder('img-1', 'cat')}`;
    const { body: out, files } = resolveImagesForFile(body, [img('img-1')], 'note-base');
    expect(out).toContain('![cat](note-base-img-1.png)');
    expect(out).not.toContain('g2o-image://');
    expect(files).toEqual([
      { fileName: 'note-base-img-1.png', mimeType: 'image/png', data: 'UE5H' },
    ]);
  });

  it('neutralizes a boundary synthesized while resolving a missing image', () => {
    const body = [
      MESSAGE_BOUNDARY_FORMAT_MARKER,
      MESSAGE_BOUNDARY_MARKER,
      '<!-- liska-message![x](g2o-image://missing):v1 -->',
    ].join('\n');
    const { body: out } = resolveImagesForFile(body, [], 'base');
    expect(out).toContain('<!-- liska-message&#58;v1 -->');
    expect(out.split('\n').filter(line => line === MESSAGE_BOUNDARY_MARKER)).toHaveLength(1);
  });
});
