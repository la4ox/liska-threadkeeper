import type { ChatGptDestinationArchiveReceipt } from '../lib/chatgpt-archive-receipt';
import type { PersistentOutputDestination } from '../lib/types';
import type { OperationWriteLedgerSnapshot } from '../lib/operation-write-ledger';

export const ALL_BRANCHES_BUDGET_LIMITS = Object.freeze({
  nodeCount: 50_000,
  leafCount: 512,
  pathVisits: 1_000_000,
  sourceWorkBytes: 1024 ** 3,
  plannedArtifactWrites: 2_048,
  individualNoteBytes: 16 * 1024 ** 2,
  logicalMarkdownBytesPerDestination: 1024 ** 3,
  physicalPlannedBytes: 2 * 1024 ** 3,
  /** Homogeneous rendered HTML bytes across the measurement and recreation passes. */
  htmlRenderWorkBytes: 4 * 1024 ** 3,
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
  | 'physical-planned-bytes'
  | 'html-render-work-bytes';

export interface AllBranchesHtmlStructuralPlan {
  /** File delivery writes one HTML artifact and one receipt for every leaf plus the index. */
  readonly file: true;
}

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
  limits = ALL_BRANCHES_BUDGET_LIMITS,
  htmlPlan?: AllBranchesHtmlStructuralPlan
): AllBranchesStructuralBudgetResult {
  const presentationWrites = checkedAdd(metrics.leafCount, 1, 'planned presentation writes');
  const writesPerDestination = checkedAdd(
    presentationWrites,
    archiveAlreadyPersisted ? 0 : companionArtifactCount,
    'planned writes per destination'
  );
  const markdownArtifactWrites = checkedMultiply(
    writesPerDestination,
    destinationCount,
    'planned artifact writes'
  );
  const htmlArtifactWrites = htmlPlan?.file
    ? checkedMultiply(presentationWrites, 2, 'planned HTML artifact writes')
    : 0;
  const plannedArtifactWrites = checkedAdd(
    markdownArtifactWrites,
    htmlArtifactWrites,
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

/** Exact retained bytes for one finalized destination; assets are already unique validated paths. */
export function destinationRetainedBytes(receipt: ChatGptDestinationArchiveReceipt): number {
  const { raw, manifest, canonical } = receipt.archiveByteLengths;
  const archiveBytes = checkedAdd(
    checkedAdd(raw, manifest, 'retained archive bytes'),
    canonical,
    'retained archive bytes'
  );
  return receipt.assets.reduce(
    (total, asset) => checkedAdd(total, asset.byteLength, 'retained archive bytes'),
    archiveBytes
  );
}

/** Counts attempts, not unique assets; receipts must not be added again in ledger mode. */
export function operationArtifactBytes(
  ledger: OperationWriteLedgerSnapshot,
  destination: PersistentOutputDestination
): { confirmed: number; unknown: number; cleanupDeferred: number } {
  const totals = { confirmed: 0, unknown: 0, cleanupDeferred: 0 };
  for (const observation of ledger.observations) {
    if (observation.destination !== destination) continue;
    if (observation.state === 'confirmed' || observation.state === 'unknown') {
      totals[observation.state] = checkedAdd(
        totals[observation.state],
        observation.byteLength,
        'artifact bytes'
      );
    }
    if (observation.cleanupDeferred) totals.cleanupDeferred += 1;
  }
  return totals;
}

export class ExactPresentationBudget {
  private readonly logicalBytes = new Map<PersistentOutputDestination, number>();
  private readonly limits: typeof ALL_BRANCHES_BUDGET_LIMITS;
  private physicalBytes: number;
  private htmlRenderBytes = 0;
  private initialExceeded = false;

  constructor(
    retainedBytesByDestination: ReadonlyMap<PersistentOutputDestination, number>,
    limits = ALL_BRANCHES_BUDGET_LIMITS
  ) {
    this.limits = Object.freeze({ ...limits });
    this.physicalBytes = 0;
    for (const [label, value] of [
      ['individual note byte cap', this.limits.individualNoteBytes],
      ['logical Markdown byte cap', this.limits.logicalMarkdownBytesPerDestination],
      ['physical planned byte cap', this.limits.physicalPlannedBytes],
      ['HTML render work byte cap', this.limits.htmlRenderWorkBytes],
    ] as const)
      checkedAdd(0, value, label);
    for (const [destination, retainedBytes] of retainedBytesByDestination) {
      this.logicalBytes.set(destination, 0);
      const validatedBytes = checkedAdd(0, retainedBytes, 'physical planned bytes');
      if (this.initialExceeded) continue;
      if (validatedBytes > this.limits.physicalPlannedBytes - this.physicalBytes) {
        this.initialExceeded = true;
        this.physicalBytes =
          this.limits.physicalPlannedBytes < Number.MAX_SAFE_INTEGER
            ? this.limits.physicalPlannedBytes + 1
            : this.limits.physicalPlannedBytes;
        continue;
      }
      this.physicalBytes = checkedAdd(this.physicalBytes, validatedBytes, 'physical planned bytes');
    }
  }

  preflight(): AllBranchesBudgetKind | null {
    return this.initialExceeded || this.physicalBytes > this.limits.physicalPlannedBytes
      ? 'physical-planned-bytes'
      : null;
  }

  addNote(destination: PersistentOutputDestination, bytes: number): AllBranchesBudgetKind | null {
    const initialExceeded = this.preflight();
    if (initialExceeded) return initialExceeded;
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

  /** Checks a whole HTML bundle without mutating the shared budget. */
  preflightHtmlBundle(artifactBytes: number, receiptBytes: number): AllBranchesBudgetKind | null {
    const initialExceeded = this.preflight();
    if (initialExceeded) return initialExceeded;
    const bundleBytes = checkedAdd(artifactBytes, receiptBytes, 'HTML artifact bundle bytes');
    const documentRenderWork = checkedMultiply(artifactBytes, 2, 'HTML render work bytes');
    const htmlRenderBytes = checkedAdd(
      this.htmlRenderBytes,
      documentRenderWork,
      'HTML render work bytes'
    );
    if (htmlRenderBytes > this.limits.htmlRenderWorkBytes) return 'html-render-work-bytes';
    const physical = checkedAdd(this.physicalBytes, bundleBytes, 'physical planned bytes');
    if (physical > this.limits.physicalPlannedBytes) return 'physical-planned-bytes';
    return null;
  }

  /**
   * Atomically reserves a File HTML bundle and its receipts in the shared physical budget.
   * Render work counts the exact aggregate HTML bytes twice: measured, then recreated.
   */
  addHtmlBundle(artifactBytes: number, receiptBytes: number): AllBranchesBudgetKind | null {
    const exceeded = this.preflightHtmlBundle(artifactBytes, receiptBytes);
    if (exceeded) return exceeded;
    const bundleBytes = checkedAdd(artifactBytes, receiptBytes, 'HTML artifact bundle bytes');
    const documentRenderWork = checkedMultiply(artifactBytes, 2, 'HTML render work bytes');
    const htmlRenderBytes = checkedAdd(
      this.htmlRenderBytes,
      documentRenderWork,
      'HTML render work bytes'
    );
    const physical = checkedAdd(this.physicalBytes, bundleBytes, 'physical planned bytes');
    this.htmlRenderBytes = htmlRenderBytes;
    this.physicalBytes = physical;
    return null;
  }

  logicalBytesFor(destination: PersistentOutputDestination): number {
    return this.logicalBytes.get(destination) ?? 0;
  }

  get totalPhysicalBytes(): number {
    return this.physicalBytes;
  }

  get totalHtmlRenderWorkBytes(): number {
    return this.htmlRenderBytes;
  }
}
