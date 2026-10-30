import {
  CLAUDE_SCROLL_PRIME_EVENT,
  CLAUDE_SCROLL_PRIME_ROOT,
  isClaudeScrollPrimeDelta,
} from './claude-scroll-prime-contract';

export interface ClaudeScrollPrimeMainEnvironment {
  readonly document: Document;
}

/** Install one synchronous, page-local and privilege-free scroll bridge. */
export function installClaudeScrollPrimeMain(
  environment: ClaudeScrollPrimeMainEnvironment
): () => void {
  const { document: pageDocument } = environment;
  const handle = (event: Event): void => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!isClaudeScrollPrimeDelta(detail)) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (
      !target.isConnected ||
      target.ownerDocument !== pageDocument ||
      !target.matches(CLAUDE_SCROLL_PRIME_ROOT)
    ) {
      return;
    }
    const roots = pageDocument.querySelectorAll(CLAUDE_SCROLL_PRIME_ROOT);
    if (roots.length !== 1 || roots[0] !== target) return;
    try {
      const scrollBy = target.scrollBy;
      if (typeof scrollBy !== 'function') return;
      (scrollBy as (this: HTMLElement, options: ScrollToOptions) => void).call(target, {
        top: -detail,
        left: 0,
        behavior: 'instant',
      });
    } catch {
      return;
    }
    event.preventDefault();
  };
  pageDocument.addEventListener(CLAUDE_SCROLL_PRIME_EVENT, handle, true);
  return () => pageDocument.removeEventListener(CLAUDE_SCROLL_PRIME_EVENT, handle, true);
}
