import {
  buildCaptureManifest,
  type LiskaThreadArchive,
  type RawCaptureBundle,
} from '../../archive';
import {
  inventoryClaudeRawAssets,
  normalizeClaudeCapture,
  preflightClaudeDetailArtifact,
  ClaudeNormalizationError,
  type ClaudeAssetInventory,
  type ClaudeNormalizationInput,
} from '../../archive/normalizers/claude';
import { MAX_CONVERSATION_TITLE_LENGTH } from '../../lib/constants';
import type { ArchiveCompanionBundle, ConversationData } from '../../lib/types';
import { projectArchiveBranch } from '../archive-projection';
import {
  appendJsonCanonicalCompanion,
  buildJsonRawManifestCompanion,
} from '../capture/json-archive-companion';
import {
  cancelResponseBody,
  captureResponseArtifact,
  hashCaptureManifest,
  parseJsonArtifact,
  sha256Hex,
} from '../capture/response';
import {
  CLAUDE_ASSETS_NOT_ATTEMPTED_WARNING,
  CLAUDE_ASSET_INVENTORY_INCOMPLETE_WARNING,
  CLAUDE_DETAIL_CONTENT_UNVERIFIED_WARNING,
  CLAUDE_SCOPE_UNVERIFIED_WARNING,
  ClaudeStructuredCaptureError,
} from './claude-detail-contract';
import {
  CLAUDE_ORIGIN,
  CLAUDE_UUID_PATTERN,
  resolveClaudeOrganizationId,
} from './claude-detail-route';

const ARTIFACT_ID = 'conversation';
const REASONING_LABEL = 'Claude reasoning';

export const CLAUDE_DETAIL_PATH_PATTERN =
  '/api/organizations/{organizationId}/chat_conversations/{conversationId}';
export const CLAUDE_DETAIL_TIMEOUT_MS = 15_000;
export const CLAUDE_DETAIL_MAX_BYTES = 32 * 1024 * 1024;
export {
  CLAUDE_ASSETS_NOT_ATTEMPTED_WARNING,
  CLAUDE_ASSET_INVENTORY_INCOMPLETE_WARNING,
  CLAUDE_DETAIL_CONTENT_UNVERIFIED_WARNING,
  CLAUDE_DOM_FALLBACK_WARNING,
  CLAUDE_SCOPE_UNVERIFIED_WARNING,
  CLAUDE_STRUCTURED_EVIDENCE_FALLBACK_WARNING,
  ClaudeStructuredCaptureError,
} from './claude-detail-contract';
export { resolveClaudeOrganizationId } from './claude-detail-route';

export interface ClaudeApiConversation {
  data: ConversationData;
  archive: LiskaThreadArchive;
  archiveCompanion: ArchiveCompanionBundle;
  warnings: string[];
}

export interface ClaudeApiDependencies {
  createCaptureId?: () => string;
  now?: () => Date;
  normalizeCapture?: (input: ClaudeNormalizationInput) => ReturnType<typeof normalizeClaudeCapture>;
  /** Test seam only; resolved organization IDs are still validated and never persisted. */
  resolveOrganizationId?: (conversationId: string) => string | null;
}

/** One exact same-origin detail read; successful transport never implies complete coverage. */
// eslint-disable-next-line max-lines-per-function -- Keep verified raw evidence before normalization and projection.
export async function fetchClaudeConversation(
  conversationId: string,
  includeThinking: boolean,
  dependencies: ClaudeApiDependencies = {}
): Promise<ClaudeApiConversation | null> {
  if (!CLAUDE_UUID_PATTERN.test(conversationId)) {
    throw new ClaudeStructuredCaptureError('conversation-id-invalid');
  }
  const organizationId = resolveOrganizationId(conversationId, dependencies);
  if (organizationId === null) return null;

  const artifact = await captureClaudeDetail(conversationId, organizationId);
  const { raw, observedUnknownContentTypes } = preflightDetail(artifact.bytes, conversationId);
  let inventory: ClaudeAssetInventory | null;
  try {
    inventory = await inventoryClaudeRawAssets({
      raw,
      artifactId: ARTIFACT_ID,
      sha256: sha256Hex,
    });
  } catch {
    // Inventory failure must not discard identity-checked exact raw evidence.
    inventory = null;
  }

  let bundle: RawCaptureBundle;
  try {
    bundle = buildCaptureBundle(
      conversationId,
      artifact,
      inventory,
      observedUnknownContentTypes,
      dependencies
    );
  } catch (error) {
    if (error instanceof ClaudeStructuredCaptureError) throw error;
    throw new ClaudeStructuredCaptureError('capture-manifest-failed');
  }

  let archiveCompanion: ArchiveCompanionBundle;
  try {
    archiveCompanion = await buildJsonRawManifestCompanion(bundle, sha256Hex, 'claude');
  } catch {
    throw new ClaudeStructuredCaptureError('companion-build-failed');
  }
  if (inventory === null) {
    throw new ClaudeStructuredCaptureError('asset-inventory-failed', archiveCompanion);
  }

  let archive: LiskaThreadArchive;
  try {
    const normalized = await (dependencies.normalizeCapture ?? normalizeClaudeCapture)({
      bundle,
      artifactId: ARTIFACT_ID,
      manifestSha256: await hashCaptureManifest(bundle.manifest),
      sha256: sha256Hex,
    });
    archive = normalized.archive;
  } catch {
    throw new ClaudeStructuredCaptureError('normalization-failed', archiveCompanion);
  }

  try {
    const projected = projectArchiveBranch(archive, {
      targetNodeId: archive.conversation.currentNodeId,
      includeToolContent: includeThinking,
      reasoningLabel: REASONING_LABEL,
    });
    archiveCompanion = await appendJsonCanonicalCompanion(
      archiveCompanion,
      archive,
      sha256Hex,
      'claude'
    );
    return {
      archive,
      archiveCompanion,
      warnings: [...new Set([...bundle.manifest.warnings, ...projected.warnings])],
      data: {
        ...projected.data,
        title: projected.data.title.substring(0, MAX_CONVERSATION_TITLE_LENGTH),
        capture: { mode: 'structured-api', completeness: 'partial' },
      },
    };
  } catch {
    throw new ClaudeStructuredCaptureError('projection-failed', archiveCompanion);
  }
}

function resolveOrganizationId(
  conversationId: string,
  dependencies: ClaudeApiDependencies
): string | null {
  try {
    const organizationId = dependencies.resolveOrganizationId
      ? dependencies.resolveOrganizationId(conversationId)
      : resolveClaudeOrganizationId(conversationId);
    return organizationId !== null && CLAUDE_UUID_PATTERN.test(organizationId)
      ? organizationId
      : null;
  } catch {
    return null;
  }
}

/** The deadline covers both fetch and bounded exact-byte acquisition, including a stalled body. */
async function captureClaudeDetail(
  conversationId: string,
  organizationId: string
): Promise<RawCaptureBundle['artifacts'][number]> {
  const controller = new AbortController();
  let response: Response | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new ClaudeStructuredCaptureError('request-timeout'));
      controller.abort();
      if (response) void cancelResponseBody(response, 'Claude detail capture deadline exceeded');
    }, CLAUDE_DETAIL_TIMEOUT_MS);
  });
  const capture = async () => {
    response = await fetch(
      `${CLAUDE_ORIGIN}/api/organizations/${organizationId}/chat_conversations/${conversationId}`,
      {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }
    );
    if (controller.signal.aborted) {
      void cancelResponseBody(response, 'Claude detail capture deadline exceeded');
      throw new ClaudeStructuredCaptureError('request-timeout');
    }
    return captureDetailResponse(response);
  };
  try {
    return await Promise.race([capture(), deadline]);
  } catch (error) {
    if (error instanceof ClaudeStructuredCaptureError) throw error;
    throw new ClaudeStructuredCaptureError('request-failed');
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function captureDetailResponse(
  response: Response
): Promise<RawCaptureBundle['artifacts'][number]> {
  if (response.status !== 200) {
    await cancelResponseBody(response, 'Claude detail returned an unexpected HTTP status');
    throw new ClaudeStructuredCaptureError('response-status-invalid');
  }
  if (
    response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !==
    'application/json'
  ) {
    await cancelResponseBody(response, 'Claude detail returned an unexpected media type');
    throw new ClaudeStructuredCaptureError('response-media-type-invalid');
  }
  try {
    return await captureResponseArtifact(response, {
      artifactId: ARTIFACT_ID,
      relativePath: 'responses/conversation.json',
      endpoint: { method: 'GET', pathPattern: CLAUDE_DETAIL_PATH_PATTERN },
      maxBytes: CLAUDE_DETAIL_MAX_BYTES,
      mediaType: 'application/json',
    });
  } catch (error) {
    const oversized =
      error instanceof Error &&
      error.message ===
        `Capture response exceeds the ${CLAUDE_DETAIL_MAX_BYTES}-byte safety limit.`;
    throw new ClaudeStructuredCaptureError(
      oversized ? 'response-too-large' : 'response-capture-failed'
    );
  }
}

function preflightDetail(
  bytes: Uint8Array,
  conversationId: string
): { raw: unknown; observedUnknownContentTypes: string[] } {
  try {
    const observedUnknownContentTypes = preflightClaudeDetailArtifact(bytes, conversationId);
    return { raw: parseJsonArtifact(bytes), observedUnknownContentTypes };
  } catch (error) {
    const identityMismatch =
      error instanceof ClaudeNormalizationError && error.code === 'conversation-id-mismatch';
    throw new ClaudeStructuredCaptureError(
      identityMismatch ? 'conversation-id-mismatch' : 'response-schema-invalid'
    );
  }
}

function buildCaptureBundle(
  conversationId: string,
  artifact: RawCaptureBundle['artifacts'][number],
  inventory: ClaudeAssetInventory | null,
  observedUnknownContentTypes: string[],
  dependencies: ClaudeApiDependencies
): RawCaptureBundle {
  const manifest = buildCaptureManifest({
    captureId: captureId(dependencies.createCaptureId),
    provider: 'claude',
    conversationId,
    capturedAt: captureTimestamp(dependencies.now),
    method: 'same-origin-api',
    artifacts: [artifact.record],
    assets: inventory?.assets ?? [],
    completeness: {
      graph: 'unknown',
      messages: 'unknown',
      branches: 'unknown',
      assets: inventory?.completeness ?? 'unknown',
    },
    warnings: [
      CLAUDE_SCOPE_UNVERIFIED_WARNING,
      inventory === null
        ? CLAUDE_ASSET_INVENTORY_INCOMPLETE_WARNING
        : CLAUDE_ASSETS_NOT_ATTEMPTED_WARNING,
      CLAUDE_DETAIL_CONTENT_UNVERIFIED_WARNING,
    ],
    observedUnknownContentTypes,
  });
  return {
    manifest,
    artifacts: [{ record: manifest.artifacts[0], bytes: artifact.bytes }],
    assets: [],
  };
}

function captureId(createCaptureId: ClaudeApiDependencies['createCaptureId']): string {
  try {
    const value = (createCaptureId ?? (() => `capture-claude-${crypto.randomUUID()}`))();
    if (/^capture-claude-[A-Za-z0-9][A-Za-z0-9_-]{0,237}$/.test(value)) return value;
  } catch {
    // Never expose a generator's untrusted error details.
  }
  throw new ClaudeStructuredCaptureError('capture-id-invalid');
}

function captureTimestamp(now: ClaudeApiDependencies['now']): string {
  try {
    return (now ?? (() => new Date()))().toISOString();
  } catch {
    throw new ClaudeStructuredCaptureError('capture-time-invalid');
  }
}
