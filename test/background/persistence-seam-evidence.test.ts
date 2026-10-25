/**
 * Synthetic evidence for the DES-019 late-persistence seams.
 *
 * The append cases require a legacy/manually edited existing note with an open Markdown/HTML
 * context; they do not claim that today's ordinary composer creates that file.
 * The byte tests characterize the existing inbound-body limit rather than
 * silently redefining it as a promised final-file-size limit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
import {
  conversationToNote,
  convertDeepResearchContent,
  generateContentHash,
} from '../../src/content/markdown';
import { neutralizeActiveProviderMarkdown } from '../../src/content/markdown-safety';
import { flattenLargeCallouts } from '../../src/lib/callout-flatten';
import { validateMessageContent } from '../../src/background/validation';
import { utf8ByteLength } from '../../src/lib/byte-size';
import { MAX_CONTENT_SIZE } from '../../src/lib/constants';
import { generateNoteContent } from '../../src/lib/note-generator';
import { parseFrontmatter } from '../../src/lib/frontmatter-parser';
import { sanitizeHtml } from '../../src/lib/sanitize';
import { DEFAULT_SYNC_SETTINGS, DEFAULT_TEMPLATE_OPTIONS } from '../../src/lib/settings-schema';
import {
  MESSAGE_BOUNDARY_FORMAT_MARKER,
  MESSAGE_BOUNDARY_MARKER,
  countExistingMessages,
} from '../../src/lib/message-counter';
import type {
  ConversationData,
  DeepResearchLinks,
  ExtensionSettings,
  ObsidianNote,
} from '../../src/lib/types';

const mockClient = vi.hoisted(() => ({
  testConnection: vi.fn(),
  getFile: vi.fn(),
  putFile: vi.fn(),
  putBinaryFile: vi.fn(),
  listFiles: vi.fn(),
  listEntries: vi.fn(),
}));

vi.mock('../../src/lib/obsidian-api', () => ({
  ObsidianApiClient: class MockObsidianApiClient {
    testConnection = mockClient.testConnection;
    getFile = mockClient.getFile;
    putFile = mockClient.putFile;
    putBinaryFile = mockClient.putBinaryFile;
    listFiles = mockClient.listFiles;
    listEntries = mockClient.listEntries;
  },
  isObsidianApiError: () => false,
}));

vi.mock('mdast-util-from-markdown', { spy: true });
vi.mock('../../src/lib/callout-flatten', { spy: true });

const { handleSave } = await import('../../src/background/obsidian-handlers');

const settings: ExtensionSettings = {
  ...DEFAULT_SYNC_SETTINGS,
  obsidianApiKey: 'synthetic-test-key',
  enableAppendMode: true,
  flattenLargeCallouts: false,
  templateOptions: { ...DEFAULT_TEMPLATE_OPTIONS, messageFormat: 'plain' },
};
const renderedAt = new Date('2026-01-01T00:00:00.000Z');
const pixelToken = 'liska-seam-pixel';
const pixelHtml = `<img id="${pixelToken}" src="https://attacker.invalid/pixel">`;

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}

function nodes(markdown: string): MarkdownNode[] {
  const pending: MarkdownNode[] = [fromMarkdown(markdown) as MarkdownNode];
  const result: MarkdownNode[] = [];
  while (pending.length > 0) {
    const node = pending.pop()!;
    result.push(node);
    if (node.children) pending.push(...node.children);
  }
  return result;
}

function htmlValues(markdown: string): string {
  return nodes(markdown)
    .filter(node => node.type === 'html')
    .map(node => node.value ?? '')
    .join('\n');
}

function conversation(messages: ConversationData['messages']): ConversationData {
  return {
    id: 'persistence-seam',
    title: 'Synthetic persistence seam',
    source: 'claude',
    url: 'https://claude.ai/chat/persistence-seam',
    extractedAt: renderedAt,
    messages,
    metadata: {
      messageCount: messages.length,
      userMessageCount: messages.filter(message => message.role === 'user').length,
      assistantMessageCount: messages.filter(message => message.role === 'assistant').length,
      hasCodeBlocks: true,
    },
  };
}

const initialMessages: ConversationData['messages'] = [
  { id: 'u1', role: 'user', index: 0, content: 'First question' },
  { id: 'a1', role: 'assistant', index: 1, content: '<p>First answer</p>' },
];

function extendedNote(code: string): ObsidianNote {
  return conversationToNote(
    conversation([
      ...initialMessages,
      { id: 'u2', role: 'user', index: 2, content: 'Please keep this example literal.' },
      {
        id: 'a2',
        role: 'assistant',
        index: 3,
        content: `\`\`\`html\n${code}\n\`\`\``,
        contentFormat: 'markdown',
      },
    ]),
    settings.templateOptions,
    renderedAt
  );
}

function extendedMarkdownNote(content: string): ObsidianNote {
  return conversationToNote(
    conversation([
      ...initialMessages,
      { id: 'u2', role: 'user', index: 2, content: 'Next question' },
      { id: 'a2', role: 'assistant', index: 3, content, contentFormat: 'markdown' },
    ]),
    settings.templateOptions,
    renderedAt
  );
}

function research(content: string, links?: DeepResearchLinks): ConversationData {
  const result = conversation([
    { id: 'report-0', role: 'assistant', index: 0, content: sanitizeHtml(content) },
  ]);
  return { ...result, source: 'gemini', type: 'deep-research', links };
}

function plainNote(body: string): ObsidianNote {
  const note = conversationToNote(
    conversation(initialMessages),
    settings.templateOptions,
    renderedAt
  );
  return { ...note, body, contentHash: generateContentHash(body), images: [] };
}

describe('persistence seam evidence: append recontextualization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.getFile.mockResolvedValue(null);
    mockClient.putFile.mockResolvedValue(undefined);
    mockClient.putBinaryFile.mockResolvedValue(undefined);
    mockClient.listFiles.mockResolvedValue([]);
    mockClient.listEntries.mockResolvedValue([]);
  });

  const contexts = [
    { label: 'script', opening: '<script>', closeInCode: '</script>' },
    { label: 'pre', opening: '<pre>', closeInCode: '</pre>' },
    { label: 'comment', opening: '<!--', closeInCode: '-->' },
    // This old fence can swallow the new trusted message markers even when
    // the literal <img> remains inert. That is not the same HTML activation.
    { label: 'fence', opening: '```', closeInCode: '' },
    { label: 'tilde fence', opening: '~~~', closeInCode: '' },
    { label: 'unequal fence', opening: '````', closeInCode: '```' },
  ];

  it.each(contexts.flatMap(context => ['\n', '\r\n', '\r'].map(eol => ({ ...context, eol }))))(
    'refuses an old open $label context before any write ($eol)',
    async ({ opening, closeInCode, eol }) => {
      const initial = conversationToNote(
        conversation(initialMessages),
        settings.templateOptions,
        renderedAt
      );
      const existing = `${generateNoteContent(initial, settings)}\n\n${opening}\n`.replace(
        /\n/g,
        eol
      );
      const note = extendedNote([closeInCode, pixelHtml].filter(Boolean).join('\n'));
      const noteBefore = structuredClone(note);

      // The newly generated complete document is safe before the append seam.
      expect(htmlValues(note.body)).not.toContain(pixelToken);
      expect(countExistingMessages(note.body)).toBe(4);
      mockClient.getFile.mockResolvedValue(existing);

      const response = await handleSave(settings, note);

      expect(note).toEqual(noteBefore);
      await expect(mockClient.getFile.mock.results[0].value).resolves.toBe(existing);
      expect(response).toMatchObject({
        success: false,
        error: 'markdown-context-crosses-append-boundary',
      });
      expect(mockClient.putFile).not.toHaveBeenCalled();
      expect(mockClient.putBinaryFile).not.toHaveBeenCalled();
    }
  );

  it('keeps the same appended code literal when the existing context is closed', async () => {
    const initial = conversationToNote(
      conversation(initialMessages),
      settings.templateOptions,
      renderedAt
    );
    mockClient.getFile.mockResolvedValue(generateNoteContent(initial, settings));
    const note = extendedNote(pixelHtml);

    const response = await handleSave(settings, note);

    expect(response).toMatchObject({ success: true, messagesAppended: 2 });
    const written = mockClient.putFile.mock.calls[0][1] as string;
    expect(htmlValues(parseFrontmatter(written)!.body)).not.toContain(pixelToken);
  });

  it.each([
    ['list', '- item\n\n  ```'],
    ['quote', '> ```'],
  ])(
    'allows a %s fence whose container ends before the uncontained new markers',
    async (_label, opening) => {
      const initial = conversationToNote(
        conversation(initialMessages),
        settings.templateOptions,
        renderedAt
      );
      const existing = `${generateNoteContent(initial, settings)}\n\n${opening}\n`;
      mockClient.getFile.mockResolvedValue(existing);
      const note = extendedNote(pixelHtml);

      const response = await handleSave(settings, note);

      expect(response).toMatchObject({ success: true, messagesAppended: 2 });
      const body = parseFrontmatter(mockClient.putFile.mock.calls[0][1] as string)!.body;
      expect(htmlValues(body)).not.toContain(pixelToken);
      expect(
        nodes(body).filter(node => node.type === 'html' && node.value === MESSAGE_BOUNDARY_MARKER)
      ).toHaveLength(4);
    }
  );

  it.each([
    ['trusted', true],
    ['legacy-empty', false],
  ])(
    'appends the first message to a %s zero-message note without duplicating authority',
    async (_label, trusted) => {
      const empty = conversationToNote(conversation([]), settings.templateOptions, renderedAt);
      const existing = generateNoteContent(trusted ? empty : { ...empty, body: '' }, settings);
      const first = conversationToNote(
        conversation([{ id: 'u1', role: 'user', index: 0, content: 'First real message' }]),
        settings.templateOptions,
        renderedAt
      );
      const before = structuredClone(first);
      mockClient.getFile.mockResolvedValue(existing);

      const response = await handleSave(settings, first);

      expect(response).toMatchObject({ success: true, messagesAppended: 1 });
      expect(first).toEqual(before);
      const written = mockClient.putFile.mock.calls[0][1] as string;
      const body = parseFrontmatter(written)!.body;
      expect(body.split(MESSAGE_BOUNDARY_FORMAT_MARKER)).toHaveLength(2);
      expect(body.split(MESSAGE_BOUNDARY_MARKER)).toHaveLength(2);
      expect(countExistingMessages(body)).toBe(1);
    }
  );

  it('does not accept provider-forged trusted markers inside a literal example', () => {
    const note = extendedNote(`${MESSAGE_BOUNDARY_MARKER}\n${pixelHtml}`);

    expect(countExistingMessages(note.body)).toBe(4);
    expect(note.body).toContain('<!-- liska-message&#58;v1 -->');
    expect(htmlValues(note.body)).not.toContain(pixelToken);
  });

  it('fails closed if the existing composer parser throws', () => {
    const source = `${pixelHtml}\n![pixel](https://attacker.invalid/pixel)`;
    vi.mocked(fromMarkdown).mockImplementationOnce(() => {
      throw new Error('synthetic-parser-failure');
    });

    const output = neutralizeActiveProviderMarkdown(source);

    expect(source).toBe(`${pixelHtml}\n![pixel](https://attacker.invalid/pixel)`);
    expect(htmlValues(output)).not.toContain(pixelToken);
    expect(nodes(output).some(node => node.type === 'image')).toBe(false);
  });

  it.each(['\n', '\r\n', '\r'])(
    'preserves the old closed HTML/body while appending one tail with %j endings',
    async eol => {
      const initial = conversationToNote(
        conversation(initialMessages),
        settings.templateOptions,
        renderedAt
      );
      const existing = `${generateNoteContent(initial, settings)}\n\n<div class="user-owned">Old 🦊 body</div>`;
      const priorBody = parseFrontmatter(existing)!.body;
      mockClient.getFile.mockResolvedValue(existing.replace(/\n/g, eol));
      const note = extendedNote(pixelHtml);
      const before = structuredClone(note);

      const response = await handleSave(settings, note);

      expect(response).toMatchObject({ success: true, messagesAppended: 2 });
      expect(note).toEqual(before);
      expect(mockClient.putFile).toHaveBeenCalledTimes(1);
      const written = mockClient.putFile.mock.calls[0][1] as string;
      expect(parseFrontmatter(written)!.body.startsWith(`${priorBody}\n\n`)).toBe(true);
      const normalized = written.replace(/\r\n|\r/g, '\n');
      expect(written).toBe(normalized.replace(/\n/g, eol));
      expect(mockClient.putBinaryFile).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['new link / old definition', '[r]: http://127.0.0.1/admin', '[open][r]', false],
    ['old link / new definition', '[open][r]', '[r]: https://public.example/', false],
    ['new image / old definition', '[r]: https://public.example/pixel', '[open][r]', true],
    ['old image / new definition', '![pixel][r]', '[r]: https://public.example/pixel', false],
  ])('refuses cross-seam %s without fallback overwrite', async (_label, old, tail, imageTail) => {
    const initial = conversationToNote(
      conversation(initialMessages),
      settings.templateOptions,
      renderedAt
    );
    const existing = `${generateNoteContent(initial, settings)}\n\n${old}`;
    mockClient.getFile.mockResolvedValue(existing);
    const note = extendedMarkdownNote(tail as string);
    // Ordinary provider composition already neutralizes unresolved images.
    // Exercise the separately validated worker-note boundary with that syntax
    // admitted directly, without pretending it came from the current composer.
    if (imageTail) note.body = note.body.replace('[open][r]', '![pixel][r]');
    expect(
      validateMessageContent({ action: 'saveToOutputs', outputs: ['obsidian'], data: note })
    ).toBe(true);
    const before = structuredClone(note);

    const response = await handleSave(settings, note);

    expect(response).toMatchObject({
      success: false,
      error: 'markdown-reference-crosses-append-boundary',
    });
    expect(note).toEqual(before);
    expect(mockClient.putFile).not.toHaveBeenCalled();
    expect(mockClient.putBinaryFile).not.toHaveBeenCalled();
  });

  it('allows independent same-side reference bindings without rewriting old syntax', async () => {
    const initial = conversationToNote(
      conversation(initialMessages),
      settings.templateOptions,
      renderedAt
    );
    const old = '[old][a]\n\n[a]: http://127.0.0.1/user-owned';
    mockClient.getFile.mockResolvedValue(`${generateNoteContent(initial, settings)}\n\n${old}`);
    const note = extendedMarkdownNote('[new][b]\n\n[b]: https://public.example/new');

    const response = await handleSave(settings, note);

    expect(response).toMatchObject({ success: true, messagesAppended: 2 });
    const body = parseFrontmatter(mockClient.putFile.mock.calls[0][1] as string)!.body;
    expect(body).toContain(old);
    expect(nodes(body).filter(node => node.type === 'linkReference')).toHaveLength(2);
  });

  it.each([
    {
      label: 'marker loss',
      transform: (tail: string) => tail.replace(MESSAGE_BOUNDARY_MARKER, ''),
      error: 'append-message-boundaries-untrusted',
    },
    {
      label: 'an extra marker',
      transform: (tail: string) => `${MESSAGE_BOUNDARY_MARKER}\n\n${tail}`,
      error: 'append-message-boundaries-untrusted',
    },
    {
      label: 'hidden markers',
      transform: (tail: string) => `~~~~\n${tail}\n~~~~`,
      error: 'markdown-boundary-marker-hidden',
    },
    {
      label: 'unexpected new HTML',
      transform: (tail: string) => `${tail}\n\n${pixelHtml}`,
      error: 'markdown-finalization-failed',
    },
  ])('refuses $label after a tail transform before any write', async ({ transform, error }) => {
    const initial = conversationToNote(
      conversation(initialMessages),
      settings.templateOptions,
      renderedAt
    );
    mockClient.getFile.mockResolvedValue(generateNoteContent(initial, settings));
    const note = extendedNote(pixelHtml);
    const before = structuredClone(note);
    vi.mocked(flattenLargeCallouts).mockImplementationOnce(transform);

    const response = await handleSave({ ...settings, flattenLargeCallouts: true }, note);

    expect(response).toMatchObject({ success: false, error });
    expect(note).toEqual(before);
    expect(mockClient.putFile).not.toHaveBeenCalled();
    expect(mockClient.putBinaryFile).not.toHaveBeenCalled();
  });

  it('refuses a final parser failure without write or fallback overwrite', async () => {
    const initial = conversationToNote(
      conversation(initialMessages),
      settings.templateOptions,
      renderedAt
    );
    mockClient.getFile.mockResolvedValue(generateNoteContent(initial, settings));
    const note = extendedNote(pixelHtml);
    vi.mocked(fromMarkdown).mockImplementationOnce(() => {
      throw new Error('synthetic-private-parser-details');
    });

    const response = await handleSave(settings, note);

    expect(response).toMatchObject({ success: false, error: 'markdown-finalization-failed' });
    expect(mockClient.putFile).not.toHaveBeenCalled();
    expect(mockClient.putBinaryFile).not.toHaveBeenCalled();
  });
});

describe('persistence seam evidence: Deep Research final composition', () => {
  it('keeps raw HTML examples literal after the real extractor sanitizer/converter path', () => {
    const input = research(
      `<p>Example: &lt;img id="${pixelToken}" src="https://attacker.invalid/pixel"&gt;</p>` +
        '<script>forbidden()</script>'
    );
    const before = structuredClone(input);

    const note = conversationToNote(input, settings.templateOptions, renderedAt);

    expect(input).toEqual(before);
    expect(htmlValues(note.body)).not.toContain(pixelToken);
    expect(note.body).not.toContain('forbidden()');
  });

  it('neutralizes an ordinary remote image equally in ordinary and Deep Research output', () => {
    const content = '<p>Report</p><img src="https://attacker.invalid/pixel" alt="pixel">';
    const input = research(content);
    const before = structuredClone(input);
    const ordinary = conversationToNote(
      { ...input, type: undefined },
      settings.templateOptions,
      renderedAt
    );
    const report = conversationToNote(input, settings.templateOptions, renderedAt);

    expect(input).toEqual(before);
    expect(nodes(ordinary.body).filter(node => node.type === 'image')).toEqual([]);
    expect(nodes(report.body).filter(node => node.type === 'image')).toEqual([]);
    expect(report.body).toContain('&#33;&#91;pixel]');
    expect(report.contentHash).toBe(generateContentHash(report.body));
    expect(report.contentHash).not.toBe(
      generateContentHash(convertDeepResearchContent(input.messages[0].content, input.links))
    );
  });

  it('neutralizes a private hyperlink in the sanitized Deep Research report body', () => {
    const input = research('<p><a href="http://127.0.0.1/admin">private</a></p>');
    const before = structuredClone(input);

    const note = conversationToNote(input, settings.templateOptions, renderedAt);

    expect(input).toEqual(before);
    expect(nodes(note.body).filter(node => node.url === 'http://127.0.0.1/admin')).toEqual([]);
  });

  it('neutralizes private References URLs without disturbing valid citation structure', () => {
    const input = research('<p>Report<sup data-turn-source-index="1">1</sup></p>', {
      sources: [{ index: 0, url: 'http://127.0.0.1/admin', title: 'Private', domain: '127.0.0.1' }],
    });
    const before = structuredClone(input);

    const note = conversationToNote(input, settings.templateOptions, renderedAt);

    expect(input).toEqual(before);
    expect(note.body).toContain('[^1]');
    expect(note.body).toContain('# References');
    // CommonMark does not implement Obsidian footnotes, so parse the known
    // generated definition's body separately rather than treating a missing
    // top-level link node as proof of safety.
    const definition = note.body.split('\n').find(line => line.startsWith('[^1]: '));
    expect(definition).toBeDefined();
    expect(
      nodes(definition!.slice('[^1]: '.length)).filter(
        node => node.url === 'http://127.0.0.1/admin'
      )
    ).toEqual([]);
  });

  it('preserves public citation links but makes forged reference-title syntax literal', () => {
    const input = research('<p>Report<sup data-turn-source-index="1">1</sup></p>', {
      sources: [
        {
          index: 0,
          url: 'https://source.example/report',
          title: `Source\n[^forged]: \`\`<img id="${pixelToken}">\``,
          domain: 'source.example',
        },
      ],
    });

    const note = conversationToNote(input, settings.templateOptions, renderedAt);

    expect(note.body).toContain('[^1]');
    expect(note.body).toContain('https://source.example/report');
    expect(note.body).not.toContain('\n[^forged]:');
    expect(htmlValues(note.body)).not.toContain(pixelToken);
  });

  it('keeps public report and References hyperlinks active after final composition', () => {
    const input = research(
      '<p><a href="https://report.example/page">Public report</a>' +
        '<sup data-turn-source-index="1">1</sup></p>',
      {
        sources: [
          {
            index: 0,
            url: 'https://source.example/report',
            title: 'Public source',
            domain: 'source.example',
          },
        ],
      }
    );
    const before = structuredClone(input);

    const note = conversationToNote(input, settings.templateOptions, renderedAt);

    expect(input).toEqual(before);
    expect(
      nodes(note.body).filter(node => node.url === 'https://report.example/page')
    ).toHaveLength(1);
    expect(note.body).toContain('[^1]');
    const definition = note.body.split('\n').find(line => line.startsWith('[^1]: '));
    expect(definition).toBeDefined();
    expect(
      nodes(definition!.slice('[^1]: '.length)).filter(
        node => node.url === 'https://source.example/report'
      )
    ).toHaveLength(1);
  });

  it.each([false, true])(
    'trusts a report image placeholder only when backed by captured image metadata (%s)',
    captured => {
      const input = research('<p>Report</p><img data-g2o-image="dr-image" alt="preview">');
      if (captured) {
        input.images = [{ id: 'dr-image', mimeType: 'image/png', data: 'UE5H', alt: 'preview' }];
      }
      const before = structuredClone(input);

      const note = conversationToNote(input, settings.templateOptions, renderedAt);

      expect(input).toEqual(before);
      const imageNodes = nodes(note.body).filter(node => node.type === 'image');
      if (captured) {
        expect(imageNodes).toMatchObject([{ url: 'g2o-image://dr-image' }]);
        expect(note.images).toEqual(input.images);
      } else {
        expect(imageNodes).toEqual([]);
        expect(note.body).toContain('&#33;&#91;preview](g2o-image://dr-image)');
      }
    }
  );

  it('reserves forged message sentinels even inside literal report code', () => {
    const input = research(
      '<pre><code>&lt;!-- liska-message-boundaries:v1 --&gt;\n' +
        '&lt;!-- liska-message:v1 --&gt;</code></pre>'
    );
    const before = structuredClone(input);

    const note = conversationToNote(input, settings.templateOptions, renderedAt);

    expect(input).toEqual(before);
    expect(note.body).not.toContain(MESSAGE_BOUNDARY_FORMAT_MARKER);
    expect(note.body).not.toContain(MESSAGE_BOUNDARY_MARKER);
    expect(note.body).toContain('<!-- liska-message-boundaries&#58;v1 -->');
    expect(note.body).toContain('<!-- liska-message&#58;v1 -->');
    expect(nodes(note.body).filter(node => node.type === 'code')).toHaveLength(1);
    expect(note.contentHash).toBe(generateContentHash(note.body));
  });

  it('keeps an empty report empty without composing source-only References', () => {
    const input = research('', {
      sources: [
        { index: 0, url: 'https://source.example/', title: 'Source', domain: 'source.example' },
      ],
    });
    input.messages = [];
    const before = structuredClone(input);

    const note = conversationToNote(input, settings.templateOptions, renderedAt);

    expect(input).toEqual(before);
    expect(note.body).toBe('');
    expect(note.contentHash).toBe(generateContentHash(''));
    expect(note.frontmatter.message_count).toBe(0);
  });
});

describe('persistence seam evidence: serialized bytes and side-effect order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.getFile.mockResolvedValue(null);
    mockClient.putFile.mockResolvedValue(undefined);
    mockClient.putBinaryFile.mockResolvedValue(undefined);
    mockClient.listFiles.mockResolvedValue([]);
    mockClient.listEntries.mockResolvedValue([]);
  });

  it('currently admits a full-size UTF-8 body and writes additional frontmatter bytes', async () => {
    // This exercises the real exported worker-content validator, not a mocked
    // cap. The service-worker dispatcher adds sender/settings routing only.
    const body = '猫'.repeat(Math.floor(MAX_CONTENT_SIZE / 3)) + 'x'.repeat(MAX_CONTENT_SIZE % 3);
    const note = plainNote(body);
    expect(utf8ByteLength(note.body)).toBe(MAX_CONTENT_SIZE);
    expect(
      validateMessageContent({ action: 'saveToOutputs', outputs: ['obsidian'], data: note })
    ).toBe(true);

    const response = await handleSave({ ...settings, enableAppendMode: false }, note);

    expect(response.success).toBe(true);
    const written = mockClient.putFile.mock.calls[0][1] as string;
    expect(utf8ByteLength(written)).toBeGreaterThan(MAX_CONTENT_SIZE);
    // parseFrontmatter deliberately retains the composer-owned blank separator.
    // Boolean comparisons avoid a 32 MiB assertion diff if this regresses.
    expect(parseFrontmatter(written)!.body === `\n${body}`).toBe(true);
    expect(note.body === body).toBe(true);
  });

  it('currently writes images before the final-note PUT can refuse the note', async () => {
    const note = plainNote('![pixel](g2o-image://img-1)');
    note.images = [{ id: 'img-1', mimeType: 'image/png', data: 'UE5H', alt: 'pixel' }];
    const before = structuredClone(note);
    expect(
      validateMessageContent({ action: 'saveToOutputs', outputs: ['obsidian'], data: note })
    ).toBe(true);
    mockClient.putFile.mockRejectedValue(new Error('synthetic-final-note-refusal'));

    const response = await handleSave({ ...settings, enableAppendMode: false }, note);

    expect(response.success).toBe(false);
    expect(mockClient.putBinaryFile).toHaveBeenCalledTimes(1);
    expect(mockClient.putFile).toHaveBeenCalledTimes(1);
    expect(mockClient.putBinaryFile.mock.invocationCallOrder[0]).toBeLessThan(
      mockClient.putFile.mock.invocationCallOrder[0]
    );
    expect(note).toEqual(before);
  });
});
