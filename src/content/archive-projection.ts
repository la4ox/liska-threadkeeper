/**
 * Compatibility projection from a validated canonical archive branch to the
 * extension's existing flat ConversationData renderer contract.
 *
 * This adapter is intentionally lossy and reports every unsupported block
 * family it omits. The canonical archive remains the source of truth.
 */

import {
  getNodePath,
  validateLiskaThreadArchive,
  type ArchiveBlock,
  type ArchiveMessage,
  type LiskaThreadArchive,
} from '../archive';
import { ALL_PLATFORMS, platformOrigin } from '../lib/platform-registry';
import type {
  AIPlatform,
  ArchiveCompanionBundle,
  ChatGptAssetExportContext,
  ChatGptStructuredPresentationContext,
  ConversationData,
  ConversationMessage,
} from '../lib/types';
import { markdownCodeFence } from './markdown-code';
import { htmlToMarkdownRaw } from './markdown-rules';
import { sanitizeHtml } from '../lib/sanitize';

export type ArchiveProjectionErrorCode =
  | 'archive-invalid'
  | 'provider-unsupported'
  | 'target-node-missing'
  | 'no-renderable-messages';

export class ArchiveProjectionError extends Error {
  readonly code: ArchiveProjectionErrorCode;

  constructor(code: ArchiveProjectionErrorCode, message: string) {
    super(message);
    this.name = 'ArchiveProjectionError';
    this.code = code;
  }
}

export interface ArchiveProjectionOptions {
  /** Defaults to conversation.currentNodeId. */
  targetNodeId?: string | null;
  /** Include reasoning/tool/error blocks in legacy toolContent callouts. */
  includeToolContent?: boolean;
  /** Trusted internal presentation label for generated reasoning headings; defaults to Reasoning. */
  reasoningLabel?: string;
}

export interface ArchiveProjectionResult {
  data: ConversationData;
  /** Deterministic root-to-target node IDs used by this presentation. */
  selectedNodeIds: string[];
  /** Explicit losses at the compatibility boundary; canonical data is intact. */
  warnings: string[];
  /** Immutable raw/manifest/canonical evidence available only after structured capture. */
  archiveCompanion?: ArchiveCompanionBundle;
  /** Runtime-only original evidence for optional destination-honest attachment export. */
  chatGptAssetExportContext?: ChatGptAssetExportContext;
  chatGptStructuredPresentationContext?: ChatGptStructuredPresentationContext;
}

export interface ArchiveVisibleTextBlockSpan {
  readonly blockIndex: number;
  readonly start: number;
  readonly end: number;
}

export interface ArchiveVisibleMessageProjection {
  readonly content: string;
  readonly textBlockSpans: readonly ArchiveVisibleTextBlockSpan[];
}

/** Internal render session: validation is mandatory and paths are never supplied by callers. */
export interface PreparedArchiveProjection {
  /** Empty legacy results retain their selected path for canonical-only branch stubs. */
  project(options?: ArchiveProjectionOptions): ArchiveProjectionResult;
}

interface ProjectionContext {
  provider: AIPlatform;
  archiveWarnings: string[];
  timestamp: ReturnType<typeof projectionTimestamp>;
}

type OmissionKind =
  | 'attachment'
  | 'embedded_image'
  | 'canvas_event'
  | 'citation'
  | 'unknown'
  | 'tool_content'
  | 'role'
  | 'empty';

function isAIPlatform(provider: string): provider is AIPlatform {
  return ALL_PLATFORMS.includes(provider as AIPlatform);
}

function inlineLabel(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[`*~[\]<>]/g, '')
    .trim()
    .substring(0, 100);
}

function htmlToLegacyMarkdown(html: string, omissions: Map<OmissionKind, number>): string {
  const document = new DOMParser().parseFromString(sanitizeHtml(html), 'text/html');
  const images = [...document.querySelectorAll('img')];
  for (const image of images) {
    const alt = inlineLabel(image.getAttribute('alt') ?? '');
    image.replaceWith(document.createTextNode(alt ? `(Image: ${alt})` : '(Image omitted)'));
  }
  if (images.length > 0) {
    omissions.set('embedded_image', (omissions.get('embedded_image') ?? 0) + images.length);
  }
  return htmlToMarkdownRaw(document.body.innerHTML);
}

function renderVisibleBlock(
  block: ArchiveBlock,
  omissions: Map<OmissionKind, number>
): string | null {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'markdown':
      return block.markdown;
    case 'html':
      return htmlToLegacyMarkdown(block.html, omissions);
    case 'code':
      return markdownCodeFence(block.code, block.language ?? '');
    case 'quote': {
      const quote = block.text
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n');
      return block.attribution ? `${quote}\n> — ${inlineLabel(block.attribution)}` : quote;
    }
    default:
      return null;
  }
}

interface InternalVisibleMessageProjection extends ArchiveVisibleMessageProjection {
  visibleBlockIndexes: Set<number>;
}

function projectVisibleMessage(
  message: ArchiveMessage,
  omissions: Map<OmissionKind, number>
): InternalVisibleMessageProjection {
  const parts: string[] = [];
  const textBlockSpans: ArchiveVisibleTextBlockSpan[] = [];
  const visibleBlockIndexes = new Set<number>();
  let contentLength = 0;
  for (let blockIndex = 0; blockIndex < message.blocks.length; blockIndex += 1) {
    const block = message.blocks[blockIndex];
    const rendered = renderVisibleBlock(block, omissions);
    if (rendered === null) continue;
    visibleBlockIndexes.add(blockIndex);
    if (rendered.length === 0) continue;
    if (parts.length > 0) contentLength += 2;
    const start = contentLength;
    parts.push(rendered);
    contentLength += rendered.length;
    if (block.type === 'text') textBlockSpans.push({ blockIndex, start, end: contentLength });
  }
  return { content: parts.join('\n\n'), textBlockSpans, visibleBlockIndexes };
}

/** Exact visible Markdown layout used by the legacy projection. */
export function projectArchiveMessageVisibleContent(
  message: ArchiveMessage
): ArchiveVisibleMessageProjection {
  const { content, textBlockSpans } = projectVisibleMessage(message, new Map());
  return { content, textBlockSpans };
}

function renderToolBlock(block: ArchiveBlock, reasoningLabel: string): string | null {
  switch (block.type) {
    case 'reasoning':
      return `**${reasoningLabel}**\n${block.text}`;
    case 'tool_call':
      return `**Tool call: ${inlineLabel(block.toolName) || 'unknown'}**\n${markdownCodeFence(
        JSON.stringify(block.arguments, null, 2),
        'json'
      )}`;
    case 'tool_result':
      return `**Tool result${block.toolName ? `: ${inlineLabel(block.toolName)}` : ''}**\n${markdownCodeFence(JSON.stringify(block.result, null, 2), 'json')}`;
    case 'execution_output':
      return `**Execution output**\n${markdownCodeFence(JSON.stringify(block.output, null, 2), 'json')}`;
    case 'error':
      return `**Provider error${block.code ? ` (${inlineLabel(block.code)})` : ''}**\n${block.message}`;
    default:
      return null;
  }
}

function omissionKind(block: ArchiveBlock): OmissionKind | null {
  switch (block.type) {
    case 'attachment':
    case 'canvas_event':
    case 'citation':
    case 'unknown':
      return block.type;
    default:
      return null;
  }
}

function projectMessage(
  message: ArchiveMessage,
  index: number,
  includeToolContent: boolean,
  reasoningLabel: string,
  omissions: Map<OmissionKind, number>
): ConversationMessage | null {
  if (message.author.role !== 'user' && message.author.role !== 'assistant') {
    omissions.set('role', (omissions.get('role') ?? 0) + 1);
    return null;
  }

  const visible = projectVisibleMessage(message, omissions);
  const tool: string[] = [];
  for (let blockIndex = 0; blockIndex < message.blocks.length; blockIndex += 1) {
    const block = message.blocks[blockIndex];
    if (visible.visibleBlockIndexes.has(blockIndex)) continue;

    const renderedTool = renderToolBlock(block, reasoningLabel);
    if (renderedTool !== null) {
      if (includeToolContent) {
        tool.push(renderedTool);
      } else {
        omissions.set('tool_content', (omissions.get('tool_content') ?? 0) + 1);
      }
      continue;
    }

    const omitted = omissionKind(block);
    if (omitted) omissions.set(omitted, (omissions.get(omitted) ?? 0) + 1);
  }

  const content = visible.content;
  if (!content) {
    omissions.set('empty', (omissions.get('empty') ?? 0) + 1);
    return null;
  }

  return {
    id: message.id,
    role: message.author.role,
    content,
    contentFormat: message.author.role === 'assistant' ? 'markdown' : undefined,
    toolContent: tool.length > 0 ? tool.join('\n\n') : undefined,
    index,
  };
}

function omissionWarnings(omissions: Map<OmissionKind, number>): string[] {
  const labels: Record<OmissionKind, string> = {
    attachment: 'attachment block(s)',
    embedded_image: 'remote/embedded HTML image(s)',
    canvas_event: 'Canvas event block(s)',
    citation: 'standalone citation block(s)',
    unknown: 'unknown provider block(s)',
    tool_content: 'reasoning/tool/error block(s) because tool content is disabled',
    role: 'non-user/assistant message(s)',
    empty: 'message(s) without legacy-renderable visible content',
  };
  return (Object.keys(labels) as OmissionKind[]).flatMap(kind => {
    const count = omissions.get(kind) ?? 0;
    if (count === 0) return [];
    if (kind === 'attachment') {
      return [
        `Legacy Markdown omitted ${count} ${labels[kind]}; the canonical archive retains their references and metadata. Binary files are preserved only for assets marked fetched when their selected output write succeeds.`,
      ];
    }
    if (kind === 'embedded_image') {
      return [
        `Legacy Markdown omitted ${count} ${labels[kind]}; the canonical archive retains the source HTML after privacy redaction, not the remote image bytes.`,
      ];
    }
    return [
      `Legacy Markdown omitted ${count} ${labels[kind]}; the canonical archive companion preserves them only when its selected output write succeeds.`,
    ];
  });
}

function projectionTimestamp(archive: LiskaThreadArchive): { date: Date; warning?: string } {
  const capturedAt = [...archive.inputs]
    .reverse()
    .find(input => input.capturedAt !== null)?.capturedAt;
  const timestamp = capturedAt ?? archive.conversation.updatedAt ?? archive.conversation.createdAt;
  return timestamp
    ? { date: new Date(timestamp) }
    : {
        date: new Date(0),
        warning:
          'Archive has no capture or conversation timestamp; legacy created time uses epoch.',
      };
}

function requireProjectionContext(archive: LiskaThreadArchive): ProjectionContext {
  const validation = validateLiskaThreadArchive(archive);
  if (!validation.valid) {
    const firstError = validation.issues.find(issue => issue.severity === 'error');
    throw new ArchiveProjectionError(
      'archive-invalid',
      `Canonical archive is invalid${firstError ? ` (${firstError.code} at ${firstError.path})` : ''}.`
    );
  }

  const provider = archive.conversation.provider;
  if (!isAIPlatform(provider)) {
    throw new ArchiveProjectionError(
      'provider-unsupported',
      `Legacy renderer does not support provider ${provider}.`
    );
  }
  return {
    provider,
    timestamp: projectionTimestamp(archive),
    archiveWarnings: validation.issues
      .filter(issue => issue.severity === 'warning')
      .map(issue => `Archive warning ${issue.code} at ${issue.path}.`),
  };
}

function resolveTargetNodeId(
  archive: LiskaThreadArchive,
  requested: string | null | undefined
): string {
  const targetNodeId = requested === undefined ? archive.conversation.currentNodeId : requested;
  if (!targetNodeId) {
    throw new ArchiveProjectionError('target-node-missing', 'A branch target node is required.');
  }
  return targetNodeId;
}

function projectSelectedMessages(
  archive: LiskaThreadArchive,
  selectedNodeIds: string[],
  includeToolContent: boolean,
  reasoningLabel: string
): { messages: ConversationMessage[]; omissions: Map<OmissionKind, number> } {
  const omissions = new Map<OmissionKind, number>();
  const messages: ConversationMessage[] = [];
  for (const nodeId of selectedNodeIds) {
    const message = archive.graph.nodes[nodeId].message;
    if (!message) continue;
    const projected = projectMessage(
      message,
      messages.length,
      includeToolContent,
      reasoningLabel,
      omissions
    );
    if (projected) messages.push(projected);
  }
  return { messages, omissions };
}

function projectionWarnings(
  archive: LiskaThreadArchive,
  archiveWarnings: string[],
  omissions: Map<OmissionKind, number>,
  timestampWarning: string | undefined
): string[] {
  return [
    ...archiveWarnings,
    ...omissionWarnings(omissions),
    ...(archive.conversation.url
      ? []
      : ['Archive has no source URL; legacy output uses the platform origin.']),
    ...(timestampWarning ? [timestampWarning] : []),
  ];
}

function projectSelectedBranch(
  archive: LiskaThreadArchive,
  context: ProjectionContext,
  selectedNodeIds: string[],
  options: ArchiveProjectionOptions
): ArchiveProjectionResult {
  const { provider, archiveWarnings, timestamp } = context;
  const { messages, omissions } = projectSelectedMessages(
    archive,
    selectedNodeIds,
    options.includeToolContent ?? false,
    options.reasoningLabel ?? 'Reasoning'
  );

  const { date: extractedAt, warning: timestampWarning } = timestamp;
  const url = archive.conversation.url ?? platformOrigin(provider);
  const warnings = projectionWarnings(archive, archiveWarnings, omissions, timestampWarning);

  return {
    data: {
      id: archive.conversation.id,
      title: archive.conversation.title ?? 'Untitled archived conversation',
      url,
      source: provider,
      messages,
      extractedAt: new Date(extractedAt.getTime()),
      metadata: {
        messageCount: messages.length,
        userMessageCount: messages.filter(message => message.role === 'user').length,
        assistantMessageCount: messages.filter(message => message.role === 'assistant').length,
        hasCodeBlocks: selectedNodeIds.some(nodeId =>
          archive.graph.nodes[nodeId].message?.blocks.some(block => block.type === 'code')
        ),
      },
    },
    selectedNodeIds,
    warnings,
  };
}

/** Project the current or explicitly selected canonical branch for legacy outputs. */
export function projectArchiveBranch(
  archive: LiskaThreadArchive,
  options: ArchiveProjectionOptions = {}
): ArchiveProjectionResult {
  const context = requireProjectionContext(archive);
  const targetNodeId = resolveTargetNodeId(archive, options.targetNodeId);
  const result = projectSelectedBranch(
    archive,
    context,
    getNodePath(archive, targetNodeId),
    options
  );
  if (result.data.messages.length === 0) {
    throw new ArchiveProjectionError(
      'no-renderable-messages',
      'Selected branch has no user or assistant content for the legacy renderer.'
    );
  }
  return result;
}

/**
 * Prepare one owned render session. Copy structural links and metadata, not
 * message bodies: callers must not mutate retained message objects mid-session.
 * No session method accepts an unchecked path or a validation bypass.
 */
export function prepareArchiveProjection(archive: LiskaThreadArchive): PreparedArchiveProjection {
  const context = requireProjectionContext(archive);
  const snapshot: LiskaThreadArchive = {
    ...archive,
    conversation: { ...archive.conversation },
    graph: {
      rootIds: [...archive.graph.rootIds],
      nodes: Object.fromEntries(
        Object.entries(archive.graph.nodes).map(([nodeId, node]) => [nodeId, { ...node }])
      ),
    },
  };
  return {
    project(options = {}) {
      const targetNodeId = resolveTargetNodeId(snapshot, options.targetNodeId);
      const selectedNodeIds = preparedNodePath(snapshot, targetNodeId);
      return projectSelectedBranch(snapshot, context, selectedNodeIds, options);
    },
  };
}

/** Parent links are private snapshots of an already validated tree. */
function preparedNodePath(archive: LiskaThreadArchive, targetNodeId: string): string[] {
  if (!Object.prototype.hasOwnProperty.call(archive.graph.nodes, targetNodeId)) {
    throw new ArchiveProjectionError('target-node-missing', 'The branch target node is missing.');
  }
  const reversedPath: string[] = [];
  let nodeId: string | null = targetNodeId;
  while (nodeId !== null) {
    reversedPath.push(nodeId);
    nodeId = archive.graph.nodes[nodeId].parentId;
  }
  return reversedPath.reverse();
}
