// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as binaryRuntime from '../../../src/content/staged-binary-persistence';
import * as messaging from '../../../src/lib/messaging';
import * as currentBranch from '../../../src/content/capture/chatgpt-current-branch';
import * as transport from '../../../src/lib/chatgpt-capture-contract';
import * as acquisitionCore from '../../../src/content/capture/chatgpt-asset-acquisition';
import * as resolverCore from '../../../src/content/capture/chatgpt-asset-resolver';
import {
  persistChatGptDestinationHonestAttachments,
  type ChatGptAssetExportDependencies,
} from '../../../src/content/chatgpt-asset-export';
import {
  createChatGptExecution,
  ExecutionInputError,
  type StagedExecutionDependencies,
} from '../../../src/resumability-journal/execution-coordinator';
import {
  createOrdinaryDirectPngAttempt,
  snapshotOrdinaryDirectPngPolicy,
  type OrdinaryDirectPngPolicy,
  type OrdinaryDirectPngWrite,
} from '../../../src/resumability-journal/execution-coordinator/ordinary-direct-png';
import type { PurposePersistenceStore } from '../../../src/resumability-journal/purpose-persistence-v2/idb';
import type { ChatGptAssetExportContext, StagedBinaryAssetResult } from '../../../src/lib/types';
import { validChatGptPngBytes } from '../../fixtures/chatgpt-image-bytes';
import { deferred } from '../../snapshot-catalog/fixtures';
import { conversationId, hash } from '../purpose-persistence-v2/fixtures';
import { selectedOutcome, stagedSetup } from './staged-fixtures';
import { sink } from './fixtures';

const stores: PurposePersistenceStore[] = [];
const forbidden = vi.fn(() => {
  throw new Error('unselected-effect');
});
beforeEach(() => {
  forbidden.mockClear();
  vi.stubGlobal('fetch', forbidden);
  vi.spyOn(binaryRuntime, 'persistVerifiedBinaryAssets').mockImplementation(forbidden);
  vi.spyOn(messaging, 'sendMessage').mockImplementation(forbidden);
});
afterEach(() => {
  expect(forbidden).not.toHaveBeenCalled();
  stores.splice(0).forEach(store => store.close());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function raw(
  attachments: Record<string, unknown>[] = [{ id: 'file_one', mime_type: 'image/png' }],
  extra = {}
) {
  return JSON.stringify({
    conversation_id: conversationId,
    title: 'Synthetic',
    current_node: 'a',
    ...extra,
    mapping: {
      a: {
        id: 'a',
        parent: null,
        children: [],
        message: {
          id: 'a',
          author: { role: 'assistant' },
          content: { content_type: 'text', parts: ['Synthetic'] },
          metadata: { attachments },
        },
      },
    },
  });
}
function url(id = 'file_one', cid = conversationId) {
  return `https://chatgpt.com/backend-api/estuary/content?${new URLSearchParams({ cid, id, p: 'fs', sig: 'a'.repeat(64), ts: '123456', v: '1' })}`;
}
function resolved(ids = ['file_one'], download = url) {
  return {
    success: true as const,
    data: {
      transientAssetResolvers: ids.map(id => ({
        resolverKey: hash(new TextEncoder().encode(`liska-chatgpt-resolver/1\u0000${id}`)),
        downloadUrl: download(id),
      })),
    },
  };
}
function binaryResult(write: OrdinaryDirectPngWrite): StagedBinaryAssetResult {
  return {
    assetId: write.descriptor.assetId,
    descriptor: { ...write.descriptor },
    allSuccessful: true,
    results: write.destinations.map(destination => ({
      destination,
      success: true,
      sinkObservation:
        destination === 'file'
          ? {
              kind: 'browser-download-complete-path-confirmed',
              observedRelativePath: write.descriptor.relativePath,
            }
          : {
              kind: 'byte-readback-sha256',
              byteLength: write.bytes.byteLength,
              sha256: write.descriptor.sha256,
            },
    })),
  };
}
async function fixture(
  options: { text?: string; staged?: boolean; destinations?: ('file' | 'obsidian')[] } = {}
) {
  const ctx = await stagedSetup({
    inline: !options.staged,
    text: options.text ?? raw(),
    destinations: options.destinations,
  });
  stores.push(ctx.store);
  const requestResolvers = vi.fn(async () => resolved());
  const fetchAsset = vi.fn<typeof fetch>(
    async () => new Response(validChatGptPngBytes(), { headers: { 'content-type': 'image/png' } })
  );
  const persistBinaryAsset = vi.fn(async (write: OrdinaryDirectPngWrite) => binaryResult(write));
  const policy = {
    mode: 'explicit' as const,
    policy: 'ordinary-direct-png/1' as const,
    requestResolvers,
    fetchAsset,
    persistBinaryAsset,
    limits: { maxAssetBytes: 1024 * 1024, timeoutMs: 1000 },
  };
  const execute = (attachmentPolicy: unknown = policy) =>
    createChatGptExecution(ctx.input, {
      ...ctx.dependencies,
      attachmentPolicy,
    } as StagedExecutionDependencies);
  return { ...ctx, requestResolvers, fetchAsset, persistBinaryAsset, policy, execute };
}

it('runs the real staged raw -> whole-ledger resolver -> verified PNG -> injected sink -> canonical -> evidence pipeline once', async () => {
  const ctx = await fixture({ staged: true });
  const acquire = vi.spyOn(acquisitionCore, 'acquireChatGptPageOwnedAssets');
  const handle = ctx.execute();
  const result = await handle.run();
  expect(handle.run()).toBe(handle.run());
  expect(result.code).toBe('evidence-recorded');
  expect(ctx.requestCapture).toHaveBeenCalledTimes(1);
  expect(ctx.requestResolvers).toHaveBeenCalledExactlyOnceWith(conversationId);
  expect(ctx.fetchAsset).toHaveBeenCalledTimes(1);
  expect(ctx.fetchAsset.mock.calls[0][1]).toMatchObject({
    method: 'GET',
    credentials: 'include',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
  });
  expect(ctx.persistBinaryAsset).toHaveBeenCalledTimes(1);
  expect(acquire).toHaveBeenCalledTimes(1);
  expect(acquire.mock.calls[0][0]).toMatchObject({
    maxAssetBytes: 1024 * 1024,
    maxTotalBytes: 1024 * 1024,
    timeoutMs: 1000,
  });
  expect(acquire.mock.calls[0][0].budget?.attemptsRemaining).toBe(0);
  expect(acquire.mock.calls[0][0].candidates).toHaveLength(1);
  expect(result.attachments).toMatchObject({
    resolver: { state: 'matched', eligibleCount: 1, matchedCount: 1 },
    acquisition: {
      state: 'attempted',
      outcome: 'verified',
      mediaType: 'image/png',
      byteLength: validChatGptPngBytes().byteLength,
    },
    binary: {
      state: 'invoked',
      outcome: 'returned',
      destinations: ['file', 'obsidian'],
      cleanupUncertain: false,
    },
  });
  expect(result.producer?.producerReceipts).toHaveLength(2);
  expect(
    result.producer?.producerReceipts?.every(receipt => receipt.assets[0].state === 'fetched')
  ).toBe(true);
  expect(result.evidence.state).toBe('committed');
  const facts = JSON.stringify(result.attachments);
  expect(facts).not.toMatch(/https:|file_one|signature|resolverKey|downloadUrl|body/);
  expect(Object.isFrozen(result.attachments?.binary.results[0])).toBe(true);
});

it('the actual fetch fence catches stop queued by the real post-selection URL verification await', async () => {
  const ctx = await fixture();
  const validate = transport.isChatGptTransientDownloadUrl;
  let count = 0;
  vi.spyOn(transport, 'isChatGptTransientDownloadUrl').mockImplementation((...args) => {
    const result = validate(...args);
    if (++count === 2) queueMicrotask(() => ctx.abort.abort());
    return result;
  });
  const result = await ctx.execute().run();
  expect(count).toBe(2);
  expect(result.code).toBe('execution-cancelled');
  expect(ctx.fetchAsset).not.toHaveBeenCalled();
  expect(ctx.persistBinaryAsset).not.toHaveBeenCalled();
  expect(result.attachments?.acquisition.state).toBe('not-started');
  expect(ctx.persistSelectedArtifacts).toHaveBeenCalledTimes(1);
});

it('whole-ledger matching never promotes a weaker alias after its direct winner is already attempted', async () => {
  const ctx = await fixture({
    text: raw([
      { id: 'file_one', mime_type: 'image/png' },
      { asset_pointer: 'file-service://file_one', mime_type: 'image/png' },
    ]),
  });
  const result = await createChatGptExecution(ctx.input, ctx.dependencies).run();
  const context = result.capture!.assetExportContext!;
  const direct = context.rawCaptureBundle.manifest.assets.find(record =>
    record.sourceRefs.some(ref => ref.rawPointer.endsWith('/0'))
  )!;
  direct.state = 'failed';
  const policy = snapshotOrdinaryDirectPngPolicy(ctx.policy) as Extract<
    OrdinaryDirectPngPolicy,
    { mode: 'explicit' }
  >;
  const attempt = createOrdinaryDirectPngAttempt(
    policy,
    ['file'],
    () => false,
    ctx.dependencies.now
  );
  await attempt.attempt(
    context,
    ['file'],
    JSON.parse(new TextDecoder().decode(context.rawCaptureBundle.artifacts[0].bytes))
  );
  expect(attempt.facts().resolver).toMatchObject({
    state: 'matched',
    eligibleCount: 1,
    matchedCount: 0,
  });
  expect(ctx.fetchAsset).not.toHaveBeenCalled();
});

it('interpreter aliases beyond the existing family plan cap deny ordinary identities without blocking an unrelated direct PNG', async () => {
  const attachments = Array.from({ length: 24 }, (_, i) => ({
    id: `file_interp_${i}`,
    mime_type: 'image/png',
    name: `/mnt/data/a${i}.png`,
  }));
  attachments.push({ id: 'file_one', mime_type: 'image/png', name: '/mnt/data/interpreter.png' });
  const ctx = await fixture({
    text: raw([
      ...attachments,
      { id: 'file_two', mime_type: 'image/png' },
      { asset_pointer: 'file-service://file_one', mime_type: 'image/png' },
    ]),
  });
  ctx.requestResolvers.mockResolvedValue(resolved(['file_one', 'file_two']));
  const result = await ctx.execute().run();
  expect(ctx.fetchAsset).toHaveBeenCalledExactlyOnceWith(url('file_two'), expect.any(Object));
  expect(result.attachments?.acquisition.outcome).toBe('verified');
});

it('a pointer-only interpreter alias denies a stronger ordinary direct winner for the same identity', async () => {
  const ctx = await fixture({
    text: raw([
      { id: 'file_one', mime_type: 'image/png' },
      {
        asset_pointer: 'file-service://file_one',
        mime_type: 'image/png',
        name: '/mnt/data/interpreter.png',
      },
    ]),
  });
  await ctx.execute().run();
  expect(ctx.requestResolvers).toHaveBeenCalledTimes(1);
  expect(ctx.fetchAsset).not.toHaveBeenCalled();
});

it('a merged record with two interpreter locations is owned even though it has no unambiguous dispatch plan', async () => {
  const ctx = await fixture({
    text: raw([
      { id: 'file_one', mime_type: 'image/png', name: '/mnt/data/first.png' },
      { id: 'file_one', mime_type: 'image/png', name: '/mnt/data/second.png' },
    ]),
  });
  const result = await ctx.execute().run();
  // Existing canonical normalization rejects duplicate same-ID attachment labels.
  // Its retained real raw/manifest still lets the explicit producer/policy boundary
  // exercise this merged inventory without replacing the normalizer or matcher.
  expect(result.captureError?.code).toBe('normalization-failed');
  const companion = result.captureError!.archiveCompanion!;
  const [rawArtifact, manifestArtifact] = companion.artifacts;
  if (rawArtifact.transport !== 'inline' || manifestArtifact.transport !== 'inline')
    throw new Error('fixture');
  const bytes = new Uint8Array(Buffer.from(rawArtifact.bodyBase64, 'base64'));
  const manifest: ChatGptAssetExportContext['rawCaptureBundle']['manifest'] = JSON.parse(
    Buffer.from(manifestArtifact.bodyBase64, 'base64').toString('utf8')
  );
  const context: ChatGptAssetExportContext = {
    conversationId,
    routeFamily: 'standard',
    rawArtifact,
    rawCaptureBundle: {
      manifest,
      artifacts: [{ record: manifest.artifacts[0], bytes }],
      assets: [],
    },
  };
  expect(manifest.assets).toHaveLength(1);
  expect(manifest.assets[0].sourceRefs).toHaveLength(2);
  const policy = snapshotOrdinaryDirectPngPolicy(ctx.policy) as Extract<
    OrdinaryDirectPngPolicy,
    { mode: 'explicit' }
  >;
  const attempt = createOrdinaryDirectPngAttempt(
    policy,
    ['file'],
    () => false,
    ctx.dependencies.now
  );
  const persistArtifacts = vi.fn(sink);
  await persistChatGptDestinationHonestAttachments(context, companion, 'merged.md', ['file'], {
    persistArtifacts,
    assetAcquisition: {
      mode: 'explicit',
      attempt: attempt.attempt,
      isStopped: () => false,
      buildDestinationArchive: currentBranch.buildChatGptBinaryAwareDestinationArchive,
    },
  });
  expect(persistArtifacts.mock.calls[0][4]).toEqual(['raw']);
  expect(attempt.facts().resolver).toMatchObject({
    state: 'matched',
    eligibleCount: 1,
    matchedCount: 1,
  });
  expect(attempt.facts().acquisition.state).toBe('not-started');
  expect(ctx.requestResolvers).toHaveBeenCalledTimes(1);
  expect(ctx.fetchAsset).not.toHaveBeenCalled();
  expect(ctx.persistBinaryAsset).not.toHaveBeenCalled();
});

it('an ineligible JPEG Library sibling still denies its ambiguous PNG identity before eligibility filtering', async () => {
  const ctx = await fixture({
    text: raw([
      { id: 'file_one', mime_type: 'image/png' },
      {
        file_id: 'file_other',
        id: 'file_one',
        mime_type: 'image/jpeg',
        library_file_id: 'private-library',
      },
    ]),
  });
  ctx.requestResolvers.mockResolvedValue(resolved(['file_one', 'file_other']));
  const result = await ctx.execute().run();
  expect(result.attachments?.resolver).toMatchObject({
    state: 'matched',
    eligibleCount: 1,
    matchedCount: 0,
  });
  expect(ctx.fetchAsset).not.toHaveBeenCalled();
});

it('an interpreter ownership helper failure fails closed without another request or any acquisition', async () => {
  const ctx = await fixture();
  vi.spyOn(resolverCore, 'hasChatGptInterpreterAssetOwnership').mockRejectedValue(
    new Error('private-planner')
  );
  const result = await ctx.execute().run();
  expect(ctx.requestResolvers).toHaveBeenCalledTimes(1);
  expect(ctx.fetchAsset).not.toHaveBeenCalled();
  expect(result.attachments?.acquisition.state).toBe('not-started');
  expect(JSON.stringify(result.attachments)).not.toContain('private-planner');
});

it('a strict explicit byte limit fails the one attempt without choosing another PNG', async () => {
  const ctx = await fixture({
    text: raw([
      { id: 'file_one', mime_type: 'image/png' },
      { id: 'file_two', mime_type: 'image/png' },
    ]),
  });
  ctx.requestResolvers.mockResolvedValue(resolved(['file_one', 'file_two']));
  ctx.policy.limits.maxAssetBytes = 1;
  const result = await ctx.execute().run();
  expect(ctx.fetchAsset).toHaveBeenCalledTimes(1);
  expect(ctx.persistBinaryAsset).not.toHaveBeenCalled();
  expect(result.attachments?.acquisition.outcome).toBe('failed');
});

it.each(['requestResolvers', 'fetchAsset', 'persistBinaryAsset', 'limits'] as const)(
  'rejects missing %s synchronously before claim',
  async key => {
    const ctx = await fixture();
    const claim = vi.spyOn(ctx.store, 'claimDispatch');
    const malformed = { ...ctx.policy } as Record<string, unknown>;
    delete malformed[key];
    expect(() => ctx.execute(malformed)).toThrow(ExecutionInputError);
    expect(claim).not.toHaveBeenCalled();
    expect(ctx.requestCapture).not.toHaveBeenCalled();
  }
);
it.each(['requestResolvers', 'fetchAsset', 'persistBinaryAsset', 'limits', 'mode'] as const)(
  'rejects accessor %s without invoking it before claim',
  async key => {
    const ctx = await fixture();
    const claim = vi.spyOn(ctx.store, 'claimDispatch');
    const getter = vi.fn();
    const malformed = { ...ctx.policy };
    Object.defineProperty(malformed, key, { get: getter });
    expect(() => ctx.execute(malformed)).toThrow(ExecutionInputError);
    expect(getter).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  }
);
it.each([
  { mode: 'disabled', fetchAsset: () => {} },
  { mode: 'other' },
  { policy: 'ordinary-direct-png/2' },
  { extra: true },
  { limits: { maxAssetBytes: 1 } },
  ...[NaN, Infinity, 0, -1, 1.5, 8 * 1024 * 1024 + 1].map(maxAssetBytes => ({
    limits: { maxAssetBytes, timeoutMs: 1000 },
  })),
  ...[NaN, Infinity, 999, 30001, 1000.5].map(timeoutMs => ({
    limits: { maxAssetBytes: 1024, timeoutMs },
  })),
])('rejects partial, unknown or malformed capability %# before claim', async change => {
  const ctx = await fixture();
  const claim = vi.spyOn(ctx.store, 'claimDispatch');
  expect(() => ctx.execute({ ...ctx.policy, ...change })).toThrow(ExecutionInputError);
  expect(claim).not.toHaveBeenCalled();
});
it('rejects accessor/extra limits and inline policy injection, and snapshots later mutation', async () => {
  const ctx = await fixture();
  const getter = vi.fn();
  Object.defineProperty(ctx.policy.limits, 'maxAssetBytes', { get: getter, configurable: true });
  expect(() => ctx.execute()).toThrow(ExecutionInputError);
  expect(getter).not.toHaveBeenCalled();
  Object.defineProperty(ctx.policy.limits, 'maxAssetBytes', { value: 1024, writable: true });
  expect(() => ctx.execute({ ...ctx.policy, limits: { ...ctx.policy.limits, extra: 1 } })).toThrow(
    ExecutionInputError
  );
  expect(() =>
    createChatGptExecution(ctx.input, {
      requestCapture: vi.fn(),
      persistArtifacts: vi.fn(),
      attachmentPolicy: ctx.policy,
    } as never)
  ).toThrow(ExecutionInputError);
  const handle = ctx.execute();
  ctx.policy.fetchAsset = forbidden;
  ctx.policy.limits.maxAssetBytes = NaN;
  expect((await handle.run()).attachments?.acquisition.outcome).toBe('verified');
});

it.each([undefined, { mode: 'disabled' }])(
  'omission and disabled stay inventory-only %#',
  async policy => {
    const ctx = await fixture();
    const deps = { ...ctx.dependencies, ...(policy && { attachmentPolicy: policy }) };
    const result = await createChatGptExecution(
      ctx.input,
      deps as StagedExecutionDependencies
    ).run();
    expect(ctx.requestResolvers).not.toHaveBeenCalled();
    expect(ctx.fetchAsset).not.toHaveBeenCalled();
    expect(ctx.persistBinaryAsset).not.toHaveBeenCalled();
    expect(result.attachments).toBeUndefined();
  }
);
it.each(['owner', 'raw'] as const)('retains the %s gate before any resolver effect', async gate => {
  const ctx = await fixture({
    text: raw(undefined, gate === 'owner' ? { project_id: 'private-project' } : {}),
  });
  if (gate === 'raw') ctx.hooks.sink = () => ({ activeOutputs: [], warnings: [] });
  const result = await ctx.execute().run();
  expect(ctx.requestResolvers).not.toHaveBeenCalled();
  expect(ctx.fetchAsset).not.toHaveBeenCalled();
  expect(result.attachments?.resolver.state).toBe('not-started');
});

it.each(
  [
    [{ id: 'file_one', mime_type: 'image/png', library_file_id: 'private-library' }],
    [{ id: 'file_one', mime_type: 'image/png', name: '/mnt/data/private.png' }],
    [{ id: 'file_one', file_id: 'file_two', mime_type: 'image/png' }],
    [
      { id: 'file_one', mime_type: 'image/png' },
      {
        id: 'file_other',
        file_id: 'file_one',
        mime_type: 'image/png',
        library_file_id: 'private-library',
      },
    ],
  ].map(attachments => ({ attachments }))
)('whole-ledger identity exclusions prevent acquisition %#', async ({ attachments }) => {
  const ctx = await fixture({ text: raw(attachments) });
  ctx.requestResolvers.mockResolvedValue(resolved(['file_one', 'file_two', 'file_other']));
  const result = await ctx.execute().run();
  expect(ctx.requestResolvers).toHaveBeenCalledTimes(1);
  expect(ctx.fetchAsset).not.toHaveBeenCalled();
  expect(result.attachments?.acquisition.state).toBe('not-started');
});
it.each([
  'image/jpeg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  null,
])('ignores non-declared-PNG MIME %s', async mime_type => {
  const ctx = await fixture({ text: raw([{ id: 'file_one', mime_type }]) });
  await ctx.execute().run();
  expect(ctx.requestResolvers).not.toHaveBeenCalled();
  expect(ctx.fetchAsset).not.toHaveBeenCalled();
});
it.each(['numeric', 'foreign', 'invalid'] as const)(
  'ignores %s transient transport',
  async kind => {
    const ctx = await fixture();
    ctx.requestResolvers.mockResolvedValue(
      resolved(['file_one'], id =>
        kind === 'numeric'
          ? url(id, '123456')
          : kind === 'foreign'
            ? url(id, '22222222-2222-4333-8444-555555555555')
            : 'https://example.invalid/private'
      )
    );
    await ctx.execute().run();
    expect(ctx.fetchAsset).not.toHaveBeenCalled();
  }
);
it.each(['resolver', 'fetch'] as const)(
  'one %s failure never falls back or tries a second asset',
  async failure => {
    const ctx = await fixture({
      text: raw([
        { id: 'file_one', mime_type: 'image/png' },
        { id: 'file_two', mime_type: 'image/png' },
      ]),
    });
    ctx.requestResolvers.mockResolvedValue(resolved(['file_one', 'file_two']));
    if (failure === 'resolver') ctx.requestResolvers.mockRejectedValue(new Error('private-token'));
    else ctx.fetchAsset.mockRejectedValue(new Error('private-token'));
    const result = await ctx.execute().run();
    expect(ctx.requestCapture).toHaveBeenCalledTimes(1);
    expect(ctx.requestResolvers).toHaveBeenCalledTimes(1);
    expect(ctx.fetchAsset).toHaveBeenCalledTimes(failure === 'fetch' ? 1 : 0);
    expect(ctx.persistBinaryAsset).not.toHaveBeenCalled();
    expect(JSON.stringify(result.attachments)).not.toContain('private-token');
  }
);

it.each(['before-resolver', 'resolver', 'fetch', 'binary', 'finalization'] as const)(
  'stop at %s drains started effects and prevents later effects',
  async boundary => {
    const ctx = await fixture();
    const pending = deferred<never>();
    const entered = deferred<void>();
    if (boundary === 'before-resolver')
      ctx.hooks.sink = write => {
        ctx.abort.abort();
        return selectedOutcome(write);
      };
    if (boundary === 'resolver')
      ctx.requestResolvers.mockImplementation(async () => {
        entered.resolve();
        await pending.promise;
        return resolved();
      });
    if (boundary === 'fetch')
      ctx.fetchAsset.mockImplementation(async () => {
        entered.resolve();
        await pending.promise;
        return new Response(validChatGptPngBytes(), { headers: { 'content-type': 'image/png' } });
      });
    if (boundary === 'binary')
      ctx.persistBinaryAsset.mockImplementation(async write => {
        entered.resolve();
        await pending.promise;
        return binaryResult(write);
      });
    if (boundary === 'finalization')
      ctx.hooks.sink = async write => {
        if (write.artifacts.some(item => item.kind === 'manifest')) {
          entered.resolve();
          await pending.promise;
        }
        return selectedOutcome(write);
      };
    // Resolving an await-only deferred with undefined is deliberately value-independent.
    const release = () => pending.resolve(undefined as never);
    let settled = false;
    const running = ctx
      .execute()
      .run()
      .then(result => {
        settled = true;
        return result;
      });
    if (boundary !== 'before-resolver') {
      await entered.promise;
      ctx.abort.abort();
      await Promise.resolve();
      expect(settled).toBe(false);
      release();
    }
    const result = await running;
    expect(result.code).toBe('execution-cancelled');
    expect(result.evidence.state).toBe('not-attempted');
    expect(ctx.requestResolvers).toHaveBeenCalledTimes(boundary === 'before-resolver' ? 0 : 1);
    expect(ctx.fetchAsset).toHaveBeenCalledTimes(
      ['fetch', 'binary', 'finalization'].includes(boundary) ? 1 : 0
    );
    expect(ctx.persistBinaryAsset).toHaveBeenCalledTimes(
      ['binary', 'finalization'].includes(boundary) ? 1 : 0
    );
    expect(ctx.persistSelectedArtifacts).toHaveBeenCalledTimes(boundary === 'finalization' ? 2 : 1);
    if (['fetch', 'binary', 'finalization'].includes(boundary))
      expect(result.attachments?.acquisition.outcome).toBe('verified');
    if (['binary', 'finalization'].includes(boundary))
      expect(result.attachments?.binary.outcome).toBe('returned');
  }
);

it.each([
  'throw',
  'reject',
  'malformed',
  'expansion',
  'getter',
  'descriptor',
  'observation',
  'extra',
] as const)(
  'sink %s retains verified acquisition and unknown ownership without retry or cleanup',
  async failure => {
    const ctx = await fixture({ destinations: ['file'] });
    const getter = vi.fn();
    ctx.persistBinaryAsset.mockImplementation(write => {
      if (failure === 'throw') throw new Error('private-token');
      if (failure === 'reject') return Promise.reject(new Error('private-token'));
      const result = binaryResult(write);
      if (failure === 'malformed') return Promise.resolve({ unknown: true } as never);
      if (failure === 'expansion') result.results.push({ destination: 'obsidian', success: true });
      if (failure === 'getter') Object.defineProperty(result, 'results', { get: getter });
      if (failure === 'descriptor') result.descriptor!.sha256 = 'a'.repeat(64);
      if (failure === 'observation')
        result.results[0].sinkObservation = {
          kind: 'browser-download-complete-path-confirmed',
          observedRelativePath: 'assets/wrong.png',
        };
      if (failure === 'extra') Object.assign(result, { unknown: true });
      return Promise.resolve(result);
    });
    const result = await ctx.execute().run();
    expect(getter).not.toHaveBeenCalled();
    expect(ctx.persistBinaryAsset).toHaveBeenCalledTimes(1);
    expect(result.attachments?.acquisition.outcome).toBe('verified');
    expect(result.attachments?.binary).toEqual({
      state: 'invoked',
      outcome: 'outcome-unknown',
      destinations: ['file'],
      results: [],
      cleanupUncertain: true,
    });
    expect(result.producer?.producerReceipts?.[0].assets[0].state).toBe('failed');
  }
);
it.each(['unknown', 'not-dispatched'] as const)(
  'normalizes a typed %s destination outcome identically in public facts and producer assurance',
  async writeState => {
    const ctx = await fixture({ destinations: ['obsidian'] });
    ctx.persistBinaryAsset.mockImplementation(async write => {
      const result = binaryResult(write);
      Object.assign(result.results[0], { writeOutcome: { state: writeState } });
      return result;
    });
    const result = await ctx.execute().run();
    expect(result.attachments?.binary).toMatchObject({
      outcome: 'returned',
      cleanupUncertain: true,
      results: [{ destination: 'obsidian', success: false, writeState }],
    });
    expect(result.attachments?.binary.results[0]).not.toHaveProperty('observation');
    expect(result.producer?.producerReceipts?.[0].assets[0].state).toBe('failed');
  }
);

it.each([true, false])(
  'normalizes confirmed success=%s without retaining a contradictory failure observation',
  async success => {
    const ctx = await fixture({ destinations: ['obsidian'] });
    ctx.persistBinaryAsset.mockImplementation(async write => {
      const result = binaryResult(write);
      result.results[0].success = success;
      result.allSuccessful = success;
      Object.assign(result.results[0], { writeOutcome: { state: 'confirmed' } });
      return result;
    });
    const result = await ctx.execute().run();
    expect(result.attachments?.binary.results[0]).toMatchObject({
      destination: 'obsidian',
      success,
      writeState: 'confirmed',
    });
    if (success) expect(result.attachments?.binary.results[0].observation).toBeDefined();
    else expect(result.attachments?.binary.results[0]).not.toHaveProperty('observation');
    expect(result.producer?.producerReceipts?.[0].assets[0].state).toBe(
      success ? 'fetched' : 'failed'
    );
  }
);
it('uses exactly raw-successful destinations and retains safe failure/cleanup facts without caller mutation', async () => {
  const ctx = await fixture();
  ctx.hooks.sink = write => ({ ...selectedOutcome(write), activeOutputs: ['obsidian'] });
  let returned: StagedBinaryAssetResult;
  ctx.persistBinaryAsset.mockImplementation(async write => {
    expect(write.destinations).toEqual(['obsidian']);
    returned = binaryResult(write);
    returned.results[0] = {
      destination: 'obsidian',
      success: false,
      error: 'private-token',
      warning: 'binary-stage-cleanup-deferred',
    };
    returned.allSuccessful = false;
    write.bytes.fill(0);
    return returned;
  });
  const result = await ctx.execute().run();
  const before = JSON.stringify(result.attachments);
  returned!.results[0].success = true;
  returned!.descriptor!.sha256 = 'a'.repeat(64);
  expect(JSON.stringify(result.attachments)).toBe(before);
  expect(before).not.toContain('private-token');
  expect(result.attachments?.binary.results).toEqual([
    { destination: 'obsidian', success: false, cleanupDeferred: true },
  ]);
  expect(result.attachments?.binary.cleanupUncertain).toBe(true);
});
it('later canonical builder and evidence CAS failures cannot erase completed attachment facts', async () => {
  const ctx = await fixture();
  vi.spyOn(ctx.store, 'recordProducerReceipts').mockRejectedValue(new Error('cas-failed'));
  const result = await ctx.execute().run();
  expect(result.code).toBe('evidence-persistence-failed');
  expect(result.attachments?.binary.outcome).toBe('returned');
  const next = await fixture();
  vi.spyOn(currentBranch, 'buildChatGptBinaryAwareDestinationArchive').mockRejectedValue(
    new Error('builder-failed')
  );
  const failed = await next.execute().run();
  expect(failed.code).toBe('producer-incomplete');
  expect(failed.attachments?.acquisition.outcome).toBe('verified');
  expect(failed.attachments?.binary.outcome).toBe('returned');
});

it.each(['attempt', 'buildDestinationArchive', 'isStopped'] as const)(
  'explicit producer rejects missing %s before any producer effect',
  async key => {
    const persistArtifacts = vi.fn();
    const mode: Record<string, unknown> = {
      mode: 'explicit',
      attempt: vi.fn(),
      buildDestinationArchive: vi.fn(),
      isStopped: () => false,
    };
    delete mode[key];
    await expect(
      persistChatGptDestinationHonestAttachments({} as never, {} as never, 'x', ['file'], {
        persistArtifacts,
        assetAcquisition: mode,
      } as unknown as ChatGptAssetExportDependencies)
    ).rejects.toThrow('invalid-explicit-assets');
    expect(persistArtifacts).not.toHaveBeenCalled();
  }
);

it.each(['accessor', 'extra', 'persist-getter', 'persist-missing'] as const)(
  'explicit producer rejects %s capabilities before any producer effect',
  async kind => {
    const getter = vi.fn();
    const dependencies: Record<string, unknown> = {
      persistArtifacts: vi.fn(),
      assetAcquisition: {
        mode: 'explicit',
        attempt: vi.fn(),
        buildDestinationArchive: vi.fn(),
        isStopped: () => false,
      },
    };
    if (kind === 'accessor')
      Object.defineProperty(dependencies.assetAcquisition, 'attempt', { get: getter });
    if (kind === 'extra')
      Object.assign(dependencies.assetAcquisition as object, { extra: vi.fn() });
    if (kind === 'persist-getter')
      Object.defineProperty(dependencies, 'persistArtifacts', { get: getter });
    if (kind === 'persist-missing') delete dependencies.persistArtifacts;
    await expect(
      persistChatGptDestinationHonestAttachments(
        {} as never,
        {} as never,
        'x',
        ['file'],
        dependencies as unknown as ChatGptAssetExportDependencies
      )
    ).rejects.toThrow('invalid-explicit-assets');
    expect(getter).not.toHaveBeenCalled();
  }
);
