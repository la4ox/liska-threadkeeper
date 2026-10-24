/** Optional content-side byte authorization; no work occurs until explicitly called. */
import { getNodePath, LISKA_THREAD_SCHEMA } from '../archive';
import {
  HTML_PRESENTATION_LIMITS,
  HtmlPresentationError,
  renderArchiveHtml,
  type HtmlAssetBindingSet,
} from '../archive/presentation';
import { preflightJson } from '../archive/presentation/safety';
import { ARCHIVE_STAGE_MAX_BYTES } from '../lib/archive-stage-contract';
import {
  buildDerivedHtmlArtifact,
  DERIVED_HTML_MAX_BYTES,
  DerivedPresentationError,
  type DerivedHtmlArtifact,
} from '../lib/derived-presentation-contract';
import { sha256Hex } from '../lib/sha256';
import {
  ARCHIVE_COMPANION_RELATIVE_PATHS,
  type ArchiveCompanionArtifactBase,
  type StructuredPresentationContext,
} from '../lib/types';

export type DerivedHtmlPreparationErrorCode =
  | 'derived-html-context-invalid'
  | 'derived-html-canonical-serialization-failed'
  | 'derived-html-canonical-length-mismatch'
  | 'derived-html-canonical-hash-failed'
  | 'derived-html-canonical-hash-mismatch'
  | 'derived-html-render-failed'
  | 'derived-html-render-provenance-mismatch';

/** Value-free failures: native exceptions and provider values never escape. */
export class DerivedHtmlPreparationError extends Error {
  constructor(readonly code: DerivedHtmlPreparationErrorCode) {
    super(code);
    this.name = 'DerivedHtmlPreparationError';
  }
}

const SHA256 = /^[a-f0-9]{64}$/;
const CONTEXT_KEYS = [
  'source',
  'archive',
  'captureId',
  'conversationKey',
  'manifest',
  'canonical',
  'targetNodeId',
  'selectedNodeIds',
  'includeToolContent',
] as const;
const DESCRIPTOR_KEYS = ['kind', 'relativePath', 'mediaType', 'byteLength', 'sha256'];

function fail(code: DerivedHtmlPreparationErrorCode): never {
  throw new DerivedHtmlPreparationError(code);
}

/** Read only used own data, without touching subtype transport/raw evidence. */
function ownData(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail('derived-html-context-invalid');
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail('derived-html-context-invalid');
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      fail('derived-html-context-invalid');
    result[key] = descriptor.value;
  }
  return result;
}

function descriptor(value: unknown, kind: 'manifest' | 'canonical'): ArchiveCompanionArtifactBase {
  const data = ownData(value, DESCRIPTOR_KEYS);
  if (
    data.kind !== kind ||
    data.relativePath !== ARCHIVE_COMPANION_RELATIVE_PATHS[kind] ||
    data.mediaType !== 'application/json' ||
    typeof data.byteLength !== 'number' ||
    !Number.isSafeInteger(data.byteLength) ||
    data.byteLength <= 0 ||
    data.byteLength > ARCHIVE_STAGE_MAX_BYTES ||
    typeof data.sha256 !== 'string' ||
    !SHA256.test(data.sha256)
  )
    fail('derived-html-context-invalid');
  return data as unknown as ArchiveCompanionArtifactBase;
}

function validEnvelope(data: Record<string, unknown>): void {
  if (
    (data.source !== 'chatgpt' && data.source !== 'deepseek') ||
    typeof data.captureId !== 'string' ||
    !(
      data.source === 'chatgpt'
        ? /^capture-chatgpt-[A-Za-z0-9][A-Za-z0-9_-]{0,239}$/
        : /^capture-deepseek-[A-Za-z0-9][A-Za-z0-9_-]{0,235}$/
    ).test(data.captureId) ||
    typeof data.conversationKey !== 'string' ||
    !SHA256.test(data.conversationKey) ||
    typeof data.targetNodeId !== 'string' ||
    data.targetNodeId.length === 0 ||
    typeof data.includeToolContent !== 'boolean'
  )
    fail('derived-html-context-invalid');
}

function validateIdentity(context: StructuredPresentationContext): void {
  const { archive, source, captureId, manifest } = context;
  const input = archive.inputs[0];
  const current = archive.conversation.currentNodeId;
  if (
    archive.schema !== LISKA_THREAD_SCHEMA ||
    archive.inputs.length !== 1 ||
    !input ||
    archive.conversation.provider !== source ||
    typeof archive.conversation.id !== 'string' ||
    archive.conversation.id.length === 0 ||
    archive.archiveId !== `${source}:${archive.conversation.id}` ||
    input.captureId !== captureId ||
    input.manifestSha256 !== manifest.sha256 ||
    (current !== null && !Object.prototype.hasOwnProperty.call(archive.graph.nodes, current))
  )
    fail('derived-html-context-invalid');
  validateSelectedPath(context);
}

function validateSelectedPath(context: StructuredPresentationContext): void {
  const { archive, targetNodeId, selectedNodeIds } = context;
  if (
    !Array.isArray(selectedNodeIds) ||
    selectedNodeIds.length === 0 ||
    selectedNodeIds.length > HTML_PRESENTATION_LIMITS.maxSelectedNodes
  )
    fail('derived-html-context-invalid');
  const path = getNodePath(archive, targetNodeId);
  if (
    path.length !== selectedNodeIds.length ||
    !path.every((nodeId, index) => nodeId === selectedNodeIds[index])
  )
    fail('derived-html-context-invalid');
}

function snapshotContext(
  value: StructuredPresentationContext,
  preflightArchive = true
): StructuredPresentationContext {
  try {
    const data = ownData(value, CONTEXT_KEYS);
    validEnvelope(data);
    // Exclude getters, custom codecs, cycles and excessive traversal before serialization.
    if (preflightArchive) preflightJson(data.archive, { ...HTML_PRESENTATION_LIMITS });
    preflightJson(data.selectedNodeIds, { ...HTML_PRESENTATION_LIMITS });
    const context = {
      ...data,
      manifest: descriptor(data.manifest, 'manifest'),
      canonical: descriptor(data.canonical, 'canonical'),
      selectedNodeIds: [...(data.selectedNodeIds as readonly string[])],
    } as unknown as StructuredPresentationContext;
    validateIdentity(context);
    return context;
  } catch (error) {
    if (error instanceof HtmlPresentationError) throw error;
    fail('derived-html-context-invalid');
  }
}

function sameContext(left: StructuredPresentationContext, right: StructuredPresentationContext) {
  return CONTEXT_KEYS.every(key => {
    if (key === 'manifest' || key === 'canonical')
      return DESCRIPTOR_KEYS.every(field => {
        const name = field as keyof ArchiveCompanionArtifactBase;
        return left[key][name] === right[key][name];
      });
    if (key === 'selectedNodeIds')
      return (
        left[key].length === right[key].length &&
        left[key].every((nodeId, index) => nodeId === right[key][index])
      );
    return left[key] === right[key];
  });
}

function bindingDigest(bindings: HtmlAssetBindingSet | undefined): string | null {
  if (bindings === undefined) return null;
  try {
    const data = ownData(bindings, ['bindings', 'sha256']);
    // Full binding syntax, empty-set semantics and canonical agreement belong to the renderer.
    if (data.sha256 === null || (typeof data.sha256 === 'string' && SHA256.test(data.sha256)))
      return data.sha256 as string | null;
  } catch {
    // Hostile traps never cross the value-free preparation boundary.
  }
  fail('derived-html-context-invalid');
}

async function authorizeCanonical(context: StructuredPresentationContext): Promise<string> {
  let bytes: Uint8Array;
  try {
    const json = JSON.stringify(context.archive, null, 2);
    if (
      typeof json !== 'string' ||
      json.length > ARCHIVE_STAGE_MAX_BYTES ||
      json.length > context.canonical.byteLength
    )
      fail('derived-html-canonical-length-mismatch');
    bytes = new TextEncoder().encode(json);
  } catch (error) {
    if (error instanceof DerivedHtmlPreparationError) throw error;
    fail('derived-html-canonical-serialization-failed');
  }
  if (bytes.byteLength !== context.canonical.byteLength)
    fail('derived-html-canonical-length-mismatch');
  let digest: string;
  try {
    digest = await sha256Hex(bytes);
  } catch {
    fail('derived-html-canonical-hash-failed');
  }
  if (digest !== context.canonical.sha256) fail('derived-html-canonical-hash-mismatch');
  return digest;
}

/**
 * Authorize one retained canonical for optional HTML, without recapture or Markdown projection.
 * The archive is a trusted closure-private extension reference: deliberately do not clone a
 * potentially 64 MiB graph. Callers must not mutate its body while this promise is pending.
 * No caller-supplied hash/renderer callbacks run across that boundary. Bounded scalar/path
 * evidence is detached and revalidated after the single canonical hash.
 */
export async function prepareDerivedHtmlArtifact(
  value: StructuredPresentationContext,
  assetBindings?: HtmlAssetBindingSet
): Promise<DerivedHtmlArtifact> {
  const context = snapshotContext(value);
  const assetBindingSha256 = bindingDigest(assetBindings);
  const digest = await authorizeCanonical(context);
  if (
    !sameContext(context, snapshotContext(value, false)) ||
    bindingDigest(assetBindings) !== assetBindingSha256
  )
    fail('derived-html-context-invalid');
  try {
    const result = renderArchiveHtml({
      archive: context.archive,
      canonicalSha256: digest,
      targetNodeId: context.targetNodeId,
      profile: { includeToolContent: context.includeToolContent },
      limits: { maxHtmlChars: DERIVED_HTML_MAX_BYTES, maxHtmlBytes: DERIVED_HTML_MAX_BYTES },
      ...(assetBindings === undefined ? {} : { assetBindings }),
    });
    if (result.canonicalSha256 !== digest || result.assetBindingSha256 !== assetBindingSha256)
      fail('derived-html-render-provenance-mismatch');
    return await buildDerivedHtmlArtifact(
      result.html,
      { sourceCanonicalSha256: digest, assetBindingSha256 },
      sha256Hex
    );
  } catch (error) {
    if (
      error instanceof HtmlPresentationError ||
      error instanceof DerivedPresentationError ||
      error instanceof DerivedHtmlPreparationError
    )
      throw error;
    fail('derived-html-render-failed');
  }
}
