import { SNAPSHOT_ANALYSIS_HARD_LIMITS as LIMITS } from '../archive/snapshots/contracts';
import type { SnapshotByteInventory } from '../archive/snapshots/contracts';

export type SelectionFailure = 'selection-invalid' | 'selection-limit' | 'selection-read-failed';

/** Fixed codes only: File/path/error values never become UI diagnostics. */
export class SelectionError extends Error {
  constructor(readonly code: SelectionFailure) {
    super(code);
  }
}

export interface SelectedFile {
  readonly slot: string;
  readonly size: number;
  readonly read: () => Promise<ArrayBuffer>;
}

export interface SelectedSnapshot {
  readonly files: readonly SelectedFile[];
  readonly byteLength: number;
}

export interface ReadProgress {
  readonly files: number;
  readonly bytes: number;
  readonly totalFiles: number;
  readonly totalBytes: number;
}

function invalid(): never {
  throw new SelectionError('selection-invalid');
}

function pathSegments(path: string): string[] {
  if (typeof path !== 'string' || path.length === 0 || path.length > 512) invalid();
  if (
    /[\\:]/u.test(path) ||
    [...path].some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
  )
    invalid();
  const segments = path.split('/');
  if (segments.some(part => !part || part === '.' || part === '..' || /[.\s]$/u.test(part)))
    invalid();
  return segments;
}

function fileSize(file: File): number {
  const size = file.size;
  if (!Number.isSafeInteger(size) || size < 0 || typeof file.arrayBuffer !== 'function') invalid();
  return size;
}

/** Called synchronously in the trusted picker-change handler, before any await. */
export function snapshotSelectedFiles(list: FileList | readonly File[]): SelectedSnapshot {
  try {
    if (!Number.isSafeInteger(list.length) || list.length < 1) invalid();
    if (list.length > LIMITS.maxFilesPerSnapshot) throw new SelectionError('selection-limit');
    const files: SelectedFile[] = [];
    const slots = new Set<string>();
    let root: string | undefined;
    let byteLength = 0;
    for (let index = 0; index < list.length; index += 1) {
      const file = list[index];
      const parts = pathSegments(file.webkitRelativePath);
      if (parts.length < 2 || (root !== undefined && parts[0] !== root)) invalid();
      root = parts[0];
      const slot = parts.slice(1).join('/');
      if (slots.has(slot.toLowerCase())) invalid();
      slots.add(slot.toLowerCase());
      const size = fileSize(file);
      byteLength += size;
      if (size > LIMITS.maxFileBytes || byteLength > LIMITS.maxTotalBytes)
        throw new SelectionError('selection-limit');
      const read = file.arrayBuffer.bind(file);
      files.push(Object.freeze({ slot, size, read }));
    }
    return Object.freeze({ files: Object.freeze(files), byteLength });
  } catch (error) {
    if (error instanceof SelectionError) throw error;
    invalid();
  }
}

/** No file body is read until every snapshot has passed this whole-operation preflight. */
export function preflightSelection(
  snapshots: readonly SelectedSnapshot[],
  requirePair = true
): { totalFiles: number; totalBytes: number } {
  if (snapshots.length < (requirePair ? 2 : 1)) invalid();
  if (snapshots.length > LIMITS.maxSnapshots) throw new SelectionError('selection-limit');
  let totalFiles = 0;
  let totalBytes = 0;
  for (const snapshot of snapshots) {
    const slots = new Set<string>();
    if (!snapshot.files.length) invalid();
    if (snapshot.files.length > LIMITS.maxFilesPerSnapshot)
      throw new SelectionError('selection-limit');
    for (const file of snapshot.files) {
      pathSegments(file.slot);
      if (slots.has(file.slot.toLowerCase())) invalid();
      slots.add(file.slot.toLowerCase());
      if (!Number.isSafeInteger(file.size) || file.size < 0) invalid();
      totalFiles += 1;
      totalBytes += file.size;
      if (
        file.size > LIMITS.maxFileBytes ||
        totalFiles > LIMITS.maxTotalFiles ||
        totalBytes > LIMITS.maxTotalBytes
      )
        throw new SelectionError('selection-limit');
    }
  }
  return { totalFiles, totalBytes };
}

export function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('snapshot-operation-cancelled');
}

export async function readSelectedSnapshots(
  snapshots: readonly SelectedSnapshot[],
  signal: AbortSignal,
  progress: (value: ReadProgress) => void
): Promise<SnapshotByteInventory[]> {
  const totals = preflightSelection(snapshots);
  const result: SnapshotByteInventory[] = [];
  let files = 0;
  let bytes = 0;
  throwIfCancelled(signal);
  for (const snapshot of snapshots) {
    const inventory: { relativePath: string; bytes: Uint8Array }[] = [];
    for (const selected of snapshot.files) {
      throwIfCancelled(signal);
      let buffer: ArrayBuffer;
      try {
        buffer = await selected.read();
        throwIfCancelled(signal);
        if (buffer.byteLength !== selected.size) throw new Error();
        inventory.push({ relativePath: selected.slot, bytes: new Uint8Array(buffer) });
      } catch {
        throwIfCancelled(signal);
        throw new SelectionError('selection-read-failed');
      }
      files += 1;
      bytes += selected.size;
      progress({ files, bytes, ...totals });
    }
    result.push({ files: inventory });
  }
  return result;
}
