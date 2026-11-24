/** Direct opt-in MV3 packaging; no production build or installed browser effects. */
import console from 'node:console';
import process from 'node:process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'vite';
import {
  ROOT,
  fail,
  filesWithin,
  safeOutputDirectory,
  sha256,
} from './generate-official-zip-browser-fixtures.mjs';

const harness = 'test/browser/claude-account-baseline-owner/';
const owner = 'src/claude-account-baseline-owner/';
const baseline = 'src/claude-baseline/';
export const DEFAULT_EXTENSION = resolve(
  ROOT,
  'test-results/claude-account-baseline-owner-browser/extension'
);
export const INVENTORY = Object.freeze(['index.html', 'manifest.json', 'runner.js']);
export const SOURCE_CLOSURE = Object.freeze(
  [
    ...['fixture', 'runner', 'scenario'].map(name => harness + name + '.ts'),
    ...['codec', 'database', 'errors', 'index', 'transaction'].map(name => owner + name + '.ts'),
    ...[
      'account-admission-contracts',
      'account-admission-snapshot',
      'contracts',
      'data',
      'enumeration',
      'scope',
    ].map(name => baseline + name + '.ts'),
  ].sort()
);
const csp =
  "default-src 'self'; script-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; style-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'";

function manifestBytes() {
  const raw = readFileSync(resolve(ROOT, harness, 'manifest.json'));
  const expected = {
    manifest_version: 3,
    name: 'Synthetic Claude paused owner acceptance (test only)',
    version: '1.0.0',
    permissions: [],
    host_permissions: [],
    options_ui: { page: 'index.html', open_in_tab: true },
    content_security_policy: { extension_pages: csp },
  };
  if (JSON.stringify(JSON.parse(raw.toString('utf8'))) !== JSON.stringify(expected))
    fail('unsafe-harness-manifest');
  return raw;
}

function htmlBytes() {
  const bytes = readFileSync(resolve(ROOT, harness, 'index.html'));
  const html = bytes.toString('utf8');
  if (
    /\b(?:href|action)\s*=|\bon\w+\s*=|<iframe\b|<style\b/iu.test(html) ||
    (html.match(/\bsrc\s*=/giu) ?? []).length !== 1 ||
    (html.match(/<script\b/giu) ?? []).length !== 1 ||
    !html.includes('<script type="module" src="./runner.js"></script>')
  )
    fail('unsafe-harness-html');
  return bytes;
}

function inspectRunner(bundle) {
  if (/\b(?:https?|wss?):|sourceMappingURL/u.test(bundle)) fail('unexpected-runtime-authority');
  const source = ts.createSourceFile(
    'runner.js',
    bundle,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const authority =
    /^(?:fetch|XMLHttpRequest|WebSocket|EventSource|chrome|browser|localStorage|sessionStorage|importScripts|eval|Worker|Function|require)$/u;
  function visit(node) {
    if (
      ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && authority.test(node.text)) ||
      ts.isImportDeclaration(node) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
      (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
    )
      fail('unexpected-runtime-authority');
    ts.forEachChild(node, visit);
  }
  visit(source);
}

export function inspectHarnessBuild(directory) {
  if (JSON.stringify(filesWithin(directory)) !== JSON.stringify(INVENTORY))
    fail('unexpected-build-inventory');
  for (const [file, expected] of [
    ['index.html', htmlBytes()],
    ['manifest.json', manifestBytes()],
  ])
    if (!readFileSync(resolve(directory, file)).equals(expected)) fail('unexpected-static-output');
  inspectRunner(readFileSync(resolve(directory, 'runner.js'), 'utf8'));
  return {
    ok: true,
    sourceModules: SOURCE_CLOSURE.length,
    files: INVENTORY.map(id => {
      const bytes = readFileSync(resolve(directory, id));
      return { id, bytes: bytes.length, sha256: sha256(bytes) };
    }),
  };
}

export async function buildClaudeAccountBaselineOwnerBrowser(directory = DEFAULT_EXTENSION) {
  const output = safeOutputDirectory(directory);
  if (filesWithin(output).length) inspectHarnessBuild(output);
  const manifest = manifestBytes();
  const html = htmlBytes();
  mkdirSync(output, { recursive: true });
  await build({
    configFile: false,
    root: resolve(ROOT, harness),
    publicDir: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'exact-claude-owner-harness-closure',
        generateBundle(_options, bundle) {
          const actual = [...this.getModuleIds()]
            .map(file => relative(ROOT, file).replaceAll('\\', '/'))
            .sort();
          if (JSON.stringify(actual) !== JSON.stringify(SOURCE_CLOSURE))
            fail('unexpected-runtime-closure');
          const chunks = Object.values(bundle);
          const [entry] = chunks;
          if (
            chunks.length !== 1 ||
            entry.type !== 'chunk' ||
            entry.imports.length ||
            entry.dynamicImports.length
          )
            fail('unexpected-runtime-import');
        },
      },
    ],
    build: {
      lib: {
        entry: resolve(ROOT, harness, 'runner.ts'),
        formats: ['es'],
        fileName: () => 'runner.js',
      },
      outDir: output,
      emptyOutDir: false,
      sourcemap: false,
      minify: false,
      target: 'es2022',
    },
  });
  writeFileSync(resolve(output, 'index.html'), html);
  writeFileSync(resolve(output, 'manifest.json'), manifest);
  return inspectHarnessBuild(output);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log(JSON.stringify(await buildClaudeAccountBaselineOwnerBrowser(process.argv[2])));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error.code ?? 'harness-build-failed' }));
    process.exitCode = 1;
  }
}
