import type { SnapshotCatalog, SnapshotCatalogEntry } from '../archive/catalog';
import type { SelectionTotals } from './selection';
import { t, type CopyKey } from './text';

function node<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  text: string,
  className?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function renderSelection(container: HTMLElement, totals?: SelectionTotals): void {
  container.textContent = totals
    ? `${totals.files} ${t('catalog_files')} · ${totals.bytes} ${t('catalog_bytes')} · ${totals.manifests} ${t('catalog_manifests')} (${totals.manifestBytes} ${t('catalog_bytes')})`
    : t('catalog_empty');
  container.className = totals ? 'muted' : 'empty';
}

function completeness(value: string): string {
  const keys: Record<string, CopyKey> = {
    complete: 'catalog_complete',
    partial: 'catalog_partial',
    unknown: 'catalog_unknown_value',
    'not-attempted': 'catalog_not_attempted',
  };
  return t(keys[value] ?? 'catalog_unknown_value');
}

function appendEntryFacts(card: HTMLElement, entry: SnapshotCatalogEntry): void {
  const document = card.ownerDocument;
  for (const [label, aggregate] of [
    ['catalog_artifacts', entry.artifacts],
    ['catalog_assets', entry.assets],
  ] as const) {
    if (!aggregate) continue;
    card.append(node(document, 'h4', t(label)));
    card.append(
      node(
        document,
        'p',
        `${aggregate.count} ${t('catalog_records')} · ${aggregate.presentCount} ${t('catalog_present')} · ${aggregate.missingCount} ${t('catalog_missing')} · ${aggregate.sizeMismatchCount} ${t('catalog_sizeMismatch')}`,
        'muted small'
      )
    );
  }
  const canonical =
    entry.canonical.presence === 'present-unverified'
      ? `${t('catalog_present_unverified')} (${entry.canonical.byteLength} ${t('catalog_bytes')})`
      : t('catalog_absent');
  card.append(node(document, 'p', `${t('catalog_canonical')}: ${canonical}`, 'muted small'));
  card.append(
    node(
      document,
      'p',
      `${entry.extraFileCount} ${t('catalog_extras')} · ${entry.extraFileBytes} ${t('catalog_bytes')}`,
      'muted small'
    )
  );
  if (entry.declaredCompleteness) {
    const declared = entry.declaredCompleteness;
    card.append(node(document, 'h4', t('catalog_declared')));
    card.append(
      node(
        document,
        'p',
        `${t('catalog_graph')}: ${completeness(declared.graph)} · ${t('catalog_messages')}: ${completeness(declared.messages)} · ${t('catalog_branches')}: ${completeness(declared.branches)} · ${t('catalog_assetCompleteness')}: ${completeness(declared.assets)}`,
        'muted small'
      )
    );
  }
  if (entry.issueCodes.length)
    card.append(node(document, 'code', entry.issueCodes.join(' · '), 'fixed-code'));
}

/** Render only fixed codes, enum labels and bounded counts from encoded core output.
 * Private identifiers, locators, dates, titles, URLs and source text are never rendered. */
export function renderCatalog(container: HTMLElement, catalog: SnapshotCatalog): void {
  const document = container.ownerDocument;
  container.replaceChildren(node(document, 'h2', t('catalog_report')));
  const totals = node(document, 'section', '', 'totals');
  totals.append(node(document, 'h3', t('catalog_totals')));
  totals.append(
    node(
      document,
      'p',
      `${catalog.selectedFileCount} ${t('catalog_files')} · ${catalog.selectedManifestCount} ${t('catalog_manifests')} · ${catalog.entries.length} ${t('catalog_uniqueEntries')} · ${catalog.unassociatedFileCount} ${t('catalog_unassociated')}`
    )
  );
  container.append(totals, node(document, 'h3', t('catalog_entries')));
  if (!catalog.entries.length) container.append(node(document, 'p', t('catalog_noEntries')));
  const entries = node(document, 'div', '', 'report-grid');
  for (const [index, entry] of catalog.entries.entries()) {
    const card = node(document, 'section', '', 'evidence-card');
    card.append(node(document, 'h3', `${t('catalog_entry')} ${index + 1}`));
    const validity: Record<SnapshotCatalogEntry['manifestValidity'], CopyKey> = {
      valid: 'catalog_valid',
      invalid: 'catalog_invalid',
      unsupported: 'catalog_unsupported',
    };
    card.append(
      node(document, 'p', t(validity[entry.manifestValidity]), `badge ${entry.manifestValidity}`)
    );
    card.append(
      node(
        document,
        'p',
        `${entry.occurrenceCount} ${t('catalog_occurrences')} · ${entry.manifestByteLength} ${t('catalog_bytes')} · ${entry.associatedFileCount} ${t('catalog_files')}`
      )
    );
    appendEntryFacts(card, entry);
    entries.append(card);
  }
  container.append(entries);
}
