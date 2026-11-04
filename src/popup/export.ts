import {
  type ExportControlMessage,
  type ExportStatus,
  type ExportChoice,
} from '../lib/export-operation-contract';
import { getMessage } from '../lib/i18n';
import { requestPreview, type PreviewRequest } from '../text-preview/protocol';
import { PopupTextPreview } from '../text-preview/popup';

type Send = (message: ExportControlMessage) => Promise<ExportStatus>;
interface SelectionIdentity {
  readonly operationId: string;
  readonly selectionId: string;
}
const send: Send = message =>
  new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) reject(new Error('Export connection unavailable'));
      else resolve(response as ExportStatus);
    });
  });
export function trustedExportAction(event: Event, action: () => void): void {
  if (event.isTrusted) action();
}
/** The settings application remains independent. This surface never starts work on open. */
export async function initExportSurface(
  request: Send = send,
  previewRequest: PreviewRequest = requestPreview
): Promise<() => void> {
  const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const panel = element('exportPanel');
  if (!panel) return () => undefined;
  const settings = element('settingsPanel');
  const settingsActions = element('settingsActions');
  const exportTab = element<HTMLButtonElement>('exportTab');
  const settingsTab = element<HTMLButtonElement>('settingsTab');
  const current = element<HTMLButtonElement>('exportCurrent');
  const selected = element<HTMLButtonElement>('exportSelected');
  const stop = element<HTMLButtonElement>('exportStop');
  const choices = element('exportBranches');
  const status = element('exportStatus');
  let state: ExportStatus = { success: false };
  let busy = false;
  let disposed = false;
  let selectionRendered: SelectionIdentity | undefined;
  let actionError: string | undefined;
  const preview = new PopupTextPreview({
    request: previewRequest,
    exportState: () => state,
    exportBusy: () => busy,
    changed: () => render(),
  });
  const tab = (showExport: boolean) => {
    panel.hidden = !showExport;
    settings.hidden = showExport;
    settingsActions.hidden = showExport;
    exportTab.setAttribute('aria-selected', String(showExport));
    settingsTab.setAttribute('aria-selected', String(!showExport));
  };
  tab(true);
  exportTab.addEventListener('click', () => {
    tab(true);
    void refresh();
  });
  settingsTab.addEventListener('click', () => tab(false));
  async function action(message: ExportControlMessage): Promise<void> {
    if (busy) return;
    busy = true;
    actionError = undefined;
    render();
    try {
      const result = await request(message);
      if (!result.success) throw new Error(result.error ?? 'Export unavailable');
      await refresh();
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Export unavailable';
    } finally {
      busy = false;
      render();
    }
  }
  const matchesSelection = (identity: SelectionIdentity) =>
    state.success &&
    state.operation?.phase === 'awaiting-selection' &&
    state.operation.id === identity.operationId &&
    state.operation.selectionId === identity.selectionId;
  const choose = (choice: ExportChoice, identity: SelectionIdentity) => {
    if (disposed || !matchesSelection(identity)) return;
    void action({
      action: 'chooseExportBranch',
      exportOperationId: identity.operationId,
      selectionId: identity.selectionId,
      choice,
    });
  };
  function render(): void {
    const op = state.operation;
    const running = !!op && !['completed', 'cancelled'].includes(op.phase);
    current.disabled = busy || preview.locked || !state.success || !state.target || running;
    selected.disabled = current.disabled || state.target?.platform !== 'chatgpt';
    selected.hidden = state.target?.platform !== 'chatgpt';
    stop.hidden = !running;
    stop.disabled = busy;
    preview.render();
    element('exportTarget').textContent = state.target
      ? `${state.target.platform} · ${state.target.title}\n${state.target.route}`
      : getMessage('export_noTarget');
    element('exportOutputs').textContent =
      `${getMessage('export_destinations')}: ${state.outputs?.join(', ') || getMessage('export_none')}`;
    status.textContent =
      actionError ??
      state.error ??
      (op?.phase === 'completed' && op.outcome === 'branch-preparation-ended'
        ? getMessage('export_outcome_branch_preparation_ended')
        : op
          ? getMessage(`export_phase_${op.phase.replace('-', '_')}`)
          : getMessage('export_ready'));
    if (!selectionRendered || !matchesSelection(selectionRendered)) {
      for (const button of choices.querySelectorAll('button')) button.disabled = true;
      choices.replaceChildren();
      selectionRendered = undefined;
    }
    for (const button of choices.querySelectorAll('button')) button.disabled = busy;
  }
  function renderOptions(
    options: NonNullable<ExportStatus['options']>,
    identity: SelectionIdentity
  ): void {
    const nodes = options.map(option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'branch-choice';
      button.disabled = busy;
      button.textContent = `#${option.ordinal} · ${getMessage('export_branchMessages', String(option.messageCount))}${option.isCurrent ? ` · ${getMessage('export_branchCurrent')}` : ''}${option.preview ? `\n${option.preview}` : ''}`;
      button.addEventListener('click', event =>
        trustedExportAction(event, () => choose(option.ordinal, identity))
      );
      return button;
    });
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'btn primary';
    all.disabled = busy;
    all.textContent = getMessage('export_all');
    all.addEventListener('click', event =>
      trustedExportAction(event, () => choose('all', identity))
    );
    choices.replaceChildren(...nodes, all);
  }
  async function refresh(): Promise<void> {
    try {
      const next = await request({ action: 'getExportStatus' });
      if (disposed) return;
      state = next;
      render();
      void preview.refreshOptions();
      const op = state.operation;
      if (op?.phase === 'awaiting-selection' && op.selectionId && !selectionRendered) {
        const identity = { operationId: op.id, selectionId: op.selectionId };
        const result = await request({ action: 'getExportBranchOptions' });
        if (
          !disposed &&
          result.success &&
          result.options &&
          result.operation?.phase === 'awaiting-selection' &&
          result.operation.id === identity.operationId &&
          result.operation.selectionId === identity.selectionId &&
          matchesSelection(identity)
        ) {
          renderOptions(result.options, identity);
          selectionRendered = identity;
        }
      }
    } catch {
      if (!disposed) {
        state = { success: false, error: 'Export connection unavailable. Reopen Liska.' };
        render();
      }
    }
  }
  const start = (mode: 'current' | 'selected') => {
    if (
      disposed ||
      busy ||
      preview.locked ||
      !state.target ||
      !state.outputs ||
      (state.operation && !['completed', 'cancelled'].includes(state.operation.phase))
    )
      return;
    void action({
      action: 'startExportOperation',
      mode,
      expectedTarget: { tabId: state.target.tabId, route: state.target.route },
      expectedOutputs: [...state.outputs],
    });
  };
  current.addEventListener('click', event => trustedExportAction(event, () => start('current')));
  selected.addEventListener('click', event => trustedExportAction(event, () => start('selected')));
  const cancel = () => {
    if (state.operation)
      void action({ action: 'cancelExportOperation', exportOperationId: state.operation.id });
  };
  stop.addEventListener('click', event => trustedExportAction(event, cancel));

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.operation?.phase === 'awaiting-selection')
      trustedExportAction(event, cancel);
  });
  const timer = setInterval(() => {
    void refresh();
  }, 1_000);
  const dispose = () => {
    disposed = true;
    clearInterval(timer);
    preview.dispose();
  };
  window.addEventListener('pagehide', dispose, { once: true });
  await refresh();
  return dispose;
}
