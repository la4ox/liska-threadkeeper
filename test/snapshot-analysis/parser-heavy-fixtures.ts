import { createHash } from 'node:crypto';
import { buildCaptureManifest } from '../../src/archive/capture';
import { normalizeChatGptCapture } from '../../src/archive/normalizers/chatgpt';
import {
  SNAPSHOT_ANALYSIS_HARD_LIMITS,
  type SnapshotByteInventory,
} from '../../src/archive/snapshots';
import {
  graphProjection,
  projectionBytes,
  semanticProjection,
  writerBytes,
} from '../../src/archive/snapshots/fingerprint';
import {
  parseSnapshotJson,
  type SnapshotJsonBudget,
} from '../../src/archive/snapshots/strict-json';
import type { JsonValue } from '../../src/archive/types';

export const PARSER_HEAVY_CANARY = 'SYNTHETIC_PARSER_HEAVY_TEXT_CANARY';
export const PARSER_HEAVY_PART_COUNT = 240;
export const PARSER_HEAVY_PART_CODE_UNITS = 32 * 1024;

export const sha256 = async (bytes: Uint8Array): Promise<string> =>
  createHash('sha256').update(bytes).digest('hex');

export function countingSha256() {
  // Counters only: a spy would retain every private hash-input byte copy.
  const accounting = { calls: 0, bytes: 0, maxCallBytes: 0 };
  return {
    accounting,
    sha256: async (bytes: Uint8Array): Promise<string> => {
      accounting.calls += 1;
      accounting.bytes += bytes.byteLength;
      accounting.maxCallBytes = Math.max(accounting.maxCallBytes, bytes.byteLength);
      return sha256(bytes);
    },
  };
}

function containerDepth(value: JsonValue): number {
  if (value === null || typeof value !== 'object') return 0;
  const children = Array.isArray(value) ? value : Object.values(value);
  return 1 + children.reduce<number>((depth, child) => Math.max(depth, containerDepth(child)), 0);
}

export async function inventoryFingerprints(snapshot: SnapshotByteInventory) {
  // Retain lengths/digests, never a clone of the source corpus.
  const fingerprints = [];
  for (const file of snapshot.files)
    fingerprints.push({
      relativePath: file.relativePath,
      byteLength: file.bytes.byteLength,
      sha256: await sha256(file.bytes),
    });
  return fingerprints;
}

export async function parserHeavyFixture(
  label: 'a' | 'b' | 'c' | 'control',
  partCount = PARSER_HEAVY_PART_COUNT,
  partCodeUnits = PARSER_HEAVY_PART_CODE_UNITS
) {
  const encoder = new TextEncoder();
  const parts = Array.from({ length: partCount }, (_, index) => {
    const prefix = `${PARSER_HEAVY_CANARY}_${String(index).padStart(3, '0')}_`;
    return prefix + 'x'.repeat(partCodeUnits - prefix.length);
  });
  const raw = {
    conversation_id: 'synthetic-parser-heavy-thread',
    title: 'synthetic-parser-heavy-title',
    current_node: 'a',
    mapping: {
      a: {
        id: 'a',
        parent: null,
        children: ['b'],
        message: {
          id: 'synthetic-message-a',
          author: { role: 'assistant', name: null },
          content: { content_type: 'text', parts },
          metadata: {},
        },
      },
      b: { id: 'b', parent: 'a', children: [], message: null },
    },
  };
  const rawBytes = encoder.encode(JSON.stringify(raw));
  const day = { a: '01', b: '02', c: '03', control: '04' }[label];
  const manifest = buildCaptureManifest({
    captureId: `capture-chatgpt-parser-heavy-${label}`,
    provider: 'chatgpt',
    conversationId: raw.conversation_id,
    capturedAt: `2026-01-${day}T00:00:00.000Z`,
    method: 'same-origin-api',
    artifacts: [
      {
        id: 'conversation',
        relativePath: 'responses/conversation.json',
        mediaType: 'application/json',
        byteLength: rawBytes.byteLength,
        sha256: await sha256(rawBytes),
        endpoint: { method: 'GET', pathPattern: '/backend-api/conversation/{conversationId}' },
      },
    ],
    completeness: {
      graph: 'complete',
      messages: 'complete',
      branches: 'complete',
      assets: 'complete',
    },
    warnings: [],
    assets: [],
  });
  const manifestBytes = writerBytes(manifest);
  const archive = (
    await normalizeChatGptCapture({
      bundle: {
        manifest,
        artifacts: [{ record: manifest.artifacts[0], bytes: rawBytes }],
        assets: [],
      },
      artifactId: 'conversation',
      manifestSha256: await sha256(manifestBytes),
      sha256,
    })
  ).archive;
  const inventory: SnapshotByteInventory = {
    // Verification consumes these JSON slots in this same manifest/raw/canonical order.
    files: [
      { relativePath: 'manifest.json', bytes: manifestBytes },
      { relativePath: 'responses/conversation.json', bytes: rawBytes },
      { relativePath: 'canonical/liska-thread-1.json', bytes: writerBytes(archive) },
    ],
  };
  const strict: SnapshotJsonBudget = { values: 0, stringCodeUnits: 0, work: 0 };
  let maxJsonDepth = 0;
  for (const file of inventory.files)
    maxJsonDepth = Math.max(
      maxJsonDepth,
      containerDepth(parseSnapshotJson(file.bytes, { ...SNAPSHOT_ANALYSIS_HARD_LIMITS }, strict))
    );
  const projectionBudget = { projectionBytes: 0 };
  const semanticBytes = projectionBytes(
    semanticProjection(archive, manifest),
    { ...SNAPSHOT_ANALYSIS_HARD_LIMITS },
    projectionBudget
  ).bytes.byteLength;
  const graphBytes = projectionBytes(
    graphProjection(archive),
    { ...SNAPSHOT_ANALYSIS_HARD_LIMITS },
    projectionBudget
  ).bytes.byteLength;
  const nodes = Object.values(archive.graph.nodes);
  return {
    inventory,
    metrics: {
      partCount,
      partCodeUnits,
      files: await inventoryFingerprints(inventory),
      strict,
      maxJsonDepth,
      nodes: nodes.length,
      blocks: nodes.reduce((total, node) => total + (node.message?.blocks.length ?? 0), 0),
      assets: Object.keys(archive.assets).length,
      diagnostics: archive.diagnostics.entries.length,
      projectionBytes: { semantic: semanticBytes, graph: graphBytes },
    },
  };
}

export type ParserHeavyFixture = Awaited<ReturnType<typeof parserHeavyFixture>>;

export function selectionMetrics(fixtures: readonly ParserHeavyFixture[]) {
  return {
    snapshots: fixtures.length,
    totalFiles: fixtures.reduce((total, fixture) => total + fixture.metrics.files.length, 0),
    totalBytes: fixtures.reduce(
      (total, fixture) =>
        total + fixture.metrics.files.reduce((sum, file) => sum + file.byteLength, 0),
      0
    ),
    strict: fixtures.reduce<SnapshotJsonBudget>(
      (total, fixture) => ({
        values: total.values + fixture.metrics.strict.values,
        stringCodeUnits: total.stringCodeUnits + fixture.metrics.strict.stringCodeUnits,
        work: total.work + fixture.metrics.strict.work,
      }),
      { values: 0, stringCodeUnits: 0, work: 0 }
    ),
    totalProjectionBytes: fixtures.reduce(
      (total, fixture) =>
        total + fixture.metrics.projectionBytes.semantic + fixture.metrics.projectionBytes.graph,
      0
    ),
  };
}
