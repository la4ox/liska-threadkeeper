export const COPY = {
  journal_title: 'Resumability journal',
  journal_kicker: 'Private archive tools',
  journal_linkHelp: 'Create paused local bookkeeping from an explicitly selected catalog',
  journal_intro:
    'Durable bookkeeping only. This page cannot recapture, execute, retry or schedule work.',
  journal_boundary: 'Private local persistence',
  journal_boundaryHelp:
    'Create paused journal writes private provider/conversation identities and the exact catalog digest to this browser profile. They survive page and extension restarts. No titles, URLs, paths or conversation content are stored. This is not a backup or anonymization.',
  journal_scopeHelp:
    'Catalog selection is not account binding, proof of recoverability, provider completeness or permission to recapture. Source archives and catalogs are never changed.',
  journal_recoveryHelp:
    'Opening this page explicitly recovers journals to paused. Previously running attempts become unknown; nothing is dispatched or retried.',
  journal_selection: '1. Select a deterministic catalog',
  journal_limits:
    'One canonical liska-snapshot-catalog/1 JSON, at most 1 MiB. At most 16 journals and 2,048 conversations per journal.',
  journal_pick: 'Choose catalog JSON',
  journal_create: 'Create paused journal',
  journal_cancel: 'Cancel pending view',
  journal_clear: 'Clear selection / reset view',
  journal_cancellationHelp:
    'Cancel/reset discards pending results, not an already committed journal or a browser download. Reload this page to reconcile uncertain persistence. No journal is deleted.',
  journal_runs: '2. Paused journals',
  journal_privateExport:
    'Private exports contain stable provider/conversation identifiers and evidence references. Save only to a location you trust.',
  journal_export: 'Export private journal JSON',
  journal_empty: 'No catalog selected.',
  journal_reading: 'Reading and validating exact catalog bytes…',
  journal_ready: 'Catalog validated. Review the counts, then explicitly create a paused journal.',
  journal_loading: 'Recovering and listing local journals…',
  journal_loaded: 'Local journals are paused. No execution authority was acquired.',
  journal_creating: 'Writing a paused journal to this browser profile…',
  journal_created: 'Paused journal committed locally. Nothing was captured or dispatched.',
  journal_cancelled: 'Pending view cancelled. Existing local journals and downloads are unchanged.',
  journal_error: 'Operation refused. No retry was made. Reload to reconcile local state.',
  journal_selection_invalid: 'Select exactly one readable catalog JSON.',
  journal_selection_limit: 'Catalog exceeds the 1 MiB limit.',
  journal_catalog_invalid: 'Not an exact canonical supported snapshot catalog.',
  journal_hash_failed: 'Exact catalog hashing failed.',
  journal_noRuns: 'No local journals.',
  journal_run: 'Journal',
  journal_revision: 'revision',
  journal_conversations: 'unique valid conversations',
  journal_skipped: 'invalid / skipped entries',
  journal_duplicates: 'duplicate captures',
  journal_captures: 'valid capture occurrences',
  journal_items: 'items',
  journal_attempts: 'attempts',
  journal_saving: 'Save As requested. Waiting for exact browser download completion…',
  journal_confirmed:
    'The browser reports the JSON download completed. Disk bytes were not independently reread.',
  journal_failure: 'The browser reports the download failed. No retry was made.',
  journal_unknown: 'Download outcome is unknown. Check Downloads. No retry was made.',
} as const;
export type CopyKey = keyof typeof COPY;
export function t(key: CopyKey): string {
  try {
    const value = chrome.i18n.getMessage(key);
    if (value && value !== key) return value;
  } catch {
    /* Static English fallback. */
  }
  return COPY[key];
}
export function localize(root: Document): void {
  try {
    root.documentElement.lang = /^ja(?:-|$)/iu.test(chrome.i18n.getUILanguage()) ? 'ja' : 'en';
  } catch {
    /* Keep static fallback. */
  }
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element => {
    const key = element.dataset.i18n;
    if (key && Object.prototype.hasOwnProperty.call(COPY, key))
      element.textContent = t(key as CopyKey);
  });
}
