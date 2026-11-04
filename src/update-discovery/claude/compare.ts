import {
  CLAUDE_LIST_MARKER_SOURCE,
  type ClaudeListLimits,
  type ClaudeListTokenComparison,
} from './contracts';
import {
  fail,
  fields,
  isConversationId,
  isScopeKey,
  nonemptyString,
  resolveLimits,
} from './safe-data';

function tokenData(value: unknown, limits: ClaudeListLimits) {
  const { data } = fields(value, ['scopeKey', 'conversationId'], ['marker'], limits);
  const scopeKey = nonemptyString(data.scopeKey, limits.maxScopeKeyCodeUnits);
  const conversationId = nonemptyString(data.conversationId, limits.maxIdentityCodeUnits);
  if (!isScopeKey(scopeKey) || !isConversationId(conversationId)) fail();
  if (!('marker' in data)) return { scopeKey, conversationId };
  const marker = fields(data.marker, ['source', 'token'], [], limits).data;
  return {
    scopeKey,
    conversationId,
    marker: {
      source: nonemptyString(marker.source, 128),
      token: nonemptyString(marker.token, limits.maxTokenCodeUnits),
    },
  };
}

function incomparable(
  reason: Extract<ClaudeListTokenComparison, { kind: 'incomparable' }>['reason']
): ClaudeListTokenComparison {
  return Object.freeze({ kind: 'incomparable', reason });
}

/** Exact equality only: opaque token differences carry no ordering or downstream authority. */
export function compareClaudeListTokens(
  left: unknown,
  right: unknown,
  limitOverrides?: unknown
): ClaudeListTokenComparison {
  try {
    const limits = resolveLimits(limitOverrides);
    const a = tokenData(left, limits);
    const b = tokenData(right, limits);
    if (a.scopeKey !== b.scopeKey) return incomparable('scope-mismatch');
    if (a.conversationId !== b.conversationId) return incomparable('conversation-mismatch');
    if (!a.marker || !b.marker) return incomparable('missing-marker');
    if (
      a.marker.source !== CLAUDE_LIST_MARKER_SOURCE ||
      b.marker.source !== CLAUDE_LIST_MARKER_SOURCE
    )
      return incomparable('source-mismatch');
    return Object.freeze({
      kind: a.marker.token === b.marker.token ? 'same_token' : 'different_token',
    });
  } catch {
    return incomparable('invalid-input');
  }
}
