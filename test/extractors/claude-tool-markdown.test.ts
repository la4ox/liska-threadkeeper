import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLAUDE_TOOL_LIMITS,
  ClaudeToolConversionBudget,
  appendClaudeToolPart,
  claudeToolHtmlToMarkdown,
} from '../../src/content/extractors/claude-tool-markdown';

describe('Claude tool conversion resource boundaries', () => {
  afterEach(() => vi.restoreAllMocks());

  it('documents the operation-local ceilings', () => {
    expect(CLAUDE_TOOL_LIMITS).toEqual({
      sectionHtmlBytes: 2 * 1024 ** 2,
      rawHtmlBytes: 16 * 1024 ** 2,
      sectionMarkupDelimiters: 20_000,
      markupDelimiters: 100_000,
      sections: 4096,
      codeBlocks: 4096,
      domNodes: 100_000,
      tableNestingDepth: 1,
      metadataEntries: 4096,
      orderedListSiblingWork: 2048 ** 2,
      structureWorkUnits: 64 * 1024 ** 2,
      markdownBytes: 32 * 1024 ** 2,
    });
  });

  it('accepts the exact raw section ceiling and rejects one over before encoding or parsing', () => {
    const html = 'x'.repeat(CLAUDE_TOOL_LIMITS.sectionHtmlBytes);
    expect(() => new ClaudeToolConversionBudget().beginSection(html)).not.toThrow();

    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    const createElement = vi.spyOn(document, 'createElement');
    expect(() => claudeToolHtmlToMarkdown(html + 'x', new ClaudeToolConversionBudget())).toThrow(
      'Claude tool conversion limit exceeded: section HTML bytes.'
    );
    expect(encode).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
  });

  it('measures UTF-8 bytes, not UTF-16 length, at the exact section boundary', () => {
    const html = 'я'.repeat(CLAUDE_TOOL_LIMITS.sectionHtmlBytes / 2);
    expect(() => new ClaudeToolConversionBudget().beginSection(html)).not.toThrow();
    expect(() => new ClaudeToolConversionBudget().beginSection(html + 'x')).toThrow(
      'Claude tool conversion limit exceeded: section HTML bytes.'
    );
  });

  it('accepts exactly 16 MiB aggregate input and rejects one further byte before encoding', () => {
    const budget = new ClaudeToolConversionBudget();
    const html = 'x'.repeat(CLAUDE_TOOL_LIMITS.sectionHtmlBytes);
    for (let i = 0; i < 8; i += 1) budget.beginSection(html);
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    expect(() => budget.consumeHtml('x')).toThrow(
      'Claude tool conversion limit exceeded: aggregate HTML bytes.'
    );
    expect(encode).not.toHaveBeenCalled();
  });

  it('charges repeated conversion fragments as input work rather than unique source bytes', () => {
    const budget = new ClaudeToolConversionBudget();
    const html = 'x'.repeat(CLAUDE_TOOL_LIMITS.sectionHtmlBytes);
    budget.beginSection(html);
    for (let i = 0; i < 7; i += 1) budget.consumeHtml(html);
    expect(() => budget.consumeHtml('x')).toThrow('aggregate HTML bytes');
  });

  it('rejects markup-count amplification before encoding, sanitization, or DOM parsing', () => {
    const exact = '<'.repeat(CLAUDE_TOOL_LIMITS.sectionMarkupDelimiters);
    expect(() => new ClaudeToolConversionBudget().beginSection(exact)).not.toThrow();

    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    const createElement = vi.spyOn(document, 'createElement');
    expect(() => new ClaudeToolConversionBudget().beginSection(exact + '<')).toThrow(
      'Claude tool conversion limit exceeded: section HTML markup delimiters.'
    );
    expect(encode).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
  });

  it('rejects the nested paragraph amplification reproducer before sanitization', () => {
    const html =
      '<blockquote>'.repeat(200) + '<p>x</p>'.repeat(42_000) + '</blockquote>'.repeat(200);
    const createElement = vi.spyOn(document, 'createElement');

    expect(() => claudeToolHtmlToMarkdown(html, new ClaudeToolConversionBudget())).toThrow(
      'Claude tool conversion limit exceeded: section HTML markup delimiters.'
    );
    expect(createElement).not.toHaveBeenCalled();
  });

  it('shares the raw markup-count ceiling across repeated work', () => {
    const budget = new ClaudeToolConversionBudget();
    const chunk = '<'.repeat(CLAUDE_TOOL_LIMITS.sectionMarkupDelimiters);
    for (let index = 0; index < 5; index += 1) budget.consumeHtml(chunk);
    expect(() => budget.consumeHtml('<')).toThrow(
      'Claude tool conversion limit exceeded: aggregate HTML markup delimiters.'
    );
  });

  it('rejects nested non-code amplification before Turndown can build oversized Markdown', () => {
    const html = '<blockquote>'.repeat(200) + `x\n`.repeat(21_000) + '</blockquote>'.repeat(200);

    expect(() => claudeToolHtmlToMarkdown(html, new ClaudeToolConversionBudget())).toThrow(
      'Claude tool conversion limit exceeded: HTML structure work.'
    );
  });

  it('charges long one-line content once per ancestor before conversion', () => {
    const depth = 70;
    const html =
      '<blockquote>'.repeat(depth) + 'x'.repeat(1024 ** 2) + '</blockquote>'.repeat(depth);

    expect(() => claudeToolHtmlToMarkdown(html, new ClaudeToolConversionBudget())).toThrow(
      'Claude tool conversion limit exceeded: HTML structure work.'
    );
  });

  it('counts decoded attribute line breaks before nested math can amplify them', () => {
    const html =
      '<blockquote>'.repeat(200) +
      `<div data-math="${'x&#10;'.repeat(90_000)}">x</div>` +
      '</blockquote>'.repeat(200);

    expect(() => claudeToolHtmlToMarkdown(html, new ClaudeToolConversionBudget())).toThrow(
      'Claude tool conversion limit exceeded: HTML structure work.'
    );
  });

  it('rejects selector-amplifying nested tables before Markdown conversion', () => {
    const nestedTable = (depth: number): string =>
      '<table><tr><td>'.repeat(depth) + 'value' + '</td></tr></table>'.repeat(depth);

    expect(() =>
      claudeToolHtmlToMarkdown(
        nestedTable(CLAUDE_TOOL_LIMITS.tableNestingDepth),
        new ClaudeToolConversionBudget()
      )
    ).not.toThrow();

    expect(() =>
      claudeToolHtmlToMarkdown(
        nestedTable(CLAUDE_TOOL_LIMITS.tableNestingDepth + 1),
        new ClaudeToolConversionBudget()
      )
    ).toThrow('Claude tool conversion limit exceeded: nested table depth.');
  });

  it('rejects ordered-list sibling scans above their aggregate work ceiling', () => {
    const items = '<li>x</li>'.repeat(2049);

    expect(() =>
      claudeToolHtmlToMarkdown(`<ol>${items}</ol>`, new ClaudeToolConversionBudget())
    ).toThrow('Claude tool conversion limit exceeded: ordered-list sibling work.');
  });

  it('accepts exactly 4096 tool sections, including empty ones, then rejects the next', () => {
    const budget = new ClaudeToolConversionBudget();
    for (let i = 0; i < CLAUDE_TOOL_LIMITS.sections; i += 1) budget.beginSection('');
    expect(() => budget.beginSection('')).toThrow(
      'Claude tool conversion limit exceeded: tool sections.'
    );
  });

  it('counts every converted fragment as a section, including empty nested Markdown', () => {
    const budget = new ClaudeToolConversionBudget();
    for (let i = 0; i < CLAUDE_TOOL_LIMITS.sections - 1; i += 1) budget.beginSection('');
    expect(claudeToolHtmlToMarkdown('', budget)).toBe('');
    const createElement = vi.spyOn(document, 'createElement');
    expect(() => claudeToolHtmlToMarkdown('', budget)).toThrow('tool sections');
    expect(createElement).not.toHaveBeenCalled();
  });

  it('accepts exactly 4096 code candidates in aggregate, then rejects one more', () => {
    const budget = new ClaudeToolConversionBudget();
    budget.addCodeBlocks(CLAUDE_TOOL_LIMITS.codeBlocks - 1);
    expect(() => budget.addCodeBlocks(1)).not.toThrow();
    expect(() => budget.addCodeBlocks(1)).toThrow(
      'Claude tool conversion limit exceeded: code blocks.'
    );
  });

  it('accepts exact DOM and structural-work ceilings, then rejects one more', () => {
    const nodes = new ClaudeToolConversionBudget();
    nodes.addDomNodes(CLAUDE_TOOL_LIMITS.domNodes);
    expect(() => nodes.addDomNodes(1)).toThrow('Claude tool conversion limit exceeded: DOM nodes.');

    const structure = new ClaudeToolConversionBudget();
    structure.addStructureWorkUnits(CLAUDE_TOOL_LIMITS.structureWorkUnits);
    expect(() => structure.addStructureWorkUnits(1)).toThrow(
      'Claude tool conversion limit exceeded: HTML structure work.'
    );

    const orderedList = new ClaudeToolConversionBudget();
    orderedList.addOrderedListSiblingWork(CLAUDE_TOOL_LIMITS.orderedListSiblingWork);
    expect(() => orderedList.addOrderedListSiblingWork(1)).toThrow(
      'Claude tool conversion limit exceeded: ordered-list sibling work.'
    );

    const metadata = new ClaudeToolConversionBudget();
    metadata.addMetadataEntries(CLAUDE_TOOL_LIMITS.metadataEntries);
    expect(() => metadata.addMetadataEntries(1)).toThrow(
      'Claude tool conversion limit exceeded: tool metadata entries.'
    );
  });

  it('accepts exactly 32 MiB Markdown, counting UTF-8 bytes, then rejects one more', () => {
    const budget = new ClaudeToolConversionBudget();
    budget.addMarkdownBytes(CLAUDE_TOOL_LIMITS.markdownBytes - 2);
    expect(() => budget.addMarkdown('é')).not.toThrow();
    expect(() => budget.addMarkdown('x')).toThrow(
      'Claude tool conversion limit exceeded: Markdown bytes.'
    );
  });

  it.each([-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe accounting increments (%s)',
    count => {
      expect(() => new ClaudeToolConversionBudget().addCodeBlocks(count)).toThrow(
        'Invalid Claude tool conversion accounting.'
      );
      expect(() => new ClaudeToolConversionBudget().addMarkdownBytes(count)).toThrow(
        'Invalid Claude tool conversion accounting.'
      );
      expect(() => new ClaudeToolConversionBudget().addDomNodes(count)).toThrow(
        'Invalid Claude tool conversion accounting.'
      );
      expect(() => new ClaudeToolConversionBudget().addStructureWorkUnits(count)).toThrow(
        'Invalid Claude tool conversion accounting.'
      );
      expect(() => new ClaudeToolConversionBudget().addOrderedListSiblingWork(count)).toThrow(
        'Invalid Claude tool conversion accounting.'
      );
      expect(() => new ClaudeToolConversionBudget().addMetadataEntries(count)).toThrow(
        'Invalid Claude tool conversion accounting.'
      );
    }
  );

  it('rejects a safe integer increment that would overflow the ceiling without adding it', () => {
    const budget = new ClaudeToolConversionBudget();
    budget.addMarkdownBytes(1);
    expect(() => budget.addMarkdownBytes(Number.MAX_SAFE_INTEGER)).toThrow('Markdown bytes');
  });

  it('counts part separators exactly once, including already-counted converter output', () => {
    const budget = new ClaudeToolConversionBudget();
    budget.addMarkdownBytes(CLAUDE_TOOL_LIMITS.markdownBytes - 5);
    const parts: string[] = [];
    appendClaudeToolPart(parts, 'a', budget);
    budget.addMarkdown('é');
    appendClaudeToolPart(parts, 'é', budget, true);
    expect(parts.join('\n\n')).toBe('a\n\né');
    expect(() => budget.addMarkdown('x')).toThrow('Markdown bytes');
  });
});

describe('Claude tool Markdown literal restoration', () => {
  afterEach(() => vi.restoreAllMocks());

  it('restores all 4096 adjacent blocks without truncation or historical-marker interpretation', () => {
    const blocks = Array.from({ length: CLAUDE_TOOL_LIMITS.codeBlocks }, (_, index) => `x${index}`);
    const html = blocks.map(text => `<pre><code>${text}</code></pre>`).join('');
    const budget = new ClaudeToolConversionBudget();
    expect(claudeToolHtmlToMarkdown(html, budget)).toBe(
      blocks.map(text => `\`\`\`\n${text}\n\`\`\``).join('\n\n')
    );
    expect(() => claudeToolHtmlToMarkdown('<pre><code>over</code></pre>', budget)).toThrow(
      'code blocks'
    );
  });

  it('never reinterprets a runtime marker inserted from code during the single restoration pass', () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => {
      (array as Uint8Array).fill(0xa1);
      return array;
    });
    const literal = `\uE000LISKATOOLCODE${'a1'.repeat(16)}:1\uE001`;
    const html = `<pre><code>${literal}\n$&amp; $$ $\x60</code></pre><pre><code>second()</code></pre>`;
    expect(claudeToolHtmlToMarkdown(html, new ClaudeToolConversionBudget())).toBe(
      `\`\`\`\n${literal}\n$& $$ $\x60\n\`\`\`\n\n\`\`\`\nsecond()\n\`\`\``
    );
  });

  it.each(['', 'x', 'x\n', 'x\n\n'])('preserves the current closing separator for %j', code => {
    const separator = code.endsWith('\n') ? '' : '\n';
    expect(
      claudeToolHtmlToMarkdown(`<pre><code>${code}</code></pre>`, new ClaudeToolConversionBudget())
    ).toBe(`\`\`\`\n${code}${separator}\`\`\``);
  });

  it('counts long generated fences before allocation at the exact Markdown ceiling', () => {
    const html = '<pre><code>```</code></pre>';
    const budget = new ClaudeToolConversionBudget();
    budget.addMarkdownBytes(CLAUDE_TOOL_LIMITS.markdownBytes - 13);
    expect(claudeToolHtmlToMarkdown(html, budget)).toBe('````\n```\n````');
    const overBudget = new ClaudeToolConversionBudget();
    overBudget.addMarkdownBytes(CLAUDE_TOOL_LIMITS.markdownBytes - 12);
    expect(() => claudeToolHtmlToMarkdown(html, overBudget)).toThrow('Markdown bytes');
  });

  it('counts non-code Markdown surrounding restored fences, without counting placeholders', () => {
    const budget = new ClaudeToolConversionBudget();
    const expected = 'é\n\n```\nx\n```\n\nz';
    budget.addMarkdownBytes(
      CLAUDE_TOOL_LIMITS.markdownBytes - new TextEncoder().encode(expected).length
    );
    expect(claudeToolHtmlToMarkdown('<p>é</p><pre><code>x</code></pre><p>z</p>', budget)).toBe(
      expected
    );
    expect(() => budget.addMarkdown('x')).toThrow('Markdown bytes');
  });

  it('keeps sanitized non-code formatting, exact indentation, long fences, and safe hints', () => {
    const html =
      '<script>private()</script><p><strong>Before</strong> <code>Array&lt;T&gt;</code></p>' +
      '<pre><code class="language-python">    first()\n```\n\n</code></pre>' +
      `<pre><code class="language-${'x'.repeat(300)}">last()</code></pre><p>After</p>`;
    expect(claudeToolHtmlToMarkdown(html, new ClaudeToolConversionBudget())).toBe(
      '**Before** `Array<T>`\n\n````python\n    first()\n```\n\n````\n\n```\nlast()\n```\n\nAfter'
    );
  });
});
