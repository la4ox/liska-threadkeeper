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
const REDIRECT_URL = 'https://lh3.google.com/rd-gg/synthetic-image';

/** Synthetic Response constructors have an empty URL, unlike a real fetch response. */
function withResponseUrl(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

function responseFromChunks(
  chunks: Uint8Array[],
  type = 'image/png',
  extraHeaders: Record<string, string> = {},
  onCancel?: (reason: unknown) => void,
  status = 200,
  url = IMAGE_URL
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
  return withResponseUrl(new Response(body, { status, headers }), url);
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

  it('makes exactly one authenticated browser-managed request with bounded options', async () => {
    const spy = mockFetchResponse(responseFromChunks([new Uint8Array([1])]));

    await handleFetchImage(IMAGE_URL);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(IMAGE_URL, {
      credentials: 'include',
      referrerPolicy: 'no-referrer',
      redirect: 'follow',
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
  });

  it('accepts an exact lh3.google.com final response after the browser follows redirects', async () => {
    const spy = mockFetchResponse(
      responseFromChunks([new Uint8Array([1])], 'image/png', {}, undefined, 200, REDIRECT_URL)
    );

    await expect(handleFetchImage(IMAGE_URL)).resolves.toEqual({
      success: true,
      data: 'AQ==',
      mimeType: 'image/png',
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(IMAGE_URL);
  });

  it.each([
    REDIRECT_URL,
    'https://user@lh3.googleusercontent.com/x',
    'https://user:secret@lh3.googleusercontent.com/x',
    'https://lh3.googleusercontent.com:8443/x',
    'https://evilgoogleusercontent.com/x',
    'https://googleusercontent.com.evil.test/x',
    'http://lh3.googleusercontent.com/x',
  ])('rejects an invalid source before fetch: %s', async url => {
    const spy = mockFetchResponse(responseFromChunks([new Uint8Array([1])]));

    await expect(handleFetchImage(url)).resolves.toEqual({
      success: false,
      error: 'Image URL is not allowed',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    '',
    'not a url',
    'https://unexpected.test/private?secret=do-not-leak',
    'https://user:secret@lh3.googleusercontent.com/x',
    'https://user:secret@lh3.google.com/x',
    'https://lh3.googleusercontent.com:8443/x',
    'https://lh3.google.com:8443/x',
    'https://evilgoogleusercontent.com/x',
    'https://googleusercontent.com.evil.test/x',
    'https://lh3.google.com.evil.test/x',
    'https://sub.lh3.google.com/x',
    'https://lh4.google.com/x',
    'http://lh3.googleusercontent.com/x',
    'http://lh3.google.com/x',
  ])('cancels a rejected final URL before status, MIME or body processing: %s', async url => {
    const cancelled = vi.fn();
    const response = responseFromChunks(
      [new Uint8Array([1])],
      'image/svg+xml',
      {},
      cancelled,
      403,
      url
    );
    const statusRead = vi.spyOn(response, 'ok', 'get');
    const headersRead = vi.spyOn(response.headers, 'get');
    const bodyRead = vi.spyOn(response.body!, 'getReader');
    const spy = mockFetchResponse(response);

    await expect(handleFetchImage(IMAGE_URL)).resolves.toEqual({
      success: false,
      error: 'Image response URL is not allowed',
    });
    expect(cancelled).toHaveBeenCalledWith('Image response URL is not allowed');
    expect(statusRead).not.toHaveBeenCalled();
    expect(headersRead).not.toHaveBeenCalled();
    expect(bodyRead).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('preserves the final URL failure when cancellation rejects', async () => {
    mockFetchResponse(
      responseFromChunks(
        [new Uint8Array([1])],
        'image/png',
        {},
        () => {
          throw new Error('https://private.test/cancellation-secret');
        },
        200,
        'https://unexpected.test/x'
      )
    );

    await expect(handleFetchImage(IMAGE_URL)).resolves.toEqual({
      success: false,
      error: 'Image response URL is not allowed',
    });
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

  it('reports an authenticated 403 without anonymous retry or credential fallback', async () => {
    const spy = mockFetchResponse(withResponseUrl(new Response(null, { status: 403 }), IMAGE_URL));

    const result = await handleFetchImage(IMAGE_URL);

    expect(result.success).toBe(false);
    expect(result.error).toContain('403');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      IMAGE_URL,
      expect.objectContaining({ credentials: 'include' })
    );
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

  it.each([
    new TypeError('Failed to fetch https://private.test/?token=secret'),
    new Error('https://lh3.googleusercontent.com/private?signature=secret'),
    'untrusted raw rejection text',
  ])('returns a stable network failure without raw exception text or retries', async error => {
    const spy = vi.fn().mockRejectedValue(error);
    vi.stubGlobal('fetch', spy);

    await expect(handleFetchImage(IMAGE_URL)).resolves.toEqual({
      success: false,
      error: 'Image fetch failed',
    });
    expect(spy).toHaveBeenCalledTimes(1);
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
      withResponseUrl(
        new Response(null, { status: 200, headers: { 'content-type': 'image/png' } }),
        IMAGE_URL
      )
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
        withResponseUrl(
          new Response(body, { status: 200, headers: { 'content-type': 'image/png' } }),
          IMAGE_URL
        )
      );
    });
    vi.stubGlobal('fetch', spy);

    const pending = handleFetchImage(IMAGE_URL);
    await vi.advanceTimersByTimeAsync(5000);

    await expect(pending).resolves.toEqual({ success: false, error: 'Image fetch timed out' });
  });

  it('shares one five-second deadline across request and stalled body reads', async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const response = withResponseUrl(
      new Response(body, { headers: { 'content-type': 'image/png' } }),
      REDIRECT_URL
    );
    const spy = vi.fn(
      () => new Promise<Response>(resolve => setTimeout(() => resolve(response), 3000))
    );
    vi.stubGlobal('fetch', spy);

    const pending = handleFetchImage(IMAGE_URL);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(pending).resolves.toEqual({ success: false, error: 'Image fetch timed out' });
    expect(cancelled).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not expose a raw body-read exception', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('https://private.test/body-read-secret'));
      },
    });
    mockFetchResponse(
      withResponseUrl(new Response(body, { headers: { 'content-type': 'image/png' } }), IMAGE_URL)
    );

    await expect(handleFetchImage(IMAGE_URL)).resolves.toEqual({
      success: false,
      error: 'Image fetch failed',
    });
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
    expect(manifest.host_permissions).toContain('https://lh3.google.com/*');
    expect(manifest.host_permissions).not.toContain('https://*.google.com/*');
  });
});
