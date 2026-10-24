const DOTS_PATH = /^\/dots(?:\/|$)/i;

/**
 * Dots shares chatgpt.com but is a distinct product surface with its own data
 * model. Until its raw-first adapter exists, never pass it to ChatGPT DOM
 * fallback and mislabel a visible window as a complete ChatGPT conversation.
 */
export function isChatGptDotsRoute(hostname: string, pathname: string): boolean {
  return hostname.toLowerCase() === 'chatgpt.com' && DOTS_PATH.test(pathname);
}
