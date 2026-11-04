import { CATALOG_PAGE_LIMITS } from './limits';

export type CatalogDownloadOutcome = 'confirmed' | 'failure' | 'unknown';
export const CATALOG_DOWNLOAD_TIMEOUT_MS = 30_000;
export const CATALOG_DOWNLOAD_SEARCH_MS = 5_000;
export const CATALOG_DOWNLOAD_LATE_MS = 120_000;
const MAX_EARLY_TERMINALS = 32;
const NAME = 'liska-snapshot-catalog.json';

export interface CatalogDownloader {
  save(bytes: Uint8Array): Promise<CatalogDownloadOutcome>;
  /** Explicit new selection/reset ends this page's old observer, never the download itself. */
  reset(): void;
}

interface Attempt {
  id?: number;
  unresolved: boolean;
  finished: boolean;
  early: Map<number, CatalogDownloadOutcome>;
  listener: (delta: chrome.downloads.DownloadDelta) => void;
  resolve: (outcome: CatalogDownloadOutcome) => void;
  timer?: ReturnType<typeof setTimeout>;
  lateTimer?: ReturnType<typeof setTimeout>;
}

function terminal(state: unknown): CatalogDownloadOutcome | undefined {
  if (state === 'complete') return 'confirmed';
  if (state === 'interrupted') return 'failure';
  return undefined;
}

function dataUrl(bytes: Uint8Array): string {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > CATALOG_PAGE_LIMITS.maxReportBytes
  )
    throw new Error();
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length; start += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(start, start + 8192)));
  return `data:application/json;charset=utf-8;base64,${btoa(chunks.join(''))}`;
}

async function searchTerminal(id: number): Promise<CatalogDownloadOutcome | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const search = chrome.downloads.search({ id }).then(items => {
      const exact = items.find(item => item.id === id);
      return exact ? terminal(exact.state) : undefined;
    });
    return await Promise.race([
      search,
      new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), CATALOG_DOWNLOAD_SEARCH_MS);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** One page-owned observer; assigning an ID never counts as completed persistence. */
// eslint-disable-next-line max-lines-per-function -- One closure owns the exact download attempt across early, terminal and late callbacks.
export function createCatalogDownloader(
  onLateTerminal: (outcome: CatalogDownloadOutcome) => void = () => {}
): CatalogDownloader {
  let active: Attempt | undefined;

  const cleanup = (attempt: Attempt) => {
    clearTimeout(attempt.timer);
    clearTimeout(attempt.lateTimer);
    chrome.downloads.onChanged.removeListener(attempt.listener);
    attempt.early.clear();
  };
  const finish = (attempt: Attempt, outcome: CatalogDownloadOutcome) => {
    if (active !== attempt || attempt.finished) return;
    const wasUnknown = attempt.unresolved;
    if (outcome === 'unknown') {
      if (wasUnknown) return;
      attempt.unresolved = true;
      clearTimeout(attempt.timer);
      attempt.resolve(outcome);
      attempt.lateTimer = setTimeout(() => cleanup(attempt), CATALOG_DOWNLOAD_LATE_MS);
    } else {
      attempt.finished = true;
      cleanup(attempt);
      attempt.resolve(outcome);
      if (wasUnknown) onLateTerminal(outcome);
    }
  };
  const reconcile = async (attempt: Attempt) => {
    if (active !== attempt || attempt.finished) return;
    const outcome = attempt.id === undefined ? undefined : await searchTerminal(attempt.id);
    finish(attempt, outcome ?? 'unknown');
  };
  const onId = (attempt: Attempt, id: number | undefined) => {
    const runtimeError = (() => {
      try {
        // Consume callback-scoped lastError even when reset made this attempt
        // stale. Never read or expose its value-bearing message.
        return Boolean(chrome.runtime.lastError);
      } catch {
        return true;
      }
    })();
    if (active !== attempt || attempt.finished) return;
    if (runtimeError || !Number.isSafeInteger(id) || (id as number) < 0) {
      finish(attempt, 'failure');
      return;
    }
    attempt.id = id;
    const early = attempt.early.get(id!);
    attempt.early.clear();
    if (early) finish(attempt, early);
    else
      void searchTerminal(id!).then(outcome => {
        if (outcome) finish(attempt, outcome);
      });
  };
  return {
    save(bytes) {
      if (active) return Promise.resolve('unknown');
      let url: string;
      try {
        url = dataUrl(new Uint8Array(bytes));
      } catch {
        return Promise.resolve('failure');
      }
      return new Promise<CatalogDownloadOutcome>(resolve => {
        const attempt: Attempt = {
          unresolved: false,
          finished: false,
          early: new Map(),
          resolve,
          listener: delta => {
            const outcome = terminal(delta.state?.current);
            if (!outcome || active !== attempt || attempt.finished) return;
            if (attempt.id !== undefined) {
              if (delta.id === attempt.id) finish(attempt, outcome);
            } else if (attempt.early.size < MAX_EARLY_TERMINALS) {
              attempt.early.set(delta.id, outcome);
            }
          },
        };
        active = attempt;
        try {
          chrome.downloads.onChanged.addListener(attempt.listener);
          attempt.timer = setTimeout(() => void reconcile(attempt), CATALOG_DOWNLOAD_TIMEOUT_MS);
          chrome.downloads.download(
            { url, filename: NAME, saveAs: true, conflictAction: 'uniquify' },
            id => onId(attempt, id)
          );
        } catch {
          // Dispatch may have happened before the channel threw. Never retry.
          finish(attempt, 'unknown');
        }
      });
    },
    reset() {
      if (active) {
        cleanup(active);
        active.resolve('unknown');
      }
      active = undefined;
    },
  };
}
