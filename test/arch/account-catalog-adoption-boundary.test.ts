// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const modulePath = 'src/account-catalog-adoption';
const imports = {
  'index.ts': [
    '../account-catalog-owner',
    '../claude-baseline/contracts',
    '../claude-baseline/data',
    './legacy-source',
  ],
  'legacy-source.ts': [
    '../claude-account-baseline-owner/codec',
    '../claude-account-baseline-owner/database',
    '../claude-account-baseline-owner/errors',
  ],
};
const marker = /account-catalog-adoption|adoptLegacyClaudeCatalog|readLegacyCatalog/u;
const forbiddenIdentifiers =
  /^(?:fetch|XMLHttpRequest|WebSocket|EventSource|URL|Request|Response|chrome|browser|window|document|navigator|self|localStorage|sessionStorage|caches|Date|performance|crypto|setInterval|Worker|BroadcastChannel|postMessage|sendMessage|require|process|eval|Function|console|File|Blob|capture|scheduler|download|credentials|Reflect)$/u;
const forbiddenLiterals =
  /^(?:node:|https?:|chrome-extension:)|liska-snapshot-catalog|provider-baseline-owner|resumability-journal|service-worker|capture\/|scheduler/u;
const writes =
  /\b(?:deleteDatabase|createObjectStore|deleteObjectStore|createIndex|deleteIndex|commit|clear|add|put|update|delete|openCursor)\s*\(/u;

function files(folder: string): string[] {
  return readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap(entry => {
    const file = `${folder}/${entry.name}`;
    return entry.isDirectory() ? files(file) : [file];
  });
}

function read(file: string) {
  return readFileSync(path.join(root, file), 'utf8');
}

describe('offline legacy Claude catalog adoption boundary', () => {
  it('pins the bridge-only static imports and restricts ambient and dynamic effects', () => {
    expect(files(modulePath).sort()).toEqual(
      Object.keys(imports)
        .map(file => `${modulePath}/${file}`)
        .sort()
    );
    for (const [file, expected] of Object.entries(imports)) {
      const source = ts.createSourceFile(
        file,
        read(`${modulePath}/${file}`),
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
        if (ts.isIdentifier(node)) {
          expect(node.text, file).not.toMatch(forbiddenIdentifiers);
          if (node.text === 'globalThis')
            expect([file, node.parent.getText(source)]).toEqual([
              'index.ts',
              'globalThis.indexedDB',
            ]);
        }
        if (ts.isStringLiteralLike(node)) expect(node.text, file).not.toMatch(forbiddenLiterals);
        if (ts.isCallExpression(node))
          expect(node.expression.kind, file).not.toBe(ts.SyntaxKind.ImportKeyword);
        ts.forEachChild(node, visit);
      }
      visit(source);
      expect(actual.sort(), file).toEqual([...expected].sort());
    }
  });

  it('allows only an evidence-gated read-only source and the public destination API', () => {
    const source = read(`${modulePath}/legacy-source.ts`);
    const destination = read(`${modulePath}/index.ts`);
    expect(source.match(/\.open\s*\(/gu)).toHaveLength(1);
    expect(source).toContain('options.factory.open(NAME, VERSION)');
    expect(source).toContain('if (!(await discover(options)))');
    expect(source).toMatch(/factory\s*\.databases\(\)/u);
    expect(source).toContain("database.transaction(STORE, 'readonly')");
    expect(source.match(/\.transaction\s*\(/gu)).toHaveLength(1);
    expect(source).toContain('store.getAllKeys(undefined, 2)');
    expect(source).toContain('store.get(KEY)');
    expect(source + destination).not.toMatch(writes);
    expect(source + destination).not.toMatch(/['"]readwrite['"]/u);
    expect(destination).not.toMatch(/\.(?:open|transaction|getAllKeys|get|databases)\s*\(/u);
    expect(destination).toContain('await openAccountCatalog(');
    expect(destination).toContain('await catalog.createPausedClaude(');
    expect(destination).toContain('await catalog.readOwner(');
  });

  it('has no production caller, manifest, HTML, packaging or build entry', () => {
    const wiring = [
      ...files('src').filter(file => !file.startsWith(modulePath + '/')),
      ...files('scripts'),
      ...readdirSync(root).filter(file =>
        /(?:config|manifest|package).*\.(?:json|ts|js|mjs)$/u.test(file)
      ),
    ];
    expect(wiring).toEqual(
      expect.arrayContaining(['src/manifest.json', 'package.json', 'vite.config.ts'])
    );
    for (const file of wiring) expect(read(file), file).not.toMatch(marker);
  });
});
