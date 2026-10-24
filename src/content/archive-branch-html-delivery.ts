/** Sequential File HTML delivery. The prepared plan owns bodies; this runner retains only facts. */
import type { DerivedOutputIdentity } from '../lib/derived-presentation-contract';
import type {
  AllBranchesPresentationPlan,
  ArchiveCompanionBundle,
  DurableWriteOutcome,
} from '../lib/types';
import { snapshotDerivedBranchHtmlPersistResponse } from '../lib/derived-branch-persistence-contract';
import type { ChatGptDestinationArchiveReceipt } from '../lib/chatgpt-archive-receipt';
import type { AllBranchesBudgetKind, ExactPresentationBudget } from './archive-branch-budget';
import {
  prepareDerivedBranchHtmlPlan,
  type PreparedDerivedBranchHtmlPlan,
  type DerivedBranchHtmlDocumentMeasurement,
} from './derived-branch-html-plan';
import {
  persistDerivedBranchHtmlArtifactForFile,
  type DerivedBranchHtmlPersistenceObservation,
} from './derived-branch-html-persistence';
import {
  buildFinalizedFileArchivePresentationEvidence,
  reconcileFinalizedFileArchivePresentationEvidence,
  type FinalizedFileArchivePresentationEvidence,
} from './finalized-html-assets';

export interface AllBranchesFileHtmlRequest {
  readonly expectedSyncSettingsSnapshot: string;
  readonly fileArchivePresentation?: FinalizedFileArchivePresentationEvidence;
}

/** One own-data read per field: no accessors or later caller mutation choose settings/evidence. */
export function snapshotFileHtmlRequest(value: unknown): AllBranchesFileHtmlRequest | undefined {
  if (value === undefined) return undefined;
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some(
        key => key !== 'expectedSyncSettingsSnapshot' && key !== 'fileArchivePresentation'
      ) ||
      keys.some(
        key => !('value' in descriptors[key as string]) || !descriptors[key as string].enumerable
      ) ||
      typeof descriptors.expectedSyncSettingsSnapshot?.value !== 'string'
    )
      throw new Error();
    return Object.freeze({
      expectedSyncSettingsSnapshot: descriptors.expectedSyncSettingsSnapshot.value as string,
      ...(descriptors.fileArchivePresentation && {
        fileArchivePresentation: descriptors.fileArchivePresentation
          .value as FinalizedFileArchivePresentationEvidence,
      }),
    });
  } catch {
    throw new Error('All-branches HTML request is invalid.');
  }
}

export interface AllBranchesFileHtmlSeams {
  prepareDerivedBranchHtmlPlan?: typeof prepareDerivedBranchHtmlPlan;
  buildFinalizedFileArchivePresentationEvidence?: typeof buildFinalizedFileArchivePresentationEvidence;
  persistDerivedBranchHtmlArtifactForFile?: typeof persistDerivedBranchHtmlArtifactForFile;
}

export type AllBranchesFileHtmlReason =
  | 'evidence-unavailable'
  | 'preparation-failed'
  | 'budget-exceeded'
  | 'cancelled'
  | 'presentation-not-started'
  | 'file-markdown-unknown'
  | 'recreate-failed'
  | 'write-failed'
  | 'write-not-dispatched'
  | 'write-unknown';

export interface AllBranchesFileHtmlWriteCounts {
  confirmed: number;
  /** Reserved for explicit failed-write evidence; today's transport exposes no such state. */
  failed: number;
  unknown: number;
  /** Includes suppressed/unattempted documents as well as explicit sender non-dispatch. */
  notDispatched: number;
}

export interface AllBranchesFileHtmlSummary {
  requested: true;
  status: 'not-attempted' | 'complete' | 'partial' | 'failed' | 'rejected' | 'cancelled';
  reason?: AllBranchesFileHtmlReason;
  measuredDocuments: number;
  recreatedDocuments: number;
  confirmedLeafPairs: number;
  indexPair: 'confirmed' | 'failed' | 'unknown' | 'not-dispatched';
  htmlWrites: AllBranchesFileHtmlWriteCounts;
  receiptWrites: AllBranchesFileHtmlWriteCounts;
  confirmedBytes: number;
  unknownBytes: number;
  cleanupDeferred: number;
  budgetKind?: AllBranchesBudgetKind;
  cancelRequested: boolean;
}

export function createFileHtmlSummary(branchCount: number): AllBranchesFileHtmlSummary {
  const counts = (): AllBranchesFileHtmlWriteCounts => ({
    confirmed: 0,
    failed: 0,
    unknown: 0,
    notDispatched: branchCount + 1,
  });
  return {
    requested: true,
    status: 'not-attempted',
    measuredDocuments: 0,
    recreatedDocuments: 0,
    confirmedLeafPairs: 0,
    indexPair: 'not-dispatched',
    htmlWrites: counts(),
    receiptWrites: counts(),
    confirmedBytes: 0,
    unknownBytes: 0,
    cleanupDeferred: 0,
    cancelRequested: false,
  };
}

export function stopFileHtml(
  summary: AllBranchesFileHtmlSummary,
  reason: AllBranchesFileHtmlReason,
  budgetKind?: AllBranchesBudgetKind
): void {
  summary.reason = reason;
  summary.cancelRequested = reason === 'cancelled';
  if (budgetKind) summary.budgetKind = budgetKind;
  summary.status =
    reason === 'cancelled'
      ? 'cancelled'
      : reason === 'budget-exceeded'
        ? 'rejected'
        : summary.confirmedBytes > 0 || summary.unknownBytes > 0
          ? 'partial'
          : 'failed';
}

interface HtmlControls extends AllBranchesFileHtmlSeams {
  signal?: AbortSignal;
  yieldTask: () => Promise<void>;
}

/** Archive receipts supplied by attachment finalization must never fall back to the old archive. */
// eslint-disable-next-line max-lines-per-function, complexity -- Keep receipt ownership, cancellation and shared-budget preparation in one fail-closed phase.
export async function prepareFileHtmlDelivery(
  plan: AllBranchesPresentationPlan,
  companion: ArchiveCompanionBundle,
  request: AllBranchesFileHtmlRequest,
  suppliedReceipts: boolean,
  fileReceipt: ChatGptDestinationArchiveReceipt | undefined,
  branchCount: number,
  budget: ExactPresentationBudget,
  summary: AllBranchesFileHtmlSummary,
  controls: HtmlControls
): Promise<PreparedDerivedBranchHtmlPlan | undefined> {
  try {
    if (controls.signal?.aborted) {
      stopFileHtml(summary, 'cancelled');
      return;
    }
    let evidence = suppliedReceipts ? request.fileArchivePresentation : undefined;
    if (fileReceipt && !suppliedReceipts && plan.structuredArchivePresentationContext) {
      evidence = await (
        controls.buildFinalizedFileArchivePresentationEvidence ??
        buildFinalizedFileArchivePresentationEvidence
      )(plan.structuredArchivePresentationContext, plan.archive, companion, []);
    }
    if (controls.signal?.aborted) {
      stopFileHtml(summary, 'cancelled');
      return;
    }
    evidence =
      evidence && fileReceipt
        ? reconcileFinalizedFileArchivePresentationEvidence(evidence, fileReceipt)
        : undefined;
    if (!evidence) {
      stopFileHtml(summary, 'evidence-unavailable');
      return;
    }
    const result = await (controls.prepareDerivedBranchHtmlPlan ?? prepareDerivedBranchHtmlPlan)(
      evidence,
      {
        source: 'chatgpt',
        captureId: companion.captureId,
        conversationKey: companion.conversationKey,
      },
      request.expectedSyncSettingsSnapshot,
      budget,
      { signal: controls.signal, yieldTask: controls.yieldTask }
    );
    if (controls.signal?.aborted || result.state === 'cancelled') {
      stopFileHtml(summary, 'cancelled');
      return;
    }
    if (result.state === 'rejected') {
      stopFileHtml(
        summary,
        result.code === 'derived-branch-html-plan-budget-exceeded'
          ? 'budget-exceeded'
          : 'preparation-failed',
        result.budgetKind
      );
      return;
    }
    if (
      result.plan.branchCount !== branchCount ||
      result.plan.documents.length !== branchCount + 1
    ) {
      stopFileHtml(summary, 'preparation-failed');
      return;
    }
    summary.measuredDocuments = result.plan.documents.length;
    return result.plan;
  } catch {
    stopFileHtml(summary, controls.signal?.aborted ? 'cancelled' : 'preparation-failed');
    return;
  }
}

function recordOutcome(
  summary: AllBranchesFileHtmlSummary,
  counts: AllBranchesFileHtmlWriteCounts,
  outcome: DurableWriteOutcome,
  bytes: number
): void {
  if (outcome.state !== 'not-dispatched') {
    counts.notDispatched -= 1;
    counts[outcome.state] += 1;
  }
  if (outcome.state === 'confirmed') summary.confirmedBytes += bytes;
  if (outcome.state === 'unknown') summary.unknownBytes += bytes;
  if (outcome.cleanupDeferred) summary.cleanupDeferred += 1;
}

function pairState(
  html: DurableWriteOutcome,
  receipt: DurableWriteOutcome
): AllBranchesFileHtmlSummary['indexPair'] {
  if (html.state === 'unknown' || receipt.state === 'unknown') return 'unknown';
  if (html.state === 'confirmed' && receipt.state === 'confirmed') return 'confirmed';
  if (html.state === 'not-dispatched' && receipt.state === 'not-dispatched')
    return 'not-dispatched';
  return 'failed';
}

function observePair(
  summary: AllBranchesFileHtmlSummary,
  observation: DerivedBranchHtmlPersistenceObservation,
  document: DerivedBranchHtmlDocumentMeasurement
): void {
  const response =
    observation.state === 'observed'
      ? snapshotDerivedBranchHtmlPersistResponse(observation.response)
      : undefined;
  const fallback = observation.state === 'not-dispatched' ? 'not-dispatched' : 'unknown';
  const html = response?.html.writeOutcome ?? { state: fallback };
  const receipt = response?.receipt.writeOutcome ?? { state: fallback };
  recordOutcome(summary, summary.htmlWrites, html, document.artifact.byteLength);
  recordOutcome(summary, summary.receiptWrites, receipt, document.receipt.byteLength);
  const pair = pairState(html, receipt);
  if (document.artifact.role === 'index') summary.indexPair = pair;
  else if (pair === 'confirmed') summary.confirmedLeafPairs += 1;
  if (pair !== 'confirmed')
    stopFileHtml(
      summary,
      pair === 'unknown'
        ? 'write-unknown'
        : pair === 'failed'
          ? 'write-failed'
          : 'write-not-dispatched'
    );
  else if (summary.reason) stopFileHtml(summary, summary.reason);
}

/** In-flight dispatch is observed even after Stop; only the next pair is prevented. */
// eslint-disable-next-line max-lines-per-function, complexity -- One sequential cursor owns recreation, dispatch, Stop boundaries and independent sink observation.
export async function deliverFileHtml(
  plan: PreparedDerivedBranchHtmlPlan,
  identity: DerivedOutputIdentity,
  settingsSnapshot: string,
  summary: AllBranchesFileHtmlSummary,
  controls: HtmlControls
): Promise<void> {
  for (let position = 0; position <= plan.branchCount; position += 1) {
    if (controls.signal?.aborted) {
      stopFileHtml(summary, 'cancelled');
      return;
    }
    if (position === plan.branchCount && summary.confirmedLeafPairs !== plan.branchCount) return;
    try {
      await controls.yieldTask();
      if (controls.signal?.aborted) {
        stopFileHtml(summary, 'cancelled');
        return;
      }
      const recreated = await plan.recreateNext();
      if (recreated.state === 'ready' && recreated.position === position)
        summary.recreatedDocuments += 1;
      if (controls.signal?.aborted || recreated.state === 'cancelled') {
        stopFileHtml(summary, 'cancelled');
        return;
      }
      if (recreated.state !== 'ready' || recreated.position !== position) {
        stopFileHtml(summary, 'recreate-failed');
        return;
      }
      await controls.yieldTask();
      if (controls.signal?.aborted) {
        stopFileHtml(summary, 'cancelled');
        return;
      }
      let observation: DerivedBranchHtmlPersistenceObservation;
      try {
        observation = await (
          controls.persistDerivedBranchHtmlArtifactForFile ??
          persistDerivedBranchHtmlArtifactForFile
        )(identity, recreated.artifact, settingsSnapshot);
      } catch {
        observation = { state: 'unconfirmed' };
      }
      observePair(summary, observation, recreated.measurement);
      if (controls.signal?.aborted) {
        stopFileHtml(summary, 'cancelled');
        return;
      }
      if (summary.htmlWrites.unknown > 0 || summary.receiptWrites.unknown > 0) return;
    } catch {
      stopFileHtml(summary, controls.signal?.aborted ? 'cancelled' : 'recreate-failed');
      return;
    }
  }
  if (summary.confirmedLeafPairs === plan.branchCount && summary.indexPair === 'confirmed') {
    summary.status = 'complete';
    delete summary.reason;
  }
}
