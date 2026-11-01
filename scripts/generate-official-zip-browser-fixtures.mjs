/** Opt-in, synthetic ZIP32 fixtures. No production ZIP implementation is imported. */
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import process from 'node:process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_FIXTURES = resolve(ROOT, 'test-results/official-zip-browser/fixtures');
export const CASE_IDS = Object.freeze([
  'legacy-deflate',
  'shards-manifest-deflate',
  'shards-no-manifest-deflate',
  'legacy-store',
  'malformed-truncated',
  'malformed-trailing-final',
  'malformed-trailing-boundary',
  'large-deflate',
]);
const MiB = 1024 * 1024;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function inside(root, target) {
  const path = relative(root, target);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/** Only isolated test-results descendants or caller-owned empty external directories. */
export function safeOutputDirectory(directory) {
  if (typeof directory !== 'string' || !directory.trim()) fail('invalid-output');
  const target = resolve(directory);
  const testRoot = resolve(ROOT, 'test-results');
  if (
    target === parse(target).root ||
    inside(target, ROOT) ||
    (inside(ROOT, target) && (!inside(testRoot, target) || target === testRoot))
  )
    fail('output-containment');
  for (let cursor = target; ; cursor = dirname(cursor)) {
    if (existsSync(cursor)) {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail('unsafe-output-path');
    }
    if (cursor === dirname(cursor)) break;
  }
  return target;
}

export function filesWithin(directory, prefix = '') {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) fail('symlink-output');
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const nested = filesWithin(resolve(directory, entry.name), path);
      if (!nested.length) fail('unexpected-empty-directory');
      files.push(...nested);
    } else if (entry.isFile()) files.push(path);
    else fail('unsafe-output-entry');
  }
  return files.sort();
}

// Independent bit-at-a-time IEEE CRC; deliberately not the production table implementation.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function noiseJson(length, seed = 0x5a17c9e3) {
  const result = Buffer.alloc(length);
  result.write('["');
  let state = seed;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (let i = 2; i < length - 2; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    result[i] = alphabet.charCodeAt(state & 63);
  }
  result.write('"]', length - 2);
  return result;
}

function zip32(specs) {
  const locals = [];
  const central = [];
  const payloadRanges = [];
  let offset = 0;
  for (const spec of specs) {
    const name = Buffer.from(spec.name, 'ascii');
    const method = spec.method ?? 8;
    const raw = method === 8 ? deflateRawSync(spec.plain, { level: spec.level ?? 6 }) : spec.plain;
    const packed = spec.mutate ? spec.mutate(raw) : raw;
    const crc = crc32(spec.plain);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    // Both records include malformed bytes: structural admission must reach the inflater.
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(spec.plain.length, 22);
    local.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(method, 10);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(packed.length, 20);
    record.writeUInt32LE(spec.plain.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    const start = offset + local.length + name.length;
    payloadRanges.push({ start, end: start + packed.length, method, deflateBytes: raw.length });
    locals.push(local, name, packed);
    central.push(record, name);
    offset = start + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(specs.length, 8);
  end.writeUInt16LE(specs.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return { bytes: Buffer.concat([...locals, directory, end]), payloadRanges };
}

function boundaryPlain() {
  // Level zero gives an independent exact raw-stream EOF at the adapter's 1 MiB boundary.
  let low = MiB - 200;
  let high = MiB;
  while (low <= high) {
    const length = Math.floor((low + high) / 2);
    const plain = noiseJson(length);
    const compressed = deflateRawSync(plain, { level: 0 }).length;
    if (compressed === MiB) return plain;
    if (compressed < MiB) low = length + 1;
    else high = length - 1;
  }
  fail('boundary-fixture-unavailable');
}

export function createFixtureSet() {
  const small = Buffer.from('[{"synthetic":1,"sample":"alpha"}]');
  const shardA = Buffer.from('[{"synthetic":2,"sample":"first"}]');
  const shardB = Buffer.from('[{"synthetic":9,"sample":"second"}]');
  const manifest = Buffer.from(
    JSON.stringify({
      version: 1,
      manifest_file: 'export_manifest.json',
      logical_files: {
        'conversations.json': {
          sharded: true,
          shard_count: 2,
          files: ['conversations-009.json', 'conversations-002.json'],
        },
      },
    })
  );
  const legacy = (plain = small, extra = {}) => [{ name: 'conversations.json', plain, ...extra }];
  const shards = [
    { name: 'conversations-009.json', plain: shardB },
    { name: 'conversations-002.json', plain: shardA },
  ];
  const definitions = [
    legacy(),
    [...shards, { name: 'export_manifest.json', plain: manifest }],
    shards,
    legacy(noiseJson(2 * MiB), { method: 0 }),
    legacy(small, { mutate: raw => raw.subarray(0, raw.length - 1) }),
    legacy(small, { mutate: raw => Buffer.concat([raw, Buffer.from([0x51, 0x72, 0x19])]) }),
    legacy(boundaryPlain(), {
      level: 0,
      mutate: raw => Buffer.concat([raw, Buffer.alloc(37, 0x51)]),
    }),
    legacy(noiseJson(16 * MiB, 0x13b7d829)),
  ];
  const files = new Map();
  const cases = definitions.map((specs, i) => {
    const id = CASE_IDS[i];
    const result = zip32(specs);
    files.set(`${id}.zip`, result.bytes);
    const outputs = specs
      .filter(spec => spec.name !== 'export_manifest.json')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((spec, ordinal) => ({
        ordinal,
        shardIndex: spec.name === 'conversations.json' ? -1 : Number(spec.name.slice(14, 17)),
        bytes: spec.plain.length,
        sha256: sha256(spec.plain),
      }));
    return {
      id,
      bytes: result.bytes.length,
      sha256: sha256(result.bytes),
      expectedFailure: id.startsWith('malformed-') ? 1 : 0,
      manifestStatus: i === 1 ? 'verified-name-set' : 'absent-unverified',
      selectedExpandedBytes: specs.reduce((n, spec) => n + spec.plain.length, 0),
      selectedCompressedBytes: result.payloadRanges.reduce(
        (n, range) => n + range.end - range.start,
        0
      ),
      outputs,
      payloadRanges: result.payloadRanges,
      rangeChecks: [
        [0, 0],
        [0, 16],
        [result.bytes.length - 16, result.bytes.length],
        [result.bytes.length, result.bytes.length],
      ].map(([start, end]) => ({ start, end, sha256: sha256(result.bytes.subarray(start, end)) })),
    };
  });
  const index = {
    schemaVersion: 1,
    maxReadBytes: MiB,
    maxArchiveBytes: 20 * MiB,
    heartbeatMaxGapMs: 250,
    abortMaxMs: 1000,
    pauseMs: 500,
    postAbortMs: 150,
    maxCaseMs: 30000,
    cases,
  };
  files.set('fixture-index.json', Buffer.from(`${JSON.stringify(index, null, 2)}\n`));
  return { files, index };
}

export function generateOfficialZipBrowserFixtures(directory = DEFAULT_FIXTURES) {
  const output = safeOutputDirectory(directory);
  const { files, index } = createFixtureSet();
  const existing = filesWithin(output);
  for (const file of existing) {
    if (!files.has(file) || !readFileSync(resolve(output, file)).equals(files.get(file)))
      fail('non-fixture-output');
  }
  mkdirSync(output, { recursive: true });
  for (const [file, bytes] of files) writeFileSync(resolve(output, file), bytes, { flag: 'w' });
  return {
    ok: true,
    cases: index.cases.map(({ id, bytes, sha256: hash }) => ({ id, bytes, sha256: hash })),
    indexSha256: sha256(files.get('fixture-index.json')),
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log(JSON.stringify(generateOfficialZipBrowserFixtures(process.argv[2])));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error.code ?? 'fixture-generation-failed' }));
    process.exitCode = 1;
  }
}
