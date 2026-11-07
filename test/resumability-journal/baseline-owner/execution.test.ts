// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import {
  createBaselineOwner,
  type BaselineOwner,
} from '../../../src/resumability-journal/baseline-owner';
import { createChatGptExecution } from '../../../src/resumability-journal/execution-coordinator';
import { nextBaselineDecision } from '../../../src/resumability-journal/baseline-plan';
import { encodeRecord } from '../../../src/resumability-journal/purpose-persistence-v2/core/record';
import { active, ids, signal, sha256, deferred } from './fixtures';
import { observed } from '../baseline-plan/fixtures';
import { response, hash } from '../purpose-persistence-v2/fixtures';
import { sink } from '../execution-coordinator/fixtures';
import { stagedSetup } from '../execution-coordinator/staged-fixtures';
import { validChatGptPngBytes } from '../../fixtures/chatgpt-image-bytes';
import type { OrdinaryDirectPngWrite } from '../../../src/resumability-journal/execution-coordinator/ordinary-direct-png';

const owners: BaselineOwner[] = [];
afterEach(() => {
  owners.splice(0).forEach(owner => owner.close());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function executionFixture(options: Parameters<typeof active>[0] = {}) {
  const ctx = await active(options);
  owners.push(ctx.owner);
  const reserved = await ctx.owner.reserveNextChatGpt(1, ctx.data.bytes, ids(), 102, signal());
  const identity = { ...ids(), planSha256: reserved.snapshot.plan.planSha256, item: reserved.item };
  const clock = { value: 103 };
  const port = await ctx.owner.createExecutionPort(identity, { now: () => clock.value });
  return { ...ctx, ...reserved, identity, clock, port };
}
it.each([undefined, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
  'requires an exact valid reserved revision, including %s',
  async revision => {
    const ctx = await executionFixture();
    await expect(
      ctx.port.claimDispatch(ids().operationId, revision as number)
    ).rejects.toBeDefined();
    expect((await ctx.owner.readSnapshot())?.operations[0]).toEqual(ctx.record);
  }
);
function raw(conversationId: string, png = false) {
  return JSON.stringify({
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
          content: { content_type: 'text', parts: ['Synthetic'] },
          ...(png && { metadata: { attachments: [{ id: 'file_one', mime_type: 'image/png' }] } }),
        },
      },
    },
  });
}
function input(ctx: Awaited<ReturnType<typeof executionFixture>>) {
  return {
    store: ctx.port,
    prepared: ctx.prepared,
    expectedReservedRevision: 0,
    noteFileName: 'synthetic.md',
    signal: signal(),
  };
}
it.each(['inline', 'staged', 'png'] as const)(
  'runs the existing %s coordinator through atomic owner evidence and explicit second reservation',
  async route => {
    const ctx = await executionFixture();
    const text = raw(ctx.item.conversationId, route === 'png');
    const staged =
      route !== 'inline' ? await stagedSetup({ text, destinations: ['file'] }) : undefined;
    const forbidden = vi.fn(() => {
      throw new Error('production forbidden');
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage: forbidden } });
    vi.stubGlobal('fetch', forbidden);
    const fetchAsset = vi.fn(
      async () => new Response(validChatGptPngBytes(), { headers: { 'content-type': 'image/png' } })
    );
    const persistBinaryAsset = vi.fn(async (write: OrdinaryDirectPngWrite) => ({
      assetId: write.descriptor.assetId,
      descriptor: write.descriptor,
      allSuccessful: true,
      results: write.destinations.map(destination => ({
        destination,
        success: true,
        sinkObservation: {
          kind: 'browser-download-complete-path-confirmed' as const,
          observedRelativePath: write.descriptor.relativePath,
        },
      })),
    }));
    const attachmentPolicy = {
      mode: 'explicit' as const,
      policy: 'ordinary-direct-png/1' as const,
      requestResolvers: vi.fn(async () => ({
        success: true as const,
        data: {
          transientAssetResolvers: [
            {
              resolverKey: hash(new TextEncoder().encode('liska-chatgpt-resolver/1\u0000file_one')),
              downloadUrl: `https://chatgpt.com/backend-api/estuary/content?${new URLSearchParams({ cid: ctx.item.conversationId, id: 'file_one', p: 'fs', sig: 'a'.repeat(64), ts: '123456', v: '1' })}`,
            },
          ],
        },
      })),
      fetchAsset,
      persistBinaryAsset,
      limits: { maxAssetBytes: 1024 * 1024, timeoutMs: 1000 },
    };
    const dependencies = staged
      ? { ...staged.dependencies, ...(route === 'png' && { attachmentPolicy }) }
      : {
          requestCapture: vi.fn(async () => response(text)),
          persistArtifacts: vi.fn(sink),
        };
    const handle = createChatGptExecution(input(ctx), dependencies);
    const pending = handle.run();
    expect(handle.run()).toBe(pending);
    const result = await pending;
    staged?.store.close();
    expect(result).toMatchObject({
      code: 'evidence-recorded',
      request: 'invoked',
      evidence: { state: 'committed', record: { phase: 'awaiting-resolution' } },
    });
    expect(dependencies.requestCapture).toHaveBeenCalledOnce();
    expect(forbidden).not.toHaveBeenCalled();
    expect(fetchAsset).toHaveBeenCalledTimes(route === 'png' ? 1 : 0);
    expect(persistBinaryAsset).toHaveBeenCalledTimes(route === 'png' ? 1 : 0);
    const snapshot = (await ctx.owner.readSnapshot())!;
    expect(snapshot.checkpoint.observations.map(item => item.recordRevision)).toEqual([0, 1, 2]);
    expect(snapshot.checkpoint.observations.at(-1)?.recordSha256).toBe(
      await sha256(encodeRecord(result.evidence.record))
    );
    expect(snapshot.checkpoint.links).toHaveLength(1);
    expect(snapshot.checkpoint.charges).toHaveLength(1);
    const decision = await nextBaselineDecision(
      snapshot.plan,
      snapshot.checkpoint,
      snapshot.operations,
      104,
      { sha256, signal: signal() }
    );
    expect(decision).toMatchObject({ kind: 'candidate' });
    expect(snapshot.operations).toHaveLength(1);
    const second = await ctx.owner.reserveNextChatGpt(
      snapshot.checkpoint.revision,
      ctx.data.bytes,
      ids('2'),
      104,
      signal()
    );
    expect(second.item.ordinal).not.toBe(ctx.item.ordinal);
    ctx.owner.close();
    const reopened = createBaselineOwner(ctx.settings);
    owners.push(reopened);
    await reopened.open();
    expect((await reopened.readSnapshot())?.operations).toContainEqual(result.evidence.record);
  }
);
it.each(['consistent', 'insufficient', 'conflict'] as const)(
  'adapts %s receipts itself and leaves resolution required',
  async kind => {
    const ctx = await executionFixture();
    await ctx.port.claimDispatch(ids().operationId, 0);
    const evidence = await observed(ctx.record, kind);
    const result = await ctx.port.recordProducerReceipts(
      ids().operationId,
      1,
      evidence.observation!.receipts
    );
    expect(result.observation?.adaptation.assessment.kind).toBe(kind);
    expect(result.phase).toBe('awaiting-resolution');
    expect((await ctx.owner.readSnapshot())?.checkpoint.charges).toHaveLength(1);
  }
);
it('persists and replays rejected hash-failure evidence without accepting a caller assessment', async () => {
  let failedIdentity = '';
  const ctx = await executionFixture({
    sha256: async bytes => {
      if (new TextDecoder().decode(bytes) === failedIdentity) throw new Error('private');
      return sha256(bytes);
    },
  });
  await ctx.port.claimDispatch(ids().operationId, 0);
  const supplied = await observed(ctx.record, 'consistent');
  failedIdentity = ctx.item.conversationId;
  const result = await ctx.port.recordProducerReceipts(
    ids().operationId,
    1,
    supplied.observation!.receipts
  );
  expect(result.observation).toMatchObject({
    hashOutcome: 'failed',
    adaptation: { assessment: { kind: 'rejected' } },
  });
  expect((await ctx.owner.readSnapshot())?.operations[0]).toEqual(result);
});
it.each(['plan', 'item', 'capture', 'destination'] as const)(
  'refuses wrong %s binding before an external effect',
  async wrong => {
    const ctx = await executionFixture();
    const effect = vi.fn(async () => response());
    if (wrong === 'destination') {
      const operation = { ...ctx.prepared.operation, destinations: [] };
      const { token } = await ctx.port.claimDispatch(ids().operationId, 0);
      await expect(ctx.port.consumeDispatch(token, operation, effect)).rejects.toBeDefined();
    } else {
      const identity = {
        ...ctx.identity,
        ...(wrong === 'plan' && { planSha256: 'f'.repeat(64) }),
        ...(wrong === 'capture' && { captureId: 'other' }),
        ...(wrong === 'item' && { item: { ...ctx.item, ordinal: ctx.item.ordinal + 1 } }),
      };
      await expect(
        ctx.owner.createExecutionPort(identity, { now: () => 103 })
      ).rejects.toBeDefined();
    }
    expect(effect).not.toHaveBeenCalled();
  }
);
it('competing recovered handles claim one exact reservation and never charge twice', async () => {
  const ctx = await executionFixture();
  const other = createBaselineOwner(ctx.settings);
  owners.push(other);
  await other.open();
  await other.recoverAfterRestart(2, 104, signal());
  await other.applyControl(3, { kind: 'activate', now: 104 });
  ctx.clock.value = 105;
  const port = await other.createExecutionPort(ctx.identity, { now: () => 105 });
  const results = await Promise.allSettled([
    ctx.port.claimDispatch(ids().operationId, 0),
    port.claimDispatch(ids().operationId, 0),
  ]);
  expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  expect((await other.readSnapshot())?.checkpoint.charges).toHaveLength(1);
});
it('returns the same code-unit operation ordering at commit, read and reopen without reordering history', async () => {
  const ctx = await active();
  owners.push(ctx.owner);
  const first = await ctx.owner.reserveNextChatGpt(1, ctx.data.bytes, ids('a'), 102, signal());
  const port = await ctx.owner.createExecutionPort(
    { ...ids('a'), item: first.item, planSha256: first.snapshot.plan.planSha256 },
    { now: () => 103 }
  );
  await port.claimDispatch(ids('a').operationId, 0);
  await port.recordProducerReceipts(ids('a').operationId, 1, []);
  const committed = (await ctx.owner.reserveNextChatGpt(4, ctx.data.bytes, ids('Z'), 104, signal()))
    .snapshot;
  expect(committed.operations.map(record => record.operation.operationId)).toEqual([
    'operation-Z',
    'operation-a',
  ]);
  expect(committed.checkpoint.links.map(link => link.operationId)).toEqual([
    'operation-a',
    'operation-Z',
  ]);
  expect(committed.checkpoint.observations.map(observation => observation.operationId)).toEqual([
    'operation-a',
    'operation-a',
    'operation-a',
    'operation-Z',
  ]);
  expect(await ctx.owner.readSnapshot()).toEqual(committed);
  ctx.owner.close();
  const reopened = createBaselineOwner(ctx.settings);
  owners.push(reopened);
  await reopened.open();
  expect(await reopened.readSnapshot()).toEqual(committed);
});
it.each(['pause', 'restart', 'interruption'] as const)(
  'atomically records %s unknown and admits late evidence without reactivation',
  async action => {
    const ctx = await executionFixture();
    const { token } = await ctx.port.claimDispatch(ids().operationId, 0);
    if (action === 'pause') await ctx.owner.applyControl(3, { kind: 'pause', now: 104 });
    else if (action === 'restart') await ctx.owner.recoverAfterRestart(3, 104, signal());
    else {
      ctx.clock.value = 104;
      await ctx.port.markExecutionUnknown(ids().operationId, 1, 'capture-failed');
    }
    const unknown = (await ctx.owner.readSnapshot())!;
    expect(unknown.checkpoint.control).toBe('paused');
    expect(unknown.operations[0]).toMatchObject({
      revision: 2,
      phase: 'unknown',
      interruptionReason:
        action === 'restart' ? 'restart' : action === 'pause' ? 'pause' : 'capture-failed',
    });
    expect(unknown.checkpoint.observations.at(-1)?.recordRevision).toBe(2);
    const effect = vi.fn();
    await expect(
      ctx.port.consumeDispatch(token, ctx.prepared.operation, effect)
    ).rejects.toBeDefined();
    expect(effect).not.toHaveBeenCalled();
    ctx.clock.value = 105;
    await ctx.port.recordProducerReceipts(ids().operationId, 2, []);
    expect((await ctx.owner.readSnapshot())?.checkpoint.control).toBe('paused');
    await ctx.owner.applyControl(6, { kind: 'activate', now: 105 });
    await expect(ctx.port.claimDispatch(ids().operationId, 3)).rejects.toBeDefined();
  }
);
it('reserved pause/recovery leaves the reservation intact and explicit activation permits a fresh claim', async () => {
  const ctx = await executionFixture();
  await ctx.owner.applyControl(2, { kind: 'pause', now: 103 });
  await expect(ctx.port.claimDispatch(ids().operationId, 0)).rejects.toBeDefined();
  await ctx.owner.recoverAfterRestart(3, 103, signal());
  await ctx.owner.applyControl(3, { kind: 'activate', now: 103 });
  expect((await ctx.port.claimDispatch(ids().operationId, 0)).record.phase).toBe('in-flight');
});
it('ordinary paused reserved reopen preserves exact bytes and restores no dispatch authority', async () => {
  const ctx = await executionFixture();
  const paused = await ctx.owner.applyControl(2, { kind: 'pause', now: 103 });
  ctx.owner.close();
  const reopened = createBaselineOwner(ctx.settings);
  owners.push(reopened);
  await reopened.open();
  const recovered = await reopened.recoverAfterRestart(3, 104, signal());
  expect(recovered).toEqual(paused);
  expect(recovered.ownerBytes).toEqual(paused.ownerBytes);
  const port = await reopened.createExecutionPort(ctx.identity, { now: () => 105 });
  const effect = vi.fn();
  await expect(
    port.consumeDispatch(Object.freeze({}), ctx.prepared.operation, effect)
  ).rejects.toBeDefined();
  await expect(port.claimDispatch(ids().operationId, 0)).rejects.toBeDefined();
  await expect(ctx.port.claimDispatch(ids().operationId, 0)).rejects.toBeDefined();
  expect(effect).not.toHaveBeenCalled();
  expect(await reopened.readSnapshot()).toEqual(paused);
  await reopened.applyControl(3, { kind: 'activate', now: 105 });
  const { token } = await port.claimDispatch(ids().operationId, 0);
  await port.consumeDispatch(token, ctx.prepared.operation, effect);
  expect(effect).toHaveBeenCalledOnce();
});
it.each([
  'copy',
  'forged',
  'wrong-operation',
  'wrong-destination',
  'callback-throw',
  'callback-reject',
] as const)('burns capabilities exactly once on %s', async fault => {
  const ctx = await executionFixture();
  const { token } = await ctx.port.claimDispatch(ids().operationId, 0);
  const selected = fault === 'copy' ? { ...token } : fault === 'forged' ? Object.freeze({}) : token;
  const operation =
    fault === 'wrong-operation'
      ? { ...ctx.prepared.operation, attemptId: 'other' }
      : fault === 'wrong-destination'
        ? { ...ctx.prepared.operation, destinations: [] }
        : ctx.prepared.operation;
  const effect = vi.fn(() => {
    if (fault === 'callback-reject') return Promise.reject(new Error('private'));
    throw new Error('private');
  });
  await expect(ctx.port.consumeDispatch(selected, operation, effect)).rejects.toBeDefined();
  await expect(
    ctx.port.consumeDispatch(selected, ctx.prepared.operation, effect)
  ).rejects.toBeDefined();
  expect(effect).toHaveBeenCalledTimes(fault.startsWith('callback') ? 1 : 0);
});
it('competing ports claim one revision; concurrent consumes invoke only once', async () => {
  const ctx = await executionFixture();
  const other = await ctx.owner.createExecutionPort(ctx.identity, { now: () => 103 });
  const claims = await Promise.allSettled([
    ctx.port.claimDispatch(ids().operationId, 0),
    other.claimDispatch(ids().operationId, 0),
  ]);
  expect(claims.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  const claim = claims.find(item => item.status === 'fulfilled')!;
  if (claim.status !== 'fulfilled') throw new Error();
  const effect = vi.fn(async () => 42);
  const results = await Promise.allSettled([
    ctx.port.consumeDispatch(claim.value.token, ctx.prepared.operation, effect),
    other.consumeDispatch(claim.value.token, ctx.prepared.operation, effect),
  ]);
  expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  expect(effect).toHaveBeenCalledOnce();
});
it('another recovered handle cannot consume a token and invalidates its exact checkpoint snapshot', async () => {
  const ctx = await executionFixture();
  const { token } = await ctx.port.claimDispatch(ids().operationId, 0);
  const other = createBaselineOwner(ctx.settings);
  owners.push(other);
  await other.open();
  await other.recoverAfterRestart(3, 104, signal());
  const port = await other.createExecutionPort(ctx.identity, { now: () => 104 });
  const effect = vi.fn();
  await expect(port.consumeDispatch(token, ctx.prepared.operation, effect)).rejects.toBeDefined();
  await expect(
    ctx.port.consumeDispatch(token, ctx.prepared.operation, effect)
  ).rejects.toBeDefined();
  expect(effect).not.toHaveBeenCalled();
});
it.each(['close', 'pause', 'recovery'] as const)(
  'fences a consume hash continuation on %s',
  async action => {
    const entered = deferred<void>(),
      gate = deferred<void>();
    let hold = false;
    const ctx = await executionFixture({
      sha256: async bytes => {
        if (hold) {
          hold = false;
          entered.resolve();
          await gate.promise;
        }
        return sha256(bytes);
      },
    });
    const { token } = await ctx.port.claimDispatch(ids().operationId, 0);
    hold = true;
    const effect = vi.fn();
    const consumed = ctx.port.consumeDispatch(token, ctx.prepared.operation, effect);
    const assertion = expect(consumed).rejects.toBeDefined();
    await entered.promise;
    if (action === 'close') ctx.owner.close();
    else if (action === 'pause') await ctx.owner.applyControl(3, { kind: 'pause', now: 104 });
    else await ctx.owner.recoverAfterRestart(3, 104, signal());
    gate.resolve();
    await assertion;
    expect(effect).not.toHaveBeenCalled();
  }
);
it('captures clock method and fails closed on regression without writing', async () => {
  const ctx = await executionFixture();
  const clock = { now: () => 103 };
  const port = await ctx.owner.createExecutionPort(ctx.identity, clock);
  clock.now = () => {
    throw new Error('changed');
  };
  const { token } = await port.claimDispatch(ids().operationId, 0);
  ctx.clock.value = 102;
  await expect(ctx.port.recordProducerReceipts(ids().operationId, 1, [])).rejects.toBeDefined();
  await expect(port.consumeDispatch(token, ctx.prepared.operation, vi.fn())).rejects.toBeDefined();
  expect((await ctx.owner.readSnapshot())?.operations[0].phase).toBe('in-flight');
});
