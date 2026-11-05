// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '../..');
const directory = path.join(root, 'src/resumability-journal/purpose');
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(dir, entry.name);
    return entry.isDirectory() ? files(name) : [name];
  });
}
function references(file: string): string[] {
  const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const result: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      result.push(node.moduleSpecifier.text);
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      result.push(node.argument.literal.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        node.expression.getText(tree) === 'require')
    ) {
      expect(node.arguments.length).toBe(1);
      expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
      if (ts.isStringLiteral(node.arguments[0])) result.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return result;
}

describe('isolated test-only new-capture purpose contract', () => {
  it('has module-local imports only and no execution, clock, storage or browser capabilities', () => {
    const sourceFiles = files(directory).filter(file => file.endsWith('.ts'));
    expect(sourceFiles.length).toBeGreaterThan(0);
    for (const file of sourceFiles) {
      for (const reference of references(file)) {
        expect(reference.startsWith('./')).toBe(true);
        expect(path.resolve(path.dirname(file), reference).startsWith(directory + path.sep)).toBe(
          true
        );
      }
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/\b(?:import|require)\s*\(/u);
      expect(source).not.toMatch(
        /\b(?:chrome|browser|navigator|document|window|globalThis|self|process|indexedDB|localStorage|sessionStorage|Date|performance|crypto)\s*[.(]/u
      );
      expect(source).not.toMatch(
        /\b(?:fetch|XMLHttpRequest|WebSocket|Worker|SharedWorker|EventSource|setTimeout|setInterval|queueMicrotask|eval|Function|postMessage)\s*\(/u
      );
      expect(source).not.toMatch(/console\s*\./u);
    }
  });
  it('has no production source consumers, HTML entrypoints, build or manifest wiring', () => {
    for (const file of files(path.join(root, 'src'))) {
      if (file.startsWith(directory + path.sep)) continue;
      if (/\.[cm]?[jt]sx?$/u.test(file)) {
        for (const reference of references(file)) {
          const resolved = path.resolve(path.dirname(file), reference);
          expect(resolved === directory || resolved.startsWith(directory + path.sep)).toBe(false);
          expect(reference).not.toMatch(/resumability-journal\/purpose/u);
        }
      }
      if (file.endsWith('.html'))
        expect(readFileSync(file, 'utf8')).not.toMatch(
          /resumability-journal\/purpose|\/purpose\/index/u
        );
    }
    for (const file of [
      ...files(path.join(root, 'scripts')),
      ...readdirSync(root)
        .filter(
          name => /(?:config|manifest|package)/u.test(name) && /\.(?:json|ts|js|mjs)$/u.test(name)
        )
        .map(name => path.join(root, name)),
    ]) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/resumability-journal[/\\]purpose/u);
    }
  });
});
