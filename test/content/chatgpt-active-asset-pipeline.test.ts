import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureChatGptArchive,
  resolveChatGptActivePngAsset,
  planChatGptActivePngAsset,
  observeChatGptAssetResolvers,
} from '../../src/content/capture/chatgpt-current-branch';
import {
  persistChatGptDestinationHonestAttachments,
  type ChatGptAssetExportDependencies,
} from '../../src/content/chatgpt-asset-export';
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

function syntheticRaw(pngCount = 3, withJpeg = false) {
  return {
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
              ...Array.from({ length: pngCount }, (_, index) => ({
                content_type: 'image_asset_pointer',
                mime_type: 'image/png',
                asset_pointer: `file-service://synthetic-png-${index}`,
              })),
              ...(withJpeg
                ? [
                    {
                      content_type: 'image_asset_pointer',
                      mime_type: 'image/jpeg',
                      asset_pointer: 'file-service://synthetic-jpeg',
                    },
                  ]
                : []),
            ],
          },
          metadata: {},
        },
      },
    },
  };
}

async function capture(rawOverride?: unknown) {
  const raw = syntheticRaw();
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
  const captured = await capture(syntheticRaw(2, true));
  const context = captured.assetExportContext!;
  expect(context.rawCaptureBundle.manifest.assets).toHaveLength(3);
  const original = JSON.stringify(context.rawCaptureBundle.manifest);
  const ids = context.rawCaptureBundle.manifest.assets
    .filter(asset => asset.mediaType === 'image/png')
    .map(asset => asset.id)
    .sort();
  // Interpreter ownership deliberately consumes the first PNG before active selection.
  const interpreterId = ids[0];
  const expectedActive = await planChatGptActivePngAsset(context, ids.slice(1));
  expect(expectedActive).toBeDefined();
  const selected = expectedActive!;
  const otherId = context.rawCaptureBundle.manifest.assets.find(
    asset => asset.mediaType === 'image/jpeg'
  )!.id;
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

type BatchOutcome =
  | 'success'
  | 'not-dispatched'
  | 'http-error'
  | 'file-expired'
  | 'run-failed'
  | 'resolver-throws'
  | 'binary-failed'
  | 'binary-throws';

async function batchPipeline(
  outcomes: readonly BatchOutcome[] = [],
  options: {
    stopBudget?: {
      after: 'interpreter' | number;
      resource: 'attemptsRemaining' | 'bytesRemaining';
    };
    failedObsidianIndex?: number;
  } = {}
) {
  const captured = await capture(syntheticRaw(5, true));
  const context = captured.assetExportContext!;
  const original = JSON.stringify(context.rawCaptureBundle.manifest);
  const pngIds = context.rawCaptureBundle.manifest.assets
    .filter(asset => asset.mediaType === 'image/png')
    .map(asset => asset.id)
    .sort();
  const interpreterId = context.rawCaptureBundle.manifest.assets.find(
    asset => asset.mediaType === 'image/jpeg'
  )!.id;
  const selected: ChatGptActiveAssetPlanItem[] = [];
  const order: string[] = [];
  const budgets: unknown[] = [];
  const remaining: number[] = [];
  const resolveActiveAsset = vi.fn(async (_ctx, item: ChatGptActiveAssetPlanItem) => {
    const index = selected.length;
    selected.push({ ...item });
    order.push(`resolve-${index}`);
    const mode = outcomes[index] ?? 'success';
    if (mode === 'resolver-throws') throw new Error('private exception must not persist');
    if (mode === 'run-failed')
      return { success: false as const, code: 'source-http-error' as const };
    const response = activeSuccess(item);
    if (mode === 'not-dispatched' || mode === 'http-error' || mode === 'file-expired') {
      response.data.candidate = null;
      response.data.metrics.dispatchCount = mode === 'not-dispatched' ? 0 : 1;
      response.data.metrics.observedCount = 0;
      response.data.metrics.outcomes = [mode];
    }
    return response;
  });
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
    const index = selected.length - 1;
    order.push(`fetch-${index}`);
    const response = new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, index]), {
      status: outcomes[index] === 'binary-failed' ? 404 : 200,
      headers: { 'Content-Type': 'image/png' },
    });
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  const acquireAssets = vi.fn<NonNullable<ChatGptAssetExportDependencies['acquireAssets']>>(
    async input => {
      expect(input.candidates).toHaveLength(1);
      budgets.push(input.budget);
      remaining.push(input.budget!.attemptsRemaining);
      if (input.candidates[0].assetId === interpreterId) {
        order.push('acquire-interpreter');
        input.budget!.attemptsRemaining -= 1;
        if (options.stopBudget?.after === 'interpreter')
          input.budget![options.stopBudget.resource] = 0;
        return { records: [...input.assets], runtimeAssets: [], completeness: 'not-attempted' };
      }
      const index = selected.length - 1;
      order.push(`acquire-${index}`);
      if (outcomes[index] === 'binary-throws') throw new Error('private binary exception');
      const result = await acquireChatGptPageOwnedAssets({
        ...input,
        fetcher,
        now: () => new Date(ACTIVE_AT),
      });
      if (options.stopBudget?.after === index) input.budget![options.stopBudget.resource] = 0;
      return result;
    }
  );
  const passive = vi.fn(async (ctx, eligible: readonly string[]) => {
    expect(ctx).toBe(context);
    expect(eligible.every(id => selected.every(item => item.assetId !== id))).toBe(true);
    order.push('passive');
    return {
      kind: 'matched' as const,
      // Even a substituted passive dependency cannot retry any batch-owned ID.
      candidates: selected.map(item => activeSuccess(item).data.candidate!),
    };
  });
  const final = new Map<string, ArchiveCompanionBundle>();
  const persistBinaryAssets = vi.fn<
    NonNullable<ChatGptAssetExportDependencies['persistBinaryAssets']>
  >(async input => {
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
        {
          destination: 'obsidian',
          success: asset.record.id !== pngIds[options.failedObsidianIndex ?? -1],
        },
      ],
      allSuccessful: options.failedObsidianIndex === undefined,
    }));
  });
  const result = await persistChatGptDestinationHonestAttachments(
    context,
    captured.archiveCompanion,
    'batch.md',
    ['file', 'obsidian'],
    {
      persistArtifacts: async (bundle, _name, _source, outputs, kinds) => {
        if (kinds.includes('raw')) order.push('raw');
        if (kinds.includes('manifest')) for (const output of outputs) final.set(output, bundle);
        return { activeOutputs: outputs as ('file' | 'obsidian')[], warnings: [] };
      },
      observeInterpreterResolvers: async () => {
        order.push('interpreter');
        return {
          kind: 'matched',
          candidates: [{ assetId: interpreterId, downloadUrl: 'synthetic-interpreter' }],
        };
      },
      resolveActiveAsset,
      observeResolvers: passive,
      acquireAssets,
      persistBinaryAssets,
    }
  );
  expect(JSON.stringify(context.rawCaptureBundle.manifest)).toBe(original);
  return {
    context,
    pngIds,
    selected,
    order,
    budgets,
    remaining,
    resolveActiveAsset,
    acquireAssets,
    fetcher,
    passive,
    final,
    persistBinaryAssets,
    result,
  };
}

describe('active PNG destination-honest pipeline', () => {
  beforeEach(() => vi.clearAllMocks());
  it('selects only the first four of five eligible identities with immediate sequential acquisition', async () => {
    const run = await batchPipeline();
    expect(run.selected.map(item => item.assetId)).toEqual(run.pngIds.slice(0, 4));
    expect(run.order).toEqual([
      'raw',
      'interpreter',
      'acquire-interpreter',
      'resolve-0',
      'acquire-0',
      'fetch-0',
      'resolve-1',
      'acquire-1',
      'fetch-1',
      'resolve-2',
      'acquire-2',
      'fetch-2',
      'resolve-3',
      'acquire-3',
      'fetch-3',
      'passive',
      'binary-persist',
    ]);
    expect(run.remaining).toEqual([20, 19, 18, 17, 16]);
    expect(run.budgets.every(budget => budget === run.budgets[0])).toBe(true);
    expect(run.passive).toHaveBeenCalledExactlyOnceWith(run.context, [run.pngIds[4]]);
    expect(run.acquireAssets).toHaveBeenCalledTimes(5);
    expect(
      run.result.warnings.filter(w => w.startsWith('ChatGPT active resolver batch audit:'))
    ).toHaveLength(1);
    for (const bundle of run.final.values()) {
      const manifest = parseArtifact<RawCaptureManifest>(bundle, 'manifest');
      expect(manifest.assets.filter(asset => asset.state === 'fetched')).toHaveLength(4);
      expect(manifest.assets.find(asset => asset.id === run.pngIds[4])?.state).toBe(
        'not-attempted'
      );
      const audit = manifest.warnings.filter(w =>
        w.startsWith('ChatGPT active resolver batch audit:')
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]).toContain(
        'selected=4/4; completed=4; dispatched-known=4; dispatch-unknown=0; observed=4;'
      );
    }
  });

  it.each([
    ['success', 'not-dispatched', 'http-error', 'file-expired'],
    ['success', 'binary-failed', 'run-failed', 'success'],
    ['success', 'binary-throws', 'resolver-throws', 'success'],
  ] as const)(
    'continues once after mixed outcomes %s/%s/%s/%s without losing earlier evidence',
    async (...outcomes) => {
      const run = await batchPipeline(outcomes);
      expect(run.selected.map(item => item.assetId)).toEqual(run.pngIds.slice(0, 4));
      expect(run.passive).toHaveBeenCalledExactlyOnceWith(run.context, [run.pngIds[4]]);
      expect(run.fetcher).toHaveBeenCalledTimes(
        outcomes.filter(mode => mode === 'success' || mode === 'binary-failed').length
      );
      for (const bundle of run.final.values()) {
        const manifest = parseArtifact<RawCaptureManifest>(bundle, 'manifest');
        const canonical = parseArtifact<LiskaThreadArchive>(bundle, 'canonical');
        for (const [index, mode] of outcomes.entries()) {
          const asset = manifest.assets.find(asset => asset.id === run.pngIds[index])!;
          const expected =
            mode === 'success'
              ? 'fetched'
              : mode === 'file-expired'
                ? 'expired'
                : mode === 'not-dispatched' || mode === 'run-failed'
                  ? 'not-attempted'
                  : 'failed';
          expect(asset.state).toBe(expected);
          expect(canonical.assets[asset.id].localArtifactRef !== null).toBe(expected === 'fetched');
        }
        const durable = JSON.stringify({ manifest, warnings: canonical.warnings });
        expect(durable).not.toContain('sig=');
        expect(durable).not.toContain('resolverKey');
        expect(durable).not.toContain('private');
        for (const item of run.selected) expect(durable).not.toContain(item.providerFileId);
      }
    }
  );

  it.each([
    ['interpreter', 'attemptsRemaining', 0],
    ['interpreter', 'bytesRemaining', 0],
    [0, 'attemptsRemaining', 1],
    [1, 'bytesRemaining', 2],
  ] as const)(
    'does not dispatch another helper after %s exhausts %s',
    async (after, resource, count) => {
      const run = await batchPipeline([], { stopBudget: { after, resource } });
      expect(run.resolveActiveAsset).toHaveBeenCalledTimes(count);
      expect(run.selected.map(item => item.assetId)).toEqual(run.pngIds.slice(0, count));
      expect(run.fetcher).toHaveBeenCalledTimes(count);
      expect(run.acquireAssets).toHaveBeenCalledTimes(1 + count);
      expect(run.passive).toHaveBeenCalledExactlyOnceWith(run.context, run.pngIds.slice(count));
    }
  );

  it('keeps each PNG destination write outcome independent of the other batch items', async () => {
    const run = await batchPipeline([], { failedObsidianIndex: 1 });
    const file = parseArtifact<RawCaptureManifest>(run.final.get('file')!, 'manifest');
    const obsidian = parseArtifact<RawCaptureManifest>(run.final.get('obsidian')!, 'manifest');
    expect(file.assets.filter(asset => asset.state === 'fetched')).toHaveLength(4);
    expect(obsidian.assets.filter(asset => asset.state === 'fetched')).toHaveLength(3);
    expect(obsidian.assets.find(asset => asset.id === run.pngIds[1])).toMatchObject({
      state: 'failed',
      detail: 'destination-write-failed',
      relativePath: null,
      sha256: null,
    });
    const canonical = parseArtifact<LiskaThreadArchive>(run.final.get('obsidian')!, 'canonical');
    expect(canonical.assets[run.pngIds[1]].localArtifactRef).toBeNull();
    expect(canonical.assets[run.pngIds[0]].localArtifactRef).not.toBeNull();
    expect(run.persistBinaryAssets).toHaveBeenCalledOnce();
  });

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
        expect(
          manifest.warnings.some(w => w.includes('acquisition is limited to four sequential PNGs'))
        ).toBe(true);
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
