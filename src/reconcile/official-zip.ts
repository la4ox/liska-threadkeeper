import {
  CHATGPT_OFFICIAL_HARD_LIMITS,
  type ChatGptOfficialConversationSource,
} from '../archive/importers/chatgpt-official/contracts';
import { admitOfficialManifest, OFFICIAL_MANIFEST_LIMITS } from './official-manifest';

const MiB = 1024 * 1024;
const SELECTED_BYTES =
  CHATGPT_OFFICIAL_HARD_LIMITS.maxSourceBytes + OFFICIAL_MANIFEST_LIMITS.maxBytes;

/** All overrides are lower-only; these are resource bounds, not completeness claims. */
export const OFFICIAL_ZIP_HARD_LIMITS = Object.freeze({
  maxArchiveBytes: 0xffffffff,
  maxEntries: 50_000,
  maxCentralDirectoryBytes: 32 * MiB,
  maxFilenameBytes: 1024,
  maxMetadataBytes: 64 * MiB,
  maxSelectedCompressedBytes: SELECTED_BYTES,
  maxSelectedExpandedBytes: SELECTED_BYTES,
  maxConversationSourceBytes: CHATGPT_OFFICIAL_HARD_LIMITS.maxSourceBytes,
  maxManifestBytes: OFFICIAL_MANIFEST_LIMITS.maxBytes,
  maxCompressionRatio: 200,
  maxChunkBytes: MiB,
});

export type OfficialZipLimits = { -readonly [K in keyof typeof OFFICIAL_ZIP_HARD_LIMITS]: number };

/** Anonymous, immutable random-access bytes. End is exclusive. No filename is accepted. */
export interface OfficialZipSource {
  readonly size: number;
  readRange(start: number, end: number, signal: AbortSignal): Promise<Uint8Array>;
}

/** Trusted streaming dependency: must reject truncated/trailing raw DEFLATE, consume
 * the input to EOF, honor cancellation and bound each returned chunk to maxChunkBytes.
 * Native DecompressionStream('deflate-raw') is used when this is omitted. */
export type OfficialZipInflater = (
  chunks: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
  maxChunkBytes: number
) => AsyncIterable<Uint8Array>;

export type OfficialZipErrorCode =
  | 'invalid-input'
  | 'invalid-limits'
  | 'aborted'
  | 'source-read-failed'
  | 'invalid-zip'
  | 'unsupported-zip'
  | 'unsafe-name'
  | 'duplicate-name'
  | 'invalid-layout'
  | 'resource-limit'
  | 'manifest-invalid'
  | 'inflater-unavailable'
  | 'inflate-failed'
  | 'integrity-failed'
  | 'stream-unavailable';

export class OfficialZipError extends Error {
  constructor(readonly code: OfficialZipErrorCode) {
    super(`Official ZIP source failed (${code}).`);
    this.name = 'OfficialZipError';
  }
}

// An injected dependency cannot smuggle a native message or a forged code through catch.
const internalErrors = new WeakSet<Error>();
function fail(code: OfficialZipErrorCode): never {
  const error = new OfficialZipError(code);
  internalErrors.add(error);
  throw error;
}

function sanitized(error: unknown, fallback: OfficialZipErrorCode): never {
  if (typeof error === 'object' && error !== null && internalErrors.has(error as Error))
    throw error;
  fail(fallback);
}

export interface OfficialZipEvidence {
  readonly entryCount: number;
  readonly selectedSourceCount: number;
  readonly selectedCompressedBytes: number;
  readonly selectedExpandedBytes: number;
  readonly manifestStatus: 'verified-name-set' | 'absent-unverified';
}

export type OfficialZipSelection = { readonly evidence: OfficialZipEvidence } & (
  | { officialChunks: AsyncIterable<Uint8Array>; officialSources?: never }
  | { officialChunks?: never; officialSources: ChatGptOfficialConversationSource[] }
);

interface Entry {
  name: string;
  version: number;
  flags: number;
  method: number;
  crc: number;
  compressed: number;
  expanded: number;
  offset: number;
  dataStart: number;
}

interface Context {
  size: number;
  readRange: OfficialZipSource['readRange'];
  signal: AbortSignal;
  limits: OfficialZipLimits;
  metadataBytes: number;
  inflate: OfficialZipInflater;
  failed: boolean;
  active: boolean;
  activeAbort?: () => void;
  nextSourceOrdinal: number;
}

function check(signal: AbortSignal): void {
  if (signal.aborted) fail('aborted');
}

/** Abort promptly even if a trusted source is slow to settle. Its promise stays handled. */
async function checked<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // The operation may have synchronously aborted the signal before returning
    // its already-rejected promise. Attach a handler even on this fast path.
    void promise.catch(() => {});
    fail('aborted');
  }
  let listener: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    listener = () => {
      try {
        fail('aborted');
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener('abort', listener, { once: true });
  });
  try {
    const value = await Promise.race([promise, aborted]);
    check(signal);
    return value;
  } finally {
    signal.removeEventListener('abort', listener);
  }
}

function add(a: number, b: number): number {
  const value = a + b;
  if (!Number.isSafeInteger(value) || a < 0 || b < 0) fail('invalid-zip');
  return value;
}

function limitsFrom(overrides: Partial<OfficialZipLimits> = {}): OfficialZipLimits {
  const limits: OfficialZipLimits = { ...OFFICIAL_ZIP_HARD_LIMITS };
  for (const key of Object.keys(overrides) as (keyof OfficialZipLimits)[]) {
    const value = overrides[key];
    if (
      !Object.prototype.hasOwnProperty.call(limits, key) ||
      !Number.isSafeInteger(value) ||
      value! < 0 ||
      value! > limits[key]
    )
      fail('invalid-limits');
    limits[key] = value!;
  }
  if (limits.maxChunkBytes < 1 || limits.maxCompressionRatio < 1) fail('invalid-limits');
  return limits;
}

async function read(
  ctx: Context,
  start: number,
  length: number,
  metadata: boolean,
  signal = ctx.signal
): Promise<Uint8Array> {
  check(signal);
  const end = add(start, length);
  if (end > ctx.size) fail('invalid-zip');
  if (metadata) {
    ctx.metadataBytes = add(ctx.metadataBytes, length);
    if (ctx.metadataBytes > ctx.limits.maxMetadataBytes) fail('resource-limit');
  }
  const bytes = new Uint8Array(length);
  for (let position = start; position < end; ) {
    check(signal);
    const next = Math.min(end, add(position, ctx.limits.maxChunkBytes));
    let part: Uint8Array;
    try {
      part = await checked(ctx.readRange(position, next, signal), signal);
    } catch (error) {
      sanitized(error, 'source-read-failed');
    }
    if (!(part instanceof Uint8Array) || part.byteLength !== next - position)
      fail('source-read-failed');
    bytes.set(part, position - start);
    position = next;
  }
  check(signal);
  return bytes;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function extra(bytes: Uint8Array): void {
  const data = view(bytes);
  const seen = new Set<number>();
  for (let offset = 0; offset < bytes.length; ) {
    if (offset + 4 > bytes.length) fail('invalid-zip');
    const id = data.getUint16(offset, true);
    const size = data.getUint16(offset + 2, true);
    if (id === 1 || id === 0x7075) fail('unsupported-zip');
    if (seen.has(id)) fail('invalid-zip');
    seen.add(id);
    offset = add(offset + 4, size);
    if (offset > bytes.length) fail('invalid-zip');
  }
}

const SHARD = /^conversations-([0-9]{3})\.json$/;
function rejectReservedAlias(name: string): void {
  const lower = name.toLowerCase();
  const reserved =
    lower === 'export_manifest.json' || /^conversations(?:-[0-9]+)?\.json$/.test(lower);
  if (
    reserved &&
    name !== 'export_manifest.json' &&
    name !== 'conversations.json' &&
    !SHARD.test(name)
  )
    fail('invalid-layout');
}

function rawName(bytes: Uint8Array, limits: OfficialZipLimits): string {
  if (!bytes.length || bytes.length > limits.maxFilenameBytes) fail('resource-limit');
  let name = '';
  for (const byte of bytes) {
    if (byte < 32 || byte === 127 || byte === 92 || byte === 58) fail('unsafe-name');
    name += String.fromCharCode(byte);
  }
  const parts = name.split('/');
  if (parts[parts.length - 1] === '') parts.pop();
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..'))
    fail('unsafe-name');
  rejectReservedAlias(name);
  return name;
}

function profile(version: number, flags: number, method: number): void {
  // Only descriptor, UTF-8 and (DEFLATE only) compression-level hints.
  const allowed = 0x0808 | (method === 8 ? 0x0006 : 0);
  if (version > 20 || (method !== 0 && method !== 8) || (flags & ~allowed) !== 0)
    fail('unsupported-zip');
}

function validateFileKind(entry: Entry, attributes: number): void {
  const kind = (attributes >>> 16) & 0xf000;
  if ((kind !== 0 && kind !== 0x4000 && kind !== 0x8000) || (attributes & 8) !== 0)
    fail('unsupported-zip');
  const directory = entry.name.endsWith('/');
  if (
    ((kind === 0x4000 || (attributes & 16) !== 0) && !directory) ||
    (directory && kind === 0x8000)
  )
    fail('invalid-zip');
  if (directory && entry.expanded !== 0) fail('invalid-zip');
}

function centralEntry(
  bytes: Uint8Array,
  cursor: number,
  ctx: Context
): { entry: Entry; end: number } {
  if (cursor + 46 > bytes.length) fail('invalid-zip');
  const data = view(bytes.subarray(cursor));
  if (data.getUint32(0, true) !== 0x02014b50) fail('invalid-zip');
  const nameLength = data.getUint16(28, true);
  const extraLength = data.getUint16(30, true);
  const end = add(cursor + 46, nameLength + extraLength + data.getUint16(32, true));
  if (end > bytes.length) fail('invalid-zip');
  const entry: Entry = {
    name: rawName(bytes.subarray(cursor + 46, cursor + 46 + nameLength), ctx.limits),
    version: data.getUint16(6, true),
    flags: data.getUint16(8, true),
    method: data.getUint16(10, true),
    crc: data.getUint32(16, true),
    compressed: data.getUint32(20, true),
    expanded: data.getUint32(24, true),
    offset: data.getUint32(42, true),
    dataStart: 0,
  };
  profile(entry.version, entry.flags, entry.method);
  if (
    data.getUint16(34, true) !== 0 ||
    [entry.compressed, entry.expanded, entry.offset].includes(0xffffffff)
  )
    fail('unsupported-zip');
  validateFileKind(entry, data.getUint32(38, true));
  if (entry.method === 0 && entry.compressed !== entry.expanded) fail('invalid-zip');
  extra(bytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength));
  return { entry, end };
}

async function endRecord(ctx: Context): Promise<{ count: number; size: number; start: number }> {
  if (ctx.size < 22) fail('invalid-zip');
  // PR1 deliberately excludes comments: no payload-bearing backwards tail scan.
  const eocd = view(await read(ctx, ctx.size - 22, 22, true));
  if (eocd.getUint32(0, true) !== 0x06054b50) fail('invalid-zip');
  if (eocd.getUint16(20, true) !== 0) fail('unsupported-zip');
  const count = eocd.getUint16(10, true);
  const size = eocd.getUint32(12, true);
  const start = eocd.getUint32(16, true);
  if (
    eocd.getUint16(4, true) !== 0 ||
    eocd.getUint16(6, true) !== 0 ||
    count === 0xffff ||
    size === 0xffffffff ||
    start === 0xffffffff
  )
    fail('unsupported-zip');
  if (count !== eocd.getUint16(8, true) || add(start, size) !== ctx.size - 22) fail('invalid-zip');
  if (count > ctx.limits.maxEntries || size > ctx.limits.maxCentralDirectoryBytes)
    fail('resource-limit');
  return { count, size, start };
}

async function directory(ctx: Context): Promise<{ entries: Entry[]; start: number }> {
  const { count, size, start } = await endRecord(ctx);
  const bytes = await read(ctx, start, size, true);
  const entries: Entry[] = [];
  const names = new Set<string>();
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    check(ctx.signal);
    const parsed = centralEntry(bytes, cursor, ctx);
    if (names.has(parsed.entry.name)) fail('duplicate-name');
    names.add(parsed.entry.name);
    entries.push(parsed.entry);
    cursor = parsed.end;
    if (i % 256 === 255)
      await checked(new Promise<void>(resolve => setTimeout(resolve, 0)), ctx.signal);
  }
  if (cursor !== size) fail('invalid-zip');
  return { entries, start };
}

async function validateLocalSizes(
  ctx: Context,
  entry: Entry,
  data: DataView,
  dataEnd: number,
  nextOffset: number
): Promise<void> {
  const values = [data.getUint32(14, true), data.getUint32(18, true), data.getUint32(22, true)];
  const expected = [entry.crc, entry.compressed, entry.expanded];
  const matches = values.every((value, i) => value === expected[i]);
  if (!(entry.flags & 8)) {
    if (!matches || dataEnd !== nextOffset) fail('invalid-zip');
    return;
  }
  if (!matches && !values.every(value => value === 0)) fail('invalid-zip');
  const length = nextOffset - dataEnd;
  if (length !== 12 && length !== 16) fail('invalid-zip');
  const descriptor = view(await read(ctx, dataEnd, length, true));
  const base = length === 16 ? 4 : 0;
  if (
    (base && descriptor.getUint32(0, true) !== 0x08074b50) ||
    expected.some((value, i) => descriptor.getUint32(base + 4 * i, true) !== value)
  )
    fail('invalid-zip');
}

async function local(ctx: Context, entry: Entry, nextOffset: number): Promise<void> {
  if (add(entry.offset, 30) > nextOffset) fail('invalid-zip');
  const data = view(await read(ctx, entry.offset, 30, true));
  if (
    data.getUint32(0, true) !== 0x04034b50 ||
    data.getUint16(4, true) !== entry.version ||
    data.getUint16(6, true) !== entry.flags ||
    data.getUint16(8, true) !== entry.method
  )
    fail('invalid-zip');
  const nameLength = data.getUint16(26, true);
  const extraLength = data.getUint16(28, true);
  if (nameLength !== entry.name.length) fail('invalid-zip');
  entry.dataStart = add(entry.offset + 30, nameLength + extraLength);
  const dataEnd = add(entry.dataStart, entry.compressed);
  if (dataEnd > nextOffset) fail('invalid-zip');
  const variable = await read(ctx, entry.offset + 30, nameLength + extraLength, true);
  if (rawName(variable.subarray(0, nameLength), ctx.limits) !== entry.name) fail('invalid-zip');
  extra(variable.subarray(nameLength));
  await validateLocalSizes(ctx, entry, data, dataEnd, nextOffset);
}

async function validateLocals(ctx: Context, entries: Entry[], centralStart: number): Promise<void> {
  const ordered = [...entries].sort((a, b) => a.offset - b.offset);
  if (!ordered.length || ordered[0].offset !== 0) fail('invalid-zip');
  for (let i = 0; i < ordered.length; i++) {
    check(ctx.signal);
    await local(ctx, ordered[i], ordered[i + 1]?.offset ?? centralStart);
    check(ctx.signal);
    if (i % 256 === 255)
      await checked(new Promise<void>(resolve => setTimeout(resolve, 0)), ctx.signal);
  }
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crcUpdate(crc: number, bytes: Uint8Array): number {
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255];
  return crc;
}

async function* nativeInflate(
  chunks: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
  maxChunkBytes: number
): AsyncGenerator<Uint8Array> {
  let transform: DecompressionStream;
  try {
    transform = new DecompressionStream('deflate-raw');
  } catch {
    fail('inflater-unavailable');
  }
  const iterator = chunks[Symbol.asyncIterator]();
  const input = new ReadableStream<BufferSource>(
    {
      async pull(controller) {
        try {
          check(signal);
          const next = await checked(iterator.next(), signal);
          if (next.done) controller.close();
          else controller.enqueue(new Uint8Array(next.value));
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await iterator.return?.();
      },
    },
    { highWaterMark: 0 }
  );
  const reader = input.pipeThrough(transform, { signal }).getReader();
  try {
    while (true) {
      const next = await checked(reader.read(), signal);
      if (next.done) return;
      // Native implementations can choose output chunk sizes; only bounded owned
      // slices cross our API. The trusted native stream itself provides backpressure.
      for (let offset = 0; offset < next.value.length; offset += maxChunkBytes) {
        check(signal);
        yield next.value.slice(offset, offset + maxChunkBytes);
      }
    }
  } finally {
    // Cleanup errors are deliberately opaque and must not replace the primary failure.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function* payload(
  ctx: Context,
  entry: Entry,
  signal: AbortSignal,
  state: { inputComplete: boolean }
): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < entry.compressed; ) {
    check(signal);
    const length = Math.min(entry.compressed - offset, ctx.limits.maxChunkBytes);
    yield await read(ctx, entry.dataStart + offset, length, false, signal);
    offset += length;
  }
  check(signal);
  state.inputComplete = true;
}

async function* verifiedOutput(
  ctx: Context,
  entry: Entry,
  output: AsyncIterator<Uint8Array>,
  signal: AbortSignal,
  state: { inputComplete: boolean }
): AsyncGenerator<Uint8Array> {
  let expanded = 0;
  let crc = 0xffffffff;
  let sinceYield = 0;
  let chunks = 0;
  while (true) {
    check(signal);
    const next = await checked(Promise.resolve(output.next()), signal);
    if (next.done) break;
    if (
      !(next.value instanceof Uint8Array) ||
      !next.value.length ||
      next.value.length > ctx.limits.maxChunkBytes
    )
      fail('inflate-failed');
    // Typed-array subclasses may override slice (Buffer.slice is a view).
    // Copy through the constructor so reused inflater storage cannot change output.
    const bytes = new Uint8Array(next.value);
    expanded = add(expanded, bytes.length);
    if (expanded > entry.expanded || expanded > entry.compressed * ctx.limits.maxCompressionRatio)
      fail('integrity-failed');
    crc = crcUpdate(crc, bytes);
    yield bytes;
    check(signal);
    sinceYield += bytes.length;
    if (++chunks % 64 === 0 || sinceYield >= MiB) {
      await checked(new Promise<void>(resolve => setTimeout(resolve, 0)), signal);
      sinceYield = 0;
    }
  }
  if (!state.inputComplete || expanded !== entry.expanded || (crc ^ 0xffffffff) >>> 0 !== entry.crc)
    fail('integrity-failed');
  check(signal);
}

function closeProducer(producer: AsyncIterator<Uint8Array> | undefined): void {
  // Do not wait indefinitely for uncooperative injected cleanup after cancellation.
  try {
    void Promise.resolve(producer?.return?.()).catch(() => {});
  } catch {
    /* cleanup failures are opaque */
  }
}

async function* selectedChunks(
  ctx: Context,
  entry: Entry,
  sourceOrdinal?: number
): AsyncGenerator<Uint8Array> {
  check(ctx.signal);
  if (
    ctx.failed ||
    ctx.active ||
    (sourceOrdinal !== undefined && sourceOrdinal !== ctx.nextSourceOrdinal)
  ) {
    ctx.failed = true;
    ctx.activeAbort?.();
    fail('stream-unavailable');
  }
  ctx.active = true;
  const controller = new AbortController();
  const abort = () => controller.abort();
  ctx.activeAbort = abort;
  ctx.signal.addEventListener('abort', abort, { once: true });
  let complete = false;
  const state = { inputComplete: false };
  const compressed = payload(ctx, entry, controller.signal, state);
  let output: AsyncIterator<Uint8Array> | undefined;
  try {
    output = (
      entry.method === 0
        ? compressed
        : ctx.inflate(compressed, controller.signal, ctx.limits.maxChunkBytes)
    )[Symbol.asyncIterator]();
    yield* verifiedOutput(ctx, entry, output, controller.signal, state);
    // Eager manifest verification has no conversation ordinal. Only a verified
    // conversation EOF advances the shared cursor, exactly once per generator.
    if (sourceOrdinal !== undefined) ctx.nextSourceOrdinal += 1;
    complete = true;
  } catch (error) {
    sanitized(error, entry.method === 8 ? 'inflate-failed' : 'source-read-failed');
  } finally {
    if (!complete) ctx.failed = true;
    controller.abort();
    ctx.signal.removeEventListener('abort', abort);
    closeProducer(output);
    closeProducer(compressed);
    ctx.activeAbort = undefined;
    ctx.active = false;
  }
}

function select(ctx: Context, entries: Entry[]): { sources: Entry[]; manifest?: Entry } {
  const legacy = entries.find(entry => entry.name === 'conversations.json');
  const manifest = entries.find(entry => entry.name === 'export_manifest.json');
  const shards = entries
    .filter(entry => SHARD.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if ((legacy && (manifest || shards.length)) || (!legacy && !shards.length))
    fail('invalid-layout');
  const sources = legacy ? [legacy] : shards;
  const selected = manifest ? [...sources, manifest] : sources;
  let compressed = 0;
  let expanded = 0;
  for (const entry of selected) {
    compressed = add(compressed, entry.compressed);
    expanded = add(expanded, entry.expanded);
    if (entry.expanded > entry.compressed * ctx.limits.maxCompressionRatio) fail('resource-limit');
  }
  const conversationBytes = sources.reduce((total, entry) => add(total, entry.expanded), 0);
  if (
    compressed > ctx.limits.maxSelectedCompressedBytes ||
    expanded > ctx.limits.maxSelectedExpandedBytes ||
    conversationBytes > ctx.limits.maxConversationSourceBytes ||
    (manifest && manifest.expanded > ctx.limits.maxManifestBytes)
  )
    fail('resource-limit');
  return { sources, manifest };
}

async function verifyManifest(ctx: Context, entry: Entry, sources: Entry[]): Promise<void> {
  const bytes = new Uint8Array(entry.expanded);
  let offset = 0;
  for await (const chunk of selectedChunks(ctx, entry)) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  check(ctx.signal);
  try {
    admitOfficialManifest(
      bytes,
      sources.map(source => source.name)
    );
  } catch {
    fail('manifest-invalid');
  }
  check(ctx.signal);
}

export interface OpenOfficialExportZipInput {
  source: OfficialZipSource;
  signal: AbortSignal;
  limits?: Partial<OfficialZipLimits>;
  inflateRaw?: OfficialZipInflater;
}

function contextFrom(input: OpenOfficialExportZipInput): Context {
  const limits = limitsFrom(input.limits);
  const size = input.source.size;
  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    typeof input.source.readRange !== 'function' ||
    !input.signal ||
    typeof input.signal.addEventListener !== 'function'
  )
    fail('invalid-input');
  check(input.signal);
  if (size > limits.maxArchiveBytes) fail('resource-limit');
  return {
    size,
    readRange: input.source.readRange.bind(input.source),
    signal: input.signal,
    limits,
    metadataBytes: 0,
    inflate: input.inflateRaw ?? nativeInflate,
    failed: false,
    active: false,
    nextSourceOrdinal: 0,
  };
}

/** Structural admission only. Payload integrity is established lazily, at each
 * selected iterator's EOF. Consumers must drain every source, even after a match.
 * Sources are single-use and ordinal: earlier sources must reach verified EOF.
 * Returning before first next() is detected if a later source is attempted. */
export async function openOfficialExportZip(
  input: OpenOfficialExportZipInput
): Promise<OfficialZipSelection> {
  try {
    const ctx = contextFrom(input);
    const { entries, start } = await directory(ctx);
    await validateLocals(ctx, entries, start);
    const { sources, manifest } = select(ctx, entries);
    if (manifest) await verifyManifest(ctx, manifest, sources);
    check(ctx.signal);
    const selected = manifest ? [...sources, manifest] : sources;
    const evidence: OfficialZipEvidence = Object.freeze({
      entryCount: entries.length,
      selectedSourceCount: sources.length,
      selectedCompressedBytes: selected.reduce((n, entry) => add(n, entry.compressed), 0),
      selectedExpandedBytes: selected.reduce((n, entry) => add(n, entry.expanded), 0),
      manifestStatus: manifest ? 'verified-name-set' : 'absent-unverified',
    });
    if (sources[0].name === 'conversations.json')
      return { evidence, officialChunks: selectedChunks(ctx, sources[0], 0) };
    return {
      evidence,
      officialSources: sources.map((entry, ordinal) => ({
        shardIndex: Number(SHARD.exec(entry.name)![1]),
        chunks: selectedChunks(ctx, entry, ordinal),
      })),
    };
  } catch (error) {
    sanitized(error, 'invalid-input');
  }
}
