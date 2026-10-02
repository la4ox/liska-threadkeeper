/** Public browser-independent DeepSeek raw-history normalizer API. */
export { normalizeDeepSeekCapture, preflightDeepSeekHistoryArtifact } from './deepseek/core';
export {
  DEEPSEEK_ATTACHMENT_INVENTORY_DETAIL,
  DEEPSEEK_ATTACHMENT_INVENTORY_WARNING,
  deepSeekAttachmentIdForProviderId,
  inventoryDeepSeekRawAssets,
  type DeepSeekAssetInventory,
  type DeepSeekAssetInventoryInput,
} from './deepseek/inventory';
export {
  DEEPSEEK_NORMALIZER_ID,
  DEEPSEEK_SOURCE_FORMAT,
  DeepSeekNormalizationError,
  type DeepSeekNormalizationInput,
  type DeepSeekNormalizationResult,
} from './deepseek/contracts';
