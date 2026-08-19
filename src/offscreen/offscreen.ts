/**
 * Offscreen Document Script
 * Handles clipboard operations that require DOM access
 *
 * Note: Offscreen documents can only use chrome.runtime API
 *
 * Implementation uses document.execCommand('copy') instead of navigator.clipboard.writeText()
 * because offscreen documents cannot be focused, and navigator.clipboard requires focus.
 * See: https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers
 * See: https://github.com/GoogleChrome/developer.chrome.com/issues/4660
 */

import { MAX_CONTENT_SIZE } from '../lib/constants';
import { canonicalBase64ByteLength } from '../lib/base64';
import { extractErrorMessage } from '../lib/error-utils';
import type {
  ArchiveBlobCreateResponse,
  ArchiveBlobRevokeResponse,
  ClipboardWriteResponse,
  OffscreenMessage,
} from '../lib/types';

/**
 * Handle clipboard write request using document.execCommand
 *
 * This is the Chrome-recommended approach for clipboard operations in offscreen documents.
 * navigator.clipboard.writeText() fails with "Document is not focused" error
 * because offscreen documents cannot receive focus by design.
 */
function handleClipboardWrite(content: string): boolean {
  const textarea = document.querySelector('#clipboard-textarea') as HTMLTextAreaElement | null;

  if (!textarea) {
    throw new Error('Clipboard textarea element not found');
  }

  textarea.value = content;
  textarea.select();

  // execCommand is deprecated but is the only working method in offscreen documents
  const success = document.execCommand('copy');

  // Clear the textarea after copy
  textarea.value = '';

  return success;
}

const archiveBlobUrls = new Set<string>();

function decodeArchiveBytes(base64: string): Uint8Array {
  const expectedLength = canonicalBase64ByteLength(base64);
  if (expectedLength === undefined) throw new Error('invalid archive bytes');
  if (expectedLength > MAX_CONTENT_SIZE) {
    throw new Error('archive bytes exceed the safety limit');
  }
  const binary = atob(base64);
  if (binary.length !== expectedLength || btoa(binary) !== base64) {
    throw new Error('invalid archive bytes');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function createArchiveBlobUrl(bodyBase64: string, mediaType: string): string {
  if (mediaType !== 'application/json') throw new Error('invalid archive media type');
  const bytes = decodeArchiveBytes(bodyBase64);
  const exact = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([exact], { type: mediaType }));
  archiveBlobUrls.add(url);
  return url;
}

function revokeArchiveBlobUrl(url: string): boolean {
  if (!archiveBlobUrls.delete(url)) return false;
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Message listener for clipboard operations
 */
chrome.runtime.onMessage.addListener(
  (
    message: OffscreenMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (
      response: ClipboardWriteResponse | ArchiveBlobCreateResponse | ArchiveBlobRevokeResponse
    ) => void
  ) => {
    // Security: only accept messages from this extension's own non-content-script
    // contexts (service worker or popup). `sender.tab` is undefined for those and
    // defined for content scripts, so this rejects any page-injected sender. In
    // practice only the background worker sends `clipboardWrite`; the action +
    // `target === 'offscreen'` gate below scopes it further.
    if (sender.id !== chrome.runtime.id || sender.tab !== undefined) {
      return false;
    }

    // Only handle messages targeted at offscreen document
    if (message.action === 'clipboardWrite' && message.target === 'offscreen') {
      try {
        const success = handleClipboardWrite(message.content);
        if (success) {
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'execCommand copy failed' });
        }
      } catch (error) {
        sendResponse({
          success: false,
          error: extractErrorMessage(error),
        });
      }
      return true; // Indicates async response
    }

    if (message.action === 'archiveBlobCreate' && message.target === 'offscreen') {
      try {
        sendResponse({
          success: true,
          url: createArchiveBlobUrl(message.bodyBase64, message.mediaType),
        });
      } catch {
        sendResponse({ success: false, error: 'Could not prepare archive download' });
      }
      return true;
    }

    if (message.action === 'archiveBlobRevoke' && message.target === 'offscreen') {
      try {
        const revoked = revokeArchiveBlobUrl(message.url);
        sendResponse(
          revoked ? { success: true } : { success: false, error: 'Unknown archive Blob URL' }
        );
      } catch {
        sendResponse({ success: false, error: 'Could not release archive download' });
      }
      return true;
    }
    return false;
  }
);

console.info('[G2O Offscreen] Document loaded');
