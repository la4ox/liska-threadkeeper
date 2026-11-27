// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const modulePath = 'src/account-catalog-owner';
const imports: Record<string, readonly string[]> = {
  'codec.ts': [
    '../claude-baseline/account-admission-contracts',
    '../claude-baseline/account-admission-snapshot',
    '../claude-baseline/contracts',
    '../claude-baseline/data',
    './errors',
  ],
  'database.ts': ['../claude-baseline/contracts', '../claude-baseline/data', './errors'],
  'errors.ts': [],
  'index.ts': [
    './codec',
    './database',
    './errors',
    './inventory',
    './transaction',
    './codec',
    './database',
    './errors',
  ],
  'inventory.ts': ['./codec', './errors', './transaction'],
  'transaction.ts': ['./database', './errors'],
};
const marker =
  /account-catalog-owner|liska-account-catalog-slot\/1|account-slot\/1:|openAccountCatalog|createPausedClaude|ACCOUNT_CATALOG_DATABASE/u;
const disallowed =
  /^(?:fetch|XMLHttpRequest|WebSocket|EventSource|URL|Request|Response|chrome|browser|window|document|navigator|localStorage|sessionStorage|caches|Date|performance|crypto|setInterval|Worker|SharedWorker|BroadcastChannel|postMessage|sendMessage|require|process|eval|Function|console|File|Blob|capture|scheduler|download|credentials)$/u;
const otherDomains =
  /^(?:node:|https?:|chrome-extension:)|liska-(?:snapshot-catalog|baseline-owner|claude-account-baseline-owner)|provider-baseline-owner|resumability-journal|service-worker|capture\/|scheduler/u;

function read(file: string): string {
  return readFileSync(path.join(root, file), 'utf8');
}

function files(folder: string): string[] {
  return readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap(entry => {
    const file = [folder, entry.name].join('/');
    return entry.isDirectory() ? files(file) : [file];
  });
}

describe('unwired multi-account catalog storage boundary', () => {
  it('pins exact static imports and prohibits effects beyond the isolated IndexedDB and bounded timers', () => {
    expect(files(modulePath).sort()).toEqual(
      Object.keys(imports)
        .map(file => [modulePath, file].join('/'))
        .sort()
    );
    for (const [file, expected] of Object.entries(imports)) {
      const source = ts.createSourceFile(
        file,
        read([modulePath, file].join('/')),
        ts.ScriptTarget.Latest,
        true
      );
      const actual: string[] = [];
      function visit(node: ts.Node) {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier
        ) {
          expect(ts.isStringLiteralLike(node.moduleSpecifier), file).toBe(true);
          if (ts.isStringLiteralLike(node.moduleSpecifier)) actual.push(node.moduleSpecifier.text);
        }
        expect(ts.isImportTypeNode(node) || ts.isImportEqualsDeclaration(node), file).toBe(false);
        if (ts.isIdentifier(node)) expect(node.text, file).not.toMatch(disallowed);
        if (ts.isStringLiteralLike(node)) expect(node.text, file).not.toMatch(otherDomains);
        if (ts.isCallExpression(node))
          expect(node.expression.kind, file).not.toBe(ts.SyntaxKind.ImportKeyword);
        ts.forEachChild(node, visit);
      }
      visit(source);
      expect(actual.sort(), file).toEqual([...expected].sort());
    }
  });

  it('allows only fixed DB initialization, bounded cursor reads and add-only record insertion', () => {
    const database = read(modulePath + '/database.ts');
    expect(database).toMatch(/ACCOUNT_CATALOG_DATABASE = 'liska-account-catalog-owner-v1';/u);
    expect(database).toMatch(/ACCOUNT_CATALOG_DATABASE_VERSION = 1;/u);
    expect(database).toMatch(/SLOTS = 'slots';/u);
    expect(database).toMatch(/OWNERS = 'owners';/u);
    expect(database).toMatch(
      /factory\.open\(ACCOUNT_CATALOG_DATABASE, ACCOUNT_CATALOG_DATABASE_VERSION\)/u
    );
    const all = files(modulePath).map(read).join('\n');
    expect(all.match(/\bcreateObjectStore\s*\(/gu)).toHaveLength(1);
    expect(all.match(/\.openKeyCursor\s*\(/gu)).toHaveLength(1);
    expect(all.match(/\.add\s*\(/gu)).toHaveLength(2);
    expect(all.match(/\.delete\s*\(/gu)).toHaveLength(1);
    expect(read(modulePath + '/transaction.ts')).toMatch(/this\.pending\.delete\(/u);
    expect(all).not.toMatch(
      /\.(?:deleteDatabase|deleteObjectStore|createIndex|deleteIndex|clear|put|update|getAll|getAllKeys)\s*\(/u
    );
  });

  it('has no production consumer, manifest, HTML, build-script or package wiring', () => {
    for (const file of [
      ...files('src').filter(file => !file.startsWith(modulePath + '/')),
      ...files('scripts'),
      ...readdirSync(root).filter(file =>
        /(?:config|manifest|package).*\.(?:json|ts|js|mjs)$/u.test(file)
      ),
    ])
      expect(read(file), file).not.toMatch(marker);
  });
});
