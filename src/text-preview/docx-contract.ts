import type { PresentationProfile } from '../archive/presentation/presentation-contracts';
import type { TextPresentationSelection } from '../archive/presentation/text-contracts';

export const DOCX_REQUEST_SCHEMA = 'liska-docx-request/1' as const;
export const DOCX_RESULT_SCHEMA = 'liska-docx-result/1' as const;
export const DOCX_RECEIPT_SCHEMA = 'liska-docx-render-receipt/1' as const;
export const DOCX_ARTIFACT_SCHEMA = 'liska-selected-docx/1' as const;
export const DOCX_RENDERER_VERSION = 'liska-selected-docx/1' as const;
export const DOCX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;
/** Independent work ceilings, not allowances that can be traded between dimensions. */
export const DOCX_LIMITS = Object.freeze({
  maxRows: 1_000,
  maxHtmlChars: 1024 * 1024,
  maxTokens: 50_000,
  maxDepth: 64,
  maxListDepth: 8,
  maxBlocks: 10_000,
  maxRuns: 30_000,
  maxNumberingDefinitions: 256,
  maxOutputBytes: 8 * 1024 * 1024,
  deadlineMs: 30_000,
});
export type DocxLimits = { -readonly [K in keyof typeof DOCX_LIMITS]: number };
export const DOCX_ERROR_CODES = [
  'docx-input-invalid',
  'docx-selection-invalid',
  'docx-limits-invalid',
  'docx-row-limit',
  'docx-html-char-limit',
  'docx-html-invalid',
  'docx-token-limit',
  'docx-depth-limit',
  'docx-list-depth-limit',
  'docx-block-limit',
  'docx-run-limit',
  'docx-numbering-limit',
  'docx-output-limit',
  'docx-cancelled',
  'docx-deadline',
  'docx-worker-unavailable',
  'docx-worker-failed',
  'docx-result-invalid',
  'docx-hash-failed',
  'docx-pack-failed',
] as const;
export type DocxRenderErrorCode = (typeof DOCX_ERROR_CODES)[number];
export class DocxRenderError extends Error {
  constructor(readonly code: DocxRenderErrorCode) {
    super(code);
    this.name = 'DocxRenderError';
  }
}
export function docxFail(code: DocxRenderErrorCode): never {
  throw new DocxRenderError(code);
}
export function docxGuard<T>(action: () => T, code: DocxRenderErrorCode): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof DocxRenderError) throw error;
    return docxFail(code);
  }
}
/** Descriptor-only strict records: caller getters never supply trusted fields. */
export function docxRecord(
  value: unknown,
  keys: readonly string[],
  code: DocxRenderErrorCode,
  partial = false
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    docxFail(code);
  const found = Reflect.ownKeys(value);
  if (found.length > keys.length) docxFail(code);
  const result: Record<string, unknown> = {};
  for (const key of found) {
    if (typeof key !== 'string' || !keys.includes(key)) docxFail(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value'))
      docxFail(code);
    result[key] = descriptor.value;
  }
  if (!partial && keys.some(key => !Object.prototype.hasOwnProperty.call(result, key)))
    docxFail(code);
  return result;
}
export function docxArray(value: unknown, max: number, code: DocxRenderErrorCode): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) docxFail(code);
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > max) docxFail(code);
  if (Reflect.ownKeys(value).length !== length + 1) docxFail(code);
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value'))
      docxFail(code);
    result.push(descriptor.value);
  }
  return result;
}
export function resolveDocxLimits(value?: unknown): Readonly<DocxLimits> {
  return docxGuard(() => {
    const result: DocxLimits = { ...DOCX_LIMITS };
    if (value !== undefined) {
      const fields = docxRecord(value, Object.keys(DOCX_LIMITS), 'docx-limits-invalid', true);
      for (const key of Object.keys(fields) as (keyof DocxLimits)[]) {
        const number = fields[key];
        if (
          !Number.isSafeInteger(number) ||
          (number as number) <= 0 ||
          (number as number) > DOCX_LIMITS[key]
        )
          docxFail('docx-limits-invalid');
        result[key] = number as number;
      }
    }
    return Object.freeze(result);
  }, 'docx-limits-invalid');
}
export interface DocxRow {
  readonly role: 'user' | 'assistant';
  readonly htmlBody: string;
}
export interface DocxRenderRequest {
  readonly schema: typeof DOCX_REQUEST_SCHEMA;
  readonly operationToken: string;
  readonly title: string | null;
  readonly rows: readonly DocxRow[];
  readonly limits: Readonly<DocxLimits>;
}
export interface DocxSemanticCounts {
  readonly messageCount: number;
  readonly htmlChars: number;
  readonly tokens: number;
  readonly maxDepth: number;
  readonly maxListDepth: number;
  readonly blocks: number;
  readonly runs: number;
  readonly numberingDefinitions: number;
  readonly links: number;
  readonly placeholders: number;
}
export const DOCX_DIAGNOSTIC_CODES = ['links-literalized', 'placeholders-preserved'] as const;
export interface DocxDiagnostic {
  readonly code: (typeof DOCX_DIAGNOSTIC_CODES)[number];
  readonly count: number;
}
export interface DocxWorkerSuccess {
  readonly schema: typeof DOCX_RESULT_SCHEMA;
  readonly operationToken: string;
  readonly ok: true;
  readonly bytes: ArrayBuffer;
  readonly counts: DocxSemanticCounts;
  readonly diagnostics: readonly DocxDiagnostic[];
}
export interface DocxWorkerFailure {
  readonly schema: typeof DOCX_RESULT_SCHEMA;
  readonly operationToken: string;
  readonly ok: false;
  readonly error: DocxRenderErrorCode;
}
export type DocxWorkerReply = DocxWorkerSuccess | DocxWorkerFailure;
export interface DocxRenderReceipt {
  readonly schema: typeof DOCX_RECEIPT_SCHEMA;
  readonly rendererVersion: typeof DOCX_RENDERER_VERSION;
  readonly requestSchema: typeof DOCX_REQUEST_SCHEMA;
  readonly sourceCanonicalSha256: string;
  readonly branchTargetNodeId: string;
  readonly profile: PresentationProfile;
  readonly selectionSha256: string;
  readonly availableMessageCount: number;
  readonly renderedMessageCount: number;
  readonly counts: DocxSemanticCounts;
  readonly diagnostics: readonly DocxDiagnostic[];
  readonly sourceDiagnostics: readonly Readonly<{ code: string; count: number }>[];
  readonly byteLength: number;
  readonly sha256: string;
}
/** Render evidence only; this type deliberately contains no saved/delivered state. */
export interface SelectedDocxArtifact {
  readonly schema: typeof DOCX_ARTIFACT_SCHEMA;
  readonly format: 'docx';
  readonly mediaType: typeof DOCX_MEDIA_TYPE;
  readonly extension: 'docx';
  readonly bytes: ArrayBuffer;
  readonly selection: TextPresentationSelection;
  readonly availableMessageCount: number;
  readonly renderedMessageCount: number;
  readonly receipt: DocxRenderReceipt;
}
export const isDocxOperationToken = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);

export function snapshotDocxRequest(value: unknown): DocxRenderRequest {
  return docxGuard(() => {
    const fields = docxRecord(
      value,
      ['schema', 'operationToken', 'title', 'rows', 'limits'],
      'docx-input-invalid'
    );
    if (
      fields.schema !== DOCX_REQUEST_SCHEMA ||
      !isDocxOperationToken(fields.operationToken) ||
      (fields.title !== null &&
        (typeof fields.title !== 'string' || fields.title.length > 64 * 1024))
    )
      docxFail('docx-input-invalid');
    docxRecord(fields.limits, Object.keys(DOCX_LIMITS), 'docx-limits-invalid');
    const limits = resolveDocxLimits(fields.limits);
    let chars = 0;
    const rows = docxArray(fields.rows, limits.maxRows, 'docx-row-limit').map(value => {
      const row = docxRecord(value, ['role', 'htmlBody'], 'docx-input-invalid');
      if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.htmlBody !== 'string')
        docxFail('docx-input-invalid');
      chars += row.htmlBody.length;
      if (chars > limits.maxHtmlChars) docxFail('docx-html-char-limit');
      return Object.freeze({ role: row.role, htmlBody: row.htmlBody });
    });
    if (!rows.length) docxFail('docx-selection-invalid');
    return Object.freeze({
      schema: DOCX_REQUEST_SCHEMA,
      operationToken: fields.operationToken,
      title: fields.title as string | null,
      rows: Object.freeze(rows),
      limits,
    });
  }, 'docx-input-invalid');
}

export function snapshotDocxReply(value: unknown, request: DocxRenderRequest): DocxWorkerReply {
  return docxGuard(() => {
    const header = docxRecord(
      value,
      ['schema', 'operationToken', 'ok', 'bytes', 'counts', 'diagnostics', 'error'],
      'docx-result-invalid',
      true
    );
    const fields = docxRecord(
      value,
      header.ok === true
        ? ['schema', 'operationToken', 'ok', 'bytes', 'counts', 'diagnostics']
        : ['schema', 'operationToken', 'ok', 'error'],
      'docx-result-invalid'
    );
    if (fields.schema !== DOCX_RESULT_SCHEMA || fields.operationToken !== request.operationToken)
      docxFail('docx-result-invalid');
    if (fields.ok === false) {
      if (!DOCX_ERROR_CODES.includes(fields.error as DocxRenderErrorCode))
        docxFail('docx-result-invalid');
      return Object.freeze({
        schema: DOCX_RESULT_SCHEMA,
        operationToken: request.operationToken,
        ok: false,
        error: fields.error as DocxRenderErrorCode,
      });
    }
    if (fields.ok !== true) docxFail('docx-result-invalid');
    const bytes = snapshotBuffer(fields.bytes, request.limits.maxOutputBytes);
    const counts = snapshotCounts(fields.counts, request);
    const diagnostics = snapshotDiagnostics(fields.diagnostics);
    const expected = docxDiagnostics(counts);
    if (JSON.stringify(diagnostics) !== JSON.stringify(expected)) docxFail('docx-result-invalid');
    return Object.freeze({
      schema: DOCX_RESULT_SCHEMA,
      operationToken: request.operationToken,
      ok: true,
      bytes,
      counts,
      diagnostics: Object.freeze(diagnostics),
    });
  }, 'docx-result-invalid');
}
function snapshotBuffer(value: unknown, maximum: number): ArrayBuffer {
  if (
    !(value instanceof ArrayBuffer) ||
    Object.getPrototypeOf(value) !== ArrayBuffer.prototype ||
    Reflect.ownKeys(value).length ||
    !value.byteLength
  )
    docxFail('docx-result-invalid');
  if (value.byteLength > maximum) docxFail('docx-output-limit');
  return value;
}
function snapshotDiagnostics(value: unknown): readonly DocxDiagnostic[] {
  return Object.freeze(
    docxArray(value, 2, 'docx-result-invalid').map(value => {
      const item = docxRecord(value, ['code', 'count'], 'docx-result-invalid');
      if (
        !DOCX_DIAGNOSTIC_CODES.includes(item.code as DocxDiagnostic['code']) ||
        !Number.isSafeInteger(item.count) ||
        (item.count as number) <= 0
      )
        docxFail('docx-result-invalid');
      return Object.freeze({
        code: item.code as DocxDiagnostic['code'],
        count: item.count as number,
      });
    })
  );
}
function snapshotCounts(value: unknown, request: DocxRenderRequest): DocxSemanticCounts {
  const fields = docxRecord(
    value,
    [
      'messageCount',
      'htmlChars',
      'tokens',
      'maxDepth',
      'maxListDepth',
      'blocks',
      'runs',
      'numberingDefinitions',
      'links',
      'placeholders',
    ],
    'docx-result-invalid'
  );
  if (Object.values(fields).some(number => !Number.isSafeInteger(number) || (number as number) < 0))
    docxFail('docx-result-invalid');
  const counts = fields as unknown as DocxSemanticCounts;
  if (
    counts.messageCount !== request.rows.length ||
    counts.htmlChars !== request.rows.reduce((sum, row) => sum + row.htmlBody.length, 0) ||
    counts.tokens > request.limits.maxTokens ||
    counts.maxDepth > request.limits.maxDepth ||
    counts.maxListDepth > request.limits.maxListDepth ||
    counts.blocks > request.limits.maxBlocks ||
    counts.blocks < request.rows.length + 2 ||
    counts.runs > request.limits.maxRuns ||
    counts.runs < request.rows.length + 1 ||
    counts.numberingDefinitions > request.limits.maxNumberingDefinitions ||
    counts.links > counts.tokens ||
    counts.placeholders > counts.tokens
  )
    docxFail('docx-result-invalid');
  return Object.freeze({ ...counts });
}
export function docxDiagnostics(counts: DocxSemanticCounts): readonly DocxDiagnostic[] {
  const diagnostics: DocxDiagnostic[] = [];
  if (counts.links)
    diagnostics.push(Object.freeze({ code: 'links-literalized', count: counts.links }));
  if (counts.placeholders)
    diagnostics.push(Object.freeze({ code: 'placeholders-preserved', count: counts.placeholders }));
  return Object.freeze(diagnostics);
}
