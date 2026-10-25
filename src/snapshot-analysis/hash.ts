import { throwIfCancelled } from './selection';

/** Yield between hashes; synchronous parsing and an active digest cannot be aborted instantly. */
export function cancellableSha256(signal: AbortSignal) {
  return async (bytes: Uint8Array): Promise<string> => {
    throwIfCancelled(signal);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    throwIfCancelled(signal);
    const owned = new Uint8Array(bytes);
    const digest = await crypto.subtle.digest('SHA-256', owned.buffer);
    throwIfCancelled(signal);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  };
}
