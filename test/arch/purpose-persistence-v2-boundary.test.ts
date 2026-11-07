// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '../..');
const directory = path.join(root, 'src/resumability-journal/purpose-persistence-v2');
const ownerPureConsumers = ['index.ts', 'envelope.ts'].map(name =>
  path.join(root, 'src/resumability-journal/baseline-owner', name)
);
const baselinePureConsumers = new Map(
  Object.entries({
    'contracts.ts': ['core/record'],
    'checkpoint.ts': ['core/record'],
    'operation.ts': ['core/record', 'core/data'],
    'progress.ts': ['core/record'],
  }).map(
    ([name, targets]) =>
      [
        path.join(root, 'src/resumability-journal/baseline-plan', name),
        targets.map(target => path.join(directory, target)),
      ] as const
  )
);
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
  );
}
function references(file: string): string[] {
  const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const result: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      result.push(node.moduleSpecifier.text);
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      result.push(node.argument.literal.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        node.expression.getText(tree) === 'require')
    ) {
      expect(node.arguments.length).toBe(1);
      expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
      if (ts.isStringLiteral(node.arguments[0])) result.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return result;
}

describe('separate inert purpose persistence v2 boundary', () => {
  it('has no transitive path into v1, executor, UI, background or baseline modules', () => {
    const pending = files(directory).filter(file => file.endsWith('.ts'));
    const seen = new Set<string>();
    while (pending.length) {
      const file = pending.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const relative = path.relative(root, file).replaceAll('\\', '/');
      expect(relative).not.toMatch(/^src\/(?:content|background|popup|baseline)\//u);
      expect(relative).not.toMatch(/^src\/resumability-journal\/(?:core|idb|page)\//u);
      for (const reference of references(file)) {
        expect(reference.startsWith('.'), file + ' -> ' + reference).toBe(true);
        const base = path.resolve(path.dirname(file), reference);
        const target = [base + '.ts', path.join(base, 'index.ts')].find(file => existsSync(file));
        expect(target).toBeDefined();
        if (target) pending.push(target);
      }
    }
    expect(seen.size).toBeGreaterThan(8);
  });
  it('preserves all v1 Git blob bytes from exact base including its complete source set', () => {
    const baseline = JSON.parse(
      readFileSync(
        path.join(root, 'test/resumability-journal/purpose-persistence-v2/v1-baseline.json'),
        'utf8'
      )
    ) as { base: string; gitBlobs: Record<string, string> };
    expect(baseline.base).toBe('94af6fe90f495cc2fee2b426a028c1da719c8b1c');
    const current = ['core', 'idb', 'page']
      .flatMap(part => files(path.join(root, 'src/resumability-journal', part)))
      .map(file => path.relative(root, file).replaceAll('\\', '/'))
      .sort();
    expect(current).toEqual(Object.keys(baseline.gitBlobs).sort());
    for (const [file, expected] of Object.entries(baseline.gitBlobs)) {
      // Git checkout EOL normalization is not a source edit (Windows autocrlf / Linux LF).
      const bytes = Buffer.from(
        readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n')
      );
      expect(
        createHash('sha1')
          .update(Buffer.from(`blob ${bytes.length}\0`))
          .update(bytes)
          .digest('hex'),
        file
      ).toBe(expected);
    }
  });

  it('imports only its own modules and exact public purpose/handoff/receipt/adapter APIs, with no production consumer', () => {
    const allowed = [
      'src/resumability-journal/purpose',
      'src/resumability-journal/capture-handoff',
      'src/resumability-journal/producer-adapter',
      'src/lib/chatgpt-producer-evidence',
    ].map(file => path.join(root, file));
    for (const file of files(directory)) {
      for (const reference of references(file)) {
        const resolved = path.resolve(path.dirname(file), reference);
        expect(reference.startsWith('.')).toBe(true);
        expect(
          resolved.startsWith(directory + path.sep) || allowed.includes(resolved),
          file + ' -> ' + reference
        ).toBe(true);
      }
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(
        /\b(?:chrome|browser|navigator|document|window)\s*[.(]|\b(?:fetch|XMLHttpRequest|WebSocket|setInterval|deleteDatabase|deleteObjectStore|capturePreparedChatGpt|JournalDispatchToken)\b/u
      );
      expect(source).not.toMatch(/\b(?:require|import)\s*\(/u);
      expect(source).not.toMatch(/(?:store|objectStore\([^)]*\))\s*\.\s*(?:delete|clear)\s*\(/u);
    }
    for (const file of files(path.join(root, 'src')).filter(file => /\.[jt]sx?$/u.test(file)))
      for (const reference of references(file)) {
        const resolved = path.resolve(path.dirname(file), reference);
        if (resolved === directory || resolved.startsWith(directory + path.sep))
          expect(
            file.startsWith(directory + path.sep) ||
              baselinePureConsumers.get(file)?.includes(resolved) === true ||
              (ownerPureConsumers.includes(file) &&
                ['core/record', 'core/control'].some(
                  target => resolved === path.join(directory, target)
                )) ||
              (file ===
                path.join(root, 'src/resumability-journal/execution-coordinator/index.ts') &&
                resolved === path.join(directory, 'idb')),
            file
          ).toBe(true);
      }
  });

  it('keeps the complete v2 closure out of production entrypoints, build configuration and generated distribution', () => {
    const sourceFiles = files(path.join(root, 'src'));
    const manifest = readFileSync(path.join(root, 'src/manifest.json'), 'utf8');
    const pending = [...manifest.matchAll(/"(src\/[^"\r\n]+\.ts)"/gu)].map(match =>
      path.join(root, match[1])
    );
    for (const html of sourceFiles.filter(file => file.endsWith('.html')))
      for (const match of readFileSync(html, 'utf8').matchAll(/\bsrc=["']([^"']+\.ts)["']/gu))
        pending.push(path.resolve(path.dirname(html), match[1]));
    const visited = new Set<string>();
    while (pending.length) {
      const file = pending.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      expect(file.startsWith(directory + path.sep)).toBe(false);
      for (const reference of references(file)) {
        if (!reference.startsWith('.')) continue;
        const base = path.resolve(path.dirname(file), reference);
        const resolved = [base + '.ts', path.join(base, 'index.ts'), base].find(file =>
          existsSync(file)
        );
        if (resolved?.endsWith('.ts')) pending.push(resolved);
      }
    }
    expect(visited.size).toBeGreaterThan(100);
    const marker =
      /purpose-persistence-v2|liska-resumability-journal-v2|liska-resumability-journal\/2|createPurposePersistenceStore|PurposeDispatchToken|execution-coordinator|createChatGptExecution|invalid-execution-input/u;
    const config = [
      ...files(path.join(root, 'scripts')),
      ...readdirSync(root)
        .filter(
          name => /(?:config|manifest|package)/u.test(name) && /\.(?:json|ts|js|mjs)$/u.test(name)
        )
        .map(name => path.join(root, name)),
    ];
    for (const file of config) expect(readFileSync(file, 'utf8'), file).not.toMatch(marker);
    const dist = path.join(root, 'dist');
    if (existsSync(dist))
      for (const file of files(dist).filter(file => /\.(?:js|json|html)$/u.test(file)))
        expect(readFileSync(file, 'utf8'), file).not.toMatch(marker);
  });
});
