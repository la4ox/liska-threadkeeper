import {
  collectorFields,
  collectorProgress,
  matchesCollectorStage,
  PAGE_STOP_CODES,
  type PageStopCode,
} from '../lib/claude-account-collector-contract';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const id = (v: unknown): v is string => typeof v === 'string' && v.length === 36 && uuid.test(v);
function snapshotRow(
  value: unknown
): { uuid: string; is_archived: false; updated_at?: string } | undefined {
  const row =
    collectorFields(value, ['uuid', 'is_archived']) ??
    collectorFields(value, ['uuid', 'is_archived', 'updated_at']);
  if (!row || !id(row.uuid) || row.is_archived !== false) return;
  if (!('updated_at' in row)) return { uuid: row.uuid, is_archived: false };
  const marker = row.updated_at;
  if (typeof marker !== 'string' || !marker.length || marker.length > 256) return;
  return { uuid: row.uuid, is_archived: false, updated_at: marker };
}
function rows(value: unknown) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return;
  const n = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(n) || n < 0 || n > 30 || Reflect.ownKeys(value).length !== n + 1)
    return;
  const result: { uuid: string; is_archived: false; updated_at?: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const item = Object.getOwnPropertyDescriptor(value, String(i));
    if (!item?.enumerable || !('value' in item)) return;
    const row = snapshotRow(item.value);
    if (!row || seen.has(row.uuid)) return;
    seen.add(row.uuid);
    result.push(row);
  }
  return result;
}
/** Snapshot once; never spread or retain the scripting result across an await. */
// eslint-disable-next-line max-lines-per-function -- Two exact wire variants are copied directly into owned data.
export function snapshotCollectorProjection(value: unknown, selectedChatId: string) {
  try {
    const failure = collectorFields(value, [
      'kind',
      'code',
      'dispatch',
      'page',
      'target',
      'marker',
    ]);
    if (failure) {
      const progress = collectorProgress(failure);
      if (
        failure.kind === 'stopped' &&
        PAGE_STOP_CODES.includes(failure.code as PageStopCode) &&
        progress &&
        matchesCollectorStage(failure.code as PageStopCode, progress)
      )
        return { kind: 'stopped' as const, code: failure.code as PageStopCode, progress };
      return;
    }
    const d = collectorFields(value, [
      'kind',
      'routeOrganization',
      'workspace',
      'organization',
      'active',
    ]);
    if (
      !d ||
      d.kind !== 'projected' ||
      !id(d.routeOrganization) ||
      d.organization !== d.routeOrganization ||
      typeof d.workspace !== 'string' ||
      !/^[A-Za-z0-9._~-]{1,128}$/u.test(d.workspace)
    )
      return;
    const active = rows(d.active);
    if (!active?.some(row => row.uuid === selectedChatId)) return;
    return {
      kind: 'projected' as const,
      progress: {
        dispatch: 2,
        page: 2,
        target: active.length,
        marker: active.filter(i => i.updated_at !== undefined).length,
      },
      input: {
        routeOrganization: d.routeOrganization,
        scopeHeaders: {
          'anthropic-organization-id': d.organization,
          'anthropic-workspace-id': d.workspace,
        },
        activePage: { offset: 0, body: { has_more: false, data: active } },
        archivedPage: { offset: 0, body: { has_more: false, data: [] } },
      },
    };
  } catch {
    return;
  }
}
