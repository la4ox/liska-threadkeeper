/** Independent opt-in lifecycle build. Never loads production Vite/CRX configuration. */
import console from 'node:console';
import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import ts from 'typescript';
import {
  ROOT,
  fail,
  filesWithin,
  safeOutputDirectory,
  sha256,
} from './generate-official-zip-browser-fixtures.mjs';

export { ROOT, filesWithin, safeOutputDirectory, sha256 };
export const DEFAULT_EXTENSION = resolve(
  ROOT,
  'test-results/provider-baseline-owner-lifecycle-browser/extension'
);
export const HARNESS_ROOT = resolve(ROOT, 'test/browser/provider-baseline-owner-lifecycle');
export const INVENTORY = Object.freeze([
  'assets/runner.js',
  'assets/style.css',
  'index.html',
  'manifest.json',
]);
export const CSP =
  "default-src 'self'; script-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; style-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'";
export const SOURCE_CLOSURE = Object.freeze(
  [
    ...['runner.ts', 'scenario.ts', 'capabilities.ts', 'style.css'].map(
      name => 'test/browser/provider-baseline-owner-lifecycle/' + name
    ),
    ...[
      'index',
      'database',
      'transaction',
      'inventory',
      'envelope',
      'errors',
      'execution',
      'port',
    ].map(name => 'src/resumability-journal/provider-baseline-owner/' + name + '.ts'),
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
    ...['chatgpt-producer-evidence', 'claude-producer-evidence', 'producer-evidence-data'].map(
      name => 'src/lib/' + name + '.ts'
    ),
  ].sort()
);
const local = file => relative(ROOT, file).replaceAll('\\', '/');
const exact = value =>
  Array.isArray(value)
    ? value.map(exact)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map(key => [key, exact(value[key])])
        )
      : value;

export function validateHarnessManifest(manifest) {
  const expected = {
    manifest_version: 3,
    name: 'Synthetic provider owner lifecycle acceptance (test only)',
    version: '1.0.0',
    permissions: [],
    host_permissions: [],
    options_ui: { page: 'index.html', open_in_tab: true },
    content_security_policy: { extension_pages: CSP },
  };
  if (JSON.stringify(exact(manifest)) !== JSON.stringify(exact(expected)))
    fail('unsafe-harness-manifest');
}

/** Follow runtime declarations, including re-exports; type-only compatibility contracts are inert. */
export function runtimeReferences(file, code) {
  const tree = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const references = [];
  const visit = node => {
    if (
      (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) ||
      ts.isImportEqualsDeclaration(node)
    )
      fail('unexpected-source-import');
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) fail('unexpected-source-import');
      const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
      const typeOnly = ts.isExportDeclaration(node)
        ? node.isTypeOnly
        : clause?.isTypeOnly ||
          (!clause?.name &&
            clause?.namedBindings &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.length > 0 &&
            clause.namedBindings.elements.every(item => item.isTypeOnly));
      if (!typeOnly) references.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return references;
}
export function inspectSourceClosure(readSource = file => readFileSync(file, 'utf8')) {
  const pending = [resolve(HARNESS_ROOT, 'runner.ts')],
    seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    const id = local(file);
    if (!SOURCE_CLOSURE.includes(id)) fail('unexpected-source-closure');
    seen.add(file);
    if (file.endsWith('.css')) continue;
    for (const reference of runtimeReferences(file, readSource(file))) {
      if (!reference.startsWith('.')) fail('unexpected-source-import');
      const base = resolve(dirname(file), reference);
      const target = [base + '.ts', resolve(base, 'index.ts'), base].find(candidate =>
        existsSync(candidate)
      );
      if (!target) fail('unexpected-source-import');
      pending.push(target);
    }
  }
  const paths = [...seen].map(local).sort();
  if (JSON.stringify(paths) !== JSON.stringify(SOURCE_CLOSURE)) fail('unexpected-source-closure');
  return paths;
}
export function validateRuntimeModules(ids) {
  const expected = [
    ...SOURCE_CLOSURE,
    'test/browser/provider-baseline-owner-lifecycle/index.html',
  ].sort();
  const actual = [...ids].map(id => local(id)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('unexpected-runtime-closure');
}

export function inspectHarnessBuild(output) {
  const inventory = filesWithin(output);
  if (JSON.stringify(inventory) !== JSON.stringify(INVENTORY)) fail('unexpected-build-inventory');
  validateHarnessManifest(JSON.parse(readFileSync(resolve(output, 'manifest.json'), 'utf8')));
  for (const file of ['assets/runner.js', 'assets/style.css', 'index.html']) {
    const code = readFileSync(resolve(output, file), 'utf8');
    let authority = /sourceMappingURL|\b(?:https?|wss?):|(?:src|href)\s*=\s*["']\s*\/\//iu.test(
      code
    );
    if (file.endsWith('.js')) {
      const tree = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const banned = new Set([
        'chrome',
        'browser',
        'localStorage',
        'sessionStorage',
        'clipboard',
        'Worker',
        'SharedWorker',
        'ServiceWorker',
        'serviceWorker',
        'importScripts',
        'eval',
        'postMessage',
      ]);
      const visit = node => {
        if (
          (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
          /^\s*\/\//u.test(node.text)
        )
          authority = true;
        if (
          (ts.isIdentifier(node) ||
            ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node)) &&
          banned.has(node.text)
        )
          authority = true;
        if (
          (ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
          node.text === 'Function' &&
          !(
            ts.isBinaryExpression(node.parent) &&
            node.parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
            node.parent.right === node
          )
        )
          authority = true;
        if (
          ts.isImportDeclaration(node) ||
          (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
          (ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(node.expression) && node.expression.text === 'require')))
        )
          authority = true;
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
    if (authority || /@import\b|\burl\s*\(/iu.test(code)) fail('unexpected-runtime-authority');
  }
  const html = readFileSync(resolve(output, 'index.html'), 'utf8');
  const references = [...html.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/giu)].map(
    match => match[2]
  );
  if (
    !html.includes('src="./assets/runner.js"') ||
    !html.includes('href="./assets/style.css"') ||
    /<script(?![^>]*\bsrc=)[^>]*>|\bon\w+\s*=|\bstyle\s*=|<style\b|\bmodulepreload\b/iu.test(
      html
    ) ||
    JSON.stringify(references.sort()) !==
      JSON.stringify(['./assets/runner.js', './assets/style.css']) ||
    [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/giu)].some(match => match[1].trim())
  )
    fail('unexpected-html-authority');
  return {
    ok: true,
    sourceModules: SOURCE_CLOSURE.length,
    runtimeModules: SOURCE_CLOSURE.length + 1,
    files: inventory.map(id => {
      const bytes = readFileSync(resolve(output, id));
      return { id, bytes: bytes.length, sha256: sha256(bytes) };
    }),
  };
}

export function protectedState() {
  return [
    'dist',
    'src/manifest.json',
    'vite.config.ts',
    'vitest.config.ts',
    'tsconfig.json',
    'eslint.config.js',
    'package.json',
    'package-lock.json',
    'scripts/build-baseline-owner-browser.mjs',
    'test/browser/baseline-owner',
    'test/scripts/baseline-owner-browser-harness.test.ts',
    'scripts/build-provider-baseline-owner-browser.mjs',
    'test/browser/provider-baseline-owner',
    'test/scripts/provider-baseline-owner-browser-harness.test.ts',
  ].map(file => {
    const target = resolve(ROOT, file);
    if (!existsSync(target)) return [file, null];
    if (file === 'dist' || file.startsWith('test/browser/'))
      return [file, filesWithin(target).map(id => [id, sha256(readFileSync(resolve(target, id)))])];
    return [file, sha256(readFileSync(target))];
  });
}
export async function buildProviderBaselineOwnerLifecycleBrowser(directory = DEFAULT_EXTENSION) {
  const before = JSON.stringify(protectedState());
  try {
    const output = safeOutputDirectory(directory);
    if (filesWithin(output).length) inspectHarnessBuild(output);
    const manifestBytes = readFileSync(resolve(HARNESS_ROOT, 'manifest.json'));
    validateHarnessManifest(JSON.parse(manifestBytes.toString('utf8')));
    inspectSourceClosure();
    mkdirSync(output, { recursive: true });
    await build({
      configFile: false,
      root: HARNESS_ROOT,
      base: './',
      publicDir: false,
      logLevel: 'silent',
      clearScreen: false,
      plugins: [
        {
          name: 'exact-provider-owner-lifecycle-only-closure',
          generateBundle(_options, bundle) {
            validateRuntimeModules(this.getModuleIds());
            for (const item of Object.values(bundle))
              if (
                item.type === 'chunk' &&
                (item.imports.length || item.dynamicImports.length || item.isDynamicEntry)
              )
                fail('unexpected-runtime-import');
          },
        },
      ],
      build: {
        outDir: output,
        emptyOutDir: false,
        copyPublicDir: false,
        sourcemap: false,
        modulePreload: false,
        target: 'es2022',
        cssCodeSplit: false,
        minify: false,
        rollupOptions: {
          input: resolve(HARNESS_ROOT, 'index.html'),
          output: {
            entryFileNames: 'assets/runner.js',
            chunkFileNames: 'assets/unexpected-[hash].js',
            assetFileNames: 'assets/style.css',
          },
        },
      },
    });
    writeFileSync(resolve(output, 'manifest.json'), manifestBytes);
    return inspectHarnessBuild(output);
  } finally {
    if (JSON.stringify(protectedState()) !== before) fail('protected-state-changed');
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log(JSON.stringify(await buildProviderBaselineOwnerLifecycleBrowser(process.argv[2])));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error.code ?? 'harness-build-failed' }));
    process.exitCode = 1;
  }
}
