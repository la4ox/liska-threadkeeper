/** An observed target inventory, never a capture manifest or a complete-account claim. */
export const CLAUDE_BASELINE_CATALOG_SCHEMA = 'liska-claude-account-baseline-catalog/1' as const;
export const CLAUDE_PERSONAL_SCOPE_ATTESTATION_SCHEMA =
  'liska-claude-personal-scope-attestation/1' as const;
export const CLAUDE_BASELINE_HARD_LIMITS = Object.freeze({
  maxRecords: 30,
  maxObjectKeys: 64,
  maxKeyCodeUnits: 128,
  maxTokenCodeUnits: 256,
  maxScopeKeyCodeUnits: 256,
  maxIdentityCodeUnits: 128,
});
export type ClaudeBaselineLimits = {
  -readonly [K in keyof typeof CLAUDE_BASELINE_HARD_LIMITS]: number;
};

export interface ClaudeBaselineTarget {
  readonly conversationId: string;
  readonly marker?: {
    readonly source: 'claude-chat-conversations-v2.updated_at/1';
    readonly token: string;
  };
}

/**
 * Exact structural ADR053 ClaudeListObservedPage contract. Kept import-independent
 * to preserve that module's unwired boundary; compatibility is checked in tests.
 * Structural validation cannot authenticate that a page came from its parser.
 */
export interface ClaudeBaselineObservation {
  readonly kind: 'observed_page';
  readonly schema: 'claude-list-page-observation/1';
  readonly scopeKey: string;
  readonly records: readonly ClaudeBaselineTarget[];
}

/** Caller-supplied manual evidence, not cryptographic authentication or account discovery. */
export interface ClaudePersonalScopeAttestation {
  readonly schema: typeof CLAUDE_PERSONAL_SCOPE_ATTESTATION_SCHEMA;
  readonly evidence: 'manual-personal-scope';
  readonly scopeKey?: string;
  readonly organizationBinding: 'resolved' | 'unresolved';
  readonly workspaceBinding: 'resolved' | 'unresolved';
}

export interface ClaudeBaselineCatalog {
  readonly kind: 'catalog';
  readonly schema: typeof CLAUDE_BASELINE_CATALOG_SCHEMA;
  readonly provider: 'claude';
  readonly scopeKey: string;
  readonly scopeEvidence: 'manual-personal-scope';
  readonly coverage: {
    readonly active: 'terminal-observed';
    readonly archived: 'unobserved';
  };
  readonly accountComplete: false;
  readonly targets: readonly ClaudeBaselineTarget[];
}

export const CLAUDE_BASELINE_REJECTION_REASONS = Object.freeze([
  'invalid-input',
  'invalid-limits',
  'limit-exceeded',
  'duplicate-conversation-id',
] as const);
export type ClaudeBaselineRejectionReason = (typeof CLAUDE_BASELINE_REJECTION_REASONS)[number];
export type ClaudeBaselineUnsupportedReason =
  | 'unsupported-observation'
  | 'unsupported-attestation'
  | 'unresolved-scope'
  | 'unsupported-scope-key'
  | 'scope-mismatch'
  | 'unsupported-conversation-identity'
  | 'unsupported-marker-source';
export type ClaudeBaselineCatalogResult =
  | ClaudeBaselineCatalog
  | { readonly kind: 'rejected'; readonly reason: ClaudeBaselineRejectionReason }
  | { readonly kind: 'unsupported'; readonly reason: ClaudeBaselineUnsupportedReason };
