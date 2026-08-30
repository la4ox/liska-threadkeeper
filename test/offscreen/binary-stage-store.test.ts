import { describe, expect, it } from 'vitest';
import { createStagedBinaryAssetDescriptor } from '../../src/lib/binary-asset-contract';
import { BINARY_STAGE_MAX_AGE_MS } from '../../src/lib/constants';
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
        const isPositionedWrite =
          typeof value === 'object' && value !== null && 'type' in value && value.type === 'write';
        const position = isPositionedWrite ? value.position : 0;
        const data = isPositionedWrite ? value.data : value;
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

const stageId = `stage-${'A'.repeat(32)}`;
const otherStageId = `stage-${'B'.repeat(32)}`;

describe('OPFS binary stage store', () => {
  it('writes exact offsets, verifies final length/hash, and aborts only the requested stage', async () => {
    const root = new MemoryDirectory();
    const store = new OpfsBinaryStageStore(async () => root as never);
    const bytes = new Uint8Array([0, 255, 3]);
    const descriptor = await createStagedBinaryAssetDescriptor({
      assetId: `chatgpt-asset-${'a'.repeat(64)}`,
      mediaType: 'application/octet-stream',
      bytes,
    });
    if (!descriptor) throw new Error('fixture descriptor');

    await store.begin(stageId, descriptor);
    await store.append(stageId, 0, bytes.subarray(0, 2));
    await expect(store.append(stageId, 0, bytes.subarray(2))).rejects.toThrow('offset mismatch');
    await store.append(stageId, 2, bytes.subarray(2));
    await expect(store.finalize(stageId, { ...descriptor, byteLength: 2 })).rejects.toThrow(
      'metadata mismatch'
    );
    await expect(store.finalize(stageId, descriptor)).resolves.toMatchObject({ size: 3 });

    await store.begin(otherStageId, descriptor);
    await store.abort(stageId);
    const stages = root.children.get('liska-binary-stages');
    expect(stages?.files.has(`${stageId}.bin`)).toBe(false);
    expect(stages?.files.has(`${stageId}.json`)).toBe(false);
    expect(stages?.files.has(`${otherStageId}.bin`)).toBe(true);
    expect(stages?.files.has(`${otherStageId}.json`)).toBe(true);
  });

  it('prunes only bounded exact stale metadata entries, including malformed metadata', async () => {
    const root = new MemoryDirectory();
    const stageDirectory = await root.getDirectoryHandle('liska-binary-stages', { create: true });
    const stale = `stage-${'C'.repeat(32)}`;
    const malformed = `stage-${'D'.repeat(32)}`;
    const freshMalformed = `stage-${'E'.repeat(32)}`;
    const orphanedData = `stage-${'F'.repeat(32)}`;
    stageDirectory.files.set(`${stale}.bin`, new Uint8Array([1]));
    stageDirectory.modified.set(`${stale}.bin`, 0);
    stageDirectory.files.set(
      `${stale}.json`,
      new TextEncoder().encode(
        JSON.stringify({
          stageId: stale,
          descriptor: {
            assetId: `chatgpt-asset-${'a'.repeat(64)}`,
            byteLength: 1,
            sha256: 'b'.repeat(64),
            mediaType: 'application/octet-stream',
            relativePath: `assets/${'b'.repeat(64)}.bin`,
          },
          bytesWritten: 1,
          createdAt: 0,
        })
      )
    );
    stageDirectory.modified.set(`${stale}.json`, 0);
    stageDirectory.files.set(`${malformed}.bin`, new Uint8Array([1]));
    stageDirectory.modified.set(`${malformed}.bin`, 0);
    stageDirectory.files.set(`${malformed}.json`, new TextEncoder().encode('{'));
    stageDirectory.modified.set(`${malformed}.json`, 0);
    stageDirectory.files.set(`${freshMalformed}.bin`, new Uint8Array([1]));
    stageDirectory.modified.set(`${freshMalformed}.bin`, BINARY_STAGE_MAX_AGE_MS);
    stageDirectory.files.set(`${freshMalformed}.json`, new TextEncoder().encode('{'));
    stageDirectory.modified.set(`${freshMalformed}.json`, BINARY_STAGE_MAX_AGE_MS);
    stageDirectory.files.set(`${orphanedData}.bin`, new Uint8Array([1]));
    stageDirectory.modified.set(`${orphanedData}.bin`, 0);
    stageDirectory.files.set('unrelated.txt', new Uint8Array([1]));
    stageDirectory.modified.set('unrelated.txt', 0);

    const store = new OpfsBinaryStageStore(async () => root as never);
    await store.pruneStale(BINARY_STAGE_MAX_AGE_MS + 1);

    expect(stageDirectory.files.has(`${stale}.bin`)).toBe(false);
    expect(stageDirectory.files.has(`${stale}.json`)).toBe(false);
    expect(stageDirectory.files.has(`${malformed}.bin`)).toBe(false);
    expect(stageDirectory.files.has(`${malformed}.json`)).toBe(false);
    expect(stageDirectory.files.has(`${freshMalformed}.bin`)).toBe(true);
    expect(stageDirectory.files.has(`${freshMalformed}.json`)).toBe(true);
    expect(stageDirectory.files.has(`${orphanedData}.bin`)).toBe(false);
    expect(stageDirectory.files.has('unrelated.txt')).toBe(true);
  });

  it('does not treat a real OPFS removal failure as confirmed cleanup', async () => {
    const root = new MemoryDirectory();
    const store = new OpfsBinaryStageStore(async () => root as never);
    const descriptor = await createStagedBinaryAssetDescriptor({
      assetId: `chatgpt-asset-${'a'.repeat(64)}`,
      mediaType: 'application/octet-stream',
      bytes: new Uint8Array([1]),
    });
    if (!descriptor) throw new Error('fixture descriptor');
    await store.begin(stageId, descriptor);
    const directory = root.children.get('liska-binary-stages');
    if (!directory) throw new Error('fixture directory');
    directory.removeEntry = async () => {
      throw new DOMException('storage unavailable', 'InvalidStateError');
    };

    await expect(store.abort(stageId)).rejects.toThrow('storage unavailable');
  });
});
