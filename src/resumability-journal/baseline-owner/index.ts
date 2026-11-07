/** Unwired durable owner. Execution authority is operation-bound and session-local. */
import { MAX_CATALOG_BYTES, type CatalogSha256 } from '../../archive/catalog/admission';
import {
  createBaselinePlan,
  createBaselineCheckpoint,
  reduceBaselineCheckpoint,
  nextBaselineDecision,
  type BaselinePlanRequest,
  type CheckpointCommand,
  type PlanDependencies,
  type PlanItem,
} from '../baseline-plan';
import {
  canonical,
  detach,
  exact,
  hashDependency,
  identifier,
  integer,
} from '../baseline-plan/data';
import { admitNewCaptureOperation, type NewCaptureOperation } from '../purpose';
import {
  createExecutionStorePort,
  type ExecutionStorePort,
  type ExecutionDispatchToken,
} from '../execution-coordinator/store-port';
import {
  snapshotIdentity,
  boundRecord,
  observeRecord,
  evidenceRecord,
  ownerResult,
  ownerFailure,
} from './execution';
import { prepareChatGptNewCapture } from '../capture-handoff';
import {
  RECORD_SCHEMA,
  snapshotRecord,
  snapshotReceipts,
  revise,
  type ExecutionInterruptionReason,
  type OperationRecord,
} from '../purpose-persistence-v2/core/record';
import {
  controlRecord,
  interruptExecution,
  encodeWithControlHeadroom,
} from '../purpose-persistence-v2/core/control';
import {
  closeConnection,
  databaseDependencies,
  openDatabase,
  OWNER_KEY,
  type OwnerConnection,
  type OwnerStoreOptions,
} from './database';
import { ownerTransaction, type OwnerTransactionRunner } from './transaction';
import { scan, assertUnchanged } from './inventory';
import {
  assertHeadroom,
  assertExecutionHeadroom,
  copyBytes,
  encodeOwner,
  sameBytes,
  validateInventory,
  type Inventory,
  type ValidatedOwner,
} from './envelope';
import { OwnerStorageError, requireOwner } from './errors';

export { OwnerStorageError } from './errors';
export {
  OWNER_DATABASE_NAME,
  OWNER_DATABASE_VERSION,
  OWNER_KEY,
  OWNER_STORE_NAME,
  OPERATIONS_STORE_NAME,
} from './database';
export type { OwnerTimers, OwnerStoreOptions } from './database';
export interface BaselineOwnerOptions extends OwnerStoreOptions {
  readonly sha256: CatalogSha256;
}
export interface ReservationIds {
  readonly operationId: string;
  readonly attemptId: string;
  readonly captureId: string;
}
export type OwnerControl =
  | { readonly kind: 'activate' | 'pause' | 'clear-cooldown'; readonly now: number }
  | { readonly kind: 'set-cooldown'; readonly now: number; readonly until: number }
  | { readonly kind: 'roll-budget-window'; readonly now: number; readonly windowId: string };
export interface ReservationIdentity extends ReservationIds {
  readonly planSha256: string;
  readonly item: PlanItem;
}
export interface OwnerSnapshot {
  readonly executionAuthorized: false;
  readonly plan: ValidatedOwner['plan'];
  readonly checkpoint: ValidatedOwner['checkpoint'];
  readonly operations: readonly OperationRecord[];
  readonly ownerBytes: Uint8Array;
}
type DispatchSession = WeakMap<
  object,
  { identity: string; raw: Inventory; record: OperationRecord }
>;
function idsSnapshot(input: ReservationIds): ReservationIds {
  const fields = exact(detach(input), ['operationId', 'attemptId', 'captureId']);
  return {
    operationId: identifier(fields.operationId),
    attemptId: identifier(fields.attemptId),
    captureId: identifier(fields.captureId),
  };
}
function output(owner: ValidatedOwner): OwnerSnapshot {
  return Object.freeze({
    executionAuthorized: false,
    plan: owner.plan,
    checkpoint: owner.checkpoint,
    operations: Object.freeze(
      [...owner.operations].sort((left, right) =>
        left.operation.operationId < right.operation.operationId
          ? -1
          : left.operation.operationId > right.operation.operationId
            ? 1
            : 0
      )
    ),
    ownerBytes: encodeOwner(owner),
  });
}
function selected(owner: ValidatedOwner | undefined, expectedRevision: number): ValidatedOwner {
  requireOwner(owner, 'owner-not-found');
  requireOwner(integer(expectedRevision) === owner.checkpoint.revision, 'revision-conflict');
  return owner;
}

export class BaselineOwner {
  readonly #dependencies;
  readonly #sha256: CatalogSha256;
  #connection?: OwnerConnection;
  #opening?: Promise<void>;
  #cancelOpen?: () => void;
  #closed = false;
  #recovered = false;
  #dispatchEnabled = false;
  #tokens: DispatchSession = new WeakMap();

  #invalidate(): void {
    this.#tokens = new WeakMap();
    this.#dispatchEnabled = false;
  }
  #dispatchReady(session: DispatchSession): void {
    this.#sessionCurrent(session);
    requireOwner(this.#dispatchEnabled, 'candidate-unavailable');
  }
  #sessionCurrent(session: DispatchSession, recovery = false): void {
    if (!recovery) this.#mutationReady();
    requireOwner(!this.#closed, 'closed');
    requireOwner(!this.#connection?.mutationUnknown, 'transaction-outcome-unknown');
    if (this.#connection?.failure) throw this.#connection.failure;
    requireOwner(this.#tokens === session, 'invalid-input');
  }

  constructor(input: BaselineOwnerOptions) {
    const options = exact(
      input,
      ['sha256'],
      ['indexedDB', 'databaseName', 'openTimeoutMs', 'transactionTimeoutMs', 'timers']
    );
    requireOwner(typeof options.sha256 === 'function', 'invalid-input');
    this.#sha256 = options.sha256 as CatalogSha256;
    this.#dependencies = databaseDependencies(options as OwnerStoreOptions);
  }
  open(): Promise<void> {
    if (this.#closed) return Promise.reject(new OwnerStorageError('closed'));
    if (this.#connection)
      return this.#connection.failure
        ? Promise.reject(this.#connection.failure)
        : Promise.resolve();
    this.#opening ??= openDatabase(this.#dependencies, cancel => {
      this.#cancelOpen = cancel;
    }).then(connection => {
      if (this.#closed) {
        closeConnection(connection, 'closed');
        throw new OwnerStorageError('closed');
      }
      this.#connection = connection;
      connection.invalidate = () => this.#invalidate();
    });
    return this.#opening;
  }
  close(): void {
    this.#invalidate();
    this.#closed = true;
    this.#recovered = false;
    this.#cancelOpen?.();
    if (this.#connection) closeConnection(this.#connection, 'closed');
  }
  readonly #run: OwnerTransactionRunner = (mode, action) => {
    if (this.#closed) return Promise.reject(new OwnerStorageError('closed'));
    if (!this.#connection) return Promise.reject(new OwnerStorageError('not-open'));
    return ownerTransaction(this.#connection, this.#dependencies, mode, action);
  };
  #hash(signal: AbortSignal): PlanDependencies {
    const hash = hashDependency({ sha256: this.#sha256, signal });
    return { sha256: bytes => hash(bytes), signal };
  }
  async #snapshot(dependencies: PlanDependencies) {
    const raw = await this.#run<Inventory>('readonly', context => scan(context, context.finish));
    return { raw, owner: await validateInventory(raw, dependencies) };
  }
  #mutationReady(): void {
    requireOwner(!this.#closed, 'closed');
    requireOwner(this.#recovered, 'recovery-required');
    requireOwner(!this.#connection?.mutationUnknown, 'transaction-outcome-unknown');
  }
  async #commit(
    raw: Inventory,
    owner: ValidatedOwner,
    signal: AbortSignal,
    change?: { readonly record: OperationRecord; readonly insert: boolean },
    session?: DispatchSession,
    recovery = false
  ): Promise<OwnerSnapshot> {
    const bytes = encodeOwner(owner);
    const recordBytes = change && encodeWithControlHeadroom(change.record);
    assertExecutionHeadroom(owner);
    const result = output(owner);
    return this.#run<OwnerSnapshot>('readwrite', context =>
      scan(context, actual => {
        assertUnchanged(raw, actual);
        if (session) this.#sessionCurrent(session, recovery);
        requireOwner(!signal.aborted, 'invalid-input');
        if (change && recordBytes)
          context.request(
            change.insert
              ? context.operations.add(recordBytes, change.record.operation.operationId)
              : context.operations.put(recordBytes, change.record.operation.operationId),
            () => {}
          );
        context.request(
          raw.owner.length
            ? context.owner.put(bytes, OWNER_KEY)
            : context.owner.add(bytes, OWNER_KEY),
          () => {}
        );
        context.finish(result);
      })
    );
  }
  async create(
    catalogInput: Uint8Array,
    requestInput: BaselinePlanRequest,
    optionsInput: {
      readonly now: number;
      readonly windowId: string;
      readonly maxReservationSlots: number;
    },
    signal: AbortSignal
  ): Promise<OwnerSnapshot> {
    const catalogBytes = copyBytes(catalogInput, MAX_CATALOG_BYTES);
    const request = detach(requestInput) as unknown as BaselinePlanRequest;
    const options = exact(detach(optionsInput), ['now', 'windowId', 'maxReservationSlots']) as {
      now: number;
      windowId: string;
      maxReservationSlots: number;
    };
    const dependencies = this.#hash(signal);
    const { raw, owner } = await this.#snapshot(dependencies);
    requireOwner(!owner, 'owner-exists');
    const plan = await createBaselinePlan(catalogBytes, request, dependencies);
    const checkpoint = await createBaselineCheckpoint(plan, options, dependencies);
    assertHeadroom(checkpoint);
    const result = await this.#commit(
      raw,
      { plan, checkpoint, catalogBytes, operations: [] },
      signal
    );
    this.#recovered = !this.#closed && !this.#connection?.failure;
    return result;
  }
  async readSnapshot(): Promise<OwnerSnapshot | undefined> {
    const { owner } = await this.#snapshot(this.#hash(new AbortController().signal));
    return owner && output(owner);
  }
  async applyControl(expectedRevision: number, commandInput: OwnerControl): Promise<OwnerSnapshot> {
    this.#mutationReady();
    const command = detach(commandInput);
    const fields = exact(command, ['kind', 'now'], ['until', 'windowId']);
    if (fields.kind === 'pause') this.#invalidate();
    const session = this.#tokens;
    requireOwner(
      ['activate', 'pause', 'clear-cooldown', 'set-cooldown', 'roll-budget-window'].includes(
        fields.kind as string
      ),
      'invalid-input'
    );
    integer(expectedRevision);
    const dependencies = this.#hash(new AbortController().signal);
    const { raw, owner } = await this.#snapshot(dependencies);
    const current = selected(owner, expectedRevision);
    const checkpoint = await reduceBaselineCheckpoint(
      current.plan,
      current.checkpoint,
      { ...fields, expectedRevision } as CheckpointCommand,
      dependencies
    );
    assertHeadroom(checkpoint);
    let updated = { ...current, checkpoint };
    const inflight = current.operations.filter(record => record.phase === 'in-flight');
    requireOwner(inflight.length <= 1, 'corrupt-owner');
    const record =
      fields.kind === 'pause' && inflight[0] ? controlRecord(inflight[0], 'pause') : undefined;
    if (record) {
      updated = await observeRecord(updated, record, integer(fields.now), dependencies);
    }
    this.#mutationReady();
    const result = await this.#commit(
      raw,
      updated,
      dependencies.signal,
      record && { record, insert: false },
      session
    );
    if (
      fields.kind === 'activate' &&
      session === this.#tokens &&
      !this.#closed &&
      !this.#connection?.failure
    )
      this.#dispatchEnabled = true;
    return result;
  }
  // eslint-disable-next-line max-lines-per-function -- One explicit snapshot/decision/preparation/reduction/CAS protocol; no callback or effect capability crosses it.
  async reserveNextChatGpt(
    expectedRevision: number,
    catalogInput: Uint8Array,
    idsInput: ReservationIds,
    now: number,
    signal: AbortSignal
  ) {
    this.#mutationReady();
    const session = this.#tokens;
    integer(expectedRevision);
    integer(now);
    const catalogBytes = copyBytes(catalogInput, MAX_CATALOG_BYTES);
    const ids = idsSnapshot(idsInput);
    const dependencies = this.#hash(signal);
    const { raw, owner } = await this.#snapshot(dependencies);
    const current = selected(owner, expectedRevision);
    requireOwner(sameBytes(catalogBytes, current.catalogBytes), 'catalog-mismatch');
    for (const record of current.operations)
      for (const field of ['operationId', 'attemptId', 'captureId'] as const)
        requireOwner(record.operation[field] !== ids[field], 'identity-exists');
    const decision = await nextBaselineDecision(
      current.plan,
      current.checkpoint,
      current.operations,
      now,
      dependencies
    );
    requireOwner(decision.kind === 'candidate', 'candidate-unavailable');
    requireOwner(decision.item.provider === 'chatgpt', 'unsupported-provider');
    const { provider, conversationId, conversationKey } = decision.item;
    const prepared = await prepareChatGptNewCapture(
      catalogBytes,
      {
        ...ids,
        selection: { provider, conversationId, conversationKey },
        requiredDestinations: current.plan.plan.destinations.map(item => item.destination),
      },
      dependencies
    );
    const record = snapshotRecord({
      schema: RECORD_SCHEMA,
      revision: 0,
      operation: prepared.operation,
      phase: 'reserved',
      control: 'active',
      disposition: 'open',
    });
    const checkpoint = await reduceBaselineCheckpoint(
      current.plan,
      current.checkpoint,
      {
        kind: 'observe-operation',
        expectedRevision,
        now,
        itemOrdinal: decision.item.ordinal,
        record,
      },
      dependencies
    );
    assertHeadroom(checkpoint);
    this.#mutationReady();
    const committed = await this.#commit(
      raw,
      { ...current, checkpoint, operations: Object.freeze([...current.operations, record]) },
      signal,
      { record, insert: true },
      session
    );
    return Object.freeze({
      executionAuthorized: false as const,
      snapshot: committed,
      item: decision.item,
      record,
      prepared,
    });
  }
  async recoverAfterRestart(
    expectedRevision: number,
    now: number,
    signal: AbortSignal
  ): Promise<OwnerSnapshot> {
    this.#invalidate();
    this.#recovered = false;
    const session = this.#tokens;
    integer(expectedRevision);
    integer(now);
    const dependencies = this.#hash(signal);
    const { raw, owner } = await this.#snapshot(dependencies);
    const current = selected(owner, expectedRevision);
    requireOwner(now >= current.checkpoint.observedAt, 'invalid-input');
    const inflight = current.operations.filter(record => record.phase === 'in-flight');
    requireOwner(inflight.length <= 1, 'corrupt-owner');
    // Already-paused facts need session recovery, not another durable transition. Preserve
    // the remaining revision for late evidence while still performing the full fenced CAS.
    const preserve = current.checkpoint.control === 'paused' && inflight.length === 0;
    const checkpoint = preserve
      ? current.checkpoint
      : await reduceBaselineCheckpoint(
          current.plan,
          current.checkpoint,
          { kind: 'recover-after-restart', expectedRevision, now },
          dependencies
        );
    assertHeadroom(checkpoint);
    const record = inflight[0] && controlRecord(inflight[0], 'restart');
    const updated = record
      ? await observeRecord({ ...current, checkpoint }, record, now, dependencies)
      : { ...current, checkpoint };
    requireOwner(session === this.#tokens, 'invalid-input');
    const result = await this.#commit(
      raw,
      updated,
      signal,
      record && { record, insert: false },
      session,
      true
    );
    this.#recovered = session === this.#tokens && !this.#closed && !this.#connection?.failure;
    return result;
  }
  /** Bind one full immutable reservation, plus an explicit monotonic clock capability. */
  async createExecutionPort(
    input: ReservationIdentity,
    clockInput: { readonly now: () => number }
  ): Promise<ExecutionStorePort> {
    this.#mutationReady();
    const identity = snapshotIdentity(input);
    const clock = exact(clockInput, ['now']).now;
    requireOwner(typeof clock === 'function', 'invalid-input');
    let last = -1;
    const now = () => {
      const value = (clock as () => number)();
      if (!Number.isSafeInteger(value) || value < 0 || value < last) {
        this.#invalidate();
        throw new OwnerStorageError('invalid-input');
      }
      last = value;
      return value;
    };
    const time = now(),
      session = this.#tokens;
    const { owner } = await this.#snapshot(this.#hash(new AbortController().signal));
    boundRecord(owner, identity);
    requireOwner(time >= owner!.checkpoint.observedAt, 'invalid-input');
    this.#sessionCurrent(session);
    return createExecutionStorePort({
      read: id =>
        ownerResult(async () => {
          const { owner } = await this.#snapshot(this.#hash(new AbortController().signal));
          return boundRecord(owner, identity, id);
        }),
      claimDispatch: (id, revision) =>
        ownerResult(() => this.#claim(identity, id, revision, now())),
      consumeDispatch: (token, operation, begin) =>
        this.#consume(token, identity, operation, begin),
      markExecutionUnknown: (id, revision, reason) =>
        ownerResult(() => this.#mark(identity, id, revision, reason, now())),
      recordProducerReceipts: (id, revision, receipts) =>
        ownerResult(() => this.#evidence(identity, id, revision, receipts, now())),
    });
  }
  async #claim(identity: ReservationIdentity, id: string, revision: number, now: number) {
    this.#mutationReady();
    integer(revision);
    const session = this.#tokens,
      dependencies = this.#hash(new AbortController().signal);
    this.#dispatchReady(session);
    const { raw, owner } = await this.#snapshot(dependencies);
    const original = boundRecord(owner, identity, id, revision);
    requireOwner(
      owner!.checkpoint.control === 'active' &&
        original.phase === 'reserved' &&
        original.control === 'active' &&
        original.disposition === 'open' &&
        !owner!.operations.some(
          record =>
            record !== original && ['reserved', 'in-flight', 'unknown'].includes(record.phase)
        ),
      'candidate-unavailable'
    );
    const record = revise(original, { phase: 'in-flight' });
    const updated = await observeRecord(owner!, record, now, dependencies);
    await this.#commit(raw, updated, dependencies.signal, { record, insert: false }, session);
    this.#dispatchReady(session);
    const token = Object.freeze(Object.create(null)) as ExecutionDispatchToken;
    // Exact committed inventory, including checkpoint, not just an operation revision.
    const committed: Inventory = {
      owner: [{ key: OWNER_KEY, bytes: encodeOwner(updated) }],
      operations: raw.operations.map(entry =>
        entry.key === id ? { key: id, bytes: encodeWithControlHeadroom(record) } : entry
      ),
    };
    session.set(token, { identity: canonical(identity), raw: committed, record });
    return Object.freeze({ record, token });
  }
  async #consume<T>(
    token: ExecutionDispatchToken,
    identity: ReservationIdentity,
    input: NewCaptureOperation,
    begin: () => T | Promise<T>
  ): Promise<T> {
    // At most one invocation per capability, not exactly-once external effects. Another
    // handle may commit after our terminal transaction and before the provider starts.
    const session = this.#tokens;
    const expected = token && typeof token === 'object' ? session.get(token) : undefined;
    if (token && typeof token === 'object') session.delete(token);
    // Keep callback errors outside the storage error mapper; the coordinator owns effect failures.
    await ownerResult(async () => {
      this.#dispatchReady(session);
      requireOwner(
        expected && expected.identity === canonical(identity) && typeof begin === 'function',
        'invalid-input'
      );
      const operation = admitNewCaptureOperation(input);
      requireOwner(canonical(operation) === canonical(expected.record.operation), 'invalid-input');
      const { raw, owner } = await this.#snapshot(this.#hash(new AbortController().signal));
      boundRecord(owner, identity);
      assertUnchanged(expected.raw, raw);
      await this.#run<void>('readwrite', context =>
        scan(context, actual => {
          this.#dispatchReady(session);
          assertUnchanged(raw, actual);
          context.finish(undefined);
        })
      );
    });
    // Same continuation: no caller code or await between this fence and effect start.
    try {
      this.#dispatchReady(session);
    } catch (error) {
      ownerFailure(error);
    }
    return begin();
  }
  async #mark(
    identity: ReservationIdentity,
    id: string,
    revision: number,
    reason: ExecutionInterruptionReason,
    now: number
  ): Promise<OperationRecord> {
    this.#invalidate();
    this.#mutationReady();
    integer(revision);
    const session = this.#tokens,
      dependencies = this.#hash(new AbortController().signal);
    const { raw, owner } = await this.#snapshot(dependencies);
    const record = interruptExecution(boundRecord(owner, identity, id, revision), reason);
    const checkpoint = await reduceBaselineCheckpoint(
      owner!.plan,
      owner!.checkpoint,
      {
        kind: 'pause',
        expectedRevision: owner!.checkpoint.revision,
        now,
      },
      dependencies
    );
    const updated = await observeRecord({ ...owner!, checkpoint }, record, now, dependencies);
    await this.#commit(raw, updated, dependencies.signal, { record, insert: false }, session);
    return record;
  }
  async #evidence(
    identity: ReservationIdentity,
    id: string,
    revision: number,
    receipts: unknown,
    now: number
  ): Promise<OperationRecord> {
    this.#mutationReady();
    integer(revision);
    const accepted = snapshotReceipts(receipts);
    const session = this.#tokens,
      dependencies = this.#hash(new AbortController().signal);
    const { raw, owner } = await this.#snapshot(dependencies);
    const record = await evidenceRecord(
      boundRecord(owner, identity, id, revision),
      accepted,
      dependencies
    );
    const updated = await observeRecord(owner!, record, now, dependencies);
    await this.#commit(raw, updated, dependencies.signal, { record, insert: false }, session);
    return record;
  }
  async inspectReservation(input: ReservationIdentity) {
    const fields = exact(detach(input), [
      'operationId',
      'attemptId',
      'captureId',
      'planSha256',
      'item',
    ]);
    const ids = idsSnapshot({
      operationId: fields.operationId as string,
      attemptId: fields.attemptId as string,
      captureId: fields.captureId as string,
    });
    const item = exact(fields.item, ['ordinal', 'provider', 'conversationId', 'conversationKey']);
    const { owner } = await this.#snapshot(this.#hash(new AbortController().signal));
    requireOwner(owner && owner.plan.planSha256 === fields.planSha256, 'corrupt-owner');
    const expected = owner.plan.plan.items[integer(item.ordinal)];
    requireOwner(
      expected && Object.keys(item).every(key => item[key] === expected[key as keyof PlanItem]),
      'invalid-input'
    );
    const record = owner.operations.find(
      record =>
        record.operation.operationId === ids.operationId ||
        record.operation.attemptId === ids.attemptId ||
        record.operation.captureId === ids.captureId
    );
    if (!record)
      return Object.freeze({ executionAuthorized: false as const, kind: 'not-observed' as const });
    requireOwner(
      Object.keys(ids).every(
        key => ids[key as keyof ReservationIds] === record.operation[key as keyof ReservationIds]
      ) &&
        record.operation.admission.provider === expected.provider &&
        record.operation.admission.conversationId === expected.conversationId &&
        record.operation.admission.conversationKey === expected.conversationKey,
      'corrupt-owner'
    );
    return Object.freeze({
      executionAuthorized: false as const,
      kind: 'committed' as const,
      record,
      item: expected,
    });
  }
}
export function createBaselineOwner(options: BaselineOwnerOptions): BaselineOwner {
  return new BaselineOwner(options);
}
