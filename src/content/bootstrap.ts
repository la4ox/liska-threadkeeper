/* eslint-disable max-lines -- Keep the platform bootstrap and its destination-specific dependency wiring in one orchestration module. */
/**
 * Content Script Bootstrap
 *
 * All content-script logic lives here so tests can import it without
 * triggering initialization; the import-time side effect (auto-start on
 * page load) is confined to the index.ts entry shim.
 */

import { GeminiExtractor } from './extractors/gemini';
import { ClaudeExtractor } from './extractors/claude';
import { ChatGPTExtractor } from './extractors/chatgpt';
import { PerplexityExtractor } from './extractors/perplexity';
import { NotebookLMExtractor } from './extractors/notebooklm';
import { DeepSeekExtractor } from './extractors/deepseek';
import { CONVERSATION_READY_SELECTORS } from './extractors/selectors/ready';
import { extractErrorMessage } from '../lib/error-utils';
import type {
  AllBranchesPresentationPlan,
  ArchiveCompanionArtifact,
  ArchiveCompanionKind,
  ArchiveCompanionBundle,
  ConversationData,
  ChatGptStructuredPresentationContext,
  ExtractionResult,
  IConversationExtractor,
} from '../lib/types';
import {
  prepareAllBranchesPersistence,
  persistAllBranchesPresentation,
  type AllBranchesPersistenceSummary,
  type AllBranchesPersistenceDependencies,
  type AllBranchesNoteFingerprint,
  type AllBranchesWriteOutcome,
  type PreparedAllBranchesPersistence,
} from './archive-branch-persistence';
import { persistChatGptDestinationHonestAttachments } from './chatgpt-asset-export';
import type { ChatGptAssetExportResult } from './chatgpt-asset-export';
import { decorateChatGptArchiveNote } from './chatgpt-archive-links';
import { snapshotChatGptDestinationArchiveReceipt } from '../lib/chatgpt-archive-receipt';
import { localizeChatGptSandboxLinks } from './chatgpt-sandbox-localization';
import { persistDeepSeekDestinationHonestAttachments } from './deepseek-asset-export';
import type {
  FinalizedFileArchivePresentationEvidence,
  FinalizedFilePresentationEvidence,
} from './finalized-html-assets';
import type { AllBranchesFileHtmlRequest } from './archive-branch-html-delivery';
import {
  canExportChatGptAttachments,
  canExportDeepSeekAttachments,
} from './attachment-export-gates';
import {
  observeChatGptAssetResolversViaOpaqueSource,
  resolveChatGptActiveImageAsset,
  resolveChatGptLibraryJpegAsset,
  observeChatGptInterpreterAssetResolvers,
} from './capture/chatgpt-current-branch';
import { conversationToNote } from './markdown';
import {
  DERIVED_HTML_UNAVAILABLE_WARNING,
  persistDerivedHtmlForFile,
} from './derived-html-persistence';
import {
  injectBranchExportButton,
  injectSyncButton,
  setButtonLoading,
  showAllBranchesStopControl,
  showErrorToast,
  showWarningToast,
  showToast,
} from './ui';
import type { AllBranchesStopControl } from './ui';
import { sendMessage } from '../lib/messaging';
import {
  createOperationWriteLedger,
  durableWriteOutcomeFromResult,
  type OperationWriteLedger,
} from '../lib/operation-write-ledger';
import {
  AUTO_SAVE_CHECK_INTERVAL,
  EVENT_THROTTLE_DELAY,
  INFO_TOAST_DURATION,
  MAX_CONTENT_SIZE,
  MAX_EXTENSION_MESSAGE_SIZE,
  MUTATION_DEBOUNCE_DELAY,
} from '../lib/constants';
import { jsonUtf8ByteLength, utf8ByteLength } from '../lib/byte-size';
import { generateNoteContent } from '../lib/note-generator';
import { sha256Hex } from '../lib/sha256';
import { flattenLargeCallouts } from '../lib/callout-flatten';
import { stripImagePlaceholders } from '../lib/image-output';
import {
  isSerializedSyncSettingsSnapshot,
  serializeSyncSettingsSnapshot,
} from '../lib/sync-settings-snapshot';
import type {
  AIPlatform,
  ContentScriptSettings,
  ExtensionSettings,
  ObsidianNote,
  OutputDestination,
  OutputResult,
  MultiOutputResponse,
  PersistentOutputDestination,
  StructuredArchiveSource,
} from '../lib/types';
import { platformForHost } from '../lib/platform-registry';
import { throttle } from '../lib/throttle';
import { abortStagedArchiveArtifact } from './archive-stage';
import { buildArchivePersistenceMessage, buildSaveToOutputsMessage } from './capture-routing';

/**
 * Platform-specific main content container selectors for optimized observation.
 * Keyed by AIPlatform so the compiler enforces an entry per platform (ADR-014).
 *
 * Each list is tried in order, falling back to document.body. The former
 * second entries (`#app-container` for the Google properties, `#__next` for the
 * React ones) were verified absent on all five platforms in 2026-07 — and they
 * could only ever be consulted when `<main>` is missing, which is precisely
 * when they are missing too. They are dropped rather than left as reassurance
 * that does nothing; the document.body fallback below is the real safety net.
 */
const PLATFORM_ROOT_SELECTORS: Record<AIPlatform, string[]> = {
  gemini: ['main'],
  claude: ['main'],
  chatgpt: ['main'],
  perplexity: ['main'],
  notebooklm: ['main'],
  deepseek: ['main', '[role="main"]'],
};

/**
 * Extractor constructors per platform. Lives here (not in the lib registry)
 * so lib/ stays free of content-layer imports (ADR-014).
 */
const EXTRACTOR_CONSTRUCTORS: Record<AIPlatform, new () => IConversationExtractor> = {
  gemini: GeminiExtractor,
  claude: ClaudeExtractor,
  chatgpt: ChatGPTExtractor,
  perplexity: PerplexityExtractor,
  notebooklm: NotebookLMExtractor,
  deepseek: DeepSeekExtractor,
};

/**
 * Get the optimal observation root for the current platform
 * Falls back to document.body if no platform-specific root is found
 */
function getObservationRoot(): Element {
  const platform = platformForHost(window.location.hostname);
  const selectors = platform ? PLATFORM_ROOT_SELECTORS[platform] : undefined;

  if (selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        console.debug(`[G2O] Using optimized observation root: ${selector}`);
        return element;
      }
    }
  }

  return document.body;
}

/**
 * Wait for the selected platform's UI-injection readiness hint (L-03)
 * Uses MutationObserver with debouncing instead of fixed timeout
 *
 * Performance optimizations:
 * - Observes platform-specific root instead of document.body (P-1)
 * - Debouncing prevents excessive DOM queries during rapid mutation bursts
 */
function waitForConversationContainer(readinessSelector: string): Promise<void> {
  return new Promise(resolve => {
    // Check if already exists
    const existing = document.querySelector(readinessSelector);
    if (existing) {
      resolve();
      return;
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    // Debounced check function
    const checkForContainer = (obs: MutationObserver) => {
      const container = document.querySelector(readinessSelector);
      if (container) {
        obs.disconnect();
        if (debounceTimer) {
          window.clearTimeout(debounceTimer);
        }
        resolve();
      }
    };

    // Use MutationObserver to watch for container with debouncing
    const observer = new MutationObserver((_mutations, obs) => {
      // Clear previous debounce timer
      if (debounceTimer) {
        window.clearTimeout(debounceTimer);
      }
      // Schedule check after debounce delay
      debounceTimer = setTimeout(() => checkForContainer(obs), MUTATION_DEBOUNCE_DELAY);
    });

    // P-1: Observe platform-specific root instead of document.body for better performance
    const observationRoot = getObservationRoot();
    observer.observe(observationRoot, {
      childList: true,
      subtree: true,
    });

    // Fallback timeout
    setTimeout(() => {
      observer.disconnect();
      if (debounceTimer) {
        window.clearTimeout(debounceTimer);
      }
      resolve();
    }, AUTO_SAVE_CHECK_INTERVAL);
  });
}

/**
 * Get the appropriate extractor for the current page
 *
 * Uses strict hostname comparison to prevent subdomain attacks
 * @see CodeQL: js/incomplete-url-substring-sanitization
 */
export function getExtractor(): IConversationExtractor | null {
  // platformForHost uses strict hostname equality, which prevents attacks
  // like "evil-gemini.google.com.attacker.com"
  const platform = platformForHost(window.location.hostname);
  return platform ? new EXTRACTOR_CONSTRUCTORS[platform]() : null;
}

/**
 * Start the content script when the DOM is ready.
 * Called once by the index.ts entry shim; exported so tests can drive it.
 */
export function startContentScript(): void {
  const startInit = () => {
    initialize().catch(error => {
      console.error('[G2O] Content script initialization failed:', error);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startInit);
  } else {
    startInit();
  }
}

/**
 * Initialize the content script
 */
export async function initialize(): Promise<void> {
  console.info('[G2O] Content script initializing on:', window.location.hostname);

  // Check if we have a valid extractor for this page
  const extractor = getExtractor();
  if (!extractor) {
    console.info('[G2O] No extractor available for this page, skipping initialization');
    return;
  }

  console.info(`[G2O] Using ${extractor.platform} extractor`);

  // Only this platform's hint may trigger UI injection (L-03).
  await waitForConversationContainer(CONVERSATION_READY_SELECTORS[extractor.platform]);

  // Apply throttle to sync handler (NEW-06)
  const throttledHandleSync = throttle(() => handleSync('current'), EVENT_THROTTLE_DELAY);
  injectSyncButton(throttledHandleSync);
  if (extractor.platform === 'chatgpt') {
    const throttledBranchSync = throttle(() => handleSync('selected'), EVENT_THROTTLE_DELAY);
    injectBranchExportButton(throttledBranchSync);
  }
  console.info('[G2O] Sync button injected');
}

/**
 * Get enabled output destinations from settings
 */
function getEnabledOutputs(settings: ContentScriptSettings): OutputDestination[] {
  const outputs: OutputDestination[] = [];
  const { outputOptions } = settings;

  if (outputOptions?.obsidian) outputs.push('obsidian');
  if (outputOptions?.file) outputs.push('file');
  if (outputOptions?.clipboard) outputs.push('clipboard');

  return outputs;
}

/**
 * Validate output configuration before sync
 * @returns error message if invalid, null if valid
 */
async function validateOutputConfig(
  settings: ContentScriptSettings,
  enabledOutputs: OutputDestination[]
): Promise<string | null> {
  if (enabledOutputs.length === 0) {
    return 'Please select at least one output destination in settings';
  }

  if (enabledOutputs.includes('obsidian')) {
    if (!settings.isApiKeyConfigured) {
      return 'Please configure your Obsidian API key in the extension settings';
    }

    const connectionTest = await testConnection();
    if (!connectionTest.success) {
      return connectionTest.error || 'Cannot connect to Obsidian';
    }
  }

  return null;
}

/**
 * Display save results to the user via toasts
 */
function displaySaveResults(saveResult: MultiOutputResponse, extractionWarnings?: string[]): void {
  // Show append-specific messages when applicable
  if (saveResult.allSuccessful && saveResult.messagesAppended !== undefined) {
    if (saveResult.messagesAppended > 0) {
      showToast(`${saveResult.messagesAppended} new message(s) appended`, 'success');
    } else {
      showToast('No new messages to append', 'info', INFO_TOAST_DURATION);
    }
  } else if (saveResult.allSuccessful) {
    showToast('Saved locally', 'success');
  } else if (saveResult.anySuccessful) {
    const successList = saveResult.results
      .filter((r: OutputResult) => r.success)
      .map((r: OutputResult) => r.destination)
      .join(', ');
    const failedList = saveResult.results
      .filter((r: OutputResult) => !r.success)
      .map((r: OutputResult) => `${r.destination}: ${r.error}`)
      .join('; ');
    showWarningToast(`Saved to: ${successList}. Failed: ${failedList}`);
  } else {
    const errorMsg = saveResult.results
      .map((r: OutputResult) => r.error)
      .filter(Boolean)
      .join('; ');
    showErrorToast(errorMsg || 'Failed to save');
  }

  // Non-fatal problems reported by a destination that still succeeded — e.g.
  // images that could not be written (issue #376). Shown alongside extraction
  // warnings so a successful save never hides a partial failure.
  const saveWarnings = saveResult.results
    .map((r: OutputResult) => r.warning)
    .filter((w): w is string => Boolean(w));
  const warnings = [...saveWarnings, ...(extractionWarnings ?? [])];

  if (warnings.length > 0) {
    setTimeout(() => {
      showWarningToast(warnings.join('. '));
    }, INFO_TOAST_DURATION);
  }
}

function archiveArtifactLabel(kind: ArchiveCompanionBundle['artifacts'][number]['kind']): string {
  switch (kind) {
    case 'raw':
      return 'raw archive companion';
    case 'manifest':
      return 'archive manifest companion';
    case 'canonical':
      return 'canonical archive companion';
  }
}

const ARCHIVE_OBSIDIAN_DIAGNOSTIC_CODES = new Set([
  'archive-obsidian-preflight-failed',
  'archive-obsidian-preflight-timeout',
  'archive-obsidian-preflight-existing',
  'archive-obsidian-put-failed',
  'archive-obsidian-put-timeout',
  'archive-obsidian-readback-failed',
  'archive-obsidian-readback-timeout',
  'archive-obsidian-readback-missing',
  'archive-obsidian-readback-size-mismatch',
  'archive-obsidian-readback-hash-mismatch',
  'archive-obsidian-readback-hash-failed',
]);
const ARCHIVE_CLEANUP_WARNING_CODES = new Set(['archive-stage-cleanup-deferred']);

/** Background error strings are untrusted at this UI boundary. */
function safeArchiveObsidianDiagnostic(result: OutputResult): string | undefined {
  return result.destination === 'obsidian' &&
    typeof result.error === 'string' &&
    ARCHIVE_OBSIDIAN_DIAGNOSTIC_CODES.has(result.error)
    ? result.error
    : undefined;
}

function safeArchiveCleanupWarning(result: OutputResult): string | undefined {
  return typeof result.warning === 'string' && ARCHIVE_CLEANUP_WARNING_CODES.has(result.warning)
    ? result.warning
    : undefined;
}

function archiveDestinationWarnings(
  label: string,
  destinations: readonly ('file' | 'obsidian')[],
  reason: string
): string[] {
  return destinations.map(
    destination => `${label} was not saved to ${destination} because ${reason}`
  );
}

const ARCHIVE_COMPANION_WRITE_ORDER: readonly ArchiveCompanionKind[] = [
  'raw',
  'manifest',
  'canonical',
];

function isStructuredArchiveSource(source: AIPlatform): source is StructuredArchiveSource {
  return source === 'chatgpt' || source === 'deepseek';
}

function requestedArchiveArtifacts(
  companion: ArchiveCompanionBundle,
  artifactKinds: readonly ArchiveCompanionKind[] | undefined
): ArchiveCompanionArtifact[] | undefined {
  const requested = artifactKinds ?? companion.artifacts.map(artifact => artifact.kind);
  if (!Array.isArray(requested) || requested.length === 0) return undefined;
  let previousIndex = -1;
  const selected: ArchiveCompanionArtifact[] = [];
  for (const kind of requested) {
    const order = ARCHIVE_COMPANION_WRITE_ORDER.indexOf(kind);
    if (order < 0 || order <= previousIndex) return undefined;
    previousIndex = order;
    const matching = companion.artifacts.filter(artifact => artifact.kind === kind);
    if (matching.length !== 1) return undefined;
    selected.push(matching[0]);
  }
  return selected;
}

function archiveWriteOutcome(
  response: unknown,
  label: string,
  requestedOutputs: readonly ('file' | 'obsidian')[],
  requireDurableOutcome = false
): { activeOutputs: ('file' | 'obsidian')[]; warnings: string[] } {
  if (
    !isMultiOutputResponse(response, requestedOutputs) ||
    (requireDurableOutcome &&
      response.results.some(result => !durableWriteOutcomeFromResult(result)))
  ) {
    return {
      activeOutputs: [],
      warnings: archiveDestinationWarnings(
        label,
        requestedOutputs,
        'the extension response was invalid'
      ),
    };
  }
  return {
    activeOutputs: response.results
      .filter(result => result.success)
      .map(result => result.destination) as ('file' | 'obsidian')[],
    warnings: response.results.flatMap(result => {
      const diagnostic = safeArchiveObsidianDiagnostic(result);
      const cleanupWarning = safeArchiveCleanupWarning(result);
      if (!result.success) {
        return [
          `${label} was not saved to ${result.destination}${
            diagnostic ? ` (${diagnostic})` : ''
          }${cleanupWarning ? ` (${cleanupWarning})` : ''}`,
        ];
      }
      return cleanupWarning
        ? [
            `${label} was saved to ${result.destination}, but temporary artifact cleanup was not confirmed (${cleanupWarning})`,
          ]
        : [];
    }),
  };
}

export interface ArchiveCompanionPersistenceOutcome {
  activeOutputs: PersistentOutputDestination[];
  warnings: string[];
}

/**
 * Persist selected immutable structured artifacts in order and retain the
 * destinations that reached every requested artifact. Callers use this to
 * make later ChatGPT attachment manifests destination-honest.
 */
// eslint-disable-next-line max-lines-per-function, complexity -- Per-artifact admission, issue/observation and destination gating form one auditable persistence boundary.
export async function persistArchiveCompanionArtifacts(
  companion: ArchiveCompanionBundle | undefined,
  noteFileName: string,
  source: AIPlatform,
  outputs: OutputDestination[],
  artifactKinds?: readonly ArchiveCompanionKind[],
  expectedSyncSettingsSnapshot?: string,
  writeLedger?: OperationWriteLedger
): Promise<ArchiveCompanionPersistenceOutcome> {
  if (!companion) return { activeOutputs: [], warnings: [] };
  const unclaimedStages = new Set(
    companion.artifacts
      .filter(artifact => artifact.transport === 'staged')
      .map(artifact => artifact.stageId)
  );
  const stageSource = isStructuredArchiveSource(source) ? source : undefined;
  const abortUnclaimedStages = async (): Promise<void> => {
    if (stageSource) {
      await Promise.all(
        [...unclaimedStages].map(stageId => abortStagedArchiveArtifact(stageId, stageSource))
      );
    }
    unclaimedStages.clear();
  };
  // The caller still owns every stage here. Reject malformed local metadata
  // before any commit can relinquish that claim to the worker.
  if (
    expectedSyncSettingsSnapshot !== undefined &&
    !isSerializedSyncSettingsSnapshot(expectedSyncSettingsSnapshot)
  ) {
    await abortUnclaimedStages();
    return { activeOutputs: [], warnings: ['archive-settings-snapshot-invalid'] };
  }
  let activeOutputs = outputs.filter(
    (output): output is PersistentOutputDestination => output === 'file' || output === 'obsidian'
  );
  if (activeOutputs.length === 0) {
    await abortUnclaimedStages();
    return {
      activeOutputs,
      warnings: [
        'Structured raw/canonical archive was not saved because only Clipboard is enabled',
      ],
    };
  }

  const warnings: string[] = [];
  const selected = requestedArchiveArtifacts(companion, artifactKinds);
  if (!selected) {
    await abortUnclaimedStages();
    return {
      activeOutputs: [],
      warnings: archiveDestinationWarnings(
        'requested archive companion set',
        activeOutputs,
        'the requested archive companion set is invalid'
      ),
    };
  }
  for (const artifact of selected) {
    if (activeOutputs.length === 0) break;
    if (artifact.transport === 'staged' && !stageSource) {
      warnings.push(
        ...archiveDestinationWarnings(
          archiveArtifactLabel(artifact.kind),
          activeOutputs,
          'its provider cannot use the staged archive transport'
        )
      );
      activeOutputs = [];
      break;
    }
    const message = buildArchivePersistenceMessage({
      companion,
      noteFileName,
      source,
      stageSource,
      artifact,
      outputs: activeOutputs,
      expectedSyncSettingsSnapshot,
      ...(writeLedger && { reportDurableWriteOutcome: true }),
    });
    const attempts = activeOutputs.map(destination => ({
      destination,
      attempt: writeLedger?.begin(destination, artifact.kind, artifact.byteLength),
    }));
    const label = archiveArtifactLabel(artifact.kind);
    if (
      artifact.transport === 'inline' &&
      jsonUtf8ByteLength(message) > MAX_EXTENSION_MESSAGE_SIZE
    ) {
      warnings.push(
        ...archiveDestinationWarnings(label, activeOutputs, 'it exceeds the 60 MiB message limit')
      );
      activeOutputs = [];
      attempts.forEach(({ attempt }) => attempt?.observe());
      continue;
    }

    try {
      if (artifact.transport === 'staged') unclaimedStages.delete(artifact.stageId);
      attempts.forEach(({ attempt }) => attempt?.issue());
      const response: unknown = await sendMessage(message);
      for (const { destination, attempt } of attempts) {
        const result = isMultiOutputResponse(response, activeOutputs)
          ? response.results.find(result => result.destination === destination)
          : undefined;
        attempt?.observe(durableWriteOutcomeFromResult(result));
      }
      const outcome = archiveWriteOutcome(
        response,
        label,
        activeOutputs,
        writeLedger !== undefined
      );
      warnings.push(...outcome.warnings);
      // A destination commits its snapshot in raw -> manifest -> canonical order.
      activeOutputs = outcome.activeOutputs;
    } catch {
      attempts.forEach(({ attempt }) => attempt?.observe());
      warnings.push(
        ...archiveDestinationWarnings(label, activeOutputs, 'the extension write failed')
      );
      activeOutputs = [];
    }
  }
  await abortUnclaimedStages();
  return { activeOutputs, warnings };
}

/**
 * Compatibility wrapper for callers that only need human-facing warnings.
 * Archive writes never join the Markdown message, and a failed companion
 * stays non-fatal so the readable note is still saved with an explicit warning.
 */
export async function persistArchiveCompanions(
  companion: ArchiveCompanionBundle | undefined,
  noteFileName: string,
  source: AIPlatform,
  outputs: OutputDestination[],
  expectedSyncSettingsSnapshot?: string
): Promise<string[]> {
  return (
    await persistArchiveCompanionArtifacts(
      companion,
      noteFileName,
      source,
      outputs,
      undefined,
      expectedSyncSettingsSnapshot
    )
  ).warnings;
}

function archivePersistenceWithSnapshot(
  expectedSyncSettingsSnapshot: string,
  writeLedger?: OperationWriteLedger
) {
  return (
    companion: ArchiveCompanionBundle,
    name: string,
    source: AIPlatform,
    outputs: OutputDestination[]
  ) =>
    persistArchiveCompanionArtifacts(
      companion,
      name,
      source,
      outputs,
      undefined,
      expectedSyncSettingsSnapshot,
      writeLedger
    );
}

/** Preserve verified source evidence even when no readable Markdown can be built. */
export async function persistFailedExtractionArchive(
  result: ExtractionResult,
  outputs: OutputDestination[],
  source: StructuredArchiveSource,
  expectedSyncSettingsSnapshot?: string
): Promise<string | undefined> {
  if (result.success || !result.archiveCompanion) return undefined;
  const warnings = await persistArchiveCompanions(
    result.archiveCompanion,
    `${source}-capture.md`,
    source,
    outputs,
    expectedSyncSettingsSnapshot
  );
  return warnings.length === 0
    ? 'Verified raw capture evidence was saved locally'
    : `Verified raw capture evidence was only partially saved: ${warnings.join('. ')}`;
}

async function persistExtractedNote(
  data: ConversationData,
  archiveCompanion: ArchiveCompanionBundle | undefined,
  structuredPresentationContext: ExtractionResult['structuredPresentationContext'],
  settings: ContentScriptSettings,
  outputs: OutputDestination[],
  extractionWarnings: string[] | undefined
): Promise<void> {
  const note = conversationToNote(data, settings.templateOptions);
  const expectedSyncSettingsSnapshot = archiveCompanion
    ? serializeSyncSettingsSnapshot(settings)
    : undefined;
  const archiveOutcome = await persistArchiveCompanionArtifacts(
    archiveCompanion,
    note.fileName,
    data.source,
    outputs,
    undefined,
    expectedSyncSettingsSnapshot
  );
  const htmlWarnings = await derivedHtmlWarnings(
    data.source,
    settings,
    outputs,
    archiveOutcome,
    structuredPresentationContext,
    expectedSyncSettingsSnapshot
  );
  const warnings = [...(extractionWarnings ?? []), ...archiveOutcome.warnings, ...htmlWarnings];
  await persistNote(
    note,
    outputs,
    data.messages.length,
    warnings,
    archiveCompanion?.capturedAt,
    expectedSyncSettingsSnapshot
  );
}

async function derivedHtmlWarnings(
  source: AIPlatform,
  settings: ContentScriptSettings,
  outputs: readonly OutputDestination[],
  archiveOutcome: ArchiveCompanionPersistenceOutcome,
  context: ExtractionResult['structuredPresentationContext'],
  expectedSyncSettingsSnapshot: string | undefined
): Promise<string[]> {
  if (
    settings.enableHtmlExport !== true ||
    !outputs.includes('file') ||
    (source !== 'chatgpt' && source !== 'deepseek')
  )
    return [];
  if (!context) return [DERIVED_HTML_UNAVAILABLE_WARNING];
  if (!expectedSyncSettingsSnapshot || !archiveOutcome.activeOutputs.includes('file')) return [];
  return (await persistDerivedHtmlForFile(context, expectedSyncSettingsSnapshot)).warnings;
}

async function finalizedAttachmentDerivedHtmlWarnings(
  settings: ContentScriptSettings,
  outputs: readonly OutputDestination[],
  fileArchiveConfirmed: boolean,
  presentation: FinalizedFilePresentationEvidence | undefined,
  expectedSyncSettingsSnapshot: string
): Promise<string[]> {
  if (settings.enableHtmlExport !== true || !outputs.includes('file') || !fileArchiveConfirmed)
    return [];
  return (
    await persistDerivedHtmlForFile(
      presentation?.context,
      expectedSyncSettingsSnapshot,
      presentation?.assetBindings
    )
  ).warnings;
}

/** Runtime guard: the worker can return a generic error envelope on rejection. */
function isMultiOutputResponse(
  value: unknown,
  requestedOutputs: readonly OutputDestination[]
): value is MultiOutputResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Record<string, unknown>;
  if (!Array.isArray(response.results) || response.results.length !== requestedOutputs.length)
    return false;
  if (!response.results.every(isOutputResult)) return false;
  const destinations = response.results.map(result => result.destination);
  if (
    new Set(destinations).size !== destinations.length ||
    new Set(requestedOutputs).size !== requestedOutputs.length ||
    destinations.some(destination => !requestedOutputs.includes(destination))
  ) {
    return false;
  }
  const allSuccessful = response.results.every(result => result.success);
  const anySuccessful = response.results.some(result => result.success);
  return response.allSuccessful === allSuccessful && response.anySuccessful === anySuccessful;
}

function isStrictFileOutcome(value: unknown): boolean {
  return (
    value === undefined ||
    value === 'confirmed-success' ||
    value === 'confirmed-failure' ||
    value === 'unconfirmed' ||
    value === 'blocked'
  );
}

function isOutputResult(value: unknown): value is OutputResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  if (!['obsidian', 'file', 'clipboard'].includes(String(result.destination))) return false;
  if (typeof result.success !== 'boolean') return false;
  if (result.error !== undefined && typeof result.error !== 'string') return false;
  if (result.savedAs !== undefined && typeof result.savedAs !== 'string') return false;
  if (result.warning !== undefined && typeof result.warning !== 'string') return false;
  if (!isStrictFileOutcome(result.strictFileOutcome)) return false;
  return (
    result.messagesAppended === undefined ||
    (typeof result.messagesAppended === 'number' &&
      Number.isSafeInteger(result.messagesAppended) &&
      result.messagesAppended >= 0)
  );
}

function backgroundResponseError(value: unknown): string {
  if (value && typeof value === 'object') {
    const error = (value as Record<string, unknown>).error;
    if (typeof error === 'string' && error.trim()) return error;
  }
  return 'Invalid response from extension background';
}

type NoteWriteAttempt =
  | { success: true; response: MultiOutputResponse }
  | { success: false; error: string; outcome: 'failed' | 'unknown' };

async function writeNoteToOutputs(
  note: ObsidianNote,
  outputs: OutputDestination[],
  messageCount: number,
  capturedAt?: string,
  strictFileDownload?: true,
  expectedSyncSettingsSnapshot?: string
): Promise<NoteWriteAttempt> {
  if (utf8ByteLength(note.body) > MAX_CONTENT_SIZE) {
    return {
      success: false,
      error: 'Conversation is too large to export safely (32 MiB limit)',
      outcome: 'failed',
    };
  }

  const saveMessage = buildSaveToOutputsMessage(
    note,
    outputs,
    capturedAt,
    strictFileDownload,
    expectedSyncSettingsSnapshot
  );
  if (jsonUtf8ByteLength(saveMessage) > MAX_EXTENSION_MESSAGE_SIZE) {
    return {
      success: false,
      error: 'Conversation and images are too large to export safely (60 MiB limit)',
      outcome: 'failed',
    };
  }

  console.info('[G2O] Generated note:', { messageCount, outputs });

  const saveResponse: unknown = await sendMessage(saveMessage);
  if (!isMultiOutputResponse(saveResponse, outputs)) {
    console.info('[G2O] Note write response invalid');
    return {
      success: false,
      error: backgroundResponseError(saveResponse),
      outcome: strictFileDownload ? 'unknown' : 'failed',
    };
  }
  console.info('[G2O] Note write result:', {
    allSuccessful: saveResponse.allSuccessful,
    anySuccessful: saveResponse.anySuccessful,
    results: saveResponse.results.map(({ destination, success }) => ({ destination, success })),
  });
  return { success: true, response: saveResponse };
}

function allBranchesDestinationNames(summary: AllBranchesPersistenceSummary): string {
  return summary.destinations.map(destination => destination.destination).join(', ');
}

function allBranchesSuccessMessage(summary: AllBranchesPersistenceSummary): string {
  const destinationNames = allBranchesDestinationNames(summary);
  if (!summary.fileHtml) {
    return `Saved ${summary.branchCount} branches and an index to ${destinationNames}`;
  }
  return `Saved ${summary.branchCount} Markdown branches and an index to ${destinationNames}; saved ${summary.fileHtml.confirmedLeafPairs} File HTML branches and an HTML index to file`;
}

function allBranchesFileHtmlCaveats(summary: AllBranchesPersistenceSummary): string[] {
  const html = summary.fileHtml;
  if (
    !html ||
    (html.status === 'complete' && html.unknownBytes === 0 && html.cleanupDeferred === 0)
  )
    return [];
  const status = html.reason
    ? `File HTML ${html.status} (${html.reason})`
    : `File HTML ${html.status}`;
  const counts = [
    `${status}: ${html.confirmedLeafPairs}/${summary.branchCount} leaf pair(s) confirmed`,
    `index pair ${html.indexPair}`,
    `HTML writes ${html.htmlWrites.confirmed} confirmed, ${html.htmlWrites.unknown} unknown, ${html.htmlWrites.notDispatched} not dispatched`,
    `receipt writes ${html.receiptWrites.confirmed} confirmed, ${html.receiptWrites.unknown} unknown, ${html.receiptWrites.notDispatched} not dispatched`,
  ];
  if (html.unknownBytes > 0) counts.push(`${html.unknownBytes} byte(s) have unknown outcomes`);
  if (html.cleanupDeferred > 0)
    counts.push(`temporary cleanup was deferred for ${html.cleanupDeferred} write(s)`);
  return [counts.join('; ')];
}

function allBranchesFileHtmlRequest(
  settings: ContentScriptSettings,
  outputs: readonly OutputDestination[],
  expectedSyncSettingsSnapshot: string,
  fileArchivePresentation: FinalizedFileArchivePresentationEvidence | undefined
) {
  if (settings.enableHtmlExport !== true || !outputs.includes('file')) return undefined;
  return {
    expectedSyncSettingsSnapshot,
    ...(fileArchivePresentation && { fileArchivePresentation }),
  };
}

interface AllBranchesBootstrapDependencies {
  settings: ContentScriptSettings;
  capturedAt: string | undefined;
  expectedSyncSettingsSnapshot: string;
  progressLabel: string;
  destinationReceipts: readonly unknown[] | undefined;
  signal: AbortSignal | undefined;
  prepared: PreparedAllBranchesPersistence | undefined;
  writeLedger: OperationWriteLedger | undefined;
  fileHtml: AllBranchesFileHtmlRequest | undefined;
}

function createAllBranchesBootstrapDependencies({
  settings,
  capturedAt,
  expectedSyncSettingsSnapshot,
  progressLabel,
  destinationReceipts,
  signal,
  prepared,
  writeLedger,
  fileHtml,
}: AllBranchesBootstrapDependencies): AllBranchesPersistenceDependencies {
  let lastReported = 0;
  return {
    persistArtifacts: archivePersistenceWithSnapshot(expectedSyncSettingsSnapshot, writeLedger),
    ...(writeLedger && { writeLedgerSnapshot: () => writeLedger.snapshot() }),
    destinationReceipts,
    signal,
    prepared,
    ...(fileHtml && { fileHtml }),
    fingerprintNote: (note, destination) => fingerprintAllBranchesNote(note, destination, settings),
    writeNote: (note, destination, messageCount) =>
      writeAllBranchesNote(
        note,
        destination,
        messageCount,
        capturedAt,
        expectedSyncSettingsSnapshot
      ),
    onProgress: (completed, total) => {
      if (completed === total || completed - lastReported >= 10) {
        lastReported = completed;
        showToast(`${progressLabel} ${completed}/${total}`, 'info', 0);
      }
    },
  };
}

function classifyStrictFileWrite(
  note: ObsidianNote,
  result: OutputResult
): AllBranchesWriteOutcome {
  if (
    result.strictFileOutcome === 'confirmed-success' &&
    result.success &&
    result.savedAs === note.fileName
  ) {
    return 'confirmed';
  }
  if (
    result.strictFileOutcome === 'confirmed-failure' ||
    (result.strictFileOutcome === 'confirmed-success' && !result.success)
  ) {
    return 'failed';
  }
  return 'unknown';
}

function classifyAllBranchesWrite(
  note: ObsidianNote,
  destination: PersistentOutputDestination,
  result: OutputResult
): AllBranchesWriteOutcome {
  if (result.error === 'settings-changed') return 'unknown';
  if (destination === 'file') return classifyStrictFileWrite(note, result);
  return result.success && (result.savedAs === undefined || result.savedAs === note.fileName)
    ? 'confirmed'
    : 'failed';
}

async function writeAllBranchesNote(
  note: ObsidianNote,
  destination: PersistentOutputDestination,
  messageCount: number,
  capturedAt: string | undefined,
  expectedSyncSettingsSnapshot: string
): Promise<AllBranchesWriteOutcome> {
  let attempt: NoteWriteAttempt;
  try {
    attempt = await writeNoteToOutputs(
      note,
      [destination],
      messageCount,
      capturedAt,
      destination === 'file' ? true : undefined,
      expectedSyncSettingsSnapshot
    );
  } catch {
    return destination === 'file' ? 'unknown' : 'failed';
  }
  if (!attempt.success) return attempt.outcome;
  return classifyAllBranchesWrite(note, destination, attempt.response.results[0]);
}

// eslint-disable-next-line max-lines-per-function, complexity -- Receipt rendering deliberately enumerates every closed terminal state.
export function displayAllBranchesSummary(
  summary: AllBranchesPersistenceSummary,
  archiveWarnings: readonly string[] = []
): void {
  if (summary.destinations.length === 0) {
    if (summary.status === 'rejected') {
      showWarningToast(
        `All-branches export was rejected by the ${summary.budgetKind ?? 'safety'} budget before any output was written`
      );
    } else if (summary.status === 'cancelled') {
      showWarningToast(
        'All-branches export was stopped. Any output already saved was retained; no additional branch files were scheduled.'
      );
    } else {
      showErrorToast('Exporting all branches requires File or Obsidian output');
    }
    return;
  }

  const destinationCount = summary.destinations.length;
  const expectedBranchWrites = summary.branchCount * destinationCount;
  const savedBranchWrites = summary.destinations.reduce(
    (count, destination) => count + destination.branchFilesSaved,
    0
  );
  const savedIndexes = summary.destinations.filter(destination => destination.indexSaved).length;
  const archiveDestinations = summary.destinations.filter(
    destination => destination.archiveSaved
  ).length;
  const incompleteDestinations = summary.destinations.filter(
    destination => !destination.archiveSaved
  );
  const confirmedIncompleteArtifactBytes = incompleteDestinations.reduce(
    (total, destination) => total + destination.confirmedArtifactBytes,
    0
  );
  const unknownArtifactBytes = summary.destinations.reduce(
    (total, destination) => total + destination.unknownArtifactBytes,
    0
  );
  const caveats = [
    ...new Set(archiveWarnings),
    ...allBranchesFileHtmlCaveats(summary),
    ...(summary.writeLedgerValid === false
      ? ['Artifact accounting could not be validated; no further Markdown was scheduled']
      : []),
    ...(summary.destinations.some(destination => destination.cleanupDeferredArtifactWrites > 0)
      ? ['Temporary artifact cleanup was not fully confirmed']
      : []),
    ...(confirmedIncompleteArtifactBytes > 0
      ? [
          `${confirmedIncompleteArtifactBytes} artifact byte(s) were confirmed before incomplete archive finalization`,
        ]
      : []),
    ...(unknownArtifactBytes > 0
      ? [
          `${unknownArtifactBytes} artifact byte(s) were conservatively charged because their write outcome is unknown`,
        ]
      : []),
    ...(summary.omissionBranchCount > 0
      ? [
          `${summary.omissionBranchCount} branch Markdown file(s) omit records retained in the canonical archive`,
        ]
      : []),
    ...(summary.canonicalOnlyCount > 0
      ? [`${summary.canonicalOnlyCount} canonical-only stub(s) were created`]
      : []),
    ...(summary.clipboardSkipped ? ['Clipboard was skipped for the multi-file bundle'] : []),
  ];

  if (summary.status === 'rejected') {
    const timing =
      summary.phase === 'structural-preflight'
        ? 'before any output was written'
        : 'after archive evidence was retained; no branch notes or index were written';
    showWarningToast(
      `All-branches export was rejected by the ${summary.budgetKind ?? 'safety'} budget ${timing}${caveats.length > 0 ? `. ${caveats.join('. ')}` : ''}`
    );
    return;
  }

  if (summary.status === 'cancelled') {
    showWarningToast(
      `All-branches export was stopped: ${savedBranchWrites} branch write(s) and ${savedIndexes} index(es) were confirmed. Any output already saved was retained; no additional branch files were scheduled${caveats.length > 0 ? `. ${caveats.join('. ')}` : ''}`
    );
    return;
  }

  if (summary.status === 'failed') {
    showWarningToast(
      `All-branches export failed during ${summary.phase}; ${archiveDestinations}/${destinationCount} archive bundle(s) were retained and no completion was claimed${caveats.length > 0 ? `. ${caveats.join('. ')}` : ''}`
    );
    return;
  }

  if (summary.allSuccessful && caveats.length === 0) {
    showToast(allBranchesSuccessMessage(summary), 'success');
    return;
  }

  const writeStatus = summary.allSuccessful
    ? allBranchesSuccessMessage(summary)
    : `All-branches export was partial: ${savedBranchWrites}/${expectedBranchWrites} branch writes, ${savedIndexes}/${destinationCount} indexes, and ${archiveDestinations}/${destinationCount} complete archive bundles succeeded`;
  showWarningToast(`${writeStatus}${caveats.length > 0 ? `. ${caveats.join('. ')}` : ''}`);
}

export async function persistAllBranchesBundle(
  plan: AllBranchesPresentationPlan,
  companion: ArchiveCompanionBundle,
  settings: ContentScriptSettings,
  outputs: OutputDestination[],
  destinationReceipts?: readonly unknown[],
  archiveWarnings: readonly string[] = [],
  signal?: AbortSignal,
  prepared?: PreparedAllBranchesPersistence,
  writeLedger?: OperationWriteLedger,
  fileArchivePresentation?: FinalizedFileArchivePresentationEvidence
): Promise<void> {
  const capturedAt = companion.capturedAt;
  const expectedSyncSettingsSnapshot = serializeSyncSettingsSnapshot(settings);
  const fileHtml = allBranchesFileHtmlRequest(
    settings,
    outputs,
    expectedSyncSettingsSnapshot,
    fileArchivePresentation
  );
  const progressLabel = fileHtml
    ? 'Saving all-branches Markdown before File HTML...'
    : 'Saving all branches...';
  showToast(progressLabel, 'info', 0);
  const summary = await persistAllBranchesPresentation(
    plan,
    companion,
    settings.templateOptions,
    settings.enableToolContent,
    outputs,
    createAllBranchesBootstrapDependencies({
      settings,
      capturedAt,
      expectedSyncSettingsSnapshot,
      progressLabel,
      destinationReceipts,
      signal,
      prepared,
      writeLedger,
      fileHtml,
    })
  );
  displayAllBranchesSummary(summary, archiveWarnings);
}

function freezeSettingsSnapshot(settings: ContentScriptSettings): ContentScriptSettings {
  const snapshot = structuredClone(settings);
  Object.freeze(snapshot.templateOptions);
  Object.freeze(snapshot.outputOptions);
  return Object.freeze(snapshot);
}

/** Mirror the destination's pure Markdown transform for exact dry-run parity. */
function serializeAllBranchesNote(
  note: ObsidianNote,
  destination: PersistentOutputDestination,
  settings: ContentScriptSettings
): string {
  if ((note.images?.length ?? 0) > 0) {
    throw new Error('All-branches image notes require a dedicated exact serializer.');
  }
  const destinationBody =
    destination === 'file' || note.body.includes('g2o-image://')
      ? stripImagePlaceholders(note.body)
      : note.body;
  const body =
    destination === 'obsidian' && settings.flattenLargeCallouts
      ? flattenLargeCallouts(destinationBody, settings.maxCalloutLines)
      : destinationBody;
  const generationSettings: ExtensionSettings = { ...settings, obsidianApiKey: '' };
  return generateNoteContent({ ...note, body }, generationSettings);
}

export function measureAllBranchesNoteBytes(
  note: ObsidianNote,
  destination: PersistentOutputDestination,
  settings: ContentScriptSettings
): number {
  return utf8ByteLength(serializeAllBranchesNote(note, destination, settings));
}

export async function fingerprintAllBranchesNote(
  note: ObsidianNote,
  destination: PersistentOutputDestination,
  settings: ContentScriptSettings
): Promise<AllBranchesNoteFingerprint> {
  const bytes = new TextEncoder().encode(serializeAllBranchesNote(note, destination, settings));
  return { byteLength: bytes.byteLength, sha256: await sha256Hex(bytes) };
}

async function persistNote(
  note: ObsidianNote,
  outputs: OutputDestination[],
  messageCount: number,
  extractionWarnings?: string[],
  capturedAt?: string,
  expectedSyncSettingsSnapshot?: string
): Promise<void> {
  showToast('Saving...', 'info', INFO_TOAST_DURATION);
  const attempt = await writeNoteToOutputs(
    note,
    outputs,
    messageCount,
    capturedAt,
    undefined,
    expectedSyncSettingsSnapshot
  );
  if (!attempt.success) {
    showErrorToast(attempt.error);
    return;
  }
  displaySaveResults(attempt.response, extractionWarnings);
}

function archiveBoundNoteForDestination(
  note: ObsidianNote,
  destination: OutputDestination,
  attachmentExport: ChatGptAssetExportResult
): { note: ObsidianNote; warning?: string } {
  if (destination === 'clipboard') return { note };
  const receipts = attachmentExport.destinationReceipts.filter(
    receipt => receipt.destination === destination
  );
  if (receipts.length !== 1) {
    return {
      note,
      warning: `ChatGPT Markdown saved to ${destination} without finalized archive provenance`,
    };
  }
  try {
    return { note: decorateChatGptArchiveNote(note, receipts[0]) };
  } catch {
    return {
      note,
      warning: `ChatGPT Markdown saved to ${destination} without finalized archive provenance`,
    };
  }
}

/**
 * Finalized ChatGPT manifests can differ by destination. Write one note per
 * output so every local link and manifest hash describes only bytes confirmed
 * at that destination; Clipboard deliberately receives no local archive links.
 */
interface ChatGptNotePresentation {
  data: ConversationData;
  context?: ChatGptStructuredPresentationContext;
  settings: ContentScriptSettings;
  renderedAt: Date;
  expectedSyncSettingsSnapshot: string;
}

function snapshotChatGptNoteEvidence(result: ChatGptAssetExportResult): ChatGptAssetExportResult {
  const destinationReceipts: ChatGptAssetExportResult['destinationReceipts'] = [];
  for (const value of result.destinationReceipts) {
    const receipt = snapshotChatGptDestinationArchiveReceipt(value);
    if (receipt) destinationReceipts.push(receipt);
  }
  let destinationLocalizationEvidence: ChatGptAssetExportResult['destinationLocalizationEvidence'];
  try {
    destinationLocalizationEvidence = structuredClone(result.destinationLocalizationEvidence);
  } catch {
    /* Optional localization failure keeps the provider links and existing appendix. */
  }
  return { ...result, destinationReceipts, destinationLocalizationEvidence };
}

// eslint-disable-next-line max-lines-per-function -- One destination-at-a-time note outcome preserves existing partial-success reporting.
async function persistDestinationHonestChatGptNote(
  note: ObsidianNote,
  outputs: OutputDestination[],
  messageCount: number,
  attachmentExport: ChatGptAssetExportResult,
  extractionWarnings: string[],
  capturedAt: string | undefined,
  presentation: ChatGptNotePresentation
): Promise<void> {
  const destinationEvidence = snapshotChatGptNoteEvidence(attachmentExport);
  showToast('Saving...', 'info', INFO_TOAST_DURATION);
  const results: OutputResult[] = [];
  const provenanceWarnings: string[] = [];
  for (const destination of outputs) {
    const destinationNote = await localizedNoteForDestination(
      note,
      destination,
      destinationEvidence,
      presentation
    );
    const decorated = archiveBoundNoteForDestination(
      destinationNote,
      destination,
      destinationEvidence
    );
    let attempt: NoteWriteAttempt;
    try {
      attempt = await writeNoteToOutputs(
        decorated.note,
        [destination],
        messageCount,
        capturedAt,
        undefined,
        presentation.expectedSyncSettingsSnapshot
      );
    } catch {
      results.push({ destination, success: false, error: 'Note write failed' });
      continue;
    }
    if (!attempt.success) {
      results.push({ destination, success: false, error: attempt.error });
      continue;
    }
    const result = attempt.response.results[0];
    results.push(result);
    if (result.success && decorated.warning) provenanceWarnings.push(decorated.warning);
  }
  const response: MultiOutputResponse = {
    results,
    allSuccessful: results.every(result => result.success),
    anySuccessful: results.some(result => result.success),
    messagesAppended: results.find(result => result.destination === 'obsidian')?.messagesAppended,
  };
  displaySaveResults(response, [...extractionWarnings, ...provenanceWarnings]);
}

async function localizedNoteForDestination(
  original: ObsidianNote,
  destination: OutputDestination,
  attachmentExport: ChatGptAssetExportResult,
  presentation: ChatGptNotePresentation
): Promise<ObsidianNote> {
  if (destination === 'clipboard' || !presentation.context) return original;
  try {
    const receipts = attachmentExport.destinationReceipts.filter(
      value => value.destination === destination
    );
    const evidence = attachmentExport.destinationLocalizationEvidence?.filter(
      value => value.receipt.destination === destination
    );
    if (receipts.length !== 1 || evidence?.length !== 1) return original;
    const data = await localizeChatGptSandboxLinks(
      presentation.data,
      presentation.context,
      evidence[0],
      receipts[0],
      destination
    );
    if (data === presentation.data) return original;
    const localized = conversationToNote(
      data,
      presentation.settings.templateOptions,
      presentation.renderedAt
    );
    return localized.fileName === original.fileName &&
      JSON.stringify(localized.frontmatter) === JSON.stringify(original.frontmatter)
      ? localized
      : original;
  } catch {
    return original;
  }
}

const chatGptAttachmentDependencies = (
  strictReplay: boolean,
  expectedSyncSettingsSnapshot: string,
  writeLedger?: OperationWriteLedger,
  presentationContext?: ExtractionResult['structuredPresentationContext'],
  archivePresentationContext?: AllBranchesPresentationPlan['structuredArchivePresentationContext']
) => ({
  expectedSyncSettingsSnapshot,
  ...(writeLedger && { writeLedger }),
  ...(presentationContext && { presentationContext }),
  ...(archivePresentationContext && { archivePresentationContext }),
  persistArtifacts: persistArchiveCompanionArtifacts,
  observeInterpreterResolvers: observeChatGptInterpreterAssetResolvers,
  ...(strictReplay
    ? {
        observeResolvers: observeChatGptAssetResolversViaOpaqueSource,
        resolveActiveAsset: resolveChatGptActiveImageAsset,
        resolveLibraryAsset: resolveChatGptLibraryJpegAsset,
      }
    : {}),
});

/**
 * Handle sync button click
 */
// eslint-disable-next-line complexity, max-lines-per-function -- The staged user-visible pipeline stays linear so evidence persistence always precedes Markdown validation.
export async function handleSync(branchMode: 'current' | 'selected' = 'current'): Promise<void> {
  console.info('[G2O] Sync initiated');
  setButtonLoading(true);
  let stage = 'loading extension settings';
  let allBranchesStopControl: AllBranchesStopControl | undefined;
  let allBranchesAbortController: AbortController | undefined;

  try {
    const settings = freezeSettingsSnapshot(await getSettings());
    const expectedSyncSettingsSnapshot = serializeSyncSettingsSnapshot(settings);
    const enabledOutputs = getEnabledOutputs(settings);
    const extractor = getExtractor();
    const isChatGptOpaqueProbe =
      settings.enableChatGptOpaqueProbe === true && extractor instanceof ChatGPTExtractor;
    if (!isChatGptOpaqueProbe) {
      stage = 'checking output configuration';
      const configError = await validateOutputConfig(settings, enabledOutputs);
      if (configError) {
        showErrorToast(configError);
        return;
      }
    }
    if (!extractor || !extractor.canExtract()) {
      showErrorToast('Not on a valid conversation page');
      return;
    }
    if (extractor instanceof ChatGPTExtractor) extractor.setBranchExportMode(branchMode);
    showToast('Extracting conversation...', 'info', INFO_TOAST_DURATION);
    extractor.applySettings(settings);
    stage = 'extracting the conversation';
    const result = await extractor.extract();
    if (result.cancelled) return;
    if (result.allBranches) {
      allBranchesAbortController = new AbortController();
      allBranchesStopControl = showAllBranchesStopControl(() => {
        allBranchesAbortController?.abort();
      });
      if (!result.archiveCompanion) {
        showErrorToast('All-branches export requires a complete canonical archive');
        return;
      }
      const fileHtmlRequested =
        settings.enableHtmlExport === true && enabledOutputs.includes('file');
      const preparedAllBranches = prepareAllBranchesPersistence(
        result.allBranches,
        result.archiveCompanion,
        settings.templateOptions,
        settings.enableToolContent,
        enabledOutputs,
        false,
        fileHtmlRequested
      );
      const writeLedger = createOperationWriteLedger(result.archiveCompanion.captureId);
      if (!preparedAllBranches.structural.accepted) {
        stage = 'checking all-branches structural budgets';
        await persistAllBranchesBundle(
          result.allBranches,
          result.archiveCompanion,
          settings,
          enabledOutputs,
          undefined,
          [],
          allBranchesAbortController.signal,
          preparedAllBranches
        );
        return;
      }
      if (allBranchesAbortController.signal.aborted) {
        showWarningToast(
          'All-branches export was stopped. Any output already saved was retained; no additional branch files were scheduled.'
        );
        return;
      }
      if (canExportChatGptAttachments(result, settings, enabledOutputs)) {
        stage = 'saving the original ChatGPT raw archive companion';
        const attachmentExport = await persistChatGptDestinationHonestAttachments(
          result.chatGptAssetExportContext,
          result.archiveCompanion,
          'chatgpt-all-branches.md',
          enabledOutputs,
          chatGptAttachmentDependencies(
            settings.enableChatGptOpaqueReplay === true,
            expectedSyncSettingsSnapshot,
            writeLedger,
            undefined,
            settings.enableHtmlExport === true && enabledOutputs.includes('file')
              ? result.allBranches.structuredArchivePresentationContext
              : undefined
          )
        );
        stage = fileHtmlRequested
          ? 'saving the all-branches Markdown and File HTML bundle'
          : 'saving the all-branches Markdown bundle';
        await persistAllBranchesBundle(
          result.allBranches,
          result.archiveCompanion,
          settings,
          enabledOutputs,
          attachmentExport.destinationReceipts ?? [],
          attachmentExport.warnings,
          allBranchesAbortController.signal,
          preparedAllBranches,
          writeLedger,
          attachmentExport.fileArchivePresentation
        );
        return;
      }
      stage = fileHtmlRequested
        ? 'saving the all-branches archive, Markdown, and File HTML bundle'
        : 'saving the all-branches archive and Markdown bundle';
      await persistAllBranchesBundle(
        result.allBranches,
        result.archiveCompanion,
        settings,
        enabledOutputs,
        undefined,
        [],
        allBranchesAbortController.signal,
        preparedAllBranches,
        writeLedger
      );
      return;
    }
    stage = 'preserving failed extraction evidence';
    const failedArchiveStatus = isStructuredArchiveSource(extractor.platform)
      ? await persistFailedExtractionArchive(
          result,
          enabledOutputs,
          extractor.platform,
          expectedSyncSettingsSnapshot
        )
      : undefined;
    stage = 'validating the extracted conversation';
    const validation = extractor.validate(result);
    if (!validation.isValid) {
      const error = validation.errors.join(', ') || 'Extraction failed';
      showErrorToast(failedArchiveStatus ? `${error}. ${failedArchiveStatus}.` : error);
      return;
    }
    if (validation.warnings.length > 0) {
      validation.warnings.forEach(warning => console.warn('[G2O] Warning:', warning));
    }
    if (!result.data) {
      showErrorToast('No conversation data extracted');
      return;
    }
    if (canExportChatGptAttachments(result, settings, enabledOutputs)) {
      const renderedAt = new Date();
      const note = conversationToNote(result.data, settings.templateOptions, renderedAt);
      stage = 'saving the original ChatGPT raw archive companion';
      const attachmentExport = await persistChatGptDestinationHonestAttachments(
        result.chatGptAssetExportContext,
        result.archiveCompanion,
        note.fileName,
        enabledOutputs,
        chatGptAttachmentDependencies(
          settings.enableChatGptOpaqueReplay === true,
          expectedSyncSettingsSnapshot,
          undefined,
          settings.enableHtmlExport === true && enabledOutputs.includes('file')
            ? result.structuredPresentationContext
            : undefined
        )
      );
      stage = 'saving the ChatGPT canonical HTML reading view';
      const htmlWarnings = await finalizedAttachmentDerivedHtmlWarnings(
        settings,
        enabledOutputs,
        attachmentExport.completeDestinations.includes('file'),
        attachmentExport.filePresentation,
        expectedSyncSettingsSnapshot
      );
      stage = 'saving the ChatGPT note';
      const warnings = [...(result.warnings ?? []), ...attachmentExport.warnings, ...htmlWarnings];
      await persistDestinationHonestChatGptNote(
        note,
        enabledOutputs,
        result.data.messages.length,
        attachmentExport,
        warnings,
        result.archiveCompanion?.capturedAt,
        {
          data: result.data,
          context: result.chatGptStructuredPresentationContext,
          settings,
          renderedAt,
          expectedSyncSettingsSnapshot,
        }
      );
      return;
    }
    if (canExportDeepSeekAttachments(result, settings, enabledOutputs)) {
      const note = conversationToNote(result.data, settings.templateOptions);
      stage = 'saving the original DeepSeek raw archive companion';
      const attachmentExport = await persistDeepSeekDestinationHonestAttachments(
        result.deepSeekAssetExportContext,
        result.archiveCompanion,
        note.fileName,
        enabledOutputs,
        {
          persistArtifacts: persistArchiveCompanionArtifacts,
          expectedSyncSettingsSnapshot,
          ...(settings.enableHtmlExport === true && enabledOutputs.includes('file')
            ? { presentationContext: result.structuredPresentationContext }
            : {}),
        }
      );
      stage = 'saving the DeepSeek canonical HTML reading view';
      const htmlWarnings = await finalizedAttachmentDerivedHtmlWarnings(
        settings,
        enabledOutputs,
        attachmentExport.completeDestinations.includes('file'),
        attachmentExport.filePresentation,
        expectedSyncSettingsSnapshot
      );
      stage = 'saving the DeepSeek note';
      const warnings = [...(result.warnings ?? []), ...attachmentExport.warnings, ...htmlWarnings];
      await persistNote(
        note,
        enabledOutputs,
        result.data.messages.length,
        warnings,
        result.archiveCompanion?.capturedAt,
        expectedSyncSettingsSnapshot
      );
      return;
    }
    stage = 'formatting and saving the structured archive companions and note';
    await persistExtractedNote(
      result.data,
      result.archiveCompanion,
      result.structuredPresentationContext,
      settings,
      enabledOutputs,
      result.warnings
    );
  } catch (error) {
    console.error(`[G2O] Sync error while ${stage}:`, error);
    showErrorToast(`Failed while ${stage}: ${extractErrorMessage(error)}`);
  } finally {
    allBranchesStopControl?.dispose();
    setButtonLoading(false);
  }
}

/**
 * Get extension settings from background script (L-01)
 * Uses type-safe messaging utility
 */
function getSettings(): Promise<ContentScriptSettings> {
  return sendMessage({ action: 'getSettings' });
}

/**
 * Test connection to Obsidian (L-01)
 * Uses type-safe messaging utility
 */
function testConnection(): Promise<{ success: boolean; error?: string }> {
  return sendMessage({ action: 'testConnection' });
}
