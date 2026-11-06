import {
  AdmissionError,
  MAX_CATALOG_BYTES,
  admitCanonicalCatalog,
  type CatalogAdmission,
} from '../../archive/catalog/admission';
export {
  AdmissionError,
  MAX_CATALOG_BYTES,
  type AdmissionIdentity,
  type AdmissionCounts,
  type CatalogAdmission,
} from '../../archive/catalog/admission';

/** Capture the immutable Blob and reader before the first await; retain no name/path. */
export function snapshotCatalogFile(files: FileList | readonly File[]): () => Promise<Uint8Array> {
  if (files.length !== 1) throw new AdmissionError('selection-invalid');
  const file = files[0];
  const size = file.size;
  if (!Number.isSafeInteger(size) || size < 1) throw new AdmissionError('selection-invalid');
  if (size > MAX_CATALOG_BYTES) throw new AdmissionError('selection-limit');
  const blob = file.slice(0, size);
  const read = blob.arrayBuffer.bind(blob);
  return async () => {
    const buffer = await read();
    const bytes = new Uint8Array(buffer).slice();
    if (bytes.byteLength !== size) throw new AdmissionError('selection-invalid');
    return bytes;
  };
}

export async function sha256(bytes: Uint8Array, signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw new AdmissionError('hash-failed');
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  if (signal.aborted) throw new AdmissionError('hash-failed');
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Preserve the page API while sharing only the exact canonical data admission. */
export function admitCatalog(
  input: Uint8Array,
  signal: AbortSignal,
  hash: typeof sha256 = sha256
): Promise<CatalogAdmission> {
  return admitCanonicalCatalog(input, signal, hash);
}
