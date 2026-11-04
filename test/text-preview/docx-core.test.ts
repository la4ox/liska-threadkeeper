// @vitest-environment node
import { fromBuffer } from 'yauzl';
import { JSDOM } from 'jsdom';
import { Packer } from 'docx';
import { describe, expect, it, vi } from 'vitest';
import {
  DOCX_LIMITS,
  DOCX_REQUEST_SCHEMA,
  snapshotDocxRequest,
  type DocxLimits,
} from '../../src/text-preview/docx-contract';
import { renderDocxRequest } from '../../src/text-preview/docx-core';
import { decodeDocxEntities, DocxHtmlBuilder } from '../../src/text-preview/docx-html';

const request = (
  htmlBody: string,
  limits: Partial<DocxLimits> = {},
  title: string | null = 'Title'
) =>
  snapshotDocxRequest({
    schema: DOCX_REQUEST_SCHEMA,
    operationToken: '12345678-1234-4234-8234-123456789abc',
    title,
    rows: [{ role: 'assistant', htmlBody }],
    limits: { ...DOCX_LIMITS, ...limits },
  });
async function unzip(bytes: ArrayBuffer): Promise<Map<string, string>> {
  return new Promise((resolve, reject) =>
    fromBuffer(Buffer.from(bytes), { lazyEntries: true }, (error, zip) => {
      if (error || !zip) {
        reject(error);
        return;
      }
      const files = new Map<string, string>();
      zip.on('error', reject);
      zip.on('end', () => resolve(files));
      zip.on('entry', entry => {
        if (entry.fileName.endsWith('/')) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) {
            reject(error);
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('error', reject);
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    })
  );
}
const parse = (xml: string) => new JSDOM(xml, { contentType: 'application/xml' }).window.document;
const textOf = (document: Document) =>
  [...document.getElementsByTagName('w:t')].map(node => node.textContent).join('');

describe('DOCX local safe-HTML semantics', () => {
  it('maps editable headings/runs/lists/quotes/code/placeholders and literal URLs, never external relationships', async () => {
    const body =
      '<h3>Heading 🦊</h3><p>Normal <strong>bold</strong> <em>italic</em> <code>inline()</code><br>next</p>' +
      '<ol start="7"><li><p>First</p><ul><li><p>Nested bullet</p></li></ul><p>Continuation</p></li><li><p>Second</p></li></ol>' +
      '<blockquote><p>Quote</p><blockquote><p>Nested quote</p></blockquote></blockquote>' +
      '<pre><code>  const x = &lt;tag&gt;;\n\tA &amp;amp; B</code></pre><hr>' +
      '<aside><p><a href="https://example.org/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">Source</a></p></aside>' +
      '<p class="placeholder">Attachment reference: cat [local bytes are not bound to this presentation]</p>' +
      '<p><span class="placeholder">[Image reference: cat; https://example.org/cat.png]</span> ' +
      '<span class="inert-html" aria-label="Inert provider HTML source">&lt;script&gt;literal&lt;/script&gt;</span></p>' +
      '<footer><p>Footer note</p></footer>';
    const result = await renderDocxRequest(request(body));
    const files = await unzip(result.bytes);
    const document = parse(files.get('word/document.xml')!);
    const text = textOf(document);
    for (const expected of [
      'Heading 🦊',
      'bold',
      'italic',
      'inline()',
      'Nested bullet',
      'Continuation',
      'Nested quote',
      '  const x = <tag>;',
      'A &amp; B',
      'Source (https://example.org/?a=1&b=2)',
      'Attachment reference: cat',
      '[Image reference: cat;',
      '<script>literal</script>',
      'Footer note',
    ])
      expect(text).toContain(expected);
    expect(document.getElementsByTagName('w:b').length).toBeGreaterThan(0);
    expect(document.getElementsByTagName('w:i').length).toBeGreaterThan(0);
    expect(document.getElementsByTagName('w:tab')).toHaveLength(1);
    expect(document.getElementsByTagName('w:br')).toHaveLength(2);
    expect(
      [...document.getElementsByTagName('w:pStyle')].map(node => node.getAttribute('w:val'))
    ).toContain('Heading3');
    expect(document.getElementsByTagName('w:numPr')).toHaveLength(3);
    const indents = [...document.getElementsByTagName('w:ind')].map(node =>
      node.getAttribute('w:left')
    );
    expect(indents).toContain('720');
    expect(indents).toContain('360');
    const numbering = parse(files.get('word/numbering.xml')!);
    expect(
      [...numbering.getElementsByTagName('w:start')].map(node => node.getAttribute('w:val'))
    ).toContain('7');
    expect(
      [...numbering.getElementsByTagName('w:numFmt')].map(node => node.getAttribute('w:val'))
    ).toEqual(expect.arrayContaining(['decimal', 'bullet']));
    expect(result.counts).toMatchObject({
      messageCount: 1,
      htmlChars: body.length,
      maxListDepth: 2,
      numberingDefinitions: 2,
      links: 1,
      placeholders: 2,
    });
    expect(result.counts.runs).toBe(document.getElementsByTagName('w:r').length);
    expect(result.counts.blocks).toBe(document.getElementsByTagName('w:p').length);
    expect(result.diagnostics).toEqual([
      { code: 'links-literalized', count: 1 },
      { code: 'placeholders-preserved', count: 2 },
    ]);
    for (const name of files.keys())
      expect(name).not.toMatch(/(?:media\/|embeddings\/|vbaProject|\.bin$)/i);
    for (const [name, xml] of files)
      if (name.endsWith('.xml') || name.endsWith('.rels'))
        expect(xml).not.toMatch(
          /TargetMode="External"|<w:(?:hyperlink|fldSimple|instrText|drawing|object|tbl)(?:\s|>)/
        );
    const properties = parse(files.get('docProps/core.xml')!);
    expect(properties.getElementsByTagName('dc:creator')[0].textContent).toBe('Liska Threadkeeper');
    expect(properties.getElementsByTagName('cp:lastModifiedBy')[0].textContent).toBe(
      'Liska Threadkeeper'
    );
  });
  it('preserves Unicode, decodes once and distinguishes normal whitespace from literal pre-wrap text', async () => {
    expect(decodeDocxEntities('&amp;lt;&lt;&gt;&quot;&#39;')).toBe('&lt;<>"\'');
    const builder = new DocxHtmlBuilder(DOCX_LIMITS);
    builder.body(
      '<p>  One \n <strong> two </strong>   three</p><p class="text">  一 🦊\n\t spaced  </p>'
    );
    expect(builder.paragraphs[0].runs.map(run => run.text).join('')).toBe('One two three');
    expect(builder.paragraphs[1].runs.map(run => (run.break ? '\n' : run.text)).join('')).toBe(
      '  一 🦊\n\t spaced  '
    );
    for (const title of ['', null, '<tag> & title\n🦊']) {
      const result = await renderDocxRequest(
        request('<p>literal &amp;lt; &quot;quote&quot; &#39;x&#39;</p>', {}, title)
      );
      expect(textOf(parse((await unzip(result.bytes)).get('word/document.xml')!))).toContain(
        'literal &lt; "quote" \'x\''
      );
    }
  });
  it('is semantically deterministic without promising volatile ZIP byte identity', async () => {
    const input = request('<p><strong>same</strong> 🦊</p><ol start="2"><li><p>two</p></li></ol>');
    const first = await renderDocxRequest(input);
    const second = await renderDocxRequest(input);
    const a = await unzip(first.bytes),
      b = await unzip(second.bytes);
    expect(first.counts).toEqual(second.counts);
    expect(a.get('word/document.xml')).toBe(b.get('word/document.xml'));
    expect(a.get('word/numbering.xml')).toBe(b.get('word/numbering.xml'));
  });
  it.each([
    '<script>bad</script>',
    '<img src="https://example.org/x">',
    '<table></table>',
    '<p onclick="x()">x</p>',
    '<p>open',
    '<a href="javascript:bad()" target="_blank" rel="noopener noreferrer">bad</a>',
    '<p><p>nested</p></p>',
    '<ul><p>not an item</p></ul>',
    '<li>orphan</li>',
    '<p>unknown &copy;</p>',
    '<p>bare &</p>',
    '<p>\u0000</p>',
    '<p>\ud800</p>',
  ])('rejects unsupported or malformed fragments atomically: %s', async body => {
    await expect(renderDocxRequest(request(body))).rejects.toThrow('docx-html-invalid');
  });
  it('never uses a DOM parser in the implementation', async () => {
    vi.stubGlobal(
      'DOMParser',
      class {
        constructor() {
          throw new Error('DOM forbidden');
        }
      }
    );
    try {
      expect((await renderDocxRequest(request('<p>safe</p>'))).bytes.byteLength).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('DOCX independent aggregate work and output bounds', () => {
  it.each([
    ['<p>x</p>', { maxTokens: 2 }, 'docx-token-limit'],
    ['<p><strong>x</strong></p>', { maxDepth: 1 }, 'docx-depth-limit'],
    ['<ul><li><p>x</p><ul><li>y</li></ul></li></ul>', { maxListDepth: 1 }, 'docx-list-depth-limit'],
    ['<p>x</p>', { maxBlocks: 3 }, 'docx-block-limit'],
    ['<p>x<strong>y</strong></p>', { maxRuns: 4 }, 'docx-run-limit'],
    ['<pre>\n\n\n</pre>', { maxRuns: 5 }, 'docx-run-limit'],
    [
      '<ul><li>x</li></ul><ol><li>y</li></ol>',
      { maxNumberingDefinitions: 1 },
      'docx-numbering-limit',
    ],
    ['<p>x</p>', { maxOutputBytes: 1 }, 'docx-output-limit'],
  ])('refuses the entire render at %s / %j', async (html, limits, code) => {
    await expect(
      renderDocxRequest(request(html as string, limits as Partial<DocxLimits>))
    ).rejects.toThrow(code as string);
  });
  it('keeps token/depth/block/run budgets aggregate rather than fresh per row', async () => {
    const one = await renderDocxRequest(request('<p>x</p>'));
    const input = request('<p>x</p>');
    const two = {
      ...input,
      rows: [input.rows[0], input.rows[0]],
      limits: { ...DOCX_LIMITS, maxTokens: one.counts.tokens },
    };
    await expect(renderDocxRequest(two)).rejects.toThrow('docx-token-limit');
    const at = await renderDocxRequest(
      request('<p>x</p>', {
        maxTokens: one.counts.tokens,
        maxDepth: one.counts.maxDepth,
        maxBlocks: one.counts.blocks,
        maxRuns: one.counts.runs,
      })
    );
    expect(at.counts).toEqual(one.counts);
    // ZIP timestamps are volatile; exercise exact output-byte edges at the pack seam.
    const pack = vi.spyOn(Packer, 'toArrayBuffer').mockResolvedValue(new ArrayBuffer(16));
    try {
      expect(
        (await renderDocxRequest(request('<p>x</p>', { maxOutputBytes: 16 }))).bytes.byteLength
      ).toBe(16);
      await expect(renderDocxRequest(request('<p>x</p>', { maxOutputBytes: 15 }))).rejects.toThrow(
        'docx-output-limit'
      );
      pack.mockRejectedValueOnce(new Error('private pack internals'));
      await expect(renderDocxRequest(request('<p>x</p>'))).rejects.toThrow('docx-pack-failed');
    } finally {
      pack.mockRestore();
    }
  });
});
