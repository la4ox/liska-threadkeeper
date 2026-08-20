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
import { extractErrorMessage } from '../lib/error-utils';
import type {
  ArchiveCompanionBundle,
  ConversationData,
  ExtractionResult,
  IConversationExtractor,
} from '../lib/types';
import { conversationToNote } from './markdown';
import {
  injectSyncButton,
  setButtonLoading,
  showErrorToast,
  showWarningToast,
  showToast,
} from './ui';
import { sendMessage } from '../lib/messaging';
import {
  AUTO_SAVE_CHECK_INTERVAL,
  EVENT_THROTTLE_DELAY,
  INFO_TOAST_DURATION,
  MAX_CONTENT_SIZE,
  MAX_EXTENSION_MESSAGE_SIZE,
  MUTATION_DEBOUNCE_DELAY,
} from '../lib/constants';
import { jsonUtf8ByteLength, utf8ByteLength } from '../lib/byte-size';
import type {
  AIPlatform,
  ContentScriptSettings,
  ObsidianNote,
  OutputDestination,
  OutputResult,
  MultiOutputResponse,
} from '../lib/types';
import { platformForHost } from '../lib/platform-registry';
import { throttle } from '../lib/throttle';

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

/** Conversation container selectors to detect when content is ready */
const CONVERSATION_CONTAINER_SELECTOR =
  '.conversation-container, [class*="conversation"], section[data-turn-id], article[data-turn-id], div[class*="threadContentWidth"], .ds-message';

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
 * Wait for conversation container to appear (L-03)
 * Uses MutationObserver with debouncing instead of fixed timeout
 *
 * Performance optimizations:
 * - Observes platform-specific root instead of document.body (P-1)
 * - Debouncing prevents excessive DOM queries during rapid mutation bursts
 */
function waitForConversationContainer(): Promise<void> {
  return new Promise(resolve => {
    // Check if already exists
    const existing = document.querySelector(CONVERSATION_CONTAINER_SELECTOR);
    if (existing) {
      resolve();
      return;
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    // Debounced check function
    const checkForContainer = (obs: MutationObserver) => {
      const container = document.querySelector(CONVERSATION_CONTAINER_SELECTOR);
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

  // Wait for conversation container (L-03)
  await waitForConversationContainer();

  // Apply throttle to sync handler (NEW-06)
  const throttledHandleSync = throttle(handleSync, EVENT_THROTTLE_DELAY);
  injectSyncButton(throttledHandleSync);
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

/** Background error strings are untrusted at this UI boundary. */
function safeArchiveObsidianDiagnostic(result: OutputResult): string | undefined {
  return result.destination === 'obsidian' &&
    typeof result.error === 'string' &&
    ARCHIVE_OBSIDIAN_DIAGNOSTIC_CODES.has(result.error)
    ? result.error
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

function archiveWriteOutcome(
  response: unknown,
  label: string,
  requestedOutputs: readonly ('file' | 'obsidian')[]
): { activeOutputs: ('file' | 'obsidian')[]; warnings: string[] } {
  if (!isMultiOutputResponse(response, requestedOutputs)) {
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
    warnings: response.results
      .filter(result => !result.success)
      .map(result => {
        const diagnostic = safeArchiveObsidianDiagnostic(result);
        return `${label} was not saved to ${result.destination}${
          diagnostic ? ` (${diagnostic})` : ''
        }`;
      }),
  };
}

/**
 * Save the three immutable structured artifacts one at a time. Archive writes
 * never join the Markdown message, and a failed companion stays non-fatal so
 * the readable note is still saved with an explicit warning.
 */
export async function persistArchiveCompanions(
  companion: ArchiveCompanionBundle | undefined,
  noteFileName: string,
  source: AIPlatform,
  outputs: OutputDestination[]
): Promise<string[]> {
  if (!companion) return [];
  let activeOutputs = outputs.filter(
    (output): output is 'file' | 'obsidian' => output === 'file' || output === 'obsidian'
  );
  if (activeOutputs.length === 0) {
    return ['ChatGPT raw/canonical archive was not saved because only Clipboard is enabled'];
  }

  const warnings: string[] = [];
  for (const artifact of companion.artifacts) {
    if (activeOutputs.length === 0) break;
    const message = {
      action: 'persistArchiveCompanion' as const,
      noteFileName,
      source,
      captureId: companion.captureId,
      conversationKey: companion.conversationKey,
      artifact,
      outputs: activeOutputs,
    };
    const label = archiveArtifactLabel(artifact.kind);
    if (jsonUtf8ByteLength(message) > MAX_EXTENSION_MESSAGE_SIZE) {
      warnings.push(
        ...archiveDestinationWarnings(label, activeOutputs, 'it exceeds the 60 MiB message limit')
      );
      activeOutputs = [];
      continue;
    }

    try {
      const response: unknown = await sendMessage(message);
      const outcome = archiveWriteOutcome(response, label, activeOutputs);
      warnings.push(...outcome.warnings);
      // A destination commits its snapshot in raw -> manifest -> canonical order.
      activeOutputs = outcome.activeOutputs;
    } catch {
      warnings.push(
        ...archiveDestinationWarnings(label, activeOutputs, 'the extension write failed')
      );
      activeOutputs = [];
    }
  }
  return warnings;
}

/** Preserve verified source evidence even when no readable Markdown can be built. */
export async function persistFailedExtractionArchive(
  result: ExtractionResult,
  outputs: OutputDestination[]
): Promise<string | undefined> {
  if (result.success || !result.archiveCompanion) return undefined;
  const warnings = await persistArchiveCompanions(
    result.archiveCompanion,
    'chatgpt-capture.md',
    'chatgpt',
    outputs
  );
  return warnings.length === 0
    ? 'Verified raw capture evidence was saved locally'
    : `Verified raw capture evidence was only partially saved: ${warnings.join('. ')}`;
}

async function persistExtractedNote(
  data: ConversationData,
  archiveCompanion: ArchiveCompanionBundle | undefined,
  settings: ContentScriptSettings,
  outputs: OutputDestination[],
  extractionWarnings: string[] | undefined
): Promise<void> {
  const note = conversationToNote(data, settings.templateOptions);
  const archiveWarnings = await persistArchiveCompanions(
    archiveCompanion,
    note.fileName,
    data.source,
    outputs
  );
  await persistNote(note, outputs, data.messages.length, [
    ...(extractionWarnings ?? []),
    ...archiveWarnings,
  ]);
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

function isOutputResult(value: unknown): value is OutputResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  if (!['obsidian', 'file', 'clipboard'].includes(String(result.destination))) return false;
  if (typeof result.success !== 'boolean') return false;
  if (result.error !== undefined && typeof result.error !== 'string') return false;
  if (result.savedAs !== undefined && typeof result.savedAs !== 'string') return false;
  if (result.warning !== undefined && typeof result.warning !== 'string') return false;
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

async function persistNote(
  note: ObsidianNote,
  outputs: OutputDestination[],
  messageCount: number,
  extractionWarnings?: string[]
): Promise<void> {
  if (utf8ByteLength(note.body) > MAX_CONTENT_SIZE) {
    showErrorToast('Conversation is too large to export safely (32 MiB limit)');
    return;
  }

  const saveMessage = { action: 'saveToOutputs' as const, data: note, outputs };
  if (jsonUtf8ByteLength(saveMessage) > MAX_EXTENSION_MESSAGE_SIZE) {
    showErrorToast('Conversation and images are too large to export safely (60 MiB limit)');
    return;
  }

  console.info('[G2O] Generated note:', {
    messageCount,
    outputs,
  });

  showToast('Saving...', 'info', INFO_TOAST_DURATION);
  const saveResponse: unknown = await sendMessage(saveMessage);
  if (!isMultiOutputResponse(saveResponse, outputs)) {
    showErrorToast(backgroundResponseError(saveResponse));
    return;
  }
  displaySaveResults(saveResponse, extractionWarnings);
}

/**
 * Handle sync button click
 */
// eslint-disable-next-line max-lines-per-function -- The staged user-visible pipeline stays linear so evidence persistence always precedes Markdown validation.
export async function handleSync(): Promise<void> {
  console.info('[G2O] Sync initiated');
  setButtonLoading(true);
  let stage = 'loading extension settings';

  try {
    const settings = await getSettings();
    const enabledOutputs = getEnabledOutputs(settings);
    stage = 'checking output configuration';
    const configError = await validateOutputConfig(settings, enabledOutputs);
    if (configError) {
      showErrorToast(configError);
      return;
    }
    const extractor = getExtractor();
    if (!extractor || !extractor.canExtract()) {
      showErrorToast('Not on a valid conversation page');
      return;
    }
    showToast('Extracting conversation...', 'info', INFO_TOAST_DURATION);
    extractor.applySettings(settings);
    stage = 'extracting the conversation';
    const result = await extractor.extract();
    stage = 'preserving failed extraction evidence';
    const failedArchiveStatus = await persistFailedExtractionArchive(result, enabledOutputs);
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
    stage = 'formatting and saving the ChatGPT archive companions and note';
    await persistExtractedNote(
      result.data,
      result.archiveCompanion,
      settings,
      enabledOutputs,
      result.warnings
    );
  } catch (error) {
    console.error(`[G2O] Sync error while ${stage}:`, error);
    showErrorToast(`Failed while ${stage}: ${extractErrorMessage(error)}`);
  } finally {
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
