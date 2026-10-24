import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDerivedBranchHtmlPersistResponse } from '../../src/lib/derived-branch-persistence-contract';
import { serializeSyncSettingsSnapshot } from '../../src/lib/sync-settings-snapshot';
import type { ExtensionSettings } from '../../src/lib/types';
import { branchHtmlMessage } from './derived-branch-html-fixture';
import { htmlMessage, htmlSettings } from './derived-html-fixture';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  branch: vi.fn(),
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
  handlePersistDerivedBranchHtmlPresentation: mocks.branch,
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
const rejected = () =>
  buildDerivedBranchHtmlPersistResponse({ state: 'not-dispatched' }, { state: 'not-dispatched' });

describe('branch HTML isolated authorized settings-stable route', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    current = htmlSettings();
    mocks.getSettings.mockImplementation(async () => structuredClone(current));
    mocks.saveSettings.mockResolvedValue(undefined);
    mocks.branch.mockResolvedValue(
      buildDerivedBranchHtmlPersistResponse({ state: 'confirmed' }, { state: 'confirmed' })
    );
    mocks.html.mockResolvedValue({ v1: true });
    vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation(value => {
      listener = value;
    });
    vi.resetModules();
    await import('../../src/background/service-worker');
  });

  it.each(['chatgpt', 'deepseek'] as const)(
    'routes exact top-frame %s branch requests only to the new handler',
    async source => {
      const message = await branchHtmlMessage(source);
      const result = await dispatch(message, sender(source === 'chatgpt' ? chatgpt : deepseek));
      expect(result).toEqual(
        buildDerivedBranchHtmlPersistResponse({ state: 'confirmed' }, { state: 'confirmed' })
      );
      expect(mocks.branch).toHaveBeenCalledExactlyOnceWith(message);
      expect(mocks.html).not.toHaveBeenCalled();
      expect(mocks.archive).not.toHaveBeenCalled();
      expect(mocks.markdown).not.toHaveBeenCalled();
    }
  );

  it('does not change the v1 route or response', async () => {
    const message = await htmlMessage();
    expect(await dispatch(message)).toEqual({ v1: true });
    expect(mocks.html).toHaveBeenCalledExactlyOnceWith(message);
    expect(mocks.branch).not.toHaveBeenCalled();
  });

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
  ])('rejects %s before settings or output dispatch', async (_name, from) => {
    expect(await dispatch(await branchHtmlMessage(), from as chrome.runtime.MessageSender)).toEqual(
      { success: false, error: 'Unauthorized' }
    );
    expect(mocks.branch).not.toHaveBeenCalled();
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it('rejects malformed branch envelopes before settings or output dispatch', async () => {
    expect(await dispatch({ ...(await branchHtmlMessage()), filename: 'private' })).toEqual({
      success: false,
      error: 'Invalid message content',
    });
    expect(mocks.branch).not.toHaveBeenCalled();
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it.each(['vault', 'template', 'file-disabled', 'html-disabled', 'image-toggle'])(
    'rejects %s drift with the closed not-dispatched pair',
    async mode => {
      const message = await branchHtmlMessage();
      if (mode === 'vault') current.vaultPath = 'private changed vault';
      if (mode === 'template') current.templateOptions.includeTitle = false;
      if (mode === 'file-disabled') current.outputOptions.file = false;
      if (mode === 'html-disabled') current.enableHtmlExport = false;
      if (mode === 'image-toggle') current.enableImageExport = !current.enableImageExport;
      expect(await dispatch(message)).toEqual(rejected());
      expect(mocks.branch).not.toHaveBeenCalled();
      expect(mocks.html).not.toHaveBeenCalled();
    }
  );

  it.each(['html-disabled', 'file-disabled'])('rejects matching snapshot with %s', async mode => {
    current.enableHtmlExport = mode !== 'html-disabled';
    current.outputOptions.file = mode !== 'file-disabled';
    const message = {
      ...(await branchHtmlMessage()),
      expectedSyncSettingsSnapshot: serializeSyncSettingsSnapshot(current),
    };
    expect(await dispatch(message)).toEqual(rejected());
    expect(mocks.branch).not.toHaveBeenCalled();
  });

  it('honors immediate File output override while storage is pending', async () => {
    mocks.saveSettings.mockImplementation(() => new Promise(() => undefined));
    listener(
      {
        action: 'updateOutputOptions',
        outputOptions: { file: false, obsidian: true, clipboard: true },
      },
      { id: chrome.runtime.id, url: chrome.runtime.getURL('src/popup/index.html') },
      vi.fn()
    );
    expect(await dispatch(await branchHtmlMessage())).toEqual(rejected());
    expect(mocks.branch).not.toHaveBeenCalled();
  });

  it('does not bind secret-only changes or route data to Obsidian/clipboard', async () => {
    current.obsidianApiKey = 'other-private-key';
    expect(await dispatch(await branchHtmlMessage())).toMatchObject({ success: true });
    expect(mocks.branch).toHaveBeenCalledOnce();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.markdown).not.toHaveBeenCalled();
  });

  it('runs the actual listener without evaluating a Proxy toJSON hook or reading caller properties', async () => {
    const original = await branchHtmlMessage();
    const expected = structuredClone(original);
    const toJSON = vi.fn(() => {
      original.captureId = 'capture-chatgpt-provider-private-value';
      return original;
    });
    const get = vi.fn((_value: object, key: string | symbol) =>
      key === 'toJSON' ? toJSON : 'provider-private-value'
    );
    expect(await dispatch(new Proxy(original, { get }))).toMatchObject({ success: true });
    expect(get).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
    expect(mocks.branch).toHaveBeenCalledExactlyOnceWith(expected);
    const dispatched = mocks.branch.mock.calls[0][0];
    expect(dispatched).not.toBe(original);
    expect(dispatched.artifact).not.toBe(original.artifact);
    expect(dispatched.outputs).not.toBe(original.outputs);
  });

  it('admits a valid branch with exactly one descriptor snapshot of every caller-owned value', async () => {
    const original = await branchHtmlMessage();
    const expected = structuredClone(original);
    const counts = {
      envelope: new Map<PropertyKey, number>(),
      artifact: new Map<PropertyKey, number>(),
      outputs: new Map<PropertyKey, number>(),
    };
    const get = vi.fn(() => {
      throw new Error('provider-private-value');
    });
    function once<T extends object>(value: T, reads: Map<PropertyKey, number>): T {
      return new Proxy(value, {
        get,
        getOwnPropertyDescriptor(target, key) {
          const count = (reads.get(key) ?? 0) + 1;
          reads.set(key, count);
          if (count > 1) throw new Error('provider-private-value');
          return Object.getOwnPropertyDescriptor(target, key);
        },
      });
    }
    const proxy = once(
      {
        ...original,
        artifact: once(original.artifact, counts.artifact),
        outputs: once(original.outputs, counts.outputs),
      },
      counts.envelope
    );
    expect(await dispatch(proxy)).toMatchObject({ success: true });
    expect(mocks.branch).toHaveBeenCalledExactlyOnceWith(expected);
    for (const reads of Object.values(counts)) {
      expect(reads.size).toBeGreaterThan(0);
      expect([...reads.values()].every(count => count === 1)).toBe(true);
    }
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects an action descriptor that changes from getSettings to branch after the failed entry snapshot', async () => {
    const original = await branchHtmlMessage();
    let actionDescriptors = 0;
    const proxy = new Proxy(original, {
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        if (key === 'action')
          return {
            ...descriptor,
            value:
              ++actionDescriptors === 1 ? 'getSettings' : 'persistDerivedBranchHtmlPresentation',
          };
        return descriptor;
      },
    });
    expect(await dispatch(proxy)).toEqual({ success: false, error: 'Invalid message content' });
    expect(mocks.getSettings).not.toHaveBeenCalled();
    expect(mocks.branch).not.toHaveBeenCalled();
    expect(chrome.downloads.download).not.toHaveBeenCalled();
  });

  it.each(['descriptor-flips-after-await', 'descriptor-stays-getSettings'] as const)(
    'cannot acquire branch authority through a stateful action (%s), including after settings await',
    async mode => {
      const original = await branchHtmlMessage();
      let afterAwait = false;
      let actionDescriptors = 0;
      let postAwaitActionReads = 0;
      const proxy = new Proxy(original, {
        get(target, key, receiver) {
          if (key === 'action') {
            if (afterAwait) {
              postAwaitActionReads += 1;
              // Hide from the post-await guard once, then expose branch at the final switch.
              if (mode === 'descriptor-stays-getSettings' && postAwaitActionReads === 1)
                return 'getSettings';
            }
            return 'persistDerivedBranchHtmlPresentation';
          }
          return Reflect.get(target, key, receiver);
        },
        getOwnPropertyDescriptor(target, key) {
          const descriptor = Object.getOwnPropertyDescriptor(target, key);
          if (key === 'action') {
            actionDescriptors += 1;
            return {
              ...descriptor,
              value:
                afterAwait && mode === 'descriptor-flips-after-await'
                  ? 'persistDerivedBranchHtmlPresentation'
                  : 'getSettings',
            };
          }
          return descriptor;
        },
      });
      let resolveSettings!: (settings: ExtensionSettings) => void;
      mocks.getSettings.mockImplementation(
        () =>
          new Promise(resolve => {
            resolveSettings = resolve;
          })
      );
      const respond = vi.fn();
      expect(listener(proxy, sender(), respond)).toBe(true);
      expect(actionDescriptors).toBeGreaterThan(0);
      expect(mocks.getSettings).toHaveBeenCalledOnce();
      expect(respond).not.toHaveBeenCalled();
      expect(mocks.branch).not.toHaveBeenCalled();
      original.captureId = 'capture-chatgpt-provider-private-value';
      original.conversationKey = 'provider-private-value';
      Object.assign(original.artifact, {
        relativePath: '../provider-private-value.html',
        bodyBase64: 'cHJvdmlkZXItcHJpdmF0ZS12YWx1ZQ==',
        byteLength: 22,
        ordinal: 2,
      });
      original.outputs[0] = 'obsidian' as 'file';
      afterAwait = true;
      resolveSettings(structuredClone(current));
      await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
      expect(respond.mock.calls[0][0]).toEqual({
        success: false,
        error: 'Invalid message content',
      });
      expect(JSON.stringify(respond.mock.calls[0][0])).not.toContain('provider-private-value');
      expect(mocks.branch).not.toHaveBeenCalled();
      expect(mocks.html).not.toHaveBeenCalled();
      expect(mocks.archive).not.toHaveBeenCalled();
      expect(mocks.markdown).not.toHaveBeenCalled();
      expect(chrome.downloads.download).not.toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
      if (mode === 'descriptor-stays-getSettings') expect(postAwaitActionReads).toBeGreaterThan(1);
    }
  );

  it('dispatches only the original detached identity/artifact/path after settings await and caller mutation', async () => {
    const handlers = await vi.importActual<typeof import('../../src/background/output-handlers')>(
      '../../src/background/output-handlers'
    );
    handlers.resetOffscreenStateForTesting();
    try {
      const original = await branchHtmlMessage();
      const expected = structuredClone(original);
      let resolveSettings!: (settings: ExtensionSettings) => void;
      mocks.getSettings.mockImplementation(
        () =>
          new Promise(resolve => {
            resolveSettings = resolve;
          })
      );
      mocks.branch.mockImplementation(handlers.handlePersistDerivedBranchHtmlPresentation);
      vi.mocked(chrome.runtime.getContexts).mockResolvedValue([]);
      vi.mocked(chrome.offscreen.createDocument).mockResolvedValue();
      vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (request: unknown) =>
        (request as { action: string }).action === 'archiveBlobCreate'
          ? { success: true, url: 'blob:chrome-extension://test/detached' }
          : { success: true }
      );
      const filenames = new Map<number, string>();
      vi.mocked(chrome.downloads.download).mockImplementation((options, callback) => {
        const id = filenames.size + 1;
        filenames.set(id, options.filename!);
        callback?.(id);
        return id as unknown as ReturnType<typeof chrome.downloads.download>;
      });
      vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) => [
        {
          id,
          state: 'complete',
          filename: `C:/Downloads/${filenames.get(id!)}`,
        } as chrome.downloads.DownloadItem,
      ]);
      const respond = vi.fn();
      expect(listener(original, sender(), respond)).toBe(true);
      expect(mocks.getSettings).toHaveBeenCalledOnce();
      expect(mocks.branch).not.toHaveBeenCalled();
      original.captureId = 'capture-chatgpt-provider-private-value';
      original.conversationKey = 'provider-private-value';
      Object.assign(original.artifact, {
        relativePath: 'provider-private-value.html',
        bodyBase64: 'cHJvdmlkZXItcHJpdmF0ZS12YWx1ZQ==',
        byteLength: 22,
        ordinal: 2,
      });
      original.outputs[0] = 'obsidian' as 'file';
      resolveSettings(structuredClone(current));
      await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
      expect(mocks.branch).toHaveBeenCalledExactlyOnceWith(expected);
      const dispatched = mocks.branch.mock.calls[0][0];
      expect(dispatched).not.toBe(original);
      expect(dispatched.artifact).not.toBe(original.artifact);
      expect(dispatched.outputs).not.toBe(original.outputs);
      const prefix = `_liska-archive/${expected.conversationKey}/${expected.captureId}/`;
      expect([...filenames.values()]).toEqual([
        `${prefix}branch-000001.html`,
        `${prefix}presentation/liska-html-1.branch-000001.receipt.json`,
      ]);
      const blobBodies = chrome.runtime.sendMessage.mock.calls
        .map(([request]) => request as { action: string; bodyBase64?: string })
        .filter(request => request.action === 'archiveBlobCreate');
      expect(blobBodies[0].bodyBase64).toBe(expected.artifact.bodyBase64);
      expect(JSON.stringify(blobBodies)).not.toContain('provider-private-value');
      expect(JSON.stringify([...filenames.values()])).not.toContain('provider-private-value');
      expect(respond.mock.calls[0][0]).toEqual(
        buildDerivedBranchHtmlPersistResponse({ state: 'confirmed' }, { state: 'confirmed' })
      );
      expect(JSON.stringify(respond.mock.calls[0][0])).not.toContain('provider-private-value');
      expect(chrome.downloads.download).toHaveBeenCalledTimes(2);
      expect(mocks.archive).not.toHaveBeenCalled();
      expect(mocks.markdown).not.toHaveBeenCalled();
    } finally {
      handlers.resetOffscreenStateForTesting();
    }
  });
});
