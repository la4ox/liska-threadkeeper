import { MAX_CATALOG_BYTES } from '../../archive/catalog/admission';
import { admitBaselinePlan, createBaselinePlan, encodeBaselinePlan } from '../baseline-plan/plan';
import {
  BASELINE_LIMITS,
  type AdmittedBaselinePlan,
  type PlanDependencies,
} from '../baseline-plan/contracts';
import {
  assertProviderCheckpointPlan,
  decodeProviderBaselineCheckpoint,
  encodeProviderBaselineCheckpoint,
} from '../provider-baseline/checkpoint';
import {
  assertProviderPlan,
  latestProviderObservation,
  matchesProviderItem,
  providerOperationDigest,
  providerRecordDigest,
} from '../provider-baseline/operation';
import {
  MAX_PROVIDER_OPERATIONS,
  PROVIDER_BASELINE_LIMITS,
  type ProviderBaselineCheckpoint,
} from '../provider-baseline/contracts';
import { decodeRecord, revise, type OperationRecord } from '../purpose-persistence-v3/core/record';
import { controlRecord, encodeWithControlHeadroom } from '../purpose-persistence-v3/core/control';
import { PurposePersistenceError } from '../purpose-persistence-v3/core/errors';
import { ProviderOwnerStorageError, requireOwner } from './errors';

export const PROVIDER_OWNER_SCHEMA = 'liska-baseline-owner/2';
export const MAX_PROVIDER_OWNER_BYTES =
  128 +
  MAX_CATALOG_BYTES +
  BASELINE_LIMITS.maxPlanBytes +
  PROVIDER_BASELINE_LIMITS.maxCheckpointBytes;
const magic = new TextEncoder().encode(PROVIDER_OWNER_SCHEMA + '\n');

export interface ProviderOwnerData {
  readonly plan: AdmittedBaselinePlan;
  readonly checkpoint: ProviderBaselineCheckpoint;
  readonly catalogBytes: Uint8Array;
}

export interface Entry {
  readonly key: string;
  readonly bytes: Uint8Array;
}

export interface Inventory {
  readonly owner: readonly Entry[];
  readonly operations: readonly Entry[];
}

export interface ValidatedProviderOwner extends ProviderOwnerData {
  readonly operations: readonly OperationRecord[];
}

export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function copyBytes(value: unknown, maximum: number): Uint8Array {
  requireOwner(
    value instanceof Uint8Array && value.length > 0 && value.length <= maximum,
    'invalid-input'
  );
  return new Uint8Array(value);
}

export function encodeProviderOwner(owner: ProviderOwnerData): Uint8Array {
  const parts = [
    new TextEncoder().encode(owner.plan.planSha256),
    encodeBaselinePlan(owner.plan.plan),
    encodeProviderBaselineCheckpoint(owner.checkpoint),
    copyBytes(owner.catalogBytes, MAX_CATALOG_BYTES),
  ];
  const bytes = new Uint8Array(
    magic.length + 16 + parts.reduce((sum, part) => sum + part.length, 0)
  );
  requireOwner(bytes.length <= MAX_PROVIDER_OWNER_BYTES, 'corrupt-owner');
  bytes.set(magic);
  const view = new DataView(bytes.buffer);
  let offset = magic.length + 16;
  parts.forEach((part, index) => {
    view.setUint32(magic.length + index * 4, part.length);
    bytes.set(part, offset);
    offset += part.length;
  });
  return bytes;
}

function splitOwner(bytes: Uint8Array): readonly Uint8Array[] {
  requireOwner(
    bytes.length >= magic.length + 16 && sameBytes(bytes.slice(0, magic.length), magic),
    'corrupt-owner'
  );
  const limits = [
    64,
    BASELINE_LIMITS.maxPlanBytes,
    PROVIDER_BASELINE_LIMITS.maxCheckpointBytes,
    MAX_CATALOG_BYTES,
  ];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = magic.length + 16;
  const parts = limits.map((maximum, index) => {
    const size = view.getUint32(magic.length + index * 4);
    requireOwner(size > 0 && size <= maximum && offset + size <= bytes.length, 'corrupt-owner');
    const part = bytes.slice(offset, offset + size);
    offset += size;
    return part;
  });
  requireOwner(offset === bytes.length, 'corrupt-owner');
  return parts;
}

/** Active state reserves the one mandatory pause/restart revision at worst-width time. */
export function assertProviderOwnerHeadroom(checkpoint: ProviderBaselineCheckpoint): void {
  requireOwner(
    Number.isSafeInteger(checkpoint.revision) && checkpoint.revision >= 0,
    'headroom-exhausted'
  );
  if (checkpoint.control === 'paused') return;
  requireOwner(checkpoint.revision < Number.MAX_SAFE_INTEGER, 'headroom-exhausted');
  try {
    encodeProviderBaselineCheckpoint({
      ...checkpoint,
      control: 'paused',
      revision: Number.MAX_SAFE_INTEGER,
      observedAt: Number.MAX_SAFE_INTEGER,
    });
  } catch {
    throw new ProviderOwnerStorageError('headroom-exhausted');
  }
}

function executionNeeds(owner: ValidatedProviderOwner): {
  readonly checkpointRevisions: number;
  readonly observationSlots: number;
  readonly recordRevisions: number;
  readonly pending?: OperationRecord;
} {
  const pending = owner.operations.filter(record =>
    ['reserved', 'in-flight', 'unknown'].includes(record.phase)
  );
  requireOwner(pending.length <= 1, 'corrupt-owner');
  const record = pending[0];
  if (!record)
    return {
      checkpointRevisions: owner.checkpoint.control === 'active' ? 1 : 0,
      observationSlots: 0,
      recordRevisions: 0,
    };
  if (record.phase === 'reserved')
    return owner.checkpoint.control === 'active'
      ? {
          checkpointRevisions: 4,
          observationSlots: 3,
          recordRevisions: 5,
          pending: record,
        }
      : { checkpointRevisions: 0, observationSlots: 0, recordRevisions: 0, pending: record };
  if (record.phase === 'in-flight')
    return {
      checkpointRevisions: 3,
      observationSlots: 2,
      recordRevisions: 4,
      pending: record,
    };
  return {
    checkpointRevisions: owner.checkpoint.control === 'active' ? 2 : 1,
    observationSlots: 1,
    recordRevisions: 3,
    pending: record,
  };
}

/** Exact retained lifecycle budget, including the mandatory active-state pause fence. */
export function assertProviderExecutionHeadroom(owner: ValidatedProviderOwner): void {
  const needs = executionNeeds(owner);
  const maximum = Number.MAX_SAFE_INTEGER;
  requireOwner(
    owner.checkpoint.revision <= maximum - needs.checkpointRevisions &&
      owner.checkpoint.observedAt <= maximum &&
      owner.checkpoint.observations.length <=
        PROVIDER_BASELINE_LIMITS.maxObservations - needs.observationSlots &&
      (!needs.pending || needs.pending.revision <= maximum - needs.recordRevisions),
    'headroom-exhausted'
  );
  try {
    for (const record of owner.operations) encodeWithControlHeadroom(record);
    if (needs.pending?.phase === 'reserved' && owner.checkpoint.control === 'active') {
      const claimed = revise(needs.pending, { phase: 'in-flight' });
      encodeWithControlHeadroom(claimed);
      encodeWithControlHeadroom(controlRecord(claimed, 'pause'));
    }
    const observations = [...owner.checkpoint.observations];
    for (let index = 0; index < needs.observationSlots; index++)
      observations.push({
        operationId: needs.pending!.operation.operationId,
        recordRevision: maximum - needs.observationSlots + index + 1,
        recordSha256: 'f'.repeat(64),
        observedAt: maximum,
      });
    encodeProviderBaselineCheckpoint({
      ...owner.checkpoint,
      control: needs.checkpointRevisions ? 'paused' : owner.checkpoint.control,
      revision: maximum,
      observedAt: maximum,
      observations,
    });
  } catch (error) {
    if (error instanceof ProviderOwnerStorageError) throw error;
    throw new ProviderOwnerStorageError('headroom-exhausted');
  }
}

// eslint-disable-next-line max-lines-per-function, complexity -- Exact record/link/charge/observation binding stays in one complete-inventory validation pass.
async function validateRelationships(
  plan: AdmittedBaselinePlan,
  checkpoint: ProviderBaselineCheckpoint,
  records: readonly OperationRecord[],
  dependencies: PlanDependencies
): Promise<void> {
  assertProviderCheckpointPlan(plan, checkpoint);
  requireOwner(
    checkpoint.links.length === records.length &&
      checkpoint.charges.length === records.length &&
      checkpoint.observations.length >= records.length,
    'corrupt-owner'
  );
  const identities = records.flatMap(record => [
    record.operation.operationId,
    record.operation.attemptId,
    record.operation.captureId,
  ]);
  requireOwner(new Set(identities).size === identities.length, 'corrupt-owner');
  requireOwner(
    records.filter(record => ['reserved', 'in-flight', 'unknown'].includes(record.phase)).length <=
      1,
    'corrupt-owner'
  );
  const hash = (bytes: Uint8Array) => dependencies.sha256(bytes, dependencies.signal);
  for (const record of records) {
    requireOwner(
      record.disposition === 'open' &&
        ['reserved', 'in-flight', 'unknown', 'awaiting-resolution'].includes(record.phase) &&
        (record.phase !== 'reserved' || record.control === 'active') &&
        !(checkpoint.control === 'paused' && record.phase === 'in-flight'),
      'corrupt-owner'
    );
    const link = checkpoint.links.find(
      candidate => candidate.operationId === record.operation.operationId
    );
    const charge = checkpoint.charges.find(
      candidate => candidate.operationId === record.operation.operationId
    );
    const item = link && plan.plan.items[link.itemOrdinal];
    requireOwner(
      link &&
        charge &&
        item &&
        link.attemptId === record.operation.attemptId &&
        link.captureId === record.operation.captureId &&
        charge.itemOrdinal === link.itemOrdinal &&
        charge.windowId === link.windowId &&
        charge.chargedAt === link.linkedAt &&
        matchesProviderItem(plan.plan, item, record),
      'corrupt-owner'
    );
    requireOwner(
      link.operationSha256 === (await providerOperationDigest(record, hash)),
      'corrupt-owner'
    );
    const observation = latestProviderObservation(
      checkpoint.observations,
      record.operation.operationId
    );
    requireOwner(
      observation?.recordRevision === record.revision &&
        observation.recordSha256 === (await providerRecordDigest(record, hash)),
      'corrupt-owner'
    );
  }
  requireOwner(!dependencies.signal.aborted, 'corrupt-owner');
}

// eslint-disable-next-line max-lines-per-function -- One detached admission checks all four exact byte strings and their complete inventory bindings.
async function validate(
  raw: Inventory,
  dependencies: PlanDependencies
): Promise<ValidatedProviderOwner | undefined> {
  if (!raw.owner.length) {
    requireOwner(!raw.operations.length, 'corrupt-owner');
    return undefined;
  }
  const [digestBytes, planBytes, checkpointBytes, catalogBytes] = splitOwner(raw.owner[0].bytes);
  const plan = await admitBaselinePlan(
    planBytes,
    new TextDecoder().decode(digestBytes),
    dependencies
  );
  assertProviderPlan(plan);
  const checkpoint = decodeProviderBaselineCheckpoint(checkpointBytes);
  requireOwner(
    sameBytes(encodeProviderBaselineCheckpoint(checkpoint), checkpointBytes),
    'corrupt-owner'
  );
  const recreated = await createBaselinePlan(
    catalogBytes,
    {
      selection: plan.plan.items.map(({ provider, conversationId, conversationKey }) => ({
        provider,
        conversationId,
        conversationKey,
      })),
      purpose: plan.plan.purpose,
      destinations: plan.plan.destinations,
      completenessPolicy: plan.plan.completenessPolicy,
    },
    dependencies
  );
  assertProviderPlan(recreated);
  requireOwner(
    recreated.planSha256 === plan.planSha256 &&
      sameBytes(encodeBaselinePlan(recreated.plan), planBytes),
    'corrupt-owner'
  );
  const records = raw.operations.map(entry => {
    const record = decodeRecord(entry.bytes, entry.key);
    requireOwner(sameBytes(encodeWithControlHeadroom(record), entry.bytes), 'corrupt-owner');
    return record;
  });
  requireOwner(records.length <= MAX_PROVIDER_OPERATIONS, 'corrupt-owner');
  await validateRelationships(plan, checkpoint, records, dependencies);
  const owner = {
    plan,
    checkpoint,
    catalogBytes,
    operations: Object.freeze(records),
  };
  assertProviderExecutionHeadroom(owner);
  return owner;
}

export async function validateInventory(
  raw: Inventory,
  dependencies: PlanDependencies
): Promise<ValidatedProviderOwner | undefined> {
  try {
    return await validate(raw, dependencies);
  } catch (error) {
    if (error instanceof PurposePersistenceError && error.code === 'read-failed')
      throw new ProviderOwnerStorageError('read-failed');
    if (
      (error instanceof ProviderOwnerStorageError &&
        ['headroom-exhausted', 'read-failed'].includes(error.code)) ||
      (error && typeof error === 'object' && 'code' in error && error.code === 'record-too-large')
    )
      throw error;
    throw new ProviderOwnerStorageError('corrupt-owner');
  }
}
