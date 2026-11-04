import type { CaptureCompleteness, CaptureMethod } from '../capture';

/** Metadata index only: never a body-integrity verdict or cleanup permission. */
export const SNAPSHOT_CATALOG_SCHEMA = 'liska-snapshot-catalog/1' as const;
export const SNAPSHOT_CATALOG_VERSION = 'manifest-metadata/1' as const;
export const CONVERSATION_KEY_VERSION = 'liska-conversation-key/1' as const;

/** Independent per-operation ceilings; callers may lower, never raise them. */
export const SNAPSHOT_CATALOG_HARD_LIMITS = Object.freeze({
  maxSelectedFiles: 100_000,
  maxManifests: 10_000,
  maxManifestBytes: 1024 * 1024,
  maxTotalManifestBytes: 64 * 1024 * 1024,
  maxRelativePathCodeUnits: 1024,
  maxRecordsPerManifest: 10_000,
  maxTotalRecords: 100_000,
  maxJsonDepth: 32,
  maxJsonValues: 2_000_000,
  maxJsonStringCodeUnits: 32 * 1024 * 1024,
  maxJsonWork: 64 * 1024 * 1024,
  maxHashCalls: 20_000,
  maxHashBytes: 128 * 1024 * 1024,
  maxOutputBytes: 16 * 1024 * 1024,
});

export type SnapshotCatalogLimits = {
  -readonly [K in keyof typeof SNAPSHOT_CATALOG_HARD_LIMITS]: number;
};

export interface SnapshotCatalogFile {
  readonly relativePath: string;
  readonly byteLength: number;
}

export interface SnapshotCatalogManifest {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
}

export interface BuildSnapshotCatalogInput {
  readonly files: readonly SnapshotCatalogFile[];
  readonly manifests: readonly SnapshotCatalogManifest[];
  /**
   * Trusted algorithm, not an I/O capability. Receives a disposable private copy.
   * Rejection, mutation or malformed digests fail closed. Truthfulness cannot be
   * proved by an API; exact byte equality additionally gates duplicate collapse.
   */
  readonly sha256: (bytes: Uint8Array) => Promise<string>;
  readonly limits?: Partial<SnapshotCatalogLimits>;
}

export const SNAPSHOT_CATALOG_CODES = [
  'invalid-request',
  'invalid-limits',
  'limit-exceeded',
  'invalid-json',
  'duplicate-json-key',
  'unsafe-json-key',
  'manifest-invalid',
  'manifest-unsupported',
  'artifact-missing',
  'artifact-size-mismatch',
  'asset-missing',
  'asset-size-mismatch',
  'extra-files',
  'capture-identity-conflict',
  'sha256-failed',
  'sha256-invalid',
  'sha256-mutated',
  'sha256-collision',
  'invalid-catalog',
] as const;
export type SnapshotCatalogCode = (typeof SNAPSHOT_CATALOG_CODES)[number];

/** Fixed codes only; input values and caught exception prose never escape. */
export class SnapshotCatalogError extends Error {
  readonly code: SnapshotCatalogCode;

  constructor(code: SnapshotCatalogCode) {
    super(`Snapshot catalog failed (${code}).`);
    this.name = 'SnapshotCatalogError';
    this.code = code;
  }
}

export interface CatalogFileAggregate {
  count: number;
  declaredBytes: number;
  presentCount: number;
  presentBytes: number;
  sizeMatchCount: number;
  missingCount: number;
  sizeMismatchCount: number;
}

export interface CatalogAssetAggregate extends CatalogFileAggregate {
  /** All asset records, including those explicitly not fetched. */
  recordCount: number;
}

export interface SnapshotCatalogEntry {
  manifestValidity: 'valid' | 'unsupported' | 'invalid';
  manifestSha256: string;
  manifestByteLength: number;
  provider: string | null;
  conversationId: string | null;
  conversationKey: string | null;
  captureId: string | null;
  capturedAt: string | null;
  method: CaptureMethod | null;
  declaredCompleteness: CaptureCompleteness | null;
  artifacts: CatalogFileAggregate | null;
  /** File aggregates cover fetched assets only; recordCount covers all states. */
  assets: CatalogAssetAggregate | null;
  canonical: {
    presence: 'present-unverified' | 'absent';
    byteLength: number | null;
    /** Fixed-path overlap only; null means undeclared or an unassessed manifest. */
    declaredFileRole: 'artifact' | 'asset' | null;
  };
  /** Exact selected metadata count in this occurrence's nearest manifest root. */
  associatedFileCount: number;
  extraFileCount: number;
  extraFileBytes: number;
  issueCodes: SnapshotCatalogCode[];
  occurrenceCount: number;
}

export interface SnapshotCatalog {
  schema: typeof SNAPSHOT_CATALOG_SCHEMA;
  algorithmVersion: typeof SNAPSHOT_CATALOG_VERSION;
  conversationKeyVersion: typeof CONVERSATION_KEY_VERSION;
  analysisOnly: true;
  mutationAuthorized: false;
  referenceCoverage: 'selected-inputs-only';
  fileEvidence: 'metadata-only-not-content-verified';
  accountBinding: 'not-recorded-in-liska-capture-1';
  selectedFileCount: number;
  selectedManifestCount: number;
  unassociatedFileCount: number;
  entries: SnapshotCatalogEntry[];
}
