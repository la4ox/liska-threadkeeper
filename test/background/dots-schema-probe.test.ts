import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as outputHandlers from '../../src/background/output-handlers';
import {
  DOTS_SCHEMA_PROBE_ENDPOINTS,
  DOTS_SCHEMA_PROBE_FILE_NAME,
  DOTS_SCHEMA_PROBE_SCOPE,
  DOTS_SCHEMA_PROBE_SCHEMA,
} from '../../src/lib/dots-schema-probe-contract';
import {
  dotsSchemaProbeTargetUrl,
  isAuthorizedDotsSchemaProbeSender,
  isDotsSchemaProbeFailureCode,
  probeDotsSchemaInActiveTab,
  removeDotsSchemaProbeMarker,
} from '../../src/background/dots-schema-probe';

const initialChrome = chrome;

const TAB_ID = 41;
const DOCUMENT_ID = 'document_123456';
const NONCE = '01234567-89ab-4cde-8f01-23456789abcd';
const DOTS_URL = 'https://chatgpt.com/dots/dot_one~user_two';

function evidence() {
  return {
    schema: DOTS_SCHEMA_PROBE_SCHEMA,
    scope: { ...DOTS_SCHEMA_PROBE_SCOPE },
    endpoints: {
      roomMetadata: {
        method: 'GET' as const,
        pathPattern: DOTS_SCHEMA_PROBE_ENDPOINTS.roomMetadata,
        mediaType: 'application/json' as const,
        shape: { type: 'object' as const, fields: [], unknownProperties: 'present' as const },
      },
      roomMessages: {
        method: 'GET' as const,
        pathPattern: DOTS_SCHEMA_PROBE_ENDPOINTS.roomMessages,
        mediaType: 'application/json' as const,
        shape: {
          type: 'object' as const,
          fields: [
            {
              name: 'messages' as const,
              shape: { type: 'array' as const, itemShapes: 'unobserved' as const },
            },
          ],
          unknownProperties: 'none' as const,
        },
      },
    },
  };
}

type ScriptResult = { result?: unknown; documentId?: string; frameId?: number };
type ScriptInjection = {
  func: unknown;
  target: { tabId: number; frameIds?: [0]; documentIds?: [string] };
  args: unknown[];
};

function harness(
  states: ScriptResult[] = [
    { result: { kind: 'ready' }, documentId: DOCUMENT_ID, frameId: 0 },
    {
      result: { kind: 'completed', projection: evidence() },
      documentId: DOCUMENT_ID,
      frameId: 0,
    },
  ]
) {
  let currentUrl = DOTS_URL;
  let clock = 0;
  const query = vi.fn(async () => [{ id: TAB_ID, url: currentUrl, active: true }]);
  const update = vi.fn(async (_tabId: number, properties: { url: string }) => {
    currentUrl = properties.url;
    return { id: TAB_ID, url: currentUrl };
  });
  const reload = vi.fn(async () => undefined);
  const get = vi.fn(async () => ({ id: TAB_ID, url: currentUrl, status: 'complete' }));
  const executeScript = vi.fn(async (injection: ScriptInjection) => {
    if (injection.func === removeDotsSchemaProbeMarker) {
      currentUrl = DOTS_URL;
      return [{ result: true, documentId: DOCUMENT_ID, frameId: 0 }];
    }
    return [states.shift() ?? { result: { kind: 'missing' }, documentId: DOCUMENT_ID, frameId: 0 }];
  });
  const downloadEvidence = vi.fn(async () => true);
  const operations = new Set<number>();
  return {
    chromeApi: { tabs: { query, update, reload, get }, scripting: { executeScript } } as never,
    now: () => clock,
    sleep: async (milliseconds: number) => {
      clock += milliseconds;
    },
    timeoutMs: 200,
    pollIntervalMs: 10,
    createNonce: () => NONCE,
    operations,
    downloadEvidence,
    query,
    update,
    reload,
    get,
    executeScript,
    currentUrl: () => currentUrl,
    setCurrentUrl: (url: string) => {
      currentUrl = url;
    },
    advanceTime: (milliseconds: number) => {
      clock += milliseconds;
    },
  };
}

describe('Dots selected-tab schema probe', () => {
  it('accepts only the exact popup sender', () => {
    const popupUrl = 'chrome-extension://extension/src/popup/index.html';
    expect(
      isAuthorizedDotsSchemaProbeSender(
        { id: 'extension', url: popupUrl } as chrome.runtime.MessageSender,
        'extension',
        popupUrl
      )
    ).toBe(true);
    for (const sender of [
      { id: 'other', url: popupUrl },
      { id: 'extension', url: 'chrome-extension://extension/other.html' },
      { id: 'extension', url: popupUrl, tab: { id: 1 } },
    ]) {
      expect(
        isAuthorizedDotsSchemaProbeSender(
          sender as chrome.runtime.MessageSender,
          'extension',
          popupUrl
        )
      ).toBe(false);
    }
  });

  it.each([
    ['https://chatgpt.com/dots', true],
    ['https://chatgpt.com/dots/', false],
    [DOTS_URL, true],
    ['https://chatgpt.com/dots/home/', false],
    ['https://chatgpt.com/dots/a-b_c~d', true],
    ['https://chatgpt.com/dots/_hidden', false],
    ['https://chatgpt.com/dots/a/b', false],
    ['https://chatgpt.com/Dots/home', false],
    ['https://chatgpt.com/dots/a.b', false],
    ['https://chatgpt.com/dots/%2f', false],
    ['https://chatgpt.com/dots/home?limit=1', false],
    ['https://chatgpt.com/c/abc', false],
    ['https://evil.example/dots/home', false],
  ])('classifies target route %s', (url, accepted) => {
    expect(dotsSchemaProbeTargetUrl(url, NONCE) !== undefined).toBe(accepted);
  });

  it('reloads once, pins the new document, cleans the exact marker, and downloads compact JSON', async () => {
    const h = harness();
    const response = await probeDotsSchemaInActiveTab(h);

    expect(response).toEqual({ success: true, fileName: DOTS_SCHEMA_PROBE_FILE_NAME });
    expect(h.update).toHaveBeenCalledOnce();
    expect(h.update.mock.calls[0][1].url).toBe(`${DOTS_URL}#liska-dots-schema=${NONCE}`);
    expect(h.reload).toHaveBeenCalledOnce();
    expect(h.executeScript.mock.calls[0][0].target).toEqual({ tabId: TAB_ID, frameIds: [0] });
    expect(h.executeScript.mock.calls[1][0].target).toEqual({
      tabId: TAB_ID,
      documentIds: [DOCUMENT_ID],
    });
    expect(h.executeScript.mock.calls[2][0].target).toEqual({
      tabId: TAB_ID,
      documentIds: [DOCUMENT_ID],
    });
    expect(h.downloadEvidence).toHaveBeenCalledOnce();
    const compact = h.downloadEvidence.mock.calls[0][0];
    expect(compact).toBe(JSON.stringify(evidence()));
    expect(compact).not.toContain('\n');
    expect(h.currentUrl()).toBe(DOTS_URL);
    expect(h.operations.size).toBe(0);
  });

  it('accepts host fragment removal only while preserving the pinned document', async () => {
    const h = harness();
    const execute = h.executeScript.getMockImplementation()!;
    let reads = 0;
    h.executeScript.mockImplementation(async injection => {
      const result = await execute(injection);
      if (injection.func !== removeDotsSchemaProbeMarker && ++reads === 1) {
        h.setCurrentUrl(DOTS_URL);
      }
      return result;
    });

    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: true,
      fileName: DOTS_SCHEMA_PROBE_FILE_NAME,
    });
    expect(h.executeScript.mock.calls.map(([injection]) => injection.target)).toEqual([
      { tabId: TAB_ID, frameIds: [0] },
      { tabId: TAB_ID, documentIds: [DOCUMENT_ID] },
      { tabId: TAB_ID, documentIds: [DOCUMENT_ID] },
    ]);
    expect(h.downloadEvidence).toHaveBeenCalledOnce();
    expect(h.currentUrl()).toBe(DOTS_URL);
  });

  it('waits on an unmarked missing state without pinning the pre-reload document', async () => {
    const h = harness([
      { result: { kind: 'missing' }, documentId: 'old_document_123', frameId: 0 },
      { result: { kind: 'ready' }, documentId: DOCUMENT_ID, frameId: 0 },
      {
        result: { kind: 'completed', projection: evidence() },
        documentId: DOCUMENT_ID,
        frameId: 0,
      },
    ]);
    h.reload.mockImplementationOnce(async () => h.setCurrentUrl(DOTS_URL));

    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: true,
      fileName: DOTS_SCHEMA_PROBE_FILE_NAME,
    });
    expect(h.executeScript.mock.calls.map(([injection]) => injection.target)).toEqual([
      { tabId: TAB_ID, frameIds: [0] },
      { tabId: TAB_ID, frameIds: [0] },
      { tabId: TAB_ID, documentIds: [DOCUMENT_ID] },
      { tabId: TAB_ID, documentIds: [DOCUMENT_ID] },
    ]);
    expect(h.downloadEvidence).toHaveBeenCalledOnce();
  });

  it('does not mistake an unmarked missing hook for successful evidence', async () => {
    const h = harness([]);
    h.reload.mockImplementationOnce(async () => h.setCurrentUrl(DOTS_URL));
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'timed-out',
    });
    expect(h.downloadEvidence).not.toHaveBeenCalled();
    expect(h.currentUrl()).toBe(DOTS_URL);
    expect(h.operations.size).toBe(0);
  });

  it.each([
    [[], 'active-tab-required'],
    [
      [
        { id: 1, url: DOTS_URL },
        { id: 2, url: DOTS_URL },
      ],
      'active-tab-required',
    ],
    [[{ id: TAB_ID, url: 'https://chatgpt.com/c/abc' }], 'dots-route-required'],
    [[{ id: TAB_ID, url: `${DOTS_URL}?x=1` }], 'dots-route-required'],
    [[{ id: TAB_ID, url: `${DOTS_URL}#existing` }], 'conflicting-fragment'],
    [[{ id: TAB_ID, url: `${DOTS_URL}#liska-dots-schema=${NONCE}` }], 'conflicting-fragment'],
  ])('refuses invalid active-tab selection %#', async (tabs, code) => {
    const h = harness();
    h.query.mockResolvedValueOnce(tabs as never);
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({ success: false, code });
    expect(h.update).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
  });

  it('refuses a concurrent operation before navigation', async () => {
    const h = harness();
    h.operations.add(TAB_ID);
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'operation-in-progress',
    });
    expect(h.update).not.toHaveBeenCalled();
  });

  it('rejects an invalid nonce before changing the tab', async () => {
    const h = harness();
    h.createNonce = () => 'short';
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'nonce-invalid',
    });
    expect(h.update).not.toHaveBeenCalled();
  });

  it('cleans a successful marker update after reload rejection and allows a retry', async () => {
    const h = harness();
    h.reload.mockRejectedValueOnce(new Error('private browser detail'));
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'tab-update-failed',
    });
    expect(h.update).toHaveBeenCalledOnce();
    expect(h.reload).toHaveBeenCalledOnce();
    expect(h.downloadEvidence).not.toHaveBeenCalled();
    expect(h.currentUrl()).toBe(DOTS_URL);
    expect(h.executeScript).toHaveBeenCalledExactlyOnceWith({
      target: { tabId: TAB_ID, frameIds: [0] },
      world: 'MAIN',
      func: removeDotsSchemaProbeMarker,
      args: [NONCE, `${DOTS_URL}#liska-dots-schema=${NONCE}`],
    });
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: true,
      fileName: DOTS_SCHEMA_PROBE_FILE_NAME,
    });
    expect(h.update).toHaveBeenCalledTimes(2);
  });

  it('retains ownership of a timed-out update, cleans its late commit, and then permits retry', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      let commitUpdate!: () => void;
      const committed = new Promise<void>(resolve => {
        commitUpdate = resolve;
      });
      h.update.mockImplementationOnce(async (_tabId, properties) => {
        await committed;
        h.setCurrentUrl(properties.url);
        return { id: TAB_ID, url: properties.url };
      });

      const pending = probeDotsSchemaInActiveTab(h);
      await vi.advanceTimersByTimeAsync(h.timeoutMs + 1);
      await expect(pending).resolves.toEqual({ success: false, code: 'tab-update-failed' });
      expect(h.currentUrl()).toBe(DOTS_URL);
      expect(h.operations.has(TAB_ID)).toBe(true);
      expect(h.reload).not.toHaveBeenCalled();
      await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
        success: false,
        code: 'operation-in-progress',
      });
      expect(h.update).toHaveBeenCalledOnce();

      commitUpdate();
      await vi.runAllTimersAsync();
      expect(h.currentUrl()).toBe(DOTS_URL);
      expect(h.operations.size).toBe(0);
      expect(h.executeScript).toHaveBeenCalledExactlyOnceWith({
        target: { tabId: TAB_ID, frameIds: [0] },
        world: 'MAIN',
        func: removeDotsSchemaProbeMarker,
        args: [NONCE, `${DOTS_URL}#liska-dots-schema=${NONCE}`],
      });
      expect(h.reload).not.toHaveBeenCalled();
      expect(h.downloadEvidence).not.toHaveBeenCalled();

      await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
        success: true,
        fileName: DOTS_SCHEMA_PROBE_FILE_NAME,
      });
      expect(h.update).toHaveBeenCalledTimes(2);
      expect(h.reload).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases pending-update ownership after a delayed rejection without repeating the mutation', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      let rejectUpdate!: (reason: Error) => void;
      h.update.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectUpdate = reject;
          })
      );
      const pending = probeDotsSchemaInActiveTab(h);
      await vi.advanceTimersByTimeAsync(h.timeoutMs + 1);
      await expect(pending).resolves.toEqual({ success: false, code: 'tab-update-failed' });
      expect(h.operations.has(TAB_ID)).toBe(true);

      rejectUpdate(new Error('private late browser detail'));
      await vi.runAllTimersAsync();
      expect(h.operations.size).toBe(0);
      expect(h.currentUrl()).toBe(DOTS_URL);
      expect(h.update).toHaveBeenCalledOnce();
      expect(h.reload).not.toHaveBeenCalled();
      expect(h.executeScript).not.toHaveBeenCalled();
      expect(h.downloadEvidence).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for a late marker commit when update settles before the URL changes', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      let resolveUpdate!: (tab: chrome.tabs.Tab) => void;
      h.update.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveUpdate = resolve;
          })
      );
      h.sleep = async milliseconds => {
        await new Promise(resolve => setTimeout(resolve, milliseconds));
        h.advanceTime(milliseconds);
      };
      const pending = probeDotsSchemaInActiveTab(h);
      await vi.advanceTimersByTimeAsync(h.timeoutMs + 1);
      await expect(pending).resolves.toEqual({ success: false, code: 'tab-update-failed' });
      const markerUrl = `${DOTS_URL}#liska-dots-schema=${NONCE}`;
      resolveUpdate({ id: TAB_ID, url: markerUrl } as chrome.tabs.Tab);
      setTimeout(() => h.setCurrentUrl(markerUrl), 25);
      await vi.runAllTimersAsync();

      expect(h.currentUrl()).toBe(DOTS_URL);
      expect(h.operations.size).toBe(0);
      expect(h.executeScript).toHaveBeenCalledExactlyOnceWith({
        target: { tabId: TAB_ID, frameIds: [0] },
        world: 'MAIN',
        func: removeDotsSchemaProbeMarker,
        args: [NONCE, markerUrl],
      });
      expect(h.update).toHaveBeenCalledOnce();
      expect(h.reload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases late-update ownership after the exact base URL remains already clean', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      let resolveUpdate!: (tab: chrome.tabs.Tab) => void;
      h.update.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveUpdate = resolve;
          })
      );
      const pending = probeDotsSchemaInActiveTab(h);
      await vi.advanceTimersByTimeAsync(h.timeoutMs + 1);
      await expect(pending).resolves.toEqual({ success: false, code: 'tab-update-failed' });
      expect(h.operations.has(TAB_ID)).toBe(true);

      resolveUpdate({ id: TAB_ID, url: DOTS_URL } as chrome.tabs.Tab);
      await vi.runAllTimersAsync();
      expect(h.currentUrl()).toBe(DOTS_URL);
      expect(h.operations.size).toBe(0);
      expect(h.executeScript).not.toHaveBeenCalled();
      expect(h.reload).not.toHaveBeenCalled();
      expect(h.downloadEvidence).not.toHaveBeenCalled();
      await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
        success: true,
        fileName: DOTS_SCHEMA_PROBE_FILE_NAME,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    'https://chatgpt.com/dots/other',
    `${DOTS_URL}#liska-dots-schema=other-operation-12345678`,
  ])('leaves later navigation untouched when a timed-out update settles: %s', async changedUrl => {
    vi.useFakeTimers();
    try {
      const h = harness();
      let resolveUpdate!: (tab: chrome.tabs.Tab) => void;
      h.update.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveUpdate = resolve;
          })
      );
      const pending = probeDotsSchemaInActiveTab(h);
      await vi.advanceTimersByTimeAsync(h.timeoutMs + 1);
      await expect(pending).resolves.toEqual({ success: false, code: 'tab-update-failed' });
      h.setCurrentUrl(changedUrl);
      resolveUpdate({
        id: TAB_ID,
        url: `${DOTS_URL}#liska-dots-schema=${NONCE}`,
      } as chrome.tabs.Tab);
      await vi.runAllTimersAsync();

      expect(h.currentUrl()).toBe(changedUrl);
      expect(h.operations.size).toBe(0);
      expect(h.update).toHaveBeenCalledOnce();
      expect(h.reload).not.toHaveBeenCalled();
      expect(h.executeScript).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['ambiguous-room', 'request-init-present'] as const)(
    'propagates fixed observer code %s and never downloads an error',
    async code => {
      const h = harness([
        { result: { kind: 'ready' }, documentId: DOCUMENT_ID, frameId: 0 },
        {
          result: { kind: 'error', code },
          documentId: DOCUMENT_ID,
          frameId: 0,
        },
      ]);
      await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
        success: false,
        code,
      });
      expect(h.downloadEvidence).not.toHaveBeenCalled();
    }
  );

  it('rejects a replaced document after pinning', async () => {
    const h = harness([
      { result: { kind: 'ready' }, documentId: DOCUMENT_ID, frameId: 0 },
      {
        result: { kind: 'completed', projection: evidence() },
        documentId: 'different_document',
        frameId: 0,
      },
    ]);
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'document-replaced',
    });
    expect(h.downloadEvidence).not.toHaveBeenCalled();
  });

  it('rejects a replacement document at the exact unmarked base URL', async () => {
    const h = harness([
      { result: { kind: 'ready' }, documentId: DOCUMENT_ID, frameId: 0 },
      {
        result: { kind: 'completed', projection: evidence() },
        documentId: 'different_document',
        frameId: 0,
      },
    ]);
    const execute = h.executeScript.getMockImplementation()!;
    h.executeScript.mockImplementation(async injection => {
      const result = await execute(injection);
      if (injection.func !== removeDotsSchemaProbeMarker) h.setCurrentUrl(DOTS_URL);
      return result;
    });
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'document-replaced',
    });
    expect(h.downloadEvidence).not.toHaveBeenCalled();
    expect(h.executeScript.mock.calls[1][0].target).toEqual({
      tabId: TAB_ID,
      documentIds: [DOCUMENT_ID],
    });
  });

  it('never accepts a result without an explicit top-frame identity', async () => {
    const h = harness([
      {
        result: { kind: 'completed', projection: evidence() },
        documentId: DOCUMENT_ID,
      },
    ]);
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'timed-out',
    });
    expect(h.downloadEvidence).not.toHaveBeenCalled();
  });

  it.each([
    'https://chatgpt.com/',
    `${DOTS_URL}?x=1`,
    `${DOTS_URL}#other`,
    `${DOTS_URL}#liska-dots-schema=other-operation-12345678`,
    `${DOTS_URL}/`,
    'https://other.test/dots/home',
  ])('rejects navigation away without navigating back: %s', async changedUrl => {
    const h = harness([{ result: { kind: 'ready' }, documentId: DOCUMENT_ID, frameId: 0 }]);
    h.get
      .mockResolvedValueOnce({ id: TAB_ID, url: `${DOTS_URL}#liska-dots-schema=${NONCE}` })
      .mockImplementationOnce(async () => {
        h.setCurrentUrl(changedUrl);
        return { id: TAB_ID, url: changedUrl };
      });
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'navigation-changed',
    });
    expect(h.update).toHaveBeenCalledOnce();
    expect(h.reload).toHaveBeenCalledOnce();
    expect(h.downloadEvidence).not.toHaveBeenCalled();
    expect(h.currentUrl()).toBe(changedUrl);
    expect(
      h.executeScript.mock.calls.filter(
        ([injection]) => injection.func === removeDotsSchemaProbeMarker
      )
    ).toHaveLength(0);
  });

  it('rejects hostile completed projections at the background boundary', async () => {
    const hostile = evidence() as Record<string, unknown>;
    hostile.roomId = 'private-room';
    const h = harness([
      {
        result: { kind: 'completed', projection: hostile },
        documentId: DOCUMENT_ID,
        frameId: 0,
      },
    ]);
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'result-invalid',
    });
    expect(h.downloadEvidence).not.toHaveBeenCalled();
  });

  it('requires marker cleanup before starting the download', async () => {
    const h = harness([
      {
        result: { kind: 'completed', projection: evidence() },
        documentId: DOCUMENT_ID,
        frameId: 0,
      },
    ]);
    h.executeScript.mockImplementation(async injection => {
      if (injection.func === removeDotsSchemaProbeMarker) {
        return [{ result: false, documentId: DOCUMENT_ID, frameId: 0 }];
      }
      return [
        {
          result: { kind: 'completed', projection: evidence() },
          documentId: DOCUMENT_ID,
          frameId: 0,
        },
      ];
    });
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'cleanup-failed',
    });
    expect(h.downloadEvidence).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'never accepts evidence through an unpinned cleanup fallback with clean URL=%s',
    async alreadyClean => {
      const h = harness([
        {
          result: { kind: 'completed', projection: evidence() },
          documentId: DOCUMENT_ID,
          frameId: 0,
        },
      ]);
      const execute = h.executeScript.getMockImplementation()!;
      h.executeScript.mockImplementation(async injection => {
        if (injection.func === removeDotsSchemaProbeMarker && injection.target.documentIds) {
          throw new Error('pinned document is unavailable');
        }
        const result = await execute(injection);
        if (alreadyClean && injection.func !== removeDotsSchemaProbeMarker)
          h.setCurrentUrl(DOTS_URL);
        return result;
      });
      await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
        success: false,
        code: 'cleanup-failed',
      });
      const cleanup = h.executeScript.mock.calls.filter(
        ([injection]) => injection.func === removeDotsSchemaProbeMarker
      );
      expect(cleanup.map(([injection]) => injection.target)).toEqual([
        { tabId: TAB_ID, documentIds: [DOCUMENT_ID] },
        { tabId: TAB_ID, frameIds: [0] },
      ]);
      expect(h.currentUrl()).toBe(DOTS_URL);
      expect(h.downloadEvidence).not.toHaveBeenCalled();
    }
  );

  it('reports terminal download failure only after successful cleanup', async () => {
    const h = harness([
      {
        result: { kind: 'completed', projection: evidence() },
        documentId: DOCUMENT_ID,
        frameId: 0,
      },
    ]);
    h.downloadEvidence.mockResolvedValueOnce(false);
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'download-failed',
    });
    expect(h.currentUrl()).toBe(DOTS_URL);
  });

  it('cleans a missing-observer timeout without a hook document and allows a retry', async () => {
    const states: ScriptResult[] = [];
    const h = harness(states);
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'timed-out',
    });
    expect(h.downloadEvidence).not.toHaveBeenCalled();
    expect(h.operations.size).toBe(0);
    expect(h.currentUrl()).toBe(DOTS_URL);
    const cleanup = h.executeScript.mock.calls.filter(
      ([injection]) => injection.func === removeDotsSchemaProbeMarker
    );
    expect(cleanup).toHaveLength(1);
    expect(cleanup[0][0].target).toEqual({ tabId: TAB_ID, frameIds: [0] });
    states.push({
      result: { kind: 'completed', projection: evidence() },
      documentId: DOCUMENT_ID,
      frameId: 0,
    });
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: true,
      fileName: DOTS_SCHEMA_PROBE_FILE_NAME,
    });
    expect(h.update).toHaveBeenCalledTimes(2);
  });

  it('uses an independent cleanup budget after the observation deadline is exhausted', async () => {
    vi.useFakeTimers();
    try {
      const h = harness([]);
      let cleanupStarted = false;
      h.sleep = async milliseconds => {
        h.advanceTime(milliseconds + 1);
      };
      h.get.mockImplementation(async () => {
        if (h.now() >= h.timeoutMs) {
          cleanupStarted = true;
          await new Promise(resolve => setTimeout(resolve, 25));
          h.advanceTime(25);
        }
        return { id: TAB_ID, url: h.currentUrl(), status: 'complete' };
      });
      const result = probeDotsSchemaInActiveTab(h);
      await vi.runAllTimersAsync();
      await expect(result).resolves.toEqual({ success: false, code: 'timed-out' });
      expect(cleanupStarted).toBe(true);
      expect(h.currentUrl()).toBe(DOTS_URL);
      expect(h.operations.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back from an unavailable pinned document only after rechecking the exact marker URL', async () => {
    const h = harness([
      {
        result: { kind: 'error', code: 'target-not-observed' },
        documentId: DOCUMENT_ID,
        frameId: 0,
      },
    ]);
    const execute = h.executeScript.getMockImplementation()!;
    h.executeScript.mockImplementation(async injection => {
      if (injection.func === removeDotsSchemaProbeMarker && injection.target.documentIds) {
        throw new Error('pinned document is unavailable');
      }
      return execute(injection);
    });
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'target-not-observed',
    });
    const cleanup = h.executeScript.mock.calls.filter(
      ([injection]) => injection.func === removeDotsSchemaProbeMarker
    );
    expect(cleanup.map(([injection]) => injection.target)).toEqual([
      { tabId: TAB_ID, documentIds: [DOCUMENT_ID] },
      { tabId: TAB_ID, frameIds: [0] },
    ]);
    expect(h.currentUrl()).toBe(DOTS_URL);
  });

  it('does not use the unpinned fallback after navigation with the same nonce', async () => {
    const h = harness([
      {
        result: { kind: 'error', code: 'target-not-observed' },
        documentId: DOCUMENT_ID,
        frameId: 0,
      },
    ]);
    const changedUrl = `https://chatgpt.com/dots/other#liska-dots-schema=${NONCE}`;
    const execute = h.executeScript.getMockImplementation()!;
    h.executeScript.mockImplementation(async injection => {
      if (injection.func === removeDotsSchemaProbeMarker && injection.target.documentIds) {
        h.setCurrentUrl(changedUrl);
        throw new Error('pinned document is unavailable');
      }
      return execute(injection);
    });
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'target-not-observed',
    });
    expect(h.currentUrl()).toBe(changedUrl);
    const cleanup = h.executeScript.mock.calls.filter(
      ([injection]) => injection.func === removeDotsSchemaProbeMarker
    );
    expect(cleanup).toHaveLength(1);
    expect(h.downloadEvidence).not.toHaveBeenCalled();
  });

  it('rechecks the full expected URL inside the serialized cleanup before replacing history', () => {
    const markerUrl = `${DOTS_URL}#liska-dots-schema=${NONCE}`;
    let currentUrl = `https://chatgpt.com/dots/other#liska-dots-schema=${NONCE}`;
    const replaceState = vi.fn((_state: unknown, _unused: string, url: string) => {
      currentUrl = url;
    });
    vi.stubGlobal('window', {
      location: {
        get href() {
          return currentUrl;
        },
        get hash() {
          return new URL(currentUrl).hash;
        },
      },
      history: { state: null, replaceState },
    });
    try {
      expect(removeDotsSchemaProbeMarker(NONCE, markerUrl)).toBe(false);
      expect(replaceState).not.toHaveBeenCalled();
      currentUrl = markerUrl;
      expect(removeDotsSchemaProbeMarker(NONCE, markerUrl)).toBe(true);
      expect(currentUrl).toBe(DOTS_URL);
      expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, '', DOTS_URL);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('treats the exact already-clean base URL as a no-op without replacing history', () => {
    const replaceState = vi.fn();
    const historyState = vi.fn(() => {
      throw new Error('history state stays untouched');
    });
    vi.stubGlobal('window', {
      location: { href: DOTS_URL, hash: '' },
      history: {
        get state() {
          return historyState();
        },
        replaceState,
      },
    });
    try {
      expect(removeDotsSchemaProbeMarker(NONCE, `${DOTS_URL}#liska-dots-schema=${NONCE}`)).toBe(
        true
      );
      expect(replaceState).not.toHaveBeenCalled();
      expect(historyState).not.toHaveBeenCalled();
      for (const markerUrl of [
        DOTS_URL,
        `${DOTS_URL}#other`,
        `${DOTS_URL}#liska-dots-schema=other-operation-12345678`,
      ]) {
        expect(removeDotsSchemaProbeMarker(NONCE, markerUrl)).toBe(false);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('preserves the primary failure if unpinned cleanup lacks a safe top-frame result', async () => {
    const h = harness();
    h.reload.mockRejectedValueOnce(new Error('private browser detail'));
    h.executeScript.mockResolvedValueOnce([{ result: true, documentId: 'short', frameId: 0 }]);
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'tab-update-failed',
    });
    expect(h.currentUrl()).toBe(`${DOTS_URL}#liska-dots-schema=${NONCE}`);
    expect(h.downloadEvidence).not.toHaveBeenCalled();
    expect(h.operations.size).toBe(0);
  });
});

describe('Dots probe browser failures and default local delivery', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.stubGlobal('chrome', initialChrome);
  });

  it('uses native nonce, clock, sleep and Chrome defaults before terminal local delivery', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = harness();
    const api = h.chromeApi as unknown as { tabs: unknown; scripting: unknown };
    vi.stubGlobal('chrome', { ...initialChrome, ...api });
    const nonce = vi.spyOn(crypto, 'randomUUID').mockReturnValue(NONCE);
    const download = vi
      .spyOn(outputHandlers, 'downloadArchiveBlob')
      .mockImplementation(async (_url, _fileName, onLateTerminal) => {
        await onLateTerminal();
        return { terminal: true, error: null, downloadId: 51 };
      });

    const result = probeDotsSchemaInActiveTab({ operations: new Set() });
    await vi.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toEqual({ success: true, fileName: DOTS_SCHEMA_PROBE_FILE_NAME });
    expect(nonce).toHaveBeenCalledOnce();
    expect(h.query).toHaveBeenCalledExactlyOnceWith({ active: true, currentWindow: true });
    expect(h.reload).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledOnce();
    const [url, fileName] = download.mock.calls[0];
    expect(fileName).toBe(DOTS_SCHEMA_PROBE_FILE_NAME);
    expect(url).toMatch(/^data:application\/json;base64,/);
    expect(atob(url.slice(url.indexOf(',') + 1))).toBe(JSON.stringify(evidence()));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { terminal: false, error: null },
    { terminal: true, error: 'private browser failure' },
  ])('does not report a non-successful default Downloads outcome as saved: %j', async outcome => {
    const h = harness();
    const download = vi.spyOn(outputHandlers, 'downloadArchiveBlob').mockResolvedValue(outcome);
    await expect(
      probeDotsSchemaInActiveTab({ ...h, downloadEvidence: undefined })
    ).resolves.toEqual({
      success: false,
      code: 'download-failed',
    });
    expect(download).toHaveBeenCalledOnce();
    expect(h.currentUrl()).toBe(DOTS_URL);
  });

  it('maps a rejected default Downloads operation to a fixed failure without browser details', async () => {
    const h = harness();
    vi.spyOn(outputHandlers, 'downloadArchiveBlob').mockRejectedValue(
      new Error('private sink error')
    );
    const response = await probeDotsSchemaInActiveTab({ ...h, downloadEvidence: undefined });
    expect(response).toEqual({ success: false, code: 'download-failed' });
    expect(JSON.stringify(response)).not.toContain('private');
  });

  it('refuses local encoding failure before issuing a download', async () => {
    const h = harness();
    const download = vi.spyOn(outputHandlers, 'downloadArchiveBlob');
    vi.spyOn(globalThis, 'btoa').mockImplementation(() => {
      throw new Error('encoding unavailable');
    });
    await expect(
      probeDotsSchemaInActiveTab({ ...h, downloadEvidence: undefined })
    ).resolves.toEqual({
      success: false,
      code: 'download-failed',
    });
    expect(download).not.toHaveBeenCalled();
  });

  it('fails before navigation when the default secure nonce source is unavailable', async () => {
    const h = harness();
    vi.stubGlobal('crypto', {});
    try {
      await expect(probeDotsSchemaInActiveTab({ ...h, createNonce: undefined })).resolves.toEqual({
        success: false,
        code: 'nonce-invalid',
      });
      expect(h.update).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('maps clock, selection and nonce exceptions before any mutation', async () => {
    const h = harness();
    const privateFailure = () => {
      throw new Error('private dependency error');
    };
    await expect(probeDotsSchemaInActiveTab({ ...h, now: privateFailure })).resolves.toEqual({
      success: false,
      code: 'result-invalid',
    });
    h.query.mockRejectedValueOnce(new Error('private selection error'));
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'active-tab-required',
    });
    await expect(
      probeDotsSchemaInActiveTab({ ...h, createNonce: privateFailure })
    ).resolves.toEqual({
      success: false,
      code: 'nonce-invalid',
    });
    expect(h.update).not.toHaveBeenCalled();
  });

  it('rejects malformed URLs and wrong tab identities without starting a reload', async () => {
    expect(dotsSchemaProbeTargetUrl('not a URL', NONCE)).toBeUndefined();
    const h = harness();
    h.query.mockResolvedValueOnce([{ id: TAB_ID, url: 'not a URL', active: true }]);
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'dots-route-required',
    });
    h.update.mockImplementationOnce(async (_tabId, properties) => {
      h.setCurrentUrl(properties.url);
      return { id: TAB_ID + 1, url: properties.url };
    });
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'tab-update-failed',
    });
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.currentUrl()).toBe(DOTS_URL);
  });

  it('refuses an unavailable selected document and still cleans its marker', async () => {
    const h = harness();
    h.get.mockRejectedValueOnce(new Error('tab closed'));
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'document-unavailable',
    });
    expect(h.downloadEvidence).not.toHaveBeenCalled();
    expect(h.currentUrl()).toBe(DOTS_URL);
  });

  it('treats an unavailable pinned scripting context as a replaced document', async () => {
    const h = harness();
    const execute = h.executeScript.getMockImplementation()!;
    let reads = 0;
    h.executeScript.mockImplementation(async injection => {
      if (injection.func !== removeDotsSchemaProbeMarker && ++reads === 2)
        throw new Error('old context detached');
      return execute(injection);
    });
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'document-replaced',
    });
    expect(h.currentUrl()).toBe(DOTS_URL);
    expect(h.downloadEvidence).not.toHaveBeenCalled();
  });

  it('ignores missing and hostile hook records without running caller accessors', async () => {
    const getter = vi.fn(() => 'private');
    const accessor = Object.defineProperty({}, 'kind', { get: getter, enumerable: true });
    const reflected = new Proxy(
      { kind: 'ready' },
      {
        getPrototypeOf() {
          throw new Error('private reflection');
        },
      }
    );
    const h = harness([
      { result: accessor, documentId: DOCUMENT_ID, frameId: 0 },
      { result: reflected, documentId: DOCUMENT_ID, frameId: 0 },
      { result: null, documentId: DOCUMENT_ID, frameId: 0 },
      {
        result: { kind: 'completed', projection: evidence() },
        documentId: DOCUMENT_ID,
        frameId: 0,
      },
    ]);
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: true,
      fileName: DOTS_SCHEMA_PROBE_FILE_NAME,
    });
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects malformed hook descriptors and record shapes before accepting a later exact result', async () => {
    const getter = vi.fn(() => 'private');
    const codeAccessor = Object.defineProperty({ kind: 'error' }, 'code', {
      enumerable: true,
      get: getter,
    });
    const symbolProjection = { kind: 'completed', [Symbol('private')]: evidence() };
    const customPrototype = Object.assign(Object.create({ private: true }), { kind: 'ready' });
    const arrayRecord = Object.assign([], { kind: 'ready' });
    const h = harness([
      ...[
        codeAccessor,
        symbolProjection,
        customPrototype,
        arrayRecord,
        { kind: 'ready', extra: true },
      ].map(result => ({ result, documentId: DOCUMENT_ID, frameId: 0 })),
      {
        result: { kind: 'completed', projection: evidence() },
        documentId: DOCUMENT_ID,
        frameId: 0,
      },
    ]);
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: true,
      fileName: DOTS_SCHEMA_PROBE_FILE_NAME,
    });
    expect(getter).not.toHaveBeenCalled();
  });

  it('waits through an empty scripting result but refuses evidence without a document identity', async () => {
    const h = harness();
    h.executeScript
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { result: { kind: 'completed', projection: evidence() }, frameId: 0 },
      ]);
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'document-unavailable',
    });
    expect(h.downloadEvidence).not.toHaveBeenCalled();
    expect(h.currentUrl()).toBe(DOTS_URL);
  });

  it('stops after a rejected polling delay but preserves the bounded cleanup', async () => {
    const h = harness([]);
    h.sleep = async () => {
      throw new Error('private scheduler detail');
    };
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'timed-out',
    });
    expect(h.currentUrl()).toBe(DOTS_URL);
    expect(h.operations.size).toBe(0);
  });

  it('does not download if the independent cleanup lookup fails', async () => {
    const h = harness();
    const get = h.get.getMockImplementation()!;
    let calls = 0;
    h.get.mockImplementation(async () => {
      if (++calls === 3) throw new Error('cleanup tab unavailable');
      return get();
    });
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'cleanup-failed',
    });
    expect(h.downloadEvidence).not.toHaveBeenCalled();
    expect(h.operations.size).toBe(0);
  });

  it('maps a rejected injected local sink only after marker cleanup', async () => {
    const h = harness();
    h.downloadEvidence.mockRejectedValueOnce(new Error('private sink error'));
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'download-failed',
    });
    expect(h.currentUrl()).toBe(DOTS_URL);
  });

  it('refuses a final serializer failure after validation without issuing a local write', async () => {
    const h = harness();
    const nativeStringify = JSON.stringify;
    let evidenceSerializations = 0;
    vi.spyOn(JSON, 'stringify').mockImplementation((value, ...args) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        Object.getOwnPropertyDescriptor(value, 'schema')?.value === DOTS_SCHEMA_PROBE_SCHEMA &&
        ++evidenceSerializations === 2
      ) {
        throw new Error('private final serializer detail');
      }
      return Reflect.apply(nativeStringify, JSON, [value, ...args]);
    });
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'result-invalid',
    });
    expect(evidenceSerializations).toBe(2);
    expect(h.currentUrl()).toBe(DOTS_URL);
    expect(h.downloadEvidence).not.toHaveBeenCalled();
    expect(h.operations.size).toBe(0);
  });

  it('does not expose an exception thrown while cleaning page history', () => {
    const markerUrl = `${DOTS_URL}#liska-dots-schema=${NONCE}`;
    vi.stubGlobal('window', {
      location: { href: markerUrl, hash: `#liska-dots-schema=${NONCE}` },
      history: {
        state: null,
        replaceState: () => {
          throw new Error('private history detail');
        },
      },
    });
    try {
      expect(removeDotsSchemaProbeMarker(NONCE, markerUrl)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('recognizes only fixed public failure codes', () => {
    expect(isDotsSchemaProbeFailureCode('download-failed')).toBe(true);
    expect(isDotsSchemaProbeFailureCode('request-init-present')).toBe(true);
    for (const value of [null, 1, {}, 'private browser detail', 'download-failed: private'])
      expect(isDotsSchemaProbeFailureCode(value)).toBe(false);
  });

  it('rejects invalid cleanup capabilities before touching the page', () => {
    const markerUrl = `${DOTS_URL}#liska-dots-schema=${NONCE}`;
    expect(removeDotsSchemaProbeMarker('short', markerUrl)).toBe(false);
    expect(removeDotsSchemaProbeMarker(NONCE, undefined as unknown as string)).toBe(false);
    expect(dotsSchemaProbeTargetUrl(undefined, NONCE)).toBeUndefined();
    expect(dotsSchemaProbeTargetUrl(DOTS_URL, 'short')).toBeUndefined();
  });
});
