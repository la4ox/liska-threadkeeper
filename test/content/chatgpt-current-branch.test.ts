import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import rawFixture from '../fixtures/archive/chatgpt-raw/branching-mixed-content.json';
import {
  CHATGPT_CAPTURE_ENDPOINT,
  createChatGptCaptureFailure,
  type ChatGptCaptureResponse,
} from '../../src/lib/chatgpt-capture-contract';
import {
  ChatGptCurrentBranchError,
  assertJsonOnlyArchiveCompanionSafe,
  buildChatGptBinaryAwareArchiveCompanion,
  captureChatGptArchive,
  captureChatGptCurrentBranch,
  manifestAllowsChatGptStructuredCapture,
  observeChatGptActiveAssetResolvers,
  observeChatGptAssetResolvers,
  verifyChatGptAssetExportContext,
} from '../../src/content/capture/chatgpt-current-branch';
import {
  buildCaptureManifest,
  normalizeChatGptCapture,
  type RawCaptureBundle,
} from '../../src/archive';
import { sha256Hex } from '../../src/content/capture/response';

const activeResolverMocks = vi.hoisted(() => ({ probe: vi.fn() }));

vi.mock('../../src/content/capture/chatgpt-active-resolver-request', () => ({
  probeChatGptActiveAssetResolvers: activeResolverMocks.probe,
}));

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const CAPTURE_TIME = '2026-08-17T12:00:00.000Z';

const originalManifestDescriptor = Object.getOwnPropertyDescriptor(chrome.runtime, 'getManifest');
const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalAtobDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'atob');

function restoreGlobal(name: 'crypto' | 'atob', descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete (globalThis as unknown as Record<string, unknown>)[name];
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  restoreGlobal('crypto', originalCryptoDescriptor);
  restoreGlobal('atob', originalAtobDescriptor);
  if (originalManifestDescriptor) {
    Object.defineProperty(chrome.runtime, 'getManifest', originalManifestDescriptor);
  } else {
    delete (chrome.runtime as { getManifest?: unknown }).getManifest;
  }
});

beforeEach(() => {
  activeResolverMocks.probe.mockReset();
});

function setManifestReader(reader: () => unknown): void {
  Object.defineProperty(chrome.runtime, 'getManifest', {
    value: reader,
    configurable: true,
  });
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

async function successfulResponse(
  mutate?: (payload: Record<string, unknown>) => void
): Promise<ChatGptCaptureResponse> {
  const payload = JSON.parse(JSON.stringify(rawFixture)) as Record<string, unknown>;
  payload.conversation_id = CONVERSATION_ID;
  payload.url = `https://chatgpt.com/c/${CONVERSATION_ID}`;
  mutate?.(payload);

  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return {
    success: true,
    data: {
      bodyBase64: base64(bytes),
      byteLength: bytes.byteLength,
      sha256: await sha256Hex(bytes),
      mediaType: 'application/json',
      endpoint: CHATGPT_CAPTURE_ENDPOINT,
      transientAssetResolvers: [],
    },
  };
}

function fixedNow(): Date {
  return new Date(CAPTURE_TIME);
}

function fixedCaptureId(): string {
  return 'capture-chatgpt-01234567-89ab-4cde-8f01-23456789abcd';
}

function parseBase64Json(value: string): Record<string, unknown> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

describe('ChatGPT current-branch capture composition', () => {
  it('enables the structured bridge only when the static manifest declares scripting', () => {
    setManifestReader(() => ({ permissions: ['storage', 'scripting'] }));
    expect(manifestAllowsChatGptStructuredCapture()).toBe(true);

    setManifestReader(() => ({ permissions: ['storage'] }));
    expect(manifestAllowsChatGptStructuredCapture()).toBe(false);
  });

  it('fails closed when the manifest API is missing or throws', () => {
    delete (chrome.runtime as { getManifest?: unknown }).getManifest;
    expect(manifestAllowsChatGptStructuredCapture()).toBe(false);

    setManifestReader(() => {
      throw new Error('browser diagnostic must not cross the capture boundary');
    });
    expect(manifestAllowsChatGptStructuredCapture()).toBe(false);
  });

  it('captures the complete canonical graph and all companions exactly once', async () => {
    const requestCapture = vi.fn().mockResolvedValue(await successfulResponse());
    const normalizeCapture = vi.fn(normalizeChatGptCapture);

    const capture = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture,
      normalizeCapture,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });

    expect(requestCapture).toHaveBeenCalledOnce();
    expect(requestCapture).toHaveBeenCalledWith(CONVERSATION_ID, false);
    expect(normalizeCapture).toHaveBeenCalledOnce();
    expect(capture.archive.graph.nodes['node/alternate']?.message?.id).toBe('message/alternate');
    expect(capture.archiveCompanion.artifacts.map(artifact => artifact.kind)).toEqual([
      'raw',
      'manifest',
      'canonical',
    ]);
    expect(capture.transientAssetCandidates).toEqual([]);
  });

  it('builds a not-attempted attachment ledger without upgrading asset acquisition completeness', async () => {
    const capture = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture: () => successfulResponse(),
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });
    const manifestArtifact = capture.archiveCompanion.artifacts.find(
      artifact => artifact.kind === 'manifest'
    );
    const manifest = parseBase64Json(manifestArtifact?.bodyBase64 ?? '');

    expect(manifest.completeness).toMatchObject({ assets: 'not-attempted' });
    expect(manifest.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: 'not-attempted',
          attemptedAt: null,
          byteLength: null,
          sha256: null,
          detail: 'raw-inventory-not-attempted',
        }),
      ])
    );
    expect(JSON.stringify(manifest)).not.toContain('synthetic-image-1');
    expect(JSON.stringify(capture.archive.assets)).toContain('synthetic-image-1');
    expect(JSON.stringify(capture.archive.assets)).not.toContain('signature=not-retained');
  });

  it('matches opt-in page-owned resolvers transiently without persisting their signed URLs', async () => {
    const response = await successfulResponse();
    if (!response.success) throw new Error('synthetic capture response must succeed');
    const signedUrl =
      `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
      '&id=signed-transport-id&p=path&sig=transport-signature-secret&ts=123&v=1';
    response.data.transientAssetResolvers = [
      {
        resolverKey: await sha256Hex(
          new TextEncoder().encode('liska-chatgpt-resolver/1\u0000synthetic-file-2')
        ),
        downloadUrl: signedUrl,
      },
    ];
    const requestCapture = vi.fn().mockResolvedValue(response);

    const capture = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture,
      observeAssetResolvers: true,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });

    expect(requestCapture).toHaveBeenCalledWith(CONVERSATION_ID, true);
    expect(capture.transientAssetCandidates).toEqual([
      {
        assetId: expect.stringMatching(/^chatgpt-asset-[a-f0-9]{64}$/),
        downloadUrl: signedUrl,
      },
    ]);
    expect(
      JSON.stringify({ archive: capture.archive, companion: capture.archiveCompanion })
    ).not.toContain('transport-signature-secret');
  });

  it('binds an observed resolver recapture to original raw bytes before binary-aware finalization', async () => {
    const originalResponse = await successfulResponse();
    const capture = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture: () => originalResponse,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });
    const signedSentinel = 'signed-resolver-sentinel-not-persisted';
    const observedResponse = await successfulResponse();
    if (!observedResponse.success) throw new Error('synthetic capture response must succeed');
    observedResponse.data.transientAssetResolvers = [
      {
        resolverKey: await sha256Hex(
          new TextEncoder().encode('liska-chatgpt-resolver/1\u0000synthetic-file-2')
        ),
        downloadUrl:
          `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
          `&id=asset&p=p&sig=${signedSentinel}&ts=1&v=1`,
      },
    ];
    const requestCapture = vi.fn().mockResolvedValue(observedResponse);

    const observed = await observeChatGptAssetResolvers(capture.assetExportContext!, {
      requestCapture,
    });

    expect(requestCapture).toHaveBeenCalledWith(CONVERSATION_ID, true);
    expect(observed).toMatchObject({
      kind: 'matched',
      candidates: [{ assetId: expect.any(String) }],
    });
    if (observed.kind !== 'matched') throw new Error('resolver observation must match');
    const originalAsset = capture.assetExportContext!.rawCaptureBundle.manifest.assets.find(
      asset => asset.id === observed.candidates[0]?.assetId
    );
    if (!originalAsset) throw new Error('fixture asset must be present in original ledger');
    const bytes = new Uint8Array([5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6]);
    const sha256 = await sha256Hex(bytes);
    const mediaType = originalAsset.mediaType ?? 'text/plain';
    const extension = mediaType === 'text/plain' ? 'txt' : 'png';
    const fetched = {
      ...originalAsset,
      state: 'fetched' as const,
      attemptedAt: '2026-08-21T12:00:00.000Z',
      relativePath: `assets/${sha256}.${extension}`,
      mediaType,
      byteLength: bytes.byteLength,
      sha256,
      detail: 'page-owned-signed-response',
    };
    const companion = await buildChatGptBinaryAwareArchiveCompanion(
      capture.assetExportContext!,
      capture.assetExportContext!.rawCaptureBundle.manifest.assets.map(asset =>
        asset.id === fetched.id ? fetched : asset
      ),
      [{ record: fetched, bytes }]
    );

    expect(companion.artifacts.map(artifact => artifact.kind)).toEqual([
      'raw',
      'manifest',
      'canonical',
    ]);
    const persistedManifest = parseBase64Json(companion.artifacts[1].bodyBase64);
    const persistedCanonical = parseBase64Json(companion.artifacts[2].bodyBase64);
    expect(JSON.stringify(persistedManifest)).toContain(`assets/${sha256}.${extension}`);
    expect(JSON.stringify(persistedCanonical)).toContain(`assets/${sha256}.${extension}`);
    expect(JSON.stringify({ companion, persistedManifest, persistedCanonical })).not.toContain(
      signedSentinel
    );
  });

  it('does not trust resolver observations from a changed raw response', async () => {
    const originalResponse = await successfulResponse();
    const capture = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture: () => originalResponse,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });
    const changed = await successfulResponse(payload => {
      payload.title = 'Changed while attachment export was pending';
    });
    const requestCapture = vi.fn().mockResolvedValue(changed);

    const observed = await observeChatGptAssetResolvers(capture.assetExportContext!, {
      requestCapture,
    });

    expect(observed).toEqual({
      kind: 'recapture-mismatch',
      warning:
        'ChatGPT attachment resolver recapture did not match the original capture; attachments were not attempted.',
    });
  });

  it('persists only the count-safe active resolver metric in the capture manifest', async () => {
    const capture = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture: () => successfulResponse(),
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });
    const context = capture.assetExportContext!;
    const companion = await buildChatGptBinaryAwareArchiveCompanion(
      context,
      context.rawCaptureBundle.manifest.assets,
      [],
      { observedCount: 1, requestedCount: 2 }
    );

    const persistedManifest = parseBase64Json(companion.artifacts[1].bodyBase64);
    const persistedCanonical = parseBase64Json(companion.artifacts[2].bodyBase64);
    const metric = 'ChatGPT active resolver observed 1/2; binary acquisition remains disabled.';
    expect(persistedManifest.warnings).toContain(metric);
    const durable = JSON.stringify({ persistedManifest, persistedCanonical });
    expect(durable).not.toContain('download_url');
    expect(durable).not.toContain('/backend-api/estuary/content');
    expect(durable).not.toContain('providerFileId');
  });

  it.each([
    { observedCount: 2, requestedCount: 1 },
    { observedCount: 0, requestedCount: 21 },
    { observedCount: -1, requestedCount: 1 },
  ])('rejects an invalid durable active resolver metric %#', async metric => {
    const capture = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture: () => successfulResponse(),
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });
    const context = capture.assetExportContext!;
    await expect(
      buildChatGptBinaryAwareArchiveCompanion(
        context,
        context.rawCaptureBundle.manifest.assets,
        [],
        metric
      )
    ).rejects.toMatchObject({ code: 'capture-integrity-failed' });
  });

  it('fails closed before resolver observation for altered original context identity, raw body, or path', async () => {
    const capture = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture: () => successfulResponse(),
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });
    const context = capture.assetExportContext!;
    const raw = context.rawCaptureBundle.artifacts[0]!;
    const invalidContexts = [
      {
        ...context,
        rawCaptureBundle: {
          ...context.rawCaptureBundle,
          manifest: { ...context.rawCaptureBundle.manifest, provider: 'gemini' as const },
        },
      },
      { ...context, rawBodyBase64: 'bm90LXRoZS1vcmlnaW5hbA==' },
      {
        ...context,
        rawCaptureBundle: {
          ...context.rawCaptureBundle,
          artifacts: [{ ...raw, record: { ...raw.record, relativePath: 'responses/other.json' } }],
        },
      },
    ];
    const requestCapture = vi.fn();

    for (const invalidContext of invalidContexts) {
      await expect(verifyChatGptAssetExportContext(invalidContext)).rejects.toMatchObject({
        code: 'capture-integrity-failed',
      });
      await expect(
        observeChatGptAssetResolvers(invalidContext, { requestCapture })
      ).resolves.toMatchObject({ kind: 'recapture-failed' });
    }

    expect(requestCapture).not.toHaveBeenCalled();
  });

  it('turns a marker-gated resolver request failure into a stable non-fatal observation', async () => {
    const capture = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture: () => successfulResponse(),
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });

    await expect(
      observeChatGptAssetResolvers(capture.assetExportContext!, {
        requestCapture: async () => {
          throw new Error('private transport failure');
        },
      })
    ).resolves.toEqual({
      kind: 'recapture-failed',
      warning: 'ChatGPT attachment resolver recapture failed; attachments were not attempted.',
    });
  });

  it('uses an explicit opaque resolver path without legacy raw recapture and correlates only committed raw', async () => {
    const capture = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture: () => successfulResponse(),
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });
    const requestCapture = vi.fn();
    const requestResolvers = vi.fn().mockResolvedValue({
      success: true as const,
      data: {
        transientAssetResolvers: [
          {
            resolverKey: await sha256Hex(
              new TextEncoder().encode('liska-chatgpt-resolver/1\u0000synthetic-file-2')
            ),
            downloadUrl:
              `https://chatgpt.com/backend-api/estuary/content?cid=${CONVERSATION_ID}` +
              '&id=asset&p=p&sig=opaque-runtime-only&ts=1&v=1',
          },
        ],
      },
    });

    const observed = await observeChatGptAssetResolvers(capture.assetExportContext!, {
      requestCapture,
      requestResolvers,
    });

    expect(requestResolvers).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(requestCapture).not.toHaveBeenCalled();
    expect(observed).toMatchObject({
      kind: 'matched',
      candidates: [{ assetId: expect.any(String) }],
    });
  });

  it('keeps an empty opaque resolver observation as an honest not-attempted match', async () => {
    const capture = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture: () => successfulResponse(),
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });
    const observed = await observeChatGptAssetResolvers(capture.assetExportContext!, {
      requestResolvers: async () => ({ success: true, data: { transientAssetResolvers: [] } }),
    });

    expect(observed).toEqual({ kind: 'matched', candidates: [] });
  });

  it('does not fall back to legacy recapture after an opaque resolver failure', async () => {
    const capture = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture: () => successfulResponse(),
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });
    const requestCapture = vi.fn();

    const observed = await observeChatGptAssetResolvers(capture.assetExportContext!, {
      requestCapture,
      requestResolvers: async () => ({
        success: false,
        code: 'target-not-observed',
        singularDispatchCount: 0,
      }),
    });

    expect(observed).toEqual({
      kind: 'recapture-failed',
      warning: 'ChatGPT attachment resolver recapture failed; attachments were not attempted.',
    });
    expect(requestCapture).not.toHaveBeenCalled();
  });

  it('fails closed before the active probe when the committed raw context is invalid', async () => {
    const capture = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture: () => successfulResponse(),
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });
    const context = capture.assetExportContext!;
    const invalidContext = { ...context, rawBodyBase64: 'bm90LXRoZS1vcmlnaW5hbA==' };

    await expect(observeChatGptActiveAssetResolvers(invalidContext)).resolves.toEqual({
      kind: 'recapture-failed',
      warning: 'ChatGPT attachment resolver recapture failed; attachments were not attempted.',
    });
    expect(activeResolverMocks.probe).not.toHaveBeenCalled();
  });

  it('returns a zero-count active probe result without legacy or opaque recapture', async () => {
    const requestCapture = vi.fn(() =>
      successfulResponse(payload => {
        const mapping = payload.mapping as Record<string, Record<string, unknown>>;
        const current = mapping['node/current'];
        const message = current?.message as Record<string, unknown> | undefined;
        if (message) {
          const content = message.content as Record<string, unknown> | undefined;
          if (content && Array.isArray(content.parts)) {
            content.parts = content.parts.filter(
              part =>
                !part ||
                typeof part !== 'object' ||
                (part as Record<string, unknown>).content_type !== 'image_asset_pointer'
            );
          }
          const metadata = message.metadata as Record<string, unknown> | undefined;
          if (metadata) metadata.attachments = [];
        }
      })
    );
    const capture = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });
    requestCapture.mockClear();
    activeResolverMocks.probe.mockResolvedValue({
      success: true,
      data: {
        requestedCount: 0,
        dispatchCount: 0,
        observedCount: 0,
        outcomes: [],
        attemptedAt: '2026-08-24T12:00:00.000Z',
      },
    });

    const observed = await observeChatGptActiveAssetResolvers(capture.assetExportContext!);

    expect(observed).toEqual({
      kind: 'probe-only',
      observedCount: 0,
      requestedCount: 0,
      warning: 'ChatGPT active resolver observed 0/0; binary acquisition remains disabled.',
    });
    expect(activeResolverMocks.probe).not.toHaveBeenCalled();
    expect(requestCapture).not.toHaveBeenCalled();
    expect(JSON.stringify(observed)).not.toContain('synthetic-file-2');
    expect(JSON.stringify(observed)).not.toContain('https://');
    expect(JSON.stringify(observed)).not.toContain('assets/');
  });

  it('returns count-only active metrics and sends only exact ledger-derived IDs', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const capture = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture: () => successfulResponse(),
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });
    activeResolverMocks.probe.mockResolvedValue({
      success: true,
      data: {
        requestedCount: 2,
        dispatchCount: 2,
        observedCount: 1,
        outcomes: ['observed', 'http-error'],
        attemptedAt: '2026-08-24T12:00:00.000Z',
      },
    });

    const observed = await observeChatGptActiveAssetResolvers(capture.assetExportContext!);

    expect(observed).toEqual({
      kind: 'probe-only',
      observedCount: 1,
      requestedCount: 2,
      warning: 'ChatGPT active resolver observed 1/2; binary acquisition remains disabled.',
    });
    const providerFileIds = activeResolverMocks.probe.mock.calls[0]?.[1] as string[];
    expect(providerFileIds).toHaveLength(2);
    expect(providerFileIds).toEqual(
      expect.arrayContaining(['synthetic-image-1', 'synthetic-file-2'])
    );
    const returned = JSON.stringify(observed);
    expect(returned).not.toContain('synthetic-file-2');
    expect(returned).not.toContain('https://');
    expect(returned).not.toContain('assets/');
    expect(info).toHaveBeenCalledWith(
      '[G2O] ChatGPT active resolver observed 1/2; binary acquisition remains disabled.'
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain('synthetic-file-2');
    expect(JSON.stringify(info.mock.calls)).not.toContain('https://');
  });

  it.each([
    ['a background failure', { success: false, code: 'source-http-error' }],
    ['a thrown probe request', new Error('private active resolver diagnostic')],
  ])('keeps %s count-only and uses the exact safe warning', async (_label, outcome) => {
    const capture = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture: () => successfulResponse(),
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });
    if (outcome instanceof Error) {
      activeResolverMocks.probe.mockRejectedValue(outcome);
    } else {
      activeResolverMocks.probe.mockResolvedValue(outcome);
    }

    const observed = await observeChatGptActiveAssetResolvers(capture.assetExportContext!);

    expect(observed).toEqual({
      kind: 'probe-only',
      observedCount: 0,
      requestedCount: 2,
      warning: 'ChatGPT active resolver observed 0/2; binary acquisition remains disabled.',
    });
    expect(JSON.stringify(observed)).not.toContain('synthetic-file-2');
    expect(JSON.stringify(observed)).not.toContain('https://');
    expect(JSON.stringify(observed)).not.toContain('private active resolver diagnostic');
  });

  it('rejects a binary-aware companion with runtime bytes outside the destination ledger', async () => {
    const capture = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture: () => successfulResponse(),
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });
    const originalAsset = capture.assetExportContext!.rawCaptureBundle.manifest.assets[0];
    if (!originalAsset) throw new Error('fixture must contain an attachment ledger entry');
    const unknownRuntime = {
      ...originalAsset,
      id: `chatgpt-asset-${'f'.repeat(64)}`,
      state: 'fetched' as const,
      attemptedAt: '2026-08-21T12:00:00.000Z',
      relativePath: `assets/${'e'.repeat(64)}.png`,
      byteLength: 1,
      sha256: 'e'.repeat(64),
      detail: 'page-owned-signed-response',
    };

    await expect(
      buildChatGptBinaryAwareArchiveCompanion(
        capture.assetExportContext!,
        capture.assetExportContext!.rawCaptureBundle.manifest.assets,
        [{ record: unknownRuntime, bytes: new Uint8Array([1]) }]
      )
    ).rejects.toMatchObject({ code: 'capture-integrity-failed' });
  });

  it('rejects a fetched manifest claim before the JSON-only companion can be assembled', async () => {
    const rawBytes = new TextEncoder().encode('{}');
    const assetBytes = new Uint8Array([1]);
    const manifest = buildCaptureManifest({
      captureId: fixedCaptureId(),
      provider: 'chatgpt',
      conversationId: CONVERSATION_ID,
      capturedAt: CAPTURE_TIME,
      method: 'same-origin-api',
      artifacts: [
        {
          id: 'conversation',
          relativePath: 'responses/conversation.json',
          mediaType: 'application/json',
          byteLength: rawBytes.byteLength,
          sha256: await sha256Hex(rawBytes),
          endpoint: {
            method: 'GET',
            pathPattern: '/backend-api/conversation/{conversationId}',
          },
        },
      ],
      assets: [
        {
          id: 'asset-one',
          state: 'fetched',
          attemptedAt: '2026-08-17T12:00:01.000Z',
          relativePath: 'assets/asset-one.bin',
          mediaType: 'application/octet-stream',
          byteLength: assetBytes.byteLength,
          sha256: await sha256Hex(assetBytes),
          detail: null,
          sourceRefs: [{ artifactId: 'conversation', rawPointer: '/asset' }],
        },
      ],
      completeness: {
        graph: 'complete',
        messages: 'complete',
        branches: 'complete',
        assets: 'complete',
      },
    });
    const bundle: RawCaptureBundle = {
      manifest,
      artifacts: [{ record: manifest.artifacts[0], bytes: rawBytes }],
      assets: [],
    };

    expect(() => assertJsonOnlyArchiveCompanionSafe(bundle)).toThrow(
      expect.objectContaining({ code: 'capture-integrity-failed' })
    );
  });

  it('verifies the synthetic graph, retaining its current branch projection and tool content', async () => {
    const requestCapture = vi.fn().mockResolvedValue(await successfulResponse());

    const projection = await captureChatGptCurrentBranch(CONVERSATION_ID, true, {
      requestCapture,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });

    expect(requestCapture).toHaveBeenCalledOnce();
    expect(requestCapture).toHaveBeenCalledWith(CONVERSATION_ID, false);
    expect(projection.selectedNodeIds).toEqual([
      'node/root~structural',
      'node/user',
      'node/current',
    ]);
    expect(projection.selectedNodeIds).not.toContain('node/alternate');
    expect(projection.data.messages.map(message => message.id)).toEqual([
      'message/user',
      'message/current',
    ]);
    expect(projection.data.messages[1]?.content).toContain('First text part.');
    expect(projection.data.messages[1]?.toolContent).toContain('Synthetic recap.');
  });

  it('returns exactly three deterministic archive companions and preserves raw base64 verbatim', async () => {
    const response = await successfulResponse();
    const first = await captureChatGptCurrentBranch(CONVERSATION_ID, true, {
      requestCapture: async () => response,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });
    const second = await captureChatGptCurrentBranch(CONVERSATION_ID, true, {
      requestCapture: async () => response,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });

    const companions = first.archiveCompanion;
    expect(companions?.artifacts.map(artifact => [artifact.kind, artifact.relativePath])).toEqual([
      ['raw', 'responses/conversation.json'],
      ['manifest', 'manifest.json'],
      ['canonical', 'canonical/liska-thread-1.json'],
    ]);
    expect(companions?.artifacts).toHaveLength(3);
    expect(companions?.artifacts[0]?.bodyBase64).toBe(
      response.success ? response.data.bodyBase64 : undefined
    );
    expect(companions?.artifacts).toEqual(second.archiveCompanion?.artifacts);
    for (const artifact of companions?.artifacts ?? []) {
      const bytes = new Uint8Array(
        atob(artifact.bodyBase64)
          .split('')
          .map(character => character.charCodeAt(0))
      );
      expect(bytes.byteLength).toBe(artifact.byteLength);
      expect(await sha256Hex(bytes)).toBe(artifact.sha256);
      expect(artifact.mediaType).toBe('application/json');
    }
  });

  it('projects the same verified branch without tool content when disabled', async () => {
    const projection = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: () => successfulResponse(),
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    });

    expect(projection.data.messages[1]?.toolContent).toBeUndefined();
  });

  it('rejects an invalid conversation ID before requesting private data', async () => {
    const requestCapture = vi.fn();

    const error = await captureChatGptCurrentBranch('../not-a-conversation', false, {
      requestCapture,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('invalid-conversation-id');
    expect(requestCapture).not.toHaveBeenCalled();
  });

  it('maps a rejected runtime request to a stable messaging failure', async () => {
    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: () => Promise.reject(new Error('private runtime diagnostic')),
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('runtime-message-failed');
    expect(String((error as Error).message)).not.toContain('private runtime diagnostic');
  });

  it('fails closed when capture time cannot be serialized', async () => {
    const response = await successfulResponse();
    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: async () => response,
      createCaptureId: fixedCaptureId,
      now: () => new Date(Number.NaN),
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('capture-integrity-failed');
  });

  it('uses Web Crypto randomUUID for production capture provenance', async () => {
    const cryptoApi = globalThis.crypto;
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555' as const);
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { subtle: cryptoApi.subtle, randomUUID },
    });

    await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: () => successfulResponse(),
      now: fixedNow,
    });

    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('fails closed when Web Crypto cannot create a unique capture ID', async () => {
    const response = await successfulResponse();
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { subtle: globalThis.crypto.subtle },
    });

    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: async () => response,
      now: fixedNow,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('capture-id-unavailable');
  });

  it('fails closed when manifest hashing is unavailable', async () => {
    const response = await successfulResponse();
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });

    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: async () => response,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('capture-integrity-failed');
  });

  it.each([
    ['missing base64 decoder', undefined],
    [
      'throwing base64 decoder',
      () => {
        throw new Error('decoder failed');
      },
    ],
  ])(
    'rejects a verified response when the %s prevents a local byte check',
    async (_label, atob) => {
      const response = await successfulResponse();
      Object.defineProperty(globalThis, 'atob', { configurable: true, value: atob });

      const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
        requestCapture: async () => response,
        createCaptureId: fixedCaptureId,
        now: fixedNow,
      }).catch(reason => reason);

      expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
      expect((error as ChatGptCurrentBranchError).code).toBe('capture-payload-invalid');
    }
  );

  it('rejects a non-canonical uppercase artifact digest at the local trust boundary', async () => {
    const response = await successfulResponse();
    if (response.success) response.data.sha256 = response.data.sha256.toUpperCase();

    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: async () => response,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('capture-payload-invalid');
  });

  it('fails safely when the verified current branch has no legacy-renderable messages', async () => {
    const response = await successfulResponse(payload => {
      const mapping = payload.mapping as Record<
        string,
        { message?: { author?: { role?: string } } }
      >;
      if (mapping['node/user']?.message?.author) {
        mapping['node/user'].message.author.role = 'system';
      }
      if (mapping['node/current']?.message?.author) {
        mapping['node/current'].message.author.role = 'system';
      }
    });

    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: async () => response,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('projection-failed');
    expect((error as ChatGptCurrentBranchError).archiveCompanion?.artifacts).toHaveLength(3);
  });

  it('preserves raw and manifest when archive normalization fails', async () => {
    const response = await successfulResponse(payload => {
      delete payload.mapping;
    });

    const error = await captureChatGptArchive(CONVERSATION_ID, {
      requestCapture: async () => response,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('normalization-failed');
    expect((error as ChatGptCurrentBranchError).detailCode).toBe('missing-graph');
    expect(
      (error as ChatGptCurrentBranchError).archiveCompanion?.artifacts.map(
        artifact => artifact.kind
      )
    ).toEqual(['raw', 'manifest']);
    const manifest = parseBase64Json(
      (error as ChatGptCurrentBranchError).archiveCompanion?.artifacts[1]?.bodyBase64 ?? ''
    );
    expect(manifest.completeness).toMatchObject({ assets: 'unknown' });
    expect(manifest.warnings).toEqual(['chatgpt-asset-inventory-unavailable']);
  });

  it.each([
    [
      'a malformed response',
      async () => ({ success: true, data: { bodyBase64: 'malformed' } }) as ChatGptCaptureResponse,
      'capture-response-invalid',
    ],
    [
      'a tampered artifact hash',
      async () => {
        const response = await successfulResponse();
        if (response.success) response.data.sha256 = '0'.repeat(64);
        return response;
      },
      'capture-integrity-failed',
    ],
    [
      'a safe background failure',
      async () => createChatGptCaptureFailure('capture-failed'),
      'capture-failed',
    ],
  ])('fails closed for %s', async (_label, makeResponse, expectedCode) => {
    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: makeResponse,
      createCaptureId: fixedCaptureId,
      now: fixedNow,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe(expectedCode);
    expect(String((error as Error).message)).not.toContain(CONVERSATION_ID);
  });

  it('retains a safe structured-capture failure code without provider diagnostics', async () => {
    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: async () => createChatGptCaptureFailure('timed-out'),
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('timed-out');
    expect(String((error as Error).message)).not.toContain(CONVERSATION_ID);
  });

  it('obtains fresh capture provenance from the injected factory for every event', async () => {
    const createCaptureId = vi
      .fn()
      .mockReturnValueOnce('capture-chatgpt-11111111-2222-3333-4444-555555555555')
      .mockReturnValueOnce('capture-chatgpt-22222222-3333-4444-5555-666666666666');
    const dependencies = {
      requestCapture: () => successfulResponse(),
      createCaptureId,
      now: fixedNow,
    };

    await captureChatGptCurrentBranch(CONVERSATION_ID, false, dependencies);
    await captureChatGptCurrentBranch(CONVERSATION_ID, false, dependencies);

    expect(createCaptureId).toHaveBeenCalledTimes(2);
    expect(createCaptureId.mock.results.map(result => result.value)).toEqual([
      'capture-chatgpt-11111111-2222-3333-4444-555555555555',
      'capture-chatgpt-22222222-3333-4444-5555-666666666666',
    ]);
  });

  it('fails closed when the capture-id factory is unavailable', async () => {
    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: () => successfulResponse(),
      createCaptureId: () => {
        throw new Error('factory failed');
      },
      now: fixedNow,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('capture-id-unavailable');
  });

  it('fails closed when the capture-id factory returns an unsafe value', async () => {
    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: () => successfulResponse(),
      createCaptureId: () => 'capture-chatgpt-../unsafe',
      now: fixedNow,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('capture-id-invalid');
  });

  it('rejects capture IDs with Windows-unsafe path punctuation', async () => {
    const error = await captureChatGptCurrentBranch(CONVERSATION_ID, false, {
      requestCapture: () => successfulResponse(),
      createCaptureId: () => 'capture-chatgpt-2026:08:19',
      now: fixedNow,
    }).catch(reason => reason);

    expect(error).toBeInstanceOf(ChatGptCurrentBranchError);
    expect((error as ChatGptCurrentBranchError).code).toBe('capture-id-invalid');
  });
});
