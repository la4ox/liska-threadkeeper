/** Yield between small manifest/key hashes; late work is never given report authority. */
export function cancellableSha256(signal: AbortSignal) {
  const check = () => {
    if (signal.aborted) throw new Error('catalog-operation-cancelled');
  };
  return async (bytes: Uint8Array): Promise<string> => {
    check();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    check();
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
    check();
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  };
}
