/**
 * Remote image fetching for the background service worker.
 *
 * Gemini serves generated images from googleusercontent.com, which sends no
 * `Access-Control-Allow-Origin` header. Per Chrome's network-request docs,
 * "cross-origin requests are always treated as such in content scripts, even if
 * the extension has host permissions" — so the in-page fetch was blocked and
 * every generated image was silently dropped (issue #376). The service worker
 * IS granted the exemption, so remote images are fetched here instead.
 */

import {
  MAX_IMAGE_SIZE_BYTES,
  bytesToBase64,
  isAllowedImageMime,
  isAllowedImageSourceUrl,
} from '../lib/image-utils';
import { DEFAULT_API_TIMEOUT } from '../lib/constants';
import { extractErrorMessage } from '../lib/error-utils';
import type { ImageFetchResponse } from '../lib/types';

/** Blobs from the CDN often omit a type; `<img>` renders them as PNG. */
const DEFAULT_IMAGE_MIME = 'image/png';
const IMAGE_SIZE_LIMIT_ERROR = 'Image exceeds the size limit';
const IMAGE_BODY_UNAVAILABLE_ERROR = 'Image response body is unavailable';

function failure(error: string): ImageFetchResponse {
  return { success: false, error };
}

/** Keep a stable primary failure even when transport cancellation also fails. */
function cancelImageBody(
  target: ReadableStream<Uint8Array> | ReadableStreamDefaultReader<Uint8Array>,
  reason: string
): void {
  try {
    void target.cancel(reason).catch(() => undefined);
  } catch {
    // Cancellation is best-effort; the size/timeout/MIME failure remains authoritative.
  }
}

function declaredImageLength(response: Response): number | null {
  const value = response.headers.get('content-length')?.trim();
  if (!value || !/^\d+$/.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : null;
}

function readImageChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));

  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    void reader.read().then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

/** Read only the bytes the worker is willing to retain and return through messaging. */
async function readBoundedImageBytes(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const declaredLength = declaredImageLength(response);
  if (declaredLength !== null && declaredLength > MAX_IMAGE_SIZE_BYTES) {
    if (response.body) cancelImageBody(response.body, IMAGE_SIZE_LIMIT_ERROR);
    throw new Error(IMAGE_SIZE_LIMIT_ERROR);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error(IMAGE_BODY_UNAVAILABLE_ERROR);

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await readImageChunk(reader, signal);
      if (next.done) break;
      if (next.value.byteLength > MAX_IMAGE_SIZE_BYTES - totalBytes) {
        cancelImageBody(reader, IMAGE_SIZE_LIMIT_ERROR);
        throw new Error(IMAGE_SIZE_LIMIT_ERROR);
      }
      chunks.push(next.value);
      totalBytes += next.value.byteLength;
    }
  } catch (error) {
    cancelImageBody(reader, 'Image response read failed');
    throw error;
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Fetch a remote image and return it as base64.
 *
 * The URL is re-validated here rather than trusting the message boundary
 * alone: this worker can reach hosts the page cannot, so an unchecked URL
 * would turn it into an SSRF proxy.
 *
 * @param url - Absolute https URL on the image CDN allow-list
 */
export async function handleFetchImage(url: string): Promise<ImageFetchResponse> {
  if (!isAllowedImageSourceUrl(url)) {
    return failure('Image URL is not allowed');
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DEFAULT_API_TIMEOUT);

  try {
    // credentials: 'include' — the page's <img> loads these URLs with cookies;
    // without them the CDN answers 403. Host permissions make this legal.
    const response = await fetch(url, { credentials: 'include', signal: controller.signal });
    if (!response.ok) {
      if (response.body) cancelImageBody(response.body, 'Image fetch returned an error status');
      return failure(`Image fetch failed: HTTP ${response.status}`);
    }

    const mimeType = response.headers.get('content-type')?.trim() || DEFAULT_IMAGE_MIME;
    if (!isAllowedImageMime(mimeType)) {
      if (response.body) cancelImageBody(response.body, 'Unsupported image type');
      return failure(`Unsupported image type: ${mimeType}`);
    }

    const bytes = await readBoundedImageBytes(response, controller.signal);
    return { success: true, data: bytesToBase64(bytes), mimeType };
  } catch (error) {
    if (timedOut) return failure('Image fetch timed out');
    return failure(extractErrorMessage(error));
  } finally {
    clearTimeout(timeout);
  }
}
