/** English fallback keeps the standalone page usable when i18n is unavailable. */
export const COPY = {
  snapshot_title: 'Compare local snapshots',
  snapshot_kicker: 'Liska · Archive tools',
  snapshot_intro:
    'Inspect saved snapshots without changing them. Add each snapshot folder separately, then compare the selected bytes locally.',
  snapshot_boundary: 'Analysis only — every snapshot stays.',
  snapshot_boundaryHelp:
    'Even identical bytes do not authorize cleanup. Links outside your selection are not checked. This page cannot delete, move, or overwrite source files.',
  snapshot_supported:
    'Current ChatGPT web snapshots only. Other formats, incomplete captures, and extra files remain preserved and may be unverifiable.',
  snapshot_selection: 'Your selection',
  snapshot_analysis: 'Analysis',
  snapshot_pick: 'Add snapshot folder',
  snapshot_clear: 'Clear selection',
  snapshot_remove: 'Remove from selection',
  snapshot_analyze: 'Analyze snapshots',
  snapshot_cancel: 'Cancel analysis',
  snapshot_save: 'Save JSON report…',
  snapshot_limits:
    'Choose 2–16 snapshot folders. Up to 256 files per folder, 1,024 files total, 64 MiB per file and 256 MiB total. Folder names and source text are not displayed.',
  snapshot_empty: 'No folders selected yet.',
  snapshot_selected: 'Ready to analyze after at least two folders are selected.',
  snapshot_reading: 'Reading selected files…',
  snapshot_analyzing: 'Checking bytes, provenance, and canonical replay…',
  snapshot_ready: 'Analysis complete. No source files were changed.',
  snapshot_cancelled: 'Analysis cancelled. No report was saved.',
  snapshot_cancellationHelp:
    'Cancel takes effect between reads and hashes; synchronous parsing cannot stop instantly. Peak memory can exceed selected file sizes.',
  snapshot_error: 'Analysis could not finish. No report was saved.',
  snapshot_selection_invalid:
    'Choose a single snapshot folder with intact relative paths. This selection is invalid or ambiguous.',
  snapshot_selection_limit:
    'The selection exceeds a file, folder, or byte limit. Choose a smaller set.',
  snapshot_selection_read_failed:
    'A selected file could not be read completely. Select the folder again.',
  snapshot_directory_unavailable:
    'This browser does not provide directory selection. No flat-file fallback is used.',
  snapshot_report: 'Analysis report',
  snapshot_snapshots: 'Snapshot evidence',
  snapshot_relations: 'Candidate relationships',
  snapshot_noRelations: 'No comparable candidate relationships were found. Keep every snapshot.',
  snapshot_snapshot: 'Snapshot',
  snapshot_files: 'files',
  snapshot_bytes: 'bytes',
  snapshot_read: 'read',
  snapshot_verified: 'Verified byte consistency',
  snapshot_partial: 'Partial evidence',
  snapshot_unverifiable: 'Unverifiable',
  snapshot_digest: 'Content inventory SHA-256',
  snapshot_keepBoth: 'Keep both',
  snapshot_byte_identical: 'Byte-identical selected inventories',
  snapshot_same_raw_different_evidence: 'Same raw bytes, different evidence',
  snapshot_semantic_candidate: 'Semantic candidate only',
  snapshot_saving: 'Save As requested. Waiting for browser completion…',
  snapshot_confirmed:
    'The browser reports the JSON download completed. Disk bytes were not independently reread.',
  snapshot_failure:
    'The browser did not complete the report download. No automatic retry was made.',
  snapshot_unknown:
    'Download outcome is unknown. Check Downloads before any deliberate new attempt. Reset or analyze again to enable Save.',
  snapshot_first_observed: 'First observed capture',
  snapshot_latest_observed: 'Latest observed capture',
  snapshot_chronology_ambiguous: 'Capture order is ambiguous',
  snapshot_graph_change: 'Graph-change evidence',
  snapshot_unique_evidence: 'Unique evidence',
  snapshot_partial_capture: 'Partial source capture',
  snapshot_raw_only: 'Raw-only recovery evidence',
  snapshot_unsupported_version: 'Unsupported format or version',
  snapshot_integrity_unverified: 'Integrity not verified',
  snapshot_presentation_reference: 'Presentation reference retained',
  snapshot_external_references_unassessed: 'External links not assessed',
  snapshot_opaque_files: 'Additional opaque files retained',
} as const;

export type CopyKey = keyof typeof COPY;

export function t(key: CopyKey): string {
  try {
    const localized = chrome.i18n.getMessage(key);
    if (localized && localized !== key) return localized;
  } catch {
    /* A local English fallback needs no settings or network access. */
  }
  return COPY[key];
}

export function localize(root: Document): void {
  try {
    const language = chrome.i18n.getUILanguage();
    if (/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(language)) {
      root.documentElement.lang = /^ja(?:-|$)/iu.test(language) ? 'ja' : 'en';
    }
  } catch {
    /* Keep the static English fallback. */
  }
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element => {
    const key = element.dataset.i18n;
    if (key && Object.prototype.hasOwnProperty.call(COPY, key))
      element.textContent = t(key as CopyKey);
  });
}
