import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { ExportOperationController } from '../../src/background/export-operation-controller';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import {
  EXPORT_DURABLE_ACTIONS,
  EXPORT_PREPARATION_ACTIONS,
  EXPORT_STATE_KEY,
  EXPORT_OPERATION_MS,
  EXPORT_PENDING_MS,
  boundedBranchOptions,
  type ExportClaim,
} from '../../src/lib/export-operation-contract';

const route = 'https://chatgpt.com/c/01234567-89ab-4cde-8f01-23456789abcd';
const extensionId = 'test-extension-id';
const url = (path: string) => `chrome-extension://${extensionId}/${path}`;
const toolbar = { id: extensionId, url: url('src/popup/index.html') };
const source = () =>
  ({
    id: extensionId,
    tab: { id: 7, windowId: 3, url: route },
    frameId: 0,
    documentId: 'document-one',
    url: route,
  }) as chrome.runtime.MessageSender;

function fixture() {
  let clock = 1_000;
  let stored: Record<string, unknown> = {};
  let settings = {
    ...structuredClone(DEFAULT_SYNC_SETTINGS),
    obsidianApiKey: 'synthetic',
    outputOptions: { file: true, obsidian: false, clipboard: false },
  };
  const tab = { id: 7, windowId: 3, url: route, title: 'Synthetic target' };
  const readSettings = vi.fn(async () => settings);
  let latestClaim: ExportClaim | undefined;
  let controller: ExportOperationController;
  const api = {
    runtime: { id: extensionId, getURL: url },
    storage: {
      session: {
        get: vi.fn(async () => structuredClone(stored)),
        set: vi.fn(async (record: Record<string, unknown>) => {
          stored = structuredClone(record);
        }),
        remove: vi.fn(async () => {
          stored = {};
        }),
      },
    },
    action: { openPopup: vi.fn(async () => undefined) },
    windows: {
      create: vi.fn(async (_options: chrome.windows.CreateData) => ({ id: 9, tabs: [{ id: 10 }] })),
      update: vi.fn(async () => ({})),
    },
    tabs: {
      get: vi.fn(async (_tabId: number) => ({ ...tab })),
      query: vi.fn(async () => [{ ...tab }]),
      sendMessage: vi.fn(async (_id: number, message: Record<string, unknown>) => {
        if (message.action === 'beginExportOperation') {
          latestClaim = (await controller.handle(
            { action: 'claimExportOperation', intentId: message.intentId as string, route },
            source()
          )) as ExportClaim;
          return { accepted: latestClaim.success };
        }
        if (message.action === 'readExportBranchOptions')
          return {
            options: [
              {
                ordinal: 1,
                messageCount: 2,
                uniqueMessageCount: 1,
                isCurrent: true,
                preview: '<img src=x>',
              },
            ],
          };
        return { accepted: true };
      }),
    },
  };
  const restart = () => {
    controller = new ExportOperationController({
      chrome: api as unknown as typeof chrome,
      settings: readSettings,
      now: () => clock,
    });
    return controller;
  };
  restart();
  return {
    api,
    tab,
    readSettings,
    get controller() {
      return controller;
    },
    get claim() {
      return latestClaim!;
    },
    get stored() {
      return stored;
    },
    set stored(value) {
      stored = value;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    restart,
    settings: (update: Partial<typeof settings>) => {
      settings = { ...settings, ...update };
    },
    complete: () =>
      controller.handle(
        {
          action: 'completeExportOperation',
          exportOperationId: latestClaim!.exportOperationId!,
          outcome: 'ended',
        },
        source()
      ),
    start: async (mode: 'current' | 'selected' = 'current') =>
      controller.handle(
        {
          action: 'startExportOperation',
          mode,
          expectedTarget: { tabId: 7, route },
          expectedOutputs: ['file'],
        },
        toolbar
      ),
    authorize: (action: string, extra = {}, sender = source()) =>
      controller.authorize(
        {
          action,
          exportOperationId: latestClaim?.exportOperationId,
          ...(action === 'saveToOutputs' ? { data: { frontmatter: { source: 'chatgpt' } } } : {}),
          ...extra,
        },
        sender
      ),
  };
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
});

function tabSender(tabId: number): chrome.runtime.MessageSender {
  return { ...source(), tab: { ...source().tab!, id: tabId }, documentId: `document-${tabId}` };
}

function surfaceSender(f: ReturnType<typeof fixture>, index = 0): chrome.runtime.MessageSender {
  const page = f.api.windows.create.mock.calls[index][0] as { url: string };
  return {
    id: extensionId,
    url: page.url,
    frameId: 0,
    tab: { id: 10, windowId: 9 },
  } as chrome.runtime.MessageSender;
}

function delayClaims(f: ReturnType<typeof fixture>) {
  let selectedTabId = 7;
  const pending = new Map<
    number,
    { intentId: string; finish: (value: { accepted: boolean }) => void }
  >();
  f.api.tabs.get.mockImplementation(async (tabId: number) => ({ ...f.tab, id: tabId }));
  f.api.tabs.query.mockImplementation(async () => [{ ...f.tab, id: selectedTabId }]);
  f.api.tabs.sendMessage.mockImplementation((tabId, message) => {
    if (message.action !== 'beginExportOperation') return Promise.resolve({ accepted: true });
    return new Promise(resolve => {
      pending.set(tabId, { intentId: message.intentId as string, finish: resolve });
    });
  });
  return {
    pending,
    start(tabId: number) {
      selectedTabId = tabId;
      return f.controller.handle(
        {
          action: 'startExportOperation',
          mode: 'current',
          expectedTarget: { tabId, route },
          expectedOutputs: ['file'],
        },
        toolbar
      );
    },
    async claim(tabId: number) {
      const wait = pending.get(tabId)!;
      const claim = (await f.controller.handle(
        { action: 'claimExportOperation', intentId: wait.intentId, route },
        tabSender(tabId)
      )) as ExportClaim;
      wait.finish({ accepted: claim.success });
      return claim;
    },
  };
}

function seedPendingIntents(f: ReturnType<typeof fixture>, tabIds: number[]) {
  const state = structuredClone(f.stored[EXPORT_STATE_KEY]) as {
    operations: Array<{
      id: string;
      target: { tabId: number };
      mode: 'current' | 'selected';
      snapshot: string;
      keyHash: string;
      stages: string[];
    }>;
    intents: Array<{
      id: string;
      target: { tabId: number };
      mode: 'current' | 'selected';
      snapshot: string;
      keyHash: string;
      expires: number;
      uiSessionId?: string;
    }>;
  };
  const template = state.operations[0];
  state.intents = tabIds.map(tabId => ({
    id: crypto.randomUUID(),
    target: { ...template.target, tabId },
    mode: template.mode,
    snapshot: template.snapshot,
    keyHash: template.keyHash,
    expires: 1_000 + EXPORT_PENDING_MS,
  }));
  f.stored = { ...f.stored, [EXPORT_STATE_KEY]: state };
  f.api.tabs.get.mockImplementation(async (tabId: number) => ({ ...f.tab, id: tabId }));
  return state.intents;
}

describe('worker-owned export generations', () => {
  it('denies untrusted status reads and honestly reports a missing supported toolbar target', async () => {
    const f = fixture();
    expect(await f.controller.handle({ action: 'getExportStatus' }, source())).toMatchObject({
      success: false,
    });
    f.api.tabs.query.mockResolvedValueOnce([{ ...f.tab, url: 'https://example.com/' }]);
    f.api.tabs.query.mockResolvedValueOnce([]);
    for (let attempt = 0; attempt < 2; attempt++)
      expect(await f.controller.handle({ action: 'getExportStatus' }, toolbar)).toEqual({
        success: true,
        error: 'Open a supported conversation tab first.',
      });
    expect(f.readSettings).not.toHaveBeenCalled();
    expect(f.api.storage.session.set).not.toHaveBeenCalled();
  });
  it('denies invalid start modes and unknown operation controls without dispatching or persisting', async () => {
    const f = fixture();
    expect(
      await f.controller.handle(
        {
          action: 'startExportOperation',
          mode: 'everything',
          expectedTarget: { tabId: 7, route },
          expectedOutputs: ['file'],
        } as never,
        toolbar
      )
    ).toMatchObject({ success: false });
    expect(
      await f.controller.handle(
        { action: 'cancelExportOperation', exportOperationId: crypto.randomUUID() },
        toolbar
      )
    ).toMatchObject({ success: false });
    expect(f.api.tabs.sendMessage).not.toHaveBeenCalled();
    expect(f.api.storage.session.set).not.toHaveBeenCalled();
  });
  it('denies an explicit mismatched action source without revoking the valid generation', async () => {
    const f = fixture();
    await f.start();
    expect(await f.authorize('saveToOutputs', { source: 'claude', outputs: ['file'] })).toBe(false);
    expect(await f.authorize('saveToOutputs', { source: 'chatgpt', outputs: ['file'] })).toBe(true);
  });
  it('ignores irrelevant tab changes without persisting or cancelling the live generation', async () => {
    const f = fixture();
    await f.start();
    f.api.storage.session.set.mockClear();
    f.api.tabs.sendMessage.mockClear();
    await f.controller.tabChanged(7, {});
    expect(f.api.storage.session.set).not.toHaveBeenCalled();
    expect(f.api.tabs.sendMessage).not.toHaveBeenCalled();
    expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(true);
  });
  it('keeps a rejected branch choice awaiting selection without admitting durable work', async () => {
    const f = fixture();
    await f.start('selected');
    const selectionId = crypto.randomUUID();
    await f.controller.handle(
      {
        action: 'awaitExportSelection',
        exportOperationId: f.claim.exportOperationId!,
        selectionId,
      },
      source()
    );
    f.api.tabs.sendMessage.mockResolvedValueOnce({ accepted: false });
    expect(
      await f.controller.handle(
        {
          action: 'chooseExportBranch',
          exportOperationId: f.claim.exportOperationId!,
          selectionId,
          choice: 1,
        },
        toolbar
      )
    ).toMatchObject({ success: false });
    expect(await f.controller.handle({ action: 'getExportStatus' }, toolbar)).toMatchObject({
      operation: { phase: 'awaiting-selection', selectionId },
    });
    expect(
      f.api.tabs.sendMessage.mock.calls.some(call => call[1].action === 'applyExportChoice')
    ).toBe(false);
    expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(false);
    expect(await f.authorize('captureChatGptConversation')).toBe(true);
  });
  it('recognizes exact UI candidates without granting an unregistered fallback surface authority', async () => {
    const f = fixture();
    const candidate = {
      id: extensionId,
      url: url(`src/popup/index.html?surface=${crypto.randomUUID()}`),
      frameId: 0,
      tab: { id: 10, windowId: 9 },
    } as chrome.runtime.MessageSender;
    expect(f.controller.isUiCandidate(toolbar)).toBe(true);
    expect(f.controller.isUiCandidate(candidate)).toBe(true);
    expect(await f.controller.isUi(candidate)).toBe(false);
    for (const patch of [
      { id: 'foreign-extension' },
      { url: undefined },
      { url: url('src/popup/index.html?surface=invalid') },
      { url: candidate.url + '&extra=1' },
    ])
      expect(f.controller.isUiCandidate({ ...candidate, ...patch })).toBe(false);
  });
  it('reserves a binary stage durably and refuses another generation claiming the same ID', async () => {
    const f = fixture();
    await f.start();
    const first = f.claim.exportOperationId!;
    const request = { source: 'chatgpt', stageId: 'binary-stage' };
    expect(await f.authorize('beginStagedBinaryAsset', request)).toBe(true);
    f.restart();
    expect(await f.authorize('abortStagedBinaryAsset', request)).toBe(true);
    await f.complete();
    await f.start();
    expect(await f.authorize('beginStagedBinaryAsset', request)).toBe(false);
    expect(await f.authorize('abortStagedBinaryAsset', request)).toBe(false);
    expect(
      await f.authorize('abortStagedBinaryAsset', { ...request, exportOperationId: first })
    ).toBe(true);
    expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(true);
  });
  it('ignores failed, missing, overlong and duplicate stage results without changing ownership', async () => {
    const f = fixture();
    await f.start();
    const id = f.claim.exportOperationId!;
    await f.controller.recordResult(id, { success: true, stageId: 'owned-stage' });
    for (const result of [
      undefined,
      { success: false, stageId: 'unaccepted-stage' },
      { success: true, data: {} },
      { success: true, stageId: 'x'.repeat(257) },
      { success: true, stageId: 'owned-stage' },
    ])
      await f.controller.recordResult(id, result);
    await f.controller.recordResult(crypto.randomUUID(), {
      success: true,
      stageId: 'foreign-stage',
    });
    expect(f.stored[EXPORT_STATE_KEY]).toMatchObject({
      operations: [{ id, stages: ['owned-stage'] }],
    });
    expect(await f.authorize('abortStagedBinaryAsset', { stageId: 'owned-stage' })).toBe(true);
  });
  it('fails closed when persisted operations repeat a generation ID', async () => {
    const f = fixture();
    await f.start();
    await f.controller.recordResult(f.claim.exportOperationId, {
      success: true,
      stageId: 'owned-stage',
    });
    const state = f.stored[EXPORT_STATE_KEY] as { operations: unknown[] };
    state.operations.push(structuredClone(state.operations[0]));
    f.restart();
    expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(false);
    expect(await f.authorize('abortStagedBinaryAsset', { stageId: 'owned-stage' })).toBe(false);
    expect(await f.controller.handle({ action: 'getExportStatus' }, toolbar)).not.toHaveProperty(
      'operation'
    );
    expect(await f.start()).toMatchObject({ operation: { phase: 'exporting' } });
    expect((f.stored[EXPORT_STATE_KEY] as { operations: unknown[] }).operations).toHaveLength(1);
  });
  it.each([
    { id: 'foreign-extension' },
    { frameId: 1 },
    { documentId: undefined },
    { documentId: 'invalid document' },
    { tab: undefined },
  ])('rejects an invalid content launcher sender %j', async patch => {
    const f = fixture();
    expect(
      await f.controller.handle({ action: 'openExportSurface' }, { ...source(), ...patch })
    ).toMatchObject({ success: false });
    expect(f.api.action.openPopup).not.toHaveBeenCalled();
    expect(f.api.windows.create).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'expire'] as const)(
    'revokes authority even when the %s notification rejects',
    async event => {
      const f = fixture();
      await f.start('selected');
      f.api.tabs.sendMessage.mockRejectedValue(new Error('Document disconnected'));
      if (event === 'expire') f.advance(EXPORT_OPERATION_MS + 1);
      else
        expect(
          await f.controller.handle(
            { action: 'cancelExportOperation', exportOperationId: f.claim.exportOperationId! },
            toolbar
          )
        ).toMatchObject({ success: true });
      expect(await f.authorize('captureChatGptConversation')).toBe(false);
      expect(await f.controller.handle({ action: 'getExportStatus' }, toolbar)).toMatchObject({
        operation: { phase: 'cancelled' },
      });
      expect(f.api.tabs.sendMessage).toHaveBeenLastCalledWith(
        7,
        { action: 'cancelExportOperation', exportOperationId: f.claim.exportOperationId },
        { documentId: 'document-one', frameId: 0 }
      );
    }
  );
  it('relinquishes local cleanup ownership even if both metadata save and removal fail', async () => {
    const f = fixture();
    await f.start();
    await f.controller.recordResult(f.claim.exportOperationId, {
      success: true,
      stageId: 'owned-stage',
    });
    const request = {
      exportOperationId: f.claim.exportOperationId,
      source: 'chatgpt',
      stageId: 'owned-stage',
    };
    f.api.storage.session.set.mockRejectedValueOnce(new Error('Session unavailable'));
    f.api.storage.session.remove.mockRejectedValueOnce(new Error('Removal unavailable'));
    expect(await f.controller.takeStageForCleanup(request, source())).toBe(true);
    expect(f.api.storage.session.remove).toHaveBeenCalledWith(EXPORT_STATE_KEY);
    expect(await f.controller.takeStageForCleanup(request, source())).toBe(false);
    expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(false);
  });
  it('replaces an existing fallback surface when its window can no longer be focused', async () => {
    const f = fixture();
    f.api.action.openPopup.mockRejectedValue(new Error('Popup unavailable'));
    await f.controller.handle({ action: 'openExportSurface' }, source());
    const oldUi = surfaceSender(f);
    expect(await f.controller.isUi(oldUi)).toBe(true);
    f.api.windows.update.mockRejectedValueOnce(new Error('Window closed'));
    await f.controller.handle({ action: 'openExportSurface' }, source());
    const newUi = surfaceSender(f, 1);
    expect(newUi.url).not.toBe(oldUi.url);
    expect(f.api.windows.update).toHaveBeenCalledWith(9, { focused: true });
    expect(f.api.windows.create).toHaveBeenCalledTimes(2);
    expect(await f.controller.isUi(oldUi)).toBe(false);
    expect(await f.controller.isUi(newUi)).toBe(true);
    expect((f.stored[EXPORT_STATE_KEY] as { surfaces: unknown[] }).surfaces).toHaveLength(1);
  });
  it.each([{ tabs: [{ id: 10 }] }, { id: 9, tabs: [] }])(
    'cancels selected preparation when the fallback window is malformed: %j',
    async window => {
      const f = fixture();
      await f.start('selected');
      f.api.windows.create.mockResolvedValueOnce(window as never);
      expect(
        await f.controller.handle(
          {
            action: 'awaitExportSelection',
            exportOperationId: f.claim.exportOperationId!,
            selectionId: crypto.randomUUID(),
          },
          source()
        )
      ).toMatchObject({ success: false });
      expect(await f.authorize('captureChatGptConversation')).toBe(false);
      expect(await f.controller.handle({ action: 'getExportStatus' }, toolbar)).toMatchObject({
        operation: { phase: 'cancelled' },
      });
      f.restart();
      expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(false);
    }
  );
  it.each(['absent', 'current', 'selected'] as const)(
    'does not request branch options outside awaiting-selection: %s',
    async mode => {
      const f = fixture();
      if (mode !== 'absent') await f.start(mode);
      expect(
        await f.controller.handle({ action: 'getExportBranchOptions' }, toolbar)
      ).toMatchObject({ success: false });
      expect(
        f.api.tabs.sendMessage.mock.calls.some(call => call[1].action === 'readExportBranchOptions')
      ).toBe(false);
    }
  );
  it.each(['completeExportOperation', 'awaitExportSelection'] as const)(
    'does not accept content-only %s from the toolbar',
    async action => {
      const f = fixture();
      await f.start('selected');
      expect(
        await f.controller.handle(
          {
            action,
            exportOperationId: f.claim.exportOperationId!,
            outcome: 'ended',
            selectionId: crypto.randomUUID(),
          } as never,
          toolbar
        )
      ).toMatchObject({ success: false });
      expect(await f.controller.handle({ action: 'getExportStatus' }, toolbar)).toMatchObject({
        operation: { phase: 'preparing' },
      });
    }
  );
  it.each(['unaccepted', 'rejected'] as const)(
    'removes the pending intent after an %s begin without reserving the tab',
    async response => {
      const f = fixture();
      if (response === 'unaccepted')
        f.api.tabs.sendMessage.mockResolvedValueOnce({ accepted: false });
      else f.api.tabs.sendMessage.mockRejectedValueOnce(new Error('No content receiver'));
      expect(await f.start()).toMatchObject({ success: false });
      expect(f.stored[EXPORT_STATE_KEY]).toMatchObject({ intents: [], operations: [] });
      const intentId = f.api.tabs.sendMessage.mock.calls[0][1].intentId as string;
      expect(
        await f.controller.handle({ action: 'claimExportOperation', intentId, route }, source())
      ).toMatchObject({ success: false });
      expect(await f.start()).toMatchObject({ operation: { phase: 'exporting' } });
    }
  );
  it('binds a fallback UI claim and its renewed expiry to only the registered surface', async () => {
    const f = fixture();
    f.api.action.openPopup.mockRejectedValue(new Error('Popup unavailable'));
    await f.controller.handle({ action: 'openExportSurface' }, source());
    const ui = surfaceSender(f);
    f.advance(100);
    expect(
      await f.controller.handle(
        {
          action: 'startExportOperation',
          mode: 'selected',
          expectedTarget: { tabId: 7, route },
          expectedOutputs: ['file'],
        },
        ui
      )
    ).toMatchObject({ operation: { id: f.claim.exportOperationId, phase: 'preparing' } });
    const state = f.stored[EXPORT_STATE_KEY] as {
      intents: unknown[];
      operations: Array<{ id: string; uiSessionId: string; expires: number }>;
      surfaces: Array<{ id: string; operationId: string; expires: number }>;
    };
    expect(state.intents).toEqual([]);
    expect(state.surfaces[0]).toMatchObject({
      id: state.operations[0].uiSessionId,
      operationId: f.claim.exportOperationId,
      expires: 1_100 + EXPORT_OPERATION_MS,
    });
    expect(state.surfaces[0].expires).toBe(f.claim.expiresAt);
    f.restart();
    expect(await f.controller.isUi(ui)).toBe(true);
    expect(await f.controller.uiSource(ui)).toMatchObject({ tabId: 7, route });
    await f.controller.tabRemoved(10);
    expect(await f.authorize('captureChatGptConversation')).toBe(false);
  });
  it.each(['unaccepted', 'rejected'] as const)(
    'cancels a validated branch choice when applying it is %s',
    async response => {
      const f = fixture();
      await f.start('selected');
      const selectionId = crypto.randomUUID();
      await f.controller.handle(
        {
          action: 'awaitExportSelection',
          exportOperationId: f.claim.exportOperationId!,
          selectionId,
        },
        source()
      );
      f.api.tabs.sendMessage.mockResolvedValueOnce({ accepted: true });
      if (response === 'unaccepted')
        f.api.tabs.sendMessage.mockResolvedValueOnce({ accepted: false });
      else f.api.tabs.sendMessage.mockRejectedValueOnce(new Error('Choice receiver disconnected'));
      expect(
        await f.controller.handle(
          {
            action: 'chooseExportBranch',
            exportOperationId: f.claim.exportOperationId!,
            selectionId,
            choice: 1,
          },
          toolbar
        )
      ).toMatchObject({ success: false });
      expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(false);
      f.restart();
      expect(await f.controller.handle({ action: 'getExportStatus' }, toolbar)).toMatchObject({
        operation: { phase: 'cancelled' },
      });
    }
  );
  it.each(['persistence', 'post-handoff route'] as const)(
    'keeps failed %s handoff cleanup with the caller without restoring controller ownership',
    async failure => {
      const f = fixture();
      await f.start();
      await f.controller.recordResult(f.claim.exportOperationId, {
        success: true,
        stageId: 'owned-stage',
      });
      const message = {
        action: 'commitStagedBinaryAsset',
        source: 'chatgpt',
        stageId: 'owned-stage',
        exportOperationId: f.claim.exportOperationId,
      };
      if (failure === 'persistence')
        f.api.storage.session.set.mockRejectedValueOnce(new Error('Session quota'));
      else
        f.api.tabs.get
          .mockResolvedValueOnce({ ...f.tab })
          .mockResolvedValueOnce({ ...f.tab, url: route + '?changed=1' });
      const dispatch = vi.fn(async () => 'committed');
      expect(await f.controller.dispatchStageCommit(message, source(), dispatch)).toEqual({
        dispatched: false,
        cleanupOwned: true,
      });
      expect(dispatch).not.toHaveBeenCalled();
      expect(await f.controller.takeStageForCleanup(message, source())).toBe(false);
      f.restart();
      expect(await f.controller.takeStageForCleanup(message, source())).toBe(false);
      expect(await f.controller.dispatchStageCommit(message, source(), dispatch)).toEqual({
        dispatched: false,
        cleanupOwned: false,
      });
      expect(dispatch).not.toHaveBeenCalled();
    }
  );
  it.each(['claude', undefined])('denies saveToOutputs frontmatter source %s', async platform => {
    const f = fixture();
    await f.start();
    expect(
      await f.authorize('saveToOutputs', {
        outputs: ['file'],
        data: { frontmatter: { source: platform } },
      })
    ).toBe(false);
    expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(true);
  });
  it('cancels a duplicate returned stage receiver without borrowing the original cleanup owner', async () => {
    const f = fixture();
    await f.start();
    const first = f.claim.exportOperationId!;
    await f.controller.recordResult(first, { success: true, stageId: 'owned-stage' });
    await f.complete();
    await f.start();
    const second = f.claim.exportOperationId!;
    await f.controller.recordResult(second, { success: true, data: { stageId: 'owned-stage' } });
    f.restart();
    expect(await f.controller.handle({ action: 'getExportStatus' }, toolbar)).toMatchObject({
      operation: { id: second, phase: 'cancelled' },
    });
    expect(await f.authorize('abortStagedBinaryAsset', { stageId: 'owned-stage' })).toBe(false);
    expect(
      await f.authorize('abortStagedBinaryAsset', {
        exportOperationId: first,
        stageId: 'owned-stage',
      })
    ).toBe(true);
    expect(await f.authorize('captureChatGptConversation')).toBe(false);
  });
  it.each(['removed', 'url', 'loading'] as const)(
    'revokes pending intents only for the %s source tab',
    async event => {
      const f = fixture();
      const delayed = delayClaims(f);
      const first = delayed.start(7);
      await vi.waitFor(() => expect(delayed.pending.has(7)).toBe(true));
      const second = delayed.start(8);
      await vi.waitFor(() => expect(delayed.pending.has(8)).toBe(true));
      if (event === 'removed') await f.controller.tabRemoved(7);
      else
        await f.controller.tabChanged(
          7,
          event === 'url' ? { url: route + '?changed=1' } : { status: 'loading' }
        );
      expect((f.stored[EXPORT_STATE_KEY] as { intents: unknown[] }).intents).toHaveLength(1);
      expect(await delayed.claim(7)).toMatchObject({ success: false });
      expect(await first).toMatchObject({ success: false });
      expect(await delayed.claim(8)).toMatchObject({ success: true });
      expect(await second).toMatchObject({ operation: { phase: 'exporting' } });
      expect(f.stored[EXPORT_STATE_KEY]).toMatchObject({
        intents: [],
        operations: [{ target: { tabId: 8 } }],
      });
    }
  );
  it('closing a fallback tab removes its bound and direct intents but preserves an unrelated intent', async () => {
    const f = fixture();
    await f.start();
    f.api.action.openPopup.mockRejectedValue(new Error('Popup unavailable'));
    await f.controller.handle({ action: 'openExportSurface' }, source());
    const ui = surfaceSender(f);
    const intents = seedPendingIntents(f, [10, 8, 9]);
    intents[1].uiSessionId = new URL(ui.url!).searchParams.get('surface')!;
    f.restart();
    await f.controller.tabRemoved(10);
    expect(f.stored[EXPORT_STATE_KEY]).toMatchObject({
      surfaces: [],
      intents: [{ id: intents[2].id }],
    });
    expect((f.stored[EXPORT_STATE_KEY] as { intents: unknown[] }).intents).toHaveLength(1);
    expect(await f.controller.isUi(ui)).toBe(false);
    expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(true);
    expect(
      await f.controller.handle(
        { action: 'claimExportOperation', intentId: intents[1].id, route },
        tabSender(8)
      )
    ).toMatchObject({ success: false });
    expect(
      await f.controller.handle(
        { action: 'claimExportOperation', intentId: intents[2].id, route },
        tabSender(9)
      )
    ).toMatchObject({ success: true });
  });
  it.each(['abortStagedArchiveArtifact', 'abortStagedBinaryAsset'] as const)(
    'retains failed or unknown %s cleanup for an exact retry',
    async action => {
      const f = fixture();
      await f.start();
      const id = f.claim.exportOperationId!;
      await f.controller.recordResult(id, { success: true, stageId: 'owned-stage' });
      const request = { action, source: 'chatgpt', stageId: 'owned-stage' };
      for (const response of [{ success: false }, undefined, null, { success: 'true' }]) {
        await f.controller.recordResult(id, response, request, source());
        f.restart();
        expect(await f.controller.authorize({ ...request, exportOperationId: id }, source())).toBe(
          true
        );
      }
      await f.controller.recordResult(id, { success: true }, request, source());
      f.restart();
      expect(await f.controller.authorize({ ...request, exportOperationId: id }, source())).toBe(
        false
      );
    }
  );
  it.each(['abortStagedArchiveArtifact', 'abortStagedBinaryAsset'] as const)(
    'successful %s releases only the exact request generation and owner',
    async action => {
      const f = fixture();
      await f.start();
      const first = f.claim.exportOperationId!;
      await f.controller.recordResult(first, { success: true, stageId: 'first-stage' });
      await f.complete();
      await f.start();
      const second = f.claim.exportOperationId!;
      await f.controller.recordResult(second, { success: true, stageId: 'second-stage' });
      const request = { action, source: 'chatgpt', stageId: 'first-stage' };
      await f.controller.recordResult(second, { success: true }, request, source());
      await f.controller.recordResult(
        first,
        { success: true },
        { ...request, stageId: 'unknown-stage' },
        source()
      );
      await f.controller.recordResult(
        first,
        { success: true },
        { ...request, source: 'claude' },
        source()
      );
      for (const patch of [
        { documentId: 'another-document' },
        { frameId: 1 },
        { id: 'foreign-extension' },
      ]) {
        await f.controller.recordResult(first, { success: true }, request, {
          ...source(),
          ...patch,
        });
      }
      expect(await f.controller.authorize({ ...request, exportOperationId: first }, source())).toBe(
        true
      );
      // A result-supplied stage ID cannot redirect cleanup to another generation.
      await f.controller.recordResult(
        first,
        { success: true, stageId: 'second-stage' },
        request,
        source()
      );
      f.restart();
      expect(await f.controller.authorize({ ...request, exportOperationId: first }, source())).toBe(
        false
      );
      expect(
        await f.controller.authorize(
          { ...request, stageId: 'second-stage', exportOperationId: second },
          source()
        )
      ).toBe(true);
    }
  );
  it.each(['abortStagedArchiveArtifact', 'abortStagedBinaryAsset'] as const)(
    'releases confirmed %s ownership so 64 cleanup cycles do not block the next start',
    async action => {
      const f = fixture();
      for (let index = 0; index < 64; index++) {
        await f.start();
        const id = f.claim.exportOperationId!;
        const stageId = `owned-${index}`;
        await f.controller.recordResult(id, { success: true, stageId });
        const request = { action, source: 'chatgpt', stageId };
        expect(await f.controller.authorize({ ...request, exportOperationId: id }, source())).toBe(
          true
        );
        await f.controller.recordResult(id, { success: true }, request, source());
        await f.complete();
      }
      f.restart();
      expect(await f.start()).toMatchObject({ success: true, operation: { phase: 'exporting' } });
      const state = f.stored[EXPORT_STATE_KEY] as { operations: Array<{ stages: string[] }> };
      expect(state.operations).toHaveLength(64);
      expect(state.operations.every(op => op.stages.length === 0)).toBe(true);
    }
  );
  it('does not reserve a second delayed claim when only protected records remain', async () => {
    const f = fixture();
    for (let index = 0; index < 64; index++) {
      await f.start();
      if (index < 63)
        await f.controller.recordResult(f.claim.exportOperationId, {
          success: true,
          stageId: `owned-${index}`,
        });
      await f.complete();
    }
    const delayed = delayClaims(f);
    const first = delayed.start(7);
    await vi.waitFor(() => expect(delayed.pending.has(7)).toBe(true));
    expect(await delayed.start(8)).toMatchObject({ success: false });
    expect(delayed.pending.has(8)).toBe(false);
    expect((await delayed.claim(7)).success).toBe(true);
    expect(await first).toMatchObject({ success: true });
    const state = f.stored[EXPORT_STATE_KEY] as { operations: unknown[]; intents: unknown[] };
    expect(state.operations).toHaveLength(64);
    expect(state.intents).toHaveLength(0);
  });
  it('repairs an already-overreserved hydration before either retained claim is served', async () => {
    const f = fixture();
    const history: string[] = [];
    for (let index = 0; index < 64; index++) {
      await f.start();
      history.push(f.claim.exportOperationId!);
      await f.complete();
    }
    const intents = seedPendingIntents(f, [8, 9]);
    f.restart();
    const claims: ExportClaim[] = [];
    for (const intent of intents) {
      claims.push(
        (await f.controller.handle(
          { action: 'claimExportOperation', intentId: intent.id, route },
          tabSender(intent.target.tabId)
        )) as ExportClaim
      );
    }
    expect(claims.every(claim => claim.success)).toBe(true);
    const state = f.stored[EXPORT_STATE_KEY] as {
      operations: Array<{ id: string }>;
      intents: unknown[];
    };
    expect(state.operations.map(op => op.id)).toEqual([
      ...history.slice(2),
      ...claims.map(claim => claim.exportOperationId),
    ]);
    expect(state.operations).toHaveLength(64);
    expect(state.intents).toHaveLength(0);
    f.restart();
    expect(
      await f.controller.authorize(
        { action: 'captureChatGptConversation', exportOperationId: claims[0].exportOperationId },
        tabSender(8)
      )
    ).toBe(true);
  });
  it('revokes only the newest excess hydrated intent when protected cleanup records fill the remaining slots', async () => {
    const f = fixture();
    let ownerId = '';
    for (let index = 0; index < 64; index++) {
      await f.start();
      if (index === 0) ownerId = f.claim.exportOperationId!;
      if (index < 63)
        await f.controller.recordResult(f.claim.exportOperationId, {
          success: true,
          stageId: `owned-${index}`,
        });
      await f.complete();
    }
    const intents = seedPendingIntents(f, [8, 9]);
    f.restart();
    expect(
      await f.controller.handle(
        { action: 'claimExportOperation', intentId: intents[1].id, route },
        tabSender(9)
      )
    ).toMatchObject({ success: false });
    const repaired = f.stored[EXPORT_STATE_KEY] as {
      operations: unknown[];
      intents: Array<{ id: string }>;
    };
    expect(repaired.operations).toHaveLength(63);
    expect(repaired.intents.map(intent => intent.id)).toEqual([intents[0].id]);
    expect(
      await f.controller.handle(
        { action: 'claimExportOperation', intentId: intents[0].id, route },
        tabSender(8)
      )
    ).toMatchObject({ success: true });
    f.restart();
    expect(
      await f.controller.authorize(
        {
          action: 'abortStagedArchiveArtifact',
          source: 'chatgpt',
          stageId: 'owned-0',
          exportOperationId: ownerId,
        },
        source()
      )
    ).toBe(true);
  });
  it('does not evict a live generation or a cleanup owner while repairing legacy reservations', async () => {
    const f = fixture();
    let ownerId = '';
    for (let index = 0; index < 63; index++) {
      await f.start();
      if (index === 0) ownerId = f.claim.exportOperationId!;
      await f.controller.recordResult(f.claim.exportOperationId, {
        success: true,
        stageId: `owned-${index}`,
      });
      await f.complete();
    }
    await f.start();
    const liveId = f.claim.exportOperationId!;
    const intents = seedPendingIntents(f, [8, 9]);
    f.restart();
    for (const intent of intents)
      expect(
        await f.controller.handle(
          { action: 'claimExportOperation', intentId: intent.id, route },
          tabSender(intent.target.tabId)
        )
      ).toMatchObject({ success: false });
    const repaired = f.stored[EXPORT_STATE_KEY] as { operations: unknown[]; intents: unknown[] };
    expect(repaired.operations).toHaveLength(64);
    expect(repaired.intents).toHaveLength(0);
    f.restart();
    expect(
      await f.controller.authorize(
        { action: 'captureChatGptConversation', exportOperationId: liveId },
        source()
      )
    ).toBe(true);
    expect(
      await f.controller.authorize(
        {
          action: 'abortStagedArchiveArtifact',
          source: 'chatgpt',
          stageId: 'owned-0',
          exportOperationId: ownerId,
        },
        source()
      )
    ).toBe(true);
  });
  it('preserves the independent 32-pending-intent cap', async () => {
    const f = fixture();
    await f.start();
    await f.complete();
    seedPendingIntents(
      f,
      Array.from({ length: 32 }, (_value, index) => index + 8)
    );
    const saved = structuredClone(f.stored);
    f.restart();
    expect(await f.start()).toMatchObject({ success: false });
    expect(f.stored).toEqual(saved);
  });
  it('reserves both delayed tab claims under the combined cap and hydrates their generations', async () => {
    const f = fixture();
    for (let index = 0; index < 64; index++) {
      await f.start();
      await f.complete();
    }
    const delayed = delayClaims(f);
    const first = delayed.start(7);
    await vi.waitFor(() => expect(delayed.pending.has(7)).toBe(true));
    const second = delayed.start(8);
    await vi.waitFor(() => expect(delayed.pending.has(8)).toBe(true));
    const reserved = structuredClone(f.stored[EXPORT_STATE_KEY]) as {
      operations: unknown[];
      intents: unknown[];
    };
    const claims = await Promise.all([delayed.claim(7), delayed.claim(8)]);
    expect(await Promise.all([first, second])).toEqual([
      expect.objectContaining({ success: true }),
      expect.objectContaining({ success: true }),
    ]);
    expect(claims.every(claim => claim.success)).toBe(true);
    const finished = f.stored[EXPORT_STATE_KEY] as { operations: unknown[]; intents: unknown[] };
    expect(reserved.operations.length + reserved.intents.length).toBe(64);
    expect(reserved.operations).toHaveLength(62);
    expect(reserved.intents).toHaveLength(2);
    expect(finished.operations).toHaveLength(64);
    expect(finished.intents).toHaveLength(0);
    f.restart();
    for (const [index, claim] of claims.entries()) {
      expect(
        await f.controller.authorize(
          {
            action: 'saveToOutputs',
            exportOperationId: claim.exportOperationId,
            data: { frontmatter: { source: 'chatgpt' } },
            outputs: ['file'],
          },
          tabSender(7 + index)
        )
      ).toBe(true);
    }
  });
  it('reclaims the oldest empty terminal history atomically with the 65th intent', async () => {
    const f = fixture();
    const ids: string[] = [];
    for (let index = 0; index < 64; index++) {
      expect(await f.start()).toMatchObject({ success: true });
      ids.push(f.claim.exportOperationId!);
      expect(await f.complete()).toMatchObject({ success: true });
    }
    f.restart();
    const save = f.api.storage.session.set.getMockImplementation()!;
    f.api.storage.session.set.mockImplementationOnce(async record => {
      const state = (
        record as Record<string, { operations: Array<{ id: string }>; intents: unknown[] }>
      )[EXPORT_STATE_KEY];
      expect(state.operations).toHaveLength(63);
      expect(state.operations.map(op => op.id)).toEqual(ids.slice(1));
      expect(state.intents).toHaveLength(1);
      await save(record);
    });
    const savesBefore = f.api.storage.session.set.mock.calls.length;
    expect(await f.start()).toMatchObject({ success: true, operation: { phase: 'exporting' } });
    expect(f.api.storage.session.set).toHaveBeenCalledTimes(savesBefore + 2);
    const state = f.stored[EXPORT_STATE_KEY] as { operations: Array<{ id: string }> };
    expect(state.operations.map(op => op.id)).toEqual([...ids.slice(1), f.claim.exportOperationId]);
    expect(state.operations).toHaveLength(64);
  });
  it.each(['completed', 'cancelled'] as const)(
    'preserves %s stage ownership while reclaiming the oldest eligible terminal',
    async phase => {
      const f = fixture();
      await f.start();
      const ownerId = f.claim.exportOperationId!;
      await f.controller.recordResult(ownerId, { success: true, stageId: 'owned-stage' });
      if (phase === 'completed') await f.complete();
      else
        await f.controller.handle(
          { action: 'cancelExportOperation', exportOperationId: ownerId },
          toolbar
        );
      let oldestEligibleId: string | undefined;
      for (let index = 1; index < 64; index++) {
        await f.start();
        oldestEligibleId ??= f.claim.exportOperationId;
        await f.complete();
      }
      expect(await f.start()).toMatchObject({ success: true, operation: { phase: 'exporting' } });
      f.restart();
      const state = f.stored[EXPORT_STATE_KEY] as {
        operations: Array<{ id: string; stages: string[] }>;
      };
      expect(state.operations).toHaveLength(64);
      expect(state.operations.find(op => op.id === ownerId)?.stages).toEqual(['owned-stage']);
      expect(state.operations.some(op => op.id === oldestEligibleId)).toBe(false);
      expect(
        await f.controller.authorize(
          {
            action: 'abortStagedArchiveArtifact',
            source: 'chatgpt',
            stageId: 'owned-stage',
            exportOperationId: ownerId,
          },
          source()
        )
      ).toBe(true);
    }
  );
  it('keeps the cap closed when every retained terminal still owns cleanup', async () => {
    const f = fixture();
    for (let index = 0; index < 64; index++) {
      await f.start();
      await f.controller.recordResult(f.claim.exportOperationId, {
        success: true,
        stageId: `owned-${index}`,
      });
      await f.complete();
    }
    const saved = structuredClone(f.stored);
    const sendsBefore = f.api.tabs.sendMessage.mock.calls.length;
    expect(await f.start()).toMatchObject({ success: false });
    expect(f.stored).toEqual(saved);
    expect(f.api.tabs.sendMessage).toHaveBeenCalledTimes(sendsBefore);
  });
  it.each(['preparing', 'awaiting-selection'] as const)(
    'retains an honest no-save outcome when selected %s ends before a choice',
    async phase => {
      const f = fixture();
      await f.start('selected');
      if (phase === 'awaiting-selection')
        await f.controller.handle(
          {
            action: 'awaitExportSelection',
            exportOperationId: f.claim.exportOperationId!,
            selectionId: crypto.randomUUID(),
          },
          source()
        );
      await f.controller.handle(
        {
          action: 'completeExportOperation',
          exportOperationId: f.claim.exportOperationId!,
          outcome: 'branch-preparation-ended',
        },
        source()
      );
      const expected = {
        success: true,
        operation: {
          id: f.claim.exportOperationId,
          phase: 'completed',
          mode: 'selected',
          outcome: 'branch-preparation-ended',
        },
      };
      expect(await f.controller.handle({ action: 'getExportStatus' }, toolbar)).toMatchObject(
        expected
      );
      expect(f.stored[EXPORT_STATE_KEY]).toMatchObject({
        operations: [{ outcome: 'branch-preparation-ended' }],
      });
      f.restart();
      expect(await f.controller.handle({ action: 'getExportStatus' }, toolbar)).toMatchObject(
        expected
      );
      expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(false);
    }
  );
  it.each(['current', 'selected'] as const)(
    '%s completion retains only a neutral ended outcome after export authorization',
    async mode => {
      const f = fixture();
      await f.start(mode);
      if (mode === 'selected') {
        const selectionId = crypto.randomUUID();
        await f.controller.handle(
          {
            action: 'awaitExportSelection',
            exportOperationId: f.claim.exportOperationId!,
            selectionId,
          },
          source()
        );
        await f.controller.handle(
          {
            action: 'chooseExportBranch',
            exportOperationId: f.claim.exportOperationId!,
            selectionId,
            choice: 1,
          },
          toolbar
        );
      }
      await f.controller.handle(
        {
          action: 'completeExportOperation',
          exportOperationId: f.claim.exportOperationId!,
          // A content claim cannot label an authorized export as no-save.
          outcome: 'branch-preparation-ended',
        },
        source()
      );
      f.restart();
      expect(await f.controller.handle({ action: 'getExportStatus' }, toolbar)).toMatchObject({
        operation: { mode, phase: 'completed', outcome: 'ended' },
      });
    }
  );
  it('completion cannot turn cancellation into a completed result', async () => {
    const f = fixture();
    await f.start('selected');
    await f.controller.handle(
      { action: 'cancelExportOperation', exportOperationId: f.claim.exportOperationId! },
      toolbar
    );
    await f.controller.handle(
      {
        action: 'completeExportOperation',
        exportOperationId: f.claim.exportOperationId!,
        outcome: 'branch-preparation-ended',
      },
      source()
    );
    f.restart();
    const status = await f.controller.handle({ action: 'getExportStatus' }, toolbar);
    expect(status).toMatchObject({ operation: { phase: 'cancelled' } });
    expect(status).not.toHaveProperty('operation.outcome');
  });
  it('rejects unbounded completion text and corrupt persisted outcome metadata', async () => {
    const f = fixture();
    await f.start();
    expect(
      await f.controller.handle(
        {
          action: 'completeExportOperation',
          exportOperationId: f.claim.exportOperationId!,
          outcome: '<script>provider text</script>',
        } as never,
        source()
      )
    ).toMatchObject({ success: false });
    expect(await f.controller.handle({ action: 'getExportStatus' }, toolbar)).toMatchObject({
      operation: { phase: 'exporting' },
    });
    const stored = f.stored[EXPORT_STATE_KEY] as {
      operations: Array<{ outcome?: string }>;
    };
    stored.operations[0].outcome = '<script>provider text</script>';
    f.restart();
    expect(await f.controller.handle({ action: 'getExportStatus' }, toolbar)).not.toHaveProperty(
      'operation'
    );
  });
  it.each(['url', 'loading', 'removed', 'unrelated'] as const)(
    'revocation during an awaited settings read is immediate: %s',
    async event => {
      const f = fixture();
      await f.start();
      const snapshot = await f.readSettings();
      let release!: () => void;
      let entered!: () => void;
      const paused = new Promise<void>(resolve => {
        entered = resolve;
      });
      f.readSettings.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            release = () => resolve(snapshot);
            entered();
          })
      );
      const dispatch = vi.fn();
      const admission = f.authorize('saveToOutputs', { outputs: ['file'] }).then(allowed => {
        if (allowed) dispatch();
        return allowed;
      });
      await paused;
      if (event === 'url') f.tab.url = route + '?other=1';
      if (event === 'removed') f.api.tabs.get.mockRejectedValue(new Error('removed'));
      if (event === 'loading')
        f.api.tabs.get.mockResolvedValue({ ...f.tab, status: 'loading' } as never);
      const invalidation =
        event === 'removed'
          ? f.controller.tabRemoved(7)
          : f.controller.tabChanged(
              event === 'unrelated' ? 99 : 7,
              event === 'url' ? { url: f.tab.url } : { status: 'loading' }
            );
      release();
      expect(await admission).toBe(event === 'unrelated');
      expect(dispatch).toHaveBeenCalledTimes(event === 'unrelated' ? 1 : 0);
      await invalidation;
      if (event !== 'unrelated') {
        f.restart();
        expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(false);
      }
    }
  );
  it('durable stage handoff cannot be reclaimed by cleanup after an uncertain dispatch or restart', async () => {
    const f = fixture();
    await f.start();
    await f.controller.recordResult(f.claim.exportOperationId, {
      success: true,
      stageId: 'owned-stage',
    });
    const message = {
      action: 'commitStagedBinaryAsset',
      source: 'chatgpt',
      stageId: 'owned-stage',
      exportOperationId: f.claim.exportOperationId,
    };
    let resolveCommit!: (value: string) => void;
    const dispatch = vi.fn(
      () =>
        new Promise<string>(resolve => {
          resolveCommit = resolve;
        })
    );
    const admission = await f.controller.dispatchStageCommit(message, source(), dispatch);
    expect(admission.dispatched).toBe(true);
    expect(dispatch).toHaveBeenCalledOnce();
    await f.controller.handle(
      { action: 'cancelExportOperation', exportOperationId: f.claim.exportOperationId! },
      toolbar
    );
    expect(await f.controller.takeStageForCleanup(message, source())).toBe(false);
    f.restart();
    expect(await f.controller.takeStageForCleanup(message, source())).toBe(false);
    resolveCommit('unknown');
    if (admission.dispatched) expect(await admission.result).toBe('unknown');
  });
  it.each([...EXPORT_DURABLE_ACTIONS, ...EXPORT_PREPARATION_ACTIONS])(
    'denies %s without a generation',
    async action => {
      expect(await fixture().authorize(action)).toBe(false);
    }
  );
  it('claims only once and duplicate popup starts dispatch only once', async () => {
    const f = fixture();
    await f.start();
    expect(f.claim.success).toBe(true);
    expect(f.claim.settings).not.toHaveProperty('obsidianApiKey');
    const intentId = f.api.tabs.sendMessage.mock.calls[0][1].intentId as string;
    expect(
      await f.controller.handle({ action: 'claimExportOperation', intentId, route }, source())
    ).toMatchObject({ success: false });
    await f.start();
    expect(
      f.api.tabs.sendMessage.mock.calls.filter(call => call[1].action === 'beginExportOperation')
    ).toHaveLength(1);
    expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(true);
  });
  it('refuses a target or destination set different from the one displayed at the trusted click', async () => {
    const f = fixture();
    expect(
      await f.controller.handle(
        {
          action: 'startExportOperation',
          mode: 'current',
          expectedTarget: { tabId: 8, route },
          expectedOutputs: ['file'],
        },
        toolbar
      )
    ).toMatchObject({ success: false });
    expect(
      await f.controller.handle(
        {
          action: 'startExportOperation',
          mode: 'current',
          expectedTarget: { tabId: 7, route },
          expectedOutputs: ['clipboard'],
        },
        toolbar
      )
    ).toMatchObject({ success: false });
    expect(f.api.tabs.sendMessage).not.toHaveBeenCalled();
  });
  it('a settings-change revocation cannot revive when old settings are restored', async () => {
    const f = fixture();
    await f.start();
    await f.controller.settingsChanged();
    expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(false);
    f.restart();
    expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(false);
  });
  it('expiry cancels a waiting document and retains only a bounded owned cleanup grace', async () => {
    const f = fixture();
    await f.start('selected');
    await f.controller.recordResult(f.claim.exportOperationId, { success: true, stageId: 'owned' });
    f.advance(EXPORT_OPERATION_MS + 1);
    expect(await f.authorize('captureChatGptConversation')).toBe(false);
    expect(
      f.api.tabs.sendMessage.mock.calls.some(call => call[1].action === 'cancelExportOperation')
    ).toBe(true);
    expect(await f.authorize('abortStagedArchiveArtifact', { stageId: 'owned' })).toBe(true);
    f.advance(10 * 60_000);
    expect(await f.authorize('abortStagedArchiveArtifact', { stageId: 'owned' })).toBe(false);
  });
  it('rejects corrupt selected-exporting metadata that never bound a branch choice', async () => {
    const f = fixture();
    await f.start('selected');
    const record = f.stored[EXPORT_STATE_KEY] as { operations: Array<{ phase: string }> };
    record.operations[0].phase = 'exporting';
    f.restart();
    expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(false);
  });
  it.each([
    { id: 'foreign' },
    { frameId: 1 },
    { documentId: 'document-two' },
    { tab: { id: 8, url: route } },
    { tab: { id: 7, url: route + '?changed=1' } },
    { url: 'https://claude.ai/chat/x' },
  ])('rejects owner mismatch %j', async patch => {
    const f = fixture();
    await f.start();
    expect(
      await f.authorize('saveToOutputs', { outputs: ['file'] }, {
        ...source(),
        ...patch,
      } as chrome.runtime.MessageSender)
    ).toBe(false);
  });
  it('revalidates current browser route, not only stale sender metadata', async () => {
    const f = fixture();
    await f.start();
    f.tab.url = route + '#different';
    expect(await f.authorize('captureChatGptConversation')).toBe(false);
  });
  it.each([
    { vaultPath: 'Elsewhere' },
    { obsidianApiKey: 'rotated' },
    { outputOptions: { file: false, obsidian: true, clipboard: false } },
  ])('revokes changed effective settings %j', async change => {
    const f = fixture();
    await f.start();
    f.settings(change);
    expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(false);
  });
  it('rejects an output not in the immutable allowed set', async () => {
    const f = fixture();
    await f.start();
    expect(await f.authorize('saveToOutputs', { outputs: ['clipboard'] })).toBe(false);
  });
  it('preparation cannot commit any durable family until exact extension choice', async () => {
    const f = fixture();
    await f.start('selected');
    for (const action of EXPORT_DURABLE_ACTIONS)
      expect(await f.authorize(action, { outputs: ['file'] })).toBe(false);
    expect(await f.authorize('captureChatGptConversation')).toBe(true);
    const selectionId = crypto.randomUUID();
    await f.controller.handle(
      {
        action: 'awaitExportSelection',
        exportOperationId: f.claim.exportOperationId!,
        selectionId,
      },
      source()
    );
    const options = await f.controller.handle({ action: 'getExportBranchOptions' }, toolbar);
    expect(options).toMatchObject({ options: [{ preview: '<img src=x>' }] });
    expect(
      await f.controller.handle(
        {
          action: 'chooseExportBranch',
          exportOperationId: f.claim.exportOperationId!,
          selectionId: crypto.randomUUID(),
          choice: 1,
        },
        toolbar
      )
    ).toMatchObject({ success: false });
    expect(
      await f.controller.handle(
        {
          action: 'chooseExportBranch',
          exportOperationId: f.claim.exportOperationId!,
          selectionId,
          choice: 1,
        },
        source()
      )
    ).toMatchObject({ success: false });
    expect(
      await f.controller.handle(
        {
          action: 'chooseExportBranch',
          exportOperationId: f.claim.exportOperationId!,
          selectionId,
          choice: 1,
        },
        toolbar
      )
    ).toMatchObject({ success: true });
    expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(true);
    expect(
      await f.controller.handle(
        {
          action: 'chooseExportBranch',
          exportOperationId: f.claim.exportOperationId!,
          selectionId,
          choice: 'all',
        },
        toolbar
      )
    ).toMatchObject({ success: false });
    expect(JSON.stringify(f.stored)).not.toContain('<img');
  });
  it('binds Export all and persists no catalog', async () => {
    const f = fixture();
    await f.start('selected');
    const selectionId = crypto.randomUUID();
    await f.controller.handle(
      {
        action: 'awaitExportSelection',
        exportOperationId: f.claim.exportOperationId!,
        selectionId,
      },
      source()
    );
    await f.controller.handle(
      {
        action: 'chooseExportBranch',
        exportOperationId: f.claim.exportOperationId!,
        selectionId,
        choice: 'all',
      },
      toolbar
    );
    expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(true);
    expect(JSON.stringify(f.stored)).toContain('"choice":"all"');
  });
  it('cancel denies new work, but exact owner cleanup remains valid; ABA cannot borrow the next generation', async () => {
    const f = fixture();
    await f.start();
    const old = f.claim.exportOperationId!;
    await f.controller.recordResult(old, { success: true, stageId: 'archive-stage-owned' });
    await f.controller.handle({ action: 'cancelExportOperation', exportOperationId: old }, toolbar);
    expect(await f.authorize('captureChatGptConversation')).toBe(false);
    expect(
      await f.authorize('abortStagedArchiveArtifact', { stageId: 'archive-stage-owned' })
    ).toBe(true);
    expect(
      await f.authorize('abortStagedArchiveArtifact', { stageId: 'archive-stage-other' })
    ).toBe(false);
    expect(
      await f.authorize(
        'abortStagedArchiveArtifact',
        { stageId: 'archive-stage-owned' },
        { ...source(), documentId: 'document-two' }
      )
    ).toBe(false);
    await f.start();
    expect(f.claim.exportOperationId).not.toBe(old);
    expect(await f.authorize('saveToOutputs', { outputs: ['file'], exportOperationId: old })).toBe(
      false
    );
    expect(await f.authorize('readStagedArchiveArtifact', { stageId: 'archive-stage-owned' })).toBe(
      false
    );
  });
  it('hydrates generation and stage ownership on restart; missing/corrupt metadata fails closed', async () => {
    const f = fixture();
    await f.start();
    await f.controller.recordResult(f.claim.exportOperationId, { success: true, stageId: 'owned' });
    f.restart();
    expect(await f.authorize('readStagedArchiveArtifact', { stageId: 'owned' })).toBe(true);
    f.stored = { [EXPORT_STATE_KEY]: { version: 1, operations: 'broken' } };
    f.restart();
    expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(false);
    f.stored = {};
    f.restart();
    expect(await f.authorize('captureChatGptConversation')).toBe(false);
  });
  it('expires operations and pending claims', async () => {
    const f = fixture();
    await f.start();
    f.advance(EXPORT_OPERATION_MS + 1);
    expect(await f.authorize('captureChatGptConversation')).toBe(false);
    f.api.tabs.sendMessage.mockImplementationOnce(async (_id, message) => {
      f.advance(EXPORT_PENDING_MS + 1);
      expect(
        await f.controller.handle(
          { action: 'claimExportOperation', intentId: message.intentId as string, route },
          source()
        )
      ).toMatchObject({ success: false });
      return { accepted: false };
    });
    expect(await f.start()).toMatchObject({ success: false });
  });
  it('storage failure never leaves an in-memory grant', async () => {
    const f = fixture();
    f.api.storage.session.set.mockRejectedValueOnce(new Error('Unavailable'));
    await expect(f.start()).rejects.toThrow();
    expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(false);
  });
  it('failed cancellation persistence removes stale grants before restart and still notifies content', async () => {
    const f = fixture();
    await f.start();
    f.api.storage.session.set.mockRejectedValueOnce(new Error('quota'));
    await expect(
      f.controller.handle(
        { action: 'cancelExportOperation', exportOperationId: f.claim.exportOperationId! },
        toolbar
      )
    ).rejects.toThrow();
    f.restart();
    expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(false);
    expect(
      f.api.tabs.sendMessage.mock.calls.some(call => call[1].action === 'cancelExportOperation')
    ).toBe(true);
  });
  it.each(['absent', 'reject', 'success'])('launcher feature detection: %s', async mode => {
    const f = fixture();
    if (mode === 'absent') f.api.action.openPopup = undefined as never;
    if (mode === 'reject')
      f.api.action.openPopup.mockRejectedValue(new Error('Policy restriction'));
    expect(await f.controller.handle({ action: 'openExportSurface' }, source())).toMatchObject({
      success: true,
    });
    expect(f.api.tabs.sendMessage).not.toHaveBeenCalled();
    expect(f.api.windows.create).toHaveBeenCalledTimes(mode === 'success' ? 0 : 1);
    if (mode !== 'success') {
      const page = f.api.windows.create.mock.calls[0][0] as { url: string };
      const ui = {
        id: extensionId,
        url: page.url,
        frameId: 0,
        tab: { id: 10, windowId: 9 },
      } as chrome.runtime.MessageSender;
      expect(await f.controller.isUi(ui)).toBe(true);
      expect(
        await f.controller.isUi({ ...ui, tab: { id: 11, windowId: 9 } as chrome.tabs.Tab })
      ).toBe(false);
      expect(await f.controller.isUi({ ...ui, frameId: 1 })).toBe(false);
      f.api.tabs.query.mockResolvedValue([{ ...f.tab, id: 10, url: page.url }]);
      expect(await f.controller.handle({ action: 'getExportStatus' }, ui)).toMatchObject({
        target: { tabId: 7, route },
      });
    }
  });
  it('closing branch window cancels selection, but closing an exporting window does not', async () => {
    const f = fixture();
    await f.start('selected');
    await f.controller.handle(
      {
        action: 'awaitExportSelection',
        exportOperationId: f.claim.exportOperationId!,
        selectionId: crypto.randomUUID(),
      },
      source()
    );
    // Reopening through the fox must not erase this window's selection owner.
    f.api.action.openPopup = undefined as never;
    await f.controller.handle({ action: 'openExportSurface' }, source());
    await f.controller.tabRemoved(10);
    expect(await f.authorize('captureChatGptConversation')).toBe(false);
    await f.start();
    await f.controller.tabRemoved(10);
    expect(await f.authorize('saveToOutputs', { outputs: ['file'] })).toBe(true);
  });
  it.each([{ url: route + '/other' }, { status: 'loading' }])(
    'navigation/reload cancels %j',
    async change => {
      const f = fixture();
      await f.start();
      await f.controller.tabChanged(7, change);
      expect(await f.authorize('captureChatGptConversation')).toBe(false);
    }
  );
  it('bounds and detaches text-only options', () => {
    const option = {
      ordinal: 1,
      messageCount: 2,
      uniqueMessageCount: 1,
      isCurrent: true,
      preview: '<script>value</script>',
    };
    expect(boundedBranchOptions([option])).toEqual([option]);
    expect(boundedBranchOptions([option, option])).toBeUndefined();
    expect(boundedBranchOptions([{ ...option, preview: 'x'.repeat(281) }])).toBeUndefined();
    expect(boundedBranchOptions(Array(1001).fill(option))).toBeUndefined();
  });
});
