/**
 * Public, browser-independent ChatGPT raw-history normalizer API.
 * Implementation is split by responsibility under ./chatgpt/ so provider
 * parsing, privacy handling, graph mapping, and assets remain independently
 * reviewable.
 */

export { normalizeChatGptCapture } from './chatgpt/core';
export {
  ChatGptNormalizationError,
  type ChatGptNormalizationInput,
  type ChatGptNormalizationResult,
} from './chatgpt/contracts';
