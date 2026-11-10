/** Bound journal/3 execution surface. Reservation, control and transaction authority stay private. */
import type {
  ClosedCaptureOperation,
  ExecutionInterruptionReason,
  OperationRecord,
} from '../purpose-persistence-v3/core/record';
import { PurposePersistenceError } from '../purpose-persistence-v3/core/errors';
import { ProviderOwnerStorageError } from './errors';

export type ProviderExecutionPortCode =
  | 'unavailable'
  | 'not-open'
  | 'closed'
  | 'version-changed'
  | 'unsupported-version'
  | 'invalid-schema'
  | 'open-blocked'
  | 'open-failed'
  | 'open-timeout'
  | 'open-outcome-unknown'
  | 'transaction-aborted'
  | 'transaction-timeout'
  | 'transaction-outcome-unknown'
  | 'read-failed'
  | 'write-failed'
  | 'quota-exceeded'
  | 'corrupt-record'
  | 'record-too-large'
  | 'operation-not-found'
  | 'revision-conflict'
  | 'transition-failed'
  | 'invalid-receipts'
  | 'recovery-required'
  | 'candidate-unavailable'
  | 'headroom-exhausted';

const executionCodes: readonly ProviderExecutionPortCode[] = [
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
  'operation-not-found',
  'revision-conflict',
  'transition-failed',
  'invalid-receipts',
  'recovery-required',
  'candidate-unavailable',
  'headroom-exhausted',
];

/** Fixed codes only; native errors and private exception text never cross the execution port. */
export class ProviderExecutionPortError extends Error {
  readonly code: ProviderExecutionPortCode;
  constructor(code: ProviderExecutionPortCode) {
    const fixed = executionCodes.includes(code) ? code : 'write-failed';
    super(fixed);
    this.code = fixed;
    this.name = 'ProviderExecutionPortError';
    Object.freeze(this);
  }
}

/** Identity only. Copying or reconstructing an object never carries dispatch authority. */
export type ProviderDispatchToken = object;

export type ProviderDispatchClaim =
  | {
      readonly record: OperationRecord;
      readonly dispatch: 'available';
      readonly token: ProviderDispatchToken;
    }
  | { readonly record: OperationRecord; readonly dispatch: 'revoked' };

export interface ProviderExecutionPort {
  read(): Promise<OperationRecord>;
  claimDispatch(expectedRevision: number): Promise<ProviderDispatchClaim>;
  consumeDispatch<Output>(
    token: ProviderDispatchToken,
    operation: ClosedCaptureOperation,
    beginEffect: (operation: ClosedCaptureOperation) => Output | Promise<Output>
  ): Promise<Output>;
  markExecutionUnknown(
    expectedRevision: number,
    reason: ExecutionInterruptionReason
  ): Promise<OperationRecord>;
  recordProducerReceipts(expectedRevision: number, receipts: unknown): Promise<OperationRecord>;
}

const methods = [
  'read',
  'claimDispatch',
  'consumeDispatch',
  'markExecutionUnknown',
  'recordProducerReceipts',
] as const;
const ports = new WeakSet<object>();

export function createProviderExecutionPort(input: ProviderExecutionPort): ProviderExecutionPort {
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== methods.length ||
    methods.some(
      key =>
        !descriptors[key] ||
        !('value' in descriptors[key]) ||
        typeof descriptors[key].value !== 'function'
    )
  )
    throw new ProviderExecutionPortError('transition-failed');
  const port = Object.freeze(
    Object.fromEntries(methods.map(key => [key, descriptors[key].value]))
  ) as unknown as ProviderExecutionPort;
  ports.add(port);
  return port;
}

export function isProviderExecutionPort(input: unknown): input is ProviderExecutionPort {
  return !!input && typeof input === 'object' && ports.has(input);
}

/** Closed mapping deliberately collapses owner-only validation details. */
export function providerExecutionFailure(error: unknown): never {
  if (error instanceof ProviderExecutionPortError) throw error;
  if (error instanceof PurposePersistenceError) throw new ProviderExecutionPortError(error.code);
  if (error instanceof ProviderOwnerStorageError) {
    if (executionCodes.includes(error.code as ProviderExecutionPortCode))
      throw new ProviderExecutionPortError(error.code as ProviderExecutionPortCode);
    if (error.code === 'owner-not-found')
      throw new ProviderExecutionPortError('operation-not-found');
    if (error.code === 'corrupt-owner') throw new ProviderExecutionPortError('corrupt-record');
    throw new ProviderExecutionPortError('transition-failed');
  }
  throw new ProviderExecutionPortError('write-failed');
}

export async function providerExecutionResult<Output>(run: () => Promise<Output>): Promise<Output> {
  try {
    return await run();
  } catch (error) {
    return providerExecutionFailure(error);
  }
}
