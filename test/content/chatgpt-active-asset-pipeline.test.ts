import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureChatGptArchive,
  resolveChatGptActivePngAsset,
  planChatGptActivePngAsset,
  observeChatGptAssetResolvers,
} from '../../src/content/capture/chatgpt-current-branch';
import { persistChatGptDestinationHonestAttachments } from '../../src/content/chatgpt-asset-export';
import { acquireChatGptPageOwnedAssets } from '../../src/content/capture/chatgpt-asset-acquisition';
import { CHATGPT_CAPTURE_ENDPOINT } from '../../src/lib/chatgpt-capture-contract';
import type { ArchiveCompanionBundle, StagedBinaryAssetResult } from '../../src/lib/types';
import type { RawCaptureManifest, LiskaThreadArchive } from '../../src/archive';
import type {
  ChatGptActiveAssetPlanItem,
  ChatGptActiveAssetResponse,
} from '../../src/lib/chatgpt-active-asset-contract';
import {
  ACTIVE_AT,
  ACTIVE_CONVERSATION_ID,
  activeDigest,
  activeSuccess,
} from '../fixtures/chatgpt-active-asset';

const messaging = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('../../src/lib/messaging', () => ({ sendMessage: messaging.sendMessage }));

async function capture(rawOverride?: unknown) {
  const raw = {
    conversation_id: ACTIVE_CONVERSATION_ID,
    title: 'Synthetic PNG archive',
    current_node: 'node',
    mapping: {
      node: {
        id: 'node',
        parent: null,
        children: [],
        message: {
          id: 'message',
          author: { role: 'user' },
          content: {
            content_type: 'multimodal_text',
            parts: [
              'Synthetic',
              ...['a', 'b', 'c'].map(letter => ({
                content_type: 'image_asset_pointer',
                mime_type: 'image/png',
                asset_pointer: `file-service://synthetic-png-${letter}`,
              })),
            ],
          },
          metadata: {},
        },
      },
    },
  };
  const bytes = new TextEncoder().encode(JSON.stringify(rawOverride ?? raw));
  return captureChatGptArchive(ACTIVE_CONVERSATION_ID, {
    requestCapture: async () => ({
      success: true,
      data: {
        transport: 'inline',
        bodyBase64: Buffer.from(bytes).toString('base64'),
        byteLength: bytes.byteLength,
        sha256: activeDigest(bytes),
        mediaType: 'application/json',
        endpoint: CHATGPT_CAPTURE_ENDPOINT,
        transientAssetResolvers: [],
      },
    }),
    createCaptureId: () => `capture-chatgpt-${ACTIVE_CONVERSATION_ID}`,
    now: () => new Date(ACTIVE_AT),
  });
}
function parseArtifact<T>(bundle: ArchiveCompanionBundle, kind: 'manifest' | 'canonical'): T {
  const artifact = bundle.artifacts.find(item => item.kind === kind)!;
  if (artifact.transport !== 'inline') throw new Error('expected inline synthetic artifact');
  return JSON.parse(Buffer.from(artifact.bodyBase64, 'base64').toString('utf8'));
}

async function pipeline(
  mode:
    | 'success'
    | 'expired'
    | 'helper-failed'
    | 'not-dispatched'
    | 'run-failed'
    | 'binary-failed'
    | 'substituted' = 'success',
  obsidianOk = true
) {
  const captured = await capture();
  const context = captured.assetExportContext!;
  expect(context.rawCaptureBundle.manifest.assets).toHaveLength(3);
  const original = JSON.stringify(context.rawCaptureBundle.manifest);
  const ids = context.rawCaptureBundle.manifest.assets.map(asset => asset.id).sort();
  // Interpreter ownership deliberately consumes the first PNG before active selection.
  const interpreterId = ids[0];
  const expectedActive = await planChatGptActivePngAsset(context, ids.slice(1));
  expect(expectedActive).toBeDefined();
  const selected = expectedActive!;
  const otherId = ids.find(id => id !== interpreterId && id !== selected.assetId)!;
  const order: string[] = [];
  const calls: Array<{ assetIds: string[]; budget: unknown; remaining: number }> = [];
  messaging.sendMessage.mockImplementation(
    async (message: {
      action: string;
      item: ChatGptActiveAssetPlanItem;
    }): Promise<ChatGptActiveAssetResponse> => {
      expect(message.action).toBe('resolveChatGptActiveAsset');
      expect(message.item).toEqual(selected);
      order.push('active');
      if (mode === 'run-failed') return { success: false, code: 'source-http-error' };
      const response = activeSuccess(message.item);
      if (mode === 'expired' || mode === 'helper-failed' || mode === 'not-dispatched') {
        response.data.candidate = null;
        response.data.metrics.observedCount = 0;
        response.data.metrics.dispatchCount = mode === 'not-dispatched' ? 0 : 1;
        response.data.metrics.outcomes = [
          mode === 'expired'
            ? 'file-expired'
            : mode === 'not-dispatched'
              ? 'not-dispatched'
              : 'http-error',
        ];
      }
      return response;
    }
  );
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
    order.push('fetch-active');
    if (mode === 'binary-failed') throw new Error('synthetic network failure');
    const response = new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]), {
      headers: { 'Content-Type': 'image/png' },
    });
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  const final = new Map<string, ArchiveCompanionBundle>();
  const persistBinaryAssets = vi.fn(
    async (input: {
      assets: readonly {
        record: import('../../src/archive').RawCaptureAssetRecord;
        bytes: Uint8Array;
      }[];
    }): Promise<StagedBinaryAssetResult[]> => {
      order.push('binary-persist');
      return input.assets.map(asset => ({
        assetId: asset.record.id,
        descriptor: {
          assetId: asset.record.id,
          relativePath: asset.record.relativePath!,
          mediaType: asset.record.mediaType!,
          byteLength: asset.record.byteLength!,
          sha256: asset.record.sha256!,
        },
        results: [
          { destination: 'file', success: true },
          { destination: 'obsidian', success: obsidianOk },
        ],
        allSuccessful: obsidianOk,
      }));
    }
  );
  const passive = vi.fn(async (_ctx, eligible: readonly string[]) => {
    order.push('passive');
    expect(eligible).toEqual([otherId]);
    // A hostile passive result must still not retry the active attempted ID.
    return {
      kind: 'matched' as const,
      candidates: [
        { assetId: otherId, downloadUrl: 'synthetic-other' },
        { assetId: selected.assetId, downloadUrl: 'must-not-retry-active' },
      ],
    };
  });
  const result = await persistChatGptDestinationHonestAttachments(
    context,
    captured.archiveCompanion,
    'synthetic.md',
    ['file', 'obsidian'],
    {
      persistArtifacts: async (bundle, _name, _source, outputs, kinds) => {
        if (kinds.includes('raw')) order.push('raw');
        if (kinds.includes('manifest'))
          for (const destination of outputs) final.set(destination, bundle);
        return { activeOutputs: outputs as ('file' | 'obsidian')[], warnings: [] };
      },
      observeInterpreterResolvers: async () => {
        order.push('interpreter');
        return {
          kind: 'matched',
          candidates: [{ assetId: interpreterId, downloadUrl: 'synthetic-interpreter' }],
        };
      },
      resolveActiveAsset:
        mode === 'substituted'
          ? async (_ctx, item) => {
              order.push('active');
              const response = activeSuccess(item);
              response.data.candidate!.downloadUrl = response.data.candidate!.downloadUrl.replace(
                item.providerFileId,
                'other-provider'
              );
              return response;
            }
          : resolveChatGptActivePngAsset,
      observeResolvers: passive,
      acquireAssets: async input => {
        calls.push({
          assetIds: input.candidates.map(c => c.assetId),
          budget: input.budget,
          remaining: input.budget!.attemptsRemaining,
        });
        if (input.candidates[0].assetId === selected.assetId)
          return acquireChatGptPageOwnedAssets({
            ...input,
            fetcher,
            now: () => new Date(ACTIVE_AT),
          });
        order.push(
          input.candidates[0].assetId === interpreterId ? 'acquire-interpreter' : 'acquire-passive'
        );
        input.budget!.attemptsRemaining -= 1;
        return { records: [...input.assets], runtimeAssets: [], completeness: 'not-attempted' };
      },
      persistBinaryAssets,
    }
  );
  expect(JSON.stringify(context.rawCaptureBundle.manifest)).toBe(original);
  return {
    result,
    context,
    selected,
    otherId,
    interpreterId,
    order,
    calls,
    fetcher,
    passive,
    persistBinaryAssets,
    final,
  };
}

describe('one active PNG destination-honest pipeline', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([false, true])(
    'never binds/fetches an invalid-direct asset through passive pointer fallback (mixed direct=%s)',
    async mixed => {
      const invalidDirect = 'file/unsupported';
      const raw = {
        conversation_id: ACTIVE_CONVERSATION_ID,
        title: 'Synthetic invalid direct regression',
        current_node: 'node',
        mapping: {
          node: {
            id: 'node',
            parent: null,
            children: [],
            message: {
              id: 'synthetic-message',
              author: { role: 'user' },
              content: {
                content_type: 'multimodal_text',
                parts: [
                  {
                    content_type: 'image_asset_pointer',
                    mime_type: 'image/png',
                    file_id: invalidDirect,
                    ...(mixed ? { id: 'file_valid' } : {}),
                    asset_pointer: 'file-service://file_valid',
                  },
                ],
              },
              metadata: {},
            },
          },
        },
      };
      const captured = await capture(raw);
      const context = captured.assetExportContext!;
      const assets = context.rawCaptureBundle.manifest.assets;
      expect(assets).toHaveLength(1);
      const opaqueId = assets[0].id;
      expect(opaqueId).toBe(
        `chatgpt-asset-${activeDigest(new TextEncoder().encode(`liska-chatgpt-asset/1\u0000provider-id:${invalidDirect}`))}`
      );
      expect(await planChatGptActivePngAsset(context, [opaqueId])).toBeUndefined();
      const candidate = activeSuccess({ assetId: opaqueId, providerFileId: 'file_valid' }).data
        .candidate!;
      const passive = vi.fn((ctx, eligible: readonly string[]) =>
        observeChatGptAssetResolvers(
          ctx,
          {
            requestResolvers: async () => ({
              success: true,
              data: {
                transientAssetResolvers: [
                  { resolverKey: candidate.resolverKey!, downloadUrl: candidate.downloadUrl },
                ],
              },
            }),
          },
          eligible
        )
      );
      const resolveActiveAsset = vi.fn();
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
        const response = new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]), {
          headers: { 'Content-Type': 'image/png' },
        });
        Object.defineProperty(response, 'url', { value: String(url) });
        return response;
      });
      const acquire = vi.fn(input =>
        acquireChatGptPageOwnedAssets({ ...input, fetcher, now: () => new Date(ACTIVE_AT) })
      );
      const persistBinaryAssets = vi.fn().mockResolvedValue([]);
      const final: ArchiveCompanionBundle[] = [];
      const result = await persistChatGptDestinationHonestAttachments(
        context,
        captured.archiveCompanion,
        'invalid-direct.md',
        ['file'],
        {
          persistArtifacts: async (bundle, _name, _source, outputs, kinds) => {
            if (kinds.includes('manifest')) final.push(bundle);
            return { activeOutputs: outputs as ('file' | 'obsidian')[], warnings: [] };
          },
          resolveActiveAsset,
          observeResolvers: passive,
          acquireAssets: acquire,
          persistBinaryAssets,
        }
      );
      expect(resolveActiveAsset).not.toHaveBeenCalled();
      expect(passive).toHaveBeenCalledExactlyOnceWith(context, [opaqueId]);
      expect(fetcher).not.toHaveBeenCalled();
      expect(acquire).not.toHaveBeenCalled();
      expect(persistBinaryAssets).not.toHaveBeenCalled();
      expect(await passive.mock.results[0].value).toEqual({ kind: 'matched', candidates: [] });
      expect(result.completeDestinations).toEqual(['file']);
      const manifest = parseArtifact<RawCaptureManifest>(final[0], 'manifest');
      expect(manifest.assets[0]).toMatchObject({
        id: opaqueId,
        state: 'not-attempted',
        attemptedAt: null,
        relativePath: null,
        sha256: null,
      });
    }
  );
  it.each([
    ['opaque', 'success'],
    ['opaque', 'expired'],
    ['legacy', 'success'],
    ['legacy', 'expired'],
  ] as const)(
    'does not fetch/retry a direct-ID winner through its pointer alias in %s passive after active %s',
    async (route, mode) => {
      const providerFileId = 'synthetic-shared-png';
      const raw = {
        conversation_id: ACTIVE_CONVERSATION_ID,
        title: 'Synthetic alias regression',
        current_node: 'node',
        mapping: {
          node: {
            id: 'node',
            parent: null,
            children: [],
            message: {
              id: 'synthetic-message',
              author: { role: 'user' },
              content: {
                content_type: 'multimodal_text',
                parts: [
                  {
                    content_type: 'image_asset_pointer',
                    mime_type: 'image/png',
                    asset_pointer: `file-service://${providerFileId}`,
                  },
                ],
              },
              metadata: {
                attachments: [
                  { id: providerFileId, mime_type: 'image/png', name: 'ordinary-upload.png' },
                ],
              },
            },
          },
        },
      };
      const captured = await capture(raw);
      const context = captured.assetExportContext!;
      const assets = context.rawCaptureBundle.manifest.assets;
      expect(assets).toHaveLength(2);
      const direct = assets.find(asset =>
        asset.sourceRefs.some(ref => ref.rawPointer.includes('/metadata/attachments/'))
      )!;
      const alias = assets.find(asset => asset.id !== direct.id)!;
      const item = { assetId: direct.id, providerFileId };
      expect(
        await planChatGptActivePngAsset(
          context,
          assets.map(asset => asset.id)
        )
      ).toEqual(item);
      const activeResponse = activeSuccess(item);
      const transient = {
        resolverKey: activeResponse.data.candidate!.resolverKey!,
        downloadUrl: activeResponse.data.candidate!.downloadUrl,
      };
      if (mode === 'expired') {
        activeResponse.data.candidate = null;
        activeResponse.data.metrics.observedCount = 0;
        activeResponse.data.metrics.outcomes = ['file-expired'];
      }
      const resolveActiveAsset = vi.fn(async () => activeResponse);
      const original = context.rawCaptureBundle.artifacts[0];
      const passive = vi.fn(async (ctx, eligible: readonly string[]) => {
        expect(eligible).toEqual([alias.id]);
        return observeChatGptAssetResolvers(
          ctx,
          route === 'opaque'
            ? {
                requestResolvers: async () => ({
                  success: true,
                  data: { transientAssetResolvers: [transient] },
                }),
              }
            : {
                requestCapture: async () => ({
                  success: true,
                  data: {
                    transport: 'inline',
                    bodyBase64: Buffer.from(original.bytes).toString('base64'),
                    byteLength: original.record.byteLength,
                    sha256: original.record.sha256,
                    mediaType: 'application/json',
                    endpoint: CHATGPT_CAPTURE_ENDPOINT,
                    transientAssetResolvers: [transient],
                  },
                }),
              },
          eligible
        );
      });
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
        const response = new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]), {
          headers: { 'Content-Type': 'image/png' },
        });
        Object.defineProperty(response, 'url', { value: String(url) });
        return response;
      });
      const acquire = vi.fn(async input =>
        acquireChatGptPageOwnedAssets({ ...input, fetcher, now: () => new Date(ACTIVE_AT) })
      );
      const final: ArchiveCompanionBundle[] = [];
      const persistBinaryAssets = vi.fn(
        async (input): Promise<StagedBinaryAssetResult[]> =>
          input.assets.map(asset => ({
            assetId: asset.record.id,
            descriptor: {
              assetId: asset.record.id,
              relativePath: asset.record.relativePath!,
              mediaType: asset.record.mediaType!,
              byteLength: asset.record.byteLength!,
              sha256: asset.record.sha256!,
            },
            results: [{ destination: 'file', success: true }],
            allSuccessful: true,
          }))
      );
      const result = await persistChatGptDestinationHonestAttachments(
        context,
        captured.archiveCompanion,
        'alias.md',
        ['file'],
        {
          persistArtifacts: async (bundle, _name, _source, outputs, kinds) => {
            if (kinds.includes('manifest')) final.push(bundle);
            return { activeOutputs: outputs as ('file' | 'obsidian')[], warnings: [] };
          },
          resolveActiveAsset,
          observeResolvers: passive,
          acquireAssets: acquire,
          persistBinaryAssets,
        }
      );
      expect(resolveActiveAsset).toHaveBeenCalledExactlyOnceWith(context, item);
      expect(passive).toHaveBeenCalledOnce();
      expect(await passive.mock.results[0].value).toEqual({ kind: 'matched', candidates: [] });
      expect(fetcher).toHaveBeenCalledTimes(mode === 'success' ? 1 : 0);
      expect(acquire).toHaveBeenCalledTimes(mode === 'success' ? 1 : 0);
      expect(persistBinaryAssets).toHaveBeenCalledTimes(mode === 'success' ? 1 : 0);
      expect(result.completeDestinations).toEqual(['file']);
      const manifest = parseArtifact<RawCaptureManifest>(final[0], 'manifest');
      expect(manifest.assets.find(asset => asset.id === direct.id)?.state).toBe(
        mode === 'success' ? 'fetched' : 'expired'
      );
      expect(manifest.assets.find(asset => asset.id === alias.id)).toMatchObject({
        state: 'not-attempted',
        attemptedAt: null,
        relativePath: null,
        sha256: null,
      });
    }
  );
  it.each([false, true])(
    'excludes an unresolved interpreter-plan PNG that sorts first (only interpreter=%s)',
    async onlyInterpreter => {
      const ordered = ['synthetic-family-one', 'synthetic-family-two']
        .map(providerFileId => ({
          providerFileId,
          assetId: `chatgpt-asset-${activeDigest(new TextEncoder().encode(`liska-chatgpt-asset/1\u0000provider-id:${providerFileId}`))}`,
        }))
        .sort((left, right) => left.assetId.localeCompare(right.assetId));
      const [interpreter, png] = ordered;
      const raw = {
        conversation_id: ACTIVE_CONVERSATION_ID,
        title: 'Synthetic family boundary',
        current_node: 'node',
        mapping: {
          node: {
            id: 'node',
            parent: null,
            children: [],
            message: {
              id: 'synthetic_message',
              author: { role: 'assistant' },
              content: {
                content_type: 'multimodal_text',
                parts: onlyInterpreter
                  ? []
                  : [
                      {
                        content_type: 'image_asset_pointer',
                        mime_type: 'image/png',
                        file_id: png.providerFileId,
                        asset_pointer: `file-service://${png.providerFileId}`,
                      },
                    ],
              },
              metadata: {
                attachments: [
                  {
                    id: interpreter.providerFileId,
                    mime_type: 'image/png',
                    name: '/mnt/data/interpreter.png',
                  },
                ],
              },
            },
          },
        },
      };
      const captured = await capture(raw);
      const context = captured.assetExportContext!;
      const ids = context.rawCaptureBundle.manifest.assets.map(asset => asset.id).sort();
      expect(ids[0]).toBe(interpreter.assetId);
      expect(await planChatGptActivePngAsset(context, ids)).toEqual(
        onlyInterpreter ? undefined : png
      );
      expect(await resolveChatGptActivePngAsset(context, interpreter)).toEqual({
        success: false,
        code: 'invalid-provider-file-ids',
      });
      expect(messaging.sendMessage).not.toHaveBeenCalled();
      const resolveActiveAsset = vi.fn(async (_ctx, item: ChatGptActiveAssetPlanItem) => {
        expect(item).toEqual(png);
        const response = activeSuccess(item);
        response.data.candidate = null;
        response.data.metrics.observedCount = 0;
        response.data.metrics.outcomes = ['file-expired'];
        return response;
      });
      const passive = vi.fn();
      const acquire = vi.fn();
      await persistChatGptDestinationHonestAttachments(
        context,
        captured.archiveCompanion,
        'family.md',
        ['file'],
        {
          persistArtifacts: async (_bundle, _name, _source, outputs) => ({
            activeOutputs: outputs as ('file' | 'obsidian')[],
            warnings: [],
          }),
          observeInterpreterResolvers: async () => ({
            kind: 'interpreter-failed',
            warning:
              'ChatGPT interpreter attachment resolution failed; final attachment states are recorded in the archive manifest.',
          }),
          resolveActiveAsset,
          observeResolvers: passive,
          acquireAssets: acquire,
        }
      );
      expect(resolveActiveAsset).toHaveBeenCalledTimes(onlyInterpreter ? 0 : 1);
      expect(passive).not.toHaveBeenCalled();
      expect(acquire).not.toHaveBeenCalled();
    }
  );
  it.each([true, false])(
    'downloads once through the shared budget and preserves destination truth (Obsidian=%s)',
    async obsidianOk => {
      const run = await pipeline('success', obsidianOk);
      expect(run.order.slice(0, 7)).toEqual([
        'raw',
        'interpreter',
        'acquire-interpreter',
        'active',
        'fetch-active',
        'passive',
        'acquire-passive',
      ]);
      expect(run.fetcher).toHaveBeenCalledOnce();
      expect(run.persistBinaryAssets).toHaveBeenCalledOnce();
      expect(run.calls.map(call => call.assetIds)).toEqual([
        [run.interpreterId],
        [run.selected.assetId],
        [run.otherId],
      ]);
      expect(run.calls.map(call => call.remaining)).toEqual([20, 19, 18]);
      expect(run.calls.every(call => call.budget === run.calls[0].budget)).toBe(true);
      for (const destination of ['file', 'obsidian']) {
        const bundle = run.final.get(destination)!;
        const manifest = parseArtifact<RawCaptureManifest>(bundle, 'manifest');
        const canonical = parseArtifact<LiskaThreadArchive>(bundle, 'canonical');
        const record = manifest.assets.find(asset => asset.id === run.selected.assetId)!;
        const fetched = destination === 'file' || obsidianOk;
        expect(record.state).toBe(fetched ? 'fetched' : 'failed');
        expect(record.detail).toBe(
          fetched ? 'page-owned-signed-response' : 'destination-write-failed'
        );
        expect(canonical.assets[run.selected.assetId].localArtifactRef !== null).toBe(fetched);
        expect(manifest.warnings.some(w => w.includes('acquisition is limited to one PNG'))).toBe(
          true
        );
        const durable = JSON.stringify({ manifest, warnings: canonical.warnings });
        expect(durable).not.toContain('sig=');
        expect(durable).not.toContain('resolverKey');
        expect(durable).not.toContain(run.selected.providerFileId);
        expect(JSON.stringify(canonical)).not.toContain('sig=');
        expect(JSON.stringify(canonical)).not.toContain('downloadUrl');
        expect(JSON.stringify(canonical)).not.toContain('resolverKey');
      }
    }
  );
  it.each([
    'expired',
    'helper-failed',
    'not-dispatched',
    'run-failed',
    'binary-failed',
    'substituted',
  ] as const)('retains %s honestly and never retries the active ID passively', async mode => {
    const run = await pipeline(mode);
    expect(run.passive).toHaveBeenCalledOnce();
    expect(run.fetcher).toHaveBeenCalledTimes(mode === 'binary-failed' ? 1 : 0);
    expect(run.persistBinaryAssets).not.toHaveBeenCalled();
    for (const bundle of run.final.values()) {
      const manifest = parseArtifact<RawCaptureManifest>(bundle, 'manifest');
      const canonical = parseArtifact<LiskaThreadArchive>(bundle, 'canonical');
      const record = manifest.assets.find(asset => asset.id === run.selected.assetId)!;
      expect(record.state).toBe(
        mode === 'expired'
          ? 'expired'
          : mode === 'not-dispatched' || mode === 'run-failed'
            ? 'not-attempted'
            : 'failed'
      );
      expect(record.attemptedAt === null).toBe(mode === 'not-dispatched' || mode === 'run-failed');
      expect(record.relativePath).toBeNull();
      expect(record.sha256).toBeNull();
      expect(canonical.assets[run.selected.assetId].localArtifactRef).toBeNull();
      expect(JSON.stringify(manifest)).not.toContain('sig=');
    }
  });
  it('revalidates the committed raw context before sending the data request', async () => {
    const captured = await capture();
    const context = captured.assetExportContext!;
    const item = (await planChatGptActivePngAsset(
      context,
      context.rawCaptureBundle.manifest.assets.map(a => a.id)
    ))!;
    context.rawCaptureBundle.artifacts[0].bytes[0] ^= 1;
    expect(await resolveChatGptActivePngAsset(context, item)).toEqual({
      success: false,
      code: 'resolver-result-invalid',
    });
    expect(messaging.sendMessage).not.toHaveBeenCalled();
  });
});
