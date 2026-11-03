/** Destination-honest opt-in text delivery after the File archive trio succeeds. */
import { jsonUtf8ByteLength } from '../lib/byte-size';
import { MAX_EXTENSION_MESSAGE_SIZE } from '../lib/constants';
import { sendMessage } from '../lib/messaging';
import { isSerializedSyncSettingsSnapshot } from '../lib/sync-settings-snapshot';
import type {
  DurableMultiOutputResponse,
  ExtensionMessage,
  StructuredPresentationContext,
} from '../lib/types';
import { prepareDerivedTextArtifact } from './derived-text-presentation';

export const DERIVED_TEXT_UNAVAILABLE_WARNING =
  'Canonical plain text was not created because a verified structured presentation was unavailable.';
export const DERIVED_TEXT_PREPARATION_WARNING =
  'Canonical plain text was not created because its canonical source could not be verified.';
export const DERIVED_TEXT_WRITE_WARNING = 'Canonical plain text was not saved to File.';
export const DERIVED_TEXT_PARTIAL_RECEIPT_WARNING =
  'Canonical plain text may have been saved, but its receipt was not confirmed; no retry was attempted.';
export const DERIVED_TEXT_UNKNOWN_DELIVERY_WARNING =
  'Canonical plain text may have been saved, but terminal confirmation was unavailable; no retry was attempted.';
export const DERIVED_TEXT_CLEANUP_WARNING =
  'Canonical plain text was saved, but temporary artifact cleanup was not confirmed.';
export const DERIVED_TEXT_ALL_BRANCHES_PENDING_WARNING =
  'Canonical plain text is not available for all-branches bundles; export current or one selected branch instead.';

type DerivedTextMessage = Extract<ExtensionMessage, { action: 'persistDerivedTextPresentation' }>;

export interface DerivedTextPersistenceDependencies {
  prepare?: typeof prepareDerivedTextArtifact;
  send?: (message: DerivedTextMessage) => Promise<unknown>;
}

export interface DerivedTextPersistenceResult {
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

function validatedResponse(value: unknown): DurableMultiOutputResponse | undefined {
  const response = plainRecord(value);
  if (!response || !Array.isArray(response.results) || response.results.length !== 1)
    return undefined;
  const result = plainRecord(response.results[0]);
  if (
    !result ||
    result.destination !== 'file' ||
    typeof result.success !== 'boolean' ||
    (result.error !== undefined && typeof result.error !== 'string') ||
    (result.warning !== undefined && typeof result.warning !== 'string') ||
    !validWriteOutcome(result.writeOutcome, result.success) ||
    response.allSuccessful !== result.success ||
    response.anySuccessful !== result.success
  )
    return undefined;
  return value as DurableMultiOutputResponse;
}

function responseResult(response: DurableMultiOutputResponse): DerivedTextPersistenceResult {
  const result = response.results[0];
  if (result.success)
    return {
      success: true,
      warnings: result.writeOutcome.cleanupDeferred === true ? [DERIVED_TEXT_CLEANUP_WARNING] : [],
    };
  return {
    success: false,
    warnings: [
      result.error === 'derived-text-receipt-unconfirmed'
        ? DERIVED_TEXT_PARTIAL_RECEIPT_WARNING
        : result.writeOutcome.state === 'not-dispatched'
          ? DERIVED_TEXT_WRITE_WARNING
          : DERIVED_TEXT_UNKNOWN_DELIVERY_WARNING,
    ],
  };
}

/** Presentation failure remains local and never changes archive/Markdown success. */
export async function persistDerivedTextForFile(
  context: StructuredPresentationContext | undefined,
  expectedSyncSettingsSnapshot: string,
  dependencies: DerivedTextPersistenceDependencies = {}
): Promise<DerivedTextPersistenceResult> {
  if (!context) return { success: false, warnings: [DERIVED_TEXT_UNAVAILABLE_WARNING] };
  if (!isSerializedSyncSettingsSnapshot(expectedSyncSettingsSnapshot))
    return { success: false, warnings: [DERIVED_TEXT_WRITE_WARNING] };
  let artifact;
  try {
    artifact = await (dependencies.prepare ?? prepareDerivedTextArtifact)(context);
  } catch {
    return { success: false, warnings: [DERIVED_TEXT_PREPARATION_WARNING] };
  }
  const message: DerivedTextMessage = {
    action: 'persistDerivedTextPresentation',
    reportDurableWriteOutcome: true,
    source: context.source,
    captureId: context.captureId,
    conversationKey: context.conversationKey,
    expectedSyncSettingsSnapshot,
    artifact,
    outputs: ['file'],
  };
  if (jsonUtf8ByteLength(message) > MAX_EXTENSION_MESSAGE_SIZE)
    return { success: false, warnings: [DERIVED_TEXT_WRITE_WARNING] };
  try {
    const response = validatedResponse(
      await (dependencies.send ?? ((request: DerivedTextMessage) => sendMessage(request)))(message)
    );
    return response
      ? responseResult(response)
      : { success: false, warnings: [DERIVED_TEXT_UNKNOWN_DELIVERY_WARNING] };
  } catch {
    return { success: false, warnings: [DERIVED_TEXT_UNKNOWN_DELIVERY_WARNING] };
  }
}
