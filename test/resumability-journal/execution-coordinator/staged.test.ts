// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const canonicalLimit = vi.hoisted(() => ({ value: Number.MAX_SAFE_INTEGER }));
vi.mock('../../../src/lib/constants', async original => ({
  ...(await original<typeof import('../../../src/lib/constants')>()),
  get MAX_CONTENT_SIZE() {
    return canonicalLimit.value;
  },
}));
import * as runtime from '../../../src/content/archive-stage';
import * as messaging from '../../../src/lib/messaging';
import * as capture from '../../../src/content/capture/chatgpt-current-branch';
import * as acquisition from '../../../src/content/capture/chatgpt-asset-acquisition';
import * as binary from '../../../src/content/staged-binary-persistence';
import * as hashing from '../../../src/content/capture/response';
import {
  createPurposePersistenceStore,
  type PurposePersistenceStore,
} from '../../../src/resumability-journal/purpose-persistence-v2/idb';
import type {
  OwnedCaptureResponse,
  SealedExecutionStage,
  SelectedArchiveWrite,
  StagedExecutionDependencies,
} from '../../../src/resumability-journal/execution-coordinator/stages';
import { createChatGptExecution } from '../../../src/resumability-journal/execution-coordinator';
import { sha256 } from '../purpose-persistence-v2/fixtures';
import { deferred } from '../../snapshot-catalog/fixtures';
import { selectedOutcome, stagedSetup } from './staged-fixtures';

const stores: PurposePersistenceStore[] = [];
const forbidden = vi.fn(() => {
  throw new Error('runtime forbidden');
});
beforeEach(() => {
  forbidden.mockClear();
  vi.stubGlobal('chrome', { runtime: { sendMessage: forbidden } });
  vi.stubGlobal('fetch', forbidden);
  vi.spyOn(messaging, 'sendMessage').mockImplementation(forbidden);
  vi.spyOn(runtime, 'readStagedArchiveArtifactBytes').mockImplementation(forbidden);
  vi.spyOn(runtime, 'stageArchiveArtifactBytes').mockImplementation(forbidden);
  vi.spyOn(runtime, 'abortStagedArchiveArtifact').mockImplementation(forbidden);
  vi.spyOn(capture, 'observeChatGptAssetResolvers').mockImplementation(forbidden);
  vi.spyOn(acquisition, 'acquireChatGptPageOwnedAssets').mockImplementation(forbidden);
  vi.spyOn(binary, 'persistVerifiedBinaryAssets').mockImplementation(forbidden);
});
afterEach(() => {
  expect(forbidden).not.toHaveBeenCalled();
  canonicalLimit.value = Number.MAX_SAFE_INTEGER;
  stores.splice(0).forEach(store => store.close());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function fixture(options: Parameters<typeof stagedSetup>[0] = {}) {
  const ctx = await stagedSetup(options);
  stores.push(ctx.store);
  return ctx;
}

it.each([false, true])(
  'real staged raw -> normalization -> selected sinks -> evidence/reopen, canonical staged=%s',
  async stagedCanonical => {
    const ctx = await fixture({ assets: true });
    if (stagedCanonical) canonicalLimit.value = 1;
    const result = await ctx.execute().run();
    expect(result.code).toBe('evidence-recorded');
    expect(result.capture).toBeUndefined();
    expect(result.captureMaterial?.archive).toBeDefined();
    expect(result.evidence.state).toBe('committed');
    expect(result.evidence.record?.observation?.adaptation.assessment.kind).toBe('insufficient');
    expect(result.producer?.producerReceipts).toHaveLength(2);
    expect(
      result.producer!.producerReceipts!.every(item =>
        item.assets.every(asset => asset.state === 'not-attempted')
      )
    ).toBe(true);
    expect(ctx.requestCapture).toHaveBeenCalledOnce();
    expect(ctx.read.mock.calls.every(([, range]) => range.byteLength <= 512 * 1024)).toBe(true);
    expect(
      ctx.persistSelectedArtifacts.mock.calls.map(([write]) =>
        write.artifacts.map(item => item.kind)
      )
    ).toEqual([['raw'], ['manifest', 'canonical'], ['manifest', 'canonical']]);
    expect(ctx.create).toHaveBeenCalledTimes(stagedCanonical ? 3 : 0);
    expect(ctx.release).toHaveBeenCalledTimes(stagedCanonical ? 1 : 0);
    if (stagedCanonical) {
      expect(ctx.release.mock.calls[0][0].artifact.kind).toBe('canonical');
      expect(result.stageOwnership?.filter(fact => fact.event === 'transferred')).toHaveLength(3);
      expect(ctx.events.indexOf('sink:raw')).toBeLessThan(ctx.events.lastIndexOf('create'));
      expect(ctx.events.at(-1)).toBe('release:canonical');
    }
    expect(result.archiveWrites?.every(write => write.state === 'returned')).toBe(true);
    ctx.store.close();
    const peer = createPurposePersistenceStore({ indexedDB: ctx.factory, sha256 });
    stores.push(peer);
    await peer.open();
    expect(await peer.read('operation-1')).toEqual(result.evidence.record);
    expect(JSON.stringify(result.stageOwnership)).not.toContain('archive-stage-');
  }
);

it('inline raw creates oversized canonical only through the port; the initial stage is not handed to the raw sink', async () => {
  const ctx = await fixture({ inline: true });
  canonicalLimit.value = 1;
  ctx.hooks.sink = write => {
    if (write.artifacts[0].kind === 'raw') {
      expect(write.leases).toEqual([]);
      expect(ctx.stored.size).toBe(1);
      expect([...ctx.stored.values()][0].owner).toBe('provider');
    }
    return selectedOutcome(write);
  };
  const result = await ctx.execute().run();
  expect(result.evidence.state).toBe('committed');
  expect(ctx.read).not.toHaveBeenCalled();
  expect(ctx.create).toHaveBeenCalledTimes(3);
  expect(ctx.release).toHaveBeenCalledOnce();
  expect(result.stageOwnership?.map(fact => fact.event)).toEqual([
    'created',
    'created',
    'transferred',
    'created',
    'transferred',
    'released',
  ]);
});

it.each(['missing', 'partial', 'getter', 'mutable', 'legacy-sink'] as const)(
  'rejects %s stage dependencies before claim or request',
  async fault => {
    const ctx = await fixture();
    const bad = { ...ctx.dependencies } as unknown as Record<string, unknown>;
    const getter = vi.fn(() => ctx.dependencies.stagePort.read);
    if (fault === 'missing') delete bad.stagePort;
    if (fault === 'partial')
      bad.stagePort = Object.freeze({ read: ctx.dependencies.stagePort.read });
    if (fault === 'getter')
      bad.stagePort = Object.freeze({
        ...ctx.dependencies.stagePort,
        get read() {
          return getter();
        },
      });
    if (fault === 'mutable') bad.stagePort = { ...ctx.dependencies.stagePort };
    if (fault === 'legacy-sink') {
      delete bad.persistSelectedArtifacts;
      bad.persistArtifacts = ctx.persistArtifacts;
    }
    expect(() =>
      createChatGptExecution(ctx.input, bad as unknown as StagedExecutionDependencies)
    ).toThrow();
    expect(ctx.requestCapture).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
    expect((await ctx.store.read('operation-1'))?.revision).toBe(0);
  }
);

it.each(['response', 'missing-lease', 'binding', 'commitment', 'accessor'] as const)(
  'invalid %s never transfers or releases request-owned stage',
  async fault => {
    const ctx = await fixture();
    const request = ctx.requestCapture;
    const result = await ctx
      .execute({
        requestCapture: async (...args) => {
          const returned = await request(...args);
          if (!returned.lease || !returned.response.success) throw new Error('fixture');
          if (fault === 'response')
            return {
              ...returned,
              response: { success: true, data: { ...returned.response.data, byteLength: 1 } },
            };
          if (fault === 'missing-lease') return { response: returned.response };
          if (fault === 'binding')
            return {
              ...returned,
              lease: { ...returned.lease, binding: { ...returned.lease.binding } },
            };
          if (fault === 'commitment')
            return {
              ...returned,
              lease: {
                ...returned.lease,
                artifact: { ...returned.lease.artifact, sha256: 'a'.repeat(64) },
              },
            };
          return {
            response: returned.response,
            get lease() {
              throw new Error('getter must not run');
            },
          };
        },
      })
      .run();
    expect(result.code).toBe('capture-failed');
    expect(result.stageOwnership).toEqual([]);
    expect(ctx.read).not.toHaveBeenCalled();
    expect(ctx.release).not.toHaveBeenCalled();
  }
);

it.each(['released', 'deferred', 'outcome-unknown', 'throw'] as const)(
  'read failure retains cleanup outcome %s without usable dead reference',
  async outcome => {
    const ctx = await fixture();
    ctx.hooks.read = () => {
      throw new Error('read failed');
    };
    ctx.hooks.release = () => {
      if (outcome === 'throw') throw new Error('cleanup failed');
      return outcome;
    };
    const result = await ctx.execute().run();
    expect(result.captureError?.code).toBe('capture-payload-invalid');
    expect(ctx.release).toHaveBeenCalledOnce();
    expect(ctx.persistSelectedArtifacts).not.toHaveBeenCalled();
    expect(result.stageOwnership?.map(fact => fact.event)).toEqual([
      'received',
      outcome === 'throw' ? 'outcome-unknown' : outcome,
    ]);
    expect(result.captureError?.archiveCompanion).toBeUndefined();
  }
);

it.each(['before-read', 'during-read', 'during-create', 'after-seal'] as const)(
  'stop %s drains started work and releases only owned stages once',
  async where => {
    const ctx = await fixture();
    canonicalLimit.value = 1;
    const entered = deferred<void>(),
      resume = deferred<void>();
    if (where === 'before-read')
      ctx.hooks.request = () => {
        ctx.abort.abort();
      };
    if (where === 'during-read')
      ctx.hooks.read = async () => {
        entered.resolve();
        await resume.promise;
      };
    if (where === 'during-create')
      ctx.hooks.create = async () => {
        entered.resolve();
        await resume.promise;
      };
    if (where === 'after-seal')
      ctx.hooks.create = () => {
        ctx.abort.abort();
      };
    const running = ctx.execute().run();
    if (where === 'during-read' || where === 'during-create') {
      await entered.promise;
      ctx.abort.abort();
      expect(ctx.release).not.toHaveBeenCalled();
      resume.resolve();
    }
    const result = await running;
    expect(result.interrupted).toBe(true);
    expect(result.code).toBe('execution-cancelled');
    expect(ctx.read).toHaveBeenCalledTimes(
      where === 'before-read' ? 0 : where === 'during-read' ? 1 : ctx.read.mock.calls.length
    );
    expect(ctx.release).toHaveBeenCalledTimes(
      where.includes('create') || where === 'after-seal' ? 2 : 1
    );
    expect(ctx.persistSelectedArtifacts).not.toHaveBeenCalled();
    expect(result.evidence.state).toBe('not-attempted');
    expect(result.capture).toBeUndefined();
  }
);

it.each(['throw', 'reject', 'malformed', 'unknown'] as const)(
  'sink %s owns selected raw forever; never releases it or redispatches',
  async fault => {
    const ctx = await fixture();
    canonicalLimit.value = 1;
    ctx.hooks.sink = () => {
      if (fault === 'throw') throw new Error('sink');
      if (fault === 'reject' || fault === 'unknown') return Promise.reject(new Error(fault));
      return {} as ReturnType<typeof selectedOutcome>;
    };
    const handle = ctx.execute();
    const result = await handle.run();
    expect(await handle.run()).toBe(result);
    expect(ctx.persistSelectedArtifacts).toHaveBeenCalledOnce();
    expect(ctx.requestCapture).toHaveBeenCalledOnce();
    expect(ctx.release).toHaveBeenCalledOnce();
    expect(ctx.release.mock.calls[0][0].artifact.kind).toBe('canonical');
    expect(result.archiveWrites).toMatchObject([{ kinds: ['raw'], state: 'outcome-unknown' }]);
    expect(
      result.stageOwnership?.filter(fact => fact.kind === 'raw').map(fact => fact.event)
    ).toEqual(['received', 'transferred']);
  }
);

it('stop during raw sink keeps late raw facts and drains it before releasing unselected canonical', async () => {
  const ctx = await fixture();
  canonicalLimit.value = 1;
  const entered = deferred<void>(),
    resume = deferred<void>();
  ctx.hooks.sink = async write => {
    entered.resolve();
    await resume.promise;
    return selectedOutcome(write);
  };
  const running = ctx.execute().run();
  await entered.promise;
  ctx.abort.abort();
  expect(ctx.release).not.toHaveBeenCalled();
  resume.resolve();
  const result = await running;
  expect(ctx.persistSelectedArtifacts).toHaveBeenCalledOnce();
  expect(ctx.create).toHaveBeenCalledOnce();
  expect(ctx.release).toHaveBeenCalledOnce();
  expect(result.producer?.producerRaw?.observations).toHaveLength(2);
  expect(result.evidence.state).toBe('not-attempted');
  expect(result.archiveWrites).toMatchObject([{ state: 'returned' }]);
});

it('normalization failure releases accepted raw and removes its partial live companion', async () => {
  const ctx = await fixture({ text: '{}' });
  const result = await ctx.execute().run();
  expect(result.captureError?.code).toBe('normalization-failed');
  expect(result.captureError?.archiveCompanion).toBeUndefined();
  expect(ctx.release).toHaveBeenCalledOnce();
  expect(ctx.persistSelectedArtifacts).not.toHaveBeenCalled();
});

it('canonical creation failure preserves capture error and releases raw, not provider-owned partial creation', async () => {
  const ctx = await fixture();
  canonicalLimit.value = 1;
  ctx.hooks.create = () => {
    throw new Error('unreturned stage remains provider-owned');
  };
  const result = await ctx.execute().run();
  expect(result.captureError?.code).toBe('capture-integrity-failed');
  expect(result.captureError?.archiveCompanion).toBeUndefined();
  expect(ctx.release).toHaveBeenCalledOnce();
  expect(ctx.release.mock.calls[0][0].artifact.kind).toBe('raw');
});

it.each(['hash-stop', 'hash-failure'] as const)(
  '%s after staged read cannot start create or sink',
  async fault => {
    const ctx = await fixture();
    canonicalLimit.value = 1;
    const original = hashing.sha256Hex;
    vi.spyOn(hashing, 'sha256Hex').mockImplementation(async bytes => {
      if (bytes.byteLength > 16 * 1024 * 1024) {
        if (fault === 'hash-failure') throw new Error('hash failed');
        ctx.abort.abort();
      }
      return original(bytes);
    });
    const result = await ctx.execute().run();
    expect(result.code).toBe(fault === 'hash-stop' ? 'execution-cancelled' : 'capture-failed');
    expect(ctx.release).toHaveBeenCalledOnce();
    expect(ctx.create).not.toHaveBeenCalled();
    expect(ctx.persistSelectedArtifacts).not.toHaveBeenCalled();
  }
);

it('stop during canonical commitment hash prevents the create effect', async () => {
  const ctx = await fixture({ inline: true });
  canonicalLimit.value = 1;
  const original = hashing.sha256Hex;
  vi.spyOn(hashing, 'sha256Hex').mockImplementation(async bytes => {
    if (new TextDecoder().decode(bytes).includes('"liska-thread/1"')) ctx.abort.abort();
    return original(bytes);
  });
  const result = await ctx.execute().run();
  expect(result.interrupted).toBe(true);
  expect(ctx.create).not.toHaveBeenCalled();
  expect(ctx.release).not.toHaveBeenCalled();
  expect(ctx.persistSelectedArtifacts).not.toHaveBeenCalled();
});

it('read corruption fails independent hashing and releases exactly the accepted lease', async () => {
  const ctx = await fixture();
  const read = ctx.read;
  const result = await ctx
    .execute({
      stagePort: Object.freeze({
        ...ctx.dependencies.stagePort,
        read: async (...args) => {
          const bytes = await read(...args);
          bytes[0] ^= 1;
          return bytes;
        },
      }),
    })
    .run();
  expect(result.captureError?.code).toBe('capture-payload-invalid');
  expect(ctx.release).toHaveBeenCalledOnce();
  expect(ctx.persistSelectedArtifacts).not.toHaveBeenCalled();
});

it('identity mismatch after normalization never returns the released raw companion', async () => {
  const ctx = await fixture();
  canonicalLimit.value = 1;
  const original = capture.captureChatGptArchive;
  vi.spyOn(capture, 'captureChatGptArchive').mockImplementation(async (...args) => {
    const captured = await original(...args);
    captured.archiveCompanion.captureId = 'capture-chatgpt-wrong';
    return captured;
  });
  const result = await ctx.execute().run();
  expect(result.captureError?.code).toBe('capture-integrity-failed');
  expect(result.captureError?.archiveCompanion).toBeUndefined();
  expect(ctx.release).toHaveBeenCalledTimes(2);
  expect(ctx.persistSelectedArtifacts).not.toHaveBeenCalled();
});

it.each(['invalid-return', 'rejection'] as const)(
  'canonical %s after raw persistence keeps raw facts and does not acquire invalid creation',
  async fault => {
    const ctx = await fixture();
    canonicalLimit.value = 1;
    const create = ctx.create;
    let count = 0;
    const result = await ctx
      .execute({
        stagePort: Object.freeze({
          ...ctx.dependencies.stagePort,
          create: async (...args) => {
            const lease = await create(...args);
            count++;
            if (count > 1) {
              if (fault === 'rejection') throw new Error('provider retains unreturned stage');
              return { ...lease, binding: { ...lease.binding } };
            }
            return lease;
          },
        }),
      })
      .run();
    expect(result.producer?.producerRaw?.observations).toHaveLength(2);
    expect(result.code).toBe('producer-incomplete');
    expect(ctx.release).toHaveBeenCalledOnce();
    expect(result.stageOwnership?.map(fact => fact.event)).toEqual([
      'received',
      'created',
      'transferred',
      'released',
    ]);
  }
);

it.each(['throw', 'reject', 'malformed', 'stop'] as const)(
  'final sink %s retains transfer, drains late facts, never releases selected canonical',
  async fault => {
    const ctx = await fixture();
    canonicalLimit.value = 1;
    ctx.hooks.sink = write => {
      if (write.artifacts[0].kind === 'raw') return selectedOutcome(write);
      if (fault === 'stop') {
        ctx.abort.abort();
        return selectedOutcome(write);
      }
      if (fault === 'throw') throw new Error('sink');
      if (fault === 'reject') return Promise.reject(new Error('sink'));
      return { activeOutputs: ['clipboard'] } as unknown as ReturnType<typeof selectedOutcome>;
    };
    const result = await ctx.execute().run();
    expect(ctx.release).toHaveBeenCalledOnce();
    expect(result.producer?.producerRaw?.observations).toHaveLength(2);
    expect(result.producer?.producerReceipts?.length).toBe(fault === 'stop' ? 1 : 2);
    expect(result.stageOwnership?.filter(fact => fact.event === 'transferred')).toHaveLength(
      fault === 'stop' ? 2 : 3
    );
    expect(result.evidence.state).toBe(fault === 'stop' ? 'not-attempted' : 'committed');
  }
);

it('stop before evidence effect prevents its CAS; late sink facts remain returned', async () => {
  const ctx = await fixture();
  canonicalLimit.value = 1;
  const read = ctx.store.read.bind(ctx.store);
  vi.spyOn(ctx.store, 'read').mockImplementation(async (...args) => {
    const record = await read(...args);
    if (ctx.persistSelectedArtifacts.mock.calls.length === 3) ctx.abort.abort();
    return record;
  });
  const record = vi.spyOn(ctx.store, 'recordProducerReceipts');
  const result = await ctx.execute().run();
  expect(record).not.toHaveBeenCalled();
  expect(result.evidence.state).toBe('not-attempted');
  expect(result.producer?.producerReceipts).toHaveLength(2);
  expect(result.archiveWrites?.every(write => write.state === 'returned')).toBe(true);
  expect(ctx.release).toHaveBeenCalledOnce();
});

it('stop during started evidence CAS keeps the commit and cleanup facts', async () => {
  const ctx = await fixture();
  canonicalLimit.value = 1;
  const record = ctx.store.recordProducerReceipts.bind(ctx.store);
  vi.spyOn(ctx.store, 'recordProducerReceipts').mockImplementation(async (...args) => {
    ctx.abort.abort();
    return record(...args);
  });
  const result = await ctx.execute().run();
  expect(result.evidence.state).toBe('committed');
  expect(result.interrupted).toBe(true);
  expect(result.producer?.producerReceipts).toHaveLength(2);
  expect(ctx.release).toHaveBeenCalledOnce();
});

it('evidence CAS failure retains capture material, all sink facts and independent deferred cleanup', async () => {
  const ctx = await fixture();
  canonicalLimit.value = 1;
  ctx.hooks.release = () => 'deferred';
  vi.spyOn(ctx.store, 'recordProducerReceipts').mockRejectedValue(new Error('CAS'));
  const result = await ctx.execute().run();
  expect(result.code).toBe('evidence-persistence-failed');
  expect(result.captureMaterial).toBeDefined();
  expect(result.producer?.producerReceipts).toHaveLength(2);
  expect(result.archiveWrites?.every(write => write.state === 'returned')).toBe(true);
  expect(result.stageOwnership?.at(-1)?.event).toBe('deferred');
});

it('snapshots dependency slots before claim; caller mutations cannot redirect effects', async () => {
  const ctx = await fixture();
  canonicalLimit.value = 1;
  const deps = { ...ctx.dependencies };
  const handle = createChatGptExecution(ctx.input, deps);
  deps.requestCapture = forbidden;
  deps.persistSelectedArtifacts = forbidden;
  deps.stagePort = Object.freeze({ read: forbidden, create: forbidden, release: forbidden });
  const result = await handle.run();
  expect(result.evidence.state).toBe('committed');
  expect(ctx.requestCapture).toHaveBeenCalledOnce();
});

it.each([
  ['token', 'raw'],
  ['stageId', 'raw'],
  ['token', 'initial-canonical'],
  ['stageId', 'initial-canonical'],
  ['token', 'transferred-canonical'],
  ['stageId', 'transferred-canonical'],
] as const)(
  'duplicate %s of accepted %s cannot acquire another lease or start an unintended sink',
  async (duplicate, priorKind) => {
    const ctx = await fixture({
      destinations: priorKind === 'transferred-canonical' ? ['file', 'obsidian'] : ['file'],
    });
    canonicalLimit.value = 1;
    const created: SealedExecutionStage[] = [];
    let raw: SealedExecutionStage | undefined;
    let rejected: SealedExecutionStage | undefined;
    const result = await ctx
      .execute({
        requestCapture: async (...args) => {
          const returned = await ctx.requestCapture(...args);
          raw = returned.lease;
          return returned;
        },
        stagePort: Object.freeze({
          ...ctx.dependencies.stagePort,
          create: async (...args) => {
            const lease = await ctx.create(...args);
            const prior =
              priorKind === 'raw'
                ? raw
                : priorKind === 'initial-canonical'
                  ? created[0]
                  : created[1];
            created.push(lease);
            if (!prior) return lease;
            rejected = lease;
            return duplicate === 'token'
              ? { ...lease, token: prior.token }
              : { ...lease, artifact: { ...lease.artifact, stageId: prior.artifact.stageId } };
          },
        }),
      })
      .run();
    expect(rejected).toBeDefined();
    expect(result.code).toBe(priorKind === 'raw' ? 'capture-failed' : 'producer-incomplete');
    expect(ctx.requestCapture).toHaveBeenCalledOnce();
    expect(
      ctx.persistSelectedArtifacts.mock.calls.map(([write]) =>
        write.artifacts.map(item => item.kind)
      )
    ).toEqual(
      priorKind === 'raw'
        ? []
        : priorKind === 'initial-canonical'
          ? [['raw']]
          : [['raw'], ['manifest', 'canonical']]
    );
    expect(ctx.release).toHaveBeenCalledOnce();
    expect(ctx.release.mock.calls[0][0].token).toBe(
      priorKind === 'raw' ? raw!.token : created[0].token
    );
    expect(ctx.stored.get(rejected!.token)?.owner).toBe('provider');
    expect(result.stageOwnership).toEqual(
      priorKind === 'raw'
        ? [
            { correlation: 1, kind: 'raw', event: 'received' },
            { correlation: 1, kind: 'raw', event: 'released' },
          ]
        : [
            { correlation: 1, kind: 'raw', event: 'received' },
            { correlation: 2, kind: 'canonical', event: 'created' },
            { correlation: 1, kind: 'raw', event: 'transferred' },
            ...(priorKind === 'transferred-canonical'
              ? [
                  { correlation: 3, kind: 'canonical', event: 'created' },
                  { correlation: 3, kind: 'canonical', event: 'transferred' },
                ]
              : []),
            { correlation: 2, kind: 'canonical', event: 'released' },
          ]
    );
    expect(result.archiveWrites?.every(write => write.state === 'returned')).toBe(true);
    expect(result.captureError?.archiveCompanion).toBeUndefined();
  }
);

function copyLease(lease: SealedExecutionStage) {
  return { binding: lease.binding, token: lease.token, artifact: { ...lease.artifact } };
}
function mutateCallerLease(lease: ReturnType<typeof copyLease>) {
  lease.binding = { operationId: 'mutated-operation', captureId: 'capture-chatgpt-mutated' };
  lease.token = {};
  lease.artifact.stageId = `archive-stage-${'Z'.repeat(32)}`;
  lease.artifact.sha256 = 'b'.repeat(64);
  lease.artifact.byteLength = 1;
  lease.artifact.kind = 'canonical';
}
function copyOwnedResponse(returned: OwnedCaptureResponse) {
  if (
    !returned.response.success ||
    returned.response.data.transport !== 'staged' ||
    !returned.lease
  )
    throw new Error('expected staged fixture');
  return {
    response: {
      success: true as const,
      data: {
        ...returned.response.data,
        endpoint: { ...returned.response.data.endpoint },
        transientAssetResolvers: [...returned.response.data.transientAssetResolvers],
      },
    },
    lease: copyLease(returned.lease),
  };
}

it('nested caller response and request lease mutation during a later read await cannot change accepted raw ownership or commitment', async () => {
  const ctx = await fixture();
  const entered = deferred<void>(),
    resume = deferred<void>();
  let callerReturn: ReturnType<typeof copyOwnedResponse> | undefined;
  let originalLease: SealedExecutionStage | undefined;
  ctx.hooks.read = async () => {
    entered.resolve();
    await resume.promise;
  };
  const running = ctx
    .execute({
      requestCapture: async (...args) => {
        const returned = await ctx.requestCapture(...args);
        originalLease = returned.lease;
        callerReturn = copyOwnedResponse(returned);
        return callerReturn;
      },
    })
    .run();
  await entered.promise;
  // Acceptance has completed and the first port read is in flight. Mutate only caller-owned aliases.
  await Promise.resolve();
  callerReturn!.response.data.sha256 = 'c'.repeat(64);
  callerReturn!.response.data.byteLength = 1;
  callerReturn!.response.data.stageId = `archive-stage-${'Y'.repeat(32)}`;
  Object.assign(callerReturn!.response.data.endpoint, { method: 'POST', pathPattern: '/mutated' });
  mutateCallerLease(callerReturn!.lease);
  resume.resolve();
  const result = await running;
  expect(result.evidence.state).toBe('committed');
  expect(
    ctx.read.mock.calls.every(
      ([lease]) =>
        lease.token === originalLease!.token &&
        lease.artifact.sha256 === originalLease!.artifact.sha256
    )
  ).toBe(true);
  const rawWrite = ctx.persistSelectedArtifacts.mock.calls[0][0];
  expect(rawWrite.artifacts).toEqual([originalLease!.artifact]);
  expect(rawWrite.leases[0].token).toBe(originalLease!.token);
  expect(
    result.producer?.producerRaw?.observations.every(
      observation => observation.commitment.sha256 === originalLease!.artifact.sha256
    )
  ).toBe(true);
  expect(result.stageOwnership).toEqual([
    { correlation: 1, kind: 'raw', event: 'received' },
    { correlation: 1, kind: 'raw', event: 'transferred' },
  ]);
  expect(result.archiveWrites?.every(write => write.state === 'returned')).toBe(true);
  expect(ctx.release).not.toHaveBeenCalled();
});

it('nested caller-created lease mutation after create returns cannot redirect selected transfer or initial-stage cleanup', async () => {
  const ctx = await fixture();
  canonicalLimit.value = 1;
  const originals: SealedExecutionStage[] = [];
  const callerLeases: ReturnType<typeof copyLease>[] = [];
  ctx.hooks.sink = async write => {
    // Each new sink follows acceptance of its created stage, including the initial pre-raw stage.
    await Promise.resolve();
    callerLeases.forEach(mutateCallerLease);
    return selectedOutcome(write);
  };
  const result = await ctx
    .execute({
      stagePort: Object.freeze({
        ...ctx.dependencies.stagePort,
        create: async (...args) => {
          const lease = await ctx.create(...args);
          originals.push(lease);
          const callerLease = copyLease(lease);
          callerLeases.push(callerLease);
          return callerLease;
        },
      }),
    })
    .run();
  expect(result.evidence.state).toBe('committed');
  expect(ctx.release).toHaveBeenCalledOnce();
  expect(ctx.release.mock.calls[0][0].token).toBe(originals[0].token);
  expect(ctx.release.mock.calls[0][0].artifact).toEqual(originals[0].artifact);
  for (const [index, [write]] of ctx.persistSelectedArtifacts.mock.calls.slice(1).entries()) {
    expect(write.leases[0].token).toBe(originals[index + 1].token);
    expect(write.artifacts.find(item => item.kind === 'canonical')).toEqual(
      originals[index + 1].artifact
    );
  }
  expect(result.stageOwnership?.map(fact => fact.event)).toEqual([
    'received',
    'created',
    'transferred',
    'created',
    'transferred',
    'created',
    'transferred',
    'released',
  ]);
  expect(result.archiveWrites?.map(write => [write.correlations, write.state])).toEqual([
    [[1], 'returned'],
    [[3], 'returned'],
    [[4], 'returned'],
  ]);
});

function mutableSinkOutcome(write: SelectedArchiveWrite) {
  const outcome = selectedOutcome(write);
  return {
    activeOutputs: [...outcome.activeOutputs],
    warnings: [...outcome.warnings],
    observations: outcome.observations!.map(item => ({
      ...item,
      commitment: { ...item.commitment },
      observation: { ...item.observation },
    })),
  };
}

it('nested sink-result mutation after return and subsequent awaits cannot alter retained raw, producer, ownership or write facts', async () => {
  const ctx = await fixture();
  canonicalLimit.value = 1;
  const returned: ReturnType<typeof mutableSinkOutcome>[] = [];
  const expected: ReturnType<typeof mutableSinkOutcome>[] = [];
  const mutate = () => {
    for (const outcome of returned) {
      outcome.activeOutputs.splice(0);
      outcome.warnings.push('mutated caller warning');
      for (const item of outcome.observations) {
        item.destination = 'obsidian';
        item.commitment.sha256 = 'd'.repeat(64);
        item.commitment.byteLength = 1;
        item.commitment.relativePath = 'mutated.json';
        Object.assign(item.observation, {
          sha256: 'd'.repeat(64),
          byteLength: 1,
          observedRelativePath: 'mutated.json',
        });
      }
    }
  };
  ctx.hooks.sink = write => {
    const outcome = mutableSinkOutcome(write);
    returned.push(outcome);
    expected.push(structuredClone(outcome));
    return outcome;
  };
  ctx.hooks.create = async () => {
    // Destination creation starts after the previous raw/final sink result was snapshotted.
    await Promise.resolve();
    mutate();
  };
  const record = ctx.store.recordProducerReceipts.bind(ctx.store);
  vi.spyOn(ctx.store, 'recordProducerReceipts').mockImplementation(async (...args) => {
    // Also mutate the last destination's result while evidence commit is already in flight.
    await Promise.resolve();
    mutate();
    return record(...args);
  });
  const result = await ctx.execute().run();
  expect(returned).toHaveLength(3);
  expect(returned.every(outcome => outcome.activeOutputs.length === 0)).toBe(true);
  expect(result.evidence.state).toBe('committed');
  expect(result.producer?.rawSuccessfulDestinations).toEqual(['file', 'obsidian']);
  expect(result.producer?.completeDestinations).toEqual(['file', 'obsidian']);
  expect(result.producer?.producerRaw?.observations).toEqual(expected[0].observations);
  expect(result.producer?.warnings).not.toContain('mutated caller warning');
  expect(result.evidence.record?.observation?.receipts).toEqual(result.producer?.producerReceipts);
  for (const receipt of result.producer!.producerReceipts!) {
    const final = expected[receipt.destination === 'file' ? 1 : 2];
    expect(receipt.raw).toEqual(expected[0].observations[0].commitment);
    expect(receipt.manifest).toEqual(final.observations[0].commitment);
    expect(receipt.canonical).toEqual(final.observations[1].commitment);
  }
  expect(result.stageOwnership?.map(fact => fact.event)).toEqual([
    'received',
    'created',
    'transferred',
    'created',
    'transferred',
    'created',
    'transferred',
    'released',
  ]);
  expect(
    result.archiveWrites?.map(write => [write.destinations, write.correlations, write.state])
  ).toEqual([
    [['file', 'obsidian'], [1], 'returned'],
    [['file'], [3], 'returned'],
    [['obsidian'], [4], 'returned'],
  ]);
  expect(ctx.release).toHaveBeenCalledOnce();
});
