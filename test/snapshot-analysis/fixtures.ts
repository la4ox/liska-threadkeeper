import { vi } from 'vitest';
import type { SnapshotAnalysisPlan } from '../../src/archive/snapshots/contracts';

export const TRUSTED = { isTrusted: true };
export const UNTRUSTED = { isTrusted: false };
export const CANARY = 'PRIVATE_folder_filename_text_error_CANARY';

export function picked(path: string, text = '{}', size?: number) {
  const bytes = new TextEncoder().encode(text);
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

export function plan(): SnapshotAnalysisPlan {
  return {
    schema: 'liska-snapshot-analysis/1',
    algorithmVersion: 'snapshot-evidence/1',
    analysisOnly: true,
    mutationAuthorized: false,
    referenceCoverage: 'selected-inputs-only',
    snapshots: [0, 1].map(ordinal => ({
      ordinal,
      verification: 'verified' as const,
      code: null,
      measuredByteLength: 2,
      fileCount: 1,
      inventorySha256: 'a'.repeat(64),
      preserveReasons: ['first-observed', 'latest-observed', 'external-references-unassessed'],
    })),
    relations: [{ left: 0, right: 1, classification: 'byte-identical', preserveBoth: true }],
  };
}
