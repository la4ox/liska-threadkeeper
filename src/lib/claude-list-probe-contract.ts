/** Content-free result contract for one foreground Claude list diagnostic. */

export const CLAUDE_LIST_PROBE_SCHEMA = 'liska-claude-list-probe/5' as const;
export const CLAUDE_LIST_PROBE_MAX_DISPATCHES = 4;
const MAX_RECORDS_PER_PAGE = 30;
export const CLAUDE_LIST_PROBE_MAX_RECORDS =
  CLAUDE_LIST_PROBE_MAX_DISPATCHES * MAX_RECORDS_PER_PAGE;
export const CLAUDE_LIST_PROBE_MAX_HEADER_NAMES = 8;
export const CLAUDE_LIST_ROUTE_ORGANIZATION_EVIDENCE = Object.freeze([
  'resource-timing',
  'verification-link',
  'named-storage',
  'multiple-consistent',
  'unresolved',
] as const);
export type ClaudeListRouteOrganizationEvidence =
  (typeof CLAUDE_LIST_ROUTE_ORGANIZATION_EVIDENCE)[number];

export const CLAUDE_LIST_PROBE_OUTCOME_CODES = Object.freeze([
  'route-organization-unresolved',
  'request-failed',
  'auth-required',
  'rate-limited',
  'unexpected-status',
  'unexpected-redirect',
  'unexpected-media-type',
  'response-too-large',
  'response-schema-invalid',
  'deadline-exceeded',
  'navigation-changed',
  'scope-header-missing',
  'scope-header-invalid',
  'scope-route-mismatch',
  'scope-pair-mismatch',
  'scope-crypto-failed',
  'scope-observed',
  'budget-exhausted',
  'pagination-unfinished',
] as const);
export type ClaudeListProbeOutcomeCode = (typeof CLAUDE_LIST_PROBE_OUTCOME_CODES)[number];

export const CLAUDE_LIST_PROBE_FAILURE_CODES = Object.freeze([
  'invalid-sender',
  'invalid-message',
  'permission-unavailable',
  'active-tab-required',
  'claude-route-required',
  'operation-in-progress',
  'document-unavailable',
  'document-replaced',
  'navigation-changed',
  'background-timeout',
  'result-invalid',
] as const);
export type ClaudeListProbeFailureCode = (typeof CLAUDE_LIST_PROBE_FAILURE_CODES)[number];

interface ClaudeListProbeRecordCounts {
  readonly record: number;
  readonly validUuid: number;
  readonly marker: number;
  readonly archivedFlag: number;
  readonly archivedMismatch: number;
}

export interface ClaudeListProbePage {
  readonly partition: 'active' | 'archived';
  readonly offset: 0 | 30;
  readonly hasMore: boolean;
  readonly terminal: boolean;
  /** Same-run diagnostic only, not an identity, authority or anonymization claim. */
  readonly scopeFingerprint: string;
  readonly counts: ClaudeListProbeRecordCounts;
}

export interface ClaudeListProbeResult {
  readonly schema: typeof CLAUDE_LIST_PROBE_SCHEMA;
  readonly status: 'stopped';
  readonly code: ClaudeListProbeOutcomeCode;
  readonly verificationPresent: boolean;
  readonly routeOrganizationEvidence: ClaudeListRouteOrganizationEvidence;
  readonly counts: ClaudeListProbeRecordCounts & {
    readonly dispatch: number;
    readonly page: number;
    readonly duplicate: number;
    readonly overlap: number;
  };
  readonly pages: readonly ClaudeListProbePage[];
  readonly pagination: {
    readonly exercised: boolean;
    readonly hypothesis: 'not-exercised' | 'offset-plus-30';
    readonly unfinished: boolean;
  };
  readonly scope: {
    readonly observed: boolean;
    readonly fingerprint: string | null;
    readonly relevantHeaderNames: readonly string[];
  };
}

export type ClaudeListProbeResponse =
  | { readonly success: true; readonly data: ClaudeListProbeResult }
  | { readonly success: false; readonly code: ClaudeListProbeFailureCode };

function record(
  value: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expectedKeys.length) return undefined;
    const output: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string' || !expectedKeys.includes(key)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return undefined;
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    return undefined;
  }
}

function denseArray(value: unknown, maxLength: number): unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maxLength) return undefined;
  if (Reflect.ownKeys(value).length !== length + 1) return undefined;
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return undefined;
    output.push(descriptor.value);
  }
  return output;
}

function count(value: unknown, maximum: number): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum
    ? (value as number)
    : undefined;
}

const recordCountKeys = [
  'record',
  'validUuid',
  'marker',
  'archivedFlag',
  'archivedMismatch',
] as const;

function snapshotRecordCounts(
  data: Record<string, unknown>,
  maxRecords: number
): ClaudeListProbeRecordCounts | undefined {
  const recordCount = count(data.record, maxRecords);
  if (recordCount === undefined) return undefined;
  const validUuid = count(data.validUuid, recordCount);
  const marker = count(data.marker, recordCount);
  const archivedFlag = count(data.archivedFlag, recordCount);
  if (validUuid === undefined || marker === undefined || archivedFlag === undefined)
    return undefined;
  const archivedMismatch = count(data.archivedMismatch, archivedFlag);
  if (archivedMismatch === undefined) return undefined;
  return { record: recordCount, validUuid, marker, archivedFlag, archivedMismatch };
}

function snapshotCounts(value: unknown): ClaudeListProbeResult['counts'] | undefined {
  const data = record(value, ['dispatch', 'page', 'duplicate', 'overlap', ...recordCountKeys]);
  if (!data) return undefined;
  const dispatch = count(data.dispatch, CLAUDE_LIST_PROBE_MAX_DISPATCHES);
  if (dispatch === undefined) return undefined;
  const page = count(data.page, dispatch);
  const recordCounts = snapshotRecordCounts(data, CLAUDE_LIST_PROBE_MAX_RECORDS);
  if (page === undefined || dispatch > page + 1 || !recordCounts) return undefined;
  const duplicate = count(data.duplicate, recordCounts.validUuid);
  const overlap = count(data.overlap, recordCounts.validUuid);
  if (
    duplicate === undefined ||
    overlap === undefined ||
    duplicate + overlap > recordCounts.validUuid
  )
    return undefined;
  return { dispatch, page, ...recordCounts, duplicate, overlap };
}

interface AdmittedPages {
  readonly pages: ClaudeListProbePage[];
  readonly scheduleExhausted: boolean;
}

const scopeFingerprintPattern = /^claude-probe-scope-run-v1-sha256:[a-f0-9]{64}$/u;

function isScopeFingerprint(value: unknown): value is string {
  return typeof value === 'string' && scopeFingerprintPattern.test(value);
}

function snapshotPages(value: unknown): AdmittedPages | undefined {
  const values = denseArray(value, CLAUDE_LIST_PROBE_MAX_DISPATCHES);
  if (!values) return undefined;
  // Admitted pages form a prefix of this schedule; only admitted offset-zero
  // pages can append the matching continuation, and only in partition order.
  const schedule: Array<Pick<ClaudeListProbePage, 'partition' | 'offset'>> = [
    { partition: 'active', offset: 0 },
    { partition: 'archived', offset: 0 },
  ];
  const output: ClaudeListProbePage[] = [];
  for (const item of values) {
    const page = record(item, [
      'partition',
      'offset',
      'hasMore',
      'terminal',
      'scopeFingerprint',
      'counts',
    ]);
    const expected = schedule[output.length];
    if (
      !page ||
      !expected ||
      page.partition !== expected.partition ||
      page.offset !== expected.offset ||
      typeof page.hasMore !== 'boolean' ||
      page.terminal !== !page.hasMore ||
      !isScopeFingerprint(page.scopeFingerprint)
    )
      return undefined;
    const countData = record(page.counts, recordCountKeys);
    const counts = countData && snapshotRecordCounts(countData, MAX_RECORDS_PER_PAGE);
    if (!counts) return undefined;
    if (expected.offset === 0 && page.hasMore)
      schedule.push({ partition: expected.partition, offset: 30 });
    output.push({
      ...expected,
      hasMore: page.hasMore,
      terminal: page.terminal,
      scopeFingerprint: page.scopeFingerprint,
      counts,
    });
  }
  return { pages: output, scheduleExhausted: output.length === schedule.length };
}

function reconcilesPageEvidence(
  counts: ClaudeListProbeResult['counts'],
  admitted: AdmittedPages
): boolean {
  const { pages, scheduleExhausted } = admitted;
  if (counts.page !== pages.length || (scheduleExhausted && counts.dispatch !== counts.page))
    return false;
  if (!pages.every(page => page.scopeFingerprint === pages[0].scopeFingerprint)) return false;
  if (
    recordCountKeys.some(
      key => counts[key] !== pages.reduce((sum, page) => sum + page.counts[key], 0)
    )
  )
    return false;

  const validByPartition = { active: 0, archived: 0 };
  for (const page of pages) validByPartition[page.partition] += page.counts.validUuid;
  const { active, archived } = validByPartition;
  const { duplicate, overlap } = counts;
  // Each overlap needs one distinct UUID in both partitions. Every nonempty
  // partition needs at least one distinct UUID even if there is no overlap.
  const distinct = active + archived - duplicate;
  const minimumDistinct =
    Math.max(overlap, Number(active > 0)) + Math.max(overlap, Number(archived > 0));
  return overlap <= Math.min(active, archived) && distinct >= minimumDistinct;
}

function snapshotPagination(
  value: unknown,
  pages: readonly ClaudeListProbePage[]
): ClaudeListProbeResult['pagination'] | undefined {
  const exercised = pages.some(page => page.offset === 30);
  const hypothesis = exercised ? 'offset-plus-30' : 'not-exercised';
  const pending = new Set<ClaudeListProbePage['partition']>();
  for (const page of pages) {
    if (page.hasMore) pending.add(page.partition);
    else pending.delete(page.partition);
  }
  // Only admitted pages supply evidence. With no observed continuation this
  // may be false even if the first page for a partition was never read.
  const unfinished = pending.size > 0;
  const data = record(value, ['exercised', 'hypothesis', 'unfinished']);
  if (
    !data ||
    data.exercised !== exercised ||
    data.hypothesis !== hypothesis ||
    data.unfinished !== unfinished
  )
    return undefined;
  return { exercised, hypothesis, unfinished };
}

const headerNamePattern = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const relevantHeaderPattern = /(?:^|-)(?:organization|org|workspace)(?:-|$)/u;
const exactScopeHeaderNames = ['anthropic-organization-id', 'anthropic-workspace-id'] as const;

function hasExactScopeHeaderNames(names: readonly string[]): boolean {
  return exactScopeHeaderNames.every(name => names.includes(name));
}

function snapshotScope(value: unknown): ClaudeListProbeResult['scope'] | undefined {
  const data = record(value, ['observed', 'fingerprint', 'relevantHeaderNames']);
  if (!data || typeof data.observed !== 'boolean') return undefined;
  const { observed, fingerprint } = data;
  if (fingerprint !== null && !isScopeFingerprint(fingerprint)) return undefined;
  if (observed !== (fingerprint !== null)) return undefined;
  const names = denseArray(data.relevantHeaderNames, CLAUDE_LIST_PROBE_MAX_HEADER_NAMES);
  if (!names) return undefined;
  let previous = '';
  const headerNames: string[] = [];
  for (const name of names) {
    if (
      typeof name !== 'string' ||
      !headerNamePattern.test(name) ||
      !relevantHeaderPattern.test(name) ||
      name <= previous
    )
      return undefined;
    headerNames.push(name);
    previous = name;
  }
  return {
    observed,
    fingerprint,
    relevantHeaderNames: headerNames,
  };
}

// eslint-disable-next-line complexity -- Keep the evidence requirements for all producer outcomes in one exhaustive switch.
function outcomeMatchesEvidence(
  result: ClaudeListProbeResult,
  scheduleExhausted: boolean
): boolean {
  const { code, routeOrganizationEvidence, counts, pagination, scope } = result;
  const { dispatch, page } = counts;
  const hasRouteHint = routeOrganizationEvidence !== 'unresolved';
  const hasHeaderNames = scope.relevantHeaderNames.length > 0;
  const hasExactPairNames = hasExactScopeHeaderNames(scope.relevantHeaderNames);
  if (dispatch > 0 ? !hasRouteHint : hasHeaderNames) return false;
  if (scope.observed !== (code === 'scope-observed')) return false;
  if (page > 0 && !hasExactPairNames) return false;

  const unadmittedDispatch = dispatch === page + 1;
  const scheduleRead = scheduleExhausted && dispatch === page;
  switch (code) {
    case 'route-organization-unresolved':
      return dispatch === 0 && !hasRouteHint;
    case 'request-failed':
    case 'auth-required':
    case 'rate-limited':
    case 'unexpected-status':
    case 'unexpected-redirect':
    case 'unexpected-media-type':
      // These stops precede header-name collection on the failed request.
      return unadmittedDispatch && (page > 0 || !hasHeaderNames);
    case 'response-too-large':
    case 'scope-header-invalid':
    case 'scope-route-mismatch':
      return unadmittedDispatch && hasExactPairNames;
    case 'scope-header-missing':
      // Both names can only be retained from an earlier admitted response.
      return unadmittedDispatch && (page > 0 || !hasExactPairNames);
    case 'scope-pair-mismatch':
      return unadmittedDispatch && page > 0;
    case 'scope-crypto-failed':
      // Preflight or the first digest. Later pages reuse the admitted first digest.
      return (
        page === 0 && (dispatch === 0 ? hasRouteHint : unadmittedDispatch && hasExactPairNames)
      );
    case 'scope-observed': {
      const firstFingerprint = result.pages[0]?.scopeFingerprint;
      return scheduleRead && !pagination.unfinished && scope.fingerprint === firstFingerprint;
    }
    case 'pagination-unfinished':
      return scheduleRead && pagination.unfinished && dispatch < CLAUDE_LIST_PROBE_MAX_DISPATCHES;
    case 'budget-exhausted':
      return scheduleRead && pagination.unfinished && dispatch === CLAUDE_LIST_PROBE_MAX_DISPATCHES;
    case 'navigation-changed':
    case 'deadline-exceeded':
    case 'response-schema-invalid':
      // These can stop before dispatch or after headers without admitting a page.
      return true;
  }
}

/** Returns a detached exact result; caller-owned objects never cross the worker boundary. */
function snapshotClaudeListProbeResultUnchecked(value: unknown): ClaudeListProbeResult | undefined {
  const data = record(value, [
    'schema',
    'status',
    'code',
    'verificationPresent',
    'routeOrganizationEvidence',
    'counts',
    'pages',
    'pagination',
    'scope',
  ]);
  if (
    !data ||
    data.schema !== CLAUDE_LIST_PROBE_SCHEMA ||
    data.status !== 'stopped' ||
    typeof data.code !== 'string' ||
    !(CLAUDE_LIST_PROBE_OUTCOME_CODES as readonly string[]).includes(data.code) ||
    typeof data.verificationPresent !== 'boolean' ||
    typeof data.routeOrganizationEvidence !== 'string' ||
    !(CLAUDE_LIST_ROUTE_ORGANIZATION_EVIDENCE as readonly string[]).includes(
      data.routeOrganizationEvidence
    )
  )
    return undefined;
  const counts = snapshotCounts(data.counts);
  const admitted = snapshotPages(data.pages);
  if (!counts || !admitted || !reconcilesPageEvidence(counts, admitted)) return undefined;
  const { pages } = admitted;
  const pagination = snapshotPagination(data.pagination, pages);
  const scope = snapshotScope(data.scope);
  if (!pagination || !scope) return undefined;
  const result: ClaudeListProbeResult = {
    schema: CLAUDE_LIST_PROBE_SCHEMA,
    status: data.status,
    code: data.code as ClaudeListProbeOutcomeCode,
    verificationPresent: data.verificationPresent,
    routeOrganizationEvidence:
      data.routeOrganizationEvidence as ClaudeListRouteOrganizationEvidence,
    counts,
    pages,
    pagination,
    scope,
  };
  return outcomeMatchesEvidence(result, admitted.scheduleExhausted) ? result : undefined;
}

export function snapshotClaudeListProbeResult(value: unknown): ClaudeListProbeResult | undefined {
  try {
    return snapshotClaudeListProbeResultUnchecked(value);
  } catch {
    return undefined;
  }
}

export function isClaudeListProbeResult(value: unknown): value is ClaudeListProbeResult {
  return snapshotClaudeListProbeResult(value) !== undefined;
}

export function createClaudeListProbeFailure(
  code: ClaudeListProbeFailureCode
): ClaudeListProbeResponse {
  return { success: false, code };
}

export function isClaudeListProbeResponse(value: unknown): value is ClaudeListProbeResponse {
  try {
    const success =
      typeof value === 'object' && value !== null
        ? Object.getOwnPropertyDescriptor(value, 'success')?.value
        : undefined;
    if (success === true) {
      const data = record(value, ['success', 'data']);
      return (
        !!data && data.success === true && snapshotClaudeListProbeResult(data.data) !== undefined
      );
    }
    if (success === false) {
      const data = record(value, ['success', 'code']);
      return (
        !!data &&
        data.success === false &&
        typeof data.code === 'string' &&
        (CLAUDE_LIST_PROBE_FAILURE_CODES as readonly string[]).includes(data.code)
      );
    }
    return false;
  } catch {
    return false;
  }
}
