/**
 * YAML safety utilities
 * Prevents YAML injection attacks
 */

/**
 * Escape a YAML string value
 * Compliant with YAML 1.2 spec; wraps in double quotes if special characters are present
 *
 * Handled special characters:
 * - YAML syntax characters: : [ ] { } # & * ! | > ' " % @ `
 * - Leading YAML indicators: ? ,
 * - Control characters: \n \r \t
 * - Other non-printable C0/C1 characters and forbidden Unicode sentinels
 * - Unicode line terminators: U+0085 (NEL), U+2028 (LS), U+2029 (PS)
 * - Reserved words: null, true, false, ~
 */
function requiresUnicodeEscape(codeUnit: number): boolean {
  return (
    codeUnit <= 0x08 ||
    codeUnit === 0x0b ||
    codeUnit === 0x0c ||
    (codeUnit >= 0x0e && codeUnit <= 0x1f) ||
    (codeUnit >= 0x7f && codeUnit <= 0x84) ||
    (codeUnit >= 0x86 && codeUnit <= 0x9f) ||
    codeUnit === 0xfeff ||
    codeUnit === 0xfffe ||
    codeUnit === 0xffff
  );
}

function containsUnicodeEscape(value: string): boolean {
  for (const character of value) {
    if (requiresUnicodeEscape(character.charCodeAt(0))) return true;
  }
  return false;
}

function escapeUnsupportedCharacters(value: string): string {
  let escaped = '';
  for (const character of value) {
    const codeUnit = character.charCodeAt(0);
    escaped += requiresUnicodeEscape(codeUnit)
      ? `\\u${codeUnit.toString(16).padStart(4, '0').toUpperCase()}`
      : character;
  }
  return escaped;
}

export function escapeYamlValue(value: string): string {
  // Check if quoting is needed
  const needsQuotes =
    /[:[\]{}#&*!|>'"%@`\n\r\t\u0085\u2028\u2029]/.test(value) ||
    containsUnicodeEscape(value) ||
    /^[?,]/.test(value) ||
    value.startsWith(' ') ||
    value.endsWith(' ') ||
    value === '' ||
    /^(null|true|false|~|yes|no|on|off)$/i.test(value) ||
    /^[0-9.+-]/.test(value); // Could be interpreted as a number

  if (!needsQuotes) {
    return value;
  }

  // Escape with double quotes
  const escaped = escapeUnsupportedCharacters(
    value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/\u0085/g, '\\N') // NEL (Next Line)
      .replace(/\u2028/g, '\\L') // LS (Line Separator)
      .replace(/\u2029/g, '\\P') // PS (Paragraph Separator)
  );

  return `"${escaped}"`;
}
