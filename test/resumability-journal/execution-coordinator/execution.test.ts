// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createChatGptExecution } from '../../../src/resumability-journal/execution-coordinator';
import {
  createPurposePersistenceStore,
  type PurposePersistenceStore,
} from '../../../src/resumability-journal/purpose-persistence-v2/idb';
import * as hashing from '../../../src/content/capture/response';
import * as capture from '../../../src/content/capture/chatgpt-current-branch';
import * as acquisition from '../../../src/content/capture/chatgpt-asset-acquisition';
import * as binary from '../../../src/content/staged-binary-persistence';
import { persistChatGptDestinationHonestAttachments } from '../../../src/content/chatgpt-asset-export';
import { response, sha256 } from '../purpose-persistence-v2/fixtures';
import { deferred } from '../../snapshot-catalog/fixtures';
import { setup, sink, assetResponse } from './fixtures';

const stores: PurposePersistenceStore[] = [];
beforeEach(() => vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn() } }));
async function fixture(...args: Parameters<typeof setup>) {
  const value = await setup(...args);
  stores.push(value.store);
  return value;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  stores.splice(0).forEach(store => store.close());
});

it('runs the real reserve -> consume -> inline capture/normalizer -> inventory-only archive sink -> evidence/reopen path', async () => {
  const ctx = await fixture(['file', 'obsidian']);
  const resolver = vi.spyOn(capture, 'observeChatGptAssetResolvers');
  const acquire = vi.spyOn(acquisition, 'acquireChatGptPageOwnedAssets');
  const persistBinary = vi.spyOn(binary, 'persistVerifiedBinaryAssets');
  const fetch = vi.fn(() => {
    throw new Error('must not fetch');
  });
  vi.stubGlobal('fetch', fetch);
  const outcome = await ctx.execute().run();
  expect(outcome).toMatchObject({
    request: 'invoked',
    dispatch: 'started',
    stage: 'finished',
    evidence: { state: 'committed' },
    interrupted: false,
  });
  expect(ctx.requestCapture).toHaveBeenCalledOnce();
  expect(ctx.persistArtifacts.mock.calls.map(call => call[4])).toEqual([
    ['raw'],
    ['manifest', 'canonical'],
    ['manifest', 'canonical'],
  ]);
  expect(outcome.capture?.assetExportContext?.rawCaptureBundle.manifest.assets).toMatchObject([
    { state: 'not-attempted' },
  ]);
  expect(outcome.producer?.producerReceipts).toHaveLength(2);
  for (const receipt of outcome.producer!.producerReceipts!) {
    expect(receipt.assets).toMatchObject([{ state: 'not-attempted' }]);
    expect(receipt.intent).toEqual(ctx.prepared.producerIntent);
  }
  expect(outcome.evidence.record?.observation?.adaptation.assessment).toMatchObject({
    kind: 'insufficient',
  });
  expect(JSON.stringify(outcome.evidence.record)).not.toContain('Synthetic asset');
  expect(resolver).not.toHaveBeenCalled();
  expect(acquire).not.toHaveBeenCalled();
  expect(persistBinary).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  ctx.store.close();
  const reopened = createPurposePersistenceStore({ indexedDB: ctx.factory, sha256 });
  stores.push(reopened);
  await reopened.open();
  expect(await reopened.read('operation-1')).toEqual(outcome.evidence.record);
});

it('explicit no-acquisition mode ignores every supplied resolver/acquisition/binary route', async () => {
  const ctx = await fixture();
  const captured = await ctx.execute().run();
  const forbidden = vi.fn(() => {
    throw new Error('forbidden');
  });
  const produced = await persistChatGptDestinationHonestAttachments(
    captured.capture!.assetExportContext!,
    captured.capture!.archiveCompanion,
    'other.md',
    ['file'],
    {
      producerIntent: ctx.prepared.producerIntent,
      assetAcquisition: 'disabled',
      persistArtifacts: sink,
      observeResolvers: forbidden,
      observeInterpreterResolvers: forbidden,
      observeActiveResolvers: forbidden,
      resolveActiveAsset: forbidden,
      resolveLibraryAsset: forbidden,
      resolveLibraryCsvAsset: forbidden,
      resolveLibraryTextPlainAsset: forbidden,
      acquireAssets: forbidden,
      persistBinaryAssets: forbidden,
    }
  );
  expect(forbidden).not.toHaveBeenCalled();
  expect(produced.producerReceipts?.[0].assets).toMatchObject([{ state: 'not-attempted' }]);
  expect(produced.warnings.join(' ')).not.toMatch(/recapture failed|owner context/iu);
});

it('shares one run promise and competing handles admit only one request', async () => {
  const ctx = await fixture();
  const handle = ctx.execute();
  const first = handle.run();
  expect(handle.run()).toBe(first);
  const results = await Promise.all([first, ctx.execute().run()]);
  expect(results.map(result => result.request).sort()).toEqual(['invoked', 'not-invoked']);
  expect(ctx.requestCapture).toHaveBeenCalledOnce();
  expect(handle.run()).toBe(first);
});

it.each(['throw', 'reject'] as const)(
  'a request %s still burns dispatch and retains only a safe failure',
  async kind => {
    const ctx = await fixture();
    const claim = vi.spyOn(ctx.store, 'claimDispatch');
    const result = await ctx
      .execute({
        requestCapture: () => {
          if (kind === 'throw') throw new Error('PRIVATE FAILURE');
          return Promise.reject(new Error('PRIVATE FAILURE'));
        },
      })
      .run();
    const { token } = await claim.mock.results[0].value;
    await expect(
      ctx.store.consumeDispatch(token, ctx.prepared.operation, () => {})
    ).rejects.toThrow();
    expect(result.request).toBe('invoked');
    expect(result.captureError).toBeDefined();
    expect(JSON.stringify(result)).not.toContain('PRIVATE FAILURE');
    expect(result.uncertainty.record).toMatchObject({
      phase: 'unknown',
      interruptionReason: 'capture-failed',
    });
  }
);

it('already-aborted execution does no capture identity hashing, consumption, request or sink', async () => {
  const ctx = await fixture();
  const hash = vi.spyOn(hashing, 'sha256Hex');
  const consume = vi.spyOn(ctx.store, 'consumeDispatch');
  ctx.abort.abort();
  const result = await ctx.execute().run();
  expect(result).toMatchObject({
    interrupted: true,
    request: 'not-invoked',
    code: 'execution-cancelled',
  });
  expect(result.uncertainty.record?.interruptionReason).toBe('execution-cancelled');
  expect(hash).not.toHaveBeenCalled();
  expect(consume).not.toHaveBeenCalled();
  expect(ctx.requestCapture).not.toHaveBeenCalled();
  expect(ctx.persistArtifacts).not.toHaveBeenCalled();
});

it.each(['identity', 'consume'] as const)(
  'abort during %s cannot cross the request boundary',
  async point => {
    const ctx = await fixture();
    const entered = deferred<void>(),
      release = deferred<void>();
    if (point === 'identity') {
      const hash = hashing.sha256Hex;
      vi.spyOn(hashing, 'sha256Hex').mockImplementationOnce(async bytes => {
        entered.resolve();
        await release.promise;
        return hash(bytes);
      });
    } else {
      const consume = ctx.store.consumeDispatch.bind(ctx.store);
      vi.spyOn(ctx.store, 'consumeDispatch').mockImplementationOnce(async (...args) => {
        entered.resolve();
        await release.promise;
        return consume(...args);
      });
    }
    const running = ctx.execute().run();
    await entered.promise;
    ctx.abort.abort();
    release.resolve();
    const result = await running;
    expect(result.request).toBe('not-invoked');
    expect(result.interrupted).toBe(true);
    expect(ctx.requestCapture).not.toHaveBeenCalled();
    expect(ctx.persistArtifacts).not.toHaveBeenCalled();
  }
);

it('abort after synchronous request invocation drains and retains the eventual real capture', async () => {
  const ctx = await fixture();
  const entered = deferred<void>(),
    release = deferred<ReturnType<typeof response>>();
  const running = ctx
    .execute({
      requestCapture: () => {
        entered.resolve();
        return release.promise;
      },
    })
    .run();
  await entered.promise;
  ctx.abort.abort();
  release.resolve(assetResponse());
  const result = await running;
  expect(result.request).toBe('invoked');
  expect(result.capture?.archive).toBeDefined();
  expect(result.interrupted).toBe(true);
  expect(ctx.persistArtifacts).not.toHaveBeenCalled();
  expect(result.producer).toBeDefined();
  expect(result.evidence.state).toBe('committed');
});

it('abort during real capture integrity hashing retains the eventual normalized archive', async () => {
  const ctx = await fixture();
  const entered = deferred<void>(),
    release = deferred<void>();
  const hash = hashing.sha256Hex;
  const running = ctx
    .execute({
      requestCapture: async () => {
        vi.spyOn(hashing, 'sha256Hex').mockImplementationOnce(async bytes => {
          entered.resolve();
          await release.promise;
          return hash(bytes);
        });
        return assetResponse();
      },
    })
    .run();
  await entered.promise;
  ctx.abort.abort();
  release.resolve();
  const result = await running;
  expect(result.request).toBe('invoked');
  expect(result.capture?.archive).toBeDefined();
  expect(result.interrupted).toBe(true);
  expect(ctx.persistArtifacts).not.toHaveBeenCalled();
});

it('never lets sink-returned active outputs authorize an unreserved destination', async () => {
  const ctx = await fixture();
  const persist = vi.fn<typeof sink>(async (...args) => ({
    ...(await sink(...args)),
    activeOutputs: ['file', 'obsidian'],
  }));
  const result = await ctx.execute({ persistArtifacts: persist }).run();
  expect(persist.mock.calls.map(args => args[3])).toEqual([['file'], ['file']]);
  expect(result.capture).toBeDefined();
  expect(result.producer?.producerRaw?.requestedDestinations).toEqual(['file']);
});

it.each(['raw', 'final'] as const)(
  'abort during %s sink drains started work and prevents every later sink',
  async point => {
    const ctx = await fixture(['file', 'obsidian']);
    const entered = deferred<void>(),
      release = deferred<void>();
    const persist = vi.fn<typeof sink>(async (...args) => {
      if ((args[4][0] === 'raw') === (point === 'raw')) {
        entered.resolve();
        await release.promise;
      }
      return sink(...args);
    });
    const running = ctx.execute({ persistArtifacts: persist }).run();
    await entered.promise;
    ctx.abort.abort();
    release.resolve();
    const result = await running;
    expect(persist).toHaveBeenCalledTimes(point === 'raw' ? 1 : 2);
    expect(result.producer?.producerRaw?.observations).toHaveLength(2);
    expect(result.producer?.producerReceipts).toHaveLength(2);
    expect(result.producer?.producerReceipts?.[0].observations.length).toBe(
      point === 'raw' ? 1 : 3
    );
    expect(result.evidence.state).toBe('committed');
    expect(result.interrupted).toBe(true);
    expect(result.uncertainty.record?.interruptionReason).toBe('execution-cancelled');
  }
);

it('abort during adapter hashing does not discard the committed evidence', async () => {
  let abortDuringAdaptation = false;
  const ctx = await fixture(['file'], {
    sha256: async bytes => {
      if (abortDuringAdaptation) ctx.abort.abort();
      return sha256(bytes);
    },
  });
  const record = ctx.store.recordProducerReceipts.bind(ctx.store);
  vi.spyOn(ctx.store, 'recordProducerReceipts').mockImplementation((...args) => {
    abortDuringAdaptation = true;
    return record(...args);
  });
  const result = await ctx.execute().run();
  expect(result.interrupted).toBe(true);
  expect(result.evidence.state).toBe('committed');
  expect(result.evidence.record?.observation?.receipts).toEqual(result.producer?.producerReceipts);
});

it('rejects staged success after invocation without reading or aborting stage runtime', async () => {
  const ctx = await fixture();
  const result = await ctx
    .execute({
      requestCapture: async () =>
        ({ success: true, data: { transport: 'staged', stageId: 'unread' } }) as never,
    })
    .run();
  expect(result).toMatchObject({
    request: 'invoked',
    code: 'staged-unsupported',
    evidence: { state: 'not-attempted' },
  });
  expect(ctx.persistArtifacts).not.toHaveBeenCalled();
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});

it.each([
  undefined,
  {},
  { requestCapture: 1, persistArtifacts: sink },
  { requestCapture: async () => response() },
  { requestCapture: async () => response(), persistArtifacts: sink, now: 1 },
  { requestCapture: async () => response(), persistArtifacts: sink, assessment: {} },
])(
  'rejects malformed mandatory dependencies before any claim/request/write: %j',
  async dependencies => {
    const ctx = await fixture();
    const claim = vi.spyOn(ctx.store, 'claimDispatch');
    expect(() => createChatGptExecution(ctx.input, dependencies as never)).toThrow(
      'invalid-execution-input'
    );
    expect(claim).not.toHaveBeenCalled();
    expect(ctx.requestCapture).not.toHaveBeenCalled();
    expect(ctx.persistArtifacts).not.toHaveBeenCalled();
    expect((await ctx.store.read('operation-1'))?.phase).toBe('reserved');
  }
);

it('snapshots dependency references before the first await and rejects getters without invoking them', async () => {
  const ctx = await fixture();
  const getter = vi.fn(() => ctx.requestCapture);
  expect(() =>
    createChatGptExecution(ctx.input, {
      get requestCapture() {
        return getter();
      },
      persistArtifacts: sink,
    })
  ).toThrow();
  expect(getter).not.toHaveBeenCalled();
  const deps = { ...ctx.dependencies };
  const handle = createChatGptExecution(ctx.input, deps);
  deps.requestCapture = vi.fn(() => {
    throw new Error('mutated');
  });
  deps.persistArtifacts = vi.fn(() => {
    throw new Error('mutated');
  });
  await handle.run();
  expect(ctx.requestCapture).toHaveBeenCalledOnce();
  expect(ctx.persistArtifacts).toHaveBeenCalledTimes(2);
});

it.each(['raw', 'partial', 'final', 'empty'] as const)(
  'preserves available producer facts with %s sink outcome',
  async mode => {
    const ctx = await fixture(['file', 'obsidian']);
    const result = await ctx
      .execute({
        persistArtifacts: async (...args) => {
          const raw = args[4][0] === 'raw';
          if ((mode === 'raw' && raw) || (mode === 'final' && !raw)) throw new Error('PRIVATE');
          if (mode === 'empty') return { activeOutputs: [], observations: [], warnings: [] };
          return sink(
            ...(mode === 'partial'
              ? ([args[0], args[1], args[2], ['file'], args[4]] as Parameters<typeof sink>)
              : args)
          );
        },
      })
      .run();
    expect(result.capture).toBeDefined();
    expect(result.producer).toBeDefined();
    expect(result.evidence.state).toBe('committed');
    expect(result.evidence.record?.observation?.adaptation.assessment.kind).toBe('insufficient');
    if (mode === 'final') {
      expect(result.producer?.producerRaw?.observations).toHaveLength(2);
      expect(result.producer?.producerReceipts).toHaveLength(2);
    }
    if (mode === 'empty' || mode === 'raw')
      expect(result.evidence.record?.observation?.receipts).toEqual([]);
    if (mode === 'partial') expect(result.producer?.producerReceipts).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  }
);

it('retains the safe companion from real normalization failure', async () => {
  const ctx = await fixture();
  const result = await ctx
    .execute({
      requestCapture: async () =>
        response('{"conversation_id":"11111111-2222-4333-8444-555555555555"}'),
    })
    .run();
  expect(result.captureError?.code).toBe('normalization-failed');
  expect(result.captureError?.archiveCompanion?.artifacts.map(item => item.kind)).toEqual([
    'raw',
    'manifest',
  ]);
  expect(result.uncertainty.record?.interruptionReason).toBe('capture-failed');
});

it('capture identity hash failure starts no request; producer hash failure retains earlier raw facts', async () => {
  const first = await fixture();
  vi.spyOn(hashing, 'sha256Hex').mockRejectedValueOnce(new Error('private hash'));
  const failed = await first.execute().run();
  expect(failed.request).toBe('not-invoked');
  expect(failed.captureError?.code).toBe('capture-integrity-failed');
  vi.restoreAllMocks();
  const second = await fixture();
  const result = await second
    .execute({
      persistArtifacts: async (...args) => {
        const outcome = await sink(...args);
        if (args[4][0] === 'raw')
          vi.spyOn(hashing, 'sha256Hex').mockRejectedValue(new Error('private hash'));
        return outcome;
      },
    })
    .run();
  expect(result.capture).toBeDefined();
  expect(result.producer?.producerRaw?.observations).toHaveLength(1);
  expect(result.producer?.completeDestinations).toEqual([]);
  expect(result.evidence.state).toBe('committed');
});
