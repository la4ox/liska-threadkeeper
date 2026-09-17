/**
 * Credential-free boundary for the post-persistence ChatGPT resolver observer.
 *
 * The MAIN-world hook may temporarily retain a page Request clone and a
 * resolver JSON clone.  Neither object crosses this contract.  Background
 * validates the bounded resolver clones and emits only opaque keys plus signed
 * download URLs for one in-memory acquisition pass.
 */

import {
  CHATGPT_TRANSIENT_ASSET_RESOLVERS_MAX_COUNT,
  isChatGptConversationId,
  isChatGptTransientAssetResolver,
  type ChatGptTransientAssetResolver,
} from './chatgpt-capture-contract';
import { canonicalBase64ByteLength } from './base64';

export const CHATGPT_OPAQUE_RESOLVER_ERROR_CODES = [
  'invalid-conversation-id',
  'permission-unavailable',
  'nonce-invalid',
  'temporary-tab-create-failed',
  'temporary-tab-missing-id',
  'unexpected-origin',
  'unexpected-path',
  'temporary-tab-ready-timeout',
  'observer-result-timeout',
  'hook-state-failed',
  'target-not-observed',
  'source-not-eligible',
  'source-rejected',
  'source-http-error',
  'source-non-json',
  'observer-result-invalid',
] as const;

export type ChatGptOpaqueResolverErrorCode = (typeof CHATGPT_OPAQUE_RESOLVER_ERROR_CODES)[number];

/** Raw page observation: accepted only between MAIN world and background. */
export interface ChatGptOpaqueResolverObservation {
  providerFileId: string;
  bodyBase64: string;
  byteLength: number;
  sha256: string;
  mediaType: string;
}

export type ChatGptOpaqueResolverHookResult =
  | { kind: 'ready' }
  | {
      kind: 'observed';
      conversationId: string;
      resolverObservations: ChatGptOpaqueResolverObservation[];
      singularDispatchCount: 0;
    }
  | { kind: 'error'; code: ChatGptOpaqueResolverErrorCode; singularDispatchCount: 0 };

export type ChatGptOpaqueResolverResponse =
  | { success: true; data: { transientAssetResolvers: ChatGptTransientAssetResolver[] } }
  | { success: false; code: ChatGptOpaqueResolverErrorCode; singularDispatchCount: 0 };

function hasExactOwnKeys(value: object, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    expected.every(expectedKey => keys.some(key => key === expectedKey))
  );
}

function isJsonMediaType(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) return false;
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) <= 0x1f) return false;
  }
  const essence = value.split(';', 1)[0]?.trim().toLowerCase();
  return essence === 'application/json' || essence?.endsWith('+json') === true;
}

export function isChatGptOpaqueResolverObservation(
  value: unknown
): value is ChatGptOpaqueResolverObservation {
  if (typeof value !== 'object' || value === null) return false;
  if (
    !hasExactOwnKeys(value, ['providerFileId', 'bodyBase64', 'byteLength', 'sha256', 'mediaType'])
  ) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.providerFileId === 'string' &&
    /^[A-Za-z0-9_-]{1,256}$/.test(record.providerFileId) &&
    typeof record.bodyBase64 === 'string' &&
    Number.isSafeInteger(record.byteLength) &&
    (record.byteLength as number) >= 0 &&
    (record.byteLength as number) <= 64 * 1024 &&
    canonicalBase64ByteLength(record.bodyBase64) === record.byteLength &&
    typeof record.sha256 === 'string' &&
    /^[a-f0-9]{64}$/i.test(record.sha256) &&
    isJsonMediaType(record.mediaType)
  );
}

export function isChatGptOpaqueResolverHookResult(
  value: unknown
): value is ChatGptOpaqueResolverHookResult {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.kind === 'ready') return hasExactOwnKeys(value, ['kind']);
  if (record.kind === 'error') {
    return (
      hasExactOwnKeys(value, ['kind', 'code', 'singularDispatchCount']) &&
      typeof record.code === 'string' &&
      (CHATGPT_OPAQUE_RESOLVER_ERROR_CODES as readonly string[]).includes(record.code) &&
      record.singularDispatchCount === 0
    );
  }
  return (
    record.kind === 'observed' &&
    hasExactOwnKeys(value, [
      'kind',
      'conversationId',
      'resolverObservations',
      'singularDispatchCount',
    ]) &&
    isChatGptConversationId(record.conversationId) &&
    Array.isArray(record.resolverObservations) &&
    record.resolverObservations.length <= CHATGPT_TRANSIENT_ASSET_RESOLVERS_MAX_COUNT &&
    record.resolverObservations.every(isChatGptOpaqueResolverObservation) &&
    record.singularDispatchCount === 0
  );
}

function isResolvers(value: unknown): value is ChatGptTransientAssetResolver[] {
  return (
    Array.isArray(value) &&
    value.length <= CHATGPT_TRANSIENT_ASSET_RESOLVERS_MAX_COUNT &&
    value.every(isChatGptTransientAssetResolver) &&
    new Set(value.map(resolver => resolver.resolverKey)).size === value.length
  );
}

export function createChatGptOpaqueResolverFailure(
  code: ChatGptOpaqueResolverErrorCode
): ChatGptOpaqueResolverResponse {
  return { success: false, code, singularDispatchCount: 0 };
}

export function isChatGptOpaqueResolverResponse(
  value: unknown
): value is ChatGptOpaqueResolverResponse {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.success === true) {
    return (
      hasExactOwnKeys(value, ['success', 'data']) &&
      typeof record.data === 'object' &&
      record.data !== null &&
      hasExactOwnKeys(record.data, ['transientAssetResolvers']) &&
      isResolvers((record.data as Record<string, unknown>).transientAssetResolvers)
    );
  }
  return (
    record.success === false &&
    hasExactOwnKeys(value, ['success', 'code', 'singularDispatchCount']) &&
    typeof record.code === 'string' &&
    (CHATGPT_OPAQUE_RESOLVER_ERROR_CODES as readonly string[]).includes(record.code) &&
    record.singularDispatchCount === 0
  );
}
