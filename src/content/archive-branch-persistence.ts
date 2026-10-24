/* eslint-disable max-lines -- One phase coordinator shares Markdown and opt-in HTML budgets; HTML delivery mechanics are isolated in archive-branch-html-delivery. */
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
  snapshotChatGptDestinationArchiveReceipt,
  type ChatGptDestinationArchiveReceipt,
} from '../lib/chatgpt-archive-receipt';
import { decorateChatGptArchivePresentation } from './chatgpt-archive-links';
import { buildChatGptDestinationArchiveReceipt } from './chatgpt-destination-receipt';
import {
  snapshotOperationWriteLedger,
  type OperationWriteLedgerSnapshot,
} from '../lib/operation-write-ledger';
import {
  checkedAdd,
  destinationRetainedBytes,
  operationArtifactBytes,
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
import {
  createFileHtmlSummary,
  prepareFileHtmlDelivery,
  deliverFileHtml,
  stopFileHtml,
  snapshotFileHtmlRequest,
  type AllBranchesFileHtmlRequest,
  type AllBranchesFileHtmlSeams,
  type AllBranchesFileHtmlSummary,
} from './archive-branch-html-delivery';

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
  confirmedArtifactBytes: number;
  unknownArtifactBytes: number;
  cleanupDeferredArtifactWrites: number;
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
  accountingMode: 'receipts' | 'write-ledger';
  writeLedgerValid?: boolean;
  /** Separate File HTML facts; absent preserves the legacy Markdown summary contract. */
  fileHtml?: AllBranchesFileHtmlSummary;
}

export interface AllBranchesPersistenceDependencies extends AllBranchesFileHtmlSeams {
  fileHtml?: AllBranchesFileHtmlRequest;
  persistArtifacts: (
    companion: ArchiveCompanionBundle,
    noteFileName: string,
    source: AIPlatform,
    outputs: OutputDestination[]
  ) => Promise<{ activeOutputs: PersistentOutputDestination[]; warnings: string[] }>;
  writeNote: (
    note: ObsidianNote,
    destination: PersistentOutputDestination,
    messageCount: number
  ) => Promise<AllBranchesWriteOutcome>;
  fingerprintNote: (
    note: ObsidianNote,
    destination: PersistentOutputDestination
  ) => Promise<AllBranchesNoteFingerprint>;
  signal?: AbortSignal;
  yieldTask?: () => Promise<void>;
  prepared?: PreparedAllBranchesPersistence;
  /** Exact destination-owned evidence; absence selects the original full-trio persistence path. */
  destinationReceipts?: readonly unknown[];
  /** Accounting only, never archive/link eligibility. A provider is read once after archive processing. */
  writeLedgerSnapshot?: unknown;
  onProgress?: (completedBranches: number, totalBranches: number) => void;
}

export interface AllBranchesNoteFingerprint {
  byteLength: number;
  sha256: string;
}

interface MeasuredNote extends AllBranchesNoteFingerprint {
  fileName: string;
}

type DestinationReceipts = Map<PersistentOutputDestination, ChatGptDestinationArchiveReceipt>;

/** Opaque owned session created before any optional attachment/companion writes. */
export interface PreparedAllBranchesPersistence {
  readonly session: PreparedArchiveBranchPresentation;
  readonly structural: AllBranchesStructuralBudgetResult;
  readonly requestedOutputs: readonly PersistentOutputDestination[];
  readonly fileHtmlRequested: boolean;
}

interface Measurement {
  entries: ArchiveBranchIndexEntry[];
  leafNotes: Map<PersistentOutputDestination, MeasuredNote[]>;
  indexNotes: Map<PersistentOutputDestination, MeasuredNote>;
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
  archiveAlreadyPersisted = false,
  fileHtmlRequested = false
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
    fileHtmlRequested,
    structural: structuralBudgetPreflight(
      session.metrics,
      requestedOutputs.length,
      companion.artifacts.length,
      archiveAlreadyPersisted,
      undefined,
      fileHtmlRequested ? { file: true } : undefined
    ),
  };
}

function destinationSummary(
  destination: PersistentOutputDestination
): AllBranchesDestinationSummary {
  return {
    destination,
    archiveSaved: false,
    archiveState: 'not-attempted',
    branchFilesSaved: 0,
    branchWrites: { confirmed: 0, failed: 0, unknown: 0 },
    indexSaved: false,
    indexState: 'not-attempted',
    dispatchedBytes: 0,
    confirmedBytes: 0,
    confirmedArtifactBytes: 0,
    unknownArtifactBytes: 0,
    cleanupDeferredArtifactWrites: 0,
  };
}

function requireCompleteCompanion(companion: ArchiveCompanionBundle): void {
  if (
    !['raw', 'manifest', 'canonical'].every(
      kind => companion.artifacts.filter(artifact => artifact.kind === kind).length === 1
    )
  ) {
    throw new Error('All-branches presentation requires a complete canonical archive companion.');
  }
}

function snapshotReceiptArray(values: unknown): unknown[] | undefined {
  try {
    if (!Array.isArray(values) || Object.getPrototypeOf(values) !== Array.prototype)
      return undefined;
    const length = Object.getOwnPropertyDescriptor(values, 'length')?.value;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > 16) {
      return undefined;
    }
    const descriptors = Object.getOwnPropertyDescriptors(values);
    if (Reflect.ownKeys(values).length !== length + 1) return undefined;
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return undefined;
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return undefined;
  }
}

/** Snapshot once, count malformed duplicates too, and never borrow another capture's evidence. */
function snapshotOwnedReceipts(
  values: readonly unknown[] | undefined,
  companion: ArchiveCompanionBundle,
  requested: readonly PersistentOutputDestination[]
): DestinationReceipts {
  const receipts: DestinationReceipts = new Map();
  const candidatesSnapshot = snapshotReceiptArray(values);
  if (!candidatesSnapshot) return receipts;
  for (const destination of requested) {
    const candidates = candidatesSnapshot.filter(value => {
      try {
        return (
          typeof value === 'object' &&
          value !== null &&
          Object.getOwnPropertyDescriptor(value, 'destination')?.value === destination
        );
      } catch {
        return false;
      }
    });
    if (candidates.length !== 1) continue;
    const receipt = snapshotChatGptDestinationArchiveReceipt(candidates[0]);
    if (
      receipt?.destination === destination &&
      receipt.captureId === companion.captureId &&
      receipt.conversationKey === companion.conversationKey &&
      receipt.archiveByteLengths.raw ===
        companion.artifacts.find(artifact => artifact.kind === 'raw')?.byteLength
    ) {
      try {
        destinationRetainedBytes(receipt);
        receipts.set(destination, receipt);
      } catch {
        // An unrepresentable retained-byte total cannot authorize this destination.
      }
    }
  }
  return receipts;
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
  receipts: DestinationReceipts,
  suppliedReceipts: boolean,
  dependencies: AllBranchesPersistenceDependencies,
  ledgerMode = false
): Promise<void> {
  for (const destination of destinations) {
    if (aborted(dependencies) && !suppliedReceipts) return;
    try {
      if (!suppliedReceipts) {
        const outcome = await dependencies.persistArtifacts(
          companion,
          'chatgpt-all-branches.md',
          'chatgpt',
          [destination.destination]
        );
        if (
          outcome.activeOutputs.length === 1 &&
          outcome.activeOutputs[0] === destination.destination
        ) {
          receipts.set(
            destination.destination,
            buildChatGptDestinationArchiveReceipt(companion, destination.destination, [])
          );
        }
      }
      destination.archiveSaved = receipts.has(destination.destination);
      destination.archiveState = destination.archiveSaved ? 'confirmed' : 'failed';
      if (destination.archiveSaved && !ledgerMode) {
        const retainedBytes = destinationRetainedBytes(receipts.get(destination.destination)!);
        destination.dispatchedBytes = retainedBytes;
        destination.confirmedBytes = retainedBytes;
        destination.confirmedArtifactBytes = retainedBytes;
      }
    } catch {
      destination.archiveSaved = false;
      destination.archiveState = 'failed';
    }
    if (aborted(dependencies) && !suppliedReceipts) return;
    if (!suppliedReceipts) await yieldTask(dependencies);
  }
}

/** Invalid supplied accounting never selects the legacy receipt-only fallback. */
function seedArtifactAccounting(
  dependencies: AllBranchesPersistenceDependencies,
  companion: ArchiveCompanionBundle,
  destinations: AllBranchesDestinationSummary[],
  receipts: DestinationReceipts
): boolean {
  try {
    const value =
      typeof dependencies.writeLedgerSnapshot === 'function'
        ? dependencies.writeLedgerSnapshot()
        : dependencies.writeLedgerSnapshot;
    const ledger = snapshotOperationWriteLedger(value, companion.captureId);
    if (
      !ledger ||
      ledger.observations.some(
        entry => !destinations.some(row => row.destination === entry.destination)
      ) ||
      !ledgerCoversReceipts(ledger, receipts)
    )
      return false;
    for (const destination of destinations) {
      const totals = operationArtifactBytes(ledger, destination.destination);
      destination.confirmedArtifactBytes = totals.confirmed;
      destination.unknownArtifactBytes = totals.unknown;
      destination.cleanupDeferredArtifactWrites = totals.cleanupDeferred;
      destination.confirmedBytes = totals.confirmed;
      destination.dispatchedBytes = checkedAdd(totals.confirmed, totals.unknown, 'artifact bytes');
    }
    return true;
  } catch {
    return false;
  }
}

/** A valid-looking but incomplete snapshot cannot undercount receipt-proven writes. */
function ledgerCoversReceipts(
  ledger: OperationWriteLedgerSnapshot,
  receipts: DestinationReceipts
): boolean {
  for (const [destination, receipt] of receipts) {
    const confirmed = ledger.observations.filter(
      entry => entry.destination === destination && entry.state === 'confirmed'
    );
    if (
      !(['raw', 'manifest', 'canonical'] as const).every(kind =>
        confirmed.some(
          entry => entry.kind === kind && entry.byteLength === receipt.archiveByteLengths[kind]
        )
      )
    )
      return false;
    const requiredBinary = receipt.assets.reduce(
      (sum, asset) => checkedAdd(sum, asset.byteLength, 'receipt binary bytes'),
      0
    );
    const recordedBinary = confirmed
      .filter(entry => entry.kind === 'binary')
      .reduce((sum, entry) => checkedAdd(sum, entry.byteLength, 'recorded binary bytes'), 0);
    if (recordedBinary < requiredBinary) return false;
  }
  return true;
}

function emptyMeasurement(destinations: readonly AllBranchesDestinationSummary[]): Measurement {
  return {
    entries: [],
    leafNotes: new Map(destinations.map(({ destination }) => [destination, []])),
    indexNotes: new Map(),
    omissionBranchCount: 0,
    canonicalOnlyCount: 0,
    measuredLeaves: 0,
    plannedPhysicalBytes: 0,
    failed: false,
    cancelled: false,
  };
}

async function fingerprintPresentation(
  note: ObsidianNote,
  destination: PersistentOutputDestination,
  receipts: DestinationReceipts,
  dependencies: AllBranchesPersistenceDependencies
): Promise<{ note: ObsidianNote; measured: MeasuredNote }> {
  const decorated = decorateChatGptArchivePresentation(note, receipts.get(destination));
  const { byteLength, sha256 } = await dependencies.fingerprintNote(decorated, destination);
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('Invalid serialized presentation fingerprint.');
  }
  return { note: decorated, measured: { fileName: decorated.fileName, byteLength, sha256 } };
}

function sameMeasuredNote(left: MeasuredNote, right: MeasuredNote | undefined): boolean {
  return (
    left.fileName === right?.fileName &&
    left.byteLength === right.byteLength &&
    left.sha256 === right.sha256
  );
}

async function recreateMeasuredPresentation(
  note: ObsidianNote,
  destination: PersistentOutputDestination,
  expected: MeasuredNote | undefined,
  receipts: DestinationReceipts,
  dependencies: AllBranchesPersistenceDependencies
): Promise<Awaited<ReturnType<typeof fingerprintPresentation>> | undefined> {
  try {
    const recreated = await fingerprintPresentation(note, destination, receipts, dependencies);
    return sameMeasuredNote(recreated.measured, expected) ? recreated : undefined;
  } catch {
    return undefined;
  }
}

// eslint-disable-next-line max-lines-per-function -- Measurement is a single fail-closed pass with one release point per leaf.
async function measurePresentation(
  session: PreparedArchiveBranchPresentation,
  destinations: AllBranchesDestinationSummary[],
  receipts: DestinationReceipts,
  dependencies: AllBranchesPersistenceDependencies,
  budget: ExactPresentationBudget
): Promise<Measurement> {
  const measurement = emptyMeasurement(destinations);
  measurement.plannedPhysicalBytes = budget.totalPhysicalBytes;
  const initialExceeded = budget.preflight();
  if (initialExceeded) {
    measurement.budgetKind = initialExceeded;
    return measurement;
  }
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
        const { measured } = await fingerprintPresentation(
          leaf.note,
          destination,
          receipts,
          dependencies
        );
        const exceeded = budget.addNote(destination, measured.byteLength);
        if (exceeded) {
          measurement.budgetKind = exceeded;
          measurement.plannedPhysicalBytes = budget.totalPhysicalBytes;
          return measurement;
        }
        measurement.leafNotes.get(destination)!.push(measured);
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
      const { measured } = await fingerprintPresentation(
        index,
        destination,
        receipts,
        dependencies
      );
      const exceeded = budget.addNote(destination, measured.byteLength);
      if (exceeded) {
        measurement.budgetKind = exceeded;
        measurement.plannedPhysicalBytes = budget.totalPhysicalBytes;
        return measurement;
      }
      measurement.indexNotes.set(destination, measured);
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
  receipts: DestinationReceipts,
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
      const recreated = await recreateMeasuredPresentation(
        leaf.note,
        destination.destination,
        measurement.leafNotes.get(destination.destination)?.[ordinal - 1],
        receipts,
        dependencies
      );
      if (!recreated) {
        recordWrite(destination, 'failed', 0, false);
        blockedDestinations.add(destination.destination);
        continue;
      }
      if (aborted(dependencies)) return renderedLeaves;
      const outcome = await safeWrite(
        dependencies,
        recreated.note,
        destination.destination,
        leaf.renderedMessageCount
      );
      recordWrite(destination, outcome, recreated.measured.byteLength, false);
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
  receipts: DestinationReceipts,
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
    const recreated = await recreateMeasuredPresentation(
      index,
      destination.destination,
      measurement.indexNotes.get(destination.destination),
      receipts,
      dependencies
    );
    if (!recreated) {
      recordWrite(destination, 'failed', 0, true);
      continue;
    }
    if (aborted(dependencies)) return true;
    const outcome = await safeWrite(
      dependencies,
      recreated.note,
      destination.destination,
      index.frontmatter.message_count
    );
    recordWrite(destination, outcome, recreated.measured.byteLength, true);
    await yieldTask(dependencies);
    if (aborted(dependencies) && destinationIndex + 1 < completeDestinations.length) return true;
  }
  return false;
}

function finalizeSummary(
  base: Omit<AllBranchesPersistenceSummary, 'status' | 'allSuccessful'>,
  forcedStatus?: AllBranchesPersistenceStatus
): AllBranchesPersistenceSummary {
  if (base.fileHtml && (base.fileHtml.status === 'not-attempted' || forcedStatus === 'cancelled')) {
    stopFileHtml(
      base.fileHtml,
      forcedStatus === 'cancelled'
        ? 'cancelled'
        : base.budgetKind
          ? 'budget-exceeded'
          : 'presentation-not-started',
      base.budgetKind
    );
  }
  const allSuccessful =
    (!base.fileHtml || base.fileHtml.status === 'complete') &&
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
// eslint-disable-next-line max-lines-per-function, complexity -- Keep fail-closed phase ordering visible: preflight, immutable accounting, receipt gating, dry measure, writes, index.
export async function persistAllBranchesPresentation(
  plan: AllBranchesPresentationPlan,
  companion: ArchiveCompanionBundle,
  templateOptions: TemplateOptions,
  includeToolContent: boolean,
  outputs: OutputDestination[],
  dependencies: AllBranchesPersistenceDependencies
): Promise<AllBranchesPersistenceSummary> {
  const requested = durableOutputs(outputs);
  const ownedCompanion = structuredClone(companion);
  requireCompleteCompanion(ownedCompanion);
  const suppliedReceipts = dependencies.destinationReceipts !== undefined;
  // Keep the original expected-settings string throughout both passes and every dispatch.
  const fileHtmlRequest = snapshotFileHtmlRequest(dependencies.fileHtml);
  const htmlControls = {
    signal: dependencies.signal,
    yieldTask: () => yieldTask(dependencies),
    prepareDerivedBranchHtmlPlan: dependencies.prepareDerivedBranchHtmlPlan,
    buildFinalizedFileArchivePresentationEvidence:
      dependencies.buildFinalizedFileArchivePresentationEvidence,
    persistDerivedBranchHtmlArtifactForFile: dependencies.persistDerivedBranchHtmlArtifactForFile,
  };
  const ledgerMode = Object.prototype.hasOwnProperty.call(dependencies, 'writeLedgerSnapshot');
  const receipts = snapshotOwnedReceipts(
    dependencies.destinationReceipts,
    ownedCompanion,
    requested
  );
  const prepared =
    dependencies.prepared ??
    prepareAllBranchesPersistence(
      plan,
      ownedCompanion,
      templateOptions,
      includeToolContent,
      outputs,
      suppliedReceipts,
      fileHtmlRequest !== undefined
    );
  if (
    (prepared.fileHtmlRequested === true) !== (fileHtmlRequest !== undefined) ||
    (fileHtmlRequest !== undefined && !requested.includes('file'))
  ) {
    throw new Error('All-branches HTML request differs from its structural preflight.');
  }
  if (requested.some(destination => !prepared.requestedOutputs.includes(destination))) {
    throw new Error('All-branches outputs exceed their structural preflight.');
  }
  const { session, structural } = prepared;
  const destinations = requested.map(destinationSummary);
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
    accountingMode: ledgerMode ? ('write-ledger' as const) : ('receipts' as const),
    ...(ledgerMode && { writeLedgerValid: false }),
    ...(fileHtmlRequest && { fileHtml: createFileHtmlSummary(session.branchCount) }),
  };
  if (ledgerMode && (!structural.accepted || base.cancelRequested)) {
    // Attachment processing may already have written artifacts before cancellation.
    await prepareDestinations(ownedCompanion, destinations, receipts, true, dependencies, true);
    base.writeLedgerValid = seedArtifactAccounting(
      dependencies,
      ownedCompanion,
      destinations,
      receipts
    );
    if (!base.writeLedgerValid) return finalizeSummary(base, 'rejected');
    base.plannedPhysicalBytes = new ExactPresentationBudget(
      new Map(destinations.map(row => [row.destination, row.dispatchedBytes]))
    ).totalPhysicalBytes;
  }
  if (!structural.accepted) {
    return finalizeSummary({ ...base, budgetKind: structural.budgetKind }, 'rejected');
  }
  if (base.cancelRequested) return finalizeSummary(base, 'cancelled');
  if (destinations.length === 0) return finalizeSummary(base, 'failed');

  await prepareDestinations(
    ownedCompanion,
    destinations,
    receipts,
    suppliedReceipts,
    dependencies,
    ledgerMode
  );
  if (ledgerMode) {
    base.writeLedgerValid = seedArtifactAccounting(
      dependencies,
      ownedCompanion,
      destinations,
      receipts
    );
    if (!base.writeLedgerValid) return finalizeSummary({ ...base, phase: 'archive' }, 'rejected');
  }
  const active = destinations.filter(destination => destination.archiveSaved);
  const budget = new ExactPresentationBudget(
    new Map(
      (ledgerMode ? destinations : active).map(({ destination, dispatchedBytes }) => [
        destination,
        dispatchedBytes,
      ])
    )
  );
  base.plannedPhysicalBytes = budget.totalPhysicalBytes;
  const initialBudgetExceeded = budget.preflight();
  if (initialBudgetExceeded && ledgerMode)
    return finalizeSummary(
      { ...base, phase: 'archive', budgetKind: initialBudgetExceeded },
      'rejected'
    );
  if (aborted(dependencies)) {
    return finalizeSummary({ ...base, phase: 'archive', cancelRequested: true }, 'cancelled');
  }
  if (active.length === 0) return finalizeSummary({ ...base, phase: 'archive' }, 'failed');

  const measurement = await measurePresentation(session, active, receipts, dependencies, budget);
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

  const htmlPlan =
    fileHtmlRequest && measured.fileHtml
      ? await prepareFileHtmlDelivery(
          plan,
          ownedCompanion,
          fileHtmlRequest,
          suppliedReceipts,
          receipts.get('file'),
          session.branchCount,
          budget,
          measured.fileHtml,
          htmlControls
        )
      : undefined;
  measured.plannedPhysicalBytes = budget.totalPhysicalBytes;
  if (measured.fileHtml?.cancelRequested || aborted(dependencies)) {
    return finalizeSummary({ ...measured, cancelRequested: true }, 'cancelled');
  }
  if (measured.fileHtml?.status === 'rejected') {
    return finalizeSummary({ ...measured, budgetKind: measured.fileHtml.budgetKind }, 'rejected');
  }

  const renderedLeaves = await writeLeaves(session, active, measurement, receipts, dependencies);
  const written = { ...measured, phase: 'writing' as const, renderedLeaves };
  if (aborted(dependencies)) {
    return finalizeSummary({ ...written, cancelRequested: true }, 'cancelled');
  }
  const stoppedBeforeAllIndexes = await writeIndex(
    session,
    measurement,
    active,
    receipts,
    dependencies
  );
  if (stoppedBeforeAllIndexes) {
    return finalizeSummary({ ...written, phase: 'index', cancelRequested: true }, 'cancelled');
  }
  if (fileHtmlRequest && written.fileHtml) {
    if (aborted(dependencies)) {
      stopFileHtml(written.fileHtml, 'cancelled');
      return finalizeSummary({ ...written, cancelRequested: true }, 'cancelled');
    }
    const file = destinations.find(destination => destination.destination === 'file');
    if (htmlPlan && file && (file.branchWrites.unknown > 0 || file.indexState === 'unknown')) {
      stopFileHtml(written.fileHtml, 'file-markdown-unknown');
    } else if (htmlPlan) {
      await deliverFileHtml(
        htmlPlan,
        {
          source: 'chatgpt',
          captureId: ownedCompanion.captureId,
          conversationKey: ownedCompanion.conversationKey,
        },
        fileHtmlRequest.expectedSyncSettingsSnapshot,
        written.fileHtml,
        htmlControls
      );
    }
    if (written.fileHtml.cancelRequested || aborted(dependencies)) {
      return finalizeSummary({ ...written, cancelRequested: true }, 'cancelled');
    }
  }
  return finalizeSummary({ ...written, phase: 'complete' });
}
