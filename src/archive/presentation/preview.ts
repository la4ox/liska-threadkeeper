import { utf8ByteLength } from '../../lib/byte-size';
import {
  HTML_DIAGNOSTIC_LABELS,
  HTML_PRESENTATION_LIMITS,
  type HtmlDiagnosticCode,
} from './contracts';
import { requireSelfContainedMarkdownBody } from './markdown-body';
import { PresentationContext } from './safety';
import {
  LISKA_PRESENTATION_PREVIEW_SCHEMA,
  LISKA_PRESENTATION_PROFILE_SCHEMA,
  PRESENTATION_PREVIEW_LIMITS,
  PRESENTATION_RENDERER_VERSIONS,
  type ArchivePresentationPreview,
  type PresentationDiagnostic,
  type PresentationPreviewLimits,
  type PresentationPreviewRow,
  type PresentationProfile,
} from './presentation-contracts';
import {
  LISKA_READING_PROFILE_SCHEMA,
  LISKA_TEXT_PREVIEW_SCHEMA,
  TEXT_DIAGNOSTIC_LABELS,
  type ArchiveTextPreview,
  type TextDiagnosticCode,
  type TextPresentationSelection,
} from './text-contracts';
import {
  adoptArchiveTextPreview,
  createTextPresentationSelection,
  resolveTextPreviewRange,
  snapshotTextPresentationSelection,
} from './text-preview-selection';
import {
  presentationArray,
  presentationFail,
  presentationGuard,
  presentationLimits,
  presentationRecord,
  requireSafeHtmlBody,
} from './preview-safety';

const previews = new WeakSet<ArchivePresentationPreview>();
const adapters = new WeakMap<ArchivePresentationPreview, ArchiveTextPreview>();
const SHA256 = /^[a-f0-9]{64}$/;

export function snapshotPresentationProfile(value: unknown, wire = true): PresentationProfile {
  const fields = presentationRecord(
    value,
    wire
      ? ['schema', 'includeToolContent', 'inertTaggedCodeBlocks']
      : ['includeToolContent', 'inertTaggedCodeBlocks'],
    'presentation-profile-invalid'
  );
  if (
    (wire && fields.schema !== LISKA_PRESENTATION_PROFILE_SCHEMA) ||
    typeof fields.includeToolContent !== 'boolean' ||
    typeof fields.inertTaggedCodeBlocks !== 'boolean'
  )
    presentationFail('presentation-profile-invalid');
  return Object.freeze({
    schema: LISKA_PRESENTATION_PROFILE_SCHEMA,
    includeToolContent: fields.includeToolContent,
    inertTaggedCodeBlocks: fields.inertTaggedCodeBlocks,
  });
}

function diagnostics<C extends string>(
  value: unknown,
  labels: Record<C, string>
): readonly PresentationDiagnostic<C>[] {
  let previous = '';
  const result = presentationArray(
    value,
    Object.keys(labels).length,
    'presentation-diagnostics-invalid'
  ).map(item => {
    const record = presentationRecord(item, ['code', 'count'], 'presentation-diagnostics-invalid');
    if (
      typeof record.code !== 'string' ||
      !Object.prototype.hasOwnProperty.call(labels, record.code) ||
      record.code <= previous ||
      !Number.isSafeInteger(record.count) ||
      (record.count as number) <= 0 ||
      (record.count as number) > 2_000_000
    )
      presentationFail('presentation-diagnostics-invalid');
    previous = record.code;
    return Object.freeze({ code: record.code as C, count: record.count as number });
  });
  return Object.freeze(result);
}

function snapshotRow(value: unknown, limits: PresentationPreviewLimits): PresentationPreviewRow {
  const fields = presentationRecord(
    value,
    ['nodeId', 'role', 'presentedText', 'markdownBody', 'htmlBody', 'diagnostics'],
    'presentation-preview-invalid'
  );
  if (
    typeof fields.nodeId !== 'string' ||
    fields.nodeId.length === 0 ||
    (fields.role !== 'user' && fields.role !== 'assistant') ||
    typeof fields.presentedText !== 'string' ||
    typeof fields.markdownBody !== 'string' ||
    typeof fields.htmlBody !== 'string'
  )
    presentationFail('presentation-preview-invalid');
  if (
    fields.nodeId.length +
      fields.presentedText.length +
      fields.markdownBody.length +
      fields.htmlBody.length >
    limits.maxRowChars
  )
    presentationFail('presentation-row-char-limit');
  const codes = presentationRecord(
    fields.diagnostics,
    ['text', 'markdown', 'html'],
    'presentation-diagnostics-invalid'
  );
  const row = Object.freeze({
    nodeId: fields.nodeId,
    role: fields.role,
    presentedText: fields.presentedText,
    markdownBody: fields.markdownBody,
    htmlBody: fields.htmlBody,
    diagnostics: Object.freeze({
      text: diagnostics<TextDiagnosticCode>(codes.text, TEXT_DIAGNOSTIC_LABELS),
      markdown: diagnostics<HtmlDiagnosticCode>(codes.markdown, HTML_DIAGNOSTIC_LABELS),
      html: diagnostics<HtmlDiagnosticCode>(codes.html, HTML_DIAGNOSTIC_LABELS),
    }),
  });
  if (JSON.stringify(row).length > limits.maxRowChars)
    presentationFail('presentation-row-char-limit');
  requireSafeHtmlBody(row.htmlBody);
  return row;
}

function requireRendererVersions(value: unknown): void {
  const versions = presentationRecord(
    value,
    ['text', 'markdown', 'html'],
    'presentation-renderer-invalid'
  );
  if (
    Object.keys(PRESENTATION_RENDERER_VERSIONS).some(
      key =>
        versions[key] !==
        PRESENTATION_RENDERER_VERSIONS[key as keyof typeof PRESENTATION_RENDERER_VERSIONS]
    )
  )
    presentationFail('presentation-renderer-invalid');
}

function previewHeader(
  value: unknown,
  limits: PresentationPreviewLimits
): {
  header: Omit<ArchivePresentationPreview, 'rows'>;
  rowValues: unknown;
} {
  const fields = presentationRecord(
    value,
    [
      'schema',
      'sourceCanonicalSha256',
      'branchTargetNodeId',
      'title',
      'profile',
      'rendererVersions',
      'rows',
    ],
    'presentation-preview-invalid'
  );
  if (
    fields.schema !== LISKA_PRESENTATION_PREVIEW_SCHEMA ||
    typeof fields.sourceCanonicalSha256 !== 'string' ||
    !SHA256.test(fields.sourceCanonicalSha256) ||
    typeof fields.branchTargetNodeId !== 'string' ||
    fields.branchTargetNodeId.length === 0 ||
    (fields.title !== null && typeof fields.title !== 'string')
  )
    presentationFail('presentation-preview-invalid');
  if (fields.title !== null && fields.title.length > limits.maxTitleChars)
    presentationFail('presentation-title-char-limit');
  const profile = snapshotPresentationProfile(fields.profile);
  requireRendererVersions(fields.rendererVersions);
  if (fields.branchTargetNodeId.length + (fields.title?.length ?? 0) > limits.maxTotalChars)
    presentationFail('presentation-total-char-limit');
  return {
    header: {
      schema: LISKA_PRESENTATION_PREVIEW_SCHEMA,
      sourceCanonicalSha256: fields.sourceCanonicalSha256,
      branchTargetNodeId: fields.branchTargetNodeId,
      title: fields.title,
      profile,
      rendererVersions: PRESENTATION_RENDERER_VERSIONS,
    },
    rowValues: fields.rows,
  };
}

function previewRows(
  value: unknown,
  limits: PresentationPreviewLimits,
  sharedContext?: PresentationContext
): readonly PresentationPreviewRow[] {
  const rows: PresentationPreviewRow[] = [];
  // These are already-derived bodies (not provider source), with the row ceiling
  // as parser-input ceiling and aggregate traversal/container budgets retained.
  const markdownContext =
    sharedContext ??
    new PresentationContext({
      ...HTML_PRESENTATION_LIMITS,
      maxMarkdownChars: limits.maxRowChars,
    });
  const seen = new Set<string>();
  let chars = 0;
  for (const item of presentationArray(value, limits.maxRows, 'presentation-row-limit')) {
    const row = snapshotRow(item, limits);
    requireSelfContainedMarkdownBody(row.markdownBody, markdownContext, limits.maxRowChars);
    if (seen.has(row.nodeId)) presentationFail('presentation-preview-invalid');
    seen.add(row.nodeId);
    chars += JSON.stringify(row).length;
    if (chars > limits.maxTotalChars) presentationFail('presentation-total-char-limit');
    rows.push(row);
  }
  return Object.freeze(rows);
}

/** @internal Reuse canonical preparation's complete parser/work budget for body validation too. */
export function adoptPreparedPresentationPreview(
  value: unknown,
  overrides?: Partial<PresentationPreviewLimits>,
  sharedContext?: PresentationContext
): ArchivePresentationPreview {
  return presentationGuard(() => {
    const limits = presentationLimits(PRESENTATION_PREVIEW_LIMITS, overrides);
    const { header, rowValues } = previewHeader(value, limits);
    const preview: ArchivePresentationPreview = Object.freeze({
      ...header,
      rows: previewRows(rowValues, limits, sharedContext),
    });
    const envelope = JSON.stringify(preview);
    if (envelope.length > limits.maxTotalChars) presentationFail('presentation-total-char-limit');
    if (utf8ByteLength(envelope) > limits.maxEnvelopeBytes)
      presentationFail('presentation-envelope-byte-limit');
    previews.add(preview);
    return preview;
  }, 'presentation-preview-invalid');
}

/** Strict bounded ownership only. The caller establishes the wire sender's authority. */
export function adoptArchivePresentationPreview(
  value: unknown,
  overrides?: Partial<PresentationPreviewLimits>
): ArchivePresentationPreview {
  return adoptPreparedPresentationPreview(value, overrides);
}

export function requireArchivePresentationPreview(value: ArchivePresentationPreview): void {
  if (!previews.has(value)) presentationFail('presentation-preview-invalid');
}

/** Explicit /1 compatibility adapter; the richer profile is NOT silently put in selection /1. */
export function presentationPreviewAsTextPreview(
  preview: ArchivePresentationPreview
): ArchiveTextPreview {
  requireArchivePresentationPreview(preview);
  let adapter = adapters.get(preview);
  if (!adapter) {
    adapter = adoptArchiveTextPreview({
      schema: LISKA_TEXT_PREVIEW_SCHEMA,
      sourceCanonicalSha256: preview.sourceCanonicalSha256,
      branchTargetNodeId: preview.branchTargetNodeId,
      title: preview.title,
      profile: {
        schema: LISKA_READING_PROFILE_SCHEMA,
        includeToolContent: preview.profile.includeToolContent,
      },
      rows: preview.rows.map(({ nodeId, role, presentedText }) => ({
        nodeId,
        role,
        presentedText,
      })),
    });
    adapters.set(preview, adapter);
  }
  return adapter;
}
export function snapshotPresentationSelection(
  preview: ArchivePresentationPreview,
  value: unknown
): TextPresentationSelection {
  return snapshotTextPresentationSelection(presentationPreviewAsTextPreview(preview), value);
}
export function createPresentationSelection(
  preview: ArchivePresentationPreview,
  ids: readonly string[]
): TextPresentationSelection {
  return createTextPresentationSelection(presentationPreviewAsTextPreview(preview), ids);
}
export function resolvePresentationSelection(
  preview: ArchivePresentationPreview,
  value: unknown
): readonly PresentationPreviewRow[] {
  const selection = snapshotPresentationSelection(preview, value);
  const ids = new Set(selection.messageNodeIds);
  return Object.freeze(preview.rows.filter(row => ids.has(row.nodeId)));
}
export function resolvePresentationPreviewRange(
  preview: ArchivePresentationPreview,
  start: number,
  end: number
): readonly string[] {
  return resolveTextPreviewRange(presentationPreviewAsTextPreview(preview), start, end);
}
