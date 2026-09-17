import { describe, expect, it, vi } from 'vitest';
import {
  createStagedBinaryAssetDescriptor,
  decodeCanonicalBinaryChunk,
  isSafeStagedBinaryAssetId,
  isStagedBinaryAssetDescriptor,
} from '../../src/lib/binary-asset-contract';

const assetId = `chatgpt-asset-${'a'.repeat(64)}`;

describe('staged binary asset descriptor contract', () => {
  it('uses an opaque asset ID and exact content-addressed safe MIME path', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3]);
    const descriptor = await createStagedBinaryAssetDescriptor({
      assetId,
      mediaType: 'IMAGE/PNG',
      bytes,
    });

    expect(descriptor).toEqual(
      expect.objectContaining({
        assetId,
        byteLength: 4,
        mediaType: 'image/png',
        relativePath: expect.stringMatching(/^assets\/[a-f0-9]{64}\.png$/),
      })
    );
    expect(descriptor && isStagedBinaryAssetDescriptor(descriptor)).toBe(true);
  });

  it.each([
    'image/svg+xml',
    'text/html',
    'application/javascript',
    'application/vnd.ms-word.document.macroEnabled.12',
  ])('rejects active or macro-capable %s', async mediaType => {
    await expect(
      createStagedBinaryAssetDescriptor({ assetId, mediaType, bytes: new Uint8Array([1]) })
    ).resolves.toBeUndefined();
  });

  it('has an explicit inert octet-stream fallback', async () => {
    const descriptor = await createStagedBinaryAssetDescriptor({
      assetId,
      mediaType: 'application/octet-stream',
      bytes: new Uint8Array([1]),
    });

    expect(descriptor?.relativePath).toMatch(/^assets\/[a-f0-9]{64}\.bin$/);
  });

  it.each(['file-service:private', 'https://example.test/signed?sig=secret', 'provider-file-id'])(
    'rejects raw provider-like asset identifier %s',
    value => {
      expect(isSafeStagedBinaryAssetId(value)).toBe(false);
    }
  );

  it('rejects a descriptor whose path is not derived from its hash and MIME', () => {
    expect(
      isStagedBinaryAssetDescriptor({
        assetId,
        byteLength: 0,
        sha256: 'b'.repeat(64),
        mediaType: 'image/png',
        relativePath: 'assets/private-name.png',
      })
    ).toBe(false);
  });

  it('rejects malformed descriptor shapes and non-canonical chunks', () => {
    expect(isStagedBinaryAssetDescriptor(null)).toBe(false);
    expect(isStagedBinaryAssetDescriptor({ assetId, extra: true })).toBe(false);
    expect(
      isStagedBinaryAssetDescriptor({
        assetId,
        byteLength: -1,
        sha256: 'b'.repeat(64),
        mediaType: 'image/png',
        relativePath: `assets/${'b'.repeat(64)}.png`,
      })
    ).toBe(false);
    expect(decodeCanonicalBinaryChunk('not-base64')).toBeUndefined();
  });

  it('fails closed when the platform base64 decoder throws', () => {
    const atob = vi.spyOn(globalThis, 'atob').mockImplementation(() => {
      throw new Error('decoder unavailable');
    });
    try {
      expect(decodeCanonicalBinaryChunk('AA==')).toBeUndefined();
    } finally {
      atob.mockRestore();
    }
  });
});
