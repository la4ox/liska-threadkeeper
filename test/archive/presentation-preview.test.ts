import { describe, expect, it, vi } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Nodes } from 'mdast';
import {
  adoptArchivePresentationPreview,
  createPresentationSelection,
  createTextPresentationSelection,
  prepareArchivePresentationPreview,
  prepareArchiveTextPreview,
  presentationPreviewAsTextPreview,
  PRESENTATION_PREVIEW_LIMITS,
  renderPresentationSelection,
  renderSelectedHtml,
  renderSelectedMarkdown,
  renderSelectedText,
  renderTextSelection,
  resolvePresentationPreviewRange,
  resolvePresentationSelection,
  snapshotPresentationSelection,
  validateLiskaThreadArchive,
  type ArchiveBlock,
  type ArchivePresentationPreview,
  type LiskaThreadArchive,
  type PresentationPreviewInput,
  type PresentationPreviewLimits,
} from '../../src/archive';
import fixture from '../fixtures/archive/branching-chatgpt-thread.json';

const canonicalSha256 = 'a'.repeat(64);
let blockId = 0;
function block(type: ArchiveBlock['type'], fields: Record<string, unknown>): ArchiveBlock {
  return {
    id: `body-${blockId++}`,
    type,
    sourceRefs: [
      { format: 'synthetic/1', kind: 'block', id: null, artifactId: null, rawPointer: null },
    ],
    extensions: {},
    ...fields,
  } as ArchiveBlock;
}
function input(): PresentationPreviewInput {
  return {
    archive: structuredClone(fixture) as LiskaThreadArchive,
    canonicalSha256,
    profile: { includeToolContent: false, inertTaggedCodeBlocks: false },
  };
}
function withThreeRows(): PresentationPreviewInput {
  const candidate = input();
  const nodes = candidate.archive.graph.nodes;
  nodes['node-middle'] = structuredClone(nodes['node-user']);
  Object.assign(nodes['node-middle'], {
    id: 'node-middle',
    parentId: 'node-user',
    childIds: ['node-current'],
  });
  nodes['node-middle'].message!.id = 'message-middle';
  nodes['node-middle'].message!.blocks = [
    block('unknown', { providerType: 'future', raw: { secret: 'unselected-raw-payload' } }),
  ];
  nodes['node-user'].childIds = ['node-middle', 'node-alternate'];
  nodes['node-current'].parentId = 'node-middle';
  nodes['node-user'].message!.blocks = [
    block('markdown', {
      markdown:
        '# Source heading\n\n- first\n- **second**\n\n[local link][ref]\n\n[ref]: https://example.org/ref',
    }),
    block('text', { text: '# literal title\n<script>literal()</script>\n*not emphasis*' }),
    block('code', { language: 'js', code: 'a();\n```\n~~~~\nb();' }),
  ];
  return candidate;
}
function rich(): PresentationPreviewInput {
  const candidate = withThreeRows();
  candidate.archive.graph.nodes['node-current'].message!.blocks = [
    block('quote', { text: 'quoted\n# not a heading', attribution: '<source>' }),
    block('citation', {
      label: 'Site [citation]',
      url: 'https://example.org/source?a=1&b=2',
      content: 'literal citation **content**',
    }),
    block('html', {
      html: '<script>providerActive()</script><iframe src="https://bad.invalid"></iframe>',
    }),
    block('attachment', { assetId: 'asset-synthetic-image' }),
    block('canvas_event', { event: { hidden: 'canvas-private' } }),
    block('unknown', { providerType: 'future', raw: { hidden: 'unknown-private' } }),
    block('reasoning', { text: 'technical-secret' }),
    block('tool_call', { toolName: 'calc', arguments: { value: 42 } }),
    block('tool_result', { toolName: 'calc', result: ['technical-result'] }),
    block('execution_output', { output: { value: 'technical-output' } }),
    block('error', { code: 'E_PRIVATE', message: 'technical-error' }),
  ];
  return candidate;
}
function plain(): ArchivePresentationPreview {
  return JSON.parse(JSON.stringify(prepareArchivePresentationPreview(input())));
}
function failure(action: () => unknown, code: string): void {
  expect(action).toThrow(expect.objectContaining({ code, message: code }));
}
function nodesOf(source: string): Nodes[] {
  const result: Nodes[] = [];
  const pending: Nodes[] = [fromMarkdown(source)];
  while (pending.length) {
    const node = pending.pop()!;
    result.push(node);
    if ('children' in node) pending.push(...node.children);
  }
  return result;
}
function syntaxWithoutPositions(source: string): unknown {
  return JSON.parse(
    JSON.stringify(fromMarkdown(source), (key, value) => (key === 'position' ? undefined : value))
  );
}
function objects(value: unknown, result = new Set<object>()): Set<object> {
  if (value !== null && typeof value === 'object' && !result.has(value)) {
    result.add(value);
    Object.values(value).forEach(child => objects(child, result));
  }
  return result;
}

describe('detached multiformat presentation preview', () => {
  it('keeps only permitted presentation data, detached and recursively frozen', () => {
    const candidate = rich();
    expect(validateLiskaThreadArchive(candidate.archive)).toEqual({ valid: true, issues: [] });
    const callerObjects = objects(candidate);
    const preview = prepareArchivePresentationPreview(candidate);
    expect(preview.schema).toBe('liska-presentation-preview/1');
    expect(preview.profile).toEqual({
      schema: 'liska-presentation-profile/1',
      includeToolContent: false,
      inertTaggedCodeBlocks: false,
    });
    expect(preview.rows.map(row => row.nodeId)).toEqual([
      'node-user',
      'node-middle',
      'node-current',
    ]);
    for (const object of objects(preview)) {
      expect(Object.isFrozen(object)).toBe(true);
      expect(callerObjects.has(object)).toBe(false);
    }
    expect(Object.isFrozen(candidate.archive)).toBe(false);
    const serialized = JSON.stringify(preview);
    for (const forbidden of [
      'sourceRefs',
      'extensions',
      'localArtifactRef',
      'asset-synthetic-image',
      'assets/synthetic-image.png',
      'canvas-private',
      'unknown-private',
      'unselected-raw-payload',
      'technical-secret',
      'technical-result',
      'technical-output',
      'technical-error',
    ])
      expect(serialized).not.toContain(forbidden);
    expect(serialized).toContain('synthetic-image.png');
    expect(Object.keys(preview)).toEqual([
      'schema',
      'sourceCanonicalSha256',
      'branchTargetNodeId',
      'title',
      'profile',
      'rendererVersions',
      'rows',
    ]);
    const before = JSON.stringify(preview);
    candidate.archive.conversation.title = 'changed after prepare';
    candidate.archive.assets['asset-synthetic-image'].filename = 'changed.png';
    candidate.profile.inertTaggedCodeBlocks = true;
    expect(JSON.stringify(preview)).toBe(before);
  });

  it('renders rich canonical Markdown, safe standalone HTML and exact legacy Text rows', () => {
    const candidate = rich();
    const preview = prepareArchivePresentationPreview(candidate);
    const old = prepareArchiveTextPreview({
      archive: candidate.archive,
      canonicalSha256,
      profile: { includeToolContent: false },
    });
    expect(preview.rows.map(row => row.presentedText)).toEqual(
      old.rows.map(row => row.presentedText)
    );
    const first = preview.rows[0];
    const markdownNodes = nodesOf(first.markdownBody);
    expect(markdownNodes.some(node => node.type === 'heading' && node.depth === 1)).toBe(true);
    expect(markdownNodes.some(node => node.type === 'list')).toBe(true);
    expect(markdownNodes.some(node => node.type === 'strong')).toBe(true);
    expect(
      markdownNodes.some(node => node.type === 'code' && node.value === 'a();\n```\n~~~~\nb();')
    ).toBe(true);
    expect(markdownNodes.filter(node => node.type === 'heading')).toHaveLength(1);
    expect(
      markdownNodes.some(node => node.type === 'link' && node.url === 'https://example.org/ref')
    ).toBe(true);
    expect(
      markdownNodes.some(
        node => node.type === 'linkReference' || node.type === 'definition' || node.type === 'html'
      )
    ).toBe(false);
    const last = preview.rows[2];
    expect(last.markdownBody).toContain('> quoted');
    expect(
      nodesOf(last.markdownBody).some(
        node => node.type === 'link' && node.url === 'https://example.org/source?a=1&b=2'
      )
    ).toBe(true);
    expect(last.markdownBody).toContain('Canvas event: presentation unsupported');
    expect(last.markdownBody).toContain('Unknown provider block: presentation unsupported');
    for (const row of preview.rows) {
      expect(row.htmlBody).not.toMatch(/<!doctype|<html|<head|<body|<script|<iframe|<img|<style/i);
      const doc = new DOMParser().parseFromString(row.htmlBody, 'text/html');
      expect(doc.querySelectorAll('script,iframe,img,object,form')).toHaveLength(0);
    }
    expect(last.htmlBody).toContain('&lt;script&gt;providerActive()&lt;/script&gt;');
  });

  it.each([
    '*a*_b_',
    '_a_*b*',
    '**a**__b__',
    '__a__**b**',
    '*a*__b__',
    '**a**_b_',
    '*a*_b_*c*',
    '**_a_**__*b*__',
  ])('preserves adjacent emphasis syntax for %s', source => {
    const candidate = input();
    candidate.archive.graph.nodes['node-user'].message!.blocks = [
      block('markdown', { markdown: source }),
    ];
    const preview = prepareArchivePresentationPreview(candidate);
    const body = preview.rows[0].markdownBody;
    expect(body).toContain(source);
    expect(syntaxWithoutPositions(body)).toEqual(syntaxWithoutPositions(source));
    const selected = renderSelectedMarkdown(
      preview,
      createPresentationSelection(preview, ['node-user'])
    ).content;
    expect(selected).toContain(source);
  });

  it.each(['&#65;_b_', '_a_&#65;', '&#x61;__b__', '__a__&#x61;', '&#65;_b_*c*', '*c*_b_&#65;'])(
    'keeps underscore flanking after character-reference decoding for %s',
    source => {
      const candidate = input();
      candidate.archive.graph.nodes['node-user'].message!.blocks = [
        block('markdown', { markdown: source }),
      ];
      const body = prepareArchivePresentationPreview(candidate).rows[0].markdownBody;
      expect(syntaxWithoutPositions(body)).toEqual(syntaxWithoutPositions(source));
    }
  );

  it.each([
    '*a&nbsp;*',
    '*&#32;a*',
    '**a&nbsp;**',
    '**&#32;a**',
    '_a&nbsp;_',
    '__&#32;a__',
    '*&#32;*',
  ])('preserves entity-decoded boundary whitespace inside emphasis for %s', source => {
    const candidate = input();
    candidate.archive.graph.nodes['node-user'].message!.blocks = [
      block('markdown', { markdown: source }),
    ];
    const body = prepareArchivePresentationPreview(candidate).rows[0].markdownBody;
    expect(syntaxWithoutPositions(body)).toEqual(syntaxWithoutPositions(source));
  });

  it.each([
    {
      source: '1. First\n2. Finish\n\n1) Restart\n2) Finish',
      ordered: true,
      markers: ['1. First', '1) Restart'],
    },
    { source: '- First\n\n+ Restart', ordered: false, markers: ['- First', '+ Restart'] },
  ])('preserves adjacent list delimiters for $source', ({ source, ordered, markers }) => {
    const candidate = input();
    candidate.archive.graph.nodes['node-user'].message!.blocks = [
      block('markdown', { markdown: source }),
    ];
    const body = prepareArchivePresentationPreview(candidate).rows[0].markdownBody;
    const lists = fromMarkdown(body).children.filter(node => node.type === 'list');
    expect(lists).toHaveLength(2);
    expect(lists.map(node => node.ordered)).toEqual([ordered, ordered]);
    if (ordered) expect(lists.map(node => node.start)).toEqual([1, 1]);
    for (const marker of markers) expect(body).toContain(marker);
  });

  it.each([
    { source: '-\n- next', marker: '- next' },
    { source: '1)\n2) next', marker: '2) next' },
    { source: '> -\n>\n> paragraph', marker: '> - ' },
  ])('accepts a physical EOL after an empty list marker for $source', ({ source, marker }) => {
    const candidate = input();
    candidate.archive.graph.nodes['node-user'].message!.blocks = [
      block('markdown', { markdown: source }),
    ];
    const body = prepareArchivePresentationPreview(candidate).rows[0].markdownBody;
    expect(body).toContain(marker);
    expect(nodesOf(body).some(node => node.type === 'list')).toBe(true);
  });

  it.each(['```\na\n\n```', '```\na\n\n\n```', '~~~js\nvalue();\n\n~~~', '```\ra\r\r```'])(
    'preserves fenced-code trailing newlines for %s',
    source => {
      const candidate = input();
      candidate.archive.graph.nodes['node-user'].message!.blocks = [
        block('markdown', { markdown: source }),
      ];
      const body = prepareArchivePresentationPreview(candidate).rows[0].markdownBody;
      expect(syntaxWithoutPositions(body)).toEqual(syntaxWithoutPositions(source));
    }
  );

  it.each(['> ```\r> a\r> \r> ```', '> ```\r\n> a\r\n> \r\n> ```'])(
    'preserves quoted fenced-code physical line endings for %s',
    source => {
      const candidate = input();
      candidate.archive.graph.nodes['node-user'].message!.blocks = [
        block('markdown', { markdown: source }),
      ];
      const body = prepareArchivePresentationPreview(candidate).rows[0].markdownBody;
      expect(syntaxWithoutPositions(body)).toEqual(syntaxWithoutPositions(source));
    }
  );

  it.each(['- > ```\r  > a\r  > \r  > ```', '- > ```\r\n  > a\r\n  > \r\n  > ```'])(
    'preserves list/quote/fence physical line endings for %s',
    source => {
      const candidate = input();
      candidate.archive.graph.nodes['node-user'].message!.blocks = [
        block('markdown', { markdown: source }),
      ];
      const body = prepareArchivePresentationPreview(candidate).rows[0].markdownBody;
      expect(syntaxWithoutPositions(body)).toEqual(syntaxWithoutPositions(source));
    }
  );

  it('preserves trailing newlines in canonical code blocks', () => {
    const candidate = input();
    candidate.archive.graph.nodes['node-user'].message!.blocks = [
      block('code', { language: 'text', code: 'value\n' }),
    ];
    const body = prepareArchivePresentationPreview(candidate).rows[0].markdownBody;
    expect(nodesOf(body)).toContainEqual(
      expect.objectContaining({ type: 'code', lang: 'text', value: 'value\n' })
    );
    candidate.archive.graph.nodes['node-user'].message!.blocks = [
      block('code', { language: 'text', code: 'value\r' }),
    ];
    const crBody = prepareArchivePresentationPreview(candidate).rows[0].markdownBody;
    expect(nodesOf(crBody)).toContainEqual(
      expect.objectContaining({ type: 'code', lang: 'text', value: 'value\r' })
    );
  });

  it.each([
    'first line\nsecond line\n===========',
    'first line\nsecond line\n-----------',
    'first  \nsecond\n===========',
    'first  \nsecond\n-----------',
  ])('preserves multiline setext headings for %s', source => {
    const candidate = input();
    candidate.archive.graph.nodes['node-user'].message!.blocks = [
      block('markdown', { markdown: source }),
    ];
    const body = prepareArchivePresentationPreview(candidate).rows[0].markdownBody;
    expect(syntaxWithoutPositions(body)).toEqual(syntaxWithoutPositions(source));
  });

  it.each([
    'first  \n&#32;&#32;&#32;&#32;second\n===========',
    'first&#32;&#32;  \nsecond\n===========',
    '*first&#32;&#32;  \n&#32;&#32;&#32;&#32;second*\n===========',
    '[first&#32;&#32;  \n&#32;&#32;&#32;&#32;second](https://example.org)\n===========',
  ])('preserves literal whitespace beside heading break nodes for %s', source => {
    const candidate = input();
    candidate.archive.graph.nodes['node-user'].message!.blocks = [
      block('markdown', { markdown: source }),
    ];
    const body = prepareArchivePresentationPreview(candidate).rows[0].markdownBody;
    expect(syntaxWithoutPositions(body)).toEqual(syntaxWithoutPositions(source));
  });

  it('keeps entity-decoded newlines inside ATX h3-h6', () => {
    const source = '### first&#10;second';
    const candidate = input();
    candidate.archive.graph.nodes['node-user'].message!.blocks = [
      block('markdown', { markdown: source }),
    ];
    const body = prepareArchivePresentationPreview(candidate).rows[0].markdownBody;
    expect(syntaxWithoutPositions(body)).toEqual(syntaxWithoutPositions(source));
  });

  it.each([
    '# first&#10;',
    '## first&#10;',
    '# &#10;first',
    '## &#10;first',
    '# first&#10;&#10;second',
    '## first&#10;&#10;second',
    '# first&#10; &#10;second',
    '## first&#10;\t&#10;second',
    '# first&#10;    second',
    '# &#32;&#32;&#32;&#32;first&#10;second',
    '# first&#32;&#32;',
    '# [first&#10;second](https://example.org)',
    'first&#10;\nsecond\n===========',
  ])('keeps non-setext-safe entity newlines inside h1/h2 for %s', source => {
    const candidate = input();
    candidate.archive.graph.nodes['node-user'].message!.blocks = [
      block('markdown', { markdown: source }),
    ];
    const body = prepareArchivePresentationPreview(candidate).rows[0].markdownBody;
    expect(syntaxWithoutPositions(body)).toEqual(syntaxWithoutPositions(source));
  });

  it('keeps dollar math inert in literal text but preserves code payloads', () => {
    const candidate = input();
    candidate.archive.graph.nodes['node-user'].message!.blocks = [
      block('text', { text: 'shell $HOME and $$TMP' }),
      block('markdown', {
        markdown: 'literal $value and $$display$$\n\n`inline $value`\n\n```sh\necho $HOME\n```',
      }),
      block('code', { language: 'sh', code: 'printf "%s" "$HOME"' }),
    ];
    const body = prepareArchivePresentationPreview(candidate).rows[0].markdownBody;
    expect(body).toContain('shell \\$HOME and \\$\\$TMP');
    expect(body).toContain('literal \\$value and \\$\\$display\\$\\$');
    expect(body).toContain('`inline $value`');
    expect(body).toContain('echo $HOME');
    expect(body).toContain('printf "%s" "$HOME"');
  });

  it('round-trips entity-looking URLs, indented literal paths and all-space inline code', () => {
    const candidate = input();
    candidate.archive.graph.nodes['node-user'].message!.blocks = [
      block('markdown', {
        markdown: [
          '[inline](https://example.org/inline?x=1&amp;copy;)',
          '',
          '[reference][ref]',
          '',
          '[ref]: https://example.org/reference?x=1&amp;copy;',
          '',
          '` `',
          '',
          '`  \u00a0  `',
        ].join('\n'),
      }),
      block('text', { text: '    a*b <tag>' }),
      block('text', { text: ' \ta*b <tag>' }),
      block('text', { text: 'prefix\r    cr*b <tag>' }),
      block('quote', { text: '    quoted* <tag>', attribution: null }),
      block('citation', {
        label: 'Citation',
        url: 'https://example.org/citation?x=1&copy;',
        content: '    cited* <tag>',
      }),
    ];
    const preview = prepareArchivePresentationPreview(candidate);
    const selection = createPresentationSelection(
      preview,
      preview.rows.map(row => row.nodeId)
    );
    const result = renderSelectedMarkdown(preview, selection);
    const parsed = nodesOf(result.content);
    const urls = parsed.filter(node => node.type === 'link').map(node => node.url);
    expect(urls).toEqual(
      expect.arrayContaining([
        'https://example.org/inline?x=1&copy;',
        'https://example.org/reference?x=1&copy;',
        'https://example.org/citation?x=1&copy;',
      ])
    );
    const literalCode = parsed.filter(node => node.type === 'code').map(node => node.value);
    expect(literalCode).toEqual(
      expect.arrayContaining([
        '    a*b <tag>',
        ' \ta*b <tag>',
        'prefix\r    cr*b <tag>',
        '    quoted* <tag>',
        '    cited* <tag>',
      ])
    );
    expect(parsed.filter(node => node.type === 'inlineCode').map(node => node.value)).toEqual(
      expect.arrayContaining([' ', ' \u00a0 '])
    );
    expect(parsed.filter(node => node.type === 'inlineCode').map(node => node.value)).not.toContain(
      '   '
    );
  });

  it.each([
    { author: { role: 'tool', name: null } },
    { author: { role: 'system', name: null } },
    { visibility: 'hidden' },
    { channel: 'analysis' },
    { channel: 'commentary' },
    { recipient: 'tool-browser' },
  ])(
    'never admits hidden/nonfinal/non-user messages under either technical profile: %j',
    fields => {
      const candidate = input();
      Object.assign(candidate.archive.graph.nodes['node-current'].message!, fields);
      for (const includeToolContent of [false, true]) {
        candidate.profile.includeToolContent = includeToolContent;
        expect(prepareArchivePresentationPreview(candidate).rows.map(row => row.nodeId)).toEqual([
          'node-user',
        ]);
      }
    }
  );

  it('snapshots technical on/off and final Markdown inertness without rewriting selection /1', () => {
    const candidate = rich();
    const omitted = prepareArchivePresentationPreview(candidate);
    candidate.profile.includeToolContent = true;
    const admitted = prepareArchivePresentationPreview(candidate);
    expect(admitted.rows[2].markdownBody).toContain('technical-secret');
    expect(admitted.rows[2].htmlBody).toContain('technical-secret');
    expect(admitted.rows[2].markdownBody).toContain('technical-result');
    expect(admitted.rows[2].markdownBody).toContain('technical-output');
    expect(admitted.rows[2].markdownBody).toContain('technical-error');
    expect(omitted.rows[2].diagnostics.markdown).toContainEqual({
      code: 'technical-content-omitted',
      count: 5,
    });
    candidate.profile.inertTaggedCodeBlocks = true;
    const inert = prepareArchivePresentationPreview(candidate);
    const selection = createPresentationSelection(admitted, ['node-user']);
    expect(selection.profile).toEqual({
      schema: 'liska-reading-profile/1',
      includeToolContent: true,
    });
    const normalResult = renderSelectedMarkdown(admitted, selection);
    const inertResult = renderSelectedMarkdown(inert, selection);
    expect(
      nodesOf(normalResult.content).some(node => node.type === 'code' && node.lang === 'js')
    ).toBe(true);
    expect(nodesOf(inertResult.content).some(node => node.type === 'code' && node.lang)).toBe(
      false
    );
    expect(inertResult.profile).toBe(inert.profile);
    expect(inertResult.previewSchema).toBe('liska-presentation-preview/1');
    expect(inertResult.rendererVersion).toBe('liska-selected-markdown/1');
  });
});

describe('one explicit selection for every reading format', () => {
  it('uses one noncontiguous ordered selection, never search results, and keeps Text bytes unchanged', () => {
    const preview = prepareArchivePresentationPreview(rich());
    const selection = createPresentationSelection(preview, ['node-user', 'node-current']);
    expect(resolvePresentationSelection(preview, selection).map(row => row.nodeId)).toEqual([
      'node-user',
      'node-current',
    ]);
    expect(resolvePresentationPreviewRange(preview, 1, 3)).toEqual([
      'node-user',
      'node-middle',
      'node-current',
    ]);
    for (const format of ['text', 'markdown', 'html'] as const) {
      const result = renderPresentationSelection(preview, selection, format);
      expect(result.selection.messageNodeIds).toEqual(['node-user', 'node-current']);
      expect(result.availableMessageCount).toBe(3);
      expect(result.renderedMessageCount).toBe(2);
      expect(result.content).not.toContain('node-middle');
      expect(result.content.indexOf('node-user')).toBeLessThan(
        result.content.indexOf('node-current', result.content.indexOf('node-user'))
      );
      for (const object of objects(result)) expect(Object.isFrozen(object)).toBe(true);
      expect(result).toEqual(renderPresentationSelection(preview, selection, format));
    }
    const textAdapter = presentationPreviewAsTextPreview(preview);
    expect(renderSelectedText(preview, selection).content).toBe(
      renderTextSelection(textAdapter, selection).text
    );
    expect(
      snapshotPresentationSelection(
        preview,
        createTextPresentationSelection(textAdapter, ['node-user'])
      )
    ).toEqual(createPresentationSelection(preview, ['node-user']));
    failure(
      () => snapshotPresentationSelection(preview, { ...selection, query: 'Source' }),
      'text-selection-invalid'
    );
    failure(() => createPresentationSelection(preview, []), 'text-selection-empty');
    failure(
      () => createPresentationSelection(preview, ['node-current', 'node-user']),
      'text-selection-order-invalid'
    );
    failure(
      () => createPresentationSelection(preview, ['node-user', 'node-user']),
      'text-selection-node-invalid'
    );
    failure(
      () => createPresentationSelection(preview, ['node-alternate']),
      'text-selection-node-invalid'
    );
  });

  it('aggregates only selected row diagnostics and creates a complete offline CSP document', () => {
    const preview = prepareArchivePresentationPreview(withThreeRows());
    const selection = createPresentationSelection(preview, ['node-user']);
    for (const format of ['text', 'markdown', 'html'] as const) {
      const result = renderPresentationSelection(preview, selection, format);
      expect(result.diagnostics.map(item => item.code)).not.toContain('unknown-unsupported');
      expect(result.content).not.toContain('Unknown provider block');
    }
    const result = renderSelectedHtml(preview, selection);
    const doc = new DOMParser().parseFromString(result.content, 'text/html');
    expect(doc.doctype?.name).toBe('html');
    expect(
      doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')
    ).toContain("default-src 'none'");
    expect(
      doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')
    ).toContain("img-src 'none'");
    expect(doc.querySelectorAll('article')).toHaveLength(1);
    expect(doc.querySelectorAll('script,img,iframe,object,form')).toHaveLength(0);
    expect(result).toMatchObject({ mediaType: 'text/html', extension: 'html', format: 'html' });
  });

  it('closes unfinished Markdown and keeps reference definitions local to each body', () => {
    const candidate = withThreeRows();
    candidate.archive.graph.nodes['node-user'].message!.blocks = [
      block('markdown', { markdown: '```js\nunfinished\n\n[ref]: https://evil.invalid' }),
    ];
    candidate.archive.graph.nodes['node-current'].message!.blocks = [
      block('markdown', { markdown: '[neighbor][ref]\n\n# next row' }),
    ];
    const preview = prepareArchivePresentationPreview(candidate);
    const content = renderSelectedMarkdown(
      preview,
      createPresentationSelection(preview, ['node-user', 'node-current'])
    ).content;
    expect(nodesOf(content).some(node => node.type === 'heading' && node.depth === 1)).toBe(true);
    expect(
      nodesOf(content).some(node => node.type === 'link' && node.url === 'https://evil.invalid')
    ).toBe(false);
    expect(content).toContain('next row');
  });

  it('retains nested list/quote fences and inert HTML/image/link semantics independently', () => {
    const candidate = input();
    candidate.archive.graph.nodes['node-current'].message!.blocks = [
      block('markdown', {
        markdown:
          '- item\n\n  ```js\n  listCode();\n  ```\n\n> quote\n>\n> ~~~py\n> quotedCode()\n> ~~~\n\n```c# title="file"\nConsole.WriteLine(1);\n```\n\nInline <em>inert</em>, ![alt](https://example.org/image.png), [bad](javascript:active())',
      }),
    ];
    const preview = prepareArchivePresentationPreview(candidate);
    const body = preview.rows[1].markdownBody;
    const nodes = nodesOf(body);
    expect(nodes.some(node => node.type === 'code' && node.value === 'listCode();')).toBe(true);
    expect(nodes.some(node => node.type === 'code' && node.value === 'quotedCode()')).toBe(true);
    expect(body).toContain('Code info: c\\# title="file"');
    expect(nodes.some(node => node.type === 'html' || node.type === 'image')).toBe(false);
    expect(nodes.some(node => node.type === 'link' && node.url.startsWith('javascript:'))).toBe(
      false
    );
    expect(preview.rows[1].diagnostics.markdown).toContainEqual({
      code: 'provider-html-inert',
      count: 2,
    });
    expect(preview.rows[1].diagnostics.markdown).toContainEqual({
      code: 'markdown-image-reference',
      count: 1,
    });
  });

  it('keeps title and IDs literal in Markdown and HTML metadata', () => {
    const copy = plain();
    const nodeId = '```js\n# ID <script>alert(1)</script>\n```';
    const preview = adoptArchivePresentationPreview({
      ...copy,
      title: '# forged\n<script>titleActive()</script>\n~~~js',
      rows: [{ ...copy.rows[0], nodeId }],
    });
    const selection = createPresentationSelection(preview, [nodeId]);
    const markdown = renderSelectedMarkdown(preview, selection).content;
    expect(
      nodesOf(markdown).filter(node => node.type === 'heading' && node.depth === 1)
    ).toHaveLength(1);
    expect(nodesOf(markdown).some(node => node.type === 'html')).toBe(false);
    const doc = new DOMParser().parseFromString(
      renderSelectedHtml(preview, selection).content,
      'text/html'
    );
    expect(doc.querySelectorAll('script')).toHaveLength(0);
    expect(doc.querySelector('title')?.textContent).toBe(preview.title);
  });
});

describe('strict bounded multiformat adoption and finalization', () => {
  it('takes a fresh frozen wire copy and rejects structural casts', () => {
    const wire = plain();
    failure(
      () => createPresentationSelection(wire, [wire.rows[0].nodeId]),
      'presentation-preview-invalid'
    );
    const preview = adoptArchivePresentationPreview(wire);
    expect(preview).toEqual(wire);
    const before = JSON.stringify(preview);
    (wire.rows[0] as { markdownBody: string }).markdownBody = 'mutated';
    expect(JSON.stringify(preview)).toBe(before);
  });

  it.each(['archive', 'graph', 'sourceRefs', 'extensions', 'assetBindings', 'destination'])(
    'rejects extra top-level field %s',
    key => {
      failure(
        () => adoptArchivePresentationPreview({ ...plain(), [key]: null }),
        'presentation-preview-invalid'
      );
    }
  );

  it('rejects unknown/infinite/duplicate/out-of-order diagnostic records and renderer drift', () => {
    const wire = plain();
    const row = wire.rows[0];
    for (const html of [
      [{ code: 'future-code', count: 1 }],
      [{ code: 'block-empty', count: Infinity }],
      [{ code: 'block-empty', count: 0 }],
      [
        { code: 'block-empty', count: 1 },
        { code: 'block-empty', count: 2 },
      ],
      [
        { code: 'unknown-unsupported', count: 1 },
        { code: 'block-empty', count: 1 },
      ],
    ]) {
      failure(
        () =>
          adoptArchivePresentationPreview({
            ...wire,
            rows: [{ ...row, diagnostics: { ...row.diagnostics, html } }],
          }),
        'presentation-diagnostics-invalid'
      );
    }
    failure(
      () =>
        adoptArchivePresentationPreview({
          ...wire,
          rendererVersions: { ...wire.rendererVersions, html: 'future/1' },
        }),
      'presentation-renderer-invalid'
    );
    failure(
      () =>
        adoptArchivePresentationPreview({
          ...wire,
          profile: { ...wire.profile, inertTaggedCodeBlocks: 'false' },
        }),
      'presentation-profile-invalid'
    );
    failure(
      () => adoptArchivePresentationPreview({ ...wire, rows: [row, row] }),
      'presentation-preview-invalid'
    );
  });

  it('rejects accessors, symbols, prototypes and traps without leaking their exception values', () => {
    const wire = plain();
    const getter = vi.fn(() => 'secret');
    const accessor = { ...wire };
    Object.defineProperty(accessor, 'title', { enumerable: true, get: getter });
    failure(() => adoptArchivePresentationPreview(accessor), 'presentation-preview-invalid');
    expect(getter).not.toHaveBeenCalled();
    failure(
      () => adoptArchivePresentationPreview({ ...wire, [Symbol('raw')]: 'secret' }),
      'presentation-preview-invalid'
    );
    failure(
      () => adoptArchivePresentationPreview(Object.assign(Object.create(null), wire)),
      'presentation-preview-invalid'
    );
    failure(
      () =>
        adoptArchivePresentationPreview(
          new Proxy(wire, {
            ownKeys() {
              throw new Error('provider-secret');
            },
          })
        ),
      'presentation-preview-invalid'
    );
    const get = vi.fn(() => {
      throw new Error('get-secret');
    });
    const adopted = adoptArchivePresentationPreview(
      new Proxy({ ...wire, rows: new Proxy(wire.rows, { get }) }, { get })
    );
    expect(adopted).toEqual(wire);
    expect(get).not.toHaveBeenCalled();
    failure(
      () => adoptArchivePresentationPreview({ ...wire, rows: [wire.rows[0], , wire.rows[1]] }),
      'presentation-row-limit'
    );
  });

  it.each([
    '<script>active()</script>',
    '<p onclick="active()">bad</p>',
    '<img src="https://bad.invalid/">',
    '<a href="javascript:active()" target="_blank" rel="noopener noreferrer">bad</a>',
    '<p>unclosed',
    '<p><iframe></iframe></p>',
    '<!doctype html><html></html>',
    '<p class="text" style="color:red">bad</p>',
  ])('rejects unsafe or non-self-contained wire HTML %s', htmlBody => {
    const wire = plain();
    failure(
      () => adoptArchivePresentationPreview({ ...wire, rows: [{ ...wire.rows[0], htmlBody }] }),
      'presentation-html-invalid'
    );
  });

  it.each([
    '```js\nunclosed\n\n',
    '````\nshort closing\n```\n\n',
    '```\nquoted fake closing\n> ```\n\n',
    '> ```\n> unclosed\n\n',
    '[ref]: https://example.org\n\n',
    '<script>active()</script>\n\n',
    '![load](https://example.org/image.png)\n\n',
    '[bad](javascript:active())\n\n',
    'missing final blank line',
  ])('rejects non-self-contained/inert wire Markdown %s', markdownBody => {
    const wire = plain();
    failure(
      () => adoptArchivePresentationPreview({ ...wire, rows: [{ ...wire.rows[0], markdownBody }] }),
      'presentation-markdown-invalid'
    );
  });

  it('keeps empty/structural branches explicit and rejects empty selections', () => {
    const candidate = input();
    candidate.targetNodeId = 'node-root';
    const preview = prepareArchivePresentationPreview(candidate);
    expect(preview.rows).toEqual([]);
    failure(() => createPresentationSelection(preview, []), 'text-selection-empty');
    failure(
      () => prepareArchivePresentationPreview({ ...candidate, targetNodeId: 'missing' }),
      'text-target-invalid'
    );
  });

  it('enforces combined row/total chars, exact UTF-8 envelope, row/title counts and tightened-only limits', () => {
    const wire = plain();
    const row = {
      ...wire.rows[0],
      presentedText: 'x'.repeat(100),
      markdownBody: 'y'.repeat(100) + '\n\n',
      htmlBody: 'z'.repeat(100),
      diagnostics: { text: [], markdown: [], html: [] },
    };
    const one = { ...wire, rows: [row] };
    failure(
      () => adoptArchivePresentationPreview(one, { maxRowChars: 250 }),
      'presentation-row-char-limit'
    );
    const rowSize = JSON.stringify(row).length;
    expect(adoptArchivePresentationPreview(one, { maxRowChars: rowSize }).rows).toHaveLength(1);
    failure(
      () => adoptArchivePresentationPreview(one, { maxRowChars: rowSize - 1 }),
      'presentation-row-char-limit'
    );
    const size = JSON.stringify(one).length;
    expect(adoptArchivePresentationPreview(one, { maxTotalChars: size }).rows).toHaveLength(1);
    failure(
      () => adoptArchivePresentationPreview(one, { maxTotalChars: size - 1 }),
      'presentation-total-char-limit'
    );
    const unicode = { ...one, title: '漢'.repeat(100) };
    const bytes = new TextEncoder().encode(JSON.stringify(unicode)).byteLength;
    expect(adoptArchivePresentationPreview(unicode, { maxEnvelopeBytes: bytes }).title).toBe(
      unicode.title
    );
    failure(
      () => adoptArchivePresentationPreview(unicode, { maxEnvelopeBytes: bytes - 1 }),
      'presentation-envelope-byte-limit'
    );
    failure(() => adoptArchivePresentationPreview(wire, { maxRows: 1 }), 'presentation-row-limit');
    failure(
      () => adoptArchivePresentationPreview(wire, { maxTitleChars: 1 }),
      'presentation-title-char-limit'
    );
    for (const overrides of [
      { maxRows: 5001 },
      { maxRowChars: 0 },
      { maxTotalChars: Infinity },
      { maxEnvelopeBytes: PRESENTATION_PREVIEW_LIMITS.maxEnvelopeBytes + 1 },
      { unknown: 1 },
    ])
      failure(
        () =>
          adoptArchivePresentationPreview(wire, overrides as Partial<PresentationPreviewLimits>),
        'presentation-limits-invalid'
      );
  });

  it('enforces preparation-wide HTML parser/source/serialization work, never fresh budgets per row', () => {
    const candidate = withThreeRows();
    for (const id of ['node-user', 'node-middle', 'node-current'])
      candidate.archive.graph.nodes[id].message!.blocks = [
        block('markdown', { markdown: '**one**' }),
      ];
    failure(
      () => prepareArchivePresentationPreview({ ...candidate, limits: { maxMarkdownNodes: 12 } }),
      'html-markdown-node-limit'
    );
    failure(
      () => prepareArchivePresentationPreview({ ...candidate, limits: { maxSourceChars: 20 } }),
      'text-source-char-limit'
    );
    failure(
      () =>
        prepareArchivePresentationPreview({ ...candidate, previewLimits: { maxRowChars: 200 } }),
      'presentation-row-char-limit'
    );
    candidate.profile.includeToolContent = true;
    for (const id of ['node-user', 'node-middle', 'node-current'])
      candidate.archive.graph.nodes[id].message!.blocks = [
        block('tool_result', { toolName: null, result: 'x'.repeat(30) }),
      ];
    failure(
      () =>
        prepareArchivePresentationPreview({
          ...candidate,
          limits: { maxJsonSerializationChars: 70 },
        }),
      'text-json-serialization-limit'
    );
  });

  it('enforces the hard combined defaults, not one full allowance per format or row', () => {
    const wire = plain();
    const base = {
      ...wire.rows[0],
      presentedText: '',
      markdownBody: '\n\n',
      htmlBody: '',
      diagnostics: { text: [], markdown: [], html: [] },
    };
    failure(
      () =>
        adoptArchivePresentationPreview({
          ...wire,
          rows: [
            {
              ...base,
              presentedText: 'x'.repeat(400_000),
              markdownBody: 'y'.repeat(400_000) + '\n\n',
              htmlBody: 'z'.repeat(400_000),
            },
          ],
        }),
      'presentation-row-char-limit'
    );
    failure(
      () =>
        adoptArchivePresentationPreview({
          ...wire,
          rows: Array.from({ length: 17 }, (_, index) => ({
            ...base,
            nodeId: `row-${index}`,
            presentedText: 'x'.repeat(500_000),
          })),
        }),
      'presentation-total-char-limit'
    );
    failure(
      () =>
        adoptArchivePresentationPreview({
          ...wire,
          rows: Array.from({ length: 15 }, (_, index) => ({
            ...base,
            nodeId: `row-${index}`,
            presentedText: '漢'.repeat(300_000),
          })),
        }),
      'presentation-envelope-byte-limit'
    );
    failure(
      () => adoptArchivePresentationPreview({ ...wire, title: 'x'.repeat(64 * 1024 + 1) }),
      'presentation-title-char-limit'
    );
    failure(
      () =>
        adoptArchivePresentationPreview({
          ...wire,
          rows: Array.from({ length: 5_001 }, (_, index) => ({ ...base, nodeId: `row-${index}` })),
        }),
      'presentation-row-limit'
    );
  });

  it('fails final selected output atomically including shell/metadata/diagnostics and UTF-8', () => {
    const preview = prepareArchivePresentationPreview(rich());
    const selection = createPresentationSelection(preview, ['node-user', 'node-current']);
    for (const format of ['text', 'markdown', 'html'] as const) {
      const result = renderPresentationSelection(preview, selection, format);
      const chars = result.content.length;
      const bytes = new TextEncoder().encode(result.content).byteLength;
      expect(
        renderPresentationSelection(preview, selection, format, {
          maxOutputChars: chars,
          maxOutputBytes: bytes,
        })
      ).toEqual(result);
      expect(() =>
        renderPresentationSelection(preview, selection, format, { maxOutputChars: chars - 1 })
      ).toThrow();
      expect(() =>
        renderPresentationSelection(preview, selection, format, { maxOutputBytes: bytes - 1 })
      ).toThrow();
      expect(preview.rows).toHaveLength(3);
    }
    const plainWire = plain();
    const inflated = adoptArchivePresentationPreview({
      ...plainWire,
      rows: [{ ...plainWire.rows[0], markdownBody: '```js\nvalue();\n```\n\n' }],
      profile: { ...plainWire.profile, inertTaggedCodeBlocks: true },
    });
    const chosen = createPresentationSelection(inflated, [inflated.rows[0].nodeId]);
    const content = renderSelectedMarkdown(inflated, chosen).content;
    failure(
      () => renderSelectedMarkdown(inflated, chosen, { maxOutputChars: content.length - 1 }),
      'presentation-output-limit'
    );
    expect(() =>
      renderSelectedMarkdown(inflated, chosen, {
        maxOutputBytes: new TextEncoder().encode(content).byteLength - 1,
      })
    ).toThrow();
  });
});
