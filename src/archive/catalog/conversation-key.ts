import { CONVERSATION_KEY_VERSION } from './contracts';

/** Exact provider-aware recipe, distinct from the legacy SHA256(conversationId) routing key. */
export function conversationKeyInput(provider: string, conversationId: string): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify([CONVERSATION_KEY_VERSION, provider, conversationId])
  );
}
