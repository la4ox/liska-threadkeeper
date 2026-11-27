import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCaptureManifest,
  type RawCaptureAssetRecord,
  type RawCaptureManifest,
} from '../../src/archive';
import type { LiskaThreadArchive } from '../../src/archive/types';
import { CLAUDE_ASSET_DETAIL } from '../../src/archive/normalizers/claude/inventory';
import { normalizeClaudeCapture } from '../../src/archive/normalizers/claude';
import { ProviderBlockWorkBudget } from '../../src/archive/normalizers/provider-block-work-budget';
import {
  acquireClaudeAssets,
  CLAUDE_ASSET_ATTEMPT_LIMIT,
  CLAUDE_ASSET_TIMEOUT_MS,
} from '../../src/content/capture/claude-asset-acquisition';
import {
  CLAUDE_ASSET_DERIVATION_BUDGET,
  deriveClaudeAssetCandidates,
  type ClaudeAssetCandidate,
} from '../../src/content/capture/claude-asset-resolver';
import { hashCaptureManifest, sha256Hex } from '../../src/content/capture/response';
import {
  ClaudeNavigationChangedError,
  persistClaudeDestinationHonestAttachments,
  verifyClaudeAssetExportBinding,
  type ClaudeAssetExportDependencies,
} from '../../src/content/claude-asset-export';
import { fetchClaudeConversation } from '../../src/content/extractors/claude-api';
import { handleSync } from '../../src/content/bootstrap';
import { ClaudeExtractor } from '../../src/content/extractors/claude';
import { sendMessage } from '../../src/lib/messaging';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import type {
  ArchiveCompanionBundle,
  ContentScriptSettings,
  ExtensionMessage,
  PersistentOutputDestination,
  StagedBinaryAssetResult,
} from '../../src/lib/types';

vi.mock('../../src/lib/messaging', () => ({ sendMessage: vi.fn() }));

const CONVERSATION = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const MESSAGE = '33333333-3333-4333-8333-333333333333';
const FILE_A = '44444444-4444-4444-8444-444444444444';
const FILE_B = '55555555-5555-4555-8555-555555555555';
const FILE_C = '66666666-6666-4666-8666-666666666666';
const TS = '2026-11-27T07:00:00.000Z';
const syntheticChrome = globalThis.chrome;

function file(fileUuid: string, overrides: Record<string, unknown> = {}) {
  return {
    file_uuid: fileUuid,
    success: true,
    size_bytes: 3,
    file_name: 'synthetic-executable-name.html',
    content_type: 'text/plain',
    ...overrides,
  };
}

function url(fileUuid = FILE_A) {
  return `https://claude.ai/api/organizations/${ORG}/files/${fileUuid}/contents`;
}

function originalResponse(
  requestUrl: string,
  body: BodyInit | null = 'abc',
  headers: Record<string, string> = {
    'x-served-file-variant': 'original',
    'content-length': '3',
    'x-served-file-size': '3',
    'content-type': 'text/plain; charset=utf-8',
    'content-disposition': 'attachment; filename=synthetic-provider-header.html',
  },
  status = 200
) {
  const response = new Response(body, { status, headers });
  return Object.defineProperty(response, 'url', { value: requestUrl });
}

async function capture(
  files: Record<string, unknown>[] = [file(FILE_A)],
  otherFields: Record<string, unknown> = {}
) {
  const raw = {
    uuid: CONVERSATION,
    name: 'Synthetic attachments',
    current_leaf_message_uuid: MESSAGE,
    chat_messages: [
      {
        uuid: MESSAGE,
        parent_message_uuid: null,
        index: 0,
        sender: 'human',
        text: 'Synthetic text',
        files,
        ...otherFields,
      },
    ],
  };
  const budget = new ProviderBlockWorkBudget('claude');
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(raw), { headers: { 'content-type': 'application/json' } })
    )
  );
  const captured = await fetchClaudeConversation(CONVERSATION, false, {
    resolveOrganizationId: () => ORG,
    createCaptureId: () => 'capture-claude-synthetic-attachments',
    now: () => new Date(TS),
    contentBudget: budget,
  });
  if (!captured) throw new Error('synthetic capture was missing');
  return {
    captured,
    context: captured.claudeAssetExportContext,
    companion: captured.archiveCompanion,
    budget,
  };
}

function decode<T>(companion: ArchiveCompanionBundle, kind: 'manifest' | 'canonical'): T {
  const artifact = companion.artifacts.find(value => value.kind === kind);
  if (artifact?.transport !== 'inline') throw new Error('expected synthetic inline JSON');
  return JSON.parse(Buffer.from(artifact.bodyBase64, 'base64').toString());
}

function receipts(
  assets: Awaited<ReturnType<typeof acquireClaudeAssets>>['runtimeAssets'],
  outputs: readonly PersistentOutputDestination[],
  failing?: PersistentOutputDestination
): StagedBinaryAssetResult[] {
  return assets.map(({ record }) => ({
    assetId: record.id,
    descriptor: {
      assetId: record.id,
      mediaType: record.mediaType!,
      byteLength: record.byteLength!,
      sha256: record.sha256!,
      relativePath: record.relativePath!,
    },
    results: outputs.map(destination => ({ destination, success: destination !== failing })),
    allSuccessful: !failing,
  }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Claude exact ordinary file resolver', () => {
  it('freezes runtime organization and conversation evidence, binds every ref and leaves other shapes unattempted', async () => {
    const { context, companion, budget } = await capture(
      [
        file(FILE_A, { uuid: FILE_A, size: 3 }),
        file(FILE_A, { byte_length: 3 }),
        file(FILE_B),
        file(FILE_B, { file_size: 4 }),
        file(FILE_C, { success: 'true' }),
        { id: 'only-attachment-id', success: true, size_bytes: 3 },
        file('77777777-7777-4777-8777-777777777777', { uuid: null }),
        file('88888888-8888-4888-8888-888888888888', { size_bytes: '3' }),
      ],
      {
        attachments: [file('99999999-9999-4999-8999-999999999999')],
        content: [
          { type: 'text', text: 'Synthetic visible message' },
          { type: 'tool_result', files: [file('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')] },
        ],
      }
    );
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.rawArtifact)).toBe(true);
    expect(context).toMatchObject({
      conversationId: CONVERSATION,
      organizationId: ORG,
      contentBudget: budget,
    });
    const beforeWork = budget.counters.workUnits;
    const candidates = await deriveClaudeAssetCandidates(context);
    expect(candidates).toEqual([
      {
        assetId: expect.stringMatching(/^claude-asset-[a-f0-9]{64}$/),
        contentsUrl: url(),
        declaredByteLength: 3,
        declaredMediaType: 'text/plain',
      },
    ]);
    expect(budget.counters.workUnits).toBeGreaterThan(beforeWork);
    expect(
      context.rawCaptureBundle.manifest.assets.find(asset => asset.id === candidates[0].assetId)
        ?.sourceRefs
    ).toEqual([
      { artifactId: 'conversation', rawPointer: '/chat_messages/0/files/0' },
      { artifactId: 'conversation', rawPointer: '/chat_messages/0/files/1' },
    ]);
    expect(JSON.stringify(companion)).not.toContain(ORG);
    expect(await deriveClaudeAssetCandidates({ ...context, organizationId: ORG + '\n' })).toEqual(
      []
    );
  });

  it('does not search around an exact pointer or accept a different provider identity', async () => {
    const { context } = await capture([file(FILE_A), file(FILE_B)]);
    const bundle = context.rawCaptureBundle;
    const candidates = await deriveClaudeAssetCandidates(context);
    const source = candidates.find(candidate => candidate.contentsUrl === url())!;
    const asset = bundle.manifest.assets.find(item => item.id === source.assetId)!;
    for (const rawPointer of [
      '/chat_messages/0/files/1',
      '/chat_messages/0/files/9',
      '/chat_messages/0/files/00',
    ]) {
      const manifest = buildCaptureManifest({
        ...bundle.manifest,
        assets: [{ ...asset, sourceRefs: [{ artifactId: 'conversation', rawPointer }] }],
      });
      expect(
        await deriveClaudeAssetCandidates({ ...context, rawCaptureBundle: { ...bundle, manifest } })
      ).toEqual([]);
    }
  });

  it('limits derivation work without using a partial subset of an asset’s references', async () => {
    const repeated = Array.from({ length: CLAUDE_ASSET_DERIVATION_BUDGET.sourceRefs + 1 }, () =>
      file(FILE_A)
    );
    const oversized = await capture(repeated);
    expect(oversized.context.rawCaptureBundle.manifest.assets[0].sourceRefs).toHaveLength(
      repeated.length
    );
    const hash = vi.fn(sha256Hex);
    expect(await deriveClaudeAssetCandidates(oversized.context, hash)).toEqual([]);
    expect(hash).not.toHaveBeenCalled();
    const distinct = Array.from({ length: CLAUDE_ASSET_DERIVATION_BUDGET.assets + 1 }, (_, index) =>
      file(`44444444-4444-4444-8444-${index.toString(16).padStart(12, '0')}`)
    );
    const bounded = await capture(distinct);
    expect(await deriveClaudeAssetCandidates(bounded.context, hash)).toHaveLength(
      CLAUDE_ASSET_DERIVATION_BUDGET.assets
    );
    expect(hash).toHaveBeenCalledTimes(CLAUDE_ASSET_DERIVATION_BUDGET.assets);
  });
});

describe('Claude contents acquisition', () => {
  const testAsset = (index = 0): RawCaptureAssetRecord => ({
    id: `claude-asset-${index.toString(16).padStart(64, '0')}`,
    state: 'not-attempted',
    attemptedAt: null,
    relativePath: null,
    mediaType: null,
    byteLength: null,
    sha256: null,
    detail: 'metadata-only',
    sourceRefs: [{ artifactId: 'conversation', rawPointer: `/chat_messages/0/files/${index}` }],
  });
  const candidate = (index = 0, declaredByteLength = 3): ClaudeAssetCandidate => ({
    assetId: testAsset(index).id,
    contentsUrl: url(`44444444-4444-4444-8444-${index.toString(16).padStart(12, '0')}`),
    declaredByteLength,
  });

  it('uses exact same-origin GET, hashes the exact bytes and prefers allowlisted response MIME', async () => {
    const entry = candidate();
    const fetcher = vi.fn(async () => originalResponse(entry.contentsUrl));
    const acquired = await acquireClaudeAssets({
      assets: [testAsset()],
      candidates: [{ ...entry, declaredMediaType: 'application/pdf' }],
      fetcher,
      now: () => new Date(TS),
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(entry.contentsUrl, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: expect.any(AbortSignal),
    });
    const bytes = new TextEncoder().encode('abc');
    const sha256 = await sha256Hex(bytes);
    expect(acquired.runtimeAssets).toHaveLength(1);
    expect(acquired.runtimeAssets[0].record).toBe(acquired.records[0]);
    expect(Array.from(acquired.runtimeAssets[0].bytes)).toEqual(Array.from(bytes));
    expect(acquired.records[0]).toMatchObject({
      state: 'fetched',
      attemptedAt: TS,
      detail: CLAUDE_ASSET_DETAIL.fetched,
      relativePath: `assets/${sha256}.txt`,
      mediaType: 'text/plain',
      byteLength: 3,
      sha256,
    });
    expect(JSON.stringify(acquired.records)).not.toMatch(/https|disposition|provider-header/);
  });

  it.each([
    ['text/html', 'application/pdf', 'application/pdf', 'pdf'],
    ['image/svg+xml', 'text/html', 'application/octet-stream', 'bin'],
    [undefined, undefined, 'application/octet-stream', 'bin'],
  ])(
    'uses only safe raw MIME or inert bytes when representative response type is %s',
    async (responseType, declaredMediaType, mediaType, extension) => {
      const entry = candidate();
      const acquired = await acquireClaudeAssets({
        assets: [testAsset()],
        candidates: [{ ...entry, declaredMediaType }],
        fetcher: async () =>
          originalResponse(entry.contentsUrl, new TextEncoder().encode('abc'), {
            'x-served-file-variant': 'original',
            ...(responseType && { 'content-type': responseType }),
          }),
      });
      expect(acquired.records[0]).toMatchObject({
        state: 'fetched',
        mediaType,
        relativePath: expect.stringMatching(new RegExp(`\\.${extension}$`)),
      });
    }
  );

  it.each([
    { variant: 'preview', detail: CLAUDE_ASSET_DETAIL.responseRejected },
    { variant: '', detail: CLAUDE_ASSET_DETAIL.responseRejected },
    { variant: 'original', otherUrl: true, detail: CLAUDE_ASSET_DETAIL.responseRejected },
    { variant: 'original', status: 403, detail: CLAUDE_ASSET_DETAIL.httpFailed },
    { variant: 'original', served: '03', detail: CLAUDE_ASSET_DETAIL.sizeMismatch },
    { variant: 'original', served: '3, 3', detail: CLAUDE_ASSET_DETAIL.sizeMismatch },
    { variant: 'original', length: '2', detail: CLAUDE_ASSET_DETAIL.sizeMismatch },
    { variant: 'original', body: 'ab', detail: CLAUDE_ASSET_DETAIL.sizeMismatch },
    { variant: 'original', body: 'abcd', detail: CLAUDE_ASSET_DETAIL.sizeMismatch },
  ])(
    'rejects a response lacking exact original evidence: %j',
    async ({ variant, detail, status, otherUrl, served, length, body }) => {
      const entry = candidate();
      const acquired = await acquireClaudeAssets({
        assets: [testAsset()],
        candidates: [entry],
        fetcher: async () =>
          originalResponse(
            otherUrl ? url(FILE_B) : entry.contentsUrl,
            body ?? 'abc',
            {
              ...(variant && { 'x-served-file-variant': variant }),
              ...(served && { 'x-served-file-size': served }),
              ...(length && { 'content-length': length }),
            },
            status
          ),
      });
      expect(acquired.records[0]).toMatchObject({
        state: 'failed',
        detail,
        relativePath: null,
        mediaType: null,
        byteLength: null,
        sha256: null,
      });
      expect(acquired.runtimeAssets).toEqual([]);
    }
  );

  it('hard-times out fetch and stalled body, cancels both, and ignores a late response', async () => {
    vi.useFakeTimers();
    const lateCancelled = vi.fn();
    const stalledCancelled = vi.fn(() => new Promise<void>(() => {}));
    let resolveLate!: (response: Response) => void;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveLate = resolve;
          })
      )
      .mockImplementationOnce(async () =>
        originalResponse(candidate(1).contentsUrl, new ReadableStream({ cancel: stalledCancelled }))
      );
    const pending = acquireClaudeAssets({
      assets: [testAsset(0), testAsset(1)],
      candidates: [candidate(0), candidate(1)],
      fetcher,
    });
    await vi.advanceTimersByTimeAsync(CLAUDE_ASSET_TIMEOUT_MS);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    resolveLate(
      originalResponse(candidate(0).contentsUrl, new ReadableStream({ cancel: lateCancelled }))
    );
    await vi.advanceTimersByTimeAsync(CLAUDE_ASSET_TIMEOUT_MS);
    const outcome = await pending;
    expect(outcome.records.map(record => record.detail)).toEqual([
      CLAUDE_ASSET_DETAIL.timeout,
      CLAUDE_ASSET_DETAIL.timeout,
    ]);
    expect(outcome.runtimeAssets).toEqual([]);
    expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true);
    expect(lateCancelled).toHaveBeenCalledOnce();
    expect(stalledCancelled).toHaveBeenCalledOnce();
  });

  it('enforces the bounded attempt, per-file and shared byte limits before requesting skipped candidates', async () => {
    const allRecords = Array.from({ length: CLAUDE_ASSET_ATTEMPT_LIMIT + 1 }, (_, index) =>
      testAsset(index)
    );
    const allCandidates = allRecords.map((_, index) => candidate(index, 1));
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      originalResponse(String(input), String(input).slice(-10, -9), {
        'x-served-file-variant': 'original',
      })
    );
    const bounded = await acquireClaudeAssets({
      assets: allRecords,
      candidates: allCandidates,
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(CLAUDE_ASSET_ATTEMPT_LIMIT);
    expect(bounded.records.at(-1)?.state).toBe('not-attempted');
    fetcher.mockClear();
    const byBytes = await acquireClaudeAssets({
      assets: allRecords,
      candidates: [candidate(0, 3), ...allCandidates.slice(1)],
      fetcher,
      maxAssetBytes: 2,
      maxTotalBytes: 2,
    });
    expect(fetcher.mock.calls.map(([value]) => value)).toEqual([
      candidate(1).contentsUrl,
      candidate(2).contentsUrl,
    ]);
    expect(byBytes.records[0].state).toBe('not-attempted');
    expect(byBytes.records[3].state).toBe('not-attempted');
  });
});

describe('Claude destination-honest ordinary attachment export', () => {
  it('writes raw then acquires once, commits only to raw-successful sinks and finalizes independent ledgers', async () => {
    const { captured, context, companion } = await capture([
      file(FILE_A),
      file(FILE_B, { success: false }),
    ]);
    const initial = context.rawCaptureBundle.manifest;
    expect(captured.data.messages[0].content).toBe('Synthetic text');
    const events: string[] = [];
    const finalized = new Map<string, ArchiveCompanionBundle>();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      events.push('fetch');
      return originalResponse(String(input));
    });
    const deps: ClaudeAssetExportDependencies = {
      isConversationCurrent: () => true,
      persistArtifacts: async (bundle, _, source, outputs, kinds) => {
        expect(source).toBe('claude');
        expect(outputs).not.toContain('clipboard');
        events.push(`${kinds.join('+')}:${outputs.join('+')}`);
        if (kinds.includes('manifest')) finalized.set(outputs[0], bundle);
        return { activeOutputs: outputs as PersistentOutputDestination[], warnings: [] };
      },
      acquireAssets: input => acquireClaudeAssets({ ...input, fetcher, now: () => new Date(TS) }),
      persistBinaryAssets: async input => {
        expect(input.source).toBe('claude');
        events.push(`binary:${input.outputs.join('+')}`);
        return receipts(
          input.assets as Awaited<ReturnType<typeof acquireClaudeAssets>>['runtimeAssets'],
          input.outputs,
          'obsidian'
        );
      },
    };
    const outcome = await persistClaudeDestinationHonestAttachments(
      context,
      companion,
      'syn.md',
      ['file', 'clipboard', 'obsidian'],
      deps
    );
    expect(events).toEqual([
      'raw:file+obsidian',
      'fetch',
      'binary:file+obsidian',
      'manifest+canonical:file',
      'manifest+canonical:obsidian',
    ]);
    expect(outcome.completeDestinations).toEqual(['file', 'obsidian']);
    expect(outcome.warnings.join(' ')).toContain('not saved to obsidian');
    const received = decode<RawCaptureManifest>(finalized.get('file')!, 'manifest');
    const failed = decode<RawCaptureManifest>(finalized.get('obsidian')!, 'manifest');
    const fetched = received.assets.find(asset => asset.state === 'fetched')!;
    expect(received.completeness).toEqual({ ...initial.completeness, assets: 'partial' });
    expect(failed.completeness).toEqual(received.completeness);
    expect(failed.assets.find(asset => asset.id === fetched.id)).toMatchObject({
      state: 'failed',
      detail: CLAUDE_ASSET_DETAIL.destinationFailed,
      relativePath: null,
      mediaType: null,
      byteLength: null,
      sha256: null,
    });
    const canonical = decode<LiskaThreadArchive>(finalized.get('file')!, 'canonical');
    const failedCanonical = decode<LiskaThreadArchive>(finalized.get('obsidian')!, 'canonical');
    expect(canonical.graph).toEqual(captured.archive.graph);
    expect(canonical.conversation).toEqual(captured.archive.conversation);
    expect(canonical.assets[fetched.id]).toMatchObject({
      filename: 'synthetic-executable-name.html',
      localArtifactRef: fetched.relativePath,
      mimeType: fetched.mediaType,
      sha256: fetched.sha256,
      byteLength: fetched.byteLength,
      acquisition: { state: 'fetched', attemptedAt: TS, detail: CLAUDE_ASSET_DETAIL.fetched },
    });
    expect(failedCanonical.assets[fetched.id]).toMatchObject({
      localArtifactRef: null,
      mimeType: null,
      sha256: null,
      byteLength: null,
      acquisition: {
        state: 'failed',
        attemptedAt: TS,
        detail: CLAUDE_ASSET_DETAIL.destinationFailed,
      },
      extensions: canonical.assets[fetched.id].extensions,
    });
    const persisted = JSON.stringify([received, canonical, failed, failedCanonical]);
    expect(persisted).not.toContain(ORG);
    expect(persisted).not.toContain(url());
    expect(persisted).not.toContain('provider-header');
    expect(context.rawCaptureBundle.manifest).toBe(initial);
    expect(initial.assets.every(asset => asset.state === 'not-attempted')).toBe(true);
  });

  it('keeps one deterministic binary when distinct raw identities return an identical content path', async () => {
    const { context, companion } = await capture([file(FILE_B), file(FILE_A)]);
    const ordered = await deriveClaudeAssetCandidates(context);
    expect(ordered.map(candidate => candidate.assetId)).toEqual(
      [...ordered.map(candidate => candidate.assetId)].sort()
    );
    const fetcher = vi.fn(async (input: RequestInfo | URL) => originalResponse(String(input)));
    let finalized: ArchiveCompanionBundle | undefined;
    const output = await persistClaudeDestinationHonestAttachments(
      context,
      companion,
      'syn.md',
      ['file'],
      {
        isConversationCurrent: () => true,
        acquireAssets: input => acquireClaudeAssets({ ...input, fetcher }),
        persistArtifacts: async (value, _, _source, _outputs, kinds) => {
          if (kinds.includes('manifest')) finalized = value;
          return { activeOutputs: ['file'], warnings: [] };
        },
        persistBinaryAssets: async input => {
          expect(input.assets).toHaveLength(1);
          return receipts(
            input.assets as Awaited<ReturnType<typeof acquireClaudeAssets>>['runtimeAssets'],
            input.outputs
          );
        },
      }
    );
    expect(fetcher.mock.calls.map(([request]) => request)).toEqual(
      ordered.map(candidate => candidate.contentsUrl)
    );
    expect(output.completeDestinations).toEqual(['file']);
    const manifest = decode<RawCaptureManifest>(finalized!, 'manifest');
    expect(manifest.assets).toEqual([
      expect.objectContaining({ id: ordered[0].assetId, state: 'fetched' }),
      expect.objectContaining({
        id: ordered[1].assetId,
        state: 'failed',
        detail: CLAUDE_ASSET_DETAIL.duplicatePath,
        relativePath: null,
      }),
    ]);
  });

  it('rejects changed raw/companion commitments and keeps raw-successful writes narrow', async () => {
    const { context, companion } = await capture();
    expect(await verifyClaudeAssetExportBinding(context, companion)).toBe(true);
    expect(
      await verifyClaudeAssetExportBinding(context, { ...companion, conversationKey: 'different' })
    ).toBe(false);
    expect(
      await verifyClaudeAssetExportBinding({ ...context, conversationId: FILE_B }, companion)
    ).toBe(false);
    const otherRaw = {
      ...context.rawCaptureBundle.artifacts[0],
      bytes: context.rawCaptureBundle.artifacts[0].bytes.slice(),
    };
    otherRaw.bytes[0] ^= 1;
    expect(
      await verifyClaudeAssetExportBinding(
        { ...context, rawCaptureBundle: { ...context.rawCaptureBundle, artifacts: [otherRaw] } },
        companion
      )
    ).toBe(false);
    const acquireAssets = vi.fn(async input =>
      acquireClaudeAssets({
        ...input,
        fetcher: async (value: RequestInfo | URL) => originalResponse(String(value)),
      })
    );
    const deps: ClaudeAssetExportDependencies = {
      isConversationCurrent: () => true,
      persistArtifacts: vi.fn(async () => ({ activeOutputs: [], warnings: [] })),
      acquireAssets,
      persistBinaryAssets: vi.fn(),
    };
    await persistClaudeDestinationHonestAttachments(context, companion, 'syn.md', ['file'], deps);
    expect(acquireAssets).not.toHaveBeenCalled();
    expect(deps.persistBinaryAssets).not.toHaveBeenCalled();
    const output = await persistClaudeDestinationHonestAttachments(
      context,
      companion,
      'syn.md',
      ['file', 'obsidian'],
      {
        ...deps,
        persistArtifacts: async () => ({ activeOutputs: ['obsidian'], warnings: [] }),
        persistBinaryAssets: async input => {
          expect(input.outputs).toEqual(['obsidian']);
          return receipts(
            input.assets as Awaited<ReturnType<typeof acquireClaudeAssets>>['runtimeAssets'],
            input.outputs
          );
        },
      }
    );
    expect(output.rawSuccessfulDestinations).toEqual(['obsidian']);
    expect(output.completeDestinations).toEqual(['obsidian']);
  });

  it('rechecks route before the next file and never writes bytes or a final ledger after navigation', async () => {
    const { context, companion } = await capture([file(FILE_A), file(FILE_B)]);
    let current = true;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      current = false;
      return originalResponse(String(input));
    });
    const deps: ClaudeAssetExportDependencies = {
      isConversationCurrent: () => current,
      persistArtifacts: vi.fn(async () => ({ activeOutputs: ['file'], warnings: [] })),
      acquireAssets: input => acquireClaudeAssets({ ...input, fetcher }),
      persistBinaryAssets: vi.fn(),
    };
    await expect(
      persistClaudeDestinationHonestAttachments(context, companion, 'syn.md', ['file'], deps)
    ).rejects.toBeInstanceOf(ClaudeNavigationChangedError);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(deps.persistArtifacts).toHaveBeenCalledOnce();
    expect(deps.persistBinaryAssets).not.toHaveBeenCalled();
  });

  it('does not accept an unbacked fetched overlay or verified bytes pointed at a forged raw ref', async () => {
    const { context } = await capture();
    const original = context.rawCaptureBundle;
    const candidates = await deriveClaudeAssetCandidates(context);
    const acquisition = await acquireClaudeAssets({
      assets: original.manifest.assets,
      candidates,
      fetcher: async () => originalResponse(candidates[0].contentsUrl),
    });
    const fetched = acquisition.records[0];
    const normalize = async (record: RawCaptureAssetRecord, backed: boolean) => {
      const manifest = buildCaptureManifest({
        ...original.manifest,
        assets: [record],
        completeness: { ...original.manifest.completeness, assets: 'complete' },
      });
      return normalizeClaudeCapture({
        bundle: {
          ...original,
          manifest,
          assets: backed
            ? [{ record: manifest.assets[0], bytes: acquisition.runtimeAssets[0].bytes }]
            : [],
        },
        artifactId: 'conversation',
        manifestSha256: await hashCaptureManifest(manifest),
        sha256: sha256Hex,
      });
    };
    await expect(normalize(fetched, false)).rejects.toMatchObject({
      code: 'artifact-integrity-failed',
    });
    await expect(
      normalize(
        {
          ...fetched,
          sourceRefs: [{ artifactId: 'conversation', rawPointer: '/chat_messages/0/files/1' }],
        },
        true
      )
    ).rejects.toMatchObject({ code: 'asset-inventory-mismatch' });
  });
});

describe('Claude attachment bootstrap with the staged runtime bridge', () => {
  const route = `https://claude.ai/chat/${CONVERSATION}`;
  const originalLocation = Object.getOwnPropertyDescriptor(window, 'location')!;

  function setClaudeLocation(suffix = '') {
    const location = new URL(route + suffix);
    Object.defineProperty(window, 'location', {
      value: location,
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(window, 'location', originalLocation);
    localStorage.removeItem('ccd-sync-org');
    document.body.replaceChildren();
  });

  async function runBootstrap(options: { enabled?: boolean; navigateDuringRaw?: boolean } = {}) {
    const { context } = await capture();
    vi.stubGlobal('chrome', syntheticChrome);
    const events: string[] = [];
    const settings: ContentScriptSettings = {
      ...DEFAULT_SYNC_SETTINGS,
      isApiKeyConfigured: false,
      enableImageExport: options.enabled !== false,
      outputOptions: { file: true, obsidian: false, clipboard: false },
    };
    setClaudeLocation();
    localStorage.setItem('ccd-sync-org', ORG);
    vi.spyOn(ClaudeExtractor.prototype, 'canExtract').mockReturnValue(true);
    const fetcher = vi.fn(async (request: RequestInfo | URL) => {
      if (String(request) === url()) {
        events.push('contents');
        return originalResponse(url());
      }
      events.push('detail');
      return new Response(context.rawCaptureBundle.artifacts[0].bytes.slice(), {
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const writeReceipts = (outputs: PersistentOutputDestination[]) => ({
      results: outputs.map(destination => ({ destination, success: true })),
      allSuccessful: true,
      anySuccessful: true,
    });
    vi.mocked(sendMessage).mockImplementation(async (message: ExtensionMessage) => {
      switch (message.action) {
        case 'getSettings':
          return settings;
        case 'persistArchiveCompanion':
          expect(message.source).toBe('claude');
          events.push(message.artifact.kind);
          if (options.navigateDuringRaw && message.artifact.kind === 'raw') {
            // Same conversation ID; the selected Artifact changes only its exact route.
            setClaudeLocation(`?artifact=${FILE_A}`);
          }
          return writeReceipts(message.outputs);
        case 'beginStagedBinaryAsset':
        case 'appendStagedBinaryAsset':
          expect(message.source).toBe('claude');
          events.push(message.action);
          return { success: true };
        case 'commitStagedBinaryAsset':
          expect(message.source).toBe('claude');
          expect(message.descriptor.relativePath).toMatch(/^assets\/[a-f0-9]{64}\.txt$/);
          events.push('binary');
          return writeReceipts(message.outputs);
        case 'saveToOutputs':
          expect(message.data.body).toContain('Synthetic text');
          expect(message.data.body).not.toMatch(/synthetic-executable-name|assets\//);
          events.push('note');
          return writeReceipts(message.outputs as PersistentOutputDestination[]);
        default:
          throw new Error(`Unexpected synthetic runtime message: ${message.action}`);
      }
    });
    await handleSync();
    return events;
  }

  it('passes verified raw context through ClaudeExtractor and sends only archive binary staging requests', async () => {
    expect(await runBootstrap()).toEqual([
      'detail',
      'raw',
      'contents',
      'beginStagedBinaryAsset',
      'appendStagedBinaryAsset',
      'binary',
      'manifest',
      'canonical',
      'note',
    ]);
  });

  it('keeps the legacy raw/manifest/canonical and Markdown path when the toggle is off', async () => {
    expect(await runBootstrap({ enabled: false })).toEqual([
      'detail',
      'raw',
      'manifest',
      'canonical',
      'note',
    ]);
  });

  it('does not fetch or save the note after an exact same-conversation route change', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runBootstrap({ navigateDuringRaw: true })).toEqual(['detail', 'raw']);
  });
});
