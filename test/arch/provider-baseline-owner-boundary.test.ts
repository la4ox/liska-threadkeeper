// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as ownerApi from '../../src/resumability-journal/provider-baseline-owner';
import {
  createProviderBaselineOwner,
  PROVIDER_OPERATIONS_STORE_NAME,
  PROVIDER_OWNER_DATABASE_NAME,
  PROVIDER_OWNER_DATABASE_VERSION,
  PROVIDER_OWNER_KEY,
  PROVIDER_OWNER_STORE_NAME,
} from '../../src/resumability-journal/provider-baseline-owner';
import {
  MAX_PROVIDER_OWNER_BYTES,
  PROVIDER_OWNER_SCHEMA,
} from '../../src/resumability-journal/provider-baseline-owner/envelope';
import { PROVIDER_BASELINE_LIMITS } from '../../src/resumability-journal/provider-baseline/contracts';
import { sha256 } from '../resumability-journal/provider-baseline-owner/fixtures';

const root = path.resolve(import.meta.dirname, '../..');
const directory = path.join(root, 'src/resumability-journal/provider-baseline-owner');
const imports: Record<string, string[]> = {
  'errors.ts': [],
  'database.ts': ['./errors'],
  'transaction.ts': ['./database', './errors'],
  'inventory.ts': ['./database', './envelope', './errors', './transaction'],
  'envelope.ts': [
    '../../archive/catalog/admission',
    '../baseline-plan/plan',
    '../baseline-plan/contracts',
    '../provider-baseline/checkpoint',
    '../provider-baseline/operation',
    '../provider-baseline/contracts',
    '../purpose-persistence-v3/core/record',
    '../purpose-persistence-v3/core/control',
    './errors',
  ],
  'index.ts': [
    '../../archive/catalog/admission',
    '../../archive/catalog/conversation-key',
    '../baseline-plan/plan',
    '../baseline-plan/contracts',
    '../baseline-plan/data',
    '../provider-baseline/checkpoint',
    '../provider-baseline/contracts',
    '../provider-baseline/operation',
    '../provider-baseline/progress',
    '../purpose',
    '../purpose-persistence-v3/core/record',
    '../purpose-persistence-v3/core/control',
    './database',
    './inventory',
    './transaction',
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

function references(file: string, runtimeOnly = false, allowDynamic = false): string[] {
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
      if (!allowDynamic) throw new Error('dynamic import: ' + file);
      expect(node.arguments).toHaveLength(1);
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
  return [base + '.ts', path.join(base, 'index.ts'), base].find(value => existsSync(value));
}

function relative(file: string) {
  return path.relative(root, file).replaceAll('\\', '/');
}

describe('isolated reservation-only provider baseline owner boundary', () => {
  it('pins exactly six modules, every direct import, schema, namespace and retained limits', () => {
    expect(
      files(directory)
        .map(file => path.basename(file))
        .sort()
    ).toEqual(Object.keys(imports).sort());
    for (const [name, expected] of Object.entries(imports))
      expect(references(path.join(directory, name)).sort(), name).toEqual([...expected].sort());
    expect([
      PROVIDER_OWNER_DATABASE_NAME,
      PROVIDER_OWNER_DATABASE_VERSION,
      PROVIDER_OWNER_KEY,
      PROVIDER_OWNER_STORE_NAME,
      PROVIDER_OPERATIONS_STORE_NAME,
      PROVIDER_OWNER_SCHEMA,
    ]).toEqual([
      'liska-baseline-owner-v2',
      1,
      'baseline',
      'owner',
      'operations',
      'liska-baseline-owner/2',
    ]);
    expect(MAX_PROVIDER_OWNER_BYTES).toBe(128 + 1024 * 1024 + 1024 * 1024 + 64 * 1024);
    expect(PROVIDER_BASELINE_LIMITS).toMatchObject({
      maxObservations: 128,
      maxWindows: 64,
      maxReservationSlots: 16,
      maxCheckpointBytes: 64 * 1024,
    });
  });

  it('exports only factory, fixed constants and fixed error at runtime with an exact owner prototype', () => {
    expect(Object.keys(ownerApi).sort()).toEqual(
      [
        'ProviderOwnerStorageError',
        'createProviderBaselineOwner',
        'PROVIDER_OPERATIONS_STORE_NAME',
        'PROVIDER_OWNER_DATABASE_NAME',
        'PROVIDER_OWNER_DATABASE_VERSION',
        'PROVIDER_OWNER_KEY',
        'PROVIDER_OWNER_STORE_NAME',
      ].sort()
    );
    const owner = createProviderBaselineOwner({ indexedDB: new IDBFactory(), sha256 });
    expect(Reflect.ownKeys(Object.getPrototypeOf(owner)).sort()).toEqual(
      [
        'constructor',
        'open',
        'close',
        'create',
        'readSnapshot',
        'applyControl',
        'reserveNext',
        'recoverAfterRestart',
        'inspectReservation',
      ].sort()
    );
    owner.close();
  });

  it('pins the exact pure provider/journal closure plus only its own IDB and timer adapters', () => {
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
      ...Object.keys(imports).map(
        name => 'src/resumability-journal/provider-baseline-owner/' + name
      ),
      ...['contracts', 'data', 'plan'].map(
        name => 'src/resumability-journal/baseline-plan/' + name + '.ts'
      ),
      ...['checkpoint', 'contracts', 'operation', 'progress'].map(
        name => 'src/resumability-journal/provider-baseline/' + name + '.ts'
      ),
      ...['admission', 'encode', 'contracts', 'format', 'safe-input', 'conversation-key'].map(
        name => 'src/archive/catalog/' + name + '.ts'
      ),
      ...['index', 'contracts', 'data', 'validation', 'relations'].map(
        name => 'src/resumability-journal/purpose/' + name + '.ts'
      ),
      ...['record', 'data', 'errors', 'control'].map(
        name => 'src/resumability-journal/purpose-persistence-v3/core/' + name + '.ts'
      ),
      'src/resumability-journal/producer-adapter/index.ts',
      'src/resumability-journal/claude-producer-adapter/index.ts',
      'src/lib/chatgpt-producer-evidence.ts',
      'src/lib/claude-producer-evidence.ts',
      'src/lib/producer-evidence-data.ts',
    ];
    expect([...seen].map(relative).sort()).toEqual(expected.sort());
    for (const file of seen) {
      const source = readFileSync(file, 'utf8');
      expect(source, relative(file)).not.toMatch(
        /\b(?:chrome|browser|document|window|navigator|localStorage|sessionStorage)\s*[.(]|\b(?:fetch|XMLHttpRequest|WebSocket|Worker|SharedWorker|EventSource|setInterval|eval|Function|postMessage|deleteDatabase|deleteObjectStore)\s*\(/u
      );
      if (
        file !== path.join(directory, 'database.ts') &&
        file !== path.join(directory, 'transaction.ts')
      )
        expect(source, relative(file)).not.toMatch(
          /\b(?:globalThis|indexedDB|performance)\s*[.(]|\bDate\s*\.\s*now\s*\(|new\s+Date\s*\(\s*\)|\b(?:setTimeout|clearTimeout)\s*\(/u
        );
    }
  });

  it('creates exactly two out-of-line key stores with no indexes or auto increment', async () => {
    const factory = new IDBFactory();
    const owner = createProviderBaselineOwner({
      indexedDB: factory,
      sha256,
      databaseName: PROVIDER_OWNER_DATABASE_NAME + '-arch',
    });
    await owner.open();
    owner.close();
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(PROVIDER_OWNER_DATABASE_NAME + '-arch', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect([...database.objectStoreNames]).toEqual(['operations', 'owner']);
    const transaction = database.transaction(['owner', 'operations'], 'readonly');
    for (const name of ['owner', 'operations']) {
      const store = transaction.objectStore(name);
      expect(store.keyPath).toBeNull();
      expect(store.autoIncrement).toBe(false);
      expect(store.indexNames).toHaveLength(0);
    }
    database.close();
  });

  it('has zero production/config/manifest/dist consumers or wiring', () => {
    for (const file of files(path.join(root, 'src')).filter(file => /\.[cm]?[jt]sx?$/u.test(file)))
      for (const reference of references(file, false, true)) {
        const target = path.resolve(path.dirname(file), reference);
        if (target === directory || target.startsWith(directory + path.sep))
          expect(file.startsWith(directory + path.sep), relative(file)).toBe(true);
      }
    const marker =
      /provider-baseline-owner|liska-baseline-owner-v2|liska-baseline-owner\/2|createProviderBaselineOwner/u;
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
      expect(readFileSync(file, 'utf8'), relative(file)).not.toMatch(marker);
  });

  it('contains no execution, retry, settlement, migration, pruning or provider-effect surface', () => {
    const source = files(directory)
      .map(file => readFileSync(file, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(
      /createExecutionPort|claimDispatch|consumeDispatch|dispatchToken|producerCallback|requestChatGpt|requestClaude|\bsettle(?:ment)?\b|replacement|scheduler|automaticContinuation|deleteDatabase|deleteObjectStore/u
    );
    expect(source).not.toMatch(/executionAuthorized\s*:\s*true/u);
  });
});
