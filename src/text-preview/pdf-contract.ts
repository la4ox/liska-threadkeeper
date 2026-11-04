import type { PresentationProfile } from '../archive/presentation/presentation-contracts';
import type { TextPresentationSelection } from '../archive/presentation/text-contracts';

export const PDF_REQUEST_SCHEMA = 'liska-pdf-request/1' as const;
export const PDF_RESULT_SCHEMA = 'liska-pdf-result/1' as const;
export const PDF_RECEIPT_SCHEMA = 'liska-pdf-render-receipt/1' as const;
export const PDF_ARTIFACT_SCHEMA = 'liska-selected-pdf/1' as const;
export const PDF_RENDERER_VERSION = 'liska-selected-pdf/1' as const;
export const PDF_DEPENDENCY_VERSION = 'pdfmake/0.3.13' as const;
export const PDF_LAYOUT_PROFILE = 'liska-pdf-a4-portrait/1' as const;
export const PDF_FONT_POLICY = 'liska-pdf-roboto-noto-emoji/1' as const;
export const PDF_MEDIA_TYPE = 'application/pdf' as const;
export const PDF_FONT_MANIFEST = Object.freeze({
  'Roboto-Regular.ttf': 'ab9c18a75da1636435afd2398ffce325496644a8f258f918c92c4baf34a68625',
  'Roboto-Medium.ttf': '4cb9d8a346d7d9190ef145daad9a85d58e2592043b199cdb8ed52ff535c64047',
  'Roboto-Italic.ttf': 'b9e7d02d28dd215bd1dbb164d2d75bc1bbccf754a17390efc8678feb78017577',
  'Roboto-MediumItalic.ttf': '1b4daee5311f0bcd8e1b79d44d1d5ba675a72abb6624d2b0ed77fda1c65d77b1',
  'NotoEmoji.ttf': 'de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551',
});
/** Independent input/work/result ceilings. This is not a JavaScript heap limit. */
export const PDF_LIMITS = Object.freeze({
  maxRows: 100,
  maxHtmlChars: 1024 * 1024,
  maxCodePoints: 150_000,
  maxTokens: 50_000,
  maxDepth: 16,
  maxListDepth: 8,
  maxLayoutNodes: 10_000,
  maxBlocks: 5_000,
  maxRuns: 15_000,
  maxPreCodePoints: 20_000,
  maxPreLineCodePoints: 4_000,
  maxAtomicGraphemeCodePoints: 16,
  maxPages: 100,
  maxOutputBytes: 8 * 1024 * 1024,
  deadlineMs: 20_000,
});
export type PdfLimits = { -readonly [K in keyof typeof PDF_LIMITS]: number };
export const PDF_ERROR_CODES = [
  'pdf-input-invalid',
  'pdf-selection-invalid',
  'pdf-limits-invalid',
  'pdf-row-limit',
  'pdf-html-char-limit',
  'pdf-html-invalid',
  'pdf-code-point-limit',
  'pdf-token-limit',
  'pdf-depth-limit',
  'pdf-list-depth-limit',
  'pdf-layout-node-limit',
  'pdf-block-limit',
  'pdf-run-limit',
  'pdf-pre-limit',
  'pdf-pre-line-limit',
  'pdf-font-unsupported',
  'pdf-layout-overflow',
  'pdf-page-limit',
  'pdf-output-limit',
  'pdf-cancelled',
  'pdf-deadline',
  'pdf-worker-unavailable',
  'pdf-worker-failed',
  'pdf-result-invalid',
  'pdf-hash-failed',
  'pdf-pack-failed',
] as const;
export type PdfRenderErrorCode = (typeof PDF_ERROR_CODES)[number];
export class PdfRenderError extends Error {
  constructor(readonly code: PdfRenderErrorCode) {
    super(code);
    this.name = 'PdfRenderError';
  }
}
export function pdfFail(code: PdfRenderErrorCode): never {
  throw new PdfRenderError(code);
}
export function pdfGuard<T>(action: () => T, code: PdfRenderErrorCode): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof PdfRenderError) throw error;
    return pdfFail(code);
  }
}
export function pdfRecord(
  value: unknown,
  keys: readonly string[],
  code: PdfRenderErrorCode,
  partial = false
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    pdfFail(code);
  const found = Reflect.ownKeys(value);
  if (found.length > keys.length) pdfFail(code);
  const result: Record<string, unknown> = {};
  for (const key of found) {
    if (typeof key !== 'string' || !keys.includes(key)) pdfFail(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value'))
      pdfFail(code);
    result[key] = descriptor.value;
  }
  if (!partial && keys.some(key => !Object.prototype.hasOwnProperty.call(result, key)))
    pdfFail(code);
  return result;
}
export function pdfArray(value: unknown, max: number, code: PdfRenderErrorCode): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) pdfFail(code);
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > max ||
    Reflect.ownKeys(value).length !== length + 1
  )
    pdfFail(code);
  const result: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value'))
      pdfFail(code);
    result.push(descriptor.value);
  }
  return result;
}
export function resolvePdfLimits(value?: unknown): Readonly<PdfLimits> {
  return pdfGuard(() => {
    const result: PdfLimits = { ...PDF_LIMITS };
    if (value !== undefined) {
      const fields = pdfRecord(value, Object.keys(PDF_LIMITS), 'pdf-limits-invalid', true);
      for (const key of Object.keys(fields) as (keyof PdfLimits)[]) {
        const n = fields[key];
        if (!Number.isSafeInteger(n) || (n as number) <= 0 || (n as number) > PDF_LIMITS[key])
          pdfFail('pdf-limits-invalid');
        result[key] = n as number;
      }
    }
    return Object.freeze(result);
  }, 'pdf-limits-invalid');
}
export interface PdfRow {
  readonly role: 'user' | 'assistant';
  readonly htmlBody: string;
}
export interface PdfRenderRequest {
  readonly schema: typeof PDF_REQUEST_SCHEMA;
  readonly operationToken: string;
  readonly title: string | null;
  readonly rows: readonly PdfRow[];
  readonly limits: Readonly<PdfLimits>;
}
export interface PdfSemanticCounts {
  readonly messageCount: number;
  readonly htmlChars: number;
  readonly codePoints: number;
  readonly tokens: number;
  readonly maxDepth: number;
  readonly maxListDepth: number;
  readonly layoutNodes: number;
  readonly layoutVisits: number;
  readonly blocks: number;
  readonly runs: number;
  readonly maxPreCodePoints: number;
  readonly maxPreLineCodePoints: number;
  readonly links: number;
  readonly placeholders: number;
  readonly tabs: number;
  readonly emojiClusters: number;
}
export const PDF_DIAGNOSTIC_CODES = [
  'links-literalized',
  'placeholders-preserved',
  'tabs-expanded',
  'monochrome-emoji-fallback',
] as const;
export interface PdfDiagnostic {
  readonly code: (typeof PDF_DIAGNOSTIC_CODES)[number];
  readonly count: number;
}
export interface PdfWorkerSuccess {
  readonly schema: typeof PDF_RESULT_SCHEMA;
  readonly operationToken: string;
  readonly ok: true;
  readonly bytes: ArrayBuffer;
  readonly pageCount: number;
  readonly counts: PdfSemanticCounts;
  readonly diagnostics: readonly PdfDiagnostic[];
}
export interface PdfWorkerFailure {
  readonly schema: typeof PDF_RESULT_SCHEMA;
  readonly operationToken: string;
  readonly ok: false;
  readonly error: PdfRenderErrorCode;
}
export type PdfWorkerReply = PdfWorkerSuccess | PdfWorkerFailure;
export interface PdfRenderReceipt {
  readonly schema: typeof PDF_RECEIPT_SCHEMA;
  readonly rendererVersion: typeof PDF_RENDERER_VERSION;
  readonly dependencyVersion: typeof PDF_DEPENDENCY_VERSION;
  readonly requestSchema: typeof PDF_REQUEST_SCHEMA;
  readonly layoutProfile: typeof PDF_LAYOUT_PROFILE;
  readonly fontPolicy: typeof PDF_FONT_POLICY;
  readonly fontSha256: typeof PDF_FONT_MANIFEST;
  readonly sourceCanonicalSha256: string;
  readonly branchTargetNodeId: string;
  readonly profile: PresentationProfile;
  readonly selectionSha256: string;
  readonly inputSha256: string;
  readonly presentationRendererVersions: Readonly<Record<'text' | 'markdown' | 'html', string>>;
  readonly availableMessageCount: number;
  readonly renderedMessageCount: number;
  readonly pageCount: number;
  readonly limits: Readonly<PdfLimits>;
  readonly counts: PdfSemanticCounts;
  readonly diagnostics: readonly PdfDiagnostic[];
  readonly sourceDiagnostics: readonly Readonly<{ code: string; count: number }>[];
  readonly byteLength: number;
  readonly sha256: string;
}
/** Exact render evidence, deliberately without a saved/delivered claim. */
export interface SelectedPdfArtifact {
  readonly schema: typeof PDF_ARTIFACT_SCHEMA;
  readonly format: 'pdf';
  readonly mediaType: typeof PDF_MEDIA_TYPE;
  readonly extension: 'pdf';
  readonly bytes: ArrayBuffer;
  readonly selection: TextPresentationSelection;
  readonly availableMessageCount: number;
  readonly renderedMessageCount: number;
  readonly receipt: PdfRenderReceipt;
}
export const isPdfOperationToken = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export function snapshotPdfRequest(value: unknown): PdfRenderRequest {
  return pdfGuard(() => {
    const f = pdfRecord(
      value,
      ['schema', 'operationToken', 'title', 'rows', 'limits'],
      'pdf-input-invalid'
    );
    if (
      f.schema !== PDF_REQUEST_SCHEMA ||
      !isPdfOperationToken(f.operationToken) ||
      (f.title !== null && (typeof f.title !== 'string' || f.title.length > 64 * 1024))
    )
      pdfFail('pdf-input-invalid');
    pdfRecord(f.limits, Object.keys(PDF_LIMITS), 'pdf-limits-invalid');
    const limits = resolvePdfLimits(f.limits);
    let chars = 0;
    const rows = pdfArray(f.rows, limits.maxRows, 'pdf-row-limit').map(value => {
      const row = pdfRecord(value, ['role', 'htmlBody'], 'pdf-input-invalid');
      if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.htmlBody !== 'string')
        pdfFail('pdf-input-invalid');
      chars += row.htmlBody.length;
      if (chars > limits.maxHtmlChars) pdfFail('pdf-html-char-limit');
      return Object.freeze({ role: row.role, htmlBody: row.htmlBody });
    });
    if (!rows.length) pdfFail('pdf-selection-invalid');
    return Object.freeze({
      schema: PDF_REQUEST_SCHEMA,
      operationToken: f.operationToken,
      title: f.title as string | null,
      rows: Object.freeze(rows),
      limits,
    });
  }, 'pdf-input-invalid');
}
export function pdfDiagnostics(counts: PdfSemanticCounts): readonly PdfDiagnostic[] {
  const items: PdfDiagnostic[] = [];
  if (counts.links) items.push(Object.freeze({ code: 'links-literalized', count: counts.links }));
  if (counts.placeholders)
    items.push(Object.freeze({ code: 'placeholders-preserved', count: counts.placeholders }));
  if (counts.tabs) items.push(Object.freeze({ code: 'tabs-expanded', count: counts.tabs }));
  if (counts.emojiClusters)
    items.push(Object.freeze({ code: 'monochrome-emoji-fallback', count: counts.emojiClusters }));
  return Object.freeze(items);
}
const PDF_COUNT_FIELDS = [
  'messageCount',
  'htmlChars',
  'codePoints',
  'tokens',
  'maxDepth',
  'maxListDepth',
  'layoutNodes',
  'layoutVisits',
  'blocks',
  'runs',
  'maxPreCodePoints',
  'maxPreLineCodePoints',
  'links',
  'placeholders',
  'tabs',
  'emojiClusters',
] as const;
function snapshotCounts(value: unknown, request: PdfRenderRequest): PdfSemanticCounts {
  const fields = pdfRecord(value, PDF_COUNT_FIELDS, 'pdf-result-invalid');
  if (Object.values(fields).some(v => !Number.isSafeInteger(v) || (v as number) < 0))
    pdfFail('pdf-result-invalid');
  const counts = fields as unknown as PdfSemanticCounts;
  if (
    counts.messageCount !== request.rows.length ||
    counts.htmlChars !== request.rows.reduce((sum, row) => sum + row.htmlBody.length, 0) ||
    counts.blocks < request.rows.length + 2 ||
    counts.runs < request.rows.length + 1 ||
    counts.links > counts.tokens ||
    counts.placeholders > counts.tokens ||
    counts.emojiClusters > counts.codePoints ||
    counts.tabs > counts.codePoints
  )
    pdfFail('pdf-result-invalid');
  const pairs = [
    ['codePoints', 'maxCodePoints'],
    ['tokens', 'maxTokens'],
    ['maxDepth', 'maxDepth'],
    ['maxListDepth', 'maxListDepth'],
    ['layoutNodes', 'maxLayoutNodes'],
    ['layoutVisits', 'maxLayoutNodes'],
    ['blocks', 'maxBlocks'],
    ['runs', 'maxRuns'],
    ['maxPreCodePoints', 'maxPreCodePoints'],
    ['maxPreLineCodePoints', 'maxPreLineCodePoints'],
  ] as const;
  if (pairs.some(([key, limit]) => counts[key] > request.limits[limit]))
    pdfFail('pdf-result-invalid');
  return Object.freeze({ ...counts });
}
export function snapshotPdfReply(value: unknown, request: PdfRenderRequest): PdfWorkerReply {
  return pdfGuard(() => {
    const header = pdfRecord(
      value,
      ['schema', 'operationToken', 'ok', 'bytes', 'pageCount', 'counts', 'diagnostics', 'error'],
      'pdf-result-invalid',
      true
    );
    const f = pdfRecord(
      value,
      header.ok === true
        ? ['schema', 'operationToken', 'ok', 'bytes', 'pageCount', 'counts', 'diagnostics']
        : ['schema', 'operationToken', 'ok', 'error'],
      'pdf-result-invalid'
    );
    if (f.schema !== PDF_RESULT_SCHEMA || f.operationToken !== request.operationToken)
      pdfFail('pdf-result-invalid');
    if (f.ok === false) {
      if (!PDF_ERROR_CODES.includes(f.error as PdfRenderErrorCode)) pdfFail('pdf-result-invalid');
      return Object.freeze({
        schema: PDF_RESULT_SCHEMA,
        operationToken: request.operationToken,
        ok: false,
        error: f.error as PdfRenderErrorCode,
      });
    }
    if (f.ok !== true) pdfFail('pdf-result-invalid');
    const bytes = snapshotBuffer(f.bytes, request.limits.maxOutputBytes);
    const pageCount = snapshotPageCount(f.pageCount, request.limits.maxPages);
    const counts = snapshotCounts(f.counts, request);
    const diagnostics = snapshotDiagnostics(f.diagnostics);
    if (JSON.stringify(diagnostics) !== JSON.stringify(pdfDiagnostics(counts)))
      pdfFail('pdf-result-invalid');
    return Object.freeze({
      schema: PDF_RESULT_SCHEMA,
      operationToken: request.operationToken,
      ok: true,
      bytes,
      pageCount,
      counts,
      diagnostics: Object.freeze(diagnostics),
    });
  }, 'pdf-result-invalid');
}
function snapshotBuffer(value: unknown, maximum: number): ArrayBuffer {
  if (
    !(value instanceof ArrayBuffer) ||
    Object.getPrototypeOf(value) !== ArrayBuffer.prototype ||
    Reflect.ownKeys(value).length ||
    !value.byteLength
  )
    pdfFail('pdf-result-invalid');
  if (value.byteLength > maximum) pdfFail('pdf-output-limit');
  return value;
}
function snapshotPageCount(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) pdfFail('pdf-result-invalid');
  if ((value as number) > maximum) pdfFail('pdf-page-limit');
  return value as number;
}
function snapshotDiagnostics(value: unknown): readonly PdfDiagnostic[] {
  return Object.freeze(
    pdfArray(value, PDF_DIAGNOSTIC_CODES.length, 'pdf-result-invalid').map(v => {
      const d = pdfRecord(v, ['code', 'count'], 'pdf-result-invalid');
      if (
        !PDF_DIAGNOSTIC_CODES.includes(d.code as PdfDiagnostic['code']) ||
        !Number.isSafeInteger(d.count) ||
        (d.count as number) < 1
      )
        pdfFail('pdf-result-invalid');
      return Object.freeze({ code: d.code as PdfDiagnostic['code'], count: d.count as number });
    })
  );
}
