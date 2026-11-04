// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '../..');
const modulePath = 'src/update-discovery/claude';
function files(folder: string): string[] {
  return readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap(entry => {
    const file = `${folder}/${entry.name}`;
    return entry.isDirectory() ? files(file) : file.endsWith('.ts') ? [file] : [];
  });
}
function references(tree: ts.SourceFile) {
  return tree.statements.flatMap(node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      expect(ts.isStringLiteralLike(node.moduleSpecifier)).toBe(true);
      return [(node.moduleSpecifier as ts.StringLiteralLike).text];
    }
    return [];
  });
}
const bannedIdentifiers =
  /^(?:fetch|XMLHttpRequest|WebSocket|EventSource|URL|URLSearchParams|Request|Response|AbortController|chrome|browser|window|document|navigator|globalThis|self|localStorage|sessionStorage|indexedDB|caches|Storage|Date|performance|setTimeout|clearTimeout|setInterval|clearInterval|queueMicrotask|requestAnimationFrame|Worker|SharedWorker|BroadcastChannel|MessageChannel|postMessage|sendMessage|addEventListener|dispatchEvent|require|process|Buffer|eval|Function|Promise|console|capture|exportConversation|skipDetail|skipCapture|cursor|scheduler|catalog|journal)$/u;
const bannedOutcome =
  /^(?:unchanged|changed|newer|older|current|complete|completed|up-to-date|skip_detail|skip_capture)$/u;

describe('unwired pure Claude terminal list observation boundary', () => {
  it('closes all runtime and type imports inside this provider-specific module', () => {
    const pending = [`${modulePath}/index.ts`];
    const visited = new Set<string>();
    while (pending.length) {
      const file = pending.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      expect(file.startsWith(modulePath + '/')).toBe(true);
      const tree = ts.createSourceFile(
        file,
        readFileSync(path.join(root, file), 'utf8'),
        ts.ScriptTarget.Latest,
        true
      );
      for (const reference of references(tree)) {
        expect(reference.startsWith('./')).toBe(true);
        const base = path.posix.join(path.posix.dirname(file), reference);
        const target = [base + '.ts', base + '/index.ts'].find(candidate =>
          existsSync(path.join(root, candidate))
        );
        expect(target).toBeDefined();
        pending.push(target!);
      }
    }
    expect([...visited].sort()).toEqual(files(modulePath).sort());
  });
  it('contains no platform, network, clock, timer, dynamic loader or downstream authority tokens', () => {
    for (const file of files(modulePath)) {
      const tree = ts.createSourceFile(
        file,
        readFileSync(path.join(root, file), 'utf8'),
        ts.ScriptTarget.Latest,
        true
      );
      function visit(node: ts.Node) {
        if (ts.isIdentifier(node)) expect(node.text).not.toMatch(bannedIdentifiers);
        if (ts.isStringLiteralLike(node)) {
          expect(node.text).not.toMatch(bannedOutcome);
          expect(node.text).not.toMatch(
            /^(?:node:|https?:|chrome-extension:)|archive\/catalog|resumability-journal|extractors|service-worker/u
          );
        }
        if (ts.isCallExpression(node))
          expect(node.expression.kind).not.toBe(ts.SyntaxKind.ImportKeyword);
        if (ts.isPropertyAccessExpression(node)) expect(node.getText(tree)).not.toBe('Math.random');
        ts.forEachChild(node, visit);
      }
      visit(tree);
    }
  });
  it('has no importers or runtime wiring elsewhere in src', () => {
    for (const file of files('src').filter(file => !file.startsWith(modulePath + '/'))) {
      const source = readFileSync(path.join(root, file), 'utf8');
      expect(source).not.toContain('update-discovery/claude');
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      for (const reference of references(tree)) {
        if (!reference.startsWith('.')) continue;
        const target = path.posix.join(path.posix.dirname(file), reference);
        expect(target === modulePath || target.startsWith(modulePath + '/')).toBe(false);
      }
    }
    for (const file of ['vite.config.ts', 'src/manifest.json', 'src/background/service-worker.ts'])
      expect(readFileSync(path.join(root, file), 'utf8')).not.toContain('update-discovery');
  });
});
