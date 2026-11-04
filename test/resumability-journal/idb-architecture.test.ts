// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '../..');
const directory = 'src/resumability-journal/idb';

describe('dedicated journal persistence boundary', () => {
  it('imports only its own adapter and pure journal core, never unrelated persistence or execution', () => {
    const files = readdirSync(path.join(root, directory)).filter(file => file.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(path.join(root, directory, file), 'utf8');
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      for (const statement of tree.statements) {
        if (
          !(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) ||
          !statement.moduleSpecifier ||
          !ts.isStringLiteral(statement.moduleSpecifier)
        )
          continue;
        const imported = statement.moduleSpecifier.text;
        expect(imported.startsWith('.')).toBe(true);
        const resolved = path.posix.normalize(path.posix.join(directory, imported));
        expect(
          resolved.startsWith(directory + '/') || resolved === 'src/resumability-journal/core'
        ).toBe(true);
      }
      expect(source).not.toMatch(/\b(?:import|require)\s*\(/u);
      expect(source).not.toMatch(
        /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|showDirectoryPicker|showOpenFilePicker|showSaveFilePicker|createWritable|removeEntry|deleteDatabase|deleteObjectStore)\s*[.(]/u
      );
      expect(source).not.toMatch(/\b(?:chrome|browser|navigator|document|window)\s*\./u);
      const checkCall = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ['delete', 'clear'].includes(node.expression.name.text)
        )
          expect(node.expression.expression.getText(tree)).toBe('connection.transactions');
        ts.forEachChild(node, checkCall);
      };
      checkCall(tree);
      expect(source).not.toMatch(/console\.(?:log|error|warn|info|debug)\s*\(/u);
    }
  });
});
