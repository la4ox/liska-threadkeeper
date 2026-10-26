import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { characterEntities } from 'character-entities';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs build tooling, no type declarations
import { checkServiceWorkerRuntime } from '../../scripts/check-service-worker-runtime.mjs';
import viteConfig from '../../vite.config';

const root = resolve(import.meta.dirname, '../..');
const script = join(root, 'scripts/check-service-worker-runtime.mjs');
const decoderDir = dirname(
  createRequire(import.meta.url).resolve('decode-named-character-reference')
);
const tempDirs: string[] = [];

function fixture(files: Record<string, string>, serviceWorker = 'worker.js') {
  const directory = mkdtempSync(join(tmpdir(), 'liska-worker-runtime-'));
  tempDirs.push(directory);
  writeFileSync(
    join(directory, 'manifest.json'),
    JSON.stringify({ background: { service_worker: serviceWorker, type: 'module' } })
  );
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    writeFileSync(join(directory, file), content);
  }
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('emitted service-worker runtime closure guard', () => {
  it('traverses static imports, re-exports and literal dynamic imports, including cycles', () => {
    const files = {
      'worker.js': "import './chunks/child.js'; export { safe } from './chunks/export.js';",
      'chunks/child.js': "export * from './grandchild.mjs'; import('../lazy.js');",
      'chunks/export.js': 'export const safe = true;',
      'chunks/grandchild.mjs':
        "import '../worker.js'; export const text = 'document.createElement';",
      'lazy.js': 'export default 1;',
    };
    expect(checkServiceWorkerRuntime(fixture(files))).toEqual({
      ok: true,
      serviceWorker: 'worker.js',
      files: Object.keys(files).sort(),
      bytes: Object.values(files).reduce((sum, code) => sum + Buffer.byteLength(code), 0),
    });
  });

  it.each([
    "const element = document.createElement('i');",
    "const element = document['createElement']('i');",
    "const element = globalThis.document.createElement('i');",
    'const create = document.createElement;',
    "(() => document.createElement('i'))();",
    "class Decoder { static element = document.createElement('i'); }",
  ])('rejects eager DOM element creation: %s', code => {
    expect(() => checkServiceWorkerRuntime(fixture({ 'worker.js': code }))).toThrow(
      'eager-dom-create-element'
    );
  });

  it('rejects an eager DOM decoder in a transitive grandchild', () => {
    const directory = fixture({
      'worker.js': "import './child.js';",
      'child.js': "export * from './grandchild.js';",
      'grandchild.js': "const decoder = document.createElement('i'); export { decoder };",
    });
    expect(() => checkServiceWorkerRuntime(directory)).toThrow('eager-dom-create-element');
  });

  it('allows deferred DOM functions, including MAIN-world injected callbacks', () => {
    const directory = fixture({
      'worker.js': `
        function later() { return document.createElement('i'); }
        const arrow = () => document.createElement('i');
        const method = { run() { return document.createElement('i'); } };
        class Deferred { element = document.createElement('i'); }
        chrome.scripting.executeScript({
          world: 'MAIN', func: () => document.createElement('i')
        });
        export { later, arrow, method, Deferred };
      `,
    });
    expect(checkServiceWorkerRuntime(directory).ok).toBe(true);
  });

  it.each([
    ["import './missing.js';", 'missing-dependency'],
    ["import '../outside.js';", 'escaping-dependency'],
    ["import 'https://example.invalid/module.js';", 'external-dependency'],
    ["export * from 'package-name';", 'external-dependency'],
    ["import('/absolute.js');", 'escaping-dependency'],
    ["import('./data.json');", 'uninspectable-dependency'],
    ["import('./child.js?query');", 'uninspectable-dependency'],
    ['import(moduleName);', 'uninspectable-dependency'],
    ["importScripts('./child.js');", 'uninspectable-dependency'],
    ["self.importScripts('./child.js');", 'uninspectable-dependency'],
    ['const broken = ;', 'uninspectable-dependency'],
  ])('fails closed for an uninspectable closure: %s', (code, error) => {
    expect(() => checkServiceWorkerRuntime(fixture({ 'worker.js': code }))).toThrow(error);
  });

  it.each([
    [undefined, 'uninspectable-dependency'],
    ['missing.js', 'missing-dependency'],
    ['../outside.js', 'escaping-dependency'],
    ['https://example.invalid/worker.js', 'external-dependency'],
  ])('validates the manifest entry: %s', (entry, error) => {
    const directory = fixture({ 'worker.js': 'export const safe = true;' });
    writeFileSync(
      join(directory, 'manifest.json'),
      JSON.stringify({ background: { service_worker: entry } })
    );
    expect(() => checkServiceWorkerRuntime(directory)).toThrow(error);
  });

  it('runs the actual CLI with compact content-free pass and failure receipts', () => {
    const directory = fixture({ 'worker.js': 'export const safe = true;' });
    const passed = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
    expect(passed.status).toBe(0);
    expect(JSON.parse(passed.stdout)).toMatchObject({ ok: true, files: ['worker.js'] });
    expect(passed.stderr).toBe('');

    writeFileSync(join(directory, 'worker.js'), "document.createElement('private-source-text');");
    const rejected = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
    expect(rejected.status).toBe(1);
    expect(rejected.stdout).toBe('');
    expect(JSON.parse(rejected.stderr)).toEqual({ ok: false, code: 'eager-dom-create-element' });
    expect(rejected.stderr).not.toContain('private-source-text');
  });

  it('runs the guard after Vite in the normal build inherited by packaging', () => {
    const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(scripts.build).toMatch(
      /vite build\s*&&\s*node scripts\/check-service-worker-runtime\.mjs$/
    );
    expect(scripts['build:zip']).toMatch(/^npm run build\s*&&/);
  });

  it('aliases only the exact decoder package to its installed pure entry', () => {
    const config = viteConfig({
      command: 'build',
      mode: 'test',
      isSsrBuild: false,
      isPreview: false,
    });
    const alias = config.resolve.alias.find(item =>
      item.find.test('decode-named-character-reference')
    );
    expect(alias.replacement).toBe(join(decoderDir, 'index.js').replaceAll('\\', '/'));
    expect(alias.find.test('decode-named-character-reference/subpath')).toBe(false);
    expect(alias.find.test('prefix-decode-named-character-reference')).toBe(false);
    expect(config.resolve).not.toHaveProperty('conditions');
  });
});

describe('installed pure and DOM decoder parity', () => {
  async function decoders() {
    // Absolute files deliberately bypass package conditional exports for BOTH
    // entries, so this cannot silently compare one resolved implementation twice.
    const pure = await import(/* @vite-ignore */ pathToFileURL(join(decoderDir, 'index.js')).href);
    const dom = await import(
      /* @vite-ignore */ pathToFileURL(join(decoderDir, 'index.dom.js')).href
    );
    return [pure.decodeNamedCharacterReference, dom.decodeNamedCharacterReference];
  }

  it('matches every installed characterEntities key and its exact decoded value', async () => {
    const [pure, dom] = await decoders();
    expect(pure).not.toBe(dom);
    for (const [name, value] of Object.entries(characterEntities)) {
      expect(pure(name), name).toBe(value);
      expect(dom(name), name).toBe(value);
    }
  });

  it('matches invalid, prefix, case-sensitive, semicolon and multicodepoint cases', async () => {
    const [pure, dom] = await decoders();
    for (const name of [
      'semi',
      'notin',
      'notit',
      'noti',
      'unknown',
      '',
      'AMP',
      'amp',
      'Amp',
      'NOTIN',
      'NotEqualTilde',
      'fjlig',
      'acE',
      'constructor',
      '__proto__',
      'toString',
    ]) {
      expect(pure(name), name).toBe(dom(name));
    }
    expect(pure('semi')).toBe(';');
    expect(pure('notin')).toBe('∉');
    expect(pure('notit')).toBe(false);
    expect(pure('NotEqualTilde')).toBe('≂̸');
    expect(pure('fjlig')).toBe('fj');
  });

  it('preserves mdast text decoding without prefix or case over-decoding', () => {
    const tree = fromMarkdown('&semi; &notin; &notit; &Amp; &NotEqualTilde; &fjlig;');
    expect(tree.children[0]).toMatchObject({
      type: 'paragraph',
      children: [{ type: 'text', value: '; ∉ &notit; &Amp; ≂̸ fj' }],
    });
  });
});
