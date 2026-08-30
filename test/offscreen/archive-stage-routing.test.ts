import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation(listener => {
      capturedListener = listener;
    });
    vi.resetModules();
    offscreenModule = await import('../../src/offscreen/offscreen');
  });

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
        {
          id: chrome.runtime.id,
          url: chrome.runtime.getURL('src/popup/index.html'),
        } as chrome.runtime.MessageSender,
        response
      )
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
