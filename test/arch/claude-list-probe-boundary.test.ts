// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const backgroundPath = 'src/background/claude-list-probe.ts';
const contractPath = 'src/lib/claude-list-probe-contract.ts';

function source(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(path.join(root, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
}

function references(tree: ts.SourceFile): string[] {
  const output: string[] = [];
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      expect(ts.isStringLiteralLike(node.moduleSpecifier)).toBe(true);
      if (ts.isStringLiteralLike(node.moduleSpecifier)) output.push(node.moduleSpecifier.text);
    }
    if (ts.isImportTypeNode(node)) {
      expect(ts.isLiteralTypeNode(node.argument)).toBe(true);
      if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal))
        output.push(node.argument.literal.text);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      throw new Error('Dynamic probe dependency');
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return output;
}

describe('Claude list diagnostic architecture boundary', () => {
  it('closes the probe implementation on its content-free contract only', () => {
    expect(references(source(backgroundPath))).toEqual(['../lib/claude-list-probe-contract']);
    expect(references(source(contractPath))).toEqual([]);
  });

  it('has no baseline, ADR053 observation, storage, download, destination, detail, export, journal or scheduler dependency', () => {
    const text = [backgroundPath, contractPath]
      .map(file => readFileSync(path.join(root, file), 'utf8'))
      .join('\n');
    expect(text).not.toMatch(
      /claude-baseline|update-discovery|claude-list-page-observation|observeClaudeTerminalListPage|CLAUDE_LIST_OBSERVATION|snapshot-catalog|resumability-journal|export-operation|output-handlers|downloadArchiveBlob|saveToOutputs|destination|scheduler|journal/u
    );
    const tree = source(backgroundPath);
    const bannedIdentifiers = new Set([
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'caches',
      'downloads',
      'fetchClaudeConversation',
      'captureClaudeDetail',
      'exportConversation',
      'persist',
      'retry',
    ]);
    function visit(node: ts.Node) {
      if (ts.isIdentifier(node)) expect(bannedIdentifiers.has(node.text), node.text).toBe(false);
      ts.forEachChild(node, visit);
    }
    visit(tree);
  });

  it('does not change the manifest or grant baseline/account completeness authority', () => {
    const manifest = readFileSync(path.join(root, 'src/manifest.json'), 'utf8');
    expect(manifest).not.toContain('claude-list-probe');
    const contract = readFileSync(path.join(root, contractPath), 'utf8');
    expect(contract).not.toMatch(
      /accountComplete|baselineComplete|coverageComplete|syncAuthority/u
    );
  });
});
