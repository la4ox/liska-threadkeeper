import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveTextPreview } from '../../src/archive/presentation';
import { resetLocation, setChatGPTLocation } from '../fixtures/dom-helpers';

const route = 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd';
let listener: (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  reply: (value: unknown) => void
) => unknown;
let finish: ((published: boolean) => void) | undefined;
let run: ReturnType<typeof vi.fn>;
let id: string;

const worker = () => ({ id: chrome.runtime.id, url: chrome.runtime.getURL('service-worker.js') });
const begin = () =>
  command({ action: 'beginTextPreviewCapture', sessionId: id, route, branchMode: 'selected' });
const options = () => [{ ordinal: 2, messageCount: 3, uniqueMessageCount: 2, isCurrent: false }];
const payload = (): ArchiveTextPreview => ({
  schema: 'liska-text-preview/1',
  sourceCanonicalSha256: 'a'.repeat(64),
  branchTargetNodeId: 'assistant-1',
  title: 'Detached',
  profile: { schema: 'liska-reading-profile/1', includeToolContent: false },
  rows: [{ nodeId: 'assistant-1', role: 'assistant', presentedText: 'Answer' }],
});
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
  finish = undefined;
  vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation(value => {
    listener = value;
  });
  vi.mocked(chrome.runtime.sendMessage).mockImplementation((message, callback) => {
    const response =
      message.action === 'claimTextPreviewCapture'
        ? {
            success: true,
            sessionId: id,
            branchMode: 'selected',
            expiresAt: Date.now() + 300_000,
            settings: {
              enableAutoScroll: true,
              enableToolContent: false,
              enableChatGptOpaqueReplay: true,
            },
          }
        : message.action === 'checkTextPreviewCaptureLease'
          ? { success: true, live: true, expiresAt: Date.now() + 300_000 }
          : { success: true };
    callback?.(response);
    return Promise.resolve(response);
  });
  const { installTextPreviewClient } = await import('../../src/content/text-preview-client');
  run = vi.fn(
    () =>
      new Promise<boolean>(resolve => {
        finish = resolve;
      })
  );
  installTextPreviewClient(run);
});

afterEach(async () => {
  vi.useRealTimers();
  finish?.(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  vi.restoreAllMocks();
  resetLocation();
});

describe('text preview content client', () => {
  it('claims only a trusted worker start and passes exactly three capture booleans', async () => {
    const begin = {
      action: 'beginTextPreviewCapture',
      sessionId: id,
      route,
      branchMode: 'selected',
    };
    await command(begin, {
      id: chrome.runtime.id,
      url: route,
      tab: { id: 7 },
    } as chrome.runtime.MessageSender);
    expect(run).not.toHaveBeenCalled();
    expect(await command(begin)).toEqual({ accepted: true });
    expect(run).toHaveBeenCalledWith('selected', {
      enableAutoScroll: true,
      enableToolContent: false,
      enableChatGptOpaqueReplay: true,
    });
    expect(JSON.stringify(run.mock.calls[0][1])).not.toContain('obsidian');
    expect(await command(begin)).toEqual({ accepted: false });
  });

  it('refuses claim responses containing output or credential facts', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((message, callback) => {
      const response = {
        success: true,
        sessionId: id,
        branchMode: 'selected',
        expiresAt: Date.now() + 300_000,
        settings: {
          enableAutoScroll: true,
          enableToolContent: false,
          enableChatGptOpaqueReplay: true,
          isApiKeyConfigured: true,
        },
      };
      callback?.(response);
      return Promise.resolve(response);
    });
    await expect(
      command({ action: 'beginTextPreviewCapture', sessionId: id, route, branchMode: 'selected' })
    ).resolves.toEqual({ accepted: false });
    expect(run).not.toHaveBeenCalled();
  });

  it('resolves only an exact ordinal and never admits the all-branches value', async () => {
    await command({
      action: 'beginTextPreviewCapture',
      sessionId: id,
      route,
      branchMode: 'selected',
    });
    const client = await import('../../src/content/text-preview-client');
    const choice = client.selectTextPreviewBranch([
      { ordinal: 2, messageCount: 3, uniqueMessageCount: 2, isCurrent: false },
    ]);
    const sent = vi
      .mocked(chrome.runtime.sendMessage)
      .mock.calls.find(([message]) => message.action === 'awaitTextPreviewSelection')![0];
    const fields = { sessionId: id, selectionId: sent.selectionId };
    expect(
      await command({ action: 'validateTextPreviewChoice', ...fields, choice: 'all' })
    ).toEqual({
      accepted: false,
    });
    expect(await command({ action: 'validateTextPreviewChoice', ...fields, choice: 2 })).toEqual({
      accepted: true,
    });
    expect(await command({ action: 'applyTextPreviewChoice', ...fields, choice: 2 })).toEqual({
      accepted: true,
    });
    await expect(choice).resolves.toBe(2);
  });

  it('injects preview authority only into capture messages and permits exact cleanup after stop', async () => {
    await command({
      action: 'beginTextPreviewCapture',
      sessionId: id,
      route,
      branchMode: 'selected',
    });
    const scope = await import('../../src/lib/export-operation-scope');
    expect(scope.prepareRuntimeMessage({ action: 'captureChatGptConversation' })).toMatchObject({
      textPreviewCaptureId: id,
    });
    await command({ action: 'cancelTextPreviewCapture', sessionId: id });
    expect(() => scope.prepareRuntimeMessage({ action: 'captureChatGptConversation' })).toThrow();
    expect(scope.prepareRuntimeMessage({ action: 'abortStagedArchiveArtifact' })).toMatchObject({
      textPreviewCaptureId: id,
    });
  });

  it('publishes through control without keeping the source run alive and invalidates failures', async () => {
    await command({
      action: 'beginTextPreviewCapture',
      sessionId: id,
      route,
      branchMode: 'selected',
    });
    finish!(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: 'invalidateTextPreview', sessionId: id, reason: 'stop' },
      expect.any(Function)
    );
    expect(
      (await import('../../src/content/text-preview-client')).claimedTextPreviewCapture()
    ).toBeUndefined();
  });

  it('does not issue control requests without a capture and installs its listener once', async () => {
    const client = await import('../../src/content/text-preview-client');
    client.installTextPreviewClient(run);
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledOnce();
    await expect(client.checkTextPreviewCaptureLease()).resolves.toBe(false);
    await expect(client.publishTextPreview(payload())).resolves.toBe(false);
    await expect(client.selectTextPreviewBranch(options())).resolves.toBeNull();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('checks the exact live lease and publishes a detached payload through control', async () => {
    await begin();
    const client = await import('../../src/content/text-preview-client');
    await expect(client.checkTextPreviewCaptureLease()).resolves.toBe(true);
    const detached = payload();
    await expect(client.publishTextPreview(detached)).resolves.toBe(true);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: 'publishTextPreview', sessionId: id, payload: detached },
      expect.any(Function)
    );
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((_message, callback) => {
      callback?.({ success: true, live: false });
      return Promise.resolve();
    });
    await expect(client.checkTextPreviewCaptureLease()).resolves.toBe(false);
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((_message, callback) => {
      callback?.({ success: false });
      return Promise.resolve();
    });
    await expect(client.publishTextPreview(detached)).resolves.toBe(false);
  });

  it('fails lease, publication, and branch selection closed on a disconnected worker', async () => {
    await begin();
    const client = await import('../../src/content/text-preview-client');
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((_message, callback) => {
      Object.assign(chrome.runtime, { lastError: { message: 'Receiving end does not exist' } });
      callback?.(undefined);
      Object.assign(chrome.runtime, { lastError: undefined });
      return Promise.resolve();
    });
    await expect(client.checkTextPreviewCaptureLease()).resolves.toBe(false);
    await expect(client.publishTextPreview(payload())).resolves.toBe(false);
    await expect(client.selectTextPreviewBranch(options())).resolves.toBeNull();
    expect(client.claimedTextPreviewCapture()).toBeDefined();
  });

  it('rejects an oversized publication before messaging and settles rejected selection control', async () => {
    await begin();
    const client = await import('../../src/content/text-preview-client');
    const { TEXT_PREVIEW_MAX_ENVELOPE_BYTES } = await import('../../src/lib/text-preview-contract');
    const tooLarge = {
      ...payload(),
      rows: [{ ...payload().rows[0], presentedText: 'x'.repeat(TEXT_PREVIEW_MAX_ENVELOPE_BYTES) }],
    };
    const callsBefore = vi.mocked(chrome.runtime.sendMessage).mock.calls.length;
    await expect(client.publishTextPreview(tooLarge)).resolves.toBe(false);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(callsBefore);
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((_message, callback) => {
      callback?.({ success: false });
      return Promise.resolve();
    });
    await expect(client.selectTextPreviewBranch(options())).resolves.toBeNull();
  });

  it.each([
    ['wrong session', { sessionId: '22222222-2222-4222-8222-222222222222' }],
    ['wrong mode', { branchMode: 'current' }],
    ['invalid deadline', { expiresAt: Number.NaN }],
    ['invalid settings', { settings: null }],
    ['non-object claim', null],
  ])('does not start a run for a %s claim', async (_label, overrides) => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((_message, callback) => {
      const claim = overrides && {
        success: true,
        sessionId: id,
        branchMode: 'selected',
        expiresAt: Date.now() + 300_000,
        settings: {
          enableAutoScroll: true,
          enableToolContent: false,
          enableChatGptOpaqueReplay: true,
        },
        ...overrides,
      };
      callback?.(claim);
      return Promise.resolve(claim);
    });
    await expect(begin()).resolves.toEqual({ accepted: false });
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects a concurrent start while claiming and a claim completed after navigation', async () => {
    let respond!: (value: unknown) => void;
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((_message, callback) => {
      respond = callback!;
      return Promise.resolve();
    });
    const starting = begin();
    await expect(begin()).resolves.toEqual({ accepted: false });
    setChatGPTLocation('different-thread');
    respond({
      success: true,
      sessionId: id,
      branchMode: 'selected',
      expiresAt: Date.now() + 300_000,
      settings: {
        enableAutoScroll: true,
        enableToolContent: false,
        enableChatGptOpaqueReplay: true,
      },
    });
    await expect(starting).resolves.toEqual({ accepted: false });
    expect(run).not.toHaveBeenCalled();
  });

  it('recovers the claim lock after a worker control error', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((_message, callback) => {
      Object.assign(chrome.runtime, { lastError: { message: 'Disconnected' } });
      callback?.(undefined);
      Object.assign(chrome.runtime, { lastError: undefined });
      return Promise.resolve();
    });
    await expect(begin()).resolves.toEqual({ accepted: false });
    await expect(begin()).resolves.toEqual({ accepted: true });
    expect(run).toHaveBeenCalledOnce();
  });

  it('rejects commands for another session or route, then cancels the exact pending selection', async () => {
    const client = await import('../../src/content/text-preview-client');
    await expect(command({ action: 'cancelTextPreviewCapture', sessionId: id })).resolves.toEqual({
      accepted: false,
    });
    await begin();
    const selected = client.selectTextPreviewBranch(options());
    const sent = vi.mocked(chrome.runtime.sendMessage).mock.calls.at(-1)![0];
    const choice = {
      action: 'applyTextPreviewChoice',
      sessionId: id,
      selectionId: sent.selectionId,
      choice: 2,
    };
    await expect(command({ ...choice, sessionId: crypto.randomUUID() })).resolves.toEqual({
      accepted: false,
    });
    setChatGPTLocation('different-thread');
    await expect(command(choice)).resolves.toEqual({ accepted: false });
    await expect(command({ action: 'cancelTextPreviewCapture', sessionId: id })).resolves.toEqual({
      accepted: true,
    });
    await expect(selected).resolves.toBeNull();
    await expect(command(choice)).resolves.toEqual({ accepted: false });
    await expect(client.checkTextPreviewCaptureLease()).resolves.toBe(false);
    await expect(client.publishTextPreview(payload())).resolves.toBe(false);
    await expect(client.selectTextPreviewBranch(options())).resolves.toBeNull();
  });

  it('aborts the capture and settles selection at the absolute claim deadline', async () => {
    vi.useFakeTimers();
    await begin();
    const client = await import('../../src/content/text-preview-client');
    const selected = client.selectTextPreviewBranch(options());
    await vi.advanceTimersByTimeAsync(300_000);
    await expect(selected).resolves.toBeNull();
    expect(client.claimedTextPreviewCapture()?.scope.abort.signal.aborted).toBe(true);
    await expect(client.publishTextPreview(payload())).resolves.toBe(false);
    finish!(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.claimedTextPreviewCapture()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('invalidates a rejected run and releases its scope even when invalidation is disconnected', async () => {
    run.mockRejectedValueOnce(new Error('capture unavailable'));
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((message, callback) => {
      if (message.action === 'claimTextPreviewCapture') {
        const claim = {
          success: true,
          sessionId: id,
          branchMode: 'selected',
          expiresAt: Date.now() + 300_000,
          settings: {
            enableAutoScroll: true,
            enableToolContent: false,
            enableChatGptOpaqueReplay: true,
          },
        };
        callback?.(claim);
        return Promise.resolve(claim);
      }
      Object.assign(chrome.runtime, { lastError: { message: 'Disconnected' } });
      callback?.(undefined);
      Object.assign(chrome.runtime, { lastError: undefined });
      return Promise.resolve();
    });
    await expect(begin()).resolves.toEqual({ accepted: true });
    await vi.waitFor(async () => {
      const client = await import('../../src/content/text-preview-client');
      expect(client.claimedTextPreviewCapture()).toBeUndefined();
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: 'invalidateTextPreview', sessionId: id, reason: 'stop' },
      expect.any(Function)
    );
    const scope = await import('../../src/lib/export-operation-scope');
    expect(
      scope.prepareRuntimeMessage({ action: 'captureChatGptConversation' })
    ).not.toHaveProperty('textPreviewCaptureId');
  });

  it('releases an unpublished run even if its stop notification cannot reach the worker', async () => {
    await begin();
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce((_message, callback) => {
      Object.assign(chrome.runtime, { lastError: { message: 'Disconnected' } });
      callback?.(undefined);
      Object.assign(chrome.runtime, { lastError: undefined });
      return Promise.resolve();
    });
    finish!(false);
    await vi.waitFor(async () => {
      const client = await import('../../src/content/text-preview-client');
      expect(client.claimedTextPreviewCapture()).toBeUndefined();
    });
    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith(
      { action: 'invalidateTextPreview', sessionId: id, reason: 'stop' },
      expect.any(Function)
    );
  });

  it('ignores unrelated worker commands without replying or starting a run', () => {
    const reply = vi.fn();
    expect(listener({ action: 'unrelatedCommand' }, worker(), reply)).toBe(false);
    expect(reply).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});
