import type { ArchiveBlock, ArchiveDiagnosticSeverity, AssetAcquisitionState } from '../../types';

export const CHATGPT_COMPARISON_SCHEMA = 'liska-chatgpt-comparison/1' as const;
export const CHATGPT_COMPARISON_VERSION = 'chatgpt-canonical-semantic/1' as const;

/** Combined budgets for both archives. Callers may lower, never raise, these limits. */
export const CHATGPT_COMPARISON_HARD_LIMITS = Object.freeze({
  maxJsonValues: 2_000_000,
  maxJsonDepth: 96,
  maxJsonStringCodeUnits: 64 * 1024 * 1024,
  maxNodes: 50_000,
  maxBlocks: 200_000,
  maxAssets: 50_000,
  maxDiagnostics: 100_000,
  maxDifferenceRows: 100_000,
  maxDigestProjectionBytes: 32 * 1024 * 1024,
  maxAggregateDigestBytes: 256 * 1024 * 1024,
  maxReportBytes: 64 * 1024 * 1024,
});

export type ChatGptComparisonLimits = {
  -readonly [K in keyof typeof CHATGPT_COMPARISON_HARD_LIMITS]: number;
};

export type ChatGptComparisonErrorCode =
  | 'invalid-request'
  | 'invalid-limits'
  | 'invalid-json'
  | 'archive-invalid'
  | 'input-count-invalid'
  | 'provider-mismatch'
  | 'conversation-mismatch'
  | 'normalizer-pair-invalid'
  | 'limit-exceeded'
  | 'sha256-failed'
  | 'sha256-invalid'
  | 'sha256-mutated';

/** No input values, validation paths, diagnostic text, or original causes escape. */
export class ChatGptComparisonError extends Error {
  readonly code: ChatGptComparisonErrorCode;

  constructor(code: ChatGptComparisonErrorCode) {
    super(`ChatGPT archive comparison failed (${code}).`);
    this.name = 'ChatGptComparisonError';
    this.code = code;
  }
}

export interface CompareChatGptArchivesInput {
  left: unknown;
  right: unknown;
  /** Trusted injected implementation; its bytes are owned by this call. */
  sha256: (bytes: Uint8Array) => Promise<string>;
  limits?: Partial<ChatGptComparisonLimits>;
}

export interface ChatGptComparisonScope {
  side: 'left' | 'right';
  captureId: string;
  manifestSha256: string;
  normalizer: 'chatgpt-web/1' | 'chatgpt-official/1';
  sourceFormat: 'chatgpt.web.history' | 'chatgpt.official.export';
  capturedAt: string | null;
}

export interface ChatGptComparisonFacts {
  nodeCount: number;
  structuralNodeCount: number;
  messageCount: number;
  blockCount: number;
  blocksByType: Record<ArchiveBlock['type'], number>;
  assetCount: number;
  assetsByAcquisitionState: Record<AssetAcquisitionState, number>;
  diagnosticCount: number;
  rootIds: string[];
  currentNodeId: string | null;
  leafIds: string[];
  branchPointIds: string[];
  orderEvidence: 'explicit-or-unknown' | 'parent-derived';
}

export type ConversationDifferenceField = 'title' | 'url' | 'createdAt' | 'updatedAt' | 'metadata';
export type NodeDifferenceField = 'parent' | 'child-membership' | 'child-order' | 'message-id';
export type MessageDifferenceField =
  | 'owner-node'
  | 'author'
  | 'recipient'
  | 'channel'
  | 'createdAt'
  | 'updatedAt'
  | 'status'
  | 'model'
  | 'visibility'
  | 'blocks';
export type AssetDifferenceField = 'metadata' | 'content-claim' | 'acquisition';

export interface ComparisonConflict<Field extends string> {
  id: string;
  fields: Field[];
  leftSemanticSha256: string;
  rightSemanticSha256: string;
  /** Child order alone is informational, including parent-derived order. */
  contentConflict: boolean;
}

export interface SemanticDigest {
  semanticSha256: string;
}

export interface MessageSemanticDigest extends SemanticDigest {
  ownerNodeId: string;
}

export interface AssetSemanticDigest extends SemanticDigest {
  acquisitionState: AssetAcquisitionState;
}

export interface ComparisonBucket<Field extends string, Entry extends SemanticDigest> {
  matchedCount: number;
  leftOnlyIds: string[];
  rightOnlyIds: string[];
  left: Record<string, Entry>;
  right: Record<string, Entry>;
  conflicts: ComparisonConflict<Field>[];
}

export interface MembershipDifferences {
  leftOnlyIds: string[];
  rightOnlyIds: string[];
}

export interface ChatGptComparisonTopology {
  currentNodeEqual: boolean;
  rootMembershipEqual: boolean;
  rootOrderEqual: boolean;
  rootOrderInformational: true;
  roots: MembershipDifferences;
  leafMembershipEqual: boolean;
  leaves: MembershipDifferences;
  branchPointMembershipEqual: boolean;
  branchPoints: MembershipDifferences;
  /** Common exact leaf IDs whose complete exact ancestor chains differ. */
  leafPathDifferenceIds: string[];
  /** Equal child membership, but unequal sequence; never a content conflict alone. */
  childOrderDifferenceIds: string[];
}

export interface DiagnosticCountComparison {
  severity: ArchiveDiagnosticSeverity;
  /** /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/ with at most 96 code units, or fixed fallback. */
  code: string;
  leftCount: number;
  rightCount: number;
}

export type ChatGptComparisonNotice =
  | 'Source references remain capture-scoped; this report does not merge archives.'
  | 'Canonical semantic equality does not establish raw artifact equality.'
  | 'Exact asset ID differences do not establish asset absence; source-only identities can differ.'
  | 'Parent-derived root or child order is informational, not a content conflict.';

export interface ChatGptArchiveComparison {
  schema: typeof CHATGPT_COMPARISON_SCHEMA;
  comparisonVersion: typeof CHATGPT_COMPARISON_VERSION;
  identity: { provider: 'chatgpt'; conversationId: string };
  scopes: { left: ChatGptComparisonScope; right: ChatGptComparisonScope };
  facts: { left: ChatGptComparisonFacts; right: ChatGptComparisonFacts };
  conversation: {
    fields: ConversationDifferenceField[];
    leftSemanticSha256: string;
    rightSemanticSha256: string;
  };
  topology: ChatGptComparisonTopology;
  nodes: ComparisonBucket<NodeDifferenceField, SemanticDigest>;
  messages: ComparisonBucket<MessageDifferenceField, MessageSemanticDigest>;
  assets: ComparisonBucket<AssetDifferenceField, AssetSemanticDigest>;
  diagnostics: DiagnosticCountComparison[];
  notices: ChatGptComparisonNotice[];
}
