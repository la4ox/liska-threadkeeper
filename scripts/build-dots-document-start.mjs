/** Emit the import-free Dots MAIN observer as one synchronous classic script. */
import {
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIST = resolve(ROOT, 'dist');
const DEFAULT_SOURCE = resolve(ROOT, 'src/content/capture/dots-schema-document-start.ts');
export const DOTS_CLASSIC_ENTRY = 'dots-schema-document-start.js';
const DOTS_ASSET = /^assets\/dots-schema-document-start(?:\.ts)?(?:-loader)?-[A-Za-z0-9_-]+\.js$/;
const DOTS_LOADER = /^assets\/dots-schema-document-start\.ts-loader-[A-Za-z0-9_-]+\.js$/;
const CHATGPT_LOADER = /^assets\/chatgpt-document-start\.ts-loader-[A-Za-z0-9_-]+\.js$/;
const EXPECTED_EXPORTS = new Set([
  'DotsSchemaDocumentStartResult',
  'startDotsSchemaDocumentStartProbe',
  'readDotsSchemaProbeState',
]);

class DotsBuildError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new DotsBuildError(code);
}

function parsed(code, fileName, kind) {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.ES2022, true, kind);
  if (source.parseDiagnostics.length > 0) fail('invalid-source');
  return source;
}

function hasModifier(node, kind) {
  return node.modifiers?.some(modifier => modifier.kind === kind) === true;
}

function inspectNoModules(source) {
  function visit(node) {
    if (hasModifier(node, ts.SyntaxKind.ExportKeyword) && !ts.isSourceFile(node.parent))
      fail('unexpected-export');
    if (
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      ts.isImportTypeNode(node) ||
      ts.isExportDeclaration(node) ||
      ts.isExportAssignment(node) ||
      (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) ||
      (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            ['require', 'importScripts'].includes(node.expression.text))))
    ) {
      fail('module-dependency');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

function isStartup(statement) {
  return (
    ts.isIfStatement(statement) &&
    statement.elseStatement === undefined &&
    ts.isBinaryExpression(statement.expression) &&
    statement.expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
    ts.isTypeOfExpression(statement.expression.left) &&
    ts.isIdentifier(statement.expression.left.expression) &&
    statement.expression.left.expression.text === 'window' &&
    ts.isStringLiteral(statement.expression.right) &&
    statement.expression.right.text === 'undefined' &&
    ts.isExpressionStatement(statement.thenStatement) &&
    ts.isCallExpression(statement.thenStatement.expression) &&
    ts.isIdentifier(statement.thenStatement.expression.expression) &&
    statement.thenStatement.expression.expression.text === 'startDotsSchemaDocumentStartProbe' &&
    statement.thenStatement.expression.arguments.length === 0
  );
}

/** Full repository tsc runs first; this isolated transform removes only known export modifiers. */
export function compileDotsDocumentStart(sourceText) {
  if (typeof sourceText !== 'string') fail('invalid-source');
  const source = parsed(sourceText, 'dots-schema-document-start.ts', ts.ScriptKind.TS);
  inspectNoModules(source);
  const exports = new Set();
  const statements = source.statements.map(statement => {
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return statement;
    const name = statement.name?.text;
    if (
      !EXPECTED_EXPORTS.has(name) ||
      exports.has(name) ||
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
    ) {
      fail('unexpected-export');
    }
    exports.add(name);
    const modifiers = statement.modifiers?.filter(
      modifier => modifier.kind !== ts.SyntaxKind.ExportKeyword
    );
    if (ts.isTypeAliasDeclaration(statement) && name === 'DotsSchemaDocumentStartResult') {
      return ts.factory.updateTypeAliasDeclaration(
        statement,
        modifiers,
        statement.name,
        statement.typeParameters,
        statement.type
      );
    }
    if (
      ts.isFunctionDeclaration(statement) &&
      name !== 'DotsSchemaDocumentStartResult' &&
      !hasModifier(statement, ts.SyntaxKind.AsyncKeyword) &&
      statement.asteriskToken === undefined &&
      statement.body !== undefined
    ) {
      return ts.factory.updateFunctionDeclaration(
        statement,
        modifiers,
        statement.asteriskToken,
        statement.name,
        statement.typeParameters,
        statement.parameters,
        statement.type,
        statement.body
      );
    }
    fail('unexpected-export');
  });
  if (exports.size !== EXPECTED_EXPORTS.size) fail('missing-export');
  if (!isStartup(statements.at(-1))) fail('missing-synchronous-startup');
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true });
  const scriptSource = printer.printFile(ts.factory.updateSourceFile(source, statements));
  const compiled = ts.transpileModule(scriptSource, {
    fileName: 'dots-schema-document-start.ts',
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      removeComments: true,
      sourceMap: false,
      inlineSourceMap: false,
    },
  });
  if (compiled.diagnostics?.length) fail('transpile-diagnostic');
  const emitted = parsed(compiled.outputText, DOTS_CLASSIC_ENTRY, ts.ScriptKind.JS);
  inspectNoModules(emitted);
  if (ts.isExternalModule(emitted) || !isStartup(emitted.statements.at(-1)))
    fail('emitted-module-syntax');
  const code = `(function () {\n'use strict';\n${compiled.outputText}\n})();\n`;
  try {
    new Script(code, { filename: DOTS_CLASSIC_ENTRY });
  } catch {
    fail('invalid-classic-script');
  }
  return code;
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

function referencedCandidates(root, importer, code, candidates) {
  const references = new Set();
  let unknownDynamicImport = false;
  const source = parsed(code, importer, ts.ScriptKind.JS);
  function visit(node) {
    let specifier;
    let fromRoot = false;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      specifier = node.moduleSpecifier;
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      specifier = node.arguments[0];
      // CRXJS's isolated-world loader wraps one literal local path in getURL.
      // Resolve only that exact emitted form; arbitrary dynamic imports keep all
      // candidates rather than guessing which generated files they might use.
      if (
        specifier &&
        ts.isCallExpression(specifier) &&
        ts.isPropertyAccessExpression(specifier.expression) &&
        specifier.expression.name.text === 'getURL' &&
        ts.isPropertyAccessExpression(specifier.expression.expression) &&
        specifier.expression.expression.name.text === 'runtime' &&
        ts.isIdentifier(specifier.expression.expression.expression) &&
        specifier.expression.expression.expression.text === 'chrome' &&
        specifier.arguments.length === 1 &&
        ts.isStringLiteralLike(specifier.arguments[0])
      ) {
        specifier = specifier.arguments[0];
        fromRoot = true;
      }
      if (!specifier || !ts.isStringLiteralLike(specifier)) unknownDynamicImport = true;
    }
    if (
      specifier &&
      ts.isStringLiteralLike(specifier) &&
      (fromRoot || specifier.text.startsWith('.'))
    ) {
      const file = fromRoot
        ? resolve(root, specifier.text)
        : resolve(root, dirname(importer), specifier.text);
      if (inside(root, file)) {
        const path = relative(root, file).split(sep).join('/');
        if (candidates.has(path)) references.add(path);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { references, unknownDynamicImport };
}

function dotsEntry(manifest) {
  if (!manifest || !Array.isArray(manifest.content_scripts)) fail('invalid-manifest');
  const entries = manifest.content_scripts.filter(
    entry =>
      (Array.isArray(entry?.js) &&
        entry.js.some(
          file =>
            typeof file === 'string' &&
            (file.includes('chatgpt-document-start') || file.includes('dots-schema-document-start'))
        )) ||
      (entry?.run_at === 'document_start' &&
        entry.world === 'MAIN' &&
        Array.isArray(entry.matches) &&
        entry.matches.includes('https://chatgpt.com/*'))
  );
  if (entries.length !== 1) fail('dots-entry-count');
  const entry = entries[0];
  if (
    entry.js.length !== 2 ||
    typeof entry.js[0] !== 'string' ||
    !CHATGPT_LOADER.test(entry.js[0]) ||
    typeof entry.js[1] !== 'string' ||
    (entry.js[1] !== DOTS_CLASSIC_ENTRY && !DOTS_LOADER.test(entry.js[1])) ||
    entry.run_at !== 'document_start' ||
    entry.world !== 'MAIN' ||
    JSON.stringify(entry.matches) !== JSON.stringify(['https://chatgpt.com/*']) ||
    (entry.all_frames !== undefined && entry.all_frames !== false)
  ) {
    fail('invalid-dots-entry');
  }
  return entry;
}

function planPruning(root, manifest, entry, files) {
  const candidates = new Set(files.filter(file => DOTS_ASSET.test(file)));
  const dependencies = new Map();
  const retained = new Set();
  for (const file of files.filter(file => /\.(?:m?js)$/.test(file))) {
    const result = referencedCandidates(
      root,
      file,
      readFileSync(resolve(root, file), 'utf8'),
      candidates
    );
    if (result.unknownDynamicImport) for (const candidate of candidates) retained.add(candidate);
    if (candidates.has(file)) dependencies.set(file, result.references);
    else for (const dependency of result.references) retained.add(dependency);
  }
  // WAR declarations are access permissions, not execution roots. Other manifest
  // references and any generated HTML remain roots and must keep their assets.
  const roots = JSON.stringify({
    ...manifest,
    web_accessible_resources: undefined,
    content_scripts: manifest.content_scripts.map(script =>
      script === entry ? { ...script, js: [script.js[0], DOTS_CLASSIC_ENTRY] } : script
    ),
  });
  for (const candidate of candidates) {
    if (roots.includes(JSON.stringify(candidate))) retained.add(candidate);
    for (const html of files.filter(file => file.endsWith('.html'))) {
      if (readFileSync(resolve(root, html), 'utf8').includes(candidate)) retained.add(candidate);
    }
  }
  const pending = [...retained];
  while (pending.length) {
    for (const dependency of dependencies.get(pending.pop()) ?? []) {
      if (!retained.has(dependency)) {
        retained.add(dependency);
        pending.push(dependency);
      }
    }
  }
  return {
    removed: [...candidates].filter(file => !retained.has(file)).sort(),
    retained: [...retained].sort(),
  };
}

/** Replaces only Dots within the ordered MAIN entry; ordinary ChatGPT remains first. */
export function buildDotsDocumentStart(distDirectory = DEFAULT_DIST, sourcePath = DEFAULT_SOURCE) {
  const code = compileDotsDocumentStart(readFileSync(sourcePath, 'utf8'));
  let root;
  let manifest;
  try {
    root = realpathSync(distDirectory);
    if (!statSync(root).isDirectory()) fail('invalid-build-directory');
    manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
  } catch (error) {
    if (error instanceof DotsBuildError) throw error;
    fail('invalid-manifest');
  }
  const entry = dotsEntry(manifest);
  const files = filesWithin(root);
  if (!entry.js.every(file => files.includes(file))) fail('missing-document-start-entry-file');
  const pruning = planPruning(root, manifest, entry, files);
  const removed = new Set(pruning.removed);
  entry.js = [entry.js[0], DOTS_CLASSIC_ENTRY];
  if (manifest.web_accessible_resources !== undefined) {
    if (!Array.isArray(manifest.web_accessible_resources)) fail('invalid-manifest');
    manifest.web_accessible_resources = manifest.web_accessible_resources
      .map(resource => {
        if (!Array.isArray(resource?.resources)) fail('invalid-manifest');
        return { ...resource, resources: resource.resources.filter(file => !removed.has(file)) };
      })
      .filter(resource => resource.resources.length > 0);
  }
  writeFileSync(resolve(root, DOTS_CLASSIC_ENTRY), code);
  writeFileSync(resolve(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of pruning.removed) unlinkSync(resolve(root, file));
  return {
    ok: true,
    entry: DOTS_CLASSIC_ENTRY,
    bytes: Buffer.byteLength(code),
    removedArtifacts: pruning.removed,
    retainedArtifacts: pruning.retained,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    console.log(JSON.stringify(buildDotsDocumentStart(process.argv[2], process.argv[3])));
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        code: error instanceof DotsBuildError ? error.code : 'build-failed',
      })
    );
    process.exitCode = 1;
  }
}
