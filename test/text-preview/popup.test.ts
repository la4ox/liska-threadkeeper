import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initExportSurface } from '../../src/popup/export';
import type { ExportControlMessage, ExportStatus } from '../../src/lib/export-operation-contract';
import type { PreviewRequest } from '../../src/text-preview/protocol';
import type { TextPreviewStartStatus } from '../../src/lib/text-preview-contract';
import messages from '../../src/_locales/en/messages.json';
import { captureTrustedActions, deferred, el, flush, SESSION } from './helpers';
const SELECTION = '12345678-1234-4234-8234-123456789aaa';
const base: ExportStatus = {
  success: true,
  target: {
    tabId: 7,
    platform: 'chatgpt',
    route: 'https://chatgpt.com/c/synthetic',
    title: 'Synthetic',
  },
  outputs: [],
};
const option = {
  ordinal: 2,
  messageCount: 5,
  uniqueMessageCount: 2,
  isCurrent: false,
  preview: '<script>inert</script>',
};
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.innerHTML = fs.readFileSync('src/popup/index.html', 'utf8');
  vi.mocked(chrome.i18n.getMessage).mockImplementation(
    key => (messages as Record<string, { message: string }>)[key]?.message ?? key
  );
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function previewRequest(captureExpiresAt = Date.now() + 60_000, expiresAt = Date.now() + 900_000) {
  return vi.fn<PreviewRequest>(async message => {
    if (message.action === 'startTextPreview')
      return {
        success: true,
        sessionId: SESSION,
        state: 'capturing',
        expiresAt,
        captureExpiresAt,
      } satisfies TextPreviewStartStatus;
    if (message.action === 'getTextPreviewBranchOptions')
      return {
        success: true,
        state: 'awaiting-selection',
        selectionId: SELECTION,
        options: [option],
      };
    return { success: true };
  });
}

describe('popup Text-only preview controls', () => {
  it.each(['current', 'selected'] as const)(
    'starts %s with exact target, independent of outputs and only trusted events',
    async mode => {
      const trusted = captureTrustedActions();
      const exportRequest = vi.fn(async () => base);
      const preview = previewRequest();
      dispose = await initExportSurface(exportRequest, preview);
      expect(preview).not.toHaveBeenCalled();
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
      const button = el<HTMLButtonElement>(
        mode === 'current' ? 'previewCurrent' : 'previewSelected'
      );
      expect(button.disabled).toBe(false);
      button.click();
      expect(preview).not.toHaveBeenCalled();
      trusted(button);
      expect(preview).toHaveBeenCalledWith({
        action: 'startTextPreview',
        expectedTarget: { tabId: 7, route: base.target!.route },
        branchMode: mode,
      });
      expect(el<HTMLButtonElement>('exportCurrent').disabled).toBe(true);
      trusted(el('exportCurrent'));
      trusted(el('exportSelected'));
      trusted(button);
      await flush();
      expect(
        exportRequest.mock.calls.some(
          ([m]: [ExportControlMessage]) => m.action === 'startExportOperation'
        )
      ).toBe(false);
      expect(preview.mock.calls.filter(([m]) => m.action === 'startTextPreview')).toHaveLength(1);
      expect(el<HTMLButtonElement>('previewCurrent').disabled).toBe(true);
      if (mode === 'current')
        expect(el('previewStatus').textContent).toContain('continue in its window');
    }
  );
  it('learns selectionId from options response, offers numeric choices only, retires stale buttons', async () => {
    const trusted = captureTrustedActions();
    const preview = previewRequest();
    dispose = await initExportSurface(async () => base, preview);
    trusted(el('previewSelected'));
    await flush();
    const old = document.querySelector<HTMLButtonElement>('#previewBranches button')!;
    expect(old.textContent).toContain('#2');
    expect(document.querySelector('#previewBranches script')).toBeNull();
    expect(document.querySelectorAll('#previewBranches button')).toHaveLength(1);
    expect(el('previewBranches').textContent).not.toContain('Export all');
    old.click();
    expect(preview.mock.calls.some(([m]) => m.action === 'chooseTextPreviewBranch')).toBe(false);
    const changedSelection = '12345678-1234-4234-8234-123456789aab';
    preview.mockImplementation(async message =>
      message.action === 'getTextPreviewBranchOptions'
        ? {
            success: true,
            state: 'awaiting-selection',
            selectionId: changedSelection,
            options: [option],
          }
        : { success: true }
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(old.disabled).toBe(true);
    trusted(old);
    expect(preview.mock.calls.some(([m]) => m.action === 'chooseTextPreviewBranch')).toBe(false);
    const current = document.querySelector<HTMLButtonElement>('#previewBranches button')!;
    trusted(current);
    trusted(current);
    await flush();
    expect(preview).toHaveBeenCalledWith({
      action: 'chooseTextPreviewBranch',
      sessionId: SESSION,
      selectionId: changedSelection,
      choice: 2,
    });
    expect(preview.mock.calls.filter(([m]) => m.action === 'chooseTextPreviewBranch')).toHaveLength(
      1
    );
    expect(el('previewStatus').textContent).toContain('continue in its window');
    expect(current.disabled).toBe(true);
    const calls = preview.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(preview).toHaveBeenCalledTimes(calls);
  });
  it('uses the exact start-response capture deadline, not its later page lease, without renewal', async () => {
    const trusted = captureTrustedActions();
    const startStatus: TextPreviewStartStatus = {
      success: true,
      sessionId: SESSION,
      state: 'capturing',
      expiresAt: Date.now() + 900_000,
      captureExpiresAt: Date.now() + 1_500,
    };
    const preview = previewRequest();
    const implementation = preview.getMockImplementation()!;
    preview.mockImplementation(message =>
      message.action === 'startTextPreview' ? Promise.resolve(startStatus) : implementation(message)
    );
    dispose = await initExportSurface(async () => base, preview);
    trusted(el('previewSelected'));
    await flush();
    const button = document.querySelector<HTMLButtonElement>('#previewBranches button')!;
    await vi.advanceTimersByTimeAsync(1_499);
    expect(button.disabled).toBe(false);
    expect(button.isConnected).toBe(true);
    expect(el('previewStatus').textContent).toContain('Choose one branch');
    await vi.advanceTimersByTimeAsync(1);
    expect(Date.now()).toBeLessThan(startStatus.expiresAt);
    expect(el('previewStatus').textContent).toBe(
      'Branch selection expired; close the preview window and try again.'
    );
    expect(button.disabled).toBe(true);
    trusted(button);
    const calls = preview.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(preview).toHaveBeenCalledTimes(calls);
    expect(preview.mock.calls.some(([m]) => m.action === 'getTextPreviewStatus')).toBe(false);
  });
  it.each([undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, '900000'])(
    'requires a live numeric captureExpiresAt instead of falling back to the page lease: %s',
    async captureExpiresAt => {
      const trusted = captureTrustedActions();
      const preview = vi.fn<PreviewRequest>(async () => ({
        success: true,
        sessionId: SESSION,
        state: 'capturing',
        expiresAt: Date.now() + 900_000,
        captureExpiresAt,
      }));
      dispose = await initExportSurface(async () => base, preview);
      trusted(el('previewSelected'));
      await flush();
      expect(el('previewStatus').textContent).toContain('could not be confirmed');
      expect(preview).toHaveBeenCalledOnce();
      expect(document.querySelectorAll('#previewBranches button')).toHaveLength(0);
    }
  );
  it('shows only an allowlisted startup stage and never forwards native failure detail', async () => {
    const trusted = captureTrustedActions();
    const preview = vi.fn<PreviewRequest>(async () => ({
      success: false,
      error: 'private browser failure',
      failureStep: 'navigation-current',
      privateDetail: 'must-not-cross',
    }));
    dispose = await initExportSurface(async () => base, preview);
    trusted(el('previewCurrent'));
    await flush();
    expect(el('previewStatus').textContent).toContain('did not finish opening its local page');
    expect(el('previewStatus').textContent).not.toContain('navigation-current');
    expect(el('previewStatus').textContent).not.toContain('private');
    expect(el('previewStatus').textContent).not.toContain('must-not-cross');
  });
  it('preserves keyboard focus and exact button DOM across repeated identical one-second responses', async () => {
    const trusted = captureTrustedActions();
    const preview = previewRequest();
    const implementation = preview.getMockImplementation()!;
    preview.mockImplementation(message =>
      message.action === 'getTextPreviewBranchOptions'
        ? Promise.resolve({
            success: true,
            state: 'awaiting-selection',
            selectionId: SELECTION,
            options: [{ ...option }],
          })
        : implementation(message)
    );
    dispose = await initExportSurface(async () => base, preview);
    trusted(el('previewSelected'));
    await flush();
    const branches = el('previewBranches');
    const focused = branches.querySelector<HTMLButtonElement>('button')!;
    const rebuild = vi.spyOn(branches, 'replaceChildren');
    focused.focus();
    for (let tick = 0; tick < 3; tick += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      expect(branches.querySelector('button')).toBe(focused);
      expect(document.activeElement).toBe(focused);
      expect(focused.disabled).toBe(false);
    }
    expect(rebuild).not.toHaveBeenCalled();
    expect(
      preview.mock.calls.filter(([message]) => message.action === 'getTextPreviewBranchOptions')
    ).toHaveLength(4);
    focused.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    trusted(focused);
    await flush();
    expect(preview).toHaveBeenCalledWith({
      action: 'chooseTextPreviewBranch',
      sessionId: SESSION,
      selectionId: SELECTION,
      choice: option.ordinal,
    });
  });
  it('keeps a pressed pointer target connected and clickable while identical refreshes arrive', async () => {
    const trusted = captureTrustedActions();
    const preview = previewRequest();
    dispose = await initExportSurface(async () => base, preview);
    trusted(el('previewSelected'));
    await flush();
    const target = document.querySelector<HTMLButtonElement>('#previewBranches button')!;
    const release = vi.fn();
    target.addEventListener('mouseup', release);
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(document.querySelector('#previewBranches button')).toBe(target);
    expect(target.isConnected).toBe(true);
    expect(target.disabled).toBe(false);
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(release).toHaveBeenCalledOnce();
    trusted(target);
    await flush();
    expect(
      preview.mock.calls.filter(([message]) => message.action === 'chooseTextPreviewBranch')
    ).toHaveLength(1);
  });
  it.each([
    ['ordinal', 3],
    ['messageCount', 6],
    ['uniqueMessageCount', 1],
    ['isCurrent', true],
    ['preview', 'changed'],
    ['preview', undefined],
  ] as const)(
    'retires stale buttons when exact option scalar %s changes to %s',
    async (field, value) => {
      const trusted = captureTrustedActions();
      const preview = previewRequest();
      const implementation = preview.getMockImplementation()!;
      let liveOption = { ...option };
      preview.mockImplementation(message =>
        message.action === 'getTextPreviewBranchOptions'
          ? Promise.resolve({
              success: true,
              state: 'awaiting-selection',
              selectionId: SELECTION,
              options: [liveOption],
            })
          : implementation(message)
      );
      dispose = await initExportSurface(async () => base, preview);
      trusted(el('previewSelected'));
      await flush();
      const retired = document.querySelector<HTMLButtonElement>('#previewBranches button')!;
      liveOption = { ...option, [field]: value };
      await vi.advanceTimersByTimeAsync(1_000);
      const replacement = document.querySelector<HTMLButtonElement>('#previewBranches button')!;
      expect(replacement).not.toBe(retired);
      expect(retired.disabled).toBe(true);
      expect(retired.isConnected).toBe(false);
      trusted(retired);
      expect(
        preview.mock.calls.some(([message]) => message.action === 'chooseTextPreviewBranch')
      ).toBe(false);
      trusted(replacement);
      await flush();
      expect(preview).toHaveBeenCalledWith({
        action: 'chooseTextPreviewBranch',
        sessionId: SESSION,
        selectionId: SELECTION,
        choice: liveOption.ordinal,
      });
    }
  );
  it('temporarily disables unconfirmed choices without replacing their DOM, then restores identical choices', async () => {
    const trusted = captureTrustedActions();
    const preview = previewRequest();
    const implementation = preview.getMockImplementation()!;
    let available = true;
    preview.mockImplementation(message =>
      message.action === 'getTextPreviewBranchOptions' && !available
        ? Promise.resolve({ success: false, error: 'text-preview-unavailable' })
        : implementation(message)
    );
    dispose = await initExportSurface(async () => base, preview);
    trusted(el('previewSelected'));
    await flush();
    const retained = document.querySelector<HTMLButtonElement>('#previewBranches button')!;
    const rebuild = vi.spyOn(el('previewBranches'), 'replaceChildren');
    available = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(retained.isConnected).toBe(true);
    expect(retained.disabled).toBe(true);
    trusted(retained);
    expect(
      preview.mock.calls.some(([message]) => message.action === 'chooseTextPreviewBranch')
    ).toBe(false);
    available = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(document.querySelector('#previewBranches button')).toBe(retained);
    expect(retained.disabled).toBe(false);
    expect(rebuild).not.toHaveBeenCalled();
  });
  it('ignores late option responses after disposal and distinguishes waiting from a confirmed choice', async () => {
    const trusted = captureTrustedActions();
    const options = deferred<unknown>();
    const preview = previewRequest();
    preview.mockImplementation(async message =>
      message.action === 'startTextPreview'
        ? ({
            success: true,
            sessionId: SESSION,
            state: 'capturing',
            expiresAt: Date.now() + 900_000,
            captureExpiresAt: Date.now() + 60_000,
          } satisfies TextPreviewStartStatus)
        : options.promise
    );
    dispose = await initExportSurface(async () => base, preview);
    trusted(el('previewSelected'));
    await flush();
    expect(el('previewStatus').textContent).toContain('Waiting for branch choices');
    dispose();
    options.resolve({
      success: true,
      state: 'awaiting-selection',
      selectionId: SELECTION,
      options: [option],
    });
    await flush();
    expect(document.querySelectorAll('#previewBranches button')).toHaveLength(0);
  });
  it('expires options that arrive after the capture deadline', async () => {
    const trusted = captureTrustedActions();
    const captureExpiresAt = Date.now() + 60_000;
    const options = deferred<unknown>();
    const preview = previewRequest(captureExpiresAt);
    preview.mockImplementation(async message =>
      message.action === 'startTextPreview'
        ? {
            success: true,
            sessionId: SESSION,
            state: 'capturing',
            expiresAt: Date.now() + 900_000,
            captureExpiresAt,
          }
        : options.promise
    );
    dispose = await initExportSurface(async () => base, preview);
    trusted(el('previewSelected'));
    await flush();
    expect(el('previewStatus').textContent).toContain('Waiting for branch choices');

    // A wall-clock jump can make a pending response late without first running its timer.
    vi.setSystemTime(captureExpiresAt);
    options.resolve({
      success: true,
      state: 'awaiting-selection',
      selectionId: SELECTION,
      options: [option],
    });
    await flush();

    expect(el('previewStatus').textContent).toBe(messages.preview_branchExpired.message);
    expect(document.querySelectorAll('#previewBranches button')).toHaveLength(0);
  });
  it('keeps failed branch choices unavailable without exposing runtime errors or retrying', async () => {
    const trusted = captureTrustedActions();
    const preview = previewRequest();
    preview.mockImplementation(async message =>
      message.action === 'chooseTextPreviewBranch'
        ? { success: false, error: 'private' }
        : message.action === 'startTextPreview'
          ? {
              success: true,
              sessionId: SESSION,
              state: 'capturing',
              expiresAt: Date.now() + 900_000,
              captureExpiresAt: Date.now() + 60_000,
            }
          : {
              success: true,
              state: 'awaiting-selection',
              selectionId: SELECTION,
              options: [option],
            }
    );
    dispose = await initExportSurface(async () => base, preview);
    trusted(el('previewSelected'));
    await flush();
    const choice = document.querySelector<HTMLButtonElement>('#previewBranches button')!;
    trusted(choice);
    await flush();

    expect(el('previewStatus').textContent).toBe(messages.preview_unavailable.message);
    expect(el('previewStatus').textContent).not.toContain('private');
    expect(choice.disabled).toBe(true);
    expect(
      preview.mock.calls.filter(([message]) => message.action === 'chooseTextPreviewBranch')
    ).toHaveLength(1);
  });
  it('disables existing choices and keeps waiting when options refresh rejects', async () => {
    const trusted = captureTrustedActions();
    const preview = previewRequest();
    const implementation = preview.getMockImplementation()!;
    let optionRequests = 0;
    preview.mockImplementation(message => {
      if (message.action === 'getTextPreviewBranchOptions' && optionRequests++ > 0)
        return Promise.reject(new Error('private options failure'));
      return implementation(message);
    });
    dispose = await initExportSurface(async () => base, preview);
    trusted(el('previewSelected'));
    await flush();
    const choice = document.querySelector<HTMLButtonElement>('#previewBranches button')!;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(choice.isConnected).toBe(true);
    expect(choice.disabled).toBe(true);
    expect(el('previewStatus').textContent).toBe(messages.preview_waitingBranch.message);
    expect(el('previewStatus').textContent).not.toContain('private');
    trusted(choice);
    expect(
      preview.mock.calls.some(([message]) => message.action === 'chooseTextPreviewBranch')
    ).toBe(false);
  });
  it('hides selected mode for DeepSeek and rejects unsupported providers', async () => {
    const trusted = captureTrustedActions();
    const preview = previewRequest();
    dispose = await initExportSurface(
      async () => ({ ...base, target: { ...base.target!, platform: 'deepseek' } }),
      preview
    );
    expect(el('previewSelected').hidden).toBe(true);
    trusted(el('previewSelected'));
    expect(preview).not.toHaveBeenCalled();
    dispose();
    dispose = await initExportSurface(
      async () => ({ ...base, target: { ...base.target!, platform: 'claude' } }),
      preview
    );
    expect(el<HTMLButtonElement>('previewCurrent').disabled).toBe(true);
    trusted(el('previewCurrent'));
    expect(preview).not.toHaveBeenCalled();
  });
  it('cannot race preview against a pending ordinary export; ordinary start remains unchanged', async () => {
    const trusted = captureTrustedActions();
    const started = deferred<ExportStatus>();
    const preview = previewRequest();
    const request = vi.fn(async (message: ExportControlMessage) =>
      message.action === 'startExportOperation'
        ? started.promise
        : { ...base, outputs: ['file' as const] }
    );
    dispose = await initExportSurface(request, preview);
    trusted(el('exportCurrent'));
    trusted(el('previewCurrent'));
    expect(preview).not.toHaveBeenCalled();
    expect(el<HTMLButtonElement>('previewCurrent').disabled).toBe(true);
    expect(request).toHaveBeenCalledWith({
      action: 'startExportOperation',
      mode: 'current',
      expectedTarget: { tabId: 7, route: base.target!.route },
      expectedOutputs: ['file'],
    });
    started.resolve({ ...base, success: true });
    await flush();
  });
  it('shows fixed unknown-start language and never automatically retries', async () => {
    const trusted = captureTrustedActions();
    const preview = vi.fn<PreviewRequest>(async () => {
      throw new Error('private');
    });
    dispose = await initExportSurface(async () => base, preview);
    trusted(el('previewCurrent'));
    await flush();
    expect(el('previewStatus').textContent).toContain('could not be confirmed');
    expect(el('previewStatus').textContent).not.toContain('private');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(preview).toHaveBeenCalledOnce();
  });
  it('keeps branch expiry final when a choice reply arrives after its deadline', async () => {
    const trusted = captureTrustedActions();
    const choice = deferred<unknown>();
    const preview = previewRequest(Date.now() + 1_500);
    const implementation = preview.getMockImplementation()!;
    preview.mockImplementation(message =>
      message.action === 'chooseTextPreviewBranch' ? choice.promise : implementation(message)
    );
    dispose = await initExportSurface(async () => base, preview);
    trusted(el('previewSelected'));
    await flush();
    trusted(document.querySelector<HTMLButtonElement>('#previewBranches button')!);
    await vi.advanceTimersByTimeAsync(1_500);
    choice.resolve({ success: true });
    await flush();
    expect(el('previewStatus').textContent).toContain('Branch selection expired');
    expect(preview.mock.calls.filter(([m]) => m.action === 'chooseTextPreviewBranch')).toHaveLength(
      1
    );
  });
  it('continues waiting on generic unavailable branch metadata without inventing a failure state', async () => {
    const trusted = captureTrustedActions();
    const preview = previewRequest(Date.now() + 3_000);
    const implementation = preview.getMockImplementation()!;
    preview.mockImplementation(message =>
      message.action === 'getTextPreviewBranchOptions'
        ? Promise.resolve({ success: false, error: 'text-preview-unavailable' })
        : implementation(message)
    );
    dispose = await initExportSurface(async () => base, preview);
    trusted(el('previewSelected'));
    await flush();
    expect(el('previewStatus').textContent).toContain('Waiting for branch choices');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(el('previewStatus').textContent).toContain('Waiting for branch choices');
    expect(preview.mock.calls.some(([m]) => m.action === 'getTextPreviewStatus')).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(el('previewStatus').textContent).toContain('Branch selection expired');
  });
});
