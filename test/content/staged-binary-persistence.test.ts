import { describe, expect, it, vi } from 'vitest';
import { canonicalBase64ByteLength } from '../../src/lib/base64';
import { BINARY_STAGE_CHUNK_BYTES } from '../../src/lib/constants';
import { sha256Hex } from '../../src/lib/binary-asset-contract';

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock('../../src/lib/messaging', () => ({
  sendMessage: (...args: unknown[]) => mocks.sendMessage(...args),
}));

import { persistVerifiedBinaryAssets } from '../../src/content/staged-binary-persistence';

async function runtimeAsset(letter: string, bytes: Uint8Array) {
  return {
    assetId: `chatgpt-asset-${letter.repeat(64)}`,
    mediaType: 'application/octet-stream',
    bytes,
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  };
}

describe('content staged binary persistence', () => {
  it('chunks canonical base64 at 512 KiB and continues to the next asset after one failure', async () => {
    const first = await runtimeAsset('a', new Uint8Array(BINARY_STAGE_CHUNK_BYTES + 1));
    const second = await runtimeAsset('b', new Uint8Array([7]));
    let firstAppend = true;
    mocks.sendMessage.mockImplementation((message: { action: string }) => {
      if (message.action === 'beginStagedBinaryAsset') return Promise.resolve({ success: true });
      if (message.action === 'appendStagedBinaryAsset' && firstAppend) {
        firstAppend = false;
        return Promise.resolve({ success: false });
      }
      if (message.action === 'appendStagedBinaryAsset') return Promise.resolve({ success: true });
      if (message.action === 'abortStagedBinaryAsset') return Promise.resolve({ success: true });
      if (message.action === 'commitStagedBinaryAsset') {
        return Promise.resolve({
          results: [
            { destination: 'file', success: true },
            { destination: 'obsidian', success: false, error: 'binary-obsidian-put-failed' },
          ],
          allSuccessful: false,
          anySuccessful: true,
        });
      }
      return Promise.resolve({ success: false });
    });

    const results = await persistVerifiedBinaryAssets({
      source: 'chatgpt',
      captureId: 'capture-chatgpt-11111111-2222-4333-8444-555555555555',
      conversationKey: 'c'.repeat(64),
      assets: [first, second],
      outputs: ['file', 'obsidian'],
    });

    expect(results).toEqual([
      expect.objectContaining({
        assetId: first.assetId,
        allSuccessful: false,
        results: [
          { destination: 'file', success: false, error: 'binary-stage-append-failed' },
          { destination: 'obsidian', success: false, error: 'binary-stage-append-failed' },
        ],
      }),
      expect.objectContaining({
        assetId: second.assetId,
        allSuccessful: false,
        results: [
          { destination: 'file', success: true },
          { destination: 'obsidian', success: false, error: 'binary-obsidian-put-failed' },
        ],
      }),
    ]);
    const appends = mocks.sendMessage.mock.calls
      .map(call => call[0] as { action?: string; chunkBase64?: string })
      .filter(message => message.action === 'appendStagedBinaryAsset');
    expect(appends).toHaveLength(2);
    expect(canonicalBase64ByteLength(appends[0]?.chunkBase64 ?? '')).toBe(BINARY_STAGE_CHUNK_BYTES);
    expect(canonicalBase64ByteLength(appends[1]?.chunkBase64 ?? '')).toBe(1);
    expect(
      mocks.sendMessage.mock.calls.some(
        ([message]) => (message as { action?: string }).action === 'abortStagedBinaryAsset'
      )
    ).toBe(true);
  });

  it('rejects Clipboard at runtime without sending a binary stage message', async () => {
    const asset = await runtimeAsset('a', new Uint8Array([1]));
    mocks.sendMessage.mockClear();

    const results = await persistVerifiedBinaryAssets({
      source: 'chatgpt',
      captureId: 'capture-chatgpt-11111111-2222-4333-8444-555555555555',
      conversationKey: 'c'.repeat(64),
      assets: [asset],
      outputs: ['clipboard'] as never,
    });

    expect(results[0]?.results).toEqual([
      { destination: 'clipboard', success: false, error: 'binary-output-invalid' },
    ]);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps later assets eligible when random stage identity creation fails once', async () => {
    const first = await runtimeAsset('a', new Uint8Array([1]));
    const second = await runtimeAsset('b', new Uint8Array([2]));
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues');
    random.mockImplementationOnce(() => {
      throw new Error('random unavailable');
    });
    mocks.sendMessage.mockImplementation((message: { action: string }) => {
      if (
        message.action === 'beginStagedBinaryAsset' ||
        message.action === 'appendStagedBinaryAsset'
      ) {
        return Promise.resolve({ success: true });
      }
      if (message.action === 'commitStagedBinaryAsset') {
        return Promise.resolve({
          results: [{ destination: 'file', success: true }],
          allSuccessful: true,
          anySuccessful: true,
        });
      }
      return Promise.resolve({ success: true });
    });

    try {
      const results = await persistVerifiedBinaryAssets({
        source: 'chatgpt',
        captureId: 'capture-chatgpt-11111111-2222-4333-8444-555555555555',
        conversationKey: 'c'.repeat(64),
        assets: [first, second],
        outputs: ['file'],
      });

      expect(results[0]).toEqual(
        expect.objectContaining({
          assetId: first.assetId,
          allSuccessful: false,
          results: [
            { destination: 'file', success: false, error: 'binary-stage-operation-failed' },
          ],
        })
      );
      expect(results[1]).toEqual(
        expect.objectContaining({
          assetId: second.assetId,
          allSuccessful: true,
          results: [{ destination: 'file', success: true }],
        })
      );
    } finally {
      random.mockRestore();
    }
  });

  it('accepts an exact fetched RawCaptureAsset and rejects dishonest runtime records', async () => {
    const bytes = new Uint8Array([4, 5]);
    const sha256 = await sha256Hex(bytes);
    const fetched = {
      record: {
        id: `chatgpt-asset-${'a'.repeat(64)}`,
        state: 'fetched' as const,
        attemptedAt: '2026-08-21T00:00:00.000Z',
        relativePath: `assets/${sha256}.bin`,
        mediaType: 'application/octet-stream',
        byteLength: bytes.byteLength,
        sha256,
        detail: null,
        sourceRefs: [{ artifactId: 'conversation', rawPointer: '/asset' }],
      },
      bytes,
    };
    mocks.sendMessage.mockImplementation((message: { action: string }) => {
      if (
        message.action === 'beginStagedBinaryAsset' ||
        message.action === 'appendStagedBinaryAsset'
      ) {
        return Promise.resolve({ success: true });
      }
      if (message.action === 'commitStagedBinaryAsset') {
        return Promise.resolve({
          results: [{ destination: 'file', success: true }],
          allSuccessful: true,
          anySuccessful: true,
        });
      }
      return Promise.resolve({ success: true });
    });

    const results = await persistVerifiedBinaryAssets({
      source: 'chatgpt',
      captureId: 'capture-chatgpt-11111111-2222-4333-8444-555555555555',
      conversationKey: 'c'.repeat(64),
      assets: [
        fetched,
        { ...fetched, record: { ...fetched.record, state: 'not-attempted' as const } },
        { ...fetched, record: { ...fetched.record, byteLength: 99 } },
        { ...fetched, record: { ...fetched.record, sha256: 'f'.repeat(64) } },
        { ...fetched, record: { ...fetched.record, relativePath: 'assets/not-the-hash.bin' } },
      ],
      outputs: ['file'],
    });

    expect(results.map(result => result.results[0]?.error ?? 'ok')).toEqual([
      'ok',
      'binary-asset-invalid',
      'binary-asset-invalid',
      'binary-asset-integrity-failed',
      'binary-asset-integrity-failed',
    ]);
  });
});
