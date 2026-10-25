import {
  CHATGPT_RECONCILIATION_DELIVERY_HARD_LIMITS,
  prepareChatGptReconciliationDelivery,
  type ChatGptReconciliationDelivery,
  type PrepareChatGptReconciliationDeliveryInput,
} from '../archive/reconciliation/chatgpt-delivery';
import { CHATGPT_OFFICIAL_HARD_LIMITS } from '../archive/importers/chatgpt-official';
import { getMessage } from '../lib/i18n';
import { sha256Hex } from '../lib/sha256';
import { downloadReconciliationZip, type ReconciliationDownloadResult } from './download';
import { createReconciliationZip } from './zip';

const FILE_CHUNK_BYTES = 1024 * 1024;

type StatusState = 'idle' | 'working' | 'success' | 'warning' | 'error';

export interface ReconciliationPageDependencies {
  prepare: typeof prepareChatGptReconciliationDelivery;
  createZip: typeof createReconciliationZip;
  download: typeof downloadReconciliationZip;
  sha256: typeof sha256Hex;
  uuid: () => string;
  now: () => string;
}

const DEFAULT_DEPENDENCIES: ReconciliationPageDependencies = {
  prepare: prepareChatGptReconciliationDelivery,
  createZip: createReconciliationZip,
  download: downloadReconciliationZip,
  sha256: sha256Hex,
  uuid: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing reconciliation element: ${id}`);
  return element as T;
}

function queryElements() {
  return {
    web: getElement<HTMLInputElement>('webCanonicalFile'),
    official: getElement<HTMLInputElement>('officialExportFile'),
    run: getElement<HTMLButtonElement>('runBtn'),
    cancel: getElement<HTMLButtonElement>('cancelBtn'),
    status: getElement<HTMLDivElement>('status'),
    result: getElement<HTMLDivElement>('result'),
  };
}

type ReconciliationElements = ReturnType<typeof queryElements>;

function initializeI18n(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element => {
    const key = element.dataset.i18n;
    if (!key) return;
    const message = getMessage(key);
    if (message && message !== key) element.textContent = message;
  });
  const title = document.querySelector('title[data-i18n]');
  const key = title?.getAttribute('data-i18n');
  if (key) {
    const message = getMessage(key);
    if (message && message !== key) document.title = message;
  }
}

function selectedFile(input: HTMLInputElement): File | undefined {
  return input.files?.item(0) ?? undefined;
}

function setStatus(elements: ReconciliationElements, key: string, state: StatusState): void {
  elements.status.textContent = getMessage(key);
  elements.status.dataset.state = state;
}

function setBusy(elements: ReconciliationElements, busy: boolean): void {
  elements.web.disabled = busy;
  elements.official.disabled = busy;
  elements.run.disabled = busy || !selectedFile(elements.web) || !selectedFile(elements.official);
  elements.cancel.disabled = !busy;
}

function showResult(
  elements: ReconciliationElements,
  delivery: ChatGptReconciliationDelivery,
  download: ReconciliationDownloadResult
): void {
  const lines = [
    getMessage(
      delivery.status === 'normalized' ? 'reconcile_resultNormalized' : 'reconcile_resultRawOnly'
    ),
    `${getMessage('reconcile_resultBundleId')}: ${delivery.bundleId}`,
  ];
  if (download.status === 'confirmed' && download.observedFileName)
    lines.push(`${getMessage('reconcile_resultSavedAs')}: ${download.observedFileName}`);
  elements.result.textContent = lines.join('\n');
  elements.result.hidden = false;
}

async function readWebCanonical(file: File): Promise<Uint8Array> {
  if (file.size > CHATGPT_RECONCILIATION_DELIVERY_HARD_LIMITS.maxWebCanonicalBytes)
    throw new Error('web-size-limit');
  return new Uint8Array(await file.arrayBuffer());
}

async function* streamOfficialFile(file: File, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  if (file.size > CHATGPT_OFFICIAL_HARD_LIMITS.maxSourceBytes) throw new Error('source-limit');
  for (let offset = 0; offset < file.size; offset += FILE_CHUNK_BYTES) {
    if (signal.aborted) throw new Error('cancelled');
    const end = Math.min(file.size, offset + FILE_CHUNK_BYTES);
    const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    if (signal.aborted) throw new Error('cancelled');
    yield bytes;
  }
}

function inputFor(
  webBytes: Uint8Array,
  officialFile: File,
  signal: AbortSignal,
  dependencies: ReconciliationPageDependencies
): PrepareChatGptReconciliationDeliveryInput {
  return {
    webCanonicalBytes: webBytes,
    officialChunks: streamOfficialFile(officialFile, signal),
    captureId: `official-import-${dependencies.uuid()}`,
    importedAt: dependencies.now(),
    sha256: dependencies.sha256,
  };
}

function statusForDownload(
  elements: ReconciliationElements,
  delivery: ChatGptReconciliationDelivery,
  result: ReconciliationDownloadResult
): void {
  if (result.status === 'confirmed') {
    setStatus(
      elements,
      delivery.status === 'normalized' ? 'reconcile_saved' : 'reconcile_savedRawOnly',
      delivery.status === 'normalized' ? 'success' : 'warning'
    );
  } else if (result.status === 'unknown') {
    setStatus(elements, 'reconcile_downloadUnknown', 'warning');
  } else {
    setStatus(
      elements,
      result.error === 'start-failed'
        ? 'reconcile_downloadNotStarted'
        : 'reconcile_downloadInterrupted',
      'error'
    );
  }
}

function zipEntries(delivery: ChatGptReconciliationDelivery) {
  if (delivery.artifacts[delivery.artifacts.length - 1]?.relativePath !== 'manifest.json')
    throw new Error('bundle-order-invalid');
  return delivery.artifacts.map(artifact => ({
    path: artifact.relativePath,
    bytes: artifact.bytes,
  }));
}

async function runReconciliation(
  elements: ReconciliationElements,
  dependencies: ReconciliationPageDependencies,
  controller: AbortController
): Promise<void> {
  const webFile = selectedFile(elements.web);
  const officialFile = selectedFile(elements.official);
  if (!webFile || !officialFile) {
    setStatus(elements, 'reconcile_missingFiles', 'error');
    return;
  }
  setStatus(elements, 'reconcile_readingWeb', 'working');
  const webBytes = await readWebCanonical(webFile);
  setStatus(elements, 'reconcile_scanningOfficial', 'working');
  const delivery = await dependencies.prepare(
    inputFor(webBytes, officialFile, controller.signal, dependencies)
  );
  if (controller.signal.aborted) throw new Error('cancelled');
  setStatus(elements, 'reconcile_buildingBundle', 'working');
  const zip = dependencies.createZip(zipEntries(delivery));
  elements.cancel.disabled = true;
  setStatus(elements, 'reconcile_waitingSave', 'working');
  const result = await dependencies.download({ bytes: zip, bundleId: delivery.bundleId });
  statusForDownload(elements, delivery, result);
  showResult(elements, delivery, result);
}

export async function initReconciliationPage(
  dependencies: ReconciliationPageDependencies = DEFAULT_DEPENDENCIES
): Promise<void> {
  const elements = queryElements();
  initializeI18n();
  let active: AbortController | null = null;
  const refresh = (): void => setBusy(elements, active !== null);
  elements.web.addEventListener('change', refresh);
  elements.official.addEventListener('change', refresh);
  elements.cancel.addEventListener('click', () => active?.abort());
  elements.run.addEventListener('click', () => {
    if (active) return;
    active = new AbortController();
    elements.result.hidden = true;
    refresh();
    void runReconciliation(elements, dependencies, active)
      .catch(() => {
        setStatus(
          elements,
          active?.signal.aborted ? 'reconcile_cancelled' : 'reconcile_failed',
          active?.signal.aborted ? 'warning' : 'error'
        );
      })
      .finally(() => {
        active = null;
        refresh();
      });
  });
  refresh();
}
