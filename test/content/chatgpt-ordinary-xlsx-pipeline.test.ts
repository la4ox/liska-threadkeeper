import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureChatGptArchive,
  planChatGptOrdinaryXlsxAsset,
  resolveChatGptOrdinaryXlsxAsset,
  resolveChatGptActiveImageAsset,
  resolveChatGptLibraryCsvAsset,
  resolveChatGptLibraryJpegAsset,
  resolveChatGptLibraryTextPlainAsset,
} from '../../src/content/capture/chatgpt-current-branch';
import {
  persistChatGptDestinationHonestAttachments,
  type ChatGptAssetExportDependencies,
} from '../../src/content/chatgpt-asset-export';
import type { RawCaptureAssetRecord, RawCaptureManifest } from '../../src/archive';
import type { ArchiveCompanionBundle } from '../../src/lib/types';
import type { ChatGptActiveAssetPlanItem } from '../../src/lib/chatgpt-active-asset-contract';
import type { ChatGptRouteFamily } from '../../src/lib/chatgpt-owner-context';
import { CHATGPT_CAPTURE_ENDPOINT } from '../../src/lib/chatgpt-capture-contract';
import {
  ACTIVE_AT,
  ACTIVE_CONVERSATION_ID,
  activeDigest,
  activeSuccess,
} from '../fixtures/chatgpt-active-asset';

const messaging = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('../../src/lib/messaging', () => ({ sendMessage: messaging.sendMessage }));
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// Acquisition is deliberately mocked: this suite proves the planner/orchestration
// seam, while the separate acquisition/validator suite proves actual package bytes.
const RUNTIME_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01]);
function runtimeBytesFor(assetId: string): Uint8Array {
  return new Uint8Array([0x50, 0x4b, 0x03, 0x04, Number.parseInt(assetId.slice(-2), 16)]);
}

function ordinaryRaw() {
  return {
    conversation_id: ACTIVE_CONVERSATION_ID,
    title: 'Synthetic ordinary XLSX',
    current_node: 'node',
    mapping: {
      node: {
        id: 'node',
        parent: null,
        children: [],
        message: {
          id: 'message',
          author: { role: 'assistant' },
          content: {
            content_type: 'multimodal_text',
            parts: [
              'Synthetic',
              ...Array.from({ length: 4 }, (_, index) => ({
                content_type: 'image_asset_pointer',
                mime_type: 'image/png',
                asset_pointer: `file-service://ordinary-image-${index}`,
              })),
            ],
          },
          metadata: {
            attachments: [
              {
                id: 'ordinary-sheet-0',
                name: 'sheet-0.xlsx',
                mime_type: XLSX_MIME,
                size: RUNTIME_BYTES.length,
              },
              {
                id: 'ordinary-sheet-1',
                name: 'sheet-1.xlsx',
                mime_type: XLSX_MIME,
                size: RUNTIME_BYTES.length,
              },
              {
                id: 'library-csv',
                name: 'table.csv',
                mime_type: 'text/csv',
                library_file_id: 'private-library-csv',
              },
              {
                id: 'library-jpeg',
                name: 'image.jpg',
                mime_type: 'image/jpeg',
                library_file_id: 'private-library-jpeg',
              },
              {
                id: 'library-text',
                name: 'notes.txt',
                mime_type: 'text/plain',
                library_file_id: 'private-library-text',
              },
            ],
          },
        },
      },
    },
  };
}

async function capture(raw: unknown = ordinaryRaw(), routeFamily: ChatGptRouteFamily = 'standard') {
  const bytes = new TextEncoder().encode(JSON.stringify(raw));
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
        routeFamily,
        transientAssetResolvers: [],
      },
    }),
    createCaptureId: () => `capture-chatgpt-${ACTIVE_CONVERSATION_ID}`,
    now: () => new Date(ACTIVE_AT),
  });
}

type Failure = 'throws' | 'timeout' | 'binding' | 'provider' | 'not-dispatched' | 'acquisition';
async function runPipeline(
  options: {
    failure?: Failure;
    libraries?: boolean;
    xlsxEnabled?: boolean;
    raw?: unknown;
    routeFamily?: ChatGptRouteFamily;
    rawSuccess?: boolean;
    beforeRaw?: () => Promise<void>;
    failFile?: boolean;
    descriptorMismatch?: boolean;
    stopBudget?: 'attemptsRemaining' | 'bytesRemaining';
    persistBinariesThrows?: boolean;
    acquisitionThrows?: boolean;
  } = {}
) {
  const captured = await capture(options.raw, options.routeFamily);
  const context = captured.assetExportContext!;
  const originalManifest = JSON.stringify(context.rawCaptureBundle.manifest);
  const xlsxIds = context.rawCaptureBundle.manifest.assets
    .filter(item => item.mediaType === XLSX_MIME)
    .map(item => item.id);
  const selectedXlsxId = [...xlsxIds].sort()[0];
  const records = new Map(context.rawCaptureBundle.manifest.assets.map(item => [item.id, item]));
  const family = (assetId: string) => {
    const record = records.get(assetId)!;
    return record.mediaType === XLSX_MIME
      ? 'xlsx'
      : record.mediaType === 'text/csv'
        ? 'csv'
        : record.mediaType === 'text/plain'
          ? 'text'
          : record.mediaType === 'image/jpeg'
            ? 'jpeg'
            : 'image';
  };
  const order: string[] = [];
  const dispatched: ChatGptActiveAssetPlanItem[] = [];
  messaging.sendMessage.mockImplementation(
    async (message: { action: string; item: ChatGptActiveAssetPlanItem }) => {
      expect(message.action).toBe('resolveChatGptActiveAsset');
      expect(Object.keys(message.item).sort()).toEqual(['assetId', 'providerFileId']);
      const item = message.item;
      order.push(family(item.assetId));
      dispatched.push({ ...item });
      const failure = family(item.assetId) === 'xlsx' ? options.failure : undefined;
      if (failure === 'throws') throw new Error('private-exception');
      if (failure === 'timeout') return { success: false, code: 'resolver-result-timeout' };
      const result = activeSuccess(item);
      if (failure === 'binding') result.data.assetId = `chatgpt-asset-${'f'.repeat(64)}`;
      if (failure === 'provider')
        return activeSuccess({ ...item, providerFileId: 'wrong-provider' });
      if (failure === 'not-dispatched') {
        result.data.candidate = null;
        result.data.metrics = {
          ...result.data.metrics,
          dispatchCount: 0,
          observedCount: 0,
          outcomes: ['not-dispatched'],
        };
      }
      return result;
    }
  );
  const passive = vi.fn<NonNullable<ChatGptAssetExportDependencies['observeResolvers']>>(
    async (_context, eligible) => {
      order.push('passive');
      for (const item of dispatched) expect(eligible).not.toContain(item.assetId);
      // A substituted observer cannot reacquire an already-owned active identity.
      return {
        kind: 'matched',
        candidates: dispatched.map(item => activeSuccess(item).data.candidate!),
      };
    }
  );
  const acquireAssets = vi.fn<NonNullable<ChatGptAssetExportDependencies['acquireAssets']>>(
    async input => {
      expect(input.candidates).toHaveLength(1);
      const candidate = input.candidates[0];
      const kind = family(candidate.assetId);
      order.push(`acquire-${kind}`);
      if (options.acquisitionThrows && kind === 'xlsx') throw new Error('private-acquisition');
      expect(candidate.expectedByteLength).toBe(kind === 'xlsx' ? RUNTIME_BYTES.length : undefined);
      expect(candidate.validationProfile).toBe(
        kind === 'xlsx' ? 'ordinary-direct-xlsx' : undefined
      );
      input.budget!.attemptsRemaining -= 1;
      input.budget!.bytesRemaining -= RUNTIME_BYTES.length;
      if (options.stopBudget && kind === 'xlsx') input.budget![options.stopBudget] = 0;
      const record = input.assets.find(item => item.id === candidate.assetId)!;
      const runtimeBytes = runtimeBytesFor(candidate.assetId);
      const failed = kind === 'xlsx' && options.failure === 'acquisition';
      const fetched: RawCaptureAssetRecord = failed
        ? {
            ...record,
            state: 'failed',
            attemptedAt: ACTIVE_AT,
            detail: 'page-owned-response-rejected',
          }
        : {
            ...record,
            state: 'fetched',
            attemptedAt: ACTIVE_AT,
            byteLength: runtimeBytes.length,
            sha256: activeDigest(runtimeBytes),
            relativePath: `assets/${activeDigest(runtimeBytes)}.${kind === 'xlsx' ? 'xlsx' : kind === 'csv' ? 'csv' : kind === 'jpeg' ? 'jpg' : kind === 'text' ? 'txt' : 'png'}`,
            detail: 'page-owned-signed-response',
          };
      return {
        records: input.assets.map(item => (item.id === candidate.assetId ? fetched : item)),
        runtimeAssets: failed ? [] : [{ record: fetched, bytes: runtimeBytes }],
        completeness: 'partial',
      };
    }
  );
  const persistBinaryAssets = vi.fn<
    NonNullable<ChatGptAssetExportDependencies['persistBinaryAssets']>
  >(async input => {
    if (options.persistBinariesThrows) throw new Error('private-binary-write');
    return input.assets.map(asset => {
      const results = input.outputs.map(destination => ({
        destination,
        success: !(
          options.failFile &&
          destination === 'file' &&
          family(asset.record.id) === 'xlsx'
        ),
      }));
      return {
        assetId: asset.record.id,
        descriptor: {
          assetId: asset.record.id,
          relativePath: asset.record.relativePath!,
          mediaType: asset.record.mediaType!,
          byteLength: asset.record.byteLength!,
          sha256: options.descriptorMismatch ? 'f'.repeat(64) : asset.record.sha256!,
        },
        results,
        allSuccessful: results.every(item => item.success),
      };
    });
  });
  const finals = new Map<string, ArchiveCompanionBundle>();
  const resolveOrdinaryXlsxAsset = vi.fn(resolveChatGptOrdinaryXlsxAsset);
  const resolveActiveAsset = vi.fn(resolveChatGptActiveImageAsset);
  const result = await persistChatGptDestinationHonestAttachments(
    context,
    captured.archiveCompanion,
    'ordinary-xlsx.md',
    ['file', 'obsidian'],
    {
      persistArtifacts: async (bundle, _name, _source, outputs, kinds) => {
        if (kinds.includes('raw')) {
          order.push('raw');
          await options.beforeRaw?.();
          if (options.rawSuccess === false) return { activeOutputs: [], warnings: [] };
        }
        if (kinds.includes('manifest')) for (const output of outputs) finals.set(output, bundle);
        return { activeOutputs: outputs as ['file', 'obsidian'], warnings: [] };
      },
      ...(options.xlsxEnabled !== false && { resolveOrdinaryXlsxAsset }),
      ...(options.libraries && {
        resolveLibraryCsvAsset: resolveChatGptLibraryCsvAsset,
        resolveLibraryAsset: resolveChatGptLibraryJpegAsset,
        resolveLibraryTextPlainAsset: resolveChatGptLibraryTextPlainAsset,
      }),
      resolveActiveAsset,
      observeResolvers: passive,
      acquireAssets,
      persistBinaryAssets,
    }
  );
  expect(JSON.stringify(context.rawCaptureBundle.manifest)).toBe(originalManifest);
  const manifests = new Map<string, RawCaptureManifest>();
  for (const [destination, bundle] of finals) {
    const manifest = bundle.artifacts.find(item => item.kind === 'manifest')!;
    if (manifest.transport !== 'inline') throw new Error('expected inline fixture');
    manifests.set(
      destination,
      JSON.parse(Buffer.from(manifest.bodyBase64, 'base64').toString('utf8'))
    );
  }
  return {
    captured,
    context,
    xlsxIds,
    selectedXlsxId,
    dispatched,
    order,
    passive,
    acquireAssets,
    persistBinaryAssets,
    resolveOrdinaryXlsxAsset,
    resolveActiveAsset,
    manifests,
    finals,
    result,
  };
}

describe('ordinary direct-ID XLSX planner/orchestration pipeline', () => {
  beforeEach(() => vi.clearAllMocks());

  it('plans exact committed raw and carries size through the sole unchanged background command', async () => {
    const captured = await capture();
    const context = captured.assetExportContext!;
    const ids = context.rawCaptureBundle.manifest.assets.map(item => item.id);
    const item = (await planChatGptOrdinaryXlsxAsset(context, ids))!;
    expect(item.expectedByteLength).toBe(RUNTIME_BYTES.length);
    messaging.sendMessage.mockImplementation(async message => activeSuccess(message.item));
    expect((await resolveChatGptOrdinaryXlsxAsset(context, item)).success).toBe(true);
    expect(messaging.sendMessage).toHaveBeenCalledExactlyOnceWith({
      action: 'resolveChatGptActiveAsset',
      conversationId: ACTIVE_CONVERSATION_ID,
      item: { assetId: item.assetId, providerFileId: item.providerFileId },
    });
  });

  it.each(['assetId', 'providerFileId', 'expectedByteLength'] as const)(
    'immediately replans and rejects changed %s before dispatch',
    async field => {
      const captured = await capture();
      const context = captured.assetExportContext!;
      const item = (await planChatGptOrdinaryXlsxAsset(
        context,
        context.rawCaptureBundle.manifest.assets.map(asset => asset.id)
      ))!;
      const mismatch = {
        ...item,
        [field]:
          field === 'expectedByteLength'
            ? item.expectedByteLength + 1
            : field === 'assetId'
              ? `chatgpt-asset-${'f'.repeat(64)}`
              : 'different-provider',
      };
      expect(await resolveChatGptOrdinaryXlsxAsset(context, mismatch)).toEqual({
        success: false,
        code: 'invalid-provider-file-ids',
      });
      expect(messaging.sendMessage).not.toHaveBeenCalled();
    }
  );

  it('rechecks changed ledger state and exact raw integrity immediately before dispatch', async () => {
    const captured = await capture();
    const context = captured.assetExportContext!;
    const item = (await planChatGptOrdinaryXlsxAsset(
      context,
      context.rawCaptureBundle.manifest.assets.map(asset => asset.id)
    ))!;
    context.rawCaptureBundle.manifest.assets.find(asset => asset.id === item.assetId)!.state =
      'declined';
    expect((await resolveChatGptOrdinaryXlsxAsset(context, item)).success).toBe(false);
    context.rawCaptureBundle.artifacts[0].bytes[0] ^= 1;
    await expect(planChatGptOrdinaryXlsxAsset(context, [item.assetId])).rejects.toMatchObject({
      code: 'capture-integrity-failed',
    });
    expect((await resolveChatGptOrdinaryXlsxAsset(context, item)).success).toBe(false);
    expect(messaging.sendMessage).not.toHaveBeenCalled();
  });

  it('does not carry a stale declared size into a different internally valid committed raw', async () => {
    const captured = await capture();
    const context = captured.assetExportContext!;
    const item = (await planChatGptOrdinaryXlsxAsset(
      context,
      context.rawCaptureBundle.manifest.assets.map(asset => asset.id)
    ))!;
    const updatedRaw = ordinaryRaw();
    for (const attachment of updatedRaw.mapping.node.message.metadata.attachments)
      if (attachment.mime_type === XLSX_MIME) attachment.size! += 1;
    const updated = await capture(updatedRaw);
    expect(await resolveChatGptOrdinaryXlsxAsset(updated.assetExportContext!, item)).toEqual({
      success: false,
      code: 'invalid-provider-file-ids',
    });
    expect(messaging.sendMessage).not.toHaveBeenCalled();
  });

  it('issues zero resolver/acquisition requests while raw persistence is pending', async () => {
    let release!: () => void;
    let started!: () => void;
    const rawStarted = new Promise<void>(resolve => {
      started = resolve;
    });
    const rawPending = new Promise<void>(resolve => {
      release = resolve;
    });
    const pending = runPipeline({
      beforeRaw: async () => {
        started();
        await rawPending;
      },
    });
    await rawStarted;
    expect(messaging.sendMessage).not.toHaveBeenCalled();
    release();
    const run = await pending;
    expect(run.order.slice(0, 3)).toEqual(['raw', 'xlsx', 'acquire-xlsx']);
  });

  it('does not dispatch when no durable destination saved raw', async () => {
    const run = await runPipeline({ rawSuccess: false });
    expect(run.resolveOrdinaryXlsxAsset).not.toHaveBeenCalled();
    expect(messaging.sendMessage).not.toHaveBeenCalled();
    expect(run.acquireAssets).not.toHaveBeenCalled();
    expect(run.result.rawSuccessfulDestinations).toEqual([]);
  });

  it('does not request any attachment after a raw persistence exception', async () => {
    const run = await runPipeline({
      beforeRaw: async () => {
        throw new Error('private-raw-write');
      },
    });
    expect(run.resolveOrdinaryXlsxAsset).not.toHaveBeenCalled();
    expect(run.acquireAssets).not.toHaveBeenCalled();
    expect(messaging.sendMessage).not.toHaveBeenCalled();
    expect(JSON.stringify(run.result)).not.toContain('private-raw-write');
  });

  it('preserves CSV -> Library JPEG -> Library text/plain -> one ordinary XLSX priority', async () => {
    const run = await runPipeline({ libraries: true });
    expect(run.order.slice(0, 9)).toEqual([
      'raw',
      'csv',
      'acquire-csv',
      'jpeg',
      'acquire-jpeg',
      'text',
      'acquire-text',
      'xlsx',
      'acquire-xlsx',
    ]);
    expect(run.dispatched).toHaveLength(4);
    expect(run.resolveActiveAsset).not.toHaveBeenCalled();
    expect(run.resolveOrdinaryXlsxAsset).toHaveBeenCalledTimes(1);
    expect(run.result.warnings.join('\n')).toContain(
      'library-text-plain-attempts=1; ordinary-xlsx-attempts=1; ordinary-image-attempts=0;'
    );
  });

  it('selects only one deterministic XLSX before three images using one 20-attempt/128-MiB budget', async () => {
    const run = await runPipeline();
    expect(run.dispatched).toHaveLength(4);
    expect(run.dispatched[0].assetId).toBe(run.selectedXlsxId);
    expect(run.resolveOrdinaryXlsxAsset).toHaveBeenCalledTimes(1);
    expect(run.resolveActiveAsset).toHaveBeenCalledTimes(3);
    const budgets = run.acquireAssets.mock.calls.map(([input]) => input.budget);
    expect(new Set(budgets).size).toBe(1);
    expect(budgets[0]).toEqual({
      attemptsRemaining: 16,
      bytesRemaining: 128 * 1024 * 1024 - 4 * RUNTIME_BYTES.length,
    });
    expect(run.result.warnings.join('\n')).toContain(
      'ordinary-xlsx-attempts=1; ordinary-image-attempts=3;'
    );
    for (const manifest of run.manifests.values()) {
      expect(manifest.assets.find(asset => asset.id === run.selectedXlsxId)).toMatchObject({
        state: 'fetched',
        mediaType: XLSX_MIME,
        byteLength: RUNTIME_BYTES.length,
        sha256: activeDigest(runtimeBytesFor(run.selectedXlsxId)),
        relativePath: `assets/${activeDigest(runtimeBytesFor(run.selectedXlsxId))}.xlsx`,
      });
      expect(
        manifest.assets.find(
          asset => run.xlsxIds.includes(asset.id) && asset.id !== run.selectedXlsxId
        )?.state
      ).toBe('not-attempted');
      expect(JSON.stringify(manifest)).not.toContain('expectedByteLength');
      expect(JSON.stringify(manifest)).not.toContain('ordinary-direct-xlsx');
    }
    expect(JSON.stringify(run.result)).not.toMatch(
      /ordinary-sheet-|private-library|https:|sig=|expectedByteLength|ordinary-direct-xlsx/
    );
  });

  it.each(['throws', 'timeout', 'binding', 'provider', 'not-dispatched', 'acquisition'] as const)(
    'reserves a %s XLSX attempt without passive retry or false fetched evidence',
    async failure => {
      const run = await runPipeline({ failure });
      expect(run.resolveOrdinaryXlsxAsset).toHaveBeenCalledTimes(1);
      expect(run.dispatched.filter(item => item.assetId === run.selectedXlsxId)).toHaveLength(1);
      for (const manifest of run.manifests.values())
        expect(manifest.assets.find(asset => asset.id === run.selectedXlsxId)).toMatchObject({
          state: failure === 'not-dispatched' ? 'not-attempted' : 'failed',
          relativePath: null,
          byteLength: null,
          sha256: null,
        });
      expect(
        run.persistBinaryAssets.mock.calls.flatMap(([input]) =>
          input.assets.map(asset => asset.record.id)
        )
      ).not.toContain(run.selectedXlsxId);
      expect(JSON.stringify(run.result)).not.toMatch(/private-exception|ordinary-sheet-|https:/);
    }
  );

  it.each(['attemptsRemaining', 'bytesRemaining'] as const)(
    'stops later families when the XLSX shared %s budget ends',
    async stopBudget => {
      const run = await runPipeline({ stopBudget });
      expect(run.resolveOrdinaryXlsxAsset).toHaveBeenCalledTimes(1);
      expect(run.resolveActiveAsset).not.toHaveBeenCalled();
      expect(run.acquireAssets).toHaveBeenCalledTimes(1);
    }
  );

  it('does not gain XLSX authority from the ordinary image dependency', async () => {
    const run = await runPipeline({ xlsxEnabled: false });
    expect(run.resolveOrdinaryXlsxAsset).not.toHaveBeenCalled();
    expect(run.dispatched.some(item => run.xlsxIds.includes(item.assetId))).toBe(false);
    expect(run.result.warnings.join('\n')).not.toContain('ordinary-xlsx-attempts=');
  });

  it.each(['project', 'custom-gpt'] as const)(
    'refuses nonstandard %s route despite owner-free raw',
    async routeFamily => {
      const run = await runPipeline({ routeFamily });
      expect(run.resolveOrdinaryXlsxAsset).not.toHaveBeenCalled();
      expect(messaging.sendMessage).not.toHaveBeenCalled();
      expect(await planChatGptOrdinaryXlsxAsset(run.context, run.xlsxIds)).toBeUndefined();
    }
  );

  it('rejects raw owner evidence without dispatch', async () => {
    const run = await runPipeline({ raw: { ...ordinaryRaw(), project_id: 'private-project' } });
    expect(run.resolveOrdinaryXlsxAsset).not.toHaveBeenCalled();
    expect(messaging.sendMessage).not.toHaveBeenCalled();
  });

  it('makes fetched status destination-honest when XLSX File persistence fails', async () => {
    const run = await runPipeline({ failFile: true });
    expect(
      run.manifests.get('file')!.assets.find(asset => asset.id === run.selectedXlsxId)
    ).toMatchObject({
      state: 'failed',
      relativePath: null,
      byteLength: null,
      sha256: null,
      detail: 'destination-write-failed',
    });
    expect(
      run.manifests.get('obsidian')!.assets.find(asset => asset.id === run.selectedXlsxId)
    ).toMatchObject({ state: 'fetched', byteLength: RUNTIME_BYTES.length });
    expect(run.dispatched.filter(item => item.assetId === run.selectedXlsxId)).toHaveLength(1);
  });

  it.each([
    { descriptorMismatch: true },
    { persistBinariesThrows: true },
    { acquisitionThrows: true },
  ])('fails closed on acquisition/persistence evidence failure %#', async options => {
    const run = await runPipeline(options);
    for (const manifest of run.manifests.values())
      expect(manifest.assets.find(asset => asset.id === run.selectedXlsxId)).toMatchObject({
        state: 'failed',
        relativePath: null,
        byteLength: null,
        sha256: null,
      });
    expect(run.resolveOrdinaryXlsxAsset).toHaveBeenCalledTimes(1);
  });
});
