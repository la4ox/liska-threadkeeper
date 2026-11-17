/** Content-free result contract for one foreground Claude list diagnostic. */

export const CLAUDE_LIST_PROBE_SCHEMA = 'liska-claude-list-probe/2' as const;
export const CLAUDE_LIST_PROBE_SCOPE_PREFIX = 'liska-claude-list-probe-scope/1:' as const;
export const CLAUDE_LIST_PROBE_MAX_DISPATCHES = 4;
export const CLAUDE_LIST_PROBE_MAX_RECORDS = 120;
export const CLAUDE_LIST_PROBE_MAX_HEADER_NAMES = 8;

export const CLAUDE_LIST_PROBE_OUTCOME_CODES = Object.freeze([
  'ok',
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
  'scope-unresolved',
  'scope-mismatch',
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

export interface ClaudeListProbePage {
  readonly partition: 'active' | 'archived';
  readonly offset: 0 | 30;
  readonly hasMore: boolean;
  readonly terminal: boolean;
}

export interface ClaudeListProbeResult {
  readonly schema: typeof CLAUDE_LIST_PROBE_SCHEMA;
  readonly status: 'complete' | 'stopped';
  readonly code: ClaudeListProbeOutcomeCode;
  readonly verificationPresent: boolean;
  readonly counts: {
    readonly dispatch: number;
    readonly page: number;
    readonly record: number;
    readonly validUuid: number;
    readonly marker: number;
    readonly duplicate: number;
    readonly overlap: number;
    readonly archivedMismatch: number;
  };
  readonly pages: readonly ClaudeListProbePage[];
  readonly pagination: {
    readonly exercised: boolean;
    readonly hypothesis: 'not-exercised' | 'offset-plus-30';
    readonly unfinished: boolean;
  };
  readonly scope: {
    readonly organizationResolved: boolean;
    readonly workspaceResolved: boolean;
    readonly consistent: boolean;
    readonly routeOrganizationMatched: boolean;
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

function snapshotCounts(value: unknown): ClaudeListProbeResult['counts'] | undefined {
  const keys = [
    'dispatch',
    'page',
    'record',
    'validUuid',
    'marker',
    'duplicate',
    'overlap',
    'archivedMismatch',
  ];
  const data = record(value, keys);
  if (!data) return undefined;
  const dispatch = count(data.dispatch, CLAUDE_LIST_PROBE_MAX_DISPATCHES);
  const page = count(data.page, CLAUDE_LIST_PROBE_MAX_DISPATCHES);
  const recordCount = count(data.record, CLAUDE_LIST_PROBE_MAX_RECORDS);
  const validUuid = count(data.validUuid, CLAUDE_LIST_PROBE_MAX_RECORDS);
  const marker = count(data.marker, CLAUDE_LIST_PROBE_MAX_RECORDS);
  const duplicate = count(data.duplicate, CLAUDE_LIST_PROBE_MAX_RECORDS);
  const overlap = count(data.overlap, CLAUDE_LIST_PROBE_MAX_RECORDS);
  const archivedMismatch = count(data.archivedMismatch, CLAUDE_LIST_PROBE_MAX_RECORDS);
  if (
    [dispatch, page, recordCount, validUuid, marker, duplicate, overlap, archivedMismatch].some(
      item => item === undefined
    ) ||
    page! > dispatch! ||
    [validUuid!, marker!, duplicate!, overlap!, archivedMismatch!].some(item => item > recordCount!)
  )
    return undefined;
  return {
    dispatch: dispatch!,
    page: page!,
    record: recordCount!,
    validUuid: validUuid!,
    marker: marker!,
    duplicate: duplicate!,
    overlap: overlap!,
    archivedMismatch: archivedMismatch!,
  };
}

function snapshotPages(value: unknown): ClaudeListProbePage[] | undefined {
  const values = denseArray(value, CLAUDE_LIST_PROBE_MAX_DISPATCHES);
  if (!values) return undefined;
  const output: ClaudeListProbePage[] = [];
  for (const item of values) {
    const page = record(item, ['partition', 'offset', 'hasMore', 'terminal']);
    if (
      !page ||
      (page.partition !== 'active' && page.partition !== 'archived') ||
      (page.offset !== 0 && page.offset !== 30) ||
      typeof page.hasMore !== 'boolean' ||
      page.terminal !== !page.hasMore
    )
      return undefined;
    output.push({
      partition: page.partition,
      offset: page.offset,
      hasMore: page.hasMore,
      terminal: page.terminal,
    });
  }
  return output;
}

function snapshotPagination(value: unknown): ClaudeListProbeResult['pagination'] | undefined {
  const data = record(value, ['exercised', 'hypothesis', 'unfinished']);
  if (
    !data ||
    typeof data.exercised !== 'boolean' ||
    typeof data.unfinished !== 'boolean' ||
    (data.hypothesis !== 'not-exercised' && data.hypothesis !== 'offset-plus-30') ||
    data.exercised !== (data.hypothesis === 'offset-plus-30')
  )
    return undefined;
  return {
    exercised: data.exercised,
    hypothesis: data.hypothesis,
    unfinished: data.unfinished,
  };
}

const headerNamePattern = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const relevantHeaderPattern = /(?:^|-)(?:organization|org|workspace)(?:-|$)/u;
const fingerprintPattern = /^liska-claude-list-probe-scope\/1:[0-9a-f]{64}$/u;

// eslint-disable-next-line complexity, max-lines-per-function -- Exact scope admission keeps every raw-data exclusion visible.
function snapshotScope(value: unknown): ClaudeListProbeResult['scope'] | undefined {
  const data = record(value, [
    'organizationResolved',
    'workspaceResolved',
    'consistent',
    'routeOrganizationMatched',
    'fingerprint',
    'relevantHeaderNames',
  ]);
  if (!data) return undefined;
  for (const key of [
    'organizationResolved',
    'workspaceResolved',
    'consistent',
    'routeOrganizationMatched',
  ])
    if (typeof data[key] !== 'boolean') return undefined;
  if (
    data.fingerprint !== null &&
    (typeof data.fingerprint !== 'string' || !fingerprintPattern.test(data.fingerprint))
  )
    return undefined;
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
  const resolved =
    data.organizationResolved === true &&
    data.workspaceResolved === true &&
    data.consistent === true &&
    data.routeOrganizationMatched === true;
  if (resolved !== (typeof data.fingerprint === 'string')) return undefined;
  return {
    organizationResolved: data.organizationResolved as boolean,
    workspaceResolved: data.workspaceResolved as boolean,
    consistent: data.consistent as boolean,
    routeOrganizationMatched: data.routeOrganizationMatched as boolean,
    fingerprint: data.fingerprint as string | null,
    relevantHeaderNames: headerNames,
  };
}

/** Returns a detached exact result; caller-owned objects never cross the worker boundary. */
// eslint-disable-next-line complexity -- The exact detached result is one closed trust boundary.
function snapshotClaudeListProbeResultUnchecked(value: unknown): ClaudeListProbeResult | undefined {
  const data = record(value, [
    'schema',
    'status',
    'code',
    'verificationPresent',
    'counts',
    'pages',
    'pagination',
    'scope',
  ]);
  if (
    !data ||
    data.schema !== CLAUDE_LIST_PROBE_SCHEMA ||
    (data.status !== 'complete' && data.status !== 'stopped') ||
    typeof data.code !== 'string' ||
    !(CLAUDE_LIST_PROBE_OUTCOME_CODES as readonly string[]).includes(data.code) ||
    typeof data.verificationPresent !== 'boolean'
  )
    return undefined;
  const counts = snapshotCounts(data.counts);
  const pages = snapshotPages(data.pages);
  const pagination = snapshotPagination(data.pagination);
  const scope = snapshotScope(data.scope);
  if (!counts || !pages || !pagination || !scope || counts.page !== pages.length) return undefined;
  if ((data.code === 'ok') !== (data.status === 'complete')) return undefined;
  if (data.status === 'complete' && pagination.unfinished) return undefined;
  if (pages.some(page => page.offset === 30) !== pagination.exercised) return undefined;
  return {
    schema: CLAUDE_LIST_PROBE_SCHEMA,
    status: data.status,
    code: data.code as ClaudeListProbeOutcomeCode,
    verificationPresent: data.verificationPresent,
    counts,
    pages,
    pagination,
    scope,
  };
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
