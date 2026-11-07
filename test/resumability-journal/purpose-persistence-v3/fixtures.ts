import { createHash } from 'node:crypto';
import { conversationKeyInput } from '../../../src/archive/catalog/conversation-key';
import {
  CHATGPT_PRODUCER_SCHEMA,
  type ChatGptProducerIntent,
  type ChatGptProducerReceipt,
  type ProducerDestination,
} from '../../../src/lib/chatgpt-producer-evidence';
import {
  CLAUDE_PRODUCER_SCHEMA,
  type ClaudeProducerIntent,
  type ClaudeProducerReceipt,
} from '../../../src/lib/claude-producer-evidence';
import { adaptChatGptProducerEvidence } from '../../../src/resumability-journal/producer-adapter';
import { adaptClaudeProducerEvidence } from '../../../src/resumability-journal/claude-producer-adapter';
import {
  FILE_ASSURANCE,
  OBSIDIAN_ASSURANCE,
  OPERATION_SCHEMA,
  STRICT_COMPLETENESS,
} from '../../../src/resumability-journal/purpose';
import {
  CHATGPT_ADAPTER_VERSION,
  CLAUDE_ADAPTER_VERSION,
  RECORD_SCHEMA,
  snapshotRecord,
  type Provider,
} from '../../../src/resumability-journal/purpose-persistence-v3/core/record';

export const conversationId = '11111111-2222-4333-8444-555555555555';
export const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const clone = <T>(input: T): T => JSON.parse(JSON.stringify(input));
export const key = (provider: Provider) =>
  `liska-conversation-key/1:${hash(conversationKeyInput(provider, conversationId))}` as const;
export function operation(
  provider: Provider = 'claude',
  destinations: ProducerDestination[] = ['file', 'obsidian']
) {
  return {
    schema: OPERATION_SCHEMA,
    purpose: 'new-capture' as const,
    operationId: 'operation-1',
    attemptId: 'attempt-1',
    captureId: `capture-${provider}-1`,
    admission: { provider, conversationId, conversationKey: key(provider) },
    sourceSelection: { catalogSha256: 'b'.repeat(64) },
    destinations: destinations.map(destination =>
      destination === 'file'
        ? { destination, assurance: FILE_ASSURANCE }
        : { destination, assurance: OBSIDIAN_ASSURANCE }
    ),
    completenessPolicy: STRICT_COMPLETENESS,
  };
}
function intentFields(provider: Provider, requiredDestinations: ProducerDestination[]) {
  const current = operation(provider, requiredDestinations);
  return {
    operationId: current.operationId,
    attemptId: current.attemptId,
    captureId: current.captureId,
    conversationId,
    conversationKey: current.admission.conversationKey,
    catalogSha256: current.sourceSelection.catalogSha256,
    requiredDestinations: [...requiredDestinations],
  };
}
export function claudeIntent(
  destinations: ProducerDestination[] = ['file', 'obsidian']
): ClaudeProducerIntent {
  return { ...intentFields('claude', destinations), provider: 'claude' };
}
export function chatgptIntent(
  destinations: ProducerDestination[] = ['file', 'obsidian']
): ChatGptProducerIntent {
  return { ...intentFields('chatgpt', destinations), provider: 'chatgpt' };
}
export function commitment(relativePath: string) {
  return { relativePath, byteLength: 2, sha256: hash(new TextEncoder().encode('{}')) };
}
function facts(
  provider: Provider,
  destination: ProducerDestination,
  requestedDestinations: ProducerDestination[]
) {
  const raw = commitment('raw.json');
  const manifest = commitment(`${destination}/manifest.json`);
  const canonical = commitment(`${destination}/canonical.json`);
  return {
    conversationId,
    captureId: `capture-${provider}-1`,
    legacyRoutingDigest: hash(new TextEncoder().encode(conversationId)),
    requestedDestinations: [...requestedDestinations],
    destination,
    raw,
    manifest,
    canonical,
    completeness: {
      graph: 'complete' as const,
      messages: 'complete' as const,
      branches: 'complete' as const,
      assets: 'complete' as const,
    },
    assets: [],
    observations: [raw, manifest, canonical].map(commitment => ({
      destination,
      commitment,
      observation:
        destination === 'file'
          ? {
              kind: FILE_ASSURANCE,
              observedRelativePath: commitment.relativePath,
            }
          : {
              kind: OBSIDIAN_ASSURANCE,
              byteLength: commitment.byteLength,
              sha256: commitment.sha256,
            },
    })),
  };
}
export function claudeReceipts(
  destinations: ProducerDestination[] = ['file', 'obsidian']
): ClaudeProducerReceipt[] {
  return destinations.map(destination => ({
    ...facts('claude', destination, destinations),
    schema: CLAUDE_PRODUCER_SCHEMA,
    provider: 'claude',
    intent: claudeIntent(destinations),
  }));
}
export function chatgptReceipts(
  destinations: ProducerDestination[] = ['file', 'obsidian']
): ChatGptProducerReceipt[] {
  return destinations.map(destination => ({
    ...facts('chatgpt', destination, destinations),
    schema: CHATGPT_PRODUCER_SCHEMA,
    provider: 'chatgpt',
    intent: chatgptIntent(destinations),
  }));
}
export function reserved(provider: Provider = 'claude') {
  return snapshotRecord({
    schema: RECORD_SCHEMA,
    revision: 0,
    operation: operation(provider),
    phase: 'reserved',
    control: 'active',
    disposition: 'open',
  });
}
export async function observed(provider: Provider = 'claude', hashFailed = false) {
  const current = reserved(provider);
  const receipts = provider === 'chatgpt' ? chatgptReceipts() : claudeReceipts();
  const sha256 = hashFailed
    ? () => {
        throw new Error('private hash failure');
      }
    : hash;
  const adaptation =
    provider === 'chatgpt'
      ? await adaptChatGptProducerEvidence(current.operation, receipts, sha256)
      : await adaptClaudeProducerEvidence(current.operation, receipts, sha256);
  return snapshotRecord({
    ...current,
    phase: 'awaiting-resolution',
    observation: {
      provider,
      adapterVersion: provider === 'chatgpt' ? CHATGPT_ADAPTER_VERSION : CLAUDE_ADAPTER_VERSION,
      hashOutcome: hashFailed ? 'failed' : 'available',
      receipts,
      adaptation,
    },
  });
}
