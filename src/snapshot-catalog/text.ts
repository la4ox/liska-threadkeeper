/** Standalone fallbacks require no settings, network or remembered source. */
export const COPY = {
  catalog_title: 'Catalog existing snapshots',
  catalog_kicker: 'Liska · Archive tools',
  catalog_linkHelp: 'Read manifest metadata from one selected archive root without changing files',
  catalog_intro:
    'Choose an archive root once to build a private, manifest-only catalog of existing snapshots. Nothing is saved automatically.',
  catalog_boundary: 'Read-only catalog — every selected file stays unchanged.',
  catalog_boundaryHelp:
    'Raw responses, canonical content and assets are not read. Only manifest.json files are read; other selected files contribute path and size metadata only. No provider access or archive changes are made.',
  catalog_privacy: 'Private identifiers, not anonymized data',
  catalog_privacyHelp:
    'The downloaded JSON includes stable provider conversation identifiers. Hashing is not anonymization. Keep this report private. Folder names, relative paths, titles, URLs and conversation content are not exported.',
  catalog_completenessHelp:
    'Completeness is declared manifest metadata, not verification of raw, canonical or asset bytes. Listed artifacts are not proof that their contents are intact.',
  catalog_selection: 'One archive root',
  catalog_pick: 'Choose archive root',
  catalog_clear: 'Clear selection',
  catalog_build: 'Build catalog',
  catalog_cancel: 'Cancel catalog',
  catalog_save: 'Save private JSON…',
  catalog_limits:
    'Up to 4,096 selected files and 128 manifests; 256 KiB per manifest and 8 MiB of manifests total. Metadata limits: 1 TiB per file, 8 TiB total. Paths are limited to 512 characters. Folder names and file paths are not displayed.',
  catalog_empty: 'No archive root selected.',
  catalog_selected: 'Ready to catalog selected manifest metadata.',
  catalog_reading: 'Reading manifests…',
  catalog_building: 'Building the manifest-only catalog…',
  catalog_ready: 'Catalog complete. No selected files were changed.',
  catalog_cancelled: 'Catalog cancelled. No report was saved.',
  catalog_cancellationHelp:
    'Cancel takes effect between manifest reads and discards late work. Synchronous manifest parsing cannot stop instantly. Clear forgets this page’s selection and report.',
  catalog_error: 'The catalog could not finish. No report was saved.',
  catalog_selection_invalid:
    'Choose one archive root with intact, safe relative paths. This selection is invalid or ambiguous.',
  catalog_selection_limit:
    'The selection exceeds a catalog file, manifest, path or byte limit. Choose a smaller archive root.',
  catalog_selection_read_failed:
    'A selected manifest could not be read completely. Select the archive root again.',
  catalog_directory_unavailable:
    'This browser does not provide directory selection. No flat-file fallback is used.',
  catalog_files: 'selected files',
  catalog_bytes: 'bytes',
  catalog_manifests: 'manifests',
  catalog_read: 'read',
  catalog_report: 'Manifest-only catalog',
  catalog_totals: 'Catalog totals',
  catalog_entries: 'Snapshot entries',
  catalog_entry: 'Entry',
  catalog_source: 'Selected source',
  catalog_uniqueEntries: 'unique manifest entries',
  catalog_unassociated: 'unassociated files',
  catalog_occurrences: 'occurrences',
  catalog_valid: 'Valid manifest metadata',
  catalog_invalid: 'Invalid manifest',
  catalog_unsupported: 'Unsupported manifest',
  catalog_artifacts: 'Raw artifacts',
  catalog_assets: 'Fetched assets',
  catalog_records: 'declared file records',
  catalog_present: 'present by metadata',
  catalog_missing: 'missing',
  catalog_sizeMismatch: 'size mismatches',
  catalog_canonical: 'Canonical file',
  catalog_present_unverified: 'Present — bytes unverified',
  catalog_absent: 'Absent',
  catalog_extras: 'extra files',
  catalog_declared: 'Declared completeness',
  catalog_graph: 'graph',
  catalog_messages: 'messages',
  catalog_branches: 'branches',
  catalog_assetCompleteness: 'assets',
  catalog_complete: 'complete',
  catalog_partial: 'partial',
  catalog_unknown_value: 'unknown',
  catalog_not_attempted: 'not attempted',
  catalog_noEntries: 'No supported snapshot manifests were cataloged.',
  catalog_saving: 'Save As requested. Waiting for browser completion…',
  catalog_confirmed:
    'The browser reports the JSON download completed. Disk bytes were not independently reread.',
  catalog_failure:
    'The browser did not complete the catalog download. No retry was made. Clear or select again before another deliberate attempt.',
  catalog_unknown:
    'Download outcome is unknown. Check Downloads. No retry was made. Clear or select again before another deliberate attempt.',
} as const;

export type CopyKey = keyof typeof COPY;

export function t(key: CopyKey): string {
  try {
    const message = chrome.i18n.getMessage(key);
    if (message && message !== key) return message;
  } catch {
    /* English is available without extension i18n. */
  }
  return COPY[key];
}

export function localize(root: Document): void {
  try {
    const language = chrome.i18n.getUILanguage();
    if (/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(language))
      root.documentElement.lang = /^ja(?:-|$)/iu.test(language) ? 'ja' : 'en';
  } catch {
    /* Keep the static fallback. */
  }
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element => {
    const key = element.dataset.i18n;
    if (key && Object.prototype.hasOwnProperty.call(COPY, key))
      element.textContent = t(key as CopyKey);
  });
}
