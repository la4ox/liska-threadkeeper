import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_STAGE_CHUNK_BYTES,
  ARCHIVE_STAGE_RELATIVE_PATHS,
  type ArchiveStageDescriptor,
} from '../../src/lib/archive-stage-contract';
import {
  ARCHIVE_STAGE_DIRECTORY_NAME,
  ARCHIVE_STAGE_MAX_AGE_MS,
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

const stageId = `archive-stage-${'A'.repeat(32)}`;
const otherStageId = `archive-stage-${'B'.repeat(32)}`;

async function fixtureDescriptor(
  kind: 'raw' | 'canonical',
  bytes: Uint8Array
): Promise<ArchiveStageDescriptor> {
  return {
    kind,
    mediaType: 'application/json',
    relativePath: ARCHIVE_STAGE_RELATIVE_PATHS[kind],
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  };
}

describe('OPFS archive-stage store', () => {
  it('round-trips a deterministic multi-megabyte response through bounded OPFS chunks', async () => {
    const root = new MemoryDirectory();
    const store = new OpfsArchiveStageStore(async () => root as never);
    // The in-memory OPFS fake copies on every close; keep this multi-chunk
    // fixture bounded while the separate pipeline test exercises 20 MiB.
    const bytes = new Uint8Array(2 * 1024 * 1024 + 17);
    for (let index = 0; index < bytes.byteLength; index += 4096) {
      bytes[index] = (index / 4096) % 251;
    }
    bytes[bytes.byteLength - 1] = 255;
    const descriptor = await fixtureDescriptor('raw', bytes);

    await store.begin(stageId, descriptor);
    for (let offset = 0; offset < bytes.byteLength; offset += ARCHIVE_STAGE_CHUNK_BYTES) {
      await store.append(
        stageId,
        offset,
        bytes.subarray(offset, offset + ARCHIVE_STAGE_CHUNK_BYTES)
      );
    }
    await store.seal(stageId, descriptor);

    const restored = new Uint8Array(bytes.byteLength);
    for (let offset = 0; offset < restored.byteLength; offset += ARCHIVE_STAGE_CHUNK_BYTES) {
      const length = Math.min(ARCHIVE_STAGE_CHUNK_BYTES, restored.byteLength - offset);
      restored.set(await store.read(stageId, offset, length), offset);
    }
    expect(restored.byteLength).toBe(bytes.byteLength);
    expect(restored[0]).toBe(bytes[0]);
    expect(restored[restored.byteLength - 1]).toBe(255);
    expect(await sha256Hex(restored)).toBe(descriptor.sha256);
  });

  it('begins, appends, seals, bounded-reads, and aborts exact stage entries', async () => {
    const root = new MemoryDirectory();
    const binaryDirectory = await root.getDirectoryHandle('liska-binary-stages', { create: true });
    binaryDirectory.files.set('unrelated.bin', new Uint8Array([9]));
    const store = new OpfsArchiveStageStore(async () => root as never);
    const bytes = new Uint8Array([0, 255, 3]);
    const descriptor = await fixtureDescriptor('raw', bytes);

    await store.begin(stageId, descriptor);
    await expect(store.read(stageId, 0, 1)).rejects.toThrow('unavailable');
    await store.append(stageId, 0, bytes.subarray(0, 2));
    await store.append(stageId, 2, bytes.subarray(2));
    await store.seal(stageId, descriptor);
    await expect(store.seal(stageId, descriptor)).resolves.toBeUndefined();
    await expect(store.openSealed(stageId, descriptor)).resolves.toMatchObject({ size: 3 });
    await expect(
      store.openSealed(stageId, { ...descriptor, sha256: 'b'.repeat(64) })
    ).rejects.toThrow('metadata mismatch');
    await expect(store.read(stageId, 1, 2)).resolves.toEqual(new Uint8Array([255, 3]));
    await expect(store.read(stageId, 3, 1)).rejects.toThrow('unavailable');

    const stages = root.children.get(ARCHIVE_STAGE_DIRECTORY_NAME);
    const metadata = JSON.parse(new TextDecoder().decode(stages?.files.get(`${stageId}.json`)));
    expect(metadata).toEqual({
      stageId,
      descriptor,
      bytesWritten: 3,
      createdAt: expect.any(Number),
      state: 'SEALED',
    });
    expect(binaryDirectory.files.has('unrelated.bin')).toBe(true);

    await store.begin(otherStageId, descriptor);
    await store.abort(stageId);
    expect(stages?.files.has(`${stageId}.bin`)).toBe(false);
    expect(stages?.files.has(`${stageId}.json`)).toBe(false);
    expect(stages?.files.has(`${otherStageId}.bin`)).toBe(true);
    expect(stages?.files.has(`${otherStageId}.json`)).toBe(true);
  });

  it('requires sequential chunks while allowing only byte-proven duplicate acknowledgements', async () => {
    const root = new MemoryDirectory();
    const store = new OpfsArchiveStageStore(async () => root as never);
    const bytes = new Uint8Array([1, 2, 3]);
    const descriptor = await fixtureDescriptor('canonical', bytes);
    await store.begin(stageId, descriptor);

    await expect(store.append(stageId, 1, bytes.subarray(1))).rejects.toThrow('offset mismatch');
    await store.append(stageId, 0, bytes.subarray(0, 2));
    await expect(store.append(stageId, 1, new Uint8Array([2]))).resolves.toBeUndefined();
    await expect(store.append(stageId, 1, new Uint8Array([99]))).rejects.toThrow('offset mismatch');
    await expect(store.append(stageId, 0, bytes)).rejects.toThrow('offset mismatch');
    await expect(
      store.append(stageId, 2, new Uint8Array(ARCHIVE_STAGE_CHUNK_BYTES + 1))
    ).rejects.toThrow('invalid archive stage append');
    await store.append(stageId, 2, bytes.subarray(2));
    await store.seal(stageId, descriptor);
    await expect(store.append(stageId, 3, new Uint8Array())).rejects.toThrow('unavailable');
  });

  it('rejects mismatched sealed integrity and non-stale reuse', async () => {
    const root = new MemoryDirectory();
    const store = new OpfsArchiveStageStore(async () => root as never);
    const expected = new Uint8Array([1]);
    const descriptor = await fixtureDescriptor('raw', expected);
    await store.begin(stageId, descriptor);
    await expect(store.begin(stageId, descriptor)).rejects.toThrow('already exists');
    await store.append(stageId, 0, new Uint8Array([2]));
    await expect(store.seal(stageId, descriptor)).rejects.toThrow('hash mismatch');
  });

  it('cleans only exact stale stage entries and fails closed on fresh malformed metadata', async () => {
    const root = new MemoryDirectory();
    const stages = await root.getDirectoryHandle(ARCHIVE_STAGE_DIRECTORY_NAME, { create: true });
    const stale = `archive-stage-${'C'.repeat(32)}`;
    const freshMalformed = `archive-stage-${'D'.repeat(32)}`;
    const orphan = `archive-stage-${'E'.repeat(32)}`;
    const bytes = new Uint8Array([1]);
    const descriptor = await fixtureDescriptor('raw', bytes);
    const staleMetadata = new TextEncoder().encode(
      JSON.stringify({
        stageId: stale,
        descriptor,
        bytesWritten: 1,
        createdAt: 0,
        state: 'OPEN',
      })
    );
    stages.files.set(`${stale}.bin`, bytes);
    stages.files.set(`${stale}.json`, staleMetadata);
    stages.files.set(`${freshMalformed}.bin`, bytes);
    stages.files.set(`${freshMalformed}.json`, new TextEncoder().encode('{'));
    stages.files.set(`${orphan}.bin`, bytes);
    stages.files.set('unrelated.txt', bytes);
    const now = Date.now();
    for (const name of [`${stale}.bin`, `${stale}.json`, `${orphan}.bin`, 'unrelated.txt']) {
      stages.modified.set(name, now - ARCHIVE_STAGE_MAX_AGE_MS - 1);
    }
    stages.modified.set(`${freshMalformed}.bin`, now - ARCHIVE_STAGE_MAX_AGE_MS - 1);
    stages.modified.set(`${freshMalformed}.json`, now);

    const store = new OpfsArchiveStageStore(async () => root as never);
    // begin performs the bounded stale sweep before checking whether the
    // requested opaque ID is reusable. A non-stale entry would instead reject.
    await store.begin(stale, descriptor);

    expect(stages.files.get(`${stale}.bin`)).toEqual(new Uint8Array());
    expect(JSON.parse(new TextDecoder().decode(stages.files.get(`${stale}.json`)))).toEqual(
      expect.objectContaining({ stageId: stale, bytesWritten: 0, state: 'OPEN' })
    );
    expect(stages.files.has(`${orphan}.bin`)).toBe(false);
    expect(stages.files.has(`${freshMalformed}.bin`)).toBe(true);
    expect(stages.files.has(`${freshMalformed}.json`)).toBe(true);
    expect(stages.files.has('unrelated.txt')).toBe(true);
    await expect(store.append(freshMalformed, 0, bytes)).rejects.toThrow('unavailable');
    await expect(store.begin(freshMalformed, descriptor)).rejects.toThrow('already exists');
  });
});
