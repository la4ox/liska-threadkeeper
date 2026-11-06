import { prepareChatGptNewCapture } from '../../capture-handoff';
import { admitNewCaptureOperation, type NewCaptureOperation } from '../../purpose';
import { adaptChatGptProducerEvidence, type ProducerSha256 } from '../../producer-adapter';
import { canonical, freeze, MAX_RECORDS } from '../core/data';
import { controlRecord, encodeWithControlHeadroom, interruptExecution } from '../core/control';
import { PurposePersistenceError, requireCondition } from '../core/errors';
import {
  ADAPTER_VERSION,
  RECORD_SCHEMA,
  revise,
  snapshotRecord,
  snapshotReceipts,
  type OperationRecord,
  type ExecutionInterruptionReason,
} from '../core/record';
import {
  closeConnection,
  databaseDependencies,
  openDatabase,
  type JournalConnection,
  type JournalStoreOptions,
} from './database';
import { journalTransaction, type JournalTransactionRunner } from './transaction';
import { assertUnchanged, scan, selected, validatedSnapshot, type StoredRecord } from './records';

export { PurposePersistenceError } from '../core/errors';
export { RECORD_SCHEMA, ADAPTER_VERSION } from '../core/record';
export type { OperationRecord, Observation, ExecutionInterruptionReason } from '../core/record';
export { JOURNAL_DATABASE_NAME, JOURNAL_DATABASE_VERSION, JOURNAL_STORE_NAME } from './database';
export type { JournalTimers, JournalStoreOptions } from './database';

declare const tokenBrand: unique symbol;
/** Opaque session capability. Serialized or reconstructed objects cannot authorize dispatch. */
export interface PurposeDispatchToken {
  readonly [tokenBrand]: true;
}
export interface PurposeStoreOptions extends JournalStoreOptions {
  readonly sha256: ProducerSha256;
}
type Prepare = typeof prepareChatGptNewCapture;

/**
 * Unwired browser-local bookkeeping, not permanent storage or exactly-once provider execution.
 * All read replay occurs outside IDB; writes CAS the complete validated bounded snapshot.
 * A concurrent unrelated mutation may conservatively fail CAS; never automatically retried.
 * close() is terminal for this handle. Reopen with a fresh store handle/session; pending
 * preparation or hash continuations can never enter a later session on this object.
 */
export class PurposePersistenceStore {
  readonly #dependencies;
  readonly #sha256: ProducerSha256;
  #connection?: JournalConnection;
  #opening?: Promise<void>;
  #cancelOpen?: () => void;
  #closed = false;
  #tokens = new WeakMap<object, string>();
  #fences = new Map<string, number>();

  constructor(options: PurposeStoreOptions) {
    this.#dependencies = databaseDependencies(options);
    this.#sha256 = options.sha256;
    requireCondition(typeof this.#sha256 === 'function', 'open-failed');
  }

  /** Opening creates/validates only the separate schema. Recovery is always explicit. */
  open(): Promise<void> {
    if (this.#closed) return Promise.reject(new PurposePersistenceError('closed'));
    if (this.#connection)
      return this.#connection.failure
        ? Promise.reject(this.#connection.failure)
        : Promise.resolve();
    this.#opening ??= openDatabase(this.#dependencies, cancel => {
      this.#cancelOpen = cancel;
    }).then(connection => {
      if (this.#closed) {
        closeConnection(connection, 'closed');
        throw new PurposePersistenceError('closed');
      }
      this.#connection = connection;
    });
    return this.#opening;
  }

  close(): void {
    this.#closed = true;
    this.#tokens = new WeakMap();
    this.#cancelOpen?.();
    if (this.#connection) closeConnection(this.#connection, 'closed');
  }

  readonly #run: JournalTransactionRunner = (mode, action) => {
    if (this.#closed) return Promise.reject(new PurposePersistenceError('closed'));
    if (!this.#connection) return Promise.reject(new PurposePersistenceError('not-open'));
    return journalTransaction(this.#connection, this.#dependencies, mode, action);
  };

  #snapshot(): Promise<StoredRecord[]> {
    return validatedSnapshot(this.#run, this.#sha256);
  }

  async list(): Promise<readonly OperationRecord[]> {
    return freeze((await this.#snapshot()).map(item => item.record));
  }

  async read(operationId: string): Promise<OperationRecord | undefined> {
    return (await this.#snapshot()).find(item => item.key === operationId)?.record;
  }

  #commit<Output>(
    before: readonly StoredRecord[],
    action: (
      records: StoredRecord[],
      put: (record: OperationRecord, insert?: boolean) => void
    ) => Output
  ): Promise<Output> {
    return this.#run<Output>('readwrite', context =>
      scan(context, records => {
        assertUnchanged(before, records);
        const output = action(records, (record, insert = false) => {
          const bytes = encodeWithControlHeadroom(record);
          context.request(
            insert
              ? context.store.add(bytes, record.operation.operationId)
              : context.store.put(bytes, record.operation.operationId),
            () => {}
          );
        });
        context.finish(output);
      })
    );
  }

  async reserveChatGpt(
    catalogBytes: Parameters<Prepare>[0],
    request: Parameters<Prepare>[1],
    dependencies: { readonly signal: AbortSignal }
  ) {
    const fields = Object.getOwnPropertyDescriptors(dependencies);
    requireCondition(
      arguments.length === 3 &&
        Reflect.ownKeys(dependencies).length === 1 &&
        fields.signal &&
        'value' in fields.signal,
      'transition-failed'
    );
    const signal = fields.signal.value as AbortSignal;
    const prepared = await prepareChatGptNewCapture(catalogBytes, request, {
      sha256: async bytes => this.#sha256(bytes),
      signal,
    });
    const before = await this.#snapshot();
    const record = await this.#commit(before, (records, put) => {
      requireCondition(!signal.aborted, 'transition-failed');
      requireCondition(records.length < MAX_RECORDS, 'record-limit');
      for (const { record } of records)
        for (const field of ['operationId', 'attemptId', 'captureId'] as const)
          requireCondition(
            record.operation[field] !== prepared.operation[field],
            'identity-exists'
          );
      const reserved = snapshotRecord({
        schema: RECORD_SCHEMA,
        revision: 0,
        operation: prepared.operation,
        phase: 'reserved',
        control: 'active',
        disposition: 'open',
      });
      put(reserved, true);
      return reserved;
    });
    return Object.freeze({ record, prepared });
  }

  async #change(
    operationId: string,
    revision: number,
    transform: (record: OperationRecord) => OperationRecord
  ): Promise<OperationRecord> {
    const before = await this.#snapshot();
    return this.#commit(before, (records, put) => {
      const record = selected(records, operationId, revision);
      requireCondition(record.disposition === 'open', 'transition-failed');
      const updated = transform(record);
      put(updated);
      return updated;
    });
  }

  async claimDispatch(
    operationId: string,
    expectedRevision: number
  ): Promise<{ readonly record: OperationRecord; readonly token: PurposeDispatchToken }> {
    const record = await this.#change(operationId, expectedRevision, current => {
      requireCondition(
        current.phase === 'reserved' && current.control === 'active',
        'transition-failed'
      );
      return revise(current, { phase: 'in-flight' });
    });
    // A terminal commit can arrive after close/versionchange: never mint a capability then.
    requireCondition(!this.#closed && !this.#connection?.failure, 'closed');
    const token = Object.freeze(Object.create(null)) as PurposeDispatchToken;
    this.#tokens.set(token, canonical(record));
    return Object.freeze({ record, token });
  }

  /** Snapshot, NOT a lock over a later provider request. Pause cannot promise to prevent every dispatch. */
  async checkCurrent(token: PurposeDispatchToken): Promise<boolean> {
    if (!token || typeof token !== 'object' || this.#closed || this.#connection?.failure)
      return false;
    const expected = this.#tokens.get(token);
    if (!expected) return false;
    const records = await this.#snapshot();
    return (
      !this.#closed &&
      !this.#connection?.failure &&
      this.#tokens.get(token) === expected &&
      records.some(
        ({ record }) =>
          record.phase === 'in-flight' &&
          record.control === 'active' &&
          record.disposition === 'open' &&
          canonical(record) === expected
      )
    );
  }

  /**
   * Burn before any await, including failed validation. The final readwrite transaction
   * serializes the exact check with other store writers, but is NOT a DB/network lock.
   * After IDB completion, the final session fence and generic effect start share one
   * synchronous continuation. No callback runs inside IDB; no durable effect flag exists.
   */
  async consumeDispatch<Output>(
    token: PurposeDispatchToken,
    exactOperation: NewCaptureOperation,
    beginEffect: () => Output | Promise<Output>
  ): Promise<Output> {
    const session = this.#tokens;
    const expected = token && typeof token === 'object' ? session.get(token) : undefined;
    if (token && typeof token === 'object') session.delete(token);
    requireCondition(expected && !this.#closed && !this.#connection?.failure, 'transition-failed');
    requireCondition(typeof beginEffect === 'function', 'transition-failed');
    const operation = admitNewCaptureOperation(exactOperation);
    const fence = this.#fences.get(operation.operationId);
    const currentSession = () =>
      !this.#closed &&
      !this.#connection?.failure &&
      this.#tokens === session &&
      this.#fences.get(operation.operationId) === fence;
    const before = await this.#snapshot();
    await this.#commit(before, records => {
      requireCondition(currentSession(), 'transition-failed');
      const record = records.find(item => item.key === operation.operationId)?.record;
      requireCondition(
        record &&
          record.phase === 'in-flight' &&
          record.control === 'active' &&
          record.disposition === 'open' &&
          canonical(record) === expected &&
          canonical(record.operation) === canonical(operation),
        'transition-failed'
      );
    });
    requireCondition(currentSession(), 'transition-failed');
    return beginEffect();
  }

  markExecutionUnknown(
    operationId: string,
    expectedRevision: number,
    reason: ExecutionInterruptionReason
  ): Promise<OperationRecord> {
    this.#fence(operationId);
    return this.#change(operationId, expectedRevision, record =>
      interruptExecution(record, reason)
    );
  }

  #fence(operationId: string): void {
    this.#fences.set(operationId, (this.#fences.get(operationId) ?? 0) + 1);
  }

  async recordProducerReceipts(
    operationId: string,
    expectedRevision: number,
    receipts: unknown
  ): Promise<OperationRecord> {
    requireCondition(arguments.length === 3, 'invalid-receipts');
    const accepted = snapshotReceipts(receipts);
    const before = await this.#snapshot();
    const original = selected(before, operationId, expectedRevision);
    requireCondition(
      original.disposition === 'open' &&
        !original.observation &&
        ['in-flight', 'unknown'].includes(original.phase),
      'transition-failed'
    );
    const adaptation = await adaptChatGptProducerEvidence(
      original.operation,
      accepted,
      this.#sha256
    );
    const observation = {
      adapterVersion: ADAPTER_VERSION,
      hashOutcome:
        adaptation.adapterCode === 'hash-failed' ? ('failed' as const) : ('available' as const),
      receipts: accepted,
      adaptation,
    };
    return this.#commit(before, (records, put) => {
      const current = selected(records, operationId, expectedRevision);
      const updated = revise(current, { phase: 'awaiting-resolution', observation });
      put(updated);
      return updated;
    });
  }

  pause(operationId: string, expectedRevision: number): Promise<OperationRecord> {
    this.#fence(operationId);
    return this.#change(operationId, expectedRevision, record => controlRecord(record, 'pause'));
  }

  abandon(operationId: string, expectedRevision: number): Promise<OperationRecord> {
    this.#fence(operationId);
    return this.#change(operationId, expectedRevision, record => controlRecord(record, 'abandon'));
  }

  async recoverAfterRestart(): Promise<readonly OperationRecord[]> {
    this.#tokens = new WeakMap();
    const before = await this.#snapshot();
    return this.#commit(before, (records, put) =>
      freeze(
        records.map(({ record }) => {
          if (record.phase !== 'in-flight') return record;
          const updated = controlRecord(record, 'restart');
          put(updated);
          return updated;
        })
      )
    );
  }
}

export function createPurposePersistenceStore(
  options: PurposeStoreOptions
): PurposePersistenceStore {
  return new PurposePersistenceStore(options);
}
