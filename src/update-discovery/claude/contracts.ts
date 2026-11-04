/** A detached observation only, not a statement about list coverage or record recency. */
export const CLAUDE_LIST_OBSERVATION_SCHEMA = 'claude-list-page-observation/1' as const;
export const CLAUDE_LIST_SCOPE_PREFIX = 'claude-list-scope/1:' as const;
export const CLAUDE_LIST_MARKER_SOURCE = 'claude-chat-conversations-v2.updated_at/1' as const;
export const CLAUDE_LIST_HARD_LIMITS = Object.freeze({
  maxRecords: 30,
  maxObjectKeys: 64,
  maxKeyCodeUnits: 128,
  maxTokenCodeUnits: 256,
  maxScopeKeyCodeUnits: 256,
  maxIdentityCodeUnits: 128,
});
export type ClaudeListLimits = {
  -readonly [K in keyof typeof CLAUDE_LIST_HARD_LIMITS]: number;
};

export interface ClaudeListObservationInput {
  readonly request: {
    readonly method: string;
    /** This literal includes the observed route version; no URL is accepted. */
    readonly route: string;
    readonly query: {
      readonly limit: number;
      readonly offset: number;
      readonly archived: boolean;
      readonly consistency: string;
    };
  };
  readonly response: { readonly status: number; readonly body: unknown };
  readonly scope: {
    /** Produced externally from BOTH bindings; raw identities are not accepted here. */
    readonly key?: string;
    readonly organizationBinding: 'resolved' | 'unresolved';
    readonly workspaceBinding: 'resolved' | 'unresolved';
  };
}

export interface ClaudeListMarker {
  readonly source: typeof CLAUDE_LIST_MARKER_SOURCE;
  readonly token: string;
}
export interface ClaudeListObservedRecord {
  readonly conversationId: string;
  readonly marker?: ClaudeListMarker;
}
export interface ClaudeListObservedPage {
  readonly kind: 'observed_page';
  readonly schema: typeof CLAUDE_LIST_OBSERVATION_SCHEMA;
  readonly scopeKey: string;
  readonly records: readonly ClaudeListObservedRecord[];
}
export const CLAUDE_LIST_REJECTION_REASONS = Object.freeze([
  'invalid-input',
  'invalid-limits',
  'limit-exceeded',
  'duplicate-conversation-id',
] as const);
export type ClaudeListRejectionReason = (typeof CLAUDE_LIST_REJECTION_REASONS)[number];
export type ClaudeListUnsupportedReason =
  | 'unobserved-method'
  | 'unobserved-route'
  | 'unobserved-query'
  | 'unobserved-status'
  | 'unresolved-scope'
  | 'unsupported-scope-key'
  | 'unsupported-conversation-identity'
  | 'nonterminal-page';
export type ClaudeListObservationResult =
  | ClaudeListObservedPage
  | { readonly kind: 'rejected'; readonly reason: ClaudeListRejectionReason }
  | { readonly kind: 'unsupported'; readonly reason: ClaudeListUnsupportedReason };

/** All three qualifiers are required before opaque tokens can be compared. */
export interface ClaudeListTokenObservation extends ClaudeListObservedRecord {
  readonly scopeKey: string;
}
export type ClaudeListTokenComparison =
  | { readonly kind: 'same_token' | 'different_token' }
  | {
      readonly kind: 'incomparable';
      readonly reason:
        | 'invalid-input'
        | 'missing-marker'
        | 'scope-mismatch'
        | 'conversation-mismatch'
        | 'source-mismatch';
    };
