/** Opt-in isolated MV3 build; never loads vite.config.ts or the production CRX plugin. */
import { Buffer } from 'node:buffer';
import console from 'node:console';
import process from 'node:process';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import {
  ROOT,
  DEFAULT_FIXTURES,
  createFixtureSet,
  fail,
  filesWithin,
  safeOutputDirectory,
  sha256,
} from './generate-official-zip-browser-fixtures.mjs';

export const DEFAULT_EXTENSION = resolve(ROOT, 'test-results/official-zip-browser/extension');
export const HARNESS_ROOT = resolve(ROOT, 'test/browser/official-zip');
export const INVENTORY = Object.freeze([
  'assets/runner.js',
  'assets/style.css',
  'fixture-index.json',
  'index.html',
  'manifest.json',
]);
const CSP =
  "default-src 'self'; script-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; style-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'";

export function validateHarnessManifest(manifest) {
  const keys = [
    'content_security_policy',
    'host_permissions',
    'manifest_version',
    'name',
    'options_ui',
    'permissions',
    'version',
  ];
  if (
    JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(keys) ||
    manifest.manifest_version !== 3 ||
    manifest.name !== 'Synthetic official ZIP acceptance (test only)' ||
    manifest.version !== '1.0.0' ||
    JSON.stringify(manifest.permissions) !== '[]' ||
    JSON.stringify(manifest.host_permissions) !== '[]' ||
    JSON.stringify(manifest.options_ui) !== '{"page":"index.html","open_in_tab":true}' ||
    JSON.stringify(manifest.content_security_policy) !== JSON.stringify({ extension_pages: CSP })
  )
    fail('unsafe-harness-manifest');
}

export function inspectHarnessBuild(output, expectedIndex) {
  const inventory = filesWithin(output);
  if (JSON.stringify(inventory) !== JSON.stringify(INVENTORY)) fail('unexpected-build-inventory');
  const manifest = JSON.parse(readFileSync(resolve(output, 'manifest.json'), 'utf8'));
  validateHarnessManifest(manifest);
  const indexBytes = readFileSync(resolve(output, 'fixture-index.json'));
  if (!indexBytes.equals(expectedIndex)) fail('fixture-index-mismatch');
  for (const file of ['assets/runner.js', 'assets/style.css', 'index.html']) {
    const code = readFileSync(resolve(output, file), 'utf8');
    if (
      /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|localStorage|sessionStorage|indexedDB|clipboard|console)\b/.test(
        code
      ) ||
      /(?:https?|wss?):|sourceMappingURL|\beval\s*\(|new\s+Function\s*\(/i.test(code) ||
      /\bchrome\s*[.[]/.test(code)
    )
      fail('unexpected-runtime-authority');
  }
  const html = readFileSync(resolve(output, 'index.html'), 'utf8');
  if (
    !html.includes('src="./assets/runner.js"') ||
    !html.includes('href="./assets/style.css"') ||
    /<script(?![^>]*\bsrc=)[^>]*>|\bon\w+\s*=|<style\b/i.test(html)
  )
    fail('unexpected-html-authority');
  return {
    ok: true,
    files: inventory.map(file => {
      const bytes = readFileSync(resolve(output, file));
      return { id: file, bytes: bytes.length, sha256: sha256(bytes) };
    }),
  };
}

export async function buildOfficialZipBrowser(
  directory = DEFAULT_EXTENSION,
  fixtureIndex = resolve(DEFAULT_FIXTURES, 'fixture-index.json')
) {
  const output = safeOutputDirectory(directory);
  safeOutputDirectory(dirname(fixtureIndex));
  if (resolve(fixtureIndex) !== resolve(dirname(fixtureIndex), 'fixture-index.json'))
    fail('unexpected-index-path');
  if (resolve(dirname(fixtureIndex)) === output) fail('overlapping-output');
  const indexStat = lstatSync(fixtureIndex);
  if (!indexStat.isFile() || indexStat.isSymbolicLink()) fail('unsafe-index-path');
  const indexBytes = readFileSync(fixtureIndex);
  const expectedIndex = createFixtureSet().files.get('fixture-index.json');
  if (!indexBytes.equals(expectedIndex)) fail('fixture-index-mismatch');
  const existing = filesWithin(output);
  // A previous build is reusable only after a full inventory/authority validation.
  if (existing.length) inspectHarnessBuild(output, expectedIndex);
  const manifestBytes = readFileSync(resolve(HARNESS_ROOT, 'manifest.json'));
  validateHarnessManifest(JSON.parse(manifestBytes.toString('utf8')));
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
        name: 'synthetic-fixture-index-only',
        resolveId(id) {
          if (id === 'virtual:official-zip-fixture-index') return '\0synthetic-fixture-index';
        },
        load(id) {
          if (id === '\0synthetic-fixture-index')
            return `export default ${indexBytes.toString('utf8')};`;
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
  writeFileSync(resolve(output, 'fixture-index.json'), Buffer.from(indexBytes));
  return inspectHarnessBuild(output, expectedIndex);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log(JSON.stringify(await buildOfficialZipBrowser(process.argv[2], process.argv[3])));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error.code ?? 'harness-build-failed' }));
    process.exitCode = 1;
  }
}
