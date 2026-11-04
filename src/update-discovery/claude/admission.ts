import {
  CLAUDE_LIST_MARKER_SOURCE,
  CLAUDE_LIST_OBSERVATION_SCHEMA,
  type ClaudeListLimits,
  type ClaudeListObservationResult,
  type ClaudeListObservedRecord,
  type ClaudeListUnsupportedReason,
} from './contracts';
import {
  arrayData,
  fail,
  fields,
  isConversationId,
  isScopeKey,
  natural,
  nonemptyString,
  rejectionReason,
  resolveLimits,
} from './safe-data';

function unsupported(reason: ClaudeListUnsupportedReason): ClaudeListObservationResult {
  return Object.freeze({ kind: 'unsupported', reason });
}

function requestVariant(
  value: unknown,
  limits: ClaudeListLimits
): ClaudeListUnsupportedReason | null {
  const { data } = fields(value, ['method', 'route', 'query'], [], limits);
  const method = nonemptyString(data.method, 64);
  const route = nonemptyString(data.route, 128);
  const queryNames = ['limit', 'offset', 'archived', 'consistency'];
  const query = fields(data.query, queryNames, [], limits);
  const limit = natural(query.data.limit);
  const offset = natural(query.data.offset);
  if (typeof query.data.archived !== 'boolean') fail();
  const consistency = nonemptyString(query.data.consistency, 64);
  if (method !== 'GET') return 'unobserved-method';
  if (route !== 'chat_conversations_v2') return 'unobserved-route';
  if (
    query.keys.length !== queryNames.length ||
    limit !== 30 ||
    offset !== 0 ||
    query.data.archived !== false ||
    consistency !== 'strong'
  )
    return 'unobserved-query';
  return null;
}

function scopeData(
  value: unknown,
  limits: ClaudeListLimits
): { key: string } | { reason: 'unresolved-scope' | 'unsupported-scope-key' } {
  const { data } = fields(value, ['organizationBinding', 'workspaceBinding'], ['key'], limits);
  for (const key of ['organizationBinding', 'workspaceBinding'])
    if (data[key] !== 'resolved' && data[key] !== 'unresolved') fail();
  const key = 'key' in data ? nonemptyString(data.key, limits.maxScopeKeyCodeUnits) : undefined;
  if (data.organizationBinding !== 'resolved' || data.workspaceBinding !== 'resolved' || !key)
    return { reason: 'unresolved-scope' as const };
  if (!isScopeKey(key)) return { reason: 'unsupported-scope-key' as const };
  return { key };
}

function recordData(value: unknown, limits: ClaudeListLimits): ClaudeListObservedRecord {
  const { data } = fields(value, ['uuid'], ['updated_at'], limits);
  const conversationId = nonemptyString(data.uuid, limits.maxIdentityCodeUnits);
  const token =
    'updated_at' in data ? nonemptyString(data.updated_at, limits.maxTokenCodeUnits) : undefined;
  return Object.freeze({
    conversationId,
    ...(token === undefined
      ? {}
      : { marker: Object.freeze({ source: CLAUDE_LIST_MARKER_SOURCE, token }) }),
  });
}

function pageData(
  body: unknown,
  scopeKey: string,
  limits: ClaudeListLimits
): ClaudeListObservationResult {
  const { data } = fields(body, ['data', 'has_more'], [], limits);
  if (typeof data.has_more !== 'boolean') fail();
  const records = arrayData(data.data, limits).map(value => recordData(value, limits));
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.conversationId)) fail('duplicate-conversation-id');
    ids.add(record.conversationId);
  }
  if (records.some(record => !isConversationId(record.conversationId)))
    return unsupported('unsupported-conversation-identity');
  if (data.has_more) return unsupported('nonterminal-page');
  records.sort((left, right) =>
    left.conversationId < right.conversationId
      ? -1
      : left.conversationId > right.conversationId
        ? 1
        : 0
  );
  return Object.freeze({
    kind: 'observed_page',
    schema: CLAUDE_LIST_OBSERVATION_SCHEMA,
    scopeKey,
    records: Object.freeze(records),
  });
}

/** Admit only the externally scoped, exactly observed terminal request/response variant. */
export function observeClaudeTerminalListPage(
  input: unknown,
  limitOverrides?: unknown
): ClaudeListObservationResult {
  try {
    const limits = resolveLimits(limitOverrides);
    const { data } = fields(input, ['request', 'response', 'scope'], [], limits);
    const variant = requestVariant(data.request, limits);
    const scope = scopeData(data.scope, limits);
    const response = fields(data.response, ['status', 'body'], [], limits).data;
    const status = natural(response.status);
    if (status < 100 || status > 599) fail();
    if (variant) return unsupported(variant);
    if (status !== 200) return unsupported('unobserved-status');
    if ('reason' in scope) return unsupported(scope.reason);
    return pageData(response.body, scope.key, limits);
  } catch (error) {
    return Object.freeze({ kind: 'rejected', reason: rejectionReason(error) });
  }
}
