import type {
  ChatGptOfficialConversationSource,
  ChatGptOfficialMultiSelectionLimits,
} from '../../importers/chatgpt-official';
import type { ChatGptArchiveComparison, ChatGptComparisonLimits } from '../chatgpt';

export const CHATGPT_RECONCILIATION_BUNDLE_SCHEMA =
  'liska-chatgpt-reconciliation-bundle/1' as const;
export const CHATGPT_COMPARISON_ARTIFACT_SCHEMA = 'liska-chatgpt-comparison-artifact/1' as const;

/** Callers may lower these bounds, never raise them. */
export const CHATGPT_RECONCILIATION_DELIVERY_HARD_LIMITS = Object.freeze({
  maxWebCanonicalBytes: 64 * 1024 * 1024,
  maxWebJsonDepth: 96,
  maxWebJsonValues: 2_000_000,
  maxComparisonArtifactBytes: 64 * 1024 * 1024,
  maxArtifactBytes: 64 * 1024 * 1024,
  maxBundleBytes: 256 * 1024 * 1024,
});

export type ChatGptReconciliationDeliveryLimits = {
  -readonly [K in keyof typeof CHATGPT_RECONCILIATION_DELIVERY_HARD_LIMITS]: number;
};

export type ChatGptReconciliationDeliveryLimitOverrides =
  Partial<ChatGptReconciliationDeliveryLimits> & {
    official?: Partial<ChatGptOfficialMultiSelectionLimits>;
    comparison?: Partial<ChatGptComparisonLimits>;
  };

interface PrepareChatGptReconciliationDeliveryBase {
  webCanonicalBytes: Uint8Array;
  captureId: string;
  importedAt: string;
  /** Trusted injected SHA-256; receives disposable owned byte copies. */
  sha256: (bytes: Uint8Array) => Promise<string>;
  limits?: ChatGptReconciliationDeliveryLimitOverrides;
}

export type PrepareChatGptReconciliationDeliveryInput = PrepareChatGptReconciliationDeliveryBase &
  (
    | { officialChunks: AsyncIterable<Uint8Array>; officialSources?: never }
    | { officialChunks?: never; officialSources: ChatGptOfficialConversationSource[] }
  );

export type ChatGptReconciliationDeliveryErrorCode =
  | 'invalid-input'
  | 'invalid-limits'
  | 'web-size-limit'
  | 'web-invalid-utf8'
  | 'web-bom-not-supported'
  | 'web-invalid-json'
  | 'web-duplicate-key'
  | 'web-json-limit'
  | 'web-archive-invalid'
  | 'web-archive-limit'
  | 'web-identity-invalid'
  | 'official-import-failed'
  | 'comparison-failed'
  | 'comparison-artifact-limit'
  | 'artifact-limit'
  | 'bundle-limit'
  | 'hash-failed'
  | 'hash-invalid'
  | 'hash-mutated';

/** No source values, parser details, exception text, or causes escape. */
export class ChatGptReconciliationDeliveryError extends Error {
  readonly code: ChatGptReconciliationDeliveryErrorCode;

  constructor(code: ChatGptReconciliationDeliveryErrorCode) {
    super(`ChatGPT reconciliation delivery failed (${code}).`);
    this.name = 'ChatGptReconciliationDeliveryError';
    this.code = code;
  }
}

export type ChatGptReconciliationArtifactPath =
  | 'official/conversation.json'
  | 'official/manifest.json'
  | 'official/canonical/liska-thread-1.json'
  | 'comparison/liska-chatgpt-comparison-1.json'
  | 'manifest.json';

export interface ChatGptReconciliationArtifactDescriptor {
  relativePath: ChatGptReconciliationArtifactPath;
  mediaType: 'application/json';
  byteLength: number;
  sha256: string;
}

export interface ChatGptReconciliationArtifact extends ChatGptReconciliationArtifactDescriptor {
  bytes: Uint8Array;
}

/** Exact selected-file bytes, not a digest of reserialized canonical JSON. */
export interface ChatGptWebCanonicalReceipt {
  byteLength: number;
  sha256: string;
  provenanceVerification: 'canonical-declarations-only';
}

export interface ChatGptOfficialExcerptProvenance {
  kind: 'official-export-slice';
  fileRole: 'conversations';
  conversationIndex: number;
  byteStart: number;
  byteEndExclusive: number;
  sourceByteLength: number;
  shardIndex?: number;
  ignoredEmptyRecordCount?: number;
}

export interface ChatGptReconciliationOfficialReceipt {
  captureId: string;
  declaredManifestSha256: string;
  excerpt: ChatGptReconciliationArtifactDescriptor;
  manifest: ChatGptReconciliationArtifactDescriptor;
  provenance: ChatGptOfficialExcerptProvenance;
}

export interface ChatGptComparisonArtifact {
  schema: typeof CHATGPT_COMPARISON_ARTIFACT_SCHEMA;
  webCanonical: ChatGptWebCanonicalReceipt;
  official: ChatGptReconciliationOfficialReceipt;
  comparison: ChatGptArchiveComparison;
}

export const CHATGPT_RECONCILIATION_WARNINGS = [
  'Selected web bytes are identified by length and SHA-256; declared raw and manifest provenance was not independently verified.',
  'Official export completeness applies to the selected object; provider-only content may be absent.',
  'Source files remain unchanged; this bundle does not merge or deduplicate archives.',
] as const;

export interface ChatGptReconciliationBundleManifest {
  schema: typeof CHATGPT_RECONCILIATION_BUNDLE_SCHEMA;
  status: 'normalized' | 'raw-only';
  failureCode: 'official-normalization-failed' | null;
  webCanonical: ChatGptWebCanonicalReceipt;
  official: ChatGptReconciliationOfficialReceipt;
  /** Ordered artifacts, excluding this root manifest itself. */
  artifacts: ChatGptReconciliationArtifactDescriptor[];
  warnings: string[];
}

interface ChatGptReconciliationDeliveryBase {
  conversationKey: string;
  /** SHA-256 of the exact final root manifest bytes. */
  bundleId: string;
  /** Root manifest is always last; every byte allocation is owned by the result. */
  artifacts: ChatGptReconciliationArtifact[];
  manifest: ChatGptReconciliationBundleManifest;
}

export interface ChatGptNormalizedReconciliationDelivery extends ChatGptReconciliationDeliveryBase {
  status: 'normalized';
  failureCode: null;
}

export interface ChatGptRawOnlyReconciliationDelivery extends ChatGptReconciliationDeliveryBase {
  status: 'raw-only';
  failureCode: 'official-normalization-failed';
}

export type ChatGptReconciliationDelivery =
  | ChatGptNormalizedReconciliationDelivery
  | ChatGptRawOnlyReconciliationDelivery;
