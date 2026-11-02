import {
  ChatGptContentLimitError,
  type ChatGptContentBudgetCounters,
  type ChatGptContentLimitKind,
} from './contracts';

export const CHATGPT_CONTENT_MAX_DEPTH = 2_048;
export const CHATGPT_CONTENT_MAX_OCCURRENCES = 250_000;
export const CHATGPT_CONTENT_MAX_BLOCKS = 250_000;
export const CHATGPT_CONTENT_MAX_WORK_UNITS = 1_000_000;

const MAXIMUMS: Readonly<Record<ChatGptContentLimitKind, number>> = {
  depth: CHATGPT_CONTENT_MAX_DEPTH,
  occurrences: CHATGPT_CONTENT_MAX_OCCURRENCES,
  blocks: CHATGPT_CONTENT_MAX_BLOCKS,
  work: CHATGPT_CONTENT_MAX_WORK_UNITS,
};

export function createChatGptContentBudget(): ChatGptContentBudgetCounters {
  return { maxDepth: 0, occurrences: 0, workUnits: 0, blocks: 0 };
}

function assertWithin(
  budget: ChatGptContentBudgetCounters,
  limit: ChatGptContentLimitKind,
  observed: number
): void {
  const maximum = MAXIMUMS[limit];
  if (observed > maximum) {
    throw new ChatGptContentLimitError(limit, maximum, observed, budget);
  }
}

export function spendChatGptContentWork(budget: ChatGptContentBudgetCounters, units = 1): void {
  budget.workUnits += units;
  assertWithin(budget, 'work', budget.workUnits);
}

export function enterChatGptContentRecord(
  budget: ChatGptContentBudgetCounters,
  depth: number
): void {
  budget.maxDepth = Math.max(budget.maxDepth, depth);
  assertWithin(budget, 'depth', budget.maxDepth);
  budget.occurrences += 1;
  assertWithin(budget, 'occurrences', budget.occurrences);
}

export function recordChatGptContentBlocks(
  budget: ChatGptContentBudgetCounters,
  count: number
): void {
  budget.blocks += count;
  assertWithin(budget, 'blocks', budget.blocks);
}
