import {
  buildSnapshotCatalog,
  encodeSnapshotCatalog,
  SNAPSHOT_CATALOG_CODES,
} from '../archive/catalog';
import type { SnapshotCatalog } from '../archive/catalog';
import {
  createCatalogDownloader,
  type CatalogDownloader,
  type CatalogDownloadOutcome,
} from './catalog-download';
import { cancellableSha256 } from './hash';
import { CATALOG_PAGE_LIMITS as LIMITS } from './limits';
import { renderCatalog, renderSelection } from './render';
import {
  snapshotSelectedArchive,
  preflightSelection,
  readSelectedManifests,
  type SelectedArchive,
  type ReadProgress,
} from './selection';
import { localize, t, type CopyKey } from './text';

type TrustedEvent = Pick<Event, 'isTrusted'>;
type Phase = 'empty' | 'selected' | 'reading' | 'building' | 'ready' | 'cancelled' | 'error';
export interface Dependencies {
  build: typeof buildSnapshotCatalog;
  encode: typeof encodeSnapshotCatalog;
  hash: typeof cancellableSha256;
  downloader: (late: (outcome: CatalogDownloadOutcome) => void) => CatalogDownloader;
}

const DEFAULTS: Dependencies = {
  build: buildSnapshotCatalog,
  encode: encodeSnapshotCatalog,
  hash: cancellableSha256,
  downloader: createCatalogDownloader,
};
const CORE_LIMITS = Object.freeze({
  maxSelectedFiles: LIMITS.maxFiles,
  maxManifests: LIMITS.maxManifests,
  maxManifestBytes: LIMITS.maxManifestBytes,
  maxTotalManifestBytes: LIMITS.maxTotalManifestBytes,
  maxRelativePathCodeUnits: LIMITS.maxPathLength,
  maxOutputBytes: LIMITS.maxReportBytes,
});
const typedArrayTag = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  Symbol.toStringTag
)!.get!;

function element<T extends HTMLElement>(root: Document, id: string): T {
  const found = root.getElementById(id);
  if (!found) throw new Error('catalog-page-incomplete');
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
      return { key: `catalog_${code.replace(/-/gu, '_')}` as CopyKey };
    if (typeof code === 'string' && SNAPSHOT_CATALOG_CODES.includes(code as never))
      return { key: 'catalog_error', code };
  } catch {
    /* Hostile/native exception values are never rendered. */
  }
  return { key: 'catalog_error' };
}

/** Trusted-action seam is test-only and is never installed on window. */
// eslint-disable-next-line max-lines-per-function -- One page-owned lifecycle keeps selected metadata and report authority inside operation epochs.
export function initSnapshotCatalogPage(
  root: Document = document,
  overrides: Partial<Dependencies> = {}
) {
  const deps = { ...DEFAULTS, ...overrides };
  localize(root);
  const input = element<HTMLInputElement>(root, 'catalog-picker');
  const pick = element<HTMLButtonElement>(root, 'choose-archive');
  const build = element<HTMLButtonElement>(root, 'build-catalog');
  const cancel = element<HTMLButtonElement>(root, 'cancel-catalog');
  const reset = element<HTMLButtonElement>(root, 'clear-catalog');
  const save = element<HTMLButtonElement>(root, 'save-catalog');
  const selection = element<HTMLElement>(root, 'selection-summary');
  const status = element<HTMLElement>(root, 'catalog-status');
  const output = element<HTMLElement>(root, 'catalog-report');
  const saved = element<HTMLElement>(root, 'download-status');
  const supported = 'webkitdirectory' in input;
  const state = {
    phase: 'empty' as Phase,
    archive: undefined as SelectedArchive | undefined,
    report: undefined as Uint8Array | undefined,
    abort: undefined as AbortController | undefined,
    saving: '' as '' | 'saving' | CatalogDownloadOutcome,
    epoch: 0,
    disposed: false,
  };
  let downloader: CatalogDownloader | undefined;

  function refresh() {
    const busy = state.phase === 'reading' || state.phase === 'building';
    const locked = state.disposed || busy;
    pick.disabled = locked || !supported || state.saving === 'saving';
    build.disabled = locked || !state.archive || Boolean(state.saving);
    cancel.disabled = state.disposed || !busy;
    reset.disabled = state.disposed || (!state.archive && !state.report && !busy);
    save.disabled = locked || !state.report || Boolean(state.saving);
    output.hidden = !state.report;
    status.dataset.state = state.phase;
    saved.textContent = state.saving ? t(`catalog_${state.saving}` as CopyKey) : '';
  }

  function invalidate() {
    state.epoch += 1;
    state.abort?.abort();
    state.abort = undefined;
    state.report = undefined;
    state.saving = '';
    downloader?.reset();
    downloader = undefined;
    output.replaceChildren();
  }

  function selected() {
    state.phase = state.archive ? 'selected' : 'empty';
    status.textContent = t(state.archive ? 'catalog_selected' : 'catalog_empty');
    renderSelection(selection, state.archive ? preflightSelection(state.archive) : undefined);
    refresh();
  }

  function failure(error: unknown) {
    state.phase = 'error';
    const fixed = safeError(error);
    status.textContent = `${t(fixed.key)}${fixed.code ? ` (${fixed.code})` : ''}`;
    refresh();
  }

  function progress(value: ReadProgress, epoch: number) {
    if (state.disposed || epoch !== state.epoch) return;
    status.textContent = `${t('catalog_reading')} ${value.manifests}/${value.totalManifests} ${t('catalog_manifests')} · ${value.bytes}/${value.totalBytes} ${t('catalog_bytes')} ${t('catalog_read')}`;
  }

  async function run() {
    if (!state.archive) return;
    const archive = state.archive;
    invalidate();
    const epoch = state.epoch;
    const abort = new AbortController();
    const current = () => !state.disposed && epoch === state.epoch && !abort.signal.aborted;
    state.abort = abort;
    state.phase = 'reading';
    status.textContent = t('catalog_reading');
    refresh();
    try {
      const input = await readSelectedManifests(archive, abort.signal, value =>
        progress(value, epoch)
      );
      if (!current()) return;
      state.phase = 'building';
      status.textContent = t('catalog_building');
      refresh();
      const catalog = await deps.build({
        ...input,
        sha256: deps.hash(abort.signal),
        limits: CORE_LIMITS,
      });
      if (!current()) return;
      const bytes = deps.encode(catalog, CORE_LIMITS);
      if (
        typedArrayTag.call(bytes) !== 'Uint8Array' ||
        !bytes.length ||
        bytes.length > LIMITS.maxReportBytes
      )
        throw new Error();
      // Fixed-field encoder snapshot, never the mutable builder object.
      const safeCatalog = JSON.parse(new TextDecoder().decode(bytes)) as SnapshotCatalog;
      renderCatalog(output, safeCatalog);
      state.report = new Uint8Array(bytes);
      state.phase = 'ready';
      status.textContent = t('catalog_ready');
    } catch (error) {
      if (current()) {
        state.report = undefined;
        output.replaceChildren();
        failure(error);
      }
    } finally {
      if (current()) {
        state.abort = undefined;
        refresh();
      }
    }
  }

  const actions = {
    pick(event: TrustedEvent) {
      if (!event.isTrusted || state.disposed || pick.disabled) return;
      input.click();
    },
    select(event: TrustedEvent, files: FileList | readonly File[]) {
      if (!event.isTrusted || state.disposed || !supported) return;
      try {
        if (files.length === 0) return;
        const candidate = snapshotSelectedArchive(files);
        invalidate();
        state.archive = candidate;
        selected();
      } catch (error) {
        failure(error);
      } finally {
        input.value = '';
      }
    },
    build(event: TrustedEvent): Promise<void> {
      if (!event.isTrusted || state.disposed || build.disabled) return Promise.resolve();
      return run();
    },
    cancel(event: TrustedEvent) {
      if (!event.isTrusted || state.disposed || cancel.disabled) return;
      invalidate();
      state.phase = 'cancelled';
      status.textContent = t('catalog_cancelled');
      refresh();
    },
    clear(event: TrustedEvent) {
      if (!event.isTrusted || state.disposed) return;
      invalidate();
      state.archive = undefined;
      input.value = '';
      selected();
    },
    async save(event: TrustedEvent) {
      if (!event.isTrusted || state.disposed || save.disabled || !state.report) return;
      const epoch = state.epoch;
      downloader ??= deps.downloader(outcome => {
        if (state.disposed || epoch !== state.epoch || state.saving !== 'unknown') return;
        state.saving = outcome;
        refresh();
      });
      state.saving = 'saving';
      refresh();
      try {
        const outcome = await downloader.save(new Uint8Array(state.report));
        if (!state.disposed && epoch === state.epoch) state.saving = outcome;
      } catch {
        if (!state.disposed && epoch === state.epoch) state.saving = 'unknown';
      }
      if (!state.disposed && epoch === state.epoch) refresh();
    },
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      invalidate();
      state.archive = undefined;
      input.value = '';
      renderSelection(selection);
      refresh();
      pick.removeEventListener('click', actions.pick);
      input.removeEventListener('change', onChange);
      build.removeEventListener('click', onBuild);
      cancel.removeEventListener('click', actions.cancel);
      reset.removeEventListener('click', actions.clear);
      save.removeEventListener('click', onSave);
      root.defaultView?.removeEventListener('pagehide', actions.dispose);
    },
  };
  const onChange = (event: Event) => {
    if (input.files) actions.select(event, input.files);
  };
  const onBuild = (event: Event) => {
    void actions.build(event);
  };
  const onSave = (event: Event) => {
    void actions.save(event);
  };
  pick.addEventListener('click', actions.pick);
  input.addEventListener('change', onChange);
  build.addEventListener('click', onBuild);
  cancel.addEventListener('click', actions.cancel);
  reset.addEventListener('click', actions.clear);
  save.addEventListener('click', onSave);
  root.defaultView?.addEventListener('pagehide', actions.dispose, { once: true });
  selected();
  if (!supported) status.textContent = t('catalog_directory_unavailable');
  return actions;
}
