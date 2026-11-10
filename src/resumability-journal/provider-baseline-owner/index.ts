/* eslint-disable max-lines -- One private owner retains the complete session and two-store CAS protocol. */
/** Unwired durable provider owner. Dispatch is bound and session-local; provider effects stay out. */
import { MAX_CATALOG_BYTES, type CatalogSha256 } from '../../archive/catalog/admission';
import { conversationKeyInput } from '../../archive/catalog/conversation-key';
import { createBaselinePlan } from '../baseline-plan/plan';
import type { BaselinePlanRequest, PlanDependencies } from '../baseline-plan/contracts';
import {
  canonical,
  detach,
  digest,
  exact,
  hashDependency,
  identifier,
  integer,
} from '../baseline-plan/data';
import {
  createProviderBaselineCheckpoint,
  reduceProviderBaselineCheckpoint,
} from '../provider-baseline/checkpoint';
import type { ProviderCheckpointCommand } from '../provider-baseline/contracts';
import { assertProviderPlan } from '../provider-baseline/operation';
import { nextProviderBaselineDecision } from '../provider-baseline/progress';
import { admitNewCaptureOperation, OPERATION_SCHEMA, type NewCaptureOperation } from '../purpose';
import {
  RECORD_SCHEMA,
  revise,
  snapshotReceipts,
  snapshotRecord,
  type ClosedCaptureOperation,
  type ExecutionInterruptionReason,
  type OperationRecord,
} from '../purpose-persistence-v3/core/record';
import {
  controlRecord,
  encodeWithControlHeadroom,
  interruptExecution,
} from '../purpose-persistence-v3/core/control';
import {
  closeConnection,
  databaseDependencies,
  openDatabase,
  PROVIDER_OWNER_KEY,
  type ProviderOwnerConnection,
  type ProviderOwnerStoreOptions,
} from './database';
import { assertUnchanged, scan } from './inventory';
import { providerOwnerTransaction, type ProviderOwnerTransactionRunner } from './transaction';
import {
  assertProviderOwnerHeadroom,
  assertProviderExecutionHeadroom,
  copyBytes,
  encodeProviderOwner,
  sameBytes,
  validateInventory,
  type Inventory,
  type ValidatedProviderOwner,
} from './envelope';
import { ProviderOwnerStorageError, requireOwner } from './errors';
import {
  boundProviderRecord,
  observeProviderRecord,
  providerEvidenceRecord,
  snapshotProviderIdentity,
} from './execution';
import {
  createProviderExecutionPort,
  providerExecutionFailure,
  providerExecutionResult,
  type ProviderDispatchClaim,
  type ProviderDispatchToken,
  type ProviderExecutionPort,
} from './port';

export { ProviderOwnerStorageError } from './errors';
export { ProviderExecutionPortError } from './port';
export {
  PROVIDER_OWNER_DATABASE_NAME,
  PROVIDER_OWNER_DATABASE_VERSION,
  PROVIDER_OWNER_KEY,
  PROVIDER_OWNER_STORE_NAME,
  PROVIDER_OPERATIONS_STORE_NAME,
} from './database';
export type { ProviderOwnerStoreOptions, ProviderOwnerTimers } from './database';
export type {
  ProviderDispatchClaim,
  ProviderDispatchToken,
  ProviderExecutionPort,
  ProviderExecutionPortCode,
} from './port';

export interface ProviderBaselineOwnerOptions extends ProviderOwnerStoreOptions {
  readonly sha256: CatalogSha256;
}

export interface ProviderReservationIds {
  readonly operationId: string;
  readonly attemptId: string;
  readonly captureId: string;
}

export type ProviderOwnerControl =
  | { readonly kind: 'activate' | 'pause' | 'clear-cooldown'; readonly now: number }
  | { readonly kind: 'set-cooldown'; readonly now: number; readonly until: number }
  | { readonly kind: 'roll-budget-window'; readonly now: number; readonly windowId: string };

export interface ProviderReservationIdentity extends ProviderReservationIds {
  readonly planSha256: string;
  readonly item: ValidatedProviderOwner['plan']['plan']['items'][number];
}

export interface ProviderOwnerSnapshot {
  readonly executionAuthorized: false;
  readonly plan: ValidatedProviderOwner['plan'];
  readonly checkpoint: ValidatedProviderOwner['checkpoint'];
  readonly operations: readonly OperationRecord[];
  readonly ownerBytes: Uint8Array;
}

export interface ProviderReservation {
  readonly executionAuthorized: false;
  readonly snapshot: ProviderOwnerSnapshot;
  readonly item: ValidatedProviderOwner['plan']['plan']['items'][number];
  readonly record: OperationRecord;
}

export interface ProviderBaselineOwner {
  open(): Promise<void>;
  close(): void;
  create(
    catalog: Uint8Array,
    request: BaselinePlanRequest,
    options: {
      readonly now: number;
      readonly windowId: string;
      readonly maxReservationSlots: number;
    },
    signal: AbortSignal
  ): Promise<ProviderOwnerSnapshot>;
  readSnapshot(): Promise<ProviderOwnerSnapshot | undefined>;
  applyControl(
    expectedRevision: number,
    command: ProviderOwnerControl
  ): Promise<ProviderOwnerSnapshot>;
  reserveNext(
    expectedRevision: number,
    catalog: Uint8Array,
    ids: ProviderReservationIds,
    now: number,
    signal: AbortSignal
  ): Promise<ProviderReservation>;
  recoverAfterRestart(
    expectedRevision: number,
    now: number,
    signal: AbortSignal
  ): Promise<ProviderOwnerSnapshot>;
  createExecutionPort(
    identity: ProviderReservationIdentity,
    clock: { readonly now: () => number }
  ): Promise<ProviderExecutionPort>;
  inspectReservation(input: ProviderReservationIdentity): Promise<
    | { readonly executionAuthorized: false; readonly kind: 'not-observed' }
    | {
        readonly executionAuthorized: false;
        readonly kind: 'committed';
        readonly record: OperationRecord;
        readonly item: ProviderReservationIdentity['item'];
      }
  >;
}

interface ClaimedDispatch {
  readonly identity: string;
  readonly raw: Inventory;
  readonly record: OperationRecord;
}

interface DispatchSession {
  readonly tokens: WeakMap<object, ClaimedDispatch>;
}

function dispatchSession(): DispatchSession {
  return Object.freeze({ tokens: new WeakMap() });
}

function idsSnapshot(input: ProviderReservationIds): ProviderReservationIds {
  const fields = exact(detach(input), ['operationId', 'attemptId', 'captureId']);
  const result = {
    operationId: identifier(fields.operationId),
    attemptId: identifier(fields.attemptId),
    captureId: identifier(fields.captureId),
  };
  requireOwner(new Set(Object.values(result)).size === 3, 'identity-exists');
  return Object.freeze(result);
}

function output(owner: ValidatedProviderOwner): ProviderOwnerSnapshot {
  return Object.freeze({
    executionAuthorized: false as const,
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
    ownerBytes: encodeProviderOwner(owner),
  });
}

function selected(
  owner: ValidatedProviderOwner | undefined,
  expectedRevision: number
): ValidatedProviderOwner {
  requireOwner(owner, 'owner-not-found');
  requireOwner(integer(expectedRevision) === owner.checkpoint.revision, 'revision-conflict');
  return owner;
}

class ProviderBaselineOwnerImplementation implements ProviderBaselineOwner {
  readonly #dependencies;
  readonly #sha256: CatalogSha256;
  #connection?: ProviderOwnerConnection;
  #opening?: Promise<void>;
  #cancelOpen?: () => void;
  #closed = false;
  #recovered = false;
  #fenced = false;
  #dispatchEnabled = false;
  #session = dispatchSession();

  constructor(input: ProviderBaselineOwnerOptions) {
    const options = exact(
      input,
      ['sha256'],
      ['indexedDB', 'databaseName', 'openTimeoutMs', 'transactionTimeoutMs', 'timers']
    );
    requireOwner(typeof options.sha256 === 'function', 'invalid-input');
    this.#sha256 = options.sha256 as CatalogSha256;
    this.#dependencies = databaseDependencies(options as ProviderOwnerStoreOptions);
  }

  #rotateSession(): DispatchSession {
    this.#session = dispatchSession();
    this.#dispatchEnabled = false;
    return this.#session;
  }

  #fence(): void {
    this.#fenced = true;
    this.#recovered = false;
    this.#rotateSession();
  }

  #operational(): void {
    requireOwner(!this.#closed, 'closed');
    requireOwner(!this.#fenced, 'recovery-required');
    requireOwner(!this.#connection?.mutationUnknown, 'transaction-outcome-unknown');
    if (this.#connection?.failure) throw this.#connection.failure;
  }

  #mutationReady(): void {
    this.#operational();
    requireOwner(this.#recovered, 'recovery-required');
  }

  #sessionCurrent(session: DispatchSession, recovery = false): void {
    if (recovery) this.#operational();
    else this.#mutationReady();
    requireOwner(this.#session === session, 'invalid-input');
  }

  #dispatchReady(session: DispatchSession): void {
    this.#sessionCurrent(session);
    requireOwner(this.#dispatchEnabled, 'candidate-unavailable');
  }

  #dispatchAvailable(session: DispatchSession): boolean {
    return (
      session === this.#session &&
      this.#dispatchEnabled &&
      this.#recovered &&
      !this.#closed &&
      !this.#fenced &&
      !this.#connection?.failure &&
      !this.#connection?.mutationUnknown
    );
  }

  open(): Promise<void> {
    if (this.#closed) return Promise.reject(new ProviderOwnerStorageError('closed'));
    if (this.#connection)
      return this.#connection.failure
        ? Promise.reject(this.#connection.failure)
        : Promise.resolve();
    this.#opening ??= openDatabase(this.#dependencies, cancel => {
      this.#cancelOpen = cancel;
    }).then(connection => {
      if (this.#closed) {
        closeConnection(connection, 'closed');
        throw new ProviderOwnerStorageError('closed');
      }
      this.#connection = connection;
      connection.invalidate = () => {
        this.#recovered = false;
        this.#rotateSession();
      };
    });
    return this.#opening;
  }

  close(): void {
    this.#closed = true;
    this.#recovered = false;
    this.#rotateSession();
    this.#cancelOpen?.();
    if (this.#connection) closeConnection(this.#connection, 'closed');
  }

  readonly #run: ProviderOwnerTransactionRunner = (mode, action) => {
    if (this.#closed) return Promise.reject(new ProviderOwnerStorageError('closed'));
    if (!this.#connection) return Promise.reject(new ProviderOwnerStorageError('not-open'));
    return providerOwnerTransaction(this.#connection, this.#dependencies, mode, action);
  };

  #hash(signal: AbortSignal) {
    const hash = hashDependency({ sha256: this.#sha256, signal });
    return { sha256: (bytes: Uint8Array) => hash(bytes), signal };
  }

  async #snapshot(dependencies: PlanDependencies) {
    const raw = await this.#run<Inventory>('readonly', context => scan(context, context.finish));
    return { raw, owner: await validateInventory(raw, dependencies) };
  }

  async #portMutation<Output>(run: () => Promise<Output>): Promise<Output> {
    try {
      return await run();
    } catch (error) {
      this.#fence();
      throw error;
    }
  }

  async #commit(
    raw: Inventory,
    owner: ValidatedProviderOwner,
    signal: AbortSignal,
    session: DispatchSession,
    recovery: boolean,
    change?: { readonly record: OperationRecord; readonly insert: boolean }
  ): Promise<ProviderOwnerSnapshot> {
    assertProviderExecutionHeadroom(owner);
    const ownerBytes = encodeProviderOwner(owner);
    const recordBytes = change && encodeWithControlHeadroom(change.record);
    const result = output(owner);
    return this.#run<ProviderOwnerSnapshot>('readwrite', context =>
      scan(context, actual => {
        assertUnchanged(raw, actual);
        this.#sessionCurrent(session, recovery);
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
            ? context.owner.put(ownerBytes, PROVIDER_OWNER_KEY)
            : context.owner.add(ownerBytes, PROVIDER_OWNER_KEY),
          () => {}
        );
        context.finish(result);
      })
    );
  }

  // eslint-disable-next-line max-lines-per-function -- One create snapshot/hash/CAS protocol with a terminal-event result.
  async create(
    catalogInput: Uint8Array,
    requestInput: BaselinePlanRequest,
    optionsInput: {
      readonly now: number;
      readonly windowId: string;
      readonly maxReservationSlots: number;
    },
    signalInput: AbortSignal
  ): Promise<ProviderOwnerSnapshot> {
    try {
      this.#operational();
      const catalogBytes = copyBytes(catalogInput, MAX_CATALOG_BYTES);
      const request = detach(requestInput) as unknown as BaselinePlanRequest;
      const fields = exact(detach(optionsInput), ['now', 'windowId', 'maxReservationSlots']);
      const options = {
        now: integer(fields.now),
        windowId: identifier(fields.windowId),
        maxReservationSlots: integer(fields.maxReservationSlots),
      };
      const signal = signalInput;
      const dependencies = this.#hash(signal);
      const session = this.#session;
      const { raw, owner } = await this.#snapshot(dependencies);
      requireOwner(!owner, 'owner-exists');
      const plan = await createBaselinePlan(catalogBytes, request, dependencies);
      assertProviderPlan(plan);
      const checkpoint = await createProviderBaselineCheckpoint(plan, options, dependencies);
      assertProviderOwnerHeadroom(checkpoint);
      const result = await this.#commit(
        raw,
        { plan, checkpoint, catalogBytes, operations: [] },
        signal,
        session,
        true
      );
      if (
        session === this.#session &&
        !this.#closed &&
        !this.#fenced &&
        !this.#connection?.failure &&
        !this.#connection?.mutationUnknown
      )
        this.#recovered = true;
      this.#dispatchEnabled = false;
      return result;
    } catch (error) {
      this.#fence();
      throw error;
    }
  }

  async readSnapshot(): Promise<ProviderOwnerSnapshot | undefined> {
    const { owner } = await this.#snapshot(this.#hash(new AbortController().signal));
    return owner && output(owner);
  }

  // eslint-disable-next-line max-lines-per-function, complexity -- Closed control commands share one atomic checkpoint+record CAS.
  async applyControl(
    expectedRevisionInput: number,
    commandInput: ProviderOwnerControl
  ): Promise<ProviderOwnerSnapshot> {
    try {
      this.#mutationReady();
      const expectedRevision = integer(expectedRevisionInput);
      const fields = exact(detach(commandInput), ['kind', 'now'], ['until', 'windowId']);
      requireOwner(
        ['activate', 'pause', 'clear-cooldown', 'set-cooldown', 'roll-budget-window'].includes(
          fields.kind as string
        ),
        'invalid-input'
      );
      if (fields.kind === 'pause') this.#rotateSession();
      const session = this.#session;
      const dependencies = this.#hash(new AbortController().signal);
      const { raw, owner } = await this.#snapshot(dependencies);
      const current = selected(owner, expectedRevision);
      const checkpoint = await reduceProviderBaselineCheckpoint(
        current.plan,
        current.checkpoint,
        { ...fields, expectedRevision } as ProviderCheckpointCommand,
        dependencies
      );
      let updated: ValidatedProviderOwner = { ...current, checkpoint };
      const inflight = current.operations.filter(record => record.phase === 'in-flight');
      requireOwner(inflight.length <= 1, 'corrupt-owner');
      const record =
        fields.kind === 'pause' && inflight[0] ? controlRecord(inflight[0], 'pause') : undefined;
      if (record)
        updated = await observeProviderRecord(updated, record, integer(fields.now), dependencies);
      const result = await this.#commit(
        raw,
        updated,
        dependencies.signal,
        session,
        false,
        record && { record, insert: false }
      );
      if (
        fields.kind === 'activate' &&
        session === this.#session &&
        this.#recovered &&
        !this.#closed &&
        !this.#fenced &&
        !this.#connection?.failure &&
        !this.#connection?.mutationUnknown
      )
        this.#dispatchEnabled = true;
      return result;
    } catch (error) {
      this.#fence();
      throw error;
    }
  }

  // One snapshot/decision/rehash/reduction/CAS sequence; no prepared intent crosses this boundary.
  // eslint-disable-next-line max-lines-per-function
  async reserveNext(
    expectedRevisionInput: number,
    catalogInput: Uint8Array,
    idsInput: ProviderReservationIds,
    nowInput: number,
    signalInput: AbortSignal
  ): Promise<ProviderReservation> {
    try {
      this.#mutationReady();
      const expectedRevision = integer(expectedRevisionInput);
      const catalogBytes = copyBytes(catalogInput, MAX_CATALOG_BYTES);
      const ids = idsSnapshot(idsInput);
      const now = integer(nowInput);
      const signal = signalInput;
      const dependencies = this.#hash(signal);
      const session = this.#session;
      const { raw, owner } = await this.#snapshot(dependencies);
      const current = selected(owner, expectedRevision);
      requireOwner(sameBytes(catalogBytes, current.catalogBytes), 'catalog-mismatch');
      const priorIds = new Set(
        current.operations.flatMap(record => [
          record.operation.operationId,
          record.operation.attemptId,
          record.operation.captureId,
        ])
      );
      requireOwner(
        Object.values(ids).every(value => !priorIds.has(value)),
        'identity-exists'
      );
      const decision = await nextProviderBaselineDecision(
        current.plan,
        current.checkpoint,
        current.operations,
        now,
        dependencies
      );
      requireOwner(decision.kind === 'candidate', 'candidate-unavailable');
      const item = decision.item;
      requireOwner(
        item.provider === 'chatgpt' || item.provider === 'claude',
        'unsupported-provider'
      );
      const hash = hashDependency(dependencies);
      const conversationKey = `liska-conversation-key/1:${await hash(
        conversationKeyInput(item.provider, item.conversationId)
      )}`;
      requireOwner(conversationKey === item.conversationKey, 'catalog-mismatch');
      const operation: NewCaptureOperation = admitNewCaptureOperation({
        schema: OPERATION_SCHEMA,
        purpose: 'new-capture',
        ...ids,
        admission: {
          provider: item.provider,
          conversationId: item.conversationId,
          conversationKey: item.conversationKey,
        },
        sourceSelection: { catalogSha256: current.plan.plan.catalogSha256 },
        destinations: current.plan.plan.destinations,
        completenessPolicy: current.plan.plan.completenessPolicy,
      });
      const record = snapshotRecord({
        schema: RECORD_SCHEMA,
        revision: 0,
        operation,
        phase: 'reserved',
        control: 'active',
        disposition: 'open',
      });
      encodeWithControlHeadroom(record);
      const checkpoint = await reduceProviderBaselineCheckpoint(
        current.plan,
        current.checkpoint,
        {
          kind: 'observe-operation',
          expectedRevision,
          now,
          itemOrdinal: item.ordinal,
          record,
        },
        dependencies
      );
      assertProviderOwnerHeadroom(checkpoint);
      this.#sessionCurrent(session);
      const committed = await this.#commit(
        raw,
        { ...current, checkpoint, operations: Object.freeze([...current.operations, record]) },
        signal,
        session,
        false,
        { record, insert: true }
      );
      return Object.freeze({
        executionAuthorized: false as const,
        snapshot: committed,
        item,
        record,
      });
    } catch (error) {
      this.#fence();
      throw error;
    }
  }

  // eslint-disable-next-line max-lines-per-function -- Recovery revokes first, then performs one complete-inventory reconciliation CAS.
  async recoverAfterRestart(
    expectedRevisionInput: number,
    nowInput: number,
    signalInput: AbortSignal
  ): Promise<ProviderOwnerSnapshot> {
    try {
      this.#operational();
      const expectedRevision = integer(expectedRevisionInput);
      const now = integer(nowInput);
      const signal = signalInput;
      const dependencies = this.#hash(signal);
      this.#recovered = false;
      const session = this.#rotateSession();
      const { raw, owner } = await this.#snapshot(dependencies);
      const current = selected(owner, expectedRevision);
      requireOwner(now >= current.checkpoint.observedAt, 'invalid-input');
      const inflight = current.operations.filter(record => record.phase === 'in-flight');
      requireOwner(inflight.length <= 1, 'corrupt-owner');
      const preserve = current.checkpoint.control === 'paused' && inflight.length === 0;
      const checkpoint = preserve
        ? current.checkpoint
        : await reduceProviderBaselineCheckpoint(
            current.plan,
            current.checkpoint,
            { kind: 'recover-after-restart', expectedRevision, now },
            dependencies
          );
      const record = inflight[0] && controlRecord(inflight[0], 'restart');
      const updated = record
        ? await observeProviderRecord({ ...current, checkpoint }, record, now, dependencies)
        : { ...current, checkpoint };
      const result = await this.#commit(
        raw,
        updated,
        signal,
        session,
        true,
        record && { record, insert: false }
      );
      if (
        session === this.#session &&
        !this.#closed &&
        !this.#fenced &&
        !this.#connection?.failure &&
        !this.#connection?.mutationUnknown
      )
        this.#recovered = true;
      this.#dispatchEnabled = false;
      return result;
    } catch (error) {
      this.#fence();
      throw error;
    }
  }

  /** Bind one full immutable reservation and a captured monotonic clock, never owner authority. */
  // eslint-disable-next-line max-lines-per-function -- Exact five-method port captures one identity and monotonic clock.
  async createExecutionPort(
    input: ProviderReservationIdentity,
    clockInput: { readonly now: () => number }
  ): Promise<ProviderExecutionPort> {
    this.#mutationReady();
    const identity = snapshotProviderIdentity(input);
    const clock = exact(clockInput, ['now']).now;
    requireOwner(typeof clock === 'function', 'invalid-input');
    let last = -1;
    const now = () => {
      const value = (clock as () => number)();
      if (!Number.isSafeInteger(value) || value < 0 || value < last) {
        this.#rotateSession();
        throw new ProviderOwnerStorageError('invalid-input');
      }
      last = value;
      return value;
    };
    const time = now();
    const session = this.#session;
    const { owner } = await this.#snapshot(this.#hash(new AbortController().signal));
    boundProviderRecord(owner, identity);
    requireOwner(time >= owner!.checkpoint.observedAt, 'invalid-input');
    this.#sessionCurrent(session);
    return createProviderExecutionPort({
      read: () =>
        providerExecutionResult(async () => {
          const { owner } = await this.#snapshot(this.#hash(new AbortController().signal));
          return boundProviderRecord(owner, identity);
        }),
      claimDispatch: revision =>
        providerExecutionResult(() =>
          this.#portMutation(() => this.#claim(identity, revision, now()))
        ),
      consumeDispatch: (token, operation, beginEffect) =>
        this.#consume(token, identity, operation, beginEffect),
      markExecutionUnknown: (revision, reason) =>
        providerExecutionResult(() =>
          this.#portMutation(() => this.#mark(identity, revision, reason, now()))
        ),
      recordProducerReceipts: (revision, receipts) =>
        providerExecutionResult(() =>
          this.#portMutation(async () => {
            const accepted = snapshotReceipts(
              identity.item.provider as 'chatgpt' | 'claude',
              receipts
            );
            const observedAt = now();
            return this.#evidence(identity, revision, accepted, observedAt);
          })
        ),
    });
  }

  async #claim(
    identity: ProviderReservationIdentity,
    revision: number,
    now: number
  ): Promise<ProviderDispatchClaim> {
    this.#mutationReady();
    integer(revision);
    const session = this.#session;
    const dependencies = this.#hash(new AbortController().signal);
    this.#dispatchReady(session);
    const { raw, owner } = await this.#snapshot(dependencies);
    const original = boundProviderRecord(owner, identity, revision);
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
    const updated = await observeProviderRecord(owner!, record, now, dependencies);
    await this.#commit(raw, updated, dependencies.signal, session, false, {
      record,
      insert: false,
    });
    if (!this.#dispatchAvailable(session))
      return Object.freeze({ record, dispatch: 'revoked' as const });
    const token = Object.freeze(Object.create(null)) as ProviderDispatchToken;
    const committed: Inventory = {
      owner: [{ key: PROVIDER_OWNER_KEY, bytes: encodeProviderOwner(updated) }],
      operations: raw.operations.map(entry =>
        entry.key === identity.operationId
          ? { key: identity.operationId, bytes: encodeWithControlHeadroom(record) }
          : entry
      ),
    };
    session.tokens.set(token, { identity: canonical(identity), raw: committed, record });
    return Object.freeze({ record, dispatch: 'available' as const, token });
  }

  async #consume<Output>(
    token: ProviderDispatchToken,
    identity: ProviderReservationIdentity,
    input: ClosedCaptureOperation,
    beginEffect: (operation: ClosedCaptureOperation) => Output | Promise<Output>
  ): Promise<Output> {
    // Burn before the first await. No validation failure, callback failure or retry restores it.
    const session = this.#session;
    const expected = token && typeof token === 'object' ? session.tokens.get(token) : undefined;
    if (token && typeof token === 'object') session.tokens.delete(token);
    let operation!: ClosedCaptureOperation;
    await providerExecutionResult(async () => {
      this.#dispatchReady(session);
      requireOwner(
        expected && expected.identity === canonical(identity) && typeof beginEffect === 'function',
        'invalid-input'
      );
      const supplied = admitNewCaptureOperation(input) as ClosedCaptureOperation;
      requireOwner(
        (supplied.admission.provider === 'chatgpt' || supplied.admission.provider === 'claude') &&
          canonical(supplied) === canonical(expected.record.operation),
        'invalid-input'
      );
      operation = expected.record.operation;
      await this.#run<void>('readwrite', context =>
        scan(context, actual => {
          this.#dispatchReady(session);
          assertUnchanged(expected.raw, actual);
          context.finish(undefined);
        })
      );
    });
    // Same continuation: no caller code or await occurs between this fence and effect start.
    try {
      this.#dispatchReady(session);
    } catch (error) {
      providerExecutionFailure(error);
    }
    return beginEffect(operation);
  }

  async #mark(
    identity: ProviderReservationIdentity,
    revision: number,
    reason: ExecutionInterruptionReason,
    now: number
  ): Promise<OperationRecord> {
    // Stopping is fail-closed: revoke first and never restore this dispatch session.
    this.#rotateSession();
    this.#mutationReady();
    integer(revision);
    const session = this.#session;
    const dependencies = this.#hash(new AbortController().signal);
    const { raw, owner } = await this.#snapshot(dependencies);
    const record = interruptExecution(boundProviderRecord(owner, identity, revision), reason);
    const checkpoint = await reduceProviderBaselineCheckpoint(
      owner!.plan,
      owner!.checkpoint,
      {
        kind: 'pause',
        expectedRevision: owner!.checkpoint.revision,
        now,
      },
      dependencies
    );
    const updated = await observeProviderRecord(
      { ...owner!, checkpoint },
      record,
      now,
      dependencies
    );
    await this.#commit(raw, updated, dependencies.signal, session, false, {
      record,
      insert: false,
    });
    return record;
  }

  async #evidence(
    identity: ProviderReservationIdentity,
    revision: number,
    receipts: ReturnType<typeof snapshotReceipts>,
    now: number
  ): Promise<OperationRecord> {
    this.#mutationReady();
    integer(revision);
    const session = this.#session;
    const dependencies = this.#hash(new AbortController().signal);
    const { raw, owner } = await this.#snapshot(dependencies);
    const record = await providerEvidenceRecord(
      boundProviderRecord(owner, identity, revision),
      receipts,
      dependencies
    );
    const updated = await observeProviderRecord(owner!, record, now, dependencies);
    await this.#commit(raw, updated, dependencies.signal, session, false, {
      record,
      insert: false,
    });
    return record;
  }

  // eslint-disable-next-line max-lines-per-function -- One read-only identity snapshot and exact committed-record reconciliation.
  async inspectReservation(input: ProviderReservationIdentity) {
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
    const planSha256 = digest(fields.planSha256);
    const item = exact(fields.item, ['ordinal', 'provider', 'conversationId', 'conversationKey']);
    const { owner } = await this.#snapshot(this.#hash(new AbortController().signal));
    requireOwner(owner && owner.plan.planSha256 === planSha256, 'corrupt-owner');
    const expected = owner.plan.plan.items[integer(item.ordinal)];
    requireOwner(
      expected &&
        expected.provider === item.provider &&
        expected.conversationId === item.conversationId &&
        expected.conversationKey === item.conversationKey,
      'invalid-input'
    );
    const record = owner.operations.find(candidate =>
      Object.values(ids).some(value =>
        [
          candidate.operation.operationId,
          candidate.operation.attemptId,
          candidate.operation.captureId,
        ].includes(value)
      )
    );
    if (!record)
      return Object.freeze({
        executionAuthorized: false as const,
        kind: 'not-observed' as const,
      });
    requireOwner(
      record.operation.operationId === ids.operationId &&
        record.operation.attemptId === ids.attemptId &&
        record.operation.captureId === ids.captureId &&
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

export function createProviderBaselineOwner(
  options: ProviderBaselineOwnerOptions
): ProviderBaselineOwner {
  return new ProviderBaselineOwnerImplementation(options);
}
