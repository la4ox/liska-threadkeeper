import type {
  ArchivePresentationPreview,
  PresentationPreviewRow,
} from '../archive/presentation/presentation-contracts';
import {
  resolvePresentationSelection,
  snapshotPresentationSelection,
} from '../archive/presentation/preview';
import {
  DOCX_ARTIFACT_SCHEMA,
  DOCX_MEDIA_TYPE,
  DOCX_RECEIPT_SCHEMA,
  DOCX_RENDERER_VERSION,
  DOCX_REQUEST_SCHEMA,
  DocxRenderError,
  docxFail,
  docxRecord,
  isDocxOperationToken,
  snapshotDocxReply,
  snapshotDocxRequest,
  resolveDocxLimits,
  type DocxLimits,
  type DocxRenderRequest,
  type DocxWorkerReply,
  type DocxWorkerSuccess,
  type SelectedDocxArtifact,
} from './docx-contract';

export interface DocxWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: DocxRenderRequest): void;
  terminate(): void;
}
export interface DocxRenderOptions {
  signal?: AbortSignal;
  limits?: Partial<DocxLimits>;
  workerFactory?: () => DocxWorker;
}
const artifacts = new WeakSet<SelectedDocxArtifact>();
/** Delivery must not accept structural casts of unowned binary artifacts. */
export function requireSelectedDocxArtifact(value: SelectedDocxArtifact): void {
  if (!artifacts.has(value) || value.bytes.byteLength !== value.receipt.byteLength)
    docxFail('docx-result-invalid');
}
const bundledWorker = (): DocxWorker =>
  new Worker(new URL('./docx-worker.ts', import.meta.url), {
    type: 'module',
    name: 'liska-selected-docx',
  }) as unknown as DocxWorker;

export async function docxSha256(bytes: ArrayBuffer): Promise<string> {
  try {
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    docxFail('docx-hash-failed');
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
function prepareDocxRender(preview: ArchivePresentationPreview, value: unknown, limits: unknown) {
  const selection = snapshotPresentationSelection(preview, value);
  const rows = resolvePresentationSelection(preview, selection);
  const request = snapshotDocxRequest({
    schema: DOCX_REQUEST_SCHEMA,
    operationToken: crypto.randomUUID(),
    title: preview.title,
    rows: rows.map(row => ({ role: row.role, htmlBody: row.htmlBody })),
    limits: resolveDocxLimits(limits),
  });
  const binding = Object.freeze({
    sourceCanonicalSha256: preview.sourceCanonicalSha256,
    branchTargetNodeId: preview.branchTargetNodeId,
    profile: preview.profile,
    availableMessageCount: preview.rows.length,
    renderedMessageCount: rows.length,
  });
  const selectionBytes = new TextEncoder().encode(
    JSON.stringify({
      selection,
      profile: binding.profile,
      previewSchema: preview.schema,
    })
  ).buffer;
  return {
    request,
    binding,
    selection,
    selectionBytes,
    sourceDiagnostics: sourceDiagnostics(rows),
  };
}
type PreparedDocxRender = ReturnType<typeof prepareDocxRender>;
async function completeDocxRender(
  prepared: PreparedDocxRender,
  result: DocxWorkerSuccess
): Promise<SelectedDocxArtifact> {
  // Transfer grants exclusive ownership in production. Also copy at the DI seam.
  const bytes = result.bytes.slice(0);
  const [sha256, selectionSha256] = await Promise.all([
    docxSha256(bytes),
    docxSha256(prepared.selectionBytes),
  ]);
  const receipt = Object.freeze({
    schema: DOCX_RECEIPT_SCHEMA,
    rendererVersion: DOCX_RENDERER_VERSION,
    requestSchema: DOCX_REQUEST_SCHEMA,
    ...prepared.binding,
    selectionSha256,
    counts: result.counts,
    diagnostics: result.diagnostics,
    sourceDiagnostics: prepared.sourceDiagnostics,
    byteLength: bytes.byteLength,
    sha256,
  });
  return Object.freeze({
    schema: DOCX_ARTIFACT_SCHEMA,
    format: 'docx',
    mediaType: DOCX_MEDIA_TYPE,
    extension: 'docx',
    bytes,
    selection: prepared.selection,
    availableMessageCount: prepared.binding.availableMessageCount,
    renderedMessageCount: prepared.binding.renderedMessageCount,
    receipt,
  });
}
function replyForOperation(
  value: unknown,
  request: DocxRenderRequest
): DocxWorkerReply | undefined {
  const header = docxRecord(
    value,
    ['schema', 'operationToken', 'ok', 'bytes', 'counts', 'diagnostics', 'error'],
    'docx-result-invalid',
    true
  );
  // A stale operation is never adopted or allowed to finish this operation.
  if (
    isDocxOperationToken(header.operationToken) &&
    header.operationToken !== request.operationToken
  )
    return undefined;
  return snapshotDocxReply(value, request);
}

/** A single lifetime includes packing AND hashing. Every terminal path releases the worker. */
class DocxWorkerOperation {
  private worker: DocxWorker | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private settled = false;
  private received = false;
  private resolve!: (artifact: SelectedDocxArtifact) => void;
  private reject!: (error: DocxRenderError) => void;
  constructor(
    private readonly request: DocxRenderRequest,
    private readonly signal: AbortSignal | undefined,
    private readonly factory: () => DocxWorker,
    private readonly complete: (result: DocxWorkerSuccess) => Promise<SelectedDocxArtifact>
  ) {}
  run(): Promise<SelectedDocxArtifact> {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.timer = setTimeout(
        () => this.fail(new DocxRenderError('docx-deadline')),
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
      this.fail(new DocxRenderError('docx-worker-unavailable'));
      return;
    }
    // A custom factory can synchronously abort while construction is in flight.
    if (this.settled) {
      this.terminate();
      return;
    }
    this.worker.onmessage = this.receive;
    this.worker.onerror = () => this.fail(new DocxRenderError('docx-worker-failed'));
    this.worker.onmessageerror = () => this.fail(new DocxRenderError('docx-result-invalid'));
    try {
      this.worker.postMessage(this.request);
    } catch {
      this.fail(new DocxRenderError('docx-worker-failed'));
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
  private readonly abort = (): void => this.fail(new DocxRenderError('docx-cancelled'));
  private readonly fail = (error: unknown): void => {
    if (this.settled) return;
    this.settled = true;
    this.cleanup();
    this.reject(
      error instanceof DocxRenderError ? error : new DocxRenderError('docx-result-invalid')
    );
  };
  private readonly succeed = (artifact: SelectedDocxArtifact): void => {
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
        this.fail(new DocxRenderError(result.error));
        return;
      }
      this.terminate();
      void this.complete(result).then(this.succeed, this.fail);
    } catch (error) {
      this.fail(error);
    }
  };
}

/** Snapshots selection, rows, title, profile and limits synchronously before the first await. */
export function renderSelectedDocx(
  preview: ArchivePresentationPreview,
  value: unknown,
  options: DocxRenderOptions = {}
): Promise<SelectedDocxArtifact> {
  try {
    const signal = options.signal;
    const factory = options.workerFactory ?? bundledWorker;
    const prepared = prepareDocxRender(preview, value, options.limits);
    return new DocxWorkerOperation(prepared.request, signal, factory, result =>
      completeDocxRender(prepared, result)
    ).run();
  } catch (error) {
    return Promise.reject(
      error instanceof DocxRenderError ? error : new DocxRenderError('docx-selection-invalid')
    );
  }
}
