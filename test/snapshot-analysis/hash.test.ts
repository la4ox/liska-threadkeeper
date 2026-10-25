import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancellableSha256 } from '../../src/snapshot-analysis/hash';
import { deferred } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('cancellable local Web Crypto', () => {
  it('hashes the exact selected byte view', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const bytes = new TextEncoder().encode('xabcx').subarray(1, 4);
    await expect(cancellableSha256(new AbortController().signal)(bytes)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
  it('checks cancellation before yielding and before digest', async () => {
    vi.useFakeTimers();
    const digest = vi.fn();
    vi.stubGlobal('crypto', { subtle: { digest } });
    const controller = new AbortController();
    const hash = cancellableSha256(controller.signal);
    const pending = hash(new Uint8Array([1]));
    const rejected = expect(pending).rejects.toThrow('snapshot-operation-cancelled');
    controller.abort();
    await vi.runAllTimersAsync();
    await rejected;
    expect(digest).not.toHaveBeenCalled();
    await expect(hash(new Uint8Array())).rejects.toThrow('snapshot-operation-cancelled');
  });
  it('discards digest completion after cancellation', async () => {
    const pending = deferred<ArrayBuffer>();
    const digest = vi.fn(() => pending.promise);
    vi.stubGlobal('crypto', { subtle: { digest } });
    const controller = new AbortController();
    const result = cancellableSha256(controller.signal)(new Uint8Array([1]));
    await vi.waitFor(() => expect(digest).toHaveBeenCalledOnce());
    controller.abort();
    pending.resolve(new ArrayBuffer(32));
    await expect(result).rejects.toThrow('snapshot-operation-cancelled');
  });
});
