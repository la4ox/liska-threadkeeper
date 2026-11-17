// @vitest-environment node
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_BASELINE_CATALOG_SCHEMA,
  CLAUDE_BASELINE_HARD_LIMITS,
  type ClaudeBaselineTarget,
} from '../../src/claude-baseline';
import { observeClaudeTerminalListPage } from '../../src/update-discovery/claude';
import { attestation, catalog, id, markerSource, page, scopeKey, target } from './fixtures';

const root = path.resolve(import.meta.dirname, '../..');
const virtualFile = path.join(root, 'test/claude-baseline/__adr053-compatibility__.ts');

function compatibilityDiagnostics(drift = false): readonly ts.Diagnostic[] {
  const configPath = path.join(root, 'tsconfig.json');
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(loaded.error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    root,
    { noEmit: true },
    configPath
  );
  expect(parsed.errors).toEqual([]);
  const source = `
    import type { ClaudeBaselineObservation } from '../../src/claude-baseline/contracts';
    import type { ClaudeListObservedPage } from '../../src/update-discovery/claude/contracts';
    type Equal<A, B> =
      (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
    type Candidate = ClaudeBaselineObservation${drift ? " & { readonly drift: 'detected' }" : ''};
    const forward: Equal<Candidate, ClaudeListObservedPage> = true;
    const backward: Equal<ClaudeListObservedPage, Candidate> = true;
    void forward;
    void backward;
  `;
  const options = { ...parsed.options, noEmit: true };
  const host = ts.createCompilerHost(options, true);
  const originalFileExists = host.fileExists.bind(host);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const exactVirtualFile = path.resolve(virtualFile);
  const isVirtual = (fileName: string): boolean => path.resolve(fileName) === exactVirtualFile;
  host.fileExists = fileName => isVirtual(fileName) || originalFileExists(fileName);
  host.readFile = fileName => (isVirtual(fileName) ? source : originalReadFile(fileName));
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    isVirtual(fileName)
      ? ts.createSourceFile(fileName, source, languageVersion, true)
      : originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram({ rootNames: [virtualFile], options, host });
  return ts
    .getPreEmitDiagnostics(program)
    .filter(diagnostic => !diagnostic.file || isVirtual(diagnostic.file.fileName));
}

describe('offline Claude observed-active baseline catalog', () => {
  it('compiler-checks exact bidirectional ADR053 compatibility and detects structural drift', () => {
    expect(compatibilityDiagnostics()).toEqual([]);
    expect(compatibilityDiagnostics(true).map(diagnostic => diagnostic.code)).toContain(2322);
  });

  it('accepts the exact existing ADR053 parser result with no raw provider fields', () => {
    const observed = observeClaudeTerminalListPage({
      request: {
        method: 'GET',
        route: 'chat_conversations_v2',
        query: { limit: 30, offset: 0, archived: false, consistency: 'strong' },
      },
      response: {
        status: 200,
        body: {
          data: Array.from({ length: 12 }, (_, n) => ({
            uuid: id(12 - n),
            updated_at: `opaque-${12 - n}`,
            name: 'private-title',
            summary: 'private-summary',
            settings: { authorization: 'private-bearer-token' },
          })),
          has_more: false,
        },
      },
      scope: {
        key: scopeKey,
        organizationBinding: 'resolved',
        workspaceBinding: 'resolved',
        organizationId: 'private-organization',
        workspaceId: 'private-workspace',
        email: 'private@example.invalid',
      },
    });
    const result = catalog(observed);
    expect(result).toEqual({
      kind: 'catalog',
      schema: CLAUDE_BASELINE_CATALOG_SCHEMA,
      provider: 'claude',
      scopeKey,
      scopeEvidence: 'manual-personal-scope',
      coverage: { active: 'terminal-observed', archived: 'unobserved' },
      accountComplete: false,
      targets: Array.from({ length: 12 }, (_, n) => target(n + 1)),
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private|organizationId|workspaceId|email|name|title|summary|settings|authorization|request|response|uuid|has_more|liska-snapshot-catalog/u
    );
  });

  it('retains absent markers without fabricating marker, recency or capture evidence', () => {
    const result = catalog(page([{ conversationId: id(1) }]));
    expect(result.targets).toEqual([{ conversationId: id(1) }]);
    expect(Object.hasOwn(result.targets[0], 'marker')).toBe(false);
    expect(Object.keys(result.targets[0])).toEqual(['conversationId']);
    expect(Object.keys(catalog().targets[0])).toEqual(['conversationId', 'marker']);
    expect(Object.keys(catalog().targets[0].marker!)).toEqual(['source', 'token']);
  });

  it('never promotes an empty or terminal active observation to complete account coverage', () => {
    for (const records of [[], [target()], Array.from({ length: 30 }, (_, n) => target(n))]) {
      const result = catalog(page(records));
      expect(result.coverage).toEqual({ active: 'terminal-observed', archived: 'unobserved' });
      expect(result.accountComplete).toBe(false);
      expect(Object.keys(result)).toEqual([
        'kind',
        'schema',
        'provider',
        'scopeKey',
        'scopeEvidence',
        'coverage',
        'accountComplete',
        'targets',
      ]);
    }
  });

  it('orders by exact ID spelling and gives deterministic serialization independent of field/order input', () => {
    const first = catalog(page([target(3), target(1), target(2)]));
    const second = catalog({
      records: [target(2), target(3), target(1)],
      scopeKey,
      schema: 'claude-list-page-observation/1',
      kind: 'observed_page',
    });
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.targets.map(record => record.conversationId)).toEqual([id(1), id(2), id(3)]);
    expect(catalog(page([target(3), target(1), target(2)]))).not.toBe(first);
  });

  it('deeply freezes and detaches every published object without freezing caller-owned data', () => {
    const records = [target(2), target(1)];
    const source = page(records);
    const evidence = attestation();
    const result = catalog(source, evidence);
    for (const value of [
      result,
      result.targets,
      result.coverage,
      ...result.targets,
      ...result.targets.map(record => record.marker),
    ])
      expect(Object.isFrozen(value)).toBe(true);
    for (const value of [source, records, ...records, evidence])
      expect(Object.isFrozen(value)).toBe(false);
    expect(result.targets).not.toBe(records);
    expect(result.targets[0]).not.toBe(records[1]);
    expect(result.targets[0].marker).not.toBe(records[1].marker);
    records[1].marker.token = 'mutated';
    records[1].conversationId = id(4);
    records.reverse();
    source.scopeKey = 'mutated';
    evidence.scopeKey = 'mutated';
    expect(result.scopeKey).toBe(scopeKey);
    expect(result.targets).toEqual([target(1), target(2)]);
    expect(() => {
      (result.targets as ClaudeBaselineTarget[]).push(target(4));
    }).toThrow();
    expect(Reflect.set(result.coverage, 'archived', 'terminal-observed')).toBe(false);
  });

  it.each(['not a date', ' ', '\u0000', '2030-99-99', 'e\u0301', '\ud800', '"\\\n'])(
    'preserves opaque token %j byte-for-code-unit without normalization or ordering',
    token => {
      expect(
        catalog(page([{ conversationId: id(1), marker: { source: markerSource, token } }]))
          .targets[0].marker?.token
      ).toBe(token);
    }
  );

  it('has a bounded maximal projection and publishes frozen hard limits', () => {
    const records = Array.from({ length: 30 }, (_, n) => ({
      conversationId: id(n),
      marker: { source: markerSource, token: '\u0000'.repeat(256) },
    }));
    expect(JSON.stringify(catalog(page(records))).length).toBeLessThan(65536);
    expect(Object.isFrozen(CLAUDE_BASELINE_HARD_LIMITS)).toBe(true);
    expect(CLAUDE_BASELINE_HARD_LIMITS.maxRecords).toBe(30);
  });
});
