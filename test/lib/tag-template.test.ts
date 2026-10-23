import { describe, expect, it } from 'vitest';
import { jsonUtf8ByteLength } from '../../src/lib/byte-size';
import {
  defaultTagTemplates,
  isCanonicalTagTemplates,
  normalizeTagTemplates,
  parseTagTemplates,
  resolveTagTemplates,
} from '../../src/lib/tag-template';

describe('bounded tag templates', () => {
  it('uses fresh ordered defaults for missing, empty, and invalid lists', () => {
    const expected = ['ai-conversation', '{platform}'];
    for (const value of [undefined, null, [], '', ['a,b'], ['a', 'A']]) {
      expect(normalizeTagTemplates(value, 'conversation')).toEqual(expected);
    }
    const first = defaultTagTemplates('conversation');
    first.push('mutated');
    expect(defaultTagTemplates('conversation')).toEqual(expected);
    expect(parseTagTemplates('   ', 'deep-research')).toEqual({
      ok: true,
      tags: ['ai-research', 'deep-research', '{platform}'],
    });
    const input = ['Own'];
    const copy = normalizeTagTemplates(input, 'conversation');
    copy.push('mutated');
    expect(input).toEqual(['Own']);
  });

  it('normalizes hashtags and whitespace, supports Unicode/nesting, and keeps first spelling', () => {
    expect(parseTagTemplates('hello, # hello, ##  HELLO, # two  words ', 'conversation')).toEqual({
      ok: true,
      tags: ['hello', 'two-words'],
    });
    expect(
      parseTagTemplates(' #My  Tag, my-tag, 研究/日本語, Привет_мир, {platform} ', 'conversation')
    ).toEqual({
      ok: true,
      tags: ['My-Tag', '研究/日本語', 'Привет_мир', '{platform}'],
    });
    expect(parseTagTemplates('é, 𝒜, 2026/研究', 'conversation')).toEqual({
      ok: true,
      tags: ['é', '𝒜', '2026/研究'],
    });
  });

  it.each([
    '123',
    '# 123',
    '##  １２３',
    '#   ',
    '# {platform}',
    '１２３',
    '١٢٣',
    'a,b,',
    ',a',
    'a,,b',
    '#',
    '{title}',
    '{model}',
    '{date}',
    '{YYYY}',
    '{Platform}',
    '{{platform}}',
    'work/{platform}',
    '{platform}-x',
    '#{platform}',
    'a: b',
    '[tag]',
    'a.b',
    'a"b',
    'a\\b',
    'a\nb',
    'a\tb',
    'a\rb',
    'a\0b',
    'a\u0085b',
    'a\u007fb',
    '\n',
    'a\u200bb',
  ])('rejects invalid syntax without echoing it: %j', value => {
    expect(parseTagTemplates(value, 'conversation')).toEqual({ ok: false });
    expect(isCanonicalTagTemplates([value])).toBe(false);
  });

  it('rejects noncanonical stored arrays instead of splitting or normalizing their entries', () => {
    for (const value of [
      [],
      ['#tag'],
      ['two words'],
      [' tag'],
      ['a,b'],
      [1],
      [null],
      [['a']],
      ['A', 'a'],
      ['{platform}', '{platform}'],
      new Array(2),
    ]) {
      expect(isCanonicalTagTemplates(value)).toBe(false);
    }
    expect(isCanonicalTagTemplates(['A', 'nested/tag', '{platform}'])).toBe(true);
  });

  it('enforces entry counts before dedup and UTF-16 entry length', () => {
    const fifty = Array.from({ length: 50 }, (_, index) => `tag${index}`);
    expect(isCanonicalTagTemplates(fifty)).toBe(true);
    expect(parseTagTemplates(fifty.join(','), 'conversation').ok).toBe(true);
    expect(isCanonicalTagTemplates([...fifty, 'extra'])).toBe(false);
    expect(parseTagTemplates(Array(51).fill('a').join(','), 'conversation').ok).toBe(false);
    expect(isCanonicalTagTemplates(['𝒜'.repeat(50)])).toBe(true);
    expect(isCanonicalTagTemplates(['𝒜'.repeat(50) + 'a'])).toBe(false);
    expect(parseTagTemplates('a'.repeat(101), 'conversation').ok).toBe(false);
  });

  it('checks raw UTF-8 before trimming and canonical JSON bytes after parsing', () => {
    expect(parseTagTemplates(' '.repeat(2048), 'conversation').ok).toBe(true);
    expect(parseTagTemplates(' '.repeat(2049), 'conversation').ok).toBe(false);
    expect(parseTagTemplates('\u3000'.repeat(683), 'conversation').ok).toBe(false);
    const exact = Array.from({ length: 19 }, (_, index) =>
      String.fromCharCode(65 + index).repeat(100)
    );
    exact.push('z'.repeat(87));
    expect(jsonUtf8ByteLength(exact)).toBe(2048);
    expect(isCanonicalTagTemplates(exact)).toBe(true);
    expect(parseTagTemplates(exact.join(','), 'conversation').ok).toBe(true);
    exact[19] += 'z';
    expect(isCanonicalTagTemplates(exact)).toBe(false);
    expect(parseTagTemplates(exact.join(','), 'conversation').ok).toBe(false);
    expect(
      isCanonicalTagTemplates(Array.from({ length: 8 }, (_, i) => `${i}${'語'.repeat(99)}`))
    ).toBe(false);
  });

  it('expands provider IDs once and deduplicates case-insensitively in original order', () => {
    expect(
      resolveTagTemplates(['DeepSeek', '{platform}', 'custom'], 'conversation', 'deepseek')
    ).toEqual(['DeepSeek', 'custom']);
    expect(resolveTagTemplates(['{platform}', 'DeepSeek'], 'conversation', 'deepseek')).toEqual([
      'deepseek',
    ]);
    expect(resolveTagTemplates(['Only'], 'conversation', 'chatgpt')).toEqual(['Only']);
    expect(resolveTagTemplates(undefined, 'deep-research', 'notebooklm')).toEqual([
      'ai-research',
      'deep-research',
      'notebooklm',
    ]);
  });
});
