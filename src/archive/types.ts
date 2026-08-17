/**
 * Experimental, browser-independent representation for a loss-aware archived
 * conversation.  `liska-thread/1` deliberately keeps graph structure and
 * provider evidence separate from any rendered representation.
 */

export const LISKA_THREAD_SCHEMA = 'liska-thread/1' as const;

/** JSON values are safe to serialise into an archive without custom codecs. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** ISO 8601 text, never a runtime `Date` instance. */
export type TimestampString = string;

/**
 * Provider evidence for a canonical value. `rawPointer` is a JSON Pointer when
 * a retained raw JSON artifact is the source; it is null for sources such as a
 * DOM capture that do not have one.
 */
export interface SourceReference {
  format: string;
  kind: string;
  id: string | null;
  artifactId: string | null;
  rawPointer: string | null;
}

/**
 * Provider-owned data which does not have a stable Liska field yet. The key is
 * the provider or feature namespace (for example, `openai` or `openai.canvas`).
 */
export type NamespacedExtensions = Record<string, JsonValue>;

export interface ArchiveInput {
  captureId: string;
  manifestSha256: string;
  normalizer: string;
  capturedAt: TimestampString | null;
  sourceRefs: SourceReference[];
  extensions: NamespacedExtensions;
}

export interface ConversationMetadata {
  id: string;
  title: string | null;
  provider: string;
  /** Canonical source page for this conversation when one is known. */
  url: string | null;
  currentNodeId: string | null;
  createdAt: TimestampString | null;
  updatedAt: TimestampString | null;
  /** Explicitly extensible metadata boundary for provider-independent labels. */
  metadata: Record<string, JsonValue>;
  sourceRefs: SourceReference[];
  extensions: NamespacedExtensions;
}

export interface ArchiveGraph {
  /** Ordered roots. A thread can retain several disconnected provider roots. */
  rootIds: string[];
  /** Map key and `ArchiveNode.id` must agree. */
  nodes: Record<string, ArchiveNode>;
}

/** Empty structural nodes intentionally omit `message`. */
export interface ArchiveNode {
  id: string;
  parentId: string | null;
  childIds: string[];
  message?: ArchiveMessage;
  sourceRefs: SourceReference[];
  extensions: NamespacedExtensions;
}

export interface ArchiveMessageAuthor {
  /** Exact provider role such as user, assistant, system, tool, or critic. */
  role: string;
  name: string | null;
}

export interface ArchiveMessage {
  /** Stable provider message identifier when one exists; otherwise a Liska ID. */
  id: string;
  author: ArchiveMessageAuthor;
  recipient: string | null;
  channel: string | null;
  createdAt: TimestampString | null;
  updatedAt: TimestampString | null;
  status: string | null;
  model: string | null;
  visibility: string | null;
  /** Deliberately ordered: do not flatten reasoning and tool blocks into text. */
  blocks: ArchiveBlock[];
  sourceRefs: SourceReference[];
  extensions: NamespacedExtensions;
}

interface ArchiveBlockBase {
  id: string;
  sourceRefs: SourceReference[];
  extensions: NamespacedExtensions;
}

export interface TextBlock extends ArchiveBlockBase {
  type: 'text';
  text: string;
}

export interface MarkdownBlock extends ArchiveBlockBase {
  type: 'markdown';
  markdown: string;
}

export interface HtmlBlock extends ArchiveBlockBase {
  type: 'html';
  html: string;
}

export interface CodeBlock extends ArchiveBlockBase {
  type: 'code';
  code: string;
  language: string | null;
}

export interface ReasoningBlock extends ArchiveBlockBase {
  type: 'reasoning';
  text: string;
}

export interface ToolCallBlock extends ArchiveBlockBase {
  type: 'tool_call';
  toolName: string;
  arguments: JsonValue;
}

export interface ToolResultBlock extends ArchiveBlockBase {
  type: 'tool_result';
  toolName: string | null;
  result: JsonValue;
}

export interface ExecutionOutputBlock extends ArchiveBlockBase {
  type: 'execution_output';
  output: JsonValue;
}

export interface CitationBlock extends ArchiveBlockBase {
  type: 'citation';
  label: string | null;
  url: string | null;
  content: JsonValue | null;
}

export interface QuoteBlock extends ArchiveBlockBase {
  type: 'quote';
  text: string;
  attribution: string | null;
}

export interface AttachmentReferenceBlock extends ArchiveBlockBase {
  type: 'attachment';
  assetId: string;
}

export interface CanvasEventBlock extends ArchiveBlockBase {
  type: 'canvas_event';
  event: JsonValue;
}

export interface ErrorBlock extends ArchiveBlockBase {
  type: 'error';
  message: string;
  code: string | null;
}

/** Retains provider content that has no stable typed block yet. */
export interface UnknownBlock extends ArchiveBlockBase {
  type: 'unknown';
  providerType: string;
  /** A bounded JSON-safe sample; raw evidence remains in `sourceRefs`. */
  raw: JsonValue | null;
}

export type ArchiveBlock =
  | TextBlock
  | MarkdownBlock
  | HtmlBlock
  | CodeBlock
  | ReasoningBlock
  | ToolCallBlock
  | ToolResultBlock
  | ExecutionOutputBlock
  | CitationBlock
  | QuoteBlock
  | AttachmentReferenceBlock
  | CanvasEventBlock
  | ErrorBlock
  | UnknownBlock;

export type AssetAcquisitionState = 'fetched' | 'unavailable' | 'declined' | 'expired' | 'failed';

export interface AssetAcquisition {
  state: AssetAcquisitionState;
  attemptedAt: TimestampString | null;
  detail: string | null;
}

export interface ArchiveAsset {
  id: string;
  filename: string | null;
  mimeType: string | null;
  byteLength: number | null;
  dimensions: {
    width: number;
    height: number;
  } | null;
  sha256: string | null;
  localArtifactRef: string | null;
  acquisition: AssetAcquisition;
  sourceRefs: SourceReference[];
  extensions: NamespacedExtensions;
}

export type ArchiveDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface ArchiveDiagnostic {
  severity: ArchiveDiagnosticSeverity;
  code: string;
  message: string;
  path: string | null;
  sourceRefs: SourceReference[];
  extensions: NamespacedExtensions;
}

export interface ArchiveDiagnostics {
  entries: ArchiveDiagnostic[];
  extensions: NamespacedExtensions;
}

export interface LiskaThreadArchive {
  schema: typeof LISKA_THREAD_SCHEMA;
  archiveId: string;
  inputs: ArchiveInput[];
  conversation: ConversationMetadata;
  graph: ArchiveGraph;
  assets: Record<string, ArchiveAsset>;
  diagnostics: ArchiveDiagnostics;
  extensions: NamespacedExtensions;
}
