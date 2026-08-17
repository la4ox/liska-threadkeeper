import { LISKA_THREAD_SCHEMA, type JsonValue, type LiskaThreadArchive } from '../../types';
import {
  buildCaptureManifest,
  validateCaptureBundleShape,
  verifyCaptureBundleIntegrity,
  type RawCaptureArtifact,
  type RawCaptureManifest,
} from '../../capture';
import { validateLiskaThreadArchive } from '../../validate';
import {
  DEFAULT_SOURCE_FORMAT,
  HASH_PATTERN,
  NORMALIZER_ID,
  ChatGptNormalizationError,
  type BlockContext,
  type ChatGptNormalizationInput,
  type ChatGptNormalizationResult,
  type JsonRecord,
  type RawEnvelope,
} from './contracts';
import { manifestAssetsById, reconcileManifestAssets } from './assets';
import { normalizeGraph } from './graph';
import {
  assertSafeIdentifier,
  fail,
  hasOwn,
  isPlainRecord,
  normalizeTimestamp,
  nullableString,
  optionalTimestamp,
  pointerAt,
  providerFields,
  redactSensitiveUrls,
  sanitizeJson,
  sourceRef,
} from './privacy';

export async function normalizeChatGptCapture(
  input: ChatGptNormalizationInput
): Promise<ChatGptNormalizationResult> {
  try {
    const { manifest, artifact } = await verifyInputProvenance(input);
    const context = createContext(input, manifest);
    const envelope = extractEnvelope(parseArtifactJson(artifact));
    const conversationId = conversationIdFrom(
      envelope.conversation,
      envelope.basePointer,
      manifest
    );
    const graph = normalizeGraph(envelope, context);
    reconcileManifestAssets(context);
    const archive = buildArchive(input, manifest, envelope, conversationId, graph, context);
    assertArchiveValidity(archive);
    return { archive, observedUnknownContentTypes: [...context.observedUnknownContentTypes] };
  } catch (error) {
    if (error instanceof ChatGptNormalizationError) throw error;
    throw new ChatGptNormalizationError(
      'invalid-manifest',
      'ChatGPT capture manifest or runtime bundle is malformed.'
    );
  }
}

async function verifyInputProvenance(
  input: ChatGptNormalizationInput
): Promise<{ manifest: RawCaptureManifest; artifact: RawCaptureArtifact }> {
  if (!isPlainRecord(input) || !isPlainRecord(input.bundle)) {
    fail('invalid-manifest', 'A raw capture bundle is required.');
  }
  const manifest = validateManifest(input.bundle.manifest, input.artifactId, input.manifestSha256);
  if (typeof input.sha256 !== 'function') {
    fail('invalid-manifest', 'A SHA-256 verifier is required.');
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  let actualManifestHash: string;
  try {
    actualManifestHash = await input.sha256(manifestBytes);
  } catch {
    fail('manifest-integrity-failed', 'Capture manifest SHA-256 could not be verified.');
  }
  if (actualManifestHash !== input.manifestSha256) {
    fail('manifest-integrity-failed', 'Capture manifest SHA-256 does not match the supplied hash.');
  }
  try {
    validateCaptureBundleShape(input.bundle);
    await verifyCaptureBundleIntegrity(input.bundle, input.sha256);
  } catch {
    fail('artifact-integrity-failed', 'Capture artifact bytes do not match the capture manifest.');
  }
  const artifact = input.bundle.artifacts.find(
    candidate => candidate.record.id === input.artifactId
  );
  if (!artifact) {
    fail(
      'artifact-not-in-manifest',
      `Artifact ${input.artifactId} is not listed in the capture manifest.`
    );
  }
  return { manifest, artifact };
}

function validateManifest(
  candidate: unknown,
  artifactId: unknown,
  manifestSha256: unknown
): RawCaptureManifest {
  if (!isPlainRecord(candidate))
    fail('invalid-manifest', 'A plain raw capture manifest is required.');
  const manifest = canonicalManifest(candidate);
  if (manifest.schema !== 'liska-capture/1' || manifest.provider !== 'chatgpt') {
    fail(
      'invalid-manifest',
      'The raw capture manifest must describe a ChatGPT liska-capture/1 capture.'
    );
  }
  assertSafeIdentifier(manifest.captureId, 'manifest.captureId');
  assertSafeIdentifier(manifest.conversationId, 'manifest.conversationId');
  normalizeTimestamp(manifest.capturedAt, 'manifest.capturedAt');
  if (typeof manifestSha256 !== 'string' || !HASH_PATTERN.test(manifestSha256))
    fail('invalid-manifest-hash', 'manifestSha256 must be 64 hexadecimal characters.');
  assertSafeIdentifier(artifactId, 'artifactId');
  const artifact = manifest.artifacts.find(candidate => candidate.id === artifactId);
  if (!artifact)
    fail(
      'artifact-not-in-manifest',
      `Artifact ${artifactId} is not listed in the capture manifest.`
    );
  if (!isJsonMediaType(artifact.mediaType))
    fail('invalid-manifest', 'Selected artifact mediaType must have application/json essence.');
  return manifest;
}

/** Reject hand-written or lossy manifests: their pretty JSON is part of the evidence hash. */
function canonicalManifest(candidate: Record<string, unknown>): RawCaptureManifest {
  try {
    const manifest = candidate as unknown as RawCaptureManifest;
    const normalized = buildCaptureManifest({
      captureId: manifest.captureId,
      provider: manifest.provider,
      conversationId: manifest.conversationId,
      capturedAt: manifest.capturedAt,
      method: manifest.method,
      artifacts: manifest.artifacts,
      assets: manifest.assets,
      completeness: manifest.completeness,
      warnings: manifest.warnings,
      observedUnknownContentTypes: manifest.observedUnknownContentTypes,
    });
    if (JSON.stringify(candidate) !== JSON.stringify(normalized)) {
      fail('invalid-manifest', 'Capture manifest is not canonical liska-capture/1 metadata.');
    }
    return manifest;
  } catch (error) {
    if (error instanceof ChatGptNormalizationError) throw error;
    fail('invalid-manifest', 'Capture manifest is malformed.');
  }
}

function isJsonMediaType(value: unknown): boolean {
  return (
    typeof value === 'string' && value.split(';', 1)[0].trim().toLowerCase() === 'application/json'
  );
}

function createContext(
  input: ChatGptNormalizationInput,
  manifest: RawCaptureManifest
): BlockContext {
  const format = input.sourceFormat ?? DEFAULT_SOURCE_FORMAT;
  if (typeof format !== 'string' || format.length === 0 || format.length > 255) {
    fail('invalid-source-format', 'sourceFormat must be a bounded non-empty string.');
  }
  return {
    assets: {},
    assetIdsByIdentity: new Map(),
    manifestAssets: manifestAssetsById(manifest.assets),
    artifactId: input.artifactId,
    format,
    privacy: { redactions: [] },
    observedUnknownContentTypes: new Set(),
  };
}

function parseArtifactJson(artifact: RawCaptureArtifact): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(artifact.bytes));
  } catch {
    fail('malformed-raw-artifact', 'Selected ChatGPT artifact is not valid UTF-8 JSON.');
  }
}

function extractEnvelope(raw: unknown): RawEnvelope {
  if (!isPlainRecord(raw))
    fail('malformed-raw', 'ChatGPT raw history must be a plain JSON object.');
  const rootGraph = isPlainRecord(raw.mapping);
  const nested = hasOwn(raw, 'conversation') ? raw.conversation : undefined;
  const nestedGraph = isPlainRecord(nested) && isPlainRecord(nested.mapping);
  if (rootGraph && nestedGraph)
    fail('ambiguous-envelope', 'Raw capture has two possible ChatGPT conversation graphs.');
  if (rootGraph) return { conversation: raw, basePointer: '' };
  if (nestedGraph) return { conversation: nested, basePointer: '/conversation' };
  fail('missing-graph', 'Raw capture does not contain a ChatGPT mapping graph.');
}

function conversationIdFrom(
  conversation: JsonRecord,
  pointer: string,
  manifest: RawCaptureManifest
): string {
  const fields = ['conversation_id', 'id'].filter(field => hasOwn(conversation, field));
  if (fields.length === 0)
    fail('missing-conversation-id', 'ChatGPT raw capture has no conversation ID.');
  const values = fields.map(field => {
    assertSafeIdentifier(conversation[field], pointerAt(pointer, field));
    return conversation[field];
  });
  if (new Set(values).size !== 1)
    fail('ambiguous-conversation-id', 'ChatGPT conversation ID aliases disagree.');
  const conversationId = values[0];
  if (conversationId !== manifest.conversationId)
    fail('conversation-id-mismatch', 'Raw conversation ID does not match the capture manifest.');
  return conversationId;
}

function buildArchive(
  input: ChatGptNormalizationInput,
  manifest: RawCaptureManifest,
  envelope: RawEnvelope,
  conversationId: string,
  graph: ReturnType<typeof normalizeGraph>,
  context: BlockContext
): LiskaThreadArchive {
  const source = sourceRef(context, 'conversation', conversationId, envelope.basePointer);
  return {
    schema: LISKA_THREAD_SCHEMA,
    archiveId: `chatgpt:${conversationId}`,
    inputs: [archiveInput(input, manifest, envelope, source)],
    conversation: archiveConversation(envelope, conversationId, graph, source, context),
    graph: { rootIds: graph.rootIds, nodes: graph.nodes },
    assets: context.assets,
    diagnostics: {
      entries: diagnosticsFor(manifest, context, envelope.basePointer),
      extensions: {},
    },
    extensions: { openai: { normalizer: NORMALIZER_ID, sourceFormat: context.format } },
  };
}

function archiveInput(
  input: ChatGptNormalizationInput,
  manifest: RawCaptureManifest,
  envelope: RawEnvelope,
  source: ReturnType<typeof sourceRef>
): LiskaThreadArchive['inputs'][number] {
  return {
    captureId: manifest.captureId,
    manifestSha256: input.manifestSha256,
    normalizer: NORMALIZER_ID,
    capturedAt: normalizeTimestamp(manifest.capturedAt, 'manifest.capturedAt'),
    sourceRefs: [source],
    extensions: {
      openai: {
        rawArtifactId: input.artifactId,
        envelope: envelope.basePointer === '' ? 'root' : 'conversation',
      },
    },
  };
}

function archiveConversation(
  envelope: RawEnvelope,
  conversationId: string,
  graph: ReturnType<typeof normalizeGraph>,
  source: ReturnType<typeof sourceRef>,
  context: BlockContext
): LiskaThreadArchive['conversation'] {
  const raw = envelope.conversation;
  if (typeof raw.url === 'string') {
    redactSensitiveUrls(raw.url, context.privacy, pointerAt(envelope.basePointer, 'url'));
  }
  return {
    id: conversationId,
    title: redactedNullableString(raw, 'title', pointerAt(envelope.basePointer, 'title'), context),
    provider: 'chatgpt',
    url: canonicalConversationUrl(conversationId),
    currentNodeId: graph.currentNodeId,
    createdAt: optionalTimestamp(
      raw,
      ['create_time', 'created_at', 'createdAt'],
      envelope.basePointer
    ),
    updatedAt: optionalTimestamp(
      raw,
      ['update_time', 'updated_at', 'updatedAt'],
      envelope.basePointer
    ),
    metadata: conversationMetadata(raw, context, envelope.basePointer),
    sourceRefs: [source],
    extensions: {
      openai: providerFields(
        raw,
        mappedConversationFields(),
        context.privacy,
        envelope.basePointer
      ),
    },
  };
}

function canonicalConversationUrl(conversationId: string): string {
  return `https://chatgpt.com/c/${encodeURIComponent(conversationId)}`;
}

function redactedNullableString(
  record: JsonRecord,
  field: string,
  pointer: string,
  context: BlockContext
): string | null {
  const value = nullableString(record, field, pointer);
  return value === null ? null : redactSensitiveUrls(value, context.privacy, pointer);
}

function mappedConversationFields(): Set<string> {
  return new Set([
    'mapping',
    'current_node',
    'currentNodeId',
    'conversation_id',
    'id',
    'title',
    'create_time',
    'created_at',
    'createdAt',
    'update_time',
    'updated_at',
    'updatedAt',
    'url',
  ]);
}

function conversationMetadata(
  conversation: JsonRecord,
  context: BlockContext,
  pointer: string
): Record<string, JsonValue> {
  const metadata: Record<string, JsonValue> = {};
  const fieldMap: Array<[string, string]> = [
    ['isArchived', 'is_archived'],
    ['isDoNotRemember', 'is_do_not_remember'],
    ['gizmoId', 'gizmo_id'],
    ['templateId', 'conversation_template_id'],
    ['asyncStatus', 'async_status'],
  ];
  fieldMap.forEach(([canonical, provider]) => {
    if (hasOwn(conversation, provider))
      metadata[canonical] = sanitizeJson(
        conversation[provider],
        context.privacy,
        pointerAt(pointer, provider)
      ).value;
  });
  return metadata;
}

function diagnosticsFor(
  manifest: RawCaptureManifest,
  context: BlockContext,
  pointer: string
): LiskaThreadArchive['diagnostics']['entries'] {
  const source = sourceRef(context, 'conversation', manifest.conversationId, pointer);
  const completeness = manifestCompletenessDiagnostics(manifest, source);
  const unknown = [...context.observedUnknownContentTypes].map(type => ({
    severity: 'info' as const,
    code: 'unknown-content-type',
    message: `Retained ChatGPT content type ${type} as an unknown block.`,
    path: null,
    sourceRefs: [source],
    extensions: { openai: { contentType: type } },
  }));
  const privacy = context.privacy.redactions.map(redaction => ({
    severity: 'warning' as const,
    code: redaction.code,
    message: redaction.message,
    path: null,
    sourceRefs: [sourceRef(context, 'privacy-redaction', null, redaction.pointer)],
    extensions: {},
  }));
  return [...completeness, ...unknown, ...privacy];
}

function manifestCompletenessDiagnostics(
  manifest: RawCaptureManifest,
  source: ReturnType<typeof sourceRef>
): LiskaThreadArchive['diagnostics']['entries'] {
  return (['graph', 'messages', 'branches', 'assets'] as const)
    .filter(aspect => manifest.completeness[aspect] !== 'complete')
    .map(aspect => ({
      severity:
        manifest.completeness[aspect] === 'partial' ? ('warning' as const) : ('info' as const),
      code: `capture-${aspect}-${manifest.completeness[aspect]}`,
      message: `Raw capture marked ${aspect} as ${manifest.completeness[aspect]}.`,
      path: null,
      sourceRefs: [source],
      extensions: {},
    }));
}

function assertArchiveValidity(archive: LiskaThreadArchive): void {
  const validation = validateLiskaThreadArchive(archive);
  if (validation.valid) return;
  const issue = validation.issues.find(entry => entry.severity === 'error');
  fail(
    'invalid-output',
    `ChatGPT normalizer produced an invalid archive${issue ? ` (${issue.code} at ${issue.path})` : ''}.`
  );
}
