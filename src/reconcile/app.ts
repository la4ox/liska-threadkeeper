import {
  CHATGPT_RECONCILIATION_DELIVERY_HARD_LIMITS,
  prepareChatGptReconciliationDelivery,
  type ChatGptReconciliationDelivery,
  type PrepareChatGptReconciliationDeliveryInput,
} from '../archive/reconciliation/chatgpt-delivery';
import {
  CHATGPT_OFFICIAL_MULTI_HARD_LIMITS,
  type ChatGptOfficialConversationSource,
} from '../archive/importers/chatgpt-official';
import { getMessage } from '../lib/i18n';
import { sha256Hex } from '../lib/sha256';
import { getSettingsOrThrow } from '../lib/storage';
import { downloadReconciliationZip, type ReconciliationDownloadResult } from './download';
import { writeReconciliationToObsidian, type ObsidianReconciliationWriteResult } from './obsidian';
import { createReconciliationZip } from './zip';

const FILE_CHUNK_BYTES = 1024 * 1024;
const SHARD_NAME = /^conversations-([0-9]{3})\.json$/;

type StatusState = 'idle' | 'working' | 'success' | 'warning' | 'error';

export interface ReconciliationPageDependencies {
  prepare: typeof prepareChatGptReconciliationDelivery;
  createZip: typeof createReconciliationZip;
  download: typeof downloadReconciliationZip;
  getSettings: typeof getSettingsOrThrow;
  writeObsidian: typeof writeReconciliationToObsidian;
  sha256: typeof sha256Hex;
  uuid: () => string;
  now: () => string;
}

const DEFAULT_DEPENDENCIES: ReconciliationPageDependencies = {
  prepare: prepareChatGptReconciliationDelivery,
  createZip: createReconciliationZip,
  download: downloadReconciliationZip,
  getSettings: getSettingsOrThrow,
  writeObsidian: writeReconciliationToObsidian,
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
    outputFile: getElement<HTMLInputElement>('reconcileOutputFile'),
    outputObsidian: getElement<HTMLInputElement>('reconcileOutputObsidian'),
    run: getElement<HTMLButtonElement>('runBtn'),
    cancel: getElement<HTMLButtonElement>('cancelBtn'),
    status: getElement<HTMLDivElement>('status'),
    result: getElement<HTMLDivElement>('result'),
  };
}

type ReconciliationElements = ReturnType<typeof queryElements>;

type OfficialFileSelection =
  | { mode: 'single'; file: File }
  | { mode: 'shards'; files: Array<{ shardIndex: number; file: File }> };

interface DestinationResults {
  file?: ReconciliationDownloadResult;
  obsidian?: ObsidianReconciliationWriteResult;
}

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

function selectedFiles(input: HTMLInputElement): File[] {
  const files = input.files;
  if (!files) return [];
  return Array.from({ length: files.length }, (_, index) => files.item(index)).filter(
    (file): file is File => file !== null
  );
}

function officialFileSelection(input: HTMLInputElement): OfficialFileSelection {
  const files = selectedFiles(input);
  if (files.length === 1 && files[0].name === 'conversations.json')
    return { mode: 'single', file: files[0] };
  if (files.length < 1 || files.length > CHATGPT_OFFICIAL_MULTI_HARD_LIMITS.maxSources)
    throw new Error('official-source-count-invalid');
  const seen = new Set<number>();
  let totalBytes = 0;
  const shards = files.map(file => {
    const match = SHARD_NAME.exec(file.name);
    if (!match) throw new Error('official-source-name-invalid');
    const shardIndex = Number(match[1]);
    if (seen.has(shardIndex)) throw new Error('official-source-duplicate');
    seen.add(shardIndex);
    totalBytes += file.size;
    if (totalBytes > CHATGPT_OFFICIAL_MULTI_HARD_LIMITS.maxSourceBytes)
      throw new Error('official-source-size-limit');
    return { shardIndex, file };
  });
  shards.sort((left, right) => left.shardIndex - right.shardIndex);
  return { mode: 'shards', files: shards };
}

function setStatus(elements: ReconciliationElements, key: string, state: StatusState): void {
  elements.status.textContent = getMessage(key);
  elements.status.dataset.state = state;
}

function setBusy(elements: ReconciliationElements, busy: boolean): void {
  elements.web.disabled = busy;
  elements.official.disabled = busy;
  elements.outputFile.disabled = busy;
  elements.outputObsidian.disabled = busy;
  const hasDestination = elements.outputFile.checked || elements.outputObsidian.checked;
  elements.run.disabled =
    busy || !hasDestination || !selectedFile(elements.web) || !selectedFile(elements.official);
  elements.cancel.disabled = !busy;
}

function showResult(
  elements: ReconciliationElements,
  delivery: ChatGptReconciliationDelivery,
  outputs: DestinationResults
): void {
  const lines = [
    getMessage(
      delivery.status === 'normalized' ? 'reconcile_resultNormalized' : 'reconcile_resultRawOnly'
    ),
    `${getMessage('reconcile_resultBundleId')}: ${delivery.bundleId}`,
  ];
  if (outputs.file) {
    const key =
      outputs.file.status === 'confirmed'
        ? 'reconcile_resultFileConfirmed'
        : outputs.file.status === 'unknown'
          ? 'reconcile_resultFileUnknown'
          : 'reconcile_resultFileFailed';
    const suffix =
      outputs.file.status === 'confirmed' && outputs.file.observedFileName
        ? `: ${outputs.file.observedFileName}`
        : '';
    lines.push(`${getMessage(key)}${suffix}`);
  }
  if (outputs.obsidian) {
    const key =
      outputs.obsidian.status === 'confirmed'
        ? 'reconcile_resultObsidianConfirmed'
        : outputs.obsidian.failureCode === 'server-unsupported'
          ? 'reconcile_resultObsidianUpgrade'
          : outputs.obsidian.status === 'cancelled'
            ? 'reconcile_resultObsidianCancelled'
            : 'reconcile_resultObsidianIncomplete';
    lines.push(getMessage(key));
  }
  elements.result.textContent = lines.join('\n');
  elements.result.hidden = false;
}

async function readWebCanonical(file: File): Promise<Uint8Array> {
  if (file.size > CHATGPT_RECONCILIATION_DELIVERY_HARD_LIMITS.maxWebCanonicalBytes)
    throw new Error('web-size-limit');
  return new Uint8Array(await file.arrayBuffer());
}

async function* streamOfficialFile(file: File, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  if (file.size > CHATGPT_OFFICIAL_MULTI_HARD_LIMITS.maxSourceBytes)
    throw new Error('source-limit');
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
  official: OfficialFileSelection,
  signal: AbortSignal,
  dependencies: ReconciliationPageDependencies,
  captureId: string,
  importedAt: string
): PrepareChatGptReconciliationDeliveryInput {
  const base = {
    webCanonicalBytes: webBytes,
    captureId,
    importedAt,
    sha256: dependencies.sha256,
  };
  if (official.mode === 'single')
    return { ...base, officialChunks: streamOfficialFile(official.file, signal) };
  const officialSources: ChatGptOfficialConversationSource[] = official.files.map(source => ({
    shardIndex: source.shardIndex,
    chunks: streamOfficialFile(source.file, signal),
  }));
  return { ...base, officialSources };
}

function finishStatus(
  elements: ReconciliationElements,
  delivery: ChatGptReconciliationDelivery,
  outputs: DestinationResults
): void {
  const results = [outputs.file, outputs.obsidian].filter(value => value !== undefined);
  const confirmed = results.filter(result => result?.status === 'confirmed').length;
  if (confirmed === results.length) {
    setStatus(
      elements,
      delivery.status === 'normalized' ? 'reconcile_outputsConfirmed' : 'reconcile_savedRawOnly',
      delivery.status === 'normalized' ? 'success' : 'warning'
    );
  } else if (confirmed > 0) {
    setStatus(elements, 'reconcile_outputsPartial', 'warning');
  } else if (outputs.obsidian?.failureCode === 'server-unsupported') {
    setStatus(elements, 'reconcile_obsidianUpgrade', 'warning');
  } else if (outputs.file?.status === 'unknown') {
    setStatus(elements, 'reconcile_downloadUnknown', 'warning');
  } else if (outputs.obsidian?.status === 'cancelled') {
    setStatus(elements, 'reconcile_cancelled', 'warning');
  } else if (outputs.file?.status === 'failed') {
    setStatus(
      elements,
      outputs.file.error === 'start-failed'
        ? 'reconcile_downloadNotStarted'
        : 'reconcile_downloadInterrupted',
      'error'
    );
  } else {
    setStatus(elements, 'reconcile_outputsIncomplete', 'warning');
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

function refusedObsidian(): ObsidianReconciliationWriteResult {
  return {
    status: 'refused',
    failureCode: 'invalid-settings',
    attemptId: null,
    bundleId: null,
    conversationKey: null,
    receipts: [],
  };
}

async function writeObsidian(
  delivery: ChatGptReconciliationDelivery,
  operationAt: string,
  signal: AbortSignal,
  dependencies: ReconciliationPageDependencies
): Promise<ObsidianReconciliationWriteResult> {
  let settings;
  try {
    settings = await dependencies.getSettings();
  } catch {
    return refusedObsidian();
  }
  return dependencies.writeObsidian({
    delivery,
    settings: {
      obsidianUrl: settings.obsidianUrl,
      obsidianApiKey: settings.obsidianApiKey,
      vaultPath: settings.vaultPath,
    },
    operationAt,
    attemptId: `obsidian-${dependencies.uuid()}`,
    sha256: dependencies.sha256,
    signal,
  });
}

async function runReconciliation(
  elements: ReconciliationElements,
  dependencies: ReconciliationPageDependencies,
  controller: AbortController
): Promise<void> {
  const webFile = selectedFile(elements.web);
  if (!webFile || selectedFiles(elements.official).length === 0) {
    setStatus(elements, 'reconcile_missingFiles', 'error');
    return;
  }
  const official = officialFileSelection(elements.official);
  const saveFile = elements.outputFile.checked;
  const saveObsidian = elements.outputObsidian.checked;
  if (!saveFile && !saveObsidian) {
    setStatus(elements, 'reconcile_missingDestination', 'error');
    return;
  }
  const operationAt = dependencies.now();
  setStatus(elements, 'reconcile_readingWeb', 'working');
  const webBytes = await readWebCanonical(webFile);
  setStatus(elements, 'reconcile_scanningOfficial', 'working');
  const delivery = await dependencies.prepare(
    inputFor(
      webBytes,
      official,
      controller.signal,
      dependencies,
      `official-import-${dependencies.uuid()}`,
      operationAt
    )
  );
  if (controller.signal.aborted) throw new Error('cancelled');
  const outputs: DestinationResults = {};
  if (saveFile) {
    setStatus(elements, 'reconcile_buildingBundle', 'working');
    const zip = dependencies.createZip(zipEntries(delivery));
    elements.cancel.disabled = true;
    setStatus(elements, 'reconcile_waitingSave', 'working');
    outputs.file = await dependencies.download({ bytes: zip, bundleId: delivery.bundleId });
  }
  if (saveObsidian) {
    elements.cancel.disabled = false;
    setStatus(elements, 'reconcile_writingObsidian', 'working');
    outputs.obsidian = await writeObsidian(delivery, operationAt, controller.signal, dependencies);
  }
  finishStatus(elements, delivery, outputs);
  showResult(elements, delivery, outputs);
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
  elements.outputFile.addEventListener('change', refresh);
  elements.outputObsidian.addEventListener('change', refresh);
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
