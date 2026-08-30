import { describe, expect, it, vi } from 'vitest';
import {
  ARCHIVE_STAGE_CHUNK_BYTES,
  ARCHIVE_STAGE_MAX_BYTES,
  ARCHIVE_STAGE_RELATIVE_PATHS,
  decodeCanonicalArchiveStageChunk,
  equalArchiveStageDescriptor,
  isArchiveStageDescriptor,
  isSafeArchiveStageId,
} from '../../src/lib/archive-stage-contract';
import { ARCHIVE_COMPANION_RELATIVE_PATHS } from '../../src/lib/types';

const descriptor = {
  kind: 'raw' as const,
  mediaType: 'application/json' as const,
  relativePath: ARCHIVE_STAGE_RELATIVE_PATHS.raw,
  byteLength: 3,
  sha256: 'a'.repeat(64),
};

describe('archive-stage contract', () => {
  it('shares the immutable raw/canonical archive paths with durable companions', () => {
    expect(ARCHIVE_STAGE_RELATIVE_PATHS).toEqual({
      raw: ARCHIVE_COMPANION_RELATIVE_PATHS.raw,
      canonical: ARCHIVE_COMPANION_RELATIVE_PATHS.canonical,
    });
  });

  it('requires a 192-bit opaque archive-stage ID and exact kind-specific descriptor', () => {
    expect(isSafeArchiveStageId(`archive-stage-${'A'.repeat(32)}`)).toBe(true);
    expect(isSafeArchiveStageId(`archive-stage-${'A'.repeat(31)}`)).toBe(false);
    expect(isSafeArchiveStageId('stage-not-an-archive-id')).toBe(false);
    expect(isArchiveStageDescriptor(descriptor)).toBe(true);
    expect(
      isArchiveStageDescriptor({
        ...descriptor,
        relativePath: ARCHIVE_STAGE_RELATIVE_PATHS.canonical,
      })
    ).toBe(false);
    expect(isArchiveStageDescriptor({ ...descriptor, extra: true })).toBe(false);
  });

  it('keeps the JSON bound and descriptor equality exact', () => {
    expect(isArchiveStageDescriptor({ ...descriptor, byteLength: ARCHIVE_STAGE_MAX_BYTES })).toBe(
      true
    );
    expect(
      isArchiveStageDescriptor({ ...descriptor, byteLength: ARCHIVE_STAGE_MAX_BYTES + 1 })
    ).toBe(false);
    expect(equalArchiveStageDescriptor(descriptor, { ...descriptor })).toBe(true);
    expect(equalArchiveStageDescriptor(descriptor, { ...descriptor, kind: 'canonical' })).toBe(
      false
    );
  });

  it('decodes only canonical bounded standard base64', () => {
    expect([...(decodeCanonicalArchiveStageChunk('AP8=') ?? [])]).toEqual([0, 255]);
    expect(decodeCanonicalArchiveStageChunk('AP8')).toBeUndefined();
    expect(decodeCanonicalArchiveStageChunk('AP8=\n')).toBeUndefined();
    expect(decodeCanonicalArchiveStageChunk('AP8_')).toBeUndefined();
    expect(
      decodeCanonicalArchiveStageChunk(btoa('x'.repeat(ARCHIVE_STAGE_CHUNK_BYTES + 1)))
    ).toBeUndefined();
  });

  it('fails closed when platform base64 decoding is unavailable', () => {
    const atob = vi.spyOn(globalThis, 'atob').mockImplementation(() => {
      throw new Error('unavailable');
    });
    try {
      expect(decodeCanonicalArchiveStageChunk('AA==')).toBeUndefined();
    } finally {
      atob.mockRestore();
    }
  });
});
