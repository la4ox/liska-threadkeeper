/**
 * UI-injection readiness hints, derived from each extractor's supported turn group.
 * A selector repair therefore updates both the extractor and bootstrap's hint.
 *
 * This is only a UI-injection hint, not proof that extraction is ready or complete.
 * ChatGPT and DeepSeek remain structured-first; a missing DOM hint must not block
 * their export controls beyond bootstrap's unconditional fallback timeout.
 * Query only the current platform's hint: a generic selector from another
 * provider can match unrelated page UI.
 * Keying by AIPlatform makes the compiler require every supported platform.
 */

import type { AIPlatform } from '../../../lib/types';
import { SELECTORS as GEMINI } from './gemini';
import { SELECTORS as CLAUDE } from './claude';
import { SELECTORS as CHATGPT, LEGACY_SELECTORS as CHATGPT_LEGACY } from './chatgpt';
import { SELECTORS as PERPLEXITY, LEGACY_USER_QUERY } from './perplexity';
import { SELECTORS as DEEPSEEK } from './deepseek';
import { SELECTORS as NOTEBOOKLM } from './notebooklm';

const CLAUDE_MESSAGE_SELECTOR = [...CLAUDE.userMessage, ...CLAUDE.assistantResponse].join(', ');

export const CONVERSATION_READY_SELECTORS: Readonly<Record<AIPlatform, string>> = {
  // Root extraction also supports layouts without conversation-turn wrappers.
  gemini: [...GEMINI.conversationTurn, ...GEMINI.userQuery, ...GEMINI.modelResponse].join(', '),
  // The sidebar also has indexed rows; require content owned by the extractor.
  // Rowless legacy messages count only inside the supported transcript root.
  claude: [
    ...CLAUDE.conversationRow.map(row => `${row}:has(${CLAUDE_MESSAGE_SELECTOR})`),
    `.conversation-thread:has(${CLAUDE_MESSAGE_SELECTOR})`,
  ].join(', '),
  chatgpt: [...CHATGPT.conversationTurn, ...CHATGPT_LEGACY.conversationTurn].join(', '),
  // The user query renders before an answer; Perplexity has no turn wrapper.
  perplexity: [...PERPLEXITY.userQuery, ...LEGACY_USER_QUERY].join(', '),
  deepseek: DEEPSEEK.message.join(', '),
  notebooklm: NOTEBOOKLM.conversationTurn.join(', '),
};
