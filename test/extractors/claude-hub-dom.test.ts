import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClaudeExtractor } from '../../src/content/extractors/claude';
import {
  clearFixture,
  loadFixture,
  resetLocation,
  setClaudeLocation,
} from '../fixtures/dom-helpers';
import { createClaudeHubPage, renderClaudeHubStatus } from '../fixtures/claude-hub-dom';

const ROOT_ATTRIBUTES = [
  'data-testid="assistant-message"',
  'data-cds="AssistantMessage"',
  'class="font-claude-response"',
  'class="legacy-font-claude-response-wrapper"',
  'data-is-streaming="false"',
];

function legacyTool(label: string, suffix = ''): string {
  return `<div class="grid">
    <div class="row-start-1">
      <button><span class="truncate">${label}</span></button>
      <div class="group/row"><span class="truncate">Legacy query${suffix}</span><p>3 results</p></div>
      <div><div><img alt="favicon" src="https://example.com/favicon.ico"></div><span>Legacy result${suffix}</span><span>example.com</span></div>
      <div class="standard-markdown"><p>Legacy tool detail${suffix}</p></div>
    </div>
    <div class="row-start-2"><div class="row-start-1"><div class="standard-markdown"><p>Visible preamble${suffix}</p></div></div></div>
  </div>`;
}

describe('Claude 2026-10 assistant roots', () => {
  let extractor: ClaudeExtractor;

  beforeEach(() => {
    extractor = new ClaudeExtractor();
    setClaudeLocation('synthetic-hub');
  });

  afterEach(() => {
    clearFixture();
    resetLocation();
  });

  it.each(ROOT_ATTRIBUTES.slice(0, -1))(
    'recognizes %s without treating quoted user content as another turn',
    attributes => {
      loadFixture(`
      <div data-testid="user-message"><p>Real question</p></div>
      <div ${attributes}><div class="standard-markdown">
        <p>Visible answer</p><blockquote><div data-testid="user-message"><p>Quoted user text</p></div></blockquote>
      </div></div>
    `);

      const messages = extractor.extractMessages();

      expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
      expect(messages[0].content).toBe('Real question');
      expect(messages[1].content).toContain('Visible answer');
      expect(messages[1].content).toContain('Quoted user text');
    }
  );

  it('recognizes a standalone weakest streaming fallback without a conflicting user identity', () => {
    loadFixture('<div data-is-streaming="false"><p>Fallback answer</p></div>');

    expect(extractor.extractMessages().map(m => m.content)).toEqual(['<p>Fallback answer</p>']);
  });

  it('does not let a weak streaming wrapper around a user swallow that turn', () => {
    loadFixture(`<div data-is-streaming="false">
      <div data-testid="user-message"><p>Real question</p></div>
    </div><div class="font-claude-response"><p>Separate legacy answer</p></div>`);

    const messages = extractor.extractMessages();

    expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0].content).toBe('Real question');
    expect(messages[1].content).toBe('<p>Separate legacy answer</p>');
  });

  it('does not create an assistant turn from a weak streaming element inside a user', () => {
    loadFixture(`<div data-testid="user-message"><p>Real question</p>
      <div data-is-streaming="false"><p>Quoted streaming marker</p></div>
    </div><div data-cds="AssistantMessage"><p>Real answer</p></div>`);

    const messages = extractor.extractMessages();

    expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0].content).toContain('Quoted streaming marker');
    expect(messages[1].content).toBe('<p>Real answer</p>');
  });

  it('keeps a disjoint legacy user under a weak wrapper when a primary user exists elsewhere', () => {
    loadFixture(`
      <div data-testid="user-message"><p>Primary question</p></div>
      <div data-testid="assistant-message"><p>Primary answer</p></div>
      <div data-is-streaming="false"><p class="whitespace-pre-wrap break-words">Legacy question</p></div>
      <div class="font-claude-response"><p>Legacy answer</p></div>
    `);

    const messages = extractor.extractMessages();

    expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(messages[0].content).toBe('Primary question');
    expect(messages[2].content).toBe('Legacy question');
    expect(messages[3].content).toBe('<p>Legacy answer</p>');
  });

  it('does not let a quoted primary user hide a real legacy user under a weak wrapper', () => {
    loadFixture(`
      <div data-testid="assistant-message"><p>Previous answer</p>
        <blockquote><div data-testid="user-message"><p>Quoted user text</p></div></blockquote>
      </div>
      <div data-is-streaming="false"><p class="whitespace-pre-wrap break-words">Real legacy question</p></div>
      <div data-cds="AssistantMessage"><p>Following answer</p></div>
    `);

    const messages = extractor.extractMessages();

    expect(messages.map(m => m.role)).toEqual(['assistant', 'user', 'assistant']);
    expect(messages[0].content).toContain('Quoted user text');
    expect(messages[1].content).toBe('Real legacy question');
    expect(messages[2].content).toBe('<p>Following answer</p>');
  });

  it('emits one whole user turn for nested primary and legacy selector matches', () => {
    loadFixture(`
      <div data-testid="user-message">
        <p class="whitespace-pre-wrap break-words">First paragraph</p>
        <p class="whitespace-pre-wrap break-words">Second paragraph</p>
      </div>
      <div data-testid="assistant-message"><p>Answer</p></div>
    `);

    const messages = extractor.extractMessages();

    expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0].content).toBe('First paragraph\n\nSecond paragraph');
  });

  it('keeps distinct legacy/new/fallback-only turns together in DOM order', () => {
    loadFixture(`
      <div data-testid="user-message">First question</div>
      <div class="font-claude-response"><p>Old answer</p></div>
      <div data-testid="user-message">Second question</div>
      <div data-testid="assistant-message"><p>New answer</p></div>
      <div data-testid="user-message">Third question</div>
      <div data-cds="AssistantMessage"><p>Component answer</p></div>
      <div data-testid="user-message">Fourth question</div>
      <div data-is-streaming="false"><p>Fallback answer</p></div>
    `);

    const messages = extractor.extractMessages();

    expect(messages.map(m => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(messages.filter(m => m.role === 'assistant').map(m => m.content)).toEqual([
      '<p>Old answer</p>',
      '<p>New answer</p>',
      '<p>Component answer</p>',
      '<p>Fallback answer</p>',
    ]);
  });

  it('deduplicates a multi-identity root and nested matching wrappers', () => {
    loadFixture(`
      <div data-testid="assistant-message" data-cds="AssistantMessage" class="font-claude-response" data-is-streaming="false">
        <div class="standard-markdown"><p>Shared answer</p><div data-is-streaming="false"><p>Nested continuation</p></div></div>
      </div>
    `);

    const messages = extractor.extractMessages();

    expect(messages).toHaveLength(1);
    expect(messages[0].content.split('Shared answer')).toHaveLength(2);
    expect(messages[0].content.split('Nested continuation')).toHaveLength(2);
  });

  it.each(ROOT_ATTRIBUTES.slice(0, -1).map((strong, i) => [strong, ROOT_ATTRIBUTES[i + 1]]))(
    'prefers %s over a containing weaker %s root',
    (strong, weak) => {
      loadFixture(`<div ${weak}>Wrapper-only text<div ${strong}><p>Chosen answer</p></div></div>`);

      const messages = extractor.extractMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('<p>Chosen answer</p>');
    }
  );

  it('does not let a discarded weak wrapper suppress a real user outside the strong root', () => {
    loadFixture(`<div data-is-streaming="false">
      <div data-testid="user-message"><p>Real question</p></div>
      <div data-testid="assistant-message"><p>Real answer</p></div>
    </div>`);

    expect(extractor.extractMessages().map(m => m.role)).toEqual(['user', 'assistant']);
  });

  it('does not deduplicate separate turns by equal text', () => {
    loadFixture(`<div class="font-claude-response"><p>Repeated answer</p></div>
      <div data-testid="assistant-message"><p>Repeated answer</p></div>`);

    expect(extractor.extractMessages()).toHaveLength(2);
  });

  it.each(['inert', 'aria-hidden="true"', 'hidden'])(
    'ignores a dismissed new root in an outer %s panel without losing a visible old root',
    attribute => {
      loadFixture(`<section ${attribute}><div data-index="0"><div data-testid="assistant-message"><p>Dismissed answer</p></div></div></section>
        <div class="font-claude-response"><p>Visible answer</p></div>`);

      const messages = extractor.extractMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('<p>Visible answer</p>');
    }
  );
});

describe('Claude 2026-10 answer cleanup and tool activity', () => {
  let extractor: ClaudeExtractor;

  beforeEach(() => {
    extractor = new ClaudeExtractor();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearFixture();
    resetLocation();
  });

  it('extracts all transcript turns in order without collapsed thinking summaries', async () => {
    createClaudeHubPage('hub-order', [
      { role: 'user', text: 'First question' },
      {
        role: 'assistant',
        parts: [
          { kind: 'thinking', label: 'Planned the answer' },
          { kind: 'text', html: '<p>First answer</p>' },
        ],
      },
      { role: 'user', text: 'Second question' },
      { role: 'assistant', parts: [{ kind: 'text', html: '<p>Second answer</p>' }] },
    ]);

    const result = await extractor.extract();

    expect(result.success).toBe(true);
    expect(result.data?.messages.map(m => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(result.data?.messages[1].content).toContain('First answer');
    expect(result.data?.messages[1].content).not.toContain('Planned the answer');
    expect(result.data?.messages[3].content).toContain('Second answer');
  });

  it.each([true, false])(
    'removes headings/actions with markdown=%s while retaining the answer',
    markdown => {
      createClaudeHubPage('hub-chrome', [
        {
          role: 'assistant',
          heading: 'Copied opening',
          parts: [{ kind: 'text', html: '<p>Visible answer</p>', markdown }],
        },
      ]);

      const originalDom = document.body.innerHTML;
      const answer = extractor.extractMessages()[0];

      expect(answer.content).toContain('Visible answer');
      expect(answer.content).not.toContain('Claude responded');
      expect(answer.content).not.toContain('Copy answer');
      expect(answer.content).not.toContain('Oct 7');
      expect(document.body.innerHTML).toBe(originalDom);
    }
  );

  it('cleans expanded thinking before the plain HTML fallback is chosen', () => {
    createClaudeHubPage('hub-plain', [
      {
        role: 'assistant',
        parts: [
          {
            kind: 'thinking',
            label: 'Thinking label',
            expanded: '<div class="standard-markdown"><p>Reasoning-only text</p></div>',
          },
          { kind: 'text', html: '<p>Visible plain answer</p>', markdown: false },
        ],
      },
    ]);

    const answer = extractor.extractMessages()[0];

    expect(answer.content).toContain('Visible plain answer');
    expect(answer.content).not.toContain('Reasoning-only text');
    expect(answer.content).not.toContain('Thinking label');
  });

  it('cleans a status row nested inside the answer markdown wrapper', () => {
    createClaudeHubPage('hub-wrapper', [
      {
        role: 'assistant',
        parts: [
          {
            kind: 'text',
            html:
              renderClaudeHubStatus(
                'th0',
                'Hidden summary',
                '<div class="standard-markdown"><p>Hidden reasoning</p></div>'
              ) + '<p>Visible body</p>',
          },
        ],
      },
    ]);

    const answer = extractor.extractMessages()[0];

    expect(answer.content).toContain('Visible body');
    expect(answer.content).not.toContain('Hidden summary');
    expect(answer.content).not.toContain('Hidden reasoning');
  });

  it.each([undefined, '<div class="standard-markdown"><p>Reasoning-only text</p></div>'])(
    'does not turn a thinking-only response into an answer (expanded=%s)',
    expanded => {
      createClaudeHubPage('hub-only-thinking', [
        { role: 'assistant', parts: [{ kind: 'thinking', label: 'Thinking only', expanded }] },
      ]);

      expect(extractor.extractMessages()).toEqual([]);
    }
  );

  it('preserves an image-only fallback answer', () => {
    createClaudeHubPage('hub-image', [
      {
        role: 'assistant',
        parts: [
          {
            kind: 'text',
            html: '<img src="https://example.com/diagram.png" alt="Diagram">',
            markdown: false,
          },
        ],
      },
    ]);

    expect(extractor.extractMessages()[0].content).toContain('diagram.png');
  });

  it.each([
    '<div class="row-start-1"><p>Visible layout answer</p></div>',
    '<div class="standard-markdown"><div class="row-start-1"><p>Visible layout answer</p></div></div>',
    '<div class="row-start-1"><img src="https://example.com/layout.png" alt="Visible layout answer"></div>',
  ])('preserves unpaired row-start-1 answer layout without inventing legacy tools: %s', html => {
    extractor.enableToolContent = true;
    createClaudeHubPage('hub-unpaired-layout', [
      { role: 'assistant', parts: [{ kind: 'raw', html }] },
    ]);
    const originalDom = document.body.innerHTML;

    const messages = extractor.extractMessages();

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain('Visible layout answer');
    expect(messages[0].toolContent).toBeUndefined();
    expect(document.body.innerHTML).toBe(originalDom);
  });

  it('does not pair a plain layout row with an unrelated body in another container', () => {
    extractor.enableToolContent = true;
    createClaudeHubPage('hub-unrelated-layout', [
      {
        role: 'assistant',
        parts: [
          {
            kind: 'raw',
            html: '<section><div class="row-start-1"><p>Visible unpaired answer</p></div></section><section><div class="row-start-2"></div></section>',
          },
        ],
      },
    ]);

    const messages = extractor.extractMessages();

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain('Visible unpaired answer');
    expect(messages[0].toolContent).toBeUndefined();
  });

  it.each([false, true])(
    'keeps status details out of answers with tools enabled=%s',
    enableTools => {
      extractor.enableToolContent = enableTools;
      createClaudeHubPage('hub-expanded', [
        {
          role: 'assistant',
          parts: [
            {
              kind: 'thinking',
              label: 'Loaded skill',
              expanded: '<div class="standard-markdown"><p>Reasoning-only text</p></div>',
            },
            {
              kind: 'tool',
              label: 'Searched the web',
              expanded:
                '<div data-cds-row><bdi>Expanded query label</bdi></div><div class="row-start-1"><button><span class="truncate">Legacy-shaped detail</span></button><div class="standard-markdown"><p>Expanded tool detail</p></div></div><div class="row-start-2"></div>',
            },
            { kind: 'text', html: '<p>Visible final answer</p>' },
          ],
        },
      ]);

      const answer = extractor.extractMessages()[0];

      expect(answer.content).toBe('<p>Visible final answer</p>');
      expect(answer.toolContent).toBe(enableTools ? '**Searched the web**' : undefined);
    }
  );

  it('positively classifies tool keys, not thinking labels or unknown status kinds', () => {
    extractor.enableToolContent = true;
    createClaudeHubPage('hub-tool-keys', [
      {
        role: 'assistant',
        parts: [
          { kind: 'thinking', label: 'Loaded skill' },
          { kind: 'raw', html: renderClaudeHubStatus('unknown0', 'Searched the web') },
          { kind: 'tool', label: 'Loaded skill' },
          { kind: 'text', html: '<p>Visible answer</p>' },
        ],
      },
    ]);

    expect(extractor.extractMessages()[0].toolContent).toBe('**Loaded skill**');
  });

  it.each([false, true])(
    'preserves richer legacy tools alongside October rows (enabled=%s)',
    enableTools => {
      extractor.enableToolContent = enableTools;
      createClaudeHubPage('hub-mixed-tools', [
        {
          role: 'assistant',
          parts: [
            { kind: 'raw', html: legacyTool('Legacy first', ' one') },
            { kind: 'tool', label: 'October tool' },
            { kind: 'raw', html: legacyTool('Legacy last', ' two') },
            { kind: 'text', html: '<p>Final answer</p>' },
          ],
        },
      ]);

      const answer = extractor.extractMessages()[0];

      expect(answer.content).toContain('Visible preamble one');
      expect(answer.content).toContain('Visible preamble two');
      expect(answer.content).toContain('Final answer');
      expect(answer.content).not.toContain('Legacy query');
      expect(answer.content).not.toContain('Legacy result');
      expect(answer.content).not.toContain('Legacy tool detail');
      expect(answer.content).not.toContain('October tool');
      if (!enableTools) {
        expect(answer.toolContent).toBeUndefined();
        return;
      }
      expect(answer.toolContent).toContain('Legacy query one (3 results)');
      expect(answer.toolContent).toContain('- Legacy result one (example.com)');
      expect(answer.toolContent).toContain('<p>Legacy tool detail one</p>');
      expect(answer.toolContent).toContain('Legacy query two (3 results)');
      expect(answer.toolContent!.indexOf('**Legacy first**')).toBeLessThan(
        answer.toolContent!.indexOf('**October tool**')
      );
      expect(answer.toolContent!.indexOf('**October tool**')).toBeLessThan(
        answer.toolContent!.indexOf('**Legacy last**')
      );
    }
  );

  it('preserves repeated equal labels as separate October and legacy operations', () => {
    extractor.enableToolContent = true;
    createClaudeHubPage('hub-repeated-tools', [
      {
        role: 'assistant',
        parts: [
          { kind: 'tool', label: 'Repeated operation' },
          { kind: 'raw', html: legacyTool('Repeated operation') },
          { kind: 'tool', label: 'Repeated operation' },
          { kind: 'text', html: '<p>Final answer</p>' },
        ],
      },
    ]);

    expect(
      extractor.extractMessages()[0].toolContent?.split('**Repeated operation**')
    ).toHaveLength(4);
  });

  it('does not export one October row again through a containing legacy header', () => {
    extractor.enableToolContent = true;
    createClaudeHubPage('hub-overlap-tools', [
      {
        role: 'assistant',
        parts: [
          {
            kind: 'raw',
            html: `<div class="row-start-1">${renderClaudeHubStatus('cblk_0', 'October operation', '<div class="standard-markdown"><p>Expanded-only detail</p></div>')}</div><div class="row-start-2"></div>`,
          },
          { kind: 'text', html: '<p>Visible answer</p>' },
        ],
      },
    ]);

    const answer = extractor.extractMessages()[0];

    expect(answer.toolContent).toBe('**October operation**');
    expect(answer.content).toBe('<p>Visible answer</p>');
  });

  it('deduplicates nested legacy header wrappers by containment, not text', () => {
    extractor.enableToolContent = true;
    createClaudeHubPage('hub-nested-legacy', [
      {
        role: 'assistant',
        parts: [
          {
            kind: 'raw',
            html: `<div class="row-start-1"><div class="row-start-1"><button><span class="truncate">Legacy operation</span></button><div class="standard-markdown"><p>Legacy detail once</p></div></div></div><div class="row-start-2"></div>`,
          },
          { kind: 'text', html: '<p>Visible answer</p>' },
        ],
      },
    ]);

    const answer = extractor.extractMessages()[0];

    expect(answer.toolContent?.split('**Legacy operation**')).toHaveLength(2);
    expect(answer.toolContent?.split('Legacy detail once')).toHaveLength(2);
  });

  it('reads tool labels only from their own direct row', () => {
    extractor.enableToolContent = true;
    createClaudeHubPage('hub-own-label', [
      {
        role: 'assistant',
        parts: [
          {
            kind: 'raw',
            html: '<div data-cds="TurnStatus" data-item-key="reply:grp:cblk_0"><div data-cds-row-panel><div data-cds-row><bdi>Not the own label</bdi></div></div></div>',
          },
          { kind: 'text', html: '<p>Visible answer</p>' },
        ],
      },
    ]);

    expect(extractor.extractMessages()[0].toolContent).toBeUndefined();
  });

  it('does not mutate the original DOM or click status expanders', async () => {
    extractor.enableToolContent = true;
    createClaudeHubPage('hub-no-mutation', [
      { role: 'user', text: 'Question' },
      {
        role: 'assistant',
        parts: [
          {
            kind: 'thinking',
            label: 'Thinking label',
            expanded: '<div class="standard-markdown"><p>Reasoning-only text</p></div>',
          },
          { kind: 'tool', label: 'Searched the web' },
          { kind: 'raw', html: legacyTool('Legacy operation') },
          { kind: 'text', html: '<p>Visible answer</p>' },
        ],
      },
    ]);
    const originalDom = document.body.innerHTML;
    const click = vi.spyOn(HTMLElement.prototype, 'click');

    const result = await extractor.extract();

    expect(result.success).toBe(true);
    expect(document.body.innerHTML).toBe(originalDom);
    expect(click).not.toHaveBeenCalled();
  });
});
