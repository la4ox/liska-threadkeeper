import { MAX_CATALOG_BYTES } from '../../archive/catalog/admission';
import {
  admitBaselinePlan,
  createBaselinePlan,
  encodeBaselinePlan,
  decodeBaselineCheckpoint,
  encodeBaselineCheckpoint,
  projectBaselineProgress,
  type AdmittedBaselinePlan,
  type BaselineCheckpoint,
  type PlanDependencies,
} from '../baseline-plan';
import { BASELINE_LIMITS } from '../baseline-plan/contracts';
import {
  decodeRecord,
  encodeRecord,
  type OperationRecord,
} from '../purpose-persistence-v2/core/record';
import { encodeWithControlHeadroom } from '../purpose-persistence-v2/core/control';
import { requireOwner } from './errors';

export const OWNER_SCHEMA = 'liska-baseline-owner/1';
// A binary envelope avoids JSON escaping expansion and preserves exact canonical byte strings.
export const MAX_OWNER_BYTES =
  128 + MAX_CATALOG_BYTES + BASELINE_LIMITS.maxPlanBytes + BASELINE_LIMITS.maxCheckpointBytes;
const magic = new TextEncoder().encode(OWNER_SCHEMA + '\n');
export interface OwnerData {
  readonly plan: AdmittedBaselinePlan;
  readonly checkpoint: BaselineCheckpoint;
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
export interface ValidatedOwner extends OwnerData {
  readonly operations: readonly OperationRecord[];
}
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
export function copyBytes(value: unknown, maximum: number): Uint8Array {
  requireOwner(
    value instanceof Uint8Array && value.length > 0 && value.length <= maximum,
    'invalid-input'
  );
  return new Uint8Array(value);
}
export function encodeOwner(owner: OwnerData): Uint8Array {
  const parts = [
    new TextEncoder().encode(owner.plan.planSha256),
    encodeBaselinePlan(owner.plan.plan),
    encodeBaselineCheckpoint(owner.checkpoint),
    copyBytes(owner.catalogBytes, MAX_CATALOG_BYTES),
  ];
  const bytes = new Uint8Array(
    magic.length + 16 + parts.reduce((sum, part) => sum + part.length, 0)
  );
  requireOwner(bytes.length <= MAX_OWNER_BYTES, 'corrupt-owner');
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
function splitOwner(bytes: Uint8Array) {
  requireOwner(
    bytes.length >= magic.length + 16 && sameBytes(bytes.slice(0, magic.length), magic),
    'corrupt-owner'
  );
  const limits = [
    64,
    BASELINE_LIMITS.maxPlanBytes,
    BASELINE_LIMITS.maxCheckpointBytes,
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
/** Active states retain one restart increment; paused states may use the final safe revision. */
export function assertHeadroom(checkpoint: BaselineCheckpoint): void {
  requireOwner(
    Number.isSafeInteger(checkpoint.revision) &&
      checkpoint.revision >= 0 &&
      (checkpoint.revision < Number.MAX_SAFE_INTEGER ||
        (checkpoint.control === 'paused' && checkpoint.revision === Number.MAX_SAFE_INTEGER)),
    'headroom-exhausted'
  );
  // Both states must still fit the maximum serialized revision/time widths.
  encodeBaselineCheckpoint({
    ...checkpoint,
    control: 'paused',
    revision: Number.MAX_SAFE_INTEGER,
    observedAt: Number.MAX_SAFE_INTEGER,
  });
}
// eslint-disable-next-line max-lines-per-function -- One detached owner admission checks canonical bytes, replay, complete links and recovery headroom together.
export async function validateInventory(
  raw: Inventory,
  dependencies: PlanDependencies
): Promise<ValidatedOwner | undefined> {
  if (!raw.owner.length) {
    requireOwner(!raw.operations.length, 'corrupt-owner');
    return undefined;
  }
  const [digest, planBytes, checkpointBytes, catalogBytes] = splitOwner(raw.owner[0].bytes);
  const plan = await admitBaselinePlan(planBytes, new TextDecoder().decode(digest), dependencies);
  const checkpoint = decodeBaselineCheckpoint(checkpointBytes);
  requireOwner(sameBytes(encodeBaselineCheckpoint(checkpoint), checkpointBytes), 'corrupt-owner');
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
  requireOwner(
    recreated.planSha256 === plan.planSha256 &&
      sameBytes(encodeBaselinePlan(recreated.plan), planBytes),
    'corrupt-owner'
  );
  const operations = raw.operations.map(entry => {
    const record = decodeRecord(entry.bytes, entry.key);
    requireOwner(sameBytes(encodeWithControlHeadroom(record), entry.bytes), 'corrupt-owner');
    return record;
  });
  // This offline owner has no operation writer after reservation. Never adopt injected execution.
  requireOwner(
    operations.every(
      record =>
        record.revision === 0 &&
        record.phase === 'reserved' &&
        record.control === 'active' &&
        record.disposition === 'open'
    ),
    'corrupt-owner'
  );
  requireOwner(
    checkpoint.links.length === operations.length &&
      checkpoint.observations.length === operations.length,
    'corrupt-owner'
  );
  const progress = await projectBaselineProgress(
    plan,
    checkpoint,
    operations,
    checkpoint.observedAt,
    dependencies
  );
  requireOwner(!progress.conflict && !progress.unresolvedEffect, 'corrupt-owner');
  // The pure projection permits a newer unobserved revision. The durable owner does not.
  for (const record of operations) {
    const observation = checkpoint.observations.find(
      item => item.operationId === record.operation.operationId
    );
    requireOwner(observation?.recordRevision === record.revision, 'corrupt-owner');
    requireOwner(
      observation.recordSha256 ===
        (await dependencies.sha256(encodeRecord(record), dependencies.signal)),
      'corrupt-owner'
    );
  }
  assertHeadroom(checkpoint);
  return { plan, checkpoint, catalogBytes, operations: Object.freeze(operations) };
}
