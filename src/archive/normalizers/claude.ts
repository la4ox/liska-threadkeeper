/** Browser-independent Claude web-detail normalization; no network or binary acquisition. */
export { normalizeClaudeCapture, preflightClaudeDetailArtifact } from './claude/core';
export {
  inventoryClaudeRawAssets,
  type ClaudeAssetInventory,
  type ClaudeAssetInventoryInput,
} from './claude/inventory';
export {
  CLAUDE_NORMALIZER_ID,
  CLAUDE_SOURCE_FORMAT,
  ClaudeNormalizationError,
  type ClaudeNormalizationInput,
  type ClaudeNormalizationResult,
} from './claude/contracts';
export {
  PROVIDER_CONTENT_MAX_BLOCKS,
  PROVIDER_CONTENT_MAX_BYTES,
  PROVIDER_CONTENT_MAX_OCCURRENCES,
  PROVIDER_CONTENT_MAX_WORK_UNITS,
  ProviderBlockTraversalBudget,
  ProviderBlockWorkBudget,
  ProviderContentLimitError,
  providerBlockWorkBudget,
  type ProviderBlockWorkCounters,
  type ProviderContentLimitKind,
} from './provider-block-work-budget';
