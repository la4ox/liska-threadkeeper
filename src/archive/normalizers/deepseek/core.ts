import {
  buildCaptureManifest,
  validateCaptureBundleShape,
  verifyCaptureBundleIntegrity,
  type RawCaptureArtifact,
  type RawCaptureManifest,
} from '../../capture';
import {
  LISKA_THREAD_SCHEMA,
  type ArchiveBlock,
  type LiskaThreadArchive,
  type NamespacedExtensions,
} from '../../types';
import { validateLiskaThreadArchive } from '../../validate';
import {
  DEEPSEEK_NORMALIZER_ID,
  DEEPSEEK_SOURCE_FORMAT,
  DeepSeekNormalizationError,
  deepSeekFail,
  type DeepSeekJsonRecord,
  type DeepSeekNormalizationInput,
  type DeepSeekNormalizationResult,
} from './contracts';
import {
  hasOwn,
  isPlainRecord,
  normalizeTimestamp,
  pointerAt,
  redactSensitiveText,
  requireSafeIdentifier,
  sanitizeJson,
  sourceRef,
  type DeepSeekPrivacyTracker,
} from './privacy';

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ENVELOPE_POINTER = '/data/biz_data';
const SESSION_POINTER = `${ENVELOPE_POINTER}/chat_session`;
const MESSAGES_POINTER = `${ENVELOPE_POINTER}/chat_messages`;
const KNOWN_FRAGMENT_TYPES = new Set(['REQUEST', 'RESPONSE', 'TEMPLATE_RESPONSE', 'THINK']);
const MAPPED_MESSAGE_FIELDS = new Set([
  'message_id',
  'id',
  'parent_id',
  'role',
  'name',
  'recipient',
  'channel',
  'created_at',
  'create_time',
  'updated_at',
  'update_time',
  'status',
  'model',
  'visibility',
  'fragments',
  'content',
  'thinking_content',
]);

interface DeepSeekEnvelope {
  session: DeepSeekJsonRecord;
  messages: unknown[];
}

interface ParsedMessage {
  id: string;
  parentId: string | null;
  pointer: string;
  value: DeepSeekJsonRecord;
}

interface NormalizationContext {
  artifactId: string;
  format: string;
  privacy: DeepSeekPrivacyTracker;
  unknownTypes: Set<string>;
}

/**
 * Minimal pre-manifest gate. Only a response without an explicit cache delta
 * for the requested session may claim complete graph/message/branch capture.
 */
export function preflightDeepSeekHistoryArtifact(
  bytes: Uint8Array,
  expectedConversationId: string
): string[] {
  const raw = parseArtifactJson(bytes);
  const envelope = extractEnvelope(raw);
  const conversationId = sessionConversationId(envelope.session);
  if (conversationId !== expectedConversationId) {
    deepSeekFail('conversation-id-mismatch', 'DeepSeek response session does not match the route.');
  }
  return observedUnknownFragmentTypes(envelope);
}

/** Normalize verified exact DeepSeek history bytes into liska-thread/1. */
export async function normalizeDeepSeekCapture(
  input: DeepSeekNormalizationInput
): Promise<DeepSeekNormalizationResult> {
  try {
    const { manifest, artifact } = await verifyInputProvenance(input);
    const raw = parseArtifactJson(artifact.bytes);
    const envelope = extractEnvelope(raw);
    const conversationId = sessionConversationId(envelope.session);
    if (conversationId !== manifest.conversationId) {
      deepSeekFail(
        'conversation-id-mismatch',
        'DeepSeek response session does not match the capture manifest.'
      );
    }
    const context = createContext(input);
    const archive = buildArchive(input, manifest, envelope, conversationId, context);
    const observedUnknownContentTypes = [...context.unknownTypes].sort();
    if (
      JSON.stringify(observedUnknownContentTypes) !==
      JSON.stringify(manifest.observedUnknownContentTypes)
    ) {
      deepSeekFail(
        'unknown-content-types-mismatch',
        'DeepSeek manifest unknown content types do not match the verified raw artifact.'
      );
    }
    assertArchiveValidity(archive);
    return { archive, observedUnknownContentTypes };
  } catch (error) {
    if (error instanceof DeepSeekNormalizationError) throw error;
    throw new DeepSeekNormalizationError(
      'invalid-manifest',
      'DeepSeek capture manifest or runtime bundle is malformed.'
    );
  }
}

async function verifyInputProvenance(
  input: DeepSeekNormalizationInput
): Promise<{ manifest: RawCaptureManifest; artifact: RawCaptureArtifact }> {
  if (!isPlainRecord(input) || !isPlainRecord(input.bundle)) {
    deepSeekFail('invalid-manifest', 'A raw DeepSeek capture bundle is required.');
  }
  if (typeof input.sha256 !== 'function') {
    deepSeekFail('invalid-manifest', 'A SHA-256 verifier is required.');
  }
  const manifest = canonicalManifest(input.bundle.manifest);
  if (manifest.provider !== 'deepseek' || manifest.schema !== 'liska-capture/1') {
    deepSeekFail('invalid-manifest', 'Manifest must describe a DeepSeek liska-capture/1 capture.');
  }
  requireSafeIdentifier(input.artifactId, 'artifactId');
  if (!HASH_PATTERN.test(input.manifestSha256)) {
    deepSeekFail('invalid-manifest-hash', 'manifestSha256 must be lowercase SHA-256.');
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  if (
    (await safeHash(input.sha256, manifestBytes, 'manifest-integrity-failed')) !==
    input.manifestSha256
  ) {
    deepSeekFail('manifest-integrity-failed', 'Capture manifest SHA-256 does not match.');
  }
  try {
    validateCaptureBundleShape(input.bundle);
    await verifyCaptureBundleIntegrity(input.bundle, input.sha256);
  } catch {
    deepSeekFail('artifact-integrity-failed', 'Capture artifact bytes do not match the manifest.');
  }
  const artifact = input.bundle.artifacts.find(
    candidate => candidate.record.id === input.artifactId
  );
  if (!artifact)
    deepSeekFail('artifact-not-in-manifest', 'Selected artifact is not in the manifest.');
  if (artifact.record.mediaType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    deepSeekFail('invalid-manifest', 'Selected DeepSeek artifact must be JSON.');
  }
  return { manifest, artifact };
}

async function safeHash(
  sha256: (bytes: Uint8Array) => Promise<string>,
  bytes: Uint8Array,
  code: string
): Promise<string> {
  try {
    return await sha256(bytes);
  } catch {
    deepSeekFail(code, 'Capture integrity could not be verified.');
  }
}

function canonicalManifest(candidate: unknown): RawCaptureManifest {
  if (!isPlainRecord(candidate)) deepSeekFail('invalid-manifest', 'Manifest must be an object.');
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
      deepSeekFail('invalid-manifest', 'Capture manifest is not canonical.');
    }
    return manifest;
  } catch (error) {
    if (error instanceof DeepSeekNormalizationError) throw error;
    deepSeekFail('invalid-manifest', 'Capture manifest is malformed.');
  }
}

function parseArtifactJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    deepSeekFail('malformed-raw-artifact', 'DeepSeek history is not valid UTF-8 JSON.');
  }
}

function extractEnvelope(raw: unknown): DeepSeekEnvelope {
  if (!isPlainRecord(raw)) deepSeekFail('malformed-raw', 'DeepSeek history must be an object.');
  assertSuccessCode(raw.code, 'api-code');
  const data = requireRecord(raw.data, '/data', 'missing-data');
  assertSuccessCode(data.biz_code, 'business-code');
  const bizData = requireRecord(data.biz_data, ENVELOPE_POINTER, 'missing-business-data');
  if (bizData.cache_control !== undefined && bizData.cache_control !== null) {
    if (
      typeof bizData.cache_control !== 'string' ||
      bizData.cache_control.toUpperCase() !== 'REPLACE'
    ) {
      deepSeekFail(
        'incomplete-cache-response',
        'DeepSeek history must not be an explicit cache delta.'
      );
    }
  }
  const session = requireRecord(bizData.chat_session, SESSION_POINTER, 'missing-session');
  if (!Array.isArray(bizData.chat_messages)) {
    deepSeekFail('missing-messages', 'DeepSeek chat_messages must be an array.');
  }
  return { session, messages: bizData.chat_messages };
}

function observedUnknownFragmentTypes(envelope: DeepSeekEnvelope): string[] {
  const observed = new Set<string>();
  envelope.messages.forEach(message => {
    if (!isPlainRecord(message)) return;
    classifyUnknownBlockTypes(message).forEach(type => observed.add(type));
  });
  return [...observed].sort();
}

function classifyUnknownBlockTypes(message: DeepSeekJsonRecord, normalizedRole?: string): string[] {
  const unknown = new Set<string>();
  let hasVisibleFragment = false;
  let hasReasoningFragment = false;
  if (Array.isArray(message.fragments)) {
    message.fragments.forEach(fragment => {
      if (!isPlainRecord(fragment) || typeof fragment.type !== 'string') return;
      const type = fragment.type.trim().toUpperCase();
      if (!/^[A-Z0-9_.:-]{1,160}$/.test(type)) {
        unknown.add('INVALID_FRAGMENT_TYPE');
        return;
      }
      if (type === 'THINK') hasReasoningFragment = true;
      if (type === 'REQUEST' || type === 'RESPONSE' || type === 'TEMPLATE_RESPONSE') {
        hasVisibleFragment = true;
      }
      if (!KNOWN_FRAGMENT_TYPES.has(type)) unknown.add(type);
      else if (typeof fragment.content !== 'string') unknown.add(`${type}:non-text`);
    });
  }
  if (!hasVisibleFragment && hasOwn(message, 'content') && typeof message.content !== 'string') {
    unknown.add('message.content');
  }
  const role = normalizedRole ?? normalizedRoleForClassification(message.role);
  if (
    role === 'assistant' &&
    !hasReasoningFragment &&
    hasOwn(message, 'thinking_content') &&
    typeof message.thinking_content !== 'string'
  ) {
    unknown.add('message.thinking_content');
  }
  return [...unknown].sort();
}

function normalizedRoleForClassification(value: unknown): string {
  if (typeof value !== 'string') return '';
  const role = value.trim().toLowerCase();
  return role === 'ai' || role === 'bot' ? 'assistant' : role === 'human' ? 'user' : role;
}

function requireRecord(value: unknown, pointer: string, code: string): DeepSeekJsonRecord {
  if (!isPlainRecord(value)) deepSeekFail(code, `${pointer} must be a plain object.`);
  return value;
}

function assertSuccessCode(value: unknown, code: string): void {
  if (value === undefined || value === 0) return;
  deepSeekFail(code, 'DeepSeek history response reports a provider error.');
}

function sessionConversationId(session: DeepSeekJsonRecord): string {
  return aliasedIdentifier(
    session,
    ['id', 'chat_session_id'],
    SESSION_POINTER,
    'missing-session-id'
  );
}

function createContext(input: DeepSeekNormalizationInput): NormalizationContext {
  const format = input.sourceFormat ?? DEEPSEEK_SOURCE_FORMAT;
  if (typeof format !== 'string' || !format || format.length > 255) {
    deepSeekFail('invalid-source-format', 'sourceFormat must be bounded and non-empty.');
  }
  return {
    artifactId: input.artifactId,
    format,
    privacy: { redactions: [] },
    unknownTypes: new Set(),
  };
}

// eslint-disable-next-line max-lines-per-function -- The canonical record is assembled explicitly so every source mapping remains reviewable.
function buildArchive(
  input: DeepSeekNormalizationInput,
  manifest: RawCaptureManifest,
  envelope: DeepSeekEnvelope,
  conversationId: string,
  context: NormalizationContext
): LiskaThreadArchive {
  const graph = normalizeGraph(envelope, context);
  const conversationSource = sourceRef(
    context.artifactId,
    'conversation',
    conversationId,
    SESSION_POINTER,
    context.format
  );
  return {
    schema: LISKA_THREAD_SCHEMA,
    archiveId: `deepseek:${conversationId}`,
    inputs: [
      {
        captureId: manifest.captureId,
        manifestSha256: input.manifestSha256,
        normalizer: DEEPSEEK_NORMALIZER_ID,
        capturedAt: manifest.capturedAt,
        sourceRefs: [conversationSource],
        extensions: { deepseek: { rawArtifactId: input.artifactId } },
      },
    ],
    conversation: {
      id: conversationId,
      title: redactedNullableString(envelope.session.title, `${SESSION_POINTER}/title`, context),
      provider: 'deepseek',
      url: `https://chat.deepseek.com/a/chat/s/${encodeURIComponent(conversationId)}`,
      currentNodeId: graph.currentNodeId,
      createdAt: firstTimestamp(envelope.session, ['created_at', 'create_time'], SESSION_POINTER),
      updatedAt: firstTimestamp(envelope.session, ['updated_at', 'update_time'], SESSION_POINTER),
      metadata: {},
      sourceRefs: [conversationSource],
      extensions: {
        deepseek: residualFields(
          envelope.session,
          new Set([
            'id',
            'chat_session_id',
            'title',
            'current_message_id',
            'created_at',
            'create_time',
            'updated_at',
            'update_time',
          ]),
          context,
          SESSION_POINTER
        ),
      },
    },
    graph: { rootIds: graph.rootIds, nodes: graph.nodes },
    assets: {},
    diagnostics: { entries: diagnostics(manifest, context, conversationSource), extensions: {} },
    extensions: {
      deepseek: { normalizer: DEEPSEEK_NORMALIZER_ID, sourceFormat: context.format },
    },
  };
}

// eslint-disable-next-line max-lines-per-function -- Identity, links, cycle checks, and node materialization form one fail-closed graph boundary.
function normalizeGraph(
  envelope: DeepSeekEnvelope,
  context: NormalizationContext
): { rootIds: string[]; nodes: LiskaThreadArchive['graph']['nodes']; currentNodeId: string } {
  const parsed: ParsedMessage[] = [];
  const byId = new Map<string, ParsedMessage>();
  envelope.messages.forEach((value, index) => {
    const pointer = pointerAt(MESSAGES_POINTER, String(index));
    const record = requireRecord(value, pointer, 'malformed-message');
    const id = aliasedIdentifier(record, ['message_id', 'id'], pointer, 'missing-message-id');
    if (byId.has(id)) deepSeekFail('duplicate-message-id', `Duplicate DeepSeek message ${id}.`);
    if (!hasOwn(record, 'parent_id')) {
      deepSeekFail('missing-parent-id', `${pointerAt(pointer, 'parent_id')} is required.`);
    }
    const parentId = nullableIdentifier(record.parent_id, pointerAt(pointer, 'parent_id'));
    const message = { id, parentId, pointer, value: record };
    parsed.push(message);
    byId.set(id, message);
  });
  if (parsed.length === 0) deepSeekFail('missing-messages', 'DeepSeek history has no messages.');

  if (!hasOwn(envelope.session, 'current_message_id')) {
    deepSeekFail('current-message-missing', 'DeepSeek session has no current_message_id.');
  }
  const currentNodeId = requireSafeIdentifier(
    envelope.session.current_message_id,
    `${SESSION_POINTER}/current_message_id`
  );
  if (!byId.has(currentNodeId)) {
    deepSeekFail('current-message-missing', 'DeepSeek current_message_id is not in chat_messages.');
  }

  const childIds = new Map(parsed.map(message => [message.id, [] as string[]]));
  const roots: string[] = [];
  for (const message of parsed) {
    if (message.parentId === null) roots.push(message.id);
    else {
      const siblings = childIds.get(message.parentId);
      if (!siblings) deepSeekFail('parent-message-missing', `Parent of ${message.id} is missing.`);
      siblings.push(message.id);
    }
  }
  assertAcyclic(parsed, byId);

  const nodes: LiskaThreadArchive['graph']['nodes'] = {};
  for (const message of parsed) {
    const nodeSource = sourceRef(
      context.artifactId,
      'node',
      message.id,
      message.pointer,
      context.format
    );
    nodes[message.id] = {
      id: message.id,
      parentId: message.parentId,
      childIds: childIds.get(message.id) ?? [],
      message: normalizeMessage(message, context),
      sourceRefs: [nodeSource],
      extensions: {},
    };
  }
  return { rootIds: roots, nodes, currentNodeId };
}

function assertAcyclic(parsed: ParsedMessage[], byId: Map<string, ParsedMessage>): void {
  const complete = new Set<string>();
  for (const start of parsed) {
    const active = new Set<string>();
    let cursor: ParsedMessage | undefined = start;
    while (cursor && !complete.has(cursor.id)) {
      if (active.has(cursor.id))
        deepSeekFail('graph-cycle', `DeepSeek graph cycles at ${cursor.id}.`);
      active.add(cursor.id);
      cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
    }
    active.forEach(id => complete.add(id));
  }
}

function normalizeMessage(
  parsed: ParsedMessage,
  context: NormalizationContext
): NonNullable<LiskaThreadArchive['graph']['nodes'][string]['message']> {
  const { value, id, pointer } = parsed;
  const role = normalizeRole(value.role, pointerAt(pointer, 'role'));
  const blocks = normalizeBlocks(value, role, id, pointer, context);
  const messageSource = sourceRef(context.artifactId, 'message', id, pointer, context.format);
  return {
    id,
    author: {
      role,
      name: redactedNullableString(value.name, pointerAt(pointer, 'name'), context),
    },
    recipient: redactedNullableString(value.recipient, pointerAt(pointer, 'recipient'), context),
    channel: redactedNullableString(value.channel, pointerAt(pointer, 'channel'), context),
    createdAt: firstTimestamp(value, ['created_at', 'create_time'], pointer),
    updatedAt: firstTimestamp(value, ['updated_at', 'update_time'], pointer),
    status: redactedNullableString(value.status, pointerAt(pointer, 'status'), context),
    model: redactedNullableString(value.model, pointerAt(pointer, 'model'), context),
    visibility: redactedNullableString(value.visibility, pointerAt(pointer, 'visibility'), context),
    blocks,
    sourceRefs: [messageSource],
    extensions: {
      deepseek: residualFields(value, MAPPED_MESSAGE_FIELDS, context, pointer),
    },
  };
}

// eslint-disable-next-line max-lines-per-function -- Fragment ordering and fallback fields are intentionally decided in one pass.
function normalizeBlocks(
  message: DeepSeekJsonRecord,
  role: string,
  messageId: string,
  pointer: string,
  context: NormalizationContext
): ArchiveBlock[] {
  classifyUnknownBlockTypes(message, role).forEach(type => context.unknownTypes.add(type));
  const blocks: ArchiveBlock[] = [];
  let hasVisibleFragment = false;
  let hasReasoningFragment = false;
  if (hasOwn(message, 'fragments')) {
    if (!Array.isArray(message.fragments)) {
      deepSeekFail('malformed-fragments', `${pointerAt(pointer, 'fragments')} must be an array.`);
    }
    message.fragments.forEach((value, index) => {
      const fragmentPointer = pointerAt(pointer, 'fragments', String(index));
      const fragment = requireRecord(value, fragmentPointer, 'malformed-fragment');
      const type = fragmentType(fragment, fragmentPointer);
      if (type === 'THINK') hasReasoningFragment = true;
      if (type === 'REQUEST' || type === 'RESPONSE' || type === 'TEMPLATE_RESPONSE') {
        hasVisibleFragment = true;
      }
      blocks.push(
        fragmentBlock(fragment, type, messageId, blocks.length, fragmentPointer, context)
      );
    });
  }
  if (!hasVisibleFragment && hasOwn(message, 'content')) {
    const contentPointer = pointerAt(pointer, 'content');
    blocks.push(
      typeof message.content === 'string'
        ? visibleBlock(role, message.content, messageId, blocks.length, contentPointer, context)
        : unknownProviderBlock(
            'message.content',
            message.content,
            messageId,
            blocks.length,
            contentPointer,
            context
          )
    );
  }
  if (role === 'assistant' && !hasReasoningFragment && hasOwn(message, 'thinking_content')) {
    const thinkingPointer = pointerAt(pointer, 'thinking_content');
    blocks.push(
      typeof message.thinking_content === 'string'
        ? stringBlock(
            'reasoning',
            message.thinking_content,
            messageId,
            blocks.length,
            thinkingPointer,
            context,
            'reasoning'
          )
        : unknownProviderBlock(
            'message.thinking_content',
            message.thinking_content,
            messageId,
            blocks.length,
            thinkingPointer,
            context
          )
    );
  }
  return blocks;
}

// eslint-disable-next-line max-lines-per-function -- Each provider fragment type is mapped with its exact source pointer here.
function fragmentBlock(
  fragment: DeepSeekJsonRecord,
  type: string,
  messageId: string,
  index: number,
  pointer: string,
  context: NormalizationContext
): ArchiveBlock {
  const contentPointer = pointerAt(pointer, 'content');
  if (
    typeof fragment.content !== 'string' &&
    ['REQUEST', 'RESPONSE', 'TEMPLATE_RESPONSE', 'THINK'].includes(type)
  ) {
    return unknownProviderBlock(`${type}:non-text`, fragment, messageId, index, pointer, context);
  }
  if (type === 'REQUEST') {
    return stringBlock(
      'text',
      fragment.content,
      messageId,
      index,
      contentPointer,
      context,
      'content-part',
      fragment,
      type,
      pointer
    );
  }
  if (type === 'RESPONSE' || type === 'TEMPLATE_RESPONSE') {
    return stringBlock(
      'markdown',
      fragment.content,
      messageId,
      index,
      contentPointer,
      context,
      'content-part',
      fragment,
      type,
      pointer
    );
  }
  if (type === 'THINK') {
    return stringBlock(
      'reasoning',
      fragment.content,
      messageId,
      index,
      contentPointer,
      context,
      'reasoning',
      fragment,
      type,
      pointer
    );
  }
  return unknownProviderBlock(type, fragment, messageId, index, pointer, context);
}

function unknownProviderBlock(
  providerType: string,
  value: unknown,
  messageId: string,
  index: number,
  pointer: string,
  context: NormalizationContext
): ArchiveBlock {
  context.unknownTypes.add(providerType);
  return {
    id: `${messageId}:block:${index}`,
    type: 'unknown',
    providerType,
    raw: sanitizeJson(value, context.privacy, pointer),
    sourceRefs: [sourceRef(context.artifactId, 'content-part', messageId, pointer, context.format)],
    extensions: {},
  };
}

function visibleBlock(
  role: string,
  value: unknown,
  messageId: string,
  index: number,
  pointer: string,
  context: NormalizationContext
): ArchiveBlock {
  const type = role === 'assistant' ? 'markdown' : 'text';
  return stringBlock(type, value, messageId, index, pointer, context, 'content-part');
}

function stringBlock(
  type: 'text' | 'markdown' | 'reasoning',
  value: unknown,
  messageId: string,
  index: number,
  pointer: string,
  context: NormalizationContext,
  sourceKind: string,
  container?: DeepSeekJsonRecord,
  providerType?: string,
  containerPointer?: string
): ArchiveBlock {
  if (typeof value !== 'string') {
    deepSeekFail('malformed-content', `${pointer} must be a string.`);
  }
  const canonicalValue = redactSensitiveText(value, context.privacy, pointer);
  const extensions: NamespacedExtensions = container
    ? {
        deepseek: residualFields(
          container,
          new Set(['type', 'content']),
          context,
          containerPointer ?? pointer
        ),
      }
    : {};
  const base = {
    id: `${messageId}:block:${index}`,
    sourceRefs: [sourceRef(context.artifactId, sourceKind, messageId, pointer, context.format)],
    extensions,
  };
  if (type === 'markdown') return { ...base, type, markdown: canonicalValue };
  if (type === 'reasoning') return { ...base, type, text: canonicalValue };
  return { ...base, type: 'text', text: canonicalValue };
}

function fragmentType(fragment: DeepSeekJsonRecord, pointer: string): string {
  if (typeof fragment.type !== 'string') {
    deepSeekFail('invalid-fragment-type', `${pointerAt(pointer, 'type')} must be bounded.`);
  }
  const type = fragment.type.trim().toUpperCase();
  if (!/^[A-Z0-9_.:-]{1,160}$/.test(type)) {
    deepSeekFail('invalid-fragment-type', `${pointerAt(pointer, 'type')} must be bounded.`);
  }
  return type;
}

function normalizeRole(value: unknown, pointer: string): string {
  if (typeof value !== 'string') {
    deepSeekFail('invalid-role', `${pointer} must be a bounded role.`);
  }
  const role = value.trim().toLowerCase();
  if (!/^[a-z0-9_.:-]{1,160}$/.test(role)) {
    deepSeekFail('invalid-role', `${pointer} must be a bounded role.`);
  }
  if (role === 'human') return 'user';
  if (role === 'ai' || role === 'bot') return 'assistant';
  return role;
}

function residualFields(
  record: DeepSeekJsonRecord,
  excluded: ReadonlySet<string>,
  context: NormalizationContext,
  pointer: string
): Record<string, import('../../types').JsonValue> {
  const selected: DeepSeekJsonRecord = {};
  for (const key of Object.keys(record)) {
    if (excluded.has(key)) continue;
    Object.defineProperty(selected, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: record[key],
    });
  }
  return sanitizeJson(selected, context.privacy, pointer) as Record<
    string,
    import('../../types').JsonValue
  >;
}

function aliasedIdentifier(
  record: DeepSeekJsonRecord,
  fields: string[],
  pointer: string,
  missingCode: string
): string {
  const present = fields.filter(field => hasOwn(record, field));
  if (present.length === 0) deepSeekFail(missingCode, `${pointer} has no identifier.`);
  const values = present.map(field =>
    requireSafeIdentifier(record[field], pointerAt(pointer, field))
  );
  if (new Set(values).size !== 1)
    deepSeekFail('ambiguous-id', `${pointer} identifier aliases disagree.`);
  return values[0];
}

function nullableIdentifier(value: unknown, pointer: string): string | null {
  return value === undefined || value === null ? null : requireSafeIdentifier(value, pointer);
}

function nullableString(value: unknown, pointer: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string')
    deepSeekFail('malformed-string-field', `${pointer} must be a string.`);
  return value;
}

function redactedNullableString(
  value: unknown,
  pointer: string,
  context: NormalizationContext
): string | null {
  const text = nullableString(value, pointer);
  return text === null ? null : redactSensitiveText(text, context.privacy, pointer);
}

function firstTimestamp(
  record: DeepSeekJsonRecord,
  fields: string[],
  pointer: string
): string | null {
  for (const field of fields) {
    if (hasOwn(record, field)) return normalizeTimestamp(record[field], pointerAt(pointer, field));
  }
  return null;
}

function diagnostics(
  manifest: RawCaptureManifest,
  context: NormalizationContext,
  conversationSource: ReturnType<typeof sourceRef>
): LiskaThreadArchive['diagnostics']['entries'] {
  const completeness = (['graph', 'messages', 'branches', 'assets'] as const)
    .filter(aspect => manifest.completeness[aspect] !== 'complete')
    .map(aspect => ({
      severity:
        manifest.completeness[aspect] === 'partial' ? ('warning' as const) : ('info' as const),
      code: `capture-${aspect}-${manifest.completeness[aspect]}`,
      message: `Raw capture marked ${aspect} as ${manifest.completeness[aspect]}.`,
      path: null,
      sourceRefs: [conversationSource],
      extensions: {},
    }));
  const unknown = [...context.unknownTypes].sort().map(type => ({
    severity: 'info' as const,
    code: 'unknown-content-type',
    message: `Retained DeepSeek fragment type ${type} as an unknown block.`,
    path: null,
    sourceRefs: [conversationSource],
    extensions: { deepseek: { contentType: type } },
  }));
  const privacy = context.privacy.redactions.map(redaction => ({
    severity: 'warning' as const,
    code: redaction.code,
    message: redaction.message,
    path: null,
    sourceRefs: [
      sourceRef(context.artifactId, 'privacy-redaction', null, redaction.pointer, context.format),
    ],
    extensions: {},
  }));
  return [...completeness, ...unknown, ...privacy];
}

function assertArchiveValidity(archive: LiskaThreadArchive): void {
  const validation = validateLiskaThreadArchive(archive);
  if (validation.valid) return;
  const issue = validation.issues.find(entry => entry.severity === 'error');
  deepSeekFail(
    'invalid-output',
    `DeepSeek normalizer produced an invalid archive${issue ? ` (${issue.code} at ${issue.path})` : ''}.`
  );
}
