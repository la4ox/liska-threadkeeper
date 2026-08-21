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
import { captureChatGptInTemporaryTab, ChatGptTemporaryCaptureError } from './chatgpt-capture';
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
    if (!isChatGptCaptureMessage(message) && hasOwnDataProperty(message, 'target', 'offscreen')) {
      return false;
    }

    // Sender validation (M-02)
    if (!validateSender(sender)) {
      console.warn('[G2O Background] Rejected message from unauthorized sender');
      sendResponse(captureFailureOr(message, { success: false, error: 'Unauthorized' }));
      return false;
    }

    // Message content validation (M-02)
    // A throw here would otherwise escape the listener and leave the sender
    // hanging without a response, so treat it as invalid content
    try {
      if (!validateMessageContent(message)) {
        console.warn('[G2O Background] Invalid message content');
        sendResponse(
          captureFailureOr(message, { success: false, error: 'Invalid message content' })
        );
        return false;
      }
    } catch (error) {
      console.warn('[G2O Background] Message validation threw:', getErrorMessage(error));
      sendResponse(captureFailureOr(message, { success: false, error: 'Invalid message content' }));
      return false;
    }

    if (!isAuthorizedChatGptCaptureRequest(message, sender)) {
      sendResponse(createChatGptCaptureFailure('capture-failed'));
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

function isChatGptCaptureMessage(message: unknown): boolean {
  return hasOwnDataProperty(message, 'action', 'captureChatGptConversation');
}

function captureFailureOr<T>(
  message: unknown,
  genericResponse: T
): T | ReturnType<typeof createChatGptCaptureFailure> {
  return isChatGptCaptureMessage(message)
    ? createChatGptCaptureFailure('capture-failed')
    : genericResponse;
}

function isAuthorizedChatGptCaptureRequest(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): boolean {
  return (
    message.action !== 'captureChatGptConversation' ||
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

async function handleChatGptCapture(conversationId: string) {
  if (!(await hasScriptingPermission())) {
    return createChatGptCaptureFailure('permission-unavailable');
  }

  let capture: Awaited<ReturnType<typeof captureChatGptInTemporaryTab>>;
  try {
    capture = await captureChatGptInTemporaryTab(conversationId);
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
      },
    };
    return isChatGptCaptureResponse(response)
      ? response
      : createChatGptCaptureFailure('unexpected-capture-result');
  } catch {
    return createChatGptCaptureFailure('capture-response-validation-exception');
  }
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
  if (message.action === 'captureChatGptConversation') {
    return handleChatGptCapture(message.conversationId);
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
