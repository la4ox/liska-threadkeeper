import { describe, expect, it } from 'vitest';
import {
  RECONCILIATION_ZIP_HARD_LIMITS,
  ReconciliationZipError,
  createReconciliationZip,
  type ReconciliationZipErrorCode,
} from '../../src/reconcile/zip';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function u16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function localEntries(bytes: Uint8Array): Array<{ path: string; body: Uint8Array; crc: number }> {
  const result: Array<{ path: string; body: Uint8Array; crc: number }> = [];
  let offset = 0;
  while (u32(bytes, offset) === 0x04034b50) {
    expect(u16(bytes, offset + 8)).toBe(0);
    const crc = u32(bytes, offset + 14);
    const size = u32(bytes, offset + 18);
    const pathLength = u16(bytes, offset + 26);
    const extraLength = u16(bytes, offset + 28);
    const pathStart = offset + 30;
    const bodyStart = pathStart + pathLength + extraLength;
    result.push({
      path: decoder.decode(bytes.subarray(pathStart, pathStart + pathLength)),
      body: bytes.slice(bodyStart, bodyStart + size),
      crc,
    });
    offset = bodyStart + size;
  }
  expect(u32(bytes, offset)).toBe(0x02014b50);
  return result;
}

function expectError(
  entries: Parameters<typeof createReconciliationZip>[0],
  code: ReconciliationZipErrorCode,
  limits?: Parameters<typeof createReconciliationZip>[1]
): void {
  let error: unknown;
  try {
    createReconciliationZip(entries, limits);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ReconciliationZipError);
  expect((error as ReconciliationZipError).code).toBe(code);
}

describe('createReconciliationZip', () => {
  it('writes deterministic UTF-8 STORE entries in supplied order', () => {
    const entries = [
      { path: 'official/conversation.json', bytes: encoder.encode('{"лис":true}') },
      { path: 'manifest.json', bytes: encoder.encode('{"ok":true}') },
    ];
    const first = createReconciliationZip(entries);
    const second = createReconciliationZip(entries);
    expect(second).toEqual(first);
    expect(localEntries(first).map(entry => [entry.path, decoder.decode(entry.body)])).toEqual([
      ['official/conversation.json', '{"лис":true}'],
      ['manifest.json', '{"ok":true}'],
    ]);
    expect(u32(first, first.byteLength - 22)).toBe(0x06054b50);
    expect(u16(first, first.byteLength - 12)).toBe(2);
  });

  it('owns input bytes and emits CRC values', () => {
    const source = encoder.encode('owned');
    const zip = createReconciliationZip([{ path: 'manifest.json', bytes: source }]);
    source.fill(0);
    const [entry] = localEntries(zip);
    expect(decoder.decode(entry.body)).toBe('owned');
    expect(entry.crc).toBe(0x3bb4532d);
  });

  it('rejects unsafe, duplicate and non-Uint8Array entries', () => {
    for (const path of ['', '/root.json', '../secret', 'a/../b', 'a\\b', 'Title.json']) {
      expectError([{ path, bytes: new Uint8Array() }], 'invalid-entry');
    }
    expectError(
      [
        { path: 'manifest.json', bytes: new Uint8Array() },
        { path: 'manifest.json', bytes: new Uint8Array() },
      ],
      'invalid-entry'
    );
    expectError([{ path: 'manifest.json', bytes: [] as never }], 'invalid-entry');
  });

  it('enforces lower-only entry, byte, path and output ceilings', () => {
    const entry = { path: 'manifest.json', bytes: encoder.encode('1234') };
    expectError([entry], 'limit-exceeded', { maxEntryBytes: 3 });
    expectError([entry], 'limit-exceeded', { maxInputBytes: 3 });
    expectError([entry], 'limit-exceeded', { maxPathBytes: 3 });
    expectError([entry], 'limit-exceeded', { maxOutputBytes: 80 });
    expectError([entry, { path: 'other.json', bytes: new Uint8Array() }], 'limit-exceeded', {
      maxEntries: 1,
    });
    expectError([entry], 'invalid-limits', {
      maxEntryBytes: RECONCILIATION_ZIP_HARD_LIMITS.maxEntryBytes + 1,
    });
    expectError([entry], 'invalid-limits', { maxEntries: 1.5 });
    expectError([entry], 'invalid-limits', { unknown: 1 } as never);
  });
});
