import type {
  ArchivePresentationPreview,
  PresentationFormat,
} from '../archive/presentation/presentation-contracts';
import {
  adoptArchivePresentationPreview,
  createPresentationSelection,
  resolvePresentationPreviewRange,
} from '../archive/presentation/preview';
import { renderPresentationSelection } from '../archive/presentation/selected';
import { TEXT_PREVIEW_PENDING_MS } from '../lib/text-preview-contract';
import {
  downloadSelectedBinary,
  downloadSelectedPresentation,
  type BinaryDownloadAttempt,
  type BinaryDownloadReceipt,
  type DownloadAttempt,
  type OutputOutcome,
} from './download';
import type { SelectedDocxArtifact } from './docx-contract';
import { renderSelectedDocx, requireSelectedDocxArtifact } from './docx-renderer';
import {
  isPreviewUuid,
  parsePreviewSession,
  previewMetadata,
  requestPreview,
  responseRecord,
  trustedPreviewAction,
  type PreviewRequest,
} from './protocol';

interface PreviewOptions {
  href?: string;
  request?: PreviewRequest;
  copy?: (text: string) => Promise<void>;
  download?: typeof downloadSelectedPresentation;
  downloadBinary?: typeof downloadSelectedBinary;
  requireDocx?: typeof requireSelectedDocxArtifact;
  renderDocx?: typeof renderSelectedDocx;
}

const UNAVAILABLE = 'Preview unavailable or expired. Reopen Liska to start again.';
const CONTINUE = 'Choose messages to copy or download. This preview expires automatically.';
const FORMAT_LABELS = { text: 'Text', markdown: 'Markdown source', html: 'HTML source' } as const;
const FORMAT_EXTENSIONS = { text: 'txt', markdown: 'md', html: 'html' } as const;

function presentationFormat(value: string): PresentationFormat | undefined {
  return value === 'text' || value === 'markdown' || value === 'html' ? value : undefined;
}

function outputStatus(
  kind: 'copy' | 'download',
  format: PresentationFormat,
  outcome: OutputOutcome
): string {
  const source = FORMAT_LABELS[format];
  const label = `${kind === 'copy' ? 'Copy' : 'Download'} ${source}`;
  if (outcome === 'success')
    return `Selected ${source} ${kind === 'copy' ? 'copied.' : 'download completed.'}`;
  return outcome === 'failure'
    ? `${label} failed. Nothing was retried.`
    : `${label} outcome unknown. Check the browser; nothing was retried.`;
}

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** Holds detached reading data only. Never loads settings, providers, or archive persistence. */
class TextPreviewPage {
  private readonly request: PreviewRequest;
  private readonly sessionId: string | undefined;
  private preview: ArchivePresentationPreview | undefined;
  private format: PresentationFormat = 'text';
  private readonly selected = new Set<string>();
  private readonly search = element<HTMLInputElement>('previewSearch');
  private readonly rows = element('previewRows');
  private readonly status = element('previewStatus');
  private readonly clear = element<HTMLButtonElement>('previewClear');
  private readonly selectAll = element<HTMLButtonElement>('previewSelectAll');
  private readonly deselect = element<HTMLButtonElement>('previewDeselect');
  private readonly copy = element<HTMLButtonElement>('previewCopy');
  private readonly download = element<HTMLButtonElement>('previewDownload');
  private readonly downloadDocx = element<HTMLButtonElement>('previewDownloadDocx');
  private readonly docxReceiptPanel = element<HTMLDetailsElement>('previewDocxReceiptPanel');
  private readonly docxReceipt = element<HTMLPreElement>('previewDocxReceipt');
  private readonly formatControl = element<HTMLSelectElement>('previewFormat');
  private epoch = 0;
  private closed = false;
  private taken = false;
  private outputBusy = false;
  private anchor: number | undefined;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private leaseTimer: ReturnType<typeof setTimeout> | undefined;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private downloadAttempt: DownloadAttempt | undefined;
  private binaryDownloadAttempt: BinaryDownloadAttempt | undefined;
  private docxAbort: AbortController | undefined;
  private readonly registrationDeadline = Date.now() + TEXT_PREVIEW_PENDING_MS;

  constructor(private readonly options: PreviewOptions) {
    this.request = options.request ?? requestPreview;
    this.sessionId = parsePreviewSession(options.href ?? window.location.href);
    this.bind();
    this.renderSelection();
    if (!this.sessionId)
      this.erase('Invalid preview link. Open Selected reading preview from Liska.');
    else {
      this.clear.disabled = false;
      void this.poll(this.epoch);
    }
  }

  private active(epoch: number): boolean {
    return !this.closed && epoch === this.epoch;
  }

  private bind(): void {
    this.search.addEventListener('input', () => this.renderSelection());
    this.formatControl.addEventListener('change', event =>
      trustedPreviewAction(event, () => {
        const format = presentationFormat(this.formatControl.value);
        if (this.preview && !this.outputBusy && format) this.format = format;
        this.renderSelection();
      })
    );
    this.selectAll.addEventListener('click', event =>
      trustedPreviewAction(event, () => {
        if (!this.preview || this.outputBusy) return;
        for (const row of this.preview?.rows ?? []) this.selected.add(row.nodeId);
        this.renderSelection();
      })
    );
    this.deselect.addEventListener('click', event =>
      trustedPreviewAction(event, () => {
        if (!this.preview || this.outputBusy) return;
        this.selected.clear();
        this.anchor = undefined;
        this.renderSelection();
      })
    );
    this.clear.addEventListener('click', event =>
      trustedPreviewAction(event, () => {
        this.erase('Preview cleared. Close this window or start again from Liska.');
        this.invalidate('clear');
      })
    );
    this.copy.addEventListener('click', event =>
      trustedPreviewAction(event, () => {
        void this.output('copy');
      })
    );
    this.download.addEventListener('click', event =>
      trustedPreviewAction(event, () => {
        void this.output('download');
      })
    );
    this.downloadDocx.addEventListener('click', event =>
      trustedPreviewAction(event, () => {
        void this.outputDocx();
      })
    );
    window.addEventListener('pagehide', this.dispose, { once: true });
  }

  private invalidate(reason: 'clear' | 'close'): void {
    if (this.sessionId)
      void this.request({
        action: 'invalidateTextPreview',
        sessionId: this.sessionId,
        reason,
      }).catch(() => undefined);
  }

  readonly dispose = (): void => {
    if (this.closed) return;
    this.erase('Preview closed.');
    this.closed = true;
    window.removeEventListener('pagehide', this.dispose);
    this.invalidate('close');
  };

  private erase(message: string): void {
    this.epoch += 1;
    clearTimeout(this.pollTimer);
    clearTimeout(this.leaseTimer);
    clearTimeout(this.expiryTimer);
    this.downloadAttempt?.dispose();
    this.downloadAttempt = undefined;
    this.binaryDownloadAttempt?.dispose();
    this.binaryDownloadAttempt = undefined;
    this.docxAbort?.abort();
    this.docxAbort = undefined;
    this.preview = undefined;
    this.selected.clear();
    this.anchor = undefined;
    this.search.value = '';
    this.rows.replaceChildren();
    element('previewTitle').textContent = '';
    this.status.textContent = message;
    this.docxReceipt.textContent = '';
    this.docxReceiptPanel.hidden = true;
    this.docxReceiptPanel.open = false;
    this.clear.disabled = true;
    this.outputBusy = false;
    this.renderSelection();
  }

  private async poll(epoch: number): Promise<void> {
    try {
      const response = await this.request({
        action: 'getTextPreviewStatus',
        sessionId: this.sessionId!,
      });
      if (!this.active(epoch)) return;
      // The window can load before its background registration completes.
      if (
        responseRecord(response)?.error === 'text-preview-not-ready' &&
        Date.now() < this.registrationDeadline
      ) {
        this.pollTimer = setTimeout(() => void this.poll(epoch), 1_000);
        return;
      }
      const metadata = previewMetadata(response);
      if (
        !metadata ||
        !['pending', 'capturing', 'awaiting-selection', 'ready'].includes(metadata.state)
      ) {
        this.erase(UNAVAILABLE);
        return;
      }
      this.setExpiry(metadata.expiresAt);
      if (metadata.state === 'ready') {
        await this.deliver(epoch);
        return;
      }
      this.status.textContent =
        metadata.state === 'awaiting-selection'
          ? 'Choose a branch in the Liska popup to continue.'
          : metadata.state === 'capturing'
            ? 'Capturing the reading view…'
            : 'Preparing preview…';
      this.pollTimer = setTimeout(() => void this.poll(epoch), 1_000);
    } catch {
      if (this.active(epoch)) this.erase(UNAVAILABLE);
    }
  }

  private setExpiry(expiresAt: number): void {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(
      () => this.erase(UNAVAILABLE),
      Math.max(0, expiresAt - Date.now())
    );
  }

  private async deliver(epoch: number): Promise<void> {
    if (this.taken) return;
    this.taken = true; // Set before crossing the callback boundary. Never retake.
    try {
      const response = responseRecord(
        await this.request({
          action: 'takeTextPreviewPayload',
          sessionId: this.sessionId!,
        })
      );
      if (!this.active(epoch)) return;
      if (response?.success !== true || !isPreviewUuid(response.deliveryId)) throw new Error();
      const adopted = adoptArchivePresentationPreview(response.payload);
      const acknowledged = await this.acknowledge(response.deliveryId, epoch);
      if (!this.active(epoch)) return;
      if (!acknowledged) throw new Error();
      this.preview = adopted;
      this.status.textContent = CONTINUE;
      this.renderRows();
      this.scheduleLease(epoch);
    } catch {
      if (this.active(epoch))
        this.erase('Preview delivery failed. Close this window and start again from Liska.');
    }
  }

  private async acknowledge(deliveryId: string, epoch: number): Promise<boolean> {
    try {
      const ack = responseRecord(
        await this.request({
          action: 'ackTextPreviewPayload',
          sessionId: this.sessionId!,
          deliveryId,
        })
      );
      return this.active(epoch) && ack?.success === true;
    } catch {
      if (!this.active(epoch)) return false;
      // Only a lost ACK can be reconciled. Metadata cannot authorize another take.
      const metadata = previewMetadata(
        await this.request({
          action: 'getTextPreviewStatus',
          sessionId: this.sessionId!,
        })
      );
      if (!this.active(epoch) || metadata?.state !== 'delivered') return false;
      this.setExpiry(metadata.expiresAt);
      return true;
    }
  }

  private scheduleLease(epoch: number): void {
    clearTimeout(this.leaseTimer);
    this.leaseTimer = setTimeout(() => {
      void this.checkLease(epoch).then(live => {
        if (live) this.scheduleLease(epoch);
      });
    }, 5_000);
  }

  private async checkLease(epoch: number): Promise<boolean> {
    try {
      const metadata = previewMetadata(
        await this.request({
          action: 'getTextPreviewStatus',
          sessionId: this.sessionId!,
        })
      );
      if (!this.active(epoch)) return false;
      if (metadata?.state !== 'delivered') throw new Error();
      this.setExpiry(metadata.expiresAt);
      return true;
    } catch {
      if (this.active(epoch)) this.erase(UNAVAILABLE);
      return false;
    }
  }

  private renderRows(): void {
    const preview = this.preview!;
    element('previewTitle').textContent = preview.title ?? 'Untitled conversation';
    const fragment = document.createDocumentFragment();
    preview.rows.forEach((row, index) => {
      const card = document.createElement('article');
      card.className = 'message-card';
      const label = document.createElement('label');
      label.className = 'message-label';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.setAttribute('aria-label', `Select message ${index + 1}, ${row.role}`);
      checkbox.addEventListener('click', event =>
        trustedPreviewAction(event, () => {
          if (!this.preview || this.outputBusy) return;
          const ids =
            event.shiftKey && this.anchor !== undefined
              ? resolvePresentationPreviewRange(
                  this.preview,
                  Math.min(this.anchor, index + 1),
                  Math.max(this.anchor, index + 1)
                )
              : [row.nodeId];
          for (const id of ids) {
            if (checkbox.checked) this.selected.add(id);
            else this.selected.delete(id);
          }
          this.anchor = index + 1;
          this.renderSelection();
        })
      );
      const role = document.createElement('span');
      role.textContent = `${index + 1} · ${row.role === 'user' ? 'User' : 'Assistant'}`;
      const text = document.createElement('pre');
      text.className = 'message-text';
      text.textContent = row.presentedText;
      label.append(checkbox, role);
      card.append(label, text);
      fragment.append(card);
    });
    this.rows.replaceChildren(fragment);
    this.renderSelection();
  }

  private renderSelection(): void {
    const query = this.search.value.toLocaleLowerCase();
    let filtered = 0;
    let hiddenSelected = 0;
    this.preview?.rows.forEach((row, index) => {
      const visible =
        !query || `${row.role}\n${row.presentedText}`.toLocaleLowerCase().includes(query);
      const card = this.rows.children[index] as HTMLElement;
      card.hidden = !visible;
      card.classList.toggle('search-match', visible && query.length > 0);
      card.classList.toggle('is-selected', this.selected.has(row.nodeId));
      const checkbox = card.querySelector('input')!;
      checkbox.checked = this.selected.has(row.nodeId);
      checkbox.disabled = this.outputBusy;
      if (visible) filtered += 1;
      else if (this.selected.has(row.nodeId)) hiddenSelected += 1;
    });
    for (const [id, count] of [
      ['previewTotal', this.preview?.rows.length ?? 0],
      ['previewFiltered', filtered],
      ['previewSelected', this.selected.size],
      ['previewHiddenSelected', hiddenSelected],
    ] as const)
      element(id).textContent = String(count);
    this.search.disabled = !this.preview;
    this.formatControl.value = this.format;
    this.formatControl.disabled = !this.preview || this.outputBusy;
    this.copy.textContent = `Copy ${FORMAT_LABELS[this.format]}`;
    this.download.textContent = `Download .${FORMAT_EXTENSIONS[this.format]}`;
    this.selectAll.disabled = !this.preview || this.outputBusy;
    this.deselect.disabled = !this.selected.size || this.outputBusy;
    this.copy.disabled = this.download.disabled =
      !this.preview || !this.selected.size || this.outputBusy;
    this.downloadDocx.disabled = !this.preview || !this.selected.size || this.outputBusy;
  }

  private async copyText(text: string): Promise<OutputOutcome> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (this.options.copy ? this.options.copy(text) : navigator.clipboard.writeText(text)).then(
          () => 'success' as const,
          () => 'failure' as const
        ),
        new Promise<OutputOutcome>(resolve => {
          timer = setTimeout(() => resolve('unknown'), 10_000);
        }),
      ]);
    } catch {
      return 'failure';
    } finally {
      clearTimeout(timer);
    }
  }

  private async output(kind: 'copy' | 'download'): Promise<void> {
    if (!this.preview || !this.selected.size || this.outputBusy) return;
    const epoch = this.epoch;
    const preview = this.preview;
    const format = this.format;
    const ids = preview.rows.filter(row => this.selected.has(row.nodeId)).map(row => row.nodeId);
    this.outputBusy = true;
    this.status.textContent = 'Checking preview lease…';
    this.renderSelection();
    try {
      const snapshot = createPresentationSelection(preview, ids);
      const artifact = renderPresentationSelection(preview, snapshot, format);
      if (!(await this.checkLease(epoch)) || !this.active(epoch)) return;
      let outcome: OutputOutcome;
      if (kind === 'copy') outcome = await this.copyText(artifact.content);
      else {
        this.downloadAttempt = (this.options.download ?? downloadSelectedPresentation)(
          artifact,
          preview.title
        );
        this.status.textContent = 'Waiting for the browser download outcome…';
        outcome = await this.downloadAttempt.result;
        this.downloadAttempt = undefined;
      }
      if (!this.active(epoch)) return;
      this.status.textContent = outputStatus(kind, format, outcome);
    } catch {
      if (this.active(epoch)) this.status.textContent = 'Output failed. Nothing was retried.';
    } finally {
      if (this.active(epoch)) {
        this.outputBusy = false;
        this.renderSelection();
      }
    }
  }

  private async outputDocx(): Promise<void> {
    if (!this.preview || !this.selected.size || this.outputBusy) return;
    const epoch = this.epoch;
    const preview = this.preview;
    const ids = preview.rows.filter(row => this.selected.has(row.nodeId)).map(row => row.nodeId);
    const selection = createPresentationSelection(preview, ids);
    const controller = new AbortController();
    this.docxAbort = controller;
    this.outputBusy = true;
    this.status.textContent = 'Checking preview lease before local DOCX rendering…';
    this.renderSelection();
    try {
      if (!(await this.checkLease(epoch)) || !this.active(epoch)) return;
      this.status.textContent = 'Rendering selected DOCX locally…';
      const artifact = await (this.options.renderDocx ?? renderSelectedDocx)(preview, selection, {
        signal: controller.signal,
      });
      if (!this.active(epoch) || controller.signal.aborted) return;
      this.status.textContent = 'Checking preview lease before DOCX download…';
      if (!(await this.checkLease(epoch)) || !this.active(epoch)) return;
      await this.deliverDocx(artifact, preview.title, epoch);
    } catch {
      if (this.active(epoch) && !controller.signal.aborted)
        this.status.textContent = 'DOCX rendering failed. Nothing was retried.';
    } finally {
      this.finishDocxOutput(controller, epoch);
    }
  }

  private async deliverDocx(
    artifact: SelectedDocxArtifact,
    title: string | null,
    epoch: number
  ): Promise<void> {
    (this.options.requireDocx ?? requireSelectedDocxArtifact)(artifact);
    this.binaryDownloadAttempt = (this.options.downloadBinary ?? downloadSelectedBinary)(
      artifact,
      title
    );
    this.status.textContent = 'Waiting for the browser DOCX download outcome…';
    const delivery = await this.binaryDownloadAttempt.result;
    this.binaryDownloadAttempt = undefined;
    if (this.active(epoch)) this.showDocxReceipt(artifact, delivery);
  }

  private showDocxReceipt(artifact: SelectedDocxArtifact, delivery: BinaryDownloadReceipt): void {
    const { branchTargetNodeId: _privateBranchTargetNodeId, ...safeRenderReceipt } =
      artifact.receipt;
    void _privateBranchTargetNodeId;
    const receipt = Object.freeze({
      schema: 'liska-selected-docx-delivery-receipt/1',
      render: safeRenderReceipt,
      delivery,
    });
    this.docxReceipt.textContent = JSON.stringify(receipt, null, 2);
    this.docxReceiptPanel.hidden = false;
    const size = artifact.receipt.byteLength.toLocaleString('en-US');
    this.status.textContent =
      delivery.outcome === 'success'
        ? `Selected DOCX download completed. ${size} bytes · SHA-256 ${artifact.receipt.sha256}.`
        : delivery.outcome === 'failure'
          ? 'DOCX download failed. Nothing was retried.'
          : 'DOCX download outcome unknown. Check the browser; nothing was retried.';
  }

  private finishDocxOutput(controller: AbortController, epoch: number): void {
    if (this.docxAbort === controller) this.docxAbort = undefined;
    if (this.active(epoch)) {
      this.outputBusy = false;
      this.renderSelection();
    }
  }
}

export function initTextPreview(options: PreviewOptions = {}): () => void {
  const page = new TextPreviewPage(options);
  return page.dispose;
}
