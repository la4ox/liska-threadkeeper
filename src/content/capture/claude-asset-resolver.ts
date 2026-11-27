/** Runtime-only derivation of exact Claude original-file contents requests. */

import type { RawCaptureAssetRecord } from '../../archive/capture';
import {
  bindClaudeOrdinaryFiles,
  claudeOrdinaryFileAssetId,
  isClaudeAssetUuid,
} from '../../archive/normalizers/claude/inventory';
import { isRecord } from '../../archive/normalizers/claude/privacy';
import { assertProviderContentBytes } from '../../archive/normalizers/provider-block-work-budget';
import type { ClaudeAssetExportContext } from '../../lib/types';
import { CLAUDE_ORIGIN } from '../extractors/claude-detail-route';
import { parseJsonArtifact, sha256Hex } from './response';

export const CLAUDE_ASSET_DERIVATION_BUDGET = Object.freeze({ assets: 64, sourceRefs: 256 });

export interface ClaudeAssetCandidate {
  readonly assetId: string;
  /** Runtime-only; never serialized or logged. */
  readonly contentsUrl: string;
  readonly declaredByteLength: number;
  readonly declaredMediaType?: string;
}

const FILE_POINTER = /^\/chat_messages\/(0|[1-9]\d{0,5})\/files\/(0|[1-9]\d{0,5})$/;

function contentsUrl(organizationId: string, fileUuid: string): string {
  return `${CLAUDE_ORIGIN}/api/organizations/${organizationId}/files/${fileUuid}/contents`;
}

/** Recheck literal URL syntax without normalization before issuing any request. */
export function isExactClaudeContentsUrl(value: string): boolean {
  const parts = value.split('/');
  return (
    parts.length === 9 &&
    isClaudeAssetUuid(parts[5]) &&
    isClaudeAssetUuid(parts[7]) &&
    contentsUrl(parts[5], parts[7]) === value
  );
}

function exactFileAtPointer(messages: readonly unknown[], pointer: string): unknown {
  const match = FILE_POINTER.exec(pointer);
  if (!match || match[0] !== pointer) return undefined;
  const message = messages[Number(match[1])];
  return isRecord(message) && Array.isArray(message.files)
    ? message.files[Number(match[2])]
    : undefined;
}

function boundedPrefix(assets: readonly RawCaptureAssetRecord[]): RawCaptureAssetRecord[] {
  const accepted: RawCaptureAssetRecord[] = [];
  let refs = 0;
  for (const asset of assets.slice(0, CLAUDE_ASSET_DERIVATION_BUDGET.assets)) {
    refs += asset.sourceRefs.length;
    if (refs > CLAUDE_ASSET_DERIVATION_BUDGET.sourceRefs) break;
    accepted.push(asset);
  }
  return accepted;
}

/** Resolve only exact manifest source refs into the previously verified raw artifact. */
export async function deriveClaudeAssetCandidates(
  context: ClaudeAssetExportContext,
  sha256: (bytes: Uint8Array) => Promise<string> = sha256Hex
): Promise<ClaudeAssetCandidate[]> {
  const { rawCaptureBundle: bundle, conversationId, organizationId } = context;
  if (
    bundle.manifest.provider !== 'claude' ||
    bundle.manifest.conversationId !== conversationId ||
    !isClaudeAssetUuid(conversationId) ||
    !isClaudeAssetUuid(organizationId) ||
    bundle.artifacts.length !== 1
  ) {
    return [];
  }
  const assets = boundedPrefix(bundle.manifest.assets);
  if (assets.length === 0) return [];
  const artifact = bundle.artifacts[0];
  const budget = assertProviderContentBytes('claude', artifact.bytes, context.contentBudget);
  const raw = parseJsonArtifact(artifact.bytes);
  if (!isRecord(raw) || raw.uuid !== conversationId || !Array.isArray(raw.chat_messages)) return [];
  return deriveFromExactRecords(raw.chat_messages, assets, artifact.record.id, organizationId, {
    sha256,
    spendWork: units => budget.spendWork(units),
  });
}

async function deriveFromExactRecords(
  messages: readonly unknown[],
  assets: readonly RawCaptureAssetRecord[],
  artifactId: string,
  organizationId: string,
  work: { sha256: typeof sha256Hex; spendWork: (units: number) => void }
): Promise<ClaudeAssetCandidate[]> {
  const candidates = new Map<string, ClaudeAssetCandidate>();
  const seen = new Set<string>();
  for (const asset of assets) {
    work.spendWork(asset.sourceRefs.length + 1);
    // A malformed duplicate ID must not authorize either candidate.
    if (seen.has(asset.id)) {
      candidates.delete(asset.id);
      continue;
    }
    seen.add(asset.id);
    if (asset.state !== 'not-attempted') continue;
    const file = bindClaudeOrdinaryFiles(
      asset.sourceRefs.map(({ artifactId: sourceId, rawPointer }) => ({
        pointer: rawPointer,
        value: sourceId === artifactId ? exactFileAtPointer(messages, rawPointer) : undefined,
      }))
    );
    if (!file || asset.id !== (await claudeOrdinaryFileAssetId(file.fileUuid, work.sha256))) {
      continue;
    }
    candidates.set(asset.id, {
      assetId: asset.id,
      contentsUrl: contentsUrl(organizationId, file.fileUuid),
      declaredByteLength: file.byteLength,
      ...(file.mediaType && { declaredMediaType: file.mediaType }),
    });
  }
  return [...candidates.values()].sort((left, right) =>
    left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0
  );
}
