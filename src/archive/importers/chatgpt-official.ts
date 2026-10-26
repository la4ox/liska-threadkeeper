import {
  buildCaptureManifest,
  validateCaptureBundleShape,
  verifyCaptureBundleIntegrity,
  type RawCaptureBundle,
  type RawCaptureManifest,
} from '../capture';
import {
  ChatGptNormalizationError,
  OFFICIAL_EXPORT_SOURCE_FORMAT,
  normalizeChatGptCapture,
} from '../normalizers/chatgpt';
import { inventoryChatGptRawAssets } from '../normalizers/chatgpt/inventory';
import type { LiskaThreadArchive } from '../types';
import {
  type ChatGptOfficialConversationSource,
  type ChatGptOfficialConversationSelection,
  type ChatGptOfficialMultiSelectionLimits,
  type ChatGptOfficialSelectionLimits,
} from './chatgpt-official/contracts';
import {
  isOwnedChatGptOfficialSelectionError,
  selectChatGptOfficialConversation,
  selectChatGptOfficialConversationSources,
} from './chatgpt-official/select';

export {
  CHATGPT_OFFICIAL_HARD_LIMITS,
  CHATGPT_OFFICIAL_MULTI_HARD_LIMITS,
  CHATGPT_OFFICIAL_SELECTION_ERROR_CODES,
  ChatGptOfficialSelectionError,
  type ChatGptOfficialConversationSelection,
  type ChatGptOfficialSelectionErrorCode,
  type ChatGptOfficialSelectionLimits,
  type ChatGptOfficialMultiSelectionLimits,
  type ChatGptOfficialConversationSource,
  type SelectChatGptOfficialConversationInput,
  type SelectChatGptOfficialConversationSourcesInput,
} from './chatgpt-official/contracts';
export {
  selectChatGptOfficialConversation,
  selectChatGptOfficialConversationSources,
} from './chatgpt-official/select';

const ARTIFACT_ID = 'official-conversation';
const OFFICIAL_SCOPE_WARNING =
  'Official export completeness applies to the selected object; provider-only content may be absent.';
const OFFICIAL_NORMALIZATION_FAILED_WARNING =
  'Official export canonical normalization failed; the exact raw excerpt remains authoritative.';
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const INTERNAL_IMPORT_ERRORS = new WeakSet<object>();

function ignoredEmptyRecordWarning(selection: ChatGptOfficialConversationSelection): string[] {
  return selection.ignoredEmptyRecordCount === undefined
    ? []
    : [
        `Official export contained ${selection.ignoredEmptyRecordCount} empty padding record(s); they were counted and ignored during identity validation.`,
      ];
}

export interface ImportChatGptOfficialConversationInput {
  chunks: AsyncIterable<Uint8Array>;
  conversationId: string;
  captureId: string;
  importedAt: string;
  sha256: (bytes: Uint8Array) => Promise<string>;
  limits?: Partial<ChatGptOfficialSelectionLimits>;
}

export interface ImportChatGptOfficialConversationSourcesInput {
  sources: ChatGptOfficialConversationSource[];
  conversationId: string;
  captureId: string;
  importedAt: string;
  sha256: (bytes: Uint8Array) => Promise<string>;
  limits?: Partial<ChatGptOfficialMultiSelectionLimits>;
}

type ImportMetadata = Pick<
  ImportChatGptOfficialConversationInput,
  'conversationId' | 'captureId' | 'importedAt' | 'sha256'
>;

interface PreparedImportInput {
  metadata: ImportMetadata;
  source: unknown;
  limits: unknown;
}

interface ChatGptOfficialImportBase {
  selection: ChatGptOfficialConversationSelection;
  bundle: RawCaptureBundle;
  manifestSha256: string;
}

export interface ChatGptOfficialNormalizedImport extends ChatGptOfficialImportBase {
  status: 'normalized';
  archive: LiskaThreadArchive;
  observedUnknownContentTypes: string[];
}

export interface ChatGptOfficialRawOnlyImport extends ChatGptOfficialImportBase {
  status: 'raw-only';
  failureCode: string;
}

export type ChatGptOfficialImportResult =
  | ChatGptOfficialNormalizedImport
  | ChatGptOfficialRawOnlyImport;

export type ChatGptOfficialImportErrorCode =
  | 'invalid-import-input'
  | 'selected-json-invalid'
  | 'hash-failed'
  | 'manifest-failed';

/** Fixed, content-free failure for importer metadata and integrity setup. */
export class ChatGptOfficialImportError extends Error {
  readonly code: ChatGptOfficialImportErrorCode;

  constructor(code: ChatGptOfficialImportErrorCode) {
    super(`ChatGPT official export import failed (${code}).`);
    this.name = 'ChatGptOfficialImportError';
    this.code = code;
  }
}

function importFail(code: ChatGptOfficialImportErrorCode): never {
  const error = new ChatGptOfficialImportError(code);
  INTERNAL_IMPORT_ERRORS.add(error);
  throw error;
}

function internalImportError(error: unknown): error is ChatGptOfficialImportError {
  return typeof error === 'object' && error !== null && INTERNAL_IMPORT_ERRORS.has(error);
}

function parseSelected(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    importFail('selected-json-invalid');
  }
}

async function safeHash(
  sha256: (bytes: Uint8Array) => Promise<string>,
  bytes: Uint8Array
): Promise<string> {
  try {
    const digest = await sha256(bytes.slice());
    if (!HASH_PATTERN.test(digest)) importFail('hash-failed');
    return digest;
  } catch (error) {
    if (internalImportError(error)) throw error;
    importFail('hash-failed');
  }
}

function manifestBytes(manifest: RawCaptureManifest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(manifest, null, 2));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function officialSource(selection: ChatGptOfficialConversationSelection) {
  return {
    kind: 'official-export-slice' as const,
    fileRole: 'conversations' as const,
    conversationIndex: selection.conversationIndex,
    byteStart: selection.byteStart,
    sourceByteLength: selection.sourceByteLength,
    ...(selection.shardIndex !== undefined && { shardIndex: selection.shardIndex }),
    ...(selection.ignoredEmptyRecordCount !== undefined && {
      ignoredEmptyRecordCount: selection.ignoredEmptyRecordCount,
    }),
  };
}

function buildOfficialManifest(
  input: ImportMetadata,
  selection: ChatGptOfficialConversationSelection,
  artifactSha256: string,
  inventory: Awaited<ReturnType<typeof inventoryChatGptRawAssets>>,
  observedUnknownContentTypes: string[],
  normalizationFailed: boolean
): RawCaptureManifest {
  try {
    return buildCaptureManifest({
      captureId: input.captureId,
      provider: 'chatgpt',
      conversationId: selection.conversationId,
      capturedAt: input.importedAt,
      method: 'official-export',
      artifacts: [
        {
          id: ARTIFACT_ID,
          relativePath: 'official/conversation.json',
          mediaType: 'application/json',
          byteLength: selection.bytes.byteLength,
          sha256: artifactSha256,
          source: officialSource(selection),
        },
      ],
      assets: inventory.assets,
      completeness: {
        graph: normalizationFailed ? 'unknown' : 'complete',
        messages: normalizationFailed ? 'unknown' : 'complete',
        branches: normalizationFailed ? 'unknown' : 'complete',
        assets: inventory.completeness,
      },
      warnings: [
        OFFICIAL_SCOPE_WARNING,
        ...ignoredEmptyRecordWarning(selection),
        ...(normalizationFailed ? [OFFICIAL_NORMALIZATION_FAILED_WARNING] : []),
        ...inventory.warnings,
      ],
      observedUnknownContentTypes,
    });
  } catch {
    importFail('manifest-failed');
  }
}

async function verifiedBundle(
  manifest: RawCaptureManifest,
  selection: ChatGptOfficialConversationSelection,
  hash: (bytes: Uint8Array) => Promise<string>
): Promise<RawCaptureBundle> {
  const bundle: RawCaptureBundle = {
    manifest,
    artifacts: [{ record: manifest.artifacts[0], bytes: selection.bytes }],
    assets: [],
  };
  try {
    validateCaptureBundleShape(bundle);
    await verifyCaptureBundleIntegrity(bundle, hash);
    return bundle;
  } catch {
    importFail('manifest-failed');
  }
}

async function buildBundle(
  input: ImportMetadata,
  selection: ChatGptOfficialConversationSelection,
  raw: unknown,
  observedUnknownContentTypes: string[] = [],
  normalizationFailed = false
): Promise<{ bundle: RawCaptureBundle; manifestSha256: string }> {
  const hash = (bytes: Uint8Array): Promise<string> => safeHash(input.sha256, bytes);
  const artifactSha256 = await hash(selection.bytes);
  const inventory = await inventoryChatGptRawAssets({
    raw,
    artifactId: ARTIFACT_ID,
    sha256: hash,
  });
  const manifest = buildOfficialManifest(
    input,
    selection,
    artifactSha256,
    inventory,
    observedUnknownContentTypes,
    normalizationFailed
  );
  const bundle = await verifiedBundle(manifest, selection, hash);
  return { bundle, manifestSha256: await hash(manifestBytes(manifest)) };
}

async function normalizeOfficial(
  bundle: RawCaptureBundle,
  manifestSha256: string,
  sha256: (bytes: Uint8Array) => Promise<string>
) {
  return normalizeChatGptCapture({
    bundle,
    artifactId: ARTIFACT_ID,
    manifestSha256,
    sha256,
    sourceFormat: OFFICIAL_EXPORT_SOURCE_FORMAT,
  });
}

function rawOnly(
  selection: ChatGptOfficialConversationSelection,
  current: { bundle: RawCaptureBundle; manifestSha256: string },
  failureCode: string
): ChatGptOfficialRawOnlyImport {
  return {
    status: 'raw-only',
    selection,
    bundle: current.bundle,
    manifestSha256: current.manifestSha256,
    failureCode,
  };
}

function normalizationFailureCode(error: unknown): string {
  if (error instanceof ChatGptNormalizationError) return error.code;
  if (internalImportError(error)) return error.code;
  return 'normalization-failed';
}

async function finishNormalization(
  input: ImportMetadata,
  selection: ChatGptOfficialConversationSelection,
  raw: unknown,
  initial: { bundle: RawCaptureBundle; manifestSha256: string }
): Promise<ChatGptOfficialImportResult> {
  try {
    const hash = (bytes: Uint8Array): Promise<string> => safeHash(input.sha256, bytes);
    const probe = await normalizeOfficial(initial.bundle, initial.manifestSha256, hash);
    const complete = await buildBundle(
      input,
      selection,
      raw,
      probe.observedUnknownContentTypes,
      false
    );
    const normalized = await normalizeOfficial(complete.bundle, complete.manifestSha256, hash);
    if (
      !sameStrings(
        normalized.observedUnknownContentTypes,
        complete.bundle.manifest.observedUnknownContentTypes
      )
    ) {
      return rawOnly(selection, initial, 'unknown-content-types-unstable');
    }
    return {
      status: 'normalized',
      selection,
      bundle: complete.bundle,
      manifestSha256: complete.manifestSha256,
      archive: normalized.archive,
      observedUnknownContentTypes: normalized.observedUnknownContentTypes,
    };
  } catch (error) {
    return rawOnly(selection, initial, normalizationFailureCode(error));
  }
}

/**
 * Import one exact conversation excerpt without retaining neighboring chats.
 * Selection/manifest failures throw fixed errors. A valid raw bundle survives
 * canonical normalization failure as an explicit `raw-only` result.
 */
export async function importChatGptOfficialConversation(
  input: ImportChatGptOfficialConversationInput
): Promise<ChatGptOfficialImportResult> {
  let prepared: PreparedImportInput;
  try {
    prepared = snapshotImportInput(input, 'chunks');
  } catch {
    importFail('invalid-import-input');
  }
  let selection: ChatGptOfficialConversationSelection;
  try {
    selection = await selectChatGptOfficialConversation({
      chunks: prepared.source as AsyncIterable<Uint8Array>,
      conversationId: prepared.metadata.conversationId,
      limits: prepared.limits as Partial<ChatGptOfficialSelectionLimits> | undefined,
    });
  } catch (error) {
    if (isOwnedChatGptOfficialSelectionError(error)) throw error;
    importFail('invalid-import-input');
  }
  return finishImport(prepared.metadata, selection);
}

async function finishImport(
  input: ImportMetadata,
  selection: ChatGptOfficialConversationSelection
): Promise<ChatGptOfficialImportResult> {
  const raw = parseSelected(selection.bytes);
  const current = await buildBundle(input, selection, raw, [], true);
  return finishNormalization(input, selection, raw, current);
}

function snapshotImportInput(input: unknown, sourceKey: 'chunks' | 'sources'): PreparedImportInput {
  if (!input || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype)
    throw new Error('invalid');
  const allowed = [sourceKey, 'conversationId', 'captureId', 'importedAt', 'sha256', 'limits'];
  const keys = Reflect.ownKeys(input);
  if (keys.some(key => typeof key !== 'string' || !allowed.includes(key)))
    throw new Error('invalid');
  const values: Record<string, unknown> = Object.create(null);
  for (const key of allowed) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (key === 'limits' && descriptor === undefined) continue;
    if (!descriptor || !('value' in descriptor)) throw new Error('invalid');
    values[key] = descriptor.value;
  }
  if (
    typeof values.conversationId !== 'string' ||
    typeof values.captureId !== 'string' ||
    typeof values.importedAt !== 'string' ||
    typeof values.sha256 !== 'function'
  )
    throw new Error('invalid');
  return {
    metadata: {
      conversationId: values.conversationId,
      captureId: values.captureId,
      importedAt: values.importedAt,
      sha256: values.sha256 as ImportMetadata['sha256'],
    },
    source: values[sourceKey],
    limits: values.limits,
  };
}

/** Import from a fully validated, aggregate-bounded set of conversation shards. */
export async function importChatGptOfficialConversationSources(
  input: ImportChatGptOfficialConversationSourcesInput
): Promise<ChatGptOfficialImportResult> {
  let prepared: PreparedImportInput;
  try {
    prepared = snapshotImportInput(input, 'sources');
  } catch {
    importFail('invalid-import-input');
  }
  let selection: ChatGptOfficialConversationSelection;
  try {
    selection = await selectChatGptOfficialConversationSources({
      sources: prepared.source as ChatGptOfficialConversationSource[],
      conversationId: prepared.metadata.conversationId,
      limits: prepared.limits as Partial<ChatGptOfficialMultiSelectionLimits> | undefined,
    });
  } catch (error) {
    if (isOwnedChatGptOfficialSelectionError(error)) throw error;
    importFail('invalid-import-input');
  }
  return finishImport(prepared.metadata, selection);
}
