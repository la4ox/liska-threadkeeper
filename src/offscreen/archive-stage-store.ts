/**
 * Injectable OPFS store for raw/canonical archive-response stages.
 *
 * The store owns only exact entries inside `liska-archive-stages`. It neither
 * knows archive destinations nor marks a stage COMMITTED: orchestration does
 * that after consuming a SEALED stage. Metadata contains integrity claims and
 * progress only, never response bytes or other archive content.
 */

import {
  ARCHIVE_STAGE_CHUNK_BYTES,
  ARCHIVE_STAGE_MAX_BYTES,
  type ArchiveStageDescriptor,
  equalArchiveStageDescriptor,
  isArchiveStageDescriptor,
  isSafeArchiveStageId,
} from '../lib/archive-stage-contract';
import { sha256Hex } from '../lib/sha256';

export const ARCHIVE_STAGE_DIRECTORY_NAME = 'liska-archive-stages';
export const ARCHIVE_STAGE_PRUNE_LIMIT = 20;
export const ARCHIVE_STAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type ArchiveStageState = 'OPEN' | 'SEALED';

interface ArchiveStageMetadata {
  stageId: string;
  descriptor: ArchiveStageDescriptor;
  bytesWritten: number;
  createdAt: number;
  state: ArchiveStageState;
}

interface OpfsWritable {
  write(data: Uint8Array | { type: 'write'; position: number; data: Uint8Array }): Promise<void>;
  close(): Promise<void>;
}

interface OpfsFileHandle {
  kind: 'file';
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<OpfsWritable>;
}

interface OpfsDirectoryHandle {
  kind: 'directory';
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>;
  removeEntry(name: string): Promise<void>;
  values(): AsyncIterableIterator<OpfsFileHandle | OpfsDirectoryHandle>;
}

export interface ArchiveStageStore {
  begin(stageId: string, descriptor: ArchiveStageDescriptor): Promise<void>;
  append(stageId: string, offset: number, bytes: Uint8Array): Promise<void>;
  seal(stageId: string, descriptor: ArchiveStageDescriptor): Promise<void>;
  openSealed(stageId: string, descriptor: ArchiveStageDescriptor): Promise<File>;
  read(stageId: string, offset: number, byteLength: number): Promise<Uint8Array>;
  abort(stageId: string): Promise<void>;
  pruneStale(now?: number): Promise<void>;
}

function dataEntry(stageId: string): string {
  return `${stageId}.bin`;
}

function metadataEntry(stageId: string): string {
  return `${stageId}.json`;
}

function hasExactOwnKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
  );
}

function isArchiveStageMetadata(value: unknown): value is ArchiveStageMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  return (
    hasExactOwnKeys(metadata, ['stageId', 'descriptor', 'bytesWritten', 'createdAt', 'state']) &&
    isSafeArchiveStageId(metadata.stageId) &&
    isArchiveStageDescriptor(metadata.descriptor) &&
    Number.isSafeInteger(metadata.bytesWritten) &&
    (metadata.bytesWritten as number) >= 0 &&
    (metadata.bytesWritten as number) <=
      (metadata.descriptor as ArchiveStageDescriptor).byteLength &&
    Number.isSafeInteger(metadata.createdAt) &&
    (metadata.createdAt as number) >= 0 &&
    (metadata.state === 'OPEN' || metadata.state === 'SEALED') &&
    (metadata.state !== 'SEALED' ||
      metadata.bytesWritten === (metadata.descriptor as ArchiveStageDescriptor).byteLength)
  );
}

function stageIdForEntry(name: string): string | undefined {
  if (!name.endsWith('.bin') && !name.endsWith('.json')) return undefined;
  const suffixLength = name.endsWith('.bin') ? '.bin'.length : '.json'.length;
  const stageId = name.slice(0, -suffixLength);
  return isSafeArchiveStageId(stageId) ? stageId : undefined;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

function isExactSliceEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function closeAfterWrite(writable: OpfsWritable, bytes: Uint8Array): Promise<void> {
  try {
    await writable.write(bytes);
  } finally {
    await writable.close();
  }
}

/** See ArchiveStageStore for the narrow response/archive-stage API. */
export class OpfsArchiveStageStore implements ArchiveStageStore {
  private readonly root: () => Promise<OpfsDirectoryHandle>;

  constructor(root?: () => Promise<OpfsDirectoryHandle>) {
    this.root = root ?? defaultOpfsRoot;
  }

  async begin(stageId: string, descriptor: ArchiveStageDescriptor): Promise<void> {
    if (!isSafeArchiveStageId(stageId) || !isArchiveStageDescriptor(descriptor)) {
      throw new Error('invalid archive stage');
    }
    await this.pruneStale();
    const directory = await this.stageDirectory(true);
    if (
      (await this.entryExists(directory, dataEntry(stageId))) ||
      (await this.entryExists(directory, metadataEntry(stageId)))
    ) {
      // A stage ID is opaque and single-use. This deliberately fails rather
      // than recreating a fresh-looking stage over a non-stale entry.
      throw new Error('archive stage already exists');
    }

    try {
      const data = await directory.getFileHandle(dataEntry(stageId), { create: true });
      await closeAfterWrite(
        await data.createWritable({ keepExistingData: false }),
        new Uint8Array()
      );
      await this.writeMetadata(directory, {
        stageId,
        descriptor,
        bytesWritten: 0,
        createdAt: Date.now(),
        state: 'OPEN',
      });
    } catch (error) {
      await this.abort(stageId);
      throw error;
    }
  }

  async append(stageId: string, offset: number, bytes: Uint8Array): Promise<void> {
    if (
      !isSafeArchiveStageId(stageId) ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength > ARCHIVE_STAGE_CHUNK_BYTES
    ) {
      throw new Error('invalid archive stage append');
    }
    const directory = await this.stageDirectory(false);
    const metadata = await this.readMetadata(directory, stageId);
    if (!metadata || metadata.state !== 'OPEN') throw new Error('archive stage unavailable');

    const data = await this.openExactData(directory, stageId, metadata.bytesWritten);
    const endOffset = offset + bytes.byteLength;
    if (!Number.isSafeInteger(endOffset) || endOffset > ARCHIVE_STAGE_MAX_BYTES) {
      throw new Error('archive stage exceeds descriptor');
    }
    if (offset < metadata.bytesWritten) {
      // An MV3 retry may repeat an already acknowledged chunk. We acknowledge
      // only a fully written range and prove byte-for-byte equality from the
      // bounded local file slice; partial overlaps are rejected rather than
      // guessing which suffix was accepted before worker suspension.
      if (endOffset > metadata.bytesWritten || !(await this.matchesExisting(data, offset, bytes))) {
        throw new Error('archive stage offset mismatch');
      }
      return;
    }
    if (offset !== metadata.bytesWritten) throw new Error('archive stage offset mismatch');
    if (endOffset > metadata.descriptor.byteLength) {
      throw new Error('archive stage exceeds descriptor');
    }

    const writable = await data.createWritable({ keepExistingData: true });
    try {
      await writable.write({ type: 'write', position: offset, data: bytes });
    } finally {
      await writable.close();
    }
    await this.writeMetadata(directory, { ...metadata, bytesWritten: endOffset });
  }

  async seal(stageId: string, descriptor: ArchiveStageDescriptor): Promise<void> {
    if (!isSafeArchiveStageId(stageId) || !isArchiveStageDescriptor(descriptor)) {
      throw new Error('invalid archive stage');
    }
    const directory = await this.stageDirectory(false);
    const metadata = await this.readMetadata(directory, stageId);
    if (
      metadata?.state === 'SEALED' &&
      equalArchiveStageDescriptor(metadata.descriptor, descriptor) &&
      metadata.bytesWritten === descriptor.byteLength
    ) {
      // A lost MV3 acknowledgement may repeat the exact terminal transition.
      // Re-open the immutable sealed file and acknowledge only exact metadata.
      await this.openSealed(stageId, descriptor);
      return;
    }
    if (
      !metadata ||
      metadata.state !== 'OPEN' ||
      !equalArchiveStageDescriptor(metadata.descriptor, descriptor) ||
      metadata.bytesWritten !== descriptor.byteLength
    ) {
      throw new Error('archive stage metadata mismatch');
    }
    const file = await (await directory.getFileHandle(dataEntry(stageId))).getFile();
    if (file.size !== descriptor.byteLength) throw new Error('archive stage length mismatch');
    const digest = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
    if (digest !== descriptor.sha256) throw new Error('archive stage hash mismatch');
    await this.writeMetadata(directory, { ...metadata, state: 'SEALED' });
  }

  async openSealed(stageId: string, descriptor: ArchiveStageDescriptor): Promise<File> {
    if (!isSafeArchiveStageId(stageId) || !isArchiveStageDescriptor(descriptor)) {
      throw new Error('invalid archive stage');
    }
    const directory = await this.stageDirectory(false);
    const metadata = await this.readMetadata(directory, stageId);
    if (
      !metadata ||
      metadata.state !== 'SEALED' ||
      !equalArchiveStageDescriptor(metadata.descriptor, descriptor) ||
      metadata.bytesWritten !== descriptor.byteLength
    ) {
      throw new Error('archive stage metadata mismatch');
    }
    const file = await (await directory.getFileHandle(dataEntry(stageId))).getFile();
    if (file.size !== descriptor.byteLength) throw new Error('archive stage length mismatch');
    return file;
  }

  async read(stageId: string, offset: number, byteLength: number): Promise<Uint8Array> {
    if (
      !isSafeArchiveStageId(stageId) ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0 ||
      byteLength > ARCHIVE_STAGE_CHUNK_BYTES
    ) {
      throw new Error('invalid archive stage read');
    }
    const directory = await this.stageDirectory(false);
    const metadata = await this.readMetadata(directory, stageId);
    const endOffset = offset + byteLength;
    if (
      !metadata ||
      metadata.state !== 'SEALED' ||
      !Number.isSafeInteger(endOffset) ||
      endOffset > metadata.descriptor.byteLength
    ) {
      throw new Error('archive stage unavailable');
    }
    const file = await (await directory.getFileHandle(dataEntry(stageId))).getFile();
    if (file.size !== metadata.descriptor.byteLength)
      throw new Error('archive stage length mismatch');
    const bytes = new Uint8Array(await file.slice(offset, endOffset).arrayBuffer());
    if (bytes.byteLength !== byteLength) throw new Error('archive stage read mismatch');
    return bytes;
  }

  async abort(stageId: string): Promise<void> {
    if (!isSafeArchiveStageId(stageId)) throw new Error('invalid archive stage');
    let directory: OpfsDirectoryHandle;
    try {
      directory = await this.stageDirectory(false);
    } catch (error) {
      if (isNotFoundError(error)) return;
      throw error;
    }
    await Promise.all([
      this.removeExact(directory, dataEntry(stageId)),
      this.removeExact(directory, metadataEntry(stageId)),
    ]);
  }

  async pruneStale(now = Date.now()): Promise<void> {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('invalid archive stage clock');
    let directory: OpfsDirectoryHandle;
    try {
      directory = await this.stageDirectory(false);
    } catch (error) {
      if (isNotFoundError(error)) return;
      throw error;
    }

    let inspected = 0;
    let cleaned = 0;
    const seen = new Set<string>();
    for await (const entry of directory.values()) {
      if (entry.kind !== 'file') continue;
      const stageId = stageIdForEntry(stageEntryName(entry));
      if (!stageId || seen.has(stageId)) continue;
      seen.add(stageId);
      if (inspected >= ARCHIVE_STAGE_PRUNE_LIMIT || cleaned >= ARCHIVE_STAGE_PRUNE_LIMIT) return;
      inspected += 1;
      if (await this.isStale(directory, stageId, now)) {
        await this.abort(stageId);
        cleaned += 1;
      }
    }
  }

  private async stageDirectory(create: boolean): Promise<OpfsDirectoryHandle> {
    return (await this.root()).getDirectoryHandle(ARCHIVE_STAGE_DIRECTORY_NAME, { create });
  }

  private async entryExists(directory: OpfsDirectoryHandle, entry: string): Promise<boolean> {
    try {
      await directory.getFileHandle(entry);
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }

  private async openExactData(
    directory: OpfsDirectoryHandle,
    stageId: string,
    expectedSize: number
  ): Promise<OpfsFileHandle> {
    const data = await directory.getFileHandle(dataEntry(stageId));
    if ((await data.getFile()).size !== expectedSize)
      throw new Error('archive stage length mismatch');
    return data;
  }

  private async matchesExisting(
    data: OpfsFileHandle,
    offset: number,
    expected: Uint8Array
  ): Promise<boolean> {
    const existing = new Uint8Array(
      await (await data.getFile()).slice(offset, offset + expected.byteLength).arrayBuffer()
    );
    return isExactSliceEqual(existing, expected);
  }

  private async isStale(
    directory: OpfsDirectoryHandle,
    stageId: string,
    now: number
  ): Promise<boolean> {
    const lastModified = await Promise.all([
      this.entryLastModified(directory, dataEntry(stageId)),
      this.entryLastModified(directory, metadataEntry(stageId)),
    ]);
    const existingEntries = lastModified.filter((value): value is number => value !== undefined);
    if (
      existingEntries.length === 0 ||
      existingEntries.some(value => now - value < ARCHIVE_STAGE_MAX_AGE_MS)
    ) {
      return false;
    }
    const metadata = await this.readMetadata(directory, stageId);
    return !metadata || now - metadata.createdAt >= ARCHIVE_STAGE_MAX_AGE_MS;
  }

  private async entryLastModified(
    directory: OpfsDirectoryHandle,
    entry: string
  ): Promise<number | undefined> {
    try {
      const lastModified = (await (await directory.getFileHandle(entry)).getFile()).lastModified;
      return Number.isSafeInteger(lastModified) && lastModified >= 0 ? lastModified : undefined;
    } catch (error) {
      if (isNotFoundError(error)) return undefined;
      return undefined;
    }
  }

  private async readMetadata(
    directory: OpfsDirectoryHandle,
    stageId: string
  ): Promise<ArchiveStageMetadata | undefined> {
    try {
      const text = await (await directory.getFileHandle(metadataEntry(stageId)))
        .getFile()
        .then(file => file.text());
      const metadata: unknown = JSON.parse(text);
      return isArchiveStageMetadata(metadata) && metadata.stageId === stageId
        ? metadata
        : undefined;
    } catch {
      return undefined;
    }
  }

  private async writeMetadata(
    directory: OpfsDirectoryHandle,
    metadata: ArchiveStageMetadata
  ): Promise<void> {
    const handle = await directory.getFileHandle(metadataEntry(metadata.stageId), { create: true });
    const bytes = new TextEncoder().encode(JSON.stringify(metadata));
    await closeAfterWrite(await handle.createWritable({ keepExistingData: false }), bytes);
  }

  private async removeExact(directory: OpfsDirectoryHandle, entry: string): Promise<void> {
    try {
      await directory.removeEntry(entry);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }
}

async function defaultOpfsRoot(): Promise<OpfsDirectoryHandle> {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<OpfsDirectoryHandle>;
  };
  if (typeof storage.getDirectory !== 'function') throw new Error('OPFS is unavailable');
  return storage.getDirectory() as unknown as Promise<OpfsDirectoryHandle>;
}

function stageEntryName(entry: OpfsFileHandle): string {
  const name = (entry as OpfsFileHandle & { name?: unknown }).name;
  return typeof name === 'string' ? name : '';
}
