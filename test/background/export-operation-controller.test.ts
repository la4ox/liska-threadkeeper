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
        set: vi.fn(async (record: object) => {
          stored = structuredClone(record);
        }),
        remove: vi.fn(async () => {
          stored = {};
        }),
      },
    },
    action: { openPopup: vi.fn(async () => undefined) },
    windows: {
      create: vi.fn(async () => ({ id: 9, tabs: [{ id: 10 }] })),
      update: vi.fn(async () => ({})),
    },
    tabs: {
      get: vi.fn(async () => ({ ...tab })),
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

describe('worker-owned export generations', () => {
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
