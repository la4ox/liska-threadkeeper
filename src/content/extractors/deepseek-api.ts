import {
  buildCaptureManifest,
  inventoryDeepSeekRawAssets,
  normalizeDeepSeekCapture,
  preflightDeepSeekHistoryArtifact,
  type DeepSeekAssetInventory,
  type DeepSeekNormalizationInput,
  type LiskaThreadArchive,
  type RawCaptureBundle,
} from '../../archive';
import { MAX_CONVERSATION_TITLE_LENGTH } from '../../lib/constants';
import type {
  ArchiveCompanionBundle,
  ConversationData,
  DeepSeekAssetExportContext,
} from '../../lib/types';
import { projectArchiveBranch } from '../archive-projection';
import {
  appendJsonCanonicalCompanion,
  buildJsonRawManifestCompanion,
} from '../capture/json-archive-companion';
import { captureResponseArtifact, hashCaptureManifest, sha256Hex } from '../capture/response';

const HISTORY_ENDPOINT = 'https://chat.deepseek.com/api/v0/chat/history_messages';
const HISTORY_PATH_PATTERN = '/api/v0/chat/history_messages';
const HISTORY_TIMEOUT_MS = 15_000;
const HISTORY_MAX_BYTES = 32 * 1024 * 1024;
const ARTIFACT_ID = 'conversation';

export const DEEPSEEK_ASSETS_NOT_ATTEMPTED_WARNING =
  'DeepSeek attachment metadata was inventoried; binary acquisition was not attempted.';
export const DEEPSEEK_STRUCTURED_EVIDENCE_FALLBACK_WARNING =
  'DeepSeek structured history could not be normalized or projected; the readable note uses the rendered page and preserves verified raw capture evidence.';

export interface DeepSeekApiConversation {
  data: ConversationData;
  archive: LiskaThreadArchive;
  archiveCompanion: ArchiveCompanionBundle;
  assetExportContext: DeepSeekAssetExportContext;
  warnings: string[];
}

export interface DeepSeekApiDependencies {
  createCaptureId?: () => string;
  now?: () => Date;
  normalizeCapture?: (
    input: DeepSeekNormalizationInput
  ) => ReturnType<typeof normalizeDeepSeekCapture>;
}

export class DeepSeekStructuredCaptureError extends Error {
  readonly code: string;
  readonly archiveCompanion?: ArchiveCompanionBundle;

  constructor(code: string, archiveCompanion?: ArchiveCompanionBundle) {
    super(`DeepSeek structured capture failed (${code}).`);
    this.name = 'DeepSeekStructuredCaptureError';
    this.code = code;
    this.archiveCompanion = archiveCompanion;
  }
}

/** Fetch, preserve, normalize, and project a complete non-delta DeepSeek response. */
// eslint-disable-next-line max-lines-per-function -- Capture, manifest, normalization, and projection must stay in evidence order.
export async function fetchDeepSeekConversation(
  conversationId: string,
  includeThinking: boolean,
  dependencies: DeepSeekApiDependencies = {}
): Promise<DeepSeekApiConversation | null> {
  const token = readAuthToken();
  if (!token) return null;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), HISTORY_TIMEOUT_MS);
  try {
    const response = await requestHistory(conversationId, token, controller.signal);
    const artifact = await captureResponseArtifact(response, {
      artifactId: ARTIFACT_ID,
      relativePath: 'responses/conversation.json',
      endpoint: { method: 'GET', pathPattern: HISTORY_PATH_PATTERN },
      maxBytes: HISTORY_MAX_BYTES,
      mediaType: 'application/json',
    });
    const observedUnknownContentTypes = preflightDeepSeekHistoryArtifact(
      artifact.bytes,
      conversationId
    );
    const raw = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(artifact.bytes)
    ) as unknown;
    const assetInventory = await inventoryDeepSeekRawAssets({
      raw,
      artifactId: ARTIFACT_ID,
      sha256: sha256Hex,
    });
    const bundle = buildCaptureBundle(
      conversationId,
      artifact,
      dependencies,
      observedUnknownContentTypes,
      assetInventory
    );
    const manifestSha256 = await hashCaptureManifest(bundle.manifest);
    let archiveCompanion: ArchiveCompanionBundle;
    try {
      archiveCompanion = await buildJsonRawManifestCompanion(bundle, sha256Hex, 'deepseek');
    } catch {
      throw new DeepSeekStructuredCaptureError('companion-build-failed');
    }

    let archive: LiskaThreadArchive;
    try {
      const normalized = await (dependencies.normalizeCapture ?? normalizeDeepSeekCapture)({
        bundle,
        artifactId: ARTIFACT_ID,
        manifestSha256,
        sha256: sha256Hex,
      });
      archive = normalized.archive;
    } catch {
      throw new DeepSeekStructuredCaptureError('normalization-failed', archiveCompanion);
    }

    try {
      const projected = projectArchiveBranch(archive, { includeToolContent: includeThinking });
      archiveCompanion = await appendJsonCanonicalCompanion(
        archiveCompanion,
        archive,
        sha256Hex,
        'deepseek'
      );
      const rawArtifact = archiveCompanion.artifacts.find(candidate => candidate.kind === 'raw');
      if (!rawArtifact) throw new DeepSeekStructuredCaptureError('companion-build-failed');
      return {
        archive,
        archiveCompanion,
        assetExportContext: { rawCaptureBundle: bundle, rawArtifact },
        warnings: projected.warnings,
        data: {
          ...projected.data,
          title: projected.data.title.substring(0, MAX_CONVERSATION_TITLE_LENGTH),
          messages: projected.data.messages.map(message => ({
            ...message,
            toolContent: message.toolContent?.replace(
              /\*\*Reasoning\*\*/g,
              '**DeepSeek reasoning**'
            ),
          })),
          capture: { mode: 'structured-api', completeness: 'complete' },
        },
      };
    } catch (error) {
      if (error instanceof DeepSeekStructuredCaptureError) throw error;
      throw new DeepSeekStructuredCaptureError('projection-failed', archiveCompanion);
    }
  } finally {
    window.clearTimeout(timeout);
  }
}

async function requestHistory(
  conversationId: string,
  token: string,
  signal: AbortSignal
): Promise<Response> {
  const url = new URL(HISTORY_ENDPOINT);
  url.searchParams.set('chat_session_id', conversationId);
  return fetch(url.href, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal,
  });
}

function buildCaptureBundle(
  conversationId: string,
  artifact: RawCaptureBundle['artifacts'][number],
  dependencies: DeepSeekApiDependencies,
  observedUnknownContentTypes: string[],
  assetInventory: DeepSeekAssetInventory
): RawCaptureBundle {
  const manifest = buildCaptureManifest({
    captureId: captureId(dependencies.createCaptureId),
    provider: 'deepseek',
    conversationId,
    capturedAt: captureTimestamp(dependencies.now),
    method: 'same-origin-api',
    artifacts: [artifact.record],
    assets: assetInventory.assets,
    completeness: {
      graph: 'complete',
      messages: 'complete',
      branches: 'complete',
      assets: assetInventory.completeness,
    },
    warnings:
      assetInventory.completeness === 'not-attempted'
        ? [DEEPSEEK_ASSETS_NOT_ATTEMPTED_WARNING]
        : assetInventory.warnings,
    observedUnknownContentTypes,
  });
  return {
    manifest,
    artifacts: [{ record: manifest.artifacts[0], bytes: artifact.bytes }],
    assets: [],
  };
}

function captureId(createCaptureId: (() => string) | undefined): string {
  const value = (createCaptureId ?? (() => `capture-deepseek-${crypto.randomUUID()}`))();
  if (!/^capture-deepseek-[A-Za-z0-9][A-Za-z0-9_-]{0,235}$/.test(value)) {
    throw new DeepSeekStructuredCaptureError('capture-id-invalid');
  }
  return value;
}

function captureTimestamp(now: (() => Date) | undefined): string {
  try {
    return (now ?? (() => new Date()))().toISOString();
  } catch {
    throw new DeepSeekStructuredCaptureError('capture-time-invalid');
  }
}

/** Read DeepSeek's page-local bearer without logging or persisting it. */
function readAuthToken(): string | null {
  try {
    const stored = localStorage.getItem('userToken');
    if (!stored) return null;
    let value: unknown = stored;
    try {
      const parsed = JSON.parse(stored) as unknown;
      value = isRecord(parsed) && 'value' in parsed ? parsed.value : parsed;
    } catch {
      // Older builds can store the value as an unquoted string.
    }
    if (typeof value !== 'string') return null;
    const token = value.trim();
    return token && token.length <= 16_384 && !/[\r\n]/.test(token) ? token : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
