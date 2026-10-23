import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildCaptureManifest, type RawCaptureAssetRecord } from '../../src/archive';
import { chatGptActiveResolverMetricFromResponse } from '../../src/content/capture/chatgpt-active-resolver-audit';
import {
  CHATGPT_ASSET_ACQUISITION_FAILED_WARNING,
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
const ORDINARY_RAW_BYTES = new TextEncoder().encode('{"mapping":{}}');
const ORDINARY_RAW_BASE64 = Buffer.from(ORDINARY_RAW_BYTES).toString('base64');

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

function context(
  includeAsset = true,
  assetRecords?: RawCaptureAssetRecord[]
): ChatGptAssetExportContext {
  const bytes = ORDINARY_RAW_BYTES;
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
    assets: assetRecords ?? (includeAsset ? [originalAsset()] : []),
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
    rawArtifact: {
      transport: 'inline',
      kind: 'raw',
      relativePath: 'responses/conversation.json',
      mediaType: 'application/json',
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
      bodyBase64: ORDINARY_RAW_BASE64,
    },
  };
}

function companion(): ArchiveCompanionBundle {
  return {
    captureId: CAPTURE_ID,
    conversationKey: sha256(new TextEncoder().encode(CONVERSATION_ID)),
    artifacts: [
      {
        transport: 'inline',
        kind: 'raw',
        relativePath: 'responses/conversation.json',
        mediaType: 'application/json',
        byteLength: ORDINARY_RAW_BYTES.byteLength,
        sha256: sha256(ORDINARY_RAW_BYTES),
        bodyBase64: ORDINARY_RAW_BASE64,
      },
      {
        transport: 'inline',
        kind: 'manifest',
        relativePath: 'manifest.json',
        mediaType: 'application/json',
        byteLength: 2,
        sha256: 'c'.repeat(64),
        bodyBase64: 'e30=',
      },
      {
        transport: 'inline',
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
      assetId: record.id,
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
  it.each([false, true])(
    'runs interpreter acquisition, one opaque PNG metric probe, then passive observation (failure=%s), retaining the metric for both destinations',
    async passiveFails => {
      const a = originalAsset();
      const b = { ...originalAsset(), id: `chatgpt-asset-${'b'.repeat(64)}` };
      const interpreterAsset = {
        ...originalAsset(),
        id: `chatgpt-asset-${'0'.repeat(64)}`,
      };
      const exportContext = context(true, [b, interpreterAsset, a]);
      const order: string[] = [];
      const metric = chatGptActiveResolverMetricFromResponse(
        {
          success: true,
          data: {
            requestedCount: 1,
            dispatchCount: 1,
            observedCount: 0,
            outcomes: ['file-expired'],
            attemptedAt: '2026-10-21T12:00:00.000Z',
          },
        },
        1
      );
      const warning =
        'ChatGPT active resolver observed 0/1; file-ID binary acquisition remains disabled.';
      const observeActiveResolvers = vi.fn(async () => {
        order.push('active');
        return { kind: 'probe-only' as const, metric, warning };
      });
      const acquireAssets = vi.fn(async () => {
        order.push('acquire-interpreter');
        return {
          records: exportContext.rawCaptureBundle.manifest.assets,
          runtimeAssets: [],
          completeness: 'not-attempted' as const,
        };
      });
      const persistBinaryAssets = vi.fn();
      const buildDestinationCompanion = vi.fn(
        async (_context, records, runtimeAssets, retainedMetric) => {
          expect(retainedMetric).toEqual(metric);
          expect(records).toEqual(exportContext.rawCaptureBundle.manifest.assets);
          expect(runtimeAssets).toEqual([]);
          return companion();
        }
      );
      const result = await persistChatGptDestinationHonestAttachments(
        exportContext,
        companion(),
        'thread.md',
        ['file', 'obsidian'],
        {
          persistArtifacts: async (_companion, _name, _source, outputs) => {
            if (!order.length) order.push('raw');
            return persisted(outputs as ('file' | 'obsidian')[]);
          },
          observeInterpreterResolvers: async () => {
            order.push('interpreter');
            return {
              kind: 'matched',
              candidates: [
                { assetId: interpreterAsset.id, downloadUrl: 'synthetic-interpreter-url' },
              ],
            };
          },
          observeResolvers: async () => {
            order.push('passive');
            if (passiveFails)
              return {
                kind: 'recapture-failed',
                warning:
                  'ChatGPT legacy attachment resolver recapture failed; final attachment states are recorded in the archive manifest.',
              };
            return { kind: 'matched', candidates: [] };
          },
          observeActiveResolvers,
          acquireAssets,
          persistBinaryAssets,
          buildDestinationCompanion,
        }
      );
      expect(order).toEqual(['raw', 'interpreter', 'acquire-interpreter', 'active', 'passive']);
      expect(observeActiveResolvers).toHaveBeenCalledExactlyOnceWith(exportContext, [a.id]);
      expect(acquireAssets).toHaveBeenCalledOnce();
      expect(persistBinaryAssets).not.toHaveBeenCalled();
      expect(buildDestinationCompanion).toHaveBeenCalledTimes(2);
      expect(result.completeDestinations).toEqual(['file', 'obsidian']);
      expect(result.warnings).toContain(warning);
    }
  );

  it.each(['non-PNG', 'already attempted', 'no strict dependency'])(
    'does not invoke the active probe with %s',
    async scenario => {
      const asset = {
        ...originalAsset(),
        ...(scenario === 'non-PNG' ? { mediaType: 'application/pdf' } : {}),
        ...(scenario === 'already attempted'
          ? {
              state: 'failed' as const,
              attemptedAt: '2026-10-21T12:00:00.000Z',
              detail: 'synthetic-failed',
            }
          : {}),
      };
      const exportContext = context(true, [asset]);
      const observeActiveResolvers = vi.fn();
      await persistChatGptDestinationHonestAttachments(
        exportContext,
        companion(),
        'thread.md',
        ['file'],
        {
          persistArtifacts: async () => persisted(['file']),
          observeResolvers: async () => ({ kind: 'matched', candidates: [] }),
          ...(scenario === 'no strict dependency' ? {} : { observeActiveResolvers }),
          acquireAssets: async () => ({
            records: [asset],
            runtimeAssets: [],
            completeness: 'not-attempted',
          }),
          buildDestinationCompanion: async () => companion(),
        }
      );
      expect(observeActiveResolvers).not.toHaveBeenCalled();
    }
  );

  it.each(['metric', 'substituted candidates', 'failure', 'throw'])(
    'continues passive acquisition after an active %s result',
    async scenario => {
      const exportContext = context();
      const fetched = fetchedAsset();
      const order: string[] = [];
      const metric = chatGptActiveResolverMetricFromResponse(
        {
          success: true,
          data: {
            requestedCount: 1,
            dispatchCount: 1,
            observedCount: 0,
            outcomes: ['provider-status-other'],
            attemptedAt: '2026-10-21T12:00:00.000Z',
          },
        },
        1
      );
      const observeActiveResolvers = vi
        .fn<NonNullable<ChatGptAssetExportDependencies['observeActiveResolvers']>>()
        .mockImplementation(async () => {
          order.push('active');
          if (scenario === 'throw') throw new Error('synthetic-active-failure');
          if (scenario === 'substituted candidates')
            return {
              kind: 'matched',
              candidates: [{ assetId: ASSET_ID, downloadUrl: 'must-not-fetch-active' }],
            };
          if (scenario === 'failure')
            return {
              kind: 'recapture-failed',
              warning:
                'ChatGPT legacy attachment resolver recapture failed; final attachment states are recorded in the archive manifest.',
            };
          return {
            kind: 'probe-only',
            metric,
            warning:
              'ChatGPT active resolver observed 0/1; file-ID binary acquisition remains disabled.',
          };
        });
      const observeResolvers = vi.fn(async () => {
        order.push('passive');
        return {
          kind: 'matched' as const,
          candidates: [{ assetId: ASSET_ID, downloadUrl: 'synthetic-passive-url' }],
        };
      });
      const acquireAssets = vi
        .fn<NonNullable<ChatGptAssetExportDependencies['acquireAssets']>>()
        .mockImplementation(async () => {
          order.push('acquire-passive');
          return { records: [fetched.record], runtimeAssets: [fetched], completeness: 'complete' };
        });
      const persistBinaryAssets = vi
        .fn()
        .mockResolvedValue(binaryResult(fetched.record, true, false));
      const result = await persistChatGptDestinationHonestAttachments(
        exportContext,
        companion(),
        'thread.md',
        ['file'],
        {
          persistArtifacts: async () => persisted(['file']),
          observeActiveResolvers,
          observeResolvers,
          acquireAssets,
          persistBinaryAssets,
          buildDestinationCompanion: async () => companion(),
        }
      );
      expect(order).toEqual(['active', 'passive', 'acquire-passive']);
      expect(observeActiveResolvers).toHaveBeenCalledExactlyOnceWith(exportContext, [ASSET_ID]);
      expect(observeResolvers).toHaveBeenCalledExactlyOnceWith(exportContext, [ASSET_ID]);
      expect(acquireAssets).toHaveBeenCalledOnce();
      expect(acquireAssets).toHaveBeenCalledWith(
        expect.objectContaining({
          candidates: [{ assetId: ASSET_ID, downloadUrl: 'synthetic-passive-url' }],
        })
      );
      expect(persistBinaryAssets).toHaveBeenCalledOnce();
      expect(result.completeDestinations).toEqual(['file']);
    }
  );

  it('cannot turn a substituted active probe into acquisition or binary staging', async () => {
    const acquireAssets = vi.fn();
    const persistBinaryAssets = vi.fn();
    const observeActiveResolvers = vi.fn(async () => ({
      kind: 'matched' as const,
      candidates: [{ assetId: ASSET_ID, downloadUrl: 'must-not-fetch' }],
    }));
    await persistChatGptDestinationHonestAttachments(
      context(),
      companion(),
      'thread.md',
      ['file'],
      {
        persistArtifacts: async () => persisted(['file']),
        observeResolvers: async () => ({ kind: 'matched', candidates: [] }),
        observeActiveResolvers,
        acquireAssets,
        persistBinaryAssets,
        buildDestinationCompanion: async () => companion(),
      }
    );
    expect(observeActiveResolvers).toHaveBeenCalledOnce();
    expect(acquireAssets).not.toHaveBeenCalled();
    expect(persistBinaryAssets).not.toHaveBeenCalled();
  });

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
              'fetch-rejected': 0,
              'response-processing-rejected': 0,
              'payload-integrity-rejected': 0,
              'download-url-missing': 0,
              'download-url-binding-rejected': 0,
              'file-not-found': 0,
              'file-expired': 0,
              'provider-retry': 0,
              'success-without-download-url': 0,
              'provider-status-absent': 0,
              'provider-status-non-string': 0,
              'provider-status-other': 0,
              'non-json': 0,
              oversized: 0,
              'timed-out': 0,
              'not-dispatched': 0,
            },
            failureCode: null,
          },
          warning:
            'ChatGPT active resolver observed 1/1; file-ID binary acquisition remains disabled.',
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
              'fetch-rejected': 0,
              'response-processing-rejected': 0,
              'payload-integrity-rejected': 0,
              'download-url-missing': 0,
              'download-url-binding-rejected': 0,
              'file-not-found': 0,
              'file-expired': 0,
              'provider-retry': 0,
              'success-without-download-url': 0,
              'provider-status-absent': 0,
              'provider-status-non-string': 0,
              'provider-status-other': 0,
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
      warnings: [
        'ChatGPT active resolver observed 1/1; file-ID binary acquisition remains disabled.',
      ],
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
    const original = context();
    const corruptedContext = {
      ...original,
      rawArtifact: { ...original.rawArtifact, bodyBase64: 'bm90LXRoZS1vcmlnaW5hbA==' },
    };

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

  it('acquires interpreter assets before resolving and acquiring only remaining legacy IDs', async () => {
    const first = originalAsset();
    const second: RawCaptureAssetRecord = {
      ...originalAsset(),
      id: `chatgpt-asset-${'b'.repeat(64)}`,
      sourceRefs: [{ artifactId: 'conversation', rawPointer: '/second-asset' }],
    };
    const exportContext = context(true, [first, second]);
    const interpreterUrl = 'signed-interpreter-url';
    const legacyUrl = 'signed-legacy-url';
    const events: string[] = [];
    const persistArtifacts = vi.fn(
      async (_companion, _name, _source, outputs: ('file' | 'obsidian')[], kinds: string[]) => {
        events.push(kinds.join('+'));
        return persisted(outputs);
      }
    );
    const observeInterpreterResolvers = vi.fn(async () => {
      events.push('interpreter');
      return {
        kind: 'matched' as const,
        candidates: [{ assetId: first.id, downloadUrl: interpreterUrl }],
        warning:
          'ChatGPT interpreter attachment resolution was incomplete; final attachment states are recorded in the archive manifest.' as const,
      };
    });
    const observeResolvers = vi.fn(async () => {
      events.push('legacy');
      return {
        kind: 'matched' as const,
        candidates: [
          { assetId: first.id, downloadUrl: 'must-not-overwrite-interpreter' },
          { assetId: second.id, downloadUrl: legacyUrl },
        ],
      };
    });
    const acquireAssets = vi.fn(async () => {
      events.push('acquire');
      return {
        records: exportContext.rawCaptureBundle.manifest.assets.map(record => ({ ...record })),
        runtimeAssets: [],
        completeness: 'not-attempted' as const,
      };
    });

    const result = await persistChatGptDestinationHonestAttachments(
      exportContext,
      companion(),
      'note.md',
      ['file'],
      {
        persistArtifacts,
        observeInterpreterResolvers,
        observeResolvers,
        acquireAssets,
        buildDestinationCompanion: async () => companion(),
      }
    );

    expect(events.slice(0, 5)).toEqual(['raw', 'interpreter', 'acquire', 'legacy', 'acquire']);
    expect(observeInterpreterResolvers).toHaveBeenCalledOnce();
    expect(observeResolvers).toHaveBeenCalledOnce();
    expect(observeResolvers).toHaveBeenCalledWith(exportContext, [second.id]);
    expect(acquireAssets).toHaveBeenCalledTimes(2);
    expect(acquireAssets.mock.calls[0]?.[0].candidates).toEqual([
      { assetId: first.id, downloadUrl: interpreterUrl },
    ]);
    expect(acquireAssets.mock.calls[1]?.[0].candidates).toEqual([
      { assetId: second.id, downloadUrl: legacyUrl },
    ]);
    expect(acquireAssets.mock.calls[0]?.[0].budget).toBe(acquireAssets.mock.calls[1]?.[0].budget);
    expect(JSON.stringify(persistArtifacts.mock.calls)).not.toContain(interpreterUrl);
    expect(JSON.stringify(persistArtifacts.mock.calls)).not.toContain(legacyUrl);
    expect(result.warnings).toContain(
      'ChatGPT interpreter attachment resolution was incomplete; final attachment states are recorded in the archive manifest.'
    );
    expect(JSON.stringify(result.warnings)).not.toContain(
      'matching attachments remain not attempted'
    );
  });

  it('keeps partial acquisition warnings honest when interpreter acquisition throws and legacy succeeds', async () => {
    const first = originalAsset();
    const second: RawCaptureAssetRecord = {
      ...originalAsset(),
      id: `chatgpt-asset-${'b'.repeat(64)}`,
      sourceRefs: [{ artifactId: 'conversation', rawPointer: '/second-asset' }],
    };
    const bytes = new Uint8Array([4, 5, 6]);
    const digest = sha256(bytes);
    const fetchedSecond: RawCaptureAssetRecord = {
      ...second,
      state: 'fetched',
      attemptedAt: '2026-08-21T12:01:00.000Z',
      relativePath: `assets/${digest}.png`,
      byteLength: bytes.byteLength,
      sha256: digest,
      detail: 'page-owned-signed-response',
    };
    const exportContext = context(true, [first, second]);
    const acquireAssets = vi
      .fn()
      .mockRejectedValueOnce(new Error('interpreter fetch unavailable'))
      .mockResolvedValueOnce({
        records: [first, fetchedSecond],
        runtimeAssets: [{ record: fetchedSecond, bytes }],
        completeness: 'partial',
      });
    const buildDestinationCompanion = vi.fn().mockResolvedValue(companion());

    const result = await persistChatGptDestinationHonestAttachments(
      exportContext,
      companion(),
      'note.md',
      ['file'],
      {
        persistArtifacts: vi.fn().mockResolvedValue(persisted(['file'])),
        observeInterpreterResolvers: async () => ({
          kind: 'matched',
          candidates: [{ assetId: first.id, downloadUrl: 'signed-interpreter' }],
        }),
        observeResolvers: async () => ({
          kind: 'matched',
          candidates: [{ assetId: second.id, downloadUrl: 'signed-legacy' }],
        }),
        acquireAssets,
        persistBinaryAssets: async () => binaryResult(fetchedSecond, true, false),
        buildDestinationCompanion,
      }
    );

    expect(acquireAssets).toHaveBeenCalledTimes(2);
    expect(buildDestinationCompanion.mock.calls[0]?.[1].map(record => record.state)).toEqual([
      'not-attempted',
      'fetched',
    ]);
    expect(result.warnings).toContain(CHATGPT_ASSET_ACQUISITION_FAILED_WARNING);
    expect(result.warnings).toContain(
      'Some ChatGPT attachments were not resolved during this export attempt; the archive manifest records them as not attempted.'
    );
    expect(JSON.stringify(result.warnings)).not.toContain('attachments were not attempted');
    expect(result.completeDestinations).toEqual(['file']);
  });

  it('skips the legacy resolver when interpreter candidates cover the entire ledger', async () => {
    const asset = originalAsset();
    const observeResolvers = vi.fn();
    const acquireAssets = vi.fn().mockResolvedValue({
      records: [asset],
      runtimeAssets: [],
      completeness: 'not-attempted',
    });

    await persistChatGptDestinationHonestAttachments(context(), companion(), 'note.md', ['file'], {
      persistArtifacts: vi.fn().mockResolvedValue(persisted(['file'])),
      observeInterpreterResolvers: async () => ({
        kind: 'matched',
        candidates: [{ assetId: asset.id, downloadUrl: 'signed-interpreter-only' }],
      }),
      observeResolvers,
      acquireAssets,
      buildDestinationCompanion: async () => companion(),
    });

    expect(observeResolvers).not.toHaveBeenCalled();
    expect(acquireAssets).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'failed',
      {
        kind: 'recapture-failed' as const,
        warning:
          'ChatGPT legacy attachment resolver recapture failed; final attachment states are recorded in the archive manifest.' as const,
      },
    ],
    [
      'mismatched',
      {
        kind: 'recapture-mismatch' as const,
        warning:
          'ChatGPT legacy attachment resolver recapture did not match the original capture; final attachment states are recorded in the archive manifest.' as const,
      },
    ],
  ])(
    'keeps interpreter candidates attemptable when the remaining legacy recapture is %s',
    async (_label, legacyObservation) => {
      const first = originalAsset();
      const second: RawCaptureAssetRecord = {
        ...originalAsset(),
        id: `chatgpt-asset-${'b'.repeat(64)}`,
        sourceRefs: [{ artifactId: 'conversation', rawPointer: '/second-asset' }],
      };
      const exportContext = context(true, [first, second]);
      const acquireAssets = vi.fn().mockResolvedValue({
        records: [first, second],
        runtimeAssets: [],
        completeness: 'not-attempted',
      });

      const result = await persistChatGptDestinationHonestAttachments(
        exportContext,
        companion(),
        'note.md',
        ['file'],
        {
          persistArtifacts: vi.fn().mockResolvedValue(persisted(['file'])),
          observeInterpreterResolvers: async () => ({
            kind: 'matched',
            candidates: [{ assetId: first.id, downloadUrl: 'signed-interpreter-candidate' }],
          }),
          observeResolvers: async () => legacyObservation,
          acquireAssets,
          buildDestinationCompanion: async () => companion(),
        }
      );

      expect(acquireAssets).toHaveBeenCalledWith(
        expect.objectContaining({
          candidates: [{ assetId: first.id, downloadUrl: 'signed-interpreter-candidate' }],
        })
      );
      expect(result.warnings).toContain(legacyObservation.warning);
      expect(JSON.stringify(result.warnings)).not.toContain('attachments were not attempted');
    }
  );

  it('skips recapture and binary staging for a raw-failed destination while another proceeds', async () => {
    const asset = fetchedAsset();
    const persistArtifacts = vi
      .fn()
      .mockImplementation(
        async (_companion, _name, _source, outputs: ('file' | 'obsidian')[], kinds: string[]) =>
          kinds[0] === 'raw' ? persisted(['file']) : persisted(outputs)
      );
    const observeResolvers = vi.fn().mockResolvedValue({
      kind: 'matched',
      candidates: [{ assetId: asset.record.id, downloadUrl: 'signed-asset' }],
    });
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
        'ChatGPT legacy attachment resolver recapture did not match the original capture; final attachment states are recorded in the archive manifest.',
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
      'ChatGPT legacy attachment resolver recapture did not match the original capture; final attachment states are recorded in the archive manifest.'
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
      observeResolvers: async () => ({
        kind: 'matched',
        candidates: [{ assetId: failed.id, downloadUrl: 'signed-failed' }],
      }),
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
        observeResolvers: async () => ({
          kind: 'matched',
          candidates: [{ assetId: ASSET_ID, downloadUrl: 'signed-throw' }],
        }),
        acquireAssets: async () => {
          throw new Error('fetch unavailable');
        },
        buildDestinationCompanion,
      }
    );
    const interpreterObserverFailure = await persistChatGptDestinationHonestAttachments(
      context(),
      companion(),
      'note.md',
      ['file'],
      {
        persistArtifacts,
        observeInterpreterResolvers: async () => {
          throw new Error('interpreter resolver unavailable');
        },
        observeResolvers: async () => ({ kind: 'matched', candidates: [] }),
        buildDestinationCompanion,
      }
    );

    expect(observerFailure.warnings).toContain(
      'ChatGPT legacy attachment resolver recapture failed; final attachment states are recorded in the archive manifest.'
    );
    expect(acquisitionFailure.warnings).toContain(
      'ChatGPT attachment acquisition was incomplete; final attachment states are recorded in the archive manifest.'
    );
    expect(interpreterObserverFailure.warnings).toContain(
      'ChatGPT interpreter attachment resolution was incomplete; final attachment states are recorded in the archive manifest.'
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
        observeResolvers: async () => ({
          kind: 'matched',
          candidates: [{ assetId: asset.record.id, downloadUrl: 'signed-binary' }],
        }),
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
      observeResolvers: async () => ({
        kind: 'matched',
        candidates: [{ assetId: asset.record.id, downloadUrl: 'signed-descriptor' }],
      }),
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
        observeResolvers: async () => ({
          kind: 'matched',
          candidates: [{ assetId: failed.id, downloadUrl: 'signed-warning' }],
        }),
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
