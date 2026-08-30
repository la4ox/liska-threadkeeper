/**
 * UI component tests
 *
 * Tests the sync button injection, loading states, and toast notifications.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  injectBranchExportButton,
  injectSyncButton,
  handleTrustedBranchClick,
  handleTrustedSyncClick,
  handleTrustedBranchPickerAction,
  setButtonLoading,
  settleArchiveBranchPickerForTest,
  showArchiveBranchPicker,
  showToast,
  showSuccessToast,
  showErrorToast,
  showWarningToast,
} from '../../src/content/ui';

describe('ui', () => {
  beforeEach(() => {
    // Clean up any existing UI elements
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    vi.clearAllMocks();
  });

  afterEach(() => {
    settleArchiveBranchPickerForTest(null);
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  describe('injectSyncButton', () => {
    it('creates a button with correct id', () => {
      const onClick = vi.fn();
      const button = injectSyncButton(onClick);

      expect(button.id).toBe('g2o-sync-button');
      expect(document.getElementById('g2o-sync-button')).toBe(button);
    });

    it('injects styles into document head', async () => {
      // Reset the module to clear the styleInjected flag
      vi.resetModules();
      const { injectSyncButton: freshInjectSyncButton } = await import('../../src/content/ui');

      document.body.innerHTML = '';
      document.head.innerHTML = '';

      const onClick = vi.fn();
      freshInjectSyncButton(onClick);

      const styleElement = document.getElementById('g2o-styles');
      expect(styleElement).not.toBeNull();
      expect(styleElement?.tagName).toBe('STYLE');
    });

    it('button is appended to document body', () => {
      const onClick = vi.fn();
      injectSyncButton(onClick);

      expect(document.body.querySelector('#g2o-sync-button')).not.toBeNull();
    });

    it('ignores programmatic button clicks', () => {
      const onClick = vi.fn();
      injectSyncButton(onClick);

      const button = document.getElementById('g2o-sync-button');
      button?.click();

      expect(onClick).not.toHaveBeenCalled();
    });

    it('calls onClick for a trusted user gesture', () => {
      const onClick = vi.fn();

      handleTrustedSyncClick({ isTrusted: true } as Event, onClick);

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('removes existing button before creating new one', () => {
      const onClick1 = vi.fn();
      const onClick2 = vi.fn();

      injectSyncButton(onClick1);
      injectSyncButton(onClick2);

      // Should only have one button
      const buttons = document.querySelectorAll('#g2o-sync-button');
      expect(buttons.length).toBe(1);

      // New button should have the new handler. jsdom cannot create a trusted
      // click, so verify replacement independently from the authorization seam.
      handleTrustedSyncClick({ isTrusted: true } as Event, onClick2);
      expect(onClick1).not.toHaveBeenCalled();
      expect(onClick2).toHaveBeenCalledTimes(1);
    });

    it('button contains icon and text spans', () => {
      const onClick = vi.fn();
      injectSyncButton(onClick);

      const button = document.getElementById('g2o-sync-button');
      const icon = button?.querySelector('.icon');
      const text = button?.querySelector('.text');

      expect(icon).not.toBeNull();
      expect(text).not.toBeNull();
    });

    it('only injects styles once', async () => {
      // Reset the module to clear the styleInjected flag
      vi.resetModules();
      const { injectSyncButton: freshInjectSyncButton } = await import('../../src/content/ui');

      document.body.innerHTML = '';
      document.head.innerHTML = '';

      const onClick = vi.fn();
      freshInjectSyncButton(onClick);
      freshInjectSyncButton(onClick);
      freshInjectSyncButton(onClick);

      const styles = document.querySelectorAll('#g2o-styles');
      expect(styles.length).toBe(1);
    });
  });

  describe('setButtonLoading', () => {
    beforeEach(() => {
      const onClick = vi.fn();
      injectSyncButton(onClick);
      injectBranchExportButton(onClick);
    });

    it('disables button when loading', () => {
      setButtonLoading(true);

      const button = document.getElementById('g2o-sync-button') as HTMLButtonElement;
      const branchButton = document.getElementById('g2o-branch-button') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(branchButton.disabled).toBe(true);
    });

    it('enables button when not loading', () => {
      setButtonLoading(true);
      setButtonLoading(false);

      const button = document.getElementById('g2o-sync-button') as HTMLButtonElement;
      const branchButton = document.getElementById('g2o-branch-button') as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      expect(branchButton.disabled).toBe(false);
    });

    it('shows spinner when loading', () => {
      setButtonLoading(true);

      const button = document.getElementById('g2o-sync-button');
      const spinner = button?.querySelector('.spinner');

      expect(spinner).not.toBeNull();
    });

    it('removes spinner when not loading', () => {
      setButtonLoading(true);
      setButtonLoading(false);

      const button = document.getElementById('g2o-sync-button');
      const spinner = button?.querySelector('.spinner');
      const icon = button?.querySelector('.icon');

      expect(spinner).toBeNull();
      expect(icon).not.toBeNull();
    });

    it('does nothing when button does not exist', () => {
      document.body.innerHTML = '';

      // Should not throw
      expect(() => setButtonLoading(true)).not.toThrow();
      expect(() => setButtonLoading(false)).not.toThrow();
    });
  });

  describe('branch picker', () => {
    const options = [
      {
        ordinal: 1,
        messageCount: 18,
        uniqueMessageCount: 4,
        isCurrent: true,
        preview: 'Current branch preview',
      },
      {
        ordinal: 2,
        messageCount: 15,
        uniqueMessageCount: 2,
        isCurrent: false,
        preview: 'Alternate branch preview',
      },
    ];

    it('injects the localized branch button above the main export button', () => {
      injectSyncButton(vi.fn());
      const button = injectBranchExportButton(vi.fn());

      expect(button.id).toBe('g2o-branch-button');
      expect(button.getAttribute('aria-label')).toBe('ui_branchButtonTitle');
      expect(button.title).toBe('ui_branchButtonTitle');
      expect(button.compareDocumentPosition(document.getElementById('g2o-sync-button')!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      );
    });

    it('replaces the old branch button and ignores programmatic clicks', () => {
      const first = vi.fn();
      const second = vi.fn();
      injectBranchExportButton(first);
      const replacement = injectBranchExportButton(second);

      replacement.click();
      expect(document.querySelectorAll('#g2o-branch-button')).toHaveLength(1);
      expect(first).not.toHaveBeenCalled();
      expect(second).not.toHaveBeenCalled();

      handleTrustedBranchClick({ isTrusted: true } as Event, second);
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('rejects untrusted picker actions but accepts the trusted test seam', () => {
      const action = vi.fn();
      handleTrustedBranchPickerAction({ isTrusted: false } as Event, action);
      expect(action).not.toHaveBeenCalled();

      handleTrustedBranchPickerAction({ isTrusted: true } as Event, action);
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('renders a current marker and treats previews as text, not HTML', async () => {
      const result = showArchiveBranchPicker([
        { ...options[0], preview: '<img src=x onerror="alert(1)">' },
      ]);

      const picker = document.getElementById('g2o-branch-picker-backdrop');
      const preview = picker?.querySelector('.g2o-branch-picker-preview');
      const current = picker?.querySelector('.g2o-branch-picker-current');
      const exportAll = picker?.querySelector<HTMLButtonElement>('.g2o-branch-picker-export-all');
      const exportAllHelp = picker?.querySelector('.g2o-branch-picker-export-all-help');
      expect(preview?.innerHTML).not.toContain('<img');
      expect(preview?.textContent).toContain('<img');
      expect(current?.textContent).toBe('ui_branchPickerCurrent');
      expect(picker?.querySelector('[aria-current="true"]')).not.toBeNull();
      expect(document.activeElement).toBe(picker?.querySelector('[aria-current="true"]'));
      expect(exportAll?.textContent).toBe('ui_branchPickerExportAll');
      expect(exportAllHelp?.textContent).toBe('ui_branchPickerExportAllHelp');
      expect(exportAll?.getAttribute('aria-describedby')).toBe(exportAllHelp?.id);

      settleArchiveBranchPickerForTest(null);
      await expect(result).resolves.toBeNull();
    });

    it('returns only the selected ordinal and cleans up the picker', async () => {
      const result = showArchiveBranchPicker(options);
      let settled = false;
      void result.then(() => {
        settled = true;
      });

      const firstOption = document.querySelector<HTMLButtonElement>('.g2o-branch-picker-option');
      firstOption?.click();
      await Promise.resolve();
      expect(settled).toBe(false);

      settleArchiveBranchPickerForTest(2);
      await expect(result).resolves.toBe(2);
      expect(document.getElementById('g2o-branch-picker-backdrop')).toBeNull();
    });

    it('ignores programmatic all-branches clicks and resolves all through the trusted seam', async () => {
      const result = showArchiveBranchPicker(options);
      let settled = false;
      void result.then(() => {
        settled = true;
      });

      const exportAll = document.querySelector<HTMLButtonElement>('.g2o-branch-picker-export-all')!;
      exportAll.click();
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(document.getElementById('g2o-branch-picker-backdrop')).not.toBeNull();

      handleTrustedBranchPickerAction({ isTrusted: true } as Event, () =>
        settleArchiveBranchPickerForTest('all')
      );
      await expect(result).resolves.toBe('all');
      expect(document.getElementById('g2o-branch-picker-backdrop')).toBeNull();
    });

    it('ignores a programmatic Escape and cleans up through the trusted seam', async () => {
      const result = showArchiveBranchPicker(options);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(document.getElementById('g2o-branch-picker-backdrop')).not.toBeNull();

      handleTrustedBranchPickerAction({ isTrusted: true } as Event, () =>
        settleArchiveBranchPickerForTest(null)
      );
      await expect(result).resolves.toBeNull();
      expect(document.getElementById('g2o-branch-picker-backdrop')).toBeNull();
    });

    it('replaces an existing picker and resolves the earlier request as canceled', async () => {
      const first = showArchiveBranchPicker(options);
      const second = showArchiveBranchPicker([{ ...options[1], ordinal: 9 }]);

      await expect(first).resolves.toBeNull();
      expect(document.querySelectorAll('#g2o-branch-picker-backdrop')).toHaveLength(1);
      settleArchiveBranchPickerForTest(9);
      await expect(second).resolves.toBe(9);
    });

    it('keeps keyboard Tab focus inside the local picker', async () => {
      const result = showArchiveBranchPicker(options);
      const picker = document.querySelector<HTMLElement>('.g2o-branch-picker')!;
      const first = picker.querySelector<HTMLButtonElement>('.g2o-branch-picker-option')!;
      const exportAll = picker.querySelector<HTMLButtonElement>('.g2o-branch-picker-export-all')!;
      const cancel = picker.querySelector<HTMLButtonElement>('.g2o-branch-picker-cancel')!;

      const buttons = Array.from(
        picker.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
      );
      expect(buttons.at(-2)).toBe(exportAll);
      expect(buttons.at(-1)).toBe(cancel);

      exportAll.focus();
      expect(document.activeElement).toBe(exportAll);

      cancel.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(document.activeElement).toBe(first);

      first.focus();
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
      );
      expect(document.activeElement).toBe(cancel);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(document.activeElement).toBe(cancel);

      settleArchiveBranchPickerForTest(null);
      await expect(result).resolves.toBeNull();
    });

    it('restores the prior focus after the trusted all-branches selection cleans up', async () => {
      const trigger = document.createElement('button');
      document.body.appendChild(trigger);
      trigger.focus();

      const result = showArchiveBranchPicker(options);
      expect(document.activeElement).not.toBe(trigger);

      handleTrustedBranchPickerAction({ isTrusted: true } as Event, () =>
        settleArchiveBranchPickerForTest('all')
      );
      await expect(result).resolves.toBe('all');
      expect(document.getElementById('g2o-branch-picker-backdrop')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it('returns null without rendering UI for an empty branch list', async () => {
      await expect(showArchiveBranchPicker([])).resolves.toBeNull();
      expect(document.getElementById('g2o-branch-picker-backdrop')).toBeNull();
    });
  });

  describe('showToast', () => {
    it('creates toast element in document body', () => {
      showToast('Test message', 'info', 0);

      const toast = document.querySelector('.g2o-toast');
      expect(toast).not.toBeNull();
    });

    it('displays the message', () => {
      showToast('Test message', 'info', 0);

      const message = document.querySelector('.g2o-toast .message');
      expect(message?.textContent).toBe('Test message');
    });

    it('applies correct class for success type', () => {
      showToast('Success!', 'success', 0);

      const toast = document.querySelector('.g2o-toast');
      expect(toast?.classList.contains('success')).toBe(true);
    });

    it('applies correct class for error type', () => {
      showToast('Error!', 'error', 0);

      const toast = document.querySelector('.g2o-toast');
      expect(toast?.classList.contains('error')).toBe(true);
    });

    it('applies correct class for warning type', () => {
      showToast('Warning!', 'warning', 0);

      const toast = document.querySelector('.g2o-toast');
      expect(toast?.classList.contains('warning')).toBe(true);
    });

    it('applies correct class for info type', () => {
      showToast('Info!', 'info', 0);

      const toast = document.querySelector('.g2o-toast');
      expect(toast?.classList.contains('info')).toBe(true);
    });

    it('shows correct icon for each type', () => {
      showToast('Test', 'success', 0);
      let icon = document.querySelector('.g2o-toast .icon');
      expect(icon?.textContent).toBe('✅');

      document.body.innerHTML = '';
      showToast('Test', 'error', 0);
      icon = document.querySelector('.g2o-toast .icon');
      expect(icon?.textContent).toBe('❌');

      document.body.innerHTML = '';
      showToast('Test', 'warning', 0);
      icon = document.querySelector('.g2o-toast .icon');
      expect(icon?.textContent).toBe('⚠️');

      document.body.innerHTML = '';
      showToast('Test', 'info', 0);
      icon = document.querySelector('.g2o-toast .icon');
      expect(icon?.textContent).toBe('ℹ️');
    });

    it('removes existing toasts before showing new one', () => {
      showToast('First', 'info', 0);
      showToast('Second', 'success', 0);

      const toasts = document.querySelectorAll('.g2o-toast');
      expect(toasts.length).toBe(1);
      expect(document.querySelector('.g2o-toast .message')?.textContent).toBe('Second');
    });

    it('close button removes toast', () => {
      showToast('Test', 'info', 0);

      const closeBtn = document.querySelector('.g2o-toast .close') as HTMLButtonElement;
      closeBtn?.click();

      const toast = document.querySelector('.g2o-toast');
      expect(toast).toBeNull();
    });

    it('escapes HTML in message to prevent XSS', () => {
      showToast('<script>alert("xss")</script>', 'info', 0);

      const message = document.querySelector('.g2o-toast .message');
      expect(message?.innerHTML).not.toContain('<script>');
      expect(message?.textContent).toContain('<script>');
    });

    it('auto-dismisses after duration', async () => {
      vi.useFakeTimers();

      showToast('Test', 'info', 1000);

      expect(document.querySelector('.g2o-toast')).not.toBeNull();

      // Fast-forward past the duration + animation
      vi.advanceTimersByTime(1300);

      expect(document.querySelector('.g2o-toast')).toBeNull();

      vi.useRealTimers();
    });

    it('does not auto-dismiss when duration is 0', async () => {
      vi.useFakeTimers();

      showToast('Test', 'info', 0);

      vi.advanceTimersByTime(10000);

      expect(document.querySelector('.g2o-toast')).not.toBeNull();

      vi.useRealTimers();
    });

    it('injects styles if not already injected', async () => {
      // Reset the module to clear the styleInjected flag
      vi.resetModules();
      const { showToast: freshShowToast } = await import('../../src/content/ui');

      document.body.innerHTML = '';
      document.head.innerHTML = '';

      freshShowToast('Test', 'info', 0);

      const styleElement = document.getElementById('g2o-styles');
      expect(styleElement).not.toBeNull();
    });
  });

  describe('showSuccessToast', () => {
    it('shows success toast for new file', () => {
      showSuccessToast('test.md', true);

      const toast = document.querySelector('.g2o-toast');
      expect(toast?.classList.contains('success')).toBe(true);
    });

    it('shows success toast for updated file', () => {
      showSuccessToast('test.md', false);

      const toast = document.querySelector('.g2o-toast');
      expect(toast?.classList.contains('success')).toBe(true);
    });
  });

  describe('showErrorToast', () => {
    it('shows error toast', () => {
      showErrorToast('Something went wrong');

      const toast = document.querySelector('.g2o-toast');
      expect(toast?.classList.contains('error')).toBe(true);
      expect(document.querySelector('.g2o-toast .message')?.textContent).toBe(
        'Something went wrong'
      );
    });
  });

  describe('showWarningToast', () => {
    it('shows warning toast', () => {
      showWarningToast('This is a warning');

      const toast = document.querySelector('.g2o-toast');
      expect(toast?.classList.contains('warning')).toBe(true);
      expect(document.querySelector('.g2o-toast .message')?.textContent).toBe('This is a warning');
    });
  });

  describe('getMessage error fallback', () => {
    it('returns raw key when chrome.i18n.getMessage throws', () => {
      vi.mocked(chrome.i18n.getMessage).mockImplementation(() => {
        throw new Error('i18n not available');
      });

      const button = injectSyncButton(() => {});
      expect(button).toBeDefined();
      expect(button.id).toBe('g2o-sync-button');
    });
  });
});
