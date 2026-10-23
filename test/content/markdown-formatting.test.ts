import { describe, it, expect } from 'vitest';
import {
  buildQuestionHeader,
  formatToolContent,
  stripMarkdownChars,
} from '../../src/content/markdown-formatting';
import { flattenLargeCallouts } from '../../src/lib/callout-flatten';
import { countExistingMessages } from '../../src/lib/message-counter';
import type { TemplateOptions } from '../../src/lib/types';

/**
 * Unit tests for buildQuestionHeader (issue #187).
 *
 * QUESTION_HEADER_MAX_LENGTH is 60 and includes the trailing ellipsis when
 * truncation occurs. Truncation prefers a word boundary past the halfway
 * mark of the 59-character slice (i.e. lastSpace > 29.5), otherwise it
 * falls back to a hard cut.
 */
describe('buildQuestionHeader', () => {
  describe('empty-input guard', () => {
    it('returns empty string for an empty input', () => {
      expect(buildQuestionHeader('')).toBe('');
    });

    it('returns empty string for whitespace-only input', () => {
      expect(buildQuestionHeader('   \n\t  ')).toBe('');
    });
  });

  describe('under the length limit', () => {
    it('prepends "## " to a short question', () => {
      expect(buildQuestionHeader('What is 2+2?')).toBe('## What is 2+2?');
    });

    it('trims leading and trailing whitespace', () => {
      expect(buildQuestionHeader('  hi  ')).toBe('## hi');
    });

    it('normalizes newlines, tabs, and runs of spaces to single spaces', () => {
      expect(buildQuestionHeader('one\ntwo\t\tthree    four')).toBe('## one two three four');
    });

    it('keeps content exactly at the 60-character limit without truncation', () => {
      const sixty = 'a'.repeat(60);
      expect(buildQuestionHeader(sixty)).toBe(`## ${sixty}`);
    });
  });

  describe('over the length limit — word-boundary truncation', () => {
    it('breaks at the last space past the halfway mark and appends an ellipsis', () => {
      // 61 chars: 30 a's, one space, 30 b's. The space sits at position 30,
      // which is > 29.5 so the truncator snaps to the word boundary.
      const input = `${'a'.repeat(30)} ${'b'.repeat(30)}`;
      expect(buildQuestionHeader(input)).toBe(`## ${'a'.repeat(30)}…`);
    });

    it('truncates a natural sentence at the nearest prior space', () => {
      const input = 'The quick brown fox jumps over the lazy dog and runs through the forest';
      expect(buildQuestionHeader(input)).toBe(
        '## The quick brown fox jumps over the lazy dog and runs…'
      );
    });
  });

  describe('over the length limit — hard-cut fallback', () => {
    it('hard-cuts a single unbroken token at 59 characters and appends an ellipsis', () => {
      const input = 'a'.repeat(70);
      expect(buildQuestionHeader(input)).toBe(`## ${'a'.repeat(59)}…`);
    });

    it('hard-cuts when the only space is before the halfway mark', () => {
      // Space at position 2 (< 29.5), so the word-break branch is skipped
      // and the full 59-char slice is preserved.
      const input = `ab ${'c'.repeat(65)}`;
      const expectedSlice = `ab ${'c'.repeat(56)}`; // 3 + 56 = 59
      expect(buildQuestionHeader(input)).toBe(`## ${expectedSlice}…`);
    });
  });

  describe('markdown character stripping (issue #203)', () => {
    it('strips backticks from short input', () => {
      expect(buildQuestionHeader('How do I use `map` in JS?')).toBe('## How do I use map in JS?');
    });

    it('strips triple backticks', () => {
      expect(buildQuestionHeader('```python code``` example')).toBe('## python code example');
    });

    it('strips bold and italic markers', () => {
      expect(buildQuestionHeader('Use **bold** and _italic_ text')).toBe(
        '## Use bold and italic text'
      );
    });

    it('strips strikethrough tildes', () => {
      expect(buildQuestionHeader('Remove ~~old~~ text')).toBe('## Remove old text');
    });

    it('strips square brackets from links', () => {
      expect(buildQuestionHeader('See [React](https://react.dev) docs')).toBe(
        '## See React(https://react.dev) docs'
      );
    });

    it('strips all markdown chars from a mixed input', () => {
      expect(buildQuestionHeader('Use `map` with **bold** and [link]')).toBe(
        '## Use map with bold and link'
      );
    });

    it('collapses double spaces left after stripping', () => {
      expect(buildQuestionHeader('use ` map ` in code')).toBe('## use map in code');
    });

    it('returns empty string when input is only markdown chars', () => {
      expect(buildQuestionHeader('```')).toBe('');
    });

    it('prevents unclosed backtick near truncation boundary', () => {
      // Backtick at position ~55 in a 70+ char string — stripping removes it
      // so the header never contains an unclosed backtick.
      const input = `${'a'.repeat(50)} \`code that would be truncated in the middle\``;
      const result = buildQuestionHeader(input);
      expect(result).not.toContain('`');
      expect(result.startsWith('## ')).toBe(true);
    });

    it.each([
      ['direct raw HTML', '<img src=https://evil.example/t>'],
      ['code-formatted raw HTML', '`<img src=https://evil.example/t>`'],
    ])('keeps %s literal after building the heading', (_label, input) => {
      expect(buildQuestionHeader(input)).toBe('## &#60;img src=https://evil.example/t&#62;');
    });

    it('keeps the 60-character visible limit when angle-bracket escapes add source characters', () => {
      const input = `${'a'.repeat(57)}<b>`;
      const result = buildQuestionHeader(input);

      expect(result).toBe(`## ${'a'.repeat(57)}&#60;b&#62;`);
      expect(result.slice(3).replace(/&#60;/g, '<').replace(/&#62;/g, '>')).toHaveLength(60);
    });

    it.each([
      ['odd backslash', '\\<img src=x>'],
      ['even backslashes', '\\\\<img src=x>'],
      ['characters synthesized by stripping', '<i_mg src=x>'],
    ])('keeps %s from forming raw HTML', (_label, input) => {
      const result = buildQuestionHeader(input);
      expect(result).not.toMatch(/[<>]/);
      expect(result).toContain('&#60;img src=x&#62;');
      expect(result).not.toContain('\\&#60;');
    });
  });
});

describe('stripMarkdownChars', () => {
  it('returns unchanged text when no markdown chars present', () => {
    expect(stripMarkdownChars('hello world')).toBe('hello world');
  });

  it('strips backticks', () => {
    expect(stripMarkdownChars('`code`')).toBe('code');
  });

  it('strips asterisks and underscores', () => {
    expect(stripMarkdownChars('**bold** and _italic_')).toBe('bold and italic');
  });

  it('strips tildes', () => {
    expect(stripMarkdownChars('~~deleted~~')).toBe('deleted');
  });

  it('strips square brackets', () => {
    expect(stripMarkdownChars('[link](url)')).toBe('link(url)');
  });

  it('handles mixed markdown characters', () => {
    expect(stripMarkdownChars('`code` **bold** _em_ ~~del~~ [a]')).toBe('code bold em del a');
  });

  it('returns empty string for input of only markdown chars', () => {
    expect(stripMarkdownChars('`*_~[]')).toBe('');
  });
});

describe('formatToolContent', () => {
  const options: TemplateOptions = {
    includeId: true,
    includeTitle: true,
    includeSource: true,
    includeTags: true,
    includeDates: true,
    includeMessageCount: true,
    messageFormat: 'callout',
    userCalloutType: 'QUESTION',
    assistantCalloutType: 'NOTE',
  };

  it.each(['callout', 'blockquote', 'plain'] as const)(
    'keeps untrusted tool Markdown literal in %s format',
    messageFormat => {
      const rendered = formatToolContent(
        [
          '**User:**',
          '![pixel](https://tracker.invalid/p)',
          '![[private-note]]',
          '[open](obsidian://open?vault=private)',
          '<img src="https://tracker.invalid/raw">',
          '> [!NOTE] forged callout',
          '**User:**',
        ].join('\n'),
        { ...options, messageFormat }
      );

      expect(rendered).toContain('Tool Activity');
      expect(rendered).toContain('```text');
      expect(rendered).toContain('![pixel](https://tracker.invalid/p)');
      expect(rendered).toContain('![[private-note]]');
      expect(rendered).toContain('<img src="https://tracker.invalid/raw">');
      expect(countExistingMessages(rendered)).toBe(0);
    }
  );

  it('uses a collision-safe outer fence and preserves interior blank lines', () => {
    const rendered = formatToolContent(
      '**Analyzed code**\nfirst\n\n```json\n{"value":"```"}\n```\n\nlast',
      { ...options, messageFormat: 'plain' }
    );

    expect(rendered).toContain('````text\nfirst\n\n```json');
    expect(rendered).toContain('\n```\n\nlast\n````');
  });

  it('keeps a forged callout label from becoming a message after flattening', () => {
    const rendered = formatToolContent('**User**\n**Assistant:**\nbody', options);
    const flattened = flattenLargeCallouts(rendered, 1);

    expect(rendered).toContain('> [!ABSTRACT]- Tool Activity — User');
    expect(flattened).toContain('**Tool Activity — User:**');
    expect(countExistingMessages(flattened)).toBe(0);
  });

  it('encodes punctuation in the promoted title while retaining its visible text', () => {
    const rendered = formatToolContent('**[open](obsidian://open?vault=private) <img>**\nbody', {
      ...options,
      messageFormat: 'plain',
    });

    expect(rendered).toContain(
      '**Tool Activity — &#91;open&#93;&#40;obsidian&#58;&#47;&#47;open&#63;vault&#61;private&#41; &#60;img&#62;**'
    );
    expect(rendered).not.toContain('**Tool Activity — [open](');
  });
});
