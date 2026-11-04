import type { LiskaThreadArchive } from '../types';
import type { HtmlDiagnosticCode, HtmlPresentationLimits } from './contracts';
import type { TextDiagnosticCode, TextPresentationSelection } from './text-contracts';

export const LISKA_PRESENTATION_PREVIEW_SCHEMA = 'liska-presentation-preview/1' as const;
export const LISKA_PRESENTATION_PROFILE_SCHEMA = 'liska-presentation-profile/1' as const;
export const LISKA_SELECTED_PRESENTATION_SCHEMA = 'liska-selected-presentation/1' as const;
export const PRESENTATION_RENDERER_VERSIONS = Object.freeze({
  text: 'liska-text/1',
  markdown: 'liska-selected-markdown/1',
  html: 'liska-selected-html/1',
} as const);

/** Combined, not per-format, ceilings. Envelope counts include JSON framing/escaping. */
export const PRESENTATION_PREVIEW_LIMITS = Object.freeze({
  maxRows: 5_000,
  maxRowChars: 1024 * 1024,
  maxTitleChars: 64 * 1024,
  maxTotalChars: 8 * 1024 * 1024,
  maxEnvelopeBytes: 12 * 1024 * 1024,
});
export type PresentationPreviewLimits = {
  -readonly [K in keyof typeof PRESENTATION_PREVIEW_LIMITS]: number;
};
export const SELECTED_PRESENTATION_LIMITS = Object.freeze({
  maxOutputChars: 8 * 1024 * 1024,
  maxOutputBytes: 12 * 1024 * 1024,
});
export type SelectedPresentationLimits = {
  -readonly [K in keyof typeof SELECTED_PRESENTATION_LIMITS]: number;
};

export interface PresentationProfile {
  readonly schema: typeof LISKA_PRESENTATION_PROFILE_SCHEMA;
  readonly includeToolContent: boolean;
  readonly inertTaggedCodeBlocks: boolean;
}
export interface PresentationDiagnostic<C extends string = HtmlDiagnosticCode> {
  readonly code: C;
  readonly count: number;
}
export interface PresentationPreviewRow {
  readonly nodeId: string;
  readonly role: 'user' | 'assistant';
  readonly presentedText: string;
  readonly markdownBody: string;
  readonly htmlBody: string;
  readonly diagnostics: Readonly<{
    text: readonly PresentationDiagnostic<TextDiagnosticCode>[];
    markdown: readonly PresentationDiagnostic[];
    html: readonly PresentationDiagnostic[];
  }>;
}
/** Detached presentation projection, never canonical authority or an asset binding. */
export interface ArchivePresentationPreview {
  readonly schema: typeof LISKA_PRESENTATION_PREVIEW_SCHEMA;
  readonly sourceCanonicalSha256: string;
  readonly branchTargetNodeId: string;
  readonly title: string | null;
  readonly profile: PresentationProfile;
  readonly rendererVersions: typeof PRESENTATION_RENDERER_VERSIONS;
  readonly rows: readonly PresentationPreviewRow[];
}
export interface PresentationPreviewInput {
  archive: LiskaThreadArchive;
  canonicalSha256: string;
  targetNodeId?: string;
  profile: { includeToolContent: boolean; inertTaggedCodeBlocks: boolean };
  /** Shared HTML source/parser/work ceilings across the entire prepared branch. */
  limits?: Partial<HtmlPresentationLimits>;
  previewLimits?: Partial<PresentationPreviewLimits>;
}
export type PresentationFormat = 'text' | 'markdown' | 'html';
export interface SelectedPresentationArtifact {
  readonly schema: typeof LISKA_SELECTED_PRESENTATION_SCHEMA;
  readonly format: PresentationFormat;
  readonly rendererVersion: (typeof PRESENTATION_RENDERER_VERSIONS)[PresentationFormat];
  readonly previewSchema: typeof LISKA_PRESENTATION_PREVIEW_SCHEMA;
  readonly profile: PresentationProfile;
  readonly content: string;
  readonly mediaType: 'text/plain' | 'text/markdown' | 'text/html';
  readonly extension: 'txt' | 'md' | 'html';
  readonly selection: TextPresentationSelection;
  readonly availableMessageCount: number;
  readonly renderedMessageCount: number;
  readonly diagnostics: readonly PresentationDiagnostic<string>[];
}
export type PresentationErrorCode =
  | 'presentation-input-invalid'
  | 'presentation-preview-invalid'
  | 'presentation-profile-invalid'
  | 'presentation-renderer-invalid'
  | 'presentation-limits-invalid'
  | 'presentation-row-limit'
  | 'presentation-row-char-limit'
  | 'presentation-title-char-limit'
  | 'presentation-total-char-limit'
  | 'presentation-envelope-byte-limit'
  | 'presentation-diagnostics-invalid'
  | 'presentation-html-invalid'
  | 'presentation-markdown-invalid'
  | 'presentation-output-limit'
  | 'presentation-markdown-finalization-failed';
export class PresentationError extends Error {
  constructor(readonly code: PresentationErrorCode) {
    super(code);
    this.name = 'PresentationError';
  }
}
