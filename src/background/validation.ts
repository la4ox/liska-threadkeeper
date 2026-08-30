/**
 * Message validation for background service worker
 *
 * Security: Validates sender origins and message content
 * to prevent unauthorized access (M-02)
 */

import {
  MAX_CONTENT_SIZE,
  BINARY_STAGE_CHUNK_BYTES,
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
import type {
  ArchiveCompanionArtifact,
  ExtensionMessage,
  ExtractedImage,
  ObsidianNote,
  OutputOptions,
} from '../lib/types';
import { ARCHIVE_COMPANION_KINDS, ARCHIVE_COMPANION_RELATIVE_PATHS } from '../lib/types';
import {
  CHATGPT_CAPTURE_MAX_BYTES,
  isChatGptConversationId,
} from '../lib/chatgpt-capture-contract';
import {
  CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT,
  isChatGptActiveResolverProviderFileId,
} from '../lib/chatgpt-active-resolver-contract';
import { isChatGptInterpreterCandidates } from '../lib/chatgpt-interpreter-resolver-contract';
import { containsPathTraversal } from '../lib/path-utils';
import { isHttpUrl } from '../lib/validation';
import { canonicalBase64ByteLength } from '../lib/base64';
import { isSafeBinaryStageId, isStagedBinaryAssetDescriptor } from '../lib/binary-asset-contract';
import { isAllowedImageMime, isLikelyBase64, isAllowedImageSourceUrl } from '../lib/image-utils';
import { jsonUtf8ByteLength, utf8ByteLength } from '../lib/byte-size';
import { platformOrigins } from '../lib/platform-registry';

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

  // ChatGPT changes conversations with history.pushState. Chrome keeps
  // MessageSender.url bound to the document URL where the content script was
  // injected, while sender.tab.url follows the current SPA route. Requiring
  // both paths to match rejects a trusted click after an ordinary sidebar
  // navigation. The current tab route above remains exact and UUID-bound; the
  // document URL only needs to prove that the sender is still a ChatGPT page.
  return sender.url === undefined || isExactChatGptDocumentUrl(sender.url);
}

/** Interpreter sandbox downloads are unsupported on custom-GPT routes. */
export function validateChatGptStandardConversationSender(
  sender: chrome.runtime.MessageSender,
  conversationId: string
): boolean {
  if (!isChatGptConversationId(conversationId) || !sender.tab?.url) return false;
  const tabUrl = parseChatGptCaptureTabUrl(sender.tab.url, conversationId);
  if (tabUrl === undefined) return false;
  const standard = /^\/c\/([^/]+)\/?$/.exec(tabUrl.pathname);
  return (
    standard?.[1] === conversationId &&
    (sender.url === undefined || isExactChatGptDocumentUrl(sender.url))
  );
}

/**
 * A staged binary asset carries no provider transport data, but its source
 * still selects the user-configured Obsidian folder. Bind that source to the
 * exact platform origin so one content script cannot claim another platform.
 */
export function validateStagedBinaryAssetSender(
  sender: chrome.runtime.MessageSender,
  source: Extract<ExtensionMessage, { action: 'commitStagedBinaryAsset' }>['source']
): boolean {
  if (!sender.tab?.url || !VALID_SOURCES.includes(source)) return false;
  try {
    const url = new URL(sender.tab.url);
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      platformOrigins(source).includes(url.origin)
    );
  } catch {
    return false;
  }
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

function isExactChatGptDocumentUrl(rawUrl: string): boolean {
  try {
    const senderUrl = new URL(rawUrl);
    return (
      senderUrl.origin === 'https://chatgpt.com' &&
      senderUrl.username === '' &&
      senderUrl.password === ''
    );
  } catch {
    return false;
  }
}

function hasExactOwnKeys(value: object, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length) return false;
  return expected.every(expectedKey => keys.some(key => key === expectedKey));
}

function validateChatGptCaptureMessage(
  message: Extract<ExtensionMessage, { action: 'captureChatGptConversation' }>
): boolean {
  const exactBase = hasExactOwnKeys(message, ['action', 'conversationId']);
  const exactOptIn = hasExactOwnKeys(message, [
    'action',
    'conversationId',
    'observeAssetResolvers',
  ]);
  return (
    (exactBase || exactOptIn) &&
    isChatGptConversationId(message.conversationId) &&
    (message.observeAssetResolvers === undefined ||
      typeof message.observeAssetResolvers === 'boolean')
  );
}

function validateChatGptOpaqueProbeMessage(
  message: Extract<ExtensionMessage, { action: 'probeChatGptOpaqueRequest' }>
): boolean {
  return (
    hasExactOwnKeys(message, ['action', 'conversationId']) &&
    isChatGptConversationId(message.conversationId)
  );
}

function validateChatGptOpaqueReplayMessage(
  message: Extract<ExtensionMessage, { action: 'captureChatGptConversationViaOpaqueReplay' }>
): boolean {
  return (
    hasExactOwnKeys(message, ['action', 'conversationId']) &&
    isChatGptConversationId(message.conversationId)
  );
}

function validateChatGptOpaqueResolverMessage(
  message: Extract<ExtensionMessage, { action: 'observeChatGptAssetResolversViaOpaqueSource' }>
): boolean {
  return (
    hasExactOwnKeys(message, ['action', 'conversationId']) &&
    isChatGptConversationId(message.conversationId)
  );
}

function validateChatGptActiveResolverMessage(
  message: Extract<ExtensionMessage, { action: 'probeChatGptActiveAssetResolvers' }>
): boolean {
  if (!hasExactOwnKeys(message, ['action', 'conversationId', 'providerFileIds'])) return false;
  if (!isChatGptConversationId(message.conversationId) || !Array.isArray(message.providerFileIds)) {
    return false;
  }
  if (
    message.providerFileIds.length === 0 ||
    message.providerFileIds.length > CHATGPT_ACTIVE_RESOLVER_DIAGNOSTIC_MAX_COUNT
  ) {
    return false;
  }
  const seen = new Set<string>();
  for (const providerFileId of message.providerFileIds) {
    if (!isChatGptActiveResolverProviderFileId(providerFileId) || seen.has(providerFileId))
      return false;
    seen.add(providerFileId);
  }
  return true;
}

function validateChatGptInterpreterResolverMessage(
  message: Extract<ExtensionMessage, { action: 'resolveChatGptInterpreterAssets' }>
): boolean {
  return (
    hasExactOwnKeys(message, ['action', 'conversationId', 'candidates']) &&
    isChatGptConversationId(message.conversationId) &&
    isChatGptInterpreterCandidates(message.candidates)
  );
}

function validateChatGptBridgeMessage(
  message: Extract<
    ExtensionMessage,
    {
      action:
        | 'captureChatGptConversation'
        | 'probeChatGptOpaqueRequest'
        | 'captureChatGptConversationViaOpaqueReplay'
        | 'observeChatGptAssetResolversViaOpaqueSource'
        | 'probeChatGptActiveAssetResolvers'
        | 'resolveChatGptInterpreterAssets';
    }
  >
): boolean {
  if (message.action === 'captureChatGptConversation')
    return validateChatGptCaptureMessage(message);
  return message.action === 'probeChatGptOpaqueRequest'
    ? validateChatGptOpaqueProbeMessage(message)
    : message.action === 'captureChatGptConversationViaOpaqueReplay'
      ? validateChatGptOpaqueReplayMessage(message)
      : message.action === 'observeChatGptAssetResolversViaOpaqueSource'
        ? validateChatGptOpaqueResolverMessage(message)
        : message.action === 'probeChatGptActiveAssetResolvers'
          ? validateChatGptActiveResolverMessage(message)
          : validateChatGptInterpreterResolverMessage(message);
}

function validateFetchImageMessage(
  message: Extract<ExtensionMessage, { action: 'fetchImage' }>
): boolean {
  return typeof message.url === 'string' && isAllowedImageSourceUrl(message.url);
}

function validateOutputOptions(value: unknown): value is OutputOptions {
  return (
    typeof value === 'object' &&
    value !== null &&
    hasExactOwnKeys(value, ['obsidian', 'file', 'clipboard']) &&
    typeof (value as Record<string, unknown>).obsidian === 'boolean' &&
    typeof (value as Record<string, unknown>).file === 'boolean' &&
    typeof (value as Record<string, unknown>).clipboard === 'boolean'
  );
}

const SAFE_CAPTURE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/;
const OPAQUE_CONVERSATION_KEY_PATTERN = /^[a-f0-9]{64}$/;

function isSafeNoteFileName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 3 &&
    value.length <= MAX_FILENAME_LENGTH &&
    value.endsWith('.md') &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !containsPathTraversal(value)
  );
}

function isArchiveCompanionKind(value: unknown): value is ArchiveCompanionArtifact['kind'] {
  return (
    typeof value === 'string' && (ARCHIVE_COMPANION_KINDS as readonly string[]).includes(value)
  );
}

function hasValidArchiveCompanionMetadata(artifact: Record<string, unknown>): boolean {
  const kind = artifact.kind;
  return (
    isArchiveCompanionKind(kind) &&
    artifact.relativePath === ARCHIVE_COMPANION_RELATIVE_PATHS[kind] &&
    artifact.mediaType === 'application/json' &&
    typeof artifact.bodyBase64 === 'string' &&
    typeof artifact.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(artifact.sha256) &&
    Number.isSafeInteger(artifact.byteLength) &&
    (artifact.byteLength as number) >= 0
  );
}

function validateArchiveCompanionArtifact(value: unknown): value is ArchiveCompanionArtifact {
  if (typeof value !== 'object' || value === null) return false;
  if (
    !hasExactOwnKeys(value, [
      'kind',
      'relativePath',
      'mediaType',
      'byteLength',
      'sha256',
      'bodyBase64',
    ])
  ) {
    return false;
  }

  const artifact = value as Record<string, unknown>;
  if (!hasValidArchiveCompanionMetadata(artifact)) return false;

  const bodyBase64 = artifact.bodyBase64 as string;
  const byteLength = canonicalBase64ByteLength(bodyBase64);
  const maxBytes = artifact.kind === 'raw' ? CHATGPT_CAPTURE_MAX_BYTES : MAX_CONTENT_SIZE;
  return byteLength === artifact.byteLength && byteLength !== undefined && byteLength <= maxBytes;
}

function validatePersistArchiveCompanionMessage(
  message: Extract<ExtensionMessage, { action: 'persistArchiveCompanion' }>
): boolean {
  return (
    hasExactOwnKeys(message, [
      'action',
      'noteFileName',
      'source',
      'captureId',
      'conversationKey',
      'artifact',
      'outputs',
    ]) &&
    isSafeNoteFileName(message.noteFileName) &&
    message.source === 'chatgpt' &&
    SAFE_CAPTURE_ID_PATTERN.test(message.captureId) &&
    OPAQUE_CONVERSATION_KEY_PATTERN.test(message.conversationKey) &&
    validateArchiveCompanionArtifact(message.artifact) &&
    Array.isArray(message.outputs) &&
    message.outputs.length > 0 &&
    message.outputs.length <= 2 &&
    new Set(message.outputs).size === message.outputs.length &&
    message.outputs.every(output => output === 'file' || output === 'obsidian')
  );
}

function validatePersistentOutputs(value: unknown): value is ('file' | 'obsidian')[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 2 &&
    new Set(value).size === value.length &&
    value.every(output => output === 'file' || output === 'obsidian')
  );
}

function validateBeginStagedBinaryAssetMessage(
  message: Extract<ExtensionMessage, { action: 'beginStagedBinaryAsset' }>
): boolean {
  return (
    hasExactOwnKeys(message, ['action', 'source', 'stageId', 'descriptor']) &&
    VALID_SOURCES.includes(message.source) &&
    isSafeBinaryStageId(message.stageId) &&
    isStagedBinaryAssetDescriptor(message.descriptor)
  );
}

function validateAppendStagedBinaryAssetMessage(
  message: Extract<ExtensionMessage, { action: 'appendStagedBinaryAsset' }>
): boolean {
  const chunkLength =
    typeof message.chunkBase64 === 'string'
      ? canonicalBase64ByteLength(message.chunkBase64)
      : undefined;
  return (
    hasExactOwnKeys(message, ['action', 'source', 'stageId', 'offset', 'chunkBase64']) &&
    VALID_SOURCES.includes(message.source) &&
    isSafeBinaryStageId(message.stageId) &&
    Number.isSafeInteger(message.offset) &&
    message.offset >= 0 &&
    typeof message.chunkBase64 === 'string' &&
    chunkLength !== undefined &&
    chunkLength <= BINARY_STAGE_CHUNK_BYTES
  );
}

function validateCommitStagedBinaryAssetMessage(
  message: Extract<ExtensionMessage, { action: 'commitStagedBinaryAsset' }>
): boolean {
  return (
    hasExactOwnKeys(message, [
      'action',
      'stageId',
      'captureId',
      'conversationKey',
      'source',
      'descriptor',
      'outputs',
    ]) &&
    isSafeBinaryStageId(message.stageId) &&
    SAFE_CAPTURE_ID_PATTERN.test(message.captureId) &&
    OPAQUE_CONVERSATION_KEY_PATTERN.test(message.conversationKey) &&
    VALID_SOURCES.includes(message.source) &&
    isStagedBinaryAssetDescriptor(message.descriptor) &&
    validatePersistentOutputs(message.outputs)
  );
}

function validateAbortStagedBinaryAssetMessage(
  message: Extract<ExtensionMessage, { action: 'abortStagedBinaryAsset' }>
): boolean {
  return (
    hasExactOwnKeys(message, ['action', 'source', 'stageId']) &&
    VALID_SOURCES.includes(message.source) &&
    isSafeBinaryStageId(message.stageId)
  );
}

function validateStagedBinaryAssetMessage(message: ExtensionMessage): boolean | undefined {
  switch (message.action) {
    case 'beginStagedBinaryAsset':
      return validateBeginStagedBinaryAssetMessage(message);
    case 'appendStagedBinaryAsset':
      return validateAppendStagedBinaryAssetMessage(message);
    case 'commitStagedBinaryAsset':
      return validateCommitStagedBinaryAssetMessage(message);
    case 'abortStagedBinaryAsset':
      return validateAbortStagedBinaryAssetMessage(message);
    default:
      return undefined;
  }
}

function validateSaveToOutputsMessage(
  message: Extract<ExtensionMessage, { action: 'saveToOutputs' }>
): boolean {
  return (
    validateNoteData(message.data) &&
    Array.isArray(message.outputs) &&
    message.outputs.length > 0 &&
    message.outputs.every(output =>
      VALID_OUTPUT_DESTINATIONS.includes(output as (typeof VALID_OUTPUT_DESTINATIONS)[number])
    )
  );
}

/**
 * Validate message content (M-02)
 *
 * Security: Content scripts are less trustworthy.
 * Validate and sanitize all input per Chrome extension best practices.
 */
// eslint-disable-next-line complexity -- Exact bridge action boundaries remain explicit at this untrusted input gate.
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

  if (extensionMessage.action === 'saveToOutputs') {
    return validateSaveToOutputsMessage(extensionMessage);
  }

  if (extensionMessage.action === 'persistArchiveCompanion') {
    return validatePersistArchiveCompanionMessage(extensionMessage);
  }

  const stagedBinaryValidation = validateStagedBinaryAssetMessage(extensionMessage);
  if (stagedBinaryValidation !== undefined) return stagedBinaryValidation;

  if (extensionMessage.action === 'updateOutputOptions') {
    return (
      hasExactOwnKeys(extensionMessage, ['action', 'outputOptions']) &&
      validateOutputOptions(extensionMessage.outputOptions)
    );
  }

  // The worker can reach hosts the page cannot, so a fetchImage URL is only
  // accepted for the image CDN allow-list (issue #376). Re-checked in the
  // handler; rejecting here keeps a bad URL from ever reaching it.
  if (extensionMessage.action === 'fetchImage') {
    return validateFetchImageMessage(extensionMessage);
  }

  if (
    extensionMessage.action === 'captureChatGptConversation' ||
    extensionMessage.action === 'probeChatGptOpaqueRequest' ||
    extensionMessage.action === 'captureChatGptConversationViaOpaqueReplay' ||
    extensionMessage.action === 'observeChatGptAssetResolversViaOpaqueSource' ||
    extensionMessage.action === 'probeChatGptActiveAssetResolvers' ||
    extensionMessage.action === 'resolveChatGptInterpreterAssets'
  ) {
    return validateChatGptBridgeMessage(extensionMessage);
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
