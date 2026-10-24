import { getNodePath, LISKA_THREAD_SCHEMA, type LiskaThreadArchive } from '../archive';
import {
  ARCHIVE_COMPANION_RELATIVE_PATHS,
  type ArchiveCompanionArtifact,
  type ArchiveCompanionArtifactBase,
  type ArchiveCompanionBundle,
  type StructuredArchiveSource,
  type StructuredPresentationContext,
} from '../lib/types';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const OPAQUE_CONVERSATION_KEY_PATTERN = /^[a-f0-9]{64}$/;

export interface RetainStructuredPresentationInput {
  readonly source: StructuredArchiveSource;
  readonly archive: LiskaThreadArchive;
  readonly archiveCompanion: ArchiveCompanionBundle;
  readonly targetNodeId: string | null;
  readonly selectedNodeIds: readonly string[];
  readonly includeToolContent: boolean;
}

type StructuredArtifactKind = 'manifest' | 'canonical';
type StructuredArtifactDescriptor<K extends StructuredArtifactKind> = Readonly<
  ArchiveCompanionArtifactBase & { kind: K }
>;

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactArtifact<K extends StructuredArtifactKind>(
  artifacts: readonly ArchiveCompanionArtifact[],
  kind: K
): StructuredArtifactDescriptor<K> | undefined {
  const matches = artifacts.filter(artifact => artifact.kind === kind);
  if (matches.length !== 1) return undefined;
  const artifact = matches[0];
  if (
    artifact.relativePath !== ARCHIVE_COMPANION_RELATIVE_PATHS[kind] ||
    artifact.mediaType !== 'application/json' ||
    !Number.isSafeInteger(artifact.byteLength) ||
    artifact.byteLength <= 0 ||
    typeof artifact.sha256 !== 'string' ||
    !SHA256_PATTERN.test(artifact.sha256)
  ) {
    return undefined;
  }
  return Object.freeze({
    kind,
    relativePath: artifact.relativePath,
    mediaType: artifact.mediaType,
    byteLength: artifact.byteLength,
    sha256: artifact.sha256,
  });
}

function samePath(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((nodeId, index) => nodeId === expected[index])
  );
}

function validCaptureId(source: StructuredArchiveSource, value: string): boolean {
  return source === 'chatgpt'
    ? /^capture-chatgpt-[A-Za-z0-9][A-Za-z0-9_-]{0,239}$/.test(value)
    : /^capture-deepseek-[A-Za-z0-9][A-Za-z0-9_-]{0,235}$/.test(value);
}

function validDeclaredCurrentNode(archive: LiskaThreadArchive): boolean {
  const currentNodeId = archive.conversation.currentNodeId;
  return (
    currentNodeId === null ||
    (typeof currentNodeId === 'string' &&
      currentNodeId.length > 0 &&
      hasOwn(archive.graph.nodes, currentNodeId))
  );
}

function archiveIdentityMatches(
  archive: LiskaThreadArchive,
  source: StructuredArchiveSource,
  companion: ArchiveCompanionBundle,
  manifest: StructuredArtifactDescriptor<'manifest'>
): boolean {
  const input = archive.inputs[0];
  return (
    archive.schema === LISKA_THREAD_SCHEMA &&
    archive.inputs.length === 1 &&
    input !== undefined &&
    archive.conversation.provider === source &&
    typeof archive.conversation.id === 'string' &&
    archive.conversation.id.length > 0 &&
    archive.archiveId === `${source}:${archive.conversation.id}` &&
    validCaptureId(source, companion.captureId) &&
    input.captureId === companion.captureId &&
    input.manifestSha256 === manifest.sha256 &&
    (companion.capturedAt === undefined || companion.capturedAt === input.capturedAt) &&
    validDeclaredCurrentNode(archive)
  );
}

function structuredArtifacts(companion: ArchiveCompanionBundle):
  | {
      manifest: StructuredArtifactDescriptor<'manifest'>;
      canonical: StructuredArtifactDescriptor<'canonical'>;
    }
  | undefined {
  if (companion.artifacts.length !== 3) return undefined;
  const manifest = exactArtifact(companion.artifacts, 'manifest');
  const canonical = exactArtifact(companion.artifacts, 'canonical');
  return manifest && canonical ? { manifest, canonical } : undefined;
}

function retainedSelectedPath(
  archive: LiskaThreadArchive,
  targetNodeId: string | null,
  sourcePath: readonly string[]
): readonly string[] | undefined {
  if (
    typeof targetNodeId !== 'string' ||
    targetNodeId.length === 0 ||
    !hasOwn(archive.graph.nodes, targetNodeId) ||
    !Array.isArray(sourcePath)
  ) {
    return undefined;
  }
  const selectedNodeIds = [...sourcePath];
  if (
    selectedNodeIds.length === 0 ||
    selectedNodeIds.some(nodeId => typeof nodeId !== 'string' || nodeId.length === 0) ||
    selectedNodeIds[selectedNodeIds.length - 1] !== targetNodeId ||
    !samePath(selectedNodeIds, getNodePath(archive, targetNodeId))
  ) {
    return undefined;
  }
  return Object.freeze(selectedNodeIds);
}

function validInputEnvelope(input: RetainStructuredPresentationInput): boolean {
  return (
    (input.source === 'chatgpt' || input.source === 'deepseek') &&
    typeof input.includeToolContent === 'boolean' &&
    typeof input.archiveCompanion.captureId === 'string' &&
    input.archiveCompanion.captureId.length > 0 &&
    typeof input.archiveCompanion.conversationKey === 'string' &&
    OPAQUE_CONVERSATION_KEY_PATTERN.test(input.archiveCompanion.conversationKey)
  );
}

/**
 * Retain a provider-neutral current/selected structured view without
 * recapturing provider data or reconstructing it from legacy Markdown.
 *
 * This is deliberately fail-closed and value-free: malformed evidence yields
 * `undefined`, never a provider-derived diagnostic or partially trusted view.
 */
export function retainStructuredPresentation(
  input: RetainStructuredPresentationInput
): StructuredPresentationContext | undefined {
  try {
    const { source, archive, archiveCompanion, includeToolContent } = input;
    if (!validInputEnvelope(input)) return undefined;
    const artifacts = structuredArtifacts(archiveCompanion);
    if (
      !artifacts ||
      !archiveIdentityMatches(archive, source, archiveCompanion, artifacts.manifest)
    )
      return undefined;
    const selectedNodeIds = retainedSelectedPath(
      archive,
      input.targetNodeId,
      input.selectedNodeIds
    );
    if (!selectedNodeIds || input.targetNodeId === null) return undefined;

    return Object.freeze({
      source,
      archive,
      captureId: archiveCompanion.captureId,
      conversationKey: archiveCompanion.conversationKey,
      manifest: artifacts.manifest,
      canonical: artifacts.canonical,
      targetNodeId: input.targetNodeId,
      selectedNodeIds,
      includeToolContent,
    });
  } catch {
    return undefined;
  }
}
