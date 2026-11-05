import {
  CHATGPT_CONVERSATION_LIST_MARKER_SOURCE,
  CHATGPT_CONVERSATION_LIST_OBSERVATION_SCHEMA,
  type ChatGptConversationListLimits,
  type ChatGptConversationListObservationResult,
  type ChatGptConversationListObservedRecord,
  type ChatGptConversationListOffset,
  type ChatGptConversationListUnsupportedReason,
} from './contracts';
import {
  arrayData,
  exactKeys,
  fail,
  fields,
  isConversationId,
  natural,
  nonemptyString,
  rejectionReason,
  resolveLimits,
} from './safe-data';

function unsupported(
  reason: ChatGptConversationListUnsupportedReason
): ChatGptConversationListObservationResult {
  return Object.freeze({ kind: 'unsupported', reason });
}

const queryConstants = Object.freeze({
  exclude_conversation_origin: 'tpp',
  expand: 'false',
  hide_snorlax: 'false',
  is_archived: 'false',
  is_starred: 'false',
  limit: '20',
  order: 'updated',
});

function queryVariant(
  value: unknown,
  limits: ChatGptConversationListLimits
): ChatGptConversationListOffset | ChatGptConversationListUnsupportedReason {
  const names = [...Object.keys(queryConstants), 'offset'];
  const { data, keys } = fields(value, [], names, limits);
  if (!exactKeys(keys, names)) return 'unobserved-query';
  for (const key of Object.keys(queryConstants) as (keyof typeof queryConstants)[]) {
    const text = nonemptyString(data[key], limits.maxRequestCodeUnits);
    if (text !== queryConstants[key]) return 'unobserved-query';
  }
  const offset = nonemptyString(data.offset, limits.maxRequestCodeUnits);
  if (offset === '20') return 20;
  if (offset === '40') return 40;
  if (offset === '60') return 60;
  // Offset zero's request was seen, but its response was not inspected.
  return 'unobserved-offset';
}

function requestVariant(
  value: unknown,
  limits: ChatGptConversationListLimits
): ChatGptConversationListOffset | ChatGptConversationListUnsupportedReason {
  const names = ['method', 'pathname', 'query'];
  const { data, keys } = fields(value, names, [], limits);
  if (!exactKeys(keys, names)) fail();
  const method = nonemptyString(data.method, limits.maxRequestCodeUnits);
  const pathname = nonemptyString(data.pathname, limits.maxRequestCodeUnits);
  if (method !== 'GET') return 'unobserved-method';
  if (pathname !== '/backend-api/conversations') return 'unobserved-pathname';
  return queryVariant(data.query, limits);
}

function recordData(
  value: unknown,
  limits: ChatGptConversationListLimits
): ChatGptConversationListObservedRecord {
  const { data } = fields(value, ['id'], ['update_time'], limits);
  const conversationId = nonemptyString(data.id, limits.maxIdentityCodeUnits);
  const token =
    'update_time' in data ? nonemptyString(data.update_time, limits.maxTokenCodeUnits) : undefined;
  return Object.freeze({
    conversationId,
    ...(token === undefined
      ? {}
      : { marker: Object.freeze({ source: CHATGPT_CONVERSATION_LIST_MARKER_SOURCE, token }) }),
  });
}

function pageData(
  body: unknown,
  requestOffset: ChatGptConversationListOffset,
  limits: ChatGptConversationListLimits
): ChatGptConversationListObservationResult {
  const names = ['items', 'limit', 'offset', 'total'];
  const { data, keys } = fields(body, names, [], limits);
  if (!exactKeys(keys, names)) fail();
  const limit = natural(data.limit);
  const offset = natural(data.offset);
  const total = natural(data.total);
  if (total > limits.maxReportedTotal) fail('limit-exceeded');
  if (limit !== 20 || offset !== requestOffset) fail();
  const items = arrayData(data.items, limits);
  if (items.length !== 20) fail();
  const records = items.map(value => recordData(value, limits));
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.conversationId)) fail('duplicate-conversation-id');
    ids.add(record.conversationId);
  }
  if (records.some(record => !isConversationId(record.conversationId)))
    return unsupported('unsupported-conversation-identity');
  records.sort((left, right) =>
    left.conversationId < right.conversationId
      ? -1
      : left.conversationId > right.conversationId
        ? 1
        : 0
  );
  return Object.freeze({
    kind: 'observed_unbound_page',
    schema: CHATGPT_CONVERSATION_LIST_OBSERVATION_SCHEMA,
    scopeBinding: 'unresolved',
    termination: 'unknown',
    request: Object.freeze({ limit: 20, offset: requestOffset }),
    reported: Object.freeze({ limit: 20, offset: requestOffset, total }),
    records: Object.freeze(records),
  });
}

/** Synchronously observe only the three inspected ordinary-list pages, without binding a scope. */
export function observeChatGptUnboundConversationListPage(
  input: unknown,
  limitOverrides?: unknown
): ChatGptConversationListObservationResult {
  try {
    const limits = resolveLimits(limitOverrides);
    const names = ['request', 'response'];
    const { data, keys } = fields(input, names, [], limits);
    if (!exactKeys(keys, names)) fail();
    const variant = requestVariant(data.request, limits);
    const responseNames = ['status', 'body'];
    const response = fields(data.response, responseNames, [], limits);
    if (!exactKeys(response.keys, responseNames)) fail();
    const status = natural(response.data.status);
    if (status < 100 || status > 599) fail();
    if (typeof variant === 'string') return unsupported(variant);
    if (status !== 200) return unsupported('unobserved-status');
    return pageData(response.data.body, variant, limits);
  } catch (error) {
    return Object.freeze({ kind: 'rejected', reason: rejectionReason(error) });
  }
}
