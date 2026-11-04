import { describe, expect, it, vi } from 'vitest';
import { TextPreviewController } from '../../src/background/text-preview-controller';
import { textPreviewPageUrl } from '../../src/lib/text-preview-contract';
import type { ExportTarget } from '../../src/lib/export-operation-contract';
import type { ExtensionSettings } from '../../src/lib/types';

const SESSION = '11111111-1111-4111-8111-111111111111';
const DELIVERY = '22222222-2222-4222-8222-222222222222';
const SELECTION = '33333333-3333-4333-8333-333333333333';
const ROUTE = 'https://chatgpt.com/c/thread';
const SOURCE_TAB = 7;
const PAGE_TAB = 70;
const PAGE_WINDOW = 700;
const DOCUMENT = 'source-document-1';
const PAGE_DOCUMENT = 'preview-document-1';
const STAGE_ID = `archive-stage-${'A'.repeat(32)}`;

const payload = () => ({
  schema: 'liska-text-preview/1',
  sourceCanonicalSha256: 'a'.repeat(64),
  branchTargetNodeId: 'assistant-1',
  title: 'Detached title',
  profile: { schema: 'liska-reading-profile/1', includeToolContent: false },
  rows: [
    { nodeId: 'user-1', role: 'user', presentedText: 'Question' },
    { nodeId: 'assistant-1', role: 'assistant', presentedText: 'Answer' },
  ],
});

function sourceSender(route = ROUTE, documentId = DOCUMENT): chrome.runtime.MessageSender {
  return {
    id: 'extension',
    frameId: 0,
    documentId,
    url: route,
    tab: { id: SOURCE_TAB, windowId: 1, url: route, status: 'complete', title: 'Private' },
  } as chrome.runtime.MessageSender;
}

function uiSender(): chrome.runtime.MessageSender {
  return {
    id: 'extension',
    url: 'chrome-extension://extension/src/popup/index.html',
  } as chrome.runtime.MessageSender;
}

interface Harness {
  controller: TextPreviewController;
  chrome: typeof chrome;
  target: ExportTarget;
  source: chrome.runtime.MessageSender;
  page: (overrides?: Partial<chrome.runtime.MessageSender>) => chrome.runtime.MessageSender;
  start: (mode?: 'current' | 'selected') => Promise<Record<string, unknown>>;
  now: { value: number };
  releaseSource: ReturnType<typeof vi.fn>;
  reserveSource: ReturnType<typeof vi.fn>;
  abortStage: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
}

function harness(
  options: {
    claim?: boolean;
    platform?: 'chatgpt' | 'deepseek';
    settings?: () => Promise<ExtensionSettings>;
    isUi?: () => Promise<boolean>;
    random?: () => string;
  } = {}
): Harness {
  const platform = options.platform ?? 'chatgpt';
  const route = platform === 'chatgpt' ? ROUTE : 'https://chat.deepseek.com/a/chat/s/thread';
  const target: ExportTarget = { tabId: SOURCE_TAB, route, platform, title: 'Private' };
  const source = sourceSender(route);
  const now = { value: 1_000 };
  const randomValues = [SESSION, DELIVERY, SELECTION];
  const reserveSource = vi.fn(async () => true);
  const releaseSource = vi.fn(async () => undefined);
  const abortStage = vi.fn(async () => true);
  let pageCurrentUrl = route;
  const sendMessage = vi.fn(async (_tabId: number, message: Record<string, unknown>) => {
    if (message.action === 'beginTextPreviewCapture') {
      if (options.claim === false) return { accepted: true };
      const claim = (await controller.handle(
        { action: 'claimTextPreviewCapture', sessionId: SESSION, route },
        source
      )) as { success?: boolean };
      return { accepted: claim.success === true };
    }
    if (
      message.action === 'validateTextPreviewChoice' ||
      message.action === 'applyTextPreviewChoice' ||
      message.action === 'cancelTextPreviewCapture'
    )
      return { accepted: true };
    return undefined;
  });
  const chromeApi = {
    runtime: {
      id: 'extension',
      getURL: (path: string) => `chrome-extension://extension/${path}`,
    },
    tabs: {
      get: vi.fn(async (tabId: number) => {
        if (tabId === SOURCE_TAB)
          return {
            id: SOURCE_TAB,
            windowId: 1,
            url: route,
            status: 'complete',
            title: 'Private',
          };
        if (tabId === PAGE_TAB)
          return {
            id: PAGE_TAB,
            windowId: PAGE_WINDOW,
            url: pageCurrentUrl,
            status: 'complete',
          };
        throw new Error('missing');
      }),
      update: vi.fn(async (tabId: number, properties: chrome.tabs.UpdateProperties) => {
        if (tabId !== PAGE_TAB || typeof properties.url !== 'string') throw new Error('missing');
        pageCurrentUrl = properties.url;
        return {
          id: PAGE_TAB,
          windowId: PAGE_WINDOW,
          url: pageCurrentUrl,
          status: 'loading',
        };
      }),
      sendMessage,
    },
    windows: {
      create: vi.fn(async () => ({
        id: PAGE_WINDOW,
        tabs: [{ id: PAGE_TAB, windowId: PAGE_WINDOW, url: route }],
      })),
      remove: vi.fn(async () => undefined),
    },
  } as unknown as typeof chrome;
  const controller = new TextPreviewController({
    chrome: chromeApi,
    settings:
      options.settings ??
      (async () =>
        ({
          enableAutoScroll: true,
          enableToolContent: false,
          enableChatGptOpaqueReplay: true,
          obsidianApiKey: 'must-not-cross',
          obsidianUrl: 'http://127.0.0.1:27123',
          vaultPath: 'private',
        }) as ExtensionSettings),
    isUi: options.isUi ?? (async () => true),
    uiSource: async () => target,
    reserveSource,
    releaseSource,
    abortStage,
    now: () => now.value,
    random:
      options.random ?? (() => randomValues.shift() ?? '44444444-4444-4444-8444-444444444444'),
    revision: () => 0,
    delay: async () => undefined,
  });
  const pageUrl = textPreviewPageUrl(chromeApi.runtime, SESSION);
  const page = (overrides: Partial<chrome.runtime.MessageSender> = {}) =>
    ({
      id: 'extension',
      frameId: 0,
      documentId: PAGE_DOCUMENT,
      url: pageUrl,
      tab: { id: PAGE_TAB, windowId: PAGE_WINDOW, url: pageUrl, status: 'complete' },
      ...overrides,
    }) as chrome.runtime.MessageSender;
  return {
    controller,
    chrome: chromeApi,
    target,
    source,
    page,
    now,
    reserveSource,
    releaseSource,
    abortStage,
    sendMessage,
    start: async (mode = 'current') =>
      (await controller.handle(
        {
          action: 'startTextPreview',
          expectedTarget: { tabId: SOURCE_TAB, route },
          branchMode: mode,
        },
        uiSender()
      )) as Record<string, unknown>,
  };
}

describe('TextPreviewController', () => {
  it('enforces four global page leases and reclaims a slot only after the absolute lease', async () => {
    let clock = 1_000;
    let currentTarget!: ExportTarget;
    let sequence = 0;
    const reserved = new Set<number>();
    const pageTabs = new Map<number, { windowId: number; url: string }>();
    const chromeApi = {
      runtime: {
        id: 'extension',
        getURL: (path: string) => `chrome-extension://extension/${path}`,
      },
      tabs: {
        get: vi.fn(async (tabId: number) => {
          const page = pageTabs.get(tabId);
          return page
            ? { id: tabId, windowId: page.windowId, url: page.url, status: 'complete' }
            : {
                id: tabId,
                windowId: 1,
                url: `https://chatgpt.com/c/thread-${tabId}`,
                status: 'complete',
              };
        }),
        update: vi.fn(async (tabId: number, properties: chrome.tabs.UpdateProperties) => {
          const page = pageTabs.get(tabId);
          if (!page || typeof properties.url !== 'string') throw new Error('missing');
          page.url = properties.url;
          return { id: tabId, windowId: page.windowId, url: page.url, status: 'loading' };
        }),
        sendMessage: vi.fn(async (tabId: number, message: Record<string, unknown>) => {
          if (message.action !== 'beginTextPreviewCapture') return { accepted: true };
          const route = `https://chatgpt.com/c/thread-${tabId}`;
          const claim = (await controller.handle(
            { action: 'claimTextPreviewCapture', sessionId: message.sessionId, route },
            {
              id: 'extension',
              frameId: 0,
              documentId: `source-document-${tabId}`,
              url: route,
              tab: { id: tabId, windowId: 1, url: route, status: 'complete' },
            } as chrome.runtime.MessageSender
          )) as { success?: boolean };
          return { accepted: claim.success === true };
        }),
      },
      windows: {
        create: vi.fn(async () => {
          const windowId = 100 + sequence;
          const tabId = 200 + sequence;
          pageTabs.set(tabId, { windowId, url: currentTarget.route });
          return { id: windowId, tabs: [{ id: tabId, windowId, url: currentTarget.route }] };
        }),
        remove: vi.fn(async () => undefined),
      },
    } as unknown as typeof chrome;
    const controller = new TextPreviewController({
      chrome: chromeApi,
      settings: async () =>
        ({
          enableAutoScroll: false,
          enableToolContent: false,
          enableChatGptOpaqueReplay: false,
        }) as ExtensionSettings,
      isUi: async () => true,
      uiSource: async () => currentTarget,
      reserveSource: async tabId => {
        if (reserved.has(tabId)) return false;
        reserved.add(tabId);
        return true;
      },
      releaseSource: async tabId => {
        reserved.delete(tabId);
      },
      abortStage: async () => true,
      now: () => clock,
      random: () => {
        sequence += 1;
        return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
      },
      delay: async () => undefined,
    });
    const start = async (tabId: number) => {
      const route = `https://chatgpt.com/c/thread-${tabId}`;
      currentTarget = { tabId, route, platform: 'chatgpt', title: 'Private' };
      return controller.handle(
        {
          action: 'startTextPreview',
          expectedTarget: { tabId, route },
          branchMode: 'current',
        },
        uiSender()
      );
    };
    for (let tabId = 1; tabId <= 4; tabId += 1)
      await expect(start(tabId)).resolves.toMatchObject({ success: true });
    await expect(start(5)).resolves.toEqual({
      success: false,
      error: 'text-preview-unavailable',
    });
    expect(chromeApi.windows.create).toHaveBeenCalledTimes(4);
    clock += 15 * 60_000 + 1;
    await expect(start(5)).resolves.toMatchObject({ success: true });
  });

  it('repairs an ignored create URL before registering the page and claiming the source', async () => {
    const h = harness();
    await expect(h.start()).resolves.toEqual({
      success: true,
      sessionId: SESSION,
      state: 'capturing',
      captureExpiresAt: 301_000,
      expiresAt: 901_000,
    });
    expect(h.chrome.windows.create).toHaveBeenCalledWith({
      url: `chrome-extension://extension/src/text-preview/text-preview.html?session=${SESSION}`,
      type: 'popup',
      focused: false,
      width: 980,
      height: 760,
    });
    expect(h.chrome.tabs.update).toHaveBeenCalledExactlyOnceWith(PAGE_TAB, {
      url: `chrome-extension://extension/src/text-preview/text-preview.html?session=${SESSION}`,
      active: true,
    });
    expect(h.chrome.tabs.get).toHaveBeenCalledWith(PAGE_TAB);
    const claim = await h.controller.handle(
      { action: 'claimTextPreviewCapture', sessionId: SESSION, route: ROUTE },
      h.source
    );
    expect(claim).toEqual({ success: false, error: 'text-preview-unavailable' });
    const beginCall = h.sendMessage.mock.calls.find(
      ([, message]) => message.action === 'beginTextPreviewCapture'
    );
    expect(beginCall?.[1]).toEqual({
      action: 'beginTextPreviewCapture',
      sessionId: SESSION,
      route: ROUTE,
      branchMode: 'current',
    });
    expect(JSON.stringify(beginCall)).not.toContain('must-not-cross');
    expect(JSON.stringify(beginCall)).not.toContain('127.0.0.1');
  });

  it('accepts Comet scheme normalization while keeping the exact page capability', async () => {
    const h = harness({ claim: false });
    const expectedUrl = textPreviewPageUrl(h.chrome.runtime, SESSION);
    const cometUrl = expectedUrl.replace('chrome-extension://', 'comet-extension://');
    vi.mocked(h.chrome.tabs.update).mockResolvedValueOnce({
      id: PAGE_TAB,
      windowId: PAGE_WINDOW,
      url: cometUrl,
      status: 'loading',
    });
    vi.mocked(h.chrome.tabs.get).mockResolvedValueOnce({
      id: PAGE_TAB,
      windowId: PAGE_WINDOW,
      url: cometUrl,
      status: 'complete',
    });

    await expect(h.start()).resolves.toMatchObject({
      success: true,
      sessionId: SESSION,
      state: 'pending',
    });
    expect(h.chrome.windows.remove).not.toHaveBeenCalled();
    await expect(
      h.controller.handle(
        { action: 'getTextPreviewStatus', sessionId: SESSION },
        h.page({
          url: cometUrl,
          tab: {
            id: PAGE_TAB,
            windowId: PAGE_WINDOW,
            url: cometUrl,
            status: 'complete',
          },
        })
      )
    ).resolves.toMatchObject({ success: true, state: 'pending' });
    await h.controller.tabChanged(PAGE_TAB, { url: cometUrl, status: 'complete' });
    await expect(
      h.controller.handle(
        { action: 'getTextPreviewStatus', sessionId: SESSION },
        h.page({
          url: cometUrl,
          tab: {
            id: PAGE_TAB,
            windowId: PAGE_WINDOW,
            url: cometUrl,
            status: 'complete',
          },
        })
      )
    ).resolves.toMatchObject({ success: true, state: 'pending' });
  });

  it('waits for exact committed navigation when Comet returns the stale page from update', async () => {
    const h = harness({ claim: false });
    const expectedUrl = textPreviewPageUrl(h.chrome.runtime, SESSION);
    vi.mocked(h.chrome.tabs.update).mockResolvedValueOnce({
      id: PAGE_TAB,
      windowId: PAGE_WINDOW,
      url: ROUTE,
      status: 'loading',
    });
    vi.mocked(h.chrome.tabs.get)
      .mockResolvedValueOnce({
        id: PAGE_TAB,
        windowId: PAGE_WINDOW,
        url: ROUTE,
        status: 'complete',
      })
      .mockResolvedValueOnce({
        id: PAGE_TAB,
        windowId: PAGE_WINDOW,
        url: expectedUrl,
        status: 'loading',
      })
      .mockResolvedValueOnce({
        id: PAGE_TAB,
        windowId: PAGE_WINDOW,
        url: expectedUrl,
        status: 'complete',
      });

    await expect(h.start()).resolves.toMatchObject({
      success: true,
      sessionId: SESSION,
      state: 'pending',
    });
    expect(h.chrome.tabs.get).toHaveBeenCalledTimes(3);
    expect(h.chrome.windows.remove).not.toHaveBeenCalled();
    expect(h.sendMessage).toHaveBeenCalledExactlyOnceWith(
      SOURCE_TAB,
      {
        action: 'beginTextPreviewCapture',
        sessionId: SESSION,
        route: ROUTE,
        branchMode: 'current',
      },
      { frameId: 0 }
    );
  });

  it.each(['rejects', 'wrong-url', 'missing-url', 'missing-api'] as const)(
    'rolls back before source capture when explicit page navigation %s',
    async failure => {
      const h = harness();
      if (failure === 'rejects') {
        vi.mocked(h.chrome.tabs.update).mockRejectedValueOnce(new Error('navigation rejected'));
      } else if (failure === 'wrong-url') {
        vi.mocked(h.chrome.tabs.update).mockResolvedValueOnce({
          id: PAGE_TAB,
          windowId: PAGE_WINDOW,
          url: ROUTE,
        });
      } else if (failure === 'missing-url') {
        vi.mocked(h.chrome.tabs.update).mockResolvedValueOnce({
          id: PAGE_TAB,
          windowId: PAGE_WINDOW,
        });
      } else {
        (h.chrome.tabs as unknown as { update?: unknown }).update = undefined;
      }
      await expect(h.start()).resolves.toEqual({
        success: false,
        error: 'text-preview-unavailable',
        failureStep:
          failure === 'rejects'
            ? 'navigation-request'
            : failure === 'missing-api'
              ? 'navigation-api'
              : 'navigation-current',
      });
      expect(h.releaseSource).toHaveBeenCalledWith(SOURCE_TAB);
      expect(h.chrome.windows.remove).toHaveBeenCalledWith(PAGE_WINDOW);
      expect(h.sendMessage).not.toHaveBeenCalled();
    }
  );

  it('rolls back when the current page tab races away after a successful update', async () => {
    const h = harness();
    vi.mocked(h.chrome.tabs.get).mockResolvedValue({
      id: PAGE_TAB,
      windowId: PAGE_WINDOW,
      url: ROUTE,
    });
    await expect(h.start()).resolves.toEqual({
      success: false,
      error: 'text-preview-unavailable',
      failureStep: 'navigation-current',
    });
    expect(h.chrome.windows.remove).toHaveBeenCalledWith(PAGE_WINDOW);
    expect(h.sendMessage).not.toHaveBeenCalled();
  });

  it('returns only the three required booleans in the capture claim', async () => {
    const h = harness({ claim: false });
    await h.start();
    const claim = await h.controller.handle(
      { action: 'claimTextPreviewCapture', sessionId: SESSION, route: ROUTE },
      h.source
    );
    expect(claim).toEqual({
      success: true,
      sessionId: SESSION,
      branchMode: 'current',
      expiresAt: 301_000,
      settings: {
        enableAutoScroll: true,
        enableToolContent: false,
        enableChatGptOpaqueReplay: true,
      },
    });
    expect(JSON.stringify(claim)).not.toContain('obsidian');
    expect(JSON.stringify(claim)).not.toContain('vault');
    expect(JSON.stringify(claim)).not.toContain('ApiKey');
  });

  it('returns fixed not-ready to a page that races registration', async () => {
    const h = harness({ claim: false });
    let resolveWindow!: (value: chrome.windows.Window) => void;
    vi.mocked(h.chrome.windows.create).mockImplementationOnce(
      () => new Promise(resolve => (resolveWindow = resolve))
    );
    const starting = h.start();
    await vi.waitFor(() => expect(h.chrome.windows.create).toHaveBeenCalledOnce());
    await expect(
      h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page())
    ).resolves.toEqual({ success: false, error: 'text-preview-not-ready' });
    resolveWindow({ id: PAGE_WINDOW, tabs: [{ id: PAGE_TAB }] } as chrome.windows.Window);
    await starting;
  });

  it('keeps a fast navigated page not-ready until its current URL is verified and registered', async () => {
    const h = harness();
    let resolveCurrent!: (tab: chrome.tabs.Tab) => void;
    vi.mocked(h.chrome.tabs.get).mockImplementationOnce(
      () => new Promise(resolve => (resolveCurrent = resolve))
    );
    const starting = h.start();
    await vi.waitFor(() => expect(h.chrome.tabs.update).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(resolveCurrent).toBeTypeOf('function'));
    const expectedUrl = textPreviewPageUrl(h.chrome.runtime, SESSION);
    await h.controller.tabChanged(PAGE_TAB, { url: expectedUrl, status: 'loading' });
    await expect(
      h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page())
    ).resolves.toEqual({ success: false, error: 'text-preview-not-ready' });
    resolveCurrent({
      id: PAGE_TAB,
      windowId: PAGE_WINDOW,
      url: expectedUrl,
      status: 'loading',
    });
    await expect(starting).resolves.toMatchObject({ success: true, state: 'capturing' });
  });

  it('admits only one winner in concurrent claim and publish races', async () => {
    const claims = harness({ claim: false });
    await claims.start();
    const claimResults = await Promise.all([
      claims.controller.handle(
        { action: 'claimTextPreviewCapture', sessionId: SESSION, route: ROUTE },
        claims.source
      ),
      claims.controller.handle(
        { action: 'claimTextPreviewCapture', sessionId: SESSION, route: ROUTE },
        claims.source
      ),
    ]);
    expect(claimResults.filter(result => (result as { success?: boolean }).success)).toHaveLength(
      1
    );
    const published = await Promise.all([
      claims.controller.handle(
        { action: 'publishTextPreview', sessionId: SESSION, payload: payload() },
        claims.source
      ),
      claims.controller.handle(
        {
          action: 'publishTextPreview',
          sessionId: SESSION,
          payload: { ...payload(), title: 'must-not-replace' },
        },
        claims.source
      ),
    ]);
    expect(published.filter(result => (result as { success?: boolean }).success)).toHaveLength(1);
  });

  it.each([
    ['copied URL in another tab', { tab: { id: 71, windowId: PAGE_WINDOW } }],
    ['wrong window', { tab: { id: PAGE_TAB, windowId: 701 } }],
    [
      'wrong URL',
      {
        url: `chrome-extension://extension/src/text-preview/text-preview.html?session=${DELIVERY}`,
      },
    ],
  ])('rejects page authority from %s', async (_label, overrides) => {
    const h = harness();
    await h.start();
    await expect(
      h.controller.handle(
        { action: 'getTextPreviewStatus', sessionId: SESSION },
        h.page(overrides as Partial<chrome.runtime.MessageSender>)
      )
    ).resolves.toEqual({ success: false, error: 'text-preview-not-ready' });
  });

  it('pins the first preview document and rejects a same-tab replacement document', async () => {
    const h = harness();
    await h.start();
    await expect(
      h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page())
    ).resolves.toMatchObject({ success: true, state: 'capturing' });
    await expect(
      h.controller.handle(
        { action: 'getTextPreviewStatus', sessionId: SESSION },
        h.page({ documentId: 'preview-document-2' })
      )
    ).resolves.toEqual({ success: false, error: 'text-preview-not-ready' });
  });

  it('lets the exact page clear the lease without granting it capture authority', async () => {
    const h = harness();
    await h.start();
    await h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page());
    await expect(
      h.controller.handle(
        { action: 'invalidateTextPreview', sessionId: SESSION, reason: 'clear' },
        h.page()
      )
    ).resolves.toEqual({ success: true });
    await expect(
      h.controller.authorizeCaptureAction(
        { action: 'captureChatGptConversation' },
        SESSION,
        h.source
      )
    ).resolves.toBe(false);
    expect(h.releaseSource).toHaveBeenCalledWith(SOURCE_TAB);
  });

  it('reclaims a cleared lease on the short terminal deadline after its page closes', async () => {
    const h = harness({ claim: false });
    await h.start();
    await h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page());
    await h.controller.handle(
      { action: 'invalidateTextPreview', sessionId: SESSION, reason: 'clear' },
      h.page()
    );
    await h.controller.tabRemoved(PAGE_TAB);

    h.now.value += 29_999;
    await expect(
      h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page())
    ).resolves.toMatchObject({ success: true, state: 'invalidated' });
    h.now.value += 1;
    await expect(
      h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page())
    ).resolves.toEqual({ success: false, error: 'text-preview-not-ready' });
    await expect(h.start()).resolves.toMatchObject({ success: true });
  });

  it('publishes once, takes once, and makes only the exact ACK idempotent', async () => {
    const h = harness();
    await h.start();
    await h.controller.recordCaptureResult(
      SESSION,
      { success: true, stageId: STAGE_ID },
      { action: 'beginStagedArchiveArtifact', source: 'chatgpt' },
      h.source
    );
    await expect(
      h.controller.handle(
        { action: 'publishTextPreview', sessionId: SESSION, payload: payload() },
        h.source
      )
    ).resolves.toEqual({ success: true });
    expect(h.abortStage).toHaveBeenCalledWith('chatgpt', STAGE_ID);
    expect(h.releaseSource).toHaveBeenCalledWith(SOURCE_TAB);
    await expect(
      h.controller.handle(
        {
          action: 'publishTextPreview',
          sessionId: SESSION,
          payload: { ...payload(), title: 'replace' },
        },
        h.source
      )
    ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
    const taken = (await h.controller.handle(
      { action: 'takeTextPreviewPayload', sessionId: SESSION },
      h.page()
    )) as Record<string, unknown>;
    expect(taken).toMatchObject({ success: true, deliveryId: DELIVERY, payload: payload() });
    await expect(
      h.controller.handle({ action: 'takeTextPreviewPayload', sessionId: SESSION }, h.page())
    ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
    await expect(
      h.controller.handle(
        { action: 'ackTextPreviewPayload', sessionId: SESSION, deliveryId: SELECTION },
        h.page()
      )
    ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
    for (let index = 0; index < 2; index += 1) {
      await expect(
        h.controller.handle(
          { action: 'ackTextPreviewPayload', sessionId: SESSION, deliveryId: DELIVERY },
          h.page()
        )
      ).resolves.toEqual({ success: true });
    }
  });

  it('adopts the detached payload strictly before storing it', async () => {
    const h = harness();
    await h.start();
    await expect(
      h.controller.handle(
        {
          action: 'publishTextPreview',
          sessionId: SESSION,
          payload: { ...payload(), privateExtra: 'not admitted' },
        },
        h.source
      )
    ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
    await expect(
      h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page())
    ).resolves.toEqual({ success: true, state: 'capturing', expiresAt: 901_000 });
  });

  it('fails closed after a lost take and after the absolute page lease', async () => {
    const h = harness();
    await h.start();
    await h.controller.handle(
      { action: 'publishTextPreview', sessionId: SESSION, payload: payload() },
      h.source
    );
    await h.controller.handle({ action: 'takeTextPreviewPayload', sessionId: SESSION }, h.page());
    h.now.value += 30_001;
    await expect(
      h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page())
    ).resolves.toMatchObject({ success: true, state: 'invalidated' });
    await expect(
      h.controller.handle(
        { action: 'ackTextPreviewPayload', sessionId: SESSION, deliveryId: DELIVERY },
        h.page()
      )
    ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
    h.now.value += 15 * 60_000;
    await expect(
      h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page())
    ).resolves.toEqual({ success: false, error: 'text-preview-not-ready' });
  });

  it('expires pending and capture phases at their independent deadlines', async () => {
    const pending = harness({ claim: false });
    await pending.start();
    pending.now.value += 30_001;
    await expect(
      pending.controller.handle(
        { action: 'getTextPreviewStatus', sessionId: SESSION },
        pending.page()
      )
    ).resolves.toMatchObject({ success: true, state: 'invalidated' });

    const capturing = harness();
    await capturing.start();
    capturing.now.value += 5 * 60_000 + 1;
    await expect(
      capturing.controller.handle(
        { action: 'getTextPreviewStatus', sessionId: SESSION },
        capturing.page()
      )
    ).resolves.toMatchObject({ success: true, state: 'invalidated' });
  });

  it('does not claim after a stalled settings read crosses the pending deadline', async () => {
    let resolveSettings!: (settings: ExtensionSettings) => void;
    const settingsStarted = vi.fn();
    const h = harness({
      claim: false,
      settings: () => {
        settingsStarted();
        return new Promise(resolve => (resolveSettings = resolve));
      },
    });
    await expect(h.start()).resolves.toEqual({
      success: true,
      sessionId: SESSION,
      state: 'pending',
      captureExpiresAt: 31_000,
      expiresAt: 901_000,
    });
    const claim = h.controller.handle(
      { action: 'claimTextPreviewCapture', sessionId: SESSION, route: ROUTE },
      h.source
    );
    await vi.waitFor(() => expect(settingsStarted).toHaveBeenCalledOnce());
    h.now.value = 31_001;
    resolveSettings({
      enableAutoScroll: true,
      enableToolContent: false,
      enableChatGptOpaqueReplay: false,
    } as ExtensionSettings);
    await expect(claim).resolves.toEqual({
      success: false,
      error: 'text-preview-unavailable',
    });
  });

  it('does not renew the capture deadline through lease polling', async () => {
    const h = harness();
    await h.start();
    for (const now of [2_000, 100_000, 300_999]) {
      h.now.value = now;
      await expect(
        h.controller.handle(
          { action: 'checkTextPreviewCaptureLease', sessionId: SESSION },
          h.source
        )
      ).resolves.toEqual({ success: true, live: true, expiresAt: 301_000 });
    }
    h.now.value = 301_000;
    await expect(
      h.controller.handle({ action: 'checkTextPreviewCaptureLease', sessionId: SESSION }, h.source)
    ).resolves.toEqual({
      success: false,
      live: false,
      error: 'text-preview-capture-expired',
    });
    await expect(
      h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page())
    ).resolves.toEqual({ success: true, state: 'invalidated', expiresAt: 901_000 });
  });

  it('does not enter selection after an awaited tab check crosses the capture deadline', async () => {
    const h = harness();
    await h.start('selected');
    let resolveTab!: (tab: chrome.tabs.Tab) => void;
    vi.mocked(h.chrome.tabs.get).mockImplementationOnce(
      () => new Promise(resolve => (resolveTab = resolve))
    );
    const selection = h.controller.handle(
      {
        action: 'awaitTextPreviewSelection',
        sessionId: SESSION,
        selectionId: crypto.randomUUID(),
        options: [{ ordinal: 1, messageCount: 1, uniqueMessageCount: 1, isCurrent: true }],
      },
      h.source
    );
    await vi.waitFor(() => expect(resolveTab).toBeTypeOf('function'));
    h.now.value = 301_001;
    resolveTab(h.source.tab!);
    await expect(selection).resolves.toEqual({
      success: false,
      error: 'text-preview-unavailable',
    });
  });

  it('does not publish when background cleanup crosses the capture deadline', async () => {
    const h = harness();
    await h.start();
    await h.controller.recordCaptureResult(
      SESSION,
      { success: true, stageId: STAGE_ID },
      { action: 'beginStagedArchiveArtifact', source: 'chatgpt' },
      h.source
    );
    let resolveCleanup!: (cleaned: boolean) => void;
    h.abortStage.mockImplementationOnce(() => new Promise(resolve => (resolveCleanup = resolve)));
    const publishing = h.controller.handle(
      { action: 'publishTextPreview', sessionId: SESSION, payload: payload() },
      h.source
    );
    await vi.waitFor(() => expect(resolveCleanup).toBeTypeOf('function'));
    h.now.value = 301_001;
    resolveCleanup(true);
    await expect(publishing).resolves.toEqual({
      success: false,
      error: 'text-preview-unavailable',
    });
    await expect(
      h.controller.handle({ action: 'takeTextPreviewPayload', sessionId: SESSION }, h.page())
    ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
  });

  it('allows only the explicit capture-stage matrix and retains exact cleanup after navigation', async () => {
    const h = harness();
    await h.start();
    await expect(
      h.controller.authorizeCaptureAction(
        { action: 'captureChatGptConversation' },
        SESSION,
        h.source
      )
    ).resolves.toBe(true);
    for (const action of [
      'probeChatGptOpaqueRequest',
      'resolveChatGptActiveAsset',
      'fetchImage',
      'testConnection',
      'saveToOutputs',
      'persistArchiveCompanion',
      'beginStagedBinaryAsset',
    ]) {
      await expect(
        h.controller.authorizeCaptureAction({ action }, SESSION, h.source)
      ).resolves.toBe(false);
    }
    const stageId = STAGE_ID;
    await h.controller.recordCaptureResult(
      SESSION,
      { success: true, stageId },
      { action: 'beginStagedArchiveArtifact' },
      h.source
    );
    await h.controller.tabChanged(SOURCE_TAB, { status: 'loading' });
    await expect(
      h.controller.authorizeCaptureAction(
        { action: 'appendStagedArchiveArtifact', source: 'chatgpt', stageId },
        SESSION,
        h.source
      )
    ).resolves.toBe(false);
    await expect(
      h.controller.authorizeCaptureAction(
        { action: 'abortStagedArchiveArtifact', source: 'chatgpt', stageId },
        SESSION,
        h.source
      )
    ).resolves.toBe(false);
    expect(h.abortStage).toHaveBeenCalledWith('chatgpt', stageId);
  });

  it.each(['invalidation', 'source-close', 'capture-expiry', 'page-lease-removal'] as const)(
    'uses background-owned stage cleanup after %s without a surviving content sender',
    async terminal => {
      const h = harness();
      await h.start();
      await h.controller.recordCaptureResult(
        SESSION,
        { success: true, stageId: STAGE_ID },
        { action: 'beginStagedArchiveArtifact', source: 'chatgpt' },
        h.source
      );
      if (terminal === 'invalidation') {
        await h.controller.handle(
          { action: 'invalidateTextPreview', sessionId: SESSION, reason: 'clear' },
          h.page()
        );
      } else if (terminal === 'source-close') {
        await h.controller.tabRemoved(SOURCE_TAB);
      } else {
        h.now.value += terminal === 'capture-expiry' ? 5 * 60_000 + 1 : 15 * 60_000 + 1;
        await h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page());
      }
      expect(h.abortStage).toHaveBeenCalledWith('chatgpt', STAGE_ID);
    }
  );

  it('aborts a late successful stage after terminal transition and retains failed cleanup for retry', async () => {
    const h = harness();
    await h.start();
    await h.controller.handle(
      { action: 'invalidateTextPreview', sessionId: SESSION, reason: 'clear' },
      h.page()
    );
    h.abortStage.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await h.controller.recordCaptureResult(
      SESSION,
      { success: true, stageId: STAGE_ID },
      { action: 'beginStagedArchiveArtifact', source: 'chatgpt' },
      h.source
    );
    expect(h.abortStage).toHaveBeenNthCalledWith(1, 'chatgpt', STAGE_ID);
    await h.controller.tabRemoved(PAGE_TAB);
    expect(h.abortStage).toHaveBeenNthCalledWith(2, 'chatgpt', STAGE_ID);
  });

  it('keeps a cleanup-only tombstone for a late stage result after page-lease removal', async () => {
    const h = harness();
    await h.start();
    h.now.value += 15 * 60_000 + 1;
    await h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page());
    h.now.value += 30_001;
    await h.controller.recordCaptureResult(
      SESSION,
      { success: true, stageId: STAGE_ID },
      { action: 'beginStagedArchiveArtifact', source: 'chatgpt' },
      h.source
    );
    expect(h.abortStage).toHaveBeenCalledWith('chatgpt', STAGE_ID);
  });

  it('revokes a privileged dispatch when navigation wins its awaited tab check', async () => {
    const h = harness();
    await h.start();
    const callsBefore = vi.mocked(h.chrome.tabs.get).mock.calls.length;
    let resolveTab!: (value: chrome.tabs.Tab) => void;
    vi.mocked(h.chrome.tabs.get).mockImplementationOnce(
      () => new Promise(resolve => (resolveTab = resolve))
    );
    const authorization = h.controller.authorizeCaptureAction(
      { action: 'captureChatGptConversation' },
      SESSION,
      h.source
    );
    await vi.waitFor(() => expect(h.chrome.tabs.get).toHaveBeenCalledTimes(callsBefore + 1));
    const navigation = h.controller.tabChanged(SOURCE_TAB, { status: 'loading' });
    resolveTab(h.source.tab!);
    await expect(authorization).resolves.toBe(false);
    await navigation;
  });

  it('admits ChatGPT selected choice by exact ordinal and never admits all', async () => {
    const h = harness();
    await h.start('selected');
    const options = [{ ordinal: 1, messageCount: 2, uniqueMessageCount: 2, isCurrent: true }];
    const contentSelectionId = crypto.randomUUID();
    await expect(
      h.controller.handle(
        {
          action: 'awaitTextPreviewSelection',
          sessionId: SESSION,
          selectionId: contentSelectionId,
          options,
        },
        h.source
      )
    ).resolves.toEqual({ success: true });
    const picker = (await h.controller.handle(
      { action: 'getTextPreviewBranchOptions', sessionId: SESSION },
      uiSender()
    )) as { success: true; state: string; selectionId: string; options: unknown };
    expect(picker).toEqual({
      success: true,
      state: 'awaiting-selection',
      selectionId: expect.any(String),
      options,
    });
    await expect(
      h.controller.handle(
        {
          action: 'chooseTextPreviewBranch',
          sessionId: SESSION,
          selectionId: picker.selectionId,
          choice: 'all',
        },
        uiSender()
      )
    ).resolves.toEqual({ success: false, error: 'text-preview-invalid-message' });
    await expect(
      h.controller.handle(
        {
          action: 'chooseTextPreviewBranch',
          sessionId: SESSION,
          selectionId: picker.selectionId,
          choice: 1,
        },
        uiSender()
      )
    ).resolves.toEqual({ success: true });
  });

  it('does not apply a branch choice when validation crosses the capture deadline', async () => {
    const h = harness();
    await h.start('selected');
    const selectionId = crypto.randomUUID();
    await h.controller.handle(
      {
        action: 'awaitTextPreviewSelection',
        sessionId: SESSION,
        selectionId,
        options: [{ ordinal: 1, messageCount: 1, uniqueMessageCount: 1, isCurrent: true }],
      },
      h.source
    );
    const picker = (await h.controller.handle(
      { action: 'getTextPreviewBranchOptions', sessionId: SESSION },
      uiSender()
    )) as { selectionId: string };
    let resolveValidation!: (response: { accepted: boolean }) => void;
    h.sendMessage.mockImplementationOnce(
      () => new Promise(resolve => (resolveValidation = resolve))
    );
    const choosing = h.controller.handle(
      {
        action: 'chooseTextPreviewBranch',
        sessionId: SESSION,
        selectionId: picker.selectionId,
        choice: 1,
      },
      uiSender()
    );
    await vi.waitFor(() => expect(resolveValidation).toBeTypeOf('function'));
    h.now.value = 301_001;
    resolveValidation({ accepted: true });
    await expect(choosing).resolves.toEqual({
      success: false,
      error: 'text-preview-unavailable',
    });
    expect(
      h.sendMessage.mock.calls.some(([, message]) => message.action === 'applyTextPreviewChoice')
    ).toBe(false);
  });

  it('rejects DeepSeek selected before opening a page', async () => {
    const h = harness({ platform: 'deepseek' });
    await expect(h.start('selected')).resolves.toEqual({
      success: false,
      error: 'text-preview-unavailable',
    });
    expect(h.chrome.windows.create).not.toHaveBeenCalled();
    expect(h.reserveSource).not.toHaveBeenCalled();
  });

  it('treats a worker restart as an unknown session with no storage recovery', async () => {
    const h = harness();
    await h.start();
    const restarted = new TextPreviewController({
      chrome: h.chrome,
      settings: async () => ({}) as ExtensionSettings,
      isUi: async () => true,
      uiSource: async () => h.target,
      reserveSource: async () => true,
      releaseSource: async () => undefined,
      abortStage: async () => true,
      now: () => h.now.value,
      random: () => SESSION,
    });
    await expect(
      restarted.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page())
    ).resolves.toEqual({ success: false, error: 'text-preview-not-ready' });
  });

  it('does not reserve or open a preview for an untrusted UI', async () => {
    const h = harness({ isUi: async () => false });
    await expect(h.start()).resolves.toEqual({
      success: false,
      error: 'text-preview-unavailable',
    });
    expect(h.reserveSource).not.toHaveBeenCalled();
    expect(h.chrome.windows.create).not.toHaveBeenCalled();
  });

  it('releases a reservation if session randomness is invalid', async () => {
    const h = harness({ random: () => 'unavailable' });
    await expect(h.start()).resolves.toEqual({
      success: false,
      error: 'text-preview-unavailable',
    });
    expect(h.releaseSource).toHaveBeenCalledWith(SOURCE_TAB);
    expect(h.chrome.windows.create).not.toHaveBeenCalled();
  });

  it.each(['missing-tab', 'create-rejected', 'source-declined', 'send-rejected'] as const)(
    'releases failed startup ownership after %s and tolerates a failed window close',
    async failure => {
      const h = harness({ claim: false });
      if (failure === 'missing-tab')
        vi.mocked(h.chrome.windows.create).mockResolvedValueOnce({ id: PAGE_WINDOW });
      if (failure === 'create-rejected')
        vi.mocked(h.chrome.windows.create).mockRejectedValueOnce(new Error('Window unavailable'));
      if (failure === 'source-declined') h.sendMessage.mockResolvedValueOnce({ accepted: false });
      if (failure === 'send-rejected')
        h.sendMessage.mockRejectedValueOnce(new Error('Source disappeared'));
      vi.mocked(h.chrome.windows.remove).mockRejectedValueOnce(new Error('Already closed'));
      await expect(h.start()).resolves.toEqual({
        success: false,
        error: 'text-preview-unavailable',
        failureStep:
          failure === 'missing-tab'
            ? 'window-shape'
            : failure === 'create-rejected'
              ? 'window-create'
              : 'source-accept',
      });
      expect(h.releaseSource).toHaveBeenCalledExactlyOnceWith(SOURCE_TAB);
      expect(h.chrome.windows.remove).toHaveBeenCalledTimes(failure === 'create-rejected' ? 0 : 1);
      await expect(
        h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page())
      ).resolves.toEqual({ success: false, error: 'text-preview-not-ready' });
    }
  );

  it('closes a window that finishes opening after its pending registration expired', async () => {
    const h = harness({ claim: false });
    let opened!: (window: chrome.windows.Window) => void;
    vi.mocked(h.chrome.windows.create).mockImplementationOnce(
      () => new Promise(resolve => (opened = resolve))
    );
    const starting = h.start();
    await vi.waitFor(() => expect(opened).toBeTypeOf('function'));
    h.now.value = 31_001;
    opened({ id: PAGE_WINDOW, tabs: [{ id: PAGE_TAB }] } as chrome.windows.Window);
    await expect(starting).resolves.toEqual({
      success: false,
      error: 'text-preview-unavailable',
      failureStep: 'page-registration',
    });
    expect(h.chrome.windows.remove).toHaveBeenCalledWith(PAGE_WINDOW);
    expect(h.sendMessage).not.toHaveBeenCalled();
    expect(h.releaseSource).toHaveBeenCalledExactlyOnceWith(SOURCE_TAB);
  });

  it.each(['first', 'last'] as const)(
    'does not claim a source missing at the %s current-tab check',
    async check => {
      const h = harness({ claim: false });
      await h.start();
      if (check === 'last') vi.mocked(h.chrome.tabs.get).mockResolvedValueOnce(h.source.tab!);
      vi.mocked(h.chrome.tabs.get).mockRejectedValueOnce(new Error('Tab closed'));
      await expect(
        h.controller.handle(
          { action: 'claimTextPreviewCapture', sessionId: SESSION, route: ROUTE },
          h.source
        )
      ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
      await expect(
        h.controller.handle(
          { action: 'checkTextPreviewCaptureLease', sessionId: SESSION },
          h.source
        )
      ).resolves.toMatchObject({ success: false, live: false });
    }
  );

  it('does not accept capture authority from a missing or foreign source document', async () => {
    const h = harness({ claim: false });
    await h.start();
    for (const sender of [
      { ...h.source, documentId: undefined },
      { ...h.source, url: 'https://chat.deepseek.com/a/chat/s/thread' },
    ]) {
      await expect(
        h.controller.handle(
          { action: 'claimTextPreviewCapture', sessionId: SESSION, route: ROUTE },
          sender
        )
      ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
    }
  });

  it('retries thrown stage cleanup through a closed-page tombstone and expires it', async () => {
    const h = harness();
    await h.start();
    await h.controller.recordCaptureResult(
      SESSION,
      { success: true, stageId: STAGE_ID },
      { action: 'beginStagedArchiveArtifact', source: 'chatgpt' },
      h.source
    );
    h.abortStage
      .mockRejectedValueOnce(new Error('Worker stopped'))
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    h.sendMessage.mockRejectedValueOnce(new Error('Source already gone'));
    await h.controller.tabRemoved(PAGE_TAB);
    expect(h.abortStage).toHaveBeenCalledTimes(1);
    h.now.value += 30_001;
    await h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page());
    expect(h.abortStage).toHaveBeenCalledTimes(2);
    await h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page());
    expect(h.abortStage).toHaveBeenCalledTimes(3);
    h.now.value += 5 * 60_000 + 1;
    await h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page());
    expect(h.abortStage).toHaveBeenCalledTimes(4);
    await h.controller.recordCaptureResult(
      SESSION,
      { success: true, stageId: STAGE_ID },
      { action: 'beginStagedArchiveArtifact', source: 'chatgpt' },
      h.source
    );
    expect(h.abortStage).toHaveBeenCalledTimes(4);
  });

  it('retries a late nested capture stage but ignores a mismatched tombstone source', async () => {
    const h = harness();
    await h.start();
    h.now.value = 901_001;
    await h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page());
    await h.controller.recordCaptureResult(
      SESSION,
      { success: true, stageId: STAGE_ID },
      { action: 'beginStagedArchiveArtifact', source: 'deepseek' },
      h.source
    );
    expect(h.abortStage).not.toHaveBeenCalled();
    h.abortStage.mockResolvedValueOnce(false);
    await h.controller.recordCaptureResult(
      SESSION,
      { success: true, data: { stageId: STAGE_ID } },
      { action: 'captureChatGptConversation' },
      h.source
    );
    expect(h.abortStage).toHaveBeenCalledExactlyOnceWith('chatgpt', STAGE_ID);
    await h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page());
    expect(h.abortStage).toHaveBeenCalledTimes(2);
    await h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page());
    expect(h.abortStage).toHaveBeenCalledTimes(2);
  });

  it('releases a stage only after a successful explicit abort result', async () => {
    const h = harness();
    await h.start();
    const staged = { action: 'beginStagedArchiveArtifact', source: 'chatgpt' };
    const cleanup = { action: 'abortStagedArchiveArtifact', source: 'chatgpt', stageId: STAGE_ID };
    await h.controller.recordCaptureResult(
      SESSION,
      { success: true, stageId: STAGE_ID },
      staged,
      h.source
    );
    await h.controller.recordCaptureResult(SESSION, { success: false }, cleanup, h.source);
    await expect(h.controller.authorizeCaptureAction(cleanup, SESSION, h.source)).resolves.toBe(
      true
    );
    await h.controller.recordCaptureResult(SESSION, { success: true }, cleanup, h.source);
    await expect(h.controller.authorizeCaptureAction(cleanup, SESSION, h.source)).resolves.toBe(
      false
    );
    await h.controller.tabRemoved(SOURCE_TAB);
    expect(h.abortStage).not.toHaveBeenCalled();
  });

  it('denies foreign platforms, stages, and a source that disappears at dispatch', async () => {
    const h = harness({ platform: 'deepseek' });
    await h.start();
    for (const message of [
      { action: 'captureChatGptConversation' },
      { action: 'beginStagedArchiveArtifact', source: 'chatgpt' },
      { action: 'readStagedArchiveArtifact', source: 'deepseek', stageId: STAGE_ID },
    ])
      await expect(h.controller.authorizeCaptureAction(message, SESSION, h.source)).resolves.toBe(
        false
      );
    await expect(
      h.controller.authorizeCaptureAction(
        { action: 'beginStagedArchiveArtifact', source: 'deepseek' },
        SESSION,
        { ...h.source, documentId: 'another-document' }
      )
    ).resolves.toBe(false);
    vi.mocked(h.chrome.tabs.get).mockRejectedValueOnce(new Error('Tab closed'));
    await expect(
      h.controller.authorizeCaptureAction(
        { action: 'beginStagedArchiveArtifact', source: 'deepseek' },
        SESSION,
        h.source
      )
    ).resolves.toBe(false);
    expect(h.releaseSource).toHaveBeenCalledWith(SOURCE_TAB);
  });

  it('rejects premature selections, wrong picker bindings, and stale ordinals', async () => {
    const h = harness();
    await h.start('selected');
    await expect(
      h.controller.handle({ action: 'getTextPreviewBranchOptions', sessionId: SESSION }, uiSender())
    ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
    const selection = {
      action: 'awaitTextPreviewSelection',
      sessionId: SESSION,
      selectionId: SELECTION,
      options: [{ ordinal: 1, messageCount: 1, uniqueMessageCount: 1, isCurrent: true }],
    };
    await expect(
      h.controller.handle(selection, { ...h.source, documentId: 'another-document' })
    ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
    await h.controller.handle(selection, h.source);
    const choice = {
      action: 'chooseTextPreviewBranch',
      sessionId: SESSION,
      selectionId: SELECTION,
      choice: 1,
    };
    await expect(
      h.controller.handle(choice, { ...uiSender(), documentId: 'another-ui-document' })
    ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
    await expect(h.controller.handle({ ...choice, choice: 2 }, uiSender())).resolves.toEqual({
      success: false,
      error: 'text-preview-unavailable',
    });
    expect(h.sendMessage).toHaveBeenCalledTimes(1);
  });

  it.each(['before-validation', 'after-validation', 'apply-rejected', 'after-apply'] as const)(
    'does not retain a branch choice when the source is unavailable %s',
    async failure => {
      const h = harness();
      await h.start('selected');
      await h.controller.handle(
        {
          action: 'awaitTextPreviewSelection',
          sessionId: SESSION,
          selectionId: SELECTION,
          options: [{ ordinal: 1, messageCount: 1, uniqueMessageCount: 1, isCurrent: true }],
        },
        h.source
      );
      if (failure === 'before-validation')
        vi.mocked(h.chrome.tabs.get).mockRejectedValueOnce(new Error('Tab closed'));
      if (failure === 'after-validation')
        h.sendMessage.mockImplementationOnce(async () => {
          vi.mocked(h.chrome.tabs.get).mockRejectedValueOnce(new Error('Tab closed'));
          return { accepted: true };
        });
      if (failure === 'apply-rejected')
        h.sendMessage
          .mockResolvedValueOnce({ accepted: true })
          .mockRejectedValueOnce(new Error('Content disconnected'));
      if (failure === 'after-apply')
        h.sendMessage.mockResolvedValueOnce({ accepted: true }).mockImplementationOnce(async () => {
          vi.mocked(h.chrome.tabs.get).mockRejectedValueOnce(new Error('Tab closed'));
          return { accepted: true };
        });
      await expect(
        h.controller.handle(
          {
            action: 'chooseTextPreviewBranch',
            sessionId: SESSION,
            selectionId: SELECTION,
            choice: 1,
          },
          uiSender()
        )
      ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
      await expect(
        h.controller.handle({ action: 'getTextPreviewStatus', sessionId: SESSION }, h.page())
      ).resolves.toMatchObject({
        state:
          failure === 'apply-rejected' || failure === 'after-apply'
            ? 'invalidated'
            : 'awaiting-selection',
      });
    }
  );

  it.each(['initial-tab', 'adoption-tab', 'cleanup-tab', 'release-race'] as const)(
    'does not publish across a source failure at %s',
    async failure => {
      const h = harness();
      await h.start();
      if (failure === 'initial-tab')
        vi.mocked(h.chrome.tabs.get).mockRejectedValueOnce(new Error('Tab closed'));
      if (failure === 'adoption-tab')
        vi.mocked(h.chrome.tabs.get)
          .mockResolvedValueOnce(h.source.tab!)
          .mockRejectedValueOnce(new Error('Tab closed'));
      if (failure === 'cleanup-tab')
        vi.mocked(h.chrome.tabs.get)
          .mockResolvedValueOnce(h.source.tab!)
          .mockResolvedValueOnce(h.source.tab!)
          .mockRejectedValueOnce(new Error('Tab closed'));
      let navigation: Promise<void> | undefined;
      if (failure === 'release-race')
        h.releaseSource.mockImplementationOnce(async () => {
          navigation = h.controller.tabChanged(SOURCE_TAB, { status: 'loading' });
        });
      await expect(
        h.controller.handle(
          { action: 'publishTextPreview', sessionId: SESSION, payload: payload() },
          h.source
        )
      ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
      await navigation;
      await expect(
        h.controller.handle({ action: 'takeTextPreviewPayload', sessionId: SESSION }, h.page())
      ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
    }
  );

  it('does not consume a ready payload when delivery randomness is invalid', async () => {
    const random = vi
      .fn()
      .mockReturnValueOnce(SESSION)
      .mockReturnValueOnce('invalid')
      .mockReturnValueOnce(DELIVERY);
    const h = harness({ random });
    await h.start();
    await h.controller.handle(
      { action: 'publishTextPreview', sessionId: SESSION, payload: payload() },
      h.source
    );
    await expect(
      h.controller.handle({ action: 'takeTextPreviewPayload', sessionId: SESSION }, h.page())
    ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
    await expect(
      h.controller.handle({ action: 'takeTextPreviewPayload', sessionId: SESSION }, h.page())
    ).resolves.toMatchObject({ success: true, deliveryId: DELIVERY, payload: payload() });
    await expect(
      h.controller.handle(
        { action: 'ackTextPreviewPayload', sessionId: SESSION, deliveryId: DELIVERY },
        h.page({ documentId: 'another-preview-document' })
      )
    ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
  });

  it('enforces distinct source-stop and page-clear reasons without revoking the valid lease', async () => {
    const h = harness();
    await h.start();
    for (const [sender, reason] of [
      [h.source, 'clear'],
      [h.page(), 'stop'],
      [{ ...h.source, documentId: 'another-source-document' }, 'stop'],
    ] as const)
      await expect(
        h.controller.handle({ action: 'invalidateTextPreview', sessionId: SESSION, reason }, sender)
      ).resolves.toEqual({ success: false, error: 'text-preview-unavailable' });
    expect(h.releaseSource).not.toHaveBeenCalled();
    await expect(
      h.controller.handle(
        { action: 'invalidateTextPreview', sessionId: SESSION, reason: 'stop' },
        h.source
      )
    ).resolves.toEqual({ success: true });
    expect(h.releaseSource).toHaveBeenCalledWith(SOURCE_TAB);
  });
});
