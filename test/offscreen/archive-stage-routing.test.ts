import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARCHIVE_STAGE_CHUNK_BYTES,
  ARCHIVE_STAGE_RELATIVE_PATHS,
  type ArchiveStageDescriptor,
} from '../../src/lib/archive-stage-contract';
import { bytesToBase64 } from '../../src/lib/image-utils';
import type { ArchiveStageStore } from '../../src/offscreen/archive-stage-store';

let capturedListener: (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean | undefined;
let offscreenModule: typeof import('../../src/offscreen/offscreen');

const stageId = `archive-stage-${'A'.repeat(32)}`;
const descriptor: ArchiveStageDescriptor = {
  kind: 'raw',
  mediaType: 'application/json',
  relativePath: ARCHIVE_STAGE_RELATIVE_PATHS.raw,
  byteLength: 2,
  sha256: 'a'.repeat(64),
};

function sender(): chrome.runtime.MessageSender {
  return { id: chrome.runtime.id } as chrome.runtime.MessageSender;
}

function fakeStore(): ArchiveStageStore {
  return {
    begin: vi.fn(),
    append: vi.fn(),
    seal: vi.fn(),
    openSealed: vi.fn(async () => new File([new Uint8Array([0, 255])], 'synthetic.json')),
    read: vi.fn(async () => new Uint8Array([0, 255])),
    abort: vi.fn(),
    pruneStale: vi.fn(),
  };
}

async function invoke(message: unknown): Promise<unknown> {
  return new Promise(resolve => {
    expect(capturedListener(message, sender(), resolve)).toBe(true);
  });
}

describe('offscreen archive-stage routing', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ background: { service_worker: 'service-worker-loader.js' } }))
    );
    vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation(listener => {
      capturedListener = listener;
    });
    vi.resetModules();
    offscreenModule = await import('../../src/offscreen/offscreen');
  });

  afterEach(() => vi.restoreAllMocks());

  it('accepts only the extension background sender with no tab', () => {
    const response = vi.fn();
    const message = { action: 'archiveStageAbort', target: 'offscreen', stageId };

    expect(
      capturedListener(
        message,
        { id: chrome.runtime.id, tab: {} as chrome.tabs.Tab } as chrome.runtime.MessageSender,
        response
      )
    ).toBe(false);
    expect(
      capturedListener(message, { id: 'other' } as chrome.runtime.MessageSender, response)
    ).toBe(false);
    expect(
      capturedListener(
        message,
        { id: chrome.runtime.id, documentId: 'popup-document' } as chrome.runtime.MessageSender,
        response
      )
    ).toBe(false);
    expect(response).not.toHaveBeenCalled();
  });

  it('accepts only the exact manifest service-worker URL when MV3 supplies sender.url', async () => {
    const original = Object.getOwnPropertyDescriptor(chrome.runtime, 'getManifest');
    Object.defineProperty(chrome.runtime, 'getManifest', {
      configurable: true,
      value: undefined,
    });
    try {
      const store = fakeStore();
      offscreenModule.setArchiveStageStoreForTesting(store);
      const response = await new Promise(resolve => {
        expect(
          capturedListener(
            { action: 'archiveStageAbort', target: 'offscreen', stageId },
            {
              id: chrome.runtime.id,
              url: chrome.runtime.getURL('service-worker-loader.js'),
            } as chrome.runtime.MessageSender,
            resolve
          )
        ).toBe(true);
      });
      expect(response).toEqual({ success: true });
      expect(store.abort).toHaveBeenCalledWith(stageId);
      expect(fetch).toHaveBeenCalledWith(
        chrome.runtime.getURL('manifest.json'),
        expect.objectContaining({ credentials: 'omit', redirect: 'error' })
      );
    } finally {
      if (original) Object.defineProperty(chrome.runtime, 'getManifest', original);
      else delete (chrome.runtime as { getManifest?: unknown }).getManifest;
    }
  });

  it.each([
    [{ tab: {} }, 'offscreen-sender-tab'],
    [{ documentId: 'synthetic-document' }, 'offscreen-sender-document'],
  ] as const)(
    'reports a value-free begin rejection without accessing storage: %s',
    (fields, error) => {
      const store = fakeStore();
      offscreenModule.setArchiveStageStoreForTesting(store);
      const response = vi.fn();
      expect(
        capturedListener(
          { action: 'archiveStageBegin', target: 'offscreen', stageId, descriptor },
          { id: chrome.runtime.id, ...fields } as chrome.runtime.MessageSender,
          response
        )
      ).toBe(false);
      expect(response).toHaveBeenCalledWith({ success: false, error });
      expect(store.begin).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it.each(['src/popup/index.html', 'src/offscreen/offscreen.html', 'service-worker-loader.js?x=1'])(
    'rejects a non-worker URL after package-local lookup: %s',
    async path => {
      const store = fakeStore();
      offscreenModule.setArchiveStageStoreForTesting(store);
      const response = await new Promise(resolve => {
        expect(
          capturedListener(
            { action: 'archiveStageBegin', target: 'offscreen', stageId, descriptor },
            { id: chrome.runtime.id, url: chrome.runtime.getURL(path) },
            resolve
          )
        ).toBe(true);
      });
      expect(response).toEqual({ success: false, error: 'offscreen-sender-url' });
      expect(store.begin).not.toHaveBeenCalled();
    }
  );

  it('keeps the message channel open but does not touch OPFS before sender verification', async () => {
    let finishManifest!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise(resolve => {
          finishManifest = resolve;
        })
    );
    const store = fakeStore();
    offscreenModule.setArchiveStageStoreForTesting(store);
    const response = new Promise(resolve => {
      expect(
        capturedListener(
          { action: 'archiveStageBegin', target: 'offscreen', stageId, descriptor },
          { id: chrome.runtime.id, url: chrome.runtime.getURL('service-worker-loader.js') },
          resolve
        )
      ).toBe(true);
    });
    expect(store.begin).not.toHaveBeenCalled();
    finishManifest(
      new Response(JSON.stringify({ background: { service_worker: 'service-worker-loader.js' } }))
    );
    await expect(response).resolves.toEqual({ success: true });
    expect(store.begin).toHaveBeenCalledWith(stageId, descriptor);
  });

  it('fails closed when the packaged manifest cannot be read', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('private native error'));
    const store = fakeStore();
    offscreenModule.setArchiveStageStoreForTesting(store);
    const response = await new Promise(resolve => {
      expect(
        capturedListener(
          { action: 'archiveStageBegin', target: 'offscreen', stageId, descriptor },
          { id: chrome.runtime.id, url: chrome.runtime.getURL('service-worker-loader.js') },
          resolve
        )
      ).toBe(true);
    });
    expect(response).toEqual({ success: false, error: 'offscreen-worker-entry-unavailable' });
    expect(store.begin).not.toHaveBeenCalled();
  });

  it('does not claim worker messages intended for other receivers', () => {
    const response = vi.fn();
    expect(
      capturedListener(
        { action: 'unrelated', target: 'elsewhere' },
        { id: chrome.runtime.id, url: chrome.runtime.getURL('service-worker-loader.js') },
        response
      )
    ).toBe(false);
    expect(response).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps foreign begin requests silent and rejects malformed begin before storage', async () => {
    const store = fakeStore();
    offscreenModule.setArchiveStageStoreForTesting(store);
    const response = vi.fn();
    expect(
      capturedListener(
        { action: 'archiveStageBegin', target: 'offscreen', stageId, descriptor },
        { id: 'other-extension' },
        response
      )
    ).toBe(false);
    expect(response).not.toHaveBeenCalled();
    await expect(
      invoke({ action: 'archiveStageBegin', target: 'offscreen', stageId, descriptor: {} })
    ).resolves.toEqual({ success: false, error: 'offscreen-invalid-request' });
    expect(store.begin).not.toHaveBeenCalled();
  });

  it.each([
    [new DOMException('private path', 'SecurityError'), 'opfs-denied'],
    [new DOMException('private path', 'NotAllowedError'), 'opfs-denied'],
    [new DOMException('private path', 'QuotaExceededError'), 'opfs-quota'],
    [new DOMException('private path', 'NotFoundError'), 'opfs-not-found'],
    [new DOMException('private path', 'InvalidStateError'), 'opfs-invalid-state'],
    [new TypeError('private path'), 'opfs-type-error'],
    [new Error('OPFS is unavailable'), 'opfs-unavailable'],
    [new DOMException('private path', 'UnknownError'), 'opfs-operation-failed'],
    [new Error('private path'), 'opfs-operation-failed'],
  ])('classifies a begin failure without leaking native messages: %s', async (failure, error) => {
    const store = fakeStore();
    vi.mocked(store.begin).mockRejectedValue(failure);
    offscreenModule.setArchiveStageStoreForTesting(store);
    await expect(
      invoke({ action: 'archiveStageBegin', target: 'offscreen', stageId, descriptor })
    ).resolves.toEqual({ success: false, error });
  });

  it('routes begin, append, seal, read, URL creation, exact release, and abort through the injected store', async () => {
    const store = fakeStore();
    const createObjectURL = vi.fn(() => 'blob:chrome-extension://test/archive-stage');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    offscreenModule.setArchiveStageStoreForTesting(store);

    await expect(
      invoke({ action: 'archiveStageBegin', target: 'offscreen', stageId, descriptor })
    ).resolves.toEqual({ success: true });
    await expect(
      invoke({
        action: 'archiveStageAppend',
        target: 'offscreen',
        stageId,
        offset: 0,
        chunkBase64: 'AP8=',
      })
    ).resolves.toEqual({ success: true });
    await expect(
      invoke({ action: 'archiveStageSeal', target: 'offscreen', stageId, descriptor })
    ).resolves.toEqual({ success: true });
    await expect(
      invoke({ action: 'archiveStageRead', target: 'offscreen', stageId, offset: 0, byteLength: 2 })
    ).resolves.toEqual({
      success: true,
      data: { stageId, offset: 0, byteLength: 2, chunkBase64: 'AP8=' },
    });
    await expect(
      invoke({ action: 'archiveStageCreateUrl', target: 'offscreen', stageId, descriptor })
    ).resolves.toEqual({ success: true, url: 'blob:chrome-extension://test/archive-stage' });
    await expect(
      invoke({
        action: 'archiveStageRelease',
        target: 'offscreen',
        stageId,
        url: 'blob:chrome-extension://test/archive-stage',
      })
    ).resolves.toEqual({ success: true });
    await expect(
      invoke({ action: 'archiveStageAbort', target: 'offscreen', stageId })
    ).resolves.toEqual({ success: true });

    expect(store.begin).toHaveBeenCalledWith(stageId, descriptor);
    expect(store.append).toHaveBeenCalledWith(stageId, 0, new Uint8Array([0, 255]));
    expect(store.seal).toHaveBeenCalledWith(stageId, descriptor);
    expect(store.read).toHaveBeenCalledWith(stageId, 0, 2);
    expect(store.openSealed).toHaveBeenCalledWith(stageId, descriptor);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:chrome-extension://test/archive-stage');
    expect(store.abort).toHaveBeenCalledTimes(2);
    expect(store.abort).toHaveBeenNthCalledWith(1, stageId);
    expect(store.abort).toHaveBeenNthCalledWith(2, stageId);
  });

  it('rejects malformed or oversized chunks and does not append them', async () => {
    const store = fakeStore();
    offscreenModule.setArchiveStageStoreForTesting(store);

    await expect(
      invoke({
        action: 'archiveStageAppend',
        target: 'offscreen',
        stageId,
        offset: 0,
        chunkBase64: 'not-base64',
      })
    ).resolves.toEqual({ success: false, error: 'Invalid archive stage chunk' });
    await expect(
      invoke({
        action: 'archiveStageAppend',
        target: 'offscreen',
        stageId,
        offset: 0,
        chunkBase64: bytesToBase64(new Uint8Array(ARCHIVE_STAGE_CHUNK_BYTES + 1)),
      })
    ).resolves.toEqual({ success: false, error: 'Invalid archive stage chunk' });

    expect(store.append).not.toHaveBeenCalled();
  });

  it('refuses an unknown Blob URL and never aborts another stage by URL ownership', async () => {
    const store = fakeStore();
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:chrome-extension://test/archive-stage'),
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    offscreenModule.setArchiveStageStoreForTesting(store);

    await invoke({ action: 'archiveStageCreateUrl', target: 'offscreen', stageId, descriptor });
    await expect(
      invoke({
        action: 'archiveStageRelease',
        target: 'offscreen',
        stageId,
        url: 'blob:chrome-extension://test/not-owned',
      })
    ).resolves.toEqual({ success: false, error: 'Unknown archive stage' });

    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(store.abort).not.toHaveBeenCalled();
  });
});
