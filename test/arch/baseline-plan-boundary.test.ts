// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { BASELINE_LIMITS } from '../../src/resumability-journal/baseline-plan/contracts';
import { MAX_RECORDS } from '../../src/resumability-journal/purpose-persistence-v2/core/data';

const root = path.resolve(import.meta.dirname, '../..');
const directory = path.join(root, 'src/resumability-journal/baseline-plan');
const ownerConsumers = new Map(
  [
    ['index.ts', ['', 'data']],
    ['envelope.ts', ['', 'contracts']],
    ['execution.ts', ['', 'data']],
  ]
    .map(([name, targets]) => [
      path.join(root, 'src/resumability-journal/baseline-owner', name as string),
      (targets as string[]).map(target => path.join(directory, target)),
    ])
    .concat(
      [
        ['contracts.ts', ['contracts']],
        ['checkpoint.ts', ['data', 'plan']],
        ['operation.ts', ['contracts', 'data', 'plan']],
        ['progress.ts', ['contracts', 'data', 'plan']],
      ].map(([name, targets]) => [
        path.join(root, 'src/resumability-journal/provider-baseline', name as string),
        (targets as string[]).map(target => path.join(directory, target)),
      ])
    )
);
const ownImports: Record<string, string[]> = {
  'contracts.ts': [
    '../../archive/catalog/admission',
    '../purpose/contracts',
    '../purpose-persistence-v2/core/record',
  ],
  'data.ts': ['./contracts'],
  'plan.ts': [
    '../../archive/catalog/admission',
    '../purpose',
    '../purpose/contracts',
    './contracts',
    './data',
  ],
  'checkpoint.ts': [
    '../purpose-persistence-v2/core/record',
    './contracts',
    './data',
    './plan',
    './operation',
  ],
  'operation.ts': [
    '../purpose-persistence-v2/core/data',
    '../purpose-persistence-v2/core/record',
    './contracts',
    './data',
    './plan',
  ],
  'progress.ts': [
    '../purpose-persistence-v2/core/record',
    './contracts',
    './data',
    './checkpoint',
    './plan',
    './operation',
  ],
  'index.ts': ['./contracts', './plan', './checkpoint', './progress'],
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

describe('unwired pure explicit baseline-plan boundary', () => {
  it('pins every module and exact direct import including types; no storage, UI, executor, provider discovery or handoff', () => {
    expect(
      files(directory)
        .map(file => path.basename(file))
        .sort()
    ).toEqual(Object.keys(ownImports).sort());
    for (const [name, allowed] of Object.entries(ownImports))
      expect(references(path.join(directory, name)).sort(), name).toEqual([...allowed].sort());
    expect(BASELINE_LIMITS.maxReservationSlots).toBe(16);
    expect(MAX_RECORDS).toBe(16);
  });
  it('pins the full runtime closure to existing pure catalog, purpose, receipt and v2 snapshot validators', () => {
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
      ...Object.keys(ownImports).map(name => 'src/resumability-journal/baseline-plan/' + name),
      ...['admission', 'encode', 'contracts', 'format', 'safe-input', 'conversation-key'].map(
        name => 'src/archive/catalog/' + name + '.ts'
      ),
      ...['index', 'contracts', 'data', 'validation', 'relations'].map(
        name => 'src/resumability-journal/purpose/' + name + '.ts'
      ),
      ...['record', 'data', 'errors'].map(
        name => 'src/resumability-journal/purpose-persistence-v2/core/' + name + '.ts'
      ),
      'src/resumability-journal/producer-adapter/index.ts',
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
      /baseline-plan|liska-explicit-baseline|createBaselinePlan|reduceBaselineCheckpoint|nextBaselineDecision/u;
    const config = [
      ...files(path.join(root, 'scripts')),
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
  it('preserves the entire v2 source set and pinned Git blob bytes from the exact foundation base', () => {
    const prefix = 'src/resumability-journal/purpose-persistence-v2/';
    const baseline = JSON.parse(
      readFileSync(
        path.join(root, 'test/resumability-journal/baseline-plan/v2-source-baseline.json'),
        'utf8'
      )
    ) as { base: string; files: { file: string; hash: string }[] };
    expect(baseline.base).toBe('61d644396b6f10c1c36089a355ff5240b80cc6cf');
    const expected = baseline.files;
    expect(expected).toHaveLength(9);
    expect(new Set(expected.map(item => item.file)).size).toBe(expected.length);
    expect(expected.every(item => /^[a-f0-9]{40}$/u.test(item.hash))).toBe(true);
    expect(files(path.join(root, prefix)).map(relative).sort()).toEqual(
      expected.map(item => item.file).sort()
    );
    for (const item of expected) {
      const bytes = Buffer.from(
        readFileSync(path.join(root, item.file), 'utf8').replaceAll('\r\n', '\n')
      );
      const actual = createHash('sha1')
        .update(Buffer.from(`blob ${bytes.length}\0`))
        .update(bytes)
        .digest('hex');
      expect(actual, item.file).toBe(item.hash);
    }
  });
});
