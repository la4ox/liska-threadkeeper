import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { Script } from 'node:vm';
import ts from 'typescript';
import { build as viteBuild } from 'vite';

const ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_DIST = resolve(ROOT, 'dist');
const DEFAULT_SOURCE = resolve(ROOT, 'src/content/capture/claude-scroll-prime-main.ts');
export const CLAUDE_SCROLL_PRIME_CLASSIC_ENTRY = 'claude-scroll-prime-main.js';
const GENERATED_ASSET =
  /^assets\/claude-scroll-prime-main(?:\.ts)?(?:-loader)?-[A-Za-z0-9_-]+\.js$/;
const GENERATED_LOADER = /^assets\/claude-scroll-prime-main\.ts-loader-[A-Za-z0-9_-]+\.js$/;
const EXACT_MATCHES = JSON.stringify(['https://claude.ai/*']);

class ClaudeScrollPrimeBuildError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ClaudeScrollPrimeBuildError';
  }
}

function fail(code) {
  throw new ClaudeScrollPrimeBuildError(code);
}

function inside(root, file) {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function filesWithin(root, directory = root) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) fail('symlink-in-build');
    if (entry.isDirectory()) files.push(...filesWithin(root, file));
    else if (entry.isFile()) files.push(relative(root, file).split(sep).join('/'));
  }
  return files;
}

function parseManifest(root) {
  try {
    const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
    if (!manifest || !Array.isArray(manifest.content_scripts)) fail('invalid-manifest');
    return manifest;
  } catch (error) {
    if (error instanceof ClaudeScrollPrimeBuildError) throw error;
    fail('invalid-manifest');
  }
}

function claudeEntry(manifest) {
  const entries = manifest.content_scripts.filter(
    entry =>
      entry?.run_at === 'document_start' &&
      entry.world === 'MAIN' &&
      JSON.stringify(entry.matches) === EXACT_MATCHES
  );
  if (entries.length !== 1) fail('claude-entry-count');
  const entry = entries[0];
  if (
    !Array.isArray(entry.js) ||
    entry.js.length !== 1 ||
    typeof entry.js[0] !== 'string' ||
    (entry.js[0] !== CLAUDE_SCROLL_PRIME_CLASSIC_ENTRY && !GENERATED_LOADER.test(entry.js[0])) ||
    (entry.all_frames !== undefined && entry.all_frames !== false)
  ) {
    fail('invalid-claude-entry');
  }
  return entry;
}

function inspectClassic(code) {
  let source;
  try {
    source = ts.createSourceFile(
      CLAUDE_SCROLL_PRIME_CLASSIC_ENTRY,
      code,
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.JS
    );
  } catch {
    fail('invalid-classic-script');
  }
  let moduleSyntax = false;
  let dynamicImport = false;
  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) moduleSyntax = true;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      dynamicImport = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (moduleSyntax || dynamicImport || ts.isExternalModule(source)) fail('emitted-module-syntax');
  if (
    /\bchrome\s*\./.test(code) ||
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/.test(code)
  ) {
    fail('forbidden-main-authority');
  }
  try {
    new Script(code, { filename: CLAUDE_SCROLL_PRIME_CLASSIC_ENTRY });
  } catch {
    fail('invalid-classic-script');
  }
}

export async function compileClaudeScrollPrimeMain(sourcePath = DEFAULT_SOURCE) {
  let result;
  try {
    result = await viteBuild({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        target: 'chrome111',
        minify: false,
        sourcemap: false,
        lib: {
          entry: sourcePath,
          formats: ['iife'],
          name: 'LiskaClaudeScrollPrimeMain',
          fileName: () => CLAUDE_SCROLL_PRIME_CLASSIC_ENTRY,
        },
      },
    });
  } catch {
    fail('classic-build-failed');
  }
  const outputs = Array.isArray(result) ? result : [result];
  const emitted = outputs.flatMap(output => output.output ?? []);
  const chunks = emitted.filter(item => item.type === 'chunk');
  const assets = emitted.filter(item => item.type === 'asset');
  if (chunks.length !== 1 || !chunks[0].isEntry || assets.length !== 0)
    fail('unexpected-classic-output');
  const code = chunks[0].code;
  inspectClassic(code);
  return code.endsWith('\n') ? code : `${code}\n`;
}

function referencedElsewhere(root, manifest, entry, candidates, files) {
  const projected = JSON.stringify({
    ...manifest,
    web_accessible_resources: undefined,
    content_scripts: manifest.content_scripts.map(script =>
      script === entry ? { ...script, js: [CLAUDE_SCROLL_PRIME_CLASSIC_ENTRY] } : script
    ),
  });
  for (const candidate of candidates) {
    if (projected.includes(JSON.stringify(candidate))) fail('generated-asset-still-referenced');
    const leaf = candidate.split('/').at(-1);
    for (const file of files) {
      if (candidates.has(file) || file === 'manifest.json') continue;
      if (!/\.(?:html|m?js)$/.test(file)) continue;
      const code = readFileSync(resolve(root, file), 'utf8');
      if (code.includes(candidate) || (leaf && code.includes(leaf)))
        fail('generated-asset-still-referenced');
    }
  }
}

export async function buildClaudeScrollPrimeMain(
  distDirectory = DEFAULT_DIST,
  sourcePath = DEFAULT_SOURCE
) {
  const code = await compileClaudeScrollPrimeMain(sourcePath);
  let root;
  try {
    root = realpathSync(distDirectory);
    if (!statSync(root).isDirectory()) fail('invalid-build-directory');
  } catch (error) {
    if (error instanceof ClaudeScrollPrimeBuildError) throw error;
    fail('invalid-build-directory');
  }
  const manifest = parseManifest(root);
  const entry = claudeEntry(manifest);
  const files = filesWithin(root);
  if (!entry.js.every(file => files.includes(file))) fail('missing-claude-entry-file');
  const candidates = new Set(files.filter(file => GENERATED_ASSET.test(file)));
  if (entry.js[0] !== CLAUDE_SCROLL_PRIME_CLASSIC_ENTRY && !candidates.has(entry.js[0]))
    fail('missing-generated-loader');
  referencedElsewhere(root, manifest, entry, candidates, files);
  entry.js = [CLAUDE_SCROLL_PRIME_CLASSIC_ENTRY];
  if (manifest.web_accessible_resources !== undefined) {
    if (!Array.isArray(manifest.web_accessible_resources)) fail('invalid-manifest');
    manifest.web_accessible_resources = manifest.web_accessible_resources
      .map(resource => {
        if (!Array.isArray(resource?.resources)) fail('invalid-manifest');
        return {
          ...resource,
          resources: resource.resources.filter(file => !candidates.has(file)),
        };
      })
      .filter(resource => resource.resources.length > 0);
  }
  writeFileSync(resolve(root, CLAUDE_SCROLL_PRIME_CLASSIC_ENTRY), code);
  writeFileSync(resolve(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of candidates) {
    const target = resolve(root, file);
    if (!inside(root, target) || !existsSync(target)) fail('invalid-generated-asset');
    unlinkSync(target);
  }
  return {
    ok: true,
    entry: CLAUDE_SCROLL_PRIME_CLASSIC_ENTRY,
    bytes: Buffer.byteLength(code),
    removedArtifacts: [...candidates].sort(),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  buildClaudeScrollPrimeMain(process.argv[2], process.argv[3])
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => {
      console.error(
        JSON.stringify({
          ok: false,
          code: error instanceof ClaudeScrollPrimeBuildError ? error.message : 'build-failed',
        })
      );
      process.exitCode = 1;
    });
}
