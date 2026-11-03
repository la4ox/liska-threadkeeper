import { AdmittedExportController } from './admitted-export-controller';
vi.mock('../../src/background/export-operation-controller', () => ({
  ExportOperationController: AdmittedExportController,
}));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionSettings } from '../../src/lib/types';
import { textMessage, textSettings } from './derived-text-fixture';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  text: vi.fn(),
  html: vi.fn(),
  branchHtml: vi.fn(),
  archive: vi.fn(),
  markdown: vi.fn(),
}));

vi.mock('../../src/lib/storage', () => ({
  getSettings: mocks.getSettings,
  saveSettings: mocks.saveSettings,
  migrateSettings: async () => undefined,
}));
vi.mock('../../src/background/output-handlers', () => ({
  handlePersistDerivedTextPresentation: mocks.text,
  handlePersistDerivedHtmlPresentation: mocks.html,
  handlePersistDerivedBranchHtmlPresentation: mocks.branchHtml,
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

async function dispatch(message: unknown, url = chatgpt) {
  const respond = vi.fn();
  listener(message, { tab: { url }, url, frameId: 0 } as chrome.runtime.MessageSender, respond);
  await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
  return respond.mock.calls[0][0];
}

describe('derived text authorized settings-stable route', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    current = textSettings();
    mocks.getSettings.mockImplementation(async () => structuredClone(current));
    mocks.saveSettings.mockResolvedValue(undefined);
    mocks.text.mockResolvedValue({
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

  it('dispatches the exact top-frame provider request only to text persistence', async () => {
    const message = await textMessage();
    await expect(dispatch(message)).resolves.toMatchObject({ allSuccessful: true });
    expect(mocks.text).toHaveBeenCalledExactlyOnceWith(message);
    expect(mocks.html).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.markdown).not.toHaveBeenCalled();
  });

  it.each([
    ['subframe', { tab: { url: chatgpt }, url: chatgpt, frameId: 1 }],
    [
      'wrong origin',
      { tab: { url: 'https://example.com/' }, url: 'https://example.com/', frameId: 0 },
    ],
  ])('rejects %s before settings or persistence', async (_name, sender) => {
    const respond = vi.fn();
    listener(await textMessage(), sender as chrome.runtime.MessageSender, respond);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
    expect(respond.mock.calls[0][0]).toEqual({ success: false, error: 'Unauthorized' });
    expect(mocks.text).not.toHaveBeenCalled();
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it.each(['text-disabled', 'file-disabled', 'snapshot-drift'])(
    'rejects %s with a not-dispatched receipt',
    async mode => {
      if (mode === 'text-disabled') current.enableTextExport = false;
      if (mode === 'file-disabled') current.outputOptions.file = false;
      if (mode === 'snapshot-drift') current.enableImageExport = !current.enableImageExport;
      await expect(dispatch(await textMessage())).resolves.toMatchObject({
        results: [{ error: 'settings-changed', writeOutcome: { state: 'not-dispatched' } }],
      });
      expect(mocks.text).not.toHaveBeenCalled();
    }
  );
});
