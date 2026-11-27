const UUID = '[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
const ARCHIVE_CHAT_URL = new RegExp(
  `^https://claude\\.ai/chat/${UUID}(\\?artifact=${UUID}(?:#[0-9a-f]{8}-[0-9a-f]{4})?)?$`
);

/** Recognize the literal chat URL, optionally with Claude's Artifact selection suffix. */
export function classifyClaudeArchiveChatUrl(
  rawUrl: string
): 'conversation' | 'artifact' | undefined {
  // Do not normalize an authority, decode the query, or ignore a trailing line break.
  const match = ARCHIVE_CHAT_URL.exec(rawUrl);
  if (!match || match[0] !== rawUrl) return undefined;
  return match[1] ? 'artifact' : 'conversation';
}
