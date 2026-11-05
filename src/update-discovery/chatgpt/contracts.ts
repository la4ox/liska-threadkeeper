/** Detached ordinary-list evidence only; no account or workspace binding is established. */
export const CHATGPT_CONVERSATION_LIST_OBSERVATION_SCHEMA =
  'chatgpt-conversation-list-page-observation/1' as const;
export const CHATGPT_CONVERSATION_LIST_MARKER_SOURCE =
  'chatgpt-backend-api-conversations.update_time/1' as const;
export const CHATGPT_CONVERSATION_LIST_HARD_LIMITS = Object.freeze({
  maxRecords: 20,
  maxObjectKeys: 64,
  maxKeyCodeUnits: 128,
  maxRequestCodeUnits: 128,
  maxIdentityCodeUnits: 128,
  maxTokenCodeUnits: 256,
  maxReportedTotal: Number.MAX_SAFE_INTEGER,
});
export type ChatGptConversationListLimits = {
  -readonly [K in keyof typeof CHATGPT_CONVERSATION_LIST_HARD_LIMITS]: number;
};

/** Only these detached metadata containers are admitted, with no additional wrapper keys. */
export interface ChatGptConversationListObservationInput {
  readonly request: {
    readonly method: string;
    readonly pathname: string;
    readonly query: {
      readonly exclude_conversation_origin: string;
      readonly expand: string;
      readonly hide_snorlax: string;
      readonly is_archived: string;
      readonly is_starred: string;
      readonly limit: string;
      readonly order: string;
      readonly offset: string;
    };
  };
  readonly response: { readonly status: number; readonly body: unknown };
}

export type ChatGptConversationListOffset = 20 | 40 | 60;
export interface ChatGptConversationListMarker {
  readonly source: typeof CHATGPT_CONVERSATION_LIST_MARKER_SOURCE;
  /** Opaque, unparsed and unordered. */
  readonly token: string;
}
export interface ChatGptConversationListObservedRecord {
  /** Exact lowercase UUID spelling is a chosen conservative policy, not a provider guarantee. */
  readonly conversationId: string;
  readonly marker?: ChatGptConversationListMarker;
}
export interface ChatGptConversationListObservedPage {
  readonly kind: 'observed_unbound_page';
  readonly schema: typeof CHATGPT_CONVERSATION_LIST_OBSERVATION_SCHEMA;
  readonly scopeBinding: 'unresolved';
  readonly termination: 'unknown';
  readonly request: { readonly limit: 20; readonly offset: ChatGptConversationListOffset };
  readonly reported: {
    readonly limit: 20;
    readonly offset: ChatGptConversationListOffset;
    /** An uninterpreted provider-reported integer, not evidence of coverage or continuation. */
    readonly total: number;
  };
  readonly records: readonly ChatGptConversationListObservedRecord[];
}
export const CHATGPT_CONVERSATION_LIST_REJECTION_REASONS = Object.freeze([
  'invalid-input',
  'invalid-limits',
  'limit-exceeded',
  'duplicate-conversation-id',
] as const);
export type ChatGptConversationListRejectionReason =
  (typeof CHATGPT_CONVERSATION_LIST_REJECTION_REASONS)[number];
export type ChatGptConversationListUnsupportedReason =
  | 'unobserved-method'
  | 'unobserved-pathname'
  | 'unobserved-query'
  | 'unobserved-offset'
  | 'unobserved-status'
  | 'unsupported-conversation-identity';
export type ChatGptConversationListObservationResult =
  | ChatGptConversationListObservedPage
  | { readonly kind: 'rejected'; readonly reason: ChatGptConversationListRejectionReason }
  | { readonly kind: 'unsupported'; readonly reason: ChatGptConversationListUnsupportedReason };
