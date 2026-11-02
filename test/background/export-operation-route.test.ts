/** Real worker + real controller: only sinks/browser APIs are replaced. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { htmlMessage, htmlSettings } from './derived-html-fixture';
import { branchHtmlMessage } from './derived-branch-html-fixture';
import { validateMessageContent } from '../../src/background/validation';
import { serializeSyncSettingsSnapshot } from '../../src/lib/sync-settings-snapshot';
import { EXPORT_DURABLE_ACTIONS, EXPORT_STATE_KEY } from '../../src/lib/export-operation-contract';

const mocks = vi.hoisted(() => ({
  output: vi.fn(),
  archive: vi.fn(),
  binary: vi.fn(),
  capture: vi.fn(),
  settings: vi.fn(),
  dots: vi.fn(),
  connection: vi.fn(),
}));
vi.mock('../../src/background/obsidian-handlers', () => ({
  handleTestConnection: mocks.connection,
}));
vi.mock('../../src/background/dots-schema-probe', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/background/dots-schema-probe')>()),
  probeDotsSchemaInActiveTab: mocks.dots,
}));
vi.mock('../../src/lib/storage', () => ({
  getSettings: mocks.settings,
  migrateSettings: async () => undefined,
  saveSettings: vi.fn(),
}));
vi.mock('../../src/background/output-handlers', () => ({
  handleMultiOutput: mocks.output,
  handlePersistArchiveCompanion: mocks.output,
  handlePersistDerivedHtmlPresentation: mocks.output,
  handlePersistDerivedBranchHtmlPresentation: mocks.output,
}));
vi.mock('../../src/background/archive-stage-handlers', () => ({
  handleArchiveStageMessage: mocks.archive,
}));
vi.mock('../../src/background/binary-asset-handlers', () => ({
  handleStagedBinaryAssetMessage: mocks.binary,
}));
vi.mock('../../src/background/archive-stage-download-recovery', () => ({
  startArchiveStageDownloadRecovery: vi.fn(),
}));
vi.mock('../../src/background/binary-download-recovery', () => ({
  startStagedBinaryDownloadRecovery: vi.fn(),
}));
vi.mock('../../src/background/chatgpt-capture', () => ({
  captureChatGptInTemporaryTab: mocks.capture,
  ChatGptTemporaryCaptureError: class extends Error {},
}));
const route = 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd';
const stageId = `archive-stage-${'A'.repeat(32)}`;
const binaryId = `stage-${'B'.repeat(32)}`;
let listener: (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (response: unknown) => void
) => unknown;
let operationId: string;
let tabUpdated: (tabId: number, change: chrome.tabs.TabChangeInfo) => void;
const sender = () =>
  ({
    id: chrome.runtime.id,
    tab: { id: 7, windowId: 3, url: route },
    frameId: 0,
    documentId: 'document-one',
    url: route,
  }) as chrome.runtime.MessageSender;
const popup = () => ({ id: chrome.runtime.id, url: chrome.runtime.getURL('src/popup/index.html') });
function dispatch(message: unknown, owner = sender()): Promise<unknown> {
  return new Promise(resolve => {
    listener(message, owner, resolve);
  });
}
async function messages() {
  const settings = htmlSettings();
  const shared = {
    source: 'chatgpt',
    captureId: 'capture-chatgpt-synthetic',
    conversationKey: 'a'.repeat(64),
    outputs: ['file'],
    expectedSyncSettingsSnapshot: serializeSyncSettingsSnapshot(settings),
  };
  const artifact = {
    kind: 'raw',
    relativePath: 'responses/conversation.json',
    mediaType: 'application/json',
    byteLength: 2,
    sha256: 'b'.repeat(64),
  };
  return [
    {
      action: 'saveToOutputs',
      outputs: ['file'],
      data: {
        fileName: 'synthetic.md',
        body: 'synthetic',
        contentHash: 'abc123',
        frontmatter: {
          id: 'synthetic',
          title: 'Synthetic',
          source: 'chatgpt',
          url: route,
          created: '2026-11-02T00:00:00Z',
          modified: '2026-11-02T00:00:00Z',
          tags: [],
          message_count: 1,
        },
      },
    },
    {
      action: 'persistArchiveCompanion',
      ...shared,
      noteFileName: 'synthetic.md',
      artifact: { ...artifact, transport: 'inline', bodyBase64: 'e30=' },
    },
    await htmlMessage(),
    await branchHtmlMessage(),
    {
      action: 'commitStagedArchiveCompanion',
      ...shared,
      noteFileName: 'synthetic.md',
      artifact: { ...artifact, transport: 'staged', stageId },
    },
    {
      action: 'commitStagedBinaryAsset',
      ...shared,
      stageId: binaryId,
      descriptor: {
        assetId: `chatgpt-asset-${'b'.repeat(64)}`,
        relativePath: `assets/${'c'.repeat(64)}.bin`,
        mediaType: 'application/octet-stream',
        byteLength: 2,
        sha256: 'c'.repeat(64),
      },
    },
  ];
}
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('crypto', webcrypto);
  operationId = '';
  let stored = {};
  Object.assign(chrome.storage, {
    session: {
      get: vi.fn(async () => structuredClone(stored)),
      set: vi.fn(async (value: object) => {
        stored = structuredClone(value);
      }),
    },
  });
  Object.assign(chrome.tabs, {
    onUpdated: {
      addListener: vi.fn(callback => {
        tabUpdated = callback;
      }),
    },
    get: vi.fn(async () => sender().tab),
    query: vi.fn(async () => [sender().tab]),
    sendMessage: vi.fn(async (_id, command) => {
      if (command.action === 'beginExportOperation') {
        const claim = (await dispatch({
          action: 'claimExportOperation',
          intentId: command.intentId,
          route,
        })) as { success: boolean; exportOperationId: string };
        operationId = claim.exportOperationId;
        return { accepted: claim.success };
      }
      return { accepted: true };
    }),
  });
  mocks.settings.mockResolvedValue(htmlSettings());
  mocks.output.mockResolvedValue({ allSuccessful: true });
  mocks.archive.mockResolvedValue({ success: true, stageId });
  mocks.binary.mockResolvedValue({ success: true });
  vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation(candidate => {
    listener = candidate;
  });
  await import('../../src/background/service-worker');
});
describe('export authority at actual worker dispatch', () => {
  it.each(['archive', 'binary'] as const)(
    'retains %s cleanup ownership until confirmed success, then persists its release',
    async kind => {
      await dispatch(
        {
          action: 'startExportOperation',
          mode: 'current',
          expectedTarget: { tabId: 7, route },
          expectedOutputs: ['obsidian', 'file', 'clipboard'],
        },
        popup()
      );
      const commit = (await messages())[kind === 'archive' ? 4 : 5] as unknown as {
        artifact: { stageId: string; transport: string };
        descriptor: object;
      };
      if (kind === 'archive') {
        const { stageId: _stageId, transport: _transport, ...descriptor } = commit.artifact;
        await dispatch({
          action: 'beginStagedArchiveArtifact',
          source: 'chatgpt',
          descriptor,
          exportOperationId: operationId,
        });
      } else
        await dispatch({
          action: 'beginStagedBinaryAsset',
          source: 'chatgpt',
          stageId: binaryId,
          descriptor: commit.descriptor,
          exportOperationId: operationId,
        });
      const ownedId = kind === 'archive' ? stageId : binaryId;
      const abort = {
        action: kind === 'archive' ? 'abortStagedArchiveArtifact' : 'abortStagedBinaryAsset',
        source: 'chatgpt',
        stageId: ownedId,
        exportOperationId: operationId,
      };
      const sink = kind === 'archive' ? mocks.archive : mocks.binary;
      const retained = async () => {
        const stored = await chrome.storage.session.get(EXPORT_STATE_KEY);
        return (
          stored[EXPORT_STATE_KEY].operations as Array<{ id: string; stages: string[] }>
        ).find(op => op.id === operationId)!.stages;
      };
      let finish!: (response: unknown) => void;
      sink.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve;
          })
      );
      const pending = dispatch(abort);
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      expect(await retained()).toEqual([ownedId]);
      finish({ success: false, error: 'cleanup-deferred' });
      expect(await pending).toMatchObject({ success: false });
      expect(await retained()).toEqual([ownedId]);
      sink.mockResolvedValueOnce(undefined);
      expect(await dispatch(abort)).toBeUndefined();
      expect(await retained()).toEqual([ownedId]);
      const calls = sink.mock.calls.length;
      expect(await dispatch(abort, { ...sender(), documentId: 'wrong-document' })).toMatchObject({
        success: false,
      });
      expect(sink).toHaveBeenCalledTimes(calls);
      expect(await retained()).toEqual([ownedId]);
      sink.mockResolvedValueOnce({ success: true });
      expect(await dispatch(abort)).toMatchObject({ success: true });
      expect(await retained()).toEqual([]);
      const completedCalls = sink.mock.calls.length;
      vi.resetModules();
      await import('../../src/background/service-worker');
      expect(await dispatch(abort)).toMatchObject({ success: false });
      expect(sink).toHaveBeenCalledTimes(completedCalls);
    }
  );
  it('does not dispatch when navigation arrives during the authorization settings await', async () => {
    await dispatch(
      {
        action: 'startExportOperation',
        mode: 'current',
        expectedTarget: { tabId: 7, route },
        expectedOutputs: ['obsidian', 'file', 'clipboard'],
      },
      popup()
    );
    let release!: () => void;
    let entered!: () => void;
    const paused = new Promise<void>(resolve => {
      entered = resolve;
    });
    mocks.settings.mockResolvedValueOnce(htmlSettings()).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = () => resolve(htmlSettings());
          entered();
        })
    );
    const message = (await messages())[0];
    const attempt = dispatch({ ...message, exportOperationId: operationId });
    await paused;
    const nextRoute = route + '?navigation=changed';
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      ...sender().tab,
      url: nextRoute,
    } as chrome.tabs.Tab);
    tabUpdated(7, { url: nextRoute });
    release();
    expect(await attempt).toMatchObject({ allSuccessful: false, anySuccessful: false });
    expect(mocks.output).not.toHaveBeenCalled();
  });
  it.each(['archive', 'binary'] as const)(
    'worker-denied %s commit aborts only its exact uncommitted stage',
    async kind => {
      await dispatch(
        {
          action: 'startExportOperation',
          mode: 'current',
          expectedTarget: { tabId: 7, route },
          expectedOutputs: ['obsidian', 'file', 'clipboard'],
        },
        popup()
      );
      const commit = {
        ...(await messages())[kind === 'archive' ? 4 : 5],
        reportDurableWriteOutcome: true,
        exportOperationId: operationId,
      };
      const value = commit as unknown as {
        artifact: { stageId: string; transport: string };
        descriptor: object;
      };
      if (kind === 'archive') {
        const { stageId: _stageId, transport: _transport, ...descriptor } = value.artifact;
        await dispatch({
          action: 'beginStagedArchiveArtifact',
          source: 'chatgpt',
          descriptor,
          exportOperationId: operationId,
        });
      } else
        await dispatch({
          action: 'beginStagedBinaryAsset',
          source: 'chatgpt',
          stageId: binaryId,
          descriptor: value.descriptor,
          exportOperationId: operationId,
        });
      await dispatch({ action: 'cancelExportOperation', exportOperationId: operationId }, popup());
      expect(await dispatch(commit)).toMatchObject({
        anySuccessful: false,
        results: [{ writeOutcome: { state: 'not-dispatched' } }],
      });
      const sink = kind === 'archive' ? mocks.archive : mocks.binary;
      expect(sink.mock.calls.map(([message]) => message.action)).toEqual(
        kind === 'archive'
          ? ['beginStagedArchiveArtifact', 'abortStagedArchiveArtifact']
          : ['beginStagedBinaryAsset', 'abortStagedBinaryAsset']
      );
      expect(sink.mock.calls[1][0].stageId).toBe(kind === 'archive' ? stageId : binaryId);
    }
  );
  it('Stop and a denied duplicate do not abort a binary commit already handed to the worker', async () => {
    await dispatch(
      {
        action: 'startExportOperation',
        mode: 'current',
        expectedTarget: { tabId: 7, route },
        expectedOutputs: ['obsidian', 'file', 'clipboard'],
      },
      popup()
    );
    const commit = {
      ...(await messages())[5],
      reportDurableWriteOutcome: true,
      exportOperationId: operationId,
    };
    await dispatch({
      action: 'beginStagedBinaryAsset',
      source: 'chatgpt',
      stageId: binaryId,
      descriptor: (commit as unknown as { descriptor: object }).descriptor,
      exportOperationId: operationId,
    });
    let finish!: (value: unknown) => void;
    mocks.binary.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const first = dispatch(commit);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await dispatch({ action: 'cancelExportOperation', exportOperationId: operationId }, popup());
    expect(await dispatch(commit)).toMatchObject({ anySuccessful: false });
    expect(mocks.binary.mock.calls.map(([message]) => message.action)).toEqual([
      'beginStagedBinaryAsset',
      'commitStagedBinaryAsset',
    ]);
    finish({
      anySuccessful: false,
      allSuccessful: false,
      results: [{ destination: 'file', success: false, writeOutcome: { state: 'unknown' } }],
    });
    expect(await first).toMatchObject({ results: [{ writeOutcome: { state: 'unknown' } }] });
  });
  it('registered fallback Settings retains Test and Dots, with exact source binding; copied session URLs do not grant either', async () => {
    const dotsRoute = 'https://chatgpt.com/dots/synthetic';
    const provider = {
      ...sender(),
      url: dotsRoute,
      tab: { ...sender().tab, url: dotsRoute },
    } as chrome.runtime.MessageSender;
    vi.mocked(chrome.tabs.get).mockResolvedValue(provider.tab!);
    Object.assign(chrome, {
      action: {},
      windows: { create: vi.fn(async () => ({ id: 9, tabs: [{ id: 10 }] })) },
      permissions: { contains: (_value: unknown, done: (allowed: boolean) => void) => done(true) },
    });
    expect(await dispatch({ action: 'openExportSurface' }, provider)).toEqual({ success: true });
    const page = vi.mocked(chrome.windows.create).mock.calls[0][0]!.url as string;
    const ui = {
      id: chrome.runtime.id,
      url: page,
      frameId: 0,
      tab: { id: 10, windowId: 9, url: page },
    } as chrome.runtime.MessageSender;
    mocks.connection.mockResolvedValue({ success: true });
    mocks.dots.mockResolvedValue({ success: true, fileName: 'liska-dots-schema-probe.json' });
    expect(await dispatch({ action: 'testConnection' }, ui)).toMatchObject({ success: true });
    expect(await dispatch({ action: 'probeDotsSchema' }, ui)).toMatchObject({ success: true });
    expect(mocks.dots).toHaveBeenCalledExactlyOnceWith({ sourceTab: { tabId: 7, url: dotsRoute } });
    const forged = { ...ui, tab: { ...ui.tab, id: 11 } } as chrome.runtime.MessageSender;
    expect(await dispatch({ action: 'probeDotsSchema' }, forged)).toMatchObject({
      success: false,
      code: 'invalid-sender',
    });
    expect(await dispatch({ action: 'testConnection' }, forged)).toMatchObject({ success: false });
    expect(mocks.connection).toHaveBeenCalledOnce();
    expect(mocks.dots).toHaveBeenCalledOnce();
  });
  it('valid six-family payloads cannot reach any sink without or with a forged operation', async () => {
    const requests = await messages();
    expect(requests.map(item => item.action)).toEqual([...EXPORT_DURABLE_ACTIONS]);
    for (const message of requests) {
      expect(validateMessageContent(message), message.action).toBe(true);
      const denied =
        message.action === 'persistDerivedBranchHtmlPresentation'
          ? { success: false, html: { writeOutcome: { state: 'not-dispatched' } } }
          : { allSuccessful: false, anySuccessful: false };
      expect(await dispatch(message)).toMatchObject(denied);
      expect(await dispatch({ ...message, exportOperationId: crypto.randomUUID() })).toMatchObject(
        denied
      );
    }
    expect(mocks.output).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.binary).not.toHaveBeenCalled();
  });
  it('current claim authorizes valid output, stripping transport-only ID before existing handler; Stop blocks later dispatch', async () => {
    await dispatch(
      {
        action: 'startExportOperation',
        mode: 'current',
        expectedTarget: { tabId: 7, route },
        expectedOutputs: ['obsidian', 'file', 'clipboard'],
      },
      popup()
    );
    const message = (await messages())[0];
    await dispatch({ ...message, exportOperationId: operationId });
    expect(mocks.output).toHaveBeenCalledOnce();
    await dispatch({ action: 'cancelExportOperation', exportOperationId: operationId }, popup());
    await dispatch({ ...message, exportOperationId: operationId });
    expect(mocks.output).toHaveBeenCalledOnce();
  });
  it('stage allocation belongs to the claimed document; cancellation allows only exact stage cleanup', async () => {
    await dispatch(
      {
        action: 'startExportOperation',
        mode: 'current',
        expectedTarget: { tabId: 7, route },
        expectedOutputs: ['obsidian', 'file', 'clipboard'],
      },
      popup()
    );
    const descriptor = {
      kind: 'raw',
      relativePath: 'responses/conversation.json',
      mediaType: 'application/json',
      byteLength: 2,
      sha256: 'b'.repeat(64),
    };
    await dispatch({
      action: 'beginStagedArchiveArtifact',
      source: 'chatgpt',
      descriptor,
      exportOperationId: operationId,
    });
    await dispatch({ action: 'cancelExportOperation', exportOperationId: operationId }, popup());
    const abort = {
      action: 'abortStagedArchiveArtifact',
      source: 'chatgpt',
      stageId,
      exportOperationId: operationId,
    };
    expect(await dispatch(abort)).toMatchObject({ success: true });
    expect(await dispatch(abort, { ...sender(), documentId: 'document-two' })).toMatchObject({
      success: false,
    });
    expect(mocks.archive).toHaveBeenCalledTimes(2);
  });
  it('valid capture cannot reach the capture engine before claim', async () => {
    const request = {
      action: 'captureChatGptConversation',
      conversationId: route.split('/').at(-1),
    };
    expect(validateMessageContent(request)).toBe(true);
    expect(await dispatch(request)).toMatchObject({ success: false });
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
