import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARCHIVE_STAGE_MAX_BYTES,
  ARCHIVE_STAGE_RELATIVE_PATHS,
  type ArchiveStageDescriptor,
} from '../../src/lib/archive-stage-contract';
import { bytesToBase64 } from '../../src/lib/image-utils';
import { sha256Hex } from '../../src/content/capture/response';
import type { StagedArchiveCompanionArtifact } from '../../src/lib/types';

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock('../../src/lib/messaging', () => ({
  sendMessage: (...args: unknown[]) => mocks.sendMessage(...args),
}));

import {
  abortStagedArchiveArtifact,
  readStagedArchiveArtifactBytes,
  stageArchiveArtifactBytes,
} from '../../src/content/archive-stage';

const stageId = `archive-stage-${'F'.repeat(32)}`;

async function descriptorFor(
  bytes: Uint8Array,
  kind: 'raw' | 'canonical' = 'raw'
): Promise<ArchiveStageDescriptor> {
  return {
    kind,
    mediaType: 'application/json',
    relativePath: ARCHIVE_STAGE_RELATIVE_PATHS[kind],
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  };
}

async function artifactFor(
  bytes: Uint8Array,
  overrides: Partial<StagedArchiveCompanionArtifact> = {}
): Promise<StagedArchiveCompanionArtifact> {
  return {
    transport: 'staged',
    stageId,
    ...(await descriptorFor(bytes)),
    ...overrides,
  };
}

function readResponse(
  bytes: Uint8Array,
  message: { stageId: string; offset: number; byteLength: number }
): Record<string, unknown> {
  return {
    success: true,
    data: {
      stageId: message.stageId,
      offset: message.offset,
      byteLength: message.byteLength,
      chunkBase64: bytesToBase64(
        bytes.subarray(message.offset, message.offset + message.byteLength)
      ),
    },
  };
}

describe('content archive-stage boundary coverage', () => {
  beforeEach(() => {
    mocks.sendMessage.mockReset();
  });

  it('rejects non-byte payloads and a forged over-cap typed-array view before hashing', async () => {
    await expect(stageArchiveArtifactBytes('raw', {} as Uint8Array)).rejects.toThrow(
      'archive-stage-payload-invalid'
    );

    const overCap = new Uint8Array();
    Object.defineProperty(overCap, 'byteLength', {
      configurable: true,
      value: ARCHIVE_STAGE_MAX_BYTES + 1,
    });
    await expect(stageArchiveArtifactBytes('raw', overCap)).rejects.toThrow(
      'archive-stage-payload-invalid'
    );
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('fails closed when Web Crypto is unavailable before opening a stage', async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', { subtle: undefined });
    try {
      await expect(stageArchiveArtifactBytes('raw', new Uint8Array([1]))).rejects.toThrow(
        'Web Crypto SHA-256 is unavailable'
      );
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal('crypto', originalCrypto);
    }
  });

  it('rejects a malformed digest before beginning a stage', async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      subtle: { digest: vi.fn().mockResolvedValue(new ArrayBuffer()) },
    });
    try {
      await expect(stageArchiveArtifactBytes('raw', new Uint8Array([1]))).rejects.toThrow(
        'archive-stage-descriptor-invalid'
      );
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal('crypto', originalCrypto);
    }
  });

  it('rejects a thrown or malformed begin response without attempting cleanup', async () => {
    const bytes = new Uint8Array([1]);
    const responses: unknown[] = [
      { success: true, stageId, extra: true },
      { success: true, stageId: 'not-safe' },
      { success: false },
      null,
    ];

    for (const response of responses) {
      mocks.sendMessage.mockResolvedValueOnce(response);
      await expect(stageArchiveArtifactBytes('raw', bytes)).rejects.toThrow(
        'archive-stage-begin-failed'
      );
    }

    mocks.sendMessage.mockRejectedValueOnce(new Error('begin transport failed'));
    await expect(stageArchiveArtifactBytes('raw', bytes)).rejects.toThrow('begin transport failed');
    expect(mocks.sendMessage.mock.calls).toHaveLength(responses.length + 1);
  });

  it('handles a zero-byte stage and keeps the terminal message bounded', async () => {
    mocks.sendMessage.mockImplementation((message: { action: string }) =>
      Promise.resolve(
        message.action === 'beginStagedArchiveArtifact'
          ? { success: true, stageId }
          : { success: true }
      )
    );

    await expect(stageArchiveArtifactBytes('canonical', new Uint8Array())).resolves.toMatchObject({
      transport: 'staged',
      stageId,
      kind: 'canonical',
      byteLength: 0,
    });
    expect(
      mocks.sendMessage.mock.calls.map(([message]) => (message as { action: string }).action)
    ).toEqual(['beginStagedArchiveArtifact', 'sealStagedArchiveArtifact']);
  });

  it('preserves seal failure when the compensating abort itself rejects', async () => {
    mocks.sendMessage.mockImplementation((message: { action: string }) => {
      if (message.action === 'beginStagedArchiveArtifact')
        return Promise.resolve({ success: true, stageId });
      if (message.action === 'sealStagedArchiveArtifact')
        return Promise.resolve({ success: false });
      if (message.action === 'abortStagedArchiveArtifact')
        return Promise.reject(new Error('abort failed'));
      return Promise.resolve({ success: true });
    });

    await expect(stageArchiveArtifactBytes('raw', new Uint8Array([8]))).rejects.toThrow(
      'archive-stage-seal-failed'
    );
    expect(
      mocks.sendMessage.mock.calls.map(([message]) => (message as { action: string }).action)
    ).toEqual([
      'beginStagedArchiveArtifact',
      'appendStagedArchiveArtifact',
      'sealStagedArchiveArtifact',
      'abortStagedArchiveArtifact',
    ]);
  });

  it('ignores invalid abort IDs and swallows transport errors for valid IDs', async () => {
    await expect(abortStagedArchiveArtifact('invalid')).resolves.toBeUndefined();
    expect(mocks.sendMessage).not.toHaveBeenCalled();

    mocks.sendMessage.mockRejectedValueOnce(new Error('worker unavailable'));
    await expect(abortStagedArchiveArtifact(stageId)).resolves.toBeUndefined();
  });

  it('rejects malformed read descriptors before allocating a result buffer', async () => {
    const artifact = await artifactFor(new Uint8Array([3]));

    await expect(
      readStagedArchiveArtifactBytes({ ...artifact, stageId: 'invalid' })
    ).rejects.toThrow('archive-stage-artifact-invalid');
    await expect(
      readStagedArchiveArtifactBytes({ ...artifact, mediaType: 'text/plain' as 'application/json' })
    ).rejects.toThrow('archive-stage-artifact-invalid');
    await expect(
      readStagedArchiveArtifactBytes({ ...artifact, byteLength: ARCHIVE_STAGE_MAX_BYTES + 1 })
    ).rejects.toThrow('archive-stage-artifact-invalid');
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects false, null-data, and extra-key read responses', async () => {
    const bytes = new Uint8Array([3]);
    const artifact = await artifactFor(bytes);

    mocks.sendMessage.mockResolvedValueOnce({ success: false });
    await expect(readStagedArchiveArtifactBytes(artifact)).rejects.toThrow(
      'archive-stage-read-failed'
    );

    mocks.sendMessage.mockResolvedValueOnce({ success: true, data: null });
    await expect(readStagedArchiveArtifactBytes(artifact)).rejects.toThrow(
      'archive-stage-read-failed'
    );

    mocks.sendMessage.mockResolvedValueOnce({
      ...readResponse(bytes, { stageId, offset: 0, byteLength: 1 }),
      extra: true,
    });
    await expect(readStagedArchiveArtifactBytes(artifact)).rejects.toThrow(
      'archive-stage-read-failed'
    );

    mocks.sendMessage.mockResolvedValueOnce({
      success: true,
      data: {
        stageId,
        offset: 0,
        byteLength: 1,
        chunkBase64: 'AA==',
        extra: true,
      },
    });
    await expect(readStagedArchiveArtifactBytes(artifact)).rejects.toThrow(
      'archive-stage-read-failed'
    );
  });

  it('rejects non-canonical base64 and an unavailable decoder after response validation', async () => {
    const bytes = new Uint8Array([3]);
    const artifact = await artifactFor(bytes);

    mocks.sendMessage.mockResolvedValueOnce({
      success: true,
      data: { stageId, offset: 0, byteLength: 1, chunkBase64: 'AB==' },
    });
    await expect(readStagedArchiveArtifactBytes(artifact)).rejects.toThrow(
      'archive-stage-read-failed'
    );

    const originalAtob = globalThis.atob;
    vi.stubGlobal('atob', undefined);
    try {
      mocks.sendMessage.mockResolvedValueOnce(
        readResponse(bytes, { stageId, offset: 0, byteLength: 1 })
      );
      await expect(readStagedArchiveArtifactBytes(artifact)).rejects.toThrow(
        'archive-stage-read-failed'
      );
    } finally {
      vi.stubGlobal('atob', originalAtob);
    }
  });

  it('propagates a hash failure after an otherwise valid bounded read', async () => {
    const bytes = new Uint8Array([4]);
    const artifact = await artifactFor(bytes);
    mocks.sendMessage.mockResolvedValueOnce(
      readResponse(bytes, { stageId, offset: 0, byteLength: 1 })
    );

    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      subtle: { digest: vi.fn().mockRejectedValue(new Error('hash failure')) },
    });
    try {
      await expect(readStagedArchiveArtifactBytes(artifact)).rejects.toThrow('hash failure');
    } finally {
      vi.stubGlobal('crypto', originalCrypto);
    }
  });
});
