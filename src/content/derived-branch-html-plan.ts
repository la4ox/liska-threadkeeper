/** Pure two-pass measurement plan for File all-branches HTML; never dispatches or writes. */
import { HTML_PRESENTATION_LIMITS, type HtmlBranchRenderFact } from '../archive/presentation';
import type {
  DerivedBranchHtmlArtifact,
  DerivedBranchHtmlReceiptRelativePath,
} from '../lib/derived-branch-presentation-contract';
import type { DerivedOutputIdentity } from '../lib/derived-presentation-contract';
import { isSerializedSyncSettingsSnapshot } from '../lib/sync-settings-snapshot';
import { sha256Hex } from '../lib/sha256';
import type { StructuredArchivePresentationContext } from '../lib/types';
import {
  checkedAdd,
  ExactPresentationBudget,
  type AllBranchesBudgetKind,
} from './archive-branch-budget';
import {
  prepareDerivedHtmlBranchPresentationSession,
  type DerivedHtmlBranchPresentationOptions,
  type DerivedHtmlBranchPresentationSession,
} from './derived-branch-html-presentation';
import { buildDerivedBranchHtmlPersistenceEnvelope } from './derived-branch-html-persistence';
import type { FinalizedFileArchivePresentationEvidence } from './finalized-html-assets';

export type DerivedBranchHtmlPlanErrorCode =
  | 'derived-branch-html-plan-input-invalid'
  | 'derived-branch-html-plan-measurement-failed'
  | 'derived-branch-html-plan-budget-exceeded'
  | 'derived-branch-html-plan-recreate-failed'
  | 'derived-branch-html-plan-recreate-mismatch';

export type DerivedBranchHtmlArtifactMeasurement = Omit<DerivedBranchHtmlArtifact, 'bodyBase64'>;

export interface DerivedBranchHtmlReceiptMeasurement {
  readonly relativePath: DerivedBranchHtmlReceiptRelativePath;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface DerivedBranchHtmlEnvelopeMeasurement {
  readonly byteLength: number;
  readonly sha256: string;
}

export interface DerivedBranchHtmlDocumentMeasurement {
  readonly artifact: Readonly<DerivedBranchHtmlArtifactMeasurement>;
  readonly receipt: Readonly<DerivedBranchHtmlReceiptMeasurement>;
  readonly envelope: Readonly<DerivedBranchHtmlEnvelopeMeasurement>;
}

export type DerivedBranchHtmlRecreateResult =
  | {
      readonly state: 'ready';
      readonly position: number;
      readonly measurement: DerivedBranchHtmlDocumentMeasurement;
      /** Ephemeral delivery value; the plan never caches this body. */
      readonly artifact: Readonly<DerivedBranchHtmlArtifact>;
    }
  | { readonly state: 'complete' }
  | { readonly state: 'cancelled' }
  | {
      readonly state: 'failed';
      readonly code:
        | 'derived-branch-html-plan-recreate-failed'
        | 'derived-branch-html-plan-recreate-mismatch';
    };

export interface PreparedDerivedBranchHtmlPlan {
  readonly branchCount: number;
  readonly branchPointCount: number;
  /** Leaves in ordinal order followed by branches.html. Contains no HTML/base64 body. */
  readonly documents: readonly DerivedBranchHtmlDocumentMeasurement[];
  readonly plannedPhysicalBytes: number;
  readonly plannedHtmlRenderWorkBytes: number;
  /** Strictly advances leaves then index; terminal cancellation/failure is sticky and never retries. */
  recreateNext(): Promise<DerivedBranchHtmlRecreateResult>;
}

export type PrepareDerivedBranchHtmlPlanResult =
  | { readonly state: 'prepared'; readonly plan: PreparedDerivedBranchHtmlPlan }
  | { readonly state: 'cancelled' }
  | {
      readonly state: 'rejected';
      readonly code:
        | 'derived-branch-html-plan-input-invalid'
        | 'derived-branch-html-plan-measurement-failed'
        | 'derived-branch-html-plan-budget-exceeded';
      readonly budgetKind?: AllBranchesBudgetKind;
    };

export interface DerivedBranchHtmlPlanControls {
  readonly signal?: AbortSignal;
  readonly yieldTask?: () => Promise<void>;
  readonly presentation?: DerivedHtmlBranchPresentationOptions;
}

interface SnapshotPlanControls {
  readonly signal?: AbortSignal;
  readonly yieldTask: () => Promise<void>;
  readonly presentation?: DerivedHtmlBranchPresentationOptions;
}

interface MeasuredDocument {
  readonly public: DerivedBranchHtmlDocumentMeasurement;
  readonly fact?: HtmlBranchRenderFact;
}

const ARCHIVE_CONTEXT_KEYS = [
  'source',
  'archive',
  'captureId',
  'conversationKey',
  'manifest',
  'canonical',
  'includeToolContent',
] as const;

class ControlledPlanFailure {
  constructor(
    readonly code: DerivedBranchHtmlPlanErrorCode | 'cancelled',
    readonly budgetKind?: AllBranchesBudgetKind
  ) {}
}

const defaultYield = (): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, 0);
  });

function cancelled(signal: AbortSignal | undefined): boolean {
  try {
    return signal?.aborted === true;
  } catch {
    return true;
  }
}

async function yieldAndCheck(controls: SnapshotPlanControls): Promise<void> {
  if (cancelled(controls.signal)) throw new ControlledPlanFailure('cancelled');
  try {
    await controls.yieldTask();
  } catch {
    throw new ControlledPlanFailure('derived-branch-html-plan-measurement-failed');
  }
  if (cancelled(controls.signal)) throw new ControlledPlanFailure('cancelled');
}

function ownData(value: unknown, expected: readonly string[]): Record<string, unknown> | undefined {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expected.length ||
      keys.some(key => typeof key !== 'string' || !expected.includes(key))
    )
      return undefined;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return undefined;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return undefined;
  }
}

function optionalOwnData(
  value: unknown,
  allowed: readonly string[]
): Record<string, unknown> | undefined {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string' || !allowed.includes(key))) return undefined;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return undefined;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return undefined;
  }
}

function snapshotControls(value: unknown): SnapshotPlanControls | undefined {
  const data = optionalOwnData(value, ['signal', 'yieldTask', 'presentation']);
  if (!data || (data.yieldTask !== undefined && typeof data.yieldTask !== 'function'))
    return undefined;
  let presentation: DerivedHtmlBranchPresentationOptions | undefined;
  if (data.presentation !== undefined) {
    const options = optionalOwnData(data.presentation, ['limits', 'maxBranches']);
    if (!options) return undefined;
    let limits: DerivedHtmlBranchPresentationOptions['limits'];
    if (options.limits !== undefined) {
      const values = optionalOwnData(options.limits, Object.keys(HTML_PRESENTATION_LIMITS));
      if (!values) return undefined;
      limits = Object.freeze({ ...values }) as DerivedHtmlBranchPresentationOptions['limits'];
    }
    presentation = Object.freeze({
      ...(limits !== undefined && { limits }),
      ...(options.maxBranches !== undefined && { maxBranches: options.maxBranches as number }),
    });
  }
  return Object.freeze({
    ...(data.signal !== undefined && { signal: data.signal as AbortSignal }),
    yieldTask: (data.yieldTask as (() => Promise<void>) | undefined) ?? defaultYield,
    ...(presentation && { presentation }),
  });
}

function snapshotArchiveContext(value: unknown): StructuredArchivePresentationContext | undefined {
  const data = ownData(value, ARCHIVE_CONTEXT_KEYS);
  if (!data) return undefined;
  return Object.freeze({
    source: data.source,
    archive: data.archive,
    captureId: data.captureId,
    conversationKey: data.conversationKey,
    manifest: data.manifest,
    canonical: data.canonical,
    includeToolContent: data.includeToolContent,
  }) as StructuredArchivePresentationContext;
}

function snapshotEvidence(value: unknown): FinalizedFileArchivePresentationEvidence | undefined {
  const data = ownData(value, ['context', 'assetBindings']);
  if (!data) return undefined;
  const context = snapshotArchiveContext(data.context);
  if (!context) return undefined;
  return Object.freeze({
    context,
    assetBindings: data.assetBindings,
  }) as FinalizedFileArchivePresentationEvidence;
}

function snapshotIdentity(
  value: unknown,
  context: StructuredArchivePresentationContext
): DerivedOutputIdentity | undefined {
  const data = ownData(value, ['source', 'captureId', 'conversationKey']);
  if (
    !data ||
    data.source !== context.source ||
    data.captureId !== context.captureId ||
    data.conversationKey !== context.conversationKey
  )
    return undefined;
  return {
    source: data.source as DerivedOutputIdentity['source'],
    captureId: data.captureId as string,
    conversationKey: data.conversationKey as string,
  };
}

function compactArtifact(
  artifact: Readonly<DerivedBranchHtmlArtifact>
): Readonly<DerivedBranchHtmlArtifactMeasurement> {
  const common = {
    schema: artifact.schema,
    transport: artifact.transport,
    kind: artifact.kind,
    relativePath: artifact.relativePath,
    mediaType: artifact.mediaType,
    byteLength: artifact.byteLength,
    sha256: artifact.sha256,
    rendererVersion: artifact.rendererVersion,
    sourceCanonicalSha256: artifact.sourceCanonicalSha256,
    assetBindingSha256: artifact.assetBindingSha256,
  };
  return Object.freeze(
    artifact.role === 'leaf'
      ? { ...common, role: 'leaf' as const, ordinal: artifact.ordinal }
      : { ...common, role: 'index' as const }
  );
}

function exactMessageBytes(value: unknown): Uint8Array {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string')
    throw new ControlledPlanFailure('derived-branch-html-plan-measurement-failed');
  return new TextEncoder().encode(serialized);
}

async function controlledHash(
  bytes: Uint8Array,
  controls: SnapshotPlanControls,
  failureCode:
    | 'derived-branch-html-plan-measurement-failed'
    | 'derived-branch-html-plan-recreate-failed'
): Promise<string> {
  await yieldAndCheck(controls);
  try {
    const digest = await sha256Hex(bytes);
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error();
    if (cancelled(controls.signal)) throw new ControlledPlanFailure('cancelled');
    await yieldAndCheck(controls);
    return digest;
  } catch (error) {
    if (error instanceof ControlledPlanFailure) throw error;
    throw new ControlledPlanFailure(failureCode);
  }
}

async function measureArtifact(
  artifact: Readonly<DerivedBranchHtmlArtifact>,
  identity: DerivedOutputIdentity,
  settingsSnapshot: string,
  controls: SnapshotPlanControls,
  failureCode:
    | 'derived-branch-html-plan-measurement-failed'
    | 'derived-branch-html-plan-recreate-failed'
): Promise<DerivedBranchHtmlDocumentMeasurement> {
  const envelope = buildDerivedBranchHtmlPersistenceEnvelope(identity, artifact, settingsSnapshot);
  if (!envelope) throw new ControlledPlanFailure(failureCode);
  const messageBytes = exactMessageBytes(envelope.message);
  if (messageBytes.byteLength !== envelope.messageByteLength)
    throw new ControlledPlanFailure(failureCode);
  const receiptSha256 = await controlledHash(envelope.receiptBytes, controls, failureCode);
  const envelopeSha256 = await controlledHash(messageBytes, controls, failureCode);
  return Object.freeze({
    artifact: compactArtifact(artifact),
    receipt: Object.freeze({
      relativePath: envelope.receiptRelativePath,
      byteLength: envelope.receiptBytes.byteLength,
      sha256: receiptSha256,
    }),
    envelope: Object.freeze({
      byteLength: envelope.messageByteLength,
      sha256: envelopeSha256,
    }),
  });
}

function sameMeasurement(
  left: DerivedBranchHtmlDocumentMeasurement,
  right: DerivedBranchHtmlDocumentMeasurement
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function rejected(
  code:
    | 'derived-branch-html-plan-input-invalid'
    | 'derived-branch-html-plan-measurement-failed'
    | 'derived-branch-html-plan-budget-exceeded',
  budgetKind?: AllBranchesBudgetKind
): PrepareDerivedBranchHtmlPlanResult {
  return Object.freeze({ state: 'rejected' as const, code, ...(budgetKind && { budgetKind }) });
}

function terminalResult(
  failure: ControlledPlanFailure
): Extract<DerivedBranchHtmlRecreateResult, { state: 'cancelled' | 'failed' }> {
  return failure.code === 'cancelled'
    ? Object.freeze({ state: 'cancelled' as const })
    : Object.freeze({
        state: 'failed' as const,
        code:
          failure.code === 'derived-branch-html-plan-recreate-mismatch'
            ? failure.code
            : 'derived-branch-html-plan-recreate-failed',
      });
}

// eslint-disable-next-line max-lines-per-function -- One closure owns the strictly sequential, sticky recreation cursor.
function preparedPlan(
  session: DerivedHtmlBranchPresentationSession,
  measured: readonly MeasuredDocument[],
  identity: DerivedOutputIdentity,
  settingsSnapshot: string,
  controls: SnapshotPlanControls,
  plannedPhysicalBytes: number,
  plannedHtmlRenderWorkBytes: number
): PreparedDerivedBranchHtmlPlan {
  let position = 0;
  let inFlight = false;
  let terminal: Extract<DerivedBranchHtmlRecreateResult, { state: 'cancelled' | 'failed' }> | null =
    null;
  const facts = measured.slice(0, session.branchCount).map(document => document.fact!);
  const documents = Object.freeze(measured.map(document => document.public));
  return Object.freeze({
    branchCount: session.branchCount,
    branchPointCount: session.branchPointCount,
    documents,
    plannedPhysicalBytes,
    plannedHtmlRenderWorkBytes,
    // eslint-disable-next-line max-lines-per-function -- The guard and cursor must remain in the same closure as the ephemeral body.
    async recreateNext(): Promise<DerivedBranchHtmlRecreateResult> {
      if (terminal) return terminal;
      if (inFlight) {
        terminal = Object.freeze({
          state: 'failed' as const,
          code: 'derived-branch-html-plan-recreate-failed' as const,
        });
        return terminal;
      }
      if (position >= measured.length) return Object.freeze({ state: 'complete' as const });
      inFlight = true;
      try {
        await yieldAndCheck(controls);
        if (terminal) return terminal;
        const built =
          position < session.branchCount
            ? (await session.buildLeaf(position + 1)).artifact
            : await session.buildIndex(facts);
        if (terminal) return terminal;
        if (cancelled(controls.signal)) throw new ControlledPlanFailure('cancelled');
        await yieldAndCheck(controls);
        if (terminal) return terminal;
        const recreated = await measureArtifact(
          built,
          identity,
          settingsSnapshot,
          controls,
          'derived-branch-html-plan-recreate-failed'
        );
        if (terminal) return terminal;
        if (!sameMeasurement(measured[position].public, recreated))
          throw new ControlledPlanFailure('derived-branch-html-plan-recreate-mismatch');
        const result = Object.freeze({
          state: 'ready' as const,
          position,
          measurement: measured[position].public,
          artifact: built,
        });
        position += 1;
        return result;
      } catch (error) {
        if (terminal) return terminal;
        terminal = terminalResult(
          error instanceof ControlledPlanFailure
            ? error
            : new ControlledPlanFailure('derived-branch-html-plan-recreate-failed')
        );
        return terminal;
      } finally {
        inFlight = false;
      }
    },
  });
}

/**
 * Measures leaves then index exactly once and reserves the complete HTML bundle atomically.
 * No output dispatch, retry, rollback, caller path, target, or completion authority exists here.
 */
// eslint-disable-next-line max-lines-per-function, complexity -- One fail-closed pass owns measurement and its atomic budget release point.
export async function prepareDerivedBranchHtmlPlan(
  finalizedFileEvidence: FinalizedFileArchivePresentationEvidence,
  expectedIdentity: DerivedOutputIdentity,
  expectedSyncSettingsSnapshot: string,
  budget: ExactPresentationBudget,
  controls: DerivedBranchHtmlPlanControls = {}
): Promise<PrepareDerivedBranchHtmlPlanResult> {
  try {
    const detachedControls = snapshotControls(controls);
    const evidence = snapshotEvidence(finalizedFileEvidence);
    if (
      !detachedControls ||
      !evidence ||
      !(budget instanceof ExactPresentationBudget) ||
      !isSerializedSyncSettingsSnapshot(expectedSyncSettingsSnapshot)
    )
      return rejected('derived-branch-html-plan-input-invalid');
    const identity = snapshotIdentity(expectedIdentity, evidence.context);
    if (!identity) return rejected('derived-branch-html-plan-input-invalid');
    const initialBudget = budget.preflightHtmlBundle(0, 0);
    if (initialBudget) return rejected('derived-branch-html-plan-budget-exceeded', initialBudget);
    if (cancelled(detachedControls.signal)) return Object.freeze({ state: 'cancelled' as const });
    await yieldAndCheck(detachedControls);
    const session = await prepareDerivedHtmlBranchPresentationSession(
      evidence.context,
      evidence.assetBindings,
      detachedControls.presentation
    );
    await yieldAndCheck(detachedControls);
    const measured: MeasuredDocument[] = [];
    let artifactBytes = 0;
    let receiptBytes = 0;
    const facts: HtmlBranchRenderFact[] = [];
    for (let ordinal = 1; ordinal <= session.branchCount; ordinal += 1) {
      await yieldAndCheck(detachedControls);
      const built = await session.buildLeaf(ordinal);
      await yieldAndCheck(detachedControls);
      const measurement = await measureArtifact(
        built.artifact,
        identity,
        expectedSyncSettingsSnapshot,
        detachedControls,
        'derived-branch-html-plan-measurement-failed'
      );
      artifactBytes = checkedAdd(
        artifactBytes,
        measurement.artifact.byteLength,
        'planned HTML artifact bytes'
      );
      receiptBytes = checkedAdd(
        receiptBytes,
        measurement.receipt.byteLength,
        'planned HTML receipt bytes'
      );
      const exceeded = budget.preflightHtmlBundle(artifactBytes, receiptBytes);
      if (exceeded)
        throw new ControlledPlanFailure('derived-branch-html-plan-budget-exceeded', exceeded);
      facts.push(built.fact);
      measured.push(Object.freeze({ public: measurement, fact: built.fact }));
      await yieldAndCheck(detachedControls);
    }
    const index = await session.buildIndex(facts);
    await yieldAndCheck(detachedControls);
    const indexMeasurement = await measureArtifact(
      index,
      identity,
      expectedSyncSettingsSnapshot,
      detachedControls,
      'derived-branch-html-plan-measurement-failed'
    );
    artifactBytes = checkedAdd(
      artifactBytes,
      indexMeasurement.artifact.byteLength,
      'planned HTML artifact bytes'
    );
    receiptBytes = checkedAdd(
      receiptBytes,
      indexMeasurement.receipt.byteLength,
      'planned HTML receipt bytes'
    );
    const exceeded = budget.addHtmlBundle(artifactBytes, receiptBytes);
    if (exceeded)
      throw new ControlledPlanFailure('derived-branch-html-plan-budget-exceeded', exceeded);
    measured.push(Object.freeze({ public: indexMeasurement }));
    return Object.freeze({
      state: 'prepared' as const,
      plan: preparedPlan(
        session,
        measured,
        identity,
        expectedSyncSettingsSnapshot,
        detachedControls,
        budget.totalPhysicalBytes,
        budget.totalHtmlRenderWorkBytes
      ),
    });
  } catch (error) {
    if (error instanceof ControlledPlanFailure) {
      if (error.code === 'cancelled') return Object.freeze({ state: 'cancelled' as const });
      if (error.code === 'derived-branch-html-plan-budget-exceeded')
        return rejected(error.code, error.budgetKind);
      return rejected(
        error.code === 'derived-branch-html-plan-input-invalid'
          ? error.code
          : 'derived-branch-html-plan-measurement-failed'
      );
    }
    return rejected('derived-branch-html-plan-measurement-failed');
  }
}
