import { describe, expect, it, vi } from 'vitest';
import { createStagedBinaryAssetDescriptor } from '../../src/lib/binary-asset-contract';
import { BINARY_STAGE_MAX_AGE_MS, BINARY_STAGE_PRUNE_LIMIT } from '../../src/lib/constants';
import { OpfsBinaryStageStore } from '../../src/offscreen/binary-stage-store';

class MemoryFileHandle {
  readonly kind = 'file' as const;

  constructor(
    readonly name: string,
    private readonly files: Map<string, Uint8Array>,
    private readonly modified: Map<string, number>
  ) {}

  async getFile(): Promise<File> {
    const bytes = this.files.get(this.name) ?? new Uint8Array();
    const exact = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    return {
      size: bytes.byteLength,
      lastModified: this.modified.get(this.name) ?? 0,
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () => exact,
    } as File;
  }

  async createWritable(options?: { keepExistingData?: boolean }) {
    let bytes = options?.keepExistingData
      ? new Uint8Array(this.files.get(this.name))
      : new Uint8Array();
    return {
      write: async (value: Uint8Array | { type: 'write'; position: number; data: Uint8Array }) => {
        const positioned =
          typeof value === 'object' && value !== null && 'type' in value && value.type === 'write';
        const position = positioned ? value.position : 0;
        const data = positioned ? value.data : value;
        const next = new Uint8Array(Math.max(bytes.byteLength, position + data.byteLength));
        next.set(bytes);
        next.set(data, position);
        bytes = next;
      },
      close: async () => {
        this.files.set(this.name, bytes);
        this.modified.set(this.name, Date.now());
      },
    };
  }
}

class MemoryDirectory {
  readonly kind = 'directory' as const;
  readonly files = new Map<string, Uint8Array>();
  readonly modified = new Map<string, number>();
  readonly children = new Map<string, MemoryDirectory>();

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectory> {
    const existing = this.children.get(name);
    if (existing) return existing;
    if (!options?.create) throw new DOMException('not found', 'NotFoundError');
    const created = new MemoryDirectory();
    this.children.set(name, created);
    return created;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFileHandle> {
    if (!this.files.has(name) && !options?.create) {
      throw new DOMException('not found', 'NotFoundError');
    }
    if (!this.files.has(name)) {
      this.files.set(name, new Uint8Array());
      this.modified.set(name, Date.now());
    }
    return new MemoryFileHandle(name, this.files, this.modified);
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) throw new DOMException('not found', 'NotFoundError');
    this.modified.delete(name);
  }

  async *values(): AsyncIterableIterator<MemoryFileHandle | MemoryDirectory> {
    for (const name of this.files.keys())
      yield new MemoryFileHandle(name, this.files, this.modified);
    for (const directory of this.children.values()) yield directory;
  }
}

class UnreadableEntryDirectory extends MemoryDirectory {
  override async *values(): AsyncIterableIterator<MemoryFileHandle | MemoryDirectory> {
    yield {
      kind: 'file',
      name: `stage-${'A'.repeat(32)}.bin`,
      getFile: async () => {
        throw new Error('entry became unavailable');
      },
    } as unknown as MemoryFileHandle;
  }
}

class MetadataWriteFailureDirectory extends MemoryDirectory {
  override async getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<MemoryFileHandle> {
    if (name.endsWith('.json') && options?.create) throw new Error('metadata storage unavailable');
    return super.getFileHandle(name, options);
  }
}

const stageId = `stage-${'A'.repeat(32)}`;

async function descriptor(bytes: Uint8Array) {
  const value = await createStagedBinaryAssetDescriptor({
    assetId: `chatgpt-asset-${'a'.repeat(64)}`,
    mediaType: 'application/octet-stream',
    bytes,
  });
  if (!value) throw new Error('fixture descriptor');
  return value;
}

describe('OPFS binary stage store boundary coverage', () => {
  it('rejects invalid identifiers and exact append bounds before accepting any bytes', async () => {
    const root = new MemoryDirectory();
    const store = new OpfsBinaryStageStore(async () => root as never);
    const asset = await descriptor(new Uint8Array([1]));

    await expect(store.begin('not-a-stage', asset)).rejects.toThrow('invalid binary stage');
    await store.begin(stageId, asset);
    await expect(store.append(stageId, -1, new Uint8Array())).rejects.toThrow(
      'invalid binary stage append'
    );
    await expect(store.append(stageId, 0.5, new Uint8Array())).rejects.toThrow(
      'invalid binary stage append'
    );
    await expect(store.append(stageId, 1, new Uint8Array())).rejects.toThrow('offset mismatch');
    await expect(store.append(stageId, 0, new Uint8Array([1, 2]))).rejects.toThrow(
      'exceeds descriptor'
    );
    await expect(store.finalize(stageId, asset)).rejects.toThrow('metadata mismatch');
  });

  it('cleans only the exact stage after a metadata-write failure and propagates non-NotFound roots', async () => {
    const root = new MemoryDirectory();
    const directory = new MetadataWriteFailureDirectory();
    root.children.set('liska-binary-stages', directory);
    const asset = await descriptor(new Uint8Array([1]));

    await expect(
      new OpfsBinaryStageStore(async () => root as never).begin(stageId, asset)
    ).rejects.toThrow('metadata storage unavailable');
    expect(directory.files.has(`${stageId}.bin`)).toBe(false);
    await expect(
      new OpfsBinaryStageStore(async () => {
        throw new Error('root unavailable');
      }).abort(stageId)
    ).rejects.toThrow('root unavailable');
  });

  it('rejects invalid finalization identifiers without opening the stage directory', async () => {
    const store = new OpfsBinaryStageStore(async () => new MemoryDirectory() as never);
    await expect(store.finalize('not-a-stage', await descriptor(new Uint8Array()))).rejects.toThrow(
      'invalid binary stage'
    );
  });

  it('detects both tampered stored length and tampered stored bytes during final readback', async () => {
    const root = new MemoryDirectory();
    const store = new OpfsBinaryStageStore(async () => root as never);
    const asset = await descriptor(new Uint8Array([1]));
    const directory = await root.getDirectoryHandle('liska-binary-stages', { create: true });

    await store.begin(stageId, asset);
    await store.append(stageId, 0, new Uint8Array([2]));
    await expect(store.finalize(stageId, asset)).rejects.toThrow('hash mismatch');

    directory.files.set(`${stageId}.bin`, new Uint8Array());
    directory.modified.set(`${stageId}.bin`, Date.now());
    await expect(store.finalize(stageId, asset)).rejects.toThrow('length mismatch');
  });

  it('treats an absent dedicated directory as idempotently clean, but propagates real exact-entry errors', async () => {
    const root = new MemoryDirectory();
    const store = new OpfsBinaryStageStore(async () => root as never);

    await expect(store.abort(stageId)).resolves.toBeUndefined();
    await expect(store.abort('outside-stage')).rejects.toThrow('invalid binary stage');

    const asset = await descriptor(new Uint8Array([1]));
    await store.begin(stageId, asset);
    const directory = await root.getDirectoryHandle('liska-binary-stages');
    directory.removeEntry = async () => {
      throw new DOMException('storage unavailable', 'InvalidStateError');
    };
    await expect(store.abort(stageId)).rejects.toThrow('storage unavailable');
  });

  it('prunes no more than the exact stale-stage limit and leaves later entries for the next bounded sweep', async () => {
    const root = new MemoryDirectory();
    const directory = await root.getDirectoryHandle('liska-binary-stages', { create: true });
    const stageIds = Array.from(
      { length: BINARY_STAGE_PRUNE_LIMIT + 1 },
      (_, index) => `stage-${index.toString(36).padStart(32, 'A')}`
    );
    for (const id of stageIds) {
      directory.files.set(`${id}.bin`, new Uint8Array([1]));
      directory.modified.set(`${id}.bin`, 0);
    }

    const store = new OpfsBinaryStageStore(async () => root as never);
    await store.pruneStale(BINARY_STAGE_MAX_AGE_MS + 1);

    expect(
      stageIds.slice(0, BINARY_STAGE_PRUNE_LIMIT).every(id => !directory.files.has(`${id}.bin`))
    ).toBe(true);
    expect(directory.files.has(`${stageIds.at(-1)}.bin`)).toBe(true);
  });

  it('leaves unreadable and metadata-fresh entries untouched during a stale sweep', async () => {
    const unreadableRoot = new MemoryDirectory();
    unreadableRoot.children.set('liska-binary-stages', new UnreadableEntryDirectory());
    await expect(
      new OpfsBinaryStageStore(async () => unreadableRoot as never).pruneStale(
        BINARY_STAGE_MAX_AGE_MS + 1
      )
    ).resolves.toBeUndefined();

    const root = new MemoryDirectory();
    const directory = await root.getDirectoryHandle('liska-binary-stages', { create: true });
    const asset = await descriptor(new Uint8Array([1]));
    directory.files.set(`${stageId}.bin`, new Uint8Array([1]));
    directory.modified.set(`${stageId}.bin`, 0);
    directory.files.set(
      `${stageId}.json`,
      new TextEncoder().encode(
        JSON.stringify({
          stageId,
          descriptor: asset,
          bytesWritten: 1,
          createdAt: BINARY_STAGE_MAX_AGE_MS,
        })
      )
    );
    directory.modified.set(`${stageId}.json`, 0);

    await new OpfsBinaryStageStore(async () => root as never).pruneStale(
      BINARY_STAGE_MAX_AGE_MS + 1
    );

    expect(directory.files.has(`${stageId}.bin`)).toBe(true);
    expect(directory.files.has(`${stageId}.json`)).toBe(true);
  });

  it('fails explicitly when default OPFS storage is unavailable', async () => {
    const storageDescriptor = Object.getOwnPropertyDescriptor(navigator, 'storage');
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {} });
    try {
      await expect(
        new OpfsBinaryStageStore().begin(stageId, await descriptor(new Uint8Array()))
      ).rejects.toThrow('OPFS is unavailable');
    } finally {
      if (storageDescriptor) Object.defineProperty(navigator, 'storage', storageDescriptor);
      else Reflect.deleteProperty(navigator, 'storage');
    }
  });

  it('uses the browser-provided default OPFS root when that capability is present', async () => {
    const storageDescriptor = Object.getOwnPropertyDescriptor(navigator, 'storage');
    const root = new MemoryDirectory();
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: async () => root },
    });
    try {
      await new OpfsBinaryStageStore().begin(stageId, await descriptor(new Uint8Array()));
      expect(root.children.get('liska-binary-stages')?.files.has(`${stageId}.bin`)).toBe(true);
    } finally {
      if (storageDescriptor) Object.defineProperty(navigator, 'storage', storageDescriptor);
      else Reflect.deleteProperty(navigator, 'storage');
    }
  });

  it('rejects unknown Blob releases and turns abort-store rejection into a safe offscreen response', async () => {
    let listener:
      | ((
          message: unknown,
          sender: chrome.runtime.MessageSender,
          sendResponse: (response: unknown) => void
        ) => boolean)
      | undefined;
    vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation(nextListener => {
      listener = nextListener as typeof listener;
    });
    const offscreen = await import('../../src/offscreen/offscreen');
    if (!listener) throw new Error('offscreen listener was not registered');
    const sender = { id: chrome.runtime.id } as chrome.runtime.MessageSender;
    const releaseResponse = vi.fn();

    listener(
      {
        action: 'binaryStageRelease',
        target: 'offscreen',
        stageId,
        url: 'blob:chrome-extension://test/unknown-stage',
      },
      sender,
      releaseResponse
    );
    await vi.waitFor(() =>
      expect(releaseResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Unknown binary stage',
      })
    );

    offscreen.setBinaryStageStoreForTesting({
      begin: vi.fn(),
      append: vi.fn(),
      finalize: vi.fn(),
      abort: vi.fn().mockRejectedValue(new Error('OPFS unavailable')),
      pruneStale: vi.fn(),
    });
    const rejectedAbort = vi.fn();
    listener({ action: 'binaryStageAbort', target: 'offscreen', stageId }, sender, rejectedAbort);
    await vi.waitFor(() =>
      expect(rejectedAbort).toHaveBeenCalledWith({
        success: false,
        error: 'Binary stage operation failed',
      })
    );

    const abort = vi.fn();
    offscreen.setBinaryStageStoreForTesting({
      begin: vi.fn(),
      append: vi.fn(),
      finalize: vi.fn(),
      abort,
      pruneStale: vi.fn(),
    });
    const abortResponse = vi.fn();
    listener({ action: 'binaryStageAbort', target: 'offscreen', stageId }, sender, abortResponse);
    await vi.waitFor(() => expect(abortResponse).toHaveBeenCalledWith({ success: true }));
    expect(abort).toHaveBeenCalledWith(stageId);
  });
});
