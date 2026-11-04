export type DownloadOutcome = 'confirmed' | 'failure' | 'unknown';
export const DOWNLOAD_TIMEOUT_MS = 30_000;
export const DOWNLOAD_SEARCH_MS = 5_000;
export const DOWNLOAD_LATE_MS = 120_000;
const MAX_BYTES = 8 * 1024 * 1024;
export interface JournalDownloader {
  save(bytes: Uint8Array): Promise<DownloadOutcome>;
  reset(): void;
}
interface Attempt {
  id?: number;
  unknown: boolean;
  finished: boolean;
  early: Map<number, DownloadOutcome>;
  listener: (delta: chrome.downloads.DownloadDelta) => void;
  resolve: (outcome: DownloadOutcome) => void;
  timer?: ReturnType<typeof setTimeout>;
  lateTimer?: ReturnType<typeof setTimeout>;
}
function terminal(value: unknown): DownloadOutcome | undefined {
  return value === 'complete' ? 'confirmed' : value === 'interrupted' ? 'failure' : undefined;
}
function dataUrl(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error();
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return `data:application/json;charset=utf-8;base64,${btoa(chunks.join(''))}`;
}
async function search(id: number): Promise<DownloadOutcome | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      chrome.downloads
        .search({ id })
        .then(items => terminal(items.find(item => item.id === id)?.state)),
      new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), DOWNLOAD_SEARCH_MS);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** One exact-ID browser attempt; no retry, cancellation or other browser capabilities. */
// eslint-disable-next-line max-lines-per-function -- Single closure owns early/late exact-ID observations.
export function createJournalDownloader(
  onLate: (outcome: DownloadOutcome) => void = () => {}
): JournalDownloader {
  let active: Attempt | undefined;
  const cleanup = (attempt: Attempt) => {
    clearTimeout(attempt.timer);
    clearTimeout(attempt.lateTimer);
    chrome.downloads.onChanged.removeListener(attempt.listener);
    attempt.early.clear();
  };
  const finish = (attempt: Attempt, outcome: DownloadOutcome) => {
    if (active !== attempt || attempt.finished) return;
    if (outcome === 'unknown') {
      if (attempt.unknown) return;
      attempt.unknown = true;
      clearTimeout(attempt.timer);
      attempt.resolve(outcome);
      attempt.lateTimer = setTimeout(() => cleanup(attempt), DOWNLOAD_LATE_MS);
      return;
    }
    attempt.finished = true;
    cleanup(attempt);
    attempt.resolve(outcome);
    if (attempt.unknown) onLate(outcome);
  };
  const onId = (attempt: Attempt, id: number | undefined) => {
    // Callback-scoped browser error is consumed even after reset, never rendered.
    let failed = true;
    try {
      failed = Boolean(chrome.runtime.lastError);
    } catch {
      /* Fail closed. */
    }
    if (active !== attempt || attempt.finished) return;
    if (failed || !Number.isSafeInteger(id) || (id as number) < 0) {
      finish(attempt, 'failure');
      return;
    }
    attempt.id = id;
    const early = attempt.early.get(id!);
    attempt.early.clear();
    if (early) finish(attempt, early);
    else
      void search(id!).then(outcome => {
        if (outcome) finish(attempt, outcome);
      });
  };
  return {
    save(input) {
      if (active) return Promise.resolve('unknown');
      let url: string;
      try {
        url = dataUrl(new Uint8Array(input));
      } catch {
        return Promise.resolve('failure');
      }
      return new Promise<DownloadOutcome>(resolve => {
        const attempt: Attempt = {
          unknown: false,
          finished: false,
          early: new Map(),
          resolve,
          listener(delta) {
            const outcome = terminal(delta.state?.current);
            if (!outcome || active !== attempt || attempt.finished) return;
            if (attempt.id !== undefined) {
              if (attempt.id === delta.id) finish(attempt, outcome);
            } else if (attempt.early.size < 32) attempt.early.set(delta.id, outcome);
          },
        };
        active = attempt;
        try {
          chrome.downloads.onChanged.addListener(attempt.listener);
          attempt.timer = setTimeout(() => {
            if (attempt.id === undefined) finish(attempt, 'unknown');
            else void search(attempt.id).then(outcome => finish(attempt, outcome ?? 'unknown'));
          }, DOWNLOAD_TIMEOUT_MS);
          chrome.downloads.download(
            {
              url,
              filename: 'liska-resumability-journal.json',
              saveAs: true,
              conflictAction: 'uniquify',
            },
            id => onId(attempt, id)
          );
        } catch {
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
