// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBObjectStore, IDBVersionChangeEvent } from 'fake-indexeddb';
import {
  createProviderBaselineOwner,
  PROVIDER_OWNER_DATABASE_NAME,
} from '../../../src/resumability-journal/provider-baseline-owner';
import { encodeWithControlHeadroom } from '../../../src/resumability-journal/purpose-persistence-v3/core/control';
import { reserved } from '../provider-baseline/fixtures';
import { active, deferred, identity, ids, ManualTimers, sha256, signal } from './fixtures';

afterEach(() => vi.restoreAllMocks());

describe('provider owner two-store atomicity and terminal outcomes', () => {
  it.each(['abort', 'close'] as const)(
    'does not write when an in-flight hash is followed by %s',
    async mode => {
      const gate = deferred<void>();
      const entered = deferred<void>();
      let delayNextHash = false;
      const { owner, bytes } = await active({
        sha256: async input => {
          if (delayNextHash) {
            delayNextHash = false;
            entered.resolve();
            await gate.promise;
          }
          return sha256(input);
        },
      });
      const add = vi.spyOn(IDBObjectStore.prototype, 'add');
      const put = vi.spyOn(IDBObjectStore.prototype, 'put');
      const controller = new AbortController();
      delayNextHash = true;
      const pending = owner.reserveNext(1, bytes, ids(), 102, controller.signal);
      await entered.promise;
      if (mode === 'abort') controller.abort();
      else owner.close();
      gate.resolve();

      await expect(pending).rejects.toMatchObject({
        code: mode === 'abort' ? 'corrupt-owner' : 'closed',
      });
      expect(add).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
      add.mockRestore();
      put.mockRestore();
      if (mode === 'abort') owner.close();
    }
  );

  it('CASes an operation-only phantom introduced during async preparation', async () => {
    const gate = deferred<void>();
    const entered = deferred<void>();
    let hold = false;
    const { owner, bytes, factory, settings } = await active({
      sha256: async input => {
        if (hold) {
          entered.resolve();
          await gate.promise;
        }
        return sha256(input);
      },
    });
    const before = await owner.readSnapshot();
    hold = true;
    const pending = owner.reserveNext(1, bytes, ids(), 102, signal());
    await entered.promise;
    const database = await new Promise<IDBDatabase>(resolve => {
      const request = factory.open(PROVIDER_OWNER_DATABASE_NAME, 1);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('operations', 'readwrite');
      const phantom = reserved(before!.plan, 1, 'phantom');
      transaction
        .objectStore('operations')
        .add(encodeWithControlHeadroom(phantom), phantom.operation.operationId);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    gate.resolve();
    await expect(pending).rejects.toMatchObject({ code: 'revision-conflict' });
    const reader = createProviderBaselineOwner({ ...settings, sha256 });
    await reader.open();
    await expect(reader.readSnapshot()).rejects.toMatchObject({ code: 'corrupt-owner' });
    owner.close();
    reader.close();
  });

  it.each([
    'add-throw',
    'put-throw',
    'add-abort',
    'put-abort',
    'add-success-abort',
    'put-success-abort',
  ] as const)('rolls back both owner and operation writes on %s', async fault => {
    const { owner, bytes, settings } = await active();
    const before = await owner.readSnapshot();
    const method = fault.startsWith('add') ? 'add' : 'put';
    const original = IDBObjectStore.prototype[method];
    const spy = vi
      .spyOn(IDBObjectStore.prototype, method)
      .mockImplementation(function (value, key) {
        if (fault.endsWith('throw')) throw new DOMException('private', 'QuotaExceededError');
        const request = original.call(this, value, key);
        if (fault.includes('success'))
          request.addEventListener('success', () => this.transaction.abort());
        else this.transaction.abort();
        return request;
      });
    await expect(owner.reserveNext(1, bytes, ids(), 102, signal())).rejects.toBeDefined();
    spy.mockRestore();
    const fresh = createProviderBaselineOwner(settings);
    await fresh.open();
    expect(await fresh.readSnapshot()).toEqual(before);
    owner.close();
    fresh.close();
  });

  it.each(['timeout', 'close', 'versionchange'] as const)(
    'waits for an accepted %s abort and commits neither half',
    async mode => {
      const timers = new ManualTimers();
      const { owner, bytes, settings } = await active({ timers });
      const before = await owner.readSnapshot();
      let terminal = false;
      const put = IDBObjectStore.prototype.put;
      const spy = vi
        .spyOn(IDBObjectStore.prototype, 'put')
        .mockImplementation(function (value, key) {
          const request = put.call(this, value, key);
          this.transaction.addEventListener('abort', () => {
            terminal = true;
          });
          if (mode === 'timeout') timers.fire();
          else if (mode === 'close') owner.close();
          else
            this.transaction.db.dispatchEvent(
              new IDBVersionChangeEvent('versionchange', { oldVersion: 1, newVersion: 2 })
            );
          return request;
        });
      await expect(owner.reserveNext(1, bytes, ids(), 102, signal())).rejects.toMatchObject({
        code:
          mode === 'timeout'
            ? 'transaction-timeout'
            : mode === 'close'
              ? 'closed'
              : 'version-changed',
      });
      expect(terminal).toBe(true);
      spy.mockRestore();
      const fresh = createProviderBaselineOwner(settings);
      await fresh.open();
      expect(await fresh.readSnapshot()).toEqual(before);
      owner.close();
      fresh.close();
      expect(timers.pending.size).toBe(0);
    }
  );

  it.each(['timeout', 'close', 'versionchange'] as const)(
    'returns committed local facts after a refused late %s abort',
    async mode => {
      const timers = new ManualTimers();
      const { owner, bytes, settings } = await active({ timers });
      let terminal = false;
      const put = IDBObjectStore.prototype.put;
      const spy = vi
        .spyOn(IDBObjectStore.prototype, 'put')
        .mockImplementation(function (value, key) {
          const request = put.call(this, value, key);
          this.transaction.addEventListener('complete', () => {
            terminal = true;
          });
          this.transaction.commit();
          if (mode === 'timeout') timers.fire();
          else if (mode === 'close') owner.close();
          else
            this.transaction.db.dispatchEvent(
              new IDBVersionChangeEvent('versionchange', { oldVersion: 1, newVersion: 2 })
            );
          return request;
        });
      const result = await owner.reserveNext(1, bytes, ids(), 102, signal());
      expect(terminal).toBe(true);
      expect(result).toMatchObject({ executionAuthorized: false, record: { phase: 'reserved' } });
      spy.mockRestore();
      const fresh = createProviderBaselineOwner(settings);
      await fresh.open();
      expect((await fresh.readSnapshot())?.checkpoint.links).toHaveLength(1);
      owner.close();
      fresh.close();
      expect(timers.pending.size).toBe(0);
    }
  );

  it.each(['commit', 'abort'] as const)(
    'reports missing %s terminal as unknown and requires reconciliation on a fresh handle',
    async outcome => {
      const timers = new ManualTimers();
      const { owner, bytes, settings, snapshot } = await active({ timers });
      const terminal = deferred<void>();
      const put = IDBObjectStore.prototype.put;
      const spy = vi
        .spyOn(IDBObjectStore.prototype, 'put')
        .mockImplementation(function (value, key) {
          const request = put.call(this, value, key);
          this.transaction.oncomplete = null;
          this.transaction.onabort = null;
          this.transaction.addEventListener(outcome === 'commit' ? 'complete' : 'abort', () =>
            terminal.resolve()
          );
          if (outcome === 'commit') this.transaction.commit();
          else this.transaction.abort();
          timers.fire();
          return request;
        });
      const pending = owner.reserveNext(1, bytes, ids(), 102, signal());
      const assertion = expect(pending).rejects.toMatchObject({
        code: 'transaction-outcome-unknown',
      });
      await terminal.promise;
      spy.mockRestore();
      timers.fire();
      await assertion;
      const fresh = createProviderBaselineOwner(settings);
      await fresh.open();
      expect(
        await fresh.inspectReservation({
          ...ids(),
          planSha256: snapshot.plan.planSha256,
          item: snapshot.plan.plan.items[0],
        })
      ).toMatchObject({
        executionAuthorized: false,
        kind: outcome === 'commit' ? 'committed' : 'not-observed',
      });
      owner.close();
      fresh.close();
      expect(timers.pending.size).toBe(0);
    }
  );
});

async function executionFaultFixture(
  options: Parameters<typeof active>[0] = {},
  provider: 'chatgpt' | 'claude' = 'chatgpt'
) {
  const context = await active(options, [identity(0, provider)]);
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
  const port = await context.owner.createExecutionPort(bound, { now: () => 103 });
  return { ...context, ...reservation, identity: bound, port };
}

describe('provider execution lifecycle fencing and atomicity', () => {
  it('returns committed but revoked when pause invalidates the session after the claim write', async () => {
    const context = await executionFaultFixture();
    let pause: Promise<unknown> | undefined;
    let triggered = false;
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      const request = original.call(this, value, key);
      if (!triggered && this.name === 'operations') {
        triggered = true;
        pause = context.owner.applyControl(3, { kind: 'pause', now: 104 });
      }
      return request;
    });
    const claim = await context.port.claimDispatch(0);
    expect(claim).toMatchObject({ dispatch: 'revoked', record: { phase: 'in-flight' } });
    await pause;
    expect((await context.owner.readSnapshot())?.operations[0]).toMatchObject({
      phase: 'unknown',
      interruptionReason: 'pause',
    });
    context.owner.close();
  });

  it.each(['claim', 'evidence'] as const)(
    'rolls back both stores when the owner half of %s throws after the operation PUT',
    async stage => {
      const context = await executionFaultFixture();
      if (stage === 'evidence') await context.port.claimDispatch(0);
      const before = await context.owner.readSnapshot();
      const original = IDBObjectStore.prototype.put;
      let operationWritten = false;
      const spy = vi
        .spyOn(IDBObjectStore.prototype, 'put')
        .mockImplementation(function (value, key) {
          if (this.name === 'operations') operationWritten = true;
          if (this.name === 'owner' && operationWritten)
            throw new DOMException('private', 'QuotaExceededError');
          return original.call(this, value, key);
        });
      const pending =
        stage === 'claim'
          ? context.port.claimDispatch(0)
          : context.port.recordProducerReceipts(1, []);
      await expect(pending).rejects.toMatchObject({ code: 'quota-exceeded' });
      spy.mockRestore();
      const fresh = createProviderBaselineOwner(context.settings);
      await fresh.open();
      expect(await fresh.readSnapshot()).toEqual(before);
      await expect(
        context.owner.applyControl(before!.checkpoint.revision, { kind: 'pause', now: 105 })
      ).rejects.toMatchObject({ code: 'recovery-required' });
      context.owner.close();
      fresh.close();
    }
  );

  it('CASes an operation-only phantom introduced during delayed evidence adaptation', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    let hold = false;
    const context = await executionFaultFixture({
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
    hold = true;
    const pending = context.port.recordProducerReceipts(1, []);
    await entered.promise;
    const database = await new Promise<IDBDatabase>(resolve => {
      const request = context.factory.open(PROVIDER_OWNER_DATABASE_NAME, 1);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('operations', 'readwrite');
      const phantom = reserved(context.snapshot.plan, 0, 'phantom-lifecycle');
      transaction
        .objectStore('operations')
        .add(encodeWithControlHeadroom(phantom), phantom.operation.operationId);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    release.resolve();
    await expect(pending).rejects.toMatchObject({ code: 'revision-conflict' });
    context.owner.close();
  });

  it.each(['pause', 'restart', 'close', 'versionchange'] as const)(
    'revokes delayed evidence before persistence on %s',
    async action => {
      const entered = deferred<void>();
      const release = deferred<void>();
      let hold = false;
      const context = await executionFaultFixture({
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
      hold = true;
      const evidence = context.port.recordProducerReceipts(1, []);
      await entered.promise;
      if (action === 'pause') await context.owner.applyControl(3, { kind: 'pause', now: 104 });
      else if (action === 'restart') await context.owner.recoverAfterRestart(3, 104, signal());
      else if (action === 'close') context.owner.close();
      else {
        await new Promise<void>(resolve => {
          const request = context.factory.open(PROVIDER_OWNER_DATABASE_NAME, 2);
          request.onupgradeneeded = () => request.transaction?.abort();
          request.onerror = () => resolve();
          request.onsuccess = () => {
            request.result.close();
            resolve();
          };
        });
      }
      release.resolve();
      await expect(evidence).rejects.toBeDefined();
      const fresh = createProviderBaselineOwner(context.settings);
      await fresh.open();
      const stored = await fresh.readSnapshot();
      expect(stored?.operations[0].phase).not.toBe('awaiting-resolution');
      context.owner.close();
      fresh.close();
    }
  );

  it('failed pause never restores authority and leaves the atomic in-flight state recoverable', async () => {
    const context = await executionFaultFixture();
    const claim = await context.port.claimDispatch(0);
    if (claim.dispatch !== 'available') throw new Error('unreachable');
    const original = IDBObjectStore.prototype.put;
    let failed = false;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      if (!failed && this.name === 'operations') {
        failed = true;
        throw new DOMException('private', 'QuotaExceededError');
      }
      return original.call(this, value, key);
    });
    await expect(context.owner.applyControl(3, { kind: 'pause', now: 104 })).rejects.toMatchObject({
      code: 'quota-exceeded',
    });
    spy.mockRestore();
    await expect(
      context.port.consumeDispatch(claim.token, context.record.operation, vi.fn())
    ).rejects.toBeDefined();
    await expect(context.owner.applyControl(3, { kind: 'pause', now: 105 })).rejects.toMatchObject({
      code: 'recovery-required',
    });
    const fresh = createProviderBaselineOwner(context.settings);
    await fresh.open();
    expect((await fresh.readSnapshot())?.operations[0].phase).toBe('in-flight');
    context.owner.close();
    fresh.close();
  });

  it('rejects cross-owner and stale tokens without invoking an effect', async () => {
    const context = await executionFaultFixture();
    const claim = await context.port.claimDispatch(0);
    if (claim.dispatch !== 'available') throw new Error('unreachable');
    const other = createProviderBaselineOwner(context.settings);
    await other.open();
    await other.recoverAfterRestart(3, 104, signal());
    const otherPort = await other.createExecutionPort(context.identity, { now: () => 105 });
    const effect = vi.fn();
    await expect(
      otherPort.consumeDispatch(claim.token, context.record.operation, effect)
    ).rejects.toBeDefined();
    await expect(
      context.port.consumeDispatch(claim.token, context.record.operation, effect)
    ).rejects.toBeDefined();
    expect(effect).not.toHaveBeenCalled();
    context.owner.close();
    other.close();
  });

  it.each(['commit', 'abort'] as const)(
    'reports missing lifecycle %s terminal as outcome-unknown and never retries',
    async outcome => {
      const timers = new ManualTimers();
      const context = await executionFaultFixture({ timers });
      const terminal = deferred<void>();
      const original = IDBObjectStore.prototype.put;
      let intercepted = false;
      const spy = vi
        .spyOn(IDBObjectStore.prototype, 'put')
        .mockImplementation(function (value, key) {
          const request = original.call(this, value, key);
          if (!intercepted && this.name === 'owner') {
            intercepted = true;
            this.transaction.oncomplete = null;
            this.transaction.onabort = null;
            this.transaction.addEventListener(outcome === 'commit' ? 'complete' : 'abort', () =>
              terminal.resolve()
            );
            if (outcome === 'commit') this.transaction.commit();
            else this.transaction.abort();
            timers.fire();
          }
          return request;
        });
      const claim = context.port.claimDispatch(0);
      const assertion = expect(claim).rejects.toMatchObject({
        code: 'transaction-outcome-unknown',
      });
      await terminal.promise;
      spy.mockRestore();
      timers.fire();
      await assertion;
      const fresh = createProviderBaselineOwner(context.settings);
      await fresh.open();
      expect((await fresh.readSnapshot())?.operations[0].phase).toBe(
        outcome === 'commit' ? 'in-flight' : 'reserved'
      );
      context.owner.close();
      fresh.close();
    }
  );
});
