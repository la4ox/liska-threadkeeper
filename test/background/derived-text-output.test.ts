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
const revocations = (): Create[] =>
  vi
    .mocked(chrome.runtime.sendMessage)
    .mock.calls.map(([value]) => value as Create)
    .filter(value => value.action === 'archiveBlobRevoke');

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

  it.each(['renamed', 'start-refused', 'blob-rejected'] as const)(
    'preserves confirmed TXT when its receipt is %s, without retrying either file',
    async mode => {
      const message = await textMessage();
      const prefix = `_liska-archive/${message.conversationKey}/${message.captureId}/`;
      const textPath = `${prefix}index.txt`;
      const receiptPath = `${prefix}presentation/liska-text-1.receipt.json`;
      if (mode === 'renamed')
        vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) => [
          {
            id,
            state: 'complete',
            filename: id === 1 ? `C:/Downloads/${textPath}` : 'C:/Downloads/renamed.json',
          } as chrome.downloads.DownloadItem,
        ]);
      if (mode === 'start-refused')
        vi.mocked(chrome.downloads.download).mockImplementation((options, callback) => {
          if (options.filename === textPath) {
            filenames.set(1, textPath);
            callback?.(1);
            return 1 as unknown as ReturnType<typeof chrome.downloads.download>;
          }
          callback?.(undefined);
          return undefined as unknown as ReturnType<typeof chrome.downloads.download>;
        });
      if (mode === 'blob-rejected')
        vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (request: unknown) => {
          const value = request as Create;
          if (value.action !== 'archiveBlobCreate') return { success: true };
          return value.mediaType === 'application/json'
            ? { success: false, error: 'private receipt creation detail' }
            : { success: true, url: 'blob:chrome-extension://test/text-1' };
        });

      const result = await handlePersistDerivedTextPresentation(message);
      expect(result).toEqual({
        results: [
          {
            destination: 'file',
            success: false,
            error: 'derived-text-receipt-unconfirmed',
            warning: 'Plain text may exist without a confirmed receipt; no retry was attempted.',
            writeOutcome: { state: 'confirmed' },
          },
        ],
        allSuccessful: false,
        anySuccessful: false,
      });
      expect(creations().map(value => value.mediaType)).toEqual(['text/plain', 'application/json']);
      expect(
        vi.mocked(chrome.downloads.download).mock.calls.map(([options]) => options.filename)
      ).toEqual(mode === 'blob-rejected' ? [textPath] : [textPath, receiptPath]);
      expect(revocations().map(value => value.url)).toEqual(
        mode === 'blob-rejected'
          ? ['blob:chrome-extension://test/text-1']
          : ['blob:chrome-extension://test/text-1', 'blob:chrome-extension://test/text-2']
      );
      expect(JSON.stringify(result)).not.toContain('private');
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.archive).not.toHaveBeenCalled();
    }
  );

  it('keeps confirmed TXT when the receipt never reaches terminal confirmation', async () => {
    const message = await textMessage();
    vi.useFakeTimers();
    vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) =>
      id === 1
        ? [
            {
              id,
              state: 'complete',
              filename: `C:/Downloads/${filenames.get(1)}`,
            } as chrome.downloads.DownloadItem,
          ]
        : []
    );
    const pending = handlePersistDerivedTextPresentation(message);
    await vi.waitFor(() => expect(chrome.downloads.download).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(pending).resolves.toMatchObject({
      results: [
        {
          success: false,
          error: 'derived-text-receipt-unconfirmed',
          writeOutcome: { state: 'confirmed' },
        },
      ],
      allSuccessful: false,
      anySuccessful: false,
    });
    expect(chrome.downloads.download).toHaveBeenCalledTimes(2);
    expect(creations()).toHaveLength(2);
    expect(revocations().map(value => value.url)).toEqual(['blob:chrome-extension://test/text-1']);
    expect(chrome.offscreen.closeDocument).not.toHaveBeenCalled();
  });

  it.each(['text/plain', 'application/json'])(
    'reports deferred %s Blob cleanup without losing confirmed paired delivery',
    async mediaType => {
      vi.useFakeTimers();
      const message = await textMessage();
      vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (request: unknown) => {
        const value = request as Create;
        if (value.action === 'archiveBlobCreate')
          return { success: true, url: `blob:chrome-extension://test/text-${creations().length}` };
        const url = mediaType === 'text/plain' ? 'text-1' : 'text-2';
        return { success: !value.url?.endsWith(url) };
      });
      await expect(handlePersistDerivedTextPresentation(message)).resolves.toEqual({
        results: [
          {
            destination: 'file',
            success: true,
            warning: 'archive-stage-cleanup-deferred',
            writeOutcome: { state: 'confirmed', cleanupDeferred: true },
          },
        ],
        allSuccessful: true,
        anySuccessful: true,
      });
      expect(chrome.downloads.download).toHaveBeenCalledTimes(2);
      expect(creations()).toHaveLength(2);
      expect(revocations()).toHaveLength(2);
    }
  );

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
