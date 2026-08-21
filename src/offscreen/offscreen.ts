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

import { BINARY_STAGE_CHUNK_BYTES, MAX_CONTENT_SIZE } from '../lib/constants';
import { canonicalBase64ByteLength } from '../lib/base64';
import { extractErrorMessage } from '../lib/error-utils';
import {
  decodeCanonicalBinaryChunk,
  isSafeBinaryStageId,
  isStagedBinaryAssetDescriptor,
} from '../lib/binary-asset-contract';
import { OpfsBinaryStageStore, type BinaryStageStore } from './binary-stage-store';
import type {
  ArchiveBlobCreateResponse,
  ArchiveBlobRevokeResponse,
  BinaryStageFinalizeResponse,
  BinaryStageResponse,
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
const binaryStageBlobUrls = new Map<string, string>();
let binaryStageStore: BinaryStageStore = new OpfsBinaryStageStore();

/** @internal Inject an exact OPFS fake in jsdom tests without changing production storage. */
export function setBinaryStageStoreForTesting(store: BinaryStageStore | undefined): void {
  binaryStageStore = store ?? new OpfsBinaryStageStore();
  binaryStageBlobUrls.clear();
}

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

function isBinaryStageBeginMessage(
  message: OffscreenMessage
): message is Extract<OffscreenMessage, { action: 'binaryStageBegin' }> {
  return (
    message.action === 'binaryStageBegin' &&
    message.target === 'offscreen' &&
    isSafeBinaryStageId(message.stageId) &&
    isStagedBinaryAssetDescriptor(message.descriptor)
  );
}

function isBinaryStageAppendMessage(
  message: OffscreenMessage
): message is Extract<OffscreenMessage, { action: 'binaryStageAppend' }> {
  return (
    message.action === 'binaryStageAppend' &&
    message.target === 'offscreen' &&
    isSafeBinaryStageId(message.stageId) &&
    Number.isSafeInteger(message.offset) &&
    message.offset >= 0 &&
    typeof message.chunkBase64 === 'string'
  );
}

function isBinaryStageFinalizeMessage(
  message: OffscreenMessage
): message is Extract<OffscreenMessage, { action: 'binaryStageFinalize' }> {
  return (
    message.action === 'binaryStageFinalize' &&
    message.target === 'offscreen' &&
    isSafeBinaryStageId(message.stageId) &&
    isStagedBinaryAssetDescriptor(message.descriptor)
  );
}

function isBinaryStageReleaseMessage(
  message: OffscreenMessage
): message is Extract<OffscreenMessage, { action: 'binaryStageRelease' }> {
  return (
    message.action === 'binaryStageRelease' &&
    message.target === 'offscreen' &&
    isSafeBinaryStageId(message.stageId) &&
    typeof message.url === 'string' &&
    message.url.startsWith('blob:')
  );
}

function isBinaryStageAbortMessage(
  message: OffscreenMessage
): message is Extract<OffscreenMessage, { action: 'binaryStageAbort' }> {
  return (
    message.action === 'binaryStageAbort' &&
    message.target === 'offscreen' &&
    isSafeBinaryStageId(message.stageId)
  );
}

async function handleBinaryStageMessage(
  message: OffscreenMessage
): Promise<BinaryStageResponse | BinaryStageFinalizeResponse | undefined> {
  if (isBinaryStageBeginMessage(message)) {
    await binaryStageStore.begin(message.stageId, message.descriptor);
    return { success: true };
  }
  if (isBinaryStageAppendMessage(message)) {
    const bytes = decodeCanonicalBinaryChunk(message.chunkBase64);
    if (!bytes || bytes.byteLength > BINARY_STAGE_CHUNK_BYTES) {
      return { success: false, error: 'Invalid binary stage chunk' };
    }
    await binaryStageStore.append(message.stageId, message.offset, bytes);
    return { success: true };
  }
  if (isBinaryStageFinalizeMessage(message)) {
    const file = await binaryStageStore.finalize(message.stageId, message.descriptor);
    const url = URL.createObjectURL(file);
    binaryStageBlobUrls.set(url, message.stageId);
    return { success: true, url };
  }
  if (isBinaryStageReleaseMessage(message)) {
    if (binaryStageBlobUrls.get(message.url) !== message.stageId) {
      return { success: false, error: 'Unknown binary stage' };
    }
    try {
      URL.revokeObjectURL(message.url);
    } finally {
      binaryStageBlobUrls.delete(message.url);
      await binaryStageStore.abort(message.stageId);
    }
    return { success: true };
  }
  if (isBinaryStageAbortMessage(message)) {
    await binaryStageStore.abort(message.stageId);
    return { success: true };
  }
  return undefined;
}

type OffscreenResponse =
  | ClipboardWriteResponse
  | ArchiveBlobCreateResponse
  | ArchiveBlobRevokeResponse
  | BinaryStageResponse
  | BinaryStageFinalizeResponse;
type SendOffscreenResponse = (response: OffscreenResponse) => void;

function handleClipboardMessage(
  message: OffscreenMessage,
  sendResponse: SendOffscreenResponse
): boolean {
  if (message.action !== 'clipboardWrite' || message.target !== 'offscreen') return false;
  try {
    const success = handleClipboardWrite(message.content);
    sendResponse(
      success ? { success: true } : { success: false, error: 'execCommand copy failed' }
    );
  } catch (error) {
    sendResponse({ success: false, error: extractErrorMessage(error) });
  }
  return true;
}

function handleArchiveBlobMessage(
  message: OffscreenMessage,
  sendResponse: SendOffscreenResponse
): boolean {
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
  if (message.action !== 'archiveBlobRevoke' || message.target !== 'offscreen') return false;
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

function isBinaryStageAction(message: OffscreenMessage): boolean {
  return [
    'binaryStageBegin',
    'binaryStageAppend',
    'binaryStageFinalize',
    'binaryStageRelease',
    'binaryStageAbort',
  ].includes(message.action);
}

function handleBinaryMessage(
  message: OffscreenMessage,
  sendResponse: SendOffscreenResponse
): boolean {
  if (!isBinaryStageAction(message)) return false;
  void handleBinaryStageMessage(message).then(
    response => {
      sendResponse(response ?? { success: false, error: 'Invalid binary stage request' });
    },
    () => sendResponse({ success: false, error: 'Binary stage operation failed' })
  );
  return true;
}

/** Accept only extension-owned non-content-script messages for this hidden page. */
function onOffscreenMessage(
  message: OffscreenMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendOffscreenResponse
): boolean {
  if (sender.id !== chrome.runtime.id || sender.tab !== undefined) return false;
  return (
    handleClipboardMessage(message, sendResponse) ||
    handleArchiveBlobMessage(message, sendResponse) ||
    handleBinaryMessage(message, sendResponse)
  );
}

chrome.runtime.onMessage.addListener(onOffscreenMessage);

console.info('[G2O Offscreen] Document loaded');
