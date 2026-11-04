import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { COPY } from '../../../src/resumability-journal/page/text';
const root = path.resolve(import.meta.dirname, '../../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const ALLOWED_CHROME = [
  'chrome.i18n.getMessage',
  'chrome.i18n.getUILanguage',
  'chrome.runtime.lastError',
  'chrome.downloads.download',
  'chrome.downloads.search',
  'chrome.downloads.onChanged.addListener',
  'chrome.downloads.onChanged.removeListener',
];
function member(node: ts.Node): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return `${member(node.expression)}.${node.name.text}`;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression))
    return `${member(node.expression)}.${node.argumentExpression.text}`;
  return '';
}
describe('journal private page architecture', () => {
  it('has a private build entry, no network CSP and a static Settings > Archive Tools link', () => {
    const html = read('src/resumability-journal/page/journal.html');
    for (const directive of [
      "default-src 'none'",
      "connect-src 'none'",
      "object-src 'none'",
      "form-action 'none'",
      "worker-src 'none'",
    ])
      expect(html).toContain(directive);
    expect(html).toContain('src="entry.ts"');
    expect(html).not.toContain('webkitdirectory');
    expect(read('vite.config.ts')).toContain('src/resumability-journal/page/journal.html');
    expect(read('src/popup/index.html')).toMatch(
      /class="section archive-tools"[\s\S]*href="\.\.\/resumability-journal\/page\/journal\.html"\s+target="_blank"\s+rel="noopener"/u
    );
    expect(read('src/manifest.json')).not.toContain('resumability-journal');
  });
  it('closes imports over only journal/catalog code and permits only dedicated IDB + private downloads', () => {
    const pending = ['src/resumability-journal/page/entry.ts'];
    const visited = new Set<string>();
    while (pending.length) {
      const file = pending.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      expect(file).toMatch(/^src\/(?:resumability-journal\/(?:core|idb|page)|archive\/catalog)\//u);
      const source = read(file);
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier
        ) {
          if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return;
          if (ts.isExportDeclaration(node) && node.isTypeOnly) return;
          expect(ts.isStringLiteralLike(node.moduleSpecifier)).toBe(true);
          const reference = (node.moduleSpecifier as ts.StringLiteralLike).text;
          expect(reference.startsWith('.')).toBe(true);
          const base = path.posix.join(path.posix.dirname(file), reference);
          const target = [base + '.ts', base + '/index.ts', base].find(value =>
            existsSync(path.join(root, value))
          );
          expect(target).toBeDefined();
          if (target?.endsWith('.ts')) pending.push(target);
        }
        if (ts.isCallExpression(node))
          expect(node.expression.kind).not.toBe(ts.SyntaxKind.ImportKeyword);
        if (ts.isIdentifier(node)) {
          expect(node.text).not.toMatch(
            /^(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|showDirectoryPicker|showOpenFilePicker|showSaveFilePicker|createWritable|removeEntry|getDirectory|getFileHandle)$/u
          );
          if (node.text === 'indexedDB') expect(file).toMatch(/^src\/resumability-journal\/idb\//u);
        }
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
          const chain = member(node);
          if (chain.startsWith('chrome.'))
            expect(
              ALLOWED_CHROME.some(value => value === chain || value.startsWith(chain + '.'))
            ).toBe(true);
          expect(chain).not.toMatch(/^(?:navigator\.storage|console\.|.*\.innerHTML$)/u);
        }
        ts.forEachChild(node, visit);
      }
      visit(tree);
    }
    expect(visited.has('src/resumability-journal/idb/index.ts')).toBe(true);
    expect(visited.has('src/resumability-journal/core/index.ts')).toBe(true);
    expect(visited.has('src/archive/catalog/encode.ts')).toBe(true);
    for (const entry of [
      'src/background/service-worker.ts',
      'src/content/index.ts',
      'src/snapshot-catalog/snapshot-catalog-entry.ts',
    ])
      expect(read(entry)).not.toContain('resumability-journal');
  });
  it('ships manually authored EN/JA copy with the persistent-write and export disclosure', () => {
    const en = JSON.parse(read('src/_locales/en/messages.json'));
    const ja = JSON.parse(read('src/_locales/ja/messages.json'));
    for (const [key, value] of Object.entries(COPY)) {
      expect(en[key]?.message).toBe(value);
      expect(ja[key]?.message).toBeTypeOf('string');
      expect(ja[key].message.length).toBeGreaterThan(0);
      expect(ja[key].message).not.toMatch(/\uFFFD|\?{3}/u);
    }
    expect(ja.journal_boundaryHelp.message).toContain('保存');
    expect(ja.journal_boundaryHelp.message).toContain('匿名化でもありません');
    expect(ja.journal_privateExport.message).toContain('識別子');
  });
});
