// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { getArchiveBranchCatalog, type LiskaThreadArchive } from '../../src/archive';
import {
  persistAllBranchesPresentation,
  prepareAllBranchesPersistence,
  type AllBranchesPersistenceDependencies,
} from '../../src/content/archive-branch-persistence';
import { prepareDerivedBranchHtmlPlan } from '../../src/content/derived-branch-html-plan';
import { buildFinalizedFileArchivePresentationEvidence } from '../../src/content/finalized-html-assets';
import { retainStructuredArchivePresentation } from '../../src/content/structured-presentation';
import { buildChatGptDestinationArchiveReceipt } from '../../src/content/chatgpt-destination-receipt';
import { buildDerivedBranchHtmlPersistResponse } from '../../src/lib/derived-branch-persistence-contract';
import { createOperationWriteLedger } from '../../src/lib/operation-write-ledger';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import { serializeSyncSettingsSnapshot } from '../../src/lib/sync-settings-snapshot';
import type {
  AllBranchesPresentationPlan,
  ArchiveCompanionBundle,
  PersistentOutputDestination,
  TemplateOptions,
  DurableWriteOutcome,
} from '../../src/lib/types';
import fixture from '../fixtures/archive/branching-chatgpt-thread.json';

const settings = serializeSyncSettingsSnapshot(DEFAULT_SYNC_SETTINGS);
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const template: TemplateOptions = {
  includeId: true,
  includeTitle: true,
  includeTags: true,
  includeSource: true,
  includeDates: true,
  includeMessageCount: true,
  messageFormat: 'callout',
  userCalloutType: 'QUESTION',
  assistantCalloutType: 'NOTE',
};
function observed(
  html: DurableWriteOutcome = { state: 'confirmed' },
  receipt: DurableWriteOutcome = { state: 'confirmed' }
) {
  return {
    state: 'observed' as const,
    response: buildDerivedBranchHtmlPersistResponse(html, receipt),
  };
}

async function setup() {
  const archive = structuredClone(fixture) as LiskaThreadArchive;
  archive.inputs[0].captureId = 'capture-chatgpt-11111111-2222-4333-8444-555555555555';
  archive.inputs[0].manifestSha256 = digest('{}');
  for (const asset of Object.values(archive.assets)) {
    asset.acquisition = { state: 'not-attempted', attemptedAt: null, detail: null };
  }
  const canonical = JSON.stringify(archive, null, 2);
  const companion: ArchiveCompanionBundle = {
    captureId: archive.inputs[0].captureId,
    conversationKey: 'c'.repeat(64),
    artifacts: (['raw', 'manifest', 'canonical'] as const).map(kind => ({
      kind,
      relativePath:
        kind === 'raw'
          ? 'responses/conversation.json'
          : kind === 'manifest'
            ? 'manifest.json'
            : 'canonical/liska-thread-1.json',
      mediaType: 'application/json',
      byteLength: kind === 'canonical' ? Buffer.byteLength(canonical) : 2,
      sha256: kind === 'canonical' ? digest(canonical) : digest('{}'),
      bodyBase64: Buffer.from(kind === 'canonical' ? canonical : '{}').toString('base64'),
    })),
  };
  const context = retainStructuredArchivePresentation({
    source: 'chatgpt',
    archive,
    archiveCompanion: companion,
    includeToolContent: true,
  })!;
  const plan: AllBranchesPresentationPlan = {
    archive,
    catalog: getArchiveBranchCatalog(archive),
    structuredArchivePresentationContext: context,
  };
  const evidence = (await buildFinalizedFileArchivePresentationEvidence(
    context,
    archive,
    companion,
    []
  ))!;
  const events: string[] = [];
  const persistArtifacts = vi.fn(
    async (_bundle, _name, _source, outputs: PersistentOutputDestination[]) => {
      events.push(`archive:${outputs[0]}`);
      return { activeOutputs: outputs, warnings: [] };
    }
  );
  const writeNote = vi.fn(async (_note, destination) => {
    events.push(`markdown:${destination}`);
    return 'confirmed' as const;
  });
  const sender = vi.fn(async (_identity, artifact, _settings) => {
    void _settings;
    events.push(`html:${artifact.role}`);
    return observed();
  });
  const builder = vi.fn(buildFinalizedFileArchivePresentationEvidence);
  const dependencies: AllBranchesPersistenceDependencies = {
    persistArtifacts,
    writeNote,
    fingerprintNote: async note => ({
      byteLength: Buffer.byteLength(JSON.stringify(note)),
      sha256: digest(JSON.stringify(note)),
    }),
    yieldTask: async () => {},
    fileHtml: { expectedSyncSettingsSnapshot: settings },
    persistDerivedBranchHtmlArtifactForFile: sender,
    buildFinalizedFileArchivePresentationEvidence: builder,
  };
  const run = (outputs: ('file' | 'obsidian')[] = ['file']) =>
    persistAllBranchesPresentation(plan, companion, template, true, outputs, dependencies);
  const supply = () => {
    dependencies.destinationReceipts = ['file', 'obsidian'].map(destination =>
      buildChatGptDestinationArchiveReceipt(
        companion,
        destination as PersistentOutputDestination,
        []
      )
    );
    dependencies.fileHtml = {
      expectedSyncSettingsSnapshot: settings,
      fileArchivePresentation: evidence,
    };
  };
  return {
    archive,
    companion,
    plan,
    evidence,
    dependencies,
    run,
    supply,
    events,
    persistArtifacts,
    writeNote,
    sender,
    builder,
  };
}

describe('all-branches File HTML runner', () => {
  it('uses real finalized evidence only after File trio and dispatches Markdown before two leaves and index', async () => {
    const s = await setup();
    s.builder.mockImplementation(async (...args) => {
      expect(s.events).toEqual(['archive:file', 'archive:obsidian']);
      expect(args[0]).toBe(s.plan.structuredArchivePresentationContext);
      expect(args[1]).toBe(s.archive);
      expect(args[2]).toEqual(s.companion);
      expect(args[3]).toEqual([]);
      return buildFinalizedFileArchivePresentationEvidence(...args);
    });
    const result = await s.run(['file', 'obsidian']);
    expect(result.status).toBe('complete');
    expect(result.allSuccessful).toBe(true);
    expect(s.sender).toHaveBeenCalledTimes(3);
    expect(s.events.slice(-3)).toEqual(['html:leaf', 'html:leaf', 'html:index']);
    expect(s.events.filter(event => event.startsWith('markdown:'))).toHaveLength(6);
    expect(s.sender.mock.calls.every(call => call[2] === settings)).toBe(true);
    expect(result.fileHtml).toMatchObject({
      requested: true,
      status: 'complete',
      measuredDocuments: 3,
      recreatedDocuments: 3,
      confirmedLeafPairs: 2,
      indexPair: 'confirmed',
      htmlWrites: { confirmed: 3, failed: 0, unknown: 0, notDispatched: 0 },
      receiptWrites: { confirmed: 3, failed: 0, unknown: 0, notDispatched: 0 },
      unknownBytes: 0,
    });
    expect(result.fileHtml!.confirmedBytes).toBeGreaterThan(0);
    expect(result.plannedPhysicalBytes).toBe(
      result.destinations.reduce((n, row) => n + row.confirmedBytes, 0) +
        result.fileHtml!.confirmedBytes
    );
  });

  it('uses supplied attachment evidence and never rebuilds from the pre-attachment archive', async () => {
    const s = await setup();
    s.supply();
    const prepare = vi.fn(prepareDerivedBranchHtmlPlan);
    s.dependencies.prepareDerivedBranchHtmlPlan = prepare;
    const result = await s.run();
    expect(s.persistArtifacts).not.toHaveBeenCalled();
    expect(s.builder).not.toHaveBeenCalled();
    expect(prepare.mock.calls[0][0]).toEqual(s.evidence);
    expect(prepare.mock.calls[0][0]).not.toBe(s.evidence);
    expect(result.fileHtml?.status).toBe('complete');
  });

  it.each(['supplied-missing', 'context-missing', 'builder-throws', 'file-trio-failed'] as const)(
    'keeps Markdown independent when HTML evidence unavailable: %s',
    async mode => {
      const s = await setup();
      if (mode === 'supplied-missing') {
        s.supply();
        s.dependencies.fileHtml = { expectedSyncSettingsSnapshot: settings };
      }
      if (mode === 'context-missing') delete s.plan.structuredArchivePresentationContext;
      if (mode === 'builder-throws') s.builder.mockRejectedValue(new Error('PRIVATE'));
      if (mode === 'file-trio-failed')
        s.persistArtifacts.mockImplementation(async (_a, _b, _c, outputs) => ({
          activeOutputs: outputs.includes('file') ? [] : outputs,
          warnings: [],
        }));
      const result = await s.run(['file', 'obsidian']);
      expect(result.status).toBe('partial');
      expect(result.allSuccessful).toBe(false);
      expect(result.destinations.find(row => row.destination === 'obsidian')?.indexSaved).toBe(
        true
      );
      expect(result.fileHtml?.status).toBe('failed');
      expect(s.sender).not.toHaveBeenCalled();
      if (mode !== 'builder-throws') expect(s.builder).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    }
  );

  it('rejects opt-in mismatch before archive writes', async () => {
    const s = await setup();
    s.dependencies.prepared = prepareAllBranchesPersistence(s.plan, s.companion, template, true, [
      'file',
    ]);
    await expect(s.run()).rejects.toThrow('structural preflight');
    expect(s.persistArtifacts).not.toHaveBeenCalled();
    expect(s.writeNote).not.toHaveBeenCalled();
    s.dependencies.prepared = prepareAllBranchesPersistence(
      s.plan,
      s.companion,
      template,
      true,
      ['file'],
      false,
      true
    );
    delete s.dependencies.fileHtml;
    await expect(s.run()).rejects.toThrow('structural preflight');
  });

  it('rejects 512 leaves + two Markdown destinations + HTML at 2052 writes before persistence', async () => {
    const s = await setup();
    const parent = s.archive.graph.nodes['node-user'];
    const prototype = structuredClone(s.archive.graph.nodes['node-alternate']);
    parent.childIds = [];
    delete s.archive.graph.nodes['node-current'];
    delete s.archive.graph.nodes['node-alternate'];
    s.archive.assets = {};
    for (let i = 0; i < 512; i++) {
      const node = structuredClone(prototype);
      node.id = `leaf-${i}`;
      node.message!.id = `message-${i}`;
      s.archive.graph.nodes[node.id] = node;
      parent.childIds.push(node.id);
    }
    s.archive.conversation.currentNodeId = 'leaf-0';
    s.plan.catalog = getArchiveBranchCatalog(s.archive);
    s.dependencies.destinationReceipts = [];
    const result = await s.run(['file', 'obsidian']);
    expect(result).toMatchObject({
      status: 'rejected',
      budgetKind: 'planned-artifact-writes',
      plannedArtifactWrites: 2052,
    });
    expect(s.persistArtifacts).not.toHaveBeenCalled();
    expect(s.writeNote).not.toHaveBeenCalled();
    expect(s.sender).not.toHaveBeenCalled();
  });

  it('rejects a real combined physical budget before the first Markdown write', async () => {
    const s = await setup();
    s.supply();
    const ledger = createOperationWriteLedger(s.companion.captureId);
    let trioBytes = 0;
    for (const artifact of s.companion.artifacts) {
      const attempt = ledger.begin('file', artifact.kind, artifact.byteLength);
      attempt.issue();
      attempt.observe({ state: 'confirmed' });
      trioBytes += artifact.byteLength;
    }
    const binary = ledger.begin('file', 'binary', 2 * 1024 ** 3 - trioBytes - 1000);
    binary.issue();
    binary.observe({ state: 'confirmed' });
    s.dependencies.writeLedgerSnapshot = ledger.snapshot();
    s.dependencies.fingerprintNote = async () => ({ byteLength: 1, sha256: 'e'.repeat(64) });
    const result = await s.run();
    expect(result).toMatchObject({
      status: 'rejected',
      budgetKind: 'physical-planned-bytes',
      measuredLeaves: 2,
    });
    expect(result.fileHtml).toMatchObject({
      status: 'rejected',
      budgetKind: 'physical-planned-bytes',
    });
    expect(s.writeNote).not.toHaveBeenCalled();
    expect(s.sender).not.toHaveBeenCalled();
  });

  it.each(['leaf-failed', 'not-dispatched', 'receipt-failed'] as const)(
    'continues independent leaves but never recreates index after %s',
    async mode => {
      const s = await setup();
      const observation =
        mode === 'leaf-failed'
          ? observed({ state: 'not-dispatched' }, { state: 'not-dispatched' })
          : mode === 'receipt-failed'
            ? observed({ state: 'confirmed' }, { state: 'not-dispatched' })
            : { state: 'not-dispatched' as const };
      s.dependencies.persistDerivedBranchHtmlArtifactForFile = vi
        .fn()
        .mockResolvedValueOnce(observation)
        .mockResolvedValue(observed());
      const result = await s.run();
      expect(result.status).toBe('partial');
      expect(s.dependencies.persistDerivedBranchHtmlArtifactForFile).toHaveBeenCalledTimes(2);
      expect(result.fileHtml).toMatchObject({
        status: 'partial',
        recreatedDocuments: 2,
        confirmedLeafPairs: 1,
        indexPair: 'not-dispatched',
        htmlWrites: { confirmed: mode === 'receipt-failed' ? 2 : 1, unknown: 0 },
        receiptWrites: { confirmed: 1, unknown: 0 },
      });
    }
  );

  it.each(['transport', 'html', 'receipt'] as const)(
    'stops later File HTML after %s unknown without downgrading confirmed writes',
    async mode => {
      const s = await setup();
      const observation =
        mode === 'transport'
          ? { state: 'unconfirmed' as const }
          : mode === 'html'
            ? observed({ state: 'unknown', cleanupDeferred: true }, { state: 'not-dispatched' })
            : observed({ state: 'confirmed' }, { state: 'unknown', cleanupDeferred: true });
      const sender = vi.fn().mockResolvedValue(observation);
      s.dependencies.persistDerivedBranchHtmlArtifactForFile = sender;
      const result = await s.run(['file', 'obsidian']);
      expect(sender).toHaveBeenCalledTimes(1);
      expect(result.destinations.every(row => row.indexSaved)).toBe(true);
      expect(result.fileHtml).toMatchObject({
        status: 'partial',
        reason: 'write-unknown',
        recreatedDocuments: 1,
        indexPair: 'not-dispatched',
        htmlWrites: { confirmed: mode === 'receipt' ? 1 : 0, unknown: mode === 'receipt' ? 0 : 1 },
        receiptWrites: { unknown: mode === 'html' ? 0 : 1 },
        cleanupDeferred: mode === 'transport' ? 0 : 1,
      });
      expect(result.fileHtml!.unknownBytes).toBeGreaterThan(0);
    }
  );

  it('records an in-flight confirmed pair even if Stop happens before its observation', async () => {
    const s = await setup();
    const controller = new AbortController();
    s.dependencies.signal = controller.signal;
    s.sender.mockImplementation(async () => {
      controller.abort();
      await Promise.resolve();
      return observed();
    });
    const result = await s.run();
    expect(result).toMatchObject({
      status: 'cancelled',
      cancelRequested: true,
      allSuccessful: false,
    });
    expect(result.fileHtml).toMatchObject({
      status: 'cancelled',
      confirmedLeafPairs: 1,
      htmlWrites: { confirmed: 1 },
      receiptWrites: { confirmed: 1 },
      cancelRequested: true,
    });
    expect(s.sender).toHaveBeenCalledTimes(1);
  });

  it('cancels real HTML measurement before any presentation write', async () => {
    const s = await setup();
    const controller = new AbortController();
    s.dependencies.signal = controller.signal;
    s.dependencies.prepareDerivedBranchHtmlPlan = (
      evidence,
      identity,
      snapshot,
      budget,
      controls
    ) =>
      prepareDerivedBranchHtmlPlan(evidence, identity, snapshot, budget, {
        ...controls,
        yieldTask: async () => {
          controller.abort();
        },
      });
    const result = await s.run();
    expect(result.status).toBe('cancelled');
    expect(result.fileHtml?.cancelRequested).toBe(true);
    expect(s.writeNote).not.toHaveBeenCalled();
    expect(s.sender).not.toHaveBeenCalled();
  });

  it('cancels after recreation without dispatching its ready body', async () => {
    const s = await setup();
    const controller = new AbortController();
    s.dependencies.signal = controller.signal;
    s.dependencies.prepareDerivedBranchHtmlPlan = async (...args) => {
      const result = await prepareDerivedBranchHtmlPlan(...args);
      if (result.state !== 'prepared') return result;
      return {
        state: 'prepared',
        plan: {
          ...result.plan,
          recreateNext: async () => {
            const ready = await result.plan.recreateNext();
            controller.abort();
            return ready;
          },
        },
      };
    };
    const result = await s.run();
    expect(result.status).toBe('cancelled');
    expect(result.fileHtml?.recreatedDocuments).toBe(1);
    expect(s.sender).not.toHaveBeenCalled();
    expect(result.destinations[0].indexSaved).toBe(true);
  });

  it.each(['unknown', 'failed'] as const)(
    'keeps Markdown destinations independent and handles File Markdown %s',
    async outcome => {
      const s = await setup();
      s.dependencies.writeNote = vi.fn(async (_note, destination) =>
        destination === 'file' ? outcome : 'confirmed'
      );
      const result = await s.run(['file', 'obsidian']);
      expect(result.status).toBe('partial');
      expect(result.destinations.find(row => row.destination === 'obsidian')?.indexSaved).toBe(
        true
      );
      expect(s.sender).toHaveBeenCalledTimes(outcome === 'unknown' ? 0 : 3);
      expect(result.fileHtml?.status).toBe(outcome === 'unknown' ? 'failed' : 'complete');
      if (outcome === 'unknown') expect(result.fileHtml?.reason).toBe('file-markdown-unknown');
    }
  );

  it('retains the originally captured settings string for every send', async () => {
    const s = await setup();
    s.persistArtifacts.mockImplementation(async (_a, _b, _c, outputs) => {
      s.dependencies.fileHtml = { expectedSyncSettingsSnapshot: 'CHANGED' };
      return { activeOutputs: outputs, warnings: [] };
    });
    const result = await s.run();
    expect(result.fileHtml?.status).toBe('complete');
    expect(s.sender.mock.calls.every(call => call[2] === settings)).toBe(true);
  });

  it('snapshots a stateful request once without executing ordinary property reads', async () => {
    const s = await setup();
    s.supply();
    const reads = vi.fn(() => {
      throw new Error('PRIVATE getter');
    });
    const descriptors = vi.fn((target, key) => Reflect.getOwnPropertyDescriptor(target, key));
    s.dependencies.fileHtml = new Proxy(s.dependencies.fileHtml!, {
      get: reads,
      getOwnPropertyDescriptor: descriptors,
    });
    const result = await s.run();
    expect(result.fileHtml?.status).toBe('complete');
    expect(reads).not.toHaveBeenCalled();
    expect(
      descriptors.mock.calls.filter(call => call[1] === 'expectedSyncSettingsSnapshot')
    ).toHaveLength(1);
    expect(
      descriptors.mock.calls.filter(call => call[1] === 'fileArchivePresentation')
    ).toHaveLength(1);
    expect(s.sender.mock.calls.every(call => call[2] === settings)).toBe(true);
  });

  it('rejects accessor-bearing HTML requests without running getters or writes', async () => {
    const s = await setup();
    const getter = vi.fn(() => settings);
    s.dependencies.fileHtml = Object.defineProperty({}, 'expectedSyncSettingsSnapshot', {
      enumerable: true,
      get: getter,
    }) as NonNullable<AllBranchesPersistenceDependencies['fileHtml']>;
    await expect(s.run()).rejects.toThrow('All-branches HTML request is invalid.');
    expect(getter).not.toHaveBeenCalled();
    expect(s.persistArtifacts).not.toHaveBeenCalled();
    expect(s.writeNote).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'binds supplied final evidence B to its exact receipt, independent of old companion A: matching=%s',
    async matching => {
      const s = await setup();
      s.supply();
      const finalArchive = structuredClone(s.archive);
      finalArchive.conversation.title += ' finalized destination archive B';
      finalArchive.inputs[0].manifestSha256 = digest('{"final":true}');
      const canonical = JSON.stringify(finalArchive, null, 2);
      const finalCompanion = structuredClone(s.companion);
      Object.assign(finalCompanion.artifacts.find(item => item.kind === 'manifest')!, {
        sha256: finalArchive.inputs[0].manifestSha256,
        byteLength: Buffer.byteLength('{"final":true}'),
        bodyBase64: Buffer.from('{"final":true}').toString('base64'),
      });
      Object.assign(finalCompanion.artifacts.find(item => item.kind === 'canonical')!, {
        sha256: digest(canonical),
        byteLength: Buffer.byteLength(canonical),
        bodyBase64: Buffer.from(canonical).toString('base64'),
      });
      const evidence = await buildFinalizedFileArchivePresentationEvidence(
        s.plan.structuredArchivePresentationContext!,
        finalArchive,
        finalCompanion,
        []
      );
      expect(evidence).toBeDefined();
      s.dependencies.fileHtml = {
        expectedSyncSettingsSnapshot: settings,
        fileArchivePresentation: evidence,
      };
      if (matching)
        s.dependencies.destinationReceipts = [
          buildChatGptDestinationArchiveReceipt(finalCompanion, 'file', []),
        ];
      const prepare = vi.fn(prepareDerivedBranchHtmlPlan);
      s.dependencies.prepareDerivedBranchHtmlPlan = prepare;
      const result = await s.run();
      expect(result.destinations[0].indexSaved).toBe(true);
      expect(s.builder).not.toHaveBeenCalled();
      if (matching) {
        expect(result.status).toBe('complete');
        expect(s.sender).toHaveBeenCalledTimes(3);
        expect(prepare.mock.calls[0][0].context.canonical.byteLength).toBe(
          Buffer.byteLength(canonical)
        );
      } else {
        expect(result.status).toBe('partial');
        expect(result.fileHtml).toMatchObject({ status: 'failed', reason: 'evidence-unavailable' });
        expect(prepare).not.toHaveBeenCalled();
        expect(s.sender).not.toHaveBeenCalled();
      }
    }
  );

  it('refuses supplied asset bindings absent from the accepted File receipt before B3a preparation', async () => {
    const s = await setup();
    s.supply();
    s.dependencies.fileHtml = {
      expectedSyncSettingsSnapshot: settings,
      fileArchivePresentation: {
        context: s.evidence.context,
        assetBindings: {
          sha256: 'a'.repeat(64),
          bindings: [
            {
              assetId: 'asset-other',
              path: `assets/${'b'.repeat(64)}.png`,
              sha256: 'b'.repeat(64),
              mimeType: 'image/png',
              byteLength: 5,
              renderMode: 'image',
            },
          ],
        },
      },
    };
    const prepare = vi.fn(prepareDerivedBranchHtmlPlan);
    s.dependencies.prepareDerivedBranchHtmlPlan = prepare;
    const result = await s.run();
    expect(result.destinations[0].indexSaved).toBe(true);
    expect(result.fileHtml?.reason).toBe('evidence-unavailable');
    expect(prepare).not.toHaveBeenCalled();
    expect(s.sender).not.toHaveBeenCalled();
  });

  it('passes only the detached reconciled evidence to real B3a after a stateful evidence Proxy', async () => {
    const s = await setup();
    s.supply();
    const reads = new Map<string | symbol, number>();
    const evidence = new Proxy(
      { ...s.evidence },
      {
        get() {
          throw new Error('ordinary evidence read');
        },
        getOwnPropertyDescriptor(target, key) {
          const count = (reads.get(key) ?? 0) + 1;
          reads.set(key, count);
          if (count > 1) throw new Error('second capability read');
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      }
    );
    s.dependencies.fileHtml = {
      expectedSyncSettingsSnapshot: settings,
      fileArchivePresentation: evidence,
    };
    const prepare = vi.fn(prepareDerivedBranchHtmlPlan);
    s.dependencies.prepareDerivedBranchHtmlPlan = prepare;
    const result = await s.run();
    expect(result.status).toBe('complete');
    expect(s.sender).toHaveBeenCalledTimes(3);
    expect([...reads.values()]).toEqual([1, 1]);
    expect(prepare.mock.calls[0][0] === evidence).toBe(false);
    expect(prepare.mock.calls[0][0]).toEqual(s.evidence);
  });

  it.each(['outer', 'observed'] as const)(
    'counts %s non-dispatch as no physical write, with all leaves attempted but no index recreation',
    async form => {
      const s = await setup();
      const sender = vi
        .fn()
        .mockResolvedValue(
          form === 'outer'
            ? { state: 'not-dispatched' }
            : observed({ state: 'not-dispatched' }, { state: 'not-dispatched' })
        );
      s.dependencies.persistDerivedBranchHtmlArtifactForFile = sender;
      const result = await s.run();
      expect(sender).toHaveBeenCalledTimes(2);
      expect(result.fileHtml).toMatchObject({
        status: 'failed',
        recreatedDocuments: 2,
        confirmedBytes: 0,
        unknownBytes: 0,
        htmlWrites: { confirmed: 0, failed: 0, unknown: 0, notDispatched: 3 },
        receiptWrites: { confirmed: 0, failed: 0, unknown: 0, notDispatched: 3 },
        indexPair: 'not-dispatched',
      });
    }
  );

  it('keeps a confirmed index HTML when its receipt is not dispatched', async () => {
    const s = await setup();
    s.sender
      .mockResolvedValueOnce(observed())
      .mockResolvedValueOnce(observed())
      .mockResolvedValueOnce(
        observed({ state: 'confirmed', cleanupDeferred: true }, { state: 'not-dispatched' })
      );
    const result = await s.run();
    expect(result.fileHtml).toMatchObject({
      status: 'partial',
      confirmedLeafPairs: 2,
      indexPair: 'failed',
      htmlWrites: { confirmed: 3 },
      receiptWrites: { confirmed: 2, notDispatched: 1 },
      cleanupDeferred: 1,
    });
  });

  it('records both unknown writes from a thrown in-flight send and honors simultaneous cancellation', async () => {
    const s = await setup();
    const controller = new AbortController();
    s.dependencies.signal = controller.signal;
    s.sender.mockImplementation(async () => {
      controller.abort();
      throw new Error('PRIVATE network');
    });
    const result = await s.run();
    expect(s.sender).toHaveBeenCalledTimes(1);
    expect(result.fileHtml).toMatchObject({
      status: 'cancelled',
      cancelRequested: true,
      htmlWrites: { unknown: 1 },
      receiptWrites: { unknown: 1 },
    });
    expect(result.fileHtml!.unknownBytes).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('cancels in the post-recreation yield before sending the artifact', async () => {
    const s = await setup();
    const controller = new AbortController();
    s.dependencies.signal = controller.signal;
    let ready = false;
    s.dependencies.prepareDerivedBranchHtmlPlan = async (...args) => {
      const result = await prepareDerivedBranchHtmlPlan(...args);
      if (result.state !== 'prepared') return result;
      return {
        state: 'prepared',
        plan: {
          ...result.plan,
          recreateNext: async () => {
            const artifact = await result.plan.recreateNext();
            ready = true;
            return artifact;
          },
        },
      };
    };
    s.dependencies.yieldTask = async () => {
      if (ready) controller.abort();
    };
    const result = await s.run();
    expect(result.fileHtml).toMatchObject({ status: 'cancelled', recreatedDocuments: 1 });
    expect(s.sender).not.toHaveBeenCalled();
  });

  it('treats non-budget plan failure as HTML-only and never leaks its exception', async () => {
    const s = await setup();
    s.dependencies.prepareDerivedBranchHtmlPlan = async () => {
      throw new Error('PRIVATE');
    };
    const result = await s.run();
    expect(result.status).toBe('partial');
    expect(result.destinations[0].indexSaved).toBe(true);
    expect(result.fileHtml).toMatchObject({ status: 'failed', reason: 'preparation-failed' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('preserves the exact legacy summary shape and does no HTML work without opt-in', async () => {
    const s = await setup();
    delete s.dependencies.fileHtml;
    const result = await s.run();
    expect(result.version).toBe(1);
    expect(result.status).toBe('complete');
    expect(result.allSuccessful).toBe(true);
    expect(Object.keys(result)).not.toContain('fileHtml');
    expect(result.plannedArtifactWrites).toBe(6);
    expect(s.builder).not.toHaveBeenCalled();
    expect(s.sender).not.toHaveBeenCalled();
  });
});
