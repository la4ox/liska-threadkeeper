import type { TextPreviewControlMessage, TextPreviewPhase } from '../lib/text-preview-contract';

const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const QUERY = new RegExp(`^\\?session=(${UUID})$`);
const TOKEN = new RegExp(`^${UUID}$`);
const PHASES: readonly TextPreviewPhase[] = [
  'pending',
  'capturing',
  'awaiting-selection',
  'ready',
  'taken',
  'delivered',
  'invalidated',
];

export type PreviewRequest = (message: TextPreviewControlMessage) => Promise<unknown>;

export function parsePreviewSession(href: string): string | undefined {
  try {
    const url = new URL(href);
    return url.hash || !href.endsWith(url.search) ? undefined : QUERY.exec(url.search)?.[1];
  } catch {
    return undefined;
  }
}

export function isPreviewUuid(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

export function responseRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function previewMetadata(value: unknown) {
  const data = responseRecord(value);
  if (
    data?.success !== true ||
    !PHASES.includes(data.state as TextPreviewPhase) ||
    !Number.isSafeInteger(data.expiresAt) ||
    (data.expiresAt as number) <= Date.now()
  )
    return undefined;
  return { state: data.state as TextPreviewPhase, expiresAt: data.expiresAt as number };
}

/** A lost callback is unknown, never permission to repeat a capability use. */
export const requestPreview: PreviewRequest = message =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('preview-connection-unknown')), 10_000);
    try {
      chrome.runtime.sendMessage(message, response => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) reject(new Error('preview-connection-unavailable'));
        else resolve(response as unknown);
      });
    } catch {
      clearTimeout(timer);
      reject(new Error('preview-connection-unavailable'));
    }
  });

export function trustedPreviewAction(event: Event, action: () => void): void {
  if (event.isTrusted) action();
}
