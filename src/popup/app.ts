/**
 * Popup Settings Application
 *
 * Manages the extension settings UI. All logic lives here so tests can
 * import it without import-time DOM lookups; the DOMContentLoaded wiring
 * is confined to the index.ts entry shim, and DOM elements are queried
 * inside initPopup() rather than at module scope.
 */

import { getSettingsOrThrow } from '../lib/storage';
import type {
  ExtensionSettings,
  PopupSettingsUpdate,
  TemplateOptions,
  OutputOptions,
} from '../lib/types';
import {
  validateCalloutType,
  validateVaultPath,
  validateApiKey,
  validateObsidianUrl,
} from '../lib/validation';
import {
  DEFAULT_OBSIDIAN_URL,
  DEFAULT_MAX_CALLOUT_LINES,
  VALID_MESSAGE_FORMATS,
} from '../lib/constants';
import { getMessage } from '../lib/i18n';
import { sendMessage } from '../lib/messaging';
import type {
  ClaudeListProbePage,
  ClaudeListProbeResponse,
  ClaudeListProbeResult,
  ClaudeListRouteOrganizationEvidence,
} from '../lib/claude-list-probe-contract';

/**
 * Initialize i18n for all elements with data-i18n attributes
 */
function initializeI18n(): void {
  // Translate elements with data-i18n attribute. The selector guarantees the
  // attribute is present, so getAttribute() returns a non-null string.
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n')!;
    const message = getMessage(key);
    if (message && message !== key) {
      element.textContent = message;
    }
  });

  // Translate placeholders on inputs carrying data-i18n-placeholder.
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    if (!(element instanceof HTMLInputElement)) return;
    const key = element.getAttribute('data-i18n-placeholder')!;
    const message = getMessage(key);
    if (message && message !== key) {
      element.placeholder = message;
    }
  });

  // Update document title
  const titleElement = document.querySelector('title');
  if (titleElement) {
    const key = titleElement.getAttribute('data-i18n');
    if (key) {
      const message = getMessage(key);
      if (message && message !== key) {
        document.title = message;
      }
    }
  }
}

/**
 * Type-safe DOM element getter
 * Reduces repetitive getElementById + type assertion boilerplate
 */
function getElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[G2O Popup] Missing element: #${id}`);
  return el as T;
}

// DOM Elements — queried inside initPopup() (not at module scope) so that
// importing this module has no side effects and tests can build the DOM first
function queryElements() {
  return {
    // Output destinations
    outputObsidian: getElement<HTMLInputElement>('outputObsidian'),
    outputFile: getElement<HTMLInputElement>('outputFile'),
    outputClipboard: getElement<HTMLInputElement>('outputClipboard'),
    openReconciliationBtn: getElement<HTMLButtonElement>('openReconciliationBtn'),
    probeDotsSchemaBtn: getElement<HTMLButtonElement>('probeDotsSchemaBtn'),
    probeClaudeListsBtn: getElement<HTMLButtonElement>('probeClaudeListsBtn'),
    claudeListEvidence: getElement<HTMLElement>('claudeListEvidence'),
    obsidianSettings: getElement<HTMLElement>('obsidianSettings'),
    // Obsidian settings
    apiKey: getElement<HTMLInputElement>('apiKey'),
    obsidianUrl: getElement<HTMLInputElement>('obsidianUrl'),
    vaultPath: getElement<HTMLInputElement>('vaultPath'),
    messageFormat: getElement<HTMLSelectElement>('messageFormat'),
    filenameScheme: getElement<HTMLSelectElement>('filenameScheme'),
    calloutSettingsGroup: getElement<HTMLElement>('calloutSettingsGroup'),
    userCallout: getElement<HTMLInputElement>('userCallout'),
    assistantCallout: getElement<HTMLInputElement>('assistantCallout'),
    includeQuestionHeaders: getElement<HTMLInputElement>('includeQuestionHeaders'),
    includeId: getElement<HTMLInputElement>('includeId'),
    includeTitle: getElement<HTMLInputElement>('includeTitle'),
    includeTags: getElement<HTMLInputElement>('includeTags'),
    includeSource: getElement<HTMLInputElement>('includeSource'),
    includeDates: getElement<HTMLInputElement>('includeDates'),
    includeMessageCount: getElement<HTMLInputElement>('includeMessageCount'),
    enableAutoScroll: getElement<HTMLInputElement>('enableAutoScroll'),
    enableAppendMode: getElement<HTMLInputElement>('enableAppendMode'),
    enableToolContent: getElement<HTMLInputElement>('enableToolContent'),
    enableImageExport: getElement<HTMLInputElement>('enableImageExport'),
    enableHtmlExport: getElement<HTMLInputElement>('enableHtmlExport'),
    enableTextExport: getElement<HTMLInputElement>('enableTextExport'),
    enableInertCodeBlocks: getElement<HTMLInputElement>('enableInertCodeBlocks'),
    htmlExportRow: getElement<HTMLElement>('htmlExportRow'),
    textExportRow: getElement<HTMLElement>('textExportRow'),
    enableChatGptOpaqueProbe: getElement<HTMLInputElement>('enableChatGptOpaqueProbe'),
    enableChatGptOpaqueReplay: getElement<HTMLInputElement>('enableChatGptOpaqueReplay'),
    imageVaultPath: getElement<HTMLInputElement>('imageVaultPath'),
    flattenLargeCallouts: getElement<HTMLInputElement>('flattenLargeCallouts'),
    maxCalloutLines: getElement<HTMLInputElement>('maxCalloutLines'),
    timezone: getElement<HTMLSelectElement>('timezone'),
    timezoneGroup: getElement<HTMLElement>('timezoneGroup'),
    testBtn: getElement<HTMLButtonElement>('testBtn'),
    saveBtn: getElement<HTMLButtonElement>('saveBtn'),
    status: getElement<HTMLDivElement>('status'),
  };
}

type PopupElements = ReturnType<typeof queryElements>;

// Assigned by initPopup() before any UI handler can run
let elements: PopupElements;
let outputSaveChain: Promise<void> = Promise.resolve();
let settingsActionInFlight = false;
let dotsSchemaProbeInFlight = false;
let claudeListProbeInFlight = false;
// Only an edited field may replace the credential, including when migration
// finishes in the background after this popup was populated with a blank key.
let savedApiKeyValue = '';
// A rejected response can follow a successful local key write and a failed
// sync-settings write. Until an explicit retry succeeds, the UI baseline is
// not authoritative and every ordinary save must resend the displayed key.
let apiKeySaveUncertain = false;

function isOpaqueReplaySettingActive(settings: ExtensionSettings): boolean {
  return settings.enableChatGptOpaqueReplay === true && settings.enableChatGptOpaqueProbe !== true;
}

/**
 * Initialize popup — queries the DOM and wires the UI.
 * Called by the index.ts entry shim on DOMContentLoaded.
 */
export async function initPopup(): Promise<void> {
  elements = queryElements();
  elements.saveBtn.disabled = true;
  elements.testBtn.disabled = true;
  elements.probeClaudeListsBtn.disabled = true;
  try {
    initializeI18n();
    // Never populate an editable form with defaults after an unreadable store.
    const settings = await getSettingsOrThrow();
    populateForm(settings);
    setupEventListeners();
    setupToggleSwitchAccessibility();
    elements.saveBtn.disabled = false;
    elements.testBtn.disabled = false;
    elements.probeClaudeListsBtn.disabled = false;
  } catch {
    showStatus(getMessage('toast_error_connectionFailed'), 'error');
    console.error('[G2O Popup] Failed to initialize settings');
  }
}

/**
 * Populate form with current settings
 */
function populateForm(settings: ExtensionSettings): void {
  // Output destinations
  const { outputOptions } = settings;
  elements.outputObsidian.checked = outputOptions?.obsidian ?? true;
  elements.outputFile.checked = outputOptions?.file ?? false;
  elements.outputClipboard.checked = outputOptions?.clipboard ?? false;

  // Extraction options
  elements.enableAutoScroll.checked = settings.enableAutoScroll ?? false;
  elements.enableAppendMode.checked = settings.enableAppendMode ?? false;
  elements.enableToolContent.checked = settings.enableToolContent ?? false;
  elements.enableImageExport.checked = settings.enableImageExport ?? true;
  elements.enableHtmlExport.checked = settings.enableHtmlExport ?? false;
  elements.enableTextExport.checked = settings.enableTextExport === true;
  elements.enableInertCodeBlocks.checked = settings.enableInertCodeBlocks ?? true;
  updateDerivedExportAvailability();
  const enableChatGptOpaqueProbe = settings.enableChatGptOpaqueProbe === true;
  elements.enableChatGptOpaqueProbe.checked = enableChatGptOpaqueProbe;
  elements.enableChatGptOpaqueReplay.checked = isOpaqueReplaySettingActive(settings);
  elements.imageVaultPath.value = settings.imageVaultPath || '';
  elements.flattenLargeCallouts.checked = settings.flattenLargeCallouts ?? true;
  elements.maxCalloutLines.value = String(settings.maxCalloutLines ?? DEFAULT_MAX_CALLOUT_LINES);

  // Update Obsidian settings section visibility
  updateObsidianSettingsVisibility();

  // Obsidian API settings
  elements.apiKey.value = settings.obsidianApiKey || '';
  savedApiKeyValue = elements.apiKey.value.trim();
  apiKeySaveUncertain = false;
  elements.obsidianUrl.value = settings.obsidianUrl || DEFAULT_OBSIDIAN_URL;
  elements.vaultPath.value = settings.vaultPath || '';

  const { templateOptions } = settings;
  elements.messageFormat.value = templateOptions.messageFormat || 'callout';
  elements.filenameScheme.value = templateOptions.filenameScheme || 'title-id';
  elements.userCallout.value = templateOptions.userCalloutType || 'QUESTION';
  elements.assistantCallout.value = templateOptions.assistantCalloutType || 'NOTE';
  updateCalloutSettingsVisibility();
  elements.includeQuestionHeaders.checked = templateOptions.includeQuestionHeaders ?? false;

  elements.includeId.checked = templateOptions.includeId ?? true;
  elements.includeTitle.checked = templateOptions.includeTitle ?? true;
  elements.includeTags.checked = templateOptions.includeTags ?? true;
  elements.includeSource.checked = templateOptions.includeSource ?? true;
  elements.includeDates.checked = templateOptions.includeDates ?? true;
  elements.includeMessageCount.checked = templateOptions.includeMessageCount ?? true;

  // Populate timezone dropdown and set value
  populateTimezoneOptions();
  elements.timezone.value = templateOptions.timezone ?? 'UTC';
  updateTimezoneVisibility();

  // Sync aria-checked for toggle switches after setting checked state
  syncAllAriaChecked();
}

/**
 * Update Obsidian settings section visibility based on output selection
 */
function updateObsidianSettingsVisibility(): void {
  const obsidianSection = elements.obsidianSettings;
  if (elements.outputObsidian.checked) {
    obsidianSection.classList.remove('disabled');
    obsidianSection.removeAttribute('data-disabled-reason');
  } else {
    obsidianSection.classList.add('disabled');
    obsidianSection.setAttribute('data-disabled-reason', getMessage('tooltip_obsidianDisabled'));
  }
}

/** Keep canonical-derived companion switches available only for File output. */
function updateDerivedExportAvailability(): void {
  const disabled = !elements.outputFile.checked;
  for (const [toggle, row] of [
    [elements.enableHtmlExport, elements.htmlExportRow],
    [elements.enableTextExport, elements.textExportRow],
  ] as const) {
    toggle.disabled = disabled;
    toggle.setAttribute('aria-disabled', String(disabled));
    row.style.opacity = disabled ? '0.5' : '';
    row.style.cursor = disabled ? 'not-allowed' : '';
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners(): void {
  elements.saveBtn.addEventListener('click', handleSave);
  elements.testBtn.addEventListener('click', handleTest);
  elements.openReconciliationBtn.addEventListener('click', () => {
    const url = chrome.runtime.getURL('src/reconcile/index.html');
    void chrome.tabs.create({ url }).catch(() => {
      showStatus(getMessage('reconcile_openFailed'), 'error');
    });
  });
  elements.probeDotsSchemaBtn.addEventListener('click', event => {
    handleTrustedDotsSchemaProbeClick(event, () => void runDotsSchemaProbe());
  });
  elements.probeClaudeListsBtn.addEventListener('click', event => {
    handleTrustedClaudeListProbeClick(event, () => void runClaudeListProbe());
  });

  // Output destination checkbox listeners
  elements.outputObsidian.addEventListener('change', () => {
    updateObsidianSettingsVisibility();
    queueOutputOptionsSave();
  });
  elements.outputFile.addEventListener('change', () => {
    updateDerivedExportAvailability();
    queueOutputOptionsSave();
  });
  elements.outputClipboard.addEventListener('change', queueOutputOptionsSave);

  elements.enableChatGptOpaqueProbe.addEventListener('change', () => {
    if (elements.enableChatGptOpaqueProbe.checked) {
      elements.enableChatGptOpaqueReplay.checked = false;
      elements.enableChatGptOpaqueReplay.setAttribute('aria-checked', 'false');
    }
  });
  elements.enableChatGptOpaqueReplay.addEventListener('change', () => {
    if (elements.enableChatGptOpaqueReplay.checked) {
      elements.enableChatGptOpaqueProbe.checked = false;
      elements.enableChatGptOpaqueProbe.setAttribute('aria-checked', 'false');
    }
  });

  // Show/hide timezone when includeDates changes
  elements.includeDates.addEventListener('change', updateTimezoneVisibility);

  // Show/hide callout settings based on message format
  elements.messageFormat.addEventListener('change', updateCalloutSettingsVisibility);

  // Setup API key visibility toggle
  setupApiKeyToggle();
}

/** A page script cannot turn a synthetic popup click into a provider probe. */
export function handleTrustedDotsSchemaProbeClick(event: Event, onClick: () => void): void {
  if (!event.isTrusted) return;
  onClick();
}

/** A synthetic popup event cannot spend the bounded Claude request budget. */
export function handleTrustedClaudeListProbeClick(event: Event, onClick: () => void): void {
  if (!event.isTrusted) return;
  onClick();
}

function sendClaudeListProbeMessage(): Promise<ClaudeListProbeResponse> {
  const send = sendMessage as unknown as (message: {
    action: 'probeClaudeLists';
  }) => Promise<ClaudeListProbeResponse>;
  return send({ action: 'probeClaudeLists' });
}

function claudeRouteEvidenceMessage(evidence: ClaudeListRouteOrganizationEvidence): string {
  const keys: Record<ClaudeListRouteOrganizationEvidence, string> = {
    'resource-timing': 'status_claudeListProbeRouteResourceTiming',
    'verification-link': 'status_claudeListProbeRouteVerificationLink',
    'named-storage': 'status_claudeListProbeRouteNamedStorage',
    'multiple-consistent': 'status_claudeListProbeRouteMultipleConsistent',
    unresolved: 'status_claudeListProbeRouteUnresolved',
  };
  return getMessage(keys[evidence]);
}

function claudeHeaderPairSummary(observed: boolean): string {
  return getMessage(
    observed
      ? 'status_claudeListProbeHeaderPairObserved'
      : 'status_claudeListProbeHeaderPairNotObserved'
  );
}

function clearClaudeListEvidence(): void {
  elements.claudeListEvidence.textContent = '';
  elements.claudeListEvidence.hidden = true;
}

function claudeListPageEvidence(page: ClaudeListProbePage): string {
  const partition = getMessage(
    page.partition === 'active' ? 'claudeListEvidenceActive' : 'claudeListEvidenceArchived'
  );
  const continuation = getMessage(
    page.terminal ? 'claudeListEvidenceTerminal' : 'claudeListEvidenceHasMore'
  );
  return getMessage('claudeListEvidencePage', [
    partition,
    String(page.offset),
    String(page.counts.record),
    String(page.counts.validUuid),
    String(page.counts.marker),
    String(page.counts.archivedFlag),
    String(page.counts.archivedMismatch),
    continuation,
  ]);
}

function showClaudeListEvidence(result: ClaudeListProbeResult): void {
  const pages = result.pages.length
    ? result.pages.map(claudeListPageEvidence)
    : [getMessage('claudeListEvidenceNoPages')];
  const hypothesis = getMessage(
    result.pagination.hypothesis === 'not-exercised'
      ? 'claudeListEvidencePaginationNotExercised'
      : 'claudeListEvidencePaginationOffsetPlus30'
  );
  const unfinished = getMessage(
    result.pagination.unfinished ? 'claudeListEvidenceYes' : 'claudeListEvidenceNo'
  );
  const names = result.scope.relevantHeaderNames.length
    ? result.scope.relevantHeaderNames.join(', ')
    : getMessage('claudeListEvidenceNoneObserved');
  const lines = [
    getMessage('claudeListEvidenceHeading'),
    ...pages,
    getMessage('claudeListEvidenceDuplicates', [
      String(result.counts.duplicate),
      String(result.counts.overlap),
    ]),
    getMessage('claudeListEvidencePagination', [hypothesis, unfinished]),
    getMessage(
      result.scope.observed
        ? 'claudeListEvidenceHeaderPairObserved'
        : 'claudeListEvidenceHeaderPairNotObserved'
    ),
    getMessage('claudeListEvidenceHeaders', names),
  ];
  elements.claudeListEvidence.textContent = lines.join('\n');
  elements.claudeListEvidence.hidden = false;
}

/** Run one selected-tab, schema-only Dots diagnostic. */
export async function runDotsSchemaProbe(): Promise<void> {
  if (dotsSchemaProbeInFlight || claudeListProbeInFlight || settingsActionInFlight) return;
  dotsSchemaProbeInFlight = true;
  elements.probeDotsSchemaBtn.disabled = true;
  elements.probeClaudeListsBtn.disabled = true;
  elements.saveBtn.disabled = true;
  elements.testBtn.disabled = true;
  clearStatus();
  showStatus(getMessage('status_dotsSchemaProbeRunning'), 'info');
  try {
    const response = await sendMessage({ action: 'probeDotsSchema' });
    if (response.success) {
      showStatus(getMessage('status_dotsSchemaProbeSaved'), 'success');
    } else {
      showStatus(getMessage('toast_error_dotsSchemaProbeFailed', response.code), 'error');
    }
  } catch {
    showStatus(getMessage('toast_error_dotsSchemaProbeFailed', 'unavailable'), 'error');
  } finally {
    dotsSchemaProbeInFlight = false;
    elements.probeDotsSchemaBtn.disabled = false;
    elements.probeClaudeListsBtn.disabled = false;
    elements.saveBtn.disabled = false;
    elements.testBtn.disabled = false;
  }
}

/** Run one content-free, selected-tab Claude active/archived list diagnostic. */
export async function runClaudeListProbe(): Promise<void> {
  if (claudeListProbeInFlight || dotsSchemaProbeInFlight || settingsActionInFlight) return;
  claudeListProbeInFlight = true;
  elements.probeClaudeListsBtn.disabled = true;
  elements.probeDotsSchemaBtn.disabled = true;
  elements.saveBtn.disabled = true;
  elements.testBtn.disabled = true;
  clearStatus();
  clearClaudeListEvidence();
  showStatus(getMessage('status_claudeListProbeRunning'), 'info');
  try {
    const response = await sendClaudeListProbeMessage();
    if (response.success) {
      const result = response.data;
      const headerPair = claudeHeaderPairSummary(result.scope.observed);
      const verification = getMessage(
        result.verificationPresent
          ? 'status_claudeListProbeVerificationYes'
          : 'status_claudeListProbeVerificationNo'
      );
      const routeEvidence = claudeRouteEvidenceMessage(result.routeOrganizationEvidence);
      showClaudeListEvidence(result);
      showStatus(
        getMessage('status_claudeListProbeResult', [
          result.status,
          result.code,
          String(result.counts.dispatch),
          String(result.counts.page),
          String(result.counts.record),
          headerPair,
          verification,
          routeEvidence,
        ]),
        'warning'
      );
    } else {
      showStatus(getMessage('toast_error_claudeListProbeFailed', response.code), 'error');
    }
  } catch {
    clearClaudeListEvidence();
    showStatus(getMessage('toast_error_claudeListProbeFailed', 'unavailable'), 'error');
  } finally {
    claudeListProbeInFlight = false;
    elements.probeClaudeListsBtn.disabled = false;
    elements.probeDotsSchemaBtn.disabled = false;
    elements.saveBtn.disabled = false;
    elements.testBtn.disabled = false;
  }
}

/** Persist destination switches immediately and serialize rapid changes. */
function queueOutputOptionsSave(): void {
  const outputOptions = collectOutputOptions();
  outputSaveChain = outputSaveChain
    .then(async () => {
      const response = await sendMessage({ action: 'updateOutputOptions', outputOptions });
      if (!response.success) throw new Error(response.error ?? 'Output settings save failed');
    })
    .then(() => showStatus(getMessage('status_settingsSaved'), 'success'))
    .catch(error => {
      showStatus(getMessage('toast_error_saveFailed', 'Unknown error'), 'error');
      console.error('[G2O Popup] Output settings save error:', error);
    });
}

/**
 * Setup API key visibility toggle button
 */
function setupApiKeyToggle(): void {
  const apiKeyInput = elements.apiKey;

  // Find the .api-key-wrapper container (defined in HTML)
  const wrapper = apiKeyInput.closest('.api-key-wrapper');
  if (!wrapper) return;

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'api-key-toggle';
  toggleBtn.textContent = '👁️';
  toggleBtn.title = getMessage('settings_showApiKey');

  toggleBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleBtn.textContent = '🙈';
      toggleBtn.title = getMessage('settings_hideApiKey');
    } else {
      apiKeyInput.type = 'password';
      toggleBtn.textContent = '👁️';
      toggleBtn.title = getMessage('settings_showApiKey');
    }
  });

  wrapper.appendChild(toggleBtn);
}

/**
 * Sync aria-checked attribute for all toggle switches with role="switch"
 */
function syncAllAriaChecked(): void {
  document.querySelectorAll<HTMLInputElement>('input[role="switch"]').forEach(input => {
    input.setAttribute('aria-checked', String(input.checked));
  });
}

/**
 * Setup accessibility for toggle switches (W3C APG Switch Pattern)
 * Syncs aria-checked on change events
 */
function setupToggleSwitchAccessibility(): void {
  document.querySelectorAll<HTMLInputElement>('input[role="switch"]').forEach(input => {
    input.addEventListener('change', () => {
      input.setAttribute('aria-checked', String(input.checked));
    });
  });
}

/**
 * Populate timezone select with IANA timezone names
 * Groups by region for easier navigation
 */
function populateTimezoneOptions(): void {
  const select = elements.timezone;
  // Only populate once
  if (select.options.length > 1) return;

  // Intl.supportedValuesOf is available in Chrome 99+
  // Falls back to UTC-only if unavailable (Chrome 96-98)
  let timezones: string[];
  try {
    timezones = Intl.supportedValuesOf('timeZone');
  } catch {
    // Chrome < 99: leave dropdown with just UTC
    return;
  }
  // Clear default UTC option, rebuild with full list
  select.innerHTML = '';

  const utcOption = document.createElement('option');
  utcOption.value = 'UTC';
  utcOption.textContent = 'UTC';
  select.appendChild(utcOption);

  for (const tz of timezones) {
    if (tz === 'UTC') continue;
    const option = document.createElement('option');
    option.value = tz;
    option.textContent = tz.replace(/_/g, ' ');
    select.appendChild(option);
  }
}

/** Toggle a settings group's visibility via inline display style. */
function setGroupVisible(group: HTMLElement, visible: boolean): void {
  group.style.display = visible ? '' : 'none';
}

/**
 * Show/hide timezone dropdown based on includeDates checkbox
 */
function updateTimezoneVisibility(): void {
  setGroupVisible(elements.timezoneGroup, elements.includeDates.checked);
}

function updateCalloutSettingsVisibility(): void {
  setGroupVisible(elements.calloutSettingsGroup, elements.messageFormat.value === 'callout');
}

/**
 * Collect output options from form
 */
function collectOutputOptions(): OutputOptions {
  return {
    obsidian: elements.outputObsidian.checked,
    file: elements.outputFile.checked,
    clipboard: elements.outputClipboard.checked,
  };
}

/**
 * Validate that at least one output is selected
 */
function validateOutputOptions(outputOptions: OutputOptions): boolean {
  return outputOptions.obsidian || outputOptions.file || outputOptions.clipboard;
}

/**
 * Collect settings from form
 * Normalizes all values at collection time to avoid downstream mutation
 */
function collectSettings(): ExtensionSettings {
  const formatValue = elements.messageFormat.value;
  const messageFormat = VALID_MESSAGE_FORMATS.includes(
    formatValue as (typeof VALID_MESSAGE_FORMATS)[number]
  )
    ? (formatValue as (typeof VALID_MESSAGE_FORMATS)[number])
    : 'callout';

  const templateOptions: TemplateOptions = {
    messageFormat,
    userCalloutType: validateCalloutType(elements.userCallout.value || 'QUESTION', 'QUESTION'),
    assistantCalloutType: validateCalloutType(elements.assistantCallout.value || 'NOTE', 'NOTE'),
    includeQuestionHeaders: elements.includeQuestionHeaders.checked,
    includeId: elements.includeId.checked,
    includeTitle: elements.includeTitle.checked,
    includeTags: elements.includeTags.checked,
    includeSource: elements.includeSource.checked,
    includeDates: elements.includeDates.checked,
    includeMessageCount: elements.includeMessageCount.checked,
    timezone: elements.timezone.value || undefined,
    filenameScheme: elements.filenameScheme.value === 'title-date' ? 'title-date' : 'title-id',
  };

  const outputOptions = collectOutputOptions();

  return {
    obsidianApiKey: elements.apiKey.value.trim(),
    obsidianUrl: elements.obsidianUrl.value.trim() || DEFAULT_OBSIDIAN_URL,
    vaultPath: elements.vaultPath.value.trim(),
    templateOptions,
    outputOptions,
    enableAutoScroll: elements.enableAutoScroll.checked,
    enableAppendMode: elements.enableAppendMode.checked,
    enableToolContent: elements.enableToolContent.checked,
    enableImageExport: elements.enableImageExport.checked,
    enableHtmlExport: elements.enableHtmlExport.checked,
    enableTextExport: elements.enableTextExport.checked,
    enableInertCodeBlocks: elements.enableInertCodeBlocks.checked,
    enableChatGptOpaqueProbe: elements.enableChatGptOpaqueProbe.checked,
    enableChatGptOpaqueReplay: elements.enableChatGptOpaqueReplay.checked,
    imageVaultPath: elements.imageVaultPath.value.trim() || 'AI/{platform}/images',
    flattenLargeCallouts: elements.flattenLargeCallouts.checked,
    maxCalloutLines: parseCalloutLines(elements.maxCalloutLines.value),
  };
}

/** Parse the max-callout-lines input, clamping to a sane positive range. */
function parseCalloutLines(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_CALLOUT_LINES;
  return Math.min(n, 100000);
}

/**
 * Result of Obsidian settings validation (pure return, no mutation)
 */
interface ObsidianValidationResult {
  error: string | null;
  normalizedApiKey: string;
  normalizedUrl: string;
  normalizedVaultPath: string;
}

/**
 * Run a throwing validator and return the result or error message.
 */
function tryValidate(
  fn: () => string,
  fallbackMessage: string
): { ok: true; value: string } | { ok: false; error: string } {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : fallbackMessage };
  }
}

/**
 * Validate Obsidian-specific settings (API key, URL, vault path)
 * Returns normalized values without mutating the input.
 */
function validateObsidianSettings(settings: ExtensionSettings): ObsidianValidationResult {
  const defaults = {
    normalizedApiKey: settings.obsidianApiKey,
    normalizedUrl: settings.obsidianUrl,
    normalizedVaultPath: settings.vaultPath,
  };

  const apiKey = tryValidate(() => validateApiKey(settings.obsidianApiKey), 'Invalid API key');
  if (!apiKey.ok) return { error: apiKey.error, ...defaults };

  const url = tryValidate(() => validateObsidianUrl(settings.obsidianUrl), 'Invalid URL');
  if (!url.ok) return { error: url.error, ...defaults, normalizedApiKey: apiKey.value };

  const vaultPath = tryValidate(() => validateVaultPath(settings.vaultPath), 'Invalid vault path');
  if (!vaultPath.ok) {
    return {
      error: vaultPath.error,
      ...defaults,
      normalizedApiKey: apiKey.value,
      normalizedUrl: url.value,
    };
  }

  return {
    error: null,
    normalizedApiKey: apiKey.value,
    normalizedUrl: url.value,
    normalizedVaultPath: vaultPath.value,
  };
}

/**
 * Validate and normalize Obsidian settings (API key, URL, vault path).
 * Returns normalized settings or an error message.
 */
function normalizeObsidianSettings(
  settings: ExtensionSettings
): { ok: true; settings: ExtensionSettings } | { ok: false; error: string } {
  const validation = validateObsidianSettings(settings);
  if (validation.error) {
    return { ok: false, error: validation.error };
  }
  return {
    ok: true,
    settings: {
      ...settings,
      obsidianApiKey: validation.normalizedApiKey,
      obsidianUrl: validation.normalizedUrl,
      vaultPath: validation.normalizedVaultPath,
    },
  };
}

/** Save and connection-test flows share credential state and cannot overlap. */
function beginSettingsAction(): boolean {
  if (settingsActionInFlight || dotsSchemaProbeInFlight || claudeListProbeInFlight) return false;
  settingsActionInFlight = true;
  elements.saveBtn.disabled = true;
  elements.testBtn.disabled = true;
  elements.probeDotsSchemaBtn.disabled = true;
  elements.probeClaudeListsBtn.disabled = true;
  return true;
}

function endSettingsAction(): void {
  settingsActionInFlight = false;
  elements.saveBtn.disabled = false;
  elements.testBtn.disabled = false;
  elements.probeDotsSchemaBtn.disabled = false;
  elements.probeClaudeListsBtn.disabled = false;
}

/**
 * Handle save button click
 * Input validation using security utilities (NEW-03)
 */
async function handleSave(): Promise<void> {
  if (!beginSettingsAction()) return;
  clearStatus();

  try {
    await outputSaveChain;
    const apiKeyValue = elements.apiKey.value.trim();
    const settings = collectSettings();

    // Validate output options - at least one must be selected
    if (!validateOutputOptions(settings.outputOptions)) {
      showStatus(getMessage('error_noOutputSelected'), 'error');
      return;
    }

    // Validate Obsidian-specific settings only if Obsidian output is enabled
    let settingsToSave = settings;
    if (settings.outputOptions.obsidian) {
      const result = normalizeObsidianSettings(settings);
      if (!result.ok) {
        showStatus(result.error, 'error');
        return;
      }
      settingsToSave = result.settings;
    }

    const { obsidianApiKey, ...syncSettings } = settingsToSave;
    const settingsUpdate: PopupSettingsUpdate =
      apiKeyValue === savedApiKeyValue && !apiKeySaveUncertain
        ? syncSettings
        : { ...syncSettings, obsidianApiKey };
    if (settingsUpdate.obsidianApiKey !== undefined) apiKeySaveUncertain = true;
    const response = await sendMessage({ action: 'saveSettings', settings: settingsUpdate });
    if (!response.success) {
      showStatus(response.error ?? getMessage('toast_error_saveFailed', 'Unknown error'), 'error');
      return;
    }
    if (settingsUpdate.obsidianApiKey !== undefined) {
      savedApiKeyValue = apiKeyValue;
      apiKeySaveUncertain = false;
    }
    showStatus(getMessage('status_settingsSaved'), 'success');
  } catch {
    showStatus(getMessage('toast_error_saveFailed', 'Unknown error'), 'error');
  } finally {
    endSettingsAction();
  }
}

/**
 * Handle test connection button click
 */
async function handleTest(): Promise<void> {
  if (!beginSettingsAction()) return;
  clearStatus();
  showStatus(getMessage('status_testing'), 'info');

  try {
    await outputSaveChain;
    // First save current settings
    const apiKeyValue = elements.apiKey.value.trim();
    const settings = collectSettings();

    if (!settings.obsidianApiKey) {
      showStatus(getMessage('toast_error_noApiKey'), 'warning');
      return;
    }

    // Validate Obsidian settings before saving (same as handleSave)
    const result = normalizeObsidianSettings(settings);
    if (!result.ok) {
      showStatus(result.error, 'error');
      return;
    }

    // Save validated and normalized settings through the background worker so
    // this update shares the worker's serialized storage mutation queue.
    apiKeySaveUncertain = true;
    const saveResponse = await sendMessage({ action: 'saveSettings', settings: result.settings });
    if (!saveResponse.success) {
      showStatus(
        saveResponse.error ?? getMessage('toast_error_saveFailed', 'Unknown error'),
        'error'
      );
      return;
    }
    savedApiKeyValue = apiKeyValue;
    apiKeySaveUncertain = false;

    // Send test connection message to background script
    const response = await sendMessage({ action: 'testConnection' });

    if (response.success) {
      showStatus(getMessage('status_connectionSuccess'), 'success');
    } else {
      showStatus(response.error ?? getMessage('toast_error_connectionFailed'), 'error');
    }
  } catch {
    showStatus(getMessage('toast_error_connectionFailed'), 'error');
  } finally {
    endSettingsAction();
  }
}

/**
 * Show status message
 */
function showStatus(message: string, type: 'success' | 'error' | 'warning' | 'info'): void {
  elements.status.textContent = message;
  elements.status.className = `status ${type}`;
}

/**
 * Clear status message
 */
function clearStatus(): void {
  elements.status.textContent = '';
  elements.status.className = 'status';
}
