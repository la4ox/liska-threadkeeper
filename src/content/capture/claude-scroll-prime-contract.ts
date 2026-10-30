/** Primitive-only Claude MAIN/isolated scroll-prime protocol. */
export const CLAUDE_SCROLL_PRIME_EVENT = 'liska:claude-scroll-prime:v1';
export const CLAUDE_SCROLL_PRIME_ROOT = '[data-autoscroll-container]';
export const CLAUDE_SCROLL_PRIME_MAX_DELTA = 130;
export const CLAUDE_ORIGIN = 'https://claude.ai';

export function isClaudeScrollPrimeDelta(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= CLAUDE_SCROLL_PRIME_MAX_DELTA
  );
}

export function isClaudeScrollPrimeMainContext(origin: string, topFrame: boolean): boolean {
  return origin === CLAUDE_ORIGIN && topFrame;
}

export function boundedClaudeScrollPrimeDelta(step: number): number | undefined {
  if (!Number.isFinite(step) || step <= 0) return undefined;
  return Math.min(step, CLAUDE_SCROLL_PRIME_MAX_DELTA);
}
