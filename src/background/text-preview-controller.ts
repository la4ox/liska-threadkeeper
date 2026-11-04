/* eslint-disable complexity, max-lines, max-lines-per-function -- Keep each lease transition, cleanup receipt, and recheck in one auditable state-machine surface. */
/* In-memory capture and one-shot delivery authority for the detached text preview page. */
import {
  adoptArchivePresentationPreview,
  type ArchivePresentationPreview,
} from '../archive/presentation';
import { isSafeArchiveStageId } from '../lib/archive-stage-contract';
import {
  exportRoute,
  type ExportBranchOption,
  type ExportTarget,
} from '../lib/export-operation-contract';
import {
  TEXT_PREVIEW_CAPTURE_ACTIONS,
  TEXT_PREVIEW_CAPTURE_MS,
  TEXT_PREVIEW_DELIVERY_MS,
  TEXT_PREVIEW_MAX_ENVELOPE_BYTES,
  TEXT_PREVIEW_MAX_LEASES,
  TEXT_PREVIEW_PAGE_LEASE_MS,
  TEXT_PREVIEW_PENDING_MS,
  type TextPreviewStartFailureStep,
  isTextPreviewToken,
  sameTextPreviewPageUrl,
  snapshotTextPreviewControlMessage,
  textPreviewPageUrl,
  type TextPreviewBranchMode,
  type TextPreviewCaptureSettings,
  type TextPreviewControlMessage,
  type TextPreviewMetadataStatus,
  type TextPreviewPhase,
} from '../lib/text-preview-contract';
import type { ExtensionSettings } from '../lib/types';

interface SourceDocument {
  readonly documentId: string;
  readonly generation: number;
}

type PreviewSource = 'chatgpt' | 'deepseek';
type PreviewTarget = Pick<ExportTarget, 'tabId' | 'route'> & { readonly platform: PreviewSource };

interface PreviewPage {
  readonly tabId: number;
  readonly windowId: number;
  documentId?: string;
}

interface UiBinding {
  readonly url?: string;
  readonly tabId?: number;
  readonly windowId?: number;
  readonly documentId?: string;
}

interface PreviewSession {
  readonly id: string;
  readonly target: PreviewTarget;
  readonly mode: TextPreviewBranchMode;
  readonly ui: UiBinding;
  readonly pageLeaseExpiresAt: number;
  phase: TextPreviewPhase;
  phaseExpiresAt: number;
  source?: SourceDocument;
  page?: PreviewPage;
  selectionId?: string;
  options?: readonly ExportBranchOption[];
  payload?: ArchivePresentationPreview;
  deliveryId?: string;
  ackedDocumentId?: string;
  stages: string[];
  sourceReserved: boolean;
  pageClosed: boolean;
}

interface CleanupTombstone {
  readonly id: string;
  readonly source: PreviewSource;
  readonly expiresAt: number;
  stages: string[];
}

export interface TextPreviewControllerDependencies {
  readonly chrome: typeof chrome;
  readonly settings: () => Promise<ExtensionSettings>;
  readonly isUi: (sender: chrome.runtime.MessageSender) => Promise<boolean>;
  readonly uiSource: (sender: chrome.runtime.MessageSender) => Promise<ExportTarget | undefined>;
  readonly reserveSource: (tabId: number) => Promise<boolean>;
  readonly releaseSource: (tabId: number) => Promise<void>;
  /** Background-owned exact abort; it grants no content capture or sink authority. */
  readonly abortStage: (source: PreviewSource, stageId: string) => Promise<boolean>;
  readonly now?: () => number;
  readonly random?: () => string;
  readonly revision?: () => number;
  readonly delay?: (milliseconds: number) => Promise<void>;
}

const unavailable = () => ({ success: false, error: 'text-preview-unavailable' });
const notReady = () => ({ success: false, error: 'text-preview-not-ready' });
const invalidMessage = () => ({ success: false, error: 'text-preview-invalid-message' });
const NAVIGATION_CONFIRM_ATTEMPTS = 51;
const NAVIGATION_CONFIRM_INTERVAL_MS = 100;

function validDocumentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,256}$/.test(value);
}

function uiBinding(sender: chrome.runtime.MessageSender): UiBinding {
  return {
    ...(typeof sender.url === 'string' ? { url: sender.url } : {}),
    ...(Number.isSafeInteger(sender.tab?.id) ? { tabId: sender.tab!.id } : {}),
    ...(Number.isSafeInteger(sender.tab?.windowId) ? { windowId: sender.tab!.windowId } : {}),
    ...(validDocumentId(sender.documentId) ? { documentId: sender.documentId } : {}),
  };
}

function sameUi(binding: UiBinding, sender: chrome.runtime.MessageSender): boolean {
  return (
    binding.url === sender.url &&
    binding.tabId === sender.tab?.id &&
    binding.windowId === sender.tab?.windowId &&
    binding.documentId === (validDocumentId(sender.documentId) ? sender.documentId : undefined)
  );
}

function isLiveCapture(session: PreviewSession): boolean {
  return session.phase === 'capturing' || session.phase === 'awaiting-selection';
}

function isExactPreviewTab(
  tab: chrome.tabs.Tab | undefined,
  tabId: number,
  windowId: number,
  expectedUrl: string
): boolean {
  return (
    tab?.id === tabId && tab.windowId === windowId && sameTextPreviewPageUrl(tab.url, expectedUrl)
  );
}

export class TextPreviewController {
  private readonly api: typeof chrome;
  private readonly now: () => number;
  private readonly random: () => string;
  private readonly delay: (milliseconds: number) => Promise<void>;
  private readonly sessions: PreviewSession[] = [];
  private readonly cleanupTombstones: CleanupTombstone[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private revocationSequence = 0;
  private readonly tabRevocations = new Map<number, number>();

  constructor(private readonly deps: TextPreviewControllerDependencies) {
    this.api = deps.chrome;
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? (() => crypto.randomUUID());
    this.delay =
      deps.delay ??
      (milliseconds => new Promise(resolve => globalThis.setTimeout(resolve, milliseconds)));
  }

  private async confirmPreviewNavigation(
    tabId: number,
    windowId: number,
    expectedUrl: string
  ): Promise<boolean> {
    for (let attempt = 0; attempt < NAVIGATION_CONFIRM_ATTEMPTS; attempt += 1) {
      const tab = await this.api.tabs.get(tabId);
      if (isExactPreviewTab(tab, tabId, windowId, expectedUrl) && tab.status !== 'loading')
        return true;
      if (tab.id !== tabId || tab.windowId !== windowId) return false;
      if (attempt + 1 < NAVIGATION_CONFIRM_ATTEMPTS)
        await this.delay(NAVIGATION_CONFIRM_INTERVAL_MS);
    }
    return false;
  }

  private locked<T>(work: () => Promise<T> | T): Promise<T> {
    const result = this.queue.then(async () => {
      await this.prune();
      return work();
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async prune(): Promise<void> {
    const now = this.now();
    for (const tombstone of [...this.cleanupTombstones]) {
      await this.cleanupTombstone(tombstone);
      if (tombstone.expiresAt <= now) {
        const index = this.cleanupTombstones.indexOf(tombstone);
        if (index >= 0) this.cleanupTombstones.splice(index, 1);
      }
    }
    for (const session of [...this.sessions]) {
      if (
        session.pageLeaseExpiresAt <= now ||
        (session.pageClosed && session.phaseExpiresAt <= now)
      ) {
        await this.removeSession(session);
        continue;
      }
      if (
        session.phase !== 'delivered' &&
        session.phase !== 'invalidated' &&
        session.phaseExpiresAt <= now
      )
        await this.invalidateSession(session, true);
    }
  }

  private async abortStage(source: PreviewSource, stageId: string): Promise<boolean> {
    if (!isSafeArchiveStageId(stageId)) return false;
    try {
      return (await this.deps.abortStage(source, stageId)) === true;
    } catch {
      return false;
    }
  }

  private async cleanupOwnedStages(session: PreviewSession): Promise<void> {
    const stages = [...new Set(session.stages)].filter(isSafeArchiveStageId);
    const outcomes = await Promise.all(
      stages.map(async stageId => ({
        stageId,
        cleaned: await this.abortStage(session.target.platform, stageId),
      }))
    );
    const cleaned = new Set(
      outcomes.filter(outcome => outcome.cleaned).map(outcome => outcome.stageId)
    );
    session.stages = session.stages.filter(stageId => !cleaned.has(stageId));
  }

  private async cleanupTombstone(tombstone: CleanupTombstone): Promise<void> {
    const outcomes = await Promise.all(
      tombstone.stages.map(async stageId => ({
        stageId,
        cleaned: await this.abortStage(tombstone.source, stageId),
      }))
    );
    const cleaned = new Set(
      outcomes.filter(outcome => outcome.cleaned).map(outcome => outcome.stageId)
    );
    tombstone.stages = tombstone.stages.filter(stageId => !cleaned.has(stageId));
  }

  private retainCleanupTombstone(session: PreviewSession): void {
    if (!session.source) return;
    const existing = this.cleanupTombstones.find(item => item.id === session.id);
    if (existing) {
      existing.stages = [...new Set([...existing.stages, ...session.stages])];
      return;
    }
    this.cleanupTombstones.push({
      id: session.id,
      source: session.target.platform,
      expiresAt: this.now() + TEXT_PREVIEW_CAPTURE_MS,
      stages: [...new Set(session.stages)],
    });
  }

  private async releaseSource(session: PreviewSession): Promise<void> {
    if (!session.sourceReserved) return;
    session.sourceReserved = false;
    await this.deps.releaseSource(session.target.tabId);
  }

  private async invalidateSession(session: PreviewSession, notify: boolean): Promise<void> {
    if (session.phase !== 'invalidated') {
      session.phase = 'invalidated';
      session.phaseExpiresAt = session.pageClosed
        ? Math.min(session.pageLeaseExpiresAt, this.now() + TEXT_PREVIEW_DELIVERY_MS)
        : session.pageLeaseExpiresAt;
      session.payload = undefined;
      session.options = undefined;
      session.selectionId = undefined;
      session.deliveryId = undefined;
      session.ackedDocumentId = undefined;
    }
    if (session.pageClosed)
      session.phaseExpiresAt = Math.min(
        session.phaseExpiresAt,
        this.now() + TEXT_PREVIEW_DELIVERY_MS
      );
    await this.releaseSource(session);
    if (notify && session.source) {
      void this.api.tabs
        .sendMessage(
          session.target.tabId,
          { action: 'cancelTextPreviewCapture', sessionId: session.id },
          { documentId: session.source.documentId, frameId: 0 }
        )
        .catch(() => undefined);
    }
    await this.cleanupOwnedStages(session);
  }

  private async removeSession(session: PreviewSession): Promise<void> {
    await this.releaseSource(session);
    await this.cleanupOwnedStages(session);
    this.retainCleanupTombstone(session);
    const index = this.sessions.indexOf(session);
    if (index >= 0) this.sessions.splice(index, 1);
    session.payload = undefined;
    session.options = undefined;
    session.stages = [];
  }

  private metadata(session: PreviewSession): TextPreviewMetadataStatus {
    return {
      success: true,
      state: session.phase,
      expiresAt: session.pageLeaseExpiresAt,
    };
  }

  private sourceFromSender(sender: chrome.runtime.MessageSender): PreviewTarget | undefined {
    if (
      sender.id !== this.api.runtime.id ||
      sender.frameId !== 0 ||
      !validDocumentId(sender.documentId) ||
      !sender.tab
    )
      return undefined;
    const current = exportRoute(sender.tab.url);
    const document = exportRoute(sender.url);
    if (
      !current ||
      !document ||
      current.platform !== document.platform ||
      (current.platform !== 'chatgpt' && current.platform !== 'deepseek') ||
      new URL(current.route).origin !== new URL(document.route).origin ||
      !Number.isSafeInteger(sender.tab.id)
    )
      return undefined;
    return {
      route: current.route,
      platform: current.platform,
      tabId: sender.tab.id!,
    };
  }

  private ownsSource(session: PreviewSession, sender: chrome.runtime.MessageSender): boolean {
    const source = this.sourceFromSender(sender);
    return (
      !!session.source &&
      !!source &&
      source.tabId === session.target.tabId &&
      source.platform === session.target.platform &&
      sender.documentId === session.source.documentId
    );
  }

  private sourceGenerationCurrent(session: PreviewSession): boolean {
    return (
      !!session.source &&
      session.source.generation === (this.tabRevocations.get(session.target.tabId) ?? 0)
    );
  }

  private async current(session: PreviewSession): Promise<boolean> {
    try {
      const tab = await this.api.tabs.get(session.target.tabId);
      return tab.status !== 'loading' && exportRoute(tab.url)?.route === session.target.route;
    } catch {
      return false;
    }
  }

  private page(
    session: PreviewSession,
    sender: chrome.runtime.MessageSender
  ): PreviewPage | undefined {
    const page = session.page;
    const expectedUrl = textPreviewPageUrl(this.api.runtime, session.id);
    if (
      !page ||
      sender.id !== this.api.runtime.id ||
      sender.frameId !== 0 ||
      sender.tab?.id !== page.tabId ||
      sender.tab.windowId !== page.windowId ||
      !sameTextPreviewPageUrl(sender.url, expectedUrl) ||
      !sameTextPreviewPageUrl(sender.tab.url, expectedUrl) ||
      !validDocumentId(sender.documentId)
    )
      return undefined;
    if (page.documentId === undefined) page.documentId = sender.documentId;
    return page.documentId === sender.documentId ? page : undefined;
  }

  private session(id: string): PreviewSession | undefined {
    return this.sessions.find(candidate => candidate.id === id);
  }

  private phaseCurrent(
    session: PreviewSession,
    expected: TextPreviewPhase | readonly TextPreviewPhase[]
  ): boolean {
    const phases = Array.isArray(expected) ? expected : [expected];
    return (
      this.sessions.includes(session) &&
      phases.includes(session.phase) &&
      session.phaseExpiresAt > this.now()
    );
  }

  async handle(message: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
    const command = snapshotTextPreviewControlMessage(message);
    if (!command) return invalidMessage();
    if (command.action === 'startTextPreview') return this.start(command, sender);
    return this.locked(() => this.control(command, sender));
  }

  private async start(
    command: Extract<TextPreviewControlMessage, { action: 'startTextPreview' }>,
    sender: chrome.runtime.MessageSender
  ): Promise<unknown> {
    if (!(await this.deps.isUi(sender))) return unavailable();
    const uiTarget = await this.deps.uiSource(sender);
    if (
      !uiTarget ||
      uiTarget.tabId !== command.expectedTarget.tabId ||
      uiTarget.route !== command.expectedTarget.route ||
      (uiTarget.platform !== 'chatgpt' && uiTarget.platform !== 'deepseek') ||
      (command.branchMode === 'selected' && uiTarget.platform !== 'chatgpt') ||
      !(await this.deps.reserveSource(uiTarget.tabId))
    )
      return unavailable();
    const target: PreviewTarget = {
      tabId: uiTarget.tabId,
      route: uiTarget.route,
      platform: uiTarget.platform,
    };

    const session = await this.locked(async () => {
      if (this.sessions.length >= TEXT_PREVIEW_MAX_LEASES) return undefined;
      const now = this.now();
      const created: PreviewSession = {
        id: this.random(),
        target,
        mode: command.branchMode,
        ui: uiBinding(sender),
        pageLeaseExpiresAt: now + TEXT_PREVIEW_PAGE_LEASE_MS,
        phase: 'pending',
        phaseExpiresAt: now + TEXT_PREVIEW_PENDING_MS,
        stages: [],
        sourceReserved: true,
        pageClosed: false,
      };
      if (!isTextPreviewToken(created.id)) return undefined;
      this.sessions.push(created);
      return created;
    });
    if (!session) {
      await this.deps.releaseSource(target.tabId);
      return unavailable();
    }

    let windowId: number | undefined;
    let failureStep: TextPreviewStartFailureStep = 'window-create';
    try {
      const expectedPreviewUrl = textPreviewPageUrl(this.api.runtime, session.id);
      const opened = await this.api.windows.create({
        url: expectedPreviewUrl,
        type: 'popup',
        focused: false,
        width: 980,
        height: 760,
      });
      failureStep = 'window-shape';
      windowId = opened.id;
      const tabId = opened.tabs?.[0]?.id;
      if (!Number.isSafeInteger(windowId) || !Number.isSafeInteger(tabId))
        throw new Error('preview-page-unavailable');
      failureStep = 'navigation-api';
      if (typeof this.api.tabs.update !== 'function')
        throw new Error('preview-page-navigation-unavailable');
      failureStep = 'navigation-request';
      const navigated = await this.api.tabs.update(tabId!, {
        url: expectedPreviewUrl,
        active: true,
      });
      failureStep = 'navigation-result';
      if (navigated?.id !== tabId || navigated.windowId !== windowId)
        throw new Error('preview-page-navigation-mismatch');
      failureStep = 'navigation-readback';
      const navigationConfirmed = await this.confirmPreviewNavigation(
        tabId!,
        windowId!,
        expectedPreviewUrl
      );
      failureStep = 'navigation-current';
      if (!navigationConfirmed) throw new Error('preview-page-navigation-raced');
      const pageEpoch = this.tabEpoch(tabId);
      failureStep = 'page-registration';
      const registered = await this.locked(async () => {
        if (!this.phaseCurrent(session, 'pending') || pageEpoch !== this.tabEpoch(tabId))
          return false;
        session.page = { tabId: tabId!, windowId: windowId! };
        return true;
      });
      if (!registered) throw new Error('preview-page-expired');
      failureStep = 'source-accept';
      const response = (await this.api.tabs.sendMessage(
        target.tabId,
        {
          action: 'beginTextPreviewCapture',
          sessionId: session.id,
          route: target.route,
          branchMode: session.mode,
        },
        { frameId: 0 }
      )) as { accepted?: boolean };
      if (response?.accepted !== true) throw new Error('preview-source-unavailable');
      failureStep = 'start-confirmation';
      return this.locked(async () => {
        if (!this.phaseCurrent(session, ['pending', 'capturing', 'awaiting-selection']))
          return unavailable();
        return {
          ...this.metadata(session),
          sessionId: session.id,
          captureExpiresAt: session.phaseExpiresAt,
        };
      });
    } catch {
      await this.locked(() => this.removeSession(session));
      if (windowId !== undefined && typeof this.api.windows.remove === 'function')
        void this.api.windows.remove(windowId).catch(() => undefined);
      return { ...unavailable(), failureStep };
    }
  }

  private async control(
    command: Exclude<TextPreviewControlMessage, { action: 'startTextPreview' }>,
    sender: chrome.runtime.MessageSender
  ): Promise<unknown> {
    const session = this.session(command.sessionId);
    if (command.action === 'getTextPreviewStatus') {
      if (!session?.page) return notReady();
      return this.page(session, sender) ? this.metadata(session) : notReady();
    }
    if (!session) return unavailable();
    if (command.action === 'claimTextPreviewCapture') return this.claim(session, command, sender);
    if (command.action === 'awaitTextPreviewSelection')
      return this.awaitSelection(session, command, sender);
    if (command.action === 'getTextPreviewBranchOptions')
      return this.branchOptions(session, sender);
    if (command.action === 'chooseTextPreviewBranch') return this.choose(session, command, sender);
    if (command.action === 'checkTextPreviewCaptureLease')
      return this.captureLease(session, sender);
    if (command.action === 'publishTextPreview') return this.publish(session, command, sender);
    if (command.action === 'takeTextPreviewPayload') return this.take(session, sender);
    if (command.action === 'ackTextPreviewPayload') return this.ack(session, command, sender);
    return this.invalidate(session, command, sender);
  }

  private async claim(
    session: PreviewSession,
    command: Extract<TextPreviewControlMessage, { action: 'claimTextPreviewCapture' }>,
    sender: chrome.runtime.MessageSender
  ): Promise<unknown> {
    const source = this.sourceFromSender(sender);
    const revision = this.deps.revision?.();
    const generation = this.tabEpoch(session.target.tabId);
    if (
      !this.phaseCurrent(session, 'pending') ||
      !source ||
      source.tabId !== session.target.tabId ||
      source.route !== session.target.route ||
      command.route !== session.target.route ||
      !validDocumentId(sender.documentId)
    )
      return unavailable();
    if (
      !(await this.current(session)) ||
      !this.phaseCurrent(session, 'pending') ||
      generation !== this.tabEpoch(session.target.tabId)
    )
      return unavailable();
    const settings = await this.deps.settings();
    if (
      revision !== this.deps.revision?.() ||
      generation !== this.tabEpoch(session.target.tabId) ||
      !this.phaseCurrent(session, 'pending')
    )
      return unavailable();
    if (
      !(await this.current(session)) ||
      !this.phaseCurrent(session, 'pending') ||
      generation !== this.tabEpoch(session.target.tabId)
    )
      return unavailable();
    const captureSettings: TextPreviewCaptureSettings = Object.freeze({
      enableAutoScroll: settings.enableAutoScroll === true,
      enableToolContent: settings.enableToolContent === true,
      enableInertCodeBlocks: settings.enableInertCodeBlocks === true,
      enableChatGptOpaqueReplay: settings.enableChatGptOpaqueReplay === true,
    });
    session.source = {
      documentId: sender.documentId,
      generation,
    };
    session.phase = 'capturing';
    session.phaseExpiresAt = Math.min(
      session.pageLeaseExpiresAt,
      this.now() + TEXT_PREVIEW_CAPTURE_MS
    );
    return {
      success: true,
      sessionId: session.id,
      branchMode: session.mode,
      expiresAt: session.phaseExpiresAt,
      settings: captureSettings,
    };
  }

  private async awaitSelection(
    session: PreviewSession,
    command: Extract<TextPreviewControlMessage, { action: 'awaitTextPreviewSelection' }>,
    sender: chrome.runtime.MessageSender
  ): Promise<unknown> {
    const generation = this.tabEpoch(session.target.tabId);
    if (
      session.mode !== 'selected' ||
      session.target.platform !== 'chatgpt' ||
      !this.phaseCurrent(session, 'capturing') ||
      !this.ownsSource(session, sender) ||
      !this.sourceGenerationCurrent(session)
    )
      return unavailable();
    if (
      !(await this.current(session)) ||
      !this.phaseCurrent(session, 'capturing') ||
      generation !== this.tabEpoch(session.target.tabId)
    )
      return unavailable();
    session.phase = 'awaiting-selection';
    session.selectionId = command.selectionId;
    session.options = Object.freeze(command.options.map(option => Object.freeze({ ...option })));
    return { success: true };
  }

  private branchOptions(session: PreviewSession, sender: chrome.runtime.MessageSender): unknown {
    return sameUi(session.ui, sender) &&
      this.phaseCurrent(session, 'awaiting-selection') &&
      session.selectionId &&
      session.options
      ? {
          success: true,
          state: session.phase,
          selectionId: session.selectionId,
          options: session.options,
        }
      : unavailable();
  }

  private async choose(
    session: PreviewSession,
    command: Extract<TextPreviewControlMessage, { action: 'chooseTextPreviewBranch' }>,
    sender: chrome.runtime.MessageSender
  ): Promise<unknown> {
    const generation = this.tabEpoch(session.target.tabId);
    if (
      !sameUi(session.ui, sender) ||
      !this.phaseCurrent(session, 'awaiting-selection') ||
      command.selectionId !== session.selectionId ||
      !session.options?.some(option => option.ordinal === command.choice) ||
      !session.source ||
      !this.sourceGenerationCurrent(session)
    )
      return unavailable();
    if (
      !(await this.current(session)) ||
      !this.phaseCurrent(session, 'awaiting-selection') ||
      generation !== this.tabEpoch(session.target.tabId)
    )
      return unavailable();
    const base = {
      sessionId: session.id,
      selectionId: session.selectionId,
      choice: command.choice,
    };
    const validated = (await this.api.tabs.sendMessage(
      session.target.tabId,
      { action: 'validateTextPreviewChoice', ...base },
      { documentId: session.source.documentId, frameId: 0 }
    )) as { accepted?: boolean };
    if (
      validated?.accepted !== true ||
      !this.phaseCurrent(session, 'awaiting-selection') ||
      generation !== this.tabEpoch(session.target.tabId)
    )
      return unavailable();
    if (
      !(await this.current(session)) ||
      !this.phaseCurrent(session, 'awaiting-selection') ||
      generation !== this.tabEpoch(session.target.tabId)
    )
      return unavailable();
    session.phase = 'capturing';
    session.options = undefined;
    const applied = (await this.api.tabs
      .sendMessage(
        session.target.tabId,
        { action: 'applyTextPreviewChoice', ...base },
        { documentId: session.source.documentId, frameId: 0 }
      )
      .catch(() => undefined)) as { accepted?: boolean } | undefined;
    if (
      applied?.accepted !== true ||
      !this.phaseCurrent(session, 'capturing') ||
      generation !== this.tabEpoch(session.target.tabId)
    ) {
      await this.invalidateSession(session, true);
      return unavailable();
    }
    if (
      !(await this.current(session)) ||
      !this.phaseCurrent(session, 'capturing') ||
      generation !== this.tabEpoch(session.target.tabId) ||
      !this.sourceGenerationCurrent(session)
    ) {
      await this.invalidateSession(session, true);
      return unavailable();
    }
    session.selectionId = undefined;
    return { success: true };
  }

  private async captureLease(
    session: PreviewSession,
    sender: chrome.runtime.MessageSender
  ): Promise<unknown> {
    const generation = this.tabEpoch(session.target.tabId);
    const expectedPhase = session.phase;
    if (
      !isLiveCapture(session) ||
      !this.phaseCurrent(session, expectedPhase) ||
      !this.ownsSource(session, sender) ||
      !this.sourceGenerationCurrent(session)
    )
      return { success: false, live: false, error: 'text-preview-capture-expired' };
    const live = await this.current(session);
    const current =
      live &&
      this.phaseCurrent(session, expectedPhase) &&
      generation === this.tabEpoch(session.target.tabId) &&
      this.sourceGenerationCurrent(session);
    return current
      ? { success: true, live: true, expiresAt: session.phaseExpiresAt }
      : { success: false, live: false, error: 'text-preview-capture-expired' };
  }

  private async publish(
    session: PreviewSession,
    command: Extract<TextPreviewControlMessage, { action: 'publishTextPreview' }>,
    sender: chrome.runtime.MessageSender
  ): Promise<unknown> {
    const generation = this.tabEpoch(session.target.tabId);
    if (
      !this.phaseCurrent(session, 'capturing') ||
      !this.ownsSource(session, sender) ||
      !this.sourceGenerationCurrent(session)
    )
      return unavailable();
    if (
      !(await this.current(session)) ||
      !this.phaseCurrent(session, 'capturing') ||
      generation !== this.tabEpoch(session.target.tabId)
    )
      return unavailable();
    let payload: ArchivePresentationPreview;
    try {
      payload = adoptArchivePresentationPreview(command.payload);
      const envelope = JSON.stringify({
        action: 'publishTextPreview',
        sessionId: session.id,
        payload,
      });
      if (
        typeof envelope !== 'string' ||
        new TextEncoder().encode(envelope).byteLength > TEXT_PREVIEW_MAX_ENVELOPE_BYTES
      )
        return unavailable();
    } catch {
      return unavailable();
    }
    if (
      !this.phaseCurrent(session, 'capturing') ||
      !this.sourceGenerationCurrent(session) ||
      generation !== this.tabEpoch(session.target.tabId)
    )
      return unavailable();
    if (
      !(await this.current(session)) ||
      !this.phaseCurrent(session, 'capturing') ||
      generation !== this.tabEpoch(session.target.tabId)
    )
      return unavailable();
    await this.cleanupOwnedStages(session);
    if (
      !this.phaseCurrent(session, 'capturing') ||
      !this.sourceGenerationCurrent(session) ||
      generation !== this.tabEpoch(session.target.tabId)
    )
      return unavailable();
    if (
      !(await this.current(session)) ||
      !this.phaseCurrent(session, 'capturing') ||
      generation !== this.tabEpoch(session.target.tabId)
    )
      return unavailable();
    session.payload = payload;
    session.phase = 'ready';
    session.phaseExpiresAt = Math.min(
      session.pageLeaseExpiresAt,
      this.now() + TEXT_PREVIEW_DELIVERY_MS
    );
    session.selectionId = undefined;
    session.options = undefined;
    await this.releaseSource(session);
    if (
      !this.phaseCurrent(session, 'ready') ||
      generation !== this.tabEpoch(session.target.tabId)
    ) {
      await this.invalidateSession(session, false);
      return unavailable();
    }
    return { success: true };
  }

  private take(session: PreviewSession, sender: chrome.runtime.MessageSender): unknown {
    const page = this.page(session, sender);
    if (!page || session.phase !== 'ready' || !session.payload) return unavailable();
    const deliveryId = this.random();
    if (!isTextPreviewToken(deliveryId)) return unavailable();
    if (
      new TextEncoder().encode(
        JSON.stringify({ success: true, deliveryId, payload: session.payload })
      ).byteLength > TEXT_PREVIEW_MAX_ENVELOPE_BYTES
    )
      return unavailable();
    session.deliveryId = deliveryId;
    session.phase = 'taken';
    session.phaseExpiresAt = Math.min(
      session.pageLeaseExpiresAt,
      this.now() + TEXT_PREVIEW_DELIVERY_MS
    );
    return { success: true, deliveryId, payload: session.payload };
  }

  private ack(
    session: PreviewSession,
    command: Extract<TextPreviewControlMessage, { action: 'ackTextPreviewPayload' }>,
    sender: chrome.runtime.MessageSender
  ): unknown {
    const page = this.page(session, sender);
    if (!page) return unavailable();
    if (
      session.phase === 'delivered' &&
      session.deliveryId === command.deliveryId &&
      session.ackedDocumentId === page.documentId
    )
      return { success: true };
    if (session.phase !== 'taken' || session.deliveryId !== command.deliveryId)
      return unavailable();
    session.payload = undefined;
    session.phase = 'delivered';
    session.phaseExpiresAt = session.pageLeaseExpiresAt;
    session.ackedDocumentId = page.documentId;
    return { success: true };
  }

  private async invalidate(
    session: PreviewSession,
    command: Extract<TextPreviewControlMessage, { action: 'invalidateTextPreview' }>,
    sender: chrome.runtime.MessageSender
  ): Promise<unknown> {
    const source = this.ownsSource(session, sender);
    const page = this.page(session, sender);
    if (
      (source && command.reason !== 'stop') ||
      (page && command.reason === 'stop') ||
      (!source && !page)
    )
      return unavailable();
    await this.invalidateSession(session, source ? false : true);
    return { success: true };
  }

  private tabEpoch(tabId: number | undefined): number {
    return tabId === undefined ? -1 : (this.tabRevocations.get(tabId) ?? 0);
  }

  async authorizeCaptureAction(
    message: { readonly action: string; readonly source?: unknown; readonly stageId?: unknown },
    captureId: string | undefined,
    sender: chrome.runtime.MessageSender
  ): Promise<boolean> {
    if (!captureId || !TEXT_PREVIEW_CAPTURE_ACTIONS.has(message.action)) return false;
    const epoch = this.tabEpoch(sender.tab?.id);
    return this.locked(async () => {
      const session = this.session(captureId);
      if (!session || !this.ownsSource(session, sender)) return false;
      const cleanup = message.action === 'abortStagedArchiveArtifact';
      const stageId = typeof message.stageId === 'string' ? message.stageId : undefined;
      if (cleanup)
        return (
          !!stageId &&
          session.stages.includes(stageId) &&
          message.source === session.target.platform
        );
      if (!isLiveCapture(session) || session.phase === 'awaiting-selection') return false;
      if (!this.sourceGenerationCurrent(session)) return false;
      if (
        (message.action === 'captureChatGptConversation' ||
          message.action === 'captureChatGptConversationViaOpaqueReplay') &&
        session.target.platform !== 'chatgpt'
      )
        return false;
      if (
        message.action.includes('StagedArchiveArtifact') &&
        message.source !== session.target.platform
      )
        return false;
      if (
        stageId &&
        message.action !== 'beginStagedArchiveArtifact' &&
        !session.stages.includes(stageId)
      )
        return false;
      if (!(await this.current(session))) {
        await this.invalidateSession(session, true);
        return false;
      }
      return (
        this.tabEpoch(session.target.tabId) === epoch &&
        this.sessions.includes(session) &&
        session.phase === 'capturing' &&
        session.phaseExpiresAt > this.now()
      );
    });
  }

  async recordCaptureResult(
    captureId: string | undefined,
    response: unknown,
    message: {
      readonly action: string;
      readonly source?: unknown;
      readonly stageId?: unknown;
    },
    sender: chrome.runtime.MessageSender
  ): Promise<void> {
    if (!captureId || !TEXT_PREVIEW_CAPTURE_ACTIONS.has(message.action)) return;
    await this.locked(async () => {
      const session = this.session(captureId);
      const result = response as {
        success?: unknown;
        stageId?: unknown;
        data?: { stageId?: unknown };
      };
      const resultStageId =
        result?.success === true ? (result.stageId ?? result.data?.stageId) : undefined;
      if (!session) {
        const tombstone = this.cleanupTombstones.find(item => item.id === captureId);
        if (!tombstone || !isSafeArchiveStageId(resultStageId)) return;
        const resultSource =
          message.action === 'captureChatGptConversation' ||
          message.action === 'captureChatGptConversationViaOpaqueReplay'
            ? 'chatgpt'
            : message.source;
        if (resultSource !== tombstone.source) return;
        if (!(await this.abortStage(tombstone.source, resultStageId))) {
          tombstone.stages = [...new Set([...tombstone.stages, resultStageId])];
        }
        return;
      }
      if (!this.ownsSource(session, sender)) return;
      if (message.action === 'abortStagedArchiveArtifact') {
        if (result?.success === true && typeof message.stageId === 'string')
          session.stages = session.stages.filter(stageId => stageId !== message.stageId);
        return;
      }
      const stageId = resultStageId;
      if (
        !isSafeArchiveStageId(stageId) ||
        session.stages.includes(stageId) ||
        this.sessions.some(other => other !== session && other.stages.includes(stageId))
      )
        return;
      if (!isLiveCapture(session) || session.stages.length >= 32) {
        if (!(await this.abortStage(session.target.platform, stageId)))
          session.stages.push(stageId);
        return;
      }
      session.stages.push(stageId);
    });
  }

  async tabRemoved(tabId: number): Promise<void> {
    this.tabRevocations.set(tabId, ++this.revocationSequence);
    await this.locked(async () => {
      for (const session of [...this.sessions]) {
        if (session.target.tabId === tabId) await this.invalidateSession(session, false);
        if (session.page?.tabId === tabId) {
          session.pageClosed = true;
          await this.invalidateSession(session, true);
        }
      }
    });
  }

  async tabChanged(tabId: number, change: chrome.tabs.TabChangeInfo): Promise<void> {
    if (!change.url && change.status !== 'loading') return;
    this.tabRevocations.set(tabId, ++this.revocationSequence);
    await this.locked(async () => {
      for (const session of this.sessions) {
        const sourceChanged =
          session.target.tabId === tabId &&
          (change.status === 'loading' || exportRoute(change.url)?.route !== session.target.route);
        const pageChanged =
          session.page?.tabId === tabId &&
          (change.status === 'loading' ||
            !sameTextPreviewPageUrl(change.url, textPreviewPageUrl(this.api.runtime, session.id)));
        if (sourceChanged || pageChanged) await this.invalidateSession(session, true);
      }
    });
  }
}
