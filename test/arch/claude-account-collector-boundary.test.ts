// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
const root = resolve(import.meta.dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const controller = 'src/background/claude-account-collector.ts',
  page = 'src/background/claude-account-collector-page.ts',
  lifecycle = 'src/background/claude-account-collector-lifecycle.ts',
  projection = 'src/background/claude-account-collector-projection.ts',
  contract = 'src/lib/claude-account-collector-contract.ts';
describe('collector production boundary', () => {
  it('pins direct consumers and keeps the closed contract independent of private machinery', () => {
    for (const [file, permitted] of [
      [
        controller,
        [
          '../claude-baseline/account-admission',
          '../claude-baseline/account-admission-contracts',
          '../claude-account-baseline-owner',
          '../lib/claude-account-collector-contract',
          './claude-account-collector-lifecycle',
          './claude-account-collector-page',
          './claude-account-collector-projection',
        ],
      ],
      [page, ['../lib/claude-account-collector-contract']],
      [projection, ['../lib/claude-account-collector-contract']],
      [
        lifecycle,
        [
          './claude-list-probe',
          './claude-account-collector-page',
          '../lib/claude-account-collector-contract',
        ],
      ],
      [contract, []],
    ] as const) {
      const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
      const imports: string[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node))
          imports.push((node.moduleSpecifier as ts.StringLiteral).text);
        if (ts.isCallExpression(node))
          expect(node.expression.kind).not.toBe(ts.SyntaxKind.ImportKeyword);
        ts.forEachChild(node, visit);
      };
      visit(ast);
      expect(imports).toEqual(permitted);
    }
  });
  it('has just the bounded list fetch, no provider/detail/download/storage/scheduling bridge', () => {
    const privateSources = [controller, lifecycle, projection, page].map(read).join('\n');
    expect(privateSources.match(/\bfetch\(/gu)).toHaveLength(1);
    expect(privateSources.match(/\.createPaused\(/gu)).toHaveLength(1);
    expect(privateSources).not.toMatch(
      /\.alarms\b|chrome\.storage|chrome\.downloads|sessionStorage|\.setItem\(|indexedDB\.|fetchClaudeConversation|captureClaudeDetail|exportConversation|\/chat_conversations\//u
    );
    expect(read(page)).toContain('limit=30&offset=0&archived=');
    expect(read(page)).not.toContain('offset=30');
    expect(read('src/manifest.json')).not.toMatch(
      /claude-account-collector|claude-account-baseline-owner/u
    );
    expect(read('src/popup/app.ts')).not.toMatch(
      /claude-account-collector-(?:page|projection|lifecycle)|claude-account-baseline-owner|scopeHeaders/u
    );
    const worker = read('src/background/service-worker.ts');
    expect(worker.match(/operations: claudeListOperations/gu)).toHaveLength(2);
  });
});
