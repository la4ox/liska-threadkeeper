import { CATALOG_PAGE_LIMITS as LIMITS } from './limits';

const bufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

export type SelectionFailure = 'selection-invalid' | 'selection-limit' | 'selection-read-failed';

/** Only fixed codes may cross into the UI. */
export class SelectionError extends Error {
  constructor(readonly code: SelectionFailure) {
    super(code);
  }
}

export interface SelectedFile {
  readonly relativePath: string;
  readonly byteLength: number;
  /** Absent for every non-manifest: not even its reader is inspected or bound. */
  readonly readManifest?: () => Promise<ArrayBuffer>;
}

export interface SelectedArchive {
  readonly files: readonly SelectedFile[];
}

export interface SelectionTotals {
  readonly files: number;
  readonly bytes: number;
  readonly manifests: number;
  readonly manifestBytes: number;
}

export interface ReadProgress {
  readonly manifests: number;
  readonly bytes: number;
  readonly totalManifests: number;
  readonly totalBytes: number;
}

export interface CatalogFileInput {
  readonly relativePath: string;
  readonly byteLength: number;
}

export interface ReadCatalogInput {
  readonly files: CatalogFileInput[];
  readonly manifests: { relativePath: string; bytes: Uint8Array }[];
}

function invalid(): never {
  throw new SelectionError('selection-invalid');
}

function parts(value: string): string[] {
  if (typeof value !== 'string' || !value || value.length > LIMITS.maxPathLength) invalid();
  if (
    /[\\:*?"<>|\u202a-\u202e\u2066-\u2069]/u.test(value) ||
    [...value].some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
  )
    invalid();
  const segments = value.split('/');
  if (
    segments.some(
      segment =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        /[.\s]$/u.test(segment) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment)
    )
  )
    invalid();
  return segments;
}

function isManifest(path: string): boolean {
  const segments = path.split('/');
  const basename = segments[segments.length - 1];
  if (basename.toLowerCase() === 'manifest.json' && basename !== 'manifest.json') invalid();
  return basename === 'manifest.json';
}

function validateSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) invalid();
  if (size > LIMITS.maxFileBytes) throw new SelectionError('selection-limit');
}

/** Snapshot the entire picker synchronously in the trusted change handler. */
export function snapshotSelectedArchive(list: FileList | readonly File[]): SelectedArchive {
  try {
    const length = list.length;
    if (!Number.isSafeInteger(length) || length < 1) invalid();
    if (length > LIMITS.maxFiles) throw new SelectionError('selection-limit');
    const files: SelectedFile[] = [];
    let root: string | undefined;
    for (let index = 0; index < length; index += 1) {
      const file = list[index];
      const segments = parts(file.webkitRelativePath);
      if (segments.length < 2 || (root !== undefined && segments[0] !== root)) invalid();
      root = segments[0];
      const relativePath = segments.slice(1).join('/');
      const byteLength = file.size;
      validateSize(byteLength);
      let readManifest: SelectedFile['readManifest'];
      if (isManifest(relativePath)) {
        const reader = file.arrayBuffer;
        if (typeof reader !== 'function') invalid();
        readManifest = reader.bind(file);
      }
      files.push(
        Object.freeze({ relativePath, byteLength, ...(readManifest ? { readManifest } : {}) })
      );
    }
    const archive = Object.freeze({ files: Object.freeze(files) });
    preflightSelection(archive);
    return archive;
  } catch (error) {
    if (error instanceof SelectionError) throw error;
    invalid();
  }
}

/** The full operation passes independent metadata/manifest limits before its first read. */
export function preflightSelection(archive: SelectedArchive): SelectionTotals {
  const count = archive.files.length;
  if (!Number.isSafeInteger(count) || count < 1) invalid();
  if (count > LIMITS.maxFiles) throw new SelectionError('selection-limit');
  const seen = new Set<string>();
  let bytes = 0;
  let manifests = 0;
  let manifestBytes = 0;
  for (const file of archive.files) {
    parts(file.relativePath);
    const folded = file.relativePath.normalize('NFC').toLowerCase();
    if (seen.has(folded)) invalid();
    seen.add(folded);
    validateSize(file.byteLength);
    bytes += file.byteLength;
    if (isManifest(file.relativePath)) {
      if (typeof file.readManifest !== 'function') invalid();
      manifests += 1;
      manifestBytes += file.byteLength;
      if (file.byteLength > LIMITS.maxManifestBytes) throw new SelectionError('selection-limit');
    } else if (file.readManifest !== undefined) invalid();
    if (
      bytes > LIMITS.maxTotalBytes ||
      manifests > LIMITS.maxManifests ||
      manifestBytes > LIMITS.maxTotalManifestBytes
    )
      throw new SelectionError('selection-limit');
  }
  return { files: count, bytes, manifests, manifestBytes };
}

function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('catalog-operation-cancelled');
}

export async function readSelectedManifests(
  archive: SelectedArchive,
  signal: AbortSignal,
  progress: (value: ReadProgress) => void
): Promise<ReadCatalogInput> {
  const totals = preflightSelection(archive);
  const result: ReadCatalogInput = { files: [], manifests: [] };
  let manifests = 0;
  let bytes = 0;
  const report = () =>
    progress({
      manifests,
      bytes,
      totalManifests: totals.manifests,
      totalBytes: totals.manifestBytes,
    });
  cancelled(signal);
  report();
  for (const file of archive.files) {
    cancelled(signal);
    const metadata = { relativePath: file.relativePath, byteLength: file.byteLength };
    result.files.push(metadata);
    if (!file.readManifest) {
      continue;
    }
    try {
      const buffer = await file.readManifest();
      cancelled(signal);
      // Native slots admit cross-realm ArrayBuffers, not forged objects or shared buffers.
      if (bufferByteLength.call(buffer) !== file.byteLength) throw new Error();
      result.manifests.push({ relativePath: file.relativePath, bytes: new Uint8Array(buffer) });
    } catch {
      cancelled(signal);
      throw new SelectionError('selection-read-failed');
    }
    manifests += 1;
    bytes += file.byteLength;
    report();
  }
  return result;
}
