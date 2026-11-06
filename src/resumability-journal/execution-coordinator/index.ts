/** Unwired, one-operation execution. No retry, settlement or crash-durable late facts. */
import {
  capturePreparedChatGpt,
  type AdmittedChatGptCaptureDependencies,
} from '../../content/capture/chatgpt-admitted-capture';
import {
  buildChatGptBinaryAwareDestinationArchive,
  ChatGptCurrentBranchError,
  type ChatGptArchiveCapture,
  type ChatGptCurrentBranchErrorCode,
} from '../../content/capture/chatgpt-current-branch';
import {
  persistChatGptDestinationHonestAttachments,
  type ChatGptAssetExportDependencies,
  type ChatGptAssetExportResult,
} from '../../content/chatgpt-asset-export';
import type { ArchiveCompanionBundle } from '../../lib/types';
import {
  createExecutionStages,
  hasStageReferences,
  snapshotStagePort,
  type ExecutionStageFact,
  type ExecutionArchiveWriteFact,
  type StagedExecutionDependencies,
} from './stages';
import { validatePreparedChatGpt, type PreparedChatGptCapture } from '../capture-handoff';
import {
  PurposePersistenceError,
  PurposePersistenceStore,
  type ExecutionInterruptionReason,
  type OperationRecord,
} from '../purpose-persistence-v2/idb';

export interface ChatGptExecutionInput {
  readonly store: PurposePersistenceStore;
  readonly prepared: PreparedChatGptCapture;
  readonly expectedReservedRevision: number;
  readonly noteFileName: string;
  readonly signal: AbortSignal;
}
export interface InlineExecutionDependencies {
  /** Omission preserves the original isolated inline-only route. */
  readonly captureTransport?: 'inline-only';
  readonly requestCapture: AdmittedChatGptCaptureDependencies['requestCapture'];
  readonly persistArtifacts: ChatGptAssetExportDependencies['persistArtifacts'];
  readonly now?: () => Date;
}
export type ChatGptExecutionDependencies =
  | InlineExecutionDependencies
  | StagedExecutionDependencies;
type PersistenceCode = PurposePersistenceError['code'];
export interface ExecutionPersistence {
  readonly state: 'not-attempted' | 'committed' | 'failed' | 'outcome-unknown';
  readonly record?: OperationRecord;
  readonly code?: PersistenceCode;
}
export interface ChatGptExecutionOutcome {
  readonly request: 'not-invoked' | 'invoked';
  readonly dispatch: 'not-started' | 'started';
  readonly stage: 'claim' | 'capture' | 'producer' | 'evidence' | 'finished';
  readonly code:
    | 'claim-failed'
    | 'dispatch-denied'
    | 'execution-cancelled'
    | 'staged-unsupported'
    | 'capture-failed'
    | 'producer-failed'
    | 'producer-incomplete'
    | 'evidence-persistence-failed'
    | 'evidence-recorded';
  readonly claim: ExecutionPersistence;
  readonly consumption: ExecutionPersistence;
  readonly capture?: ChatGptArchiveCapture;
  /** Completed normalization survives cleanup without advertising dead/live borrowed leases. */
  readonly captureMaterial?: Pick<ChatGptArchiveCapture, 'archive'>;
  readonly stageOwnership?: readonly ExecutionStageFact[];
  readonly archiveWrites?: readonly ExecutionArchiveWriteFact[];
  readonly captureError?: {
    readonly code: ChatGptCurrentBranchErrorCode;
    readonly archiveCompanion?: ArchiveCompanionBundle;
  };
  readonly producer?: ChatGptAssetExportResult;
  readonly evidence: ExecutionPersistence;
  readonly uncertainty: ExecutionPersistence & { readonly reason?: ExecutionInterruptionReason };
  readonly interrupted: boolean;
}

export class ExecutionInputError extends Error {
  readonly code = 'invalid-execution-input';
  constructor() {
    super('invalid-execution-input');
    this.name = 'ExecutionInputError';
  }
}

/** Do not invoke caller accessors or accept hidden dependency/output/authority overrides. */
function fields(
  input: unknown,
  required: string[],
  optional: string[] = []
): Record<string, unknown> {
  if (!input || typeof input !== 'object') throw new ExecutionInputError();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Reflect.ownKeys(input).some(
      key => typeof key !== 'string' || ![...required, ...optional].includes(key)
    ) ||
    required.some(key => !Object.prototype.hasOwnProperty.call(descriptors, key)) ||
    Object.values(descriptors).some(descriptor => !('value' in descriptor))
  )
    throw new ExecutionInputError();
  return Object.fromEntries(Object.entries(descriptors).map(([key, value]) => [key, value.value]));
}

function persistenceFailure(error: unknown): ExecutionPersistence {
  const code = error instanceof PurposePersistenceError ? error.code : 'write-failed';
  return { state: code === 'transaction-outcome-unknown' ? 'outcome-unknown' : 'failed', code };
}

function captureFailure(error: unknown): NonNullable<ChatGptExecutionOutcome['captureError']> {
  return error instanceof ChatGptCurrentBranchError
    ? {
        code: error.code,
        ...(error.archiveCompanion && { archiveCompanion: error.archiveCompanion }),
      }
    : { code: 'capture-failed' };
}

/**
 * Capture dependencies and the abort latch synchronously. run() is idempotent only as
 * a handle: all callers share the same execution promise, never another request.
 * A different handle must compete for the durable reserved revision normally.
 */
// eslint-disable-next-line max-lines-per-function, complexity -- One explicit one-shot closure snapshots the discriminated capabilities and owns its stop latch and ordered effect boundaries.
export function createChatGptExecution(
  input: ChatGptExecutionInput,
  dependencies: ChatGptExecutionDependencies
): { readonly run: () => Promise<ChatGptExecutionOutcome> } {
  const supplied = fields(input, [
    'store',
    'prepared',
    'expectedReservedRevision',
    'noteFileName',
    'signal',
  ]);
  const candidate = fields(
    dependencies,
    ['requestCapture'],
    ['persistArtifacts', 'now', 'captureTransport', 'stagePort', 'persistSelectedArtifacts']
  );
  const staged = candidate.captureTransport === 'staged';
  const deps = staged
    ? fields(
        dependencies,
        ['requestCapture', 'captureTransport', 'stagePort', 'persistSelectedArtifacts'],
        ['now']
      )
    : fields(dependencies, ['requestCapture', 'persistArtifacts'], ['now', 'captureTransport']);
  const { store, expectedReservedRevision, noteFileName, signal } =
    supplied as unknown as ChatGptExecutionInput;
  const { requestCapture, now } = deps as unknown as ChatGptExecutionDependencies;
  if (
    !(store instanceof PurposePersistenceStore) ||
    !Number.isSafeInteger(expectedReservedRevision) ||
    expectedReservedRevision < 0 ||
    typeof noteFileName !== 'string' ||
    !noteFileName.trim() ||
    noteFileName.length > 255 ||
    /[\\/]/u.test(noteFileName) ||
    Array.from(noteFileName).some(character => character.charCodeAt(0) < 32) ||
    !(signal instanceof AbortSignal) ||
    typeof requestCapture !== 'function' ||
    typeof (staged ? deps.persistSelectedArtifacts : deps.persistArtifacts) !== 'function' ||
    (!staged && deps.captureTransport !== undefined && deps.captureTransport !== 'inline-only') ||
    (now !== undefined && typeof now !== 'function')
  )
    throw new ExecutionInputError();
  const prepared = validatePreparedChatGpt(supplied.prepared);
  const { operation, producerIntent } = prepared;
  let stagePort;
  try {
    if (staged) stagePort = snapshotStagePort(deps.stagePort);
  } catch {
    throw new ExecutionInputError();
  }
  const destinations = operation.destinations.map(item => item.destination);
  let interrupted = signal.aborted;
  const stop = () => {
    interrupted = true;
  };
  signal.addEventListener('abort', stop, { once: true });
  let running: Promise<ChatGptExecutionOutcome> | undefined;
  const stages = stagePort
    ? createExecutionStages(
        Object.freeze({ operationId: operation.operationId, captureId: operation.captureId }),
        stagePort,
        (deps as unknown as StagedExecutionDependencies).requestCapture,
        (deps as unknown as StagedExecutionDependencies).persistSelectedArtifacts,
        () => interrupted
      )
    : undefined;
  const captureRequest =
    stages?.capture ?? (requestCapture as InlineExecutionDependencies['requestCapture']);
  const persistArtifacts =
    stages?.persist ?? (deps as unknown as InlineExecutionDependencies).persistArtifacts;

  // No abort is passed to capture or already-started sinks: their late facts must drain.
  const guardedSink: ChatGptAssetExportDependencies['persistArtifacts'] = (...args) => {
    if (interrupted) throw new Error('execution-cancelled');
    if (args[3].some(destination => !destinations.some(allowed => allowed === destination)))
      throw new Error('unreserved-destination');
    return persistArtifacts(...args);
  };
  async function mark(
    reason: ExecutionInterruptionReason
  ): Promise<ChatGptExecutionOutcome['uncertainty']> {
    try {
      const current = await store.read(operation.operationId);
      if (!current) throw new PurposePersistenceError('operation-not-found');
      const record = await store.markExecutionUnknown(
        operation.operationId,
        current.revision,
        reason
      );
      return { state: 'committed', record, reason };
    } catch (error) {
      return { ...persistenceFailure(error), reason };
    }
  }
  async function persistEvidence(
    producer: ChatGptAssetExportResult
  ): Promise<ExecutionPersistence> {
    try {
      // One read, one CAS. Pause/recovery may be accepted; abandon/observation may not.
      const current = await store.read(operation.operationId);
      if (!current) throw new PurposePersistenceError('operation-not-found');
      // Staged mode has a strict effect-start stop fence. Already-started CAS drains normally.
      if (stages && interrupted) return { state: 'not-attempted' };
      const record = await store.recordProducerReceipts(
        operation.operationId,
        current.revision,
        producer.producerReceipts ?? []
      );
      return { state: 'committed', record };
    } catch (error) {
      return persistenceFailure(error);
    }
  }

  // eslint-disable-next-line max-lines-per-function, complexity -- Preserve independent request, capture, producer and persistence facts across every exit.
  async function execute(): Promise<ChatGptExecutionOutcome> {
    const result: {
      -readonly [Key in keyof ChatGptExecutionOutcome]: ChatGptExecutionOutcome[Key];
    } = {
      request: 'not-invoked',
      dispatch: 'not-started',
      stage: 'claim',
      code: 'claim-failed',
      claim: { state: 'not-attempted' },
      consumption: { state: 'not-attempted' },
      evidence: { state: 'not-attempted' },
      uncertainty: { state: 'not-attempted' },
      interrupted,
    };
    try {
      let claimed: Awaited<ReturnType<PurposePersistenceStore['claimDispatch']>>;
      try {
        claimed = await store.claimDispatch(operation.operationId, expectedReservedRevision);
        result.claim = { state: 'committed', record: claimed.record };
      } catch (error) {
        result.claim = persistenceFailure(error);
        return result;
      }
      if (interrupted) {
        result.code = 'execution-cancelled';
        result.uncertainty = await mark('execution-cancelled');
        return result;
      }
      result.stage = 'capture';
      let boundaryCode:
        | 'execution-cancelled'
        | 'dispatch-denied'
        | 'staged-unsupported'
        | undefined;
      let boundaryEntered = false;
      try {
        const captured = await capturePreparedChatGpt(prepared, {
          inlineOnly: !stages,
          ...(stages && { stageAccess: stages.access }),
          ...(now && { now }),
          requestCapture: async id => {
            if (boundaryEntered) throw new ChatGptCurrentBranchError('capture-failed');
            boundaryEntered = true;
            let response;
            try {
              response = await store.consumeDispatch(claimed.token, operation, () => {
                result.consumption = { state: 'committed' };
                // Store invokes this synchronously after its final fence, outside IDB.
                if (interrupted) {
                  boundaryCode = 'execution-cancelled';
                  throw new ChatGptCurrentBranchError('capture-failed');
                }
                result.dispatch = 'started';
                result.request = 'invoked';
                return captureRequest(id);
              });
            } catch (error) {
              // Callback rejection is a request/cancellation failure, not failed authority.
              if (result.consumption.state === 'not-attempted') {
                result.consumption = persistenceFailure(error);
                boundaryCode = 'dispatch-denied';
              }
              throw error;
            }
            if (!stages && response?.success && response.data?.transport === 'staged') {
              boundaryCode = 'staged-unsupported';
              throw new ChatGptCurrentBranchError('capture-response-invalid');
            }
            return response;
          },
        });
        result.capture = captured.capture;
      } catch (error) {
        result.code = boundaryCode ?? (interrupted ? 'execution-cancelled' : 'capture-failed');
        result.captureError = captureFailure(error);
        if (result.consumption.state !== 'outcome-unknown')
          result.uncertainty = await mark(interrupted ? 'execution-cancelled' : 'capture-failed');
        return result;
      }
      result.stage = 'producer';
      try {
        result.producer = await persistChatGptDestinationHonestAttachments(
          result.capture.assetExportContext!,
          result.capture.archiveCompanion,
          noteFileName,
          destinations,
          {
            producerIntent,
            assetAcquisition: 'disabled',
            persistArtifacts: guardedSink,
            buildDestinationArchive: (context, records, assets, metric, warnings) =>
              buildChatGptBinaryAwareDestinationArchive(
                context,
                records,
                assets,
                metric,
                warnings,
                !stages,
                stages?.access
              ),
          }
        );
      } catch {
        result.code = 'producer-failed';
        result.uncertainty = await mark(interrupted ? 'execution-cancelled' : 'producer-failed');
        return result;
      }
      const complete = destinations.every(destination =>
        result.producer!.completeDestinations.includes(destination)
      );
      result.code = interrupted
        ? 'execution-cancelled'
        : complete
          ? 'evidence-recorded'
          : 'producer-incomplete';
      if (interrupted || !complete)
        result.uncertainty = await mark(interrupted ? 'execution-cancelled' : 'producer-failed');
      if (result.uncertainty.state === 'outcome-unknown') return result;
      if (stages && interrupted) return result;
      result.stage = 'evidence';
      result.evidence = await persistEvidence(result.producer);
      if (stages && result.evidence.state === 'not-attempted' && interrupted) {
        result.code = 'execution-cancelled';
        return result;
      }
      if (result.evidence.state !== 'committed') {
        result.code = 'evidence-persistence-failed';
        // Unknown outcome may already contain the commit: no compensation or retry.
        if (
          result.evidence.state !== 'outcome-unknown' &&
          result.uncertainty.state === 'not-attempted'
        )
          result.uncertainty = await mark('evidence-persistence-failed');
        return result;
      }
      result.stage = 'finished';
      return result;
    } finally {
      if (stages) {
        result.stageOwnership = await stages.cleanup();
        result.archiveWrites = stages.archiveWrites();
        if (result.capture && hasStageReferences(result.capture.archiveCompanion)) {
          result.captureMaterial = Object.freeze({ archive: result.capture.archive });
          delete result.capture;
        }
        if (
          result.captureError?.archiveCompanion &&
          hasStageReferences(result.captureError.archiveCompanion)
        )
          result.captureError = { code: result.captureError.code };
      }
      result.interrupted = interrupted;
      signal.removeEventListener('abort', stop);
      Object.freeze(result);
    }
  }
  return Object.freeze({ run: () => (running ??= execute()) });
}
