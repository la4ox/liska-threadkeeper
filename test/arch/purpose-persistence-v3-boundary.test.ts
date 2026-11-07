// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { MAX_RECORD_BYTES } from '../../src/resumability-journal/purpose-persistence-v3/core/data';
import {
  CHATGPT_ADAPTER_VERSION,
  CLAUDE_ADAPTER_VERSION,
  RECORD_SCHEMA,
} from '../../src/resumability-journal/purpose-persistence-v3/core/record';

const root = path.resolve(import.meta.dirname, '../..');
const prefix = 'src/resumability-journal/';
const v3 = prefix + 'purpose-persistence-v3/';
const adapter = prefix + 'claude-producer-adapter/';
const receipt = 'src/lib/claude-producer-evidence.ts';
const imports: Record<string, string[]> = {
  [receipt]: ['./chatgpt-producer-evidence', './producer-evidence-data'],
  [adapter + 'index.ts']: [
    '../purpose',
    '../../lib/claude-producer-evidence',
    '../../lib/chatgpt-producer-evidence',
    '../../lib/producer-evidence-data',
    '../../archive/catalog/conversation-key',
  ],
  [v3 + 'core/record.ts']: [
    '../../purpose',
    '../../../lib/chatgpt-producer-evidence',
    '../../../lib/claude-producer-evidence',
    '../../producer-adapter',
    '../../claude-producer-adapter',
    './data',
    './errors',
  ],
  [v3 + 'core/data.ts']: ['./errors'],
  [v3 + 'core/errors.ts']: [],
  [v3 + 'core/control.ts']: ['./record', './errors'],
};
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
  );
}
function relative(file: string): string {
  return path.relative(root, file).replaceAll('\\', '/');
}
function references(file: string, runtimeOnly = false, allowExistingDynamic = false): string[] {
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
      if (!allowExistingDynamic) throw new Error('dynamic import: ' + relative(file));
      expect(node.arguments.length).toBe(1);
      expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
      if (ts.isStringLiteral(node.arguments[0])) result.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return result;
}
function resolve(file: string, reference: string): string | undefined {
  const base = path.resolve(path.dirname(file), reference);
  return [base + '.ts', path.join(base, 'index.ts'), base].find(value => existsSync(value));
}
function closure(entries: string[], runtimeOnly = true): Set<string> {
  const pending = [...entries],
    seen = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const reference of references(file, runtimeOnly, true)) {
      if (!reference.startsWith('.')) continue;
      const target = resolve(file, reference);
      expect(target, relative(file) + ' -> ' + reference).toBeDefined();
      if (target?.endsWith('.ts')) pending.push(target);
    }
  }
  return seen;
}

describe('unwired closed ChatGPT/Claude journal/3 contract boundary', () => {
  it('pins every new file and import, exact schema/adapters and 64 KiB limit; there is no store', () => {
    const actual = [
      ...files(path.join(root, v3)),
      ...files(path.join(root, adapter)),
      path.join(root, receipt),
    ]
      .map(relative)
      .sort();
    expect(actual).toEqual(Object.keys(imports).sort());
    for (const [file, expected] of Object.entries(imports))
      expect(references(path.join(root, file)).sort(), file).toEqual([...expected].sort());
    expect([
      RECORD_SCHEMA,
      CHATGPT_ADAPTER_VERSION,
      CLAUDE_ADAPTER_VERSION,
      MAX_RECORD_BYTES,
    ]).toEqual([
      'liska-resumability-journal/3',
      'liska-chatgpt-producer-adapter/1',
      'liska-claude-producer-adapter/1',
      65536,
    ]);
  });
  it('pins the complete pure runtime closure with no browser, storage, network, clock or old-owner path', () => {
    const seen = closure(Object.keys(imports).map(file => path.join(root, file)));
    const expected = [
      ...Object.keys(imports),
      ...['index', 'contracts', 'data', 'validation', 'relations'].map(
        name => prefix + 'purpose/' + name + '.ts'
      ),
      prefix + 'producer-adapter/index.ts',
      'src/lib/chatgpt-producer-evidence.ts',
      'src/lib/producer-evidence-data.ts',
      'src/archive/catalog/conversation-key.ts',
      'src/archive/catalog/contracts.ts',
    ];
    expect([...seen].map(relative).sort()).toEqual(expected.sort());
    for (const file of seen) {
      expect(relative(file)).not.toMatch(
        /resumability-journal\/(?:core|idb|page|purpose-persistence-v2|baseline-plan|baseline-owner|capture-handoff|execution-coordinator)\//u
      );
      expect(readFileSync(file, 'utf8'), relative(file)).not.toMatch(
        /\b(?:chrome|browser|navigator|document|window|globalThis|self|process|indexedDB|localStorage|sessionStorage|Date|performance|crypto)\s*[.(]|\b(?:fetch|XMLHttpRequest|WebSocket|Worker|SharedWorker|EventSource|setTimeout|setInterval|queueMicrotask|eval|Function|postMessage|require|import)\s*\(/u
      );
    }
  });
  it('allows only exact intra-slice consumers and has zero production entrypoint consumers', () => {
    const consumers: Record<string, string[]> = {
      [receipt]: [adapter + 'index.ts', v3 + 'core/record.ts'],
      [adapter + 'index.ts']: [v3 + 'core/record.ts'],
      [v3 + 'core/record.ts']: [v3 + 'core/control.ts'],
      [v3 + 'core/data.ts']: [v3 + 'core/record.ts'],
      [v3 + 'core/errors.ts']: [v3 + 'core/data.ts', v3 + 'core/record.ts', v3 + 'core/control.ts'],
      [v3 + 'core/control.ts']: [],
    };
    const source = files(path.join(root, 'src'));
    for (const file of source.filter(file => /\.[cm]?[jt]sx?$/u.test(file)))
      for (const reference of references(file, false, true)) {
        if (!reference.startsWith('.')) continue;
        const target = resolve(file, reference);
        if (target && relative(target) in consumers)
          expect(consumers[relative(target)], relative(file)).toContain(relative(file));
      }
    const manifest = readFileSync(path.join(root, 'src/manifest.json'), 'utf8');
    const entrypoints = [...manifest.matchAll(/"(src\/[^"\r\n]+\.ts)"/gu)].map(match =>
      path.join(root, match[1])
    );
    for (const html of source.filter(file => file.endsWith('.html')))
      for (const match of readFileSync(html, 'utf8').matchAll(/\bsrc=["']([^"']+\.ts)["']/gu))
        entrypoints.push(path.resolve(path.dirname(html), match[1]));
    const production = closure(entrypoints, false);
    expect(production.size).toBeGreaterThan(100);
    for (const file of Object.keys(imports))
      expect(production.has(path.join(root, file)), file).toBe(false);
    const config = [
      ...files(path.join(root, 'scripts')),
      ...source.filter(file => file.endsWith('.html') || file.endsWith('manifest.json')),
      ...readdirSync(root)
        .filter(
          name => /(?:config|manifest|package)/u.test(name) && /\.(?:json|ts|js|mjs)$/u.test(name)
        )
        .map(name => path.join(root, name)),
      ...(existsSync(path.join(root, 'dist'))
        ? files(path.join(root, 'dist')).filter(file => /\.(?:js|html|json)$/u.test(file))
        : []),
    ];
    for (const file of config)
      expect(readFileSync(file, 'utf8'), relative(file)).not.toMatch(
        /purpose-persistence-v3|claude-producer-adapter|claude-producer-evidence|liska-resumability-journal\/3|adaptClaudeProducerEvidence/u
      );
  });
  it('preserves complete v1/v2/baseline-plan source sets and exact base owner/ChatGPT blobs', () => {
    const read = (file: string) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
    const v1 = read('test/resumability-journal/purpose-persistence-v2/v1-baseline.json') as {
      gitBlobs: Record<string, string>;
    };
    const v2 = read('test/resumability-journal/baseline-plan/v2-source-baseline.json') as {
      files: { file: string; hash: string }[];
    };
    const plan = read('test/resumability-journal/baseline-owner/baseline-source.json') as {
      files: { file: string; hash: string }[];
    };
    // Exact implementation base: 8e5060315ad740a8f05bb14eb50b5ecd48fd08f9.
    const pinned: Record<string, string> = {
      ...v1.gitBlobs,
      ...Object.fromEntries([...v2.files, ...plan.files].map(item => [item.file, item.hash])),
      [prefix + 'baseline-owner/database.ts']: '787cdb4b114662ae57ed85175217f5321ad8700b',
      [prefix + 'baseline-owner/envelope.ts']: '6b3cf42835e0e7c0e00924653de53d4762fa61a8',
      [prefix + 'baseline-owner/errors.ts']: '9a04501f98d1a3f3d65cebdf35ad00337a59509f',
      [prefix + 'baseline-owner/execution.ts']: 'cdde7ba1e579334f25d9baf3451924729c3cc6b5',
      [prefix + 'baseline-owner/index.ts']: '16ef672bf7b692021d39cb15c3c68148275ad964',
      [prefix + 'baseline-owner/inventory.ts']: '6154b27d1e448915b8a0e36d2d934b63912a5265',
      [prefix + 'baseline-owner/transaction.ts']: '111dfbf63fda2aee78976f0579274a126ce9f6d8',
      [prefix + 'producer-adapter/index.ts']: 'b5b43beed2809515d5eab8e3556e316497558b07',
      'src/lib/chatgpt-producer-evidence.ts': 'bedadbf49b6facc8df43df48d3eaea1ead76e5d8',
      'src/lib/producer-evidence-data.ts': '3aefacb58ae513edf3d50f44ae4852716808225d',
    };
    const directories = [
      'core',
      'idb',
      'page',
      'purpose-persistence-v2',
      'baseline-plan',
      'baseline-owner',
      'producer-adapter',
    ];
    const actual = directories.flatMap(part => files(path.join(root, prefix, part))).map(relative);
    actual.push('src/lib/chatgpt-producer-evidence.ts', 'src/lib/producer-evidence-data.ts');
    expect(actual.sort()).toEqual(Object.keys(pinned).sort());
    for (const [file, expected] of Object.entries(pinned)) {
      const bytes = Buffer.from(
        readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n')
      );
      expect(
        createHash('sha1')
          .update(Buffer.from(`blob ${bytes.length}\0`))
          .update(bytes)
          .digest('hex'),
        file
      ).toBe(expected);
    }
  });
});
