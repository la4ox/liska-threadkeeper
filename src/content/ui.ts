/** Provider DOM is an untrusted launch affordance, never an export/selection control. */
import { getMessage } from '../lib/i18n';
import {
  DEFAULT_TOAST_DURATION,
  SUCCESS_TOAST_DURATION,
  ERROR_TOAST_DURATION,
  WARNING_TOAST_DURATION,
} from '../lib/constants';
import {
  createLiskaMark,
  LISKA_LAUNCHER_STYLES,
  bindLiskaLauncherInteraction,
} from './liska-launcher';
export type { ExportBranchOption as ArchiveBranchPickerOption } from '../lib/export-operation-contract';
export type ArchiveBranchPickerSelection = number | 'all' | null;
const STYLES = `${LISKA_LAUNCHER_STYLES}
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

  @media (max-width: 540px) {
    .g2o-toast {
      top: max(20px, env(safe-area-inset-top, 0px));
      right: max(20px, env(safe-area-inset-right, 0px));
      bottom: auto;
      max-width: calc(100vw - max(20px, env(safe-area-inset-right, 0px)) - max(20px, env(safe-area-inset-left, 0px)));
    }

    .g2o-toast.g2o-toast-with-stop {
      top: auto;
      bottom: calc(max(20px, env(safe-area-inset-bottom, 0px)) + 60px);
    }
  }
`;
let currentToast: HTMLDivElement | null = null;
function injectStyles(): void {
  if (document.getElementById('g2o-styles')) return;
  const style = document.createElement('style');
  style.id = 'g2o-styles';
  style.textContent = STYLES;
  document.head.appendChild(style);
}
export function injectExportLauncher(openSurface: () => void): HTMLButtonElement {
  injectStyles();
  removeExportControls();
  const shell = document.createElement('div');
  shell.id = 'g2o-launcher-shell';
  const launcher = document.createElement('button');
  launcher.id = 'g2o-launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-label', getMessage('ui_launcherLabel'));
  launcher.appendChild(createLiskaMark());
  bindLiskaLauncherInteraction(launcher, openSurface);
  shell.appendChild(launcher);
  document.body.appendChild(shell);
  return launcher;
}
export function removeExportControls(): void {
  for (const id of [
    'g2o-launcher-shell',
    'g2o-sync-button',
    'g2o-branch-button',
    'g2o-branch-picker-backdrop',
    'g2o-all-branches-stop',
  ])
    document.getElementById(id)?.remove();
}
export function setButtonLoading(loading: boolean): void {
  // The fox remains clickable while busy so it can reopen authoritative Stop/status.
  document.getElementById('g2o-launcher')?.setAttribute('aria-busy', String(loading));
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
