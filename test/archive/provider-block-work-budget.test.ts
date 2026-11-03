import { describe, expect, it, vi } from 'vitest';
import {
  PROVIDER_CONTENT_MAX_BLOCKS,
  PROVIDER_CONTENT_MAX_OCCURRENCES,
  PROVIDER_CONTENT_MAX_WORK_UNITS,
  ProviderBlockWorkBudget,
  ProviderContentLimitError,
} from '../../src/archive/normalizers/provider-block-work-budget';
import { preflightClaudeDetailArtifact } from '../../src/archive/normalizers/claude';
import { inventoryDeepSeekRawAssets } from '../../src/archive/normalizers/deepseek';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const digest = () => Promise.resolve('0'.repeat(64));

function expectLimit(action: () => unknown, limit: string, observed: number): void {
  let error: unknown;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ProviderContentLimitError);
  expect(error).toMatchObject({
    code: 'provider-content-limit-exceeded',
    limit,
    observed,
  });
}

describe('provider aggregate content work budget', () => {
  it('admits exact per-traversal occurrence and block boundaries and rejects the next item', () => {
    const operation = new ProviderBlockWorkBudget('claude');
    const occurrences = operation.beginTraversal();
    occurrences.admitOccurrences(PROVIDER_CONTENT_MAX_OCCURRENCES);
    expect(occurrences.counters.occurrences).toBe(PROVIDER_CONTENT_MAX_OCCURRENCES);
    expectLimit(
      () => occurrences.admitOccurrences(),
      'occurrences',
      PROVIDER_CONTENT_MAX_OCCURRENCES + 1
    );

    const blocks = new ProviderBlockWorkBudget('deepseek').beginTraversal();
    blocks.recordBlocks(PROVIDER_CONTENT_MAX_BLOCKS);
    expect(blocks.counters.blocks).toBe(PROVIDER_CONTENT_MAX_BLOCKS);
    expectLimit(() => blocks.recordBlocks(), 'blocks', PROVIDER_CONTENT_MAX_BLOCKS + 1);
  });

  it('resets input admission per traversal while sharing operation-wide work', () => {
    const operation = new ProviderBlockWorkBudget('deepseek');
    operation.spendWork(PROVIDER_CONTENT_MAX_WORK_UNITS - 2);
    operation.beginTraversal().spendWork();
    expect(operation.counters.workUnits).toBe(PROVIDER_CONTENT_MAX_WORK_UNITS - 1);
    operation.beginTraversal().spendWork();
    expect(operation.counters.workUnits).toBe(PROVIDER_CONTENT_MAX_WORK_UNITS);
    expectLimit(
      () => operation.beginTraversal().spendWork(),
      'work',
      PROVIDER_CONTENT_MAX_WORK_UNITS + 1
    );
  });

  it('keeps repeated near-graph-cap modest content below the aggregate work ceiling', () => {
    const operation = new ProviderBlockWorkBudget('deepseek');
    for (let phase = 0; phase < 3; phase += 1) {
      const traversal = operation.beginTraversal();
      // Mirrors measured preflight/inventory/normalize work for 19,999 modest messages.
      traversal.admitOccurrences(220_000);
      traversal.recordBlocks(40_000);
      traversal.spendWork(380_000);
    }
    expect(operation.counters.workUnits).toBe(1_140_000);
    expect(operation.counters.workUnits).toBeLessThan(PROVIDER_CONTENT_MAX_WORK_UNITS);
  });

  it('counts nested Claude tool-result entries before classifying malformed content', () => {
    const operation = new ProviderBlockWorkBudget('claude');
    const traversal = operation.beginTraversal();
    vi.spyOn(operation, 'beginTraversal').mockReturnValue(traversal);
    expect(
      preflightClaudeDetailArtifact(
        encode({
          uuid: 'claude-budget-test',
          chat_messages: [{ content: [{ type: 'tool_result', content: [null] }] }],
        }),
        'claude-budget-test',
        operation
      )
    ).toEqual(['INVALID_CONTENT_BLOCK']);
    expect(traversal.counters.occurrences).toBe(3);
  });

  it('counts malformed, nonasset, and empty FILE entries before degraded inventory', async () => {
    const contentBudget = new ProviderBlockWorkBudget('deepseek');
    const traversal = contentBudget.beginTraversal();
    vi.spyOn(contentBudget, 'beginTraversal').mockReturnValue(traversal);
    const raw = {
      data: {
        biz_data: {
          chat_messages: [
            {
              files: [null],
              fragments: [null, { type: 'FUTURE' }, { type: 'FILE', files: [] }],
            },
          ],
        },
      },
    };

    await expect(
      inventoryDeepSeekRawAssets({ raw, artifactId: 'conversation', sha256: digest, contentBudget })
    ).resolves.toMatchObject({ completeness: 'unknown' });
    expect(traversal.counters.occurrences).toBe(7);
  });

  it('does not degrade a DeepSeek nested-metadata work limit hit', async () => {
    const contentBudget = new ProviderBlockWorkBudget('deepseek');
    contentBudget.spendWork(PROVIDER_CONTENT_MAX_WORK_UNITS - 1);
    const raw = {
      data: {
        biz_data: {
          chat_messages: [
            {
              files: [{ id: 'synthetic-file', audit_result: Array(5).fill(null) }],
            },
          ],
        },
      },
    };
    await expect(
      inventoryDeepSeekRawAssets({ raw, artifactId: 'conversation', sha256: digest, contentBudget })
    ).rejects.toMatchObject({
      code: 'provider-content-limit-exceeded',
      provider: 'deepseek',
      limit: 'work',
    });
  });
});
