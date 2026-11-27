import {
  collectorSummary,
  snapshotCollectorSource,
  snapshotCollectorSummary,
} from '../lib/claude-account-collector-contract';
import type { CollectorSource, CollectorSummary } from '../lib/claude-account-collector-contract';
import {
  newSlotId,
  snapshotAdoptionReceipt,
  snapshotSlotInventory,
  validSlotLabel,
} from '../lib/account-slot-contract';
import type { AdoptionReceipt, PickerSlot, SlotTarget } from '../lib/account-slot-contract';
import { getMessage } from '../lib/i18n';
import { sendMessage } from '../lib/messaging';

export interface AccountCatalogElements {
  collect: HTMLButtonElement;
  copy: HTMLButtonElement;
  slot: HTMLSelectElement;
  newSlot: HTMLElement;
  label: HTMLInputElement;
  inventory: HTMLElement;
}

interface AccountCatalogActions {
  begin: () => boolean;
  end: () => void;
  isLocked: () => boolean;
  clearEvidence: () => void;
  showStatus: (message: string, type: 'success' | 'error' | 'warning' | 'info') => void;
}

/** Give every label a short suffix, extending it until the displayed suffix is unique. */
function slotDisplayLabel(slot: PickerSlot, slots: readonly PickerSlot[]): string {
  const hex = slot.slotId.slice('account-slot/1:'.length);
  let length = 6;
  while (
    length < hex.length &&
    slots.some(
      item => item.slotId !== slot.slotId && item.slotId.slice(-length) === hex.slice(-length)
    )
  )
    length++;
  return `${slot.label} · ${hex.slice(-length)}`;
}

function selectedSource(tabs: chrome.tabs.Tab[]): {
  source: CollectorSource | undefined;
  failure: 'claude-route-required' | 'active-tab-required';
} {
  const tab = tabs.length === 1 ? tabs[0] : undefined;
  const source =
    tab?.active === true && (!tab.pendingUrl || tab.pendingUrl === tab.url)
      ? snapshotCollectorSource({ tabId: tab.id, windowId: tab.windowId, url: tab.url })
      : undefined;
  return { source, failure: tab ? 'claude-route-required' : 'active-tab-required' };
}

function collectorStatusKey(summary: CollectorSummary): string {
  if (summary.status === 'saved') return 'status_collectorSaved';
  if (summary.status === 'unchanged') return 'status_collectorExisting';
  if (summary.retention === 'owner-existing') return 'status_collectorExistingWarning';
  if (summary.code === 'owner-outcome-unknown') return 'status_collectorOutcomeUnknown';
  if (summary.retention === 'owner-committed') return 'status_collectorCommittedStop';
  return 'status_collectorStopped';
}

export class AccountCatalog {
  private ready = false;
  private slots: readonly PickerSlot[] = [];

  constructor(
    private readonly elements: AccountCatalogElements,
    private readonly actions: AccountCatalogActions
  ) {}

  setDisabled(disabled: boolean): void {
    const slot = this.elements.slot.value;
    const isNew = slot === 'new';
    const validNew = isNew && validSlotLabel(this.elements.label.value);
    const validExisting = this.slots.some(item => item.slotId === slot);
    this.elements.newSlot.hidden = !isNew;
    this.elements.slot.disabled = disabled || !this.ready;
    this.elements.label.disabled = disabled || !this.ready;
    this.elements.collect.disabled = disabled || !this.ready || !(validNew || validExisting);
    this.elements.copy.disabled = disabled || !this.ready || !validNew;
  }

  setupListeners(): void {
    this.elements.collect.addEventListener('click', event => void this.handleCollectorClick(event));
    this.elements.copy.addEventListener('click', event => void this.handleAdoptionClick(event));
    const update = () => this.setDisabled(this.actions.isLocked());
    this.elements.slot.addEventListener('change', update);
    this.elements.label.addEventListener('input', update);
  }

  private renderSlotOptions(): void {
    const select = this.elements.slot;
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.textContent = getMessage('settings_catalogChoose');
    select.append(placeholder);
    for (const slot of this.slots) {
      const option = document.createElement('option');
      option.value = slot.slotId;
      option.textContent = slotDisplayLabel(slot, this.slots);
      select.append(option);
    }
    if (this.ready) {
      const option = document.createElement('option');
      option.value = 'new';
      option.textContent = getMessage('settings_catalogNew');
      select.append(option);
    }
    select.value = '';
    this.elements.label.value = '';
  }

  /** Inventory is the only automatic operation, and never retries a collection. */
  async refresh(isAlive: () => boolean = () => true): Promise<void> {
    this.ready = false;
    this.slots = [];
    this.renderSlotOptions();
    this.elements.inventory.textContent = getMessage('status_catalogInventoryLoading');
    this.setDisabled(true);
    try {
      const inventory = snapshotSlotInventory(
        await sendMessage({ action: 'listAccountCatalogSlots' })
      );
      if (!isAlive()) return;
      if (!inventory || inventory.code !== 'listed') throw new Error('inventory unavailable');
      this.slots = inventory.slots;
      this.ready = true;
      this.renderSlotOptions();
      this.elements.inventory.textContent = getMessage('status_catalogInventoryReady');
    } catch {
      if (!isAlive()) return;
      this.elements.inventory.textContent = getMessage('status_catalogInventoryUnavailable');
    }
  }

  /** Capture the selection and create an id in the click task, before any await. */
  private selectedSlotTarget(): SlotTarget | undefined {
    if (!this.ready) return;
    const value = this.elements.slot.value;
    if (value === 'new') {
      const label = this.elements.label.value;
      if (validSlotLabel(label)) return { kind: 'new', slotId: newSlotId(), label };
    } else if (this.slots.some(slot => slot.slotId === value)) {
      return { kind: 'existing', slotId: value };
    }
  }

  private showCollectorSummary(summary: CollectorSummary): void {
    if (summary.code === 'result-invalid') {
      this.actions.showStatus(getMessage('status_collectorUnavailable'), 'warning');
      return;
    }
    this.actions.showStatus(
      [
        getMessage(collectorStatusKey(summary), [
          summary.code,
          String(summary.dispatch),
          String(summary.page),
          String(summary.target),
          String(summary.marker),
        ]),
        getMessage('status_collectorFacts', [
          String(summary.activeTerminal),
          String(summary.archivedTerminalEmpty),
          String(summary.pairMatched),
          summary.retention,
        ]),
      ].join(' '),
      summary.status === 'saved' ? 'success' : 'warning'
    );
  }

  /** This specific informed click is the manual assertion, never a stored setting. */
  async handleCollectorClick(event: Event): Promise<void> {
    if (event.isTrusted !== true || !this.actions.begin()) return;
    this.actions.clearEvidence();
    this.actions.showStatus(getMessage('status_collectorRunning'), 'info');
    let alive = true;
    let dispatched = false;
    const leaving = () => {
      alive = false;
    };
    window.addEventListener('pagehide', leaving, { once: true });
    try {
      const slot = this.selectedSlotTarget();
      if (!slot) {
        this.actions.showStatus(getMessage('status_catalogSelectionRequired'), 'warning');
        return;
      }
      // Start selection in this click task; never let the worker pick a substitute tab.
      const selected = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!alive) return;
      const { source, failure } = selectedSource(selected);
      let raw: unknown = collectorSummary(failure);
      if (source) {
        if (!alive) return;
        dispatched = true;
        raw = await sendMessage({ action: 'collectClaudeAccountCatalog', source, slot });
      }
      if (!alive) return;
      const summary = snapshotCollectorSummary(raw) ?? collectorSummary('result-invalid');
      this.showCollectorSummary(summary);
      if (summary.retention === 'owner-committed') await this.refresh(() => alive);
    } catch {
      if (alive)
        this.actions.showStatus(
          getMessage(dispatched ? 'status_collectorUnavailable' : 'status_catalogBeforeDispatch'),
          'error'
        );
    } finally {
      window.removeEventListener('pagehide', leaving);
      this.actions.end();
    }
  }

  private showAdoptionReceipt(receipt: AdoptionReceipt): boolean {
    if (receipt.retention === 'owner-committed') {
      const verified = receipt.verification === 'verified' && receipt.cleanup === 'closed';
      this.actions.showStatus(
        getMessage(verified ? 'status_catalogCopySaved' : 'status_catalogCopySavedWarning', [
          receipt.code,
        ]),
        verified ? 'success' : 'warning'
      );
      return true;
    }
    this.actions.showStatus(
      getMessage(
        receipt.code === 'destination-outcome-unknown'
          ? 'status_catalogCopyUnknown'
          : 'status_catalogCopyStopped',
        [receipt.code]
      ),
      'warning'
    );
    return false;
  }

  /** Copying is a separate informed action; it never selects or reads a browser tab. */
  async handleAdoptionClick(event: Event): Promise<void> {
    if (event.isTrusted !== true || !this.actions.begin()) return;
    let alive = true;
    let dispatched = false;
    const leaving = () => {
      alive = false;
    };
    window.addEventListener('pagehide', leaving, { once: true });
    try {
      const slot = this.selectedSlotTarget();
      if (!slot || slot.kind !== 'new') {
        this.actions.showStatus(getMessage('status_catalogSelectionRequired'), 'warning');
        return;
      }
      this.actions.showStatus(getMessage('status_catalogCopyRunning'), 'info');
      if (!alive) return;
      dispatched = true;
      const receipt = snapshotAdoptionReceipt(
        await sendMessage({ action: 'adoptLegacyClaudeCatalog', slot })
      );
      if (!alive) return;
      if (!receipt || receipt.code === 'result-invalid') {
        this.actions.showStatus(getMessage('status_catalogCopyUnavailable'), 'warning');
      } else if (this.showAdoptionReceipt(receipt)) {
        await this.refresh(() => alive);
      }
    } catch {
      if (alive)
        this.actions.showStatus(
          getMessage(dispatched ? 'status_catalogCopyUnavailable' : 'status_catalogBeforeDispatch'),
          'warning'
        );
    } finally {
      window.removeEventListener('pagehide', leaving);
      this.actions.end();
    }
  }
}
