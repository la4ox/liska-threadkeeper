/**
 * Durable, aggregate-only audit projection for the active ChatGPT resolver.
 * Provider IDs, URLs, bodies, header values, and conversation content are not
 * representable in this contract.
 */

import {
  CHATGPT_ACTIVE_RESOLVER_ERROR_CODES,
  CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT,
  CHATGPT_ACTIVE_RESOLVER_OUTCOME_CODES,
  type ChatGptActiveResolverErrorCode,
  type ChatGptActiveResolverOutcomeCode,
  type ChatGptActiveResolverResponse,
} from '../../lib/chatgpt-active-resolver-contract';

export type ChatGptActiveResolverOutcomeCounts = Record<ChatGptActiveResolverOutcomeCode, number>;

export interface ChatGptActiveResolverMetric {
  /** Fixed capability label only; absent for the unchanged metric-only route. */
  acquisitionMode?: 'one-png';
  requestedCount: number;
  dispatchCount: number | null;
  observedCount: number;
  outcomeCounts: ChatGptActiveResolverOutcomeCounts | null;
  failureCode: ChatGptActiveResolverErrorCode | null;
}

/** Content orchestration cap only; every background request remains single-item. */
export const CHATGPT_ACTIVE_IMAGE_BATCH_MAX_COUNT = 4;

export interface ChatGptActiveResolverBatchAudit {
  acquisitionMode: 'image-batch-4';
  attempts: ChatGptActiveResolverMetric[];
  /** Value-free family count; absent on historical ordinary-only audits. */
  libraryJpegAttemptCount?: 0 | 1;
}

/** Mixed runs share the historical four-operation cap with separate Library family counts. */
export interface ChatGptActiveResolverAssetBatchAudit {
  acquisitionMode: 'asset-batch-4';
  attempts: ChatGptActiveResolverMetric[];
  libraryJpegAttemptCount: 0 | 1;
  libraryCsvAttemptCount: 0 | 1;
  /** Absent on historical CSV/JPEG audits; explicit values must remain bounded. */
  libraryTextPlainAttemptCount?: 0 | 1;
  /** Absent on historical audits; spreadsheets are never counted as images. */
  ordinaryXlsxAttemptCount?: 0 | 1;
}

export type ChatGptActiveResolverAudit =
  | ChatGptActiveResolverMetric
  | ChatGptActiveResolverBatchAudit
  | ChatGptActiveResolverAssetBatchAudit;

export function emptyChatGptActiveResolverOutcomeCounts(): ChatGptActiveResolverOutcomeCounts {
  return {
    observed: 0,
    'http-error': 0,
    'fetch-rejected': 0,
    'response-processing-rejected': 0,
    'payload-integrity-rejected': 0,
    'download-url-missing': 0,
    'download-url-binding-rejected': 0,
    'file-not-found': 0,
    'file-expired': 0,
    'provider-retry': 0,
    'success-without-download-url': 0,
    'provider-status-absent': 0,
    'provider-status-non-string': 0,
    'provider-status-other': 0,
    'non-json': 0,
    oversized: 0,
    'timed-out': 0,
    'not-dispatched': 0,
  };
}

export function emptyChatGptActiveResolverMetric(): ChatGptActiveResolverMetric {
  return {
    requestedCount: 0,
    dispatchCount: 0,
    observedCount: 0,
    outcomeCounts: emptyChatGptActiveResolverOutcomeCounts(),
    failureCode: null,
  };
}

function outcomeCounts(
  outcomes: readonly ChatGptActiveResolverOutcomeCode[]
): ChatGptActiveResolverOutcomeCounts {
  const counts = emptyChatGptActiveResolverOutcomeCounts();
  for (const outcome of outcomes) counts[outcome] += 1;
  return counts;
}

export function chatGptActiveResolverFailureMetric(
  requestedCount: number,
  failureCode: ChatGptActiveResolverErrorCode
): ChatGptActiveResolverMetric {
  return {
    requestedCount,
    dispatchCount: null,
    observedCount: 0,
    outcomeCounts: null,
    failureCode,
  };
}

export function chatGptActiveResolverMetricFromResponse(
  response: ChatGptActiveResolverResponse,
  requestedCount: number
): ChatGptActiveResolverMetric {
  if (!response.success) return chatGptActiveResolverFailureMetric(requestedCount, response.code);
  if (response.data.requestedCount !== requestedCount) {
    return chatGptActiveResolverFailureMetric(requestedCount, 'resolver-result-invalid');
  }
  return {
    requestedCount,
    dispatchCount: response.data.dispatchCount,
    observedCount: response.data.observedCount,
    outcomeCounts: outcomeCounts(response.data.outcomes),
    failureCode: null,
  };
}

export function chatGptActiveResolverProbeWarning(metric: ChatGptActiveResolverMetric): string {
  return metric.failureCode === null
    ? `ChatGPT active resolver observed ${metric.observedCount}/${metric.requestedCount}; file-ID binary acquisition remains disabled.`
    : `ChatGPT active resolver diagnostic failed (${metric.failureCode}); file-ID binary acquisition remains disabled.`;
}

function invalidMetric(): never {
  throw new Error('invalid active resolver metric');
}

type DataFields = Record<string, unknown>;
type DataSnapshots = WeakMap<object, DataFields>;

/** Read each caller-owned own descriptor once; never invoke property gets or iterators. */
function snapshotOwnDataFields(value: unknown, snapshots: DataSnapshots): DataFields {
  if (value === null || typeof value !== 'object') invalidMetric();
  const prior = snapshots.get(value);
  if (prior !== undefined) return prior;
  const snapshot: DataFields = Object.create(null);
  snapshots.set(value, snapshot);
  snapshots.set(snapshot, snapshot);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') invalidMetric();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) invalidMetric();
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

/** Only internal snapshots reach this helper. */
function hasExactFields(value: object, fields: readonly string[]): boolean {
  return (
    Reflect.ownKeys(value).length === fields.length &&
    fields.every(field => Object.prototype.hasOwnProperty.call(value, field))
  );
}

function validateMetricBase(metric: ChatGptActiveResolverMetric): void {
  if (metric === null || typeof metric !== 'object') invalidMetric();
  const fields = [
    'requestedCount',
    'dispatchCount',
    'observedCount',
    'outcomeCounts',
    'failureCode',
  ];
  if (Object.prototype.hasOwnProperty.call(metric, 'acquisitionMode'))
    fields.push('acquisitionMode');
  if (!hasExactFields(metric, fields)) invalidMetric();
  if (
    (metric.acquisitionMode !== undefined && metric.acquisitionMode !== 'one-png') ||
    !Number.isSafeInteger(metric.requestedCount) ||
    metric.requestedCount < 0 ||
    metric.requestedCount > CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT ||
    !Number.isSafeInteger(metric.observedCount) ||
    metric.observedCount < 0 ||
    metric.observedCount > metric.requestedCount ||
    (metric.failureCode !== null &&
      !(CHATGPT_ACTIVE_RESOLVER_ERROR_CODES as readonly string[]).includes(metric.failureCode))
  ) {
    invalidMetric();
  }
}

function validateFailureMetric(metric: ChatGptActiveResolverMetric): void {
  if (metric.dispatchCount !== null || metric.observedCount !== 0 || metric.failureCode === null) {
    invalidMetric();
  }
}

function validateOutcomeCountShape(counts: ChatGptActiveResolverOutcomeCounts): void {
  if (
    counts === null ||
    typeof counts !== 'object' ||
    !hasExactFields(counts, CHATGPT_ACTIVE_RESOLVER_OUTCOME_CODES)
  ) {
    invalidMetric();
  }
}

function outcomeCountTotal(counts: ChatGptActiveResolverOutcomeCounts): number {
  let total = 0;
  for (const code of CHATGPT_ACTIVE_RESOLVER_OUTCOME_CODES) {
    const count = counts[code];
    if (!Number.isSafeInteger(count) || count < 0) invalidMetric();
    total += count;
  }
  return total;
}

function validateSuccessMetric(
  metric: ChatGptActiveResolverMetric,
  counts: ChatGptActiveResolverOutcomeCounts
): void {
  if (
    metric.failureCode !== null ||
    !Number.isSafeInteger(metric.dispatchCount) ||
    metric.dispatchCount === null ||
    metric.dispatchCount < 0 ||
    metric.dispatchCount > metric.requestedCount
  ) {
    invalidMetric();
  }
  validateOutcomeCountShape(counts);
  if (
    outcomeCountTotal(counts) !== metric.requestedCount ||
    counts.observed !== metric.observedCount ||
    counts['not-dispatched'] !== metric.requestedCount - metric.dispatchCount
  ) {
    invalidMetric();
  }
}

function histogram(counts: ChatGptActiveResolverOutcomeCounts): string {
  return CHATGPT_ACTIVE_RESOLVER_OUTCOME_CODES.map(code => `${code}:${counts[code]}`).join(',');
}

function validatedMetricSnapshot(
  fields: DataFields,
  snapshots: DataSnapshots
): ChatGptActiveResolverMetric {
  const metric = fields as unknown as ChatGptActiveResolverMetric;
  validateMetricBase(metric);
  if (metric.outcomeCounts === null) validateFailureMetric(metric);
  else {
    const counts = snapshotOwnDataFields(
      metric.outcomeCounts,
      snapshots
    ) as ChatGptActiveResolverOutcomeCounts;
    validateSuccessMetric(metric, counts);
    metric.outcomeCounts = counts;
  }
  return metric;
}

function validatedAttemptSnapshots(
  value: unknown,
  snapshots: DataSnapshots
): ChatGptActiveResolverMetric[] {
  if (!Array.isArray(value)) invalidMetric();
  const entries = snapshotOwnDataFields(value, snapshots);
  const length = entries.length;
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > CHATGPT_ACTIVE_IMAGE_BATCH_MAX_COUNT ||
    !hasExactFields(entries, ['length', ...Array.from({ length }, (_, index) => String(index))])
  )
    invalidMetric();
  const attempts: ChatGptActiveResolverMetric[] = [];
  for (let index = 0; index < length; index += 1) {
    const metric = validatedMetricSnapshot(
      snapshotOwnDataFields(entries[String(index)], snapshots),
      snapshots
    );
    if (
      metric.requestedCount !== 1 ||
      Object.prototype.hasOwnProperty.call(metric, 'acquisitionMode')
    )
      invalidMetric();
    attempts.push(metric);
  }
  return attempts;
}

function validatedBatchSnapshot(
  fields: DataFields,
  snapshots: DataSnapshots
): ChatGptActiveResolverBatchAudit {
  const hasLibraryCount = Object.prototype.hasOwnProperty.call(fields, 'libraryJpegAttemptCount');
  if (
    !hasExactFields(fields, [
      'acquisitionMode',
      'attempts',
      ...(hasLibraryCount ? ['libraryJpegAttemptCount'] : []),
    ]) ||
    fields.acquisitionMode !== 'image-batch-4' ||
    (hasLibraryCount &&
      fields.libraryJpegAttemptCount !== 0 &&
      fields.libraryJpegAttemptCount !== 1)
  )
    invalidMetric();
  return {
    acquisitionMode: 'image-batch-4',
    attempts: validatedAttemptSnapshots(fields.attempts, snapshots),
    ...(hasLibraryCount && { libraryJpegAttemptCount: fields.libraryJpegAttemptCount as 0 | 1 }),
  };
}

function isFamilyAttemptCount(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1;
}

function optionalFamilyAttemptCount(fields: DataFields, key: string): 0 | 1 | undefined {
  if (!Object.prototype.hasOwnProperty.call(fields, key)) return undefined;
  const value = fields[key];
  if (!isFamilyAttemptCount(value)) invalidMetric();
  return value;
}

function validatedAssetBatchSnapshot(
  fields: DataFields,
  snapshots: DataSnapshots
): ChatGptActiveResolverAssetBatchAudit {
  const libraryTextPlainAttemptCount = optionalFamilyAttemptCount(
    fields,
    'libraryTextPlainAttemptCount'
  );
  const ordinaryXlsxAttemptCount = optionalFamilyAttemptCount(fields, 'ordinaryXlsxAttemptCount');
  if (
    !hasExactFields(fields, [
      'acquisitionMode',
      'attempts',
      'libraryJpegAttemptCount',
      'libraryCsvAttemptCount',
      ...(libraryTextPlainAttemptCount !== undefined ? ['libraryTextPlainAttemptCount'] : []),
      ...(ordinaryXlsxAttemptCount !== undefined ? ['ordinaryXlsxAttemptCount'] : []),
    ]) ||
    fields.acquisitionMode !== 'asset-batch-4' ||
    !isFamilyAttemptCount(fields.libraryJpegAttemptCount) ||
    !isFamilyAttemptCount(fields.libraryCsvAttemptCount)
  )
    invalidMetric();
  const attempts = validatedAttemptSnapshots(fields.attempts, snapshots);
  const libraryJpegAttemptCount = fields.libraryJpegAttemptCount as 0 | 1;
  const libraryCsvAttemptCount = fields.libraryCsvAttemptCount as 0 | 1;
  if (
    libraryJpegAttemptCount +
      libraryCsvAttemptCount +
      (libraryTextPlainAttemptCount ?? 0) +
      (ordinaryXlsxAttemptCount ?? 0) >
    attempts.length
  )
    invalidMetric();
  return {
    acquisitionMode: 'asset-batch-4',
    attempts,
    libraryJpegAttemptCount,
    libraryCsvAttemptCount,
    ...(libraryTextPlainAttemptCount !== undefined && { libraryTextPlainAttemptCount }),
    ...(ordinaryXlsxAttemptCount !== undefined && { ordinaryXlsxAttemptCount }),
  };
}

function batchCapability(
  audit: ChatGptActiveResolverBatchAudit | ChatGptActiveResolverAssetBatchAudit
): string {
  if (audit.acquisitionMode !== 'asset-batch-4')
    return 'file-ID binary acquisition is limited to four sequential PNG/JPEG images.';
  if (audit.ordinaryXlsxAttemptCount !== undefined)
    return 'file-ID binary acquisition is limited to four sequential PNG/JPEG/CSV/text/plain/XLSX assets, including at most one Library CSV, one Library text/plain and one ordinary XLSX.';
  if (audit.libraryTextPlainAttemptCount !== undefined)
    return 'file-ID binary acquisition is limited to four sequential PNG/JPEG/CSV/text/plain assets, including at most one Library CSV and one Library text/plain.';
  return 'file-ID binary acquisition is limited to four sequential PNG/JPEG/CSV assets, including at most one Library CSV.';
}

function batchFamilySummary(
  audit: ChatGptActiveResolverBatchAudit | ChatGptActiveResolverAssetBatchAudit
): string {
  const libraryCount = audit.libraryJpegAttemptCount ?? 0;
  if (audit.acquisitionMode === 'image-batch-4')
    return `library-jpeg-attempts=${libraryCount}; ordinary-image-attempts=${audit.attempts.length - libraryCount};`;
  const textCount = audit.libraryTextPlainAttemptCount ?? 0;
  const xlsxCount = audit.ordinaryXlsxAttemptCount ?? 0;
  const textFamily =
    audit.libraryTextPlainAttemptCount !== undefined
      ? `library-text-plain-attempts=${textCount}; `
      : '';
  const xlsxFamily =
    audit.ordinaryXlsxAttemptCount !== undefined ? `ordinary-xlsx-attempts=${xlsxCount}; ` : '';
  return `library-jpeg-attempts=${libraryCount}; library-csv-attempts=${audit.libraryCsvAttemptCount}; ${textFamily}${xlsxFamily}ordinary-image-attempts=${audit.attempts.length - libraryCount - audit.libraryCsvAttemptCount - textCount - xlsxCount};`;
}

function batchAuditWarning(
  audit: ChatGptActiveResolverBatchAudit | ChatGptActiveResolverAssetBatchAudit
): string {
  const counts = emptyChatGptActiveResolverOutcomeCounts();
  const failures = new Map<ChatGptActiveResolverErrorCode, number>();
  let completed = 0;
  let dispatched = 0;
  let observed = 0;
  for (const metric of audit.attempts) {
    if (metric.outcomeCounts === null) {
      const code = metric.failureCode!;
      failures.set(code, (failures.get(code) ?? 0) + 1);
      continue;
    }
    completed += 1;
    dispatched += metric.dispatchCount!;
    observed += metric.observedCount;
    for (const code of CHATGPT_ACTIVE_RESOLVER_OUTCOME_CODES)
      counts[code] += metric.outcomeCounts[code];
  }
  const runFailures = CHATGPT_ACTIVE_RESOLVER_ERROR_CODES.filter(code => failures.has(code))
    .map(code => `${code}:${failures.get(code)}`)
    .join(',');
  return `ChatGPT active resolver batch audit: selected=${audit.attempts.length}/${CHATGPT_ACTIVE_IMAGE_BATCH_MAX_COUNT}; completed=${completed}; dispatched-known=${dispatched}; dispatch-unknown=${audit.attempts.length - completed}; observed=${observed}; ${batchFamilySummary(audit)} outcomes=${histogram(counts)}; run-failures=${runFailures || 'none'}; ${batchCapability(audit)}`;
}

export function chatGptActiveResolverAuditWarning(
  metric: ChatGptActiveResolverAudit | undefined
): string | undefined {
  if (metric === undefined) return undefined;
  const snapshots: DataSnapshots = new WeakMap();
  const fields = snapshotOwnDataFields(metric, snapshots);
  if (fields.acquisitionMode === 'image-batch-4')
    return batchAuditWarning(validatedBatchSnapshot(fields, snapshots));
  if (fields.acquisitionMode === 'asset-batch-4')
    return batchAuditWarning(validatedAssetBatchSnapshot(fields, snapshots));
  const singular = validatedMetricSnapshot(fields, snapshots);
  const acquisition =
    singular.acquisitionMode === 'one-png'
      ? 'file-ID binary acquisition is limited to one PNG.'
      : 'file-ID binary acquisition remains disabled.';
  if (singular.outcomeCounts === null) {
    return `ChatGPT active resolver audit: requested=${singular.requestedCount}; dispatched=unknown; observed=0; outcomes=unavailable; failure=${singular.failureCode}; ${acquisition}`;
  }
  return `ChatGPT active resolver audit: requested=${singular.requestedCount}; dispatched=${singular.dispatchCount}; observed=${singular.observedCount}; outcomes=${histogram(singular.outcomeCounts)}; failure=none; ${acquisition}`;
}
