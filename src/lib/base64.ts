/**
 * Return the decoded byte length of canonical standard base64.
 *
 * This deliberately uses a bounded linear scan instead of a whole-string
 * regular expression: archive payloads can be tens of megabytes after base64
 * expansion, and some Chromium/V8 builds can throw while matching one giant
 * repeated regex group.
 */
export function canonicalBase64ByteLength(value: string): number | undefined {
  const length = value.length;
  if (length % 4 !== 0) return undefined;

  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const dataLength = length - padding;
  for (let index = 0; index < dataLength; index += 1) {
    const code = value.charCodeAt(index);
    const alphaNumeric =
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x30 && code <= 0x39);
    if (!alphaNumeric && code !== 0x2b && code !== 0x2f) return undefined;
  }
  for (let index = dataLength; index < length; index += 1) {
    if (value.charCodeAt(index) !== 0x3d) return undefined;
  }
  return (length / 4) * 3 - padding;
}

export function isCanonicalBase64(value: string): boolean {
  return canonicalBase64ByteLength(value) !== undefined;
}
