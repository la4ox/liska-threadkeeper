import {
  CLAUDE_BASELINE_CATALOG_SCHEMA,
  type ClaudeBaselineCatalogResult,
  type ClaudeBaselineLimits,
  type ClaudeBaselineTarget,
  type ClaudeBaselineUnsupportedReason,
} from './contracts';
import {
  arrayData,
  fail,
  fields,
  isScopeKey,
  nonemptyString,
  rejectionReason,
  resolveLimits,
} from './data';
import { personalScopeReason } from './scope';

const markerSource = 'claude-chat-conversations-v2.updated_at/1' as const;
interface CandidateTarget {
  readonly conversationId: string;
  readonly marker?: { readonly source: string; readonly token: string };
}

function unsupported(reason: ClaudeBaselineUnsupportedReason): ClaudeBaselineCatalogResult {
  return Object.freeze({ kind: 'unsupported', reason });
}

function targetData(value: unknown, limits: ClaudeBaselineLimits): CandidateTarget {
  const data = fields(value, ['conversationId'], ['marker'], limits);
  const conversationId = nonemptyString(data.conversationId, limits.maxIdentityCodeUnits);
  if (!('marker' in data)) return { conversationId };
  const marker = fields(data.marker, ['source', 'token'], [], limits);
  const source = nonemptyString(marker.source, 128);
  const token = nonemptyString(marker.token, limits.maxTokenCodeUnits);
  return { conversationId, marker: { source, token } };
}

function targetsData(
  value: unknown,
  limits: ClaudeBaselineLimits
): readonly ClaudeBaselineTarget[] | ClaudeBaselineUnsupportedReason {
  const targets = arrayData(value, limits).map(record => targetData(record, limits));
  const ids = new Set<string>();
  for (const target of targets) {
    if (ids.has(target.conversationId)) fail('duplicate-conversation-id');
    ids.add(target.conversationId);
  }
  if (
    targets.some(
      target =>
        target.conversationId.length !== 36 ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
          target.conversationId
        )
    )
  )
    return 'unsupported-conversation-identity';
  if (targets.some(target => target.marker && target.marker.source !== markerSource))
    return 'unsupported-marker-source';
  targets.sort((left, right) =>
    left.conversationId < right.conversationId
      ? -1
      : left.conversationId > right.conversationId
        ? 1
        : 0
  );
  return Object.freeze(
    targets.map(target =>
      Object.freeze({
        conversationId: target.conversationId,
        ...(target.marker
          ? { marker: Object.freeze({ source: markerSource, token: target.marker.token }) }
          : {}),
      })
    )
  );
}

/**
 * Pure projection of an already-admitted ADR053 page plus manual personal-scope
 * evidence. Does not authenticate provenance or grant any downstream authority.
 */
export function enumerateClaudeBaselineCatalog(
  observation: unknown,
  personalScopeAttestation: unknown,
  limitOverrides?: unknown
): ClaudeBaselineCatalogResult {
  try {
    const limits = resolveLimits(limitOverrides);
    const data = fields(observation, ['kind', 'schema', 'scopeKey', 'records'], [], limits);
    const kind = nonemptyString(data.kind, 64);
    const schema = nonemptyString(data.schema, 128);
    const scopeKey = nonemptyString(data.scopeKey, limits.maxScopeKeyCodeUnits);
    const targets = targetsData(data.records, limits);
    const scopeReason = personalScopeReason(personalScopeAttestation, scopeKey, limits);
    if (kind !== 'observed_page' || schema !== 'claude-list-page-observation/1')
      return unsupported('unsupported-observation');
    if (!isScopeKey(scopeKey)) return unsupported('unsupported-scope-key');
    if (scopeReason) return unsupported(scopeReason);
    if (typeof targets === 'string') return unsupported(targets);
    return Object.freeze({
      kind: 'catalog',
      schema: CLAUDE_BASELINE_CATALOG_SCHEMA,
      provider: 'claude',
      scopeKey,
      scopeEvidence: 'manual-personal-scope',
      coverage: Object.freeze({ active: 'terminal-observed', archived: 'unobserved' }),
      accountComplete: false,
      targets,
    });
  } catch (error) {
    return Object.freeze({ kind: 'rejected', reason: rejectionReason(error) });
  }
}
