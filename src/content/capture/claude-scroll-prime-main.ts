import { isClaudeScrollPrimeMainContext } from './claude-scroll-prime-contract';
import { installClaudeScrollPrimeMain } from './claude-scroll-prime-main-runtime';

if (isClaudeScrollPrimeMainContext(window.location.origin, window.top === window)) {
  installClaudeScrollPrimeMain({ document });
}
