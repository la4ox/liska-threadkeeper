const SHA256 = /^[a-f0-9]{64}$/;
const DEFAULT_TERMINAL_TIMEOUT_MS = 120_000;
const DEFAULT_DEFERRED_CLEANUP_MS = 10 * 60_000;

export type ReconciliationDownloadResult =
  | { status: 'confirmed'; downloadId: number; observedFileName: string | null }
  | { status: 'failed'; downloadId: number | null; error: 'start-failed' | 'interrupted' }
  | { status: 'unknown'; downloadId: number; error: 'completion-unconfirmed' };

interface DownloadDeltaLike {
  id: number;
  state?: { current?: string };
}

interface DownloadItemLike {
  id?: number;
  state?: string;
  filename?: string;
}

export interface ReconciliationDownloadsApi {
  download(
    options: {
      url: string;
      filename: string;
      saveAs: boolean;
      conflictAction: 'uniquify';
    },
    callback: (downloadId: number | undefined) => void
  ): unknown;
  search(query: { id: number }): Promise<DownloadItemLike[]>;
  onChanged: {
    addListener(listener: (delta: DownloadDeltaLike) => void): void;
    removeListener(listener: (delta: DownloadDeltaLike) => void): void;
  };
}

export interface ReconciliationDownloadInput {
  bytes: Uint8Array;
  bundleId: string;
  downloads?: ReconciliationDownloadsApi;
  runtime?: { lastError?: { message?: string } | null };
  objectUrls?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  terminalTimeoutMs?: number;
  deferredCleanupMs?: number;
}

function fixedFailure(): ReconciliationDownloadResult {
  return { status: 'failed', downloadId: null, error: 'start-failed' };
}

function validZip(bytes: Uint8Array): boolean {
  return (
    Object.prototype.toString.call(bytes) === '[object Uint8Array]' &&
    bytes.byteLength >= 22 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

function observedName(filename: unknown): string | null {
  if (typeof filename !== 'string' || filename.length === 0) return null;
  const parts = filename.split(/[\\/]/);
  return parts[parts.length - 1] || null;
}

function boundedTimeout(value: number | undefined, fallback: number): number | null {
  const selected = value ?? fallback;
  return Number.isSafeInteger(selected) && selected >= 1 && selected <= fallback ? selected : null;
}

class DownloadSession {
  private downloadId: number | undefined;
  private terminal = false;
  private callerSettled = false;
  private cleaned = false;
  private terminalTimer: ReturnType<typeof setTimeout> | undefined;
  private cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  private resolve!: (result: ReconciliationDownloadResult) => void;

  constructor(
    private readonly downloads: ReconciliationDownloadsApi,
    private readonly runtime: { lastError?: { message?: string } | null },
    private readonly objectUrls: Pick<typeof URL, 'revokeObjectURL'>,
    private readonly url: string,
    private readonly filename: string,
    private readonly terminalTimeout: number,
    private readonly deferredCleanup: number
  ) {}

  run(): Promise<ReconciliationDownloadResult> {
    return new Promise(resolve => {
      this.resolve = resolve;
      this.downloads.onChanged.addListener(this.onChanged);
      this.dispatch();
    });
  }

  private readonly onChanged = (delta: DownloadDeltaLike): void => {
    if (delta.id === this.downloadId) this.applyState(delta.state?.current);
  };

  private dispatch(): void {
    try {
      this.downloads.download(
        { url: this.url, filename: this.filename, saveAs: true, conflictAction: 'uniquify' },
        id => this.acceptDownloadId(id)
      );
    } catch {
      this.finish(fixedFailure());
    }
  }

  private acceptDownloadId(id: number | undefined): void {
    if (this.runtime.lastError || id === undefined || !Number.isSafeInteger(id) || id < 0) {
      this.finish(fixedFailure());
      return;
    }
    this.downloadId = id;
    void this.reconcile();
    this.terminalTimer = setTimeout(() => void this.onTimeout(), this.terminalTimeout);
  }

  private async inspect(): Promise<DownloadItemLike | undefined> {
    if (this.downloadId === undefined) return undefined;
    try {
      return (await this.downloads.search({ id: this.downloadId })).find(
        item => item.id === this.downloadId
      );
    } catch {
      return undefined;
    }
  }

  private finishComplete(observed?: DownloadItemLike): void {
    if (this.downloadId === undefined || this.terminal) return;
    this.finish({
      status: 'confirmed',
      downloadId: this.downloadId,
      observedFileName: observedName(observed?.filename),
    });
  }

  private applyState(state: string | undefined, observed?: DownloadItemLike): void {
    if (this.downloadId === undefined || this.terminal) return;
    if (state === 'complete') this.finishComplete(observed);
    if (state === 'interrupted')
      this.finish({ status: 'failed', downloadId: this.downloadId, error: 'interrupted' });
  }

  private async reconcile(): Promise<void> {
    const item = await this.inspect();
    this.applyState(item?.state, item);
  }

  private async onTimeout(): Promise<void> {
    await this.reconcile();
    if (this.terminal || this.downloadId === undefined) return;
    this.settle(
      { status: 'unknown', downloadId: this.downloadId, error: 'completion-unconfirmed' },
      false
    );
    this.cleanupTimer = setTimeout(() => this.cleanup(), this.deferredCleanup);
  }

  private settle(result: ReconciliationDownloadResult, cleanupNow: boolean): void {
    if (!this.callerSettled) {
      this.callerSettled = true;
      this.resolve(result);
    }
    if (cleanupNow) this.cleanup();
  }

  private finish(result: ReconciliationDownloadResult): void {
    if (this.terminal) return;
    this.terminal = true;
    this.settle(result, true);
  }

  private cleanup(): void {
    if (this.cleaned) return;
    this.cleaned = true;
    if (this.terminalTimer !== undefined) clearTimeout(this.terminalTimer);
    if (this.cleanupTimer !== undefined) clearTimeout(this.cleanupTimer);
    this.downloads.onChanged.removeListener(this.onChanged);
    this.objectUrls.revokeObjectURL(this.url);
  }
}

/** One explicit Save-As download with terminal completion observation and no retry. */
export function downloadReconciliationZip(
  input: ReconciliationDownloadInput
): Promise<ReconciliationDownloadResult> {
  if (!input || typeof input !== 'object' || !SHA256.test(input.bundleId) || !validZip(input.bytes))
    return Promise.resolve(fixedFailure());
  const terminalTimeout = boundedTimeout(input.terminalTimeoutMs, DEFAULT_TERMINAL_TIMEOUT_MS);
  const deferredCleanup = boundedTimeout(input.deferredCleanupMs, DEFAULT_DEFERRED_CLEANUP_MS);
  if (terminalTimeout === null || deferredCleanup === null) return Promise.resolve(fixedFailure());

  const downloads = input.downloads ?? (chrome.downloads as ReconciliationDownloadsApi);
  const runtime = input.runtime ?? chrome.runtime;
  const objectUrls = input.objectUrls ?? URL;
  const filename = `liska-chatgpt-reconciliation-${input.bundleId}.zip`;
  let url: string;
  try {
    const owned = new Uint8Array(input.bytes.byteLength);
    owned.set(input.bytes);
    url = objectUrls.createObjectURL(new Blob([owned.buffer], { type: 'application/zip' }));
  } catch {
    return Promise.resolve(fixedFailure());
  }
  return new DownloadSession(
    downloads,
    runtime,
    objectUrls,
    url,
    filename,
    terminalTimeout,
    deferredCleanup
  ).run();
}
