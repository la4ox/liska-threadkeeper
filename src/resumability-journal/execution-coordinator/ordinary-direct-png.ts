/** Offline, one-attempt policy. No bridge, default fetch, binary runtime, or cleanup authority. */
import {
  observeChatGptAssetResolvers,
  type ChatGptAssetResolverObservationDependencies,
} from '../../content/capture/chatgpt-current-branch';
import {
  hasChatGptInterpreterAssetOwnership,
  matchChatGptPageOwnedAssetResolvers,
  type ChatGptTransientResolverRecord,
} from '../../content/capture/chatgpt-asset-resolver';
import { acquireChatGptPageOwnedAssets } from '../../content/capture/chatgpt-asset-acquisition';
import type { ExplicitChatGptAssetAttempt } from '../../content/chatgpt-asset-export';
import {
  getChatGptNumericResolverFileId,
  isChatGptTransientDownloadUrl,
} from '../../lib/chatgpt-capture-contract';
import { snapshotSinkObservation, type SinkObservation } from '../../lib/chatgpt-producer-evidence';
import {
  detachProducerData,
  freezeProducerData,
  producerList,
  producerRecord,
} from '../../lib/producer-evidence-data';
import type {
  ChatGptAssetExportContext,
  PersistentOutputDestination,
  StagedBinaryAssetDescriptor,
  StagedBinaryAssetResult,
} from '../../lib/types';

export interface OrdinaryDirectPngWrite {
  readonly descriptor: Readonly<StagedBinaryAssetDescriptor>;
  /** Detached from acquisition; the sink owns staging/cleanup from invocation, even on throw. */
  readonly bytes: Uint8Array;
  readonly destinations: readonly PersistentOutputDestination[];
}
export type OrdinaryDirectPngPolicy =
  | { readonly mode: 'disabled' }
  | {
      readonly mode: 'explicit';
      readonly policy: 'ordinary-direct-png/1';
      readonly requestResolvers: NonNullable<
        ChatGptAssetResolverObservationDependencies['requestResolvers']
      >;
      readonly fetchAsset: typeof fetch;
      readonly persistBinaryAsset: (
        write: OrdinaryDirectPngWrite
      ) => Promise<StagedBinaryAssetResult>;
      readonly limits: { readonly maxAssetBytes: number; readonly timeoutMs: number };
    };
export interface OrdinaryDirectPngFacts {
  readonly policy: 'ordinary-direct-png/1';
  readonly resolver: {
    readonly state: 'not-started' | 'started' | 'matched' | 'failed' | 'unknown';
    readonly eligibleCount: number;
    readonly matchedCount: number;
  };
  readonly acquisition: {
    readonly state: 'not-started' | 'attempted';
    readonly outcome?: 'verified' | 'failed' | 'unknown';
    readonly assetId?: string;
    readonly mediaType?: 'image/png';
    readonly byteLength?: number;
    readonly sha256?: string;
  };
  readonly binary: {
    readonly state: 'not-invoked' | 'invoked';
    readonly outcome?: 'returned' | 'outcome-unknown';
    readonly destinations: readonly PersistentOutputDestination[];
    readonly cleanupUncertain: boolean;
    readonly results: readonly {
      readonly destination: PersistentOutputDestination;
      readonly success: boolean;
      readonly observation?: SinkObservation;
      readonly cleanupDeferred?: true;
      readonly writeState?: 'confirmed' | 'unknown' | 'not-dispatched';
    }[];
  };
}

function invalid(): never {
  throw new Error('invalid-ordinary-direct-png-capability');
}
function dataFields(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const proto: unknown = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return invalid();
  const ds = Object.getOwnPropertyDescriptors(input);
  if (
    Reflect.ownKeys(input).length !== keys.length ||
    keys.some(key => !ds[key] || !('value' in ds[key]))
  )
    return invalid();
  return Object.fromEntries(keys.map(key => [key, ds[key].value]));
}

/** Synchronous complete snapshot, before dispatch claim; malformed limits never get defaults. */
export function snapshotOrdinaryDirectPngPolicy(input: unknown): OrdinaryDirectPngPolicy {
  if (input === undefined) return Object.freeze({ mode: 'disabled' });
  const mode = Object.getOwnPropertyDescriptor(input, 'mode');
  if (!mode || !('value' in mode)) return invalid();
  if (mode.value === 'disabled') {
    dataFields(input, ['mode']);
    return Object.freeze({ mode: 'disabled' });
  }
  const value = dataFields(input, [
    'mode',
    'policy',
    'requestResolvers',
    'fetchAsset',
    'persistBinaryAsset',
    'limits',
  ]);
  const limits = dataFields(value.limits, ['maxAssetBytes', 'timeoutMs']);
  if (
    value.mode !== 'explicit' ||
    value.policy !== 'ordinary-direct-png/1' ||
    ['requestResolvers', 'fetchAsset', 'persistBinaryAsset'].some(
      key => typeof value[key] !== 'function'
    ) ||
    !Number.isSafeInteger(limits.maxAssetBytes) ||
    (limits.maxAssetBytes as number) < 1 ||
    (limits.maxAssetBytes as number) > 8 * 1024 * 1024 ||
    !Number.isSafeInteger(limits.timeoutMs) ||
    (limits.timeoutMs as number) < 1_000 ||
    (limits.timeoutMs as number) > 30_000
  )
    return invalid();
  return Object.freeze({
    ...value,
    limits: Object.freeze(limits),
  }) as unknown as OrdinaryDirectPngPolicy;
}

/** Reject expansion and malformed results, retaining only safe detached output observations. */
// eslint-disable-next-line max-lines-per-function -- Validate the single sink result atomically before any facts can authorize destination reconciliation.
function snapshotBinaryResult(
  input: unknown,
  descriptor: Readonly<StagedBinaryAssetDescriptor>,
  destinations: readonly PersistentOutputDestination[]
): { result: StagedBinaryAssetResult; facts: OrdinaryDirectPngFacts['binary']['results'] } {
  const data = producerRecord(
    detachProducerData(input),
    ['assetId', 'results', 'allSuccessful'],
    ['descriptor']
  );
  if (data.assetId !== descriptor.assetId || typeof data.allSuccessful !== 'boolean')
    return invalid();
  if (data.descriptor !== undefined) {
    const actual = producerRecord(data.descriptor, [
      'assetId',
      'relativePath',
      'mediaType',
      'byteLength',
      'sha256',
    ]);
    if (Object.entries(descriptor).some(([key, value]) => actual[key] !== value)) return invalid();
  }
  const outputs = producerList(data.results, 2).map(value =>
    producerRecord(
      value,
      ['destination', 'success'],
      ['sinkObservation', 'warning', 'error', 'writeOutcome']
    )
  );
  if (
    outputs.length !== destinations.length ||
    outputs.some(output => typeof output.success !== 'boolean') ||
    destinations.some(
      destination => outputs.filter(output => output.destination === destination).length !== 1
    ) ||
    data.allSuccessful !== outputs.every(output => output.success) ||
    (data.descriptor === undefined && outputs.some(output => output.success))
  )
    return invalid();
  // eslint-disable-next-line complexity -- Each optional sink observation/cleanup shape is checked before retaining any safe facts.
  const facts = destinations.map(destination => {
    const output = outputs.find(item => item.destination === destination)!;
    if (output.error !== undefined && typeof output.error !== 'string') return invalid();
    if (output.warning !== undefined && output.warning !== 'binary-stage-cleanup-deferred')
      return invalid();
    let deferred = output.warning === 'binary-stage-cleanup-deferred';
    let writeState: 'confirmed' | 'unknown' | 'not-dispatched' | undefined;
    if (output.writeOutcome !== undefined) {
      const write = producerRecord(output.writeOutcome, ['state'], ['cleanupDeferred']);
      if (
        !['confirmed', 'unknown', 'not-dispatched'].includes(write.state as string) ||
        (write.cleanupDeferred !== undefined && write.cleanupDeferred !== true)
      )
        return invalid();
      writeState = write.state as typeof writeState;
      deferred ||= write.cleanupDeferred === true;
    }
    const observation =
      output.sinkObservation === undefined
        ? undefined
        : snapshotSinkObservation(output.sinkObservation);
    if (output.sinkObservation !== undefined && !observation) return invalid();
    if (
      observation &&
      (observation.kind === 'byte-readback-sha256'
        ? observation.byteLength !== descriptor.byteLength ||
          observation.sha256 !== descriptor.sha256
        : observation.observedRelativePath !== descriptor.relativePath)
    )
      return invalid();
    const success =
      output.success === true && writeState !== 'unknown' && writeState !== 'not-dispatched';
    return {
      destination,
      success,
      ...(observation && success && { observation }),
      ...(deferred && { cleanupDeferred: true as const }),
      ...(writeState && { writeState }),
    };
  });
  return {
    result: freezeProducerData({
      assetId: descriptor.assetId,
      ...(data.descriptor !== undefined && { descriptor: { ...descriptor } }),
      results: facts.map(output => ({
        destination: output.destination,
        success: output.success,
        ...(output.observation && { sinkObservation: output.observation }),
        ...(output.cleanupDeferred && { warning: 'binary-stage-cleanup-deferred' }),
      })),
      allSuccessful: facts.every(output => output.success),
    }),
    facts: freezeProducerData(facts),
  };
}

/** Every started request/fetch/sink drains. Stops fence the *actual* effect invocation. */
// eslint-disable-next-line max-lines-per-function -- The one-shot closure keeps independent execution-local facts alive across all later failures.
export function createOrdinaryDirectPngAttempt(
  policy: Extract<OrdinaryDirectPngPolicy, { mode: 'explicit' }>,
  reserved: readonly PersistentOutputDestination[],
  isStopped: () => boolean,
  now?: () => Date
): {
  attempt: (
    context: ChatGptAssetExportContext,
    destinations: readonly PersistentOutputDestination[],
    originalRaw: unknown
  ) => Promise<ExplicitChatGptAssetAttempt>;
  facts: () => OrdinaryDirectPngFacts;
} {
  let resolver: OrdinaryDirectPngFacts['resolver'] = {
    state: 'not-started',
    eligibleCount: 0,
    matchedCount: 0,
  };
  let acquisition: OrdinaryDirectPngFacts['acquisition'] = { state: 'not-started' };
  let binary: OrdinaryDirectPngFacts['binary'] = {
    state: 'not-invoked',
    destinations: [],
    results: [],
    cleanupUncertain: false,
  };
  let entered = false;
  // eslint-disable-next-line complexity, max-lines-per-function -- One candidate and one sink, with independent monotonic facts at each actual effect fence.
  async function attempt(
    context: ChatGptAssetExportContext,
    destinations: readonly PersistentOutputDestination[],
    originalRaw: unknown
  ): Promise<ExplicitChatGptAssetAttempt> {
    if (entered) return invalid();
    entered = true;
    const inventory = context.rawCaptureBundle.manifest.assets;
    let acquired: ExplicitChatGptAssetAttempt['acquired'] = {
      records: inventory.map(record => ({
        ...record,
        sourceRefs: record.sourceRefs.map(ref => ({ ...ref })),
      })),
      runtimeAssets: [],
    };
    const done = (
      binaryResults: readonly StagedBinaryAssetResult[] = []
    ): ExplicitChatGptAssetAttempt => ({ acquired, binaryResults, warnings: [] });
    const eligible = inventory
      .filter(record => record.state === 'not-attempted' && record.mediaType === 'image/png')
      .map(record => record.id);
    resolver = { ...resolver, eligibleCount: eligible.length };
    if (isStopped() || eligible.length === 0) return done();
    let transient: readonly ChatGptTransientResolverRecord[] = [];
    const observation = await observeChatGptAssetResolvers(
      context,
      {
        requestResolvers: async id => {
          if (isStopped()) throw new Error('execution-cancelled');
          resolver = { ...resolver, state: 'started' };
          const response = await policy.requestResolvers(id);
          if (response.success) transient = response.data.transientAssetResolvers;
          return response;
        },
      },
      eligible
    );
    if (resolver.state === 'started')
      resolver = {
        ...resolver,
        state: observation.kind === 'matched' ? 'matched' : 'failed',
        matchedCount: observation.kind === 'matched' ? observation.candidates.length : 0,
      };
    if (isStopped() || observation.kind !== 'matched') return done();
    // Ordinary matching already ran against the whole ledger. A separate deny-only
    // interpreter check must not inherit that family's bounded dispatch-plan cap.
    // Match each owned record alone ONLY to deny aliases of its transient identity;
    // this can never select/promote a weaker candidate or issue another request.
    const blockedUrls = new Set<string>();
    try {
      for (const record of inventory) {
        if (!(await hasChatGptInterpreterAssetOwnership(originalRaw, record))) continue;
        for (const blocked of await matchChatGptPageOwnedAssetResolvers({
          raw: originalRaw,
          assets: [record],
          resolvers: transient,
        }))
          blockedUrls.add(blocked.downloadUrl);
      }
    } catch {
      return done();
    }
    if (isStopped()) return done();
    const candidate = observation.candidates
      .filter(
        item =>
          item.resolverKey === undefined &&
          !blockedUrls.has(item.downloadUrl) &&
          isChatGptTransientDownloadUrl(item.downloadUrl, context.conversationId) &&
          getChatGptNumericResolverFileId(item.downloadUrl) === undefined
      )
      .sort((a, b) => (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0))[0];
    if (!candidate) return done();
    try {
      acquired = await acquireChatGptPageOwnedAssets({
        conversationId: context.conversationId,
        assets: acquired.records,
        candidates: [candidate],
        fetcher: (...args) => {
          // The core awaits exact URL/hash verification before reaching this fence.
          if (isStopped()) throw new Error('execution-cancelled');
          acquisition = { state: 'attempted', outcome: 'unknown', assetId: candidate.assetId };
          return policy.fetchAsset(...args);
        },
        ...(now && { now }),
        timeoutMs: policy.limits.timeoutMs,
        maxAssetBytes: policy.limits.maxAssetBytes,
        maxTotalBytes: policy.limits.maxAssetBytes,
        budget: { attemptsRemaining: 1, bytesRemaining: policy.limits.maxAssetBytes },
      });
    } catch {
      return done();
    }
    const asset = acquired.runtimeAssets[0];
    if (acquisition.state === 'attempted')
      acquisition = asset
        ? {
            state: 'attempted',
            outcome: 'verified',
            assetId: candidate.assetId,
            mediaType: 'image/png',
            byteLength: asset.record.byteLength!,
            sha256: asset.record.sha256!,
          }
        : { ...acquisition, outcome: 'failed' };
    if (isStopped() || !asset) return done();
    if (
      destinations.length === 0 ||
      new Set(destinations).size !== destinations.length ||
      destinations.some(destination => !reserved.includes(destination))
    )
      return invalid();
    const descriptor = Object.freeze({
      assetId: asset.record.id,
      mediaType: 'image/png',
      byteLength: asset.bytes.byteLength,
      sha256: asset.record.sha256!,
      relativePath: asset.record.relativePath!,
    });
    const write = Object.freeze({
      descriptor,
      bytes: asset.bytes.slice(),
      destinations: Object.freeze([...destinations]),
    });
    // No await or caller code between this last stop check and ownership transfer.
    if (isStopped()) return done();
    binary = {
      state: 'invoked',
      outcome: 'outcome-unknown',
      destinations: write.destinations,
      results: [],
      cleanupUncertain: true,
    };
    try {
      const returned = await policy.persistBinaryAsset(write);
      const snapshot = snapshotBinaryResult(returned, descriptor, write.destinations);
      binary = {
        ...binary,
        outcome: 'returned',
        results: snapshot.facts,
        cleanupUncertain: snapshot.facts.some(
          item => item.cleanupDeferred || item.writeState === 'unknown' || !item.success
        ),
      };
      return done([snapshot.result]);
    } catch {
      return done();
    }
  }
  return Object.freeze({
    attempt,
    facts: () =>
      freezeProducerData({
        policy: 'ordinary-direct-png/1' as const,
        resolver: { ...resolver },
        acquisition: { ...acquisition },
        binary: { ...binary, destinations: [...binary.destinations], results: [...binary.results] },
      }),
  });
}
