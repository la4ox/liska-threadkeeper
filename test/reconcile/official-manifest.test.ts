import { describe, expect, it } from 'vitest';
import {
  admitOfficialManifest,
  OFFICIAL_MANIFEST_LIMITS,
  OfficialManifestAdmissionError,
} from '../../src/reconcile/official-manifest';

const encoder = new TextEncoder();
const SHARDS = ['conversations-000.json', 'conversations-002.json'];
const PRIVATE = 'PRIVATE_UNRELATED_FILE_PATH_CANARY';
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value));

function manifest(files: unknown = SHARDS) {
  return {
    version: 1,
    manifest_file: 'export_manifest.json',
    logical_files: {
      'conversations.json': {
        files,
        shard_count: Array.isArray(files) ? files.length : 2,
        sharded: true,
      },
    },
    export_files: [PRIVATE],
  };
}

function expectCode(input: Uint8Array, selected: readonly string[], code: string): void {
  let caught: unknown;
  try {
    admitOfficialManifest(input, selected);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(OfficialManifestAdmissionError);
  expect(caught).toHaveProperty('code', code);
  expect(String(caught)).not.toContain(PRIVATE);
}

describe('official export manifest name-set admission', () => {
  it('accepts an exact shuffled set and returns only frozen numeric evidence', () => {
    const input = manifest();
    Object.assign(input.logical_files, {
      [PRIVATE]: { files: [PRIVATE], shard_count: 1, sharded: true },
    });
    const result = admitOfficialManifest(bytes(input), [...SHARDS].reverse());
    expect(result).toEqual({ schemaVersion: 1, declaredShardCount: 2, selectedShardCount: 2 });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|conversations|manifest\.json/);
  });

  it.each([undefined, null, '1', 0, 2, true])('rejects unsupported version %s', version => {
    expectCode(bytes({ ...manifest(), version }), SHARDS, 'version-unsupported');
  });

  it.each([
    { ...manifest(), manifest_file: undefined },
    { ...manifest(), manifest_file: 'private/export_manifest.json' },
    { ...manifest(), manifest_file: 'Export_manifest.json' },
    { ...manifest(), logical_files: null },
    { ...manifest(), logical_files: [] },
    { ...manifest(), logical_files: {} },
    { ...manifest(), logical_files: { 'conversations.json': null } },
    { ...manifest(), logical_files: { 'conversations.json': [] } },
  ])('rejects a missing or invalid required envelope/declaration', input => {
    expect(() => admitOfficialManifest(bytes(input), SHARDS)).toThrow(
      OfficialManifestAdmissionError
    );
  });

  it.each([undefined, false, 'true', 1])('requires sharded exactly true, not %s', sharded => {
    const input = manifest();
    Object.assign(input.logical_files['conversations.json'], { sharded });
    expectCode(bytes(input), SHARDS, 'declaration-invalid');
  });

  it.each([undefined, '2', 0, -1, 1.5, 1, 3, 1001])(
    'requires exact shard_count %s',
    shard_count => {
      const input = manifest();
      Object.assign(input.logical_files['conversations.json'], { shard_count });
      expectCode(bytes(input), SHARDS, 'declaration-invalid');
    }
  );

  it.each([null, {}, 'conversations-000.json', [], new Array(1001).fill('conversations-000.json')])(
    'rejects malformed or excessive files declarations',
    files => expectCode(bytes(manifest(files)), SHARDS, 'declaration-invalid')
  );

  it.each([
    'conversations.json',
    'conversations-0.json',
    'conversations-1000.json',
    'Conversations-000.json',
    'conversations-000.JSON',
    './conversations-000.json',
    'folder/conversations-000.json',
    'folder\\conversations-000.json',
    '%63onversations-000.json',
    ' conversations-000.json',
    'conversations-000.json\n',
    0,
  ])('never normalizes invalid declared name %s', name => {
    expectCode(bytes(manifest([name])), ['conversations-000.json'], 'declaration-invalid');
  });

  it('rejects duplicate declaration before using set equality', () => {
    expectCode(bytes(manifest([SHARDS[0], SHARDS[0]])), [SHARDS[0]], 'declaration-duplicate');
  });

  it.each([
    [],
    [SHARDS[0], SHARDS[0]],
    ['folder/conversations-000.json'],
    ['conversations-0.json'],
  ])('rejects invalid or duplicate selected names', selected =>
    expect(() => admitOfficialManifest(bytes(manifest()), selected)).toThrow(
      OfficialManifestAdmissionError
    )
  );

  it('rejects a missing non-target shard', () => {
    expectCode(bytes(manifest()), [SHARDS[0]], 'shards-missing');
  });

  it('rejects an unexpected selected shard', () => {
    expectCode(bytes(manifest()), [...SHARDS, 'conversations-003.json'], 'shards-unexpected');
  });

  it.each([
    ['', 'invalid-json'],
    ['[]', 'invalid-json'],
    ['null', 'invalid-json'],
    ['{"version":1', 'invalid-json'],
    ['{"version":1} trailing', 'invalid-json'],
    ['{"version":1,"ver\\u0073ion":1}', 'duplicate-json-key'],
    ['{"ignored":{"same":1,"s\\u0061me":2}}', 'duplicate-json-key'],
  ])('rejects invalid JSON or duplicate decoded keys', (text, code) => {
    expectCode(encoder.encode(text), SHARDS, code);
  });

  it('rejects malformed UTF-8 and a UTF-8 BOM', () => {
    expectCode(new Uint8Array([0x7b, 0xff, 0x7d]), SHARDS, 'invalid-utf8');
    expectCode(
      new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(manifest())]),
      SHARDS,
      'bom-not-supported'
    );
  });

  it('accepts exactly 2 MiB and rejects one additional byte', () => {
    const json = bytes(manifest());
    const exact = new Uint8Array(OFFICIAL_MANIFEST_LIMITS.maxBytes).fill(0x20);
    exact.set(json);
    expect(admitOfficialManifest(exact, SHARDS).declaredShardCount).toBe(2);
    expectCode(new Uint8Array(exact.byteLength + 1), SHARDS, 'byte-limit');
  });

  it('bounds all JSON nesting, including unrelated inventory fields', () => {
    const extra = (depth: number) => {
      let value: unknown = null;
      for (let index = 0; index < depth; index += 1) value = [value];
      return bytes({ ...manifest(), extra: value });
    };
    expect(admitOfficialManifest(extra(31), SHARDS).schemaVersion).toBe(1);
    expectCode(extra(32), SHARDS, 'json-limit');
  });

  it('bounds all JSON values before allocating the parsed object tree', () => {
    // Base shape has 12 values, plus one ignored array and its scalar values.
    const exact = {
      ...manifest(),
      extra: new Array(OFFICIAL_MANIFEST_LIMITS.maxValues - 13).fill(0),
    };
    expect(admitOfficialManifest(bytes(exact), SHARDS).schemaVersion).toBe(1);
    exact.extra.push(0);
    expectCode(bytes(exact), SHARDS, 'json-limit');
  });

  it('supports every canonical three-digit shard without requiring contiguous indices', () => {
    const files = Array.from(
      { length: 1000 },
      (_, index) => `conversations-${String(index).padStart(3, '0')}.json`
    );
    expect(
      admitOfficialManifest(bytes(manifest(files)), [...files].reverse()).declaredShardCount
    ).toBe(1000);
    expect(
      admitOfficialManifest(bytes(manifest(['conversations-999.json'])), ['conversations-999.json'])
        .declaredShardCount
    ).toBe(1);
  });
});
