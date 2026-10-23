import { describe, expect, it } from 'vitest';
import {
  ALL_BRANCHES_BUDGET_LIMITS,
  ExactPresentationBudget,
  structuralBudgetPreflight,
  type ArchiveBranchWorkMetrics,
} from '../../src/content/archive-branch-budget';

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
    const exact = new ExactPresentationBudget(['file'], 0);
    expect(exact.addNote('file', ALL_BRANCHES_BUDGET_LIMITS.individualNoteBytes)).toBeNull();
    const overNote = new ExactPresentationBudget(['file'], 0);
    expect(overNote.addNote('file', ALL_BRANCHES_BUDGET_LIMITS.individualNoteBytes + 1)).toBe(
      'individual-note-bytes'
    );

    const logical = new ExactPresentationBudget(['file'], 0, {
      ...ALL_BRANCHES_BUDGET_LIMITS,
      individualNoteBytes: 20,
      logicalMarkdownBytesPerDestination: 20,
      physicalPlannedBytes: 100,
    });
    expect(logical.addNote('file', 10)).toBeNull();
    expect(logical.addNote('file', 10)).toBeNull();
    expect(logical.addNote('file', 1)).toBe('logical-markdown-bytes');

    const physical = new ExactPresentationBudget(['file', 'obsidian'], 40, {
      ...ALL_BRANCHES_BUDGET_LIMITS,
      individualNoteBytes: 100,
      logicalMarkdownBytesPerDestination: 100,
      physicalPlannedBytes: 100,
    });
    expect(physical.addNote('file', 20)).toBeNull();
    expect(physical.addNote('obsidian', 1)).toBe('physical-planned-bytes');
  });
});
