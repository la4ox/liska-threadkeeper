import type { StagedArchiveCompanionArtifact } from './types';

/** Execution-scoped access, never a runtime sender. The caller owns cleanup.
 * Manifests stay inline; only raw reads and canonical creation are permitted.
 * Implementations fence each new effect and drain already-started work.
 */
export interface ChatGptCaptureStageAccess {
  readonly readRaw: (artifact: StagedArchiveCompanionArtifact) => Promise<Uint8Array>;
  readonly createCanonical: (bytes: Uint8Array) => Promise<StagedArchiveCompanionArtifact>;
}
