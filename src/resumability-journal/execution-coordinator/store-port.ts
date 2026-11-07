/** Internal execution boundary. No reservation, control, transaction or scheduling capability. */
import {
  PurposePersistenceStore,
  PurposePersistenceError,
  type PurposeDispatchToken,
} from '../purpose-persistence-v2/idb';
import type { PersistenceErrorCode } from '../purpose-persistence-v2/core/errors';
import type {
  OperationRecord,
  ExecutionInterruptionReason,
} from '../purpose-persistence-v2/core/record';
import type { NewCaptureOperation } from '../purpose';

export type ExecutionStoreCode = PersistenceErrorCode | 'open-outcome-unknown';
const codes: readonly ExecutionStoreCode[] = [
  'unavailable',
  'not-open',
  'closed',
  'version-changed',
  'unsupported-version',
  'invalid-schema',
  'open-blocked',
  'open-failed',
  'open-timeout',
  'open-outcome-unknown',
  'transaction-aborted',
  'transaction-timeout',
  'transaction-outcome-unknown',
  'read-failed',
  'write-failed',
  'quota-exceeded',
  'corrupt-record',
  'record-too-large',
  'identity-exists',
  'record-limit',
  'operation-not-found',
  'revision-conflict',
  'transition-failed',
  'invalid-receipts',
];
export class ExecutionStoreError extends Error {
  readonly code: ExecutionStoreCode;
  constructor(code: ExecutionStoreCode) {
    const fixed = codes.includes(code) ? code : 'write-failed';
    super(fixed);
    this.code = fixed;
    this.name = 'ExecutionStoreError';
    Object.freeze(this);
  }
}
/** Identity only. Serialization, copying and reconstruction cannot carry authority. */
export type ExecutionDispatchToken = object;
export interface ExecutionStorePort {
  read(operationId: string): Promise<OperationRecord | undefined>;
  claimDispatch(
    operationId: string,
    expectedRevision: number
  ): Promise<{
    readonly record: OperationRecord;
    readonly token: ExecutionDispatchToken;
  }>;
  consumeDispatch<Output>(
    token: ExecutionDispatchToken,
    operation: NewCaptureOperation,
    beginEffect: () => Output | Promise<Output>
  ): Promise<Output>;
  markExecutionUnknown(
    operationId: string,
    expectedRevision: number,
    reason: ExecutionInterruptionReason
  ): Promise<OperationRecord>;
  recordProducerReceipts(
    operationId: string,
    expectedRevision: number,
    receipts: unknown
  ): Promise<OperationRecord>;
}
const methods = [
  'read',
  'claimDispatch',
  'consumeDispatch',
  'markExecutionUnknown',
  'recordProducerReceipts',
] as const;
const ports = new WeakSet<object>();

/** Internal only: architecture tests pin the two adapter consumers. Snapshot before any await. */
export function createExecutionStorePort(input: ExecutionStorePort): ExecutionStorePort {
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Reflect.ownKeys(input).length !== methods.length ||
    methods.some(
      key =>
        !descriptors[key] ||
        !('value' in descriptors[key]) ||
        typeof descriptors[key].value !== 'function'
    )
  )
    throw new ExecutionStoreError('transition-failed');
  const port = Object.freeze(
    Object.fromEntries(methods.map(key => [key, descriptors[key].value]))
  ) as unknown as ExecutionStorePort;
  ports.add(port);
  return port;
}

async function nativeResult<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new ExecutionStoreError(
      error instanceof PurposePersistenceError ? error.code : 'write-failed'
    );
  }
}

/** Keep the original native input contract; capture method references synchronously. */
export function snapshotExecutionStore(input: unknown): ExecutionStorePort {
  if (input && typeof input === 'object' && ports.has(input)) return input as ExecutionStorePort;
  if (
    !(input instanceof PurposePersistenceStore) ||
    Object.getPrototypeOf(input) !== PurposePersistenceStore.prototype
  )
    throw new ExecutionStoreError('transition-failed');
  const own = Object.getOwnPropertyDescriptors(input);
  if (
    methods.some(
      key => own[key] && (!('value' in own[key]) || typeof own[key].value !== 'function')
    )
  )
    throw new ExecutionStoreError('transition-failed');
  const captured = Object.fromEntries(
    methods.map(key => [
      key,
      own[key]?.value ??
        Object.getOwnPropertyDescriptor(PurposePersistenceStore.prototype, key)!.value,
    ])
  ) as Pick<PurposePersistenceStore, (typeof methods)[number]>;
  const read = captured.read.bind(input),
    claim = captured.claimDispatch.bind(input),
    consume = captured.consumeDispatch.bind(input),
    mark = captured.markExecutionUnknown.bind(input),
    receipts = captured.recordProducerReceipts.bind(input);
  return createExecutionStorePort({
    read: id => nativeResult(() => read(id)),
    claimDispatch: (id, revision) => nativeResult(() => claim(id, revision)),
    consumeDispatch: async (token, operation, begin) => {
      let entered = false;
      try {
        return await consume(token as PurposeDispatchToken, operation, () => {
          entered = true;
          return begin();
        });
      } catch (error) {
        if (entered) throw error;
        throw new ExecutionStoreError(
          error instanceof PurposePersistenceError ? error.code : 'write-failed'
        );
      }
    },
    markExecutionUnknown: (id, revision, reason) => nativeResult(() => mark(id, revision, reason)),
    recordProducerReceipts: (id, revision, evidence) =>
      nativeResult(() => receipts(id, revision, evidence)),
  });
}
export type ExecutionStoreInput = ExecutionStorePort | PurposePersistenceStore;
export function executionStoreFailure(error: unknown): {
  readonly state: 'failed' | 'outcome-unknown';
  readonly code: ExecutionStoreCode;
} {
  const code = error instanceof ExecutionStoreError ? error.code : 'write-failed';
  return {
    state:
      code === 'transaction-outcome-unknown' || code === 'open-outcome-unknown'
        ? 'outcome-unknown'
        : 'failed',
    code,
  };
}
