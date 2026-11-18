import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inspectClaudeListProbeDocument,
  isAuthorizedClaudeListProbeSender,
  markClaudeListProbeNavigationChanged,
  probeClaudeListsInActiveTab,
  runClaudeListProbeInPage,
} from '../../src/background/claude-list-probe';
import {
  CLAUDE_LIST_PROBE_SCHEMA,
  snapshotClaudeListProbeResult,
} from '../../src/lib/claude-list-probe-contract';

const TAB_ID = 73;
const DOCUMENT_ID = 'claude_document_123';
const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444';
const WORKSPACE_ID = 'private-workspace-value';
const OWNER_TOKEN = '33333333-3333-4333-8333-333333333333';
const CHAT_URL = `https://claude.ai/chat/${CONVERSATION_ID}`;
const DETAIL_URL = `https://claude.ai/api/organizations/${ORGANIZATION_ID}/chat_conversations/${CONVERSATION_ID}`;

function safeResult() {
  return {
    schema: CLAUDE_LIST_PROBE_SCHEMA,
    status: 'complete' as const,
    code: 'ok' as const,
    verificationPresent: false,
    routeOrganizationEvidence: 'resource-timing' as const,
    counts: {
      dispatch: 2,
      page: 2,
      record: 0,
      validUuid: 0,
      marker: 0,
      duplicate: 0,
      overlap: 0,
      archivedMismatch: 0,
    },
    pages: [
      { partition: 'active' as const, offset: 0 as const, hasMore: false, terminal: true },
      { partition: 'archived' as const, offset: 0 as const, hasMore: false, terminal: true },
    ],
    pagination: {
      exercised: false,
      hypothesis: 'not-exercised' as const,
      unfinished: false,
    },
    scope: {
      organizationResolved: true,
      workspaceResolved: true,
      consistent: true,
      routeOrganizationMatched: true,
      fingerprint: `liska-claude-list-probe-scope/1:${'a'.repeat(64)}`,
      relevantHeaderNames: ['x-organization-id', 'x-workspace-id'],
    },
  };
}

type Injection = {
  target: { tabId: number; frameIds?: [0]; documentIds?: [string] };
  world: string;
  func: unknown;
  args: unknown[];
};

function harness(probeResult: unknown = safeResult()) {
  let currentUrl = CHAT_URL;
  const updatedListeners = new Set<
    (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void
  >();
  const query = vi.fn(async () => [{ id: TAB_ID, url: currentUrl, active: true }]);
  const get = vi.fn(async () => ({ id: TAB_ID, url: currentUrl, active: true }));
  const executeScript = vi.fn(async (injection: Injection) => {
    if (injection.func === inspectClaudeListProbeDocument)
      return [{ result: { ready: true }, documentId: DOCUMENT_ID, frameId: 0 }];
    return [{ result: probeResult, documentId: DOCUMENT_ID, frameId: 0 }];
  });
  const onUpdated = {
    addListener: vi.fn(
      (listener: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void) => {
        updatedListeners.add(listener);
      }
    ),
    removeListener: vi.fn(
      (listener: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void) => {
        updatedListeners.delete(listener);
      }
    ),
  };
  const operations = new Set<number>();
  return {
    chromeApi: { tabs: { query, get, onUpdated }, scripting: { executeScript } } as never,
    operations,
    query,
    get,
    executeScript,
    setUrl(value: string) {
      currentUrl = value;
    },
    emitUrl(value: string) {
      currentUrl = value;
      for (const listener of updatedListeners) listener(TAB_ID, { url: value });
    },
    onUpdated,
  };
}

function response(
  requestUrl: string,
  body: unknown,
  options: {
    status?: number;
    redirected?: boolean;
    url?: string;
    headers?: Record<string, string>;
    stalled?: boolean;
  } = {}
) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const reader = options.stalled
    ? {
        read: () => new Promise<never>(() => undefined),
        cancel: vi.fn(async () => undefined),
        releaseLock: vi.fn(),
      }
    : {
        reads: 0,
        async read() {
          this.reads += 1;
          return this.reads === 1
            ? { done: false, value: bytes }
            : { done: true, value: undefined };
        },
        cancel: vi.fn(async () => undefined),
        releaseLock: vi.fn(),
      };
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'x-organization-id': ORGANIZATION_ID,
    'x-workspace-id': WORKSPACE_ID,
    ...options.headers,
  });
  const stream = { getReader: () => reader, cancel: vi.fn(async () => undefined) };
  return {
    status: options.status ?? 200,
    redirected: options.redirected ?? false,
    url: options.url ?? requestUrl,
    headers,
    body: stream,
  } as unknown as Response;
}

function installPage(fetchImplementation: (url: string, init: RequestInit) => Promise<Response>) {
  const pageWindow = { location: { href: CHAT_URL } } as Window & typeof globalThis;
  Object.assign(pageWindow, { top: pageWindow });
  vi.stubGlobal('window', pageWindow);
  vi.stubGlobal('performance', { getEntriesByType: () => [{ name: DETAIL_URL }] });
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(fetchImplementation));
  document.body.innerHTML = '';
}

function id(index: number): string {
  return `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`;
}

function list(records: unknown[] = [], hasMore = false) {
  return { data: records, has_more: hasMore };
}

function verificationHref(organization = ORGANIZATION_ID, conversation = CONVERSATION_ID): string {
  return (
    `https://portal.anthropic.com/verify?org=${organization}` +
    `&return_to=claude&return_path=${encodeURIComponent(`/chat/${conversation}`)}`
  );
}

function pageDeadline(milliseconds = 1_000): number {
  return Date.now() + milliseconds;
}

function runPage(milliseconds = 1_000): Promise<unknown> {
  return runClaudeListProbeInPage(CHAT_URL, pageDeadline(milliseconds), OWNER_TOKEN, false);
}

describe('Claude selected-tab list probe controller', () => {
  it('admits only the exact extension popup sender', () => {
    const sender = {
      id: 'extension',
      url: 'chrome-extension://extension/src/popup/index.html',
    } as chrome.runtime.MessageSender;
    expect(
      isAuthorizedClaudeListProbeSender(
        sender,
        'extension',
        'chrome-extension://extension/src/popup/index.html'
      )
    ).toBe(true);
    for (const invalid of [
      { ...sender, id: 'other' },
      { ...sender, url: `${sender.url}?copied=1` },
      { ...sender, tab: { id: TAB_ID } },
    ])
      expect(
        isAuthorizedClaudeListProbeSender(
          invalid as chrome.runtime.MessageSender,
          'extension',
          'chrome-extension://extension/src/popup/index.html'
        )
      ).toBe(false);
  });

  it('pins the selected top-frame document before and after one ISOLATED probe', async () => {
    const h = harness();
    await expect(probeClaudeListsInActiveTab(h)).resolves.toEqual({
      success: true,
      data: safeResult(),
    });
    expect(h.executeScript).toHaveBeenCalledTimes(3);
    expect(h.executeScript.mock.calls.map(([call]) => call.world)).toEqual([
      'ISOLATED',
      'ISOLATED',
      'ISOLATED',
    ]);
    expect(h.executeScript.mock.calls[0][0].target).toEqual({ tabId: TAB_ID, frameIds: [0] });
    expect(h.executeScript.mock.calls[1][0].target).toEqual({
      tabId: TAB_ID,
      documentIds: [DOCUMENT_ID],
    });
    expect(h.executeScript.mock.calls[2][0].target).toEqual({
      tabId: TAB_ID,
      documentIds: [DOCUMENT_ID],
    });
    const absoluteDeadline = h.executeScript.mock.calls[1][0].args[1];
    expect(absoluteDeadline).toEqual(expect.any(Number));
    expect(absoluteDeadline).toBeGreaterThan(Date.now());
    expect(h.onUpdated.addListener).toHaveBeenCalledOnce();
    expect(h.onUpdated.removeListener).toHaveBeenCalledOnce();
  });

  it('makes zero page executions for a non-Claude route or an existing run lock', async () => {
    const wrong = harness();
    wrong.setUrl('https://claude.ai/new');
    await expect(probeClaudeListsInActiveTab(wrong)).resolves.toEqual({
      success: false,
      code: 'claude-route-required',
    });
    expect(wrong.executeScript).not.toHaveBeenCalled();

    const locked = harness();
    locked.operations.add(999);
    await expect(probeClaudeListsInActiveTab(locked)).resolves.toEqual({
      success: false,
      code: 'operation-in-progress',
    });
    expect(locked.executeScript).not.toHaveBeenCalled();
  });

  it('retains the global lock after caller timeout until the pinned execution actually settles', async () => {
    const h = harness();
    const ordinary = h.executeScript.getMockImplementation()!;
    let rejectPinned!: (error: Error) => void;
    h.executeScript.mockImplementation((injection: Injection) => {
      if (injection.func === inspectClaudeListProbeDocument) return ordinary(injection);
      return new Promise((_resolve, reject) => {
        rejectPinned = reject;
      });
    });

    const first = probeClaudeListsInActiveTab({
      ...h,
      backgroundTimeoutMs: 50,
      pageTimeoutMs: 1_000,
    });
    await vi.waitFor(() => expect(rejectPinned).toBeTypeOf('function'));
    await expect(first).resolves.toEqual({ success: false, code: 'background-timeout' });
    expect(h.operations.has(TAB_ID)).toBe(true);
    await expect(probeClaudeListsInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'operation-in-progress',
    });
    expect(h.onUpdated.removeListener).not.toHaveBeenCalled();

    rejectPinned(new Error('late private execution rejection'));
    await vi.waitFor(() => expect(h.operations.size).toBe(0));
    expect(h.onUpdated.removeListener).toHaveBeenCalledOnce();
  });

  it('latches target-tab A-to-B-to-A navigation even when the final URL matches', async () => {
    const h = harness();
    const ordinary = h.executeScript.getMockImplementation()!;
    h.executeScript.mockImplementation(async (injection: Injection) => {
      if (injection.func === inspectClaudeListProbeDocument) return ordinary(injection);
      h.emitUrl(`https://claude.ai/chat/${id(9)}`);
      h.emitUrl(CHAT_URL);
      return [{ result: safeResult(), documentId: DOCUMENT_ID, frameId: 0 }];
    });

    await expect(probeClaudeListsInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'navigation-changed',
    });
    expect(h.operations.size).toBe(0);
    expect(h.onUpdated.removeListener).toHaveBeenCalledOnce();
  });

  it('signals A-to-B-to-A into the pinned ISOLATED run, aborts the first fetch and cleans its marker', async () => {
    const h = harness();
    installPage(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        })
    );
    h.executeScript.mockImplementation(async (injection: Injection) => {
      if (injection.func === inspectClaudeListProbeDocument)
        return [{ result: { ready: true }, documentId: DOCUMENT_ID, frameId: 0 }];
      if (injection.func === markClaudeListProbeNavigationChanged)
        return [
          {
            result: markClaudeListProbeNavigationChanged(injection.args[0] as string),
            documentId: DOCUMENT_ID,
            frameId: 0,
          },
        ];
      return [
        {
          result: await runClaudeListProbeInPage(
            injection.args[0] as string,
            injection.args[1] as number,
            injection.args[2] as string,
            injection.args[3] as boolean
          ),
          documentId: DOCUMENT_ID,
          frameId: 0,
        },
      ];
    });
    try {
      const pending = probeClaudeListsInActiveTab(h);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      const signal = vi.mocked(fetch).mock.calls[0][1]?.signal as AbortSignal;
      expect(signal.aborted).toBe(false);

      h.emitUrl(`https://claude.ai/chat/${id(9)}`);
      h.emitUrl(CHAT_URL);

      await expect(pending).resolves.toEqual({
        success: false,
        code: 'navigation-changed',
      });
      expect(signal.aborted).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(
        h.executeScript.mock.calls.some(([injection]) =>
          Object.is(injection.func, markClaudeListProbeNavigationChanged)
        )
      ).toBe(true);
      expect(
        (globalThis as unknown as Record<string, unknown>)['__liskaClaudeListProbeNavigation_v1']
      ).toBeUndefined();
      expect(h.operations.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      document.body.innerHTML = '';
    }
  });

  it('retains the lock until a late marker rejection settles without becoming unhandled', async () => {
    const h = harness();
    const ordinary = h.executeScript.getMockImplementation()!;
    let rejectMarker!: (error: Error) => void;
    h.executeScript.mockImplementation(async (injection: Injection) => {
      if (injection.func === inspectClaudeListProbeDocument) return ordinary(injection);
      if (injection.func === markClaudeListProbeNavigationChanged)
        return new Promise((_resolve, reject) => {
          rejectMarker = reject;
        });
      h.emitUrl(`https://claude.ai/chat/${id(9)}`);
      h.emitUrl(CHAT_URL);
      return [{ result: safeResult(), documentId: DOCUMENT_ID, frameId: 0 }];
    });

    const first = probeClaudeListsInActiveTab(h);
    await vi.waitFor(() => expect(rejectMarker).toBeTypeOf('function'));
    await expect(first).resolves.toEqual({ success: false, code: 'navigation-changed' });
    expect(h.operations.has(TAB_ID)).toBe(true);
    await expect(probeClaudeListsInActiveTab(h)).resolves.toEqual({
      success: false,
      code: 'operation-in-progress',
    });

    rejectMarker(new Error('late private marker rejection'));
    await vi.waitFor(() => expect(h.operations.size).toBe(0));
  });

  it('fails closed on source navigation, document replacement and hostile injected results', async () => {
    const navigation = harness();
    navigation.executeScript.mockImplementationOnce(async () => {
      navigation.setUrl(`https://claude.ai/chat/${id(9)}`);
      return [{ result: { ready: true }, documentId: DOCUMENT_ID, frameId: 0 }];
    });
    await expect(probeClaudeListsInActiveTab(navigation)).resolves.toEqual({
      success: false,
      code: 'navigation-changed',
    });

    const replaced = harness();
    replaced.executeScript.mockImplementationOnce(async () => [
      { result: { ready: true }, documentId: 'different_document', frameId: 0 },
    ]);
    await expect(probeClaudeListsInActiveTab(replaced)).resolves.toEqual({
      success: false,
      code: 'document-replaced',
    });

    const subframe = harness();
    subframe.executeScript.mockImplementationOnce(async () => [
      { result: { ready: true }, documentId: DOCUMENT_ID, frameId: 1 },
    ]);
    await expect(probeClaudeListsInActiveTab(subframe)).resolves.toEqual({
      success: false,
      code: 'document-unavailable',
    });

    const hostile = harness({ ...safeResult(), privateBody: 'secret' });
    await expect(probeClaudeListsInActiveTab(hostile)).resolves.toEqual({
      success: false,
      code: 'result-invalid',
    });
  });
});

describe('Claude injected active/archived list diagnostic', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('dispatches active then archived offset zero serially and returns only safe aggregate data', async () => {
    let inFlight = 0;
    let maximumInFlight = 0;
    installPage(async url => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return response(
        url,
        list([{ uuid: id(1), updated_at: 'private-marker', is_archived: false }])
      );
    });
    const result = (await runPage()) as ReturnType<typeof safeResult>;
    expect(result.status).toBe('stopped');
    expect(result.code).toBe('scope-unresolved');
    expect(result.verificationPresent).toBe(false);
    expect(result.routeOrganizationEvidence).toBe('resource-timing');
    expect(result.counts).toMatchObject({
      dispatch: 2,
      page: 2,
      record: 2,
      validUuid: 2,
      marker: 2,
    });
    expect(result.pages).toEqual([
      { partition: 'active', offset: 0, hasMore: false, terminal: true },
      { partition: 'archived', offset: 0, hasMore: false, terminal: true },
    ]);
    expect(maximumInFlight).toBe(1);
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(String(calls[0][0])).toContain('offset=0&archived=false&consistency=strong');
    expect(String(calls[1][0])).toContain('offset=0&archived=true&consistency=strong');
    expect(calls[0][1]).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
    });
    expect(result.scope).toEqual({
      organizationResolved: false,
      workspaceResolved: false,
      consistent: false,
      routeOrganizationMatched: false,
      fingerprint: null,
      relevantHeaderNames: ['x-organization-id', 'x-workspace-id'],
    });
    expect(snapshotClaudeListProbeResult(result)).toEqual(result);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(ORGANIZATION_ID);
    expect(serialized).not.toContain(WORKSPACE_ID);
    expect(serialized).not.toContain('private-marker');
  });

  it('uses only the exact named storage key once when it is the sole route hint', async () => {
    installPage(async url => response(url, list()));
    vi.stubGlobal('performance', { getEntriesByType: () => [] });
    const getItem = vi.fn((key: string) => (key === 'ccd-sync-org' ? ORGANIZATION_ID : null));
    const storage = new Proxy(
      { getItem },
      {
        get(target, property) {
          if (property === 'getItem') return target.getItem;
          throw new Error(`unrelated storage property read: ${String(property)}`);
        },
        ownKeys() {
          throw new Error('storage enumeration attempted');
        },
      }
    );
    vi.stubGlobal('localStorage', storage);

    const result = (await runPage()) as ReturnType<typeof safeResult>;
    expect(getItem).toHaveBeenCalledExactlyOnceWith('ccd-sync-org');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.routeOrganizationEvidence).toBe('named-storage');
    expect(JSON.stringify(result)).not.toContain(ORGANIZATION_ID);
  });

  it('uses an exact current-conversation verification link without reading unrelated DOM', async () => {
    installPage(async url => response(url, list()));
    vi.stubGlobal('performance', { getEntriesByType: () => [] });
    const getItem = vi.fn(() => null);
    vi.stubGlobal('localStorage', { getItem });
    document.body.innerHTML = `<div data-organization-banners><a href="${verificationHref()}">Verify</a></div>`;
    const query = vi.spyOn(document, 'querySelector');

    const result = (await runPage()) as ReturnType<typeof safeResult>;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getItem).toHaveBeenCalledExactlyOnceWith('ccd-sync-org');
    expect(result.routeOrganizationEvidence).toBe('verification-link');
    expect(result.verificationPresent).toBe(true);
    expect(query.mock.calls.every(([selector]) => selector === '[data-organization-banners]')).toBe(
      true
    );
    expect(JSON.stringify(result)).not.toContain(ORGANIZATION_ID);
  });

  it.each([
    [
      `https://example.invalid/verify?org=${ORGANIZATION_ID}&return_to=claude&return_path=${encodeURIComponent(`/chat/${CONVERSATION_ID}`)}`,
      'wrong origin',
    ],
    [verificationHref(ORGANIZATION_ID, '99999999-9999-4999-8999-999999999999'), 'wrong route'],
    [verificationHref('not-a-uuid'), 'malformed organization'],
    [`${verificationHref()}&org=${OTHER_ORGANIZATION_ID}`, 'conflicting duplicate org'],
    [`${verificationHref()}&org=${ORGANIZATION_ID}`, 'same-value duplicate org'],
    [`${verificationHref()}&return_to=claude`, 'duplicate return_to'],
    [
      `${verificationHref()}&return_path=${encodeURIComponent(`/chat/${CONVERSATION_ID}`)}`,
      'duplicate return_path',
    ],
    [
      `https://portal.anthropic.com/verify?return_to=claude&return_path=${encodeURIComponent(`/chat/${CONVERSATION_ID}`)}`,
      'missing org',
    ],
    ['https://portal.anthropic.com/verify?%', 'malformed URL'],
  ])('rejects a %s verification-link hint', async (href, _label) => {
    installPage(async url => response(url, list()));
    vi.stubGlobal('performance', { getEntriesByType: () => [] });
    const getItem = vi.fn(() => null);
    vi.stubGlobal('localStorage', { getItem });
    document.body.innerHTML = `<div data-organization-banners><a href="${href}">Verify</a></div>`;

    const result = (await runPage()) as ReturnType<typeof safeResult>;
    expect(fetch).not.toHaveBeenCalled();
    expect(getItem).toHaveBeenCalledExactlyOnceWith('ccd-sync-org');
    expect(result.code).toBe('route-organization-unresolved');
    expect(result.routeOrganizationEvidence).toBe('unresolved');
    expect(JSON.stringify(result)).not.toContain(ORGANIZATION_ID);
    expect(JSON.stringify(result)).not.toContain(OTHER_ORGANIZATION_ID);
  });

  it('uses an exact organization list resource timing hint', async () => {
    installPage(async url => response(url, list()));
    vi.stubGlobal('performance', {
      getEntriesByType: () => [
        {
          name:
            `https://claude.ai/api/organizations/${ORGANIZATION_ID}/chat_conversations_v2` +
            '?limit=30&offset=0&archived=false&consistency=strong',
        },
      ],
    });
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) });

    const result = (await runPage()) as ReturnType<typeof safeResult>;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.routeOrganizationEvidence).toBe('resource-timing');
  });

  it('classifies agreeing resource, verification-link and named-storage hints as multiple-consistent', async () => {
    installPage(async url => response(url, list()));
    const getItem = vi.fn(() => ORGANIZATION_ID);
    vi.stubGlobal('localStorage', { getItem });
    document.body.innerHTML = `<div data-organization-banners><a href="${verificationHref()}">Verify</a></div>`;

    const result = (await runPage()) as ReturnType<typeof safeResult>;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getItem).toHaveBeenCalledExactlyOnceWith('ccd-sync-org');
    expect(result.routeOrganizationEvidence).toBe('multiple-consistent');
    expect(JSON.stringify(result)).not.toContain(ORGANIZATION_ID);
  });

  it('rejects conflicting eligible sources before any request without exposing either ID', async () => {
    installPage(async url => response(url, list()));
    const getItem = vi.fn(() => OTHER_ORGANIZATION_ID);
    vi.stubGlobal('localStorage', { getItem });
    document.body.innerHTML = `<div data-organization-banners><a href="${verificationHref()}">Verify</a></div>`;

    const result = (await runPage()) as ReturnType<typeof safeResult>;
    expect(fetch).not.toHaveBeenCalled();
    expect(result.code).toBe('route-organization-unresolved');
    expect(result.routeOrganizationEvidence).toBe('unresolved');
    expect(result.verificationPresent).toBe(true);
    expect(JSON.stringify(result)).not.toContain(ORGANIZATION_ID);
    expect(JSON.stringify(result)).not.toContain(OTHER_ORGANIZATION_ID);
  });

  it('uses offset+30 only after has_more and labels it as an unproven hypothesis', async () => {
    installPage(async url => {
      const parsed = new URL(url);
      const active = parsed.searchParams.get('archived') === 'false';
      const offset = parsed.searchParams.get('offset');
      return response(url, list([], active && offset === '0'));
    });
    const result = (await runPage()) as ReturnType<typeof safeResult>;
    expect(
      vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url)).searchParams.get('offset'))
    ).toEqual(['0', '0', '30']);
    expect(result.pagination).toEqual({
      exercised: true,
      hypothesis: 'offset-plus-30',
      unfinished: false,
    });
    expect(result.status).toBe('stopped');
    expect(result.code).toBe('scope-unresolved');
  });

  it('counts the failed dispatch, stops without retry, and never exceeds the total cap', async () => {
    const observed: Response[] = [];
    installPage(async url => {
      const call = vi.mocked(fetch).mock.calls.length;
      const value = response(url, list([], true), { status: call === 2 ? 500 : 200 });
      observed.push(value);
      return value;
    });
    const result = (await runPage()) as ReturnType<typeof safeResult>;
    expect(result.code).toBe('unexpected-status');
    expect(result.counts).toMatchObject({ dispatch: 2, page: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((vi.mocked(fetch).mock.calls[1][1]?.signal as AbortSignal).aborted).toBe(true);
    expect(
      (observed[1].body as unknown as { cancel: ReturnType<typeof vi.fn> }).cancel
    ).toHaveBeenCalledOnce();
  });

  it('spends at most four dispatches and reports unfinished pagination at budget exhaustion', async () => {
    installPage(async url => response(url, list([], true)));
    const result = (await runPage()) as ReturnType<typeof safeResult>;
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(result.counts.dispatch).toBe(4);
    expect(result.code).toBe('budget-exhausted');
    expect(result.pagination).toMatchObject({ exercised: true, unfinished: true });
    expect(result.pages.map(page => [page.partition, page.offset])).toEqual([
      ['active', 0],
      ['archived', 0],
      ['active', 30],
      ['archived', 30],
    ]);
  });

  it('counts duplicates, active/archive overlap and archived-flag mismatches without returning IDs', async () => {
    installPage(async url => {
      const archived = new URL(url).searchParams.get('archived') === 'true';
      return response(
        url,
        archived
          ? list([{ uuid: id(1), updated_at: 'm3', is_archived: true }])
          : list([
              { uuid: id(1), updated_at: 'm1', is_archived: false },
              { uuid: id(1), updated_at: 'm2', is_archived: false },
              { uuid: id(2), is_archived: true },
            ])
      );
    });
    const result = (await runPage()) as ReturnType<typeof safeResult>;
    expect(result.counts).toMatchObject({
      record: 4,
      validUuid: 4,
      marker: 3,
      duplicate: 1,
      overlap: 1,
      archivedMismatch: 1,
    });
    expect(JSON.stringify(result)).not.toContain(id(1));
  });

  it.each([
    [{ 'x-organization-workspace-id': 'private-combined' }, 'x-organization-workspace-id'],
    [{ 'x-workspace-count': '27' }, 'x-workspace-count'],
    [{ 'x-org-id': 'private-org', 'x-workspace-name': 'private-name' }, 'x-org-id'],
  ] as const)(
    'keeps ambiguous header evidence unresolved without reading values (%s)',
    async (extraHeaders, expectedName) => {
      installPage(async url => response(url, list(), { headers: extraHeaders }));
      const result = (await runPage()) as ReturnType<typeof safeResult>;
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result.code).toBe('scope-unresolved');
      expect(result.counts).toMatchObject({ dispatch: 2, page: 2 });
      expect(result.scope).toMatchObject({
        organizationResolved: false,
        workspaceResolved: false,
        consistent: false,
        routeOrganizationMatched: false,
        fingerprint: null,
      });
      expect(result.scope.relevantHeaderNames).toContain(expectedName);
      for (const value of Object.values(extraHeaders))
        expect(JSON.stringify(result)).not.toContain(value);
    }
  );

  it('never asks Headers for candidate values while retaining bounded names', async () => {
    const get = vi.fn((name: string) => {
      if (name === 'content-type') return 'application/json';
      if (name === 'content-length') return null;
      throw new Error(`candidate value read: ${name}`);
    });
    installPage(async url => {
      const observed = response(url, list());
      return Object.assign(observed, {
        headers: {
          get,
          keys: () => ['x-organization-workspace-id', 'x-workspace-count'].values(),
        },
      });
    });
    const result = (await runPage()) as ReturnType<typeof safeResult>;
    expect(result.code).toBe('scope-unresolved');
    expect(result.scope.relevantHeaderNames).toEqual([
      'x-organization-workspace-id',
      'x-workspace-count',
    ]);
    expect(get.mock.calls.map(([name]) => name)).toEqual([
      'content-type',
      'content-length',
      'content-type',
      'content-length',
    ]);
  });

  it('caps matching header-name evidence without reading or returning values', async () => {
    const headers = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `x-workspace-hint-${String(index).padStart(2, '0')}`,
        `private-value-${index}`,
      ])
    );
    installPage(async url => response(url, list(), { headers }));
    const result = (await runPage()) as ReturnType<typeof safeResult>;
    expect(result.code).toBe('scope-unresolved');
    expect(result.scope.relevantHeaderNames).toHaveLength(8);
    for (const value of Object.values(headers)) expect(JSON.stringify(result)).not.toContain(value);
  });

  it.each([
    ['redirect', 'unexpected-redirect'],
    ['media', 'unexpected-media-type'],
    ['schema', 'response-schema-invalid'],
  ] as const)('stops without retry on an unexpected %s response', async (scenario, code) => {
    let observed!: Response;
    installPage(async url => {
      if (scenario === 'redirect') observed = response(url, list(), { redirected: true });
      if (scenario === 'media')
        observed = response(url, list(), { headers: { 'content-type': 'text/html' } });
      if (scenario === 'schema')
        observed = response(url, { data: [], has_more: false, extra: true });
      return observed;
    });
    const result = (await runPage()) as ReturnType<typeof safeResult>;
    expect(result.code).toBe(code);
    expect(result.counts.dispatch).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    if (scenario !== 'schema') {
      expect((vi.mocked(fetch).mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
      expect(
        (observed.body as unknown as { cancel: ReturnType<typeof vi.fn> }).cancel
      ).toHaveBeenCalledOnce();
    }
  });

  it('does not retry a rejected request', async () => {
    installPage(async () => {
      throw new Error('private network detail');
    });
    const result = (await runPage()) as ReturnType<typeof safeResult>;
    expect(result.code).toBe('request-failed');
    expect(result.counts.dispatch).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('private network detail');
  });

  it.each([
    [401, 'auth-required'],
    [403, 'auth-required'],
    [429, 'rate-limited'],
  ] as const)('does not retry status %s', async (status, code) => {
    let observed!: Response;
    installPage(async url => {
      observed = response(url, list(), { status });
      return observed;
    });
    if (status === 401 || status === 403)
      document.body.innerHTML = '<div data-organization-banners></div>';
    const result = (await runPage()) as ReturnType<typeof safeResult>;
    expect(result.code).toBe(code);
    expect(result.counts.dispatch).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.verificationPresent).toBe(status === 401 || status === 403);
    expect((vi.mocked(fetch).mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    expect(
      (observed.body as unknown as { cancel: ReturnType<typeof vi.fn> }).cancel
    ).toHaveBeenCalledOnce();
  });

  it('bounds a stalled body by the same deadline and issues no compensation request', async () => {
    let observed!: Response;
    installPage(async url => {
      observed = response(url, list(), { stalled: true });
      return observed;
    });
    const result = (await runPage(20)) as ReturnType<typeof safeResult>;
    expect(result.code).toBe('deadline-exceeded');
    expect(result.counts).toMatchObject({ dispatch: 1, page: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((vi.mocked(fetch).mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    expect(
      (observed.body as unknown as { cancel: ReturnType<typeof vi.fn> }).cancel
    ).toHaveBeenCalledOnce();
  });

  it('aborts a stalled fetch and cancels a response body that settles after the deadline', async () => {
    let settleFetch!: (value: Response) => void;
    installPage(
      () =>
        new Promise(resolve => {
          settleFetch = resolve;
        })
    );
    const pending = runPage(20);
    await vi.waitFor(() => expect(settleFetch).toBeTypeOf('function'));
    const result = (await pending) as ReturnType<typeof safeResult>;
    expect(result.code).toBe('deadline-exceeded');
    expect(result.counts.dispatch).toBe(1);
    expect((vi.mocked(fetch).mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);

    const late = response('late', list());
    settleFetch(late);
    await vi.waitFor(() =>
      expect(
        (late.body as unknown as { cancel: ReturnType<typeof vi.fn> }).cancel
      ).toHaveBeenCalledOnce()
    );
  });

  it('makes zero requests on unresolved route hints', async () => {
    installPage(async url => response(url, list()));
    vi.stubGlobal('performance', { getEntriesByType: () => [] });
    expect((await runPage()) as object).toMatchObject({
      code: 'route-organization-unresolved',
      routeOrganizationEvidence: 'unresolved',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('observes a verification banner from the start without blocking terminal list reads', async () => {
    installPage(async url => response(url, list()));
    document.body.innerHTML = '<div data-organization-banners></div>';
    const result = (await runPage()) as ReturnType<typeof safeResult>;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      schema: 'liska-claude-list-probe/3',
      status: 'stopped',
      code: 'scope-unresolved',
      verificationPresent: true,
      routeOrganizationEvidence: 'resource-timing',
      counts: { dispatch: 2, page: 2, record: 0 },
    });
  });

  it('latches a verification banner that appears during the first request', async () => {
    installPage(async url => {
      if (vi.mocked(fetch).mock.calls.length === 1)
        document.body.innerHTML = '<div data-organization-banners></div>';
      else document.body.innerHTML = '';
      return response(url, list());
    });
    const result = (await runPage()) as ReturnType<typeof safeResult>;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.code).toBe('scope-unresolved');
    expect(result.verificationPresent).toBe(true);
  });
});
