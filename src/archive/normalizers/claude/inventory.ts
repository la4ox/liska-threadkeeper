import type { CaptureCompletenessState, RawCaptureAssetRecord } from '../../capture';
import { binaryAssetExtension } from '../../../shared/binary-asset-descriptor';
import {
  providerBlockWorkBudget,
  type ProviderBlockTraversalBudget,
  type ProviderBlockWorkBudget,
} from '../provider-block-work-budget';
import type { ClaudeRecord } from './contracts';
import { fail } from './contracts';
import { at, identifier, isRecord } from './privacy';

export interface ClaudeAssetInventoryInput {
  raw: unknown;
  artifactId: string;
  sha256: (bytes: Uint8Array) => Promise<string>;
  contentBudget?: ProviderBlockWorkBudget;
}

export interface ClaudeAssetMetadata {
  pointer: string;
  value: ClaudeRecord;
}

export interface ClaudeInventoriedAsset {
  record: RawCaptureAssetRecord;
  metadata: ClaudeAssetMetadata[];
}

export interface ClaudeAssetInventory {
  assets: RawCaptureAssetRecord[];
  completeness: 'not-attempted';
  warnings: string[];
  /** Runtime metadata is never placed in the capture manifest. */
  discovered: ClaudeInventoriedAsset[];
}

const ASSET_TYPES = new Set(['image', 'document', 'attachment']);
const LOWERCASE_UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const SIZE_FIELDS = ['size_bytes', 'file_size', 'size', 'byte_length'] as const;

export const CLAUDE_ASSET_DETAIL = Object.freeze({
  fetched: 'claude-original-contents',
  fetchFailed: 'claude-contents-fetch-failed',
  httpFailed: 'claude-contents-http-failed',
  responseRejected: 'claude-contents-response-rejected',
  sizeMismatch: 'claude-declared-size-mismatch',
  timeout: 'claude-contents-timeout',
  duplicatePath: 'claude-duplicate-content-path',
  destinationFailed: 'claude-destination-write-failed',
});

/** Completeness is attempt coverage; per-file states still distinguish failures. */
export function claudeAssetAttemptCompleteness(
  assets: readonly RawCaptureAssetRecord[]
): CaptureCompletenessState {
  if (assets.every(asset => asset.state === 'not-attempted')) return 'not-attempted';
  return assets.every(asset => asset.state !== 'not-attempted') ? 'complete' : 'partial';
}

export function isClaudeAssetUuid(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 && LOWERCASE_UUID.test(value);
}

export function safeClaudeAssetMediaType(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 255) return undefined;
  const mediaType = value.split(';', 1)[0].trim().toLowerCase();
  return /^[\w.+-]+\/[\w.+-]+$/.test(mediaType) && binaryAssetExtension(mediaType) !== undefined
    ? mediaType
    : undefined;
}

function exactSize(value: ClaudeRecord): number | undefined {
  let size: number | undefined;
  for (const field of SIZE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    const candidate = value[field];
    if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 0)
      return undefined;
    if (size !== undefined && candidate !== size) return undefined;
    size = candidate;
  }
  return size;
}

export interface ClaudeOrdinaryFile {
  fileUuid: string;
  byteLength: number;
  mediaType?: string;
}

/** Only ordinary message files are observed on the original-contents route. */
export function readClaudeOrdinaryFile(
  value: unknown,
  pointer: string
): ClaudeOrdinaryFile | undefined {
  if (!/^\/chat_messages\/(?:0|[1-9]\d*)\/files\/(?:0|[1-9]\d*)$/.test(pointer)) {
    return undefined;
  }
  if (!isRecord(value) || !isClaudeAssetUuid(value.file_uuid) || value.success !== true) {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'uuid') && value.uuid !== value.file_uuid)
    return undefined;
  if (durableId(value) !== value.file_uuid) return undefined;
  const byteLength = exactSize(value);
  if (byteLength === undefined) return undefined;
  const declaredTypes = new Set(
    [value.content_type, value.mime_type, value.media_type].flatMap(item => {
      const mediaType = safeClaudeAssetMediaType(item);
      return mediaType ? [mediaType] : [];
    })
  );
  const mediaType = declaredTypes.size === 1 ? [...declaredTypes][0] : undefined;
  return { fileUuid: value.file_uuid, byteLength, ...(mediaType && { mediaType }) };
}

/** All exact references must agree on the original file and declared length. */
export function bindClaudeOrdinaryFiles(
  metadata: Iterable<{ readonly pointer: string; readonly value: unknown }>
): ClaudeOrdinaryFile | undefined {
  let binding: ClaudeOrdinaryFile | undefined;
  const mediaTypes = new Set<string>();
  for (const { pointer, value } of metadata) {
    const file = readClaudeOrdinaryFile(value, pointer);
    if (
      !file ||
      (binding && (file.fileUuid !== binding.fileUuid || file.byteLength !== binding.byteLength))
    ) {
      return undefined;
    }
    binding ??= file;
    if (file.mediaType) mediaTypes.add(file.mediaType);
  }
  if (!binding) return undefined;
  const { fileUuid, byteLength } = binding;
  const mediaType = mediaTypes.size === 1 ? [...mediaTypes][0] : undefined;
  return { fileUuid, byteLength, ...(mediaType && { mediaType }) };
}

export function claudeOrdinaryFileAssetId(
  fileUuid: string,
  sha256: ClaudeAssetInventoryInput['sha256']
): Promise<string> {
  return hashAssetKey(JSON.stringify(['provider', fileUuid]), sha256);
}

async function hashAssetKey(
  key: string,
  sha256: ClaudeAssetInventoryInput['sha256']
): Promise<string> {
  const digest = await sha256(new TextEncoder().encode(`liska.claude.asset-id/v1\u0000${key}`));
  if (!/^[a-f0-9]{64}$/.test(digest))
    fail('asset-inventory-failed', 'Claude asset identity hashing failed.');
  return `claude-asset-${digest}`;
}

/** Only exact durable provider IDs coalesce. Missing/ambiguous identity stays pointer-local. */
export async function inventoryClaudeRawAssets(
  input: ClaudeAssetInventoryInput,
  traversal?: ProviderBlockTraversalBudget
): Promise<ClaudeAssetInventory> {
  const budget =
    traversal ?? providerBlockWorkBudget('claude', input?.contentBudget).beginTraversal();
  identifier(input.artifactId, 'artifactId');
  const candidates = discover(input.raw, budget);
  const groups = new Map<string, ClaudeAssetMetadata[]>();
  for (const candidate of candidates) {
    budget.spendWork();
    const providerId = durableId(candidate.value);
    const key =
      providerId === null
        ? JSON.stringify(['pointer', input.artifactId, candidate.pointer])
        : JSON.stringify(['provider', providerId]);
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  const discovered: ClaudeInventoriedAsset[] = [];
  for (const [key, metadata] of groups) {
    budget.spendWork(metadata.length + 1);
    discovered.push({
      record: {
        id: await hashAssetKey(key, input.sha256),
        state: 'not-attempted',
        attemptedAt: null,
        relativePath: null,
        mediaType: null,
        byteLength: null,
        sha256: null,
        detail: 'metadata-only',
        sourceRefs: metadata
          .map(item => ({ artifactId: input.artifactId, rawPointer: item.pointer }))
          .sort((a, b) => compare(a.rawPointer, b.rawPointer)),
      },
      metadata,
    });
  }
  discovered.sort((a, b) => compare(a.record.id, b.record.id));
  if (new Set(discovered.map(item => item.record.id)).size !== discovered.length)
    fail('asset-inventory-failed', 'Claude asset identities are ambiguous.');
  return {
    assets: discovered.map(item => item.record),
    completeness: 'not-attempted',
    warnings: [],
    discovered,
  };
}

function discover(raw: unknown, budget: ProviderBlockTraversalBudget): ClaudeAssetMetadata[] {
  if (!isRecord(raw) || !Array.isArray(raw.chat_messages)) return [];
  const candidates: ClaudeAssetMetadata[] = [];
  const seen = new Set<string>();
  function add(value: unknown, pointer: string): void {
    budget.spendWork();
    if (!isRecord(value) || seen.has(pointer)) return;
    if (candidates.length >= 50_000)
      fail(
        'asset-inventory-limit-exceeded',
        'Claude asset inventory exceeds its metadata record limit.'
      );
    seen.add(pointer);
    candidates.push({ value, pointer });
  }
  function walkContent(value: unknown, pointer: string, depth: number): void {
    if (!Array.isArray(value)) return;
    if (depth >= 16)
      fail('content-depth-limit-exceeded', 'Claude content nesting exceeds its inventory limit.');
    budget.admitOccurrences(value.length);
    value.forEach((block, index) => {
      if (!isRecord(block)) return;
      const blockPointer = at(pointer, String(index));
      if (typeof block.type === 'string' && ASSET_TYPES.has(block.type)) add(block, blockPointer);
      for (const field of ['attachments', 'files']) {
        const entries = block[field];
        if (Array.isArray(entries)) {
          budget.admitOccurrences(entries.length);
          entries.forEach((item, i) => add(item, at(blockPointer, field, String(i))));
        }
      }
      walkContent(block.content, at(blockPointer, 'content'), depth + 1);
    });
  }
  budget.admitOccurrences(raw.chat_messages.length);
  raw.chat_messages.forEach((message, index) => {
    if (!isRecord(message)) return;
    const pointer = at('/chat_messages', String(index));
    for (const field of ['attachments', 'files']) {
      const entries = message[field];
      if (Array.isArray(entries)) {
        budget.admitOccurrences(entries.length);
        entries.forEach((item, i) => add(item, at(pointer, field, String(i))));
      }
    }
    walkContent(message.content, at(pointer, 'content'), 0);
  });
  return candidates;
}

function durableId(value: ClaudeRecord): string | null {
  const ids = ['uuid', 'id', 'file_uuid', 'file_id', 'attachment_id'].flatMap(field =>
    value[field] === undefined || value[field] === null ? [] : [value[field]]
  );
  if (
    !ids.length ||
    ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/.test(id))
  )
    return null;
  return new Set(ids).size === 1 ? (ids[0] as string) : null;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
