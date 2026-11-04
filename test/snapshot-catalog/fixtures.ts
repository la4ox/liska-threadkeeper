import { vi } from 'vitest';
import type { SnapshotCatalog } from '../../src/archive/catalog';

export const TRUSTED = { isTrusted: true };
export const UNTRUSTED = { isTrusted: false };
export const CANARY = 'PRIVATE_folder_filename_text_error_CANARY';

export function picked(path: string, text = '{}', size?: number) {
  const bytes = new Uint8Array(new TextEncoder().encode(text));
  const file = new File([text], path.split('/').at(-1) ?? 'synthetic');
  const read = vi.fn(async () => bytes.slice().buffer);
  Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true });
  Object.defineProperty(file, 'arrayBuffer', { value: read, configurable: true });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size, configurable: true });
  return { file, read, bytes };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function catalog(): SnapshotCatalog {
  const aggregate = {
    count: 0,
    declaredBytes: 0,
    presentCount: 0,
    presentBytes: 0,
    sizeMatchCount: 0,
    missingCount: 0,
    sizeMismatchCount: 0,
  };
  return {
    schema: 'liska-snapshot-catalog/1',
    algorithmVersion: 'manifest-metadata/1',
    conversationKeyVersion: 'liska-conversation-key/1',
    analysisOnly: true,
    mutationAuthorized: false,
    referenceCoverage: 'selected-inputs-only',
    fileEvidence: 'metadata-only-not-content-verified',
    accountBinding: 'not-recorded-in-liska-capture-1',
    selectedFileCount: 4,
    selectedManifestCount: 1,
    unassociatedFileCount: 1,
    entries: [
      {
        manifestValidity: 'valid',
        manifestSha256: 'a'.repeat(64),
        manifestByteLength: 2,
        provider: 'chatgpt',
        conversationId: CANARY,
        conversationKey: 'liska-conversation-key/1:' + 'b'.repeat(64),
        captureId: CANARY,
        capturedAt: '2026-11-04T00:00:00.000Z',
        method: 'same-origin-api',
        declaredCompleteness: {
          graph: 'complete',
          messages: 'partial',
          branches: 'unknown',
          assets: 'not-attempted',
        },
        artifacts: { ...aggregate },
        assets: { ...aggregate, recordCount: 0 },
        canonical: { presence: 'present-unverified', byteLength: 2, declaredFileRole: null },
        associatedFileCount: 3,
        extraFileCount: 1,
        extraFileBytes: 2,
        issueCodes: ['extra-files'],
        occurrenceCount: 1,
      },
    ],
  };
}
