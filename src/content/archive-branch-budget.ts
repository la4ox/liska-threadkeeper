import type { ArchiveCompanionBundle, PersistentOutputDestination } from '../lib/types';

export const ALL_BRANCHES_BUDGET_LIMITS = Object.freeze({
  nodeCount: 50_000,
  leafCount: 512,
  pathVisits: 1_000_000,
  sourceWorkBytes: 1024 ** 3,
  plannedArtifactWrites: 2_048,
  individualNoteBytes: 16 * 1024 ** 2,
  logicalMarkdownBytesPerDestination: 1024 ** 3,
  physicalPlannedBytes: 2 * 1024 ** 3,
});

export interface ArchiveBranchWorkMetrics {
  readonly nodeCount: number;
  readonly leafCount: number;
  readonly branchPointCount: number;
  readonly pathVisits: number;
  readonly sourceWorkBytes: number;
}

export type AllBranchesBudgetKind =
  | 'nodes'
  | 'leaves'
  | 'path-visits'
  | 'source-work-bytes'
  | 'planned-artifact-writes'
  | 'individual-note-bytes'
  | 'logical-markdown-bytes'
  | 'physical-planned-bytes';

export interface AllBranchesStructuralBudgetResult {
  readonly accepted: boolean;
  readonly budgetKind?: AllBranchesBudgetKind;
  readonly plannedArtifactWrites: number;
}

export function checkedAdd(left: number, right: number, label: string): number {
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0) {
    throw new Error(`Invalid ${label}.`);
  }
  const total = left + right;
  if (!Number.isSafeInteger(total)) throw new Error(`${label} exceeds safe integer range.`);
  return total;
}

export function checkedMultiply(left: number, right: number, label: string): number {
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0) {
    throw new Error(`Invalid ${label}.`);
  }
  const total = left * right;
  if (!Number.isSafeInteger(total)) throw new Error(`${label} exceeds safe integer range.`);
  return total;
}

export function structuralBudgetPreflight(
  metrics: ArchiveBranchWorkMetrics,
  destinationCount: number,
  companionArtifactCount: number,
  archiveAlreadyPersisted: boolean,
  limits = ALL_BRANCHES_BUDGET_LIMITS
): AllBranchesStructuralBudgetResult {
  const presentationWrites = checkedAdd(metrics.leafCount, 1, 'planned presentation writes');
  const writesPerDestination = checkedAdd(
    presentationWrites,
    archiveAlreadyPersisted ? 0 : companionArtifactCount,
    'planned writes per destination'
  );
  const plannedArtifactWrites = checkedMultiply(
    writesPerDestination,
    destinationCount,
    'planned artifact writes'
  );
  const checks: ReadonlyArray<[number, number, AllBranchesBudgetKind]> = [
    [metrics.nodeCount, limits.nodeCount, 'nodes'],
    [metrics.leafCount, limits.leafCount, 'leaves'],
    [metrics.pathVisits, limits.pathVisits, 'path-visits'],
    [metrics.sourceWorkBytes, limits.sourceWorkBytes, 'source-work-bytes'],
    [plannedArtifactWrites, limits.plannedArtifactWrites, 'planned-artifact-writes'],
  ];
  const exceeded = checks.find(([value, cap]) => value > cap);
  return exceeded
    ? { accepted: false, budgetKind: exceeded[2], plannedArtifactWrites }
    : { accepted: true, plannedArtifactWrites };
}

export function companionPhysicalBytes(companion: ArchiveCompanionBundle): number {
  return companion.artifacts.reduce(
    (total, artifact) => checkedAdd(total, artifact.byteLength, 'companion physical bytes'),
    0
  );
}

export class ExactPresentationBudget {
  private readonly logicalBytes = new Map<PersistentOutputDestination, number>();
  private physicalBytes: number;

  constructor(
    destinations: readonly PersistentOutputDestination[],
    companionBytesPerDestination: number,
    private readonly limits = ALL_BRANCHES_BUDGET_LIMITS
  ) {
    for (const destination of destinations) this.logicalBytes.set(destination, 0);
    this.physicalBytes = checkedMultiply(
      companionBytesPerDestination,
      destinations.length,
      'physical planned bytes'
    );
  }

  addNote(destination: PersistentOutputDestination, bytes: number): AllBranchesBudgetKind | null {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error('Invalid serialized note bytes.');
    if (bytes > this.limits.individualNoteBytes) return 'individual-note-bytes';
    const logical = checkedAdd(
      this.logicalBytes.get(destination) ?? 0,
      bytes,
      'logical Markdown bytes'
    );
    if (logical > this.limits.logicalMarkdownBytesPerDestination) {
      return 'logical-markdown-bytes';
    }
    const physical = checkedAdd(this.physicalBytes, bytes, 'physical planned bytes');
    if (physical > this.limits.physicalPlannedBytes) return 'physical-planned-bytes';
    this.logicalBytes.set(destination, logical);
    this.physicalBytes = physical;
    return null;
  }

  logicalBytesFor(destination: PersistentOutputDestination): number {
    return this.logicalBytes.get(destination) ?? 0;
  }

  get totalPhysicalBytes(): number {
    return this.physicalBytes;
  }
}
