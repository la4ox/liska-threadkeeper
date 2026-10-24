/** One exact-canonical authorization boundary shared by selected and branch presentations. */
import { LISKA_THREAD_SCHEMA } from '../archive';
import {
  HTML_PRESENTATION_LIMITS,
  HtmlPresentationError,
  type HtmlAssetBindingSet,
  type HtmlPresentationLimits,
} from '../archive/presentation';
import { preflightJson } from '../archive/presentation/safety';
import { ARCHIVE_STAGE_MAX_BYTES } from '../lib/archive-stage-contract';
import { sha256Hex } from '../lib/sha256';
import {
  ARCHIVE_COMPANION_RELATIVE_PATHS,
  type ArchiveCompanionArtifactBase,
  type StructuredArchivePresentationContext,
  type StructuredPresentationContext,
} from '../lib/types';
import { snapshotStructuredPresentationPath } from './structured-presentation-path';

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
const BASE_KEYS = [
  'source',
  'archive',
  'captureId',
  'conversationKey',
  'manifest',
  'canonical',
  'includeToolContent',
] as const;
const SELECTION_KEYS = ['targetNodeId', 'selectedNodeIds'] as const;
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
    if (!descriptor?.enumerable || !('value' in descriptor)) fail('derived-html-context-invalid');
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
  return Object.freeze(data) as unknown as ArchiveCompanionArtifactBase;
}

function validEnvelope(data: Record<string, unknown>, selected: boolean): void {
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
    typeof data.includeToolContent !== 'boolean'
  )
    fail('derived-html-context-invalid');
  if (selected && (typeof data.targetNodeId !== 'string' || data.targetNodeId.length === 0))
    fail('derived-html-context-invalid');
}

function nodesOf(archive: unknown): Record<string, unknown> {
  const graph = ownData(archive, ['graph']).graph;
  const nodes = ownData(graph, ['nodes']).nodes;
  ownData(nodes, []);
  return nodes as Record<string, unknown>;
}

function inputIdentity(inputs: unknown): Record<string, unknown> {
  if (
    !Array.isArray(inputs) ||
    Object.getPrototypeOf(inputs) !== Array.prototype ||
    Object.getOwnPropertyDescriptor(inputs, 'length')?.value !== 1
  )
    fail('derived-html-context-invalid');
  const first = Object.getOwnPropertyDescriptor(inputs, '0');
  if (!first?.enumerable || !('value' in first)) fail('derived-html-context-invalid');
  return ownData(first.value, ['captureId', 'manifestSha256']);
}

function validCurrentNode(current: unknown, nodes: Record<string, unknown>): boolean {
  if (current === null) return true;
  if (typeof current !== 'string' || !current.length) return false;
  const descriptor = Object.getOwnPropertyDescriptor(nodes, current);
  return !!descriptor?.enumerable && 'value' in descriptor;
}

/** Small identity scalars are also checked after await without invoking archive getters. */
function archiveIdentity(context: StructuredArchivePresentationContext): readonly unknown[] {
  const archive = ownData(context.archive, ['schema', 'archiveId', 'inputs', 'conversation']);
  const input = inputIdentity(archive.inputs);
  const conversation = ownData(archive.conversation, ['provider', 'id', 'currentNodeId']);
  const current = conversation.currentNodeId;
  const nodes = nodesOf(context.archive);
  if (
    archive.schema !== LISKA_THREAD_SCHEMA ||
    conversation.provider !== context.source ||
    typeof conversation.id !== 'string' ||
    !conversation.id.length ||
    archive.archiveId !== `${context.source}:${conversation.id}` ||
    input.captureId !== context.captureId ||
    input.manifestSha256 !== context.manifest.sha256 ||
    !validCurrentNode(current, nodes)
  )
    fail('derived-html-context-invalid');
  return [
    archive.schema,
    archive.archiveId,
    input.captureId,
    input.manifestSha256,
    conversation.provider,
    conversation.id,
    current,
  ];
}

function snapshotContext(
  value: StructuredArchivePresentationContext,
  selected: boolean,
  limits: HtmlPresentationLimits,
  preflightArchive: boolean
): StructuredArchivePresentationContext {
  try {
    const data = ownData(value, selected ? [...BASE_KEYS, ...SELECTION_KEYS] : BASE_KEYS);
    validEnvelope(data, selected);
    // Preserve the selected API's established malformed-JSON/limit error ordering.
    // After await only the bounded selected array is preflighted again; structural
    // drift in the closure-private archive is checked below via own descriptors.
    if (preflightArchive) preflightJson(data.archive, limits);
    if (selected) preflightJson(data.selectedNodeIds, limits);
    const selectedNodeIds = selected
      ? snapshotStructuredPresentationPath(
          data.archive,
          data.targetNodeId,
          data.selectedNodeIds,
          limits.maxSelectedNodes
        )
      : undefined;
    if (selected && !selectedNodeIds) fail('derived-html-context-invalid');
    const context = {
      ...data,
      manifest: descriptor(data.manifest, 'manifest'),
      canonical: descriptor(data.canonical, 'canonical'),
      ...(selected ? { selectedNodeIds } : {}),
    } as unknown as StructuredArchivePresentationContext;
    archiveIdentity(context);
    return Object.freeze(context);
  } catch (error) {
    if (error instanceof HtmlPresentationError) throw error;
    fail('derived-html-context-invalid');
  }
}

function sameContext(
  left: StructuredArchivePresentationContext,
  right: StructuredArchivePresentationContext,
  selected: boolean
): boolean {
  const baseMatches = BASE_KEYS.every(key => {
    if (key === 'manifest' || key === 'canonical')
      return DESCRIPTOR_KEYS.every(field => {
        const name = field as keyof ArchiveCompanionArtifactBase;
        return left[key][name] === right[key][name];
      });
    return left[key] === right[key];
  });
  if (!baseMatches || !selected) return baseMatches;
  const a = left as StructuredPresentationContext;
  const b = right as StructuredPresentationContext;
  return (
    a.targetNodeId === b.targetNodeId &&
    a.selectedNodeIds.length === b.selectedNodeIds.length &&
    a.selectedNodeIds.every((id, index) => id === b.selectedNodeIds[index])
  );
}

function bindingDigest(bindings: HtmlAssetBindingSet | undefined): string | null {
  if (bindings === undefined) return null;
  try {
    const data = ownData(bindings, ['bindings', 'sha256']);
    // Full syntax, empty-set semantics and canonical agreement belong to the renderer.
    if (data.sha256 === null || (typeof data.sha256 === 'string' && SHA256.test(data.sha256)))
      return data.sha256 as string | null;
  } catch {
    /* Hostile traps never cross the value-free boundary. */
  }
  fail('derived-html-context-invalid');
}

async function canonicalDigest(context: StructuredArchivePresentationContext): Promise<string> {
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

interface AuthorizedHtmlContext<T extends StructuredArchivePresentationContext> {
  readonly context: T;
  readonly canonicalSha256: string;
  readonly assetBindingSha256: string | null;
}

export function authorizeDerivedHtmlContext(
  value: StructuredPresentationContext,
  bindings: HtmlAssetBindingSet | undefined,
  mode: 'selected',
  limits?: HtmlPresentationLimits
): Promise<AuthorizedHtmlContext<StructuredPresentationContext>>;
export function authorizeDerivedHtmlContext(
  value: StructuredArchivePresentationContext,
  bindings?: HtmlAssetBindingSet,
  mode?: 'archive',
  limits?: HtmlPresentationLimits
): Promise<AuthorizedHtmlContext<StructuredArchivePresentationContext>>;
/**
 * Exactly one JSON serialization/UTF-8 encoding/hash. No caller callbacks run here.
 * Archive bodies stay closure-private: callers MUST NOT mutate them while pending or
 * during a subsequent rendering session. We do not clone/rehash a potentially 64 MiB graph.
 * Scalar/descriptors/selection/identity are detached and rechecked across the sole await;
 * the renderer performs its own bounded schema/body preflight before reading content.
 */
export async function authorizeDerivedHtmlContext(
  value: StructuredArchivePresentationContext,
  bindings?: HtmlAssetBindingSet,
  mode: 'selected' | 'archive' = 'archive',
  limits: HtmlPresentationLimits = { ...HTML_PRESENTATION_LIMITS }
): Promise<AuthorizedHtmlContext<StructuredArchivePresentationContext>> {
  const selected = mode === 'selected';
  const context = snapshotContext(value, selected, limits, true);
  const identity = archiveIdentity(context);
  const assetBindingSha256 = bindingDigest(bindings);
  const canonicalSha256 = await canonicalDigest(context);
  const after = snapshotContext(value, selected, limits, false);
  const afterIdentity = archiveIdentity(after);
  if (
    !sameContext(context, after, selected) ||
    !identity.every((item, index) => item === afterIdentity[index]) ||
    bindingDigest(bindings) !== assetBindingSha256
  )
    fail('derived-html-context-invalid');
  return Object.freeze({ context, canonicalSha256, assetBindingSha256 });
}
