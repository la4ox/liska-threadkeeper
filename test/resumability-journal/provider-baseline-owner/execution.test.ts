// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProviderBaselineOwner,
  ProviderExecutionPortError,
  type ProviderBaselineOwner,
} from '../../../src/resumability-journal/provider-baseline-owner';
import { isProviderExecutionPort } from '../../../src/resumability-journal/provider-baseline-owner/port';
import { observed } from '../provider-baseline/fixtures';
import { active, deferred, identity, ids, sha256, signal } from './fixtures';

const owners: ProviderBaselineOwner[] = [];
afterEach(() => {
  owners.splice(0).forEach(owner => owner.close());
  vi.restoreAllMocks();
});

async function executionFixture(
  provider: 'chatgpt' | 'claude' = 'chatgpt',
  options: Parameters<typeof active>[0] = {}
) {
  const context = await active(options, [identity(0, provider)]);
  owners.push(context.owner);
  const reservation = await context.owner.reserveNext(
    1,
    context.bytes,
    ids(provider),
    102,
    signal()
  );
  const bound = {
    ...ids(provider),
    planSha256: reservation.snapshot.plan.planSha256,
    item: reservation.item,
  };
  const clock = { value: 103 };
  const port = await context.owner.createExecutionPort(bound, { now: () => clock.value });
  return { ...context, ...reservation, identity: bound, clock, port };
}

describe('provider owner bound journal/3 execution port', () => {
  it.each(['chatgpt', 'claude'] as const)(
    'brands an exact frozen %s port and binds every method to one full identity',
    async provider => {
      const context = await executionFixture(provider);
      expect(Object.keys(context.port)).toEqual([
        'read',
        'claimDispatch',
        'consumeDispatch',
        'markExecutionUnknown',
        'recordProducerReceipts',
      ]);
      expect(Object.getPrototypeOf(context.port)).toBe(Object.prototype);
      expect(Object.isFrozen(context.port)).toBe(true);
      expect(isProviderExecutionPort(context.port)).toBe(true);
      expect(isProviderExecutionPort({ ...context.port })).toBe(false);
      expect(await context.port.read()).toEqual(context.record);
      await expect(
        context.owner.createExecutionPort(
          { ...context.identity, captureId: 'capture-foreign' },
          { now: () => 103 }
        )
      ).rejects.toMatchObject({ code: 'corrupt-owner' });
    }
  );

  it('keeps equal conversation IDs provider-bound across two explicit lifecycle reservations', async () => {
    const chatgpt = identity(0, 'chatgpt');
    const claude = identity(0, 'claude');
    expect(chatgpt.conversationId).toBe(claude.conversationId);
    const context = await active({}, [claude, chatgpt]);
    owners.push(context.owner);
    const first = await context.owner.reserveNext(1, context.bytes, ids('chatgpt'), 102, signal());
    const firstPort = await context.owner.createExecutionPort(
      {
        ...ids('chatgpt'),
        planSha256: first.snapshot.plan.planSha256,
        item: first.item,
      },
      { now: () => 103 }
    );
    await firstPort.claimDispatch(0);
    await firstPort.recordProducerReceipts(1, []);
    const afterFirst = (await context.owner.readSnapshot())!;
    expect(afterFirst.operations).toHaveLength(1);
    const second = await context.owner.reserveNext(
      afterFirst.checkpoint.revision,
      context.bytes,
      ids('claude'),
      104,
      signal()
    );
    expect(second.item).toMatchObject({
      provider: 'claude',
      conversationId: first.item.conversationId,
    });
    expect(second.item.conversationKey).not.toBe(first.item.conversationKey);
    const secondPort = await context.owner.createExecutionPort(
      {
        ...ids('claude'),
        planSha256: second.snapshot.plan.planSha256,
        item: second.item,
      },
      { now: () => 105 }
    );
    await secondPort.claimDispatch(0);
    await secondPort.recordProducerReceipts(1, []);
    expect((await context.owner.readSnapshot())?.operations).toHaveLength(2);
  });

  it.each(['chatgpt', 'claude'] as const)(
    'claims, consumes once and records provider-selected %s receipts without settlement',
    async provider => {
      const context = await executionFixture(provider);
      const claim = await context.port.claimDispatch(0);
      expect(claim).toMatchObject({
        dispatch: 'available',
        record: { revision: 1, phase: 'in-flight' },
      });
      if (claim.dispatch !== 'available') throw new Error('unreachable');
      expect(Object.getPrototypeOf(claim.token)).toBeNull();
      const effect = vi.fn(operation => operation.captureId);
      await expect(
        context.port.consumeDispatch(claim.token, context.record.operation, effect)
      ).resolves.toBe(context.record.operation.captureId);
      expect(effect).toHaveBeenCalledExactlyOnceWith(claim.record.operation);
      const supplied = await observed(context.record, 'consistent');
      context.clock.value = 104;
      const evidence = await context.port.recordProducerReceipts(1, supplied.observation!.receipts);
      expect(evidence).toMatchObject({
        revision: 2,
        phase: 'awaiting-resolution',
        observation: {
          provider,
          hashOutcome: 'available',
          adaptation: { assessment: { kind: 'consistent' } },
        },
      });
      const snapshot = (await context.owner.readSnapshot())!;
      expect(snapshot.executionAuthorized).toBe(false);
      expect(snapshot.operations).toEqual([evidence]);
      expect(snapshot.checkpoint.links).toHaveLength(1);
      expect(snapshot.checkpoint.charges).toHaveLength(1);
      expect(snapshot.checkpoint.observations.map(item => item.recordRevision)).toEqual([0, 1, 2]);
      expect(snapshot.operations).toHaveLength(1);
    }
  );

  it('persists provider-selected replay-hash outage as rejected evidence and reopens it', async () => {
    let rejectIdentity = false;
    const context = await executionFixture('claude', {
      sha256: async bytes => {
        const text = new TextDecoder().decode(bytes);
        if (rejectIdentity && text === context.item.conversationId) throw new Error('private');
        return sha256(bytes);
      },
    });
    await context.port.claimDispatch(0);
    const receipts = (await observed(context.record, 'consistent')).observation!.receipts;
    rejectIdentity = true;
    const result = await context.port.recordProducerReceipts(1, receipts);
    expect(result.observation).toMatchObject({
      provider: 'claude',
      hashOutcome: 'failed',
      adaptation: { assessment: { kind: 'rejected' } },
    });
    context.owner.close();
    const reopened = createProviderBaselineOwner(context.settings);
    owners.push(reopened);
    await reopened.open();
    expect((await reopened.readSnapshot())?.operations).toEqual([result]);
  });

  it('maps a transient replay outage for historically available evidence to read-failed', async () => {
    let unavailable = false;
    let conversationId = '';
    const context = await executionFixture('chatgpt', {
      sha256: async bytes => {
        if (unavailable && new TextDecoder().decode(bytes) === conversationId)
          throw new Error('private');
        return sha256(bytes);
      },
    });
    conversationId = context.item.conversationId;
    await context.port.claimDispatch(0);
    const receipts = (await observed(context.record, 'consistent')).observation!.receipts;
    await context.port.recordProducerReceipts(1, receipts);
    unavailable = true;
    await expect(context.owner.readSnapshot()).rejects.toMatchObject({ code: 'read-failed' });
  });

  it('snapshots strict provider receipts before await and accepts no caller assessment', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    let hold = false;
    const context = await executionFixture('claude', {
      sha256: async bytes => {
        if (hold) {
          hold = false;
          entered.resolve();
          await release.promise;
        }
        return sha256(bytes);
      },
    });
    await context.port.claimDispatch(0);
    const source = (await observed(context.record, 'consistent')).observation!.receipts;
    const supplied = JSON.parse(JSON.stringify(source)) as Array<Record<string, unknown>>;
    hold = true;
    const pending = context.port.recordProducerReceipts(1, supplied);
    await entered.promise;
    supplied[0].captureId = 'capture-foreign';
    release.resolve();
    const result = await pending;
    expect(result.observation?.receipts).toEqual(source);
    expect(result.observation?.adaptation.assessment.kind).toBe('consistent');

    const fresh = await executionFixture();
    await fresh.port.claimDispatch(0);
    await expect(
      fresh.port.recordProducerReceipts(1, {
        receipts: [],
        assessment: { kind: 'consistent', codes: [] },
      })
    ).rejects.toMatchObject({ code: 'invalid-receipts' });
    expect((await fresh.owner.readSnapshot())?.operations[0].phase).toBe('in-flight');
  });

  it.each(['pause', 'restart', 'interruption'] as const)(
    'atomically records %s uncertainty, revokes dispatch and admits late evidence while paused',
    async route => {
      const context = await executionFixture();
      const claim = await context.port.claimDispatch(0);
      if (claim.dispatch !== 'available') throw new Error('unreachable');
      context.clock.value = 104;
      if (route === 'pause') await context.owner.applyControl(3, { kind: 'pause', now: 104 });
      else if (route === 'restart') await context.owner.recoverAfterRestart(3, 104, signal());
      else await context.port.markExecutionUnknown(1, 'capture-failed');
      const uncertain = (await context.owner.readSnapshot())!;
      expect(uncertain.checkpoint).toMatchObject({ control: 'paused', revision: 5 });
      expect(uncertain.operations[0]).toMatchObject({
        revision: 2,
        phase: 'unknown',
        interruptionReason:
          route === 'pause' ? 'pause' : route === 'restart' ? 'restart' : 'capture-failed',
      });
      const effect = vi.fn();
      await expect(
        context.port.consumeDispatch(claim.token, context.record.operation, effect)
      ).rejects.toBeInstanceOf(ProviderExecutionPortError);
      expect(effect).not.toHaveBeenCalled();
      context.clock.value = 105;
      const late = await context.port.recordProducerReceipts(2, []);
      expect(late).toMatchObject({ revision: 3, phase: 'awaiting-resolution' });
      const final = (await context.owner.readSnapshot())!;
      expect(final.checkpoint).toMatchObject({ control: 'paused', revision: 6 });
      expect(final.checkpoint.charges).toHaveLength(1);
    }
  );

  it('preserves paused reserved bytes on recovery and requires explicit activation before claim', async () => {
    const context = await executionFixture();
    const paused = await context.owner.applyControl(2, { kind: 'pause', now: 103 });
    const recovered = await context.owner.recoverAfterRestart(3, 104, signal());
    expect(recovered).toEqual(paused);
    expect(recovered.ownerBytes).toEqual(paused.ownerBytes);
    await expect(context.port.claimDispatch(0)).rejects.toMatchObject({
      code: 'candidate-unavailable',
    });
    // Failed mutation fences this handle; a fresh recovered handle performs the activation.
    context.owner.close();
    const reopened = createProviderBaselineOwner(context.settings);
    owners.push(reopened);
    await reopened.open();
    await reopened.recoverAfterRestart(3, 105, signal());
    await reopened.applyControl(3, { kind: 'activate', now: 105 });
    const fresh = await reopened.createExecutionPort(context.identity, { now: () => 106 });
    await expect(fresh.claimDispatch(0)).resolves.toMatchObject({ dispatch: 'available' });
  });

  it('serializes competing claims across handles and never creates a second pending record', async () => {
    const context = await executionFixture();
    const other = await context.owner.createExecutionPort(context.identity, { now: () => 103 });
    const results = await Promise.allSettled([
      context.port.claimDispatch(0),
      other.claimDispatch(0),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const snapshot = (await context.owner.readSnapshot())!;
    expect(snapshot.operations).toHaveLength(1);
    expect(snapshot.operations[0].phase).toBe('in-flight');
    await expect(
      context.owner.reserveNext(3, context.bytes, ids('second'), 104, signal())
    ).rejects.toBeDefined();
    expect((await context.owner.readSnapshot())?.operations).toHaveLength(1);
  });

  it.each(['forged', 'copy', 'wrong-operation'] as const)(
    'burns a %s capability synchronously and invokes no effect',
    async fault => {
      const context = await executionFixture();
      const claim = await context.port.claimDispatch(0);
      if (claim.dispatch !== 'available') throw new Error('unreachable');
      const selected =
        fault === 'forged'
          ? Object.freeze({})
          : fault === 'copy'
            ? { ...claim.token }
            : claim.token;
      const operation =
        fault === 'wrong-operation'
          ? { ...context.record.operation, attemptId: 'attempt-foreign' }
          : context.record.operation;
      const effect = vi.fn();
      await expect(context.port.consumeDispatch(selected, operation, effect)).rejects.toBeDefined();
      await expect(
        context.port.consumeDispatch(selected, context.record.operation, effect)
      ).rejects.toBeDefined();
      expect(effect).not.toHaveBeenCalled();
    }
  );

  it('burns a valid token before concurrent double-consume and calls the callback at most once', async () => {
    const context = await executionFixture();
    const claim = await context.port.claimDispatch(0);
    if (claim.dispatch !== 'available') throw new Error('unreachable');
    const effect = vi.fn(async () => 42);
    const results = await Promise.allSettled([
      context.port.consumeDispatch(claim.token, context.record.operation, effect),
      context.port.consumeDispatch(claim.token, context.record.operation, effect),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(effect).toHaveBeenCalledOnce();
  });

  it('binds consume to the full claimed inventory, not only the operation revision', async () => {
    const context = await executionFixture();
    const claim = await context.port.claimDispatch(0);
    if (claim.dispatch !== 'available') throw new Error('unreachable');
    await context.owner.applyControl(3, { kind: 'set-cooldown', now: 104, until: 200 });
    const effect = vi.fn();
    await expect(
      context.port.consumeDispatch(claim.token, context.record.operation, effect)
    ).rejects.toMatchObject({ code: 'revision-conflict' });
    expect(effect).not.toHaveBeenCalled();
  });

  it.each(['throw', 'reject'] as const)(
    'keeps callback %s outside storage mapping and never restores the token',
    async mode => {
      const context = await executionFixture();
      const claim = await context.port.claimDispatch(0);
      if (claim.dispatch !== 'available') throw new Error('unreachable');
      const privateFailure = new Error('private callback');
      const effect = vi.fn(() => {
        if (mode === 'reject') return Promise.reject(privateFailure);
        throw privateFailure;
      });
      await expect(
        context.port.consumeDispatch(claim.token, context.record.operation, effect)
      ).rejects.toBe(privateFailure);
      await expect(
        context.port.consumeDispatch(claim.token, context.record.operation, effect)
      ).rejects.toBeInstanceOf(ProviderExecutionPortError);
      expect(effect).toHaveBeenCalledOnce();
    }
  );

  it('captures the clock method and invalidates authority on regression', async () => {
    const context = await executionFixture();
    const clock = { now: () => 103 };
    const port = await context.owner.createExecutionPort(context.identity, clock);
    clock.now = () => 999;
    const claim = await port.claimDispatch(0);
    expect(claim.dispatch).toBe('available');
    context.clock.value = 102;
    await expect(context.port.recordProducerReceipts(1, [])).rejects.toMatchObject({
      code: 'transition-failed',
    });
    if (claim.dispatch !== 'available') throw new Error('unreachable');
    await expect(
      port.consumeDispatch(claim.token, context.record.operation, vi.fn())
    ).rejects.toBeDefined();
  });
});
