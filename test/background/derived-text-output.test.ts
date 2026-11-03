import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handlePersistDerivedTextPresentation,
  resetOffscreenStateForTesting,
} from '../../src/background/output-handlers';
import {
  buildDerivedTextOutputReceipt,
  buildDerivedTextOutputReceiptBytes,
} from '../../src/lib/derived-text-presentation-contract';
import { bytesToBase64 } from '../../src/lib/image-utils';
import { sha256Hex } from '../../src/lib/sha256';
import { textMessage } from './derived-text-fixture';

const mocks = vi.hoisted(() => ({ save: vi.fn(), archive: vi.fn() }));
vi.mock('../../src/background/obsidian-handlers', () => ({
  handleSave: mocks.save,
  handleSaveArchiveCompanion: mocks.archive,
}));

type Create = { action: string; bodyBase64: string; mediaType: string; url?: string };
const creations = (): Create[] =>
  vi
    .mocked(chrome.runtime.sendMessage)
    .mock.calls.map(([value]) => value as Create)
    .filter(value => value.action === 'archiveBlobCreate');

let filenames: Map<number, string>;

describe('derived text exact paired File delivery', () => {
  beforeEach(() => {
    resetOffscreenStateForTesting();
    vi.clearAllMocks();
    filenames = new Map();
    vi.mocked(chrome.runtime.getContexts).mockResolvedValue([]);
    vi.mocked(chrome.offscreen.createDocument).mockResolvedValue();
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (request: unknown) =>
      (request as Create).action === 'archiveBlobCreate'
        ? { success: true, url: `blob:chrome-extension://test/text-${creations().length}` }
        : { success: true }
    );
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
        filename: `C:\\Downloads\\${filenames.get(id!)?.replace(/\//g, '\\')}`,
      } as chrome.downloads.DownloadItem,
    ]);
  });

  afterEach(() => {
    resetOffscreenStateForTesting();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each(['chatgpt', 'deepseek'] as const)(
    'confirms exact %s .txt path then writes its deterministic receipt',
    async source => {
      const message = await textMessage(source);
      await expect(handlePersistDerivedTextPresentation(message)).resolves.toEqual({
        results: [{ destination: 'file', success: true, writeOutcome: { state: 'confirmed' } }],
        allSuccessful: true,
        anySuccessful: true,
      });
      const prefix = `_liska-archive/${message.conversationKey}/${message.captureId}/`;
      expect([...filenames.values()]).toEqual([
        `${prefix}index.txt`,
        `${prefix}presentation/liska-text-1.receipt.json`,
      ]);
      expect(creations()).toEqual([
        {
          action: 'archiveBlobCreate',
          target: 'offscreen',
          bodyBase64: message.artifact.bodyBase64,
          mediaType: 'text/plain',
        },
        {
          action: 'archiveBlobCreate',
          target: 'offscreen',
          bodyBase64: bytesToBase64(
            buildDerivedTextOutputReceiptBytes(
              buildDerivedTextOutputReceipt(
                {
                  source: message.source,
                  captureId: message.captureId,
                  conversationKey: message.conversationKey,
                },
                message.artifact
              )
            )
          ),
          mediaType: 'application/json',
        },
      ]);
      expect(JSON.stringify(vi.mocked(chrome.downloads.download).mock.calls)).not.toContain(
        'private synthetic'
      );
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.archive).not.toHaveBeenCalled();
    }
  );

  it('rejects altered bytes before any Blob or download', async () => {
    const message = await textMessage();
    message.artifact.sha256 = '0'.repeat(64);
    await expect(handlePersistDerivedTextPresentation(message)).resolves.toMatchObject({
      results: [
        {
          success: false,
          error: 'derived-text-integrity-verification-failed',
          writeOutcome: { state: 'not-dispatched' },
        },
      ],
    });
    expect(creations()).toHaveLength(0);
    expect(chrome.downloads.download).not.toHaveBeenCalled();
  });

  it('preserves an unknown terminal outcome and never writes or retries a receipt', async () => {
    vi.useFakeTimers();
    vi.mocked(chrome.downloads.search).mockResolvedValue([]);
    const pending = handlePersistDerivedTextPresentation(await textMessage());
    await vi.waitFor(() => expect(chrome.downloads.download).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(pending).resolves.toMatchObject({
      results: [
        {
          success: false,
          error: 'derived-text-download-unconfirmed',
          writeOutcome: { state: 'unknown' },
        },
      ],
    });
    expect(chrome.downloads.download).toHaveBeenCalledOnce();
    expect(creations()).toHaveLength(1);
  });
});
