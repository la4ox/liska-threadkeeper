import type { ArchiveTextPreview } from '../archive/presentation';
import { boundedBranchOptions, type ExportBranchOption } from '../lib/export-operation-contract';
import {
  isTextPreviewToken,
  TEXT_PREVIEW_MAX_ENVELOPE_BYTES,
  type TextPreviewBranchMode,
  type TextPreviewCaptureSettings,
} from '../lib/text-preview-contract';
import {
  clearTextPreviewScope,
  installTextPreviewScope,
  type ContentTextPreviewScope,
} from '../lib/export-operation-scope';

export interface ClaimedTextPreviewCapture {
  readonly scope: ContentTextPreviewScope;
  readonly mode: TextPreviewBranchMode;
  readonly settings: TextPreviewCaptureSettings;
}

interface Selection {
  readonly id: string;
  readonly options: readonly ExportBranchOption[];
  readonly resolve: (choice: number | null) => void;
}

let active: ClaimedTextPreviewCapture | undefined;
let selection: Selection | undefined;
let claiming = false;
let installed = false;

function control(message: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) reject(new Error('Text preview control unavailable'));
      else resolve(response);
    });
  });
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  return (
    ownKeys.length === keys.length &&
    ownKeys.every(key => typeof key === 'string' && keys.includes(key)) &&
    keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !!descriptor?.enumerable && Object.prototype.hasOwnProperty.call(descriptor, 'value');
    })
  );
}

function captureSettings(value: unknown): TextPreviewCaptureSettings | undefined {
  if (
    !exactObject(value, ['enableAutoScroll', 'enableToolContent', 'enableChatGptOpaqueReplay']) ||
    typeof value.enableAutoScroll !== 'boolean' ||
    typeof value.enableToolContent !== 'boolean' ||
    typeof value.enableChatGptOpaqueReplay !== 'boolean'
  )
    return undefined;
  return Object.freeze({
    enableAutoScroll: value.enableAutoScroll,
    enableToolContent: value.enableToolContent,
    enableChatGptOpaqueReplay: value.enableChatGptOpaqueReplay,
  });
}

function finishSelection(choice: number | null): void {
  const pending = selection;
  selection = undefined;
  pending?.resolve(choice);
}

export function claimedTextPreviewCapture(): ClaimedTextPreviewCapture | undefined {
  return active;
}

/** Preview selection deliberately has no `all` branch value. */
export async function selectTextPreviewBranch(
  options: ExportBranchOption[]
): Promise<number | null> {
  const operation = active;
  const bounded = boundedBranchOptions(options);
  if (!operation || !bounded || operation.scope.abort.signal.aborted) return null;
  const id = crypto.randomUUID();
  if (!isTextPreviewToken(id)) return null;
  return new Promise(resolve => {
    selection = { id, options: Object.freeze(bounded), resolve };
    void control({
      action: 'awaitTextPreviewSelection',
      sessionId: operation.scope.id,
      selectionId: id,
      options: bounded,
    }).then(
      response => {
        if ((response as { success?: unknown })?.success !== true && selection?.id === id)
          finishSelection(null);
      },
      () => {
        if (selection?.id === id) finishSelection(null);
      }
    );
  });
}

export async function checkTextPreviewCaptureLease(): Promise<boolean> {
  const operation = active;
  if (!operation || operation.scope.abort.signal.aborted) return false;
  try {
    const response = (await control({
      action: 'checkTextPreviewCaptureLease',
      sessionId: operation.scope.id,
    })) as { success?: unknown; live?: unknown };
    return response?.success === true && response.live === true;
  } catch {
    return false;
  }
}

export async function publishTextPreview(payload: ArchiveTextPreview): Promise<boolean> {
  const operation = active;
  if (!operation || operation.scope.abort.signal.aborted) return false;
  try {
    const envelope = JSON.stringify({
      action: 'publishTextPreview',
      sessionId: operation.scope.id,
      payload,
    });
    if (new TextEncoder().encode(envelope).byteLength > TEXT_PREVIEW_MAX_ENVELOPE_BYTES)
      return false;
    const response = (await control({
      action: 'publishTextPreview',
      sessionId: operation.scope.id,
      payload,
    })) as { success?: unknown };
    return response?.success === true;
  } catch {
    return false;
  }
}

function matchesChoice(message: Record<string, unknown>): boolean {
  return (
    !!selection &&
    message.selectionId === selection.id &&
    Number.isSafeInteger(message.choice) &&
    selection.options.some(option => option.ordinal === message.choice)
  );
}

function ownedCommand(message: Record<string, unknown>, reply: (value: unknown) => void): void {
  if (!active || message.sessionId !== active.scope.id) {
    reply({ accepted: false });
    return;
  }
  if (message.action === 'cancelTextPreviewCapture') {
    active.scope.abort.abort();
    finishSelection(null);
    reply({ accepted: true });
    return;
  }
  if (active.scope.abort.signal.aborted || window.location.href !== active.scope.route) {
    reply({ accepted: false });
    return;
  }
  const accepted = matchesChoice(message);
  reply({ accepted });
  if (message.action === 'applyTextPreviewChoice' && accepted)
    finishSelection(message.choice as number);
}

function validClaim(
  value: unknown,
  sessionId: string
):
  | {
      readonly branchMode: TextPreviewBranchMode;
      readonly expiresAt: number;
      readonly settings: TextPreviewCaptureSettings;
    }
  | undefined {
  if (
    !exactObject(value, ['success', 'sessionId', 'branchMode', 'expiresAt', 'settings']) ||
    value.success !== true ||
    value.sessionId !== sessionId ||
    (value.branchMode !== 'current' && value.branchMode !== 'selected') ||
    !Number.isSafeInteger(value.expiresAt)
  )
    return undefined;
  const settings = captureSettings(value.settings);
  return settings
    ? { branchMode: value.branchMode, expiresAt: value.expiresAt as number, settings }
    : undefined;
}

// eslint-disable-next-line max-lines-per-function -- Claim, detached run startup, and terminal scope release form one generation boundary.
async function begin(
  message: Record<string, unknown>,
  run: (mode: TextPreviewBranchMode, settings: TextPreviewCaptureSettings) => Promise<boolean>
): Promise<boolean> {
  if (
    active ||
    claiming ||
    !isTextPreviewToken(message.sessionId) ||
    message.route !== window.location.href ||
    (message.branchMode !== 'current' && message.branchMode !== 'selected')
  )
    return false;
  claiming = true;
  try {
    const claimed = validClaim(
      await control({
        action: 'claimTextPreviewCapture',
        sessionId: message.sessionId,
        route: window.location.href,
      }),
      message.sessionId
    );
    if (!claimed || claimed.branchMode !== message.branchMode) return false;
    if (window.location.href !== message.route) return false;
    const scope: ContentTextPreviewScope = {
      id: message.sessionId,
      route: message.route,
      abort: new AbortController(),
      closed: false,
    };
    installTextPreviewScope(scope);
    active = { scope, mode: claimed.branchMode, settings: claimed.settings };
    const expiry = window.setTimeout(
      () => {
        scope.abort.abort();
        if (active?.scope === scope) finishSelection(null);
      },
      Math.max(0, claimed.expiresAt - Date.now())
    );
    void run(claimed.branchMode, claimed.settings)
      .then(async published => {
        if (!published) {
          await control({
            action: 'invalidateTextPreview',
            sessionId: scope.id,
            reason: 'stop',
          }).catch(() => undefined);
        }
      })
      .catch(async () => {
        await control({
          action: 'invalidateTextPreview',
          sessionId: scope.id,
          reason: 'stop',
        }).catch(() => undefined);
      })
      .finally(() => {
        window.clearTimeout(expiry);
        finishSelection(null);
        clearTextPreviewScope(scope);
        if (active?.scope === scope) active = undefined;
      });
    return true;
  } finally {
    claiming = false;
  }
}

export function installTextPreviewClient(
  run: (mode: TextPreviewBranchMode, settings: TextPreviewCaptureSettings) => Promise<boolean>
): void {
  if (installed) return;
  installed = true;
  chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
    if (
      sender.id !== chrome.runtime.id ||
      sender.tab !== undefined ||
      (sender.url && !sender.url.startsWith(chrome.runtime.getURL(''))) ||
      !message ||
      typeof message !== 'object'
    )
      return false;
    const command = message as Record<string, unknown>;
    if (command.action === 'beginTextPreviewCapture') {
      void begin(command, run).then(
        accepted => reply({ accepted }),
        () => reply({ accepted: false })
      );
      return true;
    }
    if (
      ['cancelTextPreviewCapture', 'validateTextPreviewChoice', 'applyTextPreviewChoice'].includes(
        String(command.action)
      )
    ) {
      ownedCommand(command, reply);
      return false;
    }
    return false;
  });
}
