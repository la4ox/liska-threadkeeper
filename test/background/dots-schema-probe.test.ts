import { describe, expect, it, vi } from 'vitest';
import {
  DOTS_SCHEMA_PROBE_ENDPOINTS,
  DOTS_SCHEMA_PROBE_FILE_NAME,
  DOTS_SCHEMA_PROBE_SCOPE,
  DOTS_SCHEMA_PROBE_SCHEMA,
} from '../../src/lib/dots-schema-probe-contract';
import {
  dotsSchemaProbeTargetUrl,
  isAuthorizedDotsSchemaProbeSender,
  probeDotsSchemaInActiveTab,
  removeDotsSchemaProbeMarker,
} from '../../src/background/dots-schema-probe';

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

  it('propagates only fixed observer codes and never downloads an error', async () => {
    const h = harness([
      { result: { kind: 'ready' }, documentId: DOCUMENT_ID, frameId: 0 },
      {
        result: { kind: 'error', code: 'ambiguous-room' },
        documentId: DOCUMENT_ID,
        frameId: 0,
      },
    ]);
    await expect(probeDotsSchemaInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'ambiguous-room',
    });
    expect(h.downloadEvidence).not.toHaveBeenCalled();
  });

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

  it('rejects navigation away and never navigates back', async () => {
    const h = harness([{ result: { kind: 'ready' }, documentId: DOCUMENT_ID, frameId: 0 }]);
    const changedUrl = 'https://chatgpt.com/';
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

  it('never accepts successful evidence through an unpinned cleanup fallback', async () => {
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
      return execute(injection);
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
  });

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
