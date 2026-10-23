/**
 * Synthetic 2026-10 Claude transcript, adapted from upstream #534/#536.
 * Models the published DOM shape, not a captured personal conversation.
 */
import { loadFixture, setClaudeLocation } from './dom-helpers';

export type ClaudeHubPart =
  | { kind: 'text'; html: string; markdown?: boolean }
  | { kind: 'thinking' | 'tool'; label: string; expanded?: string }
  | { kind: 'raw'; html: string };

export type ClaudeHubMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; parts: ClaudeHubPart[]; heading?: string };

const TURN_KEY = 'synthetic-turn';

function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Expanded panels are supplied as synthetic HTML; labels remain plain text. */
export function renderClaudeHubStatus(itemKey: string, label: string, expanded?: string): string {
  const safeLabel = escapeText(label);
  const panel = expanded === undefined ? '' : `<div data-open data-cds-row-panel>${expanded}</div>`;
  return `
    <div ${expanded === undefined ? 'data-closed' : ''} data-cds="TurnStatus"
      data-item-key="${TURN_KEY}-hub-reply:grp:${escapeText(itemKey)}" data-state="done" class="group/status">
      <div data-cds-row title="${safeLabel}">
        <span class="group/morph"><span class="col-start-1 row-start-1"><bdi>${safeLabel}</bdi></span></span>
        <button type="button" data-cds-row-toggle aria-expanded="${expanded !== undefined}"></button>
      </div>
      <span class="sr-only" role="status">${safeLabel}</span>
      ${panel}
    </div>`;
}

function renderPart(part: ClaudeHubPart, index: number): string {
  if (part.kind === 'raw') return part.html;
  if (part.kind === 'text') {
    return part.markdown === false
      ? part.html
      : `<div data-transcript-engine-root><div data-cds="Prose"><div class="standard-markdown">${part.html}</div></div></div>`;
  }
  return renderClaudeHubStatus(
    part.kind === 'thinking' ? `th${index}` : `cblk_synthetic${index}`,
    part.label,
    part.expanded
  );
}

function renderRow(message: ClaudeHubMessage, index: number): string {
  const body =
    message.role === 'user'
      ? `<div data-cds="UserMessage"><div data-testid="user-message"><p class="whitespace-pre-wrap break-words">${escapeText(message.text)}</p></div></div>`
      : `<div data-testid="assistant-message" data-cds="AssistantMessage" data-is-streaming="false">
          <h2 class="sr-only">Claude responded: ${escapeText(message.heading ?? 'answer')}</h2>
          <div class="flex flex-col">${message.parts.map(renderPart).join('')}</div>
          <div data-testid="message-actions" data-cds="MessageActions" role="toolbar">
            <button type="button">Copy answer</button><time>Oct 7</time>
          </div>
        </div>`;
  return `<div data-index="${index}" data-testid="transcript-row"><div role="article">${body}</div></div>`;
}

export function createClaudeHubPage(conversationId: string, messages: ClaudeHubMessage[]): void {
  setClaudeLocation(conversationId);
  loadFixture(`
    <div data-testid="bardhub-claudechat-root">
      <div data-autoscroll-container class="overflow-y-auto overflow-x-hidden flex-1">
        <div role="feed" aria-label="Chat messages">${messages.map(renderRow).join('')}</div>
      </div>
    </div>`);
}
