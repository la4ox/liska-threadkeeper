import type {
  AIPlatform,
  AllBranchesPresentationPlan,
  ArchiveCompanionBundle,
  ObsidianNote,
  OutputDestination,
  PersistentOutputDestination,
  TemplateOptions,
} from '../lib/types';
import {
  checkedAdd,
  companionPhysicalBytes,
  ExactPresentationBudget,
  structuralBudgetPreflight,
  type AllBranchesBudgetKind,
  type AllBranchesStructuralBudgetResult,
  type ArchiveBranchWorkMetrics,
} from './archive-branch-budget';
import {
  prepareArchiveBranchPresentation,
  type ArchiveBranchIndexEntry,
  type ArchiveBranchLeafRender,
  type PreparedArchiveBranchPresentation,
} from './archive-branch-bundle';

export type AllBranchesWriteOutcome = 'confirmed' | 'failed' | 'unknown';
export type AllBranchesPersistenceStatus =
  | 'complete'
  | 'rejected'
  | 'cancelled'
  | 'partial'
  | 'failed';
export type AllBranchesPersistencePhase =
  | 'structural-preflight'
  | 'archive'
  | 'measurement'
  | 'writing'
  | 'index'
  | 'complete';

export interface AllBranchesDestinationSummary {
  destination: PersistentOutputDestination;
  archiveSaved: boolean;
  archiveState: 'confirmed' | 'failed' | 'not-attempted';
  branchFilesSaved: number;
  branchWrites: { confirmed: number; failed: number; unknown: number };
  indexSaved: boolean;
  indexState: AllBranchesWriteOutcome | 'not-attempted';
  dispatchedBytes: number;
  confirmedBytes: number;
}

export interface AllBranchesPersistenceSummary {
  version: 1;
  status: AllBranchesPersistenceStatus;
  phase: AllBranchesPersistencePhase;
  budgetKind?: AllBranchesBudgetKind;
  cancelRequested: boolean;
  metrics: ArchiveBranchWorkMetrics;
  plannedArtifactWrites: number;
  plannedPhysicalBytes: number;
  measuredLeaves: number;
  renderedLeaves: number;
  branchCount: number;
  omissionBranchCount: number;
  canonicalOnlyCount: number;
  clipboardSkipped: boolean;
  destinations: AllBranchesDestinationSummary[];
  allSuccessful: boolean;
}

export interface AllBranchesPersistenceDependencies {
  persistCompanions: (
    companion: ArchiveCompanionBundle,
    noteFileName: string,
    source: AIPlatform,
    outputs: OutputDestination[]
  ) => Promise<string[]>;
  writeNote: (
    note: ObsidianNote,
    destination: PersistentOutputDestination,
    messageCount: number
  ) => Promise<AllBranchesWriteOutcome>;
  measureNoteBytes: (note: ObsidianNote, destination: PersistentOutputDestination) => number;
  signal?: AbortSignal;
  yieldTask?: () => Promise<void>;
  prepared?: PreparedAllBranchesPersistence;
  /** The caller already completed raw -> manifest -> canonical for every output. */
  archiveAlreadyPersisted?: boolean;
  onProgress?: (completedBranches: number, totalBranches: number) => void;
}

/** Opaque owned session created before any optional attachment/companion writes. */
export interface PreparedAllBranchesPersistence {
  readonly session: PreparedArchiveBranchPresentation;
  readonly structural: AllBranchesStructuralBudgetResult;
  readonly requestedOutputs: readonly PersistentOutputDestination[];
}

interface Measurement {
  entries: ArchiveBranchIndexEntry[];
  leafBytes: Map<PersistentOutputDestination, number[]>;
  indexBytes: Map<PersistentOutputDestination, number>;
  omissionBranchCount: number;
  canonicalOnlyCount: number;
  measuredLeaves: number;
  plannedPhysicalBytes: number;
  budgetKind?: AllBranchesBudgetKind;
  failed: boolean;
  cancelled: boolean;
}

const yieldToTaskQueue = (): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, 0);
  });

function durableOutputs(outputs: OutputDestination[]): PersistentOutputDestination[] {
  return outputs.filter(
    (output): output is PersistentOutputDestination => output === 'file' || output === 'obsidian'
  );
}

export function prepareAllBranchesPersistence(
  plan: AllBranchesPresentationPlan,
  companion: ArchiveCompanionBundle,
  templateOptions: TemplateOptions,
  includeToolContent: boolean,
  outputs: OutputDestination[],
  archiveAlreadyPersisted = false
): PreparedAllBranchesPersistence {
  requireCompleteCompanion(companion);
  const session = prepareArchiveBranchPresentation(
    plan.archive,
    plan.catalog,
    templateOptions,
    companion.captureId,
    includeToolContent
  );
  const requestedOutputs = durableOutputs(outputs);
  return {
    session,
    requestedOutputs: Object.freeze([...requestedOutputs]),
    structural: structuralBudgetPreflight(
      session.metrics,
      requestedOutputs.length,
      companion.artifacts.length,
      archiveAlreadyPersisted
    ),
  };
}

function destinationSummary(
  destination: PersistentOutputDestination,
  archiveAlreadyPersisted: boolean
): AllBranchesDestinationSummary {
  return {
    destination,
    archiveSaved: archiveAlreadyPersisted,
    archiveState: archiveAlreadyPersisted ? 'confirmed' : 'not-attempted',
    branchFilesSaved: 0,
    branchWrites: { confirmed: 0, failed: 0, unknown: 0 },
    indexSaved: false,
    indexState: 'not-attempted',
    dispatchedBytes: 0,
    confirmedBytes: 0,
  };
}

function requireCompleteCompanion(companion: ArchiveCompanionBundle): void {
  if (!companion.artifacts.some(artifact => artifact.kind === 'canonical')) {
    throw new Error('All-branches presentation requires a complete canonical archive companion.');
  }
}

function indexEntry(leaf: ArchiveBranchLeafRender): ArchiveBranchIndexEntry {
  return {
    ordinal: leaf.ordinal,
    fileName: leaf.note.fileName,
    canonicalMessageCount: leaf.canonicalMessageCount,
    renderedMessageCount: leaf.renderedMessageCount,
    uniqueMessageCount: leaf.uniqueMessageCount,
    isCurrent: leaf.isCurrent,
    status: leaf.status,
  };
}

function aborted(dependencies: AllBranchesPersistenceDependencies): boolean {
  return dependencies.signal?.aborted === true;
}

async function yieldTask(dependencies: AllBranchesPersistenceDependencies): Promise<void> {
  await (dependencies.yieldTask ?? yieldToTaskQueue)();
}

async function safeWrite(
  dependencies: AllBranchesPersistenceDependencies,
  note: ObsidianNote,
  destination: PersistentOutputDestination,
  messageCount: number
): Promise<AllBranchesWriteOutcome> {
  try {
    const outcome = await dependencies.writeNote(note, destination, messageCount);
    return outcome === 'confirmed' || outcome === 'failed' || outcome === 'unknown'
      ? outcome
      : 'unknown';
  } catch {
    return 'failed';
  }
}

async function prepareDestinations(
  companion: ArchiveCompanionBundle,
  destinations: AllBranchesDestinationSummary[],
  dependencies: AllBranchesPersistenceDependencies
): Promise<void> {
  if (dependencies.archiveAlreadyPersisted === true) return;
  const archiveBytes = companionPhysicalBytes(companion);
  for (const destination of destinations) {
    if (aborted(dependencies)) return;
    try {
      const warnings = await dependencies.persistCompanions(
        companion,
        'chatgpt-all-branches.md',
        'chatgpt',
        [destination.destination]
      );
      destination.archiveSaved = warnings.length === 0;
      destination.archiveState = warnings.length === 0 ? 'confirmed' : 'failed';
      if (destination.archiveSaved) {
        destination.dispatchedBytes = archiveBytes;
        destination.confirmedBytes = archiveBytes;
      }
    } catch {
      destination.archiveSaved = false;
      destination.archiveState = 'failed';
    }
    if (aborted(dependencies)) return;
    await yieldTask(dependencies);
  }
}

function emptyMeasurement(destinations: readonly AllBranchesDestinationSummary[]): Measurement {
  return {
    entries: [],
    leafBytes: new Map(destinations.map(({ destination }) => [destination, []])),
    indexBytes: new Map(),
    omissionBranchCount: 0,
    canonicalOnlyCount: 0,
    measuredLeaves: 0,
    plannedPhysicalBytes: 0,
    failed: false,
    cancelled: false,
  };
}

// eslint-disable-next-line max-lines-per-function -- Measurement is a single fail-closed pass with one release point per leaf.
async function measurePresentation(
  session: PreparedArchiveBranchPresentation,
  companion: ArchiveCompanionBundle,
  destinations: AllBranchesDestinationSummary[],
  dependencies: AllBranchesPersistenceDependencies
): Promise<Measurement> {
  const measurement = emptyMeasurement(destinations);
  const budget = new ExactPresentationBudget(
    destinations.map(({ destination }) => destination),
    companionPhysicalBytes(companion)
  );
  measurement.plannedPhysicalBytes = budget.totalPhysicalBytes;
  try {
    for (let ordinal = 1; ordinal <= session.branchCount; ordinal += 1) {
      if (aborted(dependencies)) {
        measurement.cancelled = true;
        return measurement;
      }
      const leaf = session.renderLeaf(ordinal);
      measurement.entries.push(indexEntry(leaf));
      measurement.measuredLeaves = ordinal;
      if (leaf.warnings.some(warning => warning.startsWith('Legacy Markdown omitted'))) {
        measurement.omissionBranchCount += 1;
      }
      if (leaf.status === 'canonical-only') measurement.canonicalOnlyCount += 1;
      for (const { destination } of destinations) {
        const bytes = dependencies.measureNoteBytes(leaf.note, destination);
        const exceeded = budget.addNote(destination, bytes);
        if (exceeded) {
          measurement.budgetKind = exceeded;
          measurement.plannedPhysicalBytes = budget.totalPhysicalBytes;
          return measurement;
        }
        measurement.leafBytes.get(destination)!.push(bytes);
      }
      measurement.plannedPhysicalBytes = budget.totalPhysicalBytes;
      await yieldTask(dependencies);
    }
    if (aborted(dependencies)) {
      measurement.cancelled = true;
      return measurement;
    }
    const index = session.renderIndex(measurement.entries);
    for (const { destination } of destinations) {
      const bytes = dependencies.measureNoteBytes(index, destination);
      const exceeded = budget.addNote(destination, bytes);
      if (exceeded) {
        measurement.budgetKind = exceeded;
        measurement.plannedPhysicalBytes = budget.totalPhysicalBytes;
        return measurement;
      }
      measurement.indexBytes.set(destination, bytes);
    }
    measurement.plannedPhysicalBytes = budget.totalPhysicalBytes;
    return measurement;
  } catch {
    measurement.failed = true;
    return measurement;
  }
}

function recordWrite(
  destination: AllBranchesDestinationSummary,
  outcome: AllBranchesWriteOutcome,
  bytes: number,
  index: boolean
): void {
  destination.dispatchedBytes = checkedAdd(
    destination.dispatchedBytes,
    bytes,
    'dispatched output bytes'
  );
  if (index) {
    destination.indexState = outcome;
    destination.indexSaved = outcome === 'confirmed';
  } else {
    destination.branchWrites[outcome] += 1;
    if (outcome === 'confirmed') destination.branchFilesSaved += 1;
  }
  if (outcome === 'confirmed') {
    destination.confirmedBytes = checkedAdd(
      destination.confirmedBytes,
      bytes,
      'confirmed output bytes'
    );
  }
}

async function writeLeaves(
  session: PreparedArchiveBranchPresentation,
  destinations: AllBranchesDestinationSummary[],
  measurement: Measurement,
  dependencies: AllBranchesPersistenceDependencies
): Promise<number> {
  let renderedLeaves = 0;
  const blockedDestinations = new Set<PersistentOutputDestination>();
  for (let ordinal = 1; ordinal <= session.branchCount; ordinal += 1) {
    if (aborted(dependencies)) return renderedLeaves;
    const leaf = session.renderLeaf(ordinal);
    renderedLeaves = ordinal;
    for (const destination of destinations) {
      if (aborted(dependencies)) return renderedLeaves;
      if (blockedDestinations.has(destination.destination)) continue;
      const bytes = measurement.leafBytes.get(destination.destination)![ordinal - 1];
      const outcome = await safeWrite(
        dependencies,
        leaf.note,
        destination.destination,
        leaf.renderedMessageCount
      );
      recordWrite(destination, outcome, bytes, false);
      if (outcome === 'unknown') blockedDestinations.add(destination.destination);
      await yieldTask(dependencies);
      if (aborted(dependencies)) return renderedLeaves;
    }
    dependencies.onProgress?.(ordinal, session.branchCount);
    await yieldTask(dependencies);
  }
  return renderedLeaves;
}

async function writeIndex(
  session: PreparedArchiveBranchPresentation,
  measurement: Measurement,
  destinations: AllBranchesDestinationSummary[],
  dependencies: AllBranchesPersistenceDependencies
): Promise<boolean> {
  const completeDestinations = destinations.filter(
    destination =>
      destination.branchFilesSaved === session.branchCount && destination.branchWrites.unknown === 0
  );
  if (completeDestinations.length === 0) return false;
  if (aborted(dependencies)) return true;
  const index = session.renderIndex(measurement.entries);
  for (const [destinationIndex, destination] of completeDestinations.entries()) {
    if (aborted(dependencies)) return true;
    const bytes = measurement.indexBytes.get(destination.destination)!;
    const outcome = await safeWrite(
      dependencies,
      index,
      destination.destination,
      index.frontmatter.message_count
    );
    recordWrite(destination, outcome, bytes, true);
    await yieldTask(dependencies);
    if (aborted(dependencies) && destinationIndex + 1 < completeDestinations.length) return true;
  }
  return false;
}

function finalizeSummary(
  base: Omit<AllBranchesPersistenceSummary, 'status' | 'allSuccessful'>,
  forcedStatus?: AllBranchesPersistenceStatus
): AllBranchesPersistenceSummary {
  const allSuccessful =
    base.destinations.length > 0 &&
    base.destinations.every(
      destination =>
        destination.archiveSaved &&
        destination.branchFilesSaved === base.branchCount &&
        destination.indexSaved
    );
  const anySaved = base.destinations.some(
    destination =>
      destination.archiveSaved || destination.branchFilesSaved > 0 || destination.indexSaved
  );
  const status = forcedStatus ?? (allSuccessful ? 'complete' : anySaved ? 'partial' : 'failed');
  return { ...base, status, allSuccessful };
}

/** Persist one bounded capture as archive evidence plus exact sequential leaf views. */
// eslint-disable-next-line max-lines-per-function, complexity -- Keep the phase ordering visible: preflight, evidence, dry measure, writes, index.
export async function persistAllBranchesPresentation(
  plan: AllBranchesPresentationPlan,
  companion: ArchiveCompanionBundle,
  templateOptions: TemplateOptions,
  includeToolContent: boolean,
  outputs: OutputDestination[],
  dependencies: AllBranchesPersistenceDependencies
): Promise<AllBranchesPersistenceSummary> {
  const requested = durableOutputs(outputs);
  const prepared =
    dependencies.prepared ??
    prepareAllBranchesPersistence(
      plan,
      companion,
      templateOptions,
      includeToolContent,
      outputs,
      dependencies.archiveAlreadyPersisted === true
    );
  if (requested.some(destination => !prepared.requestedOutputs.includes(destination))) {
    throw new Error('All-branches outputs exceed their structural preflight.');
  }
  const { session, structural } = prepared;
  const destinations = requested.map(destination =>
    destinationSummary(destination, dependencies.archiveAlreadyPersisted === true)
  );
  if (dependencies.archiveAlreadyPersisted === true) {
    const archiveBytes = companionPhysicalBytes(companion);
    for (const destination of destinations) {
      destination.dispatchedBytes = archiveBytes;
      destination.confirmedBytes = archiveBytes;
    }
  }
  const base = {
    version: 1 as const,
    phase: 'structural-preflight' as AllBranchesPersistencePhase,
    cancelRequested: aborted(dependencies),
    metrics: session.metrics,
    plannedArtifactWrites: structural.plannedArtifactWrites,
    plannedPhysicalBytes: 0,
    measuredLeaves: 0,
    renderedLeaves: 0,
    branchCount: session.branchCount,
    omissionBranchCount: 0,
    canonicalOnlyCount: 0,
    clipboardSkipped: outputs.includes('clipboard'),
    destinations,
  };
  if (!structural.accepted) {
    return finalizeSummary({ ...base, budgetKind: structural.budgetKind }, 'rejected');
  }
  if (base.cancelRequested) return finalizeSummary(base, 'cancelled');
  if (destinations.length === 0) return finalizeSummary(base, 'failed');

  await prepareDestinations(companion, destinations, dependencies);
  if (aborted(dependencies)) {
    return finalizeSummary({ ...base, phase: 'archive', cancelRequested: true }, 'cancelled');
  }
  const active = destinations.filter(destination => destination.archiveSaved);
  if (active.length === 0) return finalizeSummary({ ...base, phase: 'archive' }, 'failed');

  const measurement = await measurePresentation(session, companion, active, dependencies);
  const measured = {
    ...base,
    phase: 'measurement' as const,
    plannedPhysicalBytes: measurement.plannedPhysicalBytes,
    measuredLeaves: measurement.measuredLeaves,
    omissionBranchCount: measurement.omissionBranchCount,
    canonicalOnlyCount: measurement.canonicalOnlyCount,
  };
  if (measurement.cancelled || aborted(dependencies)) {
    return finalizeSummary({ ...measured, cancelRequested: true }, 'cancelled');
  }
  if (measurement.budgetKind) {
    return finalizeSummary({ ...measured, budgetKind: measurement.budgetKind }, 'rejected');
  }
  if (measurement.failed) return finalizeSummary(measured, 'failed');

  const renderedLeaves = await writeLeaves(session, active, measurement, dependencies);
  const written = { ...measured, phase: 'writing' as const, renderedLeaves };
  if (aborted(dependencies)) {
    return finalizeSummary({ ...written, cancelRequested: true }, 'cancelled');
  }
  const stoppedBeforeAllIndexes = await writeIndex(session, measurement, active, dependencies);
  if (stoppedBeforeAllIndexes) {
    return finalizeSummary({ ...written, phase: 'index', cancelRequested: true }, 'cancelled');
  }
  return finalizeSummary({ ...written, phase: 'complete' });
}
