/** Return the UTF-8 wire size of a string. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Return the UTF-8 wire size Chrome uses after JSON message serialization. */
export function jsonUtf8ByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 0 : utf8ByteLength(serialized);
}
