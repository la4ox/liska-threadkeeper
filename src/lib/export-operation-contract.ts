import { platformForHost } from './platform-registry';
import type { AIPlatform, ContentScriptSettings, OutputDestination } from './types';

export const EXPORT_PENDING_MS = 30_000;
export const EXPORT_OPERATION_MS = 2 * 60 * 60 * 1000;
export const EXPORT_POPUP_PATH = 'src/popup/index.html';
export const EXPORT_STATE_KEY = 'export-operation-v1';
export const MAX_BRANCH_OPTIONS = 1_000;
export type ExportMode = 'current' | 'selected';
export type ExportPhase =
  | 'preparing'
  | 'awaiting-selection'
  | 'exporting'
  | 'cancelled'
  | 'completed';
export type ExportChoice = number | 'all';
export type ExportTerminalOutcome = 'ended' | 'branch-preparation-ended';
export interface ExportBranchOption {
  ordinal: number;
  messageCount: number;
  uniqueMessageCount: number;
  isCurrent: boolean;
  preview?: string;
}
export interface ExportTarget {
  tabId: number;
  route: string;
  platform: AIPlatform;
  title: string;
}
export interface ExportStatus {
  success: boolean;
  error?: string;
  target?: ExportTarget;
  outputs?: OutputDestination[];
  operation?: {
    id: string;
    phase: ExportPhase;
    mode: ExportMode;
    selectionId?: string;
    outcome?: ExportTerminalOutcome;
  };
  options?: ExportBranchOption[];
}
export type ExportControlMessage =
  | { action: 'openExportSurface' }
  | { action: 'getExportStatus' }
  | {
      action: 'startExportOperation';
      mode: ExportMode;
      expectedTarget: Pick<ExportTarget, 'tabId' | 'route'>;
      expectedOutputs: OutputDestination[];
    }
  | { action: 'claimExportOperation'; intentId: string; route: string }
  | { action: 'awaitExportSelection'; exportOperationId: string; selectionId: string }
  | { action: 'getExportBranchOptions' }
  | {
      action: 'chooseExportBranch';
      exportOperationId: string;
      selectionId: string;
      choice: ExportChoice;
    }
  | { action: 'cancelExportOperation'; exportOperationId: string }
  | {
      action: 'completeExportOperation';
      exportOperationId: string;
      outcome: ExportTerminalOutcome;
    };
export interface ExportClaim {
  success: boolean;
  exportOperationId?: string;
  mode?: ExportMode;
  settings?: ContentScriptSettings;
  expiresAt?: number;
}
export const EXPORT_CONTROL_ACTIONS = new Set<string>([
  'openExportSurface',
  'getExportStatus',
  'startExportOperation',
  'claimExportOperation',
  'awaitExportSelection',
  'getExportBranchOptions',
  'chooseExportBranch',
  'cancelExportOperation',
  'completeExportOperation',
]);
export const EXPORT_DURABLE_ACTIONS = new Set<string>([
  'saveToOutputs',
  'persistArchiveCompanion',
  'persistDerivedHtmlPresentation',
  'persistDerivedTextPresentation',
  'persistDerivedBranchHtmlPresentation',
  'commitStagedArchiveCompanion',
  'commitStagedBinaryAsset',
]);
export const EXPORT_CLEANUP_ACTIONS = new Set<string>([
  'abortStagedArchiveArtifact',
  'abortStagedBinaryAsset',
]);
export const EXPORT_PREPARATION_ACTIONS = new Set<string>([
  'testConnection',
  'captureChatGptConversation',
  'probeChatGptOpaqueRequest',
  'captureChatGptConversationViaOpaqueReplay',
  'observeChatGptAssetResolversViaOpaqueSource',
  'probeChatGptActiveAssetResolvers',
  'resolveChatGptActiveAsset',
  'resolveChatGptInterpreterAssets',
  'fetchImage',
  'beginStagedArchiveArtifact',
  'appendStagedArchiveArtifact',
  'sealStagedArchiveArtifact',
  'readStagedArchiveArtifact',
  'beginStagedBinaryAsset',
  'appendStagedBinaryAsset',
]);
export function isExportAction(action: string): boolean {
  return (
    EXPORT_DURABLE_ACTIONS.has(action) ||
    EXPORT_PREPARATION_ACTIONS.has(action) ||
    EXPORT_CLEANUP_ACTIONS.has(action)
  );
}
export function isExportToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
}
export function isExportTerminalOutcome(value: unknown): value is ExportTerminalOutcome {
  return value === 'ended' || value === 'branch-preparation-ended';
}
/** Keep the entire normalized route (including query/hash): ambiguity revokes, never broadens. */
export function exportRoute(raw: unknown): { route: string; platform: AIPlatform } | undefined {
  if (typeof raw !== 'string' || raw.length > 2_048) return undefined;
  try {
    const url = new URL(raw);
    const platform = platformForHost(url.hostname);
    if (!platform || url.protocol !== 'https:' || url.username || url.password || url.port)
      return undefined;
    return { route: url.href, platform };
  } catch {
    return undefined;
  }
}
export function boundedBranchOptions(value: unknown): ExportBranchOption[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BRANCH_OPTIONS)
    return undefined;
  const ordinals = new Set<number>();
  const result: ExportBranchOption[] = [];
  for (const item of value) {
    if (
      !item ||
      !Number.isSafeInteger(item.ordinal) ||
      item.ordinal < 1 ||
      ordinals.has(item.ordinal) ||
      !Number.isSafeInteger(item.messageCount) ||
      item.messageCount < 0 ||
      item.messageCount > 1_000_000 ||
      !Number.isSafeInteger(item.uniqueMessageCount) ||
      item.uniqueMessageCount < 0 ||
      item.uniqueMessageCount > item.messageCount ||
      typeof item.isCurrent !== 'boolean' ||
      (item.preview !== undefined &&
        (typeof item.preview !== 'string' || item.preview.length > 280))
    )
      return undefined;
    ordinals.add(item.ordinal);
    result.push({
      ordinal: item.ordinal,
      messageCount: item.messageCount,
      uniqueMessageCount: item.uniqueMessageCount,
      isCurrent: item.isCurrent,
      ...(item.preview === undefined ? {} : { preview: item.preview }),
    });
  }
  return result;
}
