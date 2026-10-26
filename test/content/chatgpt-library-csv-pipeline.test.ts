import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureChatGptArchive,
  planChatGptLibraryCsvAsset,
  resolveChatGptActiveImageAsset,
  resolveChatGptLibraryCsvAsset,
  resolveChatGptLibraryJpegAsset,
} from '../../src/content/capture/chatgpt-current-branch';
import {
  persistChatGptDestinationHonestAttachments,
  type ChatGptAssetExportDependencies,
} from '../../src/content/chatgpt-asset-export';
import { acquireChatGptPageOwnedAssets } from '../../src/content/capture/chatgpt-asset-acquisition';
import { CHATGPT_CAPTURE_ENDPOINT } from '../../src/lib/chatgpt-capture-contract';
import type { RawCaptureManifest } from '../../src/archive';
import type { ArchiveCompanionBundle } from '../../src/lib/types';
import type { ChatGptActiveAssetPlanItem } from '../../src/lib/chatgpt-active-asset-contract';
import {
  ACTIVE_AT,
  ACTIVE_CONVERSATION_ID,
  activeDigest,
  activeSuccess,
} from '../fixtures/chatgpt-active-asset';
import { validChatGptJpegBytes, validChatGptPngBytes } from '../fixtures/chatgpt-image-bytes';

const messaging = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('../../src/lib/messaging', () => ({ sendMessage: messaging.sendMessage }));
const CSV_BYTES = new TextEncoder().encode('\uFEFFname,value\r\n"quoted\nname",=1+1\r\n');

function libraryRaw(interpreterCsv = false, owner?: string) {
  return {
    conversation_id: ACTIVE_CONVERSATION_ID,
    title: 'Synthetic Library CSV',
    current_node: 'node',
    ...(owner && { project_id: owner }),
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
                asset_pointer: `file-service://ordinary-provider-${index}`,
              })),
            ],
          },
          metadata: {
            attachments: [
              ...Array.from({ length: 2 }, (_, index) => ({
                id: `csv-provider-${index}`,
                mime_type: 'text/csv',
                name: interpreterCsv ? `/mnt/data/table-${index}.csv` : `table-${index}.csv`,
                library_file_id: `private-library-csv-${index}`,
              })),
              {
                id: 'jpeg-provider',
                mime_type: 'image/jpeg',
                name: 'image.jpg',
                library_file_id: 'private-library-jpeg',
              },
              {
                id: 'interpreter-provider',
                name: '/mnt/data/interpreter.jpg',
                mime_type: 'image/jpeg',
              },
            ],
          },
        },
      },
    },
  };
}

async function capture(raw: unknown = libraryRaw()) {
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
        routeFamily: 'standard' as const,
        transientAssetResolvers: [],
      },
    }),
    createCaptureId: () => `capture-chatgpt-${ACTIVE_CONVERSATION_ID}`,
    now: () => new Date(ACTIVE_AT),
  });
}

type CsvFailure =
  | 'throws'
  | 'unknown'
  | 'not-dispatched'
  | 'binding'
  | 'http'
  | 'url'
  | 'mime'
  | 'oversized';

async function runPipeline(
  options: {
    failure?: CsvFailure;
    csvEnabled?: boolean;
    imagesEnabled?: boolean;
    csvBytes?: Uint8Array;
    raw?: unknown;
    noRawDestination?: boolean;
    failCsvFileWrite?: boolean;
    stopBudget?: 'interpreter-attempts' | 'interpreter-bytes' | 'csv-attempts' | 'csv-bytes';
  } = {}
) {
  const captured = await capture(options.raw);
  const context = captured.assetExportContext!;
  const original = JSON.stringify(context.rawCaptureBundle.manifest);
  const csvIds = context.rawCaptureBundle.manifest.assets
    .filter(asset => asset.mediaType === 'text/csv')
    .map(asset => asset.id);
  const jpegId = context.rawCaptureBundle.manifest.assets.find(asset =>
    asset.sourceRefs.some(ref => ref.rawPointer.endsWith('/metadata/attachments/2'))
  )!.id;
  const interpreterId = context.rawCaptureBundle.manifest.assets.find(asset =>
    asset.sourceRefs.some(ref => ref.rawPointer.endsWith('/metadata/attachments/3'))
  )!.id;
  const order: string[] = [];
  const dispatched: ChatGptActiveAssetPlanItem[] = [];
  const family = (id: string) =>
    csvIds.includes(id) ? 'csv' : id === jpegId ? 'jpeg' : 'ordinary';
  messaging.sendMessage.mockImplementation(
    async (message: { action: string; item: ChatGptActiveAssetPlanItem }) => {
      expect(message.action).toBe('resolveChatGptActiveAsset');
      const item = message.item;
      const csv = csvIds.includes(item.assetId);
      order.push(family(item.assetId));
      dispatched.push({ ...item });
      if (csv && options.failure === 'throws') throw new Error('private-exception');
      if (csv && options.failure === 'unknown')
        return { success: false, code: 'resolver-result-timeout' };
      const response = activeSuccess(item);
      if (csv && options.failure === 'binding')
        response.data.assetId = `chatgpt-asset-${'f'.repeat(64)}`;
      if (csv && options.failure === 'not-dispatched') {
        response.data.candidate = null;
        response.data.metrics = {
          ...response.data.metrics,
          dispatchCount: 0,
          observedCount: 0,
          outcomes: ['not-dispatched'],
        };
      }
      return response;
    }
  );
  const fetcher = vi.fn<typeof fetch>(async url => {
    const item = dispatched.at(-1)!;
    const kind = family(item.assetId);
    order.push(`fetch-${kind}`);
    const bytes =
      kind === 'csv'
        ? (options.csvBytes ?? CSV_BYTES)
        : kind === 'jpeg'
          ? validChatGptJpegBytes()
          : validChatGptPngBytes(dispatched.length);
    const response = new Response(bytes, {
      status: kind === 'csv' && options.failure === 'http' ? 403 : 200,
      headers: {
        'Content-Type':
          kind === 'csv'
            ? options.failure === 'mime'
              ? 'text/html'
              : 'text/csv; charset=utf-8'
            : kind === 'jpeg'
              ? 'image/jpeg'
              : 'image/png',
      },
    });
    Object.defineProperty(response, 'url', {
      value:
        kind === 'csv' && options.failure === 'url' ? 'https://private.invalid/error' : String(url),
    });
    return response;
  });
  const budgets: unknown[] = [];
  const remaining: number[] = [];
  const finals = new Map<string, ArchiveCompanionBundle>();
  const passive = vi.fn(async (_context, eligible: readonly string[]) => {
    order.push('passive');
    expect(eligible).not.toContain(interpreterId);
    for (const item of dispatched) expect(eligible).not.toContain(item.assetId);
    return {
      kind: 'matched' as const,
      candidates: dispatched.map(item => activeSuccess(item).data.candidate!),
    };
  });
  const persistBinaryAssets = vi.fn<
    NonNullable<ChatGptAssetExportDependencies['persistBinaryAssets']>
  >(async input =>
    input.assets.map(asset => {
      const results = input.outputs.map(destination => ({
        destination,
        success: !(
          options.failCsvFileWrite &&
          destination === 'file' &&
          csvIds.includes(asset.record.id)
        ),
      }));
      return {
        assetId: asset.record.id,
        descriptor: {
          assetId: asset.record.id,
          relativePath: asset.record.relativePath!,
          mediaType: asset.record.mediaType!,
          byteLength: asset.record.byteLength!,
          sha256: asset.record.sha256!,
        },
        results,
        allSuccessful: results.every(result => result.success),
      };
    })
  );
  const resolveLibraryCsvAsset = vi.fn(resolveChatGptLibraryCsvAsset);
  const resolveLibraryAsset = vi.fn(resolveChatGptLibraryJpegAsset);
  const resolveActiveAsset = vi.fn(resolveChatGptActiveImageAsset);
  const result = await persistChatGptDestinationHonestAttachments(
    context,
    captured.archiveCompanion,
    'library-csv.md',
    ['file', 'obsidian'],
    {
      persistArtifacts: async (bundle, _name, _source, outputs, kinds) => {
        if (kinds.includes('raw')) order.push('raw');
        if (kinds.includes('manifest')) for (const output of outputs) finals.set(output, bundle);
        return {
          activeOutputs: options.noRawDestination ? [] : (outputs as ['file', 'obsidian']),
          warnings: [],
        };
      },
      observeInterpreterResolvers: async () => {
        order.push('interpreter');
        return {
          kind: 'matched',
          candidates: [{ assetId: interpreterId, downloadUrl: 'interpreter-owned' }],
        };
      },
      ...(options.csvEnabled !== false && { resolveLibraryCsvAsset }),
      ...(options.imagesEnabled !== false && { resolveLibraryAsset, resolveActiveAsset }),
      observeResolvers: passive,
      acquireAssets: async input => {
        budgets.push(input.budget);
        remaining.push(input.budget!.attemptsRemaining);
        const id = input.candidates[0].assetId;
        if (id === interpreterId) {
          order.push('acquire-interpreter');
          input.budget!.attemptsRemaining -= 1;
          if (options.stopBudget?.startsWith('interpreter'))
            input.budget![
              options.stopBudget.endsWith('attempts') ? 'attemptsRemaining' : 'bytesRemaining'
            ] = 0;
          return { records: [...input.assets], runtimeAssets: [], completeness: 'not-attempted' };
        }
        const acquired = await acquireChatGptPageOwnedAssets({
          ...input,
          fetcher,
          now: () => new Date(ACTIVE_AT),
          ...(csvIds.includes(id) && options.failure === 'oversized' && { maxAssetBytes: 2 }),
        });
        if (csvIds.includes(id) && options.stopBudget?.startsWith('csv'))
          input.budget![
            options.stopBudget.endsWith('attempts') ? 'attemptsRemaining' : 'bytesRemaining'
          ] = 0;
        return acquired;
      },
      persistBinaryAssets,
    }
  );
  expect(JSON.stringify(context.rawCaptureBundle.manifest)).toBe(original);
  const manifests = new Map<string, RawCaptureManifest>();
  for (const [destination, bundle] of finals) {
    const artifact = bundle.artifacts.find(item => item.kind === 'manifest')!;
    if (artifact.transport !== 'inline') throw new Error('expected inline fixture');
    manifests.set(
      destination,
      JSON.parse(Buffer.from(artifact.bodyBase64, 'base64').toString('utf8'))
    );
  }
  return {
    context,
    csvIds,
    jpegId,
    order,
    dispatched,
    budgets,
    remaining,
    fetcher,
    passive,
    persistBinaryAssets,
    resolveLibraryCsvAsset,
    resolveLibraryAsset,
    resolveActiveAsset,
    result,
    manifests,
    finals,
  };
}

describe('evidence-gated Library CSV runtime', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists raw, acquires interpreter then one CSV, one JPEG and two ordinary images within four slots', async () => {
    const run = await runPipeline();
    expect(run.order.slice(0, 9)).toEqual([
      'raw',
      'interpreter',
      'acquire-interpreter',
      'csv',
      'fetch-csv',
      'jpeg',
      'fetch-jpeg',
      'ordinary',
      'fetch-ordinary',
    ]);
    expect(run.resolveLibraryCsvAsset).toHaveBeenCalledTimes(1);
    expect(run.resolveLibraryAsset).toHaveBeenCalledTimes(1);
    expect(run.resolveActiveAsset).toHaveBeenCalledTimes(2);
    expect(run.dispatched).toHaveLength(4);
    expect(new Set(run.budgets).size).toBe(1);
    expect(run.remaining).toEqual([20, 19, 18, 17, 16]);
    expect(run.dispatched[0].assetId).toBe([...run.csvIds].sort()[0]);
    for (const manifest of run.manifests.values()) {
      expect(manifest.assets.find(asset => asset.id === run.dispatched[0].assetId)).toMatchObject({
        state: 'fetched',
        mediaType: 'text/csv',
        byteLength: CSV_BYTES.length,
        sha256: activeDigest(CSV_BYTES),
        relativePath: `assets/${activeDigest(CSV_BYTES)}.csv`,
      });
      expect(
        manifest.assets.find(
          asset => run.csvIds.includes(asset.id) && asset.id !== run.dispatched[0].assetId
        )?.state
      ).toBe('not-attempted');
      expect(manifest.completeness.assets).toBe('partial');
    }
    const csvRuntime = run.persistBinaryAssets.mock.calls
      .flatMap(([input]) => input.assets)
      .find(asset => asset.record.mediaType === 'text/csv')!;
    expect(Array.from(csvRuntime.bytes)).toEqual(Array.from(CSV_BYTES));
    expect(run.result.warnings.join('\n')).toContain(
      'library-jpeg-attempts=1; library-csv-attempts=1; ordinary-image-attempts=2;'
    );
    expect(run.result.warnings.join('\n')).toContain('PNG/JPEG/CSV assets');
    const durable = [...run.finals.values()]
      .flatMap(bundle =>
        bundle.artifacts
          .filter(item => item.kind !== 'raw')
          .map(item =>
            item.transport === 'inline'
              ? Buffer.from(item.bodyBase64, 'base64').toString('utf8')
              : ''
          )
      )
      .join('\n');
    expect(durable).not.toMatch(/private-library|https:\/\/private|sig=|private-exception/);
    expect(run.result.warnings.join('\n')).not.toMatch(/csv-provider-|private-library|https:/);
  });

  it('retains exact passive bytes without decoding, formula rewriting or newline normalization', async () => {
    const bytes = new Uint8Array([...CSV_BYTES, 0x80, 0xff]);
    const run = await runPipeline({ csvBytes: bytes, imagesEnabled: false });
    const csv = run.persistBinaryAssets.mock.calls
      .flatMap(([input]) => input.assets)
      .find(asset => asset.record.mediaType === 'text/csv')!;
    expect(Array.from(csv.bytes)).toEqual(Array.from(bytes));
    expect(csv.record.sha256).toBe(activeDigest(bytes));
    expect(run.resolveLibraryCsvAsset).toHaveBeenCalledTimes(1);
    expect(run.dispatched).toHaveLength(1);
  });

  it.each([
    'throws',
    'unknown',
    'not-dispatched',
    'binding',
    'http',
    'url',
    'mime',
    'oversized',
  ] as const)('owns a %s failure without passive retry or a false fetched claim', async failure => {
    const run = await runPipeline({ failure });
    const selectedId = run.dispatched[0].assetId;
    expect(run.dispatched.filter(item => item.assetId === selectedId)).toHaveLength(1);
    expect(run.resolveActiveAsset).toHaveBeenCalledTimes(2);
    for (const manifest of run.manifests.values())
      expect(manifest.assets.find(asset => asset.id === selectedId)).toMatchObject({
        state: failure === 'not-dispatched' ? 'not-attempted' : 'failed',
        relativePath: null,
        byteLength: null,
        sha256: null,
      });
    expect(
      run.persistBinaryAssets.mock.calls.flatMap(([input]) =>
        input.assets.map(asset => asset.record.id)
      )
    ).not.toContain(selectedId);
    expect(run.result.warnings.join('\n')).not.toMatch(/private|csv-provider-|https:/);
  });

  it.each(['interpreter-attempts', 'interpreter-bytes', 'csv-attempts', 'csv-bytes'] as const)(
    'shares the %s budget without acquiring another family',
    async stopBudget => {
      const run = await runPipeline({ stopBudget });
      expect(run.resolveLibraryCsvAsset).toHaveBeenCalledTimes(
        stopBudget.startsWith('interpreter') ? 0 : 1
      );
      expect(run.resolveLibraryAsset).not.toHaveBeenCalled();
      expect(run.resolveActiveAsset).not.toHaveBeenCalled();
    }
  );

  it('does not grant CSV authority when its distinct dependency is absent', async () => {
    const run = await runPipeline({ csvEnabled: false });
    expect(run.resolveLibraryCsvAsset).not.toHaveBeenCalled();
    expect(run.resolveLibraryAsset).toHaveBeenCalledTimes(1);
    expect(run.resolveActiveAsset).toHaveBeenCalledTimes(3);
    expect(run.dispatched.every(item => !run.csvIds.includes(item.assetId))).toBe(true);
    expect(run.result.warnings.join('\n')).not.toContain('library-csv-attempts');
  });

  it('never resolves CSV before a durable raw destination succeeds or in unsupported owner context', async () => {
    for (const options of [
      { noRawDestination: true },
      { raw: libraryRaw(false, 'private-owner') },
    ]) {
      const run = await runPipeline(options);
      expect(run.resolveLibraryCsvAsset).not.toHaveBeenCalled();
      expect(run.dispatched).toEqual([]);
    }
  });

  it('keeps fetched claims destination-specific after CSV persistence failure', async () => {
    const run = await runPipeline({ failCsvFileWrite: true });
    const id = run.dispatched[0].assetId;
    expect(run.manifests.get('file')!.assets.find(asset => asset.id === id)).toMatchObject({
      state: 'failed',
      relativePath: null,
      byteLength: null,
      sha256: null,
    });
    expect(run.manifests.get('obsidian')!.assets.find(asset => asset.id === id)).toMatchObject({
      state: 'fetched',
      relativePath: `assets/${activeDigest(CSV_BYTES)}.csv`,
    });
  });

  it('replans exact raw and CSV family binding immediately before dispatch', async () => {
    const captured = await capture();
    const context = captured.assetExportContext!;
    const eligible = context.rawCaptureBundle.manifest.assets.map(asset => asset.id);
    const item = await planChatGptLibraryCsvAsset(context, eligible);
    expect(item).toBeDefined();
    await expect(
      resolveChatGptLibraryCsvAsset(context, { ...item!, providerFileId: 'substituted' })
    ).resolves.toEqual({ success: false, code: 'invalid-provider-file-ids' });
    await expect(resolveChatGptLibraryJpegAsset(context, item!)).resolves.toEqual({
      success: false,
      code: 'invalid-provider-file-ids',
    });
    await expect(resolveChatGptActiveImageAsset(context, item!)).resolves.toEqual({
      success: false,
      code: 'invalid-provider-file-ids',
    });
    expect(messaging.sendMessage).not.toHaveBeenCalled();
    context.rawCaptureBundle.artifacts[0].bytes[0] ^= 1;
    await expect(resolveChatGptLibraryCsvAsset(context, item!)).resolves.toEqual({
      success: false,
      code: 'resolver-result-invalid',
    });
    expect(messaging.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps interpreter-owned Library CSV out of its separate active route', async () => {
    const captured = await capture(libraryRaw(true));
    const context = captured.assetExportContext!;
    await expect(
      planChatGptLibraryCsvAsset(
        context,
        context.rawCaptureBundle.manifest.assets.map(asset => asset.id)
      )
    ).resolves.toBeUndefined();
    expect(messaging.sendMessage).not.toHaveBeenCalled();
  });
});
