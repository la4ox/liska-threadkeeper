import type { ArchiveMessage } from '../types';
import { HTML_PRESENTATION_LIMITS, type HtmlPresentationDiagnostic } from './contracts';
import { visitArchiveHtmlPreviewRows } from './html';
import { renderCanonicalMarkdownBody } from './markdown-body';
import {
  LISKA_PRESENTATION_PREVIEW_SCHEMA,
  PRESENTATION_PREVIEW_LIMITS,
  PRESENTATION_RENDERER_VERSIONS,
  type ArchivePresentationPreview,
  type PresentationPreviewInput,
  type PresentationPreviewLimits,
  type PresentationPreviewRow,
} from './presentation-contracts';
import { adoptPreparedPresentationPreview, snapshotPresentationProfile } from './preview';
import {
  presentationFail,
  presentationGuard,
  presentationLimits,
  presentationRecord,
} from './preview-safety';
import type { PresentationContext } from './safety';
import { prepareTextPreviewWithDiagnostics } from './text';

function preparationInput(value: PresentationPreviewInput) {
  const input = presentationRecord(
    value,
    ['archive', 'canonicalSha256', 'targetNodeId', 'profile', 'limits', 'previewLimits'],
    'presentation-input-invalid',
    true
  );
  const profile = snapshotPresentationProfile(input.profile, false);
  return {
    profile,
    previewLimits: presentationLimits(PRESENTATION_PREVIEW_LIMITS, input.previewLimits),
    htmlLimits: presentationLimits(HTML_PRESENTATION_LIMITS, input.limits),
    common: {
      archive: input.archive as PresentationPreviewInput['archive'],
      canonicalSha256: input.canonicalSha256 as string,
      profile: { includeToolContent: profile.includeToolContent },
      ...(Object.prototype.hasOwnProperty.call(input, 'targetNodeId')
        ? { targetNodeId: input.targetNodeId as string }
        : {}),
    },
  };
}
type Preparation = ReturnType<typeof preparationInput>;
type PreparedText = ReturnType<typeof prepareTextPreviewWithDiagnostics>;

function prepareText(input: Preparation): PreparedText {
  const { common, htmlLimits, previewLimits } = input;
  return prepareTextPreviewWithDiagnostics({
    ...common,
    limits: {
      maxInputJsonNodes: htmlLimits.maxInputJsonNodes,
      maxInputJsonDepth: htmlLimits.maxInputJsonDepth,
      maxInputChars: htmlLimits.maxInputChars,
      maxSelectedNodes: htmlLimits.maxSelectedNodes,
      maxSelectedBlocks: htmlLimits.maxSelectedBlocks,
      maxSourceChars: htmlLimits.maxSourceChars,
      maxJsonSerializationChars: htmlLimits.maxJsonSerializationChars,
      maxTextChars: previewLimits.maxTotalChars,
      maxTextBytes: previewLimits.maxEnvelopeBytes,
    },
    previewLimits: {
      maxRows: previewLimits.maxRows,
      maxRowChars: previewLimits.maxRowChars,
      maxTitleChars: previewLimits.maxTitleChars,
      maxTotalChars: previewLimits.maxTotalChars,
    },
  });
}

class PreviewRows {
  readonly rows: PresentationPreviewRow[] = [];
  private total: number;
  private rowChars: number;
  constructor(
    readonly text: PreparedText,
    readonly includeToolContent: boolean,
    readonly limits: PresentationPreviewLimits
  ) {
    this.total = text.preview.title?.length ?? 0;
    this.rowChars = text.preview.rows[0]?.presentedText.length ?? 0;
  }
  emit(part: string): void {
    this.rowChars += part.length;
    if (this.rowChars > this.limits.maxRowChars) presentationFail('presentation-row-char-limit');
    if (this.total + this.rowChars > this.limits.maxTotalChars)
      presentationFail('presentation-total-char-limit');
  }
  append(
    nodeId: string,
    message: ArchiveMessage,
    filenames: ReadonlyMap<string, string | null>,
    context: PresentationContext,
    htmlBody: string,
    htmlDiagnostics: HtmlPresentationDiagnostic[]
  ): void {
    const plain = this.text.preview.rows[this.rows.length];
    if (plain?.nodeId !== nodeId || plain.role !== message.author.role)
      presentationFail('presentation-input-invalid');
    const markdownBody = renderCanonicalMarkdownBody(
      message,
      filenames,
      this.includeToolContent,
      context
    );
    const row: PresentationPreviewRow = {
      ...plain,
      markdownBody,
      htmlBody,
      diagnostics: {
        text: this.text.diagnostics.get(nodeId) ?? [],
        markdown: context.takeDiagnostics(),
        html: htmlDiagnostics,
      },
    };
    const size = JSON.stringify(row).length;
    if (size > this.limits.maxRowChars) presentationFail('presentation-row-char-limit');
    this.total += size;
    if (this.total > this.limits.maxTotalChars) presentationFail('presentation-total-char-limit');
    this.rows.push(row);
    this.rowChars = this.text.preview.rows[this.rows.length]?.presentedText.length ?? 0;
  }
}

/** Render all three bodies only while canonical is authorized, then discard it. */
export function prepareArchivePresentationPreview(
  value: PresentationPreviewInput
): ArchivePresentationPreview {
  return presentationGuard(() => {
    const input = preparationInput(value);
    const text = prepareText(input);
    const builder = new PreviewRows(text, input.profile.includeToolContent, input.previewLimits);
    const context = visitArchiveHtmlPreviewRows(
      { ...input.common, limits: input.htmlLimits },
      builder.append.bind(builder),
      builder.emit.bind(builder)
    );
    if (builder.rows.length !== text.preview.rows.length)
      presentationFail('presentation-input-invalid');
    return adoptPreparedPresentationPreview(
      {
        schema: LISKA_PRESENTATION_PREVIEW_SCHEMA,
        sourceCanonicalSha256: text.preview.sourceCanonicalSha256,
        branchTargetNodeId: text.preview.branchTargetNodeId,
        title: text.preview.title,
        profile: input.profile,
        rendererVersions: PRESENTATION_RENDERER_VERSIONS,
        rows: builder.rows,
      },
      input.previewLimits,
      context
    );
  }, 'presentation-input-invalid');
}
