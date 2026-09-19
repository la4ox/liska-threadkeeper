import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  buildCaptureManifest,
  inventoryDeepSeekRawAssets,
  normalizeDeepSeekCapture,
  preflightDeepSeekHistoryArtifact,
  type RawCaptureBundle,
} from '../../src/archive';
import { acquireDeepSeekSignedAssets } from '../../src/content/capture/deepseek-asset-acquisition';
import { deriveDeepSeekAssetCandidates } from '../../src/content/capture/deepseek-asset-resolver';
import {
  appendJsonCanonicalCompanion,
  buildJsonRawManifestCompanion,
} from '../../src/content/capture/json-archive-companion';
import { hashCaptureManifest, sha256Hex } from '../../src/content/capture/response';
import {
  DEEPSEEK_ASSET_BINDING_FAILED_WARNING,
  DEEPSEEK_ASSET_FETCH_FAILURE_WARNING,
  DEEPSEEK_ASSET_FINALIZATION_FAILED_WARNING,
  DEEPSEEK_ASSET_RAW_PERSISTENCE_FAILED_WARNING,
  persistDeepSeekDestinationHonestAttachments,
  validateDeepSeekAssetExportBinding,
  verifyDeepSeekAssetExportContext,
} from '../../src/content/deepseek-asset-export';
import { DEEPSEEK_ASSETS_NOT_ATTEMPTED_WARNING } from '../../src/content/extractors/deepseek-api';
import type {
  ArchiveCompanionArtifact,
  ArchiveCompanionBundle,
  DeepSeekAssetExportContext,
  StagedBinaryAssetResult,
} from '../../src/lib/types';

const PROVIDER_ID = 'file-11111111-2222-4333-8444-555555555555';
const FILE_ID = '11111111-2222-4333-8444-555555555555';
const STATE = 'synthetic-export-state';
const PERFORMANCE_STATE = 'synthetic-passive-state';
const PERFORMANCE_URL = `https://files.deepseeksvc.com/api/file?file_id=${FILE_ID}&state=${PERFORMANCE_STATE}&ty=r`;

function fixture(): Record<string, any> {
  return JSON.parse(
    readFileSync('test/fixtures/archive/deepseek-raw/branching-replace.json', 'utf8')
  ) as Record<string, any>;
}

function decodeJson(artifact: ArchiveCompanionArtifact): any {
  if (artifact.transport !== 'inline') throw new Error('expected inline synthetic artifact');
  return JSON.parse(Buffer.from(artifact.bodyBase64, 'base64').toString('utf8')) as any;
}

async function capture(options: { signedPath?: boolean } = {}): Promise<{
  context: DeepSeekAssetExportContext;
  companion: ArchiveCompanionBundle;
}> {
  const raw = fixture();
  for (const message of raw.data.biz_data.chat_messages) {
    for (const file of message.files ?? []) {
      if (file.id !== 'deepseek-file-alpha') continue;
      file.id = PROVIDER_ID;
      file.file_size = 93;
      file.status = 'SUCCESS';
      if (options.signedPath !== false) {
        file.signed_path = `/file?file_id=${FILE_ID}&state=${STATE}`;
      }
    }
  }
  const bytes = new TextEncoder().encode(JSON.stringify(raw));
  const artifact = {
    id: 'conversation',
    relativePath: 'responses/conversation.json',
    mediaType: 'application/json',
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    endpoint: { method: 'GET' as const, pathPattern: '/api/v0/chat/history_messages' },
  };
  const inventory = await inventoryDeepSeekRawAssets({
    raw,
    artifactId: 'conversation',
    sha256: sha256Hex,
  });
  const manifest = buildCaptureManifest({
    captureId: 'capture-deepseek-synthetic-export',
    provider: 'deepseek',
    conversationId: 'deepseek-branching-1',
    capturedAt: '2026-09-19T10:00:00.000Z',
    method: 'same-origin-api',
    artifacts: [artifact],
    assets: inventory.assets,
    completeness: {
      graph: 'complete',
      messages: 'complete',
      branches: 'complete',
      assets: inventory.completeness,
    },
    warnings: [DEEPSEEK_ASSETS_NOT_ATTEMPTED_WARNING],
    observedUnknownContentTypes: preflightDeepSeekHistoryArtifact(bytes, 'deepseek-branching-1'),
  });
  const bundle: RawCaptureBundle = {
    manifest,
    artifacts: [{ record: artifact, bytes }],
    assets: [],
  };
  let companion = await buildJsonRawManifestCompanion(bundle, sha256Hex, 'deepseek');
  const normalized = await normalizeDeepSeekCapture({
    bundle,
    artifactId: 'conversation',
    manifestSha256: await hashCaptureManifest(manifest),
    sha256: sha256Hex,
  });
  companion = await appendJsonCanonicalCompanion(
    companion,
    normalized.archive,
    sha256Hex,
    'deepseek'
  );
  return {
    companion,
    context: {
      rawCaptureBundle: bundle,
      rawArtifact: companion.artifacts.find(artifact => artifact.kind === 'raw')!,
    },
  };
}

describe('DeepSeek destination-honest asset export', () => {
  it('persists raw first and publishes fetched claims only to the destination that stored bytes', async () => {
    const { context, companion } = await capture();
    const rawBefore = JSON.stringify(context.rawCaptureBundle.manifest);
    const bytes = new TextEncoder().encode('x'.repeat(93));
    const fetcher = vi.fn<typeof fetch>().mockImplementation(url => {
      const response = new Response(bytes, {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': '93',
        },
      });
      Object.defineProperty(response, 'url', { value: String(url) });
      return Promise.resolve(response);
    });
    const persisted: Array<{
      companion: ArchiveCompanionBundle;
      outputs: string[];
      kinds: readonly string[];
    }> = [];
    const persistArtifacts = vi.fn(async (value, _name, _source, outputs, kinds) => {
      persisted.push({ companion: value, outputs: [...outputs], kinds });
      return { activeOutputs: [...outputs], warnings: [] };
    });
    const persistBinaryAssets = vi.fn(async input =>
      input.assets.map(asset => {
        if (!('record' in asset)) throw new Error('expected fetched raw asset');
        return {
          assetId: asset.record.id,
          descriptor: {
            assetId: asset.record.id,
            relativePath: asset.record.relativePath!,
            mediaType: asset.record.mediaType!,
            byteLength: asset.record.byteLength!,
            sha256: asset.record.sha256!,
          },
          results: input.outputs.map(destination => ({
            destination,
            success: destination === 'file',
            ...(destination === 'obsidian' && { error: 'synthetic-write-failed' }),
          })),
          allSuccessful: false,
        } satisfies StagedBinaryAssetResult;
      })
    );

    const result = await persistDeepSeekDestinationHonestAttachments(
      context,
      companion,
      'synthetic.md',
      ['file', 'obsidian'],
      {
        persistArtifacts,
        acquireAssets: input =>
          acquireDeepSeekSignedAssets({
            ...input,
            fetcher,
            now: () => new Date('2026-09-19T11:00:00.000Z'),
          }),
        persistBinaryAssets,
      }
    );

    expect(persisted.map(value => ({ outputs: value.outputs, kinds: value.kinds }))).toEqual([
      { outputs: ['file', 'obsidian'], kinds: ['raw'] },
      { outputs: ['file'], kinds: ['manifest', 'canonical'] },
      { outputs: ['obsidian'], kinds: ['manifest', 'canonical'] },
    ]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.completeDestinations).toEqual(['file', 'obsidian']);
    expect(result.warnings.join(' ')).toContain('not saved to obsidian');
    expect(JSON.stringify(context.rawCaptureBundle.manifest)).toBe(rawBefore);

    const fileManifest = decodeJson(
      persisted[1].companion.artifacts.find(artifact => artifact.kind === 'manifest')!
    );
    const obsidianManifest = decodeJson(
      persisted[2].companion.artifacts.find(artifact => artifact.kind === 'manifest')!
    );
    const fetched = fileManifest.assets.find((asset: any) => asset.state === 'fetched');
    const failed = obsidianManifest.assets.find((asset: any) => asset.state === 'failed');
    expect(fetched).toMatchObject({
      mediaType: 'application/octet-stream',
      byteLength: 93,
      relativePath: expect.stringMatching(/^assets\/[a-f0-9]{64}\.bin$/),
    });
    expect(failed).toMatchObject({
      relativePath: null,
      sha256: null,
      detail: 'deepseek-destination-write-failed',
    });

    const fileCanonicalArtifact = persisted[1].companion.artifacts.find(
      artifact => artifact.kind === 'canonical'
    )!;
    const fileCanonical = decodeJson(fileCanonicalArtifact);
    const canonicalFetched = Object.values(fileCanonical.assets).find(
      (asset: any) => asset.acquisition.state === 'fetched'
    ) as any;
    expect(canonicalFetched).toMatchObject({
      localArtifactRef: fetched.relativePath,
      sha256: fetched.sha256,
      acquisition: { state: 'fetched', attemptedAt: '2026-09-19T11:00:00.000Z' },
    });
    for (const durable of [
      JSON.stringify(fileManifest),
      JSON.stringify(obsidianManifest),
      JSON.stringify(fileCanonical),
    ]) {
      expect(durable).not.toContain('signed_path');
      expect(durable).not.toContain(STATE);
      expect(durable).not.toContain(PROVIDER_ID);
      expect(durable).not.toContain(FILE_ID);
    }
  });

  it('keeps a passive page-owned fallback runtime-only in regenerated companions', async () => {
    const { context, companion } = await capture({ signedPath: false });
    const bytes = new TextEncoder().encode('p'.repeat(93));
    const fetcher = vi.fn<typeof fetch>().mockImplementation(url => {
      const response = new Response(bytes, {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': '93',
        },
      });
      Object.defineProperty(response, 'url', { value: String(url) });
      return Promise.resolve(response);
    });
    let finalized: ArchiveCompanionBundle | undefined;
    await persistDeepSeekDestinationHonestAttachments(
      context,
      companion,
      'synthetic.md',
      ['file'],
      {
        persistArtifacts: async (value, _name, _source, outputs, kinds) => {
          if (kinds.includes('canonical')) finalized = value;
          return { activeOutputs: [...outputs], warnings: [] };
        },
        deriveCandidates: bundle =>
          deriveDeepSeekAssetCandidates(bundle, 'conversation', sha256Hex, () => [
            { initiatorType: 'fetch', name: PERFORMANCE_URL },
          ]),
        acquireAssets: input =>
          acquireDeepSeekSignedAssets({
            ...input,
            fetcher,
            now: () => new Date('2026-09-19T11:00:00.000Z'),
          }),
        persistBinaryAssets: async input =>
          input.assets.map(asset => {
            if (!('record' in asset)) throw new Error('expected raw asset');
            return {
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
            } satisfies StagedBinaryAssetResult;
          }),
      }
    );

    expect(fetcher).toHaveBeenCalledWith(PERFORMANCE_URL, expect.any(Object));
    expect(finalized).toBeDefined();
    const manifest = decodeJson(
      finalized!.artifacts.find(artifact => artifact.kind === 'manifest')!
    );
    const canonical = decodeJson(
      finalized!.artifacts.find(artifact => artifact.kind === 'canonical')!
    );
    expect(manifest.assets).toEqual(
      expect.arrayContaining([expect.objectContaining({ state: 'fetched', byteLength: 93 })])
    );
    for (const durable of [JSON.stringify(manifest), JSON.stringify(canonical)]) {
      expect(durable).not.toContain(PERFORMANCE_STATE);
      expect(durable).not.toContain(PERFORMANCE_URL);
      expect(durable).not.toContain(PROVIDER_ID);
      expect(durable).not.toContain(FILE_ID);
    }
  });

  it('rejects a mixed companion before raw persistence or any private binary request', async () => {
    const { context, companion } = await capture();
    const persistArtifacts = vi.fn();
    const deriveCandidates = vi.fn();
    const result = await persistDeepSeekDestinationHonestAttachments(
      context,
      { ...companion, captureId: 'capture-deepseek-forged' },
      'synthetic.md',
      ['file'],
      { persistArtifacts, deriveCandidates }
    );
    expect(result.warnings).toEqual([DEEPSEEK_ASSET_BINDING_FAILED_WARNING]);
    expect(persistArtifacts).not.toHaveBeenCalled();
    expect(deriveCandidates).not.toHaveBeenCalled();
  });

  it('binds raw descriptor, transport, conversation key, and exact initial manifest', async () => {
    const { context, companion } = await capture();
    await expect(validateDeepSeekAssetExportBinding(context, companion)).resolves.toBe(true);

    const wrongKey = { ...companion, conversationKey: 'f'.repeat(64) };
    await expect(validateDeepSeekAssetExportBinding(context, wrongKey)).resolves.toBe(false);

    const raw = companion.artifacts.find(artifact => artifact.kind === 'raw')!;
    const wrongRaw: ArchiveCompanionBundle = {
      ...companion,
      artifacts: companion.artifacts.map(artifact =>
        artifact === raw && artifact.transport === 'inline'
          ? { ...artifact, bodyBase64: 'e30=' }
          : artifact
      ) as ArchiveCompanionBundle['artifacts'],
    };
    await expect(validateDeepSeekAssetExportBinding(context, wrongRaw)).resolves.toBe(false);

    const manifest = companion.artifacts.find(artifact => artifact.kind === 'manifest')!;
    const wrongManifest: ArchiveCompanionBundle = {
      ...companion,
      artifacts: companion.artifacts.map(artifact =>
        artifact === manifest && artifact.transport === 'inline'
          ? { ...artifact, bodyBase64: 'e30=' }
          : artifact
      ) as ArchiveCompanionBundle['artifacts'],
    };
    await expect(validateDeepSeekAssetExportBinding(context, wrongManifest)).resolves.toBe(false);

    const wrongTransport: DeepSeekAssetExportContext = {
      ...context,
      rawArtifact: {
        ...context.rawArtifact,
        transport: 'staged',
        kind: 'raw',
        stageId: `archive-stage-${'A'.repeat(32)}`,
      },
    };
    await expect(validateDeepSeekAssetExportBinding(wrongTransport, companion)).resolves.toBe(
      false
    );
  });

  it('does no attachment work for clipboard-only output', async () => {
    const { context, companion } = await capture();
    const persistArtifacts = vi.fn();
    const deriveCandidates = vi.fn();
    await expect(
      persistDeepSeekDestinationHonestAttachments(
        context,
        companion,
        'synthetic.md',
        ['clipboard'],
        { persistArtifacts, deriveCandidates }
      )
    ).resolves.toEqual({
      rawSuccessfulDestinations: [],
      completeDestinations: [],
      warnings: [],
    });
    expect(persistArtifacts).not.toHaveBeenCalled();
    expect(deriveCandidates).not.toHaveBeenCalled();
  });

  it('stops before acquisition when raw persistence throws or reaches no destination', async () => {
    const { context, companion } = await capture();
    const deriveCandidates = vi.fn();
    await expect(
      persistDeepSeekDestinationHonestAttachments(context, companion, 'synthetic.md', ['file'], {
        persistArtifacts: () => Promise.reject(new Error('synthetic raw failure')),
        deriveCandidates,
      })
    ).resolves.toMatchObject({ warnings: [DEEPSEEK_ASSET_RAW_PERSISTENCE_FAILED_WARNING] });
    expect(deriveCandidates).not.toHaveBeenCalled();

    await expect(
      persistDeepSeekDestinationHonestAttachments(context, companion, 'synthetic.md', ['file'], {
        persistArtifacts: () => Promise.resolve({ activeOutputs: [], warnings: ['raw failed'] }),
        deriveCandidates,
      })
    ).resolves.toEqual({
      rawSuccessfulDestinations: [],
      completeDestinations: [],
      warnings: ['raw failed'],
    });
    expect(deriveCandidates).not.toHaveBeenCalled();
  });

  it('finalizes honest not-attempted evidence when candidate derivation fails', async () => {
    const { context, companion } = await capture();
    const persistedKinds: Array<readonly string[]> = [];
    const result = await persistDeepSeekDestinationHonestAttachments(
      context,
      companion,
      'synthetic.md',
      ['file'],
      {
        persistArtifacts: async (_value, _name, _source, outputs, kinds) => {
          persistedKinds.push(kinds);
          return { activeOutputs: [...outputs], warnings: [] };
        },
        deriveCandidates: () => Promise.reject(new Error('synthetic derivation failure')),
      }
    );
    expect(persistedKinds).toEqual([['raw'], ['manifest', 'canonical']]);
    expect(result.completeDestinations).toEqual(['file']);
    expect(result.warnings).toContain(DEEPSEEK_ASSET_FETCH_FAILURE_WARNING);
  });

  it('retains the raw result and warns when destination finalization fails', async () => {
    const { context, companion } = await capture();
    const result = await persistDeepSeekDestinationHonestAttachments(
      context,
      companion,
      'synthetic.md',
      ['file'],
      {
        persistArtifacts: async (_value, _name, _source, outputs) => ({
          activeOutputs: [...outputs],
          warnings: [],
        }),
        deriveCandidates: () => Promise.resolve([]),
        buildDestinationCompanion: () =>
          Promise.reject(new Error('synthetic finalization failure')),
      }
    );
    expect(result.rawSuccessfulDestinations).toEqual(['file']);
    expect(result.completeDestinations).toEqual([]);
    expect(result.warnings).toContain(DEEPSEEK_ASSET_FINALIZATION_FAILED_WARNING);
  });

  it('rejects a forged raw endpoint inside the runtime context', async () => {
    const { context } = await capture();
    const raw = context.rawCaptureBundle.artifacts[0];
    const forgedRecord = {
      ...raw.record,
      endpoint: { method: 'GET' as const, pathPattern: '/api/v0/file/fetch_files' },
    };
    const forged: DeepSeekAssetExportContext = {
      ...context,
      rawCaptureBundle: {
        ...context.rawCaptureBundle,
        manifest: {
          ...context.rawCaptureBundle.manifest,
          artifacts: [forgedRecord],
        },
        artifacts: [
          {
            ...raw,
            record: forgedRecord,
          },
        ],
      },
    };
    await expect(verifyDeepSeekAssetExportContext(forged)).rejects.toThrow(
      'deepseek asset context raw binding'
    );
  });
});
