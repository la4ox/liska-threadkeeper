// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { PDF_FONT_MANIFEST } from '../../src/text-preview/pdf-contract';
import {
  PDF_EMOJI_RANGES,
  PDF_FONT_VFS,
  PDF_ROBOTO_RANGES,
  pdfHasGlyph,
  routePdfText,
  requirePdfGlyphs,
} from '../../src/text-preview/pdf-font';

function cmap(font: Buffer): Set<number> {
  const count = font.readUInt16BE(4);
  let offset = -1;
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    if (font.toString('ascii', at, at + 4) === 'cmap') offset = font.readUInt32BE(at + 8);
  }
  if (offset < 0) throw new Error('cmap missing');
  const found = new Set<number>();
  for (let i = 0; i < font.readUInt16BE(offset + 2); i++) {
    const record = offset + 4 + i * 8;
    const platform = font.readUInt16BE(record);
    if (platform !== 0 && platform !== 3) continue;
    const sub = offset + font.readUInt32BE(record + 4);
    const format = font.readUInt16BE(sub);
    if (format === 12) {
      for (let j = 0; j < font.readUInt32BE(sub + 12); j++) {
        const group = sub + 16 + j * 12;
        const start = font.readUInt32BE(group),
          end = font.readUInt32BE(group + 4);
        const glyph = font.readUInt32BE(group + 8);
        for (let cp = start; cp <= end; cp++) if (glyph + cp - start) found.add(cp);
      }
    }
    if (format === 4) {
      const segments = font.readUInt16BE(sub + 6) / 2;
      const ends = sub + 14,
        starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2,
        offsets = deltas + segments * 2;
      for (let j = 0; j < segments; j++) {
        const start = font.readUInt16BE(starts + j * 2),
          end = font.readUInt16BE(ends + j * 2);
        const delta = font.readInt16BE(deltas + j * 2),
          range = font.readUInt16BE(offsets + j * 2);
        for (let cp = start; cp <= end && cp < 0xffff; cp++) {
          const glyph = range
            ? font.readUInt16BE(offsets + j * 2 + range + (cp - start) * 2)
            : (cp + delta) & 0xffff;
          if (glyph && (!range || (glyph + delta) & 0xffff)) found.add(cp);
        }
      }
    }
  }
  return found;
}

describe('PDF pinned Roboto coverage', () => {
  it('derives the four-font intersection from exact cmap tables', () => {
    const names = [
      'Roboto-Regular.ttf',
      'Roboto-Medium.ttf',
      'Roboto-Italic.ttf',
      'Roboto-MediumItalic.ttf',
    ];
    const fonts = names.map(name => readFileSync(`node_modules/pdfmake/fonts/Roboto/${name}`));
    const sets = fonts.map(cmap);
    const points = [...sets[0]].filter(cp => sets.every(set => set.has(cp))).sort((a, b) => a - b);
    const ranges: number[][] = [];
    for (const cp of points) {
      const last = ranges[ranges.length - 1];
      if (last && last[1] + 1 === cp) last[1] = cp;
      else ranges.push([cp, cp]);
    }
    expect(ranges).toEqual(PDF_ROBOTO_RANGES);
    names.forEach((name, index) => {
      expect(createHash('sha256').update(fonts[index]).digest('hex')).toBe(
        PDF_FONT_MANIFEST[name as keyof typeof PDF_FONT_MANIFEST]
      );
      expect(Buffer.from(PDF_FONT_VFS[name] as string, 'base64')).toEqual(fonts[index]);
    });
    expect(points.length).toBeGreaterThan(500);
  });
  it('derives exact packaged Noto Emoji coverage and verifies its immutable inline bytes', () => {
    const fontkit = createRequire(import.meta.url)('fontkit');
    const bytes = readFileSync('src/text-preview/fonts/NotoEmoji-wght.ttf');
    const font = fontkit.create(bytes);
    const points = [...font.characterSet].sort((a: number, b: number) => a - b) as number[];
    const ranges: number[][] = [];
    for (const cp of points) {
      const last = ranges[ranges.length - 1];
      if (last && last[1] + 1 === cp) last[1] = cp;
      else ranges.push([cp, cp]);
    }
    expect(ranges).toEqual(PDF_EMOJI_RANGES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      PDF_FONT_MANIFEST['NotoEmoji.ttf']
    );
    expect(Buffer.from(PDF_FONT_VFS['NotoEmoji.ttf'] as string, 'base64')).toEqual(bytes);
    for (const text of ['❤️', '👨‍👩‍👧', '🇯🇵'])
      expect(font.layout(text).glyphs.length).toBeGreaterThan(0);
  });
  it('routes complete supported graphemes without silent tofu or foreign fallback', () => {
    expect(routePdfText('Привет Latin Ω')).toEqual([
      { text: 'Привет Latin Ω', font: 'Roboto', emojiClusters: 0 },
    ]);
    for (const emoji of ['♥', '❤️', '🦊', '😀', '👨‍👩‍👧']) {
      expect(routePdfText(emoji)).toEqual([
        { text: emoji, font: 'NotoEmoji', emojiClusters: 1, atomic: true },
      ]);
      expect(requirePdfGlyphs(emoji)).toBe([...emoji].length);
    }
    expect(routePdfText('Лис ♥ fox')).toEqual([
      { text: 'Лис ', font: 'Roboto', emojiClusters: 0 },
      { text: '♥', font: 'NotoEmoji', emojiClusters: 1, atomic: true },
      { text: ' fox', font: 'Roboto', emojiClusters: 0 },
    ]);
    for (const bad of ['漢字', '\ufe0f', '\u200d', 'A\ufe0f', '\u200dA'])
      expect(() => routePdfText(bad)).toThrow('pdf-font-unsupported');
    for (const bad of ['\0', '\ud800', '\uffff'])
      expect(() => routePdfText(bad)).toThrow('pdf-html-invalid');
    expect(pdfHasGlyph(0x2665)).toBe(false);
    expect(pdfHasGlyph(0x1f98a)).toBe(false);
    expect(routePdfText('e\u0301')).toEqual([
      { text: 'e\u0301', font: 'Roboto', emojiClusters: 0, atomic: true },
    ]);
    expect(() => routePdfText('🦊' + '\u200d🦊'.repeat(9))).toThrow('pdf-layout-overflow');
    expect(() => routePdfText('❤️', 1)).toThrow('pdf-layout-overflow');
    expect(() => routePdfText('e' + '\u0301'.repeat(16))).toThrow('pdf-layout-overflow');
  });
});
