/**
 * Background Service Worker
 * Handles HTTP communication with Obsidian REST API
 */

import { getErrorMessage } from '../lib/error-utils';
import { getSettings, migrateSettings, saveSettings } from '../lib/storage';
import {
  validateChatGptCaptureSender,
  validateMessageContent,
  validateSender,
  validateStagedBinaryAssetSender,
} from './validation';
import { handleTestConnection } from './obsidian-handlers';
import { handleMultiOutput, handlePersistArchiveCompanion } from './output-handlers';
import { handleStagedBinaryAssetMessage } from './binary-asset-handlers';
import { startStagedBinaryDownloadRecovery } from './binary-download-recovery';
import { handleFetchImage } from './image-fetch';
import {
  CHATGPT_CAPTURE_ENDPOINT,
  createChatGptCaptureFailure,
  isChatGptCaptureResponse,
} from '../lib/chatgpt-capture-contract';
import {
  createChatGptOpaqueProbeResult,
  isChatGptOpaqueProbeResponse,
} from '../lib/chatgpt-opaque-probe-contract';
import {
  createChatGptOpaqueReplayFailure,
  isChatGptOpaqueReplayResponse,
} from '../lib/chatgpt-opaque-replay-contract';
import {
  createChatGptOpaqueResolverFailure,
  isChatGptOpaqueResolverResponse,
} from '../lib/chatgpt-opaque-resolver-contract';
import {
  createChatGptActiveResolverFailure,
  isChatGptActiveResolverResponse,
} from '../lib/chatgpt-active-resolver-contract';
import { captureChatGptInTemporaryTab, ChatGptTemporaryCaptureError } from './chatgpt-capture';
import { probeChatGptOpaqueRequest } from './chatgpt-opaque-probe';
import { captureChatGptConversationViaOpaqueReplay } from './chatgpt-opaque-replay';
import { observeChatGptAssetResolversViaOpaqueSource } from './chatgpt-opaque-resolver';
import { probeChatGptActiveAssetResolvers } from './chatgpt-active-resolver';
import type {
  ExtensionMessage,
  ContentScriptSettings,
  ExtensionSettings,
  OutputOptions,
} from '../lib/types';

/** Latest acknowledged popup intent while chrome.storage.sync is committing. */
let outputOptionsOverride: OutputOptions | undefined;

// Register durable Downloads recovery before any awaited startup work. A fresh
// MV3 worker must observe terminal deltas and browser-startup reconciliation.
startStagedBinaryDownloadRecovery();

// Run settings migration on service worker startup (C-01)
// Note: top-level await not available in service workers, use .catch() for error handling
migrateSettings().catch(error => {
  console.error('[G2O Background] Settings migration failed:', error);
});

function dispatchMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
): void {
  handleMessage(message, sender)
    .then(response => {
      try {
        sendResponse(response);
      } catch {
        /* sender disconnected */
      }
    })
    .catch(error => {
      console.error('[G2O Background] Error handling message:', error);
      try {
        sendResponse({ success: false, error: getErrorMessage(error) });
      } catch {
        /* sender disconnected */
      }
    });
}

/**
 * Handle incoming messages from content script and popup
 */
chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    // Ignore messages targeted at offscreen document
    // These are handled by the offscreen document's own listener
    if (!isChatGptBridgeMessage(message) && hasOwnDataProperty(message, 'target', 'offscreen')) {
      return false;
    }

    // Sender validation (M-02)
    if (!validateSender(sender)) {
      console.warn('[G2O Background] Rejected message from unauthorized sender');
      sendResponse(chatGptBridgeFailureOr(message, { success: false, error: 'Unauthorized' }));
      return false;
    }

    // Message content validation (M-02)
    // A throw here would otherwise escape the listener and leave the sender
    // hanging without a response, so treat it as invalid content
    try {
      if (!validateMessageContent(message)) {
        console.warn('[G2O Background] Invalid message content');
        sendResponse(
          chatGptBridgeFailureOr(message, { success: false, error: 'Invalid message content' })
        );
        return false;
      }
    } catch (error) {
      console.warn('[G2O Background] Message validation threw:', getErrorMessage(error));
      sendResponse(
        chatGptBridgeFailureOr(message, { success: false, error: 'Invalid message content' })
      );
      return false;
    }

    if (!isAuthorizedChatGptCaptureRequest(message, sender)) {
      sendResponse(chatGptBridgeFailureOr(message, { success: false, error: 'Unauthorized' }));
      return false;
    }

    if (!isAuthorizedOutputOptionsUpdate(message, sender)) {
      sendResponse({ success: false, error: 'Unauthorized' });
      return false;
    }

    if (!isAuthorizedStagedBinaryAssetRequest(message, sender)) {
      sendResponse({ success: false, error: 'Unauthorized' });
      return false;
    }

    dispatchMessage(message, sender, sendResponse);
    return true; // Indicates async response
  }
);

/**
 * Check if sender is a content script (tab) vs extension page (popup)
 */
function isContentScriptSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.tab !== undefined;
}

function hasOwnDataProperty(message: unknown, property: string, expectedValue: string): boolean {
  if (typeof message !== 'object' || message === null) return false;
  try {
    return Object.getOwnPropertyDescriptor(message, property)?.value === expectedValue;
  } catch {
    return false;
  }
}

function isChatGptBridgeMessage(message: unknown): boolean {
  return (
    hasOwnDataProperty(message, 'action', 'captureChatGptConversation') ||
    hasOwnDataProperty(message, 'action', 'probeChatGptOpaqueRequest') ||
    hasOwnDataProperty(message, 'action', 'captureChatGptConversationViaOpaqueReplay') ||
    hasOwnDataProperty(message, 'action', 'observeChatGptAssetResolversViaOpaqueSource') ||
    hasOwnDataProperty(message, 'action', 'probeChatGptActiveAssetResolvers')
  );
}

function chatGptBridgeFailureOr<T>(
  message: unknown,
  genericResponse: T
):
  | T
  | ReturnType<typeof createChatGptCaptureFailure>
  | ReturnType<typeof createChatGptOpaqueReplayFailure>
  | ReturnType<typeof createChatGptOpaqueResolverFailure>
  | ReturnType<typeof createChatGptActiveResolverFailure>
  | { success: false; data: unknown } {
  if (hasOwnDataProperty(message, 'action', 'captureChatGptConversation')) {
    return createChatGptCaptureFailure('capture-failed');
  }
  if (hasOwnDataProperty(message, 'action', 'probeChatGptOpaqueRequest')) {
    return { success: false, data: createChatGptOpaqueProbeResult('probe-failed') };
  }
  if (hasOwnDataProperty(message, 'action', 'captureChatGptConversationViaOpaqueReplay')) {
    return createChatGptOpaqueReplayFailure('replay-result-invalid');
  }
  if (hasOwnDataProperty(message, 'action', 'observeChatGptAssetResolversViaOpaqueSource')) {
    return createChatGptOpaqueResolverFailure('observer-result-invalid');
  }
  if (hasOwnDataProperty(message, 'action', 'probeChatGptActiveAssetResolvers')) {
    return createChatGptActiveResolverFailure('resolver-result-invalid');
  }
  return genericResponse;
}

function isAuthorizedChatGptCaptureRequest(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): boolean {
  return (
    (message.action !== 'captureChatGptConversation' &&
      message.action !== 'probeChatGptOpaqueRequest' &&
      message.action !== 'captureChatGptConversationViaOpaqueReplay' &&
      message.action !== 'observeChatGptAssetResolversViaOpaqueSource' &&
      message.action !== 'probeChatGptActiveAssetResolvers') ||
    validateChatGptCaptureSender(sender, message.conversationId)
  );
}

function isAuthorizedOutputOptionsUpdate(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): boolean {
  if (message.action !== 'updateOutputOptions') return true;
  return (
    sender.tab === undefined &&
    sender.id === chrome.runtime.id &&
    sender.url === chrome.runtime.getURL('src/popup/index.html')
  );
}

function isStagedBinaryAssetMessage(
  message: ExtensionMessage
): message is Extract<
  ExtensionMessage,
  | { action: 'beginStagedBinaryAsset' }
  | { action: 'appendStagedBinaryAsset' }
  | { action: 'commitStagedBinaryAsset' }
  | { action: 'abortStagedBinaryAsset' }
> {
  return (
    message.action === 'beginStagedBinaryAsset' ||
    message.action === 'appendStagedBinaryAsset' ||
    message.action === 'commitStagedBinaryAsset' ||
    message.action === 'abortStagedBinaryAsset'
  );
}

function isAuthorizedStagedBinaryAssetRequest(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): boolean {
  if (!isStagedBinaryAssetMessage(message) || sender.tab === undefined)
    return !isStagedBinaryAssetMessage(message);
  return validateStagedBinaryAssetSender(sender, message.source);
}

/** Chrome 96 exposes permissions.contains as a callback API; reject unavailable APIs as absent. */
function hasScriptingPermission(): Promise<boolean> {
  return new Promise(resolve => {
    try {
      const permissionsApi = chrome.permissions;
      if (!permissionsApi || typeof permissionsApi.contains !== 'function') {
        resolve(false);
        return;
      }

      let settled = false;
      const settle = (granted: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(granted);
      };
      const contains = permissionsApi.contains as unknown as (
        permissions: { permissions: string[] },
        callback: (granted: boolean) => void
      ) => unknown;
      const result = contains.call(permissionsApi, { permissions: ['scripting'] }, granted => {
        settle(!chrome.runtime.lastError && granted === true);
      });
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        void (result as Promise<unknown>).then(
          granted => settle(granted === true),
          () => settle(false)
        );
      }
    } catch {
      resolve(false);
    }
  });
}

async function handleChatGptCapture(conversationId: string, observeAssetResolvers: boolean) {
  if (!(await hasScriptingPermission())) {
    return createChatGptCaptureFailure('permission-unavailable');
  }

  let capture: Awaited<ReturnType<typeof captureChatGptInTemporaryTab>>;
  try {
    capture = await captureChatGptInTemporaryTab(conversationId, { observeAssetResolvers });
  } catch (error) {
    return createChatGptCaptureFailure(
      error instanceof ChatGptTemporaryCaptureError ? error.code : 'background-capture-exception'
    );
  }

  try {
    const response = {
      success: true as const,
      data: {
        bodyBase64: capture.bodyBase64,
        byteLength: capture.byteLength,
        sha256: capture.sha256,
        mediaType: capture.mediaType,
        endpoint: {
          method: CHATGPT_CAPTURE_ENDPOINT.method,
          pathPattern: CHATGPT_CAPTURE_ENDPOINT.pathPattern,
        },
        transientAssetResolvers: capture.transientAssetResolvers.map(resolver => ({
          resolverKey: resolver.resolverKey,
          downloadUrl: resolver.downloadUrl,
        })),
      },
    };
    return isChatGptCaptureResponse(response)
      ? response
      : createChatGptCaptureFailure('unexpected-capture-result');
  } catch {
    return createChatGptCaptureFailure('capture-response-validation-exception');
  }
}

async function handleChatGptOpaqueProbe(conversationId: string) {
  if (!(await hasScriptingPermission())) {
    return { success: false, data: createChatGptOpaqueProbeResult('probe-failed') };
  }
  try {
    const response = {
      success: false as const,
      data: await probeChatGptOpaqueRequest(conversationId),
    };
    return isChatGptOpaqueProbeResponse(response)
      ? response
      : { success: false, data: createChatGptOpaqueProbeResult('probe-failed') };
  } catch {
    return { success: false, data: createChatGptOpaqueProbeResult('probe-failed') };
  }
}

async function handleChatGptOpaqueReplay(conversationId: string) {
  if (!(await hasScriptingPermission())) {
    return createChatGptOpaqueReplayFailure('permission-unavailable');
  }
  try {
    const response = await captureChatGptConversationViaOpaqueReplay(conversationId);
    return isChatGptOpaqueReplayResponse(response)
      ? response
      : createChatGptOpaqueReplayFailure('replay-result-invalid');
  } catch {
    return createChatGptOpaqueReplayFailure('replay-result-invalid');
  }
}

async function handleChatGptOpaqueResolver(conversationId: string) {
  if (!(await hasScriptingPermission())) {
    return createChatGptOpaqueResolverFailure('permission-unavailable');
  }
  try {
    const response = await observeChatGptAssetResolversViaOpaqueSource(conversationId);
    return isChatGptOpaqueResolverResponse(response)
      ? response
      : createChatGptOpaqueResolverFailure('observer-result-invalid');
  } catch {
    return createChatGptOpaqueResolverFailure('observer-result-invalid');
  }
}

async function handleChatGptActiveResolver(conversationId: string, providerFileIds: string[]) {
  if (!(await hasScriptingPermission())) {
    return createChatGptActiveResolverFailure('permission-unavailable');
  }
  try {
    const response = await probeChatGptActiveAssetResolvers(conversationId, providerFileIds);
    return isChatGptActiveResolverResponse(response)
      ? response
      : createChatGptActiveResolverFailure('resolver-result-invalid');
  } catch {
    return createChatGptActiveResolverFailure('resolver-result-invalid');
  }
}

function isChatGptBridgeAction(message: ExtensionMessage): message is Extract<
  ExtensionMessage,
  {
    action:
      | 'captureChatGptConversation'
      | 'probeChatGptOpaqueRequest'
      | 'captureChatGptConversationViaOpaqueReplay'
      | 'observeChatGptAssetResolversViaOpaqueSource'
      | 'probeChatGptActiveAssetResolvers';
  }
> {
  return (
    message.action === 'captureChatGptConversation' ||
    message.action === 'probeChatGptOpaqueRequest' ||
    message.action === 'captureChatGptConversationViaOpaqueReplay' ||
    message.action === 'observeChatGptAssetResolversViaOpaqueSource' ||
    message.action === 'probeChatGptActiveAssetResolvers'
  );
}

async function handleChatGptBridgeMessage(
  message: Extract<
    ExtensionMessage,
    {
      action:
        | 'captureChatGptConversation'
        | 'probeChatGptOpaqueRequest'
        | 'captureChatGptConversationViaOpaqueReplay'
        | 'observeChatGptAssetResolversViaOpaqueSource'
        | 'probeChatGptActiveAssetResolvers';
    }
  >
): Promise<unknown> {
  if (message.action === 'captureChatGptConversation') {
    return handleChatGptCapture(message.conversationId, message.observeAssetResolvers === true);
  }
  if (message.action === 'captureChatGptConversationViaOpaqueReplay') {
    return handleChatGptOpaqueReplay(message.conversationId);
  }
  if (message.action === 'observeChatGptAssetResolversViaOpaqueSource') {
    return handleChatGptOpaqueResolver(message.conversationId);
  }
  if (message.action === 'probeChatGptActiveAssetResolvers') {
    return handleChatGptActiveResolver(message.conversationId, message.providerFileIds);
  }
  return handleChatGptOpaqueProbe(message.conversationId);
}

/**
 * Redact sensitive settings for content scripts.
 * Content scripts only need to know IF an API key is configured, not the key itself.
 */
function redactSettingsForContentScript(settings: ExtensionSettings): ContentScriptSettings {
  const { obsidianApiKey, ...syncSettings } = settings;
  return {
    ...syncSettings,
    isApiKeyConfigured: obsidianApiKey.length > 0,
  };
}

/**
 * Route messages to appropriate handlers
 */
async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  if (isChatGptBridgeAction(message)) {
    return handleChatGptBridgeMessage(message);
  }

  if (message.action === 'updateOutputOptions') {
    outputOptionsOverride = { ...message.outputOptions };
    try {
      await saveSettings({ outputOptions: message.outputOptions });
      return { success: true };
    } catch {
      return { success: false, error: 'Could not save output settings' };
    }
  }

  const storedSettings = await getSettings();
  const settings = outputOptionsOverride
    ? { ...storedSettings, outputOptions: { ...outputOptionsOverride } }
    : storedSettings;

  switch (message.action) {
    case 'saveToOutputs':
      return handleMultiOutput(message.data, message.outputs, settings);

    case 'persistArchiveCompanion':
      return handlePersistArchiveCompanion(message, settings);

    case 'beginStagedBinaryAsset':
    case 'appendStagedBinaryAsset':
    case 'commitStagedBinaryAsset':
    case 'abortStagedBinaryAsset':
      return handleStagedBinaryAssetMessage(message, settings);

    case 'testConnection':
      return handleTestConnection(settings);

    case 'fetchImage':
      // Remote images the content script cannot fetch itself (CORS, issue #376).
      return handleFetchImage(message.url);

    case 'getSettings':
      // Security: Redact API key for content scripts (they run on third-party pages)
      return isContentScriptSender(sender) ? redactSettingsForContentScript(settings) : settings;

    default:
      return { success: false, error: 'Unknown action' };
  }
}

// Log when service worker starts
console.info('[G2O Background] Service worker started');
