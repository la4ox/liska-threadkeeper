/**
 * Strict transient boundary for ChatGPT interpreter download resolution.
 * Candidate metadata exists only for the one foreground-tab request and is
 * never published by the MAIN-world hook. The response contains only a
 * deterministic subset of the caller's asset IDs and validated estuary URLs.
 */

import { canonicalBase64ByteLength } from './base64';
import { isChatGptConversationId, isChatGptTransientDownloadUrl } from './chatgpt-capture-contract';
import { isSafeStagedBinaryAssetId } from './binary-asset-contract';
import {
  isChatGptInterpreterMessageId,
  isChatGptInterpreterSandboxPath,
} from './chatgpt-interpreter-values';

export {
  isChatGptInterpreterMessageId,
  isChatGptInterpreterSandboxPath,
} from './chatgpt-interpreter-values';

export const CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT = 20;
export const CHATGPT_INTERPRETER_RESOLVER_MAX_BYTES = 64 * 1024;

export const CHATGPT_INTERPRETER_RESOLVER_ERROR_CODES = [
  'invalid-conversation-id',
  'invalid-interpreter-candidates',
  'permission-unavailable',
  'nonce-invalid',
  'temporary-tab-create-failed',
  'temporary-tab-missing-id',
  'unexpected-origin',
  'unexpected-path',
  'temporary-tab-ready-timeout',
  'document-id-missing',
  'command-rejected',
  'source-not-eligible',
  'source-rejected',
  'source-http-error',
  'source-non-json',
  'interpreter-result-timeout',
  'interpreter-result-invalid',
] as const;

export type ChatGptInterpreterResolverErrorCode =
  (typeof CHATGPT_INTERPRETER_RESOLVER_ERROR_CODES)[number];

export const CHATGPT_INTERPRETER_RESOLVER_DIAGNOSTIC_CODES = [
  'resolved',
  'http-error',
  'fetch-rejected',
  'response-processing-rejected',
  'non-json',
  'oversized',
  'timed-out',
  'not-dispatched',
  'payload-integrity-rejected',
  'payload-invalid-json',
  'download-url-missing',
  'download-url-binding-rejected',
] as const;

export type ChatGptInterpreterResolverDiagnosticCode =
  (typeof CHATGPT_INTERPRETER_RESOLVER_DIAGNOSTIC_CODES)[number];

export interface ChatGptInterpreterAssetCandidate {
  assetId: string;
  messageId: string;
  sandboxPath: string;
}

export interface ChatGptInterpreterResolvedAsset {
  assetId: string;
  downloadUrl: string;
}

/** Content-safe ordinal result. It intentionally contains no provider detail. */
export interface ChatGptInterpreterResolverDiagnostic {
  assetId: string;
  code: ChatGptInterpreterResolverDiagnosticCode;
  httpStatus?: number;
}

export interface ChatGptInterpreterResolverCapture {
  bodyBase64: string;
  byteLength: number;
  sha256: string;
  mediaType: string;
}

export type ChatGptInterpreterResolverOutcome =
  | { state: 'observed'; capture: ChatGptInterpreterResolverCapture }
  | { state: 'http-error'; httpStatus?: number }
  | {
      state:
        | 'fetch-rejected'
        | 'response-processing-rejected'
        | 'non-json'
        | 'oversized'
        | 'timed-out'
        | 'not-dispatched';
    };

/** MAIN-to-background only: ordinal captures/outcomes, never candidates. */
export type ChatGptInterpreterResolverHookResult =
  | { kind: 'ready' }
  | {
      kind: 'complete';
      conversationId: string;
      requestedCount: number;
      dispatchCount: number;
      outcomes: ChatGptInterpreterResolverOutcome[];
    }
  | { kind: 'error'; code: ChatGptInterpreterResolverErrorCode };

export type ChatGptInterpreterResolverResponse =
  | {
      success: true;
      data: {
        resolved: ChatGptInterpreterResolvedAsset[];
        diagnostics: ChatGptInterpreterResolverDiagnostic[];
      };
    }
  | { success: false; code: ChatGptInterpreterResolverErrorCode };

function hasExactOwnKeys(value: object, expected: readonly string[]): boolean {
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expected.length) return false;
    for (const expectedKey of expected) {
      if (!keys.some(key => key === expectedKey)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, expectedKey);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor))
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isNativeHttpErrorStatus(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    value === value &&
    value !== Infinity &&
    value !== -Infinity &&
    value % 1 === 0 &&
    value >= 100 &&
    value <= 599 &&
    value !== 200
  );
}

export function isChatGptInterpreterAssetCandidate(
  value: unknown
): value is ChatGptInterpreterAssetCandidate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!hasExactOwnKeys(value, ['assetId', 'messageId', 'sandboxPath'])) return false;
  const record = value as Record<string, unknown>;
  return (
    isSafeStagedBinaryAssetId(record.assetId) &&
    isChatGptInterpreterMessageId(record.messageId) &&
    isChatGptInterpreterSandboxPath(record.sandboxPath)
  );
}

export function isChatGptInterpreterCandidates(
  value: unknown
): value is ChatGptInterpreterAssetCandidate[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT
  ) {
    return false;
  }
  const assetIds = new Set<string>();
  const messagePaths = new Set<string>();
  for (const candidate of value) {
    if (!isChatGptInterpreterAssetCandidate(candidate) || assetIds.has(candidate.assetId))
      return false;
    const messagePath = `${candidate.messageId}\0${candidate.sandboxPath}`;
    if (messagePaths.has(messagePath)) return false;
    assetIds.add(candidate.assetId);
    messagePaths.add(messagePath);
  }
  return true;
}

export function isChatGptInterpreterResolverCapture(
  value: unknown
): value is ChatGptInterpreterResolverCapture {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!hasExactOwnKeys(value, ['bodyBase64', 'byteLength', 'sha256', 'mediaType'])) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.bodyBase64 === 'string' &&
    Number.isSafeInteger(record.byteLength) &&
    (record.byteLength as number) >= 0 &&
    (record.byteLength as number) <= CHATGPT_INTERPRETER_RESOLVER_MAX_BYTES &&
    canonicalBase64ByteLength(record.bodyBase64) === record.byteLength &&
    typeof record.sha256 === 'string' &&
    /^[a-f0-9]{64}$/i.test(record.sha256) &&
    typeof record.mediaType === 'string' &&
    record.mediaType.length > 0 &&
    record.mediaType.length <= 255
  );
}

function isOutcome(value: unknown): value is ChatGptInterpreterResolverOutcome {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (hasExactOwnKeys(value, ['state', 'capture'])) {
    return record.state === 'observed' && isChatGptInterpreterResolverCapture(record.capture);
  }
  if (hasExactOwnKeys(value, ['state', 'httpStatus'])) {
    return record.state === 'http-error' && isNativeHttpErrorStatus(record.httpStatus);
  }
  return (
    hasExactOwnKeys(value, ['state']) &&
    typeof record.state === 'string' &&
    [
      'fetch-rejected',
      'response-processing-rejected',
      'non-json',
      'oversized',
      'timed-out',
      'not-dispatched',
      'http-error',
    ].includes(record.state)
  );
}

// eslint-disable-next-line complexity -- Exact untrusted hook-state validation is intentionally linear.
export function isChatGptInterpreterResolverHookResult(
  value: unknown
): value is ChatGptInterpreterResolverHookResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (hasExactOwnKeys(value, ['kind'])) return record.kind === 'ready';
  if (hasExactOwnKeys(value, ['kind', 'code'])) {
    return (
      record.kind === 'error' &&
      typeof record.code === 'string' &&
      (CHATGPT_INTERPRETER_RESOLVER_ERROR_CODES as readonly string[]).includes(record.code)
    );
  }
  if (
    !hasExactOwnKeys(value, [
      'kind',
      'conversationId',
      'requestedCount',
      'dispatchCount',
      'outcomes',
    ]) ||
    record.kind !== 'complete' ||
    !isChatGptConversationId(record.conversationId) ||
    !Number.isSafeInteger(record.requestedCount) ||
    !Number.isSafeInteger(record.dispatchCount) ||
    (record.requestedCount as number) < 0 ||
    (record.requestedCount as number) > CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT ||
    (record.dispatchCount as number) < 0 ||
    (record.dispatchCount as number) > (record.requestedCount as number) ||
    !Array.isArray(record.outcomes) ||
    record.outcomes.length !== record.requestedCount ||
    !record.outcomes.every(isOutcome)
  ) {
    return false;
  }
  return record.outcomes.every((outcome, ordinal) => {
    const state = (outcome as ChatGptInterpreterResolverOutcome).state;
    return ordinal < (record.dispatchCount as number)
      ? state !== 'not-dispatched'
      : state === 'not-dispatched';
  });
}

export function isChatGptInterpreterResolvedAsset(
  value: unknown,
  conversationId?: string
): value is ChatGptInterpreterResolvedAsset {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!hasExactOwnKeys(value, ['assetId', 'downloadUrl'])) return false;
  const record = value as Record<string, unknown>;
  return (
    isSafeStagedBinaryAssetId(record.assetId) &&
    isChatGptTransientDownloadUrl(record.downloadUrl, conversationId)
  );
}

export function isChatGptInterpreterResolverDiagnostic(
  value: unknown
): value is ChatGptInterpreterResolverDiagnostic {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (hasExactOwnKeys(value, ['assetId', 'code'])) {
    return (
      isSafeStagedBinaryAssetId(record.assetId) &&
      typeof record.code === 'string' &&
      (CHATGPT_INTERPRETER_RESOLVER_DIAGNOSTIC_CODES as readonly string[]).includes(record.code)
    );
  }
  return (
    hasExactOwnKeys(value, ['assetId', 'code', 'httpStatus']) &&
    isSafeStagedBinaryAssetId(record.assetId) &&
    record.code === 'http-error' &&
    isNativeHttpErrorStatus(record.httpStatus)
  );
}

export function createChatGptInterpreterResolverFailure(
  code: ChatGptInterpreterResolverErrorCode
): ChatGptInterpreterResolverResponse {
  return { success: false, code };
}

// eslint-disable-next-line complexity, max-lines-per-function -- Exact untrusted response reconciliation is intentionally linear.
export function isChatGptInterpreterResolverResponse(
  value: unknown
): value is ChatGptInterpreterResolverResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (hasExactOwnKeys(value, ['success', 'code'])) {
    return (
      record.success === false &&
      typeof record.code === 'string' &&
      (CHATGPT_INTERPRETER_RESOLVER_ERROR_CODES as readonly string[]).includes(record.code)
    );
  }
  if (
    !hasExactOwnKeys(value, ['success', 'data']) ||
    record.success !== true ||
    typeof record.data !== 'object' ||
    record.data === null ||
    Array.isArray(record.data) ||
    !hasExactOwnKeys(record.data, ['resolved', 'diagnostics'])
  ) {
    return false;
  }
  const data = record.data as Record<string, unknown>;
  const resolved = data.resolved;
  const diagnostics = data.diagnostics;
  if (
    !Array.isArray(resolved) ||
    resolved.length > CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT ||
    !Array.isArray(diagnostics) ||
    diagnostics.length === 0 ||
    diagnostics.length > CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT
  ) {
    return false;
  }
  const resolvedAssetIds = new Set<string>();
  if (
    !resolved.every(asset => {
      if (!isChatGptInterpreterResolvedAsset(asset) || resolvedAssetIds.has(asset.assetId))
        return false;
      resolvedAssetIds.add(asset.assetId);
      return true;
    })
  ) {
    return false;
  }
  const diagnosticAssetIds = new Set<string>();
  const diagnosticResolvedIds: string[] = [];
  for (const diagnostic of diagnostics) {
    if (
      !isChatGptInterpreterResolverDiagnostic(diagnostic) ||
      diagnosticAssetIds.has(diagnostic.assetId)
    ) {
      return false;
    }
    diagnosticAssetIds.add(diagnostic.assetId);
    if (diagnostic.code === 'resolved') diagnosticResolvedIds.push(diagnostic.assetId);
  }
  if (diagnosticResolvedIds.length !== resolved.length) return false;
  for (let index = 0; index < resolved.length; index += 1) {
    if (
      diagnosticResolvedIds[index] !== resolved[index].assetId ||
      !diagnosticAssetIds.has(resolved[index].assetId)
    ) {
      return false;
    }
  }
  return true;
}
