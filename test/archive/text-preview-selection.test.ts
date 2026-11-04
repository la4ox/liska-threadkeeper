import { describe, expect, it, vi } from 'vitest';
import {
  adoptArchiveTextPreview,
  createTextPresentationSelection,
  prepareArchiveTextPreview,
  renderArchiveText,
  renderTextSelection,
  resolveTextPresentationSelection,
  resolveTextPreviewRange,
  snapshotTextPresentationSelection,
  TEXT_PREVIEW_LIMITS,
  TextPresentationError,
  type ArchiveBlock,
  type ArchiveTextPreview,
  type LiskaThreadArchive,
  type TextPresentationErrorCode,
  type TextPreviewInput,
} from '../../src/archive';
import branchingFixture from '../fixtures/archive/branching-chatgpt-thread.json';

const canonicalSha256 = 'a'.repeat(64);

function input(): TextPreviewInput {
  return {
    archive: structuredClone(branchingFixture) as LiskaThreadArchive,
    canonicalSha256,
    profile: { includeToolContent: false },
  };
}

function block(type: ArchiveBlock['type'], payload: Record<string, unknown>): ArchiveBlock {
  return {
    id: `block-${type}`,
    type,
    sourceRefs: [
      { format: 'synthetic/1', kind: 'block', id: null, artifactId: null, rawPointer: null },
    ],
    extensions: {},
    ...payload,
  } as ArchiveBlock;
}

function plainPreview(): ArchiveTextPreview {
  return JSON.parse(JSON.stringify(prepareArchiveTextPreview(input())));
}

function expectFailure(action: () => unknown, code: TextPresentationErrorCode): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(TextPresentationError);
  expect(caught).toMatchObject({ code, message: code });
  expect(String(caught)).toBe(`TextPresentationError: ${code}`);
}

function freezeDeep(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
}

function objects(value: unknown, result = new Set<object>()): Set<object> {
  if (value !== null && typeof value === 'object' && !result.has(value)) {
    result.add(value);
    Object.values(value).forEach(child => objects(child, result));
  }
  return result;
}

describe('bounded detached canonical Text preview', () => {
  it('prepares only the exact root-to-target branch in path order', () => {
    const candidate = input();
    const preview = prepareArchiveTextPreview(candidate);
    expect(preview).toEqual({
      schema: 'liska-text-preview/1',
      sourceCanonicalSha256: canonicalSha256,
      branchTargetNodeId: 'node-current',
      title: 'Synthetic branch fixture',
      profile: { schema: 'liska-reading-profile/1', includeToolContent: false },
      rows: [
        {
          nodeId: 'node-user',
          role: 'user',
          presentedText: '[TEXT]\n│ Please preserve both answers.\n[END TEXT]\n\n',
        },
        expect.objectContaining({ nodeId: 'node-current', role: 'assistant' }),
      ],
    });
    const whole = renderArchiveText(candidate).text;
    for (const row of preview.rows) expect(whole).toContain(row.presentedText);
    expect(preview.rows[1].presentedText).not.toContain('Synthetic hidden reasoning');
    expect(preview.rows[1].presentedText).toContain('[ATTACHMENT REFERENCE]');
    expect(preview.rows[1].presentedText).toContain('│ synthetic-image.png');
    expect(JSON.stringify(preview)).not.toContain('assets/synthetic-image.png');
    candidate.targetNodeId = 'node-alternate';
    const alternate = prepareArchiveTextPreview(candidate);
    expect(alternate.rows.map(row => row.nodeId)).toEqual(['node-user', 'node-alternate']);
    expect(alternate.rows[1].presentedText).toContain('Alternate **answer**');
    expect(JSON.stringify(alternate)).not.toContain('Current answer starts here.');
  });

  it.each([
    { author: { role: 'system', name: null } },
    { author: { role: 'tool', name: null } },
    { author: { role: 'critic', name: null } },
    { author: { role: 'developer', name: null } },
    { visibility: 'hidden' },
    { visibility: 'provider-private' },
    { channel: 'analysis' },
    { channel: 'commentary' },
    { recipient: 'tool-browser' },
  ])('never promotes an ineligible message under either tool profile: %j', fields => {
    const candidate = input();
    Object.assign(candidate.archive.graph.nodes['node-current'].message!, fields);
    for (const includeToolContent of [false, true]) {
      candidate.profile.includeToolContent = includeToolContent;
      const preview = prepareArchiveTextPreview(candidate);
      expect(preview.rows.map(row => row.nodeId)).toEqual(['node-user']);
      expect(JSON.stringify(preview)).not.toContain('Current answer starts here.');
      expectFailure(
        () => createTextPresentationSelection(preview, ['node-current']),
        'text-selection-node-invalid'
      );
    }
  });

  it('allows unspecified visibility, final/user/all recipients, and empty messages', () => {
    const candidate = input();
    const message = candidate.archive.graph.nodes['node-current'].message!;
    Object.assign(message, { visibility: null, channel: null, recipient: null, blocks: [] });
    expect(prepareArchiveTextPreview(candidate).rows[1].presentedText).toBe(
      '[EMPTY MESSAGE | NO CONTENT BLOCKS]\n[END EMPTY MESSAGE | NO CONTENT BLOCKS]\n\n'
    );
    candidate.targetNodeId = 'node-root';
    const structural = prepareArchiveTextPreview(candidate);
    expect(structural.rows).toEqual([]);
    expectFailure(() => createTextPresentationSelection(structural, []), 'text-selection-empty');
  });

  it('shares all block semantics with Text, without exposing retained raw or asset evidence', () => {
    const candidate = input();
    candidate.archive.graph.nodes['node-current'].message!.blocks = [
      block('text', { text: 'alpha\r\n🦊\u2028omega\r' }),
      block('markdown', { markdown: '# heading\n**literal**' }),
      block('html', { html: '<script>inert()</script>' }),
      block('code', { language: 'py\n[END CODE SOURCE]', code: 'print(1)' }),
      block('quote', { text: 'quote', attribution: 'person' }),
      block('citation', { label: '', url: null, content: { raw: 'citation-raw-sentinel' } }),
      block('reasoning', { text: 'reasoning-sentinel' }),
      block('tool_call', { toolName: 'lookup', arguments: { q: 'query-sentinel' } }),
      block('tool_result', { toolName: null, result: { value: 'tool-result-sentinel' } }),
      block('execution_output', { output: ['execution-sentinel'] }),
      block('error', { code: null, message: 'error-sentinel' }),
      block('attachment', { assetId: 'asset-synthetic-image' }),
      block('canvas_event', { event: { raw: 'canvas-raw-sentinel' } }),
      block('unknown', { providerType: 'future', raw: { value: 'unknown-raw-sentinel' } }),
    ];
    candidate.archive.extensions = { private: { value: 'extension-sentinel' } };
    for (const includeToolContent of [false, true]) {
      candidate.profile.includeToolContent = includeToolContent;
      const preview = prepareArchiveTextPreview(candidate);
      const body = preview.rows[1].presentedText;
      expect(renderArchiveText(candidate).text).toContain(body);
      expect(body).toContain('│ alpha\n│ 🦊\n│ omega\n│ \n');
      expect(body).toContain('│ <script>inert()</script>');
      expect(body).toContain('│ py\n│ [END CODE SOURCE]');
      for (const sentinel of [
        'reasoning-sentinel',
        'query-sentinel',
        'tool-result-sentinel',
        'execution-sentinel',
        'error-sentinel',
      ])
        expect(body.includes(sentinel)).toBe(includeToolContent);
      for (const sentinel of [
        'citation-raw-sentinel',
        'canvas-raw-sentinel',
        'unknown-raw-sentinel',
        'extension-sentinel',
        'assets/synthetic-image.png',
      ])
        expect(JSON.stringify(preview)).not.toContain(sentinel);
    }
  });

  it.each([null, ''])('preserves the exact absent/empty title: %j', title => {
    const candidate = input();
    candidate.archive.conversation.title = title;
    const preview = prepareArchiveTextPreview(candidate);
    expect(preview.title).toBe(title);
    const result = renderTextSelection(
      preview,
      createTextPresentationSelection(preview, ['node-user'])
    );
    expect(result.text).toContain(title === null ? '[TITLE ABSENT]' : '[TITLE]\n│ \n');
  });

  it('takes frozen detached ownership without mutating or freezing canonical input', () => {
    const candidate = input();
    const before = structuredClone(candidate);
    const sourceObjects = objects(candidate);
    const preview = prepareArchiveTextPreview(candidate);
    expect(candidate).toEqual(before);
    expect(Object.isFrozen(candidate.archive)).toBe(false);
    for (const object of objects(preview)) {
      expect(sourceObjects.has(object)).toBe(false);
      expect(Object.isFrozen(object)).toBe(true);
    }
    const text = JSON.stringify(preview);
    candidate.archive.conversation.title = 'changed-title';
    candidate.archive.graph.nodes['node-user'].message!.blocks[0] = block('text', {
      text: 'changed-body',
    });
    candidate.profile.includeToolContent = true;
    expect(JSON.stringify(preview)).toBe(text);
    freezeDeep(before);
    expect(prepareArchiveTextPreview(before)).toEqual(preview);
  });

  it('does not consult network, browser, DOM, clock or encoding globals', () => {
    const candidate = input();
    const expected = prepareArchiveTextPreview(candidate);
    const selection = createTextPresentationSelection(expected, ['node-user']);
    const expectedText = renderTextSelection(expected, selection);
    const wire = plainPreview();
    const forbidden = vi.fn(() => {
      throw new Error('forbidden runtime');
    });
    for (const name of [
      'fetch',
      'XMLHttpRequest',
      'chrome',
      'document',
      'window',
      'Date',
      'TextEncoder',
    ])
      vi.stubGlobal(name, forbidden);
    try {
      expect(prepareArchiveTextPreview(candidate)).toEqual(expected);
      expect(adoptArchiveTextPreview(wire)).toEqual(expected);
      expect(renderTextSelection(expected, selection)).toEqual(expectedText);
      expect(forbidden).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['', 'A'.repeat(64), 'abc', 'a'.repeat(65)])(
    'rejects invalid source digest %j',
    digest => {
      expectFailure(
        () => prepareArchiveTextPreview({ ...input(), canonicalSha256: digest }),
        'text-canonical-digest-invalid'
      );
    }
  );

  it('fails closed on missing targets and invalid canonical graph/path relationships', () => {
    const candidate = input();
    expectFailure(
      () => prepareArchiveTextPreview({ ...candidate, targetNodeId: 'missing' }),
      'text-target-invalid'
    );
    candidate.archive.graph.nodes['node-current'].parentId = 'node-root';
    expectFailure(() => prepareArchiveTextPreview(candidate), 'text-archive-invalid');
  });

  it('never invokes accessors in input, archive, profile or limit fields', () => {
    for (const target of ['input', 'archive', 'profile', 'previewLimits']) {
      const candidate = input();
      const getter = vi.fn(() => {
        throw new Error('body-sentinel');
      });
      if (target === 'input')
        Object.defineProperty(candidate, 'targetNodeId', { enumerable: true, get: getter });
      if (target === 'archive')
        Object.defineProperty(candidate.archive.conversation, 'title', {
          enumerable: true,
          get: getter,
        });
      if (target === 'profile')
        Object.defineProperty(candidate.profile, 'includeToolContent', {
          enumerable: true,
          get: getter,
        });
      if (target === 'previewLimits') {
        candidate.previewLimits = {};
        Object.defineProperty(candidate.previewLimits, 'maxRows', {
          enumerable: true,
          get: getter,
        });
      }
      expectFailure(
        () => prepareArchiveTextPreview(candidate),
        target === 'previewLimits' ? 'text-preview-limits-invalid' : 'text-input-invalid'
      );
      expect(getter).not.toHaveBeenCalled();
    }
  });
});

describe('strict preview wire adoption', () => {
  it('rebinds a defensive deep-frozen copy and does not mutate the wire object', () => {
    const wire = plainPreview();
    const before = structuredClone(wire);
    const preview = adoptArchiveTextPreview(wire);
    expect(wire).toEqual(before);
    expect(preview).toEqual(wire);
    const wireObjects = objects(wire);
    for (const object of objects(preview)) {
      expect(wireObjects.has(object)).toBe(false);
      expect(Object.isFrozen(object)).toBe(true);
    }
    expectFailure(
      () => createTextPresentationSelection(wire, ['node-user']),
      'text-preview-invalid'
    );
    expectFailure(() => resolveTextPreviewRange(wire, 1, 1), 'text-preview-invalid');
    expectFailure(() => renderTextSelection(wire, {}), 'text-preview-invalid');
    expect(createTextPresentationSelection(preview, ['node-user']).messageNodeIds).toEqual([
      'node-user',
    ]);
  });

  it.each([null, [], {}, { schema: 'future/1' }])(
    'rejects malformed top-level wire input %j',
    value => {
      expectFailure(() => adoptArchiveTextPreview(value), 'text-preview-invalid');
    }
  );

  it.each([
    ['schema', 'future/1', 'text-preview-invalid'],
    ['sourceCanonicalSha256', 'BAD', 'text-canonical-digest-invalid'],
    ['branchTargetNodeId', '', 'text-target-invalid'],
    ['title', 1, 'text-preview-invalid'],
    ['profile', { schema: 'future/1', includeToolContent: false }, 'text-profile-invalid'],
    [
      'profile',
      { schema: 'liska-reading-profile/1', includeToolContent: false, extra: true },
      'text-profile-invalid',
    ],
    ['rows', [{ nodeId: '', role: 'user', presentedText: '' }], 'text-preview-invalid'],
    ['rows', [{ nodeId: 'node-a', role: 'tool', presentedText: '' }], 'text-preview-invalid'],
    ['rows', [{ nodeId: 'node-a', role: 'user', presentedText: null }], 'text-preview-invalid'],
    [
      'rows',
      [{ nodeId: 'node-a', role: 'user', presentedText: '', raw: 'sentinel' }],
      'text-preview-invalid',
    ],
  ] as const)('rejects invalid wire %s', (key, value, code) => {
    expectFailure(() => adoptArchiveTextPreview({ ...plainPreview(), [key]: value }), code);
  });

  it('rejects unknown, nonenumerable, symbol, sparse and duplicate wire fields without getters', () => {
    const getter = vi.fn(() => 'body-sentinel');
    const invalid: unknown[] = [];
    const extra = { ...plainPreview(), extra: true };
    invalid.push(extra, Object.assign(Object.create({ inherited: true }), plainPreview()));
    const symbol = plainPreview();
    Object.defineProperty(symbol, Symbol('extra'), { value: 'sentinel' });
    invalid.push(symbol);
    const hidden = plainPreview();
    Object.defineProperty(hidden, 'title', { value: 'sentinel', enumerable: false });
    invalid.push(hidden);
    const accessor = plainPreview();
    Object.defineProperty(accessor.rows[0], 'presentedText', { enumerable: true, get: getter });
    invalid.push(accessor);
    const sparse = plainPreview();
    delete (sparse.rows as unknown[])[0];
    invalid.push(sparse);
    const duplicate = plainPreview();
    (duplicate.rows as unknown[])[1] = duplicate.rows[0];
    invalid.push(duplicate);
    for (const value of invalid)
      expect(() => adoptArchiveTextPreview(value)).toThrow(TextPresentationError);
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('explicit versioned message selection', () => {
  it('snapshots scalar binding, only message IDs, and a frozen reading profile', () => {
    const preview = prepareArchiveTextPreview(input());
    const ids = ['node-user'];
    const selection = createTextPresentationSelection(preview, ids);
    expect(selection).toEqual({
      schema: 'liska-presentation-selection/1',
      sourceCanonicalSha256: canonicalSha256,
      branchTargetNodeId: 'node-current',
      profile: { schema: 'liska-reading-profile/1', includeToolContent: false },
      messageNodeIds: ['node-user'],
    });
    ids[0] = 'node-current';
    expect(selection.messageNodeIds).toEqual(['node-user']);
    for (const object of objects(selection)) expect(Object.isFrozen(object)).toBe(true);
    const wire = structuredClone(selection);
    const adopted = snapshotTextPresentationSelection(preview, wire);
    expect(adopted).toEqual(selection);
    expect(adopted).not.toBe(wire);
    expect(adopted.profile).not.toBe(wire.profile);
    expect(adopted.messageNodeIds).not.toBe(wire.messageNodeIds);
    expect(resolveTextPresentationSelection(preview, wire)).toEqual([preview.rows[0]]);
    expect(Object.isFrozen(resolveTextPresentationSelection(preview, wire))).toBe(true);
  });

  it.each([
    [[], 'text-selection-empty'],
    [[''], 'text-selection-node-invalid'],
    [['node-root'], 'text-selection-node-invalid'],
    [['node-alternate'], 'text-selection-node-invalid'],
    [['missing'], 'text-selection-node-invalid'],
    [['node-user', 'node-user'], 'text-selection-node-invalid'],
    [['node-current', 'node-user'], 'text-selection-order-invalid'],
  ] as const)('rejects empty/foreign/structural/duplicate/out-of-order IDs %j', (ids, code) => {
    const preview = prepareArchiveTextPreview(input());
    expectFailure(() => createTextPresentationSelection(preview, ids), code);
  });

  it.each([
    ['sourceCanonicalSha256', 'b'.repeat(64), 'text-selection-binding-mismatch'],
    ['sourceCanonicalSha256', 'BAD', 'text-canonical-digest-invalid'],
    ['branchTargetNodeId', 'node-alternate', 'text-selection-binding-mismatch'],
    [
      'profile',
      { schema: 'liska-reading-profile/1', includeToolContent: true },
      'text-selection-binding-mismatch',
    ],
    ['profile', { schema: 'future/1', includeToolContent: false }, 'text-profile-invalid'],
    [
      'profile',
      { schema: 'liska-reading-profile/1', includeToolContent: 'false' },
      'text-profile-invalid',
    ],
    ['schema', 'future/1', 'text-selection-invalid'],
    ['messageNodeIds', null, 'text-selection-invalid'],
  ] as const)('rejects stale/malformed selection binding %s', (key, value, code) => {
    const preview = prepareArchiveTextPreview(input());
    const selection = createTextPresentationSelection(preview, ['node-user']);
    expectFailure(
      () => snapshotTextPresentationSelection(preview, { ...selection, [key]: value }),
      code
    );
  });

  it.each(['query', 'ranges', 'selectedNodeIds', 'title', 'extra'])(
    'rejects nonauthority field %s',
    key => {
      const preview = prepareArchiveTextPreview(input());
      const selection = createTextPresentationSelection(preview, ['node-user']);
      expectFailure(
        () => snapshotTextPresentationSelection(preview, { ...selection, [key]: 'sentinel' }),
        'text-selection-invalid'
      );
    }
  );

  it('rejects accessors, symbols, sparse IDs and array extension fields without invoking code', () => {
    const preview = prepareArchiveTextPreview(input());
    for (const field of ['selection', 'profile', 'ids', 'symbol', 'sparse', 'array-extra']) {
      const selection = structuredClone(createTextPresentationSelection(preview, ['node-user']));
      const getter = vi.fn(() => {
        throw new Error('body-sentinel');
      });
      if (field === 'selection')
        Object.defineProperty(selection, 'messageNodeIds', { enumerable: true, get: getter });
      if (field === 'profile')
        Object.defineProperty(selection.profile, 'includeToolContent', {
          enumerable: true,
          get: getter,
        });
      if (field === 'ids')
        Object.defineProperty(selection.messageNodeIds, '0', { enumerable: true, get: getter });
      if (field === 'symbol') Object.defineProperty(selection, Symbol('extra'), { value: 1 });
      if (field === 'sparse') delete (selection.messageNodeIds as unknown[])[0];
      if (field === 'array-extra') Object.assign(selection.messageNodeIds, { query: 'sentinel' });
      expect(() => snapshotTextPresentationSelection(preview, selection)).toThrow(
        TextPresentationError
      );
      expect(getter).not.toHaveBeenCalled();
    }
  });

  it('resolves 1-based inclusive ranges to stable complete row-order IDs only', () => {
    const preview = prepareArchiveTextPreview(input());
    expect(resolveTextPreviewRange(preview, 1, 1)).toEqual(['node-user']);
    expect(resolveTextPreviewRange(preview, 1, 2)).toEqual(['node-user', 'node-current']);
    expect(resolveTextPreviewRange(preview, 2, 2)).toEqual(['node-current']);
    expect(Object.isFrozen(resolveTextPreviewRange(preview, 1, 2))).toBe(true);
    for (const [start, end] of [
      [0, 1],
      [2, 1],
      [1, 3],
      [1.5, 2],
      [NaN, 2],
      [1, Infinity],
    ])
      expectFailure(() => resolveTextPreviewRange(preview, start, end), 'text-range-invalid');
  });
});

describe('selected Text excerpt', () => {
  it('renders exactly the explicit selected bodies with provenance, never the deselected or alternate bodies', () => {
    const candidate = input();
    candidate.archive.conversation.title = 'title\r\n[END TITLE]';
    const preview = prepareArchiveTextPreview(candidate);
    for (const selected of ['node-user', 'node-current']) {
      const selection = createTextPresentationSelection(preview, [selected]);
      const result = renderTextSelection(preview, selection);
      expect(result).toMatchObject({
        schema: 'liska-text-selection/1',
        rendererVersion: 'liska-text/1',
        availableMessageCount: 2,
        renderedMessageCount: 1,
        selection,
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(result.text).toContain('LISKA SELECTED TEXT READING VIEW');
      expect(result.text).toContain('│ title\n│ [END TITLE]');
      expect(result.text).toContain(`Canonical SHA-256: ${canonicalSha256}`);
      expect(result.text).toContain('[BRANCH TARGET NODE ID]\n│ node-current');
      expect(result.text).toContain('Reading profile: liska-reading-profile/1');
      expect(result.text).toContain('Include tool content: false');
      expect(result.text).toContain('Selected messages: 1 of 2');
      expect(result.text).toContain('explicit excerpt, not a complete branch or archive authority');
      for (const row of preview.rows)
        expect(result.text.includes(row.presentedText)).toBe(row.nodeId === selected);
      expect(result.text).not.toContain('Alternate **answer**');
      expect(result.text).not.toContain('"graph"');
      expect(result.text).not.toContain('"extensions"');
      expect(result.text).not.toContain('"manifestSha256"');
      expect(renderTextSelection(preview, selection)).toEqual(result);
    }
  });

  it('preserves Unicode across chunk boundaries and exact UTF-16/UTF-8 output ceilings', () => {
    const candidate = input();
    const source = `${'x\n'.repeat(4097)}🦊\né\ud800\udc00\ud800x\udc00`;
    candidate.archive.graph.nodes['node-current'].message!.blocks = [
      block('text', { text: source }),
    ];
    const preview = prepareArchiveTextPreview(candidate);
    const selection = createTextPresentationSelection(preview, ['node-current']);
    const result = renderTextSelection(preview, selection);
    const bytes = new TextEncoder().encode(result.text).byteLength;
    expect(result.text).toContain(preview.rows[1].presentedText);
    expect(bytes).toBeGreaterThan(result.text.length);
    expect(
      renderTextSelection(preview, selection, {
        maxTextChars: result.text.length,
        maxTextBytes: bytes,
      })
    ).toEqual(result);
    expectFailure(
      () => renderTextSelection(preview, selection, { maxTextChars: result.text.length - 1 }),
      'text-output-limit'
    );
    expectFailure(
      () => renderTextSelection(preview, selection, { maxTextBytes: bytes - 1 }),
      'text-output-limit'
    );
    expectFailure(
      () => renderTextSelection(preview, selection, { maxSourceChars: 1 }),
      'text-source-char-limit'
    );
  });
});

describe('hard preview and wire budgets', () => {
  it.each([
    null,
    [],
    { maxRows: 0 },
    { maxRows: -1 },
    { maxRowChars: 0.5 },
    { maxRows: TEXT_PREVIEW_LIMITS.maxRows + 1 },
    { maxTitleChars: Number.MAX_SAFE_INTEGER + 1 },
    { extra: 1 },
  ])('rejects invalid/taller UI limits %j', previewLimits => {
    expectFailure(
      () => prepareArchiveTextPreview({ ...input(), previewLimits } as TextPreviewInput),
      'text-preview-limits-invalid'
    );
    expectFailure(
      () => adoptArchiveTextPreview(plainPreview(), previewLimits as never),
      'text-preview-limits-invalid'
    );
  });

  it('enforces exact aggregate/body/title boundaries without truncation in either path', () => {
    const candidate = input();
    const preview = prepareArchiveTextPreview(candidate);
    const maxRowChars = Math.max(...preview.rows.map(row => row.presentedText.length));
    const maxTotalChars =
      preview.sourceCanonicalSha256.length +
      preview.branchTargetNodeId.length +
      preview.title!.length +
      preview.rows.reduce((sum, row) => sum + row.nodeId.length + row.presentedText.length, 0);
    const exact = {
      maxRows: preview.rows.length,
      maxRowChars,
      maxTitleChars: preview.title!.length,
      maxTotalChars,
    };
    expect(prepareArchiveTextPreview({ ...candidate, previewLimits: exact })).toEqual(preview);
    expect(adoptArchiveTextPreview(plainPreview(), exact)).toEqual(preview);
    for (const [field, code] of [
      ['maxRows', 'text-preview-row-limit'],
      ['maxRowChars', 'text-preview-row-char-limit'],
      ['maxTitleChars', 'text-preview-title-char-limit'],
      ['maxTotalChars', 'text-preview-total-char-limit'],
    ] as const) {
      const limits = { ...exact, [field]: exact[field] - 1 };
      expectFailure(() => prepareArchiveTextPreview({ ...candidate, previewLimits: limits }), code);
      expectFailure(() => adoptArchiveTextPreview(plainPreview(), limits), code);
    }
  });

  it('enforces hard 5000-row, 1 Mi row, 64 Ki title and 8 Mi aggregate wire ceilings', () => {
    const wire = plainPreview();
    const row = { nodeId: 'row-0', role: 'user', presentedText: '' };
    expectFailure(
      () =>
        adoptArchiveTextPreview({
          ...wire,
          rows: Array.from({ length: 5001 }, (_, i) => ({ ...row, nodeId: `row-${i}` })),
        }),
      'text-preview-row-limit'
    );
    expectFailure(
      () =>
        adoptArchiveTextPreview({
          ...wire,
          rows: [{ ...row, presentedText: 'x'.repeat(1024 * 1024 + 1) }],
        }),
      'text-preview-row-char-limit'
    );
    expectFailure(
      () => adoptArchiveTextPreview({ ...wire, title: 'x'.repeat(64 * 1024 + 1) }),
      'text-preview-title-char-limit'
    );
    expectFailure(
      () =>
        adoptArchiveTextPreview({
          ...wire,
          rows: Array.from({ length: 8 }, (_, i) => ({
            ...row,
            nodeId: `row-${i}`,
            presentedText: 'x'.repeat(1024 * 1024),
          })),
        }),
      'text-preview-total-char-limit'
    );
  });

  it('checks expanded presented text rather than just source length', () => {
    const candidate = input();
    candidate.archive.graph.nodes['node-current'].message!.blocks = [
      block('text', { text: '\n'.repeat(100) }),
    ];
    expectFailure(
      () => prepareArchiveTextPreview({ ...candidate, previewLimits: { maxRowChars: 300 } }),
      'text-preview-row-char-limit'
    );
  });

  it('keeps existing aggregate source, block, JSON and output budgets active', () => {
    const candidate = input();
    candidate.profile.includeToolContent = true;
    for (const [field, code] of [
      ['maxSelectedNodes', 'text-selected-node-limit'],
      ['maxSelectedBlocks', 'text-selected-block-limit'],
      ['maxSourceChars', 'text-source-char-limit'],
      ['maxTextChars', 'text-output-limit'],
      ['maxTextBytes', 'text-output-limit'],
      ['maxJsonSerializationChars', 'text-json-serialization-limit'],
    ] as const)
      expectFailure(
        () => prepareArchiveTextPreview({ ...candidate, limits: { [field]: 1 } }),
        code
      );
  });
});
