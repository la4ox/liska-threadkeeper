import { analyzeSnapshots, encodeSnapshotAnalysisPlan } from '../archive/snapshots';
import type { SnapshotAnalysisPlan } from '../archive/snapshots/contracts';
import { SNAPSHOT_ANALYSIS_CODES } from '../archive/snapshots/contracts';
import { cancellableSha256 } from './hash';
import {
  createReportDownloader,
  type ReportDownloader,
  type PlanDownloadOutcome,
} from './plan-download';
import { renderPlan, renderSelection } from './render';
import {
  preflightSelection,
  readSelectedSnapshots,
  snapshotSelectedFiles,
  type SelectedSnapshot,
  type ReadProgress,
} from './selection';
import { localize, t, type CopyKey } from './text';

type Phase = 'empty' | 'selected' | 'reading' | 'analyzing' | 'ready' | 'cancelled' | 'error';
type TrustedEvent = Pick<Event, 'isTrusted'>;
interface Dependencies {
  analyze: typeof analyzeSnapshots;
  hash: typeof cancellableSha256;
  downloader: (late: (outcome: PlanDownloadOutcome) => void) => ReportDownloader;
}

const DEFAULTS: Dependencies = {
  analyze: analyzeSnapshots,
  hash: cancellableSha256,
  downloader: createReportDownloader,
};

function element<T extends HTMLElement>(root: Document, id: string): T {
  const found = root.getElementById(id);
  if (!found) throw new Error('snapshot-page-incomplete');
  return found as T;
}

function safeError(error: unknown): { key: CopyKey; code?: string } {
  try {
    const code =
      error && typeof error === 'object'
        ? Object.getOwnPropertyDescriptor(error, 'code')?.value
        : undefined;
    if (
      code === 'selection-invalid' ||
      code === 'selection-limit' ||
      code === 'selection-read-failed'
    )
      return { key: `snapshot_${code.replace(/-/gu, '_')}` as CopyKey };
    if (typeof code === 'string' && SNAPSHOT_ANALYSIS_CODES.includes(code as never))
      return { key: 'snapshot_error', code };
  } catch {
    /* Native/hostile exception values are never rendered. */
  }
  return { key: 'snapshot_error' };
}

/** Trusted-action seam is exported for synthetic tests, never installed on window. */
// eslint-disable-next-line max-lines-per-function -- One page-owned lifecycle keeps operation tokens, selected bytes and report authority private.
export function initSnapshotAnalysisPage(
  root: Document = document,
  overrides: Partial<Dependencies> = {}
) {
  const deps = { ...DEFAULTS, ...overrides };
  localize(root);
  const input = element<HTMLInputElement>(root, 'snapshot-picker');
  const pick = element<HTMLButtonElement>(root, 'add-snapshot');
  const analyze = element<HTMLButtonElement>(root, 'analyze-snapshots');
  const cancel = element<HTMLButtonElement>(root, 'cancel-analysis');
  const reset = element<HTMLButtonElement>(root, 'clear-snapshots');
  const save = element<HTMLButtonElement>(root, 'save-report');
  const selections = element<HTMLElement>(root, 'snapshot-selections');
  const empty = element<HTMLElement>(root, 'selection-empty');
  const status = element<HTMLElement>(root, 'analysis-status');
  const output = element<HTMLElement>(root, 'analysis-report');
  const saved = element<HTMLElement>(root, 'download-status');
  const directorySupported = 'webkitdirectory' in input;
  const state = {
    phase: 'empty' as Phase,
    snapshots: [] as SelectedSnapshot[],
    epoch: 0,
    abort: undefined as AbortController | undefined,
    report: undefined as Uint8Array | undefined,
    saving: '' as '' | 'saving' | PlanDownloadOutcome,
    disposed: false,
  };
  const downloader = deps.downloader(outcome => {
    if (state.disposed || state.saving !== 'unknown') return;
    state.saving = outcome;
    refresh();
  });

  function refresh() {
    const busy = state.phase === 'reading' || state.phase === 'analyzing';
    pick.disabled =
      busy || state.saving === 'saving' || !directorySupported || state.snapshots.length >= 16;
    analyze.disabled = busy || state.saving === 'saving' || state.snapshots.length < 2;
    cancel.disabled = !busy;
    reset.disabled = !state.snapshots.length && !state.report && !busy;
    save.disabled =
      !state.report || busy || state.saving === 'saving' || state.saving === 'unknown';
    empty.hidden = state.snapshots.length > 0;
    output.hidden = !state.report;
    saved.textContent = state.saving ? t(`snapshot_${state.saving}` as CopyKey) : '';
    status.dataset.state = state.phase;
  }

  function invalidate() {
    state.epoch += 1;
    state.abort?.abort();
    state.abort = undefined;
    state.report = undefined;
    state.saving = '';
    downloader.reset();
    output.replaceChildren();
  }

  function selected() {
    state.phase = state.snapshots.length ? 'selected' : 'empty';
    status.textContent = t(`snapshot_${state.phase}`);
    renderSelection(selections, state.snapshots, actions.remove);
    refresh();
  }

  function progress(value: ReadProgress, epoch: number) {
    if (epoch !== state.epoch || state.disposed) return;
    status.textContent = `${t('snapshot_reading')} ${value.files}/${value.totalFiles} ${t('snapshot_files')} · ${value.bytes}/${value.totalBytes} ${t('snapshot_bytes')} ${t('snapshot_read')}`;
  }

  function failure(error: unknown) {
    state.phase = 'error';
    const message = safeError(error);
    status.textContent = `${t(message.key)}${message.code ? ` (${message.code})` : ''}`;
  }

  async function run() {
    invalidate();
    const epoch = state.epoch;
    const abort = new AbortController();
    state.abort = abort;
    state.phase = 'reading';
    status.textContent = t('snapshot_reading');
    refresh();
    try {
      const bytes = await readSelectedSnapshots([...state.snapshots], abort.signal, value =>
        progress(value, epoch)
      );
      if (abort.signal.aborted || epoch !== state.epoch) return;
      state.phase = 'analyzing';
      status.textContent = t('snapshot_analyzing');
      refresh();
      const plan = await deps.analyze({ snapshots: bytes, sha256: deps.hash(abort.signal) });
      if (abort.signal.aborted || epoch !== state.epoch) return;
      state.report = encodeSnapshotAnalysisPlan(plan);
      // Render the encoder's fixed-field snapshot, not mutable analyzer objects.
      const safePlan = JSON.parse(new TextDecoder().decode(state.report)) as SnapshotAnalysisPlan;
      renderPlan(output, safePlan);
      state.phase = 'ready';
      status.textContent = t('snapshot_ready');
    } catch (error) {
      if (epoch !== state.epoch) return;
      // Every page-owned cancellation advances epoch and sets its own status.
      failure(error);
    } finally {
      if (epoch === state.epoch) {
        state.abort = undefined;
        refresh();
      }
    }
  }

  const actions = {
    pick(event: TrustedEvent) {
      if (!event.isTrusted || state.disposed || !directorySupported || pick.disabled) return;
      input.click();
    },
    add(event: TrustedEvent, files: FileList | readonly File[]) {
      if (!event.isTrusted || state.disposed || !directorySupported) return;
      if (state.phase === 'reading' || state.phase === 'analyzing' || files.length === 0) {
        input.value = '';
        return;
      }
      try {
        const candidate = snapshotSelectedFiles(files);
        preflightSelection([...state.snapshots, candidate], false);
        invalidate();
        state.snapshots.push(candidate);
        selected();
      } catch (error) {
        failure(error);
        refresh();
      } finally {
        input.value = '';
      }
    },
    remove(event: TrustedEvent, index: number) {
      if (
        !event.isTrusted ||
        state.disposed ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= state.snapshots.length
      )
        return;
      invalidate();
      state.snapshots.splice(index, 1);
      selected();
    },
    clear(event: TrustedEvent) {
      if (!event.isTrusted || state.disposed) return;
      invalidate();
      state.snapshots = [];
      input.value = '';
      selected();
    },
    analyze(event: TrustedEvent): Promise<void> {
      if (!event.isTrusted || state.disposed || analyze.disabled) return Promise.resolve();
      return run();
    },
    cancel(event: TrustedEvent) {
      if (!event.isTrusted || state.disposed || cancel.disabled) return;
      invalidate();
      state.phase = 'cancelled';
      status.textContent = t('snapshot_cancelled');
      refresh();
    },
    async save(event: TrustedEvent) {
      if (!event.isTrusted || state.disposed || save.disabled || !state.report) return;
      const epoch = state.epoch;
      state.saving = 'saving';
      refresh();
      try {
        const result = await downloader.save(state.report);
        if (epoch === state.epoch && !state.disposed) state.saving = result;
      } catch {
        if (epoch === state.epoch) state.saving = 'unknown';
      }
      if (epoch === state.epoch) refresh();
    },
    dispose() {
      invalidate();
      state.snapshots = [];
      state.disposed = true;
    },
  };
  pick.addEventListener('click', actions.pick);
  input.addEventListener('change', event => {
    if (input.files) actions.add(event, input.files);
  });
  analyze.addEventListener('click', event => {
    void actions.analyze(event);
  });
  cancel.addEventListener('click', actions.cancel);
  reset.addEventListener('click', actions.clear);
  save.addEventListener('click', event => {
    void actions.save(event);
  });
  root.defaultView?.addEventListener('pagehide', actions.dispose, { once: true });
  selected();
  if (!directorySupported) status.textContent = t('snapshot_directory_unavailable');
  return actions;
}
