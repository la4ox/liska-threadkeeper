import { afterEach, describe, expect, it, vi } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Root } from 'mdast';
import {
  FINAL_MARKDOWN_GATE_MAX_NODES,
  finalizeAppendReadingMarkdown,
  type FinalAppendMarkdownOptions,
  type FinalMarkdownMarkerRange,
} from '../../src/lib/final-markdown-gate';
import { MAX_CONTENT_SIZE } from '../../src/lib/constants';
import {
  MESSAGE_BOUNDARY_FORMAT_MARKER,
  MESSAGE_BOUNDARY_MARKER,
} from '../../src/lib/message-counter';

vi.mock('mdast-util-from-markdown', { spy: true });

afterEach(() => {
  vi.clearAllMocks();
});

function markerRange(body: string, start: number, marker = MESSAGE_BOUNDARY_MARKER) {
  const offset = body.indexOf(marker, start);
  if (offset < 0) throw new Error('Synthetic marker was not found');
  return { start: offset, end: offset + marker.length };
}

function joined(old: string, tail: string) {
  const appendFrom = old.length + 2;
  const body = `${old}\n\n${tail}`;
  const requiredMarkerRanges = tail.includes(MESSAGE_BOUNDARY_MARKER)
    ? [markerRange(body, appendFrom)]
    : [];
  return { body, options: { appendFrom, requiredMarkerRanges } };
}

function accept(old: string, tail: string) {
  const { body, options } = joined(old, tail);
  expect(finalizeAppendReadingMarkdown(body, options)).toEqual({ ok: true, body });
}

function rootWithChildren(body: string, children: Root['children']): Root {
  return {
    type: 'root',
    children,
    position: {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: body.length + 1, offset: body.length },
    },
  };
}

describe('finalizeAppendReadingMarkdown: unchanged accepted output', () => {
  it('accepts exact positioned message and format sentinels', () => {
    const body = `${MESSAGE_BOUNDARY_FORMAT_MARKER}\n\n${MESSAGE_BOUNDARY_MARKER}\n\nAnswer`;
    const options = {
      appendFrom: 0,
      requiredMarkerRanges: [
        markerRange(body, 0, MESSAGE_BOUNDARY_FORMAT_MARKER),
        markerRange(body, MESSAGE_BOUNDARY_FORMAT_MARKER.length),
      ],
    };
    const before = structuredClone(options);

    expect(finalizeAppendReadingMarkdown(body, options)).toEqual({ ok: true, body });
    expect(finalizeAppendReadingMarkdown(body, options)).toEqual({ ok: true, body });
    expect(options).toEqual(before);
  });

  it('uses UTF-16 offsets rather than bytes after astral and multibyte prose', () => {
    accept('Old 🦊 猫 body', `${MESSAGE_BOUNDARY_MARKER}\n\nNew answer`);
  });

  it('allows closed existing HTML without rewriting its attributes or local links', () => {
    accept(
      '<div class="user-owned">Old HTML</div>\n\n[[Local note]]',
      `${MESSAGE_BOUNDARY_MARKER}\n\nNew prose`
    );
  });

  it.each([
    ['backtick', '```html\n<img src="https://example.invalid/literal">\n```'],
    ['tilde', '~~~html\n<script>literal()</script>\n~~~'],
    ['indented', '    <pre>literal code</pre>'],
    ['inline', '`<span>literal</span>`'],
  ])('allows %s code wholly in the tail', (_label, code) => {
    accept('Old body', `${MESSAGE_BOUNDARY_MARKER}\n\n${code}`);
  });

  it('allows same-side references and respects the first definition in source order', () => {
    accept(
      '[old][a]\n\n[a]: https://old.example',
      `${MESSAGE_BOUNDARY_MARKER}\n\n[new][b]\n\n[b]: https://new.example`
    );
    // A duplicate tail definition must not override the effective old binding.
    accept('[old][a]\n\n[a]: https://first.example', '[a]: https://ignored.example');
  });

  it('does not misrepresent renderer-specific footnotes as CommonMark bindings', () => {
    accept('[^report]: explanation', `${MESSAGE_BOUNDARY_MARKER}\n\nReport[^report]`);
  });

  it('accepts an empty source and a seam exactly at EOF', () => {
    expect(finalizeAppendReadingMarkdown('', { appendFrom: 0, requiredMarkerRanges: [] })).toEqual({
      ok: true,
      body: '',
    });
    const body = 'Old body';
    expect(
      finalizeAppendReadingMarkdown(body, { appendFrom: body.length, requiredMarkerRanges: [] })
    ).toEqual({ ok: true, body });
  });
});

describe('finalizeAppendReadingMarkdown: opaque context isolation', () => {
  it.each([
    ['script', '<script>', '</script>'],
    ['pre', '<pre>', '</pre>'],
    ['comment', '<!--', '-->'],
    ['backtick fence', '```', '```'],
    ['tilde fence', '~~~', '~~~'],
    ['unequal backtick fence', '````', '```'],
    ['list-contained fence', '- item\n\n  ```', '  ```'],
    ['indented code', '    old code', '    tail code'],
  ])('refuses a %s node spanning the seam', (_label, old, close) => {
    const { body, options } = joined(old, close);
    expect(finalizeAppendReadingMarkdown(body, options)).toEqual({
      ok: false,
      code: 'markdown-context-crosses-append-boundary',
    });
  });

  it('refuses a quoted fence only when its container actually continues across the seam', () => {
    const old = '> ```\n>\n';
    const body = `${old}> new code\n> \`\`\``;
    expect(
      finalizeAppendReadingMarkdown(body, { appendFrom: old.length, requiredMarkerRanges: [] })
    ).toEqual({ ok: false, code: 'markdown-context-crosses-append-boundary' });
    // An unquoted blank separator terminates the old quote, unlike an ordinary
    // top-level fence. A source-only fence scanner would incorrectly refuse it.
    accept('> ```', '> ```');
  });

  it('refuses an inline-code span crossing the seam', () => {
    const body = 'old `code\nnew code`';
    expect(
      finalizeAppendReadingMarkdown(body, { appendFrom: 10, requiredMarkerRanges: [] })
    ).toEqual({ ok: false, code: 'markdown-context-crosses-append-boundary' });
  });

  it('requires a marker to remain a standalone HTML node, not only a source line', () => {
    const tail = `~~~\n${MESSAGE_BOUNDARY_MARKER}\n~~~`;
    const { body, options } = joined('Old body', tail);
    expect(finalizeAppendReadingMarkdown(body, options)).toEqual({
      ok: false,
      code: 'markdown-boundary-marker-hidden',
    });
  });

  it('refuses new HTML instead of sanitizing or returning rewritten source', () => {
    const { body, options } = joined('Old body', '<img src="https://example.invalid/pixel">');
    expect(finalizeAppendReadingMarkdown(body, options)).toEqual({
      ok: false,
      code: 'markdown-finalization-failed',
    });
    expect(body).toContain('<img');
  });

  it('does not grant authority to a marker-shaped string with no owned range', () => {
    const body = MESSAGE_BOUNDARY_MARKER;
    expect(
      finalizeAppendReadingMarkdown(body, { appendFrom: 0, requiredMarkerRanges: [] })
    ).toEqual({ ok: false, code: 'markdown-finalization-failed' });
  });
});

describe('finalizeAppendReadingMarkdown: cross-seam CommonMark references', () => {
  it.each([
    ['new link bound by old definition', '[r]: http://127.0.0.1/admin', '[open][r]'],
    ['old link bound by new definition', '[open][r]', '[r]: https://new.example'],
    ['new image bound by old definition', '[r]: https://old.example/pixel', '![pixel][r]'],
    ['old image bound by new definition', '![pixel][r]', '[r]: https://new.example/pixel'],
    ['case-normalized labels', '[LaBeL]: https://old.example', '[open][label]'],
    ['collapsed labels', '[label]: https://old.example', '[label][]'],
    ['shortcut labels', '[label]: https://old.example', '[label]'],
  ])('refuses %s', (_label, old, tail) => {
    const { body, options } = joined(old, tail);
    expect(finalizeAppendReadingMarkdown(body, options)).toEqual({
      ok: false,
      code: 'markdown-reference-crosses-append-boundary',
    });
  });

  it('uses the first effective definition rather than a later same-side duplicate', () => {
    const { body, options } = joined(
      '[r]: https://old.example',
      '[open][r]\n\n[r]: https://new.example'
    );
    expect(finalizeAppendReadingMarkdown(body, options)).toEqual({
      ok: false,
      code: 'markdown-reference-crosses-append-boundary',
    });
  });

  it('refuses a reference or its definition whose own position crosses the seam', () => {
    const body = '[open][r]\n\n[r]: https://example.invalid';
    for (const appendFrom of [3, body.indexOf('https') + 2]) {
      expect(finalizeAppendReadingMarkdown(body, { appendFrom, requiredMarkerRanges: [] })).toEqual(
        { ok: false, code: 'markdown-reference-crosses-append-boundary' }
      );
    }
  });
});

describe('finalizeAppendReadingMarkdown: invalid authority and bounded work', () => {
  it.each([
    ['negative', -1],
    ['fractional', 0.5],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['past EOF', 100],
  ])('rejects a %s seam', (_label, appendFrom) => {
    expect(finalizeAppendReadingMarkdown('body', { appendFrom, requiredMarkerRanges: [] })).toEqual(
      { ok: false, code: 'markdown-finalization-failed' }
    );
    expect(fromMarkdown).not.toHaveBeenCalled();
  });

  it('rejects a seam splitting a surrogate pair', () => {
    expect(
      finalizeAppendReadingMarkdown('🦊', { appendFrom: 1, requiredMarkerRanges: [] })
    ).toEqual({ ok: false, code: 'markdown-finalization-failed' });
  });

  it.each(['\r', '\r\n'])('requires LF-normalized input rather than %j offsets', eol => {
    const body = `old${eol}${MESSAGE_BOUNDARY_MARKER}`;
    expect(
      finalizeAppendReadingMarkdown(body, { appendFrom: 0, requiredMarkerRanges: [] })
    ).toEqual({ ok: false, code: 'markdown-finalization-failed' });
    expect(fromMarkdown).not.toHaveBeenCalled();
  });

  it.each([
    ['indented', ` ${MESSAGE_BOUNDARY_MARKER}`, 1, 0],
    ['trailing space', `${MESSAGE_BOUNDARY_MARKER} `, 0, 0],
    ['wrong end', MESSAGE_BOUNDARY_MARKER, 0, -1],
    ['forged', '<!-- liska-message:v1 --x>', 0, 0],
  ])('rejects %s marker authority', (_label, body, start, endDelta) => {
    const end = start + MESSAGE_BOUNDARY_MARKER.length + endDelta;
    expect(
      finalizeAppendReadingMarkdown(body, {
        appendFrom: 0,
        requiredMarkerRanges: [{ start, end }],
      })
    ).toEqual({ ok: false, code: 'markdown-finalization-failed' });
  });

  it('rejects overlapping, duplicate, reversed and old-region marker ranges', () => {
    const { body, options } = joined(MESSAGE_BOUNDARY_MARKER, MESSAGE_BOUNDARY_MARKER);
    const oldRange = markerRange(body, 0);
    const newRange = markerRange(body, options.appendFrom);
    const cases = [
      [newRange, newRange],
      [{ start: newRange.start + 1, end: newRange.end }],
      [{ start: newRange.end, end: newRange.start }],
      [oldRange],
    ];
    for (const requiredMarkerRanges of cases) {
      expect(finalizeAppendReadingMarkdown(body, { ...options, requiredMarkerRanges })).toEqual({
        ok: false,
        code: 'markdown-finalization-failed',
      });
    }
  });

  it('rejects accessors and extra range fields without invoking a getter', () => {
    const getter = vi.fn(() => 0);
    const accessor = Object.defineProperty({ end: MESSAGE_BOUNDARY_MARKER.length }, 'start', {
      get: getter,
      enumerable: true,
    });
    const extras = { start: 0, end: MESSAGE_BOUNDARY_MARKER.length, extra: true };
    for (const range of [accessor, extras]) {
      expect(
        finalizeAppendReadingMarkdown(MESSAGE_BOUNDARY_MARKER, {
          appendFrom: 0,
          requiredMarkerRanges: [range as FinalMarkdownMarkerRange],
        })
      ).toEqual({ ok: false, code: 'markdown-finalization-failed' });
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('snapshots array data without running a replaced iterator or indexed accessor', () => {
    const ranges = [{ start: 0, end: MESSAGE_BOUNDARY_MARKER.length }];
    const iterator = vi.fn(() => {
      throw new Error('synthetic-iterator-details');
    });
    Object.defineProperty(ranges, Symbol.iterator, { value: iterator });
    expect(
      finalizeAppendReadingMarkdown(MESSAGE_BOUNDARY_MARKER, {
        appendFrom: 0,
        requiredMarkerRanges: ranges,
      })
    ).toEqual({ ok: true, body: MESSAGE_BOUNDARY_MARKER });
    expect(iterator).not.toHaveBeenCalled();

    const getter = vi.fn(() => ranges[0]);
    const accessors = new Array<FinalMarkdownMarkerRange>(1);
    Object.defineProperty(accessors, '0', { get: getter, enumerable: true });
    expect(
      finalizeAppendReadingMarkdown(MESSAGE_BOUNDARY_MARKER, {
        appendFrom: 0,
        requiredMarkerRanges: accessors,
      })
    ).toEqual({ ok: false, code: 'markdown-finalization-failed' });
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects sparse and over-budget authority arrays before parsing', () => {
    for (const length of [1, FINAL_MARKDOWN_GATE_MAX_NODES + 1]) {
      expect(
        finalizeAppendReadingMarkdown('body', {
          appendFrom: 0,
          requiredMarkerRanges: new Array<FinalMarkdownMarkerRange>(length),
        })
      ).toEqual({ ok: false, code: 'markdown-finalization-failed' });
    }
    expect(fromMarkdown).not.toHaveBeenCalled();
  });

  it('fails closed on options accessors and Proxy failures', () => {
    const getter = vi.fn(() => 0);
    const options = Object.defineProperty({ requiredMarkerRanges: [] }, 'appendFrom', {
      get: getter,
      enumerable: true,
    });
    expect(finalizeAppendReadingMarkdown('body', options as FinalAppendMarkdownOptions)).toEqual({
      ok: false,
      code: 'markdown-finalization-failed',
    });
    expect(getter).not.toHaveBeenCalled();
    const hostile = new Proxy(options, {
      getOwnPropertyDescriptor() {
        throw new Error('synthetic-private-error');
      },
    });
    expect(finalizeAppendReadingMarkdown('body', hostile as FinalAppendMarkdownOptions)).toEqual({
      ok: false,
      code: 'markdown-finalization-failed',
    });
  });

  it('rejects an over-byte-budget body before parsing', () => {
    const body = '猫'.repeat(Math.floor(MAX_CONTENT_SIZE / 3) + 1);
    expect(
      finalizeAppendReadingMarkdown(body, { appendFrom: 0, requiredMarkerRanges: [] })
    ).toEqual({ ok: false, code: 'markdown-finalization-failed' });
    expect(fromMarkdown).not.toHaveBeenCalled();
  });

  it('fails closed on parser errors without returning exception prose', () => {
    vi.mocked(fromMarkdown).mockImplementationOnce(() => {
      throw new Error('synthetic-private-parser-details');
    });
    expect(
      finalizeAppendReadingMarkdown('body', { appendFrom: 0, requiredMarkerRanges: [] })
    ).toEqual({ ok: false, code: 'markdown-finalization-failed' });
  });

  it('fails closed if the parser root does not describe the exact source', () => {
    const body = 'body';
    const root = rootWithChildren(body, []);
    root.position!.end.offset = 2;
    vi.mocked(fromMarkdown).mockReturnValueOnce(root);
    expect(
      finalizeAppendReadingMarkdown(body, { appendFrom: 0, requiredMarkerRanges: [] })
    ).toEqual({ ok: false, code: 'markdown-finalization-failed' });
  });

  it.each([undefined, Number.NaN, -1, 0.5, 99])(
    'fails closed on a relevant node with invalid offset %s',
    offset => {
      const body = '<pre>';
      const node = {
        type: 'html',
        value: body,
        position: {
          start: { line: 1, column: 1, offset },
          end: { line: 1, column: 6, offset: body.length },
        },
      };
      vi.mocked(fromMarkdown).mockReturnValueOnce(
        rootWithChildren(body, [node] as Root['children'])
      );
      expect(
        finalizeAppendReadingMarkdown(body, { appendFrom: 0, requiredMarkerRanges: [] })
      ).toEqual({ ok: false, code: 'markdown-finalization-failed' });
    }
  );

  it('fails closed when a resolved reference has no effective definition', () => {
    const body = '[open][r]';
    const node = {
      type: 'linkReference',
      identifier: 'r',
      referenceType: 'full',
      children: [],
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: body.length + 1, offset: body.length },
      },
    };
    vi.mocked(fromMarkdown).mockReturnValueOnce(rootWithChildren(body, [node] as Root['children']));
    expect(
      finalizeAppendReadingMarkdown(body, { appendFrom: 0, requiredMarkerRanges: [] })
    ).toEqual({ ok: false, code: 'markdown-finalization-failed' });
  });

  it('rejects excessive scheduled tree work before visiting a huge child array', () => {
    const body = 'x';
    vi.mocked(fromMarkdown).mockReturnValueOnce(
      rootWithChildren(body, new Array(FINAL_MARKDOWN_GATE_MAX_NODES) as Root['children'])
    );
    expect(
      finalizeAppendReadingMarkdown(body, { appendFrom: 0, requiredMarkerRanges: [] })
    ).toEqual({ ok: false, code: 'markdown-finalization-failed' });
  });

  it('rejects cyclic parser evidence without an unbounded traversal', () => {
    const body = 'x';
    const tree = rootWithChildren(body, []);
    tree.children.push(tree as unknown as Root['children'][number]);
    vi.mocked(fromMarkdown).mockReturnValueOnce(tree);
    expect(
      finalizeAppendReadingMarkdown(body, { appendFrom: 0, requiredMarkerRanges: [] })
    ).toEqual({ ok: false, code: 'markdown-finalization-failed' });
  });
});
