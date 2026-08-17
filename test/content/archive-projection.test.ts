import { describe, expect, it } from 'vitest';
import { ArchiveProjectionError, projectArchiveBranch } from '../../src/content/archive-projection';
import type { LiskaThreadArchive } from '../../src/archive';
import branchingFixture from '../fixtures/archive/branching-chatgpt-thread.json';

function cloneArchive(): LiskaThreadArchive {
  return JSON.parse(JSON.stringify(branchingFixture)) as LiskaThreadArchive;
}

describe('canonical archive to legacy ConversationData projection', () => {
  it('projects only the current branch and reports unsupported legacy losses', () => {
    const result = projectArchiveBranch(cloneArchive());

    expect(result.selectedNodeIds).toEqual(['node-root', 'node-user', 'node-current']);
    expect(result.data).toMatchObject({
      id: 'synthetic-branching-thread',
      title: 'Synthetic branch fixture',
      url: 'https://chatgpt.com/c/synthetic-branching-thread',
      source: 'chatgpt',
      metadata: {
        messageCount: 2,
        userMessageCount: 1,
        assistantMessageCount: 1,
        hasCodeBlocks: false,
      },
    });
    expect(result.data.extractedAt.toISOString()).toBe('2026-08-17T10:00:00.000Z');
    expect(result.data.messages.map(message => message.id)).toEqual([
      'message-user',
      'message-current',
    ]);
    expect(result.data.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Current answer starts here.',
      contentFormat: 'markdown',
      index: 1,
    });
    expect(result.data.messages[1].toolContent).toBeUndefined();
    expect(result.warnings).toEqual([
      'Legacy Markdown omitted 1 attachment block(s); the canonical archive retains them.',
      'Legacy Markdown omitted 1 unknown provider block(s); the canonical archive retains them.',
      'Legacy Markdown omitted 3 reasoning/tool/error block(s) because tool content is disabled; the canonical archive retains them.',
    ]);
  });

  it('projects an explicitly selected alternate leaf without mixing sibling content', () => {
    const result = projectArchiveBranch(cloneArchive(), { targetNodeId: 'node-alternate' });

    expect(result.selectedNodeIds).toEqual(['node-root', 'node-user', 'node-alternate']);
    expect(result.data.messages.map(message => message.id)).toEqual([
      'message-user',
      'message-alternate',
    ]);
    expect(result.data.messages[1].content).toBe('Alternate **answer** remains a separate leaf.');
    expect(result.warnings).toEqual([]);
  });

  it('keeps reasoning and tool blocks ordered behind the explicit tool-content option', () => {
    const result = projectArchiveBranch(cloneArchive(), { includeToolContent: true });
    const toolContent = result.data.messages[1].toolContent ?? '';

    expect(toolContent).toContain('**Reasoning**\nSynthetic hidden reasoning retained as data.');
    expect(toolContent).toContain('**Tool call: synthetic_search**');
    expect(toolContent).toContain('**Tool result: synthetic_search**');
    expect(toolContent.indexOf('**Reasoning**')).toBeLessThan(
      toolContent.indexOf('**Tool call: synthetic_search**')
    );
    expect(toolContent.indexOf('**Tool call: synthetic_search**')).toBeLessThan(
      toolContent.indexOf('**Tool result: synthetic_search**')
    );
  });

  it('renders code with a collision-safe fence and sanitizes HTML at the presentation edge', () => {
    const archive = cloneArchive();
    const message = archive.graph.nodes['node-current'].message!;
    message.blocks = [
      {
        id: 'code-with-fence',
        type: 'code',
        code: 'before\n```\nafter',
        language: 'ts\n```\n# outside',
        sourceRefs: message.sourceRefs,
        extensions: {},
      },
      {
        id: 'html-block',
        type: 'html',
        html: '<p>Hello <strong>world</strong></p><img src="https://tracker.invalid/pixel" alt="diagram&#10;# injected &lt;b&gt;"><script>alert(1)</script>',
        sourceRefs: message.sourceRefs,
        extensions: {},
      },
    ];

    const result = projectArchiveBranch(archive);
    const content = result.data.messages[1].content;
    expect(content).toContain('````\nbefore\n```\nafter\n````');
    expect(content).not.toContain('# outside');
    expect(content).toContain('Hello **world**');
    expect(content).toContain('(Image: diagram # injected b)');
    expect(content).not.toContain('\n# injected');
    expect(content).not.toContain('tracker.invalid');
    expect(content).not.toContain('<script>');
    expect(content).not.toContain('alert(1)');
    expect(result.data.metadata.hasCodeBlocks).toBe(true);
    expect(result.warnings).toContain(
      'Legacy Markdown omitted 1 remote/embedded HTML image(s); the canonical archive retains them.'
    );
  });

  it('uses deterministic fallbacks for missing source URL and timestamps', () => {
    const archive = cloneArchive();
    archive.conversation.url = null;
    archive.inputs.forEach(input => {
      input.capturedAt = null;
    });
    archive.conversation.createdAt = null;
    archive.conversation.updatedAt = null;

    const result = projectArchiveBranch(archive, { targetNodeId: 'node-alternate' });
    expect(result.data.url).toBe('https://chatgpt.com');
    expect(result.data.extractedAt.toISOString()).toBe('1970-01-01T00:00:00.000Z');
    expect(result.warnings).toContain(
      'Archive has no source URL; legacy output uses the platform origin.'
    );
    expect(result.warnings).toContain(
      'Archive has no capture or conversation timestamp; legacy created time uses epoch.'
    );
  });

  it('fails with stable projection errors for invalid, unsupported, or empty branches', () => {
    const invalid = cloneArchive() as LiskaThreadArchive & { extra?: boolean };
    invalid.extra = true;
    expect(() => projectArchiveBranch(invalid)).toThrow(ArchiveProjectionError);
    try {
      projectArchiveBranch(invalid);
    } catch (error) {
      expect(error).toMatchObject({ code: 'archive-invalid' });
    }

    const unsupported = cloneArchive();
    unsupported.conversation.provider = 'future-provider';
    expect(() => projectArchiveBranch(unsupported)).toThrow(
      expect.objectContaining({ code: 'provider-unsupported' })
    );

    const noTarget = cloneArchive();
    noTarget.conversation.currentNodeId = null;
    expect(() => projectArchiveBranch(noTarget)).toThrow(
      expect.objectContaining({ code: 'target-node-missing' })
    );

    const empty = cloneArchive();
    empty.graph.nodes['node-user'].message!.author.role = 'system';
    empty.graph.nodes['node-current'].message!.author.role = 'tool';
    expect(() => projectArchiveBranch(empty)).toThrow(
      expect.objectContaining({ code: 'no-renderable-messages' })
    );
  });
});
