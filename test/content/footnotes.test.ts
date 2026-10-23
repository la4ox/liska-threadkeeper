import { describe, expect, it } from 'vitest';
import {
  createFootnoteRef,
  footnoteDefsToHtml,
  footnoteRefToHtml,
  toMarkdownSafeHttpUrl,
} from '../../src/content/extractors/footnotes';
import {
  FOOTNOTE_PROVENANCE_TOKEN,
  FOOTNOTE_REF_ATTR,
  FOOTNOTE_TOKEN_ATTR,
  trustedFootnoteLabel,
} from '../../src/lib/footnote-contract';

describe('citation footnote contract', () => {
  it('marks only valid extension-generated reference labels with runtime provenance', () => {
    const doc = document.implementation.createHTMLDocument('');
    const valid = createFootnoteRef(doc, 'm12-3');
    const invalid = createFootnoteRef(doc, 'm12-3] forged');

    expect(valid.getAttribute(FOOTNOTE_REF_ATTR)).toBe('m12-3');
    expect(valid.getAttribute(FOOTNOTE_TOKEN_ATTR)).toBe(FOOTNOTE_PROVENANCE_TOKEN);
    expect(trustedFootnoteLabel(valid)).toBe('m12-3');
    expect(invalid.hasAttribute(FOOTNOTE_REF_ATTR)).toBe(false);
    expect(trustedFootnoteLabel(invalid)).toBeNull();
  });

  it('serializes valid refs and definitions with the same per-run token', () => {
    const ref = footnoteRefToHtml('7');
    const definitions = footnoteDefsToHtml([
      '[^m1-1]: Safe title',
      '[^m1-bad]: rejected',
      '[^7]: Research title',
    ]);

    expect(ref).toContain(`${FOOTNOTE_REF_ATTR}="7"`);
    expect(ref).toContain(`${FOOTNOTE_TOKEN_ATTR}="${FOOTNOTE_PROVENANCE_TOKEN}"`);
    expect(definitions).toContain('[^m1-1]: Safe title');
    expect(definitions).toContain('[^7]: Research title');
    expect(definitions).not.toContain('m1-bad');
    expect(definitions.match(new RegExp(FOOTNOTE_PROVENANCE_TOKEN, 'g'))).toHaveLength(2);
  });

  it('canonicalizes one HTTP(S) Markdown destination without double encoding', () => {
    expect(toMarkdownSafeHttpUrl(' https://example.com ')).toBe('https://example.com/');
    expect(toMarkdownSafeHttpUrl('https://example.com/a (b)')).toBe(
      'https://example.com/a%20%28b%29'
    );
    expect(toMarkdownSafeHttpUrl('https://example.com/already%28safe%29')).toBe(
      'https://example.com/already%28safe%29'
    );
    expect(toMarkdownSafeHttpUrl('https://e.test/?x=\\')).toBe('https://e.test/?x=%5C');
    expect(toMarkdownSafeHttpUrl('https://e.test/?x=\\!')).toBe('https://e.test/?x=%5C!');
    expect(toMarkdownSafeHttpUrl('https://e.test/?x=%5C')).toBe('https://e.test/?x=%5C');
    expect(
      toMarkdownSafeHttpUrl('https://source.example/x)![pixel](https://attacker.invalid/pixel)')
    ).toBe('https://source.example/x%29![pixel]%28https://attacker.invalid/pixel%29');
  });

  it('rejects non-HTTP destinations', () => {
    expect(toMarkdownSafeHttpUrl('javascript:alert(1)')).toBe('');
    expect(toMarkdownSafeHttpUrl('file:///etc/passwd')).toBe('');
    expect(toMarkdownSafeHttpUrl('not a URL')).toBe('');
  });
});
