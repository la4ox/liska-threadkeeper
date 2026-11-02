import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  injectExportLauncher,
  removeExportControls,
  setButtonLoading,
  showToast,
  showSuccessToast,
  showErrorToast,
  showWarningToast,
} from '../../src/content/ui';
describe('launch-only provider UI', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    vi.clearAllMocks();
  });
  afterEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });
  it('redressing the genuine fox can only request trusted UI, never reveal action nodes', () => {
    const open = vi.fn();
    let listener: EventListener | undefined;
    const original = HTMLButtonElement.prototype.addEventListener;
    const spy = vi
      .spyOn(HTMLButtonElement.prototype, 'addEventListener')
      .mockImplementation(function (type, callback, options) {
        if (type === 'click') listener = callback as EventListener;
        return original.call(this, type, callback, options);
      });
    const fox = injectExportLauncher(open);
    spy.mockRestore();
    fox.style.cssText = 'position: fixed; inset: 0; width: 100vw; height: 100vh';
    listener!.call(fox, { isTrusted: true } as Event);
    expect(open).toHaveBeenCalledOnce();
    expect(
      document.querySelectorAll(
        '#g2o-sync-button, #g2o-branch-button, #g2o-launcher-actions, #g2o-branch-picker-backdrop, #g2o-all-branches-stop'
      )
    ).toHaveLength(0);
    fox.click();
    expect(open).toHaveBeenCalledOnce();
  });
  it('replaces only the launcher and remains openable while an export is busy', () => {
    injectExportLauncher(vi.fn());
    injectExportLauncher(vi.fn());
    setButtonLoading(true);
    expect(document.querySelectorAll('#g2o-launcher')).toHaveLength(1);
    expect((document.getElementById('g2o-launcher') as HTMLButtonElement).disabled).toBe(false);
    removeExportControls();
    expect(document.getElementById('g2o-launcher')).toBeNull();
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

      const button = injectExportLauncher(() => {});
      expect(button).toBeDefined();
      expect(button.id).toBe('g2o-launcher');
    });
  });
});
