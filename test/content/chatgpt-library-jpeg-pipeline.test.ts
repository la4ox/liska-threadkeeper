import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureChatGptArchive,
  planChatGptLibraryJpegAsset,
  resolveChatGptActiveImageAsset,
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

function libraryRaw(options: { interpreterLibrary?: boolean; owner?: unknown } = {}) {
  return {
    conversation_id: ACTIVE_CONVERSATION_ID,
    title: 'Synthetic Library JPEG',
    current_node: 'node',
    ...(options.owner !== undefined && { gizmo_id: options.owner }),
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
              ...Array.from({ length: 5 }, (_, index) => ({
                content_type: 'image_asset_pointer',
                mime_type: 'image/png',
                asset_pointer: `file-service://ordinary-provider-${index}`,
              })),
            ],
          },
          metadata: {
            attachments: [
              ...Array.from({ length: 2 }, (_, index) => ({
                id: `library-provider-${index}`,
                mime_type: 'image/jpeg',
                name: options.interpreterLibrary
                  ? `/mnt/data/library-${index}.jpg`
                  : `image-${index}.jpg`,
                library_file_id: `private-library-sentinel-${index}`,
              })),
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
        transientAssetResolvers: [],
      },
    }),
    createCaptureId: () => `capture-chatgpt-${ACTIVE_CONVERSATION_ID}`,
    now: () => new Date(ACTIVE_AT),
  });
}

type LibraryFailure =
  | 'unknown'
  | 'throws'
  | 'not-dispatched'
  | 'wrong-binding'
  | 'wrong-url'
  | 'binary-403'
  | 'binary-url'
  | 'binary-mime'
  | 'binary-jpeg';

async function runPipeline(
  options: {
    failure?: LibraryFailure;
    stopBudget?:
      | 'interpreter-attempts'
      | 'interpreter-bytes'
      | 'library-attempts'
      | 'library-bytes';
    raw?: unknown;
    libraryEnabled?: boolean;
    ordinaryEnabled?: boolean;
  } = {}
) {
  const captured = await capture(options.raw);
  const context = captured.assetExportContext!;
  const original = JSON.stringify(context.rawCaptureBundle.manifest);
  const libraryIds = context.rawCaptureBundle.manifest.assets
    .filter(asset =>
      asset.sourceRefs.some(ref => /\/metadata\/attachments\/[01]$/.test(ref.rawPointer))
    )
    .map(asset => asset.id);
  const interpreterId = context.rawCaptureBundle.manifest.assets.find(asset =>
    asset.sourceRefs.some(ref => ref.rawPointer.endsWith('/metadata/attachments/2'))
  )!.id;
  const order: string[] = [];
  const dispatched: ChatGptActiveAssetPlanItem[] = [];
  messaging.sendMessage.mockImplementation(
    async (message: { action: string; item: ChatGptActiveAssetPlanItem }) => {
      expect(message.action).toBe('resolveChatGptActiveAsset');
      const item = message.item;
      const library = libraryIds.includes(item.assetId);
      order.push(library ? 'library' : 'ordinary');
      dispatched.push({ ...item });
      if (library && options.failure === 'throws') throw new Error('private-exception-sentinel');
      if (library && options.failure === 'unknown')
        return { success: false, code: 'resolver-result-timeout' };
      const response = activeSuccess(item);
      if (library && options.failure === 'not-dispatched') {
        response.data.candidate = null;
        response.data.metrics = {
          ...response.data.metrics,
          dispatchCount: 0,
          observedCount: 0,
          outcomes: ['not-dispatched'],
        };
      }
      if (library && options.failure === 'wrong-binding')
        response.data.assetId = `chatgpt-asset-${'f'.repeat(64)}`;
      if (library && options.failure === 'wrong-url')
        response.data.candidate!.downloadUrl = 'https://private.example/secret';
      return response;
    }
  );
  const budgets: unknown[] = [];
  const remaining: number[] = [];
  const fetcher = vi.fn<typeof fetch>(async url => {
    const item = dispatched.at(-1)!;
    const library = libraryIds.includes(item.assetId);
    order.push(library ? 'fetch-library' : 'fetch-ordinary');
    const bytes = library
      ? options.failure === 'binary-jpeg'
        ? new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
        : validChatGptJpegBytes()
      : validChatGptPngBytes(dispatched.length);
    const response = new Response(bytes, {
      status: library && options.failure === 'binary-403' ? 403 : 200,
      headers: {
        'Content-Type':
          library && options.failure === 'binary-mime'
            ? 'image/png'
            : library
              ? 'image/jpeg'
              : 'image/png',
      },
    });
    Object.defineProperty(response, 'url', {
      value:
        library && options.failure === 'binary-url'
          ? 'https://private.example/secret'
          : String(url),
    });
    return response;
  });
  let final: ArchiveCompanionBundle | undefined;
  const passive = vi.fn(async (_context, eligible: readonly string[]) => {
    order.push('passive');
    expect(eligible).not.toContain(interpreterId);
    for (const item of dispatched) expect(eligible).not.toContain(item.assetId);
    // Substituted dependencies cannot retry family-owned failures through passive observation.
    return {
      kind: 'matched' as const,
      candidates: dispatched.map(item => activeSuccess(item).data.candidate!),
    };
  });
  const persistBinaryAssets = vi.fn<
    NonNullable<ChatGptAssetExportDependencies['persistBinaryAssets']>
  >(async input =>
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
  const resolveLibraryAsset = vi.fn(resolveChatGptLibraryJpegAsset);
  const resolveActiveAsset = vi.fn(resolveChatGptActiveImageAsset);
  const result = await persistChatGptDestinationHonestAttachments(
    context,
    captured.archiveCompanion,
    'library.md',
    ['file'],
    {
      persistArtifacts: async (bundle, _name, _source, outputs, kinds) => {
        if (kinds.includes('raw')) order.push('raw');
        if (kinds.includes('manifest')) final = bundle;
        return { activeOutputs: outputs as ['file'], warnings: [] };
      },
      observeInterpreterResolvers: async () => {
        order.push('interpreter');
        return {
          kind: 'matched',
          candidates: [{ assetId: interpreterId, downloadUrl: 'interpreter-owned' }],
        };
      },
      ...(options.libraryEnabled !== false && { resolveLibraryAsset }),
      ...(options.ordinaryEnabled !== false && { resolveActiveAsset }),
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
        });
        if (libraryIds.includes(id) && options.stopBudget?.startsWith('library'))
          input.budget![
            options.stopBudget.endsWith('attempts') ? 'attemptsRemaining' : 'bytesRemaining'
          ] = 0;
        return acquired;
      },
      persistBinaryAssets,
    }
  );
  expect(JSON.stringify(context.rawCaptureBundle.manifest)).toBe(original);
  expect(final, JSON.stringify(result.warnings)).toBeDefined();
  const artifact = final!.artifacts.find(item => item.kind === 'manifest')!;
  if (artifact.transport !== 'inline') throw new Error('expected inline fixture');
  const manifest = JSON.parse(
    Buffer.from(artifact.bodyBase64, 'base64').toString('utf8')
  ) as RawCaptureManifest;
  return {
    context,
    libraryIds,
    interpreterId,
    order,
    dispatched,
    budgets,
    remaining,
    fetcher,
    passive,
    persistBinaryAssets,
    resolveLibraryAsset,
    resolveActiveAsset,
    result,
    manifest,
    final: final!,
  };
}

describe('evidence-gated Library JPEG runtime', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists raw, acquires interpreter first, then one Library JPEG and three ordinary images within four slots', async () => {
    const run = await runPipeline();
    expect(run.order.slice(0, 7)).toEqual([
      'raw',
      'interpreter',
      'acquire-interpreter',
      'library',
      'fetch-library',
      'ordinary',
      'fetch-ordinary',
    ]);
    expect(run.resolveLibraryAsset).toHaveBeenCalledTimes(1);
    expect(run.resolveActiveAsset).toHaveBeenCalledTimes(3);
    expect(run.dispatched).toHaveLength(4);
    expect(run.dispatched.filter(item => run.libraryIds.includes(item.assetId))).toHaveLength(1);
    expect(new Set(run.budgets).size).toBe(1);
    expect(run.remaining).toEqual([20, 19, 18, 17, 16]);
    const selectedId = run.dispatched[0].assetId;
    expect(run.manifest.assets.find(asset => asset.id === selectedId)).toMatchObject({
      state: 'fetched',
      mediaType: 'image/jpeg',
      byteLength: validChatGptJpegBytes().length,
    });
    expect(
      run.manifest.assets.find(
        asset => run.libraryIds.includes(asset.id) && asset.id !== selectedId
      )?.state
    ).toBe('not-attempted');
    expect(run.result.warnings.join('\n')).toContain(
      'library-jpeg-attempts=1; ordinary-image-attempts=3;'
    );
    const durable = run.final.artifacts
      .filter(item => item.kind !== 'raw')
      .map(item =>
        item.transport === 'inline' ? Buffer.from(item.bodyBase64, 'base64').toString('utf8') : ''
      )
      .join('\n');
    expect(durable).not.toMatch(
      /private-library-sentinel|https:\/\/private|sig=|private-exception/
    );
    expect(run.result.warnings.join('\n')).not.toMatch(
      /library-provider-|ordinary-provider-|private-library|https:/
    );
  });

  it.each([
    'unknown',
    'throws',
    'not-dispatched',
    'wrong-binding',
    'wrong-url',
    'binary-403',
    'binary-url',
    'binary-mime',
    'binary-jpeg',
  ] as const)(
    'retains ownership on %s without ordinary/passive retry or false fetched claims',
    async failure => {
      const run = await runPipeline({ failure });
      const selectedId = run.dispatched[0].assetId;
      expect(run.resolveLibraryAsset).toHaveBeenCalledTimes(1);
      expect(run.resolveActiveAsset).toHaveBeenCalledTimes(3);
      expect(run.dispatched.filter(item => item.assetId === selectedId)).toHaveLength(1);
      const record = run.manifest.assets.find(asset => asset.id === selectedId)!;
      expect(record.state).toBe(failure === 'not-dispatched' ? 'not-attempted' : 'failed');
      expect(record).toMatchObject({ relativePath: null, byteLength: null, sha256: null });
      expect(
        run.persistBinaryAssets.mock.calls.flatMap(([input]) =>
          input.assets.map(asset => asset.record.id)
        )
      ).not.toContain(selectedId);
      expect(run.result.warnings.join('\n')).toContain(
        'library-jpeg-attempts=1; ordinary-image-attempts=3;'
      );
      if (['unknown', 'throws', 'wrong-binding', 'wrong-url'].includes(failure))
        expect(run.result.warnings.join('\n')).toContain('dispatch-unknown=1;');
    }
  );

  it.each([
    'interpreter-attempts',
    'interpreter-bytes',
    'library-attempts',
    'library-bytes',
  ] as const)('shares the %s budget with surrounding families', async stopBudget => {
    const run = await runPipeline({ stopBudget });
    expect(run.resolveLibraryAsset).toHaveBeenCalledTimes(
      stopBudget.startsWith('interpreter') ? 0 : 1
    );
    expect(run.resolveActiveAsset).not.toHaveBeenCalled();
    expect(run.dispatched).toHaveLength(stopBudget.startsWith('interpreter') ? 0 : 1);
  });

  it('classifier evidence cannot acquire when the separate dependency is absent', async () => {
    const run = await runPipeline({ libraryEnabled: false });
    expect(run.resolveLibraryAsset).not.toHaveBeenCalled();
    expect(run.resolveActiveAsset).toHaveBeenCalledTimes(4);
    expect(run.dispatched.every(item => !run.libraryIds.includes(item.assetId))).toBe(true);
    expect(
      run.manifest.assets
        .filter(asset => run.libraryIds.includes(asset.id))
        .every(asset => asset.state === 'not-attempted')
    ).toBe(true);
  });

  it('retains a Library-only aggregate audit without enabling ordinary acquisition', async () => {
    const run = await runPipeline({ ordinaryEnabled: false });
    expect(run.resolveLibraryAsset).toHaveBeenCalledTimes(1);
    expect(run.resolveActiveAsset).not.toHaveBeenCalled();
    expect(run.result.warnings.join('\n')).toContain(
      'library-jpeg-attempts=1; ordinary-image-attempts=0;'
    );
    expect(run.dispatched).toHaveLength(1);
  });

  it('never dispatches before a durable raw destination succeeds', async () => {
    const captured = await capture();
    const resolveLibraryAsset = vi.fn(resolveChatGptLibraryJpegAsset);
    const result = await persistChatGptDestinationHonestAttachments(
      captured.assetExportContext!,
      captured.archiveCompanion,
      'library.md',
      ['file'],
      {
        persistArtifacts: async () => ({ activeOutputs: [], warnings: [] }),
        resolveLibraryAsset,
      }
    );
    expect(result.rawSuccessfulDestinations).toEqual([]);
    expect(resolveLibraryAsset).not.toHaveBeenCalled();
    expect(messaging.sendMessage).not.toHaveBeenCalled();
  });

  it('does not dispatch Library in unsupported owner context', async () => {
    const run = await runPipeline({ raw: libraryRaw({ owner: 'unsupported-owner' }) });
    expect(run.resolveLibraryAsset).not.toHaveBeenCalled();
    expect(run.resolveActiveAsset).toHaveBeenCalledTimes(4);
    expect(run.dispatched.every(item => !run.libraryIds.includes(item.assetId))).toBe(true);
  });

  it.each([{}, [], false, 0])(
    'rejects malformed owner context before any runtime dispatch %#',
    async owner => {
      await expect(capture(libraryRaw({ owner }))).rejects.toMatchObject({
        code: 'normalization-failed',
      });
      expect(messaging.sendMessage).not.toHaveBeenCalled();
    }
  );

  it('gives exact interpreter evidence precedence over Library association', async () => {
    const captured = await capture(libraryRaw({ interpreterLibrary: true }));
    const context = captured.assetExportContext!;
    const eligible = context.rawCaptureBundle.manifest.assets.map(asset => asset.id);
    await expect(planChatGptLibraryJpegAsset(context, eligible)).resolves.toBeUndefined();
    const item = { assetId: eligible[0], providerFileId: 'library-provider-0' };
    await expect(resolveChatGptLibraryJpegAsset(context, item)).resolves.toEqual({
      success: false,
      code: 'invalid-provider-file-ids',
    });
    expect(messaging.sendMessage).not.toHaveBeenCalled();
  });

  it('re-plans exact raw binding immediately before dispatch', async () => {
    const captured = await capture();
    const context = captured.assetExportContext!;
    const item = await planChatGptLibraryJpegAsset(
      context,
      context.rawCaptureBundle.manifest.assets.map(asset => asset.id)
    );
    expect(item).toBeDefined();
    await expect(
      resolveChatGptLibraryJpegAsset(context, { ...item!, providerFileId: 'substituted-provider' })
    ).resolves.toEqual({ success: false, code: 'invalid-provider-file-ids' });
    await expect(resolveChatGptActiveImageAsset(context, item!)).resolves.toEqual({
      success: false,
      code: 'invalid-provider-file-ids',
    });
    expect(messaging.sendMessage).not.toHaveBeenCalled();
    context.rawCaptureBundle.artifacts[0].bytes[0] ^= 1;
    await expect(resolveChatGptLibraryJpegAsset(context, item!)).resolves.toEqual({
      success: false,
      code: 'resolver-result-invalid',
    });
    expect(messaging.sendMessage).not.toHaveBeenCalled();
  });
});
