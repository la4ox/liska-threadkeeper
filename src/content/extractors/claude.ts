/**
 * Claude Extractor
 *
 * Extracts conversations from Claude AI (claude.ai)
 * Supports both normal chat and Deep Research (Extended Thinking) modes
 *
 */

import { BaseExtractor, type ScrollConfig } from './base';
import { sanitizeHtml } from '../../lib/sanitize';
import { htmlToMarkdownRaw } from '../markdown-rules';
import {
  CLAUDE_TOOL_LIMITS,
  ClaudeToolConversionBudget,
  appendClaudeToolPart,
  claudeToolHtmlToMarkdown,
} from './claude-tool-markdown';
import { generateHash } from '../../lib/hash';
import { mergeLiskaLossDiagnostics } from '../../lib/loss-diagnostics';
import { requestClaudeScrollPrime } from '../capture/claude-scroll-prime';
import type { HarvestEntry } from '../../lib/scroll-manager';
import type {
  ConversationMessage,
  DeepResearchSource,
  ExtractionResult,
  SyncSettings,
} from '../../lib/types';
import {
  SELECTORS,
  DEEP_RESEARCH_SELECTORS,
  CURRENT_ARTIFACT_SELECTORS,
  JOINED_SELECTORS,
} from './selectors/claude';

// October assistant roots wrap answer text, accessibility/action chrome and
// step rows. Strip these only on a detached clone, before every content path.
const STEP_ROW_SELECTOR = '[data-cds="TurnStatus"]';
const ANSWER_CHROME_SELECTOR = `h2.sr-only, [data-testid="message-actions"], ${STEP_ROW_SELECTOR}`;
const ARTIFACT_CONTENT_OMITTED_WARNING =
  'Visible Claude Artifact content was not included because the isolated frame layout is unsupported.';
const STABLE_EMPTY_ASSISTANT_ROOT =
  'div[data-testid="assistant-message"][data-cds="AssistantMessage"][data-is-streaming="false"]';
const STABLE_EMPTY_BUSY_SELECTOR =
  '[aria-busy="true"], [data-is-streaming="true"], [data-loading="true"], [data-state="loading"], [role="progressbar"]';
const OBSERVED_ATTACHMENT_SELECTOR =
  '[data-testid="file-thumbnail"], [data-testid="delivered-image-tile"], [class*="MessageAttachments"]';
const STABLE_EMPTY_FORBIDDEN_SELECTOR = `${STABLE_EMPTY_BUSY_SELECTOR}, ${STEP_ROW_SELECTOR}, ${OBSERVED_ATTACHMENT_SELECTOR}`;
const STABLE_EMPTY_HEADING_ATTRIBUTES = new Set(['data-find-omitted', 'class', 'aria-hidden']);
type HistoryRenderability = 'nonempty' | 'stable-empty' | 'unsupported';

const CANONICAL_UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CANONICAL_UUID_GLOBAL = new RegExp(CANONICAL_UUID_SOURCE, 'gi');
const ASSISTANT_TURN_KEY = new RegExp(`^(${CANONICAL_UUID_SOURCE})-hub-reply$`, 'i');
const STABLE_HISTORY_KEY = new RegExp(`^(user|assistant):(${CANONICAL_UUID_SOURCE})$`, 'i');

interface ClaudeHistoryProof {
  tailKey?: string;
  catalogMax?: number;
  readonly keyToRelativeOrder: Map<string, number>;
  readonly relativeOrderToKey: Map<number, string>;
  readonly rolesByKey: Map<string, ConversationMessage['role']>;
  readonly renderabilityByKey: Map<string, HistoryRenderability>;
}

/** Only Claude's canonical, bounded virtual-row integer identity is evidence. */
function parseRowIndex(value: string | null | undefined): number | undefined {
  if (!value || value.length > 16 || !/^(?:0|[1-9]\d*)$/.test(value)) return undefined;
  const index = Number(value);
  return Number.isSafeInteger(index) && index < Number.MAX_SAFE_INTEGER ? index : undefined;
}

const CLAUDE_TOOL_CACHE_MAX_BYTES = CLAUDE_TOOL_LIMITS.rawHtmlBytes;
const PENDING_HISTORY_ABSENCE_GRACE_MS = 5000;
const toolCacheEncoder = new TextEncoder();

interface ToolContentCacheEntry {
  readonly input: string;
  readonly output: string | null;
  readonly byteLength: number;
}

/** Exact-input retention is bounded independently of guarded conversion work. */
interface ToolContentCache {
  readonly entries: Map<string, ToolContentCacheEntry>;
  totalBytes: number;
}

/**
 * Claude reuses the same content-free button shape for both directions of a
 * virtualized gap. Only a marker before the first mounted row proves that
 * older history is still available. A marker between/after rows represents a
 * later-history gap and must not keep an already complete archive partial.
 */
function hasPendingOlderHistory(container: HTMLElement): boolean {
  const markers = Array.from(container.querySelectorAll(SELECTORS.pendingHistory[0]));
  if (markers.length === 0) return false;
  const firstRow = container.querySelector(SELECTORS.conversationRow[0]);
  if (!firstRow) return true;
  return markers.some(marker =>
    Boolean(marker.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING)
  );
}

function createPendingHistoryGate(
  getCatalogMax: () => number | undefined,
  isConsistent: () => boolean
) {
  let awaitingProgress = false;
  let markerPresent = false;
  let baselineMax: number | undefined;
  let markerAbsentSince: number | undefined;
  const observe = (container: HTMLElement): boolean => {
    const present = hasPendingOlderHistory(container);
    if (present && !markerPresent) {
      awaitingProgress = true;
      baselineMax = getCatalogMax();
      markerAbsentSince = undefined;
    } else if (!present && markerPresent && awaitingProgress) {
      markerAbsentSince = Date.now();
    }
    markerPresent = present;
    return present;
  };
  return {
    observe,
    isAwaiting: () => awaitingProgress || markerPresent,
    canComplete(container: HTMLElement): boolean {
      // The final proof is already irreversibly partial; do not spend the idle
      // deadline waiting for provider pagination that cannot repair it.
      if (!isConsistent()) return true;
      if (observe(container)) return false;
      if (!awaitingProgress) return true;
      const currentMax = getCatalogMax();
      const grew =
        baselineMax !== undefined && currentMax !== undefined && currentMax > baselineMax;
      const absenceSettled =
        markerAbsentSince !== undefined &&
        Date.now() - markerAbsentSince >= PENDING_HISTORY_ABSENCE_GRACE_MS;
      if (!grew && !absenceSettled) return false;
      awaitingProgress = false;
      markerAbsentSince = undefined;
      return true;
    },
  };
}

/** Exact provider evidence only; mutable virtual-row indices are never identities. */
function stableHistoryKey(item: {
  element: Element;
  type: 'user' | 'assistant';
}): string | undefined {
  if (item.type === 'user') {
    if (!item.element.matches('[data-testid="user-message"]')) return undefined;
    const id = item.element.getAttribute('id');
    if (!id) return undefined;
    const matches = id.match(CANONICAL_UUID_GLOBAL);
    if (matches?.length !== 1 || !id.toLowerCase().endsWith(matches[0].toLowerCase())) {
      return undefined;
    }
    return `user:${matches[0].toLowerCase()}`;
  }

  if (!item.element.matches('[data-testid="assistant-message"][data-cds="AssistantMessage"]')) {
    return undefined;
  }
  const match = item.element.getAttribute('data-turn-key')?.match(ASSISTANT_TURN_KEY);
  return match ? `assistant:${match[1].toLowerCase()}` : undefined;
}

function stableHistoryRole(key: string): ConversationMessage['role'] | undefined {
  const match = key.match(STABLE_HISTORY_KEY);
  return match?.[1].toLowerCase() as ConversationMessage['role'] | undefined;
}

/**
 * Claude conversation and Deep Research extractor
 *
 * Implements IConversationExtractor interface
 * @see src/lib/types.ts
 */
export class ClaudeExtractor extends BaseExtractor {
  readonly platform = 'claude';
  protected override readonly titleUsesFirstUserFallback = true;
  /** Include tool-use / intermediate content (web search, code interpreter, etc.) */
  enableToolContent = false;

  /**
   * Apply user settings: enable/disable tool content extraction and auto-scroll
   */
  applySettings(settings: SyncSettings): void {
    this.enableToolContent = settings.enableToolContent ?? false;
    this.enableAutoScroll = settings.enableAutoScroll ?? false;
  }

  /** Preserve the existing transcript/report path and record only observed loss. */
  async extract(): Promise<ExtractionResult> {
    // A user can start export while the Artifact is visible and Claude can then
    // rerender or dismiss that pane during asynchronous history scrolling. Keep
    // the initial positive observation; a later observation may add evidence,
    // but provider churn must not erase an already observed omission.
    const artifactFrameObserved = this.hasUnsupportedArtifactFrame();
    const result = await super.extract();
    if (
      !result.success ||
      !result.data ||
      (!artifactFrameObserved && !this.hasUnsupportedArtifactFrame())
    ) {
      return result;
    }

    return {
      ...result,
      data: {
        ...result.data,
        liskaLossDiagnostics: mergeLiskaLossDiagnostics(result.data.liskaLossDiagnostics, [
          'claude-artifact-content-omitted',
        ]),
      },
      warnings: result.warnings?.includes(ARTIFACT_CONTENT_OMITTED_WARNING)
        ? result.warnings
        : [...(result.warnings ?? []), ARTIFACT_CONTENT_OMITTED_WARNING],
    };
  }

  /** Inspect top-document frame presence only; never access the isolated document. */
  private hasUnsupportedArtifactFrame(): boolean {
    return Array.from(document.querySelectorAll(CURRENT_ARTIFACT_SELECTORS.frame[0])).some(
      frame => {
        if (this.isInDismissedPanel(frame) || frame.closest('[hidden]')) return false;
        const frameStyle = window.getComputedStyle(frame);
        if (
          frameStyle.display === 'none' ||
          frameStyle.visibility === 'hidden' ||
          frameStyle.visibility === 'collapse'
        ) {
          return false;
        }

        // Claude keeps the panel visibly selected (with a loading surface) while
        // the inner document iframe can be transiently transparent. Evaluate
        // rendering suppression from the panel boundary outward, not from that
        // implementation-detail frame, so loading still records the omission.
        const panel = frame.closest('[role="region"]') ?? frame;
        for (let ancestor: Element | null = panel; ancestor; ancestor = ancestor.parentElement) {
          if (ancestor.matches('details:not([open])')) {
            const summary = ancestor.querySelector(':scope > summary');
            if (!summary?.contains(frame)) return false;
          }
          const style = window.getComputedStyle(ancestor);
          if (
            style.display === 'none' ||
            style.contentVisibility === 'hidden' ||
            Number.parseFloat(style.opacity) === 0
          ) {
            return false;
          }
        }
        return true;
      }
    );
  }

  // ========== Platform Detection ==========

  /**
   * Check if a Deep Research / Artifact report is the actively-viewed panel.
   *
   * Detects the #markdown-artifact element, but presence alone is not enough:
   * Claude keeps the artifact mounted after the panel is closed, moving the
   * off-screen panel into an `inert` + `aria-hidden="true"` subtree (verified
   * live 2026-07-16, w/h collapse to 0 and x is pushed past the viewport). A
   * presence-only check therefore hijacked every save after the user had ever
   * opened a report — returning the stale report and dropping the conversation
   * (issue #352 follow-up). Treat an inert / aria-hidden subtree as "closed".
   *
   * @see FR-003-3 in design document
   */
  isDeepResearchVisible(): boolean {
    const artifact = this.queryWithFallback<HTMLElement>(DEEP_RESEARCH_SELECTORS.artifact);
    if (!artifact) return false;
    return !this.isInDismissedPanel(artifact);
  }

  /**
   * Whether an element sits inside a dismissed (closed) panel subtree.
   *
   * Claude does not unmount a closed Deep Research / Artifact panel — it moves
   * the off-screen subtree into `inert` + `aria-hidden="true"` (verified live
   * 2026-07-16). Such content is neither the active view nor a real conversation
   * turn. Keep this guard strict for DR detection and artifact messages; normal
   * conversation rows separately allow collapsed inert-only content below a row.
   */
  private isInDismissedPanel(element: Element): boolean {
    return element.closest('[inert], [aria-hidden="true"]') !== null;
  }

  /**
   * Conversation turns can keep their collapsed long content under an inert
   * wrapper INSIDE a virtual row (upstream #452). Only that inert-only shape
   * is exempt: a hidden/inert row or enclosing panel is still dismissed.
   * Walk the full ancestor chain so a nearer collapsed wrapper cannot mask a
   * closed outer panel. Artifact visibility retains the stricter panel guard.
   */
  private isInDismissedConversationPanel(element: Element): boolean {
    if (
      DEEP_RESEARCH_SELECTORS.artifact.some(selector => element.closest(selector)) &&
      this.isInDismissedPanel(element)
    ) {
      return true;
    }

    const row = element.closest(SELECTORS.conversationRow[0]);
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.matches('[aria-hidden="true"], [hidden]')) return true;
      if (ancestor.hasAttribute('inert') && (row === null || ancestor.contains(row))) return true;
    }
    return false;
  }

  // ========== ID & Title Extraction ==========

  /**
   * Extract conversation ID from URL
   *
   * URL format: https://claude.ai/chat/{uuid}
   * @returns UUID string or null if not found
   */
  getConversationId(): string | null {
    const match = window.location.pathname.match(/\/chat\/([a-f0-9-]{36})/i);
    return match ? match[1] : null;
  }

  /**
   * Get conversation title
   *
   * Priority:
   * 1. Deep Research h1 title (if Deep Research visible)
   * 2. document.title (via getPageTitle())
   * 3. First user message content (truncated)
   * 4. Default title
   */
  getTitle(): string {
    if (this.isDeepResearchVisible()) {
      return this.getDeepResearchTitle();
    }

    return (
      this.getPageTitle() ??
      this.getFirstMessageTitle(SELECTORS.userMessage, 'Untitled Claude Conversation')
    );
  }

  /** Expose platform selectors to BaseExtractor's DR title/content helpers. */
  protected getDeepResearchSelectors() {
    return DEEP_RESEARCH_SELECTORS;
  }

  // ========== Message Extraction ==========

  /**
   * Extract all messages from conversation
   *
   * Extracts User/Assistant messages in DOM order
   * @see FR-002 in design document
   */
  extractMessages(): ConversationMessage[] {
    const toolBudget = new ClaudeToolConversionBudget();
    const sortedElements = this.collectSortedElements();

    // Pre-extract tool content keyed by message ID (matches buildMessagesFromElements format)
    const toolContentById = new Map<string, string>();
    if (this.enableToolContent) {
      sortedElements.forEach((item, index) => {
        if (item.type === 'assistant') {
          const tc = this.extractToolContentFromElement(item.element, toolBudget);
          if (tc) toolContentById.set(`assistant-${index}`, tc);
        }
      });
    }

    const messages = this.buildMessagesFromElements(
      sortedElements,
      el => this.extractUserContent(el),
      el => this.extractAssistantContent(el)
    );

    // Attach tool content to corresponding assistant messages without mutating existing messages.
    if (toolContentById.size === 0) return messages;

    return messages.map(msg => {
      const tc = toolContentById.get(msg.id);
      return tc ? { ...msg, toolContent: tc } : msg;
    });
  }

  /**
   * Collect user/assistant message elements in DOM order.
   *
   * User messages nested inside an assistant response (e.g. quoted content) are
   * skipped, as is anything inside a dismissed artifact panel (a closed report
   * lingers with `.font-claude-response`; see {@link isInDismissedConversationPanel}).
   * Shared by extractMessages() (single pass) and harvestWindow() (per-scroll-
   * window pass for virtualized conversations).
   */
  private collectSortedElements(
    root: Element | Document = document
  ): Array<{ element: Element; type: 'user' | 'assistant' }> {
    const allElements: Array<{ element: Element; type: 'user' | 'assistant' }> = [];
    const userMessages = this.collectUserElements(root);
    const assistantResponses = this.collectAssistantElements(userMessages, root);

    userMessages.forEach(el => {
      if (!assistantResponses.some(assistant => assistant.contains(el))) {
        allElements.push({ element: el, type: 'user' });
      }
    });

    assistantResponses.forEach(el => {
      allElements.push({ element: el, type: 'assistant' });
    });

    return this.sortByDomPosition(allElements);
  }

  /** Keep disjoint primary/legacy users, collapsing only overlapping wrappers. */
  private collectUserElements(root: Element | Document): Element[] {
    const candidates = SELECTORS.userMessage
      .flatMap(selector => Array.from(root.querySelectorAll(selector)))
      .filter(element => !this.isInDismissedConversationPanel(element));
    return this.distinctElements(candidates);
  }

  /** Prefer strong identities without discarding separate lower-priority turns. */
  private collectAssistantElements(userCandidates: Element[], root: Element | Document): Element[] {
    const strong = this.distinctElements(
      SELECTORS.assistantResponse
        .slice(0, -1)
        .flatMap(selector => Array.from(root.querySelectorAll(selector)))
        .filter(element => !this.isInDismissedConversationPanel(element))
    );
    const users = userCandidates.filter(
      user => !strong.some(assistant => assistant.contains(user))
    );
    // Streaming alone is not a role identity: user content and its layout can
    // carry it too. A genuine user root wins either direction of overlap.
    const weak = SELECTORS.assistantResponse
      .slice(-1)
      .flatMap(selector => Array.from(root.querySelectorAll(selector)))
      .filter(
        element =>
          !this.isInDismissedConversationPanel(element) &&
          !users.some(user => user.contains(element) || element.contains(user))
      );
    return this.distinctElements([...strong, ...weak]);
  }

  /** Candidates are already in identity-priority order; text is never a key. */
  private distinctElements(candidates: Element[], budget?: ClaudeToolConversionBudget): Element[] {
    const selected: Element[] = [];
    const selectedSet = new Set<Element>();
    const ancestorsWithSelectedDescendant = new Set<Element>();
    for (const candidate of candidates) {
      if (selectedSet.has(candidate) || ancestorsWithSelectedDescendant.has(candidate)) continue;

      let hasSelectedAncestor = false;
      for (let ancestor = candidate.parentElement; ancestor; ancestor = ancestor.parentElement) {
        budget?.addDomNodes(1);
        if (selectedSet.has(ancestor)) {
          hasSelectedAncestor = true;
          break;
        }
      }
      if (hasSelectedAncestor) continue;

      selected.push(candidate);
      selectedSet.add(candidate);
      for (let ancestor = candidate.parentElement; ancestor; ancestor = ancestor.parentElement) {
        budget?.addDomNodes(1);
        ancestorsWithSelectedDescendant.add(ancestor);
      }
    }
    return selected;
  }

  /**
   * Auto-scroll config: Claude virtualizes the conversation (ADR-017).
   */
  // eslint-disable-next-line max-lines-per-function -- Per-export proof, cache, pagination and identity state must share one closure.
  protected getScrollConfig(): ScrollConfig {
    const initialIdentity = this.captureConversationIdentity();
    const toolBudget = new ClaudeToolConversionBudget();
    const toolCache: ToolContentCache = { entries: new Map(), totalBytes: 0 };
    const mountedRows = new Map<Element, number>();
    const proof: ClaudeHistoryProof = {
      keyToRelativeOrder: new Map(),
      relativeOrderToKey: new Map(),
      rolesByKey: new Map(),
      renderabilityByKey: new Map(),
    };
    const stableEmptyKeys = new Set<string>();
    let consistentIdentities = true;
    let numericOrderTrusted = true;
    const pendingHistory = createPendingHistoryGate(
      () => proof.catalogMax,
      () => consistentIdentities
    );
    return {
      container: SELECTORS.scrollContainer,
      // Short rows can mount/evict entirely between the shared 60%/400px steps.
      stepFactor: 0.2,
      minStep: 64,
      pollIntervalMs: 100,
      topSettleMs: 5000,
      resolveContainer: () =>
        this.isConversationIdentityCurrent(initialIdentity)
          ? this.queryWithFallback<HTMLElement>(SELECTORS.scrollContainer)
          : null,
      maxContainerRebinds: 4,
      primeWithRelativeTopNudge: requestClaudeScrollPrime,
      maxRelativeTopNudgesPerRoot: 2,
      canCompleteAtTop: pendingHistory.canComplete,
      harvest: container => {
        // Observe rows before filtering so empty/unclassified rows remain evidence.
        const rowObservation = this.observeHistoryRows(container, mountedRows);
        const catalogMax =
          rowObservation.indices.length > 0
            ? rowObservation.indices[rowObservation.indices.length - 1]
            : undefined;
        stableEmptyKeys.clear();
        const entries = this.harvestWindow(
          toolBudget,
          toolCache,
          container,
          stableEmptyKeys,
          catalogMax
        );
        numericOrderTrusted =
          rowObservation.consistent &&
          this.isHarvestOrderTrusted(entries, catalogMax, proof) &&
          numericOrderTrusted;
        consistentIdentities =
          this.observeHarvestedIdentities(
            entries,
            rowObservation.indices,
            catalogMax,
            stableEmptyKeys,
            proof
          ) &&
          rowObservation.consistent &&
          consistentIdentities;
        pendingHistory.observe(container);
        return numericOrderTrusted
          ? entries
          : entries.map(entry => ({
              key: entry.key,
              value: entry.value,
              invalidateOrder: true as const,
            }));
      },
      isHistoryComplete: messages =>
        consistentIdentities &&
        !pendingHistory.isAwaiting() &&
        proof.tailKey !== undefined &&
        proof.catalogMax !== undefined &&
        messages.length === proof.catalogMax + 1 &&
        proof.keyToRelativeOrder.size === proof.catalogMax + 1 &&
        proof.relativeOrderToKey.size === proof.catalogMax + 1 &&
        messages.every((message, index) => {
          const order = index - (proof.catalogMax as number);
          const key = proof.relativeOrderToKey.get(order);
          return (
            key !== undefined && message.id === key && proof.keyToRelativeOrder.get(key) === order
          );
        }),
    };
  }

  /** Numeric order survives content loss, but not a changed catalog coordinate system. */
  private isHarvestOrderTrusted(
    entries: readonly HarvestEntry<ConversationMessage>[],
    catalogMax: number | undefined,
    proof: ClaudeHistoryProof
  ): boolean {
    if (catalogMax === undefined) return entries.length === 0;
    const previousMax = proof.catalogMax;
    const tailKey = entries.find(entry => entry.order === 0)?.key;
    if (previousMax !== undefined && catalogMax < previousMax) return false;
    if (
      previousMax !== undefined &&
      catalogMax > previousMax &&
      (proof.tailKey === undefined || tailKey === undefined || tailKey !== proof.tailKey)
    ) {
      return false;
    }
    if (proof.tailKey !== undefined && tailKey !== undefined && tailKey !== proof.tailKey) {
      return false;
    }

    const currentKeys = new Set<string>();
    const currentOrders = new Set<number>();
    return entries.every(entry => {
      const order = entry.order;
      if (order === undefined || currentKeys.has(entry.key) || currentOrders.has(order))
        return false;
      currentKeys.add(entry.key);
      currentOrders.add(order);
      return (
        (!proof.keyToRelativeOrder.has(entry.key) ||
          proof.keyToRelativeOrder.get(entry.key) === order) &&
        (!proof.relativeOrderToKey.has(order) || proof.relativeOrderToKey.get(order) === entry.key)
      );
    });
  }

  /** Every indexed row in the chosen thread is evidence, even without a message. */
  private observeHistoryRows(
    container: HTMLElement,
    mountedRows: Map<Element, number>
  ): { readonly indices: number[]; readonly consistent: boolean } {
    let consistent = true;
    let previousIndex = -1;
    const indices: number[] = [];
    for (const row of mountedRows.keys()) {
      // Detachment is ordinary virtualization. A row still in this container
      // must not become invisible to both checks merely by losing its index.
      if (container.contains(row) && !row.hasAttribute('data-index')) consistent = false;
    }
    mountedRows.clear();
    for (const row of container.querySelectorAll(SELECTORS.conversationRow[0])) {
      const index = parseRowIndex(row.getAttribute('data-index'));
      if (index === undefined || index <= previousIndex) consistent = false;
      if (index !== undefined) {
        mountedRows.set(row, index);
        indices.push(index);
        previousIndex = index;
      }
    }
    return { indices, consistent };
  }

  /** Retain identity/order conflicts before accumulation can deduplicate them. */
  private observeHarvestedIdentities(
    entries: HarvestEntry<ConversationMessage>[],
    currentIndices: readonly number[],
    catalogMax: number | undefined,
    stableEmptyKeys: ReadonlySet<string>,
    proof: ClaudeHistoryProof
  ): boolean {
    let consistent = catalogMax !== undefined && entries.length === currentIndices.length;
    const currentKeys = new Set<string>();
    for (const [position, entry] of entries.entries()) {
      const index = currentIndices[position];
      const expectedRelativeOrder =
        index !== undefined && catalogMax !== undefined ? index - catalogMax : undefined;
      const entryOrder = entry.order;
      const role = stableHistoryRole(entry.key);
      if (
        index === undefined ||
        expectedRelativeOrder === undefined ||
        entryOrder === undefined ||
        role === undefined ||
        role !== entry.value.role ||
        entry.value.id !== entry.key ||
        !this.observeHistoryRenderability(
          entry.value,
          entry.key,
          stableEmptyKeys,
          proof.renderabilityByKey
        ) ||
        entryOrder !== expectedRelativeOrder ||
        currentKeys.has(entry.key) ||
        (proof.rolesByKey.has(entry.key) && proof.rolesByKey.get(entry.key) !== role) ||
        (proof.keyToRelativeOrder.has(entry.key) &&
          proof.keyToRelativeOrder.get(entry.key) !== entryOrder) ||
        (proof.relativeOrderToKey.has(entryOrder) &&
          proof.relativeOrderToKey.get(entryOrder) !== entry.key)
      ) {
        consistent = false;
      }
      if (role !== undefined && entryOrder !== undefined) {
        currentKeys.add(entry.key);
        proof.rolesByKey.set(entry.key, role);
        proof.keyToRelativeOrder.set(entry.key, entryOrder);
        proof.relativeOrderToKey.set(entryOrder, entry.key);
      }
    }

    if (catalogMax !== undefined) {
      if (proof.catalogMax !== undefined && catalogMax < proof.catalogMax) consistent = false;
      const tailKey = entries.find(entry => entry.order === 0)?.key;
      if (tailKey === undefined || stableHistoryRole(tailKey) === undefined) {
        consistent = false;
      } else if (proof.tailKey === undefined) {
        proof.tailKey = tailKey;
      } else if (proof.tailKey !== tailKey) {
        consistent = false;
      }
      if (proof.catalogMax === undefined || catalogMax > proof.catalogMax) {
        proof.catalogMax = catalogMax;
      }
    }
    return consistent;
  }

  private observeHistoryRenderability(
    message: ConversationMessage,
    key: string,
    stableEmptyKeys: ReadonlySet<string>,
    observed: Map<string, HistoryRenderability>
  ): boolean {
    const current: HistoryRenderability = stableEmptyKeys.has(key)
      ? 'stable-empty'
      : this.hasRenderableHistoryContent(message)
        ? 'nonempty'
        : 'unsupported';
    const previous = observed.get(key);
    observed.set(key, current);
    return current !== 'unsupported' && (previous === undefined || previous === current);
  }

  /** Accept only the observed inert empty boundary, never a generic empty root. */
  private isStableEmptyAssistant(element: Element): boolean {
    if (!element.matches(STABLE_EMPTY_ASSISTANT_ROOT) || element.childNodes.length !== 1)
      return false;
    if (!this.isExactEmptyHeading(element.firstElementChild)) return false;
    const row = element.closest(SELECTORS.conversationRow[0]) ?? element;
    return (
      !row.matches(STABLE_EMPTY_FORBIDDEN_SELECTOR) &&
      !row.querySelector(STABLE_EMPTY_FORBIDDEN_SELECTOR) &&
      !this.isLegacyStatusHeader(row) &&
      this.collectStatusHeaders(row).length === 0
    );
  }

  private isExactEmptyHeading(heading: Element | null): boolean {
    if (!heading || heading.tagName !== 'H3') return false;
    const attributes = heading.getAttributeNames();
    return (
      attributes.length === 3 &&
      attributes.every(name => STABLE_EMPTY_HEADING_ATTRIBUTES.has(name)) &&
      heading.getAttribute('data-find-omitted') === '' &&
      heading.getAttribute('aria-hidden') === 'true' &&
      heading.classList.length === 2 &&
      heading.classList.contains('sr-only') &&
      heading.classList.contains('select-none') &&
      heading.childNodes.length === 0 &&
      heading.childElementCount === 0 &&
      heading.textContent === ''
    );
  }

  private markStableEmptyAssistant(
    item: { element: Element; type: 'user' | 'assistant' },
    content: string,
    key: string | undefined,
    keys: Set<string> | undefined
  ): boolean {
    if (
      item.type !== 'assistant' ||
      content !== '' ||
      key === undefined ||
      !keys ||
      !this.isStableEmptyAssistant(item.element)
    )
      return false;
    keys.add(key);
    return true;
  }

  /** Proof only: empty HTML wrappers are not an extracted assistant answer. */
  private hasRenderableHistoryContent(message: ConversationMessage): boolean {
    if (message.role === 'user') return message.content.trim().length > 0;
    // Harvested assistant HTML is already sanitized. Bound this proof before
    // parsing; do not repeat sanitization or heavy Markdown conversion here.
    const html = message.content;
    if (html.length > CLAUDE_TOOL_LIMITS.sectionHtmlBytes) return false;
    let delimiters = 0;
    for (let index = 0; index < html.length; index++) {
      if (
        html.charCodeAt(index) === 60 &&
        ++delimiters > CLAUDE_TOOL_LIMITS.sectionMarkupDelimiters
      ) {
        return false;
      }
    }
    const template = document.createElement('template');
    template.innerHTML = html;
    if (template.content.textContent?.replace(/\u00a0/g, ' ').trim()) return true;
    // Keep the existing image-only path, including an img inside picture.
    // Empty wrappers, breaks and source-less image placeholders prove nothing.
    return Array.from(template.content.querySelectorAll('img[src], img[srcset]')).some(image =>
      Boolean(image.getAttribute('src')?.trim() || image.getAttribute('srcset')?.trim())
    );
  }

  /**
   * Harvest the currently-mounted window as keyed messages.
   *
   * Claude renumbers `data-index` whenever an older catalog page is prepended.
   * De-duplication therefore uses exact provider message identities. The
   * numeric row contributes only `index - currentCatalogMax`, an invariant
   * conversation order while the pinned newest tail remains unchanged.
   */
  private harvestWindow(
    toolBudget: ClaudeToolConversionBudget,
    toolCache?: ToolContentCache,
    root: Element | Document = document,
    stableEmptyKeys?: Set<string>,
    catalogMax?: number
  ): HarvestEntry<ConversationMessage>[] {
    const entries: HarvestEntry<ConversationMessage>[] = [];
    this.collectSortedElements(root).forEach(item => {
      const content =
        item.type === 'user'
          ? this.extractUserContent(item.element)
          : this.extractAssistantContent(item.element);

      const row = item.element.closest(SELECTORS.conversationRow[0]);
      const dataIndex =
        row && row !== root && root.contains(row) ? row.getAttribute('data-index') : null;
      const rowIndex = parseRowIndex(dataIndex);
      const stableKey = stableHistoryKey(item);
      const key =
        stableKey ?? `fallback:${item.type}:${generateHash(`${content}\u0000${dataIndex ?? ''}`)}`;
      const order =
        rowIndex !== undefined && catalogMax !== undefined ? rowIndex - catalogMax : undefined;
      const stableEmpty = this.markStableEmptyAssistant(item, content, key, stableEmptyKeys);
      if (!content && !stableEmpty) return;
      const message: ConversationMessage = {
        id: key,
        role: item.type,
        content,
        htmlContent: item.type === 'assistant' ? content : undefined,
        index: 0, // re-indexed after accumulation
      };

      const cache = stableKey && toolCache ? { key: stableKey, values: toolCache } : undefined;
      const tc =
        this.enableToolContent && item.type === 'assistant'
          ? this.extractToolContentFromElement(item.element, toolBudget, cache)
          : null;
      entries.push({ key, value: tc ? { ...message, toolContent: tc } : message, order });
    });
    return entries;
  }

  /**
   * Extract user message content as markdown.
   *
   * Sanitizes the grid container's innerHTML via DOMPurify and converts it
   * to markdown (without angle-bracket escaping — {@link formatMessage}
   * applies that step later). This preserves paragraph breaks and
   * `<pre>`/`<code>` blocks that a plain `textContent` extraction would
   * flatten or drop entirely (see issue #200).
   *
   * Falls back to sanitized plain text for elements that produce no
   * markdown output (e.g. bare text nodes without block structure).
   */
  private extractUserContent(element: Element): string {
    const rawHtml = element.innerHTML;
    if (rawHtml) {
      const markdown = htmlToMarkdownRaw(sanitizeHtml(rawHtml)).trim();
      if (markdown) return markdown;
    }

    // Defensive fallback: preserve prior behavior for elements that have
    // only a text node and no convertible HTML structure.
    const textContent = element.textContent?.trim();
    if (textContent) {
      return this.sanitizeText(textContent);
    }
    return '';
  }

  /**
   * Extract assistant response content (HTML for markdown conversion)
   *
   * All HTML is sanitized via DOMPurify to prevent XSS
   * @see NFR-001-2 in design document
   */
  private extractAssistantContent(element: Element): string {
    if (element.matches(ANSWER_CHROME_SELECTOR)) return '';
    const answer = element.cloneNode(true) as Element;
    answer.querySelectorAll(ANSWER_CHROME_SELECTOR).forEach(chrome => chrome.remove());
    // Keep the legacy header/body distinction: a nested .row-start-1 inside
    // .row-start-2 is answer content, not a status header.
    this.collectStatusHeaders(answer).forEach(header => header.remove());

    const parts = this.collectResponseMarkdown(answer);
    if (parts.length > 0) {
      return parts.join('\n');
    }

    // The fallback uses the SAME cleaned clone. Empty wrappers left by a
    // thinking-only turn are not an answer; image-only content still survives.
    // This also keeps provider tool metadata out of ordinary message content
    // while the explicit tool-content setting is disabled.
    const html = sanitizeHtml(answer.innerHTML);
    return htmlToMarkdownRaw(html).trim() ? html : '';
  }

  /**
   * Collect the response body's markdown sections, in DOM order.
   *
   * A single response interleaves two content shapes. Thinking / tool-use steps
   * put their text inside a grid block's `.row-start-2`, while the final answer
   * is emitted as top-level `.standard-markdown` blocks that sit inside NO grid
   * section. Earlier revisions read only `.row-start-2` and fell back to a
   * whole-element search solely when every section came back empty, so a
   * response that had both shapes returned just the step preambles and dropped
   * the entire answer.
   *
   * `querySelectorAll` walks in document order, so one sweep yields both shapes
   * already in conversation order.
   */
  private collectResponseMarkdown(element: Element): string[] {
    const sections = this.queryAllWithFallback<HTMLElement>(SELECTORS.markdownContent, element);
    const parts: string[] = [];

    for (const section of sections) {
      if (this.isInStatusHeader(section)) continue;
      // A lower-priority selector such as [class*="markdown"] can match both a
      // wrapper and the node inside it; emitting both would repeat the shared
      // text, so keep only the outermost match.
      if (sections.some(other => other !== section && other.contains(section))) continue;
      const html = sanitizeHtml(section.innerHTML);
      if (html.trim()) parts.push(html);
    }

    return parts;
  }

  /**
   * Whether a markdown section belongs to a step's status header rather than to
   * the response body.
   *
   * Claude reuses `.row-start-1` / `.row-start-2` at two nesting levels: the
   * OUTER `.row-start-1` is the status header, whose tool output is surfaced
   * separately by {@link extractToolContentFromElement}, while a step's own text
   * sits under `.row-start-2` — wrapped in a SECOND, nested `.row-start-1`.
   * Skipping everything beneath any `.row-start-1` would therefore discard the
   * step text as well. A header also requires its paired `.row-start-2` sibling:
   * the class alone can be ordinary visible answer layout.
   */
  private isInStatusHeader(element: Element): boolean {
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.matches('.row-start-2')) return false;
      if (this.isLegacyStatusHeader(ancestor)) return true;
    }
    return false;
  }

  /** A legacy step has header/body siblings in the SAME step container. */
  private isLegacyStatusHeader(element: Element): boolean {
    return (
      element.matches('.row-start-1') &&
      element.closest('.row-start-2') === null &&
      Boolean(element.parentElement?.querySelector(':scope > .row-start-2'))
    );
  }

  /**
   * Merge October label-only tools and legacy rich grid tools in DOM order.
   *
   * October rows take priority over overlapping legacy-shaped wrappers. Their
   * expanded details must not be re-read through the old grid extractor.
   */
  private extractToolContentFromElement(
    element: Element,
    budget: ClaudeToolConversionBudget,
    cache?: { readonly key: string; readonly values: ToolContentCache }
  ): string | null {
    const toolCandidates = this.collectToolCandidates(element);
    // Compare exact ordered input, not a collision-prone digest. Answer text
    // and action chrome are not tool input and do not invalidate this cache.
    const input = cache ? this.toolCacheInput(toolCandidates) : undefined;
    const cached = cache?.values.entries.get(cache.key);
    if (input !== undefined && cached?.input === input) return cached.output;
    if (cache && cached) {
      // Invalidate before conversion, including failed or non-cacheable changes.
      cache.values.entries.delete(cache.key);
      cache.values.totalBytes -= cached.byteLength;
    }
    const output = this.convertToolCandidates(toolCandidates, budget);
    if (cache && input !== undefined) {
      const byteLength = toolCacheEncoder.encode(input).byteLength;
      if (byteLength <= CLAUDE_TOOL_CACHE_MAX_BYTES - cache.values.totalBytes) {
        cache.values.entries.set(cache.key, { input, output, byteLength });
        cache.values.totalBytes += byteLength;
      }
    }
    return output;
  }

  /** Bound snapshot size before serialization; ordinary conversion owns rejection. */
  private toolCacheInput(candidates: Element[]): string | undefined {
    if (candidates.length > CLAUDE_TOOL_LIMITS.sections) return undefined;
    const inputs: Array<readonly [string, string, number]> = [];
    const ancestors: Array<{ element: Element; index: number }> = [];
    let totalLength = 0;
    for (const { element } of this.sortByDomPosition(candidates.map(element => ({ element })))) {
      while (ancestors.length > 0 && !ancestors[ancestors.length - 1].element.contains(element)) {
        ancestors.pop();
      }
      const parent = ancestors[ancestors.length - 1]?.index ?? -1;
      ancestors.push({ element, index: inputs.length });
      const october = element.matches(SELECTORS.toolStatus[0]);
      // Thinking is deliberately not converted; its changing details are not
      // relevant input. Keep its position without retaining unbounded markup.
      if (!october && element.querySelector('[class*="group/thinking"]')) {
        inputs.push(['thinking', '', parent]);
        continue;
      }
      const html = element.innerHTML;
      totalLength += html.length;
      if (
        html.length > CLAUDE_TOOL_LIMITS.sectionHtmlBytes ||
        totalLength > CLAUDE_TOOL_LIMITS.rawHtmlBytes
      ) {
        return undefined;
      }
      // Kind is the only root-attribute distinction used by conversion; all
      // consumed label/metadata/Markdown input is inside this exact HTML.
      // Candidate ancestry controls overlap de-duplication, even when an
      // ignored thinking wrapper's own markup is not conversion input.
      inputs.push([october ? 'october' : 'legacy', html, parent]);
    }
    return JSON.stringify(inputs);
  }

  /** Include candidate filtering and DOM order in the exact conversion input. */
  private collectToolCandidates(element: Element): Element[] {
    const octoberRows = Array.from(element.querySelectorAll(SELECTORS.toolStatus[0])).filter(
      row => !this.isInDismissedConversationPanel(row)
    );
    const legacyHeaders = this.collectStatusHeaders(element).filter(
      header => !header.closest(STEP_ROW_SELECTOR)
    );
    return [...octoberRows, ...legacyHeaders];
  }

  private convertToolCandidates(
    toolCandidates: Element[],
    budget: ClaudeToolConversionBudget
  ): string | null {
    budget.assertSectionCapacity(toolCandidates.length);
    const candidates = this.distinctElements(toolCandidates, budget);
    const ordered = this.sortByDomPosition(candidates.map(element => ({ element })));

    const parts: string[] = [];
    for (const { element: header } of ordered) {
      if (header.matches(SELECTORS.toolStatus[0])) {
        budget.beginSection(header.innerHTML);
        const label = this.sanitizeText(
          header.querySelector(':scope > [data-cds-row] bdi')?.textContent ?? ''
        );
        if (label) {
          budget.addMetadataEntries(1);
          appendClaudeToolPart(parts, `**${label}**`, budget);
        }
        continue;
      }
      // Extended Thinking is presented separately from tool activity. Skip just
      // that block: a thinking step early in the response must not suppress the
      // tool content of every step after it.
      if (header.querySelector('[class*="group/thinking"]')) continue;

      const toolContent = this.extractToolContent(header, budget);
      appendClaudeToolPart(parts, toolContent, budget, true);
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }

  /**
   * Status headers of a response's grid step blocks, in DOM order.
   *
   * A response can carry several sequential steps, each with its own header.
   * Only the OUTER `.row-start-1` is a header — see {@link isInStatusHeader}
   * for why the nested one under `.row-start-2` must not be treated as such.
   */
  private collectStatusHeaders(element: Element): HTMLElement[] {
    return Array.from(element.querySelectorAll<HTMLElement>('.row-start-1')).filter(header =>
      this.isLegacyStatusHeader(header)
    );
  }

  /**
   * Extract tool content from .row-start-1 section
   *
   * Extracts:
   * 1. Summary button text (e.g., "Searched the web") as bold
   * 2. Search queries (group/row buttons with query text and result count)
   * 3. Search result items (identified by favicon images)
   * 4. .standard-markdown content (code interpreter, file analysis)
   */
  private extractToolContent(toolSection: Element, budget: ClaudeToolConversionBudget): string {
    budget.beginSection(toolSection.innerHTML);
    const parts: string[] = [];
    this.extractToolSummary(toolSection, parts, budget);
    this.extractToolQueries(toolSection, parts, budget);
    this.extractToolResults(toolSection, parts, budget);
    this.extractToolMarkdown(toolSection, parts, budget);
    return parts.join('\n\n');
  }

  /** Summary button text (e.g., "Searched the web") as bold */
  private extractToolSummary(
    toolSection: Element,
    parts: string[],
    budget: ClaudeToolConversionBudget
  ): void {
    const summaryButton = toolSection.querySelector('button span.truncate');
    if (summaryButton?.textContent) {
      appendClaudeToolPart(
        parts,
        '**' + this.sanitizeText(summaryButton.textContent) + '**',
        budget
      );
    }
  }

  /** Search queries (group/row buttons with query text and result count) */
  private extractToolQueries(
    toolSection: Element,
    parts: string[],
    budget: ClaudeToolConversionBudget
  ): void {
    const queryButtons = toolSection.querySelectorAll('[class*="group/row"]');
    queryButtons.forEach(btn => {
      budget.addMetadataEntries(1);
      const queryEl = btn.querySelector('.truncate');
      const countEl = btn.querySelector('p');
      if (queryEl?.textContent?.trim()) {
        let text = this.sanitizeText(queryEl.textContent);
        if (countEl?.textContent?.trim()) {
          text += ' (' + this.sanitizeText(countEl.textContent) + ')';
        }
        appendClaudeToolPart(parts, text, budget);
      }
    });
  }

  /** Search result items (identified by favicon images) */
  private extractToolResults(
    toolSection: Element,
    parts: string[],
    budget: ClaudeToolConversionBudget
  ): void {
    const favicons = toolSection.querySelectorAll('img[alt="favicon"]');
    if (favicons.length === 0) return;

    const items: string[] = [];
    const seenRows = new Set<Element>();
    favicons.forEach(img => {
      // Navigate: img → container div → result row div
      const row = img.parentElement?.parentElement;
      if (!row || row.children.length < 2) return;
      if (seenRows.has(row)) return;
      seenRows.add(row);
      budget.addMetadataEntries(1);
      // Children: [0]=favicon container, [1]=title, [2]=domain (optional)
      const title = row.children[1]?.textContent?.trim();
      const domain = row.children.length > 2 ? row.children[2]?.textContent?.trim() : undefined;
      if (title) {
        const text = domain ? '- ' + title + ' (' + domain + ')' : '- ' + title;
        if (items.length > 0) budget.addMarkdownBytes(1);
        budget.addMarkdown(text);
        items.push(text);
      }
    });
    if (items.length > 0) {
      appendClaudeToolPart(parts, items.join('\n'), budget, true);
    }
  }

  /** .standard-markdown content (code interpreter, file analysis) */
  private extractToolMarkdown(
    toolSection: Element,
    parts: string[],
    budget: ClaudeToolConversionBudget
  ): void {
    const markdownEls = toolSection.querySelectorAll('.standard-markdown');
    markdownEls.forEach(el => {
      const markdown = claudeToolHtmlToMarkdown(el.innerHTML, budget);
      appendClaudeToolPart(parts, markdown, budget, true);
    });
  }

  // ========== Deep Research Extraction ==========

  /**
   * Extract source list from Deep Research inline citations
   *
   * Deduplicates by URL and maintains DOM order
   * @see FR-003-4 in design document
   */
  extractSourceList(): DeepResearchSource[] {
    const sources: DeepResearchSource[] = [];
    const seenUrls = new Map<string, number>(); // URL -> index mapping for deduplication

    // Find all inline citation links
    const citationLinks = document.querySelectorAll<HTMLAnchorElement>(
      JOINED_SELECTORS.inlineCitation
    );

    citationLinks.forEach(link => {
      const url = link.href;
      if (!url || !url.startsWith('http')) return;

      // Skip duplicates
      if (seenUrls.has(url)) return;

      // Extract title from link text or parent
      let title = link.textContent?.trim() || '';
      if (!title || title.includes('+')) {
        // Try to get a better title from aria-label or title attribute
        title = link.getAttribute('aria-label') || link.getAttribute('title') || '';
      }
      if (!title) {
        title = 'Unknown Title';
      }

      const domain = this.extractDomain(url);

      const index = sources.length;
      seenUrls.set(url, index);

      sources.push({
        index,
        url,
        title: this.sanitizeText(title),
        domain,
      });
    });

    return sources;
  }
}
