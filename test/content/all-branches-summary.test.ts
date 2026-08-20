import { beforeEach, describe, expect, it, vi } from 'vitest';
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

import { displayAllBranchesSummary, persistAllBranchesBundle } from '../../src/content/bootstrap';
import { showErrorToast, showToast, showWarningToast } from '../../src/content/ui';
import { sendMessage } from '../../src/lib/messaging';
import type { AllBranchesPersistenceSummary } from '../../src/content/archive-branch-persistence';
import type { ArchiveCompanionBundle, ContentScriptSettings } from '../../src/lib/types';

function summary(
  overrides: Partial<AllBranchesPersistenceSummary> = {}
): AllBranchesPersistenceSummary {
  return {
    branchCount: 2,
    omissionBranchCount: 0,
    canonicalOnlyCount: 0,
    clipboardSkipped: false,
    destinations: [
      {
        destination: 'file',
        archiveSaved: true,
        branchFilesSaved: 2,
        indexSaved: true,
      },
    ],
    allSuccessful: true,
    ...overrides,
  };
}

describe('all-branches user summary', () => {
  beforeEach(() => vi.clearAllMocks());

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

  it('summarizes legacy omissions, canonical-only stubs, and skipped Clipboard', () => {
    displayAllBranchesSummary(
      summary({ omissionBranchCount: 2, canonicalOnlyCount: 1, clipboardSkipped: true })
    );

    expect(showWarningToast).toHaveBeenCalledWith(
      expect.stringContaining('2 branch Markdown file(s) omit content preserved in canonical')
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
            branchFilesSaved: 1,
            indexSaved: false,
          },
          {
            destination: 'obsidian',
            archiveSaved: false,
            branchFilesSaved: 0,
            indexSaved: false,
          },
        ],
      })
    );

    expect(showWarningToast).toHaveBeenCalledWith(
      'All-branches export was partial: 1/4 branch writes, 0/2 indexes, and 1/2 complete archive bundles succeeded'
    );
  });

  it('wires one archive bundle, sequential leaves, progress, and an index through messaging', async () => {
    const archive = JSON.parse(JSON.stringify(branchingFixture)) as LiskaThreadArchive;
    const companion: ArchiveCompanionBundle = {
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
        results: outputs.map(destination => ({ destination, success: true })),
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
    expect(showToast).toHaveBeenCalledWith('Saving all branches... 2/2', 'info', 0);
    expect(showWarningToast).toHaveBeenCalledWith(
      expect.stringContaining('Saved 2 branches and an index to file')
    );
  });
});
