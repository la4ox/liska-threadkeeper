// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '../..');
const directory = path.join(root, 'src/resumability-journal/purpose');
const adapter = path.join(root, 'src/resumability-journal/producer-adapter');
const handoff = path.join(root, 'src/resumability-journal/capture-handoff');
const handoffEntry = path.join(handoff, 'index.ts');
const adapterEntry = path.join(adapter, 'index.ts');
const claudeAdapterEntry = path.join(
  root,
  'src/resumability-journal/claude-producer-adapter/index.ts'
);
const persistenceV3Core = path.join(
  root,
  'src/resumability-journal/purpose-persistence-v3/core/record.ts'
);
const persistence = path.join(root, 'src/resumability-journal/purpose-persistence-v2');
const persistenceCore = path.join(persistence, 'core/record.ts');
const persistenceEntry = path.join(persistence, 'idb/index.ts');
const persistenceRecords = path.join(persistence, 'idb/records.ts');
const baselinePlanConsumers = ['contracts.ts', 'plan.ts'].map(name =>
  path.join(root, 'src/resumability-journal/baseline-plan', name)
);
const executor = path.join(root, 'src/content/capture/chatgpt-admitted-capture.ts');
const coordinator = path.join(root, 'src/resumability-journal/execution-coordinator/index.ts');
const baselineOwnerEntry = path.join(root, 'src/resumability-journal/baseline-owner/index.ts');
const providerOwnerEntry = path.join(
  root,
  'src/resumability-journal/provider-baseline-owner/index.ts'
);
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(dir, entry.name);
    return entry.isDirectory() ? files(name) : [name];
  });
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

describe('isolated unwired new-capture purpose contract', () => {
  it('has module-local imports only and no execution, clock, storage or browser capabilities', () => {
    const sourceFiles = files(directory).filter(file => file.endsWith('.ts'));
    expect(sourceFiles.length).toBeGreaterThan(0);
    for (const file of sourceFiles) {
      for (const reference of references(file)) {
        expect(reference.startsWith('./')).toBe(true);
        expect(path.resolve(path.dirname(file), reference).startsWith(directory + path.sep)).toBe(
          true
        );
      }
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/\b(?:import|require)\s*\(/u);
      expect(source).not.toMatch(
        /\b(?:chrome|browser|navigator|document|window|globalThis|self|process|indexedDB|localStorage|sessionStorage|Date|performance|crypto)\s*[.(]/u
      );
      expect(source).not.toMatch(
        /\b(?:fetch|XMLHttpRequest|WebSocket|Worker|SharedWorker|EventSource|setTimeout|setInterval|queueMicrotask|eval|Function|postMessage)\s*\(/u
      );
      expect(source).not.toMatch(/console\s*\./u);
    }
  });
  it('permits only exact isolated consumers, with no HTML entrypoints, build or manifest wiring', () => {
    for (const file of files(path.join(root, 'src'))) {
      if (/\.[cm]?[jt]sx?$/u.test(file)) {
        for (const reference of references(file)) {
          const resolved = path.resolve(path.dirname(file), reference);
          if (resolved === directory || resolved.startsWith(directory + path.sep))
            expect(
              file.startsWith(directory + path.sep) ||
                [
                  adapterEntry,
                  claudeAdapterEntry,
                  persistenceV3Core,
                  handoffEntry,
                  persistenceCore,
                  persistenceEntry,
                  baselineOwnerEntry,
                  providerOwnerEntry,
                  path.join(root, 'src/resumability-journal/execution-coordinator/store-port.ts'),
                  ...baselinePlanConsumers,
                ].includes(file)
            ).toBe(true);
          if (resolved === adapter || resolved.startsWith(adapter + path.sep))
            expect([
              adapterEntry,
              persistenceV3Core,
              persistenceCore,
              persistenceEntry,
              persistenceRecords,
              path.join(root, 'src/resumability-journal/baseline-owner/execution.ts'),
            ]).toContain(file);
          if (resolved === handoff || resolved.startsWith(handoff + path.sep))
            expect([executor, persistenceEntry, coordinator, baselineOwnerEntry]).toContain(file);
          if ([resolved, resolved + '.ts'].includes(executor)) expect(file).toBe(coordinator);
        }
      }
      if (file.endsWith('.html'))
        expect(readFileSync(file, 'utf8')).not.toMatch(
          /resumability-journal\/(?:purpose|producer-adapter|capture-handoff)|\/(?:purpose|producer-adapter|capture-handoff)\/index|chatgpt-admitted-capture/u
        );
    }
    for (const file of [
      ...files(path.join(root, 'scripts')).filter(
        file => file !== path.join(root, 'scripts/build-provider-baseline-owner-browser.mjs')
      ),
      ...readdirSync(root)
        .filter(
          name => /(?:config|manifest|package)/u.test(name) && /\.(?:json|ts|js|mjs)$/u.test(name)
        )
        .map(name => path.join(root, name)),
    ]) {
      expect(readFileSync(file, 'utf8')).not.toMatch(
        /resumability-journal[/\\](?:purpose|producer-adapter|capture-handoff)|chatgpt-admitted-capture|prepareChatGptNewCapture|capturePreparedChatGpt/u
      );
    }
  });
  it('permits only the isolated adapter with pure receipt parsing and injected hashing', () => {
    for (const file of files(adapter)) {
      for (const reference of references(file))
        expect([
          '../purpose',
          '../../lib/chatgpt-producer-evidence',
          '../../lib/producer-evidence-data',
          '../../archive/catalog/conversation-key',
        ]).toContain(reference);
      expect(readFileSync(file, 'utf8')).not.toMatch(
        /\b(?:chrome|browser|navigator|document|window|globalThis|process|indexedDB|localStorage|Date|performance|crypto)\s*[.(]|\b(?:fetch|setTimeout|setInterval|eval|Function|require|import)\s*\(/u
      );
    }
  });
  it('keeps the pure handoff and effectful executor separate with exact import allowlists', () => {
    expect(files(handoff)).toEqual([handoffEntry]);
    expect(references(handoffEntry).sort()).toEqual(
      [
        '../../archive/catalog/admission',
        '../../archive/catalog/conversation-key',
        '../../lib/chatgpt-capture-contract',
        '../../lib/chatgpt-producer-evidence',
        '../../lib/producer-evidence-data',
        '../purpose',
      ].sort()
    );
    expect(references(executor).sort()).toEqual(
      [
        '../../archive/catalog/conversation-key',
        '../../lib/chatgpt-capture-contract',
        '../../lib/chatgpt-capture-stage-access',
        '../../resumability-journal/capture-handoff',
        './chatgpt-current-branch',
        './response',
      ].sort()
    );
    for (const file of [handoffEntry, executor]) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(
        /JournalDispatchToken|journal-v1|runId|itemId|\b(?:indexedDB|localStorage|sessionStorage|fetch|setTimeout|setInterval)\b|\b(?:chrome|browser|document|window)\s*[.(]/u
      );
      expect(source).not.toMatch(
        /\b(?:persist|settle|assessNewCaptureEvidence|requestChatGptConversationCapture|normalizeChatGptCapture|observeChatGpt\w+|abortStagedArchiveArtifact)\s*\(/u
      );
    }
    expect(readFileSync(handoffEntry, 'utf8')).not.toMatch(
      /\b(?:Date|crypto|performance|globalThis)\s*[.(]/u
    );
    for (const file of ['admission.ts', 'conversation-key.ts']) {
      const source = readFileSync(path.join(root, 'src/archive/catalog', file), 'utf8');
      expect(source).not.toMatch(
        /resumability-journal|\b(?:File|Blob|fetch|indexedDB|chrome|crypto)\b/u
      );
    }
  });
  it('keeps the new symbols and operation schema out of every production entry import closure', () => {
    const sourceFiles = files(path.join(root, 'src'));
    const manifest = readFileSync(path.join(root, 'src/manifest.json'), 'utf8');
    const pending = [...manifest.matchAll(/"(src\/[^"\r\n]+\.ts)"/gu)].map(match =>
      path.join(root, match[1])
    );
    for (const html of sourceFiles.filter(file => file.endsWith('.html')))
      for (const match of readFileSync(html, 'utf8').matchAll(/\bsrc=["']([^"']+\.ts)["']/gu))
        pending.push(path.resolve(path.dirname(html), match[1]));
    expect(pending.length).toBeGreaterThan(5);
    const visited = new Set<string>();
    while (pending.length) {
      const file = pending.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      expect([handoffEntry, executor, adapterEntry, coordinator]).not.toContain(file);
      expect(file.startsWith(directory + path.sep)).toBe(false);
      expect(readFileSync(file, 'utf8')).not.toMatch(
        /prepareChatGptNewCapture|capturePreparedChatGpt|validatePreparedChatGpt|PreparedChatGptCapture|liska-new-capture-operation\/1/u
      );
      for (const reference of references(file)) {
        if (!reference.startsWith('.')) continue;
        const base = path.resolve(path.dirname(file), reference);
        const target = [base + '.ts', path.join(base, 'index.ts'), base].find(value =>
          existsSync(value)
        );
        if (target?.endsWith('.ts')) pending.push(target);
      }
    }
    expect(visited.size).toBeGreaterThan(100);
  });
});
