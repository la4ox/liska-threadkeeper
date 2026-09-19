import {
  validateCaptureBundleShape,
  verifyCaptureBundleIntegrity,
  type LiskaThreadArchive,
  type RawCaptureBundle,
} from '../../archive';
import {
  ARCHIVE_COMPANION_RELATIVE_PATHS,
  type ArchiveCompanionArtifact,
  type ArchiveCompanionBundle,
  type InlineArchiveCompanionArtifact,
  type StructuredArchiveSource,
} from '../../lib/types';
import { MAX_CONTENT_SIZE } from '../../lib/constants';
import { CHATGPT_INLINE_CAPTURE_MAX_BYTES } from '../../lib/chatgpt-capture-contract';
import { bytesToBase64 } from '../../lib/image-utils';
import { stageArchiveArtifactBytes } from '../archive-stage';

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}

/** Select the bounded staged route before creating any oversized runtime message. */
export function shouldStageJsonArchiveArtifact(
  kind: Extract<ArchiveCompanionArtifact['kind'], 'raw' | 'canonical'>,
  byteLength: number
): boolean {
  return kind === 'raw'
    ? byteLength > CHATGPT_INLINE_CAPTURE_MAX_BYTES
    : byteLength > MAX_CONTENT_SIZE;
}

async function inlineArtifact(
  kind: InlineArchiveCompanionArtifact['kind'],
  relativePath: string,
  bytes: Uint8Array,
  sha256: (bytes: Uint8Array) => Promise<string>
): Promise<InlineArchiveCompanionArtifact> {
  return {
    transport: 'inline',
    kind,
    relativePath,
    mediaType: 'application/json',
    byteLength: bytes.byteLength,
    sha256: await sha256(bytes),
    bodyBase64: bytesToBase64(bytes),
  };
}

/** Build the provider-neutral exact raw + canonical manifest companion pair. */
export async function buildJsonRawManifestCompanion(
  bundle: RawCaptureBundle,
  sha256: (bytes: Uint8Array) => Promise<string>,
  source: StructuredArchiveSource
): Promise<ArchiveCompanionBundle> {
  validateCaptureBundleShape(bundle);
  await verifyCaptureBundleIntegrity(bundle, sha256);
  if (
    bundle.artifacts.length !== 1 ||
    bundle.assets.length > 0 ||
    bundle.manifest.assets.some(asset => asset.state !== 'not-attempted')
  ) {
    throw new Error(
      'JSON archive companion requires one raw artifact and only metadata-only asset inventory records.'
    );
  }
  const raw = bundle.artifacts[0];
  if (raw.record.relativePath !== ARCHIVE_COMPANION_RELATIVE_PATHS.raw) {
    throw new Error('JSON archive raw artifact path is not canonical.');
  }
  const manifestBytes = jsonBytes(bundle.manifest);
  const conversationKey = await sha256(new TextEncoder().encode(bundle.manifest.conversationId));
  const manifest = await inlineArtifact(
    'manifest',
    ARCHIVE_COMPANION_RELATIVE_PATHS.manifest,
    manifestBytes,
    sha256
  );
  const rawArtifact = shouldStageJsonArchiveArtifact('raw', raw.bytes.byteLength)
    ? await stageArchiveArtifactBytes('raw', raw.bytes, source)
    : await inlineArtifact('raw', ARCHIVE_COMPANION_RELATIVE_PATHS.raw, raw.bytes, sha256);
  return {
    captureId: bundle.manifest.captureId,
    conversationKey,
    artifacts: [rawArtifact, manifest] as readonly [
      ArchiveCompanionArtifact,
      ArchiveCompanionArtifact,
    ],
  };
}

/** Append the validated canonical liska-thread/1 JSON without mutating the pair. */
export async function appendJsonCanonicalCompanion(
  companion: ArchiveCompanionBundle,
  archive: LiskaThreadArchive,
  sha256: (bytes: Uint8Array) => Promise<string>,
  source: StructuredArchiveSource
): Promise<ArchiveCompanionBundle> {
  const [raw, manifest] = companion.artifacts;
  if (!raw || !manifest || companion.artifacts.length !== 2) {
    throw new Error('Canonical companion requires an exact raw + manifest pair.');
  }
  const canonicalBytes = jsonBytes(archive);
  const canonical = shouldStageJsonArchiveArtifact('canonical', canonicalBytes.byteLength)
    ? await stageArchiveArtifactBytes('canonical', canonicalBytes, source)
    : await inlineArtifact(
        'canonical',
        ARCHIVE_COMPANION_RELATIVE_PATHS.canonical,
        canonicalBytes,
        sha256
      );
  return { ...companion, artifacts: [raw, manifest, canonical] };
}
