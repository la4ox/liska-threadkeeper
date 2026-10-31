import {
  buildCaptureManifest,
  validateCaptureBundleShape,
  verifyCaptureBundleIntegrity,
  type RawCaptureArtifact,
  type RawCaptureManifest,
} from '../../capture';
import {
  LISKA_THREAD_SCHEMA,
  type ArchiveAsset,
  type ArchiveMessage,
  type LiskaThreadArchive,
} from '../../types';
import { validateLiskaThreadArchive } from '../../validate';
import {
  CLAUDE_NORMALIZER_ID,
  ClaudeNormalizationError,
  fail,
  type ClaudeContext,
  type ClaudeNormalizationInput,
  type ClaudeNormalizationResult,
  type ClaudeRecord,
} from './contracts';
import { claudeMessageBlocks, observedClaudeUnknownTypes } from './content';
import {
  parseClaudeDetail,
  parseClaudeTopology,
  type ClaudeTopology,
  type ParsedClaudeMessage,
} from './graph';
import { inventoryClaudeRawAssets, type ClaudeAssetInventory } from './inventory';
import { CLAUDE_SOURCE_FORMAT } from './contracts';
import {
  at,
  diagnostic,
  identifier,
  isRecord,
  nullableText,
  ref,
  residual,
  sanitize,
  timestamp,
} from './privacy';

/** Pre-manifest identity/type inventory only; malformed topology must remain capturable as raw evidence. */
export function preflightClaudeDetailArtifact(
  bytes: Uint8Array,
  expectedConversationId: string
): string[] {
  const detail = parseJson(bytes);
  if (!isRecord(detail)) fail('malformed-raw-artifact', 'Claude detail must be a plain object.');
  if (identifier(detail.uuid, '/uuid') !== expectedConversationId)
    fail('conversation-id-mismatch', 'Claude detail UUID does not match the capture conversation.');
  return Array.isArray(detail.chat_messages)
    ? observedClaudeUnknownTypes(detail.chat_messages)
    : [];
}

export async function normalizeClaudeCapture(
  input: ClaudeNormalizationInput
): Promise<ClaudeNormalizationResult> {
  try {
    const { manifest, artifact } = await verifyProvenance(input);
    const raw = parseJson(artifact.bytes);
    const detail = parseClaudeDetail(raw, manifest.conversationId);
    const context: ClaudeContext = {
      artifactId: input.artifactId,
      diagnostics: [],
      diagnosticKeys: new Set(),
      unknownTypes: new Set(),
    };
    const topology = parseClaudeTopology(detail, context);
    const inventory = await inventoryClaudeRawAssets({
      raw,
      artifactId: input.artifactId,
      sha256: input.sha256,
    });
    if (JSON.stringify(manifest.assets) !== JSON.stringify(inventory.assets))
      fail(
        'asset-inventory-mismatch',
        'Claude metadata-only asset inventory does not match the verified artifact.'
      );
    const unknownTypes = observedClaudeUnknownTypes(detail.chat_messages);
    if (JSON.stringify(unknownTypes) !== JSON.stringify(manifest.observedUnknownContentTypes))
      fail(
        'unknown-content-types-mismatch',
        'Claude observed content types do not match the verified artifact.'
      );
    const archive = buildArchive(input, manifest, detail, topology, inventory, context);
    if (JSON.stringify([...context.unknownTypes].sort()) !== JSON.stringify(unknownTypes))
      fail(
        'unknown-content-types-mismatch',
        'Claude normalized content types disagree with raw preflight.'
      );
    const validation = validateLiskaThreadArchive(archive);
    if (!validation.valid)
      fail(
        'invalid-normalized-archive',
        'Claude normalization did not produce a valid liska-thread/1 archive.'
      );
    return { archive, observedUnknownContentTypes: unknownTypes };
  } catch (error) {
    if (error instanceof ClaudeNormalizationError) throw error;
    throw new ClaudeNormalizationError(
      'invalid-manifest',
      'Claude capture manifest or runtime bundle is malformed.'
    );
  }
}

async function verifyProvenance(
  input: ClaudeNormalizationInput
): Promise<{ manifest: RawCaptureManifest; artifact: RawCaptureArtifact }> {
  if (!isRecord(input) || !isRecord(input.bundle) || typeof input.sha256 !== 'function')
    fail('invalid-manifest', 'A Claude raw capture bundle and SHA-256 verifier are required.');
  const manifest = canonicalManifest(input.bundle.manifest);
  identifier(input.artifactId, 'artifactId');
  if (typeof input.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.manifestSha256))
    fail('invalid-manifest-hash', 'manifestSha256 must be lowercase SHA-256.');
  let actualManifestHash: string;
  try {
    actualManifestHash = await input.sha256(
      new TextEncoder().encode(JSON.stringify(manifest, null, 2))
    );
  } catch {
    fail('manifest-integrity-failed', 'Capture manifest integrity could not be verified.');
  }
  if (actualManifestHash !== input.manifestSha256)
    fail('manifest-integrity-failed', 'Capture manifest SHA-256 does not match.');
  try {
    validateCaptureBundleShape(input.bundle);
    await verifyCaptureBundleIntegrity(input.bundle, input.sha256);
  } catch {
    fail('artifact-integrity-failed', 'Capture artifact bytes do not match the manifest.');
  }
  const artifact = input.bundle.artifacts.find(item => item.record.id === input.artifactId);
  if (!artifact)
    fail('artifact-not-in-manifest', 'Selected Claude artifact is not in the manifest.');
  if (artifact.record.mediaType.split(';', 1)[0].trim().toLowerCase() !== 'application/json')
    fail('invalid-manifest', 'Selected Claude detail artifact must be JSON.');
  return { manifest, artifact };
}

function canonicalManifest(candidate: unknown): RawCaptureManifest {
  if (!isRecord(candidate)) fail('invalid-manifest', 'Capture manifest must be an object.');
  try {
    const manifest = candidate as unknown as RawCaptureManifest;
    const canonical = buildCaptureManifest({ ...manifest });
    if (manifest.provider !== 'claude' || JSON.stringify(canonical) !== JSON.stringify(candidate))
      fail(
        'invalid-manifest',
        'Capture manifest must be a canonical Claude liska-capture/1 manifest.'
      );
    return manifest;
  } catch (error) {
    if (error instanceof ClaudeNormalizationError) throw error;
    fail('invalid-manifest', 'Claude capture manifest is malformed.');
  }
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    fail('malformed-raw-artifact', 'Claude detail is not valid UTF-8 JSON.');
  }
}

function buildArchive(
  input: ClaudeNormalizationInput,
  manifest: RawCaptureManifest,
  detail: ClaudeRecord & { chat_messages: unknown[] },
  topology: ClaudeTopology,
  inventory: ClaudeAssetInventory,
  context: ClaudeContext
): LiskaThreadArchive {
  const assets = canonicalAssets(inventory, context);
  const assetIdsByPointer = new Map(
    inventory.assets.flatMap(asset =>
      asset.sourceRefs.map(source => [source.rawPointer, asset.id] as const)
    )
  );
  for (const parsed of topology.messages)
    topology.graph.nodes[parsed.id].message = normalizeMessage(parsed, {
      ...context,
      assetIdsByPointer,
    });
  const conversationSource = ref(context, 'conversation', '', manifest.conversationId);
  const conversation = {
    id: manifest.conversationId,
    title: nullableText(detail.name, context, '/name'),
    provider: 'claude',
    url: `https://claude.ai/chat/${encodeURIComponent(manifest.conversationId)}`,
    currentNodeId: topology.currentNodeId,
    createdAt: timestamp(detail.created_at, '/created_at'),
    updatedAt: timestamp(detail.updated_at, '/updated_at'),
    metadata: {},
    sourceRefs: [conversationSource],
    extensions: residual(
      detail,
      ['uuid', 'name', 'current_leaf_message_uuid', 'created_at', 'updated_at', 'chat_messages'],
      context,
      ''
    ),
  };
  for (const aspect of ['graph', 'messages', 'branches', 'assets'] as const) {
    const state = manifest.completeness[aspect];
    if (state !== 'complete')
      diagnostic(
        context,
        `capture-${aspect}-${state}`,
        '',
        `Raw capture marked ${aspect} as ${state}.`,
        state === 'partial' ? 'warning' : 'info'
      );
  }
  return {
    schema: LISKA_THREAD_SCHEMA,
    archiveId: `claude:${manifest.conversationId}`,
    inputs: [
      {
        captureId: manifest.captureId,
        manifestSha256: input.manifestSha256,
        normalizer: CLAUDE_NORMALIZER_ID,
        capturedAt: manifest.capturedAt,
        sourceRefs: [conversationSource],
        extensions: {
          claude: { rawArtifactId: input.artifactId, completeness: { ...manifest.completeness } },
        },
      },
    ],
    conversation,
    graph: topology.graph,
    assets,
    diagnostics: { entries: context.diagnostics, extensions: {} },
    extensions: {
      claude: { normalizer: CLAUDE_NORMALIZER_ID, sourceFormat: CLAUDE_SOURCE_FORMAT },
    },
  };
}

function normalizeMessage(
  parsed: ParsedClaudeMessage,
  context: Parameters<typeof claudeMessageBlocks>[4]
): ArchiveMessage {
  const { value, pointer, id } = parsed;
  if (typeof value.sender !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(value.sender))
    fail('invalid-role', `${at(pointer, 'sender')} must be a bounded role.`);
  const providerRole = value.sender.toLowerCase();
  const role = providerRole === 'human' ? 'user' : providerRole;
  if (value.truncated === true)
    diagnostic(
      context,
      'provider-message-truncated',
      at(pointer, 'truncated'),
      'Claude explicitly marked this message as truncated.'
    );
  const blocks = claudeMessageBlocks(value, id, role, pointer, context);
  return {
    id,
    author: { role, name: null },
    recipient: null,
    channel: null,
    createdAt: timestamp(value.created_at, at(pointer, 'created_at')),
    updatedAt: timestamp(value.updated_at, at(pointer, 'updated_at')),
    status: nullableText(value.stop_reason, context, at(pointer, 'stop_reason')),
    model: nullableText(value.model, context, at(pointer, 'model')),
    visibility: null,
    blocks,
    sourceRefs: [ref(context, 'message', pointer, id)],
    // sender, index and truncated stay exact provider evidence in the namespace.
    extensions: residual(
      value,
      [
        'uuid',
        'parent_message_uuid',
        'text',
        'content',
        'created_at',
        'updated_at',
        'stop_reason',
        'model',
        'attachments',
        'files',
        'citations',
        'artifacts',
      ],
      context,
      pointer
    ),
  };
}

function canonicalAssets(
  inventory: ClaudeAssetInventory,
  context: ClaudeContext
): Record<string, ArchiveAsset> {
  const assets: Record<string, ArchiveAsset> = {};
  for (const { record, metadata } of inventory.discovered) {
    const first = metadata[0];
    const value = first.value;
    const filename = firstString(value, ['file_name', 'filename', 'name']);
    const source = isRecord(value.source) ? value.source : {};
    const mimeType =
      firstString(value, ['content_type', 'mime_type', 'media_type']) ??
      firstString(source, ['media_type']);
    const size = value.file_size ?? value.size ?? value.byte_length;
    assets[record.id] = {
      id: record.id,
      filename: nullableText(filename, context, first.pointer),
      mimeType: mimeType !== null && /^[\w.+-]+\/[\w.+-]+$/.test(mimeType) ? mimeType : null,
      byteLength: typeof size === 'number' && Number.isSafeInteger(size) && size >= 0 ? size : null,
      dimensions: null,
      sha256: null,
      localArtifactRef: null,
      acquisition: { state: 'not-attempted', attemptedAt: null, detail: 'metadata-only' },
      sourceRefs: record.sourceRefs.map(source => ref(context, 'attachment', source.rawPointer)),
      extensions: {
        claude: {
          metadata: metadata.map(item => ({
            rawPointer: item.pointer,
            value: sanitize(item.value, context, item.pointer),
          })),
        },
      },
    };
  }
  return assets;
}

function firstString(value: ClaudeRecord, fields: string[]): string | null {
  for (const field of fields) if (typeof value[field] === 'string') return value[field] as string;
  return null;
}
