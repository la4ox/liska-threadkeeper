import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARCHIVE_STAGE_CHUNK_BYTES,
  ARCHIVE_STAGE_RELATIVE_PATHS,
  type ArchiveStageDescriptor,
} from '../../src/lib/archive-stage-contract';
import { canonicalBase64ByteLength } from '../../src/lib/base64';
import { bytesToBase64 } from '../../src/lib/image-utils';
import { sha256Hex } from '../../src/content/capture/response';
import type { StagedArchiveCompanionArtifact } from '../../src/lib/types';

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock('../../src/lib/messaging', () => ({
  sendMessage: (...args: unknown[]) => mocks.sendMessage(...args),
}));

import {
  readStagedArchiveArtifactBytes,
  stageArchiveArtifactBytes,
} from '../../src/content/archive-stage';

const stageId = `archive-stage-${'A'.repeat(32)}`;

function expectBoundedRuntimeMessage(message: Record<string, unknown>): void {
  expect(message).not.toHaveProperty('content');
  expect(message).not.toHaveProperty('log');
  if (typeof message.chunkBase64 === 'string') {
    expect(canonicalBase64ByteLength(message.chunkBase64)).toBeLessThanOrEqual(
      ARCHIVE_STAGE_CHUNK_BYTES
    );
  }
}

async function descriptorFor(bytes: Uint8Array): Promise<ArchiveStageDescriptor> {
  return {
    kind: 'raw',
    mediaType: 'application/json',
    relativePath: ARCHIVE_STAGE_RELATIVE_PATHS.raw,
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  };
}

describe('content archive-stage bridge', () => {
  beforeEach(() => {
    mocks.sendMessage.mockReset();
  });

  it('begins, sends only 512 KiB chunks, seals, and never puts content or logs on runtime messages', async () => {
    const bytes = new Uint8Array(ARCHIVE_STAGE_CHUNK_BYTES * 2 + 17);
    bytes[0] = 1;
    bytes[ARCHIVE_STAGE_CHUNK_BYTES] = 2;
    bytes[bytes.byteLength - 1] = 3;
    mocks.sendMessage.mockImplementation((message: { action: string }) => {
      if (message.action === 'beginStagedArchiveArtifact') {
        return Promise.resolve({ success: true, stageId });
      }
      return Promise.resolve({ success: true });
    });

    const artifact = await stageArchiveArtifactBytes('raw', bytes);
    const messages = mocks.sendMessage.mock.calls.map(
      ([message]) => message as Record<string, unknown>
    );
    const appends = messages.filter(message => message.action === 'appendStagedArchiveArtifact');

    expect(artifact).toEqual({
      transport: 'staged',
      stageId,
      ...(await descriptorFor(bytes)),
    });
    expect(messages.map(message => message.action)).toEqual([
      'beginStagedArchiveArtifact',
      'appendStagedArchiveArtifact',
      'appendStagedArchiveArtifact',
      'appendStagedArchiveArtifact',
      'sealStagedArchiveArtifact',
    ]);
    expect(appends.map(message => message.offset)).toEqual([
      0,
      ARCHIVE_STAGE_CHUNK_BYTES,
      ARCHIVE_STAGE_CHUNK_BYTES * 2,
    ]);
    expect(
      appends.map(message => canonicalBase64ByteLength(message.chunkBase64 as string))
    ).toEqual([ARCHIVE_STAGE_CHUNK_BYTES, ARCHIVE_STAGE_CHUNK_BYTES, 17]);
    messages.forEach(expectBoundedRuntimeMessage);
  });

  it('stages a canonical artifact above the former 32 MiB inline ceiling without one whole message', async () => {
    const bytes = new Uint8Array(32 * 1024 * 1024 + 1);
    bytes[0] = 1;
    bytes[bytes.byteLength - 1] = 2;
    mocks.sendMessage.mockImplementation((message: { action: string }) =>
      Promise.resolve(
        message.action === 'beginStagedArchiveArtifact'
          ? { success: true, stageId }
          : { success: true }
      )
    );

    const artifact = await stageArchiveArtifactBytes('canonical', bytes);
    const messages = mocks.sendMessage.mock.calls.map(
      ([message]) => message as Record<string, unknown>
    );
    const appends = messages.filter(message => message.action === 'appendStagedArchiveArtifact');

    expect(artifact).toMatchObject({
      transport: 'staged',
      stageId,
      kind: 'canonical',
      byteLength: bytes.byteLength,
    });
    expect(appends).toHaveLength(Math.ceil(bytes.byteLength / ARCHIVE_STAGE_CHUNK_BYTES));
    expect(
      appends.every(
        message =>
          canonicalBase64ByteLength(message.chunkBase64 as string)! <= ARCHIVE_STAGE_CHUNK_BYTES
      )
    ).toBe(true);
    expect(messages.every(message => !Object.hasOwn(message, 'bodyBase64'))).toBe(true);
  });

  it('aborts exactly the begun stage when an append fails and does not seal it', async () => {
    const bytes = new Uint8Array(ARCHIVE_STAGE_CHUNK_BYTES + 1);
    let appendCount = 0;
    mocks.sendMessage.mockImplementation((message: { action: string }) => {
      if (message.action === 'beginStagedArchiveArtifact') {
        return Promise.resolve({ success: true, stageId });
      }
      if (message.action === 'appendStagedArchiveArtifact') {
        appendCount += 1;
        return Promise.resolve({ success: appendCount !== 2 });
      }
      return Promise.resolve({ success: true });
    });

    await expect(stageArchiveArtifactBytes('canonical', bytes)).rejects.toThrow(
      'archive-stage-append-failed'
    );

    expect(
      mocks.sendMessage.mock.calls.map(([message]) => (message as { action: string }).action)
    ).toEqual([
      'beginStagedArchiveArtifact',
      'appendStagedArchiveArtifact',
      'appendStagedArchiveArtifact',
      'abortStagedArchiveArtifact',
    ]);
    expect(mocks.sendMessage).toHaveBeenLastCalledWith({
      action: 'abortStagedArchiveArtifact',
      source: 'chatgpt',
      stageId,
    });
  });

  it('reads chunks in order and independently verifies the staged SHA-256', async () => {
    const bytes = new Uint8Array(ARCHIVE_STAGE_CHUNK_BYTES + 3);
    // UTF-8 for the fox emoji deliberately crosses the raw chunk boundary.
    bytes[ARCHIVE_STAGE_CHUNK_BYTES - 1] = 0xf0;
    bytes.set([0x9f, 0xa6, 0x8a], ARCHIVE_STAGE_CHUNK_BYTES);
    const descriptor = await descriptorFor(bytes);
    const artifact: StagedArchiveCompanionArtifact = {
      transport: 'staged',
      stageId,
      ...descriptor,
    };
    mocks.sendMessage.mockImplementation(
      (message: { action: string; offset?: number; byteLength?: number }) => {
        if (message.action !== 'readStagedArchiveArtifact') return Promise.resolve(undefined);
        const offset = message.offset ?? 0;
        const byteLength = message.byteLength ?? 0;
        return Promise.resolve({
          success: true,
          data: {
            stageId,
            offset,
            byteLength,
            chunkBase64: bytesToBase64(bytes.subarray(offset, offset + byteLength)),
          },
        });
      }
    );

    await expect(readStagedArchiveArtifactBytes(artifact)).resolves.toEqual(bytes);
    const reads = mocks.sendMessage.mock.calls.map(
      ([message]) => message as Record<string, unknown>
    );
    expect(reads.map(message => message.offset)).toEqual([0, ARCHIVE_STAGE_CHUNK_BYTES]);
    reads.forEach(expectBoundedRuntimeMessage);
  });

  it('fails closed for malformed read offsets and a digest mismatch', async () => {
    const bytes = new Uint8Array([5, 6]);
    const descriptor = await descriptorFor(bytes);
    const artifact: StagedArchiveCompanionArtifact = {
      transport: 'staged',
      stageId,
      ...descriptor,
    };
    mocks.sendMessage.mockResolvedValueOnce({
      success: true,
      data: {
        stageId,
        offset: 1,
        byteLength: 2,
        chunkBase64: bytesToBase64(bytes),
      },
    });

    await expect(readStagedArchiveArtifactBytes(artifact)).rejects.toThrow(
      'archive-stage-read-failed'
    );

    mocks.sendMessage.mockImplementation((message: { offset: number; byteLength: number }) =>
      Promise.resolve({
        success: true,
        data: {
          stageId,
          offset: message.offset,
          byteLength: message.byteLength,
          chunkBase64: bytesToBase64(
            bytes.subarray(message.offset, message.offset + message.byteLength)
          ),
        },
      })
    );
    await expect(
      readStagedArchiveArtifactBytes({ ...artifact, sha256: 'f'.repeat(64) })
    ).rejects.toThrow('archive-stage-integrity-failed');
  });
});
