import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { initExportSurface, trustedExportAction } from '../../src/popup/export';
import type { ExportControlMessage, ExportStatus } from '../../src/lib/export-operation-contract';
import messages from '../../src/_locales/en/messages.json';
let dispose: (() => void) | undefined;
const base: ExportStatus = {
  success: true,
  target: {
    tabId: 7,
    platform: 'chatgpt',
    title: '<img src=x>',
    route: 'https://chatgpt.com/c/synthetic',
  },
  outputs: ['file'],
};
beforeEach(() => {
  document.documentElement.innerHTML = fs.readFileSync('src/popup/index.html', 'utf8');
  vi.mocked(chrome.i18n.getMessage).mockImplementation((key, substitutions) => {
    const message = (messages as Record<string, { message: string }>)[key]?.message ?? key;
    const values = Array.isArray(substitutions) ? substitutions : [substitutions];
    return message.replace('$COUNT$', values[0] ?? '');
  });
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
function trustedButtonActions() {
  const handlers = new WeakMap<HTMLButtonElement, EventListener>();
  const addListener = EventTarget.prototype.addEventListener;
  vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (
    this: EventTarget,
    type,
    listener,
    options
  ) {
    if (this instanceof HTMLButtonElement && type === 'click' && typeof listener === 'function')
      handlers.set(this, listener);
    addListener.call(this, type, listener, options);
  });
  return (button: HTMLButtonElement) => {
    const handler = handlers.get(button);
    expect(handler).toBeDefined();
    handler!.call(button, { isTrusted: true } as Event);
  };
}

describe('extension-owned Export surface', () => {
  it('defaults to Export, presents bounded target/output text, and never starts on open', async () => {
    const request = vi.fn(async () => base);
    dispose = await initExportSurface(request);
    expect(document.getElementById('exportPanel')?.hidden).toBe(false);
    expect(document.getElementById('settingsPanel')?.hidden).toBe(true);
    expect(document.getElementById('exportTarget')?.textContent).toContain('<img src=x>');
    expect(document.querySelector('#exportTarget img')).toBeNull();
    expect(document.getElementById('exportOutputs')?.textContent).toContain('file');
    expect(request).toHaveBeenCalledExactlyOnceWith({ action: 'getExportStatus' });
    document.getElementById('settingsTab')?.click();
    expect(document.getElementById('settingsPanel')?.hidden).toBe(false);
    document.getElementById('exportCurrent')?.click();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('accepts only trusted action events', () => {
    const action = vi.fn();
    trustedExportAction({ isTrusted: false } as Event, action);
    expect(action).not.toHaveBeenCalled();
    trustedExportAction({ isTrusted: true } as Event, action);
    expect(action).toHaveBeenCalledOnce();
  });
  it('reopening a running generation shows Stop and disables duplicate starts', async () => {
    const request = vi.fn(async () => ({
      ...base,
      operation: { id: crypto.randomUUID(), mode: 'current' as const, phase: 'exporting' as const },
    }));
    dispose = await initExportSurface(request);
    expect((document.getElementById('exportCurrent') as HTMLButtonElement).disabled).toBe(true);
    expect(document.getElementById('exportStop')?.hidden).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('renders the retained no-choice result instead of claiming an export finished', async () => {
    dispose = await initExportSurface(async () => ({
      ...base,
      operation: {
        id: crypto.randomUUID(),
        mode: 'selected',
        phase: 'completed',
        outcome: 'branch-preparation-ended',
      },
    }));
    expect(document.getElementById('exportStatus')?.textContent).toBe(
      'Branch preparation ended without an export choice. Nothing was saved.'
    );
    expect(document.getElementById('exportStop')?.hidden).toBe(true);
    expect((document.getElementById('exportCurrent') as HTMLButtonElement).disabled).toBe(false);
  });
  it.each(['current', 'selected'] as const)(
    '%s completion uses neutral language rather than an output-success claim',
    async mode => {
      dispose = await initExportSurface(async () => ({
        ...base,
        operation: { id: crypto.randomUUID(), mode, phase: 'completed', outcome: 'ended' },
      }));
      expect(document.getElementById('exportStatus')?.textContent).toBe(
        'Operation ended. Check the conversation notification for export outcome details.'
      );
    }
  );
  it('keeps a cancelled operation visibly stopped', async () => {
    dispose = await initExportSurface(async () => ({
      ...base,
      operation: { id: crypto.randomUUID(), mode: 'selected', phase: 'cancelled' },
    }));
    expect(document.getElementById('exportStatus')?.textContent).toBe(
      'Stopped. Already saved outputs were retained.'
    );
  });
  it.each(['operation', 'selection'] as const)(
    'immediately retires old choices when the %s changes before new options arrive',
    async changed => {
      const clickTrusted = trustedButtonActions();
      let operation = {
        id: crypto.randomUUID(),
        mode: 'selected' as const,
        phase: 'awaiting-selection' as const,
        selectionId: crypto.randomUUID(),
      };
      const pending = deferred<ExportStatus>();
      let delayOptions = false;
      let pendingRequested = false;
      const option = {
        ordinal: 1,
        messageCount: 2,
        uniqueMessageCount: 1,
        isCurrent: true,
        preview: 'old choice',
      };
      const request = vi.fn(async (message: ExportControlMessage) => {
        if (message.action === 'getExportBranchOptions') {
          if (delayOptions) {
            pendingRequested = true;
            return pending.promise;
          }
          return { ...base, operation, options: [option] };
        }
        return { ...base, operation };
      });
      dispose = await initExportSurface(request);
      const oldButtons = Array.from(
        document.querySelectorAll<HTMLButtonElement>('#exportBranches button')
      );
      expect(oldButtons).toHaveLength(2);
      operation = {
        ...operation,
        ...(changed === 'operation'
          ? { id: crypto.randomUUID() }
          : { selectionId: crypto.randomUUID() }),
      };
      delayOptions = true;
      document.getElementById('exportTab')!.click();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(pendingRequested).toBe(true);
      expect(document.querySelectorAll('#exportBranches button')).toHaveLength(0);
      for (const button of oldButtons) {
        expect(button.disabled).toBe(true);
        // A retained listener must also reject stale input, independently of DOM removal.
        clickTrusted(button);
      }
      expect(request.mock.calls.some(([message]) => message.action === 'chooseExportBranch')).toBe(
        false
      );
      pending.resolve({
        ...base,
        operation,
        options: [{ ...option, preview: 'new choice' }],
      });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(document.getElementById('exportBranches')?.textContent).toContain('new choice');
      for (const button of oldButtons) clickTrusted(button);
      expect(request.mock.calls.some(([message]) => message.action === 'chooseExportBranch')).toBe(
        false
      );
      clickTrusted(document.querySelector<HTMLButtonElement>('#exportBranches button')!);
      expect(request).toHaveBeenCalledWith({
        action: 'chooseExportBranch',
        exportOperationId: operation.id,
        selectionId: operation.selectionId,
        choice: 1,
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  );
  it('ignores a late old-operation options response even when the selection ID is reused', async () => {
    const oldOperation = {
      id: crypto.randomUUID(),
      mode: 'selected' as const,
      phase: 'awaiting-selection' as const,
      selectionId: crypto.randomUUID(),
    };
    let operation = oldOperation;
    const oldOptions = deferred<ExportStatus>();
    let firstOptions = true;
    const option = {
      ordinal: 1,
      messageCount: 2,
      uniqueMessageCount: 1,
      isCurrent: true,
    };
    const request = vi.fn(async (message: ExportControlMessage) => {
      if (message.action === 'getExportBranchOptions') {
        if (firstOptions) {
          firstOptions = false;
          return oldOptions.promise;
        }
        return { ...base, operation, options: [{ ...option, preview: 'new operation' }] };
      }
      return { ...base, operation };
    });
    const initialized = initExportSurface(request);
    await new Promise(resolve => setTimeout(resolve, 0));
    operation = { ...oldOperation, id: crypto.randomUUID() };
    document.getElementById('exportTab')!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.getElementById('exportBranches')?.textContent).toContain('new operation');
    oldOptions.resolve({
      ...base,
      operation: oldOperation,
      options: [{ ...option, preview: 'late old operation' }],
    });
    dispose = await initialized;
    expect(document.getElementById('exportBranches')?.textContent).toContain('new operation');
    expect(document.getElementById('exportBranches')?.textContent).not.toContain(
      'late old operation'
    );
  });
  it.each([1, 'all'] as const)(
    'binds normal choice %s to the rendered response identity',
    async choice => {
      const clickTrusted = trustedButtonActions();
      const operation = {
        id: crypto.randomUUID(),
        mode: 'selected' as const,
        phase: 'awaiting-selection' as const,
        selectionId: crypto.randomUUID(),
      };
      const request = vi.fn(async () => ({
        ...base,
        operation,
        options: [{ ordinal: 1, messageCount: 2, uniqueMessageCount: 1, isCurrent: true }],
      }));
      dispose = await initExportSurface(request);
      const buttons = document.querySelectorAll<HTMLButtonElement>('#exportBranches button');
      clickTrusted(buttons[choice === 'all' ? 1 : 0]);
      expect(request).toHaveBeenCalledWith({
        action: 'chooseExportBranch',
        exportOperationId: operation.id,
        selectionId: operation.selectionId,
        choice,
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  );
  it('renders branch descriptors as text, with explicit all-branches action', async () => {
    const operation = {
      id: crypto.randomUUID(),
      mode: 'selected' as const,
      phase: 'awaiting-selection' as const,
      selectionId: crypto.randomUUID(),
    };
    const request = vi.fn(async message => ({
      ...base,
      operation,
      ...(message.action === 'getExportBranchOptions'
        ? {
            options: [
              {
                ordinal: 1,
                messageCount: 2,
                uniqueMessageCount: 1,
                isCurrent: true,
                preview: '<script>no execution</script>',
              },
            ],
          }
        : {}),
    }));
    dispose = await initExportSurface(request);
    expect(document.querySelector('#exportBranches script')).toBeNull();
    expect(document.getElementById('exportBranches')?.textContent).toContain('<script>');
    expect(document.querySelectorAll('#exportBranches button')).toHaveLength(2);
  });
});
