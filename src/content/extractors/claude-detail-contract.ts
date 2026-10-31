import type { ArchiveCompanionBundle } from '../../lib/types';

export const CLAUDE_SCOPE_UNVERIFIED_WARNING =
  'Claude detail transcript and alternate-branch coverage remain unverified; this capture is partial.';
export const CLAUDE_ASSETS_NOT_ATTEMPTED_WARNING =
  'Claude attachment metadata was inventoried; attachment bytes were not attempted.';
export const CLAUDE_ASSET_INVENTORY_INCOMPLETE_WARNING =
  'Claude attachment metadata inventory could not be completed; its scope is unknown and attachment bytes were not attempted.';
export const CLAUDE_DETAIL_CONTENT_UNVERIFIED_WARNING =
  'Claude web detail may omit richer thinking, tool, or artifact content; include-thinking only projects fields present in the captured response.';
export const CLAUDE_DOM_FALLBACK_WARNING =
  'Claude readable note uses only the rendered page; this capture is partial and earlier messages or branches may be missing.';
export const CLAUDE_STRUCTURED_EVIDENCE_FALLBACK_WARNING =
  'Claude structured detail could not be normalized or projected; the partial readable note uses the rendered page and preserves verified raw capture evidence.';

export class ClaudeStructuredCaptureError extends Error {
  readonly code: string;
  readonly archiveCompanion?: ArchiveCompanionBundle;

  constructor(code: string, archiveCompanion?: ArchiveCompanionBundle) {
    super(`Claude structured capture failed (${code}).`);
    this.name = 'ClaudeStructuredCaptureError';
    this.code = code;
    this.archiveCompanion = archiveCompanion;
  }
}
