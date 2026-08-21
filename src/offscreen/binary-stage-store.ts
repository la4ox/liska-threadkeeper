/**
 * Small injectable OPFS adapter for staged binary archive assets.
 *
 * Only the dedicated `liska-binary-stages` directory is ever opened. Every
 * cleanup operation names one validated stage ID and removes its two exact
 * entries; there is deliberately no recursive or root-level deletion.
 */

import {
  BINARY_STAGE_MAX_AGE_MS,
  BINARY_STAGE_PRUNE_LIMIT,
  MAX_STAGED_BINARY_ASSET_BYTES,
} from '../lib/constants';
import {
  equalStagedBinaryAssetDescriptor,
  isSafeBinaryStageId,
  isStagedBinaryAssetDescriptor,
  sha256Hex,
} from '../lib/binary-asset-contract';
import type { StagedBinaryAssetDescriptor } from '../lib/types';

const STAGE_DIRECTORY_NAME = 'liska-binary-stages';

interface StageMetadata {
  stageId: string;
  descriptor: StagedBinaryAssetDescriptor;
  bytesWritten: number;
  createdAt: number;
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

export interface BinaryStageStore {
  begin(stageId: string, descriptor: StagedBinaryAssetDescriptor): Promise<void>;
  append(stageId: string, offset: number, bytes: Uint8Array): Promise<void>;
  finalize(stageId: string, descriptor: StagedBinaryAssetDescriptor): Promise<File>;
  abort(stageId: string): Promise<void>;
  pruneStale(now?: number): Promise<void>;
}

function dataEntry(stageId: string): string {
  return `${stageId}.bin`;
}

function metadataEntry(stageId: string): string {
  return `${stageId}.json`;
}

function isStageMetadata(value: unknown): value is StageMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  return (
    Object.keys(metadata).length === 4 &&
    Object.prototype.hasOwnProperty.call(metadata, 'stageId') &&
    Object.prototype.hasOwnProperty.call(metadata, 'descriptor') &&
    Object.prototype.hasOwnProperty.call(metadata, 'bytesWritten') &&
    Object.prototype.hasOwnProperty.call(metadata, 'createdAt') &&
    isSafeBinaryStageId(metadata.stageId) &&
    isStagedBinaryAssetDescriptor(metadata.descriptor) &&
    Number.isSafeInteger(metadata.bytesWritten) &&
    (metadata.bytesWritten as number) >= 0 &&
    (metadata.bytesWritten as number) <=
      (metadata.descriptor as StagedBinaryAssetDescriptor).byteLength &&
    Number.isSafeInteger(metadata.createdAt) &&
    (metadata.createdAt as number) >= 0
  );
}

function stageIdForMetadataEntry(name: string): string | undefined {
  if (!name.endsWith('.json')) return undefined;
  const stageId = name.slice(0, -'.json'.length);
  return isSafeBinaryStageId(stageId) ? stageId : undefined;
}

function stageIdForDataEntry(name: string): string | undefined {
  if (!name.endsWith('.bin')) return undefined;
  const stageId = name.slice(0, -'.bin'.length);
  return isSafeBinaryStageId(stageId) ? stageId : undefined;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

async function closeAfterWrite(writable: OpfsWritable, data: Uint8Array): Promise<void> {
  try {
    await writable.write(data);
  } finally {
    await writable.close();
  }
}

export class OpfsBinaryStageStore implements BinaryStageStore {
  private readonly root: () => Promise<OpfsDirectoryHandle>;

  constructor(root?: () => Promise<OpfsDirectoryHandle>) {
    this.root = root ?? defaultOpfsRoot;
  }

  async begin(stageId: string, descriptor: StagedBinaryAssetDescriptor): Promise<void> {
    if (!isSafeBinaryStageId(stageId) || !isStagedBinaryAssetDescriptor(descriptor)) {
      throw new Error('invalid binary stage');
    }
    await this.pruneStale();
    const directory = await this.stageDirectory(true);
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
      });
    } catch (error) {
      await this.abort(stageId);
      throw error;
    }
  }

  async append(stageId: string, offset: number, bytes: Uint8Array): Promise<void> {
    if (!isSafeBinaryStageId(stageId) || !Number.isSafeInteger(offset) || offset < 0) {
      throw new Error('invalid binary stage append');
    }
    const directory = await this.stageDirectory(false);
    const metadata = await this.readMetadata(directory, stageId);
    if (!metadata || offset !== metadata.bytesWritten || !(bytes instanceof Uint8Array)) {
      throw new Error('binary stage offset mismatch');
    }
    const nextOffset = offset + bytes.byteLength;
    if (nextOffset > metadata.descriptor.byteLength || nextOffset > MAX_STAGED_BINARY_ASSET_BYTES) {
      throw new Error('binary stage exceeds descriptor');
    }
    const data = await directory.getFileHandle(dataEntry(stageId));
    const writable = await data.createWritable({ keepExistingData: true });
    try {
      await writable.write({ type: 'write', position: offset, data: bytes });
    } finally {
      await writable.close();
    }
    await this.writeMetadata(directory, { ...metadata, bytesWritten: nextOffset });
  }

  async finalize(stageId: string, descriptor: StagedBinaryAssetDescriptor): Promise<File> {
    if (!isSafeBinaryStageId(stageId) || !isStagedBinaryAssetDescriptor(descriptor)) {
      throw new Error('invalid binary stage');
    }
    const directory = await this.stageDirectory(false);
    const metadata = await this.readMetadata(directory, stageId);
    if (
      !metadata ||
      !equalStagedBinaryAssetDescriptor(metadata.descriptor, descriptor) ||
      metadata.bytesWritten !== descriptor.byteLength
    ) {
      throw new Error('binary stage metadata mismatch');
    }
    const file = await (await directory.getFileHandle(dataEntry(stageId))).getFile();
    if (file.size !== descriptor.byteLength) throw new Error('binary stage length mismatch');
    const digest = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
    if (digest !== descriptor.sha256) throw new Error('binary stage hash mismatch');
    return file;
  }

  async abort(stageId: string): Promise<void> {
    if (!isSafeBinaryStageId(stageId)) throw new Error('invalid binary stage');
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
    let directory: OpfsDirectoryHandle;
    try {
      directory = await this.stageDirectory(false);
    } catch {
      return;
    }
    let inspected = 0;
    let cleaned = 0;
    const seenStages = new Set<string>();
    for await (const entry of directory.values()) {
      if (inspected >= BINARY_STAGE_PRUNE_LIMIT || cleaned >= BINARY_STAGE_PRUNE_LIMIT) return;
      inspected += 1;
      if (entry.kind !== 'file') continue;
      const entryName = stageEntryName(entry);
      const stageId = stageIdForMetadataEntry(entryName) ?? stageIdForDataEntry(entryName);
      if (!stageId || seenStages.has(stageId)) continue;
      seenStages.add(stageId);

      // Never treat a concurrently-written metadata/data entry as stale merely
      // because it is temporarily unreadable. The entry itself must first age
      // past the same bounded retention window.
      let entryLastModified: number;
      try {
        entryLastModified = (await entry.getFile()).lastModified;
      } catch {
        continue;
      }
      if (now - entryLastModified < BINARY_STAGE_MAX_AGE_MS) continue;

      const metadata = await this.readMetadata(directory, stageId);
      if (!metadata) {
        await this.abort(stageId);
        cleaned += 1;
        continue;
      }
      if (now - metadata.createdAt < BINARY_STAGE_MAX_AGE_MS) continue;
      await this.abort(stageId);
      cleaned += 1;
    }
  }

  private async stageDirectory(create: boolean): Promise<OpfsDirectoryHandle> {
    return (await this.root()).getDirectoryHandle(STAGE_DIRECTORY_NAME, { create });
  }

  private async readMetadata(
    directory: OpfsDirectoryHandle,
    stageId: string
  ): Promise<StageMetadata | undefined> {
    try {
      const text = await (await directory.getFileHandle(metadataEntry(stageId)))
        .getFile()
        .then(file => file.text());
      const metadata: unknown = JSON.parse(text);
      return isStageMetadata(metadata) && metadata.stageId === stageId ? metadata : undefined;
    } catch {
      return undefined;
    }
  }

  private async writeMetadata(
    directory: OpfsDirectoryHandle,
    metadata: StageMetadata
  ): Promise<void> {
    const handle = await directory.getFileHandle(metadataEntry(metadata.stageId), { create: true });
    const bytes = new TextEncoder().encode(JSON.stringify(metadata));
    await closeAfterWrite(await handle.createWritable({ keepExistingData: false }), bytes);
  }

  private async removeExact(directory: OpfsDirectoryHandle, entry: string): Promise<void> {
    try {
      await directory.removeEntry(entry);
    } catch (error) {
      // An absent exact entry is already cleaned. Real OPFS failures must
      // propagate so callers never report an unconfirmed cleanup as complete.
      if (!isNotFoundError(error)) throw error;
    }
  }
}

async function defaultOpfsRoot(): Promise<OpfsDirectoryHandle> {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<OpfsDirectoryHandle>;
  };
  if (typeof storage.getDirectory !== 'function') throw new Error('OPFS is unavailable');
  // TypeScript's DOM snapshot knows `getDirectory()` but not Chrome's async
  // directory iterator; production Chrome 111 implements both.
  return storage.getDirectory() as unknown as Promise<OpfsDirectoryHandle>;
}

function stageEntryName(entry: OpfsFileHandle): string {
  // FileSystemHandle.name is omitted from the small adapter because its only
  // production consumer is stale pruning. Chrome implements it for OPFS.
  const name = (entry as OpfsFileHandle & { name?: unknown }).name;
  return typeof name === 'string' ? name : '';
}
