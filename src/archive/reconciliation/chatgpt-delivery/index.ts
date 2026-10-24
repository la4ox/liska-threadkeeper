import {
  CHATGPT_OFFICIAL_HARD_LIMITS,
  importChatGptOfficialConversation,
  type ChatGptOfficialImportResult,
  type ChatGptOfficialSelectionLimits,
} from '../../importers/chatgpt-official';
import type { LiskaThreadArchive } from '../../types';
import { validateLiskaThreadArchiveBounded } from '../../validate';
import {
  CHATGPT_COMPARISON_HARD_LIMITS,
  compareChatGptArchives,
  type ChatGptComparisonLimits,
} from '../chatgpt';
import {
  CHATGPT_COMPARISON_ARTIFACT_SCHEMA,
  CHATGPT_RECONCILIATION_BUNDLE_SCHEMA,
  CHATGPT_RECONCILIATION_DELIVERY_HARD_LIMITS,
  CHATGPT_RECONCILIATION_WARNINGS,
  ChatGptReconciliationDeliveryError,
  type ChatGptComparisonArtifact,
  type ChatGptReconciliationArtifact,
  type ChatGptReconciliationArtifactDescriptor,
  type ChatGptReconciliationArtifactPath,
  type ChatGptReconciliationBundleManifest,
  type ChatGptReconciliationDelivery,
  type ChatGptReconciliationDeliveryErrorCode,
  type ChatGptReconciliationDeliveryLimits,
  type ChatGptReconciliationOfficialReceipt,
  type ChatGptWebCanonicalReceipt,
  type PrepareChatGptReconciliationDeliveryInput,
} from './contracts';
import { parseWebCanonicalJson, serializeJsonArtifact } from './json';

export * from './contracts';

const PORTABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const INTERNAL_CODES = new WeakMap<object, ChatGptReconciliationDeliveryErrorCode>();

function fail(code: ChatGptReconciliationDeliveryErrorCode): never {
  const error = new ChatGptReconciliationDeliveryError(code);
  INTERNAL_CODES.set(error, code);
  throw error;
}

interface ResolvedLimits extends ChatGptReconciliationDeliveryLimits {
  official: ChatGptOfficialSelectionLimits;
  comparison: ChatGptComparisonLimits;
}

interface PreparedInput {
  webBytes: Uint8Array;
  web: LiskaThreadArchive;
  officialChunks: AsyncIterable<Uint8Array>;
  captureId: string;
  importedAt: string;
  sha256: PrepareChatGptReconciliationDeliveryInput['sha256'];
  limits: ResolvedLimits;
}

interface HashContext {
  hash: (bytes: Uint8Array) => Promise<string>;
  assertHealthy: () => void;
  artifactBytes: number;
}

function dataRecord(value: unknown, maximum: number): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    fail('invalid-input');
  const keys = Reflect.ownKeys(value);
  if (keys.length > maximum || keys.some(key => typeof key !== 'string')) fail('invalid-input');
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) fail('invalid-input');
    result[key] = descriptor.value;
  }
  return result;
}

function numericLimits<T extends Record<string, number>>(
  raw: unknown,
  hard: T,
  minimum: number
): T {
  const result = { ...hard };
  if (raw === undefined) return result;
  const overrides = dataRecord(raw, Object.keys(hard).length);
  for (const [key, value] of Object.entries(overrides)) {
    if (
      !Object.prototype.hasOwnProperty.call(hard, key) ||
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > hard[key]
    )
      fail('invalid-limits');
    result[key as keyof T] = value as T[keyof T];
  }
  return result;
}

function resolveLimits(raw: unknown): ResolvedLimits {
  try {
    const overrides = raw === undefined ? {} : dataRecord(raw, 8);
    const { official, comparison, ...own } = overrides;
    return {
      ...numericLimits(own, CHATGPT_RECONCILIATION_DELIVERY_HARD_LIMITS, 0),
      official: numericLimits(official, { ...CHATGPT_OFFICIAL_HARD_LIMITS }, 1),
      comparison: numericLimits(comparison, { ...CHATGPT_COMPARISON_HARD_LIMITS }, 0),
    };
  } catch {
    fail('invalid-limits');
  }
}

function validImportedAt(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function plainJsonRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}

function countOwnRecords(
  value: Record<string, unknown>,
  maximum: number,
  onValue?: (entry: unknown) => void
): void {
  let count = 0;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    count += 1;
    if (count > maximum) fail('web-archive-limit');
    onValue?.(value[key]);
  }
}

function requireWebIdentity(value: unknown): Record<string, unknown> {
  if (!plainJsonRecord(value) || !Array.isArray(value.inputs)) fail('web-archive-invalid');
  if (value.inputs.length !== 1) fail('web-identity-invalid');
  const declaredInput = value.inputs[0];
  const conversation = value.conversation;
  if (!plainJsonRecord(declaredInput) || !plainJsonRecord(conversation))
    fail('web-archive-invalid');
  if (typeof conversation.id !== 'string') fail('web-archive-invalid');
  if (
    conversation.provider !== 'chatgpt' ||
    declaredInput.normalizer !== 'chatgpt-web/1' ||
    !PORTABLE_ID.test(conversation.id)
  )
    fail('web-identity-invalid');
  return value;
}

function preflightWebArchive(value: unknown, limits: ResolvedLimits): void {
  const archive = requireWebIdentity(value);
  const graph = archive.graph;
  const assets = archive.assets;
  const diagnostics = archive.diagnostics;
  if (!plainJsonRecord(graph) || !plainJsonRecord(graph.nodes) || !plainJsonRecord(assets))
    fail('web-archive-invalid');
  if (!plainJsonRecord(diagnostics) || !Array.isArray(diagnostics.entries))
    fail('web-archive-invalid');

  let blocks = 0;
  countOwnRecords(graph.nodes, limits.comparison.maxNodes, node => {
    if (!plainJsonRecord(node) || !plainJsonRecord(node.message)) return;
    const valueBlocks = node.message.blocks;
    if (!Array.isArray(valueBlocks)) return;
    if (valueBlocks.length > limits.comparison.maxBlocks - blocks) fail('web-archive-limit');
    blocks += valueBlocks.length;
  });
  countOwnRecords(assets, limits.comparison.maxAssets);
  if (diagnostics.entries.length > limits.comparison.maxDiagnostics) fail('web-archive-limit');
}

function requireWebArchive(value: unknown, limits: ResolvedLimits): LiskaThreadArchive {
  preflightWebArchive(value, limits);
  if (!validateLiskaThreadArchiveBounded(value, 1).valid) fail('web-archive-invalid');
  return value as LiskaThreadArchive;
}

function prepare(input: PrepareChatGptReconciliationDeliveryInput): PreparedInput {
  const data = dataRecord(input, 6);
  const allowed = [
    'webCanonicalBytes',
    'officialChunks',
    'captureId',
    'importedAt',
    'sha256',
    'limits',
  ];
  if (Object.keys(data).some(key => !allowed.includes(key))) fail('invalid-input');
  const limits = resolveLimits(data.limits);
  if (
    !ArrayBuffer.isView(data.webCanonicalBytes) ||
    Object.prototype.toString.call(data.webCanonicalBytes) !== '[object Uint8Array]'
  )
    fail('invalid-input');
  const sourceBytes = data.webCanonicalBytes as Uint8Array;
  if (sourceBytes.byteLength > limits.maxWebCanonicalBytes) fail('web-size-limit');
  if (
    typeof data.captureId !== 'string' ||
    !PORTABLE_ID.test(data.captureId) ||
    !validImportedAt(data.importedAt) ||
    typeof data.sha256 !== 'function' ||
    !data.officialChunks ||
    typeof data.officialChunks !== 'object' ||
    typeof (data.officialChunks as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== 'function'
  )
    fail('invalid-input');
  const webBytes = new Uint8Array(sourceBytes);
  const web = requireWebArchive(
    parseWebCanonicalJson(webBytes, limits.maxWebJsonDepth, limits.maxWebJsonValues, fail),
    limits
  );
  return {
    webBytes,
    web,
    limits,
    captureId: data.captureId,
    importedAt: data.importedAt,
    officialChunks: data.officialChunks as AsyncIterable<Uint8Array>,
    sha256: data.sha256 as PreparedInput['sha256'],
  };
}

function createHashContext(sha256: PreparedInput['sha256']): HashContext {
  let failure: ChatGptReconciliationDeliveryErrorCode | undefined;
  const hash = async (bytes: Uint8Array): Promise<string> => {
    if (failure) fail(failure);
    const disposable = new Uint8Array(bytes);
    const before = new Uint8Array(disposable);
    let digest: unknown;
    try {
      digest = await sha256(disposable);
    } catch {
      failure = 'hash-failed';
      fail(failure);
    }
    if (
      disposable.length !== before.length ||
      disposable.some((value, index) => value !== before[index])
    )
      failure = 'hash-mutated';
    else if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) failure = 'hash-invalid';
    if (failure) fail(failure);
    return digest as string;
  };
  return {
    hash,
    artifactBytes: 0,
    assertHealthy: () => {
      if (failure) fail(failure);
    },
  };
}

async function importOfficial(
  input: PreparedInput,
  context: HashContext
): Promise<ChatGptOfficialImportResult> {
  try {
    const result = await importChatGptOfficialConversation({
      chunks: input.officialChunks,
      conversationId: input.web.conversation.id,
      captureId: input.captureId,
      importedAt: input.importedAt,
      sha256: context.hash,
      limits: input.limits.official,
    });
    context.assertHealthy();
    return result;
  } catch {
    context.assertHealthy();
    fail('official-import-failed');
  }
}

function descriptor(
  artifact: ChatGptReconciliationArtifact
): ChatGptReconciliationArtifactDescriptor {
  const { relativePath, mediaType, byteLength, sha256 } = artifact;
  return { relativePath, mediaType, byteLength, sha256 };
}

async function artifact(
  relativePath: ChatGptReconciliationArtifactPath,
  bytes: Uint8Array,
  input: PreparedInput,
  context: HashContext
): Promise<ChatGptReconciliationArtifact> {
  if (bytes.byteLength > input.limits.maxArtifactBytes) fail('artifact-limit');
  if (context.artifactBytes + bytes.byteLength > input.limits.maxBundleBytes) fail('bundle-limit');
  const owned = new Uint8Array(bytes);
  const result: ChatGptReconciliationArtifact = {
    relativePath,
    mediaType: 'application/json',
    byteLength: owned.byteLength,
    sha256: await context.hash(owned),
    bytes: owned,
  };
  context.artifactBytes += result.byteLength;
  return result;
}

function officialReceipt(
  imported: ChatGptOfficialImportResult,
  artifacts: ChatGptReconciliationArtifact[],
  captureId: string
): ChatGptReconciliationOfficialReceipt {
  const selected = imported.selection;
  return {
    captureId,
    declaredManifestSha256: imported.manifestSha256,
    excerpt: descriptor(artifacts[0]),
    manifest: descriptor(artifacts[1]),
    provenance: {
      kind: 'official-export-slice',
      fileRole: 'conversations',
      conversationIndex: selected.conversationIndex,
      byteStart: selected.byteStart,
      byteEndExclusive: selected.byteEndExclusive,
      sourceByteLength: selected.sourceByteLength,
    },
  };
}

async function initialArtifacts(
  input: PreparedInput,
  imported: ChatGptOfficialImportResult,
  context: HashContext
) {
  const raw = await artifact(
    'official/conversation.json',
    imported.selection.bytes,
    input,
    context
  );
  const manifestBytes = serializeJsonArtifact(
    imported.bundle.manifest,
    input.limits.maxArtifactBytes,
    'artifact-limit',
    fail,
    true
  );
  const manifest = await artifact('official/manifest.json', manifestBytes, input, context);
  if (
    manifest.sha256 !== imported.manifestSha256 ||
    raw.sha256 !== imported.bundle.manifest.artifacts[0].sha256
  )
    fail('official-import-failed');
  return [raw, manifest];
}

async function addComparison(
  input: PreparedInput,
  imported: Extract<ChatGptOfficialImportResult, { status: 'normalized' }>,
  webCanonical: ChatGptWebCanonicalReceipt,
  official: ChatGptReconciliationOfficialReceipt,
  artifacts: ChatGptReconciliationArtifact[],
  context: HashContext
): Promise<void> {
  const canonical = serializeJsonArtifact(
    imported.archive,
    input.limits.maxArtifactBytes,
    'artifact-limit',
    fail
  );
  artifacts.push(
    await artifact('official/canonical/liska-thread-1.json', canonical, input, context)
  );
  let comparison;
  try {
    comparison = await compareChatGptArchives({
      left: input.web,
      right: imported.archive,
      sha256: context.hash,
      limits: input.limits.comparison,
    });
  } catch {
    context.assertHealthy();
    fail('comparison-failed');
  }
  const envelope: ChatGptComparisonArtifact = {
    schema: CHATGPT_COMPARISON_ARTIFACT_SCHEMA,
    webCanonical,
    official,
    comparison,
  };
  const bytes = serializeJsonArtifact(
    envelope,
    input.limits.maxComparisonArtifactBytes,
    'comparison-artifact-limit',
    fail
  );
  artifacts.push(
    await artifact('comparison/liska-chatgpt-comparison-1.json', bytes, input, context)
  );
}

async function finish(
  input: PreparedInput,
  imported: ChatGptOfficialImportResult,
  context: HashContext
): Promise<ChatGptReconciliationDelivery> {
  const webCanonical: ChatGptWebCanonicalReceipt = {
    byteLength: input.webBytes.byteLength,
    sha256: await context.hash(input.webBytes),
    provenanceVerification: 'canonical-declarations-only',
  };
  const conversationKey = await context.hash(new TextEncoder().encode(input.web.conversation.id));
  const artifacts = await initialArtifacts(input, imported, context);
  const official = officialReceipt(imported, artifacts, input.captureId);
  if (imported.status === 'normalized')
    await addComparison(input, imported, webCanonical, official, artifacts, context);
  const failureCode = imported.status === 'raw-only' ? 'official-normalization-failed' : null;
  const manifest: ChatGptReconciliationBundleManifest = {
    schema: CHATGPT_RECONCILIATION_BUNDLE_SCHEMA,
    status: imported.status,
    failureCode,
    webCanonical,
    official,
    artifacts: artifacts.map(descriptor),
    warnings: [...CHATGPT_RECONCILIATION_WARNINGS],
  };
  const bytes = serializeJsonArtifact(
    manifest,
    input.limits.maxArtifactBytes,
    'artifact-limit',
    fail
  );
  artifacts.push(await artifact('manifest.json', bytes, input, context));
  const base = {
    conversationKey,
    bundleId: artifacts[artifacts.length - 1].sha256,
    artifacts,
    manifest,
  };
  return imported.status === 'normalized'
    ? { ...base, status: 'normalized', failureCode: null }
    : { ...base, status: 'raw-only', failureCode: 'official-normalization-failed' };
}

/** Pure preparation only: no source writes, runtime discovery, destination writes, or archive merge. */
export async function prepareChatGptReconciliationDelivery(
  input: PrepareChatGptReconciliationDeliveryInput
): Promise<ChatGptReconciliationDelivery> {
  try {
    const prepared = prepare(input);
    const context = createHashContext(prepared.sha256);
    return await finish(prepared, await importOfficial(prepared, context), context);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null ? INTERNAL_CODES.get(error) : undefined;
    throw new ChatGptReconciliationDeliveryError(code ?? 'invalid-input');
  }
}
