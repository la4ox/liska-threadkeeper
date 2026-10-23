import { describe, expect, it } from 'vitest';
import { buildChatGptDestinationArchiveReceipt } from '../../src/content/chatgpt-destination-receipt';
import { ARCHIVE_COMPANION_RELATIVE_PATHS, type ArchiveCompanionBundle } from '../../src/lib/types';

function companion(): ArchiveCompanionBundle {
  return {
    captureId: 'capture-chatgpt-finalized',
    conversationKey: 'a'.repeat(64),
    artifacts: [
      {
        transport: 'staged',
        kind: 'raw',
        relativePath: ARCHIVE_COMPANION_RELATIVE_PATHS.raw,
        mediaType: 'application/json',
        byteLength: 101,
        sha256: 'b'.repeat(64),
        stageId: 'raw-stage',
      },
      {
        transport: 'inline',
        kind: 'manifest',
        relativePath: ARCHIVE_COMPANION_RELATIVE_PATHS.manifest,
        mediaType: 'application/json',
        byteLength: 202,
        sha256: 'c'.repeat(64),
        bodyBase64: 'e30=',
      },
      {
        transport: 'staged',
        kind: 'canonical',
        relativePath: ARCHIVE_COMPANION_RELATIVE_PATHS.canonical,
        mediaType: 'application/json',
        byteLength: 303,
        sha256: 'd'.repeat(64),
        stageId: 'canonical-stage',
      },
    ],
  };
}

describe('buildChatGptDestinationArchiveReceipt finalized byte evidence', () => {
  it('takes the exact finalized trio lengths and manifest hash without aliases', () => {
    const input = companion();
    const receipt = buildChatGptDestinationArchiveReceipt(input, 'file', []);
    expect(receipt).toEqual({
      destination: 'file',
      captureId: input.captureId,
      conversationKey: input.conversationKey,
      manifestSha256: 'c'.repeat(64),
      archiveByteLengths: { raw: 101, manifest: 202, canonical: 303 },
      assets: [],
    });
    input.artifacts[1].byteLength = 999;
    input.artifacts[1].sha256 = 'e'.repeat(64);
    expect(receipt.archiveByteLengths.manifest).toBe(202);
    expect(receipt.manifestSha256).toBe('c'.repeat(64));
  });

  it.each(['raw', 'manifest', 'canonical'] as const)(
    'rejects missing/duplicate or invalid %s artifacts before making a receipt',
    kind => {
      for (const mutation of [
        'missing',
        'duplicate',
        'path',
        'media',
        'hash',
        'hash-type',
        'negative',
        'fractional',
        'unsafe',
        'infinite',
      ] as const) {
        const input = companion();
        const artifact = input.artifacts.find(artifact => artifact.kind === kind)!;
        if (mutation === 'missing') {
          input.artifacts = input.artifacts.filter(
            artifact => artifact.kind !== kind
          ) as unknown as ArchiveCompanionBundle['artifacts'];
        }
        if (mutation === 'duplicate') {
          input.artifacts = [artifact, artifact, artifact];
        }
        if (mutation === 'path') artifact.relativePath = 'other.json';
        if (mutation === 'media') Object.assign(artifact, { mediaType: 'text/plain' });
        if (mutation === 'hash') artifact.sha256 = 'invalid';
        if (mutation === 'hash-type') Object.assign(artifact, { sha256: 123 });
        if (mutation === 'negative') artifact.byteLength = -1;
        if (mutation === 'fractional') artifact.byteLength = 1.5;
        if (mutation === 'unsafe') artifact.byteLength = Number.MAX_SAFE_INTEGER + 1;
        if (mutation === 'infinite') artifact.byteLength = Infinity;
        expect(() => buildChatGptDestinationArchiveReceipt(input, 'file', [])).toThrow();
      }
    }
  );
});
