import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureChatGptArchive,
  planChatGptLibraryTextPlainAsset,
  resolveChatGptActiveImageAsset,
  resolveChatGptLibraryTextPlainAsset,
  resolveChatGptLibraryCsvAsset,
  resolveChatGptLibraryJpegAsset,
} from '../../src/content/capture/chatgpt-current-branch';
import {
  persistChatGptDestinationHonestAttachments,
  type ChatGptAssetExportDependencies,
} from '../../src/content/chatgpt-asset-export';
import { acquireChatGptPageOwnedAssets } from '../../src/content/capture/chatgpt-asset-acquisition';
import { CHATGPT_CAPTURE_ENDPOINT } from '../../src/lib/chatgpt-capture-contract';
import { getNodePath, type RawCaptureManifest } from '../../src/archive';
import { renderArchiveHtml } from '../../src/archive/presentation';
import { retainStructuredPresentation } from '../../src/content/structured-presentation';
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
const TEXT_PLAIN_BYTES = new Uint8Array([
  0xef, 0xbb, 0xbf, 0x41, 0x0d, 0x0a, 0x42, 0x0a, 0x00, 0x80, 0xff,
]);

function libraryRaw(interpreterTextPlain = false, owner?: string) {
  return {
    conversation_id: ACTIVE_CONVERSATION_ID,
    title: 'Synthetic Library text/plain',
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
                id: `text-plain-provider-${index}`,
                mime_type: 'text/plain',
                name: interpreterTextPlain ? `/mnt/data/table-${index}.txt` : `table-${index}.txt`,
                library_file_id: `private-library-text-plain-${index}`,
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
              {
                id: 'csv-provider',
                mime_type: 'text/csv',
                name: 'table.csv',
                library_file_id: 'private-library-csv',
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

type TextPlainFailure =
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
    failure?: TextPlainFailure;
    textPlainEnabled?: boolean;
    imagesEnabled?: boolean;
    textPlainBytes?: Uint8Array;
    responseMime?: string;
    raw?: unknown;
    noRawDestination?: boolean;
    failTextPlainFileWrite?: boolean;
    stopBudget?:
      | 'interpreter-attempts'
      | 'interpreter-bytes'
      | 'text-plain-attempts'
      | 'text-plain-bytes';
  } = {}
) {
  const captured = await capture(options.raw);
  const context = captured.assetExportContext!;
  const original = JSON.stringify(context.rawCaptureBundle.manifest);
  const textPlainIds = context.rawCaptureBundle.manifest.assets
    .filter(asset => asset.mediaType === 'text/plain')
    .map(asset => asset.id);
  const jpegId = context.rawCaptureBundle.manifest.assets.find(asset =>
    asset.sourceRefs.some(ref => ref.rawPointer.endsWith('/metadata/attachments/2'))
  )!.id;
  const interpreterId = context.rawCaptureBundle.manifest.assets.find(asset =>
    asset.sourceRefs.some(ref => ref.rawPointer.endsWith('/metadata/attachments/3'))
  )!.id;
  const csvId = context.rawCaptureBundle.manifest.assets.find(
    asset => asset.mediaType === 'text/csv'
  )!.id;
  const selectedTextPlainId = [...textPlainIds].sort()[0];
  const sourceRefsBeforeAcquisition = structuredClone(
    captured.archive.assets[selectedTextPlainId].sourceRefs
  );
  const order: string[] = [];
  const dispatched: ChatGptActiveAssetPlanItem[] = [];
  const family = (id: string) =>
    textPlainIds.includes(id)
      ? 'text-plain'
      : id === jpegId
        ? 'jpeg'
        : id === csvId
          ? 'csv'
          : 'ordinary';
  messaging.sendMessage.mockImplementation(
    async (message: { action: string; item: ChatGptActiveAssetPlanItem }) => {
      expect(message.action).toBe('resolveChatGptActiveAsset');
      const item = message.item;
      const textPlain = textPlainIds.includes(item.assetId);
      order.push(family(item.assetId));
      dispatched.push({ ...item });
      if (textPlain && options.failure === 'throws') throw new Error('private-exception');
      if (textPlain && options.failure === 'unknown')
        return { success: false, code: 'resolver-result-timeout' };
      const response = activeSuccess(item);
      if (textPlain && options.failure === 'binding')
        response.data.assetId = `chatgpt-asset-${'f'.repeat(64)}`;
      if (textPlain && options.failure === 'not-dispatched') {
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
      kind === 'text-plain'
        ? (options.textPlainBytes ?? TEXT_PLAIN_BYTES)
        : kind === 'jpeg'
          ? validChatGptJpegBytes()
          : kind === 'csv'
            ? new Uint8Array([0x61, 0x2c, 0x62, 0x0a])
            : validChatGptPngBytes(dispatched.length);
    const response = new Response(bytes, {
      status: kind === 'text-plain' && options.failure === 'http' ? 403 : 200,
      headers: {
        'Content-Type':
          kind === 'text-plain'
            ? options.failure === 'mime'
              ? 'text/html'
              : (options.responseMime ?? 'text/plain; charset=utf-8')
            : kind === 'jpeg'
              ? 'image/jpeg'
              : kind === 'csv'
                ? 'text/csv'
                : 'image/png',
      },
    });
    Object.defineProperty(response, 'url', {
      value:
        kind === 'text-plain' && options.failure === 'url'
          ? 'https://private.invalid/error'
          : String(url),
    });
    return response;
  });
  const budgets: unknown[] = [];
  const remaining: number[] = [];
  const bytesRemaining: number[] = [];
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
          options.failTextPlainFileWrite &&
          destination === 'file' &&
          textPlainIds.includes(asset.record.id)
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
  const resolveLibraryTextPlainAsset = vi.fn(resolveChatGptLibraryTextPlainAsset);
  const resolveLibraryCsvAsset = vi.fn(resolveChatGptLibraryCsvAsset);
  const resolveLibraryAsset = vi.fn(resolveChatGptLibraryJpegAsset);
  const resolveActiveAsset = vi.fn(resolveChatGptActiveImageAsset);
  const result = await persistChatGptDestinationHonestAttachments(
    context,
    captured.archiveCompanion,
    'library-text-plain.md',
    ['file', 'obsidian'],
    {
      presentationContext: retainStructuredPresentation({
        source: 'chatgpt',
        archive: captured.archive,
        archiveCompanion: captured.archiveCompanion,
        targetNodeId: captured.archive.conversation.currentNodeId,
        selectedNodeIds: getNodePath(
          captured.archive,
          captured.archive.conversation.currentNodeId!
        ),
        includeToolContent: false,
      })!,
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
      ...(options.textPlainEnabled !== false && { resolveLibraryTextPlainAsset }),
      ...(options.imagesEnabled !== false && {
        resolveLibraryCsvAsset,
        resolveLibraryAsset,
        resolveActiveAsset,
      }),
      observeResolvers: passive,
      acquireAssets: async input => {
        budgets.push(input.budget);
        remaining.push(input.budget!.attemptsRemaining);
        bytesRemaining.push(input.budget!.bytesRemaining);
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
          ...(textPlainIds.includes(id) && options.failure === 'oversized' && { maxAssetBytes: 2 }),
        });
        if (textPlainIds.includes(id) && options.stopBudget?.startsWith('text-plain'))
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
    textPlainIds,
    selectedTextPlainId,
    sourceRefsBeforeAcquisition,
    resolveLibraryCsvAsset,
    jpegId,
    order,
    dispatched,
    budgets,
    remaining,
    bytesRemaining,
    fetcher,
    passive,
    persistBinaryAssets,
    resolveLibraryTextPlainAsset,
    resolveLibraryAsset,
    resolveActiveAsset,
    result,
    manifests,
    finals,
  };
}

describe('evidence-gated Library text/plain runtime', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists raw, acquires interpreter then CSV, JPEG, text/plain and one ordinary image within four slots', async () => {
    const run = await runPipeline();
    expect(run.order.slice(0, 11)).toEqual([
      'raw',
      'interpreter',
      'acquire-interpreter',
      'csv',
      'fetch-csv',
      'jpeg',
      'fetch-jpeg',
      'text-plain',
      'fetch-text-plain',
      'ordinary',
      'fetch-ordinary',
    ]);
    expect(run.resolveLibraryTextPlainAsset).toHaveBeenCalledTimes(1);
    expect(run.resolveLibraryCsvAsset).toHaveBeenCalledTimes(1);
    expect(run.resolveLibraryAsset).toHaveBeenCalledTimes(1);
    expect(run.resolveActiveAsset).toHaveBeenCalledTimes(1);
    expect(run.dispatched).toHaveLength(4);
    expect(new Set(run.budgets).size).toBe(1);
    expect(run.remaining).toEqual([20, 19, 18, 17, 16]);
    expect(run.bytesRemaining[0]).toBe(128 * 1024 * 1024);
    expect(run.dispatched.find(item => run.textPlainIds.includes(item.assetId))!.assetId).toBe(
      run.selectedTextPlainId
    );
    const selectedDispatch = run.dispatched.find(item => run.textPlainIds.includes(item.assetId))!;
    const selectedDirectAttachmentId = selectedDispatch.providerFileId;
    expect(run.sourceRefsBeforeAcquisition.some(ref => ref.id === selectedDirectAttachmentId)).toBe(
      true
    );
    for (const manifest of run.manifests.values()) {
      expect(manifest.assets.find(asset => asset.id === run.selectedTextPlainId)).toMatchObject({
        state: 'fetched',
        mediaType: 'text/plain',
        byteLength: TEXT_PLAIN_BYTES.length,
        sha256: activeDigest(TEXT_PLAIN_BYTES),
        relativePath: `assets/${activeDigest(TEXT_PLAIN_BYTES)}.txt`,
      });
      expect(
        manifest.assets.find(
          asset => run.textPlainIds.includes(asset.id) && asset.id !== run.selectedTextPlainId
        )?.state
      ).toBe('not-attempted');
      expect(manifest.completeness.assets).toBe('partial');
    }
    const textPlainRuntime = run.persistBinaryAssets.mock.calls
      .flatMap(([input]) => input.assets)
      .find(asset => asset.record.mediaType === 'text/plain')!;
    expect(Array.from(textPlainRuntime.bytes)).toEqual(Array.from(TEXT_PLAIN_BYTES));
    expect(run.result.warnings.join('\n')).toContain(
      'library-jpeg-attempts=1; library-csv-attempts=1; library-text-plain-attempts=1; ordinary-image-attempts=1;'
    );
    expect(run.result.warnings.join('\n')).toContain('PNG/JPEG/CSV/text/plain assets');
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
    expect(run.result.warnings.join('\n')).not.toMatch(
      /text-plain-provider-|private-library|https:/
    );
    for (const bundle of run.finals.values()) {
      const artifact = bundle.artifacts.find(item => item.kind === 'canonical')!;
      if (artifact.transport !== 'inline') throw new Error('expected inline fixture');
      const canonical = JSON.parse(Buffer.from(artifact.bodyBase64, 'base64').toString('utf8'));
      expect(canonical.assets[run.selectedTextPlainId]).toMatchObject({
        mimeType: 'text/plain',
        byteLength: TEXT_PLAIN_BYTES.length,
        sha256: activeDigest(TEXT_PLAIN_BYTES),
        localArtifactRef: `assets/${activeDigest(TEXT_PLAIN_BYTES)}.txt`,
        acquisition: { state: 'fetched' },
      });
      expect(canonical.assets[run.selectedTextPlainId].sourceRefs).toEqual(
        run.sourceRefsBeforeAcquisition
      );
    }
    const resolverEvidence = JSON.stringify({
      warnings: run.result.warnings,
      receipts: run.result.destinationReceipts,
    });
    expect(resolverEvidence).not.toContain(selectedDirectAttachmentId);
    expect(resolverEvidence).not.toContain('private-library-text-plain');
  });

  it('retains exact passive bytes without decoding, encoding guarantees or newline normalization', async () => {
    const bytes = new Uint8Array([...TEXT_PLAIN_BYTES, 0x80, 0xff]);
    const run = await runPipeline({ textPlainBytes: bytes, imagesEnabled: false });
    const textPlain = run.persistBinaryAssets.mock.calls
      .flatMap(([input]) => input.assets)
      .find(asset => asset.record.mediaType === 'text/plain')!;
    expect(Array.from(textPlain.bytes)).toEqual(Array.from(bytes));
    expect(textPlain.record.sha256).toBe(activeDigest(bytes));
    expect(run.resolveLibraryTextPlainAsset).toHaveBeenCalledTimes(1);
    expect(run.dispatched).toHaveLength(1);
  });

  it('presents finalized text/plain only as a local download, never an inline image or preview', async () => {
    const run = await runPipeline({ imagesEnabled: false });
    const evidence = run.result.filePresentation!;
    expect(evidence).toBeDefined();
    expect(evidence.assetBindings.bindings).toEqual([
      {
        assetId: run.selectedTextPlainId,
        path: `assets/${activeDigest(TEXT_PLAIN_BYTES)}.txt`,
        mimeType: 'text/plain',
        sha256: activeDigest(TEXT_PLAIN_BYTES),
        byteLength: TEXT_PLAIN_BYTES.length,
        renderMode: 'download',
      },
    ]);
    const rendered = renderArchiveHtml({
      archive: evidence.context.archive,
      canonicalSha256: evidence.context.canonical.sha256,
      targetNodeId: evidence.context.targetNodeId!,
      profile: { includeToolContent: false },
      assetBindings: evidence.assetBindings,
    });
    expect(rendered.html).toContain(`href="assets/${activeDigest(TEXT_PLAIN_BYTES)}.txt" download`);
    expect(rendered.html).not.toMatch(
      /<img|<iframe|<object|<embed|data:text\/plain|private-library|sig=/
    );
  });

  it.each(['text/csv', 'text/html', 'text/markdown', 'application/octet-stream', 'image/jpeg'])(
    'rejects response MIME %s rather than relabeling it as text/plain',
    async responseMime => {
      const run = await runPipeline({ imagesEnabled: false, responseMime });
      expect(run.fetcher).toHaveBeenCalledTimes(1);
      expect(
        run.manifests.get('file')!.assets.find(asset => asset.id === run.selectedTextPlainId)
      ).toMatchObject({
        state: 'failed',
        relativePath: null,
        sha256: null,
        byteLength: null,
      });
      expect(run.persistBinaryAssets).not.toHaveBeenCalled();
    }
  );

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
    const selectedId = run.selectedTextPlainId;
    expect(run.dispatched.filter(item => item.assetId === selectedId)).toHaveLength(1);
    expect(run.order.filter(value => value === 'fetch-text-plain').length).toBeLessThanOrEqual(1);
    expect(run.resolveActiveAsset).toHaveBeenCalledTimes(1);
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
    for (const manifest of run.manifests.values())
      expect(
        manifest.assets.find(
          asset => run.textPlainIds.includes(asset.id) && asset.id !== selectedId
        )
      ).toMatchObject({
        state: 'not-attempted',
        relativePath: null,
        sha256: null,
        attemptedAt: null,
      });
    expect(run.result.warnings.join('\n')).not.toMatch(/private|text-plain-provider-|https:/);
  });

  it.each([
    'interpreter-attempts',
    'interpreter-bytes',
    'text-plain-attempts',
    'text-plain-bytes',
  ] as const)('shares the %s budget without acquiring another family', async stopBudget => {
    const run = await runPipeline({ stopBudget });
    expect(run.resolveLibraryTextPlainAsset).toHaveBeenCalledTimes(
      stopBudget.startsWith('interpreter') ? 0 : 1
    );
    expect(run.resolveLibraryCsvAsset).toHaveBeenCalledTimes(
      stopBudget.startsWith('interpreter') ? 0 : 1
    );
    expect(run.resolveLibraryAsset).toHaveBeenCalledTimes(
      stopBudget.startsWith('interpreter') ? 0 : 1
    );
    expect(run.resolveActiveAsset).not.toHaveBeenCalled();
  });

  it('does not grant text/plain authority when its distinct dependency is absent', async () => {
    const run = await runPipeline({ textPlainEnabled: false });
    expect(run.resolveLibraryTextPlainAsset).not.toHaveBeenCalled();
    expect(run.resolveLibraryAsset).toHaveBeenCalledTimes(1);
    expect(run.resolveActiveAsset).toHaveBeenCalledTimes(2);
    expect(run.dispatched.every(item => !run.textPlainIds.includes(item.assetId))).toBe(true);
    expect(run.result.warnings.join('\n')).not.toContain('library-text-plain-attempts');
  });

  it('never resolves text/plain before a durable raw destination succeeds or in unsupported owner context', async () => {
    for (const options of [
      { noRawDestination: true },
      { raw: libraryRaw(false, 'private-owner') },
    ]) {
      const run = await runPipeline(options);
      expect(run.resolveLibraryTextPlainAsset).not.toHaveBeenCalled();
      expect(run.dispatched).toEqual([]);
    }
  });

  it('keeps fetched claims destination-specific after text/plain persistence failure', async () => {
    const run = await runPipeline({ failTextPlainFileWrite: true });
    const id = run.selectedTextPlainId;
    expect(run.manifests.get('file')!.assets.find(asset => asset.id === id)).toMatchObject({
      state: 'failed',
      relativePath: null,
      byteLength: null,
      sha256: null,
    });
    expect(run.manifests.get('obsidian')!.assets.find(asset => asset.id === id)).toMatchObject({
      state: 'fetched',
      relativePath: `assets/${activeDigest(TEXT_PLAIN_BYTES)}.txt`,
    });
    expect(
      run.result.destinationReceipts
        .find(receipt => receipt.destination === 'file')!
        .assets.some(asset => asset.mediaType === 'text/plain')
    ).toBe(false);
    expect(
      run.result.destinationReceipts.find(receipt => receipt.destination === 'obsidian')!.assets
    ).toContainEqual({
      relativePath: `assets/${activeDigest(TEXT_PLAIN_BYTES)}.txt`,
      byteLength: TEXT_PLAIN_BYTES.length,
      sha256: activeDigest(TEXT_PLAIN_BYTES),
      mediaType: 'text/plain',
    });
    expect(
      run.result.filePresentation!.assetBindings.bindings.some(
        binding => binding.mimeType === 'text/plain'
      )
    ).toBe(false);
  });

  it('replans exact raw and text/plain family binding immediately before dispatch', async () => {
    const captured = await capture();
    const context = captured.assetExportContext!;
    const eligible = context.rawCaptureBundle.manifest.assets.map(asset => asset.id);
    const item = await planChatGptLibraryTextPlainAsset(context, eligible);
    expect(item).toBeDefined();
    await expect(
      resolveChatGptLibraryTextPlainAsset(context, { ...item!, providerFileId: 'substituted' })
    ).resolves.toEqual({ success: false, code: 'invalid-provider-file-ids' });
    await expect(resolveChatGptLibraryJpegAsset(context, item!)).resolves.toEqual({
      success: false,
      code: 'invalid-provider-file-ids',
    });
    await expect(resolveChatGptLibraryCsvAsset(context, item!)).resolves.toEqual({
      success: false,
      code: 'invalid-provider-file-ids',
    });
    const otherTextPlainId = context.rawCaptureBundle.manifest.assets.find(
      asset => asset.mediaType === 'text/plain' && asset.id !== item!.assetId
    )!.id;
    await expect(
      resolveChatGptLibraryTextPlainAsset(context, { ...item!, assetId: otherTextPlainId })
    ).resolves.toEqual({
      success: false,
      code: 'invalid-provider-file-ids',
    });
    await expect(resolveChatGptActiveImageAsset(context, item!)).resolves.toEqual({
      success: false,
      code: 'invalid-provider-file-ids',
    });
    expect(messaging.sendMessage).not.toHaveBeenCalled();
    context.rawCaptureBundle.artifacts[0].bytes[0] ^= 1;
    await expect(resolveChatGptLibraryTextPlainAsset(context, item!)).resolves.toEqual({
      success: false,
      code: 'resolver-result-invalid',
    });
    expect(messaging.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps interpreter-owned Library text/plain out of its separate active route', async () => {
    const captured = await capture(libraryRaw(true));
    const context = captured.assetExportContext!;
    await expect(
      planChatGptLibraryTextPlainAsset(
        context,
        context.rawCaptureBundle.manifest.assets.map(asset => asset.id)
      )
    ).resolves.toBeUndefined();
    expect(messaging.sendMessage).not.toHaveBeenCalled();
  });
});
