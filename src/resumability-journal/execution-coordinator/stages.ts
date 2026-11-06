/** Unwired execution-local ownership. No durable spool, runtime bridge or acquisition. */
import {
  ARCHIVE_STAGE_CHUNK_BYTES,
  isArchiveStageDescriptor,
  isSafeArchiveStageId,
  type ArchiveStageDescriptor,
} from '../../lib/archive-stage-contract';
import {
  isChatGptCaptureResponse,
  type ChatGptCaptureResponse,
} from '../../lib/chatgpt-capture-contract';
import type { ChatGptCaptureStageAccess } from '../../lib/chatgpt-capture-stage-access';
import type {
  ArchiveCompanionArtifact,
  ArchiveCompanionBundle,
  PersistentOutputDestination,
  StagedArchiveCompanionArtifact,
} from '../../lib/types';
import type {
  ArchiveCompanionPersistenceOutcome,
  ChatGptAssetExportDependencies,
} from '../../content/chatgpt-asset-export';
import { sha256Hex } from '../../content/capture/response';
import { detachProducerData } from '../../lib/producer-evidence-data';
import { snapshotProducerObservations } from '../../lib/chatgpt-producer-evidence';

/** Identity is reference-bound, not reconstructed from strings. One per handle. */
export interface StageExecutionBinding {
  readonly operationId: string;
  readonly captureId: string;
}
export interface SealedExecutionStage {
  readonly binding: StageExecutionBinding;
  /** Opaque authority issued/checked by the capability provider, never a stage ID alone. */
  readonly token: object;
  readonly artifact: StagedArchiveCompanionArtifact;
}
export type StageReleaseOutcome = 'released' | 'deferred' | 'outcome-unknown';
/** Freeze the complete own-data function bundle before constructing the execution.
 * read verifies token/binding/sealed commitment and returns only the requested range.
 * create owns all partial/unreturned/invalid stages; a valid return transfers ownership.
 * release must report uncertainty honestly (a swallowed abort is not confirmation).
 */
export interface ExecutionStagePort {
  readonly read: (
    lease: SealedExecutionStage,
    range: Readonly<{ offset: number; byteLength: number }>
  ) => Promise<Uint8Array>;
  readonly create: (
    binding: StageExecutionBinding,
    commitment: Readonly<ArchiveStageDescriptor>,
    bytes: Uint8Array
  ) => Promise<SealedExecutionStage>;
  readonly release: (lease: SealedExecutionStage) => Promise<StageReleaseOutcome>;
}
export interface OwnedCaptureResponse {
  readonly response: ChatGptCaptureResponse;
  /** Required exactly for a valid staged success. Otherwise the request retains ownership. */
  readonly lease?: SealedExecutionStage;
}
export interface SelectedArchiveWrite {
  readonly binding: StageExecutionBinding;
  readonly conversationKey: string;
  readonly capturedAt?: string;
  readonly noteFileName: string;
  readonly destinations: readonly PersistentOutputDestination[];
  /** ONLY selected artifacts; no unselected companion/lease is visible to this sink. */
  readonly artifacts: readonly ArchiveCompanionArtifact[];
  readonly leases: readonly SealedExecutionStage[];
}
/** Invocation synchronously transfers every supplied lease, including synchronous throw,
 * rejection, malformed result or unknown completion. The sink must retain cleanup ownership
 * and drain its readers before resolving/rejecting. Never wrap the legacy whole-bundle sink.
 */
export type SelectedArchiveSink = (
  write: SelectedArchiveWrite
) => Promise<ArchiveCompanionPersistenceOutcome>;
export interface StagedExecutionDependencies {
  readonly captureTransport: 'staged';
  readonly stagePort: ExecutionStagePort;
  readonly requestCapture: (
    conversationId: string,
    binding: StageExecutionBinding
  ) => Promise<OwnedCaptureResponse>;
  readonly persistSelectedArtifacts: SelectedArchiveSink;
  readonly now?: () => Date;
}
export interface ExecutionStageFact {
  /** Local ordinal only: no provider IDs, stage IDs, body or URL. */
  readonly correlation: number;
  readonly kind: 'raw' | 'canonical';
  readonly event: 'received' | 'created' | 'transferred' | StageReleaseOutcome;
}
export interface ExecutionArchiveWriteFact {
  readonly invocation: number;
  readonly kinds: readonly ArchiveCompanionArtifact['kind'][];
  readonly correlations: readonly number[];
  readonly destinations: readonly PersistentOutputDestination[];
  /** Returned means structurally valid facts, not necessarily successful persistence. */
  readonly state: 'started' | 'returned' | 'outcome-unknown';
}
interface Entry {
  lease: SealedExecutionStage;
  correlation: number;
  owner: 'execution' | 'sink' | 'cleanup';
}
const invalid = (): never => {
  throw new Error('invalid-stage-capability');
};

function dataFields(
  input: unknown,
  keys: string[],
  optional: string[] = []
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const ds = Object.getOwnPropertyDescriptors(input);
  if (
    Reflect.ownKeys(input).some(
      key => typeof key !== 'string' || ![...keys, ...optional].includes(key)
    ) ||
    keys.some(key => !Object.prototype.hasOwnProperty.call(ds, key)) ||
    Object.values(ds).some(d => !('value' in d))
  )
    return invalid();
  return Object.fromEntries(Object.entries(ds).map(([key, d]) => [key, d.value]));
}

/** Capture response snapshots need large base64 strings but only a tiny bounded structure. */
function snapshotResponse(input: unknown): ChatGptCaptureResponse {
  let count = 0;
  let size = 0;
  // eslint-disable-next-line complexity -- Bounded data-only traversal rejects accessors before the existing response validator reads fields.
  const copy = (value: unknown, depth: number): unknown => {
    if (++count > 4096 || depth > 8) return invalid();
    if (typeof value === 'string') {
      size += value.length;
      if (size > 24 * 1024 * 1024) return invalid();
      return value;
    }
    if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (!value || typeof value !== 'object') return invalid();
    const array = Array.isArray(value);
    const ds = Object.getOwnPropertyDescriptors(value);
    const result: Record<string, unknown> = array ? ([] as unknown as Record<string, unknown>) : {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !('value' in ds[key])) return invalid();
      if (array && key === 'length') continue;
      if (['__proto__', 'constructor', 'prototype'].includes(key)) return invalid();
      result[key] = copy(ds[key].value, depth + 1);
    }
    return Object.freeze(result);
  };
  const response = copy(input, 0);
  if (!isChatGptCaptureResponse(response)) return invalid();
  return response;
}

function snapshotArtifact(input: unknown): StagedArchiveCompanionArtifact {
  const record = dataFields(input, [
    'transport',
    'stageId',
    'kind',
    'mediaType',
    'relativePath',
    'byteLength',
    'sha256',
  ]);
  const { transport, stageId, ...descriptor } = record;
  if (
    transport !== 'staged' ||
    !isSafeArchiveStageId(stageId) ||
    !isArchiveStageDescriptor(descriptor)
  )
    return invalid();
  return Object.freeze(record) as unknown as StagedArchiveCompanionArtifact;
}
function sameArtifact(
  left: StagedArchiveCompanionArtifact,
  right: StagedArchiveCompanionArtifact
): boolean {
  return (Object.keys(left) as (keyof StagedArchiveCompanionArtifact)[]).every(
    key => left[key] === right[key]
  );
}

/** Snapshot capabilities synchronously, before claim/dispatch. */
export function snapshotStagePort(input: unknown): ExecutionStagePort {
  const fields = dataFields(input, ['read', 'create', 'release']);
  if (!Object.isFrozen(input) || Object.values(fields).some(value => typeof value !== 'function'))
    return invalid();
  return Object.freeze(fields) as unknown as ExecutionStagePort;
}

function snapshotSinkOutcome(
  value: unknown,
  outputs: readonly string[]
): ArchiveCompanionPersistenceOutcome {
  const outcome = dataFields(
    detachProducerData(value),
    ['activeOutputs', 'warnings'],
    ['observations']
  );
  if (
    !Array.isArray(outcome.activeOutputs) ||
    !Array.isArray(outcome.warnings) ||
    new Set(outcome.activeOutputs).size !== outcome.activeOutputs.length ||
    outcome.activeOutputs.some(item => !outputs.includes(item)) ||
    outcome.warnings.some(item => typeof item !== 'string')
  )
    return invalid();
  const observations =
    outcome.observations === undefined
      ? undefined
      : snapshotProducerObservations(outcome.observations);
  return {
    activeOutputs: outcome.activeOutputs as PersistentOutputDestination[],
    warnings: outcome.warnings as string[],
    ...(observations && { observations }),
  };
}

function invokeSelectedSink(
  sink: SelectedArchiveSink,
  write: SelectedArchiveWrite,
  completed: (state: 'returned' | 'outcome-unknown') => void
): Promise<ArchiveCompanionPersistenceOutcome> {
  try {
    return Promise.resolve(sink(write)).then(
      value => {
        try {
          const outcome = snapshotSinkOutcome(value, write.destinations);
          completed('returned');
          return outcome;
        } catch (error) {
          completed('outcome-unknown');
          throw error;
        }
      },
      error => {
        completed('outcome-unknown');
        throw error;
      }
    );
  } catch (error) {
    completed('outcome-unknown');
    throw error;
  }
}

// eslint-disable-next-line max-lines-per-function -- One execution registry owns every lease and its exact transfer/cleanup boundary.
export function createExecutionStages(
  binding: StageExecutionBinding,
  port: ExecutionStagePort,
  request: StagedExecutionDependencies['requestCapture'],
  sink: SelectedArchiveSink,
  stopped: () => boolean
) {
  const entries: Entry[] = [];
  const facts: ExecutionStageFact[] = [];
  const writes: ExecutionArchiveWriteFact[] = [];
  const fence = () => {
    if (stopped()) throw new Error('execution-cancelled');
  };
  const fact = (entry: Entry, event: ExecutionStageFact['event']) => {
    facts.push(
      Object.freeze({ correlation: entry.correlation, kind: entry.lease.artifact.kind, event })
    );
  };
  const accept = (
    input: unknown,
    expected: StagedArchiveCompanionArtifact,
    event: 'received' | 'created'
  ) => {
    const value = dataFields(input, ['binding', 'token', 'artifact']);
    const artifact = snapshotArtifact(value.artifact);
    if (
      value.binding !== binding ||
      !value.token ||
      typeof value.token !== 'object' ||
      !sameArtifact(artifact, expected) ||
      entries.some(
        item => item.lease.token === value.token || item.lease.artifact.stageId === artifact.stageId
      )
    )
      return invalid();
    const lease = Object.freeze({ binding, token: value.token, artifact });
    const entry: Entry = { lease, correlation: entries.length + 1, owner: 'execution' };
    entries.push(entry);
    fact(entry, event);
    return artifact;
  };
  const owned = (artifact: StagedArchiveCompanionArtifact) => {
    const entry = entries.find(
      item => item.owner === 'execution' && sameArtifact(item.lease.artifact, artifact)
    );
    return entry ?? invalid();
  };
  const access: ChatGptCaptureStageAccess = Object.freeze({
    readRaw: async (artifact: StagedArchiveCompanionArtifact) => {
      const entry = owned(artifact);
      if (artifact.kind !== 'raw') return invalid();
      const bytes = new Uint8Array(artifact.byteLength);
      for (let offset = 0; offset < bytes.byteLength; offset += ARCHIVE_STAGE_CHUNK_BYTES) {
        const byteLength = Math.min(ARCHIVE_STAGE_CHUNK_BYTES, bytes.byteLength - offset);
        fence();
        const chunk = await port.read(entry.lease, Object.freeze({ offset, byteLength }));
        if (!(chunk instanceof Uint8Array) || chunk.byteLength !== byteLength) return invalid();
        bytes.set(chunk, offset);
      }
      if ((await sha256Hex(bytes)) !== artifact.sha256) return invalid();
      return bytes;
    },
    createCanonical: async (source: Uint8Array) => {
      fence();
      const bytes = source.slice();
      const commitment = Object.freeze({
        kind: 'canonical' as const,
        mediaType: 'application/json' as const,
        relativePath: 'canonical/liska-thread-1.json',
        byteLength: bytes.byteLength,
        sha256: await sha256Hex(bytes),
      });
      if (!isArchiveStageDescriptor(commitment)) return invalid();
      fence();
      const returned = await port.create(binding, commitment, bytes);
      // A valid late seal is accepted even after stop, then released by the final drain.
      const leaseFields = dataFields(returned, ['binding', 'token', 'artifact']);
      const artifact = snapshotArtifact(leaseFields.artifact);
      return accept(
        returned,
        { ...commitment, transport: 'staged', stageId: artifact.stageId },
        'created'
      );
    },
  });
  const capture = async (id: string): Promise<ChatGptCaptureResponse> => {
    const value = dataFields(await request(id, binding), ['response'], ['lease']);
    const response = snapshotResponse(value.response);
    if (response.success && response.data.transport === 'staged') {
      const data = response.data;
      accept(
        value.lease,
        {
          transport: 'staged',
          stageId: data.stageId,
          kind: 'raw',
          mediaType: 'application/json',
          relativePath: 'responses/conversation.json',
          byteLength: data.byteLength,
          sha256: data.sha256,
        },
        'received'
      );
    } else if (value.lease !== undefined) return invalid();
    return response;
  };
  const persist: ChatGptAssetExportDependencies['persistArtifacts'] = (
    companion,
    noteFileName,
    _source,
    outputs,
    kinds
  ) => {
    const artifacts = companion.artifacts
      .filter(artifact => kinds.includes(artifact.kind))
      .map(artifact => Object.freeze({ ...artifact }));
    const selected = artifacts
      .filter(
        (artifact): artifact is StagedArchiveCompanionArtifact => artifact.transport === 'staged'
      )
      .map(owned);
    if (new Set(selected).size !== selected.length) return invalid();
    const write: SelectedArchiveWrite = Object.freeze({
      binding,
      conversationKey: companion.conversationKey,
      capturedAt: companion.capturedAt,
      noteFileName,
      destinations: Object.freeze([...outputs] as PersistentOutputDestination[]),
      artifacts: Object.freeze(artifacts),
      leases: Object.freeze(selected.map(item => item.lease)),
    });
    fence();
    const writeIndex = writes.length;
    const writeFact: ExecutionArchiveWriteFact = Object.freeze({
      invocation: writeIndex + 1,
      kinds: Object.freeze([...kinds]),
      correlations: Object.freeze(selected.map(item => item.correlation)),
      destinations: write.destinations,
      state: 'started',
    });
    writes.push(writeFact);
    // No await or fallible callback between recording transfer and sink invocation.
    for (const entry of selected) {
      entry.owner = 'sink';
      fact(entry, 'transferred');
    }
    return invokeSelectedSink(sink, write, state => {
      writes[writeIndex] = Object.freeze({ ...writeFact, state });
    });
  };
  const cleanup = async () => {
    // Called only once all started reads/creates/sinks have drained. Stop never suppresses release.
    for (const entry of entries) {
      if (entry.owner !== 'execution') continue;
      entry.owner = 'cleanup';
      let outcome: StageReleaseOutcome = 'outcome-unknown';
      try {
        const returned = await port.release(entry.lease);
        if (['released', 'deferred', 'outcome-unknown'].includes(returned)) outcome = returned;
      } catch {
        /* Preserve uncertainty independently of the original execution facts. */
      }
      fact(entry, outcome);
    }
    return Object.freeze([...facts]);
  };
  return Object.freeze({
    access,
    capture,
    persist,
    cleanup,
    archiveWrites: () => Object.freeze([...writes]),
  });
}

/** Returned capture material must never advertise a consumed/released stage as reusable. */
export function hasStageReferences(companion: ArchiveCompanionBundle): boolean {
  return companion.artifacts.some(artifact => artifact.transport === 'staged');
}
