import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildCaptureManifest, type RawCaptureManifest } from '../../src/archive/capture';
import { normalizeChatGptCapture } from '../../src/archive/normalizers/chatgpt';
import {
  analyzeSnapshots,
  encodeSnapshotAnalysisPlan,
  SNAPSHOT_ANALYSIS_HARD_LIMITS,
  SnapshotAnalysisError,
  type AnalyzeSnapshotsInput,
  type SnapshotByteInventory,
  type SnapshotFileBytes,
} from '../../src/archive/snapshots';
import {
  graphProjection,
  semanticProjection,
  stableJson,
} from '../../src/archive/snapshots/fingerprint';
import { parseSnapshotJson } from '../../src/archive/snapshots/strict-json';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const jsonBytes = (value: unknown) => encoder.encode(JSON.stringify(value, null, 2));
const hash = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const privateCanary = 'PRIVATE_title_path_provider_CANARY';

interface FixtureOptions {
  capture?: string;
  at?: string;
  rawWhitespace?: string;
  text?: string;
  current?: 'a' | 'b';
  partial?: boolean;
  warning?: string;
  asset?: boolean;
  assetAttemptedAt?: string;
  rawOnly?: boolean;
  identity?: string;
}

async function fixture(options: FixtureOptions = {}): Promise<SnapshotByteInventory> {
  const identity = options.identity ?? privateCanary;
  const raw = {
    conversation_id: identity,
    title: privateCanary,
    current_node: options.current ?? 'a',
    mapping: {
      a: {
        id: 'a',
        parent: null,
        children: ['b'],
        message: {
          id: 'message-a',
          author: { role: 'assistant', name: null },
          content: { content_type: 'text', parts: [options.text ?? 'Synthetic retained content'] },
          metadata: {},
        },
      },
      b: { id: 'b', parent: 'a', children: [], message: null },
    },
  };
  const rawBytes = encoder.encode(JSON.stringify(raw) + (options.rawWhitespace ?? ''));
  const assetBytes = encoder.encode('synthetic binary bytes');
  const manifest = buildCaptureManifest({
    captureId: options.capture ?? 'capture-chatgpt-snapshot-a',
    provider: 'chatgpt',
    conversationId: identity,
    capturedAt: options.at ?? '2026-01-01T00:00:00.000Z',
    method: 'same-origin-api',
    artifacts: [
      {
        id: 'conversation',
        relativePath: 'responses/conversation.json',
        mediaType: 'application/json',
        byteLength: rawBytes.length,
        sha256: await hash(rawBytes),
        endpoint: { method: 'GET', pathPattern: '/backend-api/conversation/{conversationId}' },
      },
    ],
    completeness: {
      graph: options.partial ? 'partial' : 'complete',
      messages: 'complete',
      branches: 'complete',
      assets: 'complete',
    },
    warnings: options.warning ? [options.warning] : [],
    assets: options.asset
      ? [
          {
            id: 'asset-a',
            state: 'fetched',
            attemptedAt: options.assetAttemptedAt ?? '2026-01-01T00:00:01.000Z',
            relativePath: 'assets/synthetic.bin',
            mediaType: 'application/octet-stream',
            byteLength: assetBytes.length,
            sha256: await hash(assetBytes),
            detail: null,
            sourceRefs: [
              { artifactId: 'conversation', rawPointer: '/mapping/a/message/content/parts/0' },
            ],
          },
        ]
      : [],
  });
  const manifestBytes = jsonBytes(manifest);
  const files: SnapshotFileBytes[] = [
    { relativePath: 'manifest.json', bytes: manifestBytes },
    { relativePath: 'responses/conversation.json', bytes: rawBytes },
  ];
  if (options.asset) files.push({ relativePath: 'assets/synthetic.bin', bytes: assetBytes });
  if (!options.rawOnly) {
    const canonical = (
      await normalizeChatGptCapture({
        bundle: {
          manifest,
          artifacts: [{ record: manifest.artifacts[0], bytes: rawBytes }],
          assets: options.asset ? [{ record: manifest.assets[0], bytes: assetBytes }] : [],
        },
        artifactId: 'conversation',
        manifestSha256: await hash(manifestBytes),
        sha256: hash,
      })
    ).archive;
    files.push({ relativePath: 'canonical/liska-thread-1.json', bytes: jsonBytes(canonical) });
  }
  return { files };
}

function file(snapshot: SnapshotByteInventory, path: string): SnapshotFileBytes {
  return snapshot.files.find(value => value.relativePath === path)!;
}

function replace(
  snapshot: SnapshotByteInventory,
  path: string,
  bytes: Uint8Array
): SnapshotByteInventory {
  return {
    files: snapshot.files.map(value => (value.relativePath === path ? { ...value, bytes } : value)),
  };
}

async function analyze(
  snapshots: readonly SnapshotByteInventory[],
  limits?: AnalyzeSnapshotsInput['limits']
) {
  return analyzeSnapshots({ snapshots, sha256: hash, ...(limits && { limits }) });
}

describe('snapshot analysis: measured/replayed evidence', () => {
  it('verifies exact bytes and produces a preserve-only byte-identical candidate', async () => {
    const a = await fixture();
    const before = structuredClone(a);
    const plan = await analyze([a, a]);

    expect(plan).toMatchObject({
      analysisOnly: true,
      mutationAuthorized: false,
      referenceCoverage: 'selected-inputs-only',
    });
    expect(plan.snapshots.map(value => value.verification)).toEqual(['verified', 'verified']);
    expect(plan.relations).toEqual([
      { left: 0, right: 1, classification: 'byte-identical', preserveBoth: true },
    ]);
    expect(plan.snapshots[0].measuredByteLength).toBe(
      a.files.reduce((total, value) => total + value.bytes.length, 0)
    );
    expect(a).toEqual(before);
    expect(decoder.decode(encodeSnapshotAnalysisPlan(plan))).not.toContain(privateCanary);
    expect(decoder.decode(encodeSnapshotAnalysisPlan(plan))).not.toContain(
      'responses/conversation.json'
    );
  });

  it('preserves capture/time-only evidence despite identical raw', async () => {
    const a = await fixture();
    const b = await fixture({
      capture: 'capture-chatgpt-snapshot-b',
      at: '2026-01-02T00:00:00.000Z',
    });
    const plan = await analyze([a, b]);
    expect(plan.relations[0].classification).toBe('same-raw-different-evidence');
    expect(plan.snapshots[0].preserveReasons).toContain('first-observed');
    expect(plan.snapshots[1].preserveReasons).toContain('latest-observed');
    expect(plan.snapshots.every(value => value.preserveReasons.includes('unique-evidence'))).toBe(
      true
    );
  });

  it('keeps acquisition timestamps and completeness as distinct evidence', async () => {
    const a = await fixture({ asset: true });
    const b = await fixture({
      asset: true,
      partial: true,
      warning: 'partial',
      assetAttemptedAt: '2026-01-01T00:00:02.000Z',
    });
    const plan = await analyze([a, b]);
    expect(plan.snapshots.every(value => value.verification === 'verified')).toBe(true);
    expect(plan.snapshots[1].preserveReasons).toContain('partial-capture');
    expect(plan.relations[0].classification).toBe('same-raw-different-evidence');
  });

  it('reports only advisory semantics when exact raw whitespace differs', async () => {
    const plan = await analyze([await fixture(), await fixture({ rawWhitespace: '\n ' })]);
    expect(plan.relations[0]).toMatchObject({
      classification: 'semantic-candidate',
      preserveBoth: true,
    });
  });

  it('does not merge differing messages or unrelated identities into candidates', async () => {
    const plan = await analyze([
      await fixture(),
      await fixture({ text: 'Changed message' }),
      await fixture({ identity: 'other-conversation' }),
    ]);
    expect(plan.relations).toEqual([]);
  });

  it('preserves both sides of graph transitions, including A → B → A', async () => {
    const snapshots = await Promise.all([
      fixture({ at: '2026-01-01T00:00:00.000Z', current: 'a' }),
      fixture({ at: '2026-01-02T00:00:00.000Z', current: 'b' }),
      fixture({ at: '2026-01-03T00:00:00.000Z', current: 'a' }),
    ]);
    const plan = await analyze(snapshots);
    expect(plan.snapshots.every(value => value.preserveReasons.includes('graph-change'))).toBe(
      true
    );
    expect(plan.relations).toHaveLength(1);
    expect(plan.relations[0]).toMatchObject({
      left: 0,
      right: 2,
      classification: 'same-raw-different-evidence',
    });
  });

  it('does not let an intervening raw-only snapshot hide a verified graph transition', async () => {
    const snapshots = await Promise.all([
      fixture({ at: '2026-01-01T00:00:00.000Z', current: 'a' }),
      fixture({ at: '2026-01-02T00:00:00.000Z', rawOnly: true }),
      fixture({ at: '2026-01-03T00:00:00.000Z', current: 'b' }),
    ]);

    const plan = await analyze(snapshots);

    expect(plan.snapshots[0].preserveReasons).toContain('graph-change');
    expect(plan.snapshots[1].preserveReasons).not.toContain('graph-change');
    expect(plan.snapshots[1].preserveReasons).toContain('raw-only');
    expect(plan.snapshots[2].preserveReasons).toContain('graph-change');
  });

  it('preserves all chronology ties rather than guessing first/latest ownership', async () => {
    const a = await fixture();
    const plan = await analyze([a, a]);
    for (const entry of plan.snapshots)
      expect(entry.preserveReasons).toEqual(
        expect.arrayContaining([
          'first-observed',
          'latest-observed',
          'chronology-ambiguous',
          'external-references-unassessed',
        ])
      );
  });

  it('marks mixed-graph timestamp ties independently of selection order', async () => {
    const tied = await Promise.all([
      fixture({ capture: 'capture-chatgpt-tied-a1', current: 'a' }),
      fixture({ capture: 'capture-chatgpt-tied-a2', current: 'a' }),
      fixture({ capture: 'capture-chatgpt-tied-b', current: 'b' }),
    ]);
    const left = await analyze(tied);
    const right = await analyze([tied[0], tied[2], tied[1]]);

    expect(left.snapshots.every(entry => entry.preserveReasons.includes('graph-change'))).toBe(
      true
    );
    expect(right.snapshots.every(entry => entry.preserveReasons.includes('graph-change'))).toBe(
      true
    );
    expect(
      left.snapshots
        .map(entry => [entry.inventorySha256, entry.preserveReasons.includes('graph-change')])
        .sort()
    ).toEqual(
      right.snapshots
        .map(entry => [entry.inventorySha256, entry.preserveReasons.includes('graph-change')])
        .sort()
    );
  });

  it('retains raw-only and opaque presentation evidence without duplicate certification', async () => {
    const raw = await fixture({ rawOnly: true });
    const normal = await fixture();
    const opaque = {
      files: [
        ...normal.files,
        { relativePath: 'reading/private.html', bytes: encoder.encode(privateCanary) },
      ],
    };
    const plan = await analyze([raw, raw, opaque]);
    expect(plan.snapshots[0]).toMatchObject({ verification: 'partial', code: null });
    expect(plan.snapshots[0].preserveReasons).toContain('raw-only');
    expect(plan.snapshots[2].preserveReasons).toEqual(
      expect.arrayContaining(['opaque-files', 'presentation-reference'])
    );
    expect(plan.relations[0].classification).toBe('unverifiable');
  });

  it.each(['manifest.json', 'responses/conversation.json', 'assets/synthetic.bin'])(
    'fails closed on same-length tampering of %s',
    async path => {
      const snapshot = await fixture({ asset: true });
      const bytes = new Uint8Array(file(snapshot, path).bytes);
      bytes[bytes.length - 1] ^= 1;
      const plan = await analyze([snapshot, replace(snapshot, path, bytes)]);
      expect(plan.snapshots[1].verification).toBe('unverifiable');
      expect(plan.snapshots[1].preserveReasons).toContain('integrity-unverified');
      expect(plan.relations).toEqual([]);
    }
  );

  it('refuses missing fetched asset bytes instead of downgrading acquisition', async () => {
    const a = await fixture({ asset: true });
    const b = { files: a.files.filter(value => !value.relativePath.startsWith('assets/')) };
    const plan = await analyze([a, b]);
    expect(plan.snapshots[1]).toMatchObject({
      verification: 'unverifiable',
      code: 'missing-evidence',
    });
  });

  it('refuses schema-valid but unrelated canonical bytes through replay', async () => {
    const a = await fixture();
    const b = await fixture({ text: 'A different canonical message' });
    const unrelated = JSON.parse(decoder.decode(file(b, 'canonical/liska-thread-1.json').bytes));
    const original = JSON.parse(decoder.decode(file(a, 'canonical/liska-thread-1.json').bytes));
    unrelated.inputs = original.inputs;
    const plan = await analyze([
      a,
      replace(a, 'canonical/liska-thread-1.json', jsonBytes(unrelated)),
    ]);
    expect(plan.snapshots[1]).toMatchObject({
      verification: 'unverifiable',
      code: 'canonical-replay-failed',
    });
  });

  it('requires exact manifest and canonical writer encoding, not equivalent parsed JSON', async () => {
    const a = await fixture();
    const compact = (path: string) =>
      encoder.encode(JSON.stringify(JSON.parse(decoder.decode(file(a, path).bytes))));
    const plan = await analyze([
      replace(a, 'manifest.json', compact('manifest.json')),
      replace(a, 'canonical/liska-thread-1.json', compact('canonical/liska-thread-1.json')),
    ]);
    expect(plan.snapshots.map(value => value.code)).toEqual([
      'writer-encoding-invalid',
      'canonical-replay-failed',
    ]);
  });

  it('preserves unsupported provider/method/normalizer versions explicitly', async () => {
    const a = await fixture();
    const manifest = JSON.parse(
      decoder.decode(file(a, 'manifest.json').bytes)
    ) as RawCaptureManifest;
    manifest.provider = 'deepseek';
    const canonical = JSON.parse(decoder.decode(file(a, 'canonical/liska-thread-1.json').bytes));
    canonical.inputs[0].normalizer = 'chatgpt-web/2';
    const plan = await analyze([
      replace(a, 'manifest.json', jsonBytes(manifest)),
      replace(a, 'canonical/liska-thread-1.json', jsonBytes(canonical)),
    ]);
    expect(plan.snapshots.map(value => value.code)).toEqual([
      'unsupported-snapshot-format',
      'unsupported-normalizer',
    ]);
    expect(
      plan.snapshots.every(value => value.preserveReasons.includes('unsupported-version'))
    ).toBe(true);
  });

  it('rejects duplicate JSON keys before a parser can discard evidence', async () => {
    const a = await fixture();
    const tampered = replace(
      a,
      'manifest.json',
      encoder.encode('{"schema":"private","schema":"liska-capture/1"}')
    );
    const plan = await analyze([a, tampered]);
    expect(plan.snapshots[1].code).toBe('duplicate-json-key');
  });

  it('is file-order deterministic and produces linear sparse relation output', async () => {
    const a = await fixture();
    const reversed = { files: [...a.files].reverse() };
    const plan = await analyze([a, reversed, a, a]);
    expect(
      plan.snapshots.every(value => value.inventorySha256 === plan.snapshots[0].inventorySha256)
    ).toBe(true);
    expect(plan.relations).toHaveLength(3);
    expect(encodeSnapshotAnalysisPlan(plan)).toEqual(
      encodeSnapshotAnalysisPlan(await analyze([a, reversed, a, a]))
    );
  });

  it('preserves selection ordinals while candidate facts remain permutation invariant', async () => {
    const a = await fixture();
    const b = await fixture({
      capture: 'capture-chatgpt-snapshot-b',
      at: '2026-01-02T00:00:00.000Z',
    });
    const forward = await analyze([a, b]);
    const reverse = await analyze([b, a]);
    const facts = (plan: typeof forward) =>
      plan.snapshots
        .map(({ ordinal: _ordinal, ...entry }) => entry)
        .sort((left, right) => (left.inventorySha256 < right.inventorySha256 ? -1 : 1));
    expect(facts(forward)).toEqual(facts(reverse));
    expect(forward.relations).toEqual(reverse.relations);
  });

  it('copies exact offset views without including unrelated backing bytes', async () => {
    const a = await fixture();
    const b = {
      files: a.files.map(value => {
        const buffer = new Uint8Array(value.bytes.length + 6).fill(0xff);
        buffer.set(value.bytes, 3);
        return {
          relativePath: value.relativePath,
          bytes: new Uint8Array(buffer.buffer, 3, value.bytes.length),
        };
      }),
    };
    const plan = await analyze([a, b]);
    expect(plan.relations[0].classification).toBe('byte-identical');
  });
});

describe('snapshot analysis: admission, owned bytes and trusted hashing', () => {
  it('copies every selected view before the first await and ignores subsequent caller mutation', async () => {
    const a = await fixture();
    const b = await fixture({ capture: 'capture-chatgpt-snapshot-b' });
    const original = structuredClone([a, b]);
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let first = true;
    const pending = analyzeSnapshots({
      snapshots: [a, b],
      sha256: async bytes => {
        if (first) {
          first = false;
          await gate;
        }
        return hash(bytes);
      },
    });
    for (const snapshot of [a, b]) for (const value of snapshot.files) value.bytes.fill(0);
    release();

    const plan = await pending;
    expect(plan.snapshots.every(value => value.verification === 'verified')).toBe(true);
    expect(plan).toEqual(await analyze(original));
  });

  it('rejects accessors, symbols, sparse arrays, extra keys and nonplain descriptor shapes before hashing', async () => {
    const a = await fixture();
    const getter = vi.fn(() => a.files);
    const hashSpy = vi.fn(hash);
    const accessor = Object.defineProperty({}, 'files', { enumerable: true, get: getter });
    const sparse = new Array(2);
    sparse[0] = a;
    const candidates = [
      { snapshots: [a, accessor], sha256: hashSpy },
      { snapshots: [a, a], sha256: hashSpy, extra: true },
      { snapshots: [a, { ...a, [Symbol('private')]: true }], sha256: hashSpy },
      { snapshots: sparse, sha256: hashSpy },
      { snapshots: [a, Object.assign(Object.create({ inherited: true }), a)], sha256: hashSpy },
      { snapshots: [a, { files: [{ ...a.files[0], extra: true }] }], sha256: hashSpy },
    ];
    for (const candidate of candidates)
      await expect(analyzeSnapshots(candidate as AnalyzeSnapshotsInput)).rejects.toThrow(
        SnapshotAnalysisError
      );
    expect(getter).not.toHaveBeenCalled();
    expect(hashSpy).not.toHaveBeenCalled();
  });

  it('sanitizes Proxy trap failures without claiming transparent Proxy detectability', async () => {
    const a = await fixture();
    const hostile = new Proxy(
      { snapshots: [a, a], sha256: hash },
      {
        ownKeys() {
          throw new Error(privateCanary);
        },
      }
    );
    await expect(analyzeSnapshots(hostile)).rejects.toThrow(
      'Snapshot analysis failed (invalid-request).'
    );
    const transparent = new Proxy({ files: a.files }, {});
    expect((await analyze([a, transparent])).snapshots[1].verification).toBe('verified');
  });

  it('rejects typed-view Proxies, non-Uint8 native arrays and shared buffers', async () => {
    const a = await fixture();
    const candidates: unknown[] = [new Proxy(new Uint8Array([1]), {}), new Uint16Array([1])];
    if (typeof SharedArrayBuffer !== 'undefined')
      candidates.push(new Uint8Array(new SharedArrayBuffer(1)));
    for (const bytes of candidates) {
      const bad = { files: [{ relativePath: 'manifest.json', bytes: bytes as Uint8Array }] };
      await expect(analyze([a, bad])).rejects.toThrow(/invalid-request/);
    }
  });

  it('rejects resizable and detached backing stores using native slots', async () => {
    const a = await fixture();
    const native = Object.getPrototypeOf(encoder.encode('').buffer).constructor;
    const resizable = new native(1, { maxByteLength: 8 });
    const bytes = new Uint8Array(resizable);
    await expect(
      analyze([a, { files: [{ relativePath: 'manifest.json', bytes }] }])
    ).rejects.toThrow(/invalid-request/);
    const detached = new Uint8Array(1);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    await expect(
      analyze([a, { files: [{ relativePath: 'manifest.json', bytes: detached }] }])
    ).rejects.toThrow(/invalid-request/);
  });

  it('uses native byte-view slots without invoking shadowed view property getters', async () => {
    const a = await fixture();
    const value = new Uint8Array(file(a, 'manifest.json').bytes);
    const getter = vi.fn(() => {
      throw new Error(privateCanary);
    });
    Object.defineProperty(value, 'buffer', { get: getter });
    Object.defineProperty(value, 'byteLength', { get: getter });
    const b = replace(a, 'manifest.json', value);
    const plan = await analyze([a, b]);
    expect(getter).not.toHaveBeenCalled();
    expect(plan.relations[0].classification).toBe('byte-identical');
  });

  it.each([
    '../manifest.json',
    '/manifest.json',
    'C:/private',
    'folder\\file',
    'folder/file:stream',
    'folder//file',
    './file',
    'folder/trailing.',
    'folder/trailing ',
  ])('rejects ambiguous/unsafe input-only slot %s', async path => {
    const a = await fixture();
    await expect(
      analyze([a, { files: [{ relativePath: path, bytes: encoder.encode('{}') }] }])
    ).rejects.toThrow(/invalid-request/);
  });

  it('refuses duplicate and Windows-case-alias file slots', async () => {
    const a = await fixture();
    for (const path of ['manifest.json', 'MANIFEST.JSON']) {
      await expect(
        analyze([a, { files: [...a.files, { relativePath: path, bytes: encoder.encode('{}') }] }])
      ).rejects.toThrow(/invalid-request/);
    }
  });

  it.each([
    [
      'throws',
      async () => {
        throw new Error(privateCanary);
      },
      'sha256-failed',
    ],
    ['uppercase', async () => 'A'.repeat(64), 'sha256-invalid'],
    ['wrong length', async () => 'a'.repeat(63), 'sha256-invalid'],
    [
      'mutates',
      async (bytes: Uint8Array) => {
        bytes[0] ^= 1;
        return hash(bytes);
      },
      'sha256-mutated',
    ],
  ])('fails closed when trusted SHA capability %s', async (_label, sha256, code) => {
    const a = await fixture();
    const before = structuredClone(a);
    await expect(analyzeSnapshots({ snapshots: [a, a], sha256 })).rejects.toThrow(
      new RegExp(code as string)
    );
    expect(a).toEqual(before);
  });

  it('never confuses a malformed hash or content error with caller-thrown error-class lookalikes', async () => {
    const a = await fixture();
    const hostile = new Proxy(
      { snapshots: [a, a], sha256: hash },
      {
        ownKeys() {
          throw new SnapshotAnalysisError('sha256-mutated');
        },
      }
    );
    await expect(analyzeSnapshots(hostile)).rejects.toThrow(/invalid-request/);
  });

  it('preserves hash mutation failure even when normalizer replay sanitizes thrown errors', async () => {
    const a = await fixture();
    let calls = 0;
    const sha256 = async (bytes: Uint8Array) => {
      calls += 1;
      // Eight inventory/file digests and one bundle check precede replay's
      // first manifest digest. Do not let its error wrapping hide the fault.
      if (calls === 10) bytes[0] ^= 1;
      return hash(bytes);
    };
    await expect(analyzeSnapshots({ snapshots: [a, a], sha256 })).rejects.toThrow(/sha256-mutated/);
  });

  it('hashes opaque extras too, without treating a supplied file as a persistence receipt', async () => {
    const a = await fixture();
    const privateBytes = encoder.encode(privateCanary);
    const opaque = {
      files: [
        ...a.files,
        { relativePath: 'presentation/custom.receipt.json', bytes: privateBytes },
      ],
    };
    const spy = vi.fn(hash);
    const plan = await analyzeSnapshots({ snapshots: [a, opaque], sha256: spy });
    expect(
      spy.mock.calls.some(
        ([bytes]) => bytes.length === privateBytes.length && decoder.decode(bytes) === privateCanary
      )
    ).toBe(true);
    expect(plan.snapshots[1].verification).toBe('partial');
    expect(decoder.decode(encodeSnapshotAnalysisPlan(plan))).not.toContain(privateCanary);
  });
});

describe('snapshot analysis: concrete lower-only operation limits', () => {
  it('accepts the 16-snapshot ceiling and rejects one more before hashing', async () => {
    const a = await fixture();
    const atLimit = await analyze(Array.from({ length: 16 }, () => a));
    expect(atLimit.snapshots).toHaveLength(16);
    expect(atLimit.relations).toHaveLength(15);
    const spy = vi.fn(hash);
    await expect(
      analyzeSnapshots({ snapshots: Array.from({ length: 17 }, () => a), sha256: spy })
    ).rejects.toThrow(/limit-exceeded/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects every raised, fractional, negative and nonfinite limit', async () => {
    const a = await fixture();
    for (const [key, ceiling] of Object.entries(SNAPSHOT_ANALYSIS_HARD_LIMITS)) {
      await expect(analyze([a, a], { [key]: ceiling + 1 })).rejects.toThrow(/invalid-limits/);
    }
    for (const value of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])
      await expect(analyze([a, a], { maxSnapshots: value })).rejects.toThrow(/invalid-limits/);
  });

  it('enforces batch/file count, per-file and aggregate bytes before any hash', async () => {
    const a = await fixture();
    const bytes = a.files.reduce((total, value) => total + value.bytes.length, 0);
    const largest = Math.max(...a.files.map(value => value.bytes.length));
    await expect(
      analyze([a, a], {
        maxSnapshots: 2,
        maxFilesPerSnapshot: 3,
        maxTotalFiles: 6,
        maxFileBytes: largest,
        maxTotalBytes: bytes * 2,
      })
    ).resolves.toBeDefined();
    for (const limits of [
      { maxSnapshots: 1 },
      { maxFilesPerSnapshot: 2 },
      { maxTotalFiles: 5 },
      { maxFileBytes: largest - 1 },
      { maxTotalBytes: bytes * 2 - 1 },
    ]) {
      const spy = vi.fn(hash);
      await expect(analyzeSnapshots({ snapshots: [a, a], sha256: spy, limits })).rejects.toThrow(
        /limit-exceeded/
      );
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('enforces aggregate JSON value/string/work budgets at exact boundaries', async () => {
    const a = await fixture();
    const budget = { values: 0, stringCodeUnits: 0, work: 0 };
    for (let copy = 0; copy < 2; copy += 1)
      for (const value of a.files)
        parseSnapshotJson(value.bytes, { ...SNAPSHOT_ANALYSIS_HARD_LIMITS }, budget);
    const exact = {
      maxJsonValues: budget.values,
      maxJsonStringCodeUnits: budget.stringCodeUnits,
      maxJsonWork: budget.work,
    };
    await expect(analyze([a, a], exact)).resolves.toBeDefined();
    for (const key of Object.keys(exact) as Array<keyof typeof exact>)
      await expect(analyze([a, a], { ...exact, [key]: exact[key] - 1 })).rejects.toThrow(
        /limit-exceeded/
      );
  });

  it('enforces canonical node/block/asset/diagnostic preflights', async () => {
    const a = await fixture({ asset: true, warning: 'bounded warning' });
    const canonical = JSON.parse(decoder.decode(file(a, 'canonical/liska-thread-1.json').bytes));
    const exact = {
      maxCanonicalNodes: 2,
      maxCanonicalBlocks: canonical.graph.nodes.a.message.blocks.length,
      maxAssets: 1,
      maxDiagnostics: canonical.diagnostics.entries.length,
    };
    await expect(analyze([a, a], exact)).resolves.toBeDefined();
    for (const key of Object.keys(exact) as Array<keyof typeof exact>)
      if (exact[key] > 0)
        await expect(analyze([a, a], { ...exact, [key]: exact[key] - 1 })).rejects.toThrow(
          /limit-exceeded/
        );
  });

  it('applies canonical ceilings to replay output before certification', async () => {
    const source = await fixture();
    const canonical = JSON.parse(
      decoder.decode(file(source, 'canonical/liska-thread-1.json').bytes)
    );
    canonical.graph.nodes.a.message.blocks = [];
    const tampered = replace(source, 'canonical/liska-thread-1.json', jsonBytes(canonical));

    await expect(analyze([tampered, tampered], { maxCanonicalBlocks: 0 })).rejects.toThrow(
      /limit-exceeded/
    );
  });

  it('enforces projection, hash-call/hash-byte, relation and report budgets', async () => {
    const a = await fixture();
    const manifest = JSON.parse(decoder.decode(file(a, 'manifest.json').bytes));
    const canonical = JSON.parse(decoder.decode(file(a, 'canonical/liska-thread-1.json').bytes));
    const projections = [semanticProjection(canonical, manifest), graphProjection(canonical)].map(
      value => encoder.encode(stableJson(value) + '\n').length
    );
    const spy = vi.fn(hash);
    const plan = await analyzeSnapshots({ snapshots: [a, a], sha256: spy });
    const digestBytes = spy.mock.calls.reduce((total, [bytes]) => total + bytes.length, 0);
    const exact = {
      maxProjectionBytes: Math.max(...projections),
      maxTotalProjectionBytes: projections.reduce((total, value) => total + value, 0) * 2,
      maxHashCalls: spy.mock.calls.length,
      maxHashBytes: digestBytes,
      maxRelations: 1,
      maxReportBytes: encodeSnapshotAnalysisPlan(plan).length,
    };
    await expect(analyze([a, a], exact)).resolves.toEqual(plan);
    for (const key of Object.keys(exact) as Array<keyof typeof exact>)
      await expect(analyze([a, a], { ...exact, [key]: exact[key] - 1 })).rejects.toThrow(
        /limit-exceeded/
      );
  });
});

describe('snapshot analysis: privacy-preserving plan encoding', () => {
  it('does not commit opaque private slot names into the public inventory digest', async () => {
    const base = await fixture();
    const bytes = new Uint8Array();
    const first = {
      files: [...base.files, { relativePath: 'reading/private-one.md', bytes }],
    };
    const second = {
      files: [...base.files, { relativePath: 'reading/private-two.md', bytes }],
    };

    const plan = await analyze([first, second]);

    expect(plan.snapshots[0].inventorySha256).toBe(plan.snapshots[1].inventorySha256);
    expect(plan.relations).toEqual([]);
    const encoded = decoder.decode(encodeSnapshotAnalysisPlan(plan));
    expect(encoded).not.toContain('private-one');
    expect(encoded).not.toContain('private-two');
  });

  it('serializes only fixed fields, in fixed order with LF termination', async () => {
    const a = await fixture();
    const plan = await analyze([a, a]);
    const text = decoder.decode(encodeSnapshotAnalysisPlan(plan));
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(plan);
    for (const forbidden of [
      privateCanary,
      'capture-chatgpt-',
      'manifest.json',
      'conversation_id',
      'https://',
    ])
      expect(text).not.toContain(forbidden);
  });

  it('rejects forged fields/accessors/toJSON, mutation flags and unsafe relation claims', async () => {
    const a = await fixture();
    const plan = await analyze([a, a]);
    const getter = vi.fn(() => privateCanary);
    const accessor = Object.defineProperty({ ...plan }, 'snapshots', {
      get: getter,
      enumerable: true,
    });
    const toJSON = vi.fn(() => privateCanary);
    for (const candidate of [
      { ...plan, toJSON },
      accessor,
      { ...plan, mutationAuthorized: true },
      { ...plan, relations: [{ ...plan.relations[0], preserveBoth: false }] },
    ])
      expect(() => encodeSnapshotAnalysisPlan(candidate as typeof plan)).toThrow(
        SnapshotAnalysisError
      );
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });
});
