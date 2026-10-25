import type { SnapshotAnalysisPlan } from '../archive/snapshots/contracts';
import type { SelectedSnapshot } from './selection';
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

function label(code: string): string {
  // Callers pass only enum values from the core encoder's validated plan.
  return t(`snapshot_${code.replace(/-/gu, '_')}` as CopyKey);
}

export function renderSelection(
  container: HTMLElement,
  snapshots: readonly SelectedSnapshot[],
  remove: (event: Event, index: number) => void
): void {
  container.replaceChildren();
  const document = container.ownerDocument;
  snapshots.forEach((snapshot, index) => {
    const row = node(document, 'li', '', 'snapshot-row');
    const details = node(document, 'div', '');
    details.append(node(document, 'strong', `${t('snapshot_snapshot')} ${index + 1}`));
    details.append(
      node(
        document,
        'p',
        `${snapshot.files.length} ${t('snapshot_files')} · ${snapshot.byteLength} ${t('snapshot_bytes')}`,
        'muted'
      )
    );
    const button = node(document, 'button', t('snapshot_remove'), 'quiet');
    button.type = 'button';
    button.setAttribute(
      'aria-label',
      `${t('snapshot_remove')}: ${t('snapshot_snapshot')} ${index + 1}`
    );
    button.addEventListener('click', event => remove(event, index));
    row.append(details, button);
    container.append(row);
  });
}

export function renderPlan(container: HTMLElement, plan: SnapshotAnalysisPlan): void {
  container.replaceChildren();
  const document = container.ownerDocument;
  container.append(node(document, 'h2', t('snapshot_report')));
  const entries = node(document, 'div', '', 'report-grid');
  for (const entry of plan.snapshots) {
    const card = node(document, 'section', '', 'evidence-card');
    card.append(node(document, 'h3', `${t('snapshot_snapshot')} ${entry.ordinal + 1}`));
    card.append(node(document, 'p', label(entry.verification), `badge ${entry.verification}`));
    card.append(
      node(
        document,
        'p',
        `${entry.fileCount} ${t('snapshot_files')} · ${entry.measuredByteLength} ${t('snapshot_bytes')}`
      )
    );
    if (entry.code) card.append(node(document, 'code', entry.code, 'fixed-code'));
    const reasons = node(document, 'ul', '', 'reasons');
    for (const reason of entry.preserveReasons) reasons.append(node(document, 'li', label(reason)));
    card.append(
      reasons,
      node(document, 'p', t('snapshot_digest'), 'muted'),
      node(document, 'code', entry.inventorySha256, 'digest')
    );
    entries.append(card);
  }
  container.append(entries, node(document, 'h3', t('snapshot_relations')));
  if (!plan.relations.length) container.append(node(document, 'p', t('snapshot_noRelations')));
  const list = node(document, 'ul', '', 'relations');
  for (const relation of plan.relations) {
    list.append(
      node(
        document,
        'li',
        `${t('snapshot_snapshot')} ${relation.left + 1} ↔ ${relation.right + 1}: ${label(relation.classification)}. ${t('snapshot_keepBoth')}.`
      )
    );
  }
  container.append(list);
}
