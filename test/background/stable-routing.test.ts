import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import { serializeSyncSettingsSnapshot } from '../../src/lib/sync-settings-snapshot';
import type {
  ExtensionMessage,
  ExtensionSettings,
  PersistentOutputDestination,
} from '../../src/lib/types';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  inline: vi.fn(),
  markdown: vi.fn(),
  archiveStage: vi.fn(),
  binaryStage: vi.fn(),
}));
vi.mock('../../src/lib/storage', () => ({
  getSettings: mocks.getSettings,
  saveSettings: mocks.saveSettings,
  migrateSettings: async () => undefined,
}));
vi.mock('../../src/background/output-handlers', () => ({
  handlePersistArchiveCompanion: mocks.inline,
  handleMultiOutput: mocks.markdown,
}));
vi.mock('../../src/background/archive-stage-handlers', () => ({
  handleArchiveStageMessage: mocks.archiveStage,
}));
vi.mock('../../src/background/binary-asset-handlers', () => ({
  handleStagedBinaryAssetMessage: mocks.binaryStage,
}));
vi.mock('../../src/background/archive-stage-download-recovery', () => ({
  startArchiveStageDownloadRecovery: vi.fn(),
}));
vi.mock('../../src/background/binary-download-recovery', () => ({
  startStagedBinaryDownloadRecovery: vi.fn(),
}));

type Source = 'chatgpt' | 'deepseek';
type Phase = 'raw' | 'binary' | 'manifest' | 'canonical' | 'markdown';
const phases: Phase[] = ['raw', 'binary', 'manifest', 'canonical', 'markdown'];
const capturedAt = '2026-09-19T23:59:59.000Z';
const archiveStageId = `archive-stage-${'A'.repeat(32)}`;
const binaryStageId = `stage-${'B'.repeat(32)}`;
let listener: (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (value: unknown) => void
) => boolean | undefined;
let current: ExtensionSettings;
let snapshot: string;

function sender(source: Source): chrome.runtime.MessageSender {
  const url =
    source === 'chatgpt'
      ? 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd'
      : 'https://chat.deepseek.com/a/chat/s/synthetic';
  return { tab: { url }, frameId: 0, url } as chrome.runtime.MessageSender;
}

function request(
  source: Source,
  phase: Phase,
  staged = false,
  destination: PersistentOutputDestination = 'file'
): ExtensionMessage {
  const shared = {
    captureId: 'capture-stable-routing',
    conversationKey: 'a'.repeat(64),
    capturedAt,
    expectedSyncSettingsSnapshot: snapshot,
    outputs: [destination],
  };
  if (phase === 'markdown')
    return {
      action: 'saveToOutputs',
      capturedAt,
      expectedSyncSettingsSnapshot: snapshot,
      outputs: [destination],
      data: {
        fileName: 'note.md',
        body: '# Synthetic',
        contentHash: 'abc123',
        frontmatter: {
          id: 'synthetic',
          title: 'Synthetic',
          source,
          url: sender(source).url!,
          created: capturedAt,
          modified: capturedAt,
          tags: [],
          message_count: 1,
        },
      },
    };
  if (phase === 'binary')
    return {
      action: 'commitStagedBinaryAsset',
      source,
      stageId: binaryStageId,
      ...shared,
      descriptor: {
        assetId: `${source}-asset-${'b'.repeat(64)}`,
        relativePath: `assets/${'c'.repeat(64)}.bin`,
        mediaType: 'application/octet-stream',
        byteLength: 2,
        sha256: 'c'.repeat(64),
      },
    };
  const artifact = {
    kind: phase,
    relativePath:
      phase === 'raw'
        ? 'responses/conversation.json'
        : phase === 'manifest'
          ? 'manifest.json'
          : 'canonical/liska-thread-1.json',
    mediaType: 'application/json' as const,
    byteLength: 2,
    sha256: 'd'.repeat(64),
  };
  return staged && phase !== 'manifest'
    ? {
        action: 'commitStagedArchiveCompanion',
        source,
        noteFileName: 'note.md',
        ...shared,
        artifact: { ...artifact, transport: 'staged', stageId: archiveStageId },
      }
    : {
        action: 'persistArchiveCompanion',
        source,
        noteFileName: 'note.md',
        ...shared,
        artifact: { ...artifact, transport: 'inline', bodyBase64: 'e30=' },
      };
}

async function dispatch(message: unknown, source: Source = 'chatgpt') {
  const respond = vi.fn();
  listener(message, sender(source), respond);
  await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
  return respond.mock.calls[0][0];
}

function durableDispatchCount(): number {
  return (
    mocks.inline.mock.calls.length +
    mocks.markdown.mock.calls.length +
    mocks.archiveStage.mock.calls.filter(
      ([value]) => value.action === 'commitStagedArchiveCompanion'
    ).length +
    mocks.binaryStage.mock.calls.filter(([value]) => value.action === 'commitStagedBinaryAsset')
      .length
  );
}

describe('settings-stable durable message admission', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    current = {
      ...structuredClone(DEFAULT_SYNC_SETTINGS),
      obsidianApiKey: 'secret-not-in-guard',
      outputOptions: { file: true, obsidian: true, clipboard: false },
    };
    snapshot = serializeSyncSettingsSnapshot(current);
    mocks.getSettings.mockImplementation(async () => structuredClone(current));
    mocks.saveSettings.mockResolvedValue(undefined);
    const success = {
      results: [{ destination: 'file', success: true }],
      allSuccessful: true,
      anySuccessful: true,
    };
    mocks.inline.mockResolvedValue(success);
    mocks.markdown.mockResolvedValue(success);
    mocks.archiveStage.mockImplementation(async value =>
      value.action === 'abortStagedArchiveArtifact' ? { success: true } : success
    );
    mocks.binaryStage.mockImplementation(async value =>
      value.action === 'abortStagedBinaryAsset' ? { success: true } : success
    );
    vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation(value => {
      listener = value;
    });
    vi.resetModules();
    await import('../../src/background/service-worker');
  });

  it.each(['raw', 'binary', 'manifest', 'canonical'] as const)(
    'reports not-dispatched typed %s facts on settings rejection',
    async phase => {
      const message = {
        ...request('chatgpt', phase, true),
        reportDurableWriteOutcome: true as const,
      };
      current.vaultPath = 'changed';
      const response = await dispatch(message);
      expect(response).toMatchObject({
        results: [
          { success: false, error: 'settings-changed', writeOutcome: { state: 'not-dispatched' } },
        ],
      });
      expect(durableDispatchCount()).toBe(0);
    }
  );

  const sequenceCases = (['chatgpt', 'deepseek'] as const).flatMap(source =>
    [false, true].flatMap(staged =>
      (['file', 'obsidian'] as const).flatMap(destination =>
        [1, 2, 3, 4].map(cut => ({ source, staged, destination, cut }))
      )
    )
  );
  it.each(sequenceCases)(
    'keeps original routing after phase $cut ($source / staged=$staged / $destination)',
    async ({ source, staged, destination, cut }) => {
      for (let index = 0; index < phases.length; index += 1) {
        if (index === cut) current.vaultPath = 'changed/{date}/{platform}';
        const message = request(source, phases[index], staged, destination);
        const response = await dispatch(message, source);
        if (index < cut) expect(response.anySuccessful).toBe(true);
        else
          expect(response).toEqual({
            results: [{ destination, success: false, error: 'settings-changed' }],
            allSuccessful: false,
            anySuccessful: false,
          });
      }
      expect(durableDispatchCount()).toBe(cut);
      expect(mocks.getSettings).toHaveBeenCalledTimes(phases.length);
      const expectedArchiveAborts = staged
        ? phases.slice(cut).filter(value => ['raw', 'canonical'].includes(value)).length
        : 0;
      expect(
        mocks.archiveStage.mock.calls.filter(
          ([value]) => value.action === 'abortStagedArchiveArtifact'
        )
      ).toEqual(
        Array.from({ length: expectedArchiveAborts }, () => [
          { action: 'abortStagedArchiveArtifact', source, stageId: archiveStageId },
        ])
      );
      if (cut === 1)
        expect(mocks.binaryStage).toHaveBeenCalledWith(
          { action: 'abortStagedBinaryAsset', source, stageId: binaryStageId },
          expect.any(Object)
        );
      expect(snapshot).not.toContain(current.obsidianApiKey);
    }
  );

  const changes = {
    vaultPath: () => {
      current.vaultPath = 'other';
    },
    obsidianUrl: () => {
      current.obsidianUrl = 'http://127.0.0.1:27124';
    },
    outputToggle: () => {
      current.outputOptions.file = false;
    },
    template: () => {
      current.templateOptions.includeDates = !current.templateOptions.includeDates;
    },
  };
  it.each(Object.keys(changes))(
    'rejects $0 drift on every durable action without a write retry',
    async change => {
      changes[change as keyof typeof changes]();
      for (const phase of phases) await dispatch(request('chatgpt', phase, true));
      expect(durableDispatchCount()).toBe(0);
      expect(mocks.archiveStage.mock.calls).toHaveLength(2);
      expect(mocks.binaryStage.mock.calls).toHaveLength(1);
    }
  );

  it.each(['raw', 'binary'] as const)(
    'does not derive abort authority from malformed or foreign %s commits',
    async phase => {
      const malformed = { ...request('chatgpt', phase, true), expectedSyncSettingsSnapshot: '{}' };
      expect(await dispatch(malformed)).toEqual({
        success: false,
        error: 'Invalid message content',
      });
      const respond = vi.fn();
      listener(request('chatgpt', phase, true), sender('deepseek'), respond);
      expect(respond).toHaveBeenCalledWith({ success: false, error: 'Unauthorized' });
      expect(mocks.getSettings).not.toHaveBeenCalled();
      expect(mocks.archiveStage).not.toHaveBeenCalled();
      expect(mocks.binaryStage).not.toHaveBeenCalled();
      expect(durableDispatchCount()).toBe(0);
    }
  );

  it.each(['raw', 'binary'] as const)(
    'reports fixed cleanup-deferred evidence when exact %s abort fails',
    async phase => {
      current.vaultPath = 'changed';
      const handler = phase === 'raw' ? mocks.archiveStage : mocks.binaryStage;
      handler.mockRejectedValue(new Error('private-error-must-not-escape'));
      const response = await dispatch(request('chatgpt', phase, true));
      expect(response.results).toEqual([
        {
          destination: 'file',
          success: false,
          error: 'settings-changed',
          warning:
            phase === 'raw' ? 'archive-stage-cleanup-deferred' : 'binary-stage-cleanup-deferred',
        },
      ]);
      expect(JSON.stringify(response)).not.toContain('private-error');
      expect(durableDispatchCount()).toBe(0);
    }
  );

  it('honors an immediate disabled-output override while storage still contains the original snapshot', async () => {
    mocks.saveSettings.mockReturnValue(new Promise(() => {}));
    listener(
      {
        action: 'updateOutputOptions',
        outputOptions: { file: false, obsidian: false, clipboard: false },
      },
      { id: chrome.runtime.id, url: chrome.runtime.getURL('src/popup/index.html') },
      vi.fn()
    );
    const response = await dispatch(request('chatgpt', 'binary'));
    expect(response.anySuccessful).toBe(false);
    expect(durableDispatchCount()).toBe(0);
    expect(mocks.binaryStage).toHaveBeenCalledExactlyOnceWith(
      { action: 'abortStagedBinaryAsset', source: 'chatgpt', stageId: binaryStageId },
      expect.objectContaining({ outputOptions: { file: false, obsidian: false, clipboard: false } })
    );
  });

  it('preserves explicit legacy behavior without promising snapshot or capture-time consistency', async () => {
    current.vaultPath = 'changed';
    for (const phase of phases) {
      const message = request('deepseek', phase, true);
      delete (message as { expectedSyncSettingsSnapshot?: string }).expectedSyncSettingsSnapshot;
      delete (message as { capturedAt?: string }).capturedAt;
      expect((await dispatch(message, 'deepseek')).anySuccessful).toBe(true);
    }
    expect(durableDispatchCount()).toBe(phases.length);
  });

  it.each(['file', 'obsidian'] as const)(
    'never lets a matching snapshot resurrect disabled %s output',
    async destination => {
      current.outputOptions[destination] = false;
      snapshot = serializeSyncSettingsSnapshot(current);
      for (const phase of phases) {
        expect((await dispatch(request('chatgpt', phase, true, destination))).anySuccessful).toBe(
          false
        );
      }
      expect(durableDispatchCount()).toBe(0);
    }
  );
});
