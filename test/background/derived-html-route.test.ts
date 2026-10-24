import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeSyncSettingsSnapshot } from '../../src/lib/sync-settings-snapshot';
import type { ExtensionSettings } from '../../src/lib/types';
import { htmlMessage, htmlSettings } from './derived-html-fixture';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  html: vi.fn(),
  archive: vi.fn(),
  markdown: vi.fn(),
}));
vi.mock('../../src/lib/storage', () => ({
  getSettings: mocks.getSettings,
  saveSettings: mocks.saveSettings,
  migrateSettings: async () => undefined,
}));
vi.mock('../../src/background/output-handlers', () => ({
  handlePersistDerivedHtmlPresentation: mocks.html,
  handlePersistArchiveCompanion: mocks.archive,
  handleMultiOutput: mocks.markdown,
}));
vi.mock('../../src/background/archive-stage-download-recovery', () => ({
  startArchiveStageDownloadRecovery: vi.fn(),
}));
vi.mock('../../src/background/binary-download-recovery', () => ({
  startStagedBinaryDownloadRecovery: vi.fn(),
}));

let listener: (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (response: unknown) => void
) => boolean | undefined;
let current: ExtensionSettings;
const chatgpt = 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd';
const deepseek = 'https://chat.deepseek.com/a/chat/s/synthetic';
function sender(url = chatgpt): chrome.runtime.MessageSender {
  return { tab: { url }, url, frameId: 0 } as chrome.runtime.MessageSender;
}
async function dispatch(message: unknown, from = sender()) {
  const respond = vi.fn();
  listener(message, from, respond);
  await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
  return respond.mock.calls[0][0];
}

describe('derived HTML authorized settings-stable route', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    current = htmlSettings();
    mocks.getSettings.mockImplementation(async () => structuredClone(current));
    mocks.saveSettings.mockResolvedValue(undefined);
    mocks.html.mockResolvedValue({
      results: [{ destination: 'file', success: true, writeOutcome: { state: 'confirmed' } }],
      allSuccessful: true,
      anySuccessful: true,
    });
    vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation(value => {
      listener = value;
    });
    vi.resetModules();
    await import('../../src/background/service-worker');
  });

  it.each(['chatgpt', 'deepseek'] as const)(
    'dispatches only exact top-frame %s requests',
    async source => {
      const message = await htmlMessage(source);
      expect(
        await dispatch(message, sender(source === 'chatgpt' ? chatgpt : deepseek))
      ).toMatchObject({ allSuccessful: true });
      expect(mocks.html).toHaveBeenCalledExactlyOnceWith(message);
      expect(mocks.archive).not.toHaveBeenCalled();
      expect(mocks.markdown).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['popup', { id: chrome.runtime.id, url: chrome.runtime.getURL('src/popup/index.html') }],
    ['subframe', { ...sender(), frameId: 1 }],
    ['no-document-url', { tab: { url: chatgpt }, frameId: 0 }],
    ['wrong-document-origin', { ...sender(), url: 'https://example.com/' }],
    ['provider-mismatch', sender(deepseek)],
    ['query', sender(`${chatgpt}?extra=1`)],
    ['hash', sender(`${chatgpt}#extra`)],
    ['non-conversation', sender('https://chatgpt.com/')],
    ['lookalike', sender('https://chatgpt.com.evil.test/c/01234567-89ab-4cde-8f01-23456789abcd')],
  ])('rejects %s sender before dispatch', async (_name, from) => {
    expect(await dispatch(await htmlMessage(), from as chrome.runtime.MessageSender)).toEqual({
      success: false,
      error: 'Unauthorized',
    });
    expect(mocks.html).not.toHaveBeenCalled();
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it.each(['vault', 'template', 'file-disabled', 'html-disabled', 'image-toggle'])(
    'rejects %s drift with a fixed not-dispatched result',
    async mode => {
      const message = await htmlMessage();
      if (mode === 'vault') current.vaultPath = 'private changed vault';
      if (mode === 'template') current.templateOptions.includeTitle = false;
      if (mode === 'file-disabled') current.outputOptions.file = false;
      if (mode === 'html-disabled') current.enableHtmlExport = false;
      if (mode === 'image-toggle') current.enableImageExport = !current.enableImageExport;
      const response = await dispatch(message);
      expect(response).toEqual({
        results: [
          {
            destination: 'file',
            success: false,
            error: 'settings-changed',
            writeOutcome: { state: 'not-dispatched' },
          },
        ],
        allSuccessful: false,
        anySuccessful: false,
      });
      expect(JSON.stringify(response)).not.toContain('private');
      expect(mocks.html).not.toHaveBeenCalled();
    }
  );

  it.each(['html-disabled', 'file-disabled'])('rejects matching snapshot when %s', async mode => {
    current.enableHtmlExport = mode !== 'html-disabled';
    current.outputOptions.file = mode !== 'file-disabled';
    const message = {
      ...(await htmlMessage()),
      expectedSyncSettingsSnapshot: serializeSyncSettingsSnapshot(current),
    };
    expect(await dispatch(message)).toMatchObject({
      results: [{ error: 'settings-changed', writeOutcome: { state: 'not-dispatched' } }],
    });
    expect(mocks.html).not.toHaveBeenCalled();
  });

  it('honors an immediate File toggle before storage completes', async () => {
    mocks.saveSettings.mockImplementation(() => new Promise(() => undefined));
    listener(
      {
        action: 'updateOutputOptions',
        outputOptions: { file: false, obsidian: true, clipboard: true },
      },
      { id: chrome.runtime.id, url: chrome.runtime.getURL('src/popup/index.html') },
      vi.fn()
    );
    expect(await dispatch(await htmlMessage())).toMatchObject({
      results: [{ error: 'settings-changed' }],
    });
    expect(mocks.html).not.toHaveBeenCalled();
  });

  it('does not bind secret-only changes to the snapshot', async () => {
    current.obsidianApiKey = 'other-private-key';
    expect(await dispatch(await htmlMessage())).toMatchObject({ allSuccessful: true });
    expect(mocks.html).toHaveBeenCalledOnce();
  });
});
