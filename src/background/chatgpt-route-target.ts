import { isChatGptConversationId } from '../lib/chatgpt-capture-contract';
import type { ChatGptRouteFamily } from '../lib/chatgpt-owner-context';

/** Background-only capability: the owner pathname must never enter runtime responses. */
export interface ChatGptCaptureTarget {
  readonly conversationId: string;
  readonly pathname: string;
  readonly routeFamily: ChatGptRouteFamily;
}

function parseSerializedChatGptCaptureTarget(rawUrl: string): ChatGptCaptureTarget | undefined {
  const match =
    /^https:\/\/chatgpt\.com(\/(?:c\/|g\/([a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?)\/c\/)([^/]+)\/?)$/.exec(
      rawUrl
    );
  if (!match || match[0] !== rawUrl || !isChatGptConversationId(match[3])) return undefined;
  const slug = match[2];
  return Object.freeze({
    conversationId: match[3],
    pathname: match[1],
    routeFamily:
      slug === undefined ? 'standard' : slug.startsWith('g-p-') ? 'project' : 'custom-gpt',
  });
}

/** Parse exact serialized routes, rejecting URL normalization and encoded aliases. */
export function parseChatGptCaptureTarget(
  rawUrl: string,
  conversationId: string
): ChatGptCaptureTarget | undefined {
  if (!isChatGptConversationId(conversationId) || typeof rawUrl !== 'string') return undefined;
  const target = parseSerializedChatGptCaptureTarget(rawUrl);
  return target?.conversationId === conversationId ? target : undefined;
}

export function isExactChatGptDocumentUrl(rawUrl: string): boolean {
  try {
    const senderUrl = new URL(rawUrl);
    return (
      senderUrl.origin === 'https://chatgpt.com' &&
      senderUrl.username === '' &&
      senderUrl.password === ''
    );
  } catch {
    return false;
  }
}

/** Derive only from the current tab route, retaining same-origin stale SPA document URLs. */
export function deriveChatGptCaptureTarget(
  sender: chrome.runtime.MessageSender,
  conversationId: string
): ChatGptCaptureTarget | undefined {
  if (!sender.tab?.url || (sender.url !== undefined && !isExactChatGptDocumentUrl(sender.url))) {
    return undefined;
  }
  return parseChatGptCaptureTarget(sender.tab.url, conversationId);
}

export function isChatGptCaptureTarget(value: unknown): value is ChatGptCaptureTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const expectedKeys = ['conversationId', 'pathname', 'routeFamily'] as const;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length || !expectedKeys.every(key => keys.includes(key))) {
    return false;
  }
  const descriptors = expectedKeys.map(key => Object.getOwnPropertyDescriptor(value, key));
  if (descriptors.some(descriptor => !descriptor || !('value' in descriptor))) return false;
  const [conversationId, pathname, routeFamily] = descriptors.map(descriptor => descriptor?.value);
  if (
    typeof conversationId !== 'string' ||
    typeof pathname !== 'string' ||
    typeof routeFamily !== 'string'
  ) {
    return false;
  }
  const parsed = parseChatGptCaptureTarget(`https://chatgpt.com${pathname}`, conversationId);
  return parsed !== undefined && parsed.routeFamily === routeFamily;
}

/** Value-free diagnostics only: no observed route or marker may cross the boundary. */
export type ChatGptCaptureTargetUrlClassification =
  | 'equivalent'
  | 'unexpected-origin'
  | 'unexpected-path'
  | 'unexpected-conversation'
  | 'unexpected-route-family'
  | 'unexpected-query'
  | 'unexpected-marker';

/** Diagnose route movement before query/marker changes without broadening equivalence. */
export function classifyChatGptCaptureTargetUrl(
  rawUrl: string,
  target: ChatGptCaptureTarget,
  expectedHash: string
): ChatGptCaptureTargetUrlClassification {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== 'https://chatgpt.com' || url.username !== '' || url.password !== '') {
      return 'unexpected-origin';
    }
    const actual = parseSerializedChatGptCaptureTarget(`https://chatgpt.com${url.pathname}`);
    if (actual === undefined) return 'unexpected-path';
    if (actual.conversationId !== target.conversationId) return 'unexpected-conversation';
    if (actual.routeFamily !== target.routeFamily) return 'unexpected-route-family';
    if (url.search !== '') return 'unexpected-query';
    if (url.hash !== expectedHash) return 'unexpected-marker';
    return 'equivalent';
  } catch {
    return 'unexpected-origin';
  }
}

/** Allow only provider slug canonicalization inside the same owner family and UUID. */
export function isEquivalentChatGptCaptureTargetUrl(
  rawUrl: string,
  target: ChatGptCaptureTarget,
  expectedHash: string
): boolean {
  return classifyChatGptCaptureTargetUrl(rawUrl, target, expectedHash) === 'equivalent';
}
