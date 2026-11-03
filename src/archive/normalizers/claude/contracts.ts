import type { RawCaptureBundle } from '../../capture';
import type { ArchiveDiagnostic, LiskaThreadArchive } from '../../types';
import type {
  ProviderBlockTraversalBudget,
  ProviderBlockWorkBudget,
} from '../provider-block-work-budget';

export const CLAUDE_SOURCE_FORMAT = 'claude.web.detail' as const;
export const CLAUDE_NORMALIZER_ID = 'claude-web/1' as const;
export type ClaudeRecord = Record<string, unknown>;

export class ClaudeNormalizationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ClaudeNormalizationError';
  }
}

export function fail(code: string, message: string): never {
  throw new ClaudeNormalizationError(code, message);
}

export interface ClaudeNormalizationInput {
  bundle: RawCaptureBundle;
  manifestSha256: string;
  artifactId: string;
  sha256: (bytes: Uint8Array) => Promise<string>;
  contentBudget?: ProviderBlockWorkBudget;
}

export interface ClaudeNormalizationResult {
  archive: LiskaThreadArchive;
  observedUnknownContentTypes: string[];
}

export interface ClaudeContext {
  artifactId: string;
  diagnostics: ArchiveDiagnostic[];
  diagnosticKeys: Set<string>;
  unknownTypes: Set<string>;
  contentBudget: ProviderBlockTraversalBudget;
}
