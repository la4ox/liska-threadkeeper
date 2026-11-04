/** Run after production build: node test/resumability-journal/page/check-built-page.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const DEFAULT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist');
const ALLOWED_CHROME = [
  'chrome.i18n.getMessage',
  'chrome.i18n.getUILanguage',
  'chrome.runtime.lastError',
  'chrome.downloads.download',
  'chrome.downloads.search',
  'chrome.downloads.onChanged.addListener',
  'chrome.downloads.onChanged.removeListener',
];
const FORBIDDEN =
  /^(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|showDirectoryPicker|showOpenFilePicker|showSaveFilePicker|createWritable|removeEntry|getDirectory|getFileHandle|writeFile|unlink|rename|readdir|mkdir|rmSync)$/u;
const PRIVATE_CODE =
  /liska-resumability-journal\/1|explicit-catalog-selection|journal_title|liska-resumability-journal\.json/u;
function assert(value, code) {
  if (!value) throw new Error(code);
}
function member(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return `${member(node.expression)}.${node.name.text}`;
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteralLike(node.argumentExpression)
  )
    return `${member(node.expression)}.${node.argumentExpression.text}`;
  return '';
}
export function inspectJournalJavaScript(source, publicChunk = false) {
  const tree = ts.createSourceFile(
    'built.js',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const imports = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      assert(ts.isStringLiteralLike(node.moduleSpecifier), 'uninspectable-built-import');
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      assert(
        node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]),
        'dynamic-built-import'
      );
      imports.push(node.arguments[0].text);
    }
    if (ts.isIdentifier(node)) {
      assert(!FORBIDDEN.test(node.text), 'forbidden-built-capability');
      assert(!publicChunk || node.text !== 'indexedDB', 'public-indexeddb-capability');
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const chain = member(node);
      if (chain.startsWith('chrome.'))
        assert(
          !publicChunk &&
            ALLOWED_CHROME.some(value => value === chain || value.startsWith(chain + '.')),
          'unexpected-built-chrome-capability'
        );
      assert(!/^navigator\.storage|\.innerHTML$|^console\./u.test(chain), 'forbidden-built-member');
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return imports;
}
function resolveLocal(dist, from, reference) {
  assert(
    typeof reference === 'string' && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(reference),
    'external-built-import'
  );
  const target = path.resolve(
    reference.startsWith('/') ? dist : path.dirname(from),
    reference.replace(/^\//u, '')
  );
  assert(
    target.startsWith(dist + path.sep) && fs.existsSync(target),
    'missing-or-escaping-built-asset'
  );
  return target;
}
function exposedMatcher(manifest) {
  const patterns = (manifest.web_accessible_resources ?? []).flatMap(item => item.resources);
  return file =>
    patterns.some(pattern => {
      const escaped = pattern
        .split('*')
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
        .join('.*');
      return new RegExp(`^${escaped}$`, 'u').test(file);
    });
}
/** Paths are technical build artifacts, never selected user data. */
export function checkBuiltJournalPage(dist = DEFAULT_DIST) {
  dist = path.resolve(dist);
  const page = path.join(dist, 'src/resumability-journal/page/journal.html');
  const html = fs.readFileSync(page, 'utf8');
  for (const directive of [
    "connect-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "worker-src 'none'",
  ])
    assert(html.includes(directive), 'missing-page-csp');
  assert(!html.includes('modulepreload'), 'unexpected-modulepreload');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gu)].map(match =>
    resolveLocal(dist, page, match[1])
  );
  const styles = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/gu)].map(match =>
    resolveLocal(dist, page, match[1])
  );
  assert(scripts.length === 1 && styles.length > 0, 'missing-page-assets');
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
  const exposed = exposedMatcher(manifest);
  const relative = value => path.relative(dist, value).split(path.sep).join('/');
  assert(!exposed(relative(page)) && !exposed(relative(scripts[0])), 'journal-page-exposed-as-war');
  const pending = [...scripts];
  const visited = new Set();
  const shared = [];
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    assert(
      !/offscreen|service-worker|index\.ts-/u.test(path.basename(file)),
      'execution-layer-in-journal-closure'
    );
    const source = fs.readFileSync(file, 'utf8');
    const publicChunk = exposed(relative(file));
    if (publicChunk) {
      assert(!PRIVATE_CODE.test(source), 'journal-exposed-as-war');
      shared.push(relative(file));
    }
    for (const imported of inspectJournalJavaScript(source, publicChunk))
      pending.push(resolveLocal(dist, file, imported));
  }
  for (const file of styles)
    assert(!/@import|url\s*\(/iu.test(fs.readFileSync(file, 'utf8')), 'external-style-resource');
  // No startup/content entry acquires journal recovery or execution authority.
  const otherPending = [
    manifest.background.service_worker,
    ...(manifest.content_scripts ?? []).flatMap(item => item.js),
  ].map(file => path.resolve(dist, file));
  const otherSeen = new Set();
  while (otherPending.length) {
    const file = otherPending.pop();
    if (otherSeen.has(file)) continue;
    otherSeen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    assert(!PRIVATE_CODE.test(source), 'journal-in-startup-or-content');
    const tree = ts.createSourceFile(
      'other.js',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );
    function follow(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      )
        otherPending.push(resolveLocal(dist, file, node.moduleSpecifier.text));
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteralLike(node.arguments[0])
      )
        otherPending.push(resolveLocal(dist, file, node.arguments[0].text));
      ts.forEachChild(node, follow);
    }
    follow(tree);
  }
  return {
    page: relative(page),
    chunks: [...visited].map(relative).sort(),
    sharedPureChunks: shared.sort(),
    styles: styles.map(relative),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  console.log(JSON.stringify(checkBuiltJournalPage(process.argv[2]), null, 2));
