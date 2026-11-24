import type { PageStopCode } from '../lib/claude-account-collector-contract';

type InterruptReason = Extract<
  PageStopCode,
  'navigation-changed' | 'deadline-exceeded' | 'source-verification-unavailable'
>;
interface CollectorMarker {
  ownerToken: string;
  stopReason: InterruptReason | null;
  cancel: (() => void) | null;
}

/** Install before dispatch so that even a marker arriving BEFORE the collector starts wins. */
export function armCollectorDocument(expectedUrl: string, ownerToken: string) {
  const root = globalThis as unknown as Record<string, unknown>;
  if (
    root.__liskaClaudeListProbeNavigation_v1 !== undefined ||
    window.top !== window ||
    window.location.href !== expectedUrl ||
    document.visibilityState !== 'visible'
  )
    return false;
  root.__liskaClaudeListProbeNavigation_v1 = {
    ownerToken,
    stopReason: null,
    cancel: null,
  } satisfies CollectorMarker;
  return true;
}

/** One sticky, token-owned reason. Unknown verification and deadline must never mark navigation. */
export function interruptCollectorDocument(ownerToken: string, reason: InterruptReason) {
  const data = (value: unknown, key: string): unknown => {
    if (!value || typeof value !== 'object') return;
    return Object.getOwnPropertyDescriptor(value, key)?.value;
  };
  const validReason = (v: unknown): v is InterruptReason =>
    typeof v === 'string' &&
    ['navigation-changed', 'deadline-exceeded', 'source-verification-unavailable'].includes(v);
  try {
    if (
      typeof ownerToken !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(ownerToken) ||
      !validReason(reason)
    )
      return { marked: false };
    const state = data(globalThis, '__liskaClaudeListProbeNavigation_v1');
    if (data(state, 'ownerToken') !== ownerToken) return { marked: false };
    const previous = data(state, 'stopReason'),
      cancel = data(state, 'cancel');
    if (
      (previous !== null && !validReason(previous)) ||
      (cancel !== null && typeof cancel !== 'function')
    )
      return { marked: false };
    if (previous === null) (state as CollectorMarker).stopReason = reason;
    if (typeof cancel === 'function') cancel();
    return { marked: true };
  } catch {
    return { marked: false };
  }
}

export function disarmCollectorDocument(ownerToken: string) {
  const root = globalThis as unknown as Record<string, { ownerToken?: string } | undefined>;
  if (root.__liskaClaudeListProbeNavigation_v1?.ownerToken === ownerToken)
    delete root.__liskaClaudeListProbeNavigation_v1;
}

/** Chrome serializes just this function in the pinned ISOLATED document. No module captures. */
// eslint-disable-next-line max-lines-per-function -- The complete isolated transport and its cancellation state must be serializable together.
export async function collectClaudeAccountPages(
  expectedUrl: string,
  deadline: number,
  ownerToken: string
): Promise<unknown> {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
  // Project admission envelope only, not provider grammar or evidence of personal identity.
  const workspacePattern = /^[A-Za-z0-9._~-]{1,128}$/u;
  const chatPathPattern =
    /^\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u;
  const listPathPattern =
    /^\/api\/organizations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/chat_conversations_v2$/u;
  const detailPathPattern =
    /^\/api\/organizations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/chat_conversations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u;
  // Keep the same three bounded hints as /5. Agreement selects a route, not an identity claim.
  // eslint-disable-next-line max-lines-per-function, complexity -- The serialized function reconciles the three exact hint sources locally.
  const resolveRouteOrganization = (conversationId: string): string | undefined => {
    const candidates = new Set<string>();
    const add = (organization: string) => {
      if (uuidPattern.test(organization)) candidates.add(organization);
    };
    let entries: PerformanceEntry[];
    try {
      entries = performance.getEntriesByType('resource').slice(-128);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      let url: URL;
      try {
        url = new URL(entry.name);
      } catch {
        continue;
      }
      if (url.origin !== 'https://claude.ai' || url.username || url.password || url.hash) continue;
      const listMatch = listPathPattern.exec(url.pathname);
      const detailMatch = detailPathPattern.exec(url.pathname);
      if (listMatch) add(listMatch[1]);
      if (!url.search && detailMatch && detailMatch[2] === conversationId) add(detailMatch[1]);
    }
    try {
      const banner = document.querySelector('[data-organization-banners]');
      if (banner) {
        const links = banner.querySelectorAll<HTMLAnchorElement>(
          'a[href^="https://portal.anthropic.com/verify?"]'
        );
        for (let index = 0; index < Math.min(links.length, 32); index += 1) {
          let url: URL;
          try {
            url = new URL(links[index].href);
          } catch {
            continue;
          }
          if (
            url.origin !== 'https://portal.anthropic.com' ||
            url.pathname !== '/verify' ||
            url.username ||
            url.password ||
            url.hash
          )
            continue;
          const organizations = url.searchParams.getAll('org');
          const returnTargets = url.searchParams.getAll('return_to');
          const returnPaths = url.searchParams.getAll('return_path');
          if (
            organizations.length !== 1 ||
            returnTargets.length !== 1 ||
            returnPaths.length !== 1 ||
            returnTargets[0] !== 'claude' ||
            returnPaths[0] !== `/chat/${conversationId}`
          )
            continue;
          add(organizations[0]);
        }
      }
    } catch {
      // The exact named banner/link hint is optional.
    }
    try {
      const organization = localStorage.getItem('ccd-sync-org');
      if (organization !== null) add(organization);
    } catch {
      // Named storage can be unavailable; no other key is eligible.
    }
    return candidates.size === 1 ? candidates.values().next().value : undefined;
  };

  const marker = (): CollectorMarker | undefined =>
    Object.getOwnPropertyDescriptor(globalThis, '__liskaClaudeListProbeNavigation_v1')?.value;
  const state = marker();
  const progress = { dispatch: 0, page: 0, target: 0, marker: 0 };
  const stop = (code: PageStopCode) => ({ kind: 'stopped', code, ...progress });
  class Stop {
    constructor(readonly code: PageStopCode) {}
  }
  let localReason: InterruptReason | undefined;
  // Check ownership before trusting any sticky evidence, including a navigation marker.
  const ownsMarker = () =>
    state &&
    marker() === state &&
    Object.getOwnPropertyDescriptor(state, 'ownerToken')?.value === ownerToken;
  function interruption(): InterruptReason | undefined {
    try {
      if (!ownsMarker() || window.top !== window) return 'source-verification-unavailable';
      if (localReason) return localReason;
      const reason = Object.getOwnPropertyDescriptor(state!, 'stopReason')?.value;
      if (reason !== null)
        return reason === 'navigation-changed' || reason === 'deadline-exceeded'
          ? reason
          : 'source-verification-unavailable';
      const href = window.location.href;
      if (typeof href !== 'string' || !href) return 'source-verification-unavailable';
      if (href !== expectedUrl) return 'navigation-changed';
      if (document.visibilityState !== 'visible') return 'source-verification-unavailable';
      if (!Number.isSafeInteger(deadline) || Date.now() >= deadline) return 'deadline-exceeded';
    } catch {
      return 'source-verification-unavailable';
    }
  }
  function check() {
    const reason = interruption();
    if (reason) throw new Stop(reason);
  }
  const interrupt = new AbortController();
  const cancel = () => interrupt.abort();
  const latch = (reason: InterruptReason) => {
    localReason ??= reason;
    cancel();
  };
  const interruptFromMarker = () => latch(interruption() ?? 'source-verification-unavailable');
  const visibility = () => {
    const reason = interruption();
    if (reason) latch(reason);
  };
  const wait = <T>(work: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const interrupted = () =>
        reject(new Stop(interruption() ?? 'source-verification-unavailable'));
      interrupt.signal.addEventListener('abort', interrupted, { once: true });
      work
        .then(resolve, reject)
        .finally(() => interrupt.signal.removeEventListener('abort', interrupted));
      if (interrupt.signal.aborted) interrupted();
    });
  let routeOrganization = '';
  type Pair = { organization: string; workspace: string };
  let anchor: Pair | undefined;
  const scope = (response: Response): Pair => {
    const organization = response.headers.get('anthropic-organization-id');
    const workspace = response.headers.get('anthropic-workspace-id');
    if (organization === null || workspace === null) throw new Stop('scope-header-missing');
    if (
      organization.length !== 36 ||
      !uuidPattern.test(organization) ||
      !workspacePattern.test(workspace)
    )
      throw new Stop('scope-header-invalid');
    if (organization !== routeOrganization) throw new Stop('scope-route-mismatch');
    if (anchor && (organization !== anchor.organization || workspace !== anchor.workspace))
      throw new Stop('scope-pair-mismatch');
    return { organization, workspace };
  };
  const unread = (r: Response) => {
    try {
      void r.body?.cancel().catch(() => undefined);
    } catch {
      /* already closed */
    }
  };
  async function body(r: Response) {
    const max = 512 * 1024;
    const length = r.headers.get('content-length');
    if (length !== null && (!/^\d{1,10}$/u.test(length) || Number(length) > max))
      throw new Stop('response-too-large');
    const reader = r.body?.getReader();
    if (!reader) throw new Stop('response-schema-invalid');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        check();
        const next = await wait(reader.read());
        check();
        if (next.done) break;
        if (
          !ArrayBuffer.isView(next.value) ||
          Object.prototype.toString.call(next.value) !== '[object Uint8Array]'
        )
          throw new Stop('response-schema-invalid');
        size += next.value.byteLength;
        if (size > max) throw new Stop('response-too-large');
        chunks.push(next.value);
      }
    } catch (error) {
      try {
        void reader.cancel().catch(() => undefined);
      } catch {
        /* already closed */
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  }
  type Row = { uuid: string; is_archived: false; updated_at?: string };
  function project(value: unknown, archived: boolean): Row[] {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(value, 'data') ||
      !Object.prototype.hasOwnProperty.call(value, 'has_more')
    )
      throw new Stop('response-schema-invalid');
    const envelope = value as { data: unknown; has_more: unknown };
    if (!Array.isArray(envelope.data) || typeof envelope.has_more !== 'boolean')
      throw new Stop('response-schema-invalid');
    if (envelope.has_more)
      throw new Stop(
        archived ? 'archived-pagination-unsupported' : 'active-pagination-unsupported'
      );
    if (archived && envelope.data.length) throw new Stop('nonempty-archived-unsupported');
    if (envelope.data.length > 30) throw new Stop('response-schema-invalid');
    const seen = new Set<string>();
    return envelope.data.map((item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length > 64)
        throw new Stop('response-schema-invalid');
      const { uuid, is_archived, updated_at } = item as Record<string, unknown>;
      if (
        typeof uuid !== 'string' ||
        uuid.length !== 36 ||
        !uuidPattern.test(uuid) ||
        seen.has(uuid) ||
        is_archived !== false
      )
        throw new Stop('response-schema-invalid');
      seen.add(uuid);
      if (!Object.prototype.hasOwnProperty.call(item, 'updated_at'))
        return { uuid, is_archived: false };
      if (typeof updated_at !== 'string' || !updated_at.length || updated_at.length > 256)
        throw new Stop('response-schema-invalid');
      return { uuid, is_archived: false, updated_at };
    });
  }
  function checkResponse(response: Response, url: string) {
    if (response.status === 401 || response.status === 403) throw new Stop('auth-required');
    if (response.status === 429) throw new Stop('rate-limited');
    if (response.status !== 200) throw new Stop('unexpected-status');
    if (response.redirected || response.url !== url) throw new Stop('unexpected-redirect');
    if (
      response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !==
      'application/json'
    )
      throw new Stop('unexpected-media-type');
  }
  const countRows = (rows: Row[]) => {
    progress.target = rows.length;
    progress.marker = rows.filter(row => row.updated_at !== undefined).length;
  };
  async function page(archived: boolean) {
    check();
    const url =
      'https://claude.ai/api/organizations/' +
      routeOrganization +
      '/chat_conversations_v2?limit=30&offset=0&archived=' +
      String(archived) +
      '&consistency=strong';
    progress.dispatch++;
    let response: Response;
    try {
      const pending = fetch(url, {
        method: 'GET',
        mode: 'same-origin',
        credentials: 'include',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json' },
        signal: interrupt.signal,
      });
      void pending.then(
        r => {
          if (interrupt.signal.aborted) unread(r);
        },
        () => undefined
      );
      response = await wait(pending);
    } catch (error) {
      check();
      throw error instanceof Stop ? error : new Stop('request-failed');
    }
    try {
      check();
      checkResponse(response, url);
      const pair = scope(response);
      const data = await body(response);
      check();
      const rows = project(data, archived);
      check();
      anchor = pair;
      progress.page++;
      if (!archived) countRows(rows);
      return rows;
    } catch (error) {
      cancel();
      unread(response);
      throw error;
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const origin = 'https://claude.ai';
    const match =
      typeof expectedUrl === 'string' && expectedUrl.startsWith(origin)
        ? chatPathPattern.exec(expectedUrl.slice(origin.length))
        : null;
    if (!match) throw new Stop('source-verification-unavailable');
    check();
    routeOrganization = resolveRouteOrganization(match[1]) ?? '';
    if (!routeOrganization) throw new Stop('route-organization-unresolved');
    state!.cancel = interruptFromMarker;
    document.addEventListener('visibilitychange', visibility);
    timer = setTimeout(() => latch('deadline-exceeded'), Math.max(0, deadline - Date.now()));
    const verifyRoute = () => {
      check();
      if (resolveRouteOrganization(match[1]) !== routeOrganization)
        throw new Stop('route-evidence-changed');
    };
    const active = await page(false);
    verifyRoute();
    if (!active.some(row => row.uuid === match[1]))
      throw new Stop('selected-chat-not-in-active-list');
    await page(true);
    verifyRoute();
    return {
      kind: 'projected',
      routeOrganization,
      workspace: anchor!.workspace,
      organization: anchor!.organization,
      active,
    };
  } catch (error) {
    return stop(error instanceof Stop ? error.code : 'response-schema-invalid');
  } finally {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', visibility);
    try {
      if (
        state &&
        Object.getOwnPropertyDescriptor(state, 'ownerToken')?.value === ownerToken &&
        Object.getOwnPropertyDescriptor(state, 'cancel')?.value === interruptFromMarker
      )
        state.cancel = null;
    } catch {
      /* Teardown cannot strengthen or replace the observed result. */
    }
  }
}
