// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '../..');
const directory = path.join(root, 'src/resumability-journal/execution-coordinator');
const entry = path.join(directory, 'index.ts');
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item =>
    item.isDirectory() ? files(path.join(dir, item.name)) : [path.join(dir, item.name)]
  );
}
function references(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const result: string[] = [];
  function visit(node: ts.Node) {
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
        node.expression.getText(source) === 'require')
    ) {
      expect(node.arguments.length).toBe(1);
      expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
      if (ts.isStringLiteral(node.arguments[0])) result.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}
it('allows only the exact single coordinator with mandatory injected effects and no consumers', () => {
  expect(files(directory)).toEqual([entry]);
  expect(references(entry).sort()).toEqual(
    [
      '../../content/capture/chatgpt-admitted-capture',
      '../../content/capture/chatgpt-current-branch',
      '../../content/chatgpt-asset-export',
      '../../lib/types',
      '../capture-handoff',
      '../purpose-persistence-v2/idb',
    ].sort()
  );
  const source = readFileSync(entry, 'utf8');
  expect(source).not.toMatch(
    /\b(?:chrome|browser|navigator|document|window|globalThis|indexedDB|localStorage|sessionStorage)\s*[.(]/u
  );
  expect(source).not.toMatch(
    /\b(?:fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval|require|import)\s*\(/u
  );
  expect(source).not.toMatch(
    /adaptChatGptProducerEvidence|assessNewCaptureEvidence|observeChatGptAssetResolvers|requestChatGptConversationCapture|(?:read|abort|stage)StagedArchiveArtifact|persistVerifiedBinaryAssets|normalizeChatGptCapture/u
  );
  for (const file of files(path.join(root, 'src')).filter(file => /\.[jt]sx?$/u.test(file)))
    for (const ref of references(file)) {
      const resolved = path.resolve(path.dirname(file), ref);
      expect(resolved === directory || resolved.startsWith(directory + path.sep), file).toBe(false);
    }
});
it('keeps coordinator and its v2 authority out of all production import closures and generated code', () => {
  const all = files(path.join(root, 'src'));
  const manifest = readFileSync(path.join(root, 'src/manifest.json'), 'utf8');
  const pending = [...manifest.matchAll(/"(src\/[^"\r\n]+\.ts)"/gu)].map(match =>
    path.join(root, match[1])
  );
  for (const html of all.filter(file => file.endsWith('.html')))
    for (const match of readFileSync(html, 'utf8').matchAll(/\bsrc=["']([^"']+\.ts)["']/gu))
      pending.push(path.resolve(path.dirname(html), match[1]));
  const seen = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    expect(file).not.toBe(entry);
    expect(file).not.toContain('purpose-persistence-v2');
    for (const ref of references(file)) {
      if (!ref.startsWith('.')) continue;
      const base = path.resolve(path.dirname(file), ref);
      const target = [base + '.ts', path.join(base, 'index.ts')].find(file => existsSync(file));
      if (target) pending.push(target);
    }
  }
  expect(seen.size).toBeGreaterThan(100);
  const marker =
    /execution-coordinator|createChatGptExecution|invalid-execution-input|consumeDispatch|markExecutionUnknown|liska-resumability-journal\/2/u;
  const configs = [
    ...files(path.join(root, 'scripts')),
    ...readdirSync(root)
      .filter(
        name => /(?:config|manifest|package)/u.test(name) && /\.(?:json|ts|js|mjs)$/u.test(name)
      )
      .map(name => path.join(root, name)),
  ];
  const dist = path.join(root, 'dist');
  if (existsSync(dist))
    configs.push(...files(dist).filter(file => /\.(?:js|json|html)$/u.test(file)));
  for (const file of configs) expect(readFileSync(file, 'utf8'), file).not.toMatch(marker);
});
