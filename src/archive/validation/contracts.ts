export type ArchiveValidationSeverity = 'error' | 'warning';

export interface ArchiveValidationIssue {
  severity: ArchiveValidationSeverity;
  /** Stable machine-readable diagnostic. */
  code: string;
  /** JSON Pointer-like location inside the canonical archive. */
  path: string;
  message: string;
}

export interface ArchiveValidationResult {
  valid: boolean;
  issues: ArchiveValidationIssue[];
}

export type UnknownRecord = Record<string, unknown>;
