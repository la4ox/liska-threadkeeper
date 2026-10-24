import { describe, expect, it, vi } from 'vitest';
import {
  HTML_PRESENTATION_LIMITS,
  HtmlPresentationError,
  renderArchiveHtml,
  validateLiskaThreadArchive,
  type ArchiveBlock,
  type HtmlAssetBinding,
  type HtmlPresentationInput,
  type HtmlPresentationLimits,
  type LiskaThreadArchive,
} from '../../src/archive';
import branchingFixture from '../fixtures/archive/branching-chatgpt-thread.json';

vi.mock('mdast-util-from-markdown', async importOriginal => {
  const actual = await importOriginal<typeof import('mdast-util-from-markdown')>();
  return {
    ...actual,
    fromMarkdown(source: string) {
      if (source === 'synthetic-unsupported-markdown') {
        return {
          type: 'root',
          children: [{ type: 'future-node', value: 'never silently disappear' }],
        };
      }
      return actual.fromMarkdown(source);
    },
  };
});

const canonicalSha256 = 'a'.repeat(64);
const assetSha256 = 'b'.repeat(64);
const bindingSha256 = 'c'.repeat(64);
const assetId = 'asset-synthetic-image';
const sourceRefs = [
  { format: 'synthetic/1', kind: 'block', id: null, artifactId: null, rawPointer: null },
];

function fixture(): LiskaThreadArchive {
  return JSON.parse(JSON.stringify(branchingFixture)) as LiskaThreadArchive;
}

function input(archive = fixture()): HtmlPresentationInput {
  return { archive, canonicalSha256, profile: { includeToolContent: false } };
}

function render(candidate = input()) {
  return renderArchiveHtml(candidate);
}

function block(type: ArchiveBlock['type'], payload: Record<string, unknown>): ArchiveBlock {
  return { id: `block-${type}`, type, sourceRefs, extensions: {}, ...payload } as ArchiveBlock;
}

function withBlocks(blocks: ArchiveBlock[]): HtmlPresentationInput {
  const candidate = input();
  candidate.archive.graph.nodes['node-current'].message!.blocks = blocks;
  return candidate;
}

function withMarkdown(markdown: string): HtmlPresentationInput {
  return withBlocks([block('markdown', { markdown })]);
}

function documentOf(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function codes(candidate: HtmlPresentationInput): string[] {
  return render(candidate).diagnostics.map(entry => entry.code);
}

function expectFailure(candidate: unknown, code: string): void {
  let caught: unknown;
  try {
    renderArchiveHtml(candidate as HtmlPresentationInput);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(HtmlPresentationError);
  expect(caught).toMatchObject({ code, message: code });
}

function binding(
  candidate: HtmlPresentationInput,
  overrides: Partial<HtmlAssetBinding> = {}
): HtmlAssetBinding {
  const result: HtmlAssetBinding = {
    assetId,
    path: `assets/${assetSha256}.png`,
    sha256: assetSha256,
    mimeType: 'image/png',
    byteLength: 42,
    renderMode: 'image',
    ...overrides,
  };
  const asset = candidate.archive.assets[assetId];
  asset.sha256 = result.sha256;
  asset.mimeType = result.mimeType;
  asset.byteLength = result.byteLength;
  return result;
}

function deepFreeze(value: unknown): void {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
}

describe('canonical-derived liska-html/1 presentation', () => {
  it('uses a provider-neutral exact current path and provenance with no runtime/destination input', () => {
    const candidate = input();
    candidate.archive.conversation.provider = 'future-provider';
    const result = render(candidate);
    expect(result).toMatchObject({
      schema: 'liska-html/1',
      rendererVersion: 'liska-html/1',
      selectedNodeCount: 3,
      renderedMessageCount: 2,
      canonicalSha256,
      assetBindingSha256: null,
    });
    expect(result.html).toContain('Current answer starts here.');
    expect(result.html).not.toContain('Alternate <strong>answer</strong>');
    expect(result.diagnostics).toContainEqual({ code: 'structural-node', count: 1 });
    expect(result.html).toContain('not a lossless backup');
  });

  it('selects an explicit alternate branch and excludes all current-branch bodies', () => {
    const candidate = input();
    candidate.targetNodeId = 'node-alternate';
    const result = render(candidate);
    expect(result.selectedNodeCount).toBe(3);
    expect(result.html).toContain('Alternate <strong>answer</strong>');
    expect(result.html).not.toContain('Current answer starts here.');
    expect(result.html).not.toContain('Synthetic hidden reasoning');
  });

  it('renders a structural-only target explicitly without inventing a message', () => {
    const candidate = input();
    candidate.targetNodeId = 'node-root';
    expect(render(candidate)).toMatchObject({ selectedNodeCount: 1, renderedMessageCount: 0 });
    expect(render(candidate).html).toContain('Structural node: no message.');
  });

  it('is deterministic and leaves every archive/input field unchanged, including frozen inputs', () => {
    const candidate = input();
    const before = JSON.stringify(candidate);
    deepFreeze(candidate);
    expect(render(candidate)).toEqual(render(candidate));
    expect(JSON.stringify(candidate)).toBe(before);
  });

  it('does not depend on document, window, Chrome, network, storage, or the current clock', () => {
    const candidate = input();
    const expected = render(candidate);
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('chrome', undefined);
    vi.stubGlobal('fetch', () => {
      throw new Error('network forbidden');
    });
    vi.stubGlobal('Date', undefined);
    try {
      expect(render(candidate)).toEqual(expected);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('handles every block family in ordered position without exposing opaque or technical bodies by default', () => {
    const candidate = withBlocks([
      block('text', { text: 'ordered-text' }),
      block('markdown', { markdown: '**ordered-markdown**' }),
      block('html', { html: '<script>ordered-html</script>' }),
      block('code', { code: 'ordered-code', language: 'synthetic' }),
      block('reasoning', { text: 'secret-reasoning' }),
      block('tool_call', { toolName: 'secret-tool-name', arguments: { secret: 'tool-arguments' } }),
      block('tool_result', { toolName: 'secret-tool-name', result: { secret: 'tool-result' } }),
      block('execution_output', { output: 'secret-execution' }),
      block('citation', {
        label: 'ordered-citation',
        url: 'https://example.test/citation',
        content: 'citation excerpt',
      }),
      block('quote', { text: 'ordered-quote', attribution: 'quoted author' }),
      block('attachment', { assetId }),
      block('canvas_event', { event: { secret: 'canvas-payload' } }),
      block('error', { message: 'secret-error', code: 'secret-error-code' }),
      block('unknown', {
        providerType: 'secret-provider-type',
        raw: { secret: 'unknown-payload' },
      }),
    ]);
    expect(validateLiskaThreadArchive(candidate.archive).valid).toBe(true);
    const result = render(candidate);
    const body = documentOf(result.html).querySelectorAll('article')[1].textContent!;
    let last = -1;
    for (const marker of [
      'ordered-text',
      'ordered-markdown',
      'ordered-html',
      'ordered-code',
      'Technical content omitted',
      'ordered-citation',
      'ordered-quote',
      'Attachment reference',
      'Canvas event',
      'Unknown provider block',
    ]) {
      const next = body.indexOf(marker);
      expect(next).toBeGreaterThan(last);
      last = next;
    }
    for (const omitted of [
      'secret-reasoning',
      'secret-tool-name',
      'tool-arguments',
      'tool-result',
      'secret-execution',
      'canvas-payload',
      'secret-error',
      'secret-provider-type',
      'unknown-payload',
    ]) {
      expect(result.html).not.toContain(omitted);
    }
    expect(result.diagnostics).toContainEqual({ code: 'technical-content-omitted', count: 5 });
    expect(result.diagnostics).toContainEqual({ code: 'provider-html-inert', count: 1 });
    expect(result.diagnostics).toContainEqual({ code: 'canvas-unsupported', count: 1 });
    expect(result.diagnostics).toContainEqual({ code: 'unknown-unsupported', count: 1 });
  });

  it('renders technical blocks only when enabled, with escaped bounded structured JSON', () => {
    const candidate = withBlocks([
      block('reasoning', { text: '<reasoning-secret>' }),
      block('tool_call', {
        toolName: '<call>',
        arguments: { a: ['one', { b: '<two>' }], q: 3, z: null },
      }),
      block('tool_result', { toolName: null, result: ['<result>', false] }),
      block('execution_output', { output: { text: '<execution>' } }),
      block('error', { message: '<error>', code: '<code>' }),
    ]);
    candidate.profile.includeToolContent = true;
    const result = render(candidate);
    const document = documentOf(result.html);
    const values = [...document.querySelectorAll('article:nth-of-type(2) pre code')].map(
      node => node.textContent
    );
    expect(values).toEqual([
      '<reasoning-secret>',
      '{"a":["one",{"b":"<two>"}],"q":3,"z":null}',
      '["<result>",false]',
      '{"text":"<execution>"}',
      '<error>',
    ]);
    expect(codes(candidate)).not.toContain('technical-content-omitted');
    expect(document.querySelector('reasoning-secret,call,result,execution,error')).toBeNull();
  });

  it.each(['system', 'tool', 'critic', 'developer'])(
    'never renders %s message bodies, even with technical blocks enabled',
    role => {
      const candidate = withBlocks([block('text', { text: 'role-secret-body' })]);
      candidate.archive.graph.nodes['node-current'].message!.author.role = role;
      candidate.profile.includeToolContent = true;
      const result = render(candidate);
      expect(result.html).not.toContain('role-secret-body');
      expect(result.renderedMessageCount).toBe(1);
      expect(result.diagnostics).toContainEqual({ code: 'message-role-omitted', count: 1 });
    }
  );

  it.each([
    { visibility: 'hidden' },
    { visibility: 'provider-private' },
    { channel: 'analysis' },
    { channel: 'commentary' },
    { recipient: 'tool-browser' },
  ])('never reveals hidden/channel/tool-recipient bodies under either profile: %j', fields => {
    const candidate = withBlocks([block('text', { text: 'hidden-message-secret' })]);
    Object.assign(candidate.archive.graph.nodes['node-current'].message!, fields);
    for (const enabled of [false, true]) {
      candidate.profile.includeToolContent = enabled;
      expect(render(candidate).html).not.toContain('hidden-message-secret');
      expect(codes(candidate)).toContain('message-hidden-omitted');
    }
  });

  it('distinguishes absent title, empty title/block/message, structural nodes and unsupported blocks', () => {
    const candidate = withBlocks([]);
    candidate.archive.conversation.title = null;
    expect(codes(candidate)).toEqual(
      expect.arrayContaining(['title-absent', 'message-empty', 'structural-node'])
    );
    candidate.archive.conversation.title = '';
    candidate.archive.graph.nodes['node-current'].message!.blocks = [
      block('text', { text: '' }),
      block('markdown', { markdown: '' }),
    ];
    const result = render(candidate);
    expect(result.diagnostics).toContainEqual({ code: 'block-empty', count: 2 });
    expect(codes(candidate)).toContain('title-empty');
    expect(codes(candidate)).not.toContain('title-absent');
  });

  it('escapes hostile text, title, language, quote, attribution and filenames without active attributes', () => {
    const hostile = '"><img src=https://evil.test onerror=alert(1)><script>bad()</script>&\'';
    const candidate = withBlocks([
      block('text', { text: hostile }),
      block('code', { code: hostile, language: hostile }),
      block('quote', { text: hostile, attribution: hostile }),
      block('attachment', { assetId }),
    ]);
    candidate.archive.conversation.title = hostile;
    candidate.archive.assets[assetId].filename = hostile;
    const result = render(candidate);
    const document = documentOf(result.html);
    expect(document.querySelector('script,img,[onerror],[onload]')).toBeNull();
    expect(document.querySelector('h1')!.textContent).toBe(hostile);
    expect(result.html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
  });

  it('renders provider HTML and Markdown HTML only as labelled inert source', () => {
    const payload =
      '<iframe src="https://evil.test"></iframe><style>body{display:none}</style><base href="https://evil.test"><form><input autofocus onfocus="bad()"></form>';
    const candidate = withBlocks([
      block('html', { html: payload }),
      block('markdown', { markdown: payload }),
    ]);
    const result = render(candidate);
    const document = documentOf(result.html);
    expect(document.querySelector('iframe,base,form,input')).toBeNull();
    expect(document.querySelectorAll('style')).toHaveLength(1);
    expect(document.body.textContent).toContain(payload);
    expect(
      result.diagnostics.find(entry => entry.code === 'provider-html-inert')!.count
    ).toBeGreaterThanOrEqual(2);
  });

  it('uses a strict CommonMark AST allowlist for headings, lists, quotes, emphasis, code and breaks', () => {
    const candidate = withMarkdown(
      '# Header\n\nA **strong** and *emphasis* and `code`.\n\n> quote\n\n3. one\n4. two\n\n- bullet\n\nline  \nbreak\n\n---\n\n```html\n<script>code only</script>\n```'
    );
    const document = documentOf(render(candidate).html);
    expect(document.querySelector('main h1')!.textContent).toBe('Header');
    expect(document.querySelector('main ol')!.getAttribute('start')).toBe('3');
    expect(document.querySelectorAll('main li')).toHaveLength(3);
    expect(document.querySelector('main strong')!.textContent).toBe('strong');
    expect(document.querySelector('main em')!.textContent).toBe('emphasis');
    expect(document.querySelector('main blockquote')!.textContent).toBe('quote');
    expect(document.querySelector('main br')).not.toBeNull();
    expect(document.querySelector('main hr')).not.toBeNull();
    expect(document.querySelector('main script')).toBeNull();
  });

  it('allows only user-activated exact http/https links with noopener/noreferrer', () => {
    const candidate = withMarkdown(
      '[safe](https://example.test/a?q=%22&other=1) and <http://example.test/path>'
    );
    candidate.archive.graph.nodes['node-current'].message!.blocks.push(
      block('citation', { label: 'source', url: 'https://example.test/source', content: null })
    );
    const anchors = [...documentOf(render(candidate).html).querySelectorAll('a')];
    expect(anchors.map(anchor => anchor.getAttribute('href'))).toEqual([
      'https://example.test/a?q=%22&other=1',
      'http://example.test/path',
      'https://example.test/source',
    ]);
    for (const anchor of anchors) {
      expect(anchor.getAttribute('target')).toBe('_blank');
      expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,bad',
    'file:///C:/secret',
    '//evil.test/a',
    '/relative',
    'https://user:password@example.test/a',
    'https://@example.test/a',
    ' https://example.test',
    'https://example.test/ bad',
    'https://example.test/\\bad',
    'https:example.test',
    'mailto:foo@example.test',
    'https://example.test/\u0000bad',
    'not a url',
    '',
  ])('retains unsafe citation URLs as inert text: %j', url => {
    const candidate = withBlocks([block('citation', { label: 'unsafe', url, content: null })]);
    const result = render(candidate);
    expect(documentOf(result.html).querySelector('a')).toBeNull();
    expect(codes(candidate)).toContain('unsafe-link-inert');
    expect(
      result.diagnostics.every(entry => !JSON.stringify(entry).includes(url || 'unsafe-value'))
    ).toBe(true);
  });

  it('blocks unsafe Markdown links including entity-decoded schemes and credentialed reference links', () => {
    const candidate = withMarkdown(
      '[unsafe](javascript:alert%281%29) [entity](jav&#x61;script:bad) [credentials][ref]\n\n[ref]: https://user:pass@example.test/secret'
    );
    const result = render(candidate);
    expect(documentOf(result.html).querySelector('a')).toBeNull();
    expect(result.diagnostics).toContainEqual({ code: 'unsafe-link-inert', count: 3 });
  });

  it('never loads Markdown images, including reference-style images and data URLs', () => {
    const candidate = withMarkdown(
      '![remote-alt](https://evil.test/image.png) ![data-alt](data:image/png;base64,AA) ![reference-alt][pic]\n\n[pic]: https://evil.test/other.png'
    );
    const result = render(candidate);
    expect(documentOf(result.html).querySelector('img,source,video,audio')).toBeNull();
    expect(result.diagnostics).toContainEqual({ code: 'markdown-image-reference', count: 3 });
    expect(documentOf(result.html).body.textContent).toContain('remote-alt');
  });

  it('does not silently drop unsupported AST nodes', () => {
    const candidate = withMarkdown('synthetic-unsupported-markdown');
    expect(render(candidate).html).toContain('synthetic-unsupported-markdown');
    expect(codes(candidate)).toContain('markdown-node-unsupported');
  });

  it('keeps structured citation payloads inert/unsupported and distinguishes nullable citation fields', () => {
    const candidate = withBlocks([
      block('citation', { label: null, url: null, content: null }),
      {
        ...block('citation', { label: '', url: '', content: { private: 'opaque-citation-data' } }),
        id: 'citation-second',
      },
    ]);
    expect(codes(candidate)).toEqual(
      expect.arrayContaining([
        'citation-label-absent',
        'citation-label-empty',
        'citation-url-absent',
        'citation-content-absent',
        'citation-content-unsupported',
        'unsafe-link-inert',
      ])
    );
    expect(render(candidate).html).not.toContain('opaque-citation-data');
  });

  it.each([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/gif', 'gif'],
    ['image/webp', 'webp'],
  ])('embeds only verified inert %s local image bindings', (mimeType, extension) => {
    const candidate = withBlocks([block('attachment', { assetId })]);
    const record = binding(candidate, { mimeType, path: `assets/${assetSha256}.${extension}` });
    candidate.assetBindings = { bindings: [record], sha256: bindingSha256 };
    const result = render(candidate);
    const image = documentOf(result.html).querySelector('img')!;
    expect(image.getAttribute('src')).toBe(`assets/${assetSha256}.${extension}`);
    expect(result.assetBindingSha256).toBe(bindingSha256);
    expect(codes(candidate)).not.toContain('attachment-unbound');
  });

  it.each([
    ['application/pdf', 'pdf'],
    ['text/plain', 'txt'],
    ['image/avif', 'avif'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ])(
    'offers verified %s only as a local download, never embedded content',
    (mimeType, extension) => {
      const candidate = withBlocks([block('attachment', { assetId })]);
      const record = binding(candidate, {
        mimeType,
        path: `assets/${assetSha256}.${extension}`,
        renderMode: 'download',
      });
      candidate.assetBindings = { bindings: [record], sha256: bindingSha256 };
      const document = documentOf(render(candidate).html);
      expect(document.querySelector('img,iframe,object,embed,video,audio')).toBeNull();
      expect(document.querySelector('a[download]')!.getAttribute('href')).toBe(record.path);
    }
  );

  it('does not infer a binding from canonical paths or fetched state', () => {
    const candidate = withBlocks([block('attachment', { assetId })]);
    candidate.archive.assets[assetId].localArtifactRef = 'https://evil.test/secret';
    const result = render(candidate);
    expect(result.html).not.toContain('https://evil.test/secret');
    expect(documentOf(result.html).querySelector('img,a')).toBeNull();
    expect(codes(candidate)).toContain('attachment-unbound');
  });

  it('accepts an explicitly empty binding set only with a null digest', () => {
    const candidate = input();
    candidate.assetBindings = { bindings: [], sha256: null };
    expect(render(candidate).assetBindingSha256).toBeNull();
    candidate.assetBindings.sha256 = bindingSha256;
    expectFailure(candidate, 'html-bindings-invalid');
  });

  it.each([
    '../assets/hash.png',
    '/assets/hash.png',
    'assets/../hash.png',
    'assets/%2e%2e/hash.png',
    'assets\\hash.png',
    `assets/${assetSha256}.png?query=1`,
    `assets/${assetSha256}.png#x`,
    `https://evil.test/assets/${assetSha256}.png`,
    `assets/${assetSha256}.jpg`,
  ])('fails closed for nonexact/traversal binding paths: %s', path => {
    const candidate = input();
    const record = binding(candidate, { path });
    candidate.assetBindings = { bindings: [record], sha256: bindingSha256 };
    expectFailure(candidate, 'html-bindings-invalid');
  });

  it.each([
    'image/svg+xml',
    'text/html',
    'application/javascript',
    'image/AVIF',
    'image/png; charset=utf-8',
  ])('rejects active/unsupported MIME bindings: %s', mimeType => {
    const candidate = input();
    const record = binding(candidate, { mimeType });
    candidate.assetBindings = { bindings: [record], sha256: bindingSha256 };
    expectFailure(candidate, 'html-bindings-invalid');
  });

  it.each([
    { sha256: 'D'.repeat(64) },
    { sha256: 'not-a-digest' },
    { byteLength: -1 },
    { byteLength: 0.5 },
    { byteLength: Number.MAX_SAFE_INTEGER + 1 },
    { renderMode: 'script' },
    { mimeType: 'application/pdf', path: `assets/${assetSha256}.pdf`, renderMode: 'image' },
  ])('rejects malformed binding records: %j', override => {
    const candidate = input();
    const record = binding(candidate);
    Object.assign(record, override);
    candidate.assetBindings = { bindings: [record], sha256: bindingSha256 };
    expectFailure(candidate, 'html-bindings-invalid');
  });

  it.each(['sha256', 'mimeType', 'byteLength', 'acquisition', 'assetId'])(
    'rejects receipts mismatching canonical %s',
    field => {
      const candidate = input();
      const record = binding(candidate);
      candidate.assetBindings = { bindings: [record], sha256: bindingSha256 };
      const asset = candidate.archive.assets[assetId];
      if (field === 'sha256') asset.sha256 = 'd'.repeat(64);
      if (field === 'mimeType') asset.mimeType = 'image/jpeg';
      if (field === 'byteLength') asset.byteLength = 43;
      if (field === 'acquisition') asset.acquisition.state = 'expired';
      if (field === 'assetId') record.assetId = 'missing-secret-id';
      expectFailure(candidate, 'html-binding-mismatch');
    }
  );

  it('rejects duplicate asset IDs, unknown binding keys and missing/nonlowercase binding digests', () => {
    const candidate = input();
    const record = binding(candidate);
    candidate.assetBindings = { bindings: [record, { ...record }], sha256: bindingSha256 };
    expectFailure(candidate, 'html-bindings-invalid');
    candidate.assetBindings.bindings = [{ ...record, extra: true } as HtmlAssetBinding];
    expectFailure(candidate, 'html-bindings-invalid');
    candidate.assetBindings.bindings = [record];
    for (const digest of [null, '', 'D'.repeat(64)]) {
      candidate.assetBindings.sha256 = digest;
      expectFailure(candidate, 'html-bindings-invalid');
    }
  });

  it('allows exact content-identical aliases but rejects conflicting same-path receipts', () => {
    const candidate = input();
    const first = binding(candidate);
    candidate.archive.assets['alias-asset'] = {
      ...candidate.archive.assets[assetId],
      id: 'alias-asset',
    };
    const second = { ...first, assetId: 'alias-asset' };
    candidate.assetBindings = { bindings: [first, second], sha256: bindingSha256 };
    expect(() => render(candidate)).not.toThrow();
    candidate.archive.assets['alias-asset'].byteLength = 43;
    second.byteLength = 43;
    expectFailure(candidate, 'html-binding-mismatch');
  });

  it('distinguishes absent and empty attachment names without making either a path', () => {
    const candidate = withBlocks([block('attachment', { assetId })]);
    candidate.archive.assets[assetId].filename = null;
    expect(codes(candidate)).toContain('attachment-name-absent');
    candidate.archive.assets[assetId].filename = '';
    expect(codes(candidate)).toContain('attachment-name-empty');
  });

  it.each(['', 'A'.repeat(64), 'abc', 'a'.repeat(65)])(
    'rejects noncanonical SHA-256 provenance syntax: %s',
    digest => {
      const candidate = input();
      candidate.canonicalSha256 = digest;
      expectFailure(candidate, 'html-canonical-digest-invalid');
    }
  );

  it('rejects invalid archives through the existing validator before presentation', () => {
    const candidate = input();
    candidate.archive.graph.nodes['node-current'].parentId = 'missing-private-id';
    expectFailure(candidate, 'html-archive-invalid');
    (candidate.archive as unknown as Record<string, unknown>).extra = 'private';
    expectFailure(candidate, 'html-archive-invalid');
  });

  it.each([null, '', 'missing-private-target', 'node-current-extra'])(
    'rejects unavailable/invalid explicit branch targets: %j',
    targetNodeId => {
      const candidate = input();
      candidate.targetNodeId = targetNodeId as string;
      expectFailure(candidate, 'html-target-invalid');
    }
  );

  it('rejects an absent current target without guessing a root or leaf', () => {
    const candidate = input();
    candidate.archive.conversation.currentNodeId = null;
    expectFailure(candidate, 'html-target-invalid');
  });

  it('rejects invalid/missing profiles and extra input fields', () => {
    const candidate = input();
    (candidate.profile as unknown as Record<string, unknown>).includeToolContent = 'true';
    expectFailure(candidate, 'html-profile-invalid');
    expectFailure({ ...input(), profile: {} }, 'html-profile-invalid');
    expectFailure({ ...input(), extra: true }, 'html-input-invalid');
  });

  it('rejects accessors, cycles, functions and sparse arrays before core validation can execute them', () => {
    const getter = vi.fn(() => {
      throw new Error('private-getter-value');
    });
    const candidate = input();
    Object.defineProperty(candidate.archive.conversation.metadata, 'unsafe', {
      enumerable: true,
      get: getter,
    });
    expectFailure(candidate, 'html-input-invalid');
    expect(getter).not.toHaveBeenCalled();
    const cyclic = input();
    cyclic.archive.extensions.synthetic = cyclic.archive.extensions;
    expectFailure(cyclic, 'html-input-invalid');
    const custom = input();
    custom.archive.extensions.synthetic = { toJSON: (() => 'private') as never };
    expectFailure(custom, 'html-input-invalid');
    const sparse = input();
    sparse.archive.extensions.synthetic = Array(3);
    expectFailure(sparse, 'html-input-invalid');
  });

  it('rejects arrays with inherited behavior before a validator can invoke it', () => {
    const candidate = input();
    const inheritedForEach = vi.fn(() => {
      throw new Error('inherited-array-behavior-must-not-run');
    });
    const prototype = Object.create(Array.prototype) as Record<string, unknown>;
    Object.defineProperty(prototype, 'forEach', {
      enumerable: false,
      get: inheritedForEach,
    });
    Object.setPrototypeOf(candidate.archive.graph.rootIds, prototype);

    expectFailure(candidate, 'html-input-invalid');
    expect(inheritedForEach).not.toHaveBeenCalled();
  });

  it.each([
    ['maxInputJsonNodes', 1, 'html-input-node-limit'],
    ['maxInputJsonDepth', 1, 'html-input-depth-limit'],
    ['maxInputChars', 1, 'html-input-char-limit'],
    ['maxSelectedNodes', 1, 'html-selected-node-limit'],
    ['maxSelectedBlocks', 1, 'html-selected-block-limit'],
    ['maxSourceChars', 1, 'html-source-char-limit'],
    ['maxHtmlChars', 1, 'html-output-limit'],
    ['maxHtmlBytes', 1, 'html-output-limit'],
    ['maxMarkdownChars', 2, 'html-markdown-char-limit'],
    ['maxMarkdownContainerRun', 1, 'html-markdown-container-limit'],
    ['maxMarkdownContainerTokens', 1, 'html-markdown-container-limit'],
    ['maxMarkdownNodes', 1, 'html-markdown-node-limit'],
    ['maxMarkdownDepth', 1, 'html-markdown-depth-limit'],
    ['maxJsonSerializationChars', 1, 'html-json-serialization-limit'],
  ] as const)('enforces %s without returning a partial artifact', (name, limit, code) => {
    const candidate = input();
    if (name === 'maxMarkdownContainerRun' || name === 'maxMarkdownContainerTokens')
      candidate.archive.graph.nodes['node-current'].message!.blocks = [
        block('markdown', { markdown: '> > nested markdown' }),
      ];
    else if (name.startsWith('maxMarkdown'))
      candidate.archive.graph.nodes['node-current'].message!.blocks = [
        block('markdown', { markdown: '> **nested markdown**' }),
      ];
    if (name === 'maxJsonSerializationChars') candidate.profile.includeToolContent = true;
    candidate.limits = { [name]: limit };
    expectFailure(candidate, code);
  });

  it('enforces a total selected source budget on hidden/unsupported blocks too', () => {
    const candidate = withBlocks([
      block('unknown', { providerType: 'synthetic', raw: { text: 'x'.repeat(5000) } }),
    ]);
    candidate.limits = { maxSourceChars: 1000 };
    expectFailure(candidate, 'html-source-char-limit');
  });

  it('bounds asset-binding count before iterating records', () => {
    const candidate = input();
    const first = binding(candidate);
    candidate.archive.assets['alias'] = { ...candidate.archive.assets[assetId], id: 'alias' };
    candidate.assetBindings = {
      bindings: [first, { ...first, assetId: 'alias' }],
      sha256: bindingSha256,
    };
    candidate.limits = { maxAssetBindings: 1 };
    expectFailure(candidate, 'html-binding-count-limit');
  });

  it.each([0, -1, 0.1, HTML_PRESENTATION_LIMITS.maxHtmlChars + 1])(
    'rejects invalid budgets and attempts to raise ceilings: %j',
    maxHtmlChars => {
      const candidate = input();
      candidate.limits = { maxHtmlChars };
      expectFailure(candidate, 'html-limits-invalid');
    }
  );

  it('rejects unknown budget keys rather than ignoring them', () => {
    const candidate = input();
    candidate.limits = { typoBudget: 5 } as Partial<HtmlPresentationLimits>;
    expectFailure(candidate, 'html-limits-invalid');
  });

  it('applies tightened input budgets on the first archive traversal', () => {
    const candidate = input();
    candidate.archive.conversation.title = 'large-before-any-render'.repeat(10);
    candidate.limits = { maxInputChars: 1 };
    expectFailure(candidate, 'html-input-char-limit');
  });

  it('enforces UTF-8 output bytes independently of UTF-16 character count', () => {
    const candidate = withBlocks([block('text', { text: '🦊' })]);
    candidate.limits = { maxHtmlChars: 100_000, maxHtmlBytes: 1 };
    expectFailure(candidate, 'html-output-limit');
  });

  it('caps nested JSON before recursive core extension validation', () => {
    const candidate = input();
    let nested: Record<string, unknown> = {};
    candidate.archive.extensions.synthetic = nested as never;
    for (let index = 0; index < 120; index++) {
      const child = {};
      nested.child = child;
      nested = child;
    }
    expectFailure(candidate, 'html-input-depth-limit');
  });

  it('bounds JSON serialization by its escaped size across all technical blocks', () => {
    const candidate = withBlocks([
      block('tool_result', { toolName: null, result: '\u0000'.repeat(30) }),
    ]);
    candidate.profile.includeToolContent = true;
    candidate.limits = { maxJsonSerializationChars: 100 };
    expectFailure(candidate, 'html-json-serialization-limit');
  });

  it('bounds Markdown AST work in aggregate across blocks rather than resetting per block', () => {
    const candidate = withBlocks([
      block('markdown', { markdown: 'one' }),
      { ...block('markdown', { markdown: 'two' }), id: 'markdown-two' },
    ]);
    candidate.limits = { maxMarkdownNodes: 4 };
    expectFailure(candidate, 'html-markdown-node-limit');
  });

  it('rejects obvious pathological Markdown nesting before expensive AST construction', () => {
    const candidate = withMarkdown(`${'> '.repeat(50_000)}x`);
    candidate.limits = { maxMarkdownDepth: 1 };
    const startedAt = performance.now();

    expectFailure(candidate, 'html-markdown-depth-limit');
    expect(performance.now() - startedAt).toBeLessThan(1_500);
  });

  it('rejects obvious pathological list nesting before expensive AST construction', () => {
    const candidate = withMarkdown(`${'- '.repeat(50_000)}x`);
    candidate.limits = { maxMarkdownDepth: 1 };
    const startedAt = performance.now();

    expectFailure(candidate, 'html-markdown-depth-limit');
    expect(performance.now() - startedAt).toBeLessThan(1_500);
  });

  it('does not mistake fenced code containing quote markers for Markdown nesting', () => {
    const source = `\`\`\`text\n${'> '.repeat(1_024)}x\n\`\`\``;
    const candidate = withMarkdown(source);
    candidate.limits = { maxMarkdownDepth: 1 };

    expect(render(candidate).html).toContain('&gt; &gt; &gt;');
  });

  it.each([
    ['invalid backtick info string', `\`\`\`x\`\n${'> '.repeat(50_000)}x`],
    ['CommonMark lone-CR line ending', `prefix\r${'> '.repeat(50_000)}x`],
  ])('does not let %s bypass the early nesting guard', (_label, source) => {
    const candidate = withMarkdown(source);
    candidate.limits = { maxMarkdownDepth: 1 };
    const startedAt = performance.now();

    expectFailure(candidate, 'html-markdown-depth-limit');
    expect(performance.now() - startedAt).toBeLessThan(1_500);
  });

  it('treats NBSP as code content rather than a CommonMark closing-fence suffix', () => {
    const source = `\`\`\`\n\`\`\`\u00a0\n${'> '.repeat(128)}x\n\`\`\``;
    const candidate = withMarkdown(source);
    candidate.limits = { maxMarkdownDepth: 1 };

    expect(render(candidate).html).toContain('&gt; &gt; &gt;');
  });

  it.each([
    [
      'a desynchronized closing fence',
      `\`\`\`\n\`\`\`\u00a0\n\`\`\`\n${'> '.repeat(50_000)}x`,
      'html-markdown-depth-limit',
    ],
    [
      'a raw-HTML fake fence',
      `<script>\n\`\`\`\n</script>\n${'> '.repeat(50_000)}x`,
      'html-markdown-container-limit',
    ],
  ] as const)('bounds parser work despite %s', (_label, source, code) => {
    const candidate = withMarkdown(source);
    candidate.limits = { maxMarkdownDepth: 1 };
    const startedAt = performance.now();

    expectFailure(candidate, code);
    expect(performance.now() - startedAt).toBeLessThan(1_500);
  });

  it('has no executable/remote-loading element and includes CSP/referrer defense in depth', () => {
    const document = documentOf(render(input()).html);
    expect(
      document.querySelector('script,base,form,iframe,object,embed,link,video,audio')
    ).toBeNull();
    expect(document.querySelector('meta[http-equiv="refresh"]')).toBeNull();
    const policy = document
      .querySelector('meta[http-equiv="Content-Security-Policy"]')!
      .getAttribute('content')!;
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("img-src 'self'");
    expect(policy).toContain("base-uri 'none'");
    expect(document.querySelector('meta[name="referrer"]')!.getAttribute('content')).toBe(
      'no-referrer'
    );
  });
});
