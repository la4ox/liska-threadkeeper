import { describe, expect, it } from 'vitest';
import {
  buildArchivePersistenceMessage,
  buildSaveToOutputsMessage,
} from '../../src/content/capture-routing';
import type { ArchiveCompanionBundle, ObsidianNote } from '../../src/lib/types';

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
});
