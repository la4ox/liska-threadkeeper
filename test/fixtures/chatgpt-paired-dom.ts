/** Synthetic paired-turn ChatGPT DOM; all text is invented. */
export interface PairedTurn {
  key: string;
  user: string;
  answers?: readonly string[];
  userMessageId?: string;
  assistantMessageId?: string;
  dateSeparator?: string;
}

function answerUnit(turn: PairedTurn): string {
  const messageId = turn.assistantMessageId ?? `${turn.key || 'keyless'}-assistant`;
  const blocks = (turn.answers ?? [])
    .map(
      html => `<div data-chatgpt-selection-message-id="${messageId}">
        <div data-markdown-text-style="assistant-message">${html}</div>
      </div>`
    )
    .join('');
  return `<div data-chatgpt-search-message-ids="${messageId}">
    <h4 class="sr-only" data-conversation-role="assistant">ChatGPT said:</h4>
    ${blocks}
  </div>`;
}

export function renderPairedTurn(turn: PairedTurn, index: number): string {
  const userMessageId = turn.userMessageId ?? turn.key;
  const separator = turn.dateSeparator
    ? `<div role="separator" aria-label="${turn.dateSeparator}">${turn.dateSeparator}</div>`
    : '';
  const answer = (turn.answers?.length ?? 0) > 0 ? answerUnit(turn) : '';
  return `<div data-turn-key="${turn.key}">
    <div data-content-search-turn-key="fallback-turn-${index}">
      ${separator}
      <div data-chatgpt-search-message-ids="${userMessageId}">
        <div data-user-message-bubble="true"><div class="whitespace-pre-wrap">${turn.user}</div></div>
      </div>
      ${answer}
    </div>
  </div>`;
}

export function createPairedChatGptPage(turns: readonly PairedTurn[]): string {
  return `<nav><div data-app-action-sidebar-scroll></div></nav>
  <main>
    <div data-app-action-timeline-scroll style="display:flex;flex-direction:column-reverse">
      <div>${turns.map(renderPairedTurn).join('')}</div>
    </div>
  </main>`;
}
