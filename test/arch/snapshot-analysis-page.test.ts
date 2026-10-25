import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { COPY } from '../../src/snapshot-analysis/text';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('snapshot analysis page architecture', () => {
  it('uses a private unique HTML/TS entry and static popup link independent of settings', () => {
    const html = read('src/snapshot-analysis/snapshot-analysis.html');
    const popup = read('src/popup/index.html');
    expect(html).toContain('snapshot-analysis-entry.ts');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).toContain('webkitdirectory');
    expect(html).toContain('aria-labelledby="analysis-heading"');
    expect(html).not.toContain('aria-label="Analysis"');
    expect(popup).toMatch(
      /href="\.\.\/snapshot-analysis\/snapshot-analysis\.html"[\s\S]{0,100}target="_blank"[\s\S]{0,100}rel="noopener"/u
    );
    expect(read('vite.config.ts')).toContain('src/snapshot-analysis/snapshot-analysis.html');
    expect(read('vite.config.ts')).toContain('modulePreload: false');
    expect(read('src/manifest.json')).not.toContain('snapshot-analysis');
  });

  it('keeps reachable source imports out of browser destination and settings layers', () => {
    const visited = new Set<string>();
    const pending = ['src/snapshot-analysis/snapshot-analysis-entry.ts'];
    while (pending.length) {
      const file = pending.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      expect(file).not.toMatch(/src\/(?:background|content|offscreen|popup)\/|src\/lib\/storage/u);
      const source = read(file);
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      for (const statement of tree.statements) {
        if (
          (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
          statement.moduleSpecifier &&
          ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          const imported = statement.moduleSpecifier.text;
          if (!imported.startsWith('.')) {
            expect(imported.startsWith('node:')).toBe(false);
            continue;
          }
          const base = path.posix.join(path.posix.dirname(file), imported);
          const options = [base + '.ts', base + '/index.ts', base];
          const existing = options.find(value => {
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
    }
    expect(visited.has('src/archive/snapshots/index.ts')).toBe(true);
  });

  it('has no source-file mutation, network, settings or runtime-message capability', () => {
    const files = readdirSync(path.join(root, 'src/snapshot-analysis')).filter(file =>
      file.endsWith('.ts')
    );
    for (const file of files) {
      const source = read('src/snapshot-analysis/' + file);
      expect(source).not.toMatch(
        /\b(?:fetch|XMLHttpRequest|WebSocket|showDirectoryPicker|showOpenFilePicker|showSaveFilePicker|createWritable|removeEntry|indexedDB|localStorage|sessionStorage)\s*[.(]/u
      );
      expect(source).not.toMatch(
        /chrome\.(?:storage|scripting|tabs|offscreen)|runtime\.(?:sendMessage|connect)|\.innerHTML\s*=/u
      );
      expect(source).not.toMatch(/console\.(?:log|error|warn|info|debug)\s*\(/u);
    }
  });

  it('localizes every fixed page label in both shipped locales', () => {
    const en = JSON.parse(read('src/_locales/en/messages.json'));
    const ja = JSON.parse(read('src/_locales/ja/messages.json'));
    for (const [key, fallback] of Object.entries(COPY)) {
      expect(en[key]?.message).toBe(fallback);
      expect(ja[key]?.message).toBeTypeOf('string');
      expect(ja[key].message.length).toBeGreaterThan(0);
    }
  });
});
