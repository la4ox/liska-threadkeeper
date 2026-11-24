import { inspectClaudeListProbeDocument } from './claude-list-probe';
import {
  armCollectorDocument,
  disarmCollectorDocument,
  interruptCollectorDocument,
} from './claude-account-collector-page';
import {
  collectorFields,
  type CollectorCode,
  type CollectorSource,
} from '../lib/claude-account-collector-contract';

type Update = (id: number, info: chrome.tabs.TabChangeInfo) => void;
type Activated = (info: chrome.tabs.TabActiveInfo) => void;
type Focus = (windowId: number) => void;
type Listener<F> = { addListener(f: F): void; removeListener(f: F): void };
export interface CollectorBrowser {
  tabs: {
    query(query: { active: true; currentWindow: true }): Promise<chrome.tabs.Tab[]>;
    get(id: number): Promise<chrome.tabs.Tab>;
    onUpdated: Listener<Update>;
    onActivated: Listener<Activated>;
  };
  windows: { onFocusChanged: Listener<Focus> };
  scripting: {
    executeScript(injection: {
      target: { tabId: number; documentIds?: [string]; frameIds?: [0] };
      world: 'ISOLATED';
      func: (...args: never[]) => unknown;
      args: unknown[];
    }): Promise<Array<{ frameId?: number; documentId?: string; result?: unknown }>>;
  };
}
export class CollectorStop extends Error {
  constructor(readonly code: CollectorCode) {
    super(code);
  }
}
// The clicked source is immutable; worker selection only verifies it.
const documentId = /^[A-Za-z0-9_-]{8,256}$/u;
function topFrameObservation(items: unknown): { item: object; id: string } | undefined {
  if (!Array.isArray(items) || items.length !== 1) return;
  const item = Object.getOwnPropertyDescriptor(items, '0')?.value;
  if (!item || typeof item !== 'object') return;
  const frame = Object.getOwnPropertyDescriptor(item, 'frameId')?.value;
  const id = Object.getOwnPropertyDescriptor(item, 'documentId')?.value;
  if (frame === 0 && typeof id === 'string' && documentId.test(id)) return { item, id };
}

/** One clock, one sticky cancellation, one lock held through settlement of outstanding effects. */
export class CollectorSession {
  private pin?: string;
  private lock = false;
  private armed = false;
  private listening = false;
  private reason?: CollectorCode;

  private readonly pending = new Set<Promise<unknown>>();
  readonly controller = new AbortController();
  private readonly cancelled: Promise<never>;
  private interrupt!: (error: CollectorStop) => void;
  private readonly timer: ReturnType<typeof setTimeout>;
  constructor(
    private readonly api: CollectorBrowser,
    private readonly operations: Set<number>,
    readonly deadline: number,
    private readonly now: () => number,
    private readonly token: string,
    readonly source: CollectorSource
  ) {
    this.cancelled = new Promise((_, reject) => {
      this.interrupt = reject;
    });
    void this.cancelled.catch(() => undefined);
    this.timer = setTimeout(() => this.stop('deadline-exceeded'), Math.max(0, deadline - now()));
  }
  private readonly update: Update = (id, change) => {
    if (change.url === undefined && change.status !== 'loading') return;
    if (id !== this.source.tabId) return;
    if (change.url === '') this.stop('source-verification-unavailable');
    else if (typeof change.url === 'string' && change.url !== this.source.url)
      this.stop('navigation-changed');
    else if (change.status === 'loading') this.stop('source-verification-unavailable');
  };
  private readonly activated: Activated = info => {
    if (info.windowId === this.source.windowId && info.tabId !== this.source.tabId)
      this.stop('navigation-changed');
  };
  private readonly focus: Focus = id => {
    if (id !== this.source.windowId)
      this.stop(id < 0 ? 'source-verification-unavailable' : 'navigation-changed');
  };
  private track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work);
    const forget = () => {
      this.pending.delete(work);
    };
    void work.then(forget, forget);
    return work;
  }
  private stop(reason: CollectorCode) {
    if (this.reason) return;
    this.reason = reason;
    this.controller.abort();
    this.interrupt(new CollectorStop(reason));
    if (this.armed) {
      try {
        const cause =
          reason === 'navigation-changed' || reason === 'deadline-exceeded'
            ? reason
            : 'source-verification-unavailable';
        this.track(this.inject(interruptCollectorDocument, [this.token, cause])).catch(
          () => undefined
        );
      } catch {
        /* no document */
      }
    }
  }
  check() {
    if (this.now() >= this.deadline) this.stop('deadline-exceeded');
    if (this.reason) throw new CollectorStop(this.reason);
  }
  async wait<T>(start: () => Promise<T>): Promise<T> {
    this.check();
    const value = await Promise.race([this.track(start()), this.cancelled]);
    this.check();
    return value;
  }
  private unavailable() {
    return new CollectorStop(this.pin ? 'source-verification-unavailable' : 'document-unavailable');
  }
  private verifyTab(tab: chrome.tabs.Tab | undefined) {
    if (
      !tab ||
      !Number.isSafeInteger(tab.id) ||
      !Number.isSafeInteger(tab.windowId) ||
      (tab.id ?? -1) < 0 ||
      tab.windowId < 0 ||
      typeof tab.url !== 'string' ||
      !tab.url
    )
      throw this.unavailable();
    if (
      tab.id !== this.source.tabId ||
      tab.windowId !== this.source.windowId ||
      tab.url !== this.source.url ||
      tab.active === false ||
      (tab.pendingUrl && tab.pendingUrl !== this.source.url)
    )
      throw new CollectorStop('navigation-changed');
  }
  private async observed<T>(start: () => Promise<T>) {
    try {
      return await this.wait(start);
    } catch (error) {
      if (error instanceof CollectorStop) throw error;
      throw this.unavailable();
    }
  }
  private async verifySelected() {
    const tabs = await this.observed(() =>
      this.api.tabs.query({ active: true, currentWindow: true })
    );
    this.verifyTab(tabs.length === 1 ? tabs[0] : undefined);
  }
  async select() {
    this.listening = true;
    this.api.tabs.onUpdated.addListener(this.update);
    this.api.tabs.onActivated.addListener(this.activated);
    this.api.windows.onFocusChanged.addListener(this.focus);
    await this.verifySelected();
    if (this.operations.size) throw new CollectorStop('operation-in-progress');
    this.operations.add(this.source.tabId);
    this.lock = true;
  }
  private inject(func: (...args: never[]) => unknown, args: unknown[]) {
    const tabId = this.source.tabId;
    return this.api.scripting.executeScript({
      target: this.pin ? { tabId, documentIds: [this.pin] } : { tabId, frameIds: [0] },
      world: 'ISOLATED',
      func,
      args,
    });
  }
  async pinned(func: (...args: never[]) => unknown, args: unknown[]) {
    try {
      const items = await this.wait(() => this.inject(func, args));
      const observation = topFrameObservation(items);
      if (!observation) throw this.unavailable();
      const { id, item } = observation;
      // Only a valid, positively observed top-frame ID can contradict an existing pin.
      if (this.pin !== undefined && id !== this.pin) throw new CollectorStop('document-replaced');
      this.pin = id;
      const result = Object.getOwnPropertyDescriptor(item, 'result');
      if (result && !('value' in result)) throw this.unavailable();
      return result?.value as unknown;
    } catch (error) {
      if (error instanceof CollectorStop) throw error;
      throw this.unavailable();
    }
  }
  async disarm() {
    await this.pinned(disarmCollectorDocument, [this.token]);
    this.armed = false;
  }
  async verify() {
    const source = this.source;
    this.verifyTab(await this.observed(() => this.api.tabs.get(source.tabId)));
    await this.verifySelected();
    const ready = await this.pinned(inspectClaudeListProbeDocument, [source.url]);
    let verified = false;
    try {
      verified = collectorFields(ready, ['ready'])?.ready === true;
    } catch {
      /* no valid readiness evidence */
    }
    if (!verified) throw new CollectorStop('source-verification-unavailable');
    this.check();
  }
  async arm() {
    this.armed = true;
    if ((await this.pinned(armCollectorDocument, [this.source.url, this.token])) !== true)
      throw new CollectorStop('source-verification-unavailable');
  }
  /** No new work is started while awaiting late RPCs, except token-owned cleanup. */
  async close(cleanup: () => Promise<void>) {
    clearTimeout(this.timer);
    const finish = async () => {
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      if (this.armed) {
        try {
          await this.inject(disarmCollectorDocument, [this.token]);
        } catch {
          /* document gone */
        }
      }
      try {
        await cleanup();
      } catch {
        /* closing cannot undo a native commit */
      }
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      if (this.listening) {
        try {
          this.api.tabs.onUpdated.removeListener(this.update);
        } catch {
          /* no listener */
        }
        try {
          this.api.tabs.onActivated.removeListener(this.activated);
        } catch {
          /* no listener */
        }
        try {
          this.api.windows.onFocusChanged.removeListener(this.focus);
        } catch {
          /* no listener */
        }
      }
      if (this.lock) this.operations.delete(this.source.tabId);
    };
    const unsettled = this.pending.size > 0;
    const closing = finish();
    // Never extend the collection deadline to wait for best-effort teardown. The
    // continuing task, not an expired popup response, owns the latch and lock.
    const left = this.deadline - this.now();
    if (unsettled || left <= 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        closing,
        new Promise<void>(resolve => {
          timer = setTimeout(resolve, left);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
