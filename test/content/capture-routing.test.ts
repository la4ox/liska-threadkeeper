import { describe, expect, it } from 'vitest';
import {
  buildArchivePersistenceMessage,
  buildSaveToOutputsMessage,
} from '../../src/content/capture-routing';
import type { ArchiveCompanionBundle, ObsidianNote } from '../../src/lib/types';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import { serializeSyncSettingsSnapshot } from '../../src/lib/sync-settings-snapshot';

const capturedAt = '2026-09-19T10:00:00.000Z';
const companion: ArchiveCompanionBundle = {
  captureId: 'capture-deepseek-routing-test',
  conversationKey: 'a'.repeat(64),
  capturedAt,
  artifacts: [
    {
      transport: 'inline',
      kind: 'raw',
      relativePath: 'responses/conversation.json',
      mediaType: 'application/json',
      byteLength: 2,
      sha256: 'b'.repeat(64),
      bodyBase64: 'e30=',
    },
    {
      transport: 'inline',
      kind: 'manifest',
      relativePath: 'manifest.json',
      mediaType: 'application/json',
      byteLength: 2,
      sha256: 'c'.repeat(64),
      bodyBase64: 'e30=',
    },
  ],
};

const note = {
  fileName: 'routing.md',
  body: '# routing',
  contentHash: 'routing',
  frontmatter: { source: 'deepseek', title: 'Routing', tags: [] },
} as ObsidianNote;

describe('capture routing messages', () => {
  it('carries capture time through inline and staged archive messages only as metadata', () => {
    const inline = buildArchivePersistenceMessage({
      companion,
      noteFileName: note.fileName,
      source: 'deepseek',
      stageSource: 'deepseek',
      artifact: companion.artifacts[0],
      outputs: ['obsidian'],
    });
    const staged = buildArchivePersistenceMessage({
      companion,
      noteFileName: note.fileName,
      source: 'deepseek',
      stageSource: 'deepseek',
      artifact: {
        transport: 'staged',
        stageId: `archive-stage-${'A'.repeat(32)}`,
        kind: 'canonical',
        relativePath: 'canonical/liska-thread-1.json',
        mediaType: 'application/json',
        byteLength: 2,
        sha256: 'd'.repeat(64),
      },
      outputs: ['obsidian'],
    });

    expect(inline).toMatchObject({ action: 'persistArchiveCompanion', capturedAt });
    expect(staged).toMatchObject({ action: 'commitStagedArchiveCompanion', capturedAt });
    expect(JSON.stringify([inline, staged])).not.toContain('vaultPath');
  });

  it('omits routing metadata for legacy note messages', () => {
    expect(buildSaveToOutputsMessage(note, ['file'])).toEqual({
      action: 'saveToOutputs',
      data: note,
      outputs: ['file'],
    });
    expect(buildSaveToOutputsMessage(note, ['obsidian'], capturedAt)).toMatchObject({ capturedAt });
  });

  it('adds strict Markdown File confirmation only when explicitly requested', () => {
    expect(buildSaveToOutputsMessage(note, ['file'], capturedAt, true)).toEqual({
      action: 'saveToOutputs',
      data: note,
      outputs: ['file'],
      capturedAt,
      strictFileDownload: true,
    });
    expect(buildSaveToOutputsMessage(note, ['file'], undefined, true)).toMatchObject({
      strictFileDownload: true,
    });
    expect(buildSaveToOutputsMessage(note, ['file'])).not.toHaveProperty('strictFileDownload');
  });

  it('binds an exact measured-settings snapshot only when explicitly supplied', () => {
    const snapshot = serializeSyncSettingsSnapshot(DEFAULT_SYNC_SETTINGS);
    expect(buildSaveToOutputsMessage(note, ['obsidian'], capturedAt, undefined, snapshot)).toEqual({
      action: 'saveToOutputs',
      data: note,
      outputs: ['obsidian'],
      capturedAt,
      expectedSyncSettingsSnapshot: snapshot,
    });
    expect(buildSaveToOutputsMessage(note, ['obsidian'])).not.toHaveProperty(
      'expectedSyncSettingsSnapshot'
    );
  });

  it.each(['inline', 'staged'] as const)(
    'keeps the guard outside the %s archive artifact',
    transport => {
      const snapshot = serializeSyncSettingsSnapshot(DEFAULT_SYNC_SETTINGS);
      const artifact =
        transport === 'inline'
          ? companion.artifacts[0]
          : {
              kind: 'raw' as const,
              relativePath: 'responses/conversation.json',
              mediaType: 'application/json' as const,
              byteLength: 2,
              sha256: 'b'.repeat(64),
              transport: 'staged' as const,
              stageId: `archive-stage-${'A'.repeat(32)}`,
            };
      const message = buildArchivePersistenceMessage({
        companion,
        noteFileName: note.fileName,
        source: 'deepseek',
        stageSource: 'deepseek',
        artifact,
        outputs: ['file', 'obsidian'],
        expectedSyncSettingsSnapshot: snapshot,
      });
      expect(message.expectedSyncSettingsSnapshot).toBe(snapshot);
      expect(message.artifact).not.toHaveProperty('expectedSyncSettingsSnapshot');
      expect(companion).not.toHaveProperty('expectedSyncSettingsSnapshot');
    }
  );
});
