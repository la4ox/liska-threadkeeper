import {
  boundedBranchOptions,
  isExportToken,
  type ExportBranchOption,
  type ExportChoice,
  type ExportClaim,
  type ExportControlMessage,
  type ExportMode,
} from '../lib/export-operation-contract';
import {
  clearExportScope,
  installExportScope,
  type ContentExportScope,
} from '../lib/export-operation-scope';
import type { ContentScriptSettings } from '../lib/types';

export interface ClaimedContentExport {
  scope: ContentExportScope;
  settings: ContentScriptSettings;
  selected: boolean;
}
interface Selection {
  id: string;
  options: ExportBranchOption[];
  resolve: (choice: ExportChoice | null) => void;
}
let active: ClaimedContentExport | undefined;
let selection: Selection | undefined;
let claiming = false;
let installed = false;

function control(message: ExportControlMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) reject(new Error('Export control unavailable'));
      else resolve(response);
    });
  });
}
export async function openExportSurface(): Promise<void> {
  await control({ action: 'openExportSurface' });
}
export function claimedContentExport(): ClaimedContentExport | undefined {
  return active;
}

export async function selectExportBranch(
  options: ExportBranchOption[]
): Promise<ExportChoice | null> {
  const operation = active;
  const bounded = boundedBranchOptions(options);
  if (!operation || !bounded || operation.scope.abort.signal.aborted) return null;
  const id = crypto.randomUUID();
  return new Promise(resolve => {
    selection = { id, options: bounded, resolve };
    void control({
      action: 'awaitExportSelection',
      exportOperationId: operation.scope.id,
      selectionId: id,
    }).then(
      response => {
        if (!(response as { success?: boolean })?.success && selection?.id === id)
          finishSelection(null);
      },
      () => {
        if (selection?.id === id) finishSelection(null);
      }
    );
  });
}
function finishSelection(choice: ExportChoice | null): void {
  const pending = selection;
  selection = undefined;
  if (choice !== null && active) active.selected = true;
  pending?.resolve(choice);
}
function matchesChoice(message: { selectionId?: unknown; choice?: unknown }): boolean {
  return (
    !!selection &&
    message.selectionId === selection.id &&
    (message.choice === 'all' ||
      selection.options.some(option => option.ordinal === message.choice))
  );
}
function ownedCommand(message: Record<string, unknown>, reply: (value: unknown) => void): void {
  if (!active || message.exportOperationId !== active.scope.id) {
    reply({ accepted: false });
    return;
  }
  if (message.action === 'cancelExportOperation') {
    active.scope.abort.abort();
    finishSelection(null);
    reply({ accepted: true });
    return;
  }
  if (active.scope.abort.signal.aborted || window.location.href !== active.scope.route) {
    reply({ accepted: false });
    return;
  }
  if (message.action === 'readExportBranchOptions') {
    reply({ options: message.selectionId === selection?.id ? selection?.options : undefined });
    return;
  }
  const accepted = matchesChoice(message);
  reply({ accepted });
  if (message.action === 'applyExportChoice' && accepted)
    finishSelection(message.choice as ExportChoice);
}
async function begin(
  message: Record<string, unknown>,
  run: (mode: ExportMode) => Promise<void>
): Promise<boolean> {
  if (
    active ||
    claiming ||
    !isExportToken(message.intentId) ||
    message.route !== window.location.href
  )
    return false;
  claiming = true;
  try {
    const claim = (await control({
      action: 'claimExportOperation',
      intentId: message.intentId,
      route: window.location.href,
    })) as ExportClaim;
    if (
      !claim.success ||
      !isExportToken(claim.exportOperationId) ||
      !claim.settings ||
      !claim.mode ||
      !Number.isSafeInteger(claim.expiresAt)
    )
      return false;
    if (window.location.href !== message.route) {
      await control({
        action: 'completeExportOperation',
        exportOperationId: claim.exportOperationId,
        outcome: claim.mode === 'selected' ? 'branch-preparation-ended' : 'ended',
      });
      return false;
    }
    const scope: ContentExportScope = {
      id: claim.exportOperationId,
      route: message.route as string,
      abort: new AbortController(),
      closed: false,
    };
    installExportScope(scope);
    const operation = { scope, settings: claim.settings, selected: claim.mode === 'current' };
    active = operation;
    const expiry = setTimeout(
      () => {
        scope.abort.abort();
        if (active?.scope === scope) finishSelection(null);
      },
      Math.max(0, claim.expiresAt! - Date.now())
    );
    // Respond to start immediately. Closing the toolbar popup never owns this promise.
    void run(claim.mode)
      .finally(async () => {
        clearTimeout(expiry);
        finishSelection(null);
        try {
          await control({
            action: 'completeExportOperation',
            exportOperationId: scope.id,
            outcome:
              claim.mode === 'selected' && !operation.selected
                ? 'branch-preparation-ended'
                : 'ended',
          });
        } finally {
          clearExportScope(scope);
          if (active?.scope === scope) active = undefined;
        }
      })
      .catch(() => undefined);
    return true;
  } finally {
    claiming = false;
  }
}
export function installExportOperationClient(run: (mode: ExportMode) => Promise<void>): void {
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
    if (command.action === 'beginExportOperation') {
      void begin(command, run).then(
        accepted => reply({ accepted }),
        () => reply({ accepted: false })
      );
      return true;
    }
    if (
      [
        'cancelExportOperation',
        'readExportBranchOptions',
        'validateExportChoice',
        'applyExportChoice',
      ].includes(String(command.action))
    ) {
      ownedCommand(command, reply);
      return false;
    }
    return false;
  });
}
