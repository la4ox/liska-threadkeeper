import {
  boundedBranchOptions,
  type ExportBranchOption,
  type ExportStatus,
  type ExportTarget,
} from '../lib/export-operation-contract';
import { getMessage } from '../lib/i18n';
import {
  isTextPreviewStartFailureStep,
  isTextPreviewToken,
  type TextPreviewBranchMode,
  type TextPreviewStartFailureStep,
} from '../lib/text-preview-contract';
import { responseRecord, trustedPreviewAction, type PreviewRequest } from './protocol';

interface PopupPreviewDependencies {
  request: PreviewRequest;
  exportState(): ExportStatus;
  exportBusy(): boolean;
  changed(): void;
}
interface PopupPreviewSession {
  id: string;
  captureExpiresAt: number;
  selectionId?: string;
  choosing: boolean;
}

function startFailureMessage(step: TextPreviewStartFailureStep): string {
  if (step === 'window-create' || step === 'window-shape')
    return getMessage('preview_windowUnavailable');
  if (step.startsWith('navigation-')) return getMessage('preview_navigationUnavailable');
  if (step === 'page-registration') return getMessage('preview_registrationUnavailable');
  if (step === 'source-accept') return getMessage('preview_sourceUnavailable');
  return getMessage('preview_startChanged');
}
interface RenderedPreviewSelection {
  readonly sessionId: string;
  readonly selectionId: string;
  readonly optionsFingerprint: string;
}

const button = (id: string) => document.getElementById(id) as HTMLButtonElement;

function branchOptionsFingerprint(options: readonly ExportBranchOption[]): string {
  // Exact scalar tuples include non-displayed counts and distinguish absent/empty preview.
  return JSON.stringify(
    options.map(option => [
      option.ordinal,
      option.messageCount,
      option.uniqueMessageCount,
      option.isCurrent,
      option.preview,
    ])
  );
}

/** Popup-only identity and lifetime lock; it never reads page-only metadata. */
export class PopupTextPreview {
  private readonly current = button('previewCurrent');
  private readonly selected = button('previewSelected');
  private readonly choices = document.getElementById('previewBranches')!;
  private readonly status = document.getElementById('previewStatus')!;
  private session: PopupPreviewSession | undefined;
  private polling = false;
  private closed = false;
  private deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  private lifetimeLocked = false;
  private renderedSelection: RenderedPreviewSelection | undefined;

  constructor(private readonly deps: PopupPreviewDependencies) {
    this.current.addEventListener('click', event =>
      trustedPreviewAction(event, () => {
        void this.start('current');
      })
    );
    this.selected.addEventListener('click', event =>
      trustedPreviewAction(event, () => {
        void this.start('selected');
      })
    );
  }

  get locked(): boolean {
    return this.lifetimeLocked;
  }

  private startTarget(mode: TextPreviewBranchMode): ExportTarget | undefined {
    const state = this.deps.exportState();
    if (this.closed || this.locked || this.deps.exportBusy() || !state.success) return;
    const running = state.operation && !['completed', 'cancelled'].includes(state.operation.phase);
    if (running || !state.target || !['chatgpt', 'deepseek'].includes(state.target.platform))
      return;
    if (mode === 'selected' && state.target.platform !== 'chatgpt') return;
    return state.target;
  }

  render(): void {
    this.current.disabled = !this.startTarget('current');
    this.selected.hidden = this.deps.exportState().target?.platform !== 'chatgpt';
    this.selected.disabled = !this.startTarget('selected');
    this.updateChoicesDisabled();
  }

  dispose(): void {
    this.closed = true;
    clearTimeout(this.deadlineTimer);
    this.retireChoices();
    this.session = undefined;
    this.render();
  }

  private retireChoices(): void {
    for (const item of this.choices.querySelectorAll('button')) item.disabled = true;
    this.choices.replaceChildren();
    this.renderedSelection = undefined;
  }

  private updateChoicesDisabled(): void {
    const identity = this.renderedSelection;
    const disabled = !identity || !this.currentSelection(identity);
    for (const item of this.choices.querySelectorAll('button')) {
      if (item.disabled !== disabled) item.disabled = disabled;
    }
  }

  private expired(): void {
    if (this.closed || !this.session) return;
    this.session.selectionId = undefined;
    this.session.choosing = true;
    this.retireChoices();
    this.status.textContent = getMessage('preview_branchExpired');
  }

  private continues(): void {
    clearTimeout(this.deadlineTimer);
    this.retireChoices();
    this.status.textContent = getMessage('preview_opened');
  }

  private async choose(choice: number, identity: RenderedPreviewSelection): Promise<void> {
    const session = this.currentSelection(identity);
    if (!session) return;
    session.choosing = true;
    session.selectionId = undefined;
    this.retireChoices();
    this.status.textContent = getMessage('preview_starting');
    try {
      const result = responseRecord(
        await this.deps.request({
          action: 'chooseTextPreviewBranch',
          sessionId: identity.sessionId,
          selectionId: identity.selectionId,
          choice,
        })
      );
      if (this.closed || this.session !== session) return;
      if (Date.now() >= session.captureExpiresAt) {
        this.expired();
        return;
      }
      if (result?.success !== true) throw new Error();
      this.continues();
    } catch {
      if (!this.closed) {
        clearTimeout(this.deadlineTimer);
        this.status.textContent = getMessage('preview_unavailable');
      }
    }
  }

  private currentSelection(identity: RenderedPreviewSelection): PopupPreviewSession | undefined {
    const session = this.session;
    if (
      this.closed ||
      this.deps.exportBusy() ||
      !session ||
      session.choosing ||
      this.renderedSelection !== identity ||
      session.id !== identity.sessionId ||
      session.selectionId !== identity.selectionId ||
      Date.now() >= session.captureExpiresAt
    )
      return;
    return session;
  }

  private renderOptions(
    result: Record<string, unknown> | undefined,
    session: PopupPreviewSession
  ): void {
    const options = boundedBranchOptions(result?.options);
    if (
      result?.success !== true ||
      result.state !== 'awaiting-selection' ||
      !isTextPreviewToken(result.selectionId) ||
      !options?.length
    ) {
      session.selectionId = undefined;
      this.updateChoicesDisabled();
      this.status.textContent = getMessage('preview_waitingBranch');
      return;
    }
    const selectionId = result.selectionId;
    session.selectionId = selectionId;
    this.status.textContent = getMessage('preview_chooseBranch');
    const optionsFingerprint = branchOptionsFingerprint(options);
    const rendered = this.renderedSelection;
    if (
      rendered?.sessionId === session.id &&
      rendered.selectionId === selectionId &&
      rendered.optionsFingerprint === optionsFingerprint
    ) {
      this.updateChoicesDisabled();
      return;
    }
    this.retireChoices();
    const identity = { sessionId: session.id, selectionId, optionsFingerprint };
    this.renderedSelection = identity;
    const nodes = options.map(option => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'branch-choice';
      item.textContent = `#${option.ordinal} · ${getMessage('export_branchMessages', String(option.messageCount))}${option.isCurrent ? ` · ${getMessage('export_branchCurrent')}` : ''}${option.preview ? `\n${option.preview}` : ''}`;
      item.addEventListener('click', event =>
        trustedPreviewAction(event, () => {
          void this.choose(option.ordinal, identity);
        })
      );
      return item;
    });
    this.choices.replaceChildren(...nodes);
    this.updateChoicesDisabled();
  }

  async refreshOptions(): Promise<void> {
    const session = this.session;
    if (this.closed || this.polling || !session || session.choosing) return;
    if (Date.now() >= session.captureExpiresAt) {
      this.expired();
      return;
    }
    this.polling = true;
    try {
      const result = responseRecord(
        await this.deps.request({
          action: 'getTextPreviewBranchOptions',
          sessionId: session.id,
        })
      );
      if (this.closed || this.session !== session || session.choosing) return;
      if (Date.now() >= session.captureExpiresAt) {
        this.expired();
        return;
      }
      this.renderOptions(result, session);
    } catch {
      if (!this.closed && this.session === session && !session.choosing) {
        session.selectionId = undefined;
        this.updateChoicesDisabled();
        this.status.textContent = getMessage('preview_waitingBranch');
      }
    } finally {
      this.polling = false;
    }
  }

  private async start(branchMode: TextPreviewBranchMode): Promise<void> {
    const target = this.startTarget(branchMode);
    if (!target) return;
    this.lifetimeLocked = true;
    this.deps.changed();
    this.status.textContent = getMessage('preview_starting');
    try {
      const result = responseRecord(
        await this.deps.request({
          action: 'startTextPreview',
          branchMode,
          expectedTarget: { tabId: target.tabId, route: target.route },
        })
      );
      if (this.closed) return;
      if (result?.success !== true) {
        if (isTextPreviewStartFailureStep(result?.failureStep)) {
          this.status.textContent = startFailureMessage(result.failureStep);
          return;
        }
        throw new Error();
      }
      if (
        !isTextPreviewToken(result.sessionId) ||
        !['pending', 'capturing', 'awaiting-selection'].includes(result.state as string) ||
        !Number.isSafeInteger(result.captureExpiresAt) ||
        (result.captureExpiresAt as number) <= Date.now()
      )
        throw new Error();
      this.session = {
        id: result.sessionId,
        captureExpiresAt: result.captureExpiresAt as number,
        choosing: branchMode === 'current',
      };
      if (branchMode === 'current') this.continues();
      else {
        this.status.textContent = getMessage('preview_waitingBranch');
        this.deadlineTimer = setTimeout(
          () => this.expired(),
          this.session.captureExpiresAt - Date.now()
        );
        void this.refreshOptions();
      }
    } catch {
      if (!this.closed) this.status.textContent = getMessage('preview_unavailable');
    }
  }
}
