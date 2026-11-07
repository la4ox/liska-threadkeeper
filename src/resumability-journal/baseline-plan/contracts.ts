import type { CatalogSha256 } from '../../archive/catalog/admission';
import type { DestinationRequirement, STRICT_COMPLETENESS } from '../purpose/contracts';
import type { OperationRecord } from '../purpose-persistence-v2/core/record';

export const PLAN_SCHEMA = 'liska-explicit-baseline-plan/1' as const;
export const CHECKPOINT_SCHEMA = 'liska-explicit-baseline-checkpoint/1' as const;
export const BASELINE_LIMITS = Object.freeze({
  maxPlanItems: 4096,
  maxPlanBytes: 1024 * 1024,
  maxCheckpointBytes: 64 * 1024,
  maxNodes: 50000,
  maxDepth: 16,
  maxStringCodeUnits: 1024,
  maxTotalStringCodeUnits: 1024 * 1024,
  maxObservations: 128,
  maxWindows: 64,
  maxReservationSlots: 16,
});
export interface Identity {
  readonly provider: string;
  readonly conversationId: string;
  readonly conversationKey: `liska-conversation-key/1:${string}`;
}
export interface PlanItem extends Identity {
  readonly ordinal: number;
}
export interface BaselinePlanRequest {
  readonly selection: readonly Identity[];
  readonly purpose: 'new-capture';
  readonly destinations: readonly DestinationRequirement[];
  readonly completenessPolicy: typeof STRICT_COMPLETENESS;
}
export interface BaselinePlan {
  readonly schema: typeof PLAN_SCHEMA;
  readonly coverage: 'explicit-selected-inputs-only';
  readonly purpose: 'new-capture';
  readonly executionAuthorized: false;
  readonly catalogSha256: string;
  readonly destinations: readonly DestinationRequirement[];
  readonly completenessPolicy: typeof STRICT_COMPLETENESS;
  readonly items: readonly PlanItem[];
}
/** The digest is separate from the canonical plan bytes, and is reverified at use. */
export interface AdmittedBaselinePlan {
  readonly plan: BaselinePlan;
  readonly planSha256: string;
}
export interface PlanDependencies {
  readonly sha256: CatalogSha256;
  readonly signal: AbortSignal;
}
export interface OperationLink {
  readonly itemOrdinal: number;
  readonly operationId: string;
  readonly attemptId: string;
  readonly captureId: string;
  readonly operationSha256: string;
  readonly linkedAt: number;
  readonly windowId: string;
}
export interface OperationObservation {
  readonly operationId: string;
  readonly recordRevision: number;
  readonly recordSha256: string;
  readonly observedAt: number;
}
export interface BudgetWindow {
  readonly windowId: string;
  readonly openedAt: number;
}
export interface ReservationCharge {
  readonly windowId: string;
  readonly itemOrdinal: number;
  readonly operationId: string;
  readonly chargedAt: number;
}
/** Data only. Histories are append-only and bounded; filling them requires a stop, not pruning. */
export interface BaselineCheckpoint {
  readonly schema: typeof CHECKPOINT_SCHEMA;
  readonly planSha256: string;
  readonly revision: number;
  readonly control: 'paused' | 'active';
  readonly observedAt: number;
  readonly budget: { readonly windowId: string; readonly maxReservationSlots: number };
  readonly windows: readonly BudgetWindow[];
  readonly charges: readonly ReservationCharge[];
  readonly links: readonly OperationLink[];
  readonly observations: readonly OperationObservation[];
  readonly cooldown?: { readonly observedAt: number; readonly until: number };
}
export type CheckpointCommand = {
  readonly expectedRevision: number;
  readonly now: number;
} & (
  | { readonly kind: 'activate' | 'pause' | 'recover-after-restart' | 'clear-cooldown' }
  | { readonly kind: 'set-cooldown'; readonly until: number }
  | { readonly kind: 'roll-budget-window'; readonly windowId: string }
  | {
      readonly kind: 'observe-operation';
      readonly itemOrdinal: number;
      readonly record: OperationRecord;
    }
);
export type ProgressCategory =
  | 'untouched'
  | 'reserved'
  | 'in-flight-or-unknown'
  | 'awaiting-resolution'
  | 'paused-or-abandoned'
  | 'conflict';
export interface ItemProgress {
  readonly item: PlanItem;
  readonly category: ProgressCategory;
  readonly resolutionRequired: boolean;
  readonly operationId?: string;
}
export interface BaselineProgress {
  readonly executionAuthorized: false;
  readonly items: readonly ItemProgress[];
  readonly conflict: boolean;
  readonly unresolvedEffect: boolean;
  readonly clockRegressed: boolean;
  readonly recordCount: number;
  readonly currentWindowCharges: number;
}
export type StopReason =
  | 'paused'
  | 'clock-regressed'
  | 'cooldown'
  | 'budget-exhausted'
  | 'capacity-unavailable'
  | 'linked-operation-pending'
  | 'unresolved-effect'
  | 'conflict'
  | 'no-unattempted-items';
export type NextBaselineDecision =
  | { readonly executionAuthorized: false; readonly kind: 'candidate'; readonly item: PlanItem }
  | { readonly executionAuthorized: false; readonly kind: 'stop'; readonly reason: StopReason };
export type BaselineErrorCode =
  | 'invalid-data'
  | 'limit-exceeded'
  | 'invalid-plan'
  | 'invalid-catalog'
  | 'selection-mismatch'
  | 'hash-failed'
  | 'digest-mismatch'
  | 'invalid-checkpoint'
  | 'invalid-command'
  | 'revision-conflict'
  | 'clock-regressed'
  | 'operation-conflict'
  | 'budget-exhausted'
  | 'history-exhausted';
export class BaselinePlanError extends Error {
  constructor(readonly code: BaselineErrorCode) {
    super(code);
    this.name = 'BaselinePlanError';
  }
}
