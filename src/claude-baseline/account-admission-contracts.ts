import type { ClaudeBaselineCatalog, ClaudeBaselineRejectionReason } from './contracts';

export const CLAUDE_ACCOUNT_CATALOG_ADMISSION_SCHEMA =
  'liska-claude-account-catalog-admission/1' as const;
export const CLAUDE_MANUAL_VISIBLE_PERSONAL_CONTEXT =
  'manual-same-visible-personal-context' as const;

interface TerminalOffsetZeroPage<Record> {
  readonly offset: 0;
  readonly body: { readonly data: readonly Record[]; readonly has_more: false };
}

/** A closed caller projection intended for one invocation, not proof of provenance or a saved receipt. */
export interface ClaudeAccountCatalogAdmissionInput {
  readonly routeOrganization: string;
  readonly scopeHeaders: {
    readonly 'anthropic-organization-id': string;
    readonly 'anthropic-workspace-id': string;
  };
  readonly manualAttestation: typeof CLAUDE_MANUAL_VISIBLE_PERSONAL_CONTEXT;
  readonly activePage: TerminalOffsetZeroPage<{
    readonly uuid: string;
    readonly is_archived: false;
    readonly updated_at?: string;
  }>;
  readonly archivedPage: TerminalOffsetZeroPage<never>;
}

/** Trusted dependency: SHA-256 over the supplied string's UTF-8 bytes, with no retention. */
export type ClaudeAccountScopeSha256 = (preimage: string) => Uint8Array | Promise<Uint8Array>;

export interface ClaudeAccountCatalogAdmissionEvidence {
  readonly provenance: 'caller-projected';
  readonly scopeDerivation: 'provided-header-pair-sha256';
  readonly personalContextAssertion: typeof CLAUDE_MANUAL_VISIBLE_PERSONAL_CONTEXT;
  readonly active: 'offset-0-terminal-projected';
  readonly archived: 'offset-0-terminal-empty-projected';
  readonly accountComplete: false;
  readonly executionAuthorized: false;
}

export type ClaudeAccountCatalogAdmissionFailure =
  | ClaudeBaselineRejectionReason
  | 'manual-attestation-required'
  | 'scope-mismatch'
  | 'scope-value-in-target'
  | 'active-pagination-unsupported'
  | 'archived-pagination-unsupported'
  | 'nonempty-archived-unsupported'
  | 'hash-failed';

export type ClaudeAccountCatalogAdmissionResult =
  | {
      readonly kind: 'admitted';
      readonly schema: typeof CLAUDE_ACCOUNT_CATALOG_ADMISSION_SCHEMA;
      readonly catalog: ClaudeBaselineCatalog;
      readonly evidence: ClaudeAccountCatalogAdmissionEvidence;
    }
  | {
      readonly kind: 'rejected';
      readonly schema: typeof CLAUDE_ACCOUNT_CATALOG_ADMISSION_SCHEMA;
      readonly reason: ClaudeAccountCatalogAdmissionFailure;
    };
