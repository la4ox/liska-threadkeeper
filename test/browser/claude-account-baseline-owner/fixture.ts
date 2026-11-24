import {
  CLAUDE_ACCOUNT_CATALOG_ADMISSION_SCHEMA,
  CLAUDE_MANUAL_VISIBLE_PERSONAL_CONTEXT,
  type ClaudeAccountCatalogAdmissionResult,
} from '../../../src/claude-baseline/account-admission-contracts';
import { CLAUDE_BASELINE_CATALOG_SCHEMA } from '../../../src/claude-baseline/contracts';

export const collectionA = 'claude-account-collection/1:' + 'a'.repeat(32);
export const collectionB = 'claude-account-collection/1:' + 'b'.repeat(32);
export const conversationId = (index: number) =>
  '00000000-0000-4000-8000-' + index.toString(16).padStart(12, '0');

/** Entirely synthetic, closed ADR-081 result; does not supply or infer real provenance. */
export function admitted(
  count = 12,
  marker = 'synthetic-marker'
): Extract<ClaudeAccountCatalogAdmissionResult, { kind: 'admitted' }> {
  return {
    kind: 'admitted',
    schema: CLAUDE_ACCOUNT_CATALOG_ADMISSION_SCHEMA,
    catalog: {
      kind: 'catalog',
      schema: CLAUDE_BASELINE_CATALOG_SCHEMA,
      provider: 'claude',
      scopeKey: 'claude-list-scope/1:' + 'c'.repeat(64),
      scopeEvidence: 'manual-personal-scope',
      coverage: { active: 'terminal-observed', archived: 'unobserved' },
      accountComplete: false,
      targets: Array.from({ length: count }, (_, index) => ({
        conversationId: conversationId(index),
        marker: { source: 'claude-chat-conversations-v2.updated_at/1', token: marker },
      })),
    },
    evidence: {
      provenance: 'caller-projected',
      scopeDerivation: 'provided-header-pair-sha256',
      personalContextAssertion: CLAUDE_MANUAL_VISIBLE_PERSONAL_CONTEXT,
      active: 'offset-0-terminal-projected',
      archived: 'offset-0-terminal-empty-projected',
      accountComplete: false,
      executionAuthorized: false,
    },
  };
}
