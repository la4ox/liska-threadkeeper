/** Direct opt-in Node CLI only. Never loads production Vite/CRX configuration. */
import console from 'node:console';
import process from 'node:process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
export const DEFAULT_EXTENSION = resolve(ROOT, 'test-results/baseline-owner-browser/extension');
export const HARNESS_ROOT = resolve(ROOT, 'test/browser/baseline-owner');
export const INVENTORY = Object.freeze([
  'assets/runner.js',
  'assets/style.css',
  'index.html',
  'manifest.json',
]);
export const CSP =
  "default-src 'self'; script-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; style-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'";

/** LF source-context hashes pin every denied ambient-default replacement, not real core logic. */
export const DENIED_SOURCES = Object.freeze({
  'src/lib/messaging.ts': {
    sha256: 'd47f746a174ae757ae8d1d3305cdc95ca86420fab68623f6ceaae302663d7f55',
    exports: ['sendMessage'],
  },
  'src/lib/export-operation-scope.ts': {
    sha256: '9dc488bd1bcf039f1987c642ab80beed39980de66f1b5ed0cb61df1e3bab8ae1',
    exports: [
      'installExportScope',
      'captureExportScope',
      'clearExportScope',
      'installTextPreviewScope',
      'captureTextPreviewScope',
      'captureOperationGeneration',
      'clearTextPreviewScope',
      'withExportGeneration',
      'withOperationGeneration',
      'prepareRuntimeMessage',
      'takePreparedRuntimeMessage',
    ],
  },
  'src/content/capture/chatgpt-current-branch.ts': {
    sha256: '727cdf9e3aac206f9e6eb4b5ca5e6e8122cb8f9f006265c479c2baea1f4895ed',
    seam: `export function manifestAllowsChatGptStructuredCapture(): boolean {
  try {
    const manifest = globalThis.chrome?.runtime?.getManifest?.();
    return isScriptingPermission(manifest?.permissions);
  } catch {
    return false;
  }
}`,
  },
  'src/content/staged-binary-persistence.ts': {
    sha256: 'fdb33e6b0e2f8072270252a795c38d4a337d03923cdebd3da28761a370437946',
    functionName: 'persistVerifiedBinaryAssets',
  },
});

export function validateHarnessManifest(manifest) {
  const expected = {
    manifest_version: 3,
    name: 'Synthetic baseline owner acceptance (test only)',
    version: '1.0.0',
    permissions: [],
    host_permissions: [],
    options_ui: { page: 'index.html', open_in_tab: true },
    content_security_policy: { extension_pages: CSP },
  };
  const exact = value => {
    if (Array.isArray(value)) return value.map(exact);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map(key => [key, exact(value[key])])
      );
    return value;
  };
  if (JSON.stringify(exact(manifest)) !== JSON.stringify(exact(expected)))
    fail('unsafe-harness-manifest');
}

const normalized = code => code.replaceAll('\r\n', '\n');
export function transformDeniedSource(
  source,
  code,
  sentinel = resolve(HARNESS_ROOT, 'denied-effects.ts')
) {
  const pinned = DENIED_SOURCES[source];
  const text = normalized(code);
  if (!pinned || sha256(text) !== pinned.sha256) fail('denied-source-drift');
  const imported = `import { denyAmbientEffect } from ${JSON.stringify(sentinel)};\n`;
  if (pinned.exports)
    return (
      imported +
      `export { ${pinned.exports.map(name => `denyAmbientEffect as ${name}`).join(', ')} };\n`
    );
  if (pinned.functionName) {
    const parsed = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true);
    const matches = parsed.statements.filter(
      node => ts.isFunctionDeclaration(node) && node.name?.text === pinned.functionName
    );
    if (matches.length !== 1) fail('denied-seam-drift');
    const node = matches[0];
    return (
      imported +
      text.slice(0, node.getStart(parsed)) +
      `export function ${pinned.functionName}(): never { return denyAmbientEffect(); }` +
      text.slice(node.end)
    );
  }
  if (text.split(pinned.seam).length !== 2) fail('denied-seam-drift');
  return (
    imported +
    text.replace(
      pinned.seam,
      'export function manifestAllowsChatGptStructuredCapture(): boolean { return denyAmbientEffect(); }'
    )
  );
}

export function validateDeniedReplacements(replaced) {
  if (JSON.stringify([...replaced].sort()) !== JSON.stringify(Object.keys(DENIED_SOURCES).sort()))
    fail('unexpected-denied-replacements');
}

export function inspectHarnessBuild(output) {
  const inventory = filesWithin(output);
  if (JSON.stringify(inventory) !== JSON.stringify(INVENTORY)) fail('unexpected-build-inventory');
  validateHarnessManifest(JSON.parse(readFileSync(resolve(output, 'manifest.json'), 'utf8')));
  for (const file of ['assets/runner.js', 'assets/style.css', 'index.html']) {
    const code = readFileSync(resolve(output, file), 'utf8');
    // Endpoint/fetch literals in real capture modules are dormant. CSP + counted throwing
    // network sentinels deny those effects dynamically; other ambient authority stays banned.
    let authority = false;
    if (file.endsWith('.js')) {
      const parsed = ts.createSourceFile(
        file,
        code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
      );
      const banned = new Set([
        'chrome',
        'browser',
        'localStorage',
        'sessionStorage',
        'clipboard',
        'importScripts',
        'eval',
      ]);
      const visit = node => {
        if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && banned.has(node.text))
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
          (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'Function'
        )
          authority = true;
        if (
          ts.isImportDeclaration(node) ||
          (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
          (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
        )
          authority = true;
        ts.forEachChild(node, visit);
      };
      visit(parsed);
    }
    if (
      authority ||
      /sourceMappingURL/.test(code) ||
      /\b(?:import|export)\s*(?:\(|[^;\n]*\bfrom\s*)\s*['"](?:https?:|\/\/)|\b(?:src|href)\s*=\s*['"](?:https?:|\/\/)/i.test(
        code
      )
    )
      fail('unexpected-runtime-authority');
  }
  const html = readFileSync(resolve(output, 'index.html'), 'utf8');
  const references = [...html.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi)].map(
    match => match[2]
  );
  if (
    !html.includes('src="./assets/runner.js"') ||
    !html.includes('href="./assets/style.css"') ||
    /<script(?![^>]*\bsrc=)[^>]*>|\bon\w+\s*=|\bstyle\s*=|<style\b|\bmodulepreload\b/i.test(html) ||
    JSON.stringify(references.sort()) !==
      JSON.stringify(['./assets/runner.js', './assets/style.css']) ||
    [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].some(match => match[1].trim())
  )
    fail('unexpected-html-authority');
  return {
    ok: true,
    deniedAmbientEffects: Object.keys(DENIED_SOURCES).length,
    files: inventory.map(id => {
      const bytes = readFileSync(resolve(output, id));
      return { id, bytes: bytes.length, sha256: sha256(bytes) };
    }),
  };
}

export async function buildBaselineOwnerBrowser(directory = DEFAULT_EXTENSION) {
  const output = safeOutputDirectory(directory);
  if (filesWithin(output).length) inspectHarnessBuild(output);
  const manifestBytes = readFileSync(resolve(HARNESS_ROOT, 'manifest.json'));
  validateHarnessManifest(JSON.parse(manifestBytes.toString('utf8')));
  // Check all pins before creating or writing output, including modules tree-shaken later.
  for (const source of Object.keys(DENIED_SOURCES))
    transformDeniedSource(source, readFileSync(resolve(ROOT, source), 'utf8'));
  const exactIds = new Map(
    Object.keys(DENIED_SOURCES).map(source => [resolve(ROOT, source).replaceAll('\\', '/'), source])
  );
  const replaced = new Set();
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
        name: 'exact-test-only-denied-ambient-defaults',
        enforce: 'pre',
        transform(code, id) {
          const source = exactIds.get(id.replaceAll('\\', '/'));
          if (!source) return null;
          if (replaced.has(source)) fail('duplicate-denied-replacement');
          replaced.add(source);
          return { code: transformDeniedSource(source, code), map: null };
        },
        generateBundle() {
          validateDeniedReplacements(replaced);
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
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log(JSON.stringify(await buildBaselineOwnerBrowser(process.argv[2])));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error.code ?? 'harness-build-failed' }));
    process.exitCode = 1;
  }
}
