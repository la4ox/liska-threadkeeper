import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { COPY } from '../../src/snapshot-catalog/text';
import { CATALOG_PAGE_LIMITS } from '../../src/snapshot-catalog/limits';
import { SNAPSHOT_CATALOG_HARD_LIMITS } from '../../src/archive/catalog';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('snapshot catalog private page architecture', () => {
  it('has a distinct private entry, restrictive CSP and a static Settings > Archive Tools link', () => {
    const html = read('src/snapshot-catalog/snapshot-catalog.html');
    expect(html).toContain('snapshot-catalog-entry.ts');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).toContain('webkitdirectory');
    expect(html).toContain('aria-labelledby="catalog-heading"');
    const popup = read('src/popup/index.html');
    expect(popup).toMatch(
      /class="section archive-tools"[\s\S]*href="\.\.\/snapshot-catalog\/snapshot-catalog\.html"[\s\S]{0,100}target="_blank"[\s\S]{0,100}rel="noopener"/u
    );
    expect(read('vite.config.ts')).toContain('src/snapshot-catalog/snapshot-catalog.html');
    expect(read('src/manifest.json')).not.toContain('snapshot-catalog');
  });

  it('keeps the entire source import closure out of provider, destination, settings and analysis layers', () => {
    const visited = new Set<string>();
    const pending = ['src/snapshot-catalog/snapshot-catalog-entry.ts'];
    while (pending.length) {
      const file = pending.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      expect(file).not.toMatch(
        /src\/(?:background|content|offscreen|popup|platforms|snapshot-analysis)\/|src\/lib\/storage/u
      );
      const tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
      for (const statement of tree.statements) {
        if (
          !(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) ||
          !statement.moduleSpecifier ||
          !ts.isStringLiteral(statement.moduleSpecifier)
        )
          continue;
        const imported = statement.moduleSpecifier.text;
        expect(imported.startsWith('.')).toBe(true);
        const base = path.posix.join(path.posix.dirname(file), imported);
        const existing = [base + '.ts', base + '/index.ts', base].find(value => {
          try {
            return readFileSync(path.join(root, value)).length >= 0;
          } catch {
            return false;
          }
        });
        expect(existing).toBeDefined();
        if (existing?.endsWith('.ts')) pending.push(existing);
      }
    }
    expect(visited.has('src/archive/catalog/index.ts')).toBe(true);
  });

  it('has zero messaging, network, storage, file mutation or remembered-handle capabilities', () => {
    for (const file of readdirSync(path.join(root, 'src/snapshot-catalog')).filter(value =>
      value.endsWith('.ts')
    )) {
      const source = read('src/snapshot-catalog/' + file);
      expect(source).not.toMatch(
        /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|showDirectoryPicker|showOpenFilePicker|showSaveFilePicker|createWritable|removeEntry|indexedDB|localStorage|sessionStorage)\s*[.(]/u
      );
      expect(source).not.toMatch(
        /chrome\.(?:storage|scripting|tabs|offscreen)|runtime\.(?:sendMessage|connect)|\.innerHTML\s*=/u
      );
      expect(source).not.toMatch(/console\.(?:log|error|warn|info|debug)\s*\(/u);
    }
  });

  it('keeps each independent UI limit finite and no greater than the core ceiling', () => {
    for (const value of Object.values(CATALOG_PAGE_LIMITS))
      expect(Number.isSafeInteger(value) && value > 0).toBe(true);
    for (const [ui, core] of [
      ['maxFiles', 'maxSelectedFiles'],
      ['maxManifests', 'maxManifests'],
      ['maxManifestBytes', 'maxManifestBytes'],
      ['maxTotalManifestBytes', 'maxTotalManifestBytes'],
      ['maxPathLength', 'maxRelativePathCodeUnits'],
      ['maxReportBytes', 'maxOutputBytes'],
    ] as const)
      expect(CATALOG_PAGE_LIMITS[ui]).toBeLessThanOrEqual(SNAPSHOT_CATALOG_HARD_LIMITS[core]);
  });

  it('ships all fixed page strings as valid EN/JA UTF-8 messages', () => {
    const en = JSON.parse(read('src/_locales/en/messages.json'));
    const ja = JSON.parse(read('src/_locales/ja/messages.json'));
    for (const [key, fallback] of Object.entries(COPY)) {
      expect(en[key]?.message).toBe(fallback);
      expect(ja[key]?.message).toBeTypeOf('string');
      expect(ja[key].message.length).toBeGreaterThan(0);
      expect(ja[key].message).not.toMatch(/\uFFFD|\?{3}/u);
    }
    expect(ja.catalog_limits.message).toContain('4,096');
    expect(ja.catalog_boundaryHelp.message).toContain('読み取りません');
    expect(ja.catalog_privacyHelp.message).toContain('匿名化ではありません');
  });
});
