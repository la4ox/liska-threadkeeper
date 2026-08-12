/**
 * Fitness function: public English and Japanese documentation keep the
 * release-critical image and output claims in sync.
 *
 * This intentionally checks only the claims that have drifted before. It does
 * not attempt to prove that either document is a complete translation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');

const read = (relativePath: string): string =>
  fs.readFileSync(path.join(root, relativePath), 'utf-8');

const readmes = {
  en: {
    file: 'README.md',
    optionalImage:
      /(?:optional).{0,20}(?:attachment|image)s?|(?:attachment|image)s?.{0,20}optional/i,
    imageWord: /image/i,
  },
  ja: {
    file: 'README.ja.md',
    optionalImage:
      /(?:オプション|任意).{0,20}(?:添付|画像)|(?:添付|画像).{0,20}(?:オプション|任意)/,
    imageWord: /画像/,
  },
} as const;

const storeDescriptions = {
  en: {
    file: 'docs/store/description_en.md',
    outputs: [/Obsidian/i, /(?:Markdown|\.md)/i, /clipboard/i],
    legacyObsidianOnly: /Your conversations go only to your own Obsidian vault/i,
  },
  ja: {
    file: 'docs/store/description_ja.md',
    outputs: [/Obsidian/i, /(?:Markdown|ファイル)/i, /クリップボード/],
    legacyObsidianOnly: /会話の送信先はあなた自身の Obsidian vault のみ/,
  },
} as const;

function imageCapsLine(text: string, imageWord: RegExp): string | undefined {
  return text.split(/\r?\n/).find(line => {
    return (
      imageWord.test(line) &&
      /\b20\b/.test(line) &&
      /10\s*MiB/i.test(line) &&
      /48\s*MiB/i.test(line)
    );
  });
}

function bulletCount(text: string): number {
  return text.split(/\r?\n/).filter(line => line.trimStart().startsWith('•')).length;
}

describe('architecture: public documentation parity', () => {
  it.each(Object.entries(readmes))(
    '%s README states the image caps and optional image feature',
    (locale, spec) => {
      const text = read(spec.file);
      expect(
        imageCapsLine(text, spec.imageWord),
        `${locale} README must state 20 images, 10 MiB per image, and 48 MiB per note`
      ).toBeDefined();
      expect(text, `${locale} README must mention optional image/attachment export`).toMatch(
        spec.optionalImage
      );
    }
  );

  it.each(Object.entries(storeDescriptions))(
    '%s store description names all three local outputs and not the legacy Obsidian-only claim',
    (locale, spec) => {
      const text = read(spec.file);
      for (const output of spec.outputs) {
        expect(text, `${locale} store description is missing a local output`).toMatch(output);
      }
      expect(text, `${locale} store description still has the Obsidian-only claim`).not.toMatch(
        spec.legacyObsidianOnly
      );
    }
  );

  it('EN and JA store descriptions have the same number of bullet lines', () => {
    const enBullets = bulletCount(read(storeDescriptions.en.file));
    const jaBullets = bulletCount(read(storeDescriptions.ja.file));

    expect(enBullets).toBeGreaterThan(0);
    expect(jaBullets).toBe(enBullets);
  });
});
