import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDerivedOutputReceipt,
  buildDerivedOutputReceiptBytes,
} from '../../src/lib/derived-presentation-contract';
import { bytesToBase64 } from '../../src/lib/image-utils';
import { sha256Hex } from '../../src/lib/sha256';
import {
  handlePersistDerivedHtmlPresentation,
  resetOffscreenStateForTesting,
} from '../../src/background/output-handlers';
import { htmlMessage } from './derived-html-fixture';

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
const revocations = () =>
  vi
    .mocked(chrome.runtime.sendMessage)
    .mock.calls.map(([value]) => value as Create)
    .filter(value => value.action === 'archiveBlobRevoke');
let onChanged: ((delta: chrome.downloads.DownloadDelta) => void) | undefined;
let filenames: Map<number, string>;

describe('derived HTML exact paired File delivery', () => {
  beforeEach(() => {
    resetOffscreenStateForTesting();
    vi.clearAllMocks();
    filenames = new Map();
    onChanged = undefined;
    vi.mocked(chrome.runtime.getContexts).mockResolvedValue([]);
    vi.mocked(chrome.offscreen.createDocument).mockResolvedValue();
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (request: unknown) => {
      const value = request as Create;
      return value.action === 'archiveBlobCreate'
        ? { success: true, url: `blob:chrome-extension://test/derived-${creations().length}` }
        : { success: true };
    });
    vi.mocked(chrome.downloads.onChanged.addListener).mockImplementation(listener => {
      onChanged = listener;
    });
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
    'persists verified %s HTML then deterministic receipt, using only opaque Blob metadata',
    async source => {
      const message = await htmlMessage(source);
      const result = await handlePersistDerivedHtmlPresentation(message);
      expect(result).toEqual({
        results: [{ destination: 'file', success: true, writeOutcome: { state: 'confirmed' } }],
        allSuccessful: true,
        anySuccessful: true,
      });
      const prefix = `_liska-archive/${message.conversationKey}/${message.captureId}/`;
      expect([...filenames.values()]).toEqual([
        `${prefix}index.html`,
        `${prefix}presentation/liska-html-1.receipt.json`,
      ]);
      expect(creations()).toEqual([
        {
          action: 'archiveBlobCreate',
          target: 'offscreen',
          bodyBase64: message.artifact.bodyBase64,
          mediaType: 'text/html',
        },
        {
          action: 'archiveBlobCreate',
          target: 'offscreen',
          bodyBase64: bytesToBase64(
            buildDerivedOutputReceiptBytes(
              buildDerivedOutputReceipt(
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
      const calls = vi.mocked(chrome.downloads.download).mock.calls;
      expect(calls).toHaveLength(2);
      expect(
        calls.every(
          ([options]) =>
            options.url.startsWith('blob:') &&
            options.saveAs === false &&
            options.conflictAction === 'uniquify'
        )
      ).toBe(true);
      expect(JSON.stringify(calls)).not.toContain('private synthetic');
      expect(JSON.stringify(result)).not.toContain('C:');
      expect(revocations().map(value => value.url)).toEqual([
        'blob:chrome-extension://test/derived-1',
        'blob:chrome-extension://test/derived-2',
      ]);
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.archive).not.toHaveBeenCalled();
      expect(
        vi
          .mocked(chrome.runtime.sendMessage)
          .mock.calls.some(([value]) => (value as Create).action === 'clipboardWrite')
      ).toBe(false);
    }
  );

  it.each(['hash', 'utf8', 'base64', 'length', 'noncanonical'])(
    'rejects %s before creating Blobs or downloads',
    async mode => {
      const message = await htmlMessage();
      if (mode === 'hash') message.artifact.sha256 = '0'.repeat(64);
      if (mode === 'utf8') {
        message.artifact.bodyBase64 = 'wA==';
        message.artifact.byteLength = 1;
        message.artifact.sha256 = await sha256Hex(new Uint8Array([192]));
      }
      if (mode === 'base64') message.artifact.bodyBase64 = 'not base64';
      if (mode === 'length') message.artifact.byteLength += 1;
      if (mode === 'noncanonical') {
        message.artifact.bodyBase64 = 'AB==';
        message.artifact.byteLength = 1;
      }
      expect(await handlePersistDerivedHtmlPresentation(message)).toEqual({
        results: [
          {
            destination: 'file',
            success: false,
            error: 'derived-html-integrity-verification-failed',
            writeOutcome: { state: 'not-dispatched' },
          },
        ],
        allSuccessful: false,
        anySuccessful: false,
      });
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
      expect(chrome.downloads.download).not.toHaveBeenCalled();
      expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
    }
  );

  it('fails closed without leaking a hash exception', async () => {
    const message = await htmlMessage();
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('private body or provider ID'));
    expect(await handlePersistDerivedHtmlPresentation(message)).toMatchObject({
      results: [
        {
          error: 'derived-html-integrity-verification-failed',
          writeOutcome: { state: 'not-dispatched' },
        },
      ],
    });
    expect(chrome.downloads.download).not.toHaveBeenCalled();
  });

  it.each([
    'mismatch',
    'unconfirmed-path',
    'interrupted',
    'start-refused',
    'blob-rejected',
    'setup-rejected',
  ])('does not create a receipt after HTML %s', async mode => {
    const message = await htmlMessage();
    if (mode === 'setup-rejected')
      vi.mocked(chrome.offscreen.createDocument).mockRejectedValue(
        new Error('private setup reason')
      );
    if (mode === 'blob-rejected')
      vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
        success: false,
        error: 'private setup reason',
      });
    if (mode === 'start-refused')
      vi.mocked(chrome.downloads.download).mockImplementation((_options, callback) => {
        callback?.(undefined);
        return undefined as unknown as ReturnType<typeof chrome.downloads.download>;
      });
    if (mode === 'mismatch')
      vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) => [
        {
          id,
          state: 'complete',
          filename: 'C:\\Downloads\\renamed.html',
        } as chrome.downloads.DownloadItem,
      ]);
    if (mode === 'unconfirmed-path')
      vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) => [
        { id, state: 'complete' } as chrome.downloads.DownloadItem,
      ]);
    if (mode === 'interrupted')
      vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) => [
        { id, state: 'interrupted' } as chrome.downloads.DownloadItem,
      ]);
    const result = await handlePersistDerivedHtmlPresentation(message);
    expect(result).toMatchObject({
      results: [
        {
          destination: 'file',
          success: false,
          error: 'derived-html-download-unconfirmed',
          writeOutcome: {
            state: ['setup-rejected', 'blob-rejected', 'start-refused'].includes(mode)
              ? 'not-dispatched'
              : 'unknown',
          },
        },
      ],
      allSuccessful: false,
      anySuccessful: false,
    });
    expect(creations().length).toBeLessThanOrEqual(1);
    expect([...filenames.values()].every(value => value.endsWith('/index.html'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it.each([
    'receipt-path-mismatch',
    'receipt-blob-failure',
    'receipt-start-refused',
    'receipt-encoding-failure',
  ])(
    'retains confirmed HTML fact and explicitly reports %s as partial without retries',
    async mode => {
      const message = await htmlMessage();
      if (mode === 'receipt-path-mismatch')
        vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) => [
          {
            id,
            state: 'complete',
            filename: id === 1 ? `C:/Downloads/${filenames.get(1)}` : 'C:/Downloads/renamed.json',
          } as chrome.downloads.DownloadItem,
        ]);
      if (mode === 'receipt-blob-failure')
        vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (request: unknown) =>
          (request as Create).action === 'archiveBlobCreate' &&
          (request as Create).mediaType === 'application/json'
            ? { success: false }
            : { success: true, url: 'blob:chrome-extension://test/html' }
        );
      if (mode === 'receipt-start-refused')
        vi.mocked(chrome.downloads.download).mockImplementation((options, callback) => {
          if (filenames.size === 0) {
            filenames.set(1, options.filename!);
            callback?.(1);
          } else callback?.(undefined);
          return 1 as unknown as ReturnType<typeof chrome.downloads.download>;
        });
      if (mode === 'receipt-encoding-failure') {
        const digest = crypto.subtle.digest.bind(crypto.subtle);
        let hashes = 0;
        vi.spyOn(crypto.subtle, 'digest').mockImplementation((...args) =>
          ++hashes === 1 ? digest(...args) : Promise.reject(new Error('private receipt failure'))
        );
      }
      const result = await handlePersistDerivedHtmlPresentation(message);
      expect(result).toEqual({
        results: [
          {
            destination: 'file',
            success: false,
            error: 'derived-html-receipt-unconfirmed',
            warning: 'HTML may exist without a confirmed receipt; no retry was attempted.',
            writeOutcome: { state: 'confirmed' },
          },
        ],
        allSuccessful: false,
        anySuccessful: false,
      });
      expect(chrome.downloads.download.mock.calls.length).toBeLessThanOrEqual(2);
      expect(creations().length).toBeLessThanOrEqual(2);
      expect(JSON.stringify(result)).not.toContain('private');
    }
  );

  it('preserves confirmed success when Blob cleanup is deferred', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (request: unknown) =>
      (request as Create).action === 'archiveBlobCreate'
        ? { success: true, url: `blob:chrome-extension://test/derived-${creations().length}` }
        : { success: false }
    );
    const result = await handlePersistDerivedHtmlPresentation(await htmlMessage());
    expect(result).toEqual({
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
  });

  it('does not even create receipt bytes before HTML terminal/path confirmation', async () => {
    const message = await htmlMessage();
    let complete = false;
    vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) => [
      {
        id,
        state: complete ? 'complete' : 'in_progress',
        filename: `C:/Downloads/${filenames.get(id!)}`,
      } as chrome.downloads.DownloadItem,
    ]);
    const pending = handlePersistDerivedHtmlPresentation(message);
    await vi.waitFor(() => expect(chrome.downloads.download).toHaveBeenCalledOnce());
    expect(creations()).toHaveLength(1);
    expect(creations()[0].mediaType).toBe('text/html');
    complete = true;
    onChanged?.({ id: 1, state: { current: 'complete' } } as chrome.downloads.DownloadDelta);
    expect(await pending).toMatchObject({ allSuccessful: true });
    expect(creations()).toHaveLength(2);
  });

  it('preserves HTML confirmation when receipt download never confirms, then late-cleans only that Blob', async () => {
    const message = await htmlMessage();
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
    const pending = handlePersistDerivedHtmlPresentation(message);
    await vi.waitFor(() => expect(chrome.downloads.download).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toMatchObject({
      results: [
        {
          success: false,
          error: 'derived-html-receipt-unconfirmed',
          warning: 'HTML may exist without a confirmed receipt; no retry was attempted.',
          writeOutcome: { state: 'confirmed' },
        },
      ],
    });
    expect(revocations().map(value => value.url)).toEqual([
      'blob:chrome-extension://test/derived-1',
    ]);
    expect(chrome.offscreen.closeDocument).not.toHaveBeenCalled();
    onChanged?.({ id: 2, state: { current: 'complete' } } as chrome.downloads.DownloadDelta);
    await vi.advanceTimersByTimeAsync(0);
    expect(revocations().map(value => value.url)).toEqual([
      'blob:chrome-extension://test/derived-1',
      'blob:chrome-extension://test/derived-2',
    ]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(chrome.offscreen.closeDocument).toHaveBeenCalledOnce();
    expect(chrome.downloads.download).toHaveBeenCalledTimes(2);
  });

  it('keeps HTML confirmation through late receipt Blob creation cleanup', async () => {
    const message = await htmlMessage();
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((request: unknown) => {
      const value = request as Create;
      if (value.action === 'archiveBlobCreate' && value.mediaType === 'application/json')
        return new Promise(resolve => {
          finish = resolve;
        });
      return Promise.resolve({ success: true, url: 'blob:chrome-extension://test/html' });
    });
    const pending = handlePersistDerivedHtmlPresentation(message);
    await vi.waitFor(() => expect(creations()).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({
      results: [
        {
          success: false,
          error: 'derived-html-receipt-unconfirmed',
          writeOutcome: { state: 'confirmed' },
        },
      ],
    });
    expect(chrome.offscreen.closeDocument).not.toHaveBeenCalled();
    finish({ success: true, url: 'blob:chrome-extension://test/late-receipt' });
    await vi.advanceTimersByTimeAsync(0);
    expect(revocations().map(value => value.url)).toEqual([
      'blob:chrome-extension://test/html',
      'blob:chrome-extension://test/late-receipt',
    ]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(chrome.offscreen.closeDocument).toHaveBeenCalledOnce();
    expect(chrome.downloads.download).toHaveBeenCalledOnce();
  });

  it('retains the offscreen lease for a late Blob response and revokes its exact URL', async () => {
    const message = await htmlMessage();
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((request: unknown) =>
      (request as Create).action === 'archiveBlobCreate'
        ? new Promise(resolve => {
            finish = resolve;
          })
        : Promise.resolve({ success: true })
    );
    const pending = handlePersistDerivedHtmlPresentation(message);
    await vi.waitFor(() => expect(creations()).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({
      results: [{ success: false, writeOutcome: { state: 'not-dispatched' } }],
    });
    expect(chrome.offscreen.closeDocument).not.toHaveBeenCalled();
    finish({ success: true, url: 'blob:chrome-extension://test/late-derived' });
    await vi.advanceTimersByTimeAsync(0);
    expect(revocations()).toEqual([
      {
        action: 'archiveBlobRevoke',
        target: 'offscreen',
        url: 'blob:chrome-extension://test/late-derived',
      },
    ]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(chrome.offscreen.closeDocument).toHaveBeenCalledOnce();
    expect(chrome.downloads.download).not.toHaveBeenCalled();
  });

  it('retains HTML Blob ownership until a late terminal download event, without writing a receipt', async () => {
    const message = await htmlMessage();
    vi.useFakeTimers();
    vi.mocked(chrome.downloads.search).mockResolvedValue([]);
    const pending = handlePersistDerivedHtmlPresentation(message);
    await vi.waitFor(() => expect(chrome.downloads.download).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toMatchObject({
      results: [{ success: false, writeOutcome: { state: 'unknown' } }],
    });
    expect(revocations()).toHaveLength(0);
    expect(chrome.offscreen.closeDocument).not.toHaveBeenCalled();
    onChanged?.({ id: 1, state: { current: 'complete' } } as chrome.downloads.DownloadDelta);
    await vi.advanceTimersByTimeAsync(0);
    expect(revocations()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(chrome.offscreen.closeDocument).toHaveBeenCalledOnce();
    expect(creations()).toHaveLength(1);
  });
});
