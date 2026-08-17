/**
 * Message validation for background service worker
 *
 * Security: Validates sender origins and message content
 * to prevent unauthorized access (M-02)
 */

import {
  MAX_CONTENT_SIZE,
  MAX_EXTENSION_MESSAGE_SIZE,
  MAX_FILENAME_LENGTH,
  MAX_FRONTMATTER_TITLE_LENGTH,
  MAX_TAGS_COUNT,
  MAX_TAG_LENGTH,
  MAX_IMAGES_PER_NOTE,
  MAX_IMAGE_DATA_LENGTH,
  MAX_TOTAL_IMAGE_DATA_LENGTH,
  ALLOWED_ORIGINS,
  VALID_MESSAGE_ACTIONS,
  VALID_OUTPUT_DESTINATIONS,
  VALID_SOURCES,
} from '../lib/constants';
import type { ExtensionMessage, ExtractedImage, ObsidianNote } from '../lib/types';
import { isChatGptConversationId } from '../lib/chatgpt-capture-contract';
import { containsPathTraversal } from '../lib/path-utils';
import { isHttpUrl } from '../lib/validation';
import { isAllowedImageMime, isLikelyBase64, isAllowedImageSourceUrl } from '../lib/image-utils';
import { jsonUtf8ByteLength, utf8ByteLength } from '../lib/byte-size';

/**
 * Validate message sender (M-02)
 *
 * Security: Only accept messages from:
 * - Popup (same extension)
 * - Content scripts from allowed origins
 */
export function validateSender(sender: chrome.runtime.MessageSender): boolean {
  // Allow messages from popup (same extension)
  if (sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)) {
    return true;
  }

  // Validate content script origin
  if (sender.tab?.url) {
    try {
      const url = new URL(sender.tab.url);
      return ALLOWED_ORIGINS.some(origin => url.origin === origin);
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Restrict capture to the exact ChatGPT conversation currently hosting the
 * content script. Generic sender validation intentionally remains broader for
 * the extension's established actions.
 */
export function validateChatGptCaptureSender(
  sender: chrome.runtime.MessageSender,
  conversationId: string
): boolean {
  if (!isChatGptConversationId(conversationId) || !sender.tab?.url) return false;

  const tabUrl = parseChatGptCaptureTabUrl(sender.tab.url, conversationId);
  if (tabUrl === undefined) return false;

  return sender.url === undefined || isSamePageUrl(sender.url, tabUrl);
}

function parseChatGptCaptureTabUrl(rawUrl: string, conversationId: string): URL | undefined {
  try {
    const url = new URL(rawUrl);
    if (!isExactChatGptConversationUrl(url)) return undefined;

    const standard = /^\/c\/([^/]+)\/?$/.exec(url.pathname);
    const custom = /^\/g\/[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?\/c\/([^/]+)\/?$/.exec(url.pathname);
    const routedConversationId = standard?.[1] ?? custom?.[1];
    return routedConversationId === conversationId && isChatGptConversationId(routedConversationId)
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function isExactChatGptConversationUrl(url: URL): boolean {
  return (
    url.origin === 'https://chatgpt.com' &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === ''
  );
}

function isSamePageUrl(rawUrl: string, tabUrl: URL): boolean {
  try {
    const senderUrl = new URL(rawUrl);
    return (
      senderUrl.origin === tabUrl.origin &&
      senderUrl.pathname === tabUrl.pathname &&
      senderUrl.search === tabUrl.search &&
      senderUrl.hash === tabUrl.hash &&
      senderUrl.username === tabUrl.username &&
      senderUrl.password === tabUrl.password
    );
  } catch {
    return false;
  }
}

function hasExactOwnKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

function validateChatGptCaptureMessage(
  message: Extract<ExtensionMessage, { action: 'captureChatGptConversation' }>
): boolean {
  return (
    hasExactOwnKeys(message, ['action', 'conversationId']) &&
    isChatGptConversationId(message.conversationId)
  );
}

function validateFetchImageMessage(
  message: Extract<ExtensionMessage, { action: 'fetchImage' }>
): boolean {
  return typeof message.url === 'string' && isAllowedImageSourceUrl(message.url);
}

/**
 * Validate message content (M-02)
 *
 * Security: Content scripts are less trustworthy.
 * Validate and sanitize all input per Chrome extension best practices.
 */
export function validateMessageContent(message: unknown): message is ExtensionMessage {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return false;
  }

  const extensionMessage = message as ExtensionMessage;
  // Validate action against whitelist (using centralized constants)
  if (
    !VALID_MESSAGE_ACTIONS.includes(
      extensionMessage.action as (typeof VALID_MESSAGE_ACTIONS)[number]
    )
  ) {
    return false;
  }

  // Chrome serializes extension messages as UTF-8 JSON and rejects messages at
  // 64 MiB. Keep the worker boundary below that even for semi-trusted senders.
  if (jsonUtf8ByteLength(extensionMessage) > MAX_EXTENSION_MESSAGE_SIZE) {
    return false;
  }

  // Detailed validation for saveToOutputs action
  if (extensionMessage.action === 'saveToOutputs') {
    if (!validateNoteData(extensionMessage.data)) {
      return false;
    }
    // Validate outputs array (using centralized constants)
    if (!Array.isArray(extensionMessage.outputs) || extensionMessage.outputs.length === 0) {
      return false;
    }
    if (
      !extensionMessage.outputs.every(o =>
        VALID_OUTPUT_DESTINATIONS.includes(o as (typeof VALID_OUTPUT_DESTINATIONS)[number])
      )
    ) {
      return false;
    }
  }

  // The worker can reach hosts the page cannot, so a fetchImage URL is only
  // accepted for the image CDN allow-list (issue #376). Re-checked in the
  // handler; rejecting here keeps a bad URL from ever reaching it.
  if (extensionMessage.action === 'fetchImage') {
    return validateFetchImageMessage(extensionMessage);
  }

  if (extensionMessage.action === 'captureChatGptConversation') {
    return validateChatGptCaptureMessage(extensionMessage);
  }

  return true;
}

/**
 * Validate note data structure
 */
function validateNoteData(note: ObsidianNote | undefined): boolean {
  // Messages arrive as unvalidated JSON: data may be absent despite the type
  if (!note || typeof note !== 'object') {
    return false;
  }

  // Required field validation
  if (typeof note.fileName !== 'string' || typeof note.body !== 'string') {
    return false;
  }

  // File name length limits (filesystem constraints)
  if (note.fileName.length === 0 || note.fileName.length > MAX_FILENAME_LENGTH) {
    return false;
  }

  // Reject path traversal in file names.
  if (containsPathTraversal(note.fileName)) {
    return false;
  }

  // Content size limit (DoS prevention)
  if (utf8ByteLength(note.body) > MAX_CONTENT_SIZE) {
    return false;
  }

  // Require valid frontmatter; fail hard when it is missing.
  if (!validateFrontmatter(note.frontmatter)) {
    return false;
  }

  // Validate attached images (content scripts are semi-trusted; cap count/size)
  if (note.images !== undefined && !validateImages(note.images)) {
    return false;
  }

  return true;
}

/**
 * Validate note frontmatter: title/source/tags/url within limits and schemes.
 */
function validateFrontmatter(frontmatter: ObsidianNote['frontmatter'] | undefined): boolean {
  if (!frontmatter) {
    return false;
  }
  if (
    typeof frontmatter.title !== 'string' ||
    frontmatter.title.length > MAX_FRONTMATTER_TITLE_LENGTH
  ) {
    return false;
  }
  if (
    typeof frontmatter.source !== 'string' ||
    !VALID_SOURCES.includes(frontmatter.source as (typeof VALID_SOURCES)[number])
  ) {
    return false;
  }
  if (!Array.isArray(frontmatter.tags) || frontmatter.tags.length > MAX_TAGS_COUNT) {
    return false;
  }
  if (
    !frontmatter.tags.every(
      (t: unknown) => typeof t === 'string' && t.length > 0 && t.length <= MAX_TAG_LENGTH
    )
  ) {
    return false;
  }
  // Validate URL scheme (prevent javascript: or data: injection)
  if (typeof frontmatter.url !== 'string') {
    return false;
  }
  return frontmatter.url.length === 0 || isHttpUrl(frontmatter.url);
}

/**
 * Validate attached image data (DoS guard). Content scripts are semi-trusted,
 * so bound the image count, per-image base64 size, and combined base64 size,
 * restrict MIME types to a shared allow-list, and require each entry to carry
 * well-formed base64 data.
 */
function validateImages(images: unknown): boolean {
  if (!Array.isArray(images) || images.length > MAX_IMAGES_PER_NOTE) {
    return false;
  }
  let totalDataLength = 0;
  for (const image of images as Array<Partial<ExtractedImage> | null | undefined>) {
    const wellFormed =
      !!image &&
      typeof image === 'object' &&
      typeof image.id === 'string' &&
      typeof image.mimeType === 'string' &&
      typeof image.alt === 'string' &&
      typeof image.data === 'string' &&
      image.data.length <= MAX_IMAGE_DATA_LENGTH &&
      isAllowedImageMime(image.mimeType) &&
      isLikelyBase64(image.data);
    if (!wellFormed) {
      return false;
    }
    totalDataLength += image.data.length;
    if (totalDataLength > MAX_TOTAL_IMAGE_DATA_LENGTH) {
      return false;
    }
  }
  return true;
}
