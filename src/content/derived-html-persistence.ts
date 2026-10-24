/** Destination-honest opt-in HTML delivery after the File archive trio succeeds. */
import type { HtmlAssetBindingSet } from '../archive/presentation';
import { MAX_EXTENSION_MESSAGE_SIZE } from '../lib/constants';
import { jsonUtf8ByteLength } from '../lib/byte-size';
import { isSerializedSyncSettingsSnapshot } from '../lib/sync-settings-snapshot';
import type {
  DurableMultiOutputResponse,
  ExtensionMessage,
  StructuredPresentationContext,
} from '../lib/types';
import { sendMessage } from '../lib/messaging';
import { prepareDerivedHtmlArtifact } from './derived-html-presentation';

export const DERIVED_HTML_UNAVAILABLE_WARNING =
  'Canonical HTML was not created because a verified structured presentation was unavailable.';
export const DERIVED_HTML_PREPARATION_WARNING =
  'Canonical HTML was not created because its canonical source could not be verified.';
export const DERIVED_HTML_WRITE_WARNING = 'Canonical HTML was not saved to File.';
export const DERIVED_HTML_PARTIAL_RECEIPT_WARNING =
  'Canonical HTML may have been saved, but its receipt was not confirmed; no retry was attempted.';
export const DERIVED_HTML_CLEANUP_WARNING =
  'Canonical HTML was saved, but temporary artifact cleanup was not confirmed.';
export const DERIVED_HTML_ATTACHMENT_PENDING_WARNING =
  'Canonical HTML is not available yet for attachment-finalized snapshots.';
export const DERIVED_HTML_ALL_BRANCHES_PENDING_WARNING =
  'Canonical HTML is not available yet for all-branches bundles.';

type DerivedHtmlMessage = Extract<ExtensionMessage, { action: 'persistDerivedHtmlPresentation' }>;

export interface DerivedHtmlPersistenceDependencies {
  prepare?: typeof prepareDerivedHtmlArtifact;
  send?: (message: DerivedHtmlMessage) => Promise<unknown>;
}

export interface DerivedHtmlPersistenceResult {
  success: boolean;
  warnings: string[];
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : undefined;
}

function validWriteOutcome(value: unknown, requireConfirmed: boolean): boolean {
  const outcome = plainRecord(value);
  return (
    outcome !== undefined &&
    ['confirmed', 'unknown', 'not-dispatched'].includes(String(outcome.state)) &&
    (outcome.cleanupDeferred === undefined || outcome.cleanupDeferred === true) &&
    (!requireConfirmed || outcome.state === 'confirmed')
  );
}

function validFileResult(value: unknown): value is DurableMultiOutputResponse['results'][number] {
  const result = plainRecord(value);
  return (
    result !== undefined &&
    result.destination === 'file' &&
    typeof result.success === 'boolean' &&
    (result.error === undefined || typeof result.error === 'string') &&
    (result.warning === undefined || typeof result.warning === 'string') &&
    validWriteOutcome(result.writeOutcome, result.success)
  );
}

function validatedResponse(value: unknown): DurableMultiOutputResponse | undefined {
  const response = plainRecord(value);
  if (!response || !Array.isArray(response.results) || response.results.length !== 1)
    return undefined;
  const result = response.results[0];
  if (
    !validFileResult(result) ||
    response.allSuccessful !== result.success ||
    response.anySuccessful !== result.success
  ) {
    return undefined;
  }
  return value as DurableMultiOutputResponse;
}

function responseResult(response: DurableMultiOutputResponse): DerivedHtmlPersistenceResult {
  const result = response.results[0];
  if (result.success) {
    return {
      success: true,
      warnings: result.writeOutcome.cleanupDeferred === true ? [DERIVED_HTML_CLEANUP_WARNING] : [],
    };
  }
  return {
    success: false,
    warnings: [
      result.error === 'derived-html-receipt-unconfirmed'
        ? DERIVED_HTML_PARTIAL_RECEIPT_WARNING
        : DERIVED_HTML_WRITE_WARNING,
    ],
  };
}

/**
 * Call only after File has confirmed raw + manifest + canonical for this capture.
 * A failure remains presentation-local and never changes those archive results.
 */
export async function persistDerivedHtmlForFile(
  context: StructuredPresentationContext | undefined,
  expectedSyncSettingsSnapshot: string,
  assetBindings?: HtmlAssetBindingSet,
  dependencies: DerivedHtmlPersistenceDependencies = {}
): Promise<DerivedHtmlPersistenceResult> {
  if (!context) return { success: false, warnings: [DERIVED_HTML_UNAVAILABLE_WARNING] };
  if (!isSerializedSyncSettingsSnapshot(expectedSyncSettingsSnapshot))
    return { success: false, warnings: [DERIVED_HTML_WRITE_WARNING] };

  let artifact;
  try {
    artifact = await (dependencies.prepare ?? prepareDerivedHtmlArtifact)(context, assetBindings);
  } catch {
    return { success: false, warnings: [DERIVED_HTML_PREPARATION_WARNING] };
  }

  const message: DerivedHtmlMessage = {
    action: 'persistDerivedHtmlPresentation',
    reportDurableWriteOutcome: true,
    source: context.source,
    captureId: context.captureId,
    conversationKey: context.conversationKey,
    expectedSyncSettingsSnapshot,
    artifact,
    outputs: ['file'],
  };
  if (jsonUtf8ByteLength(message) > MAX_EXTENSION_MESSAGE_SIZE)
    return { success: false, warnings: [DERIVED_HTML_WRITE_WARNING] };

  try {
    const response = validatedResponse(
      await (dependencies.send ?? ((request: DerivedHtmlMessage) => sendMessage(request)))(message)
    );
    return response
      ? responseResult(response)
      : { success: false, warnings: [DERIVED_HTML_WRITE_WARNING] };
  } catch {
    return { success: false, warnings: [DERIVED_HTML_WRITE_WARNING] };
  }
}
