import type { LiskaThreadArchive } from '../types';

export const LISKA_TEXT_SCHEMA = 'liska-text/1' as const;
export const LISKA_TEXT_RENDERER_VERSION = 'liska-text/1' as const;

/** Hard ceilings; callers may only tighten them. Character counts are UTF-16. */
export const TEXT_PRESENTATION_LIMITS = Object.freeze({
  maxInputJsonNodes: 2_000_000,
  maxInputJsonDepth: 96,
  maxInputChars: 64 * 1024 * 1024,
  maxSelectedNodes: 50_000,
  maxSelectedBlocks: 200_000,
  maxSourceChars: 16 * 1024 * 1024,
  maxTextChars: 32 * 1024 * 1024,
  maxTextBytes: 32 * 1024 * 1024,
  maxJsonSerializationChars: 2 * 1024 * 1024,
});

export type TextPresentationLimits = {
  -readonly [K in keyof typeof TEXT_PRESENTATION_LIMITS]: number;
};

export interface TextPresentationInput {
  archive: LiskaThreadArchive;
  /** Digest of the exact persisted canonical artifact. */
  canonicalSha256: string;
  /** Omitted means exactly conversation.currentNodeId. */
  targetNodeId?: string;
  profile: { includeToolContent: boolean };
  limits?: Partial<TextPresentationLimits>;
}

export type TextPresentationErrorCode =
  | 'text-input-invalid'
  | 'text-archive-invalid'
  | 'text-target-invalid'
  | 'text-canonical-digest-invalid'
  | 'text-profile-invalid'
  | 'text-limits-invalid'
  | 'text-input-node-limit'
  | 'text-input-depth-limit'
  | 'text-input-char-limit'
  | 'text-selected-node-limit'
  | 'text-selected-block-limit'
  | 'text-source-char-limit'
  | 'text-output-limit'
  | 'text-json-serialization-limit';

/** Deliberately value-free: input bodies and native exception text never escape. */
export class TextPresentationError extends Error {
  constructor(readonly code: TextPresentationErrorCode) {
    super(code);
    this.name = 'TextPresentationError';
  }
}

export const TEXT_DIAGNOSTIC_LABELS = {
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
  'attachment-name-absent': 'Attachment filename is absent.',
  'attachment-name-empty': 'Attachment filename is empty.',
  'canvas-unsupported': 'Canvas event is retained in canonical but not presented.',
  'unknown-unsupported': 'Unknown provider block is retained in canonical but not presented.',
} as const;

export type TextDiagnosticCode = keyof typeof TEXT_DIAGNOSTIC_LABELS;

export interface TextPresentationDiagnostic {
  code: TextDiagnosticCode;
  count: number;
}

export interface TextPresentationResult {
  schema: typeof LISKA_TEXT_SCHEMA;
  rendererVersion: typeof LISKA_TEXT_RENDERER_VERSION;
  text: string;
  selectedNodeCount: number;
  renderedMessageCount: number;
  diagnostics: TextPresentationDiagnostic[];
  canonicalSha256: string;
}
