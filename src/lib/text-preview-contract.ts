import {
  boundedBranchOptions,
  exportRoute,
  MAX_BRANCH_OPTIONS,
  type ExportBranchOption,
} from './export-operation-contract';

export const TEXT_PREVIEW_PAGE_PATH = 'src/text-preview/text-preview.html';
export const TEXT_PREVIEW_PENDING_MS = 30_000;
export const TEXT_PREVIEW_CAPTURE_MS = 5 * 60_000;
export const TEXT_PREVIEW_DELIVERY_MS = 30_000;
export const TEXT_PREVIEW_PAGE_LEASE_MS = 15 * 60_000;
export const TEXT_PREVIEW_MAX_LEASES = 4;
export const TEXT_PREVIEW_MAX_ENVELOPE_BYTES = 12 * 1024 * 1024;

export type TextPreviewBranchMode = 'current' | 'selected';
export const TEXT_PREVIEW_START_FAILURE_STEPS = [
  'window-create',
  'window-shape',
  'navigation-api',
  'navigation-request',
  'navigation-result',
  'navigation-readback',
  'navigation-current',
  'page-registration',
  'source-accept',
  'start-confirmation',
] as const;
export type TextPreviewStartFailureStep = (typeof TEXT_PREVIEW_START_FAILURE_STEPS)[number];
export type TextPreviewPhase =
  | 'pending'
  | 'capturing'
  | 'awaiting-selection'
  | 'ready'
  | 'taken'
  | 'delivered'
  | 'invalidated';

export interface TextPreviewCaptureSettings {
  readonly enableAutoScroll: boolean;
  readonly enableToolContent: boolean;
  readonly enableInertCodeBlocks: boolean;
  readonly enableChatGptOpaqueReplay: boolean;
}

export interface TextPreviewMetadataStatus {
  readonly success: true;
  readonly state: TextPreviewPhase;
  readonly expiresAt: number;
}

export interface TextPreviewStartStatus extends TextPreviewMetadataStatus {
  readonly sessionId: string;
  readonly state: 'pending' | 'capturing' | 'awaiting-selection';
  /** Current pending/capture/selection deadline; distinct from the absolute page lease. */
  readonly captureExpiresAt: number;
}

export interface TextPreviewBranchOptionsStatus {
  readonly success: true;
  readonly state: 'awaiting-selection';
  readonly selectionId: string;
  readonly options: readonly ExportBranchOption[];
}

export type TextPreviewControlMessage =
  | {
      readonly action: 'startTextPreview';
      readonly expectedTarget: { readonly tabId: number; readonly route: string };
      readonly branchMode: TextPreviewBranchMode;
    }
  | {
      readonly action: 'claimTextPreviewCapture';
      readonly sessionId: string;
      readonly route: string;
    }
  | {
      readonly action: 'awaitTextPreviewSelection';
      readonly sessionId: string;
      readonly selectionId: string;
      readonly options: readonly ExportBranchOption[];
    }
  | { readonly action: 'getTextPreviewBranchOptions'; readonly sessionId: string }
  | {
      readonly action: 'chooseTextPreviewBranch';
      readonly sessionId: string;
      readonly selectionId: string;
      readonly choice: number;
    }
  | { readonly action: 'checkTextPreviewCaptureLease'; readonly sessionId: string }
  | { readonly action: 'publishTextPreview'; readonly sessionId: string; readonly payload: unknown }
  | { readonly action: 'getTextPreviewStatus'; readonly sessionId: string }
  | { readonly action: 'takeTextPreviewPayload'; readonly sessionId: string }
  | {
      readonly action: 'ackTextPreviewPayload';
      readonly sessionId: string;
      readonly deliveryId: string;
    }
  | {
      readonly action: 'invalidateTextPreview';
      readonly sessionId: string;
      readonly reason: 'clear' | 'stop' | 'close';
    };

export const TEXT_PREVIEW_CONTROL_ACTIONS = new Set<string>([
  'startTextPreview',
  'claimTextPreviewCapture',
  'awaitTextPreviewSelection',
  'getTextPreviewBranchOptions',
  'chooseTextPreviewBranch',
  'checkTextPreviewCaptureLease',
  'publishTextPreview',
  'getTextPreviewStatus',
  'takeTextPreviewPayload',
  'ackTextPreviewPayload',
  'invalidateTextPreview',
]);

/** The preview capability can prepare canonical text, never reach a provider probe, asset, or sink. */
export const TEXT_PREVIEW_CAPTURE_ACTIONS = new Set<string>([
  'captureChatGptConversation',
  'captureChatGptConversationViaOpaqueReplay',
  'beginStagedArchiveArtifact',
  'appendStagedArchiveArtifact',
  'sealStagedArchiveArtifact',
  'readStagedArchiveArtifact',
  'abortStagedArchiveArtifact',
]);

export const TEXT_PREVIEW_CONTENT_ACTIONS = new Set<string>([
  'claimTextPreviewCapture',
  'awaitTextPreviewSelection',
  'checkTextPreviewCaptureLease',
  'publishTextPreview',
  'invalidateTextPreview',
]);

/** Sender inventory for the future exact popup integration. */
export const TEXT_PREVIEW_UI_ACTIONS = new Set<string>([
  'startTextPreview',
  'getTextPreviewBranchOptions',
  'chooseTextPreviewBranch',
]);

/** Sender inventory for the separately registered fixed preview page. */
export const TEXT_PREVIEW_PAGE_ACTIONS = new Set<string>([
  'getTextPreviewStatus',
  'takeTextPreviewPayload',
  'ackTextPreviewPayload',
  'invalidateTextPreview',
]);

const TOKEN = /^[a-f0-9-]{36}$/;

export function isTextPreviewToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

export function isTextPreviewStartFailureStep(
  value: unknown
): value is TextPreviewStartFailureStep {
  return (
    typeof value === 'string' &&
    (TEXT_PREVIEW_START_FAILURE_STEPS as readonly string[]).includes(value)
  );
}

function ownData(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))
  )
    return undefined;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value'))
      return undefined;
    result[key] = descriptor.value;
  }
  return result;
}

function target(value: unknown): { tabId: number; route: string } | undefined {
  const data = ownData(value, ['tabId', 'route']);
  const route = exportRoute(data?.route);
  return data && Number.isSafeInteger(data.tabId) && (data.tabId as number) >= 0 && route
    ? { tabId: data.tabId as number, route: route.route }
    : undefined;
}

function sessionMessage(
  value: unknown,
  action: string,
  extraKeys: readonly string[] = []
): Record<string, unknown> | undefined {
  const data = ownData(value, ['action', 'sessionId', ...extraKeys]);
  return data?.action === action && isTextPreviewToken(data.sessionId) ? data : undefined;
}

function branchOptions(value: unknown): ExportBranchOption[] | undefined {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length === 0 ||
    value.length > MAX_BRANCH_OPTIONS ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    return undefined;
  const detached: Record<string, unknown>[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value'))
      return undefined;
    const item = descriptor.value;
    const withPreview = ownData(item, [
      'ordinal',
      'messageCount',
      'uniqueMessageCount',
      'isCurrent',
      'preview',
    ]);
    const withoutPreview = withPreview
      ? undefined
      : ownData(item, ['ordinal', 'messageCount', 'uniqueMessageCount', 'isCurrent']);
    const data = withPreview ?? withoutPreview;
    if (!data) return undefined;
    detached.push({ ...data });
  }
  return boundedBranchOptions(detached);
}

/** Detach one exact own-data command before any controller reads it. */
// eslint-disable-next-line complexity, max-lines-per-function -- The closed action union is intentionally decoded in one exact-key boundary.
export function snapshotTextPreviewControlMessage(
  value: unknown
): TextPreviewControlMessage | undefined {
  try {
    const action =
      value && typeof value === 'object'
        ? Object.getOwnPropertyDescriptor(value, 'action')?.value
        : undefined;
    if (typeof action !== 'string' || !TEXT_PREVIEW_CONTROL_ACTIONS.has(action)) return undefined;
    if (action === 'startTextPreview') {
      const data = ownData(value, ['action', 'expectedTarget', 'branchMode']);
      const expectedTarget = target(data?.expectedTarget);
      return data &&
        expectedTarget &&
        (data.branchMode === 'current' || data.branchMode === 'selected')
        ? { action, expectedTarget, branchMode: data.branchMode }
        : undefined;
    }
    if (action === 'claimTextPreviewCapture') {
      const data = sessionMessage(value, action, ['route']);
      const route = exportRoute(data?.route);
      return data && route
        ? { action, sessionId: data.sessionId as string, route: route.route }
        : undefined;
    }
    if (action === 'awaitTextPreviewSelection') {
      const data = sessionMessage(value, action, ['selectionId', 'options']);
      const options = branchOptions(data?.options);
      return data && isTextPreviewToken(data.selectionId) && options
        ? {
            action,
            sessionId: data.sessionId as string,
            selectionId: data.selectionId,
            options,
          }
        : undefined;
    }
    if (action === 'chooseTextPreviewBranch') {
      const data = sessionMessage(value, action, ['selectionId', 'choice']);
      return data &&
        isTextPreviewToken(data.selectionId) &&
        Number.isSafeInteger(data.choice) &&
        (data.choice as number) > 0
        ? {
            action,
            sessionId: data.sessionId as string,
            selectionId: data.selectionId,
            choice: data.choice as number,
          }
        : undefined;
    }
    if (action === 'ackTextPreviewPayload') {
      const data = sessionMessage(value, action, ['deliveryId']);
      return data && isTextPreviewToken(data.deliveryId)
        ? {
            action,
            sessionId: data.sessionId as string,
            deliveryId: data.deliveryId,
          }
        : undefined;
    }
    if (action === 'invalidateTextPreview') {
      const data = sessionMessage(value, action, ['reason']);
      return data && (data.reason === 'clear' || data.reason === 'stop' || data.reason === 'close')
        ? {
            action,
            sessionId: data.sessionId as string,
            reason: data.reason,
          }
        : undefined;
    }
    if (action === 'publishTextPreview') {
      const data = sessionMessage(value, action, ['payload']);
      return data
        ? { action, sessionId: data.sessionId as string, payload: data.payload }
        : undefined;
    }
    const data = sessionMessage(value, action);
    return data
      ? ({ action, sessionId: data.sessionId as string } as TextPreviewControlMessage)
      : undefined;
  } catch {
    return undefined;
  }
}

export function textPreviewPageUrl(
  runtime: Pick<typeof chrome.runtime, 'getURL'>,
  sessionId: string
): string {
  if (!isTextPreviewToken(sessionId)) throw new Error('text-preview-session-invalid');
  return runtime.getURL(`${TEXT_PREVIEW_PAGE_PATH}?session=${sessionId}`);
}

const TEXT_PREVIEW_EXTENSION_SCHEMES = ['chrome-extension://', 'comet-extension://'] as const;

/**
 * Comet exposes Chrome extension pages through a browser-owned scheme alias.
 * Keep every byte after that explicit scheme boundary exact: extension ID,
 * path, session query and fragment state remain part of the page capability.
 */
export function sameTextPreviewPageUrl(actualUrl: unknown, expectedUrl: string): boolean {
  if (actualUrl === expectedUrl) return true;
  if (typeof actualUrl !== 'string') return false;
  const actualScheme = TEXT_PREVIEW_EXTENSION_SCHEMES.find(scheme => actualUrl.startsWith(scheme));
  const expectedScheme = TEXT_PREVIEW_EXTENSION_SCHEMES.find(scheme =>
    expectedUrl.startsWith(scheme)
  );
  return (
    actualScheme !== undefined &&
    expectedScheme !== undefined &&
    actualUrl.slice(actualScheme.length) === expectedUrl.slice(expectedScheme.length)
  );
}
