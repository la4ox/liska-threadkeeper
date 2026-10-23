/** Internal citation-footnote provenance shared by extractors and Markdown rules. */

export const FOOTNOTE_REF_ATTR = 'data-footnote-ref';
export const FOOTNOTE_DEF_ATTR = 'data-footnote-def';
export const FOOTNOTE_TOKEN_ATTR = 'data-liska-footnote-token';

const FOOTNOTE_LABEL_PATTERN = /^(?:\d+|m\d+-\d+)$/;

function createFootnoteToken(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let token = '';
  for (const byte of bytes) token += byte.toString(16).padStart(2, '0');
  return token;
}

/** Per-isolated-world capability value; never serialized into final Markdown. */
export const FOOTNOTE_PROVENANCE_TOKEN = createFootnoteToken();

export function isValidFootnoteLabel(value: string): boolean {
  return FOOTNOTE_LABEL_PATTERN.test(value);
}

export function markTrustedFootnote(element: Element): void {
  element.setAttribute(FOOTNOTE_TOKEN_ATTR, FOOTNOTE_PROVENANCE_TOKEN);
}

export function hasTrustedFootnoteProvenance(element: Element): boolean {
  return element.getAttribute(FOOTNOTE_TOKEN_ATTR) === FOOTNOTE_PROVENANCE_TOKEN;
}

export function trustedFootnoteLabel(element: Element): string | null {
  if (!hasTrustedFootnoteProvenance(element)) return null;
  const label = element.getAttribute(FOOTNOTE_REF_ATTR);
  return label && isValidFootnoteLabel(label) ? label : null;
}

export function trustedFootnoteDefinition(element: Element): string | null {
  if (!hasTrustedFootnoteProvenance(element)) return null;
  const text = (element.textContent ?? '').trim();
  const match = /^\[\^([^\]]+)\]:(?:\s|$)/.exec(text);
  return match && isValidFootnoteLabel(match[1]) ? text : null;
}
