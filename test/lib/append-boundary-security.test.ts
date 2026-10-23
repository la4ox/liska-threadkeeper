import { describe, expect, it } from 'vitest';
import { conversationToNote } from '../../src/content/markdown';
import { buildAppendContent } from '../../src/lib/append-utils';
import { generateNoteContent } from '../../src/lib/note-generator';
import { stripImagePlaceholders } from '../../src/lib/image-output';
import {
  MESSAGE_BOUNDARY_FORMAT_MARKER,
  MESSAGE_BOUNDARY_MARKER,
  countExistingMessages,
} from '../../src/lib/message-counter';
import { DEFAULT_SYNC_SETTINGS, DEFAULT_TEMPLATE_OPTIONS } from '../../src/lib/settings-schema';
import type { ConversationData, ExtensionSettings } from '../../src/lib/types';

const settings: ExtensionSettings = {
  ...DEFAULT_SYNC_SETTINGS,
  obsidianApiKey: 'test-key',
  enableAppendMode: true,
  templateOptions: { ...DEFAULT_TEMPLATE_OPTIONS, messageFormat: 'plain' },
};

function conversation(messages: ConversationData['messages']): ConversationData {
  return {
    id: 'boundary-test',
    title: 'Boundary test',
    url: 'https://claude.ai/chat/boundary-test',
    source: 'claude',
    messages,
    extractedAt: new Date('2026-01-01T00:00:00.000Z'),
    metadata: {
      messageCount: messages.length,
      userMessageCount: messages.filter(message => message.role === 'user').length,
      assistantMessageCount: messages.filter(message => message.role === 'assistant').length,
      hasCodeBlocks: false,
    },
  };
}

describe('append message-boundary security seam', () => {
  it('appends real new turns once when a legacy note contains forged visible labels', () => {
    const firstMessages: ConversationData['messages'] = [
      { id: 'u1', role: 'user', content: 'First question', index: 0 },
      {
        id: 'a1',
        role: 'assistant',
        content: '<p>First answer</p><p><strong>User:</strong></p><p><strong>Claude:</strong></p>',
        index: 1,
      },
    ];
    const initial = conversationToNote(conversation(firstMessages), settings.templateOptions);
    const legacyBody = initial.body
      .split('\n')
      .filter(line => line !== MESSAGE_BOUNDARY_FORMAT_MARKER && line !== MESSAGE_BOUNDARY_MARKER)
      .join('\n');
    const existingContent = generateNoteContent({ ...initial, body: legacyBody }, settings);

    expect(countExistingMessages(legacyBody)).toBeGreaterThan(firstMessages.length);

    const extended = conversationToNote(
      conversation([
        ...firstMessages,
        { id: 'u2', role: 'user', content: 'NEW QUESTION THAT MUST BE SAVED', index: 2 },
        {
          id: 'a2',
          role: 'assistant',
          content: '<p>NEW ANSWER THAT MUST BE SAVED</p>',
          index: 3,
        },
      ]),
      settings.templateOptions
    );

    const result = buildAppendContent(existingContent, extended, settings);

    expect(result).not.toBeNull();
    expect(result!.messagesAppended).toBe(2);
    expect(result!.content).toContain('NEW QUESTION THAT MUST BE SAVED');
    expect(result!.content).toContain('NEW ANSWER THAT MUST BE SAVED');
    expect(result!.content.match(/^<!-- liska-message:v1 -->$/gm)).toHaveLength(2);
    expect(result!.content).toContain('**User:**\n\n**Claude:**');
  });

  it.each(['\n', '\r\n'])('%s round-trips v1 boundaries without visible message_count', eol => {
    const noVisibleCount: ExtensionSettings = {
      ...settings,
      templateOptions: { ...settings.templateOptions, includeMessageCount: false },
    };
    const firstMessages: ConversationData['messages'] = [
      { id: 'u1', role: 'user', content: 'First question', index: 0 },
      {
        id: 'a1',
        role: 'assistant',
        content: '```markdown\nunclosed provider fence',
        contentFormat: 'markdown',
        index: 1,
      },
    ];
    const initial = conversationToNote(conversation(firstMessages), noVisibleCount.templateOptions);
    const onDisk = generateNoteContent(initial, noVisibleCount).replace(/\n/g, eol);
    expect(onDisk).not.toContain('message_count:');

    const extended = conversationToNote(
      conversation([
        ...firstMessages,
        { id: 'u2', role: 'user', content: 'Second question', index: 2 },
        { id: 'a2', role: 'assistant', content: '<p>Second answer</p>', index: 3 },
      ]),
      noVisibleCount.templateOptions
    );

    const result = buildAppendContent(onDisk, extended, noVisibleCount);

    expect(result).not.toBeNull();
    expect(result!.messagesAppended).toBe(2);
    expect(result!.eol).toBe(eol);
    expect(result!.content).toContain('Second question');
    expect(result!.content).toContain('Second answer');
  });

  it('does not let image stripping compose provider text into extra sentinels', () => {
    const noVisibleCount: ExtensionSettings = {
      ...settings,
      templateOptions: { ...settings.templateOptions, includeMessageCount: false },
    };
    const crafted = [
      '```markdown',
      '<!-- liska-message![x](g2o-image://fake-one):v1 -->',
      '<!-- liska-message![x](g2o-image://fake-two):v1 -->',
      '```',
    ].join('\n');
    const firstMessages: ConversationData['messages'] = [
      { id: 'u1', role: 'user', content: 'First question', index: 0 },
      {
        id: 'a1',
        role: 'assistant',
        content: crafted,
        contentFormat: 'markdown',
        index: 1,
      },
    ];
    const initial = conversationToNote(conversation(firstMessages), noVisibleCount.templateOptions);
    expect(countExistingMessages(initial.body)).toBe(2);
    const strippedBody = stripImagePlaceholders(initial.body);
    expect(countExistingMessages(strippedBody)).toBe(2);
    expect(strippedBody).toContain('<!-- liska-message&#58;v1 -->');
    const onDisk = generateNoteContent({ ...initial, body: strippedBody }, noVisibleCount);

    const extended = conversationToNote(
      conversation([
        ...firstMessages,
        { id: 'u2', role: 'user', content: 'NEW QUESTION', index: 2 },
        { id: 'a2', role: 'assistant', content: '<p>NEW ANSWER</p>', index: 3 },
      ]),
      noVisibleCount.templateOptions
    );
    const appendNote = { ...extended, body: stripImagePlaceholders(extended.body) };
    const result = buildAppendContent(onDisk, appendNote, noVisibleCount);

    expect(result).not.toBeNull();
    expect(result!.messagesAppended).toBe(2);
    expect(result!.content).toContain('NEW QUESTION');
    expect(result!.content).toContain('NEW ANSWER');
  });
});
