import { createJournal, encodeJournal, snapshotJournal, type ResumabilityJournal } from '../core';
import {
  admitCatalog,
  snapshotCatalogFile,
  sha256,
  type CatalogAdmission,
  type AdmissionCounts,
} from './admission';
import { createJournalDownloader, type JournalDownloader, type DownloadOutcome } from './download';
import { localize, t, type CopyKey } from './text';

type TrustedEvent = Pick<Event, 'isTrusted'>;
interface Summary {
  readonly runId: string;
  readonly revision: number;
  readonly control: string;
}
export interface PageStore {
  open(): Promise<void>;
  close(): void;
  create(journal: ResumabilityJournal): Promise<ResumabilityJournal>;
  read(runId: string): Promise<ResumabilityJournal | undefined>;
  list(): Promise<readonly Summary[]>;
  recoverAll(): Promise<readonly ResumabilityJournal[]>;
}
export interface Dependencies {
  store: PageStore;
  create: typeof createJournal;
  encode: typeof encodeJournal;
  snapshot: typeof snapshotJournal;
  hash: typeof sha256;
  uuid: () => string;
  downloader: (late: (outcome: DownloadOutcome) => void) => JournalDownloader;
}
type Phase = 'loading' | 'empty' | 'reading' | 'ready' | 'creating' | 'error' | 'cancelled';
interface ExportAttempt {
  downloader: JournalDownloader;
  outcome: 'saving' | DownloadOutcome;
}
const ITEM_STATES = [
  'pending',
  'running',
  'recorded',
  'deferred',
  'failed',
  'unknown',
  'cancelled',
] as const;
const PAGE_CODES = [
  'selection-invalid',
  'selection-limit',
  'catalog-invalid',
  'hash-failed',
] as const;
function element<T extends HTMLElement>(root: Document, id: string): T {
  const value = root.getElementById(id);
  if (!value) throw new Error('journal-page-incomplete');
  return value as T;
}
function selectionCounts(root: Document, target: HTMLElement, counts?: AdmissionCounts): void {
  target.replaceChildren();
  if (!counts) return;
  const list = root.createElement('ul');
  for (const key of ['conversations', 'skipped', 'duplicates', 'captures'] as const) {
    const row = root.createElement('li');
    row.textContent = `${counts[key]} ${t(`journal_${key}`)}`;
    list.append(row);
  }
  target.append(list);
}
function errorText(error: unknown): string {
  try {
    const code =
      error && typeof error === 'object'
        ? Object.getOwnPropertyDescriptor(error, 'code')?.value
        : undefined;
    if (PAGE_CODES.includes(code)) return t(`journal_${code.replace(/-/gu, '_')}` as CopyKey);
  } catch {
    /* No native or source-bearing error prose. */
  }
  return t('journal_error');
}

/** Explicit dependencies are private module seams, never installed on window. */
// eslint-disable-next-line max-lines-per-function -- One epoch owner fences selection, persistence and export results.
export function initJournalPage(
  root: Document,
  options: Pick<Dependencies, 'store'> & Partial<Dependencies>
) {
  const deps: Dependencies = {
    create: createJournal,
    encode: encodeJournal,
    snapshot: snapshotJournal,
    hash: sha256,
    uuid: () => crypto.randomUUID(),
    downloader: createJournalDownloader,
    ...options,
  };
  localize(root);
  const input = element<HTMLInputElement>(root, 'catalog-picker');
  const pick = element<HTMLButtonElement>(root, 'choose-catalog');
  const create = element<HTMLButtonElement>(root, 'create-journal');
  const cancel = element<HTMLButtonElement>(root, 'cancel-journal');
  const clear = element<HTMLButtonElement>(root, 'clear-journal');
  const status = element<HTMLElement>(root, 'journal-status');
  const storeStatus = element<HTMLElement>(root, 'store-status');
  const summary = element<HTMLElement>(root, 'selection-summary');
  const output = element<HTMLElement>(root, 'journal-runs');
  const state = {
    phase: 'loading' as Phase,
    admission: undefined as CatalogAdmission | undefined,
    epoch: 0,
    abort: undefined as AbortController | undefined,
    disposed: false,
    unavailable: false,
    uncertain: false,
    runs: [] as { runId: string; revision: number }[],
    exports: new Map<number, ExportAttempt>(),
  };
  const busy = () => ['loading', 'reading', 'creating'].includes(state.phase);
  const current = (epoch: number) => !state.disposed && state.epoch === epoch;
  function refresh() {
    const locked = state.disposed || state.unavailable || state.uncertain;
    pick.disabled = locked || busy();
    create.disabled =
      locked ||
      busy() ||
      state.exports.size > 0 ||
      !state.admission?.counts.conversations ||
      state.admission.counts.conversations > 2048;
    const exporting = [...state.exports.values()].some(attempt => attempt.outcome === 'saving');
    cancel.disabled = state.disposed || (!busy() && !exporting);
    clear.disabled = state.disposed;
    status.dataset.state = state.phase;
    output.querySelectorAll<HTMLButtonElement>('button').forEach((button, index) => {
      button.disabled = locked || busy() || state.exports.has(index);
    });
  }
  function invalidate() {
    state.epoch += 1;
    state.abort?.abort();
    state.abort = undefined;
    state.admission = undefined;
    input.value = '';
    selectionCounts(root, summary);
    for (const value of state.exports.values()) value.downloader.reset();
    state.exports.clear();
    output.querySelectorAll<HTMLElement>('.download-status').forEach(element => {
      element.textContent = '';
    });
  }
  function fail(error: unknown, persistent = false) {
    if (persistent) invalidate();
    state.phase = 'error';
    state.admission = undefined;
    selectionCounts(root, summary);
    status.textContent = errorText(error);
    if (persistent) {
      state.unavailable = true;
      state.runs = [];
      output.replaceChildren();
      storeStatus.textContent = t('journal_error');
      deps.store.close();
    }
    refresh();
  }
  function renderRuns(journals: readonly ResumabilityJournal[]) {
    output.replaceChildren();
    state.runs = journals.map(journal => ({ runId: journal.runId, revision: journal.revision }));
    if (!journals.length) output.textContent = t('journal_noRuns');
    journals.forEach((journal, index) => {
      const card = root.createElement('article');
      card.className = 'evidence-card';
      const heading = root.createElement('h3');
      heading.textContent = `${t('journal_run')} ${index + 1} · paused · ${t('journal_revision')} ${journal.revision}`;
      const counts = root.createElement('p');
      counts.className = 'run-counts';
      const states = ITEM_STATES.map(
        key => `${key}: ${journal.items.filter(item => item.state === key).length}`
      );
      counts.textContent = `${journal.items.length} ${t('journal_items')} · ${journal.items.reduce((n, item) => n + item.attempts.length, 0)} ${t('journal_attempts')} · ${states.join(' · ')}`;
      const button = root.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = t('journal_export');
      button.addEventListener('click', event => {
        void actions.save(event, index);
      });
      const saved = root.createElement('p');
      saved.className = 'download-status';
      saved.setAttribute('role', 'status');
      saved.setAttribute('aria-live', 'polite');
      card.append(heading, counts, button, saved);
      output.append(card);
    });
  }
  async function readList(epoch: number): Promise<ResumabilityJournal[] | undefined> {
    const summaries = await deps.store.list();
    if (!current(epoch)) return;
    if (summaries.length > 16) throw new Error();
    const journals: ResumabilityJournal[] = [];
    for (const item of summaries) {
      const record = await deps.store.read(item.runId);
      if (!current(epoch)) return;
      const journal = deps.snapshot(record!);
      if (
        journal.control !== 'paused' ||
        journal.runId !== item.runId ||
        journal.revision !== item.revision
      )
        throw new Error();
      journals.push(journal);
    }
    return journals;
  }
  function maySave(event: TrustedEvent, index: number) {
    return (
      event.isTrusted &&
      !state.disposed &&
      !state.unavailable &&
      !state.uncertain &&
      !busy() &&
      !state.exports.has(index)
    );
  }
  function startExport(index: number, epoch: number, saved: HTMLElement): ExportAttempt {
    const attempt: ExportAttempt = {
      downloader: deps.downloader(outcome => {
        if (
          !current(epoch) ||
          state.exports.get(index) !== attempt ||
          attempt.outcome !== 'unknown'
        )
          return;
        attempt.outcome = outcome;
        saved.textContent = t(`journal_${outcome}`);
      }),
      outcome: 'saving',
    };
    state.exports.set(index, attempt);
    saved.textContent = t('journal_saving');
    refresh();
    return attempt;
  }
  const ready = (async () => {
    const epoch = state.epoch;
    storeStatus.textContent = t('journal_loading');
    refresh();
    try {
      await deps.store.open();
      if (!current(epoch)) return;
      await deps.store.recoverAll();
      if (!current(epoch)) return;
      const journals = await readList(epoch);
      if (!journals || !current(epoch)) return;
      renderRuns(journals);
      state.phase = 'empty';
      status.textContent = t('journal_empty');
      storeStatus.textContent = t('journal_loaded');
      refresh();
    } catch (error) {
      if (current(epoch)) fail(error, true);
    }
  })();
  const actions = {
    ready,
    pick(event: TrustedEvent) {
      if (event.isTrusted && !pick.disabled && !state.disposed) input.click();
    },
    async select(event: TrustedEvent, files: FileList | readonly File[]) {
      if (!event.isTrusted || state.disposed || pick.disabled || !files.length) return;
      // Chromium clears input.files in place when input.value is reset. Own the
      // selected File references before invalidate() clears the native input.
      const selectedFiles = Array.from(files);
      invalidate();
      const epoch = state.epoch;
      const abort = new AbortController();
      state.abort = abort;
      state.phase = 'reading';
      status.textContent = t('journal_reading');
      refresh();
      try {
        const read = snapshotCatalogFile(selectedFiles); // Snapshot synchronously before any await.
        input.value = '';
        const bytes = await read();
        if (!current(epoch)) return;
        const admission = await admitCatalog(bytes, abort.signal, deps.hash);
        if (!current(epoch)) return;
        state.admission = admission;
        state.phase = 'ready';
        selectionCounts(root, summary, admission.counts);
        status.textContent = t('journal_ready');
      } catch (error) {
        if (current(epoch)) fail(error);
      } finally {
        if (current(epoch)) {
          state.abort = undefined;
          refresh();
        }
      }
    },
    async create(event: TrustedEvent) {
      if (!event.isTrusted || state.disposed || create.disabled || !state.admission) return;
      const admission = state.admission;
      const epoch = state.epoch;
      state.admission = undefined;
      selectionCounts(root, summary);
      state.phase = 'creating';
      status.textContent = t('journal_creating');
      refresh();
      let journal: ResumabilityJournal;
      try {
        journal = deps.create({
          runId: deps.uuid(),
          catalogSha256: admission.catalogSha256,
          items: admission.identities.map(identity => ({ itemId: deps.uuid(), ...identity })),
        });
        if (journal.control !== 'paused') throw new Error();
      } catch (error) {
        if (current(epoch)) fail(error);
        return;
      }
      try {
        await deps.store.create(journal);
        if (!current(epoch)) return;
        const journals = await readList(epoch);
        if (!journals || !current(epoch)) return;
        renderRuns(journals);
        state.phase = 'empty';
        status.textContent = t('journal_created');
        refresh();
      } catch (error) {
        if (current(epoch)) fail(error, true);
      }
    },
    cancel(event: TrustedEvent) {
      if (!event.isTrusted || state.disposed || cancel.disabled) return;
      actions.clear(event);
    },
    clear(event: TrustedEvent) {
      if (!event.isTrusted || state.disposed) return;
      if (state.phase === 'creating' || state.phase === 'loading') {
        state.uncertain = true;
        deps.store.close();
      }
      invalidate();
      state.phase = 'cancelled';
      status.textContent = t('journal_cancelled');
      refresh();
    },
    async save(event: TrustedEvent, index: number) {
      if (!maySave(event, index)) return;
      const run = state.runs[index];
      if (!run) return;
      const epoch = state.epoch;
      const saved = output.children[index]?.querySelector<HTMLElement>('.download-status');
      if (!saved) return;
      const attempt = startExport(index, epoch, saved);
      let bytes: Uint8Array;
      try {
        const record = await deps.store.read(run.runId);
        if (!current(epoch)) return;
        const journal = deps.snapshot(record!);
        if (
          journal.control !== 'paused' ||
          journal.revision !== run.revision ||
          journal.runId !== run.runId
        )
          throw new Error();
        bytes = deps.encode(journal);
      } catch (error) {
        if (current(epoch)) fail(error, true);
        return;
      }
      try {
        const outcome = await attempt.downloader.save(new Uint8Array(bytes));
        if (!current(epoch)) return;
        attempt.outcome = outcome;
        saved.textContent = t(`journal_${outcome}`);
      } catch {
        if (current(epoch)) {
          attempt.outcome = 'unknown';
          saved.textContent = t('journal_unknown');
        }
      }
      if (current(epoch)) refresh();
    },
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      invalidate();
      state.runs = [];
      output.replaceChildren();
      deps.store.close();
      pick.removeEventListener('click', actions.pick);
      input.removeEventListener('change', onChange);
      create.removeEventListener('click', onCreate);
      cancel.removeEventListener('click', actions.cancel);
      clear.removeEventListener('click', actions.clear);
      root.defaultView?.removeEventListener('pagehide', actions.dispose);
      refresh();
    },
  };
  function onChange(event: Event) {
    if (input.files) void actions.select(event, input.files);
  }
  function onCreate(event: Event) {
    void actions.create(event);
  }
  pick.addEventListener('click', actions.pick);
  input.addEventListener('change', onChange);
  create.addEventListener('click', onCreate);
  cancel.addEventListener('click', actions.cancel);
  clear.addEventListener('click', actions.clear);
  root.defaultView?.addEventListener('pagehide', actions.dispose, { once: true });
  return actions;
}
