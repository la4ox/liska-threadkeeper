// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { LiskaThreadArchive } from '../../src/archive';
import {
  ALL_BRANCHES_BUDGET_LIMITS,
  ExactPresentationBudget,
} from '../../src/content/archive-branch-budget';
import { prepareDerivedBranchHtmlPlan } from '../../src/content/derived-branch-html-plan';
import { buildDerivedBranchHtmlPersistenceEnvelope } from '../../src/content/derived-branch-html-persistence';
import type { FinalizedFileArchivePresentationEvidence } from '../../src/content/finalized-html-assets';
import { retainStructuredArchivePresentation } from '../../src/content/structured-presentation';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import { serializeSyncSettingsSnapshot } from '../../src/lib/sync-settings-snapshot';
import type { ArchiveCompanionArtifact, ArchiveCompanionBundle } from '../../src/lib/types';
import fixture from '../fixtures/archive/branching-chatgpt-thread.json';

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const settingsSnapshot = serializeSyncSettingsSnapshot(DEFAULT_SYNC_SETTINGS);
const conversationKey = 'c'.repeat(64);

function companion(
  archive: LiskaThreadArchive,
  ownedConversationKey = conversationKey
): ArchiveCompanionBundle {
  const canonicalBytes = new TextEncoder().encode(JSON.stringify(archive, null, 2));
  const descriptor = (kind: 'raw' | 'manifest' | 'canonical'): ArchiveCompanionArtifact => ({
    kind,
    relativePath:
      kind === 'raw'
        ? 'responses/conversation.json'
        : kind === 'manifest'
          ? 'manifest.json'
          : 'canonical/liska-thread-1.json',
    mediaType: 'application/json',
    byteLength: kind === 'canonical' ? canonicalBytes.byteLength : 2,
    sha256: kind === 'canonical' ? digest(canonicalBytes) : 'a'.repeat(64),
    transport: 'staged',
    stageId: `PRIVATE-${kind}`,
  });
  return {
    captureId: archive.inputs[0].captureId,
    conversationKey: ownedConversationKey,
    artifacts: [descriptor('raw'), descriptor('manifest'), descriptor('canonical')],
  };
}

function setup(
  options: {
    captureId?: string;
    conversationKey?: string;
    title?: string;
  } = {}
): {
  archive: LiskaThreadArchive;
  evidence: FinalizedFileArchivePresentationEvidence;
  identity: { source: 'chatgpt'; captureId: string; conversationKey: string };
} {
  const archive = structuredClone(fixture) as LiskaThreadArchive;
  archive.conversation.title = options.title ?? 'PRIVATE-TITLE Русский 中文 🦊';
  archive.inputs[0].captureId = options.captureId ?? 'capture-chatgpt-html-plan';
  const context = retainStructuredArchivePresentation({
    source: 'chatgpt',
    archive,
    archiveCompanion: companion(archive, options.conversationKey),
    includeToolContent: true,
  })!;
  return {
    archive,
    evidence: Object.freeze({
      context,
      assetBindings: Object.freeze({ bindings: Object.freeze([]), sha256: null }),
    }),
    identity: {
      source: 'chatgpt',
      captureId: context.captureId,
      conversationKey: context.conversationKey,
    },
  };
}

const noYield = vi.fn(async () => undefined);

describe('prepared all-branches HTML measurement plan', () => {
  it('measures leaves then index without retaining bodies and recreates the exact envelopes', async () => {
    const { evidence, identity } = setup();
    const budget = new ExactPresentationBudget(new Map([['file', 7]]));
    const result = await prepareDerivedBranchHtmlPlan(
      evidence,
      identity,
      settingsSnapshot,
      budget,
      { yieldTask: noYield }
    );
    expect(result.state).toBe('prepared');
    if (result.state !== 'prepared') throw new Error('Expected prepared plan');
    const { plan } = result;
    expect(plan.branchCount).toBe(2);
    expect(plan.documents).toHaveLength(3);
    expect(plan.documents.map(item => item.artifact.role)).toEqual(['leaf', 'leaf', 'index']);
    expect(plan.documents.map(item => item.artifact.relativePath)).toEqual([
      'branch-000001.html',
      'branch-000002.html',
      'branches.html',
    ]);
    expect(JSON.stringify(plan.documents)).not.toContain('bodyBase64');
    expect(JSON.stringify(plan)).not.toContain('PRIVATE-TITLE');
    const bundleBytes = plan.documents.reduce(
      (sum, item) => sum + item.artifact.byteLength + item.receipt.byteLength,
      0
    );
    const renderBytes = plan.documents.reduce((sum, item) => sum + item.artifact.byteLength * 2, 0);
    expect(plan.plannedPhysicalBytes).toBe(7 + bundleBytes);
    expect(plan.plannedHtmlRenderWorkBytes).toBe(renderBytes);
    expect(budget.totalPhysicalBytes).toBe(plan.plannedPhysicalBytes);
    expect(budget.totalHtmlRenderWorkBytes).toBe(renderBytes);

    for (let position = 0; position < plan.documents.length; position += 1) {
      const recreated = await plan.recreateNext();
      expect(recreated.state).toBe('ready');
      if (recreated.state !== 'ready') throw new Error('Expected recreated artifact');
      expect(recreated.position).toBe(position);
      expect(recreated.measurement).toBe(plan.documents[position]);
      expect(recreated.artifact.bodyBase64.length).toBeGreaterThan(0);
      const envelope = buildDerivedBranchHtmlPersistenceEnvelope(
        identity,
        recreated.artifact,
        settingsSnapshot
      )!;
      const messageBytes = new TextEncoder().encode(JSON.stringify(envelope.message));
      expect({
        artifact: recreated.measurement.artifact,
        receipt: {
          relativePath: envelope.receiptRelativePath,
          byteLength: envelope.receiptBytes.byteLength,
          sha256: digest(envelope.receiptBytes),
        },
        envelope: { byteLength: messageBytes.byteLength, sha256: digest(messageBytes) },
      }).toEqual(recreated.measurement);
    }
    expect(await plan.recreateNext()).toEqual({ state: 'complete' });
    expect(await plan.recreateNext()).toEqual({ state: 'complete' });
    expect(noYield).toHaveBeenCalled();
  });

  it('rejects invalid identity/settings before authorizing a plan', async () => {
    const { evidence, identity } = setup();
    for (const [candidateIdentity, snapshot] of [
      [{ ...identity, conversationKey: 'd'.repeat(64) }, settingsSnapshot],
      [identity, '{}'],
    ] as const) {
      const budget = new ExactPresentationBudget(new Map([['file', 0]]));
      expect(
        await prepareDerivedBranchHtmlPlan(evidence, candidateIdentity, snapshot, budget, {
          yieldTask: async () => undefined,
        })
      ).toEqual({ state: 'rejected', code: 'derived-branch-html-plan-input-invalid' });
      expect(budget.totalPhysicalBytes).toBe(0);
    }
  });

  it('binds receipt identity and canonical authorization to the same descriptor snapshot', async () => {
    const first = setup({
      captureId: 'capture-chatgpt-html-plan-a',
      conversationKey: 'a'.repeat(64),
      title: 'PRIVATE-CONTEXT-A',
    });
    const second = setup({
      captureId: 'capture-chatgpt-html-plan-b',
      conversationKey: 'b'.repeat(64),
      title: 'PRIVATE-CONTEXT-B',
    });
    const ordinaryGet = vi.fn((_target: object, key: PropertyKey) =>
      Reflect.get(first.evidence.context, key)
    );
    const context = new Proxy(second.evidence.context, {
      get: ordinaryGet,
    });
    const evidence = {
      context,
      assetBindings: second.evidence.assetBindings,
    } as FinalizedFileArchivePresentationEvidence;

    expect(
      await prepareDerivedBranchHtmlPlan(
        evidence,
        first.identity,
        settingsSnapshot,
        new ExactPresentationBudget(new Map([['file', 0]])),
        { yieldTask: async () => undefined }
      )
    ).toEqual({ state: 'rejected', code: 'derived-branch-html-plan-input-invalid' });

    const prepared = await prepareDerivedBranchHtmlPlan(
      evidence,
      second.identity,
      settingsSnapshot,
      new ExactPresentationBudget(new Map([['file', 0]])),
      { yieldTask: async () => undefined }
    );
    expect(ordinaryGet).not.toHaveBeenCalled();
    expect(prepared.state).toBe('prepared');
    if (prepared.state !== 'prepared') throw new Error('Expected prepared plan');
    const recreated = await prepared.plan.recreateNext();
    expect(recreated.state).toBe('ready');
    if (recreated.state !== 'ready') throw new Error('Expected recreated artifact');
    const envelope = buildDerivedBranchHtmlPersistenceEnvelope(
      second.identity,
      recreated.artifact,
      settingsSnapshot
    )!;
    expect(envelope.receipt.captureId).toBe(second.identity.captureId);
    expect(recreated.artifact.sourceCanonicalSha256).toBe(second.evidence.context.canonical.sha256);
    expect(recreated.artifact.sourceCanonicalSha256).not.toBe(
      first.evidence.context.canonical.sha256
    );
  });

  it('ignores archive-context shell mutation during the first yield', async () => {
    const first = setup({
      captureId: 'capture-chatgpt-html-plan-stable',
      conversationKey: 'c'.repeat(64),
      title: 'PRIVATE-STABLE-CONTEXT',
    });
    const replacement = setup({
      captureId: 'capture-chatgpt-html-plan-replacement',
      conversationKey: 'd'.repeat(64),
      title: 'PRIVATE-REPLACEMENT-CONTEXT',
    });
    const context = { ...first.evidence.context };
    let replaced = false;
    const yieldTask = async () => {
      if (replaced) return;
      replaced = true;
      Object.assign(context, replacement.evidence.context);
    };
    const prepared = await prepareDerivedBranchHtmlPlan(
      { context, assetBindings: first.evidence.assetBindings },
      first.identity,
      settingsSnapshot,
      new ExactPresentationBudget(new Map([['file', 0]])),
      { yieldTask }
    );
    expect(prepared.state).toBe('prepared');
    if (prepared.state !== 'prepared') throw new Error('Expected prepared plan');
    const recreated = await prepared.plan.recreateNext();
    expect(recreated.state).toBe('ready');
    if (recreated.state !== 'ready') throw new Error('Expected recreated artifact');
    expect(recreated.artifact.sourceCanonicalSha256).toBe(first.evidence.context.canonical.sha256);
    const envelope = buildDerivedBranchHtmlPersistenceEnvelope(
      first.identity,
      recreated.artifact,
      settingsSnapshot
    )!;
    expect(envelope.receipt.captureId).toBe(first.identity.captureId);
  });

  it('snapshots the caller-owned controls container once and retains no later mutations', async () => {
    const { evidence, identity } = setup();
    const originalYield = vi.fn(async () => undefined);
    const source = { yieldTask: originalYield };
    const ordinaryGet = vi.fn(() => {
      throw new Error('PRIVATE-CALLER-VALUE');
    });
    const reads = new Map<PropertyKey, number>();
    const controls = new Proxy(source, {
      get: ordinaryGet,
      getOwnPropertyDescriptor(target, key) {
        reads.set(key, (reads.get(key) ?? 0) + 1);
        return Object.getOwnPropertyDescriptor(target, key);
      },
    });
    const prepared = await prepareDerivedBranchHtmlPlan(
      evidence,
      identity,
      settingsSnapshot,
      new ExactPresentationBudget(new Map([['file', 0]])),
      controls
    );
    expect(prepared.state).toBe('prepared');
    expect(ordinaryGet).not.toHaveBeenCalled();
    expect([...reads.values()]).toEqual([1]);
    source.yieldTask = async () => {
      throw new Error('PRIVATE-LATE-MUTATION');
    };
    if (prepared.state !== 'prepared') throw new Error('Expected prepared plan');
    expect((await prepared.plan.recreateNext()).state).toBe('ready');
    expect(originalYield).toHaveBeenCalled();
  });

  it('detaches nested presentation limits before the first yield and ignores late mutation', async () => {
    const { evidence, identity } = setup();
    const limits = { maxHtmlChars: 64 * 1024 * 1024 };
    const presentation = { limits, maxBranches: 2 };
    const yieldTask = vi.fn(async () => {
      limits.maxHtmlChars = 1;
      presentation.maxBranches = 1;
    });
    const prepared = await prepareDerivedBranchHtmlPlan(
      evidence,
      identity,
      settingsSnapshot,
      new ExactPresentationBudget(new Map([['file', 0]])),
      { presentation, yieldTask }
    );
    expect(prepared.state).toBe('prepared');
    if (prepared.state !== 'prepared') throw new Error('Expected prepared plan');
    expect(prepared.plan.branchCount).toBe(2);
    expect(prepared.plan.documents).toHaveLength(3);
    expect(yieldTask).toHaveBeenCalled();
  });

  it('returns closed cancellation before preparation and makes recreation cancellation sticky', async () => {
    const value = setup();
    const cancelled = new AbortController();
    cancelled.abort();
    expect(
      await prepareDerivedBranchHtmlPlan(
        value.evidence,
        value.identity,
        settingsSnapshot,
        new ExactPresentationBudget(new Map([['file', 0]])),
        { signal: cancelled.signal, yieldTask: async () => undefined }
      )
    ).toEqual({ state: 'cancelled' });

    const active = new AbortController();
    const prepared = await prepareDerivedBranchHtmlPlan(
      value.evidence,
      value.identity,
      settingsSnapshot,
      new ExactPresentationBudget(new Map([['file', 0]])),
      { signal: active.signal, yieldTask: async () => undefined }
    );
    if (prepared.state !== 'prepared') throw new Error('Expected prepared plan');
    active.abort();
    expect(await prepared.plan.recreateNext()).toEqual({ state: 'cancelled' });
    expect(await prepared.plan.recreateNext()).toEqual({ state: 'cancelled' });
  });

  it.each([
    ['physical-planned-bytes', { physicalPlannedBytes: 1, htmlRenderWorkBytes: 1_000_000 }],
    ['html-render-work-bytes', { physicalPlannedBytes: 1_000_000, htmlRenderWorkBytes: 1 }],
  ] as const)(
    'fails closed on the shared %s budget without partial reservation',
    async (kind, caps) => {
      const { evidence, identity } = setup();
      const budget = new ExactPresentationBudget(new Map([['file', 0]]), {
        ...ALL_BRANCHES_BUDGET_LIMITS,
        ...caps,
      });
      expect(
        await prepareDerivedBranchHtmlPlan(evidence, identity, settingsSnapshot, budget, {
          yieldTask: async () => undefined,
        })
      ).toEqual({
        state: 'rejected',
        code: 'derived-branch-html-plan-budget-exceeded',
        budgetKind: kind,
      });
      expect(budget.totalPhysicalBytes).toBe(0);
      expect(budget.totalHtmlRenderWorkBytes).toBe(0);
    }
  );

  it('detects source drift on recreation, returns no mismatched body, and never retries', async () => {
    const { archive, evidence, identity } = setup();
    const prepared = await prepareDerivedBranchHtmlPlan(
      evidence,
      identity,
      settingsSnapshot,
      new ExactPresentationBudget(new Map([['file', 0]])),
      { yieldTask: async () => undefined }
    );
    if (prepared.state !== 'prepared') throw new Error('Expected prepared plan');
    const block = archive.graph.nodes['node-user'].message!.blocks[0];
    if (block.type !== 'text') throw new Error('Expected fixture text block');
    block.text = 'PRIVATE-MUTATED-CONTENT';
    expect(await prepared.plan.recreateNext()).toEqual({
      state: 'failed',
      code: 'derived-branch-html-plan-recreate-mismatch',
    });
    expect(await prepared.plan.recreateNext()).toEqual({
      state: 'failed',
      code: 'derived-branch-html-plan-recreate-mismatch',
    });
  });

  it('fails concurrent recreation closed and withholds the first in-flight body too', async () => {
    const { evidence, identity } = setup();
    let block = false;
    let entered!: () => void;
    let release!: () => void;
    const enteredGate = new Promise<void>(resolve => {
      entered = resolve;
    });
    const yieldTask = async () => {
      if (!block) return;
      entered();
      await new Promise<void>(resolve => {
        release = resolve;
      });
    };
    const prepared = await prepareDerivedBranchHtmlPlan(
      evidence,
      identity,
      settingsSnapshot,
      new ExactPresentationBudget(new Map([['file', 0]])),
      { yieldTask }
    );
    if (prepared.state !== 'prepared') throw new Error('Expected prepared plan');
    block = true;
    const first = prepared.plan.recreateNext();
    await enteredGate;
    expect(await prepared.plan.recreateNext()).toEqual({
      state: 'failed',
      code: 'derived-branch-html-plan-recreate-failed',
    });
    release();
    expect(await first).toEqual({
      state: 'failed',
      code: 'derived-branch-html-plan-recreate-failed',
    });
    expect(await prepared.plan.recreateNext()).toEqual({
      state: 'failed',
      code: 'derived-branch-html-plan-recreate-failed',
    });
  });
});
