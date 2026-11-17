import {
  CLAUDE_PERSONAL_SCOPE_ATTESTATION_SCHEMA,
  type ClaudeBaselineLimits,
  type ClaudeBaselineUnsupportedReason,
} from './contracts';
import { fail, fields, isScopeKey, nonemptyString } from './data';

/** Validate a manual assertion against the exact observed opaque two-binding key. */
export function personalScopeReason(
  value: unknown,
  observedScopeKey: string,
  limits: ClaudeBaselineLimits
): ClaudeBaselineUnsupportedReason | null {
  const data = fields(
    value,
    ['schema', 'evidence', 'organizationBinding', 'workspaceBinding'],
    ['scopeKey'],
    limits
  );
  const schema = nonemptyString(data.schema, 128);
  const evidence = nonemptyString(data.evidence, 64);
  for (const key of ['organizationBinding', 'workspaceBinding'])
    if (data[key] !== 'resolved' && data[key] !== 'unresolved') fail();
  const scopeKey =
    'scopeKey' in data ? nonemptyString(data.scopeKey, limits.maxScopeKeyCodeUnits) : undefined;
  if (schema !== CLAUDE_PERSONAL_SCOPE_ATTESTATION_SCHEMA || evidence !== 'manual-personal-scope')
    return 'unsupported-attestation';
  if (data.organizationBinding !== 'resolved' || data.workspaceBinding !== 'resolved' || !scopeKey)
    return 'unresolved-scope';
  if (!isScopeKey(scopeKey)) return 'unsupported-scope-key';
  return scopeKey === observedScopeKey ? null : 'scope-mismatch';
}
