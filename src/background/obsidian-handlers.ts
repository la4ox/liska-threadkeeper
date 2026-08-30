/**
 * Obsidian API handlers for background service worker
 *
 * Handles save, get, and connection test operations
 */

import { ObsidianApiClient } from '../lib/obsidian-api';
import { getErrorMessage } from '../lib/error-utils';
import { generateNoteContent } from '../lib/note-generator';
import {
  resolvePathTemplate,
  containsPathTraversal,
  getDateVariables,
  getSearchBasePath,
} from '../lib/path-utils';
import { lookupExistingFile, buildAppendContent } from '../lib/append-utils';
import { applyLineEnding } from '../lib/frontmatter-parser';
import { classifyNoteProbe, isSameConversation, type ProbeState } from '../lib/note-identity';
import { resolveImagesForObsidian, stripImagePlaceholders } from '../lib/image-output';
import { flattenLargeCallouts } from '../lib/callout-flatten';
import { base64ToBytes } from '../lib/image-utils';
import { collisionSuffix, candidateFileName } from '../lib/filename-collision';
import { validateObsidianUrl } from '../lib/validation';
import { extractTailMessages } from '../lib/message-counter';
import { ARCHIVE_COMPANION_API_TIMEOUT_MS } from '../lib/constants';
import { isStagedBinaryAssetDescriptor } from '../lib/binary-asset-contract';
import type {
  AIPlatform,
  ArchiveCompanionArtifact,
  ExtensionSettings,
  ObsidianNote,
  SaveResponse,
  StagedBinaryAssetDescriptor,
} from '../lib/types';

/**
 * Create an ObsidianApiClient if API key is configured.
 * Returns the client or an error object.
 */
function createObsidianClient(settings: ExtensionSettings): ObsidianApiClient | { error: string } {
  if (!settings.obsidianApiKey) {
    return { error: 'API key not configured' };
  }
  // Defence-in-depth: re-validate URL from storage before sending Bearer token
  let validatedUrl: string;
  try {
    validatedUrl = validateObsidianUrl(settings.obsidianUrl);
  } catch (error) {
    return { error: `Invalid Obsidian URL: ${getErrorMessage(error)}` };
  }
  return new ObsidianApiClient(validatedUrl, settings.obsidianApiKey);
}

/**
 * Type guard for client creation error
 */
function isClientError(client: ObsidianApiClient | { error: string }): client is { error: string } {
  return 'error' in client;
}

export interface ArchiveCompanionWriteRequest {
  source: AIPlatform;
  captureId: string;
  conversationKey: string;
  artifact: ArchiveCompanionArtifact;
  bytes: Uint8Array;
}

/** A finalized extension Blob URL, consumed exactly once for one asset write. */
export interface StagedBinaryAssetWriteRequest {
  source: AIPlatform;
  captureId: string;
  conversationKey: string;
  descriptor: StagedBinaryAssetDescriptor;
  blobUrl: string;
}

type ArchiveObsidianFailureCode =
  | 'archive-obsidian-preflight-failed'
  | 'archive-obsidian-preflight-timeout'
  | 'archive-obsidian-preflight-existing'
  | 'archive-obsidian-put-failed'
  | 'archive-obsidian-put-timeout'
  | 'archive-obsidian-readback-failed'
  | 'archive-obsidian-readback-timeout'
  | 'archive-obsidian-readback-missing'
  | 'archive-obsidian-readback-size-mismatch'
  | 'archive-obsidian-readback-hash-mismatch'
  | 'archive-obsidian-readback-hash-failed';

type StagedBinaryObsidianFailureCode =
  | 'binary-obsidian-preflight-failed'
  | 'binary-obsidian-preflight-timeout'
  | 'binary-obsidian-preflight-existing'
  | 'binary-obsidian-blob-read-failed'
  | 'binary-obsidian-blob-integrity-failed'
  | 'binary-obsidian-put-failed'
  | 'binary-obsidian-put-timeout'
  | 'binary-obsidian-readback-failed'
  | 'binary-obsidian-readback-timeout'
  | 'binary-obsidian-readback-missing'
  | 'binary-obsidian-readback-size-mismatch'
  | 'binary-obsidian-readback-hash-mismatch'
  | 'binary-obsidian-readback-hash-failed';

const OBSIDIAN_TIMEOUT_MESSAGE = 'Request timed out. Please check your connection.';
/**
 * Local REST API parses `application/json` request bodies and serializes them
 * again before writing. Archive companions require byte-for-byte preservation,
 * so transport the JSON bytes as opaque binary while retaining their `.json`
 * filenames and manifest media type.
 */
const ARCHIVE_COMPANION_TRANSPORT_CONTENT_TYPE = 'application/octet-stream';

/** Return only a fixed local diagnostic code; never surface API details. */
function archiveObsidianFailureCode(
  stage: 'preflight' | 'put' | 'readback',
  error?: unknown
): ArchiveObsidianFailureCode {
  const timedOut =
    (error instanceof DOMException && error.name === 'TimeoutError') ||
    (error instanceof Error &&
      error.name === 'ObsidianApiError' &&
      error.message === OBSIDIAN_TIMEOUT_MESSAGE);
  if (stage === 'preflight') {
    return timedOut ? 'archive-obsidian-preflight-timeout' : 'archive-obsidian-preflight-failed';
  }
  if (stage === 'put') {
    return timedOut ? 'archive-obsidian-put-timeout' : 'archive-obsidian-put-failed';
  }
  return timedOut ? 'archive-obsidian-readback-timeout' : 'archive-obsidian-readback-failed';
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const exact = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', exact);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function archiveCompanionVaultPath(
  settings: ExtensionSettings,
  request: ArchiveCompanionWriteRequest
): string | undefined {
  const variables = {
    platform: request.source,
    ...getDateVariables(new Date()),
  };
  const resolvedFolder = resolvePathTemplate(settings.vaultPath, variables);
  const path = [
    ...(resolvedFolder ? [resolvedFolder] : []),
    '_liska-archive',
    request.conversationKey,
    request.captureId,
    ...request.artifact.relativePath.split('/'),
  ].join('/');
  return containsPathTraversal(path) ? undefined : path;
}

function stagedBinaryAssetVaultPath(
  settings: ExtensionSettings,
  request: StagedBinaryAssetWriteRequest
): string | undefined {
  if (!isStagedBinaryAssetDescriptor(request.descriptor)) return undefined;
  const variables = {
    platform: request.source,
    ...getDateVariables(new Date()),
  };
  const resolvedFolder = resolvePathTemplate(settings.vaultPath, variables);
  const path = [
    ...(resolvedFolder ? [resolvedFolder] : []),
    '_liska-archive',
    request.conversationKey,
    request.captureId,
    request.descriptor.relativePath,
  ].join('/');
  return containsPathTraversal(path) ? undefined : path;
}

/**
 * Persist one immutable structured-archive companion beside the note's
 * resolved vault folder. Existing snapshots are never overwritten, and a
 * binary readback/hash check prevents a successful request from being reported
 * as a verified archive write when the vault did not retain the exact bytes.
 */
export async function handleSaveArchiveCompanion(
  settings: ExtensionSettings,
  request: ArchiveCompanionWriteRequest
): Promise<SaveResponse> {
  const client = createObsidianClient(settings);
  if (isClientError(client)) {
    return { success: false, error: 'archive-obsidian-preflight-failed' };
  }

  const path = archiveCompanionVaultPath(settings, request);
  if (!path) return { success: false, error: 'archive-obsidian-preflight-failed' };

  let existing: string | null;
  try {
    existing = await client.getFile(path);
  } catch (error) {
    return { success: false, error: archiveObsidianFailureCode('preflight', error) };
  }
  if (existing !== null) {
    return { success: false, error: 'archive-obsidian-preflight-existing' };
  }

  try {
    await client.putBinaryFile(
      path,
      request.bytes,
      ARCHIVE_COMPANION_TRANSPORT_CONTENT_TYPE,
      ARCHIVE_COMPANION_API_TIMEOUT_MS
    );
  } catch (error) {
    return { success: false, error: archiveObsidianFailureCode('put', error) };
  }

  let readBack: Uint8Array | null;
  try {
    readBack = await client.getBinaryFile(path, ARCHIVE_COMPANION_API_TIMEOUT_MS);
  } catch (error) {
    return { success: false, error: archiveObsidianFailureCode('readback', error) };
  }
  if (!readBack) return { success: false, error: 'archive-obsidian-readback-missing' };
  if (readBack.byteLength !== request.bytes.byteLength) {
    return { success: false, error: 'archive-obsidian-readback-size-mismatch' };
  }

  let readBackSha256: string;
  try {
    readBackSha256 = await sha256Hex(readBack);
  } catch {
    return { success: false, error: 'archive-obsidian-readback-hash-failed' };
  }
  if (readBackSha256 !== request.artifact.sha256) {
    return { success: false, error: 'archive-obsidian-readback-hash-mismatch' };
  }
  return { success: true };
}

function stagedBinaryFailureCode(
  stage: 'preflight' | 'put' | 'readback',
  error?: unknown
): StagedBinaryObsidianFailureCode {
  const timedOut =
    (error instanceof DOMException && error.name === 'TimeoutError') ||
    (error instanceof Error &&
      error.name === 'ObsidianApiError' &&
      error.message === OBSIDIAN_TIMEOUT_MESSAGE);
  if (stage === 'preflight') {
    return timedOut ? 'binary-obsidian-preflight-timeout' : 'binary-obsidian-preflight-failed';
  }
  if (stage === 'put')
    return timedOut ? 'binary-obsidian-put-timeout' : 'binary-obsidian-put-failed';
  return timedOut ? 'binary-obsidian-readback-timeout' : 'binary-obsidian-readback-failed';
}

async function readVerifiedStagedBlob(
  request: StagedBinaryAssetWriteRequest
): Promise<{ bytes?: Uint8Array; error?: string }> {
  try {
    const response = await fetch(request.blobUrl);
    if (!response.ok) return { error: 'binary-obsidian-blob-read-failed' };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      bytes.byteLength !== request.descriptor.byteLength ||
      (await sha256Hex(bytes)) !== request.descriptor.sha256
    ) {
      return { error: 'binary-obsidian-blob-integrity-failed' };
    }
    return { bytes };
  } catch {
    return { error: 'binary-obsidian-blob-read-failed' };
  }
}

async function writeAndVerifyStagedBinary(
  client: ObsidianApiClient,
  path: string,
  bytes: Uint8Array,
  descriptor: StagedBinaryAssetDescriptor
): Promise<SaveResponse> {
  try {
    await client.putBinaryFile(
      path,
      bytes,
      ARCHIVE_COMPANION_TRANSPORT_CONTENT_TYPE,
      ARCHIVE_COMPANION_API_TIMEOUT_MS
    );
  } catch (error) {
    return { success: false, error: stagedBinaryFailureCode('put', error) };
  }

  let readBack: Uint8Array | null;
  try {
    readBack = await client.getBinaryFile(path, ARCHIVE_COMPANION_API_TIMEOUT_MS);
  } catch (error) {
    return { success: false, error: stagedBinaryFailureCode('readback', error) };
  }
  if (!readBack) return { success: false, error: 'binary-obsidian-readback-missing' };
  if (readBack.byteLength !== descriptor.byteLength) {
    return { success: false, error: 'binary-obsidian-readback-size-mismatch' };
  }
  try {
    return (await sha256Hex(readBack)) === descriptor.sha256
      ? { success: true }
      : { success: false, error: 'binary-obsidian-readback-hash-mismatch' };
  } catch {
    return { success: false, error: 'binary-obsidian-readback-hash-failed' };
  }
}

/**
 * Persist one OPFS-verified staged asset without ever putting its bytes in an
 * extension message. Blob URL fetch is one asset at a time; the request and
 * readback use opaque binary transport and never overwrite an existing path.
 */
export async function handleSaveStagedBinaryAsset(
  settings: ExtensionSettings,
  request: StagedBinaryAssetWriteRequest
): Promise<SaveResponse> {
  const client = createObsidianClient(settings);
  if (isClientError(client)) return { success: false, error: 'binary-obsidian-preflight-failed' };
  const path = stagedBinaryAssetVaultPath(settings, request);
  if (!path || !request.blobUrl.startsWith('blob:')) {
    return { success: false, error: 'binary-obsidian-preflight-failed' };
  }

  try {
    if ((await client.getFile(path)) !== null) {
      return { success: false, error: 'binary-obsidian-preflight-existing' };
    }
  } catch (error) {
    return { success: false, error: stagedBinaryFailureCode('preflight', error) };
  }

  const staged = await readVerifiedStagedBlob(request);
  if (!staged.bytes) return { success: false, error: staged.error };
  return writeAndVerifyStagedBinary(client, path, staged.bytes, request.descriptor);
}

/**
 * Obsidian-only: flatten oversized callouts to plain text when enabled.
 * A huge single callout can hang Obsidian's renderer; downloaded markdown keeps
 * its callouts, so this runs only on the vault-save path.
 */
function maybeFlatten(content: string, settings: ExtensionSettings): string {
  return settings.flattenLargeCallouts
    ? flattenLargeCallouts(content, settings.maxCalloutLines)
    : content;
}

/**
 * conversationId → vault path where the conversation's note was last found
 * (append mode). Best-effort cache: after a calendar rollover the direct path
 * misses on every save and the fallback directory scan re-runs each time —
 * the memo turns that into a single GET. Service-worker restarts clear it;
 * misses simply fall back to the scan.
 */
const appendPathMemo = new Map<string, string>();

/** Bound memory: far above any realistic number of active conversations */
const APPEND_MEMO_MAX_ENTRIES = 100;

function rememberAppendPath(conversationId: string, path: string): void {
  if (appendPathMemo.size >= APPEND_MEMO_MAX_ENTRIES && !appendPathMemo.has(conversationId)) {
    appendPathMemo.clear();
  }
  appendPathMemo.set(conversationId, path);
}

/**
 * Try to append new messages to an existing file.
 * Returns a SaveResponse on success, or null to fall through to overwrite.
 */
async function tryAppendMode(
  client: ObsidianApiClient,
  settings: ExtensionSettings,
  note: ObsidianNote,
  fullPath: string,
  resolvedPath: string,
  searchBasePath: string
): Promise<SaveResponse | null> {
  if (
    !settings.enableAppendMode ||
    note.frontmatter.type === 'deep-research' ||
    note.frontmatter.presentation_mode !== undefined
  ) {
    return null;
  }

  try {
    const lookup = await lookupExistingFile(client, fullPath, resolvedPath, note, {
      searchBasePath,
      hintPath: appendPathMemo.get(note.frontmatter.id),
      filenameScheme: settings.templateOptions.filenameScheme,
    });
    if (!lookup.found) {
      // A miss is what sends the save down the fork path, so name the negative
      // rather than letting it vanish (issue #365).
      console.info('[G2O Background] Append lookup found no existing note', {
        missReason: lookup.missReason,
        directProbeState: lookup.directProbe?.state ?? 'unknown',
      });
      return null;
    }
    rememberAppendPath(note.frontmatter.id, lookup.path);

    const appendResult = buildAppendContent(lookup.content, note, settings);
    if (appendResult !== null) {
      // Flatten first, restore the file's own line ending last (ADR-026).
      // Reversing these two hands `flattenLargeCallouts()` lines ending in
      // '\r', which its header pattern cannot match past — the callout label
      // was dropped and a raw `[!TYPE] Label` left in the body, which in turn
      // made the message invisible to countExistingMessages() (#406, #407).
      const flattened = maybeFlatten(appendResult.content, settings);
      await client.putFile(lookup.path, applyLineEnding(flattened, appendResult.eol));
      return { success: true, isNewFile: false, messagesAppended: appendResult.messagesAppended };
    }
    return { success: true, isNewFile: false, messagesAppended: 0 };
  } catch (error) {
    console.warn('[G2O Background] Append mode failed, falling back to overwrite:', error);
    return null;
  }
}

function withAppendImageWarning(
  settings: ExtensionSettings,
  note: ObsidianNote,
  appendResult: SaveResponse
): SaveResponse {
  if (
    !settings.enableImageExport ||
    appendResult.messagesAppended === undefined ||
    appendResult.messagesAppended === 0
  ) {
    return appendResult;
  }

  const existingCount = Math.max(0, note.frontmatter.message_count - appendResult.messagesAppended);
  const appendedTail = extractTailMessages(note.body, existingCount);
  if (!appendedTail.includes('g2o-image://')) return appendResult;

  return {
    ...appendResult,
    warning:
      'Images in newly appended messages were skipped because append mode does not export images yet',
  };
}

/**
 * Save note to Obsidian vault
 *
 * When append mode is enabled and the file already exists,
 * only new messages are appended while preserving existing content.
 * Falls back to full overwrite if append fails.
 */
export async function handleSave(
  settings: ExtensionSettings,
  note: ObsidianNote
): Promise<SaveResponse> {
  const client = createObsidianClient(settings);
  if (isClientError(client)) {
    return { success: false, error: client.error };
  }

  try {
    const templateVariables: Record<string, string> = {
      platform: note.frontmatter.source,
      ...getDateVariables(new Date()),
    };
    const resolvedPath = resolvePathTemplate(settings.vaultPath, templateVariables);
    const searchBasePath = getSearchBasePath(settings.vaultPath, templateVariables);
    const fullPath = resolvedPath ? `${resolvedPath}/${note.fileName}` : note.fileName;

    if (containsPathTraversal(fullPath)) {
      return { success: false, error: 'Invalid file path' };
    }

    // Append mode does not handle images yet (v1): strip any image placeholders
    // from the appended content so no dangling `g2o-image://` tokens are written.
    const appendNote = note.body.includes('g2o-image://')
      ? { ...note, body: stripImagePlaceholders(note.body) }
      : note;
    const appendResult = await tryAppendMode(
      client,
      settings,
      appendNote,
      fullPath,
      resolvedPath,
      searchBasePath
    );
    if (appendResult) return withAppendImageWarning(settings, note, appendResult);

    return await saveFreshNote(client, settings, note, resolvedPath, templateVariables);
  } catch (error) {
    console.error('[G2O Background] Save failed:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Write the note as a fresh (non-append) save: pick a name that does not
 * clobber a different conversation, write any images, then write the note.
 */
async function saveFreshNote(
  client: ObsidianApiClient,
  settings: ExtensionSettings,
  note: ObsidianNote,
  resolvedPath: string,
  templateVariables: Record<string, string>
): Promise<SaveResponse> {
  const target = await resolveCollisionFreePath(client, resolvedPath, note);
  if ('error' in target) {
    return { success: false, error: target.error };
  }
  if (target.renamed) {
    // The canonical name was taken by something we could not identify as ours.
    // This is the moment a duplicate note is born, so say exactly what each
    // rejected candidate held (issue #365).
    console.warn('[G2O Background] Filename collision: saved under an alternative name', {
      probes: target.probes.map(({ attempt, state }) => ({ attempt, state })),
    });
  }

  // Collision resolution owns the durable filename. Companion image names
  // and wikilinks must use that same resolved namespace or a renamed note can
  // overwrite the earlier note's images.
  const resolvedNote =
    target.fileName === note.fileName ? note : { ...note, fileName: target.fileName };
  const { note: saveNote, failedImageCount } = await prepareNoteImages(
    client,
    settings,
    resolvedNote,
    templateVariables
  );
  const flattenedBody = maybeFlatten(saveNote.body, settings);
  const content = generateNoteContent({ ...saveNote, body: flattenedBody }, settings);
  await client.putFile(target.path, content);

  const warning = imageWarning(failedImageCount);
  return {
    success: true,
    isNewFile: target.isNewFile,
    ...(target.renamed && { savedAs: target.fileName }),
    ...(warning && { warning }),
  };
}

/** Outcome of the image-writing pass: the note to save, plus any images lost. */
interface PreparedNote {
  note: ObsidianNote;
  /** Count of image writes that could not be completed (issue #376). */
  failedImageCount: number;
}

/**
 * Build the user-facing warning for images that could not be written, or
 * undefined when every image succeeded.
 */
function imageWarning(failedImageCount: number): string | undefined {
  if (failedImageCount === 0) return undefined;
  const noun = failedImageCount === 1 ? 'image' : 'images';
  return `${failedImageCount} ${noun} could not be saved`;
}

/**
 * For a fresh (non-append) save, write captured images to the vault and return
 * a note whose body embeds them via `![[filename]]` wikilinks. When image
 * export is disabled or there are no images, image placeholders are stripped.
 *
 * Image-write failures never block the note (ADR-008, ADR-021, ADR-027), but they are
 * no longer silent: only a count is returned so title-derived attachment
 * names never enter console logs or user-facing toasts (issue #376).
 */
async function prepareNoteImages(
  client: ObsidianApiClient,
  settings: ExtensionSettings,
  note: ObsidianNote,
  templateVariables: Record<string, string>
): Promise<PreparedNote> {
  const images = settings.enableImageExport ? (note.images ?? []) : [];
  if (images.length === 0) {
    const stripped = note.body.includes('g2o-image://')
      ? { ...note, body: stripImagePlaceholders(note.body) }
      : note;
    return { note: stripped, failedImageCount: 0 };
  }

  const baseName = note.fileName.replace(/\.md$/i, '');
  const { body, files } = resolveImagesForObsidian(note.body, images, baseName);

  const imageDir = resolvePathTemplate(settings.imageVaultPath, templateVariables);
  let failedImageCount = 0;
  for (const file of files) {
    const path = imageDir ? `${imageDir}/${file.fileName}` : file.fileName;
    if (containsPathTraversal(path)) {
      failedImageCount += 1;
      continue;
    }
    try {
      await client.putBinaryFile(path, base64ToBytes(file.data), file.mimeType);
    } catch {
      console.warn('[G2O Background] Image write failed');
      failedImageCount += 1;
    }
  }

  return { note: { ...note, body }, failedImageCount };
}

/** Probe attempts: original + hash suffix + a few counters for hash collisions */
const MAX_COLLISION_ATTEMPTS = 10;

interface WritableTarget {
  path: string;
  fileName: string;
  isNewFile: boolean;
  /** True when the original name was occupied by a different conversation */
  renamed: boolean;
  /** What each probed candidate name held, in probe order (issue #365). */
  probes: readonly ProbeOutcome[];
}

/** What one candidate file name held when it was probed. */
interface ProbeOutcome {
  attempt: number;
  fileName: string;
  state: ProbeState;
  /** The id actually read from that file, when it had one. */
  foundId?: string;
}

/**
 * Find a path this note may be written to without clobbering a DIFFERENT
 * conversation (issue #327: identically-titled conversations, e.g.
 * Perplexity repeating tasks, silently overwrote each other).
 *
 * A file is writable when it does not exist, or when its frontmatter id
 * matches this note's id (same conversation being re-saved). Files whose
 * frontmatter cannot be parsed are treated as foreign and protected.
 * Alternative names are deterministic per conversation (hash of its id),
 * so re-saves always land on the same file.
 */
async function resolveCollisionFreePath(
  client: ObsidianApiClient,
  resolvedPath: string,
  note: ObsidianNote
): Promise<WritableTarget | { error: string }> {
  const suffix = collisionSuffix(note.frontmatter.id);
  const probes: ProbeOutcome[] = [];

  for (let attempt = 0; attempt < MAX_COLLISION_ATTEMPTS; attempt++) {
    const fileName = candidateFileName(note.fileName, suffix, attempt);
    const path = resolvedPath ? `${resolvedPath}/${fileName}` : fileName;

    const existing = await client.getFile(path);
    const probe = classifyNoteProbe(existing, note.frontmatter.id);
    probes.push({ attempt, fileName, ...probe });

    if (probe.state === 'absent') {
      return { path, fileName, isNewFile: true, renamed: attempt > 0, probes };
    }
    if (isSameConversation(probe)) {
      return { path, fileName, isNewFile: false, renamed: attempt > 0, probes };
    }
    // Occupied by a different conversation, or holding something we cannot
    // identify (empty / unparseable / no id): never overwrite — try the next
    // deterministic candidate. Which of those it was is now recorded, so a
    // duplicate reported from the field can be traced back to its cause.
  }

  console.warn(
    '[G2O Background] Filename collision: no free name found',
    probes.map(({ attempt, state }) => ({ attempt, state }))
  );
  return {
    error: `filename collision: could not find a free name after ${MAX_COLLISION_ATTEMPTS} attempts`,
  };
}

/**
 * Test connection to Obsidian REST API
 */
export async function handleTestConnection(
  settings: ExtensionSettings
): Promise<{ success: boolean; error?: string }> {
  const client = createObsidianClient(settings);
  if (isClientError(client)) {
    return { success: false, error: client.error };
  }

  try {
    const result = await client.testConnection();

    if (!result.reachable) {
      return {
        success: false,
        error: result.error ?? 'Cannot reach Obsidian. Is it running?',
      };
    }

    if (!result.authenticated) {
      return {
        success: false,
        error: result.error ?? 'Invalid API key. Please check your settings.',
      };
    }

    return { success: true };
  } catch (error) {
    console.error('[G2O Background] Test connection failed:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}
