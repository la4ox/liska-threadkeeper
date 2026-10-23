/**
 * Capture-scoped Markdown views for every declared canonical archive leaf.
 *
 * The canonical archive and raw capture are persisted elsewhere exactly once.
 * This module intentionally renders one requested leaf at a time and builds a
 * small index from already-rendered leaf facts; it never joins sibling content.
 */

import { getNodePath, validateLiskaThreadArchive } from '../archive';
import type { ArchiveBranchCatalog, ArchiveBranchDescriptor, LiskaThreadArchive } from '../archive';
import { generateContentHash } from './markdown';
import { conversationToNote } from './markdown';
import {
  ArchiveProjectionError,
  projectArchiveBranch,
  type ArchiveProjectionResult,
} from './archive-projection';
import {
  prepareArchiveBranchGraph,
  type PreparedArchiveBranchGraph,
} from './archive-branch-prepared';
import type { ArchiveBranchWorkMetrics } from './archive-branch-budget';
import { ALL_PLATFORMS, platformOrigin } from '../lib/platform-registry';
import type { AIPlatform, ConversationData, ObsidianNote, TemplateOptions } from '../lib/types';
import { normalizeTagTemplates } from '../lib/tag-template';

const CAPTURE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,239}$/;
const SAFE_NOTE_FILENAME_PATTERN =
  /^[A-Za-z0-9\u3000-\u9fff\uac00-\ud7af][A-Za-z0-9\u3000-\u9fff\uac00-\ud7af._-]*\.md$/;

export type ArchiveBranchLeafStatus = 'rendered' | 'canonical-only';

/** Minimal, content-free fact set needed to place one leaf in the bundle index. */
export interface ArchiveBranchIndexEntry {
  ordinal: number;
  fileName: string;
  canonicalMessageCount: number;
  renderedMessageCount: number;
  uniqueMessageCount: number;
  isCurrent: boolean;
  status: ArchiveBranchLeafStatus;
}

/** Exactly one rendered capture-scoped note and the facts needed for its index entry. */
export interface ArchiveBranchLeafRender {
  note: ObsidianNote;
  warnings: string[];
  ordinal: number;
  canonicalMessageCount: number;
  renderedMessageCount: number;
  uniqueMessageCount: number;
  isCurrent: boolean;
  status: ArchiveBranchLeafStatus;
}

interface CanonicalCounts {
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
}

interface BranchCounts {
  canonicalMessageCount: number;
  uniqueMessageCount: number;
}

/** One validated, owned all-branches session; only one leaf body is materialized at a time. */
export interface PreparedArchiveBranchPresentation {
  readonly branchCount: number;
  readonly metrics: ArchiveBranchWorkMetrics;
  renderLeaf(ordinal: number): ArchiveBranchLeafRender;
  renderIndex(entries: ArchiveBranchIndexEntry[]): ObsidianNote;
}

function requireCaptureId(captureId: string): void {
  if (!CAPTURE_ID_PATTERN.test(captureId)) {
    throw new Error('Invalid archive presentation capture ID.');
  }
}

function captureScopedConversationId(captureId: string): string {
  requireCaptureId(captureId);
  return captureId.slice(-36).toLowerCase();
}

function requireNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}.`);
  }
}

function requireCatalogOrder(catalog: ArchiveBranchCatalog): void {
  if (catalog.branches.length === 0) {
    throw new Error('Archive branch catalog must contain at least one leaf.');
  }

  for (const [index, candidate] of catalog.branches.entries()) {
    if (candidate.ordinal !== index + 1) {
      throw new Error('Archive branch catalog ordinals must be contiguous and deterministic.');
    }
  }
}

function sameBranchDescriptor(
  left: ArchiveBranchDescriptor,
  right: ArchiveBranchDescriptor
): boolean {
  return (
    left.ordinal === right.ordinal &&
    left.targetNodeId === right.targetNodeId &&
    left.nodeCount === right.nodeCount &&
    left.messageCount === right.messageCount &&
    left.userMessageCount === right.userMessageCount &&
    left.assistantMessageCount === right.assistantMessageCount &&
    left.isCurrentLeaf === right.isCurrentLeaf &&
    left.containsCurrentNode === right.containsCurrentNode &&
    left.uniqueNodeIds.length === right.uniqueNodeIds.length &&
    left.uniqueNodeIds.every((nodeId, index) => nodeId === right.uniqueNodeIds[index])
  );
}

function requireCatalogBranch(
  catalog: ArchiveBranchCatalog,
  branch: ArchiveBranchDescriptor
): ArchiveBranchDescriptor {
  requireCatalogOrder(catalog);
  const matches = catalog.branches.filter(candidate => candidate.ordinal === branch.ordinal);
  if (matches.length !== 1 || !sameBranchDescriptor(matches[0], branch)) {
    throw new Error('Requested branch is not an exact member of the archive branch catalog.');
  }
  return matches[0];
}

function countCanonicalMessages(archive: LiskaThreadArchive, nodeIds: string[]): CanonicalCounts {
  const counts: CanonicalCounts = {
    messageCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
  };
  for (const nodeId of nodeIds) {
    const message = archive.graph.nodes[nodeId]?.message;
    if (!message) continue;
    counts.messageCount += 1;
    if (message.author.role === 'user') counts.userMessageCount += 1;
    if (message.author.role === 'assistant') counts.assistantMessageCount += 1;
  }
  return counts;
}

function countUniqueCanonicalMessages(
  archive: LiskaThreadArchive,
  selectedNodeIds: string[],
  branch: ArchiveBranchDescriptor
): number {
  const selected = new Set(selectedNodeIds);
  const unique = new Set<string>();
  let messageCount = 0;
  for (const nodeId of branch.uniqueNodeIds) {
    if (!selected.has(nodeId) || unique.has(nodeId)) {
      throw new Error('Archive branch catalog has an invalid unique branch suffix.');
    }
    unique.add(nodeId);
    if (archive.graph.nodes[nodeId]?.message) messageCount += 1;
  }
  return messageCount;
}

function assertBranchMatchesProjection(
  archive: LiskaThreadArchive,
  branch: ArchiveBranchDescriptor,
  selectedNodeIds: string[]
): BranchCounts {
  if (selectedNodeIds[selectedNodeIds.length - 1] !== branch.targetNodeId) {
    throw new Error('Archive projection did not resolve the requested catalog leaf.');
  }
  if (branch.isCurrentLeaf !== (archive.conversation.currentNodeId === branch.targetNodeId)) {
    throw new Error('Archive branch current-leaf status does not match the canonical archive.');
  }
  if (
    branch.containsCurrentNode !==
    (archive.conversation.currentNodeId !== null &&
      selectedNodeIds.includes(archive.conversation.currentNodeId))
  ) {
    throw new Error('Archive branch current-node status does not match the canonical archive.');
  }

  const counts = countCanonicalMessages(archive, selectedNodeIds);
  if (
    counts.messageCount !== branch.messageCount ||
    counts.userMessageCount !== branch.userMessageCount ||
    counts.assistantMessageCount !== branch.assistantMessageCount
  ) {
    throw new Error('Archive branch catalog counts do not match the canonical archive.');
  }

  return {
    canonicalMessageCount: counts.messageCount,
    uniqueMessageCount: countUniqueCanonicalMessages(archive, selectedNodeIds, branch),
  };
}

function archiveTitle(archive: LiskaThreadArchive): string {
  return archive.conversation.title?.trim() || 'Untitled archived conversation';
}

function archiveTimestamp(archive: LiskaThreadArchive): Date {
  const capturedAt = [...archive.inputs]
    .reverse()
    .find(input => input.capturedAt !== null)?.capturedAt;
  const raw = capturedAt ?? archive.conversation.updatedAt ?? archive.conversation.createdAt;
  const date = raw ? new Date(raw) : new Date(0);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function requireArchiveProvider(archive: LiskaThreadArchive): AIPlatform {
  const provider = archive.conversation.provider;
  if (!ALL_PLATFORMS.includes(provider as AIPlatform)) {
    throw new Error('Canonical archive provider is unsupported by the Markdown renderer.');
  }
  return provider as AIPlatform;
}

function leafPresentation(
  catalog: ArchiveBranchCatalog,
  branch: ArchiveBranchDescriptor,
  captureId: string
): ConversationData['presentation'] {
  return {
    mode: 'all-branches-leaf',
    captureId,
    branchOrdinal: branch.ordinal,
    branchCount: catalog.branches.length,
    branchPointCount: catalog.branchPointCount,
  };
}

function baseConversationData(
  archive: LiskaThreadArchive,
  captureId: string,
  presentation: ConversationData['presentation']
): ConversationData {
  const source = requireArchiveProvider(archive);
  return {
    id: captureScopedConversationId(captureId),
    title: archiveTitle(archive),
    url: platformOrigin(source),
    source,
    messages: [],
    extractedAt: archiveTimestamp(archive),
    metadata: {
      messageCount: 0,
      userMessageCount: 0,
      assistantMessageCount: 0,
      hasCodeBlocks: false,
    },
    capture: { mode: 'structured-api', completeness: 'complete' },
    presentation,
  };
}

function leafTitle(archive: LiskaThreadArchive, branch: ArchiveBranchDescriptor): string {
  return `${archiveTitle(archive)} — Branch ${branch.ordinal}${branch.isCurrentLeaf ? ' (current)' : ''}`;
}

function withHumanTitle(note: ObsidianNote, title: string): ObsidianNote {
  note.frontmatter.title = title;
  return note;
}

function canonicalOnlyStub(
  archive: LiskaThreadArchive,
  catalog: ArchiveBranchCatalog,
  branch: ArchiveBranchDescriptor,
  captureId: string,
  templateOptions: TemplateOptions,
  baseData?: ConversationData,
  renderedAt?: Date
): ObsidianNote {
  const note = conversationToNote(
    baseData
      ? { ...baseData, presentation: leafPresentation(catalog, branch, captureId) }
      : baseConversationData(archive, captureId, leafPresentation(catalog, branch, captureId)),
    templateOptions,
    renderedAt
  );
  note.body = [
    '> [!WARNING]',
    '> This branch has no user or assistant content that the legacy Markdown renderer can show.',
    '> Its canonical archive record remains available with this complete capture.',
  ].join('\n');
  note.contentHash = generateContentHash(note.body);
  return withHumanTitle(note, leafTitle(archive, branch));
}

function expectedLeafFileName(
  archive: LiskaThreadArchive,
  catalog: ArchiveBranchCatalog,
  branch: ArchiveBranchDescriptor,
  captureId: string,
  templateOptions: TemplateOptions
): string {
  return conversationToNote(
    baseConversationData(archive, captureId, leafPresentation(catalog, branch, captureId)),
    templateOptions
  ).fileName;
}

function renderedLeaf(
  archive: LiskaThreadArchive,
  catalog: ArchiveBranchCatalog,
  branch: ArchiveBranchDescriptor,
  projection: ArchiveProjectionResult,
  templateOptions: TemplateOptions,
  captureId: string,
  counts = assertBranchMatchesProjection(archive, branch, projection.selectedNodeIds),
  renderedAt?: Date
): ArchiveBranchLeafRender {
  const { canonicalMessageCount, uniqueMessageCount } = counts;
  const note = withHumanTitle(
    conversationToNote(
      {
        ...projection.data,
        id: captureScopedConversationId(captureId),
        url: platformOrigin(projection.data.source),
        capture: { mode: 'structured-api', completeness: 'complete' },
        presentation: leafPresentation(catalog, branch, captureId),
      },
      templateOptions,
      renderedAt
    ),
    leafTitle(archive, branch)
  );
  return {
    note,
    warnings: projection.warnings,
    ordinal: branch.ordinal,
    canonicalMessageCount,
    renderedMessageCount: projection.data.messages.length,
    uniqueMessageCount,
    isCurrent: branch.isCurrentLeaf,
    status: 'rendered',
  };
}

function canonicalOnlyLeaf(
  archive: LiskaThreadArchive,
  catalog: ArchiveBranchCatalog,
  branch: ArchiveBranchDescriptor,
  templateOptions: TemplateOptions,
  captureId: string,
  selectedNodeIds = getNodePath(archive, branch.targetNodeId),
  counts = assertBranchMatchesProjection(archive, branch, selectedNodeIds),
  baseData?: ConversationData,
  renderedAt?: Date
): ArchiveBranchLeafRender {
  const { canonicalMessageCount, uniqueMessageCount } = counts;
  return {
    note: canonicalOnlyStub(
      archive,
      catalog,
      branch,
      captureId,
      templateOptions,
      baseData,
      renderedAt
    ),
    warnings: [
      `Branch ${branch.ordinal} has no legacy-renderable user or assistant content; a canonical-only Markdown stub was created.`,
    ],
    ordinal: branch.ordinal,
    canonicalMessageCount,
    renderedMessageCount: 0,
    uniqueMessageCount,
    isCurrent: branch.isCurrentLeaf,
    status: 'canonical-only',
  };
}

/** Render exactly one catalog leaf without retaining or projecting its siblings. */
export function renderArchiveBranchLeaf(
  archive: LiskaThreadArchive,
  catalog: ArchiveBranchCatalog,
  branch: ArchiveBranchDescriptor,
  templateOptions: TemplateOptions,
  captureId: string,
  includeToolContent = false
): ArchiveBranchLeafRender {
  requireCaptureId(captureId);
  const catalogBranch = requireCatalogBranch(catalog, branch);

  try {
    const projection = projectArchiveBranch(archive, {
      targetNodeId: catalogBranch.targetNodeId,
      includeToolContent,
    });
    return renderedLeaf(archive, catalog, catalogBranch, projection, templateOptions, captureId);
  } catch (error) {
    if (!(error instanceof ArchiveProjectionError) || error.code !== 'no-renderable-messages') {
      throw error;
    }
    return canonicalOnlyLeaf(archive, catalog, catalogBranch, templateOptions, captureId);
  }
}

function requireSafeLeafFilename(fileName: string): void {
  if (
    !SAFE_NOTE_FILENAME_PATTERN.test(fileName) ||
    fileName.includes('..') ||
    fileName.includes('/') ||
    fileName.includes('\\')
  ) {
    throw new Error('Archive branch index received an unsafe leaf filename.');
  }
}

function requireIndexEntryFacts(
  archive: LiskaThreadArchive,
  branch: ArchiveBranchDescriptor,
  entry: ArchiveBranchIndexEntry
): void {
  requireNonNegativeInteger(entry.canonicalMessageCount, 'canonical message count');
  requireNonNegativeInteger(entry.renderedMessageCount, 'rendered message count');
  requireNonNegativeInteger(entry.uniqueMessageCount, 'unique message count');
  if (
    entry.canonicalMessageCount !== branch.messageCount ||
    entry.uniqueMessageCount !==
      countUniqueCanonicalMessages(archive, branch.uniqueNodeIds, branch) ||
    entry.isCurrent !== branch.isCurrentLeaf
  ) {
    throw new Error('Archive branch index entry does not match its catalog leaf.');
  }
  if (
    (entry.status === 'canonical-only' && entry.renderedMessageCount !== 0) ||
    (entry.status === 'rendered' && entry.renderedMessageCount < 1) ||
    (entry.status !== 'rendered' && entry.status !== 'canonical-only')
  ) {
    throw new Error('Archive branch index entry has an invalid rendering status.');
  }
}

function validateIndexEntries(
  archive: LiskaThreadArchive,
  catalog: ArchiveBranchCatalog,
  entries: ArchiveBranchIndexEntry[],
  templateOptions: TemplateOptions,
  captureId: string
): ArchiveBranchIndexEntry[] {
  requireCatalogOrder(catalog);
  if (entries.length !== catalog.branches.length) {
    throw new Error('Archive branch index entries must cover every catalog leaf exactly once.');
  }

  return entries.map((entry, index) => {
    const branch = catalog.branches[index];
    if (entry.ordinal !== branch.ordinal) {
      throw new Error(
        'Archive branch index entries must follow deterministic catalog ordinal order.'
      );
    }
    requireIndexEntryFacts(archive, branch, entry);

    requireSafeLeafFilename(entry.fileName);
    const expectedFileName = expectedLeafFileName(
      archive,
      catalog,
      branch,
      captureId,
      templateOptions
    );
    if (entry.fileName !== expectedFileName) {
      throw new Error(
        'Archive branch index entry filename does not match the intended capture-scoped leaf.'
      );
    }
    return entry;
  });
}

function completeArchiveMessageCount(archive: LiskaThreadArchive): number {
  return Object.values(archive.graph.nodes).reduce(
    (count, node) => count + (node.message ? 1 : 0),
    0
  );
}

function indexBody(
  archive: LiskaThreadArchive,
  catalog: ArchiveBranchCatalog,
  entries: ArchiveBranchIndexEntry[]
): string {
  const declaredBranches = entries.length;
  const canonicalMessages = completeArchiveMessageCount(archive);
  const lines = [
    '# All archived branches',
    '',
    `Complete structured capture with ${declaredBranches} declared leaf branch${declaredBranches === 1 ? '' : 'es'} and ${catalog.branchPointCount} branch point${catalog.branchPointCount === 1 ? '' : 's'}.`,
    `Distinct canonical messages in the graph: ${canonicalMessages}.`,
    '',
    '## Branch notes',
    '',
  ];

  for (const entry of entries) {
    const current = entry.isCurrent ? ' — current' : '';
    const status = entry.status === 'canonical-only' ? ' — canonical-only stub' : '';
    lines.push(
      `- [Branch ${entry.ordinal}${current}](${entry.fileName}) — ${entry.canonicalMessageCount} canonical, ${entry.renderedMessageCount} rendered, ${entry.uniqueMessageCount} unique message${entry.uniqueMessageCount === 1 ? '' : 's'}${status}.`
    );
  }
  return lines.join('\n');
}

/** Build the content-free navigation note for a complete, capture-scoped branch bundle. */
export function renderArchiveBranchIndex(
  archive: LiskaThreadArchive,
  catalog: ArchiveBranchCatalog,
  entries: ArchiveBranchIndexEntry[],
  templateOptions: TemplateOptions,
  captureId: string
): ObsidianNote {
  requireCaptureId(captureId);
  const validation = validateLiskaThreadArchive(archive);
  if (!validation.valid) {
    throw new Error('Canonical archive is invalid and cannot produce a branch index.');
  }
  const verifiedEntries = validateIndexEntries(
    archive,
    catalog,
    entries,
    templateOptions,
    captureId
  );
  return branchIndexNote(archive, catalog, verifiedEntries, templateOptions, captureId);
}

function branchIndexNote(
  archive: LiskaThreadArchive,
  catalog: ArchiveBranchCatalog,
  entries: ArchiveBranchIndexEntry[],
  templateOptions: TemplateOptions,
  captureId: string,
  baseData?: ConversationData,
  renderedAt?: Date
): ObsidianNote {
  const presentation: ConversationData['presentation'] = {
    mode: 'all-branches-index',
    captureId,
    branchCount: catalog.branches.length,
    branchPointCount: catalog.branchPointCount,
  };
  const note = conversationToNote(
    baseData
      ? { ...baseData, presentation }
      : baseConversationData(archive, captureId, presentation),
    templateOptions,
    renderedAt
  );
  note.body = indexBody(archive, catalog, entries);
  note.contentHash = generateContentHash(note.body);
  note.frontmatter.message_count = completeArchiveMessageCount(archive);
  return withHumanTitle(note, `${archiveTitle(archive)} — All branches`);
}

function preparedLeaf(
  prepared: PreparedArchiveBranchGraph,
  ordinal: number,
  templateOptions: TemplateOptions,
  captureId: string,
  includeToolContent: boolean,
  baseData: ConversationData,
  renderedAt: Date
): ArchiveBranchLeafRender {
  const branch = prepared.branches[ordinal - 1];
  if (!Number.isSafeInteger(ordinal) || !branch || branch.descriptor.ordinal !== ordinal) {
    throw new Error('Requested branch is not an exact member of the archive branch catalog.');
  }
  const projection = prepared.projection.project({
    targetNodeId: branch.descriptor.targetNodeId,
    includeToolContent,
  });
  return projection.data.messages.length > 0
    ? renderedLeaf(
        prepared.archive,
        prepared.catalog,
        branch.descriptor,
        projection,
        templateOptions,
        captureId,
        branch,
        renderedAt
      )
    : canonicalOnlyLeaf(
        prepared.archive,
        prepared.catalog,
        branch.descriptor,
        templateOptions,
        captureId,
        projection.selectedNodeIds,
        branch,
        baseData,
        renderedAt
      );
}

function leafIndexFacts(leaf: ArchiveBranchLeafRender): ArchiveBranchIndexEntry {
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

function requirePreparedIndexEntries(
  entries: ArchiveBranchIndexEntry[],
  facts: Map<number, ArchiveBranchIndexEntry>,
  branchCount: number
): void {
  if (entries.length !== branchCount || facts.size !== branchCount) {
    throw new Error('Archive branch index entries must cover every catalog leaf exactly once.');
  }
  for (const [index, entry] of entries.entries()) {
    if (entry.ordinal !== index + 1) {
      throw new Error(
        'Archive branch index entries must follow deterministic catalog ordinal order.'
      );
    }
    requireSafeLeafFilename(entry.fileName);
    const expected = facts.get(entry.ordinal)!;
    if (
      entry.fileName !== expected.fileName ||
      entry.canonicalMessageCount !== expected.canonicalMessageCount ||
      entry.renderedMessageCount !== expected.renderedMessageCount ||
      entry.uniqueMessageCount !== expected.uniqueMessageCount ||
      entry.isCurrent !== expected.isCurrent ||
      entry.status !== expected.status
    ) {
      throw new Error('Archive branch index entry does not match its prepared leaf.');
    }
  }
}

/**
 * Validate a complete graph/catalog once, then render by O(1) ordinal lookup.
 * The session owns copied structure and content-free index facts, never sibling
 * bodies or all root-to-leaf paths. Message bodies must stay immutable until it ends.
 */
export function prepareArchiveBranchPresentation(
  archive: LiskaThreadArchive,
  catalog: ArchiveBranchCatalog,
  templateOptions: TemplateOptions,
  captureId: string,
  includeToolContent = false
): PreparedArchiveBranchPresentation {
  requireCaptureId(captureId);
  const prepared = prepareArchiveBranchGraph(archive, catalog);
  const options = {
    ...templateOptions,
    conversationTags: normalizeTagTemplates(templateOptions.conversationTags, 'conversation'),
    deepResearchTags: normalizeTagTemplates(templateOptions.deepResearchTags, 'deep-research'),
  };
  Object.freeze(options.conversationTags);
  Object.freeze(options.deepResearchTags);
  Object.freeze(options);
  const baseData = baseConversationData(prepared.archive, captureId, undefined);
  const renderedAt = new Date();
  const facts = new Map<number, ArchiveBranchIndexEntry>();
  return {
    branchCount: prepared.branches.length,
    metrics: prepared.metrics,
    renderLeaf(ordinal) {
      const leaf = preparedLeaf(
        prepared,
        ordinal,
        options,
        captureId,
        includeToolContent,
        baseData,
        renderedAt
      );
      facts.set(ordinal, leafIndexFacts(leaf));
      return leaf;
    },
    renderIndex(entries) {
      requirePreparedIndexEntries(entries, facts, prepared.branches.length);
      return branchIndexNote(
        prepared.archive,
        prepared.catalog,
        entries,
        options,
        captureId,
        baseData,
        renderedAt
      );
    },
  };
}
