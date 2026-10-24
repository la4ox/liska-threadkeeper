import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDerivedBranchOutputReceipt,
  buildDerivedBranchOutputReceiptBytes,
  DERIVED_BRANCH_HTML_MAX_ORDINAL,
  deriveBranchHtmlReceiptRelativePath,
  matchDerivedBranchOutputReceipt,
} from '../../src/lib/derived-branch-presentation-contract';
import {
  buildDerivedBranchHtmlPersistResponse,
  isDerivedBranchHtmlPersistResponse,
} from '../../src/lib/derived-branch-persistence-contract';
import { base64ToBytes, bytesToBase64 } from '../../src/lib/image-utils';
import { sha256Hex } from '../../src/lib/sha256';
import type { DurableWriteState } from '../../src/lib/types';
import * as writeLedger from '../../src/lib/operation-write-ledger';
import {
  handlePersistDerivedBranchHtmlPresentation,
  resetOffscreenStateForTesting,
} from '../../src/background/output-handlers';
import { branchHtmlMessage } from './derived-branch-html-fixture';

const mocks = vi.hoisted(() => ({ save: vi.fn(), archive: vi.fn() }));
vi.mock('../../src/background/obsidian-handlers', () => ({
  handleSave: mocks.save,
  handleSaveArchiveCompanion: mocks.archive,
}));
type Create = { action: string; bodyBase64: string; mediaType: string; url?: string };
const requests = (action: string) =>
  vi
    .mocked(chrome.runtime.sendMessage)
    .mock.calls.map(([value]) => value as Create)
    .filter(value => value.action === action);
const creations = () => requests('archiveBlobCreate');
const revocations = () => requests('archiveBlobRevoke').map(value => value.url);
const pair = (
  html: DurableWriteState,
  receipt: DurableWriteState,
  htmlCleanup = false,
  receiptCleanup = false
) =>
  buildDerivedBranchHtmlPersistResponse(
    { state: html, ...(htmlCleanup && { cleanupDeferred: true }) },
    { state: receipt, ...(receiptCleanup && { cleanupDeferred: true }) }
  );
let onChanged: ((delta: chrome.downloads.DownloadDelta) => void) | undefined;
let filenames: Map<number, string>;
function item(
  id: number | undefined,
  state: chrome.downloads.DownloadState = 'complete',
  filename?: string
) {
  return {
    id,
    state,
    filename: filename ?? `C:/Downloads/${filenames.get(id!)}`,
  } as chrome.downloads.DownloadItem;
}
function terminal(id: number, state: 'complete' | 'interrupted' = 'complete') {
  onChanged?.({ id, state: { current: state } } as chrome.downloads.DownloadDelta);
}

describe('one branch HTML paired File persistence', () => {
  beforeEach(() => {
    resetOffscreenStateForTesting();
    vi.clearAllMocks();
    filenames = new Map();
    onChanged = undefined;
    vi.mocked(chrome.runtime.getContexts).mockResolvedValue([]);
    vi.mocked(chrome.offscreen.createDocument).mockResolvedValue();
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (request: unknown) =>
      (request as Create).action === 'archiveBlobCreate'
        ? { success: true, url: `blob:chrome-extension://test/branch-${creations().length}` }
        : { success: true }
    );
    vi.mocked(chrome.downloads.onChanged.addListener).mockImplementation(listener => {
      onChanged = listener;
    });
    vi.mocked(chrome.downloads.download).mockImplementation((options, callback) => {
      const id = filenames.size + 1;
      filenames.set(id, options.filename!);
      callback?.(id);
      return id as unknown as ReturnType<typeof chrome.downloads.download>;
    });
    vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) => [item(id)]);
  });
  afterEach(() => {
    resetOffscreenStateForTesting();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  for (const source of ['chatgpt', 'deepseek'] as const) {
    it.each([
      { role: 'leaf', ordinal: 1 },
      { role: 'leaf', ordinal: DERIVED_BRANCH_HTML_MAX_ORDINAL },
      { role: 'index' },
    ] as const)(`persists verified ${source} %s and a locally matching receipt`, async target => {
      const message = await branchHtmlMessage(source, target);
      const result = await handlePersistDerivedBranchHtmlPresentation(message);
      expect(result).toEqual(pair('confirmed', 'confirmed'));
      const prefix = `_liska-archive/${message.conversationKey}/${message.captureId}/`;
      expect([...filenames.values()]).toEqual([
        `${prefix}${message.artifact.relativePath}`,
        `${prefix}${deriveBranchHtmlReceiptRelativePath(target)}`,
      ]);
      const receiptBytes = buildDerivedBranchOutputReceiptBytes(
        buildDerivedBranchOutputReceipt(
          { source, captureId: message.captureId, conversationKey: message.conversationKey },
          message.artifact
        )
      );
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
          bodyBase64: bytesToBase64(receiptBytes),
          mediaType: 'application/json',
        },
      ]);
      const receiptText = new TextDecoder().decode(base64ToBytes(creations()[1].bodyBase64));
      expect(receiptText.endsWith('\n')).toBe(true);
      expect(
        matchDerivedBranchOutputReceipt(
          JSON.parse(receiptText),
          { source, captureId: message.captureId, conversationKey: message.conversationKey },
          message.artifact
        )
      ).toBeDefined();
      expect(chrome.downloads.download).toHaveBeenCalledTimes(2);
      expect(
        chrome.downloads.download.mock.calls.every(
          ([options]) =>
            options.url.startsWith('blob:') &&
            options.saveAs === false &&
            options.conflictAction === 'uniquify'
        )
      ).toBe(true);
      expect(revocations()).toEqual([
        'blob:chrome-extension://test/branch-1',
        'blob:chrome-extension://test/branch-2',
      ]);
      expect(JSON.stringify(chrome.downloads.download.mock.calls)).not.toContain(
        'private synthetic'
      );
      expect(JSON.stringify(result)).not.toMatch(/private|capture-|Downloads|synthetic/);
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.archive).not.toHaveBeenCalled();
      expect(requests('clipboardWrite')).toHaveLength(0);
    });
  }

  it.each(['hash', 'utf8', 'base64', 'length', 'noncanonical', 'hash-exception', 'v1'])(
    `rejects %s integrity before Blob setup`,
    async mode => {
      const message = await branchHtmlMessage();
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
      if (mode === 'v1')
        Object.assign(message.artifact, {
          schema: 'liska-derived-html/1',
          relativePath: 'index.html',
        });
      if (mode === 'hash-exception')
        vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('private hash error'));
      expect(await handlePersistDerivedBranchHtmlPresentation(message)).toEqual(
        pair('not-dispatched', 'not-dispatched')
      );
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
      expect(chrome.downloads.download).not.toHaveBeenCalled();
      expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
    }
  );

  it('keeps one identity and verified artifact snapshot through asynchronous hashing', async () => {
    const message = await branchHtmlMessage();
    const identity = {
      source: message.source,
      captureId: message.captureId,
      conversationKey: message.conversationKey,
    };
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'digest').mockImplementation((...args) => {
      message.captureId = 'provider-private-id';
      message.conversationKey = '../private';
      Object.assign(message.artifact, { relativePath: '../private.html', ordinal: 2 });
      return digest(...args);
    });
    expect(await handlePersistDerivedBranchHtmlPresentation(message)).toEqual(
      pair('confirmed', 'confirmed')
    );
    const prefix = `_liska-archive/${identity.conversationKey}/${identity.captureId}/`;
    expect([...filenames.values()]).toEqual([
      `${prefix}branch-000001.html`,
      `${prefix}presentation/liska-html-1.branch-000001.receipt.json`,
    ]);
    const receipt = JSON.parse(new TextDecoder().decode(base64ToBytes(creations()[1].bodyBase64)));
    expect(receipt).toMatchObject({ ...identity, artifact: { ordinal: 1 } });
  });

  it.each([
    'setup',
    'blob',
    'start',
    'start-throw',
    'interrupted',
    'missing-path',
    'renamed-path',
    'uniquified-path',
    'path-search-failure',
  ])(`does not dispatch a receipt after HTML %s`, async mode => {
    const message = await branchHtmlMessage();
    if (mode === 'setup')
      vi.mocked(chrome.offscreen.createDocument).mockRejectedValue(new Error('private setup'));
    if (mode === 'blob')
      vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: false });
    if (mode === 'start')
      vi.mocked(chrome.downloads.download).mockImplementation((_options, callback) => {
        callback?.(undefined);
        return undefined as unknown as ReturnType<typeof chrome.downloads.download>;
      });
    if (mode === 'start-throw')
      vi.mocked(chrome.downloads.download).mockImplementation(() => {
        throw new Error('private start');
      });
    if (mode === 'interrupted')
      vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) => [
        item(id, 'interrupted'),
      ]);
    if (mode === 'missing-path')
      vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) => [
        { id, state: 'complete' } as chrome.downloads.DownloadItem,
      ]);
    if (mode === 'renamed-path' || mode === 'uniquified-path')
      vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) => [
        item(
          id,
          'complete',
          mode === 'renamed-path'
            ? 'C:/Downloads/provider-title.html'
            : `C:/Downloads/${filenames.get(id!)?.replace('.html', ' (1).html')}`
        ),
      ]);
    if (mode === 'path-search-failure') {
      let searches = 0;
      vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) => {
        if (++searches > 1) throw new Error('private lookup');
        return [item(id)];
      });
    }
    const expected = ['setup', 'blob', 'start'].includes(mode) ? 'not-dispatched' : 'unknown';
    const result = await handlePersistDerivedBranchHtmlPresentation(message);
    expect(result).toEqual(pair(expected, 'not-dispatched'));
    expect(isDerivedBranchHtmlPersistResponse(result)).toBe(true);
    expect(creations().length).toBeLessThanOrEqual(1);
    expect(chrome.downloads.download.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it.each([
    'encoding',
    'hash-mismatch',
    'base64',
    'setup',
    'blob',
    'start',
    'interrupted',
    'path-mismatch',
  ])(`preserves HTML confirmation independently after receipt %s`, async mode => {
    const message = await branchHtmlMessage();
    if (mode === 'encoding' || mode === 'hash-mismatch') {
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      let hashes = 0;
      vi.spyOn(crypto.subtle, 'digest').mockImplementation((...args) => {
        hashes += 1;
        if (mode === 'encoding' && hashes === 2)
          return Promise.reject(new Error('private receipt error'));
        if (mode === 'hash-mismatch' && hashes === 3)
          return Promise.resolve(new Uint8Array(32).buffer);
        return digest(...args);
      });
    }
    if (mode === 'base64') vi.spyOn(globalThis, 'btoa').mockReturnValue('AB==');
    if (mode === 'setup')
      vi.mocked(chrome.offscreen.createDocument)
        .mockResolvedValueOnce()
        .mockRejectedValue(new Error('private setup'));
    if (mode === 'blob')
      vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (request: unknown) =>
        (request as Create).action === 'archiveBlobCreate' &&
        (request as Create).mediaType === 'application/json'
          ? { success: false }
          : { success: true, url: 'blob:chrome-extension://test/html' }
      );
    if (mode === 'start')
      vi.mocked(chrome.downloads.download).mockImplementation((options, callback) => {
        if (filenames.size === 0) {
          filenames.set(1, options.filename!);
          callback?.(1);
        } else callback?.(undefined);
        return 1 as unknown as ReturnType<typeof chrome.downloads.download>;
      });
    if (mode === 'interrupted' || mode === 'path-mismatch')
      vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) => [
        item(
          id,
          id === 2 && mode === 'interrupted' ? 'interrupted' : 'complete',
          id === 2 && mode === 'path-mismatch' ? 'C:/Downloads/renamed.json' : undefined
        ),
      ]);
    const receipt = ['interrupted', 'path-mismatch'].includes(mode) ? 'unknown' : 'not-dispatched';
    const result = await handlePersistDerivedBranchHtmlPresentation(message);
    expect(result).toEqual(pair('confirmed', receipt));
    expect(JSON.stringify(result)).not.toContain('private');
    expect(chrome.downloads.download.mock.calls.length).toBeLessThanOrEqual(2);
    expect(creations().length).toBeLessThanOrEqual(2);
  });

  it.each(['html', 'receipt'] as const)(
    'keeps cleanupDeferred only on the affected %s outcome',
    async failure => {
      vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (request: unknown) =>
        (request as Create).action === 'archiveBlobCreate'
          ? { success: true, url: `blob:chrome-extension://test/branch-${creations().length}` }
          : {
              success:
                (request as Create).url !==
                `blob:chrome-extension://test/branch-${failure === 'html' ? 1 : 2}`,
            }
      );
      expect(await handlePersistDerivedBranchHtmlPresentation(await branchHtmlMessage())).toEqual(
        pair('confirmed', 'confirmed', failure === 'html', failure === 'receipt')
      );
      expect(chrome.downloads.download).toHaveBeenCalledTimes(2);
    }
  );

  it.each(['html', 'receipt'] as const)(
    'retains independent cleanupDeferred on an unknown %s path outcome',
    async failure => {
      vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (request: unknown) =>
        (request as Create).action === 'archiveBlobCreate'
          ? { success: true, url: `blob:chrome-extension://test/branch-${creations().length}` }
          : { success: false }
      );
      vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) => [
        item(id, 'complete', id === (failure === 'html' ? 1 : 2) ? 'C:/renamed.html' : undefined),
      ]);
      expect(await handlePersistDerivedBranchHtmlPresentation(await branchHtmlMessage())).toEqual(
        failure === 'html'
          ? pair('unknown', 'not-dispatched', true)
          : pair('confirmed', 'unknown', true, true)
      );
    }
  );

  it('does not create receipt bytes before HTML terminal/path confirmation', async () => {
    const message = await branchHtmlMessage();
    let complete = false;
    vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) => [
      item(id, complete ? 'complete' : 'in_progress'),
    ]);
    const pending = handlePersistDerivedBranchHtmlPresentation(message);
    await vi.waitFor(() => expect(chrome.downloads.download).toHaveBeenCalledOnce());
    expect(creations()).toHaveLength(1);
    complete = true;
    terminal(1);
    expect(await pending).toEqual(pair('confirmed', 'confirmed'));
  });

  it.each(['html', 'receipt'] as const)(
    'treats malformed %s sink evidence after dispatch as unknown, without retry',
    async malformed => {
      const original = writeLedger.durableWriteOutcomeFromResult;
      let observations = 0;
      vi.spyOn(writeLedger, 'durableWriteOutcomeFromResult').mockImplementation(value => {
        observations += 1;
        return observations === (malformed === 'html' ? 1 : 2) ? undefined : original(value);
      });
      const result = await handlePersistDerivedBranchHtmlPresentation(await branchHtmlMessage());
      expect(result).toEqual(
        malformed === 'html' ? pair('unknown', 'not-dispatched') : pair('confirmed', 'unknown')
      );
      expect(chrome.downloads.download).toHaveBeenCalledTimes(malformed === 'html' ? 1 : 2);
      expect(creations()).toHaveLength(malformed === 'html' ? 1 : 2);
    }
  );

  it.each(['html', 'receipt'] as const)(
    'keeps %s Blob ownership after timeout; late terminal cannot authorize retry or receipt',
    async timeout => {
      const message = await branchHtmlMessage();
      vi.useFakeTimers();
      vi.mocked(chrome.downloads.search).mockImplementation(async ({ id }) =>
        timeout === 'receipt' && id === 1 ? [item(id)] : []
      );
      const pending = handlePersistDerivedBranchHtmlPresentation(message);
      const count = timeout === 'html' ? 1 : 2;
      await vi.waitFor(() => expect(chrome.downloads.download).toHaveBeenCalledTimes(count));
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await pending;
      expect(result).toEqual(
        pair(
          timeout === 'html' ? 'unknown' : 'confirmed',
          timeout === 'html' ? 'not-dispatched' : 'unknown'
        )
      );
      expect(revocations()).toHaveLength(count - 1);
      expect(chrome.offscreen.closeDocument).not.toHaveBeenCalled();
      terminal(count);
      await vi.advanceTimersByTimeAsync(0);
      expect(revocations()).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(5000);
      expect(chrome.offscreen.closeDocument).toHaveBeenCalledOnce();
      expect(chrome.downloads.download).toHaveBeenCalledTimes(count);
      expect(await pending).toEqual(result);
    }
  );

  it.each(['html', 'receipt'] as const)(
    'late %s Blob creation cleans only its own URL without a download retry',
    async late => {
      const message = await branchHtmlMessage();
      vi.useFakeTimers();
      let finish!: (value: unknown) => void;
      vi.mocked(chrome.runtime.sendMessage).mockImplementation((request: unknown) => {
        const value = request as Create;
        if (
          value.action === 'archiveBlobCreate' &&
          value.mediaType === (late === 'html' ? 'text/html' : 'application/json')
        )
          return new Promise(resolve => {
            finish = resolve;
          });
        return Promise.resolve({ success: true, url: 'blob:chrome-extension://test/html' });
      });
      const pending = handlePersistDerivedBranchHtmlPresentation(message);
      await vi.waitFor(() => expect(creations()).toHaveLength(late === 'html' ? 1 : 2));
      await vi.advanceTimersByTimeAsync(5000);
      expect(await pending).toEqual(
        pair(late === 'html' ? 'not-dispatched' : 'confirmed', 'not-dispatched')
      );
      expect(chrome.offscreen.closeDocument).not.toHaveBeenCalled();
      finish({ success: true, url: 'blob:chrome-extension://test/late' });
      await vi.advanceTimersByTimeAsync(0);
      expect(revocations()).toContain('blob:chrome-extension://test/late');
      await vi.advanceTimersByTimeAsync(5000);
      expect(chrome.offscreen.closeDocument).toHaveBeenCalledOnce();
      expect(chrome.downloads.download).toHaveBeenCalledTimes(late === 'html' ? 0 : 1);
    }
  );

  it('handles terminal event before callback without double-writing or double-cleaning', async () => {
    vi.mocked(chrome.downloads.download).mockImplementation((options, callback) => {
      const id = filenames.size + 1;
      filenames.set(id, options.filename!);
      terminal(id);
      callback?.(id);
      terminal(id);
      return id as unknown as ReturnType<typeof chrome.downloads.download>;
    });
    expect(await handlePersistDerivedBranchHtmlPresentation(await branchHtmlMessage())).toEqual(
      pair('confirmed', 'confirmed')
    );
    expect(chrome.downloads.download).toHaveBeenCalledTimes(2);
    expect(revocations()).toHaveLength(2);
  });

  it('observes late callback ownership after timeout without dispatching a receipt', async () => {
    const message = await branchHtmlMessage();
    vi.useFakeTimers();
    let callback: ((downloadId: number) => void) | undefined;
    vi.mocked(chrome.downloads.download).mockImplementation((options, cb) => {
      filenames.set(1, options.filename!);
      callback = cb;
      return 1 as unknown as ReturnType<typeof chrome.downloads.download>;
    });
    const pending = handlePersistDerivedBranchHtmlPresentation(message);
    await vi.waitFor(() => expect(chrome.downloads.download).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toEqual(pair('unknown', 'not-dispatched'));
    expect(revocations()).toHaveLength(0);
    callback?.(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(revocations()).toHaveLength(1);
    expect(chrome.downloads.download).toHaveBeenCalledOnce();
    expect(creations()).toHaveLength(1);
  });
});
