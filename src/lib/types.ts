/**
 * Shared TypeScript types for Gemini to Obsidian extension
 */

import type { ArchiveBranchCatalog } from '../archive/branches';
import type { RawCaptureBundle } from '../archive/capture';
import type { LiskaThreadArchive } from '../archive/types';

/**
 * Supported AI platform identifiers
 */
export type AIPlatform = 'gemini' | 'claude' | 'perplexity' | 'chatgpt' | 'notebooklm' | 'deepseek';

/**
 * An image captured from a conversation (e.g. a Gemini-generated image).
 *
 * Image bytes are captured in the content script (blob: URLs are origin- and
 * context-scoped and cannot be fetched from the background service worker), so
 * they travel to the background as base64 over structured-clone message passing.
 */
export interface ExtractedImage {
  /** Stable id, unique within the conversation (e.g. "img-1") */
  readonly id: string;
  /** MIME type, e.g. "image/png" */
  readonly mimeType: string;
  /** Base64-encoded image bytes (no `data:` prefix) */
  readonly data: string;
  /** Alt text from the DOM (e.g. "（AI 生成）") */
  readonly alt: string;
  /** Original blob/URL (diagnostic only; not resolvable outside the page) */
  readonly sourceUrl?: string;
}

/**
 * Represents a single message in a conversation
 */
export interface ConversationMessage {
  /** Unique message identifier */
  id: string;
  /** Message author role */
  role: 'user' | 'assistant';
  /** Message content (plain text for user, may contain HTML for assistant) */
  content: string;
  /** Original HTML content (for assistant messages, used in HTML→Markdown conversion) */
  htmlContent?: string;
  /** Whether assistant content is rendered HTML or already-safe Markdown. Defaults to HTML. */
  contentFormat?: 'html' | 'markdown';
  /** Tool-use content (web search, code interpreter) — rendered as separate callout */
  toolContent?: string;
  /** Zero-based message order in conversation */
  index: number;
}

/**
 * Extracted conversation data
 */
export interface ConversationData {
  id: string;
  title: string;
  url: string;
  source: AIPlatform;
  type?: 'conversation' | 'deep-research';
  /** Deep Research link information (optional) */
  links?: DeepResearchLinks;
  messages: ConversationMessage[];
  /** Images captured from the conversation (e.g. Gemini-generated images) */
  images?: ExtractedImage[];
  extractedAt: Date;
  metadata: ConversationMetadata;
  /** Presence describes whether this export came from a complete archive capture. */
  capture?: ConversationCaptureMetadata;
  /** Optional derived view identity; the canonical archive remains unchanged. */
  presentation?: ConversationPresentationMetadata;
}

/** A capture-scoped Markdown view derived from one validated archive graph. */
export type ConversationPresentationMetadata =
  | {
      mode: 'selected-branch' | 'all-branches-leaf';
      captureId: string;
      branchOrdinal: number;
      branchCount: number;
      branchPointCount: number;
    }
  | {
      mode: 'all-branches-index';
      captureId: string;
      branchCount: number;
      branchPointCount: number;
    };

/**
 * Deep Research source information
 *
 * Design: Sources are stored in DOM order (0-based array).
 * Mapping to data-turn-source-index (1-based):
 *   data-turn-source-index="N" → sources[N-1]
 */
export interface DeepResearchSource {
  /** 0-based array index (DOM order) */
  index: number;
  /** Source URL */
  url: string;
  /** Source title */
  title: string;
  /** Domain name */
  domain: string;
}

/**
 * Deep Research links extraction result
 *
 * Design: Only sources array is stored. Inline citations are processed
 * during HTML→Markdown conversion using data-turn-source-index attribute.
 */
export interface DeepResearchLinks {
  /** Source list (DOM order, 0-based index) */
  sources: DeepResearchSource[];
}

/**
 * Additional metadata about the conversation
 */
export interface ConversationMetadata {
  /** Total number of messages */
  messageCount: number;
  /** Number of user messages */
  userMessageCount: number;
  /** Number of assistant (AI) messages */
  assistantMessageCount: number;
  /** Whether conversation contains code blocks */
  hasCodeBlocks: boolean;
  /** Estimated token count (reserved for future use - not currently calculated) */
  estimatedTokens?: number;
}

/**
 * Obsidian note structure
 */
export interface ObsidianNote {
  fileName: string;
  frontmatter: NoteFrontmatter;
  body: string;
  contentHash: string;
  /**
   * Images referenced by `g2o-image://{id}` placeholders in {@link body}.
   * Resolved per output destination in the background (Obsidian embed,
   * downloaded file, or stripped for clipboard).
   */
  images?: ExtractedImage[];
}

/**
 * YAML frontmatter fields
 */
export interface NoteFrontmatter {
  id: string;
  title: string;
  source: string;
  type?: string;
  url: string;
  created: string;
  modified: string;
  tags: string[];
  message_count: number;
  /** Capture evidence mode for ChatGPT exports only. */
  capture_mode?: ConversationCaptureMetadata['mode'];
  /** Capture evidence completeness for ChatGPT exports only. */
  capture_completeness?: ConversationCaptureMetadata['completeness'];
  /** Derived view kind; absent means the established current-branch note. */
  presentation_mode?: ConversationPresentationMetadata['mode'];
  /** One-based deterministic leaf position within this capture. */
  branch_ordinal?: number;
  /** Number of declared root-to-leaf branches in this capture. */
  branch_count?: number;
  /** Number of graph nodes with more than one child. */
  branch_point_count?: number;
  /** Opaque extension-generated snapshot identity, never a provider node ID. */
  archive_capture_id?: string;
}

/**
 * Output destination identifier
 */
export type OutputDestination = 'obsidian' | 'file' | 'clipboard';

/** Destinations that can retain private archive companion bytes. */
export type PersistentOutputDestination = Exclude<OutputDestination, 'clipboard'>;

/** Fixed, provider-neutral members of one structured archive snapshot. */
export const ARCHIVE_COMPANION_KINDS = ['raw', 'manifest', 'canonical'] as const;
export type ArchiveCompanionKind = (typeof ARCHIVE_COMPANION_KINDS)[number];

/**
 * The paths are deliberately archive-internal, not user-controlled filenames.
 * The background combines them with an opaque conversation key and capture ID.
 */
export const ARCHIVE_COMPANION_RELATIVE_PATHS: Readonly<Record<ArchiveCompanionKind, string>> = {
  raw: 'responses/conversation.json',
  manifest: 'manifest.json',
  canonical: 'canonical/liska-thread-1.json',
};

/** One immutable JSON artifact in a structured archive snapshot. */
export interface ArchiveCompanionArtifact {
  kind: ArchiveCompanionKind;
  relativePath: string;
  mediaType: 'application/json';
  byteLength: number;
  sha256: string;
  /** Canonical standard base64. Raw artifacts retain the captured text verbatim. */
  bodyBase64: string;
}

/**
 * Provider-neutral, runtime-only archive companion bundle.
 *
 * `conversationKey` is a SHA-256-derived opaque path segment. It intentionally
 * never exposes a provider conversation identifier in a vault or Downloads.
 */
export interface ArchiveCompanionBundle {
  captureId: string;
  conversationKey: string;
  /** Raw + manifest are always present; canonical is appended after normalization. */
  artifacts:
    | readonly [ArchiveCompanionArtifact, ArchiveCompanionArtifact]
    | readonly [ArchiveCompanionArtifact, ArchiveCompanionArtifact, ArchiveCompanionArtifact];
}

/**
 * Runtime-only original ChatGPT capture retained for an optional attachment
 * export pass. It is never sent over an extension message or serialized into
 * Markdown/archive companions. The raw base64 is retained solely to bind a
 * later marker-gated resolver observation to these exact source bytes.
 */
export interface ChatGptAssetExportContext {
  conversationId: string;
  rawCaptureBundle: RawCaptureBundle;
  rawBodyBase64: string;
}

/**
 * Provider-neutral description of one verified binary archive asset.
 *
 * `assetId` is an opaque runtime correlation key only. The persisted name is
 * content-addressed, so a provider filename, URL, signature, and identifier
 * never cross the persistence boundary.
 */
export interface StagedBinaryAssetDescriptor {
  assetId: string;
  byteLength: number;
  sha256: string;
  mediaType: string;
  relativePath: string;
}

/** One durable binary destination result, scoped to a single asset. */
export interface StagedBinaryAssetResult {
  assetId: string;
  descriptor?: StagedBinaryAssetDescriptor;
  results: OutputResult[];
  allSuccessful: boolean;
}

/** Runtime-only plan consumed sequentially by the content orchestrator. */
export interface AllBranchesPresentationPlan {
  archive: LiskaThreadArchive;
  catalog: ArchiveBranchCatalog;
}

/** Evidence mode attached to a projected conversation, not to rendered text. */
export interface ConversationCaptureMetadata {
  mode: 'structured-api' | 'dom-fallback';
  completeness: 'complete' | 'partial';
}

/**
 * Output option settings
 * Manages enabled/disabled state for each output destination
 */
export interface OutputOptions {
  /** Save via Obsidian REST API */
  obsidian: boolean;
  /** Save as file to downloads folder */
  file: boolean;
  /** Copy to system clipboard */
  clipboard: boolean;
}

/**
 * Result of a single output operation
 */
export interface OutputResult {
  destination: OutputDestination;
  success: boolean;
  error?: string;
  /** Number of messages appended (Obsidian append mode only) */
  messagesAppended?: number;
  /**
   * Actual file name used when the intended name was occupied by a
   * DIFFERENT conversation (filename collision safeguard, issue #327).
   */
  savedAs?: string;
  /**
   * Non-fatal problem encountered while writing to this destination
   * (e.g. an image that could not be saved, issue #376). Surfaced to the
   * user as a follow-up warning toast; the output itself still succeeded.
   */
  warning?: string;
}

/**
 * Response from offscreen clipboard write operation
 */
export interface ClipboardWriteResponse {
  success: boolean;
  error?: string;
}

/**
 * Aggregated result of multiple output operations
 */
export interface MultiOutputResponse {
  results: OutputResult[];
  /** Whether all outputs succeeded */
  allSuccessful: boolean;
  /** Whether at least one output succeeded */
  anySuccessful: boolean;
  /** Number of messages appended (append mode only) */
  messagesAppended?: number;
}

/**
 * Secure settings (stored in local storage)
 * Sensitive data like API keys are stored locally, not synced
 */
export interface SecureSettings {
  obsidianApiKey: string;
}

/**
 * Sync settings (stored in sync storage)
 * Non-sensitive data that can be synced across devices
 */
export interface SyncSettings {
  obsidianUrl: string;
  vaultPath: string;
  templateOptions: TemplateOptions;
  outputOptions: OutputOptions;
  /** Enable auto-scroll to load all messages in long conversations (e.g. Gemini) */
  enableAutoScroll: boolean;
  /** Enable append mode to only add new messages to existing notes */
  enableAppendMode: boolean;
  /** Include tool-use / intermediate content (e.g., web search results) */
  enableToolContent: boolean;
  /** Export conversation images (Obsidian vault + file download). */
  enableImageExport: boolean;
  /**
   * Experimental ChatGPT metadata-only opaque request probe. While enabled a
   * ChatGPT export stops before capture, DOM fallback, or persistence.
   */
  enableChatGptOpaqueProbe: boolean;
  /**
   * Experimental one-shot ChatGPT A-strict replay. The exact eligible request
   * template remains inside MAIN world; credential values never cross the
   * extension boundary. Disabled by default.
   */
  enableChatGptOpaqueReplay: boolean;
  /**
   * Vault-relative folder for exported images. Supports the same template
   * tokens as {@link vaultPath} (`{platform}`, `{YYYY}`, …). Default
   * `AI/{platform}/images`. Obsidian resolves attachments by filename, so the
   * note's wikilink embeds need only the filename regardless of this folder.
   */
  imageVaultPath: string;
  /**
   * Obsidian-only: flatten callouts longer than {@link maxCalloutLines} to
   * plain text when saving to the vault. A very long message rendered as one
   * giant callout can hang Obsidian's renderer; downloaded markdown is
   * unaffected. Default true.
   */
  flattenLargeCallouts: boolean;
  /** Line threshold for {@link flattenLargeCallouts}. Default 200. */
  maxCalloutLines: number;
}

/**
 * Extension settings stored in chrome.storage
 * Combined interface merging SecureSettings and SyncSettings
 */
export interface ExtensionSettings extends SecureSettings, SyncSettings {}

/**
 * Settings returned to content scripts (API key redacted)
 *
 * Security: Content scripts run inside third-party pages and should
 * never receive the actual API key. They only need to know whether
 * a key is configured (boolean flag).
 */
export interface ContentScriptSettings extends SyncSettings {
  isApiKeyConfigured: boolean;
}

/**
 * Note filename naming scheme (issue #328).
 * - `title-id`   — `{slug}-{conversationId[:8]}.md` (default, current behavior)
 * - `title-date` — `{slug}-{YYYY}-{MM}-{DD}.md` using the local save date
 */
export type FilenameScheme = 'title-id' | 'title-date';

/**
 * Template customization options
 */
export interface TemplateOptions {
  /** Include conversation ID in frontmatter */
  includeId: boolean;
  /** Include title in frontmatter */
  includeTitle: boolean;
  /** Include tags in frontmatter */
  includeTags: boolean;
  /** Include source platform in frontmatter */
  includeSource: boolean;
  /** Include created/modified dates in frontmatter */
  includeDates: boolean;
  /** Include message count in frontmatter */
  includeMessageCount: boolean;
  /** Message formatting style */
  messageFormat: 'callout' | 'plain' | 'blockquote';
  /** Callout type for user messages (e.g., 'QUESTION') */
  userCalloutType: string;
  /** Callout type for assistant messages (e.g., 'NOTE') */
  assistantCalloutType: string;
  /**
   * Prepend an `##` header derived from the user message before each user
   * callout/blockquote/plain block. Enables Obsidian TOC navigation in long
   * conversations. Defaults to false (issue #187).
   */
  includeQuestionHeaders?: boolean;
  /** IANA timezone for created/modified dates (e.g., 'Asia/Tokyo'). Defaults to 'UTC'. */
  timezone?: string;
  /** Note filename naming scheme (issue #328). Defaults to `title-id`. */
  filenameScheme?: FilenameScheme;
}

/**
 * Message types for chrome.runtime communication
 */
export type ExtensionMessage =
  | { action: 'saveToOutputs'; data: ObsidianNote; outputs: OutputDestination[] }
  | { action: 'updateOutputOptions'; outputOptions: OutputOptions }
  | {
      action: 'persistArchiveCompanion';
      noteFileName: string;
      source: AIPlatform;
      captureId: string;
      conversationKey: string;
      artifact: ArchiveCompanionArtifact;
      outputs: PersistentOutputDestination[];
    }
  | {
      action: 'beginStagedBinaryAsset';
      source: AIPlatform;
      stageId: string;
      descriptor: StagedBinaryAssetDescriptor;
    }
  | {
      action: 'appendStagedBinaryAsset';
      source: AIPlatform;
      stageId: string;
      offset: number;
      chunkBase64: string;
    }
  | {
      action: 'commitStagedBinaryAsset';
      stageId: string;
      captureId: string;
      conversationKey: string;
      source: AIPlatform;
      descriptor: StagedBinaryAssetDescriptor;
      outputs: PersistentOutputDestination[];
    }
  | { action: 'abortStagedBinaryAsset'; source: AIPlatform; stageId: string }
  | { action: 'getSettings' }
  | { action: 'testConnection' }
  | { action: 'fetchImage'; url: string }
  | {
      action: 'captureChatGptConversation';
      conversationId: string;
      /** Explicit opt-in; absent stale-tab messages remain on the fast path. */
      observeAssetResolvers?: boolean;
    }
  | { action: 'probeChatGptOpaqueRequest'; conversationId: string }
  | { action: 'captureChatGptConversationViaOpaqueReplay'; conversationId: string }
  | { action: 'observeChatGptAssetResolversViaOpaqueSource'; conversationId: string }
  | {
      action: 'probeChatGptActiveAssetResolvers';
      conversationId: string;
      /** Transient only: never persisted, logged, or returned to content. */
      providerFileIds: string[];
    };

/**
 * Response to a `fetchImage` message. The background worker fetches remote
 * images the content script cannot reach (CORS) and returns them as base64.
 */
export type ImageFetchResponse =
  | { success: true; data: string; mimeType: string; error?: undefined }
  | { success: false; error: string; data?: undefined; mimeType?: undefined };

/**
 * Message sent from the background worker to the offscreen document.
 * Kept separate from ExtensionMessage: the background listener routes
 * `target: 'offscreen'` messages away before validation.
 */
export interface OffscreenClipboardMessage {
  action: 'clipboardWrite';
  target: 'offscreen';
  content: string;
}

/** Create an extension-owned Blob URL without putting private bytes in download metadata. */
export interface OffscreenArchiveBlobCreateMessage {
  action: 'archiveBlobCreate';
  target: 'offscreen';
  bodyBase64: string;
  mediaType: 'application/json';
}

/** Revoke only a Blob URL previously created by this offscreen document. */
export interface OffscreenArchiveBlobRevokeMessage {
  action: 'archiveBlobRevoke';
  target: 'offscreen';
  url: string;
}

/** Start one exact safe-named OPFS binary stage. */
export interface OffscreenBinaryStageBeginMessage {
  action: 'binaryStageBegin';
  target: 'offscreen';
  stageId: string;
  descriptor: StagedBinaryAssetDescriptor;
}

/** Append one independently canonical-base64 chunk at an exact byte offset. */
export interface OffscreenBinaryStageAppendMessage {
  action: 'binaryStageAppend';
  target: 'offscreen';
  stageId: string;
  offset: number;
  chunkBase64: string;
}

/** Verify the exact persisted descriptor, size, and digest before outputs. */
export interface OffscreenBinaryStageFinalizeMessage {
  action: 'binaryStageFinalize';
  target: 'offscreen';
  stageId: string;
  descriptor: StagedBinaryAssetDescriptor;
}

/** Revoke a finalized URL and clean only its exact OPFS stage. */
export interface OffscreenBinaryStageReleaseMessage {
  action: 'binaryStageRelease';
  target: 'offscreen';
  stageId: string;
  url: string;
}

/** Remove only one exact unfinished OPFS stage. */
export interface OffscreenBinaryStageAbortMessage {
  action: 'binaryStageAbort';
  target: 'offscreen';
  stageId: string;
}

export type OffscreenArchiveBlobMessage =
  | OffscreenArchiveBlobCreateMessage
  | OffscreenArchiveBlobRevokeMessage;

export type OffscreenBinaryStageMessage =
  | OffscreenBinaryStageBeginMessage
  | OffscreenBinaryStageAppendMessage
  | OffscreenBinaryStageFinalizeMessage
  | OffscreenBinaryStageReleaseMessage
  | OffscreenBinaryStageAbortMessage;

export type OffscreenMessage =
  | OffscreenClipboardMessage
  | OffscreenArchiveBlobMessage
  | OffscreenBinaryStageMessage;

export type ArchiveBlobCreateResponse =
  | { success: true; url: string }
  | { success: false; error: string };

export type ArchiveBlobRevokeResponse = { success: boolean; error?: string };

export type BinaryStageResponse = { success: boolean; error?: string };

export type BinaryStageFinalizeResponse =
  | { success: true; url: string }
  | { success: false; error: string };

export interface OutputOptionsUpdateResponse {
  success: boolean;
  error?: string;
}

/**
 * Response from background service worker
 */
export interface SaveResponse {
  success: boolean;
  error?: string;
  isNewFile?: boolean;
  messagesAppended?: number;
  /** Actual file name when a collision forced an alternative (issue #327) */
  savedAs?: string;
  /**
   * Non-fatal problem encountered while saving — the note itself was written.
   * Currently set when one or more images could not be written (issue #376).
   */
  warning?: string;
}

/**
 * Extraction result from content script
 */
export interface ExtractionResult {
  success: boolean;
  /** A trusted local picker was dismissed before any output was requested. */
  cancelled?: boolean;
  data?: ConversationData;
  error?: string;
  warnings?: string[];
  /** Present only when a structured capture produced all immutable companions. */
  archiveCompanion?: ArchiveCompanionBundle;
  /** Runtime-only source evidence for optional destination-honest ChatGPT attachment export. */
  chatGptAssetExportContext?: ChatGptAssetExportContext;
  /** Complete graph retained for sequential per-leaf presentation writes. */
  allBranches?: AllBranchesPresentationPlan;
}

/**
 * Validation result for extraction quality
 */
export interface ValidationResult {
  isValid: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Interface for AI platform extractors
 */
export interface IConversationExtractor {
  readonly platform: AIPlatform;
  canExtract(): boolean;
  extract(): Promise<ExtractionResult>;
  getConversationId(): string | null;
  getTitle(): string;
  extractMessages(): ConversationMessage[];
  validate(result: ExtractionResult): ValidationResult;
  applySettings(settings: SyncSettings): void;
}
