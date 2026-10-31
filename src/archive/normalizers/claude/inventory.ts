import type { RawCaptureAssetRecord } from '../../capture';
import type { ClaudeRecord } from './contracts';
import { fail } from './contracts';
import { at, identifier, isRecord } from './privacy';

export interface ClaudeAssetInventoryInput {
  raw: unknown;
  artifactId: string;
  sha256: (bytes: Uint8Array) => Promise<string>;
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

/** Only exact durable provider IDs coalesce. Missing/ambiguous identity stays pointer-local. */
export async function inventoryClaudeRawAssets(
  input: ClaudeAssetInventoryInput
): Promise<ClaudeAssetInventory> {
  identifier(input.artifactId, 'artifactId');
  const candidates = discover(input.raw);
  const groups = new Map<string, ClaudeAssetMetadata[]>();
  for (const candidate of candidates) {
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
    const digest = await input.sha256(
      new TextEncoder().encode(`liska.claude.asset-id/v1\u0000${key}`)
    );
    if (!/^[a-f0-9]{64}$/.test(digest))
      fail('asset-inventory-failed', 'Claude asset identity hashing failed.');
    discovered.push({
      record: {
        id: `claude-asset-${digest}`,
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

function discover(raw: unknown): ClaudeAssetMetadata[] {
  if (!isRecord(raw) || !Array.isArray(raw.chat_messages)) return [];
  const candidates: ClaudeAssetMetadata[] = [];
  const seen = new Set<string>();
  function add(value: unknown, pointer: string): void {
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
    value.forEach((block, index) => {
      if (!isRecord(block)) return;
      const blockPointer = at(pointer, String(index));
      if (typeof block.type === 'string' && ASSET_TYPES.has(block.type)) add(block, blockPointer);
      for (const field of ['attachments', 'files']) {
        const entries = block[field];
        if (Array.isArray(entries))
          entries.forEach((item, i) => add(item, at(blockPointer, field, String(i))));
      }
      walkContent(block.content, at(blockPointer, 'content'), depth + 1);
    });
  }
  raw.chat_messages.forEach((message, index) => {
    if (!isRecord(message)) return;
    const pointer = at('/chat_messages', String(index));
    for (const field of ['attachments', 'files']) {
      const entries = message[field];
      if (Array.isArray(entries))
        entries.forEach((item, i) => add(item, at(pointer, field, String(i))));
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
