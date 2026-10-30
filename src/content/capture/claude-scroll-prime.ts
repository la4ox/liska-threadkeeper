import {
  boundedClaudeScrollPrimeDelta,
  CLAUDE_SCROLL_PRIME_EVENT,
  CLAUDE_SCROLL_PRIME_ROOT,
} from './claude-scroll-prime-contract';

/**
 * Ask the page's MAIN world to establish Claude's older-history scroll intent.
 *
 * The acknowledgement is deliberately ignored: measured DOM movement remains
 * the accumulation engine's only progress evidence.
 */
export function requestClaudeScrollPrime(container: HTMLElement, step: number): void {
  if (!container.matches(CLAUDE_SCROLL_PRIME_ROOT)) return;
  const delta = boundedClaudeScrollPrimeDelta(step);
  if (delta === undefined) return;
  try {
    container.dispatchEvent(
      new CustomEvent(CLAUDE_SCROLL_PRIME_EVENT, {
        cancelable: true,
        detail: delta,
      })
    );
  } catch {
    // Unknown outcome is intentionally not retried on this root revision.
  }
}
