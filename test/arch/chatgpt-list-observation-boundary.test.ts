// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '../..');
const modulePath = 'src/update-discovery/chatgpt';
function files(folder: string): string[] {
  return readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap(entry => {
    const file = `${folder}/${entry.name}`;
    return entry.isDirectory()
      ? files(file)
      : /\.(?:[cm]?[jt]sx?|html|json)$/u.test(file)
        ? [file]
        : [];
  });
}
function syntax(file: string) {
  return ts.createSourceFile(
    file,
    readFileSync(path.join(root, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
}
/** Include type-only imports, re-exports, import types and literal dynamic loaders. */
function references(tree: ts.SourceFile): string[] {
  const result: string[] = [];
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      expect(ts.isStringLiteralLike(node.moduleSpecifier)).toBe(true);
      result.push((node.moduleSpecifier as ts.StringLiteralLike).text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      expect(ts.isStringLiteralLike(node.argument.literal)).toBe(true);
      result.push((node.argument.literal as ts.StringLiteralLike).text);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        node.expression.getText(tree) === 'require') &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      result.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return result;
}
const bannedIdentifiers =
  /^(?:fetch|XMLHttpRequest|WebSocket|EventSource|URL|URLSearchParams|Request|Response|Headers|AbortController|chrome|browser|window|document|navigator|globalThis|self|localStorage|sessionStorage|indexedDB|caches|Storage|Date|performance|setTimeout|clearTimeout|setInterval|clearInterval|queueMicrotask|requestAnimationFrame|cancelAnimationFrame|Worker|SharedWorker|BroadcastChannel|MessageChannel|MessagePort|postMessage|sendMessage|addEventListener|dispatchEvent|require|process|Buffer|eval|Function|Promise|console|capture|exportConversation|skipDetail|skipCapture|cursor|scheduler|catalog|journal)$/u;
const bannedClaims =
  /^(?:unchanged|changed|newer|older|current|complete|completed|up-to-date|skip_detail|skip_capture|hasMore|has_more|next|nextOffset|terminal|completeness|scopeKey|compareChatGptListTokens)$/u;

describe('unwired pure ChatGPT ordinary-list observation boundary', () => {
  it('closes runtime and type dependencies inside the new provider module only', () => {
    const pending = [`${modulePath}/index.ts`];
    const visited = new Set<string>();
    while (pending.length) {
      const file = pending.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      expect(file.startsWith(modulePath + '/')).toBe(true);
      for (const reference of references(syntax(file))) {
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
  it('has no platform capabilities, dynamic loading, comparator or downstream authority', () => {
    for (const file of files(modulePath)) {
      const tree = syntax(file);
      function visit(node: ts.Node) {
        if (ts.isIdentifier(node)) {
          expect(node.text).not.toMatch(bannedIdentifiers);
          expect(node.text).not.toMatch(bannedClaims);
        }
        if (ts.isStringLiteralLike(node)) {
          expect(node.text).not.toMatch(bannedIdentifiers);
          expect(node.text).not.toMatch(bannedClaims);
          expect(node.text).not.toMatch(
            /^(?:node:|https?:|chrome-extension:)|archive\/catalog|resumability-journal|extractors|service-worker|capture|scheduler|storage|messaging|claude/iu
          );
        }
        if (ts.isCallExpression(node))
          expect(node.expression.kind).not.toBe(ts.SyntaxKind.ImportKeyword);
        if (ts.isImportTypeNode(node))
          expect(false, 'dynamic import types are not admitted').toBe(true);
        if (ts.isPropertyAccessExpression(node)) expect(node.getText(tree)).not.toBe('Math.random');
        ts.forEachChild(node, visit);
      }
      visit(tree);
    }
  });
  it('has no source importers, re-exports or entrypoint/build/manifest wiring', () => {
    for (const file of files('src').filter(file => !file.startsWith(modulePath + '/'))) {
      const source = readFileSync(path.join(root, file), 'utf8');
      expect(source).not.toContain('update-discovery/chatgpt');
      expect(source).not.toContain('observeChatGptUnboundConversationListPage');
      if (!/\.[cm]?[jt]sx?$/u.test(file)) continue;
      for (const reference of references(syntax(file))) {
        if (!reference.startsWith('.')) continue;
        const target = path.posix.join(path.posix.dirname(file), reference);
        expect(target === modulePath || target.startsWith(modulePath + '/')).toBe(false);
      }
    }
    for (const file of ['vite.config.ts', 'package.json', 'src/manifest.json']) {
      const source = readFileSync(path.join(root, file), 'utf8');
      expect(source).not.toContain('update-discovery/chatgpt');
      expect(source).not.toContain('observeChatGptUnboundConversationListPage');
      expect(source).not.toContain('chatgpt-conversation-list-page-observation/1');
    }
  });
});
