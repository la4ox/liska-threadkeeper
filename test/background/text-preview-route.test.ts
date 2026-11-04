/** Real worker + real preview/export controllers; every forbidden sink is replaced. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { htmlSettings } from './derived-html-fixture';
import { PRESENTATION_RENDERER_VERSIONS } from '../../src/archive/presentation/presentation-contracts';

const mocks = vi.hoisted(() => ({
  output: vi.fn(),
  archive: vi.fn(),
  binary: vi.fn(),
  capture: vi.fn(),
  probe: vi.fn(),
  image: vi.fn(),
  connection: vi.fn(),
  settings: vi.fn(),
}));

vi.mock('../../src/background/obsidian-handlers', () => ({
  handleTestConnection: mocks.connection,
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
  handlePersistDerivedTextPresentation: mocks.output,
  handlePersistDerivedBranchHtmlPresentation: mocks.output,
}));
vi.mock('../../src/background/archive-stage-handlers', () => ({
  handleArchiveStageMessage: mocks.archive,
}));
vi.mock('../../src/background/binary-asset-handlers', () => ({
  handleStagedBinaryAssetMessage: mocks.binary,
}));
vi.mock('../../src/background/chatgpt-capture', () => ({
  captureChatGptInTemporaryTab: mocks.capture,
  ChatGptTemporaryCaptureError: class extends Error {},
}));
vi.mock('../../src/background/chatgpt-opaque-probe', () => ({
  probeChatGptOpaqueRequest: mocks.probe,
}));
vi.mock('../../src/background/image-fetch', () => ({ handleFetchImage: mocks.image }));
vi.mock('../../src/background/archive-stage-download-recovery', () => ({
  startArchiveStageDownloadRecovery: vi.fn(),
}));
vi.mock('../../src/background/binary-download-recovery', () => ({
  startStagedBinaryDownloadRecovery: vi.fn(),
}));

const route = 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd';
const conversationId = '01234567-89ab-4cde-8f01-23456789abcd';
let listener: (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (response: unknown) => void
) => unknown;
let tabRemoved: (tabId: number) => void;

const source = () =>
  ({
    id: chrome.runtime.id,
    frameId: 0,
    documentId: 'source-document-1',
    url: route,
    tab: { id: 7, windowId: 3, url: route, status: 'complete', title: 'Private title' },
  }) as chrome.runtime.MessageSender;
const popup = () => ({ id: chrome.runtime.id, url: chrome.runtime.getURL('src/popup/index.html') });
function dispatch(message: unknown, sender = source()): Promise<unknown> {
  return new Promise(resolve => listener(message, sender, resolve));
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  let stored = {};
  let previewUrl = route;
  Object.assign(chrome.storage, {
    session: {
      get: vi.fn(async () => structuredClone(stored)),
      set: vi.fn(async (value: object) => {
        stored = structuredClone(value);
      }),
      remove: vi.fn(async () => undefined),
    },
  });
  Object.assign(chrome, {
    permissions: {
      contains: vi.fn((_permissions, callback) => callback(true)),
    },
    windows: {
      create: vi.fn(async () => ({
        id: 30,
        tabs: [{ id: 31, windowId: 30, url: route }],
      })),
      remove: vi.fn(async () => undefined),
    },
  });
  Object.assign(chrome.tabs, {
    onRemoved: {
      addListener: vi.fn(callback => {
        tabRemoved = callback;
      }),
    },
    get: vi.fn(async (tabId: number) =>
      tabId === 31 ? { id: 31, windowId: 30, url: previewUrl, status: 'complete' } : source().tab
    ),
    update: vi.fn(async (tabId: number, properties: chrome.tabs.UpdateProperties) => {
      if (tabId !== 31 || typeof properties.url !== 'string') throw new Error('missing');
      previewUrl = properties.url;
      return { id: 31, windowId: 30, url: previewUrl, status: 'loading' };
    }),
    query: vi.fn(async () => [source().tab]),
    sendMessage: vi.fn(async (_tabId, command) => {
      if (command.action === 'beginTextPreviewCapture') {
        const claim = (await dispatch({
          action: 'claimTextPreviewCapture',
          sessionId: command.sessionId,
          route,
        })) as { success?: boolean };
        return { accepted: claim.success === true };
      }
      return { accepted: true };
    }),
  });
  mocks.settings.mockResolvedValue(htmlSettings());
  mocks.capture.mockResolvedValue({
    transport: 'inline',
    bodyBase64: 'e30=',
    byteLength: 2,
    sha256: 'a'.repeat(64),
    mediaType: 'application/json',
    transientAssetResolvers: [],
  });
  mocks.archive.mockImplementation(async message =>
    message.action === 'beginStagedArchiveArtifact'
      ? { success: true, stageId: `archive-stage-${'A'.repeat(32)}` }
      : { success: true }
  );
  vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation(value => {
    listener = value;
  });
  await import('../../src/background/service-worker');
});

describe('text preview authority at the actual worker route', () => {
  it('rejects ordinary export authority attached to preview control before reserving a source', async () => {
    await expect(
      dispatch(
        {
          action: 'startTextPreview',
          expectedTarget: { tabId: 7, route },
          branchMode: 'current',
          exportOperationId: '11111111-1111-4111-8111-111111111111',
        },
        popup()
      )
    ).resolves.toEqual({ success: false, error: 'text-preview-invalid-message' });
    expect(chrome.windows.create).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(chrome.storage.session.set).not.toHaveBeenCalled();
  });

  it('returns a bounded preview error if active-tab discovery fails before startup', async () => {
    vi.mocked(chrome.tabs.query).mockRejectedValueOnce(new Error('Browser closing'));
    await expect(
      dispatch(
        { action: 'startTextPreview', expectedTarget: { tabId: 7, route }, branchMode: 'current' },
        popup()
      )
    ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
    expect(chrome.windows.create).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'ordinary export start',
      sender: popup,
      message: {
        action: 'startExportOperation',
        mode: 'current',
        expectedTarget: { tabId: 7, route },
        expectedOutputs: ['file'],
      },
    },
    {
      name: 'ordinary export surface',
      sender: source,
      message: { action: 'openExportSurface' },
    },
    {
      name: 'preview control',
      sender: popup,
      message: {
        action: 'startTextPreview',
        expectedTarget: { tabId: 7, route },
        branchMode: 'current',
      },
    },
    {
      name: 'offscreen dispatch',
      sender: source,
      message: { action: 'archiveStageAbort', target: 'offscreen', stageId: 'private' },
    },
  ])('rejects a preview-tagged $name before every ordinary early route', async testCase => {
    await expect(
      dispatch(
        {
          ...testCase.message,
          textPreviewCaptureId: '11111111-1111-4111-8111-111111111111',
        },
        testCase.sender()
      )
    ).resolves.toEqual({ success: false, error: 'Unauthorized' });
    expect(chrome.storage.session.set).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(chrome.windows.create).not.toHaveBeenCalled();
    expect(mocks.settings).not.toHaveBeenCalled();
  });

  it('lets only one concurrent start reserve a source tab', async () => {
    const command = {
      action: 'startTextPreview',
      expectedTarget: { tabId: 7, route },
      branchMode: 'current',
    };
    const results = await Promise.all([dispatch(command, popup()), dispatch(command, popup())]);
    expect(results.filter(result => (result as { success?: boolean }).success)).toHaveLength(1);
    expect(chrome.windows.create).toHaveBeenCalledOnce();
  });

  it('routes only capture-purpose actions and never reaches outputs, probes, acquisition, or connection', async () => {
    const started = (await dispatch(
      {
        action: 'startTextPreview',
        expectedTarget: { tabId: 7, route },
        branchMode: 'current',
      },
      popup()
    )) as { success: boolean; sessionId: string };
    expect(started.success).toBe(true);
    const authority = { textPreviewCaptureId: started.sessionId };
    const captured = await dispatch({
      action: 'captureChatGptConversation',
      conversationId,
      ...authority,
    });
    expect(captured).toMatchObject({ success: true });
    expect(mocks.capture).toHaveBeenCalledOnce();

    await dispatch({ action: 'probeChatGptOpaqueRequest', conversationId, ...authority });
    await dispatch({ action: 'testConnection', ...authority });
    await dispatch({ action: 'fetchImage', url: 'https://example.com/image.png', ...authority });
    await dispatch({
      action: 'saveToOutputs',
      outputs: ['file'],
      data: {
        fileName: 'never.md',
        body: 'never',
        contentHash: 'abc123',
        frontmatter: {
          id: 'never',
          title: 'Never',
          source: 'chatgpt',
          url: route,
          created: '2026-11-04T00:00:00Z',
          modified: '2026-11-04T00:00:00Z',
          tags: [],
          message_count: 1,
        },
      },
      ...authority,
    });
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.image).not.toHaveBeenCalled();
    expect(mocks.output).not.toHaveBeenCalled();
    expect(mocks.binary).not.toHaveBeenCalled();
  });

  it('publishes through control, revokes capture authority, and delivers only to the registered page', async () => {
    const started = (await dispatch(
      {
        action: 'startTextPreview',
        expectedTarget: { tabId: 7, route },
        branchMode: 'current',
      },
      popup()
    )) as { success: boolean; sessionId: string };
    const payload = {
      schema: 'liska-presentation-preview/1',
      sourceCanonicalSha256: 'c'.repeat(64),
      branchTargetNodeId: 'assistant-1',
      title: 'Detached',
      profile: {
        schema: 'liska-presentation-profile/1',
        includeToolContent: false,
        inertTaggedCodeBlocks: true,
      },
      rendererVersions: PRESENTATION_RENDERER_VERSIONS,
      rows: [
        {
          nodeId: 'assistant-1',
          role: 'assistant',
          presentedText: 'Answer',
          markdownBody: 'Answer\n\n',
          htmlBody: '<p>Answer</p>',
          diagnostics: { text: [], markdown: [], html: [] },
        },
      ],
    };
    await expect(
      dispatch({ action: 'publishTextPreview', sessionId: started.sessionId, payload })
    ).resolves.toEqual({ success: true });
    await expect(
      dispatch({
        action: 'captureChatGptConversation',
        conversationId,
        textPreviewCaptureId: started.sessionId,
      })
    ).resolves.toMatchObject({ success: false });
    const pageUrl = chrome.runtime.getURL(
      `src/text-preview/text-preview.html?session=${started.sessionId}`
    );
    const page = {
      id: chrome.runtime.id,
      frameId: 0,
      documentId: 'preview-document-1',
      url: pageUrl,
      tab: { id: 31, windowId: 30, url: pageUrl, status: 'complete' },
    } as chrome.runtime.MessageSender;
    await expect(
      dispatch({ action: 'takeTextPreviewPayload', sessionId: started.sessionId }, page)
    ).resolves.toMatchObject({ success: true, payload });
    await expect(
      dispatch({ action: 'takeTextPreviewPayload', sessionId: started.sessionId }, {
        ...page,
        tab: { ...page.tab, id: 32 },
      } as chrome.runtime.MessageSender)
    ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
  });

  it('cleans an owned stage from background authority when the source tab disappears', async () => {
    const started = (await dispatch(
      {
        action: 'startTextPreview',
        expectedTarget: { tabId: 7, route },
        branchMode: 'current',
      },
      popup()
    )) as { success: boolean; sessionId: string };
    const stageId = `archive-stage-${'A'.repeat(32)}`;
    await expect(
      dispatch({
        action: 'beginStagedArchiveArtifact',
        source: 'chatgpt',
        descriptor: {
          kind: 'raw',
          relativePath: 'responses/conversation.json',
          mediaType: 'application/json',
          byteLength: 2,
          sha256: 'a'.repeat(64),
        },
        textPreviewCaptureId: started.sessionId,
      })
    ).resolves.toEqual({ success: true, stageId });
    tabRemoved(7);
    await vi.waitFor(() =>
      expect(mocks.archive).toHaveBeenCalledWith({
        action: 'abortStagedArchiveArtifact',
        source: 'chatgpt',
        stageId,
      })
    );
  });
});
