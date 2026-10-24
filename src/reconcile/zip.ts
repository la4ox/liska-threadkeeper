const ZIP32_MAX = 0xffffffff;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

export const RECONCILIATION_ZIP_HARD_LIMITS = Object.freeze({
  maxEntries: 16,
  maxEntryBytes: 64 * 1024 * 1024,
  maxInputBytes: 256 * 1024 * 1024,
  maxOutputBytes: 257 * 1024 * 1024,
  maxPathBytes: 256,
});

export interface ReconciliationZipEntry {
  path: string;
  bytes: Uint8Array;
}

export interface ReconciliationZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  maxPathBytes: number;
}

export type ReconciliationZipErrorCode = 'invalid-entry' | 'invalid-limits' | 'limit-exceeded';

export class ReconciliationZipError extends Error {
  readonly code: ReconciliationZipErrorCode;

  constructor(code: ReconciliationZipErrorCode) {
    super(`Reconciliation ZIP creation failed (${code}).`);
    this.name = 'ReconciliationZipError';
    this.code = code;
  }
}

interface PreparedEntry {
  path: Uint8Array;
  bytes: Uint8Array;
  crc32: number;
  offset: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < table.length; value += 1) {
    let current = value;
    for (let bit = 0; bit < 8; bit += 1)
      current = (current & 1) !== 0 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
    table[value] = current >>> 0;
  }
  return table;
})();

function fail(code: ReconciliationZipErrorCode): never {
  throw new ReconciliationZipError(code);
}

function resolveLimits(input?: Partial<ReconciliationZipLimits>): ReconciliationZipLimits {
  const limits: ReconciliationZipLimits = { ...RECONCILIATION_ZIP_HARD_LIMITS };
  if (input === undefined) return limits;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) fail('invalid-limits');
  for (const [key, value] of Object.entries(input)) {
    if (!Object.prototype.hasOwnProperty.call(limits, key)) fail('invalid-limits');
    const name = key as keyof ReconciliationZipLimits;
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > limits[name]
    )
      fail('invalid-limits');
    limits[name] = value;
  }
  return limits;
}

function validPath(path: string): boolean {
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(path) || path.endsWith('/')) return false;
  return path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function write16(view: DataView, offset: number, value: number): number {
  view.setUint16(offset, value, true);
  return offset + 2;
}

function write32(view: DataView, offset: number, value: number): number {
  view.setUint32(offset, value >>> 0, true);
  return offset + 4;
}

function prepareEntries(
  entries: readonly ReconciliationZipEntry[],
  limits: ReconciliationZipLimits
): PreparedEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) fail('invalid-entry');
  if (entries.length > limits.maxEntries) fail('limit-exceeded');
  const encoder = new TextEncoder();
  const paths = new Set<string>();
  const prepared: PreparedEntry[] = [];
  let inputBytes = 0;
  for (const entry of entries) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof entry.path !== 'string' ||
      !validPath(entry.path) ||
      paths.has(entry.path) ||
      Object.prototype.toString.call(entry.bytes) !== '[object Uint8Array]'
    )
      fail('invalid-entry');
    const path = encoder.encode(entry.path);
    if (path.byteLength > limits.maxPathBytes || path.byteLength > 0xffff) fail('limit-exceeded');
    if (entry.bytes.byteLength > limits.maxEntryBytes) fail('limit-exceeded');
    inputBytes += entry.bytes.byteLength;
    if (inputBytes > limits.maxInputBytes) fail('limit-exceeded');
    paths.add(entry.path);
    const bytes = entry.bytes.slice();
    prepared.push({ path, bytes, crc32: crc32(bytes), offset: 0 });
  }
  return prepared;
}

function outputLength(entries: readonly PreparedEntry[], limits: ReconciliationZipLimits): number {
  let length = 22;
  for (const entry of entries) {
    length += 30 + entry.path.byteLength + entry.bytes.byteLength;
    length += 46 + entry.path.byteLength;
    if (length > limits.maxOutputBytes || length > ZIP32_MAX) fail('limit-exceeded');
  }
  return length;
}

function writeLocalEntry(
  output: Uint8Array,
  view: DataView,
  offset: number,
  entry: PreparedEntry
): number {
  entry.offset = offset;
  offset = write32(view, offset, 0x04034b50);
  offset = write16(view, offset, 20);
  offset = write16(view, offset, UTF8_FLAG);
  offset = write16(view, offset, STORE_METHOD);
  offset = write16(view, offset, DOS_TIME);
  offset = write16(view, offset, DOS_DATE);
  offset = write32(view, offset, entry.crc32);
  offset = write32(view, offset, entry.bytes.byteLength);
  offset = write32(view, offset, entry.bytes.byteLength);
  offset = write16(view, offset, entry.path.byteLength);
  offset = write16(view, offset, 0);
  output.set(entry.path, offset);
  offset += entry.path.byteLength;
  output.set(entry.bytes, offset);
  return offset + entry.bytes.byteLength;
}

function writeCentralEntry(
  output: Uint8Array,
  view: DataView,
  offset: number,
  entry: PreparedEntry
): number {
  offset = write32(view, offset, 0x02014b50);
  offset = write16(view, offset, 20);
  offset = write16(view, offset, 20);
  offset = write16(view, offset, UTF8_FLAG);
  offset = write16(view, offset, STORE_METHOD);
  offset = write16(view, offset, DOS_TIME);
  offset = write16(view, offset, DOS_DATE);
  offset = write32(view, offset, entry.crc32);
  offset = write32(view, offset, entry.bytes.byteLength);
  offset = write32(view, offset, entry.bytes.byteLength);
  offset = write16(view, offset, entry.path.byteLength);
  offset = write16(view, offset, 0);
  offset = write16(view, offset, 0);
  offset = write16(view, offset, 0);
  offset = write16(view, offset, 0);
  offset = write32(view, offset, 0);
  offset = write32(view, offset, entry.offset);
  output.set(entry.path, offset);
  return offset + entry.path.byteLength;
}

/** Deterministic ZIP32 writer using STORE entries and fixed 1980 timestamps. */
export function createReconciliationZip(
  entries: readonly ReconciliationZipEntry[],
  overrides?: Partial<ReconciliationZipLimits>
): Uint8Array {
  const limits = resolveLimits(overrides);
  const prepared = prepareEntries(entries, limits);
  const output = new Uint8Array(outputLength(prepared, limits));
  const view = new DataView(output.buffer);
  let offset = 0;
  for (const entry of prepared) offset = writeLocalEntry(output, view, offset, entry);
  const centralOffset = offset;
  for (const entry of prepared) offset = writeCentralEntry(output, view, offset, entry);
  const centralLength = offset - centralOffset;
  offset = write32(view, offset, 0x06054b50);
  offset = write16(view, offset, 0);
  offset = write16(view, offset, 0);
  offset = write16(view, offset, prepared.length);
  offset = write16(view, offset, prepared.length);
  offset = write32(view, offset, centralLength);
  offset = write32(view, offset, centralOffset);
  offset = write16(view, offset, 0);
  if (offset !== output.byteLength) fail('limit-exceeded');
  return output;
}
