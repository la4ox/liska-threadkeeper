import { createHash } from 'node:crypto';
import { buildCaptureManifest } from '../../../src/archive/capture';
import { buildSnapshotCatalog, encodeSnapshotCatalog } from '../../../src/archive/catalog';
import { conversationKeyInput } from '../../../src/archive/catalog/conversation-key';
import {
  CHATGPT_CAPTURE_ENDPOINT,
  type ChatGptCaptureResponse,
} from '../../../src/lib/chatgpt-capture-contract';
import {
  CHATGPT_PRODUCER_SCHEMA,
  type ChatGptProducerReceipt,
} from '../../../src/lib/chatgpt-producer-evidence';
import type {
  ChatGptNewCaptureRequest,
  PreparedChatGptCapture,
} from '../../../src/resumability-journal/capture-handoff';
import { type PurposePersistenceStore } from '../../../src/resumability-journal/purpose-persistence-v2/idb';
export const conversationId = '11111111-2222-4333-8444-555555555555';
export const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const sha256 = async (bytes: Uint8Array) => hash(bytes);
export const key =
  `liska-conversation-key/1:${hash(conversationKeyInput('chatgpt', conversationId))}` as const;
export const clone = <T>(input: T): T => JSON.parse(JSON.stringify(input));
export const signal = () => new AbortController().signal;
export function request(id = '1'): ChatGptNewCaptureRequest {
  return {
    selection: { provider: 'chatgpt', conversationId, conversationKey: key },
    operationId: 'operation-' + id,
    attemptId: 'attempt-' + id,
    captureId: 'capture-chatgpt-' + id,
    requiredDestinations: ['file'],
  };
}
export async function catalog() {
  const manifest = buildCaptureManifest({
    provider: 'chatgpt',
    conversationId,
    captureId: 'capture-chatgpt-previous',
    capturedAt: '2026-11-04T00:00:00.000Z',
    method: 'same-origin-api',
    artifacts: [
      {
        id: 'conversation',
        relativePath: 'responses/conversation.json',
        mediaType: 'application/json',
        byteLength: 2,
        sha256: hash(new TextEncoder().encode('{}')),
        endpoint: CHATGPT_CAPTURE_ENDPOINT,
      },
    ],
    assets: [],
    completeness: {
      graph: 'complete',
      messages: 'complete',
      branches: 'complete',
      assets: 'complete',
    },
    warnings: [],
    observedUnknownContentTypes: [],
  });
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  return buildSnapshotCatalog({
    files: [
      { relativePath: 'old/manifest.json', byteLength: bytes.length },
      { relativePath: 'old/responses/conversation.json', byteLength: 2 },
    ],
    manifests: [{ relativePath: 'old/manifest.json', bytes }],
    sha256,
  });
}

export function response(text?: string): ChatGptCaptureResponse {
  const bytes = new TextEncoder().encode(
    text ??
      JSON.stringify({
        conversation_id: conversationId,
        title: 'Synthetic',
        current_node: 'a',
        mapping: {
          a: {
            id: 'a',
            parent: null,
            children: [],
            message: {
              id: 'a',
              author: { role: 'assistant' },
              content: { content_type: 'text', parts: ['Synthetic content'] },
            },
          },
        },
      })
  );
  return {
    success: true,
    data: {
      transport: 'inline',
      bodyBase64: btoa(String.fromCharCode(...bytes)),
      byteLength: bytes.length,
      sha256: hash(bytes),
      mediaType: 'application/json',
      endpoint: CHATGPT_CAPTURE_ENDPOINT,
      routeFamily: 'standard',
      transientAssetResolvers: [],
    },
  };
}
export async function reserve(
  store: PurposePersistenceStore,
  id = '1',
  changes: Partial<ChatGptNewCaptureRequest> = {}
) {
  return store.reserveChatGpt(
    encodeSnapshotCatalog(await catalog()),
    { ...request(id), ...changes },
    { signal: signal() }
  );
}
export function receipts(prepared: PreparedChatGptCapture): ChatGptProducerReceipt[] {
  const commitment = (relativePath: string) => ({
    relativePath,
    byteLength: 2,
    sha256: hash(new TextEncoder().encode('{}')),
  });
  const raw = commitment('raw.json');
  const manifest = commitment('manifest.json');
  const canonical = commitment('canonical.json');
  return [
    {
      schema: CHATGPT_PRODUCER_SCHEMA,
      provider: 'chatgpt',
      conversationId,
      captureId: prepared.operation.captureId,
      legacyRoutingDigest: hash(new TextEncoder().encode(conversationId)),
      requestedDestinations: ['file'],
      intent: prepared.producerIntent,
      destination: 'file',
      raw,
      manifest,
      canonical,
      completeness: {
        graph: 'complete',
        messages: 'complete',
        branches: 'complete',
        assets: 'complete',
      },
      assets: [],
      observations: [raw, manifest, canonical].map(commitment => ({
        destination: 'file',
        commitment,
        observation: {
          kind: 'browser-download-complete-path-confirmed',
          observedRelativePath: commitment.relativePath,
        },
      })),
    },
  ];
}
