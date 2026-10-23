import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import type { LiskaThreadArchive } from '../../src/archive';
import { getArchiveBranchCatalog } from '../../src/archive';
import branchingFixture from '../fixtures/archive/branching-chatgpt-thread.json';

vi.mock('../../src/content/ui', () => ({
  injectBranchExportButton: vi.fn(),
  injectSyncButton: vi.fn(),
  setButtonLoading: vi.fn(),
  showArchiveBranchPicker: vi.fn(),
  showErrorToast: vi.fn(),
  showWarningToast: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../src/lib/messaging', () => ({ sendMessage: vi.fn() }));

import {
  displayAllBranchesSummary,
  fingerprintAllBranchesNote,
  measureAllBranchesNoteBytes,
  persistAllBranchesBundle,
} from '../../src/content/bootstrap';
import { showErrorToast, showToast, showWarningToast } from '../../src/content/ui';
import { sendMessage } from '../../src/lib/messaging';
import { flattenLargeCallouts } from '../../src/lib/callout-flatten';
import { stripImagePlaceholders } from '../../src/lib/image-output';
import { generateNoteContent } from '../../src/lib/note-generator';
import type { AllBranchesPersistenceSummary } from '../../src/content/archive-branch-persistence';
import type {
  ArchiveCompanionBundle,
  ContentScriptSettings,
  ExtensionSettings,
  ObsidianNote,
} from '../../src/lib/types';

function summary(
  overrides: Partial<AllBranchesPersistenceSummary> = {}
): AllBranchesPersistenceSummary {
  return {
    version: 1,
    status: 'complete',
    phase: 'complete',
    cancelRequested: false,
    metrics: {
      nodeCount: 3,
      leafCount: 2,
      branchPointCount: 1,
      pathVisits: 6,
      sourceWorkBytes: 100,
    },
    plannedArtifactWrites: 6,
    plannedPhysicalBytes: 1000,
    measuredLeaves: 2,
    renderedLeaves: 2,
    branchCount: 2,
    omissionBranchCount: 0,
    canonicalOnlyCount: 0,
    clipboardSkipped: false,
    destinations: [
      {
        destination: 'file',
        archiveSaved: true,
        archiveState: 'confirmed',
        branchFilesSaved: 2,
        branchWrites: { confirmed: 2, failed: 0, unknown: 0 },
        indexSaved: true,
        indexState: 'confirmed',
        dispatchedBytes: 500,
        confirmedBytes: 500,
        confirmedArtifactBytes: 100,
        unknownArtifactBytes: 0,
        cleanupDeferredArtifactWrites: 0,
      },
    ],
    allSuccessful: true,
    accountingMode: 'receipts',
    ...overrides,
  };
}

describe('all-branches user summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('crypto', webcrypto);
  });
  afterAll(() => vi.unstubAllGlobals());

  it('measures and fingerprints exact multibyte File and Obsidian serialization', async () => {
    const note = {
      fileName: 'branch.md',
      frontmatter: {
        id: 'id',
        title: 'Заголовок',
        source: 'chatgpt',
        url: 'https://chatgpt.com',
        created: '2026-01-01',
        modified: '2026-01-01',
        tags: [],
        message_count: 1,
      },
      body: '> [!NOTE] Привет\n> мир\n\n![кот](g2o-image://asset)',
      contentHash: 'a'.repeat(64),
    } as ObsidianNote;
    const exactSettings = {
      flattenLargeCallouts: true,
      maxCalloutLines: 1,
      templateOptions: {
        includeId: true,
        includeTitle: true,
        includeTags: true,
        includeSource: true,
        includeDates: true,
        includeMessageCount: true,
      },
    } as ContentScriptSettings;
    const fileBytes = measureAllBranchesNoteBytes(note, 'file', exactSettings);
    const obsidianBytes = measureAllBranchesNoteBytes(note, 'obsidian', exactSettings);
    const generationSettings = { ...exactSettings, obsidianApiKey: '' } as ExtensionSettings;
    expect(fileBytes).toBe(
      new TextEncoder().encode(
        generateNoteContent(
          { ...note, body: stripImagePlaceholders(note.body) },
          generationSettings
        )
      ).byteLength
    );
    expect(obsidianBytes).toBe(
      new TextEncoder().encode(
        generateNoteContent(
          {
            ...note,
            body: flattenLargeCallouts(stripImagePlaceholders(note.body), 1),
          },
          generationSettings
        )
      ).byteLength
    );
    expect(fileBytes).not.toBe(obsidianBytes);
    expect(fileBytes).toBeGreaterThan(note.body.length);
    expect(obsidianBytes).toBeGreaterThan(note.body.length);
    for (const destination of ['file', 'obsidian'] as const) {
      const body =
        destination === 'file'
          ? stripImagePlaceholders(note.body)
          : flattenLargeCallouts(stripImagePlaceholders(note.body), 1);
      const expected = generateNoteContent({ ...note, body }, generationSettings);
      expect(await fingerprintAllBranchesNote(note, destination, exactSettings)).toEqual({
        byteLength: new TextEncoder().encode(expected).byteLength,
        sha256: createHash('sha256').update(expected).digest('hex'),
      });
    }
    const sameLength = { ...note, body: note.body.replace('мир', 'мур') };
    const original = await fingerprintAllBranchesNote(note, 'file', exactSettings);
    const changed = await fingerprintAllBranchesNote(sameLength, 'file', exactSettings);
    expect(changed.byteLength).toBe(original.byteLength);
    expect(changed.sha256).not.toBe(original.sha256);
  });

  it('fails closed when a prepared branch note unexpectedly carries binary images', () => {
    const note = {
      fileName: 'branch.md',
      frontmatter: {
        id: 'id',
        title: 'Branch',
        source: 'chatgpt',
        url: 'https://chatgpt.com',
        created: '2026-01-01',
        modified: '2026-01-01',
        tags: [],
        message_count: 1,
      },
      body: 'g2o-image://asset',
      contentHash: 'a'.repeat(64),
      images: [{ id: 'asset' }],
    } as unknown as ObsidianNote;
    expect(() =>
      measureAllBranchesNoteBytes(note, 'obsidian', {} as ContentScriptSettings)
    ).toThrow('dedicated exact serializer');
  });

  it('requires a durable destination', () => {
    displayAllBranchesSummary(
      summary({ destinations: [], allSuccessful: false, clipboardSkipped: true })
    );

    expect(showErrorToast).toHaveBeenCalledWith(
      'Exporting all branches requires File or Obsidian output'
    );
    expect(showToast).not.toHaveBeenCalled();
  });

  it('shows one compact success for a complete bundle', () => {
    displayAllBranchesSummary(summary());

    expect(showToast).toHaveBeenCalledWith('Saved 2 branches and an index to file', 'success');
    expect(showWarningToast).not.toHaveBeenCalled();
  });

  it('keeps attachment archive caveats visible even when remaining destinations completed', () => {
    displayAllBranchesSummary(summary(), [
      'One or more ChatGPT attachments were not saved to obsidian; the archive manifest records them as failed.',
    ]);

    expect(showToast).not.toHaveBeenCalledWith('Saved 2 branches and an index to file', 'success');
    expect(showWarningToast).toHaveBeenCalledWith(
      expect.stringContaining('One or more ChatGPT attachments were not saved to obsidian')
    );
    expect(showWarningToast).toHaveBeenCalledWith(
      expect.stringContaining('Saved 2 branches and an index to file')
    );
  });

  it('summarizes legacy omissions, canonical-only stubs, and skipped Clipboard', () => {
    displayAllBranchesSummary(
      summary({ omissionBranchCount: 2, canonicalOnlyCount: 1, clipboardSkipped: true })
    );

    expect(showWarningToast).toHaveBeenCalledWith(
      expect.stringContaining(
        '2 branch Markdown file(s) omit records retained in the canonical archive'
      )
    );
    expect(showWarningToast).toHaveBeenCalledWith(
      expect.stringContaining('1 canonical-only stub(s) were created')
    );
    expect(showWarningToast).toHaveBeenCalledWith(
      expect.stringContaining('Clipboard was skipped for the multi-file bundle')
    );
  });

  it('reports destination-level partial counts without exposing background errors', () => {
    displayAllBranchesSummary(
      summary({
        allSuccessful: false,
        destinations: [
          {
            destination: 'file',
            archiveSaved: true,
            archiveState: 'confirmed',
            branchFilesSaved: 1,
            branchWrites: { confirmed: 1, failed: 1, unknown: 0 },
            indexSaved: false,
            indexState: 'not-attempted',
            dispatchedBytes: 100,
            confirmedBytes: 50,
            confirmedArtifactBytes: 50,
            unknownArtifactBytes: 0,
            cleanupDeferredArtifactWrites: 0,
          },
          {
            destination: 'obsidian',
            archiveSaved: false,
            archiveState: 'failed',
            branchFilesSaved: 0,
            branchWrites: { confirmed: 0, failed: 0, unknown: 0 },
            indexSaved: false,
            indexState: 'not-attempted',
            dispatchedBytes: 75,
            confirmedBytes: 25,
            confirmedArtifactBytes: 25,
            unknownArtifactBytes: 50,
            cleanupDeferredArtifactWrites: 0,
          },
        ],
      })
    );

    expect(showWarningToast).toHaveBeenCalledWith(
      expect.stringContaining(
        'All-branches export was partial: 1/4 branch writes, 0/2 indexes, and 1/2 complete archive bundles succeeded'
      )
    );
    expect(showWarningToast).toHaveBeenCalledWith(
      expect.stringContaining(
        '25 artifact byte(s) were confirmed before incomplete archive finalization'
      )
    );
    expect(showWarningToast).toHaveBeenCalledWith(
      expect.stringContaining(
        '50 artifact byte(s) were conservatively charged because their write outcome is unknown'
      )
    );
  });

  it('distinguishes rejected, cancelled and failed terminal receipts without false completion', () => {
    displayAllBranchesSummary(
      summary({
        status: 'rejected',
        phase: 'structural-preflight',
        budgetKind: 'leaves',
        allSuccessful: false,
      })
    );
    expect(showWarningToast).toHaveBeenLastCalledWith(
      expect.stringContaining('before any output was written')
    );

    displayAllBranchesSummary(
      summary({
        status: 'cancelled',
        phase: 'writing',
        cancelRequested: true,
        allSuccessful: false,
      })
    );
    expect(showWarningToast).toHaveBeenLastCalledWith(
      expect.stringContaining('Any output already saved was retained')
    );
    expect(showWarningToast).not.toHaveBeenLastCalledWith(
      expect.stringContaining('Saved 2 branches')
    );

    displayAllBranchesSummary(
      summary({ status: 'failed', phase: 'measurement', allSuccessful: false })
    );
    expect(showWarningToast).toHaveBeenLastCalledWith(
      expect.stringContaining('failed during measurement')
    );
  });

  it('wires one archive bundle, sequential leaves, progress, and an index through messaging', async () => {
    const archive = JSON.parse(JSON.stringify(branchingFixture)) as LiskaThreadArchive;
    const companion: ArchiveCompanionBundle = {
      captureId: 'capture-chatgpt-11111111-2222-4333-8444-555555555555',
      conversationKey: 'a'.repeat(64),
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
        {
          transport: 'inline',
          kind: 'canonical',
          relativePath: 'canonical/liska-thread-1.json',
          mediaType: 'application/json',
          byteLength: 2,
          sha256: 'd'.repeat(64),
          bodyBase64: 'e30=',
        },
      ],
    };
    const settings = {
      enableToolContent: false,
      templateOptions: {
        includeId: true,
        includeTitle: true,
        includeTags: true,
        includeSource: true,
        includeDates: true,
        includeMessageCount: true,
        messageFormat: 'callout',
        userCalloutType: 'QUESTION',
        assistantCalloutType: 'NOTE',
      },
    } as ContentScriptSettings;
    vi.mocked(sendMessage).mockImplementation(async message => {
      const outputs = 'outputs' in message ? message.outputs : [];
      return {
        results: outputs.map(destination => ({
          destination,
          success: true,
          ...(destination === 'file' &&
            message.action === 'saveToOutputs' && {
              strictFileOutcome: 'confirmed-success',
              savedAs: message.data.fileName,
            }),
        })),
        allSuccessful: true,
        anySuccessful: true,
      };
    });

    await persistAllBranchesBundle(
      { archive, catalog: getArchiveBranchCatalog(archive) },
      companion,
      settings,
      ['file']
    );

    const messages = vi.mocked(sendMessage).mock.calls.map(call => call[0]);
    expect(messages.filter(message => message.action === 'persistArchiveCompanion')).toHaveLength(
      3
    );
    expect(messages.filter(message => message.action === 'saveToOutputs')).toHaveLength(3);
    expect(
      messages
        .filter(message => message.action === 'saveToOutputs')
        .every(
          message =>
            message.strictFileDownload === true &&
            typeof message.expectedSyncSettingsSnapshot === 'string'
        )
    ).toBe(true);
    expect(showToast).toHaveBeenCalledWith('Saving all branches... 2/2', 'info', 0);
    expect(showWarningToast).toHaveBeenCalledWith(
      expect.stringContaining('Saved 2 branches and an index to file')
    );
  });

  it.each([
    ['malformed strict enum', { success: true, strictFileOutcome: 'unexpected', savedAs: 'x.md' }],
    ['missing exact savedAs', { success: true, strictFileOutcome: 'confirmed-success' }],
    ['blocked confirmation', { success: false, strictFileOutcome: 'blocked' }],
    [
      'settings drift',
      {
        success: false,
        error: 'settings-changed',
        strictFileOutcome: 'confirmed-failure',
      },
    ],
  ])('treats %s as unknown and starts no later File write', async (_label, strictResult) => {
    const archive = JSON.parse(JSON.stringify(branchingFixture)) as LiskaThreadArchive;
    const localCompanion: ArchiveCompanionBundle = {
      captureId: 'capture-chatgpt-11111111-2222-4333-8444-555555555555',
      conversationKey: 'a'.repeat(64),
      artifacts: [
        {
          kind: 'raw',
          relativePath: 'responses/conversation.json',
          mediaType: 'application/json',
          byteLength: 2,
          sha256: 'b'.repeat(64),
          bodyBase64: 'e30=',
        },
        {
          kind: 'manifest',
          relativePath: 'manifest.json',
          mediaType: 'application/json',
          byteLength: 2,
          sha256: 'c'.repeat(64),
          bodyBase64: 'e30=',
        },
        {
          kind: 'canonical',
          relativePath: 'canonical/liska-thread-1.json',
          mediaType: 'application/json',
          byteLength: 2,
          sha256: 'd'.repeat(64),
          bodyBase64: 'e30=',
        },
      ],
    };
    const localSettings = {
      flattenLargeCallouts: false,
      maxCalloutLines: 200,
      enableToolContent: false,
      templateOptions: {
        includeId: true,
        includeTitle: true,
        includeTags: true,
        includeSource: true,
        includeDates: true,
        includeMessageCount: true,
        messageFormat: 'callout',
        userCalloutType: 'QUESTION',
        assistantCalloutType: 'NOTE',
      },
    } as ContentScriptSettings;
    vi.mocked(sendMessage).mockImplementation(async message => {
      if (message.action === 'saveToOutputs') {
        return {
          results: [{ destination: 'file', ...strictResult }],
          allSuccessful: strictResult.success,
          anySuccessful: strictResult.success,
        };
      }
      return {
        results: [{ destination: 'file', success: true }],
        allSuccessful: true,
        anySuccessful: true,
      };
    });

    await persistAllBranchesBundle(
      { archive, catalog: getArchiveBranchCatalog(archive) },
      localCompanion,
      localSettings,
      ['file']
    );

    const saves = vi
      .mocked(sendMessage)
      .mock.calls.map(call => call[0])
      .filter(message => message.action === 'saveToOutputs');
    expect(saves).toHaveLength(1);
    expect(showWarningToast).toHaveBeenCalledWith(
      expect.stringContaining('All-branches export was partial')
    );
  });

  it('maps strict Markdown confirmation followed by a failed overall File result to failed', async () => {
    const archive = JSON.parse(JSON.stringify(branchingFixture)) as LiskaThreadArchive;
    const localCompanion: ArchiveCompanionBundle = {
      captureId: 'capture-chatgpt-11111111-2222-4333-8444-555555555555',
      conversationKey: 'a'.repeat(64),
      artifacts: [
        {
          kind: 'raw',
          relativePath: 'responses/conversation.json',
          mediaType: 'application/json',
          byteLength: 2,
          sha256: 'b'.repeat(64),
          bodyBase64: 'e30=',
        },
        {
          kind: 'manifest',
          relativePath: 'manifest.json',
          mediaType: 'application/json',
          byteLength: 2,
          sha256: 'c'.repeat(64),
          bodyBase64: 'e30=',
        },
        {
          kind: 'canonical',
          relativePath: 'canonical/liska-thread-1.json',
          mediaType: 'application/json',
          byteLength: 2,
          sha256: 'd'.repeat(64),
          bodyBase64: 'e30=',
        },
      ],
    };
    const localSettings = {
      flattenLargeCallouts: false,
      maxCalloutLines: 200,
      enableToolContent: false,
      templateOptions: {
        includeId: true,
        includeTitle: true,
        includeTags: true,
        includeSource: true,
        includeDates: true,
        includeMessageCount: true,
        messageFormat: 'callout',
        userCalloutType: 'QUESTION',
        assistantCalloutType: 'NOTE',
      },
    } as ContentScriptSettings;
    vi.mocked(sendMessage).mockImplementation(async message => {
      if (message.action === 'saveToOutputs') {
        return {
          results: [
            { destination: 'file', success: false, strictFileOutcome: 'confirmed-success' },
          ],
          allSuccessful: false,
          anySuccessful: false,
        };
      }
      return {
        results: [{ destination: 'file', success: true }],
        allSuccessful: true,
        anySuccessful: true,
      };
    });

    await persistAllBranchesBundle(
      { archive, catalog: getArchiveBranchCatalog(archive) },
      localCompanion,
      localSettings,
      ['file']
    );

    const saves = vi
      .mocked(sendMessage)
      .mock.calls.map(call => call[0])
      .filter(message => message.action === 'saveToOutputs');
    expect(saves).toHaveLength(2);
    expect(
      saves.some(message => message.data.frontmatter.presentation_mode === 'all-branches-index')
    ).toBe(false);
  });
});
