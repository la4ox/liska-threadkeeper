// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  PROVIDER_BASELINE_LIMITS,
  PROVIDER_CHECKPOINT_SCHEMA,
  MAX_PROVIDER_OPERATIONS,
} from '../../src/resumability-journal/provider-baseline/contracts';

const root = path.resolve(import.meta.dirname, '../..');
const directory = path.join(root, 'src/resumability-journal/provider-baseline');
const ownerConsumers = new Map(
  [
    ['index.ts', ['checkpoint', 'contracts', 'operation', 'progress']],
    ['envelope.ts', ['checkpoint', 'contracts', 'operation']],
    ['execution.ts', ['checkpoint', 'operation']],
  ].map(([name, targets]) => [
    path.join(root, 'src/resumability-journal/provider-baseline-owner', name as string),
    (targets as string[]).map(target => path.join(directory, target)),
  ])
);
const ownImports: Record<string, string[]> = {
  'contracts.ts': ['../baseline-plan/contracts', '../purpose-persistence-v3/core/record'],
  'operation.ts': [
    '../baseline-plan/contracts',
    '../baseline-plan/data',
    '../baseline-plan/plan',
    '../purpose-persistence-v3/core/data',
    '../purpose-persistence-v3/core/record',
    './contracts',
  ],
  'checkpoint.ts': [
    '../purpose-persistence-v3/core/record',
    './contracts',
    '../baseline-plan/data',
    '../baseline-plan/plan',
    './operation',
  ],
  'progress.ts': [
    '../purpose-persistence-v3/core/record',
    './contracts',
    '../baseline-plan/contracts',
    '../baseline-plan/data',
    './checkpoint',
    '../baseline-plan/plan',
    './operation',
  ],
  'index.ts': ['./contracts', './checkpoint', './operation', './progress'],
};
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
  );
}
function references(file: string, runtimeOnly = false): string[] {
  const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const result: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const typeOnly = ts.isImportDeclaration(node)
        ? node.importClause?.isTypeOnly
        : node.isTypeOnly;
      if (!runtimeOnly || !typeOnly) result.push(node.moduleSpecifier.text);
    }
    if (
      !runtimeOnly &&
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
function resolve(file: string, reference: string) {
  const base = path.resolve(path.dirname(file), reference);
  return [base + '.ts', path.join(base, 'index.ts'), base].find(file => existsSync(file));
}
function relative(file: string) {
  return path.relative(root, file).replaceAll('\\', '/');
}
function productionClosure() {
  const manifest = readFileSync(path.join(root, 'src/manifest.json'), 'utf8');
  const pending = [...manifest.matchAll(/"(src\/[^"\r\n]+\.ts)"/gu)].map(match =>
    path.join(root, match[1])
  );
  for (const html of files(path.join(root, 'src')).filter(file => file.endsWith('.html')))
    for (const match of readFileSync(html, 'utf8').matchAll(/\bsrc=["']([^"']+\.ts)["']/gu))
      pending.push(path.resolve(path.dirname(html), match[1]));
  const visited = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    for (const reference of references(file)) {
      if (!reference.startsWith('.')) continue;
      const target = resolve(file, reference);
      if (target?.endsWith('.ts')) pending.push(target);
    }
  }
  return visited;
}

describe('unwired pure closed provider baseline checkpoint/2 boundary', () => {
  it('pins every module and exact direct import including types; no storage, UI, executor, provider discovery or handoff', () => {
    expect(
      files(directory)
        .map(file => path.basename(file))
        .sort()
    ).toEqual(Object.keys(ownImports).sort());
    for (const [name, allowed] of Object.entries(ownImports))
      expect(references(path.join(directory, name)).sort(), name).toEqual([...allowed].sort());
    expect(PROVIDER_CHECKPOINT_SCHEMA).toBe('liska-explicit-baseline-checkpoint/2');
    expect(MAX_PROVIDER_OPERATIONS).toBe(16);
    expect(PROVIDER_BASELINE_LIMITS).toEqual({
      maxPlanItems: 4096,
      maxCheckpointBytes: 65536,
      maxObservations: 128,
      maxWindows: 64,
      maxReservationSlots: 16,
    });
    for (const name of Object.keys(ownImports)) {
      const tree = ts.createSourceFile(
        name,
        readFileSync(path.join(directory, name), 'utf8'),
        ts.ScriptTarget.Latest,
        true
      );
      for (const statement of tree.statements)
        if (
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text === '../baseline-plan/contracts'
        )
          expect(statement.importClause?.isTypeOnly, name).toBe(true);
    }
  });
  it('pins the exact runtime closure to plan/data and journal/3 replay, never frozen checkpoint/operation/progress or journal/2', () => {
    const pending = [path.join(directory, 'index.ts')];
    const seen = new Set<string>();
    while (pending.length) {
      const file = pending.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const reference of references(file, true)) {
        expect(reference.startsWith('.'), relative(file) + ' -> ' + reference).toBe(true);
        const target = resolve(file, reference);
        expect(target?.endsWith('.ts')).toBe(true);
        if (target) pending.push(target);
      }
    }
    const expected = [
      ...Object.keys(ownImports).map(name => 'src/resumability-journal/provider-baseline/' + name),
      ...['contracts', 'data', 'plan'].map(
        name => 'src/resumability-journal/baseline-plan/' + name + '.ts'
      ),
      ...['admission', 'encode', 'contracts', 'format', 'safe-input', 'conversation-key'].map(
        name => 'src/archive/catalog/' + name + '.ts'
      ),
      ...['index', 'contracts', 'data', 'validation', 'relations'].map(
        name => 'src/resumability-journal/purpose/' + name + '.ts'
      ),
      ...['record', 'data', 'errors'].map(
        name => 'src/resumability-journal/purpose-persistence-v3/core/' + name + '.ts'
      ),
      'src/resumability-journal/producer-adapter/index.ts',
      'src/resumability-journal/claude-producer-adapter/index.ts',
      'src/lib/claude-producer-evidence.ts',
      'src/lib/chatgpt-producer-evidence.ts',
      'src/lib/producer-evidence-data.ts',
    ];
    expect([...seen].map(relative).sort()).toEqual(expected.sort());
    for (const file of seen)
      expect(readFileSync(file, 'utf8'), relative(file)).not.toMatch(
        /\b(?:chrome|browser|navigator|document|window|globalThis|self|process|indexedDB|localStorage|sessionStorage|performance|crypto)\s*[.(]|\b(?:fetch|XMLHttpRequest|WebSocket|Worker|SharedWorker|EventSource|setTimeout|setInterval|queueMicrotask|eval|Function|postMessage|require|import)\s*\(|\bDate\s*\.\s*now\s*\(|new\s+Date\s*\(\s*\)/u
      );
  });
  it('has zero external source consumers, dynamic imports, browser/global clock effects or production closure paths', () => {
    for (const file of files(path.join(root, 'src')).filter(file =>
      /\.[cm]?[jt]sx?$/u.test(file)
    )) {
      for (const reference of references(file)) {
        const resolved = path.resolve(path.dirname(file), reference);
        if (resolved === directory || resolved.startsWith(directory + path.sep))
          expect(
            file.startsWith(directory + path.sep) ||
              ownerConsumers.get(file)?.includes(resolved) === true,
            relative(file)
          ).toBe(true);
      }
      if (file.startsWith(directory + path.sep))
        expect(readFileSync(file, 'utf8')).not.toMatch(
          /\b(?:require|import)\s*\(|\b(?:Date|console|crypto|indexedDB|localStorage|sessionStorage|chrome|document|window|navigator|performance|globalThis)\s*[.(]|\b(?:persist|dispatch|settle|retry|deleteDatabase|deleteObjectStore|fetch|setTimeout|setInterval|postMessage)\s*\(/u
        );
    }
    const closure = productionClosure();
    expect(closure.size).toBeGreaterThan(100);
    for (const file of closure)
      expect(file.startsWith(directory + path.sep), relative(file)).toBe(false);
  });
  it('has zero HTML, build/config/script, manifest or generated distribution markers', () => {
    const marker =
      /provider-baseline|liska-explicit-baseline-checkpoint\/2|createProviderBaselineCheckpoint|reduceProviderBaselineCheckpoint|nextProviderBaselineDecision/u;
    const config = [
      ...files(path.join(root, 'scripts')).filter(
        file =>
          file !== path.join(root, 'scripts/build-provider-baseline-owner-browser.mjs') &&
          file !== path.join(root, 'scripts/build-provider-baseline-owner-lifecycle-browser.mjs')
      ),
      ...files(path.join(root, 'src')).filter(
        file => file.endsWith('.html') || file.endsWith('manifest.json')
      ),
      ...readdirSync(root)
        .filter(
          name => /(?:config|manifest|package)/u.test(name) && /\.(?:json|ts|js|mjs)$/u.test(name)
        )
        .map(name => path.join(root, name)),
    ];
    for (const file of config)
      expect(readFileSync(file, 'utf8'), relative(file)).not.toMatch(marker);
    const dist = path.join(root, 'dist');
    if (existsSync(dist))
      for (const file of files(dist).filter(file => /\.(?:js|json|html)$/u.test(file)))
        expect(readFileSync(file, 'utf8'), relative(file)).not.toMatch(marker);
  });
});
