import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(file, 'utf8');
function dependencyClosure(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const source = ts.createSourceFile(entry, read(entry), ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const clause = statement.importClause;
    if (clause?.isTypeOnly) continue;
    const bindings = clause?.namedBindings;
    if (
      !clause?.name &&
      bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.every(item => item.isTypeOnly)
    )
      continue;
    const imported = statement.moduleSpecifier.text;
    if (!imported.startsWith('.')) continue;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(entry), imported));
    const file = fs.existsSync(`${base}.ts`) ? `${base}.ts` : `${base}/index.ts`;
    dependencyClosure(file, seen);
  }
  return seen;
}

describe('Selected reading preview page isolation and build registration', () => {
  it('has a fixed Vite HTML entry and no content in its URL or persistence', () => {
    expect(read('vite.config.ts')).toContain(
      "textPreview: resolve(import.meta.dirname, 'src/text-preview/text-preview.html')"
    );
    expect(read('src/text-preview/text-preview.html')).toContain('src="index.ts"');
    expect(read('src/text-preview/index.ts')).toContain('void initTextPreview()');
    for (const file of ['page', 'protocol', 'download']) {
      const source = read(`src/text-preview/${file}.ts`);
      expect(source).not.toMatch(
        /\b(?:localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|console)\b|chrome\.storage|data:text|innerHTML|outerHTML|insertAdjacentHTML/
      );
      expect(source).not.toMatch(
        /URLSearchParams|\.searchParams\.(?:append|set)|window\.location\s*=/
      );
    }
    expect(read('src/text-preview/download.ts')).toContain('new Blob([artifact.content]');
    expect(read('src/text-preview/page.ts')).toContain('resolvePresentationPreviewRange(');
    expect(read('src/text-preview/page.ts')).toContain('createPresentationSelection(preview, ids)');
    expect(read('src/text-preview/page.ts')).toContain(
      'renderPresentationSelection(preview, snapshot, format)'
    );
    expect(read('src/text-preview/page.ts')).toContain('text.textContent = row.presentedText');
    expect(read('src/text-preview/page.ts')).not.toMatch(
      /\.htmlBody\b|DOMParser|createContextualFragment/
    );
  });
  it('imports no settings, providers, persistence, background or content controllers', () => {
    const files = [...dependencyClosure('src/text-preview/index.ts')];
    expect(files.length).toBeGreaterThan(5);
    expect(files).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/src\/(?:background|content|popup|platforms)\//),
      ])
    );
    expect(files).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/(?:obsidian|settings|persistence|storage|capture)/i),
      ])
    );
    expect(files).toContain('src/archive/presentation/text-preview-selection.ts');
    expect(files).toContain('src/archive/presentation/text.ts');
    expect(files).toContain('src/archive/presentation/preview.ts');
    expect(files).toContain('src/archive/presentation/selected.ts');
    for (const file of files)
      expect(read(file)).not.toMatch(
        /\b(?:localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|console)\b|chrome\.storage|data:text|innerHTML|outerHTML|insertAdjacentHTML/
      );
  });
  it('keeps the popup preview branch controls separate and does not open a page or export on its own', () => {
    const popup = read('src/text-preview/popup.ts');
    expect(popup).toContain('getTextPreviewBranchOptions');
    expect(popup).not.toContain('getTextPreviewStatus');
    expect(popup).not.toMatch(/chrome\.storage|chrome\.tabs\.create|chrome\.windows\.create/);
    const html = read('src/popup/index.html');
    for (const id of ['previewCurrent', 'previewSelected', 'previewBranches', 'exportBranches'])
      expect(html).toContain(`id="${id}"`);
  });
});
