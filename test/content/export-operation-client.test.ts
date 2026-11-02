import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setChatGPTLocation, resetLocation } from '../fixtures/dom-helpers';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import type { ExportMode } from '../../src/lib/export-operation-contract';

const route = 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd';
let listener: (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  reply: (value: unknown) => void
) => unknown;
let finish: (() => void) | undefined;
let run: ReturnType<typeof vi.fn>;
let id: string;
let mode: ExportMode;
const worker = () => ({ id: chrome.runtime.id, url: chrome.runtime.getURL('service-worker.js') });
function command(message: object, sender = worker()): Promise<unknown> {
  return new Promise(resolve => {
    const result = listener(message, sender, resolve);
    if (result === false) resolve(undefined);
  });
}
beforeEach(async () => {
  vi.resetModules();
  setChatGPTLocation('01234567-89ab-4cde-8f01-23456789abcd');
  id = crypto.randomUUID();
  mode = 'selected';
  finish = undefined;
  vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation(value => {
    listener = value;
  });
  vi.mocked(chrome.runtime.sendMessage).mockImplementation((message, callback) => {
    const response =
      message.action === 'claimExportOperation'
        ? {
            success: true,
            exportOperationId: id,
            mode,
            expiresAt: Date.now() + 7_200_000,
            settings: { ...DEFAULT_SYNC_SETTINGS, isApiKeyConfigured: false },
          }
        : { success: true };
    callback?.(response);
    return Promise.resolve(response);
  });
  const { installExportOperationClient } =
    await import('../../src/content/export-operation-client');
  run = vi.fn(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      })
  );
  installExportOperationClient(run);
});
afterEach(async () => {
  finish?.();
  await new Promise(resolve => setTimeout(resolve, 0));
  resetLocation();
});
describe('claimed content client', () => {
  it('provider commands cannot invoke a run; trusted worker command claims once', async () => {
    const begin = { action: 'beginExportOperation', intentId: crypto.randomUUID(), route };
    await command(begin, {
      id: chrome.runtime.id,
      url: route,
      tab: { id: 7 },
    } as chrome.runtime.MessageSender);
    expect(run).not.toHaveBeenCalled();
    expect(await command(begin)).toEqual({ accepted: true });
    expect(run).toHaveBeenCalledExactlyOnceWith('selected');
    expect(await command(begin)).toEqual({ accepted: false });
  });
  it.each(['current', 'selected'] as const)(
    'reports a bounded terminal outcome when %s ends before a branch choice',
    async claimedMode => {
      mode = claimedMode;
      await command({ action: 'beginExportOperation', intentId: crypto.randomUUID(), route });
      finish!();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        {
          action: 'completeExportOperation',
          exportOperationId: id,
          outcome: mode === 'selected' ? 'branch-preparation-ended' : 'ended',
        },
        expect.any(Function)
      );
    }
  );
  it('retains branch options and resolves only an exact validated choice generation', async () => {
    await command({ action: 'beginExportOperation', intentId: crypto.randomUUID(), route });
    const client = await import('../../src/content/export-operation-client');
    const promise = client.selectExportBranch([
      { ordinal: 2, messageCount: 3, uniqueMessageCount: 1, isCurrent: false, preview: 'text' },
    ]);
    const sent = vi
      .mocked(chrome.runtime.sendMessage)
      .mock.calls.find(([message]) => message.action === 'awaitExportSelection')![0];
    const fields = { exportOperationId: id, selectionId: sent.selectionId };
    expect(await command({ action: 'validateExportChoice', ...fields, choice: 99 })).toEqual({
      accepted: false,
    });
    expect(await command({ action: 'validateExportChoice', ...fields, choice: 2 })).toEqual({
      accepted: true,
    });
    expect(await command({ action: 'applyExportChoice', ...fields, choice: 2 })).toEqual({
      accepted: true,
    });
    expect(await promise).toBe(2);
    expect(client.claimedContentExport()?.selected).toBe(true);
    expect(await command({ action: 'applyExportChoice', ...fields, choice: 'all' })).toEqual({
      accepted: false,
    });
    expect(document.body.textContent).not.toContain('text');
    finish!();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: 'completeExportOperation', exportOperationId: id, outcome: 'ended' },
      expect.any(Function)
    );
  });
  it('Stop resolves pending selection null and prevents further non-cleanup messages', async () => {
    await command({ action: 'beginExportOperation', intentId: crypto.randomUUID(), route });
    const client = await import('../../src/content/export-operation-client');
    const pending = client.selectExportBranch([
      { ordinal: 1, messageCount: 1, uniqueMessageCount: 1, isCurrent: true },
    ]);
    await command({ action: 'cancelExportOperation', exportOperationId: id });
    expect(await pending).toBeNull();
    const scope = await import('../../src/lib/export-operation-scope');
    expect(() => scope.withExportGeneration({ action: 'saveToOutputs' })).toThrow();
    expect(scope.withExportGeneration({ action: 'abortStagedArchiveArtifact' })).toMatchObject({
      exportOperationId: id,
    });
  });
  it('pins late cleanup to its original generation instead of borrowing a replacement scope', async () => {
    await command({ action: 'beginExportOperation', intentId: crypto.randomUUID(), route });
    const scope = await import('../../src/lib/export-operation-scope');
    const old = scope.captureExportScope()!;
    finish!();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(scope.captureExportScope()).toBeUndefined();
    const replacement = {
      id: crypto.randomUUID(),
      route,
      abort: new AbortController(),
      closed: false,
    };
    scope.installExportScope(replacement);
    expect(
      scope.withExportGeneration({ action: 'abortStagedArchiveArtifact' }, old).exportOperationId
    ).toBe(id);
    expect(() => scope.withExportGeneration({ action: 'saveToOutputs' }, old)).toThrow();
    scope.clearExportScope(replacement);
    expect(
      vi
        .mocked(chrome.runtime.sendMessage)
        .mock.calls.some(
          ([message]) =>
            message.action === 'completeExportOperation' && message.exportOperationId === id
        )
    ).toBe(true);
  });
  it('expiry resolves awaiting selection without a choice', async () => {
    vi.useFakeTimers();
    try {
      await command({ action: 'beginExportOperation', intentId: crypto.randomUUID(), route });
      const client = await import('../../src/content/export-operation-client');
      const choice = client.selectExportBranch([
        { ordinal: 1, messageCount: 1, uniqueMessageCount: 1, isCurrent: true },
      ]);
      await vi.advanceTimersByTimeAsync(7_200_001);
      expect(await choice).toBeNull();
      expect(client.claimedContentExport()?.scope.abort.signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
