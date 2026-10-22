import { MAX_LANG_HINT_LENGTH } from '../lib/constants';

const SAFE_LANGUAGE_HINT = /^[a-z0-9][a-z0-9_+.#-]*$/i;

/** Keep fenced-code info strings single-token and free of Markdown delimiters. */
export function safeMarkdownLanguageHint(value: string): string {
  const language = value.trim();
  return language.length <= MAX_LANG_HINT_LENGTH && SAFE_LANGUAGE_HINT.test(language)
    ? language
    : '';
}

/** Render code behind a fence longer than every backtick run in its payload. */
export function markdownCodeFence(content: string, language = ''): string {
  let longestRun = 0;
  for (const match of content.matchAll(/`+/g)) {
    longestRun = Math.max(longestRun, match[0].length);
  }
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${safeMarkdownLanguageHint(language)}\n${content}\n${fence}`;
}
