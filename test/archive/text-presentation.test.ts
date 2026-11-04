import { describe, expect, it, vi } from 'vitest';
import {
  renderArchiveText,
  TEXT_PRESENTATION_LIMITS,
  TextPresentationError,
  type ArchiveBlock,
  type LiskaThreadArchive,
  type TextPresentationInput,
  type TextPresentationErrorCode,
} from '../../src/archive';
import branchingFixture from '../fixtures/archive/branching-chatgpt-thread.json';

const canonicalSha256 = 'a'.repeat(64);
const sourceRefs = [
  { format: 'synthetic/1', kind: 'block', id: null, artifactId: null, rawPointer: null },
];

function fixture(): LiskaThreadArchive {
  return structuredClone(branchingFixture) as LiskaThreadArchive;
}

function input(archive = fixture()): TextPresentationInput {
  return { archive, canonicalSha256, profile: { includeToolContent: false } };
}

function block(type: ArchiveBlock['type'], payload: Record<string, unknown>): ArchiveBlock {
  return { id: `block-${type}`, type, sourceRefs, extensions: {}, ...payload } as ArchiveBlock;
}

function withBlocks(blocks: ArchiveBlock[]): TextPresentationInput {
  const candidate = input();
  candidate.archive.graph.nodes['node-current'].message!.blocks = blocks;
  return candidate;
}

function expectFailure(candidate: unknown, code: TextPresentationErrorCode): void {
  let caught: unknown;
  try {
    renderArchiveText(candidate as TextPresentationInput);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(TextPresentationError);
  expect(caught).toMatchObject({ code, message: code });
  expect(String(caught)).toBe(`TextPresentationError: ${code}`);
}

describe('canonical-derived liska-text/1 presentation', () => {
  it('preserves the established whole-branch output byte for byte', () => {
    const candidate = withBlocks([block('text', { text: 'Exact 🦊\r\nbody.' })]);
    candidate.archive.conversation.title = null;
    candidate.targetNodeId = 'node-current';
    candidate.archive.graph.nodes['node-root'].childIds = ['node-current'];
    candidate.archive.graph.nodes['node-current'].parentId = 'node-root';
    delete candidate.archive.graph.nodes['node-user'];
    delete candidate.archive.graph.nodes['node-alternate'];
    expect(renderArchiveText(candidate).text).toBe(
      'LISKA CANONICAL TEXT READING VIEW\n=================================\n\n' +
        '[TITLE ABSENT]\n' +
        'Renderer: liska-text/1\n' +
        `Canonical SHA-256: ${canonicalSha256}\n` +
        'Notice: This is a replaceable reading view, not archive authority. Raw, manifest, and canonical artifacts retain the archival evidence for this capture.\n' +
        'Framing note: Every canonical-controlled source and metadata line is prefixed with "│ ". CRLF, lone CR, LF, U+2028, and U+2029 separators are normalized to LF in this replaceable reading view; the canonical archive retains the exact strings. Unprefixed labels and delimiters are structural reading aids, not a machine-readable format or authenticity boundary.\n\n' +
        '[STRUCTURAL NODE | NO MESSAGE]\n[END STRUCTURAL NODE | NO MESSAGE]\n\n' +
        '--- MESSAGE 1: ASSISTANT ---\n\n' +
        '[TEXT]\n│ Exact 🦊\n│ body.\n[END TEXT]\n\n' +
        '=== PRESENTATION DIAGNOSTICS ===\n' +
        '- Structural node has no message. Count: 1.\n' +
        '- Conversation title is absent. Count: 1.\n'
    );
  });

  it('renders only the exact current branch with deterministic provenance', () => {
    const result = renderArchiveText(input());
    expect(result).toMatchObject({
      schema: 'liska-text/1',
      rendererVersion: 'liska-text/1',
      selectedNodeCount: 3,
      renderedMessageCount: 2,
      canonicalSha256,
    });
    expect(result.text).toContain('Current answer starts here.');
    expect(result.text).not.toContain('Alternate <strong>answer</strong>');
    expect(result.text).toContain('replaceable reading view, not archive authority');
    expect(result.text).toContain('archival evidence for this capture');
    expect(result.text).not.toContain('retain the complete evidence');
    expect(result.diagnostics).toContainEqual({ code: 'structural-node', count: 1 });
    expect(renderArchiveText(input())).toEqual(result);
  });

  it('renders an explicit selected branch and never consults runtime or network globals', () => {
    const candidate = input();
    candidate.targetNodeId = 'node-alternate';
    const expected = renderArchiveText(candidate);
    vi.stubGlobal('fetch', () => {
      throw new Error('network forbidden');
    });
    vi.stubGlobal('chrome', undefined);
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('Date', undefined);
    try {
      expect(renderArchiveText(candidate)).toEqual(expected);
      expect(expected.text).toContain('Alternate **answer** remains a separate leaf.');
      expect(expected.text).not.toContain('Current answer starts here.');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps ordered block meaning, framed readable source, and explicit omission labels', () => {
    const candidate = input();
    candidate.archive.graph.nodes['node-current'].message!.blocks = [
      block('text', { text: 'literal text **unchanged**' }),
      block('markdown', { markdown: '# literal markdown\n<script>still text</script>' }),
      block('code', { code: 'print("hello")', language: 'python' }),
      block('html', { html: '<img src=x onerror=alert(1)>' }),
      block('reasoning', { text: 'private reasoning' }),
      block('citation', { label: null, url: null, content: { retained: true } }),
      block('quote', { text: 'quoted text', attribution: 'author' }),
      block('attachment', { assetId: 'asset-synthetic-image' }),
      block('canvas_event', { event: { retained: true } }),
      block('unknown', { providerType: 'future', raw: { retained: true } }),
    ];
    const result = renderArchiveText(candidate);
    const markers = [
      '[TEXT]',
      '[MARKDOWN SOURCE]',
      '[CODE SOURCE]',
      '[INERT PROVIDER HTML SOURCE]',
      '[TECHNICAL CONTENT OMITTED BY PROFILE]',
      '[CITATION]',
      '[QUOTE]',
      '[ATTACHMENT REFERENCE]',
      '[CANVAS EVENT RETAINED IN CANONICAL ARCHIVE]',
      '[UNKNOWN PROVIDER BLOCK]',
    ];
    let position = -1;
    for (const marker of markers) {
      const next = result.text.indexOf(marker);
      expect(next).toBeGreaterThan(position);
      position = next;
    }
    expect(result.text).toContain('│ # literal markdown\n│ <script>still text</script>');
    expect(result.text).toContain('│ <img src=x onerror=alert(1)>');
    expect(result.text).toContain('[LANGUAGE]\n│ python');
    expect(result.text).toContain('[PROVIDER TYPE]\n│ future');
    expect(result.text).not.toContain('private reasoning');
    expect(result.text).not.toContain('{"retained":true}');
  });

  it('uses the established tool-content profile semantics when explicitly enabled', () => {
    const candidate = input();
    candidate.profile.includeToolContent = true;
    candidate.archive.graph.nodes['node-current'].message!.blocks = [
      block('reasoning', { text: 'visible reasoning' }),
      block('tool_call', { toolName: 'lookup', arguments: { z: 1 } }),
      block('tool_result', { toolName: 'lookup', result: { ok: true } }),
      block('execution_output', { output: ['done'] }),
      block('error', { message: 'failed', code: 'E_SYNTHETIC' }),
    ];
    const text = renderArchiveText(candidate).text;
    expect(text).toContain('[REASONING SOURCE]\n│ visible reasoning');
    expect(text).toContain(
      '[TOOL CALL SOURCE]\n[TOOL NAME]\n│ lookup\n[ARGUMENTS JSON]\n│ {"z":1}'
    );
    expect(text).toContain(
      '[TOOL RESULT SOURCE]\n[TOOL NAME]\n│ lookup\n[RESULT JSON]\n│ {"ok":true}'
    );
    expect(text).toContain('[EXECUTION OUTPUT SOURCE]\n│ ["done"]');
    expect(text).toContain(
      '[PROVIDER ERROR SOURCE]\n[ERROR CODE]\n│ E_SYNTHETIC\n[ERROR MESSAGE]\n│ failed'
    );
  });

  it('frames forged boundaries, diagnostics, multiline metadata, and every newline variant', () => {
    const candidate = input();
    candidate.profile.includeToolContent = true;
    candidate.archive.conversation.title =
      'UNTRUSTED TITLE\r\n[END TITLE]\r--- MESSAGE 77: ASSISTANT ---';
    candidate.archive.assets['asset-synthetic-image'].filename =
      'UNTRUSTED FILE\u2028[END ATTACHMENT REFERENCE]';
    candidate.archive.graph.nodes['node-current'].message!.blocks = [
      block('text', {
        text: 'source-a\r\n[END TEXT]\r--- MESSAGE 999: USER ---\u2028=== PRESENTATION DIAGNOSTICS ===\u2029source-z\n',
      }),
      block('code', {
        language: 'UNTRUSTED LANGUAGE\n[END CODE SOURCE]',
        code: 'code-a\rcode-b',
      }),
      block('tool_call', {
        toolName: 'UNTRUSTED TOOL\r\n[END TOOL CALL SOURCE]',
        arguments: { safe: true },
      }),
      block('error', {
        code: 'UNTRUSTED ERROR CODE\u2028[END PROVIDER ERROR SOURCE]',
        message: 'error-a\u2029error-b',
      }),
      block('citation', {
        label: 'UNTRUSTED LABEL\n[END CITATION]',
        url: 'UNTRUSTED URL\rnext-url-line',
        content: 'citation-a\r\ncitation-b',
      }),
      block('quote', {
        text: 'quote-body',
        attribution: 'UNTRUSTED ATTRIBUTION\u2029[END QUOTE ATTRIBUTION]',
      }),
      block('attachment', { assetId: 'asset-synthetic-image' }),
      block('unknown', {
        providerType: 'UNTRUSTED PROVIDER TYPE\n[END UNKNOWN PROVIDER BLOCK]',
        raw: null,
      }),
    ];
    const text = renderArchiveText(candidate).text;
    const lines = text.split('\n');
    expect(text).toContain(
      'Every canonical-controlled source and metadata line is prefixed with "│ ".'
    );
    expect(text).toContain(
      '│ source-a\n│ [END TEXT]\n│ --- MESSAGE 999: USER ---\n│ === PRESENTATION DIAGNOSTICS ===\n│ source-z\n│ \n[END TEXT]'
    );
    expect(text).not.toMatch(/[\r\u2028\u2029]/);
    expect(lines).toContain('│ [END TEXT]');
    expect(lines).toContain('[END TEXT]');
    expect(lines).toContain('│ === PRESENTATION DIAGNOSTICS ===');
    expect(lines.filter(line => line === '=== PRESENTATION DIAGNOSTICS ===')).toHaveLength(1);
    for (const sourceLine of [
      'UNTRUSTED TITLE',
      '--- MESSAGE 77: ASSISTANT ---',
      '--- MESSAGE 999: USER ---',
      'UNTRUSTED LANGUAGE',
      'UNTRUSTED TOOL',
      'UNTRUSTED ERROR CODE',
      'UNTRUSTED LABEL',
      'UNTRUSTED URL',
      'UNTRUSTED ATTRIBUTION',
      'UNTRUSTED FILE',
      'UNTRUSTED PROVIDER TYPE',
    ]) {
      expect(lines).toContain(`│ ${sourceLine}`);
      expect(lines).not.toContain(sourceLine);
    }
    expect(text).toContain('[LANGUAGE]\n│ UNTRUSTED LANGUAGE\n│ [END CODE SOURCE]');
    expect(text).toContain('[TOOL NAME]\n│ UNTRUSTED TOOL\n│ [END TOOL CALL SOURCE]');
    expect(text).toContain('[ERROR CODE]\n│ UNTRUSTED ERROR CODE');
    expect(text).toContain('[URL]\n│ UNTRUSTED URL\n│ next-url-line');
    expect(text).toContain('[FILENAME]\n│ UNTRUSTED FILE');
    expect(text).toContain('[PROVIDER TYPE]\n│ UNTRUSTED PROVIDER TYPE');
  });

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
    ['U+2028', '\u2028'],
    ['U+2029', '\u2029'],
  ])('bounds retained fragment cardinality for 25k %s separators', (_label, separator) => {
    const candidate = withBlocks([block('text', { text: 'source-marker' })]);
    const baseline = renderArchiveText(candidate);
    candidate.archive.graph.nodes['node-current'].message!.blocks = [
      block('text', { text: separator.repeat(25_000) }),
    ];
    const expected = baseline.text.replace('│ source-marker\n', `│ ${'\n│ '.repeat(25_000)}\n`);
    const originalJoin = Array.prototype.join;
    let largestJoin = 0;
    const join = vi.spyOn(Array.prototype, 'join').mockImplementation(function (
      this: unknown[],
      separator?: string
    ) {
      largestJoin = Math.max(largestJoin, this.length);
      return originalJoin.call(this, separator);
    });
    let result: ReturnType<typeof renderArchiveText>;
    try {
      result = renderArchiveText(candidate);
    } finally {
      join.mockRestore();
    }
    expect(result.text).toBe(expected);
    expect(result.diagnostics).toEqual(baseline.diagnostics);
    expect(largestJoin).toBeGreaterThan(1);
    expect(largestJoin).toBeLessThanOrEqual(8192);
  });

  it('preserves nonempty, empty, and trailing lines across mixed-separator chunk boundaries', () => {
    const source = 'alpha\r\nβ\r\n\r🦊\u2028\u2029omega\n'.repeat(1500);
    const candidate = withBlocks([block('text', { text: 'source-marker' })]);
    const baseline = renderArchiveText(candidate);
    const framed = `│ ${source.replace(/\r\n|[\r\n\u2028\u2029]/g, '\n│ ')}\n`;
    candidate.archive.graph.nodes['node-current'].message!.blocks = [
      block('text', { text: source }),
    ];
    expect(renderArchiveText(candidate).text).toBe(
      baseline.text.replace('│ source-marker\n', framed)
    );
  });

  it('preserves Unicode and exact UTF-16/UTF-8 output budgets across chunk flushes', () => {
    const source = `${'x\n'.repeat(2047)}🦊\né\ud800\udc00\ud800x\udc00`;
    const candidate = withBlocks([block('text', { text: source })]);
    const before = structuredClone(candidate);
    const result = renderArchiveText(candidate);
    const byteLength = new TextEncoder().encode(result.text).byteLength;
    expect(result.text).toContain(`[TEXT]\n│ ${source.replace(/\n/g, '\n│ ')}\n[END TEXT]`);
    expect(candidate).toEqual(before);
    expect(byteLength).toBeGreaterThan(result.text.length);
    candidate.limits = { maxTextChars: result.text.length, maxTextBytes: byteLength };
    expect(renderArchiveText(candidate)).toEqual(result);
    candidate.limits.maxTextChars -= 1;
    expectFailure(candidate, 'text-output-limit');
    candidate.limits = { maxTextChars: result.text.length, maxTextBytes: byteLength - 1 };
    expectFailure(candidate, 'text-output-limit');
  });

  it.each([null, ''])(
    'distinguishes absent and empty title/citation/attachment metadata: %j',
    value => {
      const candidate = withBlocks([
        block('citation', { label: value, url: null, content: null }),
        block('attachment', { assetId: 'asset-synthetic-image' }),
      ]);
      candidate.archive.conversation.title = value;
      candidate.archive.assets['asset-synthetic-image'].filename = value;
      const result = renderArchiveText(candidate);
      const suffix = value === null ? 'absent' : 'empty';
      expect(result.diagnostics).toEqual([
        { code: `attachment-name-${suffix}`, count: 1 },
        { code: 'citation-content-absent', count: 1 },
        { code: `citation-label-${suffix}`, count: 1 },
        { code: 'citation-url-absent', count: 1 },
        { code: 'structural-node', count: 1 },
        { code: `title-${suffix}`, count: 1 },
      ]);
      if (value === null) {
        expect(result.text).toContain('[TITLE ABSENT]');
        expect(result.text).toContain('[LABEL ABSENT]\n[URL ABSENT]\n[CONTENT ABSENT]');
        expect(result.text).toContain('[FILENAME ABSENT]');
      } else {
        expect(result.text).toContain('[TITLE]\n│ \n');
        expect(result.text).toContain('[LABEL]\n│ \n[URL ABSENT]\n[CONTENT ABSENT]');
        expect(result.text).toContain('[FILENAME]\n│ \n');
      }
      expect(result.text).toContain('Count: 1.');
    }
  );

  it('counts present-but-empty content across block families and labels unspecified metadata', () => {
    const candidate = withBlocks([
      block('text', { text: '' }),
      block('markdown', { markdown: '' }),
      block('html', { html: '' }),
      block('reasoning', { text: '' }),
      block('code', { code: '', language: null }),
      block('quote', { text: '', attribution: '' }),
      block('citation', { label: 'label', url: 'https://example.test', content: '' }),
      block('tool_result', { toolName: null, result: null }),
      block('error', { code: null, message: '' }),
    ]);
    candidate.profile.includeToolContent = true;
    const result = renderArchiveText(candidate);
    expect(result.diagnostics).toEqual([
      { code: 'block-empty', count: 9 },
      { code: 'provider-html-inert', count: 1 },
      { code: 'structural-node', count: 1 },
    ]);
    expect(result.text).toContain('[LANGUAGE UNSPECIFIED]\n[CODE CONTENT]\n│ \n');
    expect(result.text).toContain('[TOOL NAME UNSPECIFIED]\n[RESULT JSON]\n│ null\n');
    expect(result.text).toContain('[ERROR CODE UNSPECIFIED]\n[ERROR MESSAGE]\n│ \n');
    expect(result.text).toContain('Block content is present but empty. Count: 9.');
  });

  it.each(['system', 'tool', 'critic', 'developer'])(
    'omits %s messages under either technical-content profile',
    role => {
      const candidate = withBlocks([block('text', { text: 'omitted-message-body' })]);
      candidate.archive.graph.nodes['node-current'].message!.author.role = role;
      for (const includeToolContent of [false, true]) {
        candidate.profile.includeToolContent = includeToolContent;
        const result = renderArchiveText(candidate);
        expect(result.renderedMessageCount).toBe(1);
        expect(result.text).not.toContain('omitted-message-body');
        expect(result.text).toContain('[NON-USER/ASSISTANT MESSAGE BODY OMITTED]');
        expect(result.diagnostics).toContainEqual({ code: 'message-role-omitted', count: 1 });
      }
    }
  );

  it.each([
    { visibility: 'hidden' },
    { visibility: 'provider-private' },
    { channel: 'analysis' },
    { channel: 'commentary' },
    { recipient: 'tool-browser' },
  ])('omits hidden/channel/tool-recipient messages under either profile: %j', fields => {
    const candidate = withBlocks([block('text', { text: 'hidden-message-body' })]);
    Object.assign(candidate.archive.graph.nodes['node-current'].message!, fields);
    for (const includeToolContent of [false, true]) {
      candidate.profile.includeToolContent = includeToolContent;
      const result = renderArchiveText(candidate);
      expect(result.renderedMessageCount).toBe(1);
      expect(result.text).not.toContain('hidden-message-body');
      expect(result.text).toContain('[HIDDEN OR TECHNICAL-CHANNEL MESSAGE BODY OMITTED]');
      expect(result.diagnostics).toContainEqual({ code: 'message-hidden-omitted', count: 1 });
    }
  });

  it('distinguishes an empty message from a structural-only target', () => {
    const candidate = withBlocks([]);
    const result = renderArchiveText(candidate);
    expect(result.renderedMessageCount).toBe(2);
    expect(result.text).toContain(
      '--- MESSAGE 2: ASSISTANT ---\n\n[EMPTY MESSAGE | NO CONTENT BLOCKS]'
    );
    expect(result.diagnostics).toContainEqual({ code: 'message-empty', count: 1 });
    candidate.targetNodeId = 'node-root';
    const structural = renderArchiveText(candidate);
    expect(structural).toMatchObject({ selectedNodeCount: 1, renderedMessageCount: 0 });
    expect(structural.diagnostics).toEqual([{ code: 'structural-node', count: 1 }]);
    expect(structural.text).not.toContain('--- MESSAGE');
  });

  it('allows unspecified message visibility/channel/recipient without inventing omissions', () => {
    const candidate = withBlocks([block('quote', { text: 'ordinary quote', attribution: null })]);
    const node = candidate.archive.graph.nodes['node-current'];
    Object.assign(node.message!, { visibility: null, channel: null, recipient: null });
    node.parentId = null;
    candidate.archive.graph = { rootIds: [node.id], nodes: { [node.id]: node } };
    const result = renderArchiveText(candidate);
    expect(result).toMatchObject({
      selectedNodeCount: 1,
      renderedMessageCount: 1,
      diagnostics: [],
    });
    expect(result.text).toContain('[QUOTE]\n│ ordinary quote\n[END QUOTE]');
    expect(result.text).toContain('No presentation omissions were detected.');
  });

  it.each(['', 'A'.repeat(64), 'abc', 'a'.repeat(65)])(
    'rejects invalid canonical digest syntax: %j',
    canonicalSha256 => {
      expectFailure({ ...input(), canonicalSha256 }, 'text-canonical-digest-invalid');
    }
  );

  it.each([null, '', 'missing-target'])('rejects invalid explicit targets: %j', targetNodeId => {
    expectFailure({ ...input(), targetNodeId }, 'text-target-invalid');
  });

  it('rejects an absent current target and malformed archives without guessing a branch', () => {
    const candidate = input();
    candidate.archive.conversation.currentNodeId = null;
    expectFailure(candidate, 'text-target-invalid');
    candidate.archive.graph.nodes['node-current'].parentId = 'missing-parent';
    expectFailure(candidate, 'text-archive-invalid');
  });

  it.each([null, {}, { includeToolContent: 'true' }, { includeToolContent: false, extra: true }])(
    'rejects invalid profiles: %j',
    profile => {
      expectFailure({ ...input(), profile }, 'text-profile-invalid');
    }
  );

  it.each([null, [], true])('rejects nonrecord inputs: %j', candidate => {
    expectFailure(candidate, 'text-input-invalid');
  });

  it('rejects unknown top-level fields rather than silently ignoring them', () => {
    expectFailure({ ...input(), extra: 'ignored-field' }, 'text-input-invalid');
  });

  it.each([
    null,
    [],
    { maxTextChars: 0 },
    { maxTextChars: -1 },
    { maxTextChars: 0.5 },
    { maxTextChars: TEXT_PRESENTATION_LIMITS.maxTextChars + 1 },
    { maxTextChars: Number.MAX_SAFE_INTEGER + 1 },
    { typoBudget: 1 },
  ])('rejects invalid limits and attempts to raise hard ceilings: %j', limits => {
    expectFailure({ ...input(), limits }, 'text-limits-invalid');
  });

  it.each([
    ['maxInputJsonNodes', 'text-input-node-limit'],
    ['maxInputJsonDepth', 'text-input-depth-limit'],
    ['maxInputChars', 'text-input-char-limit'],
    ['maxSelectedNodes', 'text-selected-node-limit'],
    ['maxSelectedBlocks', 'text-selected-block-limit'],
    ['maxSourceChars', 'text-source-char-limit'],
    ['maxTextChars', 'text-output-limit'],
    ['maxTextBytes', 'text-output-limit'],
    ['maxJsonSerializationChars', 'text-json-serialization-limit'],
  ] as const)('enforces a tightened %s budget with a value-free public error', (name, code) => {
    const candidate = input();
    candidate.profile.includeToolContent = true;
    candidate.limits = { [name]: 1 };
    expectFailure(candidate, code);
  });

  it.each(['title', 'hidden-block', 'attachment-name', 'unknown-block'])(
    'includes %s in the selected source budget',
    field => {
      const candidate = withBlocks([]);
      const largeSource = 'x'.repeat(1000);
      if (field === 'title') candidate.archive.conversation.title = largeSource;
      else if (field === 'attachment-name') {
        candidate.archive.graph.nodes['node-current'].message!.blocks = [
          block('attachment', { assetId: 'asset-synthetic-image' }),
        ];
        candidate.archive.assets['asset-synthetic-image'].filename = largeSource;
      } else {
        candidate.archive.graph.nodes['node-current'].message!.blocks = [
          field === 'hidden-block'
            ? block('reasoning', { text: largeSource })
            : block('unknown', { providerType: 'synthetic', raw: { source: largeSource } }),
        ];
        if (field === 'hidden-block')
          candidate.archive.graph.nodes['node-current'].message!.visibility = 'hidden';
      }
      candidate.limits = { maxSourceChars: 500 };
      expectFailure(candidate, 'text-source-char-limit');
    }
  );

  it('accounts for escaped JSON size cumulatively only when technical content is included', () => {
    const candidate = withBlocks([
      block('tool_result', { id: 'result-one', toolName: null, result: '\u0000'.repeat(5) }),
      block('tool_result', { id: 'result-two', toolName: null, result: '\u0000'.repeat(5) }),
    ]);
    candidate.limits = { maxJsonSerializationChars: 40 };
    expect(renderArchiveText(candidate).diagnostics).toContainEqual({
      code: 'technical-content-omitted',
      count: 2,
    });
    candidate.profile.includeToolContent = true;
    expectFailure(candidate, 'text-json-serialization-limit');
    candidate.limits.maxJsonSerializationChars = 64;
    expect(renderArchiveText(candidate).text).toContain(`│ "${'\\u0000'.repeat(5)}"`);
  });

  it('fails closed with value-free bounded errors', () => {
    const candidate = input();
    candidate.limits = { maxTextBytes: 100 };
    expect(() => renderArchiveText(candidate)).toThrow(TextPresentationError);
    try {
      renderArchiveText(candidate);
    } catch (error) {
      expect(error).toMatchObject({ code: 'text-output-limit', message: 'text-output-limit' });
      expect(String(error)).not.toContain('Current answer');
    }
  });
});
