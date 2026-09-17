import { describe, expect, it } from 'vitest';
import { canonicalBase64ByteLength, isCanonicalBase64 } from '../../src/lib/base64';

describe('canonical base64 scanner', () => {
  it.each([
    ['', 0],
    ['Zg==', 1],
    ['Zm8=', 2],
    ['Zm9v', 3],
    ['AP8BgCo=', 5],
  ])('returns the decoded length for %j', (value, expected) => {
    expect(canonicalBase64ByteLength(value)).toBe(expected);
    expect(isCanonicalBase64(value)).toBe(true);
  });

  it.each(['A', 'A===', '=AAA', 'AA=A', 'AAAA\n', 'AAAA-', 'not base64!'])(
    'rejects non-canonical input %j',
    value => {
      expect(canonicalBase64ByteLength(value)).toBeUndefined();
      expect(isCanonicalBase64(value)).toBe(false);
    }
  );

  it('scans a multi-megabyte payload without a repeated-group regex', () => {
    const value = 'A'.repeat(4 * 1024 * 1024);
    expect(canonicalBase64ByteLength(value)).toBe(3 * 1024 * 1024);
  });
});
