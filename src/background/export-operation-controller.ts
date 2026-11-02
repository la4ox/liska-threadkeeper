/** Worker-owned authority. Storage contains bounded routing metadata, never captured chat/catalogs. */
import {
  EXPORT_CLEANUP_ACTIONS,
  EXPORT_DURABLE_ACTIONS,
  EXPORT_OPERATION_MS,
  EXPORT_PENDING_MS,
  EXPORT_POPUP_PATH,
  EXPORT_STATE_KEY,
  boundedBranchOptions,
  exportRoute,
  isExportToken,
  isExportTerminalOutcome,
  type ExportChoice,
  type ExportControlMessage,
  type ExportMode,
  type ExportPhase,
  type ExportStatus,
  type ExportTarget,
  type ExportTerminalOutcome,
} from '../lib/export-operation-contract';
import {
  serializeSyncSettingsSnapshot,
  isSerializedSyncSettingsSnapshot,
} from '../lib/sync-settings-snapshot';
import type { ExtensionSettings, OutputDestination } from '../lib/types';

interface Intent {
  id: string;
  target: ExportTarget;
  mode: ExportMode;
  snapshot: string;
  keyHash: string;
  expires: number;
  uiSessionId?: string;
}
interface Operation extends Intent {
  documentId: string;
  phase: ExportPhase;
  selectionId?: string;
  choice?: ExportChoice;
  outcome?: ExportTerminalOutcome;
  stages: string[];
}
interface Surface {
  id: string;
  tabId: number;
  windowId: number;
  source: ExportTarget;
  expires: number;
  operationId?: string;
}
interface State {
  version: 1;
  intents: Intent[];
  operations: Operation[];
  surfaces: Surface[];
}
export interface ExportControllerDependencies {
  chrome: typeof chrome;
  settings: () => Promise<ExtensionSettings>;
  now?: () => number;
  random?: () => string;
  revision?: () => number;
}
const denied = () => ({
  success: false,
  error: 'Export authorization expired or unavailable. Reopen Export.',
});
const live = (op: Operation) => op.phase !== 'cancelled' && op.phase !== 'completed';
const outputs = (settings: ExtensionSettings): OutputDestination[] =>
  (['obsidian', 'file', 'clipboard'] as const).filter(output => settings.outputOptions[output]);
function target(tab: chrome.tabs.Tab): ExportTarget | undefined {
  const route = exportRoute(tab.url);
  return route && Number.isSafeInteger(tab.id)
    ? { ...route, tabId: tab.id!, title: (tab.title ?? route.platform).slice(0, 160) }
    : undefined;
}
async function keyHash(settings: ExtensionSettings): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(settings.obsidianApiKey)
  );
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function validTarget(value: ExportTarget): boolean {
  const parsed = exportRoute(value?.route);
  return (
    !!parsed &&
    parsed.platform === value.platform &&
    Number.isSafeInteger(value.tabId) &&
    value.tabId >= 0 &&
    typeof value.title === 'string' &&
    value.title.length <= 160
  );
}
function validIntent(value: Intent): boolean {
  return (
    !!value &&
    isExportToken(value.id) &&
    validTarget(value.target) &&
    ['current', 'selected'].includes(value.mode) &&
    isSerializedSyncSettingsSnapshot(value.snapshot) &&
    /^[a-f0-9]{64}$/.test(value.keyHash) &&
    Number.isSafeInteger(value.expires) &&
    (value.uiSessionId === undefined || isExportToken(value.uiSessionId))
  );
}
function onlyKeys(value: object, keys: string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}
function hydrate(value: unknown): State {
  const state = value as State;
  if (
    !state ||
    state.version !== 1 ||
    !Array.isArray(state.intents) ||
    state.intents.length > 32 ||
    !state.intents.every(validIntent) ||
    !Array.isArray(state.operations) ||
    state.operations.length > 64 ||
    !state.operations.every(
      op =>
        validIntent(op) &&
        typeof op.documentId === 'string' &&
        /^[A-Za-z0-9_-]{8,256}$/.test(op.documentId) &&
        ['preparing', 'awaiting-selection', 'exporting', 'cancelled', 'completed'].includes(
          op.phase
        ) &&
        (op.selectionId === undefined || isExportToken(op.selectionId)) &&
        (op.outcome === undefined || isExportTerminalOutcome(op.outcome)) &&
        Array.isArray(op.stages) &&
        op.stages.length <= 4096 &&
        op.stages.every(id => typeof id === 'string' && id.length <= 256)
    ) ||
    !Array.isArray(state.surfaces) ||
    state.surfaces.length > 32 ||
    !state.surfaces.every(
      ui =>
        isExportToken(ui.id) &&
        Number.isSafeInteger(ui.tabId) &&
        Number.isSafeInteger(ui.windowId) &&
        validTarget(ui.source) &&
        Number.isSafeInteger(ui.expires) &&
        (ui.operationId === undefined || isExportToken(ui.operationId))
    )
  )
    throw new Error('Invalid operation state');
  if (new Set(state.operations.map(op => op.id)).size !== state.operations.length)
    throw new Error('Duplicate generation');
  const intentKeys = ['id', 'target', 'mode', 'snapshot', 'keyHash', 'expires', 'uiSessionId'];
  if (
    !onlyKeys(state, ['version', 'intents', 'operations', 'surfaces']) ||
    !state.intents.every(item => onlyKeys(item, intentKeys)) ||
    !state.surfaces.every(item =>
      onlyKeys(item, ['id', 'tabId', 'windowId', 'source', 'expires', 'operationId'])
    ) ||
    !state.operations.every(
      op =>
        onlyKeys(op, [
          ...intentKeys,
          'documentId',
          'phase',
          'selectionId',
          'choice',
          'outcome',
          'stages',
        ]) &&
        (op.outcome === undefined ||
          (op.phase === 'completed' &&
            (op.outcome === 'branch-preparation-ended'
              ? op.mode === 'selected' && op.choice === undefined
              : op.mode === 'current' || op.choice !== undefined))) &&
        (op.choice === undefined ||
          op.choice === 'all' ||
          (Number.isSafeInteger(op.choice) && op.choice > 0)) &&
        (op.mode !== 'current' ||
          (!op.selectionId &&
            op.choice === undefined &&
            op.phase !== 'preparing' &&
            op.phase !== 'awaiting-selection')) &&
        (op.phase !== 'awaiting-selection' || !!op.selectionId) &&
        (op.phase !== 'exporting' ||
          op.mode === 'current' ||
          (!!op.selectionId && op.choice !== undefined))
    )
  )
    throw new Error('Invalid phase metadata');
  const liveTabs = state.operations.filter(live).map(op => op.target.tabId);
  if (new Set(liveTabs).size !== liveTabs.length) throw new Error('Overlapping generations');
  return state;
}

export class ExportOperationController {
  private readonly api: typeof chrome;
  private readonly now: () => number;
  private readonly random: () => string;
  private state: State = { version: 1, intents: [], operations: [], surfaces: [] };
  private queue: Promise<unknown> = Promise.resolve();
  private revocationSequence = 0;
  private readonly tabRevocations = new Map<number, number>();
  private readonly ready: Promise<void>;
  constructor(private readonly deps: ExportControllerDependencies) {
    this.api = deps.chrome;
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? (() => crypto.randomUUID());
    this.ready = Promise.resolve()
      .then(() => this.api.storage.session.get(EXPORT_STATE_KEY))
      .then(record => {
        if (record[EXPORT_STATE_KEY] !== undefined) this.state = hydrate(record[EXPORT_STATE_KEY]);
      })
      .catch(() => {
        this.state = { version: 1, intents: [], operations: [], surfaces: [] };
      });
  }
  private locked<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      await this.ready;
      this.prune();
      if (this.state.operations.length + this.state.intents.length > 64) {
        await this.recoverOverreservedIntents();
      }
      return work();
    });
    this.queue = result.catch(() => undefined);
    return result;
  }
  private oldestReclaimableOperations(count: number): Operation[] {
    return this.state.operations.filter(op => !live(op) && op.stages.length === 0).slice(0, count);
  }
  /** Repair older individually valid state before any retained intent may claim. */
  private async recoverOverreservedIntents(): Promise<void> {
    const overflow = this.state.operations.length + this.state.intents.length - 64;
    const reclaim = this.oldestReclaimableOperations(overflow);
    this.state.operations = this.state.operations.filter(op => !reclaim.includes(op));
    // Protected operations win over excess reservations. Keep the oldest intents;
    // newer revoked intents fail closed when their delayed claims arrive.
    this.state.intents = this.state.intents.slice(0, 64 - this.state.operations.length);
    await this.save();
  }
  private prune(): void {
    this.state.intents = this.state.intents.filter(item => item.expires > this.now());
    for (const op of this.state.operations) {
      if (op.expires <= this.now() && live(op)) {
        op.phase = 'cancelled';
        void this.send(op, { action: 'cancelExportOperation' }).catch(() => undefined);
      }
    }
    // A short cleanup-only grace cannot authorize capture or durable dispatch.
    this.state.operations = this.state.operations.filter(
      item => item.expires + 10 * 60_000 > this.now()
    );
    this.state.surfaces = this.state.surfaces.filter(item => item.expires > this.now());
  }
  private async save(): Promise<void> {
    try {
      await this.api.storage.session.set({ [EXPORT_STATE_KEY]: this.state });
    } catch (error) {
      // A failed durable state transition must never leave an in-memory grant.
      this.state = { version: 1, intents: [], operations: [], surfaces: [] };
      // If the replacement failed (for example session quota), remove this
      // controller's exact key so restart cannot hydrate the previous grant.
      if (typeof this.api.storage.session.remove === 'function') {
        await this.api.storage.session.remove(EXPORT_STATE_KEY).catch(() => undefined);
      }
      throw error;
    }
  }
  isToolbar(sender: chrome.runtime.MessageSender): boolean {
    return (
      sender.id === this.api.runtime.id &&
      sender.tab === undefined &&
      sender.url === this.api.runtime.getURL(EXPORT_POPUP_PATH)
    );
  }
  isUiCandidate(sender: chrome.runtime.MessageSender): boolean {
    if (this.isToolbar(sender)) return true;
    const prefix = this.api.runtime.getURL(`${EXPORT_POPUP_PATH}?surface=`);
    return (
      sender.id === this.api.runtime.id &&
      typeof sender.url === 'string' &&
      sender.url.startsWith(prefix) &&
      isExportToken(sender.url.slice(prefix.length))
    );
  }
  private surface(sender: chrome.runtime.MessageSender): Surface | undefined {
    return this.state.surfaces.find(
      ui =>
        sender.id === this.api.runtime.id &&
        sender.frameId === 0 &&
        sender.tab?.id === ui.tabId &&
        sender.tab.windowId === ui.windowId &&
        sender.url === this.api.runtime.getURL(`${EXPORT_POPUP_PATH}?surface=${ui.id}`)
    );
  }
  async isUi(sender: chrome.runtime.MessageSender): Promise<boolean> {
    return this.locked(async () => this.isToolbar(sender) || !!this.surface(sender));
  }
  async uiSource(sender: chrome.runtime.MessageSender): Promise<ExportTarget | undefined> {
    return this.locked(() => this.uiTarget(sender));
  }
  private content(sender: chrome.runtime.MessageSender): ExportTarget | undefined {
    if (
      sender.id !== this.api.runtime.id ||
      sender.frameId !== 0 ||
      typeof sender.documentId !== 'string' ||
      !/^[A-Za-z0-9_-]{8,256}$/.test(sender.documentId) ||
      !sender.tab
    )
      return undefined;
    const current = target(sender.tab);
    const document = exportRoute(sender.url);
    return current &&
      document?.platform === current.platform &&
      new URL(document.route).origin === new URL(current.route).origin
      ? current
      : undefined;
  }
  private owns(op: Operation, sender: chrome.runtime.MessageSender): boolean {
    return (
      sender.id === this.api.runtime.id &&
      sender.frameId === 0 &&
      sender.tab?.id === op.target.tabId &&
      sender.documentId === op.documentId &&
      this.content(sender)?.platform === op.target.platform
    );
  }
  private async current(expected: ExportTarget): Promise<boolean> {
    try {
      const tab = await this.api.tabs.get(expected.tabId);
      return tab.status !== 'loading' && target(tab)?.route === expected.route;
    } catch {
      return false;
    }
  }
  private async uiTarget(sender: chrome.runtime.MessageSender): Promise<ExportTarget | undefined> {
    const ui = this.surface(sender);
    if (ui) return (await this.current(ui.source)) ? ui.source : undefined;
    if (!this.isToolbar(sender)) return undefined;
    const [tab] = await this.api.tabs.query({ active: true, lastFocusedWindow: true });
    return tab ? target(tab) : undefined;
  }
  private async matchesSettings(op: Intent, settings: ExtensionSettings): Promise<boolean> {
    return (
      op.snapshot === serializeSyncSettingsSnapshot(settings) &&
      op.keyHash === (await keyHash(settings))
    );
  }
  private async matchingSettings(op: Intent): Promise<ExtensionSettings | undefined> {
    const revision = this.deps.revision?.();
    const settings = await this.deps.settings();
    return (await this.matchesSettings(op, settings)) && revision === this.deps.revision?.()
      ? settings
      : undefined;
  }
  private send(op: Operation, message: object): Promise<unknown> {
    return this.api.tabs.sendMessage(
      op.target.tabId,
      { ...message, exportOperationId: op.id },
      { documentId: op.documentId, frameId: 0 }
    );
  }
  private async compact(source: ExportTarget, operationId?: string): Promise<void> {
    const existing = this.state.surfaces.find(
      ui => ui.source.tabId === source.tabId && ui.source.route === source.route
    );
    if (existing) {
      try {
        await this.api.windows.update(existing.windowId, { focused: true });
        if (operationId) existing.operationId = operationId;
        existing.expires = this.now() + EXPORT_OPERATION_MS;
        await this.save();
        return;
      } catch {
        this.state.surfaces = this.state.surfaces.filter(ui => ui !== existing);
      }
    }
    if (this.state.surfaces.length >= 32) throw new Error('Too many export windows');
    const id = this.random();
    const window = await this.api.windows.create({
      url: this.api.runtime.getURL(`${EXPORT_POPUP_PATH}?surface=${id}`),
      type: 'popup',
      width: 440,
      height: 620,
    });
    const tabId = window.tabs?.[0]?.id;
    if (window.id === undefined || tabId === undefined)
      throw new Error('Export window unavailable');
    this.state.surfaces.push({
      id,
      tabId,
      windowId: window.id,
      source,
      expires: this.now() + EXPORT_OPERATION_MS,
      ...(operationId ? { operationId } : {}),
    });
    await this.save();
  }
  private async status(sender: chrome.runtime.MessageSender): Promise<ExportStatus> {
    if (!this.isToolbar(sender) && !this.surface(sender)) return denied();
    const source = await this.uiTarget(sender);
    if (!source) return { success: true, error: 'Open a supported conversation tab first.' };
    const settings = await this.deps.settings();
    const op = [...this.state.operations]
      .reverse()
      .find(item => item.target.tabId === source.tabId && item.target.route === source.route);
    return {
      success: true,
      target: source,
      outputs: outputs(settings),
      ...(op
        ? {
            operation: {
              id: op.id,
              phase: op.phase,
              mode: op.mode,
              ...(op.selectionId ? { selectionId: op.selectionId } : {}),
              ...(op.outcome ? { outcome: op.outcome } : {}),
            },
          }
        : {}),
    };
  }
  async handle(
    message: ExportControlMessage,
    sender: chrome.runtime.MessageSender
  ): Promise<unknown> {
    if (message.action === 'startExportOperation') return this.start(message, sender);
    return this.locked(async () => this.control(message, sender));
  }
  private async start(
    message: Extract<ExportControlMessage, { action: 'startExportOperation' }>,
    sender: chrome.runtime.MessageSender
  ): Promise<unknown> {
    const { mode } = message;
    const result = await this.locked(async () => {
      if (!['current', 'selected'].includes(mode)) return undefined;
      const source = await this.uiTarget(sender);
      if (
        !source ||
        message.expectedTarget?.tabId !== source.tabId ||
        message.expectedTarget.route !== source.route ||
        (mode === 'selected' && source.platform !== 'chatgpt')
      )
        return undefined;
      const existing = this.state.operations.find(
        op => op.target.tabId === source.tabId && live(op)
      );
      if (existing || this.state.intents.some(intent => intent.target.tabId === source.tabId))
        return { status: await this.status(sender) };
      if (this.state.intents.length >= 32) return undefined;
      // Creation order is retained across hydration. Empty terminal history is
      // replaceable; live generations and exact cleanup capabilities are not.
      const slotsNeeded = Math.max(
        0,
        this.state.operations.length + this.state.intents.length + 1 - 64
      );
      const reclaim = this.oldestReclaimableOperations(slotsNeeded);
      if (reclaim.length !== slotsNeeded) return undefined;
      const settings = await this.deps.settings();
      if (
        !Array.isArray(message.expectedOutputs) ||
        JSON.stringify(message.expectedOutputs) !== JSON.stringify(outputs(settings))
      )
        return undefined;
      const uiSessionId = this.surface(sender)?.id;
      const intent: Intent = {
        id: this.random(),
        target: source,
        mode,
        snapshot: serializeSyncSettingsSnapshot(settings),
        keyHash: await keyHash(settings),
        expires: this.now() + EXPORT_PENDING_MS,
        ...(uiSessionId ? { uiSessionId } : {}),
      };
      // Commit reclamation and the replacement intent together, only after all
      // admission checks succeeded; do not evict history for a rejected click.
      if (reclaim.length > 0)
        this.state.operations = this.state.operations.filter(op => !reclaim.includes(op));
      this.state.intents.push(intent);
      await this.save();
      return { intent };
    });
    if (!result) return denied();
    if ('status' in result) return result.status;
    // Do not hold the state lock: the exact document claims by a runtime round trip.
    try {
      const response = (await this.api.tabs.sendMessage(
        result.intent.target.tabId,
        {
          action: 'beginExportOperation',
          intentId: result.intent.id,
          route: result.intent.target.route,
        },
        { frameId: 0 }
      )) as { accepted?: boolean };
      if (response?.accepted !== true) throw new Error('Document did not claim export');
    } catch {
      await this.locked(async () => {
        this.state.intents = this.state.intents.filter(item => item.id !== result.intent.id);
        await this.save();
      });
      return denied();
    }
    return this.locked(() => this.status(sender));
  }
  private async control(
    message: ExportControlMessage,
    sender: chrome.runtime.MessageSender
  ): Promise<unknown> {
    if (message.action === 'getExportStatus') return this.status(sender);
    if (message.action === 'openExportSurface') {
      const source = this.content(sender);
      if (!source || !(await this.current(source))) return denied();
      try {
        if (typeof this.api.action?.openPopup !== 'function') throw new Error('Unavailable');
        await this.api.action.openPopup();
      } catch {
        await this.compact(source);
      }
      return { success: true };
    }
    if (message.action === 'claimExportOperation') return this.claim(message, sender);
    if (message.action === 'getExportBranchOptions') {
      const status = await this.status(sender);
      const op = this.state.operations.find(item => item.id === status.operation?.id);
      if (!op || op.phase !== 'awaiting-selection' || !(await this.current(op.target)))
        return denied();
      const result = (await this.send(op, {
        action: 'readExportBranchOptions',
        selectionId: op.selectionId,
      })) as { options?: unknown };
      const options = boundedBranchOptions(result?.options);
      return options ? { ...status, options } : denied();
    }
    const id = 'exportOperationId' in message ? message.exportOperationId : undefined;
    const op = this.state.operations.find(item => item.id === id);
    if (!op) return denied();
    if (
      message.action === 'completeExportOperation' &&
      this.owns(op, sender) &&
      isExportTerminalOutcome(message.outcome)
    ) {
      if (op.phase !== 'cancelled') {
        op.phase = 'completed';
        // The authorized choice, not a content-supplied success claim, establishes no-save.
        op.outcome =
          op.mode === 'selected' && op.choice === undefined ? 'branch-preparation-ended' : 'ended';
      }
      await this.save();
      return { success: true };
    }
    if (
      message.action === 'awaitExportSelection' &&
      this.owns(op, sender) &&
      op.mode === 'selected' &&
      op.phase === 'preparing' &&
      isExportToken(message.selectionId) &&
      (await this.current(op.target)) &&
      (await this.matchesSettings(op, await this.deps.settings()))
    ) {
      op.selectionId = message.selectionId;
      op.phase = 'awaiting-selection';
      await this.save();
      try {
        await this.compact(op.target, op.id);
      } catch {
        await this.cancel(op);
        return denied();
      }
      return { success: true };
    }
    const source = await this.uiTarget(sender);
    if (!source || source.tabId !== op.target.tabId || source.route !== op.target.route)
      return denied();
    if (message.action === 'cancelExportOperation') {
      await this.cancel(op);
      return { success: true };
    }
    if (message.action === 'chooseExportBranch') return this.choose(message, op);
    return denied();
  }
  private async claim(
    message: Extract<ExportControlMessage, { action: 'claimExportOperation' }>,
    sender: chrome.runtime.MessageSender
  ): Promise<unknown> {
    const intent = this.state.intents.find(item => item.id === message.intentId);
    const source = this.content(sender);
    if (
      !intent ||
      !source ||
      source.tabId !== intent.target.tabId ||
      source.route !== intent.target.route ||
      message.route !== source.route ||
      (intent.uiSessionId && !this.state.surfaces.some(ui => ui.id === intent.uiSessionId)) ||
      !(await this.current(source)) ||
      this.state.operations.some(op => op.target.tabId === source.tabId && live(op))
    )
      return denied();
    const settings = await this.matchingSettings(intent);
    if (!settings || this.state.operations.length >= 64) return denied();
    // One reserved intent is replaced by one operation in the same locked write.
    this.state.intents = this.state.intents.filter(item => item !== intent);
    const op: Operation = {
      ...intent,
      id: this.random(),
      documentId: sender.documentId!,
      phase: intent.mode === 'current' ? 'exporting' : 'preparing',
      expires: this.now() + EXPORT_OPERATION_MS,
      stages: [],
    };
    this.state.operations.push(op);
    const surface = this.state.surfaces.find(ui => ui.id === intent.uiSessionId);
    if (surface) {
      surface.operationId = op.id;
      surface.expires = op.expires;
    }
    await this.save();
    const { obsidianApiKey, ...safe } = settings;
    return {
      success: true,
      exportOperationId: op.id,
      mode: op.mode,
      expiresAt: op.expires,
      settings: { ...safe, isApiKeyConfigured: !!obsidianApiKey },
    };
  }
  private async choose(
    message: Extract<ExportControlMessage, { action: 'chooseExportBranch' }>,
    op: Operation
  ): Promise<unknown> {
    if (
      op.phase !== 'awaiting-selection' ||
      op.selectionId !== message.selectionId ||
      !(message.choice === 'all' || (Number.isSafeInteger(message.choice) && message.choice > 0)) ||
      !(await this.matchesSettings(op, await this.deps.settings()))
    )
      return denied();
    const valid = (await this.send(op, {
      action: 'validateExportChoice',
      selectionId: op.selectionId,
      choice: message.choice,
    })) as { accepted?: boolean };
    if (valid?.accepted !== true || !(await this.current(op.target))) return denied();
    op.choice = message.choice;
    op.phase = 'exporting';
    await this.save();
    try {
      const applied = (await this.send(op, {
        action: 'applyExportChoice',
        selectionId: op.selectionId,
        choice: op.choice,
      })) as { accepted?: boolean };
      if (applied?.accepted !== true) throw new Error('Choice not applied');
    } catch {
      await this.cancel(op);
      return denied();
    }
    return { success: true };
  }
  private async cancel(op: Operation): Promise<void> {
    if (!live(op)) return;
    op.phase = 'cancelled';
    void this.send(op, { action: 'cancelExportOperation' }).catch(() => undefined);
    await this.save();
  }
  private tabEpoch(tabId: number | undefined): number {
    return tabId === undefined ? -1 : (this.tabRevocations.get(tabId) ?? 0);
  }
  private async admissionStillCurrent(
    op: Operation,
    sender: chrome.runtime.MessageSender,
    action: string,
    epoch: number,
    revision: number | undefined
  ): Promise<boolean> {
    const routeCurrent = await this.current(op.target);
    return (
      routeCurrent &&
      this.tabEpoch(op.target.tabId) === epoch &&
      revision === this.deps.revision?.() &&
      this.state.operations.includes(op) &&
      live(op) &&
      op.expires > this.now() &&
      this.owns(op, sender) &&
      this.content(sender)?.route === op.target.route &&
      (!EXPORT_DURABLE_ACTIONS.has(action) || op.phase === 'exporting')
    );
  }
  private ownedStage(
    message: {
      exportOperationId?: string;
      source?: unknown;
      stageId?: unknown;
      artifact?: unknown;
    },
    sender: chrome.runtime.MessageSender
  ): { op: Operation; stageId: string } | undefined {
    const op = this.state.operations.find(item => item.id === message.exportOperationId);
    const stageId =
      typeof message.stageId === 'string'
        ? message.stageId
        : (message.artifact as { stageId?: unknown } | undefined)?.stageId;
    return op &&
      this.owns(op, sender) &&
      message.source === op.target.platform &&
      typeof stageId === 'string' &&
      op.stages.includes(stageId)
      ? { op, stageId }
      : undefined;
  }
  /** Atomically relinquish only an uncommitted, generation-owned stage to cleanup. */
  async takeStageForCleanup(
    message: {
      exportOperationId?: string;
      source?: unknown;
      stageId?: unknown;
      artifact?: unknown;
    },
    sender: chrome.runtime.MessageSender
  ): Promise<boolean> {
    return this.locked(async () => {
      const owned = this.ownedStage(message, sender);
      if (!owned) return false;
      owned.op.stages = owned.op.stages.filter(id => id !== owned.stageId);
      // Even a failed metadata write cannot undo the local proof that no commit
      // owns this stage; save() clears grants and removes its exact session key.
      await this.save().catch(() => undefined);
      return true;
    });
  }
  /** Durable handoff precedes the actual call; never hold the lock for its result. */
  async dispatchStageCommit<T>(
    message: {
      action: string;
      exportOperationId?: string;
      source?: unknown;
      stageId?: unknown;
      artifact?: unknown;
    },
    sender: chrome.runtime.MessageSender,
    dispatch: () => Promise<T>
  ): Promise<
    { dispatched: true; result: Promise<T> } | { dispatched: false; cleanupOwned: boolean }
  > {
    const epoch = this.tabEpoch(sender.tab?.id);
    const revision = this.deps.revision?.();
    return this.locked(async () => {
      const owned = this.ownedStage(message, sender);
      if (!owned) return { dispatched: false, cleanupOwned: false };
      const { op, stageId } = owned;
      const permitted =
        !!(await this.matchingSettings(op)) &&
        (await this.admissionStillCurrent(op, sender, message.action, epoch, revision));
      // Removing this capability persists the ambiguous/in-flight distinction:
      // a later denied/replayed commit cannot abort a stage already handed off.
      op.stages = op.stages.filter(id => id !== stageId);
      try {
        await this.save();
      } catch {
        return { dispatched: false, cleanupOwned: true };
      }
      if (
        !permitted ||
        !(await this.admissionStillCurrent(op, sender, message.action, epoch, revision))
      )
        return { dispatched: false, cleanupOwned: true };
      return { dispatched: true, result: dispatch() };
    });
  }
  /** Revalidated immediately before each privileged dispatch; sender alone is never authority. */
  async authorize(
    message: { action: string; exportOperationId?: string; [key: string]: unknown },
    sender: chrome.runtime.MessageSender
  ): Promise<boolean> {
    // Capture before the lock/initial hydration can yield. Browser event handlers
    // bump their epoch synchronously, even while durable cancellation is queued.
    const epoch = this.tabEpoch(sender.tab?.id);
    const revision = this.deps.revision?.();
    return this.locked(async () => {
      const op = this.state.operations.find(item => item.id === message.exportOperationId);
      if (!op || !this.owns(op, sender)) return false;
      const cleanup = EXPORT_CLEANUP_ACTIONS.has(message.action);
      const stageId =
        typeof message.stageId === 'string'
          ? message.stageId
          : (message.artifact as { stageId?: string } | undefined)?.stageId;
      if (stageId && message.action !== 'beginStagedBinaryAsset' && !op.stages.includes(stageId))
        return false;
      if (cleanup) return typeof stageId === 'string' && op.stages.includes(stageId);
      if (
        !live(op) ||
        this.content(sender)?.route !== op.target.route ||
        !(await this.current(op.target)) ||
        !(await this.matchingSettings(op))
      ) {
        await this.cancel(op);
        return false;
      }
      if (EXPORT_DURABLE_ACTIONS.has(message.action) && op.phase !== 'exporting') return false;
      if ('source' in message && message.source !== op.target.platform) return false;
      if (
        message.action === 'saveToOutputs' &&
        (message.data as { frontmatter?: { source?: unknown } } | undefined)?.frontmatter
          ?.source !== op.target.platform
      )
        return false;
      const allowed = outputs(JSON.parse(op.snapshot) as ExtensionSettings);
      if (
        'outputs' in message &&
        (!Array.isArray(message.outputs) ||
          message.outputs.some(output => !allowed.includes(output)))
      )
        return false;
      if (message.action === 'beginStagedBinaryAsset' && stageId) {
        if (this.state.operations.some(other => other.stages.includes(stageId))) return false;
        if (op.stages.length >= 4096) return false;
        op.stages.push(stageId);
        await this.save();
      }
      if (!(await this.admissionStillCurrent(op, sender, message.action, epoch, revision))) {
        await this.cancel(op);
        return false;
      }
      return true;
    });
  }
  async recordResult(id: string | undefined, response: unknown): Promise<void> {
    await this.locked(async () => {
      const op = this.state.operations.find(item => item.id === id);
      const result = response as {
        success?: boolean;
        stageId?: string;
        data?: { stageId?: string };
      };
      const stageId =
        result?.success === true ? (result.stageId ?? result.data?.stageId) : undefined;
      if (!op || typeof stageId !== 'string' || stageId.length > 256 || op.stages.includes(stageId))
        return;
      if (
        op.stages.length >= 4096 ||
        this.state.operations.some(other => other.stages.includes(stageId))
      ) {
        await this.cancel(op);
        return;
      }
      op.stages.push(stageId);
      await this.save();
    });
  }
  async tabRemoved(tabId: number): Promise<void> {
    this.tabRevocations.set(tabId, ++this.revocationSequence);
    await this.locked(async () => {
      for (const op of this.state.operations)
        if (
          op.target.tabId === tabId ||
          this.state.surfaces.some(
            ui =>
              ui.tabId === tabId &&
              ui.operationId === op.id &&
              (op.phase === 'preparing' || op.phase === 'awaiting-selection')
          )
        )
          await this.cancel(op);
      const closed = this.state.surfaces.filter(ui => ui.tabId === tabId).map(ui => ui.id);
      this.state.surfaces = this.state.surfaces.filter(ui => ui.tabId !== tabId);
      this.state.intents = this.state.intents.filter(
        intent => intent.target.tabId !== tabId && !closed.includes(intent.uiSessionId ?? '')
      );
      await this.save();
    });
  }
  async tabChanged(tabId: number, change: chrome.tabs.TabChangeInfo): Promise<void> {
    if (!change.url && change.status !== 'loading') return;
    this.tabRevocations.set(tabId, ++this.revocationSequence);
    await this.locked(async () => {
      for (const op of this.state.operations)
        if (
          op.target.tabId === tabId &&
          (change.status === 'loading' || exportRoute(change.url)?.route !== op.target.route)
        )
          await this.cancel(op);
      this.state.intents = this.state.intents.filter(intent => intent.target.tabId !== tabId);
      await this.save();
    });
  }
  async settingsChanged(): Promise<void> {
    await this.locked(async () => {
      this.state.intents = [];
      for (const op of this.state.operations) await this.cancel(op);
      await this.save();
    });
  }
}
