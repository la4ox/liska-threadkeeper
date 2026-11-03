import { describe, expect, it, vi } from 'vitest';
import {
  renderArchiveText,
  TextPresentationError,
  type ArchiveBlock,
  type LiskaThreadArchive,
  type TextPresentationInput,
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

describe('canonical-derived liska-text/1 presentation', () => {
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
