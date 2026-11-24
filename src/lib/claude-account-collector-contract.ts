/** A closed click-bound request and an aggregate-only public response. */
export const COLLECTOR_SCHEMA = 'liska-claude-account-collector/6' as const;
export const PAGE_STOP_CODES = [
  'navigation-changed',
  'source-verification-unavailable',
  'deadline-exceeded',
  'route-organization-unresolved',
  'route-evidence-changed',
  'selected-chat-not-in-active-list',
  'request-failed',
  'auth-required',
  'rate-limited',
  'unexpected-status',
  'unexpected-redirect',
  'unexpected-media-type',
  'response-too-large',
  'response-schema-invalid',
  'scope-header-missing',
  'scope-header-invalid',
  'scope-route-mismatch',
  'scope-pair-mismatch',
  'active-pagination-unsupported',
  'archived-pagination-unsupported',
  'nonempty-archived-unsupported',
] as const;
export type PageStopCode = (typeof PAGE_STOP_CODES)[number];
export const COLLECTOR_CODES = [
  ...PAGE_STOP_CODES,
  'invalid-message',
  'invalid-sender',
  'permission-unavailable',
  'active-tab-required',
  'claude-route-required',
  'document-unavailable',
  'document-replaced',
  'operation-in-progress',
  'result-invalid',
  'admission-rejected',
  'hash-failed',
  'owner-already-seeded',
  'owner-unavailable',
  'owner-corrupt',
  'owner-unsupported',
  'owner-conflict',
  'owner-aborted',
  'owner-outcome-unknown',
  'owner-preflight-unknown',
  'owner-create-refused',
  'committed-context-changed',
  'committed-verification-deadline',
  'committed-verification-unavailable',
  'saved',
] as const;
export type CollectorCode = (typeof COLLECTOR_CODES)[number];

export interface CollectorProgress {
  dispatch: number;
  page: number;
  target: number;
  marker: number;
}

export function collectorSummary(
  code: CollectorCode,
  progress: CollectorProgress = { dispatch: 0, page: 0, target: 0, marker: 0 }
) {
  const committed =
    code === 'saved' ||
    code === 'committed-context-changed' ||
    code === 'committed-verification-deadline' ||
    code === 'committed-verification-unavailable';
  return {
    schema: COLLECTOR_SCHEMA,
    status: code === 'saved' ? ('saved' as const) : ('stopped' as const),
    code,
    dispatch: progress.dispatch,
    page: progress.page,
    target: progress.target,
    marker: progress.marker,
    activeTerminal: progress.page >= 1,
    archivedTerminalEmpty: progress.page === 2,
    pairMatched: progress.page === 2,
    retention: committed ? ('owner-committed' as const) : ('not-confirmed' as const),
    accountComplete: false as const,
    executionAuthorized: false as const,
    detailRequests: 0 as const,
    downloads: 0 as const,
  };
}
export type CollectorSummary = ReturnType<typeof collectorSummary>;

export function collectorFields(
  value: unknown,
  keys: readonly string[],
  entryAction?: PropertyDescriptor
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) return;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || keys.some(key => !ownKeys.includes(key))) return;
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor =
      key === 'action' && entryAction ? entryAction : Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) return;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}
export function collectorProgress(value: Record<string, unknown>): CollectorProgress | undefined {
  const count = (v: unknown, max: number): v is number =>
    typeof v === 'number' && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= 0 && v <= max;
  const { dispatch, page, target, marker } = value;
  if (
    !count(dispatch, 2) ||
    !count(page, dispatch) ||
    !count(target, page === 0 ? 0 : 30) ||
    !count(marker, target)
  )
    return;
  if (dispatch === 2 && (page === 0 || target === 0)) return;
  return { dispatch, page, target, marker };
}
// Every code declares its exact admissible evidence stages (dispatch/page).
// Record completeness is checked by TypeScript when a new code is added.
type Stage = '0/0' | '1/0' | '1/1' | '2/1' | '2/2';
const zero: readonly Stage[] = ['0/0'],
  transport: readonly Stage[] = ['1/0', '2/1'],
  complete: readonly Stage[] = ['2/2'],
  sequential: readonly Stage[] = ['0/0', '1/0', '1/1', '2/1', '2/2'];
const stages: Record<CollectorCode, readonly Stage[]> = {
  'invalid-message': zero,
  'invalid-sender': zero,
  'permission-unavailable': zero,
  'active-tab-required': zero,
  'claude-route-required': zero,
  'document-unavailable': zero,
  'operation-in-progress': zero,
  'result-invalid': zero,
  'route-organization-unresolved': zero,
  'owner-already-seeded': zero,
  'owner-unavailable': zero,
  'owner-preflight-unknown': zero,
  'owner-corrupt': zero,
  'owner-unsupported': zero,
  'route-evidence-changed': ['1/1', '2/2'],
  'selected-chat-not-in-active-list': ['1/1'],
  'request-failed': transport,
  'auth-required': transport,
  'rate-limited': transport,
  'unexpected-status': transport,
  'unexpected-redirect': transport,
  'unexpected-media-type': transport,
  'response-too-large': transport,
  'response-schema-invalid': transport,
  'scope-header-missing': transport,
  'scope-header-invalid': transport,
  'scope-route-mismatch': transport,
  'scope-pair-mismatch': ['2/1'],
  'active-pagination-unsupported': ['1/0'],
  'archived-pagination-unsupported': ['2/1'],
  'nonempty-archived-unsupported': ['2/1'],
  'admission-rejected': complete,
  'hash-failed': complete,
  'owner-conflict': complete,
  'owner-aborted': complete,
  'owner-outcome-unknown': complete,
  'owner-create-refused': complete,
  saved: complete,
  'committed-context-changed': complete,
  'committed-verification-deadline': complete,
  'committed-verification-unavailable': complete,
  // Page or worker verification can fail at any sequential checkpoint; never invent a page.
  'source-verification-unavailable': sequential,
  'document-replaced': sequential,
  'navigation-changed': sequential,
  'deadline-exceeded': sequential,
};
export function matchesCollectorStage(code: CollectorCode, p: CollectorProgress): boolean {
  return stages[code].includes((String(p.dispatch) + '/' + String(p.page)) as Stage);
}
export function snapshotCollectorSummary(value: unknown): CollectorSummary | undefined {
  try {
    const data = collectorFields(value, Object.keys(collectorSummary('result-invalid')));
    if (!data || !COLLECTOR_CODES.includes(data.code as CollectorCode)) return;
    const progress = collectorProgress(data);
    if (!progress || !matchesCollectorStage(data.code as CollectorCode, progress)) return;
    const canonical = collectorSummary(data.code as CollectorCode, progress);
    if (canonical.retention === 'owner-committed' && progress.page !== 2) return;
    return Object.entries(canonical).every(([key, v]) => data[key] === v) ? canonical : undefined;
  } catch {
    return;
  }
}
export interface CollectorSource {
  readonly tabId: number;
  readonly windowId: number;
  readonly url: string;
}
const clickedRoute =
  /^https:\/\/claude\.ai\/chat\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
export function snapshotCollectorSource(value: unknown): CollectorSource | undefined {
  try {
    const d = collectorFields(value, ['tabId', 'windowId', 'url']);
    const validId = (v: unknown): v is number =>
      typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0);
    if (
      !d ||
      !validId(d.tabId) ||
      !validId(d.windowId) ||
      typeof d.url !== 'string' ||
      d.url.length !== 'https://claude.ai/chat/'.length + 36 ||
      !clickedRoute.test(d.url)
    )
      return;
    return { tabId: d.tabId, windowId: d.windowId, url: d.url };
  } catch {
    return;
  }
}
/** Navigation source lives only in this exact popup-to-worker request, never its response. */
export function snapshotCollectorMessage(
  value: unknown,
  entryAction?: PropertyDescriptor
): { action: 'collectClaudeAccountCatalog'; source: CollectorSource } | undefined {
  try {
    const m = collectorFields(value, ['action', 'source'], entryAction);
    if (m?.action !== 'collectClaudeAccountCatalog') return;
    const source = snapshotCollectorSource(m.source);
    if (source) return { action: 'collectClaudeAccountCatalog', source };
  } catch {
    return;
  }
}
export function isCollectorMessage(value: unknown): boolean {
  return snapshotCollectorMessage(value) !== undefined;
}
