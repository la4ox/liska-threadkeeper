/** Limits can be lowered by a caller, but never raised above these hard maxima. */
export interface ChatGptOfficialSelectionLimits {
  maxSourceBytes: number;
  maxConversationBytes: number;
  maxConversations: number;
  /** JSON container nesting, including the root array at depth 1. */
  maxDepth: number;
}

export const CHATGPT_OFFICIAL_HARD_LIMITS: Readonly<ChatGptOfficialSelectionLimits> = Object.freeze(
  {
    maxSourceBytes: 2 * 1024 * 1024 * 1024,
    maxConversationBytes: 64 * 1024 * 1024,
    maxConversations: 100_000,
    maxDepth: 512,
  }
);

export interface SelectChatGptOfficialConversationInput {
  chunks: AsyncIterable<Uint8Array>;
  /** Exact provider identity. Titles, array position, and graph shape are not selectors. */
  conversationId: string;
  limits?: Partial<ChatGptOfficialSelectionLimits>;
}

export interface ChatGptOfficialConversationSource {
  shardIndex: number;
  chunks: AsyncIterable<Uint8Array>;
}

export interface ChatGptOfficialMultiSelectionLimits extends ChatGptOfficialSelectionLimits {
  maxSources: number;
}

export const CHATGPT_OFFICIAL_MULTI_HARD_LIMITS: Readonly<ChatGptOfficialMultiSelectionLimits> =
  Object.freeze({ ...CHATGPT_OFFICIAL_HARD_LIMITS, maxSources: 1_000 });

export interface SelectChatGptOfficialConversationSourcesInput {
  sources: ChatGptOfficialConversationSource[];
  conversationId: string;
  limits?: Partial<ChatGptOfficialMultiSelectionLimits>;
}

export interface ChatGptOfficialConversationSelection {
  /** Exact object bytes, in an owned allocation containing no neighboring source bytes. */
  bytes: Uint8Array;
  conversationId: string;
  conversationIndex: number;
  sourceByteLength: number;
  sourcePointer: string;
  byteStart: number;
  byteEndExclusive: number;
  /** Numeric shard identity; omitted for the legacy single-source contract. */
  shardIndex?: number;
  /** Exact empty-object padding records ignored across the validated source set. */
  ignoredEmptyRecordCount?: number;
}

export const CHATGPT_OFFICIAL_SELECTION_ERROR_CODES = [
  'invalid-input',
  'invalid-chunk',
  'source-read-failed',
  'invalid-root',
  'invalid-json',
  'invalid-utf8',
  'bom-not-supported',
  'source-limit',
  'source-count-limit',
  'conversation-limit',
  'conversation-count-limit',
  'depth-limit',
  'malformed-id',
  'duplicate-id',
  'duplicate-key',
  'invalid-mapping',
  'conversation-not-found',
] as const;

export type ChatGptOfficialSelectionErrorCode =
  (typeof CHATGPT_OFFICIAL_SELECTION_ERROR_CODES)[number];

/** No provider text, identifiers, parser messages, or source exceptions enter errors. */
export class ChatGptOfficialSelectionError extends Error {
  readonly code: ChatGptOfficialSelectionErrorCode;

  constructor(code: ChatGptOfficialSelectionErrorCode) {
    super(`ChatGPT official export selection failed (${code}).`);
    this.name = 'ChatGptOfficialSelectionError';
    this.code = code;
  }
}
