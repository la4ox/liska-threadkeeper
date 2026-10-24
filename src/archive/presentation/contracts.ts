import type { LiskaThreadArchive } from '../types';

export const LISKA_HTML_SCHEMA = 'liska-html/1' as const;
export const LISKA_HTML_RENDERER_VERSION = 'liska-html/1' as const;

/** Hard ceilings; callers may only tighten these per presentation. Counts are UTF-16 characters. */
export const HTML_PRESENTATION_LIMITS = Object.freeze({
  maxInputJsonNodes: 2_000_000,
  maxInputJsonDepth: 96,
  maxInputChars: 64 * 1024 * 1024,
  maxSelectedNodes: 50_000,
  maxSelectedBlocks: 200_000,
  maxSourceChars: 16 * 1024 * 1024,
  maxHtmlChars: 64 * 1024 * 1024,
  maxHtmlBytes: 64 * 1024 * 1024,
  maxMarkdownChars: 256 * 1024,
  /** Independent parser-work ceiling even when fence/HTML context is ambiguous. */
  maxMarkdownContainerRun: 8_192,
  maxMarkdownContainerTokens: 65_536,
  maxMarkdownNodes: 200_000,
  maxMarkdownDepth: 64,
  maxJsonSerializationChars: 2 * 1024 * 1024,
  maxAssetBindings: 20_000,
});

export type HtmlPresentationLimits = {
  -readonly [K in keyof typeof HTML_PRESENTATION_LIMITS]: number;
};

export interface HtmlAssetBinding {
  assetId: string;
  /** Exact content-addressed, presentation-relative file; never a destination/vault path. */
  path: string;
  sha256: string;
  mimeType: string;
  byteLength: number;
  renderMode: 'image' | 'download';
}

/**
 * A caller-finalized receipt, not a request to acquire files. The caller verifies
 * actual bytes and this set's digest before invoking the pure renderer. This
 * module can check syntax/canonical agreement but cannot verify absent bytes.
 */
export interface HtmlAssetBindingSet {
  bindings: readonly HtmlAssetBinding[];
  sha256: string | null;
}

export interface HtmlPresentationInput {
  archive: LiskaThreadArchive;
  /** Digest of the exact canonical artifact, verified by the caller; not reserialized here. */
  canonicalSha256: string;
  /** Omitted means exactly conversation.currentNodeId; null/missing targets fail. */
  targetNodeId?: string;
  profile: { includeToolContent: boolean };
  assetBindings?: HtmlAssetBindingSet;
  limits?: Partial<HtmlPresentationLimits>;
}

export type HtmlPresentationErrorCode =
  | 'html-input-invalid'
  | 'html-archive-invalid'
  | 'html-target-invalid'
  | 'html-canonical-digest-invalid'
  | 'html-profile-invalid'
  | 'html-bindings-invalid'
  | 'html-binding-mismatch'
  | 'html-limits-invalid'
  | 'html-input-node-limit'
  | 'html-input-depth-limit'
  | 'html-input-char-limit'
  | 'html-selected-node-limit'
  | 'html-selected-block-limit'
  | 'html-source-char-limit'
  | 'html-output-limit'
  | 'html-markdown-char-limit'
  | 'html-markdown-container-limit'
  | 'html-markdown-node-limit'
  | 'html-markdown-depth-limit'
  | 'html-json-serialization-limit'
  | 'html-binding-count-limit'
  | 'html-markdown-invalid';

/** Deliberately value-free: never include input IDs, URLs, paths, bodies, or exception text. */
export class HtmlPresentationError extends Error {
  constructor(readonly code: HtmlPresentationErrorCode) {
    super(code);
    this.name = 'HtmlPresentationError';
  }
}

export const HTML_DIAGNOSTIC_LABELS = {
  'title-absent': 'Conversation title is absent.',
  'title-empty': 'Conversation title is empty.',
  'structural-node': 'Structural node has no message.',
  'message-empty': 'Message has an empty block list.',
  'message-role-omitted': 'Non-user/assistant message body is omitted.',
  'message-hidden-omitted': 'Hidden or technical-channel message body is omitted.',
  'block-empty': 'Block content is present but empty.',
  'technical-content-omitted': 'Technical block content is omitted by the profile.',
  'provider-html-inert': 'Provider HTML is displayed as inert source.',
  'citation-label-absent': 'Citation label is absent.',
  'citation-label-empty': 'Citation label is empty.',
  'citation-url-absent': 'Citation URL is absent.',
  'citation-content-absent': 'Citation content is absent.',
  'citation-content-unsupported':
    'Structured citation content is retained in canonical but not presented.',
  'unsafe-link-inert': 'Unsafe or unsupported link is displayed as inert text.',
  'markdown-image-reference': 'Markdown image is retained as a reference, not loaded.',
  'markdown-reference-definition': 'Markdown reference definition is retained as a reference.',
  'markdown-reference-unresolved': 'Markdown reference could not be resolved.',
  'markdown-node-unsupported': 'Unsupported Markdown structure is displayed as inert source.',
  'attachment-unbound': 'Attachment has no finalized local binding.',
  'attachment-name-absent': 'Attachment filename is absent.',
  'attachment-name-empty': 'Attachment filename is empty.',
  'canvas-unsupported': 'Canvas event is retained in canonical but not presented.',
  'unknown-unsupported': 'Unknown provider block is retained in canonical but not presented.',
} as const;

export type HtmlDiagnosticCode = keyof typeof HTML_DIAGNOSTIC_LABELS;
export interface HtmlPresentationDiagnostic {
  code: HtmlDiagnosticCode;
  count: number;
}

export interface HtmlPresentationResult {
  schema: typeof LISKA_HTML_SCHEMA;
  rendererVersion: typeof LISKA_HTML_RENDERER_VERSION;
  html: string;
  selectedNodeCount: number;
  renderedMessageCount: number;
  diagnostics: HtmlPresentationDiagnostic[];
  canonicalSha256: string;
  assetBindingSha256: string | null;
}
