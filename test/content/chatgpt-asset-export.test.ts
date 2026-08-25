import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildCaptureManifest, type RawCaptureAssetRecord } from '../../src/archive';
import {
  CHATGPT_ASSET_DESTINATION_WRITE_FAILED_DETAIL,
  persistChatGptDestinationHonestAttachments,
  validateChatGptAssetExportBinding,
  type ChatGptAssetExportDependencies,
} from '../../src/content/chatgpt-asset-export';
import type {
  ArchiveCompanionBundle,
  ChatGptAssetExportContext,
  StagedBinaryAssetResult,
} from '../../src/lib/types';

const CONVERSATION_ID = '11111111-2222-4333-8444-555555555555';
const CAPTURE_ID = 'capture-chatgpt-11111111-2222-4333-8444-555555555555';
const ASSET_ID = `chatgpt-asset-${'a'.repeat(64)}`;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function originalAsset(): RawCaptureAssetRecord {
  return {
    id: ASSET_ID,
    state: 'not-attempted',
    attemptedAt: null,
    relativePath: null,
    mediaType: 'image/png',
    byteLength: null,
    sha256: null,
    detail: 'raw-inventory-not-attempted',
    sourceRefs: [{ artifactId: 'conversation', rawPointer: '/asset' }],
  };
}

function context(includeAsset = true): ChatGptAssetExportContext {
  const bytes = new TextEncoder().encode('{}');
  const manifest = buildCaptureManifest({
    captureId: CAPTURE_ID,
    provider: 'chatgpt',
    conversationId: CONVERSATION_ID,
    capturedAt: '2026-08-21T12:00:00.000Z',
    method: 'same-origin-api',
    artifacts: [
      {
        id: 'conversation',
        relativePath: 'responses/conversation.json',
        mediaType: 'application/json',
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
        endpoint: { method: 'GET', pathPattern: '/backend-api/conversation/{conversationId}' },
      },
    ],
    assets: includeAsset ? [originalAsset()] : [],
    completeness: {
      graph: 'complete',
      messages: 'complete',
      branches: 'complete',
      assets: 'not-attempted',
    },
  });
  return {
    conversationId: CONVERSATION_ID,
    rawCaptureBundle: {
      manifest,
      artifacts: [{ record: manifest.artifacts[0], bytes }],
      assets: [],
    },
    rawBodyBase64: 'e30=',
  };
}

function companion(): ArchiveCompanionBundle {
  return {
    captureId: CAPTURE_ID,
    conversationKey: sha256(new TextEncoder().encode(CONVERSATION_ID)),
    artifacts: [
      {
        kind: 'raw',
        relativePath: 'responses/conversation.json',
        mediaType: 'application/json',
        byteLength: 2,
        sha256: sha256(new TextEncoder().encode('{}')),
        bodyBase64: 'e30=',
      },
      {
        kind: 'manifest',
        relativePath: 'manifest.json',
        mediaType: 'application/json',
        byteLength: 2,
        sha256: 'c'.repeat(64),
        bodyBase64: 'e30=',
      },
      {
        kind: 'canonical',
        relativePath: 'canonical/liska-thread-1.json',
        mediaType: 'application/json',
        byteLength: 2,
        sha256: 'd'.repeat(64),
        bodyBase64: 'e30=',
      },
    ],
  };
}

function persisted(outputs: ('file' | 'obsidian')[]): {
  activeOutputs: ('file' | 'obsidian')[];
  warnings: string[];
} {
  return { activeOutputs: outputs, warnings: [] };
}

function fetchedAsset(): { record: RawCaptureAssetRecord; bytes: Uint8Array } {
  const bytes = new Uint8Array([1, 2, 3]);
  const digest = sha256(bytes);
  return {
    record: {
      ...originalAsset(),
      state: 'fetched',
      attemptedAt: '2026-08-21T12:01:00.000Z',
      relativePath: `assets/${digest}.png`,
      byteLength: bytes.byteLength,
      sha256: digest,
      detail: 'page-owned-signed-response',
    },
    bytes,
  };
}

function binaryResult(
  record: RawCaptureAssetRecord,
  file: boolean,
  obsidian: boolean
): StagedBinaryAssetResult[] {
  if (
    record.relativePath === null ||
    record.sha256 === null ||
    record.byteLength === null ||
    record.mediaType === null
  ) {
    throw new Error('test binary result requires a fetched record');
  }
  return [
    {
      assetId: ASSET_ID,
      descriptor: {
        assetId: record.id,
        relativePath: record.relativePath,
        sha256: record.sha256,
        byteLength: record.byteLength,
        mediaType: record.mediaType,
      },
      results: [
        { destination: 'file', success: file },
        { destination: 'obsidian', success: obsidian },
      ],
      allSuccessful: file && obsidian,
    },
  ];
}

describe('destination-honest ChatGPT attachment export', () => {
  it('finalizes probe-only active metrics without acquisition, binary staging, or fetched ledger state', async () => {
    const persistArtifacts = vi.fn().mockResolvedValue(persisted(['file']));
    const acquireAssets = vi.fn();
    const persistBinaryAssets = vi.fn();
    const result = await persistChatGptDestinationHonestAttachments(
      context(),
      companion(),
      'thread.md',
      ['file'],
      {
        persistArtifacts,
        observeResolvers: vi.fn().mockResolvedValue({
          kind: 'probe-only',
          metric: {
            requestedCount: 1,
            dispatchCount: 1,
            observedCount: 1,
            outcomeCounts: {
              observed: 1,
              'http-error': 0,
              rejected: 0,
              'non-json': 0,
              oversized: 0,
              'timed-out': 0,
              'not-dispatched': 0,
            },
            failureCode: null,
          },
          warning: 'ChatGPT active resolver observed 1/1; binary acquisition remains disabled.',
        }),
        acquireAssets,
        persistBinaryAssets,
        buildDestinationCompanion: vi.fn(async (_context, records, _runtimeAssets, metric) => {
          expect(records.every(record => record.state === 'not-attempted')).toBe(true);
          expect(metric).toEqual({
            requestedCount: 1,
            dispatchCount: 1,
            observedCount: 1,
            outcomeCounts: {
              observed: 1,
              'http-error': 0,
              rejected: 0,
              'non-json': 0,
              oversized: 0,
              'timed-out': 0,
              'not-dispatched': 0,
            },
            failureCode: null,
          });
          return companion();
        }),
      }
    );
    expect(acquireAssets).not.toHaveBeenCalled();
    expect(persistBinaryAssets).not.toHaveBeenCalled();
    expect(persistArtifacts).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'thread.md',
      'chatgpt',
      ['file'],
      ['raw']
    );
    expect(result).toEqual({
      rawSuccessfulDestinations: ['file'],
      completeDestinations: ['file'],
      warnings: ['ChatGPT active resolver observed 1/1; binary acquisition remains disabled.'],
    });
  });

  it('fails closed before raw persistence when the companion is not the exact original capture', async () => {
    const persistArtifacts = vi.fn();
    const observeResolvers = vi.fn();
    const acquireAssets = vi.fn();
    const persistBinaryAssets = vi.fn();
    const invalidCompanion: ArchiveCompanionBundle = {
      ...companion(),
      captureId: 'capture-chatgpt-different-capture',
    };

    const result = await persistChatGptDestinationHonestAttachments(
      context(),
      invalidCompanion,
      'note.md',
      ['file'],
      { persistArtifacts, observeResolvers, acquireAssets, persistBinaryAssets }
    );

    expect(result).toEqual({
      rawSuccessfulDestinations: [],
      completeDestinations: [],
      warnings: [
        'ChatGPT attachment export could not verify the original capture; attachments were not exported.',
      ],
    });
    expect(persistArtifacts).not.toHaveBeenCalled();
    expect(observeResolvers).not.toHaveBeenCalled();
    expect(acquireAssets).not.toHaveBeenCalled();
    expect(persistBinaryAssets).not.toHaveBeenCalled();
  });

  it('fails closed when the runtime raw body is no longer its declared original capture', async () => {
    const corruptedContext = { ...context(), rawBodyBase64: 'bm90LXRoZS1vcmlnaW5hbA==' };

    await expect(validateChatGptAssetExportBinding(corruptedContext, companion())).resolves.toBe(
      false
    );
  });

  it('does not start private attachment work for Clipboard-only export', async () => {
    const persistArtifacts = vi.fn();

    await expect(
      persistChatGptDestinationHonestAttachments(context(), companion(), 'note.md', ['clipboard'], {
        persistArtifacts,
      })
    ).resolves.toEqual({
      rawSuccessfulDestinations: [],
      completeDestinations: [],
      warnings: [],
    });
    expect(persistArtifacts).not.toHaveBeenCalled();
  });

  it('does not observe or finalize when original raw persistence throws or has no durable success', async () => {
    const observeResolvers = vi.fn();
    const buildDestinationCompanion = vi.fn();
    const throwing = await persistChatGptDestinationHonestAttachments(
      context(),
      companion(),
      'note.md',
      ['file'],
      {
        persistArtifacts: async () => {
          throw new Error('raw write unavailable');
        },
        observeResolvers,
        buildDestinationCompanion,
      }
    );
    const noDestination = await persistChatGptDestinationHonestAttachments(
      context(),
      companion(),
      'note.md',
      ['file'],
      {
        persistArtifacts: async () => ({ activeOutputs: [], warnings: ['file unavailable'] }),
        observeResolvers,
        buildDestinationCompanion,
      }
    );

    expect(throwing).toMatchObject({ completeDestinations: [] });
    expect(throwing.warnings).toEqual([
      'ChatGPT original raw archive companion could not be saved.',
    ]);
    expect(noDestination).toEqual({
      rawSuccessfulDestinations: [],
      completeDestinations: [],
      warnings: ['file unavailable'],
    });
    expect(observeResolvers).not.toHaveBeenCalled();
    expect(buildDestinationCompanion).not.toHaveBeenCalled();
  });

  it('does not recapture or stage binaries when the original ledger has no assets', async () => {
    const persistArtifacts = vi
      .fn()
      .mockImplementation(async (_companion, _name, _source, outputs: ('file' | 'obsidian')[]) =>
        persisted(outputs)
      );
    const observeResolvers = vi.fn();
    const acquireAssets = vi.fn();
    const persistBinaryAssets = vi.fn();
    const buildDestinationCompanion = vi.fn().mockResolvedValue(companion());

    const result = await persistChatGptDestinationHonestAttachments(
      context(false),
      companion(),
      'note.md',
      ['file'],
      {
        persistArtifacts,
        observeResolvers,
        acquireAssets,
        persistBinaryAssets,
        buildDestinationCompanion,
      }
    );

    expect(observeResolvers).not.toHaveBeenCalled();
    expect(acquireAssets).not.toHaveBeenCalled();
    expect(persistBinaryAssets).not.toHaveBeenCalled();
    expect(buildDestinationCompanion).toHaveBeenCalledOnce();
    expect(result.completeDestinations).toEqual(['file']);
  });

  it('acquires once and makes each destination manifest reflect only its verified binary write', async () => {
    const signedSentinel = 'signed-url-must-not-persist';
    const asset = fetchedAsset();
    const persistArtifacts = vi
      .fn()
      .mockImplementation(async (_companion, _name, _source, outputs: ('file' | 'obsidian')[]) =>
        persisted(outputs)
      );
    const observeResolvers = vi.fn().mockResolvedValue({
      kind: 'matched',
      candidates: [{ assetId: ASSET_ID, downloadUrl: signedSentinel }],
    });
    const acquireAssets = vi.fn().mockResolvedValue({
      records: [asset.record],
      runtimeAssets: [asset],
      completeness: 'complete',
    });
    const persistBinaryAssets = vi.fn().mockResolvedValue(binaryResult(asset.record, true, false));
    const buildDestinationCompanion = vi.fn().mockResolvedValue(companion());
    const dependencies: ChatGptAssetExportDependencies = {
      persistArtifacts,
      observeResolvers,
      acquireAssets,
      persistBinaryAssets,
      buildDestinationCompanion,
    };

    const result = await persistChatGptDestinationHonestAttachments(
      context(),
      companion(),
      'note.md',
      ['file', 'obsidian', 'clipboard'],
      dependencies
    );

    expect(observeResolvers).toHaveBeenCalledOnce();
    expect(acquireAssets).toHaveBeenCalledOnce();
    expect(persistBinaryAssets).toHaveBeenCalledOnce();
    expect(persistBinaryAssets.mock.calls[0]?.[0].outputs).toEqual(['file', 'obsidian']);
    expect(buildDestinationCompanion).toHaveBeenCalledTimes(2);
    const fileRecords = buildDestinationCompanion.mock.calls[0]?.[1] as RawCaptureAssetRecord[];
    const obsidianRecords = buildDestinationCompanion.mock.calls[1]?.[1] as RawCaptureAssetRecord[];
    expect(fileRecords[0]).toMatchObject({
      state: 'fetched',
      relativePath: asset.record.relativePath,
    });
    expect(obsidianRecords[0]).toMatchObject({
      state: 'failed',
      attemptedAt: asset.record.attemptedAt,
      relativePath: null,
      byteLength: null,
      sha256: null,
      detail: CHATGPT_ASSET_DESTINATION_WRITE_FAILED_DETAIL,
      mediaType: 'image/png',
    });
    expect(result.completeDestinations).toEqual(['file', 'obsidian']);
    expect(JSON.stringify(persistArtifacts.mock.calls)).not.toContain(signedSentinel);
  });

  it('skips recapture and binary staging for a raw-failed destination while another proceeds', async () => {
    const asset = fetchedAsset();
    const persistArtifacts = vi
      .fn()
      .mockImplementation(
        async (_companion, _name, _source, outputs: ('file' | 'obsidian')[], kinds: string[]) =>
          kinds[0] === 'raw' ? persisted(['file']) : persisted(outputs)
      );
    const observeResolvers = vi.fn().mockResolvedValue({ kind: 'matched', candidates: [] });
    const acquireAssets = vi.fn().mockResolvedValue({
      records: [asset.record],
      runtimeAssets: [asset],
      completeness: 'complete',
    });
    const persistBinaryAssets = vi.fn().mockResolvedValue(binaryResult(asset.record, true, true));
    const buildDestinationCompanion = vi.fn().mockResolvedValue(companion());

    const result = await persistChatGptDestinationHonestAttachments(
      context(),
      companion(),
      'note.md',
      ['file', 'obsidian'],
      {
        persistArtifacts,
        observeResolvers,
        acquireAssets,
        persistBinaryAssets,
        buildDestinationCompanion,
      }
    );

    expect(persistBinaryAssets.mock.calls[0]?.[0].outputs).toEqual(['file']);
    expect(buildDestinationCompanion).toHaveBeenCalledTimes(1);
    expect(result.rawSuccessfulDestinations).toEqual(['file']);
    expect(result.completeDestinations).toEqual(['file']);
  });

  it('finalizes original not-attempted records after a resolver mismatch without fetching bytes', async () => {
    const persistArtifacts = vi
      .fn()
      .mockImplementation(async (_companion, _name, _source, outputs: ('file' | 'obsidian')[]) =>
        persisted(outputs)
      );
    const observeResolvers = vi.fn().mockResolvedValue({
      kind: 'recapture-mismatch',
      warning:
        'ChatGPT attachment resolver recapture did not match the original capture; attachments were not attempted.',
    });
    const acquireAssets = vi.fn();
    const persistBinaryAssets = vi.fn();
    const buildDestinationCompanion = vi.fn().mockResolvedValue(companion());

    const result = await persistChatGptDestinationHonestAttachments(
      context(),
      companion(),
      'note.md',
      ['file', 'obsidian'],
      {
        persistArtifacts,
        observeResolvers,
        acquireAssets,
        persistBinaryAssets,
        buildDestinationCompanion,
      }
    );

    expect(acquireAssets).not.toHaveBeenCalled();
    expect(persistBinaryAssets).not.toHaveBeenCalled();
    expect(
      buildDestinationCompanion.mock.calls.every(call => call[1][0].state === 'not-attempted')
    ).toBe(true);
    expect(result.completeDestinations).toEqual(['file', 'obsidian']);
    expect(result.warnings).toContain(
      'ChatGPT attachment resolver recapture did not match the original capture; attachments were not attempted.'
    );
    expect(result.warnings).toContain(
      'Some ChatGPT attachments were not resolved during this export attempt; the archive manifest records them as not attempted.'
    );
  });

  it('retains a failed acquisition record and does not claim binary output', async () => {
    const failed: RawCaptureAssetRecord = {
      ...originalAsset(),
      state: 'failed',
      attemptedAt: '2026-08-21T12:01:00.000Z',
      detail: 'page-owned-fetch-failed',
    };
    const persistArtifacts = vi
      .fn()
      .mockImplementation(async (_companion, _name, _source, outputs: ('file' | 'obsidian')[]) =>
        persisted(outputs)
      );
    const persistBinaryAssets = vi.fn();
    const buildDestinationCompanion = vi.fn().mockResolvedValue(companion());

    await persistChatGptDestinationHonestAttachments(context(), companion(), 'note.md', ['file'], {
      persistArtifacts,
      observeResolvers: async () => ({ kind: 'matched', candidates: [] }),
      acquireAssets: async () => ({
        records: [failed],
        runtimeAssets: [],
        completeness: 'complete',
      }),
      persistBinaryAssets,
      buildDestinationCompanion,
    });

    expect(persistBinaryAssets).not.toHaveBeenCalled();
    expect(buildDestinationCompanion.mock.calls[0]?.[1][0]).toMatchObject({
      state: 'failed',
      attemptedAt: failed.attemptedAt,
      relativePath: null,
      sha256: null,
    });
  });

  it('turns observer and acquisition exceptions into not-attempted destination records', async () => {
    const persistArtifacts = vi
      .fn()
      .mockImplementation(async (_companion, _name, _source, outputs: ('file' | 'obsidian')[]) =>
        persisted(outputs)
      );
    const buildDestinationCompanion = vi.fn().mockResolvedValue(companion());
    const observerFailure = await persistChatGptDestinationHonestAttachments(
      context(),
      companion(),
      'note.md',
      ['file'],
      {
        persistArtifacts,
        observeResolvers: async () => {
          throw new Error('recapture unavailable');
        },
        buildDestinationCompanion,
      }
    );
    const acquisitionFailure = await persistChatGptDestinationHonestAttachments(
      context(),
      companion(),
      'note.md',
      ['file'],
      {
        persistArtifacts,
        observeResolvers: async () => ({ kind: 'matched', candidates: [] }),
        acquireAssets: async () => {
          throw new Error('fetch unavailable');
        },
        buildDestinationCompanion,
      }
    );

    expect(observerFailure.warnings).toContain(
      'ChatGPT attachment resolver recapture failed; attachments were not attempted.'
    );
    expect(acquisitionFailure.warnings).toContain(
      'ChatGPT attachment acquisition failed; attachments were not attempted.'
    );
    expect(
      buildDestinationCompanion.mock.calls.every(call => call[1][0].state === 'not-attempted')
    ).toBe(true);
  });

  it('retains an honest failed record when binary staging or destination finalization throws', async () => {
    const asset = fetchedAsset();
    const persistArtifacts = vi
      .fn()
      .mockImplementation(async (_companion, _name, _source, outputs: ('file' | 'obsidian')[]) =>
        persisted(outputs)
      );
    const binaryFailureBuilder = vi.fn().mockResolvedValue(companion());
    const binaryFailure = await persistChatGptDestinationHonestAttachments(
      context(),
      companion(),
      'note.md',
      ['file'],
      {
        persistArtifacts,
        observeResolvers: async () => ({ kind: 'matched', candidates: [] }),
        acquireAssets: async () => ({
          records: [asset.record],
          runtimeAssets: [asset],
          completeness: 'complete',
        }),
        persistBinaryAssets: async () => {
          throw new Error('stage unavailable');
        },
        buildDestinationCompanion: binaryFailureBuilder,
      }
    );
    const finalizationFailure = await persistChatGptDestinationHonestAttachments(
      context(false),
      companion(),
      'note.md',
      ['file'],
      {
        persistArtifacts,
        buildDestinationCompanion: async () => {
          throw new Error('normalization unavailable');
        },
      }
    );

    expect(binaryFailureBuilder.mock.calls[0]?.[1][0]).toMatchObject({
      state: 'failed',
      relativePath: null,
      sha256: null,
      byteLength: null,
    });
    expect(binaryFailure.warnings).toContain(
      'One or more ChatGPT attachments were not saved to file; the archive manifest records them as failed.'
    );
    expect(finalizationFailure.completeDestinations).toEqual([]);
    expect(finalizationFailure.warnings).toContain(
      'ChatGPT attachment archive finalization failed; the original raw capture remains available.'
    );
  });

  it.each([
    ['a missing descriptor', undefined],
    [
      'a mismatched descriptor',
      {
        assetId: ASSET_ID,
        relativePath: 'assets/not-the-verified-path.png',
        sha256: 'f'.repeat(64),
        byteLength: 99,
        mediaType: 'image/jpeg',
      },
    ],
  ])('does not claim a fetched asset after %s', async (_label, descriptor) => {
    const asset = fetchedAsset();
    const persistArtifacts = vi
      .fn()
      .mockImplementation(async (_companion, _name, _source, outputs: ('file' | 'obsidian')[]) =>
        persisted(outputs)
      );
    const buildDestinationCompanion = vi.fn().mockResolvedValue(companion());

    await persistChatGptDestinationHonestAttachments(context(), companion(), 'note.md', ['file'], {
      persistArtifacts,
      observeResolvers: async () => ({ kind: 'matched', candidates: [] }),
      acquireAssets: async () => ({
        records: [asset.record],
        runtimeAssets: [asset],
        completeness: 'complete',
      }),
      persistBinaryAssets: async () => [
        {
          assetId: ASSET_ID,
          ...(descriptor && { descriptor }),
          results: [{ destination: 'file', success: true }],
          allSuccessful: true,
        },
      ],
      buildDestinationCompanion,
    });

    expect(buildDestinationCompanion.mock.calls[0]?.[1][0]).toMatchObject({
      state: 'failed',
      attemptedAt: asset.record.attemptedAt,
      relativePath: null,
      byteLength: null,
      sha256: null,
      detail: CHATGPT_ASSET_DESTINATION_WRITE_FAILED_DETAIL,
    });
  });

  it('emits each safe acquisition warning once for failed and unresolved ledger records', async () => {
    const failed: RawCaptureAssetRecord = {
      ...originalAsset(),
      state: 'failed',
      attemptedAt: '2026-08-21T12:01:00.000Z',
      detail: 'page-owned-fetch-failed',
    };
    const unresolved: RawCaptureAssetRecord = {
      ...originalAsset(),
      id: `chatgpt-asset-${'b'.repeat(64)}`,
      sourceRefs: [{ artifactId: 'conversation', rawPointer: '/other-asset' }],
    };
    const persistArtifacts = vi
      .fn()
      .mockImplementation(async (_companion, _name, _source, outputs: ('file' | 'obsidian')[]) =>
        persisted(outputs)
      );

    const result = await persistChatGptDestinationHonestAttachments(
      context(),
      companion(),
      'note.md',
      ['file', 'obsidian'],
      {
        persistArtifacts,
        observeResolvers: async () => ({ kind: 'matched', candidates: [] }),
        acquireAssets: async () => ({
          records: [failed, unresolved],
          runtimeAssets: [],
          completeness: 'partial',
        }),
        buildDestinationCompanion: async () => companion(),
      }
    );

    expect(
      result.warnings.filter(warning => warning.includes('could not be fetched'))
    ).toHaveLength(1);
    expect(result.warnings.filter(warning => warning.includes('were not resolved'))).toHaveLength(
      1
    );
    expect(JSON.stringify(result.warnings)).not.toContain(ASSET_ID);
  });
});
