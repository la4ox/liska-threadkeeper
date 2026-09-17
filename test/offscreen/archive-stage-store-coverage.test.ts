import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_STAGE_CHUNK_BYTES,
  ARCHIVE_STAGE_MAX_BYTES,
  ARCHIVE_STAGE_RELATIVE_PATHS,
  type ArchiveStageDescriptor,
} from '../../src/lib/archive-stage-contract';
import {
  ARCHIVE_STAGE_DIRECTORY_NAME,
  ARCHIVE_STAGE_MAX_AGE_MS,
  ARCHIVE_STAGE_PRUNE_LIMIT,
  OpfsArchiveStageStore,
} from '../../src/offscreen/archive-stage-store';
import { sha256Hex } from '../../src/lib/sha256';

class MemoryFileHandle {
  readonly kind = 'file' as const;

  constructor(
    readonly name: string,
    private readonly files: Map<string, Uint8Array>,
    private readonly modified: Map<string, number>
  ) {}

  async getFile(): Promise<File> {
    const bytes = new Uint8Array(this.files.get(this.name) ?? new Uint8Array());
    const exact = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    return {
      size: bytes.byteLength,
      lastModified: this.modified.get(this.name) ?? 0,
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () => exact,
      slice: (start = 0, end = bytes.byteLength) => {
        const range = bytes.slice(start, end);
        const slice = range.buffer.slice(
          range.byteOffset,
          range.byteOffset + range.byteLength
        ) as ArrayBuffer;
        return { arrayBuffer: async () => slice } as Blob;
      },
    } as File;
  }

  async createWritable(options?: { keepExistingData?: boolean }) {
    let bytes = options?.keepExistingData
      ? new Uint8Array(this.files.get(this.name) ?? new Uint8Array())
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
    for (const name of this.files.keys()) {
      yield new MemoryFileHandle(name, this.files, this.modified);
    }
    for (const directory of this.children.values()) yield directory;
  }
}

class MetadataWriteFailureDirectory extends MemoryDirectory {
  override async getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<MemoryFileHandle> {
    if (name.endsWith('.json') && options?.create) {
      throw new Error('metadata storage unavailable');
    }
    return super.getFileHandle(name, options);
  }
}

class UnreadableFileHandle extends MemoryFileHandle {
  override async getFile(): Promise<File> {
    throw new Error('entry became unreadable');
  }
}

class UnreadableDirectory extends MemoryDirectory {
  readonly unreadableName = `archive-stage-${'U'.repeat(32)}.bin`;

  override async getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<MemoryFileHandle> {
    if (name === this.unreadableName) {
      return new UnreadableFileHandle(name, this.files, this.modified);
    }
    return super.getFileHandle(name, options);
  }

  override async *values(): AsyncIterableIterator<MemoryFileHandle | MemoryDirectory> {
    yield new UnreadableFileHandle(this.unreadableName, this.files, this.modified);
  }
}

class GhostDirectory extends MemoryDirectory {
  readonly ghostName = `archive-stage-${'G'.repeat(32)}.bin`;

  override async *values(): AsyncIterableIterator<MemoryFileHandle | MemoryDirectory> {
    yield { kind: 'file', name: this.ghostName } as unknown as MemoryFileHandle;
  }
}

const stageId = `archive-stage-${'A'.repeat(32)}`;

function stageIdAt(index: number): string {
  return `archive-stage-${index.toString(36).padStart(32, '0')}`;
}

async function descriptorFor(
  bytes: Uint8Array,
  kind: 'raw' | 'canonical' = 'raw'
): Promise<ArchiveStageDescriptor> {
  return {
    kind,
    mediaType: 'application/json',
    relativePath: ARCHIVE_STAGE_RELATIVE_PATHS[kind],
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  };
}

function malformedMetadata(stage: string, descriptor: ArchiveStageDescriptor): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      stageId: stage,
      descriptor,
      bytesWritten: 'wrong',
      createdAt: 0,
      state: 'OPEN',
    })
  );
}

describe('OPFS archive-stage store boundary coverage', () => {
  it('rejects invalid begin inputs and refuses existing data-only or metadata-only IDs', async () => {
    const root = new MemoryDirectory();
    const store = new OpfsArchiveStageStore(async () => root as never);
    const descriptor = await descriptorFor(new Uint8Array([1]));

    await expect(store.begin('invalid', descriptor)).rejects.toThrow('invalid archive stage');
    await expect(
      store.begin(stageId, { ...descriptor, relativePath: 'wrong/path' })
    ).rejects.toThrow('invalid archive stage');

    const directory = await root.getDirectoryHandle(ARCHIVE_STAGE_DIRECTORY_NAME, { create: true });
    directory.files.set(`${stageId}.bin`, new Uint8Array());
    directory.modified.set(`${stageId}.bin`, Date.now());
    await expect(store.begin(stageId, descriptor)).rejects.toThrow('already exists');

    const metadataOnly = stageIdAt(1);
    directory.files.delete(`${stageId}.bin`);
    directory.modified.delete(`${stageId}.bin`);
    directory.files.set(
      `${metadataOnly}.json`,
      new TextEncoder().encode(
        JSON.stringify({
          stageId: metadataOnly,
          descriptor,
          bytesWritten: 0,
          createdAt: Date.now(),
          state: 'OPEN',
        })
      )
    );
    directory.modified.set(`${metadataOnly}.json`, Date.now());
    await expect(store.begin(metadataOnly, descriptor)).rejects.toThrow('already exists');
  });

  it('cleans a partially created stage after metadata failure and propagates preflight errors', async () => {
    const root = new MemoryDirectory();
    const directory = new MetadataWriteFailureDirectory();
    root.children.set(ARCHIVE_STAGE_DIRECTORY_NAME, directory);
    const descriptor = await descriptorFor(new Uint8Array([1]));
    const store = new OpfsArchiveStageStore(async () => root as never);

    await expect(store.begin(stageId, descriptor)).rejects.toThrow('metadata storage unavailable');
    expect(directory.files.has(`${stageId}.bin`)).toBe(false);
    expect(directory.files.has(`${stageId}.json`)).toBe(false);

    const preflightRoot = new MemoryDirectory();
    const preflightDirectory = await preflightRoot.getDirectoryHandle(
      ARCHIVE_STAGE_DIRECTORY_NAME,
      { create: true }
    );
    preflightDirectory.getFileHandle = async () => {
      throw new DOMException('storage unavailable', 'InvalidStateError');
    };
    await expect(
      new OpfsArchiveStageStore(async () => preflightRoot as never).begin(stageId, descriptor)
    ).rejects.toThrow('storage unavailable');
  });

  it('enforces append bounds, sequential offsets, duplicate retries, and sealed availability', async () => {
    const root = new MemoryDirectory();
    const store = new OpfsArchiveStageStore(async () => root as never);
    const bytes = new Uint8Array([1, 2, 3]);
    const descriptor = await descriptorFor(bytes, 'canonical');
    await store.begin(stageId, descriptor);

    await expect(store.append('invalid', 0, new Uint8Array())).rejects.toThrow(
      'invalid archive stage append'
    );
    await expect(store.append(stageId, -1, new Uint8Array())).rejects.toThrow(
      'invalid archive stage append'
    );
    await expect(store.append(stageId, 0.5, new Uint8Array())).rejects.toThrow(
      'invalid archive stage append'
    );
    await expect(store.append(stageId, 0, {} as Uint8Array)).rejects.toThrow(
      'invalid archive stage append'
    );
    const overChunk = new Uint8Array();
    Object.defineProperty(overChunk, 'byteLength', {
      configurable: true,
      value: ARCHIVE_STAGE_CHUNK_BYTES + 1,
    });
    await expect(store.append(stageId, 0, overChunk)).rejects.toThrow(
      'invalid archive stage append'
    );

    await expect(store.append(stageId, 1, new Uint8Array([2]))).rejects.toThrow('offset mismatch');
    await expect(
      store.append(stageId, ARCHIVE_STAGE_MAX_BYTES, new Uint8Array([1]))
    ).rejects.toThrow('exceeds descriptor');
    await expect(store.append(stageId, 0, new Uint8Array([1, 2]))).resolves.toBeUndefined();
    await expect(store.append(stageId, 0, new Uint8Array([1, 2]))).resolves.toBeUndefined();
    await expect(store.append(stageId, 0, new Uint8Array([9, 2]))).rejects.toThrow(
      'offset mismatch'
    );
    await expect(store.append(stageId, 1, new Uint8Array([2, 3]))).rejects.toThrow(
      'offset mismatch'
    );
    await expect(store.append(stageId, 2, new Uint8Array([3]))).resolves.toBeUndefined();

    await store.seal(stageId, descriptor);
    await expect(store.append(stageId, 3, new Uint8Array())).rejects.toThrow('unavailable');
  });

  it('detects stored-length drift and descriptor bounds before writing', async () => {
    const descriptor = await descriptorFor(new Uint8Array([1]));

    const root = new MemoryDirectory();
    const store = new OpfsArchiveStageStore(async () => root as never);
    await store.begin(stageId, descriptor);
    const directory = await root.getDirectoryHandle(ARCHIVE_STAGE_DIRECTORY_NAME);
    directory.files.set(`${stageId}.bin`, new Uint8Array([1, 2]));
    await expect(store.append(stageId, 0, new Uint8Array([1]))).rejects.toThrow('length mismatch');

    const boundRoot = new MemoryDirectory();
    const boundStore = new OpfsArchiveStageStore(async () => boundRoot as never);
    await boundStore.begin(stageId, descriptor);
    await expect(boundStore.append(stageId, 0, new Uint8Array([1, 2]))).rejects.toThrow(
      'exceeds descriptor'
    );
  });

  it('rejects seal mismatches, file hash failures, and invalid open descriptors', async () => {
    const expected = new Uint8Array([1]);
    const descriptor = await descriptorFor(expected);
    const root = new MemoryDirectory();
    const store = new OpfsArchiveStageStore(async () => root as never);

    await expect(store.seal('invalid', descriptor)).rejects.toThrow('invalid archive stage');
    await expect(store.openSealed('invalid', descriptor)).rejects.toThrow('invalid archive stage');
    await store.begin(stageId, descriptor);
    await expect(store.seal(stageId, { ...descriptor, sha256: 'f'.repeat(64) })).rejects.toThrow(
      'metadata mismatch'
    );
    await store.append(stageId, 0, new Uint8Array([2]));
    await expect(store.seal(stageId, descriptor)).rejects.toThrow('hash mismatch');
  });

  it('seals idempotently and rejects open/read requests after file-size drift', async () => {
    const bytes = new Uint8Array([4, 5]);
    const descriptor = await descriptorFor(bytes);
    const root = new MemoryDirectory();
    const store = new OpfsArchiveStageStore(async () => root as never);

    await store.begin(stageId, descriptor);
    await store.append(stageId, 0, bytes);
    await store.seal(stageId, descriptor);
    await expect(store.seal(stageId, descriptor)).resolves.toBeUndefined();
    await expect(store.openSealed(stageId, descriptor)).resolves.toMatchObject({ size: 2 });
    await expect(store.read(stageId, 0, 2)).resolves.toEqual(bytes);

    const directory = await root.getDirectoryHandle(ARCHIVE_STAGE_DIRECTORY_NAME);
    directory.files.set(`${stageId}.bin`, new Uint8Array([4]));
    await expect(store.openSealed(stageId, descriptor)).rejects.toThrow('length mismatch');
    await expect(store.read(stageId, 0, 1)).rejects.toThrow('length mismatch');
  });

  it('rejects malformed read ranges and absent or non-sealed stages', async () => {
    const root = new MemoryDirectory();
    const store = new OpfsArchiveStageStore(async () => root as never);
    const descriptor = await descriptorFor(new Uint8Array([1]));

    await expect(store.read('invalid', 0, 0)).rejects.toThrow('invalid archive stage read');
    await expect(store.read(stageId, -1, 0)).rejects.toThrow('invalid archive stage read');
    await expect(store.read(stageId, 0.5, 0)).rejects.toThrow('invalid archive stage read');
    await expect(store.read(stageId, 0, -1)).rejects.toThrow('invalid archive stage read');
    const overChunk = new Uint8Array();
    Object.defineProperty(overChunk, 'byteLength', {
      configurable: true,
      value: ARCHIVE_STAGE_CHUNK_BYTES + 1,
    });
    await expect(store.read(stageId, 0, overChunk.byteLength)).rejects.toThrow(
      'invalid archive stage read'
    );

    await store.begin(stageId, descriptor);
    await expect(store.read(stageId, 0, 1)).rejects.toThrow('unavailable');
  });

  it('treats absent aborts as idempotent and propagates real root or remove errors', async () => {
    const missingRoot = new MemoryDirectory();
    await expect(
      new OpfsArchiveStageStore(async () => missingRoot as never).abort(stageId)
    ).resolves.toBeUndefined();
    await expect(
      new OpfsArchiveStageStore(async () => missingRoot as never).abort('invalid')
    ).rejects.toThrow('invalid archive stage');
    await expect(
      new OpfsArchiveStageStore(async () => {
        throw new Error('root unavailable');
      }).abort(stageId)
    ).rejects.toThrow('root unavailable');

    const root = new MemoryDirectory();
    const store = new OpfsArchiveStageStore(async () => root as never);
    await store.begin(stageId, await descriptorFor(new Uint8Array([1])));
    const directory = await root.getDirectoryHandle(ARCHIVE_STAGE_DIRECTORY_NAME);
    directory.removeEntry = async () => {
      throw new DOMException('storage unavailable', 'InvalidStateError');
    };
    await expect(store.abort(stageId)).rejects.toThrow('storage unavailable');
  });

  it('bounds stale cleanup, skips fresh entries, and survives unreadable or malformed metadata', async () => {
    const root = new MemoryDirectory();
    const directory = await root.getDirectoryHandle(ARCHIVE_STAGE_DIRECTORY_NAME, { create: true });
    for (let index = 0; index < ARCHIVE_STAGE_PRUNE_LIMIT + 1; index += 1) {
      const id = stageIdAt(index + 10);
      directory.files.set(`${id}.bin`, new Uint8Array([index]));
      directory.modified.set(`${id}.bin`, 0);
    }
    directory.files.set('not-a-stage.bin', new Uint8Array([1]));
    directory.modified.set('not-a-stage.bin', 0);
    directory.children.set('nested', new MemoryDirectory());

    const now = ARCHIVE_STAGE_MAX_AGE_MS + 1;
    await new OpfsArchiveStageStore(async () => root as never).pruneStale(now);
    const retained = `${stageIdAt(ARCHIVE_STAGE_PRUNE_LIMIT + 10)}.bin`;
    expect(directory.files.has(retained)).toBe(true);
    expect(directory.files.has(`${stageIdAt(10)}.bin`)).toBe(false);
    expect(directory.files.has('not-a-stage.bin')).toBe(true);

    const freshRoot = new MemoryDirectory();
    const fresh = await freshRoot.getDirectoryHandle(ARCHIVE_STAGE_DIRECTORY_NAME, {
      create: true,
    });
    const freshId = stageIdAt(100);
    const freshDescriptor = await descriptorFor(new Uint8Array([7]));
    fresh.files.set(`${freshId}.bin`, new Uint8Array([7]));
    fresh.files.set(`${freshId}.json`, malformedMetadata(freshId, freshDescriptor));
    fresh.modified.set(`${freshId}.bin`, 0);
    fresh.modified.set(`${freshId}.json`, now);
    await new OpfsArchiveStageStore(async () => freshRoot as never).pruneStale(now);
    expect(fresh.files.has(`${freshId}.bin`)).toBe(true);
    expect(fresh.files.has(`${freshId}.json`)).toBe(true);

    const unreadableRoot = new MemoryDirectory();
    unreadableRoot.children.set(ARCHIVE_STAGE_DIRECTORY_NAME, new UnreadableDirectory());
    await expect(
      new OpfsArchiveStageStore(async () => unreadableRoot as never).pruneStale(now)
    ).resolves.toBeUndefined();

    const ghostRoot = new MemoryDirectory();
    ghostRoot.children.set(ARCHIVE_STAGE_DIRECTORY_NAME, new GhostDirectory());
    await expect(
      new OpfsArchiveStageStore(async () => ghostRoot as never).pruneStale(now)
    ).resolves.toBeUndefined();
  });

  it('rejects invalid stale clocks and propagates non-NotFound prune errors', async () => {
    const root = new MemoryDirectory();
    const store = new OpfsArchiveStageStore(async () => root as never);
    await expect(store.pruneStale(-1)).rejects.toThrow('invalid archive stage clock');
    await expect(store.pruneStale(Number.NaN)).rejects.toThrow('invalid archive stage clock');
    await expect(store.pruneStale(0)).resolves.toBeUndefined();
    await expect(
      new OpfsArchiveStageStore(async () => {
        throw new Error('prune root unavailable');
      }).pruneStale(0)
    ).rejects.toThrow('prune root unavailable');
  });

  it('uses the browser default OPFS capability when available and reports when absent', async () => {
    const descriptor = await descriptorFor(new Uint8Array());
    const storageDescriptor = Object.getOwnPropertyDescriptor(navigator, 'storage');
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {} });
    try {
      await expect(new OpfsArchiveStageStore().begin(stageId, descriptor)).rejects.toThrow(
        'OPFS is unavailable'
      );
    } finally {
      if (storageDescriptor) Object.defineProperty(navigator, 'storage', storageDescriptor);
      else Reflect.deleteProperty(navigator, 'storage');
    }

    const root = new MemoryDirectory();
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: async () => root },
    });
    try {
      await new OpfsArchiveStageStore().begin(stageId, descriptor);
      expect(root.children.get(ARCHIVE_STAGE_DIRECTORY_NAME)?.files.has(`${stageId}.bin`)).toBe(
        true
      );
    } finally {
      if (storageDescriptor) Object.defineProperty(navigator, 'storage', storageDescriptor);
      else Reflect.deleteProperty(navigator, 'storage');
    }
  });
});
