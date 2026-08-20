import type { RawCaptureAssetRecord } from '../../capture';
import type { JsonRecord } from './contracts';
import { hasOwn, isPlainRecord, pointerAt } from './privacy';

/**
 * Safe, content-free evidence used when a verified raw artifact cannot be
 * structurally inventoried. Never include provider exception details here.
 */
export const CHATGPT_ASSET_INVENTORY_WARNING = 'chatgpt-asset-inventory-unavailable';
export const CHATGPT_ASSET_INVENTORY_DETAIL = 'raw-inventory-not-attempted';

const ASSET_TYPES = new Set([
  'attachment',
  'file',
  'file_asset_pointer',
  'image',
  'image_asset_pointer',
  'audio',
  'audio_asset_pointer',
  'video',
  'video_asset_pointer',
]);
const ID_FIELDS = ['asset_id', 'assetId', 'file_id', 'fileId', 'id'];
const KNOWN_MIME_TYPES = new Set([
  'application/json',
  'application/octet-stream',
  'application/pdf',
  'application/rtf',
  'application/zip',
  'application/gzip',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);
const MAX_IDENTITY_LENGTH = 8_192;
const MAX_CONTENT_DEPTH = 64;
const MAX_DISCOVERED_ASSETS = 50_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface ChatGptAssetInventoryInput {
  /** Parsed bytes from an integrity-verified ChatGPT raw artifact. */
  raw: unknown;
  artifactId: string;
  /** Injected to keep the inventory browser/Node neutral and directly testable. */
  sha256: (bytes: Uint8Array) => Promise<string>;
}

export interface ChatGptAssetInventory {
  assets: RawCaptureAssetRecord[];
  /** Discovery succeeded, but this slice never acquires binary bytes. */
  completeness: 'not-attempted' | 'unknown';
  warnings: string[];
}

interface RawEnvelope {
  conversation: JsonRecord;
  basePointer: string;
}

interface Candidate {
  identity: string;
  mediaType: string | null;
  sourceRef: { artifactId: string; rawPointer: string };
}

interface DiscoveredAsset {
  identity: string;
  mediaType: string | null;
  sourceRefs: Array<{ artifactId: string; rawPointer: string }>;
  sourceRefKeys: Set<string>;
}

const HASH_BATCH_SIZE = 16;

/**
 * Discover raw ChatGPT assets without following URLs, loading bytes, or
 * retaining a provider identifier/asset pointer in the manifest. Any shape
 * ambiguity degrades to an explicit unknown inventory so raw capture stays
 * durable for an offline repair.
 */
export async function inventoryChatGptRawAssets(
  input: ChatGptAssetInventoryInput
): Promise<ChatGptAssetInventory> {
  try {
    if (!input || typeof input !== 'object' || typeof input.artifactId !== 'string')
      throw new Error();
    if (typeof input.sha256 !== 'function') throw new Error();
    const candidates = collectCandidates(input.raw, input.artifactId);
    const assets = await recordsForCandidates(candidates, input.sha256);
    return { assets, completeness: 'not-attempted', warnings: [] };
  } catch {
    return {
      assets: [],
      completeness: 'unknown',
      warnings: [CHATGPT_ASSET_INVENTORY_WARNING],
    };
  }
}

function collectCandidates(raw: unknown, artifactId: string): Candidate[] {
  const envelope = extractEnvelope(raw);
  const mapping = envelope.conversation.mapping;
  if (!isPlainRecord(mapping) || Object.keys(mapping).length === 0) throw new Error();

  const candidates: Candidate[] = [];
  for (const nodeId of Object.keys(mapping)) {
    const node = mapping[nodeId];
    if (!isPlainRecord(node)) throw new Error();
    if (!hasOwn(node, 'message') || node.message === null) continue;
    if (!isPlainRecord(node.message)) throw new Error();
    scanMessage(
      node.message,
      pointerAt(envelope.basePointer, 'mapping', nodeId, 'message'),
      artifactId,
      candidates
    );
  }
  return candidates;
}

function extractEnvelope(raw: unknown): RawEnvelope {
  if (!isPlainRecord(raw)) throw new Error();
  const rootGraph = isPlainRecord(raw.mapping);
  const nested = raw.conversation;
  const nestedGraph = isPlainRecord(nested) && isPlainRecord(nested.mapping);
  if (rootGraph && nestedGraph) throw new Error();
  if (rootGraph) return { conversation: raw, basePointer: '' };
  if (nestedGraph) return { conversation: nested, basePointer: '/conversation' };
  throw new Error();
}

function scanMessage(
  message: JsonRecord,
  pointer: string,
  artifactId: string,
  candidates: Candidate[]
): void {
  if (hasOwn(message, 'content') && message.content !== null) {
    scanContent(
      message.content,
      pointerAt(pointer, 'content'),
      artifactId,
      candidates,
      0,
      new WeakSet()
    );
  }
  if (!hasOwn(message, 'metadata') || message.metadata === null) return;
  if (!isPlainRecord(message.metadata)) throw new Error();
  for (const field of ['attachments', 'files']) {
    if (!hasOwn(message.metadata, field) || message.metadata[field] === null) continue;
    const values = message.metadata[field];
    if (!Array.isArray(values)) throw new Error();
    values.forEach((value, index) => {
      if (!isPlainRecord(value)) throw new Error();
      pushCandidate(
        value,
        pointerAt(pointer, 'metadata', field, String(index)),
        artifactId,
        candidates
      );
    });
  }
}

function scanContent(
  value: unknown,
  pointer: string,
  artifactId: string,
  candidates: Candidate[],
  depth: number,
  ancestors: WeakSet<object>
): void {
  if (depth > MAX_CONTENT_DEPTH || !isPlainRecord(value) || ancestors.has(value)) throw new Error();
  ancestors.add(value);
  try {
    if (typeof value.content_type !== 'string' || value.content_type.length === 0)
      throw new Error();
    if (ASSET_TYPES.has(value.content_type)) pushCandidate(value, pointer, artifactId, candidates);
    if (!hasOwn(value, 'parts')) return;
    if (!Array.isArray(value.parts)) throw new Error();
    value.parts.forEach((part, index) => {
      if (typeof part === 'string') return;
      scanContent(
        part,
        pointerAt(pointer, 'parts', String(index)),
        artifactId,
        candidates,
        depth + 1,
        ancestors
      );
    });
  } finally {
    ancestors.delete(value);
  }
}

function pushCandidate(
  record: JsonRecord,
  rawPointer: string,
  artifactId: string,
  candidates: Candidate[]
): void {
  if (candidates.length >= MAX_DISCOVERED_ASSETS) throw new Error();
  candidates.push({
    identity: assetIdentity(record, rawPointer),
    mediaType: knownMimeType(record),
    sourceRef: { artifactId, rawPointer },
  });
}

function assetIdentity(record: JsonRecord, rawPointer: string): string {
  const providerId = providerIdFor(record);
  if (providerId !== null) return `provider-id:${providerId}`;
  if (typeof record.asset_pointer === 'string' && record.asset_pointer.length > 0) {
    return `asset-pointer:${boundedIdentity(record.asset_pointer)}`;
  }
  return `raw-location:${rawPointer}`;
}

function providerIdFor(record: JsonRecord): string | null {
  for (const field of ID_FIELDS) {
    const value = record[field];
    if (typeof value !== 'string' || value.length === 0) continue;
    return boundedIdentity(value);
  }
  return null;
}

function boundedIdentity(value: string): string {
  if (value.length > MAX_IDENTITY_LENGTH) throw new Error();
  return value;
}

function knownMimeType(record: JsonRecord): string | null {
  for (const field of ['mime_type', 'mimeType']) {
    const value = record[field];
    if (typeof value !== 'string') continue;
    const essence = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    if (KNOWN_MIME_TYPES.has(essence)) return essence;
  }
  return null;
}

async function recordsForCandidates(
  candidates: Candidate[],
  sha256: ChatGptAssetInventoryInput['sha256']
): Promise<RawCaptureAssetRecord[]> {
  const discovered = deduplicateCandidates(candidates);
  const records: RawCaptureAssetRecord[] = [];
  for (let index = 0; index < discovered.length; index += HASH_BATCH_SIZE) {
    records.push(
      ...(await Promise.all(
        discovered
          .slice(index, index + HASH_BATCH_SIZE)
          .map(asset => recordForDiscoveredAsset(asset, sha256))
      ))
    );
  }
  if (new Set(records.map(record => record.id)).size !== records.length) throw new Error();
  return records.sort((left, right) => compareStrings(left.id, right.id));
}

function deduplicateCandidates(candidates: Candidate[]): DiscoveredAsset[] {
  const discovered = new Map<string, DiscoveredAsset>();
  for (const candidate of candidates) {
    const existing = discovered.get(candidate.identity);
    if (!existing) {
      discovered.set(candidate.identity, {
        identity: candidate.identity,
        mediaType: candidate.mediaType,
        sourceRefs: [candidate.sourceRef],
        sourceRefKeys: new Set([sourceRefKey(candidate.sourceRef)]),
      });
      continue;
    }
    if (existing.mediaType === null) existing.mediaType = candidate.mediaType;
    if (
      candidate.mediaType !== null &&
      existing.mediaType !== null &&
      candidate.mediaType !== existing.mediaType
    ) {
      throw new Error();
    }
    const key = sourceRefKey(candidate.sourceRef);
    if (!existing.sourceRefKeys.has(key)) {
      existing.sourceRefs.push(candidate.sourceRef);
      existing.sourceRefKeys.add(key);
    }
  }
  return [...discovered.values()].sort((left, right) =>
    compareStrings(left.identity, right.identity)
  );
}

function sourceRefKey(sourceRef: Candidate['sourceRef']): string {
  return `${sourceRef.artifactId}\u0000${sourceRef.rawPointer}`;
}

async function recordForDiscoveredAsset(
  asset: DiscoveredAsset,
  sha256: ChatGptAssetInventoryInput['sha256']
): Promise<RawCaptureAssetRecord> {
  const digest = await sha256(
    new TextEncoder().encode(`liska-chatgpt-asset/1\u0000${asset.identity}`)
  );
  if (!SHA256_PATTERN.test(digest)) throw new Error();
  return {
    id: `chatgpt-asset-${digest}`,
    state: 'not-attempted',
    attemptedAt: null,
    relativePath: null,
    mediaType: asset.mediaType,
    byteLength: null,
    sha256: null,
    detail: CHATGPT_ASSET_INVENTORY_DETAIL,
    sourceRefs: [...asset.sourceRefs].sort(compareSourceRefs),
  };
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
