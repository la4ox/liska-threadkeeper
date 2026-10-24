/**
 * Background image fetch (issue #376).
 *
 * Gemini serves generated images from googleusercontent.com with no
 * `Access-Control-Allow-Origin` header. Chrome content scripts are subject to
 * CORS even when the extension holds host permissions, so the in-page fetch is
 * blocked and every generated image was silently dropped. The background worker
 * is exempt, so the fetch moves here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleFetchImage } from '../../src/background/image-fetch';
import { MAX_IMAGE_SIZE_BYTES } from '../../src/lib/image-utils';

const IMAGE_URL = 'https://lh3.googleusercontent.com/gg/AbC123=s1024-rj';

function responseFromChunks(
  chunks: Uint8Array[],
  type = 'image/png',
  extraHeaders: Record<string, string> = {},
  onCancel?: (reason: unknown) => void,
  status = 200
): Response {
  let index = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(chunks[index]);
        index += 1;
      },
      cancel: onCancel,
    },
    { highWaterMark: 0 }
  );
  const headers = new Headers(extraHeaders);
  if (type) headers.set('content-type', type);
  return new Response(body, { status, headers });
}

function mockFetchResponse(response: Response): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('handleFetchImage', () => {
  it('fetches an allow-listed image and returns base64 data', async () => {
    mockFetchResponse(responseFromChunks([new Uint8Array([0x50, 0x4e, 0x47])]));

    const result = await handleFetchImage(IMAGE_URL);

    expect(result).toEqual({ success: true, data: 'UE5H', mimeType: 'image/png' });
  });

  it('sends credentials so cookie-gated CDN URLs resolve', async () => {
    // The <img> on the page loads these URLs with cookies; an extension fetch
    // without them gets 403. Host permissions let the worker send them.
    const spy = mockFetchResponse(responseFromChunks([new Uint8Array([1])]));

    await handleFetchImage(IMAGE_URL);

    expect(spy).toHaveBeenCalledWith(
      IMAGE_URL,
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('defaults to image/png when the response carries no type', async () => {
    mockFetchResponse(responseFromChunks([new Uint8Array([1, 2, 3])], ''));

    const result = await handleFetchImage(IMAGE_URL);

    expect(result).toMatchObject({ success: true, mimeType: 'image/png' });
  });

  it('refuses a URL outside the allow-list without issuing a request', async () => {
    const spy = mockFetchResponse(responseFromChunks([new Uint8Array([1])]));

    const result = await handleFetchImage('https://127.0.0.1:27123/vault/secret.md');

    expect(result.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a blob URL (the content script owns that path)', async () => {
    const result = await handleFetchImage('blob:https://gemini.google.com/abc');

    expect(result.success).toBe(false);
  });

  it('reports a failed response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

    const result = await handleFetchImage(IMAGE_URL);

    expect(result.success).toBe(false);
    expect(result.error).toContain('403');
  });

  it('cancels an unread error response body', async () => {
    const cancelled = vi.fn();
    mockFetchResponse(responseFromChunks([new Uint8Array([1])], 'image/png', {}, cancelled, 403));

    await expect(handleFetchImage(IMAGE_URL)).resolves.toEqual({
      success: false,
      error: 'Image fetch failed: HTTP 403',
    });
    expect(cancelled).toHaveBeenCalled();
  });

  it('reports a network error instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const result = await handleFetchImage(IMAGE_URL);

    expect(result.success).toBe(false);
  });

  it('aborts a stalled image request after the bounded timeout', async () => {
    vi.useFakeTimers();
    const spy = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    );
    vi.stubGlobal('fetch', spy);

    const pending = handleFetchImage(IMAGE_URL);
    await vi.advanceTimersByTimeAsync(5000);

    await expect(pending).resolves.toEqual({ success: false, error: 'Image fetch timed out' });
    expect(spy).toHaveBeenCalledWith(
      IMAGE_URL,
      expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) })
    );
  });

  it('rejects an image above the size cap', async () => {
    const cancelled = vi.fn();
    mockFetchResponse(
      responseFromChunks(
        [new Uint8Array([1])],
        'image/png',
        {
          'content-length': String(MAX_IMAGE_SIZE_BYTES + 1),
        },
        cancelled
      )
    );

    const result = await handleFetchImage(IMAGE_URL);

    expect(result).toEqual({ success: false, error: 'Image exceeds the size limit' });
    expect(cancelled).toHaveBeenCalled();
  });

  it('rejects a MIME type outside the image allow-list', async () => {
    const cancelled = vi.fn();
    mockFetchResponse(responseFromChunks([new Uint8Array([1])], 'image/svg+xml', {}, cancelled));

    const result = await handleFetchImage(IMAGE_URL);

    expect(result).toEqual({ success: false, error: 'Unsupported image type: image/svg+xml' });
    expect(cancelled).toHaveBeenCalled();
  });

  it('accepts the exact byte cap across multiple chunks', async () => {
    const first = new Uint8Array(MAX_IMAGE_SIZE_BYTES - 1);
    const last = new Uint8Array([0xff]);
    mockFetchResponse(responseFromChunks([first, last], 'image/webp'));

    const result = await handleFetchImage(IMAGE_URL);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.mimeType).toBe('image/webp');
      expect(result.data.length).toBe(4 * Math.ceil(MAX_IMAGE_SIZE_BYTES / 3));
    }
  });

  it('cancels as soon as streamed bytes cross the cap despite a false small length', async () => {
    const cancelled = vi.fn();
    mockFetchResponse(
      responseFromChunks(
        [new Uint8Array(MAX_IMAGE_SIZE_BYTES), new Uint8Array([1])],
        'image/png',
        { 'content-length': '1' },
        cancelled
      )
    );

    const result = await handleFetchImage(IMAGE_URL);

    expect(result).toEqual({ success: false, error: 'Image exceeds the size limit' });
    expect(cancelled).toHaveBeenCalled();
  });

  it('does not replace the size failure when stream cancellation also fails', async () => {
    const response = responseFromChunks(
      [new Uint8Array(MAX_IMAGE_SIZE_BYTES), new Uint8Array([1])],
      'image/png',
      {},
      () => {
        throw new Error('cancel failed');
      }
    );
    mockFetchResponse(response);

    await expect(handleFetchImage(IMAGE_URL)).resolves.toEqual({
      success: false,
      error: 'Image exceeds the size limit',
    });
  });

  it('fails closed when a successful response exposes no readable body', async () => {
    mockFetchResponse(
      new Response(null, { status: 200, headers: { 'content-type': 'image/png' } })
    );

    await expect(handleFetchImage(IMAGE_URL)).resolves.toEqual({
      success: false,
      error: 'Image response body is unavailable',
    });
  });

  it('keeps the timeout active while the response body is stalled', async () => {
    vi.useFakeTimers();
    const spy = vi.fn((_url: string, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () =>
            controller.error(new DOMException('Aborted', 'AbortError'))
          );
        },
      });
      return Promise.resolve(
        new Response(body, { status: 200, headers: { 'content-type': 'image/png' } })
      );
    });
    vi.stubGlobal('fetch', spy);

    const pending = handleFetchImage(IMAGE_URL);
    await vi.advanceTimersByTimeAsync(5000);

    await expect(pending).resolves.toEqual({ success: false, error: 'Image fetch timed out' });
  });

  it('keeps MIME parameters on a valid image response', async () => {
    mockFetchResponse(
      responseFromChunks([new Uint8Array([0xff, 0xd8, 0xff])], 'Image/JPEG; charset=binary')
    );

    await expect(handleFetchImage(IMAGE_URL)).resolves.toEqual({
      success: true,
      data: '/9j/',
      mimeType: 'Image/JPEG; charset=binary',
    });
  });
});

describe('manifest', () => {
  it('grants host permission for the image CDN the handler fetches', () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/manifest.json'), 'utf-8')) as {
      host_permissions: string[];
    };

    // Without this, the background fetch is blocked too and the move is pointless.
    expect(manifest.host_permissions).toContain('https://*.googleusercontent.com/*');
  });
});
