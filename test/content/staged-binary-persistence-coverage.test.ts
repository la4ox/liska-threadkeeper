import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawCaptureAsset } from '../../src/archive/capture';
import { BINARY_STAGE_CHUNK_BYTES } from '../../src/lib/constants';
import {
  binaryAssetExtension,
  createStagedBinaryAssetDescriptor,
  decodeCanonicalBinaryChunk,
  isStagedBinaryAssetDescriptor,
  sha256Hex,
} from '../../src/lib/binary-asset-contract';
import type { PersistentOutputDestination } from '../../src/lib/types';

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock('../../src/lib/messaging', () => ({
  sendMessage: (...args: unknown[]) => mocks.sendMessage(...args),
}));

import {
  persistVerifiedBinaryAssets,
  type VerifiedBinaryAssetRuntime,
} from '../../src/content/staged-binary-persistence';

const captureId = 'capture-chatgpt-11111111-2222-4333-8444-555555555555';
const conversationKey = 'c'.repeat(64);

async function runtimeAsset(
  seed: string,
  bytes: Uint8Array,
  mediaType = 'application/octet-stream'
): Promise<VerifiedBinaryAssetRuntime> {
  return {
    assetId: `chatgpt-asset-${seed.repeat(64)}`,
    mediaType,
    bytes,
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  };
}

async function rawAsset(bytes: Uint8Array): Promise<RawCaptureAsset> {
  const sha256 = await sha256Hex(bytes);
  return {
    record: {
      id: `chatgpt-asset-${'a'.repeat(64)}`,
      state: 'fetched',
      attemptedAt: '2026-08-21T00:00:00.000Z',
      relativePath: `assets/${sha256}.bin`,
      mediaType: 'application/octet-stream',
      byteLength: bytes.byteLength,
      sha256,
      detail: null,
      sourceRefs: [],
    },
    bytes,
  };
}

function input(
  assets: readonly (RawCaptureAsset | VerifiedBinaryAssetRuntime)[],
  outputs: readonly PersistentOutputDestination[] = ['file']
) {
  return {
    source: 'chatgpt' as const,
    captureId,
    conversationKey,
    assets,
    outputs,
  };
}

function successfulStageReplies(outputs: readonly PersistentOutputDestination[]): void {
  mocks.sendMessage.mockImplementation((message: { action: string }) => {
    if (
      message.action === 'beginStagedBinaryAsset' ||
      message.action === 'appendStagedBinaryAsset'
    ) {
      return Promise.resolve({ success: true });
    }
    if (message.action === 'commitStagedBinaryAsset') {
      return Promise.resolve({
        results: outputs.map(destination => ({ destination, success: true })),
        allSuccessful: true,
        anySuccessful: true,
      });
    }
    return Promise.resolve({ success: true });
  });
}

describe('staged binary content persistence coverage', () => {
  beforeEach(() => {
    mocks.sendMessage.mockReset();
  });

  it('accepts a fetched RawCaptureAsset only after preserving its canonical descriptor path', async () => {
    const asset = await rawAsset(new Uint8Array([1, 2, 3]));
    successfulStageReplies(['file']);

    const results = await persistVerifiedBinaryAssets(input([asset]));

    expect(results).toEqual([
      expect.objectContaining({
        assetId: asset.record.id,
        descriptor: expect.objectContaining({
          sha256: asset.record.sha256,
          relativePath: asset.record.relativePath,
        }),
        allSuccessful: true,
      }),
    ]);
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'beginStagedBinaryAsset',
        descriptor: expect.objectContaining({ relativePath: asset.record.relativePath }),
      })
    );
  });

  it('rejects unsupported MIME, incorrect byte length, digest, and predeclared path before staging', async () => {
    const unsupported = await runtimeAsset('a', new Uint8Array([1]), 'text/html');
    const wrongLength = { ...(await runtimeAsset('b', new Uint8Array([2]))), byteLength: 2 };
    const wrongHash = { ...(await runtimeAsset('c', new Uint8Array([3]))), sha256: 'd'.repeat(64) };
    const wrongPath = {
      ...(await runtimeAsset('d', new Uint8Array([4]))),
      relativePath: 'assets/not-the-content-address.bin',
    };

    const results = await persistVerifiedBinaryAssets(
      input([unsupported, wrongLength, wrongHash, wrongPath])
    );

    expect(results.map(result => result.results[0]?.error)).toEqual([
      'binary-asset-integrity-failed',
      'binary-asset-invalid',
      'binary-asset-integrity-failed',
      'binary-asset-integrity-failed',
    ]);
    expect(results[2]).toEqual(expect.objectContaining({ descriptor: expect.any(Object) }));
    expect(results[3]).toEqual(expect.objectContaining({ descriptor: expect.any(Object) }));
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('does not create a stage for a RawCaptureAsset that was never fetched', async () => {
    const asset = await rawAsset(new Uint8Array([5]));
    asset.record.state = 'declined';
    asset.record.mediaType = null;
    asset.record.byteLength = null;
    asset.record.sha256 = null;

    await expect(persistVerifiedBinaryAssets(input([asset]))).resolves.toEqual([
      {
        assetId: 'invalid-asset',
        results: [{ destination: 'file', success: false, error: 'binary-asset-invalid' }],
        allSuccessful: false,
      },
    ]);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects empty output selection for every asset before descriptor creation or messaging', async () => {
    const asset = await rawAsset(new Uint8Array([5]));

    await expect(persistVerifiedBinaryAssets(input([asset], []))).resolves.toEqual([
      {
        assetId: asset.record.id,
        results: [],
        allSuccessful: false,
      },
    ]);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('fails closed when descriptor hashing is unavailable before a stage begins', async () => {
    const asset = await runtimeAsset('e', new Uint8Array([9]));
    const digest = vi
      .spyOn(crypto.subtle, 'digest')
      .mockRejectedValueOnce(new Error('digest unavailable'));
    try {
      await expect(persistVerifiedBinaryAssets(input([asset]))).resolves.toEqual([
        expect.objectContaining({
          assetId: asset.assetId,
          results: [
            { destination: 'file', success: false, error: 'binary-asset-integrity-failed' },
          ],
        }),
      ]);
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    } finally {
      digest.mockRestore();
    }
  });

  it('fails closed for malformed descriptors and chunks at the shared binary contract boundary', async () => {
    const valid = await createStagedBinaryAssetDescriptor({
      assetId: `chatgpt-asset-${'a'.repeat(64)}`,
      mediaType: 'application/octet-stream',
      bytes: new Uint8Array([1]),
    });
    if (!valid) throw new Error('fixture descriptor');

    expect(binaryAssetExtension(' application/pdf')).toBeUndefined();
    expect(isStagedBinaryAssetDescriptor({ ...valid, assetId: 'untrusted' })).toBe(false);
    expect(isStagedBinaryAssetDescriptor({ ...valid, sha256: 'not-a-digest' })).toBe(false);
    expect(isStagedBinaryAssetDescriptor({ ...valid, mediaType: 1 } as never)).toBe(false);
    expect(
      isStagedBinaryAssetDescriptor(
        new Proxy(
          {},
          {
            ownKeys: () => {
              throw new Error('unreadable shape');
            },
          }
        )
      )
    ).toBe(false);
    await expect(
      createStagedBinaryAssetDescriptor({
        assetId: 'untrusted',
        mediaType: 'application/octet-stream',
        bytes: new Uint8Array(),
      })
    ).resolves.toBeUndefined();
    await expect(
      createStagedBinaryAssetDescriptor({
        assetId: valid.assetId,
        mediaType: 'application/octet-stream',
        bytes: {} as Uint8Array,
      })
    ).resolves.toBeUndefined();

    const originalAtob = globalThis.atob;
    Object.defineProperty(globalThis, 'atob', {
      configurable: true,
      value: () => '\0',
    });
    try {
      expect(decodeCanonicalBinaryChunk('AQ==')).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, 'atob', {
        configurable: true,
        value: originalAtob,
      });
    }
  });

  it('fails a malformed begin response, issues bounded abort cleanup, and keeps the next asset eligible', async () => {
    const first = await runtimeAsset('a', new Uint8Array([6]));
    const second = await runtimeAsset('b', new Uint8Array([7]));
    let begins = 0;
    mocks.sendMessage.mockImplementation((message: { action: string }) => {
      if (message.action === 'beginStagedBinaryAsset') {
        begins += 1;
        return Promise.resolve(begins === 1 ? { success: 'not-a-boolean' } : { success: true });
      }
      if (message.action === 'appendStagedBinaryAsset') return Promise.resolve({ success: true });
      if (message.action === 'commitStagedBinaryAsset') {
        return Promise.resolve({
          results: [{ destination: 'file', success: true }],
          allSuccessful: true,
          anySuccessful: true,
        });
      }
      return Promise.resolve({ success: true });
    });

    const results = await persistVerifiedBinaryAssets(input([first, second]));

    expect(results.map(result => result.results[0]?.error)).toEqual([
      'binary-stage-begin-failed',
      undefined,
    ]);
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'abortStagedBinaryAsset' })
    );
    expect(results[1]).toEqual(expect.objectContaining({ allSuccessful: true }));
  });

  it('rejects a malformed commit envelope after a zero-byte stage without sending an append', async () => {
    const asset = await runtimeAsset('a', new Uint8Array());
    mocks.sendMessage.mockImplementation((message: { action: string }) => {
      if (message.action === 'beginStagedBinaryAsset') return Promise.resolve({ success: true });
      if (message.action === 'commitStagedBinaryAsset') {
        return Promise.resolve({
          results: [{ destination: 'file', success: true, unexpected: true }],
          allSuccessful: true,
          anySuccessful: true,
        });
      }
      return Promise.resolve({ success: true });
    });

    await expect(persistVerifiedBinaryAssets(input([asset]))).resolves.toEqual([
      expect.objectContaining({
        assetId: asset.assetId,
        results: [{ destination: 'file', success: false, error: 'binary-stage-commit-failed' }],
      }),
    ]);
    expect(
      mocks.sendMessage.mock.calls.some(
        ([message]) => (message as { action?: string }).action === 'appendStagedBinaryAsset'
      )
    ).toBe(false);
  });

  it('returns an append-specific failure and exact abort when the worker rejects a chunk', async () => {
    const asset = await runtimeAsset('a', new Uint8Array([1]));
    mocks.sendMessage.mockImplementation((message: { action: string }) => {
      if (message.action === 'beginStagedBinaryAsset') return Promise.resolve({ success: true });
      if (message.action === 'appendStagedBinaryAsset') return Promise.resolve({ success: false });
      return Promise.resolve({ success: true });
    });

    await expect(persistVerifiedBinaryAssets(input([asset]))).resolves.toEqual([
      expect.objectContaining({
        results: [{ destination: 'file', success: false, error: 'binary-stage-append-failed' }],
      }),
    ]);
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'abortStagedBinaryAsset' })
    );
  });

  it('continues a valid asset at exact chunk offsets and converts a rejected append plus abort into one failure', async () => {
    const continuing = await runtimeAsset('a', new Uint8Array(BINARY_STAGE_CHUNK_BYTES + 1));
    const rejected = await runtimeAsset('b', new Uint8Array([8]));
    let activeAsset = 0;
    mocks.sendMessage.mockImplementation((message: { action: string; offset?: number }) => {
      if (message.action === 'beginStagedBinaryAsset') {
        activeAsset += 1;
        return Promise.resolve({ success: true });
      }
      if (message.action === 'appendStagedBinaryAsset' && activeAsset === 2) {
        return Promise.reject(new Error('worker restarted'));
      }
      if (message.action === 'appendStagedBinaryAsset') return Promise.resolve({ success: true });
      if (message.action === 'commitStagedBinaryAsset') {
        return Promise.resolve({
          results: [{ destination: 'file', success: true }],
          allSuccessful: true,
          anySuccessful: true,
        });
      }
      if (message.action === 'abortStagedBinaryAsset')
        return Promise.reject(new Error('also restarted'));
      return Promise.resolve({ success: true });
    });

    const results = await persistVerifiedBinaryAssets(input([continuing, rejected]));
    const appends = mocks.sendMessage.mock.calls
      .map(([message]) => message as { action?: string; offset?: number })
      .filter(message => message.action === 'appendStagedBinaryAsset');

    expect(appends.slice(0, 2).map(message => message.offset)).toEqual([
      0,
      BINARY_STAGE_CHUNK_BYTES,
    ]);
    expect(results[0]).toEqual(expect.objectContaining({ allSuccessful: true }));
    expect(results[1]).toEqual(
      expect.objectContaining({
        results: [{ destination: 'file', success: false, error: 'binary-stage-operation-failed' }],
      })
    );
  });
});
