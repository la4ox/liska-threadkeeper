import type {
  ArchivePresentationPreview,
  PresentationPreviewRow,
} from '../archive/presentation/presentation-contracts';
import {
  resolvePresentationSelection,
  snapshotPresentationSelection,
} from '../archive/presentation/preview';
import {
  PDF_ARTIFACT_SCHEMA,
  PDF_MEDIA_TYPE,
  PDF_RECEIPT_SCHEMA,
  PDF_RENDERER_VERSION,
  PDF_REQUEST_SCHEMA,
  PDF_DEPENDENCY_VERSION,
  PDF_LAYOUT_PROFILE,
  PDF_FONT_POLICY,
  PDF_FONT_MANIFEST,
  PdfRenderError,
  pdfFail,
  pdfRecord,
  isPdfOperationToken,
  snapshotPdfReply,
  snapshotPdfRequest,
  resolvePdfLimits,
  type PdfLimits,
  type PdfRenderRequest,
  type PdfWorkerReply,
  type PdfWorkerSuccess,
  type SelectedPdfArtifact,
} from './pdf-contract';

export interface PdfWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: PdfRenderRequest): void;
  terminate(): void;
}
export interface PdfRenderOptions {
  signal?: AbortSignal;
  limits?: Partial<PdfLimits>;
  workerFactory?: () => PdfWorker;
}
const artifacts = new WeakSet<SelectedPdfArtifact>();
export function requireSelectedPdfArtifact(value: SelectedPdfArtifact): void {
  if (!artifacts.has(value) || value.bytes.byteLength !== value.receipt.byteLength)
    pdfFail('pdf-result-invalid');
}
const bundledWorker = (): PdfWorker =>
  new Worker(new URL('./pdf-worker.ts', import.meta.url), {
    type: 'module',
    name: 'liska-selected-pdf',
  }) as unknown as PdfWorker;
export async function pdfSha256(bytes: ArrayBuffer): Promise<string> {
  try {
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    pdfFail('pdf-hash-failed');
  }
}
function sourceDiagnostics(rows: readonly PresentationPreviewRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows)
    for (const diagnostic of row.diagnostics.html)
      counts.set(diagnostic.code, (counts.get(diagnostic.code) ?? 0) + diagnostic.count);
  return Object.freeze(
    [...counts]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([code, count]) => Object.freeze({ code, count }))
  );
}
function preparePdfRender(preview: ArchivePresentationPreview, value: unknown, limits: unknown) {
  const selection = snapshotPresentationSelection(preview, value);
  const rows = resolvePresentationSelection(preview, selection);
  const request = snapshotPdfRequest({
    schema: PDF_REQUEST_SCHEMA,
    operationToken: crypto.randomUUID(),
    title: preview.title,
    rows: rows.map(row => ({ role: row.role, htmlBody: row.htmlBody })),
    limits: resolvePdfLimits(limits),
  });
  const binding = Object.freeze({
    sourceCanonicalSha256: preview.sourceCanonicalSha256,
    branchTargetNodeId: preview.branchTargetNodeId,
    profile: preview.profile,
    presentationRendererVersions: preview.rendererVersions,
    availableMessageCount: preview.rows.length,
    renderedMessageCount: rows.length,
  });
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer;
  return {
    request,
    binding,
    selection,
    selectionBytes: encode({
      selection,
      profile: binding.profile,
      previewSchema: preview.schema,
      presentationRendererVersions: binding.presentationRendererVersions,
    }),
    inputBytes: encode({ schema: request.schema, title: request.title, rows: request.rows }),
    sourceDiagnostics: sourceDiagnostics(rows),
  };
}
type PreparedPdfRender = ReturnType<typeof preparePdfRender>;
async function completePdfRender(
  prepared: PreparedPdfRender,
  result: PdfWorkerSuccess
): Promise<SelectedPdfArtifact> {
  const bytes = result.bytes.slice(0);
  const [sha256, selectionSha256, inputSha256] = await Promise.all([
    pdfSha256(bytes),
    pdfSha256(prepared.selectionBytes),
    pdfSha256(prepared.inputBytes),
  ]);
  const receipt = Object.freeze({
    schema: PDF_RECEIPT_SCHEMA,
    rendererVersion: PDF_RENDERER_VERSION,
    dependencyVersion: PDF_DEPENDENCY_VERSION,
    requestSchema: PDF_REQUEST_SCHEMA,
    layoutProfile: PDF_LAYOUT_PROFILE,
    fontPolicy: PDF_FONT_POLICY,
    fontSha256: PDF_FONT_MANIFEST,
    ...prepared.binding,
    selectionSha256,
    inputSha256,
    pageCount: result.pageCount,
    limits: prepared.request.limits,
    counts: result.counts,
    diagnostics: result.diagnostics,
    sourceDiagnostics: prepared.sourceDiagnostics,
    byteLength: bytes.byteLength,
    sha256,
  });
  return Object.freeze({
    schema: PDF_ARTIFACT_SCHEMA,
    format: 'pdf',
    mediaType: PDF_MEDIA_TYPE,
    extension: 'pdf',
    bytes,
    selection: prepared.selection,
    availableMessageCount: prepared.binding.availableMessageCount,
    renderedMessageCount: prepared.binding.renderedMessageCount,
    receipt,
  });
}
function replyForOperation(value: unknown, request: PdfRenderRequest): PdfWorkerReply | undefined {
  const header = pdfRecord(
    value,
    ['schema', 'operationToken', 'ok', 'bytes', 'pageCount', 'counts', 'diagnostics', 'error'],
    'pdf-result-invalid',
    true
  );
  if (
    isPdfOperationToken(header.operationToken) &&
    header.operationToken !== request.operationToken
  )
    return undefined;
  return snapshotPdfReply(value, request);
}

/** A single cancellable lifetime includes layout, packing and exact-byte hashing. */
class PdfWorkerOperation {
  private worker: PdfWorker | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private settled = false;
  private received = false;
  private resolve!: (artifact: SelectedPdfArtifact) => void;
  private reject!: (error: PdfRenderError) => void;
  constructor(
    private readonly request: PdfRenderRequest,
    private readonly signal: AbortSignal | undefined,
    private readonly factory: () => PdfWorker,
    private readonly complete: (result: PdfWorkerSuccess) => Promise<SelectedPdfArtifact>
  ) {}
  run(): Promise<SelectedPdfArtifact> {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.timer = setTimeout(
        () => this.fail(new PdfRenderError('pdf-deadline')),
        this.request.limits.deadlineMs
      );
      this.signal?.addEventListener('abort', this.abort, { once: true });
      if (this.signal?.aborted) this.abort();
      else this.start();
    });
  }
  private start(): void {
    try {
      this.worker = this.factory();
    } catch {
      this.fail(new PdfRenderError('pdf-worker-unavailable'));
      return;
    }
    if (this.settled) {
      this.terminate();
      return;
    }
    this.worker.onmessage = this.receive;
    this.worker.onerror = () => this.fail(new PdfRenderError('pdf-worker-failed'));
    this.worker.onmessageerror = () => this.fail(new PdfRenderError('pdf-result-invalid'));
    try {
      this.worker.postMessage(this.request);
    } catch {
      this.fail(new PdfRenderError('pdf-worker-failed'));
    }
  }
  private terminate(): void {
    if (!this.worker) return;
    this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
    this.worker.terminate();
    this.worker = undefined;
  }
  private cleanup(): void {
    clearTimeout(this.timer);
    this.signal?.removeEventListener('abort', this.abort);
    this.terminate();
  }
  private readonly abort = (): void => this.fail(new PdfRenderError('pdf-cancelled'));
  private readonly fail = (error: unknown): void => {
    if (this.settled) return;
    this.settled = true;
    this.cleanup();
    this.reject(error instanceof PdfRenderError ? error : new PdfRenderError('pdf-result-invalid'));
  };
  private readonly succeed = (artifact: SelectedPdfArtifact): void => {
    if (this.settled) return;
    this.settled = true;
    this.cleanup();
    artifacts.add(artifact);
    this.resolve(artifact);
  };
  private readonly receive = (event: MessageEvent<unknown>): void => {
    if (this.settled || this.received) return;
    try {
      const result = replyForOperation(event.data, this.request);
      if (!result) return;
      this.received = true;
      if (!result.ok) {
        this.fail(new PdfRenderError(result.error));
        return;
      }
      this.terminate();
      void this.complete(result).then(this.succeed, this.fail);
    } catch (error) {
      this.fail(error);
    }
  };
}
/** Snapshot happens synchronously before worker dispatch or any await. */
export function renderSelectedPdf(
  preview: ArchivePresentationPreview,
  value: unknown,
  options: PdfRenderOptions = {}
): Promise<SelectedPdfArtifact> {
  try {
    const signal = options.signal,
      factory = options.workerFactory ?? bundledWorker;
    const prepared = preparePdfRender(preview, value, options.limits);
    return new PdfWorkerOperation(prepared.request, signal, factory, result =>
      completePdfRender(prepared, result)
    ).run();
  } catch (error) {
    return Promise.reject(
      error instanceof PdfRenderError ? error : new PdfRenderError('pdf-selection-invalid')
    );
  }
}
