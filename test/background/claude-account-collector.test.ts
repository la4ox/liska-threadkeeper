// @vitest-environment node
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectClaudeAccountCatalog } from '../../src/background/claude-account-collector';
import {
  armCollectorDocument,
  collectClaudeAccountPages,
  disarmCollectorDocument,
  interruptCollectorDocument,
} from '../../src/background/claude-account-collector-page';
import { probeClaudeListsInActiveTab } from '../../src/background/claude-list-probe';
import {
  ClaudeAccountBaselineOwnerError,
  openClaudeAccountBaselineOwner,
} from '../../src/claude-account-baseline-owner';
import {
  collectorSummary,
  snapshotCollectorSummary,
} from '../../src/lib/claude-account-collector-contract';

const org = '22222222-2222-4222-8222-222222222222',
  id = '11111111-1111-4111-8111-111111111111';
const workspace = 'synthetic-private-space',
  marker = 'synthetic-private-marker',
  secretTitle = 'discarded synthetic title';
const route = 'https://claude.ai/chat/' + id,
  token = '33333333-3333-4333-8333-333333333333',
  doc = 'synthetic_doc_1';
const row = { uuid: id, is_archived: false, updated_at: marker, title: secretTitle };
const list = (data: unknown[] = [], has_more = false) => ({ data, has_more });
function reply(
  url: string,
  value: unknown,
  params: {
    workspace?: string | null;
    organization?: string;
    status?: number;
    media?: string;
    redirect?: boolean;
    length?: string;
    raw?: Uint8Array;
    stream?: ReadableStream;
  } = {}
) {
  const headers = new Headers({
    'content-type': params.media ?? 'application/json',
    'anthropic-organization-id': params.organization ?? org,
  });
  if (params.workspace !== null)
    headers.set('anthropic-workspace-id', params.workspace ?? workspace);
  if (params.length !== undefined) headers.set('content-length', params.length);
  const r = new Response(params.stream ?? params.raw ?? JSON.stringify(value), {
    status: params.status ?? 200,
    headers,
  });
  Object.defineProperties(r, {
    url: { value: url },
    redirected: { value: params.redirect ?? false },
  });
  return r;
}
function channel<F extends (...args: never[]) => unknown>() {
  const listeners = new Set<F>();
  return {
    addListener: (f: F) => listeners.add(f),
    removeListener: (f: F) => listeners.delete(f),
    emit: (...args: Parameters<F>) => listeners.forEach(f => f(...args)),
    listeners,
  };
}
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (v: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function harness() {
  const win = { location: { href: route } };
  Object.assign(win, { top: win });
  vi.stubGlobal('window', win);
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), { visibilityState: 'visible', querySelector: () => null })
  );
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('performance', { getEntriesByType: () => [] });
  vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'ccd-sync-org' ? org : null) });
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (init.signal?.aborted) throw Error('cancelled');
    return reply(url, list(url.includes('archived=true') ? [] : [row]));
  });
  vi.stubGlobal('fetch', fetch);
  const tab = { id: 17, windowId: 3, url: route };
  const updated = channel<(id: number, info: chrome.tabs.TabChangeInfo) => void>();
  const tabs = {
    query: vi.fn(async () => [tab]),
    get: vi.fn(async () => tab),
    onUpdated: updated,
    onActivated: channel(),
  };
  let documentId = doc;
  type Injection = {
    target: { frameIds?: number[]; documentIds?: string[] };
    func: (...args: unknown[]) => unknown;
    args: unknown[];
    world: string;
  };
  const executeScript = vi.fn(async (i: Injection) => {
    expect(i.world).toBe('ISOLATED');
    if (i.target.documentIds && !i.target.documentIds.includes(documentId))
      throw Error(secretTitle);
    return [{ result: await i.func(...i.args), frameId: 0, documentId }];
  });
  const browser = {
    tabs,
    scripting: { executeScript },
    windows: { onFocusChanged: channel<(windowId: number) => void>() },
  };
  const owner = {
    read: vi.fn(async () => null),
    createPaused: vi.fn(async (collectionId: string) => ({
      kind: 'created',
      baseline: { collectionId },
    })),
    close: vi.fn(async () => undefined),
  };
  const operations = new Set<number>();
  const deps = {
    source: { tabId: tab.id, windowId: tab.windowId, url: tab.url },
    operations,
    permitted: vi.fn(async () => true),
    browser: browser as never,
    openOwner: vi.fn(async () => owner) as never,
  };
  return {
    fetch,
    tab,
    browser,
    owner,
    deps,
    updated,
    executeScript,
    run: () => collectClaudeAccountCatalog(deps),
    aba: () => {
      updated.emit(tab.id, { url: route + '/other' });
      updated.emit(tab.id, { url: route });
    },
    replaceDoc: () => {
      documentId = 'synthetic_doc_2';
    },
  };
}
afterEach(() => {
  disarmCollectorDocument(token);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('/6 controller', () => {
  it('commits canonical admitted bytes only, then preflights the same owner without network', async () => {
    const h = harness(),
      factory = new IDBFactory();
    const openOwner = () => openClaudeAccountBaselineOwner({ indexedDB: factory });
    const run = () => collectClaudeAccountCatalog({ ...h.deps, openOwner });
    const result = await run();
    expect(result).toEqual(
      collectorSummary('saved', { dispatch: 2, page: 2, target: 1, marker: 1 })
    );
    for (const forbidden of [
      org,
      id,
      marker,
      workspace,
      secretTitle,
      'sha256',
      'collection/1:',
      route,
    ])
      expect(JSON.stringify(result)).not.toContain(forbidden);
    expect(h.fetch.mock.calls.map(([url]) => url)).toEqual(
      [false, true].map(
        a =>
          'https://claude.ai/api/organizations/' +
          org +
          '/chat_conversations_v2?limit=30&offset=0&archived=' +
          a +
          '&consistency=strong'
      )
    );
    for (const [, init] of h.fetch.mock.calls)
      expect(init).toMatchObject({
        method: 'GET',
        mode: 'same-origin',
        credentials: 'include',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
    const all = h.executeScript.mock.calls.map(([i]) => i.target);
    expect(all[0]).toEqual({ tabId: 17, frameIds: [0] });
    expect(all.slice(1).every(i => i.documentIds?.[0] === doc)).toBe(true);
    const owner = await openOwner();
    const stored = await owner.read();
    await owner.close();
    expect(stored?.admission.catalog.targets).toEqual([
      {
        conversationId: id,
        marker: { source: 'claude-chat-conversations-v2.updated_at/1', token: marker },
      },
    ]);
    expect(stored).toMatchObject({
      phase: 'paused',
      items: [{ conversationId: id, state: 'pending' }],
      accountComplete: false,
      executionAuthorized: false,
    });
    for (const privateValue of [workspace, org, secretTitle, route])
      expect(JSON.stringify(stored)).not.toContain(privateValue);
    expect(stored?.collectionId).toMatch(/^claude-account-collection\/1:[a-f0-9]{32}$/u);
    expect(await run()).toEqual(collectorSummary('owner-already-seeded'));
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });
  it.each(['corrupt', 'unsupported', 'transaction-outcome-unknown'] as const)(
    'rejects %s owner before a fetch',
    async err => {
      const h = harness();
      h.owner.read.mockRejectedValue(new ClaudeAccountBaselineOwnerError(err));
      expect((await h.run()).code).toBe(
        err === 'transaction-outcome-unknown' ? 'owner-preflight-unknown' : 'owner-' + err
      );
      expect(h.fetch).not.toHaveBeenCalled();
      expect(h.owner.close).toHaveBeenCalledOnce();
    }
  );
  it('rejects denied permission and non-exact source without network or owner', async () => {
    const h = harness();
    h.deps.permitted.mockResolvedValueOnce(false);
    expect((await h.run()).code).toBe('permission-unavailable');
    h.tab.url += '?x';
    expect((await h.run()).code).toBe('navigation-changed');
    expect(h.deps.openOwner).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it.each(['conflict', 'transaction-aborted', 'transaction-outcome-unknown'] as const)(
    'preserves terminal owner %s without retry',
    async err => {
      const h = harness();
      h.owner.createPaused.mockRejectedValue(new ClaudeAccountBaselineOwnerError(err));
      const r = await h.run();
      expect(r.code).toBe(
        err === 'conflict'
          ? 'owner-conflict'
          : err === 'transaction-aborted'
            ? 'owner-aborted'
            : 'owner-outcome-unknown'
      );
      expect(r.retention).toBe('not-confirmed');
      expect(h.owner.createPaused).toHaveBeenCalledOnce();
      expect(h.owner.close).toHaveBeenCalledOnce();
    }
  );
  it.each(['created', 'already-created'])(
    'admits actual owner %s once despite close failure',
    async kind => {
      const h = harness(),
        hash = vi.fn(async () => new Uint8Array(32));
      h.owner.createPaused.mockImplementation(async collectionId => ({
        kind,
        baseline: { collectionId },
      }));
      h.owner.close.mockRejectedValue(Error(secretTitle));
      expect(await collectClaudeAccountCatalog({ ...h.deps, sha256: hash })).toMatchObject({
        code: 'committed-verification-unavailable',
        retention: 'owner-committed',
      });
      expect(hash).toHaveBeenCalledOnce();
      expect(h.owner.createPaused).toHaveBeenCalledOnce();
    }
  );
  it.each(['tab', 'route', 'window'] as const)(
    'never substitutes a different %s between gesture and worker delivery',
    async changed => {
      const h = harness();
      if (changed === 'tab') h.tab.id++;
      else if (changed === 'window') h.tab.windowId++;
      else h.tab.url = 'https://claude.ai/chat/' + org;
      expect(await h.run()).toEqual(collectorSummary('navigation-changed'));
      expect(h.deps.openOwner).not.toHaveBeenCalled();
      expect(h.fetch).not.toHaveBeenCalled();
      expect(h.owner.createPaused).not.toHaveBeenCalled();
    }
  );
  it.each(['empty', 'different'] as const)(
    'does not read archived or write an owner without selected chat in %s active list',
    async fixture => {
      const h = harness();
      h.fetch.mockImplementationOnce(async url =>
        reply(url, list(fixture === 'empty' ? [] : [{ ...row, uuid: token }]))
      );
      const r = await h.run();
      expect(r).toEqual(
        collectorSummary('selected-chat-not-in-active-list', {
          dispatch: 1,
          page: 1,
          target: fixture === 'empty' ? 0 : 1,
          marker: fixture === 'empty' ? 0 : 1,
        })
      );
      expect(h.fetch).toHaveBeenCalledOnce();
      expect(h.owner.createPaused).not.toHaveBeenCalled();
      expect(snapshotCollectorSummary(r)).toEqual(r);
    }
  );
  it.each(['get', 'query', 'missing-url', 'empty-selection', 'scripting'] as const)(
    'reports committed verification unavailable, not changed, on final %s failure',
    async mode => {
      const h = harness();
      h.owner.createPaused.mockImplementationOnce(async collectionId => {
        if (mode === 'get') h.browser.tabs.get.mockRejectedValueOnce(Error(secretTitle));
        else if (mode === 'query') h.browser.tabs.query.mockRejectedValueOnce(Error(secretTitle));
        else if (mode === 'missing-url')
          h.browser.tabs.get.mockResolvedValueOnce({ ...h.tab, url: undefined } as never);
        else if (mode === 'empty-selection') h.browser.tabs.query.mockResolvedValueOnce([]);
        else h.executeScript.mockRejectedValueOnce(Error(secretTitle));
        return { kind: 'created', baseline: { collectionId } };
      });
      expect(await h.run()).toMatchObject({
        status: 'stopped',
        code: 'committed-verification-unavailable',
        retention: 'owner-committed',
      });
    }
  );
  it('distinguishes a timely commit followed by slow close from a late write', async () => {
    const h = harness(),
      started = deferred<boolean>(),
      closing = deferred<void>();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    h.owner.close.mockImplementationOnce(() => {
      started.resolve(true);
      return closing.promise;
    });
    const run = collectClaudeAccountCatalog({ ...h.deps, timeoutMs: 50 });
    await started.promise;
    expect(h.owner.createPaused).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(51);
    expect(await run).toMatchObject({
      code: 'committed-verification-deadline',
      retention: 'owner-committed',
    });
    expect(h.deps.operations.size).toBe(1);
    closing.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.deps.operations.size).toBe(0);
  });
  it.each(['no-focus', 'same-url-loading', 'empty-url'] as const)(
    'stops on %s without claiming a document replacement',
    async event => {
      const h = harness();
      h.deps.permitted.mockImplementationOnce(async () => {
        if (event === 'no-focus') h.browser.windows.onFocusChanged.emit(-1);
        else
          h.updated.emit(
            h.tab.id,
            event === 'empty-url' ? { url: '' } : { url: route, status: 'loading' }
          );
        return true;
      });
      const result = await h.run();
      expect(result).toEqual(collectorSummary('source-verification-unavailable'));
      expect(h.fetch).not.toHaveBeenCalled();
      expect(h.deps.openOwner).not.toHaveBeenCalled();
    }
  );
  it.each([
    'rejection',
    'empty',
    'ambiguous',
    'child-frame',
    'bad-id',
    'accessor-id',
    'accessor-result',
    'not-ready',
    'replacement',
  ] as const)('requires one valid top-frame ID contradicting the pin: %s', async fixture => {
    const h = harness(),
      getter = vi.fn(() => {
        throw Error(secretTitle);
      });
    const changed = { frameId: 0, documentId: 'synthetic_other_document', result: { ready: true } };
    h.owner.read.mockImplementationOnce(async () => {
      h.executeScript.mockImplementationOnce(async () => {
        if (fixture === 'rejection') throw Error(secretTitle);
        if (fixture === 'empty') return [];
        if (fixture === 'ambiguous') return [changed, changed];
        if (fixture === 'child-frame') return [{ ...changed, frameId: 2 }];
        if (fixture === 'bad-id') return [{ ...changed, documentId: '?' }];
        if (fixture === 'accessor-id')
          return [Object.defineProperty({ ...changed }, 'documentId', { get: getter })];
        if (fixture === 'accessor-result')
          return [
            Object.defineProperty({ ...changed, documentId: doc }, 'result', { get: getter }),
          ];
        if (fixture === 'not-ready')
          return [{ ...changed, documentId: doc, result: { ready: false } }];
        return [changed];
      });
      return null;
    });
    const result = await h.run();
    expect(result).toEqual(
      collectorSummary(
        fixture === 'replacement' ? 'document-replaced' : 'source-verification-unavailable'
      )
    );
    expect(getter).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.owner.createPaused).not.toHaveBeenCalled();
  });
  it.each([
    [1, 0],
    [1, 1],
    [2, 1],
    [2, 2],
  ] as const)(
    'retains confirmed %i/%i when the subsequent pinned teardown RPC cannot verify the source',
    async (dispatch, page) => {
      const h = harness();
      h.fetch.mockImplementation(async url => {
        if (
          (dispatch === 1 && page === 0) ||
          (dispatch === 2 && page === 1 && url.includes('archived=true'))
        )
          return reply(url, list(), { status: 403 });
        if (dispatch === 1 && page === 1) return reply(url, list());
        return reply(url, list(url.includes('archived=true') ? [] : [row]));
      });
      const original = h.executeScript.getMockImplementation()!;
      let first = true;
      h.executeScript.mockImplementation(async i => {
        if (first && i.func === disarmCollectorDocument) {
          first = false;
          throw Error(secretTitle);
        }
        return original(i);
      });
      const result = await h.run();
      expect(result).toMatchObject({
        code: 'source-verification-unavailable',
        dispatch,
        page,
        retention: 'not-confirmed',
      });
      expect(snapshotCollectorSummary(result)).toEqual(result);
      expect(h.owner.createPaused).not.toHaveBeenCalled();
    }
  );
  it('a commit winning a no-focus cancellation has unavailable verification, not an observed navigation', async () => {
    const h = harness();
    h.owner.createPaused.mockImplementationOnce(async collectionId => {
      h.browser.windows.onFocusChanged.emit(-1);
      return { kind: 'created', baseline: { collectionId } };
    });
    expect(await h.run()).toMatchObject({
      status: 'stopped',
      code: 'committed-verification-unavailable',
      retention: 'owner-committed',
    });
    expect(h.owner.close).toHaveBeenCalledOnce();
    expect(h.owner.createPaused).toHaveBeenCalledOnce();
  });
  it('keeps a page-only visibility interruption neutral through projection, public validation and owner cleanup', async () => {
    const h = harness(),
      reading = deferred<boolean>(),
      cancel = vi.fn();
    const stream = new ReadableStream(
      {
        pull() {
          reading.resolve(true);
        },
        cancel,
      },
      { highWaterMark: 0 }
    );
    h.fetch.mockImplementationOnce(async u => reply(u, null, { stream }));
    const run = h.run();
    await reading.promise;
    Object.assign(document, { visibilityState: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    const result = await run;
    expect(result).toEqual(
      collectorSummary('source-verification-unavailable', {
        dispatch: 1,
        page: 0,
        target: 0,
        marker: 0,
      })
    );
    expect(snapshotCollectorSummary(result)).toEqual(result);
    expect(cancel).toHaveBeenCalledOnce();
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.owner.createPaused).not.toHaveBeenCalled();
    expect(h.owner.close).toHaveBeenCalledOnce();
  });
  it('does not confirm a terminal receipt carrying another collection label', async () => {
    const h = harness();
    h.owner.createPaused.mockResolvedValue({
      kind: 'already-created',
      baseline: { collectionId: 'another' },
    });
    expect(await h.run()).toMatchObject({
      code: 'owner-outcome-unknown',
      retention: 'not-confirmed',
    });
    expect(h.owner.createPaused).toHaveBeenCalledOnce();
  });
  it('does not infer replacement when the pinned lookup rejects after the digest', async () => {
    const h = harness();
    const r = await collectClaudeAccountCatalog({
      ...h.deps,
      sha256: async () => {
        h.replaceDoc();
        return new Uint8Array(32);
      },
    });
    expect(r).toMatchObject({
      status: 'stopped',
      code: 'source-verification-unavailable',
      dispatch: 2,
      page: 2,
    });
    expect(h.owner.createPaused).not.toHaveBeenCalled();
  });
  it.each(['resolve', 'reject'] as const)(
    'consumes late digest %s; keeps cross-version lock and never commits',
    async how => {
      const h = harness(),
        hash = deferred<Uint8Array>(),
        started = deferred<boolean>();
      const pending = collectClaudeAccountCatalog({
        ...h.deps,
        sha256: () => {
          started.resolve(true);
          return hash.promise;
        },
      });
      await started.promise;
      h.aba();
      expect((await pending).code).toBe('navigation-changed');
      expect(h.deps.operations.has(17)).toBe(true);
      expect(
        await probeClaudeListsInActiveTab({
          chromeApi: h.browser as never,
          operations: h.deps.operations,
        })
      ).toMatchObject({ code: 'operation-in-progress' });
      if (how === 'resolve') hash.resolve(new Uint8Array(32));
      else hash.reject(Error(secretTitle));
      await vi.waitFor(() => expect(h.deps.operations.size).toBe(0));
      expect(h.owner.createPaused).not.toHaveBeenCalled();
      expect(h.updated.listeners.size).toBe(0);
    }
  );
  it('a digest outlasting the absolute request budget can never hand off on late completion', async () => {
    const h = harness(),
      digest = deferred<Uint8Array>(),
      started = deferred<boolean>();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const pending = collectClaudeAccountCatalog({
      ...h.deps,
      timeoutMs: 50,
      sha256: () => {
        started.resolve(true);
        return digest.promise;
      },
    });
    await started.promise;
    await vi.advanceTimersByTimeAsync(51);
    expect((await pending).code).toBe('deadline-exceeded');
    expect(h.owner.close).toHaveBeenCalledOnce();
    digest.resolve(new Uint8Array(32));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.owner.createPaused).not.toHaveBeenCalled();
    expect(h.deps.operations.size).toBe(0);
  });
  it('the same-invocation scope cannot be copied into a retained target field', async () => {
    const h = harness();
    h.fetch.mockImplementationOnce(async url =>
      reply(url, list([{ ...row, updated_at: workspace }]))
    );
    expect((await h.run()).code).toBe('admission-rejected');
    expect(h.owner.createPaused).not.toHaveBeenCalled();
  });
  it('does not join a prior operation or a foreign token in the isolated document', async () => {
    const h = harness();
    h.deps.operations.add(17);
    expect((await h.run()).code).toBe('operation-in-progress');
    h.deps.operations.delete(17);
    armCollectorDocument(route, token);
    expect((await h.run()).code).toBe('source-verification-unavailable');
    expect(interruptCollectorDocument(token, 'navigation-changed')).toEqual({ marked: true });
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('latches a source change while a request and marker injection are still pending', async () => {
    const h = harness(),
      pendingFetch = deferred<Response>(),
      started = deferred<boolean>(),
      signalRelease = deferred<boolean>();
    h.fetch.mockImplementationOnce(async () => {
      started.resolve(true);
      return pendingFetch.promise;
    });
    const original = h.executeScript.getMockImplementation()!;
    h.executeScript.mockImplementation(async i => {
      if (i.func === interruptCollectorDocument) await signalRelease.promise;
      return original(i);
    });
    const pending = h.run();
    await started.promise;
    h.aba();
    expect((await pending).code).toBe('navigation-changed');
    expect(h.deps.operations.size).toBe(1);
    expect(h.updated.listeners.size).toBe(1);
    signalRelease.resolve(true);
    pendingFetch.resolve(reply(route, list([row])));
    await vi.waitFor(() => expect(h.deps.operations.size).toBe(0));
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.owner.createPaused).not.toHaveBeenCalled();
  });
  it('deadline stops a late open, closes its handle and never reads or fetches', async () => {
    const h = harness(),
      opening = deferred<typeof h.owner>(),
      start = deferred<boolean>();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const pending = collectClaudeAccountCatalog({
      ...h.deps,
      timeoutMs: 20,
      openOwner: async () => {
        start.resolve(true);
        return opening.promise as never;
      },
    });
    await start.promise;
    await vi.advanceTimersByTimeAsync(21);
    expect((await pending).code).toBe('deadline-exceeded');
    opening.resolve(h.owner);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.owner.close).toHaveBeenCalledOnce();
    expect(h.owner.read).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it.each(['navigation', 'deadline'] as const)(
    'awaits commit winning %s cancellation and preserves native truth',
    async reason => {
      const h = harness(),
        write = deferred<{ kind: string; baseline: { collectionId: string } }>(),
        started = deferred<AbortSignal>();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      h.owner.createPaused.mockImplementation((...args: unknown[]) => {
        started.resolve(args[2] as AbortSignal);
        return write.promise;
      });
      const pending = collectClaudeAccountCatalog({ ...h.deps, timeoutMs: 50 });
      const signal = await started.promise;
      if (reason === 'navigation') h.aba();
      else await vi.advanceTimersByTimeAsync(51);
      expect(signal.aborted).toBe(true);
      expect(h.deps.operations.size).toBe(1);
      expect(h.owner.close).not.toHaveBeenCalled();
      write.resolve({
        kind: 'created',
        baseline: { collectionId: h.owner.createPaused.mock.calls[0][0] },
      });
      const result = await pending;
      expect(result).toMatchObject({
        status: 'stopped',
        retention: 'owner-committed',
        code:
          reason === 'deadline' ? 'committed-verification-deadline' : 'committed-context-changed',
      });
      expect(snapshotCollectorSummary(result)).toEqual(result);
      expect(h.owner.close).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(0); // an expired result does not wait for cleanup
      expect(h.deps.operations.size).toBe(0);
    }
  );
  it('retains commit truth when the postcommit pin is replaced', async () => {
    const h = harness();
    h.owner.createPaused.mockImplementation(async collectionId => {
      h.replaceDoc();
      return { kind: 'created', baseline: { collectionId } };
    });
    expect(await h.run()).toMatchObject({
      code: 'committed-verification-unavailable',
      retention: 'owner-committed',
    });
  });
});
describe('/6 bounded private page', () => {
  function start() {
    armCollectorDocument(route, token);
    return collectClaudeAccountPages(route, Date.now() + 1000, token);
  }
  it.each([
    ['scope-pair-mismatch', 2, 'pair'],
    ['scope-header-invalid', 1, 'invalid-workspace'],
    ['scope-header-missing', 2, 'missing'],
    ['scope-route-mismatch', 2, 'org'],
    ['unexpected-status', 1, 'status'],
    ['auth-required', 1, 'auth'],
    ['rate-limited', 1, 'rate'],
    ['unexpected-media-type', 1, 'media'],
    ['unexpected-redirect', 1, 'redirect'],
    ['response-too-large', 1, 'length'],
    ['response-too-large', 1, 'oversize'],
    ['response-schema-invalid', 1, 'utf8'],
    ['response-schema-invalid', 1, 'json'],
    ['active-pagination-unsupported', 1, 'active-more'],
    ['archived-pagination-unsupported', 2, 'archive-more'],
    ['nonempty-archived-unsupported', 2, 'archive-row'],
    ['response-schema-invalid', 1, 'marker'],
    ['response-schema-invalid', 1, 'duplicates'],
    ['response-schema-invalid', 1, 'flag'],
    ['response-schema-invalid', 1, 'too-many'],
  ] as const)('stops with %s after %i requests (%s)', async (code, n, kind) => {
    const h = harness();
    h.fetch.mockImplementation(async url => {
      const archived = url.includes('archived=true');
      if (archived && kind === 'pair') return reply(url, list(), { workspace: 'other' });
      if (archived && kind === 'org') return reply(url, list(), { organization: id });
      if (archived && kind === 'missing') return reply(url, list(), { workspace: null });
      if (kind === 'invalid-workspace') return reply(url, list(), { workspace: 'bad workspace' });
      if (kind === 'redirect') return reply(url, list(), { redirect: true });
      if (kind === 'status' || kind === 'auth' || kind === 'rate')
        return reply(url, list(), {
          status: kind === 'status' ? 500 : kind === 'auth' ? 403 : 429,
        });
      if (kind === 'media') return reply(url, list(), { media: 'text/html' });
      if (kind === 'length') return reply(url, list(), { length: '524289' });
      if (kind === 'utf8' || kind === 'oversize' || kind === 'json')
        return reply(url, null, {
          raw:
            kind === 'utf8'
              ? new Uint8Array([255])
              : kind === 'oversize'
                ? new Uint8Array(524289)
                : new Uint8Array([123]),
        });
      if (kind === 'active-more' || (archived && kind === 'archive-more'))
        return reply(url, list([], true));
      if (
        (archived && kind === 'archive-row') ||
        kind === 'flag' ||
        kind === 'marker' ||
        kind === 'duplicates' ||
        kind === 'too-many'
      )
        return reply(
          url,
          list(
            kind === 'flag'
              ? [{ ...row, is_archived: true }]
              : kind === 'marker'
                ? [{ ...row, updated_at: '' }]
                : kind === 'duplicates'
                  ? [row, row]
                  : kind === 'too-many'
                    ? Array(31).fill(row)
                    : [row]
          )
        );
      return reply(url, list(archived ? [] : [row]));
    });
    const result = await start();
    expect(result).toMatchObject({ kind: 'stopped', code, dispatch: n });
    expect(h.fetch).toHaveBeenCalledTimes(n);
    for (const forbidden of [org, id, marker, workspace, secretTitle])
      expect(JSON.stringify(result)).not.toContain(forbidden);
  });
  it('rejects conflicting hints before either fetch', async () => {
    const h = harness();
    vi.stubGlobal('performance', {
      getEntriesByType: () => [
        { name: 'https://claude.ai/api/organizations/' + id + '/chat_conversations_v2' },
      ],
    });
    expect(await start()).toMatchObject({ code: 'route-organization-unresolved' });
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('waits for the active body before requesting the empty archive', async () => {
    const h = harness();
    let feed!: ReadableStreamDefaultController;
    const stream = new ReadableStream({
      start(c) {
        feed = c;
      },
    });
    h.fetch.mockImplementationOnce(async url => reply(url, null, { stream }));
    const pending = start();
    await new Promise(setImmediate);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    feed.enqueue(new TextEncoder().encode(JSON.stringify(list([row]))));
    feed.close();
    expect(await pending).toEqual({
      kind: 'projected',
      organization: org,
      workspace,
      routeOrganization: org,
      active: [{ uuid: id, is_archived: false, updated_at: marker }],
    });
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });
  it.each(['late-fetch', 'late-body'] as const)(
    'cancels %s on one deadline without a second request',
    async phase => {
      const h = harness();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      const late = deferred<Response>(),
        cancel = vi.fn(),
        stream = new ReadableStream({ cancel });
      h.fetch.mockImplementationOnce(async url =>
        phase === 'late-fetch' ? late.promise : reply(url, null, { stream })
      );
      const pending = start();
      await vi.advanceTimersByTimeAsync(1001);
      expect(await pending).toMatchObject({ code: 'deadline-exceeded', dispatch: 1 });
      if (phase === 'late-fetch') late.resolve(reply(route, null, { stream }));
      await vi.advanceTimersByTimeAsync(0);
      expect(cancel).toHaveBeenCalledOnce();
      expect(h.fetch).toHaveBeenCalledTimes(1);
    }
  );
  it.each(['missing', 'foreign', 'hidden', 'not-top', 'invalid-route'] as const)(
    'cannot claim navigation from %s source verification alone',
    async fixture => {
      const h = harness();
      armCollectorDocument(route, token);
      const root = globalThis as unknown as Record<string, unknown>;
      if (fixture === 'missing') disarmCollectorDocument(token);
      if (fixture === 'foreign')
        root.__liskaClaudeListProbeNavigation_v1 = {
          ownerToken: id,
          stopReason: 'navigation-changed',
          cancel: null,
        };
      if (fixture === 'hidden') Object.assign(document, { visibilityState: 'hidden' });
      if (fixture === 'not-top') Object.assign(window, { top: {} });
      const selected = fixture === 'invalid-route' ? route + '?unbound' : route;
      try {
        expect(await collectClaudeAccountPages(selected, Date.now() + 1000, token)).toMatchObject({
          code: 'source-verification-unavailable',
          dispatch: 0,
          page: 0,
        });
        expect(h.fetch).not.toHaveBeenCalled();
        if (fixture === 'foreign')
          expect(root.__liskaClaudeListProbeNavigation_v1).toEqual({
            ownerToken: id,
            stopReason: 'navigation-changed',
            cancel: null,
          });
      } finally {
        if (fixture === 'foreign') disarmCollectorDocument(id);
      }
    }
  );
  it.each([
    'hidden',
    'foreign',
    'removed',
    'same-token-replacement',
    'changed-url',
    'sticky-navigation',
    'neutral-worker',
    'deadline-worker',
  ] as const)(
    'preserves the actual interruption cause with an outstanding body read: %s',
    async fixture => {
      const h = harness(),
        reading = deferred<boolean>(),
        cancel = vi.fn();
      let readerControl!: ReadableStreamDefaultController;
      const stream = new ReadableStream(
        {
          start(c) {
            readerControl = c;
          },
          pull() {
            reading.resolve(true);
          },
          cancel,
        },
        { highWaterMark: 0 }
      );
      h.fetch.mockImplementationOnce(async url => reply(url, null, { stream }));
      const run = start();
      await reading.promise;
      const root = globalThis as unknown as Record<string, unknown>;
      const pageDocument = document as unknown as { visibilityState: string };
      if (fixture === 'hidden') {
        pageDocument.visibilityState = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
        pageDocument.visibilityState = 'visible';
      } else if (fixture === 'sticky-navigation')
        interruptCollectorDocument(token, 'navigation-changed');
      else if (fixture === 'neutral-worker')
        interruptCollectorDocument(token, 'source-verification-unavailable');
      else if (fixture === 'deadline-worker')
        interruptCollectorDocument(token, 'deadline-exceeded');
      else {
        if (fixture === 'changed-url') window.location.href = route + '/other';
        else if (fixture === 'removed') disarmCollectorDocument(token);
        else
          root.__liskaClaudeListProbeNavigation_v1 = {
            ownerToken: fixture === 'foreign' ? id : token,
            stopReason: 'navigation-changed',
            cancel: null,
          };
        readerControl.enqueue(new Uint8Array([123]));
      }
      try {
        const expected =
          fixture === 'changed-url' || fixture === 'sticky-navigation'
            ? 'navigation-changed'
            : fixture === 'deadline-worker'
              ? 'deadline-exceeded'
              : 'source-verification-unavailable';
        expect(await run).toMatchObject({ kind: 'stopped', code: expected, dispatch: 1, page: 0 });
        expect(cancel).toHaveBeenCalledOnce();
        expect(h.fetch).toHaveBeenCalledOnce();
        if (fixture === 'foreign')
          expect(root.__liskaClaudeListProbeNavigation_v1).toMatchObject({
            ownerToken: id,
            stopReason: 'navigation-changed',
            cancel: null,
          });
      } finally {
        if (fixture === 'foreign') disarmCollectorDocument(id);
      }
    }
  );
  it('a stale owner cannot signal the new marker or upgrade its first reason to navigation', async () => {
    const h = harness();
    armCollectorDocument(route, token);
    expect(interruptCollectorDocument(id, 'navigation-changed')).toEqual({ marked: false });
    expect(interruptCollectorDocument(token, 'source-verification-unavailable')).toEqual({
      marked: true,
    });
    expect(interruptCollectorDocument(token, 'navigation-changed')).toEqual({ marked: true });
    expect(await collectClaudeAccountPages(route, Date.now() + 1000, token)).toMatchObject({
      code: 'source-verification-unavailable',
      dispatch: 0,
      page: 0,
    });
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('honors a pre-start token marker across A to B to A', async () => {
    const h = harness();
    armCollectorDocument(route, token);
    expect(interruptCollectorDocument(token, 'navigation-changed')).toEqual({ marked: true });
    expect(await collectClaudeAccountPages(route, Date.now() + 1000, token)).toMatchObject({
      code: 'navigation-changed',
    });
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
