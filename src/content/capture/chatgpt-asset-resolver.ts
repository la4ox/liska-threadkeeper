/**
 * Match transient page-owned ChatGPT resolver observations to the existing
 * credential-free capture ledger. Provider file IDs are read only from the
 * already verified raw artifact, hashed immediately, and never returned.
 */

import type { RawCaptureAssetRecord } from '../../archive/capture';
import { sha256Hex } from '../../lib/sha256';

const RESOLVER_KEY_DOMAIN = 'liska-chatgpt-resolver/1\u0000';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PROVIDER_FILE_ID_PATTERN = /^[A-Za-z0-9._-]{1,512}$/;
const POINTER_FILE_ID_PATTERN = /^(?:file-service|sediment):(?:\/\/)?([A-Za-z0-9._-]{1,512})$/;
const DIRECT_ID_FIELDS = ['asset_id', 'assetId', 'file_id', 'fileId', 'id'] as const;

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
