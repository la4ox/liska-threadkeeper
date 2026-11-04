// @vitest-environment node
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import pdfMake from 'pdfmake/build/pdfmake';
import {
  PDF_LIMITS,
  PDF_REQUEST_SCHEMA,
  snapshotPdfRequest,
  type PdfLimits,
} from '../../src/text-preview/pdf-contract';
import { renderPdfRequest } from '../../src/text-preview/pdf-core';
import { decodePdfEntities, PdfHtmlBuilder } from '../../src/text-preview/pdf-html';

const request = (
  htmlBody: string,
  limits: Partial<PdfLimits> = {},
  title: string | null = 'Заголовок ♥'
) =>
  snapshotPdfRequest({
    schema: PDF_REQUEST_SCHEMA,
    operationToken: '12345678-1234-4234-8234-123456789abc',
    title,
    rows: [{ role: 'assistant', htmlBody }],
    limits: { ...PDF_LIMITS, ...limits },
  });
async function inspect(bytes: ArrayBuffer) {
  const task = getDocument({
    data: new Uint8Array(bytes.slice(0)),
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    fontExtraProperties: true,
  });
  const pdf = await task.promise;
  const pages: string[] = [],
    fonts = new Set<string>();
  const textBounds: { page: number; left: number; right: number; pageWidth: number }[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items)
      if ('str' in item && item.str) {
        textBounds.push({
          page: i,
          left: item.transform[4],
          right: item.transform[4] + item.width,
          pageWidth: page.view[2] - page.view[0],
        });
      }
    pages.push(
      content.items
        .filter(item => 'str' in item)
        .map(
          item => ('str' in item ? item.str : '') + ('hasEOL' in item && item.hasEOL ? '\n' : '')
        )
        .join('')
    );
    await page.getOperatorList();
    for (const key of Object.keys(content.styles)) {
      const font = page.commonObjs.get(key);
      expect(font.missingFile).toBe(false);
      expect(font.data.byteLength).toBeGreaterThan(100);
      const embedded = createRequire(import.meta.url)('fontkit').create(Buffer.from(font.data));
      fonts.add(embedded.postscriptName);
    }
  }
  const metadata = await pdf.getMetadata();
  const count = pdf.numPages;
  await task.destroy();
  return { pages, fonts: [...fonts], count, metadata, textBounds };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('PDF local bounded semantic rendering', () => {
  it('embeds Cyrillic and monochrome emoji fonts in a parseable selectable PDF', async () => {
    const body =
      '<h3>Кириллица ♥ ❤️ 🦊</h3><p>Normal <strong>bold</strong> <em>italic</em> <code>inline()</code><br>next</p>' +
      '<ol start="7"><li><p>First</p><ul><li><p>Nested bullet</p></li></ul><p>Continuation</p></li><li><p>Second</p></li></ol>' +
      '<blockquote><p>Quote</p></blockquote><pre><code>  const x = &lt;tag&gt;;\n\tA &amp;amp; B</code></pre><hr>' +
      '<aside><p><a href="https://example.org/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">Source</a></p></aside>' +
      '<p class="placeholder">Attachment reference: cat [local bytes not bound]</p>' +
      '<p><span class="inert-html" aria-label="Inert provider HTML source">&lt;script&gt;literal&lt;/script&gt;</span></p><footer><p>Footnote</p></footer>';
    const result = await renderPdfRequest(request(body));
    const parsed = await inspect(result.bytes);
    expect(parsed.count).toBe(result.pageCount);
    const text = parsed.pages.join('\n');
    for (const part of [
      'Кириллица',
      '♥',
      '❤',
      '🦊',
      'bold',
      'italic',
      'inline()',
      '7. First',
      '• Nested bullet',
      '8. Second',
      'Continuation',
      'Quote',
      'const x = <tag>;',
      'A &amp; B',
      'Source (https://example.org/?a=1&b=2)',
      'Attachment reference: cat',
      '<script>literal</script>',
      'Footnote',
    ])
      expect(text).toContain(part);
    expect(text).not.toContain('\0');
    expect(result.counts).toMatchObject({
      messageCount: 1,
      htmlChars: body.length,
      maxListDepth: 2,
      links: 1,
      placeholders: 1,
      tabs: 1,
      emojiClusters: 4,
    });
    expect(parsed.metadata.info).toMatchObject({
      Author: 'Liska Threadkeeper',
      Creator: 'Liska Threadkeeper',
      Producer: 'Liska Threadkeeper',
    });
    expect(parsed.fonts).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Roboto'),
        expect.stringContaining('NotoEmoji'),
      ])
    );
    expect(new TextDecoder('latin1').decode(result.bytes)).not.toMatch(
      /\/Subtype\s*\/Image|\/JavaScript|\/URI|\/EmbeddedFile/
    );
  });
  it('preserves generated literal whitespace, decodes once, and routes fonts before allocation', () => {
    expect(decodePdfEntities('&amp;lt;&lt;&gt;&quot;&#39;')).toBe('&lt;<>"\'');
    const b = new PdfHtmlBuilder(PDF_LIMITS);
    b.body('<p>  One \n <strong> two </strong>   three</p><p class="text">  Я ♥\n\t spaced  </p>');
    expect(b.paragraphs[0].runs.map(r => r.text).join('')).toBe('One two three');
    expect(b.paragraphs[1].runs.map(r => r.text).join('')).toBe('  Я ♥\n     spaced  ');
    expect(b.paragraphs[1].runs.some(r => r.font === 'NotoEmoji')).toBe(true);
    expect(b.counts.emojiClusters).toBe(1);
  });
  it('produces deterministic bytes under the fixed metadata/layout/font profile', async () => {
    const input = request('<p>same Кириллица ♥</p><ol start="2"><li>two</li></ol>');
    const a = await renderPdfRequest(input),
      b = await renderPdfRequest(input);
    expect(a.counts).toEqual(b.counts);
    expect(Buffer.from(a.bytes)).toEqual(Buffer.from(b.bytes));
  });
  it('uses the buffer-only path behind a deny-all URL policy without invoking fetch', async () => {
    const fetch = vi.fn(() => {
      throw new Error('network helper must remain unreachable');
    });
    vi.stubGlobal('fetch', fetch);
    const policy = vi.spyOn(pdfMake, 'setUrlAccessPolicy');
    const result = await renderPdfRequest(request('<p>Local text only Я ♥</p>'));
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(policy).toHaveBeenCalledTimes(1);
    expect(policy.mock.calls[0][0]?.('https://example.invalid/resource')).toBe(false);
  });
  it('paginates long selected text, reports the parser-confirmed count and refuses the entire page overflow', async () => {
    const html =
      '<p class="text">' +
      Array.from(
        { length: 110 },
        (_, i) => `Строка ${i} с текстом для проверяемого переноса.`
      ).join('\n') +
      '</p>';
    const result = await renderPdfRequest(request(html));
    const parsed = await inspect(result.bytes);
    expect(result.pageCount).toBeGreaterThan(1);
    expect(parsed.count).toBe(result.pageCount);
    expect(parsed.pages.join('\n')).toContain('Строка 109');
    await expect(renderPdfRequest(request(html, { maxPages: 1 }))).rejects.toThrow(
      'pdf-page-limit'
    );
  });
  it.each([
    '<script>x</script>',
    '<table></table>',
    '<img src="x">',
    '<p onclick="x()">x</p>',
    '<p>open',
    '<p><p>nested</p></p>',
    '<ul><p>bad</p></ul>',
    '<li>orphan</li>',
    '<pre><em>bad</em></pre>',
    '<p>&copy;</p>',
    '<p>bare &</p>',
    '<p>\u0000</p>',
    '<p>\ud800</p>',
  ])('refuses malformed or unsupported input atomically: %s', async html => {
    await expect(renderPdfRequest(request(html))).rejects.toThrow('pdf-html-invalid');
  });
  it('refuses unsupported glyphs rather than silently losing CJK or unrelated joiners', async () => {
    for (const html of ['<p>漢字</p>', '<p>A\ufe0f</p>', '<p>\u200d</p>'])
      await expect(renderPdfRequest(request(html))).rejects.toThrow('pdf-font-unsupported');
    await expect(renderPdfRequest(request('<p>supported</p>', {}, '漢'))).rejects.toThrow(
      'pdf-font-unsupported'
    );
  });
  it('keeps supported multi-code-point clusters atomic and refuses oversized graphemes before PDF allocation', async () => {
    const result = await renderPdfRequest(request('<p>❤️ e\u0301</p>'));
    const parsed = await inspect(result.bytes);
    expect(parsed.pages.join('\n')).toContain('e\u0301');
    expect(parsed.pages.join('\n')).not.toContain('\0');
    const pack = vi.spyOn(pdfMake, 'createPdf');
    await expect(
      renderPdfRequest(request('<p>' + '🦊' + '\u200d🦊'.repeat(9) + '</p>'))
    ).rejects.toThrow('pdf-layout-overflow');
    await expect(
      renderPdfRequest(request('<p>❤️</p>', { maxAtomicGraphemeCodePoints: 1 }, 'Title'))
    ).rejects.toThrow('pdf-layout-overflow');
    expect(pack).not.toHaveBeenCalled();
  });
  it.each(['👨‍👩‍👧', '🇯🇵'])('embeds supported emoji cluster %s', async text => {
    const result = await renderPdfRequest(request('<p>' + text + '</p>'));
    const parsed = await inspect(result.bytes);
    expect(parsed.pages.join('\n')).toContain(text);
    expect(parsed.pages.join('\n')).not.toContain('\0');
  });
  it.each([
    ['<p>x</p>', { maxTokens: 2 }, 'pdf-token-limit'],
    ['<p><strong>x</strong></p>', { maxDepth: 1 }, 'pdf-depth-limit'],
    ['<ul><li><p>x</p><ul><li>y</li></ul></li></ul>', { maxListDepth: 1 }, 'pdf-list-depth-limit'],
    ['<p>x</p>', { maxCodePoints: 5 }, 'pdf-code-point-limit'],
    ['<p>x</p>', { maxBlocks: 3 }, 'pdf-block-limit'],
    ['<p>x<strong>y</strong></p>', { maxRuns: 4 }, 'pdf-run-limit'],
    ['<p>x</p>', { maxLayoutNodes: 4 }, 'pdf-layout-node-limit'],
    ['<pre>12345</pre>', { maxPreCodePoints: 4 }, 'pdf-pre-limit'],
    ['<pre>12345\n12</pre>', { maxPreLineCodePoints: 4 }, 'pdf-pre-line-limit'],
    ['<p>x</p>', { maxOutputBytes: 1 }, 'pdf-output-limit'],
  ])('enforces independent cumulative ceilings for %s / %j', async (html, limits, code) => {
    await expect(
      renderPdfRequest(request(html as string, limits as Partial<PdfLimits>))
    ).rejects.toThrow(code as string);
  });
  it('accounts aggregate budgets across rows and refuses pack failures with fixed errors', async () => {
    const one = await renderPdfRequest(request('<p>x</p>'));
    const input = request('<p>x</p>');
    await expect(
      renderPdfRequest({
        ...input,
        rows: [...input.rows, ...input.rows],
        limits: { ...PDF_LIMITS, maxTokens: one.counts.tokens },
      })
    ).rejects.toThrow('pdf-token-limit');
    const pack = vi.spyOn(pdfMake, 'createPdf').mockImplementation(() => {
      throw new Error('private packing details');
    });
    await expect(renderPdfRequest(input)).rejects.toThrow('pdf-pack-failed');
    pack.mockRestore();
  });
  it('counts physical line layout cumulatively and keeps source tab stops independent from list markers', () => {
    const builder = new PdfHtmlBuilder(PDF_LIMITS);
    builder.body('<ol start="9007199254740991"><li><pre>\tx</pre></li></ol>');
    expect(builder.paragraphs[0].runs.map(run => run.text).join('')).toBe(
      '9007199254740991.     x'
    );
    expect(() => builder.body('<ol start="9007199254740991"><li>x</li><li>y</li></ol>')).toThrow(
      'pdf-html-invalid'
    );
    expect(() =>
      new PdfHtmlBuilder({ ...PDF_LIMITS, maxLayoutNodes: 3 }).body('<p class="text">\n\n\n\n</p>')
    ).toThrow('pdf-layout-node-limit');
  });
  it('hard-wraps near-limit unbroken Roboto pre lines and long literal URLs within the A4 content box', async () => {
    const pre = 'W'.repeat(PDF_LIMITS.maxPreLineCodePoints);
    const url = 'https://example.org/' + 'Q'.repeat(6000);
    const body =
      '<pre><code>' +
      pre +
      '</code></pre><p><a href="' +
      url +
      '" target="_blank" rel="noopener noreferrer">Long URL</a> 🦊 e\u0301</p>';
    const result = await renderPdfRequest(request(body));
    const parsed = await inspect(result.bytes);
    expect(parsed.count).toBe(result.pageCount);
    expect(parsed.count).toBeGreaterThan(1);
    expect(parsed.textBounds.length).toBeGreaterThan(50);
    for (const box of parsed.textBounds) {
      expect(box.left).toBeGreaterThanOrEqual(48 - 0.01);
      expect(box.right).toBeLessThanOrEqual(box.pageWidth - 48 + 0.01);
    }
    const text = parsed.pages.join('\n');
    expect(text.match(/W/g)).toHaveLength(pre.length);
    expect(text.match(/Q/g)).toHaveLength(6000);
    expect(text.replace(/\s/g, '')).toContain(url);
    expect(text).toContain('🦊');
    expect(text).toContain('e\u0301');
    expect(text).not.toContain('\0');
  });
});
