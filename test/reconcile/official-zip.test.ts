// @vitest-environment node
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  OFFICIAL_ZIP_HARD_LIMITS,
  OfficialZipError,
  openOfficialExportZip,
  type OfficialZipInflater,
  type OfficialZipLimits,
  type OfficialZipSelection,
} from '../../src/reconcile/official-zip';
import { selectChatGptOfficialConversationSources } from '../../src/archive/importers/chatgpt-official';
import { prepareChatGptReconciliationDelivery } from '../../src/archive/reconciliation/chatgpt-delivery';
import archiveFixture from '../fixtures/archive/branching-chatgpt-thread.json';

const PRIVATE = 'PRIVATE_SENTINEL_DO_NOT_DISCLOSE';
const legacy = 'conversations.json';
const shard = (index: number) => `conversations-${String(index).padStart(3, '0')}.json`;
const json = (id = 'target') =>
  JSON.stringify([
    {
      id,
      title: PRIVATE,
      mapping: { root: { id: 'root', parent: null, children: [], message: null } },
      current_node: 'root',
    },
  ]);
const bytes = (text: string) => Buffer.from(text, 'utf8');

// Independent fixture producer, deliberately NOT the production ZIP writer or CRC.
function checksum(input: Uint8Array): number {
  let crc = -1;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ -1) >>> 0;
}

interface Spec {
  name: string;
  text?: string;
  method?: number;
  flags?: number;
  descriptor?: 'signed' | 'unsigned';
  descriptorLocal?: 'zero' | 'matching';
  compressed?: Uint8Array;
  expanded?: number;
  crc?: number;
  extra?: Buffer;
  localExtra?: Buffer;
  attributes?: number;
  version?: number;
}
interface Fixture {
  zip: Buffer;
  centralStart: number;
  eocd: number;
  records: { local: number; payload: number; end: number; central: number; descriptor: number }[];
}

function fixture(
  specs: Spec[],
  options: { centralOrder?: number[]; comment?: string; prefix?: string; gap?: string } = {}
): Fixture {
  const locals: Buffer[] = [bytes(options.prefix ?? '')];
  const central: Buffer[] = [];
  const records: Fixture['records'] = [];
  let offset = locals[0].length;
  specs.forEach(spec => {
    const name = bytes(spec.name);
    const plain = bytes(spec.text ?? json());
    const method = spec.method ?? 0;
    const compressed = Buffer.from(
      spec.compressed ?? (method === 8 ? deflateRawSync(plain) : plain)
    );
    const crc = spec.crc ?? checksum(plain);
    const expanded = spec.expanded ?? plain.length;
    const flags = spec.flags ?? (spec.descriptor ? 8 : 0);
    const localExtra = spec.localExtra ?? spec.extra ?? Buffer.alloc(0);
    const centralExtra = spec.extra ?? Buffer.alloc(0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(spec.version ?? 20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    if (!spec.descriptor || spec.descriptorLocal === 'matching') {
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(compressed.length, 18);
      local.writeUInt32LE(expanded, 22);
    }
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    const descriptor = Buffer.alloc(
      spec.descriptor === 'signed' ? 16 : spec.descriptor === 'unsigned' ? 12 : 0
    );
    if (descriptor.length) {
      const start = descriptor.length === 16 ? 4 : 0;
      if (start) descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(crc, start);
      descriptor.writeUInt32LE(compressed.length, start + 4);
      descriptor.writeUInt32LE(expanded, start + 8);
    }
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50);
    cd.writeUInt16LE(0x0314, 4);
    cd.writeUInt16LE(spec.version ?? 20, 6);
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(expanded, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(centralExtra.length, 30);
    cd.writeUInt32LE(spec.attributes ?? 0, 38);
    cd.writeUInt32LE(offset, 42);
    const payload = offset + local.length + name.length + localExtra.length;
    records.push({
      local: offset,
      payload,
      end: payload + compressed.length,
      descriptor: payload + compressed.length,
      central: -1,
    });
    locals.push(local, name, localExtra, compressed, descriptor, bytes(options.gap ?? ''));
    offset = payload + compressed.length + descriptor.length + bytes(options.gap ?? '').length;
    central.push(Buffer.concat([cd, name, centralExtra]));
  });
  const centralStart = offset;
  const ordered = (options.centralOrder ?? specs.map((_, i) => i)).map(index => {
    records[index].central = offset;
    offset += central[index].length;
    return central[index];
  });
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50);
  eocd.writeUInt16LE(specs.length, 8);
  eocd.writeUInt16LE(specs.length, 10);
  eocd.writeUInt32LE(offset - centralStart, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(bytes(options.comment ?? '').length, 20);
  return {
    zip: Buffer.concat([...locals, ...ordered, eocd, bytes(options.comment ?? '')]),
    centralStart,
    eocd: offset,
    records,
  };
}

function source(data: Uint8Array) {
  return {
    size: data.length,
    readRange: vi.fn(async (start: number, end: number, _signal: AbortSignal) =>
      data.slice(start, end)
    ),
  };
}
function open(
  data: Fixture | Uint8Array,
  options: {
    limits?: Partial<OfficialZipLimits>;
    signal?: AbortSignal;
    inflateRaw?: OfficialZipInflater;
  } = {}
) {
  return openOfficialExportZip({
    source: source('zip' in data ? data.zip : data),
    signal: options.signal ?? new AbortController().signal,
    ...options,
  });
}
async function collect(chunks: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  for await (const chunk of chunks) parts.push(chunk);
  return Buffer.concat(parts);
}
async function drain(result: OfficialZipSelection): Promise<Buffer[]> {
  if (result.officialChunks) return [await collect(result.officialChunks)];
  const output: Buffer[] = [];
  for (const item of result.officialSources) output.push(await collect(item.chunks));
  return output;
}
async function rejects(
  data: Fixture | Uint8Array,
  code?: string,
  options: Parameters<typeof open>[1] = {}
) {
  let error: unknown;
  try {
    await drain(await open(data, options));
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(OfficialZipError);
  const actual = error as OfficialZipError;
  if (code) expect(actual.code).toBe(code);
  expect(actual.message).toBe(`Official ZIP source failed (${actual.code}).`);
  expect(actual).not.toHaveProperty('cause');
  expect(`${actual.stack}${JSON.stringify(actual)}`).not.toContain(PRIVATE);
}
function manifest(indices: number[]) {
  return JSON.stringify({
    version: 1,
    manifest_file: 'export_manifest.json',
    logical_files: {
      'conversations.json': {
        sharded: true,
        shard_count: indices.length,
        files: indices.map(shard),
      },
    },
  });
}

function deliveryConversation(id = 'zip-delivery-target', rawOnly = false) {
  return {
    id,
    conversation_id: id,
    title: PRIVATE,
    current_node: 'assistant',
    create_time: 1_700_000_000,
    update_time: 1_700_000_100,
    mapping: {
      root: { id: 'root', parent: null, message: null },
      user: {
        id: 'user',
        parent: 'root',
        message: {
          id: 'user',
          author: { role: 'user', name: null },
          content: { content_type: 'text', parts: [PRIVATE] },
          create_time: 1_700_000_001,
        },
      },
      assistant: {
        id: 'assistant',
        // Missing parent is valid selection JSON but an intentional normalization refusal.
        ...(!rawOnly && { parent: 'user' }),
        message: {
          id: 'assistant',
          author: { role: 'assistant', name: null },
          content: { content_type: 'text', parts: ['Synthetic response'] },
          create_time: 1_700_000_002,
        },
      },
    },
  };
}

function deliveryBase() {
  const canonical = structuredClone(archiveFixture);
  canonical.conversation.id = 'zip-delivery-target';
  canonical.conversation.title = PRIVATE;
  return {
    webCanonicalBytes: new Uint8Array(bytes(JSON.stringify(canonical, null, 2))),
    captureId: 'capture-official-zip-composition',
    importedAt: '2026-10-30T00:00:00.000Z',
    sha256: async (value: Uint8Array) => createHash('sha256').update(value).digest('hex'),
  };
}

async function* explicitJson(text: string): AsyncGenerator<Uint8Array> {
  const value = bytes(text);
  for (let offset = 0; offset < value.length; offset += 37)
    yield new Uint8Array(value.subarray(offset, offset + 37));
}

function selectedDeliveryInput(selection: OfficialZipSelection) {
  // The adapter's bounded evidence belongs to its caller, not the unchanged
  // strict delivery request/provenance schema.
  return selection.officialChunks
    ? { officialChunks: selection.officialChunks }
    : { officialSources: selection.officialSources };
}

describe('official ZIP source: full delivery composition parity', () => {
  it.each(['legacy', 'shards-manifest', 'shards-no-manifest'] as const)(
    '%s produces byte-identical normalized and raw-only deliveries to explicit JSON',
    async layout => {
      for (const rawOnly of [false, true]) {
        const target = deliveryConversation('zip-delivery-target', rawOnly);
        const first = JSON.stringify([deliveryConversation('earlier-neighbor'), target], null, 2);
        const later = JSON.stringify([{}, deliveryConversation('later-neighbor')]);
        const legacyText = JSON.stringify(
          [
            deliveryConversation('earlier-neighbor'),
            target,
            deliveryConversation('later-neighbor'),
          ],
          null,
          2
        );
        const specs: Spec[] =
          layout === 'legacy'
            ? [{ name: legacy, text: legacyText, method: 8 }]
            : [
                { name: shard(9), text: later },
                { name: shard(2), text: first, method: 8 },
              ];
        if (layout === 'shards-manifest')
          specs.push({ name: 'export_manifest.json', text: manifest([2, 9]), method: 8 });
        const selection = await open(fixture(specs));
        const base = deliveryBase();
        const plain =
          layout === 'legacy'
            ? { officialChunks: explicitJson(legacyText) }
            : {
                officialSources: [
                  { shardIndex: 9, chunks: explicitJson(later) },
                  { shardIndex: 2, chunks: explicitJson(first) },
                ],
              };
        const expected = await prepareChatGptReconciliationDelivery({ ...base, ...plain });
        const actual = await prepareChatGptReconciliationDelivery({
          ...base,
          ...selectedDeliveryInput(selection),
        });
        expect(actual).toEqual(expected);
        expect(actual.status).toBe(rawOnly ? 'raw-only' : 'normalized');
        expect(actual.failureCode).toBe(rawOnly ? 'official-normalization-failed' : null);
        expect(actual.artifacts.map(item => item.relativePath)).toEqual(
          rawOnly
            ? ['official/conversation.json', 'official/manifest.json', 'manifest.json']
            : [
                'official/conversation.json',
                'official/manifest.json',
                'official/canonical/liska-thread-1.json',
                'comparison/liska-chatgpt-comparison-1.json',
                'manifest.json',
              ]
        );
        for (const [index, artifact] of actual.artifacts.entries()) {
          expect(artifact.bytes).toEqual(expected.artifacts[index].bytes);
          expect(artifact.sha256).toBe(await base.sha256(artifact.bytes));
        }
        const provenance = actual.manifest.official.provenance;
        expect(provenance.conversationIndex).toBe(1);
        if (layout === 'legacy') expect(provenance).not.toHaveProperty('shardIndex');
        else expect(provenance).toMatchObject({ shardIndex: 2, ignoredEmptyRecordCount: 1 });
        const selectedText = layout === 'legacy' ? legacyText : first;
        expect(actual.artifacts[0].bytes).toEqual(
          new Uint8Array(
            bytes(selectedText).subarray(provenance.byteStart, provenance.byteEndExclusive)
          )
        );
        const officialManifest = JSON.parse(
          Buffer.from(actual.artifacts[1].bytes).toString('utf8')
        );
        if (rawOnly)
          expect(officialManifest.completeness).toEqual({
            graph: 'unknown',
            messages: 'unknown',
            branches: 'unknown',
            assets: 'not-attempted',
          });
        if (layout !== 'legacy')
          expect(officialManifest.artifacts[0].source).toMatchObject({
            shardIndex: 2,
            ignoredEmptyRecordCount: 1,
          });
        if (!rawOnly) {
          const comparison = JSON.parse(Buffer.from(actual.artifacts[3].bytes).toString('utf8'));
          expect(comparison.official).toEqual(actual.manifest.official);
          expect(comparison.comparison.identity).toEqual({
            provider: 'chatgpt',
            conversationId: 'zip-delivery-target',
          });
        }
        expect(JSON.stringify(actual.manifest)).not.toContain('export_manifest.json');
        expect(JSON.stringify(actual.manifest)).not.toContain('manifestStatus');
      }
    }
  );

  it.each(['crc', 'cancel'] as const)(
    'later-shard %s failure produces neither delivery nor hashes after an earlier valid target',
    async mode => {
      const controller = new AbortController();
      const data = fixture([
        { name: shard(0), method: 8, text: JSON.stringify([deliveryConversation()]) },
        {
          name: shard(1),
          text: JSON.stringify([deliveryConversation('later')]),
          ...(mode === 'crc' && { crc: 0 }),
        },
      ]);
      const input = source(data.zip);
      let targetCompressedRead = 0;
      let laterRead = false;
      input.readRange.mockImplementation(async (start, end) => {
        const first = data.records[0];
        if (start >= first.payload && end <= first.end) targetCompressedRead += end - start;
        if (start === data.records[1].payload) {
          laterRead = true;
          expect(targetCompressedRead).toBe(first.end - first.payload);
          if (mode === 'cancel') controller.abort(PRIVATE);
        }
        return data.zip.slice(start, end);
      });
      const selection = await openOfficialExportZip({ source: input, signal: controller.signal });
      const base = deliveryBase();
      const sha256 = vi.fn(base.sha256);
      const delivered = vi.fn();
      const delivery = prepareChatGptReconciliationDelivery({
        ...base,
        ...selectedDeliveryInput(selection),
        sha256,
      });
      void delivery.then(delivered, () => {});
      await expect(delivery).rejects.toMatchObject({ code: 'official-import-failed' });
      expect(laterRead).toBe(true);
      expect(sha256).not.toHaveBeenCalled();
      expect(delivered).not.toHaveBeenCalled();
    }
  );
});

describe('official ZIP source: layouts and streaming', () => {
  it.each([0, 8])('streams exact legacy JSON bytes (method %s)', async method => {
    const result = await open(fixture([{ name: legacy, method }]));
    expect(result.officialSources).toBeUndefined();
    expect((await drain(result))[0]).toEqual(bytes(json()));
    expect(result.evidence).toEqual({
      entryCount: 1,
      selectedSourceCount: 1,
      selectedCompressedBytes:
        method === 8 ? deflateRawSync(bytes(json())).length : bytes(json()).length,
      selectedExpandedBytes: bytes(json()).length,
      manifestStatus: 'absent-unverified',
    });
  });

  it('admits modern manifest-backed shards, sorts indices, retains no unrelated names', async () => {
    const data = fixture(
      [
        { name: shard(5), method: 8, text: json('five') },
        { name: PRIVATE + '.png', text: PRIVATE },
        { name: 'export_manifest.json', method: 8, text: manifest([0, 5]) },
        { name: shard(0), text: json('zero') },
      ],
      { centralOrder: [1, 3, 2, 0] }
    );
    const input = source(data.zip);
    const unrelated = data.records[1];
    input.readRange.mockImplementation(async (start, end) => {
      expect(end <= unrelated.payload || start >= unrelated.end).toBe(true);
      return data.zip.slice(start, end);
    });
    const result = await openOfficialExportZip({
      source: input,
      signal: new AbortController().signal,
    });
    expect(result.officialSources?.map(item => item.shardIndex)).toEqual([0, 5]);
    expect(result.evidence.manifestStatus).toBe('verified-name-set');
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
    expect(Object.keys(result).sort()).toEqual(['evidence', 'officialSources']);
    expect(await drain(result)).toEqual([bytes(json('zero')), bytes(json('five'))]);
  });

  it('admits older shards without inventing a verified declaration', async () => {
    const result = await open(fixture([{ name: shard(12) }, { name: shard(1) }]));
    expect(result.evidence.manifestStatus).toBe('absent-unverified');
    expect(result.officialSources?.map(item => item.shardIndex)).toEqual([1, 12]);
    expect(await drain(result)).toEqual([bytes(json()), bytes(json())]);
  });

  it.each(['signed', 'unsigned'] as const)(
    'accepts exact %s descriptors in both local modes and methods',
    async descriptor => {
      for (const descriptorLocal of ['zero', 'matching'] as const)
        for (const method of [0, 8]) {
          const result = await open(
            fixture([{ name: legacy, method, descriptor, descriptorLocal }])
          );
          expect(await drain(result)).toEqual([bytes(json())]);
        }
    }
  );

  it('uses descriptor extent, not CRC signature bytes, to identify an unsigned descriptor', async () => {
    const data = fixture([{ name: legacy, descriptor: 'unsigned', crc: 0x08074b50 }]);
    const result = await open(data);
    // Structural admission succeeds. The deliberately fake CRC then fails at EOF.
    await expect(drain(result)).rejects.toMatchObject({ code: 'integrity-failed' });
  });

  it('accepts framed benign extras, UTF8, DEFLATE hints and empty directory records', async () => {
    const extra = Buffer.from([0x55, 0x54, 1, 0, 0]);
    expect(
      await drain(
        await open(
          fixture([
            { name: 'media/', text: '', attributes: 0x41ed0010 },
            { name: legacy, method: 8, flags: 0x806, extra },
          ])
        )
      )
    ).toEqual([bytes(json())]);
  });

  it('never decompresses an unrelated corrupt compressed payload', async () => {
    const data = fixture([
      { name: PRIVATE, method: 8, compressed: bytes('not deflate') },
      { name: legacy },
    ]);
    const inflate = vi.fn(() => {
      throw new Error(PRIVATE);
    });
    expect(await drain(await open(data, { inflateRaw: inflate }))).toEqual([bytes(json())]);
    expect(inflate).not.toHaveBeenCalled();
  });

  it('STORE payload reads are bounded and pull-driven; all metadata reads are bounded', async () => {
    const data = fixture([{ name: legacy, text: '12345678901234567890' }]);
    const input = source(data.zip);
    const result = await openOfficialExportZip({
      source: input,
      signal: new AbortController().signal,
      limits: { maxChunkBytes: 7 },
    });
    const metadataCalls = input.readRange.mock.calls.length;
    expect(input.readRange.mock.calls.every(([start, end]) => end - start <= 7)).toBe(true);
    const iterator = result.officialChunks![Symbol.asyncIterator]();
    expect((await iterator.next()).value?.length).toBe(7);
    expect(input.readRange.mock.calls.length).toBe(metadataCalls + 1);
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(input.readRange.mock.calls.length).toBe(metadataCalls + 1);
    await iterator.return?.();
  });

  it('native DEFLATE chunks and compressed range reads obey the lowered bound', async () => {
    const data = fixture([{ name: legacy, method: 8, text: json().repeat(4) }]);
    const input = source(data.zip);
    const result = await openOfficialExportZip({
      source: input,
      signal: new AbortController().signal,
      limits: { maxChunkBytes: 17 },
    });
    const output: Uint8Array[] = [];
    for await (const chunk of result.officialChunks!) {
      expect(chunk.length).toBeLessThanOrEqual(17);
      output.push(chunk);
    }
    expect(Buffer.concat(output)).toEqual(bytes(json().repeat(4)));
    expect(input.readRange.mock.calls.every(([a, b]) => b - a <= 17)).toBe(true);
  });

  it('later-source CRC corruption remains fatal after an earlier exact target match', async () => {
    const result = await open(
      fixture([
        { name: shard(0), text: json() },
        { name: shard(1), text: json('later'), crc: 0 },
      ])
    );
    await expect(
      selectChatGptOfficialConversationSources({
        sources: result.officialSources!,
        conversationId: 'target',
      })
    ).rejects.toMatchObject({ code: 'source-read-failed' });
  });
});

describe('official ZIP source: structure rejection', () => {
  it.each([
    ['empty', () => Buffer.alloc(0)],
    ['truncated EOCD', () => fixture([{ name: legacy }]).zip.subarray(0, -1)],
    ['trailing bytes', () => Buffer.concat([fixture([{ name: legacy }]).zip, bytes('x')])],
    ['prefix', () => fixture([{ name: legacy }], { prefix: 'prefix' }).zip],
    ['gap', () => fixture([{ name: legacy }], { gap: 'gap' }).zip],
    ['comment', () => fixture([{ name: legacy }], { comment: PRIVATE }).zip],
    [
      'fake EOCD in comment',
      () => {
        const data = fixture([{ name: legacy }]);
        data.zip.writeUInt16LE(22, data.eocd + 20);
        return Buffer.concat([data.zip, data.zip.subarray(data.eocd)]);
      },
    ],
    [
      'ZIP64 locator',
      () => {
        const data = fixture([{ name: legacy }]);
        const locator = Buffer.alloc(20);
        locator.writeUInt32LE(0x07064b50);
        return Buffer.concat([
          data.zip.subarray(0, data.eocd),
          locator,
          data.zip.subarray(data.eocd),
        ]);
      },
    ],
  ] as const)('rejects %s', async (_name, make) => {
    await rejects(make());
  });

  it('does not mistake EOCD signature bytes in payload for structural records', async () => {
    const text = 'prefixPK\x05\x06suffix';
    expect(await drain(await open(fixture([{ name: legacy, text }])))).toEqual([bytes(text)]);
  });

  it.each([
    ['EOCD disk', 'eocd', 4, 2, 1],
    ['EOCD central disk', 'eocd', 6, 2, 1],
    ['EOCD per-disk count', 'eocd', 8, 2, 2],
    ['EOCD count', 'eocd', 10, 2, 2],
    ['EOCD ZIP64 count', 'eocd', 10, 2, 65535],
    ['EOCD ZIP64 size', 'eocd', 12, 4, 0xffffffff],
    ['EOCD ZIP64 offset', 'eocd', 16, 4, 0xffffffff],
    ['EOCD central size', 'eocd', 12, 4, 1],
    ['EOCD central offset', 'eocd', 16, 4, 0],
    ['EOCD nonzero comment', 'eocd', 20, 2, 1],
    ['central signature', 'central', 0, 4, 0],
    ['central entry disk', 'central', 34, 2, 1],
    ['central ZIP64 compressed', 'central', 20, 4, 0xffffffff],
    ['central ZIP64 expanded', 'central', 24, 4, 0xffffffff],
    ['central ZIP64 offset', 'central', 42, 4, 0xffffffff],
    ['central offset', 'central', 42, 4, 1],
    ['central filename length', 'central', 28, 2, 65535],
    ['central comment length', 'central', 32, 2, 65535],
    ['local signature', 'local', 0, 4, 0],
    ['local version', 'local', 4, 2, 19],
    ['local method', 'local', 8, 2, 8],
    ['local flags', 'local', 6, 2, 8],
    ['local CRC', 'local', 14, 4, 0],
    ['local compressed size', 'local', 18, 4, 0],
    ['local expanded size', 'local', 22, 4, 0],
    ['local name length', 'local', 26, 2, 1],
    ['local extra length', 'local', 28, 2, 65535],
  ] as const)('rejects %s disagreement/sentinel', async (_name, kind, relative, width, value) => {
    const data = fixture([{ name: legacy }]);
    const start = kind === 'eocd' ? data.eocd : data.records[0][kind];
    if (width === 2) data.zip.writeUInt16LE(value, start + relative);
    else data.zip.writeUInt32LE(value, start + relative);
    await rejects(data);
  });

  it('rejects a mismatching local name and an overlapping local offset', async () => {
    const name = fixture([{ name: legacy }]);
    name.zip[name.records[0].local + 30] = 120;
    await rejects(name, 'invalid-zip');
    const overlap = fixture([{ name: shard(0) }, { name: shard(1) }]);
    overlap.zip.writeUInt32LE(0, overlap.records[1].central + 42);
    await rejects(overlap, 'invalid-zip');
  });

  it.each([1, 16, 32, 64, 256, 4096, 8192, 16384, 32768, 2, 4])(
    'rejects unsupported STORE flag %s',
    async flags => {
      await rejects(fixture([{ name: legacy, flags }]), 'unsupported-zip');
    }
  );
  it.each([1, 9, 12, 99])('rejects compression method %s', async method => {
    await rejects(fixture([{ name: legacy, method }]), 'unsupported-zip');
  });
  it.each([21, 45, 63])('rejects required ZIP version %s', async version => {
    await rejects(fixture([{ name: legacy, version }]), 'unsupported-zip');
  });
  it.each([0xa1ff0000, 0x21ff0000, 0x61ff0000, 0x11ff0000, 0xc1ff0000, 8])(
    'rejects special attributes %s',
    async attributes => {
      await rejects(fixture([{ name: legacy, attributes }]), 'unsupported-zip');
    }
  );
  it.each([
    Buffer.from([1, 0, 0, 0]),
    Buffer.from([0x75, 0x70, 0, 0]),
    Buffer.from([0x55]),
    Buffer.from([0x55, 0x54, 2, 0, 0]),
    Buffer.from([0x55, 0x54, 0, 0, 0x55, 0x54, 0, 0]),
  ])('rejects forbidden or malformed extra fields %s', async extra => {
    await rejects(fixture([{ name: legacy, extra }]));
    await rejects(fixture([{ name: legacy, localExtra: extra }]));
  });

  it.each(['signed', 'unsigned'] as const)(
    'rejects mismatching %s descriptor and hybrid local fields',
    async descriptor => {
      const data = fixture([{ name: legacy, descriptor }]);
      data.zip[data.records[0].descriptor + (descriptor === 'signed' ? 4 : 0)] ^= 1;
      await rejects(data, 'invalid-zip');
      const hybrid = fixture([{ name: legacy, descriptor }]);
      hybrid.zip.writeUInt32LE(checksum(bytes(json())), 14);
      await rejects(hybrid, 'invalid-zip');
    }
  );
});

describe('official ZIP source: selection and payload rejection', () => {
  it.each([
    '../secret',
    '/absolute',
    'C:/drive',
    'a\\b',
    'a\0b',
    'a\nb',
    'a\x7fb',
    'a/../b',
    'a/./b',
    './a',
    'a//b',
    'a:stream',
  ])('rejects unsafe unrelated name %j', async name => {
    await rejects(fixture([{ name }, { name: legacy }]), 'unsafe-name');
  });
  it.each(
    [
      ['Conversations.json'],
      ['CONVERSATIONS-000.JSON'],
      ['EXPORT_MANIFEST.JSON'],
      ['conversations-00.json'],
      [legacy, shard(0)],
      [legacy, 'export_manifest.json'],
      ['export_manifest.json'],
      ['wrapper/conversations.json'],
      [PRIVATE],
    ].map(names => [names])
  )('rejects unsupported/mixed layout %j', async names => {
    await rejects(fixture(names.map(name => ({ name }))), 'invalid-layout');
  });
  it.each([legacy, shard(0), PRIVATE])('rejects exact duplicate %s globally', async name => {
    await rejects(fixture([{ name }, { name }]), 'duplicate-name');
  });
  it.each([manifest([0, 1]), manifest([1]), '{}', '{"version":1,"version":1}'])(
    'rejects invalid manifest or non-exact declaration',
    async text => {
      await rejects(
        fixture([{ name: shard(0) }, { name: 'export_manifest.json', text }]),
        'manifest-invalid'
      );
    }
  );
  it('rejects manifest CRC before admission', async () => {
    await rejects(
      fixture([{ name: shard(0) }, { name: 'export_manifest.json', text: manifest([0]), crc: 0 }]),
      'integrity-failed'
    );
  });

  it.each(['corrupt', 'truncated', 'trailing'] as const)(
    'native raw DEFLATE rejects %s input',
    async mode => {
      const raw = deflateRawSync(bytes(json()));
      const compressed =
        mode === 'corrupt'
          ? bytes('bad deflate')
          : mode === 'truncated'
            ? raw.subarray(0, -1)
            : Buffer.concat([raw, bytes(PRIVATE)]);
      await rejects(fixture([{ name: legacy, method: 8, compressed }]), 'inflate-failed');
    }
  );
  it.each([-1, 1])('rejects observed expanded size mismatch %s', async delta => {
    await rejects(
      fixture([{ name: legacy, method: 8, expanded: bytes(json()).length + delta }]),
      'integrity-failed'
    );
  });
  it.each([0, 8])('rejects CRC mismatch at EOF for method %s', async method => {
    const result = await open(fixture([{ name: legacy, method, crc: 0 }]));
    const iterator = result.officialChunks![Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    await expect(iterator.next()).rejects.toMatchObject({ code: 'integrity-failed' });
  });
});

describe('official ZIP source: bounded resources', () => {
  it('keeps production caps tied to existing admission contracts', () => {
    expect(OFFICIAL_ZIP_HARD_LIMITS).toEqual({
      maxArchiveBytes: 0xffffffff,
      maxEntries: 50_000,
      maxCentralDirectoryBytes: 32 * 1024 ** 2,
      maxFilenameBytes: 1024,
      maxMetadataBytes: 64 * 1024 ** 2,
      maxSelectedCompressedBytes: 2 * 1024 ** 3 + 2 * 1024 ** 2,
      maxSelectedExpandedBytes: 2 * 1024 ** 3 + 2 * 1024 ** 2,
      maxConversationSourceBytes: 2 * 1024 ** 3,
      maxManifestBytes: 2 * 1024 ** 2,
      maxCompressionRatio: 200,
      maxChunkBytes: 1024 ** 2,
    });
  });
  it('accepts exact bounds and rejects one byte/entry beyond each aggregate bound', async () => {
    const data = fixture([
      { name: shard(0) },
      { name: 'export_manifest.json', text: manifest([0]) },
    ]);
    const selected = bytes(json()).length + bytes(manifest([0])).length;
    const centralSize = data.eocd - data.centralStart;
    const metadataSize =
      22 + centralSize + data.records.reduce((n, r) => n + r.payload - r.local, 0);
    const exact: Partial<OfficialZipLimits> = {
      maxArchiveBytes: data.zip.length,
      maxEntries: 2,
      maxCentralDirectoryBytes: centralSize,
      maxMetadataBytes: metadataSize,
      maxSelectedCompressedBytes: selected,
      maxSelectedExpandedBytes: selected,
      maxConversationSourceBytes: bytes(json()).length,
      maxManifestBytes: bytes(manifest([0])).length,
      maxFilenameBytes: Math.max(shard(0).length, 'export_manifest.json'.length),
      maxCompressionRatio: 1,
    };
    await drain(await open(data, { limits: exact }));
    for (const [key, value] of Object.entries(exact)) {
      if (key === 'maxCompressionRatio') continue;
      await rejects(data, 'resource-limit', { limits: { [key]: value - 1 } });
    }
  });
  it('accepts exact ratio and rejects the next expanded byte', async () => {
    // Declared sizes suffice for pre-inflate budget admission; fake trusted inflater
    // yields fixture bytes and consumes all input, avoiding reliance on zlib ratios.
    const text = 'a'.repeat(200);
    const inflater: OfficialZipInflater = async function* (input) {
      for await (const _chunk of input) {
        /* consumed */
      }
      yield bytes(text);
    };
    expect(
      await drain(
        await open(fixture([{ name: legacy, text, method: 8, compressed: bytes('x') }]), {
          inflateRaw: inflater,
        })
      )
    ).toEqual([bytes(text)]);
    await rejects(
      fixture([{ name: legacy, text: text + 'a', method: 8, compressed: bytes('x') }]),
      'resource-limit'
    );
    await rejects(
      fixture([{ name: legacy, text, method: 8, compressed: bytes('x') }]),
      'resource-limit',
      { limits: { maxCompressionRatio: 199 } }
    );
  });
  it.each(Object.keys(OFFICIAL_ZIP_HARD_LIMITS) as (keyof OfficialZipLimits)[])(
    'does not permit raising %s',
    async key => {
      await rejects(fixture([{ name: legacy }]), 'invalid-limits', {
        limits: { [key]: OFFICIAL_ZIP_HARD_LIMITS[key] + 1 },
      });
    }
  );
  it.each([NaN, Infinity, -1, 1.5])('rejects malformed limits %s', async maxEntries => {
    await rejects(fixture([{ name: legacy }]), 'invalid-limits', { limits: { maxEntries } });
  });
  it('requires a positive chunk limit and rejects oversized inflater chunks', async () => {
    await rejects(fixture([{ name: legacy }]), 'invalid-limits', { limits: { maxChunkBytes: 0 } });
    const inflater: OfficialZipInflater = async function* () {
      yield bytes(PRIVATE);
    };
    await rejects(fixture([{ name: legacy, method: 8 }]), 'inflate-failed', {
      limits: { maxChunkBytes: 3 },
      inflateRaw: inflater,
    });
  });
});

describe('official ZIP source: cancellation, failure and privacy', () => {
  it('rejects pre-abort without any reads', async () => {
    const controller = new AbortController();
    controller.abort(PRIVATE);
    const input = source(fixture([{ name: legacy }]).zip);
    await expect(
      openOfficialExportZip({ source: input, signal: controller.signal })
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(input.readRange).not.toHaveBeenCalled();
  });
  it('aborts during pending metadata read even if source ignores the signal', async () => {
    const controller = new AbortController();
    const pending = new Promise<Uint8Array>(() => {});
    const opening = openOfficialExportZip({
      source: { size: 22, readRange: () => pending },
      signal: controller.signal,
    });
    controller.abort(PRIVATE);
    await expect(opening).rejects.toMatchObject({ code: 'aborted' });
  });
  it.each([0, 8])(
    'aborts during compressed read for method %s and passes cancellation to the source',
    async method => {
      const data = fixture([{ name: legacy, method }]);
      const controller = new AbortController();
      const input = source(data.zip);
      let payloadSignal: AbortSignal | undefined;
      input.readRange.mockImplementation(async (start, end, signal) => {
        if (start === data.records[0].payload) {
          payloadSignal = signal;
          controller.abort(PRIVATE);
        }
        return data.zip.slice(start, end);
      });
      const result = await openOfficialExportZip({ source: input, signal: controller.signal });
      await expect(drain(result)).rejects.toMatchObject({ code: 'aborted' });
      expect(payloadSignal?.aborted).toBe(true);
    }
  );
  it('aborts an uncooperative pending inflater and invokes return', async () => {
    const controller = new AbortController();
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    const inflate: OfficialZipInflater = () => ({
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: close }),
    });
    const result = await open(fixture([{ name: legacy, method: 8 }]), {
      signal: controller.signal,
      inflateRaw: inflate,
    });
    const collecting = drain(result);
    controller.abort(PRIVATE);
    await expect(collecting).rejects.toMatchObject({ code: 'aborted' });
    expect(close).toHaveBeenCalledOnce();
  });
  it('abort between sources prevents reading the later payload', async () => {
    const controller = new AbortController();
    const data = fixture([{ name: shard(0) }, { name: shard(1) }]);
    const input = source(data.zip);
    const result = await openOfficialExportZip({ source: input, signal: controller.signal });
    await collect(result.officialSources![0].chunks);
    const calls = input.readRange.mock.calls.length;
    controller.abort(PRIVATE);
    await expect(collect(result.officialSources![1].chunks)).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(input.readRange).toHaveBeenCalledTimes(calls);
  });
  it('early return poisons subsequent sources and closes the inflater', async () => {
    const closed = vi.fn();
    const inflate: OfficialZipInflater = async function* (input) {
      try {
        for await (const _part of input) {
          /* drain */
        }
        yield bytes(json());
      } finally {
        closed();
      }
    };
    const result = await open(fixture([{ name: shard(0), method: 8 }, { name: shard(1) }]), {
      inflateRaw: inflate,
    });
    const iterator = result.officialSources![0].chunks[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    expect(closed).toHaveBeenCalledOnce();
    await expect(collect(result.officialSources![1].chunks)).rejects.toMatchObject({
      code: 'stream-unavailable',
    });
  });

  it('rejects a second-shard-first attempt without payload reads and poisons earlier sources', async () => {
    const input = source(fixture([{ name: shard(2) }, { name: shard(9) }]).zip);
    const result = await openOfficialExportZip({
      source: input,
      signal: new AbortController().signal,
    });
    const metadataCalls = input.readRange.mock.calls.length;
    await expect(collect(result.officialSources![1].chunks)).rejects.toMatchObject({
      code: 'stream-unavailable',
    });
    await expect(collect(result.officialSources![0].chunks)).rejects.toMatchObject({
      code: 'stream-unavailable',
    });
    expect(input.readRange).toHaveBeenCalledTimes(metadataCalls);
  });

  it('detects pre-start return when a later source tries to skip its unfinished ordinal', async () => {
    const input = source(fixture([{ name: shard(2) }, { name: shard(9) }]).zip);
    const result = await openOfficialExportZip({
      source: input,
      signal: new AbortController().signal,
    });
    const metadataCalls = input.readRange.mock.calls.length;
    const first = result.officialSources![0].chunks[Symbol.asyncIterator]();
    expect(await first.return?.()).toEqual({ done: true, value: undefined });
    expect(await first.next()).toEqual({ done: true, value: undefined });
    await expect(collect(result.officialSources![1].chunks)).rejects.toMatchObject({
      code: 'stream-unavailable',
    });
    expect(input.readRange).toHaveBeenCalledTimes(metadataCalls);
  });

  it('rejects skipping the middle source after an earlier verified EOF', async () => {
    const input = source(fixture([{ name: shard(1) }, { name: shard(5) }, { name: shard(9) }]).zip);
    const result = await openOfficialExportZip({
      source: input,
      signal: new AbortController().signal,
    });
    await collect(result.officialSources![0].chunks);
    const calls = input.readRange.mock.calls.length;
    await expect(collect(result.officialSources![2].chunks)).rejects.toMatchObject({
      code: 'stream-unavailable',
    });
    await expect(collect(result.officialSources![1].chunks)).rejects.toMatchObject({
      code: 'stream-unavailable',
    });
    expect(input.readRange).toHaveBeenCalledTimes(calls);
  });

  it('advances exactly once at each verified EOF, independently of eager manifest verification', async () => {
    const result = await open(
      fixture([
        { name: shard(9), text: json('nine') },
        { name: 'export_manifest.json', text: manifest([2, 6, 9]), method: 8 },
        { name: shard(6), text: json('six'), method: 8 },
        { name: shard(2), text: json('two'), method: 8 },
      ])
    );
    expect(result.evidence.manifestStatus).toBe('verified-name-set');
    expect(result.officialSources!.map(item => item.shardIndex)).toEqual([2, 6, 9]);
    for (const [index, id] of ['two', 'six', 'nine'].entries()) {
      const chunks = result.officialSources![index].chunks;
      expect(await collect(chunks)).toEqual(bytes(json(id)));
      expect(await chunks[Symbol.asyncIterator]().next()).toEqual({ done: true, value: undefined });
    }
  });

  it('concurrent consumers poison the selection and cancel the active producer', async () => {
    const result = await open(fixture([{ name: shard(0) }, { name: shard(1) }]));
    const first = result.officialSources![0].chunks[Symbol.asyncIterator]();
    expect((await first.next()).done).toBe(false);
    await expect(collect(result.officialSources![1].chunks)).rejects.toMatchObject({
      code: 'stream-unavailable',
    });
    await expect(first.next()).rejects.toMatchObject({ code: 'aborted' });
  });

  it('feature-detects unavailable native raw DEFLATE without exposing native text', async () => {
    const native = globalThis.DecompressionStream;
    vi.stubGlobal(
      'DecompressionStream',
      class {
        constructor() {
          throw new Error(PRIVATE);
        }
      }
    );
    try {
      await rejects(fixture([{ name: legacy, method: 8 }]), 'inflater-unavailable');
    } finally {
      vi.stubGlobal('DecompressionStream', native);
    }
  });

  it('rejects prototype-named limit overrides instead of treating them as numeric limits', async () => {
    await rejects(fixture([{ name: legacy }]), 'invalid-limits', {
      limits: { toString: 1 } as never,
    });
  });
  it('owns yielded bytes even when an inflater reuses Buffer and subarray backing storage', async () => {
    const text = 'firstLAST!';
    const scratch = Buffer.alloc(5);
    const inflateRaw: OfficialZipInflater = async function* (input) {
      for await (const _part of input) {
        /* exact compressed input is consumed */
      }
      scratch.set(bytes('first'));
      yield scratch.subarray(0, 5);
      scratch.set(bytes('LAST!'));
      yield scratch;
      scratch.fill(0);
    };
    const result = await open(fixture([{ name: legacy, method: 8, text }]), { inflateRaw });
    const iterator = result.officialChunks![Symbol.asyncIterator]();
    const first = (await iterator.next()).value!;
    expect(Buffer.from(first).toString('utf8')).toBe('first');
    const second = (await iterator.next()).value!;
    expect(Buffer.from(first).toString('utf8')).toBe('first');
    expect(Buffer.from(second).toString('utf8')).toBe('LAST!');
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(scratch).toEqual(Buffer.alloc(5));
    expect(Buffer.concat([first, second])).toEqual(bytes(text));
    expect(first.buffer).not.toBe(scratch.buffer);
    expect(second.buffer).not.toBe(scratch.buffer);
  });

  it('rejects inflater completion without consuming compressed EOF', async () => {
    const inflate: OfficialZipInflater = async function* () {
      yield bytes(json());
    };
    await rejects(fixture([{ name: legacy, method: 8 }]), 'integrity-failed', {
      inflateRaw: inflate,
    });
  });
  it('sanitizes native/forged metadata, inflater and manifest failures', async () => {
    for (const thrown of [new Error(PRIVATE), new OfficialZipError(PRIVATE as never), PRIVATE]) {
      await expect(
        openOfficialExportZip({
          source: {
            size: 22,
            readRange: async () => {
              throw thrown;
            },
          },
          signal: new AbortController().signal,
        })
      ).rejects.toMatchObject({
        code: 'source-read-failed',
        message: 'Official ZIP source failed (source-read-failed).',
      });
      await rejects(fixture([{ name: legacy, method: 8 }]), 'inflate-failed', {
        inflateRaw: () => {
          throw thrown;
        },
      });
    }
  });
  it('rejects malformed read results, source sizes and source getters opaquely', async () => {
    for (const size of [NaN, -1, 1.2, Infinity]) {
      await expect(
        openOfficialExportZip({
          source: { size, readRange: vi.fn() },
          signal: new AbortController().signal,
        })
      ).rejects.toMatchObject({ code: 'invalid-input' });
    }
    await expect(
      openOfficialExportZip({
        source: { size: 22, readRange: async () => new Uint8Array(21) },
        signal: new AbortController().signal,
      })
    ).rejects.toMatchObject({ code: 'source-read-failed' });
    await expect(
      openOfficialExportZip({
        source: {
          get size(): number {
            throw new Error(PRIVATE);
          },
          readRange: vi.fn(),
        },
        signal: new AbortController().signal,
      })
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });
});
