import { encodeSnapshotCatalog } from '../../archive/catalog/encode';
import type { SnapshotCatalog } from '../../archive/catalog/contracts';

export const MAX_CATALOG_BYTES = 1024 * 1024;
export interface AdmissionIdentity {
  readonly provider: string;
  readonly conversationId: string;
  readonly conversationKey: string;
}
export interface AdmissionCounts {
  readonly conversations: number;
  readonly skipped: number;
  readonly duplicates: number;
  readonly captures: number;
}
export interface CatalogAdmission {
  readonly catalogSha256: string;
  readonly identities: readonly AdmissionIdentity[];
  readonly counts: AdmissionCounts;
}
export class AdmissionError extends Error {
  constructor(
    readonly code: 'selection-invalid' | 'selection-limit' | 'catalog-invalid' | 'hash-failed'
  ) {
    super(code);
  }
}

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

function projectIdentities(catalog: SnapshotCatalog) {
  const identities = new Map<string, AdmissionIdentity>();
  let skipped = 0;
  let captures = 0;
  for (const entry of catalog.entries) {
    if (entry.manifestValidity !== 'valid') {
      skipped += entry.occurrenceCount;
      continue;
    }
    captures += entry.occurrenceCount;
    const { provider, conversationId, conversationKey } = entry;
    identities.set(
      JSON.stringify([provider, conversationId]),
      Object.freeze({
        provider: provider!,
        conversationId: conversationId!,
        conversationKey: conversationKey!,
      })
    );
  }
  return {
    identities: Object.freeze([...identities.values()]),
    counts: Object.freeze({
      conversations: identities.size,
      skipped,
      duplicates: captures - identities.size,
      captures,
    }),
  };
}

/** Rebuild with the existing strict encoder, then require its exact canonical bytes. */
export async function admitCatalog(
  input: Uint8Array,
  signal: AbortSignal,
  hash: typeof sha256 = sha256
): Promise<CatalogAdmission> {
  const bytes = new Uint8Array(input);
  if (!bytes.length || bytes.length > MAX_CATALOG_BYTES)
    throw new AdmissionError('selection-limit');
  let catalog: SnapshotCatalog;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const canonical = encodeSnapshotCatalog(JSON.parse(text), {
      maxOutputBytes: MAX_CATALOG_BYTES,
    });
    if (canonical.length !== bytes.length || !canonical.every((byte, i) => byte === bytes[i]))
      throw new Error();
    catalog = JSON.parse(new TextDecoder().decode(canonical)) as SnapshotCatalog;
  } catch {
    throw new AdmissionError('catalog-invalid');
  }
  const projected = projectIdentities(catalog);
  const catalogSha256 = await hash(bytes.slice(), signal);
  if (signal.aborted || !/^[a-f0-9]{64}$/u.test(catalogSha256))
    throw new AdmissionError('hash-failed');
  return Object.freeze({
    catalogSha256,
    ...projected,
  });
}
