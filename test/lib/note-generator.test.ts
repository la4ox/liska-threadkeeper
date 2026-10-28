/**
 * Note Generator Tests
 *
 * Tests the generateNoteContent function's templateOptions conditional branches.
 * Coverage regression tests for generateNoteContent templateOptions branches.
 */
import { describe, it, expect } from 'vitest';
import { generateNoteContent } from '../../src/lib/note-generator';
import { conversationToNote } from '../../src/content/markdown';
import type {
  ObsidianNote,
  ExtensionSettings,
  ConversationData,
  LiskaLossDiagnosticCode,
} from '../../src/lib/types';

// Factory: creates a minimal valid ObsidianNote
function createTestNote(overrides?: Partial<ObsidianNote>): ObsidianNote {
  return {
    fileName: 'test.md',
    body: '> [!QUESTION] User\n> Hello\n\n> [!NOTE] Gemini\n> Hi there',
    contentHash: 'abc123',
    frontmatter: {
      id: 'gemini_test123',
      title: 'Test Conversation',
      source: 'gemini',
      url: 'https://gemini.google.com/app/test123',
      created: '2025-01-01T00:00:00.000Z',
      modified: '2025-01-01T00:00:00.000Z',
      tags: ['ai', 'gemini'],
      message_count: 2,
    },
    ...overrides,
  };
}

// Factory: creates ExtensionSettings with all template options enabled (baseline)
function createTestSettings(
  templateOverrides?: Partial<ExtensionSettings['templateOptions']>
): ExtensionSettings {
  return {
    obsidianApiKey: 'test-key',
    obsidianUrl: 'http://127.0.0.1:27123',
    vaultPath: 'AI/Gemini',
    templateOptions: {
      includeId: true,
      includeTitle: true,
      includeSource: true,
      includeDates: true,
      includeTags: true,
      includeMessageCount: true,
      messageFormat: 'callout',
      userCalloutType: 'QUESTION',
      assistantCalloutType: 'NOTE',
      ...templateOverrides,
    },
    outputOptions: {
      obsidian: true,
      file: false,
      clipboard: false,
    },
  };
}

describe('generateNoteContent', () => {
  const note = createTestNote();

  // ========== 3.1.1 Template Option Branches (7 tests) ==========
  describe('templateOptions conditional branches', () => {
    it('omits id from frontmatter when includeId is false', () => {
      // Covers: line 22 false-branch
      const settings = createTestSettings({ includeId: false });
      const content = generateNoteContent(note, settings);

      expect(content).not.toMatch(/^id:/m);
      // Other fields still present
      expect(content).toMatch(/^title:/m);
    });

    it('omits title from frontmatter when includeTitle is false', () => {
      // Covers: line 26 false-branch
      const settings = createTestSettings({ includeTitle: false });
      const content = generateNoteContent(note, settings);

      expect(content).not.toMatch(/^title:/m);
      expect(content).toMatch(/^id:/m);
    });

    it('omits source and url from frontmatter when includeSource is false', () => {
      // Covers: line 30 false-branch
      const settings = createTestSettings({ includeSource: false });
      const content = generateNoteContent(note, settings);

      expect(content).not.toMatch(/^source:/m);
      expect(content).not.toMatch(/^url:/m);
    });

    it('omits created and modified from frontmatter when includeDates is false', () => {
      // Covers: line 35 false-branch
      const settings = createTestSettings({ includeDates: false });
      const content = generateNoteContent(note, settings);

      expect(content).not.toMatch(/^created:/m);
      expect(content).not.toMatch(/^modified:/m);
    });

    it('omits tags from frontmatter when includeTags is false', () => {
      // Covers: line 40 false-branch (includeTags === false)
      const settings = createTestSettings({ includeTags: false });
      const content = generateNoteContent(note, settings);

      expect(content).not.toMatch(/^tags:/m);
      expect(content).not.toContain('  - ai');
    });

    it('omits tags when includeTags is true but tags array is empty', () => {
      // Covers: line 40 compound condition second branch
      //   (includeTags === true && tags.length === 0 → whole condition false)
      const emptyTagNote = createTestNote({
        frontmatter: { ...note.frontmatter, tags: [] },
      });
      const settings = createTestSettings({ includeTags: true });
      const content = generateNoteContent(emptyTagNote, settings);

      expect(content).not.toMatch(/^tags:/m);
    });

    it('omits message_count from frontmatter when includeMessageCount is false', () => {
      // Covers: line 47 false-branch
      const settings = createTestSettings({ includeMessageCount: false });
      const content = generateNoteContent(note, settings);

      expect(content).not.toMatch(/^message_count:/m);
    });
  });

  it('writes YAML-safe ChatGPT capture evidence even when optional template fields are disabled', () => {
    const settings = createTestSettings({
      includeId: false,
      includeTitle: false,
      includeSource: false,
      includeDates: false,
      includeTags: false,
      includeMessageCount: false,
    });
    const chatgptNote = createTestNote({
      frontmatter: {
        ...note.frontmatter,
        source: 'chatgpt',
        capture_mode: 'structured-api',
        capture_completeness: 'complete',
      },
    });

    const content = generateNoteContent(chatgptNote, settings);

    expect(content).toContain('capture_mode: structured-api');
    expect(content).toContain('capture_completeness: complete');
  });

  it('writes branch presentation provenance independently from optional template fields', () => {
    const settings = createTestSettings({
      includeId: false,
      includeTitle: false,
      includeSource: false,
      includeDates: false,
      includeTags: false,
      includeMessageCount: false,
    });
    const branchNote = createTestNote({
      frontmatter: {
        ...note.frontmatter,
        presentation_mode: 'selected-branch',
        branch_ordinal: 4,
        branch_count: 12,
        branch_point_count: 7,
        archive_capture_id: 'capture-chatgpt-safe_123',
        archive_manifest_sha256: 'a'.repeat(64),
      },
    });

    const content = generateNoteContent(branchNote, settings);

    expect(content).toContain('presentation_mode: selected-branch');
    expect(content).toContain('branch_ordinal: 4');
    expect(content).toContain('branch_count: 12');
    expect(content).toContain('branch_point_count: 7');
    expect(content).toContain('archive_capture_id: capture-chatgpt-safe_123');
    expect(content).toContain(`archive_manifest_sha256: ${'a'.repeat(64)}`);
  });

  it('escapes manifest provenance as YAML evidence independently of optional fields', () => {
    const archiveNote = createTestNote({
      frontmatter: { ...note.frontmatter, archive_manifest_sha256: 'hash\ninjected: true' },
    });
    const content = generateNoteContent(archiveNote, createTestSettings({ includeId: false }));

    expect(content).toContain('archive_manifest_sha256: "hash\\ninjected: true"');
    expect(content).not.toMatch(/^injected:/m);
  });

  describe('historical capture-loss diagnostics', () => {
    it('writes only sorted fixed codes independently of every optional template field', () => {
      const settings = createTestSettings({
        includeId: false,
        includeTitle: false,
        includeSource: false,
        includeDates: false,
        includeTags: false,
        includeMessageCount: false,
      });
      const diagnosticNote = createTestNote({
        frontmatter: {
          ...note.frontmatter,
          liska_loss_diagnostics: ['image-capture-failed', 'history-load-partial'],
        },
      });

      const content = generateNoteContent(diagnosticNote, settings);

      expect(content).toBe(
        '---\n' +
          'liska_loss_diagnostics_schema: 1\n' +
          'liska_loss_diagnostics:\n' +
          '  - history-load-partial\n' +
          '  - image-capture-failed\n' +
          '---\n\n' +
          diagnosticNote.body
      );
      expect(diagnosticNote.contentHash).toBe('abc123');
      expect(diagnosticNote.frontmatter.liska_loss_diagnostics).toEqual([
        'image-capture-failed',
        'history-load-partial',
      ]);
    });

    it('deduplicates a repeated diagnostic and omits empty or absent diagnostic fields', () => {
      const duplicateNote = createTestNote({
        frontmatter: {
          ...note.frontmatter,
          liska_loss_diagnostics: ['image-capture-failed', 'image-capture-failed'],
        },
      });
      const content = generateNoteContent(duplicateNote, createTestSettings());
      expect(content.match(/^  - image-capture-failed$/gm)).toHaveLength(1);

      for (const diagnostics of [undefined, []]) {
        const emptyNote = createTestNote({
          frontmatter: { ...note.frontmatter, liska_loss_diagnostics: diagnostics },
        });
        expect(generateNoteContent(emptyNote, createTestSettings())).not.toContain(
          'liska_loss_diagnostics'
        );
      }
    });

    it('rejects arbitrary runtime diagnostic text rather than serializing it', () => {
      const invalidNote = createTestNote({
        frontmatter: {
          ...note.frontmatter,
          liska_loss_diagnostics: [
            'Failed https://private.invalid/image?token=secret\ninjected: true',
          ] as unknown as LiskaLossDiagnosticCode[],
        },
      });

      expect(() => generateNoteContent(invalidNote, createTestSettings())).toThrow(
        'liska-loss-diagnostics-untrusted'
      );
    });

    it('carries normalized codes from conversation data without changing the body or hash', () => {
      const extractedAt = new Date('2025-01-01T00:00:00.000Z');
      const data: ConversationData = {
        id: 'loss-diagnostic-test',
        title: 'Synthetic conversation',
        url: 'https://gemini.google.com/app/loss-diagnostic-test',
        source: 'gemini',
        messages: [
          { id: 'user-0', role: 'user', content: 'Question', index: 0 },
          { id: 'assistant-0', role: 'assistant', content: '<p>Answer</p>', index: 1 },
        ],
        extractedAt,
        metadata: {
          messageCount: 2,
          userMessageCount: 1,
          assistantMessageCount: 1,
          hasCodeBlocks: false,
        },
      };
      const options = createTestSettings().templateOptions;
      const ordinary = conversationToNote(data, options, extractedAt);
      const diagnostic = conversationToNote(
        { ...data, liskaLossDiagnostics: ['image-capture-failed', 'history-load-partial'] },
        options,
        extractedAt
      );

      expect(diagnostic.frontmatter.liska_loss_diagnostics).toEqual([
        'history-load-partial',
        'image-capture-failed',
      ]);
      expect(diagnostic.body).toBe(ordinary.body);
      expect(diagnostic.contentHash).toBe(ordinary.contentHash);
      expect(diagnostic.fileName).toBe(ordinary.fileName);
      expect(ordinary.frontmatter).not.toHaveProperty('liska_loss_diagnostics');

      const repeated = conversationToNote(
        { ...data, liskaLossDiagnostics: ['image-capture-failed', 'image-capture-failed'] },
        options,
        extractedAt
      );
      expect(repeated.frontmatter.liska_loss_diagnostics).toEqual(['image-capture-failed']);
    });
  });

  it.each([
    ['? malformed', 'title: "? malformed"'],
    [',malformed', 'title: ",malformed"'],
    ['control\u0007title', 'title: "control\\u0007title"'],
  ])('serializes an unsafe provider title as one YAML string: %j', (title, expected) => {
    const unsafeTitleNote = createTestNote({
      frontmatter: {
        ...note.frontmatter,
        title,
        tags: ['? topic', ',topic'],
      },
    });

    const content = generateNoteContent(unsafeTitleNote, createTestSettings());

    expect(content).toContain(expected);
    expect(content).toContain('  - "? topic"');
    expect(content).toContain('  - ",topic"');
  });
});
