/** Run after production build: node test/snapshot-analysis/check-built-page.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const DEFAULT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
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
  /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|showDirectoryPicker|showOpenFilePicker|showSaveFilePicker|createWritable|removeEntry|writeFile|unlink|rename|readdir|mkdir|rmSync)\b/u;
const PRIVATE_CODE =
  /liska-snapshot-analysis\/1|snapshot-evidence\/1|selection-read-failed|snapshot_title|liska-snapshot-analysis\.json/u;

function assert(value, code) {
  if (!value) throw new Error(code);
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

function inspectJavaScript(source, pure) {
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
    if (ts.isIdentifier(node)) assert(!FORBIDDEN.test(node.text), 'forbidden-built-capability');
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const chain = member(node);
      if (chain.startsWith('chrome.')) {
        assert(
          !pure &&
            ALLOWED_CHROME.some(allowed => allowed === chain || allowed.startsWith(chain + '.')),
          'unexpected-built-chrome-capability'
        );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return imports;
}

/** Returns technical bundle paths only; no user-selected files enter this guard. */
export function checkBuiltSnapshotPage(dist = DEFAULT_DIST) {
  dist = path.resolve(dist);
  const page = path.join(dist, 'src/snapshot-analysis/snapshot-analysis.html');
  const html = fs.readFileSync(page, 'utf8');
  assert(
    html.includes("connect-src 'none'") && html.includes("object-src 'none'"),
    'missing-page-csp'
  );
  assert(!html.includes('modulepreload'), 'unexpected-modulepreload');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gu)].map(match =>
    resolveLocal(dist, page, match[1])
  );
  const styles = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/gu)].map(match =>
    resolveLocal(dist, page, match[1])
  );
  assert(scripts.length === 1 && styles.length > 0, 'missing-page-assets');
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
  const wars = new Set((manifest.web_accessible_resources ?? []).flatMap(item => item.resources));
  const exposed = file =>
    [...wars].some(pattern => {
      const escaped = pattern
        .split('*')
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
        .join('.*');
      return new RegExp(`^${escaped}$`, 'u').test(file);
    });
  const relative = value => path.relative(dist, value).split(path.sep).join('/');
  assert(!exposed(relative(page)) && !exposed(relative(scripts[0])), 'page-exposed-as-war');
  const pending = [...scripts];
  const visited = new Set();
  const shared = [];
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    assert(
      !/storage|offscreen|service-worker|index\.ts-/u.test(path.basename(file)),
      'destination-layer-in-page-closure'
    );
    const source = fs.readFileSync(file, 'utf8');
    const publicChunk = exposed(relative(file));
    if (publicChunk) {
      assert(!PRIVATE_CODE.test(source), 'analyzer-or-ui-exposed-as-war');
      shared.push(relative(file));
    }
    for (const imported of inspectJavaScript(source, publicChunk))
      pending.push(resolveLocal(dist, file, imported));
  }
  for (const file of styles) {
    const source = fs.readFileSync(file, 'utf8');
    assert(!/@import|url\s*\(/iu.test(source), 'external-style-resource');
  }
  const loader = fs.readFileSync(path.join(dist, manifest.background.service_worker), 'utf8');
  assert(
    /service-worker\.ts-/u.test(loader) && !/snapshotAnalysis/u.test(loader),
    'wrong-service-worker-entry'
  );
  return {
    page: relative(page),
    chunks: [...visited].map(relative).sort(),
    sharedPureChunks: shared.sort(),
    styles: styles.map(relative),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(checkBuiltSnapshotPage(process.argv[2]), null, 2));
}
