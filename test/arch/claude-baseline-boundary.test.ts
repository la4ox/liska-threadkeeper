// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const modulePath = 'src/claude-baseline';
const ownerPath = 'src/claude-account-baseline-owner';
const harnessBuilder = 'scripts/build-claude-account-baseline-owner-browser.mjs';
const imports: Record<string, readonly string[]> = {
  'account-admission-contracts.ts': ['./contracts'],
  'account-admission.ts': [
    './account-admission-contracts',
    './contracts',
    './data',
    './enumeration',
  ],
  'account-admission-snapshot.ts': [
    './account-admission-contracts',
    './contracts',
    './data',
    './enumeration',
  ],
  'contracts.ts': [],
  'data.ts': ['./contracts'],
  'enumeration.ts': ['./contracts', './data', './scope'],
  'scope.ts': ['./contracts', './data'],
  'index.ts': [
    './account-admission',
    './account-admission-snapshot',
    './account-admission-contracts',
    './enumeration',
    './contracts',
  ],
};
const marker =
  /claude-baseline|liska-claude-account-baseline-catalog\/1|liska-claude-personal-scope-attestation\/1|enumerateClaudeBaselineCatalog|ClaudeBaselineCatalog|liska-claude-account-catalog-(?:admission|scope)\/1|admitClaudeAccountCatalog|ClaudeAccountCatalogAdmission|ClaudeAccountScopeSha256|manual-same-visible-personal-context/u;
const bannedIdentifier =
  /^(?:fetch|XMLHttpRequest|WebSocket|EventSource|URL|URLSearchParams|Request|Response|AbortController|chrome|browser|window|document|navigator|globalThis|self|localStorage|sessionStorage|indexedDB|caches|Storage|Date|performance|crypto|setTimeout|clearTimeout|setInterval|clearInterval|queueMicrotask|requestAnimationFrame|Worker|SharedWorker|BroadcastChannel|MessageChannel|postMessage|sendMessage|addEventListener|dispatchEvent|require|process|Buffer|eval|Function|Promise|console|capture|exportConversation|skipDetail|skipCapture|cursor|scheduler|journal|persist|dispatch|settle|retry)$/u;
const bannedOutcome =
  /^(?:unchanged|changed|newer|older|current|complete|completed|up-to-date|skip_detail|skip_capture|authenticated)$/u;

function files(folder: string): string[] {
  return readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap(entry => {
    const file = `${folder}/${entry.name}`;
    return entry.isDirectory() ? files(file) : [file];
  });
}
function tree(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(path.join(root, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
}
/** Includes type-only, nested dynamic-loader and import-type references. */
function references(source: ts.SourceFile): string[] {
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
    ) {
      expect(node.arguments.length).toBe(1);
      expect(ts.isStringLiteralLike(node.arguments[0])).toBe(true);
      if (ts.isStringLiteralLike(node.arguments[0])) output.push(node.arguments[0].text);
    }
    if (ts.isImportEqualsDeclaration(node)) {
      expect(ts.isExternalModuleReference(node.moduleReference)).toBe(true);
      if (ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression) {
        expect(ts.isStringLiteralLike(node.moduleReference.expression)).toBe(true);
        if (ts.isStringLiteralLike(node.moduleReference.expression))
          output.push(node.moduleReference.expression.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return output;
}
function resolve(file: string, reference: string): string | undefined {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), reference));
  return [base + '.ts', base + '/index.ts', base].find(candidate =>
    existsSync(path.join(root, candidate))
  );
}

function wiringCandidates(): string[] {
  return [
    ...files('scripts').filter(file => file !== harnessBuilder),
    ...files('src').filter(file => /\.(?:html|json)$/u.test(file)),
    ...readdirSync(root).filter(
      file => /(?:config|manifest|package)/u.test(file) && /\.(?:json|ts|js|mjs)$/u.test(file)
    ),
  ];
}

describe('unwired pure Claude baseline catalog boundary', () => {
  it('pins every source file and its exact runtime and type import closure', () => {
    expect(files(modulePath).sort()).toEqual(
      Object.keys(imports)
        .map(name => `${modulePath}/${name}`)
        .sort()
    );
    for (const [file, expected] of Object.entries(imports))
      expect(references(tree(`${modulePath}/${file}`)).sort(), file).toEqual([...expected].sort());
    const pending = [`${modulePath}/index.ts`];
    const seen = new Set<string>();
    while (pending.length) {
      const file = pending.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      expect(file.startsWith(modulePath + '/'), file).toBe(true);
      for (const reference of references(tree(file))) {
        expect(reference.startsWith('./'), file).toBe(true);
        const target = resolve(file, reference);
        expect(target, reference).toBeDefined();
        pending.push(target!);
      }
    }
    expect([...seen].sort()).toEqual(files(modulePath).sort());
  });

  it('contains no network, browser, storage, clock, timer, journal, capture, export, scheduler or UI authority', () => {
    for (const file of files(modulePath)) {
      const source = tree(file);
      const isAdmission = file === `${modulePath}/account-admission.ts`;
      const isAdmissionContract = file === `${modulePath}/account-admission-contracts.ts`;
      function visit(node: ts.Node) {
        if (ts.isIdentifier(node)) {
          // The digest port may type or check a native promise, but never create ambient work.
          const isDigestPromise =
            (isAdmission || isAdmissionContract) &&
            node.text === 'Promise' &&
            (ts.isTypeReferenceNode(node.parent) ||
              (isAdmission &&
                ts.isPropertyAccessExpression(node.parent) &&
                node.parent.expression === node &&
                node.parent.name.text === 'prototype') ||
              (isAdmission &&
                ts.isBinaryExpression(node.parent) &&
                node.parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
                node.parent.right === node));
          if (!isDigestPromise) expect(node.text, file).not.toMatch(bannedIdentifier);
        }
        if (ts.isStringLiteralLike(node)) {
          expect(node.text, file).not.toMatch(bannedOutcome);
          // The exact origin is data in the digest domain, never a route or an effect.
          if (!(isAdmission && node.text === 'https://claude.ai'))
            expect(node.text, file).not.toMatch(
              /^(?:node:|https?:|chrome-extension:)|liska-snapshot-catalog|archive\/catalog|resumability-journal|extractors|service-worker|update-discovery|capture\/|scheduler/u
            );
        }
        if (ts.isCallExpression(node))
          expect(node.expression.kind).not.toBe(ts.SyntaxKind.ImportKeyword);
        if (ts.isPropertyAccessExpression(node))
          expect(node.getText(source)).not.toBe('Math.random');
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  });

  it('admits only the storage-only owner codecs and the trusted collector bridge as consumers', () => {
    const external = files('src').filter(file => !file.startsWith(modulePath + '/'));
    expect(external.length).toBeGreaterThan(100);
    const consumers = new Set<string>();
    for (const file of external) {
      if (marker.test(readFileSync(path.join(root, file), 'utf8'))) consumers.add(file);
      if (!/\.[cm]?[jt]sx?$/u.test(file)) continue;
      for (const reference of references(tree(file))) {
        if (!reference.startsWith('.')) continue;
        const target = resolve(file, reference);
        if (target === modulePath || target?.startsWith(modulePath + '/')) consumers.add(file);
      }
    }
    expect([...consumers].sort()).toEqual(
      [
        'src/account-catalog-owner/codec.ts',
        'src/account-catalog-owner/database.ts',
        'src/background/claude-account-collector.ts',
        `${ownerPath}/codec.ts`,
      ].sort()
    );
  });

  it('has no configuration, package, production build, HTML or manifest wiring', () => {
    const candidates = wiringCandidates();
    expect(candidates).toContain('src/manifest.json');
    expect(candidates).toContain('vite.config.ts');
    expect(candidates).toContain('package.json');
    for (const file of candidates)
      expect(
        file === 'scripts/check-service-worker-runtime.mjs'
          ? readFileSync(path.join(root, file), 'utf8').replace(
              'liska-claude-account-catalog-admission/1',
              ''
            )
          : readFileSync(path.join(root, file), 'utf8'),
        file
      ).not.toMatch(marker);
  });
});

describe('Claude one-shot account owner boundary', () => {
  const ownerImports: Record<string, readonly string[]> = {
    'codec.ts': [
      '../claude-baseline/account-admission-contracts',
      '../claude-baseline/account-admission-snapshot',
      '../claude-baseline/contracts',
      '../claude-baseline/data',
      './errors',
    ],
    'database.ts': ['./errors'],
    'errors.ts': [],
    'index.ts': [
      './codec',
      './database',
      './errors',
      './errors',
      './transaction',
      './codec',
      './database',
    ],
    'transaction.ts': ['./database', './errors'],
  };
  const ownerMarker =
    /claude-account-baseline-owner|claude-account-collection\/1|openClaudeAccountBaselineOwner|ClaudeAccountBaselineOwner|CLAUDE_ACCOUNT_(?:BASELINE_OWNER|COLLECTION_ID)/u;

  it('pins the exact owner sources and static dependencies, without adopting a legacy owner', () => {
    expect(files(ownerPath).sort()).toEqual(
      Object.keys(ownerImports)
        .map(name => `${ownerPath}/${name}`)
        .sort()
    );
    for (const [file, dependencies] of Object.entries(ownerImports))
      expect(references(tree(`${ownerPath}/${file}`)).sort(), file).toEqual(
        [...dependencies].sort()
      );
  });

  it('permits only its fixed single-store creation, bounded inventory reads and insert', () => {
    const source = Object.fromEntries(
      files(ownerPath).map(file => [
        path.posix.basename(file),
        readFileSync(path.join(root, file), 'utf8'),
      ])
    );
    expect(source['database.ts']).toMatch(/ = 'liska-claude-account-baseline-owner-v1';/u);
    expect(source['database.ts']).toMatch(/DATABASE_VERSION = 1;/u);
    expect(source['database.ts']).toMatch(/OWNER_STORE = 'owner';/u);
    expect(source['database.ts']).toMatch(/OWNER_KEY = 'baseline';/u);
    const all = Object.values(source).join('\n');
    expect(all.match(/\bcreateObjectStore\s*\(/gu)).toHaveLength(1);
    expect(all.match(/\.add\s*\(/gu)).toHaveLength(1);
    expect(all.match(/\.openKeyCursor\s*\(/gu)).toHaveLength(1);
    expect(all.match(/\.delete\s*\(/gu)).toHaveLength(1);
    expect(source['transaction.ts']).toMatch(/this\.pending\.delete\(/u);
    expect(all).not.toMatch(
      /\b(?:deleteDatabase|deleteObjectStore|createIndex|deleteIndex|clear|put|update|activate|reserve|advance|replace|appendPage|retry|recover)\s*\(/u
    );
  });

  it('grants no effects besides IndexedDB, cancellation listeners and bounded transaction timers', () => {
    const forbidden =
      /^(?:fetch|XMLHttpRequest|WebSocket|EventSource|URL|Request|Response|chrome|browser|window|document|navigator|localStorage|sessionStorage|caches|Date|performance|crypto|setInterval|Worker|BroadcastChannel|postMessage|sendMessage|require|process|eval|Function|console|File|Blob|capture|scheduler|download|credentials)$/u;
    for (const file of files(ownerPath)) {
      function visit(node: ts.Node) {
        if (ts.isIdentifier(node)) expect(node.text, file).not.toMatch(forbidden);
        if (ts.isStringLiteralLike(node))
          expect(node.text, file).not.toMatch(
            /^(?:node:|https?:|chrome-extension:)|liska-snapshot-catalog|provider-baseline-owner|resumability-journal|service-worker|capture\/|scheduler/u
          );
        if (ts.isCallExpression(node))
          expect(node.expression.kind, file).not.toBe(ts.SyntaxKind.ImportKeyword);
        ts.forEachChild(node, visit);
      }
      visit(tree(file));
    }
  });

  it('has only the collector controller as production importer and no separate entrypoint', () => {
    for (const file of [
      ...files('src').filter(file => !file.startsWith(ownerPath + '/')),
      ...wiringCandidates(),
    ]) {
      if (file === 'src/background/claude-account-collector.ts') {
        expect(
          references(tree(file)).filter(reference => reference.includes('baseline-owner'))
        ).toEqual(['../claude-account-baseline-owner']);
        continue;
      }
      expect(
        file === 'scripts/check-service-worker-runtime.mjs'
          ? readFileSync(path.join(root, file), 'utf8').replace(
              'liska-claude-account-baseline-owner-v1',
              ''
            )
          : readFileSync(path.join(root, file), 'utf8'),
        file
      ).not.toMatch(ownerMarker);
      if (!/\.[cm]?[jt]sx?$/u.test(file)) continue;
      for (const reference of references(tree(file))) {
        if (!reference.startsWith('.')) continue;
        const target = resolve(file, reference);
        expect(target === ownerPath || target?.startsWith(ownerPath + '/'), file).not.toBe(true);
      }
    }
    expect(readFileSync(path.join(root, harnessBuilder), 'utf8')).toMatch(/configFile: false/u);
  });
});
