import type {
  AdmittedBaselinePlan,
  BaselineProgress,
  BudgetWindow,
  ItemProgress,
  NextBaselineDecision,
  OperationLink,
  OperationObservation,
  PlanDependencies,
  ReservationCharge,
} from '../baseline-plan/contracts';
import type { OperationRecord } from '../purpose-persistence-v3/core/record';

export type {
  AdmittedBaselinePlan,
  ItemProgress,
  OperationLink,
  OperationObservation,
  PlanDependencies,
};
export type ProviderBaselineProgress = BaselineProgress;
export type NextProviderBaselineDecision = NextBaselineDecision;
export const PROVIDER_CHECKPOINT_SCHEMA = 'liska-explicit-baseline-checkpoint/2' as const;
export const MAX_PROVIDER_OPERATIONS = 16;
export class ProviderBaselineError extends Error {
  readonly code = 'invalid-checkpoint' as const;
  constructor() {
    super('invalid-checkpoint');
    this.name = 'ProviderBaselineError';
  }
}
export const PROVIDER_BASELINE_LIMITS = Object.freeze({
  maxPlanItems: 4096,
  maxCheckpointBytes: 64 * 1024,
  maxObservations: 128,
  maxWindows: 64,
  maxReservationSlots: 16,
});
/** Append-only facts only. No execution, settlement, retry or automatic continuation authority. */
export interface ProviderBaselineCheckpoint {
  readonly schema: typeof PROVIDER_CHECKPOINT_SCHEMA;
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
export type ProviderCheckpointCommand = {
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
