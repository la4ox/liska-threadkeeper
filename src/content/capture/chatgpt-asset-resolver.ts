/**
 * Match transient page-owned ChatGPT resolver observations to the existing
 * credential-free capture ledger. Provider file IDs are read only from the
 * already verified raw artifact, hashed immediately, and never returned.
 */

import type { RawCaptureAssetRecord } from '../../archive/capture';
import { isSafeStagedBinaryAssetId } from '../../lib/binary-asset-contract';
import {
  chatGptAssetIdForIdentity,
  chatGptSandboxLinksFromAssistantTextPart,
} from '../../archive/chatgpt-sandbox-link';
import { sha256Hex } from '../../lib/sha256';
import {
  CHATGPT_ACTIVE_RESOLVER_MAX_COUNT,
  isChatGptActiveResolverProviderFileId,
} from '../../lib/chatgpt-active-resolver-contract';
import {
  CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT,
  isChatGptInterpreterMessageId,
  isChatGptInterpreterSandboxPath,
  type ChatGptInterpreterAssetCandidate,
} from '../../lib/chatgpt-interpreter-resolver-contract';

export {
  CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT,
  type ChatGptInterpreterAssetCandidate,
} from '../../lib/chatgpt-interpreter-resolver-contract';

const RESOLVER_KEY_DOMAIN = 'liska-chatgpt-resolver/1\u0000';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PROVIDER_FILE_ID_PATTERN = /^[A-Za-z0-9._-]{1,512}$/;
const POINTER_FILE_ID_PATTERN = /^(?:file-service|sediment):(?:\/\/)?([A-Za-z0-9._-]{1,512})$/;
const DIRECT_ID_FIELDS = ['asset_id', 'assetId', 'file_id', 'fileId', 'id'] as const;
const CHATGPT_INTERPRETER_ATTACHMENT_INDEX_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const CHATGPT_INTERPRETER_MAX_POINTER_LENGTH = 4_096;

export interface ChatGptTransientResolverRecord {
  resolverKey: string;
  downloadUrl: string;
}

export interface ChatGptPageOwnedAssetCandidate {
  assetId: string;
  downloadUrl: string;
}

export interface MatchChatGptAssetResolversInput {
  raw: unknown;
  assets: readonly RawCaptureAssetRecord[];
  resolvers: readonly ChatGptTransientResolverRecord[];
  sha256?: (bytes: Uint8Array) => Promise<string>;
}

/**
 * Transient provider IDs selected from exact ledger source references for the
 * active metric probe. This plan never reaches persistence or warning text.
 */
export interface ChatGptActiveResolverPlan {
  providerFileIds: string[];
}

interface ProviderFileEvidence {
  fileId: string;
  /** Direct provider IDs outrank transport-pointer deductions. */
  strength: 1 | 2;
}

interface MatchedAsset {
  assetId: string;
  downloadUrl: string;
  resolverKey: string;
  strength: 1 | 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some(character => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    );
  });
}

function decodePointerSegment(segment: string): string | undefined {
  if (/~(?![01])/u.test(segment)) return undefined;
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function atJsonPointer(raw: unknown, pointer: string): unknown {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return undefined;
  let value = raw;
  for (const encoded of pointer.slice(1).split('/')) {
    const segment = decodePointerSegment(encoded);
    if (segment === undefined || (!isRecord(value) && !Array.isArray(value))) return undefined;
    if (!Object.prototype.hasOwnProperty.call(value, segment)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

interface ChatGptInterpreterAttachmentPointer {
  nodeSegment: string;
}

interface ChatGptInterpreterAttachmentEvidence {
  messageId: string;
  sandboxPath: string;
}

interface ChatGptInterpreterAssistantTextPartPointer {
  nodeSegment: string;
}

function interpreterAttachmentPointer(
  pointer: unknown
): ChatGptInterpreterAttachmentPointer | undefined {
  if (
    typeof pointer !== 'string' ||
    pointer.length === 0 ||
    pointer.length > CHATGPT_INTERPRETER_MAX_POINTER_LENGTH ||
    hasControlCharacters(pointer)
  ) {
    return undefined;
  }
  const segments = pointer.split('/');
  if (
    segments.length !== 7 ||
    segments[0] !== '' ||
    segments[1] !== 'mapping' ||
    segments[3] !== 'message' ||
    segments[4] !== 'metadata' ||
    segments[5] !== 'attachments' ||
    !CHATGPT_INTERPRETER_ATTACHMENT_INDEX_PATTERN.test(segments[6])
  ) {
    return undefined;
  }
  const node = decodePointerSegment(segments[2]);
  if (node === undefined || node.length === 0 || hasControlCharacters(node)) return undefined;
  return { nodeSegment: segments[2] };
}

function interpreterAttachmentEvidence(
  raw: unknown,
  rawPointer: unknown
): ChatGptInterpreterAttachmentEvidence | undefined {
  const location = interpreterAttachmentPointer(rawPointer);
  if (!location) return undefined;
  const attachment = atJsonPointer(raw, rawPointer as string);
  if (!isPlainRecord(attachment) || !Object.prototype.hasOwnProperty.call(attachment, 'name'))
    return undefined;
  if (!isChatGptInterpreterSandboxPath(attachment.name)) return undefined;
  const messageId = atJsonPointer(raw, `/mapping/${location.nodeSegment}/message/id`);
  if (!isChatGptInterpreterMessageId(messageId)) return undefined;
  return { messageId, sandboxPath: attachment.name };
}

function interpreterAssistantTextPartPointer(
  pointer: unknown
): ChatGptInterpreterAssistantTextPartPointer | undefined {
  if (
    typeof pointer !== 'string' ||
    pointer.length === 0 ||
    pointer.length > CHATGPT_INTERPRETER_MAX_POINTER_LENGTH ||
    hasControlCharacters(pointer)
  ) {
    return undefined;
  }
  const segments = pointer.split('/');
  if (
    segments.length !== 7 ||
    segments[0] !== '' ||
    segments[1] !== 'mapping' ||
    segments[3] !== 'message' ||
    segments[4] !== 'content' ||
    segments[5] !== 'parts' ||
    !CHATGPT_INTERPRETER_ATTACHMENT_INDEX_PATTERN.test(segments[6])
  ) {
    return undefined;
  }
  const node = decodePointerSegment(segments[2]);
  if (node === undefined || node.length === 0 || hasControlCharacters(node)) return undefined;
  return { nodeSegment: segments[2] };
}

/**
 * Re-read one exact ledger text-part pointer and prove that its asset ID was
 * derived from a link rendered by that same assistant message node. This never
 * scans unrelated raw strings or nested tool/code data.
 */
async function interpreterSandboxLinkEvidence(
  raw: unknown,
  rawPointer: unknown,
  assetId: string,
  assetIdForIdentity: (identity: string) => Promise<string | undefined>
): Promise<ChatGptInterpreterAttachmentEvidence[]> {
  const location = interpreterAssistantTextPartPointer(rawPointer);
  if (!location) return [];
  const part = atJsonPointer(raw, rawPointer as string);
  const message = atJsonPointer(raw, `/mapping/${location.nodeSegment}/message`);
  if (
    typeof part !== 'string' ||
    !isPlainRecord(message) ||
    !isPlainRecord(message.author) ||
    message.author.role !== 'assistant' ||
    !isPlainRecord(message.content) ||
    message.content.content_type !== 'text' ||
    !Array.isArray(message.content.parts) ||
    !isChatGptInterpreterMessageId(message.id)
  ) {
    return [];
  }
  const matches: ChatGptInterpreterAttachmentEvidence[] = [];
  for (const link of chatGptSandboxLinksFromAssistantTextPart(message.id, part)) {
    const expectedAssetId = await assetIdForIdentity(link.identity);
    if (expectedAssetId === assetId) {
      matches.push({ messageId: link.messageId, sandboxPath: link.sandboxPath });
    }
  }
  return matches;
}

function sourceRefsSortKey(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .filter(isPlainRecord)
    .map(sourceRef => {
      const artifactId = sourceRef.artifactId;
      const rawPointer = sourceRef.rawPointer;
      return typeof artifactId === 'string' && typeof rawPointer === 'string'
        ? `${artifactId}\u0000${rawPointer}`
        : '';
    })
    .sort()
    .join('\u0001');
}

function compareInterpreterAssets(
  left: RawCaptureAssetRecord,
  right: RawCaptureAssetRecord
): number {
  const leftId = typeof left?.id === 'string' ? left.id : '';
  const rightId = typeof right?.id === 'string' ? right.id : '';
  if (leftId !== rightId) return leftId < rightId ? -1 : 1;
  const leftRefs = sourceRefsSortKey(left?.sourceRefs);
  const rightRefs = sourceRefsSortKey(right?.sourceRefs);
  return leftRefs < rightRefs ? -1 : leftRefs > rightRefs ? 1 : 0;
}

async function interpreterEvidenceForAsset(
  raw: unknown,
  asset: RawCaptureAssetRecord,
  assetIdForIdentity: (identity: string) => Promise<string | undefined>
): Promise<Map<string, ChatGptInterpreterAttachmentEvidence>> {
  const candidates = new Map<string, ChatGptInterpreterAttachmentEvidence>();
  for (const sourceRef of asset.sourceRefs) {
    if (!isPlainRecord(sourceRef) || sourceRef.artifactId !== 'conversation') continue;
    const attachment = interpreterAttachmentEvidence(raw, sourceRef.rawPointer);
    if (attachment) {
      candidates.set(`${attachment.messageId}\u0000${attachment.sandboxPath}`, attachment);
    }
    for (const sandboxLink of await interpreterSandboxLinkEvidence(
      raw,
      sourceRef.rawPointer,
      asset.id,
      assetIdForIdentity
    )) {
      candidates.set(`${sandboxLink.messageId}\u0000${sandboxLink.sandboxPath}`, sandboxLink);
    }
  }
  return candidates;
}

/**
 * Select bounded, exact ledger locations for a future interpreter-download
 * attempt. Metadata attachments stay synchronous in effect; assistant sandbox
 * links are verified against their centralized opaque asset-ID derivation.
 */
export async function extractChatGptInterpreterAssetPlan(
  raw: unknown,
  assets: readonly RawCaptureAssetRecord[],
  sha256: (bytes: Uint8Array) => Promise<string> = sha256Hex
): Promise<ChatGptInterpreterAssetCandidate[]> {
  if (!Array.isArray(assets)) return [];
  const selectedPairs = new Set<string>();
  const selected: ChatGptInterpreterAssetCandidate[] = [];
  const sandboxAssetIds = new Map<string, Promise<string | undefined>>();
  const assetIdForIdentity = (identity: string): Promise<string | undefined> => {
    const existing = sandboxAssetIds.get(identity);
    if (existing) return existing;
    const pending = chatGptAssetIdForIdentity(identity, sha256);
    sandboxAssetIds.set(identity, pending);
    return pending;
  };
  const orderedAssets = [...assets].sort(compareInterpreterAssets);
  for (const asset of orderedAssets) {
    if (!asset || typeof asset !== 'object' || !isSafeStagedBinaryAssetId(asset.id)) continue;
    if (!Array.isArray(asset.sourceRefs)) continue;
    const candidates = await interpreterEvidenceForAsset(raw, asset, assetIdForIdentity);
    if (candidates.size !== 1) continue;
    const evidence = candidates.values().next().value;
    if (!evidence) continue;
    const pair = `${evidence.messageId}\u0000${evidence.sandboxPath}`;
    if (selectedPairs.has(pair)) continue;
    selectedPairs.add(pair);
    selected.push({ assetId: asset.id, ...evidence });
    if (selected.length >= CHATGPT_INTERPRETER_ASSET_PLAN_MAX_COUNT) break;
  }
  return selected;
}

function providerFileEvidence(value: unknown): ProviderFileEvidence[] {
  if (!isRecord(value)) return [];
  const direct = new Set<string>();
  for (const field of DIRECT_ID_FIELDS) {
    const candidate = value[field];
    if (typeof candidate === 'string' && PROVIDER_FILE_ID_PATTERN.test(candidate)) {
      direct.add(candidate);
    }
  }
  if (direct.size > 0) {
    return [...direct].sort().map(fileId => ({ fileId, strength: 2 as const }));
  }

  const pointer = value.asset_pointer;
  if (typeof pointer !== 'string') return [];
  const match = POINTER_FILE_ID_PATTERN.exec(pointer);
  return match?.[1] ? [{ fileId: match[1], strength: 1 }] : [];
}

function activeProviderFileEvidence(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const direct = new Set<string>();
  for (const field of DIRECT_ID_FIELDS) {
    const candidate = value[field];
    if (isChatGptActiveResolverProviderFileId(candidate)) direct.add(candidate);
  }
  if (direct.size > 0) return [...direct].sort();
  const pointer = value.asset_pointer;
  if (typeof pointer !== 'string') return [];
  const match = POINTER_FILE_ID_PATTERN.exec(pointer);
  return match?.[1] && isChatGptActiveResolverProviderFileId(match[1]) ? [match[1]] : [];
}

/**
 * Extract only the ledger's already-validated JSON pointers. A source record
 * with zero or multiple possible IDs is deliberately skipped; this is not a
 * broad raw-data scan and never exposes an ID through a diagnostic channel.
 */
export function extractChatGptActiveResolverPlan(
  raw: unknown,
  assets: readonly RawCaptureAssetRecord[]
): ChatGptActiveResolverPlan {
  if (!Array.isArray(assets)) return { providerFileIds: [] };
  const selected = new Set<string>();
  const orderedAssets = [...assets].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  );
  for (const asset of orderedAssets) {
    if (!asset || typeof asset !== 'object' || !Array.isArray(asset.sourceRefs)) continue;
    const candidates = new Set<string>();
    for (const sourceRef of asset.sourceRefs) {
      if (!sourceRef || sourceRef.artifactId !== 'conversation') continue;
      for (const fileId of activeProviderFileEvidence(atJsonPointer(raw, sourceRef.rawPointer))) {
        candidates.add(fileId);
      }
    }
    if (candidates.size !== 1) continue;
    const fileId = candidates.values().next().value;
    if (typeof fileId === 'string') selected.add(fileId);
    if (selected.size >= CHATGPT_ACTIVE_RESOLVER_MAX_COUNT) break;
  }
  return { providerFileIds: [...selected] };
}

async function resolverKeyFor(
  fileId: string,
  digest: (bytes: Uint8Array) => Promise<string>
): Promise<string | undefined> {
  try {
    const key = await digest(new TextEncoder().encode(`${RESOLVER_KEY_DOMAIN}${fileId}`));
    return SHA256_PATTERN.test(key) ? key : undefined;
  } catch {
    return undefined;
  }
}

function acceptedResolvers(
  resolvers: readonly ChatGptTransientResolverRecord[]
): Map<string, string> {
  const accepted = new Map<string, string>();
  const conflicted = new Set<string>();
  for (const resolver of resolvers) {
    if (
      !resolver ||
      typeof resolver !== 'object' ||
      !SHA256_PATTERN.test(resolver.resolverKey) ||
      typeof resolver.downloadUrl !== 'string'
    ) {
      continue;
    }
    const prior = accepted.get(resolver.resolverKey);
    if (prior !== undefined && prior !== resolver.downloadUrl) {
      accepted.delete(resolver.resolverKey);
      conflicted.add(resolver.resolverKey);
      continue;
    }
    if (!conflicted.has(resolver.resolverKey))
      accepted.set(resolver.resolverKey, resolver.downloadUrl);
  }
  return accepted;
}

async function matchOneAsset(
  raw: unknown,
  asset: RawCaptureAssetRecord,
  resolvers: ReadonlyMap<string, string>,
  digest: (bytes: Uint8Array) => Promise<string>
): Promise<MatchedAsset | undefined> {
  const matches = new Map<string, MatchedAsset>();
  for (const sourceRef of asset.sourceRefs) {
    if (sourceRef.artifactId !== 'conversation') continue;
    for (const evidence of providerFileEvidence(atJsonPointer(raw, sourceRef.rawPointer))) {
      const resolverKey = await resolverKeyFor(evidence.fileId, digest);
      if (!resolverKey) continue;
      const downloadUrl = resolvers.get(resolverKey);
      if (!downloadUrl) continue;
      matches.set(resolverKey, {
        assetId: asset.id,
        downloadUrl,
        resolverKey,
        strength: evidence.strength,
      });
    }
  }
  return matches.size === 1 ? [...matches.values()][0] : undefined;
}

/**
 * Return at most one ledger asset per observed provider resolver. When both a
 * pointer-only record and exact metadata ID describe the same provider file,
 * the exact ID wins and the weaker ledger entry remains honestly not-attempted.
 */
export async function matchChatGptPageOwnedAssetResolvers(
  input: MatchChatGptAssetResolversInput
): Promise<ChatGptPageOwnedAssetCandidate[]> {
  if (
    !input ||
    typeof input !== 'object' ||
    !Array.isArray(input.assets) ||
    !Array.isArray(input.resolvers)
  ) {
    return [];
  }
  const resolvers = acceptedResolvers(input.resolvers);
  if (resolvers.size === 0) return [];
  const digest = input.sha256 ?? sha256Hex;
  const matches = (
    await Promise.all(input.assets.map(asset => matchOneAsset(input.raw, asset, resolvers, digest)))
  ).filter((match): match is MatchedAsset => match !== undefined);

  const byResolver = new Map<string, MatchedAsset[]>();
  for (const match of matches) {
    const existing = byResolver.get(match.resolverKey) ?? [];
    existing.push(match);
    byResolver.set(match.resolverKey, existing);
  }

  const selected: ChatGptPageOwnedAssetCandidate[] = [];
  for (const candidates of byResolver.values()) {
    const strongest = Math.max(...candidates.map(candidate => candidate.strength));
    const winners = candidates.filter(candidate => candidate.strength === strongest);
    if (winners.length !== 1) continue;
    selected.push({ assetId: winners[0].assetId, downloadUrl: winners[0].downloadUrl });
  }
  return selected.sort((left, right) =>
    left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0
  );
}
