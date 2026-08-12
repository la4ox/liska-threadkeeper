import { MAX_CONVERSATION_TITLE_LENGTH } from '../../lib/constants';
import type { ConversationMessage } from '../../lib/types';

type JsonRecord = Record<string, unknown>;
type MessageRole = 'user' | 'assistant';

const HISTORY_ENDPOINT = 'https://chat.deepseek.com/api/v0/chat/history_messages';
const HISTORY_TIMEOUT_MS = 15_000;
const HISTORY_MAX_BYTES = 32 * 1024 * 1024;

interface ApiMessage {
  id: string;
  parentId: string | null;
  role: MessageRole;
  content: string;
  thinking: string;
}

interface HistoryEnvelope {
  session: JsonRecord;
  rawMessages: unknown[];
}

export interface DeepSeekApiConversation {
  title: string | null;
  messages: ConversationMessage[];
}

/** Fetch the complete active branch from the authenticated DeepSeek tab. */
export async function fetchDeepSeekConversation(
  conversationId: string,
  includeThinking: boolean
): Promise<DeepSeekApiConversation | null> {
  const token = readAuthToken();
  if (!token) return null;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), HISTORY_TIMEOUT_MS);
  try {
    const url = new URL(HISTORY_ENDPOINT);
    // cache_version/cache_reset_at can make DeepSeek return only a cache delta.
    url.searchParams.set('chat_session_id', conversationId);
    const response = await fetch(url.href, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const body = await readBoundedBody(response);
    return parseHistoryResponse(JSON.parse(body) as unknown, conversationId, includeThinking);
  } finally {
    window.clearTimeout(timeout);
  }
}

/** Read DeepSeek's page-local bearer without logging or persisting it. */
function readAuthToken(): string | null {
  try {
    const stored = localStorage.getItem('userToken');
    if (!stored) return null;
    let value: unknown = stored;
    try {
      const parsed = JSON.parse(stored) as unknown;
      value = isRecord(parsed) && 'value' in parsed ? parsed.value : parsed;
    } catch {
      // Older builds can store the token as an unquoted string.
    }

    if (typeof value !== 'string') return null;
    const token = value.trim();
    return token && token.length <= 16_384 && !token.includes('\n') && !token.includes('\r')
      ? token
      : null;
  } catch {
    return null;
  }
}

/** Enforce the response limit while streaming, not after allocation. */
async function readBoundedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > HISTORY_MAX_BYTES) {
    throw new Error('history response exceeds the 32 MiB safety limit');
  }

  const reader = response.body?.getReader();
  if (!reader) return readBoundedTextFallback(response);

  const decoder = new TextDecoder();
  let totalBytes = 0;
  let body = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > HISTORY_MAX_BYTES) {
      await reader.cancel();
      throw new Error('history response exceeds the 32 MiB safety limit');
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  return body + decoder.decode();
}

async function readBoundedTextFallback(response: Response): Promise<string> {
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > HISTORY_MAX_BYTES) {
    throw new Error('history response exceeds the 32 MiB safety limit');
  }
  return body;
}

function parseHistoryResponse(
  payload: unknown,
  expectedSessionId: string,
  includeThinking: boolean
): DeepSeekApiConversation | null {
  const envelope = parseEnvelope(payload, expectedSessionId);
  if (!envelope) return null;
  const messageMap = buildMessageMap(envelope.rawMessages);
  if (!messageMap || messageMap.size === 0) return null;

  const currentMessageId = resolveCurrentMessageId(envelope.session, messageMap);
  if (!currentMessageId) return null;
  const activeMessages = buildActiveChain(messageMap, currentMessageId);
  return activeMessages
    ? buildConversation(envelope.session, activeMessages, includeThinking)
    : null;
}

function parseEnvelope(payload: unknown, expectedSessionId: string): HistoryEnvelope | null {
  if (!isRecord(payload)) return null;
  assertSuccessCode(payload.code, 'API');
  const data = childRecord(payload, 'data');
  assertSuccessCode(data?.biz_code, 'business');
  const bizData = childRecord(data, 'biz_data');
  const session = childRecord(bizData, 'chat_session');
  const rawMessages = bizData?.chat_messages;
  if (!session || !Array.isArray(rawMessages)) return null;

  const responseSessionId = toIdentifier(session.id);
  if (responseSessionId !== expectedSessionId) return null;
  const cacheControl = uppercaseString(bizData?.cache_control);
  // MERGE/APPEND are deltas and cannot prove that the oldest parent is present.
  if (cacheControl && cacheControl !== 'REPLACE') return null;
  return { session, rawMessages };
}

function childRecord(parent: JsonRecord | null, key: string): JsonRecord | null {
  const value = parent?.[key];
  return isRecord(value) ? value : null;
}

function uppercaseString(value: unknown): string | null {
  return typeof value === 'string' ? value.toUpperCase() : null;
}

function assertSuccessCode(value: unknown, label: string): void {
  if (typeof value === 'number' && value !== 0) {
    throw new Error(`DeepSeek ${label} code ${value}`);
  }
}

function buildMessageMap(rawMessages: unknown[]): Map<string, ApiMessage> | null {
  const messages = new Map<string, ApiMessage>();
  for (const value of rawMessages) {
    const message = parseApiMessage(value);
    if (!message) continue;
    if (messages.has(message.id)) return null;
    messages.set(message.id, message);
  }
  return messages;
}

function resolveCurrentMessageId(
  session: JsonRecord,
  messages: Map<string, ApiMessage>
): string | null {
  if (session.current_message_id != null) {
    return toIdentifier(session.current_message_id);
  }
  return findOnlyLeafMessageId(messages);
}

function buildActiveChain(
  messages: Map<string, ApiMessage>,
  currentMessageId: string
): ApiMessage[] | null {
  const active: ApiMessage[] = [];
  const seen = new Set<string>();
  let messageId: string | null = currentMessageId;
  while (messageId) {
    if (seen.has(messageId)) return null;
    seen.add(messageId);
    const message = messages.get(messageId);
    if (!message) return null;
    active.push(message);
    messageId = message.parentId;
  }
  return active.reverse();
}

function buildConversation(
  session: JsonRecord,
  activeMessages: ApiMessage[],
  includeThinking: boolean
): DeepSeekApiConversation | null {
  const messages = activeMessages
    .filter(message => message.content.length > 0)
    .map<ConversationMessage>((message, index) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      contentFormat: message.role === 'assistant' ? 'markdown' : undefined,
      toolContent:
        message.role === 'assistant' && includeThinking && message.thinking
          ? `**DeepSeek reasoning**\n${message.thinking}`
          : undefined,
      index,
    }));
  if (messages.length === 0) return null;

  const rawTitle =
    typeof session.title === 'string' ? session.title.replace(/\s+/g, ' ').trim() : '';
  return {
    title: rawTitle ? rawTitle.substring(0, MAX_CONVERSATION_TITLE_LENGTH) : null,
    messages,
  };
}

function parseApiMessage(value: unknown): ApiMessage | null {
  if (!isRecord(value)) return null;
  const id = toIdentifier(value.message_id ?? value.id);
  const role = normalizeRole(value.role);
  if (!id || !role) return null;

  const contentTypes = role === 'user' ? ['REQUEST'] : ['RESPONSE', 'TEMPLATE_RESPONSE'];
  const content = fragmentText(value.fragments, contentTypes) || normalizeApiText(value.content);
  const thinking =
    role === 'assistant'
      ? fragmentText(value.fragments, ['THINK']) || normalizeApiText(value.thinking_content)
      : '';
  const parentId = value.parent_id == null ? null : toIdentifier(value.parent_id);
  if (value.parent_id != null && !parentId) return null;
  return {
    id,
    parentId,
    role,
    content,
    thinking,
  };
}

function normalizeRole(value: unknown): MessageRole | null {
  if (typeof value !== 'string') return null;
  const role = value.toLowerCase();
  if (role === 'user' || role === 'human') return 'user';
  if (role === 'assistant' || role === 'ai' || role === 'bot') return 'assistant';
  return null;
}

function fragmentText(value: unknown, preferredTypes: readonly string[]): string {
  if (!Array.isArray(value)) return '';
  for (const preferredType of preferredTypes) {
    const parts = value
      .filter(isRecord)
      .filter(fragment => String(fragment.type ?? '').toUpperCase() === preferredType)
      .map(fragment => normalizeApiText(fragment.content))
      .filter(Boolean);
    if (parts.length > 0) return parts.join('\n\n');
  }
  return '';
}

function findOnlyLeafMessageId(messages: Map<string, ApiMessage>): string | null {
  const parentIds = new Set(
    [...messages.values()]
      .map(message => message.parentId)
      .filter((parentId): parentId is string => parentId !== null)
  );
  const leaves = [...messages.keys()].filter(id => !parentIds.has(id));
  return leaves.length === 1 ? leaves[0] : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toIdentifier(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return null;
}

function normalizeApiText(value: unknown): string {
  let text = '';
  if (typeof value === 'string') {
    text = value;
  } else if (Array.isArray(value)) {
    text = value
      .map(item => normalizeApiText(item))
      .filter(Boolean)
      .join('\n');
  } else if (isRecord(value)) {
    text =
      normalizeApiText(value.text) ||
      normalizeApiText(value.content) ||
      normalizeApiText(value.parts);
  }
  return text.split(String.fromCharCode(0)).join('').replace(/\r\n?/g, '\n').trim();
}
