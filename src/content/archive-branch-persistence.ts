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
  renderArchiveBranchIndex,
  renderArchiveBranchLeaf,
  type ArchiveBranchIndexEntry,
} from './archive-branch-bundle';

export interface AllBranchesDestinationSummary {
  destination: PersistentOutputDestination;
  archiveSaved: boolean;
  branchFilesSaved: number;
  indexSaved: boolean;
}

export interface AllBranchesPersistenceSummary {
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
  ) => Promise<boolean>;
  /** The caller already completed raw -> manifest -> canonical for every output. */
  archiveAlreadyPersisted?: boolean;
  onProgress?: (completedBranches: number, totalBranches: number) => void;
}

function durableOutputs(outputs: OutputDestination[]): PersistentOutputDestination[] {
  return outputs.filter(
    (output): output is PersistentOutputDestination => output === 'file' || output === 'obsidian'
  );
}

function requireCompleteCompanion(companion: ArchiveCompanionBundle): void {
  if (!companion.artifacts.some(artifact => artifact.kind === 'canonical')) {
    throw new Error('All-branches presentation requires a complete canonical archive companion.');
  }
}

function indexEntry(leaf: ReturnType<typeof renderArchiveBranchLeaf>): ArchiveBranchIndexEntry {
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

async function safeWrite(
  dependencies: AllBranchesPersistenceDependencies,
  note: ObsidianNote,
  destination: PersistentOutputDestination,
  messageCount: number
): Promise<boolean> {
  try {
    return await dependencies.writeNote(note, destination, messageCount);
  } catch {
    return false;
  }
}

async function prepareDestinations(
  companion: ArchiveCompanionBundle,
  outputs: OutputDestination[],
  dependencies: AllBranchesPersistenceDependencies
): Promise<AllBranchesDestinationSummary[]> {
  const destinations: AllBranchesDestinationSummary[] = [];
  for (const destination of durableOutputs(outputs)) {
    if (dependencies.archiveAlreadyPersisted === true) {
      destinations.push({
        destination,
        archiveSaved: true,
        branchFilesSaved: 0,
        indexSaved: false,
      });
      continue;
    }
    const warnings = await dependencies.persistCompanions(
      companion,
      'chatgpt-all-branches.md',
      'chatgpt',
      [destination]
    );
    destinations.push({
      destination,
      archiveSaved: warnings.length === 0,
      branchFilesSaved: 0,
      indexSaved: false,
    });
  }
  return destinations;
}

async function writeLeaves(
  plan: AllBranchesPresentationPlan,
  companion: ArchiveCompanionBundle,
  templateOptions: TemplateOptions,
  includeToolContent: boolean,
  destinations: AllBranchesDestinationSummary[],
  dependencies: AllBranchesPersistenceDependencies
): Promise<{
  entries: ArchiveBranchIndexEntry[];
  omissionBranchCount: number;
  canonicalOnlyCount: number;
}> {
  const entries: ArchiveBranchIndexEntry[] = [];
  let omissionBranchCount = 0;
  let canonicalOnlyCount = 0;
  for (const branch of plan.catalog.branches) {
    const leaf = renderArchiveBranchLeaf(
      plan.archive,
      plan.catalog,
      branch,
      templateOptions,
      companion.captureId,
      includeToolContent
    );
    entries.push(indexEntry(leaf));
    if (leaf.warnings.some(warning => warning.startsWith('Legacy Markdown omitted'))) {
      omissionBranchCount += 1;
    }
    if (leaf.status === 'canonical-only') canonicalOnlyCount += 1;
    for (const destination of destinations) {
      if (
        await safeWrite(dependencies, leaf.note, destination.destination, leaf.renderedMessageCount)
      ) {
        destination.branchFilesSaved += 1;
      }
    }
    dependencies.onProgress?.(branch.ordinal, plan.catalog.branches.length);
  }
  return { entries, omissionBranchCount, canonicalOnlyCount };
}

async function writeIndex(
  plan: AllBranchesPresentationPlan,
  companion: ArchiveCompanionBundle,
  templateOptions: TemplateOptions,
  entries: ArchiveBranchIndexEntry[],
  destinations: AllBranchesDestinationSummary[],
  dependencies: AllBranchesPersistenceDependencies
): Promise<void> {
  const completeDestinations = destinations.filter(
    destination => destination.branchFilesSaved === plan.catalog.branches.length
  );
  if (completeDestinations.length === 0) return;
  const index = renderArchiveBranchIndex(
    plan.archive,
    plan.catalog,
    entries,
    templateOptions,
    companion.captureId
  );
  for (const destination of completeDestinations) {
    destination.indexSaved = await safeWrite(
      dependencies,
      index,
      destination.destination,
      index.frontmatter.message_count
    );
  }
}

/**
 * Persist one capture as one archive bundle plus sequential per-leaf views.
 * Only the current leaf note is retained while it is being written; shared
 * branch prefixes are reconstructed lazily by the renderer.
 */
export async function persistAllBranchesPresentation(
  plan: AllBranchesPresentationPlan,
  companion: ArchiveCompanionBundle,
  templateOptions: TemplateOptions,
  includeToolContent: boolean,
  outputs: OutputDestination[],
  dependencies: AllBranchesPersistenceDependencies
): Promise<AllBranchesPersistenceSummary> {
  requireCompleteCompanion(companion);
  const destinations = await prepareDestinations(companion, outputs, dependencies);
  const active = destinations.filter(destination => destination.archiveSaved);
  let omissionBranchCount = 0;
  let canonicalOnlyCount = 0;

  if (active.length > 0) {
    const rendered = await writeLeaves(
      plan,
      companion,
      templateOptions,
      includeToolContent,
      active,
      dependencies
    );
    omissionBranchCount = rendered.omissionBranchCount;
    canonicalOnlyCount = rendered.canonicalOnlyCount;
    await writeIndex(plan, companion, templateOptions, rendered.entries, active, dependencies);
  }

  const branchCount = plan.catalog.branches.length;
  const allSuccessful =
    destinations.length > 0 &&
    destinations.every(
      destination =>
        destination.archiveSaved &&
        destination.branchFilesSaved === branchCount &&
        destination.indexSaved
    );
  return {
    branchCount,
    omissionBranchCount,
    canonicalOnlyCount,
    clipboardSkipped: outputs.includes('clipboard'),
    destinations,
    allSuccessful,
  };
}
