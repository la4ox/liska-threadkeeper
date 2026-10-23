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
import { conversationToNote } from '../../src/content/markdown';
import type { ConversationData, TemplateOptions } from '../../src/lib/types';

/**
 * Independent CommonMark backtick decoder for the writer's top-level or quoted
 * blocks. Remove only the fence's own quote container, never literal `>` code.
 * CommonMark normalizes CRLF to LF; all other payload whitespace is literal.
 * No production fence writer/reader participates in this recovery oracle.
 */
function decodeBacktickFences(markdown: string): { code: string; quoted: boolean }[] {
  const blocks: { code: string; quoted: boolean }[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');

  for (let index = 0; index < lines.length; index++) {
    const quoted = lines[index].startsWith('>');
    const openingLine = quoted ? lines[index].replace(/^> ?/, '') : lines[index];
    const opening = /^( {0,3})(`{3,})([^`]*)$/.exec(openingLine);
    if (!opening) continue;

    const code: string[] = [];
    for (index += 1; index < lines.length; index++) {
      if (quoted && !lines[index].startsWith('>')) {
        // A quoted fence cannot consume text outside its blockquote container.
        index -= 1;
        break;
      }
      const line = quoted ? lines[index].replace(/^> ?/, '') : lines[index];
      const closing = /^ {0,3}(`{3,})[ \t]*$/.exec(line);
      if (closing && closing[1].length >= opening[2].length) break;

      // CommonMark removes up to the opener's indentation from each code line.
      const indentation = /^ */.exec(line)![0].length;
      code.push(line.slice(Math.min(opening[1].length, indentation)));
    }
    blocks.push({ code: code.join('\n'), quoted });
  }
  return blocks;
}

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
      { name: 'an inner closing fence only', code: ['before', f3, '**User:**'] },
      { name: 'multiple nested fence lengths', code: [`${f4}md`, f3, '**User:**', f3, f4] },
      {
        name: 'inner fence lines with trailing spaces',
        code: [`${f3}md  `, '**User:**', `${f3}   `, '> [!NOTE] Assistant'],
      },
      {
        name: 'longer backtick runs and literal backslashes',
        code: ['`'.repeat(12), '**Assistant:**', 'C:\\code\\file', '\\`literal\\', '`'.repeat(20)],
      },
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
        const data: ConversationData = {
          id: 'fence-seam',
          title: 'Fence seam',
          url: 'https://chatgpt.com/c/fence-seam',
          source: 'chatgpt',
          extractedAt: new Date('2026-01-01T00:00:00Z'),
          metadata: {
            messageCount: 4,
            userMessageCount: 2,
            assistantMessageCount: 2,
            hasCodeBlocks: true,
          },
          messages: [
            { id: 'first', role: 'user', content: 'First question', index: 0 },
            { id: 'code', role: 'assistant', content: html, index: 1 },
            { id: 'next', role: 'user', content: 'Next question', index: 2 },
            { id: 'final', role: 'assistant', content: '<p>Final answer</p>', index: 3 },
          ],
        };
        const note = conversationToNote(data, options, data.extractedAt);
        const messages = data.messages.map(message =>
          formatMessage(message.content, message.role, options, data.source)
        );
        expect(note.body).toBe(messages.join('\n\n'));
        expect(note.frontmatter.message_count).toBe(messages.length);
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
        expect(decodeBacktickFences(messages[1])).toEqual([
          { code: payload, quoted: messageFormat !== 'plain' },
        ]);

        for (const threshold of [undefined, 3, 5, 100]) {
          const flatten = (body: string): string =>
            threshold === undefined ? body : flattenLargeCallouts(body, threshold);
          const flattened = flatten(note.body);
          const quoteLines = messages[1].split('\n').filter(line => line.startsWith('>')).length;
          const quoted =
            messageFormat !== 'plain' && (threshold === undefined || quoteLines <= threshold);
          for (const eol of ['\n', '\r\n']) {
            const onDisk = flattened.replace(/\n/g, eol);
            expect(countExistingMessages(onDisk)).toBe(messages.length);
            expect(decodeBacktickFences(onDisk)).toEqual([{ code: payload, quoted }]);
            for (let skip = 0; skip <= messages.length; skip++) {
              const expected = flatten(messages.slice(skip).join('\n\n'));
              const tail = extractTailMessages(onDisk, skip);
              expect(tail).toBe(expected.replace(/\n/g, eol));
              expect(countExistingMessages(tail)).toBe(messages.length - skip);
              expect(decodeBacktickFences(tail)).toEqual(
                skip < 2 ? [{ code: payload, quoted }] : []
              );
            }
          }
        }
      });
    });
  }
);
