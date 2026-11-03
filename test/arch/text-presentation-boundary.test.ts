import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => fs.readFileSync(path, 'utf8');

describe('architecture: canonical plain-text presentation boundary', () => {
  it('derives from archive presentation only, never legacy Markdown or an extractor', () => {
    const renderer = read('src/archive/presentation/text.ts');
    const preparation = read('src/content/derived-text-presentation.ts');
    expect(renderer).toContain("from '../types'");
    expect(renderer).not.toMatch(/from ['"].*markdown/i);
    expect(renderer).not.toMatch(/from ['"].*extractor/i);
    expect(preparation).toContain('renderArchiveText');
    expect(preparation).not.toMatch(/from ['"].*markdown/i);
    expect(preparation).not.toMatch(/from ['"].*extractor/i);
  });

  it('keeps the v1 background contract File-only and separate from HTML', () => {
    const persistence = read('src/content/derived-text-persistence.ts');
    const validation = read('src/background/derived-text-validation.ts');
    expect(persistence).toContain("action: 'persistDerivedTextPresentation'");
    expect(persistence).toContain("outputs: ['file']");
    expect(validation).toContain("item.value === 'file'");
    expect(persistence).not.toContain('persistDerivedHtmlPresentation');
  });
});
