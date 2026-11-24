import {
  CLAUDE_ACCOUNT_CATALOG_ADMISSION_SCHEMA,
  CLAUDE_MANUAL_VISIBLE_PERSONAL_CONTEXT,
  type ClaudeAccountCatalogAdmissionEvidence,
  type ClaudeAccountCatalogAdmissionResult,
} from './account-admission-contracts';
import {
  CLAUDE_BASELINE_CATALOG_SCHEMA,
  CLAUDE_PERSONAL_SCOPE_ATTESTATION_SCHEMA,
  type ClaudeBaselineCatalog,
  type ClaudeBaselineLimits,
} from './contracts';
import { arrayData, fail, fields, rejectionReason, resolveLimits } from './data';
import { enumerateClaudeBaselineCatalog } from './enumeration';

const catalogKeys = [
  'kind',
  'schema',
  'provider',
  'scopeKey',
  'scopeEvidence',
  'coverage',
  'accountComplete',
  'targets',
] as const;

function snapshotCatalog(value: unknown, limits: ClaudeBaselineLimits): ClaudeBaselineCatalog {
  const catalog = fields(value, catalogKeys, [], limits);
  const coverage = fields(catalog.coverage, ['active', 'archived'], [], limits);
  if (
    catalog.kind !== 'catalog' ||
    catalog.schema !== CLAUDE_BASELINE_CATALOG_SCHEMA ||
    catalog.provider !== 'claude' ||
    catalog.scopeEvidence !== 'manual-personal-scope' ||
    catalog.accountComplete !== false ||
    coverage.active !== 'terminal-observed' ||
    coverage.archived !== 'unobserved'
  )
    fail();
  // Reuse /1 identity, marker and scope validation, but never silently fix noncanonical order.
  const records = arrayData(catalog.targets, limits).map(item => {
    const target = fields(item, ['conversationId'], ['marker'], limits);
    return {
      conversationId: target.conversationId,
      ...('marker' in target ? { marker: target.marker } : {}),
    };
  });
  const output = enumerateClaudeBaselineCatalog(
    {
      kind: 'observed_page',
      schema: 'claude-list-page-observation/1',
      scopeKey: catalog.scopeKey,
      records,
    },
    {
      schema: CLAUDE_PERSONAL_SCOPE_ATTESTATION_SCHEMA,
      evidence: 'manual-personal-scope',
      scopeKey: catalog.scopeKey,
      organizationBinding: 'resolved',
      workspaceBinding: 'resolved',
    },
    limits
  );
  if (output.kind !== 'catalog') fail(output.kind === 'rejected' ? output.reason : undefined);
  if (records.some((item, index) => item.conversationId !== output.targets[index].conversationId))
    fail();
  return output;
}

function snapshotEvidence(
  value: unknown,
  limits: ClaudeBaselineLimits
): ClaudeAccountCatalogAdmissionEvidence {
  const evidence = fields(
    value,
    [
      'provenance',
      'scopeDerivation',
      'personalContextAssertion',
      'active',
      'archived',
      'accountComplete',
      'executionAuthorized',
    ],
    [],
    limits
  );
  if (
    evidence.provenance !== 'caller-projected' ||
    evidence.scopeDerivation !== 'provided-header-pair-sha256' ||
    evidence.personalContextAssertion !== CLAUDE_MANUAL_VISIBLE_PERSONAL_CONTEXT ||
    evidence.active !== 'offset-0-terminal-projected' ||
    evidence.archived !== 'offset-0-terminal-empty-projected' ||
    evidence.accountComplete !== false ||
    evidence.executionAuthorized !== false
  )
    fail();
  return Object.freeze({
    provenance: evidence.provenance,
    scopeDerivation: evidence.scopeDerivation,
    personalContextAssertion: evidence.personalContextAssertion,
    active: evidence.active,
    archived: evidence.archived,
    accountComplete: evidence.accountComplete,
    executionAuthorized: evidence.executionAuthorized,
  });
}

/** Validate and detach only the admitted branch. This cannot re-establish upstream provenance. */
export function snapshotClaudeAccountCatalogAdmission(
  input: unknown,
  limitOverrides?: unknown
): ClaudeAccountCatalogAdmissionResult {
  try {
    const limits = resolveLimits(limitOverrides);
    const data = fields(input, ['kind', 'schema', 'catalog', 'evidence'], [], limits);
    if (data.kind !== 'admitted' || data.schema !== CLAUDE_ACCOUNT_CATALOG_ADMISSION_SCHEMA) fail();
    return Object.freeze({
      kind: 'admitted',
      schema: CLAUDE_ACCOUNT_CATALOG_ADMISSION_SCHEMA,
      catalog: snapshotCatalog(data.catalog, limits),
      evidence: snapshotEvidence(data.evidence, limits),
    });
  } catch (error) {
    return Object.freeze({
      kind: 'rejected',
      schema: CLAUDE_ACCOUNT_CATALOG_ADMISSION_SCHEMA,
      reason: rejectionReason(error),
    });
  }
}
