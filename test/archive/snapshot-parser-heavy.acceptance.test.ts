import { performance } from 'node:perf_hooks';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  analyzeSnapshots,
  encodeSnapshotAnalysisPlan,
  SNAPSHOT_ANALYSIS_HARD_LIMITS as limits,
  SnapshotAnalysisError,
  type SnapshotAnalysisPlan,
} from '../../src/archive/snapshots';
import {
  countingSha256,
  inventoryFingerprints,
  PARSER_HEAVY_CANARY,
  parserHeavyFixture,
  selectionMetrics,
  type ParserHeavyFixture,
} from '../snapshot-analysis/parser-heavy-fixtures';

const enabled = process.env.LISKA_RUN_PARSER_HEAVY_ACCEPTANCE === '1';
const timeout = 120_000;
const decoder = new TextDecoder();

function equivalentSelectionOrder(plan: SnapshotAnalysisPlan): SnapshotAnalysisPlan {
  // Public ordinals intentionally follow selection order. Normalize only that
  // ordering for the reversed-selection comparison, not the actual report.
  const entries = [...plan.snapshots].sort((a, b) =>
    a.inventorySha256 < b.inventorySha256 ? -1 : a.inventorySha256 > b.inventorySha256 ? 1 : 0
  );
  const ordinals = new Map(entries.map((entry, ordinal) => [entry.ordinal, ordinal]));
  return {
    ...plan,
    snapshots: entries.map((entry, ordinal) => ({ ...entry, ordinal })),
    relations: plan.relations
      .map(entry => {
        const endpoints = [ordinals.get(entry.left)!, ordinals.get(entry.right)!].sort(
          (a, b) => a - b
        );
        return { ...entry, left: endpoints[0], right: endpoints[1] };
      })
      .sort((a, b) => a.left - b.left || a.right - b.right),
  };
}

function expectUnrelatedHeadroom(fixtures: readonly ParserHeavyFixture[]) {
  const measured = selectionMetrics(fixtures);
  // Even the refusing selection must stay <= 50% of every unrelated ceiling.
  const checks: Array<[number, number]> = [
    [measured.snapshots, limits.maxSnapshots],
    [measured.totalFiles, limits.maxTotalFiles],
    [measured.totalBytes, limits.maxTotalBytes],
    [measured.strict.values, limits.maxJsonValues],
    [measured.strict.work, limits.maxJsonWork],
    [measured.totalProjectionBytes, limits.maxTotalProjectionBytes],
  ];
  for (const { metrics } of fixtures)
    checks.push(
      [metrics.files.length, limits.maxFilesPerSnapshot],
      [Math.max(...metrics.files.map(file => file.byteLength)), limits.maxFileBytes],
      [metrics.maxJsonDepth, limits.maxJsonDepth],
      [metrics.nodes, limits.maxCanonicalNodes],
      [metrics.blocks, limits.maxCanonicalBlocks],
      [metrics.assets, limits.maxAssets],
      [metrics.diagnostics, limits.maxDiagnostics],
      [Math.max(...Object.values(metrics.projectionBytes)), limits.maxProjectionBytes]
    );
  for (const [value, ceiling] of checks) expect(value).toBeLessThanOrEqual(ceiling / 2);
}

function expectSafeReport(plan: SnapshotAnalysisPlan, fixtures: readonly ParserHeavyFixture[]) {
  const encoded = encodeSnapshotAnalysisPlan(plan);
  const text = decoder.decode(encoded);
  expect(plan).toMatchObject({
    analysisOnly: true,
    mutationAuthorized: false,
    referenceCoverage: 'selected-inputs-only',
  });
  expect(
    plan.snapshots.every(entry => entry.verification === 'verified' && entry.code === null)
  ).toBe(true);
  expect(
    plan.snapshots.every(entry => entry.preserveReasons.includes('external-references-unassessed'))
  ).toBe(true);
  expect(plan.relations.every(entry => entry.preserveBoth === true)).toBe(true);
  expect(encoded.at(-1)).toBe(0x0a);
  expect(text).not.toContain('\r');
  for (const source of [
    PARSER_HEAVY_CANARY,
    'x'.repeat(128),
    'synthetic-parser-heavy-thread',
    'synthetic-parser-heavy-title',
    'synthetic-message-a',
    'capture-chatgpt-parser-heavy-',
    '/backend-api/',
    process.cwd(),
    'C:\\',
    'file:',
    ...fixtures.flatMap(fixture => fixture.inventory.files.map(file => file.relativePath)),
  ])
    expect(text).not.toContain(source);
  expect(plan.relations.length).toBeLessThanOrEqual(limits.maxRelations / 2);
  expect(encoded.byteLength).toBeLessThanOrEqual(limits.maxReportBytes / 2);
  return encoded;
}

describe
  .skipIf(!enabled)
  .sequential('snapshot analysis: opt-in parser-heavy defaults acceptance', () => {
    let pair: [ParserHeavyFixture, ParserHeavyFixture];

    beforeAll(async () => {
      // Sequential construction and analysis: no Promise.all and no retained hash arguments.
      pair = [await parserHeavyFixture('a'), await parserHeavyFixture('b')];
    }, timeout);

    it(
      'verifies a 90-99% shared-string workload with deterministic preserve-only reports',
      async () => {
        const started = performance.now();
        expect(limits.maxJsonStringCodeUnits).toBe(32 * 1024 * 1024);
        const measured = selectionMetrics(pair);
        const utilization = measured.strict.stringCodeUnits / limits.maxJsonStringCodeUnits;
        expect(utilization).toBeGreaterThanOrEqual(0.9);
        expect(utilization).toBeLessThanOrEqual(0.99);
        expectUnrelatedHeadroom(pair);
        for (const fixture of pair) {
          expect(fixture.metrics.nodes).toBe(2);
          expect(fixture.metrics.blocks).toBe(240);
        }
        const raw = (fixture: ParserHeavyFixture) => fixture.metrics.files[1].sha256;
        expect(raw(pair[0])).toBe(raw(pair[1]));
        const hashing = countingSha256();
        const plan = await analyzeSnapshots({
          snapshots: pair.map(value => value.inventory),
          sha256: hashing.sha256,
        });
        expect(plan.relations).toEqual([
          { left: 0, right: 1, classification: 'same-raw-different-evidence', preserveBoth: true },
        ]);
        expect(plan.snapshots[0].preserveReasons).toContain('first-observed');
        expect(plan.snapshots[1].preserveReasons).toContain('latest-observed');
        expect(
          plan.snapshots.every(entry => entry.preserveReasons.includes('unique-evidence'))
        ).toBe(true);
        for (const [index, entry] of plan.snapshots.entries())
          expect(entry.measuredByteLength).toBe(
            pair[index].metrics.files.reduce((sum, file) => sum + file.byteLength, 0)
          );
        expect(hashing.accounting.calls).toBeLessThanOrEqual(limits.maxHashCalls / 2);
        expect(hashing.accounting.bytes).toBeLessThanOrEqual(limits.maxHashBytes / 2);
        const encoded = expectSafeReport(plan, pair);
        const repeated = await analyzeSnapshots({
          snapshots: pair.map(value => value.inventory),
          sha256: countingSha256().sha256,
        });
        expect(expectSafeReport(repeated, pair)).toEqual(encoded);
        const reversed = await analyzeSnapshots({
          snapshots: [...pair]
            .reverse()
            .map(value => ({ files: [...value.inventory.files].reverse() })),
          sha256: countingSha256().sha256,
        });
        expectSafeReport(reversed, pair);
        expect(reversed.snapshots.map(entry => entry.inventorySha256)).toEqual(
          plan.snapshots.map(entry => entry.inventorySha256).reverse()
        );
        expect(encodeSnapshotAnalysisPlan(equivalentSelectionOrder(reversed))).toEqual(
          encodeSnapshotAnalysisPlan(equivalentSelectionOrder(plan))
        );
        for (const fixture of pair)
          expect(await inventoryFingerprints(fixture.inventory)).toEqual(fixture.metrics.files);
        console.info(
          'PARSER_HEAVY_ACCEPTED',
          JSON.stringify({
            fixtures: pair.map(fixture => fixture.metrics),
            selection: measured,
            stringUtilization: utilization,
            hash: hashing.accounting,
            reportBytes: encoded.byteLength,
            elapsedMs: Math.round(performance.now() - started),
          })
        );
      },
      timeout
    );

    it(
      'refuses only the actual-default aggregate string ceiling without a partial report',
      async () => {
        const started = performance.now();
        const third = await parserHeavyFixture('c');
        const control = await parserHeavyFixture('control', 1, 64);
        const fixtures = [...pair, third];
        expectUnrelatedHeadroom(fixtures);
        const measured = selectionMetrics(fixtures);
        expect(measured.strict.stringCodeUnits).toBeGreaterThan(limits.maxJsonStringCodeUnits);
        // The API requires two selections. A tiny valid peer proves each heavy
        // inventory is admissible through real analysis with unchanged defaults.
        const individualHash = [];
        for (const fixture of fixtures) {
          expect(selectionMetrics([fixture, control]).strict.stringCodeUnits).toBeLessThan(
            limits.maxJsonStringCodeUnits
          );
          const hashing = countingSha256();
          const plan = await analyzeSnapshots({
            snapshots: [fixture.inventory, control.inventory],
            sha256: hashing.sha256,
          });
          expectSafeReport(plan, [fixture, control]);
          individualHash.push({ ...hashing.accounting });
        }
        const hashing = countingSha256();
        let partialReport: SnapshotAnalysisPlan | undefined;
        let failure: unknown;
        try {
          partialReport = await analyzeSnapshots({
            snapshots: fixtures.map(value => value.inventory),
            sha256: hashing.sha256,
          });
        } catch (error) {
          failure = error;
        }
        expect(partialReport).toBeUndefined();
        expect(failure).toBeInstanceOf(SnapshotAnalysisError);
        expect(failure).toMatchObject({
          name: 'SnapshotAnalysisError',
          code: 'limit-exceeded',
          message: 'Snapshot analysis failed (limit-exceeded).',
        });
        expect(String(failure)).toBe(
          'SnapshotAnalysisError: Snapshot analysis failed (limit-exceeded).'
        );
        expect(Object.keys(failure as object).sort()).toEqual(['code', 'name']);
        expect(hashing.accounting.calls).toBeLessThanOrEqual(limits.maxHashCalls / 2);
        expect(hashing.accounting.bytes).toBeLessThanOrEqual(limits.maxHashBytes / 2);
        for (const fixture of [...fixtures, control])
          expect(await inventoryFingerprints(fixture.inventory)).toEqual(fixture.metrics.files);
        console.info(
          'PARSER_HEAVY_REFUSED',
          JSON.stringify({
            third: third.metrics,
            control: control.metrics,
            selection: measured,
            stringUtilization: measured.strict.stringCodeUnits / limits.maxJsonStringCodeUnits,
            individualHash,
            hashBeforeRefusal: hashing.accounting,
            elapsedMs: Math.round(performance.now() - started),
          })
        );
      },
      timeout
    );
  });
