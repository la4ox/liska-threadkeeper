/** Pure analysis of explicitly supplied bytes; never cleanup authorization. */
export const SNAPSHOT_ANALYSIS_SCHEMA = 'liska-snapshot-analysis/1' as const;
export const SNAPSHOT_ANALYSIS_VERSION = 'snapshot-evidence/1' as const;

/** Per-operation ceilings. Callers can lower these values, never raise them. */
export const SNAPSHOT_ANALYSIS_HARD_LIMITS = Object.freeze({
  maxSnapshots: 16,
  maxFilesPerSnapshot: 256,
  maxTotalFiles: 1_024,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxJsonDepth: 96,
  maxJsonValues: 1_000_000,
  maxJsonStringCodeUnits: 32 * 1024 * 1024,
  maxJsonWork: 128 * 1024 * 1024,
  maxCanonicalNodes: 20_000,
  maxCanonicalBlocks: 100_000,
  maxAssets: 10_000,
  maxDiagnostics: 20_000,
  maxProjectionBytes: 16 * 1024 * 1024,
  maxTotalProjectionBytes: 64 * 1024 * 1024,
  maxHashBytes: 1024 * 1024 * 1024,
  maxHashCalls: 8_192,
  maxRelations: 48,
  maxReportBytes: 256 * 1024,
});

export type SnapshotAnalysisLimits = {
  -readonly [K in keyof typeof SNAPSHOT_ANALYSIS_HARD_LIMITS]: number;
};

export interface SnapshotFileBytes {
  /** Snapshot-relative input slot only. It is never returned in the plan. */
  readonly relativePath: string;
  readonly bytes: Uint8Array;
}

export interface SnapshotByteInventory {
  readonly files: readonly SnapshotFileBytes[];
}

export interface AnalyzeSnapshotsInput {
  readonly snapshots: readonly SnapshotByteInventory[];
  /**
   * Trusted SHA-256 algorithm capability. Each call receives a private copy;
   * mutation, rejection and malformed results fail closed. No API can prove an
   * injected implementation truthful. Byte equality confirms digest grouping.
   */
  readonly sha256: (bytes: Uint8Array) => Promise<string>;
  readonly limits?: Partial<SnapshotAnalysisLimits>;
}

export const SNAPSHOT_PRESERVATION_REASONS = [
  'first-observed',
  'latest-observed',
  'chronology-ambiguous',
  'graph-change',
  'unique-evidence',
  'partial-capture',
  'raw-only',
  'unsupported-version',
  'integrity-unverified',
  'presentation-reference',
  'external-references-unassessed',
  'opaque-files',
] as const;
export type SnapshotPreservationReason = (typeof SNAPSHOT_PRESERVATION_REASONS)[number];

export const SNAPSHOT_ANALYSIS_CODES = [
  'invalid-request',
  'invalid-limits',
  'limit-exceeded',
  'invalid-json',
  'duplicate-json-key',
  'unsafe-json-key',
  'missing-evidence',
  'manifest-invalid',
  'writer-encoding-invalid',
  'unsupported-snapshot-format',
  'unsupported-normalizer',
  'artifact-integrity-failed',
  'canonical-provenance-failed',
  'canonical-replay-failed',
  'sha256-failed',
  'sha256-invalid',
  'sha256-mutated',
  'invalid-plan',
] as const;
export type SnapshotAnalysisCode = (typeof SNAPSHOT_ANALYSIS_CODES)[number];

/** No source values, filenames, paths or exception causes escape this error. */
export class SnapshotAnalysisError extends Error {
  readonly code: SnapshotAnalysisCode;

  constructor(code: SnapshotAnalysisCode) {
    super(`Snapshot analysis failed (${code}).`);
    this.name = 'SnapshotAnalysisError';
    this.code = code;
  }
}

export interface SnapshotAnalysisEntry {
  /** Zero-based position in the user's explicit ordered selection. */
  ordinal: number;
  /** Exact byte/provenance/replay consistency, not historical transport authenticity. */
  verification: 'verified' | 'partial' | 'unverifiable';
  code: SnapshotAnalysisCode | null;
  measuredByteLength: number;
  fileCount: number;
  inventorySha256: string;
  preserveReasons: SnapshotPreservationReason[];
}

export const SNAPSHOT_RELATION_CLASSES = [
  'byte-identical',
  'same-raw-different-evidence',
  'semantic-candidate',
  'unverifiable',
] as const;
export type SnapshotRelationClass = (typeof SNAPSHOT_RELATION_CLASSES)[number];

export interface SnapshotAnalysisRelation {
  left: number;
  right: number;
  classification: SnapshotRelationClass;
  preserveBoth: true;
}

export interface SnapshotAnalysisPlan {
  schema: typeof SNAPSHOT_ANALYSIS_SCHEMA;
  algorithmVersion: typeof SNAPSHOT_ANALYSIS_VERSION;
  analysisOnly: true;
  mutationAuthorized: false;
  referenceCoverage: 'selected-inputs-only';
  snapshots: SnapshotAnalysisEntry[];
  /** Sparse candidate links, not all-pairs differences or cleanup instructions. */
  relations: SnapshotAnalysisRelation[];
}
