import { describe, expect, it, vi } from 'vitest';
import {
  CHATGPT_SANDBOX_CODE_RANGE_LIMIT,
  CHATGPT_SANDBOX_LINK_IDENTITY_LIMIT,
  chatGptSandboxLinkIdentity,
  chatGptSandboxLinkOccurrencesFromAssistantTextPart,
  chatGptSandboxLinksFromAssistantTextPart,
} from '../../src/archive/chatgpt-sandbox-link';

const OWNER = 'message-1';
const LINK = '[report](sandbox:/mnt/data/report.pdf)';

function occurrences(part: unknown) {
  return chatGptSandboxLinkOccurrencesFromAssistantTextPart(OWNER, part);
}

describe('ChatGPT sandbox-link presentation occurrences', () => {
  it('retains exact UTF-16 spans and decodes the identity only once', () => {
    const prefix = '🦊 前文 e\u0301\n  ';
    const label = '**报告**';
    const destination = 'sandbox:/mnt/data/%E6%8A%A5%E5%91%8A%20one.docx';
    const link = `[${label}](${destination})`;
    const part = `${prefix}${link} — tail 🧡`;
    const found = occurrences(part);

    expect(found).toEqual([
      {
        messageId: OWNER,
        sandboxPath: '/mnt/data/报告 one.docx',
        identity: 'sandbox-link:message-1\u0000/mnt/data/报告 one.docx',
        linkStart: prefix.length,
        linkEnd: prefix.length + link.length,
        destinationStart: prefix.length + label.length + 3,
        destinationEnd: prefix.length + link.length - 1,
        destination,
      },
    ]);
    expect(prefix.length).toBeGreaterThan(Array.from(prefix).length);
    for (const occurrence of found) {
      expect(part.slice(occurrence.linkStart, occurrence.linkEnd)).toBe(link);
      expect(part.slice(occurrence.destinationStart, occurrence.destinationEnd)).toBe(destination);
      expect(chatGptSandboxLinkIdentity(occurrence.messageId, occurrence.sandboxPath)).toBe(
        occurrence.identity
      );
    }
  });

  it('retains repeated identities and distinct links in source order, not identity order', () => {
    const links = [
      '[z first](sandbox:/mnt/data/z.pdf)',
      '[z again](sandbox:/mnt/data/z.pdf)',
      '[a](sandbox:/mnt/data/a.pdf)',
    ];
    const part = links.join(' 🦊 ');
    const found = occurrences(part);

    expect(found.map(value => value.sandboxPath)).toEqual([
      '/mnt/data/z.pdf',
      '/mnt/data/z.pdf',
      '/mnt/data/a.pdf',
    ]);
    expect(found[0].identity).toBe(found[1].identity);
    let previousEnd = 0;
    found.forEach((value, index) => {
      expect(value.linkStart).toBeGreaterThanOrEqual(previousEnd);
      expect(value.linkEnd).toBeLessThanOrEqual(part.length);
      expect(value.destinationStart).toBeGreaterThan(value.linkStart);
      expect(value.destinationEnd).toBeLessThan(value.linkEnd);
      expect(part.slice(value.linkStart, value.linkEnd)).toBe(links[index]);
      expect(part.slice(value.destinationStart, value.destinationEnd)).toBe(value.destination);
      previousEnd = value.linkEnd;
    });
  });

  it('allows a right-to-left destination rewrite without changing labels or surrounding text', () => {
    const part =
      '🦊 Before [**report**](sandbox:/mnt/data/report.pdf), then ' +
      '[报告 📄](sandbox:/mnt/data/report.pdf).\r\nAfter.';
    const found = occurrences(part);
    let rewritten = part;
    for (const occurrence of [...found].reverse()) {
      rewritten =
        rewritten.slice(0, occurrence.destinationStart) +
        '_liska-archive/assets/report.pdf' +
        rewritten.slice(occurrence.destinationEnd);
    }

    expect(rewritten).toBe(
      '🦊 Before [**report**](_liska-archive/assets/report.pdf), then ' +
        '[报告 📄](_liska-archive/assets/report.pdf).\r\nAfter.'
    );
    expect(part).toContain('sandbox:/mnt/data/report.pdf');
  });

  it.each([
    ['escaped opening', `\\${LINK}`],
    ['image', `!${LINK}`],
    ['escaped image marker', `\\!${LINK}`],
    ['inline code', `\`${LINK}\``],
    ['multi-backtick inline code', `\`\`${LINK}\`\``],
    ['unclosed inline code', `\`${LINK}`],
    ['backtick fence', `\`\`\`md\n${LINK}\n\`\`\``],
    ['tilde fence', `~~~md\n${LINK}\n~~~`],
    ['unclosed fence', `~~~\n${LINK}`],
    ['space-indented code', `    ${LINK}`],
    ['tab-indented code', `\t${LINK}`],
    ['CRLF indented code', `before\r\n    ${LINK}\r\n`],
    ['blockquote', `> ${LINK}`],
    ['indented blockquote', `   > ${LINK}`],
    ['nested blockquote', `> > ${LINK}`],
    ['quoted fence before ordinary link', `> ~~~\n> example\n> ~~~\n${LINK}`],
    ['HTML-adjacent', `<span>${LINK}</span>`],
    ['HTML elsewhere in part', `${LINK}\n<div>later</div>`],
    ['HTML comment', `<!--\n${LINK}\n-->`],
    ['raw HTML block', `<script>\n${LINK}\n</script>`],
    ['unclosed HTML/comment', `<!-- ${LINK}`],
    ['less-than prose', `1 < 2 ${LINK}`],
    ['greater-than prose', `${LINK} 2 > 1`],
    ['nested label', `[[report]](sandbox:/mnt/data/report.pdf)`],
    ['inner link of nested label', `[outer ${LINK}](sandbox:/mnt/data/outer.pdf)`],
    ['nested destination', `[outer](sandbox:/mnt/data/${LINK})`],
    ['reference link', '[report][file]\n[file]: sandbox:/mnt/data/report.pdf'],
    ['shortcut reference', '[report]\n[report]: sandbox:/mnt/data/report.pdf'],
    [
      'inline link-like reference title',
      '[ref]: https://example.com "download [report](sandbox:/mnt/data/report.pdf)"',
    ],
    [
      'continued link-like reference title',
      '[ref]: https://example.com\n  "download [report](sandbox:/mnt/data/report.pdf)"',
    ],
    [
      'multiline reference label with link-like title',
      '[ref\nname]: https://example.com "download [report](sandbox:/mnt/data/report.pdf)"',
    ],
    [
      'astral reference label counted by code point',
      `[${'🦊'.repeat(500)}]: https://example.com "download ${LINK}"`,
    ],
    [
      'CRLF-normalized reference label counted by logical character',
      `[${'a\r\n'.repeat(334)}x]: https://example.com "download ${LINK}"`,
    ],
    [
      'reference definition inside unordered list item',
      `- [ref]: https://example.com "download ${LINK}"`,
    ],
    [
      'reference definition inside ordered list item',
      `1. [ref]: https://example.com "download ${LINK}"`,
    ],
    ['tilde fence in list item', `- ~~~\n  ${LINK}\n  ~~~`],
    ['backtick fence in ordered list item', `1. \`\`\`\n   ${LINK}\n   \`\`\``],
    ['escaped label', '[re\\*port](sandbox:/mnt/data/report.pdf)'],
    ['code in label', '[`report`](sandbox:/mnt/data/report.pdf)'],
    ['newline in label', '[re\nport](sandbox:/mnt/data/report.pdf)'],
    ['unclosed destination', '[report](sandbox:/mnt/data/report.pdf'],
    ['destination title', '[report](sandbox:/mnt/data/report.pdf "title")'],
    ['angle destination', '[report](<sandbox:/mnt/data/report.pdf>)'],
  ])('skips unsupported presentation syntax: %s', (_name, part) => {
    expect(occurrences(part)).toEqual([]);
  });

  it.each([
    '/mnt/data/../report.pdf',
    '/mnt/data/./report.pdf',
    '/mnt/data/%2e%2e/report.pdf',
    '/mnt/data/%252e%252e/report.pdf',
    '/mnt/data/%2520report.pdf',
    '/mnt/data/%2freport.pdf',
    '/mnt/data/%5creport.pdf',
    '/mnt/data/%00report.pdf',
    '/mnt/data/%7freport.pdf',
    '/mnt/data/%ED%A0%80.pdf',
    '/mnt/data/bad%escape.pdf',
    '/mnt/data//report.pdf',
    '/mnt/data/',
    '/mnt/other/report.pdf',
    '/mnt/data/re\\port.pdf',
    '/mnt/data/report(1).pdf',
    '/mnt/data/report\u0085.pdf',
    '/mnt/data/report\ud800.pdf',
  ])('skips malformed or unsafe destination %j', path => {
    expect(occurrences(`[report](sandbox:${path})`)).toEqual([]);
  });

  it('does not let code examples veto a later ordinary link through angle brackets', () => {
    for (const code of ['`<tag> > quote`', '~~~html\n<div>quoted > text</div>\n~~~']) {
      expect(occurrences(`${code}\n${LINK}`).map(value => value.destination)).toEqual([
        'sandbox:/mnt/data/report.pdf',
      ]);
    }
  });

  it('does not let reference definitions inside unambiguous code veto a later link', () => {
    for (const code of [
      '`[ref]: https://example.com`',
      '~~~markdown\n[ref]: https://example.com\n~~~',
    ]) {
      expect(occurrences(`${code}\n${LINK}`).map(value => value.destination)).toEqual([
        'sandbox:/mnt/data/report.pdf',
      ]);
    }
    expect(occurrences(`    [ref]: https://example.com\n${LINK}`)).toEqual([]);
  });

  it('does not hide possible HTML through paragraph-ambiguous indented code', () => {
    expect(occurrences(`paragraph\n    <script>\n\n${LINK}`)).toEqual([]);
    expect(occurrences(`    <tag> > quote\n${LINK}`)).toEqual([]);
    expect(occurrences(`intro\r\r    ${LINK}`)).toEqual([]);
  });

  it('does not let a fake multiline inline range hide raw HTML or a blockquote boundary', () => {
    expect(occurrences(`\`orphan\n\n<script>\n\`\n${LINK}`)).toEqual([]);
    expect(occurrences(`\`orphan\n\n> \`\n${LINK}`)).toEqual([]);
    expect(occurrences(`\`orphan\n\n    \` ${LINK}`)).toEqual([]);
    expect(occurrences(`\`orphan\n~~~\n\` ${LINK}\n~~~`)).toEqual([]);
  });

  it('treats a backslash as literal inside code instead of escaping its closing backtick', () => {
    expect(occurrences(`\`escaped closer\\\` then \`${LINK}\``)).toEqual([]);
    expect(occurrences(`\`escaped closer\\\` <script> \`code\`\n${LINK}`)).toEqual([]);
  });

  it('does not retain code/example occurrences beside ordinary links', () => {
    const part = `\`${LINK}\`\n\n    ${LINK}\n\n${LINK}\n~~~\n${LINK}\n~~~\n${LINK}`;
    expect(occurrences(part).map(value => value.linkStart)).toEqual([
      part.indexOf(LINK, part.indexOf('    ') + LINK.length + 4),
      part.lastIndexOf(LINK),
    ]);
  });

  it('accepts the occurrence limit, counting repeats instead of unique identities', () => {
    const part = `${LINK} `.repeat(CHATGPT_SANDBOX_LINK_IDENTITY_LIMIT);
    const found = occurrences(part);
    expect(found).toHaveLength(CHATGPT_SANDBOX_LINK_IDENTITY_LIMIT);
    expect(new Set(found.map(value => value.identity)).size).toBe(1);
    expect(() => occurrences(`${part}${LINK}`)).toThrow(
      new RangeError('ChatGPT sandbox-link occurrence limit exceeded.')
    );
  });

  it('shares the existing bounded code masking without counting skipped links as occurrences', () => {
    const code = `\`${LINK}\` `.repeat(CHATGPT_SANDBOX_CODE_RANGE_LIMIT);
    expect(occurrences(`${code}${LINK}`)).toHaveLength(1);
    expect(() => occurrences(`${code}\`extra\` ${LINK}`)).toThrow(
      new RangeError('ChatGPT sandbox-link code-range limit exceeded.')
    );
  });

  it('handles dense unmatched openers without inventing or rescanning inner links', () => {
    expect(occurrences('['.repeat(100_000))).toEqual([]);
    expect(occurrences(`${'['.repeat(100_000)}${LINK}`)).toEqual([]);
  });

  it.each([undefined, null, 42, false, [], {}, new String(LINK)])(
    'rejects a nonprimitive text part without coercion: %j',
    part => {
      expect(occurrences(part)).toEqual([]);
    }
  );

  it.each([undefined, null, 42, false, [], {}, '', 'has space', 'a/b', 'é', 'a'.repeat(257), '\0'])(
    'rejects an invalid message owner: %j',
    messageId => {
      expect(chatGptSandboxLinkOccurrencesFromAssistantTextPart(messageId, LINK)).toEqual([]);
    }
  );

  it('accepts valid boundary owner IDs without mutating or coercing input', () => {
    const input = Object.freeze({ messageId: '_'.repeat(256), part: LINK });
    const before = JSON.stringify(input);
    expect(
      chatGptSandboxLinkOccurrencesFromAssistantTextPart(input.messageId, input.part)
    ).toHaveLength(1);
    expect(chatGptSandboxLinkOccurrencesFromAssistantTextPart('a', LINK)).toHaveLength(1);
    const toString = vi.fn(() => LINK);
    expect(occurrences(Object.freeze({ toString }))).toEqual([]);
    expect(toString).not.toHaveBeenCalled();
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('unchanged ChatGPT sandbox-link acquisition identities', () => {
  it('still accepts blockquote and HTML-adjacent links while deduplicating and sorting', () => {
    const part =
      '> [z](sandbox:/mnt/data/z.pdf)\n' +
      '<div>[a](sandbox:/mnt/data/a.pdf)</div>\n' +
      '[z again](sandbox:/mnt/data/z.pdf)';
    expect(chatGptSandboxLinksFromAssistantTextPart(OWNER, part)).toEqual([
      {
        messageId: OWNER,
        sandboxPath: '/mnt/data/a.pdf',
        identity: 'sandbox-link:message-1\u0000/mnt/data/a.pdf',
      },
      {
        messageId: OWNER,
        sandboxPath: '/mnt/data/z.pdf',
        identity: 'sandbox-link:message-1\u0000/mnt/data/z.pdf',
      },
    ]);
    expect(occurrences(part)).toEqual([]);
  });

  it('keeps identity decoding and repeated-call regex state independent', () => {
    const part = '[报告](sandbox:/mnt/data/%E6%8A%A5%E5%91%8A.pdf)';
    const expected = chatGptSandboxLinksFromAssistantTextPart(OWNER, part);
    expect(
      occurrences(part).map(({ messageId, sandboxPath, identity }) => ({
        messageId,
        sandboxPath,
        identity,
      }))
    ).toEqual(expected);
    expect(chatGptSandboxLinksFromAssistantTextPart(OWNER, part)).toEqual(expected);
    expect(occurrences(part)).toHaveLength(1);
    expect(chatGptSandboxLinksFromAssistantTextPart(OWNER, `${part} ${part}`)).toEqual(expected);
  });

  it('does not inherit presentation-only changes to legacy code masking', () => {
    const part = `\`escaped closer\\\` then \`${LINK}\``;
    expect(chatGptSandboxLinksFromAssistantTextPart(OWNER, part)).toEqual([
      {
        messageId: OWNER,
        sandboxPath: '/mnt/data/report.pdf',
        identity: 'sandbox-link:message-1\u0000/mnt/data/report.pdf',
      },
    ]);
    expect(occurrences(part)).toEqual([]);
  });
});
