import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCaptureManifest, type RawCaptureAssetRecord } from '../../src/archive';
import {
  buildChatGptBinaryAwareArchiveCompanion,
  buildChatGptBinaryAwareDestinationArchive,
} from '../../src/content/capture/chatgpt-current-branch';
import {
  persistChatGptDestinationHonestAttachments,
  type ChatGptAssetExportDependencies,
} from '../../src/content/chatgpt-asset-export';
import { persistVerifiedBinaryAssets } from '../../src/content/staged-binary-persistence';
import { persistArchiveCompanionArtifacts } from '../../src/content/bootstrap';
import { completeChatGptProducerReceipt } from '../../src/content/chatgpt-producer-receipt';
import { adaptChatGptProducerEvidence } from '../../src/resumability-journal/producer-adapter';
import {
  admitNewCaptureOperation,
  FILE_ASSURANCE,
  OBSIDIAN_ASSURANCE,
  OPERATION_SCHEMA,
  STRICT_COMPLETENESS,
} from '../../src/resumability-journal/purpose';
import {
  snapshotChatGptProducerReceipt,
  type ChatGptProducerIntent,
  type ChatGptProducerReceipt,
} from '../../src/lib/chatgpt-producer-evidence';
import type {
  ChatGptAssetExportContext,
  ExtensionMessage,
  ExtensionSettings,
  StagedBinaryAssetResult,
} from '../../src/lib/types';

const mock = vi.hoisted(() => ({ client: vi.fn(), getFile: vi.fn(), put: vi.fn(), read: vi.fn() }));
vi.mock('../../src/lib/obsidian-api', async original => ({
  ...(await original<typeof import('../../src/lib/obsidian-api')>()),
  ObsidianApiClient: mock.client,
}));
import {
  handlePersistArchiveCompanion,
  resetOffscreenStateForTesting,
} from '../../src/background/output-handlers';
import { handleStagedBinaryAssetMessage } from '../../src/background/binary-asset-handlers';
import { handleArchiveStageMessage } from '../../src/background/archive-stage-handlers';

const conversationId = '11111111-2222-4333-8444-555555555555';
const captureId = `capture-chatgpt-${conversationId}`;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const keyHash = hash(
  new TextEncoder().encode(JSON.stringify(['liska-conversation-key/1', 'chatgpt', conversationId]))
);
const assetBytes = new Uint8Array([1, 2, 3]);
const settings = {
  obsidianApiKey: 'a'.repeat(32),
  obsidianUrl: 'http://127.0.0.1:27123',
  vaultPath: 'AI',
} as ExtensionSettings;
function intent(): ChatGptProducerIntent {
  return {
    operationId: 'operation-1',
    attemptId: 'attempt-1',
    captureId,
    provider: 'chatgpt',
    conversationId,
    conversationKey: `liska-conversation-key/1:${keyHash}`,
    catalogSha256: 'b'.repeat(64),
    requiredDestinations: ['file', 'obsidian'],
  };
}
function operation() {
  const reservation = intent();
  return admitNewCaptureOperation({
    schema: OPERATION_SCHEMA,
    purpose: 'new-capture',
    operationId: reservation.operationId,
    attemptId: reservation.attemptId,
    captureId,
    admission: {
      provider: 'chatgpt',
      conversationId,
      conversationKey: reservation.conversationKey,
    },
    sourceSelection: { catalogSha256: reservation.catalogSha256 },
    destinations: [
      { destination: 'file', assurance: FILE_ASSURANCE },
      { destination: 'obsidian', assurance: OBSIDIAN_ASSURANCE },
    ],
    completenessPolicy: STRICT_COMPLETENESS,
  });
}
function context(withAsset: boolean): ChatGptAssetExportContext {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      conversation_id: conversationId,
      title: 'Synthetic',
      current_node: 'a',
      mapping: {
        a: {
          id: 'a',
          parent: null,
          children: [],
          message: {
            id: 'a',
            author: { role: 'assistant' },
            content: { content_type: 'text', parts: ['[asset](sandbox:/mnt/data/a.png)'] },
          },
        },
      },
    })
  );
  const record = {
    id: 'conversation',
    relativePath: 'responses/conversation.json',
    mediaType: 'application/json',
    byteLength: bytes.length,
    sha256: hash(bytes),
    endpoint: { method: 'GET' as const, pathPattern: '/backend-api/conversation/{conversationId}' },
  };
  const assets: RawCaptureAssetRecord[] = withAsset
    ? [
        {
          id: `chatgpt-asset-${'a'.repeat(64)}`,
          state: 'not-attempted',
          attemptedAt: null,
          relativePath: null,
          mediaType: 'image/png',
          byteLength: null,
          sha256: null,
          detail: 'raw-inventory-not-attempted',
          sourceRefs: [
            { artifactId: 'conversation', rawPointer: '/mapping/a/message/content/parts/0' },
          ],
        },
      ]
    : [];
  const manifest = buildCaptureManifest({
    captureId,
    provider: 'chatgpt',
    conversationId,
    capturedAt: '2026-09-01T12:00:00.000Z',
    method: 'same-origin-api',
    artifacts: [record],
    assets,
    completeness: {
      graph: 'complete',
      messages: 'complete',
      branches: 'complete',
      assets: withAsset ? 'not-attempted' : 'complete',
    },
  });
  return {
    conversationId,
    routeFamily: 'standard',
    rawCaptureBundle: { manifest, artifacts: [{ record, bytes }], assets: [] },
    rawArtifact: {
      transport: 'inline',
      kind: 'raw',
      relativePath: record.relativePath,
      mediaType: 'application/json',
      byteLength: bytes.length,
      sha256: record.sha256,
      bodyBase64: Buffer.from(bytes).toString('base64'),
    },
  };
}

type Mode =
  | 'ok'
  | 'raw-file-failure'
  | 'canonical-file-failure'
  | 'binary-obsidian-failure'
  | 'unknown-raw'
  | 'missing-raw'
  | 'not-attempted'
  | 'failed'
  | 'partial'
  | 'manual'
  | 'different-manifests'
  | 'staged-raw';
let mode: Mode;
let vault: Map<string, Uint8Array>;
let stagedRawBytes: Uint8Array;
const originalFetch = globalThis.fetch;
beforeEach(() => {
  mode = 'ok';
  vault = new Map();
  resetOffscreenStateForTesting();
  mock.client.mockImplementation(function () {
    return { getFile: mock.getFile, putBinaryFile: mock.put, getBinaryFileBounded: mock.read };
  });
  mock.getFile.mockResolvedValue(null);
  mock.put.mockImplementation(async (path: string, bytes: Uint8Array) => {
    vault.set(path, bytes.slice());
  });
  mock.read.mockImplementation(async (path: string) =>
    mode === 'binary-obsidian-failure' && path.includes('/assets/')
      ? new Uint8Array([9])
      : vault.get(path)
  );
  let downloadId = 0;
  const paths = new Map<number, string>();
  vi.mocked(chrome.downloads.download).mockImplementation((options, callback) => {
    paths.set(++downloadId, options.filename!);
    callback?.(downloadId);
    return downloadId as unknown as ReturnType<typeof chrome.downloads.download>;
  });
  vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) => {
    const path = paths.get(id!)!;
    const mismatch =
      (mode === 'raw-file-failure' && path.endsWith('/responses/conversation.json')) ||
      (mode === 'canonical-file-failure' && path.endsWith('/canonical/liska-thread-1.json'));
    return [
      {
        id,
        state: 'complete',
        filename: `C:/Downloads/${mismatch ? 'renamed.json' : path}`,
      } as chrome.downloads.DownloadItem,
    ];
  });
  const store: Record<string, unknown> = {};
  vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({ ...store }));
  vi.mocked(chrome.storage.local.set).mockImplementation(async values => {
    Object.assign(store, values);
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) => new Response(url.endsWith('/raw-stage') ? stagedRawBytes : assetBytes)
    )
  );
  const route = async (value: unknown) => {
    const message = value as ExtensionMessage;
    if (message.action === 'persistArchiveCompanion') {
      if (mode === 'unknown-raw' && message.artifact.kind === 'raw')
        throw new Error('private write status unknown');
      const result = await handlePersistArchiveCompanion(message, settings);
      if (mode === 'missing-raw' && message.artifact.kind === 'raw')
        result.results.forEach(item => {
          delete item.sinkObservation;
        });
      return result;
    }
    if (
      [
        'beginStagedBinaryAsset',
        'appendStagedBinaryAsset',
        'commitStagedBinaryAsset',
        'abortStagedBinaryAsset',
      ].includes(message.action)
    )
      return handleStagedBinaryAssetMessage(
        message as Extract<ExtensionMessage, { action: 'commitStagedBinaryAsset' }>,
        settings
      );
    if (message.action === 'commitStagedArchiveCompanion')
      return handleArchiveStageMessage(message, settings);
    const action = (value as { action: string }).action;
    if (action === 'archiveBlobCreate' || action === 'binaryStageFinalize')
      return { success: true, url: 'blob:chrome-extension://test-extension-id/fixture' };
    if (action === 'archiveStageCreateUrl')
      return { success: true, url: 'blob:chrome-extension://test-extension-id/raw-stage' };
    return { success: true };
  };
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(
    (value: unknown, callback?: (result: unknown) => void) => {
      const pending = route(value).catch(() => undefined);
      if (typeof callback === 'function') void pending.then(callback);
      return pending;
    }
  );
});
afterEach(() => {
  vi.stubGlobal('fetch', originalFetch);
  resetOffscreenStateForTesting();
});

async function produce(
  selected: Mode = 'ok',
  withAsset = false,
  overrides: Partial<ChatGptAssetExportDependencies> = {}
) {
  mode = selected;
  const ctx = context(withAsset);
  if (mode === 'staged-raw') {
    stagedRawBytes = ctx.rawCaptureBundle.artifacts[0].bytes;
    const raw = ctx.rawArtifact;
    ctx.rawArtifact = {
      transport: 'staged',
      stageId: `archive-stage-${'A'.repeat(32)}`,
      kind: 'raw',
      relativePath: raw.relativePath,
      byteLength: raw.byteLength,
      sha256: raw.sha256,
      mediaType: 'application/json',
    };
  }
  if (mode === 'partial') ctx.rawCaptureBundle.manifest.completeness.graph = 'partial';
  const companion = await buildChatGptBinaryAwareArchiveCompanion(
    ctx,
    ctx.rawCaptureBundle.manifest.assets,
    []
  );
  const records = ctx.rawCaptureBundle.manifest.assets.map(record =>
    mode === 'not-attempted' || mode === 'failed'
      ? {
          ...record,
          state: mode,
          attemptedAt: mode === 'failed' ? '2026-09-01T12:01:00.000Z' : null,
        }
      : {
          ...record,
          state: 'fetched' as const,
          attemptedAt: '2026-09-01T12:01:00.000Z',
          relativePath: `assets/${hash(assetBytes)}.png`,
          byteLength: assetBytes.length,
          sha256: hash(assetBytes),
          detail: 'page-owned-signed-response',
        }
  );
  let finalized = 0;
  const result = await persistChatGptDestinationHonestAttachments(
    ctx,
    companion,
    'synthetic.md',
    ['file', 'obsidian'],
    {
      ...(mode !== 'manual' && { producerIntent: intent() }),
      persistArtifacts: persistArchiveCompanionArtifacts,
      observeResolvers: async () => ({
        kind: 'matched',
        candidates: records.map(record => ({
          assetId: record.id,
          downloadUrl: 'https://example.invalid/synthetic',
        })),
      }),
      acquireAssets: async () => ({
        records,
        runtimeAssets: records
          .filter(record => record.state === 'fetched')
          .map(record => ({ record, bytes: assetBytes })),
        completeness: 'complete',
      }),
      ...(mode === 'different-manifests' && {
        buildDestinationArchive: (
          ...args: Parameters<typeof buildChatGptBinaryAwareDestinationArchive>
        ) =>
          buildChatGptBinaryAwareDestinationArchive(args[0], args[1], args[2], args[3], [
            `synthetic-destination-${++finalized}`,
          ]),
      }),
      ...overrides,
    }
  );
  return {
    result,
    adapted: await adaptChatGptProducerEvidence(operation(), result.producerReceipts ?? [], hash),
  };
}
const mutable = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('real current producer facts into isolated purpose adapter', () => {
  it('cannot acquire missing binary sink evidence during a later destination-builder await', async () => {
    let retained: StagedBinaryAssetResult[] = [];
    let actualFacts: StagedBinaryAssetResult[] = [];
    const { result, adapted } = await produce('ok', true, {
      persistBinaryAssets: async input => {
        retained = await persistVerifiedBinaryAssets(input);
        actualFacts = mutable(retained);
        retained.forEach(item =>
          item.results.forEach(output => {
            delete output.sinkObservation;
          })
        );
        return retained;
      },
      buildDestinationArchive: async (...args) => {
        await Promise.resolve();
        retained.forEach((item, index) =>
          item.results.forEach((output, outputIndex) => {
            output.sinkObservation = actualFacts[index].results[outputIndex].sinkObservation;
          })
        );
        return buildChatGptBinaryAwareDestinationArchive(...args);
      },
    });
    expect(adapted.assessment.kind).toBe('insufficient');
    for (const receipt of result.producerReceipts!) {
      expect(receipt.assets[0].state).toBe('fetched');
      expect(
        receipt.observations.find(item => item.commitment.relativePath.startsWith('assets/'))
          ?.observation
      ).toBeUndefined();
    }
  });
  it('pins binary commitments and both destination inventories before sequential destination awaits', async () => {
    let retained: StagedBinaryAssetResult[] = [];
    let mutateAcquired = () => {};
    const { result, adapted } = await produce('ok', true, {
      persistBinaryAssets: async input => {
        retained = await persistVerifiedBinaryAssets(input);
        mutateAcquired = () => {
          const runtime = input.assets[0];
          if ('record' in runtime) runtime.record.state = 'failed';
        };
        return retained;
      },
      buildDestinationArchive: async (...args) => {
        await Promise.resolve();
        retained.forEach(item => {
          Object.assign(item.descriptor!, { byteLength: 999, sha256: 'f'.repeat(64) });
          item.results.forEach(output => {
            output.success = false;
            delete output.sinkObservation;
          });
        });
        mutateAcquired();
        return buildChatGptBinaryAwareDestinationArchive(...args);
      },
    });
    expect(adapted.assessment.kind).toBe('consistent');
    for (const receipt of result.producerReceipts!) {
      expect(receipt.assets[0].state).toBe('fetched');
      expect(receipt.assets[0].commitment?.byteLength).toBe(assetBytes.length);
      expect(receipt.assets[0].commitment?.sha256).toBe(hash(assetBytes));
    }
  });
  it('does not let finalization replace an earlier missing raw observation', async () => {
    const { result } = await produce();
    const receipt = result.producerReceipts![0];
    const raw = receipt.observations.find(
      item => item.commitment.relativePath === receipt.raw.relativePath
    )!;
    const missing = snapshotChatGptProducerReceipt({
      ...receipt,
      observations: receipt.observations.filter(item => item !== raw),
    });
    expect(() => completeChatGptProducerReceipt(missing, [raw])).toThrow(
      'invalid-producer-evidence'
    );
    expect(
      (
        await adaptChatGptProducerEvidence(
          operation(),
          [missing, result.producerReceipts![1]],
          hash
        )
      ).assessment.kind
    ).toBe('insufficient');
  });
  it('detaches reservation, raw observations and exact destination metadata across producer awaits', async () => {
    const ctx = context(false);
    const companion = await buildChatGptBinaryAwareArchiveCompanion(ctx, [], []);
    const reservation = mutable(intent());
    let earlier: Awaited<ReturnType<typeof persistArchiveCompanionArtifacts>> | undefined;
    let manifest: ChatGptAssetExportContext['rawCaptureBundle']['manifest'] | undefined;
    const result = await persistChatGptDestinationHonestAttachments(
      ctx,
      companion,
      'synthetic.md',
      ['file', 'obsidian'],
      {
        producerIntent: reservation,
        buildDestinationArchive: async (...args) => {
          const built = await buildChatGptBinaryAwareDestinationArchive(...args);
          manifest = built.manifest;
          return built;
        },
        persistArtifacts: async (...args) => {
          Object.assign(reservation, { catalogSha256: 'f'.repeat(64) });
          if (args[4].includes('raw')) {
            earlier = mutable(await persistArchiveCompanionArtifacts(...args));
            return earlier;
          }
          if (manifest) {
            manifest.captureId = 'mutated';
            manifest.completeness.graph = 'partial';
          }
          if (earlier?.observations)
            Object.assign(earlier.observations[0].commitment, { sha256: 'f'.repeat(64) });
          return persistArchiveCompanionArtifacts(...args);
        },
      }
    );
    expect(
      (await adaptChatGptProducerEvidence(operation(), result.producerReceipts, hash)).assessment
        .kind
    ).toBe('consistent');
  });
  it.each(['captureId', 'conversationId', 'requiredDestinations'] as const)(
    'rejects a mismatched %s reservation before any sink dispatch',
    async field => {
      const ctx = context(false);
      const companion = await buildChatGptBinaryAwareArchiveCompanion(ctx, [], []);
      const reservation = {
        ...intent(),
        [field]: field === 'requiredDestinations' ? ['file'] : 'mismatch',
      } as ChatGptProducerIntent;
      const persistArtifacts = vi.fn();
      const result = await persistChatGptDestinationHonestAttachments(
        ctx,
        companion,
        'synthetic.md',
        ['file', 'obsidian'],
        { producerIntent: reservation, persistArtifacts }
      );
      expect(persistArtifacts).not.toHaveBeenCalled();
      expect(result.producerReceipts).toBeUndefined();
    }
  );
  it.each(['file-as-readback', 'readback-length', 'readback-hash', 'file-path'] as const)(
    'does not overstate %s assurance',
    async mutation => {
      const { result } = await produce();
      const receipts = mutable(result.producerReceipts!);
      const observation = mutation.startsWith('readback')
        ? receipts[1].observations[0]
        : receipts[0].observations[0];
      if (mutation === 'file-as-readback')
        Object.assign(observation, {
          observation: {
            kind: OBSIDIAN_ASSURANCE,
            byteLength: observation.commitment.byteLength,
            sha256: observation.commitment.sha256,
          },
        });
      if (mutation === 'readback-length')
        Object.assign(observation.observation!, { byteLength: 0 });
      if (mutation === 'readback-hash')
        Object.assign(observation.observation!, { sha256: 'f'.repeat(64) });
      if (mutation === 'file-path')
        Object.assign(observation.observation!, { observedRelativePath: 'other.json' });
      expect(
        (await adaptChatGptProducerEvidence(operation(), receipts, hash)).assessment.kind
      ).toBe('conflict');
    }
  );
  it('retains staged raw assurance through the real current staged handler and finalizer', async () => {
    const { result, adapted } = await produce('staged-raw');
    expect(adapted.assessment).toEqual({ kind: 'consistent', codes: [] });
    expect(result.producerRaw?.observations).toHaveLength(2);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'commitStagedArchiveCompanion' }),
      expect.any(Function)
    );
    expect(mock.read).toHaveBeenCalledTimes(3);
  });
  it('assesses independently generated different destination manifests without merging them', async () => {
    const { result, adapted } = await produce('different-manifests', true);
    expect(adapted.assessment.kind).toBe('consistent');
    expect(result.producerReceipts![0].manifest.sha256).not.toBe(
      result.producerReceipts![1].manifest.sha256
    );
    expect(adapted.evidence?.destinations?.map(item => item.assurance?.manifest?.sha256)).toEqual(
      result.producerReceipts?.map(item => item.manifest.sha256)
    );
  });
  it.each([false, true])(
    'retains actual all-destination sink observations (assets=%s)',
    async withAsset => {
      const { result, adapted } = await produce('ok', withAsset);
      expect(adapted.assessment).toEqual({ kind: 'consistent', codes: [] });
      expect(result.producerReceipts).toHaveLength(2);
      for (const receipt of result.producerReceipts!) {
        expect(receipt.observations).toHaveLength(withAsset ? 4 : 3);
        expect(Object.isFrozen(receipt)).toBe(true);
        expect(receipt.requestedDestinations).toEqual(['file', 'obsidian']);
        for (const item of receipt.observations) {
          if (receipt.destination === 'file')
            expect(item.observation).toEqual({
              kind: FILE_ASSURANCE,
              observedRelativePath: item.commitment.relativePath,
            });
          else
            expect(item.observation).toEqual({
              kind: OBSIDIAN_ASSURANCE,
              byteLength: item.commitment.byteLength,
              sha256: item.commitment.sha256,
            });
        }
        expect(receipt.legacyRoutingDigest).not.toBe(keyHash);
      }
      expect(chrome.downloads.download).toHaveBeenCalledTimes(withAsset ? 4 : 3);
      expect(mock.read).toHaveBeenCalledTimes(withAsset ? 4 : 3);
      expect(JSON.stringify(result.producerReceipts)).not.toMatch(
        /blob:|https:|C:\\|sandbox:|apiKey/
      );
    }
  );
  it.each([
    'raw-file-failure',
    'canonical-file-failure',
    'unknown-raw',
    'missing-raw',
    'partial',
    'manual',
  ] as const)('never promotes %s into consistency', async selected => {
    const { result, adapted } = await produce(selected);
    expect(adapted.assessment.kind).toBe('insufficient');
    if (selected === 'raw-file-failure') {
      expect(result.producerReceipts?.map(receipt => receipt.destination)).toEqual(['obsidian']);
      expect(result.producerReceipts?.[0].requestedDestinations).toEqual(['file', 'obsidian']);
    }
    if (selected === 'unknown-raw') expect(result.producerRaw?.observations).toHaveLength(2);
    if (selected === 'missing-raw') expect(adapted.assessment.codes).toContain('delivery-missing');
    if (selected === 'manual') expect(result.producerReceipts?.[0].intent).toBeUndefined();
  });
  it.each(['binary-obsidian-failure', 'not-attempted', 'failed'] as const)(
    'retains full inventory and destination-specific manifests for %s',
    async selected => {
      const { result, adapted } = await produce(selected, true);
      expect(adapted.assessment.kind).not.toBe('consistent');
      expect(result.producerReceipts?.every(receipt => receipt.assets.length === 1)).toBe(true);
      if (selected === 'binary-obsidian-failure') {
        const [file, obsidian] = result.producerReceipts!;
        expect(file.assets[0].state).toBe('fetched');
        expect(obsidian.assets[0].state).toBe('failed');
        expect(file.manifest.sha256).not.toBe(obsidian.manifest.sha256);
      }
    }
  );
  it('does not promote legacy receipt-only inputs', async () => {
    const { result } = await produce();
    const adapted = await adaptChatGptProducerEvidence(
      operation(),
      result.destinationReceipts,
      hash
    );
    expect(adapted.adapterCode).toBe('unsupported-producer-receipt');
    expect(adapted.assessment.kind).toBe('insufficient');
  });
  it.each(['captureId', 'catalogSha256', 'conversationKey', 'operationId', 'attemptId'] as const)(
    'rejects mismatched reserved %s',
    async field => {
      const { result } = await produce();
      const receipts = mutable(result.producerReceipts!) as unknown as {
        intent: Record<string, string>;
      }[];
      receipts[0].intent[field] =
        field === 'catalogSha256'
          ? 'c'.repeat(64)
          : field === 'conversationKey'
            ? `liska-conversation-key/1:${'c'.repeat(64)}`
            : 'other';
      expect(
        (await adaptChatGptProducerEvidence(operation(), receipts, hash)).assessment.kind
      ).toBe('conflict');
    }
  );
  it.each(['raw', 'manifest', 'canonical'] as const)(
    'detects exact %s commitment conflicts',
    async field => {
      const { result } = await produce();
      const receipts = mutable(result.producerReceipts!) as unknown as Record<
        string,
        { sha256: string }
      >[];
      receipts[0][field].sha256 = 'f'.repeat(64);
      expect(
        (await adaptChatGptProducerEvidence(operation(), receipts, hash)).assessment.kind
      ).toBe('conflict');
    }
  );
  it('keeps independent destination manifests and does not reuse assurance', async () => {
    const { result } = await produce();
    const receipts = mutable(result.producerReceipts!) as ChatGptProducerReceipt[];
    const bad = { ...receipts[1], observations: receipts[0].observations };
    expect(
      (await adaptChatGptProducerEvidence(operation(), [receipts[0], bad], hash)).assessment.kind
    ).toBe('conflict');
  });
  it('snapshots before async hash, freezes outputs and hashes the exact catalog UTF-8 recipe', async () => {
    const { result } = await produce();
    const receipts = mutable(result.producerReceipts!);
    const op = mutable(operation());
    const baseline = await adaptChatGptProducerEvidence(op, receipts, hash);
    const inputs: string[] = [];
    const changed = await adaptChatGptProducerEvidence(op, receipts, async bytes => {
      inputs.push(new TextDecoder().decode(bytes));
      Object.assign(receipts[0], { captureId: 'mutated' });
      Object.assign(receipts[1], { legacyRoutingDigest: 'f'.repeat(64) });
      Object.assign(op.admission, { conversationId: 'mutated' });
      Object.assign(op.sourceSelection, { catalogSha256: 'f'.repeat(64) });
      await Promise.resolve();
      return hash(bytes);
    });
    expect(inputs).toEqual([
      JSON.stringify(['liska-conversation-key/1', 'chatgpt', conversationId]),
      conversationId,
    ]);
    expect(changed).toEqual(baseline);
    expect(Object.isFrozen(changed.evidence?.destinations?.[0].assurance?.artifacts)).toBe(true);
  });
  it('rejects a legacy digest disguised with the versioned prefix', async () => {
    const op = mutable(operation());
    Object.assign(op.admission, {
      conversationKey: `liska-conversation-key/1:${hash(new TextEncoder().encode(conversationId))}`,
    });
    expect((await adaptChatGptProducerEvidence(op, [], hash)).assessment.kind).toBe('conflict');
  });
  it.each([0, 1])(
    'rejects the wrong legacy routing digest on destination %s independently',
    async index => {
      const { result } = await produce();
      const receipts = mutable(result.producerReceipts!);
      Object.assign(receipts[index], { legacyRoutingDigest: keyHash });
      expect(await adaptChatGptProducerEvidence(operation(), receipts, hash)).toEqual({
        adapterCode: 'identity-conflict',
        assessment: { kind: 'conflict', codes: ['identity-conflict'] },
      });
    }
  );
  it.each(['throw', 'invalid', 'wrong'] as const)(
    'normalizes a %s second hash without reusing the first digest',
    async failure => {
      const { result } = await produce();
      let calls = 0;
      const adapted = await adaptChatGptProducerEvidence(
        operation(),
        result.producerReceipts,
        bytes => {
          if (++calls === 1) return hash(bytes);
          if (failure === 'throw') throw new Error('private second hash failure');
          return failure === 'invalid' ? 'invalid' : keyHash;
        }
      );
      expect(calls).toBe(2);
      expect(adapted).toEqual(
        failure === 'wrong'
          ? {
              adapterCode: 'identity-conflict',
              assessment: { kind: 'conflict', codes: ['identity-conflict'] },
            }
          : {
              adapterCode: 'hash-failed',
              assessment: { kind: 'rejected', codes: ['invalid-evidence'] },
            }
      );
    }
  );
  it.each(['getter', 'toJSON', 'cycle', 'symbol', 'proxy', 'oversize'] as const)(
    'rejects hostile %s without leaking exceptions or invoking accessors',
    async shape => {
      const { result } = await produce();
      const receipts = mutable(result.producerReceipts!);
      const spy = vi.fn(() => {
        throw new Error('private payload');
      });
      if (shape === 'getter')
        Object.defineProperty(receipts[0], 'captureId', { get: spy, enumerable: true });
      if (shape === 'toJSON') Object.assign(receipts[0], { toJSON: spy });
      if (shape === 'cycle') Object.assign(receipts[0], { cycle: receipts });
      if (shape === 'symbol') Object.assign(receipts[0], { [Symbol('private')]: true });
      if (shape === 'proxy') receipts[0] = new Proxy(receipts[0], { ownKeys: spy });
      if (shape === 'oversize') Object.assign(receipts[0], { captureId: 'a'.repeat(1025) });
      const adapted = await adaptChatGptProducerEvidence(operation(), receipts, hash);
      expect(adapted).toEqual({
        adapterCode: 'invalid-producer-evidence',
        assessment: { kind: 'rejected', codes: ['invalid-evidence'] },
      });
      if (shape !== 'proxy') expect(spy).not.toHaveBeenCalled();
    }
  );
  it.each([
    () => {
      throw new Error('private hash failure');
    },
    async () => 'not-a-hash',
  ])('normalizes failed hashing', async hasher => {
    const { result } = await produce();
    expect(
      await adaptChatGptProducerEvidence(operation(), result.producerReceipts, hasher)
    ).toEqual({
      adapterCode: 'hash-failed',
      assessment: { kind: 'rejected', codes: ['invalid-evidence'] },
    });
  });
  it('validates strict schema and prevents extra fields and absolute paths', async () => {
    const { result } = await produce();
    const receipt = result.producerReceipts![0];
    expect(() => snapshotChatGptProducerReceipt({ ...receipt, secret: 'no' })).toThrow(
      'invalid-producer-evidence'
    );
    expect(() =>
      snapshotChatGptProducerReceipt({
        ...receipt,
        raw: { ...receipt.raw, relativePath: 'C:/private/raw.json' },
      })
    ).toThrow('invalid-producer-evidence');
  });
});
