import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkerSenderCheck } from '../../src/offscreen/worker-sender';

const worker = 'service-worker-loader.js';
const manifest = { background: { service_worker: worker } };

function sender(): chrome.runtime.MessageSender {
  return { id: chrome.runtime.id, url: chrome.runtime.getURL(worker) };
}

describe('offscreen packaged worker identity', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify(manifest))
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reads only its own installed manifest once for concurrent checks without getManifest', async () => {
    const check = createWorkerSenderCheck();
    await expect(Promise.all([check(sender()), check(sender())])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(chrome.runtime.getURL('manifest.json'), {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
  });

  it('keeps shape rejections synchronous and performs no package read for them', () => {
    const check = createWorkerSenderCheck();
    expect(check({ id: 'other' })).toBe('offscreen-sender-extension');
    expect(check({ ...sender(), tab: {} as chrome.tabs.Tab })).toBe('offscreen-sender-tab');
    expect(check({ ...sender(), documentId: 'popup-document' })).toBe('offscreen-sender-document');
    expect(check({ id: chrome.runtime.id })).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { background: null },
    { background: { service_worker: 1 } },
    { background: { service_worker: '' } },
    { background: { service_worker: 'https://example.com/worker.js' } },
    { background: { service_worker: '//other-extension/worker.js' } },
    {
      background: { service_worker: 'chrome-extension://user:secret@test-extension-id/worker.js' },
    },
    { background: { service_worker: 'worker.js?secret=value' } },
    { background: { service_worker: 'worker.js#fragment' } },
  ])('rejects a missing or non-local worker entry: %j', async value => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(value)));
    await expect(createWorkerSenderCheck()(sender())).resolves.toBe(
      'offscreen-worker-entry-unavailable'
    );
  });

  it.each([404, 500])('fails closed on manifest HTTP status %i', async status => {
    vi.mocked(fetch).mockResolvedValue(new Response('unavailable', { status }));
    await expect(createWorkerSenderCheck()(sender())).resolves.toBe(
      'offscreen-worker-entry-unavailable'
    );
  });

  it('redacts invalid JSON and caches a failed read without retrying', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('private invalid JSON'));
    const check = createWorkerSenderCheck();
    await expect(check(sender())).resolves.toBe('offscreen-worker-entry-unavailable');
    await expect(check(sender())).resolves.toBe('offscreen-worker-entry-unavailable');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('bounds a stalled package read and never allows the sender after timeout', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('private error', 'AbortError')),
            { once: true }
          );
        })
    );
    const pending = createWorkerSenderCheck()(sender());
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toBe('offscreen-worker-entry-unavailable');
    expect(vi.getTimerCount()).toBe(0);
  });
});
