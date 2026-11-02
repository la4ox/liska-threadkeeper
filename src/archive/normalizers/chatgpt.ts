/**
 * Public, browser-independent ChatGPT raw-history normalizer API.
 * Implementation is split by responsibility under ./chatgpt/ so provider
 * parsing, privacy handling, graph mapping, and assets remain independently
 * reviewable.
 */

export { normalizeChatGptCapture } from './chatgpt/core';
export {
  ChatGptNormalizationError,
  ChatGptContentLimitError,
  OFFICIAL_EXPORT_NORMALIZER_ID,
  OFFICIAL_EXPORT_SOURCE_FORMAT,
  type ChatGptNormalizationInput,
  type ChatGptNormalizationResult,
} from './chatgpt/contracts';
export {
  CHATGPT_CONTENT_MAX_BLOCKS,
  CHATGPT_CONTENT_MAX_DEPTH,
  CHATGPT_CONTENT_MAX_OCCURRENCES,
  CHATGPT_CONTENT_MAX_WORK_UNITS,
} from './chatgpt/content-budget';
