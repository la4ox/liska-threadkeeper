/**
 * UI components for content script
 * Floating button, toast notifications, loading states
 */

import {
  DEFAULT_TOAST_DURATION,
  SUCCESS_TOAST_DURATION,
  ERROR_TOAST_DURATION,
  WARNING_TOAST_DURATION,
} from '../lib/constants';
import { getMessage } from '../lib/i18n';

// CSS styles for UI components
const STYLES = `
  #g2o-sync-button {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 10000;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%);
    color: white;
    border: none;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 600;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(124, 58, 237, 0.4);
    transition: all 0.2s ease;
  }

  #g2o-sync-button:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(124, 58, 237, 0.5);
  }

  #g2o-sync-button:active {
    transform: translateY(0);
  }

  #g2o-sync-button:disabled {
    opacity: 0.7;
    cursor: not-allowed;
    transform: none;
  }

  #g2o-sync-button .icon {
    font-size: 16px;
  }

  #g2o-sync-button .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: g2o-spin 0.8s linear infinite;
  }

  #g2o-branch-button {
    position: fixed;
    bottom: 76px;
    right: 20px;
    z-index: 10000;
    padding: 8px 12px;
    color: #ede9fe;
    background: #312e81;
    border: 1px solid #7c3aed;
    border-radius: 10px;
    font: 600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    cursor: pointer;
    box-shadow: 0 3px 10px rgba(49, 46, 129, 0.3);
  }

  #g2o-branch-button:hover { background: #4338ca; }
  #g2o-branch-button:disabled { opacity: 0.7; cursor: not-allowed; }

  #g2o-branch-picker-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10002;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(15, 23, 42, 0.65);
  }

  .g2o-branch-picker {
    box-sizing: border-box;
    width: min(540px, 100%);
    max-height: min(680px, 100%);
    padding: 20px;
    overflow: hidden;
    color: #e2e8f0;
    background: #111827;
    border: 1px solid #475569;
    border-radius: 14px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .g2o-branch-picker h2 { margin: 0; font-size: 18px; }
  .g2o-branch-picker-help { margin: 8px 0 16px; color: #cbd5e1; line-height: 1.4; }
  .g2o-branch-picker-list {
    max-height: min(410px, 50vh);
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
  }

  .g2o-branch-picker-option {
    display: block;
    width: 100%;
    margin: 0 0 8px;
    padding: 12px;
    color: inherit;
    text-align: left;
    background: #1e293b;
    border: 1px solid #475569;
    border-radius: 10px;
    cursor: pointer;
  }

  .g2o-branch-picker-option:hover,
  .g2o-branch-picker-option:focus-visible { border-color: #a78bfa; outline: none; }
  .g2o-branch-picker-option-current { border-color: #7c3aed; }
  .g2o-branch-picker-option-title { display: block; font-weight: 700; }
  .g2o-branch-picker-option-counts { display: block; margin-top: 4px; color: #cbd5e1; font-size: 13px; }
  .g2o-branch-picker-preview {
    display: -webkit-box;
    margin: 8px 0 0;
    overflow: hidden;
    color: #94a3b8;
    font-size: 13px;
    line-height: 1.35;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }

  .g2o-branch-picker-current {
    display: inline-block;
    margin-left: 8px;
    padding: 2px 6px;
    color: #ddd6fe;
    background: #5b21b6;
    border-radius: 999px;
    font-size: 11px;
  }

  .g2o-branch-picker-export-all-help {
    margin: 16px 0 0;
    color: #cbd5e1;
    font-size: 13px;
    line-height: 1.4;
  }

  .g2o-branch-picker-actions {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-top: 12px;
  }

  .g2o-branch-picker-export-all,
  .g2o-branch-picker-cancel {
    padding: 8px 12px;
    color: #e2e8f0;
    border: 1px solid #64748b;
    border-radius: 8px;
    cursor: pointer;
  }

  .g2o-branch-picker-export-all {
    color: #f5f3ff;
    background: #5b21b6;
    border-color: #7c3aed;
  }

  .g2o-branch-picker-cancel { background: transparent; }

  .g2o-branch-picker-export-all:hover { background: #6d28d9; }

  .g2o-branch-picker-export-all:focus-visible,
  .g2o-branch-picker-cancel:focus-visible {
    outline: 2px solid #a78bfa;
    outline-offset: 2px;
  }

  @keyframes g2o-spin {
    to { transform: rotate(360deg); }
  }

  .g2o-toast {
    position: fixed;
    bottom: 80px;
    right: 20px;
    z-index: 10001;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 20px;
    border-radius: 12px;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    box-shadow: 0 4px 16px rgba(0,0,0,0.15);
    animation: g2o-slideIn 0.3s ease;
    max-width: 400px;
  }

  @keyframes g2o-slideIn {
    from {
      opacity: 0;
      transform: translateX(100px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .g2o-toast.success {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    color: white;
  }

  .g2o-toast.error {
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    color: white;
  }

  .g2o-toast.warning {
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    color: white;
  }

  .g2o-toast.info {
    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
    color: white;
  }

  .g2o-toast .icon {
    font-size: 18px;
    flex-shrink: 0;
  }

  .g2o-toast .message {
    flex: 1;
    line-height: 1.4;
  }

  .g2o-toast .close {
    background: none;
    border: none;
    color: inherit;
    opacity: 0.7;
    cursor: pointer;
    font-size: 18px;
    padding: 0;
    margin-left: 8px;
  }

  .g2o-toast .close:hover {
    opacity: 1;
  }
`;

let styleInjected = false;
let currentToast: HTMLDivElement | null = null;
let activeBranchPicker: ActiveBranchPicker | null = null;

const BRANCH_BUTTON_ID = 'g2o-branch-button';
const BRANCH_PICKER_BACKDROP_ID = 'g2o-branch-picker-backdrop';
const MAX_BRANCH_PREVIEW_LENGTH = 280;

export interface ArchiveBranchPickerOption {
  ordinal: number;
  messageCount: number;
  uniqueMessageCount: number;
  isCurrent: boolean;
  preview?: string;
}

export type ArchiveBranchPickerSelection = number | 'all' | null;

interface ActiveBranchPicker {
  settle: (selection: ArchiveBranchPickerSelection) => void;
}

/**
 * Inject CSS styles into the page
 */
function injectStyles(): void {
  if (styleInjected && document.getElementById('g2o-styles')) return;

  if (document.getElementById('g2o-styles')) {
    styleInjected = true;
    return;
  }

  const style = document.createElement('style');
  style.id = 'g2o-styles';
  style.textContent = STYLES;
  document.head.appendChild(style);
  styleInjected = true;
}

/**
 * Create and inject the sync button
 */
export function handleTrustedSyncClick(event: Event, onClick: () => void): void {
  if (!event.isTrusted) {
    console.warn('[G2O] Ignored a programmatic export click');
    return;
  }

  onClick();
}

export function injectSyncButton(onClick: () => void): HTMLButtonElement {
  injectStyles();

  // Remove existing button if present
  const existing = document.getElementById('g2o-sync-button');
  if (existing) {
    existing.remove();
  }

  const button = document.createElement('button');
  button.id = 'g2o-sync-button';

  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = '📥';

  const text = document.createElement('span');
  text.className = 'text';
  text.textContent = getMessage('ui_syncButton');

  button.appendChild(icon);
  button.appendChild(text);

  button.addEventListener('click', event => handleTrustedSyncClick(event, onClick));
  document.body.appendChild(button);

  return button;
}

/**
 * Authorization seam for the compact branch picker control. Browser pages can
 * call HTMLElement.click(), so only a browser-generated gesture may begin an
 * export flow.
 */
export function handleTrustedBranchClick(event: Event, onClick: () => void): void {
  if (!event.isTrusted) {
    console.warn('[G2O] Ignored a programmatic branch export click');
    return;
  }

  onClick();
}

/**
 * Inject the optional branch-export entry point directly above the main button.
 */
export function injectBranchExportButton(onClick: () => void): HTMLButtonElement {
  injectStyles();
  document.getElementById(BRANCH_BUTTON_ID)?.remove();

  const button = document.createElement('button');
  button.id = BRANCH_BUTTON_ID;
  button.type = 'button';
  button.textContent = getMessage('ui_branchButton');
  const label = getMessage('ui_branchButtonTitle');
  button.title = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', event => handleTrustedBranchClick(event, onClick));
  const mainButton = document.getElementById('g2o-sync-button');
  if (mainButton) {
    mainButton.before(button);
  } else {
    document.body.appendChild(button);
  }

  return button;
}

/**
 * Small test seam shared by branch selection, cancellation, and Escape.
 */
export function handleTrustedBranchPickerAction(event: Event, onAction: () => void): void {
  if (!event.isTrusted) {
    console.warn('[G2O] Ignored a programmatic branch picker action');
    return;
  }

  onAction();
}

function truncateBranchPreview(preview: string): string {
  return preview.length > MAX_BRANCH_PREVIEW_LENGTH
    ? `${preview.slice(0, MAX_BRANCH_PREVIEW_LENGTH - 1)}…`
    : preview;
}

function createBranchPickerOption(
  option: ArchiveBranchPickerOption,
  onSelect: (ordinal: number) => void
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'g2o-branch-picker-option';
  button.setAttribute('data-branch-ordinal', String(option.ordinal));
  button.setAttribute('aria-current', option.isCurrent ? 'true' : 'false');
  if (option.isCurrent) button.classList.add('g2o-branch-picker-option-current');

  const title = document.createElement('span');
  title.className = 'g2o-branch-picker-option-title';
  title.textContent = getMessage('ui_branchPickerBranch', String(option.ordinal));
  button.appendChild(title);

  if (option.isCurrent) {
    const current = document.createElement('span');
    current.className = 'g2o-branch-picker-current';
    current.textContent = getMessage('ui_branchPickerCurrent');
    title.appendChild(current);
  }

  const counts = document.createElement('span');
  counts.className = 'g2o-branch-picker-option-counts';
  counts.textContent = [
    getMessage('ui_branchPickerMessageCount', String(option.messageCount)),
    getMessage('ui_branchPickerUniqueMessageCount', String(option.uniqueMessageCount)),
  ].join(' · ');
  button.appendChild(counts);

  if (option.preview) {
    const preview = document.createElement('p');
    preview.className = 'g2o-branch-picker-preview';
    preview.textContent = truncateBranchPreview(option.preview);
    button.appendChild(preview);
  }

  button.addEventListener('click', event =>
    handleTrustedBranchPickerAction(event, () => onSelect(option.ordinal))
  );
  return button;
}

function createBranchPickerActions(
  onSelect: (selection: Exclude<ArchiveBranchPickerSelection, null>) => void,
  onCancel: () => void,
  exportAllHelpId: string
): HTMLDivElement {
  const actions = document.createElement('div');
  actions.className = 'g2o-branch-picker-actions';

  const exportAll = document.createElement('button');
  exportAll.type = 'button';
  exportAll.className = 'g2o-branch-picker-export-all';
  exportAll.textContent = getMessage('ui_branchPickerExportAll');
  exportAll.setAttribute('aria-describedby', exportAllHelpId);
  exportAll.addEventListener('click', event =>
    handleTrustedBranchPickerAction(event, () => onSelect('all'))
  );
  actions.appendChild(exportAll);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'g2o-branch-picker-cancel';
  cancel.textContent = getMessage('ui_branchPickerCancel');
  cancel.addEventListener('click', event => handleTrustedBranchPickerAction(event, onCancel));
  actions.appendChild(cancel);
  return actions;
}

function createBranchPickerDialog(
  options: ArchiveBranchPickerOption[],
  onSelect: (selection: Exclude<ArchiveBranchPickerSelection, null>) => void,
  onCancel: () => void
): { backdrop: HTMLDivElement; initialFocus: HTMLButtonElement } {
  const backdrop = document.createElement('div');
  backdrop.id = BRANCH_PICKER_BACKDROP_ID;
  const dialog = document.createElement('section');
  dialog.className = 'g2o-branch-picker';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'g2o-branch-picker-heading');

  const heading = document.createElement('h2');
  heading.id = 'g2o-branch-picker-heading';
  heading.textContent = getMessage('ui_branchPickerHeading');
  dialog.appendChild(heading);

  const help = document.createElement('p');
  help.className = 'g2o-branch-picker-help';
  help.textContent = getMessage('ui_branchPickerHelp');
  dialog.appendChild(help);

  const list = document.createElement('ul');
  list.className = 'g2o-branch-picker-list';
  let initialFocus: HTMLButtonElement | null = null;
  for (const option of options) {
    const item = document.createElement('li');
    const optionButton = createBranchPickerOption(option, onSelect);
    item.appendChild(optionButton);
    list.appendChild(item);
    if (option.isCurrent) initialFocus = optionButton;
    initialFocus ??= optionButton;
  }
  dialog.appendChild(list);

  const exportAllHelp = document.createElement('p');
  exportAllHelp.id = 'g2o-branch-picker-export-all-help';
  exportAllHelp.className = 'g2o-branch-picker-export-all-help';
  exportAllHelp.textContent = getMessage('ui_branchPickerExportAllHelp');
  dialog.appendChild(exportAllHelp);

  dialog.appendChild(createBranchPickerActions(onSelect, onCancel, exportAllHelp.id));
  backdrop.appendChild(dialog);

  return { backdrop, initialFocus: initialFocus! };
}

function keepBranchPickerFocus(event: KeyboardEvent, dialog: HTMLElement): void {
  if (event.key !== 'Tab') return;

  const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Prompt locally for a graph branch. The picker deliberately receives only
 * ordinal/count/preview display data and never renders provider node IDs.
 */
export function showArchiveBranchPicker(
  options: ArchiveBranchPickerOption[]
): Promise<ArchiveBranchPickerSelection> {
  if (options.length === 0) return Promise.resolve(null);

  activeBranchPicker?.settle(null);
  document.getElementById(BRANCH_PICKER_BACKDROP_ID)?.remove();
  injectStyles();

  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return new Promise(resolve => {
    let settled = false;
    const finish = (selection: ArchiveBranchPickerSelection): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeydown, true);
      backdrop.remove();
      if (activeBranchPicker === controller) activeBranchPicker = null;
      previousFocus?.focus();
      resolve(selection);
    };
    const { backdrop, initialFocus } = createBranchPickerDialog(options, finish, () =>
      finish(null)
    );
    const dialog = backdrop.querySelector<HTMLElement>('.g2o-branch-picker')!;
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        handleTrustedBranchPickerAction(event, () => finish(null));
        return;
      }
      keepBranchPickerFocus(event, dialog);
    };
    const controller: ActiveBranchPicker = { settle: finish };
    activeBranchPicker = controller;
    document.addEventListener('keydown', onKeydown, true);
    document.body.appendChild(backdrop);
    initialFocus.focus();
  });
}

/**
 * Test-only seam: jsdom cannot synthesize trusted browser events. Production
 * interaction still reaches the picker only through handleTrustedBranchPickerAction.
 */
export function settleArchiveBranchPickerForTest(selection: ArchiveBranchPickerSelection): void {
  activeBranchPicker?.settle(selection);
}

/**
 * Set button loading state
 */
export function setButtonLoading(loading: boolean): void {
  const button = document.getElementById('g2o-sync-button') as HTMLButtonElement | null;
  const branchButton = document.getElementById(BRANCH_BUTTON_ID) as HTMLButtonElement | null;
  if (branchButton) branchButton.disabled = loading;
  if (!button) return;

  button.disabled = loading;

  const icon = button.querySelector('.icon');
  const text = button.querySelector('.text');

  if (loading) {
    if (icon) {
      const spinner = document.createElement('div');
      spinner.className = 'spinner';
      icon.replaceWith(spinner);
    }
    if (text) text.textContent = getMessage('ui_syncing');
  } else {
    const spinner = button.querySelector('.spinner');
    if (spinner) {
      const newIcon = document.createElement('span');
      newIcon.className = 'icon';
      newIcon.textContent = '📥';
      spinner.replaceWith(newIcon);
    }
    if (text) text.textContent = getMessage('ui_syncButton');
  }
}

type ToastType = 'success' | 'error' | 'warning' | 'info';

const TOAST_ICONS: Record<ToastType, string> = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
};

/**
 * Show a toast notification
 */
export function showToast(
  message: string,
  type: ToastType = 'info',
  duration: number = DEFAULT_TOAST_DURATION
): void {
  injectStyles();

  // Remove existing toast if present
  if (currentToast) {
    currentToast.remove();
    currentToast = null;
  }

  const toast = document.createElement('div');
  toast.className = `g2o-toast ${type}`;
  currentToast = toast;

  const toastIcon = document.createElement('span');
  toastIcon.className = 'icon';
  toastIcon.textContent = TOAST_ICONS[type];

  const toastMessage = document.createElement('span');
  toastMessage.className = 'message';
  toastMessage.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', () => {
    toast.remove();
    if (currentToast === toast) {
      currentToast = null;
    }
  });

  toast.appendChild(toastIcon);
  toast.appendChild(toastMessage);
  toast.appendChild(closeBtn);

  document.body.appendChild(toast);

  // Auto-dismiss
  if (duration > 0) {
    setTimeout(() => {
      if (currentToast !== toast) return;
      toast.style.animation = 'g2o-slideIn 0.3s ease reverse';
      setTimeout(() => {
        toast.remove();
        if (currentToast === toast) {
          currentToast = null;
        }
      }, 300);
    }, duration);
  }
}

/**
 * Show success toast with file info
 */
export function showSuccessToast(fileName: string, isNewFile: boolean): void {
  const messageKey = isNewFile ? 'toast_success_created' : 'toast_success_updated';
  showToast(getMessage(messageKey, fileName), 'success', SUCCESS_TOAST_DURATION);
}

/**
 * Show error toast with details
 */
export function showErrorToast(error: string): void {
  showToast(error, 'error', ERROR_TOAST_DURATION);
}

/**
 * Show warning toast
 */
export function showWarningToast(message: string): void {
  showToast(message, 'warning', WARNING_TOAST_DURATION);
}
