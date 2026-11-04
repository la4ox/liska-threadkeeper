import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parsePreviewSession,
  previewMetadata,
  requestPreview,
} from '../../src/text-preview/protocol';
import { HREF, SESSION } from './helpers';
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('preview page protocol boundary', () => {
  it('accepts only the one canonical UUID query, never content or other URL fields', () => {
    expect(parsePreviewSession(HREF)).toBe(SESSION);
    expect(parsePreviewSession(HREF.replace('chrome-extension://', 'comet-extension://'))).toBe(
      SESSION
    );
    expect(parsePreviewSession('not a URL')).toBeUndefined();
    expect(parsePreviewSession(`${HREF}&text=body`)).toBeUndefined();
    expect(parsePreviewSession(`${HREF}#text`)).toBeUndefined();
    expect(parsePreviewSession(HREF.replace('4234', 'z234'))).toBeUndefined();
    expect(parsePreviewSession(HREF.replace('8234', '1234'))).toBeUndefined();
  });
  it.each([
    null,
    [],
    {},
    { success: true, state: 'unknown', expiresAt: Number.MAX_SAFE_INTEGER },
    { success: false, state: 'delivered', expiresAt: Number.MAX_SAFE_INTEGER },
    { success: true, state: 'delivered', expiresAt: Date.now() - 1 },
  ])('rejects unknown/invalid metadata %j', value => {
    expect(previewMetadata(value)).toBeUndefined();
  });
  it('sends exactly one request and surfaces a lost callback without retry', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(() => undefined as never);
    const promise = requestPreview({ action: 'takeTextPreviewPayload', sessionId: SESSION });
    const rejected = expect(promise).rejects.toThrow('preview-connection-unknown');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(chrome.runtime.sendMessage).toHaveBeenCalledOnce();
  });
  it('clears its timeout when sendMessage throws synchronously', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(() => {
      throw new Error('private runtime detail');
    });

    await expect(
      requestPreview({ action: 'getTextPreviewStatus', sessionId: SESSION })
    ).rejects.toThrow('preview-connection-unavailable');
    expect(vi.getTimerCount()).toBe(0);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledOnce();
  });
  it('handles a runtime callback and lastError without leaking native error text', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((_message, done) => {
      (done as (value: unknown) => void)({ success: true });
      return undefined as never;
    });
    await expect(
      requestPreview({ action: 'ackTextPreviewPayload', sessionId: SESSION, deliveryId: SESSION })
    ).resolves.toEqual({ success: true });
    Object.defineProperty(chrome.runtime, 'lastError', {
      configurable: true,
      writable: true,
      value: { message: 'private browser error' },
    });
    await expect(
      requestPreview({ action: 'getTextPreviewStatus', sessionId: SESSION })
    ).rejects.toThrow('preview-connection-unavailable');
  });
});
