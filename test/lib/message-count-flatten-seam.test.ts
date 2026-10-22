/**
 * Fitness function for the writer ⇄ reader seam behind issue #406.
 *
 * `flattenLargeCallouts()` rewrites what a saved note looks like;
 * `countExistingMessages()` is the only thing that decides how much of a note
 * append mode believes is already there. If the rewrite changes the count, an
 * append duplicates exactly that many messages. The invariant is therefore:
 *
 *   flattening must never change the message count.
 *
 * These tests cover the seam itself. The absence of any test here is what let
 * #406 ship — both modules were individually well covered (ADR-028).
 */
import { describe, it, expect } from 'vitest';
import { countExistingMessages, extractTailMessages } from '../../src/lib/message-counter';
import { flattenLargeCallouts } from '../../src/lib/callout-flatten';
import { formatMessage } from '../../src/content/markdown-formatting';
import type { TemplateOptions } from '../../src/lib/types';

/** Build a `messages`-long callout body; every `longEvery`-th message is tall. */
function buildBody(messages: number, longEvery: number, longLines = 40): string {
  return Array.from({ length: messages }, (_, i) => {
    const isUser = i % 2 === 0;
    const header = isUser ? '> [!QUESTION] User' : '> [!NOTE] Claude';
    const lines = i > 0 && i % longEvery === 0 ? longLines : 2;
    const content = Array.from({ length: lines }, (_, n) => `> line ${n} of message ${i}`);
    return [header, ...content].join('\n');
  }).join('\n\n');
}

describe('message count survives callout flattening (issue #406)', () => {
  const body = buildBody(20, 3);
  const total = 20;

  it('the unflattened body counts as written', () => {
    expect(countExistingMessages(body)).toBe(total);
  });

  it.each([
    { threshold: 3, label: 'flattens nearly everything' },
    { threshold: 10, label: 'flattens only the tall messages' },
    { threshold: 41, label: 'flattens nothing' },
  ])('count is unchanged at maxCalloutLines=$threshold ($label)', ({ threshold }) => {
    expect(countExistingMessages(flattenLargeCallouts(body, threshold))).toBe(total);
  });

  it('a mixed note does not make append mode re-append its tail', () => {
    // The exact #406 shape: nothing new to say, yet the count disagrees.
    const onDisk = flattenLargeCallouts(body, 10);
    const existingCount = countExistingMessages(onDisk);
    const newTotal = total;

    expect(existingCount).toBe(newTotal);
    // buildAppendContent()'s step 3 guard must hold, so no tail is extracted.
    expect(newTotal <= existingCount).toBe(true);
  });

  it('counting and tail extraction agree on where each message starts', () => {
    // The two must index the same messages; if they drift, append writes from
    // the wrong offset even when the count itself is right.
    const onDisk = flattenLargeCallouts(body, 10);
    const count = countExistingMessages(onDisk);

    for (let skip = 1; skip < count; skip++) {
      const tail = extractTailMessages(onDisk, skip);
      expect(countExistingMessages(tail)).toBe(count - skip);
    }
  });
});

/** Exercise the existing HTML fence writers, not a hand-sized stand-in. */
describe.each(['plain', 'blockquote', 'callout'] as const)(
  'fence writer/count/flatten seam: %s format',
  messageFormat => {
    const options: TemplateOptions = {
      includeId: true,
      includeTitle: true,
      includeTags: true,
      includeSource: true,
      includeDates: true,
      includeMessageCount: true,
      includeQuestionHeaders: true,
      messageFormat,
      userCalloutType: 'QUESTION',
      assistantCalloutType: 'NOTE',
    };
    const f3 = '`'.repeat(3);
    const f4 = '`'.repeat(4);
    const payloads = [
      {
        name: 'nested fences and fake plain/callout labels',
        code: [f3, '**User:**', '**Assistant:**', '> [!QUESTION] User', '> [!NOTE] Assistant', f3],
      },
      { name: 'an inner opening fence only', code: [`${f3}md`, '**Assistant:**'] },
      { name: 'multiple nested fence lengths', code: [`${f4}md`, f3, '**User:**', f3, f4] },
      {
        name: 'indentation, trailing text, tildes and literal HTML',
        code: ['lead', `   ${f3}md`, `    ${f4}`, `${f4} trailing text`, '~~~', '<div>$VAR</div>'],
      },
    ];

    describe.each(['pre/code', 'CodeMirror'])('%s writer', writer => {
      it.each(payloads)('$name survives flattening and exact tail offsets', ({ code }) => {
        const payload = code.join('\n');
        const htmlText = payload.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const html =
          writer === 'pre/code'
            ? `<pre><code class="language-markdown">${htmlText}</code></pre>`
            : `<pre><div class="cm-content">${htmlText}</div></pre>`;
        const messages = [
          formatMessage('First question', 'user', options, 'chatgpt'),
          formatMessage(html, 'assistant', options, 'chatgpt'),
          formatMessage('Next question', 'user', options, 'chatgpt'),
          formatMessage('<p>Final answer</p>', 'assistant', options, 'chatgpt'),
        ];
        const body = messages.join('\n\n');
        const plainCode =
          messageFormat === 'plain'
            ? messages[1]
            : messages[1]
                .split('\n')
                .map(line => line.replace(/^> ?/, ''))
                .join('\n');

        // Independent writer assertion: the wrapper is longer than any payload run,
        // and the payload is literal. The reader is not grading its own fences.
        const longestRun = Math.max(...Array.from(payload.matchAll(/`+/g), m => m[0].length));
        const fence = '`'.repeat(Math.max(3, longestRun + 1));
        const language = writer === 'pre/code' ? 'markdown' : '';
        expect(plainCode).toContain(`${fence}${language}\n${payload}\n${fence}`);

        for (const threshold of [3, 5, 100]) {
          const flattened = flattenLargeCallouts(body, threshold);
          for (const eol of ['\n', '\r\n']) {
            const onDisk = flattened.replace(/\n/g, eol);
            expect(countExistingMessages(onDisk)).toBe(messages.length);
            for (let skip = 0; skip < messages.length; skip++) {
              const expected = flattenLargeCallouts(messages.slice(skip).join('\n\n'), threshold);
              const tail = extractTailMessages(onDisk, skip);
              expect(tail).toBe(expected.replace(/\n/g, eol));
              expect(countExistingMessages(tail)).toBe(messages.length - skip);
            }
            expect(extractTailMessages(onDisk, messages.length)).toBe('');
          }
        }
      });
    });
  }
);
