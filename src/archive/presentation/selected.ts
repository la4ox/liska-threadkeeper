import { utf8ByteLength } from '../../shared/byte-size';
import { makeTaggedCodeBlocksInert } from '../../shared/inert-code-blocks';
import { HTML_DIAGNOSTIC_LABELS } from './contracts';
import { SELECTED_HTML_CSP, SELECTED_HTML_STYLE } from './html';
import { markdownFence } from './markdown-body';
import {
  LISKA_PRESENTATION_PREVIEW_SCHEMA,
  LISKA_SELECTED_PRESENTATION_SCHEMA,
  PRESENTATION_RENDERER_VERSIONS,
  SELECTED_PRESENTATION_LIMITS,
  type ArchivePresentationPreview,
  type PresentationDiagnostic,
  type PresentationFormat,
  type PresentationPreviewRow,
  type SelectedPresentationArtifact,
  type SelectedPresentationLimits,
} from './presentation-contracts';
import {
  presentationPreviewAsTextPreview,
  resolvePresentationSelection,
  snapshotPresentationSelection,
} from './preview';
import { presentationFail, presentationGuard, presentationLimits } from './preview-safety';
import { escapeHtml } from './safety';
import { renderTextSelection } from './text';
import { TEXT_DIAGNOSTIC_LABELS, type TextPresentationSelection } from './text-contracts';

const FORMAT_INFO = {
  text: { mediaType: 'text/plain', extension: 'txt' },
  markdown: { mediaType: 'text/markdown', extension: 'md' },
  html: { mediaType: 'text/html', extension: 'html' },
} as const;

class SelectedOutput {
  readonly parts: string[] = [];
  private chars = 0;
  private bytes = 0;
  constructor(readonly limits: SelectedPresentationLimits) {}
  emit(value: string): void {
    this.chars += value.length;
    this.bytes += utf8ByteLength(value);
    if (this.chars > this.limits.maxOutputChars || this.bytes > this.limits.maxOutputBytes)
      presentationFail('presentation-output-limit');
    this.parts.push(value);
  }
  result(): string {
    return this.parts.join('');
  }
}

function selectedDiagnostics(
  rows: readonly PresentationPreviewRow[],
  format: PresentationFormat
): readonly PresentationDiagnostic<string>[] {
  const counts = new Map<string, number>();
  for (const row of rows)
    for (const diagnostic of row.diagnostics[format]) {
      const count = (counts.get(diagnostic.code) ?? 0) + diagnostic.count;
      if (!Number.isSafeInteger(count)) presentationFail('presentation-diagnostics-invalid');
      counts.set(diagnostic.code, count);
    }
  return Object.freeze(
    [...counts]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([code, count]) => Object.freeze({ code, count }))
  );
}
function diagnosticLabel(code: string): string {
  return (
    HTML_DIAGNOSTIC_LABELS[code as keyof typeof HTML_DIAGNOSTIC_LABELS] ??
    TEXT_DIAGNOSTIC_LABELS[code as keyof typeof TEXT_DIAGNOSTIC_LABELS]
  );
}

function renderMarkdown(
  preview: ArchivePresentationPreview,
  selection: TextPresentationSelection,
  rows: readonly PresentationPreviewRow[],
  diagnostics: readonly PresentationDiagnostic<string>[],
  output: SelectedOutput
): string {
  output.emit('# LISKA selected reading view\n\n');
  // Fenced metadata remains literal even with leading whitespace, CR/LF, or fence-shaped IDs.
  output.emit(
    markdownFence(
      `Title: ${preview.title === null ? '[Title absent]' : preview.title}\nCanonical SHA-256: ${preview.sourceCanonicalSha256}\nBranch target node ID: ${preview.branchTargetNodeId}`
    ) + '\n\n'
  );
  output.emit(
    `Renderer: ${PRESENTATION_RENDERER_VERSIONS.markdown}\n\nProfile: ${preview.profile.schema}; include tool content: ${preview.profile.includeToolContent}; inert tagged code blocks: ${preview.profile.inertTaggedCodeBlocks}.\n\n`
  );
  output.emit(
    `Selected messages: ${rows.length} of ${preview.rows.length}. This is an explicit excerpt, not a complete branch or archive authority.\n\n`
  );
  rows.forEach((row, index) => {
    output.emit(
      `---\n\n## Selected message ${index + 1}: ${row.role === 'user' ? 'User' : 'Assistant'}\n\n`
    );
    output.emit(markdownFence(`Message node ID: ${selection.messageNodeIds[index]}`) + '\n\n');
    output.emit(row.markdownBody + '\n\n');
  });
  output.emit('---\n\n## Presentation diagnostics\n\n');
  if (diagnostics.length === 0) output.emit('No presentation omissions were detected.\n');
  for (const item of diagnostics)
    output.emit(`- ${diagnosticLabel(item.code)} Count: ${item.count}.\n`);
  const source = output.result();
  if (!preview.profile.inertTaggedCodeBlocks) return source;
  let finalized: string;
  try {
    // One final transform over the complete selected document, never one fresh budget per row.
    finalized = makeTaggedCodeBlocksInert(source, { maxOutputBytes: output.limits.maxOutputBytes });
  } catch {
    presentationFail('presentation-markdown-finalization-failed');
  }
  const checked = new SelectedOutput(output.limits);
  checked.emit(finalized);
  return checked.result();
}

function renderHtml(
  preview: ArchivePresentationPreview,
  rows: readonly PresentationPreviewRow[],
  diagnostics: readonly PresentationDiagnostic<string>[],
  output: SelectedOutput
): string {
  output.emit('<!doctype html><html lang="und"><head><meta charset="utf-8">');
  output.emit(
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(SELECTED_HTML_CSP)}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>`
  );
  output.emit(escapeHtml(preview.title ?? 'Untitled archived conversation'));
  output.emit(`</title><style>${SELECTED_HTML_STYLE}</style></head><body><header><h1>`);
  output.emit(escapeHtml(preview.title ?? 'Untitled archived conversation'));
  output.emit(
    '</h1><p>This is an explicit selected reading excerpt, not a complete branch or archive authority.</p><small>Renderer: ' +
      PRESENTATION_RENDERER_VERSIONS.html +
      '</small><small>Canonical SHA-256: ' +
      preview.sourceCanonicalSha256 +
      '</small><small>Branch target node ID: '
  );
  output.emit(escapeHtml(preview.branchTargetNodeId));
  output.emit(
    `</small><small>Profile: ${preview.profile.schema}; include tool content: ${preview.profile.includeToolContent}; inert tagged code blocks: ${preview.profile.inertTaggedCodeBlocks}</small><small>Selected messages: ${rows.length} of ${preview.rows.length}</small></header><main>`
  );
  rows.forEach((row, index) => {
    output.emit(
      `<article><h2>Selected message ${index + 1}: ${row.role === 'user' ? 'User' : 'Assistant'}</h2><p class="text">Message node ID: `
    );
    output.emit(escapeHtml(row.nodeId));
    output.emit('</p>' + row.htmlBody + '</article>');
  });
  output.emit('</main><section class="diagnostics"><h2>Presentation diagnostics</h2>');
  if (diagnostics.length === 0) output.emit('<p>No presentation omissions were detected.</p>');
  else {
    output.emit('<ul>');
    for (const item of diagnostics)
      output.emit(`<li>${escapeHtml(diagnosticLabel(item.code))} Count: ${item.count}.</li>`);
    output.emit('</ul>');
  }
  output.emit('</section></body></html>');
  return output.result();
}

/** Same explicit nonempty ordered selection in every format. No canonical or destination access. */
export function renderPresentationSelection(
  preview: ArchivePresentationPreview,
  value: unknown,
  format: PresentationFormat,
  overrides?: Partial<SelectedPresentationLimits>
): SelectedPresentationArtifact {
  return presentationGuard(() => {
    if (format !== 'text' && format !== 'markdown' && format !== 'html')
      presentationFail('presentation-renderer-invalid');
    const limits = presentationLimits(SELECTED_PRESENTATION_LIMITS, overrides);
    const selection = snapshotPresentationSelection(preview, value);
    const rows = resolvePresentationSelection(preview, selection);
    const diagnostics = selectedDiagnostics(rows, format);
    const output = new SelectedOutput(limits);
    let content: string;
    if (format === 'text') {
      // Preserve the exact established selected Text framing/bytes.
      const result = renderTextSelection(presentationPreviewAsTextPreview(preview), selection, {
        maxTextChars: limits.maxOutputChars,
        maxTextBytes: limits.maxOutputBytes,
      });
      output.emit(result.text);
      content = output.result();
    } else if (format === 'markdown')
      content = renderMarkdown(preview, selection, rows, diagnostics, output);
    else content = renderHtml(preview, rows, diagnostics, output);
    return Object.freeze({
      schema: LISKA_SELECTED_PRESENTATION_SCHEMA,
      format,
      rendererVersion: PRESENTATION_RENDERER_VERSIONS[format],
      previewSchema: LISKA_PRESENTATION_PREVIEW_SCHEMA,
      profile: preview.profile,
      content,
      ...FORMAT_INFO[format],
      selection,
      availableMessageCount: preview.rows.length,
      renderedMessageCount: rows.length,
      diagnostics,
    });
  }, 'presentation-input-invalid');
}
export const renderSelectedText = (
  preview: ArchivePresentationPreview,
  selection: unknown,
  limits?: Partial<SelectedPresentationLimits>
): SelectedPresentationArtifact => renderPresentationSelection(preview, selection, 'text', limits);
export const renderSelectedMarkdown = (
  preview: ArchivePresentationPreview,
  selection: unknown,
  limits?: Partial<SelectedPresentationLimits>
): SelectedPresentationArtifact =>
  renderPresentationSelection(preview, selection, 'markdown', limits);
export const renderSelectedHtml = (
  preview: ArchivePresentationPreview,
  selection: unknown,
  limits?: Partial<SelectedPresentationLimits>
): SelectedPresentationArtifact => renderPresentationSelection(preview, selection, 'html', limits);
