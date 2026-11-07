// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  OWNER_DATABASE_NAME,
  OWNER_DATABASE_VERSION,
  OWNER_KEY,
  OWNER_STORE_NAME,
  OPERATIONS_STORE_NAME,
} from '../../src/resumability-journal/baseline-owner';
import { MAX_OWNER_BYTES } from '../../src/resumability-journal/baseline-owner/envelope';
const root = path.resolve(import.meta.dirname, '../..');
const directory = path.join(root, 'src/resumability-journal/baseline-owner');
const imports: Record<string, string[]> = {
  'database.ts': ['./errors'],
  'errors.ts': [],
  'transaction.ts': ['./database', './errors'],
  'inventory.ts': ['./envelope', './database', './errors', './transaction'],
  'execution.ts': [
    '../baseline-plan/data',
    '../baseline-plan',
    '../producer-adapter',
    '../purpose-persistence-v2/core/record',
    '../purpose-persistence-v2/core/errors',
    '../execution-coordinator/store-port',
    './errors',
    './envelope',
    './index',
  ],
  'envelope.ts': [
    '../../archive/catalog/admission',
    '../baseline-plan',
    '../baseline-plan/contracts',
    '../purpose-persistence-v2/core/record',
    '../purpose-persistence-v2/core/control',
    './errors',
  ],
  'index.ts': [
    '../../archive/catalog/admission',
    '../baseline-plan',
    '../baseline-plan/data',
    '../purpose',
    '../execution-coordinator/store-port',
    './execution',
    '../capture-handoff',
    '../purpose-persistence-v2/core/record',
    '../purpose-persistence-v2/core/control',
    './database',
    './transaction',
    './inventory',
    './envelope',
    './errors',
    './errors',
    './database',
    './database',
  ],
};
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
  );
}
function references(file: string, runtimeOnly = false, allowExistingDynamic = false): string[] {
  const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    ),
    result: string[] = [];
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
        node.expression.getText(source) === 'require')
    ) {
      if (!allowExistingDynamic) throw new Error('dynamic import: ' + file);
      expect(node.arguments.length).toBe(1);
      expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
      if (ts.isStringLiteral(node.arguments[0])) result.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}
function resolve(file: string, reference: string) {
  const base = path.resolve(path.dirname(file), reference);
  return [base + '.ts', path.join(base, 'index.ts'), base].find(value => existsSync(value));
}
function relative(file: string) {
  return path.relative(root, file).replaceAll('\\', '/');
}
describe('isolated durable baseline owner boundary', () => {
  it('pins the exact owned files, imports, namespace, schema and bounded envelope', () => {
    expect(
      files(directory)
        .map(file => path.basename(file))
        .sort()
    ).toEqual(Object.keys(imports).sort());
    for (const [file, expected] of Object.entries(imports))
      expect(references(path.join(directory, file)).sort(), file).toEqual([...expected].sort());
    expect([
      OWNER_DATABASE_NAME,
      OWNER_DATABASE_VERSION,
      OWNER_KEY,
      OWNER_STORE_NAME,
      OPERATIONS_STORE_NAME,
    ]).toEqual(['liska-baseline-owner-v1', 1, 'baseline', 'owner', 'operations']);
    expect(MAX_OWNER_BYTES).toBe(128 + 1024 * 1024 + 1024 * 1024 + 64 * 1024);
  });
  it('has only the exact pure closure plus its own storage adapter, no provider/executor/coordinator path', () => {
    const pending = [path.join(directory, 'index.ts')],
      seen = new Set<string>();
    while (pending.length) {
      const file = pending.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const reference of references(file, true)) {
        expect(reference.startsWith('.'), file).toBe(true);
        const target = resolve(file, reference);
        expect(target).toBeDefined();
        if (target) pending.push(target);
      }
    }
    const expected = [
      ...Object.keys(imports).map(name => 'src/resumability-journal/baseline-owner/' + name),
      ...['checkpoint', 'contracts', 'data', 'index', 'operation', 'plan', 'progress'].map(
        name => 'src/resumability-journal/baseline-plan/' + name + '.ts'
      ),
      ...['admission', 'encode', 'contracts', 'format', 'safe-input', 'conversation-key'].map(
        name => 'src/archive/catalog/' + name + '.ts'
      ),
      ...['index', 'contracts', 'data', 'validation', 'relations'].map(
        name => 'src/resumability-journal/purpose/' + name + '.ts'
      ),
      ...['record', 'data', 'errors', 'control'].map(
        name => 'src/resumability-journal/purpose-persistence-v2/core/' + name + '.ts'
      ),
      'src/resumability-journal/producer-adapter/index.ts',
      'src/resumability-journal/capture-handoff/index.ts',
      'src/resumability-journal/execution-coordinator/store-port.ts',
      ...['index', 'database', 'transaction', 'records', 'errors'].map(
        name => 'src/resumability-journal/purpose-persistence-v2/idb/' + name + '.ts'
      ),
      'src/lib/chatgpt-producer-evidence.ts',
      'src/lib/producer-evidence-data.ts',
      'src/lib/chatgpt-capture-contract.ts',
      'src/lib/base64.ts',
      'src/lib/archive-stage-contract.ts',
      'src/lib/chatgpt-owner-context.ts',
    ];
    expect([...seen].map(relative).sort()).toEqual(expected.sort());
    for (const file of seen) {
      const text = readFileSync(file, 'utf8');
      expect(text, relative(file)).not.toMatch(
        /\b(?:chrome|browser|document|window|navigator|localStorage|sessionStorage|crypto)\s*[.(]|\b(?:fetch|XMLHttpRequest|WebSocket|Worker|SharedWorker|EventSource|setInterval|eval|Function|postMessage|deleteDatabase|deleteObjectStore)\s*\(/u
      );
      if (
        file !== path.join(directory, 'database.ts') &&
        file !== path.join(directory, 'transaction.ts') &&
        !file.includes(path.join('purpose-persistence-v2', 'idb'))
      )
        expect(text, relative(file)).not.toMatch(
          /\b(?:globalThis|indexedDB|performance)\s*[.(]|\bDate\s*\.\s*now\s*\(|new\s+Date\s*\(\s*\)|\b(?:setTimeout|clearTimeout)\s*\(/u
        );
    }
  });
  it('has zero external production consumers and no build, manifest, HTML or dist wiring', () => {
    for (const file of files(path.join(root, 'src')).filter(file => /\.[jt]sx?$/u.test(file))) {
      for (const reference of references(file, false, true)) {
        const target = path.resolve(path.dirname(file), reference);
        if (target === directory || target.startsWith(directory + path.sep))
          expect(file.startsWith(directory + path.sep), relative(file)).toBe(true);
      }
    }
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
      ...(existsSync(path.join(root, 'dist'))
        ? files(path.join(root, 'dist')).filter(file => /\.(?:js|html|json)$/u.test(file))
        : []),
    ];
    for (const file of config)
      expect(readFileSync(file, 'utf8'), relative(file)).not.toMatch(
        /baseline-owner|liska-baseline-owner|createBaselineOwner|reserveNextChatGpt/u
      );
  });
  it('preserves every baseline-plan source blob at the agreed base (v1/v2 have independent pinned tests)', () => {
    const baseline = JSON.parse(
      readFileSync(
        path.join(root, 'test/resumability-journal/baseline-owner/baseline-source.json'),
        'utf8'
      )
    ) as { base: string; files: { file: string; hash: string }[] };
    expect(baseline.base).toBe('de13928e5cc097301487ad5a3cbba611fb268842');
    expect(
      files(path.join(root, 'src/resumability-journal/baseline-plan')).map(relative).sort()
    ).toEqual(baseline.files.map(item => item.file).sort());
    for (const item of baseline.files) {
      const bytes = Buffer.from(
        readFileSync(path.join(root, item.file), 'utf8').replaceAll('\r\n', '\n')
      );
      expect(
        createHash('sha1')
          .update(Buffer.from('blob ' + bytes.length + '\0'))
          .update(bytes)
          .digest('hex'),
        item.file
      ).toBe(item.hash);
    }
  });
});
