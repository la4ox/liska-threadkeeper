import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_ANALYSIS_HARD_LIMITS,
  SnapshotAnalysisError,
} from '../../src/archive/snapshots/contracts';
import { parseSnapshotJson } from '../../src/archive/snapshots/strict-json';

const encode = (text: string) => new TextEncoder().encode(text);
const limits = { ...SNAPSHOT_ANALYSIS_HARD_LIMITS };

function parse(text: string, overrides = {}) {
  return parseSnapshotJson(encode(text), { ...limits, ...overrides });
}

describe('snapshot strict JSON: grammar and byte fidelity', () => {
  it.each([
    'null',
    'true',
    'false',
    '0',
    '-0',
    '-12.5e+2',
    '"🦊 猫"',
    '[]',
    '{}',
    '{"a":[0,null,{"b":"\\u0041"}]}',
  ])('accepts valid JSON %s', text => {
    expect(parse(text)).toEqual(JSON.parse(text));
  });

  it.each([
    '',
    ' ',
    'undefined',
    'NaN',
    'Infinity',
    '1e9999',
    '+1',
    '.5',
    '01',
    '-01',
    '1.',
    '1e',
    '1e+',
    '[1,]',
    '{"a":1,}',
    '{a:1}',
    'true false',
    '"bad\nline"',
    '"\\x20"',
    '"\\u12"',
    '"unfinished',
    '/*comment*/{}',
  ])('rejects malformed JSON %s', text => {
    expect(() => parse(text)).toThrow(SnapshotAnalysisError);
  });

  it.each(['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"nested":[{"x":1,"x":2}]}'])(
    'rejects duplicate decoded keys %s',
    text => {
      expect(() => parse(text)).toThrow(/duplicate-json-key/);
    }
  );

  it.each(['__proto__', 'constructor', 'prototype'])(
    'refuses unsafe key %s without dropping it',
    key => {
      expect(() => parse(`{"${key}":{}}`)).toThrow(/unsafe-json-key/);
    }
  );

  it('rejects BOM and malformed UTF-8 rather than replacement decoding', () => {
    expect(() => parseSnapshotJson(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), limits)).toThrow(
      /invalid-json/
    );
    expect(() => parseSnapshotJson(new Uint8Array([0x22, 0xc0, 0xaf, 0x22]), limits)).toThrow(
      /invalid-json/
    );
  });

  it('accepts explicit escaped control characters while rejecting raw ones', () => {
    expect(parse('"\\n\\t\\r\\b\\f\\/\\\\\\\""')).toBe('\n\t\r\b\f/\\"');
    expect(() => parse('"\u0001"')).toThrow(/invalid-json/);
  });
});

describe('snapshot strict JSON: exact lower-only work boundaries', () => {
  it('caps bytes at the exact boundary', () => {
    expect(parse('{}', { maxFileBytes: 2 })).toEqual({});
    expect(() => parse('{}', { maxFileBytes: 1 })).toThrow(/limit-exceeded/);
  });

  it('caps container depth at the exact boundary', () => {
    expect(parse('[[]]', { maxJsonDepth: 2 })).toEqual([[]]);
    expect(() => parse('[[]]', { maxJsonDepth: 1 })).toThrow(/limit-exceeded/);
    expect(parse('0', { maxJsonDepth: 0 })).toBe(0);
  });

  it('counts object keys, containers and primitive values', () => {
    expect(parse('{"a":0}', { maxJsonValues: 3 })).toEqual({ a: 0 });
    expect(() => parse('{"a":0}', { maxJsonValues: 2 })).toThrow(/limit-exceeded/);
  });

  it('counts decoded string UTF-16 units including keys and escaped equivalents', () => {
    expect(parse('{"a":"\\u0062🦊"}', { maxJsonStringCodeUnits: 4 })).toEqual({ a: 'b🦊' });
    expect(() => parse('{"a":"\\u0062🦊"}', { maxJsonStringCodeUnits: 3 })).toThrow(
      /limit-exceeded/
    );
  });

  it('accounts complete source work including trailing whitespace', () => {
    expect(parse('{} ', { maxJsonWork: 3 })).toEqual({});
    expect(() => parse('{} ', { maxJsonWork: 2 })).toThrow(/limit-exceeded/);
  });

  it('shares aggregate work budgets across independent files', () => {
    const budget = { values: 0, stringCodeUnits: 0, work: 0 };
    const constrained = { ...limits, maxJsonValues: 2, maxJsonWork: 4 };
    parseSnapshotJson(encode('[]'), constrained, budget);
    parseSnapshotJson(encode('[]'), constrained, budget);
    expect(() => parseSnapshotJson(encode('0'), constrained, budget)).toThrow(/limit-exceeded/);
  });
});
