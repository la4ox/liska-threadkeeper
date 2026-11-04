import { type ArchiveTextPreview } from '../archive/presentation/text-contracts';
import {
  adoptArchiveTextPreview,
  createTextPresentationSelection,
  resolveTextPreviewRange,
} from '../archive/presentation/text-preview-selection';
import { renderTextSelection } from '../archive/presentation/text';
import { TEXT_PREVIEW_PENDING_MS } from '../lib/text-preview-contract';
import { downloadSelectedText, type DownloadAttempt, type OutputOutcome } from './download';
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
  download?: typeof downloadSelectedText;
}

const UNAVAILABLE = 'Preview unavailable or expired. Reopen Liska to start again.';
const CONTINUE = 'Choose messages to copy or download. This preview expires automatically.';

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** Holds detached reading data only. Never loads settings, providers, or archive persistence. */
class TextPreviewPage {
  private readonly request: PreviewRequest;
  private readonly sessionId: string | undefined;
  private preview: ArchiveTextPreview | undefined;
  private readonly selected = new Set<string>();
  private readonly search = element<HTMLInputElement>('previewSearch');
  private readonly rows = element('previewRows');
  private readonly status = element('previewStatus');
  private readonly clear = element<HTMLButtonElement>('previewClear');
  private readonly selectAll = element<HTMLButtonElement>('previewSelectAll');
  private readonly deselect = element<HTMLButtonElement>('previewDeselect');
  private readonly copy = element<HTMLButtonElement>('previewCopy');
  private readonly download = element<HTMLButtonElement>('previewDownload');
  private epoch = 0;
  private closed = false;
  private taken = false;
  private outputBusy = false;
  private anchor: number | undefined;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private leaseTimer: ReturnType<typeof setTimeout> | undefined;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private downloadAttempt: DownloadAttempt | undefined;
  private readonly registrationDeadline = Date.now() + TEXT_PREVIEW_PENDING_MS;

  constructor(private readonly options: PreviewOptions) {
    this.request = options.request ?? requestPreview;
    this.sessionId = parsePreviewSession(options.href ?? window.location.href);
    this.bind();
    this.renderSelection();
    if (!this.sessionId) this.erase('Invalid preview link. Open Text-only preview from Liska.');
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
    this.selectAll.addEventListener('click', event =>
      trustedPreviewAction(event, () => {
        for (const row of this.preview?.rows ?? []) this.selected.add(row.nodeId);
        this.renderSelection();
      })
    );
    this.deselect.addEventListener('click', event =>
      trustedPreviewAction(event, () => {
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
    this.preview = undefined;
    this.selected.clear();
    this.anchor = undefined;
    this.search.value = '';
    this.rows.replaceChildren();
    element('previewTitle').textContent = '';
    this.status.textContent = message;
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
            ? 'Capturing the text reading view…'
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
      const adopted = adoptArchiveTextPreview(response.payload);
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
              ? resolveTextPreviewRange(
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
    this.selectAll.disabled = !this.preview || this.outputBusy;
    this.deselect.disabled = !this.selected.size || this.outputBusy;
    this.copy.disabled = this.download.disabled =
      !this.preview || !this.selected.size || this.outputBusy;
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
    this.outputBusy = true;
    this.status.textContent = 'Checking preview lease…';
    this.renderSelection();
    try {
      const ids = preview.rows.filter(row => this.selected.has(row.nodeId)).map(row => row.nodeId);
      const snapshot = createTextPresentationSelection(preview, ids);
      const { text } = renderTextSelection(preview, snapshot);
      if (!(await this.checkLease(epoch)) || !this.active(epoch)) return;
      let outcome: OutputOutcome;
      if (kind === 'copy') outcome = await this.copyText(text);
      else {
        this.downloadAttempt = (this.options.download ?? downloadSelectedText)(text, preview.title);
        this.status.textContent = 'Waiting for the browser download outcome…';
        outcome = await this.downloadAttempt.result;
        this.downloadAttempt = undefined;
      }
      if (!this.active(epoch)) return;
      const label = kind === 'copy' ? 'Copy' : 'Download';
      this.status.textContent =
        outcome === 'success'
          ? kind === 'copy'
            ? 'Selected Text copied.'
            : 'Selected Text download completed.'
          : outcome === 'failure'
            ? `${label} failed. Nothing was retried.`
            : `${label} outcome unknown. Check the browser; nothing was retried.`;
    } catch {
      if (this.active(epoch)) this.status.textContent = 'Output failed. Nothing was retried.';
    } finally {
      if (this.active(epoch)) {
        this.outputBusy = false;
        this.renderSelection();
      }
    }
  }
}

export function initTextPreview(options: PreviewOptions = {}): () => void {
  const page = new TextPreviewPage(options);
  return page.dispose;
}
