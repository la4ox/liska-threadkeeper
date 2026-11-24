// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const modulePath = 'src/claude-baseline';
const imports: Record<string, readonly string[]> = {
  'account-admission-contracts.ts': ['./contracts'],
  'account-admission.ts': [
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

  it('has zero consumers or references in other production source files', () => {
    const external = files('src').filter(file => !file.startsWith(modulePath + '/'));
    expect(external.length).toBeGreaterThan(100);
    for (const file of external) {
      expect(readFileSync(path.join(root, file), 'utf8'), file).not.toMatch(marker);
      if (!/\.[cm]?[jt]sx?$/u.test(file)) continue;
      for (const reference of references(tree(file))) {
        if (!reference.startsWith('.')) continue;
        const target = resolve(file, reference);
        expect(target === modulePath || target?.startsWith(modulePath + '/'), file).not.toBe(true);
      }
    }
  });

  it('has no configuration, package, build, HTML or manifest wiring', () => {
    const candidates = [
      ...files('scripts'),
      ...files('src').filter(file => /\.(?:html|json)$/u.test(file)),
      ...readdirSync(root).filter(
        file => /(?:config|manifest|package)/u.test(file) && /\.(?:json|ts|js|mjs)$/u.test(file)
      ),
    ];
    expect(candidates).toContain('src/manifest.json');
    expect(candidates).toContain('vite.config.ts');
    expect(candidates).toContain('package.json');
    for (const file of candidates)
      expect(readFileSync(path.join(root, file), 'utf8'), file).not.toMatch(marker);
  });
});
