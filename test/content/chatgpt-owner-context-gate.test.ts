import { describe, expect, it, vi } from 'vitest';
import { buildCaptureManifest, type RawCaptureAssetRecord } from '../../src/archive';
import { inventoryChatGptRawAssets } from '../../src/archive/normalizers/chatgpt/inventory';
import {
  classifyChatGptLibraryAssets,
  extractChatGptActiveImagePlan,
  extractChatGptActiveResolverPlan,
  extractChatGptInterpreterAssetPlan,
  extractChatGptLibraryJpegPlan,
  matchChatGptPageOwnedAssetResolvers,
} from '../../src/content/capture/chatgpt-asset-resolver';
import {
  captureChatGptArchive,
  observeChatGptActiveAssetResolvers,
  observeChatGptAssetResolvers,
  observeChatGptInterpreterAssetResolvers,
  planChatGptActiveImageAsset,
  planChatGptLibraryJpegAsset,
  planChatGptInterpreterAssetIds,
} from '../../src/content/capture/chatgpt-current-branch';
import {
  CHATGPT_ASSET_OWNER_CONTEXT_SKIPPED_WARNING,
  persistChatGptDestinationHonestAttachments,
  type ChatGptAssetExportDependencies,
} from '../../src/content/chatgpt-asset-export';
import { CHATGPT_CAPTURE_ENDPOINT } from '../../src/lib/chatgpt-capture-contract';
import type { ChatGptRouteFamily } from '../../src/lib/chatgpt-owner-context';
import type {
  ArchiveCompanionBundle,
  ChatGptAssetExportContext,
  PersistentOutputDestination,
} from '../../src/lib/types';
import { ACTIVE_AT, ACTIVE_CONVERSATION_ID, activeDigest } from '../fixtures/chatgpt-active-asset';

const sha256 = async (bytes: Uint8Array) => activeDigest(bytes);
const resolver = {
  resolverKey: activeDigest(new TextEncoder().encode('liska-chatgpt-resolver/1\u0000file_image')),
  downloadUrl: `https://chatgpt.com/backend-api/estuary/content?id=file_image&ts=1700000000&p=fs&cid=1&sig=${'a'.repeat(64)}&v=0`,
};

function ordinaryRaw() {
  return {
    conversation_id: ACTIVE_CONVERSATION_ID,
    title: 'Synthetic owner-context fixture',
    current_node: 'node',
    mapping: {
      node: {
        id: 'node',
        parent: null,
        children: [],
        message: {
          id: 'message',
          author: { role: 'assistant' },
          content: { content_type: 'text', parts: ['Synthetic'] },
          metadata: {
            attachments: [
              { id: 'file_image', mime_type: 'image/png', name: 'image.png' },
              { id: 'file_document', mime_type: 'application/pdf', name: '/mnt/data/document.pdf' },
              { id: 'file_library', mime_type: 'image/jpeg', library_file_id: 'private-library' },
            ],
          },
        },
      },
    },
  };
}

async function capture(
  raw: unknown,
  matchPageOwnedAssetResolvers = matchChatGptPageOwnedAssetResolvers,
  routeFamily: ChatGptRouteFamily = 'standard'
) {
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
        transientAssetResolvers: [resolver],
      },
    }),
    createCaptureId: () => `capture-chatgpt-${ACTIVE_CONVERSATION_ID}`,
    now: () => new Date(ACTIVE_AT),
    matchPageOwnedAssetResolvers,
  });
}

async function records(raw: unknown): Promise<RawCaptureAssetRecord[]> {
  return (await inventoryChatGptRawAssets({ raw, artifactId: 'conversation', sha256 })).assets;
}

function optionalDependencies() {
  return {
    observeResolvers: vi.fn(async () => ({ kind: 'matched' as const, candidates: [] })),
    observeInterpreterResolvers: vi.fn(async () => ({ kind: 'matched' as const, candidates: [] })),
    observeActiveResolvers: vi.fn(async () => ({ kind: 'matched' as const, candidates: [] })),
    resolveActiveAsset: vi.fn(),
    resolveLibraryAsset: vi.fn(),
    acquireAssets: vi.fn(),
    persistBinaryAssets: vi.fn(),
  } satisfies Partial<ChatGptAssetExportDependencies>;
}

function expectNoOptionalCalls(dependencies: ReturnType<typeof optionalDependencies>): void {
  for (const dependency of Object.values(dependencies)) expect(dependency).not.toHaveBeenCalled();
}

describe('ChatGPT owner-context attachment gate', () => {
  it.each(['direct', 'nested'])(
    'retains ordinary %s authority and capture matching',
    async envelope => {
      const raw = envelope === 'direct' ? ordinaryRaw() : { conversation: ordinaryRaw() };
      const assets = await records(raw);
      const eligible = assets.map(asset => asset.id);
      expect(assets).toHaveLength(3);
      expect(extractChatGptActiveResolverPlan(raw, assets).providerFileIds).toContain('file_image');
      expect(extractChatGptActiveImagePlan(raw, assets, eligible)?.providerFileId).toBe(
        'file_image'
      );
      expect(extractChatGptLibraryJpegPlan(raw, assets, eligible)?.providerFileId).toBe(
        'file_library'
      );
      expect(await extractChatGptInterpreterAssetPlan(raw, assets, sha256)).toHaveLength(1);
      expect(
        await matchChatGptPageOwnedAssetResolvers({ raw, assets, resolvers: [resolver], sha256 })
      ).toHaveLength(1);
      const matcher = vi.fn(matchChatGptPageOwnedAssetResolvers);
      const captured = await capture(raw, matcher);
      expect(matcher).toHaveBeenCalledOnce();
      expect(captured.transientAssetCandidates).toHaveLength(1);
      const { resolveActiveAsset, resolveLibraryAsset, ...dependencies } = optionalDependencies();
      const persistArtifacts = vi.fn(async (_bundle, _name, _provider, outputs) => ({
        activeOutputs: outputs,
        warnings: [],
      }));
      const result = await persistChatGptDestinationHonestAttachments(
        captured.assetExportContext!,
        captured.archiveCompanion,
        'thread.md',
        ['file'],
        { ...dependencies, persistArtifacts }
      );
      expect(dependencies.observeResolvers).toHaveBeenCalledOnce();
      expect(dependencies.observeInterpreterResolvers).toHaveBeenCalledOnce();
      expect(dependencies.observeActiveResolvers).toHaveBeenCalledOnce();
      expect(resolveActiveAsset).not.toHaveBeenCalled();
      expect(resolveLibraryAsset).not.toHaveBeenCalled();
      expect(result.completeDestinations).toEqual(['file']);
      expect(result.warnings).not.toContain(CHATGPT_ASSET_OWNER_CONTEXT_SKIPPED_WARNING);
    }
  );

  const deniedEvidence = [
    { gizmo_id: 'private-owner' },
    { gizmoId: 'private-owner' },
    { project_id: 'private-owner' },
    { projectId: 'private-owner' },
    { conversation_template_id: 'private-template' },
    { conversationTemplateId: 'private-template' },
    { gizmo_id: 'private-owner', gizmoId: 'private-conflict' },
    { project_id: 'private-owner', projectId: 'private-conflict' },
    { gizmo_id: 'private-owner', project_id: 'private-project' },
    { gizmo_id: 'private-owner', conversation_template_id: 'private-template' },
  ];

  it.each(deniedEvidence)(
    'blocks every raw authority helper, while Library association stays observable %#',
    async evidence => {
      for (const raw of [
        { ...ordinaryRaw(), ...evidence },
        { conversation: { ...ordinaryRaw(), ...evidence } },
      ]) {
        const assets = await records(raw);
        const eligible = assets.map(asset => asset.id);
        expect(extractChatGptActiveResolverPlan(raw, assets)).toEqual({ providerFileIds: [] });
        expect(extractChatGptActiveImagePlan(raw, assets, eligible)).toBeUndefined();
        expect(extractChatGptLibraryJpegPlan(raw, assets, eligible)).toBeUndefined();
        const digest = vi.fn(sha256);
        expect(await extractChatGptInterpreterAssetPlan(raw, assets, digest)).toEqual([]);
        expect(
          await matchChatGptPageOwnedAssetResolvers({
            raw,
            assets,
            resolvers: [resolver],
            sha256: digest,
          })
        ).toEqual([]);
        expect(digest).not.toHaveBeenCalled();
        expect(classifyChatGptLibraryAssets(raw, assets).associatedAssetIds).toHaveLength(1);
      }
    }
  );

  it.each(
    [...deniedEvidence, {}]
      .filter(evidence => !('gizmoId' in evidence && 'gizmo_id' in evidence))
      .flatMap(evidence =>
        (['standard', 'custom-gpt', 'project'] as const)
          .filter(routeFamily => routeFamily !== 'standard' || Object.keys(evidence).length > 0)
          .flatMap(routeFamily => [
            { evidence, nested: false, routeFamily },
            { evidence, nested: true, routeFamily },
          ])
      )
  )(
    'writes real raw then unchanged manifest/canonical without optional calls or audit %#',
    async ({ evidence, nested, routeFamily }) => {
      const matcher = vi.fn(matchChatGptPageOwnedAssetResolvers);
      const conversation = { ...ordinaryRaw(), ...evidence };
      const captured = await capture(
        nested ? { conversation } : conversation,
        matcher,
        routeFamily
      );
      expect(matcher).not.toHaveBeenCalled();
      expect(captured.transientAssetCandidates).toEqual([]);
      const context = captured.assetExportContext!;
      expect(context.routeFamily).toBe(routeFamily);
      for (const artifact of captured.archiveCompanion.artifacts) {
        expect(JSON.stringify(artifact)).not.toContain('routeFamily');
        if (artifact.transport === 'inline') {
          const serialized = Buffer.from(artifact.bodyBase64, 'base64').toString('utf8');
          expect(serialized).not.toContain('/g/');
          expect(serialized).not.toContain('pathname');
          expect(serialized).not.toContain('routeFamily');
        }
      }
      const originalRecords = structuredClone(context.rawCaptureBundle.manifest.assets);
      const optional = optionalDependencies();
      const order: string[] = [];
      const persistArtifacts: ChatGptAssetExportDependencies['persistArtifacts'] = async (
        bundle,
        _name,
        _provider,
        outputs,
        kinds
      ) => {
        order.push(kinds.join('+'));
        if (kinds.includes('manifest')) {
          const artifact = bundle.artifacts.find(artifact => artifact.kind === 'manifest')!;
          expect(artifact.transport).toBe('inline');
          if (artifact.transport !== 'inline')
            throw new Error('inline synthetic manifest required');
          const manifest = JSON.parse(Buffer.from(artifact.bodyBase64, 'base64').toString('utf8'));
          expect(manifest.assets).toEqual(originalRecords);
          expect(JSON.stringify(manifest)).not.toContain('active resolver');
          const canonical = bundle.artifacts.find(artifact => artifact.kind === 'canonical')!;
          expect(canonical.transport).toBe('inline');
          if (canonical.transport !== 'inline')
            throw new Error('inline synthetic canonical required');
          const archive = JSON.parse(Buffer.from(canonical.bodyBase64, 'base64').toString('utf8'));
          expect(Object.values(archive.assets)).toHaveLength(3);
          expect(
            Object.values(archive.assets).every(
              asset =>
                (asset as { acquisition: { state: string } }).acquisition.state === 'not-attempted'
            )
          ).toBe(true);
        }
        return { activeOutputs: outputs as PersistentOutputDestination[], warnings: [] };
      };
      const result = await persistChatGptDestinationHonestAttachments(
        context,
        captured.archiveCompanion,
        'thread.md',
        ['file', 'obsidian'],
        { ...optional, persistArtifacts }
      );
      expectNoOptionalCalls(optional);
      expect(order).toEqual(['raw', 'manifest+canonical', 'manifest+canonical']);
      expect(result.completeDestinations).toEqual(['file', 'obsidian']);
      expect(result.warnings).toEqual([CHATGPT_ASSET_OWNER_CONTEXT_SKIPPED_WARNING]);
      expect(context.rawCaptureBundle.manifest.assets).toEqual(originalRecords);
    }
  );

  it.each([
    ['standard', true],
    ['custom-gpt', false],
    ['project', false],
    ['custom-gpt', true],
    ['project', true],
  ] as const)(
    'guards observers and context planners on %s (raw owner=%s)',
    async (routeFamily, hasOwner) => {
      const captured = await capture(
        { ...ordinaryRaw(), ...(hasOwner ? { project_id: 'private-owner' } : {}) },
        undefined,
        routeFamily
      );
      const context = captured.assetExportContext!;
      const requestCapture = vi.fn();
      const requestResolvers = vi.fn();
      const eligible = context.rawCaptureBundle.manifest.assets.map(asset => asset.id);
      expect(await planChatGptActiveImageAsset(context, eligible)).toBeUndefined();
      expect(await planChatGptLibraryJpegAsset(context, eligible)).toBeUndefined();
      expect(await planChatGptInterpreterAssetIds(context)).toEqual([]);
      expect(await observeChatGptAssetResolvers(context, { requestCapture })).toEqual({
        kind: 'matched',
        candidates: [],
      });
      expect(await observeChatGptAssetResolvers(context, { requestResolvers })).toEqual({
        kind: 'matched',
        candidates: [],
      });
      expect(await observeChatGptActiveAssetResolvers(context)).toEqual({
        kind: 'matched',
        candidates: [],
      });
      expect(await observeChatGptInterpreterAssetResolvers(context)).toEqual({
        kind: 'matched',
        candidates: [],
      });
      expect(requestCapture).not.toHaveBeenCalled();
      expect(requestResolvers).not.toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    }
  );

  it.each([
    { ...ordinaryRaw(), gizmo_id: false },
    { ...ordinaryRaw(), project_id: {} },
    { ...ordinaryRaw(), conversation_template_id: [] },
    { ...ordinaryRaw(), gizmo_id: 'private-owner', gizmoId: 'private-conflict' },
    { ...ordinaryRaw(), conversation: { mapping: {} } },
    { ...ordinaryRaw(), mapping: undefined },
    { conversation: ordinaryRaw(), project_id: 'private-wrapper' },
  ])(
    'skips malformed/ambiguous verified raw without invoking optional dependencies %#',
    async raw => {
      const matcher = vi.fn(matchChatGptPageOwnedAssetResolvers);
      try {
        const deniedCapture = await capture(raw, matcher);
        expect(deniedCapture.transientAssetCandidates).toEqual([]);
      } catch (error) {
        expect(error).toMatchObject({ code: 'normalization-failed' });
      }
      expect(matcher).not.toHaveBeenCalled();
      // Such raw can be rejected by the existing normalizer before orchestration.
      // A controlled finalizer tests this independent raw-first boundary without
      // widening normalization or pretending an invalid graph has a canonical form.
      const captured = await capture(ordinaryRaw());
      const context: ChatGptAssetExportContext = captured.assetExportContext!;
      const bytes = new TextEncoder().encode(JSON.stringify(raw));
      const original = context.rawCaptureBundle.manifest;
      const eligible = original.assets.map(asset => asset.id);
      expect(extractChatGptActiveResolverPlan(raw, original.assets)).toEqual({
        providerFileIds: [],
      });
      expect(extractChatGptActiveImagePlan(raw, original.assets, eligible)).toBeUndefined();
      expect(extractChatGptLibraryJpegPlan(raw, original.assets, eligible)).toBeUndefined();
      const digest = vi.fn(sha256);
      expect(await extractChatGptInterpreterAssetPlan(raw, original.assets, digest)).toEqual([]);
      expect(
        await matchChatGptPageOwnedAssetResolvers({
          raw,
          assets: original.assets,
          resolvers: [resolver],
          sha256: digest,
        })
      ).toEqual([]);
      expect(digest).not.toHaveBeenCalled();
      const manifest = buildCaptureManifest({
        ...original,
        artifacts: [
          { ...original.artifacts[0], byteLength: bytes.byteLength, sha256: activeDigest(bytes) },
        ],
      });
      const rawArtifact = {
        ...context.rawArtifact,
        transport: 'inline' as const,
        byteLength: bytes.byteLength,
        sha256: activeDigest(bytes),
        bodyBase64: Buffer.from(bytes).toString('base64'),
      };
      context.rawArtifact = rawArtifact;
      context.rawCaptureBundle = {
        manifest,
        artifacts: [{ record: manifest.artifacts[0], bytes }],
        assets: [],
      };
      const companion: ArchiveCompanionBundle = {
        ...captured.archiveCompanion,
        artifacts: captured.archiveCompanion.artifacts.map(artifact =>
          artifact.kind === 'raw' ? rawArtifact : artifact
        ),
      };
      const optional = optionalDependencies();
      const order: string[] = [];
      const buildDestinationCompanion = vi.fn(async (_context, assets, runtimeAssets, audit) => {
        expect(assets).toEqual(original.assets);
        expect(runtimeAssets).toEqual([]);
        expect(audit).toBeUndefined();
        return companion;
      });
      const result = await persistChatGptDestinationHonestAttachments(
        context,
        companion,
        'thread.md',
        ['file'],
        {
          ...optional,
          buildDestinationCompanion,
          persistArtifacts: async (_bundle, _name, _provider, outputs, kinds) => {
            order.push(kinds.join('+'));
            return { activeOutputs: outputs as PersistentOutputDestination[], warnings: [] };
          },
        }
      );
      expectNoOptionalCalls(optional);
      expect(buildDestinationCompanion).toHaveBeenCalledOnce();
      expect(order).toEqual(['raw', 'manifest+canonical']);
      expect(result.completeDestinations).toEqual(['file']);
      expect(result.warnings).toEqual([CHATGPT_ASSET_OWNER_CONTEXT_SKIPPED_WARNING]);
    }
  );
});
