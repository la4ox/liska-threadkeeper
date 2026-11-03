import type { RawCaptureAssetRecord } from '../../capture';
import type { JsonValue } from '../../types';
import {
  providerBlockWorkBudget,
  rethrowProviderContentLimit,
  type ProviderBlockTraversalBudget,
  type ProviderBlockWorkBudget,
} from '../provider-block-work-budget';
import type { DeepSeekJsonRecord } from './contracts';
import { hasOwn, isPlainRecord, pointerAt } from './privacy';

/** Stable, content-free evidence when provider attachment metadata is ambiguous. */
export const DEEPSEEK_ATTACHMENT_INVENTORY_WARNING = 'deepseek-attachment-inventory-unavailable';
export const DEEPSEEK_ATTACHMENT_INVENTORY_DETAIL = 'metadata-only';

const ATTACHMENT_ID_DOMAIN = 'liska.deepseek.attachment-id/v1\u0000';
const MAX_DISCOVERED_FILES = 50_000;
const ATTACHMENT_HASH_BATCH_SIZE = 32;
const FILE_METADATA_FIELDS = [
  'file_name',
  'file_size',
  'audit_result',
  'from_share',
  'inserted_at',
  'is_image',
  'model_kind',
  'updated_at',
  'status',
  'error_code',
  'previewable',
  'token_usage',
] as const;
const ASSET_EXTENSION_FIELDS = [
  'audit_result',
  'from_share',
  'inserted_at',
  'is_image',
  'model_kind',
  'updated_at',
  'status',
  'error_code',
  'previewable',
  'token_usage',
] as const;

export interface DeepSeekAssetInventoryInput {
  /** Parsed exact bytes from the one integrity-verified raw JSON artifact. */
  raw: unknown;
  artifactId: string;
  /** Injected so inventory remains pure and independent of browser/Node crypto APIs. */
  sha256: (bytes: Uint8Array) => Promise<string>;
  contentBudget?: ProviderBlockWorkBudget;
}

export interface DeepSeekAssetInventory {
  assets: RawCaptureAssetRecord[];
  completeness: 'not-attempted' | 'unknown';
  warnings: string[];
  /** Runtime-only values removed from degraded canonical metadata wherever repeated. */
  providerIds: string[];
}

export interface DeepSeekRawFileRecord {
  providerId: string;
  filename: string | null;
  byteLength: number | null;
  /** Provider metadata deliberately retained only in canonical DeepSeek extensions. */
  extensionMetadata: Record<string, JsonValue>;
  /** Stable comparison value; never written to a manifest or canonical archive. */
  metadataKey: string;
}

interface Candidate extends DeepSeekRawFileRecord {
  sourceRef: { artifactId: string; rawPointer: string };
}

interface DiscoveredFile extends DeepSeekRawFileRecord {
  sourceRefs: Array<{ artifactId: string; rawPointer: string }>;
  sourceRefKeys: Set<string>;
}

/**
 * Inventory DeepSeek's in-band `files` metadata only. It never follows a URL,
 * guesses a resolver, reads binary bytes, or writes a provider identifier into
 * a manifest ID or path.
 */
export async function inventoryDeepSeekRawAssets(
  input: DeepSeekAssetInventoryInput,
  traversal?: ProviderBlockTraversalBudget
): Promise<DeepSeekAssetInventory> {
  const budget =
    traversal ?? providerBlockWorkBudget('deepseek', input?.contentBudget).beginTraversal();
  const providerIds = collectPotentialProviderIds(input?.raw, budget);
  try {
    if (!isInventoryInput(input)) throw new Error();
    const discovered = deduplicateCandidates(
      collectCandidates(input.raw, input.artifactId, budget),
      budget
    );
    const assets = await recordsForDiscoveredFiles(discovered, input.sha256, budget);
    return { assets, completeness: 'not-attempted', warnings: [], providerIds };
  } catch (error) {
    rethrowProviderContentLimit(error);
    return {
      assets: [],
      completeness: 'unknown',
      warnings: [DEEPSEEK_ATTACHMENT_INVENTORY_WARNING],
      providerIds,
    };
  }
}

function collectPotentialProviderIds(raw: unknown, budget: ProviderBlockTraversalBudget): string[] {
  const collected = new Set<string>();
  try {
    const messages = messagesFromRaw(raw);
    budget.admitOccurrences(messages.length);
    for (const message of messages) {
      if (!isPlainRecord(message)) continue;
      for (const files of potentialFileArrays(message, budget)) {
        budget.admitOccurrences(files.length);
        for (const file of files) addPotentialProviderId(file, collected);
      }
    }
  } catch (error) {
    rethrowProviderContentLimit(error);
    // Best-effort privacy inventory must never replace the stable degraded result.
  }
  budget.spendWork(collected.size);
  return [...collected].sort(compareStrings);
}

function potentialFileArrays(
  message: DeepSeekJsonRecord,
  budget: ProviderBlockTraversalBudget
): unknown[][] {
  const arrays: unknown[][] = [];
  if (Array.isArray(message.files)) arrays.push(message.files);
  if (!Array.isArray(message.fragments)) return arrays;
  budget.admitOccurrences(message.fragments.length);
  for (const fragment of message.fragments) {
    if (
      isPlainRecord(fragment) &&
      typeof fragment.type === 'string' &&
      fragment.type.trim().toUpperCase() === 'FILE' &&
      Array.isArray(fragment.files)
    ) {
      arrays.push(fragment.files);
    }
  }
  return arrays;
}

function addPotentialProviderId(file: unknown, collected: Set<string>): void {
  if (!isPlainRecord(file) || typeof file.id !== 'string') return;
  if (
    file.id.length > 0 &&
    file.id.length <= 4_096 &&
    !Array.from(file.id).some(character => (character.codePointAt(0) ?? 0) <= 0x1f)
  ) {
    collected.add(file.id);
  }
}

/** Parse one provider file record without persisting the provider ID as metadata. */
export function readDeepSeekRawFileRecord(
  value: unknown,
  traversal?: ProviderBlockTraversalBudget
): DeepSeekRawFileRecord {
  const budget = traversal ?? providerBlockWorkBudget('deepseek').beginTraversal();
  if (!isPlainRecord(value)) throw new Error();
  const providerId = safeProviderId(value.id);
  const filename = nullableString(value, 'file_name');
  const byteLength = nullableByteLength(value, 'file_size');
  const metadata: Record<string, JsonValue> = {};
  const comparison: Record<string, JsonValue | null> = {};

  for (const field of FILE_METADATA_FIELDS) {
    const fieldValue = nullableJsonValue(value, field, budget);
    comparison[field] = fieldValue;
    if (ASSET_EXTENSION_FIELDS.includes(field as (typeof ASSET_EXTENSION_FIELDS)[number])) {
      metadata[field] = fieldValue;
    }
  }

  spendJsonSerializationWork(comparison, budget);
  return {
    providerId,
    filename,
    byteLength,
    extensionMetadata: metadata,
    metadataKey: JSON.stringify(comparison),
  };
}

function isInventoryInput(value: unknown): value is DeepSeekAssetInventoryInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { artifactId?: unknown }).artifactId === 'string' &&
    safeArtifactId((value as { artifactId: string }).artifactId) &&
    typeof (value as { sha256?: unknown }).sha256 === 'function'
  );
}

function safeArtifactId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

function collectCandidates(
  raw: unknown,
  artifactId: string,
  budget: ProviderBlockTraversalBudget
): Candidate[] {
  const messages = messagesFromRaw(raw);
  const candidates: Candidate[] = [];
  budget.admitOccurrences(messages.length);
  messages.forEach((message, messageIndex) => {
    if (!isPlainRecord(message)) throw new Error();
    const messagePointer = pointerAt('/data/biz_data/chat_messages', String(messageIndex));
    if (hasOwn(message, 'files')) {
      if (!Array.isArray(message.files)) throw new Error();
      collectFileCandidates(
        message.files,
        pointerAt(messagePointer, 'files'),
        artifactId,
        candidates,
        budget
      );
    }
    if (!hasOwn(message, 'fragments')) return;
    if (!Array.isArray(message.fragments)) throw new Error();
    budget.admitOccurrences(message.fragments.length);
    message.fragments.forEach((fragment, fragmentIndex) => {
      if (!isPlainRecord(fragment) || typeof fragment.type !== 'string') return;
      if (fragment.type.trim().toUpperCase() !== 'FILE') return;
      if (!hasOwn(fragment, 'files') || !Array.isArray(fragment.files)) throw new Error();
      collectFileCandidates(
        fragment.files,
        pointerAt(messagePointer, 'fragments', String(fragmentIndex), 'files'),
        artifactId,
        candidates,
        budget
      );
    });
  });
  return candidates;
}

function collectFileCandidates(
  files: unknown[],
  pointer: string,
  artifactId: string,
  candidates: Candidate[],
  budget: ProviderBlockTraversalBudget
): void {
  budget.admitOccurrences(files.length);
  files.forEach((file, fileIndex) => {
    if (candidates.length >= MAX_DISCOVERED_FILES) throw new Error();
    const rawPointer = pointerAt(pointer, String(fileIndex));
    candidates.push({
      ...readDeepSeekRawFileRecord(file, budget),
      sourceRef: { artifactId, rawPointer },
    });
  });
}

function messagesFromRaw(raw: unknown): unknown[] {
  if (!isPlainRecord(raw) || !isPlainRecord(raw.data) || !isPlainRecord(raw.data.biz_data)) {
    throw new Error();
  }
  const messages = raw.data.biz_data.chat_messages;
  if (!Array.isArray(messages)) throw new Error();
  return messages;
}

function deduplicateCandidates(
  candidates: Candidate[],
  budget: ProviderBlockTraversalBudget
): DiscoveredFile[] {
  const discovered = new Map<string, DiscoveredFile>();
  for (const candidate of candidates) {
    budget.spendWork();
    const existing = discovered.get(candidate.providerId);
    if (!existing) {
      discovered.set(candidate.providerId, {
        providerId: candidate.providerId,
        filename: candidate.filename,
        byteLength: candidate.byteLength,
        extensionMetadata: candidate.extensionMetadata,
        metadataKey: candidate.metadataKey,
        sourceRefs: [candidate.sourceRef],
        sourceRefKeys: new Set([sourceRefKey(candidate.sourceRef)]),
      });
      continue;
    }
    if (existing.metadataKey !== candidate.metadataKey) throw new Error();
    const key = sourceRefKey(candidate.sourceRef);
    if (!existing.sourceRefKeys.has(key)) {
      existing.sourceRefs.push(candidate.sourceRef);
      existing.sourceRefKeys.add(key);
    }
  }
  budget.spendWork(discovered.size);
  return [...discovered.values()].sort((left, right) =>
    compareStrings(left.providerId, right.providerId)
  );
}

async function recordsForDiscoveredFiles(
  files: DiscoveredFile[],
  sha256: DeepSeekAssetInventoryInput['sha256'],
  budget: ProviderBlockTraversalBudget
): Promise<RawCaptureAssetRecord[]> {
  const records: RawCaptureAssetRecord[] = [];
  for (let offset = 0; offset < files.length; offset += ATTACHMENT_HASH_BATCH_SIZE) {
    const batch = files.slice(offset, offset + ATTACHMENT_HASH_BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async file => ({
        id: await deepSeekAttachmentIdForProviderId(file.providerId, sha256),
        state: 'not-attempted' as const,
        attemptedAt: null,
        relativePath: null,
        mediaType: null,
        byteLength: null,
        sha256: null,
        detail: DEEPSEEK_ATTACHMENT_INVENTORY_DETAIL,
        sourceRefs: [...file.sourceRefs].sort(compareSourceRefs),
      }))
    );
    for (const result of settled) {
      budget.spendWork();
      if (result.status === 'rejected') throw result.reason;
      records.push(result.value);
    }
  }
  if (new Set(records.map(record => record.id)).size !== records.length) throw new Error();
  return records.sort((left, right) => compareStrings(left.id, right.id));
}

/** Domain-separated canonical ID; the provider ID never appears in its value. */
export async function deepSeekAttachmentIdForProviderId(
  providerId: string,
  sha256: DeepSeekAssetInventoryInput['sha256']
): Promise<string> {
  if (!safeProviderId(providerId) || typeof sha256 !== 'function') throw new Error();
  const digest = await sha256(new TextEncoder().encode(`${ATTACHMENT_ID_DOMAIN}${providerId}`));
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error();
  return `deepseek-asset-${digest}`;
}

function safeProviderId(value: unknown): string {
  if (typeof value !== 'string') throw new Error();
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value) ||
    ['__proto__', 'constructor', 'prototype'].includes(value)
  ) {
    throw new Error();
  }
  return value;
}

function nullableString(record: Record<string, unknown>, field: string): string | null {
  if (!hasOwn(record, field) || record[field] === null) return null;
  if (typeof record[field] !== 'string') throw new Error();
  return record[field];
}

function nullableByteLength(record: Record<string, unknown>, field: string): number | null {
  if (!hasOwn(record, field) || record[field] === null) return null;
  const value = record[field];
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error();
  return value as number;
}

function nullableJsonValue(
  record: Record<string, unknown>,
  field: string,
  budget: ProviderBlockTraversalBudget
): JsonValue | null {
  if (!hasOwn(record, field) || record[field] === null) return null;
  if (!isJsonValue(record[field], budget)) throw new Error();
  return record[field];
}

function isJsonValue(
  value: unknown,
  budget: ProviderBlockTraversalBudget,
  depth = 0
): value is JsonValue {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') {
    budget.spendWork(Math.max(1, Math.ceil(value.length / 1_024)));
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth >= 16) return false;
  if (Array.isArray(value)) {
    budget.spendWork(value.length);
    return value.every(entry => isJsonValue(entry, budget, depth + 1));
  }
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  budget.spendWork(keys.length);
  return keys.every(
    key =>
      !['__proto__', 'constructor', 'prototype'].includes(key) &&
      isJsonValue(value[key], budget, depth + 1)
  );
}

/** Meter JSON.stringify's second walk without changing the accepted provider depth contract. */
function spendJsonSerializationWork(value: JsonValue, budget: ProviderBlockTraversalBudget): void {
  if (typeof value === 'string') {
    budget.spendWork(Math.max(1, Math.ceil(value.length / 1_024)));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    budget.spendWork(value.length);
    value.forEach(entry => spendJsonSerializationWork(entry, budget));
    return;
  }
  const keys = Object.keys(value);
  budget.spendWork(keys.length);
  keys.forEach(key => spendJsonSerializationWork(value[key], budget));
}

function sourceRefKey(sourceRef: Candidate['sourceRef']): string {
  return `${sourceRef.artifactId}\u0000${sourceRef.rawPointer}`;
}

function compareSourceRefs(
  left: RawCaptureAssetRecord['sourceRefs'][number],
  right: RawCaptureAssetRecord['sourceRefs'][number]
): number {
  const byArtifact = compareStrings(left.artifactId, right.artifactId);
  return byArtifact === 0 ? compareStrings(left.rawPointer, right.rawPointer) : byArtifact;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
