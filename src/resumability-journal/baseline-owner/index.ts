/** Offline durable reservation facts only. No execution capability or production consumer. */
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
import { detach, exact, hashDependency, identifier, integer } from '../baseline-plan/data';
import { prepareChatGptNewCapture } from '../capture-handoff';
import {
  RECORD_SCHEMA,
  snapshotRecord,
  type OperationRecord,
} from '../purpose-persistence-v2/core/record';
import { encodeWithControlHeadroom } from '../purpose-persistence-v2/core/control';
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
    operations: Object.freeze([...owner.operations]),
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
    });
    return this.#opening;
  }
  close(): void {
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
    insert?: OperationRecord
  ): Promise<OwnerSnapshot> {
    const bytes = encodeOwner(owner);
    const recordBytes = insert && encodeWithControlHeadroom(insert);
    const result = output(owner);
    return this.#run<OwnerSnapshot>('readwrite', context =>
      scan(context, actual => {
        assertUnchanged(raw, actual);
        requireOwner(!signal.aborted, 'invalid-input');
        if (insert && recordBytes)
          context.request(
            context.operations.add(recordBytes, insert.operation.operationId),
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
    this.#mutationReady();
    return this.#commit(raw, { ...current, checkpoint }, dependencies.signal);
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
      record
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
    integer(expectedRevision);
    integer(now);
    const dependencies = this.#hash(signal);
    const { raw, owner } = await this.#snapshot(dependencies);
    const current = selected(owner, expectedRevision);
    requireOwner(now >= current.checkpoint.observedAt, 'invalid-input');
    const terminal = current.checkpoint.revision === Number.MAX_SAFE_INTEGER;
    requireOwner(!terminal || current.checkpoint.control === 'paused', 'headroom-exhausted');
    const checkpoint = terminal
      ? current.checkpoint
      : await reduceBaselineCheckpoint(
          current.plan,
          current.checkpoint,
          { kind: 'recover-after-restart', expectedRevision, now },
          dependencies
        );
    assertHeadroom(checkpoint);
    const result = await this.#commit(raw, { ...current, checkpoint }, signal);
    this.#recovered = !this.#closed && !this.#connection?.failure;
    return result;
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
