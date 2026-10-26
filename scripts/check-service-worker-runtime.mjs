/**
 * Inspect the emitted service-worker module closure, without executing it or
 * printing source content. This is a targeted decoder-regression guard, not a
 * general proof that arbitrary JavaScript is safe to evaluate in a worker.
 */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const DEFAULT_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');

class RuntimeCheckError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new RuntimeCheckError(code);
}

function inside(root, file) {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function localModule(root, importer, specifier, entry = false) {
  if (typeof specifier !== 'string' || specifier.length === 0) fail('uninspectable-dependency');
  if (isAbsolute(specifier) || specifier.startsWith('/')) fail('escaping-dependency');
  if (/^[a-z][a-z\d+.-]*:/i.test(specifier)) fail('external-dependency');
  if (!entry && !specifier.startsWith('./') && !specifier.startsWith('../'))
    fail('external-dependency');
  // Emitted module URLs must be plain local JS paths, not query/encoded aliases.
  if (/[\\?#%]/.test(specifier)) fail('uninspectable-dependency');
  const file = resolve(dirname(importer), specifier);
  if (!inside(root, file)) fail('escaping-dependency');
  if (!['.js', '.mjs'].includes(extname(file))) fail('uninspectable-dependency');
  let realFile;
  try {
    realFile = realpathSync(file);
    if (!statSync(realFile).isFile()) fail('uninspectable-dependency');
  } catch (error) {
    if (error instanceof RuntimeCheckError) throw error;
    fail(error.code === 'ENOENT' ? 'missing-dependency' : 'uninspectable-dependency');
  }
  if (!inside(root, realFile)) fail('escaping-dependency');
  return realFile;
}

function dependencies(source) {
  const specifiers = [];
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        if (!ts.isStringLiteral(node.moduleSpecifier)) fail('uninspectable-dependency');
        specifiers.push(node.moduleSpecifier.text);
      }
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        if (!argument || !ts.isStringLiteralLike(argument)) fail('uninspectable-dependency');
        specifiers.push(argument.text);
      } else if (
        (ts.isIdentifier(node.expression) &&
          ['require', 'importScripts'].includes(node.expression.text)) ||
        ['require', 'importScripts'].some(name => {
          const owner = property(node.expression, name);
          return (
            owner &&
            ts.isIdentifier(unwrap(owner)) &&
            ['globalThis', 'self'].includes(unwrap(owner).text)
          );
        })
      ) {
        fail('uninspectable-dependency');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return specifiers;
}

function unwrap(node) {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}

function property(node, name) {
  node = unwrap(node);
  if (ts.isPropertyAccessExpression(node) && node.name.text === name) return node.expression;
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    node.argumentExpression.text === name
  )
    return node.expression;
  return null;
}

function isDocument(node) {
  node = unwrap(node);
  if (ts.isIdentifier(node) && node.text === 'document') return true;
  const owner = property(node, 'document');
  return (
    owner !== null &&
    ts.isIdentifier(unwrap(owner)) &&
    ['globalThis', 'self', 'window'].includes(unwrap(owner).text)
  );
}

function inspectEagerDom(source) {
  function visit(node) {
    if (ts.isFunctionLike(node)) {
      // Method names are evaluated now; bodies (including MAIN-world injection
      // callbacks) and default parameters are deferred until invocation.
      if (node.name && ts.isComputedPropertyName(node.name)) visit(node.name.expression);
      return;
    }
    if (ts.isPropertyDeclaration(node)) {
      if (node.name && ts.isComputedPropertyName(node.name)) visit(node.name.expression);
      const isStatic = node.modifiers?.some(item => item.kind === ts.SyntaxKind.StaticKeyword);
      if (isStatic && node.initializer) visit(node.initializer);
      return;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const owner = property(node, 'createElement');
      // Bracket access and explicit global document access are the same eager
      // DOM dependency as the installed decoder's document.createElement('i').
      if (owner && isDocument(owner)) fail('eager-dom-create-element');
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = unwrap(node.expression);
      if (ts.isFunctionExpression(callee) || ts.isArrowFunction(callee)) {
        // Unlike a callback, a direct IIFE runs while the module is evaluated.
        for (const parameter of callee.parameters) {
          if (parameter.initializer) visit(parameter.initializer);
        }
        visit(callee.body);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

/** @param {string} [distDirectory] */
export function checkServiceWorkerRuntime(distDirectory = DEFAULT_DIST) {
  let root;
  let manifest;
  try {
    root = realpathSync(distDirectory);
    manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
  } catch {
    fail('invalid-manifest');
  }
  const entry = localModule(
    root,
    resolve(root, 'manifest.json'),
    manifest?.background?.service_worker,
    true
  );
  const pending = [entry];
  const inspected = new Set();
  let bytes = 0;
  while (pending.length > 0) {
    const file = pending.pop();
    if (inspected.has(file)) continue;
    inspected.add(file);
    let code;
    try {
      code = readFileSync(file, 'utf8');
    } catch {
      fail('uninspectable-dependency');
    }
    bytes += Buffer.byteLength(code);
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (source.parseDiagnostics.length > 0) fail('uninspectable-dependency');
    inspectEagerDom(source);
    for (const specifier of dependencies(source)) {
      pending.push(localModule(root, file, specifier));
    }
  }
  return {
    ok: true,
    serviceWorker: relative(root, entry).split(sep).join('/'),
    files: [...inspected].map(file => relative(root, file).split(sep).join('/')).sort(),
    bytes,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    console.log(JSON.stringify(checkServiceWorkerRuntime(process.argv[2])));
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        code: error instanceof RuntimeCheckError ? error.code : 'uninspectable-dependency',
      })
    );
    process.exitCode = 1;
  }
}
