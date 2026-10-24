import { LISKA_THREAD_SCHEMA, type LiskaThreadArchive } from '../archive';
import {
  ARCHIVE_COMPANION_RELATIVE_PATHS,
  type ArchiveCompanionArtifactBase,
  type ArchiveCompanionBundle,
  type StructuredArchiveSource,
  type StructuredArchivePresentationContext,
  type StructuredPresentationContext,
} from '../lib/types';
import { snapshotStructuredPresentationPath } from './structured-presentation-path';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface RetainStructuredArchivePresentationInput {
  readonly source: StructuredArchiveSource;
  readonly archive: LiskaThreadArchive;
  readonly archiveCompanion: ArchiveCompanionBundle;
  readonly includeToolContent: boolean;
}

export interface RetainStructuredPresentationInput extends RetainStructuredArchivePresentationInput {
  readonly targetNodeId: string | null;
  readonly selectedNodeIds: readonly string[];
}

type StructuredArtifactKind = 'raw' | 'manifest' | 'canonical';
type StructuredArtifactDescriptor<K extends StructuredArtifactKind> = Readonly<
  ArchiveCompanionArtifactBase & { kind: K }
>;

function invalid(): never {
  throw new Error('structured-presentation-invalid');
}

/** Only requested own data is read; subtype/raw/transport fields are not traversed. */
function ownData(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const data: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) invalid();
    data[key] = descriptor.value;
  }
  return data;
}

function denseArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as number;
  if (length > maximum || Reflect.ownKeys(value).length !== length + 1) invalid();
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !('value' in descriptor)) invalid();
    result.push(descriptor.value);
  }
  return result;
}

function exactArtifact<K extends StructuredArtifactKind>(
  value: Record<string, unknown>,
  kind: K
): StructuredArtifactDescriptor<K> {
  if (
    value.kind !== kind ||
    value.relativePath !== ARCHIVE_COMPANION_RELATIVE_PATHS[kind] ||
    value.mediaType !== 'application/json' ||
    typeof value.byteLength !== 'number' ||
    !Number.isSafeInteger(value.byteLength) ||
    value.byteLength <= 0 ||
    typeof value.sha256 !== 'string' ||
    !SHA256_PATTERN.test(value.sha256)
  )
    invalid();
  return Object.freeze({
    kind,
    relativePath: ARCHIVE_COMPANION_RELATIVE_PATHS[kind],
    mediaType: value.mediaType,
    byteLength: value.byteLength,
    sha256: value.sha256,
  });
}

function structuredArtifacts(value: unknown) {
  const artifacts = denseArray(value, 3).map(item =>
    ownData(item, ['kind', 'relativePath', 'mediaType', 'byteLength', 'sha256'])
  );
  if (artifacts.length !== 3) invalid();
  const find = <K extends StructuredArtifactKind>(kind: K) => {
    const matches = artifacts.filter(artifact => artifact.kind === kind);
    if (matches.length !== 1) invalid();
    return exactArtifact(matches[0], kind);
  };
  find('raw'); // Verify metadata, but never retain raw bytes or a staged capability.
  return { manifest: find('manifest'), canonical: find('canonical') };
}

function validCaptureId(source: StructuredArchiveSource, value: string): boolean {
  return source === 'chatgpt'
    ? /^capture-chatgpt-[A-Za-z0-9][A-Za-z0-9_-]{0,239}$/.test(value)
    : /^capture-deepseek-[A-Za-z0-9][A-Za-z0-9_-]{0,235}$/.test(value);
}

function graphNodes(archive: unknown): Record<string, unknown> {
  const graph = ownData(archive, ['graph']).graph;
  const nodes = ownData(graph, ['nodes']).nodes;
  ownData(nodes, []);
  return nodes as Record<string, unknown>;
}

function archiveIdentityMatches(
  value: unknown,
  source: StructuredArchiveSource,
  companion: Record<string, unknown>,
  manifest: StructuredArtifactDescriptor<'manifest'>,
  capturedAt: unknown
): boolean {
  const archive = ownData(value, ['schema', 'archiveId', 'inputs', 'conversation']);
  const inputs = denseArray(archive.inputs, 1);
  if (inputs.length !== 1) return false;
  const input = ownData(inputs[0], ['captureId', 'manifestSha256', 'capturedAt']);
  const conversation = ownData(archive.conversation, ['provider', 'id', 'currentNodeId']);
  const current = conversation.currentNodeId;
  const nodes = graphNodes(value);
  return (
    archive.schema === LISKA_THREAD_SCHEMA &&
    conversation.provider === source &&
    typeof conversation.id === 'string' &&
    conversation.id.length > 0 &&
    archive.archiveId === `${source}:${conversation.id}` &&
    input.captureId === companion.captureId &&
    input.manifestSha256 === manifest.sha256 &&
    (capturedAt === undefined || capturedAt === input.capturedAt) &&
    (current === null ||
      (typeof current === 'string' &&
        current.length > 0 &&
        Object.prototype.hasOwnProperty.call(nodes, current)))
  );
}

/**
 * Retain exact archive identity/descriptors without choosing a provider current node.
 * The archive stays an extension-owned closure-private reference, not a serialized API.
 * No canonical serialization or hashing occurs here; preparation authorizes those bytes.
 */
export function retainStructuredArchivePresentation(
  input: RetainStructuredArchivePresentationInput
): StructuredArchivePresentationContext | undefined {
  try {
    const data = ownData(input, ['source', 'archive', 'archiveCompanion', 'includeToolContent']);
    const companion = ownData(data.archiveCompanion, ['captureId', 'conversationKey', 'artifacts']);
    const captured = Object.getOwnPropertyDescriptor(data.archiveCompanion, 'capturedAt');
    if (captured && (!captured.enumerable || !('value' in captured))) return undefined;
    if (
      (data.source !== 'chatgpt' && data.source !== 'deepseek') ||
      typeof data.includeToolContent !== 'boolean' ||
      typeof companion.captureId !== 'string' ||
      !validCaptureId(data.source, companion.captureId) ||
      typeof companion.conversationKey !== 'string' ||
      !SHA256_PATTERN.test(companion.conversationKey)
    )
      return undefined;
    const { manifest, canonical } = structuredArtifacts(companion.artifacts);
    if (!archiveIdentityMatches(data.archive, data.source, companion, manifest, captured?.value))
      return undefined;
    return Object.freeze({
      source: data.source,
      archive: data.archive as LiskaThreadArchive,
      captureId: companion.captureId,
      conversationKey: companion.conversationKey,
      manifest,
      canonical,
      includeToolContent: data.includeToolContent,
    });
  } catch {
    return undefined;
  }
}

/** Fail-closed selected-view compatibility wrapper over the same archive evidence. */
export function retainStructuredPresentation(
  input: RetainStructuredPresentationInput
): StructuredPresentationContext | undefined {
  try {
    const base = retainStructuredArchivePresentation(input);
    if (!base) return undefined;
    const selection = ownData(input, ['targetNodeId', 'selectedNodeIds']);
    const selectedNodeIds = snapshotStructuredPresentationPath(
      base.archive,
      selection.targetNodeId,
      selection.selectedNodeIds
    );
    if (!selectedNodeIds) return undefined;
    return Object.freeze({
      source: base.source,
      archive: base.archive,
      captureId: base.captureId,
      conversationKey: base.conversationKey,
      manifest: base.manifest,
      canonical: base.canonical,
      targetNodeId: selection.targetNodeId as string,
      selectedNodeIds,
      includeToolContent: base.includeToolContent,
    });
  } catch {
    return undefined;
  }
}
