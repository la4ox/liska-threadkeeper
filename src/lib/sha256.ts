/** SHA-256 helper shared by browser-side identity and integrity boundaries. */
export async function sha256Hex(
  bytes: Uint8Array,
  cryptoApi: Crypto | undefined = globalThis.crypto
): Promise<string> {
  if (!cryptoApi?.subtle) throw new Error('Web Crypto SHA-256 is unavailable.');
  const exact = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const digest = await cryptoApi.subtle.digest('SHA-256', exact);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
