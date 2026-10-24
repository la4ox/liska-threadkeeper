import { describe, expect, it } from 'vitest';
import {
  ALL_BRANCHES_BUDGET_LIMITS,
  checkedAdd,
  destinationRetainedBytes,
  ExactPresentationBudget,
  structuralBudgetPreflight,
  type ArchiveBranchWorkMetrics,
} from '../../src/content/archive-branch-budget';
import type { ChatGptDestinationArchiveReceipt } from '../../src/lib/chatgpt-archive-receipt';

const atLimits = (): ArchiveBranchWorkMetrics => ({
  nodeCount: ALL_BRANCHES_BUDGET_LIMITS.nodeCount,
  leafCount: ALL_BRANCHES_BUDGET_LIMITS.leafCount,
  branchPointCount: 0,
  pathVisits: ALL_BRANCHES_BUDGET_LIMITS.pathVisits,
  sourceWorkBytes: ALL_BRANCHES_BUDGET_LIMITS.sourceWorkBytes,
});

describe('all-branches budgets', () => {
  it('accepts every exact structural boundary', () => {
    const result = structuralBudgetPreflight(atLimits(), 1, 0, true);
    expect(result).toEqual({
      accepted: true,
      plannedArtifactWrites: ALL_BRANCHES_BUDGET_LIMITS.leafCount + 1,
    });
  });

  it.each([
    ['nodeCount', 'nodes'],
    ['leafCount', 'leaves'],
    ['pathVisits', 'path-visits'],
    ['sourceWorkBytes', 'source-work-bytes'],
  ] as const)('rejects %s at cap + 1', (field, budgetKind) => {
    const base = atLimits();
    const metrics = { ...base, [field]: base[field] + 1 };
    expect(structuralBudgetPreflight(metrics, 1, 0, true)).toMatchObject({
      accepted: false,
      budgetKind,
    });
  });

  it('multiplies companions, leaves and index by durable destination count', () => {
    const metrics = { ...atLimits(), leafCount: 400 };
    const result = structuralBudgetPreflight(metrics, 2, 3, false);
    expect(result.plannedArtifactWrites).toBe(808);
    expect(result.accepted).toBe(true);
    expect(structuralBudgetPreflight(metrics, 3, 300, false)).toMatchObject({
      accepted: false,
      budgetKind: 'planned-artifact-writes',
    });
    expect(
      structuralBudgetPreflight(metrics, 2, 3, false, {
        ...ALL_BRANCHES_BUDGET_LIMITS,
        plannedArtifactWrites: 808,
      }).accepted
    ).toBe(true);
    expect(
      structuralBudgetPreflight(metrics, 2, 3, false, {
        ...ALL_BRANCHES_BUDGET_LIMITS,
        plannedArtifactWrites: 807,
      })
    ).toMatchObject({ accepted: false, budgetKind: 'planned-artifact-writes' });
  });

  it('combines Markdown and File HTML+receipt writes without raising the 2048 ceiling', () => {
    const metrics = { ...atLimits(), leafCount: 512 };
    expect(structuralBudgetPreflight(metrics, 2, 3, true).plannedArtifactWrites).toBe(1026);
    expect(
      structuralBudgetPreflight(metrics, 2, 3, true, ALL_BRANCHES_BUDGET_LIMITS, { file: true })
    ).toEqual({
      accepted: false,
      budgetKind: 'planned-artifact-writes',
      plannedArtifactWrites: 2052,
    });
    expect(
      structuralBudgetPreflight(
        { ...metrics, leafCount: 511 },
        2,
        3,
        true,
        ALL_BRANCHES_BUDGET_LIMITS,
        { file: true }
      )
    ).toEqual({ accepted: true, plannedArtifactWrites: 2048 });
  });

  it('uses checked arithmetic for optional File HTML write accounting', () => {
    expect(() =>
      structuralBudgetPreflight(
        { ...atLimits(), leafCount: Number.MAX_SAFE_INTEGER },
        0,
        0,
        true,
        {
          ...ALL_BRANCHES_BUDGET_LIMITS,
          leafCount: Number.MAX_SAFE_INTEGER,
          plannedArtifactWrites: Number.MAX_SAFE_INTEGER,
        },
        { file: true }
      )
    ).toThrow('safe integer range');
  });

  it('admits the existing 12k-depth and 400-leaf fixture shapes but rejects shared-prefix overflow', () => {
    expect(
      structuralBudgetPreflight(
        {
          nodeCount: 12_000,
          leafCount: 1,
          branchPointCount: 0,
          pathVisits: 12_000,
          sourceWorkBytes: 1,
        },
        1,
        3,
        false
      ).accepted
    ).toBe(true);
    expect(
      structuralBudgetPreflight(
        {
          nodeCount: 2_000,
          leafCount: 400,
          branchPointCount: 1,
          pathVisits: 800_000,
          sourceWorkBytes: 100_000_000,
        },
        1,
        3,
        false
      ).accepted
    ).toBe(true);
    expect(
      structuralBudgetPreflight(
        {
          nodeCount: 2_001,
          leafCount: 400,
          branchPointCount: 1,
          pathVisits: 1_000_001,
          sourceWorkBytes: 100_000_000,
        },
        1,
        3,
        false
      )
    ).toMatchObject({ accepted: false, budgetKind: 'path-visits' });
  });

  it('accepts exact serialized byte boundaries and rejects +1', () => {
    const exact = new ExactPresentationBudget(new Map([['file', 0]]));
    expect(exact.addNote('file', ALL_BRANCHES_BUDGET_LIMITS.individualNoteBytes)).toBeNull();
    const overNote = new ExactPresentationBudget(new Map([['file', 0]]));
    expect(overNote.addNote('file', ALL_BRANCHES_BUDGET_LIMITS.individualNoteBytes + 1)).toBe(
      'individual-note-bytes'
    );

    const logical = new ExactPresentationBudget(new Map([['file', 0]]), {
      ...ALL_BRANCHES_BUDGET_LIMITS,
      individualNoteBytes: 20,
      logicalMarkdownBytesPerDestination: 20,
      physicalPlannedBytes: 100,
    });
    expect(logical.addNote('file', 10)).toBeNull();
    expect(logical.addNote('file', 10)).toBeNull();
    expect(logical.addNote('file', 1)).toBe('logical-markdown-bytes');

    const physical = new ExactPresentationBudget(
      new Map([
        ['file', 30],
        ['obsidian', 50],
      ]),
      {
        ...ALL_BRANCHES_BUDGET_LIMITS,
        individualNoteBytes: 100,
        logicalMarkdownBytesPerDestination: 100,
        physicalPlannedBytes: 100,
      }
    );
    expect(physical.addNote('file', 20)).toBeNull();
    expect(physical.addNote('obsidian', 1)).toBe('physical-planned-bytes');
    expect(physical.logicalBytesFor('file')).toBe(20);
    expect(physical.logicalBytesFor('obsidian')).toBe(0);
    expect(physical.totalPhysicalBytes).toBe(100);
  });

  it('counts each finalized trio and unique asset once, independently of branch count', () => {
    const receipt: ChatGptDestinationArchiveReceipt = {
      destination: 'file',
      captureId: 'capture-chatgpt-budget',
      conversationKey: 'a'.repeat(64),
      manifestSha256: 'b'.repeat(64),
      archiveByteLengths: { raw: 10, manifest: 20, canonical: 30 },
      assets: [
        {
          sha256: 'c'.repeat(64),
          relativePath: `assets/${'c'.repeat(64)}.pdf`,
          mediaType: 'application/pdf',
          byteLength: 40,
        },
        {
          sha256: 'd'.repeat(64),
          relativePath: `assets/${'d'.repeat(64)}.png`,
          mediaType: 'image/png',
          byteLength: 50,
        },
      ],
    };
    const retained = destinationRetainedBytes(receipt);
    expect(retained).toBe(150);
    const budget = new ExactPresentationBudget(
      new Map([
        ['file', retained],
        ['obsidian', retained],
      ])
    );
    for (let ordinal = 0; ordinal < 80; ordinal += 1) {
      expect(budget.addNote('file', 1)).toBeNull();
      expect(budget.addNote('obsidian', 2)).toBeNull();
    }
    expect(budget.logicalBytesFor('file')).toBe(80);
    expect(budget.logicalBytesFor('obsidian')).toBe(160);
    expect(budget.totalPhysicalBytes).toBe(300 + 240);
  });

  it('rejects unsafe retained-byte arithmetic instead of rounding', () => {
    const receipt = {
      archiveByteLengths: { raw: Number.MAX_SAFE_INTEGER, manifest: 1, canonical: 0 },
      assets: [],
    } as unknown as ChatGptDestinationArchiveReceipt;
    expect(() => destinationRetainedBytes(receipt)).toThrow('safe integer range');
    receipt.archiveByteLengths = { raw: 0, manifest: 0, canonical: 0 };
    receipt.assets = [{ byteLength: -1 }] as ChatGptDestinationArchiveReceipt['assets'];
    expect(() => destinationRetainedBytes(receipt)).toThrow('Invalid');
    expect(() => new ExactPresentationBudget(new Map([['file', -1]]))).toThrow('Invalid');
    expect(() => checkedAdd(Number.MAX_SAFE_INTEGER, 1, 'test')).toThrow('safe integer range');
  });

  it('checks initial retained bytes at the exact physical cap and +1 before admitting any note', () => {
    const cap = ALL_BRANCHES_BUDGET_LIMITS.physicalPlannedBytes;
    const exact = new ExactPresentationBudget(
      new Map([
        ['file', cap - 7],
        ['obsidian', 7],
      ])
    );
    expect(exact.preflight()).toBeNull();
    expect(exact.addNote('file', 0)).toBeNull();
    expect(exact.addNote('obsidian', 1)).toBe('physical-planned-bytes');
    expect(exact.totalPhysicalBytes).toBe(cap);
    expect(exact.logicalBytesFor('file')).toBe(0);
    const over = new ExactPresentationBudget(
      new Map([
        ['file', cap],
        ['obsidian', 1],
      ])
    );
    expect(over.preflight()).toBe('physical-planned-bytes');
    expect(over.addNote('file', 0)).toBe('physical-planned-bytes');
    expect(over.totalPhysicalBytes).toBe(cap + 1);
    expect(over.logicalBytesFor('obsidian')).toBe(0);

    const aggregateOverflow = new ExactPresentationBudget(
      new Map([
        ['file', Number.MAX_SAFE_INTEGER],
        ['obsidian', 1],
      ])
    );
    expect(aggregateOverflow.preflight()).toBe('physical-planned-bytes');
    expect(aggregateOverflow.totalPhysicalBytes).toBe(cap + 1);
  });

  it('atomically reserves HTML artifact+receipt bytes in the shared physical budget', () => {
    const budget = new ExactPresentationBudget(new Map([['file', 10]]), {
      ...ALL_BRANCHES_BUDGET_LIMITS,
      physicalPlannedBytes: 30,
      htmlRenderWorkBytes: 100,
    });
    expect(budget.preflightHtmlBundle(10, 10)).toBeNull();
    expect(budget.totalPhysicalBytes).toBe(10);
    expect(budget.totalHtmlRenderWorkBytes).toBe(0);
    expect(budget.addHtmlBundle(10, 10)).toBeNull();
    expect(budget.totalPhysicalBytes).toBe(30);
    expect(budget.totalHtmlRenderWorkBytes).toBe(20);
    expect(budget.addHtmlBundle(0, 1)).toBe('physical-planned-bytes');
    expect(budget.totalPhysicalBytes).toBe(30);
    expect(budget.totalHtmlRenderWorkBytes).toBe(20);
  });

  it('counts both HTML render passes with a homogeneous byte cap and no partial mutation', () => {
    const exact = new ExactPresentationBudget(new Map([['file', 0]]), {
      ...ALL_BRANCHES_BUDGET_LIMITS,
      physicalPlannedBytes: 100,
      htmlRenderWorkBytes: 20,
    });
    expect(exact.addHtmlBundle(10, 1)).toBeNull();
    expect(exact.totalHtmlRenderWorkBytes).toBe(20);
    expect(exact.addHtmlBundle(1, 0)).toBe('html-render-work-bytes');
    expect(exact.totalHtmlRenderWorkBytes).toBe(20);
    expect(exact.totalPhysicalBytes).toBe(11);

    const tooLarge = new ExactPresentationBudget(new Map([['file', 0]]), {
      ...ALL_BRANCHES_BUDGET_LIMITS,
      physicalPlannedBytes: Number.MAX_SAFE_INTEGER,
      htmlRenderWorkBytes: Number.MAX_SAFE_INTEGER,
    });
    expect(() => tooLarge.preflightHtmlBundle(Number.MAX_SAFE_INTEGER, 1)).toThrow(
      'safe integer range'
    );
  });

  it('detaches custom caps at construction so late caller mutation cannot change admission', () => {
    const limits = {
      ...ALL_BRANCHES_BUDGET_LIMITS,
      individualNoteBytes: 20,
      logicalMarkdownBytesPerDestination: 20,
      physicalPlannedBytes: 100,
      htmlRenderWorkBytes: 100,
    };
    const budget = new ExactPresentationBudget(new Map([['file', 0]]), limits);
    limits.individualNoteBytes = 0;
    limits.logicalMarkdownBytesPerDestination = 0;
    limits.physicalPlannedBytes = 0;
    limits.htmlRenderWorkBytes = 0;
    expect(budget.addNote('file', 10)).toBeNull();
    expect(budget.addHtmlBundle(10, 1)).toBeNull();
    expect(budget.totalPhysicalBytes).toBe(21);
    expect(budget.totalHtmlRenderWorkBytes).toBe(20);
  });
});
