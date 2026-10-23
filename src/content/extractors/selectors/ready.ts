/**
 * UI-injection readiness hints, derived from each extractor's primary turn group.
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
import { SELECTORS as CHATGPT } from './chatgpt';
import { SELECTORS as PERPLEXITY } from './perplexity';
import { SELECTORS as DEEPSEEK } from './deepseek';
import { SELECTORS as NOTEBOOKLM } from './notebooklm';

export const CONVERSATION_READY_SELECTORS: Readonly<Record<AIPlatform, string>> = {
  gemini: GEMINI.conversationTurn[0],
  claude: CLAUDE.conversationRow[0],
  chatgpt: CHATGPT.conversationTurn[0],
  // The user query renders before an answer; Perplexity has no turn wrapper.
  perplexity: PERPLEXITY.userQuery[0],
  deepseek: DEEPSEEK.message[0],
  notebooklm: NOTEBOOKLM.conversationTurn[0],
};
